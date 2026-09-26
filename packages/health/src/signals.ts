/**
 * @fleetos/health — D1: The health signal model.
 *
 * Reality is observations/events (`spec/ARCHITECTURE.md` § Canonical
 * model). This module derives TYPED health Signals from CANONICAL
 * observations — the frozen `Observation` shape from `@fleetos/contracts`
 * (as produced by `@fleetos/device-model`'s normalization pipeline and
 * retained in the Device Twin's telemetry window).
 *
 * A Signal is a typed, unit-carrying, point-in-time numeric sample tied
 * back to its source observation. Signals are DETERMINISTICALLY derived:
 * the same observation stream always produces the same signals, in the
 * same order, with the same values. The derivation is VERSIONED
 * (`SIGNAL_MODEL_VERSION`); a future model version derives new records —
 * it never rewrites old ones.
 *
 * Payload tolerance (forward compatibility): the frozen observation kind
 * union is OPEN and payloads are `unknown`. Extractors match an
 * observation kind and a documented canonical payload shape; observations
 * whose kind has no extractor, whose payload shape does not match, or
 * whose values are out of range are SKIPPED with an enumerable machine
 * reason — never errors, never silently coerced (mirrors the frozen
 * contracts rule: "Modules consuming observations MUST tolerate unknown
 * kinds").
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `observedAt` values are data; window boundaries are
 * injected by the caller.
 */

import type { CorrelationId, DeviceId, Observation, ObservationId, TenantId } from "@fleetos/contracts";
import type { DeviceTwin } from "@fleetos/device-model";
import {
  ERROR_CODES,
  HEALTH_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
  parseIsoMs,
  toIsoUtc,
} from "./internal";

// ---------------------------------------------------------------------------
// Signal kinds, units, and the versioned model
// ---------------------------------------------------------------------------

/**
 * The signal model version. Bumped when an extractor changes what it
 * would derive from the same observation. Old derived signals keep their
 * recorded `signalModelVersion`; re-derivation always stamps the current
 * version. Version N+1 never rewrites version-N records.
 */
export const SIGNAL_MODEL_VERSION = 1 as const;

/**
 * The canonical unit vocabulary for health signals. Closed: a signal's
 * unit is one of these strings (deterministic interpretation downstream).
 */
export type SignalUnit =
  | "percent" // 0..100
  | "ratio" // 0..1
  | "celsius"
  | "milliseconds"
  | "count";

/**
 * The typed health signal kinds derived by model v1. Each kind has a
 * fixed unit and a fixed source observation kind (see
 * `SIGNAL_KIND_SPECIFICATIONS`).
 *
 *   battery.capacity  — remaining battery charge, percent.
 *   storage.usage     — logical storage utilization, ratio used/total.
 *   memory.usage      — memory utilization, percent.
 *   cpu.usage         — CPU utilization, percent.
 *   temperature.core  — core temperature reading, celsius.
 *   crash.event       — one crash/panic/boot-failure event, count (value 1).
 *   boot.time         — last boot duration, milliseconds.
 */
export type SignalKind =
  | "battery.capacity"
  | "storage.usage"
  | "memory.usage"
  | "cpu.usage"
  | "temperature.core"
  | "crash.event"
  | "boot.time";

/** All signal kinds in canonical order (the deterministic derivation order). */
export const ALL_SIGNAL_KINDS: readonly SignalKind[] = Object.freeze([
  "battery.capacity",
  "storage.usage",
  "memory.usage",
  "cpu.usage",
  "temperature.core",
  "crash.event",
  "boot.time",
]);

/**
 * The crash event types recognized by the `crash.event` extractor.
 * Machine-stable strings; other payload types are skipped.
 */
export type CrashEventType = "crash" | "kernel_panic" | "boot_failure";

/**
 * The static specification of a signal kind: source observation kind
 * (from the frozen open union), the canonical unit, and the confidence
 * stamped on derived samples. Computed readings (values derived from
 * multiple payload fields, e.g. a used/total ratio) carry reduced
 * confidence — an explicit, testable rule, not a heuristic.
 */
export interface SignalKindSpecification {
  readonly kind: SignalKind;
  /** The source observation kind this extractor consumes. */
  readonly sourceObservationKind: string;
  /** The canonical unit of derived samples. */
  readonly unit: SignalUnit;
  /** Confidence stamped on directly-read payload values. */
  readonly directConfidence: number;
  /** Confidence stamped on computed values (e.g. a used/total ratio). */
  readonly computedConfidence: number;
  /** Human-readable description of the expected payload shape. */
  readonly payloadShape: string;
}

/**
 * The frozen signal-kind specification table for model v1. The single
 * source of truth for extractors, units, and confidences.
 */
export const SIGNAL_KIND_SPECIFICATIONS: Readonly<Record<SignalKind, SignalKindSpecification>> =
  Object.freeze({
    "battery.capacity": Object.freeze({
      kind: "battery.capacity",
      sourceObservationKind: "device.power",
      unit: "percent",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: "{ batteryPercent: number (0..100) }",
    }),
    "storage.usage": Object.freeze({
      kind: "storage.usage",
      sourceObservationKind: "device.storage",
      unit: "ratio",
      directConfidence: 1.0,
      computedConfidence: 0.9,
      payloadShape: "{ usedBytes: number (>=0), totalBytes: number (>0, >= usedBytes) }",
    }),
    "memory.usage": Object.freeze({
      kind: "memory.usage",
      sourceObservationKind: "device.health",
      unit: "percent",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: "{ memoryUtilization: number (0..100) }",
    }),
    "cpu.usage": Object.freeze({
      kind: "cpu.usage",
      sourceObservationKind: "device.health",
      unit: "percent",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: "{ cpuUtilization: number (0..100) }",
    }),
    "temperature.core": Object.freeze({
      kind: "temperature.core",
      sourceObservationKind: "device.health",
      unit: "celsius",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: "{ temperatureC: number }",
    }),
    "crash.event": Object.freeze({
      kind: "crash.event",
      sourceObservationKind: "device.health",
      unit: "count",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: '{ type: "crash" | "kernel_panic" | "boot_failure" }',
    }),
    "boot.time": Object.freeze({
      kind: "boot.time",
      sourceObservationKind: "device.health",
      unit: "milliseconds",
      directConfidence: 1.0,
      computedConfidence: 1.0,
      payloadShape: "{ bootDurationMs: number (>=0) }",
    }),
  });

// ---------------------------------------------------------------------------
// The Signal record
// ---------------------------------------------------------------------------

/**
 * A typed health signal: one deterministically derived, unit-carrying
 * numeric sample tied back to its source observation. Frozen; a
 * re-derivation produces new records, never rewrites old ones.
 */
export interface HealthSignal {
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device the sample belongs to. */
  readonly deviceId: DeviceId;
  /** The signal kind (see SIGNAL_KIND_SPECIFICATIONS). */
  readonly kind: SignalKind;
  /** The canonical unit. */
  readonly unit: SignalUnit;
  /** The sample value, expressed in the canonical unit. */
  readonly value: number;
  /** ISO 8601 timestamp copied from the source observation. */
  readonly observedAt: string;
  /** Correlation to the source observation (immutable reality). */
  readonly sourceObservationId: ObservationId;
  /** Confidence in [0, 1] — a deterministic function of the derivation. */
  readonly confidence: number;
  /**
   * Kind-specific derivation context (e.g. the crash event type, the raw
   * byte figures behind a utilization ratio). JSON-serializable.
   */
  readonly detail: Readonly<Record<string, unknown>>;
  /** The signal model version that derived this sample. */
  readonly signalModelVersion: number;
  /** Schema version of this record shape (>= 1). */
  readonly schemaVersion: number;
}

/**
 * An observation that produced no signal, with an enumerable machine
 * reason. Skips are data-quality signals, not errors: the frozen
 * contracts require consumers to tolerate unknown observation kinds.
 */
export interface SkippedObservation {
  readonly observationId: ObservationId;
  readonly observationKind: string;
  readonly reason:
    | "kind_unmapped" // no extractor consumes this observation kind
    | "payload_shape_unexpected" // extractor matched, payload shape did not
    | "payload_out_of_range" // payload fields failed range sanity
    | "observed_at_not_parseable" // window filtering could not parse the timestamp
    | "observed_at_outside_window"; // window filter excluded it
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Options for `deriveSignals`. */
export interface DeriveSignalsOptions {
  /** Tenant scope stamped on derived signals (required — no implicit scope). */
  readonly tenantId: TenantId;
  /** The device the observations belong to (required). */
  readonly deviceId: DeviceId;
  /**
   * Optional rolling window: only observations with `observedAt` in
   * `(asOf - windowMs, asOf]` derive signals. `asOf` is INJECTED (no
   * clock reads). Absent `window` derives from every observation.
   */
  readonly window?: {
    readonly asOf: string;
    readonly windowMs: number;
  };
  /**
   * Correlation id stamped on validation errors (default: the synthetic
   * `cor_health_pipeline`). Supply the request's correlation id when the
   * derivation runs inside a traced flow.
   */
  readonly correlationId?: CorrelationId;
}

/** The successful result of a signal derivation run. */
export interface SignalDerivationSuccess {
  readonly ok: true;
  /** Derived signals, deterministically ordered (see `deriveSignals`). */
  readonly signals: readonly HealthSignal[];
  /** Observations that produced no signal, with machine reasons. */
  readonly skipped: readonly SkippedObservation[];
  /** The signal model version that produced this run. */
  readonly signalModelVersion: number;
}

/** The result of a signal derivation run (tagged union; never throws). */
export type SignalDerivationResult = SignalDerivationSuccess | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError };

/**
 * Derive typed health signals from canonical observations.
 * Deterministic: the same observations + the same options ALWAYS produce
 * the same result — same signals, same order (stable sort by
 * (observedAt, sourceObservationId, canonical kind order)), same skips.
 *
 * Validation: observations must be structurally sound (non-empty id and
 * kind, ISO-looking `observedAt`, `schemaVersion >= 1`); otherwise the
 * whole run is rejected with a ValidationError (code
 * `health.signals.invalid_request`) and NOTHING is derived — mirroring
 * the frozen contracts' atomic-batch semantics.
 */
export function deriveSignals(
  observations: readonly Observation[],
  options: DeriveSignalsOptions,
): SignalDerivationResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.tenantId !== "string" || options.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.deviceId !== "string" || options.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (options?.window !== undefined) {
    if (typeof options.window.asOf !== "string" || !looksLikeIso(options.window.asOf)) {
      failures.push({ path: "/window/asOf", reason: "not_iso" });
    } else if (Number.isNaN(parseIsoMs(options.window.asOf))) {
      failures.push({ path: "/window/asOf", reason: "not_parseable" });
    }
    if (typeof options.window.windowMs !== "number" || !(options.window.windowMs > 0)) {
      failures.push({ path: "/window/windowMs", reason: "must_be_positive" });
    }
  }
  if (!Array.isArray(observations)) {
    failures.push({ path: "/observations", reason: "required" });
  } else {
    for (let i = 0; i < observations.length; i++) {
      const obs = observations[i];
      if (!obs || typeof obs.id !== "string" || obs.id.length === 0) {
        failures.push({ path: `/observations/${i}/id`, reason: "required" });
      }
      if (!obs || typeof obs.kind !== "string" || obs.kind.length === 0) {
        failures.push({ path: `/observations/${i}/kind`, reason: "required" });
      }
      if (!obs || typeof obs.observedAt !== "string" || !looksLikeIso(obs.observedAt)) {
        failures.push({ path: `/observations/${i}/observedAt`, reason: "not_iso" });
      }
      if (!obs || typeof obs.schemaVersion !== "number" || obs.schemaVersion < 1) {
        failures.push({ path: `/observations/${i}/schemaVersion`, reason: "must_be_at_least_one" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.signalDerivationInvalid,
        "signal derivation request is invalid",
        {
          tenantId: options?.tenantId || SYNTHETIC_SYSTEM_TENANT,
          correlationId: options?.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const windowStartMs =
    options.window !== undefined ? parseIsoMs(options.window.asOf) - options.window.windowMs : null;
  const windowEndMs = options.window !== undefined ? parseIsoMs(options.window.asOf) : null;

  const signals: HealthSignal[] = [];
  const skipped: SkippedObservation[] = [];

  for (const obs of observations) {
    // Window filtering first: an excluded observation is skipped, never an error.
    if (windowStartMs !== null && windowEndMs !== null) {
      const atMs = parseIsoMs(obs.observedAt);
      if (Number.isNaN(atMs)) {
        skipped.push(skip(obs, "observed_at_not_parseable"));
        continue;
      }
      if (atMs <= windowStartMs || atMs > windowEndMs) {
        skipped.push(skip(obs, "observed_at_outside_window"));
        continue;
      }
    }

    const payload = obs.payload;
    const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

    if (obs.kind === "device.power") {
      deriveBattery(options, obs, record, signals, skipped);
      continue;
    }
    if (obs.kind === "device.storage") {
      deriveStorage(options, obs, record, signals, skipped);
      continue;
    }
    if (obs.kind === "device.health") {
      deriveDeviceHealth(options, obs, record, signals, skipped);
      continue;
    }
    skipped.push(skip(obs, "kind_unmapped"));
  }

  // Deterministic total order: (observedAt, sourceObservationId, kind order).
  const kindOrder = new Map<string, number>(ALL_SIGNAL_KINDS.map((k, i) => [k, i]));
  const ordered = signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const at = a.signal.observedAt < b.signal.observedAt ? -1 : a.signal.observedAt > b.signal.observedAt ? 1 : 0;
      if (at !== 0) return at;
      const id =
        a.signal.sourceObservationId < b.signal.sourceObservationId
          ? -1
          : a.signal.sourceObservationId > b.signal.sourceObservationId
            ? 1
            : 0;
      if (id !== 0) return id;
      const ka = kindOrder.get(a.signal.kind) ?? ALL_SIGNAL_KINDS.length;
      const kb = kindOrder.get(b.signal.kind) ?? ALL_SIGNAL_KINDS.length;
      if (ka !== kb) return ka - kb;
      return a.index - b.index;
    })
    .map((entry) => entry.signal);

  return frozen({
    ok: true as const,
    signals: frozenArray(ordered),
    skipped: frozenArray(skipped),
    signalModelVersion: SIGNAL_MODEL_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Extractors (pure, per observation kind; fixed processing order)
// ---------------------------------------------------------------------------

function skip(obs: Observation, reason: SkippedObservation["reason"]): SkippedObservation {
  return frozen({ observationId: obs.id, observationKind: obs.kind, reason });
}

/** battery.capacity <- device.power { batteryPercent: 0..100 } */
function deriveBattery(
  options: DeriveSignalsOptions,
  obs: Observation,
  record: Record<string, unknown> | null,
  signals: HealthSignal[],
  skipped: SkippedObservation[],
): void {
  const batteryPercent = record?.batteryPercent;
  if (typeof batteryPercent !== "number" || !Number.isFinite(batteryPercent)) {
    skipped.push(skip(obs, "payload_shape_unexpected"));
    return;
  }
  if (batteryPercent < 0 || batteryPercent > 100) {
    skipped.push(skip(obs, "payload_out_of_range"));
    return;
  }
  signals.push(makeSignal(options, "battery.capacity", batteryPercent, obs, 1.0, {}));
}

/** storage.usage <- device.storage { usedBytes, totalBytes } (computed ratio) */
function deriveStorage(
  options: DeriveSignalsOptions,
  obs: Observation,
  record: Record<string, unknown> | null,
  signals: HealthSignal[],
  skipped: SkippedObservation[],
): void {
  const usedBytes = record?.usedBytes;
  const totalBytes = record?.totalBytes;
  if (
    typeof usedBytes !== "number" ||
    typeof totalBytes !== "number" ||
    !Number.isFinite(usedBytes) ||
    !Number.isFinite(totalBytes)
  ) {
    skipped.push(skip(obs, "payload_shape_unexpected"));
    return;
  }
  if (usedBytes < 0 || totalBytes <= 0 || usedBytes > totalBytes) {
    skipped.push(skip(obs, "payload_out_of_range"));
    return;
  }
  signals.push(
    makeSignal(options, "storage.usage", usedBytes / totalBytes, obs, 0.9, {
      usedBytes,
      totalBytes,
    }),
  );
}

/**
 * device.health carries up to five recognized fields; each PRESENT field
 * is extracted independently (one observation may yield several signals,
 * e.g. a combined cpu+memory+temperature reading). A payload with NONE
 * of the recognized fields present is a single shape miss.
 */
function deriveDeviceHealth(
  options: DeriveSignalsOptions,
  obs: Observation,
  record: Record<string, unknown> | null,
  signals: HealthSignal[],
  skipped: SkippedObservation[],
): void {
  const memoryUtilization = record?.memoryUtilization;
  const cpuUtilization = record?.cpuUtilization;
  const temperatureC = record?.temperatureC;
  const crashType = record?.type;
  const bootDurationMs = record?.bootDurationMs;

  const anyPresent =
    memoryUtilization !== undefined ||
    cpuUtilization !== undefined ||
    temperatureC !== undefined ||
    crashType !== undefined ||
    bootDurationMs !== undefined;
  if (!anyPresent) {
    skipped.push(skip(obs, "payload_shape_unexpected"));
    return;
  }

  if (memoryUtilization !== undefined) {
    extractPercent(options, obs, memoryUtilization, "memory.usage", signals, skipped);
  }
  if (cpuUtilization !== undefined) {
    extractPercent(options, obs, cpuUtilization, "cpu.usage", signals, skipped);
  }
  if (temperatureC !== undefined) {
    if (typeof temperatureC !== "number" || !Number.isFinite(temperatureC)) {
      skipped.push(skip(obs, "payload_shape_unexpected"));
    } else {
      signals.push(makeSignal(options, "temperature.core", temperatureC, obs, 1.0, {}));
    }
  }
  if (crashType !== undefined) {
    if (crashType !== "crash" && crashType !== "kernel_panic" && crashType !== "boot_failure") {
      skipped.push(skip(obs, "payload_shape_unexpected"));
    } else {
      signals.push(makeSignal(options, "crash.event", 1, obs, 1.0, { crashType }));
    }
  }
  if (bootDurationMs !== undefined) {
    if (typeof bootDurationMs !== "number" || !Number.isFinite(bootDurationMs)) {
      skipped.push(skip(obs, "payload_shape_unexpected"));
    } else if (bootDurationMs < 0) {
      skipped.push(skip(obs, "payload_out_of_range"));
    } else {
      signals.push(makeSignal(options, "boot.time", bootDurationMs, obs, 1.0, {}));
    }
  }
}

/** Shared extractor for percent-bounded readings (0..100). */
function extractPercent(
  options: DeriveSignalsOptions,
  obs: Observation,
  value: unknown,
  kind: "memory.usage" | "cpu.usage",
  signals: HealthSignal[],
  skipped: SkippedObservation[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    skipped.push(skip(obs, "payload_shape_unexpected"));
    return;
  }
  if (value < 0 || value > 100) {
    skipped.push(skip(obs, "payload_out_of_range"));
    return;
  }
  signals.push(makeSignal(options, kind, value, obs, 1.0, {}));
}

function makeSignal(
  options: DeriveSignalsOptions,
  kind: SignalKind,
  value: number,
  obs: Observation,
  confidence: number,
  detail: Readonly<Record<string, unknown>>,
): HealthSignal {
  return frozen({
    tenantId: options.tenantId,
    deviceId: options.deviceId,
    kind,
    unit: SIGNAL_KIND_SPECIFICATIONS[kind].unit,
    value,
    observedAt: obs.observedAt,
    sourceObservationId: obs.id,
    confidence,
    detail: frozen({ ...detail }),
    signalModelVersion: SIGNAL_MODEL_VERSION,
    schemaVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// Device Twin adapter (health depends on devices — MODULE-DEPENDENCY-MAP)
// ---------------------------------------------------------------------------

/**
 * Derive signals from a Device Twin's bounded telemetry window (the
 * latest canonical observations retained by `@fleetos/device-model`).
 * The twin's tenant/device scope is authoritative — the window parameter
 * carries only the optional rolling filter. Pure; the twin is never
 * modified.
 */
export function deriveSignalsFromTwin(
  twin: DeviceTwin,
  window?: {
    readonly asOf: string;
    readonly windowMs: number;
  },
): SignalDerivationResult {
  return deriveSignals(twin.telemetry.latest, {
    tenantId: twin.tenantId,
    deviceId: twin.deviceId,
    window,
  });
}

// ---------------------------------------------------------------------------
// Window helper
// ---------------------------------------------------------------------------

/**
 * Pure helper: the ISO 8601 window boundaries implied by a rolling
 * window: `(windowStart, windowEnd]` with `windowEnd = asOf`. Useful for
 * labeling baselines and reasoning about skips; never reads the clock.
 */
export function windowBoundaries(window: {
  readonly asOf: string;
  readonly windowMs: number;
}): { readonly windowStart: string; readonly windowEnd: string } {
  const endMs = parseIsoMs(window.asOf);
  return frozen({
    windowStart: toIsoUtc(endMs - window.windowMs),
    windowEnd: toIsoUtc(endMs),
  });
}
