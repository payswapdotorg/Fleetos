/**
 * @fleetos/world-context — D5: honesty tests.
 *
 * Per the W155 work order: "honesty: the empty-surface minimal context
 * (valid, engine-degradable); the non-ok prediction REFUSED at the bridge;
 * the missing-provenance REFUSAL; cross-tenant REFUSED everywhere".
 *
 * Proven by this test:
 *   - an EMPTY workload/procurement surface yields a MINIMAL context
 *     (refs + asOf only — the W154 engine degrades honestly on thin
 *     context; the projection's `observations` is an empty array, NOT
 *     undefined — explicit about "no observations", never absent);
 *   - a SUPERSEDED + DISMISSED workload assignment is EXCLUDED from the
 *     projection (only ACTIVE assignments are included — the device's
 *     CURRENT assignment state);
 *   - a CLOSED procurement stage (REJECTED + SUPERSEDED) is EXCLUDED
 *     (only OPEN cases — DRAFT / ISSUED / ACCEPTED — are included);
 *   - a tenant mismatch (the prediction's tenantId != the acting scope's
 *     tenantId) REFUSES the bridge conversion with `tenant_mismatch`;
 *   - a tenant mismatch (the GuardianDecision's tenantId != the acting
 *     scope's tenantId) REFUSES the bridge conversion with `tenant_mismatch`;
 *   - a prediction LACKING the provenance chain (empty
 *     `provenance.evidenceRefs`) REFUSES the bridge conversion with
 *     `missing_provenance_chain` (the trust anchor discipline);
 *   - cross-tenant outcome binding REFUSES with `tenant_mismatch`;
 *   - a prediction LACKING the provenance chain REFUSES the outcome
 *     binding with `missing_provenance_chain`;
 *   - a horizon-mismatch (the observed `observedAt` is BEFORE the
 *     prediction's `producedAt + horizonMs`) REFUSES the outcome binding
 *     with `horizon_mismatch`;
 *   - every refusal emits an audit record to the injected sink (the
 *     honest-degradation evidence a reviewer must be able to reconstruct).
 */

import { test, expect } from "bun:test";
import {
  AS_OF,
  CORR_1,
  DEV_1,
  FOREIGN_SCOPE,
  OBSERVED_AT,
  OBSERVED_AT_TOO_EARLY,
  PRODUCED_AT,
  SCOPE,
  TENANT_B,
  TENANT_ID,
  WORKLOAD_1,
  makeDecision,
  makeObservedOutcome,
  makeProcurementStage,
  makeSyntheticCounterfactual,
  makeSyntheticPrediction,
  makeSyntheticPredictionMissingProvenance,
  makeWorkloadAssignment,
  resetSyntheticCounter,
} from "./helpers";
import {
  buildWorldModelContext,
  convertPredictionToEvaluationProposal,
  bindPredictiveOutcome,
  createInMemoryWorldContextAuditSink,
  WORLD_CONTEXT_AUDIT_ACTIONS,
  PROPOSAL_PROPOSED,
} from "../src/index";

// ---------------------------------------------------------------------------
// D1: the empty-surface minimal context (the W154 honest-degradation input)
// ---------------------------------------------------------------------------

test("D1/honesty: an EMPTY workload/procurement surface yields a MINIMAL context (refs + asOf only; observations is an empty array — explicit about 'no observations', never absent)", () => {
  resetSyntheticCounter();
  const build = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    // No workloadAssignments, no procurementStages.
  });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("expected ok");
  // The context carries the structural refs + the asOf — the W154 engine
  // degrades honestly on thin context (its `thin_context` representation
  // status is propagated; the engine never fabricates a context
  // observation).
  expect(build.context.tenantId).toBe(TENANT_ID);
  expect(build.context.deviceId).toBe(DEV_1);
  expect(build.context.asOf).toBe(AS_OF);
  expect(build.context.schemaVersion).toBe(1);
  // The observations field is an EMPTY ARRAY — explicit about "no
  // observations", never absent (undefined). The W154 engine accepts
  // this minimal context as a valid input (the work order: "a MINIMAL
  // context (refs + asOf only) is valid — the engine degrades honestly
  // on thin context, never fabricates").
  expect(build.context.observations).toEqual([]);
  expect(Array.isArray(build.context.observations)).toBe(true);
});

test("D1/honesty: a SUPERSEDED + DISMISSED workload assignment is EXCLUDED from the projection (only ACTIVE assignments are included — the device's CURRENT assignment state)", () => {
  resetSyntheticCounter();
  const build = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    workloadAssignments: [
      makeWorkloadAssignment({ workloadId: WORKLOAD_1, recommendationId: "rec_active", stage: "ACTIVE" }),
      makeWorkloadAssignment({ workloadId: WORKLOAD_1, recommendationId: "rec_super", stage: "SUPERSEDED" }),
      makeWorkloadAssignment({ workloadId: WORKLOAD_1, recommendationId: "rec_dismissed", stage: "DISMISSED" }),
    ],
  });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("expected ok");
  // Only the ACTIVE assignment is in the projection (the SUPERSEDED +
  // DISMISSED assignments are EXCLUDED — never merged into the
  // projection).
  expect(build.context.observations?.length).toBe(1);
  const obs = build.context.observations?.[0];
  expect(obs?.kind).toBe("workload_assignment");
  // The ACTIVE assignment's recommendationId is `rec_active`.
  const value = obs?.value as { recommendationId: string };
  expect(value.recommendationId).toBe("rec_active");
});

test("D1/honesty: a CLOSED procurement stage (REJECTED + SUPERSEDED) is EXCLUDED (only OPEN cases — DRAFT / ISSUED / ACCEPTED — are included)", () => {
  resetSyntheticCounter();
  const build = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    procurementStages: [
      makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_1", stage: "DRAFT" }),
      makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_2", stage: "ISSUED" }),
      makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_3", stage: "ACCEPTED" }),
      makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_4", stage: "REJECTED" }),
      makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_5", stage: "SUPERSEDED" }),
    ],
  });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("expected ok");
  // Only the OPEN stages (DRAFT / ISSUED / ACCEPTED) are in the
  // projection (the CLOSED stages — REJECTED + SUPERSEDED — are
  // EXCLUDED — never merged into the projection).
  expect(build.context.observations?.length).toBe(3);
  const stages = build.context.observations?.map((o) => (o.value as { stage: string }).stage);
  expect(stages?.sort()).toEqual(["ACCEPTED", "DRAFT", "ISSUED"]);
});

test("D1/honesty: an empty-surface minimal context still emits the projection audit record (the consequential projection)", () => {
  resetSyntheticCounter();
  const sink = createInMemoryWorldContextAuditSink();
  const build = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    auditSink: sink,
  });
  expect(build.ok).toBe(true);
  // The projection audit record emitted (even for an empty surface —
  // the projection itself is consequential; a later actor must be able
  // to reconstruct that a context was projected at all).
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.contextProjected);
  expect(sink.records[0]?.tenantId).toBe(TENANT_ID);
  expect(sink.records[0]?.occurredAt).toBe(AS_OF);
  expect((sink.records[0]?.details as { observationCount: number }).observationCount).toBe(0);
});

// ---------------------------------------------------------------------------
// D2: the bridge REFUSES the conversion on honest-degradation paths
// ---------------------------------------------------------------------------

test("D2/honesty: a tenant mismatch (the prediction's tenantId != the acting scope's tenantId) REFUSES the bridge conversion with `tenant_mismatch`", () => {
  resetSyntheticCounter();
  // A prediction for TENANT_B but the acting scope is SCOPE (TENANT_ID).
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_B,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const sink = createInMemoryWorldContextAuditSink();
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW", TENANT_ID),
    auditSink: sink,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  expect(r.error.message.includes("tenant_mismatch")).toBe(true);
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("tenant_mismatch");
  // The tenant-scope refusal audit record emitted (the W155 work order:
  // "the refusal is consequential evidence a reviewer must be able to
  // reconstruct").
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBridge);
});

test("D2/honesty: a tenant mismatch (the GuardianDecision's tenantId != the acting scope's tenantId) REFUSES the bridge conversion with `tenant_mismatch`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // A decision for TENANT_B but the acting scope is SCOPE (TENANT_ID).
  // The GuardianDecision's tenantId MUST match the acting scope's
  // tenantId (a tenant-A proposal can NEVER be gated by a tenant-B
  // decision — fail-closed, never a wrong-tenant gate).
  const sink = createInMemoryWorldContextAuditSink();
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW", TENANT_B),
    auditSink: sink,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("tenant_mismatch");
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBridge);
});

test("D2/honesty: a prediction LACKING the provenance chain REFUSES the bridge conversion with `missing_provenance_chain` (the trust anchor discipline)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPredictionMissingProvenance({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const sink = createInMemoryWorldContextAuditSink();
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "raw", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW", TENANT_ID),
    auditSink: sink,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("missing_provenance_chain");
  expect(r.error.message.includes("empty provenance.evidenceRefs")).toBe(true);
  // The bridge-refused audit record emitted.
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.bridgeRefused);
});

test("D2/honesty: a missing scope REFUSES the bridge conversion with `missing_scope` (the guard fails FIRST)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(
    // An undefined scope — the guard fails FIRST.
    undefined as never,
    prediction,
    {
      tenantPolicyRefs: ["policy:predicate-1"],
      redaction: { state: "raw", appliedPolicies: [] },
      guardianDecision: makeDecision("ALLOW", TENANT_ID),
    },
  );
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("missing_scope");
});

test("D2/honesty: an invalid tenant id REFUSES the bridge conversion with `invalid_tenant_id`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // An invalid tenant id (fails the canonical frozen grammar — too short).
  const r = convertPredictionToEvaluationProposal(
    { tenantId: "tnt_too_short" as never },
    prediction,
    {
      tenantPolicyRefs: ["policy:predicate-1"],
      redaction: { state: "raw", appliedPolicies: [] },
      guardianDecision: makeDecision("ALLOW", TENANT_ID),
    },
  );
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("invalid_tenant_id");
});

// ---------------------------------------------------------------------------
// D3: the outcome binding REFUSES the binding on honest-degradation paths
// ---------------------------------------------------------------------------

test("D3/honesty: a tenant mismatch (the prediction's tenantId != the acting scope's tenantId) REFUSES the outcome binding with `tenant_mismatch`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_B,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const sink = createInMemoryWorldContextAuditSink();
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome, { auditSink: sink });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("tenant_mismatch");
  // The tenant-scope refusal audit record emitted.
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBinding);
});

test("D3/honesty: a prediction LACKING the provenance chain REFUSES the outcome binding with `missing_provenance_chain`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPredictionMissingProvenance({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const sink = createInMemoryWorldContextAuditSink();
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome, { auditSink: sink });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("missing_provenance_chain");
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBindingRefused);
});

test("D3/honesty: a horizon-mismatch (the observed `observedAt` is BEFORE the prediction's `producedAt + horizonMs`) REFUSES the outcome binding with `horizon_mismatch`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // An observedAt BEFORE the horizon's end (PRODUCED_AT + 24h = T8).
  // OBSERVED_AT_TOO_EARLY is T6+1h = T7's evening — way before T8.
  const outcome = makeObservedOutcome({ observedAt: OBSERVED_AT_TOO_EARLY });
  const sink = createInMemoryWorldContextAuditSink();
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome, { auditSink: sink });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("horizon_mismatch");
  expect(r.error.message.includes("horizon")).toBe(true);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBindingRefused);
});

test("D3/honesty: an observedAt AT the horizon's end (>= producedAt + horizonMs) is ACCEPTED (the outcome has materialized)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // OBSERVED_AT = T7 + 24h = T8 (exactly the horizon's end — accepted).
  const outcome = makeObservedOutcome({ observedAt: OBSERVED_AT });
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.binding.outcome.label).toBe("device_health_observed");
  expect(r.binding.outcome.value).toBe("healthy");
});

test("D3/honesty: a missing scope REFUSES the outcome binding with `missing_scope`", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(undefined as never, prediction, outcome);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("missing_scope");
});

test("D3/honesty: an empty ground-truth label REFUSES the outcome binding (the trust anchor discipline — never fabricate a ground truth)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({ label: "" });
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  // Validation error carries the field path.
  expect(r.error.kind).toBe("ValidationError");
});

// ---------------------------------------------------------------------------
// The bridge conversion on a COUNTERFACTUAL also refuses honestly when
// the counterfactual lacks the provenance chain (the same trust anchor)
// ---------------------------------------------------------------------------

test("D2/honesty: a counterfactual lacking the provenance chain also REFUSES the bridge conversion", () => {
  resetSyntheticCounter();
  // A counterfactual is structurally like a prediction + the hypothetical
  // marker + the candidate action ref. The trust-anchor discipline
  // applies the same way — empty `provenance.evidenceRefs` REFUSES.
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // Mutate the cf to drop the provenance chain (the structural seam
  // permits this — the W155 bridge validates the chain at the boundary).
  const cfMissingProv = {
    ...cf,
    provenance: { ...cf.provenance, evidenceRefs: [] },
  };
  const sink = createInMemoryWorldContextAuditSink();
  const r = convertPredictionToEvaluationProposal(SCOPE, cfMissingProv, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW", TENANT_ID),
    auditSink: sink,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  if (r.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(r.error.invariant).toBe("missing_provenance_chain");
});
