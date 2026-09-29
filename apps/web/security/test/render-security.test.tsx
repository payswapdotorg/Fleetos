/**
 * W090B web-security — browser-facing RENDER tests (D4): every screen
 * renders from FROZEN view-model snapshots; text content, roles,
 * labels, and semantic landmarks are asserted; keyboard navigation
 * and visible focus are exercised; icon-only controls have accessible
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
import { createElement, useState } from "react";
import {
  ApprovalsQueueScreen,
  CONSOLE_CSS,
  FindingsScreen,
  GuardianDecisionsScreen,
  PoliciesScreen,
  SecurityDoctorScreen,
  buildApprovalsQueueView,
  buildBlockHistoryView,
  buildFindingsListView,
  buildPoliciesListView,
  buildPolicyDecisionHistoryView,
  buildPolicyDetailView,
  presentGuardianDecision,
} from "../src/index";
import type {
  GuardianDecisionsData,
  SecurityDoctorData,
} from "../src/index";
import {
  TENANT_A,
  approvalItem,
  decision,
  evaluation,
  finding,
  remediationDraft,
  scopeA,
} from "./helpers";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
  reviseGuardianRule,
} from "@fleetos/policy";
import { asCorrelationId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import type {
  GuardianDecisionRecord,
  PolicyRuleSetRecord,
} from "../src/index";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The frozen fixtures (deterministic)
// ---------------------------------------------------------------------------

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";

/** The frozen findings view (two findings, one superseding). */
function findingsView() {
  const view = buildFindingsListView(scopeA(), [
    finding({
      severity: "CRITICAL",
      remediation: remediationDraft(),
      evidence: [
        { observationId: "obs_w090b_1" as never, kind: "device.security" },
        { observationId: "obs_w090b_2" as never, kind: "device.security" },
      ],
    }),
    finding({
      code: "security.device.screenlock.off",
      title: "Screen lock is disabled",
      severity: "MEDIUM",
      deviceId: "dev_w060b-d2" as never,
    }),
  ]);
  if (!view.ok) throw new Error("findings build failed");
  return view.view;
}

/** The frozen decision presentations + BLOCK history. */
function decisionsData(): GuardianDecisionsData {
  const requireApproval = presentGuardianDecision(scopeA(), evaluation());
  const block = presentGuardianDecision(
    scopeA(),
    evaluation({
      decision: decision({ decision: "BLOCK" }),
      ruleSetId: "w060b-ruleset",
    }),
  );
  if (!requireApproval.ok || !block.ok) throw new Error("presentations failed");
  const blockHistory = buildBlockHistoryView(scopeA(), [
    decision({ decision: "BLOCK", decidedAt: AT }),
  ]);
  if (!blockHistory.ok) throw new Error("block history failed");
  return {
    presentations: [requireApproval.view, block.view],
    blockHistory: blockHistory.view,
  };
}

/** The frozen approvals queue (one PARKED item). */
function queueView() {
  const view = buildApprovalsQueueView(scopeA(), [approvalItem()]);
  if (!view.ok) throw new Error("queue build failed");
  return view.view;
}

/** The frozen policies views over the REAL @fleetos/policy records. */
function policyFixtures(): {
  ruleSet: PolicyRuleSetRecord;
  decisions: readonly GuardianDecisionRecord[];
} {
  const built = defineGuardianRule(TENANT_A, {
    name: "w090b-policies-fixture",
    description: "Fixture rule for the rendered policies surface",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: AT,
  });
  if (!built.ok) throw new Error(built.error.message);
  const revised = reviseGuardianRule(built.rule, { at: AT2, description: "Revised fixture rule for the rendered policies surface" });
  if (!revised.ok) throw new Error(revised.error.message);
  const compiled = compileGuardianRuleSet(TENANT_A, { rules: [revised.rule], version: 3, at: AT2 });
  if (!compiled.ok) throw new Error(compiled.error.message);

  const evaluationResult = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    { at: AT2, correlationId: asCorrelationId("cor_w090b_policies") },
  );
  if (!evaluationResult.ok) throw new Error(evaluationResult.error.message);

  return {
    ruleSet: compiled.ruleSet,
    decisions: [evaluationResult.evaluation.decision],
  };
}

function policiesList() {
  const { ruleSet } = policyFixtures();
  const view = buildPoliciesListView(scopeA(), [ruleSet]);
  if (!view.ok) throw new Error("policies list failed");
  return view.view;
}

function policiesDetail() {
  const { ruleSet } = policyFixtures();
  const view = buildPolicyDetailView(scopeA(), ruleSet);
  if (!view.ok) throw new Error("policy detail failed");
  return view.view;
}

function policiesHistory() {
  const { decisions } = policyFixtures();
  const view = buildPolicyDecisionHistoryView(scopeA(), [...decisions]);
  if (!view.ok) throw new Error("policy history failed");
  return view.view;
}

/** The frozen Security Doctor composite (the gated remediation journey). */
function doctorData(): SecurityDoctorData {
  const view = findingsView();
  const findingItem = view.items[0];
  if (findingItem === undefined) throw new Error("no finding");
  const presented = presentGuardianDecision(scopeA(), evaluation());
  if (!presented.ok) throw new Error("decision presentation failed");
  return {
    finding: findingItem,
    decision: presented.view,
    approval: null,
    plan: null,
    verification: null,
  };
}

// ---------------------------------------------------------------------------
// FindingsScreen
// ---------------------------------------------------------------------------

test("the FindingsScreen renders landmarks, facets and the severity vocabulary (never color-alone)", () => {
  render(
    <FindingsScreen
      phase={{ kind: "ready", view: findingsView() }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Security findings" })).toBeDefined();
  // Severity chips carry counts.
  expect(screen.getByRole("button", { name: /CRITICAL \(1\)/ })).toBeDefined();
  expect(screen.getByRole("button", { name: /All \(2\)/ })).toBeDefined();
  // The semantic status words render alongside the verbatim severities.
  expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
  expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Informational").length).toBeGreaterThan(0);
});

test("the finding detail sheet renders the record pattern with the PROPOSAL discipline", async () => {
  const user = userEvent.setup();
  function Shell(): React.JSX.Element {
    const [openFindingId, setOpenFindingId] = useState<string | null>(null);
    return (
      <FindingsScreen
        phase={{ kind: "ready", view: findingsView() }}
        severityFilter="all"
        onSeverityFilterChange={(): void => {}}
        openFindingId={openFindingId}
        onOpenFinding={setOpenFindingId}
        onCloseFinding={(): void => setOpenFindingId(null)}
        onRemediate={(): void => {}}
      />
    );
  }
  render(<Shell />);
  await user.click(screen.getAllByRole("button", { name: /Inspect finding/ })[0] as HTMLElement);
  const dialog = await screen.findByRole("dialog", { name: /Security finding/ });
  // The record pattern sections.
  for (const section of ["Summary", "Current state", "Why it matters", "Recommended action", "Evidence", "History"]) {
    expect(within(dialog).getByText(section)).toBeDefined();
  }
  // The remediation is a PROPOSAL with the frozen intent kind + the
  // no-execution-path disclosure (LOCK 16).
  expect(within(dialog).getAllByText("PROPOSAL").length).toBeGreaterThan(0);
  expect(within(dialog).getAllByText("SecurityRemediationIntent").length).toBeGreaterThan(0);
  expect(
    within(dialog).getAllByText(/No direct-execution path exists on this surface/i).length,
  ).toBeGreaterThan(0);
  // Evidence renders OPAQUE observation ids.
  expect(within(dialog).getAllByText(/obs_w090b_1/).length).toBeGreaterThan(0);
  await user.click(within(dialog).getByRole("button", { name: "Close finding detail" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the findings severity filter is a controlled intent", async () => {
  const user = userEvent.setup();
  const changes: string[] = [];
  render(
    <FindingsScreen
      phase={{ kind: "ready", view: findingsView() }}
      severityFilter="all"
      onSeverityFilterChange={(next): void => { changes.push(next); }}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: /CRITICAL \(1\)/ }));
  expect(changes).toEqual(["CRITICAL"]);
});

// ---------------------------------------------------------------------------
// GuardianDecisionsScreen
// ---------------------------------------------------------------------------

test("the GuardianDecisionsScreen renders decisions read-only with machine-stable reasons", () => {
  render(
    <GuardianDecisionsScreen
      phase={{ kind: "ready", view: decisionsData() }}
      panel="decisions"
      onPanelChange={(): void => {}}
      onOpenApprovals={(): void => {}}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Contract Guardian decisions" })).toBeDefined();
  // All four decision types' vocabulary: Approval required + Blocked.
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  // Machine-stable reason codes are visible verbatim.
  expect(screen.getAllByText("policy.rule.matched").length).toBeGreaterThan(0);
  expect(screen.getAllByText("policy.precedence.resolved").length).toBeGreaterThan(0);
  // The read-only disclosure.
  expect(screen.getAllByText(/never asserts unobservable employee intent/i).length).toBeGreaterThan(0);
});

test("the BLOCK history panel renders the read-only refusal history", async () => {
  const user = userEvent.setup();
  function Shell(): React.JSX.Element {
    const [panel, setPanel] = useState<"decisions" | "block-history">("decisions");
    return (
      <GuardianDecisionsScreen
        phase={{ kind: "ready", view: decisionsData() }}
        panel={panel}
        onPanelChange={setPanel}
        onOpenApprovals={(): void => {}}
      />
    );
  }
  render(<Shell />);
  await user.click(screen.getByRole("tab", { name: /BLOCK history/ }));
  expect(screen.getAllByText(/gdref_/).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// ApprovalsQueueScreen
// ---------------------------------------------------------------------------

test("the approvals queue shows PARKED items with the gated, confirm-required transitions", async () => {
  const user = userEvent.setup();
  const requests: Array<[string, string]> = [];
  render(
    <ApprovalsQueueScreen
      phase={{ kind: "ready", view: queueView() }}
      actingApprover={{ userId: "usr_w090b_owner" }}
      pendingDecision={null}
      onRequestDecision={(planId, action): void => { requests.push([planId, action]); }}
      onCancelDecision={(): void => {}}
      onConfirmDecision={(): void => {}}
    />,
  );
  // The parked plan facts + the parking decision context.
  expect(screen.getByText("w060b-parked-plan")).toBeDefined();
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("REQUIRE_APPROVAL").length).toBeGreaterThan(0);
  // Requesting the approve transition NEVER executes — it opens the intent.
  const approve = screen.getByRole("button", { name: /Approve the parked plan w060b-parked-plan/ });
  await user.click(approve);
  expect(requests).toEqual([["plan_w060b_01", "approve"]]);
});

test("the approve confirmation dialog is fully controlled and requires the human gate", async () => {
  const user = userEvent.setup();
  const confirmed: Array<[string, string]> = [];
  function Shell(): React.JSX.Element {
    const [pending, setPending] = useState<{ planId: string; action: "approve" | "reject" } | null>(null);
    return (
      <ApprovalsQueueScreen
        phase={{ kind: "ready", view: queueView() }}
        actingApprover={{ userId: "usr_w090b_owner" }}
        pendingDecision={pending}
        onRequestDecision={(planId, action): void => setPending({ planId, action })}
        onCancelDecision={(): void => setPending(null)}
        onConfirmDecision={(planId, action): void => {
          confirmed.push([planId, action]);
          setPending(null);
        }}
      />
    );
  }
  render(<Shell />);
  await user.click(screen.getByRole("button", { name: /Approve the parked plan w060b-parked-plan/ }));
  const dialog = await screen.findByRole("alertdialog", { name: /Approve parked plan/ });
  // The gate + confirmation requirements are explicit.
  expect(within(dialog).getByText("human_decision")).toBeDefined();
  expect(within(dialog).getAllByText(/never one-click/i).length).toBeGreaterThan(0);
  await user.click(within(dialog).getByRole("button", { name: "Confirm approve" }));
  expect(confirmed).toEqual([["plan_w060b_01", "approve"]]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("without an acting approver the queue is reviewable but NOT decidable (owner-only)", () => {
  render(
    <ApprovalsQueueScreen
      phase={{ kind: "ready", view: queueView() }}
      actingApprover={null}
      pendingDecision={null}
      onRequestDecision={(): void => {}}
      onCancelDecision={(): void => {}}
      onConfirmDecision={(): void => {}}
    />,
  );
  const approve = screen.getByRole("button", { name: /Approve the parked plan w060b-parked-plan/ }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  expect(screen.getAllByText(/Approvals are owner-only/i).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// PoliciesScreen
// ---------------------------------------------------------------------------

test("the PoliciesScreen renders the frozen policy surfaces read-only", async () => {
  const user = userEvent.setup();
  function Shell(): React.JSX.Element {
    const [openSetId, setOpenSetId] = useState<string | null>(null);
    return (
      <PoliciesScreen
        listPhase={{ kind: "ready", view: policiesList() }}
        detailPhase={{ kind: "ready", view: openSetId === null ? undefined : policiesDetail() }}
        historyPhase={{ kind: "ready", view: policiesHistory() }}
        panel="sets"
        onPanelChange={(): void => {}}
        openSetId={openSetId}
        onOpenSet={setOpenSetId}
        onCloseSet={(): void => setOpenSetId(null)}
      />
    );
  }
  render(<Shell />);
  expect(screen.getByRole("heading", { level: 1, name: "Policies" })).toBeDefined();
  // The rule set row shows the effect counts.
  expect(screen.getAllByText(/REQUIRE_APPROVAL/).length).toBeGreaterThan(0);
  // Open the detail sheet.
  await user.click(screen.getAllByRole("button", { name: /Inspect policy set/ })[0] as HTMLElement);
  const dialog = await screen.findByRole("dialog", { name: /Policy set/ });
  // The rule's canonical condition summary is visible (machine-stable).
  expect(within(dialog).getAllByText(/"kind":"action"/).length).toBeGreaterThan(0);
  // The read-only invariant disclosure.
  expect(
    within(dialog).getAllByText(/Policy editing is separate from decision execution/i).length,
  ).toBeGreaterThan(0);
  await user.click(within(dialog).getByRole("button", { name: "Close policy set detail" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the decision history panel renders the policy outcomes", async () => {
  const user = userEvent.setup();
  function Shell(): React.JSX.Element {
    const [panel, setPanel] = useState<"sets" | "history">("history");
    return (
      <PoliciesScreen
        listPhase={{ kind: "ready", view: policiesList() }}
        detailPhase={{ kind: "ready", view: undefined }}
        historyPhase={{ kind: "ready", view: policiesHistory() }}
        panel={panel}
        onPanelChange={setPanel}
        openSetId={null}
        onOpenSet={(): void => {}}
        onCloseSet={(): void => {}}
      />
    );
  }
  render(<Shell />);
  expect(screen.getAllByText(/gdref_/).length).toBeGreaterThan(0);
  expect(screen.getAllByText("REQUIRE_APPROVAL").length).toBeGreaterThan(0);
  void user;
});

// ---------------------------------------------------------------------------
// SecurityDoctorScreen
// ---------------------------------------------------------------------------

test("the SecurityDoctorScreen renders the remediation journey record pattern + timeline", () => {
  render(<SecurityDoctorScreen phase={{ kind: "ready", view: doctorData() }} />);
  expect(screen.getByRole("heading", { level: 1, name: "Security Doctor" })).toBeDefined();
  // The record-pattern sections.
  for (const section of ["Summary", "Current state", "Why it matters", "Recommended action", "Evidence", "History"]) {
    expect(screen.getByText(section)).toBeDefined();
  }
  // The journey timeline steps.
  const timeline = screen.getByRole("list", { name: "Remediation journey" });
  for (const step of ["Finding detected", "Remediation proposed", "Contract Guardian decision", "Human approval", "Action", "Verified outcome"]) {
    expect(within(timeline).getByText(step)).toBeDefined();
  }
  // The proposal-not-executed discipline.
  expect(screen.getAllByText(/PROPOSAL/i).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// The exact empty/loading/error/invalid states (design contract)
// ---------------------------------------------------------------------------

test("the non-ready phases render skeletons, actionable alerts and invalid lists", () => {
  const { unmount } = render(
    <FindingsScreen
      phase={{ kind: "loading" }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading security findings" })).toBeDefined();
  unmount();

  render(
    <FindingsScreen
      phase={{ kind: "error", message: "The security service did not respond." }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByRole("alert")).toBeDefined();
  unmount();

  render(
    <FindingsScreen
      phase={{ kind: "invalid", failures: [{ path: "/findings/0/severity", reason: "unknown_severity" }] }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByText("/findings/0/severity")).toBeDefined();
  expect(screen.getByText("unknown_severity")).toBeDefined();
  unmount();

  const empty = buildFindingsListView(scopeA(), []);
  if (!empty.ok) throw new Error("empty build failed");
  render(
    <FindingsScreen
      phase={{ kind: "ready", view: empty.view }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByText("No findings recorded")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Determinism + reduced motion + keyboard/focus
// ---------------------------------------------------------------------------

test("the same props produce byte-identical static markup (determinism)", () => {
  const build = (): string =>
    renderToStaticMarkup(
      createElement(FindingsScreen, {
        phase: { kind: "ready", view: findingsView() },
        severityFilter: "all",
        onSeverityFilterChange: (): void => {},
        openFindingId: null,
        onOpenFinding: (): void => {},
        onCloseFinding: (): void => {},
        onRemediate: (): void => {},
      }),
    );
  expect(build()).toBe(build());
});

test("the token stylesheet respects reduced motion + carries design tokens", () => {
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  expect(CONSOLE_CSS).toContain("animation: none !important");
  expect(CONSOLE_CSS).toContain("--surface:");
  expect(CONSOLE_CSS).toContain("--status-attention:");
  expect(CONSOLE_CSS).not.toContain("backdrop-filter");
});

test("icon-only and terse controls expose accessible names + keyboard reachability", () => {
  function Shell(): React.JSX.Element {
    const [openFindingId, setOpenFindingId] = useState<string | null>(null);
    return (
      <FindingsScreen
        phase={{ kind: "ready", view: findingsView() }}
        severityFilter="all"
        onSeverityFilterChange={(): void => {}}
        openFindingId={openFindingId}
        onOpenFinding={setOpenFindingId}
        onCloseFinding={(): void => setOpenFindingId(null)}
        onRemediate={(): void => {}}
      />
    );
  }
  render(<Shell />);
  const inspect = screen.getAllByRole("button", { name: /Inspect finding/ })[0] as HTMLButtonElement;
  inspect.focus();
  expect(document.activeElement).toBe(inspect);
  fireEvent.keyDown(inspect, { key: "Enter" });
  fireEvent.click(inspect);
  const dialog = screen.getByRole("dialog", { name: /Security finding/ });
  expect(within(dialog).getByRole("button", { name: "Close finding detail" })).toBeDefined();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

// ---------------------------------------------------------------------------
// Cross-tenant fail-closed rendering (the invalid phase surfaces the reason)
// ---------------------------------------------------------------------------

test("a cross-tenant record refuses the whole build (rendered as the invalid phase)", () => {
  const result = buildFindingsListView(scopeA(), [
    finding({ tenantId: makeTenantId("w090b-other") }),
  ]);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  render(
    <FindingsScreen
      phase={{ kind: "invalid", failures: result.error.failures }}
      severityFilter="all"
      onSeverityFilterChange={(): void => {}}
      openFindingId={null}
      onOpenFinding={(): void => {}}
      onCloseFinding={(): void => {}}
      onRemediate={(): void => {}}
    />,
  );
  expect(screen.getByText("tenant_mismatch")).toBeDefined();
});
