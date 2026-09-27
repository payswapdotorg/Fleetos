/**
 * @fleetos/device-adapters — D3: Agent-side observation batching.
 *
 * An agent-side observation collector that assembles valid
 * `ObservationBatch` values (the frozen contracts shape) for check-in
 * delivery. The producer NEVER emits a batch the contracts' invariants
 * would reject: every batch is validated by `validateObservationBatch`
 * before emission, and a producer that cannot construct a valid batch
 * returns an error result instead.
 *
 * Sequencing: each observation receives a deterministic,
 * monotonically-increasing `ObservationId` of the form
 * `<deviceId-seed>-seq-<n>`. The sequence counter is owned by the
 * collector and is reset on `flush`. The agent may inject its own
 * sequencing seed (e.g. a per-boot nonce) to disambiguate across
 * restarts.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  asIdempotencyKey,
  asObservationId,
  validateObservationBatch,
  type CorrelationId,
  type DeviceId,
  type IdempotencyKey,
  type Observation,
  type ObservationBatch,
  type ObservationId,
  type ObservationKind,
  type TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  isJsonSerializable,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D3.1 — Observation record (input shape)
// ---------------------------------------------------------------------------

/**
 * The input shape the agent records. The collector assigns the
 * observation `id` (deterministic sequencing) and assembles the batch
 * `observedAt` (injected at flush time).
 *
 * `kind` is the open `ObservationKind` union from contracts. `payload`
 * is any JSON-serializable value. `schemaVersion` is the payload schema
 * version (>= 1). `observedAt` is the per-observation ISO 8601 timestamp
 * (injected by the caller — never the system clock).
 */
export interface ObservationRecord {
  /** Observation kind (open union). */
  readonly kind: ObservationKind;
  /** ISO 8601 timestamp of when the observation was made on the device. */
  readonly observedAt: string;
  /** Schema version of the payload (>= 1). */
  readonly schemaVersion: number;
  /** The observation payload (kind-specific; JSON-serializable). */
  readonly payload: unknown;
}

// ---------------------------------------------------------------------------
// D3.2 — Collector options
// ---------------------------------------------------------------------------

/**
 * Options for `createObservationCollector`.
 */
export interface ObservationCollectorOptions extends TenantScoped {
  /** The device that produces the observations. */
  readonly deviceId: DeviceId;
  /**
   * A seed string baked into the deterministic `ObservationId`. Defaults
   * to the deviceId. The agent may inject a per-boot nonce to
   * disambiguate observations across restarts.
   */
  readonly idSeed?: string;
  /** The starting sequence number (default: 1). */
  readonly startSeq?: number;
  /** Maximum observations per batch (default: 500). */
  readonly maxBatchSize?: number;
}

// ---------------------------------------------------------------------------
// D3.3 — Collector interface
// ---------------------------------------------------------------------------

/**
 * The result of recording an observation. The collector assigns the
 * observation id and returns it for traceability.
 */
export type RecordResult =
  | { ok: true; id: ObservationId; seq: number }
  | { ok: false; reason: "bad_record" | "batch_full"; field?: string };

/**
 * The result of flushing a batch. Either a valid-by-construction
 * `ObservationBatch` (re-validated against the frozen invariants) or an
 * error mapped onto the FleetError taxonomy.
 */
export type FlushResult =
  | { ok: true; batch: ObservationBatch; count: number; digest: string }
  | { ok: false; error: ReturnType<typeof makeValidationError> | ReturnType<typeof makeDomainError> };

/**
 * The agent-side observation collector. Records observations, assembles
 * valid batches, and exposes the pending count for back-pressure
 * decisions.
 */
export interface ObservationCollector {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device id. */
  readonly deviceId: DeviceId;
  /** The id seed used for deterministic observation ids. */
  readonly idSeed: string;
  /** Record an observation; returns the assigned id and seq. */
  record(observation: ObservationRecord): RecordResult;
  /** Number of observations waiting for the next flush. */
  pending(): number;
  /**
   * Flush a batch of pending observations. Returns a valid-by-construction
   * `ObservationBatch` or an error. After a successful flush, the
   * collector's pending count is zero.
   *
   * @param observedAt ISO 8601 timestamp of batch assembly (injected)
   * @param correlationId optional correlation id for traceability on the
   *   error path (the `ObservationBatch` shape itself does not carry one)
   */
  flush(observedAt: string, correlationId?: CorrelationId): FlushResult;
  /**
   * Drop all pending observations without emitting a batch. Used when
   * the agent decides to discard (e.g. on shutdown). Returns the number
   * dropped.
   */
  discard(): number;
}

// ---------------------------------------------------------------------------
// D3.4 — Factory
// ---------------------------------------------------------------------------

/**
 * Create an agent-side observation collector.
 *
 * The collector is tenant-scoped and device-scoped; it assigns
 * deterministic observation ids of the form `<idSeed>-seq-<n>` where
 * `n` starts at `startSeq` (default: 1) and increments by 1 per
 * observation. The same `(idSeed, seq)` pair produces the same
 * observation id every run (determinism).
 *
 * The collector NEVER emits a batch the contracts' invariants would
 * reject: `flush()` validates the assembled batch with
 * `validateObservationBatch` before returning it; on validation failure
 * (which would indicate a programmer error in the collector itself),
 * `flush()` returns an error result and the pending observations are
 * preserved for diagnostics.
 *
 * @throws Error when construction options are out of range (programmer
 *   error, not a domain flow): maxBatchSize < 1, startSeq < 1.
 */
export function createObservationCollector(
  options: ObservationCollectorOptions,
): ObservationCollector {
  const idSeed = options.idSeed ?? (options.deviceId as string);
  const startSeq = options.startSeq ?? 1;
  const maxBatchSize = options.maxBatchSize ?? 500;

  if (!Number.isInteger(startSeq) || startSeq < 1) {
    throw new Error("createObservationCollector: startSeq must be an integer >= 1");
  }
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("createObservationCollector: maxBatchSize must be an integer >= 1");
  }

  let seq = startSeq;
  let pendingObs: Observation[] = [];

  function record(observation: ObservationRecord): RecordResult {
    if (!observation || typeof observation !== "object") {
      return { ok: false, reason: "bad_record", field: "/" };
    }
    if (typeof observation.kind !== "string" || observation.kind.length === 0) {
      return { ok: false, reason: "bad_record", field: "/kind" };
    }
    if (typeof observation.observedAt !== "string" || !looksLikeIso(observation.observedAt)) {
      return { ok: false, reason: "bad_record", field: "/observedAt" };
    }
    if (typeof observation.schemaVersion !== "number" || observation.schemaVersion < 1) {
      return { ok: false, reason: "bad_record", field: "/schemaVersion" };
    }
    if (!isJsonSerializable(observation.payload)) {
      return { ok: false, reason: "bad_record", field: "/payload" };
    }
    if (pendingObs.length >= maxBatchSize) {
      return { ok: false, reason: "batch_full" };
    }
    const id = asObservationId(`${idSeed}-seq-${seq}`);
    const frozenObs: Observation = frozen({
      id,
      kind: observation.kind,
      observedAt: observation.observedAt,
      schemaVersion: observation.schemaVersion,
      payload: observation.payload,
    });
    pendingObs.push(frozenObs);
    const assignedSeq = seq;
    seq += 1;
    return { ok: true, id, seq: assignedSeq };
  }

  function flush(observedAt: string, correlationId?: CorrelationId): FlushResult {
    const trace: ErrorTrace = {
      tenantId: options.tenantId,
      correlationId: (correlationId ?? "") as CorrelationId,
    };
    if (typeof observedAt !== "string" || !looksLikeIso(observedAt)) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.observationsMalformed,
          "observation batch observedAt is not ISO 8601",
          trace,
          [{ path: "/observedAt", reason: "not_iso" }],
        ),
      };
    }
    if (pendingObs.length === 0) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.observationsMalformed,
          "observation batch is empty (nothing to flush)",
          trace,
          "device-adapters.observations",
          "empty_flush",
        ),
      };
    }
    const batch: ObservationBatch = frozen({
      deviceId: options.deviceId,
      observedAt,
      tenantId: options.tenantId,
      observations: frozenArray(pendingObs),
    });
    const validation = validateObservationBatch(batch);
    if (!validation.ok) {
      // This branch is a programmer-error indicator: the collector itself
      // assembled an invalid batch. We surface it as a ValidationError so
      // the runtime can log and route it; the pending observations are
      // preserved for diagnostics.
      const field =
        validation.reason === "bad_observation"
          ? `/observations/${validation.index ?? 0}`
          : "/";
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.observationsMalformed,
          `observation batch violates the frozen contracts invariants: ${validation.reason}`,
          trace,
          [{ path: field, reason: validation.reason }],
        ),
      };
    }
    const digest = fnv1a32Hex(canonicalJson(batch));
    const count = pendingObs.length;
    pendingObs = [];
    return { ok: true, batch, count, digest };
  }

  return frozen({
    tenantId: options.tenantId,
    deviceId: options.deviceId,
    idSeed,
    record,
    pending: () => pendingObs.length,
    flush,
    discard: () => {
      const dropped = pendingObs.length;
      pendingObs = [];
      return dropped;
    },
  }) as ObservationCollector;
}

// ---------------------------------------------------------------------------
// D3.5 — Idempotent batch admission helper (producer-side)
// ---------------------------------------------------------------------------

/**
 * The idempotency key for an observation batch — derived deterministically
 * from the batch's canonical JSON. Two batches with the same content
 * produce the same idempotency key; the control plane deduplicates on
 * `(tenantId, idempotencyKey)` per the frozen contracts idempotency
 * contract.
 *
 * The agent runtime MAY use this helper to assign an idempotency key to
 * a check-in command carrying an observation batch.
 */
export function deriveBatchIdempotencyKey(
  batch: ObservationBatch,
): IdempotencyKey {
  const digest = fnv1a32Hex(canonicalJson(batch));
  return asIdempotencyKey(`${batch.deviceId as string}|${digest}`);
}
