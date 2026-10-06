/**
 * W153 predictive — D1 tests: the device-history feature extractor
 * (correctness, honesty, tenant isolation, privacy seam, audit).
 */

import { test, expect } from "bun:test";
import {
  EXTRACTOR_VERSION,
  FEATURE_SET_SCHEMA_VERSION,
  MINIMUM_WINDOW_OBSERVATIONS,
  PASS_THROUGH_PRIVACY_GATE,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  type AdmittedDeviceObservation,
  type DeviceFeature,
  type DeviceHistoryFeatureInput,
  type DeviceHistoryPrivacyDecision,
  type DeviceHistoryPrivacyGate,
  type FeatureDigestFn,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  DEV_A2,
  TENANT_A,
  TENANT_B,
  T0,
  absoluteWindow,
  admitted,
  atHour,
  numericHistory,
  nextObservationId,
  relativeWindow,
} from "./helpers";
import { asDeviceId, asObservationId } from "@fleetos/contracts";

/** A canonical extractor input over the numeric history. */
function numericInput(overrides: Partial<DeviceHistoryFeatureInput> = {}): DeviceHistoryFeatureInput {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
    ...overrides,
  };
}

/** Find one feature by id (asserts presence first). */
function featureOf(set: ReturnType<typeof extractDeviceHistoryFeatures>, id: string): DeviceFeature {
  const feature = set.features.find((f) => f.id === id);
  if (feature === undefined) throw new Error(`feature missing: ${id}`);
  return feature;
}

// ---------------------------------------------------------------------------
// The ok path: the full v1 family over a numeric history
// ---------------------------------------------------------------------------

test("the ok path derives the full v1 family with per-feature provenance", () => {
  const set = extractDeviceHistoryFeatures(numericInput());
  expect(set.status).toEqual({ kind: "ok" });
  expect(set.tenantId).toBe(TENANT_A);
  expect(set.deviceId).toBe(DEV_A1);
  expect(set.featureSetSchemaVersion).toBe(FEATURE_SET_SCHEMA_VERSION);
  expect(set.extractorVersion).toBe(EXTRACTOR_VERSION);
  expect(set.extractedAt).toBe(atHour(24));
  expect(set.privacy).toEqual({ state: "raw", appliedPolicies: [] });

  // Cadence: 6 observations at hours 0,2,4,6,8,10.
  expect(featureOf(set, "observation.count").value).toBe(6);
  expect(featureOf(set, "arrival.first_observed_at").value).toBe(atHour(0));
  expect(featureOf(set, "arrival.last_observed_at").value).toBe(atHour(10));
  expect(featureOf(set, "window.span_ms").value).toBe(10 * 3_600_000);
  // Gaps are uniform 2h.
  expect(featureOf(set, "arrival.interarrival_min_ms").value).toBe(2 * 3_600_000);
  expect(featureOf(set, "arrival.interarrival_max_ms").value).toBe(2 * 3_600_000);
  expect(featureOf(set, "arrival.interarrival_mean_ms").value).toBe(2 * 3_600_000);
  // Recency: the exclusive `to` edge (hour 24) minus the last arrival (hour 10).
  expect(featureOf(set, "arrival.recency_last_ms").value).toBe(14 * 3_600_000);

  // Kind mix: every observation is device.health.
  expect(featureOf(set, "kind.device.health.count").value).toBe(6);
  expect(featureOf(set, "kind.device.health.fraction").value).toBe(1);

  // Field presence: batteryLevel + temperatureC in 6/6; diskEncryption in 5/6.
  expect(featureOf(set, "payload.batteryLevel.presence_fraction").value).toBe(1);
  expect(featureOf(set, "payload.temperatureC.presence_fraction").value).toBe(1);
  expect(featureOf(set, "payload.diskEncryption.presence_fraction").value).toBe(5 / 6);

  // Numeric summaries over the canonical (arrival) order.
  expect(featureOf(set, "payload.batteryLevel.min").value).toBe(62);
  expect(featureOf(set, "payload.batteryLevel.max").value).toBe(100);
  expect(featureOf(set, "payload.batteryLevel.mean").value).toBe((100 + 96 + 90 + 84 + 74 + 62) / 6);
  expect(featureOf(set, "payload.batteryLevel.last").value).toBe(62);
  expect(featureOf(set, "payload.temperatureC.min").value).toBe(42.5);
  expect(featureOf(set, "payload.temperatureC.last").value).toBe(47.75);

  // NO numeric summary for the boolean field (never fabricated stats).
  expect(set.features.find((f) => f.id === "payload.diskEncryption.min")).toBeUndefined();

  // Per-feature provenance: source refs + method id + method version.
  const count = featureOf(set, "observation.count");
  expect(count.unit).toBe("count");
  expect([...count.provenance.sourceObservationIds]).toHaveLength(6);
  expect(count.provenance.methodId).toBe("count");
  expect(count.provenance.methodVersion).toBe(1);
  const diskPresence = featureOf(set, "payload.diskEncryption.presence_fraction");
  expect([...diskPresence.provenance.sourceObservationIds]).toHaveLength(5);
  expect(diskPresence.provenance.methodId).toBe("payload.field_presence");

  // The refs are the canonical (observedAt, id) order.
  expect([...set.inputObservationIds]).toEqual([
    "obs_num0001",
    "obs_num0002",
    "obs_num0003",
    "obs_num0004",
    "obs_num0005",
    "obs_num0006",
  ]);
  expect(set.inputDigest?.algorithm).toBe("sha256");
  expect(set.inputDigest?.value).toMatch(/^[0-9a-f]{64}$/);
});

test("kind mix only lists kinds PRESENT (a mixed-kind window)", () => {
  const observations: AdmittedDeviceObservation[] = [
    admitted({ id: asObservationId("obs_mix1"), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: { a: 1 } }),
    admitted({ id: asObservationId("obs_mix2"), kind: "device.power", observedAt: atHour(1), schemaVersion: 1, payload: { b: 2 } }),
    admitted({ id: asObservationId("obs_mix3"), kind: "device.power", observedAt: atHour(2), schemaVersion: 1, payload: { b: 3 } }),
    admitted({ id: asObservationId("obs_mix4"), kind: "device.security", observedAt: atHour(3), schemaVersion: 1, payload: { c: true } }),
  ];
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations,
    window: absoluteWindow(T0, atHour(10)),
    extractedAt: atHour(10),
  });
  expect(set.status).toEqual({ kind: "ok" });
  expect(featureOf(set, "kind.device.health.fraction").value).toBe(0.25);
  expect(featureOf(set, "kind.device.power.fraction").value).toBe(0.5);
  expect(featureOf(set, "kind.device.security.fraction").value).toBe(0.25);
  // A kind feature never fabricated for an absent kind.
  expect(set.features.find((f) => f.id === "kind.device.location.count")).toBeUndefined();
});

test("non-object payloads contribute to cadence but never to field features", () => {
  const observations: AdmittedDeviceObservation[] = [
    admitted({ id: asObservationId("obs_obj1"), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: { batteryLevel: 50 } }),
    admitted({ id: asObservationId("obs_arr1"), kind: "device.health", observedAt: atHour(2), schemaVersion: 1, payload: [1, 2, 3] }),
    admitted({ id: asObservationId("obs_str1"), kind: "device.health", observedAt: atHour(4), schemaVersion: 1, payload: "plain" }),
  ];
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations,
    window: absoluteWindow(T0, atHour(10)),
    extractedAt: atHour(10),
  });
  expect(set.status).toEqual({ kind: "ok" });
  expect(featureOf(set, "observation.count").value).toBe(3);
  // batteryLevel present in 1 of 3 (the denominator is EVERY in-window observation).
  expect(featureOf(set, "payload.batteryLevel.presence_fraction").value).toBe(1 / 3);
  expect(featureOf(set, "payload.batteryLevel.last").value).toBe(50);
});

test("a mixed-type field is never numerically summarized (no fabricated stats)", () => {
  const observations: AdmittedDeviceObservation[] = [
    admitted({ id: asObservationId("obs_mt1"), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: { level: 10 } }),
    admitted({ id: asObservationId("obs_mt2"), kind: "device.health", observedAt: atHour(2), schemaVersion: 1, payload: { level: "unknown" } }),
  ];
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations,
    window: absoluteWindow(T0, atHour(10)),
    extractedAt: atHour(10),
  });
  expect(set.status).toEqual({ kind: "ok" });
  expect(featureOf(set, "payload.level.presence_fraction").value).toBe(1);
  expect(set.features.find((f) => f.id === "payload.level.min")).toBeUndefined();
  expect(set.features.find((f) => f.id === "payload.level.mean")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Honesty: empty window, insufficient history — never zeros
// ---------------------------------------------------------------------------

test("an empty window yields the honest empty_window state (digest over the empty selection)", () => {
  const set = extractDeviceHistoryFeatures({
    ...numericInput(),
    window: absoluteWindow(atHour(100), atHour(200)),
  });
  expect(set.status).toEqual({ kind: "empty_window" });
  expect(set.features).toEqual([]);
  expect([...set.inputObservationIds]).toEqual([]);
  // The digest still anchors the (empty) derivation — sha256 over "[]".
  expect(set.inputDigest?.value).toHaveLength(64);
  // NEVER a zero-filled feature that could be mistaken for a measurement.
  expect(set.features.length).toBe(0);
});

test("insufficient history (one observation) yields the explicit state with the minimum the extractor needs", () => {
  const single = numericHistory().slice(0, 1);
  const set = extractDeviceHistoryFeatures({ ...numericInput(), observations: single });
  expect(set.status).toEqual({
    kind: "insufficient_history",
    reason: "observation_count_below_minimum",
    observedCount: 1,
    minimumRequired: MINIMUM_WINDOW_OBSERVATIONS,
  });
  expect(set.features).toEqual([]);
  // The single ref is still anchored (the derivation claim is verifiable).
  expect([...set.inputObservationIds]).toEqual(["obs_num0001"]);
  expect(set.inputDigest).not.toBeNull();
});

test("out-of-window observations are excluded and never affect the set", () => {
  const all = numericHistory();
  const setIn = extractDeviceHistoryFeatures(numericInput());
  // Append a future observation OUTSIDE the window; the set must not change.
  const future = admitted({
    id: asObservationId("obs_future"),
    kind: "device.health",
    observedAt: atHour(30),
    schemaVersion: 1,
    payload: { batteryLevel: 999 },
  });
  const setOut = extractDeviceHistoryFeatures({
    ...numericInput(),
    observations: [...all, future],
  });
  expect(setOut.status).toEqual({ kind: "ok" });
  expect(setOut.inputDigest?.value).toBe(setIn.inputDigest?.value);
  expect(featureOf(setOut, "payload.batteryLevel.max").value).toBe(100);
});

// ---------------------------------------------------------------------------
// Tenant isolation + the privacy seam
// ---------------------------------------------------------------------------

test("a cross-tenant input is rejected, never merged (invariant 6)", () => {
  const foreign: AdmittedDeviceObservation[] = [
    admitted({ id: asObservationId("obs_own1"), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: { a: 1 } }),
    { tenantId: TENANT_B, deviceId: DEV_A1, observation: { id: asObservationId("obs_frn1"), kind: "device.health", observedAt: atHour(2), schemaVersion: 1, payload: { a: 2 } } },
  ];
  const set = extractDeviceHistoryFeatures({ ...numericInput(), observations: foreign });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("tenant_mismatch");
    expect(set.status.detail).toContain("tenant_mismatch");
  }
  // NEVER a partial set: no features, no refs, no digest.
  expect(set.features).toEqual([]);
  expect(set.inputObservationIds).toEqual([]);
  expect(set.inputDigest).toBeNull();
});

test("a cross-device input is rejected with no partial leakage", () => {
  const mixed: AdmittedDeviceObservation[] = [
    admitted({ id: asObservationId("obs_d1"), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: { a: 1 } }),
    { tenantId: TENANT_A, deviceId: DEV_A2, observation: { id: asObservationId("obs_d2"), kind: "device.health", observedAt: atHour(2), schemaVersion: 1, payload: { a: 2 } } },
  ];
  const set = extractDeviceHistoryFeatures({ ...numericInput(), observations: mixed });
  expect(set.status.kind).toBe("rejected");
  expect(set.features).toEqual([]);
});

test("an invalid tenant grammar is rejected as tenant_scope_invalid", () => {
  const set = extractDeviceHistoryFeatures({
    ...numericInput(),
    tenantId: "not-a-tenant" as typeof TENANT_A,
  });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("tenant_scope_invalid");
    expect(set.status.detail).toContain("tenantId");
  }
  expect(set.features).toEqual([]);
});

test("a privacy-gate refusal yields the rejected state with the violation detail (never a partial set)", () => {
  const refusingGate: DeviceHistoryPrivacyGate = {
    check(): DeviceHistoryPrivacyDecision {
      return { ok: false, reason: "byod_restricted", detail: "BYOD consent denied for this device" };
    },
  };
  const set = extractDeviceHistoryFeatures({ ...numericInput(), privacyGate: refusingGate });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("privacy_refused");
    expect(set.status.detail).toContain("byod_restricted");
    expect(set.status.detail).toContain("BYOD consent denied");
  }
  expect(set.features).toEqual([]);
  expect(set.inputDigest).toBeNull();
});

test("the privacy gate's redaction state flows onto the feature set", () => {
  const redactingGate: DeviceHistoryPrivacyGate = {
    check(): DeviceHistoryPrivacyDecision {
      return {
        ok: true,
        redaction: { state: "deidentified", appliedPolicies: ["pol_byod_deidentify"] },
      };
    },
  };
  const set = extractDeviceHistoryFeatures({ ...numericInput(), privacyGate: redactingGate });
  expect(set.status).toEqual({ kind: "ok" });
  expect(set.privacy).toEqual({ state: "deidentified", appliedPolicies: ["pol_byod_deidentify"] });
  // The pass-through gate is the documented default.
  expect(PASS_THROUGH_PRIVACY_GATE.check({ tenantId: TENANT_A, deviceId: DEV_A1, observationIds: [] })).toEqual({
    ok: true,
    redaction: { state: "raw", appliedPolicies: [] },
  });
});

// ---------------------------------------------------------------------------
// Malformed input + invalid windows
// ---------------------------------------------------------------------------

test("a malformed observation is rejected with a machine-stable path detail", () => {
  const bad = admitted({ id: asObservationId(""), kind: "device.health", observedAt: atHour(0), schemaVersion: 1, payload: {} });
  const set = extractDeviceHistoryFeatures({ ...numericInput(), observations: [numericHistory()[0]!, bad, numericHistory()[1]!] });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("malformed_input");
    expect(set.status.detail).toContain("/observations/1/observation/id:required");
  }
});

test("a duplicate observation id is rejected (the admitted stream admits each id exactly once)", () => {
  const first = numericHistory()[0]!;
  const duplicate = admitted({ ...first.observation }, TENANT_A, DEV_A1);
  const set = extractDeviceHistoryFeatures({ ...numericInput(), observations: [first, duplicate, numericHistory()[1]!] });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("malformed_input");
    expect(set.status.detail).toContain("duplicate");
  }
});

test("an invalid window is rejected (from must precede to)", () => {
  const set = extractDeviceHistoryFeatures({ ...numericInput(), window: absoluteWindow(atHour(10), atHour(0)) });
  expect(set.status.kind).toBe("rejected");
  if (set.status.kind === "rejected") {
    expect(set.status.reason).toBe("invalid_window");
    expect(set.status.detail).toContain("from_must_precede_to");
  }
});

test("a relative window resolves against the injected anchor (no clock read)", () => {
  const anchor = atHour(24);
  const set = extractDeviceHistoryFeatures({
    ...numericInput(),
    window: relativeWindow(anchor, 24 * 3_600_000),
  });
  expect(set.status).toEqual({ kind: "ok" });
  expect(set.window.kind).toBe("relative");
  expect(set.window.anchor).toBe(anchor);
  // Resolved [anchor - 24h, anchor) = [hour 0, hour 24): all 6 in-window.
  expect(featureOf(set, "observation.count").value).toBe(6);
  // Canonical UTC ISO formatting of the resolved edges.
  expect(set.window.from).toBe("2026-01-01T00:00:00.000Z");
  expect(set.window.to).toBe("2026-01-02T00:00:00.000Z");
  // Recency measured from the anchor edge: hour 24 - hour 10.
  expect(featureOf(set, "arrival.recency_last_ms").value).toBe(14 * 3_600_000);
});

// ---------------------------------------------------------------------------
// The digest seam + audit emission
// ---------------------------------------------------------------------------

test("the digest seam: an injected FeatureDigestFn replaces the default", () => {
  const injected: FeatureDigestFn = (canonical: string) => `injected(${canonical.length})`;
  const set = extractDeviceHistoryFeatures({ ...numericInput(), digest: injected });
  expect(set.inputDigest?.algorithm).toBe("sha256");
  // The injected implementation's output flows verbatim (structural seam).
  expect(set.inputDigest?.value.startsWith("injected(")).toBe(true);
  // (The byte-compat proof against the REAL apps/web sha256 lives in the
  // binding suite.)
});

test("every attributable extraction run emits one audit record; the invalid-tenant run never audits", () => {
  const sink = createInMemoryPredictiveAuditSink();
  extractDeviceHistoryFeatures({ ...numericInput(), auditSink: sink });
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]?.action).toBe("predictive.device_history.extracted");
  expect(sink.records[0]?.tenantId).toBe(TENANT_A);
  expect(sink.records[0]?.subject).toBe(DEV_A1);
  expect(sink.records[0]?.occurredAt).toBe(atHour(24));
  const details = sink.records[0]?.details as Record<string, unknown>;
  expect(details["statusKind"]).toBe("ok");
  expect(details["featureCount"]).toBeGreaterThan(0);
  expect(details["inputDigestValue"]).toBe(set0Digest());

  // A refusal audits the boundary holding.
  const refusingGate: DeviceHistoryPrivacyGate = {
    check: () => ({ ok: false, reason: "consent_denied", detail: "no consent" }),
  };
  extractDeviceHistoryFeatures({ ...numericInput(), privacyGate: refusingGate, auditSink: sink });
  expect(sink.records).toHaveLength(2);
  expect(sink.records[1]?.action).toBe("predictive.device_history.rejected");
  const refusalDetails = sink.records[1]?.details as Record<string, unknown>;
  expect(refusalDetails["reason"]).toBe("privacy_refused");

  // An unattributable (invalid tenant) run never audits.
  extractDeviceHistoryFeatures({
    ...numericInput(),
    tenantId: "bad" as typeof TENANT_A,
    auditSink: sink,
  });
  expect(sink.records).toHaveLength(2);
});

function set0Digest(): string | undefined {
  return extractDeviceHistoryFeatures(numericInput()).inputDigest?.value;
}

test("an insufficient-history run still audits (the honest state is evidence too)", () => {
  const sink = createInMemoryPredictiveAuditSink();
  extractDeviceHistoryFeatures({
    ...numericInput(),
    observations: numericHistory().slice(0, 1),
    auditSink: sink,
  });
  expect(sink.records).toHaveLength(1);
  const details = sink.records[0]?.details as Record<string, unknown>;
  expect(details["statusKind"]).toBe("insufficient_history");
  expect(details["featureCount"]).toBe(0);
});

test("nextObservationId emits stable unique ids (helper sanity)", () => {
  const a = nextObservationId();
  const b = nextObservationId();
  expect(a).not.toBe(b);
  expect(a.startsWith("obs_test")).toBe(true);
  expect(asDeviceId("dev_x") === "dev_x").toBe(true);
});
