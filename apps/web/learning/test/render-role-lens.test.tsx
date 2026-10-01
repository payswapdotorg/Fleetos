/**
 * W100B web-learning — BROWSER tests proving ROLE-AWARE PRESENTATION
 * NEVER CHANGES AUTHORITY over the LEARNING experience, with the
 * evaluation-case RATIONALE and capability-adoption explanations
 * rendered from REAL W070 domain records:
 *
 *   same records + different lens => DIFFERENT emphasis (the banner,
 *   the lead copy, the spotlights) but IDENTICAL permission outcome
 *   (the authority echo line; the rationale texts — domain truth, not
 *   role opinion; the restricted submit-capability explanation).
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  LearningScreen,
  buildLearningRoleLens,
  buildRoleShapedLearningView,
} from "../src/index";
import type { RoleLensAuthorityInput } from "../src/index";
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

/** The four W100B-owned lenses. */
const LENSES = ["security.compliance", "service.desk", "team.manager", "employee"] as const;

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w090blrn01",
    permissions: ["learning.case.read", "learning.adoption.read"],
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

/** REAL W070 proposals (one PROPOSED, one PARKED — distinct plans => distinct cases). */
function realProposals() {
  return realProposalsBind([
    realGatedProposal(realObservation({ planId: "plan_w100b_distinct_a" }), "ALLOW"),
    realGatedProposal(realObservation({ planId: "plan_w100b_distinct_b" }), "REQUIRE_APPROVAL"),
  ]);
}

/** The composed role-shaped learning props for one lens. */
function shapedProps(role: (typeof LENSES)[number], authorityInput = authority()) {
  const lens = lensFor(role, authorityInput);
  const shaped = buildRoleShapedLearningView(
    scopeA(),
    lens,
    realProposals(),
    seededAdoptionLedger().records,
  );
  if (!shaped.ok) throw new Error(shaped.error.message);
  return {
    casesPhase: { kind: "ready" as const, view: shaped.view.cases },
    ledgerPhase: { kind: "ready" as const, view: shaped.view.ledger },
    feedPhase: { kind: "loading" as const },
    roleLens: lens,
    roleLead: shaped.view.lead,
    caseRationales: shaped.view.caseRationales,
    adoptionRationales: shaped.view.adoptionRationales,
    submitAffordance: shaped.view.submitAffordance,
  };
}

const baseControls = {
  panel: "cases" as const,
  onPanelChange: () => undefined,
  openAdoptionId: null,
  onOpenAdoption: () => undefined,
  onCloseAdoption: () => undefined,
};

// ---------------------------------------------------------------------------
// DIFFERENT emphasis (the lens's actual job)
// ---------------------------------------------------------------------------

test("the rendered role banner names the role and the authority line for every lens", () => {
  for (const role of LENSES) {
    const props = shapedProps(role);
    render(<LearningScreen {...baseControls} {...props} />);
    const banner = screen.getByTestId(`role-lens-${role}`);
    expect(banner.textContent).toContain("Viewing as");
    const echo = screen.getByTestId("role-lens-authority");
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
    render(<LearningScreen {...baseControls} {...shapedProps(role)} />);
    leads.push(
      screen.getByText(/(Risk lens|Operational learning|Team lens|Plain-language)/).textContent ?? "",
    );
    cleanup();
  }
  expect(new Set(leads).size).toBe(4);
});

// ---------------------------------------------------------------------------
// THE INVARIANCE: identical permission outcome + identical rationale
// ---------------------------------------------------------------------------

test("the case RATIONALES render identically for every lens (domain truth, not role opinion)", () => {
  const rationaleSets: string[] = [];
  for (const role of LENSES) {
    render(<LearningScreen {...baseControls} {...shapedProps(role)} />);
    const cards = screen.getAllByTestId(/^case-rationale-/);
    rationaleSets.push(cards.map((card) => card.textContent ?? "").sort().join("#"));
    // Every rationale explains the disposition + the redaction + the ground truth.
    for (const card of cards) {
      expect(card.textContent).toContain("The Contract Guardian");
      expect(card.textContent).toContain("Ground truth:");
    }
    cleanup();
  }
  expect(new Set(rationaleSets).size).toBe(1);
});

test("the case ROWS are identical for every lens (same records, same order)", () => {
  const rowSets: string[] = [];
  for (const role of LENSES) {
    render(<LearningScreen {...baseControls} {...shapedProps(role)} />);
    const rows = screen.getAllByTestId(/^eval-case-/);
    rowSets.push(rows.map((row) => row.textContent ?? "").join("#"));
    cleanup();
  }
  expect(new Set(rowSets).size).toBe(1);
});

test("the adoption ledger carries the adoption RATIONALE (certification basis + human grant)", () => {
  const props = shapedProps("fleet.admin" as never);
  render(
    <LearningScreen
      {...baseControls}
      {...props}
      panel="ledger"
    />,
  );
  const rationale = screen.getByTestId(/^adoption-rationale-/);
  expect(rationale.textContent).toContain("certified against evaluation suite");
  expect(rationale.textContent).toContain("explicit grant");
});

test("the restricted submit-capability explanation renders identically for every lens", () => {
  const restrictedTexts: string[] = [];
  const withoutSubmit = authority({ permissions: ["learning.case.read", "learning.adoption.read"] });
  for (const role of LENSES) {
    render(<LearningScreen {...baseControls} {...shapedProps(role, withoutSubmit)} />);
    // reading is permitted but submitting is not
    const card = screen.getByTestId("submit-affordance-restricted");
    restrictedTexts.push(card.textContent ?? "");
    expect(card.textContent).toContain("learning.case.submit");
    expect(card.textContent).toContain("grants nothing");
    cleanup();
  }
  expect(new Set(restrictedTexts).size).toBe(1);
});

test("a submitting authority flips the explanation in EVERY lens (the role never mattered)", () => {
  const submitter = authority({
    permissions: ["learning.case.read", "learning.adoption.read", "learning.case.submit"],
  });
  for (const role of LENSES) {
    render(<LearningScreen {...baseControls} {...shapedProps(role, submitter)} />);
    expect(screen.getByTestId("submit-affordance-available").textContent).toContain(
      "learning.case.submit",
    );
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Determinism + optionality
// ---------------------------------------------------------------------------

test("the same lens + records render byte-identical static markup (determinism)", () => {
  for (const role of LENSES) {
    const a = renderToStaticMarkup(
      createElement(LearningScreen, { ...baseControls, ...shapedProps(role) }),
    );
    const b = renderToStaticMarkup(
      createElement(LearningScreen, { ...shapedProps(role), ...baseControls }),
    );
    expect(a).toBe(b);
  }
});

test("the lens is OPTIONAL: absent roleLens renders exactly the W090B screen", () => {
  const shaped = buildRoleShapedLearningView(
    scopeA(),
    lensFor("employee"),
    realProposals(),
    seededAdoptionLedger().records,
  );
  if (!shaped.ok) throw new Error(shaped.error.message);
  render(
    <LearningScreen
      {...baseControls}
      casesPhase={{ kind: "ready", view: shaped.view.cases }}
      ledgerPhase={{ kind: "ready", view: shaped.view.ledger }}
      feedPhase={{ kind: "loading" }}
    />,
  );
  expect(screen.queryByTestId(/role-lens-/)).toBeNull();
  expect(screen.getByText(/what FleetOS has learned from fleet outcomes/)).toBeTruthy();
  expect(screen.queryByTestId(/^case-rationale-/)).toBeNull();
});
