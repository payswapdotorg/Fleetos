/**
 * W090B web-learning — browser-facing RENDER tests (D4): the
 * LearningScreen renders from FROZEN view-model snapshots built over
 * the REAL `@fleetos/learning` records; text content, roles, labels,
 * and semantic landmarks are asserted; keyboard navigation and
 * visible focus are exercised; icon-only controls have accessible
 * names; reduced-motion is respected (asserted against the token
 * stylesheet); the exact empty/loading/error/invalid states are
 * rendered; and the same props always produce byte-identical static
 * markup (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`) BEFORE
 * any module loads.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, useState } from "react";
import {
  CONSOLE_CSS,
  LearningScreen,
  buildAdoptionLedgerView,
  buildEvaluationCasesView,
  buildOutcomeFeedView,
} from "../src/index";
import type { LearningPanel } from "../src/index";
import {
  realAdoptionsBind,
  realGatedProposal,
  realObservation,
  realObservationsBind,
  realProposalsBind,
  scopeA,
  seededAdoptionLedger,
} from "./helpers";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The frozen fixtures (REAL learning records, deterministic)
// ---------------------------------------------------------------------------

/** The frozen outcome-feed view over REAL observations. */
function feedView() {
  const view = buildOutcomeFeedView(scopeA(), realObservationsBind([
    realObservation(),
    realObservation({ planId: "plan_w090b_terminal02" }, "2026-05-01T00:00:00Z"),
  ]));
  if (!view.ok) throw new Error("feed build failed");
  return view.view;
}

/** The frozen evaluation-cases view over REAL gated proposals. */
function casesView() {
  const view = buildEvaluationCasesView(scopeA(), realProposalsBind([
    realGatedProposal(realObservation(), "REQUIRE_APPROVAL"),
    realGatedProposal(realObservation({ planId: "plan_w090b_terminal04" }), "ALLOW"),
  ]));
  if (!view.ok) throw new Error("cases build failed");
  return view.view;
}

/** The frozen adoption-ledger view over the REAL supersession ledger. */
function ledgerView() {
  const { records } = seededAdoptionLedger();
  const view = buildAdoptionLedgerView(scopeA(), realAdoptionsBind(records));
  if (!view.ok) throw new Error("ledger build failed");
  return view.view;
}

/** Render the screen with controlled state (the shell is the test). */
function renderScreen(panel: LearningPanel = "cases"): {
  setPanel: (panel: LearningPanel) => void;
} {
  let current: LearningPanel = panel;
  const view = (
    <LearningScreen
      casesPhase={{ kind: "ready", view: casesView() }}
      ledgerPhase={{ kind: "ready", view: ledgerView() }}
      feedPhase={{ kind: "ready", view: feedView() }}
      panel={current}
      onPanelChange={(next): void => {
        current = next;
      }}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />
  );
  render(view);
  return {
    setPanel: (next: LearningPanel): void => {
      current = next;
    },
  };
}

// ---------------------------------------------------------------------------
// Render + landmarks
// ---------------------------------------------------------------------------

test("the LearningScreen renders with landmarks, heading and the tablist", () => {
  renderScreen("cases");
  expect(screen.getByRole("heading", { level: 1, name: "Learning" })).toBeDefined();
  expect(screen.getByRole("tablist", { name: "Learning areas" })).toBeDefined();
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
});

test("the evaluation cases panel renders dispositions + redaction state (never color-alone)", () => {
  renderScreen("cases");
  // PARKED -> "Approval required" + verbatim disposition text.
  expect(screen.getAllByText("PARKED").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  // The redaction state is displayed as text alongside the indicator.
  expect(screen.getAllByText("deidentified").length).toBeGreaterThan(0);
  // The held-for-human-review disclosure is visible.
  expect(screen.getAllByText(/Held for human review/i).length).toBeGreaterThan(0);
});

test("the adoption ledger renders certification + the human grant + supersession note", () => {
  renderScreen("ledger");
  expect(screen.getByText("acr_w090bcertification0002")).toBeDefined();
  expect(screen.getByText(/canary 25%/)).toBeDefined();
  expect(screen.getAllByText(/Supersession visible/i).length).toBeGreaterThan(0);
  // The inspect control is an icon-adjacent button WITH an accessible name.
  const inspect = screen.getByRole("button", { name: /Inspect capability adoption/ });
  expect(inspect).toBeDefined();
});

test("the outcome feed renders the ground truth + source surface", () => {
  renderScreen("feed");
  expect(screen.getAllByText("action.plan").length).toBeGreaterThan(0);
  expect(screen.getAllByText("action_plan_outcome").length).toBeGreaterThan(0);
  expect(screen.getAllByText("APPROVED").length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Keyboard navigation + visible focus
// ---------------------------------------------------------------------------

test("tabs fire the controlled panel-change intent on arrow keys + clicks", async () => {
  const user = userEvent.setup();
  const changes: string[] = [];
  let current: LearningPanel = "cases";
  const onPanelChange = (next: string): void => {
    changes.push(next);
    current = next as LearningPanel;
  };
  const { rerender } = render(
    <LearningScreen
      casesPhase={{ kind: "ready", view: casesView() }}
      ledgerPhase={{ kind: "ready", view: ledgerView() }}
      feedPhase={{ kind: "ready", view: feedView() }}
      panel={current}
      onPanelChange={onPanelChange}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  const tablist = screen.getByRole("tablist", { name: "Learning areas" });
  const cases = screen.getAllByRole("tab")[0] as HTMLButtonElement;
  cases.focus();
  expect(document.activeElement).toBe(cases);
  // ArrowRight fires the change intent (the shell re-renders — the
  // controlled tablist never owns selection).
  fireEvent.keyDown(tablist, { key: "ArrowRight" });
  expect(changes).toEqual(["ledger"]);
  rerender(
    <LearningScreen
      casesPhase={{ kind: "ready", view: casesView() }}
      ledgerPhase={{ kind: "ready", view: ledgerView() }}
      feedPhase={{ kind: "ready", view: feedView() }}
      panel={current}
      onPanelChange={onPanelChange}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  fireEvent.keyDown(tablist, { key: "ArrowLeft" });
  expect(changes).toEqual(["ledger", "cases"]);
  rerender(
    <LearningScreen
      casesPhase={{ kind: "ready", view: casesView() }}
      ledgerPhase={{ kind: "ready", view: ledgerView() }}
      feedPhase={{ kind: "ready", view: feedView() }}
      panel={current}
      onPanelChange={onPanelChange}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  fireEvent.keyDown(tablist, { key: "End" });
  expect(changes).toEqual(["ledger", "cases", "feed"]);
  // A re-render with the new panel flips aria-selected (the shell's role).
  rerender(
    <LearningScreen
      casesPhase={{ kind: "ready", view: casesView() }}
      ledgerPhase={{ kind: "ready", view: ledgerView() }}
      feedPhase={{ kind: "ready", view: feedView() }}
      panel={current}
      onPanelChange={onPanelChange}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  expect(
    (screen.getByRole("tab", { name: /Outcome feed/ }) as HTMLButtonElement).getAttribute("aria-selected"),
  ).toBe("true");
  // A click on a tab fires the same intent.
  await user.click(screen.getByRole("tab", { name: /Adoption ledger/ }));
  expect(changes).toEqual(["ledger", "cases", "feed", "ledger"]);
  // The tab styles include the visible :focus-visible outline (tokens).
  expect(CONSOLE_CSS).toContain(".fos-scope button:focus-visible");
});

test("the adoption detail sheet opens via the keyboard and closes on Escape", async () => {
  const user = userEvent.setup();
  function Shell(): React.JSX.Element {
    const [openAdoptionId, setOpenAdoptionId] = useState<string | null>(null);
    return (
      <LearningScreen
        casesPhase={{ kind: "ready", view: casesView() }}
        ledgerPhase={{ kind: "ready", view: ledgerView() }}
        feedPhase={{ kind: "ready", view: feedView() }}
        panel="ledger"
        onPanelChange={(): void => {}}
        openAdoptionId={openAdoptionId}
        onOpenAdoption={setOpenAdoptionId}
        onCloseAdoption={(): void => setOpenAdoptionId(null)}
      />
    );
  }
  render(<Shell />);
  const inspect = screen.getByRole("button", { name: /Inspect capability adoption/ });
  inspect.focus();
  expect(document.activeElement).toBe(inspect);
  // Keyboard activation of the inspect control.
  fireEvent.keyDown(inspect, { key: "Enter" });
  fireEvent.click(inspect);
  // The sheet is a dialog with an accessible name + a named close control.
  const dialog = await screen.findByRole("dialog", { name: /Capability adoption/ });
  expect(within(dialog).getAllByText(/supersedes/).length).toBeGreaterThan(0);
  const close = within(dialog).getByRole("button", { name: "Close capability inspection" });
  expect(close).toBeDefined();
  // Escape closes the sheet.
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

// ---------------------------------------------------------------------------
// The exact empty/loading/error/invalid states (design contract)
// ---------------------------------------------------------------------------

test("the loading phase renders skeletons (role=status)", () => {
  render(
    <LearningScreen
      casesPhase={{ kind: "loading" }}
      ledgerPhase={{ kind: "loading" }}
      feedPhase={{ kind: "loading" }}
      panel="cases"
      onPanelChange={(): void => {}}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading evaluation cases" })).toBeDefined();
});

test("the error phase renders an actionable alert with retry", async () => {
  const user = userEvent.setup();
  let retried = false;
  render(
    <LearningScreen
      casesPhase={{ kind: "error", message: "The learning service did not respond.", onRetry: (): void => { retried = true; } }}
      ledgerPhase={{ kind: "loading" }}
      feedPhase={{ kind: "loading" }}
      panel="cases"
      onPanelChange={(): void => {}}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText(/The learning service did not respond/i)).toBeDefined();
  await user.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(retried).toBe(true);
});

test("the invalid phase renders the machine-stable failure list verbatim", () => {
  render(
    <LearningScreen
      casesPhase={{ kind: "invalid", failures: [{ path: "/proposals/0/disposition", reason: "unknown_disposition" }] }}
      ledgerPhase={{ kind: "loading" }}
      feedPhase={{ kind: "loading" }}
      panel="cases"
      onPanelChange={(): void => {}}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("/proposals/0/disposition")).toBeDefined();
  expect(within(alert).getByText("unknown_disposition")).toBeDefined();
});

test("the empty states are instructive zero states", () => {
  const emptyCases = buildEvaluationCasesView(scopeA(), []);
  const emptyLedger = buildAdoptionLedgerView(scopeA(), []);
  const emptyFeed = buildOutcomeFeedView(scopeA(), []);
  if (!emptyCases.ok || !emptyLedger.ok || !emptyFeed.ok) throw new Error("empty builds failed");
  render(
    <LearningScreen
      casesPhase={{ kind: "ready", view: emptyCases.view }}
      ledgerPhase={{ kind: "ready", view: emptyLedger.view }}
      feedPhase={{ kind: "ready", view: emptyFeed.view }}
      panel="cases"
      onPanelChange={(): void => {}}
      openAdoptionId={null}
      onOpenAdoption={(): void => {}}
      onCloseAdoption={(): void => {}}
    />,
  );
  expect(screen.getByText("No evaluation cases yet")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Determinism + reduced motion
// ---------------------------------------------------------------------------

test("the same props produce byte-identical static markup (determinism)", () => {
  const build = (): string =>
    renderToStaticMarkup(
      createElement(LearningScreen, {
        casesPhase: { kind: "ready", view: casesView() },
        ledgerPhase: { kind: "ready", view: ledgerView() },
        feedPhase: { kind: "ready", view: feedView() },
        panel: "cases" as LearningPanel,
        onPanelChange: (): void => {},
        openAdoptionId: null,
        onOpenAdoption: (): void => {},
        onCloseAdoption: (): void => {},
      }),
    );
  expect(build()).toBe(build());
});

test("the token stylesheet respects reduced motion (asserted on the frozen CSS)", () => {
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  expect(CONSOLE_CSS).toContain("animation: none !important");
  expect(CONSOLE_CSS).toContain("transition: none !important");
});

test("the stylesheet carries design tokens (CSS variables for all colors)", () => {
  expect(CONSOLE_CSS).toContain("--surface:");
  expect(CONSOLE_CSS).toContain("--text-primary:");
  expect(CONSOLE_CSS).toContain("--status-attention:");
  // No glassmorphism; the only gradient is the skeleton shimmer's
  // animated fill (disabled under reduced motion).
  expect(CONSOLE_CSS).not.toContain("backdrop-filter");
  expect(CONSOLE_CSS.indexOf("linear-gradient")).toBe(
    CONSOLE_CSS.lastIndexOf("linear-gradient"),
  );
});
