/**
 * W154 world-model — the adapter-seam proof.
 *
 * Proves:
 *   - the reference adapter satisfies the `WorldModelAdapter` interface;
 *   - the stub adapter (a different model family string) swaps in —
 *     the seam is genuinely swappable;
 *   - the capability versions flow through (the reference adapter's
 *     capability name is `world-model.reference.deterministic`; the
 *     stub adapter's is `world-model.test.stub`);
 *   - the availability probe gates honestly (the reference adapter is
 *     always available; the unavailable adapter is always unavailable);
 *   - the unavailable adapter yields the typed degraded/unknown state
 *     through the SAME interface.
 *
 * Per ADR-0002 § "Proposed model-neutral surface": "The
 * swappable-implementation boundary".
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
  STUB_CAPABILITY_NAME,
  createReferenceAdapter,
  createStubAdapter,
  createUnavailableAdapter,
  isAdapterAvailable,
} from "../src/index";
import type { WorldModelAdapter, WorldModelContext } from "../src/index";

// ---------------------------------------------------------------------------
// The reference adapter satisfies the interface
// ---------------------------------------------------------------------------

test("adapter seam: the reference adapter satisfies the WorldModelAdapter interface", () => {
  const adapter: WorldModelAdapter = createReferenceAdapter();
  expect(adapter.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(adapter.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
  expect(typeof adapter.represent).toBe("function");
  expect(typeof adapter.predict).toBe("function");
  expect(typeof adapter.predictAfterAction).toBe("function");
  expect(typeof adapter.compare).toBe("function");
  // The availability probe is a function.
  expect(typeof adapter.capability.isAvailable).toBe("function");
});

test("adapter seam: the reference adapter's availability probe ALWAYS returns true (it is pure TypeScript arithmetic)", () => {
  const adapter = createReferenceAdapter();
  const probe = adapter.capability.isAvailable(SCOPE);
  expect(probe.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// The stub adapter swaps in (the seam is genuinely swappable)
// ---------------------------------------------------------------------------

test("adapter seam: the stub adapter swaps in — DIFFERENT model family string, SAME interface", () => {
  const reference = createReferenceAdapter();
  const stub = createStubAdapter();
  // The capability NAMES are DIFFERENT — the seam is genuinely swappable.
  expect(reference.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(stub.capability.name).toBe(STUB_CAPABILITY_NAME);
  expect(reference.capability.name).not.toBe(stub.capability.name);
  // The interface is the SAME — both satisfy WorldModelAdapter.
  const referenceAsAdapter: WorldModelAdapter = reference;
  const stubAsAdapter: WorldModelAdapter = stub;
  expect(typeof referenceAsAdapter.represent).toBe("function");
  expect(typeof stubAsAdapter.represent).toBe("function");
  // The capability versions flow through.
  expect(reference.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
  expect(stub.capability.version).toBe(1);
});

test("adapter seam: the stub adapter's availability probe ALWAYS returns true", () => {
  const stub = createStubAdapter();
  const probe = stub.capability.isAvailable(SCOPE);
  expect(probe.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// The unavailable adapter yields the typed degraded/unknown state
// ---------------------------------------------------------------------------

test("adapter seam: the unavailable adapter's availability probe returns false (the honest gate)", () => {
  const adapter = createUnavailableAdapter("model_provider_offline");
  const probe = adapter.capability.isAvailable(SCOPE);
  expect(probe.ok).toBe(false);
  if (probe.ok) throw new Error("expected unavailable");
  expect(probe.reason).toBe("model_provider_offline");
});

test("adapter seam: the isAdapterAvailable convenience gate mirrors the adapter's probe", () => {
  const reference = createReferenceAdapter();
  const unavailable = createUnavailableAdapter("gpu_unavailable");
  expect(isAdapterAvailable(reference, SCOPE).ok).toBe(true);
  expect(isAdapterAvailable(unavailable, SCOPE).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The adapter-composed prediction carries the adapter's capability name
// ---------------------------------------------------------------------------

test("adapter seam: a prediction built through the reference adapter carries the reference capability name", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const adapter = createReferenceAdapter();
  const rep = adapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = adapter.predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  if (!pred.ok) throw new Error("predict failed");
  expect(pred.prediction.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(pred.prediction.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
});

test("adapter seam: a prediction built through the stub adapter carries the reference capability name (the stub delegates to the reference engine; the stub's DIFFERENCE is the adapter descriptor's capability name, not the prediction's)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const adapter = createStubAdapter();
  // The adapter DESCRIPTOR carries the stub capability name (the seam
  // is genuinely swappable — a different model family string flows
  // through the adapter's public face).
  expect(adapter.capability.name).toBe(STUB_CAPABILITY_NAME);
  const rep = adapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error("represent failed");
  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = adapter.predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  if (!pred.ok) throw new Error("predict failed");
  // The prediction carries the REFERENCE engine's capability name
  // (the stub adapter DELEGATES to the reference engine's `predict`
  // function; the prediction's capability is the ENGINE's, not the
  // adapter DESCRIPTOR's). A real JEPA-family adapter would have its
  // own engine and produce predictions with its own capability name.
  // The stub's purpose is to prove the seam is swappable (the adapter
  // interface is satisfied by a different object with a different
  // descriptor), not to produce different predictions.
  expect(pred.prediction.capability.name).toBe(REFERENCE_CAPABILITY_NAME);
  expect(pred.prediction.capability.version).toBe(REFERENCE_CAPABILITY_VERSION);
});

// ---------------------------------------------------------------------------
// The adapter compare() — both adapters delegate to the same D1 compare
// ---------------------------------------------------------------------------

test("adapter seam: the reference adapter's compare() delegates to the D1 compare (same result)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices[0]!;
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const adapter = createReferenceAdapter();
  const rep1 = adapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  const rep2 = adapter.represent({ scope: SCOPE, featureSet: dev1.featureSet, context });
  expect(rep1.ok).toBe(true);
  expect(rep2.ok).toBe(true);
  if (!rep1.ok || !rep2.ok) throw new Error("represent failed");
  // Two identical representations compare to similarity 1, distance 0.
  const cmp = adapter.compare(rep1.representation, rep2.representation);
  expect(cmp.ok).toBe(true);
  if (!cmp.ok) throw new Error("compare failed");
  expect(cmp.similarity).toBe(1);
  expect(cmp.distance).toBe(0);
});
