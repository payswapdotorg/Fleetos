/**
 * W154 world-model — the provenance-chain proof.
 *
 * Proves:
 *   - a prediction's evidence refs trace
 *     prediction → representation → feature set → input digest;
 *   - the chain is VERIFIED with the REAL @fleetos/predictive
 *     `verifyFeatureSetProvenance` (the binding-test composition pattern
 *     — the W154 lane consumes the W153 feed through its public surface,
 *     and the verification uses the W153 trust anchor);
 *   - the provenance-chain digest is stable (same inputs => same digest);
 *   - the prediction's provenance carries the representation digest +
 *     the feature-set input digest + the context digest verbatim.
 *
 * Per ADR-0002 § "Hard invariants" #3: "Every prediction carries
 * model/capability version, horizon, evidence references (chained to
 * the W153 feature set's provenance + the input digest), uncertainty
 * metadata, and provenance."
 */

import { test, expect } from "bun:test";
import { verifyFeatureSetProvenance } from "@fleetos/predictive";
import {
  AS_OF,
  CORR_1,
  DEV_1,
  DEMO_WINDOW,
  EXTRACTED_AT,
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
  REPRESENTATION_DERIVATION_VERSION,
  REPRESENTATION_SCHEMA_VERSION,
  computeContextDigest,
  computeProvenanceChainDigest,
  predict,
  predictAfterAction,
  provenance,
  represent,
} from "../src/index";
import type { WorldModelContext } from "../src/index";

// ---------------------------------------------------------------------------
// The provenance chain: prediction → representation → feature set → input digest
// ---------------------------------------------------------------------------

test("provenance chain: a prediction's evidence refs trace prediction → representation → feature set → input digest", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };

  // Step 1: represent the feature set + context.
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  // The representation carries:
  //   - featureSetInputDigest (the W153 feed's input digest — the
  //     cryptographic anchor over the immutable observation stream);
  //   - contextDigest (the W154 context's structural digest);
  //   - provenanceChainDigest (the SHA-256 over the canonical
  //     serialization of (featureSetInputDigest, contextDigest,
  //     schemaVersion, derivationVersion)).
  expect(rep.representation.featureSetInputDigest).toBe(dev1.featureSet.inputDigest);
  expect(rep.representation.contextDigest).toBe(computeContextDigest(context));
  const expectedRepDigest = computeProvenanceChainDigest({
    featureSetInputDigest: dev1.featureSet.inputDigest,
    contextDigest: computeContextDigest(context),
    schemaVersion: REPRESENTATION_SCHEMA_VERSION,
    derivationVersion: REPRESENTATION_DERIVATION_VERSION,
  });
  expect(rep.representation.provenanceChainDigest).toBe(expectedRepDigest);

  // Step 2: predict over the representation.
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

  // Step 3: the prediction's provenance carries:
  //   - representationDigest (chained to the representation's
  //     provenanceChainDigest);
  //   - featureSetInputDigest (chained to the W153 feed's input
  //     digest — the cryptographic anchor);
  //   - contextDigest (chained to the W154 context's digest);
  //   - evidenceRefs (the chain: representation → featureSet → contextObservation).
  expect(pred.prediction.provenance.representationDigest).toBe(rep.representation.provenanceChainDigest);
  expect(pred.prediction.provenance.featureSetInputDigest).toBe(dev1.featureSet.inputDigest);
  expect(pred.prediction.provenance.contextDigest).toBe(rep.representation.contextDigest);
  // The evidence refs include a `representation` ref + a `featureSet` ref.
  expect(
    pred.prediction.provenance.evidenceRefs.find((r) => r.kind === "representation"),
  ).toBeDefined();
  expect(
    pred.prediction.provenance.evidenceRefs.find((r) => r.kind === "featureSet"),
  ).toBeDefined();
  // The capability name + version are the reference's.
  expect(pred.prediction.provenance.capabilityName).toBe(REFERENCE_CAPABILITY_NAME);
  expect(pred.prediction.provenance.capabilityVersion).toBe(REFERENCE_CAPABILITY_VERSION);
});

test("provenance chain: the chain is VERIFIED with the REAL @fleetos/predictive verifyFeatureSetProvenance (the binding-test composition pattern)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };

  // Step 1: represent + predict.
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

  // Step 2: VERIFY the feature-set → input-digest leg with the REAL
  // `@fleetos/predictive` `verifyFeatureSetProvenance` (the W153 trust
  // anchor). This is the binding-test composition pattern: the W154
  // lane consumes the W153 feed through its public surface, and the
  // verification uses the W153 trust anchor (the W154 lane does NOT
  // re-implement the verification — it delegates to the W153 feed's
  // trust anchor).
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: dev1.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(`verification failed: ${verification.error.message}`);
  // The re-derived input digest matches the feature set's inputDigest
  // AND the prediction's provenance.featureSetInputDigest.
  expect(verification.inputDigest).toBe(dev1.featureSet.inputDigest);
  expect(verification.inputDigest).toBe(pred.prediction.provenance.featureSetInputDigest);
});

test("provenance chain: a counterfactual's provenance chains the candidate action (the evidenceRefs include a candidateAction ref)", () => {
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
  // The counterfactual's provenance carries the same representation +
  // featureSet + contextDigest refs as the unconditional prediction,
  // PLUS a `candidateAction` ref (chained at the end).
  expect(cf.counterfactual.provenance.representationDigest).toBe(rep.representation.provenanceChainDigest);
  expect(cf.counterfactual.provenance.featureSetInputDigest).toBe(dev1.featureSet.inputDigest);
  expect(cf.counterfactual.provenance.contextDigest).toBe(rep.representation.contextDigest);
  const candidateActionRef = cf.counterfactual.provenance.evidenceRefs.find(
    (r) => r.kind === "candidateAction",
  );
  expect(candidateActionRef).toBeDefined();
  expect(candidateActionRef?.ref).toBe("act.restart_device");
});

test("provenance chain: the provenance accessor returns the prediction's provenance verbatim (never re-derives, never widens)", () => {
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

  // The accessor returns the provenance verbatim — same fields, same values.
  const p = provenance(pred.prediction);
  expect(p.capabilityName).toBe(pred.prediction.provenance.capabilityName);
  expect(p.capabilityVersion).toBe(pred.prediction.provenance.capabilityVersion);
  expect(p.representationDigest).toBe(pred.prediction.provenance.representationDigest);
  expect(p.featureSetInputDigest).toBe(pred.prediction.provenance.featureSetInputDigest);
  expect(p.contextDigest).toBe(pred.prediction.provenance.contextDigest);
  expect(p.evidenceRefs).toBe(pred.prediction.provenance.evidenceRefs);
});

test("provenance chain: a context with optional observations chains them into the representation + prediction's evidence refs", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
    observations: [
      { kind: "workload.assignment", value: "team-a", provenanceRefs: ["workload-ref-1"] },
      { kind: "procurement.stage", value: "approved", provenanceRefs: ["procurement-ref-1"] },
    ],
  };
  const rep = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  // The representation carries the context observations' provenance refs
  // (normalized — deduplicated + sorted).
  expect(rep.representation.contextObservationRefs).toEqual(["procurement-ref-1", "workload-ref-1"]);

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
  // The prediction's evidence refs include `contextObservation` refs
  // (chained forward from the representation).
  const contextObsRefs = pred.prediction.provenance.evidenceRefs.filter(
    (r) => r.kind === "contextObservation",
  );
  expect(contextObsRefs.length).toBe(2);
  expect(contextObsRefs.map((r) => r.ref).sort()).toEqual(["procurement-ref-1", "workload-ref-1"]);
});

test("provenance chain: a tampered feature-set inputDigest is REFUSED by the REAL verifyFeatureSetProvenance (the trust anchor holds)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  // Tamper with the feature set's inputDigest (overwrite it with a
  // different value). The W154 engine trusts the feature set's
  // inputDigest field, but the W153 trust anchor REFUSES this tampered
  // feature set when re-verified against the actual observations.
  const tamperedFeatureSet = {
    ...dev1.featureSet,
    inputDigest: "0".repeat(64),
  };
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: tamperedFeatureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  // The trust anchor REFUSES on digest_mismatch.
  expect(verification.error.message).toContain("digest_mismatch");
});
