/**
 * @fleetos/web-security — W142: the runtime state structural seams.
 *
 * The W141-disclosed pattern: domain surfaces are injected at binding
 * sites as STRUCTURAL shapes, never imported as cross-lane modules. The
 * ownership gate (`tools/check-ownership.mjs`) allows `@fleetos/contracts`
 * as the only cross-lane src/ import; the Security Doctor's findings live
 * in `@fleetos/security` (worker-b), the policy engine in `@fleetos/policy`
 * (worker-b), the Fleet Action plans in `@fleetos/actions` (worker-b), and
 * the audit log in `@fleetos/audit`. This package therefore declares the
 * structural subset of those domain surfaces its view-models consume, and
 * the BINDING SITE (the W061 shell in production; the test suite in this
 * wave) injects the real packages — proven by test.
 *
 * The W142 runtime state contract for the security lane — the sources a
 * security surface composes from:
 *
 *   - the tenant's findings (the W031 ledger's derived active view, projected
 *     through `SecurityFindingRecord`);
 *   - the Guardian evaluation that produced the parking decision (the
 *     `GuardianEvaluationRecord` structural seam);
 *   - the durable security-remediation requests (the audit-trail of durable
 *     SecurityRemediationIntents, projected through `RemediationRequestLike`);
 *   - the parked approval items (the W041 parked plan + its parking decision
 *     pair, projected through `ParkedApprovalItemInput`);
 *   - the post-decision plan state (when the human decided — APPROVED or
 *     REJECTED — projected through `DecisionRecordState`);
 *   - the verification records (when execution completed and was verified,
 *     projected through `VerificationRecord`).
 *
 * PLUS the W142 decision-lifecycle seams (the Approve/Reject execution
 * path the report's central demand):
 *
 *   - the audit sink (structurally `@fleetos/audit`'s `AuditSink` shape —
 *     a real hash-chained audit log adapter at the binding site);
 *   - the acting authority (principal + permission-name list — structurally
 *     `@fleetos/identity`'s `ResolvedPermissions` at the binding site);
 *   - the injected gated decision boundary (the REAL `approveParkedPlan`
 *     boundary at the binding site, wrapped for the security lane's RBAC
 *     + idempotency + audit + verification discipline).
 *
 * Open unions (severity, classification, decision types) are the frozen
 * contracts vocabulary verbatim — never re-derived. Evidence refs are
 * OPAQUE content-addressable keys — never interpreted.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type {
  CausationId,
  CorrelationId,
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  PolicyId,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import type { GuardianDecisionRecord, GuardianEvaluationRecord, ParkedApprovalItemInput, ParkedPlanRecord, SecurityFindingRecord, SurfaceDecisionType, SurfacePlanStatus, SurfaceTenantScope } from "./surface-contracts";
import type { RemediationProposalDraft } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The audit sink seam (structurally the @fleetos/audit AuditSink shape)
// ---------------------------------------------------------------------------

/**
 * The append-only audit record the security decision lifecycle emits.
 * Structurally identical to `@fleetos/audit`'s `AuditSinkRecord` and
 * `@fleetos/recovery`'s `RecoveryAuditRecord` — the REAL sink adapter
 * accepts this shape at the binding site without a cross-lane import.
 */
export interface SecurityDecisionAuditRecord {
  readonly tenantId: TenantId;
  readonly action: string;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The append-only audit sink. Implementations MUST NOT drop records.
 * INJECTED at the binding site (the REAL `@fleetos/audit` log through
 * its sink adapter; the collecting sink in tests).
 */
export interface SecurityDecisionAuditSink {
  append(record: SecurityDecisionAuditRecord): void;
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_SECURITY_AUDIT_SINK: SecurityDecisionAuditSink = Object.freeze({
  append: (_record: SecurityDecisionAuditRecord): void => undefined,
});

// ---------------------------------------------------------------------------
// The authority seam (structurally @fleetos/identity's ResolvedPermissions)
// ---------------------------------------------------------------------------

/**
 * The acting principal's resolved permissions — structurally satisfied
 * by `@fleetos/identity`'s `ResolvedPermissions` (the fold of the
 * active role assignments). The principal id and the tenant scope ride
 * every authorization check; the permission-name list is the open
 * vocabulary the identity layer grants (`fleet.action.approve`,
 * `security.enrollment.disable`, etc.).
 */
export interface AuthorityRecord {
  readonly tenantId: TenantId;
  readonly principalId: UserId;
  /** The permission names the active role assignments grant (open vocabulary). */
  readonly permissions: readonly string[];
  /** The role assignments the principal holds (machine-stable, observable). */
  readonly roles: readonly string[];
}

/** The machine-stable permission the security lane consumes. */
export const SECURITY_PERMISSIONS = Object.freeze({
  /** Approve or reject a parked plan. */
  approveParkedPlan: "fleet.action.approve",
  /** Disable a tenant's enrollment code (a gated destructive control). */
  disableEnrollmentCode: "fleet.enrollment.disable",
  /** Revoke an enrolled device's trust (a gated destructive control). */
  revokeDeviceTrust: "fleet.device.trust.revoke",
} as const);

// ---------------------------------------------------------------------------
// The durable security-remediation request seam (the audit-trail of durable
// SecurityRemediationIntents — the W031 remediation records)
// ---------------------------------------------------------------------------

/** The operator's recorded disposition of a remediation proposal. */
export type SecurityRemediationDisposition = "not_decided" | "accepted" | "dismissed";

/**
 * A durable security-remediation request record — the REAL runtime state
 * of what happened after an operator acted on a security-remediation
 * proposal. The structural projection the binding site derives from the
 * REAL action boundary's records (the W041 fleet action plan linked to
 * the security-remediation intent, the durable request's lifecycle, the
 * Guardian evaluation that gated it, the human approval that released
 * it, the execution outcome, the evidence trail). Every field passes
 * through verbatim, never re-derived.
 */
export interface SecurityRemediationRequestLike {
  /** The finding identifier this remediation request disposes. */
  readonly findingId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The routed intent kind (the proposal's intent, verbatim). */
  readonly intentKind: string;
  /** The operator's disposition of the proposal. */
  readonly disposition: Exclude<SecurityRemediationDisposition, "not_decided">;
  /** The durable request's machine-stable status (open vocabulary, verbatim). */
  readonly status: string;
  readonly requestedAt: string;
  readonly requestedBy: string | undefined;
  /**
   * The parked plan id the binding site links this request to (when the
   * Guardian parked it for a human decision). Optional: a request that
   * was ALLOW/WARN-disposed never has a parked plan; the binding site
   * only populates this when a plan was created for the request.
   */
  readonly planId?: string;
  /** The FROZEN Guardian decision, when the boundary evaluated the request. */
  readonly decision?: GuardianDecision;
  readonly decidedAt: string | undefined;
  /** The recorded human approval, when the decision was approved. */
  readonly approvedBy?: UserId;
  readonly approvalDecidedAt?: string;
  /** The execution outcome, when the request reached the adapter. */
  readonly outcome: "executed" | "failed" | undefined;
  readonly executedAt: string | undefined;
  /** The OPAQUE evidence refs the request accumulated (verbatim). */
  readonly evidence: readonly EvidenceRef[];
  readonly contentDigest: string;
}

/**
 * The tenant-partitioned remediation-request source. INJECTED at the
 * binding site (the REAL action-boundary records projected per finding).
 * The latest record per finding wins; the records are append-only at
 * the domain — this seam only READS.
 */
export interface SecurityRemediationRequestSource {
  /** The finding's remediation request records (latest per finding). */
  requests(tenantId: TenantId, findingId: string): readonly SecurityRemediationRequestLike[];
  /** The tenant's full remediation-request history (ordered by findingId). */
  list(tenantId: TenantId): readonly SecurityRemediationRequestLike[];
}

// ---------------------------------------------------------------------------
// The finding source (the W031 ledger's derived active view)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned finding source. INJECTED at the binding site —
 * the REAL `@fleetos/security` posture findings (or the ledger's
 * derived active view at the deployed tier) satisfies this structurally.
 *
 * Contract (mirrors the W031 ledger):
 *   - `list` returns ONLY the acting tenant's findings, deterministically
 *     ordered (sorted by severity-rank desc, then code asc, then deviceId
 *     asc — the surface's frozen order);
 *   - `get` returns `undefined` for foreign/unknown findings — there is
 *     no existence side channel across tenants (the honest blocked state).
 */
export interface SecurityFindingSource {
  list(tenantId: TenantId): readonly SecurityFindingRecord[];
  get(tenantId: TenantId, findingId: string): SecurityFindingRecord | undefined;
}

// ---------------------------------------------------------------------------
// The evaluation source (the W031 Guardian engine's evaluation records)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned evaluation source — the parking-decision context
 * for a finding's remediation request. INJECTED at the binding site; the
 * REAL `@fleetos/policy` Guardian engine's `GuardianEvaluation` records
 * satisfy this structurally.
 */
export interface SecurityEvaluationSource {
  /** The evaluation that produced the parking decision for the finding's request. */
  evaluationFor(
    tenantId: TenantId,
    findingId: string,
  ): GuardianEvaluationRecord | undefined;
}

// ---------------------------------------------------------------------------
// The parked-approval source (the W041 parked plan + parking decision pair)
// ---------------------------------------------------------------------------

/**
 * The tenant-partitioned parked-approvals source. INJECTED at the binding
 * site; the REAL `@fleetos/actions` `approveParkedPlan` queue satisfies
 * this structurally (the parked plans whose parking decision was
 * REQUIRE_APPROVAL).
 */
export interface SecurityApprovalSource {
  /** The parked approval items (parked plan + parking decision pairs). */
  parked(tenantId: TenantId): readonly ParkedApprovalItemInput[];
  /** One parked approval item by plan id (the queue detail view). */
  parkedByPlan(
    tenantId: TenantId,
    planId: string,
  ): ParkedApprovalItemInput | undefined;
}

// ---------------------------------------------------------------------------
// The post-decision plan state seam (the W041 plan state after a decision)
// ---------------------------------------------------------------------------

/**
 * The post-decision plan state — the REAL runtime state of a W041 action
 * plan after the human decided (APPROVED or REJECTED) or after the
 * Guardian refused (REJECTED). The structural projection the binding
 * site derives from the REAL plan revision; the surface presents it
 * read-only.
 */
export interface DecisionPlanState {
  readonly planId: string;
  readonly tenantId: TenantId;
  readonly status: SurfacePlanStatus;
  readonly capability: string;
  readonly targetCount: number;
  /** The approving principal (recorded by the human-approval step). */
  readonly approverId?: UserId;
  readonly rejectionReason?: string;
  readonly transitionedAt?: string;
  /** The dispatch handoff disclosure (present on APPROVED plans). */
  readonly executionHandoff: "downstream_dispatch" | null;
  readonly evidenceCount: number;
  readonly contentDigest: string;
}

/**
 * The tenant-partitioned post-decision plan state source. INJECTED at
 * the binding site (the REAL W041 plan revisions, projected after the
 * decision).
 */
export interface SecurityDecisionPlanSource {
  /** The latest plan state for one plan id (the post-decision state). */
  stateFor(tenantId: TenantId, planId: string): DecisionPlanState | undefined;
}

// ---------------------------------------------------------------------------
// The verification seam (the W031/W041 verification records — when
// execution completed and was verified)
// ---------------------------------------------------------------------------

/**
 * The verification record — the REAL runtime state of a verified
 * security-remediation outcome. The structural projection the binding
 * site derives from the REAL action boundary's verification step;
 * every field passes through verbatim.
 */
export interface VerificationRecord {
  readonly findingId: string;
  readonly tenantId: TenantId;
  readonly verifiedAt: string;
  readonly summary: string;
  readonly evidenceCount: number;
}

/**
 * The tenant-partitioned verification source. INJECTED at the binding
 * site; the REAL action-boundary verification records satisfy this
 * structurally.
 */
export interface SecurityVerificationSource {
  /** The verification record for one finding (when verification completed). */
  verificationFor(
    tenantId: TenantId,
    findingId: string,
  ): VerificationRecord | undefined;
}

// ---------------------------------------------------------------------------
// The injected decision boundary (the REAL approveParkedPlan gate)
// ---------------------------------------------------------------------------

/** The dispatch input the boundary receives. */
export interface SecurityDecisionBoundaryInput {
  readonly tenantId: TenantId;
  readonly planId: string;
  readonly action: "approve" | "reject";
  readonly by: UserId;
  readonly at: string;
  readonly correlationId: CorrelationId;
  /** The machine-stable rejection reason (when rejecting). */
  readonly reason?: string;
}

/** The durable record projection the boundary returns on success. */
export interface SecurityDecisionBoundaryRecord {
  readonly planId: string;
  /** The boundary's machine-stable status (APPROVED or REJECTED). */
  readonly status: SurfacePlanStatus;
  readonly approverId?: UserId;
  readonly rejectionReason?: string;
  readonly transitionedAt: string;
}

/** The boundary's machine-stable result. */
export type SecurityDecisionBoundaryResult =
  | { readonly ok: true; readonly record: SecurityDecisionBoundaryRecord }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/**
 * The INJECTED gated decision boundary — the REAL `approveParkedPlan`
 * boundary (the W041 transition + the audit log) wrapped at the binding
 * site. This module NEVER executes anything itself; the boundary owns
 * authorization, idempotency, audit and verification.
 *
 * The boundary MUST refuse a duplicate decision (a plan already in a
 * terminal state — APPROVED or REJECTED — with a machine-stable
 * `already_decided` reason; the security lane's decision lifecycle
 * surfaces this as a stable refusal — never a silent no-op).
 */
export type GatedDecisionBoundary = (
  input: SecurityDecisionBoundaryInput,
) => SecurityDecisionBoundaryResult;

// ---------------------------------------------------------------------------
// The gated destructive-control boundary (the W142 destructive actions)
// ---------------------------------------------------------------------------

/** The destructive action kind (the two W142 gated controls). */
export type SecurityDestructiveActionKind =
  | "disable_enrollment_code"
  | "revoke_device_trust";

/** The dispatch input the destructive boundary receives. */
export interface SecurityDestructiveBoundaryInput {
  readonly tenantId: TenantId;
  readonly action: SecurityDestructiveActionKind;
  /** The subject the action targets (the enrollment code id / the device id). */
  readonly subject: string;
  readonly by: UserId;
  readonly at: string;
  readonly correlationId: CorrelationId;
}

/** The durable record projection the destructive boundary returns on success. */
export interface SecurityDestructiveBoundaryRecord {
  /** The boundary's machine-stable action status (e.g. DISABLED / REVOKED). */
  readonly status: string;
  readonly subject: string;
  readonly transitionedAt: string;
}

/** The destructive boundary's machine-stable result. */
export type SecurityDestructiveBoundaryResult =
  | { readonly ok: true; readonly record: SecurityDestructiveBoundaryRecord }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/**
 * The INJECTED gated destructive boundary — the REAL enrollment-disable /
 * device-trust-revoke boundary (the W140 server route + the W041 audit
 * log) wrapped at the binding site. This module NEVER executes anything
 * itself; the boundary owns authorization, idempotency, audit and the
 * state change.
 *
 * The boundary MUST refuse an unauthorized attempt (the principal lacks
 * `disableEnrollmentCode` / `revokeDeviceTrust`) with a machine-stable
 * `authorization_required` reason — the security lane's destructive
 * confirmation flow surfaces this as an EXPLICIT denial — never a
 * silent no-op.
 */
export type GatedDestructiveBoundary = (
  input: SecurityDestructiveBoundaryInput,
) => SecurityDestructiveBoundaryResult;

/** All W142 destructive action kinds (canonical order). */
export const ALL_SECURITY_DESTRUCTIVE_ACTION_KINDS: readonly SecurityDestructiveActionKind[] =
  Object.freeze(["disable_enrollment_code", "revoke_device_trust"] as const);

/** Re-export the structural surface types the seams consume. */
export type {
  GuardianDecisionRecord,
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  ParkedPlanRecord,
  RemediationProposalDraft,
  SecurityFindingRecord,
  SurfaceDecisionType,
  SurfacePlanStatus,
  SurfaceTenantScope,
} from "./surface-contracts";
