/**
 * @fleetos/workloads — D2: Requirement vectors.
 *
 * "A Workload Profile describes what a role/process requires. Observed
 * factors can include application set/versions, CPU/GPU/RAM/storage/
 * network demand, working hours, power dependence, environment where
 * lawful, travel/office/home distribution, peripherals, security
 * classification, downtime cost and repair/failure outcomes." —
 * `spec/ARCHITECTURE.md` § Workload Intelligence.
 *
 * This module defines the COMPARABLE half of those factors: the
 * `RequirementVector` — ten typed, unit-normalized dimensions in [0, 1].
 * Discrete, checkable requirements (applications, environments,
 * peripherals, classification) live in `constraints.ts` — the vector is
 * the soft score, the constraints are the hard gates, and the two are
 * NEVER conflated.
 *
 * Unit normalization follows W011's pattern: raw engineering units
 * (GB, Mbps, minutes, USD, counts) map onto [0, 1] through FROZEN,
 * documented anchor tables with deterministic piecewise-linear
 * interpolation and clamping. No ML, no curve fitting — the anchors are
 * the versioned normalization contract.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads.
 */

import { frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The requirement-vector schema version. Bumped when a dimension is
 * added, removed, re-anchored, or re-semantics-ed. Recorded on every
 * vector; a new version never rewrites stored profiles.
 */
export const REQUIREMENT_VECTOR_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * The ten comparable requirement dimensions. Each is a normalized value
 * in [0, 1] where 0 means "no observed demand" and 1 means "maximum
 * observed demand" under the anchor tables below.
 *
 * Mapping from the spec's observed factors:
 *   - cpuDemand              <- CPU demand (sustained utilization)
 *   - gpuDemand              <- GPU demand (accelerated compute)
 *   - memoryDemand           <- RAM demand
 *   - storageDemand          <- storage demand
 *   - networkDemand          <- network demand
 *   - powerDependence        <- power dependence (unplugged runtime need)
 *   - mobilityDemand         <- travel/office/home distribution (offsite share)
 *   - peripheralDemand       <- peripherals (count/variety)
 *   - securityDemand         <- security classification (soft score; the
 *                               hard classification gate is a constraint)
 *   - downtimeSensitivity    <- downtime cost
 *
 * "Repair/failure outcomes" are HISTORICAL results — they feed Arena
 * learning experiments (W050B), not requirement vectors; documented as a
 * later-wave seam in the package README.
 */
export const REQUIREMENT_DIMENSIONS = Object.freeze([
  "cpuDemand",
  "gpuDemand",
  "memoryDemand",
  "storageDemand",
  "networkDemand",
  "powerDependence",
  "mobilityDemand",
  "peripheralDemand",
  "securityDemand",
  "downtimeSensitivity",
] as const);

/** The dimension name type (closed set). */
export type RequirementDimension = (typeof REQUIREMENT_DIMENSIONS)[number];

/** The canonical dimension order (stable iteration, deterministic ids). */
export const REQUIREMENT_DIMENSION_COUNT = REQUIREMENT_DIMENSIONS.length;

// ---------------------------------------------------------------------------
// Security classification (spec observed factor)
// ---------------------------------------------------------------------------

/**
 * The security classification of the workload's data/environment (the
 * spec's "security classification" observed factor). The ordering below
 * is STRICT: a candidate must support AT LEAST the required level.
 */
export const CLASSIFICATION_ORDER = Object.freeze([
  "unclassified",
  "internal",
  "confidential",
  "restricted",
] as const);

/** The security classification levels (ordered). */
export type SecurityClassification = (typeof CLASSIFICATION_ORDER)[number];

/**
 * The soft-score mapping from a classification level to the
 * `securityDemand` vector dimension. Deterministic enum mapping — part
 * of the versioned normalization contract. The HARD gate (a candidate
 * must support at least the required classification) is a constraint
 * (see `constraints.ts`); this mapping only feeds the comparable score.
 */
export const CLASSIFICATION_SECURITY_DEMAND: Readonly<Record<SecurityClassification, number>> = frozen({
  unclassified: 0.1,
  internal: 0.35,
  confidential: 0.65,
  restricted: 0.9,
});

/**
 * Pure mapping: classification level -> normalized securityDemand.
 * Unknown levels map to the most demanding level (fail-closed scoring).
 *
 * @param classification the classification level
 * @returns the normalized security demand in [0, 1]
 */
export function classificationToSecurityDemand(
  classification: SecurityClassification,
): number {
  const demand = CLASSIFICATION_SECURITY_DEMAND[classification];
  return demand === undefined ? CLASSIFICATION_SECURITY_DEMAND.restricted : demand;
}

/**
 * Pure ordering check: does `supported` meet or exceed `required`?
 *
 * @param required the required classification level
 * @param supported the supported classification level
 * @returns true when supported >= required in CLASSIFICATION_ORDER
 */
export function classificationMeets(
  required: SecurityClassification,
  supported: SecurityClassification,
): boolean {
  return CLASSIFICATION_ORDER.indexOf(supported) >= CLASSIFICATION_ORDER.indexOf(required);
}

// ---------------------------------------------------------------------------
// The vector
// ---------------------------------------------------------------------------

/**
 * A typed, unit-normalized, comparable requirement vector. Every
 * dimension carries a value in [0, 1]; `confidence` records the fraction
 * of dimensions that were backed by an observed factor at construction
 * time (a vector built from an empty observation set is all-zero with
 * confidence 0 — honest, never guessed).
 */
export interface RequirementVector {
  /** Schema version of the vector shape (see REQUIREMENT_VECTOR_VERSION). */
  readonly vectorVersion: number;
  /** The normalized dimension values, each in [0, 1]. */
  readonly values: Readonly<Record<RequirementDimension, number>>;
  /** Coverage confidence in [0, 1]: observed dimensions / all dimensions. */
  readonly confidence: number;
}

/**
 * The result of structural vector validation. Tagged union; never throws.
 */
export type RequirementVectorValidation =
  | { ok: true }
  | { ok: false; readonly failures: readonly { readonly dimension: RequirementDimension | "vector"; readonly reason: string }[] };

/**
 * Pure structural validation of a requirement vector: version must match
 * the current schema, confidence must be a finite number in [0, 1], and
 * every dimension must be present, finite, and in [0, 1].
 *
 * @param vector the vector to validate
 * @returns a tagged validation result
 */
export function validateRequirementVector(vector: RequirementVector): RequirementVectorValidation {
  const failures: { dimension: RequirementDimension | "vector"; reason: string }[] = [];
  if (typeof vector !== "object" || vector === null) {
    return { ok: false, failures: [{ dimension: "vector", reason: "not_an_object" }] };
  }
  if (vector.vectorVersion !== REQUIREMENT_VECTOR_VERSION) {
    failures.push({ dimension: "vector", reason: "unsupported_version" });
  }
  const confidence: unknown = vector.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    failures.push({ dimension: "vector", reason: "confidence_out_of_range" });
  }
  const values: unknown = vector.values;
  if (typeof values !== "object" || values === null) {
    failures.push({ dimension: "vector", reason: "values_missing" });
    return { ok: false, failures };
  }
  for (const dimension of REQUIREMENT_DIMENSIONS) {
    const value: unknown = (values as Readonly<Record<string, unknown>>)[dimension];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      failures.push({ dimension, reason: "not_finite_number" });
    } else if (value < 0 || value > 1) {
      failures.push({ dimension, reason: "out_of_range" });
    }
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Unit normalization (W011's pattern: frozen anchor tables)
// ---------------------------------------------------------------------------

/** A single normalization anchor: [rawValue, normalizedValue]. */
export type NormalizationAnchor = readonly [number, number];

/**
 * The frozen anchor tables for raw-unit normalization. Piecewise-linear
 * between anchors, clamped outside the anchor range. These tables ARE the
 * versioned normalization contract (`REQUIREMENT_VECTOR_VERSION` covers
 * them): changing an anchor is a versioned change.
 */
export const NORMALIZATION_ANCHORS = frozen({
  /** Sustained RAM need, in GB. */
  memoryGb: frozen([
    [0, 0],
    [8, 0.3],
    [16, 0.5],
    [32, 0.7],
    [64, 0.85],
    [128, 1],
  ] as readonly NormalizationAnchor[]),
  /** Working-set storage need, in GB. */
  storageGb: frozen([
    [0, 0],
    [64, 0.2],
    [256, 0.4],
    [512, 0.55],
    [1024, 0.7],
    [4096, 1],
  ] as readonly NormalizationAnchor[]),
  /** Sustained network demand, in Mbps. */
  networkMbps: frozen([
    [0, 0],
    [10, 0.25],
    [100, 0.5],
    [500, 0.7],
    [1000, 0.85],
    [10000, 1],
  ] as readonly NormalizationAnchor[]),
  /** Required unplugged runtime, in minutes (power dependence). */
  unpluggedMinutes: frozen([
    [0, 0],
    [30, 0.3],
    [120, 0.55],
    [480, 0.8],
    [960, 1],
  ] as readonly NormalizationAnchor[]),
  /** Distinct required peripherals, by count. */
  peripheralCount: frozen([
    [0, 0],
    [1, 0.3],
    [3, 0.55],
    [5, 0.75],
    [8, 1],
  ] as readonly NormalizationAnchor[]),
  /** Cost of one hour of downtime, in USD. */
  downtimeCostPerHourUsd: frozen([
    [0, 0],
    [100, 0.3],
    [1000, 0.55],
    [10000, 0.8],
    [100000, 1],
  ] as readonly NormalizationAnchor[]),
  /** Utilization ratios and offsite fractions are already in [0, 1]. */
  unitRatio: frozen([
    [0, 0],
    [1, 1],
  ] as readonly NormalizationAnchor[]),
});

/**
 * Deterministic piecewise-linear interpolation over an anchor table,
 * clamped to the first/last anchor outside the table range. Pure.
 *
 * @param anchors the anchor table (ascending raw values)
 * @param raw the raw engineering-unit value
 * @returns the normalized value in [0, 1]
 */
export function interpolateAnchors(
  anchors: readonly NormalizationAnchor[],
  raw: number,
): number {
  if (anchors.length === 0) return 0;
  const first = anchors[0] as NormalizationAnchor;
  const last = anchors[anchors.length - 1] as NormalizationAnchor;
  if (!Number.isFinite(raw)) return 0;
  if (raw <= first[0]) return first[1];
  if (raw >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const upper = anchors[i] as NormalizationAnchor;
    const lower = anchors[i - 1] as NormalizationAnchor;
    if (raw <= upper[0]) {
      const span = upper[0] - lower[0];
      if (span <= 0) return upper[1];
      const fraction = (raw - lower[0]) / span;
      return lower[1] + fraction * (upper[1] - lower[1]);
    }
  }
  return last[1];
}

/**
 * The raw, engineering-unit factor inputs observed for a workload. Every
 * field is OPTIONAL: an absent field leaves its dimension at 0 (no
 * observed demand) and lowers the vector's coverage confidence. Hard
 * guarantees never live here — they live in `WorkloadConstraints`.
 */
export interface RawRequirementInput {
  /** Sustained CPU utilization ratio in [0, 1]. */
  readonly cpuUtilization?: number;
  /** Sustained GPU utilization ratio in [0, 1]. */
  readonly gpuUtilization?: number;
  /** Minimum working RAM, in GB (>= 0). */
  readonly minMemoryGb?: number;
  /** Minimum working storage, in GB (>= 0). */
  readonly minStorageGb?: number;
  /** Sustained network demand, in Mbps (>= 0). */
  readonly networkMbps?: number;
  /** Required unplugged runtime, in minutes (>= 0). */
  readonly unpluggedMinutes?: number;
  /** Offsite working share (travel + home) in [0, 1]. */
  readonly offsiteFraction?: number;
  /** Distinct required peripherals, by count (>= 0). */
  readonly peripheralCount?: number;
  /** Required battery-backed uptime sensitivity from downtime cost (USD/hour, >= 0). */
  readonly downtimeCostPerHourUsd?: number;
  /** Security classification of the workload's data/environment. */
  readonly classification?: SecurityClassification;
}

/** The result of raw-input normalization. Tagged union; never throws. */
export type NormalizationResult =
  | { ok: true; vector: RequirementVector }
  | { ok: false; failures: readonly { readonly field: string; readonly reason: string }[] };

/**
 * Normalize raw engineering-unit factors into a `RequirementVector`.
 *
 * Deterministic: the same raw input produces the byte-identical vector
 * every run. Dimensions without a raw input are 0; the confidence is the
 * fraction of the ten dimensions that had an input.
 *
 * @param raw the raw observed factors
 * @returns a tagged normalization result
 */
export function normalizeRequirements(raw: RawRequirementInput): NormalizationResult {
  const failures: { field: string; reason: string }[] = [];
  function ratio(field: string, value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      failures.push({ field, reason: "not_in_unit_range" });
      return undefined;
    }
    return value;
  }
  function quantity(field: string, value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      failures.push({ field, reason: "not_non_negative_number" });
      return undefined;
    }
    return value;
  }

  const cpu = ratio("/cpuUtilization", raw?.cpuUtilization);
  const gpu = ratio("/gpuUtilization", raw?.gpuUtilization);
  const offsite = ratio("/offsiteFraction", raw?.offsiteFraction);
  const memory = quantity("/minMemoryGb", raw?.minMemoryGb);
  const storage = quantity("/minStorageGb", raw?.minStorageGb);
  const network = quantity("/networkMbps", raw?.networkMbps);
  const unplugged = quantity("/unpluggedMinutes", raw?.unpluggedMinutes);
  const peripherals = quantity("/peripheralCount", raw?.peripheralCount);
  const downtimeCost = quantity("/downtimeCostPerHourUsd", raw?.downtimeCostPerHourUsd);
  const classification = raw?.classification;
  if (
    classification !== undefined &&
    (typeof classification !== "string" ||
      !CLASSIFICATION_ORDER.includes(classification as SecurityClassification))
  ) {
    failures.push({ field: "/classification", reason: "unknown_classification" });
  }

  if (failures.length > 0) return { ok: false, failures };

  const provided = [
    cpu !== undefined,
    gpu !== undefined,
    memory !== undefined,
    storage !== undefined,
    network !== undefined,
    unplugged !== undefined,
    offsite !== undefined,
    peripherals !== undefined,
    classification !== undefined,
    downtimeCost !== undefined,
  ].filter(Boolean).length;

  return {
    ok: true,
    vector: frozen({
      vectorVersion: REQUIREMENT_VECTOR_VERSION,
      values: frozen({
        cpuDemand: cpu ?? 0,
        gpuDemand: gpu ?? 0,
        memoryDemand: memory === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, memory),
        storageDemand: storage === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.storageGb, storage),
        networkDemand: network === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.networkMbps, network),
        powerDependence: unplugged === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.unpluggedMinutes, unplugged),
        mobilityDemand: offsite ?? 0,
        peripheralDemand: peripherals === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.peripheralCount, peripherals),
        securityDemand: classification === undefined ? 0 : classificationToSecurityDemand(classification),
        downtimeSensitivity: downtimeCost === undefined ? 0 : interpolateAnchors(NORMALIZATION_ANCHORS.downtimeCostPerHourUsd, downtimeCost),
      }),
      confidence: provided / REQUIREMENT_DIMENSION_COUNT,
    }),
  };
}

// ---------------------------------------------------------------------------
// Comparison + score helpers (pure; no ML)
// ---------------------------------------------------------------------------

/** The per-dimension fit of an offered value against a required value. */
export interface DimensionFit {
  readonly dimension: RequirementDimension;
  /** The required (workload) value. */
  readonly required: number;
  /** The offered (candidate) value. */
  readonly offered: number;
  /**
   * Per-dimension satisfaction in [0, 1]: `min(1, offered / required)`
   * when required > 0, else 1 (no requirement is always satisfied).
   */
  readonly satisfaction: number;
}

/** The result of comparing an offered vector against a requirement vector. */
export interface VectorComparison {
  /** Per-dimension deltas: offered - required (>= 0 means covered). */
  readonly deltas: Readonly<Record<RequirementDimension, number>>;
  /** Dimensions where offered >= required, in canonical order. */
  readonly satisfied: readonly RequirementDimension[];
  /** Dimensions where offered < required, in canonical order. */
  readonly deficits: readonly RequirementDimension[];
  /** Per-dimension satisfaction detail, canonical order. */
  readonly dimensions: readonly DimensionFit[];
  /** Mean per-dimension satisfaction in [0, 1]. */
  readonly satisfaction: number;
  /** The lowest-satisfaction dimension (canonical-order tie-break). */
  readonly worstDimension: RequirementDimension | null;
}

/**
 * Compare an offered (candidate capability) vector against a required
 * (workload) vector. Pure and deterministic: per-dimension satisfaction
 * is `min(1, offered / required)` (required 0 -> 1), the aggregate is the
 * arithmetic mean, and the worst dimension tie-breaks by canonical order.
 *
 * @param requirement the workload's requirement vector
 * @param offered the candidate's capability vector
 * @returns the deterministic comparison result
 */
export function compareVectors(
  requirement: RequirementVector,
  offered: RequirementVector,
): VectorComparison {
  const dimensions: DimensionFit[] = [];
  const deltas: Record<string, number> = {};
  const satisfied: RequirementDimension[] = [];
  const deficits: RequirementDimension[] = [];
  for (const dimension of REQUIREMENT_DIMENSIONS) {
    const required = requirement.values[dimension];
    const offer = offered.values[dimension];
    const satisfaction = required <= 0 ? 1 : Math.min(1, offer / required);
    dimensions.push(frozen({ dimension, required, offered: offer, satisfaction }));
    deltas[dimension] = offer - required;
    if (offer >= required) satisfied.push(dimension);
    else deficits.push(dimension);
  }
  const satisfaction = dimensions.reduce((sum, d) => sum + d.satisfaction, 0) / dimensions.length;
  let worst: DimensionFit | undefined;
  for (const fit of dimensions) {
    if (worst === undefined || fit.satisfaction < worst.satisfaction) worst = fit;
  }
  return frozen({
    deltas: frozen(deltas as Readonly<Record<RequirementDimension, number>>),
    satisfied: frozenArray(satisfied),
    deficits: frozenArray(deficits),
    dimensions: frozenArray(dimensions),
    satisfaction,
    worstDimension: worst === undefined ? null : worst.dimension,
  });
}

/**
 * Compare two requirement vectors dimension-by-dimension (profile vs
 * profile — e.g. when merging or diffing workload profiles). Returns the
 * per-dimension deltas and the dimensions each side dominates. Pure.
 *
 * @param left the first vector
 * @param right the second vector
 * @returns per-dimension deltas (left - right) and dominance lists
 */
export function diffRequirementVectors(
  left: RequirementVector,
  right: RequirementVector,
): {
  readonly deltas: Readonly<Record<RequirementDimension, number>>;
  readonly leftDominates: readonly RequirementDimension[];
  readonly rightDominates: readonly RequirementDimension[];
  readonly equalDimensions: readonly RequirementDimension[];
} {
  const deltas: Record<string, number> = {};
  const leftDominates: RequirementDimension[] = [];
  const rightDominates: RequirementDimension[] = [];
  const equal: RequirementDimension[] = [];
  for (const dimension of REQUIREMENT_DIMENSIONS) {
    const delta = left.values[dimension] - right.values[dimension];
    deltas[dimension] = delta;
    if (delta > 0) leftDominates.push(dimension);
    else if (delta < 0) rightDominates.push(dimension);
    else equal.push(dimension);
  }
  return frozen({
    deltas: frozen(deltas as Readonly<Record<RequirementDimension, number>>),
    leftDominates: frozenArray(leftDominates),
    rightDominates: frozenArray(rightDominates),
    equalDimensions: frozenArray(equal),
  });
}
