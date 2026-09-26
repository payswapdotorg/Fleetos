/**
 * W011 D3 tests — the observation normalization pipeline: raw adapter
 * payloads -> canonical contracts observations. Unit seams, duplicate
 * suppression by (deviceId, seq), ordering guarantees, malformed-input
 * rejection with FleetError taxonomy mapping, and determinism.
 */

import { test, expect } from "bun:test";
import { validateObservationBatch } from "@fleetos/contracts";
import type { FleetError } from "@fleetos/contracts";
import { makeTenantId, makeTimestamp } from "@fleetos/contracts/testing";
import {
  IDENTITY_UNIT_NORMALIZER,
  PIPELINE_CORRELATION_ID,
  createInMemorySequenceTracker,
  createNormalizationPipeline,
  createStorageBytesNormalizer,
  normalizeRawObservationBatch,
  rawBatchToCanonicalBatch,
} from "../src/normalize";

const tenantId = makeTenantId("normalize-tests");
const deviceId = "dev_normalize01";

function rawBatch(observations: Array<Record<string, unknown>>, overrides?: Record<string, unknown>) {
  return {
    tenantId: tenantId as string,
    deviceId,
    observedAt: "2026-03-01T10:00:00Z",
    observations,
    ...overrides,
  } as never;
}

function hasFailure(error: FleetError, path: string, reason: string): boolean {
  if (error.kind !== "ValidationError") return false;
  return error.failures.some((f) => f.path === path && f.reason === reason);
}

// ---------------------------------------------------------------------------
// Happy path + canonical shape conformance
// ---------------------------------------------------------------------------

test("normalization: raw observations become canonical contracts Observation values", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 2, kind: "device.health", observedAt: "2026-03-01T09:00:02Z", payload: { temp: 41 } },
      { deviceId, seq: 0, kind: "device.identity", observedAt: "2026-03-01T09:00:00Z", payload: { user: "kai" } },
      { deviceId, seq: 1, kind: "device.power", observedAt: "2026-03-01T09:00:01Z", payload: { pct: 88 } },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries).toHaveLength(3);
  expect(result.duplicates).toHaveLength(0);
  for (const entry of result.entries) {
    const keys = Object.keys(entry.observation).sort();
    expect(keys).toEqual(["id", "kind", "observedAt", "payload", "schemaVersion"]);
  }
  // schemaVersion defaults to 1.
  for (const entry of result.entries) {
    expect(entry.observation.schemaVersion).toBe(1);
  }
});

test("normalization: ordering guarantee — entries sorted by (deviceId, seq) ascending", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 5, kind: "device.health", observedAt: "2026-03-01T09:00:05Z", payload: {} },
      { deviceId, seq: 3, kind: "device.health", observedAt: "2026-03-01T09:00:03Z", payload: {} },
      { deviceId, seq: 4, kind: "device.health", observedAt: "2026-03-01T09:00:04Z", payload: {} },
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: {} },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries.map((e) => e.seq)).toEqual([1, 3, 4, 5]);
});

test("normalization: out-of-order arrival is tolerated; seq is the ordering authority", () => {
  // observedAt is DESCENDING here — the pipeline still orders by seq.
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 2, kind: "device.health", observedAt: "2026-03-01T09:00:00Z", payload: {} },
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:30Z", payload: {} },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries[0].seq).toBe(1);
  expect(result.entries[1].seq).toBe(2);
});

test("normalization: deterministic ids derived from (deviceId, seq) when absent; explicit ids preserved", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 7, kind: "device.health", observedAt: "2026-03-01T09:00:07Z", payload: {} },
      { deviceId, seq: 8, kind: "device.health", observedAt: "2026-03-01T09:00:08Z", payload: {}, id: "obs_explicit_0001" },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries[0].observation.id).toBe(`obs_${deviceId}_7`);
  expect(result.entries[1].observation.id).toBe("obs_explicit_0001");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("normalization: deterministic — same raw batch + same tracker state => byte-identical output", () => {
  const batch = rawBatch([
    { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: { a: 1, b: { c: 2 } } },
    { deviceId, seq: 2, kind: "device.storage", observedAt: "2026-03-01T09:00:02Z", payload: { value: 2, unit: "GB" } },
  ]);
  const first = normalizeRawObservationBatch(batch);
  const second = normalizeRawObservationBatch(batch);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  // And across separately-constructed fresh trackers, with a seam injected.
  const seam = createStorageBytesNormalizer();
  const withSeamA = normalizeRawObservationBatch(batch, { unitNormalizer: seam });
  const withSeamB = normalizeRawObservationBatch(batch, { unitNormalizer: seam });
  expect(JSON.stringify(withSeamA)).toBe(JSON.stringify(withSeamB));
});

// ---------------------------------------------------------------------------
// Duplicate suppression by (deviceId, seq)
// ---------------------------------------------------------------------------

test("dedup: in-batch duplicate (deviceId, seq) is suppressed and reported once", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 2, kind: "device.health", observedAt: "2026-03-01T09:00:02Z", payload: {} },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries.map((e) => e.seq)).toEqual([1, 2]);
  expect(result.duplicates).toHaveLength(1);
  expect(result.duplicates[0].seq).toBe(1);
});

test("dedup: cross-batch suppression via the stateful pipeline (same seq posted twice => admitted once)", () => {
  const pipeline = createNormalizationPipeline();
  const batch = rawBatch([
    { deviceId, seq: 0, kind: "device.health", observedAt: "2026-03-01T09:00:00Z", payload: {} },
    { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: {} },
  ]);
  const first = pipeline.normalize(batch);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.entries).toHaveLength(2);
  expect(first.duplicates).toHaveLength(0);

  const replay = pipeline.normalize(batch);
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.entries).toHaveLength(0);
  expect(replay.duplicates).toHaveLength(2);
  expect(replay.duplicates.map((d) => d.seq)).toEqual([0, 1]);

  // A later batch with the NEXT seqs flows through normally.
  const next = pipeline.normalize(
    rawBatch([{ deviceId, seq: 2, kind: "device.health", observedAt: "2026-03-01T09:00:02Z", payload: {} }]),
  );
  expect(next.ok).toBe(true);
  if (!next.ok) return;
  expect(next.entries).toHaveLength(1);
  expect(next.entries[0].seq).toBe(2);
});

test("dedup: seq is device-scoped — another device with the same seq is NOT a duplicate", () => {
  const tracker = createInMemorySequenceTracker();
  const otherDevice = "dev_otherdev02";
  const makeSingle = (device: string) =>
    ({
      tenantId: tenantId as string,
      deviceId: device,
      observedAt: "2026-03-01T10:00:00Z",
      observations: [
        { deviceId: device, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: { device } },
      ],
    }) as never;
  const first = normalizeRawObservationBatch(makeSingle(deviceId), { sequenceTracker: tracker });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.entries).toHaveLength(1);
  // Same seq, DIFFERENT device — not a duplicate.
  const second = normalizeRawObservationBatch(makeSingle(otherDevice), { sequenceTracker: tracker });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.entries).toHaveLength(1);
  expect(second.duplicates).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Malformed input rejection (FleetError taxonomy mapping)
// ---------------------------------------------------------------------------

test("malformed: batch-level failures map to ValidationError with precise paths", () => {
  const badTenant = normalizeRawObservationBatch(rawBatch([{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }], { tenantId: "tenant_invalid_grammar" }));
  expect(badTenant.ok).toBe(false);
  if (!badTenant.ok) expect(hasFailure(badTenant.error, "/tenantId", "bad_format")).toBe(true);

  const noDevice = normalizeRawObservationBatch(rawBatch([{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }], { deviceId: "" }));
  expect(noDevice.ok).toBe(false);
  if (!noDevice.ok) expect(hasFailure(noDevice.error, "/deviceId", "required")).toBe(true);

  const badTs = normalizeRawObservationBatch(rawBatch([{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }], { observedAt: "yesterday" }));
  expect(badTs.ok).toBe(false);
  if (!badTs.ok) expect(hasFailure(badTs.error, "/observedAt", "not_iso")).toBe(true);

  const empty = normalizeRawObservationBatch(rawBatch([]));
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(hasFailure(empty.error, "/observations", "empty")).toBe(true);
});

test("malformed: observation-level failures map to ValidationError with precise paths", () => {
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [{ seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }, "/observations/0/deviceId", "required"],
    [{ deviceId: "dev_other", seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }, "/observations/0/deviceId", "must_match_batch"],
    [{ deviceId, seq: -1, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }, "/observations/0/seq", "must_be_non_negative_integer"],
    [{ deviceId, seq: 1.5, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }, "/observations/0/seq", "must_be_non_negative_integer"],
    [{ deviceId, seq: 0, observedAt: "2026-03-01T09:00:00Z", payload: {} }, "/observations/0/kind", "required"],
    [{ deviceId, seq: 0, kind: "k", observedAt: "not-iso", payload: {} }, "/observations/0/observedAt", "not_iso"],
    [{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {}, schemaVersion: 0 }, "/observations/0/schemaVersion", "must_be_at_least_one"],
    [{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {}, id: "" }, "/observations/0/id", "must_be_non_empty"],
  ];
  for (const [observation, path, reason] of cases) {
    const result = normalizeRawObservationBatch(rawBatch([observation]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ValidationError");
      expect(result.error.code).toBe("device.observations.malformed");
      expect(hasFailure(result.error, path, reason)).toBe(true);
    }
  }
});

test("malformed: non-JSON payloads (functions, undefined, bigint) are rejected", () => {
  for (const payload of [() => 1, undefined, 10n]) {
    const result = normalizeRawObservationBatch(
      rawBatch([{ deviceId, seq: 0, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(hasFailure(result.error, "/observations/0/payload", "must_be_json_serializable")).toBe(true);
    }
  }
});

test("malformed: ALL failures are collected (not just the first)", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: -1, kind: "", observedAt: "nope", payload: () => 1 },
      { deviceId: "dev_other", seq: 0.5, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {}, schemaVersion: -2 },
    ]),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("ValidationError");
    if (result.error.kind === "ValidationError") {
      expect(result.error.failures.length >= 4).toBe(true);
    }
  }
});

test("malformed: rejection is atomic — the sequence tracker records nothing", () => {
  const tracker = createInMemorySequenceTracker();
  const bad = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "k", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 2, kind: "k", observedAt: "nope", payload: {} },
    ]),
    { sequenceTracker: tracker },
  );
  expect(bad.ok).toBe(false);
  // A corrected retry of the same batch is NOT masked by partial tracking.
  const retry = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "k", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 2, kind: "k", observedAt: "2026-03-01T09:00:02Z", payload: {} },
    ]),
    { sequenceTracker: tracker },
  );
  expect(retry.ok).toBe(true);
  if (!retry.ok) return;
  expect(retry.entries).toHaveLength(2);
});

test("malformed: pipeline errors carry a synthetic correlation id by default", () => {
  const result = normalizeRawObservationBatch(rawBatch([]));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.correlationId).toBe(PIPELINE_CORRELATION_ID);
    expect(result.error.tenantId).toBe(tenantId);
  }
});

// ---------------------------------------------------------------------------
// Unit normalization seams
// ---------------------------------------------------------------------------

test("unit seam: the default identity seam passes payloads through unchanged", () => {
  const payload = { value: 2, unit: "GB" };
  expect(IDENTITY_UNIT_NORMALIZER.normalizePayload("device.storage", payload)).toBe(payload);
});

test("unit seam: the storage-bytes reference seam normalizes { value, unit } to bytes", () => {
  const seam = createStorageBytesNormalizer();
  expect(seam.normalizePayload("device.storage", { value: 2, unit: "GB" })).toEqual({ valueBytes: 2 * 1024 * 1024 * 1024 });
  expect(seam.normalizePayload("disk.storage", { value: 512, unit: "MB" })).toEqual({ valueBytes: 512 * 1024 * 1024 });
  expect(seam.normalizePayload("device.storage", { value: 1, unit: "TB" })).toEqual({ valueBytes: 1024 ** 4 });
  // Non-storage kinds pass through untouched.
  const power = { watts: 65 };
  expect(seam.normalizePayload("device.power", power)).toBe(power);
  // Non-matching payload shapes pass through untouched.
  const odd = { free: 10, total: 100 };
  expect(seam.normalizePayload("device.storage", odd)).toBe(odd);
  expect(seam.normalizePayload("device.storage", { value: 2, unit: "PB" })).toEqual({ value: 2, unit: "PB" });
});

test("unit seam: the seam is applied inside the pipeline", () => {
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 0, kind: "device.storage", observedAt: "2026-03-01T09:00:00Z", payload: { value: 3, unit: "GB" } },
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: { temp: 40 } },
    ]),
    { unitNormalizer: createStorageBytesNormalizer() },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries[0].observation.payload).toEqual({ valueBytes: 3 * 1024 ** 3 });
  expect(result.entries[1].observation.payload).toEqual({ temp: 40 });
});

test("unit seam: a seam producing non-serializable output rejects the batch atomically", () => {
  const brokenSeam = {
    normalizePayload: (_kind: string, _payload: unknown): unknown => () => "not serializable",
  };
  const tracker = createInMemorySequenceTracker();
  const result = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "k", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 2, kind: "k", observedAt: "2026-03-01T09:00:02Z", payload: {} },
    ]),
    { unitNormalizer: brokenSeam, sequenceTracker: tracker },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(hasFailure(result.error, "/observations/0/payload", "must_be_json_serializable")).toBe(true);
  }
  // Tracker untouched: a retry with a fixed seam admits both.
  const retry = normalizeRawObservationBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "k", observedAt: "2026-03-01T09:00:01Z", payload: {} },
      { deviceId, seq: 2, kind: "k", observedAt: "2026-03-01T09:00:02Z", payload: {} },
    ]),
    { sequenceTracker: tracker },
  );
  expect(retry.ok).toBe(true);
  if (!retry.ok) return;
  expect(retry.entries).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Canonical batch conversion
// ---------------------------------------------------------------------------

test("rawBatchToCanonicalBatch: output satisfies the FROZEN contracts batch validator", () => {
  const result = rawBatchToCanonicalBatch(
    rawBatch([
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: { a: 1 } },
      { deviceId, seq: 0, kind: "device.identity", observedAt: "2026-03-01T09:00:00Z", payload: { b: 2 } },
      { deviceId, seq: 1, kind: "device.health", observedAt: "2026-03-01T09:00:01Z", payload: { a: 1 } },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.batch.observations).toHaveLength(2); // the seq-1 duplicate is suppressed
  expect(result.duplicates).toHaveLength(1);
  const validation = validateObservationBatch(result.batch);
  expect(validation.ok).toBe(true);
  expect(result.batch.tenantId).toBe(tenantId);
  expect(result.batch.deviceId).toBe(deviceId);
  expect(result.batch.observedAt).toBe("2026-03-01T10:00:00Z");
});

test("rawBatchToCanonicalBatch: malformed raw input surfaces the pipeline error", () => {
  const result = rawBatchToCanonicalBatch(rawBatch([{ deviceId, seq: -1, kind: "k", observedAt: "2026-03-01T09:00:00Z", payload: {} }]));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("ValidationError");
  }
});

test("normalization: fixture-derived timestamps flow as data (no clock reads anywhere)", () => {
  const ts = makeTimestamp("normalize-determinism");
  const result = normalizeRawObservationBatch(
    rawBatch([{ deviceId, seq: 0, kind: "k", observedAt: ts, payload: {} }]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries[0].observation.observedAt).toBe(ts);
  expect(makeTimestamp("normalize-determinism")).toBe(ts);
});
