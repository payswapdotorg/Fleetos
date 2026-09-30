/**
 * W090C web-workloads — browser-facing RENDER tests (D4): the
 * WorkloadPlanningScreen renders from a FROZEN view-model snapshot
 * built over the REAL `@fleetos/workloads` /
 * `@fleetos/software` / `@fleetos/maintenance` /
 * `@fleetos/integration-adcos` records; text content, roles, labels,
 * and semantic landmarks are asserted; keyboard navigation and visible
 * focus are exercised; icon-only controls have accessible names;
 * reduced-motion is respected (asserted against the token stylesheet);
 * the exact empty/loading/error/invalid states are rendered; the
 * approval/blocked linkage semantics (PARKED / REJECTED) are explicit;
 * draft intent proposals are NEVER presented as executed actions; and
 * the same props always produce byte-identical static markup
 * (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`) BEFORE any
 * module loads.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  buildWorkloadProfileListView,
  buildWorkloadRecommendationDisplay,
  buildWorkloadResourceLinkageView,
  buildWorkloadProcurementJourneyView,
  journeyRailStages,
  WorkloadPlanningScreen,
  CONSOLE_CSS,
  reduceWorkloadSurfaceState,
  INITIAL_WORKLOAD_SURFACE_STATE,
} from "../src/index";
import type {
  WorkloadPlanningData,
  WorkloadPlanningScreenProps,
  WorkloadPlanningTab,
  WorkloadSurfaceEvent,
  WorkloadSurfaceState,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  T0,
  WORKLOAD_ID,
  procurementWorkstationCandidate,
  realLedger,
  realParkedSubmission,
  realRejectedSubmission,
  realProfile,
  realSubscription,
  realWorkOrder,
} from "./helpers";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The frozen fixture (REAL records, deterministic)
// ---------------------------------------------------------------------------

const links = () => [
  {
    kind: "hardware" as const,
    workloadId: WORKLOAD_ID,
    tenantId: TENANT_A,
    resource: {
      candidateId: "class.engineering_workstation",
      label: "Engineering Workstation",
      procurementRequired: true,
    },
  },
  {
    kind: "software" as const,
    workloadId: WORKLOAD_ID,
    tenantId: TENANT_A,
    resource: realSubscription(),
  },
  {
    kind: "connectivity" as const,
    workloadId: WORKLOAD_ID,
    tenantId: TENANT_A,
    resource: realParkedSubmission(),
  },
  {
    kind: "maintenance" as const,
    workloadId: WORKLOAD_ID,
    tenantId: TENANT_A,
    resource: realWorkOrder(),
  },
];

/** The frozen planning data over the REAL records. */
function planningData(): WorkloadPlanningData {
  const profile = realProfile();
  const profiles = buildWorkloadProfileListView(TENANT_A, [profile]);
  if (!profiles.ok) throw new Error(profiles.error.message);
  const recommendations = buildWorkloadRecommendationDisplay(TENANT_A, realLedger());
  if (!recommendations.ok) throw new Error(recommendations.error.message);
  const linkage = buildWorkloadResourceLinkageView(TENANT_A, profile, links());
  if (!linkage.ok) throw new Error(linkage.error.message);
  return {
    profiles: profiles.view,
    selected: {
      profile,
      recommendations: recommendations.view,
      linkage: linkage.view,
    },
  };
}

/** The planning data with a REJECTED connectivity linkage (the blocked state). */
function planningDataRejected(): WorkloadPlanningData {
  const profile = realProfile();
  const profiles = buildWorkloadProfileListView(TENANT_A, [profile]);
  if (!profiles.ok) throw new Error(profiles.error.message);
  const recommendations = buildWorkloadRecommendationDisplay(TENANT_A, realLedger());
  if (!recommendations.ok) throw new Error(recommendations.error.message);
  const linkage = buildWorkloadResourceLinkageView(TENANT_A, profile, [
    ...links().filter((link) => link.kind !== "connectivity"),
    {
      kind: "connectivity" as const,
      workloadId: WORKLOAD_ID,
      tenantId: TENANT_A,
      resource: realRejectedSubmission(),
    },
  ]);
  if (!linkage.ok) throw new Error(linkage.error.message);
  return {
    profiles: profiles.view,
    selected: {
      profile,
      recommendations: recommendations.view,
      linkage: linkage.view,
    },
  };
}

// ---------------------------------------------------------------------------
// The minimal controlled shell (the test owns the UI state)
// ---------------------------------------------------------------------------

/** The first recommendation record id of the frozen data (deterministic). */
function recommendationRecordId(data: WorkloadPlanningData): string {
  const row = data.selected?.recommendations.rows[0];
  if (row === undefined) throw new Error("fixture recommendation missing");
  return row.recommendationId;
}

function PlanningShell(props: {
  readonly data: WorkloadPlanningData;
  readonly surface: WorkloadSurfaceState;
  readonly tab: WorkloadPlanningTab;
  readonly journey: readonly ReturnType<typeof journeyRailStages>[number][] | null;
  readonly onStage?: (stageId: string) => void;
  readonly events?: WorkloadSurfaceEvent[];
}): React.JSX.Element {
  const { data, surface, tab, journey } = props;
  return (
    <WorkloadPlanningScreen
      phase={{ kind: "ready", view: data }}
      surface={surface}
      onSurfaceEvent={(event): void => {
        props.events?.push(event);
      }}
      tab={tab}
      onTabChange={(): void => {}}
      journey={journey}
      onOpenJourneyStage={props.onStage}
    />
  );
}

// ---------------------------------------------------------------------------
// Render + states
// ---------------------------------------------------------------------------

test("render: the list view renders the profile roster with roles, landmarks, and verbatim values", () => {
  render(<PlanningShell data={planningData()} surface={{ view: "list" }} tab="recommendations" journey={null} />);
  const region = screen.getByRole("region", { name: "Workloads — planning" });
  expect(region).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Workload planning", level: 1 })).toBeTruthy();
  expect(screen.getByText("finance.analyst")).toBeTruthy();
  expect(screen.getByText("confidential")).toBeTruthy();
  const openButton = screen.getByRole("button", { name: "Open workload finance.analyst (wl_w060c_analyst)" });
  expect(openButton).toBeTruthy();
  // The requirement highlights render verbatim (mobility 0.9 first).
  expect(screen.getByText("mobilityDemand: 0.9")).toBeTruthy();
});

test("render: loading renders skeletons; error renders an actionable alert; invalid lists the failures", () => {
  const { rerender } = render(
    <WorkloadPlanningScreen
      phase={{ kind: "loading" }}
      surface={{ view: "list" }}
      onSurfaceEvent={(): void => {}}
      tab="recommendations"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading the workload planning surface" })).toBeTruthy();

  rerender(
    <WorkloadPlanningScreen
      phase={{ kind: "error", message: "The workload registry is unreachable.", onRetry: (): void => {} }}
      surface={{ view: "list" }}
      onSurfaceEvent={(): void => {}}
      tab="recommendations"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("Something went wrong")).toBeTruthy();
  expect(within(alert).getByText("The workload registry is unreachable.")).toBeTruthy();
  expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();

  rerender(
    <WorkloadPlanningScreen
      phase={{ kind: "invalid", failures: [{ path: "/profiles", reason: "array_required" }] }}
      surface={{ view: "list" }}
      onSurfaceEvent={(): void => {}}
      tab="recommendations"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  const invalid = screen.getByRole("alert");
  expect(within(invalid).getByText("The view could not be built")).toBeTruthy();
  expect(within(invalid).getByText("array_required")).toBeTruthy();
});

test("render: the empty state is instructive when no profiles exist", () => {
  const emptyData: WorkloadPlanningData = {
    profiles: buildWorkloadProfileListView(TENANT_A, []).ok
      ? (buildWorkloadProfileListView(TENANT_A, []) as { ok: true; view: WorkloadPlanningData["profiles"] }).view
      : (undefined as never),
    selected: null,
  };
  render(<PlanningShell data={emptyData} surface={{ view: "list" }} tab="recommendations" journey={null} />);
  expect(screen.getByText("No workload profiles are defined yet")).toBeTruthy();
  expect(screen.getByText(/demand-side truth/i)).toBeTruthy();
});

test("interaction: selecting a profile dispatches the existing state machine event", async () => {
  const user = userEvent.setup();
  const events: WorkloadSurfaceEvent[] = [];
  render(
    <PlanningShell data={planningData()} surface={{ view: "list" }} tab="recommendations" journey={null} events={events} />,
  );
  await user.click(screen.getByRole("button", { name: "Open workload finance.analyst (wl_w060c_analyst)" }));
  expect(events).toEqual([{ type: "select_profile", workloadId: "wl_w060c_analyst" }]);
});

test("render: the profile view follows the record pattern (summary -> current state -> why it matters -> recommended action -> evidence -> history)", () => {
  render(
    <PlanningShell data={planningData()} surface={{ view: "profile", workloadId: "wl_w060c_analyst" }} tab="recommendations" journey={null} />,
  );
  for (const section of [
    "Summary",
    "Current state",
    "Why it matters",
    "Recommended action",
    "Evidence",
    "History",
  ]) {
    expect(screen.getByText(section)).toBeTruthy();
  }
  // The tabs are keyboard-navigable (role=tab) with accessible names.
  expect(screen.getByRole("tab", { name: /Recommendations \(/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Capacity signals \(/ })).toBeTruthy();
});

test("interaction: the profile tabs respond to keyboard navigation (arrow keys fire the change)", async () => {
  const changes: string[] = [];
  let tab: WorkloadPlanningTab = "recommendations";
  const data = planningData();
  const { rerender } = render(
    <WorkloadPlanningScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "profile", workloadId: "wl_w060c_analyst" }}
      onSurfaceEvent={(): void => {}}
      tab={tab}
      onTabChange={(next: string): void => {
        changes.push(next);
        tab = next as WorkloadPlanningTab;
      }}
      journey={null}
    />,
  );
  const tablist = screen.getByRole("tablist", { name: "Workload detail panels" });
  const recommendationsTab = screen.getByRole("tab", { name: /Recommendations \(/ });
  recommendationsTab.focus();
  expect(document.activeElement).toBe(recommendationsTab);
  // ArrowRight moves to the capacity tab and fires the change.
  fireEvent.keyDown(tablist, { key: "ArrowRight" });
  expect(changes).toEqual(["capacity"]);
  rerender(
    <WorkloadPlanningScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "profile", workloadId: "wl_w060c_analyst" }}
      onSurfaceEvent={(): void => {}}
      tab={tab}
      onTabChange={(next: string): void => {
        changes.push(next);
      }}
      journey={null}
    />,
  );
  expect(screen.getByRole("tab", { name: /Capacity signals/ }).getAttribute("aria-selected")).toBe("true");
  // ArrowLeft returns.
  fireEvent.keyDown(tablist, { key: "ArrowLeft" });
  expect(changes).toEqual(["capacity", "recommendations"]);
});

test("render: the recommendation record view presents proposals as NOT executed with evidence and history", async () => {
  const user = userEvent.setup();
  const events: WorkloadSurfaceEvent[] = [];
  const data = planningData();
  render(
    <PlanningShell
      data={data}
      surface={{ view: "profile", workloadId: "wl_w060c_analyst" }}
      tab="recommendations"
      journey={null}
      events={events}
    />,
  );
  // Open the ACTIVE recommendation (the laptop lineage's v2 record).
  const activeRow = data.selected?.recommendations.rows.find((row) => row.status === "ACTIVE");
  if (activeRow === undefined) throw new Error("no active recommendation in fixture");
  await user.click(
    screen.getByRole("button", { name: `Open recommendation ${activeRow.label} (${activeRow.recommendationId})` }),
  );
  expect(events).toEqual([{ type: "open_recommendation", recommendationId: activeRow.recommendationId }]);
  cleanup();

  render(
    <PlanningShell
      data={data}
      surface={{ view: "recommendation", workloadId: "wl_w060c_analyst", recommendationId: activeRow.recommendationId }}
      tab="recommendations"
      journey={null}
    />,
  );
  // The record pattern headings.
  for (const section of ["Summary", "Current state", "Why it matters", "Recommended action", "Evidence", "History"]) {
    expect(screen.getByText(section)).toBeTruthy();
  }
  // The draft intent proposals are READ-ONLY descriptors.
  expect(screen.getAllByText(/Proposal — not executed/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/READ-ONLY descriptors/i)).toBeTruthy();
  // The engine/model version + evidence links are visible.
  expect(screen.getByText(/model v\d/)).toBeTruthy();
  expect(screen.getByText(/Evidence links/)).toBeTruthy();
});

test("render: the capacity signals expose the LOCK 12 kinds with PARKED -> Approval required and procurement_required -> Needs attention", () => {
  render(
    <PlanningShell data={planningData()} surface={{ view: "resources", workloadId: "wl_w060c_analyst" }} tab="capacity" journey={null} />,
  );
  expect(screen.getAllByText("Capacity signals").length).toBeGreaterThan(0);
  for (const badge of ["Hardware: 1", "Software: 1", "Connectivity: 1", "Maintenance: 1"]) {
    expect(screen.getByText(badge)).toBeTruthy();
  }
  // Status is NEVER color-alone: the vocabulary text is always present.
  expect(screen.getByText("PARKED — Approval required")).toBeTruthy();
  expect(screen.getByText("procurement_required — Needs attention")).toBeTruthy();
  expect(screen.getByText("allocated — Healthy")).toBeTruthy();
  expect(screen.getByText("open — Needs attention")).toBeTruthy();
  // ONE breadcrumb trail (the header nav) — no body-level duplicate.
  expect(screen.getAllByRole("navigation").length).toBe(1);
});

test("render: a REJECTED connectivity linkage renders the explicit Blocked state", () => {
  render(
    <PlanningShell data={planningDataRejected()} surface={{ view: "resources", workloadId: "wl_w060c_analyst" }} tab="capacity" journey={null} />,
  );
  // The blocked linkage state is explicit: the domain value verbatim
  // alongside the console vocabulary (never color-alone).
  expect(screen.getByText("REJECTED — Blocked")).toBeTruthy();
  // The linkage row carries the rejected submission's record id.
  expect(screen.getByText("adcos-sub-w060c0002")).toBeTruthy();
});

test("render: the journey rail shows every stage with statuses and navigates by stage id", async () => {
  const user = userEvent.setup();
  const journey = buildWorkloadProcurementJourneyView(TENANT_A, {
    profile: realProfile(),
    ledger: realLedger(),
    subscription: null,
    demand: null,
    quote: null,
    submission: null,
    verification: null,
  });
  if (!journey.ok) throw new Error(journey.error.message);
  const rail = journeyRailStages(journey.view);
  const opened: string[] = [];
  render(
    <PlanningShell
      data={planningData()}
      surface={{ view: "list" }}
      tab="recommendations"
      journey={rail}
      onStage={(stageId): void => {
        opened.push(stageId);
      }}
    />,
  );
  expect(screen.getByText("Journey — workload plan to verified connectivity")).toBeTruthy();
  expect(screen.getByText("Workload plan recommendation")).toBeTruthy();
  expect(screen.getByText("Software need")).toBeTruthy();
  expect(screen.getByText("Verified connectivity")).toBeTruthy();
  // The plan stage is done; the software-need stage is current.
  expect(screen.getByText("Succeeded")).toBeTruthy();
  expect(screen.getByText("Running")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Open journey stage: Software need" }));
  expect(opened).toEqual(["software-need"]);
});

test("a11y: reduced-motion is asserted against the frozen token stylesheet", () => {
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  expect(CONSOLE_CSS).toContain("animation: none !important");
  expect(CONSOLE_CSS).toContain("--surface: #faf8f4");
  expect(CONSOLE_CSS).toContain("--text-primary: #2d2a26");
});

test("a11y: visible focus is styled; the stylesheet class hooks exist", () => {
  expect(CONSOLE_CSS).toContain(".fos-scope button:focus-visible");
  expect(CONSOLE_CSS).toContain("outline: 2px solid var(--accent)");
});

// ---------------------------------------------------------------------------
// Determinism (byte-identical static markup for identical props)
// ---------------------------------------------------------------------------

test("determinism: identical props render byte-identical static markup (list, profile, record, resources)", () => {
  const data = planningData();
  const cases: readonly { readonly surface: WorkloadSurfaceState; readonly tab: WorkloadPlanningTab }[] = [
    { surface: { view: "list" }, tab: "recommendations" },
    { surface: { view: "profile", workloadId: "wl_w060c_analyst" }, tab: "recommendations" },
    { surface: { view: "profile", workloadId: "wl_w060c_analyst" }, tab: "capacity" },
    { surface: { view: "resources", workloadId: "wl_w060c_analyst" }, tab: "capacity" },
    { surface: { view: "recommendation", workloadId: "wl_w060c_analyst", recommendationId: recommendationRecordId(data) }, tab: "recommendations" },
  ];
  for (const { surface, tab } of cases) {
    const first = renderToStaticMarkup(
      createElement(WorkloadPlanningScreen, {
        phase: { kind: "ready", view: data },
        surface,
        onSurfaceEvent: (): void => {},
        tab,
        onTabChange: (): void => {},
        journey: null,
      }),
    );
    const second = renderToStaticMarkup(
      createElement(WorkloadPlanningScreen, {
        phase: { kind: "ready", view: data },
        surface,
        onSurfaceEvent: (): void => {},
        tab,
        onTabChange: (): void => {},
        journey: null,
      }),
    );
    expect(first).toBe(second);
  }
});

test("determinism: the loading, error and invalid phases render byte-identical static markup", () => {
  const phases: readonly (
    | { readonly kind: "loading" }
    | { readonly kind: "error"; readonly message: string }
    | { readonly kind: "invalid"; readonly failures: readonly { readonly path: string; readonly reason: string }[] }
  )[] = [
    { kind: "loading" },
    { kind: "error", message: "The workload registry is unreachable." },
    { kind: "invalid", failures: [{ path: "/profiles", reason: "array_required" }] },
  ];
  for (const phase of phases) {
    const first = renderToStaticMarkup(
      createElement(WorkloadPlanningScreen, {
        phase: phase as WorkloadPlanningScreenProps["phase"],
        surface: { view: "list" },
        onSurfaceEvent: (): void => {},
        tab: "recommendations",
        onTabChange: (): void => {},
        journey: null,
      }),
    );
    const second = renderToStaticMarkup(
      createElement(WorkloadPlanningScreen, {
        phase: phase as WorkloadPlanningScreenProps["phase"],
        surface: { view: "list" },
        onSurfaceEvent: (): void => {},
        tab: "recommendations",
        onTabChange: (): void => {},
        journey: null,
      }),
    );
    expect(first).toBe(second);
  }
});

test("determinism: the journey-rail-present screen renders byte-identical static markup", () => {
  const journey = buildWorkloadProcurementJourneyView(TENANT_A, {
    profile: realProfile(),
    ledger: realLedger(),
    subscription: null,
    demand: null,
    quote: null,
    submission: null,
    verification: null,
  });
  if (!journey.ok) throw new Error(journey.error.message);
  const rail = journeyRailStages(journey.view);
  const element = (): ReturnType<typeof createElement> =>
    createElement(WorkloadPlanningScreen, {
      phase: { kind: "ready", view: planningData() },
      surface: { view: "list" },
      onSurfaceEvent: (): void => {},
      tab: "recommendations",
      onTabChange: (): void => {},
      journey: rail,
    });
  expect(renderToStaticMarkup(element())).toBe(renderToStaticMarkup(element()));
});

test("state machine: the existing reducer still refuses illegal events (backdrop of the rendered screen)", () => {
  const refusal = reduceWorkloadSurfaceState(INITIAL_WORKLOAD_SURFACE_STATE, {
    type: "open_recommendation",
    recommendationId: "rec_x",
  });
  expect(refusal.ok).toBe(false);
  if (refusal.ok) throw new Error("expected refusal");
  expect(refusal.reason).toBe("illegal_event");
});

test("fixture sanity: the linkage rows order by LOCK 12 kind then resourceId", () => {
  const data = planningData();
  const kinds = data.selected?.linkage.rows.map((row) => row.kind) ?? [];
  expect(kinds).toEqual(["hardware", "software", "connectivity", "maintenance"]);
});

// Silence the unused-import lints for fixtures used only in type proofs.
void CORR;
void T0;
void procurementWorkstationCandidate;
void fireEvent;
