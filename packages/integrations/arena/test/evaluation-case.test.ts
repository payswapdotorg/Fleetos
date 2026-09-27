/**
 * W050B arena — D5 tests: the evaluation-case submission flow.
 *
 * Covers the full D1 surface: validation failures, idempotent re-
 * submission, the append-only ledger's revision discipline, and the
 * case payload's typed shape (problemClass, observationRefs, context,
 * actionHistoryRefs, outcome, labels, tenantPolicyRefs, redaction).
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId } from "@fleetos/contracts";
import {
  submitEvaluationCase,
  createInMemoryEvaluationCaseStore,
  createInMemoryArenaAuditSink,
  CASE_SUBMITTED,
  CASE_PARKED,
  CASE_REJECTED,
  ALL_EVALUATION_CASE_STATUSES,
  ALL_REDACTION_STATES,
  evaluationCaseId,
  evaluationCaseRecordId,
  evaluationCaseContentDigest,
  decisionToCaseStatus,
  type EvaluationCaseRecord,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  USER_1,
  CORR,
  scopeA,
  realGuardian,
  ruleSet,
  warnRule,
  approvalRule,
  blockRule,
  caseSubmitRequest,
  caseInput,
  outcome,
  label,
  redaction,
  evidenceRef,
} from "./helpers";

test("the case payload carries every required field verbatim (problemClass, observationRefs, context, actionHistoryRefs, outcome, labels, tenantPolicyRefs, redaction)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({
    problemClass: "device.security.anomaly",
    observationRefs: ["obs/a", "obs/b", "obs/c"],
    context: { device: "dev_a1", fleet: "fleet-1", region: "us-east-1" },
    actionHistoryRefs: ["int/a", "int/b"],
    outcome: outcome("true_positive", "anomaly_confirmed"),
    labels: [label("severity", "critical"), label("cohort", "canary-1")],
    tenantPolicyRefs: ["policy/tenant-a-v1", "policy/redaction-v1"],
    redaction: redaction("deidentified"),
  });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const r = result.record;
  expect(r.problemClass).toBe("device.security.anomaly");
  expect(r.observationRefs).toEqual(["obs/a", "obs/b", "obs/c"]);
  expect(r.context).toEqual({ device: "dev_a1", fleet: "fleet-1", region: "us-east-1" });
  expect(r.actionHistoryRefs).toEqual(["int/a", "int/b"]);
  expect(r.outcome.label).toBe("true_positive");
  expect(r.outcome.value).toBe("anomaly_confirmed");
  expect(r.outcome.observedAt).toBe(T0);
  expect(r.outcome.evidenceRefs).toEqual([evidenceRef()]);
  expect(r.labels).toEqual([label("severity", "critical"), label("cohort", "canary-1")]);
  expect(r.tenantPolicyRefs).toEqual(["policy/tenant-a-v1", "policy/redaction-v1"]);
  expect(r.redaction.state).toBe("deidentified");
  expect(r.redaction.appliedPolicies).toEqual(["policy/deidentify-v1"]);
});

test("validation: a missing problemClass is refused with a ValidationError", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({ problemClass: "" });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("ValidationError");
  expect(result.error.code).toBe("arena.case.invalid_request");
  expect(result.error.failures.find((f) => f.path === "/problemClass")).toBeDefined();
});

test("validation: an empty observationRefs array is refused (string_array_required)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({ observationRefs: [] });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/observationRefs")).toBeDefined();
});

test("validation: a non-string observation ref is refused", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({
    observationRefs: ["obs/a", null as unknown as string, "obs/c"],
  });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/observationRefs")).toBeDefined();
});

test("validation: a missing outcome is refused (object_required)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  // Build the input directly (without going through caseInput — the
  // `??` default in the helper masks `undefined`).
  const input = {
    problemClass: "device.test",
    observationRefs: ["obs/a"],
    context: { device: "dev_a1" },
    actionHistoryRefs: ["int/a"],
    labels: [label()],
    tenantPolicyRefs: ["policy/a"],
    redaction: redaction(),
    // outcome is OMITTED — the validator should reject.
  };
  const result = submitEvaluationCase(scopeA(), store, input as never, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/outcome")).toBeDefined();
});

test("validation: an outcome missing observedAt is refused (not_iso)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({
    outcome: {
      label: "true_positive",
      value: "battery_aged",
      observedAt: "not-an-iso",
      evidenceRefs: [],
    },
  });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/outcome/observedAt")).toBeDefined();
});

test("validation: an unknown redaction state is refused (unknown_redaction_state)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput({
    redaction: { state: "unknown_state" as never, appliedPolicies: [] },
  });
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/redaction/state")).toBeDefined();
});

test("validation: a missing correlationId is refused (required)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: "" as never },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.failures.find((f) => f.path === "/guardianOptions/correlationId")).toBeDefined();
});

test("the case revision's recordId is a deterministic digest of (caseId, version)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const expected = evaluationCaseRecordId(result.record.caseId, 1);
  expect(result.record.recordId).toBe(expected);
  expect(result.record.recordId.startsWith("arcv_")).toBe(true);
});

test("the case content digest is a deterministic digest of all content fields (identity fields excluded)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  const result = submitEvaluationCase(scopeA(), store, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // The content digest excludes caseId/recordId/contentDigest itself.
  // Re-compute from the record's content fields and verify it matches.
  const { caseId, recordId, contentDigest, ...content } = result.record;
  void caseId;
  void recordId;
  void contentDigest;
  const recomputed = evaluationCaseContentDigest(content);
  expect(recomputed).toBe(result.record.contentDigest);
});

test("ALL_EVALUATION_CASE_STATUSES is the closed union (machine-stable, frozen)", () => {
  expect(ALL_EVALUATION_CASE_STATUSES).toEqual(["SUBMITTED", "PARKED", "REJECTED"]);
});

test("ALL_REDACTION_STATES is the closed union (machine-stable, frozen)", () => {
  expect(ALL_REDACTION_STATES).toEqual(["raw", "deidentified", "redacted"]);
});

test("decisionToCaseStatus: every Guardian decision type maps to a case status (exhaustive)", () => {
  expect(decisionToCaseStatus("ALLOW")).toBe(CASE_SUBMITTED);
  expect(decisionToCaseStatus("WARN")).toBe(CASE_SUBMITTED);
  expect(decisionToCaseStatus("REQUIRE_APPROVAL")).toBe(CASE_PARKED);
  expect(decisionToCaseStatus("BLOCK")).toBe(CASE_REJECTED);
});

test("the case record is FROZEN (defense in depth — mutation attempts are no-ops in strict mode)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const result = submitEvaluationCase(scopeA(), store, caseInput(), {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // Object.isFrozen returns true for the record and its frozen sub-trees.
  expect(Object.isFrozen(result.record)).toBe(true);
  expect(Object.isFrozen(result.record.observationRefs)).toBe(true);
  expect(Object.isFrozen(result.record.actionHistoryRefs)).toBe(true);
  expect(Object.isFrozen(result.record.labels)).toBe(true);
  expect(Object.isFrozen(result.record.tenantPolicyRefs)).toBe(true);
  expect(Object.isFrozen(result.record.redaction)).toBe(true);
});

test("the audit emission for a SUBMITTED case carries the rule-set identity and matched-rule ids", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [warnRule(TENANT_A, "arena.case.submit")], 5);
  submitEvaluationCase(scopeA(), store, caseInput(), {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
    auditSink: sink,
  });
  expect(sink.records.length).toBe(1);
  const details = sink.records[0].details as Record<string, unknown>;
  expect(details["ruleSetId"]).toBe(rs.ruleSetId);
  expect(details["ruleSetVersion"]).toBe(5);
  expect(Array.isArray(details["matchedRuleIds"])).toBe(true);
  expect((details["matchedRuleIds"] as readonly string[]).length).toBe(1);
});

test("the audit emission for a REJECTED case carries the BLOCK decision's machine-stable reasons", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [blockRule(TENANT_A, "arena.case.submit")]);
  submitEvaluationCase(scopeA(), store, caseInput(), {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
    auditSink: sink,
  });
  expect(sink.records.length).toBe(1);
  const details = sink.records[0].details as Record<string, unknown>;
  expect(details["decision"]).toBe("BLOCK");
  expect(details["isBlocking"]).toBe(true);
  expect(Array.isArray(details["reasons"])).toBe(true);
});

test("the redaction state is carried verbatim through the audit emission", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, []);
  submitEvaluationCase(scopeA(), store, caseInput({ redaction: redaction("redacted") }), {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
    auditSink: sink,
  });
  expect(sink.records[0].details.redactionState).toBe("redacted");
});
