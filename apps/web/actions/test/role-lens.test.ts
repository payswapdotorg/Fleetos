/**
 * W100B web-actions role-lens tests — the PUBLIC EXPERIENCE CONTRACT
 * consumed: matrix/UX-architecture conformance + the load-bearing
 * matrix rules (the lens grants NOTHING) + fail-closed discipline.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  ACTIONS_LANE_CAPABILITIES,
  ALL_EXPERIENCE_ROLES,
  EVIDENCE_EMPHASIS,
  EXPERIENCE_ROLE_HOME_LENS,
  EXPERIENCE_ROLE_LABELS,
  EXPERIENCE_ROLE_PRIMARY_QUESTIONS,
  FLEET_ACTIONS_EMPHASIS,
  PRINT_EMPHASIS,
  ROLE_ASSIGNMENT_ESCALATION_LABEL,
  buildActionsRoleLens,
} from "../src/role-lens";
import type { ActionsRoleLensView, RoleLensAuthorityInput } from "../src/role-lens";
import { TENANT_A, scopeA } from "./helpers";

// ---------------------------------------------------------------------------
// Spec fixtures (TEST-SCOPE reads of the frozen TL-owned contracts)
// ---------------------------------------------------------------------------

/** The repo root (this file lives in apps/web/actions/test). */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

const MATRIX_YAML = readFileSync(
  join(REPO_ROOT, "spec", "ui", "ROLE-EXPERIENCE-MATRIX.yaml"),
  "utf8",
);
const UX_ARCH_MD = readFileSync(
  join(REPO_ROOT, "spec", "ui", "ROLEFUL-UX-ARCHITECTURE.md"),
  "utf8",
);

/** Parse the matrix YAML's roles block (label + home_lens per role). */
function parseMatrixRoles(): Map<string, { label: string; homeLens: string }> {
  const roles = new Map<string, { label: string; homeLens: string }>();
  const lines = MATRIX_YAML.split("\n");
  let currentRole: string | null = null;
  for (const line of lines) {
    const roleMatch = line.match(/^\s{2}([a-z.]+):\s*$/);
    if (roleMatch !== null) {
      currentRole = roleMatch[1] ?? null;
      continue;
    }
    if (currentRole === null) continue;
    const labelMatch = line.match(/^\s{4}label:\s*(.+?)\s*$/);
    if (labelMatch !== null && labelMatch[1] !== undefined) {
      const existing = roles.get(currentRole) ?? { label: "", homeLens: "" };
      roles.set(currentRole, { ...existing, label: labelMatch[1] });
      continue;
    }
    const lensMatch = line.match(/^\s{4}home_lens:\s*(.+?)\s*$/);
    if (lensMatch !== null && lensMatch[1] !== undefined) {
      const existing = roles.get(currentRole) ?? { label: "", homeLens: "" };
      roles.set(currentRole, { ...existing, homeLens: lensMatch[1] });
    }
  }
  return roles;
}

/** Parse the ROLEFUL-UX-ARCHITECTURE role-to-surface emphasis table row. */
function parseEmphasisRow(surface: string): Map<string, string> {
  const row = new Map<string, string>();
  const lines = UX_ARCH_MD.split("\n");
  const headerLine = lines.find((line) => line.startsWith("| Surface | Fleet Admin"));
  if (headerLine === undefined) throw new Error("emphasis table header not found");
  const headerCells = headerLine.split("|").map((cell) => cell.trim());
  for (const line of lines) {
    if (!line.startsWith(`| ${surface} |`)) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    for (let i = 2; i < cells.length - 1 && i < headerCells.length; i++) {
      const roleHeader = headerCells[i];
      const value = cells[i];
      if (roleHeader !== undefined && value !== undefined && value.length > 0) {
        row.set(roleHeader, value);
      }
    }
  }
  if (row.size === 0) throw new Error(`emphasis row not found: ${surface}`);
  return row;
}

const HEADER_TO_ROLE: Readonly<Record<string, string>> = Object.freeze({
  "Fleet Admin": "fleet.admin",
  "Service Desk": "service.desk",
  Security: "security.compliance",
  Asset: "asset.manager",
  Manager: "team.manager",
  Employee: "employee",
  Vendor: "vendor.operator",
});

// ---------------------------------------------------------------------------
// Matrix conformance
// ---------------------------------------------------------------------------

test("the seven-role union, labels and home lenses match the frozen matrix YAML", () => {
  const roles = parseMatrixRoles();
  expect([...roles.keys()].sort()).toEqual([...ALL_EXPERIENCE_ROLES].sort());
  for (const role of ALL_EXPERIENCE_ROLES) {
    const specRole = roles.get(role);
    expect(specRole).toBeDefined();
    if (specRole === undefined) continue;
    expect(EXPERIENCE_ROLE_LABELS[role]).toBe(specRole.label);
    expect(EXPERIENCE_ROLE_HOME_LENS[role]).toBe(specRole.homeLens);
  }
});

test("primary questions match ROLEFUL-UX-ARCHITECTURE verbatim", () => {
  for (const role of ALL_EXPERIENCE_ROLES) {
    expect(UX_ARCH_MD).toContain(`| ${role} | ${EXPERIENCE_ROLE_PRIMARY_QUESTIONS[role]} |`);
  }
});

test("fleet-actions/print/evidence emphasis match the spec emphasis table", () => {
  const actionsRow = parseEmphasisRow("Fleet Actions");
  const evidenceRow = parseEmphasisRow("Evidence & Audit");
  for (const [header, role] of Object.entries(HEADER_TO_ROLE)) {
    const typedRole = role as keyof typeof FLEET_ACTIONS_EMPHASIS;
    expect(FLEET_ACTIONS_EMPHASIS[typedRole]).toBe(actionsRow.get(header));
    expect(PRINT_EMPHASIS[typedRole]).toBe(actionsRow.get(header));
    expect(EVIDENCE_EMPHASIS[typedRole]).toBe(evidenceRow.get(header));
  }
});

// ---------------------------------------------------------------------------
// The matrix rules are load-bearing
// ---------------------------------------------------------------------------

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100bact01",
    permissions: ["action.plan.read"],
    ...overrides,
  };
}

function lens(
  activeRole: (typeof ALL_EXPERIENCE_ROLES)[number],
  authorityInput: RoleLensAuthorityInput = authority(),
  assignedRoles?: readonly (typeof ALL_EXPERIENCE_ROLES)[number][],
): ActionsRoleLensView {
  const result = buildActionsRoleLens(scopeA(), {
    activeRole,
    assignedRoles,
    authority: authorityInput,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

test("the authority echo is VERBATIM — the lens grants nothing", () => {
  for (const role of ALL_EXPERIENCE_ROLES) {
    const view = lens(role);
    expect(view.grantsAnything).toBe(false);
    expect(view.authority.lensGrantsNothing).toBe(true);
    expect(view.authority.permissions).toEqual(authority().permissions);
  }
});

test("identical authority + any lens => IDENTICAL restricted set (matrix rule)", () => {
  const snapshot = authority();
  const echoes = ALL_EXPERIENCE_ROLES.map((role) => JSON.stringify(lens(role, snapshot).authority));
  const restrictedSets = ALL_EXPERIENCE_ROLES.map((role) =>
    lens(role, snapshot)
      .restricted.map((r) => `${r.capability}:${r.reason}:${r.switchToRole ?? "none"}`)
      .sort()
      .join("|"),
  );
  expect(new Set(echoes).size).toBe(1);
  expect(new Set(restrictedSets).size).toBe(1);
});

test("an EMPTY authority restricts every capability in every lens", () => {
  const empty = authority({ permissions: [] });
  for (const role of ALL_EXPERIENCE_ROLES) {
    const view = lens(role, empty);
    expect(view.restricted.length).toBe(ACTIONS_LANE_CAPABILITIES.length);
  }
});

test("the switch affordance appears ONLY for an ASSIGNED emphasizing role", () => {
  // employee solo: no switch for plan.approve (emphasis roles exclude employee).
  const solo = lens("employee", authority({ permissions: [] }), ["employee"]);
  const soloApprove = solo.restricted.find((r) => r.capability === "action.plan.approve");
  expect(soloApprove?.switchToRole).toBeNull();
  // The principal ALSO holding team.manager gets the switch affordance.
  const dual = lens("employee", authority({ permissions: [] }), ["employee", "team.manager"]);
  const dualApprove = dual.restricted.find((r) => r.capability === "action.plan.approve");
  expect(dualApprove?.switchToRole).toBe("team.manager");
  expect(dualApprove?.escalation.requestLabel).toBe(ROLE_ASSIGNMENT_ESCALATION_LABEL);
});

// ---------------------------------------------------------------------------
// Fail-closed + determinism
// ---------------------------------------------------------------------------

test("unknown role / cross-tenant authority / unassigned active role REFUSE", () => {
  expect(
    buildActionsRoleLens(scopeA(), { activeRole: "root" as never, authority: authority() }).ok,
  ).toBe(false);
  expect(
    buildActionsRoleLens(scopeA(), {
      activeRole: "employee",
      authority: authority({ tenantId: makeTenantId("w100b-foreign") }),
    }).ok,
  ).toBe(false);
  expect(
    buildActionsRoleLens(scopeA(), {
      activeRole: "team.manager",
      assignedRoles: ["employee"],
      authority: authority(),
    }).ok,
  ).toBe(false);
});

test("the same lens input produces a byte-identical view; the view is frozen", () => {
  const input = {
    activeRole: "service.desk" as const,
    assignedRoles: ["service.desk", "employee"] as const,
    authority: authority({ permissions: ["print.job.read", "action.plan.read"] }),
  };
  const a = buildActionsRoleLens(scopeA(), input);
  const b = buildActionsRoleLens(scopeA(), {
    authority: input.authority,
    assignedRoles: input.assignedRoles,
    activeRole: input.activeRole,
  });
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  expect(Object.isFrozen(a.view)).toBe(true);
});

test("the four W100B-owned lenses carry the expected actions emphasis", () => {
  expect(lens("security.compliance").fleetActionsEmphasis).toBe("High");
  expect(lens("service.desk").fleetActionsEmphasis).toBe("High");
  expect(lens("team.manager").fleetActionsEmphasis).toBe("Medium");
  expect(lens("employee").fleetActionsEmphasis).toBe("Request");
  expect(lens("employee").printEmphasis).toBe("Request");
});
