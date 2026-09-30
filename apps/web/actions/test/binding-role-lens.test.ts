/**
 * W100B web-actions — BINDING tests: the role lens + the print
 * distribution surface consume the REAL identity domain and the REAL
 * W100B domain planner:
 *
 *   1. the REAL `@fleetos/identity` `resolvePermissions` produces
 *      `ResolvedPermissions` that STRUCTURALLY satisfies the lens's
 *      `RoleLensAuthorityInput`;
 *   2. the distribution affordance's availability AGREEs with the REAL
 *      `checkPermission` decision;
 *   3. the REAL `planPrintDistribution` output feeds the role-shaped
 *      distribution view (the product sentence end-to-end);
 *   4. the per-person routing matches calling the REAL W041
 *      `routePrintJob` directly on each person's approved pool.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
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
import { planPrintDistribution, routePrintJob } from "@fleetos/actions";
import type { PrinterDescriptor } from "@fleetos/actions";
import { buildActionsRoleLens, buildRoleShapedPrintDistributionView } from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
import { TENANT_A, scopeA } from "./helpers";

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100bact02"));

/** The REAL role definitions over this lane's permission vocabulary. */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "fleet.admin",
    ["action.plan.approve", "action.plan.propose", "action.plan.read", "print.distribution.plan", "print.job.read"],
    "The fleet administrator experience role",
  ),
  makeRoleDefinition("service.desk", ["action.plan.propose", "action.plan.read", "print.job.read"], "The service desk experience role"),
  makeRoleDefinition("employee", ["print.job.read"], "The employee experience role"),
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

/** A REAL domain printer. */
function printer(printerId: string, approved: boolean): PrinterDescriptor {
  return {
    printerId,
    tenantId: TENANT_A,
    capabilities: { color: true, duplex: true },
    preferences: {},
    approved,
    location: "hq",
  };
}

test("the REAL identity resolution structurally satisfies the lens authority seam", () => {
  const resolved = resolveAuthority(["fleet.admin"]);
  const authority: RoleLensAuthorityInput = resolved;
  expect(authority.tenantId).toBe(TENANT_A);
  expect(authority.principalId).toBe(PRINCIPAL.principalId);
  expect(authority.permissions).toContain("print.distribution.plan");
});

test("the distribution affordance AGREEs with the REAL checkPermission for every lens", () => {
  const scenarios: readonly (readonly string[])[] = [
    ["fleet.admin"],
    ["service.desk"],
    ["employee"],
  ];
  for (const roleNames of scenarios) {
    const resolved = resolveAuthority(roleNames);
    const real = checkPermission(
      {
        principal: PRINCIPAL,
        scope: { kind: "tenant", tenantId: TENANT_A },
        action: "print.distribution.plan",
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
        actions: [makeActionDescriptor({ action: "print.distribution.plan", consequential: false })],
        grants: [],
        at: AT2,
      },
    );
    for (const role of ["fleet.admin", "service.desk", "employee"] as const) {
      if (!(roleNames as readonly string[]).includes(role)) continue;
      const lens = buildActionsRoleLens(scopeA(), {
        activeRole: role,
        assignedRoles: roleNames as never,
        authority: resolved,
      });
      if (!lens.ok) throw new Error(lens.error.message);
      const lensAvailable = (lens.view.authority.permissions as readonly string[]).includes(
        "print.distribution.plan",
      );
      expect(lensAvailable).toBe(real.decision === "allow");
    }
  }
});

test("the REAL planPrintDistribution output feeds the role-shaped view (the product sentence)", () => {
  const planned = planPrintDistribution({
    tenantId: TENANT_A,
    documentRef: "doc://w100b-binding",
    requiredFeatures: { color: true },
    people: [
      {
        userId: asUserId(PRINCIPAL.principalId),
        printers: [printer("prn_w100b_ok", true), printer("prn_w100b_unapproved", false)],
      },
      { userId: asUserId("usr_w100bact03"), printers: [printer("prn_w100b_only_unapproved", false)] },
    ],
    at: AT,
    correlationId: asCorrelationId("cor_w100b_bind_act"),
  });
  if (!planned.ok) throw new Error(planned.error.message);
  const resolved = resolveAuthority(["service.desk"]);
  const lens = buildActionsRoleLens(scopeA(), {
    activeRole: "service.desk",
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  const shaped = buildRoleShapedPrintDistributionView(scopeA(), lens.view, planned.plan);
  if (!shaped.ok) throw new Error(shaped.error.message);
  // The product sentence: the first person's approved printer received
  // their job; the second person's entry is REFUSED with escalation.
  const routed = shaped.view.entries.find((entry) => entry.userId === PRINCIPAL.principalId);
  expect(routed?.printerId).toBe("prn_w100b_ok");
  const refused = shaped.view.entries.find((entry) => entry.userId === asUserId("usr_w100bact03"));
  expect(refused?.refused).toBe(true);
  expect(refused?.escalation?.printerIds).toEqual(["prn_w100b_only_unapproved"]);
  // The service.desk lens spotlights the refused entry (the ops queue).
  expect(shaped.view.lead.spotlightUserIds).toEqual([asUserId("usr_w100bact03")]);
  // The authority echo is the REAL resolution, verbatim.
  expect(shaped.view.authority.permissions).toEqual(resolved.permissions);
});

test("the per-person routing matches the REAL routePrintJob on the person's approved pool", () => {
  const direct = routePrintJob({
    payload: { documentRef: "doc://w100b-binding", targetUserId: PRINCIPAL.principalId },
    requiredFeatures: { color: true },
    tenantId: TENANT_A,
    printers: [printer("prn_w100b_ok", true)],
    at: AT,
    correlationId: asCorrelationId("cor_w100b_bind_act"),
  });
  const planned = planPrintDistribution({
    tenantId: TENANT_A,
    documentRef: "doc://w100b-binding",
    requiredFeatures: { color: true },
    people: [{ userId: asUserId(PRINCIPAL.principalId), printers: [printer("prn_w100b_ok", true)] }],
    at: AT,
    correlationId: asCorrelationId("cor_w100b_bind_act"),
  });
  expect(direct.ok).toBe(true);
  expect(planned.ok).toBe(true);
  if (!direct.ok || !planned.ok) return;
  expect(planned.plan.entries[0]?.job.jobId).toBe(direct.job.jobId);
  expect(planned.plan.entries[0]?.job.printerId).toBe(direct.job.printerId);
  expect(planned.plan.entries[0]?.job.contentDigest).toBe(direct.job.contentDigest);
});

test("a cross-tenant REAL resolution REFUSES in the lens (tenant-scoped authority)", () => {
  const resolved = resolveAuthority(["fleet.admin"], makeTenantId("w100b-foreign"));
  const lens = buildActionsRoleLens(scopeA(), {
    activeRole: "fleet.admin",
    authority: resolved,
  });
  expect(lens.ok).toBe(false);
  if (lens.ok) return;
  expect(lens.error.code).toBe("surface.tenant_mismatch");
});
