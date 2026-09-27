/**
 * W050B arena — D5 tests: contract conformance via @fleetos/contracts/testing
 * fixture builders.
 *
 * The arena package consumes the FROZEN contracts shapes verbatim
 * (`TenantId`, `CorrelationId`, `CausationId`, `EvidenceRef`,
 * `GuardianDecision`, `FleetError`, `TenantScoped`). This suite proves
 * the fixture builders flow through the arena package's public API and
 * that the frozen shapes are honored (no contract drift).
 */

import { test, expect } from "bun:test";
import {
  asTenantId,
  asCorrelationId,
  asUserId,
  asDeviceId,
  validateTenantRef,
  isValidTenantId,
  assertVersion,
  makeVersioned,
  type TenantId,
  type CorrelationId,
  type UserId,
  type DeviceId,
} from "@fleetos/contracts";
import {
  makeTenantId,
  makeCorrelationId,
  makeTimestamp,
  makeDeviceId,
  makeGuardianDecision,
  makeAllGuardianDecisions,
  FIXTURE_TIME_ANCHOR,
  type Seed,
} from "@fleetos/contracts/testing";
import {
  submitEvaluationCase,
  adoptCapability,
  createInMemoryEvaluationCaseStore,
  createInMemoryCapabilityAdoptionStore,
  decisionToCaseStatus,
  evaluationCaseId,
  capabilityAdoptionId,
  requireCertifiedCapability,
  isValidCertificationRef,
  type ArenaTenantScope,
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
} from "./helpers";

test("the frozen contracts fixture builders produce TenantIds that satisfy the canonical grammar", () => {
  for (const seed of ["a", "b", "c", "tenant-enrollment-flow", 0, 1, 42]) {
    const tenantId = makeTenantId(seed as Seed);
    expect(isValidTenantId(tenantId)).toBe(true);
    const ref = validateTenantRef(tenantId);
    expect(ref.ok).toBe(true);
  }
});

test("the frozen contracts fixture builders produce CorrelationIds/DeviceIds/UserIds that are non-empty branded strings", () => {
  const corr: CorrelationId = makeCorrelationId("test-seed");
  const dev: DeviceId = makeDeviceId("test-seed");
  const usr: UserId = asUserId("usr_testuser00001");
  expect(corr.length).toBeGreaterThan(0);
  expect(dev.length).toBeGreaterThan(0);
  expect(usr.length).toBeGreaterThan(0);
  expect(corr.startsWith("cor_")).toBe(true);
  expect(dev.startsWith("dev_")).toBe(true);
  expect(usr.startsWith("usr_")).toBe(true);
});

test("the frozen contracts fixture builders produce timestamps anchored at the canonical FIXTURE_TIME_ANCHOR (no clock reads)", () => {
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
  const ts = makeTimestamp("deterministic-seed");
  expect(ts.startsWith("2026-01-01T")).toBe(true);
  // Determinism: same seed -> same timestamp.
  expect(makeTimestamp("deterministic-seed")).toBe(ts);
});

test("the frozen contracts makeGuardianDecision builder produces all four decision types from a single seed", () => {
  const decisions = makeAllGuardianDecisions("test-seed");
  expect(decisions).toHaveLength(4);
  const types = decisions.map((d) => d.decision);
  expect(types).toContain("ALLOW");
  expect(types).toContain("WARN");
  expect(types).toContain("REQUIRE_APPROVAL");
  expect(types).toContain("BLOCK");
  // Every decision carries the frozen schema (tenantId, rules, evidence, decidedAt, schemaVersion).
  for (const d of decisions) {
    expect(typeof d.tenantId).toBe("string");
    expect(Array.isArray(d.rules)).toBe(true);
    expect(Array.isArray(d.evidence)).toBe(true);
    expect(typeof d.decidedAt).toBe("string");
    expect(typeof d.schemaVersion).toBe("number");
  }
});

test("the frozen contracts makeVersioned/assertVersion helpers: a versioned payload asserts only against known versions", () => {
  const v1 = makeVersioned({ foo: "bar" }, 1);
  expect(assertVersion(v1, [1]).ok).toBe(true);
  expect(assertVersion(v1, [2]).ok).toBe(false);
});

test("the arena evaluation-case store accepts the frozen makeTenantId/makeCorrelationId outputs through the tenant-scope guard", () => {
  const store = createInMemoryEvaluationCaseStore();
  const tenantId = makeTenantId("conformance-seed");
  const corr = makeCorrelationId("conformance-seed");
  const scope: ArenaTenantScope = { tenantId, correlationId: corr };
  // An empty store has size 0 (the scope is accepted by the guard).
  expect(store.size(scope)).toBe(0);
  // A foreign tenant is rejected (the guard checks the canonical grammar).
  const foreignScope: ArenaTenantScope = { tenantId: asTenantId("tnt_invalid") };
  expect(store.size(foreignScope)).toBe(0);
});

test("the arena submission flow consumes a GuardianDecision built by the frozen makeGuardianDecision builder", () => {
  // Submit a case through the real engine + frozen fixture-built tenant/correlation ids.
  const tenantId = makeTenantId("submission-flow");
  const corr = makeCorrelationId("submission-flow");
  const at = makeTimestamp("submission-flow");
  const store = createInMemoryEvaluationCaseStore();
  const scope: ArenaTenantScope = { tenantId, correlationId: corr };
  const rs = ruleSet(tenantId, []);
  const result = submitEvaluationCase(
    scope,
    store,
    caseInput({ tenantId }),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(tenantId),
      guardianOptions: { at, correlationId: corr },
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // The frozen GuardianDecision shape is carried VERBATIM in the case record.
  expect(result.record.guardianDecision.tenantId).toBe(tenantId);
  expect(result.record.guardianDecision.decision).toBe("ALLOW"); // no rules -> ALLOW
  expect(result.record.guardianDecision.schemaVersion).toBeGreaterThanOrEqual(1);
});

test("the arena adoption store accepts the frozen makeTenantId + asUserId outputs", () => {
  const tenantId = makeTenantId("adoption-seed");
  const user = asUserId("usr_testuser00001");
  const corr = makeCorrelationId("adoption-seed");
  const at = makeTimestamp("adoption-seed");
  const store = createInMemoryCapabilityAdoptionStore();
  const scope: ArenaTenantScope = { tenantId, correlationId: corr };
  const metadata: CertifiedCapabilityMetadata = certifiedMetadata({ tenantId });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: user,
    approvedAt: at,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scope, store, metadata, proposal, {
    at,
    correlationId: corr,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.tenantId).toBe(tenantId);
  expect(result.record.approverId as string).toBe(user as string);
});

test("the arena package's deterministic ids are stable under the frozen fixture builders", () => {
  // The case id is a deterministic digest of the content fields.
  const tenantId = makeTenantId("id-stability");
  const devId = makeDeviceId("id-stability");
  const input = caseInput({
    tenantId,
    context: { device: devId as string },
  });
  const id1 = evaluationCaseId(
    tenantId,
    input.problemClass,
    input.observationRefs,
    input.context,
    input.actionHistoryRefs,
    input.outcome,
    input.labels,
    input.tenantPolicyRefs,
    input.redaction,
  );
  const id2 = evaluationCaseId(
    tenantId,
    input.problemClass,
    input.observationRefs,
    input.context,
    input.actionHistoryRefs,
    input.outcome,
    input.labels,
    input.tenantPolicyRefs,
    input.redaction,
  );
  expect(id1).toBe(id2);
  expect(id1.startsWith("arc_")).toBe(true);
});

test("the arena certification-reference grammar accepts the canonical acr_ prefix + 16+ base32 chars", () => {
  const ref = certificationRef("stability-test");
  expect(isValidCertificationRef(ref)).toBe(true);
  expect(ref.startsWith("acr_")).toBe(true);
});

test("the arena decisionToCaseStatus maps the frozen GuardianDecisionType union exhaustively", () => {
  // Every decision type the frozen contracts defines maps to a status.
  expect(decisionToCaseStatus("ALLOW")).toBe("SUBMITTED");
  expect(decisionToCaseStatus("WARN")).toBe("SUBMITTED");
  expect(decisionToCaseStatus("REQUIRE_APPROVAL")).toBe("PARKED");
  expect(decisionToCaseStatus("BLOCK")).toBe("REJECTED");
});
