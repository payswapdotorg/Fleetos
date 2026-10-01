/**
 * W100C web-commerce — the ROLE-AWARE commerce projection tests: the
 * four C-lane lenses, the matrix rules, and the permission-free
 * guarantee.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  COMMERCE_ROLE_LENSES,
  COMMERCE_ROLE_LENS_IDS,
  COMMERCE_ROLE_LENS_VIEW_VERSION,
  applyCommerceRoleLens,
} from "../src/index";
import { TENANT_A, TENANT_B } from "./helpers";

test("the W100C commerce lens vocabulary is exactly the four C-lane roles", () => {
  expect(COMMERCE_ROLE_LENS_IDS).toEqual([
    "asset.manager",
    "team.manager",
    "employee",
    "vendor.operator",
  ]);
  expect(COMMERCE_ROLE_LENSES["vendor.operator"].label).toBe("Vendor / Service Operator");
  expect(COMMERCE_ROLE_LENSES["vendor.operator"].homeLens).toBe("exchange");
});

test("the asset lens leads with procurement + vendors (Commerce HIGHEST)", () => {
  const result = applyCommerceRoleLens(TENANT_A, "asset.manager");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const first = result.view.areas.slice(0, 2).sort();
  expect(first).toEqual(["procurement", "vendors"]);
});

test("the vendor lens leads with maintenance + procurement (the exchange lens)", () => {
  const result = applyCommerceRoleLens(TENANT_A, "vendor.operator");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const first = result.view.areas.slice(0, 2).sort();
  expect(first).toEqual(["maintenance", "procurement"]);
});

test("the employee lens de-emphasizes vendors/maintenance with capability notices + escalation", () => {
  const result = applyCommerceRoleLens(TENANT_A, "employee");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // vendors + maintenance + connectivity are "low"; communication is "minimal".
  expect(result.view.notices.map((n) => n.area)).toEqual([
    "communication",
    "connectivity",
    "maintenance",
    "vendors",
  ]);
  for (const notice of result.view.notices) {
    expect(notice.escalationPath).toContain("Switch your active role");
    expect(notice.reason).toMatch(/^role_(low|minimal)_emphasis$/);
  }
  expect(result.view.scopeNote).toContain("Scoped to your requests");
});

test("RULE: experience_profiles_do_not_grant_permissions — the lens view carries no permission FIELDS", () => {
  // The check walks every object KEY at every depth (the provider-
  // neutrality discipline): a permission-like FIELD would be a second
  // permission system. Human copy explaining that permissions are
  // UNAFFECTED by switching is not permission data — it is the matrix
  // rule `experience_profiles_do_not_grant_permissions` rendered.
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
  for (const lensId of COMMERCE_ROLE_LENS_IDS) {
    const result = applyCommerceRoleLens(TENANT_A, lensId);
    if (!result.ok) throw new Error(result.error.message);
    const keys = new Set<string>();
    collectKeys(result.view, keys);
    for (const key of keys) {
      expect(/^(effective)?permissions?$|^grant$|^allow$|^deny$|^permissions/.test(key)).toBe(false);
    }
  }
});

test("the lens projection is deterministic and tenant-scoped", () => {
  const a = applyCommerceRoleLens(TENANT_A, "team.manager");
  const b = applyCommerceRoleLens(TENANT_A, "team.manager");
  expect(a).toEqual(b);
  if (a.ok) {
    expect(a.view.viewVersion).toBe(COMMERCE_ROLE_LENS_VIEW_VERSION);
    expect(a.view.tenantId).toBe(TENANT_A);
    expect(Object.isFrozen(a.view)).toBe(true);
  }
  const other = applyCommerceRoleLens(TENANT_B, "team.manager");
  if (other.ok) expect(other.view.tenantId).toBe(TENANT_B);
});

test("unknown lens ids refuse machine-stably", () => {
  const result = applyCommerceRoleLens(TENANT_A, "fleet.admin" as never);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("web-commerce.role_lens.unknown_lens");
  }
});

test("the lens carries the role's primary question (ROLEFUL-UX copy)", () => {
  const result = applyCommerceRoleLens(TENANT_A, "vendor.operator");
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.primaryQuestion).toBe(
    "Which quotes, work orders and fulfillment steps require my response?",
  );
});
