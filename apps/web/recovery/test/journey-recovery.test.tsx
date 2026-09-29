/**
 * W090A web-recovery — JOURNEY EVIDENCE test (D4): the "recover a lost
 * device" journey from the UX simulation's required list, walked
 * through the FULL RENDERED screens with the REAL `@fleetos/recovery`
 * domain bound at the test's binding site.
 *
 * The rendered sequence (per the simulation's required change):
 *
 *   Find My Device (last-seen + location evidence)
 *     -> recovery case (the durable, gated context)
 *     -> destructive action request (the gated path: Guardian
 *        REQUIRE_APPROVAL -> PARKED — a PROPOSAL, never executed)
 *     -> human approval (the explicit grant)
 *     -> EXECUTED with adapter verification evidence
 *     -> the versioned request history as the evidence trail.
 *
 * The journey's terminal state is the VERIFIED executed outcome with
 * evidence visible — and the proposal/execution distinction is proven
 * at the PARKED stage (the screen REFUSES to present it as executed).
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
} from "../src/index";
import type { DestructiveActionEntry, LostFlowContext } from "../src/index";
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
  openCaseOrThrow,
  realCaseSource,
  realDestructiveSource,
  realFindMySource,
  requestDestructiveOrThrow,
  approveDestructiveOrThrow,
  seededLastSeenLedger,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
} from "./helpers";
import type {
  DestructiveRequestRecord,
  DestructiveRequestStore,
  LastSeenLedger,
  RecoveryCaseRecord,
  RecoveryCaseStore,
} from "@fleetos/recovery";

afterEach(() => {
  cleanup();
});

const NOW = atHour(4);
const BANDS = { freshWithinMs: 3_600_000, staleAfterMs: 86_400_000 };

/**
 * The journey's binding site: the REAL recovery domain state (the
 * last-seen ledger, the case store, the destructive-request store, the
 * capable adapter) plus the currently-recorded request — the React
 * state holds ONLY these bindings + the screen's UI navigation
 * (which surface is open); every domain value flows through the PURE
 * view-models. No business truth lives in React state.
 */
function LostDeviceJourneyShell(): React.JSX.Element {
  // The REAL domain bindings (immutable for this journey's lifetime).
  const [ledger] = useState<LastSeenLedger>(() =>
    seededLastSeenLedger([
      {
        deviceId: DEV_A1,
        batches: [batch(DEV_A1, [locationObservation(atHour(3), 47.61, -122.31)], atHour(3))],
        at: atHour(3),
      },
    ]),
  );
  const [caseStore] = useState<RecoveryCaseStore>(() => {
    const store = createInMemoryRecoveryCaseStore();
    openCaseOrThrow(
      store,
      DEV_A1,
      lostTrigger(),
      { lastSeenRecordId: "ls_rec_1", lastSeenObservedAt: atHour(3) },
      T0,
    );
    return store;
  });
  const [requestStore] = useState<DestructiveRequestStore>(() => createInMemoryDestructiveRequestStore());

  // The recorded wipe request (PARKED), advanced to EXECUTED on approval.
  const [record, setRecord] = useState<DestructiveRequestRecord | undefined>(undefined);
  const [surface, setSurface] = useState<"find-my" | "cases" | "destructive">("find-my");

  const findMy = buildFindMyDeviceViewModel(SCOPE_A, realFindMySource(ledger), DEV_A1, { at: NOW, ...BANDS });
  const caseList = buildRecoveryCaseListViewModel(SCOPE_A, realCaseSource(caseStore), REAL_CASE_TABLE);
  const latestCase = caseList.cases[0];
  const caseDetail =
    latestCase === undefined
      ? undefined
      : buildRecoveryCaseViewModel(SCOPE_A, realCaseSource(caseStore), latestCase.caseId, REAL_CASE_TABLE);

  const requestView =
    record === undefined
      ? undefined
      : buildDestructiveRequestViewModel(SCOPE_A, realDestructiveSource(requestStore), record.requestId, REAL_REQUEST_TABLE);

  const machine = caseDetail === undefined ? caseStateMachineView("OPENED", REAL_CASE_TABLE) : caseStateMachineView(caseDetail.status, REAL_CASE_TABLE);

  // The affordance's request projection: the REAL record projected by the
  // REAL destructive source (the same projection the binding site uses).
  const requestLike =
    record === undefined
      ? undefined
      : realDestructiveSource(requestStore).latest(TENANT_A, record.requestId);

  const actions: readonly DestructiveActionEntry[] = [
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
      supported: false,
      affordance: destructiveActionAffordance("reboot", machine, undefined),
      request: undefined,
    },
  ];

  const lostFlow: LostFlowContext = {
    lastSeenObservedAt: findMy.lastSeen?.observedAt,
    caseView: caseDetail,
    locatedSupported: true,
    lockSupported: true,
    wipeSupported: true,
  };

  if (surface === "find-my") {
    return (
      <FindMyDeviceScreen
        phase={{ kind: "ready", view: findMy }}
        deviceId={DEV_A1}
        onOpenRecoveryCase={(): void => setSurface("cases")}
        onOpenCases={(): void => setSurface("cases")}
      />
    );
  }
  if (surface === "cases") {
    return (
      <RecoveryCasesScreen
        phase={{ kind: "ready", view: caseList }}
        selectedCaseId={caseDetail?.caseId}
        selectedCase={caseDetail}
        onSelectCase={(): void => {}}
        onCloseCase={(): void => {}}
        onOpenDestructive={(): void => setSurface("destructive")}
        onOpenFindMy={(): void => setSurface("find-my")}
      />
    );
  }
  return (
    <DestructiveActionScreen
      phase={{ kind: "ready", view: caseDetail }}
      deviceId={DEV_A1}
      actions={actions}
      lostFlow={lostFlow}
      onRequestAction={(): void => {
        // The binding site: the REAL gated request (the approval rule
        // fires REQUIRE_APPROVAL -> PARKED — a PROPOSAL, not an execution).
        const caseRecord = caseStore.getLatestCase(
          { tenantId: TENANT_A, correlationId: "cor_webrecov_tst1" } as never,
          caseDetail?.caseId ?? "",
        ) as RecoveryCaseRecord | undefined;
        if (caseRecord === undefined) throw new Error("case record vanished");
        const run = {
          caseStore,
          requestStore,
          caseRecord,
          adapter: adapter(TENANT_A, DEV_A1, FULLY_CAPABLE),
        };
        const parked = requestDestructiveOrThrow(run, "wipe", [approvalRule(TENANT_A, "device.wipe")], atHour(2));
        setRecord(parked);
      }}
      onApproveRequest={(): void => {
        // The binding site: the REAL human-approval step (approve ->
        // APPROVED + EXECUTED through the REAL adapter).
        if (record === undefined) throw new Error("no request to approve");
        const caseRecord = caseStore.getLatestCase(
          { tenantId: TENANT_A, correlationId: "cor_webrecov_tst1" } as never,
          caseDetail?.caseId ?? "",
        ) as RecoveryCaseRecord | undefined;
        if (caseRecord === undefined) throw new Error("case record vanished");
        const run = {
          caseStore,
          requestStore,
          caseRecord,
          adapter: adapter(TENANT_A, DEV_A1, FULLY_CAPABLE),
        };
        const executed = approveDestructiveOrThrow(run, record, "approve", atHour(3));
        setRecord(executed);
      }}
      onOpenCases={(): void => setSurface("cases")}
      onOpenFindMy={(): void => setSurface("find-my")}
    />
  );
}

test("JOURNEY: recover a lost device — last-seen evidence -> case -> gated wipe proposal -> approval -> VERIFIED execution evidence", async () => {
  const user = userEvent.setup();

  // --- Stage 1: Find My Device — the last-seen + location evidence ---
  render(<LostDeviceJourneyShell />);
  expect(screen.getByRole("region", { name: "Recovery — Find My Device" })).toBeTruthy();
  expect(screen.getByText(/Located — evidence/)).toBeTruthy();
  expect(screen.getByText("Last-known location")).toBeTruthy();
  // The evidence ledger shows the location-bearing revision
  expect(screen.getByText(/location-bearing/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Open recovery case" }));

  // --- Stage 2: the recovery case — the durable, gated context ---
  expect(screen.getByRole("region", { name: "Recovery — Cases" })).toBeTruthy();
  const sheet = screen.getByRole("dialog", { name: /Recovery case / });
  expect(within(sheet).getByText(/OPENED — Needs attention/)).toBeTruthy();
  // The destructive gate precondition is VISIBLE
  expect(within(sheet).getByText("Destructive actions accepted in this state")).toBeTruthy();
  // The trigger evidence
  expect(within(sheet).getByText("lost_report")).toBeTruthy();
  expect(within(sheet).getByText("left on a train")).toBeTruthy();
  await user.click(within(sheet).getByRole("button", { name: "Open destructive actions" }));

  // --- Stage 3: the gated destructive path — REQUEST the wipe ---
  expect(screen.getByRole("region", { name: "Recovery — Destructive actions" })).toBeTruthy();
  const wipeCard = screen.getByText(/Erases all data on the device/).closest("section");
  expect(wipeCard).toBeTruthy();
  if (wipeCard === null) throw new Error("unreachable");
  // Before the request: the gate ledger shows unmet steps
  expect(within(wipeCard).getByText(/Guardian: not_evaluated — Unknown/)).toBeTruthy();
  await user.click(within(wipeCard).getByRole("button", { name: "Request wipe" }));

  // --- Stage 4: the PARKED proposal — NEVER presented as executed ---
  const parkedCard = screen.getByText(/Erases all data on the device/).closest("section");
  expect(parkedCard).toBeTruthy();
  if (parkedCard === null) throw new Error("unreachable");
  expect(within(parkedCard).getByText(/Guardian: REQUIRE_APPROVAL — Approval required/)).toBeTruthy();
  expect(within(parkedCard).getByText(/PROPOSAL in the gated pipeline/i)).toBeTruthy();
  expect(within(parkedCard).getByText(/has NOT executed/i)).toBeTruthy();
  // The human-approval gate step is PENDING
  expect(within(parkedCard).getAllByText(/pending — Approval required/).length).toBeGreaterThan(0);
  // No execution evidence exists yet
  expect(within(parkedCard).queryByText(/Execution executed at/)).toBeNull();

  // --- Stage 5: the human approval — the explicit grant ---
  await user.click(within(parkedCard).getByRole("button", { name: "Approve request" }));

  // --- Stage 6: the VERIFIED terminal state — execution + evidence ---
  const executedCard = screen.getByText(/Erases all data on the device/).closest("section");
  expect(executedCard).toBeTruthy();
  if (executedCard === null) throw new Error("unreachable");
  expect(within(executedCard).getByText(/Execution executed at/)).toBeTruthy();
  expect(within(executedCard).getByText(/adapter evidence artifact/i)).toBeTruthy();
  // The proposal framing is GONE for the executed request
  expect(within(executedCard).queryByText(/PROPOSAL in the gated pipeline/i)).toBeNull();
  // The versioned evidence trail: the full request lineage
  const history = screen.getByRole("list", { name: "Request revision history" });
  expect(within(history).getByText(/v1 — REQUESTED/)).toBeTruthy();
  expect(within(history).getByText(/v2 — PARKED/)).toBeTruthy();
  expect(within(history).getByText(/v3 — APPROVED/)).toBeTruthy();
  expect(within(history).getByText(/v4 — EXECUTED/)).toBeTruthy();
  // The approval's explicit grant is recorded
  expect(within(executedCard).getByText(/Approval decided by/)).toBeTruthy();
  // The §16 evidence trail is visible (opaque refs, verbatim)
  expect(within(executedCard).getByText(/evidence\/wipe-request/)).toBeTruthy();
});
