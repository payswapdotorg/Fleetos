/**
 * W153 predictive — the tenant-partitioned, append-only derived cache
 * (D3) test battery.
 *
 * ADR-0002 invariant 1: "The feature feed is NEVER business truth — it
 * is a derived, recomputable interpretation of immutable inputs." The
 * store is a CACHE; the immutable observation stream is the source of
 * truth. ADR-0002 invariant 6: "Tenant isolation at the boundary AND
 * in the store semantics: a feature request is tenant-scoped;
 * cross-tenant inputs are rejected, never merged."
 *
 * This battery proves:
 *   - a feature set is APPENDED into the acting tenant's partition;
 *   - a re-append of the SAME content is idempotent (the existing
 *     record is returned, `created: false`);
 *   - a DIFFERENT feature set on the same store id is REFUSED with
 *     `feature_slot_occupied` (by construction — the store id IS the
 *     content digest; a different content produces a different store
 *     id and therefore a different slot, so this case is impossible
 *     by construction — the test confirms the construction);
 *   - a foreign-tenant feature set is REFUSED with `tenant_mismatch`;
 *   - tenant partitions stay SEPARATE (a foreign-tenant scope sees
 *     nothing of the acting tenant's partition);
 *   - the audited recording boundary emits `predictive.feature.extracted`
 *     on a CREATED append and `predictive.feature.reextracted` on an
 *     idempotent re-append;
 *   - the audited provenance-verification boundary emits
 *     `predictive.provenance.verified` on a passed verification and
 *     `predictive.provenance.refused` on a refused one.
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
  FOREIGN_SCOPE,
  SCOPE,
  T1,
  TENANT_B,
  TENANT_ID,
  makeObservation,
  resetObservationCounter,
  seedDemoFleet,
  seedSingleObservationDevice,
} from "./helpers";
import {
  createInMemoryFeatureSetStore,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  featureSetStoreId,
  recordFeatureSet,
  recordProvenanceVerification,
  verifyFeatureSetProvenance,
} from "../src/index";
import type { DomainError, FleetError } from "@fleetos/contracts";

/** Type-narrow a FleetError to a DomainError (throws if it's the wrong kind — test-only). */
function asDomainError(e: FleetError): DomainError {
  if (e.kind !== "DomainError") throw new Error(`expected DomainError, got ${e.kind}`);
  return e;
}

// ---------------------------------------------------------------------------
// The append + idempotent re-append
// ---------------------------------------------------------------------------

test("feature-store: a feature set is APPENDED into the acting tenant's partition", () => {
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

  const store = createInMemoryFeatureSetStore();
  const write = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("append failed");
  expect(write.created).toBe(true);
  expect(write.record).toBe(extraction.featureSet);

  // The store now has 1 feature set.
  expect(store.size(SCOPE)).toBe(1);
  // The store id is recoverable via the deterministic store-id helper.
  const storeId = featureSetStoreId(extraction.featureSet);
  expect(store.getFeatureSet(SCOPE, storeId)).toBe(extraction.featureSet);
  expect(store.listFeatureSetIds(SCOPE)).toEqual([storeId]);
});

test("feature-store: a re-append of the SAME content is idempotent (the existing record is returned, `created: false`)", () => {
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

  const store = createInMemoryFeatureSetStore();
  // First append.
  const write1 = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write1.ok).toBe(true);
  if (!write1.ok) throw new Error("first append failed");
  expect(write1.created).toBe(true);
  // Second append (same content).
  const write2 = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write2.ok).toBe(true);
  if (!write2.ok) throw new Error("second append failed");
  expect(write2.created).toBe(false);
  // The store still has 1 feature set.
  expect(store.size(SCOPE)).toBe(1);
});

test("feature-store: a DIFFERENT feature set produces a DIFFERENT store id (the store id IS the content digest)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const dev2 = fleet.devices.find((d) => d.deviceId === DEV_2)!;
  const e1 = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  const e2 = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_2,
    observations: dev2.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(e1.ok).toBe(true);
  expect(e2.ok).toBe(true);
  if (!e1.ok || !e2.ok) throw new Error("extraction failed");

  // The store ids are DIFFERENT (different content => different digest).
  const id1 = featureSetStoreId(e1.featureSet);
  const id2 = featureSetStoreId(e2.featureSet);
  expect(id1).not.toBe(id2);

  // Both append cleanly (different slots).
  const store = createInMemoryFeatureSetStore();
  const w1 = store.appendFeatureSet(SCOPE, e1.featureSet);
  const w2 = store.appendFeatureSet(SCOPE, e2.featureSet);
  expect(w1.ok).toBe(true);
  expect(w2.ok).toBe(true);
  if (!w1.ok || !w2.ok) throw new Error("append failed");
  expect(store.size(SCOPE)).toBe(2);
});

// ---------------------------------------------------------------------------
// Tenant isolation (cross-tenant refused, partitions separate)
// ---------------------------------------------------------------------------

test("feature-store: a foreign-tenant feature set is REFUSED with `tenant_mismatch`", () => {
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

  const store = createInMemoryFeatureSetStore();
  // Append the TENANT_ID feature set under the FOREIGN_SCOPE.
  // The store refuses — the feature set's tenant doesn't match the
  // acting scope's tenant.
  const write = store.appendFeatureSet(FOREIGN_SCOPE, extraction.featureSet);
  expect(write.ok).toBe(false);
  if (write.ok) throw new Error("expected refusal");
  expect(asDomainError(write.error).invariant).toBe("tenant_mismatch");
});

test("feature-store: tenant partitions stay SEPARATE (a foreign scope sees nothing of the acting partition)", () => {
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

  const store = createInMemoryFeatureSetStore();
  // Append into the SCOPE (TENANT_ID) partition.
  const write = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("append failed");

  // The SCOPE partition has 1 feature set.
  expect(store.size(SCOPE)).toBe(1);
  // The FOREIGN_SCOPE partition has 0 (it sees nothing of TENANT_ID's partition).
  expect(store.size(FOREIGN_SCOPE)).toBe(0);
  expect(store.listFeatureSetIds(FOREIGN_SCOPE)).toEqual([]);
  // A get-by-id under the FOREIGN scope returns undefined (the id is
  // indistinguishable from an unknown one — a foreign observation id is
  // indistinguishable from an unknown one, per the W012 pattern).
  const storeId = featureSetStoreId(extraction.featureSet);
  expect(store.getFeatureSet(FOREIGN_SCOPE, storeId)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The list-by-device filter
// ---------------------------------------------------------------------------

test("feature-store: listFeatureSetsForDevice returns only the feature sets for the given device", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  const dev2 = fleet.devices.find((d) => d.deviceId === DEV_2)!;
  const e1 = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: dev1.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  const e2 = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_2,
    observations: dev2.observations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(e1.ok).toBe(true);
  expect(e2.ok).toBe(true);
  if (!e1.ok || !e2.ok) throw new Error("extraction failed");

  const store = createInMemoryFeatureSetStore();
  store.appendFeatureSet(SCOPE, e1.featureSet);
  store.appendFeatureSet(SCOPE, e2.featureSet);

  // DEV_1 has 1 feature set; DEV_2 has 1 feature set.
  expect(store.listFeatureSetsForDevice(SCOPE, DEV_1).length).toBe(1);
  expect(store.listFeatureSetsForDevice(SCOPE, DEV_2).length).toBe(1);
  // A device with no feature sets returns an empty list.
  expect(store.listFeatureSetsForDevice(SCOPE, "dev_w153no_such_id" as never)).toEqual([]);
});

// ---------------------------------------------------------------------------
// The audited recording boundary
// ---------------------------------------------------------------------------

test("feature-store: the audited recording boundary emits `predictive.feature.extracted` on a CREATED append", () => {
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

  const store = createInMemoryFeatureSetStore();
  const sink = createInMemoryPredictiveAuditSink();
  const write = recordFeatureSet(SCOPE, store, extraction.featureSet, {
    auditSink: sink,
    correlationId: CORR_1,
    causationId: CAUSATION_1,
  });
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("record failed");
  expect(write.created).toBe(true);
  expect(sink.records.length).toBe(1);
  const record = sink.records[0]!;
  expect(record.action).toBe("predictive.feature.extracted");
  expect(record.tenantId).toBe(TENANT_ID);
  expect(record.correlationId).toBe(CORR_1);
  expect(record.causationId).toBe(CAUSATION_1);
  expect(record.occurredAt).toBe(EXTRACTED_AT);
  // The subject is the deterministic store id.
  expect(record.subject).toBe(featureSetStoreId(extraction.featureSet));
  // The details carry the input digest + the content digest.
  const details = record.details as { inputDigest: string; contentDigest: string; featureCount: number; statusKind: string };
  expect(details.inputDigest).toBe(extraction.featureSet.inputDigest);
  expect(details.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(details.featureCount).toBe(extraction.featureSet.features.length);
  expect(details.statusKind).toBe("ok");
});

test("feature-store: the audited recording boundary emits `predictive.feature.reextracted` on an idempotent re-append", () => {
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

  const store = createInMemoryFeatureSetStore();
  const sink = createInMemoryPredictiveAuditSink();
  // First append (CREATED).
  recordFeatureSet(SCOPE, store, extraction.featureSet, { auditSink: sink });
  // Second append (idempotent re-append).
  const write2 = recordFeatureSet(SCOPE, store, extraction.featureSet, { auditSink: sink });
  expect(write2.ok).toBe(true);
  if (!write2.ok) throw new Error("record failed");
  expect(write2.created).toBe(false);
  // The sink now has 2 records: one feature.extracted + one feature.reextracted.
  expect(sink.records.length).toBe(2);
  expect(sink.records[0]!.action).toBe("predictive.feature.extracted");
  expect(sink.records[1]!.action).toBe("predictive.feature.reextracted");
});

// ---------------------------------------------------------------------------
// The audited provenance-verification boundary
// ---------------------------------------------------------------------------

test("feature-store: the audited provenance-verification boundary emits `predictive.provenance.verified` on a passed verification", () => {
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

  const sink = createInMemoryPredictiveAuditSink();
  const verification = verifyFeatureSetProvenance(
    {
      scope: SCOPE,
      featureSet: extraction.featureSet,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error("verification failed");

  recordProvenanceVerification(SCOPE, sink, verification, extraction.featureSet, {
    verifiedAt: EXTRACTED_AT,
    correlationId: CORR_1,
  });
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]!.action).toBe("predictive.provenance.verified");
  expect(sink.records[0]!.tenantId).toBe(TENANT_ID);
  expect(sink.records[0]!.subject).toBe(featureSetStoreId(extraction.featureSet));
});

test("feature-store: the audited provenance-verification boundary emits `predictive.provenance.refused` on a refused verification", () => {
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

  const sink = createInMemoryPredictiveAuditSink();
  // Tamper with the inputDigest to force a digest_mismatch refusal.
  const tampered = { ...extraction.featureSet, inputDigest: "0".repeat(64) };
  const verification = verifyFeatureSetProvenance(
    {
      scope: SCOPE,
      featureSet: tampered,
      observations: dev1.observations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(false);

  recordProvenanceVerification(SCOPE, sink, verification, tampered, {
    verifiedAt: EXTRACTED_AT,
    correlationId: CORR_1,
  });
  expect(sink.records.length).toBe(1);
  expect(sink.records[0]!.action).toBe("predictive.provenance.refused");
  // The details carry the refusal code.
  const details = sink.records[0]!.details as { refusalCode: string; claimedInputDigest: string };
  expect(details.refusalCode).toBe("predictive.provenance.mismatch");
});

// ---------------------------------------------------------------------------
// The single-observation feature set's store id (insufficient_history is cacheable)
// ---------------------------------------------------------------------------

test("feature-store: an insufficient_history feature set is cacheable (the store accepts the status — it is the honest signal)", () => {
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

  const store = createInMemoryFeatureSetStore();
  const write = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("append failed");
  expect(write.created).toBe(true);
  // The store has the insufficient-history feature set cached.
  expect(store.size(SCOPE)).toBe(1);
  expect(store.getFeatureSet(SCOPE, featureSetStoreId(extraction.featureSet))).toBe(extraction.featureSet);
});

// ---------------------------------------------------------------------------
// A rejected feature set's store id (rejected is cacheable too)
// ---------------------------------------------------------------------------

test("feature-store: a rejected feature set is cacheable (the store accepts the rejection — it is the honest signal)", () => {
  resetObservationCounter();
  const fleet = seedDemoFleet();
  const dev1 = fleet.devices.find((d) => d.deviceId === DEV_1)!;
  // Inject a foreign-tenant observation to force a tenant_mismatch rejection.
  const foreignObs = { ...dev1.observations[0]!, tenantId: TENANT_B };
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [foreignObs, ...dev1.observations.slice(1)],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error("extraction failed");
  expect(extraction.featureSet.status.kind).toBe("rejected");

  const store = createInMemoryFeatureSetStore();
  const write = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("append failed");
  expect(write.created).toBe(true);
  expect(store.size(SCOPE)).toBe(1);
});

// ---------------------------------------------------------------------------
// Sanity: the empty-window store id is cacheable
// ---------------------------------------------------------------------------

test("feature-store: an empty-window feature set is cacheable (the store accepts the empty-window status — it is the honest signal)", () => {
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

  const store = createInMemoryFeatureSetStore();
  const write = store.appendFeatureSet(SCOPE, extraction.featureSet);
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error("append failed");
  expect(write.created).toBe(true);
  expect(store.size(SCOPE)).toBe(1);
});
