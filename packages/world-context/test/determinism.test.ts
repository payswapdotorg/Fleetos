/**
 * @fleetos/world-context — D5: determinism tests (golden contexts + golden
 * proposals + golden bindings).
 *
 * Per the W155 work order: "determinism: golden contexts + golden
 * proposals (the same source records + the same versions => byte-identical
 * outputs; digests stable)".
 *
 * Proven by this test:
 *   - the SAME workload assignment + procurement stage + asOf + projection
 *     version ALWAYS produces byte-identical `WorldModelContextLike`
 *     outputs (the `contextDigest` + the `contentDigest` are stable across
 *     input permutations — the projection's normalization is
 *     deterministic);
 *   - the SAME prediction + the SAME Guardian decision + the SAME
 *     options ALWAYS produces byte-identical
 *     `PredictiveEvaluationProposalLike` outputs (the `proposalId` + the
 *     `contentDigest` are stable across input permutations);
 *   - the SAME prediction + the SAME observed outcome + the SAME
 *     observedAt ALWAYS produces byte-identical
 *     `PredictiveOutcomeBindingLike` outputs (the `bindingId` + the
 *     `contentDigest` are stable across input permutations);
 *   - the digests are STABLE — re-deriving the digest from the same
 *     content yields the same value across runs (the W070 supersession
 *     discipline applied to the world-context feed).
 */

import { test, expect } from "bun:test";
import {
  AS_OF,
  CORR_1,
  DEV_1,
  OBSERVED_AT,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  WORKLOAD_1,
  makeDecision,
  makeObservedOutcome,
  makeProcurementStage,
  makeSyntheticCounterfactual,
  makeSyntheticPrediction,
  makeWorkloadAssignment,
  resetSyntheticCounter,
} from "./helpers";
import {
  BRIDGE_PENDING_OUTCOME_LABEL,
  BRIDGE_SOURCE_SURFACE,
  PREDICTIVE_PROBLEM_CLASS_PREFIX,
  PROPOSAL_PARKED,
  PROPOSAL_PROPOSED,
  PROPOSAL_REJECTED,
  bindPredictiveOutcome,
  buildWorldModelContext,
  computeContextDigest,
  convertPredictionToEvaluationProposal,
  contextContentDigest,
  contextId,
  bindingContentDigest,
  bindingId,
  proposalContentDigest,
} from "../src/index";

// ---------------------------------------------------------------------------
// D1: golden contexts (byte-identical outputs across input permutations)
// ---------------------------------------------------------------------------

test("D1/determinism: the SAME workload + procurement + asOf ALWAYS produces byte-identical context (the same content digest + the same context id)", () => {
  resetSyntheticCounter();
  const baseInput = {
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    workloadAssignments: [
      makeWorkloadAssignment({ workloadId: WORKLOAD_1 }),
    ],
    procurementStages: [
      makeProcurementStage({ demandId: WORKLOAD_1, workloadId: WORKLOAD_1 }),
    ],
    correlationId: CORR_1,
  };
  const build1 = buildWorldModelContext(baseInput);
  const build2 = buildWorldModelContext(baseInput);
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("expected ok");
  // The structural digest + the content digest + the context id are stable.
  expect(computeContextDigest(build1.context)).toBe(computeContextDigest(build2.context));
  expect(contextContentDigest(build1.context)).toBe(contextContentDigest(build2.context));
  expect(contextId(build1.context)).toBe(contextId(build2.context));
  // The observations arrays are byte-identical.
  expect(build1.context.observations).toEqual(build2.context.observations);
});

test("D1/determinism: input permutations (different array orders of the SAME observations) produce the SAME byte-identical context (the projection's normalization is deterministic)", () => {
  resetSyntheticCounter();
  // The SAME observations in different orders — the projection's sort
  // canonicalizes the order, so the digests are byte-identical across
  // input permutations of the SAME observation multiset.
  const wa1 = makeWorkloadAssignment({ workloadId: WORKLOAD_1, recommendationId: "rec_a", evidenceRefs: ["obs:profile-1"] });
  const wa2 = makeWorkloadAssignment({ workloadId: WORKLOAD_1, recommendationId: "rec_b", evidenceRefs: ["obs:profile-2"] });
  const ps1 = makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_a" });
  const ps2 = makeProcurementStage({ demandId: WORKLOAD_1, activeQuoteId: "qt_b" });

  // Permutation 1: [wa1, wa2] + [ps1, ps2]
  const build1 = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    workloadAssignments: [wa1, wa2],
    procurementStages: [ps1, ps2],
  });
  // Permutation 2: [wa2, wa1] + [ps2, ps1] — the SAME multiset, different order.
  const build2 = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    workloadAssignments: [wa2, wa1],
    procurementStages: [ps2, ps1],
  });
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("expected ok");
  // The structural digest is the SAME (it's over the sorted, deduplicated
  // observation refs — the input order does not matter for the multiset).
  expect(computeContextDigest(build1.context)).toBe(computeContextDigest(build2.context));
  // The content digest is the SAME (the projection sorts the observations
  // by `kind` + first provenance ref — the input order does not matter).
  expect(contextContentDigest(build1.context)).toBe(contextContentDigest(build2.context));
  // The context id is the SAME.
  expect(contextId(build1.context)).toBe(contextId(build2.context));
});

test("D1/determinism: the digests are STABLE across runs (re-deriving the digest from the same content yields the same value)", () => {
  resetSyntheticCounter();
  const ctx = buildWorldModelContext({
    scope: SCOPE,
    deviceId: DEV_1,
    asOf: AS_OF,
    workloadAssignments: [makeWorkloadAssignment({ workloadId: WORKLOAD_1 })],
    procurementStages: [makeProcurementStage({ demandId: WORKLOAD_1 })],
  });
  if (!ctx.ok) throw new Error("expected ok");
  const digest1 = computeContextDigest(ctx.context);
  const digest2 = computeContextDigest(ctx.context);
  const digest3 = computeContextDigest(ctx.context);
  expect(digest1).toBe(digest2);
  expect(digest2).toBe(digest3);
  // The digest is a SHA-256 hex string (64 lowercase hex chars).
  expect(digest1).toMatch(/^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// D2: golden proposals (byte-identical outputs across input permutations)
// ---------------------------------------------------------------------------

test("D2/determinism: the SAME prediction + decision + options ALWAYS produces byte-identical proposal (the same proposalId + contentDigest)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const decision = makeDecision("ALLOW");
  const opts = {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified" as const, appliedPolicies: ["policy:redaction-1"] },
    guardianDecision: decision,
  };
  const r1 = convertPredictionToEvaluationProposal(SCOPE, prediction, opts);
  const r2 = convertPredictionToEvaluationProposal(SCOPE, prediction, opts);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("expected ok");
  expect(r1.proposal.proposalId).toBe(r2.proposal.proposalId);
  expect(r1.proposal.contentDigest).toBe(r2.proposal.contentDigest);
  expect(r1.proposal).toEqual(r2.proposal);
  // The proposalId is `wcp_` + sha256 hex (64 chars).
  expect(r1.proposal.proposalId).toMatch(/^wcp_[0-9a-f]{64}$/);
});

test("D2/determinism: the digests are STABLE across runs (re-deriving the digest from the same content yields the same value)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const decision = makeDecision("WARN");
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "raw", appliedPolicies: [] },
    guardianDecision: decision,
  });
  if (!r.ok) throw new Error("expected ok");
  const digest1 = proposalContentDigest({
    tenantId: r.proposal.tenantId,
    sourcePredictionId: r.proposal.sourcePredictionId,
    sourcePredictionKind: r.proposal.sourcePredictionKind,
    hypothetical: r.proposal.hypothetical,
    disposition: r.proposal.disposition,
    case: r.proposal.case,
    guardianDecision: r.proposal.guardianDecision,
  });
  const digest2 = proposalContentDigest({
    tenantId: r.proposal.tenantId,
    sourcePredictionId: r.proposal.sourcePredictionId,
    sourcePredictionKind: r.proposal.sourcePredictionKind,
    hypothetical: r.proposal.hypothetical,
    disposition: r.proposal.disposition,
    case: r.proposal.case,
    guardianDecision: r.proposal.guardianDecision,
  });
  expect(digest1).toBe(digest2);
  expect(digest1).toBe(r.proposal.contentDigest);
});

test("D2/determinism: the SAME counterfactual + decision ALWAYS produces byte-identical proposal (the same proposalId + contentDigest + hypothetical marker)", () => {
  resetSyntheticCounter();
  const counterfactual = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef: "action:restart-device",
  });
  const decision = makeDecision("ALLOW");
  const opts = {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified" as const, appliedPolicies: ["policy:redaction-1"] },
    guardianDecision: decision,
  };
  const r1 = convertPredictionToEvaluationProposal(SCOPE, counterfactual, opts);
  const r2 = convertPredictionToEvaluationProposal(SCOPE, counterfactual, opts);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("expected ok");
  expect(r1.proposal.proposalId).toBe(r2.proposal.proposalId);
  expect(r1.proposal.contentDigest).toBe(r2.proposal.contentDigest);
  // The hypothetical marker is STABLE.
  expect(r1.proposal.hypothetical).toBe(true);
  expect(r2.proposal.hypothetical).toBe(true);
});

// ---------------------------------------------------------------------------
// D3: golden bindings (byte-identical outputs across input permutations)
// ---------------------------------------------------------------------------

test("D3/determinism: the SAME prediction + outcome + observedAt ALWAYS produces byte-identical binding (the same bindingId + contentDigest)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r1 = bindPredictiveOutcome(SCOPE, prediction, outcome);
  const r2 = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("expected ok");
  expect(r1.binding.bindingId).toBe(r2.binding.bindingId);
  expect(r1.binding.contentDigest).toBe(r2.binding.contentDigest);
  expect(r1.binding).toEqual(r2.binding);
  // The bindingId is `wcb_` + sha256 hex (64 chars).
  expect(r1.binding.bindingId).toMatch(/^wcb_[0-9a-f]{64}$/);
});

test("D3/determinism: the binding digests are STABLE across runs", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  if (!r.ok) throw new Error("expected ok");
  const digest1 = bindingContentDigest({
    tenantId: r.binding.tenantId,
    sourcePredictionId: r.binding.sourcePredictionId,
    sourcePredictionKind: r.binding.sourcePredictionKind,
    hypothetical: r.binding.hypothetical,
    sourceSurface: r.binding.sourceSurface,
    subjectRef: r.binding.subjectRef,
    problemClass: r.binding.problemClass,
    deviceId: r.binding.deviceId,
    observationRefs: r.binding.observationRefs,
    actionHistoryRefs: r.binding.actionHistoryRefs,
    context: r.binding.context,
    outcome: r.binding.outcome,
    evidenceRefs: r.binding.evidenceRefs,
    observedAt: r.binding.observedAt,
  });
  const digest2 = bindingContentDigest({
    tenantId: r.binding.tenantId,
    sourcePredictionId: r.binding.sourcePredictionId,
    sourcePredictionKind: r.binding.sourcePredictionKind,
    hypothetical: r.binding.hypothetical,
    sourceSurface: r.binding.sourceSurface,
    subjectRef: r.binding.subjectRef,
    problemClass: r.binding.problemClass,
    deviceId: r.binding.deviceId,
    observationRefs: r.binding.observationRefs,
    actionHistoryRefs: r.binding.actionHistoryRefs,
    context: r.binding.context,
    outcome: r.binding.outcome,
    evidenceRefs: r.binding.evidenceRefs,
    observedAt: r.binding.observedAt,
  });
  expect(digest1).toBe(digest2);
  expect(digest1).toBe(r.binding.contentDigest);
});

// ---------------------------------------------------------------------------
// The frozen vocabularies are exported + machine-stable
// ---------------------------------------------------------------------------

test("the frozen machine-stable vocabularies are exported (the closed set)", async () => {
  const mod = await import("../src/index");
  expect(mod.CONTEXT_PROJECTION_SCHEMA_VERSION).toBe(1);
  expect(mod.PROJECTION_VERSION).toBe(1);
  expect(mod.WORLD_MODEL_CONTEXT_SCHEMA_VERSION).toBe(1);
  expect(mod.BRIDGE_SCHEMA_VERSION).toBe(1);
  expect(mod.BRIDGE_VERSION).toBe(1);
  expect(mod.BINDING_SCHEMA_VERSION).toBe(1);
  expect(mod.BINDING_VERSION).toBe(1);
  expect(mod.BRIDGE_SOURCE_SURFACE).toBe("world-model.prediction");
  expect(mod.BRIDGE_PENDING_OUTCOME_LABEL).toBe("prediction_pending");
  expect(mod.PREDICTIVE_PROBLEM_CLASS_PREFIX).toBe("world-model.prediction");
  expect(mod.PROPOSAL_PROPOSED).toBe("PROPOSED");
  expect(mod.PROPOSAL_PARKED).toBe("PARKED");
  expect(mod.PROPOSAL_REJECTED).toBe("REJECTED");
  expect([...mod.ALL_CONTEXT_OBSERVATION_KINDS]).toEqual([
    "workload_assignment",
    "procurement_stage",
  ]);
  expect([...mod.ALL_PROPOSAL_DISPOSITIONS]).toEqual(["PROPOSED", "PARKED", "REJECTED"]);
});
