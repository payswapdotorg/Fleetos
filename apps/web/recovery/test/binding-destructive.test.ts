/**
 * W060A web-recovery — D4 binding tests: the destructive action
 * surfaces over the REAL `@fleetos/recovery` destructive gate + the
 * REAL W031 Contract Guardian engine + the REAL W020 EndpointAdapter.
 *
 * The REAL `DestructiveRequestRecord` values flow where the surface's
 * `DestructiveRequestLike` seam is expected (the Guardian decision is
 * the FROZEN contracts shape, verbatim) — the structural proof. These
 * tests are the runtime proof that:
 *
 *   - the affordance is GATED-PATH-ONLY: there is NO direct-execution
 *     variant (the surface contracts make one-click lock/locate/wipe/
 *     reboot unrepresentable — LOCK items 16 + 19);
 *   - every affordance carries the full gate-step ledger (tenant
 *     scope -> active case -> adapter capability -> Guardian
 *     evaluation -> human approval -> execution dispatch), each step
 *     machine-stably met/unmet/pending;
 *   - the W031 Guardian decision context is surfaced verbatim: the
 *     decision type, the frozen blocking semantics, the matched rule
 *     refs, the machine-stable reasons, the OPAQUE evidence refs;
 *   - REQUIRE_APPROVAL parks the REAL request; the human-approval step
 *     (approve -> APPROVED + EXECUTED through the REAL adapter) is a
 *     DISPLAYED gate, never auto-executed;
 *   - BLOCK rejects with the Guardian's machine-stable reasons and
 *     the refusal surfaces verbatim;
 *   - the versioned append-only history + the execution dispatch
 *     evidence (opaque) surface read-only;
 *   - a foreign request is indistinguishable from unknown; the views
 *     replay byte-identically (determinism).
 */

import { test, expect } from "bun:test";
import {
  DESTRUCTIVE_GATE_STEP_IDS,
  buildDestructiveRequestViewModel,
  destructiveActionAffordance,
  guardianDecisionContext,
} from "../src/index";
import type { DestructiveActionAffordance } from "../src/index";
import {
  FULLY_CAPABLE,
  REAL_CASE_TABLE,
  REAL_REQUEST_TABLE,
  SCOPE_A,
  SCOPE_B,
  T0,
  adapter,
  approveDestructiveOrThrow,
  atHour,
  createInMemoryDestructiveRequestStore,
  createInMemoryRecoveryCaseStore,
  evidenceRef,
  lostTrigger,
  openCaseOrThrow,
  realCaseSource,
  realDestructiveSource,
  requestDestructiveOrThrow,
  approvalRule,
  blockRule,
  warnRule,
} from "./helpers";
import { caseStateMachineView } from "../src/index";

/** The canonical destructive-gate run: an OPENED case + a capable adapter. */
function gateRun() {
  const caseStore = createInMemoryRecoveryCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const caseRecord = openCaseOrThrow(caseStore, "dev_testdevice00a1" as never, lostTrigger(), {
    lastSeenRecordId: "ls_abc",
    lastSeenObservedAt: atHour(1),
  });
  return {
    caseStore,
    requestStore,
    caseRecord,
    adapter: adapter(SCOPE_A.tenantId, "dev_testdevice00a1" as never, FULLY_CAPABLE),
  };
}

/** The case's read-only machine view for the affordance derivation. */
function machineOf(run: ReturnType<typeof gateRun>): ReturnType<typeof caseStateMachineView> {
  const source = realCaseSource(run.caseStore);
  const view = source.latest(SCOPE_A.tenantId, run.caseRecord.caseId);
  if (view === undefined) throw new Error("case vanished");
  return caseStateMachineView(view.status, REAL_CASE_TABLE);
}

test("the affordance is gated-path-only: NO direct-execution variant exists (LOCK 16 + 19)", () => {
  const run = gateRun();
  const affordance = destructiveActionAffordance("wipe", machineOf(run), undefined);
  expect(affordance.kind).toBe("gated_path_only");
  // the type-level proof: the ONLY variant of DestructiveActionAffordance
  expect((affordance as DestructiveActionAffordance).kind).toBe("gated_path_only");
  // the requirement flags are permanently true — the surface cannot waive them
  expect(affordance.requiresActiveCase).toBe(true);
  expect(affordance.requiresGuardianEvaluation).toBe(true);
  expect(affordance.requiresEvidenceTrail).toBe(true);
  expect(affordance.guardian).toBe("not_evaluated");
  // the gate-step ledger rides EVERY affordance, machine-stable ids
  expect(affordance.steps.map((step) => step.id)).toEqual([...DESTRUCTIVE_GATE_STEP_IDS]);
  expect(affordance.approvalPending).toBe(false);
  expect(affordance.approvalRequired).toBe(false);
});

test("the gate-step ledger displays the domain's gate order met/unmet/pending", () => {
  const run = gateRun();
  const machine = machineOf(run);

  // Before any request: only the tenant scope + the active case are met
  const before = destructiveActionAffordance("lock", machine, undefined);
  expect(before.steps.map((step) => [step.id, step.state])).toEqual([
    ["tenant_scope", "met"],
    ["active_recovery_case", "met"],
    ["adapter_capability", "unmet"],
    ["guardian_evaluation", "unmet"],
    ["human_approval", "unmet"],
    ["execution_dispatch", "unmet"],
  ]);

  // A non-active case gate closes the destructive path visibly
  const closedMachine = caseStateMachineView("SECURED", REAL_CASE_TABLE);
  const closed = destructiveActionAffordance("lock", closedMachine, undefined);
  expect(closed.steps.find((step) => step.id === "active_recovery_case")?.state).toBe("unmet");
});

test("ALLOW routes a REAL request to EXECUTED; the affordance displays the Guardian decision verbatim", () => {
  const run = gateRun();
  const executed = requestDestructiveOrThrow(run, "lock", [], atHour(2));
  expect(executed.status).toBe("EXECUTED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    executed.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.action).toBe("lock");
  expect(view.status).toBe("EXECUTED");
  expect(view.stateMachine.isTerminal).toBe(true);
  expect(view.guardian).not.toBe("not_evaluated");
  if (view.guardian === "not_evaluated") throw new Error("unreachable");
  expect(view.guardian.decision).toBe("ALLOW");
  expect(view.guardian.isBlocking).toBe(false); // the frozen semantics
  expect(view.approval.required).toBe(false);
  expect(view.execution).toBeDefined();
  expect(view.execution?.outcome).toBe("executed");
  expect(view.execution?.evidenceCount).toBeGreaterThanOrEqual(0);
  // the §16 evidence trail is surfaced OPAQUE (verbatim refs)
  expect(view.evidence.length).toBeGreaterThanOrEqual(1);
  expect(view.evidence[0]?.key).toBe("evidence/lock-request");
  // the versioned history: REQUESTED -> ADVANCED -> EXECUTED
  expect(view.history.map((r) => [r.version, r.status])).toEqual([
    [1, "REQUESTED"],
    [2, "ADVANCED"],
    [3, "EXECUTED"],
  ]);

  // the affordance over the executed request: every gate met
  const affordance = destructiveActionAffordance("lock", machineOf(run), {
    ...executed,
    action: executed.intentPayload.action,
  });
  expect(affordance.steps.every((step) => step.state === "met")).toBe(true);
});

test("WARN advances with the warning context; the reasons surface machine-stable", () => {
  const run = gateRun();
  const executed = requestDestructiveOrThrow(
    run,
    "reboot",
    [warnRule(SCOPE_A.tenantId, "device.reboot")],
    atHour(2),
  );
  expect(executed.status).toBe("EXECUTED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    executed.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  if (view.guardian === "not_evaluated") throw new Error("unreachable");
  expect(view.guardian.decision).toBe("WARN");
  expect(view.guardian.isBlocking).toBe(false); // WARN is non-blocking (the frozen semantics)
  expect(view.guardian.matchedRules.length).toBeGreaterThanOrEqual(1);
  expect(view.guardian.reasons.map((r) => r.code).length).toBeGreaterThanOrEqual(1);
});

test("REQUIRE_APPROVAL parks the REAL request; the human approval is a DISPLAYED gate, never auto-executed", () => {
  const run = gateRun();
  const parked = requestDestructiveOrThrow(
    run,
    "wipe",
    [approvalRule(SCOPE_A.tenantId, "device.wipe")],
    atHour(2),
  );
  expect(parked.status).toBe("PARKED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    parked.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.status).toBe("PARKED");
  expect(view.stateMachine.isTerminal).toBe(false);
  expect([...view.stateMachine.legalNext]).toEqual(["APPROVED", "REJECTED"]); // the human step
  if (view.guardian === "not_evaluated") throw new Error("unreachable");
  expect(view.guardian.decision).toBe("REQUIRE_APPROVAL");
  expect(view.guardian.isBlocking).toBe(true); // the frozen blocking semantics
  expect(view.approval.required).toBe(true);
  expect(view.approval.pending).toBe(true); // awaiting the human decision — VISIBLE
  expect(view.approval.decided).toBeUndefined();
  expect(view.execution).toBeUndefined(); // NOTHING dispatched while parked

  // the affordance displays the pending approval gate
  const affordance = destructiveActionAffordance("wipe", machineOf(run), {
    ...parked,
    action: parked.intentPayload.action,
  });
  expect(affordance.approvalRequired).toBe(true);
  expect(affordance.approvalPending).toBe(true);
  expect(affordance.steps.find((step) => step.id === "human_approval")?.state).toBe("pending");
  expect(affordance.steps.find((step) => step.id === "execution_dispatch")?.state).toBe("unmet");
});

test("the human-approval step: approve -> APPROVED + EXECUTED (the approval IS the explicit grant)", () => {
  const run = gateRun();
  const parked = requestDestructiveOrThrow(
    run,
    "wipe",
    [approvalRule(SCOPE_A.tenantId, "device.wipe")],
    atHour(2),
  );
  const approved = approveDestructiveOrThrow(run, parked, "approve", atHour(3));
  expect(approved.status).toBe("EXECUTED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    parked.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.status).toBe("EXECUTED");
  expect(view.approval.pending).toBe(false);
  expect(view.approval.required).toBe(true);
  expect(view.approval.decided?.by).toBe("usr_testuser00001");
  expect(view.approval.decided?.at).toBe(atHour(3));
  expect(view.execution?.outcome).toBe("executed");
  // the full versioned lineage: REQUESTED -> PARKED -> APPROVED -> EXECUTED
  expect(view.history.map((r) => [r.version, r.status])).toEqual([
    [1, "REQUESTED"],
    [2, "PARKED"],
    [3, "APPROVED"],
    [4, "EXECUTED"],
  ]);

  const affordance = destructiveActionAffordance("wipe", machineOf(run), {
    ...approved,
    action: approved.intentPayload.action,
  });
  expect(affordance.approvalDecided).toEqual({ by: "usr_testuser00001", at: atHour(3) });
  expect(affordance.steps.every((step) => step.state === "met")).toBe(true);
});

test("the human-approval step: reject -> REJECTED (terminal, machine-stable)", () => {
  const run = gateRun();
  const parked = requestDestructiveOrThrow(
    run,
    "locate",
    [approvalRule(SCOPE_A.tenantId, "device.locate")],
    atHour(2),
  );
  const rejected = approveDestructiveOrThrow(run, parked, "reject", atHour(3));
  expect(rejected.status).toBe("REJECTED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    parked.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.status).toBe("REJECTED");
  expect(view.stateMachine.isTerminal).toBe(true);
  expect(view.execution).toBeUndefined(); // nothing was ever dispatched
});

test("BLOCK rejects with the Guardian's machine-stable reasons, surfaced verbatim", () => {
  const run = gateRun();
  const rejected = requestDestructiveOrThrow(
    run,
    "wipe",
    [blockRule(SCOPE_A.tenantId, "device.wipe")],
    atHour(2),
  );
  expect(rejected.status).toBe("REJECTED");

  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    rejected.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  if (view.guardian === "not_evaluated") throw new Error("unreachable");
  expect(view.guardian.decision).toBe("BLOCK");
  expect(view.guardian.isBlocking).toBe(true);
  expect(view.guardian.matchedRules.length).toBeGreaterThanOrEqual(1);
  expect(view.stateMachine.isTerminal).toBe(true);
  expect(view.execution).toBeUndefined();

  const affordance = destructiveActionAffordance("wipe", machineOf(run), {
    ...rejected,
    action: rejected.intentPayload.action,
  });
  expect(affordance.approvalRequired).toBe(false); // BLOCK is not an approval hold
  expect(affordance.steps.find((step) => step.id === "guardian_evaluation")?.state).toBe("met");
  expect(affordance.steps.find((step) => step.id === "execution_dispatch")?.state).toBe("unmet");
});

test("the Guardian decision context view carries matched rules + reasons + OPAQUE evidence verbatim", () => {
  const run = gateRun();
  const executed = requestDestructiveOrThrow(
    run,
    "lock",
    [warnRule(SCOPE_A.tenantId, "device.lock")],
    atHour(2),
  );
  const context = guardianDecisionContext(executed.decision as never, executed.matchedRules, executed.reasons);
  expect(context.decision).toBe("WARN");
  expect(context.isBlocking).toBe(false);
  expect(context.decidedAt).toBe(atHour(2));
  expect(context.matchedRules.length).toBeGreaterThanOrEqual(1);
  expect(context.matchedRules[0]?.ruleId.length).toBeGreaterThan(0);
  expect(context.reasons.length).toBeGreaterThanOrEqual(1);
  // the decision's evidence refs pass through OPAQUE (never interpreted)
  expect(Array.isArray(context.evidence)).toBe(true);
});

test("the evidence trail is the §16 shape: refs carried verbatim, frozen", () => {
  const run = gateRun();
  const executed = requestDestructiveOrThrow(run, "lock", [], atHour(2));
  const source = realDestructiveSource(run.requestStore);
  const view = buildDestructiveRequestViewModel(
    SCOPE_A,
    source,
    executed.requestId,
    REAL_REQUEST_TABLE,
  );
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  const expected = evidenceRef("evidence/lock-request");
  expect(view.evidence).toEqual([expected]);
  expect(Object.isFrozen(view.evidence[0])).toBe(true);
});

test("tenant isolation: a foreign request is indistinguishable from unknown; a refused scope is undefined", () => {
  const run = gateRun();
  const executed = requestDestructiveOrThrow(run, "lock", [], atHour(2));
  const source = realDestructiveSource(run.requestStore);

  expect(buildDestructiveRequestViewModel(SCOPE_B, source, executed.requestId, REAL_REQUEST_TABLE)).toBeUndefined();
  expect(buildDestructiveRequestViewModel(SCOPE_A, source, "dr_unknown", REAL_REQUEST_TABLE)).toBeUndefined();
  expect(
    buildDestructiveRequestViewModel({ tenantId: "" as never }, source, executed.requestId, REAL_REQUEST_TABLE),
  ).toBeUndefined();
});

test("determinism: the same (source, request, table) replay byte-identically", () => {
  const run = gateRun();
  const parked = requestDestructiveOrThrow(
    run,
    "wipe",
    [approvalRule(SCOPE_A.tenantId, "device.wipe")],
    atHour(2),
  );
  const source = realDestructiveSource(run.requestStore);
  const first = buildDestructiveRequestViewModel(SCOPE_A, source, parked.requestId, REAL_REQUEST_TABLE);
  const second = buildDestructiveRequestViewModel(SCOPE_A, source, parked.requestId, REAL_REQUEST_TABLE);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(T0).toBe("2026-01-01T00:00:00Z"); // anchor sanity
});
