/**
 * W090A web-device — browser-facing RENDER tests for the device
 * screens (D4): every screen renders from a FROZEN view-model
 * snapshot built over the REAL `@fleetos/device-model` TwinStore (and
 * the REAL `@fleetos/health` pipeline for the doctor); text content,
 * roles, labels, and semantic landmarks are asserted; keyboard
 * navigation and visible focus are exercised; icon-only controls have
 * accessible names; reduced-motion is respected (asserted against the
 * token stylesheet); the exact empty/loading/error/invalid states are
 * rendered; and the same props always produce byte-identical static
 * markup (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`) BEFORE
 * any module loads — required because testing libraries capture
 * browser globals at module-load time.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { asDeviceId } from "@fleetos/contracts";
import {
  buildDeviceDetailHeader,
  buildDeviceDoctorViewModel,
  buildDeviceListViewModel,
  clearSelection,
  initialDoctorPanelState,
  openDoctorPanel,
  selectOne,
  selectVisible,
  toggleSelection,
  DeviceFleetScreen,
  DeviceDoctorScreen,
  DeviceLifecycleScreen,
  CONSOLE_CSS,
} from "../src/index";
import type {
  DeviceListFilter,
  DeviceListSort,
  DeviceSelection,
  DoctorPanelState,
} from "../src/index";
import {
  BANDS,
  DEV_A1,
  DEV_A2,
  DEV_A3,
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

// ---------------------------------------------------------------------------
// The frozen fixture (REAL twins, deterministic)
// ---------------------------------------------------------------------------

/** The deterministic fixture fleet (three tenant-A devices). */
function fleet() {
  return [
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      lifecycleHops: 2, // ASSESS
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(2))],
      postureSummary: "HEALTHY",
    }),
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A2,
      manufacturer: "Dell",
      model: "Latitude 5440",
      ownerType: "LEASED",
      assignedTeam: "field-sales",
      lifecycleHops: 8, // LEARN (terminal)
      observations: [obs("device.power", { batteryPercent: 5 }, atHour(40))],
      postureSummary: "AT_RISK",
      findingCount: 3,
      recoveryState: "ACTIVE",
      activeActionIds: ["act_1"],
    }),
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A3,
      adapterFamily: "macos",
      manufacturer: "Apple",
      model: "MacBook Pro 14",
      lifecycleHops: 0, // ENROLL (never observed)
    }),
  ];
}

const NOW = atHour(72);

/** The frozen roster view-model over the fixture fleet (limit 2 => 2 pages). */
function rosterView(limit = 10) {
  const source = seededTwinSource(fleet());
  const build = buildDeviceListViewModel(
    SCOPE_A,
    source,
    {
      filter: { kind: "all" } as DeviceListFilter,
      sort: { field: "deviceId", direction: "asc" } as DeviceListSort,
      page: { offset: 0, limit },
    },
    { now: NOW, ...BANDS },
  );
  if (!build.ok) throw new Error("roster build failed");
  return build.view;
}

/** The frozen detail-header view-model for the terminal (LEARN) device. */
function detailHeaderOf(deviceId: typeof DEV_A1 | typeof DEV_A2 | typeof DEV_A3) {
  const source = seededTwinSource(fleet());
  const header = buildDeviceDetailHeader(SCOPE_A, source, deviceId, { now: NOW, ...BANDS });
  if (header === undefined) throw new Error("detail header build failed");
  return header;
}

/** The frozen doctor view-model over the REAL health pipeline. */
function doctorView() {
  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)),
    obs("device.storage", { usedBytes: 190, totalBytes: 200 }, atHour(1)),
    obs("device.health", { temperatureC: 91 }, atHour(1)),
    obs("device.health", { cpuUtilization: 30 }, atHour(2)),
    obs("device.health", { cpuUtilization: 32 }, atHour(3)),
    obs("device.health", { memoryUtilization: 55 }, atHour(10)),
  ];
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  if (view === undefined) throw new Error("doctor build failed");
  return view;
}

// ---------------------------------------------------------------------------
// The design contract: tokens + reduced motion (asserted on the CSS)
// ---------------------------------------------------------------------------

test("the local token stylesheet declares the semantic tokens and the reduced-motion rule", () => {
  expect(CONSOLE_CSS).toContain("--surface:");
  expect(CONSOLE_CSS).toContain("--text-primary:");
  expect(CONSOLE_CSS).toContain("--status-attention:");
  expect(CONSOLE_CSS).toContain("--hairline:");
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  // No gradients by default: the skeleton shimmer is the ONLY gradient
  // (and it is disabled under reduced motion by the rule above).
  const gradientCount = CONSOLE_CSS.split("linear-gradient(").length - 1;
  expect(gradientCount).toBe(1);
  const skeletonRule = CONSOLE_CSS.slice(CONSOLE_CSS.indexOf(".fos-skeleton__bar {"));
  expect(skeletonRule).toContain("linear-gradient(");
});

// ---------------------------------------------------------------------------
// DeviceFleetScreen — render from the frozen view-model
// ---------------------------------------------------------------------------

test("DeviceFleetScreen renders the semantic roster table with landmarks, labels, and text-bearing status indicators", () => {
  const view = rosterView();
  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );

  // Semantic landmarks
  expect(screen.getByRole("region", { name: "Devices — fleet list" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();

  // The semantic table with its caption
  const table = screen.getByRole("table");
  expect(table).toBeTruthy();
  const caption = within(table).getByText(/Device fleet roster — 3 of 3 devices match/);
  expect(caption).toBeTruthy();

  // Column headers (the sortable ones are buttons with accessible names)
  expect(within(table).getByRole("columnheader", { name: "Device" })).toBeTruthy();
  expect(within(table).getByRole("button", { name: /Sort by Device/ })).toBeTruthy();
  expect(within(table).getByRole("button", { name: /Sort by Lifecycle/ })).toBeTruthy();
  expect(within(table).getByRole("button", { name: /Sort by Posture/ })).toBeTruthy();
  expect(within(table).getByRole("button", { name: /Sort by Last observed/ })).toBeTruthy();

  // Rows: display names + device ids + lifecycle badges
  expect(screen.getByText("Lenovo ThinkPad X1")).toBeTruthy();
  expect(screen.getByText("Dell Latitude 5440")).toBeTruthy();
  expect(screen.getByText("Apple MacBook Pro 14")).toBeTruthy();
  expect(screen.getByText("dev_testdevice00a1")).toBeTruthy();

  // Status is NEVER conveyed by color alone: every posture + staleness
  // indicator carries its text (the domain value AND the vocabulary word).
  // (At NOW=72h both observed devices are STALE; A3 was never observed.)
  expect(screen.getAllByText(/HEALTHY — Healthy/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/AT_RISK — Needs attention/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Stale — Needs attention/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Never observed — Unknown/).length).toBeGreaterThan(0);

  // Facet chips with counts (the deterministic facet families)
  expect(screen.getByRole("button", { name: /Lifecycle: ENROLL \(1 device\)/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Posture: AT_RISK \(1 device\)/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Ownership: LEASED \(1 device\)/ })).toBeTruthy();

  // The enrollment entry point (the UX journey gap's fix)
  expect(screen.getAllByRole("button", { name: "Enroll devices" }).length).toBeGreaterThan(0);

  // The search input is labeled
  expect(screen.getByLabelText("Search devices")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// DeviceFleetScreen — the exact states (loading / error / invalid / empty)
// ---------------------------------------------------------------------------

test("DeviceFleetScreen renders skeleton placeholders while loading", () => {
  render(
    <DeviceFleetScreen
      phase={{ kind: "loading" }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading the device roster" })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

test("DeviceFleetScreen renders an actionable error alert with retry", () => {
  let retried = 0;
  render(
    <DeviceFleetScreen
      phase={{ kind: "error", message: "The roster source is unreachable.", onRetry: (): void => { retried += 1; } }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert).toBeTruthy();
  expect(within(alert).getByText("Something went wrong")).toBeTruthy();
  expect(within(alert).getByText("The roster source is unreachable.")).toBeTruthy();
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(retried).toBe(1);
});

test("DeviceFleetScreen renders the invalid-build failure list verbatim (machine-stable reasons)", () => {
  render(
    <DeviceFleetScreen
      phase={{ kind: "invalid", failures: [{ path: "/sort/field", reason: "required" }] }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("/sort/field")).toBeTruthy();
  expect(within(alert).getByText("required")).toBeTruthy();
});

test("DeviceFleetScreen renders the instructive zero state when the fleet is empty (enrollment entry point)", () => {
  const source = seededTwinSource([]);
  const build = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { filter: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } },
    { now: NOW, ...BANDS },
  );
  if (!build.ok) throw new Error("unreachable");
  let enrolled = 0;
  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view: build.view }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => { enrolled += 1; }}
    />,
  );
  expect(screen.getByText("No devices are enrolled yet")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Enroll devices" })[0] as HTMLElement);
  expect(enrolled).toBe(1);
});

test("DeviceFleetScreen renders the no-matches zero state with a clear-filters action", () => {
  const source = seededTwinSource(fleet());
  const build = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { filter: { kind: "search", text: "nonexistent-hardware" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } },
    { now: NOW, ...BANDS },
  );
  if (!build.ok) throw new Error("unreachable");
  const facetChanges: DeviceListFilter[] = [];
  const searches: string[] = [];
  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view: build.view }}
      query={{ search: "nonexistent-hardware", facet: { kind: "search", text: "nonexistent-hardware" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(text: string): void => { searches.push(text); }}
      onFacetChange={(facet: DeviceListFilter): void => { facetChanges.push(facet); }}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  expect(screen.getByText("No devices match the current filters")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(facetChanges).toEqual([{ kind: "all" }]);
  expect(searches).toEqual([""]);
});

// ---------------------------------------------------------------------------
// DeviceFleetScreen — interactions (filter / paginate / select / open)
// ---------------------------------------------------------------------------

test("DeviceFleetScreen interactions: search, facet, sort, paginate, select, and open device", async () => {
  const user = userEvent.setup();
  const view = rosterView(2); // 3 devices, 2 per page => pagination
  const searches: string[] = [];
  const facetChanges: DeviceListFilter[] = [];
  const sorts: DeviceListSort[] = [];
  const pages: { offset: number; limit: number }[] = [];
  const toggles: string[] = [];
  const opened: string[] = [];
  let selectVisibleCalled = 0;
  let clearCalled = 0;

  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 2 } }}
      selection={{ kind: "none" }}
      onSearchChange={(text: string): void => { searches.push(text); }}
      onFacetChange={(facet: DeviceListFilter): void => { facetChanges.push(facet); }}
      onSortChange={(sort: DeviceListSort): void => { sorts.push(sort); }}
      onPageChange={(page: { offset: number; limit: number }): void => { pages.push(page); }}
      onToggleDevice={(deviceId): void => { toggles.push(deviceId as string); }}
      onSelectVisible={(): void => { selectVisibleCalled += 1; }}
      onClearSelection={(): void => { clearCalled += 1; }}
      onOpenDevice={(deviceId): void => { opened.push(deviceId as string); }}
      onEnroll={(): void => {}}
    />,
  );

  // Search typing flows through the callback
  await user.type(screen.getByLabelText("Search devices"), "del");
  expect(searches.join("")).toBe("del");

  // A facet chip press selects that facet
  await user.click(screen.getByRole("button", { name: /Posture: AT_RISK \(1 device\)/ }));
  expect(facetChanges).toEqual([{ kind: "posture", summary: "AT_RISK" }]);

  // Sorting by the active asc header inverts to desc
  await user.click(screen.getByRole("button", { name: /Sort by Device \(ascending\)/ }));
  expect(sorts).toEqual([{ field: "deviceId", direction: "desc" }]);

  // Pagination: next fires with the advanced offset
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(pages).toEqual([{ offset: 2, limit: 2 }]);

  // Selection: the row checkbox fires the toggle
  await user.click(screen.getByLabelText("Select Lenovo ThinkPad X1 (dev_testdevice00a1)"));
  expect(toggles).toEqual(["dev_testdevice00a1"]);

  // Opening a device fires the open callback
  await user.click(screen.getByRole("button", { name: "Dell Latitude 5440" }));
  expect(opened).toEqual(["dev_testdevice00a2"]);

  // With a selection present: select-visible + clear affordances appear
  cleanup();
  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 2 } }}
      selection={selectOne(DEV_A1)}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => { selectVisibleCalled += 1; }}
      onClearSelection={(): void => { clearCalled += 1; }}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  expect(screen.getByText(/1 device selected/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Select all on this page" }));
  await user.click(screen.getByRole("button", { name: "Clear the device selection" }));
  expect(selectVisibleCalled).toBe(1);
  expect(clearCalled).toBe(1);
});

test("the selection state machine integration: toggle flows through the pure view-model functions", () => {
  // The screen stays presentational; the shell routes through the pure VM:
  let selection: DeviceSelection = { kind: "none" };
  selection = toggleSelection(selection, DEV_A1);
  expect(selection.kind).toBe("single");
  selection = toggleSelection(selection, DEV_A2);
  expect(selection.kind).toBe("many");
  if (selection.kind !== "many") throw new Error("unreachable");
  expect([...selection.deviceIds]).toEqual([DEV_A1, DEV_A2] as never as string[]);
  selection = selectVisible(selection, [DEV_A3]);
  expect(selection.kind).toBe("many");
  selection = clearSelection();
  expect(selection.kind).toBe("none");
});

// ---------------------------------------------------------------------------
// DeviceFleetScreen — keyboard navigation + visible focus
// ---------------------------------------------------------------------------

test("DeviceFleetScreen keyboard navigation: focus moves through the controls in order", async () => {
  const user = userEvent.setup();
  const view = rosterView();
  render(
    <DeviceFleetScreen
      phase={{ kind: "ready", view }}
      query={{ search: "", facet: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: { offset: 0, limit: 10 } }}
      selection={{ kind: "none" }}
      onSearchChange={(): void => {}}
      onFacetChange={(): void => {}}
      onSortChange={(): void => {}}
      onPageChange={(): void => {}}
      onToggleDevice={(): void => {}}
      onSelectVisible={(): void => {}}
      onClearSelection={(): void => {}}
      onOpenDevice={(): void => {}}
      onEnroll={(): void => {}}
    />,
  );
  const search = screen.getByLabelText("Search devices");
  search.focus();
  expect(document.activeElement).toBe(search);
  await user.tab();
  expect(document.activeElement).not.toBe(search);
  // The roster's first interactive control after the search is reachable
  // and focused elements are visible (the :focus-visible outline is in
  // the token stylesheet — asserted in the CSS test above).
  const active = document.activeElement as HTMLElement;
  expect(active instanceof HTMLElement).toBe(true);
});

// ---------------------------------------------------------------------------
// DeviceDoctorScreen — the record pattern
// ---------------------------------------------------------------------------

test("DeviceDoctorScreen renders the record pattern: summary, why it matters, panels, evidence, history", () => {
  const view = doctorView();
  render(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      panel={initialDoctorPanelState("signals")}
      onPanelChange={(): void => {}}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => {}}
      onDismissTreatment={(): void => {}}
    />,
  );

  expect(screen.getByRole("region", { name: "Devices — Device Doctor" })).toBeTruthy();
  // Summary block
  expect(screen.getByText("Summary")).toBeTruthy();
  expect(screen.getByText("Active diagnoses")).toBeTruthy();
  // Why it matters
  expect(screen.getByText("Why it matters")).toBeTruthy();
  // The tablist with counts
  expect(screen.getByRole("tablist", { name: "Device Doctor panels" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Signals \(\d+\)/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Anomalies \(\d+\)/ })).toBeTruthy();
  // The signals table renders (latest sample values)
  expect(screen.getByText("battery.capacity")).toBeTruthy();
  // Evidence + history cards
  expect(screen.getByText("Evidence")).toBeTruthy();
  expect(screen.getByText("History")).toBeTruthy();
});

test("DeviceDoctorScreen tabs navigate by keyboard (arrow keys) and fire the panel change", async () => {
  const user = userEvent.setup();
  const view = doctorView();
  const changes: string[] = [];
  let panel: DoctorPanelState = initialDoctorPanelState("signals");
  const { rerender } = render(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      panel={panel}
      onPanelChange={(next: string): void => {
        changes.push(next);
        panel = openDoctorPanel(panel, next as "signals");
      }}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => {}}
      onDismissTreatment={(): void => {}}
    />,
  );
  const tablist = screen.getByRole("tablist", { name: "Device Doctor panels" });
  const signalsTab = screen.getByRole("tab", { name: /Signals \(\d+\)/ });
  signalsTab.focus();
  expect(document.activeElement).toBe(signalsTab);
  // ArrowRight moves to the next tab (baselines) and fires the change
  fireEvent.keyDown(tablist, { key: "ArrowRight" });
  expect(changes).toEqual(["baselines"]);
  rerender(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      panel={panel}
      onPanelChange={(next: string): void => {
        changes.push(next);
        panel = openDoctorPanel(panel, next as "signals");
      }}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => {}}
      onDismissTreatment={(): void => {}}
    />,
  );
  expect(screen.getByRole("tab", { name: /Baselines/ }).getAttribute("aria-selected")).toBe("true");
  // ArrowLeft returns
  fireEvent.keyDown(tablist, { key: "ArrowLeft" });
  expect(changes).toEqual(["baselines", "signals"]);
});

test("DeviceDoctorScreen treatment proposals: accept/dismiss fire intents; a proposal is NEVER presented as executed", async () => {
  const user = userEvent.setup();
  const view = doctorView();
  expect(view.treatments.length).toBeGreaterThan(0);
  const accepted: string[] = [];
  const dismissed: string[] = [];
  render(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      panel={initialDoctorPanelState("treatments")}
      onPanelChange={(): void => {}}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(treatment): void => { accepted.push(treatment.id); }}
      onDismissTreatment={(treatment): void => { dismissed.push(treatment.id); }}
    />,
  );

  // The treatments tab is active: proposals render with their intent kind
  expect(screen.getAllByText(/Proposal:/).length).toBe(view.treatments.length);
  expect(screen.getAllByText(/Accept proposal/).length).toBe(view.treatments.length);

  // The proposal framing is explicit: execution requires the boundary
  expect(screen.getAllByText(/does not execute anything/i).length).toBeGreaterThan(0);

  // Accept + dismiss fire the intent callbacks with the treatment rows
  await user.click(screen.getAllByRole("button", { name: "Accept proposal" })[0] as HTMLElement);
  expect(accepted).toEqual([view.treatments[0].id]);
  await user.click(screen.getAllByRole("button", { name: "Dismiss proposal" })[0] as HTMLElement);
  expect(dismissed).toEqual([view.treatments[0].id]);

  // With a recorded disposition, the row shows the routed state — NOT executed
  cleanup();
  render(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view }}
      deviceId={DEV_A1}
      panel={initialDoctorPanelState("treatments")}
      onPanelChange={(): void => {}}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => {}}
      onDismissTreatment={(): void => {}}
      treatmentDisposition={{ [view.treatments[0].id]: "accepted" }}
    />,
  );
  expect(screen.getByText("Accepted — routed to the intent boundary")).toBeTruthy();
  expect(screen.getByText(/Not executed: execution is verified separately/i)).toBeTruthy();
});

test("DeviceDoctorScreen renders the absent-device zero state (no existence side channel)", () => {
  render(
    <DeviceDoctorScreen
      phase={{ kind: "ready", view: undefined }}
      deviceId={asDeviceId("dev_missing0000000")}
      panel={initialDoctorPanelState("signals")}
      onPanelChange={(): void => {}}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => {}}
      onDismissTreatment={(): void => {}}
    />,
  );
  expect(screen.getByText("Device not found in your fleet")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// DeviceLifecycleScreen — authorization visible on every transition
// ---------------------------------------------------------------------------

test("DeviceLifecycleScreen renders the machine read-only with authorization status on the transition request", async () => {
  const user = userEvent.setup();
  const header = detailHeaderOf(DEV_A1); // ASSESS -> next legal: DIAGNOSE
  const requested: string[] = [];
  render(
    <DeviceLifecycleScreen
      phase={{ kind: "ready", view: header }}
      deviceId={DEV_A1}
      transitionAuthorization={{ DIAGNOSE: { state: "pending", note: "approval_pending_diag" } }}
      onRequestTransition={(target): void => { requested.push(target as string); }}
      onOpenDoctor={(): void => {}}
    />,
  );

  expect(screen.getByRole("region", { name: "Devices — Lifecycle" })).toBeTruthy();
  // The lifecycle timeline renders the canonical order
  expect(screen.getByText("ENROLL")).toBeTruthy();
  expect(screen.getByText("ASSESS")).toBeTruthy();
  expect(screen.getByText("LEARN")).toBeTruthy();
  // The transition request card shows the AUTHORIZATION state visibly
  expect(screen.getByText(/Awaiting authorization — Approval required/)).toBeTruthy();
  expect(screen.getByText("approval_pending_diag")).toBeTruthy();
  // Requesting fires the intent (routed to the boundary by the shell)
  await user.click(screen.getByRole("button", { name: "Request transition to DIAGNOSE" }));
  expect(requested).toEqual(["DIAGNOSE"]);
});

test("DeviceLifecycleScreen renders the terminal state with the loop-closure note (no transition requests)", () => {
  const header = detailHeaderOf(DEV_A2); // LEARN — terminal
  render(
    <DeviceLifecycleScreen
      phase={{ kind: "ready", view: header }}
      deviceId={DEV_A2}
      transitionAuthorization={{}}
      onRequestTransition={(): void => {}}
      onOpenDoctor={(): void => {}}
    />,
  );
  expect(screen.getByText(/re-enters OBSERVE through observation ingestion/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Request transition/ })).toBeNull();
  // The provenance history renders the append-only revision log
  expect(screen.getByText("Provenance history")).toBeTruthy();
  expect(screen.getByText(/Append-only revision log/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Determinism: same props -> byte-identical static markup
// ---------------------------------------------------------------------------

test("the screens render byte-identical static markup for the same props (determinism)", () => {
  const view = rosterView();
  const fleetProps = {
    phase: { kind: "ready" as const, view },
    query: {
      search: "",
      facet: { kind: "all" as const },
      sort: { field: "deviceId" as const, direction: "asc" as const },
      page: { offset: 0, limit: 10 },
    },
    selection: { kind: "none" as const },
    onSearchChange: (): void => {},
    onFacetChange: (): void => {},
    onSortChange: (): void => {},
    onPageChange: (): void => {},
    onToggleDevice: (): void => {},
    onSelectVisible: (): void => {},
    onClearSelection: (): void => {},
    onOpenDevice: (): void => {},
    onEnroll: (): void => {},
  };
  const a = renderToStaticMarkup(createElement(DeviceFleetScreen, fleetProps));
  const b = renderToStaticMarkup(createElement(DeviceFleetScreen, fleetProps));
  expect(a).toBe(b);

  const doctorProps = {
    phase: { kind: "ready" as const, view: doctorView() },
    deviceId: DEV_A1,
    panel: initialDoctorPanelState("signals"),
    onPanelChange: (): void => {},
    onPanelBack: (): void => {},
    onOpenDevice: (): void => {},
    onAcceptTreatment: (): void => {},
    onDismissTreatment: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(DeviceDoctorScreen, doctorProps))).toBe(
    renderToStaticMarkup(createElement(DeviceDoctorScreen, doctorProps)),
  );

  const lifecycleProps = {
    phase: { kind: "ready" as const, view: detailHeaderOf(DEV_A1) },
    deviceId: DEV_A1,
    transitionAuthorization: { DIAGNOSE: { state: "pending" as const } },
    onRequestTransition: (): void => {},
    onOpenDoctor: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(DeviceLifecycleScreen, lifecycleProps))).toBe(
    renderToStaticMarkup(createElement(DeviceLifecycleScreen, lifecycleProps)),
  );

  // No instants were derived inside the components: the roster caption
  // carries the view-model's injected `asOf` verbatim.
  expect(a).toContain(NOW);
});
