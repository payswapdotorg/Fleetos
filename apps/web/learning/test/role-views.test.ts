/**
 * W100B web-learning role-views tests — the load-bearing property at
 * the view-model level, over REAL W070 domain records:
 *
 *   same records + different lens => DIFFERENT emphasis (lead copy,
 *   spotlights) but IDENTICAL permission outcome (authority echo
 *   verbatim; submit affordance availability identical; the cases/
 *   ledger projections and the RATIONALE texts identical — the
 *   rationale explains observable domain truth, not role opinion).
 */

import { test, expect } from "bun:test";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  EVALUATION_DISPOSITION_RATIONALE,
  REDACTION_RATIONALE,
  buildLearningRoleLens,
  buildRoleShapedLearningView,
} from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import {
  TENANT_A,
  realGatedProposal,
  realObservation,
  realProposalsBind,
  seededAdoptionLedger,
  scopeA,
} from "./helpers";

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
    principalId: "usr_w090blrn01",
    permissions: ["learning.case.read"],
    ...overrides,
  };
}

function lensFor(role: (typeof LENSES)[number], authorityInput = authority()) {
  const result = buildLearningRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: [role],
    authority: authorityInput,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

/** REAL W070 proposals: one per disposition. */
function realProposals() {
  return realProposalsBind([
    realGatedProposal(realObservation({ planId: "plan_w100b_distinct_a" }), "ALLOW"),
    realGatedProposal(realObservation({ planId: "plan_w100b_distinct_b" }), "REQUIRE_APPROVAL"),
  ]);
}

/** REAL W070 adoption records (two revisions of one capability). */
function realAdoptions() {
  return seededAdoptionLedger().records;
}

// ---------------------------------------------------------------------------
// The invariance property (the load-bearing one)
// ---------------------------------------------------------------------------

test("same records + different lens => the cases/ledger projections are IDENTICAL", () => {
  const proposals = realProposals();
  const adoptions = realAdoptions();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedLearningView(scopeA(), lensFor(role), proposals, adoptions);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  const casesJson = views.map((view) => JSON.stringify(view.cases));
  const ledgerJson = views.map((view) => JSON.stringify(view.ledger));
  expect(new Set(casesJson).size).toBe(1);
  expect(new Set(ledgerJson).size).toBe(1);
});

test("same records + different lens => the rationales are IDENTICAL (domain truth, not role opinion)", () => {
  const proposals = realProposals();
  const adoptions = realAdoptions();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedLearningView(scopeA(), lensFor(role), proposals, adoptions);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  expect(new Set(views.map((view) => JSON.stringify(view.caseRationales))).size).toBe(1);
  expect(new Set(views.map((view) => JSON.stringify(view.adoptionRationales))).size).toBe(1);
  expect(views[0]?.caseRationales).toHaveLength(2);
  expect(views[0]?.adoptionRationales).toHaveLength(1);
});

test("same records + different lens => authority echo and affordance availability are IDENTICAL", () => {
  const proposals = realProposals();
  const adoptions = realAdoptions();
  const views = LENSES.map((role) => {
    const result = buildRoleShapedLearningView(scopeA(), lensFor(role), proposals, adoptions);
    if (!result.ok) throw new Error(result.error.message);
    return result.view;
  });
  expect(new Set(views.map((view) => JSON.stringify(view.authority))).size).toBe(1);
  expect(new Set(views.map((view) => view.submitAffordance.available)).size).toBe(1);
  for (const view of views) {
    expect(view.submitAffordance.available).toBe(false);
    expect(view.submitAffordance.restricted?.reason).toBe("missing_permission");
    expect(view.submitAffordance.restricted?.escalation.kind).toBe("role_assignment");
  }
});

// ---------------------------------------------------------------------------
// DIFFERENT emphasis (the lens's actual job)
// ---------------------------------------------------------------------------

test("DIFFERENT emphasis: the lead copy and spotlights differ by lens", () => {
  const proposals = realProposals();
  const adoptions = realAdoptions();
  const compliance = buildRoleShapedLearningView(scopeA(), lensFor("security.compliance"), proposals, adoptions);
  const desk = buildRoleShapedLearningView(scopeA(), lensFor("service.desk"), proposals, adoptions);
  const manager = buildRoleShapedLearningView(scopeA(), lensFor("team.manager"), proposals, adoptions);
  const employee = buildRoleShapedLearningView(scopeA(), lensFor("employee"), proposals, adoptions);
  if (!compliance.ok || !desk.ok || !manager.ok || !employee.ok) throw new Error("build failed");

  // The parked case leads for the risk lens; the warning-carrying
  // adoptions lead (none carry warnings in the seed — empty spotlight).
  expect(compliance.view.lead.spotlightProposalIds).toHaveLength(1);
  expect(compliance.view.lead.copy).toContain("parked ones awaiting a human decision");
  expect(compliance.view.lead.spotlightAdoptionIds).toEqual([]);
  // The proposed case leads for the operations lens.
  expect(desk.view.lead.spotlightProposalIds).toHaveLength(1);
  expect(desk.view.lead.copy).toContain("Operational learning");
  // The team lens spotlights the adoptions reaching cohorts.
  expect(manager.view.lead.spotlightAdoptionIds).toHaveLength(1);
  expect(manager.view.lead.spotlightProposalIds).toEqual([]);
  expect(manager.view.lead.copy).toContain("reach your team's cohorts");
  // The employee lens spotlights nothing (read-only plain-language).
  expect(employee.view.lead.spotlightProposalIds).toEqual([]);
  expect(employee.view.lead.spotlightAdoptionIds).toEqual([]);
  expect(employee.view.lead.copy).toContain("Plain-language");
});

test("a submit authority flips the affordance in EVERY lens (the role never mattered)", () => {
  const submitter = authority({ permissions: ["learning.case.read", "learning.case.submit"] });
  for (const role of LENSES) {
    const result = buildRoleShapedLearningView(
      scopeA(),
      lensFor(role, submitter),
      realProposals(),
      realAdoptions(),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.view.submitAffordance.available).toBe(true);
    expect(result.view.submitAffordance.restricted).toBeNull();
    expect(result.view.authority.permissions).toEqual(submitter.permissions);
  }
});

// ---------------------------------------------------------------------------
// The rationale layer (the W100B explanations)
// ---------------------------------------------------------------------------

test("every evaluation case explains its disposition + redaction + ground truth", () => {
  const result = buildRoleShapedLearningView(
    scopeA(),
    lensFor("security.compliance"),
    realProposals(),
    realAdoptions(),
  );
  if (!result.ok) throw new Error(result.error.message);
  const parked = result.view.caseRationales.find((r) => r.disposition === "PARKED");
  expect(parked).toBeDefined();
  if (parked === undefined) return;
  expect(parked.dispositionRationale).toBe(EVALUATION_DISPOSITION_RATIONALE.PARKED);
  expect(parked.dispositionRationale).toContain("REQUIRE_APPROVAL");
  expect(parked.gateDecision).toBe("REQUIRE_APPROVAL");
  expect(parked.redactionRationale).toBe(REDACTION_RATIONALE.deidentified);
  expect(parked.redactionPolicies.length).toBeGreaterThan(0);
  expect(parked.groundTruth).toContain(":");
  const proposed = result.view.caseRationales.find((r) => r.disposition === "PROPOSED");
  expect(proposed?.dispositionRationale).toBe(EVALUATION_DISPOSITION_RATIONALE.PROPOSED);
});

test("every adoption explains its certification basis, human grant and rollback plan", () => {
  const result = buildRoleShapedLearningView(
    scopeA(),
    lensFor("fleet.admin"),
    realProposals(),
    realAdoptions(),
  );
  if (!result.ok) throw new Error(result.error.message);
  const rationale = result.view.adoptionRationales[0];
  expect(rationale).toBeDefined();
  if (rationale === undefined) return;
  expect(rationale.summary).toContain("certified against evaluation suite");
  expect(rationale.summary).toContain("explicit grant");
  expect(rationale.certificationBasis).toContain("Arena owns capability certification");
  expect(rationale.certificationBasis).toContain("FleetOS owns operational adoption");
  expect(rationale.humanGrant).toContain("at ");
  expect(rationale.rollbackPlan).toContain("roll back to v");
  // The adoption has two revisions (supersession visible in the ledger view).
  expect(result.view.ledger.items[0]?.revisionCount).toBe(2);
});

// ---------------------------------------------------------------------------
// Fail-closed + determinism
// ---------------------------------------------------------------------------

test("fail-closed: cross-tenant lens and a bad lens REFUSE; base refusals pass through", () => {
  const foreignLens = buildLearningRoleLens(
    { tenantId: makeTenantId("w100b-other") },
    { activeRole: "employee", authority: authority({ tenantId: makeTenantId("w100b-other") }) },
  );
  if (!foreignLens.ok) throw new Error("foreign lens build failed");
  const cross = buildRoleShapedLearningView(scopeA(), foreignLens.view, [], []);
  expect(cross.ok).toBe(false);
  if (cross.ok) return;
  expect(cross.error.code).toBe("learning_surface.tenant_mismatch");

  const badLens = buildRoleShapedLearningView(scopeA(), { grantsAnything: true } as never, [], []);
  expect(badLens.ok).toBe(false);

  // A malformed proposal refuses through the base builder.
  const badProposal = buildRoleShapedLearningView(
    scopeA(),
    lensFor("employee"),
    [{ proposalId: "" } as never],
    [],
  );
  expect(badProposal.ok).toBe(false);
});

test("determinism + freeze: byte-identical views for the same inputs", () => {
  const proposals = realProposals();
  const adoptions = realAdoptions();
  const a = buildRoleShapedLearningView(scopeA(), lensFor("security.compliance"), proposals, adoptions);
  const b = buildRoleShapedLearningView(scopeA(), lensFor("security.compliance"), proposals, adoptions);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
  expect(Object.isFrozen(a.view.caseRationales)).toBe(true);
});
