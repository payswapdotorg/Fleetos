/**
 * W021 invariant tests — the cross-cutting guarantees of the health
 * engine, asserted end-to-end:
 *
 *   1. Determinism: the same observation stream => the same signals,
 *      baselines, anomalies, hypotheses, and recommendations — byte for
 *      byte, across runs AND across input permutations.
 *   2. Tenant isolation: tenant A's data can never flow into tenant B's
 *      interpretations (rejection, not filtering).
 *   3. Versioned interpretation: a new version NEVER mutates an old
 *      record — records are frozen, ledgers are append-only, supersession
 *      is recorded on the NEW record.
 *   4. Proposal-only boundary: no treatment recommendation ever carries
 *      an executable intent.
 */

import { describe, expect, test } from "bun:test";
import { deriveSignals } from "../src/signals";
import { buildDeviceBaseline, buildModelBaselines } from "../src/baselines";
import { detectAnomalies } from "../src/anomalies";
import {
  appendHypothesis,
  appendRecommendation,
  createDiagnosisLedger,
  diagnose,
  resolveActiveInterpretations,
} from "../src/diagnosis";
import { DEVICE_1, DEVICE_2, TENANT_A, TENANT_B, atHour, obs, signal, stableJson } from "./helpers";

const WINDOW = { asOf: atHour(48), windowMs: 48 * 3_600_000 };

/** A deterministic multi-kind observation stream for the pipeline tests. */
function observationStream() {
  return [
    obs("device.power", { batteryPercent: 85 }, atHour(1)),
    obs("device.power", { batteryPercent: 40 }, atHour(5)),
    obs("device.power", { batteryPercent: 9 }, atHour(20)),
    obs("device.storage", { usedBytes: 180, totalBytes: 256 }, atHour(2)),
    obs("device.storage", { usedBytes: 250, totalBytes: 256 }, atHour(21)),
    obs("device.health", { cpuUtilization: 30, memoryUtilization: 40 }, atHour(3)),
    obs("device.health", { cpuUtilization: 35, memoryUtilization: 42 }, atHour(7)),
    obs("device.health", { cpuUtilization: 33, memoryUtilization: 41 }, atHour(11)),
    obs("device.health", { cpuUtilization: 31, memoryUtilization: 44 }, atHour(15)),
    obs("device.health", { cpuUtilization: 36, memoryUtilization: 39 }, atHour(18)),
    obs("device.health", { cpuUtilization: 34, memoryUtilization: 43 }, atHour(19)),
    obs("device.health", { cpuUtilization: 32, memoryUtilization: 45 }, atHour(20)),
    obs("device.health", { cpuUtilization: 30, memoryUtilization: 40 }, atHour(21)),
    obs("device.health", { cpuUtilization: 37, memoryUtilization: 41 }, atHour(22)),
    obs("device.health", { type: "crash" }, atHour(6)),
    obs("device.health", { type: "kernel_panic" }, atHour(10)),
    obs("device.health", { type: "crash" }, atHour(14)),
    obs("device.health", { temperatureC: 55 }, atHour(4)),
    obs("device.health", { bootDurationMs: 21_000 }, atHour(5)),
    obs("device.identity", { hostname: "desk-042" }, atHour(1)), // unmapped kind
  ];
}

describe("invariant: end-to-end determinism", () => {
  test("the same observation stream => byte-identical pipeline output across runs", () => {
    const observations = observationStream();

    const pipeline = () => {
      const derived = deriveSignals(observations, {
        tenantId: TENANT_A,
        deviceId: DEVICE_1,
        window: WINDOW,
      });
      if (!derived.ok) throw new Error("derive failed");
      const baseline = buildDeviceBaseline({
        tenantId: TENANT_A,
        deviceId: DEVICE_1,
        signalKind: "cpu.usage",
        window: WINDOW,
        signals: derived.signals,
      });
      if (!baseline.ok) throw new Error("baseline failed");
      const detected = detectAnomalies(derived.signals, {
        tenantId: TENANT_A,
        ...WINDOW,
        baselines: [baseline.baseline],
      });
      if (!detected.ok) throw new Error("detect failed");
      const diagnosed = diagnose(detected.anomalies, {
        tenantId: TENANT_A,
        deviceId: DEVICE_1,
        at: atHour(48),
        correlationId: "cor_invariants" as never,
      });
      if (!diagnosed.ok) throw new Error("diagnose failed");
      return {
        signals: derived.signals,
        skipped: derived.skipped,
        baseline: baseline.baseline,
        anomalies: detected.anomalies,
        hypotheses: diagnosed.hypotheses,
        recommendations: diagnosed.recommendations,
      };
    };

    const run1 = pipeline();
    const run2 = pipeline();
    expect(stableJson(run1)).toBe(stableJson(run2));
    // The stream produces at least one signal of each mapped kind and
    // real anomalies -> hypotheses (guards against a vacuous pipeline).
    expect(run1.signals.length >= 19).toBe(true);
    expect(run1.anomalies.length >= 2).toBe(true);
    expect(run1.hypotheses.length >= 2).toBe(true);
    expect(run1.recommendations.length >= 2).toBe(true);
  });

  test("input permutation does not change any derived output", () => {
    const forward = observationStream();
    const reversed = [...forward].reverse();
    const a = deriveSignals(forward, { tenantId: TENANT_A, deviceId: DEVICE_1, window: WINDOW });
    const b = deriveSignals(reversed, { tenantId: TENANT_A, deviceId: DEVICE_1, window: WINDOW });
    expect(stableJson(a)).toBe(stableJson(b));

    if (!a.ok || !b.ok) throw new Error("derive failed");
    const baselineA = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: a.signals,
    });
    const baselineB = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: [...a.signals].reverse(),
    });
    expect(stableJson(baselineA)).toBe(stableJson(baselineB));
  });

  test("deterministic record ids: re-running the whole pipeline yields identical ids", () => {
    const observations = observationStream().slice(0, 6);
    const run = () => {
      const derived = deriveSignals(observations, { tenantId: TENANT_A, deviceId: DEVICE_1 });
      if (!derived.ok) throw new Error("derive failed");
      const detected = detectAnomalies(derived.signals, { tenantId: TENANT_A, ...WINDOW });
      if (!detected.ok) throw new Error("detect failed");
      const diagnosed = diagnose(detected.anomalies, {
        tenantId: TENANT_A,
        deviceId: DEVICE_1,
        at: atHour(48),
        correlationId: "cor_invariants" as never,
      });
      if (!diagnosed.ok) throw new Error("diagnose failed");
      return {
        anomalyIds: detected.anomalies.map((a) => a.id),
        hypothesisIds: diagnosed.hypotheses.map((h) => h.id),
        recommendationIds: diagnosed.recommendations.map((r) => r.id),
      };
    };
    expect(run()).toEqual(run());
  });
});

describe("invariant: tenant isolation", () => {
  test("tenant A's observations never produce tenant B interpretations (and vice versa)", () => {
    const observations = observationStream();
    const a = deriveSignals(observations, { tenantId: TENANT_A, deviceId: DEVICE_1 });
    const b = deriveSignals(observations, { tenantId: TENANT_B, deviceId: DEVICE_1 });
    if (!a.ok || !b.ok) throw new Error("derive failed");
    expect(a.signals.every((s) => s.tenantId === TENANT_A)).toBe(true);
    expect(b.signals.every((s) => s.tenantId === TENANT_B)).toBe(true);
    expect(a.signals.map((s) => s.value)).toEqual(b.signals.map((s) => s.value)); // same reality
  });

  test("every stage rejects cross-tenant data by error, never by silent filtering", () => {
    const foreignSignal = signal("cpu.usage", 90, atHour(10), { tenantId: TENANT_B });

    const baseline = buildDeviceBaseline({
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      signalKind: "cpu.usage",
      window: WINDOW,
      signals: [foreignSignal],
    });
    expect(baseline.ok).toBe(false);

    const modelBaselines = buildModelBaselines(
      [foreignSignal],
      { resolve: () => "ModelA" },
      { tenantId: TENANT_A, window: WINDOW },
    );
    expect(modelBaselines.ok).toBe(false);

    const detected = detectAnomalies([foreignSignal], { tenantId: TENANT_A, ...WINDOW });
    expect(detected.ok).toBe(false);

    if (!detected.ok && !baseline.ok) {
      // Also through the diagnosis stage with a tenant-A anomaly set is
      // covered in diagnosis tests; here the earlier stages suffice.
      expect(baseline.error.failures[0].reason).toBe("tenant_mismatch");
    }
  });

  test("two tenants' devices never mix in one model baseline run", () => {
    const mixed = [
      signal("cpu.usage", 50, atHour(10), { tenantId: TENANT_A, deviceId: DEVICE_1 }),
      signal("cpu.usage", 50, atHour(10), { tenantId: TENANT_B, deviceId: DEVICE_2 }),
    ];
    const result = buildModelBaselines(mixed, { resolve: () => "ModelA" }, {
      tenantId: TENANT_A,
      window: WINDOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0].reason).toBe("tenant_mismatch");
  });
});

describe("invariant: versioned interpretation — new versions never mutate old records", () => {
  test("records are deeply frozen; re-diagnosis leaves version-1 bytes untouched", () => {
    const observations = observationStream();
    const derived = deriveSignals(observations, { tenantId: TENANT_A, deviceId: DEVICE_1 });
    if (!derived.ok) throw new Error("derive failed");
    const detected = detectAnomalies(derived.signals, { tenantId: TENANT_A, ...WINDOW });
    if (!detected.ok) throw new Error("detect failed");

    const run1 = diagnose(detected.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: "cor_invariants" as never,
    });
    if (!run1.ok) throw new Error("diagnose failed");
    const before = stableJson(run1.hypotheses);

    // Every record is frozen (defense in depth against downstream edits).
    for (const h of run1.hypotheses) {
      expect(Object.isFrozen(h)).toBe(true);
      expect(Object.isFrozen(h.evidence)).toBe(true);
    }
    for (const r of run1.recommendations) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(Object.isFrozen(r.proposedIntent)).toBe(true);
    }

    // Re-diagnose with the run-1 history: new records supersede; old bytes stay.
    const run2 = diagnose(detected.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(72),
      correlationId: "cor_invariants" as never,
      history: [
        ...run1.hypotheses.map((h) => ({ kind: "hypothesis" as const, hypothesis: h })),
        ...run1.recommendations.map((r) => ({ kind: "recommendation" as const, recommendation: r })),
      ],
    });
    if (!run2.ok) throw new Error("re-diagnose failed");
    expect(stableJson(run1.hypotheses)).toBe(before); // untouched
    expect(run2.hypotheses.every((h) => h.interpretationVersion === 2)).toBe(true);
    expect(run2.hypotheses.every((h) => h.supersedes !== undefined)).toBe(true);
  });

  test("the ledger is append-only: every operation returns a new ledger and leaves the input intact", () => {
    const ledger = createDiagnosisLedger(TENANT_A, DEVICE_1);
    const derived = deriveSignals([obs("device.power", { batteryPercent: 9 }, atHour(10))], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
    });
    if (!derived.ok) throw new Error("derive failed");
    const detected = detectAnomalies(derived.signals, { tenantId: TENANT_A, ...WINDOW });
    if (!detected.ok) throw new Error("detect failed");
    const run = diagnose(detected.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: "cor_invariants" as never,
    });
    if (!run.ok) throw new Error("diagnose failed");

    const afterHypothesis = appendHypothesis(ledger, run.hypotheses[0]);
    if (!afterHypothesis.ok) throw new Error("append failed");
    const afterRecommendation = appendRecommendation(afterHypothesis.ledger, run.recommendations[0]);
    if (!afterRecommendation.ok) throw new Error("append failed");

    expect(ledger.entries).toHaveLength(0);
    expect(afterHypothesis.ledger.entries).toHaveLength(1);
    expect(afterRecommendation.ledger.entries).toHaveLength(2);
    expect(Object.isFrozen(afterRecommendation.ledger)).toBe(true);

    const active = resolveActiveInterpretations(afterRecommendation.ledger);
    expect(active.hypotheses).toHaveLength(1);
    expect(active.recommendations).toHaveLength(1);
  });
});

describe("invariant: the proposal-only boundary", () => {
  test("no public record type carries an executable intent surface", () => {
    const derived = deriveSignals([obs("device.power", { batteryPercent: 9 }, atHour(10))], {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
    });
    if (!derived.ok) throw new Error("derive failed");
    const detected = detectAnomalies(derived.signals, { tenantId: TENANT_A, ...WINDOW });
    if (!detected.ok) throw new Error("detect failed");
    const run = diagnose(detected.anomalies, {
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: atHour(48),
      correlationId: "cor_invariants" as never,
    });
    if (!run.ok) throw new Error("diagnose failed");

    for (const recommendation of run.recommendations) {
      const record = recommendation as unknown as Record<string, unknown>;
      expect(record.intentId).toBeUndefined();
      expect(record.status).toBeUndefined();
      expect(record.authorizedAt).toBeUndefined();
      expect(record.dispatchedAt).toBeUndefined();
      // The draft payload carries ONLY the frozen payload fields.
      const payload = recommendation.proposedIntent.payload as unknown as Record<string, unknown>;
      expect(payload.kind).toBeUndefined(); // envelope-level field, not payload-level
      expect(payload.intentId).toBeUndefined();
    }
  });
});
