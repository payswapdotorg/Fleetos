/**
 * W090B binding tests — the REAL `@fleetos/policy` records bind the
 * Policies surface's structural seams (the W040/W060-disclosed
 * pattern, proven by test). Dev-scope imports are TEST-SCOPE ONLY;
 * src/ imports the shared seam `@fleetos/contracts` exclusively.
 *
 *   - REAL `defineGuardianRule` + `reviseGuardianRule` +
 *     `compileGuardianRuleSet` feed the policies list + detail views
 *     (the versioned rule history and the compiled frozen surface);
 *   - REAL `evaluateGuardianRequest` decisions feed the decision
 *     history view;
 *   - the canonical condition summary is machine-stable (sorted keys);
 *   - the fail-closed discipline holds: cross-tenant records REFUSE.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId } from "@fleetos/contracts";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
  reviseGuardianRule,
} from "@fleetos/policy";
import type { GuardianRuleSet } from "@fleetos/policy";
import {
  buildPoliciesListView,
  buildPolicyDecisionHistoryView,
  buildPolicyDetailView,
} from "../src/index";
import { TENANT_A, scopeA } from "./helpers";
import { makeTenantId } from "@fleetos/contracts/testing";

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";

/** Build a REAL compiled rule set with one revised (v2) REQUIRE_APPROVAL rule. */
function realRuleSet(): GuardianRuleSet {
  const built = defineGuardianRule(TENANT_A, {
    name: "w090b-bind-policy",
    description: "The binding fixture rule",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: AT,
  });
  if (!built.ok) throw new Error(built.error.message);
  const revised = reviseGuardianRule(built.rule, {
    at: AT2,
    description: "The revised binding fixture rule",
  });
  if (!revised.ok) throw new Error(revised.error.message);
  const compiled = compileGuardianRuleSet(TENANT_A, {
    rules: [revised.rule],
    version: 2,
    at: AT2,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  // STRUCTURAL BINDING: the REAL GuardianRuleSet flows into the seam.
  return compiled.ruleSet;
}

describe("binding: the REAL policy rule sets feed the policies views", () => {
  test("a real compiled rule set lists with derived rule/effect counts", () => {
    const ruleSet = realRuleSet();
    const view = buildPoliciesListView(scopeA(), [ruleSet]);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(1);
    expect(view.view.ruleTotal).toBe(1);
    const item = view.view.items[0];
    expect(item?.ruleSetId).toBe(ruleSet.ruleSetId);
    expect(item?.version).toBe(2);
    expect(item?.ruleCount).toBe(1);
    expect(item?.enabledCount).toBe(1);
    expect(item?.effectCounts.REQUIRE_APPROVAL).toBe(1);
    expect(item?.effectCounts.BLOCK).toBe(0);
  });

  test("a real rule set details with the versioned rule + the machine-stable condition summary", () => {
    const ruleSet = realRuleSet();
    const view = buildPolicyDetailView(scopeA(), ruleSet);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.rules.length).toBe(1);
    const rule = view.view.rules[0];
    expect(rule?.version).toBe(2);
    expect(rule?.revisedAt).toBe(AT2);
    expect(rule?.conditionKind).toBe("action");
    // The canonical condition summary is machine-stable: sorted keys,
    // identical across calls (the same condition always summarizes
    // identically).
    const again = buildPolicyDetailView(scopeA(), realRuleSet());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.view.rules[0]?.conditionSummary).toBe(rule?.conditionSummary);
    expect(rule?.conditionSummary).toContain("\"kind\":\"action\"");
  });

  test("a tenant-B scope REFUSES a real tenant-A rule set (cross-tenant fail-closed)", () => {
    const view = buildPoliciesListView({ tenantId: makeTenantId("w090b-other") }, [realRuleSet()]);
    expect(view.ok).toBe(false);
    if (view.ok) return;
    expect(view.error.code).toBe("surface.tenant_mismatch");
  });
});

describe("binding: REAL Guardian decisions feed the decision history view", () => {
  test("real evaluations land in the read-only history with canonical refs", () => {
    const ruleSet = realRuleSet();
    const first = evaluateGuardianRequest(
      ruleSet,
      { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
      { at: AT2, correlationId: asCorrelationId("cor_w090b_bind_1") },
    );
    if (!first.ok) throw new Error(first.error.message);
    const view = buildPolicyDecisionHistoryView(scopeA(), [first.evaluation.decision]);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(1);
    expect(view.view.decisionCounts.REQUIRE_APPROVAL).toBe(1);
    const row = view.view.items[0];
    expect(row?.decision).toBe("REQUIRE_APPROVAL");
    expect(row?.rules).toEqual(first.evaluation.decision.rules);
    expect(row?.canonicalRef).toMatch(/^gdref_/);
  });

  test("the history orders machine-stably (decidedAt asc, canonicalRef asc)", () => {
    const ruleSet = realRuleSet();
    const mk = (at: string, action: string) => {
      const result = evaluateGuardianRequest(
        ruleSet,
        { tenantId: TENANT_A, action: { action } },
        { at, correlationId: asCorrelationId("cor_w090b_bind_2") },
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.evaluation.decision;
    };
    const earlier = mk(AT, "fleet.action.execute");
    const later = mk(AT2, "document.print");
    // Input order deliberately reversed — output order must not care.
    const view = buildPolicyDecisionHistoryView(scopeA(), [later, earlier]);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.items.map((row) => row.decidedAt)).toEqual([earlier.decidedAt, later.decidedAt]);
  });
});
