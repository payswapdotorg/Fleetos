/**
 * W031 D5 tests — contract conformance via @fleetos/contracts/testing
 * fixture builders: the frozen GuardianDecision decision types are
 * reused (never re-declared), makeGuardianDecision /
 * makeAllGuardianDecisions round-trip against the engine's outputs, and
 * the frozen decision-type tables agree with the engine's precedence
 * model.
 */

import { describe, expect, test } from "bun:test";
import {
  ALL_GUARDIAN_DECISION_TYPES,
  BLOCK,
  BLOCKING_DECISION_TYPES,
  REQUIRE_APPROVAL,
  WARN,
  isBlockingDecision,
  makeGuardianDecision as makeGuardianDecisionFixture,
} from "@fleetos/contracts";
import { ALLOW } from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  TESTING_MODULE_NAME,
  TESTING_MODULE_VERSION,
  makeAllGuardianDecisions,
  makeCorrelationId,
  makeGuardianDecision,
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  DECISION_PRECEDENCE_ORDER,
  DECISION_PRECEDENCE_RANK,
  GUARDIAN_DECISION_SCHEMA_VERSION,
  compileGuardianRuleSet,
  evaluateGuardianRequest,
} from "../src/index";
import { CORR, TENANT_A, T0, request, rule } from "./helpers";

describe("D5: the testing subpath imports cleanly", () => {
  test("the fixtures module identifies itself", () => {
    expect(TESTING_MODULE_NAME).toBe("contracts/testing");
    expect(TESTING_MODULE_VERSION).toBe("0.1.0");
  });

  test("fixture builders are deterministic", () => {
    expect(makeTenantId("w031")).toBe(makeTenantId("w031"));
    expect(makeTimestamp("w031")).toBe(makeTimestamp("w031"));
    expect(makePolicyId("w031")).toBe(makePolicyId("w031"));
    expect(makeCorrelationId("w031")).toBe(makeCorrelationId("w031"));
    expect(makeTimestamp("w031") >= FIXTURE_TIME_ANCHOR).toBe(true);
  });
});

describe("D5: the frozen Guardian decision types (reused, never re-declared)", () => {
  test("the engine emits exactly the frozen constants", () => {
    const rules = DECISION_PRECEDENCE_ORDER.map((effect, i) =>
      rule(TENANT_A, {
        name: `effect-${i}`,
        condition: { kind: "action", actions: { in: ["file.upload"] } },
        effect,
        at: T0,
      }),
    );
    const compiled = compileGuardianRuleSet(TENANT_A, { rules, version: 1, at: T0 });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    for (const single of rules) {
      const oneRuleSet = compileGuardianRuleSet(TENANT_A, { rules: [single], version: 1, at: T0 });
      if (!oneRuleSet.ok) continue;
      const result = evaluateGuardianRequest(oneRuleSet.ruleSet, request(), {
        at: T0,
        correlationId: CORR,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // The emitted decision type IS the frozen constant (identity check).
        expect(
          [ALLOW, WARN, REQUIRE_APPROVAL, BLOCK].includes(result.evaluation.decision.decision),
        ).toBe(true);
      }
    }
  });

  test("the frozen tables drive the engine's precedence model", () => {
    // ALL_GUARDIAN_DECISION_TYPES covers exactly the four types.
    expect(ALL_GUARDIAN_DECISION_TYPES).toEqual(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]);
    // BLOCKING_DECISION_TYPES is exactly the blocking pair.
    expect(BLOCKING_DECISION_TYPES).toEqual(["REQUIRE_APPROVAL", "BLOCK"]);
    // Every blocking type outranks every non-blocking type in the engine.
    for (const blocking of BLOCKING_DECISION_TYPES) {
      for (const nonBlocking of ALL_GUARDIAN_DECISION_TYPES) {
        if (blocking === nonBlocking) continue;
        const isBlockingPair = BLOCKING_DECISION_TYPES.includes(
          nonBlocking as (typeof BLOCKING_DECISION_TYPES)[number],
        );
        if (isBlockingPair) continue;
        expect(DECISION_PRECEDENCE_RANK[blocking] > DECISION_PRECEDENCE_RANK[nonBlocking]).toBe(true);
      }
    }
  });

  test("isBlockingDecision (frozen helper) agrees with the engine's emission policy", () => {
    expect(isBlockingDecision(BLOCK)).toBe(true);
    expect(isBlockingDecision(REQUIRE_APPROVAL)).toBe(true);
    expect(isBlockingDecision(WARN)).toBe(false);
    expect(isBlockingDecision(ALLOW)).toBe(false);
  });
});

describe("D5: makeGuardianDecision / makeAllGuardianDecisions fixtures", () => {
  test("the fixture default is a frozen ALLOW decision with one synthetic rule", () => {
    const decision = makeGuardianDecision({ seed: 7 });
    expect(decision.decision).toBe(ALLOW);
    expect(decision.rules).toHaveLength(1);
    expect(decision.evidence).toHaveLength(0);
    expect(decision.schemaVersion).toBe(1);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(typeof decision.decidedAt).toBe("string");
  });

  test("makeAllGuardianDecisions produces one decision per type, same tenant", () => {
    const all = makeAllGuardianDecisions("w031");
    expect(all).toHaveLength(4);
    expect(all.map((d) => d.decision)).toEqual(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]);
    const tenants = new Set(all.map((d) => d.tenantId));
    expect(tenants.size).toBe(1);
    // Every fixture decision carries the frozen shape's keys exactly.
    for (const decision of all) {
      expect(Object.keys(decision).sort()).toEqual([
        "decidedAt",
        "decision",
        "evidence",
        "rules",
        "schemaVersion",
        "tenantId",
      ]);
      // RuleRefs carry exactly { ruleId, ruleVersion }.
      for (const ref of decision.rules) {
        expect(Object.keys(ref).sort()).toEqual(["ruleId", "ruleVersion"]);
      }
    }
  });

  test("the engine's decisions are byte-identical to fixture decisions built from the same inputs", () => {
    const r = rule(TENANT_A, {
      name: "conformance-rule",
      condition: { kind: "action", actions: { in: ["file.upload"] } },
      effect: "REQUIRE_APPROVAL",
      at: T0,
    });
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [r], version: 3, at: T0 });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = evaluateGuardianRequest(compiled.ruleSet, request(), {
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const engineDecision = result.evaluation.decision;
    const fixtureDecision = makeGuardianDecisionFixture({
      tenantId: TENANT_A,
      decision: "REQUIRE_APPROVAL",
      rules: [{ ruleId: r.ruleId, ruleVersion: 1 }],
      evidence: [],
      decidedAt: T0,
      schemaVersion: GUARDIAN_DECISION_SCHEMA_VERSION,
    });
    expect(JSON.stringify(engineDecision)).toBe(JSON.stringify(fixtureDecision));
  });

  test("fixture policy ids are structurally valid rule ids for decisions", () => {
    const id = makePolicyId("w031");
    expect(typeof id).toBe("string");
    expect(id.startsWith("pol_")).toBe(true);
    const decision = makeGuardianDecision({
      seed: "w031",
      decision: "BLOCK",
      rules: [{ ruleId: id, ruleVersion: 2 }],
    });
    expect(decision.rules[0]?.ruleId).toBe(id);
    expect(decision.rules[0]?.ruleVersion).toBe(2);
  });
});
