/**
 * W100B web-security findings-role-view + approval-explanation tests —
 * THE load-bearing property proven at the view-model level:
 *
 *   same records + different lens => DIFFERENT emphasis (lead copy,
 *   spotlights, evidence-first flag) but IDENTICAL permission outcome
 *   (authority echo verbatim; remediation/approval affordance
 *   availability identical; the underlying findings projection
 *   identical — the lens never filters or reorders records).
 */

import { test, expect } from "bun:test";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  APPROVAL_DECIDE_PERMISSION,
  APPROVAL_ESCALATION_COPY,
  buildApprovalsQueueView,
  buildParkedExplanationView,
  buildRoleShapedFindingsView,
  buildSecurityRoleLens,
} from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import { TENANT_A, approvalItem, finding, remediationDraft, scopeA } from "./helpers";

/** The four W100B-owned lenses + the contrast roles. */
const LENSES = [
  "security.compliance",
  "service.desk",
  "team.manager",
  "employee",
  "fleet.admin",
  "asset.manager",
  "vendor.operator",
] as const;

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100bsec01",
    permissions: ["security.finding.read"],
    ...overrides,
  };
}

/** Build the lens for a role over an authority snapshot. */
function lensFor(role: (typeof LENSES)[number], authorityInput = authority()) {
  const result = buildSecurityRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: LENSES.slice(0, 4).includes(role) ? [role] : [role],
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
      code: "security.device.disk_encryption.off",
      remediation: remediationDraft(),
      evidence: [
        { observationId: "obs_w100b_1" as never, kind: "device.security" },
        { observationId: "obs_w100b_2" as never, kind: "device.security" },
      ],
    }),
    finding({
      severity: "HIGH",
      classification: "threat",
      code: "security.device.screenlock.off",
      title: "Screen lock is disabled",
      deviceId: "dev_w060b-d2" as never,
    }),
    finding({
      severity: "MEDIUM",
      classification: "configuration",
      code: "security.device.firewall.off",
      title: "Local firewall is disabled",
      deviceId: "dev_w060b-d3" as never,
    }),
  ];
}

// ---------------------------------------------------------------------------
// The role-shaped findings view
// ---------------------------------------------------------------------------

test("same records + different lens => the underlying findings projection is IDENTICAL", () => {
  const findings = records();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedFindingsView(scopeA(), lensFor(role), findings);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const projections = views.map((view) => JSON.stringify(view.findings));
  expect(new Set(projections).size).toBe(1);
  // The record identities are identical for every lens.
  for (const view of views) {
    expect(view.findings.items.map((i) => i.findingId).sort()).toEqual(
      findings.map((f) => f.findingId).sort(),
    );
    expect(view.findings.total).toBe(3);
  }
});

test("same records + different lens => the authority echo and affordance availability are IDENTICAL", () => {
  const findings = records();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedFindingsView(scopeA(), lensFor(role), findings);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const echoes = views.map((view) => JSON.stringify(view.authority));
  expect(new Set(echoes).size).toBe(1);
  const availability = views.map((view) => view.remediationAffordance.available);
  expect(new Set(availability).size).toBe(1);
  for (const view of views) {
    expect(view.remediationAffordance.available).toBe(false); // the authority lacks the permission
    expect(view.remediationAffordance.grantsAnything).toBe(false);
    expect(view.remediationAffordance.restricted?.reason).toBe("missing_permission");
    expect(view.remediationAffordance.restricted?.escalation.kind).toBe("role_assignment");
  }
});

test("DIFFERENT emphasis: the lead copy, spotlights and evidence-first flag differ by lens", () => {
  const findings = records();
  const compliance = buildRoleShapedFindingsView(
    scopeA(),
    lensFor("security.compliance"),
    findings,
  );
  const desk = buildRoleShapedFindingsView(scopeA(), lensFor("service.desk"), findings);
  const manager = buildRoleShapedFindingsView(scopeA(), lensFor("team.manager"), findings);
  const employee = buildRoleShapedFindingsView(scopeA(), lensFor("employee"), findings);
  if (!compliance.ok || !desk.ok || !manager.ok || !employee.ok) throw new Error("build failed");

  // The security.compliance lens leads with critical/high compliance+threat,
  // evidence-first.
  expect(compliance.view.lead.evidenceFirst).toBe(true);
  expect(compliance.view.lead.spotlightFindingIds).toHaveLength(2);
  expect(compliance.view.lead.copy).toContain("Every finding links the immutable observations");
  // The service.desk lens leads with actionable remediations.
  expect(desk.view.lead.evidenceFirst).toBe(false);
  expect(desk.view.lead.spotlightFindingIds).toHaveLength(1); // only the CRITICAL has a proposal
  expect(desk.view.lead.copy).toContain("Operational queue");
  // The team.manager lens leads with critical impact (summary-first).
  expect(manager.view.lead.spotlightFindingIds).toHaveLength(1);
  expect(manager.view.lead.copy).toContain("Team impact");
  // The employee lens is plain-language + actionable.
  expect(employee.view.lead.copy).toContain("Plain-language guidance");
  expect(employee.view.lead.spotlightFindingIds).toHaveLength(1);
});

test("the derived lead counts are identical data for every lens (emphasis, not re-derivation)", () => {
  const findings = records();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedFindingsView(scopeA(), lensFor(role), findings);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const counts = views.map(
    (view) =>
      `${view.lead.criticalCount}/${view.lead.highCount}/${view.lead.deviceCount}/${view.lead.remediationProposalCount}`,
  );
  expect(new Set(counts).size).toBe(1);
  expect(views[0]?.lead.criticalCount).toBe(1);
  expect(views[0]?.lead.highCount).toBe(1);
  expect(views[0]?.lead.deviceCount).toBe(3);
  expect(views[0]?.lead.remediationProposalCount).toBe(1);
});

test("a FULL authority makes the remediation affordance available in EVERY lens", () => {
  const full = authority({ permissions: ["security.finding.read", "security.remediation.propose"] });
  for (const role of LENSES) {
    const result = buildRoleShapedFindingsView(scopeA(), lensFor(role, full), records());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.remediationAffordance.available).toBe(true);
    expect(result.view.remediationAffordance.restricted).toBeNull();
  }
});

test("fail-closed: cross-tenant lens / invalid lens / base-view refusals pass through", () => {
  const foreignLens = buildSecurityRoleLens(
    { tenantId: makeTenantId("w100b-other") },
    { activeRole: "employee", authority: authority({ tenantId: makeTenantId("w100b-other") }) },
  );
  if (!foreignLens.ok) throw new Error("foreign lens build failed");
  const cross = buildRoleShapedFindingsView(scopeA(), foreignLens.view, records());
  expect(cross.ok).toBe(false);
  if (cross.ok) return;
  expect(cross.error.code).toBe("surface.tenant_mismatch");

  const badLens = buildRoleShapedFindingsView(scopeA(), { grantsAnything: true } as never, records());
  expect(badLens.ok).toBe(false);

  const badScope = buildRoleShapedFindingsView({ tenantId: "" as never }, lensFor("employee"), records());
  expect(badScope.ok).toBe(false);
});

test("determinism: same inputs produce a byte-identical role-shaped view", () => {
  const a = buildRoleShapedFindingsView(scopeA(), lensFor("security.compliance"), records());
  const b = buildRoleShapedFindingsView(scopeA(), lensFor("security.compliance"), records());
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
});

// ---------------------------------------------------------------------------
// The parked-approval explanation
// ---------------------------------------------------------------------------

/** The queue item view (with the parkedByDecision presentation) the explanation reads. */
function queueItem() {
  const queue = buildApprovalsQueueView(scopeA(), [approvalItem()]);
  if (!queue.ok) throw new Error(queue.error.message);
  return queue.view.items[0]!;
}

test("the explanation answers WHY (the decision chain) and WHAT unlocks it", () => {
  const item = queueItem();
  const result = buildParkedExplanationView(scopeA(), lensFor("security.compliance"), item);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const { view } = result;
  expect(view.planId).toBe(item.planId);
  // WHY: decision + rules + reasons + policy version + evidence links.
  expect(view.whyParked.decision).toBe("REQUIRE_APPROVAL");
  expect(view.whyParked.summary).toContain("REQUIRE_APPROVAL");
  expect(view.whyParked.summary).toContain("human decision");
  expect(view.whyParked.rules).toHaveLength(1);
  expect(view.whyParked.rules[0]?.effect).toBe("REQUIRE_APPROVAL");
  expect(view.whyParked.reasonCodes).toContain("policy.rule.matched");
  expect(view.whyParked.policyVersion).toContain("w060b-ruleset");
  expect(view.whyParked.evidenceLinks).toHaveLength(1);
  // WHAT: the human gate + the permission + this session's state.
  expect(view.whatUnlocksIt.gate).toBe("human_decision");
  expect(view.whatUnlocksIt.decidePermission).toBe(APPROVAL_DECIDE_PERMISSION);
  expect(view.whatUnlocksIt.transitions.map((t) => t.action).sort()).toEqual(["approve", "reject"]);
  expect(view.whatUnlocksIt.sessionMayDecide).toBe(false);
  expect(view.whatUnlocksIt.restricted?.reason).toBe("missing_permission");
  expect(view.whatUnlocksIt.escalationCopy).toBe(APPROVAL_ESCALATION_COPY);
  expect(view.grantsAnything).toBe(false);
});

test("sessionMayDecide is AUTHORITY-derived: identical for every lens, flips with the authority", () => {
  const item = queueItem();
  // Lacking authority: every lens cannot decide.
  for (const role of LENSES) {
    const result = buildParkedExplanationView(scopeA(), lensFor(role), item);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.whatUnlocksIt.sessionMayDecide).toBe(false);
  }
  // Holding the permission: every lens can decide (the role never mattered).
  const decider = authority({
    permissions: [APPROVAL_DECIDE_PERMISSION, "security.finding.read"],
  });
  for (const role of LENSES) {
    const result = buildParkedExplanationView(scopeA(), lensFor(role, decider), item);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.whatUnlocksIt.sessionMayDecide).toBe(true);
    expect(result.view.whatUnlocksIt.restricted).toBeNull();
    // The authority echo is still verbatim for every lens.
    expect(result.view.authority.permissions).toEqual(decider.permissions);
  }
});

test("fail-closed: a non-REQUIRE_APPROVAL decision context REFUSES", () => {
  const item = queueItem();
  const blocked = {
    ...item,
    parkedByDecision: { ...item.parkedByDecision, decision: "BLOCK" as never },
  };
  const result = buildParkedExplanationView(scopeA(), lensFor("employee"), blocked);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/item/parkedByDecision/decision:item_not_require_approval");
});

test("determinism + freeze: the explanation is byte-identical and deeply frozen", () => {
  const item = queueItem();
  const a = buildParkedExplanationView(scopeA(), lensFor("service.desk"), item);
  const b = buildParkedExplanationView(scopeA(), lensFor("service.desk"), item);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
  expect(Object.isFrozen(a.view.whyParked)).toBe(true);
});
