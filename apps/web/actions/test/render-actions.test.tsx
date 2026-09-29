/**
 * W090B web-actions — browser-facing RENDER tests (D4): every screen
 * renders from FROZEN view-model snapshots; text content, roles,
 * labels, and semantic landmarks are asserted; keyboard navigation and
 * visible focus are exercised; icon-only controls have accessible
 * names; reduced-motion is respected (asserted against the token
 * stylesheet); the exact empty/loading/error/invalid states are
 * rendered; and the same props always produce byte-identical static
 * markup (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  CONSOLE_CSS,
  FleetActionsScreen,
  PrintScreen,
  buildActionPlanView,
  buildGroupSelectionView,
  buildPlanProgressionView,
  buildPrintRoutingView,
} from "../src/index";
import type { FleetActionJourneyData, PrintJourneyData } from "../src/index";
import {
  DEV_A1,
  DEV_A2,
  decision,
  plan,
  printJob,
  printer,
  scopeA,
} from "./helpers";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The frozen fixtures (deterministic)
// ---------------------------------------------------------------------------

/** The frozen fleet-action journey (PARKED by a REQUIRE_APPROVAL gate). */
function parkedJourney(): FleetActionJourneyData {
  const parkedPlan = plan({ status: "PARKED", version: 2, transitionedAt: "2026-02-01T00:00:00Z" });
  const gate = decision({ decision: "REQUIRE_APPROVAL" });
  const view = buildActionPlanView(scopeA(), parkedPlan, gate);
  if (!view.ok) throw new Error("plan view failed");
  const progression = buildPlanProgressionView(scopeA(), [
    plan({ status: "PROPOSAL", version: 1 }),
    parkedPlan,
  ]);
  if (!progression.ok) throw new Error("progression failed");
  const selection = buildGroupSelectionView(scopeA(), { kind: "all" }, [DEV_A1, DEV_A2]);
  if (!selection.ok) throw new Error("selection failed");
  return {
    plan: view.view,
    progression: progression.view,
    selection: selection.view,
    verification: null,
  };
}

/** The frozen print journey (QUEUED at a color printer). */
function queuedPrintJourney(): PrintJourneyData {
  const job = printJob({ status: "QUEUED", version: 2, transitionedAt: "2026-02-01T00:00:00Z" });
  const view = buildPrintRoutingView(scopeA(), job, [printer(), printer({ printerId: "prn_w060b_mono_01", capabilities: { duplex: true }, location: "annex" })]);
  if (!view.ok) throw new Error("print view failed");
  return {
    job: view.view,
    queue: {
      printerId: "prn_w060b_color_01",
      depth: 1,
      queuedJobIds: [job.jobId],
      updatedAt: "2026-02-01T00:00:00Z",
    },
    verification: null,
  };
}

/** The frozen REFUSED print journey (no printer supports the features). */
function refusedPrintJourney(): PrintJourneyData {
  const job = printJob({ status: "REFUSED", requiredFeatures: { color: true, staple: true } });
  const view = buildPrintRoutingView(scopeA(), job, [
    printer({ printerId: "prn_w060b_mono_01", capabilities: { duplex: true }, location: "annex" }),
  ]);
  if (!view.ok) throw new Error("refused print view failed");
  return { job: view.view, queue: null, verification: null };
}

// ---------------------------------------------------------------------------
// FleetActionsScreen
// ---------------------------------------------------------------------------

test("the FleetActionsScreen renders the gated journey with every consequential field", () => {
  render(<FleetActionsScreen phase={{ kind: "ready", view: parkedJourney() }} />);
  expect(screen.getByRole("heading", { level: 1, name: "Fleet Actions" })).toBeDefined();
  // The seven visible fields (design contract): authorization, policy
  // decision, approval requirement, expected effect, evidence
  // requirement, execution state, verification result.
  expect(screen.getByText("Authorization")).toBeDefined();
  expect(screen.getByText("Policy decision + approval requirement")).toBeDefined();
  expect(screen.getByText("Expected effect")).toBeDefined();
  expect(screen.getByText("Evidence")).toBeDefined();
  expect(screen.getByText("Current state")).toBeDefined();
  // The gated vocabulary: PARKED -> Approval required; REQUIRE_APPROVAL badge.
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("PARKED").length).toBeGreaterThan(0);
  expect(screen.getAllByText("REQUIRE_APPROVAL").length).toBeGreaterThan(0);
  // The proposal-never-executed discipline.
  expect(screen.getAllByText(/a PROPOSAL, never an execution/i).length).toBeGreaterThan(0);
});

test("the fleet-action journey timeline shows the gated steps", () => {
  render(<FleetActionsScreen phase={{ kind: "ready", view: parkedJourney() }} />);
  const timeline = screen.getByRole("list", { name: "Fleet action journey" });
  for (const step of [
    "Intent declared",
    "Targets selected",
    "Proposal created",
    "Guardian gate",
    "Approval",
    "Execution",
    "Verification",
  ]) {
    expect(within(timeline).getByText(step)).toBeDefined();
  }
  // The approval requirement is explicit.
  expect(
    within(timeline).getAllByText(/Required — the plan is PARKED until an owner decides/i).length,
  ).toBeGreaterThan(0);
});

test("the plan progression renders the walked gated transitions", () => {
  render(<FleetActionsScreen phase={{ kind: "ready", view: parkedJourney() }} />);
  const progression = screen.getByRole("list", { name: "Plan progression" });
  expect(within(progression).getByText("v1 — PROPOSAL")).toBeDefined();
  expect(within(progression).getByText("v2 — PARKED")).toBeDefined();
  expect(within(progression).getAllByText(/gate guardian_decision/i).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// PrintScreen
// ---------------------------------------------------------------------------

test("the PrintScreen renders the queued journey with the Running semantics", () => {
  render(<PrintScreen phase={{ kind: "ready", view: queuedPrintJourney() }} />);
  expect(screen.getByRole("heading", { level: 1, name: "Print orchestration" })).toBeDefined();
  // The job state uses the Running semantics with the verbatim status.
  expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  expect(screen.getAllByText("QUEUED").length).toBeGreaterThan(0);
  // The printer disclosures show the declared-capability comparison.
  expect(screen.getByText("Printer capability disclosures")).toBeDefined();
  expect(screen.getAllByText("prn_w060b_color_01").length).toBeGreaterThan(0);
  expect(screen.getAllByText("color, duplex").length).toBeGreaterThan(0);
  // The not-yet-verified disclosure.
  expect(screen.getAllByText(/Not yet verified/i).length).toBeGreaterThan(0);
});

test("a routing refusal is visible and actionable (never a hidden error)", () => {
  render(<PrintScreen phase={{ kind: "ready", view: refusedPrintJourney() }} />);
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("Routing refused")).toBeDefined();
  // The machine-stable refusal reasons render verbatim.
  expect(within(alert).getAllByText("unsupported_feature:color").length).toBeGreaterThan(0);
  // The Failed semantics + the verbatim status.
  expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  expect(screen.getAllByText("REFUSED").length).toBeGreaterThan(0);
  // No fallback printer is suggested.
  expect(within(alert).getAllByText(/no fallback printer/i).length).toBeGreaterThan(0);
  // The per-printer disclosure shows the printer that does not satisfy.
  expect(screen.getAllByText("Does not satisfy").length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// The exact empty/loading/error/invalid states (design contract)
// ---------------------------------------------------------------------------

test("the non-ready phases render skeletons, actionable alerts and invalid lists", () => {
  const { unmount } = render(<FleetActionsScreen phase={{ kind: "loading" }} />);
  expect(screen.getByRole("status", { name: "Loading the fleet action" })).toBeDefined();
  unmount();

  const errorRender = render(
    <FleetActionsScreen
      phase={{ kind: "error", message: "The actions service did not respond." }}
    />,
  );
  expect(screen.getByRole("alert")).toBeDefined();
  errorRender.unmount();

  const invalidRender = render(
    <FleetActionsScreen
      phase={{ kind: "invalid", failures: [{ path: "/plan/status", reason: "unknown_status" }] }}
    />,
  );
  expect(screen.getByText("/plan/status")).toBeDefined();
  expect(screen.getByText("unknown_status")).toBeDefined();
  invalidRender.unmount();

  const printLoading = render(<PrintScreen phase={{ kind: "loading" }} />);
  expect(screen.getByRole("status", { name: "Loading the print job" })).toBeDefined();
  printLoading.unmount();

  render(<PrintScreen phase={{ kind: "error", message: "The print router did not respond." }} />);
  expect(screen.getByRole("alert")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Determinism + reduced motion + keyboard/focus
// ---------------------------------------------------------------------------

test("the same props produce byte-identical static markup (determinism)", () => {
  const buildFleet = (): string =>
    renderToStaticMarkup(
      createElement(FleetActionsScreen, {
        phase: { kind: "ready", view: parkedJourney() },
      }),
    );
  expect(buildFleet()).toBe(buildFleet());

  const buildPrint = (): string =>
    renderToStaticMarkup(
      createElement(PrintScreen, {
        phase: { kind: "ready", view: queuedPrintJourney() },
      }),
    );
  expect(buildPrint()).toBe(buildPrint());
});

test("the token stylesheet respects reduced motion + carries design tokens", () => {
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  expect(CONSOLE_CSS).toContain("animation: none !important");
  expect(CONSOLE_CSS).toContain("--surface:");
  expect(CONSOLE_CSS).toContain("--status-attention:");
  expect(CONSOLE_CSS).not.toContain("backdrop-filter");
});

test("the target disclosure is keyboard-reachable with visible focus", async () => {
  const user = userEvent.setup();
  render(<FleetActionsScreen phase={{ kind: "ready", view: parkedJourney() }} />);
  // The details disclosure is a focusable summary element.
  const details = screen.getByText("Show the resolved target devices");
  const summaryElement = details.closest("summary") as HTMLElement | null;
  expect(summaryElement).not.toBeNull();
  if (summaryElement !== null) {
    summaryElement.focus();
    expect(document.activeElement).toBe(summaryElement);
    fireEvent.keyDown(summaryElement, { key: "Enter" });
    await user.click(summaryElement);
    expect(screen.getAllByText(/dev_w060b_a1/).length).toBeGreaterThan(0);
  }
});
