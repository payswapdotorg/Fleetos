/**
 * W021 D1 tests — the signal model.
 *
 * Deterministic derivation, payload tolerance (skips, never errors),
 * window filtering, validation atomicity, and the Device Twin adapter.
 */

import { describe, expect, test } from "bun:test";
import { OWNERSHIP_TYPE_FLEET_PURCHASED, enrollDevice } from "@fleetos/device-model";
import { createTwin, recordTwinObservations } from "@fleetos/device-model";
import {
  ALL_SIGNAL_KINDS,
  SIGNAL_KIND_SPECIFICATIONS,
  SIGNAL_MODEL_VERSION,
  deriveSignals,
  deriveSignalsFromTwin,
  windowBoundaries,
} from "../src/signals";
import { DEVICE_1, TENANT_A, TENANT_B, atHour, atMinute, obs, signal } from "./helpers";

describe("D1: signal model constants", () => {
  test("the signal kind table covers every kind with a unit and a source observation kind", () => {
    expect(ALL_SIGNAL_KINDS).toHaveLength(7);
    for (const kind of ALL_SIGNAL_KINDS) {
      const spec = SIGNAL_KIND_SPECIFICATIONS[kind];
      expect(spec.kind).toBe(kind);
      expect(spec.sourceObservationKind.length > 0).toBe(true);
      expect(["percent", "ratio", "celsius", "milliseconds", "count"]).toContain(spec.unit);
      expect(spec.directConfidence > 0).toBe(true);
      expect(spec.directConfidence <= 1).toBe(true);
    }
  });

  test("the model is versioned", () => {
    expect(SIGNAL_MODEL_VERSION).toBe(1);
  });
});

describe("D1: deriveSignals — extractors", () => {
  test("battery.capacity derives from device.power with direct confidence", () => {
    const result = deriveSignals([obs("device.power", { batteryPercent: 42 }, atHour(1))], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(1);
    const s = result.signals[0];
    expect(s.kind).toBe("battery.capacity");
    expect(s.unit).toBe("percent");
    expect(s.value).toBe(42);
    expect(s.confidence).toBe(1.0);
    expect(s.tenantId).toBe(TENANT_A);
    expect(s.deviceId).toBe(DEVICE_1);
    expect(s.signalModelVersion).toBe(SIGNAL_MODEL_VERSION);
    expect(s.observedAt).toBe(atHour(1));
  });

  test("storage.usage computes a ratio with reduced confidence and byte detail", () => {
    const result = deriveSignals(
      [obs("device.storage", { usedBytes: 750, totalBytes: 1000 }, atHour(1))],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(1);
    const s = result.signals[0];
    expect(s.kind).toBe("storage.usage");
    expect(s.unit).toBe("ratio");
    expect(s.value).toBe(0.75);
    expect(s.confidence).toBe(0.9); // computed reading — reduced confidence
    expect(s.detail).toEqual({ usedBytes: 750, totalBytes: 1000 });
  });

  test("one device.health observation yields multiple signals in canonical kind order", () => {
    const observation = obs(
      "device.health",
      { cpuUtilization: 88, memoryUtilization: 71, temperatureC: 64, bootDurationMs: 21_000 },
      atHour(2),
    );
    const result = deriveSignals([observation], { tenantId: TENANT_A, deviceId: DEVICE_1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals.map((s) => s.kind)).toEqual([
      "memory.usage",
      "cpu.usage",
      "temperature.core",
      "boot.time",
    ]);
    expect(result.signals.map((s) => s.value)).toEqual([71, 88, 64, 21_000]);
    expect(result.signals.every((s) => s.sourceObservationId === observation.id)).toBe(true);
  });

  test("crash.event derives with value 1 and the crash type in detail", () => {
    const result = deriveSignals([obs("device.health", { type: "kernel_panic" }, atHour(1))], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].kind).toBe("crash.event");
    expect(result.signals[0].value).toBe(1);
    expect(result.signals[0].detail).toEqual({ crashType: "kernel_panic" });
  });

  test("unknown observation kinds are skipped, never errors (forward compatibility)", () => {
    const result = deriveSignals(
      [
        obs("device.location", { lat: 1, lng: 2 }, atHour(1)),
        obs("windows.process.list", [{ pid: 1 }], atHour(1)),
      ],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["kind_unmapped", "kind_unmapped"]);
  });

  test("payload shape misses are enumerable skips", () => {
    const result = deriveSignals(
      [
        obs("device.power", { charge: "high" }, atHour(1)), // wrong field
        obs("device.storage", { valueBytes: 5 }, atHour(1)), // missing totalBytes
        obs("device.health", { nothing: true }, atHour(1)), // no recognized field
        obs("device.health", "a string", atHour(1)), // not an object
        obs("device.health", [1, 2], atHour(1)), // array payload
      ],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "payload_shape_unexpected",
      "payload_shape_unexpected",
      "payload_shape_unexpected",
      "payload_shape_unexpected",
      "payload_shape_unexpected",
    ]);
  });

  test("out-of-range values are skipped, never coerced", () => {
    const result = deriveSignals(
      [
        obs("device.power", { batteryPercent: 150 }, atHour(1)),
        obs("device.health", { cpuUtilization: -5 }, atHour(1)),
        obs("device.storage", { usedBytes: 20, totalBytes: 10 }, atHour(1)),
        obs("device.health", { bootDurationMs: -1 }, atHour(1)),
      ],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(0);
    expect(result.skipped.every((s) => s.reason === "payload_out_of_range")).toBe(true);
  });

  test("valid and invalid fields in one device.health payload are handled independently", () => {
    const result = deriveSignals(
      [obs("device.health", { cpuUtilization: 50, memoryUtilization: "high" }, atHour(1))],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals.map((s) => s.kind)).toEqual(["cpu.usage"]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["payload_shape_unexpected"]);
  });
});

describe("D1: deriveSignals — window filtering", () => {
  const observations = [
    obs("device.power", { batteryPercent: 10 }, atHour(1)),
    obs("device.power", { batteryPercent: 20 }, atHour(5)),
    obs("device.power", { batteryPercent: 30 }, atHour(10)),
  ];

  test("only observations in (asOf - windowMs, asOf] derive signals", () => {
    const result = deriveSignals(observations, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      window: { asOf: atHour(6), windowMs: 5 * 3_600_000 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals.map((s) => s.value)).toEqual([20]); // hour 5 in (1, 6]
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "observed_at_outside_window",
      "observed_at_outside_window",
    ]);
  });

  test("the window end is inclusive (asOf itself is in-window)", () => {
    const result = deriveSignals(
      [obs("device.power", { batteryPercent: 99 }, atHour(6))],
      { tenantId: TENANT_A, deviceId: DEVICE_1, window: { asOf: atHour(6), windowMs: 3_600_000 } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(1);
  });

  test("unparseable observedAt is skipped when a window is in effect", () => {
    // ISO-looking (passes the lax contracts check) but unparseable (25:61).
    const result = deriveSignals(
      [obs("device.power", { batteryPercent: 50 }, "2026-01-01T25:61Z")],
      { tenantId: TENANT_A, deviceId: DEVICE_1, window: { asOf: atHour(6), windowMs: 3_600_000 } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["observed_at_not_parseable"]);
  });

  test("windowBoundaries reports the ISO bounds of a rolling window", () => {
    const bounds = windowBoundaries({ asOf: atHour(10), windowMs: 5 * 3_600_000 });
    expect(bounds.windowEnd).toBe(atHour(10));
    expect(bounds.windowStart).toBe(atHour(5));
  });
});

describe("D1: deriveSignals — validation", () => {
  test("malformed observations reject the WHOLE run atomically (nothing derived)", () => {
    const result = deriveSignals(
      [
        obs("device.power", { batteryPercent: 50 }, atHour(1)),
        { id: "" as never, kind: "device.power", observedAt: atHour(1), schemaVersion: 1, payload: {} },
      ],
      { tenantId: TENANT_A, deviceId: DEVICE_1 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
    expect(result.error.code).toBe("health.signals.invalid_request");
    expect(result.error.failures.length > 0).toBe(true);
  });

  test("missing tenant/device scope is rejected", () => {
    const result = deriveSignals([obs("device.power", { batteryPercent: 50 }, atHour(1))], {
      tenantId: "" as never,
      deviceId: DEVICE_1,
    });
    expect(result.ok).toBe(false);
  });

  test("an unparseable window asOf is rejected (deterministic fail-closed)", () => {
    const result = deriveSignals([obs("device.power", { batteryPercent: 50 }, atHour(1))], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      window: { asOf: "2026-01-01T00:00Z", windowMs: -5 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("D1: deriveSignals — determinism and ordering", () => {
  test("output order is a deterministic total order regardless of input order", () => {
    const battery = obs("device.power", { batteryPercent: 10 }, atHour(3), "obs_aaa");
    const health = obs(
      "device.health",
      { cpuUtilization: 40, memoryUtilization: 60 },
      atHour(1),
      "obs_health",
    );

    const forward = deriveSignals([battery, health], { tenantId: TENANT_A, deviceId: DEVICE_1 });
    const reversed = deriveSignals([health, battery], { tenantId: TENANT_A, deviceId: DEVICE_1 });
    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(forward.signals).toEqual(reversed.signals);
    // (observedAt, sourceObservationId, kind order): the h1 device.health
    // observation's two signals come first, memory.usage before cpu.usage
    // (canonical kind order), then the h3 battery signal.
    expect(forward.signals.map((s) => s.kind)).toEqual([
      "memory.usage",
      "cpu.usage",
      "battery.capacity",
    ]);
    expect(forward.signals.map((s) => s.sourceObservationId)).toEqual([
      "obs_health",
      "obs_health",
      "obs_aaa",
    ]);
  });

  test("the same observations produce byte-identical signals across runs", () => {
    const observations = [
      obs("device.power", { batteryPercent: 33 }, atHour(2)),
      obs("device.storage", { usedBytes: 1, totalBytes: 4 }, atHour(3)),
      obs("device.health", { cpuUtilization: 12, memoryUtilization: 34 }, atHour(4)),
    ];
    const run1 = deriveSignals(observations, { tenantId: TENANT_A, deviceId: DEVICE_1 });
    const run2 = deriveSignals(observations, { tenantId: TENANT_A, deviceId: DEVICE_1 });
    expect(run1).toEqual(run2);
  });
});

describe("D1: deriveSignalsFromTwin — Device Twin adapter", () => {
  test("signals derive from the twin's bounded telemetry window with the twin's scope", () => {
    const enrolled = enrollDevice({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      adapterFamily: "windows",
      hardware: { manufacturer: "HP", model: "EliteBook 840" },
      ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
      at: atHour(0),
      provenance: { correlationId: "cor_twin_test" as never },
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const created = createTwin({
      identity: enrolled.identity,
      ctx: { at: atHour(0), correlationId: "cor_twin_test" as never },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const recorded = recordTwinObservations(
      created.twin,
      [
        obs("device.power", { batteryPercent: 77 }, atHour(1)),
        obs("device.health", { cpuUtilization: 25 }, atHour(2)),
      ],
      { at: atHour(2), correlationId: "cor_twin_test" as never },
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const result = deriveSignalsFromTwin(recorded.twin);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signals.map((s) => s.kind)).toEqual(["battery.capacity", "cpu.usage"]);
    expect(result.signals.every((s) => s.tenantId === TENANT_A)).toBe(true);
    expect(result.signals.every((s) => s.deviceId === DEVICE_1)).toBe(true);
  });

  test("the twin adapter threads the rolling window through", () => {
    const enrolled = enrollDevice({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      adapterFamily: "macos",
      hardware: { manufacturer: "Apple", model: "Mac mini" },
      ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
      at: atHour(0),
      provenance: { correlationId: "cor_twin_test" as never },
    });
    if (!enrolled.ok) throw new Error("enroll failed");
    const created = createTwin({
      identity: enrolled.identity,
      ctx: { at: atHour(0), correlationId: "cor_twin_test" as never },
    });
    if (!created.ok) throw new Error("create failed");
    const recorded = recordTwinObservations(
      created.twin,
      [obs("device.power", { batteryPercent: 55 }, atHour(1))],
      { at: atHour(1), correlationId: "cor_twin_test" as never },
    );
    if (!recorded.ok) throw new Error("record failed");

    const inWindow = deriveSignalsFromTwin(recorded.twin, {
      asOf: atHour(2),
      windowMs: 5 * 3_600_000,
    });
    const outOfWindow = deriveSignalsFromTwin(recorded.twin, {
      asOf: atHour(9),
      windowMs: 3_600_000,
    });
    expect(inWindow.ok && inWindow.signals.length).toBe(1);
    expect(outOfWindow.ok && outOfWindow.signals.length).toBe(0);
  });
});

describe("D1: tenant scoping by construction", () => {
  test("signals are stamped with the request scope, isolating identical observations per tenant", () => {
    const observation = obs("device.power", { batteryPercent: 66 }, atMinute(30));
    const a = deriveSignals([observation], { tenantId: TENANT_A, deviceId: DEVICE_1 });
    const b = deriveSignals([observation], { tenantId: TENANT_B, deviceId: DEVICE_1 });
    expect(a.ok && a.signals[0].tenantId).toBe(TENANT_A);
    expect(b.ok && b.signals[0].tenantId).toBe(TENANT_B);
  });
});
