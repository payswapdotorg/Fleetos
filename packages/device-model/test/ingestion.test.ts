/**
 * W011 D4 tests — the ingestion control-plane boundary: validation,
 * idempotent admission by batch/event id (contracts idempotency), ack
 * semantics, back-pressure, audit emission seam, and tenant isolation.
 */

import { test, expect } from "bun:test";
import { validateObservationBatch } from "@fleetos/contracts";
import type { ObservationBatch } from "@fleetos/contracts";
import {
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeObservationBatch,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { OWNERSHIP_TYPE_CUSTOMER_OWNED, enrollDevice } from "../src/identity";
import { createTwin, transitionTwinLifecycle } from "../src/twin";
import { createInMemoryTwinStore } from "../src/store";
import { createInMemoryAuditSink } from "../src/audit-seam";
import { createStorageBytesNormalizer } from "../src/normalize";
import {
  AUDIT_ACTIONS,
  createObservationIngestionService,
} from "../src/ingestion";
import type {
  IngestionServiceOptions,
  ObservationIngestionRequest,
  ObservationIngestionService,
} from "../src/ingestion";

function makeServiceFixture(options?: Partial<IngestionServiceOptions>): {
  service: ObservationIngestionService;
  tenantId: string;
  deviceId: string;
} {
  const tenantId = makeTenantId("ingestion-tests");
  const deviceId = makeDeviceId("ingestion-tests-device");
  const store = options?.store ?? createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "windows",
    hardware: { manufacturer: "Dell", model: "Latitude 7440" },
    ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
    at: "2026-04-01T08:00:00Z",
    provenance: { correlationId: makeCorrelationId("ingestion-enroll") },
  });
  if (!enrolled.ok) throw new Error("fixture enrollment failed");
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: "2026-04-01T08:00:01Z", correlationId: makeCorrelationId("ingestion-create") },
  });
  if (!created.ok) throw new Error("fixture twin creation failed");
  store.put(created.twin);
  const service = createObservationIngestionService({ store, ...options });
  return { service, tenantId: tenantId as string, deviceId: deviceId as string };
}

function makeRequest(
  tenantId: string,
  deviceId: string,
  overrides?: {
    batch?: ObservationBatch;
    idempotencyKey?: string;
    receivedAt?: string;
    correlationId?: string;
    batchTenantId?: string;
  },
): ObservationIngestionRequest {
  const batch =
    overrides?.batch ??
    makeObservationBatch({
      seed: "ingestion-batch",
      tenantId: (overrides?.batchTenantId ?? tenantId) as never,
      deviceId: deviceId as never,
      count: 3,
    });
  return {
    tenantId: tenantId as never,
    batch,
    idempotencyKey: (overrides?.idempotencyKey ?? makeIdempotencyKey("ingestion-key-1")) as never,
    correlationId: (overrides?.correlationId ?? makeCorrelationId("ingestion-cor")) as never,
    receivedAt: overrides?.receivedAt ?? "2026-04-02T09:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Happy admission
// ---------------------------------------------------------------------------

test("admission: a valid check-in is admitted, the twin records the observations, and an audit record is emitted", () => {
  const audit = createInMemoryAuditSink();
  const { service, tenantId, deviceId } = makeServiceFixture({ auditSink: audit });
  const batch = makeObservationBatch({ seed: "ingestion-batch", tenantId: tenantId as never, deviceId: deviceId as never, count: 3 });
  const result = service.ingest(makeRequest(tenantId, deviceId, { batch }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.ack.kind).toBe("admitted");
  if (result.ack.kind !== "admitted") return;
  expect(result.ack.admittedObservations).toBe(3);
  expect(result.ack.duplicateObservations).toBe(0);
  expect(result.ack.twinRevision).toBe(2);

  const twin = service.store.get(tenantId as never, deviceId as never);
  expect(twin).toBeDefined();
  if (twin) {
    expect(twin.telemetry.observationCount).toBe(3);
    expect(twin.telemetry.latest).toHaveLength(3);
    expect(twin.revision).toBe(2);
  }

  expect(audit.records).toHaveLength(1);
  const record = audit.records[0];
  expect(record.action).toBe(AUDIT_ACTIONS.admitted);
  expect(record.tenantId).toBe(tenantId);
  expect(record.subject).toBe(deviceId);
  expect(record.occurredAt).toBe("2026-04-02T09:00:00Z");
  expect(record.details.admittedObservations).toBe(3);
  expect(typeof record.details.batchDigest).toBe("string");
});

test("admission: the batch itself satisfies the frozen contracts validator (conformance)", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  const batch = makeObservationBatch({ seed: "ingestion-batch", tenantId: tenantId as never, deviceId: deviceId as never, count: 2 });
  expect(validateObservationBatch(batch).ok).toBe(true);
  const result = service.ingest(makeRequest(tenantId, deviceId, { batch }));
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Idempotent admission (REQUIRED: same batch twice => one admission)
// ---------------------------------------------------------------------------

test("idempotency: replaying the SAME batch returns a duplicate ack and does NOT re-admit", () => {
  const audit = createInMemoryAuditSink();
  const { service, tenantId, deviceId } = makeServiceFixture({ auditSink: audit });
  const batch = makeObservationBatch({ seed: "ingestion-replay", tenantId: tenantId as never, deviceId: deviceId as never, count: 3 });
  const request = makeRequest(tenantId, deviceId, { batch });

  const first = service.ingest(request);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.ack.kind).toBe("admitted");

  const replay = service.ingest({ ...request, receivedAt: "2026-04-02T09:05:00Z" });
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.ack.kind).toBe("duplicate");
  if (replay.ack.kind !== "duplicate") return;
  expect(replay.ack.firstAdmittedAt).toBe("2026-04-02T09:00:00Z");
  // The ORIGINAL outcome is returned, not re-executed.
  expect(replay.ack.admittedObservations).toBe(3);

  // The twin was admitted exactly ONCE.
  const twin = service.store.get(tenantId as never, deviceId as never);
  if (twin) {
    expect(twin.telemetry.observationCount).toBe(3);
    expect(twin.revision).toBe(2);
  }
  // Back-pressure queue did not grow on the replay.
  expect(service.backPressure().queueDepth).toBe(3);
  // Audit: one admission + one duplicate-suppression.
  expect(audit.records).toHaveLength(2);
  expect(audit.records[1].action).toBe(AUDIT_ACTIONS.duplicateSuppressed);
});

test("idempotency: the same key with a DIFFERENT batch is an idempotency conflict (ConflictError)", () => {
  const audit = createInMemoryAuditSink();
  const { service, tenantId, deviceId } = makeServiceFixture({ auditSink: audit });
  const key = makeIdempotencyKey("conflicting-key");
  const batchA = makeObservationBatch({ seed: "batch-a", tenantId: tenantId as never, deviceId: deviceId as never, count: 2 });
  const batchB = makeObservationBatch({ seed: "batch-b", tenantId: tenantId as never, deviceId: deviceId as never, count: 2 });

  expect(service.ingest(makeRequest(tenantId, deviceId, { batch: batchA, idempotencyKey: key as string })).ok).toBe(true);
  const conflict = service.ingest(makeRequest(tenantId, deviceId, { batch: batchB, idempotencyKey: key as string }));
  expect(conflict.ok).toBe(false);
  if (!conflict.ok) {
    expect(conflict.error.kind).toBe("ConflictError");
    expect(conflict.error.code).toBe("device.ingestion.idempotency_conflict");
    if (conflict.error.kind === "ConflictError") {
      expect(conflict.error.resource).toContain("observation-batch:");
    }
  }
  // The conflicting attempt is audited as a rejection.
  const actions = audit.records.map((r) => r.action);
  expect(actions).toContain(AUDIT_ACTIONS.rejected);
});

test("idempotency: event-level dedup — an observation id is admitted exactly once per (tenant, device)", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  const sharedObservation = {
    id: makeObservationId("shared-obs"),
    kind: "device.health",
    observedAt: "2026-04-02T09:00:00Z",
    schemaVersion: 1,
    payload: { shared: true },
  };
  const batchOne: ObservationBatch = {
    tenantId: tenantId as never,
    deviceId: deviceId as never,
    observedAt: "2026-04-02T09:00:00Z",
    observations: [sharedObservation],
  };
  const batchTwo: ObservationBatch = {
    tenantId: tenantId as never,
    deviceId: deviceId as never,
    observedAt: "2026-04-02T09:10:00Z",
    observations: [
      sharedObservation, // same event id — suppressed
      {
        id: makeObservationId("fresh-obs"),
        kind: "device.power",
        observedAt: "2026-04-02T09:10:00Z",
        schemaVersion: 1,
        payload: { pct: 80 },
      },
    ],
  };

  const first = service.ingest(makeRequest(tenantId, deviceId, { batch: batchOne, idempotencyKey: "idem_batch_one" }));
  expect(first.ok).toBe(true);
  if (!first.ok || first.ack.kind !== "admitted") return;

  const second = service.ingest(makeRequest(tenantId, deviceId, { batch: batchTwo, idempotencyKey: "idem_batch_two" }));
  expect(second.ok).toBe(true);
  if (!second.ok || second.ack.kind !== "admitted") return;
  expect(second.ack.admittedObservations).toBe(1);
  expect(second.ack.duplicateObservations).toBe(1);

  const twin = service.store.get(tenantId as never, deviceId as never);
  if (twin) {
    expect(twin.telemetry.observationCount).toBe(2); // 1 + 1 new
  }
});

// ---------------------------------------------------------------------------
// Validation + rejection taxonomy
// ---------------------------------------------------------------------------

test("validation: structural request failures are rejected as ValidationError", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  const batch = makeObservationBatch({ seed: "ingestion-batch", tenantId: tenantId as never, deviceId: deviceId as never, count: 1 });

  const noKey = service.ingest(makeRequest(tenantId, deviceId, { batch, idempotencyKey: "" }));
  expect(noKey.ok).toBe(false);
  if (!noKey.ok) expect(noKey.error.kind).toBe("ValidationError");

  const badTime = service.ingest(makeRequest(tenantId, deviceId, { batch, receivedAt: "not-iso" }));
  expect(badTime.ok).toBe(false);
  if (!badTime.ok && badTime.error.kind === "ValidationError") {
    expect(badTime.error.failures.some((f) => f.path === "/receivedAt")).toBe(true);
  }
});

test("validation: malformed batches are rejected with the frozen contracts reasons mapped to failure paths", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  const emptyBatch = {
    tenantId: tenantId as never,
    deviceId: deviceId as never,
    observedAt: "2026-04-02T09:00:00Z",
    observations: [],
  } as never;
  const empty = service.ingest(makeRequest(tenantId, deviceId, { batch: emptyBatch }));
  expect(empty.ok).toBe(false);
  if (!empty.ok && empty.error.kind === "ValidationError") {
    expect(empty.error.failures.some((f) => f.path === "/batch/observations" && f.reason === "empty")).toBe(true);
  }
});

test("validation: oversized batches are rejected (maxBatchSize bound)", () => {
  const { service, tenantId, deviceId } = makeServiceFixture({ maxBatchSize: 2 });
  const big = makeObservationBatch({ seed: "big", tenantId: tenantId as never, deviceId: deviceId as never, count: 3 });
  const result = service.ingest(makeRequest(tenantId, deviceId, { batch: big }));
  expect(result.ok).toBe(false);
  if (!result.ok && result.error.kind === "ValidationError") {
    expect(result.error.failures.some((f) => f.reason === "batch_too_large")).toBe(true);
  }
});

test("tenant isolation: a caller tenant that does not match the batch tenant is rejected (AuthorizationError)", () => {
  const audit = createInMemoryAuditSink();
  const { service, tenantId, deviceId } = makeServiceFixture({ auditSink: audit });
  const batch = makeObservationBatch({ seed: "cross", tenantId: tenantId as never, deviceId: deviceId as never, count: 1 });
  const otherTenant = makeTenantId("other-tenant") as string;
  const result = service.ingest(makeRequest(otherTenant, deviceId, { batch }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("AuthorizationError");
    expect(result.error.code).toBe("device.ingestion.tenant_mismatch");
    if (result.error.kind === "AuthorizationError") {
      expect(result.error.reason).toBe("tenant_mismatch");
    }
  }
  // Nothing was admitted; the rejection is audited.
  const twin = service.store.get(tenantId as never, deviceId as never);
  if (twin) expect(twin.telemetry.observationCount).toBe(0);
  expect(audit.records.some((r) => r.action === AUDIT_ACTIONS.rejected)).toBe(true);
});

test("validation: an unknown device is rejected as a DomainError (device must be enrolled)", () => {
  const { service, tenantId } = makeServiceFixture();
  const unknownDevice = makeDeviceId("never-enrolled");
  const batch = makeObservationBatch({ seed: "unknown", tenantId: tenantId as never, deviceId: unknownDevice, count: 1 });
  const result = service.ingest(makeRequest(tenantId, unknownDevice as string, { batch }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("DomainError");
    expect(result.error.code).toBe("device.unknown");
  }
});

test("constructor: out-of-range options throw at construction (programmer error)", () => {
  expect(() => createObservationIngestionService({ maxQueueDepth: 0 })).toThrow();
  expect(() => createObservationIngestionService({ pressuredRatio: 1.5 })).toThrow();
  expect(() => createObservationIngestionService({ maxBatchSize: 0 })).toThrow();
});

// ---------------------------------------------------------------------------
// Back-pressure
// ---------------------------------------------------------------------------

test("back-pressure: pressure builds, batches are shed at the bound, drain re-opens the boundary", () => {
  const audit = createInMemoryAuditSink();
  const { service, tenantId, deviceId } = makeServiceFixture({ auditSink: audit, maxQueueDepth: 5, pressuredRatio: 0.8 });

  // Queue depth 4/5 -> pressured (>= ceil(5*0.8) = 4).
  const four = makeObservationBatch({ seed: "four", tenantId: tenantId as never, deviceId: deviceId as never, count: 4 });
  const first = service.ingest(makeRequest(tenantId, deviceId, { batch: four, idempotencyKey: "idem_four" }));
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.ack.kind).toBe("admitted");
  expect(service.backPressure().status).toBe("pressured");
  expect(service.backPressure().retryAfterMs).toBe(1000);

  // 4 + 3 > 5 -> shed with a retry hint.
  const three = makeObservationBatch({ seed: "three", tenantId: tenantId as never, deviceId: deviceId as never, count: 3 });
  const shed = service.ingest(makeRequest(tenantId, deviceId, { batch: three, idempotencyKey: "idem_three" }));
  expect(shed.ok).toBe(true);
  if (!shed.ok) return;
  expect(shed.ack.kind).toBe("shed");
  if (shed.ack.kind !== "shed") return;
  expect(shed.ack.backPressure.retryAfterMs).toBe(1000);
  expect(shed.ack.backPressure.maxQueueDepth).toBe(5);
  // The shed batch was NOT admitted; queue depth unchanged.
  expect(service.backPressure().queueDepth).toBe(4);
  expect(audit.records.some((r) => r.action === AUDIT_ACTIONS.shed)).toBe(true);

  // A batch that fits (4 + 1 <= 5) is admitted up to the bound.
  const one = makeObservationBatch({ seed: "one", tenantId: tenantId as never, deviceId: deviceId as never, count: 1 });
  const fits = service.ingest(makeRequest(tenantId, deviceId, { batch: one, idempotencyKey: "idem_one" }));
  expect(fits.ok).toBe(true);
  expect(service.backPressure().queueDepth).toBe(5);
  expect(service.backPressure().status).toBe("shedding");

  // Drain everything -> open again, and the previously shed batch passes.
  expect(service.drain(10)).toBe(0);
  expect(service.backPressure().status).toBe("open");
  expect(service.backPressure().retryAfterMs).toBeNull();
  const retry = service.ingest(makeRequest(tenantId, deviceId, { batch: three, idempotencyKey: "idem_three" }));
  expect(retry.ok).toBe(true);
  if (!retry.ok) return;
  expect(retry.ack.kind).toBe("admitted");
  expect(service.backPressure().queueDepth).toBe(3);
});

test("back-pressure: drain clamps at zero and ignores negative counts", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  const batch = makeObservationBatch({ seed: "drain", tenantId: tenantId as never, deviceId: deviceId as never, count: 2 });
  service.ingest(makeRequest(tenantId, deviceId, { batch }));
  expect(service.drain(-5)).toBe(2);
  expect(service.drain(1)).toBe(1);
  expect(service.drain(99)).toBe(0);
});

// ---------------------------------------------------------------------------
// Unit seam + lifecycle loop closure
// ---------------------------------------------------------------------------

test("admission: the unit seam normalizes admitted payloads before twin storage", () => {
  const { service, tenantId, deviceId } = makeServiceFixture({ unitNormalizer: createStorageBytesNormalizer() });
  const batch: ObservationBatch = {
    tenantId: tenantId as never,
    deviceId: deviceId as never,
    observedAt: "2026-04-02T09:00:00Z",
    observations: [
      { id: makeObservationId("storage-obs"), kind: "device.storage", observedAt: "2026-04-02T09:00:00Z", schemaVersion: 1, payload: { value: 2, unit: "GB" } },
    ],
  };
  const result = service.ingest(makeRequest(tenantId, deviceId, { batch }));
  expect(result.ok).toBe(true);
  const twin = service.store.get(tenantId as never, deviceId as never);
  if (twin) {
    expect(twin.telemetry.latest[0].payload).toEqual({ valueBytes: 2 * 1024 ** 3 });
  }
});

test("admission: a LEARN-state twin re-enters OBSERVE on the next observation cycle (loop closure)", () => {
  const { service, tenantId, deviceId } = makeServiceFixture();
  // Walk the stored twin to LEARN.
  let twin = service.store.get(tenantId as never, deviceId as never);
  if (!twin) throw new Error("twin missing");
  for (const to of ["OBSERVE", "ASSESS", "DIAGNOSE", "PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "LEARN"] as const) {
    // Direct table transitions via the twin API through the store.
    const result = transitionTwinLifecycle(twin, to, {
      at: "2026-04-01T12:00:00Z",
      correlationId: makeCorrelationId("walk"),
    });
    if (!result.ok) throw new Error(`walk failed at ${to}`);
    twin = result.twin;
    service.store.put(twin);
  }
  expect(twin.identity.lifecycleState).toBe("LEARN");

  const batch = makeObservationBatch({ seed: "reentry", tenantId: tenantId as never, deviceId: deviceId as never, count: 1 });
  const result = service.ingest(makeRequest(tenantId, deviceId, { batch }));
  expect(result.ok).toBe(true);
  if (!result.ok || result.ack.kind !== "admitted") return;

  const after = service.store.get(tenantId as never, deviceId as never);
  if (!after) throw new Error("twin missing");
  expect(after.identity.lifecycleState).toBe("OBSERVE");
  // Two revisions appended: observations.recorded + observation-cycle re-entry.
  const mutations = after.revisions.slice(-2).map((r) => r.mutation);
  expect(mutations).toEqual(["observations.recorded", "lifecycle.observation-cycle-reentry"]);
  expect(after.revision).toBe(twin.revision + 2);
});

// ---------------------------------------------------------------------------
// Tenant isolation (REQUIRED)
// ---------------------------------------------------------------------------

test("tenant isolation: a tenant-A query can NEVER observe tenant-B twins (same DeviceId in both tenants)", () => {
  const tenantA = makeTenantId("tenant-a");
  const tenantB = makeTenantId("tenant-b");
  const sharedDeviceId = makeDeviceId("shared-device");
  const store = createInMemoryTwinStore();

  for (const tenant of [tenantA, tenantB]) {
    const enrolled = enrollDevice({
      tenantId: tenant,
      deviceId: sharedDeviceId,
      adapterFamily: "linux",
      hardware: { manufacturer: "Acme", model: "FleetBook" },
      ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
      at: "2026-04-01T08:00:00Z",
      provenance: { correlationId: makeCorrelationId(`enroll-${tenant}`) },
    });
    if (!enrolled.ok) throw new Error("enrollment failed");
    const created = createTwin({
      identity: enrolled.identity,
      ctx: { at: "2026-04-01T08:00:01Z", correlationId: makeCorrelationId(`create-${tenant}`) },
    });
    if (!created.ok) throw new Error("creation failed");
    store.put(created.twin);
  }

  const auditA = createInMemoryAuditSink();
  const service = createObservationIngestionService({ store, auditSink: auditA });

  // Tenant A checks in for the shared device id.
  const batchA = makeObservationBatch({ seed: "tenant-a-batch", tenantId: tenantA, deviceId: sharedDeviceId, count: 2 });
  const admitted = service.ingest({
    tenantId: tenantA,
    batch: batchA,
    idempotencyKey: makeIdempotencyKey("tenant-a-key"),
    correlationId: makeCorrelationId("tenant-a-cor"),
    receivedAt: "2026-04-02T09:00:00Z",
  });
  expect(admitted.ok).toBe(true);

  // get(tenantA, shared) returns A's twin (admitted observations).
  const twinA = store.get(tenantA, sharedDeviceId);
  if (!twinA) throw new Error("twin A missing");
  expect(twinA.tenantId).toBe(tenantA);
  expect(twinA.telemetry.observationCount).toBe(2);

  // get(tenantB, shared) returns B's twin — untouched.
  const twinB = store.get(tenantB, sharedDeviceId);
  if (!twinB) throw new Error("twin B missing");
  expect(twinB.tenantId).toBe(tenantB);
  expect(twinB.telemetry.observationCount).toBe(0);

  // list(tenantA) contains ONLY A's twin even though both exist.
  const listA = store.list(tenantA);
  expect(listA).toHaveLength(1);
  expect(listA[0].tenantId).toBe(tenantA);
  expect(store.list(tenantB)).toHaveLength(1);
  expect(store.list(tenantB)[0].tenantId).toBe(tenantB);

  // Tenant B posting a batch that CLONES A's content is not confused with
  // A's admission: B's own device is a separate twin, and B's check-in for
  // an unknown device id is rejected (never routed to A's twin).
  const batchBClone = makeObservationBatch({ seed: "tenant-a-batch", tenantId: tenantB, deviceId: makeDeviceId("b-unknown"), count: 2 });
  const crossTenant = service.ingest({
    tenantId: tenantB,
    batch: batchBClone,
    idempotencyKey: makeIdempotencyKey("tenant-b-key"),
    correlationId: makeCorrelationId("tenant-b-cor"),
    receivedAt: "2026-04-02T09:01:00Z",
  });
  expect(crossTenant.ok).toBe(false);
  if (!crossTenant.ok) {
    expect(crossTenant.error.code).toBe("device.unknown");
    expect(crossTenant.error.tenantId).toBe(tenantB);
  }

  // A's twin is still exactly as A left it.
  const twinAAfter = store.get(tenantA, sharedDeviceId);
  if (twinAAfter) expect(twinAAfter.telemetry.observationCount).toBe(2);
  // Every audit record carries exactly the tenant scope of ITS OWN flow:
  // A's admission record is tenant A; B's rejection record is tenant B —
  // the sink never receives a record whose tenant scope leaked.
  const admittedRecords = auditA.records.filter((r) => r.action === AUDIT_ACTIONS.admitted);
  expect(admittedRecords).toHaveLength(1);
  for (const record of admittedRecords) {
    expect(record.tenantId).toBe(tenantA);
    expect(record.subject).toBe(sharedDeviceId);
  }
  const rejectedRecords = auditA.records.filter((r) => r.action === AUDIT_ACTIONS.rejected);
  expect(rejectedRecords).toHaveLength(1);
  for (const record of rejectedRecords) {
    expect(record.tenantId).toBe(tenantB);
  }
});

// ---------------------------------------------------------------------------
// Defaults + determinism
// ---------------------------------------------------------------------------

test("defaults: the service works with no injected options (fresh store + no-op audit)", () => {
  const service = createObservationIngestionService();
  expect(service.backPressure().status).toBe("open");
  expect(service.backPressure().maxQueueDepth).toBe(1000);
  const drain = service.drain(0);
  expect(drain).toBe(0);
});

test("determinism: identical service state + identical requests => identical acks (timestamps injected)", () => {
  const a = makeServiceFixture();
  const b = makeServiceFixture();
  const ts = makeTimestamp("determinism-check");
  const requestA = makeRequest(a.tenantId, a.deviceId, { receivedAt: ts });
  const requestB = makeRequest(b.tenantId, b.deviceId, { receivedAt: ts });
  const resultA = a.service.ingest(requestA);
  const resultB = b.service.ingest(requestB);
  expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
});
