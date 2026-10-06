/**
 * W154 world-model — the integration binding proof.
 *
 * Proves the world-model package's surfaces are STRUCTURALLY compatible
 * with the REAL @fleetos/audit sink adapter AND that the engine works
 * over the REAL @fleetos/predictive feed + REAL @fleetos/device-model
 * store. NOT mocked — the binding uses the REAL hash-chained AuditLog,
 * the REAL sink adapter, the REAL device-model store, the REAL
 * enrollDevice/createTwin/recordTwinObservations APIs, AND the REAL
 * `extractDeviceHistoryFeatures` (the W153 feed consumed through its
 * public surface, injected at the binding site — the W040-disclosed
 * structural-seam pattern).
 *
 * Per the W154 work order: "binding test: the engine over the REAL W153
 * feed composition (the helpers pattern from
 * packages/predictive/test/helpers.ts is the precedent) with the REAL
 * @fleetos/audit sink adapter".
 *
 * The "demo-fleet.ts seam" is the COMPOSITION PATTERN — the same
 * @fleetos/device-model + @fleetos/audit + @fleetos/predictive APIs the
 * demo-fleet.ts runtime uses. This test replicates that composition in
 * a binding-test fixture (the demo-fleet.ts runtime pulls in Next.js +
 * React; the world-model package's binding test stays pure-Bun).
 *
 * Proven by this test:
 *   - the REAL @fleetos/audit sink adapter STRUCTURALLY satisfies the
 *     world-model lane's `WorldModelAuditSink` seam (TypeScript
 *     structural typing — the seam is `{ append(record) }` where the
 *     record carries `{ tenantId, action, subject, occurredAt,
 *     correlationId, causationId?, details }` — the same shape the
 *     audit adapter's `AuditSinkRecord` accepts);
 *   - the engine works over the REAL W153 feed (the
 *     `extractDeviceHistoryFeatures` output satisfies the local
 *     `FeatureSetLike` interface — the structural-seam law);
 *   - the audit records flow into the REAL hash-chained AuditLog;
 *   - the chain verifies;
 *   - per-tenant chains stay SEPARATE.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asTenantId } from "@fleetos/contracts";
import type { AuditLog } from "@fleetos/audit";
import { createAuditSinkAdapter, createInMemoryAuditLog } from "@fleetos/audit";
import { makeTenantContext } from "@fleetos/identity";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import { extractDeviceHistoryFeatures, verifyFeatureSetProvenance } from "@fleetos/predictive";
import type { Observation } from "@fleetos/contracts";
import {
  AS_OF,
  CORR_1,
  DEMO_WINDOW,
  DEV_1,
  EXTRACTED_AT,
  PRODUCED_AT,
  SCOPE,
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
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  createInMemoryWorldModelAuditSink,
  createReferenceAdapter,
  predict,
  predictAfterAction,
  represent,
} from "../src/index";
import type { WorldModelAuditRecord, WorldModelAuditSink, WorldModelContext } from "../src/index";

// A second tenant for the per-tenant-chain-separate test.
const TENANT_B = asTenantId("tnt_w154binding002");

// ---------------------------------------------------------------------------
// The structural compatibility proof (REAL @fleetos/audit sink adapter)
// ---------------------------------------------------------------------------

test("binding: the REAL @fleetos/audit sink adapter satisfies the WorldModelAuditSink seam STRUCTURALLY", () => {
  // Build the REAL @fleetos/audit sink adapter against a REAL audit log.
  const log = createInMemoryAuditLog();
  const realSink = createAuditSinkAdapter(log, { source: "world-model.engine" });

  // The adapter is structurally compatible with WorldModelAuditSink —
  // TypeScript's structural typing means it satisfies the seam without
  // a cross-lane import.
  const seam: WorldModelAuditSink = realSink;

  // Emit a record through the seam.
  const record: WorldModelAuditRecord = {
    tenantId: TENANT_ID,
    action: "world-model.tenant.scope.refused.representation",
    subject: "wmr_test000000000000000000000000000000000000000000000000000001",
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { reason: "tenant_mismatch" },
  };
  seam.append(record);

  // The record landed in the REAL hash-chained AuditLog.
  const ctx = makeTenantContext(TENANT_ID, CORR_1);
  expect(log.size(ctx)).toBe(1);
  const appended = log.records(ctx)[0];
  expect(appended).toBeDefined();
  expect(appended?.action).toBe("world-model.tenant.scope.refused.representation");
  expect(appended?.source).toBe("world-model.engine");
  expect(appended?.correlationId).toBe(CORR_1);
  expect(appended?.details).toEqual({
    reason: "tenant_mismatch",
    subject: "wmr_test000000000000000000000000000000000000000000000000000001",
  });
  // Default actor: the emitting boundary as a service principal.
  expect(appended?.actor).toEqual({
    kind: "service",
    principalId: "svc:world-model.engine",
    tenantId: TENANT_ID,
  });
  // Default outcome: success.
  expect(appended?.outcome).toEqual({ status: "success" });
  // The chain verifies.
  expect(log.verify(ctx).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// The integration proof: the engine over the REAL W153 feed
// ---------------------------------------------------------------------------

test("binding: the engine represents + predicts over the REAL W153 feed (extractDeviceHistoryFeatures output satisfies FeatureSetLike)", () => {
  resetObservationCounter();
  // Compose the REAL device-model store (the same composition
  // demo-fleet.ts uses — the W091 pattern).
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "W154-DEMO-0001" },
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
  store.put(observed.twin);

  // Extract features over the twin's admitted observations using the
  // REAL `@fleetos/predictive` `extractDeviceHistoryFeatures` (the
  // binding site that injects the REAL W153 feed into the W154 engine).
  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: observed.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error(`extraction failed: ${extraction.error.message}`);
  expect(extraction.featureSet.status.kind).toBe("ok");

  // Build a representation using the W154 engine — the REAL W153
  // `DeviceHistoryFeatureSet` satisfies the local `FeatureSetLike`
  // interface (TypeScript structural typing — the W040-disclosed seam).
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({ scope: SCOPE, featureSet: extraction.featureSet, context });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error(`represent failed: ${rep.error.message}`);
  expect(rep.representation.status.kind).toBe("ok");

  // Predict over the representation.
  const horizon = { horizonMs: 24 * 60 * 60 * 1000 };
  const pred = predict({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(pred.ok).toBe(true);
  if (!pred.ok) throw new Error(`predict failed: ${pred.error.message}`);
  // The prediction carries the provenance chain.
  expect(pred.prediction.provenance.representationDigest).toBe(rep.representation.provenanceChainDigest);
  expect(pred.prediction.provenance.featureSetInputDigest).toBe(extraction.featureSet.inputDigest);

  // Verify the feature-set → input-digest leg with the REAL W153 trust
  // anchor (the W154 lane consumes the W153 feed through its public
  // surface; the verification uses the W153 trust anchor — the
  // binding-test composition pattern).
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: observed.twin.telemetry.latest,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(`verification failed: ${verification.error.message}`);
  expect(verification.inputDigest).toBe(extraction.featureSet.inputDigest);
  expect(verification.inputDigest).toBe(pred.prediction.provenance.featureSetInputDigest);
});

// ---------------------------------------------------------------------------
// The end-to-end audit-chain proof: represent → predict → REAL audit log
// (the lane audits tenant-scope refusals; the chain verifies)
// ---------------------------------------------------------------------------

test("binding: a tenant-scope refusal at the engine boundary emits into the REAL hash-chained AuditLog; the chain verifies", () => {
  resetObservationCounter();
  // The REAL @fleetos/audit log + sink adapter.
  const auditLog = createInMemoryAuditLog();
  const realAuditSink = createAuditSinkAdapter(auditLog, { source: "world-model.engine" });

  // Compose the REAL W153 feed over a REAL device-model twin.
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "W154-DEMO-0002" },
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
    makeObservation("device.security", T1, { batteryLevel: 92 }),
    makeObservation("device.security", T2, { batteryLevel: 88 }),
    makeObservation("device.security", T3, { batteryLevel: 75 }),
    makeObservation("device.security", T4, { batteryLevel: 61 }),
  ];
  const observed = recordTwinObservations(created.twin, observations, { at: T1, correlationId: CORR_1 });
  expect(observed.ok).toBe(true);
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);

  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: observed.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error(`extraction failed: ${extraction.error.message}`);

  // Try to represent the W153 feed under a FOREIGN scope (TENANT_B).
  // The W154 engine refuses — the feature set's tenantId (TENANT_ID)
  // does not match the acting scope (TENANT_B). The refusal is
  // consequential evidence a reviewer must be able to reconstruct
  // (ADR-0002 invariant 7: "Tenant isolation applies to ... inference
  // context, representations, predictions").
  const foreignScope = { tenantId: TENANT_B };
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID, // the context's tenantId is TENANT_ID — the engine refuses
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = represent({
    scope: foreignScope,
    featureSet: extraction.featureSet,
    context,
    auditSink: realAuditSink,
  });
  expect(rep.ok).toBe(false);
  if (rep.ok) throw new Error("expected refusal");
  expect(rep.error.message.includes("tenant_mismatch")).toBe(true);

  // The audit record landed in the REAL hash-chained AuditLog.
  const ctxB = makeTenantContext(TENANT_B, CORR_1);
  expect(auditLog.size(ctxB)).toBe(1);
  const appended = auditLog.records(ctxB)[0]!;
  expect(appended.action).toBe("world-model.tenant.scope.refused.representation");
  expect(appended.source).toBe("world-model.engine");
  expect(appended.tenantId).toBe(TENANT_B);
  // The hash chain verifies.
  const verification = auditLog.verify(ctxB);
  expect(verification.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Per-tenant chains stay separate
// ---------------------------------------------------------------------------

test("binding: per-tenant audit chains stay SEPARATE (tenant B's emissions never enter tenant A's chain)", () => {
  resetObservationCounter();
  const auditLog = createInMemoryAuditLog();
  const realAuditSinkA = createAuditSinkAdapter(auditLog, { source: "world-model.engine" });
  const realAuditSinkB = createAuditSinkAdapter(auditLog, { source: "world-model.engine" });

  // Tenant A: emit a tenant-scope refusal into tenant A's chain.
  const recordA: WorldModelAuditRecord = {
    tenantId: TENANT_ID,
    action: "world-model.tenant.scope.refused.representation",
    subject: null,
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { reason: "tenant_mismatch" },
  };
  realAuditSinkA.append(recordA);

  // Tenant B: emit a tenant-scope refusal into tenant B's chain.
  const recordB: WorldModelAuditRecord = {
    tenantId: TENANT_B,
    action: "world-model.tenant.scope.refused.representation",
    subject: null,
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { reason: "tenant_mismatch" },
  };
  realAuditSinkB.append(recordB);

  // The per-tenant chains are SEPARATE: tenant A's chain has 1 record,
  // tenant B's chain has 1 record, neither shares with the other.
  const ctxA = makeTenantContext(TENANT_ID);
  const ctxB = makeTenantContext(TENANT_B);
  expect(auditLog.size(ctxA)).toBe(1);
  expect(auditLog.size(ctxB)).toBe(1);
  // Both chains verify independently.
  expect(auditLog.verify(ctxA).ok).toBe(true);
  expect(auditLog.verify(ctxB).ok).toBe(true);
  // The records are DIFFERENT (tenant A's record is for TENANT_ID;
  // tenant B's is for TENANT_B).
  expect(auditLog.records(ctxA)[0]!.tenantId).toBe(TENANT_ID);
  expect(auditLog.records(ctxB)[0]!.tenantId).toBe(TENANT_B);
});

// ---------------------------------------------------------------------------
// The in-memory collecting sink vs the REAL adapter (the seam is structural)
// ---------------------------------------------------------------------------

test("binding: the in-memory collecting sink is structurally compatible with the REAL adapter (the seam is structural)", () => {
  // The in-memory collecting sink (the lane's own reference
  // implementation) emits the same record shape the REAL @fleetos/audit
  // adapter accepts — both satisfy WorldModelAuditSink structurally.
  const inMemorySink = createInMemoryWorldModelAuditSink();
  const realLog = createInMemoryAuditLog();
  const realSink = createAuditSinkAdapter(realLog, { source: "world-model.engine" });

  // Build the same record through both sinks.
  const record: WorldModelAuditRecord = {
    tenantId: TENANT_ID,
    action: "world-model.tenant.scope.refused.prediction",
    subject: "wmp_test000000000000000000000000000000000000000000000000000002",
    occurredAt: EXTRACTED_AT,
    correlationId: CORR_1,
    details: { reason: "tenant_mismatch" },
  };
  const inMemorySeam: WorldModelAuditSink = inMemorySink;
  const realSeam: WorldModelAuditSink = realSink;
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

// ---------------------------------------------------------------------------
// The adapter-seam binding (the reference adapter composed at the binding site)
// ---------------------------------------------------------------------------

test("binding: the reference adapter composes with the REAL W153 feed + REAL device-model + REAL audit sink", () => {
  resetObservationCounter();
  // The REAL @fleetos/audit log + sink adapter.
  const auditLog = createInMemoryAuditLog();
  const realAuditSink = createAuditSinkAdapter(auditLog, { source: "world-model.engine" });

  // Compose the REAL W153 feed over a REAL device-model twin.
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "W154-DEMO-0003" },
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
    makeObservation("device.security", T1, { batteryLevel: 92 }),
    makeObservation("device.security", T2, { batteryLevel: 88 }),
    makeObservation("device.security", T3, { batteryLevel: 75 }),
    makeObservation("device.security", T4, { batteryLevel: 61 }),
  ];
  const observed = recordTwinObservations(created.twin, observations, { at: T1, correlationId: CORR_1 });
  expect(observed.ok).toBe(true);
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);

  const extraction = extractDeviceHistoryFeatures({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: observed.twin.telemetry.latest,
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
  expect(extraction.ok).toBe(true);
  if (!extraction.ok) throw new Error(`extraction failed: ${extraction.error.message}`);

  // Compose the reference adapter at the binding site.
  const adapter = createReferenceAdapter();
  const context: WorldModelContext = {
    schemaVersion: 1,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    asOf: AS_OF,
  };
  const rep = adapter.represent({
    scope: SCOPE,
    featureSet: extraction.featureSet,
    context,
    auditSink: realAuditSink,
  });
  expect(rep.ok).toBe(true);
  if (!rep.ok) throw new Error(`represent failed: ${rep.error.message}`);
  // The capability name is the reference's.
  expect(adapter.capability.name).toBe("world-model.reference.deterministic");

  // Predict through the adapter.
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
  if (!pred.ok) throw new Error(`predict failed: ${pred.error.message}`);
  expect(pred.prediction.capability.name).toBe("world-model.reference.deterministic");

  // Counterfactual through the adapter.
  const cf = adapter.predictAfterAction({
    scope: SCOPE,
    representation: rep.representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon,
    candidateAction: { ref: "act.restart_device", description: "Restart" },
    producedAt: PRODUCED_AT,
    correlationId: CORR_1,
  });
  expect(cf.ok).toBe(true);
  if (!cf.ok) throw new Error(`predictAfterAction failed: ${cf.error.message}`);
  expect(cf.counterfactual.kind).toBe("counterfactual");
  expect(cf.counterfactual.hypothetical).toBe(true);

  // The provenance chain holds:
  //   prediction → representation → feature set → input digest.
  const verification = verifyFeatureSetProvenance(
    {
      scope: { tenantId: TENANT_ID, correlationId: CORR_1 },
      featureSet: extraction.featureSet,
      observations: observed.twin.telemetry.latest,
    },
    { verifiedAt: EXTRACTED_AT },
  );
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error(`verification failed: ${verification.error.message}`);
  expect(verification.inputDigest).toBe(extraction.featureSet.inputDigest);
  expect(verification.inputDigest).toBe(pred.prediction.provenance.featureSetInputDigest);
  expect(verification.inputDigest).toBe(cf.counterfactual.provenance.featureSetInputDigest);
});
