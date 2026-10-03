/**
 * W141 web-recovery — the DESTRUCTIVE-ACTION CONFIRMATION flow tests:
 * the explicit-confirmation state machine over the REAL gated boundary
 * (`@fleetos/recovery`'s requestDestructiveAction + the REAL Guardian
 * evaluation + the REAL adapter) and the REAL append-only audit log
 * (`@fleetos/audit`'s in-memory AuditLog through its REAL sink adapter —
 * the structural `ConfirmationAuditSink` proof).
 *
 * The machine proofs (the work order's destructive gates):
 *
 *   1. The confirmation flow REFUSES to proceed without the explicit
 *      confirmation: a dispatch from `idle`/`reviewing` returns the
 *      machine-stable refusal, leaves the state UNCHANGED, NEVER calls
 *      the boundary, and writes NO audit entry.
 *   2. The refusal distinguishes the unacknowledged consequences from
 *      the phrase mismatch (machine-stable reasons, frozen words).
 *   3. The full path (begin -> acknowledge -> phrase -> mark ->
 *      dispatch) routes through the REAL gated boundary; the audit
 *      entries ARE written (the explicit confirmation + the routed
 *      dispatch) into the REAL hash-chained audit log; the state
 *      change IS visible (the boundary's PARKED record).
 *   4. A boundary refusal (the Guardian BLOCKs the action) composes the
 *      VISIBLE refused state — the user never infers a failed click.
 *   5. A cancellation is visible and writes NOTHING (consequential
 *      events only).
 */

import { test, expect } from "bun:test";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { requestDestructiveAction, transitionRecoveryCase } from "@fleetos/recovery";
import type { DestructiveRequestStore } from "@fleetos/recovery";
import {
  CONFIRMATION_AUDIT_ACTIONS,
  CONFIRMATION_REFUSALS,
  acknowledgeConsequences,
  beginDestructiveConfirmation,
  cancelDestructiveConfirmation,
  confirmationFeedback,
  dispatchConfirmedDestructive,
  enterConfirmationPhrase,
  explicitConfirmationRefusal,
  isExplicitConfirmationSatisfied,
  markExplicitConfirmation,
  requiredConfirmationPhrase,
} from "../src/index";
import type {
  ConfirmationAuditSink,
  ConfirmationContext,
  DestructiveConfirmationState,
  GatedDestructiveBoundary,
} from "../src/index";
import {
  DEV_A1,
  FULLY_CAPABLE,
  SCOPE_A,
  TENANT_A,
  T0,
  USER_1,
  adapter,
  approvalRule,
  atHour,
  blockRule,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  evidenceRef,
  openCaseOrThrow,
  realGuardian,
  ruleSet,
} from "./helpers";
import type { GuardianRule } from "@fleetos/policy";
import { asCorrelationId } from "@fleetos/contracts";

const CONFIRM_AT = atHour(2);
const DISPATCH_AT = atHour(3);

/** The confirmation context fixture (the acting operator on DEV_A1). */
function context(action: string = "wipe"): ConfirmationContext {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    caseId: "rc_w141case00001",
    action,
    by: USER_1 as string,
    correlationId: asCorrelationId("cor_w141confirm1"),
  };
}

/** A REAL gated boundary over the REAL destructive gate. */
function realBoundary(
  requestStore: DestructiveRequestStore,
  caseRecord: Parameters<typeof requestDestructiveAction>[2],
  rules: readonly GuardianRule[],
): GatedDestructiveBoundary {
  return (input) => {
    const result = requestDestructiveAction(
      { tenantId: input.tenantId, correlationId: input.correlationId },
      requestStore,
      caseRecord,
      input.action as "lock" | "locate" | "wipe" | "reboot",
      {
        ruleSet: ruleSet(input.tenantId, rules),
        evaluator: realGuardian,
        adapter: adapter(input.tenantId, input.deviceId, FULLY_CAPABLE),
        at: input.at,
        correlationId: input.correlationId,
        policyCacheReady: true,
        requestedBy: input.by,
        evidence: [evidenceRef(`evidence/${input.action}-confirmation`)],
      },
    );
    if (!result.ok) {
      const error = result.error as { code: string; message: string; invariant?: string };
      // The machine-stable refusal reason: the invariant when present
      // (e.g. case_not_active), else the code.
      return { ok: false, reason: error.invariant ?? error.code, message: error.message };
    }
    return { ok: true, record: { requestId: result.record.requestId, status: result.record.status } };
  };
}

/** A gate run: the REAL case store + request store with one open case. */
function gateRun(): {
  readonly requestStore: DestructiveRequestStore;
  readonly caseRecord: ReturnType<typeof openCaseOrThrow>;
} {
  const caseStore = createInMemoryRecoveryCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const caseRecord = openCaseOrThrow(caseStore, DEV_A1, { kind: "lost_report", reportedAt: T0, reportedBy: USER_1, note: "left on a train" }, { lastSeenRecordId: "ls_w141", lastSeenObservedAt: atHour(1) });
  return { requestStore, caseRecord };
}

/** A collecting confirmation sink (the seam's local in-memory binding). */
function collectingSink(): ConfirmationAuditSink & { readonly records: readonly unknown[] } {
  const records: unknown[] = [];
  return {
    append(record): void {
      records.push(record);
    },
    get records(): readonly unknown[] {
      return records;
    },
  };
}

test("the required phrase is a pure function of the intent (machine-stable)", () => {
  expect(requiredConfirmationPhrase(context("wipe"))).toBe(`CONFIRM WIPE ${DEV_A1 as string}`);
  expect(requiredConfirmationPhrase(context("lock"))).toBe(`CONFIRM LOCK ${DEV_A1 as string}`);
});

test("GATE 1: a dispatch from idle REFUSES — no boundary call, no audit entry, state unchanged", () => {
  const { requestStore, caseRecord } = gateRun();
  const sink = collectingSink();
  let boundaryCalls = 0;
  const boundary: GatedDestructiveBoundary = (input) => {
    boundaryCalls += 1;
    return realBoundary(requestStore, caseRecord, [])(input);
  };

  const idle: DestructiveConfirmationState = { kind: "idle" };
  const result = dispatchConfirmedDestructive(idle, {
    at: DISPATCH_AT,
    boundary,
    auditSink: sink,
  });

  expect(result.refusal).toBeDefined();
  if (result.refusal === undefined) throw new Error("unreachable");
  expect(result.refusal.ok).toBe(false);
  expect(result.refusal.reason).toBe(CONFIRMATION_REFUSALS.noConfirmationOpen);
  expect(result.state.kind).toBe("idle"); // unchanged
  expect(boundaryCalls).toBe(0); // the boundary was NEVER touched
  expect(sink.records).toHaveLength(0); // NO audit entry
});

test("GATE 1: a dispatch from an unconfirmed review REFUSES with the machine-stable distinction", () => {
  const { requestStore, caseRecord } = gateRun();
  const sink = collectingSink();
  let boundaryCalls = 0;
  const boundary: GatedDestructiveBoundary = (input) => {
    boundaryCalls += 1;
    return realBoundary(requestStore, caseRecord, [])(input);
  };

  // Begin the review: the dialog is open, nothing acknowledged.
  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context(), CONFIRM_AT);
  expect(state.kind).toBe("reviewing");

  // (a) No acknowledgement: the refusal names it.
  let attempt = dispatchConfirmedDestructive(state, { at: DISPATCH_AT, boundary, auditSink: sink });
  expect(attempt.refusal?.reason).toBe(CONFIRMATION_REFUSALS.consequencesNotAcknowledged);
  expect(attempt.refusal?.explanation).toContain("consequences have not been acknowledged");
  expect(attempt.state.kind).toBe("reviewing"); // unchanged

  // (b) Acknowledged but the phrase is wrong: the refusal names THAT.
  state = acknowledgeConsequences(state);
  attempt = dispatchConfirmedDestructive(state, { at: DISPATCH_AT, boundary, auditSink: sink });
  expect(attempt.refusal?.reason).toBe(CONFIRMATION_REFUSALS.phraseMismatch);
  expect(attempt.refusal?.explanation).toContain("CONFIRM WIPE");
  expect(attempt.state.kind).toBe("reviewing"); // still unchanged

  // (c) A wrong phrase does NOT satisfy the gate.
  state = enterConfirmationPhrase(state, "CONFIRM WIPE wrong-device");
  expect(isExplicitConfirmationSatisfied(state)).toBe(false);
  const notMarked = markExplicitConfirmation(state, DISPATCH_AT);
  expect(notMarked.kind).toBe("reviewing"); // the mark refused
  attempt = dispatchConfirmedDestructive(notMarked, { at: DISPATCH_AT, boundary, auditSink: sink });
  expect(attempt.refusal?.reason).toBe(CONFIRMATION_REFUSALS.phraseMismatch);

  // Nothing was routed, nothing audited across every refused attempt.
  expect(boundaryCalls).toBe(0);
  expect(sink.records).toHaveLength(0);
  expect(requestStore.listRequestIds({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_webrecov_tst1") }, )).toHaveLength(0);
});

test("the refusal projection is total (every state gets frozen words)", () => {
  const idle: DestructiveConfirmationState = { kind: "idle" };
  expect(explicitConfirmationRefusal(idle).reason).toBe(CONFIRMATION_REFUSALS.noConfirmationOpen);
  const dispatched: DestructiveConfirmationState = {
    kind: "dispatched",
    context: context(),
    requestId: "dr_x",
    status: "PARKED",
    at: DISPATCH_AT,
  };
  const closedRefusal = explicitConfirmationRefusal(dispatched);
  expect(closedRefusal.reason).toBe(CONFIRMATION_REFUSALS.noConfirmationOpen);
  expect(closedRefusal.explanation).toContain("closed");
});

test("GATE 2: the full explicit path dispatches through the REAL boundary, writes the REAL audit entries, and the state change is visible", () => {
  const { requestStore, caseRecord } = gateRun();
  // The REAL audit log (the hash-chained append-only trail) + its REAL
  // sink adapter — the structural seam proof: the adapter's AuditSink
  // satisfies ConfirmationAuditSink unchanged.
  const auditLog: AuditLog = createInMemoryAuditLog();
  const adapted = createAuditSinkAdapter(auditLog, {
    source: "web-recovery.confirmation",
  });
  // The structural binding proof: the REAL @fleetos/audit sink adapter's
  // AuditSink satisfies the lane's ConfirmationAuditSink seam unchanged.
  const sink: ConfirmationAuditSink = adapted;
  const rules = [approvalRule(TENANT_A, "device.wipe")]; // REQUIRE_APPROVAL -> PARKED
  const boundary = realBoundary(requestStore, caseRecord, rules);

  // The full path: begin -> acknowledge -> phrase -> mark -> dispatch.
  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context(), CONFIRM_AT);
  state = acknowledgeConsequences(state);
  state = enterConfirmationPhrase(state, requiredConfirmationPhrase(context()));
  expect(isExplicitConfirmationSatisfied(state)).toBe(true);
  state = markExplicitConfirmation(state, DISPATCH_AT);
  expect(state.kind).toBe("ready_to_dispatch");

  const result = dispatchConfirmedDestructive(state, {
    at: DISPATCH_AT,
    boundary,
    auditSink: sink,
  });
  expect(result.refusal).toBeUndefined();

  // The state change is VISIBLE: the boundary's PARKED record.
  expect(result.state.kind).toBe("dispatched");
  if (result.state.kind !== "dispatched") throw new Error("unreachable");
  expect(result.state.status).toBe("PARKED"); // the REAL Guardian held it for a human
  expect(result.state.requestId.length).toBeGreaterThan(0);

  // The REAL request store carries the record (the visible state change
  // the recomposed feed will render).
  const stored = requestStore.getLatestRequest(
    { tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141confirm1") },
    result.state.requestId,
  );
  expect(stored).toBeDefined();
  expect(stored?.status).toBe("PARKED");

  // The audit entries ARE written: the explicit confirmation + the
  // routed dispatch, in the REAL hash-chained log, and the chain
  // verifies.
  const records = auditLog.records({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141confirm1") });
  const actions = records.map((record) => record.action);
  expect(actions).toContain(CONFIRMATION_AUDIT_ACTIONS.explicitConfirmation);
  expect(actions).toContain(CONFIRMATION_AUDIT_ACTIONS.dispatched);
  const confirmationRecord = records.find(
    (record) => record.action === CONFIRMATION_AUDIT_ACTIONS.explicitConfirmation,
  );
  if (confirmationRecord === undefined) throw new Error("confirmation audit record missing");
  const confirmationDetails: Record<string, unknown> = { ...confirmationRecord.details };
  expect(confirmationDetails).toMatchObject({
    action: "wipe",
    caseId: context().caseId,
    acknowledged: true,
  });
  const dispatchRecord = records.find(
    (record) => record.action === CONFIRMATION_AUDIT_ACTIONS.dispatched,
  );
  if (dispatchRecord === undefined) throw new Error("dispatch audit record missing");
  const dispatchDetails: Record<string, unknown> = { ...dispatchRecord.details };
  expect(dispatchDetails).toMatchObject({
    requestId: result.state.requestId,
    status: "PARKED",
  });
  expect(auditLog.verify({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141confirm1") }).ok).toBe(true);

  // The feedback line names the visible outcome.
  const feedback = confirmationFeedback(result.state);
  expect(feedback.status).toBe("dispatched");
  expect(feedback.message).toContain(result.state.requestId);
});

test("GATE 3: a boundary refusal composes the VISIBLE refused state (the case is closed)", () => {
  // A CLOSED case: the REAL boundary refuses machine-stably
  // (case_not_active) — the confirmation flow surfaces it, never silence.
  const caseStore = createInMemoryRecoveryCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const opened = openCaseOrThrow(caseStore, DEV_A1, { kind: "lost_report", reportedAt: T0, reportedBy: USER_1, note: "left on a train" }, { lastSeenRecordId: "ls_w141", lastSeenObservedAt: atHour(1) });
  const closed = transitionRecoveryCase(
    { tenantId: TENANT_A, correlationId: asCorrelationId("cor_w141confirm1") },
    caseStore,
    opened,
    "CLOSED",
    { at: atHour(1), correlationId: asCorrelationId("cor_w141confirm1"), closureReason: "operator_cancelled" },
  );
  expect(closed.ok).toBe(true);

  const sink = collectingSink();
  const boundary = realBoundary(requestStore, closed.ok ? closed.record : opened, []);

  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context(), CONFIRM_AT);
  state = acknowledgeConsequences(state);
  state = enterConfirmationPhrase(state, requiredConfirmationPhrase(context()));
  state = markExplicitConfirmation(state, DISPATCH_AT);

  const result = dispatchConfirmedDestructive(state, {
    at: DISPATCH_AT,
    boundary,
    auditSink: sink,
  });

  // The refusal is VISIBLE — never a silent failure.
  expect(result.state.kind).toBe("refused");
  if (result.state.kind !== "refused") throw new Error("unreachable");
  expect(result.state.reason).toBe("case_not_active");
  expect(result.state.explanation).toContain("not an active recovery state");
  const feedback = confirmationFeedback(result.state);
  expect(feedback.status).toBe("refused");
  expect(feedback.message).toContain("refused");
});

test("a Guardian BLOCK composes the boundary's VISIBLE REJECTED record (the negative outcome is a record, not silence)", () => {
  const { requestStore, caseRecord } = gateRun();
  const sink = collectingSink();
  const rules = [blockRule(TENANT_A, "device.wipe")]; // BLOCK -> REJECTED at the boundary
  const boundary = realBoundary(requestStore, caseRecord, rules);

  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context(), CONFIRM_AT);
  state = acknowledgeConsequences(state);
  state = enterConfirmationPhrase(state, requiredConfirmationPhrase(context()));
  state = markExplicitConfirmation(state, DISPATCH_AT);

  const result = dispatchConfirmedDestructive(state, {
    at: DISPATCH_AT,
    boundary,
    auditSink: sink,
  });
  expect(result.refusal).toBeUndefined();
  // The REAL boundary recorded the Guardian's BLOCK as a REJECTED
  // revision — a terminal, visible, negative outcome.
  expect(result.state.kind).toBe("dispatched");
  if (result.state.kind !== "dispatched") throw new Error("unreachable");
  expect(result.state.status).toBe("REJECTED");
  const feedback = confirmationFeedback(result.state);
  expect(feedback.message).toContain("REJECTED");
});

test("a cancellation is visible, routes nothing, and writes NO audit entry", () => {
  const { requestStore, caseRecord } = gateRun();
  const sink = collectingSink();
  const boundary = realBoundary(requestStore, caseRecord, []);

  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context(), CONFIRM_AT);
  state = acknowledgeConsequences(state);
  state = enterConfirmationPhrase(state, requiredConfirmationPhrase(context()));
  // Cancel BEFORE the mark: the operator backed out.
  state = cancelDestructiveConfirmation(state, DISPATCH_AT);
  expect(state.kind).toBe("cancelled");

  // A dispatch after the cancel REFUSES (nothing is open).
  const attempt = dispatchConfirmedDestructive(state, { at: DISPATCH_AT, boundary, auditSink: sink });
  expect(attempt.refusal?.reason).toBe(CONFIRMATION_REFUSALS.noConfirmationOpen);
  expect(sink.records).toHaveLength(0); // nothing audited
  const feedback = confirmationFeedback(state);
  expect(feedback.status).toBe("cancelled");
  expect(feedback.message).toContain("Nothing was requested");
});

test("the open confirmation stands: a second begin is a stable no-op (never two dialogs)", () => {
  let state: DestructiveConfirmationState = { kind: "idle" };
  state = beginDestructiveConfirmation(state, SCOPE_A, context("lock"), CONFIRM_AT);
  expect(state.kind).toBe("reviewing");
  const second = beginDestructiveConfirmation(state, SCOPE_A, context("wipe"), CONFIRM_AT);
  expect(second).toBe(state); // the SAME frozen state — the first stands

  // A refused scope never opens a confirmation at all.
  const refused = beginDestructiveConfirmation(
    { kind: "idle" },
    { tenantId: "" as never },
    context(),
    CONFIRM_AT,
  );
  expect(refused.kind).toBe("idle");
});

test("determinism: the same inputs produce the same machine states (frozen records)", () => {
  const first = beginDestructiveConfirmation({ kind: "idle" }, SCOPE_A, context(), CONFIRM_AT);
  const second = beginDestructiveConfirmation({ kind: "idle" }, SCOPE_A, context(), CONFIRM_AT);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));

  let a = first;
  let b = second;
  a = acknowledgeConsequences(a);
  b = acknowledgeConsequences(b);
  a = enterConfirmationPhrase(a, requiredConfirmationPhrase(context()));
  b = enterConfirmationPhrase(b, requiredConfirmationPhrase(context()));
  a = markExplicitConfirmation(a, DISPATCH_AT);
  b = markExplicitConfirmation(b, DISPATCH_AT);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
