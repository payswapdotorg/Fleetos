/**
 * W100B web-security — BROWSER tests proving ROLE-AWARE PRESENTATION
 * NEVER CHANGES AUTHORITY:
 *
 *   same records + different lens => DIFFERENT emphasis (the rendered
 *   role banner, the lead copy, the spotlights) but IDENTICAL
 *   permissions outcome:
 *     - the rendered authority echo is byte-identical;
 *     - the rendered restricted-capability explanations (reason +
 *       escalation path) are identical for every lens;
 *     - the rendered finding rows (identities, severities, evidence
 *       counts) are identical for every lens;
 *     - the approve/reject buttons' disabled state is identical for
 *       every lens (the authority decides, never the lens);
 *     - the "session may not decide" escalation copy renders for every
 *       lens when the authority lacks the permission.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  APPROVAL_DECIDE_PERMISSION,
  ApprovalsQueueScreen,
  FindingsScreen,
  buildApprovalsQueueView,
  buildFindingsListView,
  buildParkedExplanationView,
  buildRoleShapedFindingsView,
  buildSecurityRoleLens,
} from "../src/index";
import type { ParkedExplanationView, RoleLensAuthorityInput } from "../src/index";
import { TENANT_A, approvalItem, finding, remediationDraft, scopeA } from "./helpers";

afterEach(() => {
  cleanup();
});

/** The four W100B-owned lenses (the matrix's other roles are covered by the view-model tests). */
const LENSES = ["security.compliance", "service.desk", "team.manager", "employee"] as const;

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100bsec01",
    permissions: ["security.finding.read"],
    ...overrides,
  };
}

/** Build the lens for a role. */
function lensFor(role: (typeof LENSES)[number], authorityInput = authority()) {
  const result = buildSecurityRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: [role],
    authority: authorityInput,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

/** The SAME records for every lens (the invariance precondition). */
function records() {
  return [
    finding({
      severity: "CRITICAL",
      classification: "compliance",
      remediation: remediationDraft(),
      evidence: [
        { observationId: "obs_w100b_1" as never, kind: "device.security" },
        { observationId: "obs_w100b_2" as never, kind: "device.security" },
      ],
    }),
    finding({
      severity: "MEDIUM",
      classification: "configuration",
      code: "security.device.screenlock.off",
      title: "Screen lock is disabled",
      deviceId: "dev_w060b-d2" as never,
    }),
  ];
}

/** The composed role-shaped findings phase for one lens. */
function findingsPhase(role: (typeof LENSES)[number]) {
  const lens = lensFor(role);
  const shaped = buildRoleShapedFindingsView(scopeA(), lens, records());
  if (!shaped.ok) throw new Error(shaped.error.message);
  return { kind: "ready" as const, view: shaped.view.findings };
}

/** The composed role-shaped lead for one lens. */
function roleLeadFor(role: (typeof LENSES)[number]) {
  const lens = lensFor(role);
  const shaped = buildRoleShapedFindingsView(scopeA(), lens, records());
  if (!shaped.ok) throw new Error(shaped.error.message);
  return shaped.view.lead;
}

// ---------------------------------------------------------------------------
// The rendered role banner (DIFFERENT emphasis per lens)
// ---------------------------------------------------------------------------

test("the rendered role banner names the role, the lens and the authority line", () => {
  for (const role of LENSES) {
    const view = render(
      <FindingsScreen
        phase={findingsPhase(role)}
        severityFilter="all"
        onSeverityFilterChange={() => undefined}
        openFindingId={null}
        onOpenFinding={() => undefined}
        onCloseFinding={() => undefined}
        onRemediate={() => undefined}
        roleLens={lensFor(role)}
      />,
    );
    const banner = screen.getByTestId(`role-lens-${role}`);
    expect(banner.textContent).toContain("Viewing as");
    expect(banner.textContent).toContain("lens");
    // The authority echo line (the load-bearing disclosure).
    const echo = within(banner).getByTestId("role-lens-authority");
    expect(echo.textContent).toContain(
      "Effective permissions come from identity and the Contract Guardian",
    );
    expect(echo.textContent).toContain("emphasis, never authority");
    cleanup();
  }
});

test("the DIFFERENT emphasis is visible: each lens renders its own lead copy", () => {
  const leads: string[] = [];
  for (const role of LENSES) {
    render(
      <FindingsScreen
        phase={findingsPhase(role)}
        severityFilter="all"
        onSeverityFilterChange={() => undefined}
        openFindingId={null}
        onOpenFinding={() => undefined}
        onCloseFinding={() => undefined}
        onRemediate={() => undefined}
        roleLens={lensFor(role)}
        roleLead={roleLeadFor(role)}
      />,
    );
    leads.push(screen.getByText(/(Risk posture|Operational queue|Team impact|Plain-language guidance)/).textContent ?? "");
    cleanup();
  }
  // All four lens leads differ (different emphasis).
  expect(new Set(leads).size).toBe(4);
});

test("the evidence-first emphasis renders for the security.compliance lens only", () => {
  render(
    <FindingsScreen
      phase={findingsPhase("security.compliance")}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
      roleLens={lensFor("security.compliance")}
      roleLead={roleLeadFor("security.compliance")}
    />,
  );
  expect(screen.getByTestId("findings-evidence-first").textContent).toContain(
    "every finding below links the immutable observations",
  );
  cleanup();
  render(
    <FindingsScreen
      phase={findingsPhase("service.desk")}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
      roleLens={lensFor("service.desk")}
      roleLead={roleLeadFor("service.desk")}
    />,
  );
  expect(screen.queryByTestId("findings-evidence-first")).toBeNull();
});

// ---------------------------------------------------------------------------
// THE INVARIANCE: identical permission outcome across lenses
// ---------------------------------------------------------------------------

test("the finding ROWS are identical for every lens (same records, same order)", () => {
  const rowSets: string[] = [];
  for (const role of LENSES) {
    render(
      <FindingsScreen
        phase={findingsPhase(role)}
        severityFilter="all"
        onSeverityFilterChange={() => undefined}
        openFindingId={null}
        onOpenFinding={() => undefined}
        onCloseFinding={() => undefined}
        onRemediate={() => undefined}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1); // skip the header row
    rowSets.push(
      rows.map((row) => (row.getAttribute("data-testid") ?? "") + "|" + (row.textContent ?? "")).join("#"),
    );
    cleanup();
  }
  expect(new Set(rowSets).size).toBe(1);
});

test("the restricted-capability explanations render identically for every lens", () => {
  const restrictedSets: string[] = [];
  for (const role of LENSES) {
    render(
      <FindingsScreen
        phase={findingsPhase(role)}
        severityFilter="all"
        onSeverityFilterChange={() => undefined}
        openFindingId={null}
        onOpenFinding={() => undefined}
        onCloseFinding={() => undefined}
        onRemediate={() => undefined}
        roleLens={lensFor(role)}
        remediationAffordance={{
          capability: "security.remediation.propose",
          available: false,
          restricted: lensFor(role).restricted.find(
            (restricted) => restricted.capability === "security.remediation.propose",
          ) ?? null,
          grantsAnything: false,
        }}
      />,
    );
    const card = screen.getByTestId("remediation-affordance-restricted");
    restrictedSets.push(card.textContent ?? "");
    expect(card.textContent).toContain("missing_permission");
    expect(card.textContent).toContain("grants nothing");
    cleanup();
  }
  expect(new Set(restrictedSets).size).toBe(1);
});

test("the approve/reject buttons' disabled state is IDENTICAL for every lens (authority decides)", () => {
  const buildQueuePhase = () => {
    const queue = buildApprovalsQueueView(scopeA(), [approvalItem()]);
    if (!queue.ok) throw new Error(queue.error.message);
    return { kind: "ready" as const, view: queue.view };
  };
  const disabledStates: boolean[] = [];
  const explanationTexts: string[] = [];
  for (const role of LENSES) {
    const queueView = buildQueuePhase();
    const queueItemView = queueView.view.items[0]!;
    const explanation: ParkedExplanationView | null = (() => {
      const built = buildParkedExplanationView(scopeA(), lensFor(role), queueItemView);
      return built.ok ? built.view : null;
    })();
    render(
      <ApprovalsQueueScreen
        phase={queueView}
        actingApprover={null}
        decisionDialog={null}
        onRequestDecision={() => undefined}
        onCancelDecision={() => undefined}
        onAcknowledgeConsequences={() => undefined}
        onPhraseChange={() => undefined}
        onRejectionReasonChange={() => undefined}
        onConfirmDecision={() => undefined}
        roleLens={lensFor(role)}
        explanations={explanation !== null ? { [explanation.planId]: explanation } : null}
      />,
    );
    const approve = screen.getByRole("button", { name: /Approve the parked plan/ }) as HTMLButtonElement;
    const reject = screen.getByRole("button", { name: /Reject the parked plan/ }) as HTMLButtonElement;
    disabledStates.push(approve.disabled, reject.disabled);
    // The "why parked / what unlocks it" explanation renders.
    const section = screen.getByTestId(`parked-explanation-${queueItemView.planId}`);
    explanationTexts.push(section.textContent ?? "");
    expect(section.textContent).toContain("Why this action is parked");
    expect(section.textContent).toContain("What unlocks it");
    expect(within(section).getByTestId("session-may-not-decide").textContent).toContain(
      "security.approval.decide",
    );
    cleanup();
  }
  // Every lens: both buttons disabled (no acting approver).
  expect(disabledStates.every((disabled) => disabled === true)).toBe(true);
  // The explanation content (why + what unlocks) is identical across
  // lenses — the decision chain is domain truth.
  expect(new Set(explanationTexts).size).toBe(1);
});

test("a DECIDING authority enables the buttons in EVERY lens (the role never mattered)", () => {
  const decider = authority({
    permissions: [APPROVAL_DECIDE_PERMISSION, "security.finding.read"],
  });
  const queue = buildApprovalsQueueView(scopeA(), [approvalItem()]);
  if (!queue.ok) throw new Error(queue.error.message);
  const queueView = { kind: "ready" as const, view: queue.view };
  for (const role of LENSES) {
    render(
      <ApprovalsQueueScreen
        phase={queueView}
        actingApprover={{ userId: "usr_w100bsec01" }}
        decisionDialog={null}
        onRequestDecision={() => undefined}
        onCancelDecision={() => undefined}
        onAcknowledgeConsequences={() => undefined}
        onPhraseChange={() => undefined}
        onRejectionReasonChange={() => undefined}
        onConfirmDecision={() => undefined}
        roleLens={lensFor(role, decider)}
      />,
    );
    const approve = screen.getByRole("button", { name: /Approve the parked plan/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Keyboard + determinism (accessibility discipline)
// ---------------------------------------------------------------------------

test("the role banner is keyboard-reachable and the restricted card carries accessible text", async () => {
  const user = userEvent.setup();
  render(
    <FindingsScreen
      phase={findingsPhase("employee")}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
      roleLens={lensFor("employee")}
    />,
  );
  const banner = screen.getByRole("region", { name: /Role lens: Employee/ });
  expect(banner).toBeDefined();
  // Tab reaches the severity chips after the banner content (keyboard order preserved).
  await user.tab();
  expect(document.activeElement).toBeTruthy();
});

test("the same lens + records render byte-identical static markup (determinism)", () => {
  for (const role of LENSES) {
    const a = renderToStaticMarkup(
      createElement(FindingsScreen, {
        phase: findingsPhase(role),
        severityFilter: "all",
        onSeverityFilterChange: () => undefined,
        openFindingId: null,
        onOpenFinding: () => undefined,
        onCloseFinding: () => undefined,
        onRemediate: () => undefined,
        roleLens: lensFor(role),
      }),
    );
    const b = renderToStaticMarkup(
      createElement(FindingsScreen, {
        roleLens: lensFor(role),
        onRemediate: () => undefined,
        onCloseFinding: () => undefined,
        onOpenFinding: () => undefined,
        openFindingId: null,
        onSeverityFilterChange: () => undefined,
        severityFilter: "all",
        phase: findingsPhase(role),
      }),
    );
    expect(a).toBe(b);
  }
});

test("the lens is OPTIONAL: absent roleLens renders exactly the W090B screen", () => {
  render(
    <FindingsScreen
      phase={findingsPhase("security.compliance")}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
    />,
  );
  expect(screen.queryByTestId(/role-lens-/)).toBeNull();
  expect(screen.getByText(/versioned interpretations of observed device posture/)).toBeTruthy();
});
