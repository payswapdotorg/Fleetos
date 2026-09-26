/**
 * @fleetos/health — D2: Baselines (statistical summaries over history).
 *
 * Per-device and per-model baselines: pure functions over observation
 * history (consumed as derived signals — the D1 output). INJECTED time
 * defines the rolling window; the same input signals + the same window
 * ALWAYS produce the same baseline, byte for byte.
 *
 * Statistics conventions (explicit and versioned — `BASELINE_MODEL_VERSION`):
 *   - Percentiles: NEAREST-RANK. For a sorted ascending sample of size n,
 *     the p-th percentile is `v[ceil(p/100 * n) - 1]` (clamped to the
 *     sample bounds). No interpolation: the reported percentile is always
 *     an OBSERVED sample, so baselines never invent values.
 *   - Median: p50 under the same nearest-rank convention.
 *   - Stddev: POPULATION stddev (divide by n), the deterministic
 *     moment-based estimator over the window's samples.
 *
 * A model baseline aggregates the signals of every device sharing a
 * hardware model (the model identity is resolved through an INJECTED
 * `DeviceModelResolver` — the device-model lane owns device identity; a
 * twin-derived reference resolver is provided).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `asOf` is injected by the caller.
 */

import type { CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import type { DeviceTwin } from "@fleetos/device-model";
import type { HealthSignal, SignalKind, SignalUnit } from "./signals";
import { SIGNAL_KIND_SPECIFICATIONS } from "./signals";
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
// Versioning
// ---------------------------------------------------------------------------

/**
 * The baseline model version. Bumped when the statistical conventions
 * change (percentile method, stddev estimator, window semantics). Old
 * baseline records keep their recorded version; a new version never
 * rewrites them.
 */
export const BASELINE_MODEL_VERSION = 1 as const;

/** The percentile ranks captured by every statistical summary (ascending). */
export const PERCENTILE_RANKS: readonly number[] = Object.freeze([50, 90, 95, 99]);

// ---------------------------------------------------------------------------
// Statistical summary
// ---------------------------------------------------------------------------

/**
 * A deterministic statistical summary of a numeric sample. All fields
 * are pure functions of the (ordered) input values.
 */
export interface StatisticalSummary {
  /** Number of samples in the window. */
  readonly count: number;
  readonly min: number;
  readonly max: number;
  /** Arithmetic mean. */
  readonly mean: number;
  /** Nearest-rank p50 (always an observed sample). */
  readonly median: number;
  /** Nearest-rank p90. */
  readonly p90: number;
  /** Nearest-rank p95. */
  readonly p95: number;
  /** Nearest-rank p99. */
  readonly p99: number;
  /** Population standard deviation (divide by n). */
  readonly stddev: number;
}

/**
 * Compute a statistical summary over a numeric sample. Deterministic:
 * the same values (in any order) produce the same summary. The input
 * array is never mutated (sorted copy).
 *
 * @param values the sample (non-empty; empty input throws — callers use
 *   the baseline builders which enforce non-emptiness via tagged results)
 */
export function summarize(values: readonly number[]): StatisticalSummary {
  if (values.length === 0) {
    throw new Error("summarize: empty sample (use the baseline builders)");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let squaredDiffSum = 0;
  for (const v of sorted) squaredDiffSum += (v - mean) * (v - mean);
  const variance = squaredDiffSum / n;
  return frozen({
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: nearestRank(sorted, 50),
    p90: nearestRank(sorted, 90),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    stddev: Math.sqrt(variance),
  });
}

/** Nearest-rank percentile: sorted[ceil(p/100 * n) - 1], clamped. */
function nearestRank(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(Math.max(rank, 1), n) - 1;
  return sortedAsc[index];
}

// ---------------------------------------------------------------------------
// The baseline record
// ---------------------------------------------------------------------------

/** The scope a baseline covers: one device, or one hardware model. */
export type BaselineScope =
  | { readonly kind: "device"; readonly deviceId: DeviceId }
  | { readonly kind: "model"; readonly model: string };

/**
 * A versioned baseline: the statistical summary of one signal kind over
 * a rolling window, for one device or one hardware model. Frozen; a
 * rebuild with new data produces a NEW record — old baselines are never
 * rewritten (they are interpretations of history, and history is
 * immutable).
 */
export interface SignalBaseline {
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** What the baseline covers (one device or one hardware model). */
  readonly scope: BaselineScope;
  /** The signal kind summarized. */
  readonly signalKind: SignalKind;
  /** The signal kind's canonical unit. */
  readonly unit: SignalUnit;
  /** ISO 8601 inclusive-exclusive window bounds: (windowStart, windowEnd]. */
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Number of signal samples in the window. */
  readonly sampleCount: number;
  /** Number of distinct devices contributing samples (1 for device scope). */
  readonly deviceCount: number;
  /** The statistical summary. */
  readonly summary: StatisticalSummary;
  /** The baseline model version that computed this record. */
  readonly baselineModelVersion: number;
  /** Schema version of this record shape (>= 1). */
  readonly schemaVersion: number;
}

/** A rolling window anchored at an injected point in time. */
export interface BaselineWindow {
  /** Injected "now" — the window's inclusive upper bound. */
  readonly asOf: string;
  /** The window length in milliseconds (> 0). */
  readonly windowMs: number;
}

// ---------------------------------------------------------------------------
// Shared validation + selection
// ---------------------------------------------------------------------------

interface BaselineRequest {
  readonly tenantId: TenantId;
  readonly signalKind: SignalKind;
  readonly window: BaselineWindow;
  readonly correlationId?: CorrelationId;
}

function validateBaselineRequest(request: BaselineRequest): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  if (typeof request?.tenantId !== "string" || request.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof request?.signalKind !== "string" || SIGNAL_KIND_SPECIFICATIONS[request.signalKind] === undefined) {
    failures.push({ path: "/signalKind", reason: "unknown_signal_kind" });
  }
  if (typeof request?.window?.asOf !== "string" || !looksLikeIso(request.window.asOf)) {
    failures.push({ path: "/window/asOf", reason: "not_iso" });
  } else if (Number.isNaN(parseIsoMs(request.window.asOf))) {
    failures.push({ path: "/window/asOf", reason: "not_parseable" });
  }
  if (typeof request?.window?.windowMs !== "number" || !(request.window.windowMs > 0)) {
    failures.push({ path: "/window/windowMs", reason: "must_be_positive" });
  }
  return failures;
}

/**
 * Select the in-window samples for one (tenant, device, kind): signals
 * whose tenant/device/kind match and whose `observedAt` parses into
 * `(asOf - windowMs, asOf]`. Out-of-window or cross-scope signals are
 * EXCLUDED silently here — the builders reject scope mismatches up front
 * (see `validateSignalScope`), so a silent exclusion can only mean
 * "outside the window".
 */
function selectSamples(
  signals: readonly HealthSignal[],
  tenantId: TenantId,
  deviceId: DeviceId | null,
  kind: SignalKind,
  window: BaselineWindow,
): HealthSignal[] {
  const endMs = parseIsoMs(window.asOf);
  const startMs = endMs - window.windowMs;
  const selected: HealthSignal[] = [];
  for (const signal of signals) {
    if (signal.tenantId !== tenantId) continue;
    if (signal.kind !== kind) continue;
    if (deviceId !== null && signal.deviceId !== deviceId) continue;
    const atMs = parseIsoMs(signal.observedAt);
    if (Number.isNaN(atMs)) continue; // unparseable timestamps cannot be windowed
    if (atMs <= startMs || atMs > endMs) continue;
    selected.push(signal);
  }
  return selected;
}

function baselineError(failures: readonly { path: string; reason: string }[], request: BaselineRequest) {
  return makeValidationError(
    ERROR_CODES.baselineInvalid,
    "baseline request is invalid",
    {
      tenantId: request?.tenantId || SYNTHETIC_SYSTEM_TENANT,
      correlationId: request?.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
    },
    failures,
  );
}

// ---------------------------------------------------------------------------
// Device baselines
// ---------------------------------------------------------------------------

/** Options for `buildDeviceBaseline`. */
export interface DeviceBaselineOptions extends BaselineRequest {
  /** The device whose signals are summarized. */
  readonly deviceId: DeviceId;
  /**
   * The device's signal history (any superset is fine: cross-device and
   * cross-tenant signals are rejected, out-of-window samples excluded).
   */
  readonly signals: readonly HealthSignal[];
}

/** The result of a baseline build (tagged union; never throws). */
export type BaselineResult =
  | { readonly ok: true; readonly baseline: SignalBaseline }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError };

/**
 * Build the per-device baseline for one signal kind over a rolling
 * window. Pure and deterministic: the same signals + the same window
 * produce the same baseline. Every input signal must belong to the
 * request's tenant and device (structural tenant isolation is enforced
 * by rejection, not by filtering); zero in-window samples is the
 * enumerable error `no_samples`.
 */
export function buildDeviceBaseline(options: DeviceBaselineOptions): BaselineResult {
  const request: BaselineRequest = options;
  const failures = validateBaselineRequest(request);
  if (typeof options?.deviceId !== "string" || options.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (!Array.isArray(options?.signals)) {
    failures.push({ path: "/signals", reason: "required" });
  }
  if (failures.length > 0) {
    return { ok: false, error: baselineError(failures, request) };
  }

  // Scope enforcement: a foreign-tenant or foreign-device signal in the
  // input is a caller bug, not a filtering concern. Signals of OTHER
  // kinds are legal input (a superset); only the requested kind is
  // summarized.
  for (let i = 0; i < options.signals.length; i++) {
    const signal = options.signals[i];
    if (signal.tenantId !== options.tenantId) {
      return {
        ok: false,
        error: baselineError([{ path: `/signals/${i}/tenantId`, reason: "tenant_mismatch" }], request),
      };
    }
    if (signal.deviceId !== options.deviceId) {
      return {
        ok: false,
        error: baselineError([{ path: `/signals/${i}/deviceId`, reason: "device_mismatch" }], request),
      };
    }
  }

  const samples = selectSamples(options.signals, options.tenantId, options.deviceId, options.signalKind, options.window);
  if (samples.length === 0) {
    return {
      ok: false,
      error: baselineError([{ path: "/signals", reason: "no_samples_in_window" }], request),
    };
  }

  const bounds = windowBounds(options.window);
  return {
    ok: true,
    baseline: frozen({
      tenantId: options.tenantId,
      scope: frozen({ kind: "device" as const, deviceId: options.deviceId }),
      signalKind: options.signalKind,
      unit: SIGNAL_KIND_SPECIFICATIONS[options.signalKind].unit,
      windowStart: bounds.windowStart,
      windowEnd: bounds.windowEnd,
      sampleCount: samples.length,
      deviceCount: 1,
      summary: summarize(samples.map((s) => s.value)),
      baselineModelVersion: BASELINE_MODEL_VERSION,
      schemaVersion: 1,
    }),
  };
}

// ---------------------------------------------------------------------------
// Model baselines (fleet-level)
// ---------------------------------------------------------------------------

/** Options for `buildModelBaseline`. */
export interface ModelBaselineOptions extends BaselineRequest {
  /** The hardware model whose devices' signals are aggregated. */
  readonly model: string;
  /**
   * The signal history of the model's devices (all tenants rejected on
   * mismatch; multiple devices expected — one device is legal).
   */
  readonly signals: readonly HealthSignal[];
}

/**
 * Build the per-model baseline for one signal kind over a rolling
 * window: the aggregate statistical summary across every device sharing
 * the hardware model. Same tenant-isolation and determinism rules as
 * `buildDeviceBaseline`; `deviceCount` reports how many distinct devices
 * contributed.
 */
export function buildModelBaseline(options: ModelBaselineOptions): BaselineResult {
  const request: BaselineRequest = options;
  const failures = validateBaselineRequest(request);
  if (typeof options?.model !== "string" || options.model.length === 0) {
    failures.push({ path: "/model", reason: "required" });
  }
  if (!Array.isArray(options?.signals)) {
    failures.push({ path: "/signals", reason: "required" });
  }
  if (failures.length > 0) {
    return { ok: false, error: baselineError(failures, request) };
  }

  for (let i = 0; i < options.signals.length; i++) {
    const signal = options.signals[i];
    if (signal.tenantId !== options.tenantId) {
      return {
        ok: false,
        error: baselineError([{ path: `/signals/${i}/tenantId`, reason: "tenant_mismatch" }], request),
      };
    }
  }

  const samples = selectSamples(options.signals, options.tenantId, null, options.signalKind, options.window);
  if (samples.length === 0) {
    return {
      ok: false,
      error: baselineError([{ path: "/signals", reason: "no_samples_in_window" }], request),
    };
  }
  const deviceCount = new Set(samples.map((s) => s.deviceId as string)).size;

  const bounds = windowBounds(options.window);
  return {
    ok: true,
    baseline: frozen({
      tenantId: options.tenantId,
      scope: frozen({ kind: "model" as const, model: options.model }),
      signalKind: options.signalKind,
      unit: SIGNAL_KIND_SPECIFICATIONS[options.signalKind].unit,
      windowStart: bounds.windowStart,
      windowEnd: bounds.windowEnd,
      sampleCount: samples.length,
      deviceCount,
      summary: summarize(samples.map((s) => s.value)),
      baselineModelVersion: BASELINE_MODEL_VERSION,
      schemaVersion: 1,
    }),
  };
}

// ---------------------------------------------------------------------------
// Device model resolution (injected seam)
// ---------------------------------------------------------------------------

/**
 * The injected seam that resolves a device to its hardware model. The
 * device-model lane owns device identity; health never queries it — the
 * caller injects the resolution (e.g. built from Device Twins).
 */
export interface DeviceModelResolver {
  /** The hardware model of the device, or undefined when unknown. */
  resolve(deviceId: DeviceId): string | undefined;
}

/**
 * A resolver over Device Twins (same-lane `@fleetos/device-model`
 * import): resolves `deviceId -> twin.identity.enrollment.hardware.model`.
 * Later twins win on duplicate device ids (deterministic last-write
 * semantics over the given array order).
 */
export function createTwinModelResolver(twins: readonly DeviceTwin[]): DeviceModelResolver {
  const byDevice = new Map<string, string>();
  for (const twin of twins) {
    byDevice.set(twin.deviceId as string, twin.identity.enrollment.hardware.model);
  }
  return frozen({
    resolve(deviceId: DeviceId): string | undefined {
      return byDevice.get(deviceId as string);
    },
  });
}

/** The result of `buildModelBaselines` (one baseline per (model, kind)). */
export interface ModelBaselinesResult {
  readonly ok: true;
  /** Baselines sorted by (model, signalKind) — deterministic order. */
  readonly baselines: readonly SignalBaseline[];
  /** Devices whose model could not be resolved, sorted by device id. */
  readonly unresolvedDevices: readonly DeviceId[];
}

/**
 * Build every per-model baseline implied by the signal set: groups the
 * in-window signals by resolved hardware model and signal kind, then
 * summarizes each group. Deterministic: same signals + resolver + window
 * => same baselines in the same order. Devices the resolver cannot
 * resolve are reported (their signals are excluded from model baselines
 * — a model baseline must never silently mix unknown models).
 */
export function buildModelBaselines(
  signals: readonly HealthSignal[],
  resolver: DeviceModelResolver,
  options: {
    readonly tenantId: TenantId;
    readonly window: BaselineWindow;
    readonly correlationId?: CorrelationId;
  },
): ModelBaselinesResult | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError } {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.tenantId !== "string" || options.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.window?.asOf !== "string" || !looksLikeIso(options.window.asOf)) {
    failures.push({ path: "/window/asOf", reason: "not_iso" });
  } else if (Number.isNaN(parseIsoMs(options.window.asOf))) {
    failures.push({ path: "/window/asOf", reason: "not_parseable" });
  }
  if (typeof options?.window?.windowMs !== "number" || !(options.window.windowMs > 0)) {
    failures.push({ path: "/window/windowMs", reason: "must_be_positive" });
  }
  if (typeof resolver?.resolve !== "function") {
    failures.push({ path: "/resolver", reason: "required" });
  }
  if (!Array.isArray(signals)) {
    failures.push({ path: "/signals", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.baselineInvalid,
        "model baselines request is invalid",
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
          ERROR_CODES.baselineInvalid,
          "model baselines request is invalid",
          {
            tenantId: options.tenantId,
            correlationId: options.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
          },
          [{ path: `/signals/${i}/tenantId`, reason: "tenant_mismatch" }],
        ),
      };
    }
  }

  const endMs = parseIsoMs(options.window.asOf);
  const startMs = endMs - options.window.windowMs;
  const groups = new Map<string, Map<string, HealthSignal[]>>(); // model -> kind -> signals
  const unresolved = new Set<string>();

  for (const signal of signals) {
    const atMs = parseIsoMs(signal.observedAt);
    if (Number.isNaN(atMs) || atMs <= startMs || atMs > endMs) continue;
    const model = resolver.resolve(signal.deviceId);
    if (model === undefined) {
      unresolved.add(signal.deviceId as string);
      continue;
    }
    let byKind = groups.get(model);
    if (byKind === undefined) {
      byKind = new Map<string, HealthSignal[]>();
      groups.set(model, byKind);
    }
    let list = byKind.get(signal.kind);
    if (list === undefined) {
      list = [];
      byKind.set(signal.kind, list);
    }
    list.push(signal);
  }

  const bounds = windowBounds(options.window);
  const baselines: SignalBaseline[] = [];
  for (const model of [...groups.keys()].sort()) {
    const byKind = groups.get(model)!;
    for (const kind of [...byKind.keys()].sort()) {
      const samples = byKind.get(kind)!;
      baselines.push(
        frozen({
          tenantId: options.tenantId,
          scope: frozen({ kind: "model" as const, model }),
          signalKind: kind as SignalKind,
          unit: SIGNAL_KIND_SPECIFICATIONS[kind as SignalKind].unit,
          windowStart: bounds.windowStart,
          windowEnd: bounds.windowEnd,
          sampleCount: samples.length,
          deviceCount: new Set(samples.map((s) => s.deviceId as string)).size,
          summary: summarize(samples.map((s) => s.value)),
          baselineModelVersion: BASELINE_MODEL_VERSION,
          schemaVersion: 1,
        }),
      );
    }
  }

  return frozen({
    ok: true as const,
    baselines: frozenArray(baselines),
    unresolvedDevices: frozenArray([...unresolved].sort().map((id) => id as DeviceId)),
  });
}

// ---------------------------------------------------------------------------
// Window helper (shared with the anomaly detector)
// ---------------------------------------------------------------------------

/** The ISO bounds of a rolling window: (windowStart, windowEnd]. */
export function windowBounds(window: BaselineWindow): {
  readonly windowStart: string;
  readonly windowEnd: string;
} {
  const endMs = parseIsoMs(window.asOf);
  return frozen({
    windowStart: toIsoUtc(endMs - window.windowMs),
    windowEnd: toIsoUtc(endMs),
  });
}
