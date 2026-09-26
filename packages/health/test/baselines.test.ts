/**
 * W021 D2 tests — baselines.
 *
 * Statistical conventions (nearest-rank percentiles, population stddev),
 * rolling-window selection, per-device + per-model aggregation, scope
 * rejection, and determinism.
 */

import { describe, expect, test } from "bun:test";
import { OWNERSHIP_TYPE_FLEET_PURCHASED, enrollDevice } from "@fleetos/device-model";
import { createTwin } from "@fleetos/device-model";
import {
  BASELINE_MODEL_VERSION,
  buildDeviceBaseline,
  buildModelBaseline,
  buildModelBaselines,
  createTwinModelResolver,
  summarize,
} from "../src/baselines";
import { DEVICE_1, DEVICE_2, TENANT_A, TENANT_B, atHour, signal } from "./helpers";

describe("D2: summarize — statistical conventions", () => {
  test("nearest-rank percentiles over a hand-computed sample", () => {
    // n=8, mean 45, population variance 525.
    const summary = summarize([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(summary.count).toBe(8);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(80);
    expect(summary.mean).toBe(45);
    expect(summary.median).toBe(40); // ceil(0.5*8)=4 -> sorted[3]
    expect(summary.p90).toBe(80); // ceil(0.9*8)=8 -> sorted[7]
    expect(summary.p95).toBe(80); // ceil(0.95*8)=8
    expect(summary.p99).toBe(80); // ceil(0.99*8)=8
    expect(summary.stddev).toBe(Math.sqrt(525));
  });

  test("the nearest-rank median is an OBSERVED sample, never interpolated", () => {
    // n=4: classic interpolated median would be 2.5; nearest-rank p50 = sorted[1] = 2.
    const summary = summarize([1, 2, 3, 4]);
    expect(summary.median).toBe(2);
    expect(summary.p90).toBe(4); // ceil(3.6)=4 -> sorted[3]
  });

  test("summarize is order-independent (deterministic over any permutation)", () => {
    const a = summarize([3, 1, 4, 1, 5, 9, 2, 6]);
    const b = summarize([6, 2, 9, 5, 1, 4, 1, 3]);
    expect(a).toEqual(b);
  });

  test("a constant sample has zero stddev", () => {
    const summary = summarize([7, 7, 7, 7, 7, 7, 7, 7]);
    expect(summary.stddev).toBe(0);
    expect(summary.mean).toBe(7);
    expect(summary.median).toBe(7);
  });
});

describe("D2: buildDeviceBaseline", () => {
  const window = { asOf: atHour(24), windowMs: 24 * 3_600_000 };

  function cpuSignals(): ReturnType<typeof signal>[] {
    // 8 samples spaced hourly, values 40..47 (mean 43.5).
    return Array.from({ length: 8 }, (_, i) => signal("cpu.usage", 40 + i, atHour(i + 1)));
  }

  test("builds the baseline over in-window samples with correct bounds", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: cpuSignals(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.baseline;
    expect(b.tenantId).toBe(TENANT_A);
    expect(b.scope).toEqual({ kind: "device", deviceId: DEVICE_1 });
    expect(b.signalKind).toBe("cpu.usage");
    expect(b.unit).toBe("percent");
    expect(b.sampleCount).toBe(8);
    expect(b.deviceCount).toBe(1);
    expect(b.summary.mean).toBe(43.5);
    expect(b.windowEnd).toBe(atHour(24));
    expect(b.windowStart).toBe(atHour(0));
    expect(b.baselineModelVersion).toBe(BASELINE_MODEL_VERSION);
  });

  test("out-of-window samples are excluded from the summary", () => {
    const inWindow = signal("cpu.usage", 50, atHour(10));
    const before = signal("cpu.usage", 99, atHour(-10));
    const after = signal("cpu.usage", 99, atHour(48));
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: [inWindow, before, after],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseline.sampleCount).toBe(1);
    expect(result.baseline.summary.mean).toBe(50);
  });

  test("signals of other kinds in the input are legal (superset)", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: [
        signal("cpu.usage", 50, atHour(1)),
        signal("memory.usage", 90, atHour(1)),
        signal("battery.capacity", 5, atHour(1)),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseline.sampleCount).toBe(1);
  });

  test("zero in-window samples is the enumerable no_samples_in_window error", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: [signal("cpu.usage", 50, atHour(100))],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("health.baselines.invalid_request");
    expect(result.error.failures[0].reason).toBe("no_samples_in_window");
  });

  test("a foreign-tenant signal is rejected (tenant isolation by rejection)", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: [signal("cpu.usage", 50, atHour(1), { tenantId: TENANT_B })],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });

  test("a foreign-device signal is rejected", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window,
      signals: [signal("cpu.usage", 50, atHour(1), { deviceId: DEVICE_2 })],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("device_mismatch");
  });

  test("an unknown signal kind is rejected", () => {
    const result = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "not.a.kind" as never,
      window,
      signals: [],
    });
    expect(result.ok).toBe(false);
  });

  test("deterministic: same inputs produce the same baseline record", () => {
    const options = {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage" as const,
      window,
      signals: cpuSignals(),
    };
    expect(buildDeviceBaseline(options)).toEqual(buildDeviceBaseline(options));
  });
});

describe("D2: buildModelBaseline + buildModelBaselines", () => {
  const window = { asOf: atHour(24), windowMs: 24 * 3_600_000 };

  test("a model baseline aggregates multiple devices and reports deviceCount", () => {
    const result = buildModelBaseline({
      tenantId: TENANT_A,
      model: "EliteBook 840",
      signalKind: "cpu.usage",
      window,
      signals: [
        signal("cpu.usage", 40, atHour(1), { deviceId: DEVICE_1 }),
        signal("cpu.usage", 60, atHour(2), { deviceId: DEVICE_2 }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = result.baseline;
    expect(b.scope).toEqual({ kind: "model", model: "EliteBook 840" });
    expect(b.sampleCount).toBe(2);
    expect(b.deviceCount).toBe(2);
    expect(b.summary.mean).toBe(50);
  });

  test("buildModelBaselines groups by (model, kind) via the injected resolver", () => {
    const signals = [
      signal("cpu.usage", 40, atHour(1), { deviceId: DEVICE_1 }),
      signal("cpu.usage", 60, atHour(2), { deviceId: DEVICE_2 }),
      signal("memory.usage", 70, atHour(3), { deviceId: DEVICE_1 }),
      signal("battery.capacity", 30, atHour(4), { deviceId: DEVICE_2 }),
    ];
    const result = buildModelBaselines(signals, {
      resolve: (deviceId) => (deviceId === DEVICE_1 ? "ModelA" : "ModelB"),
    }, { tenantId: TENANT_A, window });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sorted by (model, kind): ModelA/cpu.usage, ModelA/memory.usage, ModelB/battery.capacity, ModelB/cpu.usage
    expect(result.baselines.map((b) => `${b.scope.kind === "model" ? b.scope.model : ""}/${b.signalKind}`)).toEqual([
      "ModelA/cpu.usage",
      "ModelA/memory.usage",
      "ModelB/battery.capacity",
      "ModelB/cpu.usage",
    ]);
    expect(result.unresolvedDevices).toEqual([]);
  });

  test("unresolved devices are reported and excluded from model baselines", () => {
    const signals = [
      signal("cpu.usage", 40, atHour(1), { deviceId: DEVICE_1 }),
      signal("cpu.usage", 60, atHour(2), { deviceId: DEVICE_2 }),
    ];
    const result = buildModelBaselines(signals, {
      resolve: (deviceId) => (deviceId === DEVICE_1 ? "ModelA" : undefined),
    }, { tenantId: TENANT_A, window });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baselines).toHaveLength(1);
    expect(result.baselines[0].scope).toEqual({ kind: "model", model: "ModelA" });
    expect(result.unresolvedDevices).toEqual([DEVICE_2]);
  });

  test("cross-tenant signals reject the whole model-baselines run", () => {
    const result = buildModelBaselines(
      [signal("cpu.usage", 40, atHour(1), { tenantId: TENANT_B })],
      { resolve: () => "ModelA" },
      { tenantId: TENANT_A, window },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });

  test("deterministic grouping: permutation of the input does not change the output", () => {
    const signals = [
      signal("cpu.usage", 40, atHour(1), { deviceId: DEVICE_1 }),
      signal("cpu.usage", 60, atHour(2), { deviceId: DEVICE_2 }),
      signal("memory.usage", 70, atHour(3), { deviceId: DEVICE_1 }),
    ];
    const resolver = { resolve: () => "ModelA" };
    const a = buildModelBaselines(signals, resolver, { tenantId: TENANT_A, window });
    const b = buildModelBaselines([...signals].reverse(), resolver, { tenantId: TENANT_A, window });
    expect(a).toEqual(b);
  });
});

describe("D2: createTwinModelResolver — device-model integration", () => {
  test("the resolver derives hardware models from Device Twins", () => {
    const enrolled1 = enrollDevice({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      adapterFamily: "windows",
      hardware: { manufacturer: "HP", model: "EliteBook 840" },
      ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
      at: atHour(0),
      provenance: { correlationId: "cor_resolver" as never },
    });
    const enrolled2 = enrollDevice({
      tenantId: TENANT_A,
      deviceId: DEVICE_2,
      adapterFamily: "macos",
      hardware: { manufacturer: "Apple", model: "Mac mini" },
      ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
      at: atHour(0),
      provenance: { correlationId: "cor_resolver" as never },
    });
    if (!enrolled1.ok || !enrolled2.ok) throw new Error("enroll failed");
    const twin1 = createTwin({
      identity: enrolled1.identity,
      ctx: { at: atHour(0), correlationId: "cor_resolver" as never },
    });
    const twin2 = createTwin({
      identity: enrolled2.identity,
      ctx: { at: atHour(0), correlationId: "cor_resolver" as never },
    });
    if (!twin1.ok || !twin2.ok) throw new Error("create failed");

    const resolver = createTwinModelResolver([twin1.twin, twin2.twin]);
    expect(resolver.resolve(DEVICE_1)).toBe("EliteBook 840");
    expect(resolver.resolve(DEVICE_2)).toBe("Mac mini");
    expect(resolver.resolve("dev_unknown" as never)).toBeUndefined();
  });
});
