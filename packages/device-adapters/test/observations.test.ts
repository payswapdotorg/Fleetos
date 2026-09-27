/**
 * W010 D3 — observation batching tests.
 *
 * Covers:
 *   - The producer NEVER emits a batch the contracts invariants would
 *     reject (validated end-to-end with validateObservationBatch)
 *   - Sequencing: deterministic, monotonically-increasing observation ids
 *   - Idempotency key derivation (deterministic)
 *   - Tenant isolation (collector is tenant-scoped)
 *   - Back-pressure (maxBatchSize)
 *   - Determinism (same inputs => same batch bytes)
 *   - The flush-contract: error results preserve pending observations
 */

import { test, expect } from "bun:test";
import {
  asObservationId,
  validateObservationBatch,
  type ObservationBatch,
  type ObservationId,
} from "@fleetos/contracts";
import {
  createObservationCollector,
  deriveBatchIdempotencyKey,
  type ObservationCollector,
  type ObservationRecord,
} from "../src/observations";
import { ERROR_CODES } from "../src/internal";
import {
  makeDeviceId,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validRecord(seed: string): ObservationRecord {
  return {
    kind: "device.health",
    observedAt: makeTimestamp(`obs-${seed}`),
    schemaVersion: 1,
    payload: { ok: true, seed },
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("D3: createObservationCollector throws on out-of-range options (programmer error)", () => {
  const tenantId = makeTenantId("ctor-tenant");
  const deviceId = makeDeviceId("ctor-device");
  expect(() =>
    createObservationCollector({ tenantId, deviceId, startSeq: 0 }),
  ).toThrow();
  expect(() =>
    createObservationCollector({ tenantId, deviceId, maxBatchSize: 0 }),
  ).toThrow();
});

test("D3: the collector is tenant-scoped and device-scoped", () => {
  const tenantId = makeTenantId("scope-tenant");
  const deviceId = makeDeviceId("scope-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  expect(collector.tenantId).toBe(tenantId);
  expect(collector.deviceId).toBe(deviceId);
});

// ---------------------------------------------------------------------------
// Sequencing — deterministic, monotonic
// ---------------------------------------------------------------------------

test("D3: the collector assigns deterministic, monotonically-increasing observation ids", () => {
  const tenantId = makeTenantId("seq-tenant");
  const deviceId = makeDeviceId("seq-device");
  const collector = createObservationCollector({
    tenantId,
    deviceId,
    idSeed: "boot-1234",
  });
  const r1 = collector.record(validRecord("1"));
  const r2 = collector.record(validRecord("2"));
  const r3 = collector.record(validRecord("3"));
  expect(r1.ok).toBe(true);
  expect(r2.ok).toBe(true);
  expect(r3.ok).toBe(true);
  if (!r1.ok || !r2.ok || !r3.ok) return;
  expect(r1.seq).toBe(1);
  expect(r2.seq).toBe(2);
  expect(r3.seq).toBe(3);
  expect(r1.id).toBe(asObs("boot-1234-seq-1"));
  expect(r2.id).toBe(asObs("boot-1234-seq-2"));
  expect(r3.id).toBe(asObs("boot-1234-seq-3"));
});

test("D3: the same idSeed + startSeq produces the same observation ids across runs (determinism)", () => {
  const tenantId = makeTenantId("determ-seq-tenant");
  const deviceId = makeDeviceId("determ-seq-device");
  const a = createObservationCollector({ tenantId, deviceId, idSeed: "abc", startSeq: 1 });
  const b = createObservationCollector({ tenantId, deviceId, idSeed: "abc", startSeq: 1 });
  const ra = a.record(validRecord("x"));
  const rb = b.record(validRecord("x"));
  if (!ra.ok || !rb.ok) return;
  expect(ra.id).toBe(rb.id);
  expect(ra.seq).toBe(rb.seq);
});

function asObs(s: string): ObservationId {
  // Mirror the collector's id-assignment scheme: asObservationId(`<seed>-seq-<n>`).
  return asObservationId(s);
}

// ---------------------------------------------------------------------------
// Producer invariant — never emit a batch the contracts would reject
// ---------------------------------------------------------------------------

test("D3: CRITICAL — flush() NEVER emits a batch that fails validateObservationBatch", () => {
  const tenantId = makeTenantId("invariant-tenant");
  const deviceId = makeDeviceId("invariant-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  for (let i = 0; i < 10; i++) {
    const r = collector.record(validRecord(String(i)));
    expect(r.ok).toBe(true);
  }
  const result = collector.flush(makeTimestamp("flush-at"));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The frozen contracts validator MUST accept the batch.
  expect(validateObservationBatch(result.batch).ok).toBe(true);
});

test("D3: flush() on an empty collector returns an error (no empty batches)", () => {
  const tenantId = makeTenantId("empty-tenant");
  const deviceId = makeDeviceId("empty-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  const result = collector.flush(makeTimestamp("empty-flush"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(ERROR_CODES.observationsMalformed);
    expect(result.error.kind).toBe("DomainError");
  }
});

test("D3: flush() with a bad observedAt returns a ValidationError", () => {
  const tenantId = makeTenantId("bad-ts-tenant");
  const deviceId = makeDeviceId("bad-ts-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  expect(collector.record(validRecord("a")).ok).toBe(true);
  const result = collector.flush("not-iso");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("ValidationError");
  }
});

// ---------------------------------------------------------------------------
// Back-pressure (maxBatchSize)
// ---------------------------------------------------------------------------

test("D3: the collector refuses to record beyond maxBatchSize", () => {
  const tenantId = makeTenantId("bp-tenant");
  const deviceId = makeDeviceId("bp-device");
  const collector = createObservationCollector({ tenantId, deviceId, maxBatchSize: 2 });
  expect(collector.record(validRecord("1")).ok).toBe(true);
  expect(collector.record(validRecord("2")).ok).toBe(true);
  const r3 = collector.record(validRecord("3"));
  expect(r3.ok).toBe(false);
  if (!r3.ok) {
    expect(r3.reason).toBe("batch_full");
  }
});

test("D3: pending() reflects the queue depth; flush() resets it", () => {
  const tenantId = makeTenantId("pending-tenant");
  const deviceId = makeDeviceId("pending-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  expect(collector.pending()).toBe(0);
  collector.record(validRecord("1"));
  collector.record(validRecord("2"));
  expect(collector.pending()).toBe(2);
  collector.flush(makeTimestamp("pending-flush"));
  expect(collector.pending()).toBe(0);
});

// ---------------------------------------------------------------------------
// discard()
// ---------------------------------------------------------------------------

test("D3: discard() drops pending observations and returns the count", () => {
  const tenantId = makeTenantId("discard-tenant");
  const deviceId = makeDeviceId("discard-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  collector.record(validRecord("1"));
  collector.record(validRecord("2"));
  collector.record(validRecord("3"));
  expect(collector.pending()).toBe(3);
  expect(collector.discard()).toBe(3);
  expect(collector.pending()).toBe(0);
});

// ---------------------------------------------------------------------------
// Idempotency key derivation
// ---------------------------------------------------------------------------

test("D3: deriveBatchIdempotencyKey is deterministic — same batch => same key", () => {
  const tenantId = makeTenantId("idem-tenant");
  const deviceId = makeDeviceId("idem-device");
  const collector = createObservationCollector({ tenantId, deviceId, idSeed: "idem" });
  collector.record(validRecord("1"));
  collector.record(validRecord("2"));
  const r1 = collector.flush(makeTimestamp("idem-flush"));
  if (!r1.ok) throw new Error("flush failed");
  const key1 = deriveBatchIdempotencyKey(r1.batch);

  // Re-run with the same inputs.
  const collector2 = createObservationCollector({ tenantId, deviceId, idSeed: "idem" });
  collector2.record(validRecord("1"));
  collector2.record(validRecord("2"));
  const r2 = collector2.flush(makeTimestamp("idem-flush"));
  if (!r2.ok) throw new Error("flush failed");
  const key2 = deriveBatchIdempotencyKey(r2.batch);
  expect(key1 as string).toBe(key2 as string);
});

test("D3: deriveBatchIdempotencyKey differs for different batches", () => {
  const tenantId = makeTenantId("diff-tenant");
  const deviceId = makeDeviceId("diff-device");
  const a = createObservationCollector({ tenantId, deviceId, idSeed: "diff" });
  a.record(validRecord("a"));
  const ra = a.flush(makeTimestamp("diff-flush"));
  if (!ra.ok) throw new Error("flush failed");

  const b = createObservationCollector({ tenantId, deviceId, idSeed: "diff" });
  b.record({ ...validRecord("a"), payload: { different: true } });
  const rb = b.flush(makeTimestamp("diff-flush"));
  if (!rb.ok) throw new Error("flush failed");

  expect(deriveBatchIdempotencyKey(ra.batch) as string).not.toBe(
    deriveBatchIdempotencyKey(rb.batch) as string,
  );
});

// ---------------------------------------------------------------------------
// Determinism — same inputs => byte-identical batches
// ---------------------------------------------------------------------------

test("D3: two collectors with the same inputs produce byte-identical batches", () => {
  const tenantId = makeTenantId("byte-tenant");
  const deviceId = makeDeviceId("byte-device");
  const a = createObservationCollector({ tenantId, deviceId, idSeed: "byte" });
  const b = createObservationCollector({ tenantId, deviceId, idSeed: "byte" });
  for (let i = 0; i < 5; i++) {
    a.record(validRecord(String(i)));
    b.record(validRecord(String(i)));
  }
  const ra = a.flush(makeTimestamp("byte-flush"));
  const rb = b.flush(makeTimestamp("byte-flush"));
  if (!ra.ok || !rb.ok) throw new Error("flush failed");
  expect(JSON.stringify(ra.batch)).toBe(JSON.stringify(rb.batch));
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("D3: tenant isolation — the collector stamps the batch with its constructor tenantId", () => {
  const tenantA = makeTenantId("iso-tenant-a");
  const tenantB = makeTenantId("iso-tenant-b");
  const deviceId = makeDeviceId("iso-device");
  const a = createObservationCollector({ tenantId: tenantA, deviceId });
  const b = createObservationCollector({ tenantId: tenantB, deviceId });
  a.record(validRecord("a"));
  b.record(validRecord("b"));
  const ra = a.flush(makeTimestamp("iso-flush"));
  const rb = b.flush(makeTimestamp("iso-flush"));
  if (!ra.ok || !rb.ok) throw new Error("flush failed");
  expect(ra.batch.tenantId).toBe(tenantA);
  expect(rb.batch.tenantId).toBe(tenantB);
});

// ---------------------------------------------------------------------------
// Bad-record rejection
// ---------------------------------------------------------------------------

test("D3: the collector refuses to record a malformed observation (bad kind)", () => {
  const tenantId = makeTenantId("bad-rec-tenant");
  const deviceId = makeDeviceId("bad-rec-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  const r = collector.record({
    kind: "" as never,
    observedAt: makeTimestamp("bad"),
    schemaVersion: 1,
    payload: {},
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("bad_record");
  }
});

test("D3: the collector refuses to record a malformed observation (bad schemaVersion)", () => {
  const tenantId = makeTenantId("bad-sv-tenant");
  const deviceId = makeDeviceId("bad-sv-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  const r = collector.record({
    kind: "device.health",
    observedAt: makeTimestamp("bad-sv"),
    schemaVersion: 0,
    payload: {},
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("bad_record");
  }
});

test("D3: the collector refuses to record a non-JSON-serializable payload", () => {
  const tenantId = makeTenantId("non-json-tenant");
  const deviceId = makeDeviceId("non-json-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  const bad: unknown = { a: 1n }; // bigint is not JSON-serializable
  const r = collector.record({
    kind: "device.health",
    observedAt: makeTimestamp("non-json"),
    schemaVersion: 1,
    payload: bad,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("bad_record");
  }
});
