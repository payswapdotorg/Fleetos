/**
 * W153 predictive — the integration binding suite: extraction over the
 * REAL seeded demo fleet history (apps/web/src/runtime/demo-fleet.ts
 * seam) with the REAL audit sink adapter — proven, not mocked away.
 *
 * The ownership gate scans only src/ files, so this TEST file may
 * import across lanes (the established W011/W021/W031/W070 binding
 * pattern). This suite proves:
 *
 *   1. the REAL apps/web sha256 module satisfies the `FeatureDigestFn`
 *      seam STRUCTURALLY and is byte-compatible with the in-package
 *      FIPS 180-4 implementation (the standard test vectors + the
 *      canonical serializations of the real demo history);
 *   2. extraction over the REAL seeded demo fleet history (the three
 *      demo twins' admitted observations) yields the HONEST
 *      insufficient_history state — one admitted observation per demo
 *      device is below the v1 family's minimum, so NO features are
 *      fabricated (the W153 work order's honesty discipline);
 *   3. the demo extraction is byte-identical across runs (determinism
 *      over the real seed);
 *   4. the provenance verification ACCEPTS the genuine demo extraction
 *      against the claimed demo observations;
 *   5. a RICHER real history admitted through the REAL W011 ingestion
 *      boundary (three check-in batches) yields an ok feature set with
 *      the full v1 family; the extraction + materialization + refusal
 *      flow emits into the REAL hash-chained audit log through the
 *      REAL sink adapter; the chain verifies.
 */

import { test, expect } from "bun:test";
import {
  canonicalFeatureSetJson,
  extractDeviceHistoryFeatures,
  materializeFeatureSet,
  verifyFeatureSetProvenance,
  createInMemoryFeatureSetStore,
  type AdmittedDeviceObservation,
  type DeviceHistoryFeatureSet,
  type FeatureDigestFn,
} from "../src/index";
import { sha256Hex as inPackageSha256Hex, canonicalJson } from "../src/internal";
import { sha256Hex as realWebSha256Hex } from "../../../apps/web/src/runtime/sha256";
import { DEMO, TENANT_ID as DEMO_TENANT_ID } from "../../../apps/web/src/runtime/demo-fleet";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  T0,
  absoluteWindow,
  atHour,
  ingestedRealHistory,
  numericHistory,
  realAuditLog,
  realPredictiveAuditSink,
  scopeA,
  tenantContext,
} from "./helpers";
import type { PredictiveAuditSink } from "../src/index";

// ---------------------------------------------------------------------------
// 1. The REAL web sha256 satisfies the digest seam (byte-compat proof)
// ---------------------------------------------------------------------------

test("the REAL apps/web sha256 module satisfies the FeatureDigestFn seam and matches the FIPS vectors", () => {
  // The type-level structural proof: the real module's function IS a
  // FeatureDigestFn (this assignment type-checks only if it is).
  const realDigest: FeatureDigestFn = realWebSha256Hex;
  // The standard FIPS 180-4 test vectors — BOTH implementations agree.
  expect(realDigest("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(inPackageSha256Hex("abc")).toBe(realDigest("abc"));
  expect(inPackageSha256Hex("")).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(realDigest("")).toBe(inPackageSha256Hex(""));
  const longInput = "a".repeat(200);
  expect(inPackageSha256Hex(longInput)).toBe(realDigest(longInput));
  // Unicode (the manual UTF-8 encoder handles surrogate pairs).
  const unicode = "FleetOS — Predictive Twin ✓ 你好 🚀";
  expect(inPackageSha256Hex(unicode)).toBe(realDigest(unicode));
});

test("an extraction with the REAL web digest injected produces the SAME digest as the default (byte-compat)", () => {
  const withDefault = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
  });
  const withReal = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    digest: realWebSha256Hex,
  });
  expect(withReal.inputDigest?.value).toBe(withDefault.inputDigest?.value);
  expect(canonicalFeatureSetJson(withReal)).toBe(canonicalFeatureSetJson(withDefault));
});

// ---------------------------------------------------------------------------
// 2-4. The REAL seeded demo fleet history (the W091 composition seam)
// ---------------------------------------------------------------------------

/** The demo fleet's admitted observations for one demo twin. */
function demoObservations(deviceId: string): AdmittedDeviceObservation[] {
  const twin = DEMO.store.get(DEMO_TENANT_ID, deviceId as typeof DEV_A1);
  if (twin === undefined) throw new Error(`demo twin missing: ${deviceId}`);
  return twin.telemetry.latest.map((observation) => ({
    tenantId: DEMO_TENANT_ID,
    deviceId: twin.deviceId,
    observation,
  }));
}

test("the REAL demo fleet carries exactly three devices with one admitted observation each", () => {
  const twins = DEMO.store.list(DEMO_TENANT_ID);
  expect(twins).toHaveLength(3);
  for (const twin of twins) {
    expect(twin.telemetry.observationCount).toBe(1);
    expect(twin.telemetry.latest).toHaveLength(1);
    const observation = twin.telemetry.latest[0]!;
    expect(observation.kind).toBe("device.security");
    expect(observation.schemaVersion).toBe(1);
  }
});

test("extraction over the REAL demo fleet history yields the HONEST insufficient_history state (never fabricated features)", () => {
  const twins = DEMO.store.list(DEMO_TENANT_ID);
  for (const twin of twins) {
    const observations = demoObservations(twin.deviceId);
    const set = extractDeviceHistoryFeatures({
      tenantId: DEMO_TENANT_ID,
      deviceId: twin.deviceId,
      observations,
      window: absoluteWindow("2026-01-06T00:00:00Z", "2026-01-07T00:00:00Z"),
      extractedAt: "2026-01-06T14:00:00Z",
      correlationId: CORR,
    });
    // One admitted observation < the v1 minimum (2): the honest state,
    // the observed count, and the minimum required — NO zeros, NO
    // fabricated features.
    expect(set.status).toEqual({
      kind: "insufficient_history",
      reason: "observation_count_below_minimum",
      observedCount: 1,
      minimumRequired: 2,
    });
    expect(set.features).toEqual([]);
    expect([...set.inputObservationIds]).toHaveLength(1);
    expect(set.inputDigest).not.toBeNull();
    // The provenance verification ACCEPTS the honest demo extraction.
    const verification = verifyFeatureSetProvenance(set, {
      tenantId: DEMO_TENANT_ID,
      deviceId: twin.deviceId,
      claimedObservations: observations,
      correlationId: CORR,
    });
    expect(verification.ok).toBe(true);
  }
});

test("the demo extraction is byte-identical across runs (determinism over the REAL seed)", () => {
  const extract = (): DeviceHistoryFeatureSet =>
    extractDeviceHistoryFeatures({
      tenantId: DEMO_TENANT_ID,
      deviceId: "dev_w091demo000001" as typeof DEV_A1,
      observations: demoObservations("dev_w091demo000001"),
      window: absoluteWindow("2026-01-06T00:00:00Z", "2026-01-07T00:00:00Z"),
      extractedAt: "2026-01-06T14:00:00Z",
      correlationId: CORR,
    });
  const first = extract();
  const second = extract();
  expect(canonicalFeatureSetJson(second)).toBe(canonicalFeatureSetJson(first));
  // The golden demo digest is stable (the W154 engine's reproducibility
  // anchor over the REAL seeded history).
  expect(first.inputDigest?.value).toBe(
    inPackageSha256Hex(
      canonicalJson([
        {
          tenantId: DEMO_TENANT_ID,
          deviceId: "dev_w091demo000001",
          observation: demoObservations("dev_w091demo000001")[0]!.observation,
        },
      ]),
    ),
  );
  // ...and the REAL web digest agrees byte-for-byte over the same
  // canonical serialization (the cross-implementation anchor).
  expect(first.inputDigest?.value).toBe(
    realWebSha256Hex(
      canonicalJson([
        {
          tenantId: DEMO_TENANT_ID,
          deviceId: "dev_w091demo000001",
          observation: demoObservations("dev_w091demo000001")[0]!.observation,
        },
      ]),
    ),
  );
});

test("the demo extraction emits into the REAL hash-chained audit log through the REAL sink adapter", () => {
  const log = realAuditLog();
  const sink: PredictiveAuditSink = realPredictiveAuditSink(log);
  const observations = demoObservations("dev_w091demo000001");
  extractDeviceHistoryFeatures({
    tenantId: DEMO_TENANT_ID,
    deviceId: "dev_w091demo000001" as typeof DEV_A1,
    observations,
    window: absoluteWindow("2026-01-06T00:00:00Z", "2026-01-07T00:00:00Z"),
    extractedAt: "2026-01-06T14:00:00Z",
    correlationId: CORR,
    auditSink: sink,
  });
  const ctx = tenantContext(DEMO_TENANT_ID);
  expect(log.size(ctx)).toBe(1);
  expect(log.records(ctx)[0]?.action).toBe("predictive.device_history.extracted");
  const details = log.records(ctx)[0]?.details as Record<string, unknown>;
  expect(details["statusKind"]).toBe("insufficient_history");
  expect(log.verify(ctx).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// 5. The REAL ingestion boundary: a richer admitted history -> ok
// ---------------------------------------------------------------------------

test("the REAL W011 ingestion boundary admits a richer history; extraction yields ok + the full family; the flow audits and the chain verifies", () => {
  const { observations } = ingestedRealHistory();
  expect(observations).toHaveLength(6);

  const log = realAuditLog();
  const sink: PredictiveAuditSink = realPredictiveAuditSink(log);

  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations,
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
    auditSink: sink,
  });
  expect(set.status).toEqual({ kind: "ok" });
  // The full v1 family over the REAL admitted stream.
  const byId = new Map(set.features.map((f) => [f.id, f.value] as const));
  expect(byId.get("observation.count")).toBe(6);
  expect(byId.get("arrival.interarrival_mean_ms")).toBe(2 * 3_600_000);
  expect(byId.get("payload.batteryLevel.min")).toBe(65);
  expect(byId.get("payload.batteryLevel.max")).toBe(98);
  expect(byId.get("payload.diskEncryption.presence_fraction")).toBe(5 / 6);
  // The admitted stream's ids are the provenance refs (canonical order).
  expect([...set.inputObservationIds]).toEqual([
    "obs_ing0001",
    "obs_ing0002",
    "obs_ing0003",
    "obs_ing0004",
    "obs_ing0005",
    "obs_ing0006",
  ]);

  // The provenance verification accepts over the claimed ADMITTED stream.
  const verification = verifyFeatureSetProvenance(set, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: observations,
    correlationId: CORR,
  });
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(verification.error.message);
  expect(verification.record.contentDigest).toBe(inPackageSha256Hex(canonicalFeatureSetJson(set)));

  // Materialize into the append-only cache; the full flow audits.
  const store = createInMemoryFeatureSetStore();
  const materialized = materializeFeatureSet(scopeA(), store, set, { auditSink: sink });
  expect(materialized.ok).toBe(true);

  const ctxA = tenantContext(TENANT_A);
  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    "predictive.device_history.extracted",
    "predictive.featureset.materialized",
  ]);
  expect(log.verify(ctxA).ok).toBe(true);
});

test("a tampered set over the REAL admitted stream is refused by the trust anchor (the binding holds)", () => {
  const { observations } = ingestedRealHistory();
  const set = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations,
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
  });
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.map((f) =>
      f.id === "payload.temperatureC.mean" ? { ...f, value: -999 } : f,
    ),
  };
  const refused = verifyFeatureSetProvenance(tampered, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: observations,
    correlationId: CORR,
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  expect(invariantOf(refused.error)).toBe("feature_set_mismatch");
  expect(refused.error.message).toContain("payload.temperatureC.mean");
});

/** Narrow a FleetError to its DomainError invariant (refusals are domain errors). */
function invariantOf(error: { kind: string; invariant?: string }): string | undefined {
  return error.kind === "DomainError" ? error.invariant : undefined;
}
