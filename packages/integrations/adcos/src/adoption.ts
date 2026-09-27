/**
 * @fleetos/integration-adcos — D3d: the normalized connectivity record
 * store + the status-adoption and termination flows.
 *
 * Adopting an ADCOS-reported status/degradation into a FleetOS-visible
 * record is a VERSIONED APPEND-ONLY record: every adoption appends
 * revision prior+1 with a deterministic content digest; a prior revision
 * is NEVER rewritten. The revision chain is hash-linked
 * (`priorDigest`), so tampering is detectable. Adoption is IDEMPOTENT by
 * report content: the content digest covers the report-derived facets
 * (accepted requirements, execution state, measurements, degradation,
 * failure, termination — NOT the adoption instant), so re-adopting the
 * same report content returns the current head without appending
 * (deterministic replay — nothing re-executes, nothing re-audits).
 *
 * The record is bound to the submission that created it (intent ref +
 * request digest carried through), so every FleetOS-visible connectivity
 * fact traces back to the gated proposal that produced it.
 *
 * Tenant isolation is BY CONSTRUCTION (the W012 pattern): every
 * operation takes the acting `AdcosTenantScope` FIRST; storage is
 * partitioned per tenant; a foreign connectivity id is indistinguishable
 * from an unknown one.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DomainError, TenantId, TenantScoped } from "@fleetos/contracts";
import type { ConnectivityIntentRef } from "./request-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { isProviderNeutral } from "./provider-boundary";
import type {
  AcceptedConnectivityRequirements,
  AdcosStatusReport,
  ConnectivityClassification,
  ConnectivityExecutionState,
  ConnectivityMeasurement,
  ConnectivityTermination,
} from "./status-model";
import { validateStatusReport } from "./status-model";
import type { AdcosTransportPort } from "./transport-seam";
import type { AdcosAuditSink } from "./audit-seam";
import { ADCOS_AUDIT_ACTIONS } from "./audit-seam";
import {
  ADCOS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  frozen,
  frozenArray,
  fnv1a32Hex,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { AdcosTenantScope, ErrorTrace } from "./internal";
import { checkAdcosTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The revision model (append-only, deterministic digests)
// ---------------------------------------------------------------------------

/** A single append-only revision of a normalized connectivity record. */
export interface ConnectivityRecordRevision {
  /** The revision number (1-based; prior + 1 on every adoption). */
  readonly revision: number;
  /** The injected adoption instant (ISO 8601 — no clock reads). */
  readonly adoptedAt: string;
  /** The accepted-requirements echo (typed, validated). */
  readonly acceptedRequirements: Readonly<AcceptedConnectivityRequirements>;
  /** The execution state (typed lifecycle). */
  readonly executionState: ConnectivityExecutionState;
  /** Evidence-carrying measurements (typed; deterministic order). */
  readonly measurements: readonly ConnectivityMeasurement[];
  /** The degradation classification (machine-stable taxonomy). */
  readonly degradation: Readonly<ConnectivityClassification>;
  /** The failure classification (machine-stable taxonomy). */
  readonly failure: Readonly<ConnectivityClassification>;
  /** The termination record (present iff executionState is TERMINATED). */
  readonly termination: ConnectivityTermination | null;
  /** The deterministic content digest of the report-derived facets. */
  readonly contentDigest: string;
  /** The prior revision's digest (hash-linked chain; null on revision 1). */
  readonly priorDigest: string | null;
}

/** The normalized connectivity record aggregate (append-only revisions). */
export interface ConnectivityRecord extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The provider-assigned connectivity contract id (opaque). */
  readonly connectivityId: string;
  /** The opaque provider handle (status fetches / termination). */
  readonly handle: AdcosProviderHandle;
  /** Traceability to the originating intent (when bound to a submission). */
  readonly intentRef: Readonly<ConnectivityIntentRef> | null;
  /** The translated request's digest (when bound to a submission). */
  readonly requestDigest: string | null;
  /** The current execution state (the last revision's state). */
  readonly executionState: ConnectivityExecutionState;
  /** The append-only revision chain (never rewritten). */
  readonly revisions: readonly ConnectivityRecordRevision[];
}

// ---------------------------------------------------------------------------
// The revision content digest (report-derived facets only)
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic content digest of a report's adoption
 * content: the accepted requirements, execution state, measurements,
 * degradation, failure and termination — NOT the adoption instant or the
 * revision number. Two reports with identical content produce identical
 * digests regardless of when they are adopted — the idempotency basis.
 */
export function adoptionContentDigest(
  report: Pick<
    AdcosStatusReport,
    | "connectivityId"
    | "executionState"
    | "acceptedRequirements"
    | "measurements"
    | "degradation"
    | "failure"
    | "termination"
  >,
): string {
  return fnv1a32Hex(
    canonicalJson({
      connectivityId: report.connectivityId,
      executionState: report.executionState,
      acceptedRequirements: report.acceptedRequirements,
      measurements: report.measurements,
      degradation: report.degradation,
      failure: report.failure,
      termination: report.termination,
    }),
  );
}

// ---------------------------------------------------------------------------
// The unmet-requirements diff (pure, machine-stable)
// ---------------------------------------------------------------------------

/**
 * Diff a translated request against the provider's accepted requirements
 * — the machine-stable list of requirement paths the acceptance FAILS to
 * satisfy (empty = the acceptance fully covers the request). Pure and
 * deterministic; comparison semantics (the acceptance must be
 * at-least-as-strong as the request):
 *
 *   - numeric upper bounds (`maxLatencyMs`, `maxPathHops`): accepted <= requested;
 *   - numeric lower bounds (`minThroughputMbps`, `availabilityTarget`): accepted >= requested;
 *   - `isolation`: accepted === requested (a private request is only met by private);
 *   - `redundancy`: accepted rank >= requested rank (none < path < device);
 *   - zones: every required zone accepted; every forbidden zone still forbidden;
 *   - `egressAllowed`: a no-egress request is only met by a no-egress acceptance;
 *   - duration: accepted starts no later; a bounded request keeps its end bound;
 *   - security: required encryption/private routing stay required; compliance refs kept.
 *
 * The diff is SURFACING sugar (recorded on revisions by callers that want
 * it) — adoption itself records the acceptance verbatim, never re-gates.
 */
export function unmetRequirements(
  request: import("./request-model").AdcosConnectivityRequest,
  accepted: Readonly<AcceptedConnectivityRequirements>,
): readonly string[] {
  const unmet: string[] = [];
  const redundancyRank: Record<string, number> = { none: 0, path_redundant: 1, device_redundant: 2 };

  if (request.outcome.canonical !== accepted.outcome) {
    unmet.push("/outcome");
  }
  const wanted = request.properties;
  const got = accepted.properties;
  if (wanted.maxLatencyMs !== undefined && (got.maxLatencyMs === undefined || got.maxLatencyMs > wanted.maxLatencyMs)) {
    unmet.push("/properties/maxLatencyMs");
  }
  if (
    wanted.minThroughputMbps !== undefined &&
    (got.minThroughputMbps === undefined || got.minThroughputMbps < wanted.minThroughputMbps)
  ) {
    unmet.push("/properties/minThroughputMbps");
  }
  if (
    wanted.availabilityTarget !== undefined &&
    (got.availabilityTarget === undefined || got.availabilityTarget < wanted.availabilityTarget)
  ) {
    unmet.push("/properties/availabilityTarget");
  }
  if (wanted.isolation !== got.isolation) {
    unmet.push("/properties/isolation");
  }
  if ((redundancyRank[got.redundancy] ?? -1) < (redundancyRank[wanted.redundancy] ?? -1)) {
    unmet.push("/properties/redundancy");
  }
  for (const zone of request.constraints.requiredZones) {
    if (!accepted.constraints.requiredZones.includes(zone)) {
      unmet.push(`/constraints/requiredZones/${zone}`);
    }
  }
  for (const zone of request.constraints.forbiddenZones) {
    if (!accepted.constraints.forbiddenZones.includes(zone)) {
      unmet.push(`/constraints/forbiddenZones/${zone}`);
    }
  }
  if (
    request.constraints.maxPathHops !== undefined &&
    (accepted.constraints.maxPathHops === undefined ||
      accepted.constraints.maxPathHops > request.constraints.maxPathHops)
  ) {
    unmet.push("/constraints/maxPathHops");
  }
  if (!request.constraints.egressAllowed && accepted.constraints.egressAllowed) {
    unmet.push("/constraints/egressAllowed");
  }
  if (request.security.encryption === "required" && accepted.security.encryption !== "required") {
    unmet.push("/security/encryption");
  }
  if (request.security.privateRouting && !accepted.security.privateRouting) {
    unmet.push("/security/privateRouting");
  }
  for (const ref of request.security.complianceRefs) {
    if (!accepted.security.complianceRefs.includes(ref)) {
      unmet.push(`/security/complianceRefs/${ref}`);
    }
  }
  // Duration: accepted starts no later than requested.
  if (Date.parse(accepted.duration.startAt) > Date.parse(request.duration.startAt)) {
    unmet.push("/duration/startAt");
  }
  if (request.duration.endAt !== undefined) {
    if (accepted.duration.endAt === undefined) {
      unmet.push("/duration/endAt");
    } else if (Date.parse(accepted.duration.endAt) < Date.parse(request.duration.endAt)) {
      unmet.push("/duration/endAt");
    }
  }
  return frozenArray(unmet.sort());
}

// ---------------------------------------------------------------------------
// The tenant-partitioned in-memory record store
// ---------------------------------------------------------------------------

/** The result of a record-store operation — tagged, machine-stable. */
export type RecordStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

function storeError(code: string, message: string, trace: ErrorTrace, invariant: string): DomainError {
  return makeDomainError(code, message, trace, "adcos.adoption.store", invariant);
}

/**
 * The tenant-partitioned connectivity record store. Every operation
 * takes the acting `AdcosTenantScope` FIRST; partitions are per-tenant;
 * a foreign connectivity id is indistinguishable from an unknown one
 * (both return `not_found`).
 */
export interface AdcosConnectivityRecordStore {
  /** Seed a new record (revision 1) for a submitted connectivity. */
  seed(scope: AdcosTenantScope, record: ConnectivityRecord): RecordStoreResult<ConnectivityRecord>;
  /** Fetch a record under the ACTING tenant (foreign ids are not_found). */
  get(scope: AdcosTenantScope, connectivityId: string): RecordStoreResult<ConnectivityRecord>;
  /** Replace the aggregate after an appended revision (internal to the flows). */
  store(scope: AdcosTenantScope, record: ConnectivityRecord): RecordStoreResult<ConnectivityRecord>;
  /** The acting tenant's records, in connectivity-id order. */
  list(scope: AdcosTenantScope): readonly ConnectivityRecord[];
}

/** Create the in-memory tenant-partitioned connectivity record store. */
export function createInMemoryConnectivityRecordStore(): AdcosConnectivityRecordStore {
  /** tenantId -> (connectivityId -> record). */
  const partitions = new Map<string, Map<string, ConnectivityRecord>>();

  function partitionOf(tenantId: TenantId): Map<string, ConnectivityRecord> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guard(
    scope: AdcosTenantScope,
  ): { ok: true; tenantId: TenantId } | { ok: false; error: DomainError } {
    const check = checkAdcosTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: storeError(
          ERROR_CODES.storeDomain,
          `connectivity record store refused: ${check.reason}`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ADCOS_PIPELINE_CORRELATION_ID },
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    seed(scope, record) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      if (partition.has(record.connectivityId)) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.storeDomain,
            "connectivity record store refused: duplicate connectivity id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID },
            "duplicate_connectivity",
          ),
        };
      }
      partition.set(record.connectivityId, record);
      return { ok: true, value: record };
    },
    get(scope, connectivityId) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      const existing = partition.get(connectivityId);
      if (existing === undefined) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.adoptionNotFound,
            "connectivity record store refused: unknown connectivity id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID },
            "not_found",
          ),
        };
      }
      return { ok: true, value: existing };
    },
    store(scope, record) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      if (!partition.has(record.connectivityId)) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.adoptionNotFound,
            "connectivity record store refused: unknown connectivity id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID },
            "not_found",
          ),
        };
      }
      partition.set(record.connectivityId, record);
      return { ok: true, value: record };
    },
    list(scope) {
      const checked = guard(scope);
      if (!checked.ok) return [];
      const partition = partitionOf(checked.tenantId);
      return frozenArray(
        [...partition.values()].sort((a, b) => (a.connectivityId < b.connectivityId ? -1 : 1)),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// The adoption flow (D3d)
// ---------------------------------------------------------------------------

/** Options for `adoptConnectivityStatus`. */
export interface AdoptStatusOptions {
  /** The injected adoption instant (ISO 8601 — no clock reads). */
  readonly at: string;
  readonly auditSink?: AdcosAuditSink;
}

/** The tagged adoption result. */
export type AdoptionResult =
  | {
      readonly ok: true;
      readonly record: ConnectivityRecord;
      /** True when the report content was already the head (idempotent replay). */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: DomainError | import("@fleetos/contracts").ValidationError };

/**
 * Adopt a provider-reported status into the FleetOS-visible record —
 * the D3d versioned append-only flow:
 *
 *   1. the report crosses the provider-neutral boundary check (a
 *      non-neutral value — SDK object, function, provider-metadata key —
 *      is refused with `provider_boundary`, never recorded);
 *   2. the report is validated + normalized (machine-stable failures);
 *   3. the connectivity must be KNOWN to the acting tenant (a foreign
 *      or unknown id is refused with `not_found` — indistinguishable);
 *   4. the report's handle must match the record's handle (`handle_mismatch`);
 *   5. a NEW revision is appended (prior+1, deterministic content
 *      digest, hash-linked `priorDigest`) — or the adoption is an
 *      IDEMPOTENT REPLAY when the head already carries the same content
 *      digest (no append, no audit);
 *   6. consequential mutations audit: `adcos.status.adopted` for every
 *      appended revision, plus `adcos.degradation.recorded` when the
 *      revision carries a degradation and `adcos.termination.adopted`
 *      when it carries a termination.
 */
export function adoptConnectivityStatus(
  scope: AdcosTenantScope,
  store: AdcosConnectivityRecordStore,
  report: unknown,
  opts: AdoptStatusOptions,
): AdoptionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        `adoption refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ADCOS_PIPELINE_CORRELATION_ID },
        "adcos.adoption",
        tenantCheck.reason,
      ),
    };
  }
  const trace: ErrorTrace = {
    tenantId: tenantCheck.tenantId,
    correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
  };

  // 1. The provider-neutral boundary (D2, enforced at runtime).
  const neutrality = isProviderNeutral(report);
  if (!neutrality.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reportInvalid,
        "adoption refused: the report violates the provider-neutral boundary",
        trace,
        [{ path: neutrality.path, reason: "provider_boundary" }],
      ),
    };
  }

  // 2. Validate + normalize the report.
  const validation = validateStatusReport(report);
  if (!validation.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reportInvalid,
        "adoption refused: the status report is malformed",
        trace,
        validation.failures,
      ),
    };
  }
  const normalized = validation.report;

  // 3. The connectivity must be known to the ACTING tenant.
  const existing = store.get(scope, normalized.connectivityId);
  if (!existing.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionNotFound,
        "adoption refused: unknown connectivity id",
        trace,
        "adcos.adoption",
        "not_found",
      ),
    };
  }
  const record = existing.value;

  // 4. The handle must match.
  if (record.handle !== normalized.handle) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        "adoption refused: report handle does not match the record handle",
        trace,
        "adcos.adoption",
        "handle_mismatch",
      ),
    };
  }

  // 5. Idempotent replay check: identical report content -> no append.
  const digest = adoptionContentDigest(normalized);
  const head = record.revisions[record.revisions.length - 1];
  if (head !== undefined && head.contentDigest === digest) {
    return { ok: true, record, replayed: true };
  }

  // Append revision prior+1 (hash-linked).
  const revision: ConnectivityRecordRevision = frozen({
    revision: record.revisions.length + 1,
    adoptedAt: opts.at,
    acceptedRequirements: normalized.acceptedRequirements,
    executionState: normalized.executionState,
    measurements: normalized.measurements,
    degradation: normalized.degradation,
    failure: normalized.failure,
    termination: normalized.termination,
    contentDigest: digest,
    priorDigest: head === undefined ? null : head.contentDigest,
  });
  const updated: ConnectivityRecord = frozen({
    ...record,
    executionState: revision.executionState,
    revisions: frozenArray([...record.revisions, revision]),
  });
  const stored = store.store(scope, updated);
  if (!stored.ok) {
    return { ok: false, error: stored.error };
  }

  // 6. Audit the consequential mutations.
  const sink = opts.auditSink;
  if (sink !== undefined) {
    sink.append(
      frozen({
        action: ADCOS_AUDIT_ACTIONS.statusAdopted,
        tenantId: record.tenantId,
        subject: record.connectivityId,
        occurredAt: opts.at,
        correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
        details: {
          revision: revision.revision,
          executionState: revision.executionState,
          contentDigest: revision.contentDigest,
          intentId: record.intentRef?.intentId ?? null,
          measurementCount: revision.measurements.length,
        },
      }),
    );
    if (revision.degradation.kind !== "none") {
      sink.append(
        frozen({
          action: ADCOS_AUDIT_ACTIONS.degradationRecorded,
          tenantId: record.tenantId,
          subject: record.connectivityId,
          occurredAt: opts.at,
          correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
          details: {
            revision: revision.revision,
            degradationKind: revision.degradation.kind,
            degradationDetail: revision.degradation.detail ?? null,
            executionState: revision.executionState,
          },
        }),
      );
    }
    if (revision.termination !== null) {
      sink.append(
        frozen({
          action: ADCOS_AUDIT_ACTIONS.terminationAdopted,
          tenantId: record.tenantId,
          subject: record.connectivityId,
          occurredAt: opts.at,
          correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
          details: {
            revision: revision.revision,
            terminationReason: revision.termination.reason,
            terminatedAt: revision.termination.terminatedAt,
          },
        }),
      );
    }
  }

  return { ok: true, record: updated, replayed: false };
}

// ---------------------------------------------------------------------------
// The fetch + adopt flow (composed)
// ---------------------------------------------------------------------------

/** Options for `syncConnectivityStatus`. */
export interface SyncStatusOptions extends AdoptStatusOptions {
  /** The correlation id of the sync request. */
  readonly correlationId?: import("@fleetos/contracts").CorrelationId;
}

/**
 * Fetch the current provider-side status for a known connectivity and
 * adopt it: the acting-tenant record is looked up (foreign/unknown ids
 * are `not_found` — indistinguishable), the handle is fetched through
 * the injected transport (an unknown handle is `unknown_handle`), and
 * the report is adopted (the D3d append-only flow above).
 */
export function syncConnectivityStatus(
  scope: AdcosTenantScope,
  store: AdcosConnectivityRecordStore,
  transport: AdcosTransportPort,
  connectivityId: string,
  opts: SyncStatusOptions,
): AdoptionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        `status sync refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ADCOS_PIPELINE_CORRELATION_ID },
        "adcos.adoption",
        tenantCheck.reason,
      ),
    };
  }
  const trace: ErrorTrace = {
    tenantId: tenantCheck.tenantId,
    correlationId: opts.correlationId ?? scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
  };
  const existing = store.get(scope, connectivityId);
  if (!existing.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionNotFound,
        "status sync refused: unknown connectivity id",
        trace,
        "adcos.adoption",
        "not_found",
      ),
    };
  }
  const report = transport.fetchStatus(existing.value.handle, {
    at: opts.at,
    correlationId: opts.correlationId ?? scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
  });
  if (report === null) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        "status sync refused: the provider reports no status for this handle",
        trace,
        "adcos.adoption",
        "unknown_handle",
      ),
    };
  }
  return adoptConnectivityStatus(scope, store, report, opts);
}

// ---------------------------------------------------------------------------
// The termination flow
// ---------------------------------------------------------------------------

/** Options for `terminateConnectivity`. */
export interface TerminateOptions {
  /** The injected termination instant (ISO 8601 — no clock reads). */
  readonly at: string;
  /** The correlation id of the termination request (defaults to the scope's). */
  readonly correlationId?: import("@fleetos/contracts").CorrelationId;
  readonly auditSink?: AdcosAuditSink;
}

/**
 * Request tenant-initiated termination of a known connectivity: the
 * acting-tenant record is looked up (foreign/unknown ids are
 * `not_found` — indistinguishable), termination is requested through
 * the injected transport, and the provider's final report is adopted
 * (the D3d append-only flow). A provider refusal is returned as a
 * machine-stable error carrying the refusal verbatim. The termination
 * request itself audits (`adcos.termination.requested`) — a tenant
 * severing connectivity is consequential.
 */
export function terminateConnectivity(
  scope: AdcosTenantScope,
  store: AdcosConnectivityRecordStore,
  transport: AdcosTransportPort,
  connectivityId: string,
  opts: TerminateOptions,
): AdoptionResult {
  const tenantCheck = checkAdcosTenantScope(scope);
  if (!tenantCheck.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        `termination refused: ${tenantCheck.reason}`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ADCOS_PIPELINE_CORRELATION_ID },
        "adcos.adoption",
        tenantCheck.reason,
      ),
    };
  }
  const trace: ErrorTrace = {
    tenantId: tenantCheck.tenantId,
    correlationId: scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID,
  };
  const existing = store.get(scope, connectivityId);
  if (!existing.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionNotFound,
        "termination refused: unknown connectivity id",
        trace,
        "adcos.adoption",
        "not_found",
      ),
    };
  }
  const record = existing.value;
  const terminationCorrelationId =
    opts.correlationId ?? scope.correlationId ?? ADCOS_PIPELINE_CORRELATION_ID;

  const ack = transport.terminate(record.handle, {
    at: opts.at,
    correlationId: terminationCorrelationId,
  });
  if (!ack.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.adoptionInvalid,
        `termination refused by the provider: ${ack.refusal.reason}`,
        trace,
        "adcos.adoption",
        ack.refusal.reason,
      ),
    };
  }

  if (opts.auditSink !== undefined) {
    opts.auditSink.append(
      frozen({
        action: ADCOS_AUDIT_ACTIONS.terminationRequested,
        tenantId: record.tenantId,
        subject: record.connectivityId,
        occurredAt: opts.at,
        correlationId: terminationCorrelationId,
        details: { handlePresent: true, connectivityId: record.connectivityId },
      }),
    );
  }

  return adoptConnectivityStatus(scope, store, ack.finalReport, opts);
}
