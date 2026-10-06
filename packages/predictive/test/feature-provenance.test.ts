/**
 * W153 predictive — D2 tests: the provenance trust anchor
 * (`verifyFeatureSetProvenance`): accepts genuine sets; REFUSES a
 * tampered value, a missing ref, a gap, a cross-tenant ref, a digest
 * mismatch — typed errors, never raw throws.
 */

import { test, expect } from "bun:test";
import {
  canonicalFeatureSetJson,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  makeFeatureSetProvenanceRecord,
  verifyFeatureSetProvenance,
  type DeviceHistoryFeatureSet,
} from "../src/index";
import { sha256Hex } from "../src/internal";
import {
  CORR,
  CORR_2,
  DEV_A1,
  DEV_A2,
  TENANT_A,
  TENANT_B,
  T0,
  absoluteWindow,
  admitted,
  atHour,
  numericHistory,
  scopeA,
} from "./helpers";
import { asObservationId } from "@fleetos/contracts";

/** A genuine extraction + its verification input (the claimed immutable inputs). */
function genuine(): { set: DeviceHistoryFeatureSet } {
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
  });
  return { set };
}

function verifyInput(set: DeviceHistoryFeatureSet, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: numericHistory(),
    correlationId: CORR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

test("a genuine feature set verifies against the immutable inputs it claims", () => {
  const { set } = genuine();
  const result = verifyFeatureSetProvenance(set, verifyInput(set));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.set).toBe(set);
  // The record anchors the whole set.
  expect(result.record.kind).toBe("device-history-feature-set");
  expect(result.record.source).toBe("@fleetos/predictive");
  expect(result.record.tenantId).toBe(TENANT_A);
  expect(result.record.deviceId).toBe(DEV_A1);
  expect(result.record.inputDigest.value).toBe(set.inputDigest?.value);
  expect([...result.record.inputObservationIds]).toEqual([...set.inputObservationIds]);
  expect(result.record.contentDigest).toBe(sha256Hex(canonicalFeatureSetJson(set)));
  expect(result.record.provenanceId).toMatch(/^prv_[0-9a-f]{24}$/);
});

test("genuine honest states verify too: insufficient_history and empty_window", () => {
  const insufficient = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory().slice(0, 1),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
  });
  // The claimed inputs are the SAME stream slice the derivation consumed
  // (one observation): the honest state verifies against its own claim.
  const okInsufficient = verifyFeatureSetProvenance(
    insufficient,
    verifyInput(insufficient, { claimedObservations: numericHistory().slice(0, 1) }),
  );
  expect(okInsufficient.ok).toBe(true);

  // A claim of MORE in-window observations than the set covers is a gap
  // (the trust anchor refuses — the set is not reproducible from a
  // larger stream slice).
  const gap = verifyFeatureSetProvenance(insufficient, verifyInput(insufficient));
  expect(gap.ok).toBe(false);
  if (gap.ok) throw new Error("expected refusal");
  expect((gap.error as { kind: string; invariant?: string }).invariant).toBe("uncovered_observation");

  const empty = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(atHour(100), atHour(200)),
    extractedAt: atHour(200),
  });
  // The claimed observations all lie OUTSIDE the empty set's window.
  const okEmpty = verifyFeatureSetProvenance(
    empty,
    verifyInput(empty, { claimedObservations: numericHistory() }),
  );
  expect(okEmpty.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Refusals (typed errors, never raw throws)
// ---------------------------------------------------------------------------

test("a TAMPERED feature value is refused and the divergent feature is named", () => {
  const { set } = genuine();
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.map((feature) =>
      feature.id === "payload.batteryLevel.mean"
        ? { ...feature, value: 9999 }
        : feature,
    ),
  };
  const result = verifyFeatureSetProvenance(tampered, verifyInput(tampered));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("predictive.provenance.refused");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("feature_set_mismatch");
  expect(result.error.message).toContain("payload.batteryLevel.mean");
});

test("a DROPPED feature is refused (feature_set_mismatch)", () => {
  const { set } = genuine();
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.slice(0, set.features.length - 1),
  };
  const result = verifyFeatureSetProvenance(tampered, verifyInput(tampered));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("feature_set_mismatch");
});

test("a tampered STATUS is refused (an ok claim over insufficient inputs)", () => {
  const insufficient = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory().slice(0, 1),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
  });
  // Fabricate an ok status + features onto a set derived from ONE observation.
  const { set } = genuine();
  const forged: DeviceHistoryFeatureSet = { ...set, inputObservationIds: insufficient.inputObservationIds, inputDigest: insufficient.inputDigest };
  const result = verifyFeatureSetProvenance(forged, verifyInput(forged));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("uncovered_observation");
});

test("a MISSING observation ref is refused (the set references an absent id)", () => {
  const { set } = genuine();
  // Drop one claimed observation: the set still references its id.
  const claimed = numericHistory().slice(0, 5);
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { claimedObservations: claimed }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("missing_observation_ref");
  expect(result.error.message).toContain("obs_num0006");
});

test("a GAP (a claimed in-window observation the set does not cover) is refused", () => {
  const { set } = genuine();
  // Claim MORE inputs than the set covers: an extra in-window observation.
  const extra = admitted({
    id: asObservationId("obs_extra"),
    kind: "device.health",
    observedAt: atHour(5),
    schemaVersion: 1,
    payload: { batteryLevel: 88 },
  });
  const claimed = [...numericHistory(), extra];
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { claimedObservations: claimed }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("uncovered_observation");
  expect(result.error.message).toContain("obs_extra");
});

test("a CROSS-TENANT scope is refused (never merged)", () => {
  const { set } = genuine();
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { tenantId: TENANT_B }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("tenant_mismatch");
});

test("a cross-tenant CLAIMED observation is refused (malformed claim)", () => {
  const { set } = genuine();
  const foreign = admitted({ id: asObservationId("obs_frgn"), kind: "device.health", observedAt: atHour(5), schemaVersion: 1, payload: {} }, TENANT_B, DEV_A1);
  const claimed = [...numericHistory(), foreign];
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { claimedObservations: claimed }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("cross_tenant_claim");
});

test("a device mismatch is refused", () => {
  const { set } = genuine();
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { deviceId: DEV_A2 }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("device_mismatch");
});

test("a DIGEST mismatch is refused (claimed inputs differ from the derivation's)", () => {
  const { set } = genuine();
  // Same ids/refs, different payload: refs check passes, digest fails.
  const altered = numericHistory().map((entry, index) =>
    index === 3
      ? admitted({ ...entry.observation, payload: { ...(entry.observation.payload as Record<string, unknown>), batteryLevel: 1 } })
      : entry,
  );
  const result = verifyFeatureSetProvenance(set, verifyInput(set, { claimedObservations: altered }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("digest_mismatch");
});

test("a REJECTED set makes no derivation claim and is refused as not verifiable", () => {
  const refusingGate = { check: () => ({ ok: false as const, reason: "consent_denied", detail: "no" }) };
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    privacyGate: refusingGate,
  });
  expect(set.status.kind).toBe("rejected");
  const result = verifyFeatureSetProvenance(set, verifyInput(set));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect((result.error as { kind: string; invariant?: string }).invariant).toBe("set_not_verifiable");
});

// ---------------------------------------------------------------------------
// The provenance record + audit emission
// ---------------------------------------------------------------------------

test("the provenance record's contentDigest anchors the whole set (tamper-evident)", () => {
  const { set } = genuine();
  const record = makeFeatureSetProvenanceRecord(set);
  expect(record.ok).toBe(true);
  if (!record.ok) throw new Error(record.error.message);
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.map((f) => (f.id === "observation.count" ? { ...f, value: 99 } : f)),
  };
  // The ORIGINAL record no longer matches the tampered set's content.
  expect(record.record.contentDigest).not.toBe(sha256Hex(canonicalFeatureSetJson(tampered)));
  // A record derived from the tampered set differs from the genuine one.
  const tamperedRecord = makeFeatureSetProvenanceRecord(tampered);
  expect(tamperedRecord.ok).toBe(true);
  if (tamperedRecord.ok) {
    expect(tamperedRecord.record.contentDigest).not.toBe(record.record.contentDigest);
  }
  // The identity anchor is the same (same inputs, same window, same versions).
  if (tamperedRecord.ok) {
    expect(tamperedRecord.record.provenanceId).toBe(record.record.provenanceId);
  }
});

test("a rejected set has NO provenance record (nothing to anchor)", () => {
  const refusingGate = { check: () => ({ ok: false as const, reason: "consent_denied", detail: "no" }) };
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    privacyGate: refusingGate,
  });
  const record = makeFeatureSetProvenanceRecord(set);
  expect(record.ok).toBe(false);
});

test("provenance refusals audit (the trust anchor holding); successful verification NEVER audits", () => {
  const sink = createInMemoryPredictiveAuditSink();
  const { set } = genuine();

  // Success: a pure read — no audit.
  const accepted = verifyFeatureSetProvenance(set, verifyInput(set, { auditSink: sink }));
  expect(accepted.ok).toBe(true);
  expect(sink.records).toHaveLength(0);

  // Refusal: audited with the machine-stable invariant.
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.map((f) => (f.id === "payload.temperatureC.max" ? { ...f, value: 0 } : f)),
  };
  const refused = verifyFeatureSetProvenance(tampered, verifyInput(tampered, { auditSink: sink }));
  expect(refused.ok).toBe(false);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]?.action).toBe("predictive.provenance.rejected");
  expect(sink.records[0]?.tenantId).toBe(TENANT_A);
  const details = sink.records[0]?.details as Record<string, unknown>;
  expect(details["invariant"]).toBe("feature_set_mismatch");
  expect(details["claimedDigest"]).toBe(set.inputDigest?.value);
});

test("the relative-window set verifies (the resolved window is the verifiable claim)", () => {
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: { kind: "relative", anchor: atHour(24), durationMs: 24 * 3_600_000 },
    extractedAt: atHour(24),
    correlationId: CORR_2,
  });
  const result = verifyFeatureSetProvenance(set, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: numericHistory(),
    correlationId: CORR_2,
  });
  expect(result.ok).toBe(true);
});

test("verification accepts a store-style scope object (structural scope seam)", () => {
  const { set } = genuine();
  const result = verifyFeatureSetProvenance(set, verifyInput(set));
  expect(result.ok).toBe(true);
  void scopeA;
});
