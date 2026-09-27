/**
 * @fleetos/integration-adcos — D3b: the connectivity submission record
 * model + the tenant-partitioned store.
 *
 * The durable record of a policy-gated ADCOS connectivity submission.
 * The FROZEN `ConnectivityIntentPayload` from `@fleetos/contracts`
 * (`sourceDeviceId?`, `targetDeviceId?`, `outcome`) is consumed VERBATIM
 * through the D1 translation (the translated `AdcosConnectivityRequest`
 * rides the record); the record additionally carries the full policy
 * context per the consequential-action discipline: the FROZEN
 * `GuardianDecision`, the matched rule refs and the machine-stable
 * evaluation reasons.
 *
 * Status lifecycle (typed, machine-stable):
 *
 *   PROPOSED  -> SUBMITTED | PARKED | REJECTED
 *   PARKED    -> APPROVED | REJECTED
 *   APPROVED  -> SUBMITTED | REJECTED
 *   SUBMITTED -> (terminal for the submission record; the lifecycle
 *                 continues on the adopted connectivity record)
 *   REJECTED  -> (terminal)
 *
 *   - PROPOSED  — the translated request opened a proposal (revision 1).
 *   - SUBMITTED — the Guardian decision was ALLOW/WARN (or a human
 *     approved a parked request) AND the provider accepted the dispatch;
 *     the opaque handle + connectivity id are recorded.
 *   - PARKED    — the Guardian decision was REQUIRE_APPROVAL; the
 *     submission is held for human approval (the parked -> approved/
 *     rejected transitions are recorded as revisions).
 *   - APPROVED  — a human approved a parked submission (the explicit
 *     grant); dispatch follows immediately.
 *   - REJECTED  — the Guardian decision was BLOCK (machine-stable
 *     reasons carried verbatim), OR the evaluation itself failed, OR a
 *     human rejected a parked request, OR the provider refused the
 *     dispatch (the typed provider refusal carried verbatim).
 *
 * Records are append-only and versioned: every transition appends
 * revision prior+1 with a deterministic content digest; a prior revision
 * is NEVER rewritten (versioned-interpretation discipline).
 *
 * Submission identity is DETERMINISTIC: the submission id is an FNV-1a
 * digest of (tenantId, intentId, requestDigest) — resubmitting the same
 * intent with the same requirements REPLAYS the existing record
 * (idempotent — never re-evaluates, never re-dispatches).
 *
 * Tenant isolation is BY CONSTRUCTION (the W012 pattern): every
 * operation takes the acting `AdcosTenantScope` FIRST; storage is
 * partitioned per tenant; a foreign submission id is indistinguishable
 * from an unknown one.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DomainError,
  FleetError,
  GuardianDecision,
  TenantId,
  TenantScoped,
} from "@fleetos/contracts";
import type { AdcosConnectivityRequest } from "./request-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import type { AdcosProviderRefusal } from "./transport-seam";
import type {
  AdcosEvaluationReason,
  AdcosMatchedRuleRef,
} from "./policy-seam";
import {
  ADCOS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";
import type { AdcosTenantScope, ErrorTrace } from "./internal";
import { checkAdcosTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The typed status lifecycle
// ---------------------------------------------------------------------------

export const SUBMISSION_PROPOSED = "PROPOSED" as const;
export const SUBMISSION_SUBMITTED = "SUBMITTED" as const;
export const SUBMISSION_PARKED = "PARKED" as const;
export const SUBMISSION_APPROVED = "APPROVED" as const;
export const SUBMISSION_REJECTED = "REJECTED" as const;

/** The status of a connectivity submission (machine-stable). */
export type ConnectivitySubmissionStatus =
  | typeof SUBMISSION_PROPOSED
  | typeof SUBMISSION_SUBMITTED
  | typeof SUBMISSION_PARKED
  | typeof SUBMISSION_APPROVED
  | typeof SUBMISSION_REJECTED;

/**
 * The typed transition table. PROPOSED transitions only via the Guardian
 * decision (the D3 gate); PARKED transitions only via the human
 * approval step; APPROVED transitions only via dispatch; SUBMITTED and
 * REJECTED are terminal for the submission record.
 */
export const SUBMISSION_TRANSITIONS: Readonly<
  Record<ConnectivitySubmissionStatus, readonly ConnectivitySubmissionStatus[]>
> = Object.freeze({
  [SUBMISSION_PROPOSED]: Object.freeze([SUBMISSION_SUBMITTED, SUBMISSION_PARKED, SUBMISSION_REJECTED]),
  [SUBMISSION_PARKED]: Object.freeze([SUBMISSION_APPROVED, SUBMISSION_REJECTED]),
  [SUBMISSION_APPROVED]: Object.freeze([SUBMISSION_SUBMITTED, SUBMISSION_REJECTED]),
  [SUBMISSION_SUBMITTED]: Object.freeze([]),
  [SUBMISSION_REJECTED]: Object.freeze([]),
});

/** Terminal submission statuses. */
export const TERMINAL_SUBMISSION_STATUSES: readonly ConnectivitySubmissionStatus[] = Object.freeze([
  SUBMISSION_SUBMITTED,
  SUBMISSION_REJECTED,
]);

/**
 * Pure transition predicate. Returns true if `from -> to` is a legal
 * submission transition per `SUBMISSION_TRANSITIONS`.
 */
export function canTransitionSubmission(
  from: ConnectivitySubmissionStatus,
  to: ConnectivitySubmissionStatus,
): boolean {
  const allowed = SUBMISSION_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// The revision model (append-only, deterministic digests)
// ---------------------------------------------------------------------------

/** A single append-only revision of a connectivity submission. */
export interface SubmissionRevision {
  /** The revision number (1-based; prior + 1 on every transition). */
  readonly revision: number;
  /** The status this revision records. */
  readonly status: ConnectivitySubmissionStatus;
  /** The injected transition instant (ISO 8601 — no clock reads). */
  readonly at: string;
  /** The FROZEN Guardian decision behind the transition, when one was made. */
  readonly decision: GuardianDecision | null;
  /** The machine-stable evaluation reasons (widened, carried verbatim). */
  readonly reasons: readonly AdcosEvaluationReason[];
  /** The matched rule refs (widened, carried verbatim). */
  readonly matchedRules: readonly AdcosMatchedRuleRef[];
  /** The typed provider refusal, when the provider refused the dispatch. */
  readonly providerRefusal: AdcosProviderRefusal | null;
  /** The opaque provider handle, set on SUBMITTED. */
  readonly handle: AdcosProviderHandle | null;
  /** The provider-assigned connectivity id, set on SUBMITTED. */
  readonly connectivityId: string | null;
  /** The evaluation/dispatch error, when the transition failed on an error. */
  readonly error: FleetError | null;
  /** The deterministic content digest of this revision. */
  readonly contentDigest: string;
  /** The prior revision's digest (hash-linked chain; null on revision 1). */
  readonly priorDigest: string | null;
}

/** The connectivity submission aggregate (append-only revisions). */
export interface ConnectivitySubmissionRecord extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The deterministic submission id (`adcos-sub-<fnv1a>`). */
  readonly submissionId: string;
  /** The translated provider-neutral request (deterministic digest included). */
  readonly request: AdcosConnectivityRequest;
  /** The current status (the last revision's status). */
  readonly status: ConnectivitySubmissionStatus;
  /** The append-only revision chain (never rewritten). */
  readonly revisions: readonly SubmissionRevision[];
}

// ---------------------------------------------------------------------------
// Deterministic submission identity
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic submission id: an FNV-1a digest of
 * (tenantId, intentId, requestDigest). The same intent translated with
 * the same requirements always produces the same id — the idempotency
 * key of the submission flow (a replay never re-evaluates, never
 * re-dispatches).
 */
export function submissionIdOf(request: AdcosConnectivityRequest): string {
  return `adcos-sub-${fnv1a32Hex(
    `${request.tenantId}|${request.intentRef.intentId}|${request.requestDigest}`,
  )}`;
}

// ---------------------------------------------------------------------------
// The revision builder (internal to the module family)
// ---------------------------------------------------------------------------

/** The input facets of a new submission revision. */
export interface SubmissionRevisionInput {
  readonly status: ConnectivitySubmissionStatus;
  readonly at: string;
  readonly decision?: GuardianDecision | null;
  readonly reasons?: readonly AdcosEvaluationReason[];
  readonly matchedRules?: readonly AdcosMatchedRuleRef[];
  readonly providerRefusal?: AdcosProviderRefusal | null;
  readonly handle?: AdcosProviderHandle | null;
  readonly connectivityId?: string | null;
  readonly error?: FleetError | null;
}

/**
 * Build the next revision of a submission (pure). Computes the
 * deterministic content digest over the revision content (status,
 * decision, reasons, matched rules, refusal, handle, connectivity id,
 * error — NOT the revision number or transition instant, so an identical
 * transition at a different instant still digests identically) and
 * hash-links it to the prior revision's digest.
 */
export function nextSubmissionRevision(
  prior: readonly SubmissionRevision[],
  input: SubmissionRevisionInput,
): SubmissionRevision {
  const revision = prior.length + 1;
  const contentDigest = fnv1a32Hex(
    canonicalJson([
      input.status,
      input.decision ?? null,
      input.reasons ?? [],
      input.matchedRules ?? [],
      input.providerRefusal ?? null,
      input.handle ?? null,
      input.connectivityId ?? null,
      input.error ? { code: input.error.code, kind: input.error.kind } : null,
    ]),
  );
  return frozen({
    revision,
    status: input.status,
    at: input.at,
    decision: input.decision ?? null,
    reasons: frozenArray(input.reasons ?? []),
    matchedRules: frozenArray(input.matchedRules ?? []),
    providerRefusal: input.providerRefusal ?? null,
    handle: input.handle ?? null,
    connectivityId: input.connectivityId ?? null,
    error: input.error ?? null,
    contentDigest,
    priorDigest: prior.length === 0 ? null : prior[prior.length - 1].contentDigest,
  });
}

// ---------------------------------------------------------------------------
// The tenant-partitioned in-memory store
// ---------------------------------------------------------------------------

/** The result of a store operation — tagged, machine-stable. */
export type SubmissionStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

function storeError(code: string, message: string, trace: ErrorTrace, invariant: string): DomainError {
  return makeDomainError(code, message, trace, "adcos.submission.store", invariant);
}

/**
 * The tenant-partitioned submission store. Every operation takes the
 * acting `AdcosTenantScope` FIRST; partitions are per-tenant; a foreign
 * submission id is indistinguishable from an unknown one (both return
 * `not_found` — the store never discloses another tenant's state).
 */
export interface AdcosSubmissionStore {
  /** Open a new submission record (revision 1). Refuses duplicates with `duplicate_submission`. */
  open(
    scope: AdcosTenantScope,
    record: ConnectivitySubmissionRecord,
  ): SubmissionStoreResult<ConnectivitySubmissionRecord>;
  /** Append a revision to an existing submission under the ACTING tenant. */
  append(
    scope: AdcosTenantScope,
    submissionId: string,
    revision: SubmissionRevision,
  ): SubmissionStoreResult<ConnectivitySubmissionRecord>;
  /** Fetch a submission under the ACTING tenant (foreign ids are not_found). */
  get(
    scope: AdcosTenantScope,
    submissionId: string,
  ): SubmissionStoreResult<ConnectivitySubmissionRecord>;
  /** The acting tenant's submissions, in submission-id order. */
  list(scope: AdcosTenantScope): readonly ConnectivitySubmissionRecord[];
}

/** Create the in-memory tenant-partitioned submission store. */
export function createInMemorySubmissionStore(): AdcosSubmissionStore {
  /** tenantId -> (submissionId -> record). */
  const partitions = new Map<string, Map<string, ConnectivitySubmissionRecord>>();

  function partitionOf(tenantId: TenantId): Map<string, ConnectivitySubmissionRecord> {
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
          `submission store refused: ${check.reason}`,
          {
            tenantId: SYNTHETIC_SYSTEM_TENANT,
            correlationId: ADCOS_PIPELINE_CORRELATION_ID,
          },
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    open(scope, record) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      if (partition.has(record.submissionId)) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.storeDomain,
            "submission store refused: duplicate submission id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
            "duplicate_submission",
          ),
        };
      }
      partition.set(record.submissionId, record);
      return { ok: true, value: record };
    },
    append(scope, submissionId, revision) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      const existing = partition.get(submissionId);
      if (existing === undefined) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.submissionNotFound,
            "submission store refused: unknown submission id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
            "not_found",
          ),
        };
      }
      if (existing.revisions.length + 1 !== revision.revision) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.storeDomain,
            "submission store refused: revision sequence violation",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
            "revision_sequence",
          ),
        };
      }
      if (existing.revisions.length > 0) {
        const prior = existing.revisions[existing.revisions.length - 1];
        if (!canTransitionSubmission(prior.status, revision.status)) {
          return {
            ok: false,
            error: storeError(
              ERROR_CODES.submissionIllegalTransition,
              `submission store refused: ${prior.status} -> ${revision.status} is not a legal transition`,
              { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
              "illegal_transition",
            ),
          };
        }
        if (prior.contentDigest !== revision.priorDigest) {
          return {
            ok: false,
            error: storeError(
              ERROR_CODES.storeDomain,
              "submission store refused: revision chain break",
              { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
              "chain_break",
            ),
          };
        }
      }
      const updated: ConnectivitySubmissionRecord = frozen({
        ...existing,
        status: revision.status,
        revisions: frozenArray([...existing.revisions, revision]),
      });
      partition.set(submissionId, updated);
      return { ok: true, value: updated };
    },
    get(scope, submissionId) {
      const checked = guard(scope);
      if (!checked.ok) return checked;
      const partition = partitionOf(checked.tenantId);
      const existing = partition.get(submissionId);
      if (existing === undefined) {
        return {
          ok: false,
          error: storeError(
            ERROR_CODES.submissionNotFound,
            "submission store refused: unknown submission id",
            { tenantId: checked.tenantId, correlationId: scope.correlationId ?? ("" as CorrelationId) },
            "not_found",
          ),
        };
      }
      return { ok: true, value: existing };
    },
    list(scope) {
      const checked = guard(scope);
      if (!checked.ok) return [];
      const partition = partitionOf(checked.tenantId);
      return frozenArray([...partition.values()].sort((a, b) => (a.submissionId < b.submissionId ? -1 : 1)));
    },
  });
}
