/**
 * @fleetos/web — W149: the EXECUTED DECISION state derivation (the
 * decision-propagation lane's pure projection).
 *
 * The W148 engagement wired the Approve/Reject EXECUTION path through
 * the W142 runtime: the typed-phrase gate, the RBAC gate, the dispatch
 * through the gated boundary, the duplicate-safe guard, the badge drop.
 * What the W148 engagement did NOT do is PROPAGATE the executed
 * decision's state into the OTHER surfaces the operator sees:
 *
 *   - the approvals QUEUE CARD still showed REQUIRE_APPROVAL with live
 *     buttons (the decision's outcome was invisible on the queue);
 *   - the Security Doctor still showed the plan as PARKED / In progress
 *     (the plan's executed status did not propagate);
 *   - the Evidence & Audit index stayed at the 3 seeded trails (the
 *     decision's 2-entry audit trail was NOT surfaced).
 *
 * This module is the PURE derivation that turns the approval runtime's
 * internal state into the overlay the runtime composition can consume
 * to make the propagation REAL:
 *
 *   - `decidedPlanIds` — the set of plan ids that have transitioned out
 *     of PARKED in this session (the queue card's "dead button" set).
 *   - `recordsByPlan` — the executed decision record per plan (the
 *     status, the approver, the transitioned-at instant — the data the
 *     Security Doctor's `planState` overlay carries).
 *   - `auditEntries` — the executed decision's append-only audit
 *     entries (the 2-entry evidence trail per decision: the explicit
 *     confirmation + the routed dispatch). The Evidence & Audit index
 *     surfaces these as REAL trail entries — never fabricated data.
 *
 * PURE + DETERMINISTIC: no clock, no I/O, no `any` in public
 * signatures. Strict TS. The derivation walks the runtime's own audit
 * log (the same log the W148 engagement already writes through the
 * `dispatchDecision` boundary); nothing is re-derived or fabricated.
 */

import type { TenantId } from "@fleetos/contracts";
import type {
  SecurityDecisionAuditRecord,
} from "@fleetos/web-security";
import { APPROVAL_AUDIT_ACTIONS } from "@fleetos/web-security";
import type { ApprovalDecisionRuntimeState } from "./approval-decision-runtime";

// ---------------------------------------------------------------------------
// The executed decision record (the propagation's per-plan overlay)
// ---------------------------------------------------------------------------

/**
 * One executed decision's record (the propagation's per-plan overlay).
 * The plan's status AFTER the boundary transitioned it out of PARKED —
 * APPROVED or REJECTED — with the boundary's own principal/timestamp
 * (recorded by the W142 boundary, surfaced through the audit log).
 */
export interface ExecutedDecisionRecord {
  /** The plan identity (the boundary's `planId` input). */
  readonly planId: string;
  /** The acting tenant (the boundary's `tenantId` input). */
  readonly tenantId: TenantId;
  /** The post-decision status (APPROVED or REJECTED — never PARKED). */
  readonly status: "APPROVED" | "REJECTED";
  /** The boundary action that transitioned the plan (approve / reject). */
  readonly action: "approve" | "reject";
  /** The approving principal (recorded by the boundary on APPROVED). */
  readonly approverId: string | undefined;
  /** The rejection reason (recorded by the boundary on REJECTED). */
  readonly rejectionReason: string | undefined;
  /** The transition's instant (the boundary's `at` input). */
  readonly transitionedAt: string;
  /** The audit-trail join key (the boundary's correlation id). */
  readonly correlationId: string;
}

/**
 * The executed decision state derived from the approval runtime. PURE
 * — the same runtime always produces the same projection (the audit
 * log is append-only and chronological; the derivation is a stable
 * walk over it).
 */
export interface ExecutedDecisionState {
  /** The set of decided plan ids (the queue card's dead-button set). */
  readonly decidedPlanIds: readonly string[];
  /** The per-plan executed decision record (keyed by plan id). */
  readonly recordsByPlan: Readonly<Record<string, ExecutedDecisionRecord>>;
  /** The append-only audit entries (the evidence trail per decision). */
  readonly auditEntries: readonly SecurityDecisionAuditRecord[];
}

/** The empty executed-decision state (the fresh-session state). */
export function emptyExecutedDecisionState(): ExecutedDecisionState {
  return Object.freeze({
    decidedPlanIds: Object.freeze([]) as readonly string[],
    recordsByPlan: Object.freeze({}) as Readonly<Record<string, ExecutedDecisionRecord>>,
    auditEntries: Object.freeze([]) as readonly SecurityDecisionAuditRecord[],
  });
}

// ---------------------------------------------------------------------------
// The derivation (the runtime's audit log -> the propagation overlay)
// ---------------------------------------------------------------------------

/**
 * Derive the executed decision state from the approval runtime. PURE
 * — walks the runtime's own audit log (the same log the W148 engagement
 * already writes through `dispatchDecision`); nothing is re-derived or
 * fabricated.
 *
 * The derivation is conservative:
 *   - Only audit entries whose action is the W142 `dispatched` action
 *     carry a terminal decision record (the explicit-confirmation
 *     entries are evidence of the human gate, NOT a decision). The
 *     derivation picks up BOTH for the audit trail (the 2-entry
 *     evidence per decision), but only the dispatched entries become
 *     `ExecutedDecisionRecord`s.
 *   - The planId is read from the entry's `subject` (the boundary's
 *     `planId` input — verified to be a non-empty string).
 *   - The status / approverId / rejectionReason are read from the
 *     entry's `details` (the boundary's own record — never fabricated).
 *   - A runtime with no audit entries (no decision has been executed)
 *     yields the empty state (no overlay — the queue card renders the
 *     live PARKED state, the doctor renders the seeded PARKED plan
 *     state, the evidence index stays at the seeded trails).
 *
 * @param runtime the approval runtime (the W144 executed-decision path)
 * @returns the derived executed decision state (PURE; never throws)
 */
export function deriveExecutedDecisionState(
  runtime: ApprovalDecisionRuntimeState,
): ExecutedDecisionState {
  const entries = runtime.audit.entries;
  if (entries.length === 0) return emptyExecutedDecisionState();

  const recordsByPlan: Record<string, ExecutedDecisionRecord> = {};
  const seenPlanIds: string[] = [];
  // The audit entries are the FULL trail (explicit confirmation +
  // dispatched). Pass them all through to the evidence layer — the
  // evidence trail projects the entire decision journey.
  const auditEntries: SecurityDecisionAuditRecord[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    auditEntries.push(entry);
    // Only the dispatched entries carry a terminal decision record.
    if (entry.action !== APPROVAL_AUDIT_ACTIONS.dispatched) continue;
    const planId = typeof entry.subject === "string" ? entry.subject : null;
    if (planId === null || planId.length === 0) continue;
    const details = entry.details ?? {};
    const rawStatus = typeof details["status"] === "string" ? (details["status"] as string) : null;
    if (rawStatus !== "APPROVED" && rawStatus !== "REJECTED") continue;
    const rawAction = typeof details["action"] === "string" ? (details["action"] as string) : null;
    if (rawAction !== "approve" && rawAction !== "reject") continue;
    const approverIdRaw = details["approverId"];
    const rejectionReasonRaw = details["rejectionReason"];
    const approverId = typeof approverIdRaw === "string" ? approverIdRaw : undefined;
    const rejectionReason = typeof rejectionReasonRaw === "string" ? rejectionReasonRaw : undefined;
    // The latest dispatched entry per plan wins (a re-decision is
    // impossible — the boundary's duplicate-safe guard refuses — but
    // the projection is total + machine-stable regardless).
    recordsByPlan[planId] = Object.freeze({
      planId,
      tenantId: entry.tenantId,
      status: rawStatus,
      action: rawAction,
      approverId,
      rejectionReason,
      transitionedAt: entry.occurredAt,
      correlationId: entry.correlationId,
    });
    if (!seenPlanIds.includes(planId)) seenPlanIds.push(planId);
  }

  // Deterministic order: the recorded order (the audit log is
  // append-only + chronological; the first-seen order is stable).
  const decidedPlanIds = Object.freeze(seenPlanIds) as readonly string[];
  return Object.freeze({
    decidedPlanIds,
    recordsByPlan: Object.freeze(recordsByPlan) as Readonly<Record<string, ExecutedDecisionRecord>>,
    auditEntries: Object.freeze(auditEntries) as readonly SecurityDecisionAuditRecord[],
  });
}
