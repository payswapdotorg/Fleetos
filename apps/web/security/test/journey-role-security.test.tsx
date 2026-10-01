/**
 * W100B web-security — ROLE JOURNEY evidence: the security.compliance
 * persona and the employee persona walk the SAME records through the
 * FULL RENDERED screens with the REAL domain packages bound at the
 * test's binding site:
 *
 *   Persona 1 (security.compliance, risk lens, full authority):
 *     role banner -> findings (evidence-first) -> record detail ->
 *     approvals queue -> WHY parked / WHAT unlocks it -> the REAL
 *     W041 approveParkedPlan step invoked by the binding site.
 *
 *   Persona 2 (employee, personal lens, read-only authority):
 *     role banner -> the SAME findings (identical rows) -> the
 *     restricted remediation explanation (reason + escalation path)
 *     -> the SAME parked approval with the "session may NOT decide"
 *     escalation copy (the approve/reject buttons stay disabled).
 *
 * The load-bearing proof: BOTH personas see the SAME records and the
 * SAME decision chain; ONLY the emphasis (banner, lead, spotlights)
 * differs — the permissions outcome (buttons disabled, restricted
 * explanations) is authority-derived and identical per authority.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { asCorrelationId, asDeviceId, asObservationId, asUserId } from "@fleetos/contracts";
import {
  checkPermission,
  makeActionDescriptor,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "@fleetos/identity";
import { assessSecurityPosture } from "@fleetos/security";
import {
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
} from "@fleetos/actions";
import { compileGuardianRuleSet, defineGuardianRule, evaluateGuardianRequest } from "@fleetos/policy";
import {
  ApprovalsQueueScreen,
  FindingsScreen,
  buildApprovalsQueueView,
  buildParkedExplanationView,
  buildRoleShapedFindingsView,
  buildSecurityRoleLens,
} from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import { TENANT_A, scopeA } from "./helpers";

afterEach(() => {
  cleanup();
});

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const AT3 = "2026-06-01T00:00:00Z";
const DEVICE = asDeviceId("dev_w100b_journey");

/** The REAL role definitions over this lane's permission vocabulary. */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "security.compliance",
    ["policy.rule.read", "security.approval.decide", "security.finding.read", "security.remediation.propose"],
    "The security & compliance experience role",
  ),
  makeRoleDefinition("employee", ["security.finding.read"], "The employee experience role"),
];

const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100bjour01"));

/** Resolve the REAL authority for a role assignment set. */
function resolveAuthority(roleNames: readonly string[]): RoleLensAuthorityInput {
  return resolvePermissions(
    { kind: "user", tenantId: TENANT_A, principalId: PRINCIPAL.principalId },
    roleNames.map((roleName) =>
      makeRoleAssignment({
        tenantId: TENANT_A,
        principalId: PRINCIPAL.principalId,
        roleName,
        assignedAt: AT,
        assignedBy: "usr_w100badmin",
      }),
    ),
    ROLE_DEFINITIONS,
    AT2,
  );
}

/** The REAL domain records (shared by BOTH personas). */
function domainRecords() {
  // 1. The REAL Security Doctor: a CRITICAL compliance finding.
  const assessed = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    observations: [
      {
        id: asObservationId("obs_w100b_journey_1"),
        kind: "device.security",
        observedAt: AT,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: AT,
  });
  if (!assessed.ok) throw new Error(assessed.error.message);

  // 2. The REAL Guardian: REQUIRE_APPROVAL for fleet.action.execute.
  const rule = defineGuardianRule(TENANT_A, {
    name: "w100b-journey-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: AT,
  });
  if (!rule.ok) throw new Error(rule.error.message);
  const compiled = compileGuardianRuleSet(TENANT_A, { rules: [rule.rule], version: 1, at: AT });
  if (!compiled.ok) throw new Error(compiled.error.message);

  // 3. The REAL W041 pipeline: create -> submit -> PARKED.
  const plan = createActionPlan({
    tenantId: TENANT_A,
    name: "w100b-journey-plan",
    capability: "lock",
    selector: { kind: "byId", deviceIds: [DEVICE] },
    registry: createInMemoryDeviceRegistryView([
      {
        tenantId: TENANT_A,
        deviceId: DEVICE,
        lifecycleState: "OBSERVE",
        adapterCapabilities: { identify: true, observe: true, lock: true },
        platform: "windows",
        ownership: "corporate",
      },
    ]),
    requestedBy: asUserId(PRINCIPAL.principalId),
    at: AT,
  });
  if (!plan.ok) throw new Error(plan.error.message);
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    { at: AT2, correlationId: asCorrelationId("cor_w100b_journey_2") },
  );
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  const submitted = submitActionPlan(plan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    at: AT2,
    correlationId: asCorrelationId("cor_w100b_journey_3"),
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  return { findings: assessed.posture.findings, parkedPlan: submitted.plan, evaluation: evaluation.evaluation };
}

/** The composed props for one persona over the shared records. */
function personaProps(role: "security.compliance" | "employee") {
  const assigned = role === "security.compliance" ? ["security.compliance"] : ["employee"];
  const authority = resolveAuthority(assigned);
  const lens = buildSecurityRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: assigned as never,
    authority,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  const records = domainRecords();
  const shaped = buildRoleShapedFindingsView(scopeA(), lens.view, records.findings);
  if (!shaped.ok) throw new Error(shaped.error.message);
  const queue = buildApprovalsQueueView(scopeA(), [
    { plan: records.parkedPlan, evaluation: records.evaluation },
  ]);
  if (!queue.ok) throw new Error(queue.error.message);
  const explanation = buildParkedExplanationView(scopeA(), lens.view, queue.view.items[0]!);
  if (!explanation.ok) throw new Error(explanation.error.message);
  return {
    lens: lens.view,
    shaped: shaped.view,
    queue: queue.view,
    explanation: explanation.view,
    authority,
  };
}

// ---------------------------------------------------------------------------
// Persona 1 — security.compliance (risk lens, full authority)
// ---------------------------------------------------------------------------

test("the security.compliance persona walks findings -> approvals -> decides (REAL steps)", async () => {
  const user = userEvent.setup();
  const persona = personaProps("security.compliance");

  // The identity engine AGREES this session may decide.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "security.approval.decide" },
    {
      assignments: [
        makeRoleAssignment({
          tenantId: TENANT_A,
          principalId: PRINCIPAL.principalId,
          roleName: "security.compliance",
          assignedAt: AT,
          assignedBy: "usr_w100badmin",
        }),
      ],
      roles: ROLE_DEFINITIONS,
      actions: [makeActionDescriptor({ action: "security.approval.decide", consequential: false })],
      grants: [],
      at: AT2,
    },
  );
  expect(real.decision).toBe("allow");

  // 1. The findings screen in the risk lens: banner + evidence-first lead.
  const records = domainRecords();
  render(
    <FindingsScreen
      phase={{ kind: "ready", view: persona.shaped.findings }}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
      roleLens={persona.lens}
      roleLead={persona.shaped.lead}
      remediationAffordance={persona.shaped.remediationAffordance}
    />,
  );
  expect(screen.getByText(/Risk posture/)).toBeTruthy();
  expect(screen.getByTestId("findings-evidence-first")).toBeTruthy();
  expect(screen.getByTestId("remediation-affordance-available")).toBeTruthy();
  // The CRITICAL finding row is present (the record shared with the employee).
  expect(screen.getByText(/Disk encryption is disabled/)).toBeTruthy();
  cleanup();

  // 2. The approvals queue: WHY parked + WHAT unlocks + the session MAY decide.
  render(
    <ApprovalsQueueScreen
      phase={{ kind: "ready", view: persona.queue }}
      actingApprover={{ userId: PRINCIPAL.principalId }}
      pendingDecision={null}
      onRequestDecision={() => undefined}
      onCancelDecision={() => undefined}
      onConfirmDecision={() => undefined}
      roleLens={persona.lens}
      explanations={{ [persona.explanation.planId]: persona.explanation }}
    />,
  );
  const explanation = screen.getByTestId(`parked-explanation-${persona.explanation.planId}`);
  expect(explanation.textContent).toContain("The Contract Guardian decided REQUIRE_APPROVAL");
  expect(explanation.textContent).toContain("Rules that fired");
  expect(explanation.textContent).toContain("policy.rule.matched");
  expect(within(explanation).getByTestId("session-may-decide").textContent).toContain(
    "authority includes the deciding permission",
  );
  // The buttons are ENABLED (authority-derived).
  const approve = screen.getByRole("button", { name: /Approve the parked plan/ }) as HTMLButtonElement;
  expect(approve.disabled).toBe(false);

  // 3. The REAL W041 approval step (the binding site invokes it).
  const approved = approveParkedPlan(records.parkedPlan, "approve", {
    at: AT3,
    correlationId: asCorrelationId("cor_w100b_journey_4"),
    approverId: PRINCIPAL.principalId,
  });
  if (!approved.ok) throw new Error(approved.error.message);
  expect(approved.status).toBe("APPROVED");
  await user.tab(); // keyboard exercise (the dialog path is covered by the W090B tests)
});

// ---------------------------------------------------------------------------
// Persona 2 — employee (personal lens, read-only authority)
// ---------------------------------------------------------------------------

test("the employee persona sees the SAME records with restricted explanations (never authority)", () => {
  const persona = personaProps("employee");

  // 1. The findings screen in the personal lens: same rows, plain-language lead.
  render(
    <FindingsScreen
      phase={{ kind: "ready", view: persona.shaped.findings }}
      severityFilter="all"
      onSeverityFilterChange={() => undefined}
      openFindingId={null}
      onOpenFinding={() => undefined}
      onCloseFinding={() => undefined}
      onRemediate={() => undefined}
      roleLens={persona.lens}
      roleLead={persona.shaped.lead}
      remediationAffordance={persona.shaped.remediationAffordance}
    />,
  );
  expect(screen.getByText(/Plain-language guidance/)).toBeTruthy();
  // The SAME CRITICAL finding row (identical records).
  expect(screen.getByText(/Disk encryption is disabled/)).toBeTruthy();
  // The restricted remediation explanation (reason + escalation path).
  const restricted = screen.getByTestId("remediation-affordance-restricted");
  expect(restricted.textContent).toContain("missing_permission");
  expect(restricted.textContent).toContain("security.remediation.propose");
  expect(restricted.textContent).toContain("request the security.compliance role assignment");
  expect(restricted.textContent).toContain("grants nothing");
  cleanup();

  // 2. The approvals queue: the SAME parked plan, the SAME decision
  //    chain, but the session may NOT decide (escalation copy).
  render(
    <ApprovalsQueueScreen
      phase={{ kind: "ready", view: persona.queue }}
      actingApprover={null}
      pendingDecision={null}
      onRequestDecision={() => undefined}
      onCancelDecision={() => undefined}
      onConfirmDecision={() => undefined}
      roleLens={persona.lens}
      explanations={{ [persona.explanation.planId]: persona.explanation }}
    />,
  );
  const explanation = screen.getByTestId(`parked-explanation-${persona.explanation.planId}`);
  expect(explanation.textContent).toContain("The Contract Guardian decided REQUIRE_APPROVAL");
  expect(within(explanation).getByTestId("session-may-not-decide").textContent).toContain(
    "security.approval.decide",
  );
  // The buttons are DISABLED for the employee (authority-derived).
  const approve = screen.getByRole("button", { name: /Approve the parked plan/ }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
});

// ---------------------------------------------------------------------------
// The cross-persona continuity: same records, different lens
// ---------------------------------------------------------------------------

test("BOTH personas see the SAME findings rows and the SAME parking decision chain", () => {
  const compliance = personaProps("security.compliance");
  const employee = personaProps("employee");
  // Identical record projections...
  expect(compliance.shaped.findings.items.map((i) => i.findingId)).toEqual(
    employee.shaped.findings.items.map((i) => i.findingId),
  );
  // ...identical decision chains (why parked is domain truth)...
  expect(compliance.explanation.whyParked).toEqual(employee.explanation.whyParked);
  // ...but DIFFERENT emphasis (the lens's actual job)...
  expect(compliance.shaped.lead.copy).not.toBe(employee.shaped.lead.copy);
  expect(compliance.lens.lensLead).not.toBe(employee.lens.lensLead);
  // ...and DIFFERENT authority outcomes (the input authority decided).
  expect(compliance.explanation.whatUnlocksIt.sessionMayDecide).toBe(true);
  expect(employee.explanation.whatUnlocksIt.sessionMayDecide).toBe(false);
});
