/**
 * W100B web-security role-lens tests — the PUBLIC EXPERIENCE CONTRACT
 * consumed, never re-declared loosely:
 *
 *   1. MATRIX CONFORMANCE — the local role tables (labels, home lenses,
 *      emphasis levels) are proven EQUAL to the frozen
 *      `spec/ui/ROLE-EXPERIENCE-MATRIX.yaml` and the
 *      `spec/ui/ROLEFUL-UX-ARCHITECTURE.md` role-to-surface emphasis
 *      table (spec files are read TEST-SCOPE only; src/ stays pure).
 *   2. THE MATRIX RULES — the lens grants NOTHING: the authority echo
 *      is verbatim; every restricted explanation carries
 *      grantsNothing/reason/escalation; identical authority + any lens
 *      => identical permission outcome.
 *   3. Fail-closed discipline: unknown role, cross-tenant authority,
 *      unassigned active role, malformed input.
 *   4. Determinism: input-order invariance, byte-identical views.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  ALL_EXPERIENCE_ROLES,
  APPROVALS_EMPHASIS,
  EVIDENCE_EMPHASIS,
  EXPERIENCE_ROLE_HOME_LENS,
  EXPERIENCE_ROLE_LABELS,
  EXPERIENCE_ROLE_LENS_LEADS,
  EXPERIENCE_ROLE_PRIMARY_QUESTIONS,
  FINDINGS_EMPHASIS,
  POLICIES_EMPHASIS,
  ROLE_ASSIGNMENT_ESCALATION_LABEL,
  SECURITY_LANE_CAPABILITIES,
  buildSecurityRoleLens,
} from "../src/role-lens";
import type { RoleLensAuthorityInput, SecurityRoleLensView } from "../src/role-lens";
import { TENANT_A, scopeA } from "./helpers";

// ---------------------------------------------------------------------------
// Spec fixtures (TEST-SCOPE reads of the frozen TL-owned contracts)
// ---------------------------------------------------------------------------

/** The repo root (this file lives in apps/web/security/test). */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** The frozen ROLE-EXPERIENCE-MATRIX.yaml (roles, labels, home lenses). */
const MATRIX_YAML = readFileSync(
  join(REPO_ROOT, "spec", "ui", "ROLE-EXPERIENCE-MATRIX.yaml"),
  "utf8",
);

/** The frozen ROLEFUL-UX-ARCHITECTURE.md (primary questions, emphasis). */
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
    // cells[0] is "" before the leading pipe; cells[1] is the surface name.
    for (let i = 2; i < cells.length - 1 && i < headerCells.length; i++) {
      const roleHeader = headerCells[i];
      const value = cells[i];
      if (roleHeader !== undefined && value !== undefined && value.length > 0) {
        // The header words "Fleet Admin", "Service Desk", "Security",
        // "Asset", "Manager", "Employee", "Vendor" map to roles.
        row.set(roleHeader, value);
      }
    }
  }
  if (row.size === 0) throw new Error(`emphasis row not found: ${surface}`);
  return row;
}

/** The table header -> canonical role mapping (header cell -> role id). */
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
// 1 — Matrix conformance (the frozen contract consumed, not re-invented)
// ---------------------------------------------------------------------------

test("the seven-role union matches ROLE-EXPERIENCE-MATRIX.yaml exactly", () => {
  const roles = parseMatrixRoles();
  expect([...roles.keys()].sort()).toEqual([...ALL_EXPERIENCE_ROLES].sort());
});

test("role labels and home lenses match the matrix YAML verbatim", () => {
  const roles = parseMatrixRoles();
  for (const role of ALL_EXPERIENCE_ROLES) {
    const specRole = roles.get(role);
    expect(specRole).toBeDefined();
    if (specRole === undefined) continue;
    expect(EXPERIENCE_ROLE_LABELS[role]).toBe(specRole.label);
    expect(EXPERIENCE_ROLE_HOME_LENS[role]).toBe(specRole.homeLens);
  }
});

test("primary questions match ROLEFUL-UX-ARCHITECTURE's canonical table verbatim", () => {
  for (const role of ALL_EXPERIENCE_ROLES) {
    // The spec table row: "| fleet.admin | What is the state of my fleet... |"
    const expected = EXPERIENCE_ROLE_PRIMARY_QUESTIONS[role];
    expect(UX_ARCH_MD).toContain(`| ${role} | ${expected} |`);
  }
});

test("every role carries a lens lead (no dead-end role in the lane)", () => {
  for (const role of ALL_EXPERIENCE_ROLES) {
    expect(EXPERIENCE_ROLE_LENS_LEADS[role].length).toBeGreaterThan(0);
  }
});

test("findings/policies/approvals/evidence emphasis match the spec emphasis table", () => {
  const securityRow = parseEmphasisRow("Security");
  const policiesRow = parseEmphasisRow("Policies");
  const evidenceRow = parseEmphasisRow("Evidence & Audit");
  for (const [header, role] of Object.entries(HEADER_TO_ROLE)) {
    const typedRole = role as keyof typeof FINDINGS_EMPHASIS;
    expect(FINDINGS_EMPHASIS[typedRole]).toBe(securityRow.get(header));
    expect(APPROVALS_EMPHASIS[typedRole]).toBe(securityRow.get(header));
    expect(POLICIES_EMPHASIS[typedRole]).toBe(policiesRow.get(header));
    expect(EVIDENCE_EMPHASIS[typedRole]).toBe(evidenceRow.get(header));
  }
});

// ---------------------------------------------------------------------------
// 2 — The matrix rules are load-bearing
// ---------------------------------------------------------------------------

/** A canonical authority snapshot (structurally = identity's ResolvedPermissions). */
function authority(overrides: Partial<RoleLensAuthorityInput> = {}): RoleLensAuthorityInput {
  return {
    tenantId: TENANT_A,
    principalId: "usr_w100bsec01",
    permissions: ["security.finding.read"],
    ...overrides,
  };
}

function lens(
  activeRole: (typeof ALL_EXPERIENCE_ROLES)[number],
  authorityInput: RoleLensAuthorityInput = authority(),
  assignedRoles?: readonly (typeof ALL_EXPERIENCE_ROLES)[number][],
): SecurityRoleLensView {
  const result = buildSecurityRoleLens(scopeA(), {
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
    expect(view.authority.source).toBe("identity_and_guardian");
    expect(view.authority.lensGrantsNothing).toBe(true);
    expect(view.authority.tenantId).toBe(authority().tenantId);
    expect(view.authority.principalId).toBe(authority().principalId);
    expect(view.authority.permissions).toEqual(authority().permissions);
  }
});

test("identical authority + any lens => IDENTICAL permission outcome (matrix rule)", () => {
  const snapshot = authority();
  const echoes = ALL_EXPERIENCE_ROLES.map((role) => JSON.stringify(lens(role, snapshot).authority));
  const restrictedSets = ALL_EXPERIENCE_ROLES.map((role) =>
    lens(role, snapshot)
      .restricted.map((r) => `${r.capability}:${r.reason}`)
      .sort()
      .join("|"),
  );
  // Every lens echoes the same authority byte-for-byte...
  expect(new Set(echoes).size).toBe(1);
  // ...and every lens restricts the SAME capabilities for the SAME reason.
  expect(new Set(restrictedSets).size).toBe(1);
});

test("an EMPTY authority restricts every capability in every lens — no role can rescue it", () => {
  const empty = authority({ permissions: [] });
  for (const role of ALL_EXPERIENCE_ROLES) {
    const view = lens(role, empty);
    expect(view.restricted.length).toBe(SECURITY_LANE_CAPABILITIES.length);
    for (const restricted of view.restricted) {
      expect(restricted.reason).toBe("missing_permission");
      expect(restricted.grantsNothing).toBe(false);
      expect(restricted.escalation.kind).toBe("role_assignment");
      expect(restricted.escalation.requestLabel).toBe(ROLE_ASSIGNMENT_ESCALATION_LABEL);
    }
  }
});

test("a FULL authority restricts nothing in any lens", () => {
  const full = authority({
    permissions: SECURITY_LANE_CAPABILITIES.map((c) => c.requiredPermission),
  });
  for (const role of ALL_EXPERIENCE_ROLES) {
    expect(lens(role, full).restricted).toEqual([]);
  }
});

test("restricted explanations carry reason + escalation path (matrix rule)", () => {
  const view = lens("security.compliance", authority({ permissions: [] }));
  const decide = view.restricted.find((r) => r.capability === "security.approval.decide");
  expect(decide).toBeDefined();
  if (decide === undefined) return;
  expect(decide.requiredPermission).toBe("security.approval.decide");
  expect(decide.reason).toBe("missing_permission");
  expect(decide.escalation.kind).toBe("role_assignment");
  expect(decide.escalation.action).toContain("security.compliance");
});

test("the switch affordance appears ONLY for an ASSIGNED emphasizing role (never otherwise)", () => {
  // employee assigned only employee: no switch for approval.decide.
  const solo = lens("employee", authority({ permissions: [] }), ["employee"]);
  const soloDecide = solo.restricted.find((r) => r.capability === "security.approval.decide");
  expect(soloDecide?.switchToRole).toBeNull();
  // The same principal ALSO holding security.compliance gets the switch
  // affordance (a lens switch — emphasis, never authority).
  const dual = lens(
    "employee",
    authority({ permissions: [] }),
    ["employee", "security.compliance"],
  );
  const dualDecide = dual.restricted.find((r) => r.capability === "security.approval.decide");
  expect(dualDecide?.switchToRole).toBe("security.compliance");
  // ...and the authority echo is STILL the empty set (the switch granted nothing).
  expect(dual.authority.permissions).toEqual([]);
});

test("assignedRoles normalize to canonical order (duplicates REFUSE, order normalizes)", () => {
  // Duplicates refuse (fail-closed — never silently deduplicated).
  const dup = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    assignedRoles: ["security.compliance", "employee", "security.compliance"],
    authority: authority(),
  });
  expect(dup.ok).toBe(false);
  // Valid input normalizes into canonical order.
  const view = lens(
    "employee",
    authority(),
    ["security.compliance", "employee"],
  );
  expect(view.assignedRoles).toEqual(["employee", "security.compliance"]);
});

// ---------------------------------------------------------------------------
// 3 — Fail-closed discipline
// ---------------------------------------------------------------------------

test("an unknown active role REFUSES", () => {
  const result = buildSecurityRoleLens(scopeA(), {
    activeRole: "superuser" as never,
    authority: authority(),
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("surface.role_lens_invalid");
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/input/activeRole:unknown_role");
});

test("a cross-tenant authority snapshot REFUSES (active role is tenant-scoped)", () => {
  const foreign = authority({ tenantId: makeTenantId("w100b-other") });
  const result = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    authority: foreign,
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("surface.tenant_mismatch");
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/input/authority/tenantId:tenant_mismatch");
});

test("an active role the principal does not hold REFUSES", () => {
  const result = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    assignedRoles: ["employee"],
    authority: authority(),
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/input/activeRole:role_not_assigned");
});

test("malformed authority / duplicate assigned roles REFUSE machine-stably", () => {
  const badAuthority = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    authority: { tenantId: "", principalId: 5, permissions: "nope" } as never,
  });
  expect(badAuthority.ok).toBe(false);
  if (badAuthority.ok) return;
  const paths = badAuthority.error.failures.map((f) => f.path);
  expect(paths).toContain("/input/authority/tenantId");
  expect(paths).toContain("/input/authority/principalId");
  expect(paths).toContain("/input/authority/permissions");

  const dupRoles = buildSecurityRoleLens(scopeA(), {
    activeRole: "employee",
    assignedRoles: ["employee", "employee"],
    authority: authority(),
  });
  expect(dupRoles.ok).toBe(false);
  if (dupRoles.ok) return;
  expect(dupRoles.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/input/assignedRoles/1:duplicate_role");
});

test("an invalid scope REFUSES with the synthetic tenant", () => {
  const result = buildSecurityRoleLens({ tenantId: "" as never }, {
    activeRole: "employee",
    authority: authority(),
  });
  expect(result.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// 4 — Determinism
// ---------------------------------------------------------------------------

test("the same lens input produces a byte-identical view (input-order invariant)", () => {
  const a = buildSecurityRoleLens(scopeA(), {
    activeRole: "security.compliance",
    assignedRoles: ["security.compliance", "employee"],
    authority: authority({ permissions: ["security.finding.read", "policy.rule.read"] }),
  });
  const b = buildSecurityRoleLens(scopeA(), {
    authority: authority({ permissions: ["security.finding.read", "policy.rule.read"] }),
    assignedRoles: ["security.compliance", "employee"],
    activeRole: "security.compliance",
  });
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
});

test("the view is deeply frozen", () => {
  const view = lens("security.compliance");
  expect(Object.isFrozen(view)).toBe(true);
  expect(Object.isFrozen(view.authority)).toBe(true);
  expect(Object.isFrozen(view.restricted)).toBe(true);
});

test("the four W100B-owned lenses carry the expected emphasis shape", () => {
  expect(lens("security.compliance").findingsEmphasis).toBe("Highest");
  expect(lens("security.compliance").evidenceEmphasis).toBe("Highest");
  expect(lens("service.desk").findingsEmphasis).toBe("Medium");
  expect(lens("service.desk").evidenceEmphasis).toBe("High");
  expect(lens("team.manager").findingsEmphasis).toBe("Low");
  expect(lens("team.manager").evidenceEmphasis).toBe("Medium");
  expect(lens("employee").findingsEmphasis).toBe("Personal-policy");
  expect(lens("employee").evidenceEmphasis).toBe("Personal");
  expect(lens("employee").policiesEmphasis).toBe("Explain");
});
