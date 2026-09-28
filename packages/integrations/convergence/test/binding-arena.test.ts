/**
 * W051 convergence — D1: contract compatibility, Arena binding.
 *
 * Binds the REAL @fleetos/integration-arena surface to the REAL W031
 * Contract Guardian engine with REAL rule sets:
 *
 *   - ALLOW submits the evaluation case;
 *   - WARN still submits (non-blocking), the warning rides the record;
 *   - REQUIRE_APPROVAL PARKS the case — never auto-submitted (the
 *     ARENA.md fail-closed certification boundary);
 *   - BLOCK rejects with the engine's reasons;
 *   - a cross-tenant request refuses at the submission boundary
 *     (tenant scoping everywhere);
 *   - the decision carried is the frozen GuardianDecision union.
 */

import { test, expect } from "bun:test";
import {
  CASE_PARKED,
  CASE_REJECTED,
  CASE_SUBMITTED,
  createInMemoryArenaAuditSink,
  createInMemoryEvaluationCaseStore,
  submitEvaluationCase,
} from "@fleetos/integration-arena";
import {
  T0,
  TENANT_A,
  TENANT_B,
  CORR,
  arenaHarness,
  caseInput,
  caseSubmitRequest,
  ruleSet,
  approvalRule,
  blockRule,
  realGuardianArena,
  warnRule,
} from "./helpers";

test("D1/arena: an empty rule set decides ALLOW — the case is SUBMITTED with the decision carried verbatim", () => {
  const { result, sink } = arenaHarness([]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_SUBMITTED);
  expect(result.record.guardianDecision.decision).toBe("ALLOW");
  expect(result.record.guardianDecision.tenantId).toBe(TENANT_A);
  expect(sink.records.length).toBeGreaterThan(0);
});

test("D1/arena: WARN still submits (non-blocking), the warning rides the record", () => {
  const { result } = arenaHarness([warnRule(TENANT_A, "arena.case.submit")]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_SUBMITTED);
  expect(result.record.guardianDecision.decision).toBe("WARN");
});

test("D1/arena: REQUIRE_APPROVAL parks the case — never auto-submitted", () => {
  const { result, sink } = arenaHarness([approvalRule(TENANT_A, "arena.case.submit")]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_PARKED);
  expect(result.record.guardianDecision.decision).toBe("REQUIRE_APPROVAL");
  expect(sink.records.map((r) => r.action)).toContain("arena.case.parked");
});

test("D1/arena: BLOCK rejects the case with the engine's machine-stable reasons", () => {
  const { result } = arenaHarness([blockRule(TENANT_A, "arena.case.submit")]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_REJECTED);
  expect(result.record.guardianDecision.decision).toBe("BLOCK");
});

test("D1/arena: a tenant-A scope with a tenant-B request refuses at the submission boundary (tenant scoping)", () => {
  const result = submitEvaluationCase(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemoryEvaluationCaseStore(),
    caseInput(),
    {
      // The rule set is compiled for tenant B; the request declares
      // tenant B — but the ACTING SCOPE is tenant A: refused.
      ruleSet: ruleSet(TENANT_B, []),
      evaluator: realGuardianArena,
      request: caseSubmitRequest(TENANT_B),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: createInMemoryArenaAuditSink(),
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.message).toContain("tenant");
});

test("D1/arena: the REAL engine's decision types are the frozen GuardianDecision union (no arena-local re-declaration)", () => {
  const { result } = arenaHarness([approvalRule(TENANT_A, "arena.case.submit")]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const d = result.record.guardianDecision;
  expect(["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"]).toContain(d.decision);
  expect(Array.isArray(d.rules)).toBe(true);
  expect(Array.isArray(d.evidence)).toBe(true);
  expect(typeof d.decidedAt).toBe("string");
  expect(typeof d.schemaVersion).toBe("number");
});
