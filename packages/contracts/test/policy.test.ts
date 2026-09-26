import { test, expect } from "bun:test";
import {
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
  ALL_GUARDIAN_DECISION_TYPES,
  BLOCKING_DECISION_TYPES,
  isBlockingDecision,
  makeGuardianDecision,
  type GuardianDecision,
  type GuardianDecisionType,
} from "../src/policy";
import { asTenantId, asPolicyId } from "../src/ids";

test("ALL_GUARDIAN_DECISION_TYPES contains exactly the four decision types from spec/ARCHITECTURE.md", () => {
  expect(ALL_GUARDIAN_DECISION_TYPES).toEqual([ALLOW, WARN, REQUIRE_APPROVAL, BLOCK]);
  expect(ALL_GUARDIAN_DECISION_TYPES.length).toBe(4);
});

test("BLOCKING_DECISION_TYPES contains REQUIRE_APPROVAL and BLOCK only", () => {
  expect(BLOCKING_DECISION_TYPES).toEqual([REQUIRE_APPROVAL, BLOCK]);
});

test("isBlockingDecision: returns true for blocking decisions, false for ALLOW/WARN", () => {
  const dt = (s: string): GuardianDecisionType => s as GuardianDecisionType;
  expect(isBlockingDecision(dt("ALLOW"))).toBe(false);
  expect(isBlockingDecision(dt("WARN"))).toBe(false);
  expect(isBlockingDecision(dt("REQUIRE_APPROVAL"))).toBe(true);
  expect(isBlockingDecision(dt("BLOCK"))).toBe(true);
});

test("makeGuardianDecision returns a frozen record with copied rules and evidence", () => {
  const decision = makeGuardianDecision({
    tenantId: asTenantId("tnt_abc12345"),
    decision: BLOCK,
    rules: [{ ruleId: asPolicyId("pol_001"), ruleVersion: 1 }],
    evidence: [
      { key: "evidence/abc", sizeBytes: 1024, hash: "deadbeef", hashAlgorithm: "sha256" },
    ],
    decidedAt: "2026-09-26T12:00:00Z",
    schemaVersion: 1,
  });
  expect(Object.isFrozen(decision)).toBe(true);
  expect(Object.isFrozen(decision.rules)).toBe(true);
  expect(Object.isFrozen(decision.evidence)).toBe(true);
  expect(decision.decision).toBe("BLOCK");
  expect(decision.rules.length).toBe(1);
  expect(decision.evidence.length).toBe(1);
});

test("GuardianDecision shape: required fields are present", () => {
  const decision: GuardianDecision = makeGuardianDecision({
    tenantId: asTenantId("tnt_abc12345"),
    decision: REQUIRE_APPROVAL,
    rules: [],
    evidence: [],
    decidedAt: "2026-09-26T12:00:00Z",
    schemaVersion: 1,
  });
  expect(decision.tenantId).toBe("tnt_abc12345");
  expect(decision.decision).toBe("REQUIRE_APPROVAL");
  expect(decision.rules).toEqual([]);
  expect(decision.evidence).toEqual([]);
  expect(decision.decidedAt).toBe("2026-09-26T12:00:00Z");
  expect(decision.schemaVersion).toBe(1);
});
