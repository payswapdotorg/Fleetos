/**
 * W090A web-device — JOURNEY EVIDENCE tests (D4): the two device-lane
 * journeys from the UX simulation's required list, walked through the
 * FULL RENDERED screens with the REAL domain packages bound at the
 * test's binding site:
 *
 *   1. "enroll an existing fleet" — covered end-to-end in
 *      render-enrollment.test.tsx (initiate -> review -> confirm ->
 *      VERIFIED with evidence, over the REAL device-model TwinStore).
 *
 *   2. "diagnose a device" (this file): the operator sees the
 *      unhealthy device on the rendered roster, opens Device Doctor,
 *      reads the diagnosis evidence (signals -> anomalies -> the
 *      versioned diagnosis), and accepts the treatment PROPOSAL —
 *      which routes to the intent boundary and is presented as NOT
 *      executed, with the interpretation ledger's versioned lineage
 *      and the OPAQUE evidence refs visible. The journey's terminal
 *      state is the ACCEPTED, GATED disposition with evidence — the
 *      proposal/execution distinction preserved (LOCK items 3 + 4).
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  DeviceFleetScreen,
  DeviceDoctorScreen,
  buildDeviceDoctorViewModel,
  buildDeviceListViewModel,
  initialDoctorPanelState,
  openDoctorPanel,
} from "../src/index";
import type { DeviceListFilter, DeviceListSort, DoctorPanel, DoctorPanelState } from "../src/index";
import {
  BANDS,
  DEV_A1,
  SCOPE_A,
  TENANT_A,
  atHour,
  diagnosisFixture,
  healthFixture,
  obs,
  realDoctorSources,
  seededTwinSource,
  twinFixture,
} from "./helpers";

afterEach(() => {
  cleanup();
});

const NOW = atHour(72);

/** The diagnose-device fixture: one AT_RISK device with REAL anomalies. */
function diagnoseFixture() {
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3, // DIAGNOSE
    observations: [obs("device.power", { batteryPercent: 7 }, atHour(2))],
    postureSummary: "AT_RISK",
    findingCount: 2,
  });
  const source = seededTwinSource([twin]);
  const roster = buildDeviceListViewModel(
    SCOPE_A,
    source,
    {
      filter: { kind: "all" } as DeviceListFilter,
      sort: { field: "deviceId", direction: "asc" } as DeviceListSort,
      page: { offset: 0, limit: 10 },
    },
    { now: NOW, ...BANDS },
  );
  if (!roster.ok) throw new Error("roster build failed");

  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)),
    obs("device.storage", { usedBytes: 190, totalBytes: 200 }, atHour(1)),
    obs("device.health", { temperatureC: 91 }, atHour(1)),
    obs("device.health", { cpuUtilization: 30 }, atHour(2)),
    obs("device.health", { cpuUtilization: 32 }, atHour(3)),
  ];
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const doctorSources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const doctor = buildDeviceDoctorViewModel(SCOPE_A, doctorSources, DEV_A1, { now: atHour(48) });
  if (doctor === undefined) throw new Error("doctor build failed");
  return { rosterView: roster.view, doctorView: doctor };
}

/** A minimal shell: the roster screen with the open-device hand-off. */
function RosterShell(props: { readonly onOpenDevice: (deviceId: string) => void }): React.JSX.Element {
  const { rosterView } = diagnoseFixture();
  const [search, setSearch] = useState("");
  return (
    <DeviceFleetScreen
      phase={{ kind: "ready", view: rosterView }}
      query={{ search, facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={setSearch}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(deviceId): void => props.onOpenDevice(deviceId as string)}
      onEnroll={(): void => {}}
    />
  );
}

/** A minimal shell: the doctor screen with the accept/dismiss intents. */
function DoctorShell(props: {
  readonly accepted: string[];
  readonly dismissed: string[];
}): React.JSX.Element {
  const { doctorView } = diagnoseFixture();
  const [panel, setPanel] = useState<DoctorPanelState>(initialDoctorPanelState("signals"));
  const [disposition, setDisposition] = useState<Record<string, "accepted" | "dismissed">>({});
  return (
    <DeviceDoctorScreen
      phase={{ kind: "ready", view: doctorView }}
      deviceId={DEV_A1}
      panel={panel}
      onPanelChange={(next: string): void => {
        setPanel(openDoctorPanel(panel, next as DoctorPanel));
      }}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(treatment): void => {
        props.accepted.push(treatment.id);
        setDisposition({ ...disposition, [treatment.id]: "accepted" });
      }}
      onDismissTreatment={(treatment): void => {
        props.dismissed.push(treatment.id);
      }}
      treatmentDisposition={disposition}
    />
  );
}

test("JOURNEY: diagnose a device — roster -> doctor -> diagnosis evidence -> accepted (gated) treatment with evidence", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];

  // --- Stage 1: the roster shows the device that needs attention ---
  render(<RosterShell onOpenDevice={(deviceId: string): void => { opened.push(deviceId); }} />);
  const row = screen.getByText("Lenovo ThinkPad X1").closest("tr");
  expect(row).toBeTruthy();
  if (row === null) throw new Error("unreachable");
  // The posture + staleness indicators carry their text (never color alone)
  expect(within(row).getByText(/AT_RISK — Needs attention/)).toBeTruthy();
  expect(within(row).getByText(/Stale — Needs attention/)).toBeTruthy();

  // --- Stage 2: open the device's diagnosis from the roster ---
  await user.click(within(row).getByRole("button", { name: "Lenovo ThinkPad X1" }));
  expect(opened).toEqual(["dev_testdevice00a1"]);
  cleanup();

  // --- Stage 3: Device Doctor — the record pattern ---
  const accepted: string[] = [];
  const dismissed: string[] = [];
  render(<DoctorShell accepted={accepted} dismissed={dismissed} />);
  expect(screen.getByText("Summary")).toBeTruthy();
  // The summary counts the REAL pipeline's anomalies (battery + storage +
  // temperature are all CRITICAL in the fixture)
  expect(screen.getByText(/3 critical anomalies need attention/)).toBeTruthy();
  expect(screen.getByText("Why it matters")).toBeTruthy();

  // --- Stage 4: the diagnosis evidence (anomalies -> diagnoses) ---
  await user.click(screen.getByRole("tab", { name: /Anomalies \(/ }));
  expect(screen.getByText("Detected anomalies, severity first")).toBeTruthy();
  expect(screen.getAllByText(/CRITICAL — Needs attention/).length).toBe(3);
  await user.click(screen.getByRole("tab", { name: /Diagnoses \(/ }));
  expect(screen.getAllByText(/Interpretation ACTIVE — Informational/).length).toBeGreaterThan(0);
  // The versioned diagnosis shows its lineage + evidence links
  expect(screen.getAllByText(/Interpretation version/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Evidence links/).length).toBeGreaterThan(0);

  // --- Stage 5: the treatment recommendation -> ACCEPT (a gated proposal) ---
  await user.click(screen.getByRole("tab", { name: /Treatments \(/ }));
  const acceptButtons = screen.getAllByRole("button", { name: "Accept proposal" });
  expect(acceptButtons.length).toBeGreaterThan(0);
  await user.click(acceptButtons[0] as HTMLElement);
  expect(accepted.length).toBe(1);

  // --- Stage 6: the terminal state — accepted AND visibly NOT executed ---
  expect(screen.getByText("Accepted — routed to the intent boundary")).toBeTruthy();
  expect(screen.getByText(/Not executed: execution is verified separately/i)).toBeTruthy();
  // The evidence refs are visible (opaque, verbatim)
  expect(screen.getByText("Evidence")).toBeTruthy();
  expect(screen.getByText(/Opaque content-addressable references/i)).toBeTruthy();
  // The ACCEPTED treatment's accept affordance is gone (the remaining
  // proposals keep theirs — each row carries its own disposition)
  expect(screen.getAllByRole("button", { name: "Accept proposal" }).length).toBe(acceptButtons.length - 1);
});
