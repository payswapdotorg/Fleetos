/**
 * W040 recovery — D1 tests: last-seen evidence ledger + Find My Device.
 *
 * Determinism (byte-identical re-derivation), staleness classification
 * against injected thresholds, append-only versioned records, the
 * derived current view (out-of-order arrivals never regress it), the
 * Find-My-Device view (latest location-bearing evidence with its ref +
 * timestamp; machine-stable `no_location_evidence` — never a guess), and
 * the frozen observation-batch validation surfaced as tagged errors.
 */

import { test, expect } from "bun:test";
import {
  createInMemoryLastSeenLedger,
  recordLastSeenObservations,
  findMyDevice,
  classifyStaleness,
  createInMemoryRecoveryAuditSink,
  validateStalenessThresholds,
} from "../src/index";
import type { LastSeenRecord } from "../src/index";
import {
  T0,
  THRESHOLDS,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  DEV_A2,
  CORR,
  atHour,
  atDay,
  scopeA,
  scopeB,
  obs,
  locationObservation,
  batch,
} from "./helpers";

test("recordLastSeenObservations derives a v1 record with evidence refs + injected timestamp + staleness", () => {
  const ledger = createInMemoryLastSeenLedger();
  const observations = [
    obs("device.health", { battery: 0.5 }, atHour(1)),
    obs("device.identity", { user: "u1" }, atHour(2)),
  ];
  const result = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, observations, atHour(2))], {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const record: LastSeenRecord = result.record;
  expect(record.version).toBe(1);
  expect(record.tenantId).toBe(TENANT_A);
  expect(record.deviceId).toBe(DEV_A1);
  expect(record.observedAt).toBe(atHour(2)); // the max observation instant
  expect(record.recordedAt).toBe(atHour(3)); // injected — no clock reads
  expect(record.staleness).toBe("fresh"); // 1h old, fresh within 1h... at(3h)-obs(2h)=1h <= 1h
  expect(record.evidence).toHaveLength(1); // only the observation at the max instant
  expect(record.recordId).toMatch(/^ls_/);
  expect(record.contentDigest).toMatch(/^[0-9a-f]{8}$/);
});

test("ties at the max instant merge ALL their observation ids, sorted (input order never matters)", () => {
  const ledger = createInMemoryLastSeenLedger();
  const a = obs("device.health", { a: 1 }, atHour(2), "obs_tie_a");
  const b = obs("device.identity", { b: 2 }, atHour(2), "obs_tie_b");
  const c = obs("device.power", { c: 3 }, atHour(1), "obs_tie_c");
  const result = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [c, b, a], atHour(2))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.evidence).toEqual(["obs_tie_a", "obs_tie_b"]); // sorted, c excluded
});

test("staleness classification: stale, unknown band, and future-dated evidence", () => {
  const ledger = createInMemoryLastSeenLedger();
  // Stale: observed 3 days before the injected at.
  const staleResult = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atDay(0))], atDay(0))], {
    at: atDay(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(staleResult.ok && staleResult.record.staleness).toBe("stale");
  // Unknown band: 2h old (fresh 1h, stale 24h).
  const bandResult = recordLastSeenObservations(scopeA(), ledger, DEV_A2, [batch(DEV_A2, [obs("device.health", 1, atHour(0))], atHour(0))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(bandResult.ok && bandResult.record.staleness).toBe("unknown");
  // Future-dated evidence: never a guess.
  expect(classifyStaleness(atHour(0), atHour(1), THRESHOLDS)).toBe("unknown");
});

test("records are append-only + versioned: a second recording appends v2 and never rewrites v1", () => {
  const ledger = createInMemoryLastSeenLedger();
  const first = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  const second = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 2, atHour(5))], atHour(5))], {
    at: atHour(6),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.record.version).toBe(2);
  const revisions = ledger.listLastSeenRevisions(scopeA(), DEV_A1);
  expect(revisions).toHaveLength(2);
  expect(revisions[0]).toBe(first.record); // the prior revision object is untouched
  expect(revisions[0].observedAt).toBe(atHour(1));
});

test("out-of-order arrivals append but the DERIVED current view never regresses", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(10))], atHour(10))], {
    at: atHour(11),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const late = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(3))], atHour(3))], {
    at: atHour(12),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(late.ok).toBe(true);
  const current = ledger.resolveLastSeen(scopeA(), DEV_A1);
  expect(current?.observedAt).toBe(atHour(10)); // still the strongest evidence
  expect(current?.version).toBe(1);
});

test("re-derivation from the same observations is byte-identical (two independent runs)", () => {
  const observations = [
    obs("device.health", { v: 1 }, atHour(1), "obs_determinism_1"),
    obs("device.location", { latitude: 1.5, longitude: 2.5 }, atHour(2), "obs_determinism_2"),
    obs("device.identity", { u: "x" }, atHour(2), "obs_determinism_3"),
  ];
  const runOne = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, observations, atHour(2))], {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const runTwo = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, observations, atHour(2))], {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(runOne.ok && runTwo.ok).toBe(true);
  expect(JSON.stringify(runOne.ok ? runOne.record : null)).toBe(JSON.stringify(runTwo.ok ? runTwo.record : null));
});

test("input permutation: batches + observations in a different order produce identical records", () => {
  const o1 = obs("device.health", { v: 1 }, atHour(1), "obs_perm_1");
  const o2 = obs("device.security", { v: 2 }, atHour(4), "obs_perm_2");
  const o3 = obs("device.power", { v: 3 }, atHour(4), "obs_perm_3");
  const runOne = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, [o1, o2, o3], atHour(4))], {
    at: atHour(5),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const runTwo = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, [o3, o1, o2], atHour(4))], {
    at: atHour(5),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(JSON.stringify(runOne.ok ? runOne.record : null)).toBe(JSON.stringify(runTwo.ok ? runTwo.record : null));
});

test("invalid inputs are refused with tagged ValidationErrors (frozen batch validation surfaced)", () => {
  const ledger = createInMemoryLastSeenLedger();
  // Empty batches array.
  const empty = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [], {
    at: atHour(1),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(empty.ok).toBe(false);
  if (empty.ok) throw new Error("expected failure");
  expect(empty.error.kind).toBe("ValidationError");
  if (empty.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(empty.error.failures.map((f) => f.reason)).toContain("non_empty_array_required");
  // Tenant-mismatched batch.
  const foreign = recordLastSeenObservations(
    scopeA(),
    ledger,
    DEV_A1,
    [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1), TENANT_B)],
    {
      at: atHour(1),
      thresholds: THRESHOLDS,
      correlationId: CORR,
    },
  );
  expect(foreign.ok).toBe(false);
  if (foreign.ok) throw new Error("expected failure");
  expect(foreign.error.kind).toBe("ValidationError");
  if (foreign.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(foreign.error.failures.map((f) => f.reason)).toContain("tenant_mismatch");
  // Device-mismatched batch.
  const wrongDevice = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A2, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(1),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(wrongDevice.ok).toBe(false);
  // Bad thresholds.
  const badThresholds = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(1),
    thresholds: { freshWithinMs: 10, staleAfterMs: 5 },
    correlationId: CORR,
  });
  expect(badThresholds.ok).toBe(false);
  expect(validateStalenessThresholds({ freshWithinMs: 10, staleAfterMs: 5 })?.map((f) => f.reason)).toContain(
    "must_not_precede_freshWithinMs",
  );
});

// ---------------------------------------------------------------------------
// Find My Device
// ---------------------------------------------------------------------------

test("findMyDevice derives the latest location-bearing evidence with its ref + timestamp", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [
    batch(DEV_A1, [locationObservation(atHour(1), 40.1, -3.7, "obs_loc_1"), obs("device.health", 1, atHour(1))], atHour(1)),
  ], { at: atHour(2), thresholds: THRESHOLDS, correlationId: CORR });
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [
    batch(DEV_A1, [locationObservation(atHour(4), 41.2, -4.8, "obs_loc_2")], atHour(4)),
  ], { at: atHour(5), thresholds: THRESHOLDS, correlationId: CORR });
  const view = findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(5), thresholds: THRESHOLDS });
  expect(view.deviceId).toBe(DEV_A1);
  expect(view.tenantId).toBe(TENANT_A);
  expect(view.location.status).toBe("located");
  if (view.location.status !== "located") throw new Error("expected located");
  expect(view.location.observationId).toBe("obs_loc_2"); // the LATEST fix
  expect(view.location.observedAt).toBe(atHour(4));
  expect(view.location.payload).toEqual({ latitude: 41.2, longitude: -4.8, capturedAt: atHour(4), fixSource: "gps" });
  expect(view.location.staleness).toBe("fresh");
  expect(view.location.fromRecordId).toMatch(/^ls_/);
  expect(view.lastSeen?.observedAt).toBe(atHour(4));
});

test("absent location evidence is the machine-stable no_location_evidence state — never a guess", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const view = findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(2), thresholds: THRESHOLDS });
  expect(view.location.status).toBe("no_location_evidence");
  expect(view.lastSeen).toBeDefined(); // evidence exists; only LOCATION evidence is absent
});

test("a device with no evidence at all: no last-seen + no_location_evidence", () => {
  const ledger = createInMemoryLastSeenLedger();
  const view = findMyDevice(scopeA(), ledger, DEV_A2, { at: atHour(2), thresholds: THRESHOLDS });
  expect(view.lastSeen).toBeUndefined();
  expect(view.location.status).toBe("no_location_evidence");
});

test("the view's staleness is re-derived at view time against the view's injected instant", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2), // fresh at recording time
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const early = findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(2), thresholds: THRESHOLDS });
  expect(early.lastSeen?.staleness).toBe("fresh");
  const late = findMyDevice(scopeA(), ledger, DEV_A1, { at: atDay(30), thresholds: THRESHOLDS });
  expect(late.lastSeen?.staleness).toBe("stale"); // same record, re-classified
});

test("an older location-bearing revision is retained across recordings without a new fix", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [locationObservation(atHour(1), 40.1, -3.7, "obs_loc_old")], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  // A later batch with NO location evidence: the view still finds the old fix.
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 2, atHour(9))], atHour(9))], {
    at: atHour(10),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const view = findMyDevice(scopeA(), ledger, DEV_A1, { at: atHour(10), thresholds: THRESHOLDS });
  expect(view.location.status).toBe("located");
  if (view.location.status !== "located") throw new Error("expected located");
  expect(view.location.observationId).toBe("obs_loc_old");
  expect(view.lastSeen?.observedAt).toBe(atHour(9));
});

test("location determinism: same-instant fixes break ties by observation id (never input order)", () => {
  const ledger = createInMemoryLastSeenLedger();
  const a = locationObservation(atHour(2), 1.1, 1.1, "obs_loc_tie_a");
  const b = locationObservation(atHour(2), 2.2, 2.2, "obs_loc_tie_b");
  const runOne = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, [a, b], atHour(2))], {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  const runTwo = recordLastSeenObservations(scopeA(), createInMemoryLastSeenLedger(), DEV_A1, [batch(DEV_A1, [b, a], atHour(2))], {
    at: atHour(3),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(JSON.stringify(runOne.ok ? runOne.record.locationEvidence : null)).toBe(
    JSON.stringify(runTwo.ok ? runTwo.record.locationEvidence : null),
  );
  expect(runOne.ok && runOne.record.locationEvidence?.observationId).toBe("obs_loc_tie_b"); // greater id wins ties
});

// ---------------------------------------------------------------------------
// Audit emission (the consequential evidence recording)
// ---------------------------------------------------------------------------

test("a last-seen recording emits recovery.lastseen.recorded to the injected sink", () => {
  const sink = createInMemoryRecoveryAuditSink();
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe("recovery.lastseen.recorded");
  expect(sink.records[0].subject).toBe(DEV_A1 as string);
  expect(sink.records[0].tenantId).toBe(TENANT_A);
  expect(Array.isArray((sink.records[0].details as Record<string, unknown>)["evidence"])).toBe(true);
});

// ---------------------------------------------------------------------------
// Tenant isolation (see tenant-isolation.test.ts for the exhaustive suite)
// ---------------------------------------------------------------------------

test("a foreign tenant's scope cannot see tenant-A evidence (indistinguishable from unknown)", () => {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(ledger.resolveLastSeen(scopeB(), DEV_A1)).toBeUndefined();
  expect(ledger.listDeviceIds(scopeB())).toEqual([]);
  const view = findMyDevice(scopeB(), ledger, DEV_A1, { at: atHour(2), thresholds: THRESHOLDS });
  expect(view.location.status).toBe("no_location_evidence");
  expect(view.lastSeen).toBeUndefined();
});
