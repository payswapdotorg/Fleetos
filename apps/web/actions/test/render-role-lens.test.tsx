/**
 * W100B web-actions — BROWSER tests proving ROLE-AWARE PRESENTATION
 * NEVER CHANGES AUTHORITY over the PRINT DISTRIBUTION experience:
 *
 *   same plan + different lens => DIFFERENT emphasis (the banner, the
 *   lead copy, the spotlight entries) but IDENTICAL permissions
 *   outcome (the authority echo line; the per-person entries with
 *   their approved printers, refusal reasons and escalation paths).
 *
 * The distribution plan is BOUND at the test's binding site through
 * the REAL W100B domain planner (`planPrintDistribution` from
 * @fleetos/actions) — the browser test proves the product sentence
 * rendered: "selected people + document -> each person's approved
 * printer receives the job."
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import {
  planPrintDistribution,
} from "@fleetos/actions";
import {
  PrintDistributionScreen,
  buildActionsRoleLens,
  buildRoleShapedPrintDistributionView,
} from "../src/index";
import type { RoleLensAuthorityInput, SurfacePrintDistributionPlanRecord } from "../src/index";
import { TENANT_A, scopeA } from "./helpers";
import type { PrinterDescriptor } from "@fleetos/actions";

afterEach(() => {
  cleanup();
});

/** The four W100B-owned lenses. */
const LENSES = ["security.compliance", "service.desk", "team.manager", "employee"] as const;

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100bact01",
    permissions: ["print.job.read"],
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

/** A REAL domain printer descriptor. */
function printer(printerId: string, approved: boolean, color = true): PrinterDescriptor {
  return {
    printerId,
    tenantId: TENANT_A,
    capabilities: { color, duplex: true },
    preferences: {},
    approved,
    location: "hq",
  };
}

/**
 * The REAL binding site: the W100B domain planner distributes one
 * document to two selected people — the first has an approved capable
 * printer, the second has only a capable-but-UNapproved printer (the
 * visible refusal + the printer-approval escalation path).
 */
function realPlan(): SurfacePrintDistributionPlanRecord {
  const planned = planPrintDistribution({
    tenantId: TENANT_A,
    documentRef: "doc://w100b-handbook",
    requiredFeatures: { color: true },
    people: [
      {
        userId: asUserId("usr_w100bact01"),
        printers: [printer("prn_w100b_ok1", true), printer("prn_w100b_unapproved", false)],
      },
      {
        userId: asUserId("usr_w100bact02"),
        printers: [printer("prn_w100b_only_unapproved", false)],
      },
    ],
    at: "2026-01-01T00:00:00Z",
    correlationId: asCorrelationId("cor_w100b_distribution"),
  });
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.plan;
}

/** The composed role-shaped phase for one lens. */
function distributionPhase(role: (typeof LENSES)[number]) {
  const shaped = buildRoleShapedPrintDistributionView(scopeA(), lensFor(role), realPlan());
  if (!shaped.ok) throw new Error(shaped.error.message);
  return { kind: "ready" as const, view: shaped.view };
}

// ---------------------------------------------------------------------------
// The product sentence, rendered
// ---------------------------------------------------------------------------

test("each person's approved printer receives the job; the refusal is visible with its escalation", () => {
  render(
    <PrintDistributionScreen phase={distributionPhase("service.desk")} roleLens={lensFor("service.desk")} />,
  );
  // Person 1: the job went to their approved printer (their userId
  // card + the authority echo both mention the principal).
  expect(screen.getAllByText(/usr_w100bact01/).length).toBeGreaterThan(0);
  expect(screen.getByText("prn_w100b_ok1")).toBeTruthy();
  // Person 2: REFUSED with machine-stable reasons + the printer-approval escalation.
  expect(screen.getByText("no_approved_printer")).toBeTruthy();
  expect(screen.getByText("unsupported_feature:color")).toBeTruthy();
  const escalation = screen.getByTestId("print-escalation-usr_w100bact02");
  expect(escalation.textContent).toContain("request printer approval");
  expect(escalation.textContent).toContain("prn_w100b_only_unapproved");
  expect(escalation.textContent).toContain("never receive the job");
});

// ---------------------------------------------------------------------------
// THE INVARIANCE: identical permission outcome across lenses
// ---------------------------------------------------------------------------

test("the per-person ENTRIES are identical for every lens (same plan, same printers, same refusals)", () => {
  // The stable entry facts (printers, refusal reasons, escalations) —
  // identical for every lens; only the spotlight TITLES differ.
  const facts: string[] = [];
  for (const role of LENSES) {
    render(<PrintDistributionScreen phase={distributionPhase(role)} roleLens={lensFor(role)} />);
    const printerFacts = screen
      .queryAllByText(/prn_w100b/)
      .map((node) => node.textContent ?? "");
    const reasonFacts = screen
      .queryAllByText(/^(no_approved_printer|no_capable_approved_printer|unsupported_feature:.*)$/)
      .map((node) => node.textContent ?? "");
    const escalationFacts = screen
      .queryAllByTestId(/^print-escalation-/)
      .map((node) => node.textContent ?? "");
    facts.push(
      [...printerFacts].sort().join("|") + "#" + [...reasonFacts].sort().join("|") + "#" + [...escalationFacts].sort().join("|"),
    );
    cleanup();
  }
  expect(new Set(facts).size).toBe(1);
});

test("the authority echo line renders identically for every lens", () => {
  const echoes: string[] = [];
  for (const role of LENSES) {
    render(<PrintDistributionScreen phase={distributionPhase(role)} roleLens={lensFor(role)} />);
    const echo = screen.getByTestId("role-lens-authority");
    echoes.push(echo.textContent ?? "");
    expect(echo.textContent).toContain(
      "Effective permissions come from identity and the Contract Guardian",
    );
    cleanup();
  }
  expect(new Set(echoes).size).toBe(1);
});

test("the restricted plan-distribution explanation renders for every lens (reason + escalation)", () => {
  for (const role of LENSES) {
    render(<PrintDistributionScreen phase={distributionPhase(role)} roleLens={lensFor(role)} />);
    const summary = screen.getByText(/restricted — the effective authority lacks/);
    expect(summary.textContent).toContain("missing_permission");
    expect(summary.textContent).toContain("print.distribution.plan");
    expect(summary.textContent).toContain("Fleet Administrator");
    expect(summary.textContent).toContain("grants nothing");
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// DIFFERENT emphasis (the lens's actual job)
// ---------------------------------------------------------------------------

test("the lens lead copy differs: the employee's own entry leads; the service desk's refusals lead", () => {
  const employee = distributionPhase("employee").view;
  expect(employee.lead.spotlightUserIds).toEqual(["usr_w100bact01"]);
  const desk = distributionPhase("service.desk").view;
  expect(desk.lead.spotlightUserIds).toEqual(["usr_w100bact02"]);
  const compliance = distributionPhase("security.compliance").view;
  expect(compliance.lead.copy).toContain("only approved printers receive jobs");
  expect(compliance.lead.evidenceFirst).toBe(true);

  render(<PrintDistributionScreen phase={distributionPhase("employee")} roleLens={lensFor("employee")} />);
  expect(screen.getByText(/Your print/)).toBeTruthy();
  expect(screen.getByTestId("distribution-spotlight").textContent).toContain("usr_w100bact01");
  cleanup();
  render(<PrintDistributionScreen phase={distributionPhase("service.desk")} roleLens={lensFor("service.desk")} />);
  expect(screen.getByText(/Operational distribution/)).toBeTruthy();
  expect(screen.getByTestId("distribution-spotlight").textContent).toContain("usr_w060bact02".replace("w060b", "w100b"));
});

test("a distributing authority flips the explanation in EVERY lens (the role never mattered)", () => {
  const distributor = authority({
    permissions: ["print.job.read", "print.distribution.plan"],
  });
  for (const role of LENSES) {
    const shaped = buildRoleShapedPrintDistributionView(scopeA(), lensFor(role, distributor), realPlan());
    if (!shaped.ok) throw new Error(shaped.error.message);
    expect(shaped.view.distributionAffordance.available).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Determinism + optionality
// ---------------------------------------------------------------------------

test("the same lens + plan render byte-identical static markup (determinism)", () => {
  for (const role of LENSES) {
    const a = renderToStaticMarkup(
      createElement(PrintDistributionScreen, {
        phase: distributionPhase(role),
        roleLens: lensFor(role),
      }),
    );
    const b = renderToStaticMarkup(
      createElement(PrintDistributionScreen, {
        roleLens: lensFor(role),
        phase: distributionPhase(role),
      }),
    );
    expect(a).toBe(b);
  }
});

test("the lens is OPTIONAL: absent roleLens renders the entries unchanged", () => {
  render(<PrintDistributionScreen phase={distributionPhase("employee")} />);
  expect(screen.queryByTestId(/role-lens-/)).toBeNull();
  expect(screen.getByText("prn_w100b_ok1")).toBeTruthy();
  expect(screen.getByText("no_approved_printer")).toBeTruthy();
});
