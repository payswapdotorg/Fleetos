/**
 * W100B web-actions — ROLE JOURNEY evidence: the service.desk persona
 * and the employee persona walk the SAME print distribution through
 * the FULL RENDERED screen with the REAL domain packages bound at the
 * test's binding site (REAL identity resolution + the REAL W100B
 * `planPrintDistribution`):
 *
 *   Persona 1 (service.desk, operations lens, routing authority):
 *     role banner -> the distribution lead (the refused entries lead)
 *     -> per-person entries with refusal reasons + the
 *     printer-approval escalation path.
 *
 *   Persona 2 (employee, personal lens, read-only authority):
 *     role banner -> their OWN entry leads -> the restricted
 *     plan-distribution explanation (reason + escalation path).
 *
 * The load-bearing proof: BOTH personas see the SAME per-person
 * entries (printers, refusals, escalations); ONLY the emphasis
 * (banner, lead, spotlights) differs — the affordance availability is
 * authority-derived and matches the REAL identity decisions.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, within, cleanup } from "@testing-library/react";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import {
  checkPermission,
  makeActionDescriptor,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "@fleetos/identity";
import { planPrintDistribution } from "@fleetos/actions";
import type { PrinterDescriptor } from "@fleetos/actions";
import {
  PrintDistributionScreen,
  buildActionsRoleLens,
  buildRoleShapedPrintDistributionView,
} from "../src/index";
import { TENANT_A, scopeA } from "./helpers";

afterEach(() => {
  cleanup();
});

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100bjrn01"));
const OTHER_PERSON = asUserId("usr_w100bjrn02");

/** The REAL role definitions over this lane's permission vocabulary. */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "service.desk",
    ["action.plan.propose", "action.plan.read", "print.distribution.plan", "print.job.read"],
    "The service desk experience role",
  ),
  makeRoleDefinition("employee", ["print.job.read"], "The employee experience role"),
];

/** Resolve the REAL authority. */
function resolveAuthority(roleNames: readonly string[]) {
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

/**
 * The REAL binding site: the document goes to two selected people.
 * The PRINCIPAL (the employee persona's own entry) has an approved
 * printer; the OTHER person has only an unapproved capable printer.
 */
function realPlan() {
  const planned = planPrintDistribution({
    tenantId: TENANT_A,
    documentRef: "doc://w100b-journey",
    requiredFeatures: { color: true },
    people: [
      { userId: asUserId(PRINCIPAL.principalId), printers: [printer("prn_w100b_jrn_ok", true)] },
      { userId: OTHER_PERSON, printers: [printer("prn_w100b_jrn_unapproved", false)] },
    ],
    at: AT,
    correlationId: asCorrelationId("cor_w100b_jrn_dist"),
  });
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.plan;
}

/** Compose the screen props for one persona. */
function personaProps(role: "service.desk" | "employee") {
  const resolved = resolveAuthority([role]);
  const lens = buildActionsRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: [role],
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  const shaped = buildRoleShapedPrintDistributionView(scopeA(), lens.view, realPlan());
  if (!shaped.ok) throw new Error(shaped.error.message);
  return { lens: lens.view, shaped: shaped.view, resolved };
}

test("the service.desk persona sees the ops queue: the refused entry leads with its escalation", () => {
  const persona = personaProps("service.desk");
  // The identity engine AGREES this session may plan distributions.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "print.distribution.plan" },
    {
      assignments: [
        makeRoleAssignment({
          tenantId: TENANT_A,
          principalId: PRINCIPAL.principalId,
          roleName: "service.desk",
          assignedAt: AT,
          assignedBy: "usr_w100badmin",
        }),
      ],
      roles: ROLE_DEFINITIONS,
      actions: [makeActionDescriptor({ action: "print.distribution.plan", consequential: false })],
      grants: [],
      at: AT2,
    },
  );
  expect(real.decision).toBe("allow");

  render(<PrintDistributionScreen phase={{ kind: "ready", view: persona.shaped }} roleLens={persona.lens} />);
  // The operations lens lead copy + the refused person leads.
  expect(screen.getByText(/Operational distribution/)).toBeTruthy();
  expect(screen.getByTestId("distribution-spotlight").textContent).toContain(OTHER_PERSON);
  // The refused entry carries the machine-stable reasons + the escalation.
  expect(screen.getByText("no_approved_printer")).toBeTruthy();
  const escalation = screen.getByTestId(`print-escalation-${OTHER_PERSON}`);
  expect(escalation.textContent).toContain("request printer approval");
  expect(escalation.textContent).toContain("prn_w100b_jrn_unapproved");
  // The routed entry went to the approved printer.
  expect(screen.getByText("prn_w100b_jrn_ok")).toBeTruthy();
  // The affordance is AVAILABLE (authority-derived).
  expect(screen.getByText(/available to this session \(authority-derived\)/)).toBeTruthy();
});

test("the employee persona sees their OWN copy lead + the restricted explanation", () => {
  const persona = personaProps("employee");
  // The identity engine AGREES this session may NOT plan distributions.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "print.distribution.plan" },
    {
      assignments: [
        makeRoleAssignment({
          tenantId: TENANT_A,
          principalId: PRINCIPAL.principalId,
          roleName: "employee",
          assignedAt: AT,
          assignedBy: "usr_w100badmin",
        }),
      ],
      roles: ROLE_DEFINITIONS,
      actions: [makeActionDescriptor({ action: "print.distribution.plan", consequential: false })],
      grants: [],
      at: AT2,
    },
  );
  expect(real.decision).toBe("deny");
  expect(real.reasons).toEqual(["missing_permission"]);

  render(<PrintDistributionScreen phase={{ kind: "ready", view: persona.shaped }} roleLens={persona.lens} />);
  // The personal lens lead copy + their OWN entry leads.
  expect(screen.getByText(/Your print/)).toBeTruthy();
  expect(screen.getByTestId("distribution-spotlight").textContent).toContain(PRINCIPAL.principalId);
  // The restricted explanation (reason + escalation path).
  const summary = screen.getByText(/restricted — the effective authority lacks/);
  expect(summary.textContent).toContain("print.distribution.plan");
  expect(summary.textContent).toContain("missing_permission");
  expect(summary.textContent).toContain("Fleet Administrator");
  expect(summary.textContent).toContain("grants nothing");
});

test("BOTH personas see the SAME per-person entries (identical printers, refusals, escalations)", () => {
  const desk = personaProps("service.desk").shaped;
  const employee = personaProps("employee").shaped;
  expect(JSON.stringify(desk.entries)).toBe(JSON.stringify(employee.entries));
  expect(desk.lead.routedCount).toBe(employee.lead.routedCount);
  expect(desk.lead.refusedCount).toBe(employee.lead.refusedCount);
  // DIFFERENT emphasis (the lens's actual job).
  expect(desk.lead.spotlightUserIds).toEqual([OTHER_PERSON]);
  expect(employee.lead.spotlightUserIds).toEqual([PRINCIPAL.principalId]);
  expect(desk.lead.copy).not.toBe(employee.lead.copy);
});
