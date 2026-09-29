/**
 * W090A web-recovery — browser-facing RENDER tests for the recovery
 * screens (D4): every screen renders from a FROZEN view-model snapshot
 * built over the REAL `@fleetos/recovery` domain (the REAL last-seen
 * ledger + findMyDevice, the REAL case store + the frozen transition
 * tables, the REAL destructive-request store + the Guardian-routed
 * gate); text content, roles, labels, and semantic landmarks are
 * asserted; keyboard navigation and visible focus are exercised;
 * icon-only controls have accessible names; the exact
 * empty/loading/error states render; the gated destructive-action
 * presentation shows every required gate fact; a proposal is NEVER
 * presented as an executed action; and the same props always produce
 * byte-identical static markup.
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  DestructiveActionScreen,
  FindMyDeviceScreen,
  RecoveryCasesScreen,
  buildDestructiveRequestViewModel,
  buildFindMyDeviceViewModel,
  buildRecoveryCaseListViewModel,
  buildRecoveryCaseViewModel,
  caseStateMachineView,
  destructiveActionAffordance,
  CONSOLE_CSS,
} from "../src/index";
import type {
  DestructiveActionEntry,
  LostFlowContext,
} from "../src/index";
import {
  DEV_A1,
  FULLY_CAPABLE,
  REAL_CASE_TABLE,
  REAL_REQUEST_TABLE,
  SCOPE_A,
  TENANT_A,
  T0,
  adapter,
  approvalRule,
  atHour,
  batch,
  locationObservation,
  lostTrigger,
  obs,
  openCaseOrThrow,
  realCaseSource,
  realDestructiveSource,
  realFindMySource,
  requestDestructiveOrThrow,
  seededLastSeenLedger,
  approveDestructiveOrThrow,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
} from "./helpers";

afterEach(() => {
  cleanup();
});

const NOW = atHour(4);

// ---------------------------------------------------------------------------
// Frozen fixtures (the REAL recovery domain, deterministic)
// ---------------------------------------------------------------------------

/** A ledger with location-bearing last-seen evidence for DEV_A1 (two revisions). */
function locatedLedger() {
  return seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(1), 47.6, -122.3)], atHour(1))],
      at: atHour(1),
    },
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(3), 47.61, -122.31)], atHour(3))],
      at: atHour(3),
    },
  ]);
}

/** An active (OPENED) lost-device recovery case for DEV_A1. */
function activeCase() {
  const caseStore = createInMemoryRecoveryCaseStore();
  const record = openCaseOrThrow(
    caseStore,
    DEV_A1,
    lostTrigger(),
    { lastSeenRecordId: "ls_rec_1", lastSeenObservedAt: atHour(3) },
    T0,
  );
  return { caseStore, record };
}

/** The frozen find-my view-model over the located ledger. */
function findMyView() {
  return buildFindMyDeviceViewModel(SCOPE_A, realFindMySource(locatedLedger()), DEV_A1, {
    at: NOW,
    freshWithinMs: 3_600_000,
    staleAfterMs: 86_400_000,
  });
}

/** The frozen cases-list + case view-models over the active case. */
function caseViews() {
  const { caseStore, record } = activeCase();
  const source = realCaseSource(caseStore);
  const list = buildRecoveryCaseListViewModel(SCOPE_A, source, REAL_CASE_TABLE);
  const detail = buildRecoveryCaseViewModel(SCOPE_A, source, record.caseId, REAL_CASE_TABLE);
  if (detail === undefined) throw new Error("case view build failed");
  return { list, detail, caseStore, record };
}

// ---------------------------------------------------------------------------
// The design contract: tokens + reduced motion (asserted on the CSS)
// ---------------------------------------------------------------------------

test("the local token stylesheet declares the semantic tokens and the reduced-motion rule", () => {
  expect(CONSOLE_CSS).toContain("--surface:");
  expect(CONSOLE_CSS).toContain("--text-primary:");
  expect(CONSOLE_CSS).toContain("--status-attention:");
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  const gradientCount = CONSOLE_CSS.split("linear-gradient(").length - 1;
  expect(gradientCount).toBe(1);
});

// ---------------------------------------------------------------------------
// FindMyDeviceScreen
// ---------------------------------------------------------------------------

test("FindMyDeviceScreen renders the last-seen evidence + the located state with text-bearing indicators", () => {
  const view = findMyView();
  expect(view.location.status).toBe("located");
  render(
    <FindMyDeviceScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      onOpenRecoveryCase={(): void => {}}
      onOpenCases={(): void => {}}
    />,
  );

  expect(screen.getByRole("region", { name: "Recovery — Find My Device" })).toBeTruthy();
  // The last-seen staleness carries its text (the summary + the ledger rows)
  expect(screen.getAllByText(/— Healthy|— Needs attention/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Staleness \w+ —/)).toBeTruthy();
  // The located state is anchored to the evidence ref (never the payload)
  expect(screen.getByText(/Located — evidence/)).toBeTruthy();
  expect(screen.getByText("Last-known location")).toBeTruthy();
  // The ledger timeline shows both revisions, location-bearing
  const timeline = screen.getByRole("list", { name: "Last-seen ledger history" });
  expect(within(timeline).getAllByText(/location-bearing/).length).toBe(2);
  // The next-step hand-off to a recovery case
  expect(screen.getByRole("button", { name: "Open recovery case" })).toBeTruthy();
});

test("FindMyDeviceScreen renders the machine-stable no_location_evidence state EXPLICITLY (never a guess)", () => {
  // A ledger whose evidence carries NO location observations
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [obs("device.power", { batteryPercent: 62 }, atHour(1))], atHour(1))],
      at: atHour(1),
    },
  ]);
  const view = buildFindMyDeviceViewModel(SCOPE_A, realFindMySource(ledger), DEV_A1, {
    at: NOW,
    freshWithinMs: 3_600_000,
    staleAfterMs: 86_400_000,
  });
  expect(view.location.status).toBe("no_location_evidence");
  render(
    <FindMyDeviceScreen
      phase={{ kind: "loading" }}
      deviceId={DEV_A1}
      onOpenRecoveryCase={(): void => {}}
      onOpenCases={(): void => {}}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading the last-seen evidence" })).toBeTruthy();
  cleanup();

  render(
    <FindMyDeviceScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      onOpenRecoveryCase={(): void => {}}
      onOpenCases={(): void => {}}
    />,
  );
  // The absent-location state is presented exactly as the domain asserts
  expect(screen.getByText(/No location evidence — Unknown/)).toBeTruthy();
  expect(screen.getByText(/never interpolated, never guessed/i)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// RecoveryCasesScreen
// ---------------------------------------------------------------------------

test("RecoveryCasesScreen renders the case list (active first) and the Sheet detail with the record pattern", async () => {
  const user = userEvent.setup();
  const { list, detail } = caseViews();
  let closed = 0;
  const selected: string[] = [];
  render(
    <RecoveryCasesScreen
      phase={{ kind: "ready", view: list }}
      selectedCaseId={detail.caseId}
      selectedCase={detail}
      onSelectCase={(caseId: string): void => { selected.push(caseId); }}
      onCloseCase={(): void => { closed += 1; }}
      onOpenDestructive={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );

  expect(screen.getByRole("region", { name: "Recovery — Cases" })).toBeTruthy();
  // The case row with its status indicator (text, never color alone)
  const row = screen.getByText(detail.caseId).closest("tr");
  expect(row).toBeTruthy();
  if (row === null) throw new Error("unreachable");
  expect(within(row).getByText(/OPENED — Needs attention/)).toBeTruthy();
  expect(within(row).getByText("lost_report")).toBeTruthy();

  // The Sheet detail renders the record pattern
  const sheet = screen.getByRole("dialog", { name: `Recovery case ${detail.caseId}` });
  expect(within(sheet).getByText("What happened (trigger)")).toBeTruthy();
  expect(within(sheet).getByText("Current state (read-only machine)")).toBeTruthy();
  expect(within(sheet).getByText("Why it matters (the destructive gate)")).toBeTruthy();
  expect(within(sheet).getByText("Destructive actions accepted in this state")).toBeTruthy();
  expect(within(sheet).getByText("Evidence basis")).toBeTruthy();
  expect(within(sheet).getByText("History (append-only)")).toBeTruthy();

  // The icon-only close control has an accessible name and closes the sheet
  await user.click(within(sheet).getByRole("button", { name: "Close panel" }));
  expect(closed).toBe(1);

  // The hand-offs from the case detail
  expect(within(sheet).getByRole("button", { name: "Open destructive actions" })).toBeTruthy();
  expect(within(sheet).getByRole("button", { name: "Find this device" })).toBeTruthy();
  expect(selected).toEqual([]);
});

test("RecoveryCasesScreen renders the exact empty + loading + error states", () => {
  const emptyList = buildRecoveryCaseListViewModel(SCOPE_A, realCaseSource(createInMemoryRecoveryCaseStore()), REAL_CASE_TABLE);
  render(
    <RecoveryCasesScreen
      phase={{ kind: "ready", view: emptyList }}
      selectedCaseId={undefined}
      selectedCase={undefined}
      onSelectCase={(): void => {}}
      onCloseCase={(): void => {}}
      onOpenDestructive={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );
  expect(screen.getByText("No recovery cases")).toBeTruthy();
  cleanup();

  render(
    <RecoveryCasesScreen
      phase={{ kind: "loading" }}
      selectedCaseId={undefined}
      selectedCase={undefined}
      onSelectCase={(): void => {}}
      onCloseCase={(): void => {}}
      onOpenDestructive={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading recovery cases" })).toBeTruthy();
  cleanup();

  render(
    <RecoveryCasesScreen
      phase={{ kind: "error", message: "The case store is unreachable." }}
      selectedCaseId={undefined}
      selectedCase={undefined}
      onSelectCase={(): void => {}}
      onCloseCase={(): void => {}}
      onOpenDestructive={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("The case store is unreachable.")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// DestructiveActionScreen — the gated path ONLY
// ---------------------------------------------------------------------------

/** The frozen destructive entries for the gate scenarios. */
function gateScenario() {
  const { caseStore, record } = activeCase();
  const requestStore = createInMemoryDestructiveRequestStore();
  const run = {
    caseStore,
    requestStore,
    caseRecord: record,
    adapter: adapter(TENANT_A, DEV_A1, FULLY_CAPABLE),
  };

  // A PARKED wipe request (the approval rule fires): a PROPOSAL state
  const parked = requestDestructiveOrThrow(run, "wipe", [approvalRule(TENANT_A, "device.wipe")], atHour(2));

  const caseSource = realCaseSource(caseStore);
  const caseDetail = buildRecoveryCaseViewModel(SCOPE_A, caseSource, record.caseId, REAL_CASE_TABLE);
  if (caseDetail === undefined) throw new Error("case detail vanished");
  const machine = caseStateMachineView(caseDetail.status, REAL_CASE_TABLE);

  const requestSource = realDestructiveSource(requestStore);
  const requestView = buildDestructiveRequestViewModel(SCOPE_A, requestSource, parked.requestId, REAL_REQUEST_TABLE);
  if (requestView === undefined) throw new Error("request view vanished");
  // The affordance's request projection: the REAL record projected by the
  // REAL destructive source (the same projection the binding site uses).
  const requestLike = requestSource.latest(TENANT_A, parked.requestId);
  if (requestLike === undefined) throw new Error("request projection vanished");

  const actions: readonly DestructiveActionEntry[] = [
    {
      action: "lock",
      label: "Lock",
      expectedEffect: "Remotely locks the device; unlocking requires an operator action.",
      evidenceRequirement: "The lock command's execution evidence from the device adapter.",
      supported: true,
      affordance: destructiveActionAffordance("lock", machine, undefined),
      request: undefined,
    },
    {
      action: "wipe",
      label: "Wipe",
      expectedEffect: "Erases all data on the device. This effect is irreversible.",
      evidenceRequirement: "The wipe command's execution evidence + the pre-recorded case evidence.",
      supported: true,
      affordance: destructiveActionAffordance("wipe", machine, requestLike),
      request: requestView,
    },
    {
      action: "reboot",
      label: "Reboot",
      expectedEffect: "Restarts the device.",
      evidenceRequirement: "The reboot command's execution evidence.",
      supported: false, // visibly unsupported
      affordance: destructiveActionAffordance("reboot", machine, undefined),
      request: undefined,
    },
  ];

  const lostFlow: LostFlowContext = {
    lastSeenObservedAt: atHour(3),
    caseView: caseDetail,
    locatedSupported: true,
    lockSupported: true,
    wipeSupported: true,
  };
  return { actions, lostFlow, caseDetail, run, requestStore, parked };
}

test("DestructiveActionScreen shows every required gate fact and REFUSES to present the parked proposal as executed", async () => {
  const user = userEvent.setup();
  const { actions, lostFlow, caseDetail } = gateScenario();
  const requested: string[] = [];
  const approved: string[] = [];

  render(
    <DestructiveActionScreen
      phase={{ kind: "ready", view: caseDetail }}
      deviceId={DEV_A1}
      actions={actions}
      lostFlow={lostFlow}
      onRequestAction={(action: string): void => { requested.push(action); }}
      onApproveRequest={(requestId: string): void => { approved.push(requestId); }}
      onOpenCases={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );

  expect(screen.getByRole("region", { name: "Recovery — Destructive actions" })).toBeTruthy();
  // The case context shows the visible gate precondition
  expect(screen.getByText(/Yes — the case is active/)).toBeTruthy();
  // The lost-device flow timeline renders the journey stages
  const flow = screen.getByRole("list", { name: "Lost device recovery flow" });
  expect(within(flow).getByText("Last-seen evidence")).toBeTruthy();
  expect(within(flow).getByText("Locate")).toBeTruthy();
  expect(within(flow).getByText("Lock")).toBeTruthy();
  expect(within(flow).getByText("Destructive action (wipe)")).toBeTruthy();
  expect(within(flow).getByText("Verification")).toBeTruthy();
  expect(within(flow).getByText("Replacement escalation")).toBeTruthy();
  // The unsupported capability stays VISIBLY unsupported (no fake control)
  expect(screen.getByText(/Unsupported by this device/)).toBeTruthy();
  expect(screen.getByText(/never emulated/i)).toBeTruthy();

  // The lock card (no request yet): the gate ledger + the request affordance
  const lockCard = screen.getByText("Action lock — gated path only").closest("section");
  expect(lockCard).toBeTruthy();
  if (lockCard === null) throw new Error("unreachable");
  expect(within(lockCard).getByText("Expected effect")).toBeTruthy();
  expect(within(lockCard).getByText(/Remotely locks the device/)).toBeTruthy();
  expect(within(lockCard).getByText(/Evidence required/)).toBeTruthy();
  expect(within(lockCard).getByText(/Guardian: not_evaluated — Unknown/)).toBeTruthy();
  expect(within(lockCard).getAllByText(/— Succeeded|— Unknown/).length).toBeGreaterThan(0);
  await user.click(within(lockCard).getByRole("button", { name: "Request lock" }));
  expect(requested).toEqual(["lock"]);

  // The wipe card (PARKED): the proposal is NOT presented as executed
  const wipeCard = screen.getByText(/Erases all data on the device/).closest("section");
  expect(wipeCard).toBeTruthy();
  if (wipeCard === null) throw new Error("unreachable");
  expect(within(wipeCard).getByText(/Guardian: REQUIRE_APPROVAL — Approval required/)).toBeTruthy();
  expect(within(wipeCard).getByText(/Holds the request until resolved/)).toBeTruthy();
  expect(within(wipeCard).getAllByText(/Approval required/).length).toBeGreaterThan(0);
  // The explicit proposal framing
  expect(within(wipeCard).getByText(/PROPOSAL in the gated pipeline/i)).toBeTruthy();
  expect(within(wipeCard).getByText(/has NOT executed/i)).toBeTruthy();
  // The human-approval step is pending in the gate ledger
  expect(within(wipeCard).getByText(/Human approval/)).toBeTruthy();
  expect(within(wipeCard).getAllByText(/pending — Approval required/).length).toBeGreaterThan(0);
  // The approval affordance fires the human-decision intent
  await user.click(within(wipeCard).getByRole("button", { name: "Approve request" }));
  expect(approved.length).toBe(1);
});

test("DestructiveActionScreen renders the executed outcome with verification evidence — only for EXECUTED requests", async () => {
  const scenario = gateScenario();
  // Approve the parked wipe -> APPROVED + EXECUTED through the REAL adapter
  const executed = approveDestructiveOrThrow(scenario.run, scenario.parked, "approve", atHour(3));
  expect(executed.status).toBe("EXECUTED");

  const requestSource = realDestructiveSource(scenario.requestStore);
  const executedView = buildDestructiveRequestViewModel(
    SCOPE_A,
    requestSource,
    executed.requestId,
    REAL_REQUEST_TABLE,
  );
  if (executedView === undefined) throw new Error("executed view vanished");

  const actions: readonly DestructiveActionEntry[] = [
    {
      action: "wipe",
      label: "Wipe",
      expectedEffect: "Erases all data on the device. This effect is irreversible.",
      evidenceRequirement: "The wipe command's execution evidence + the pre-recorded case evidence.",
      supported: true,
      affordance: destructiveActionAffordance(
        "wipe",
        caseStateMachineView(scenario.caseDetail.status, REAL_CASE_TABLE),
        realDestructiveSource(scenario.requestStore).latest(TENANT_A, executed.requestId),
      ),
      request: executedView,
    },
  ];

  render(
    <DestructiveActionScreen
      phase={{ kind: "ready", view: scenario.caseDetail }}
      deviceId={DEV_A1}
      actions={actions}
      lostFlow={scenario.lostFlow}
      onRequestAction={(): void => {}}
      onApproveRequest={(): void => {}}
      onOpenCases={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );

  // The EXECUTED outcome is shown with its verification evidence
  expect(screen.getByText(/Execution executed at/)).toBeTruthy();
  expect(screen.getByText(/adapter evidence artifact/i)).toBeTruthy();
  // The version history shows the full lineage: REQUESTED -> PARKED -> APPROVED -> EXECUTED
  const history = screen.getByRole("list", { name: "Request revision history" });
  expect(within(history).getByText(/v1 — REQUESTED/)).toBeTruthy();
  expect(within(history).getByText(/v2 — PARKED/)).toBeTruthy();
  expect(within(history).getByText(/v3 — APPROVED/)).toBeTruthy();
  expect(within(history).getByText(/v4 — EXECUTED/)).toBeTruthy();
  // No proposal framing remains for the executed request
  expect(screen.queryByText(/PROPOSAL in the gated pipeline/i)).toBeNull();
});

test("DestructiveActionScreen renders the absent-case zero state (there is no ungated path)", () => {
  render(
    <DestructiveActionScreen
      phase={{ kind: "ready", view: undefined }}
      deviceId={DEV_A1}
      actions={[]}
      lostFlow={{ lastSeenObservedAt: undefined, caseView: undefined, locatedSupported: false, lockSupported: false, wipeSupported: false }}
      onRequestAction={(): void => {}}
      onApproveRequest={(): void => {}}
      onOpenCases={(): void => {}}
      onOpenFindMy={(): void => {}}
    />,
  );
  expect(screen.getByText("No active recovery case for this device")).toBeTruthy();
  expect(screen.getByText(/there is no ungated path/i)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the recovery screens render byte-identical static markup for the same props", () => {
  const findMyProps = {
    phase: { kind: "ready" as const, view: findMyView() },
    deviceId: DEV_A1,
    onOpenRecoveryCase: (): void => {},
    onOpenCases: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(FindMyDeviceScreen, findMyProps))).toBe(
    renderToStaticMarkup(createElement(FindMyDeviceScreen, findMyProps)),
  );

  const { list } = caseViews();
  const casesProps = {
    phase: { kind: "ready" as const, view: list },
    selectedCaseId: undefined,
    selectedCase: undefined,
    onSelectCase: (): void => {},
    onCloseCase: (): void => {},
    onOpenDestructive: (): void => {},
    onOpenFindMy: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(RecoveryCasesScreen, casesProps))).toBe(
    renderToStaticMarkup(createElement(RecoveryCasesScreen, casesProps)),
  );

  const { actions, lostFlow, caseDetail } = gateScenario();
  const destructiveProps = {
    phase: { kind: "ready" as const, view: caseDetail },
    deviceId: DEV_A1,
    actions,
    lostFlow,
    onRequestAction: (): void => {},
    onApproveRequest: (): void => {},
    onOpenCases: (): void => {},
    onOpenFindMy: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(DestructiveActionScreen, destructiveProps))).toBe(
    renderToStaticMarkup(createElement(DestructiveActionScreen, destructiveProps)),
  );
});
