/**
 * W060B D2 tests — the Contract Guardian decision surface:
 * ALLOW/WARN/REQUIRE_APPROVAL/BLOCK presented with the engine's
 * machine-stable reasons, matched rules and OPAQUE evidence refs; the
 * read-only BLOCK history with machine-stable ordering; LOCK 11
 * (observable evidence only — never an intent assertion); tenant
 * discipline; determinism.
 */

import { describe, expect, test } from "bun:test";
import {
  buildBlockHistoryView,
  presentGuardianDecision,
  DECISION_PRECEDENCE_RANK_VIEW,
  isBlockingDecisionView,
  type BlockHistoryView,
  type GuardianDecisionPresentationView,
} from "../src/guardian-decision-view";
import type { SurfaceResult } from "../src/internal";
import type { GuardianDecisionRecord, GuardianMatchedRuleView } from "../src/surface-contracts";
import type { PolicyId } from "@fleetos/contracts";
import {
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  T2,
  decision,
  evidenceRef,
  evaluation,
  reason,
  ruleRef,
  scopeA,
} from "./helpers";

function presented(
  result: SurfaceResult<GuardianDecisionPresentationView>,
): GuardianDecisionPresentationView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

function history(result: SurfaceResult<BlockHistoryView>): BlockHistoryView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

describe("D2: all four decision types are presented with their observable context", () => {
  test("ALLOW presentation carries decision, blocking flag, precedence and timestamps", () => {
    const view = presented(
      presentGuardianDecision(scopeA(), evaluation({ decision: decision({ decision: "ALLOW" }) })),
    );
    expect(view.decision).toBe("ALLOW");
    expect(view.isBlocking).toBe(false);
    expect(view.precedenceRank).toBe(DECISION_PRECEDENCE_RANK_VIEW.ALLOW);
    expect(view.decidedAt).toBe(T1);
    expect(view.schemaVersion).toBe(1);
    expect(view.ruleSetId).toBe("w060b-ruleset");
    expect(view.ruleSetVersion).toBe(1);
    expect(view.tenantId).toBe(TENANT_A);
  });

  test("WARN is non-blocking (surfaces the warning, does not hold)", () => {
    const view = presented(
      presentGuardianDecision(scopeA(), evaluation({ decision: decision({ decision: "WARN" }) })),
    );
    expect(view.decision).toBe("WARN");
    expect(view.isBlocking).toBe(false);
  });

  test("REQUIRE_APPROVAL is blocking (the parked-approval gate)", () => {
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "REQUIRE_APPROVAL" }) }),
      ),
    );
    expect(view.decision).toBe("REQUIRE_APPROVAL");
    expect(view.isBlocking).toBe(true);
  });

  test("BLOCK is blocking (the refusal)", () => {
    const view = presented(
      presentGuardianDecision(scopeA(), evaluation({ decision: decision({ decision: "BLOCK" }) })),
    );
    expect(view.decision).toBe("BLOCK");
    expect(view.isBlocking).toBe(true);
  });

  test("isBlockingDecisionView mirrors the frozen contracts semantics", () => {
    expect(isBlockingDecisionView("ALLOW")).toBe(false);
    expect(isBlockingDecisionView("WARN")).toBe(false);
    expect(isBlockingDecisionView("REQUIRE_APPROVAL")).toBe(true);
    expect(isBlockingDecisionView("BLOCK")).toBe(true);
  });

  test("the precedence table is the engine's blocking precedence (BLOCK > REQUIRE_APPROVAL > WARN > ALLOW)", () => {
    expect(DECISION_PRECEDENCE_RANK_VIEW.BLOCK).toBeGreaterThan(
      DECISION_PRECEDENCE_RANK_VIEW.REQUIRE_APPROVAL,
    );
    expect(DECISION_PRECEDENCE_RANK_VIEW.REQUIRE_APPROVAL).toBeGreaterThan(
      DECISION_PRECEDENCE_RANK_VIEW.WARN,
    );
    expect(DECISION_PRECEDENCE_RANK_VIEW.WARN).toBeGreaterThan(DECISION_PRECEDENCE_RANK_VIEW.ALLOW);
  });
});

describe("D2: reasons, matched rules and evidence surface verbatim", () => {
  test("the engine's machine-stable reasons pass through VERBATIM in engine order", () => {
    const reasons = [
      reason({ code: "policy.rule.matched", effect: "BLOCK", conditionKind: "action" }),
      reason({ code: "policy.precedence.resolved", chosen: "BLOCK" }),
    ];
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "BLOCK" }), reasons }),
      ),
    );
    expect(view.reasons).toEqual(reasons);
    expect(view.reasons[0]?.code).toBe("policy.rule.matched");
    expect(view.reasons[1]?.code).toBe("policy.precedence.resolved");
    expect(view.reasons[1]?.chosen).toBe("BLOCK");
  });

  test("matched rules are projected in the engine's order (ruleId identity + version + effect)", () => {
    const matchedRules: readonly GuardianMatchedRuleView[] = [
      { ruleId: "pol_w060b_r1" as PolicyId, name: "block-wipe-rule", version: 2, effect: "BLOCK" },
      { ruleId: "pol_w060b_r2" as PolicyId, name: "require-approval-rule", version: 1, effect: "REQUIRE_APPROVAL" },
    ];
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "BLOCK" }), matchedRules }),
      ),
    );
    expect(view.matchedRules).toEqual(matchedRules);
    expect(view.matchedRules[0]?.ruleId).toBe("pol_w060b_r1");
    expect(view.matchedRules[0]?.version).toBe(2);
    expect(view.matchedRules[0]?.effect).toBe("BLOCK");
  });

  test("evidence refs are OPAQUE (the frozen contracts shape passes through untouched)", () => {
    const evidence = [evidenceRef("evidence/w060b-alpha"), evidenceRef("evidence/w060b-beta")];
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "BLOCK", evidence }) }),
      ),
    );
    expect(view.evidence).toEqual(evidence);
    expect(view.evidence[0]?.key).toBe("evidence/w060b-alpha");
    expect(view.evidence[0]?.hashAlgorithm).toBe("sha256");
    expect(view.evidence[0]?.sizeBytes).toBe(128);
  });

  test("the decision's own rule refs (the frozen contracts rules list) pass through verbatim", () => {
    const rules = [ruleRef("w060b-r1", 4), ruleRef("w060b-r2", 1)];
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "BLOCK", rules }) }),
      ),
    );
    expect(view.rules).toEqual(rules);
  });
});

describe("D2: the presentation asserts NO unobservable intent (LOCK 11)", () => {
  test("the serialized presentation carries only observable field names", () => {
    const view = presented(
      presentGuardianDecision(scopeA(), evaluation({ decision: decision({ decision: "BLOCK" }) })),
    );
    const serialized = JSON.stringify(view);
    for (const forbidden of ["intent", "Intent", "employee", "motivation", "belief", "assumed"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  test("every string key reachable in the presentation is an observable name", () => {
    const view = presented(
      presentGuardianDecision(
        scopeA(),
        evaluation({ decision: decision({ decision: "REQUIRE_APPROVAL" }) }),
      ),
    );
    const keys = new Set<string>();
    collectKeys(view, keys);
    const observable = new Set([
      "tenantId", "decision", "isBlocking", "precedenceRank", "decidedAt", "schemaVersion",
      "ruleSetId", "ruleSetVersion", "reasons", "matchedRules", "evidence", "rules",
      "code", "ruleId", "ruleVersion", "conditionKind", "effect", "chosen",
      "name", "version", "key", "sizeBytes", "hash", "hashAlgorithm",
    ]);
    for (const key of keys) {
      expect(observable.has(key)).toBe(true);
    }
  });
});

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys((value as Record<string, unknown>)[key], keys);
    }
  }
}

describe("D2: the BLOCK history is read-only and machine-stably ordered", () => {
  test("only BLOCK decisions belong to the block history (the builder refuses the rest)", () => {
    const result = buildBlockHistoryView(scopeA(), [
      decision({ decision: "BLOCK", decidedAt: T1 }),
      decision({ decision: "ALLOW", decidedAt: T2 }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.decision_invalid");
    expect(result.error.failures[0]?.path).toBe("/decisions/1");
    expect(result.error.failures[0]?.reason).toBe("decision_not_block");
  });

  test("BLOCK decisions are ordered by decidedAt asc, then canonical digest asc (ties break machine-stably)", () => {
    const a = decision({ decision: "BLOCK", decidedAt: T1, rules: [ruleRef("w060b-b1")] });
    const b = decision({ decision: "BLOCK", decidedAt: T0, rules: [ruleRef("w060b-b0")] });
    const c = decision({ decision: "BLOCK", decidedAt: T2, rules: [ruleRef("w060b-b2")] });
    const view = history(buildBlockHistoryView(scopeA(), [a, c, b]));
    expect(view.total).toBe(3);
    expect(view.items.map((item) => item.decidedAt)).toEqual([T0, T1, T2]);
  });

  test("identical instants tie-break on the canonical digest (total order, input-order invariant)", () => {
    const a = decision({ decision: "BLOCK", decidedAt: T1, rules: [ruleRef("w060b-z")] });
    const b = decision({ decision: "BLOCK", decidedAt: T1, rules: [ruleRef("w060b-a")] });
    const viewA = history(buildBlockHistoryView(scopeA(), [a, b]));
    const viewB = history(buildBlockHistoryView(scopeA(), [b, a]));
    expect(JSON.stringify(viewA)).toBe(JSON.stringify(viewB));
    // The canonical refs are stable identities for the same decision.
    expect(viewA.items.map((i) => i.canonicalRef)).toEqual(viewB.items.map((i) => i.canonicalRef));
    expect(viewA.items[0]?.canonicalRef).not.toBe(viewA.items[1]?.canonicalRef);
  });

  test("each history row surfaces the decision's observable fields + a canonical ref", () => {
    const rules = [ruleRef("w060b-hist", 3)];
    const evidence = [evidenceRef("evidence/w060b-hist")];
    const view = history(
      buildBlockHistoryView(scopeA(), [
        decision({ decision: "BLOCK", decidedAt: T1, rules, evidence }),
      ]),
    );
    const row = view.items[0];
    expect(row?.decision).toBe("BLOCK");
    expect(row?.decidedAt).toBe(T1);
    expect(row?.rules).toEqual(rules);
    expect(row?.evidence).toEqual(evidence);
    expect(typeof row?.canonicalRef).toBe("string");
    expect((row?.canonicalRef ?? "").startsWith("gdref_")).toBe(true);
  });

  test("the block history view is read-only (deeply frozen)", () => {
    const view = history(
      buildBlockHistoryView(scopeA(), [decision({ decision: "BLOCK", decidedAt: T1 })]),
    );
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.items)).toBe(true);
    expect(Object.isFrozen(view.items[0])).toBe(true);
  });
});

describe("D2: tenant discipline and validation", () => {
  test("a cross-tenant evaluation REFUSES (fail-closed, never rendered)", () => {
    const result = presentGuardianDecision(
      scopeA(),
      evaluation({ decision: decision({ decision: "BLOCK", tenantId: TENANT_B }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.tenant_mismatch");
    expect(result.error.failures[0]?.path).toBe("/decision/tenantId");
  });

  test("a malformed evaluation refuses with a JSON-pointer path", () => {
    const result = presentGuardianDecision(
      scopeA(),
      evaluation({ decision: decision({ decision: "BLOCK" }), ruleSetVersion: 0 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.evaluation_invalid");
    expect(result.error.failures[0]?.path).toBe("/ruleSetVersion");
  });

  test("an unknown decision type in a bare record refuses with unknown_decision", () => {
    const bad = { ...decision({ decision: "BLOCK" }), decision: "MAYBE" } as unknown as GuardianDecisionRecord;
    const result = buildBlockHistoryView(scopeA(), [bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("unknown_decision");
  });

  test("a malformed evidence ref refuses (hash algorithm must be present)", () => {
    const evidence = [{ ...evidenceRef(), hashAlgorithm: "" }];
    const result = presentGuardianDecision(
      scopeA(),
      evaluation({ decision: decision({ decision: "BLOCK", evidence }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/decision/evidence/0/hashAlgorithm");
  });
});

describe("D2: determinism", () => {
  test("the same evaluation twice produces a byte-identical presentation", () => {
    const input = evaluation({ decision: decision({ decision: "REQUIRE_APPROVAL" }) });
    const a = presented(presentGuardianDecision(scopeA(), input));
    const b = presented(presentGuardianDecision(scopeA(), input));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the presentation is deeply frozen", () => {
    const view = presented(
      presentGuardianDecision(scopeA(), evaluation({ decision: decision({ decision: "ALLOW" }) })),
    );
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.reasons)).toBe(true);
    expect(Object.isFrozen(view.evidence)).toBe(true);
    expect(Object.isFrozen(view.matchedRules)).toBe(true);
  });
});
