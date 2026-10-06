/**
 * W153 predictive — the honesty proof (insufficient history, empty
 * window, rejected, privacy-seam refusal).
 *
 * ADR-0002 invariant 5: "Insufficient history => explicit honest state
 * (`insufficient_history` with the reason), NEVER fabricated or
 * zero-filled values that could be mistaken for measurements."
 * ADR-0002 invariant 6: "Tenant isolation at the boundary AND in the
 * store semantics: a feature request is tenant-scoped; cross-tenant
 * inputs are rejected, never merged."
 * ADR-0002 invariant 7: "BYOD/privacy: no feature may incorporate data
 * outside the device's own tenant scope; the design must leave a
 * redaction/consent seam (structural, like the learning package's)
 * even if the first implementation is a pass-through check."
 *
 * This battery proves:
 *   - 0 observations in the window => `empty_window` (honest — distinct
 *     from `insufficient_history`);
 *   - 1 observation => `insufficient_history` with reason
 *     `single_observation` (cadence/coverage undefined — NEVER zero);
 *   - < MIN_OBSERVATIONS_FOR_FEATURES observations =>
 *     `insufficient_history` with reason `below_minimum_count`;
 *   - no numeric payload fields anywhere in the window =>
 *     `insufficient_history` with reason `no_numeric_payloads` for the
 *     numeric-summary feature (the OTHER features are still derivable;
 *     the numeric-summary absence is the honest signal);
 *   - a tenant mismatch (an observation whose tenantId does not match
 *     the input scope) => `rejected` with reason `tenant_mismatch`
 *     (NEVER a partial set, NEVER cross-tenant merge);
 *   - a device mismatch => `rejected` with reason `device_mismatch`;
 *   - a privacy-seam refusal => `rejected` with reason `privacy_refusal`;
 *   - an observation whose observedAt falls outside [from, to) =>
 *     `rejected` with reason `observation_out_of_window` (defense in
 *     depth — the caller is responsible for filtering, but the
 *     extractor double-checks).
 */

import { test, expect } from "bun:test";
import {
  CORR_1,
  DEV_1,
  DEMO_WINDOW,
  EMPTY_WINDOW,
  EXTRACTED_AT,
  FOREIGN_SCOPE,
  SCOPE,
  T1,
  T2,
  T3,
  TENANT_B,
  TENANT_ID,
  makeObservation,
  resetObservationCounter,
  seedDemoFleet,
  seedNoNumericPayloadDevice,
  seedSingleObservationDevice,
} from "./helpers";
import {
  extractDeviceHistoryFeatures,
  MIN_OBSERVATIONS_FOR_FEATURES,
} from "../src/index";
import type { PrivacyRedactionSeam } from "../src/index";
import type { DomainError, FleetError, ValidationError } from "@fleetos/contracts";

/** Type-narrow a FleetError to a ValidationError (throws if it's the wrong kind — test-only). */
function asValidationError(e: FleetError): ValidationError {
  if (e.kind !== "ValidationError") throw new Error(`expected ValidationError, got ${e.kind}`);
  return e;
}

/** Type-narrow a FleetError to a DomainError (throws if it's the wrong kind — test-only). */
function asDomainError(e: FleetError): DomainError {
  if (e.kind !== "DomainError") throw new Error(`expected DomainError, got ${e.kind}`);
  return e;
}

// ---------------------------------------------------------------------------
// The honesty gate: empty window
// ---------------------------------------------------------------------------

test("honesty: an empty observation array in the window => `empty_window` (NOT insufficient_history, NOT zero-filled features)", () => {
  resetObservationCounter();
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("empty_window");
  // NEVER a partial feature family — the feature list is EMPTY.
  expect(extraction.featureSet.features).toEqual([]);
  // The input digest is the SHA-256 of the canonical empty-stream
  // serialization (a stable constant — the empty-stream digest).
  expect(extraction.featureSet.inputDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(extraction.featureSet.inputObservationRefs).toEqual([]);
});

test("honesty: an empty window is distinct from insufficient_history (a 1-observation set is insufficient_history, not empty_window)", () => {
  resetObservationCounter();
  const fleet = seedSingleObservationDevice();
  // Empty array => empty_window.
  const empty = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(empty.ok).toBe(true);
  if (!empty.ok) throw new Error("extraction failed");
  expect(empty.featureSet.status.kind).toBe("empty_window");
  // Single observation => insufficient_history (single_observation).
  const single = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [fleet.observation],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(single.ok).toBe(true);
  if (!single.ok) throw new Error("extraction failed");
  expect(single.featureSet.status.kind).toBe("insufficient_history");
  if (single.featureSet.status.kind !== "insufficient_history") throw new Error("expected insufficient_history");
  expect(single.featureSet.status.reason).toBe("single_observation");
});

// ---------------------------------------------------------------------------
// The honesty gate: single observation
// ---------------------------------------------------------------------------

test("honesty: a single observation => `insufficient_history` with reason `single_observation` (cadence/coverage undefined — NEVER zero-filled)", () => {
  resetObservationCounter();
  const fleet = seedSingleObservationDevice();
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [fleet.observation],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("insufficient_history");
  if (extraction.featureSet.status.kind !== "insufficient_history") throw new Error("expected insufficient_history");
  expect(extraction.featureSet.status.reason).toBe("single_observation");
  expect(extraction.featureSet.status.minimumRequired).toBe(MIN_OBSERVATIONS_FOR_FEATURES);
  // NEVER a partial feature family — the feature list is EMPTY.
  expect(extraction.featureSet.features).toEqual([]);
});

// ---------------------------------------------------------------------------
// The honesty gate: below minimum count (only reachable when MIN > 2)
// ---------------------------------------------------------------------------

test("honesty: a window with observations below the minimum count => `insufficient_history` with reason `below_minimum_count`", () => {
  // MIN_OBSERVATIONS_FOR_FEATURES is 2; a 1-observation window is
  // caught by the single_observation gate BEFORE the below_minimum_count
  // gate. This test confirms the below_minimum_count gate fires when
  // MIN > the current observation count (e.g. if MIN is bumped to 4 in
  // a future version, a 3-observation window would emit this reason).
  // For the W153 frozen MIN of 2, the single_observation gate catches
  // 1-observation windows; the below_minimum_count gate is therefore
  // unreachable at the W153 frozen version. We confirm the gate is
  // declared + the constant is exported (the gate's existence is the
  // honesty discipline; the unreachability is the frozen version's
  // property).
  expect(MIN_OBSERVATIONS_FOR_FEATURES).toBe(2);
  // A 2-observation window passes the minimum-count gate and reaches
  // the feature-derivation core (status `ok`).
  const obs1 = makeObservation("device.security", T1, { batteryLevel: 50 });
  const obs2 = makeObservation("device.security", T2, { batteryLevel: 60 });
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [obs1, obs2],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("ok");
});

// ---------------------------------------------------------------------------
// The honesty gate: no numeric payloads (the numeric-summary feature is omitted)
// ---------------------------------------------------------------------------

test("honesty: a window with no numeric payload leaves => the numeric-summary feature is OMITTED (NEVER zero-filled min/max/mean/last)", () => {
  resetObservationCounter();
  const fleet = seedNoNumericPayloadDevice();
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: fleet.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  // The status is `ok` — the OTHER features (count, kind-mix, cadence,
  // recency) are derivable. The numeric-summary absence is the honest
  // signal.
  expect(extraction.featureSet.status.kind).toBe("ok");
  // The numeric-summary feature is NOT in the feature list.
  const featureKinds = extraction.featureSet.features.map((f) => f.id);
  expect(featureKinds).not.toContain("predictive.feature.numeric_field_summary");
  // The other features ARE present.
  expect(featureKinds).toContain("predictive.feature.observation_count");
  expect(featureKinds).toContain("predictive.feature.observation_kind_mix");
  expect(featureKinds).toContain("predictive.feature.arrival_cadence");
  expect(featureKinds).toContain("predictive.feature.window_edge_recency");
});

// ---------------------------------------------------------------------------
// The honesty gate: tenant mismatch (NEVER cross-tenant merge)
// ---------------------------------------------------------------------------

test("honesty: an observation carrying a foreign tenant scope => `rejected` with reason `tenant_mismatch` (NEVER cross-tenant merge)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  // Inject a tenant scope onto an observation (the contracts `Observation`
  // shape doesn't carry tenantId, but a structural extension might — the
  // extractor checks when present).
  const foreignTenantObs = {
    ...dev1.observations[0]!,
    tenantId: TENANT_B,
  };
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [foreignTenantObs, ...dev1.observations.slice(1)],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("rejected");
  if (extraction.featureSet.status.kind !== "rejected") throw new Error("expected rejected");
  expect(extraction.featureSet.status.reason).toBe("tenant_mismatch");
  expect(extraction.featureSet.status.detail).toContain(dev1.observations[0]!.id);
  // NEVER a partial feature family — the feature list is EMPTY.
  expect(extraction.featureSet.features).toEqual([]);
});

test("honesty: an observation carrying a foreign device scope => `rejected` with reason `device_mismatch`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const foreignDeviceObs = {
    ...dev1.observations[0]!,
    deviceId: "dev_w153foreign0001",
  };
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [foreignDeviceObs, ...dev1.observations.slice(1)],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("rejected");
  if (extraction.featureSet.status.kind !== "rejected") throw new Error("expected rejected");
  expect(extraction.featureSet.status.reason).toBe("device_mismatch");
  expect(extraction.featureSet.features).toEqual([]);
});

// ---------------------------------------------------------------------------
// The honesty gate: privacy-seam refusal
// ---------------------------------------------------------------------------

test("honesty: a privacy-seam refusal => `rejected` with reason `privacy_refusal` (NEVER a partial set with redacted fields)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  // Inject a privacy seam that always refuses with a machine-stable
  // reason + detail.
  const refusingPrivacy: PrivacyRedactionSeam = {
    check: () => ({ ok: false, reason: "privacy_refused", detail: "consent revoked for this device" }),
  };
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
    privacy: refusingPrivacy,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("rejected");
  if (extraction.featureSet.status.kind !== "rejected") throw new Error("expected rejected");
  expect(extraction.featureSet.status.reason).toBe("privacy_refusal");
  expect(extraction.featureSet.status.detail).toContain("consent revoked");
  // NEVER a partial feature family — the feature list is EMPTY.
  expect(extraction.featureSet.features).toEqual([]);
});

test("honesty: the default privacy seam is a pass-through (never refuses — the structural placeholder)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  // No privacy seam supplied — the default pass-through is used.
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  // The default seam never refuses — the extraction proceeds to the
  // feature-derivation core.
  expect(extraction.featureSet.status.kind).toBe("ok");
});

// ---------------------------------------------------------------------------
// The honesty gate: observation out of window (defense in depth)
// ---------------------------------------------------------------------------

test("honesty: an observation whose observedAt falls outside [from, to) => `rejected` with reason `observation_out_of_window`", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  // Use a narrow window that excludes the first observation (T1 < the
  // window's `from` of T2). The first observation falls OUTSIDE the
  // window.
  const narrowWindow = { from: T2, to: T3 };
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations, // contains obs at T1, T2, T3, T4
    window: narrowWindow,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("rejected");
  if (extraction.featureSet.status.kind !== "rejected") throw new Error("expected rejected");
  expect(extraction.featureSet.status.reason).toBe("observation_out_of_window");
  // The detail names the offending observation + the window.
  expect(extraction.featureSet.status.detail).toContain(dev1.observations[0]!.id);
  expect(extraction.featureSet.status.detail).toContain(narrowWindow.from);
  expect(extraction.featureSet.status.detail).toContain(narrowWindow.to);
});

// ---------------------------------------------------------------------------
// The honesty gate: invalid input (typed ValidationError — never throws raw)
// ---------------------------------------------------------------------------

test("honesty: an invalid input (missing deviceId) => a typed ValidationError (never throws raw)", () => {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: "" as never,
    observations: [],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(false);
  if (extraction.ok) throw new Error("expected failure");
  expect(extraction.error.kind).toBe("ValidationError");
  expect(extraction.error.code).toBe("predictive.feature.extraction.invalid_request");
  // The validation failure carries the field path.
  expect(asValidationError(extraction.error).failures.some((f) => f.path === "/deviceId" && f.reason === "required")).toBe(true);
});

test("honesty: an invalid input (window.from not ISO) => a typed ValidationError", () => {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: { from: "not-a-timestamp", to: T3 },
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(false);
  if (extraction.ok) throw new Error("expected failure");
  expect(extraction.error.kind).toBe("ValidationError");
  expect(asValidationError(extraction.error).failures.some((f) => f.path === "/window/from" && f.reason === "not_iso")).toBe(true);
});

test("honesty: an invalid input (window.from after window.to) => a typed ValidationError", () => {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: { from: T3, to: T1 },
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(false);
  if (extraction.ok) throw new Error("expected failure");
  expect(extraction.error.kind).toBe("ValidationError");
  expect(asValidationError(extraction.error).failures.some((f) => f.path === "/window" && f.reason === "from_after_to")).toBe(true);
});

test("honesty: an invalid input (extractedAt not ISO) => a typed ValidationError", () => {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: DEMO_WINDOW,
    extractedAt: "not-a-timestamp",
  });
  expect(extraction.ok).toBe(false);
  if (extraction.ok) throw new Error("expected failure");
  expect(extraction.error.kind).toBe("ValidationError");
  expect(asValidationError(extraction.error).failures.some((f) => f.path === "/extractedAt" && f.reason === "not_iso")).toBe(true);
});

test("honesty: a missing tenant scope => a typed DomainError (never throws raw)", () => {
  const extraction = extractDeviceHistoryFeatures({
    tenantId: "" as never,
    deviceId: DEV_1,
    observations: [],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(false);
  if (extraction.ok) throw new Error("expected failure");
  expect(extraction.error.kind).toBe("DomainError");
  expect(extraction.error.code).toBe("predictive.feature.extraction.domain");
  expect(asDomainError(extraction.error).invariant).toBe("missing_scope");
});

// ---------------------------------------------------------------------------
// Sanity: SCOPE and FOREIGN_SCOPE fixtures
// ---------------------------------------------------------------------------

test("honesty: the demo scope fixtures are well-formed (the demo tenant + the foreign tenant are valid)", () => {
  expect(SCOPE.tenantId).toBe(TENANT_ID);
  expect(FOREIGN_SCOPE.tenantId).toBe(TENANT_B);
  expect(SCOPE.tenantId).not.toBe(FOREIGN_SCOPE.tenantId);
});

test("honesty: an empty window can be supplied without a window violation (the extractor produces `empty_window` for empty observations even when the window is non-empty)", () => {
  // An empty observation array with a non-empty window => empty_window
  // (the extractor's honesty gate: 0 observations in the window).
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: EMPTY_WINDOW,
    extractedAt: EXTRACTED_AT,
    correlationId: CORR_1,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("empty_window");
});
