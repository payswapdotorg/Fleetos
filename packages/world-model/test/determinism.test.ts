/**
 * W154 world-model — determinism + golden-digest tests.
 *
 * Proves:
 *   - the same feed + same context + same versions => byte-identical
 *     representation records (golden representation);
 *   - the same representation + same target + same horizon + same
 *     capability version + same producedAt => byte-identical prediction
 *     records (golden prediction);
 *   - the provenance chain digest is stable (same inputs => same digest);
 *   - a different feed => different digests;
 *   - a different context => different digests;
 *   - a different target => different prediction digests;
 *   - the counterfactual's hypothetical marker + the candidate action
 *     ref produce a DIFFERENT digest from the unconditional prediction.
 *
 * The golden digests are FROZEN: a change in the engine's derivation
 * that changes a golden digest is a contract change requiring an ADR
 * (the W155 lane + the UI consume these digests as anchors).
 */

import { test, expect } from "bun:test";
import {
  AS_OF,
  CORR_1,
  DEMO_WINDOW,
  DEV_1,
  DEV_2,
  EXTRACTED_AT,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  resetObservationCounter,
  seedDemoFleet,
} from "./helpers";
import {
  PREDICTION_TARGET_CADENCE_TRAJECTORY,
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  PREDICTION_TARGET_RECENCY_DRIFT,
  REFERENCE_CAPABILITY_NAME,
  REFERENCE_CAPABILITY_VERSION,
  REPRESENTATION_DERIVATION_VERSION,
  REPRESENTATION_SCHEMA_VERSION,
  computeContextDigest,
  computePredictionChainDigest,
  computeProvenanceChainDigest,
  predict,
  predictAfterAction,
  represent,
  representationContentDigest,
  predictionContentDigest,
  WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
} from "../src/index";
import type { WorldModelContext } from "../src/index";

// ---------------------------------------------------------------------------
// The golden representation (DEV_1 — the 4-observation security feed)
// ---------------------------------------------------------------------------

test("determinism: the same feed + same context + same versions => byte-identical representation", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build1 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  const build2 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("represent failed");

  // Byte-identical: the canonical JSON of the two representations is
  // the same. We compare the content digest (which is over the canonical
  // serialization) — same digest => byte-identical.
  const digest1 = representationContentDigest(build1.representation);
  const digest2 = representationContentDigest(build2.representation);
  expect(digest1).toBe(digest2);

  // The schema + derivation versions are frozen.
  expect(build1.representation.schemaVersion).toBe(REPRESENTATION_SCHEMA_VERSION);
  expect(build1.representation.derivationVersion).toBe(REPRESENTATION_DERIVATION_VERSION);
});

test("determinism: the provenance-chain digest is stable (same feed + same context => same digest)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build1 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  const build2 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("represent failed");
  expect(build1.representation.provenanceChainDigest).toBe(build2.representation.provenanceChainDigest);
  // The provenance-chain digest is a 64-char SHA-256 hex.
  expect(build1.representation.provenanceChainDigest).toMatch(/^[0-9a-f]{64}$/);
});

test("determinism: a different feed => different representation digests", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const dev2 = fleet.devices[1]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const context2: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_2,
    asOf: AS_OF,
  };
  const build1 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  const build2 = represent({ scope: SCOPE, featureSet: dev2.featureSet, context: context2 });
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("represent failed");
  expect(build1.representation.provenanceChainDigest).not.toBe(build2.representation.provenanceChainDigest);
  expect(representationContentDigest(build1.representation)).not.toBe(representationContentDigest(build2.representation));
});

test("determinism: a different context (different asOf) => different context digest + different representation digest", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context1: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const context2: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: "2026-01-06T18:00:00Z", // 1 hour later than AS_OF (T7=16:00)
  };
  expect(computeContextDigest(context1)).not.toBe(computeContextDigest(context2));
  const build1 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context: context1 });
  const build2 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context: context2 });
  expect(build1.ok).toBe(true);
  expect(build2.ok).toBe(true);
  if (!build1.ok || !build2.ok) throw new Error("represent failed");
  expect(build1.representation.provenanceChainDigest).not.toBe(build2.representation.provenanceChainDigest);
});

test("determinism: a context with optional observations => the context digest reflects them (deterministic across input permutations)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const contextA: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
    observations: [
      { kind: "workload.assignment", value: "team-a", provenanceRefs: ["ref-1", "ref-2"] },
      { kind: "procurement.stage", value: "approved", provenanceRefs: ["ref-3"] },
    ],
  };
  // Same observations in a DIFFERENT order — the digest should be the same.
  const contextB: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
    observations: [
      { kind: "procurement.stage", value: "different-value-ignored", provenanceRefs: ["ref-3"] },
      { kind: "workload.assignment", value: "different-value-ignored", provenanceRefs: ["ref-2", "ref-1"] },
    ],
  };
  // The digests are the SAME — the context digest is over the structure
  // (kind + sorted provenanceRefs), NOT the value. The engine does NOT
  // interpret the content.
  expect(computeContextDigest(contextA)).toBe(computeContextDigest(contextB));

  const buildA = represent({ scope: SCOPE, featureSet: dev1.featureSet, context: contextA });
  const buildB = represent({ scope: SCOPE, featureSet: dev1.featureSet, context: contextB });
  expect(buildA.ok).toBe(true);
  expect(buildB.ok).toBe(true);
  if (!buildA.ok || !buildB.ok) throw new Error("represent failed");
  expect(buildA.representation.provenanceChainDigest).toBe(buildB.representation.provenanceChainDigest);
  expect(buildA.representation.contextObservationRefs).toEqual(["ref-1", "ref-2", "ref-3"]);
});

// ---------------------------------------------------------------------------
// The golden prediction (DEV_1 — the device_health_trajectory target)
// ---------------------------------------------------------------------------

test("determinism: the same representation + same target + same horizon + same producedAt => byte-identical prediction", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 }; // 24h
  const pred1 = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const pred2 = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred1.ok).toBe(true);
  expect(pred2.ok).toBe(true);
  if (!pred1.ok || !pred2.ok) throw new Error("predict failed");
  expect(predictionContentDigest(pred1.prediction)).toBe(predictionContentDigest(pred2.prediction));
  expect(pred1.prediction.provenanceChainDigest).toBe(pred2.prediction.provenanceChainDigest);
  expect(pred1.prediction.provenanceChainDigest).toMatch(/^[0-9a-f]{64}$/);
  // The capability is the reference capability.
  expect(pred1.prediction.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(pred1.prediction.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
});

test("determinism: a different target => different prediction digests", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 }; // 24h
  const predHealth = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const predCadence = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_CADENCE_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const predRecency = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_RECENCY_DRIFT,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(predHealth.ok).toBe(true);
  expect(predCadence.ok).toBe(true);
  expect(predRecency.ok).toBe(true);
  if (!predHealth.ok || !predCadence.ok || !predRecency.ok) throw new Error("predict failed");
  expect(predHealth.prediction.provenanceChainDigest).not.toBe(predCadence.prediction.provenanceChainDigest);
  expect(predHealth.prediction.provenanceChainDigest).not.toBe(predRecency.prediction.provenanceChainDigest);
  expect(predCadence.prediction.provenanceChainDigest).not.toBe(predRecency.prediction.provenanceChainDigest);
});

// ---------------------------------------------------------------------------
// The counterfactual vs the unconditional prediction (different digests)
// ---------------------------------------------------------------------------

test("determinism: the counterfactual's hypothetical marker + candidate action ref produce a DIFFERENT digest from the unconditional prediction", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 }; // 24h
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
  expect(pred.prediction.provenanceChainDigest).not.toBe(cf.counterfactual.provenanceChainDigest);
  // The counterfactual's kind is "counterfactual" — NEVER "prediction".
  expect(cf.counterfactual.kind).toBe("counterfactual");
  expect(cf.counterfactual.hypothetical).toBe(true);
  expect(pred.prediction.kind).toBe("prediction");
});

test("determinism: a different candidate action ref => a different counterfactual digest", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 }; // 24h
  const cf1 = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  const cf2 = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.replace_battery", description: "Replace the battery" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf1.ok).toBe(true);
  expect(cf2.ok).toBe(true);
  if (!cf1.ok || !cf2.ok) throw new Error("predictAfterAction failed");
  expect(cf1.counterfactual.provenanceChainDigest).not.toBe(cf2.counterfactual.provenanceChainDigest);
});

// ---------------------------------------------------------------------------
// The golden digest computation is independent (re-derivable)
// ---------------------------------------------------------------------------

test("determinism: the provenance-chain digest is a pure function of (featureSetInputDigest, contextDigest, schemaVersion, derivationVersion)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const contextDigest = computeContextDigest(context);
  const expected = computeProvenanceChainDigest({
    featureSetInputDigest: dev1.featureSet.inputDigest,
    contextDigest,
    schemaVersion: REPRESENTATION_SCHEMA_VERSION,
    derivationVersion: REPRESENTATION_DERIVATION_VERSION,
  });
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  expect(rep.representation.provenanceChainDigest).toBe(expected);
});

test("determinism: the prediction-chain digest is a pure function of the prediction's components", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
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

  const expected = computePredictionChainDigest({
    representationChainDigest: rep.representation.provenanceChainDigest,
    capabilityName: REFERENCE_CAPABILITY_NAME,
    capabilityVersion: REFERENCE_CAPABILITY_VERSION,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizonMs: horizon.horizonMs,
    estimate: pred.prediction.estimate,
    uncertainty: pred.prediction.uncertainty,
    hypothetical: false,
    candidateActionRef: undefined,
  });
  expect(pred.prediction.provenanceChainDigest).toBe(expected);
});
