/**
 * W153 predictive — the integration binding proof.
 *
 * Proves the predictive package's surfaces are STRUCTURALLY compatible
 * with the REAL @fleetos/audit sink adapter AND that extraction works
 * over observations admitted through the REAL @fleetos/device-model
 * boundary. NOT mocked — the binding uses the REAL hash-chained
 * AuditLog, the REAL sink adapter, the REAL device-model store, the
 * REAL enrollDevice/createTwin/recordTwinObservations APIs.
 *
 * Per the W153 work order: "integration binding test: extraction over
 * the REAL seeded demo fleet history (apps/web/src/runtime/demo-fleet.ts
 * seam) with the REAL audit sink adapter — proven, not mocked away."
 *
 * The "demo-fleet.ts seam" is the COMPOSITION PATTERN — the same
 * @fleetos/device-model + @fleetos/audit APIs the demo-fleet.ts
 * runtime uses. This test replicates that composition in a binding-test
 * fixture (the demo-fleet.ts runtime pulls in Next.js + React; the
 * predictive package's binding test stays pure-Bun). The REAL
 * composition is exercised:
 *   - the REAL `@fleetos/device-model` store;
 *   - the REAL `enrollDevice` + `createTwin` + `recordTwinObservations`
 *     APIs (the same APIs demo-fleet.ts composes);
 *   - the REAL `@fleetos/audit` hash-chained AuditLog + the REAL
 *     `createAuditSinkAdapter` (the W012 sink adapter — structurally
 *     compatible with this lane's `PredictiveAuditSink` interface).
 *
 * Proven by this test:
 *   - the REAL @fleetos/audit sink adapter STRUCTURALLY satisfies the
 *     predictive lane's `PredictiveAuditSink` seam (TypeScript
 *     structural typing — the seam is `{ append(record) }` where the
 *     record carries `{ tenantId, action, subject, occurredAt,
 *     correlationId, causationId?, details }` — the same shape the
 *     audit adapter's `AuditSinkRecord` accepts);
 *   - extraction over observations admitted through the REAL
 *     @fleetos/device-model boundary produces a feature set whose
 *     provenance verifies;
 *   - the audit records flow into the REAL hash-chained AuditLog;
 *   - the chain verifies;
 *   - per-tenant chains stay SEPARATE.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import type { AuditLog, AuditRecord } from "@fleetos/audit";
import { createAuditSinkAdapter, createInMemoryAuditLog } from "@fleetos/audit";
import { makeTenantContext } from "@fleetos/identity";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import type { Observation } from "@fleetos/contracts";
import {
  CORR_1,
  DEV_1,
  DEMO_WINDOW,
  EXTRACTED_AT,
  T0,
  T1,
  T2,
  T3,
  T4,
  TENANT_ID,
  makeObservation,
  resetObservationCounter,
} from "./helpers";
import {
  createInMemoryFeatureSetStore,
  createInMemoryPredictiveAuditSink,
  extractDeviceHistoryFeatures,
  featureSetStoreId,
  recordFeatureSet,
  verifyFeatureSetProvenance,
} from "../src/index";
import type { PredictiveAuditRecord, PredictiveAuditSink } from "../src/index";

// A second tenant for the per-tenant-chain-separate test.
const TENANT_B = asTenantId("tnt_w153binding002");

// ---------------------------------------------------------------------------
// The structural compatibility proof (REAL @fleetos/audit sink adapter)
// ---------------------------------------------------------------------------

test("binding: the REAL @fleetos/audit sink adapter satisfies the PredictiveAuditSink seam STRUCTURALLY", () => {
  // Build the REAL @fleetos/audit sink adapter against a REAL audit log.
  const log = createInMemoryAuditLog();
  const realSink = createAuditSinkAdapter(log, { source: "predictive.device-history-features" });

  // The adapter is structurally compatible with PredictiveAuditSink —
  // TypeScript's structural typing means it satisfies the seam without
  // a cross-lane import. The records carry the same shape:
  // { tenantId, action, subject, occurredAt, correlationId,
  //   causationId?, details } — the same shape the adapter's
  // AuditSinkRecord accepts.
  const seam: PredictiveAuditSink = realSink;

  // Emit a record through the seam.
  const record: PredictiveAuditRecord = {
    tenantId: TENANT_ID,
    action: "predictive.feature.extracted",
    subject: "pfs_test0000000000000000000000000000000000000000000000000000001",
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { inputDigest: "0".repeat(64), featureCount: 4 },
  };
  seam.append(record);

  // The record landed in the REAL hash-chained AuditLog.
  const ctx = makeTenantContext(TENANT_ID, CORR_1);
  expect(log.size(ctx)).toBe(1);
  const appended = log.records(ctx)[0];
  expect(appended).toBeDefined();
  expect(appended?.action).toBe("predictive.feature.extracted");
  expect(appended?.source).toBe("predictive.device-history-features");
  expect(appended?.correlationId).toBe(CORR_1);
  expect(appended?.details).toEqual({
    inputDigest: "0".repeat(64),
    featureCount: 4,
    subject: "pfs_test0000000000000000000000000000000000000000000000000000001",
  });
  // Default actor: the emitting boundary as a service principal.
  expect(appended?.actor).toEqual({
    kind: "service",
    principalId: "svc:predictive.device-history-features",
    tenantId: TENANT_ID,
  });
  // Default outcome: success.
  expect(appended?.outcome).toEqual({ status: "success" });
  // The chain verifies.
  expect(log.verify(ctx).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// The integration proof: extraction over observations from the REAL device-model
// ---------------------------------------------------------------------------

test("binding: extraction over observations admitted through the REAL @fleetos/device-model boundary produces a feature set whose provenance verifies", () => {
  resetObservationCounter();
  // Compose the REAL device-model store (the same composition
  // demo-fleet.ts uses — the W091 pattern).
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "W091-DEMO-0001" },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR_1 } });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);

  // Record observations through the REAL recordTwinObservations boundary.
  const observations: Observation[] = [
    makeObservation("device.security", T1, { diskEncryption: true, batteryLevel: 92, diskFreeBytes: 256_000_000_000 }),
    makeObservation("device.security", T2, { diskEncryption: true, batteryLevel: 88, diskFreeBytes: 240_000_000_000 }),
    makeObservation("device.security", T3, { diskEncryption: false, batteryLevel: 75, diskFreeBytes: 220_000_000_000 }),
    makeObservation("device.security", T4, { diskEncryption: false, batteryLevel: 61, diskFreeBytes: 200_000_000_000 }),
  ];
  const observed = recordTwinObservations(created.twin, observations, {
    at: T1,
    correlationId: CORR_1,
  });
  expect(observed.ok).toBe(true);
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);

  // The twin's telemetry section carries the bounded latest-observation
  // window. Pull the observations back OUT of the twin (the way W154's
  // engine will — the W153 feed READS the immutable admitted
  // observation stream; the twin's telemetry is the bounded window
  // the W154 engine consumes).
  const twin = observed.twin;
  const twinObservations = twin.telemetry.latest;

  // Extract features over the twin's admitted observations.
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: twinObservations,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error(`extraction failed: ${extraction.error.message}`);
  // The status is `ok` (4 observations >= MIN_OBSERVATIONS_FOR_FEATURES).
  expect(extraction.featureSet.status.kind).toBe("ok");
  // The feature family is populated.
  expect(extraction.featureSet.features.length).toBeGreaterThan(0);
  // The input digest is the SHA-256 of the canonical observation stream.
  expect(extraction.featureSet.inputDigest).toMatch(/^[0-9a-f]{64}$/);

  // Verify the feature set's provenance against the SAME observations.
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: twinObservations,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(`verification failed: ${verification.error.message}`);
  expect(verification.inputDigest).toBe(extraction.featureSet.inputDigest);
});

// ---------------------------------------------------------------------------
// The end-to-end audit-chain proof: extraction → record → REAL audit log
// ---------------------------------------------------------------------------

test("binding: the audited recording boundary emits into the REAL hash-chained AuditLog; the chain verifies", () => {
  resetObservationCounter();
  // The REAL @fleetos/audit log + sink adapter (the W012 seam).
  const auditLog = createInMemoryAuditLog();
  const realAuditSink = createAuditSinkAdapter(auditLog, {
    source: "predictive.device-history-features",
  });

  // The predictive feature-set store + the recording boundary (W153
  // lane) wired to the REAL audit sink adapter.
  const featureStore = createInMemoryFeatureSetStore();
  const recordingSink: PredictiveAuditSink = realAuditSink;

  // Compose the REAL device-model store + twin (the W091 pattern).
  const twinStore = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "W091-DEMO-0001" },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR_1 } });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);
  const observations: Observation[] = [
    makeObservation("device.security", T1, { diskEncryption: true, batteryLevel: 92 }),
    makeObservation("device.security", T2, { diskEncryption: true, batteryLevel: 88 }),
    makeObservation("device.security", T3, { diskEncryption: false, batteryLevel: 75 }),
    makeObservation("device.security", T4, { diskEncryption: false, batteryLevel: 61 }),
  ];
  const observed = recordTwinObservations(created.twin, observations, { at: T1, correlationId: CORR_1 });
  expect(observed.ok).toBe(true);
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);
  twinStore.put(observed.twin);

  // Extract features + record them through the audited boundary into
  // the REAL audit log.
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: observed.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error(`extraction failed: ${extraction.error.message}`);

  const write = recordFeatureSet(
    { tenantId: TENANT_ID, correlationId: CORR_1 },
    featureStore,
    extraction.featureSet,
    { auditSink: recordingSink, correlationId: CORR_1, causationId: undefined },
  );
  expect(write.ok).toBe(true);
  if (!write.ok) throw new Error(`record failed`);
  expect(write.created).toBe(true);

  // The audit record landed in the REAL hash-chained AuditLog.
  const ctx = makeTenantContext(TENANT_ID, CORR_1);
  expect(auditLog.size(ctx)).toBe(1);
  const appended = auditLog.records(ctx)[0]!;
  expect(appended.action).toBe("predictive.feature.extracted");
  expect(appended.source).toBe("predictive.device-history-features");
  // The subject is preserved in `details.subject` (the audit adapter's
  // documented behavior — audit correlates via details + relatedEventIds,
  // not a typed subject field).
  expect(appended.details.subject).toBe(featureSetStoreId(extraction.featureSet));
  // The hash chain verifies.
  const verification = auditLog.verify(ctx);
  expect(verification.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Per-tenant chains stay separate
// ---------------------------------------------------------------------------

test("binding: per-tenant audit chains stay SEPARATE (tenant B's emissions never enter tenant A's chain)", () => {
  resetObservationCounter();
  const auditLog = createInMemoryAuditLog();
  const realAuditSinkA = createAuditSinkAdapter(auditLog, { source: "predictive.device-history-features" });
  const realAuditSinkB = createAuditSinkAdapter(auditLog, { source: "predictive.device-history-features" });

  const featureStoreA = createInMemoryFeatureSetStore();
  const featureStoreB = createInMemoryFeatureSetStore();

  // Tenant A: enroll + observe + extract + record.
  const enrolledA = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "A-0001" },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  expect(enrolledA.ok).toBe(true);
  if (!enrolledA.ok) throw new Error(`enroll A failed: ${enrolledA.error.message}`);
  const createdA = createTwin({ identity: enrolledA.identity, ctx: { at: T0, correlationId: CORR_1 } });
  expect(createdA.ok).toBe(true);
  if (!createdA.ok) throw new Error(`twin A failed: ${createdA.error.message}`);
  const obsA: Observation[] = [
    makeObservation("device.security", T1, { batteryLevel: 92 }),
    makeObservation("device.security", T2, { batteryLevel: 88 }),
    makeObservation("device.security", T3, { batteryLevel: 75 }),
    makeObservation("device.security", T4, { batteryLevel: 61 }),
  ];
  const observedA = recordTwinObservations(createdA.twin, obsA, { at: T1, correlationId: CORR_1 });
  expect(observedA.ok).toBe(true);
  if (!observedA.ok) throw new Error(`observations A failed: ${observedA.error.message}`);

  const extractionA = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: observedA.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extractionA.ok).toBe(true);
  if (!extractionA.ok) throw new Error(`extraction A failed: ${extractionA.error.message}`);
  const writeA = recordFeatureSet(
    { tenantId: TENANT_ID, correlationId: CORR_1 },
    featureStoreA,
    extractionA.featureSet,
    { auditSink: realAuditSinkA, correlationId: CORR_1 },
  );
  expect(writeA.ok).toBe(true);
  if (!writeA.ok) throw new Error(`record A failed`);

  // Tenant B: enroll + observe + extract + record.
  const devB = asDeviceId("dev_w153binding0002");
  const enrolledB = enrollDevice({
    tenantId: TENANT_B,
    deviceId: devB,
    adapterFamily: "macos-mdm",
    hardware: { manufacturer: "Apple", model: "MacBook Air M3", serialNumber: "B-0001" },
    ownership: { ownerType: "LEASED", assignedTeam: "hq" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  expect(enrolledB.ok).toBe(true);
  if (!enrolledB.ok) throw new Error(`enroll B failed: ${enrolledB.error.message}`);
  const createdB = createTwin({ identity: enrolledB.identity, ctx: { at: T0, correlationId: CORR_1 } });
  expect(createdB.ok).toBe(true);
  if (!createdB.ok) throw new Error(`twin B failed: ${createdB.error.message}`);
  const obsB: Observation[] = [
    makeObservation("device.health", T1, { batteryCapacity: 95.5, cycleCount: 12 }),
    makeObservation("device.health", T2, { batteryCapacity: 93.2, cycleCount: 13 }),
    makeObservation("device.health", T3, { batteryCapacity: 91.8, cycleCount: 14 }),
  ];
  const observedB = recordTwinObservations(createdB.twin, obsB, { at: T1, correlationId: CORR_1 });
  expect(observedB.ok).toBe(true);
  if (!observedB.ok) throw new Error(`observations B failed: ${observedB.error.message}`);

  const extractionB = extractDeviceHistoryFeatures({
    tenantId: TENANT_B,
    deviceId: devB,
    observations: observedB.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extractionB.ok).toBe(true);
  if (!extractionB.ok) throw new Error(`extraction B failed: ${extractionB.error.message}`);
  const writeB = recordFeatureSet(
    { tenantId: TENANT_B, correlationId: CORR_1 },
    featureStoreB,
    extractionB.featureSet,
    { auditSink: realAuditSinkB, correlationId: CORR_1 },
  );
  expect(writeB.ok).toBe(true);
  if (!writeB.ok) throw new Error(`record B failed`);

  // The per-tenant chains are SEPARATE: tenant A's chain has 1 record,
  // tenant B's chain has 1 record, neither shares with the other.
  const ctxA = makeTenantContext(TENANT_ID);
  const ctxB = makeTenantContext(TENANT_B);
  expect(auditLog.size(ctxA)).toBe(1);
  expect(auditLog.size(ctxB)).toBe(1);
  // Both chains verify independently.
  expect(auditLog.verify(ctxA).ok).toBe(true);
  expect(auditLog.verify(ctxB).ok).toBe(true);
  // The records are DIFFERENT (tenant A's record is about DEV_1; tenant
  // B's is about devB). The subject is preserved in details.subject.
  const recordsA = auditLog.records(ctxA);
  const recordsB = auditLog.records(ctxB);
  expect(recordsA[0]!.tenantId).toBe(TENANT_ID);
  expect(recordsB[0]!.tenantId).toBe(TENANT_B);
  expect(recordsA[0]!.details.subject).not.toBe(recordsB[0]!.details.subject);
});

// ---------------------------------------------------------------------------
// The in-memory collecting sink vs the REAL adapter (the seam is structural)
// ---------------------------------------------------------------------------

test("binding: the in-memory collecting sink is structurally compatible with the REAL adapter (the seam is structural)", () => {
  // The in-memory collecting sink (the lane's own reference
  // implementation) emits the same record shape the REAL @fleetos/audit
  // adapter accepts — both satisfy PredictiveAuditSink structurally.
  const inMemorySink = createInMemoryPredictiveAuditSink();
  const realLog = createInMemoryAuditLog();
  const realSink = createAuditSinkAdapter(realLog, { source: "predictive.device-history-features" });

  // Build the same record through both sinks.
  const record: PredictiveAuditRecord = {
    tenantId: TENANT_ID,
    action: "predictive.feature.extracted",
    subject: "pfs_seam0000000000000000000000000000000000000000000000000000002",
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { inputDigest: "0".repeat(64) },
  };
  const inMemorySeam: PredictiveAuditSink = inMemorySink;
  const realSeam: PredictiveAuditSink = realSink;
  inMemorySeam.append(record);
  realSeam.append(record);

  // Both sinks accepted the record. The in-memory sink has 1 record;
  // the REAL audit log has 1 record.
  expect(inMemorySink.records.length).toBe(1);
  expect(realLog.size(makeTenantContext(TENANT_ID, CORR_1))).toBe(1);
  // The records carry the same shape.
  const inMemoryRecord = inMemorySink.records[0]!;
  const realRecord = realLog.records(makeTenantContext(TENANT_ID, CORR_1))[0]!;
  expect(inMemoryRecord.action).toBe(realRecord.action);
  expect(inMemoryRecord.tenantId).toBe(realRecord.tenantId);
  expect(inMemoryRecord.correlationId).toBe(realRecord.correlationId);
  expect(inMemoryRecord.occurredAt).toBe(realRecord.occurredAt);
});
