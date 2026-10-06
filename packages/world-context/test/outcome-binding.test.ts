/**
 * @fleetos/world-context — D5: outcome-binding tests.
 *
 * Per the W155 work order: "the outcome binding: the observed-vs-
 * predicted join is correct; a horizon-mismatch REFUSES; the provenance
 * chain is verified".
 *
 * Proven by this test:
 *   - the observed-vs-predicted JOIN is correct: the binding's `outcome`
 *     carries the GROUND TRUTH (the observed device health/cadence at
 *     the horizon's end); the binding's `context` carries the
 *     prediction's estimate + uncertainty (for the W070 evaluation loop
 *     to score the prediction's accuracy);
 *   - the binding's `subjectRef` is the prediction's
 *     `provenanceChainDigest` (the prediction's stable id anchor);
 *   - the binding's `observationRefs` carry the prediction's evidence
 *     chain (representation → feature-set → observations → context
 *     observations → candidate action when applicable);
 *   - the binding's `evidenceRefs` MERGE the observed evidence (the
 *     outcome's evidenceRefs) with the prediction's evidence chain;
 *   - the binding's `deviceId` is the prediction's `target.deviceId` (the
 *     device the binding concerns);
 *   - the binding's `sourceSurface` is `world-model.prediction` (the
 *     W070 module map's new fifth surface);
 *   - the binding's `problemClass` is
 *     `world-model.prediction.<estimateKind>` (the W155 bridge's source-
 *     surface prefix + the prediction's target family);
 *   - the counterfactual's hypothetical marker + candidate action ref
 *     SURVIVE the binding (the W154 marker propagated);
 *   - the binding audits the consequential append (a NEW binding record
 *     emits `world-context.outcome_binding.bound` to the injected sink).
 */

import { test, expect } from "bun:test";
import {
  CORR_1,
  DEV_1,
  OBSERVED_AT,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  makeDecision,
  makeObservedOutcome,
  makeSyntheticCounterfactual,
  makeSyntheticPrediction,
  resetSyntheticCounter,
} from "./helpers";
import {
  PREDICTIVE_OUTCOME_SOURCE_SURFACE,
  PREDICTIVE_PROBLEM_CLASS_PREFIX,
  bindPredictiveOutcome,
  createInMemoryWorldContextAuditSink,
  WORLD_CONTEXT_AUDIT_ACTIONS,
} from "../src/index";

// ---------------------------------------------------------------------------
// The observed-vs-predicted JOIN is correct
// ---------------------------------------------------------------------------

test("D3/outcome-binding: the binding's outcome carries the GROUND TRUTH (the observed device health/cadence at the horizon's end)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({
    label: "device_health_observed",
    value: "degraded",
    observedAt: OBSERVED_AT,
  });
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The binding's outcome carries the GROUND TRUTH — the observed
  // device health/cadence at the horizon's end (NOT the predicted
  // estimate; the prediction's estimate is in the binding's `context`).
  expect(r.binding.outcome.label).toBe("device_health_observed");
  expect(r.binding.outcome.value).toBe("degraded");
  // The observedAt is the caller-supplied instant.
  expect(r.binding.observedAt).toBe(OBSERVED_AT);
});

test("D3/outcome-binding: the binding's context carries the prediction's estimate + uncertainty (for the W070 evaluation loop to score the prediction's accuracy)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The binding's context carries the predicted estimate + uncertainty
  // + the prediction's capability + the hypothetical marker (false for
  // a prediction) + the candidateAction (null for a prediction).
  const ctx = r.binding.context as Record<string, unknown>;
  expect(ctx.predictedEstimate).toBe(prediction.estimate);
  expect(ctx.predictedEstimateKind).toBe(prediction.estimateKind);
  expect(ctx.predictedUncertainty).toEqual(prediction.uncertainty);
  expect(ctx.capability).toEqual(prediction.capability);
  expect(ctx.hypothetical).toBe(false);
  expect(ctx.candidateAction).toBeNull();
  expect(ctx.producedAt).toBe(prediction.producedAt);
  expect(ctx.provenanceChainDigest).toBe(prediction.provenanceChainDigest);
});

test("D3/outcome-binding: the binding's subjectRef is the prediction's provenanceChainDigest (the prediction's stable id anchor)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The subjectRef IS the prediction's stable id anchor.
  expect(r.binding.subjectRef).toBe(prediction.provenanceChainDigest);
  expect(r.binding.sourcePredictionId).toBe(prediction.provenanceChainDigest);
});

test("D3/outcome-binding: the binding's observationRefs carry the prediction's evidence chain (representation → feature-set → observations → context-observations → candidate-action when applicable)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The observationRefs carry the prediction's evidence chain —
  // each ref is `kind:ref` (the W154 PredictionEvidenceRef shape
  // serialized for the W070 outcome-observation's string-array shape).
  const expectedRefs = prediction.provenance.evidenceRefs.map((e) => `${e.kind}:${e.ref}`);
  expect(r.binding.observationRefs).toEqual([...expectedRefs].sort());
  // The observationRefs are normalized (deduplicated + sorted).
  const sorted = [...r.binding.observationRefs].sort();
  expect([...r.binding.observationRefs]).toEqual(sorted);
  // No duplicates.
  expect(new Set(r.binding.observationRefs).size).toBe(r.binding.observationRefs.length);
});

test("D3/outcome-binding: the binding's evidenceRefs MERGE the observed evidence with the prediction's evidence chain (normalized by key)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const observedEvidence = [
    { key: "obs-evidence-1", sizeBytes: 256, hash: "abc123", hashAlgorithm: "sha256" },
    { key: "obs-evidence-2", sizeBytes: 512, hash: "def456", hashAlgorithm: "sha256" },
  ];
  const outcome = makeObservedOutcome({ evidenceRefs: observedEvidence });
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The merged evidenceRefs include BOTH the prediction's evidence chain
  // (as content-addressable refs with the W154 digest algorithm) AND
  // the observed evidence.
  const keys = r.binding.evidenceRefs.map((e) => e.key);
  // The prediction's evidence chain is in the merged set.
  for (const ref of prediction.provenance.evidenceRefs) {
    expect(keys).toContain(`${ref.kind}:${ref.ref}`);
  }
  // The observed evidence is in the merged set.
  for (const ref of observedEvidence) {
    expect(keys).toContain(ref.key);
  }
  // The merged set is normalized (deduplicated by key, sorted by key).
  const sortedKeys = [...keys].sort();
  expect(keys).toEqual(sortedKeys);
  expect(new Set(keys).size).toBe(keys.length);
});

test("D3/outcome-binding: the binding's deviceId is the prediction's target.deviceId (the device the binding concerns)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.binding.deviceId).toBe(DEV_1);
});

test("D3/outcome-binding: the binding's sourceSurface is `world-model.prediction` (the W070 module map's new fifth surface)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.binding.sourceSurface).toBe(PREDICTIVE_OUTCOME_SOURCE_SURFACE);
  expect(r.binding.sourceSurface).toBe("world-model.prediction");
});

test("D3/outcome-binding: the binding's problemClass is `world-model.prediction.<estimateKind>` (the W155 bridge's source-surface prefix + the prediction's target family)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.binding.problemClass).toBe(`${PREDICTIVE_PROBLEM_CLASS_PREFIX}.${prediction.estimateKind}`);
});

// ---------------------------------------------------------------------------
// The counterfactual's hypothetical marker + candidate action ref survive
// the binding (the W154 marker propagated)
// ---------------------------------------------------------------------------

test("D3/outcome-binding: the counterfactual's hypothetical marker + candidate action ref SURVIVE the binding (the W154 marker propagated)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef: "action:restart-device",
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, cf, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The hypothetical marker survives on TWO surfaces (the binding's
  // top-level field + the context.hypothetical field).
  expect(r.binding.hypothetical).toBe(true);
  expect(r.binding.sourcePredictionKind).toBe("counterfactual");
  const ctx = r.binding.context as Record<string, unknown>;
  expect(ctx.hypothetical).toBe(true);
  // The candidate action ref survives in context.candidateAction.
  const candidateAction = ctx.candidateAction as { ref: string; description: string };
  expect(candidateAction.ref).toBe("action:restart-device");
  // The candidate action ref also appears in actionHistoryRefs.
  expect(r.binding.actionHistoryRefs).toContain("candidate-action:action:restart-device");
});

test("D3/outcome-binding: a prediction-derived binding has `hypothetical: false` + candidateAction: null in the context (NEVER a guessed marker)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.binding.hypothetical).toBe(false);
  expect(r.binding.sourcePredictionKind).toBe("prediction");
  const ctx = r.binding.context as Record<string, unknown>;
  expect(ctx.hypothetical).toBe(false);
  expect(ctx.candidateAction).toBeNull();
  // The actionHistoryRefs do NOT carry a `candidate-action:` ref.
  expect(r.binding.actionHistoryRefs.find((r) => r.startsWith("candidate-action:"))).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The provenance chain is verified (the trust anchor discipline)
// ---------------------------------------------------------------------------

test("D3/outcome-binding: the provenance chain is verified (the prediction's provenanceChainDigest is carried through to the binding's subjectRef + sourcePredictionId)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The prediction's provenanceChainDigest is the trust anchor — it's
  // carried through to the binding's subjectRef + sourcePredictionId
  // (the W070 evaluation loop can verify the chain by re-deriving the
  // digests: prediction → representation → feature-set → input digest).
  expect(r.binding.subjectRef).toBe(prediction.provenanceChainDigest);
  expect(r.binding.sourcePredictionId).toBe(prediction.provenanceChainDigest);
  // The prediction's evidence chain is carried through to the binding's
  // observationRefs (the W070 evaluation loop can re-derive the chain).
  for (const ref of prediction.provenance.evidenceRefs) {
    expect(r.binding.observationRefs).toContain(`${ref.kind}:${ref.ref}`);
  }
});

test("D3/outcome-binding: the binding's actionHistoryRefs include the prediction's correlationId (the request that produced the prediction — the causation trail)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const outcome = makeObservedOutcome({});
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The prediction's correlationId is in the actionHistoryRefs (the
  // causation trail — the W070 evaluation loop can trace which request
  // produced the prediction).
  expect(r.binding.actionHistoryRefs).toContain(`prediction-correlation:${CORR_1}`);
});

// ---------------------------------------------------------------------------
// The binding audits the consequential append
// ---------------------------------------------------------------------------

test("D3/outcome-binding: the binding audits the consequential append (a NEW binding record emits `world-context.outcome_binding.bound` to the injected sink)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const outcome = makeObservedOutcome({});
  const sink = createInMemoryWorldContextAuditSink();
  const r = bindPredictiveOutcome(SCOPE, prediction, outcome, { auditSink: sink });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The audit record emitted.
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]?.action).toBe(WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBound);
  expect(sink.records[0]?.tenantId).toBe(TENANT_ID);
  expect(sink.records[0]?.occurredAt).toBe(OBSERVED_AT);
  expect(sink.records[0]?.subject).toBe(r.binding.bindingId);
  // The audit details carry the binding's identity + the source prediction.
  const details = sink.records[0]?.details as {
    bindingId: string;
    sourcePredictionId: string;
    outcomeLabel: string;
    outcomeValue: string;
  };
  expect(details.bindingId).toBe(r.binding.bindingId);
  expect(details.sourcePredictionId).toBe(prediction.provenanceChainDigest);
  expect(details.outcomeLabel).toBe("device_health_observed");
  expect(details.outcomeValue).toBe("healthy");
});
