/**
 * W100B web-actions role-views tests — the load-bearing property at the
 * view-model level:
 *
 *   same records + different lens => DIFFERENT emphasis (lead copy,
 *   spotlights, evidence-first) but IDENTICAL permission outcome
 *   (authority echo verbatim; affordance availability identical; the
 *   underlying plan/distribution projection identical).
 *
 * Also proves the print-distribution product sentence end-to-end at the
 * surface level: every entry's job goes to THAT person's approved
 * printer, refusals carry machine-stable reasons + the
 * printer-approval escalation path.
 */

import { test, expect } from "bun:test";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  buildActionsRoleLens,
  buildRoleShapedActionPlanView,
  buildRoleShapedPrintDistributionView,
} from "../src/index";
import type {
  RoleLensAuthorityInput,
  SurfacePrintDistributionPlanRecord,
} from "../src/index";
import { TENANT_A, USER_1, decision, plan, printJob, printer, scopeA } from "./helpers";

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
    principalId: "usr_w060bact01",
    permissions: ["action.plan.read"],
    ...overrides,
  };
}

function lensFor(role: (typeof LENSES)[number], authorityInput = authority()) {
  const result = buildActionsRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: [role],
    authority: authorityInput,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

/** A deterministic distribution plan record (the W100B domain seam). */
function distributionPlan(): SurfacePrintDistributionPlanRecord {
  const routed = printJob({
    jobId: "prn_w100b_1",
    payload: { documentRef: "doc://w100b-handbook", targetUserId: "usr_w060bact01" },
    status: "ROUTED",
    printerId: "prn_approved_1",
    queuePosition: 1,
  });
  const refused = printJob({
    jobId: "prn_w100b_2",
    payload: { documentRef: "doc://w100b-handbook", targetUserId: "usr_w060bact02" },
    status: "REFUSED",
    printerId: undefined,
    queuePosition: undefined,
    routingReasons: ["no_approved_printer", "unsupported_feature:color"],
  });
  return {
    tenantId: TENANT_A,
    documentRef: "doc://w100b-handbook",
    requiredFeatures: { color: true },
    at: "2026-01-01T00:00:00Z",
    personCount: 2,
    routedCount: 1,
    refusedCount: 1,
    entries: [
      {
        userId: "usr_w060bact01",
        job: routed,
        refused: false,
        approvedPrinterCount: 1,
        unapprovedCapablePrinterCount: 0,
        unapprovedCapablePrinterIds: [],
      },
      {
        userId: "usr_w060bact02",
        job: refused,
        refused: true,
        approvedPrinterCount: 0,
        unapprovedCapablePrinterCount: 1,
        unapprovedCapablePrinterIds: ["prn_unapproved_9"],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The role-shaped print distribution view
// ---------------------------------------------------------------------------

test("same plan + different lens => the entry projection is IDENTICAL", () => {
  const planRecord = distributionPlan();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedPrintDistributionView(scopeA(), lensFor(role), planRecord);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const entries = views.map((view) =>
    JSON.stringify(view.entries.map((entry) => [entry.userId, entry.jobId, entry.printerId, entry.routingReasons])),
  );
  expect(new Set(entries).size).toBe(1);
  expect(views[0]?.entries).toHaveLength(2);
});

test("same plan + different lens => the authority echo and affordance availability are IDENTICAL", () => {
  const planRecord = distributionPlan();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedPrintDistributionView(scopeA(), lensFor(role), planRecord);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  expect(new Set(views.map((view) => JSON.stringify(view.authority))).size).toBe(1);
  expect(new Set(views.map((view) => view.distributionAffordance.available)).size).toBe(1);
  for (const view of views) {
    expect(view.distributionAffordance.available).toBe(false);
    expect(view.distributionAffordance.restricted?.reason).toBe("missing_permission");
    expect(view.distributionAffordance.restricted?.escalation.kind).toBe("role_assignment");
  }
});

test("DIFFERENT emphasis: the lead copy and spotlight user ids differ by lens", () => {
  const planRecord = distributionPlan();
  const compliance = buildRoleShapedPrintDistributionView(
    scopeA(),
    lensFor("security.compliance"),
    planRecord,
  );
  const desk = buildRoleShapedPrintDistributionView(scopeA(), lensFor("service.desk"), planRecord);
  const employee = buildRoleShapedPrintDistributionView(scopeA(), lensFor("employee"), planRecord);
  const manager = buildRoleShapedPrintDistributionView(scopeA(), lensFor("team.manager"), planRecord);
  if (!compliance.ok || !desk.ok || !employee.ok || !manager.ok) throw new Error("build failed");

  // security.compliance: policy copy, evidence-first, no person spotlight.
  expect(compliance.view.lead.copy).toContain("only approved printers receive jobs");
  expect(compliance.view.lead.evidenceFirst).toBe(true);
  expect(compliance.view.lead.spotlightUserIds).toEqual([]);
  // service.desk: the refused person leads (the ops queue).
  expect(desk.view.lead.spotlightUserIds).toEqual(["usr_w060bact02"]);
  expect(desk.view.lead.copy).toContain("Operational distribution");
  // employee: their OWN entry leads.
  expect(employee.view.lead.spotlightUserIds).toEqual(["usr_w060bact01"]);
  expect(employee.view.lead.copy).toContain("Your print");
  // team.manager: the waiting list leads.
  expect(manager.view.lead.spotlightUserIds).toEqual(["usr_w060bact02"]);
  expect(manager.view.lead.copy).toContain("Team distribution");
});

test("the refused entry carries its reasons VERBATIM + the printer-approval escalation", () => {
  const result = buildRoleShapedPrintDistributionView(
    scopeA(),
    lensFor("service.desk"),
    distributionPlan(),
  );
  if (!result.ok) throw new Error(result.error.message);
  const refused = result.view.entries.find((entry) => entry.refused);
  expect(refused).toBeDefined();
  if (refused === undefined) return;
  expect(refused.printerId).toBeNull();
  expect(refused.routingReasons).toEqual(["no_approved_printer", "unsupported_feature:color"]);
  expect(refused.escalation?.printerIds).toEqual(["prn_unapproved_9"]);
  expect(refused.escalation?.requestLabel).toBe("Fleet Administrator");
  expect(refused.escalation?.action).toBe("request printer approval");
  expect(refused.escalation?.grantsNothing).toBe(false);
  // The routed entry went to THAT person's approved printer with no escalation.
  const routed = result.view.entries.find((entry) => !entry.refused);
  expect(routed?.printerId).toBe("prn_approved_1");
  expect(routed?.escalation).toBeNull();
});

test("a FULL authority makes the distribution affordance available in EVERY lens", () => {
  const full = authority({ permissions: ["action.plan.read", "print.distribution.plan"] });
  for (const role of LENSES) {
    const result = buildRoleShapedPrintDistributionView(
      scopeA(),
      lensFor(role, full),
      distributionPlan(),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.distributionAffordance.available).toBe(true);
    expect(result.view.distributionAffordance.restricted).toBeNull();
  }
});

test("fail-closed: cross-tenant lens/plan and malformed plans REFUSE", () => {
  const foreignLens = buildActionsRoleLens(
    { tenantId: makeTenantId("w100b-other") },
    { activeRole: "employee", authority: authority({ tenantId: makeTenantId("w100b-other") }) },
  );
  if (!foreignLens.ok) throw new Error("foreign lens build failed");
  const cross = buildRoleShapedPrintDistributionView(
    scopeA(),
    foreignLens.view,
    distributionPlan(),
  );
  expect(cross.ok).toBe(false);

  const badPlan = buildRoleShapedPrintDistributionView(
    scopeA(),
    lensFor("employee"),
    { ...distributionPlan(), personCount: 5 },
  );
  expect(badPlan.ok).toBe(false);
  if (badPlan.ok) return;
  expect(badPlan.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/plan/personCount:entry_count_mismatch");
});

test("determinism: same inputs produce a byte-identical distribution view", () => {
  const a = buildRoleShapedPrintDistributionView(
    scopeA(),
    lensFor("security.compliance"),
    distributionPlan(),
  );
  const b = buildRoleShapedPrintDistributionView(
    scopeA(),
    lensFor("security.compliance"),
    distributionPlan(),
  );
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
});

// ---------------------------------------------------------------------------
// The role-shaped action plan view
// ---------------------------------------------------------------------------

test("same plan + different lens => the plan presentation is IDENTICAL, affordances authority-derived", () => {
  const planRecord = plan({ status: "PARKED", transitionedAt: "2026-02-01T00:00:00Z" });
  const linked = decision({ decision: "REQUIRE_APPROVAL" });
  const views = LENSES.map((role) => {
    const result = buildRoleShapedActionPlanView(scopeA(), lensFor(role), planRecord, linked);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const presentations = views.map((view) => JSON.stringify(view.plan));
  expect(new Set(presentations).size).toBe(1);
  const echoes = views.map((view) => JSON.stringify(view.authority));
  expect(new Set(echoes).size).toBe(1);
  // Affordance availability identical across lenses (the role never mattered).
  expect(new Set(views.map((view) => view.proposeAffordance.available)).size).toBe(1);
  expect(new Set(views.map((view) => view.approveAffordance.available)).size).toBe(1);
  for (const view of views) {
    expect(view.proposeAffordance.available).toBe(false);
    expect(view.approveAffordance.available).toBe(false);
    expect(view.proposeAffordance.restricted?.reason).toBe("missing_permission");
    expect(view.approveAffordance.restricted?.escalation.kind).toBe("role_assignment");
  }
});

test("DIFFERENT emphasis: the action-plan lead copy differs by lens", () => {
  const planRecord = plan({ status: "PARKED" });
  const compliance = buildRoleShapedActionPlanView(scopeA(), lensFor("security.compliance"), planRecord);
  const manager = buildRoleShapedActionPlanView(scopeA(), lensFor("team.manager"), planRecord);
  const employee = buildRoleShapedActionPlanView(scopeA(), lensFor("employee"), planRecord);
  if (!compliance.ok || !manager.ok || !employee.ok) throw new Error("build failed");
  expect(compliance.view.leadCopy).toContain("the rules that fired and the evidence trail lead");
  expect(manager.view.leadCopy).toContain("who requested this action");
  expect(employee.view.leadCopy).toContain("plain language");
});

test("an approving authority flips BOTH affordances in every lens", () => {
  const approver = authority({
    permissions: ["action.plan.read", "action.plan.propose", "action.plan.approve"],
  });
  for (const role of LENSES) {
    const result = buildRoleShapedActionPlanView(
      scopeA(),
      lensFor(role, approver),
      plan({ status: "PARKED" }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.proposeAffordance.available).toBe(true);
    expect(result.view.approveAffordance.available).toBe(true);
    expect(result.view.authority.permissions).toEqual(approver.permissions);
  }
});

test("fail-closed: the base builder's refusals pass through; a bad lens REFUSES", () => {
  const badLens = buildRoleShapedActionPlanView(scopeA(), { grantsAnything: true } as never, plan());
  expect(badLens.ok).toBe(false);
  // A cross-tenant plan record refuses through the base builder.
  const foreignPlan = plan({ tenantId: makeTenantId("w100b-foreign") as never });
  const result = buildRoleShapedActionPlanView(scopeA(), lensFor("employee"), foreignPlan);
  expect(result.ok).toBe(false);
});

test("determinism + freeze for the action plan view", () => {
  const a = buildRoleShapedActionPlanView(scopeA(), lensFor("team.manager"), plan());
  const b = buildRoleShapedActionPlanView(scopeA(), lensFor("team.manager"), plan());
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
});

test("the printer record helper stays deterministic (surface seam sanity)", () => {
  const record = printer({ printerId: "prn_w100b_x", approved: false });
  expect(record.printerId).toBe("prn_w100b_x");
  expect(record.approved).toBe(false);
  expect(USER_1).toContain("usr_");
});
