/**
 * W070 learning — D4 tests: audit emission through the injected sink,
 * structurally satisfied by @fleetos/audit's REAL sink adapter.
 *
 * The learning audit seam (`LearningAuditSink`) is structurally
 * identical to the W011/W021/W022/W031/W032/W040/W041/W050B seams;
 * W012's `createAuditSinkAdapter` adapts the REAL hash-chained
 * `AuditLog` to any structurally identical seam. This suite proves:
 *   - the adapter satisfies the learning seam (the type-level structural
 *     proof + the runtime flow);
 *   - consequential learning mutations (observations recorded, proposals
 *     gated, adoptions recorded/superseded/refused) flow into the
 *     hash-chained log;
 *   - the chain VERIFIES (no tampering);
 *   - per-tenant chains stay SEPARATE (tenant A's records never appear
 *     in tenant B's chain);
 *   - the emission policy (idempotent re-appends and failed validations
 *     never audit).
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import {
  LEARNING_AUDIT_ACTIONS,
  convertOutcomeToEvaluationCase,
  createInMemoryLearningAdoptionStore,
  createInMemoryLearningAuditSink,
  createInMemoryOutcomeObservationStore,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  recordCapabilityAdoption,
  recordOutcomeObservation,
  type ActionPlanFacet,
  type LearningAuditSink,
} from "../src/index";
import {
  CORR,
  CORR_2,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  adoptionProposal,
  certifiedMetadata,
  evidenceRef,
  realAuditLog,
  realGuardian,
  realLearningAuditSink,
  redaction,
  ruleSet,
  scopeA,
  scopeB,
  caseSubmitRequest,
} from "./helpers";

/** A canonical APPROVED action plan facet (deterministic). */
function planFacet(tenantId: typeof TENANT_A = TENANT_A): ActionPlanFacet {
  return {
    planId: "pln_test00000001",
    tenantId,
    name: "lock-fleet",
    version: 2,
    status: "APPROVED",
    capability: "lock",
    selectedTargets: [],
    targetCount: 1,
    createdAt: T0,
    transitionedAt: T1,
    contentDigest: "abcdef01",
    evidence: [evidenceRef("evidence/plan-basis-1")],
  };
}

/** Build an observation + draft + real decision for the gate flow. */
function gatedFlow(sink: LearningAuditSink) {
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  const converted = convertOutcomeToEvaluationCase(scopeA(), observed.observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  if (!converted.ok) throw new Error(converted.error.message);
  const outcome = realGuardian(ruleSet(TENANT_A, []), caseSubmitRequest(TENANT_A), {
    at: T1,
    correlationId: CORR,
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  const gated = gateEvaluationCaseProposal(scopeA(), converted.draft, outcome.evaluation.decision, {
    auditSink: sink,
  });
  if (!gated.ok) throw new Error(gated.error.message);
  return { observation: observed.observation, proposal: gated.proposal };
}

test("the REAL @fleetos/audit sink adapter satisfies the LearningAuditSink seam structurally", () => {
  const log = realAuditLog();
  const sink = realLearningAuditSink(log);
  expect(typeof sink.append).toBe("function");
  // A hand-made record flows through into the hash-chained log.
  sink.append({
    action: "learning.probe",
    tenantId: TENANT_A,
    subject: "loo_probe",
    occurredAt: T0,
    correlationId: CORR,
    details: { probe: true },
  });
  expect(log.size(makeTenantContext(TENANT_A, CORR))).toBe(1);
});

test("a full learning flow emits its consequential mutations into the hash-chained AuditLog; the chain verifies", () => {
  const log = realAuditLog();
  const sink = realLearningAuditSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);

  // D1: an outcome observation recorded.
  const observationStore = createInMemoryOutcomeObservationStore();
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  const recorded = recordOutcomeObservation(scopeA(), observationStore, observed.observation, {
    auditSink: sink,
  });
  expect(recorded.ok).toBe(true);

  // D2: a gated proposal (the REAL Guardian decision).
  const { proposal } = gatedFlow(sink);

  // D3: an adoption recorded, then a refusal at the certification boundary.
  const adoptionStore = createInMemoryLearningAdoptionStore();
  const adopted = recordCapabilityAdoption(
    scopeA(),
    adoptionStore,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(adopted.ok).toBe(true);
  const refused = recordCapabilityAdoption(
    scopeA(),
    adoptionStore,
    { ...certifiedMetadata(), certificationRef: "" },
    adoptionProposal({ proposalId: "prop/test-2" }),
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(refused.ok).toBe(false);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    LEARNING_AUDIT_ACTIONS.outcomeObserved,
    LEARNING_AUDIT_ACTIONS.caseProposed,
    LEARNING_AUDIT_ACTIONS.adoptionRecorded,
    LEARNING_AUDIT_ACTIONS.adoptionRefused,
  ]);
  // The hash chain verifies end-to-end.
  const verification = log.verify(ctxA);
  expect(verification.ok).toBe(true);
  // The gated proposal's audit carries the decision trail.
  const gatedRecord = log.records(ctxA).find((r) => r.action === LEARNING_AUDIT_ACTIONS.caseProposed);
  expect(gatedRecord).toBeDefined();
  const details = gatedRecord?.details as Record<string, unknown>;
  expect(details["decision"]).toBe("ALLOW");
  expect(details["disposition"]).toBe("PROPOSED");
  expect(details["proposalId"]).toBe(proposal.proposalId);
});

test("per-tenant chains stay separate: tenant B's emissions never enter tenant A's chain", () => {
  const log = realAuditLog();
  const sink = realLearningAuditSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR_2);

  // Tenant A: one observation recorded.
  const storeA = createInMemoryOutcomeObservationStore();
  const observedA = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observedA.ok) throw new Error(observedA.error.message);
  recordOutcomeObservation(scopeA(), storeA, observedA.observation, { auditSink: sink });

  // Tenant B: TWO consequential mutations (an observation + an adoption).
  const storeB = createInMemoryOutcomeObservationStore();
  const observedB = observeActionPlanOutcome(
    scopeB(),
    { plan: planFacet(TENANT_B) },
    { observedAt: T1, correlationId: CORR_2 },
  );
  if (!observedB.ok) throw new Error(observedB.error.message);
  recordOutcomeObservation(scopeB(), storeB, observedB.observation, { auditSink: sink });
  const adoptedB = recordCapabilityAdoption(
    scopeB(),
    createInMemoryLearningAdoptionStore(),
    certifiedMetadata({ tenantId: TENANT_B }),
    adoptionProposal({ proposalId: "prop/test-b-1" }),
    { at: T1, correlationId: CORR_2, auditSink: sink },
  );
  expect(adoptedB.ok).toBe(true);

  // Each chain holds ONLY its own tenant's records; both verify.
  expect(log.size(ctxA)).toBe(1);
  expect(log.size(ctxB)).toBe(2);
  expect(log.records(ctxA).every((r) => (r.tenantId as string) === (TENANT_A as string))).toBe(true);
  expect(log.records(ctxB).every((r) => (r.tenantId as string) === (TENANT_B as string))).toBe(true);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
  // The chain heads differ (separate chains).
  expect(log.head(ctxA)?.recordHash).not.toBe(log.head(ctxB)?.recordHash);
});

test("the emission policy: idempotent re-appends and failed validations never audit", () => {
  const log = realAuditLog();
  const sink = realLearningAuditSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);

  // A failed validation (a non-terminal plan) never audits.
  const failed = observeActionPlanOutcome(
    scopeA(),
    { plan: { ...planFacet(), status: "PROPOSAL" } },
    { observedAt: T1, correlationId: CORR },
  );
  expect(failed.ok).toBe(false);
  expect(log.size(ctxA)).toBe(0);

  // A created append audits; an idempotent re-append does not.
  const store = createInMemoryOutcomeObservationStore();
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  recordOutcomeObservation(scopeA(), store, observed.observation, { auditSink: sink });
  recordOutcomeObservation(scopeA(), store, observed.observation, { auditSink: sink });
  expect(log.size(ctxA)).toBe(1);
});

test("the adoption-refusal audit record carries the machine-stable refusal reasons (the boundary held — provable)", () => {
  const log = realAuditLog();
  const sink = realLearningAuditSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const metadata = certifiedMetadata();
  const refused = recordCapabilityAdoption(
    scopeA(),
    createInMemoryLearningAdoptionStore(),
    { ...metadata, certificationRef: "malformed-ref" },
    adoptionProposal(),
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(refused.ok).toBe(false);
  const record = log.records(ctxA).find((r) => r.action === LEARNING_AUDIT_ACTIONS.adoptionRefused);
  expect(record).toBeDefined();
  const details = record?.details as Record<string, unknown>;
  expect((details["reasons"] as readonly string[]).includes("malformed_certification_ref")).toBe(true);
  expect(details["capabilityId"]).toBe(metadata.capabilityId);
});

test("the in-memory sink collects verbatim (the local reference implementation)", () => {
  const sink = createInMemoryLearningAuditSink();
  const { observation } = gatedFlow(sink);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.caseProposed);
  void observation;
});
