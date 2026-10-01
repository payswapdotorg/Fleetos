/**
 * W100C web-workloads — the ROLE-AWARE workload projection tests: the
 * four C-lane lenses (asset.manager, team.manager, employee,
 * vendor.operator), the matrix rules, and the presentation-only
 * guarantee (row preservation + permission-free views).
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  WORKLOAD_ROLE_LENSES,
  WORKLOAD_ROLE_LENS_IDS,
  WORKLOAD_ROLE_LENS_VIEW_VERSION,
  applyWorkloadRoleLens,
  buildWorkloadProfileListView,
} from "../src/index";
import { buildWorkloadProfile } from "@fleetos/workloads";
import { TENANT_A, TENANT_B, T0, CORR, requirementVector } from "./helpers";

const LENS_TENANT = TENANT_A;

function profileNamed(workloadId: string, name: string, subjectKind: "role" | "process") {
  const built = buildWorkloadProfile(LENS_TENANT, {
    workloadId: workloadId as never,
    subjectKind,
    name,
    description: `lens test workload ${name}`,
    requirements: requirementVector(),
    constraints: {
      requiredApplications: [{ appId: "app.suite", minVersion: "1.0" }],
      environments: ["office"],
      peripherals: ["dock"],
      classification: "internal",
    },
    evidence: [{ observationId: "obs_lens_0001", kind: "device.workload", note: "n" }],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.profile;
}

/** A deterministic listing over three workloads (mixed subject kinds). */
function listing() {
  const result = buildWorkloadProfileListView(LENS_TENANT, [
    profileNamed("wl_lens_zeta0001", "vendor.support", "process"),
    profileNamed("wl_lens_alpha0001", "team.desk", "role"),
    profileNamed("wl_lens_mid000001", "finance.analyst", "role"),
  ]);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

test("the W100C lens vocabulary is exactly the four C-lane roles", () => {
  expect(WORKLOAD_ROLE_LENS_IDS).toEqual([
    "asset.manager",
    "team.manager",
    "employee",
    "vendor.operator",
  ]);
  expect(WORKLOAD_ROLE_LENSES["asset.manager"].label).toBe("Asset & Procurement Manager");
  expect(WORKLOAD_ROLE_LENSES["team.manager"].homeLens).toBe("team");
  expect(WORKLOAD_ROLE_LENSES.employee.homeLens).toBe("personal");
  expect(WORKLOAD_ROLE_LENSES["vendor.operator"].homeLens).toBe("exchange");
});

test("RULE: experience_profiles_do_not_grant_permissions — the lens view is structurally permission-free", () => {
  // Walk every object KEY at every depth for ALL four lenses (the
  // provider-neutrality discipline): a permission-like FIELD would be a
  // second permission system. Human copy explaining that permissions
  // are UNAFFECTED by switching is not permission data — it is the
  // matrix rule rendered.
  function collectKeys(value: unknown, keys: Set<string>): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key.toLowerCase());
      collectKeys(child, keys);
    }
  }
  for (const lensId of WORKLOAD_ROLE_LENS_IDS) {
    const result = applyWorkloadRoleLens(LENS_TENANT, lensId, listing());
    if (!result.ok) throw new Error(result.error.message);
    const keys = new Set<string>();
    collectKeys(result.view, keys);
    for (const key of keys) {
      expect(/^(effective)?permissions?$|^grant$|^allow$|^deny$|^permissions/.test(key)).toBe(false);
    }
  }
  // The view type's top-level keys carry no permission surface either.
  const result = applyWorkloadRoleLens(LENS_TENANT, "asset.manager", listing());
  if (!result.ok) throw new Error(result.error.message);
  for (const key of Object.keys(result.view)) {
    expect(/permission|grant|allow|deny/i.test(key)).toBe(false);
  }
});

test("RULE: the lens preserves the row SET with byte-identical domain values (presentation only)", () => {
  const base = listing();
  for (const lensId of WORKLOAD_ROLE_LENS_IDS) {
    const result = applyWorkloadRoleLens(LENS_TENANT, lensId, base);
    if (!result.ok) throw new Error(result.error.message);
    // Same rows, possibly reordered — compare as sorted multiset.
    const byId = [...result.view.rows].sort((a, b) => (a.workloadId < b.workloadId ? -1 : 1));
    const baseById = [...base.rows].sort((a, b) => (a.workloadId < b.workloadId ? -1 : 1));
    expect(byId).toEqual(baseById);
  }
});

test("the asset lens orders rows by the demand signal (constraints + evidence first)", () => {
  const result = applyWorkloadRoleLens(LENS_TENANT, "asset.manager", listing());
  if (!result.ok) throw new Error(result.error.message);
  // All three rows carry the same signal here — the order is the
  // machine-stable workloadId tie-break.
  expect(result.view.rows.map((r) => r.workloadId)).toEqual([
    "wl_lens_alpha0001",
    "wl_lens_mid000001",
    "wl_lens_zeta0001",
  ]);
});

test("the team lens lifts team-shaped subject kinds first", () => {
  const result = applyWorkloadRoleLens(LENS_TENANT, "team.manager", listing());
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.rows[0]!.name).toBe("team.desk");
});

test("section ordering follows the lens emphasis, machine-stably", () => {
  const asset = applyWorkloadRoleLens(LENS_TENANT, "asset.manager", listing());
  if (!asset.ok) throw new Error(asset.error.message);
  // commerce-links is "highest" for the asset lens -> first.
  expect(asset.view.sections[0]).toBe("commerce-links");

  const vendor = applyWorkloadRoleLens(LENS_TENANT, "vendor.operator", listing());
  if (!vendor.ok) throw new Error(vendor.error.message);
  // commerce-links is the vendor lens's highest section too.
  expect(vendor.view.sections[0]).toBe("commerce-links");
  // Every de-emphasized section carries a capability notice.
  const deemphasized = Object.entries(WORKLOAD_ROLE_LENSES["vendor.operator"].sectionEmphasis)
    .filter(([, emphasis]) => emphasis === "low" || emphasis === "minimal")
    .map(([section]) => section);
  expect(vendor.view.notices.length).toBe(deemphasized.length);
  for (const notice of vendor.view.notices) {
    expect(notice.escalationPath.length).toBeGreaterThan(0);
    expect(notice.reason).toMatch(/^role_(low|minimal)_emphasis$/);
  }
});

test("RULE: unavailable_capabilities_show_reason_and_escalation_path — employee notices", () => {
  const result = applyWorkloadRoleLens(LENS_TENANT, "employee", listing());
  if (!result.ok) throw new Error(result.error.message);
  // The employee lens de-emphasizes recommendations (low), journey (low)
  // and commerce-links (minimal): three notices, section-sorted.
  expect(result.view.notices.map((n) => n.section)).toEqual([
    "commerce-links",
    "journey",
    "recommendations",
  ]);
  for (const notice of result.view.notices) {
    expect(notice.message.length).toBeGreaterThan(0);
    expect(notice.escalationPath).toContain("Switch your active role");
  }
  // The scope note explains the lens boundary (never a permission).
  expect(result.view.scopeNote).toContain("Scoped to the workloads you own or use");
});

test("RULE: active_role_is_scoped_to_current_tenant — a foreign listing refuses", () => {
  const foreignListing = buildWorkloadProfileListView(TENANT_B, []);
  if (!foreignListing.ok) throw new Error(foreignListing.error.message);
  const result = applyWorkloadRoleLens(LENS_TENANT, "employee", foreignListing.view);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("web-workloads.role_lens.tenant_mismatch");
  }
});

test("unknown lens ids and missing listings refuse machine-stably", () => {
  const badLens = applyWorkloadRoleLens(LENS_TENANT, "fleet.admin" as never, listing());
  expect(badLens.ok).toBe(false);
  if (!badLens.ok) {
    expect(badLens.error.code).toBe("web-workloads.role_lens.unknown_lens");
  }
  const noListing = applyWorkloadRoleLens(LENS_TENANT, "employee", null as never);
  expect(noListing.ok).toBe(false);
  if (!noListing.ok) {
    expect(noListing.error.code).toBe("web-workloads.role_lens.listing_required");
  }
});

test("the lens projection is deterministic (byte-identical views)", () => {
  const a = applyWorkloadRoleLens(LENS_TENANT, "team.manager", listing());
  const b = applyWorkloadRoleLens(LENS_TENANT, "team.manager", listing());
  expect(a).toEqual(b);
  if (a.ok) expect(a.view.viewVersion).toBe(WORKLOAD_ROLE_LENS_VIEW_VERSION);
});

test("the lens carries the role's primary question (ROLEFUL-UX copy)", () => {
  const asset = applyWorkloadRoleLens(LENS_TENANT, "asset.manager", listing());
  if (!asset.ok) throw new Error(asset.error.message);
  expect(asset.view.primaryQuestion).toBe(
    "What should we buy, maintain, replace or subscribe to?",
  );
  expect(asset.view.label).toBe("Asset & Procurement Manager");
});

test("TYPE PROOF: lens views are tenant-scoped and frozen", () => {
  const result = applyWorkloadRoleLens(LENS_TENANT, "employee", listing());
  if (!result.ok) throw new Error(result.error.message);
  expect(Object.isFrozen(result.view)).toBe(true);
  expect(result.view.tenantId).toBe(LENS_TENANT);
  expect(asTenantId("tnt_w060cbbbbbbbb1")).toBe(LENS_TENANT);
});
