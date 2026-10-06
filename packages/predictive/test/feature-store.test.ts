/**
 * W153 predictive — D3 tests: the tenant-partitioned append-only
 * derived feature-set cache (the recomputable cache — never a second
 * source of truth).
 */

import { test, expect } from "bun:test";
import {
  canonicalFeatureSetJson,
  createInMemoryFeatureSetStore,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  featureSetId,
  materializeFeatureSet,
  verifyFeatureSetProvenance,
  type DeviceHistoryFeatureSet,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  absoluteWindow,
  atHour,
  numericHistory,
  scopeA,
  scopeB,
} from "./helpers";

/** A genuine ok set over the numeric history. */
function okSet(): DeviceHistoryFeatureSet {
  return extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    correlationId: CORR,
  });
}

// ---------------------------------------------------------------------------
// Append-only discipline
// ---------------------------------------------------------------------------

test("append + get round trip; an idempotent re-append returns created:false", () => {
  const store = createInMemoryFeatureSetStore();
  const set = okSet();
  const id = featureSetId(set);

  const first = store.appendFeatureSet(scopeA(), set);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  expect(first.created).toBe(true);

  const again = store.appendFeatureSet(scopeA(), set);
  expect(again.ok).toBe(true);
  if (!again.ok) throw new Error(again.error.message);
  expect(again.created).toBe(false);
  expect(canonicalFeatureSetJson(again.record)).toBe(canonicalFeatureSetJson(set));

  expect(store.getFeatureSet(scopeA(), id)).toBeDefined();
  expect(store.size(scopeA())).toBe(1);
  expect([...store.listFeatureSetIds(scopeA())]).toEqual([id]);
});

test("the SAME identity with DIFFERENT content is refused (the append-only discipline holds)", () => {
  const store = createInMemoryFeatureSetStore();
  const set = okSet();
  store.appendFeatureSet(scopeA(), set);

  // Tamper a feature value: same identity tuple (tenant/device/versions/
  // window/input digest), different content -> the slot is occupied.
  const tampered: DeviceHistoryFeatureSet = {
    ...set,
    features: set.features.map((f) => (f.id === "observation.count" ? { ...f, value: 99 } : f)),
  };
  expect(featureSetId(tampered)).toBe(featureSetId(set));
  const refused = store.appendFeatureSet(scopeA(), tampered);
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  expect(refused.error.code).toBe("predictive.store.domain");
  expect((refused.error as { kind: string; invariant?: string }).invariant).toBe("slot_occupied");
  // The stored record is UNCHANGED (append-only).
  expect(canonicalFeatureSetJson(store.getFeatureSet(scopeA(), featureSetId(set))!)).toBe(
    canonicalFeatureSetJson(set),
  );
});

test("a REJECTED set is refused at the door (nothing derived to cache)", () => {
  const store = createInMemoryFeatureSetStore();
  const refusingGate = { check: () => ({ ok: false as const, reason: "consent_denied", detail: "no" }) };
  const rejected = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(24),
    privacyGate: refusingGate,
  });
  const refused = store.appendFeatureSet(scopeA(), rejected);
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  expect((refused.error as { kind: string; invariant?: string }).invariant).toBe("rejected_not_cacheable");
});

// ---------------------------------------------------------------------------
// Tenant partitioning
// ---------------------------------------------------------------------------

test("tenant partitions are isolated; a cross-tenant append is refused", () => {
  const store = createInMemoryFeatureSetStore();
  const setA = okSet();

  const cross = store.appendFeatureSet(scopeB(), setA);
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected refusal");
  expect((cross.error as { kind: string; invariant?: string }).invariant).toBe("tenant_mismatch");

  store.appendFeatureSet(scopeA(), setA);
  // Tenant B's partition never sees tenant A's set.
  expect(store.size(scopeB())).toBe(0);
  expect(store.listFeatureSets(scopeB())).toEqual([]);
  expect(store.getFeatureSet(scopeB(), featureSetId(setA))).toBeUndefined();
  expect(store.size(scopeA())).toBe(1);
});

test("a missing/invalid scope is refused (context-free access is forbidden)", () => {
  const store = createInMemoryFeatureSetStore();
  const bad = store.appendFeatureSet({ tenantId: "bad" as typeof TENANT_A }, okSet());
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect((bad.error as { kind: string; invariant?: string }).invariant).toBe("invalid_tenant_id");
  const none = store.appendFeatureSet(undefined as never, okSet());
  expect(none.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// latest + listing stability
// ---------------------------------------------------------------------------

test("latestFeatureSet returns the max (extractedAt, id) — deterministic", () => {
  const store = createInMemoryFeatureSetStore();
  const early = okSet();
  const late = extractDeviceHistoryFeatures({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: numericHistory(),
    window: absoluteWindow(T0, atHour(24)),
    extractedAt: atHour(48),
    correlationId: CORR,
  });
  // Insertion order deliberately reversed.
  store.appendFeatureSet(scopeA(), late);
  store.appendFeatureSet(scopeA(), early);
  expect(store.latestFeatureSet(scopeA(), DEV_A1)?.extractedAt).toBe(atHour(48));
  // Another device: none.
  expect(store.latestFeatureSet(scopeA(), "dev_other" as typeof DEV_A1)).toBeUndefined();
  // Listing is id-order stable.
  const ids = [...store.listFeatureSetIds(scopeA())];
  expect(ids).toEqual([...ids].sort());
  expect(ids).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// The audited materialization boundary + the verifiable store hit
// ---------------------------------------------------------------------------

test("materializeFeatureSet audits on created; an idempotent re-append does not", () => {
  const sink = createInMemoryPredictiveAuditSink();
  const store = createInMemoryFeatureSetStore();
  const set = okSet();

  const first = materializeFeatureSet(scopeA(), store, set, { auditSink: sink });
  expect(first.ok).toBe(true);
  const again = materializeFeatureSet(scopeA(), store, set, { auditSink: sink });
  expect(again.ok).toBe(true);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]?.action).toBe("predictive.featureset.materialized");
  expect(sink.records[0]?.subject).toBe(featureSetId(set));
  expect(sink.records[0]?.occurredAt).toBe(set.extractedAt);
  const details = sink.records[0]?.details as Record<string, unknown>;
  expect(details["statusKind"]).toBe("ok");
  expect(details["inputDigestValue"]).toBe(set.inputDigest?.value);
});

test("a store hit is VERIFIABLE against the immutable stream (the cache is recomputable)", () => {
  const store = createInMemoryFeatureSetStore();
  const set = okSet();
  materializeFeatureSet(scopeA(), store, set);

  const hit = store.getFeatureSet(scopeA(), featureSetId(set));
  expect(hit).toBeDefined();
  const verification = verifyFeatureSetProvenance(hit!, {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    claimedObservations: numericHistory(),
    correlationId: CORR,
  });
  expect(verification.ok).toBe(true);
});
