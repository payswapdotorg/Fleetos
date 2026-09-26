/**
 * @fleetos/device-model — D4: The observation ingestion control-plane
 * boundary.
 *
 * This is the boundary service a device agent posts `ObservationBatch`
 * values to on check-in (the frozen contracts shape). Device agents are
 * untrusted and tenant-scoped (`spec/ARCHITECTURE-LOCK.md` item 5), so
 * every input is validated before admission; tenant isolation is enforced
 * at this action boundary AND at the persistence boundary (item 17).
 *
 * Boundary semantics:
 *   - Validation: request structure, tenant grammar, tenant match between
 *     the caller scope and the batch, the frozen contracts batch
 *     invariants (`validateObservationBatch`), and a maximum batch size.
 *     Rejections are mapped onto the FleetError taxonomy.
 *   - Idempotent admission (contracts idempotency): a batch is identified
 *     by (tenantId, idempotencyKey). Replaying the SAME batch returns the
 *     original outcome as a `duplicate` ack — never re-admitted, never
 *     partially applied. Replaying a DIFFERENT batch under the same key is
 *     an idempotency conflict (ConflictError). Individual events are
 *     additionally deduplicated by observation id — an event id is
 *     admitted exactly once per (tenant, device).
 *   - Ack semantics: `admitted` (durably recorded; the agent may drop its
 *     queue), `duplicate` (already admitted; same logical outcome),
 *     `shed` (back-pressure; retry later), or an error result.
 *   - Back-pressure signal: the service tracks admitted-but-undrained
 *     observations (the queue depth). When the next batch would overflow
 *     the configured maximum queue depth the batch is SHED with a retry
 *     hint; the signal is surfaced on every ack. The operator drains the
 *     queue as downstream processing completes (`drain`).
 *   - Audit emission seam: every admission, duplicate suppression, shed,
 *     and attributable rejection is handed to the injected audit sink as
 *     an append-only record. The audit package itself is lane C's W012;
 *     this boundary depends only on the minimal `AuditSink` interface
 *     defined in this lane.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `receivedAt` is injected per request.
 */

import { validateObservationBatch, validateTenantRef } from "@fleetos/contracts";
import type {
  CorrelationId,
  CausationId,
  FleetError,
  IdempotencyKey,
  Observation,
  ObservationBatch,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeAuthorizationError,
  makeConflictError,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { AuditSink, DeviceModelAuditRecord } from "./audit-seam";
import { NOOP_AUDIT_SINK } from "./audit-seam";
import type { TwinStore } from "./store";
import { createInMemoryTwinStore } from "./store";
import type { UnitNormalizationSeam } from "./normalize";
import { IDENTITY_UNIT_NORMALIZER } from "./normalize";
import { reenterTwinObservationCycle, recordTwinObservations } from "./twin";

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

/**
 * A check-in request: the canonical observation batch plus the check-in
 * command's idempotency key and traceability ids. The `tenantId` is the
 * CALLER's tenant scope (the agent's auth context); it MUST match the
 * batch's own tenant scope.
 */
export interface ObservationIngestionRequest extends TenantScoped {
  readonly batch: ObservationBatch;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** ISO 8601 receive timestamp (injected — the service never reads the clock). */
  readonly receivedAt: string;
}

// ---------------------------------------------------------------------------
// Back-pressure
// ---------------------------------------------------------------------------

export type BackPressureStatus = "open" | "pressured" | "shedding";

/**
 * The back-pressure signal surfaced to agents. `pressured` is advisory
 * (admission continues); `shedding` means new batches are being shed.
 */
export interface BackPressureSignal {
  readonly status: BackPressureStatus;
  /** Admitted-but-undrained observations. */
  readonly queueDepth: number;
  readonly maxQueueDepth: number;
  /** Retry hint in milliseconds when pressured/shedding; null when open. */
  readonly retryAfterMs: number | null;
}

// ---------------------------------------------------------------------------
// Acks
// ---------------------------------------------------------------------------

export interface AdmittedAck {
  readonly kind: "admitted";
  /** Events newly admitted by this request. */
  readonly admittedObservations: number;
  /** Events suppressed as already-admitted (event-id dedup). */
  readonly duplicateObservations: number;
  /** The twin's revision AFTER recording the admitted events. */
  readonly twinRevision: number;
  readonly backPressure: BackPressureSignal;
}

export interface DuplicateAck {
  readonly kind: "duplicate";
  /** When the original admission happened (ISO 8601). */
  readonly firstAdmittedAt: string;
  /** The ORIGINAL admission's outcome (returned, not re-executed). */
  readonly admittedObservations: number;
  readonly duplicateObservations: number;
  readonly backPressure: BackPressureSignal;
}

export interface ShedAck {
  readonly kind: "shed";
  readonly backPressure: BackPressureSignal;
}

/** The ack semantics of the boundary. */
export type IngestionAck = AdmittedAck | DuplicateAck | ShedAck;

export type IngestionResult =
  | { ok: true; ack: IngestionAck }
  | { ok: false; error: FleetError };

// ---------------------------------------------------------------------------
// Stable audit action names
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = frozen({
  admitted: "device.observations.admitted",
  duplicateSuppressed: "device.observations.duplicate-suppressed",
  shed: "device.observations.shed",
  rejected: "device.observations.rejected",
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface IngestionServiceOptions {
  /** Twin persistence seam (default: fresh in-memory store). */
  readonly store?: TwinStore;
  /** Audit sink seam (default: no-op sink). */
  readonly auditSink?: AuditSink;
  /** Unit normalization seam applied to admitted payloads (default: identity). */
  readonly unitNormalizer?: UnitNormalizationSeam;
  /** Maximum admitted-but-undrained observations (default: 1000). */
  readonly maxQueueDepth?: number;
  /** Fraction of maxQueueDepth at which the signal turns "pressured" (default: 0.8). */
  readonly pressuredRatio?: number;
  /** Maximum observations per batch (default: 500). */
  readonly maxBatchSize?: number;
  /** Retry hint surfaced on pressured/shedding signals (default: 1000 ms). */
  readonly retryAfterMs?: number;
}

/** The ingestion boundary service. */
export interface ObservationIngestionService {
  /** Ingest one check-in request (validation, idempotency, admission, audit). */
  ingest(request: ObservationIngestionRequest): IngestionResult;
  /** The current back-pressure signal. */
  backPressure(): BackPressureSignal;
  /**
   * Drain up to `count` admitted-but-unprocessed observations (downstream
   * completion). Returns the new queue depth. Negative counts are clamped
   * to zero.
   */
  drain(count: number): number;
  /** The twin store (tenant-scoped queries). */
  readonly store: TwinStore;
}

interface AdmittedBatchRecord {
  readonly canonicalBatch: string;
  readonly firstAdmittedAt: string;
  readonly admittedObservations: number;
  readonly duplicateObservations: number;
  readonly twinRevision: number;
}

/**
 * Create the observation ingestion boundary service.
 *
 * @throws Error when construction options are out of range (programmer
 *   error, not a domain flow): maxQueueDepth < 1, pressuredRatio outside
 *   (0, 1], maxBatchSize < 1, retryAfterMs < 0.
 */
export function createObservationIngestionService(
  options?: IngestionServiceOptions,
): ObservationIngestionService {
  const store = options?.store ?? createInMemoryTwinStore();
  const auditSink = options?.auditSink ?? NOOP_AUDIT_SINK;
  const unitNormalizer = options?.unitNormalizer ?? IDENTITY_UNIT_NORMALIZER;
  const maxQueueDepth = options?.maxQueueDepth ?? 1000;
  const pressuredRatio = options?.pressuredRatio ?? 0.8;
  const maxBatchSize = options?.maxBatchSize ?? 500;
  const retryAfterMs = options?.retryAfterMs ?? 1000;

  if (!Number.isInteger(maxQueueDepth) || maxQueueDepth < 1) {
    throw new Error("createObservationIngestionService: maxQueueDepth must be an integer >= 1");
  }
  if (!(pressuredRatio > 0 && pressuredRatio <= 1)) {
    throw new Error("createObservationIngestionService: pressuredRatio must be in (0, 1]");
  }
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("createObservationIngestionService: maxBatchSize must be an integer >= 1");
  }
  if (!Number.isInteger(retryAfterMs) || retryAfterMs < 0) {
    throw new Error("createObservationIngestionService: retryAfterMs must be an integer >= 0");
  }

  // Batch-level idempotency registry: (tenantId, idempotencyKey) -> outcome.
  const admittedBatches = new Map<string, AdmittedBatchRecord>();
  // Event-level idempotency registry: (tenantId, deviceId, observationId).
  const admittedEvents = new Set<string>();
  let queueDepth = 0;

  const pressuredAt = Math.max(1, Math.ceil(maxQueueDepth * pressuredRatio));

  function currentSignal(): BackPressureSignal {
    const status: BackPressureStatus =
      queueDepth >= maxQueueDepth ? "shedding" : queueDepth >= pressuredAt ? "pressured" : "open";
    return frozen({
      status,
      queueDepth,
      maxQueueDepth,
      retryAfterMs: status === "open" ? null : retryAfterMs,
    });
  }

  function emitAudit(record: DeviceModelAuditRecord): void {
    auditSink.append(record);
  }

  function eventKey(tenantId: TenantId, deviceId: string, observationId: string): string {
    return `${tenantId as string}|${deviceId}|${observationId}`;
  }

  function batchKey(tenantId: TenantId, idempotencyKey: IdempotencyKey): string {
    return `${tenantId as string}|${idempotencyKey as string}`;
  }

  function reject(
    request: ObservationIngestionRequest | undefined,
    error: FleetError,
    batchDigest: string | null,
  ): IngestionResult {
    // Rejection audit is emitted only when the record is attributable
    // (a usable tenant scope + correlation id); structural garbage with
    // no tenant context is not audited through the tenant-scoped seam.
    if (
      request &&
      typeof request.tenantId === "string" &&
      request.tenantId.length > 0 &&
      typeof request.correlationId === "string" &&
      request.correlationId.length > 0
    ) {
      emitAudit(
        frozen({
          tenantId: error.tenantId,
          action: AUDIT_ACTIONS.rejected,
          subject: request.batch?.deviceId ?? null,
          occurredAt: request.receivedAt,
          correlationId: request.correlationId,
          causationId: request.causationId,
          details: { code: error.code, kind: error.kind, batchDigest },
        }),
      );
    }
    return { ok: false, error };
  }

  function ingest(request: ObservationIngestionRequest): IngestionResult {
    // ---- 1. Structural request validation ------------------------------
    const failures: { path: string; reason: string }[] = [];
    if (typeof request?.idempotencyKey !== "string" || request.idempotencyKey.length === 0) {
      failures.push({ path: "/idempotencyKey", reason: "required" });
    }
    if (typeof request?.correlationId !== "string" || request.correlationId.length === 0) {
      failures.push({ path: "/correlationId", reason: "required" });
    }
    if (typeof request?.receivedAt !== "string" || !looksLikeIso(request.receivedAt)) {
      failures.push({ path: "/receivedAt", reason: "not_iso" });
    }
    const tenantCheck = validateTenantRef(request?.tenantId);
    if (!tenantCheck.ok) {
      failures.push({ path: "/tenantId", reason: tenantCheck.reason });
    }
    if (request && request.batch) {
      const batchTenantCheck = validateTenantRef(request.batch.tenantId);
      if (!batchTenantCheck.ok) {
        failures.push({ path: "/batch/tenantId", reason: batchTenantCheck.reason });
      }
    } else {
      failures.push({ path: "/batch", reason: "required" });
    }
    if (failures.length > 0) {
      return reject(
        request,
        makeValidationError(
          ERROR_CODES.ingestionInvalidRequest,
          "observation ingestion request is invalid",
          {
            tenantId: request?.tenantId ?? ("" as TenantId),
            correlationId: request?.correlationId ?? ("" as CorrelationId),
          },
          failures,
        ),
        null,
      );
    }

    const batch = request.batch;
    const canonicalBatch = canonicalJson(batch);
    const batchDigest = fnv1a32Hex(canonicalBatch);
    const trace = { tenantId: request.tenantId, correlationId: request.correlationId };

    // ---- 2. Tenant isolation (action boundary) -------------------------
    if (request.tenantId !== batch.tenantId) {
      return reject(
        request,
        makeAuthorizationError(
          ERROR_CODES.ingestionTenantMismatch,
          "ingestion request tenant scope does not match the batch tenant scope",
          trace,
          request.tenantId as string,
          "device.observations.ingest",
          "tenant_mismatch",
        ),
        batchDigest,
      );
    }

    // ---- 3. Batch validation (frozen contracts invariants + bounds) ----
    const batchValidation = validateObservationBatch(batch);
    if (!batchValidation.ok) {
      const mapped: { path: string; reason: string }[] = [];
      switch (batchValidation.reason) {
        case "missing_device_id":
          mapped.push({ path: "/batch/deviceId", reason: "required" });
          break;
        case "missing_observed_at":
          mapped.push({ path: "/batch/observedAt", reason: "required" });
          break;
        case "observed_at_not_iso":
          mapped.push({ path: "/batch/observedAt", reason: "not_iso" });
          break;
        case "missing_tenant_id":
          mapped.push({ path: "/batch/tenantId", reason: "required" });
          break;
        case "empty_batch":
          mapped.push({ path: "/batch/observations", reason: "empty" });
          break;
        case "bad_observation":
          mapped.push({ path: `/batch/observations/${batchValidation.index ?? 0}`, reason: "bad_observation" });
          break;
      }
      return reject(
        request,
        makeValidationError(
          ERROR_CODES.observationsMalformed,
          "observation batch violates the frozen contracts invariants",
          trace,
          mapped,
        ),
        batchDigest,
      );
    }
    if (batch.observations.length > maxBatchSize) {
      return reject(
        request,
        makeValidationError(
          ERROR_CODES.observationsMalformed,
          `observation batch exceeds the maximum batch size (${maxBatchSize})`,
          trace,
          [{ path: "/batch/observations", reason: "batch_too_large" }],
        ),
        batchDigest,
      );
    }

    // ---- 4. Idempotent admission, batch level --------------------------
    const bKey = batchKey(request.tenantId, request.idempotencyKey);
    const previous = admittedBatches.get(bKey);
    if (previous !== undefined) {
      if (previous.canonicalBatch !== canonicalBatch) {
        return reject(
          request,
          makeConflictError(
            ERROR_CODES.ingestionIdempotencyConflict,
            "idempotency key was already used for a DIFFERENT batch",
            trace,
            `observation-batch:${request.idempotencyKey as string}`,
          ),
          batchDigest,
        );
      }
      // Idempotent replay: return the original outcome — never re-execute.
      emitAudit(
        frozen({
          tenantId: request.tenantId,
          action: AUDIT_ACTIONS.duplicateSuppressed,
          subject: batch.deviceId,
          occurredAt: request.receivedAt,
          correlationId: request.correlationId,
          causationId: request.causationId,
          details: {
            idempotencyKey: request.idempotencyKey,
            batchDigest,
            firstAdmittedAt: previous.firstAdmittedAt,
          },
        }),
      );
      return {
        ok: true,
        ack: frozen({
          kind: "duplicate",
          firstAdmittedAt: previous.firstAdmittedAt,
          admittedObservations: previous.admittedObservations,
          duplicateObservations: previous.duplicateObservations,
          backPressure: currentSignal(),
        }),
      };
    }

    // ---- 5. Back-pressure (shed BEFORE doing admission work) -----------
    const incoming = batch.observations.length;
    if (queueDepth + incoming > maxQueueDepth) {
      const signal = frozen({
        ...currentSignal(),
        status: "shedding" as BackPressureStatus,
        retryAfterMs,
      });
      emitAudit(
        frozen({
          tenantId: request.tenantId,
          action: AUDIT_ACTIONS.shed,
          subject: batch.deviceId,
          occurredAt: request.receivedAt,
          correlationId: request.correlationId,
          causationId: request.causationId,
          details: {
            idempotencyKey: request.idempotencyKey,
            batchDigest,
            queueDepth,
            maxQueueDepth,
          },
        }),
      );
      return { ok: true, ack: frozen({ kind: "shed", backPressure: signal }) };
    }

    // ---- 6. Device lookup (persistence boundary is tenant-scoped) ------
    let twin = store.get(request.tenantId, batch.deviceId);
    if (twin === undefined) {
      return reject(
        request,
        makeDomainError(
          ERROR_CODES.deviceUnknown,
          `device is not enrolled in this tenant: ${batch.deviceId as string}`,
          trace,
          "device.ingestion",
          "device_enrolled",
        ),
        batchDigest,
      );
    }

    // ---- 7. Event-level idempotency + unit seam ------------------------
    const admitted: Observation[] = [];
    let duplicateCount = 0;
    for (const observation of batch.observations) {
      const eKey = eventKey(request.tenantId, batch.deviceId as string, observation.id as string);
      if (admittedEvents.has(eKey)) {
        duplicateCount++;
        continue;
      }
      admittedEvents.add(eKey);
      const normalizedPayload = unitNormalizer.normalizePayload(observation.kind, observation.payload);
      admitted.push(
        frozen({
          ...observation,
          payload: normalizedPayload,
        }),
      );
    }

    // ---- 8. Twin mutation (new revision(s), never in-place) ------------
    let twinRevision = twin.revision;
    if (admitted.length > 0) {
      const recordResult = recordTwinObservations(twin, admitted, {
        at: request.receivedAt,
        correlationId: request.correlationId,
        causationId: request.causationId,
        actor: { kind: "system" },
        reason: "observation check-in",
        evidence: [],
      });
      if (!recordResult.ok) {
        return reject(request, recordResult.error, batchDigest);
      }
      twin = recordResult.twin;
      twinRevision = twin.revision;

      // Close the control loop: a device that has LEARNED re-enters
      // OBSERVE on the next observation cycle (per the frozen contracts
      // lifecycle documentation — the re-entry happens via observation
      // ingestion, not via a table transition).
      if (twin.identity.lifecycleState === "LEARN") {
        const reentry = reenterTwinObservationCycle(twin, {
          at: request.receivedAt,
          correlationId: request.correlationId,
          causationId: request.causationId,
          actor: { kind: "system" },
          reason: "observation-cycle re-entry after LEARN",
          evidence: [],
        });
        if (reentry.ok) {
          twin = reentry.twin;
          twinRevision = twin.revision;
        }
      }

      store.put(twin);
      queueDepth += admitted.length;
    }

    // ---- 9. Register the batch outcome (idempotent replay support) -----
    admittedBatches.set(bKey, {
      canonicalBatch,
      firstAdmittedAt: request.receivedAt,
      admittedObservations: admitted.length,
      duplicateObservations: duplicateCount,
      twinRevision,
    });

    // ---- 10. Audit + ack ------------------------------------------------
    emitAudit(
      frozen({
        tenantId: request.tenantId,
        action: AUDIT_ACTIONS.admitted,
        subject: batch.deviceId,
        occurredAt: request.receivedAt,
        correlationId: request.correlationId,
        causationId: request.causationId,
        details: {
          idempotencyKey: request.idempotencyKey,
          batchDigest,
          admittedObservations: admitted.length,
          duplicateObservations: duplicateCount,
          twinRevision,
        },
      }),
    );

    return {
      ok: true,
      ack: frozen({
        kind: "admitted",
        admittedObservations: admitted.length,
        duplicateObservations: duplicateCount,
        twinRevision,
        backPressure: currentSignal(),
      }),
    };
  }

  return frozen({
    ingest,
    backPressure: currentSignal,
    drain(count: number): number {
      const effective = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      queueDepth = Math.max(0, queueDepth - effective);
      return queueDepth;
    },
    get store(): TwinStore {
      return store;
    },
  });
}
