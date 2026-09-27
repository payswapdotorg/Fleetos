/**
 * @fleetos/recovery — D3b: the destructive recovery request model + store.
 *
 * The durable record of a requested destructive recovery action
 * (lock/locate/wipe/reboot — the `RecoveryIntent` action set). The
 * frozen `RecoveryIntentPayload` from `@fleetos/contracts` (`deviceId?`,
 * `action: "lock" | "locate" | "wipe" | "reboot"`) is consumed VERBATIM
 * as the durable intent record's payload — never re-declared, never
 * widened. The record additionally carries the full evidence trail per
 * `spec/ARCHITECTURE-LOCK.md` item 16: the frozen `GuardianDecision`
 * (policy decision), the matched rule refs (rule ids), and the
 * observation evidence artifacts (`EvidenceRef`s).
 *
 * Status lifecycle (typed, machine-stable):
 *
 *   REQUESTED -> ADVANCED | PARKED | REJECTED
 *   ADVANCED  -> EXECUTED | FAILED
 *   PARKED    -> APPROVED | REJECTED
 *   APPROVED  -> EXECUTED | FAILED
 *   EXECUTED | FAILED | REJECTED -> (terminal)
 *
 *   - ADVANCED   — the Guardian decision was ALLOW (or WARN — non-
 *     blocking per the frozen `isBlockingDecision`); execution dispatch
 *     follows through the injected adapter seam.
 *   - PARKED     — the Guardian decision was REQUIRE_APPROVAL; the
 *     request is held for human approval (the parked -> approved/
 *     rejected transitions are recorded as ledger entries).
 *   - REJECTED   — the Guardian decision was BLOCK (the Guardian's
 *     machine-stable reasons carried verbatim), OR a capability/tenant
 *     refusal BEFORE any seam call, OR a human rejection of a parked
 *     request, OR an adapter-side refusal at dispatch.
 *   - EXECUTED   — the granted action executed successfully at the
 *     adapter (with the adapter's evidence).
 *   - FAILED     — the granted action was attempted and failed at the
 *     adapter (the FleetError carried verbatim).
 *
 * Records are append-only and versioned: every transition appends
 * revision prior+1 with a deterministic content digest; a prior revision
 * is NEVER rewritten (versioned-interpretation discipline).
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `RecoveryTenantScope` FIRST; storage is partitioned
 * per tenant; a foreign request id is indistinguishable from an unknown
 * one.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { RECOVERY_INTENT_KIND } from "@fleetos/contracts";
import type {
  DeviceId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  RecoveryIntentPayload,
  TenantId,
  TenantScoped,
} from "@fleetos/contracts";
import type { RecoveryCaseEvidence } from "./recovery-case";
import type { RecoveryEvaluationReason, RecoveryMatchedRuleRef } from "./policy-seam";
import {
  ERROR_CODES,
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  makeDomainError,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The action set (the frozen RecoveryIntentPayload action union, verbatim)
// ---------------------------------------------------------------------------

/** The intent kind this module's records carry (frozen constant, reused). */
export const DESTRUCTIVE_INTENT_KIND = RECOVERY_INTENT_KIND;

/**
 * The destructive recovery action set — the action union of the FROZEN
 * `RecoveryIntentPayload`, derived from the frozen shape (never
 * re-declared as a divergent union).
 */
export type DestructiveRecoveryAction = RecoveryIntentPayload["action"];

/** The full action set, for validation + iteration. */
export const ALL_DESTRUCTIVE_RECOVERY_ACTIONS: readonly DestructiveRecoveryAction[] = Object.freeze([
  "lock",
  "locate",
  "wipe",
  "reboot",
]);

// ---------------------------------------------------------------------------
// The typed status lifecycle
// ---------------------------------------------------------------------------

export const REQUEST_REQUESTED = "REQUESTED" as const;
export const REQUEST_ADVANCED = "ADVANCED" as const;
export const REQUEST_PARKED = "PARKED" as const;
export const REQUEST_APPROVED = "APPROVED" as const;
export const REQUEST_EXECUTED = "EXECUTED" as const;
export const REQUEST_FAILED = "FAILED" as const;
export const REQUEST_REJECTED = "REJECTED" as const;

/** The status of a destructive recovery request (machine-stable). */
export type DestructiveRequestStatus =
  | typeof REQUEST_REQUESTED
  | typeof REQUEST_ADVANCED
  | typeof REQUEST_PARKED
  | typeof REQUEST_APPROVED
  | typeof REQUEST_EXECUTED
  | typeof REQUEST_FAILED
  | typeof REQUEST_REJECTED;

/**
 * The typed transition table. REQUESTED transitions only via the
 * Guardian decision (the D3 gate); PARKED transitions only via the human
 * approval step; ADVANCED/APPROVED transition only via execution
 * dispatch; EXECUTED/FAILED/REJECTED are terminal.
 */
export const DESTRUCTIVE_REQUEST_TRANSITIONS: Readonly<
  Record<DestructiveRequestStatus, readonly DestructiveRequestStatus[]>
> = Object.freeze({
  [REQUEST_REQUESTED]: Object.freeze([REQUEST_ADVANCED, REQUEST_PARKED, REQUEST_REJECTED]),
  [REQUEST_ADVANCED]: Object.freeze([REQUEST_EXECUTED, REQUEST_FAILED, REQUEST_REJECTED]),
  [REQUEST_PARKED]: Object.freeze([REQUEST_APPROVED, REQUEST_REJECTED]),
  [REQUEST_APPROVED]: Object.freeze([REQUEST_EXECUTED, REQUEST_FAILED, REQUEST_REJECTED]),
  [REQUEST_EXECUTED]: Object.freeze([]),
  [REQUEST_FAILED]: Object.freeze([]),
  [REQUEST_REJECTED]: Object.freeze([]),
});

/** Terminal request statuses. */
export const TERMINAL_DESTRUCTIVE_REQUEST_STATUSES: readonly DestructiveRequestStatus[] =
  Object.freeze([REQUEST_EXECUTED, REQUEST_FAILED, REQUEST_REJECTED]);

/**
 * Pure transition predicate. Returns true if `from -> to` is a legal
 * destructive-request transition per `DESTRUCTIVE_REQUEST_TRANSITIONS`.
 */
export function canTransitionDestructiveRequest(
  from: DestructiveRequestStatus,
  to: DestructiveRequestStatus,
): boolean {
  const allowed = DESTRUCTIVE_REQUEST_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// The execution record (the adapter dispatch outcome)
// ---------------------------------------------------------------------------

/**
 * The recorded outcome of dispatching a GRANTED destructive action
 * through the injected adapter seam: the injected attempt instant, the
 * machine-stable outcome, the adapter's evidence artifacts, and the
 * FleetError when the adapter refused or failed.
 */
export interface DestructiveExecutionRecord {
  /** The injected dispatch instant (ISO 8601). */
  readonly attemptedAt: string;
  /** `executed` — the adapter executed; `failed` — the adapter attempted and failed. */
  readonly outcome: "executed" | "failed";
  /** The evidence artifacts the adapter returned. */
  readonly adapterEvidence: readonly EvidenceRef[];
  /** The adapter's refusal/failure error, verbatim. */
  readonly error?: FleetError;
}

// ---------------------------------------------------------------------------
// The versioned request record
// ---------------------------------------------------------------------------

/**
 * A versioned destructive recovery request record. Append-only: every
 * transition appends `version = prior + 1`; a prior revision is never
 * rewritten. The request identity is the deterministic digest of
 * (tenantId, caseId, action, requestedAt).
 */
export interface DestructiveRequestRecord extends TenantScoped {
  /** Deterministic request identity: `dr_` + fnv1a32(tenant, caseId, action, requestedAt). */
  readonly requestId: string;
  /** Deterministic revision id: `drv_` + fnv1a32(requestId, version). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The recovery case the request belongs to. */
  readonly caseId: string;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The frozen intent kind (reused constant — `RecoveryIntent`). */
  readonly intentKind: typeof RECOVERY_INTENT_KIND;
  /** The FROZEN `RecoveryIntentPayload`, consumed VERBATIM (deviceId? + action). */
  readonly intentPayload: RecoveryIntentPayload;
  /** The request status. */
  readonly status: DestructiveRequestStatus;
  /** The injected request instant. */
  readonly requestedAt: string;
  /** The requesting principal, when known. */
  readonly requestedBy?: string;
  /** Snapshot of the case's evidence basis (last-seen + posture finding refs). */
  readonly caseEvidence: RecoveryCaseEvidence;
  /** The observation evidence artifacts supporting the request (the §16 trail). */
  readonly evidence: readonly EvidenceRef[];
  /** The FROZEN Guardian decision, present from the decision revision on. */
  readonly decision?: GuardianDecision;
  /** The matched rule refs (rule ids + versions), present with the decision. */
  readonly matchedRules?: readonly RecoveryMatchedRuleRef[];
  /** The machine-stable evaluation reasons (the WARN context among them). */
  readonly reasons?: readonly RecoveryEvaluationReason[];
  /** The machine-stable refusal reason, present on refusal revisions. */
  readonly refusalReason?: string;
  /** The injected decision instant, present from the decision revision on. */
  readonly decidedAt?: string;
  /** The approving principal, present on APPROVED revisions. */
  readonly approvedBy?: string;
  /** The injected approval instant, present on APPROVED/REJECTED-after-parking revisions. */
  readonly approvalDecidedAt?: string;
  /** The dispatch outcome, present on EXECUTED/FAILED revisions. */
  readonly execution?: DestructiveExecutionRecord;
  /** Canonical digest of the revision's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic request identity. */
export function destructiveRequestId(
  tenantId: TenantId,
  caseId: string,
  action: DestructiveRecoveryAction,
  requestedAt: string,
): string {
  return `dr_${fnv1a32Hex(canonicalJson([tenantId, caseId, action, requestedAt]))}`;
}

/** The deterministic request REVISION id. */
export function destructiveRequestRecordId(requestId: string, version: number): string {
  return `drv_${fnv1a32Hex(canonicalJson([requestId, version]))}`;
}

/** The canonical content digest of a request revision's content fields. */
export function destructiveRequestContentDigest(
  record: Omit<DestructiveRequestRecord, "requestId" | "recordId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.deviceId,
      record.caseId,
      record.version,
      record.intentKind,
      record.intentPayload,
      record.status,
      record.requestedAt,
      record.requestedBy ?? null,
      record.caseEvidence,
      record.evidence,
      record.decision ?? null,
      record.matchedRules ?? null,
      record.reasons ?? null,
      record.refusalReason ?? null,
      record.decidedAt ?? null,
      record.approvedBy ?? null,
      record.approvalDecidedAt ?? null,
      record.execution ?? null,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The tenant-partitioned request store
// ---------------------------------------------------------------------------

/** The tagged result of a request-store write. */
export type DestructiveRequestStoreWrite =
  | { readonly ok: true; readonly record: DestructiveRequestRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only destructive-request store. Every
 * operation takes the acting `RecoveryTenantScope` FIRST and touches
 * only the acting tenant's partition. Request revisions are append-only
 * per request id.
 *
 * Audit note: this store audits NOTHING — the D3 gate owns the audit
 * emission for every consequential request mutation (requested / parked
 * / approved / rejected / executed / failed / refused), mirroring the
 * W041 pattern where the policy gate emits the submission audit while
 * the store emits only the creation. Here even the creation audit is
 * emitted by the gate (the "requested" event carries the decision
 * context that the store cannot know).
 */
export interface DestructiveRequestStore {
  /** Append a request revision into the ACTING tenant's partition (tenant must match). */
  appendRequest(scope: RecoveryTenantScope, record: DestructiveRequestRecord): DestructiveRequestStoreWrite;
  /** The LATEST revision of a request (own partition only; undefined when absent/foreign). */
  getLatestRequest(scope: RecoveryTenantScope, requestId: string): DestructiveRequestRecord | undefined;
  /** A specific revision of a request (own partition only). */
  getRequestRevision(
    scope: RecoveryTenantScope,
    requestId: string,
    version: number,
  ): DestructiveRequestRecord | undefined;
  /** Every revision of a request, version order (own partition only). */
  listRequestRevisions(scope: RecoveryTenantScope, requestId: string): readonly DestructiveRequestRecord[];
  /** All request ids in the acting partition (sorted). */
  listRequestIds(scope: RecoveryTenantScope): readonly string[];
  /** The number of requests in the acting partition. */
  size(scope: RecoveryTenantScope): number;
}

/**
 * Create the in-memory reference `DestructiveRequestStore`. Storage is
 * partitioned by tenant id; request revisions are append-only per
 * request id (the prior is never rewritten).
 */
export function createInMemoryDestructiveRequestStore(): DestructiveRequestStore {
  /** tenantId -> (requestId -> DestructiveRequestRecord[]). */
  const partitions = new Map<string, Map<string, DestructiveRequestRecord[]>>();

  function partitionOf(tenantId: string): Map<string, DestructiveRequestRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, DestructiveRequestRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: RecoveryTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkRecoveryTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.requestStoreDomain,
          `destructive request store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
          "recovery.destructive.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: RecoveryTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendRequest(
      scope: RecoveryTenantScope,
      record: DestructiveRequestRecord,
    ): DestructiveRequestStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.requestStoreDomain,
            "destructive request tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "recovery.destructive.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(record.requestId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(record.requestId, revisions);
      }
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          // Idempotent append of identical content: a no-op.
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.requestStoreDomain,
            "request version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "recovery.destructive.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.requestStoreDomain,
            `request revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "recovery.destructive.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    getLatestRequest(scope: RecoveryTenantScope, requestId: string): DestructiveRequestRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(requestId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getRequestRevision(
      scope: RecoveryTenantScope,
      requestId: string,
      version: number,
    ): DestructiveRequestRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(requestId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listRequestRevisions(
      scope: RecoveryTenantScope,
      requestId: string,
    ): readonly DestructiveRequestRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(requestId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listRequestIds(scope: RecoveryTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: RecoveryTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}
