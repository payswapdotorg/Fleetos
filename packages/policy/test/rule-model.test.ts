/**
 * W031 D2 tests — the Contract Guardian rule model: deterministic rule
 * ids, versioned rules (revision discipline), and versioned rule sets
 * compiled in deterministic order.
 */

import { describe, expect, test } from "bun:test";
import {
  ALL_RULE_CONDITION_KINDS,
  compileGuardianRuleSet,
  defineGuardianRule,
  guardianRuleId,
  reviseGuardianRule,
  validateRuleCondition,
} from "../src/index";
import type { GuardianRule } from "../src/index";
import { DEV_1, TENANT_A, TENANT_B, T0, T1, rule } from "./helpers";

const actionCondition = { kind: "action", actions: { in: ["file.upload"] } } as const;

describe("D2: deterministic rule ids", () => {
  test("the same (tenant, name) always yields the same id", () => {
    const a = rule(TENANT_A, { name: "block-confidential-external-ai", condition: actionCondition, effect: "BLOCK", at: T0 });
    const b = rule(TENANT_A, { name: "block-confidential-external-ai", condition: actionCondition, effect: "WARN", at: T1 });
    // Identity is (tenant, name) — NOT content: same id across different effects.
    expect(a.ruleId).toBe(b.ruleId);
    expect(a.ruleId).toBe(guardianRuleId(TENANT_A, "block-confidential-external-ai"));
  });

  test("different names or tenants yield different ids", () => {
    const a = rule(TENANT_A, { name: "rule-one", condition: actionCondition, effect: "WARN", at: T0 });
    const b = rule(TENANT_A, { name: "rule-two", condition: actionCondition, effect: "WARN", at: T0 });
    const c = rule(TENANT_B, { name: "rule-one", condition: actionCondition, effect: "WARN", at: T0 });
    expect(a.ruleId === b.ruleId).toBe(false);
    expect(a.ruleId === c.ruleId).toBe(false);
  });

  test("rule ids carry the pol_ prefix of the frozen PolicyId grammar", () => {
    const a = rule(TENANT_A, { name: "x", condition: actionCondition, effect: "WARN", at: T0 });
    expect(a.ruleId.startsWith("pol_")).toBe(true);
  });
});

describe("D2: rule definition validation", () => {
  test("rejects an empty name", () => {
    const built = defineGuardianRule(TENANT_A, { name: "", condition: actionCondition, effect: "WARN", at: T0 });
    expect(built.ok).toBe(false);
  });

  test("rejects an unknown effect", () => {
    const built = defineGuardianRule(TENANT_A, {
      name: "x",
      condition: actionCondition,
      effect: "MAYBE" as never,
      at: T0,
    });
    expect(built.ok).toBe(false);
  });

  test("rejects a non-ISO timestamp", () => {
    const built = defineGuardianRule(TENANT_A, { name: "x", condition: actionCondition, effect: "WARN", at: "yesterday" });
    expect(built.ok).toBe(false);
  });

  test("rejects an unknown condition kind", () => {
    const failures: { path: string; reason: string }[] = [];
    validateRuleCondition({ kind: "vibes" }, "/condition", failures);
    expect(failures.length > 0).toBe(true);
    expect(failures[0]?.reason).toBe("unknown_condition_kind");
  });

  test("rejects matchers with neither in nor notIn", () => {
    const failures: { path: string; reason: string }[] = [];
    validateRuleCondition({ kind: "network", zones: {} }, "/condition", failures);
    expect(failures[0]?.reason).toBe("in_or_notIn_required");
  });

  test("rejects an empty allOf", () => {
    const failures: { path: string; reason: string }[] = [];
    validateRuleCondition({ kind: "allOf", conditions: [] }, "/condition", failures);
    expect(failures[0]?.reason).toBe("non_empty_array_required");
  });

  test("rejects malformed hour windows and weekdays", () => {
    const failures: { path: string; reason: string }[] = [];
    validateRuleCondition(
      { kind: "time", withinHoursUtc: { from: 10, to: 3 }, weekdaysUtc: [9] },
      "/condition",
      failures,
    );
    const reasons = failures.map((f) => f.reason);
    expect(reasons).toContain("from_must_not_exceed_to");
    expect(reasons).toContain("day_0_6_required");
  });

  test("rejects a condition with no constraint at all", () => {
    const failures: { path: string; reason: string }[] = [];
    validateRuleCondition({ kind: "action" }, "/condition", failures);
    expect(failures[0]?.reason).toBe("at_least_one_constraint_required");
  });

  test("every condition kind in the table is a legal condition", () => {
    // The kinds array is the authoritative list; each kind has a minimal
    // valid condition and must be accepted with zero failures.
    const minimal: Record<string, unknown> = {
      principal: { kind: "principal", servicePrincipals: true },
      device: { kind: "device", minPostureStatus: "AT_RISK" },
      workload: { kind: "workload", workloadIds: { in: ["wl_testworkload01"] } },
      dataClassification: { kind: "dataClassification", classification: { in: ["CONFIDENTIAL"] } },
      contract: { kind: "contract", missingAnyObligations: ["ob.data-handling"] },
      destination: { kind: "destination", categories: { in: ["external-ai"] } },
      network: { kind: "network", zones: { notIn: ["corporate"] } },
      printer: { kind: "printer", unapprovedOnly: true },
      time: { kind: "time", withinHoursUtc: { from: 9, to: 17 } },
      geography: { kind: "geography", countryCodes: { notIn: ["US"] } },
      action: { kind: "action", actions: { in: ["file.upload"] } },
      allOf: { kind: "allOf", conditions: [{ kind: "action", actions: { in: ["file.upload"] } }] },
    };
    for (const kind of ALL_RULE_CONDITION_KINDS) {
      const failures: { path: string; reason: string }[] = [];
      validateRuleCondition(minimal[kind], "/condition", failures);
      expect(failures.length).toBe(0);
    }
    expect(Object.keys(minimal).length).toBe(ALL_RULE_CONDITION_KINDS.length);
  });
});

describe("D2: versioned rules (revision discipline)", () => {
  test("revision produces version + 1 with the same identity; the prior is untouched", () => {
    const v1 = rule(TENANT_A, { name: "restrict-removable-media", condition: actionCondition, effect: "WARN", at: T0 });
    const revised = reviseGuardianRule(v1, { effect: "BLOCK", at: T1 });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const v2 = revised.rule;
    expect(v2.ruleId).toBe(v1.ruleId);
    expect(v2.version).toBe(2);
    expect(v2.effect).toBe("BLOCK");
    expect(v2.revisedAt).toBe(T1);
    expect(v2.createdAt).toBe(T0);
    // The prior version is untouched (immutable records).
    expect(v1.version).toBe(1);
    expect(v1.effect).toBe("WARN");
    expect(v1.revisedAt).toBeUndefined();
  });

  test("content digest changes with content, not with revision timestamps", () => {
    const v1 = rule(TENANT_A, { name: "n", condition: actionCondition, effect: "WARN", at: T0 });
    const sameContent = reviseGuardianRule(v1, { description: "d", at: T1 });
    expect(sameContent.ok).toBe(true);
    if (sameContent.ok) {
      // description is not part of the content digest (identity/content split)
      expect(sameContent.rule.contentDigest).toBe(v1.contentDigest);
    }
    const changed = reviseGuardianRule(v1, { effect: "BLOCK", at: T1 });
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.rule.contentDigest === v1.contentDigest).toBe(false);
    }
  });

  test("revision without changes is rejected", () => {
    const v1 = rule(TENANT_A, { name: "n", condition: actionCondition, effect: "WARN", at: T0 });
    const revised = reviseGuardianRule(v1, { at: T1 });
    expect(revised.ok).toBe(false);
  });

  test("rules are frozen at construction", () => {
    const v1 = rule(TENANT_A, { name: "n", condition: actionCondition, effect: "WARN", at: T0 });
    expect(Object.isFrozen(v1)).toBe(true);
  });
});

describe("D2: versioned rule sets (deterministic compilation)", () => {
  function threeRules(): GuardianRule[] {
    return [
      rule(TENANT_A, { name: "c-rule", condition: actionCondition, effect: "WARN", at: T0 }),
      rule(TENANT_A, { name: "a-rule", condition: actionCondition, effect: "ALLOW", at: T0 }),
      rule(TENANT_A, { name: "b-rule", condition: actionCondition, effect: "BLOCK", at: T0 }),
    ];
  }

  test("member rules are sorted by ruleId regardless of input order", () => {
    const forward = compileGuardianRuleSet(TENANT_A, { rules: threeRules(), version: 1, at: T0 });
    const reversed = compileGuardianRuleSet(TENANT_A, { rules: [...threeRules()].reverse(), version: 1, at: T0 });
    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(JSON.stringify(forward.ruleSet)).toBe(JSON.stringify(reversed.ruleSet));
    const ids = forward.ruleSet.rules.map((r) => r.ruleId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test("duplicate rule ids are rejected", () => {
    const r1 = rule(TENANT_A, { name: "same-name", condition: actionCondition, effect: "WARN", at: T0 });
    const r2 = rule(TENANT_A, { name: "same-name", condition: actionCondition, effect: "BLOCK", at: T1 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r1, r2], version: 1, at: T0 });
    expect(compiled.ok).toBe(false);
  });

  test("cross-tenant members are rejected", () => {
    const foreign = rule(TENANT_B, { name: "b-rule", condition: actionCondition, effect: "WARN", at: T0 });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [foreign], version: 1, at: T0 });
    expect(compiled.ok).toBe(false);
  });

  test("rule-set ids and digests are deterministic functions of content", () => {
    const a = compileGuardianRuleSet(TENANT_A, { rules: threeRules(), version: 1, at: T0 });
    const b = compileGuardianRuleSet(TENANT_A, { rules: [...threeRules()].reverse(), version: 1, at: T1 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Different compile timestamps, identical content + version -> identical ids.
    expect(a.ruleSet.ruleSetId).toBe(b.ruleSet.ruleSetId);
    expect(a.ruleSet.contentDigest).toBe(b.ruleSet.contentDigest);
    // A new version changes the rule-set identity.
    const v2 = compileGuardianRuleSet(TENANT_A, { rules: threeRules(), version: 2, at: T0 });
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.ruleSet.ruleSetId === a.ruleSet.ruleSetId).toBe(false);
      expect(v2.ruleSet.contentDigest).toBe(a.ruleSet.contentDigest); // member content unchanged
    }
  });

  test("invalid versions and timestamps are rejected", () => {
    expect(compileGuardianRuleSet(TENANT_A, { rules: [], version: 0, at: T0 }).ok).toBe(false);
    expect(compileGuardianRuleSet(TENANT_A, { rules: [], version: 1, at: "soon" }).ok).toBe(false);
  });

  test("rule sets are frozen", () => {
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: threeRules(), version: 1, at: T0 });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(Object.isFrozen(compiled.ruleSet)).toBe(true);
      expect(Object.isFrozen(compiled.ruleSet.rules)).toBe(true);
    }
  });
});
