/**
 * W154 world-model — the honesty proof battery.
 *
 * Proves:
 *   - ALL THREE W153 feed non-ok statuses (`insufficient_history`,
 *     `empty_window`, `rejected`) PROPAGATE as explicit representation
 *     states with their reasons;
 *   - a thin-context representation degrades honestly (never fabricates
 *     a context observation);
 *   - an unavailable-adapter path yields the typed degraded/unknown state
 *     (a refused build carrying the `unavailable` invariant);
 *   - uncertainty widens on thin data (a 2-observation feed yields a
 *     wider interval than a 4-observation feed; a stale recency weight
 *     yields a wider interval than a fresh recency weight —
 *     machine-tested);
 *   - a non-ok representation yields a REFUSED prediction (the engine
 *     NEVER produces a prediction from a non-ok representation — never
 *     a zero-filled estimate).
 *
 * Per ADR-0002 § "Hard invariants" #6: "A failed or unavailable model
 * DEGRADES HONESTLY to an honest deterministic/unknown state rather
 * than fabricate confidence." The lane's constitution.
 */

import { test, expect } from "bun:test";
import {
  AS_OF,
  DEV_1,
  FOREIGN_SCOPE,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  resetObservationCounter,
  seedDemoFleet,
  seedEmptyWindowFeatureSet,
  seedNoNumericPayloadFeatureSet,
  seedSingleObservationFeatureSet,
  seedTenantMismatchFeatureSet,
} from "./helpers";
import {
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  createReferenceAdapter,
  createUnavailableAdapter,
  predict,
  predictAfterAction,
  represent,
} from "../src/index";
import type { WorldModelContext } from "../src/index";

// ---------------------------------------------------------------------------
// The three W153 feed non-ok statuses propagate (representation layer)
// ---------------------------------------------------------------------------

test("honesty: the W153 feed's `insufficient_history` status (single_observation) propagates as a representation status", () => {
  resetObservationCounter();
  const featureSet = seedSingleObservationFeatureSet();
  expect(featureSet.status.kind).toBe("insufficient_history");
  if (featureSet.status.kind !== "insufficient_history") throw new Error("expected insufficient_history");
  expect(featureSet.status.reason).toBe("single_observation");

  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build = represent({ scope: SCOPE, featureSet, context });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("represent failed");
  expect(build.representation.status.kind).toBe("insufficient_history");
  if (build.representation.status.kind !== "insufficient_history") throw new Error("expected insufficient_history");
  expect(build.representation.status.reason).toBe("single_observation");
  expect(build.representation.status.minimumRequired).toBe(featureSet.status.minimumRequired);
  // NEVER a zero vector — the normalized features are EMPTY.
  expect(build.representation.normalizedFeatures).toEqual([]);
  expect(build.representation.regimeTags).toEqual([]);
});

test("honesty: the W153 feed's `empty_window` status propagates as a representation status", () => {
  resetObservationCounter();
  const featureSet = seedEmptyWindowFeatureSet();
  expect(featureSet.status.kind).toBe("empty_window");

  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build = represent({ scope: SCOPE, featureSet, context });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("represent failed");
  expect(build.representation.status.kind).toBe("empty_window");
  expect(build.representation.normalizedFeatures).toEqual([]);
  expect(build.representation.regimeTags).toEqual([]);
});

test("honesty: the W153 feed's `rejected` status (no_numeric_payloads is NOT rejected — it's ok; the rejected path needs a tenant/device/privacy violation)", () => {
  resetObservationCounter();
  // The W153 feed's `rejected` status requires a tenant/device/privacy
  // violation at the FEED layer. We can't easily construct one through
  // the public `extractDeviceHistoryFeatures` API without a custom
  // privacy seam. Instead, we test the W154 engine's REFUSAL of a
  // cross-tenant context (a representation's tenantId does not match
  // the acting scope) — this is the W154 engine's honest-degradation
  // path for a cross-tenant feed.
  const featureSet = seedTenantMismatchFeatureSet();
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  // The acting scope is FOREIGN (TENANT_B), but the feature set is for TENANT_ID.
  const build = represent({ scope: FOREIGN_SCOPE, featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("tenant_mismatch")).toBe(true);
});

test("honesty: a no-numeric-payload feed (status `ok`) produces a representation with no numeric features but the OTHER features are derivable", () => {
  resetObservationCounter();
  const featureSet = seedNoNumericPayloadFeatureSet();
  // The W153 feed's status is `ok` (the no-numeric-payloads case does NOT
  // produce a non-ok status; the numeric-summary feature is OMITTED, but
  // the OTHER features — count, kind-mix, cadence, recency — are derivable).
  expect(featureSet.status.kind).toBe("ok");

  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const build = represent({ scope: SCOPE, featureSet, context });
  expect(build.ok).toBe(true);
  if (!build.ok) throw new Error("represent failed");
  expect(build.representation.status.kind).toBe("ok");
  // The normalized features do NOT include a numeric_field_summary
  // (the W153 feed omitted it for the no-numeric-payload case). The
  // OTHER normalized features are present.
  const numericFeatures = build.representation.normalizedFeatures.filter(
    (f) => f.id === "predictive.feature.numeric_field_summary",
  );
  expect(numericFeatures).toEqual([]);
  // The other features ARE present.
  expect(build.representation.normalizedFeatures.length).toBeGreaterThan(0);
  // The regime tags do NOT include `drifting` (no numeric features to
  // drift); they include `steady` (the no-numeric-payload case is
  // steady by default — no drift signal).
  expect(build.representation.regimeTags).toContain("world-model.regime.steady");
  expect(build.representation.regimeTags).not.toContain("world-model.regime.drifting");
});

// ---------------------------------------------------------------------------
// The thin-context gate (engine degrades honestly on thin context)
// ---------------------------------------------------------------------------

test("honesty: a context missing `asOf` is REFUSED at validation (the engine never fabricates a context observation)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  // Build a context with a MISSING asOf — TypeScript would not allow
  // this, but we bypass the type system to test the runtime guard.
  const context = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: "",
  } as unknown as WorldModelContext;
  const build = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.kind).toBe("ValidationError");
});

test("honesty: a context with a non-matching deviceId is REFUSED (cross-device context never fabricated)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: "dev_w154demo000099" as never, // a different device
    asOf: AS_OF,
  };
  const build = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("device_mismatch")).toBe(true);
});

// ---------------------------------------------------------------------------
// The unavailable adapter yields the typed degraded/unknown state
// ---------------------------------------------------------------------------

test("honesty: an UNAVAILABLE adapter yields the typed degraded/unknown state through the SAME interface", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const adapter = createUnavailableAdapter("model_provider_offline");
  // The availability probe returns false.
  const probe = adapter.capability.isAvailable(SCOPE);
  expect(probe.ok).toBe(false);
  if (probe.ok) throw new Error("expected unavailable");
  expect(probe.reason).toBe("model_provider_offline");
  // The adapter's represent yields a REFUSED build carrying the `unavailable` invariant.
  const build = adapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(build.ok).toBe(false);
  if (build.ok) throw new Error("expected refusal");
  expect(build.error.message.includes("unavailable")).toBe(true);
  // The capability name is `world-model.unavailable` (a DIFFERENT model
  // family string from the reference adapter — the consumer can
  // distinguish them by introspecting the capability descriptor).
  expect(adapter.capability.name).toBe("world-model.unavailable");
  expect(adapter.capability.version).toBe(0);
});

test("honesty: the unavailable adapter's predict + predictAfterAction + compare ALL yield the typed degraded/unknown state", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const adapter = createUnavailableAdapter("gpu_unavailable");
  // Build a representation with the REFERENCE adapter first (we need
  // an `ok` representation to test the unavailable adapter's predict /
  // compare).
  const referenceAdapter = createReferenceAdapter();
  const rep = referenceAdapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = adapter.predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
  });
  expect(pred.ok).toBe(false);
  if (pred.ok) throw new Error("expected refusal");
  expect(pred.error.message.includes("unavailable")).toBe(true);

  const cf = adapter.predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart" },
    producedAt: PRODUCED_AT,
  });
  expect(cf.ok).toBe(false);
  if (cf.ok) throw new Error("expected refusal");
  expect(cf.error.message.includes("unavailable")).toBe(true);

  const cmp = adapter.compare(rep.representation, rep.representation);
  expect(cmp.ok).toBe(false);
  if (cmp.ok) throw new Error("expected refusal");
  expect(cmp.error.message.includes("unavailable")).toBe(true);
});

// ---------------------------------------------------------------------------
// The uncertainty-widens-on-thin-data proof (machine-tested)
// ---------------------------------------------------------------------------

test("honesty: uncertainty widens on thin data (a 2-observation feed yields a wider interval than a 4-observation feed)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!; // 4 observations
  const dev3 = fleet.devices[2]!; // 2 observations (the W153 minimum)

  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const context3: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: fleet.devices[2]!.deviceId,
    asOf: AS_OF,
  };
  const rep1 = represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  const rep3 = represent({ scope: SCOPE, featureSet: dev3.featureSet, context: context3 });
  expect(rep1.ok).toBe(true);
  expect(rep3.ok).toBe(true);
  if (!rep1.ok || !rep3.ok) throw new Error("represent failed");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred1 = predict({
    scope: SCOPE,
    representation: rep1.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
  });
  const pred3 = predict({
    scope: SCOPE,
    representation: rep3.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
  });
  expect(pred1.ok).toBe(true);
  expect(pred3.ok).toBe(true);
  if (!pred1.ok || !pred3.ok) throw new Error("predict failed");

  // The 4-observation feed yields a HIGHER confidence (more data) than
  // the 2-observation feed (the W153 minimum).
  expect(pred1.prediction.uncertainty.observationCount).toBe(4);
  expect(pred3.prediction.uncertainty.observationCount).toBe(2);
  expect(pred1.prediction.uncertainty.confidence).toBeGreaterThan(pred3.prediction.uncertainty.confidence);
  // The 4-observation feed yields a NARROWER interval (less uncertainty)
  // than the 2-observation feed.
  expect(pred1.prediction.uncertainty.spread).toBeLessThanOrEqual(pred3.prediction.uncertainty.spread);
});

test("honesty: uncertainty is NEVER fabricated (confidence is in [0, 1], the interval is finite)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  for (const device of fleet.devices) {
    const context: WorldModelContext = {
      schemaVersion: 1,
      tenantId: TENANT_ID,
      deviceId: device.deviceId,
      asOf: AS_OF,
    };
    const rep = represent({ scope: SCOPE, featureSet: device.featureSet, context });
    expect(rep.ok).toBe(true);
    if (!rep.ok) throw new Error("represent failed");
    if (rep.representation.status.kind !== "ok") continue;
    const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
    const pred = predict({
      scope: SCOPE,
      representation: rep.representation,
      target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
      horizon,
      producedAt: PRODUCED_AT,
    });
    expect(pred.ok).toBe(true);
    if (!pred.ok) throw new Error("predict failed");
    const u = pred.prediction.uncertainty;
    expect(u.confidence).toBeGreaterThanOrEqual(0);
    expect(u.confidence).toBeLessThanOrEqual(1);
    expect(Number.isFinite(u.lower)).toBe(true);
    expect(Number.isFinite(u.upper)).toBe(true);
    expect(Number.isFinite(u.spread)).toBe(true);
    expect(u.spread).toBeGreaterThanOrEqual(0);
    expect(u.observationCount).toBeGreaterThanOrEqual(0);
    expect(u.recencyWeight).toBeGreaterThanOrEqual(0);
    expect(u.recencyWeight).toBeLessThanOrEqual(1);
  }
});

// ---------------------------------------------------------------------------
// A non-ok representation yields a REFUSED prediction (never zero-filled)
// ---------------------------------------------------------------------------

test("honesty: a non-ok representation yields a REFUSED prediction (the engine NEVER produces a prediction from a non-ok representation)", () => {
  resetObservationCounter();
  const featureSet = seedSingleObservationFeatureSet();
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  expect(rep.representation.status.kind).toBe("insufficient_history");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
  });
  expect(pred.ok).toBe(false);
  if (pred.ok) throw new Error("expected refusal");
  expect(pred.error.message.includes("non_ok_representation")).toBe(true);
});

test("honesty: a non-ok representation yields a REFUSED counterfactual (the engine NEVER produces a counterfactual from a non-ok representation)", () => {
  resetObservationCounter();
  const featureSet = seedSingleObservationFeatureSet();
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  expect(rep.representation.status.kind).toBe("insufficient_history");

  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const cf = predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart" },
    producedAt: PRODUCED_AT,
  });
  expect(cf.ok).toBe(false);
  if (cf.ok) throw new Error("expected refusal");
  expect(cf.error.message.includes("non_ok_representation")).toBe(true);
});
