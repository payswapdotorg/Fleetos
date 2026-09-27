/**
 * @fleetos/workloads — D2: discrete constraints + fit assessment.
 *
 * The soft score and the hard gate are NEVER conflated:
 *   - `RequirementVector` (requirement-vector.ts) is the comparable soft
 *     score — how demanding a workload is per dimension.
 *   - `WorkloadConstraints` (this module) is the hard gate — the
 *     checkable, discrete requirements a candidate MUST satisfy: the
 *     application set/versions, the environments where the workload may
 *     lawfully operate, the peripherals, and the security classification
 *     ceiling.
 *
 * `checkConstraints` is a pure pass/fail function with machine-stable
 * failure kinds; `assessFit` combines it with `compareVectors` into the
 * `FitAssessment` the recommendation engine (D3) consumes. No ML.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  RequirementVector,
  SecurityClassification,
  VectorComparison,
} from "./requirement-vector";
import { classificationMeets, compareVectors } from "./requirement-vector";
import { frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// Environments + peripherals
// ---------------------------------------------------------------------------

/**
 * The environments a workload may lawfully operate in (the spec's
 * "environment where lawful" observed factor — office/home/travel
 * distribution). A candidate must be usable in EVERY environment the
 * workload names.
 */
export const WORKLOAD_ENVIRONMENTS = [
  "office",
  "home",
  "travel",
  "field",
  "datacenter",
] as const;

/** A lawful operating environment. */
export type WorkloadEnvironment = (typeof WORKLOAD_ENVIRONMENTS)[number];

/**
 * The canonical peripheral kinds (the spec's "peripherals" observed
 * factor). Open string union: adapters may introduce additional kinds
 * (forward compatibility — unknown kinds are NOT errors, they simply
 * must be declared by a candidate to be satisfied).
 */
export type PeripheralKind =
  | "printer"
  | "scanner"
  | "external_display"
  | "dock"
  | "signature_pad"
  | "headset"
  | "webcam"
  | "numeric_keypad"
  | (string & {});

// ---------------------------------------------------------------------------
// Constraint shapes
// ---------------------------------------------------------------------------

/**
 * One required application (the spec's "application set/versions"
 * observed factor). `minVersion` uses a simple dotted-numeric comparison
 * (see `versionSatisfies`); absent means "any version".
 */
export interface ApplicationRequirement {
  /** Stable application identifier (e.g. "app.financial_suite"). */
  readonly appId: string;
  /** Minimum acceptable version (dotted numeric, e.g. "2026.1"). */
  readonly minVersion?: string;
}

/** A versioned application availability declared by a candidate. */
export interface CandidateApplication {
  readonly appId: string;
  /** The version the candidate provides (dotted numeric). */
  readonly version: string;
  /** True when a paid subscription must be provisioned for this app. */
  readonly subscriptionRequired?: boolean;
}

/**
 * The hard, checkable requirements of a workload profile. Every field is
 * optional; absent means "no constraint". All checks are pure and
 * deterministic.
 */
export interface WorkloadConstraints {
  /** Applications that must be available on the assigned target. */
  readonly requiredApplications?: readonly ApplicationRequirement[];
  /** Environments where the workload must lawfully be able to operate. */
  readonly environments?: readonly WorkloadEnvironment[];
  /** Peripherals the workload requires the target to support. */
  readonly peripherals?: readonly PeripheralKind[];
  /**
   * The minimum security classification the target must support (the
   * hard gate; the soft score lives on the vector's securityDemand).
   */
  readonly classification?: SecurityClassification;
}

// ---------------------------------------------------------------------------
// Version comparison (dotted numeric, deterministic)
// ---------------------------------------------------------------------------

/**
 * Parse a dotted-numeric version into comparable number tuples. Returns
 * null for malformed input (non-numeric segments) — callers fail closed.
 *
 * @param version the version string (e.g. "2026.1.3")
 * @returns the numeric segments, or null when malformed
 */
export function parseDottedVersion(version: string): readonly number[] | null {
  if (typeof version !== "string" || version.length === 0) return null;
  const parts = version.split(".");
  const segments: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    segments.push(Number.parseInt(part, 10));
  }
  return frozenArray(segments);
}

/**
 * Pure dotted-numeric comparison: does `available` satisfy `required`
 * (available >= required)? Missing segments compare as 0 ("2026" >=
 * "2026.0"). Malformed input fails CLOSED (returns false) — never
 * guessed.
 *
 * @param required the minimum required version
 * @param available the available version
 * @returns true when available >= required
 */
export function versionSatisfies(required: string, available: string): boolean {
  const left = parseDottedVersion(required);
  const right = parseDottedVersion(available);
  if (left === null || right === null) return false;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Constraint checking
// ---------------------------------------------------------------------------

/** Machine-stable constraint failure kinds. */
export type ConstraintFailureKind =
  | "missing_application"
  | "version_below_minimum"
  | "environment_unsupported"
  | "missing_peripheral"
  | "classification_insufficient";

/** One failed constraint, with the machine kind and the offending values. */
export type ConstraintFailure =
  | { readonly kind: "missing_application"; readonly appId: string; readonly minVersion?: string }
  | {
      readonly kind: "version_below_minimum";
      readonly appId: string;
      readonly minVersion: string;
      readonly availableVersion: string;
    }
  | { readonly kind: "environment_unsupported"; readonly environment: WorkloadEnvironment }
  | { readonly kind: "missing_peripheral"; readonly peripheral: PeripheralKind }
  | {
      readonly kind: "classification_insufficient";
      readonly required: SecurityClassification;
      readonly supported: SecurityClassification;
    };

/** The result of a constraint check. Tagged union; never throws. */
export interface ConstraintCheck {
  /** True when every constraint is satisfied. */
  readonly satisfied: boolean;
  /** The failures, in deterministic check order (apps, envs, periph, class). */
  readonly failures: readonly ConstraintFailure[];
}

/**
 * Check a workload's hard constraints against a candidate's declared
 * constraints. Pure and deterministic; evaluation order is fixed
 * (applications by input order, environments, peripherals,
 * classification) so the failure list is stable.
 *
 * @param constraints the workload's hard requirements
 * @param candidate the candidate's declared support
 * @returns the tagged check result
 */
export function checkConstraints(
  constraints: WorkloadConstraints,
  candidate: CandidateConstraints,
): ConstraintCheck {
  const failures: ConstraintFailure[] = [];

  const requiredApps = constraints.requiredApplications ?? [];
  const availableApps = candidate.availableApplications ?? [];
  for (const required of requiredApps) {
    const available = availableApps.find((a) => a.appId === required.appId);
    if (available === undefined) {
      failures.push(
        frozen({
          kind: "missing_application" as const,
          appId: required.appId,
          ...(required.minVersion !== undefined ? { minVersion: required.minVersion } : {}),
        }),
      );
      continue;
    }
    if (required.minVersion !== undefined && !versionSatisfies(required.minVersion, available.version)) {
      failures.push(
        frozen({
          kind: "version_below_minimum" as const,
          appId: required.appId,
          minVersion: required.minVersion,
          availableVersion: available.version,
        }),
      );
    }
  }

  const requiredEnvironments = constraints.environments ?? [];
  const supportedEnvironments = candidate.environments ?? [];
  for (const environment of requiredEnvironments) {
    if (!supportedEnvironments.includes(environment)) {
      failures.push(frozen({ kind: "environment_unsupported" as const, environment }));
    }
  }

  const requiredPeripherals = constraints.peripherals ?? [];
  const supportedPeripherals = candidate.peripherals ?? [];
  for (const peripheral of requiredPeripherals) {
    if (!supportedPeripherals.includes(peripheral)) {
      failures.push(frozen({ kind: "missing_peripheral" as const, peripheral }));
    }
  }

  if (
    constraints.classification !== undefined &&
    !classificationMeets(constraints.classification, candidate.maxSecurityClassification)
  ) {
    failures.push(
      frozen({
        kind: "classification_insufficient" as const,
        required: constraints.classification,
        supported: candidate.maxSecurityClassification,
      }),
    );
  }

  return frozen({ satisfied: failures.length === 0, failures: frozenArray(failures) });
}

// ---------------------------------------------------------------------------
// Candidate capabilities + fit assessment
// ---------------------------------------------------------------------------

/**
 * The constraint-facing support a candidate (device class or procurement
 * offering) declares about itself. Candidates are INJECTED inputs — they
 * are capability descriptions supplied by the caller (e.g. a device
 * catalog), not tenant-scoped fleet records.
 */
export interface CandidateConstraints {
  /** Applications available on the candidate (with versions). */
  readonly availableApplications?: readonly CandidateApplication[];
  /** Environments the candidate can lawfully operate in. */
  readonly environments?: readonly WorkloadEnvironment[];
  /** Peripherals the candidate supports. */
  readonly peripherals?: readonly PeripheralKind[];
  /** The highest security classification the candidate may handle. */
  readonly maxSecurityClassification: SecurityClassification;
}

/**
 * A full candidate capability declaration: the soft-score capability
 * vector plus the hard constraint support. This is the INJECTED input of
 * the recommendation engine (D3).
 */
export interface CandidateCapabilities extends CandidateConstraints {
  /** Stable candidate identifier (e.g. "class.engineering_workstation"). */
  readonly candidateId: string;
  /** Human-readable label. */
  readonly label: string;
  /** The candidate's capability vector (same normalization as workloads). */
  readonly vector: RequirementVector;
  /**
   * True when fielding this candidate requires a PURCHASE (the
   * recommendation becomes procurement-oriented and carries a
   * ProcurementIntent draft). Absent/false means the tenant already
   * fields this class (advisory device-class recommendation).
   */
  readonly procurementRequired?: boolean;
}

/**
 * The combined fit of a candidate against a workload: the vector
 * comparison (soft score), the constraint check (hard gate), and the
 * threshold verdict. Pure and deterministic.
 */
export interface FitAssessment {
  /** Mean per-dimension satisfaction in [0, 1] (see compareVectors). */
  readonly satisfaction: number;
  /** The per-dimension detail. */
  readonly comparison: VectorComparison;
  /** The constraint check result. */
  readonly constraintCheck: ConstraintCheck;
  /** True when constraints pass AND satisfaction >= threshold. */
  readonly meetsThreshold: boolean;
  /** The threshold applied (echoed for evidence). */
  readonly threshold: number;
}

/**
 * Assess the overall fit of a candidate against a workload's requirement
 * vector + constraints. Pure and deterministic: soft score and hard gate
 * are computed independently and never traded off against each other.
 *
 * @param requirements the workload's requirement vector
 * @param constraints the workload's hard constraints
 * @param candidate the candidate's capabilities
 * @param threshold the satisfaction threshold in [0, 1)
 * @returns the deterministic fit assessment
 */
export function assessFit(
  requirements: RequirementVector,
  constraints: WorkloadConstraints,
  candidate: CandidateCapabilities,
  threshold: number,
): FitAssessment {
  const comparison = compareVectors(requirements, candidate.vector);
  const constraintCheck = checkConstraints(constraints, candidate);
  const meetsThreshold = constraintCheck.satisfied && comparison.satisfaction >= threshold;
  return frozen({
    satisfaction: comparison.satisfaction,
    comparison,
    constraintCheck,
    meetsThreshold,
    threshold,
  });
}
