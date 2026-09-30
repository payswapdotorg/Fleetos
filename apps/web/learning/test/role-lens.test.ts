/**
 * W100B web-learning role-lens tests — the PUBLIC EXPERIENCE CONTRACT
 * consumed: matrix/UX-architecture conformance + the load-bearing
 * matrix rules (the lens grants NOTHING) + fail-closed discipline.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  ALL_EXPERIENCE_ROLES,
  EXPERIENCE_ROLE_HOME_LENS,
  EXPERIENCE_ROLE_LABELS,
  EXPERIENCE_ROLE_PRIMARY_QUESTIONS,
  LEARNING_EMPHASIS,
  LEARNING_LANE_CAPABILITIES,
  ROLE_ASSIGNMENT_ESCALATION_LABEL,
  buildLearningRoleLens,
} from "../src/role-lens";
import type { LearningRoleLensView, RoleLensAuthorityInput } from "../src/role-lens";
import { TENANT_A, scopeA } from "./helpers";

// ---------------------------------------------------------------------------
// Spec fixtures (TEST-SCOPE reads of the frozen TL-owned contracts)
// ---------------------------------------------------------------------------

/** The repo root (this file lives in apps/web/learning/test). */
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

test("learning emphasis matches the spec emphasis table's Learning row", () => {
  const learningRow = parseEmphasisRow("Learning");
  for (const [header, role] of Object.entries(HEADER_TO_ROLE)) {
    const typedRole = role as keyof typeof LEARNING_EMPHASIS;
    expect(LEARNING_EMPHASIS[typedRole]).toBe(learningRow.get(header));
  }
});

// ---------------------------------------------------------------------------
// The matrix rules are load-bearing
// ---------------------------------------------------------------------------

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100blrn01",
    permissions: ["learning.case.read"],
    ...overrides,
  };
}

function lens(
  activeRole: (typeof ALL_EXPERIENCE_ROLES)[number],
  authorityInput: RoleLensAuthorityInput = authority(),
  assignedRoles?: readonly (typeof ALL_EXPERIENCE_ROLES)[number][],
): LearningRoleLensView {
  const result = buildLearningRoleLens(scopeA(), {
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
    expect(view.restricted.length).toBe(LEARNING_LANE_CAPABILITIES.length);
  }
});

test("restricted explanations carry reason + escalation; switch ONLY for assigned roles", () => {
  const solo = lens("employee", authority({ permissions: [] }), ["employee"]);
  const soloSubmit = solo.restricted.find((r) => r.capability === "learning.case.submit");
  expect(soloSubmit?.reason).toBe("missing_permission");
  expect(soloSubmit?.switchToRole).toBeNull();
  expect(soloSubmit?.escalation.kind).toBe("role_assignment");
  expect(soloSubmit?.escalation.requestLabel).toBe(ROLE_ASSIGNMENT_ESCALATION_LABEL);

  const dual = lens("employee", authority({ permissions: [] }), [
    "employee",
    "security.compliance",
  ]);
  const dualSubmit = dual.restricted.find((r) => r.capability === "learning.case.submit");
  expect(dualSubmit?.switchToRole).toBe("security.compliance");
});

// ---------------------------------------------------------------------------
// Fail-closed + determinism
// ---------------------------------------------------------------------------

test("unknown role / cross-tenant authority / unassigned active role REFUSE", () => {
  expect(
    buildLearningRoleLens(scopeA(), { activeRole: "root" as never, authority: authority() }).ok,
  ).toBe(false);
  expect(
    buildLearningRoleLens(scopeA(), {
      activeRole: "employee",
      authority: authority({ tenantId: makeTenantId("w100b-foreign") }),
    }).ok,
  ).toBe(false);
  expect(
    buildLearningRoleLens(scopeA(), {
      activeRole: "team.manager",
      assignedRoles: ["employee"],
      authority: authority(),
    }).ok,
  ).toBe(false);
});

test("the same lens input produces a byte-identical view; the view is frozen", () => {
  const input = {
    activeRole: "security.compliance" as const,
    assignedRoles: ["security.compliance", "team.manager"] as const,
    authority: authority({ permissions: ["learning.case.read", "learning.adoption.read"] }),
  };
  const a = buildLearningRoleLens(scopeA(), input);
  const b = buildLearningRoleLens(scopeA(), {
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

test("the W100B-owned lenses carry the expected learning emphasis", () => {
  expect(lens("security.compliance").learningEmphasis).toBe("High");
  expect(lens("service.desk").learningEmphasis).toBe("Medium");
  expect(lens("team.manager").learningEmphasis).toBe("Medium");
  expect(lens("employee").learningEmphasis).toBe("Low");
});
