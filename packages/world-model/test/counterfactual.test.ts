/**
 * W154 world-model — the counterfactual visibility proof.
 *
 * Proves:
 *   - a counterfactual ALWAYS carries the `hypothetical: true` marker;
 *   - a counterfactual can NEVER be constructed/rendered as fact (the
 *     `kind: "counterfactual"` discriminator + the `hypothetical: true`
 *     marker make it IMPOSSIBLE — the type system enforces it);
 *   - a counterfactual's provenance names the candidate action (the
 *     `evidenceRefs` chain includes a `candidateAction` ref);
 *   - a counterfactual's uncertainty is WIDER than the unconditional
 *     prediction's (the action's effect is uncertain);
 *   - a counterfactual's confidence is LOWER than the unconditional
 *     prediction's (the action's effect is uncertain).
 *
 * Per ADR-0002 § "Hard invariants" #4: "Counterfactuals
 * (`predictAfterAction`) are HYPOTHETICAL, never facts — the record
 * type must machine-carry a distinct hypothetical marker."
 */

import { test, expect } from "bun:test";
import {
  AS_OF,
  CORR_1,
  DEV_1,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  resetObservationCounter,
  seedDemoFleet,
} from "./helpers";
import {
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  REFERENCE_CAPABILITY_NAME,
  REFERENCE_CAPABILITY_VERSION,
  counterfactualId,
  predict,
  predictAfterAction,
  represent,
  uncertainty,
  uncertaintyOf,
} from "../src/index";
import type {
  WorldModelContext,
  WorldModelCounterfactual,
  WorldModelPrediction,
  WorldModelPredictionRecord,
} from "../src/index";

// ---------------------------------------------------------------------------
// The hypothetical marker (machine-carried, never absent)
// ---------------------------------------------------------------------------

test("counterfactual: a counterfactual ALWAYS carries the `hypothetical: true` marker", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf.ok).toBe(true);
  if (!cf.ok) throw new Error("predictAfterAction failed");
  // The hypothetical marker is MACHINE-CARRIED — it is ALWAYS `true` on
  // a WorldModelCounterfactual. The type system enforces it (the field
  // is `readonly hypothetical: true`).
  expect(cf.counterfactual.hypothetical).toBe(true);
  // The kind discriminator is "counterfactual" — NEVER "prediction".
  expect(cf.counterfactual.kind).toBe("counterfactual");
  // The candidate action ref is carried into the provenance chain.
  expect(cf.counterfactual.candidateAction.ref).toBe("act.restart_device");
  expect(cf.counterfactual.candidateAction.description).toBe("Restart the device");
});

// ---------------------------------------------------------------------------
// The counterfactual can NEVER be constructed/rendered as fact (type-system)
// ---------------------------------------------------------------------------

test("counterfactual: a counterfactual can NEVER be assigned to a WorldModelPrediction (the kind discriminator prevents it)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  expect(cf.ok).toBe(true);
  if (!pred.ok || !cf.ok) throw new Error("predict/predictAfterAction failed");

  // The kind discriminators are DIFFERENT — the type system enforces
  // that a `WorldModelCounterfactual` (kind: "counterfactual") is NOT
  // assignable to a `WorldModelPrediction` (kind: "prediction").
  expect(pred.prediction.kind).toBe("prediction");
  expect(cf.counterfactual.kind).toBe("counterfactual");
  expect(pred.prediction.kind).not.toBe(cf.counterfactual.kind);

  // The discriminated union `WorldModelPredictionRecord` narrows by `kind`:
  const record: WorldModelPredictionRecord = pred.prediction;
  if (record.kind === "prediction") {
    // The TS narrow: a `prediction` record does NOT carry the
    // `hypothetical` field or the `candidateAction` field.
    expect((record as WorldModelPrediction).kind).toBe("prediction");
    expect((record as unknown as Partial<WorldModelCounterfactual>).hypothetical).toBeUndefined();
    expect((record as unknown as Partial<WorldModelCounterfactual>).candidateAction).toBeUndefined();
  }

  const cfRecord: WorldModelPredictionRecord = cf.counterfactual;
  if (cfRecord.kind === "counterfactual") {
    // The TS narrow: a `counterfactual` record CARRIES the
    // `hypothetical: true` field and the `candidateAction` field.
    expect((cfRecord as WorldModelCounterfactual).hypothetical).toBe(true);
    expect((cfRecord as WorldModelCounterfactual).candidateAction).toBeDefined();
  }
});

test("counterfactual: a counterfactual's provenance names the candidate action (the evidenceRefs chain includes a candidateAction ref)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf.ok).toBe(true);
  if (!cf.ok) throw new Error("predictAfterAction failed");
  // The provenance's evidenceRefs include a `candidateAction` ref.
  const candidateActionRef = cf.counterfactual.provenance.evidenceRefs.find(
    (r) => r.kind === "candidateAction",
  );
  expect(candidateActionRef).toBeDefined();
  expect(candidateActionRef?.ref).toBe("act.restart_device");
  // The provenance's representation + featureSet + contextObservation refs
  // are also present (chained forward from the representation).
  expect(
    cf.counterfactual.provenance.evidenceRefs.find((r) => r.kind === "representation"),
  ).toBeDefined();
  expect(
    cf.counterfactual.provenance.evidenceRefs.find((r) => r.kind === "featureSet"),
  ).toBeDefined();
  // The capability is the reference capability.
  expect(cf.counterfactual.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(cf.counterfactual.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
});

test("counterfactual: a counterfactual's uncertainty is WIDER than the unconditional prediction's (the action's effect is uncertain)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  expect(cf.ok).toBe(true);
  if (!pred.ok || !cf.ok) throw new Error("predict/predictAfterAction failed");

  // The counterfactual's uncertainty is WIDER (the spread is larger by
  // 50% — the action's effect is uncertain).
  expect(cf.counterfactual.uncertainty.spread).toBeGreaterThan(pred.prediction.uncertainty.spread);
  // The counterfactual's confidence is LOWER (by 20% — the action's
  // effect is uncertain).
  expect(cf.counterfactual.uncertainty.confidence).toBeLessThan(pred.prediction.uncertainty.confidence);
  // The data-density signals are the SAME (the counterfactual uses the
  // same representation's data density).
  expect(cf.counterfactual.uncertainty.observationCount).toBe(pred.prediction.uncertainty.observationCount);
  expect(cf.counterfactual.uncertainty.recencyWeight).toBe(pred.prediction.uncertainty.recencyWeight);
});

test("counterfactual: the uncertainty accessor returns the counterfactual's uncertainty verbatim (never re-derives, never widens)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf.ok).toBe(true);
  if (!cf.ok) throw new Error("predictAfterAction failed");

  // The accessor returns the uncertainty verbatim — same fields, same values.
  const u = uncertaintyOf(cf.counterfactual);
  expect(u.lower).toBe(cf.counterfactual.uncertainty.lower);
  expect(u.upper).toBe(cf.counterfactual.uncertainty.upper);
  expect(u.spread).toBe(cf.counterfactual.uncertainty.spread);
  expect(u.confidence).toBe(cf.counterfactual.uncertainty.confidence);
  expect(u.observationCount).toBe(cf.counterfactual.uncertainty.observationCount);
  expect(u.recencyWeight).toBe(cf.counterfactual.uncertainty.recencyWeight);
});

test("counterfactual: the prediction's uncertainty accessor returns the prediction's uncertainty verbatim (never re-derives, never widens)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  if (!pred.ok) throw new Error("predict failed");

  const u = uncertainty(pred.prediction);
  expect(u.lower).toBe(pred.prediction.uncertainty.lower);
  expect(u.upper).toBe(pred.prediction.uncertainty.upper);
  expect(u.spread).toBe(pred.prediction.uncertainty.spread);
  expect(u.confidence).toBe(pred.prediction.uncertainty.confidence);
});

test("counterfactual: the deterministic counterfactual id is stable + starts with `wmc_`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf1 = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const cf2 = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart the device" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf1.ok).toBe(true);
  expect(cf2.ok).toBe(true);
  if (!cf1.ok || !cf2.ok) throw new Error("predictAfterAction failed");
  expect(counterfactualId(cf1.counterfactual)).toBe(counterfactualId(cf2.counterfactual));
  expect(counterfactualId(cf1.counterfactual)).toMatch(/^wmc_[0-9a-f]{64}$/);
});
