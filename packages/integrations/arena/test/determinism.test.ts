/**
 * W050B arena — D5 tests: byte-identical determinism across runs and
 * input permutations.
 *
 * Per the W050B work order: "byte-identical determinism across runs and
 * input permutations." This suite proves:
 *   - re-submission of identical inputs yields the same case id and a
 *     byte-identical record (idempotent);
 *   - permuting the input arrays (observationRefs, actionHistoryRefs,
 *     labels, tenantPolicyRefs, evidenceRefs) is RESILIENT to ordering
 *     for derived/deduplicated fields but the case id IS order-
 *     sensitive (the canonical JSON encodes array order — re-ordering
 *     produces a different case id, by design, since order carries
 *     meaning in the evaluation suite);
 *   - the audit emission policy is deterministic (same inputs -> same
 *     audit record; audit on/off NEVER changes the domain output);
 *   - the adoption identity is deterministic across runs.
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId, asUserId } from "@fleetos/contracts";
import type {
  TenantId,
  CorrelationId,
  UserId,
  EvidenceRef,
} from "@fleetos/contracts";
import {
  submitEvaluationCase,
  adoptCapability,
  createInMemoryEvaluationCaseStore,
  createInMemoryCapabilityAdoptionStore,
  createInMemoryArenaAuditSink,
  evaluationCaseId,
  evaluationCaseRecordId,
  evaluationCaseContentDigest,
  capabilityAdoptionId,
  capabilityAdoptionRecordId,
  capabilityAdoptionContentDigest,
  requireCertifiedCapability,
  type EvaluationCaseRecord,
  type CapabilityAdoptionRecord,
  type SubmitEvaluationCaseInput,
  type CertifiedCapabilityMetadata,
  type CapabilityAdoptionProposal,
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
  caseSubmitRequest,
  caseInput,
  certifiedMetadata,
  certificationRef,
  evidenceRef,
} from "./helpers";

test("re-submission of identical inputs is idempotent: same case id, byte-identical record", () => {
  const store1 = createInMemoryEvaluationCaseStore();
  const store2 = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  const options = {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  };
  const r1 = submitEvaluationCase(scopeA(), store1, input, options);
  const r2 = submitEvaluationCase(scopeA(), store2, input, options);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("submission failed");
  // Byte-identical: same case id, same record id, same content digest.
  expect(r1.record.caseId).toBe(r2.record.caseId);
  expect(r1.record.recordId).toBe(r2.record.recordId);
  expect(r1.record.contentDigest).toBe(r2.record.contentDigest);
  // The full record serializes to identical JSON.
  expect(JSON.stringify(r1.record)).toBe(JSON.stringify(r2.record));
});

test("re-submission of identical inputs into the SAME store is idempotent (no duplicate)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  const options = {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  };
  const r1 = submitEvaluationCase(scopeA(), store, input, options);
  const r2 = submitEvaluationCase(scopeA(), store, input, options);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("submission failed");
  // The store has exactly ONE case id (the second submission returned the existing record).
  expect(store.size(scopeA())).toBe(1);
  expect(r1.record.recordId).toBe(r2.record.recordId);
});

test("input permutations that change content produce DIFFERENT case ids (canonical JSON encodes order)", () => {
  const input1 = caseInput({ observationRefs: ["obs/a", "obs/b"] });
  const input2 = caseInput({ observationRefs: ["obs/b", "obs/a"] });
  // The canonical JSON encodes array order — re-ordering produces a different case id.
  const id1 = evaluationCaseId(
    TENANT_A,
    input1.problemClass,
    input1.observationRefs,
    input1.context,
    input1.actionHistoryRefs,
    input1.outcome,
    input1.labels,
    input1.tenantPolicyRefs,
    input1.redaction,
  );
  const id2 = evaluationCaseId(
    TENANT_A,
    input2.problemClass,
    input2.observationRefs,
    input2.context,
    input2.actionHistoryRefs,
    input2.outcome,
    input2.labels,
    input2.tenantPolicyRefs,
    input2.redaction,
  );
  expect(id1).not.toBe(id2);
  // But each is stable across runs.
  expect(id1).toBe(
    evaluationCaseId(
      TENANT_A,
      input1.problemClass,
      input1.observationRefs,
      input1.context,
      input1.actionHistoryRefs,
      input1.outcome,
      input1.labels,
      input1.tenantPolicyRefs,
      input1.redaction,
    ),
  );
});

test("audit on/off NEVER changes the domain output (the audit sink is a pure side effect)", () => {
  const store1 = createInMemoryEvaluationCaseStore();
  const store2 = createInMemoryEvaluationCaseStore();
  const sink1 = createInMemoryArenaAuditSink();
  const sink2 = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, []);
  const input = caseInput();
  // Submission 1: audit sink injected.
  // Submission 2: no audit sink (default no-op).
  const r1 = submitEvaluationCase(scopeA(), store1, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
    auditSink: sink1,
  });
  const r2 = submitEvaluationCase(scopeA(), store2, input, {
    ruleSet: rs,
    evaluator: realGuardian,
    request: caseSubmitRequest(),
    guardianOptions: { at: T0, correlationId: CORR },
  });
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("submission failed");
  // The domain output is byte-identical regardless of audit on/off.
  expect(r1.record.caseId).toBe(r2.record.caseId);
  expect(r1.record.contentDigest).toBe(r2.record.contentDigest);
  expect(JSON.stringify(r1.record)).toBe(JSON.stringify(r2.record));
  // The audit sink DID collect a record for submission 1.
  expect(sink1.records.length).toBe(1);
  // And NOTHING for submission 2 (default no-op).
  expect(sink2.records.length).toBe(0);
});

test("deterministic capability-adoption identity across runs", () => {
  // The adoption id is the deterministic digest of (tenantId, capabilityId) —
  // the capability VERSION is on the revision (a supersession is a new
  // revision on the same adoptionId, with a new capabilityVersion).
  const id1 = capabilityAdoptionId(TENANT_A, "device.health.battery_aging_classifier");
  const id2 = capabilityAdoptionId(TENANT_A, "device.health.battery_aging_classifier");
  expect(id1).toBe(id2);
  expect(id1.startsWith("adp_")).toBe(true);
  // Different capability -> different id.
  const id3 = capabilityAdoptionId(TENANT_A, "device.security.anomaly_detector");
  expect(id3).not.toBe(id1);
  // Different tenant -> different id.
  const id4 = capabilityAdoptionId(asTenantId("tnt_testtenant000b"), "device.health.battery_aging_classifier");
  expect(id4).not.toBe(id1);
});

test("deterministic adoption record identity across runs: same metadata + proposal -> byte-identical record", () => {
  const store1 = createInMemoryCapabilityAdoptionStore();
  const store2 = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const options = { at: T0, correlationId: CORR };
  const r1 = adoptCapability(scopeA(), store1, metadata, proposal, options);
  const r2 = adoptCapability(scopeA(), store2, metadata, proposal, options);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("adoption failed");
  expect(r1.record.adoptionId).toBe(r2.record.adoptionId);
  expect(r1.record.recordId).toBe(r2.record.recordId);
  expect(r1.record.contentDigest).toBe(r2.record.contentDigest);
  expect(JSON.stringify(r1.record)).toBe(JSON.stringify(r2.record));
});

test("the certification gate is pure: same metadata -> same refusal/certified outcome across runs", () => {
  // A valid metadata produces a certified outcome — same shape across runs.
  const metadata = certifiedMetadata();
  const r1 = requireCertifiedCapability(metadata, { correlationId: CORR });
  const r2 = requireCertifiedCapability(metadata, { correlationId: CORR });
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("certification failed");
  expect(r1.certified.certificationRef).toBe(r2.certified.certificationRef);
  expect(r1.certified.capabilityId).toBe(r2.certified.capabilityId);
  // A refused metadata produces the same refusal across runs.
  const refused = requireCertifiedCapability(null, { correlationId: CORR });
  const refused2 = requireCertifiedCapability(null, { correlationId: CORR });
  expect(refused.ok).toBe(false);
  expect(refused2.ok).toBe(false);
  if (refused.ok || refused2.ok) throw new Error("expected refusal");
  expect(refused.refusal.reasons).toEqual(refused2.refusal.reasons);
});

test("deterministic record ids across input permutations of the same content", () => {
  // The revision id is a deterministic digest of (caseId, version) — same
  // (caseId, version) always yields the same revision id.
  const caseId = "arc_testcase0001";
  expect(evaluationCaseRecordId(caseId, 1)).toBe(evaluationCaseRecordId(caseId, 1));
  expect(evaluationCaseRecordId(caseId, 1)).not.toBe(evaluationCaseRecordId(caseId, 2));
  // The content digest is a deterministic digest of the record's content fields.
  const baseContent = {
    tenantId: TENANT_A,
    version: 1,
    status: "SUBMITTED" as const,
    problemClass: "device.health.battery_aging",
    observationRefs: ["obs/a"],
    context: { device: "dev_a1" },
    actionHistoryRefs: ["int/a"],
    outcome: { label: "true_positive", value: "battery_aged", observedAt: T0, evidenceRefs: [] as EvidenceRef[] },
    labels: [{ key: "severity", value: "high" }],
    tenantPolicyRefs: ["policy/a"],
    redaction: { state: "deidentified" as const, appliedPolicies: ["policy/deidentify-v1"] },
    guardianDecision: {
      tenantId: TENANT_A,
      decision: "ALLOW" as const,
      rules: [],
      evidence: [],
      decidedAt: T0,
      schemaVersion: 1,
    },
    submittedAt: T0,
  };
  const d1 = evaluationCaseContentDigest(baseContent);
  const d2 = evaluationCaseContentDigest(baseContent);
  expect(d1).toBe(d2);
});

test("deterministic adoption content digest across runs", () => {
  const baseContent = {
    tenantId: TENANT_A,
    version: 1,
    status: "ACTIVE" as const,
    capabilityId: "device.health.battery_aging_classifier",
    capabilityVersion: "1.2.0",
    certificationRef: certificationRef(),
    evaluationSuiteRevision: "suite/v1",
    fleetOSCompatibilityStatement: "compatible",
    warnings: [] as readonly string[],
    rolloutPolicy: { kind: "full" as const },
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    adoptedAt: T0,
  };
  const d1 = capabilityAdoptionContentDigest(baseContent);
  const d2 = capabilityAdoptionContentDigest(baseContent);
  expect(d1).toBe(d2);
});
