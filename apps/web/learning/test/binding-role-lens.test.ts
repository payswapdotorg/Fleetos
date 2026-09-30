/**
 * W100B web-learning — BINDING tests: the role lens consumes the REAL
 * identity domain; the role-shaped learning view consumes the REAL
 * W070 learning records (the binding already proven by the render
 * tests; here the IDENTITY agreement is added):
 *
 *   1. the REAL `@fleetos/identity` `resolvePermissions` produces
 *      `ResolvedPermissions` that STRUCTURALLY satisfies the lens's
 *      `RoleLensAuthorityInput`;
 *   2. the submit-case affordance's availability AGREEs with the REAL
 *      `checkPermission` decision;
 *   3. the rationale layer is derived from the REAL W070 records and
 *      is identical for every lens (domain truth, not role opinion).
 */

import { test, expect } from "bun:test";
import { asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  checkPermission,
  makeActionDescriptor,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "@fleetos/identity";
import type { ResolvedPermissions } from "@fleetos/identity";
import { buildLearningRoleLens, buildRoleShapedLearningView } from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import {
  TENANT_A,
  realGatedProposal,
  realObservation,
  realProposalsBind,
  scopeA,
  seededAdoptionLedger,
} from "./helpers";

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100blrn02"));

/** The REAL role definitions over this lane's permission vocabulary. */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "security.compliance",
    ["learning.adoption.read", "learning.case.read", "learning.case.submit"],
    "The security & compliance experience role",
  ),
  makeRoleDefinition("employee", ["learning.case.read"], "The employee experience role"),
];

/** Resolve the REAL authority for a role assignment set. */
function resolveAuthority(roleNames: readonly string[], tenantId = TENANT_A): ResolvedPermissions {
  return resolvePermissions(
    { kind: "user", tenantId, principalId: PRINCIPAL.principalId },
    roleNames.map((roleName) =>
      makeRoleAssignment({
        tenantId,
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

/** REAL W070 records. */
function realRecords() {
  return {
    proposals: realProposalsBind([
      realGatedProposal(realObservation({ planId: "plan_w100b_lrn_a" }), "ALLOW"),
      realGatedProposal(realObservation({ planId: "plan_w100b_lrn_b" }), "REQUIRE_APPROVAL"),
    ]),
    adoptions: seededAdoptionLedger().records,
  };
}

test("the REAL identity resolution structurally satisfies the lens authority seam", () => {
  const resolved = resolveAuthority(["security.compliance"]);
  const authority: RoleLensAuthorityInput = resolved;
  expect(authority.tenantId).toBe(TENANT_A);
  expect(authority.principalId).toBe(PRINCIPAL.principalId);
  expect(authority.permissions).toContain("learning.case.submit");
});

test("the submit-case affordance AGREEs with the REAL checkPermission for every lens", () => {
  for (const roleNames of [["security.compliance"], ["employee"]] as const) {
    const resolved = resolveAuthority([...roleNames]);
    const real = checkPermission(
      {
        principal: PRINCIPAL,
        scope: { kind: "tenant", tenantId: TENANT_A },
        action: "learning.case.submit",
      },
      {
        assignments: roleNames.map((roleName) =>
          makeRoleAssignment({
            tenantId: TENANT_A,
            principalId: PRINCIPAL.principalId,
            roleName,
            assignedAt: AT,
            assignedBy: "usr_w100badmin",
          }),
        ),
        roles: ROLE_DEFINITIONS,
        actions: [makeActionDescriptor({ action: "learning.case.submit", consequential: false })],
        grants: [],
        at: AT2,
      },
    );
    for (const role of roleNames) {
      const lens = buildLearningRoleLens(scopeA(), {
        activeRole: role,
        authority: resolved,
      });
      if (!lens.ok) throw new Error(lens.error.message);
      const lensAvailable = (lens.view.authority.permissions as readonly string[]).includes(
        "learning.case.submit",
      );
      expect(lensAvailable).toBe(real.decision === "allow");
    }
  }
});

test("the rationale layer over the REAL W070 records is identical for every lens", () => {
  const records = realRecords();
  const rationales = (["security.compliance", "employee"] as const).map((role) => {
    const resolved = resolveAuthority([role]);
    const lens = buildLearningRoleLens(scopeA(), { activeRole: role, authority: resolved });
    if (!lens.ok) throw new Error(lens.error.message);
    const shaped = buildRoleShapedLearningView(scopeA(), lens.view, records.proposals, records.adoptions);
    if (!shaped.ok) throw new Error(shaped.error.message);
    return JSON.stringify({
      caseRationales: shaped.view.caseRationales,
      adoptionRationales: shaped.view.adoptionRationales,
    });
  });
  expect(new Set(rationales).size).toBe(1);
  const parsed = JSON.parse(rationales[0]!) as {
    caseRationales: { dispositionRationale: string }[];
  };
  // The rationales explain the REAL dispositions (ALLOW->PROPOSED,
  // REQUIRE_APPROVAL->PARKED).
  expect(parsed.caseRationales.map((r) => r.dispositionRationale).join(" ")).toContain(
    "allowed the submission",
  );
  expect(parsed.caseRationales.map((r) => r.dispositionRationale).join(" ")).toContain(
    "parked for a human decision",
  );
});

test("a cross-tenant REAL resolution REFUSES in the lens (tenant-scoped authority)", () => {
  const resolved = resolveAuthority(["security.compliance"], makeTenantId("w100b-foreign"));
  const lens = buildLearningRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: resolved,
  });
  expect(lens.ok).toBe(false);
  if (lens.ok) return;
  expect(lens.error.code).toBe("learning_surface.tenant_mismatch");
});
