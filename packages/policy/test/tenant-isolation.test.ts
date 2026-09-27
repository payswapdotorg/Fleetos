/**
 * W031 D4 tests — tenant isolation for the Contract Guardian, EXHAUSTIVE:
 *   - evaluation is tenant-matched (a tenant-A request can never be
 *     evaluated against tenant-B rules — rejected, never a decision);
 *   - the rule-set store is partitioned per tenant: reads under tenant B
 *     never observe tenant A's rule sets (indistinguishable from absent);
 *   - cross-tenant publications are rejected;
 *   - context-free and invalid-tenant access is rejected at runtime even
 *     when the type system is bypassed (`undefined as never`);
 *   - partitions are independent (same version numbers, same rule-set
 *     ids never collide across tenants).
 */

import { describe, expect, test } from "bun:test";
import { compileGuardianRuleSet, createInMemoryGuardianRuleSetStore, evaluateGuardianRequest } from "../src/index";
import type { GuardianRuleSet, PolicyTenantScope } from "../src/index";
import { CORR, TENANT_A, TENANT_B, T0, request, rule, scopeA, scopeB } from "./helpers";

const condition = { kind: "action", actions: { in: ["file.upload"] } } as const;

function ruleSetFor(
  tenantId: typeof TENANT_A,
  version: number,
  effect: "BLOCK" | "WARN" = "BLOCK",
): GuardianRuleSet {
  const r = rule(tenantId, { name: `store-rule-v${version}`, condition, effect, at: T0 });
  const compiled = compileGuardianRuleSet(tenantId, {
    rules: [r],
    version,
    at: T0,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.ruleSet;
}

describe("D4: rule-set store partitions (by construction)", () => {
  test("a tenant-B scope never observes tenant-A rule sets", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const aSet = ruleSetFor(TENANT_A, 1);
    const put = store.putRuleSet(scopeA(), aSet);
    expect(put.ok).toBe(true);
    // Tenant B sees nothing — indistinguishable from an empty partition.
    expect(store.getLatestRuleSet(scopeB())).toBeUndefined();
    expect(store.getRuleSetVersion(scopeB(), 1)).toBeUndefined();
    expect(store.listRuleSets(scopeB())).toEqual([]);
    expect(store.size(scopeB())).toBe(0);
    // Tenant A sees its own.
    expect(store.getLatestRuleSet(scopeA())?.ruleSetId).toBe(aSet.ruleSetId);
    expect(store.size(scopeA())).toBe(1);
  });

  test("cross-tenant publication is rejected", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const bSet = ruleSetFor(TENANT_B, 1);
    const put = store.putRuleSet(scopeA(), bSet); // B's rule set under A's scope
    expect(put.ok).toBe(false);
    if (!put.ok) {
      expect(put.error.kind).toBe("DomainError");
      expect(put.error.code).toBe("policy.ruleset.store");
    }
    expect(store.size(scopeA())).toBe(0);
    expect(store.size(scopeB())).toBe(0); // rejected — never stored anywhere.
  });

  test("partitions are independent: identical versions coexist per tenant", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const a1 = ruleSetFor(TENANT_A, 1);
    const b1 = ruleSetFor(TENANT_B, 1);
    expect(store.putRuleSet(scopeA(), a1).ok).toBe(true);
    expect(store.putRuleSet(scopeB(), b1).ok).toBe(true);
    expect(store.size(scopeA())).toBe(1);
    expect(store.size(scopeB())).toBe(1);
    expect(store.getRuleSetVersion(scopeA(), 1)?.tenantId).toBe(TENANT_A);
    expect(store.getRuleSetVersion(scopeB(), 1)?.tenantId).toBe(TENANT_B);
  });
});

describe("D4: append-only version slots", () => {
  test("a version slot is written once; different content is rejected; identical content is idempotent", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const v1 = ruleSetFor(TENANT_A, 1);
    expect(store.putRuleSet(scopeA(), v1).ok).toBe(true);
    // Identical content: idempotent no-op.
    expect(store.putRuleSet(scopeA(), v1).ok).toBe(true);
    expect(store.size(scopeA())).toBe(1);
    // Different content in the same slot: rejected.
    const other = ruleSetFor(TENANT_A, 1, "WARN");
    expect(store.putRuleSet(scopeA(), other).ok).toBe(false);
    expect(store.size(scopeA())).toBe(1);
    // The next version appends.
    const v2 = ruleSetFor(TENANT_A, 2);
    expect(store.putRuleSet(scopeA(), v2).ok).toBe(true);
    expect(store.getLatestRuleSet(scopeA())?.version).toBe(2);
    expect(store.listRuleSets(scopeA()).map((s) => s.version)).toEqual([1, 2]);
  });
});

describe("D4: context-free and invalid-scope rejection (types bypassed)", () => {
  test("undefined / null / empty / malformed scopes are rejected at runtime", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const aSet = ruleSetFor(TENANT_A, 1);
    // Bypass the types: these MUST be rejected by the runtime guard.
    const noScope = store.putRuleSet(undefined as never, aSet);
    expect(noScope.ok).toBe(false);
    const nullScope = store.putRuleSet(null as never, aSet);
    expect(nullScope.ok).toBe(false);
    const emptyScope = store.putRuleSet({} as never, aSet);
    expect(emptyScope.ok).toBe(false);
    const badTenant = store.putRuleSet({ tenantId: "not-a-tenant" } as never, aSet);
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) {
      expect(badTenant.error.kind).toBe("DomainError");
    }
    // Reads under a bypassed scope return nothing (never another tenant's).
    expect(store.getLatestRuleSet(undefined as never)).toBeUndefined();
    expect(store.listRuleSets(undefined as never)).toEqual([]);
    expect(store.size(undefined as never)).toBe(0);
    // Nothing was stored by the rejected writes.
    expect(store.size(scopeA())).toBe(0);
  });

  test("the guard accepts only canonical tenant ids (frozen grammar)", () => {
    const store = createInMemoryGuardianRuleSetStore();
    const aSet = ruleSetFor(TENANT_A, 1);
    const shortTenant: PolicyTenantScope = { tenantId: "tnt_ab" as never, correlationId: CORR };
    expect(store.putRuleSet(shortTenant, aSet).ok).toBe(false);
    const upperTenant: PolicyTenantScope = { tenantId: "TNT_TESTTENANT00A" as never, correlationId: CORR };
    expect(store.putRuleSet(upperTenant, aSet).ok).toBe(false);
  });
});

describe("D4: evaluation tenant isolation (exhaustive pairing)", () => {
  test("every (tenant-A rule set, tenant-B request) pair is rejected — never a decision", () => {
    const effects = ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const;
    for (const effect of effects) {
      const r = rule(TENANT_A, {
        name: `iso-${effect}`,
        condition,
        effect,
        at: T0,
      });
      const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 1, at: T0 });
      if (!compiled.ok) throw new Error(compiled.error.message);
      const result = evaluateGuardianRequest(compiled.ruleSet, request({ tenantId: TENANT_B }), {
        at: T0,
        correlationId: CORR,
      });
      expect(result.ok).toBe(false);
    }
  });
});
