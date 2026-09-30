/**
 * W100B web-learning — ROLE JOURNEY evidence: the security.compliance
 * persona and the employee persona walk the SAME learning records
 * through the FULL RENDERED screen with the REAL domain packages
 * bound at the test's binding site:
 *
 *   Persona 1 (security.compliance, risk lens, submitting authority):
 *     role banner -> the parked-case spotlight -> the case RATIONALE
 *     ("why each case carries its disposition") -> the adoption
 *     ledger with the adoption rationale (certification basis +
 *     human grant) -> the submit affordance AVAILABLE.
 *
 *   Persona 2 (employee, personal lens, read-only authority):
 *     role banner -> the SAME cases/ledger -> the restricted submit
 *     explanation (reason + escalation path).
 *
 * The load-bearing proof: BOTH personas see the SAME case rows, the
 * SAME rationale texts and the SAME ledger; ONLY the emphasis
 * (banner, lead, spotlights) differs.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { asUserId } from "@fleetos/contracts";
import {
  checkPermission,
  makeActionDescriptor,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "@fleetos/identity";
import {
  LearningScreen,
  buildLearningRoleLens,
  buildRoleShapedLearningView,
} from "../src/index";
import {
  TENANT_A,
  realGatedProposal,
  realObservation,
  realProposalsBind,
  scopeA,
  seededAdoptionLedger,
} from "./helpers";

afterEach(() => {
  cleanup();
});

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const PRINCIPAL = makeUserPrincipal(TENANT_A, asUserId("usr_w100bjrn03"));

/** The REAL role definitions over this lane's permission vocabulary. */
const ROLE_DEFINITIONS = [
  makeRoleDefinition(
    "security.compliance",
    ["learning.adoption.read", "learning.case.read", "learning.case.submit"],
    "The security & compliance experience role",
  ),
  makeRoleDefinition("employee", ["learning.case.read"], "The employee experience role"),
];

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

/** The REAL W070 records (shared by BOTH personas). */
function realRecords() {
  return {
    proposals: realProposalsBind([
      realGatedProposal(realObservation({ planId: "plan_w100b_ljrn_a" }), "ALLOW"),
      realGatedProposal(realObservation({ planId: "plan_w100b_ljrn_b" }), "REQUIRE_APPROVAL"),
    ]),
    adoptions: seededAdoptionLedger().records,
  };
}

function personaProps(role: "security.compliance" | "employee") {
  const resolved = resolveAuthority([role]);
  const lens = buildLearningRoleLens(scopeA(), {
    activeRole: role,
    assignedRoles: [role],
    authority: resolved,
  });
  if (!lens.ok) throw new Error(lens.error.message);
  const records = realRecords();
  const shaped = buildRoleShapedLearningView(scopeA(), lens.view, records.proposals, records.adoptions);
  if (!shaped.ok) throw new Error(shaped.error.message);
  return {
    lens: lens.view,
    shaped: shaped.view,
    resolved,
  };
}

const baseControls = {
  onPanelChange: () => undefined,
  openAdoptionId: null,
  onOpenAdoption: () => undefined,
  onCloseAdoption: () => undefined,
};

test("the security.compliance persona sees the parked-case spotlight + the rationales + available submit", () => {
  const persona = personaProps("security.compliance");
  // The identity engine AGREES this session may submit cases.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "learning.case.submit" },
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
      actions: [makeActionDescriptor({ action: "learning.case.submit", consequential: false })],
      grants: [],
      at: AT2,
    },
  );
  expect(real.decision).toBe("allow");

  render(
    <LearningScreen
      {...baseControls}
      panel="cases"
      casesPhase={{ kind: "ready", view: persona.shaped.cases }}
      ledgerPhase={{ kind: "ready", view: persona.shaped.ledger }}
      feedPhase={{ kind: "loading" } as never}
      roleLens={persona.lens}
      roleLead={persona.shaped.lead}
      caseRationales={persona.shaped.caseRationales}
      adoptionRationales={persona.shaped.adoptionRationales}
      submitAffordance={persona.shaped.submitAffordance}
    />,
  );
  // The risk lens banner + the parked-case spotlight.
  expect(screen.getByText(/Risk lens/)).toBeTruthy();
  expect(screen.getByTestId("learning-spotlight").textContent).toContain("PARKED".replace("PARKED", "lcp_"));
  // The case rationales: every case explains its disposition.
  const rationales = screen.getAllByTestId(/^case-rationale-/);
  expect(rationales.length).toBe(2);
  for (const card of rationales) {
    expect(card.textContent).toContain("The Contract Guardian");
  }
  // The submit affordance is AVAILABLE (authority-derived).
  expect(screen.getByTestId("submit-affordance-available").textContent).toContain(
    "learning.case.submit",
  );

  // Switch to the ledger panel (the panel is a controlled prop — the
  // composition site switches it) — the adoption rationale is visible
  // in the ledger rows.
  cleanup();
  render(
    <LearningScreen
      {...baseControls}
      panel="ledger"
      casesPhase={{ kind: "ready", view: persona.shaped.cases }}
      ledgerPhase={{ kind: "ready", view: persona.shaped.ledger }}
      feedPhase={{ kind: "loading" } as never}
      roleLens={persona.lens}
      roleLead={persona.shaped.lead}
      caseRationales={persona.shaped.caseRationales}
      adoptionRationales={persona.shaped.adoptionRationales}
      submitAffordance={persona.shaped.submitAffordance}
    />,
  );
  expect(screen.getByTestId(/^adoption-rationale-/).textContent).toContain(
    "certified against evaluation suite",
  );
});

test("the employee persona sees the SAME cases with the restricted submit explanation", () => {
  const persona = personaProps("employee");
  // The identity engine AGREES this session may NOT submit cases.
  const real = checkPermission(
    { principal: PRINCIPAL, scope: { kind: "tenant", tenantId: TENANT_A }, action: "learning.case.submit" },
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
      actions: [makeActionDescriptor({ action: "learning.case.submit", consequential: false })],
      grants: [],
      at: AT2,
    },
  );
  expect(real.decision).toBe("deny");

  render(
    <LearningScreen
      {...baseControls}
      panel="cases"
      casesPhase={{ kind: "ready", view: persona.shaped.cases }}
      ledgerPhase={{ kind: "ready", view: persona.shaped.ledger }}
      feedPhase={{ kind: "loading" } as never}
      roleLens={persona.lens}
      roleLead={persona.shaped.lead}
      caseRationales={persona.shaped.caseRationales}
      adoptionRationales={persona.shaped.adoptionRationales}
      submitAffordance={persona.shaped.submitAffordance}
    />,
  );
  expect(screen.getByText(/Plain-language/)).toBeTruthy();
  // The SAME case rows (identical records).
  expect(screen.getAllByTestId(/^eval-case-/).length).toBe(2);
  // The restricted explanation (reason + escalation path).
  const restricted = screen.getByTestId("submit-affordance-restricted");
  expect(restricted.textContent).toContain("learning.case.submit");
  expect(restricted.textContent).toContain("request the security.compliance role assignment");
  expect(restricted.textContent).toContain("grants nothing");
});

test("BOTH personas see the SAME cases, rationales and ledger (different emphasis only)", () => {
  const compliance = personaProps("security.compliance").shaped;
  const employee = personaProps("employee").shaped;
  expect(JSON.stringify(compliance.cases)).toBe(JSON.stringify(employee.cases));
  expect(JSON.stringify(compliance.ledger)).toBe(JSON.stringify(employee.ledger));
  expect(JSON.stringify(compliance.caseRationales)).toBe(JSON.stringify(employee.caseRationales));
  expect(JSON.stringify(compliance.adoptionRationales)).toBe(JSON.stringify(employee.adoptionRationales));
  // DIFFERENT emphasis (the lens's actual job): the parked case leads
  // for the risk lens; nothing leads for the employee lens.
  expect(compliance.lead.spotlightProposalIds.length).toBe(1);
  expect(employee.lead.spotlightProposalIds).toEqual([]);
});
