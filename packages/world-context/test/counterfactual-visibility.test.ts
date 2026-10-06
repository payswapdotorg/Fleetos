/**
 * @fleetos/world-context — D5: counterfactual-visibility tests.
 *
 * Per the W155 work order: "the counterfactual visibility through the
 * bridge (the hypothetical marker survives conversion)".
 *
 * Per ADR-0002 invariant 4: "Counterfactuals (`predictAfterAction`) are
 * HYPOTHETICAL, never facts — the record type machine-carries a
 * distinct hypothetical marker; it can NEVER be constructed/rendered
 * as fact".
 *
 * Proven by this test:
 *   - a counterfactual-derived proposal carries the hypothetical marker
 *     THROUGH the conversion on THREE surfaces:
 *       1. the proposal's top-level `hypothetical: boolean` field;
 *       2. the proposal's `case.context.hypothetical` field (the JSON-
 *          serializable context — the W070 arena adapter reads this);
 *       3. the proposal's `case.labels` array (a `hypothetical: "true" |
 *          "false"` label so the W070 evaluation loop can filter on it).
 *   - a prediction-derived proposal carries `hypothetical: false` /
 *     `"false"` on the same THREE surfaces (machine-stable — never
 *     absent, never guessed);
 *   - the proposal's `sourcePredictionKind` discriminator mirrors the
 *     W154 prediction's `kind` field (`"prediction"` vs
 *     `"counterfactual"` — never the wrong kind);
 *   - the candidate action ref (the counterfactual's
 *     `candidateAction.ref`) survives the conversion — it appears in
 *     the proposal's `case.context.candidateAction` AND in the
 *     `case.actionHistoryRefs` (the W070 evaluation loop can trace
 *     which action the counterfactual was conditioned on);
 *   - the counterfactual's wider uncertainty (the W154 invariant —
 *     "its uncertainty is 50% wider + confidence 20% lower than the
 *     unconditional prediction") survives the conversion VERBATIM
 *     (the bridge carries the uncertainty into `case.context.uncertainty`
 *     unchanged — the evaluation loop scores against the W154's honest
 *     interval/spread/confidence, never a re-derived one).
 */

import { test, expect } from "bun:test";
import {
  DEV_1,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  makeDecision,
  makeSyntheticCounterfactual,
  makeSyntheticPrediction,
  resetSyntheticCounter,
} from "./helpers";
import {
  BRIDGE_PENDING_OUTCOME_LABEL,
  BRIDGE_SOURCE_SURFACE,
  convertPredictionToEvaluationProposal,
} from "../src/index";

// ---------------------------------------------------------------------------
// The hypothetical marker survives the conversion on THREE surfaces
// ---------------------------------------------------------------------------

test("D2/counterfactual-visibility: a counterfactual-derived proposal carries `hypothetical: true` on the FIRST surface (the proposal's top-level field)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef: "action:restart-device",
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // FIRST surface: the proposal's top-level `hypothetical` field.
  expect(r.proposal.hypothetical).toBe(true);
  // The sourcePredictionKind discriminator mirrors the W154 prediction's
  // `kind` field — `"counterfactual"` (NEVER `"prediction"`).
  expect(r.proposal.sourcePredictionKind).toBe("counterfactual");
});

test("D2/counterfactual-visibility: a counterfactual-derived proposal carries `hypothetical: true` on the SECOND surface (the case.context.hypothetical field)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef: "action:restart-device",
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // SECOND surface: the case.context.hypothetical field.
  const ctx = r.proposal.case.context as Record<string, unknown>;
  expect(ctx.hypothetical).toBe(true);
});

test("D2/counterfactual-visibility: a counterfactual-derived proposal carries the `hypothetical: \"true\"` label on the THIRD surface (the case.labels array)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef: "action:restart-device",
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // THIRD surface: the case.labels array — a `hypothetical: "true"` label.
  const labels = r.proposal.case.labels;
  const hypotheticalLabel = labels.find((l) => l.key === "hypothetical");
  expect(hypotheticalLabel).toBeDefined();
  expect(hypotheticalLabel?.value).toBe("true");
});

// ---------------------------------------------------------------------------
// A prediction-derived proposal carries `hypothetical: false` / `"false"` on
// the same THREE surfaces (machine-stable — never absent, never guessed)
// ---------------------------------------------------------------------------

test("D2/counterfactual-visibility: a prediction-derived proposal carries `hypothetical: false` on ALL three surfaces (machine-stable — never absent)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // FIRST surface.
  expect(r.proposal.hypothetical).toBe(false);
  expect(r.proposal.sourcePredictionKind).toBe("prediction");
  // SECOND surface.
  const ctx = r.proposal.case.context as Record<string, unknown>;
  expect(ctx.hypothetical).toBe(false);
  // THIRD surface.
  const labels = r.proposal.case.labels;
  const hypotheticalLabel = labels.find((l) => l.key === "hypothetical");
  expect(hypotheticalLabel).toBeDefined();
  expect(hypotheticalLabel?.value).toBe("false");
});

// ---------------------------------------------------------------------------
// The candidate action ref survives the conversion (the W070 evaluation
// loop can trace which action the counterfactual was conditioned on)
// ---------------------------------------------------------------------------

test("D2/counterfactual-visibility: the candidate action ref survives the conversion — it appears in case.context.candidateAction AND in case.actionHistoryRefs", () => {
  resetSyntheticCounter();
  const candidateActionRef = "action:restart-device";
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
    candidateActionRef,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The candidate action ref appears in case.context.candidateAction
  // (the W070 arena adapter reads this to know which action the
  // counterfactual is conditioned on).
  const ctx = r.proposal.case.context as Record<string, unknown>;
  const candidateAction = ctx.candidateAction as { ref: string; description: string };
  expect(candidateAction).toBeDefined();
  expect(candidateAction.ref).toBe(candidateActionRef);
  // The candidate action ref ALSO appears in case.actionHistoryRefs (the
  // W070 evaluation loop's action-history filter — `candidate-action:<ref>`).
  const actionHistoryRefs = r.proposal.case.actionHistoryRefs;
  expect(actionHistoryRefs).toContain(`candidate-action:${candidateActionRef}`);
});

test("D2/counterfactual-visibility: a prediction-derived proposal has candidateAction === null in the context (NEVER a guessed action)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // A prediction has NO candidate action — the context's
  // candidateAction is `null` (NEVER a guessed action).
  const ctx = r.proposal.case.context as Record<string, unknown>;
  expect(ctx.candidateAction).toBeNull();
  // The actionHistoryRefs do NOT carry a `candidate-action:` ref.
  const actionHistoryRefs = r.proposal.case.actionHistoryRefs;
  expect(actionHistoryRefs.find((r) => r.startsWith("candidate-action:"))).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The counterfactual's wider uncertainty survives the conversion VERBATIM
// (the W154 invariant — "its uncertainty is 50% wider + confidence 20%
// lower than the unconditional prediction")
// ---------------------------------------------------------------------------

test("D2/counterfactual-visibility: the counterfactual's wider uncertainty survives the conversion VERBATIM (the bridge does NOT re-derive or narrow the uncertainty)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The uncertainty is carried VERBATIM into case.context.uncertainty.
  const ctx = r.proposal.case.context as Record<string, unknown>;
  const uncertainty = ctx.uncertainty as {
    lower: number; upper: number; spread: number; confidence: number;
  };
  expect(uncertainty).toEqual(cf.uncertainty);
  // The counterfactual's spread is 50% wider than the prediction's
  // (the W154 invariant — the synthetic fixtures replicate this: the
  // prediction's spread is 0.2, the counterfactual's is 0.275).
  expect(cf.uncertainty.spread).toBeGreaterThan(0.2); // wider than a typical prediction
  expect(uncertainty.spread).toBe(cf.uncertainty.spread);
  // The counterfactual's confidence is 20% lower than the prediction's
  // (the W154 invariant — the synthetic fixtures replicate this: the
  // prediction's confidence is 0.7, the counterfactual's is 0.56).
  expect(cf.uncertainty.confidence).toBeLessThan(0.7);
  expect(uncertainty.confidence).toBe(cf.uncertainty.confidence);
});

// ---------------------------------------------------------------------------
// The proposal's outcome is the PENDING marker (the ground truth arrives
// LATER via D3) — the bridge does NOT fabricate a ground-truth outcome
// ---------------------------------------------------------------------------

test("D2/counterfactual-visibility: a counterfactual-derived proposal's outcome is the PENDING marker (the ground truth arrives LATER via D3 — never fabricated)", () => {
  resetSyntheticCounter();
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, cf, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The outcome label is the PENDING marker.
  expect(r.proposal.case.outcome.label).toBe(BRIDGE_PENDING_OUTCOME_LABEL);
  // The outcome value is `prediction_pending:<estimateKind>` (a stable
  // identifier for the prediction's target family — the evaluation loop
  // can group cases by value to score the capability per target).
  expect(r.proposal.case.outcome.value).toContain("prediction_pending:");
  // The outcome observedAt is the prediction's producedAt (the proposal's
  // temporal anchor until the real observedAt arrives via D3).
  expect(r.proposal.case.outcome.observedAt).toBe(cf.producedAt);
  // The outcome evidenceRefs are EMPTY (until D3 binds the outcome).
  expect(r.proposal.case.outcome.evidenceRefs).toEqual([]);
});

test("D2/counterfactual-visibility: the source_surface label is `world-model.prediction` for BOTH prediction-derived + counterfactual-derived proposals (the W070 source-surface discriminator)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const cf = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const opts = {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified" as const, appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  };
  const r1 = convertPredictionToEvaluationProposal(SCOPE, prediction, opts);
  const r2 = convertPredictionToEvaluationProposal(SCOPE, cf, opts);
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("expected ok");
  // Both proposals' source_surface label is `world-model.prediction` (the
  // W070 evaluation loop branches on this to route the case to the
  // predictive-evaluation suite — the W155 lane adds a NEW source surface
  // to the W070 module map's four).
  const labels1 = r1.proposal.case.labels;
  const labels2 = r2.proposal.case.labels;
  const sourceSurface1 = labels1.find((l) => l.key === "source_surface");
  const sourceSurface2 = labels2.find((l) => l.key === "source_surface");
  expect(sourceSurface1?.value).toBe(BRIDGE_SOURCE_SURFACE);
  expect(sourceSurface2?.value).toBe(BRIDGE_SOURCE_SURFACE);
  // The labels also carry a `prediction_kind` discriminator —
  // `"prediction"` for predictions, `"counterfactual"` for counterfactuals.
  const kind1 = labels1.find((l) => l.key === "prediction_kind");
  const kind2 = labels2.find((l) => l.key === "prediction_kind");
  expect(kind1?.value).toBe("prediction");
  expect(kind2?.value).toBe("counterfactual");
});
