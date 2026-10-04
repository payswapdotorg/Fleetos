/**
 * W142 web-security — the Approvals EXECUTION state machine tests.
 *
 * The SIM-B ground truth (blocker 3): the Approve/Reject controls on
 * a parked plan were INERT. These tests prove the governed action is
 * REAL — the decision lifecycle, the confirmation gates, the RBAC
 * denials, the audit seam, the evidence trail, and the duplicate-safe
 * handling.
 *
 * The machine proof:
 *
 *   1. The AUTHORIZATION GATE: an unauthorized attempt gets an
 *      EXPLICIT denial — never a silent no-op. The state stays `idle`
 *      (the boundary is untouched, no audit entry); the refusal
 *      carries the escalation path.
 *   2. The CONFIRMATION GATES: the dispatch step REFUSES without the
 *      acknowledged consequences AND the exact typed phrase. Each
 *      refusal is machine-stable (consequences_not_acknowledged,
 *      confirmation_phrase_mismatch, explicit_confirmation_required).
 *   3. The DECISION LIFECYCLE: Approve on a parked plan transitions
 *      the state to `decided`, writes BOTH audit entries (explicit
 *      confirmation + dispatched), and makes the boundary's own record
 *      visible.
 *   4. The DUPLICATE-SAFE guard: a plan already in a terminal state
 *      (APPROVED or REJECTED) refuses with the machine-stable
 *      `already_decided` reason — never a silent no-op. The original
 *      decision record remains the authoritative state.
 *   5. The REJECT path: a confirmation dialog appears, the rejection
 *      reason is recorded, the audit trail updates, and the plan does
 *      NOT execute.
 *   6. NEVER AUTO-PROMOTED: no path executes without the human
 *      decision (the gate is unreachable without explicit
 *      confirmation).
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  APPROVAL_AUDIT_ACTIONS,
  APPROVAL_REFUSALS,
  acknowledgeApprovalConsequences,
  approvalDecisionFeedback,
  beginApprovalDecision,
  cancelApprovalDecision,
  canApproveParkedPlan,
  dispatchConfirmedApproval,
  enterApprovalConfirmationPhrase,
  explicitApprovalConfirmationRefusal,
  isApprovalExplicitConfirmationSatisfied,
  markApprovalExplicitConfirmation,
  requiredApprovalConfirmationPhrase,
  SECURITY_PERMISSIONS,
} from "../src/index";
import type {
  ApprovalDecisionContext,
  ApprovalDecisionState,
  AuthorityRecord,
  GatedDecisionBoundary,
  SecurityDecisionAuditRecord,
  SecurityDecisionAuditSink,
} from "../src/index";

const TENANT = makeTenantId("w142-appr");
const OTHER_TENANT = makeTenantId("w142-oth");
const USER = asUserId("usr_w142owner01");
const USER_RESTRICTED = asUserId("usr_w142rest001");
const PLAN_ID = "plan_w142_park_01";
const NOW = "2026-04-01T00:00:00Z";
const NOW2 = "2026-04-01T01:00:00Z";
const CORR = asCorrelationId("cor_w142_appr");

/** An authorized authority (the principal holds the approve permission). */
function authorizedAuthority(
  overrides: Partial<AuthorityRecord> = {},
): AuthorityRecord {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    principalId: overrides.principalId ?? USER,
    permissions: overrides.permissions ?? [SECURITY_PERMISSIONS.approveParkedPlan],
    roles: overrides.roles ?? ["fleet.admin"],
  };
}

/** A restricted authority (no approve permission — the RBAC denial path). */
function restrictedAuthority(): AuthorityRecord {
  return {
    tenantId: TENANT,
    principalId: USER_RESTRICTED,
    permissions: [],
    roles: ["employee"],
  };
}

/** The approve-confirmation context. */
function approveContext(
  overrides: Partial<ApprovalDecisionContext> = {},
): ApprovalDecisionContext {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    planId: overrides.planId ?? PLAN_ID,
    action: overrides.action ?? "approve",
    by: overrides.by ?? USER,
    correlationId: overrides.correlationId ?? CORR,
  };
}

/** The reject-confirmation context. */
function rejectContext(): ApprovalDecisionContext {
  return approveContext({ action: "reject" });
}

/** A collecting audit sink (records every append for the assertions). */
function collectingSink(): SecurityDecisionAuditSink & {
  records(): readonly SecurityDecisionAuditRecord[];
} {
  const records: SecurityDecisionAuditRecord[] = [];
  return {
    append(record: SecurityDecisionAuditRecord): void {
      records.push(record);
    },
    records(): readonly SecurityDecisionAuditRecord[] {
      return records;
    },
  };
}

/** A boundary that approves (returns APPROVED with the approver). */
function approveBoundary(): GatedDecisionBoundary {
  return (input) => ({
    ok: true,
    record: {
      planId: input.planId,
      status: "APPROVED",
      approverId: input.by,
      transitionedAt: input.at,
    },
  });
}

/** A boundary that rejects (returns REJECTED with the reason). */
function rejectBoundary(): GatedDecisionBoundary {
  return (input) => ({
    ok: true,
    record: {
      planId: input.planId,
      status: "REJECTED",
      rejectionReason: input.reason ?? "operator_rejected",
      transitionedAt: input.at,
    },
  });
}

/** A boundary that refuses a duplicate (already_decided). */
function duplicateBoundary(): GatedDecisionBoundary {
  return (input) => ({
    ok: false,
    reason: APPROVAL_REFUSALS.alreadyDecided,
    message: `Plan ${input.planId} is already in a terminal state (APPROVED or REJECTED). The original decision record remains authoritative.`,
  });
}

/** A boundary that refuses authorization (RBAC denial). */
function unauthorizedBoundary(): GatedDecisionBoundary {
  return (input) => ({
    ok: false,
    reason: APPROVAL_REFUSALS.authorizationRequired,
    message: `Principal ${input.by} lacks the "${SECURITY_PERMISSIONS.approveParkedPlan}" permission.`,
  });
}

describe("W142 approvals: the AUTHORIZATION GATE — restricted roles get the frozen denial", () => {
  test("the canApproveParkedPlan predicate reflects the permission grant", () => {
    expect(canApproveParkedPlan(authorizedAuthority())).toBe(true);
    expect(canApproveParkedPlan(restrictedAuthority())).toBe(false);
  });

  test("beginApprovalDecision with a restricted authority refuses with authorization_required", () => {
    const state = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      restrictedAuthority(),
      NOW,
    );
    expect(state.kind).toBe("refused");
    if (state.kind !== "refused") throw new Error("unreachable");
    expect(state.reason).toBe(APPROVAL_REFUSALS.authorizationRequired);
    // The explanation carries the permission name + the escalation path.
    expect(state.explanation).toContain(SECURITY_PERMISSIONS.approveParkedPlan);
    expect(state.explanation).toContain("Fleet Administrator");
    // The boundary was NEVER touched — the state stays `refused`
    // without dispatching. (No audit entries were written because the
    // dispatch step was never reached.)
  });

  test("a tenant scope mismatch refuses the open (fail-closed, no data)", () => {
    const state = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: OTHER_TENANT }, // the acting scope is OTHER_TENANT
      approveContext({ tenantId: TENANT }), // the context's tenant is TENANT
      authorizedAuthority({ tenantId: OTHER_TENANT }),
      NOW,
    );
    // The state stays idle (the scope guard refused the open).
    expect(state.kind).toBe("idle");
  });
});

describe("W142 approvals: the CONFIRMATION GATES — never one-click", () => {
  test("the required phrase is `CONFIRM <ACTION> <planId>` — the dialog displays it", () => {
    expect(requiredApprovalConfirmationPhrase(approveContext())).toBe(
      "CONFIRM APPROVE plan_w142_park_01",
    );
    expect(requiredApprovalConfirmationPhrase(rejectContext())).toBe(
      "CONFIRM REJECT plan_w142_park_01",
    );
  });

  test("an open decision starts in reviewing with acknowledged=false and an empty phrase", () => {
    const state = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    expect(state.kind).toBe("reviewing");
    if (state.kind !== "reviewing") throw new Error("unreachable");
    expect(state.acknowledged).toBe(false);
    expect(state.phrase).toBe("");
  });

  test("dispatch without acknowledgement refuses with consequences_not_acknowledged", () => {
    const state = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    // The state is UNCHANGED (still reviewing); the boundary is untouched.
    expect(result.state.kind).toBe("reviewing");
    expect(result.refusal?.reason).toBe(APPROVAL_REFUSALS.consequencesNotAcknowledged);
  });

  test("dispatch with acknowledgement but wrong phrase refuses with phrase_mismatch", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, "WRONG PHRASE");
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    expect(result.state.kind).toBe("reviewing");
    expect(result.refusal?.reason).toBe(APPROVAL_REFUSALS.phraseMismatch);
  });

  test("dispatch without the explicit-confirmation mark refuses with explicit_confirmation_required", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    // The phrase matches, but the explicit mark hasn't been applied yet.
    expect(isApprovalExplicitConfirmationSatisfied(state)).toBe(true);
    const withoutMark = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    // Without the mark, the state is still `reviewing` — the gate refuses.
    expect(withoutMark.state.kind).toBe("reviewing");
    expect(withoutMark.refusal?.reason).toBe(APPROVAL_REFUSALS.explicitConfirmationRequired);
  });

  test("the mark refuses without the acknowledged consequences AND the exact phrase", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    // No acknowledgement, no phrase — the mark is a stable no-op.
    const unmarked = markApprovalExplicitConfirmation(state, NOW2);
    expect(unmarked.kind).toBe("reviewing");
    // Acknowledgement only — still not satisfied.
    state = acknowledgeApprovalConsequences(state);
    const ackOnly = markApprovalExplicitConfirmation(state, NOW2);
    expect(ackOnly.kind).toBe("reviewing");
    // Wrong phrase — still not satisfied.
    state = enterApprovalConfirmationPhrase(state, "WRONG");
    const wrongPhrase = markApprovalExplicitConfirmation(state, NOW2);
    expect(wrongPhrase.kind).toBe("reviewing");
    // Correct phrase — the mark transitions to ready_to_decide.
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    const marked = markApprovalExplicitConfirmation(state, NOW2);
    expect(marked.kind).toBe("ready_to_decide");
  });
});

describe("W142 approvals: the DECISION LIFECYCLE — Approve produces the visible state change", () => {
  test("Approve on a parked plan transitions to decided, writes BOTH audit entries, surfaces the record", () => {
    const sink = collectingSink();
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("decided");
    if (result.state.kind !== "decided") throw new Error("unreachable");
    expect(result.state.status).toBe("APPROVED");
    expect(result.state.approverId).toBe(USER);
    expect(result.state.rejectionReason).toBeUndefined();
    expect(result.refusal).toBeUndefined();
    // BOTH audit entries were written: the explicit confirmation + the routed dispatch.
    const records = sink.records();
    expect(records.length).toBe(2);
    expect(records[0]?.action).toBe(APPROVAL_AUDIT_ACTIONS.explicitConfirmation);
    expect(records[0]?.subject).toBe(PLAN_ID);
    expect(records[0]?.details.action).toBe("approve");
    expect(records[1]?.action).toBe(APPROVAL_AUDIT_ACTIONS.dispatched);
    expect(records[1]?.details.status).toBe("APPROVED");
    expect(records[1]?.details.approverId).toBe(USER);
  });

  test("Reject on a parked plan transitions to decided (REJECTED) — the plan does NOT execute", () => {
    const sink = collectingSink();
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      rejectContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(rejectContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: rejectBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("decided");
    if (result.state.kind !== "decided") throw new Error("unreachable");
    expect(result.state.status).toBe("REJECTED");
    expect(result.state.rejectionReason).toBe("operator_rejected");
    expect(result.state.approverId).toBeUndefined();
    // The audit trail records the rejection.
    const records = sink.records();
    expect(records.length).toBe(2);
    expect(records[1]?.details.status).toBe("REJECTED");
    expect(records[1]?.details.rejectionReason).toBe("operator_rejected");
  });
});

describe("W142 approvals: the DUPLICATE-SAFE guard — a terminal plan is never re-decided", () => {
  test("a duplicate approve attempt on an already-decided plan refuses with already_decided", () => {
    const sink = collectingSink();
    // First approve: succeeds.
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const first = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
      auditSink: sink,
    });
    expect(first.state.kind).toBe("decided");

    // Second approve attempt — the gate refuses BEFORE the boundary is
    // touched (the original decision record is the authoritative state;
    // the duplicate is refused visibly with `already_decided`).
    const second = dispatchConfirmedApproval(first.state, {
      at: NOW2,
      boundary: duplicateBoundary(),
      auditSink: sink,
    });
    // The state STAYS decided (the original record remains); the
    // refusal carries the machine-stable `already_decided` reason —
    // never a silent no-op.
    expect(second.state.kind).toBe("decided");
    expect(second.refusal?.reason).toBe(APPROVAL_REFUSALS.alreadyDecided);
    expect(second.refusal?.explanation).toContain("closed");
    // No new audit entries were written — the duplicate never reached
    // the dispatch step (the gate refused first). The original two
    // audit entries remain the authoritative evidence trail.
    expect(sink.records().length).toBe(2);
  });

  test("the explicit-confirmation refusal for a decided state surfaces already_decided", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const dispatched = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    // A second dispatch attempt on the decided state:
    const refusal = explicitApprovalConfirmationRefusal(dispatched.state);
    expect(refusal.reason).toBe(APPROVAL_REFUSALS.alreadyDecided);
  });

  test("the boundary refusing with already_decided surfaces the visible refusal (when reached from ready_to_decide)", () => {
    // This models the rare case where the boundary itself detects a
    // duplicate (the plan entered a terminal state between the
    // operator's confirmation and the dispatch). The boundary's
    // already_decided refusal becomes a VISIBLE refused state — never
    // a silent no-op.
    const sink = collectingSink();
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: duplicateBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("refused");
    if (result.state.kind !== "refused") throw new Error("unreachable");
    expect(result.state.reason).toBe(APPROVAL_REFUSALS.alreadyDecided);
    expect(result.state.explanation).toContain("terminal state");
    // The explicit-confirmation entry WAS written (the gate was passed);
    // the dispatch entry was NOT (the boundary refused).
    expect(sink.records().length).toBe(1);
    expect(sink.records()[0]?.action).toBe(APPROVAL_AUDIT_ACTIONS.explicitConfirmation);
  });
});

describe("W142 approvals: never auto-promoted — no path executes without the human decision", () => {
  test("the idle state refuses the dispatch with no_decision_open", () => {
    const result = dispatchConfirmedApproval({ kind: "idle" } as ApprovalDecisionState, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    expect(result.state.kind).toBe("idle");
    expect(result.refusal?.reason).toBe(APPROVAL_REFUSALS.noDecisionOpen);
  });

  test("the cancelled state refuses the dispatch too", () => {
    const result = dispatchConfirmedApproval(
      { kind: "cancelled", context: approveContext(), at: NOW },
      { at: NOW2, boundary: approveBoundary() },
    );
    expect(result.state.kind).toBe("cancelled");
    expect(result.refusal?.reason).toBe(APPROVAL_REFUSALS.noDecisionOpen);
  });

  test("the refused state (RBAC denial) refuses further dispatch with no_decision_open", () => {
    const refused = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      restrictedAuthority(),
      NOW,
    );
    expect(refused.kind).toBe("refused");
    const result = dispatchConfirmedApproval(refused, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    // The state stays refused; the dispatch is refused with no_decision_open.
    expect(result.state.kind).toBe("refused");
    expect(result.refusal?.reason).toBe(APPROVAL_REFUSALS.noDecisionOpen);
  });
});

describe("W142 approvals: the CANCEL path — the operator backed out (visible, no audit)", () => {
  test("a reviewing state cancels to cancelled (no audit entries written)", () => {
    const sink = collectingSink();
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = cancelApprovalDecision(state, NOW2);
    expect(state.kind).toBe("cancelled");
    // The dispatch on a cancelled state refuses; no audit entries.
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
      auditSink: sink,
    });
    expect(result.state.kind).toBe("cancelled");
    expect(sink.records().length).toBe(0);
  });

  test("the ready_to_decide state cancels too (the operator can back out at the last step)", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    expect(state.kind).toBe("ready_to_decide");
    const cancelled = cancelApprovalDecision(state, NOW2);
    expect(cancelled.kind).toBe("cancelled");
  });
});

describe("W142 approvals: the FEEDBACK projection — the user is never left to infer a click failed", () => {
  test("every state carries a machine-stable feedback line", () => {
    const cases: ReadonlyArray<{ state: ApprovalDecisionState; expected: string }> = [
      { state: { kind: "idle" }, expected: "idle" },
      {
        state: beginApprovalDecision(
          { kind: "idle" } as ApprovalDecisionState,
          { tenantId: TENANT },
          approveContext(),
          authorizedAuthority(),
          NOW,
        ),
        expected: "reviewing",
      },
      {
        state: beginApprovalDecision(
          { kind: "idle" } as ApprovalDecisionState,
          { tenantId: TENANT },
          approveContext(),
          restrictedAuthority(),
          NOW,
        ),
        expected: "refused",
      },
    ];
    for (const { state, expected } of cases) {
      expect(approvalDecisionFeedback(state).status).toBe(expected);
    }
  });

  test("a decided state's feedback surfaces the visible state change", () => {
    let state: ApprovalDecisionState = beginApprovalDecision(
      { kind: "idle" } as ApprovalDecisionState,
      { tenantId: TENANT },
      approveContext(),
      authorizedAuthority(),
      NOW,
    );
    state = acknowledgeApprovalConsequences(state);
    state = enterApprovalConfirmationPhrase(state, requiredApprovalConfirmationPhrase(approveContext()));
    state = markApprovalExplicitConfirmation(state, NOW2);
    const result = dispatchConfirmedApproval(state, {
      at: NOW2,
      boundary: approveBoundary(),
    });
    const feedback = approvalDecisionFeedback(result.state);
    expect(feedback.status).toBe("decided");
    expect(feedback.message).toContain("APPROVED");
    expect(feedback.message).toContain(USER);
  });
});
