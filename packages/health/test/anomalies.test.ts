/**
 * W021 D3 tests — anomaly detection.
 *
 * Every rule family fires deterministically: threshold rules on the
 * latest in-window sample, deviation rules against device baselines
 * (z-score, minimum sample count, zero-stddev handling), and
 * window-count rules over the trailing window. Evidence correlates to
 * source observations; ids are deterministic.
 */

import { describe, expect, test } from "bun:test";
import {
  ANOMALY_RULES,
  ANOMALY_RULES_VERSION,
  CONSTANT_BASELINE_Z,
  DEFAULT_ANOMALY_THRESHOLDS,
  MIN_BASELINE_SAMPLES,
  detectAnomalies,
} from "../src/anomalies";
import { buildDeviceBaseline } from "../src/baselines";
import { DEVICE_1, DEVICE_2, TENANT_A, TENANT_B, atHour, atMinute, signal } from "./helpers";

const WINDOW = { asOf: atHour(24), windowMs: 24 * 3_600_000 };

describe("D3: rule set integrity", () => {
  test("seven rules across three families, all versioned", () => {
    expect(ANOMALY_RULES).toHaveLength(7);
    const families = new Set(ANOMALY_RULES.map((r) => r.family));
    expect([...families].sort()).toEqual(["deviation", "threshold", "window_count"]);
    expect(ANOMALY_RULES_VERSION).toBe(1);
  });

  test("every rule id is unique and every rule references a real signal kind", () => {
    const ids = ANOMALY_RULES.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of ANOMALY_RULES) {
      expect(rule.signalKind.length > 0).toBe(true);
      expect(rule.statement.length > 0).toBe(true);
    }
  });
});

describe("D3: threshold rules", () => {
  test("battery.low: WARNING at the warning percent, CRITICAL at the critical percent", () => {
    const warning = detectAnomalies([signal("battery.capacity", 20, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    const critical = detectAnomalies([signal("battery.capacity", 10, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    const none = detectAnomalies([signal("battery.capacity", 21, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    expect(warning.ok && warning.anomalies).toHaveLength(1);
    expect(warning.ok && warning.anomalies[0].severity).toBe("WARNING");
    expect(critical.ok && critical.anomalies).toHaveLength(1);
    expect(critical.ok && critical.anomalies[0].severity).toBe("CRITICAL");
    expect(none.ok && none.anomalies).toHaveLength(0); // no battery anomaly
    expect(none.ok && none.skipped.some((s) => s.ruleId === "battery.low" && s.reason === "below_threshold")).toBe(true);
  });

  test("storage.near_full fires on the utilization ratio with severity ladder", () => {
    const warning = detectAnomalies([signal("storage.usage", 0.9, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    const critical = detectAnomalies([signal("storage.usage", 0.95, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    expect(warning.ok && warning.anomalies[0].severity).toBe("WARNING");
    expect(critical.ok && critical.anomalies[0].severity).toBe("CRITICAL");
  });

  test("temperature.high fires on celsius thresholds", () => {
    const warning = detectAnomalies([signal("temperature.core", 75, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    const critical = detectAnomalies([signal("temperature.core", 85, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    expect(warning.ok && warning.anomalies[0].ruleId).toBe("temperature.high");
    expect(warning.ok && warning.anomalies[0].severity).toBe("WARNING");
    expect(critical.ok && critical.anomalies[0].severity).toBe("CRITICAL");
  });

  test("threshold rules fire on the LATEST in-window sample, not stale ones", () => {
    const result = detectAnomalies(
      [
        signal("battery.capacity", 5, atHour(1)), // stale critical
        signal("battery.capacity", 95, atHour(10)), // latest, healthy
      ],
      { tenantId: TENANT_A, ...WINDOW },
    );
    expect(result.ok && result.anomalies).toHaveLength(0);
    expect(
      result.ok && result.skipped.some((s) => s.ruleId === "battery.low" && s.reason === "below_threshold"),
    ).toBe(true);
  });

  test("threshold overrides change the firing boundary (tenant-tunable sensitivity)", () => {
    const result = detectAnomalies([signal("battery.capacity", 30, atHour(10))], {
      tenantId: TENANT_A,
      ...WINDOW,
      thresholds: { ...DEFAULT_ANOMALY_THRESHOLDS, batteryWarningPercent: 35 },
    });
    expect(result.ok && result.anomalies).toHaveLength(1);
    expect(result.ok && result.anomalies[0].severity).toBe("WARNING");
  });
});

describe("D3: deviation rules (z-score vs device baseline)", () => {
  function cpuBaseline(values: readonly number[]): ReturnType<typeof buildDeviceBaseline> {
    return buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: values.map((v, i) => signal("cpu.usage", v, atHour(i + 1))),
    });
  }

  test("z >= 2 fires WARNING; z >= 3 fires CRITICAL; below is skipped", () => {
    // mean 50, stddev 5 (population): 61 -> z=2.2, 66 -> z=3.2, 55 -> z=1.
    const baseline = cpuBaseline([45, 50, 55, 45, 50, 55, 45, 55]);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    // Recompute exact stats to keep the test robust:
    const mean = baseline.baseline.summary.mean;

    const mk = (value: number) =>
      detectAnomalies([signal("cpu.usage", value, atHour(23))], {
        tenantId: TENANT_A,
        ...WINDOW,
        baselines: [baseline.baseline],
      });

    const warning = mk(mean + 2.2 * baseline.baseline.summary.stddev);
    const critical = mk(mean + 3.2 * baseline.baseline.summary.stddev);
    const below = mk(mean + 1.0 * baseline.baseline.summary.stddev);
    expect(warning.ok && warning.anomalies[0].severity).toBe("WARNING");
    expect(critical.ok && critical.anomalies[0].severity).toBe("CRITICAL");
    expect(below.ok && below.anomalies).toHaveLength(0);
    expect(
      below.ok && below.skipped.some((s) => s.ruleId === "cpu.spike" && s.reason === "below_threshold"),
    ).toBe(true);
  });

  test("the anomaly detail carries the z-score and baseline context", () => {
    const baseline = cpuBaseline([45, 50, 55, 45, 50, 55, 45, 55]);
    if (!baseline.ok) throw new Error("baseline failed");
    const result = detectAnomalies(
      [signal("cpu.usage", baseline.baseline.summary.mean + 3 * baseline.baseline.summary.stddev, atHour(23))],
      { tenantId: TENANT_A, ...WINDOW, baselines: [baseline.baseline] },
    );
    expect(result.ok && result.anomalies).toHaveLength(1);
    if (!result.ok) return;
    const anomaly = result.anomalies[0];
    expect(anomaly.ruleId).toBe("cpu.spike");
    expect(anomaly.detail.baselineMean).toBe(baseline.baseline.summary.mean);
    expect(anomaly.detail.baselineStddev).toBe(baseline.baseline.summary.stddev);
    expect(anomaly.detail.baselineSampleCount).toBe(8);
    expect(anomaly.detail.warningZ).toBe(2);
    expect(anomaly.detail.criticalZ).toBe(3);
    expect(anomaly.anomalyRulesVersion).toBe(ANOMALY_RULES_VERSION);
  });

  test("no matching baseline is the enumerable no_baseline skip", () => {
    const result = detectAnomalies([signal("cpu.usage", 99, atHour(23))], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    expect(
      result.ok && result.skipped.some((s) => s.ruleId === "cpu.spike" && s.reason === "no_baseline"),
    ).toBe(true);
  });

  test(`a baseline with fewer than ${MIN_BASELINE_SAMPLES} samples cannot support deviation`, () => {
    const baseline = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: [signal("cpu.usage", 50, atHour(1)), signal("cpu.usage", 52, atHour(2))],
    });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const result = detectAnomalies([signal("cpu.usage", 99, atHour(23))], {
      tenantId: TENANT_A,
      ...WINDOW,
      baselines: [baseline.baseline],
    });
    expect(
      result.ok &&
        result.skipped.some((s) => s.ruleId === "cpu.spike" && s.reason === "insufficient_baseline_samples"),
    ).toBe(true);
  });

  test("a zero-stddev (constant) baseline deviates by the documented constant z", () => {
    const baseline = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "memory.usage",
      window: WINDOW,
      signals: Array.from({ length: 10 }, (_, i) => signal("memory.usage", 60, atHour(i + 1))),
    });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(baseline.baseline.summary.stddev).toBe(0);
    const result = detectAnomalies([signal("memory.usage", 95, atHour(23))], {
      tenantId: TENANT_A,
      ...WINDOW,
      baselines: [baseline.baseline],
    });
    expect(result.ok && result.anomalies).toHaveLength(1);
    if (!result.ok) return;
    expect(result.anomalies[0].detail.zScore).toBe(CONSTANT_BASELINE_Z);
    // And a reading AT the constant does not deviate.
    const steady = detectAnomalies([signal("memory.usage", 60, atHour(23))], {
      tenantId: TENANT_A,
      ...WINDOW,
      baselines: [baseline.baseline],
    });
    expect(steady.ok && steady.anomalies).toHaveLength(0);
  });

  test("a foreign-device baseline is never used for this device's signals", () => {
    const baseline = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_2, // baseline for ANOTHER device
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: Array.from({ length: 8 }, (_, i) =>
        signal("cpu.usage", 50, atHour(i + 1), { deviceId: DEVICE_2 }),
      ),
    });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const result = detectAnomalies([signal("cpu.usage", 99, atHour(23))], {
      tenantId: TENANT_A,
      ...WINDOW,
      baselines: [baseline.baseline],
    });
    // DEVICE_1's cpu.spike has no baseline of its own -> no_baseline skip.
    expect(
      result.ok && result.skipped.some((s) => s.deviceId === DEVICE_1 && s.ruleId === "cpu.spike" && s.reason === "no_baseline"),
    ).toBe(true);
  });
});

describe("D3: window-count rules (crash.burst)", () => {
  test("three crash events in the window fire WARNING; five fire CRITICAL; two do not", () => {
    const crashes = (count: number) =>
      Array.from({ length: count }, (_, i) => signal("crash.event", 1, atHour(i + 1)));
    const warning = detectAnomalies(crashes(3), { tenantId: TENANT_A, ...WINDOW });
    const critical = detectAnomalies(crashes(5), { tenantId: TENANT_A, ...WINDOW });
    const below = detectAnomalies(crashes(2), { tenantId: TENANT_A, ...WINDOW });
    expect(warning.ok && warning.anomalies).toHaveLength(1);
    expect(warning.ok && warning.anomalies[0].severity).toBe("WARNING");
    expect(warning.ok && warning.anomalies[0].detail.windowEventCount).toBe(3);
    expect(critical.ok && critical.anomalies[0].severity).toBe("CRITICAL");
    expect(
      below.ok && below.skipped.some((s) => s.ruleId === "crash.burst" && s.reason === "below_threshold"),
    ).toBe(true);
  });

  test("every window event is evidence; the latest is the subject reading", () => {
    const crashes = [
      signal("crash.event", 1, atHour(1)),
      signal("crash.event", 1, atHour(2)),
      signal("crash.event", 1, atHour(3)),
    ];
    const result = detectAnomalies(crashes, { tenantId: TENANT_A, ...WINDOW });
    expect(result.ok && result.anomalies).toHaveLength(1);
    if (!result.ok) return;
    const anomaly = result.anomalies[0];
    expect(anomaly.evidence).toHaveLength(3);
    expect(anomaly.evidence.filter((e) => e.role === "window_event")).toHaveLength(2);
    expect(anomaly.evidence.filter((e) => e.role === "subject_reading")).toHaveLength(1);
    expect(anomaly.observedAt).toBe(atHour(3));
  });

  test("events outside the trailing window do not count toward the burst", () => {
    const result = detectAnomalies(
      [
        signal("crash.event", 1, atHour(1)), // outside (asOf-24h, asOf] when window is 1h
        signal("crash.event", 1, atMinute(23 * 60 + 30)),
        signal("crash.event", 1, atMinute(23 * 60 + 45)),
      ],
      { tenantId: TENANT_A, asOf: atHour(24), windowMs: 3_600_000 },
    );
    expect(
      result.ok && result.skipped.some((s) => s.ruleId === "crash.burst" && s.reason === "below_threshold"),
    ).toBe(true);
  });
});

describe("D3: evidence correlation + determinism + isolation", () => {
  test("anomaly evidence correlates to the source observation ids", () => {
    const s = signal("battery.capacity", 8, atHour(10), { observationId: "obs_battery_src" as never });
    const result = detectAnomalies([s], { tenantId: TENANT_A, ...WINDOW });
    expect(result.ok && result.anomalies).toHaveLength(1);
    if (!result.ok) return;
    expect(result.anomalies[0].evidence[0].observationId).toBe("obs_battery_src");
    expect(result.anomalies[0].evidence[0].observationKind).toBe("device.power");
    expect(result.anomalies[0].evidence[0].role).toBe("subject_reading");
  });

  test("anomaly ids are deterministic functions of the inputs", () => {
    const s = signal("battery.capacity", 8, atHour(10));
    const run1 = detectAnomalies([s], { tenantId: TENANT_A, ...WINDOW });
    const run2 = detectAnomalies([s], { tenantId: TENANT_A, ...WINDOW });
    expect(run1).toEqual(run2);
    if (!run1.ok || !run2.ok) return;
    expect(run1.anomalies[0].id).toBe(run2.anomalies[0].id);
    expect(run1.anomalies[0].id.startsWith("anom_")).toBe(true);
  });

  test("multi-device runs produce per-device anomalies in deterministic order", () => {
    const result = detectAnomalies(
      [
        signal("battery.capacity", 5, atHour(10), { deviceId: DEVICE_2 }),
        signal("battery.capacity", 5, atHour(10), { deviceId: DEVICE_1 }),
      ],
      { tenantId: TENANT_A, ...WINDOW },
    );
    expect(result.ok && result.anomalies).toHaveLength(2);
    if (!result.ok) return;
    expect(result.anomalies[0].deviceId).toBe(DEVICE_1);
    expect(result.anomalies[1].deviceId).toBe(DEVICE_2);
  });

  test("a foreign-tenant signal rejects the whole detection run", () => {
    const result = detectAnomalies([signal("battery.capacity", 5, atHour(10), { tenantId: TENANT_B })], {
      tenantId: TENANT_A,
      ...WINDOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });

  test("signals outside the window are invisible to every rule", () => {
    const result = detectAnomalies(
      [
        signal("battery.capacity", 1, atHour(1)),
        signal("storage.usage", 1.0, atHour(1)),
        signal("temperature.core", 200, atHour(1)),
      ],
      { tenantId: TENANT_A, asOf: atHour(24), windowMs: 3_600_000 },
    );
    expect(result.ok && result.anomalies).toHaveLength(0);
    expect(result.ok && result.skipped.every((s) => s.reason === "no_signal_in_window")).toBe(true);
  });

  test("validation rejects bad requests with the stable error code", () => {
    const bad = detectAnomalies([], {
      tenantId: TENANT_A,
      asOf: "not-iso",
      windowMs: 1000,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe("health.anomalies.invalid_request");
  });
});
