/**
 * W060A web-recovery — D2 binding tests: the recovery case surface
 * over the REAL `@fleetos/recovery` case store + the REAL frozen
 * transition tables.
 *
 * The REAL `RecoveryCaseRecord` values flow where the surface's
 * `RecoveryCaseLike` seam is expected, and the REAL
 * `RECOVERY_CASE_TRANSITIONS` + terminal + active tables are injected
 * where `StatusMachineTable` is expected — the structural proofs.
 * These tests are the runtime proof that:
 *
 *   - the PROPOSAL-gated transitions display exactly the domain's
 *     frozen table (legal next statuses, terminal + active flags);
 *   - the versioned history is surfaced append-only, read-only;
 *   - the evidence basis cites typed refs (last-seen record id +
 *     posture finding refs) without re-deriving them;
 *   - the destructive-gate precondition (ACTIVE status) is VISIBLE;
 *   - closure reasons surface machine-stable;
 *   - a foreign case is indistinguishable from unknown; the view
 *     replays byte-identically (determinism).
 */

import { test, expect } from "bun:test";
import { transitionRecoveryCase } from "@fleetos/recovery";
import {
  buildRecoveryCaseListViewModel,
  buildRecoveryCaseViewModel,
  caseStateMachineView,
} from "../src/index";
import {
  REAL_CASE_TABLE,
  SCOPE_A,
  SCOPE_B,
  T0,
  atHour,
  createInMemoryRecoveryCaseStore,
  lostTrigger,
  openCaseOrThrow,
  postureTrigger,
  realCaseSource,
} from "./helpers";

test("the case state machine view mirrors the REAL frozen table exhaustively", () => {
  const expectations: readonly (readonly [string, readonly string[]])[] = [
    ["OPENED", ["SECURING", "ESCALATED", "CLOSED"]],
    ["SECURING", ["SECURED", "ESCALATED", "CLOSED"]],
    ["SECURED", ["ESCALATED", "CLOSED"]],
    ["ESCALATED", ["REPLACEMENT_PROPOSED", "CLOSED"]],
    ["REPLACEMENT_PROPOSED", ["CLOSED"]],
    ["CLOSED", []],
  ];
  for (const [status, legalNext] of expectations) {
    const view = caseStateMachineView(status, REAL_CASE_TABLE);
    expect(view.current).toBe(status);
    expect([...view.legalNext]).toEqual([...legalNext]);
    expect(view.isTerminal).toBe(status === "CLOSED");
    expect(view.isActive).toBe(status === "OPENED" || status === "SECURING");
    expect(view.activeStatuses).toEqual(["OPENED", "SECURING"]);
  }
  // an unknown status degrades to NO legal transitions (fail-closed display)
  const unknown = caseStateMachineView("NOT_A_STATUS", REAL_CASE_TABLE);
  expect(unknown.legalNext).toHaveLength(0);
  expect(unknown.isTerminal).toBe(false);
  expect(unknown.isActive).toBe(false);
});

test("the case view-model surfaces the versioned record read-only with its evidence basis", () => {
  const store = createInMemoryRecoveryCaseStore();
  const caseRecord = openCaseOrThrow(
    store,
    "dev_testdevice00a1" as never,
    lostTrigger(),
    { lastSeenRecordId: "ls_abc", lastSeenObservedAt: atHour(1), postureFindingRefs: ["secfinding0001"] },
  );
  const source = realCaseSource(store);

  const view = buildRecoveryCaseViewModel(SCOPE_A, source, caseRecord.caseId, REAL_CASE_TABLE);
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.caseId).toBe(caseRecord.caseId);
  expect(view.version).toBe(1);
  expect(view.status).toBe("OPENED");
  expect(view.trigger.kind).toBe("lost_report");
  expect(view.trigger.reportedAt).toBe(T0);
  expect(view.trigger.note).toBe("left on a train");
  expect(view.evidenceBasis.lastSeenRecordId).toBe("ls_abc");
  expect(view.evidenceBasis.postureFindingRefs).toEqual(["secfinding0001"]);
  expect(view.history).toHaveLength(1);
  expect(view.history[0]?.status).toBe("OPENED");
  expect(view.closure).toBeUndefined();
  // the gated boundary is VISIBLE: an OPENED case accepts destructive requests
  expect(view.gating.acceptsDestructive).toBe(true);
});

test("the posture-escalation trigger surfaces its finding-ref count (typed refs, not re-derived)", () => {
  const store = createInMemoryRecoveryCaseStore();
  const caseRecord = openCaseOrThrow(store, "dev_testdevice00a1" as never, postureTrigger());
  const source = realCaseSource(store);
  const view = buildRecoveryCaseViewModel(SCOPE_A, source, caseRecord.caseId, REAL_CASE_TABLE);
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.trigger.kind).toBe("posture_escalation");
  expect(view.trigger.postureStatus).toBe("CRITICAL");
  expect(view.trigger.findingRefCount).toBe(2);
});

test("PROPOSAL-gated transitions append versioned history; the gate closes on non-active states", () => {
  const store = createInMemoryRecoveryCaseStore();
  const opened = openCaseOrThrow(store, "dev_testdevice00a1" as never, lostTrigger());
  const source = realCaseSource(store);

  // OPENED -> SECURING (still active) -> SECURED (no longer active)
  const securing = transitionRecoveryCase(
    { tenantId: SCOPE_A.tenantId, correlationId: "cor_webrecov_tst1" as never },
    store,
    opened,
    "SECURING",
    { at: atHour(1), correlationId: "cor_webrecov_tst1" as never },
  );
  expect(securing.ok).toBe(true);

  const securingView = buildRecoveryCaseViewModel(SCOPE_A, source, opened.caseId, REAL_CASE_TABLE);
  expect(securingView).toBeDefined();
  if (securingView === undefined) throw new Error("unreachable");
  expect(securingView.status).toBe("SECURING");
  expect(securingView.version).toBe(2);
  expect(securingView.gating.acceptsDestructive).toBe(true); // SECURING is active
  expect(securingView.history.map((r) => [r.version, r.status])).toEqual([
    [1, "OPENED"],
    [2, "SECURING"],
  ]);

  const secured = transitionRecoveryCase(
    { tenantId: SCOPE_A.tenantId, correlationId: "cor_webrecov_tst1" as never },
    store,
    securing.ok ? securing.record : opened,
    "SECURED",
    { at: atHour(2), correlationId: "cor_webrecov_tst1" as never },
  );
  expect(secured.ok).toBe(true);

  const securedView = buildRecoveryCaseViewModel(SCOPE_A, source, opened.caseId, REAL_CASE_TABLE);
  expect(securedView).toBeDefined();
  if (securedView === undefined) throw new Error("unreachable");
  expect(securedView.status).toBe("SECURED");
  expect(securedView.gating.acceptsDestructive).toBe(false); // the gate CLOSED
  expect([...securedView.stateMachine.legalNext]).toEqual(["ESCALATED", "CLOSED"]);
});

test("closure surfaces the machine-stable reason, read-only", () => {
  const store = createInMemoryRecoveryCaseStore();
  const opened = openCaseOrThrow(store, "dev_testdevice00a1" as never, lostTrigger());
  const source = realCaseSource(store);
  const closed = transitionRecoveryCase(
    { tenantId: SCOPE_A.tenantId, correlationId: "cor_webrecov_tst1" as never },
    store,
    opened,
    "CLOSED",
    { at: atHour(3), correlationId: "cor_webrecov_tst1" as never, closureReason: "device_recovered" },
  );
  expect(closed.ok).toBe(true);

  const view = buildRecoveryCaseViewModel(SCOPE_A, source, opened.caseId, REAL_CASE_TABLE);
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.status).toBe("CLOSED");
  expect(view.stateMachine.isTerminal).toBe(true);
  expect(view.stateMachine.legalNext).toHaveLength(0);
  expect(view.gating.acceptsDestructive).toBe(false);
  expect(view.closure).toEqual({ reason: "device_recovered", closedAt: atHour(3) });
});

test("the case list view-model orders active cases first with counts", () => {
  const store = createInMemoryRecoveryCaseStore();
  const caseA = openCaseOrThrow(store, "dev_testdevice00a1" as never, lostTrigger()); // stays OPENED
  const caseB = openCaseOrThrow(store, "dev_testdevice00a2" as never, lostTrigger(atHour(1)));
  const caseC = openCaseOrThrow(store, "dev_testdevice00a3" as never, postureTrigger());
  // close caseC
  transitionRecoveryCase(
    { tenantId: SCOPE_A.tenantId, correlationId: "cor_webrecov_tst1" as never },
    store,
    caseC,
    "CLOSED",
    { at: atHour(2), correlationId: "cor_webrecov_tst1" as never, closureReason: "operator_cancelled" },
  );

  const source = realCaseSource(store);
  const list = buildRecoveryCaseListViewModel(SCOPE_A, source, REAL_CASE_TABLE);
  expect(list.counts).toEqual({ total: 3, active: 2, closed: 1 });
  // active first, then caseId ascending
  expect(list.cases.map((c) => c.caseId)).toEqual([caseA.caseId, caseB.caseId, caseC.caseId]);
  expect(list.cases.map((c) => c.isActive)).toEqual([true, true, false]);
  expect(list.cases[2]?.isTerminal).toBe(true);
});

test("no existence side channel: a foreign case is undefined under the wrong scope", () => {
  const store = createInMemoryRecoveryCaseStore();
  const caseRecord = openCaseOrThrow(store, "dev_testdevice00a1" as never, lostTrigger());
  const source = realCaseSource(store);
  expect(buildRecoveryCaseViewModel(SCOPE_B, source, caseRecord.caseId, REAL_CASE_TABLE)).toBeUndefined();
  expect(buildRecoveryCaseViewModel(SCOPE_A, source, "rc_unknown", REAL_CASE_TABLE)).toBeUndefined();
  expect(
    buildRecoveryCaseViewModel({ tenantId: "" as never }, source, caseRecord.caseId, REAL_CASE_TABLE),
  ).toBeUndefined();
});

test("determinism: the same (source, case, table) replay byte-identically", () => {
  const store = createInMemoryRecoveryCaseStore();
  const caseRecord = openCaseOrThrow(store, "dev_testdevice00a1" as never, lostTrigger());
  const source = realCaseSource(store);
  const first = buildRecoveryCaseViewModel(SCOPE_A, source, caseRecord.caseId, REAL_CASE_TABLE);
  const second = buildRecoveryCaseViewModel(SCOPE_A, source, caseRecord.caseId, REAL_CASE_TABLE);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
