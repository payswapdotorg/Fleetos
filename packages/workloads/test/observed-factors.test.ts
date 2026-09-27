/**
 * W022 tests — observed-factor derivation + aggregation (the
 * observations module-map edge).
 *
 * Core invariants under test:
 *   - only `device.workload` observations contribute factors; everything
 *     else is skipped with an enumerable reason (forward compatibility);
 *   - the window is (asOf - windowMs, asOf] — inclusive end;
 *   - out-of-range and malformed fields skip, never error;
 *   - aggregation is a nearest-rank p90 fold (order-independent);
 *   - confidence is the covered-dimension fraction.
 */

import { describe, expect, test } from "bun:test";
import { asObservationId, asTenantId } from "@fleetos/contracts";
import type { Observation } from "@fleetos/contracts";
import {
  OBSERVED_FACTOR_MODEL_VERSION,
  WORKLOAD_OBSERVATION_KIND,
  aggregateObservedFactors,
  deriveObservedFactors,
  nearestRankPercentile,
} from "../src/observed-factors";
import { REQUIREMENT_DIMENSION_COUNT } from "../src/requirement-vector";
import { T0 } from "./helpers";

const AS_OF = "2026-01-02T00:00:00Z";
const WINDOW = { asOf: AS_OF, windowMs: 48 * 3_600_000 };

let counter = 0;
function observation(
  kind: string,
  payload: unknown,
  observedAt: string = AS_OF,
): Observation {
  counter += 1;
  return Object.freeze({
    id: asObservationId(`obs_wl_${String(counter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

/** Derive factors from workload payloads (throws on invalid window). */
function factorsFor(payloads: unknown[]): ReturnType<typeof deriveObservedFactors> {
  return deriveObservedFactors(
    payloads.map((payload) => observation(WORKLOAD_OBSERVATION_KIND, payload)),
    WINDOW,
  );
}

describe("observed factors: derivation", () => {
  test("a full device.workload payload maps every field to its dimension", () => {
    const obs = observation(WORKLOAD_OBSERVATION_KIND, {
      cpuUtilization: 0.7,
      gpuUtilization: 0.2,
      memoryUtilization: 0.6,
      storageUtilization: 0.5,
      networkMbps: 100,
      unpluggedMinutes: 120,
      offsiteFraction: 0.3,
      peripheralCount: 3,
      classification: "internal",
      downtimeCostPerHourUsd: 1000,
    });
    const result = deriveObservedFactors([obs], WINDOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
    expect(result.modelVersion).toBe(OBSERVED_FACTOR_MODEL_VERSION);
    const byDimension = new Map(result.factors.map((f) => [f.dimension, f]));
    expect(byDimension.size).toBe(10);
    const cpu = byDimension.get("cpuDemand");
    expect(cpu?.value).toBe(0.7);
    expect(cpu?.confidence).toBe(1.0);
    expect(cpu?.observationId).toBe(obs.id);
    expect(byDimension.get("memoryDemand")?.value).toBe(0.6);
    expect(byDimension.get("memoryDemand")?.confidence).toBe(1.0);
    expect(byDimension.get("securityDemand")?.value).toBe(0.35);
    expect(byDimension.get("securityDemand")?.confidence).toBe(1.0);
    // networkMbps 100 -> anchor 0.5; confidence 0.9 (anchor-normalized).
    expect(byDimension.get("networkDemand")?.value).toBe(0.5);
    expect(byDimension.get("networkDemand")?.confidence).toBe(0.9);
    // unpluggedMinutes 120 -> anchor 0.55.
    expect(byDimension.get("powerDependence")?.value).toBe(0.55);
    expect(byDimension.get("peripheralDemand")?.value).toBe(0.55);
    expect(byDimension.get("downtimeSensitivity")?.value).toBe(0.55);
  });

  test("unknown kinds are skipped with unknown_kind (forward compatibility)", () => {
    const result = deriveObservedFactors(
      [
        observation("device.health", { battery: 0.5 }),
        observation("device.identity", { serial: "x" }),
      ],
      WINDOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factors).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["unknown_kind", "unknown_kind"]);
  });

  test("observations outside the window are skipped; the end is inclusive", () => {
    const inside = observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.5 }, AS_OF);
    const tooOld = observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.9 }, "2025-12-01T00:00:00Z");
    const future = observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.9 }, "2026-03-01T00:00:00Z");
    const result = deriveObservedFactors([inside, tooOld, future], WINDOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factors.length).toBe(1);
    expect(result.factors[0]?.observationId).toBe(inside.id);
    expect(result.skipped.map((s) => s.reason)).toEqual(["outside_window", "outside_window"]);
  });

  test("malformed payloads and out-of-range fields skip with machine reasons", () => {
    const nullPayload = observation(WORKLOAD_OBSERVATION_KIND, null);
    const noFields = observation(WORKLOAD_OBSERVATION_KIND, { something: "else" });
    const outOfRange = observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 1.5 });
    const badEnum = observation(WORKLOAD_OBSERVATION_KIND, { classification: "top-secret" });
    const result = deriveObservedFactors([nullPayload, noFields, outOfRange, badEnum], WINDOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factors).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "bad_payload",
      "bad_payload",
      "field_out_of_range",
      "field_out_of_range",
    ]);
  });

  test("an invalid window fails with invalid_window (tagged, never throws)", () => {
    expect(deriveObservedFactors([], { asOf: "not-a-time", windowMs: 1000 })).toEqual({
      ok: false,
      reason: "invalid_window",
    });
    expect(deriveObservedFactors([], { asOf: AS_OF, windowMs: 0 })).toEqual({
      ok: false,
      reason: "invalid_window",
    });
    expect(deriveObservedFactors([], { asOf: AS_OF, windowMs: -5 })).toEqual({
      ok: false,
      reason: "invalid_window",
    });
  });

  test("derivation is deterministic and observation-order independent in content", () => {
    const observations = [
      observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.4 }),
      observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.8 }),
      observation(WORKLOAD_OBSERVATION_KIND, { offsiteFraction: 0.6 }),
    ];
    const first = deriveObservedFactors(observations, WINDOW);
    const second = deriveObservedFactors([...observations].reverse(), WINDOW);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Same factors per (dimension, observationId) — order affects array order,
    // never the (id, dimension, value) tuples.
    const key = (f: { dimension: string; observationId: string; value: number }) =>
      `${f.dimension}|${f.observationId}|${f.value}`;
    expect(first.factors.map(key).sort()).toEqual(second.factors.map(key).sort());
    expect(JSON.stringify(deriveObservedFactors(observations, WINDOW))).toBe(
      JSON.stringify(deriveObservedFactors(observations, WINDOW)),
    );
  });
});

describe("observed factors: aggregation", () => {
  test("nearest-rank percentile is an observed sample, never interpolated", () => {
    expect(nearestRankPercentile([], 90)).toBe(0);
    expect(nearestRankPercentile([0.5], 90)).toBe(0.5);
    // n=10, p=90: ceil(0.9*10)=9 -> sorted[8].
    const values = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.95];
    expect(nearestRankPercentile(values, 90)).toBe(0.9);
    // n=2, p=90: ceil(1.8)=2 -> sorted[1] (the max).
    expect(nearestRankPercentile([0.3, 0.7], 90)).toBe(0.7);
  });

  test("aggregation takes the p90 per dimension and computes coverage confidence", () => {
    // 31 cpu samples: eleven at 0.1, ten at 0.5, ten at 0.9 -> p90 = 0.9.
    const payloads: unknown[] = [{ cpuUtilization: 0.1 }];
    for (const value of [0.1, 0.5, 0.9]) {
      for (let i = 0; i < 10; i++) payloads.push({ cpuUtilization: value });
    }
    const result = factorsFor(payloads);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const aggregation = aggregateObservedFactors(result.factors);
    expect(aggregation.vector.values.cpuDemand).toBe(0.9);
    expect(aggregation.vector.confidence).toBe(1 / REQUIREMENT_DIMENSION_COUNT);
    expect(aggregation.sampleCounts.cpuDemand).toBe(31);
    expect(aggregation.sampleCounts.gpuDemand).toBe(0);
    expect(aggregation.vector.values.gpuDemand).toBe(0);
    expect(aggregation.modelVersion).toBe(OBSERVED_FACTOR_MODEL_VERSION);
  });

  test("aggregation is sample-order independent (determinism)", () => {
    const result = factorsFor([{ cpuUtilization: 0.2 }, { cpuUtilization: 0.6 }, { offsiteFraction: 0.4 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = aggregateObservedFactors(result.factors);
    const b = aggregateObservedFactors([...result.factors].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("an empty aggregation yields an all-zero vector with confidence 0", () => {
    const aggregation = aggregateObservedFactors([]);
    expect(aggregation.vector.confidence).toBe(0);
    expect(Object.values(aggregation.vector.values).every((v) => v === 0)).toBe(true);
  });

  test("unknown dimensions in samples are ignored by the aggregator", () => {
    const result = aggregateObservedFactors([
      {
        dimension: "notADimension" as never,
        value: 0.9,
        observationId: "obs_x",
        observedAt: T0,
        confidence: 1,
      },
    ]);
    expect(result.vector.confidence).toBe(0);
    expect(result.vector.values.cpuDemand).toBe(0);
  });
});

describe("observed factors: tenant hygiene", () => {
  test("derived factors carry observation ids usable as profile evidence", () => {
    const obs = observation(WORKLOAD_OBSERVATION_KIND, { cpuUtilization: 0.4 });
    const result = deriveObservedFactors([obs], WINDOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const factor = result.factors[0];
    expect(factor).toBeDefined();
    expect(typeof factor?.observationId).toBe("string");
    expect((factor?.observationId.length ?? 0) > 0).toBe(true);
    // The tenant on the source batch is out of scope here (the frozen
    // Observation shape carries no tenant; the batch does — profiles are
    // tenant-scoped at the store boundary, proven in store tests).
    expect(asTenantId("tnt_testtenant000a")).toBe("tnt_testtenant000a");
  });
});
