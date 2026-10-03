/**
 * W141 web-recovery — the RUNTIME FEEDS composition tests, over the
 * REAL `@fleetos/recovery` domain (the last-seen ledger + findMyDevice,
 * the recovery case store + the frozen transition tables, the
 * destructive-request store + the REAL gated boundary) and the REAL
 * adapter capabilities.
 *
 * These tests are the machine proof that EVERY lane-phase transition
 * of the three recovery feeds is honest:
 *
 *   CASES FEED     loading -> empty (fresh tenant) -> ready;
 *                  selected case detail + journey; foreign case
 *                  indistinguishable; scope refused -> blocked
 *   FIND-MY FEED   empty (no evidence) -> ready (located); the honest
 *                  no_location_evidence state verbatim
 *   DESTRUCTIVE    blocked (no case) -> ready (active case) ->
 *                  approval_required (a PARKED request) -> unsupported
 *                  (no adapter capability); the actions' affordances
 *                  from the REAL requests
 */

import { test, expect } from "bun:test";
import { asCorrelationId } from "@fleetos/contracts";
import type { DeviceId } from "@fleetos/contracts";
import {
  composeDestructiveActionsFeed,
  composeFindMyDeviceFeed,
  composeRecoveryCasesFeed,
} from "../src/index";
import type { RecoveryRuntimeState } from "../src/index";
import { RECOVERY_JOURNEY_STAGES } from "../src/index";
import {
  DEV_A1,
  DEV_A2,
  FULLY_CAPABLE,
  REAL_CASE_TABLE,
  REAL_REQUEST_TABLE,
  SCOPE_A,
  SCOPE_B,
  TENANT_A,
  T0,
  adapter,
  approvalRule,
  atHour,
  batch,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  locationObservation,
  lostTrigger,
  openCaseOrThrow,
  postureTrigger,
  realCaseSource,
  realDestructiveSource,
  realFindMySource,
  requestDestructiveOrThrow,
  seededLastSeenLedger,
  transitionRecoveryCase,
} from "./helpers";
import type {
  DestructiveRequestStore,
  LastSeenLedger,
  RecoveryCaseStore,
} from "@fleetos/recovery";

const NOW = atHour(4);
const BANDS = { freshWithinMs: 3_600_000, staleAfterMs: 86_400_000 };

/** The explicit destructive capability set (required booleans). */
const ALL_DESTRUCTIVE_CAPABLE = { lock: true, locate: true, wipe: true, reboot: true } as const;

/** A runtime state bundle over the REAL recovery stores. */
function runtimeState(input: {
  readonly caseStore: RecoveryCaseStore;
  readonly requestStore: DestructiveRequestStore;
  readonly ledger?: LastSeenLedger;
  readonly capabilities?: { readonly lock: boolean; readonly locate: boolean; readonly wipe: boolean; readonly reboot: boolean } | undefined;
}): RecoveryRuntimeState {
  const declared = input.capabilities;
  return {
    cases: realCaseSource(input.caseStore),
    requests: realDestructiveSource(input.requestStore),
    findMy: realFindMySource(input.ledger ?? seededLastSeenLedger([])),
    capabilities: {
      capabilities: (_tenantId, _deviceId: DeviceId) =>
        declared === undefined ? undefined : { lock: declared.lock, locate: declared.locate, wipe: declared.wipe, reboot: declared.reboot },
    },
  };
}

/** A case store with one OPENED lost-report case for DEV_A1. */
function openedCaseStore(): RecoveryCaseStore {
  const store = createInMemoryRecoveryCaseStore();
  openCaseOrThrow(
    store,
    DEV_A1,
    lostTrigger(),
    { lastSeenRecordId: "ls_w141_1", lastSeenObservedAt: atHour(3) },
    T0,
  );
  return store;
}

test("CASES: the fresh tenant composes the honest EMPTY phase (never demo data)", () => {
  const state = runtimeState({
    caseStore: createInMemoryRecoveryCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
  });
  const feed = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, { now: NOW });
  expect(feed.lanePhase.kind).toBe("empty");
  if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("no_recovery_cases");
  expect(feed.lanePhase.view.cases).toHaveLength(0);
  expect(feed.journeys).toEqual({});
  // The screen renders the honest empty list.
  expect(feed.phase.kind).toBe("ready");
  if (feed.phase.kind !== "ready") throw new Error("unreachable");
  expect(feed.phase.view.cases).toHaveLength(0);
});

test("CASES: the refused scope grammar fails closed (blocked, the deterministic empty view)", () => {
  const state = runtimeState({
    caseStore: openedCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
  });
  const feed = composeRecoveryCasesFeed({ tenantId: "" as never }, state, REAL_CASE_TABLE, { now: NOW });
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("scope_refused");
  // The deterministic empty view — no data, no leak.
  expect(feed.lanePhase.view.cases).toHaveLength(0);
});

test("CASES: EMPTY -> READY over real cases; the selected detail + the seven-stage journey compose", () => {
  const caseStore = createInMemoryRecoveryCaseStore();
  const caseA = openCaseOrThrow(caseStore, DEV_A1, lostTrigger(), { lastSeenRecordId: "ls_a", lastSeenObservedAt: atHour(1) }, T0);
  openCaseOrThrow(caseStore, DEV_A2, postureTrigger(), {}, atHour(1));
  const state = runtimeState({
    caseStore,
    requestStore: createInMemoryDestructiveRequestStore(),
  });

  const feed = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, { now: NOW });
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.cases).toHaveLength(2);
  expect(feed.lanePhase.view.counts.active).toBe(2);

  // Every case carries its journey (all seven stages, canonical order).
  for (const row of feed.lanePhase.view.cases) {
    const journey = feed.journeys[row.caseId];
    expect(journey).toBeDefined();
    if (journey === undefined) throw new Error("unreachable");
    expect(journey.stages.map((stage) => stage.id)).toEqual([...RECOVERY_JOURNEY_STAGES]);
  }

  // The selected case resolves its detail + journey.
  const selected = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, {
    now: NOW,
    selectedCaseId: caseA.caseId,
  });
  expect(selected.selectedCase?.caseId).toBe(caseA.caseId);
  expect(selected.selectedCase?.status).toBe("OPENED");
  expect(selected.selectedJourney?.caseId).toBe(caseA.caseId);
  const signalStage = selected.selectedJourney?.stages.find((stage) => stage.id === "signal");
  expect(signalStage?.rows.some((row) => row.value === "lost_report")).toBe(true);

  // A foreign/unknown case id resolves NOTHING (no existence side channel).
  const foreign = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, {
    now: NOW,
    selectedCaseId: "rc_unknown0000001",
  });
  expect(foreign.selectedCase).toBeUndefined();
  expect(foreign.selectedJourney).toBeUndefined();
});

test("CASES: the journey's closure/escalation stage derives from the REAL case state", () => {
  const caseStore = createInMemoryRecoveryCaseStore();
  const opened = openCaseOrThrow(caseStore, DEV_A1, lostTrigger(), {}, T0);
  const scope = { tenantId: TENANT_A, correlationId: asCorrelationId("cor_webrecov_tst1") };
  const closed = transitionRecoveryCase(scope, caseStore, opened, "CLOSED", {
    at: atHour(2),
    correlationId: scope.correlationId,
    closureReason: "device_recovered",
  });
  expect(closed.ok).toBe(true);

  const state = runtimeState({
    caseStore,
    requestStore: createInMemoryDestructiveRequestStore(),
  });
  const feed = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, {
    now: NOW,
    selectedCaseId: opened.caseId,
  });
  const closureStage = feed.selectedJourney?.stages.find((stage) => stage.id === "closure_escalation");
  expect(closureStage?.state).toBe("ready");
  expect(closureStage?.rows.some((row) => row.value.includes("device_recovered"))).toBe(true);
  expect(closureStage?.rows.some((row) => row.value === "none — terminal")).toBe(true);
  // The closed case's gate is closed in the decision stage.
  const decisionStage = feed.selectedJourney?.stages.find((stage) => stage.id === "locate_secure_decision");
  expect(decisionStage?.rows.some((row) => row.value === "closed — case not active")).toBe(true);
});

test("FIND-MY: no evidence composes the honest EMPTY phase; located evidence composes READY", () => {
  // No ledger records at all: the honest empty.
  const emptyLedger = seededLastSeenLedger([]);
  const state = runtimeState({
    caseStore: createInMemoryRecoveryCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
    ledger: emptyLedger,
  });
  const emptyFeed = composeFindMyDeviceFeed(SCOPE_A, state, DEV_A1, { at: NOW, ...BANDS });
  expect(emptyFeed.lanePhase.kind).toBe("empty");
  if (emptyFeed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(emptyFeed.lanePhase.reason).toBe("no_last_seen_evidence");
  // The view IS the machine-stable absent-evidence state.
  const emptyView = emptyFeed.lanePhase.view;
  expect(emptyView.location.status).toBe("no_location_evidence");
  expect(emptyView.lastSeen).toBeUndefined();

  // A location-bearing ledger: located + ready.
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(3), 47.61, -122.31)], atHour(3))],
      at: atHour(3),
    },
  ]);
  const locatedState = runtimeState({
    caseStore: createInMemoryRecoveryCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
    ledger,
  });
  const locatedFeed = composeFindMyDeviceFeed(SCOPE_A, locatedState, DEV_A1, { at: NOW, ...BANDS });
  expect(locatedFeed.lanePhase.kind).toBe("ready");
  if (locatedFeed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(locatedFeed.lanePhase.view.location.status).toBe("located");
  expect(locatedFeed.lanePhase.view.ledger.length).toBeGreaterThan(0);
});

test("FIND-MY: a refused scope composes the deterministic empty view (blocked, no leak)", () => {
  const state = runtimeState({
    caseStore: createInMemoryRecoveryCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
  });
  const feed = composeFindMyDeviceFeed({ tenantId: "" as never }, state, DEV_A1, { at: NOW, ...BANDS });
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.view.location.status).toBe("no_location_evidence");
  expect(feed.lanePhase.view.ledger).toHaveLength(0);
});

test("DESTRUCTIVE: no case for the device composes the honest BLOCKED state (no ungated path)", () => {
  const state = runtimeState({
    caseStore: createInMemoryRecoveryCaseStore(), // no cases at all
    requestStore: createInMemoryDestructiveRequestStore(),
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("no_active_recovery_case");
  expect(feed.lanePhase.view).toBeUndefined(); // the screen renders its honest refusal
  expect(feed.caseId).toBeUndefined();
  expect(feed.actions).toHaveLength(0);
  expect(feed.journey).toBeUndefined();
});

test("DESTRUCTIVE: BLOCKED -> READY over the active case; the four gated actions + the lost flow", () => {
  const state = runtimeState({
    caseStore: openedCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
    capabilities: ALL_DESTRUCTIVE_CAPABLE,
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.caseId).toBeDefined();

  // The four destructive actions with the gated-path affordances.
  expect(feed.actions.map((entry) => entry.action)).toEqual(["lock", "locate", "wipe", "reboot"]);
  for (const entry of feed.actions) {
    expect(entry.supported).toBe(true);
    expect(entry.affordance.kind).toBe("gated_path_only");
    expect(entry.affordance.guardian).toBe("not_evaluated"); // nothing routed yet
    expect(entry.request).toBeUndefined();
  }

  // The lost flow carries the case view + the capabilities.
  expect(feed.lostFlow.caseView?.status).toBe("OPENED");
  expect(feed.lostFlow.wipeSupported).toBe(true);

  // The journey composes (the seven-stage walk over the active case).
  expect(feed.journey?.stages.map((stage) => stage.id)).toEqual([...RECOVERY_JOURNEY_STAGES]);
});

test("DESTRUCTIVE: READY -> APPROVAL_REQUIRED when a REAL request is PARKED (the human gate)", () => {
  const caseStore = openedCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const caseRecord = caseStore.getLatestCase(
    { tenantId: TENANT_A, correlationId: asCorrelationId("cor_webrecov_tst1") },
    caseStore.listCaseIds({ tenantId: TENANT_A, correlationId: asCorrelationId("cor_webrecov_tst1") })[0] ?? "",
  );
  if (caseRecord === undefined) throw new Error("case missing");

  // A REAL wipe request through the REAL gated boundary (REQUIRE_APPROVAL -> PARKED).
  requestDestructiveOrThrow(
    { caseStore, requestStore, caseRecord, adapter: adapter(TENANT_A, DEV_A1, FULLY_CAPABLE) },
    "wipe",
    [approvalRule(TENANT_A, "device.wipe")],
    atHour(2),
  );

  const state = runtimeState({
    caseStore,
    requestStore,
    capabilities: ALL_DESTRUCTIVE_CAPABLE,
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("approval_required");
  if (feed.lanePhase.kind !== "approval_required") throw new Error("unreachable");

  // The wipe action's entry carries the REAL parked request + gating.
  const wipe = feed.actions.find((entry) => entry.action === "wipe");
  expect(wipe).toBeDefined();
  if (wipe === undefined) throw new Error("unreachable");
  if (wipe.request === undefined) throw new Error("unreachable");
  expect(wipe.request.status).toBe("PARKED");
  expect(wipe.request.guardian).not.toBe("not_evaluated");
  if (wipe.request.guardian === "not_evaluated") throw new Error("unreachable");
  expect(wipe.request.guardian.decision).toBe("REQUIRE_APPROVAL");
  expect(wipe.affordance.approvalPending).toBe(true);
  expect(wipe.affordance.approvalRequired).toBe(true);

  // The journey's authorization stage reflects the human gate.
  const authStage = feed.journey?.stages.find((stage) => stage.id === "authorization");
  expect(authStage?.state).toBe("approval_required");
  expect(feed.journey?.approvalPending).toBe(true);

  // Other actions remain unrequested (honest).
  const lock = feed.actions.find((entry) => entry.action === "lock");
  expect(lock?.request).toBeUndefined();
});

test("DESTRUCTIVE: a terminal case is NOT an active case (the gate closes; blocked returns)", () => {
  const caseStore = openedCaseStore();
  const scope = { tenantId: TENANT_A, correlationId: asCorrelationId("cor_webrecov_tst1") };
  const caseId = caseStore.listCaseIds(scope)[0] ?? "";
  const opened = caseStore.getLatestCase(scope, caseId);
  if (opened === undefined) throw new Error("case missing");
  const closed = transitionRecoveryCase(scope, caseStore, opened, "CLOSED", {
    at: atHour(2),
    correlationId: scope.correlationId,
    closureReason: "device_recovered",
  });
  expect(closed.ok).toBe(true);

  const state = runtimeState({
    caseStore,
    requestStore: createInMemoryDestructiveRequestStore(),
    capabilities: ALL_DESTRUCTIVE_CAPABLE,
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("no_active_recovery_case");
});

test("DESTRUCTIVE: an adapter with NO destructive capability composes the honest UNSUPPORTED phase", () => {
  const state = runtimeState({
    caseStore: openedCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
    capabilities: { lock: false, locate: false, wipe: false, reboot: false },
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("unsupported");
  if (feed.lanePhase.kind !== "unsupported") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("adapter_capability_absent");
  // Every action is VISIBLY unsupported — never a disabled fake.
  for (const entry of feed.actions) {
    expect(entry.supported).toBe(false);
  }
  expect(feed.lostFlow.wipeSupported).toBe(false);
});

test("DESTRUCTIVE: a foreign scope never resolves another tenant's case (no existence side channel)", () => {
  const state = runtimeState({
    caseStore: openedCaseStore(),
    requestStore: createInMemoryDestructiveRequestStore(),
    capabilities: ALL_DESTRUCTIVE_CAPABLE,
  });
  const feed = composeDestructiveActionsFeed(
    SCOPE_B, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe("no_active_recovery_case");
});

test("a source that throws composes the machine-stable error feed (never data)", () => {
  const state: RecoveryRuntimeState = {
    cases: {
      list: (): never => {
        throw new Error("source refused");
      },
      history: realCaseSource(createInMemoryRecoveryCaseStore()).history,
      latest: realCaseSource(createInMemoryRecoveryCaseStore()).latest,
    },
    requests: realDestructiveSource(createInMemoryDestructiveRequestStore()),
    findMy: realFindMySource(seededLastSeenLedger([])),
    capabilities: { capabilities: () => undefined },
  };
  const cases = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, { now: NOW });
  expect(cases.lanePhase.kind).toBe("error");
  const destructive = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(destructive.lanePhase.kind).toBe("error");
});

test("determinism: the same runtime state composes byte-identical feeds", () => {
  const caseStore = openedCaseStore();
  const requestStore = createInMemoryDestructiveRequestStore();
  const state = runtimeState({ caseStore, requestStore, capabilities: ALL_DESTRUCTIVE_CAPABLE });
  const first = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  const second = composeDestructiveActionsFeed(
    SCOPE_A, state, REAL_REQUEST_TABLE, REAL_CASE_TABLE, DEV_A1,
    { now: NOW, ...BANDS },
  );
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));

  const casesFirst = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, { now: NOW });
  const casesSecond = composeRecoveryCasesFeed(SCOPE_A, state, REAL_CASE_TABLE, { now: NOW });
  expect(JSON.stringify(casesFirst)).toBe(JSON.stringify(casesSecond));
});
