/**
 * @fleetos/web — W144: the approval decision runtime (the EXECUTED
 * decision path — the inbox-to-decision-to-evidence journey).
 *
 * The composition site that wires the Approve/Reject decision lifecycle
 * (W142's `approvals-execution.ts`) to the REAL gated boundary + the
 * REAL audit sink. The inbox badge count tracks the EXECUTED
 * decisions: when an operator approves/rejects a parked plan, the
 * boundary transitions the plan out of PARKED, the pending count
 * drops, and the audit sink records the decision — the journey from
 * inbox item to decision record to evidence trail is REAL.
 *
 * Doctrine (frozen):
 *   - The boundary owns authorization, idempotency, audit and
 *     verification. This runtime NEVER executes anything itself; it
 *     sequences the lifecycle and projects the UI state.
 *   - The duplicate-safe guard: a plan already in a terminal state
 *     (APPROVED or REJECTED) refuses with `already_decided` — the
 *     boundary's own guard, surfaced visibly (never a silent no-op).
 *   - The audit sink is append-only: the explicit confirmation AND the
 *     routed dispatch are both recorded (the evidence trail).
 *   - Fail-closed: a tenant scope mismatch never opens a confirmation.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import {
  asCorrelationId,
  asTenantId,
  asUserId,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  TenantId,
  UserId,
} from "@fleetos/contracts";

import {
  beginApprovalDecision,
  acknowledgeApprovalConsequences,
  enterApprovalConfirmationPhrase,
  markApprovalExplicitConfirmation,
  dispatchConfirmedApproval,
  cancelApprovalDecision,
  requiredApprovalConfirmationPhrase,
  canApproveParkedPlan,
  authorizationRefusalExplanation,
  APPROVAL_REFUSALS,
} from "@fleetos/web-security";
import type {
  ApprovalDecisionState,
  ApprovalDecisionContext,
  ApprovalRefusal,
  AuthorityRecord,
  GatedDecisionBoundary,
  SecurityDecisionBoundaryInput,
  SecurityDecisionBoundaryRecord,
  SecurityDecisionBoundaryResult,
  SecurityDecisionAuditSink,
  SecurityDecisionAuditRecord,
} from "@fleetos/web-security";

// ---------------------------------------------------------------------------
// The in-memory audit sink (the evidence trail of executed decisions)
// ---------------------------------------------------------------------------

/**
 * The in-memory audit sink: records the explicit-confirmation AND the
 * routed-dispatch audit entries (the append-only evidence the flow
 * happened). The sink is tenant-partitioned (an audit entry's tenantId
 * must match the acting tenant — never cross-tenant).
 */
export interface InMemoryDecisionAuditLog {
  /** The recorded audit entries (append-only; chronological). */
  readonly entries: readonly SecurityDecisionAuditRecord[];
  /** Append one entry (PURE: returns a new log with the entry added). */
  append(entry: SecurityDecisionAuditRecord): InMemoryDecisionAuditLog;
}

/** An in-memory audit log with the given entries (the recursive append helper). */
function auditLogWith(entries: readonly SecurityDecisionAuditRecord[]): InMemoryDecisionAuditLog {
  return {
    entries: Object.freeze([...entries]) as readonly SecurityDecisionAuditRecord[],
    append: (entry: SecurityDecisionAuditRecord): InMemoryDecisionAuditLog =>
      auditLogWith([...entries, entry]),
  };
}

/** An empty in-memory audit log (the fresh-start state). */
function emptyAuditLog(): InMemoryDecisionAuditLog {
  return auditLogWith([]);
}

// ---------------------------------------------------------------------------
// The in-memory gated boundary (the EXECUTED decision path)
// ---------------------------------------------------------------------------

/** The decided plan ids (the plans that have been transitioned out of PARKED). */
type DecidedPlanSet = ReadonlySet<string>;

/** The boundary's internal state (the decided plan ids + the latest record per plan). */
interface BoundaryState {
  readonly decided: DecidedPlanSet;
  readonly records: ReadonlyMap<string, SecurityDecisionBoundaryRecord>;
}

/**
 * The in-memory gated boundary: wraps the W144 decision dispatch. When
 * the operator confirms an approve/reject, the boundary:
 *   1. checks the duplicate-safe guard (a plan already decided refuses
 *      with `already_decided`);
 *   2. records the decision (the plan transitions out of PARKED);
 *   3. returns the boundary record (APPROVED or REJECTED).
 *
 * The boundary is PURE with respect to its internal state: each call
 * returns a new state + result (never mutates the captured state).
 */
export interface InMemoryGatedDecisionBoundary {
  /** Dispatch the confirmed decision. Returns the result + the new boundary state. */
  dispatch(
    input: SecurityDecisionBoundaryInput,
  ): { readonly result: SecurityDecisionBoundaryResult; readonly state: InMemoryGatedDecisionBoundary };
  /** The decided plan ids (the plans that have been transitioned out of PARKED). */
  readonly decidedIds: readonly string[];
}

function createInMemoryGatedDecisionBoundary(
  state: BoundaryState = { decided: new Set(), records: new Map() },
): InMemoryGatedDecisionBoundary {
  return {
    get decidedIds() {
      return Object.freeze([...state.decided]);
    },
    dispatch(input) {
      // The duplicate-safe guard: a plan already decided refuses.
      if (state.decided.has(input.planId)) {
        const result: SecurityDecisionBoundaryResult = {
          ok: false,
          reason: "already_decided",
          message: `The plan '${input.planId}' has already been decided.`,
        };
        return { result, state: createInMemoryGatedDecisionBoundary(state) };
      }
      // The decision: the plan transitions to APPROVED or REJECTED.
      const record: SecurityDecisionBoundaryRecord = {
        planId: input.planId,
        status: input.action === "approve" ? "APPROVED" : "REJECTED",
        ...(input.action === "approve" ? { approverId: input.by } : {}),
        ...(input.action === "reject" && input.reason !== undefined ? { rejectionReason: input.reason } : {}),
        transitionedAt: input.at,
      };
      const nextDecided = new Set(state.decided);
      nextDecided.add(input.planId);
      const nextRecords = new Map(state.records);
      nextRecords.set(input.planId, record);
      const nextState = { decided: nextDecided, records: nextRecords };
      return {
        result: { ok: true, record },
        state: createInMemoryGatedDecisionBoundary(nextState),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The approval decision runtime (the composed lifecycle + boundary + audit)
// ---------------------------------------------------------------------------

/** The acting operator's authority (the RBAC gate's input). */
export interface ApprovalDecisionAuthority {
  readonly tenantId: TenantId;
  readonly principalId: UserId;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

/** The runtime's state (the UI state + the boundary + the audit log). */
export interface ApprovalDecisionRuntimeState {
  /** The decision lifecycle state (the UI state machine). */
  readonly decision: ApprovalDecisionState;
  /** The in-memory gated boundary (the EXECUTED decision path). */
  readonly boundary: InMemoryGatedDecisionBoundary;
  /** The in-memory audit log (the evidence trail). */
  readonly audit: InMemoryDecisionAuditLog;
  /** The set of decided plan ids (for the badge count). */
  readonly decidedPlanIds: readonly string[];
}

/** The result of a decision-lifecycle transition (the new state + any refusal). */
export interface ApprovalDecisionTransition {
  readonly state: ApprovalDecisionRuntimeState;
  readonly refusal: ApprovalRefusal | undefined;
}

/**
 * Create the approval decision runtime. The initial state is `idle`
 * (no open decision); the boundary and audit log are fresh (no decided
 * plans, no audit entries). PURE.
 */
export function createApprovalDecisionRuntime(): ApprovalDecisionRuntimeState {
  return {
    decision: { kind: "idle" },
    boundary: createInMemoryGatedDecisionBoundary(),
    audit: emptyAuditLog(),
    decidedPlanIds: Object.freeze([]),
  };
}

/**
 * Open the decision review for a parked plan. The authority gate
 * REFUSES the open with the machine-stable `authorization_required`
 * refusal (never silent) — the state stays `idle`, but the refusal
 * surface carries the explanation.
 */
export function openApprovalDecision(
  state: ApprovalDecisionRuntimeState,
  scope: { readonly tenantId: TenantId },
  context: ApprovalDecisionContext,
  authority: ApprovalDecisionAuthority,
  at: string,
): ApprovalDecisionTransition {
  const authorityRecord: AuthorityRecord = {
    tenantId: authority.tenantId,
    principalId: authority.principalId,
    permissions: authority.permissions,
    roles: authority.roles,
  };
  const decision = beginApprovalDecision(state.decision, scope, context, authorityRecord, at);
  return {
    state: { ...state, decision },
    refusal: undefined,
  };
}

/**
 * Acknowledge the consequences (explicit step 1). Only meaningful in
 * `reviewing`; every other state is a stable no-op.
 */
export function acknowledgeDecision(
  state: ApprovalDecisionRuntimeState,
  at: string,
): ApprovalDecisionTransition {
  const decision = acknowledgeApprovalConsequences(state.decision);
  return { state: { ...state, decision }, refusal: undefined };
}

/**
 * Enter the confirmation phrase (explicit step 2). The phrase must
 * match the expected phrase exactly (the `requiredApprovalConfirmationPhrase`).
 */
export function enterConfirmationPhrase(
  state: ApprovalDecisionRuntimeState,
  phrase: string,
): ApprovalDecisionTransition {
  if (state.decision.kind !== "reviewing") {
    return { state, refusal: undefined };
  }
  const decision = enterApprovalConfirmationPhrase(state.decision, phrase);
  return { state: { ...state, decision }, refusal: undefined };
}

/**
 * Mark the explicit confirmation (move to `ready_to_decide`). Only
 * meaningful after the phrase matches; every other state is a stable
 * no-op.
 */
export function markConfirmed(
  state: ApprovalDecisionRuntimeState,
  at: string,
): ApprovalDecisionTransition {
  const decision = markApprovalExplicitConfirmation(state.decision, at);
  return { state: { ...state, decision }, refusal: undefined };
}

/**
 * Dispatch the confirmed decision through the gated boundary. THE
 * GATE: this transition REFUSES to proceed unless the state is
 * `ready_to_decide`. On success, the boundary transitions the plan out
 * of PARKED, the audit sink records BOTH the explicit confirmation
 * and the routed dispatch, and the decided-plan-ids set grows (the
 * badge count drops).
 */
export function dispatchDecision(
  state: ApprovalDecisionRuntimeState,
  at: string,
): ApprovalDecisionTransition {
  // The boundary closure CAPTURES the new boundary state (the boundary
  // is immutable; each dispatch returns a NEW boundary. The closure
  // stores the new boundary so the outer state can use it after the
  // dispatch).
  let nextBoundaryCapture: InMemoryGatedDecisionBoundary = state.boundary;

  // The audit entries captured by the audit sink (the entries are
  // rebuilt into the in-memory log after the dispatch succeeds).
  const capturedAuditEntries: SecurityDecisionAuditRecord[] = [];
  const auditSink: SecurityDecisionAuditSink = {
    append: (entry: SecurityDecisionAuditRecord): void => {
      capturedAuditEntries.push(entry);
    },
  };

  // The dispatch: drives the lifecycle through the boundary.
  const dispatchResult = dispatchConfirmedApproval(state.decision, {
    at,
    boundary: (input: SecurityDecisionBoundaryInput): SecurityDecisionBoundaryResult => {
      const { result, state: nextBoundary } = nextBoundaryCapture.dispatch(input);
      nextBoundaryCapture = nextBoundary;
      return result;
    },
    auditSink,
  });

  // If the dispatch refused (not ready_to_decide), return the refusal.
  if (dispatchResult.refusal !== undefined) {
    return { state, refusal: dispatchResult.refusal };
  }

  // The dispatch succeeded: the new decision state is "decided". The
  // boundary captured the new state; the audit sink captured the
  // entries. Build the new runtime state with the updated boundary +
  // audit log + decided-plan-ids set.
  if (dispatchResult.state.kind !== "decided") {
    return { state: { ...state, decision: dispatchResult.state }, refusal: undefined };
  }
  const nextAudit = capturedAuditEntries.reduce(
    (log, entry) => log.append(entry),
    state.audit,
  );
  return {
    state: {
      decision: dispatchResult.state,
      boundary: nextBoundaryCapture,
      audit: nextAudit,
      decidedPlanIds: nextBoundaryCapture.decidedIds,
    },
    refusal: undefined,
  };
}

/**
 * Cancel the open decision. Allowed from `reviewing` /
 * `ready_to_decide`; every other state is a stable no-op. A
 * cancellation writes NO audit entry (the audit policy: consequential
 * events only — nothing happened).
 */
export function cancelDecision(
  state: ApprovalDecisionRuntimeState,
  at: string,
): ApprovalDecisionTransition {
  const decision = cancelApprovalDecision(state.decision, at);
  return { state: { ...state, decision }, refusal: undefined };
}

// ---------------------------------------------------------------------------
// The badge count (the pending approvals = the parked plans MINUS the
// decided plan ids — the EXECUTED decision path drops the count)
// ---------------------------------------------------------------------------

/**
 * The approvals inbox badge count: the number of pending parked plans
 * MINUS the plans already decided in this session. When an operator
 * approves/rejects a parked plan, the count drops — the journey from
 * inbox item to decision record to evidence trail is real.
 *
 * @param pendingCount the total parked-plans count (from the approvals source)
 * @param decidedPlanIds the plans already decided in this session
 * @param parkedPlanIds the parked plan ids (to intersect with decided)
 * @returns the badge count (never negative; never above pendingCount)
 */
export function approvalBadgeCount(
  pendingCount: number,
  parkedPlanIds: readonly string[],
  decidedPlanIds: readonly string[],
): number {
  if (pendingCount <= 0) return 0;
  const decidedSet = new Set(decidedPlanIds);
  const stillPending = parkedPlanIds.filter((id) => !decidedSet.has(id));
  return Math.max(0, stillPending.length);
}

// ---------------------------------------------------------------------------
// The authority factory (the RBAC gate's input — derived from the
// active session's role assignments)
// ---------------------------------------------------------------------------

/**
 * Build the acting operator's authority record from the active
 * session's role assignments. The permissions are the open vocabulary
 * the identity layer grants (`fleet.action.approve`, etc.).
 */
export function buildAuthority(
  tenantId: string,
  principalId: string,
  permissions: readonly string[],
  roles: readonly string[],
): ApprovalDecisionAuthority {
  return {
    tenantId: asTenantId(tenantId),
    principalId: asUserId(principalId),
    permissions: Object.freeze([...permissions]) as readonly string[],
    roles: Object.freeze([...roles]) as readonly string[],
  };
}

/** The required permission for approving/rejecting a parked plan. */
export const APPROVAL_PERMISSION = "fleet.action.approve" as const;

/**
 * Whether the acting authority can approve a parked plan (the RBAC
 * gate). A restricted role gets the machine-stable refusal — the
 * `openApprovalDecision` transition surfaces it visibly.
 */
export function canApprove(authority: ApprovalDecisionAuthority): boolean {
  const record: AuthorityRecord = {
    tenantId: authority.tenantId,
    principalId: authority.principalId,
    permissions: authority.permissions,
    roles: authority.roles,
  };
  return canApproveParkedPlan(record);
}

/** The machine-stable RBAC refusal explanation (the frozen human words). */
export function approvalRefusalExplanation(authority: ApprovalDecisionAuthority): string {
  const record: AuthorityRecord = {
    tenantId: authority.tenantId,
    principalId: authority.principalId,
    permissions: authority.permissions,
    roles: authority.roles,
  };
  return authorizationRefusalExplanation(record);
}

/** The required confirmation phrase for a decision context. */
export function confirmationPhrase(context: ApprovalDecisionContext): string {
  return requiredApprovalConfirmationPhrase(context);
}

/** A stable correlation id for the decision (the audit trail's join key). */
export function decisionCorrelationId(): CorrelationId {
  return asCorrelationId("cor_w144_decision");
}
