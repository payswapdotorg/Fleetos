/**
 * @fleetos/health — D3: Anomaly detection (deterministic rules).
 *
 * Deterministic rules comparing signals against baselines. NO ML: every
 * rule is explicit, enumerable, and testable; the rule set is VERSIONED
 * (`ANOMALY_RULES_VERSION`), and rule evaluation is a pure function of
 * (signals, baselines, thresholds, injected time).
 *
 * Rule families:
 *   - threshold rules   — absolute limits on a signal kind (battery low,
 *     storage near-full, temperature high). Fire without a baseline.
 *   - deviation rules   — statistical comparison of the LATEST reading
 *     against a device baseline (z-score). Require a baseline with at
 *     least `MIN_BASELINE_SAMPLES` samples and a positive stddev; a
 *     degenerate baseline (zero stddev) only fires when the reading
 *     differs from the (constant) baseline mean by the absolute epsilon.
 *   - window-count rules — event frequency within the trailing window
 *     (crash burst). Computed from the signal set itself.
 *
 * Anomaly records carry severity, evidence correlated to the source
 * observations, and the rule/baseline context that fired. Anomaly ids
 * are deterministic functions of the (tenant, device, rule, signal
 * sample) tuple — the same inputs always produce the same anomaly ids.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `asOf` is injected by the caller.
 */

import type { CorrelationId, DeviceId, ObservationId, TenantId } from "@fleetos/contracts";
import type { SignalBaseline } from "./baselines";
import type { HealthSignal, SignalKind } from "./signals";
import {
  ERROR_CODES,
  HEALTH_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
  parseIsoMs,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The anomaly-rule-set version. Bumped when a rule is added, removed, or
 * re-parameterized. Recorded on every anomaly; a new version never
 * rewrites anomalies recorded under an older version.
 */
export const ANOMALY_RULES_VERSION = 1 as const;

/**
 * The minimum baseline sample count before a deviation rule may fire.
 * A thinner baseline cannot support statistical comparison — the rule is
 * skipped with reason `insufficient_baseline_samples` (enumerable, not
 * an error).
 */
export const MIN_BASELINE_SAMPLES = 8 as const;

/**
 * The absolute epsilon used when a deviation rule faces a zero-stddev
 * baseline (a constant history): a reading differing from the constant
 * baseline by MORE than this epsilon deviates. Unit: the signal's
 * canonical unit. Explicit and testable; NOT a heuristic.
 */
export const ZERO_STDDEV_EPSILON = 1e-9;

/**
 * The z-score magnitude reported for a deviation against a zero-stddev
 * (constant) baseline. Finite and JSON-serializable by design (a raw
 * Infinity would serialize to `null`); always beyond every legal
 * critical z threshold, with the sign of the deviation.
 */
export const CONSTANT_BASELINE_Z = 1e6;

// ---------------------------------------------------------------------------
// Severities, rules, thresholds
// ---------------------------------------------------------------------------

/** The anomaly severity ladder (ordered). */
export type AnomalySeverity = "WARNING" | "CRITICAL";

/** The deterministic rule families. */
export type AnomalyRuleFamily = "threshold" | "deviation" | "window_count";

/** The stable rule identifiers (machine-stable; part of the rule contract). */
export type AnomalyRuleId =
  | "battery.low"
  | "storage.near_full"
  | "memory.pressure"
  | "cpu.spike"
  | "temperature.high"
  | "crash.burst"
  | "boot.slow";

/** The static description of one anomaly rule. */
export interface AnomalyRuleDefinition {
  readonly ruleId: AnomalyRuleId;
  readonly family: AnomalyRuleFamily;
  /** The signal kind the rule evaluates. */
  readonly signalKind: SignalKind;
  /** Human-readable statement of the rule. */
  readonly statement: string;
}

/**
 * The v1 rule set. Frozen; every entry is exercised by tests. Threshold
 * values live in `AnomalyThresholds` (overridable per call); the rule
 * SHAPES live here.
 */
export const ANOMALY_RULES: readonly AnomalyRuleDefinition[] = Object.freeze([
  Object.freeze({
    ruleId: "battery.low",
    family: "threshold",
    signalKind: "battery.capacity",
    statement: "latest battery.capacity <= warning below 20%, critical at or below 10%",
  }),
  Object.freeze({
    ruleId: "storage.near_full",
    family: "threshold",
    signalKind: "storage.usage",
    statement: "latest storage.usage ratio >= warning 0.90, critical >= 0.95",
  }),
  Object.freeze({
    ruleId: "temperature.high",
    family: "threshold",
    signalKind: "temperature.core",
    statement: "latest temperature.core >= warning 75 C, critical >= 85 C",
  }),
  Object.freeze({
    ruleId: "memory.pressure",
    family: "deviation",
    signalKind: "memory.usage",
    statement: "latest memory.usage z-score vs device baseline >= warning 2, critical >= 3",
  }),
  Object.freeze({
    ruleId: "cpu.spike",
    family: "deviation",
    signalKind: "cpu.usage",
    statement: "latest cpu.usage z-score vs device baseline >= warning 2, critical >= 3",
  }),
  Object.freeze({
    ruleId: "boot.slow",
    family: "deviation",
    signalKind: "boot.time",
    statement: "latest boot.time z-score vs device baseline >= warning 2, critical >= 3",
  }),
  Object.freeze({
    ruleId: "crash.burst",
    family: "window_count",
    signalKind: "crash.event",
    statement: "crash.event count within the trailing window >= warning 3, critical >= 5",
  }),
]);

/**
 * The numeric thresholds the rules evaluate, overridable per detection
 * run (tenant policy may tune sensitivity; the DEFAULTS are the frozen
 * reference). All defaults are exercised by tests.
 */
export interface AnomalyThresholds {
  /** battery.capacity: at or below => WARNING (percent). */
  readonly batteryWarningPercent: number;
  /** battery.capacity: at or below => CRITICAL (percent). */
  readonly batteryCriticalPercent: number;
  /** storage.usage: at or above => WARNING (ratio). */
  readonly storageWarningRatio: number;
  /** storage.usage: at or above => CRITICAL (ratio). */
  readonly storageCriticalRatio: number;
  /** temperature.core: at or above => WARNING (celsius). */
  readonly temperatureWarningCelsius: number;
  /** temperature.core: at or above => CRITICAL (celsius). */
  readonly temperatureCriticalCelsius: number;
  /** deviation rules: z-score at or above => WARNING. */
  readonly deviationWarningZ: number;
  /** deviation rules: z-score at or above => CRITICAL. */
  readonly deviationCriticalZ: number;
  /** crash.burst: window count at or above => WARNING. */
  readonly crashBurstWarningCount: number;
  /** crash.burst: window count at or above => CRITICAL. */
  readonly crashBurstCriticalCount: number;
}

/** The frozen reference thresholds (the defaults every run uses unless overridden). */
export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = Object.freeze({
  batteryWarningPercent: 20,
  batteryCriticalPercent: 10,
  storageWarningRatio: 0.9,
  storageCriticalRatio: 0.95,
  temperatureWarningCelsius: 75,
  temperatureCriticalCelsius: 85,
  deviationWarningZ: 2,
  deviationCriticalZ: 3,
  crashBurstWarningCount: 3,
  crashBurstCriticalCount: 5,
});

// ---------------------------------------------------------------------------
// The anomaly record
// ---------------------------------------------------------------------------

/** How one observation participates in an anomaly (evidence correlation). */
export interface AnomalyEvidence {
  /** The source observation the signal was derived from. */
  readonly observationId: ObservationId;
  readonly observedAt: string;
  readonly observationKind: string;
  /** The role this observation played in the anomaly. */
  readonly role: "subject_reading" | "window_event";
}

/**
 * A detected anomaly: a deterministic rule firing on a signal sample,
 * correlated to the source observation(s) and (for deviation rules) the
 * baseline it was compared against. Frozen; re-detection with the same
 * inputs produces a byte-identical record (including the id).
 */
export interface HealthAnomaly {
  /** Deterministic id: `anom_` + fnv1a32 of the identity tuple. */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The rule that fired. */
  readonly ruleId: AnomalyRuleId;
  readonly severity: AnomalySeverity;
  /** The signal kind the rule evaluated. */
  readonly signalKind: SignalKind;
  /** The signal's canonical unit. */
  readonly unit: HealthSignal["unit"];
  /** The reading that fired the rule (the signal value). */
  readonly value: number;
  /** ISO 8601 timestamp of the subject reading. */
  readonly observedAt: string;
  /** The source observations behind the anomaly. */
  readonly evidence: readonly AnomalyEvidence[];
  /** Rule-specific context (thresholds, z-score, baseline summary, counts). */
  readonly detail: Readonly<Record<string, unknown>>;
  /** The rule-set version that fired. */
  readonly anomalyRulesVersion: number;
  /** Schema version of this record shape (>= 1). */
  readonly schemaVersion: number;
}

/** Why a rule did not fire — enumerable, machine-stable. */
export type SkippedRuleReason =
  | "no_signal_in_window" // no sample of the rule's kind within the window
  | "no_baseline" // deviation rule found no matching device baseline
  | "insufficient_baseline_samples" // baseline thinner than MIN_BASELINE_SAMPLES
  | "below_threshold"; // evaluated; the reading did not meet the rule

/** A rule evaluation that did not produce an anomaly. */
export interface SkippedRule {
  readonly deviceId: DeviceId;
  readonly ruleId: AnomalyRuleId;
  readonly reason: SkippedRuleReason;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Options for `detectAnomalies`. */
export interface DetectAnomaliesOptions {
  /** Tenant scope (required — structural isolation). */
  readonly tenantId: TenantId;
  /** Injected "now" anchoring the trailing window. */
  readonly asOf: string;
  /** The trailing window length in milliseconds (> 0). */
  readonly windowMs: number;
  /**
   * Device baselines for deviation rules (matched by (deviceId,
   * signalKind), device scope only). Model baselines are fleet context —
   * deviation rules compare a device against ITS OWN history.
   */
  readonly baselines?: readonly SignalBaseline[];
  /** Threshold overrides (default: DEFAULT_ANOMALY_THRESHOLDS). */
  readonly thresholds?: AnomalyThresholds;
  /** Correlation id stamped on validation errors. */
  readonly correlationId?: CorrelationId;
}

/** The result of an anomaly-detection run (tagged union; never throws). */
export type AnomalyDetectionResult =
  | {
      readonly ok: true;
      /** Detected anomalies, sorted by (deviceId, ruleId, observedAt). */
      readonly anomalies: readonly HealthAnomaly[];
      /** Non-firing rule evaluations, sorted by (deviceId, ruleId). */
      readonly skipped: readonly SkippedRule[];
      /** The rule-set version that evaluated. */
      readonly anomalyRulesVersion: number;
    }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError };

/**
 * Detect anomalies: evaluate every rule for every device present in the
 * signal set, deterministically. Threshold and window-count rules fire
 * on the LATEST in-window sample of their kind; deviation rules compare
 * the latest sample against the device's baseline (z-score); the crash
 * rule counts in-window events.
 *
 * Determinism: the same signals + baselines + options always produce the
 * same anomalies (same ids) in the same order. `detectedAt`-style wall
 * clock stamps are deliberately absent — the anomaly's `observedAt` is
 * the reading's time and the run is anchored by the injected `asOf`.
 */
export function detectAnomalies(
  signals: readonly HealthSignal[],
  options: DetectAnomaliesOptions,
): AnomalyDetectionResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.tenantId !== "string" || options.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.asOf !== "string" || !looksLikeIso(options.asOf)) {
    failures.push({ path: "/asOf", reason: "not_iso" });
  } else if (Number.isNaN(parseIsoMs(options.asOf))) {
    failures.push({ path: "/asOf", reason: "not_parseable" });
  }
  if (typeof options?.windowMs !== "number" || !(options.windowMs > 0)) {
    failures.push({ path: "/windowMs", reason: "must_be_positive" });
  }
  if (!Array.isArray(signals)) {
    failures.push({ path: "/signals", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.anomalyDetectionInvalid,
        "anomaly detection request is invalid",
        {
          tenantId: options?.tenantId || SYNTHETIC_SYSTEM_TENANT,
          correlationId: options?.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  for (let i = 0; i < signals.length; i++) {
    if (signals[i].tenantId !== options.tenantId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.anomalyDetectionInvalid,
          "anomaly detection request is invalid",
          {
            tenantId: options.tenantId,
            correlationId: options.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
          },
          [{ path: `/signals/${i}/tenantId`, reason: "tenant_mismatch" }],
        ),
      };
    }
  }

  const thresholds = options.thresholds ?? DEFAULT_ANOMALY_THRESHOLDS;
  const windowStartMs = parseIsoMs(options.asOf) - options.windowMs;
  const windowEndMs = parseIsoMs(options.asOf);

  // Group in-window signals by (device, kind); devices sorted for determinism.
  const byDeviceKind = new Map<string, { deviceId: DeviceId; byKind: Map<string, HealthSignal[]> }>();
  for (const signal of signals) {
    const atMs = parseIsoMs(signal.observedAt);
    if (Number.isNaN(atMs) || atMs <= windowStartMs || atMs > windowEndMs) continue;
    const deviceKey = signal.deviceId as string;
    let group = byDeviceKind.get(deviceKey);
    if (group === undefined) {
      group = { deviceId: signal.deviceId, byKind: new Map<string, HealthSignal[]>() };
      byDeviceKind.set(deviceKey, group);
    }
    let list = group.byKind.get(signal.kind);
    if (list === undefined) {
      list = [];
      group.byKind.set(signal.kind, list);
    }
    list.push(signal);
  }

  // Baseline lookup: (deviceId string, signalKind) -> baseline.
  const baselineIndex = new Map<string, SignalBaseline>();
  for (const baseline of options.baselines ?? []) {
    if (baseline.tenantId !== options.tenantId) continue; // never compared cross-tenant
    if (baseline.scope.kind !== "device") continue;
    baselineIndex.set(`${baseline.scope.deviceId as string}|${baseline.signalKind}`, baseline);
  }

  const anomalies: HealthAnomaly[] = [];
  const skipped: SkippedRule[] = [];

  for (const deviceKey of [...byDeviceKind.keys()].sort()) {
    const { deviceId, byKind } = byDeviceKind.get(deviceKey)!;

    for (const rule of ANOMALY_RULES) {
      const samples = byKind.get(rule.signalKind) ?? [];

      if (rule.family === "window_count") {
        if (samples.length === 0) {
          skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "no_signal_in_window" }));
          continue;
        }
        const count = samples.length;
        const severity =
          count >= thresholds.crashBurstCriticalCount
            ? ("CRITICAL" as AnomalySeverity)
            : count >= thresholds.crashBurstWarningCount
              ? ("WARNING" as AnomalySeverity)
              : null;
        if (severity === null) {
          skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "below_threshold" }));
          continue;
        }
        // Subject reading: the most recent event; every event is evidence.
        const ordered = [...samples].sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0));
        const latest = ordered[ordered.length - 1];
        anomalies.push(
          makeAnomaly(options.tenantId, deviceId, rule, severity, latest, count, ordered, {
            windowEventCount: count,
            warningCount: thresholds.crashBurstWarningCount,
            criticalCount: thresholds.crashBurstCriticalCount,
          }),
        );
        continue;
      }

      // threshold + deviation rules evaluate the LATEST sample of the kind.
      if (samples.length === 0) {
        skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "no_signal_in_window" }));
        continue;
      }
      const latest = latestSample(samples);

      if (rule.family === "threshold") {
        const severity = thresholdSeverity(rule.ruleId, latest.value, thresholds);
        if (severity === null) {
          skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "below_threshold" }));
          continue;
        }
        const thresholdsUsed = thresholdDetail(rule.ruleId, thresholds);
        anomalies.push(makeAnomaly(options.tenantId, deviceId, rule, severity, latest, latest.value, [latest], thresholdsUsed));
        continue;
      }

      // deviation family
      const baseline = baselineIndex.get(`${deviceKey}|${rule.signalKind}`);
      if (baseline === undefined) {
        skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "no_baseline" }));
        continue;
      }
      if (baseline.summary.count < MIN_BASELINE_SAMPLES) {
        skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "insufficient_baseline_samples" }));
        continue;
      }
      const z = zScore(latest.value, baseline);
      const severity =
        z >= thresholds.deviationCriticalZ
          ? ("CRITICAL" as AnomalySeverity)
          : z >= thresholds.deviationWarningZ
            ? ("WARNING" as AnomalySeverity)
            : null;
      if (severity === null) {
        skipped.push(frozen({ deviceId, ruleId: rule.ruleId, reason: "below_threshold" }));
        continue;
      }
      anomalies.push(
        makeAnomaly(options.tenantId, deviceId, rule, severity, latest, latest.value, [latest], {
          zScore: z,
          baselineMean: baseline.summary.mean,
          baselineStddev: baseline.summary.stddev,
          baselineSampleCount: baseline.summary.count,
          warningZ: thresholds.deviationWarningZ,
          criticalZ: thresholds.deviationCriticalZ,
        }),
      );
    }
  }

  const orderedAnomalies = anomalies.sort((a, b) => {
    const d = (a.deviceId as string) < (b.deviceId as string) ? -1 : (a.deviceId as string) > (b.deviceId as string) ? 1 : 0;
    if (d !== 0) return d;
    const r = a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    if (r !== 0) return r;
    return a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
  });
  const orderedSkipped = skipped.sort((a, b) => {
    const d = (a.deviceId as string) < (b.deviceId as string) ? -1 : (a.deviceId as string) > (b.deviceId as string) ? 1 : 0;
    if (d !== 0) return d;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  return frozen({
    ok: true as const,
    anomalies: frozenArray(orderedAnomalies),
    skipped: frozenArray(orderedSkipped),
    anomalyRulesVersion: ANOMALY_RULES_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The latest sample by (observedAt, sourceObservationId) — deterministic. */
function latestSample(samples: readonly HealthSignal[]): HealthSignal {
  return [...samples].sort((a, b) => {
    if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
    return (a.sourceObservationId as string) < (b.sourceObservationId as string) ? -1 : 1;
  })[samples.length - 1];
}

/** The z-score of a reading against a baseline; zero-stddev handled by epsilon. */
function zScore(value: number, baseline: SignalBaseline): number {
  const { mean, stddev } = baseline.summary;
  if (stddev <= 0) {
    if (value > mean + ZERO_STDDEV_EPSILON) return CONSTANT_BASELINE_Z;
    if (value < mean - ZERO_STDDEV_EPSILON) return -CONSTANT_BASELINE_Z;
    return 0;
  }
  return (value - mean) / stddev;
}

function thresholdSeverity(
  ruleId: AnomalyRuleId,
  value: number,
  thresholds: AnomalyThresholds,
): AnomalySeverity | null {
  switch (ruleId) {
    case "battery.low":
      if (value <= thresholds.batteryCriticalPercent) return "CRITICAL";
      if (value <= thresholds.batteryWarningPercent) return "WARNING";
      return null;
    case "storage.near_full":
      if (value >= thresholds.storageCriticalRatio) return "CRITICAL";
      if (value >= thresholds.storageWarningRatio) return "WARNING";
      return null;
    case "temperature.high":
      if (value >= thresholds.temperatureCriticalCelsius) return "CRITICAL";
      if (value >= thresholds.temperatureWarningCelsius) return "WARNING";
      return null;
    default:
      return null; // not a threshold rule
  }
}

function thresholdDetail(
  ruleId: AnomalyRuleId,
  thresholds: AnomalyThresholds,
): Readonly<Record<string, unknown>> {
  switch (ruleId) {
    case "battery.low":
      return { warningPercent: thresholds.batteryWarningPercent, criticalPercent: thresholds.batteryCriticalPercent };
    case "storage.near_full":
      return { warningRatio: thresholds.storageWarningRatio, criticalRatio: thresholds.storageCriticalRatio };
    case "temperature.high":
      return { warningCelsius: thresholds.temperatureWarningCelsius, criticalCelsius: thresholds.temperatureCriticalCelsius };
    default:
      return {};
  }
}

function makeAnomaly(
  tenantId: TenantId,
  deviceId: DeviceId,
  rule: AnomalyRuleDefinition,
  severity: AnomalySeverity,
  subject: HealthSignal,
  value: number,
  evidenceSignals: readonly HealthSignal[],
  detail: Readonly<Record<string, unknown>>,
): HealthAnomaly {
  const evidence = evidenceSignals.map((signal) =>
    frozen({
      observationId: signal.sourceObservationId,
      observedAt: signal.observedAt,
      observationKind: observationKindOf(signal.kind),
      role: signal === subject ? ("subject_reading" as const) : ("window_event" as const),
    }),
  );
  const id = `anom_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      deviceId: deviceId as string,
      ruleId: rule.ruleId,
      signalKind: rule.signalKind,
      observedAt: subject.observedAt,
      sourceObservationId: subject.sourceObservationId as string,
      severity,
    }),
  )}`;
  return frozen({
    id,
    tenantId,
    deviceId,
    ruleId: rule.ruleId,
    severity,
    signalKind: rule.signalKind,
    unit: subject.unit,
    value,
    observedAt: subject.observedAt,
    evidence: frozenArray(evidence),
    detail: frozen({ ...detail }),
    anomalyRulesVersion: ANOMALY_RULES_VERSION,
    schemaVersion: 1,
  });
}

/** The source observation kind for a signal kind (spec table). */
function observationKindOf(kind: SignalKind): string {
  switch (kind) {
    case "battery.capacity":
      return "device.power";
    case "storage.usage":
      return "device.storage";
    default:
      return "device.health";
  }
}
