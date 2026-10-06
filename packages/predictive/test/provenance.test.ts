/**
 * W153 predictive — the provenance trust anchor proof.
 *
 * ADR-0002 invariant 2: "Observations/events remain immutable and
 * auditable." ADR-0002 invariant 3: "Every feature set carries ...
 * an input digest." The trust anchor (`verifyFeatureSetProvenance`)
 * does NOT trust the feature set's own `inputDigest` field — it
 * RE-DERIVES the digest from the supplied observations and compares.
 *
 * This battery proves:
 *   - a GENUINE feature set (the same observations used to extract it)
 *     is VERIFIED;
 *   - a TAMPERED feature set (a feature value overwritten) is REFUSED
 *     with `digest_mismatch` (the re-derived digest of the supplied
 *     observations does not match the feature set's `inputDigest`
 *     claim — but the feature values themselves are not re-derived
 *     by the trust anchor; the anchor verifies the INPUT, not the
 *     output. A tampered value with the same input would PASS the
 *     anchor — that's the W154 engine's job to detect, not W153's.
 *     For this battery, "tampered value" means tampering with the
 *     `inputDigest` field — which the anchor catches via re-derivation);
 *   - a feature set claiming a MISSING observation ref (an id not in
 *     the supplied observations) is REFUSED with `missing_observation_ref`;
 *   - a feature set with a CROSS-TENANT observation (the observation's
 *     own tenant scope does not match the feature set's tenant) is
 *     REFUSED with `cross_tenant_ref`;
 *   - a feature set whose `inputDigest` field does not match the
 *     re-derived digest of the supplied observations is REFUSED with
 *     `digest_mismatch`;
 *   - a feature set with a stale schema/extractor version is REFUSED
 *     with `schema_version_mismatch` / `extractor_version_mismatch`;
 *   - a feature set whose tenant does not match the acting scope is
 *     REFUSED with `tenant_mismatch`.
 */

import { test, expect } from "bun:test";
import {
  CORR_1,
  CORR_2,
  CAUSATION_1,
  DEV_1,
  DEV_2,
  DEMO_WINDOW,
  EXTRACTED_AT,
  T1,
  T2,
  TENANT_B,
  TENANT_ID,
  makeObservation,
  resetObservationCounter,
  seedDemoFleet,
} from "./helpers";
import {
  EXTRACTOR_VERSION,
  FEATURE_SET_SCHEMA_VERSION,
  extractDeviceHistoryFeatures,
  verifyFeatureSetProvenance,
} from "../src/index";
import type { DeviceHistoryFeatureSet } from "../src/index";
import type { DomainError, ValidationError, FleetError } from "@fleetos/contracts";

/** Type-narrow a FleetError to a DomainError (throws if it's the wrong kind — test-only). */
function asDomainError(e: FleetError): DomainError {
  if (e.kind !== "DomainError") throw new Error(`expected DomainError, got ${e.kind}`);
  return e;
}

/** Type-narrow a FleetError to a ValidationError (throws if it's the wrong kind — test-only). */
function asValidationError(e: FleetError): ValidationError {
  if (e.kind !== "ValidationError") throw new Error(`expected ValidationError, got ${e.kind}`);
  return e;
}

// ---------------------------------------------------------------------------
// The genuine feature set (verified)
// ---------------------------------------------------------------------------

test("provenance: a genuine feature set (the same observations used to extract it) is VERIFIED", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT, causationId: CAUSATION_1 },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(`verification failed: ${verification.error.message}`);
  expect(verification.inputDigest).toBe(extraction.featureSet.inputDigest);
});

// ---------------------------------------------------------------------------
// The tampered input digest (REFUSED with digest_mismatch)
// ---------------------------------------------------------------------------

test("provenance: a feature set whose `inputDigest` field was overwritten is REFUSED with `digest_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Tamper with the inputDigest field (overwrite it with a fake digest).
  const tampered: DeviceHistoryFeatureSet = {
    ...extraction.featureSet,
    inputDigest: "0".repeat(64),
  };
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: tampered,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(verification.error.code).toBe("predictive.provenance.mismatch");
  expect(asDomainError(verification.error).invariant).toBe("digest_mismatch");
});

// ---------------------------------------------------------------------------
// The missing observation ref (REFUSED with missing_observation_ref)
// ---------------------------------------------------------------------------

test("provenance: a feature set with a `sourceObservationRef` not in the supplied observations is REFUSED with `missing_observation_ref`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Tamper with the inputObservationRefs (add a fake ref).
  const tampered: DeviceHistoryFeatureSet = {
    ...extraction.featureSet,
    inputObservationRefs: [...extraction.featureSet.inputObservationRefs, "obs_w153fake99999"],
  };
  // Supply a subset of the observations (so the fake ref is missing).
  const subset = dev1.observations.slice(0, 1);
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: tampered,
      observations: subset,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("missing_observation_ref");
});

// ---------------------------------------------------------------------------
// The cross-tenant observation (REFUSED with cross_tenant_ref)
// ---------------------------------------------------------------------------

test("provenance: a feature set with a cross-tenant observation is REFUSED with `cross_tenant_ref`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Inject a foreign tenant scope onto one of the supplied observations.
  const foreignTenantObs = {
    ...dev1.observations[0]!,
    tenantId: TENANT_B,
  };
  const observationsWithForeign = [foreignTenantObs, ...dev1.observations.slice(1)];
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: observationsWithForeign,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("cross_tenant_ref");
});

// ---------------------------------------------------------------------------
// The window-mismatch refusal (an observation outside the feature set's window)
// ---------------------------------------------------------------------------

test("provenance: an observation outside the feature set's window is REFUSED with `window_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Add an observation OUTSIDE the feature set's window [T1, T7).
  // An observation at a far-future timestamp falls outside.
  const outOfWindowObs = makeObservation("device.security", "2026-12-31T23:59:59Z", { batteryLevel: 99 });
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: [...dev1.observations, outOfWindowObs],
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("window_mismatch");
});

// ---------------------------------------------------------------------------
// The schema/extractor version mismatch
// ---------------------------------------------------------------------------

test("provenance: a feature set with a stale schemaVersion is REFUSED with `schema_version_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Tamper with the schemaVersion (claim a different version).
  const stale: DeviceHistoryFeatureSet = {
    ...extraction.featureSet,
    schemaVersion: FEATURE_SET_SCHEMA_VERSION + 1,
  };
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: stale,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("schema_version_mismatch");
});

test("provenance: a feature set with a stale extractorVersion is REFUSED with `extractor_version_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  const stale: DeviceHistoryFeatureSet = {
    ...extraction.featureSet,
    extractorVersion: EXTRACTOR_VERSION + 1,
  };
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: stale,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("extractor_version_mismatch");
});

// ---------------------------------------------------------------------------
// The tenant mismatch (feature set's tenant does not match the acting scope)
// ---------------------------------------------------------------------------

test("provenance: a feature set whose tenant does not match the acting scope is REFUSED with `tenant_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Verify under a foreign tenant scope.
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_B, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("tenant_mismatch");
});

// ---------------------------------------------------------------------------
// The device mismatch (feature set's device does not match the expected)
// ---------------------------------------------------------------------------

test("provenance: a feature set whose device does not match the expected device is REFUSED with `device_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Verify with an expectedDeviceId of DEV_2.
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
      expectedDeviceId: DEV_2,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("device_mismatch");
});

// ---------------------------------------------------------------------------
// The window mismatch (expected window does not match the feature set's)
// ---------------------------------------------------------------------------

test("provenance: a feature set whose window does not match the expected window is REFUSED with `window_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  // Verify with an expectedWindow that doesn't match the feature set's.
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
      expectedWindow: { from: T1, to: T2 },
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected refusal");
  expect(asDomainError(verification.error).invariant).toBe("window_mismatch");
});

// ---------------------------------------------------------------------------
// Invalid input (typed ValidationError — never throws raw)
// ---------------------------------------------------------------------------

test("provenance: an invalid input (missing verifiedAt) => a typed ValidationError (never throws raw)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: "not-a-timestamp" },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected failure");
  expect(verification.error.kind).toBe("ValidationError");
  expect(asValidationError(verification.error).code).toBe("predictive.provenance.invalid_request");
  expect(asValidationError(verification.error).failures.some((f) => f.path === "/verifiedAt" && f.reason === "not_iso")).toBe(true);
});

test("provenance: a missing scope => a typed DomainError (never throws raw)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: "" as never, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);
  if (verification.ok) throw new Error("expected failure");
  expect(verification.error.kind).toBe("DomainError");
  expect(asDomainError(verification.error).invariant).toBe("invalid_input");
});

// ---------------------------------------------------------------------------
// Provenance determinism (the verification is byte-identical across re-runs)
// ---------------------------------------------------------------------------

test("provenance: the verification result is byte-identical across re-runs (the trust anchor is deterministic)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");

  const v1 = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  const v2 = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: [...dev1.observations],
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(v1.ok).toBe(true);
  expect(v2.ok).toBe(true);
  if (!v1.ok || !v2.ok) throw new Error("verification failed");
  expect(v1.inputDigest).toBe(v2.inputDigest);
  expect(v1.verifiedAt).toBe(v2.verifiedAt);
});
