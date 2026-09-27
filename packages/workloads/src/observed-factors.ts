/**
 * @fleetos/workloads — observed-factor derivation (the observations edge).
 *
 * `spec/MODULE-DEPENDENCY-MAP.md`: `workloads -> devices, observations,
 * audit`. The observations edge is honored HERE, with real code: observed
 * factors are derived from canonical `Observation` records (the FROZEN
 * `@fleetos/contracts` shape — the device-model package itself is
 * worker-b's lane and is never imported; the frozen contracts shape is
 * the module boundary).
 *
 * Derivation is deterministic and tolerant (forward compatibility, the
 * W021 signal-model convention): observations of unknown kinds or
 * unmapped payload shapes are SKIPPED with an enumerable machine reason —
 * never errors. Aggregation is a nearest-rank p90 fold per dimension (the
 * W021 baseline convention: demand is sustained high usage, so the 90th
 * percentile of observed samples — always an observed sample, never
 * interpolated).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: the window anchor is injected.
 */

import type { Observation } from "@fleetos/contracts";
import type { RequirementDimension, RequirementVector } from "./requirement-vector";
import {
  NORMALIZATION_ANCHORS,
  REQUIREMENT_DIMENSIONS,
  REQUIREMENT_DIMENSION_COUNT,
  REQUIREMENT_VECTOR_VERSION,
  classificationToSecurityDemand,
  interpolateAnchors,
} from "./requirement-vector";
import type { SecurityClassification } from "./requirement-vector";
import { frozen, frozenArray, looksLikeIso, parseIsoMs } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The observed-factor derivation model version. Bumped when a payload
 * field mapping is added, removed, or re-anchored. Recorded on the
 * aggregation output.
 */
export const OBSERVED_FACTOR_MODEL_VERSION = 1 as const;

/**
 * The observation kind this module consumes: `device.workload` (from the
 * frozen contracts' canonical observation kinds). All other kinds are
 * skipped with `unknown_kind`.
 */
export const WORKLOAD_OBSERVATION_KIND = "device.workload" as const;

// ---------------------------------------------------------------------------
// Samples + skip reasons
// ---------------------------------------------------------------------------

/**
 * One observed factor sample: a normalized demand value for one
 * dimension, correlated to the observation it came from.
 */
export interface ObservedFactorSample {
  readonly dimension: RequirementDimension;
  /** The normalized value in [0, 1]. */
  readonly value: number;
  /** The source observation id (evidence link). */
  readonly observationId: string;
  /** The source observation's observedAt timestamp. */
  readonly observedAt: string;
  /**
   * Confidence of the mapping: 1.0 for direct reads (utilization ratios,
   * enum mappings), 0.9 for anchor-normalized quantities (the W021
   * convention: computed values carry slightly less confidence than
   * direct reads).
   */
  readonly confidence: number;
}

/** Enumerable, machine-stable skip reasons. */
export type FactorSkipReason =
  | "unknown_kind"
  | "bad_payload"
  | "outside_window"
  | "field_out_of_range";

/** One skipped observation, with the machine reason. */
export interface SkippedObservation {
  readonly observationId: string;
  readonly reason: FactorSkipReason;
}

/**
 * The v1 `device.workload` payload shape (documented contract of the
 * device agent's workload observation; schemaVersion 1). Every field is
 * optional; absent fields contribute no samples.
 */
export interface DeviceWorkloadPayload {
  /** Sustained CPU utilization ratio in [0, 1]. */
  readonly cpuUtilization?: number;
  /** Sustained GPU utilization ratio in [0, 1]. */
  readonly gpuUtilization?: number;
  /** Sustained RAM utilization ratio in [0, 1] (normalized RAM demand proxy). */
  readonly memoryUtilization?: number;
  /** Storage utilization ratio in [0, 1]. */
  readonly storageUtilization?: number;
  /** Sustained network demand, in Mbps (>= 0). */
  readonly networkMbps?: number;
  /** Minutes the workload ran unplugged in the observed period (>= 0). */
  readonly unpluggedMinutes?: number;
  /** Offsite working share in [0, 1] (travel + home distribution). */
  readonly offsiteFraction?: number;
  /** Distinct peripherals in use, by count (>= 0). */
  readonly peripheralCount?: number;
  /** Security classification of the handled data/environment. */
  readonly classification?: SecurityClassification;
  /** Cost of one hour of downtime, in USD (>= 0). */
  readonly downtimeCostPerHourUsd?: number;
}

/** The derivation window: `(asOf - windowMs, asOf]` — inclusive end. */
export interface DerivationWindow {
  /** Injected window anchor ("now" — never read from a clock). */
  readonly asOf: string;
  /** Window length in milliseconds (> 0). */
  readonly windowMs: number;
}

/** The result of factor derivation. Tagged union; never throws. */
export type FactorDerivationResult =
  | {
      readonly ok: true;
      readonly factors: readonly ObservedFactorSample[];
      readonly skipped: readonly SkippedObservation[];
      readonly modelVersion: number;
    }
  | { readonly ok: false; readonly reason: "invalid_window" };

// ---------------------------------------------------------------------------
// Payload parsing (untyped boundary -> typed payload; no `any`)
// ---------------------------------------------------------------------------

/** Read a finite number field from an untyped payload record. */
function readNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value: unknown = record[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/** Read a string field from an untyped payload record. */
function readString(record: Record<string, unknown>, field: string): string | undefined {
  const value: unknown = record[field];
  if (typeof value === "string") return value;
  return undefined;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive observed factor samples from canonical observations. Only
 * `device.workload` observations (schema-agnostic; payload shape above)
 * contribute factors; everything else is skipped with a machine reason.
 * Pure and deterministic: the same observations + window produce the
 * same samples in the same order.
 *
 * @param observations the canonical observation history (frozen contracts shape)
 * @param window the rolling window, anchored at an injected `asOf`
 * @returns the tagged derivation result
 */
export function deriveObservedFactors(
  observations: readonly Observation[],
  window: DerivationWindow,
): FactorDerivationResult {
  if (
    typeof window?.asOf !== "string" ||
    !looksLikeIso(window.asOf) ||
    typeof window?.windowMs !== "number" ||
    !Number.isFinite(window.windowMs) ||
    window.windowMs <= 0
  ) {
    return { ok: false, reason: "invalid_window" };
  }
  const asOfMs = parseIsoMs(window.asOf);
  if (Number.isNaN(asOfMs)) return { ok: false, reason: "invalid_window" };
  const windowStartMs = asOfMs - window.windowMs;

  const factors: ObservedFactorSample[] = [];
  const skipped: SkippedObservation[] = [];

  for (const observation of observations) {
    if (observation === undefined || observation === null) continue;
    if (observation.kind !== WORKLOAD_OBSERVATION_KIND) {
      skipped.push(frozen({ observationId: observation.id, reason: "unknown_kind" as const }));
      continue;
    }
    const observedAtMs = parseIsoMs(observation.observedAt);
    if (Number.isNaN(observedAtMs) || observedAtMs <= windowStartMs || observedAtMs > asOfMs) {
      skipped.push(frozen({ observationId: observation.id, reason: "outside_window" as const }));
      continue;
    }
    if (typeof observation.payload !== "object" || observation.payload === null) {
      skipped.push(frozen({ observationId: observation.id, reason: "bad_payload" as const }));
      continue;
    }
    const payload = observation.payload as Record<string, unknown>;

    /** Push one sample, or record an out-of-range skip. */
    function sample(
      dimension: RequirementDimension,
      value: number | undefined,
      confidence: number,
      inRange: boolean,
    ): void {
      if (value === undefined) return;
      if (!inRange) {
        skipped.push(frozen({ observationId: observation.id, reason: "field_out_of_range" as const }));
        return;
      }
      factors.push(
        frozen({
          dimension,
          value,
          observationId: observation.id,
          observedAt: observation.observedAt,
          confidence,
        }),
      );
    }

    // Direct ratio reads (confidence 1.0).
    const cpu = readNumber(payload, "cpuUtilization");
    sample("cpuDemand", cpu, 1.0, cpu === undefined || (cpu >= 0 && cpu <= 1));
    const gpu = readNumber(payload, "gpuUtilization");
    sample("gpuDemand", gpu, 1.0, gpu === undefined || (gpu >= 0 && gpu <= 1));
    const memoryUtil = readNumber(payload, "memoryUtilization");
    sample("memoryDemand", memoryUtil, 1.0, memoryUtil === undefined || (memoryUtil >= 0 && memoryUtil <= 1));
    const offsite = readNumber(payload, "offsiteFraction");
    sample("mobilityDemand", offsite, 1.0, offsite === undefined || (offsite >= 0 && offsite <= 1));

    // Anchor-normalized quantities (confidence 0.9).
    const storageUtil = readNumber(payload, "storageUtilization");
    sample("storageDemand", storageUtil, 0.9, storageUtil === undefined || (storageUtil >= 0 && storageUtil <= 1));
    const network = readNumber(payload, "networkMbps");
    sample(
      "networkDemand",
      network === undefined ? undefined : interpolateAnchors(NORMALIZATION_ANCHORS.networkMbps, network),
      0.9,
      network === undefined || network >= 0,
    );
    const unplugged = readNumber(payload, "unpluggedMinutes");
    sample(
      "powerDependence",
      unplugged === undefined ? undefined : interpolateAnchors(NORMALIZATION_ANCHORS.unpluggedMinutes, unplugged),
      0.9,
      unplugged === undefined || unplugged >= 0,
    );
    const peripherals = readNumber(payload, "peripheralCount");
    sample(
      "peripheralDemand",
      peripherals === undefined ? undefined : interpolateAnchors(NORMALIZATION_ANCHORS.peripheralCount, peripherals),
      0.9,
      peripherals === undefined || peripherals >= 0,
    );
    const downtimeCost = readNumber(payload, "downtimeCostPerHourUsd");
    sample(
      "downtimeSensitivity",
      downtimeCost === undefined
        ? undefined
        : interpolateAnchors(NORMALIZATION_ANCHORS.downtimeCostPerHourUsd, downtimeCost),
      0.9,
      downtimeCost === undefined || downtimeCost >= 0,
    );

    // Enum mapping (confidence 1.0; unknown enum values are skipped).
    const classification = readString(payload, "classification");
    if (classification !== undefined) {
      if (
        classification === "unclassified" ||
        classification === "internal" ||
        classification === "confidential" ||
        classification === "restricted"
      ) {
        factors.push(
          frozen({
            dimension: "securityDemand" as const,
            value: classificationToSecurityDemand(classification),
            observationId: observation.id,
            observedAt: observation.observedAt,
            confidence: 1.0,
          }),
        );
      } else {
        skipped.push(frozen({ observationId: observation.id, reason: "field_out_of_range" as const }));
      }
    }

    // A payload with NO recognized field is a bad payload (shape miss).
    if (factors.every((f) => f.observationId !== observation.id) && skipped.every((s) => s.observationId !== observation.id)) {
      skipped.push(frozen({ observationId: observation.id, reason: "bad_payload" as const }));
    }
  }

  return {
    ok: true,
    factors: frozenArray(factors),
    skipped: frozenArray(skipped),
    modelVersion: OBSERVED_FACTOR_MODEL_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** The aggregation output: the vector plus per-dimension sample counts. */
export interface FactorAggregation {
  readonly vector: RequirementVector;
  /** How many samples fed each dimension (0 for uncovered dimensions). */
  readonly sampleCounts: Readonly<Record<RequirementDimension, number>>;
  readonly modelVersion: number;
}

/**
 * Nearest-rank percentile (the W021 baseline convention): the value at
 * index `ceil(p/100 * n) - 1` of the ascending-sorted samples — always an
 * observed sample, never interpolated. Pure.
 *
 * @param values the sample values (unsorted input is fine)
 * @param p the percentile in (0, 100]
 * @returns the nearest-rank percentile
 */
export function nearestRankPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/**
 * Aggregate observed factor samples into a requirement vector. Per
 * dimension: the p90 (nearest rank) of its samples, or 0 when uncovered.
 * The vector's confidence is the fraction of dimensions with at least one
 * sample. Pure and deterministic; sample ORDER never affects the result.
 *
 * @param factors the derived samples (any order)
 * @returns the aggregation (always ok — an empty input yields an
 *   all-zero vector with confidence 0)
 */
export function aggregateObservedFactors(
  factors: readonly ObservedFactorSample[],
): FactorAggregation {
  const byDimension = new Map<RequirementDimension, number[]>();
  for (const dimension of REQUIREMENT_DIMENSIONS) {
    byDimension.set(dimension, []);
  }
  for (const factor of factors) {
    if (!byDimension.has(factor.dimension)) continue; // unknown dimension — ignore
    byDimension.get(factor.dimension)?.push(factor.value);
  }

  const values: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let covered = 0;
  for (const dimension of REQUIREMENT_DIMENSIONS) {
    const samples = byDimension.get(dimension) ?? [];
    counts[dimension] = samples.length;
    if (samples.length > 0) covered += 1;
    values[dimension] = nearestRankPercentile(samples, 90);
  }

  return frozen({
    vector: frozen({
      vectorVersion: REQUIREMENT_VECTOR_VERSION,
      values: frozen(values as Readonly<Record<RequirementDimension, number>>),
      confidence: covered / REQUIREMENT_DIMENSION_COUNT,
    }),
    sampleCounts: frozen(counts as Readonly<Record<RequirementDimension, number>>),
    modelVersion: OBSERVED_FACTOR_MODEL_VERSION,
  });
}
