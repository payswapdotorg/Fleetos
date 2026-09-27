/**
 * @fleetos/integration-adcos — D1: the typed, provider-neutral ADCOS
 * connectivity request model.
 *
 * Per `spec/integration/ADCOS.md`, the FleetOS -> ADCOS direction
 * carries: "ConnectivityIntent containing tenant, target device/workload,
 * required properties, hard constraints, duration, budget/policy and
 * security requirements."
 *
 * The frozen `ConnectivityIntentPayload` (`sourceDeviceId?`,
 * `targetDeviceId?`, `outcome`) supplies the intent-side facet (consumed
 * VERBATIM — never re-declared, never widened); the richer requirement
 * facets (properties, constraints, duration, budget/policy refs, security
 * requirements, optional workload ref) are supplied by the caller as a
 * typed `ConnectivityIntentRequirements` value and validated here with
 * machine-stable refusal reasons — never a guess, never a silent
 * default.
 *
 * Every shape in this module is PROVIDER-NEUTRAL plain data
 * (`spec/ARCHITECTURE-LOCK.md` items 7-8): no provider topology, no
 * native credentials, no provider SDK objects.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { IntentId, TenantId } from "@fleetos/contracts";
import type { CanonicalConnectivityOutcome } from "./outcomes";
import { compact, frozen, frozenArray, looksLikeIso, parseIsoMs, sortedUnique } from "./internal";

// ---------------------------------------------------------------------------
// Requirement facets (caller-supplied, validated)
// ---------------------------------------------------------------------------

/**
 * The target refs of a connectivity request. `sourceDeviceId` /
 * `targetDeviceId` are the FROZEN payload's device refs, consumed
 * verbatim; `workloadId` is an optional workload ref supplied with the
 * requirements (the workload the connectivity serves). At least one ref
 * must be present — a connectivity request with nothing to connect is
 * malformed.
 */
export interface ConnectivityTargets {
  /** The frozen payload's `sourceDeviceId`, verbatim (optional). */
  readonly sourceDeviceId?: string;
  /** The frozen payload's `targetDeviceId`, verbatim (optional). */
  readonly targetDeviceId?: string;
  /** An optional workload ref supplied with the requirements. */
  readonly workloadId?: string;
}

/** The connectivity isolation requirement. */
export type ConnectivityIsolation = "private" | "public" | "any";

/** The connectivity redundancy requirement. */
export type ConnectivityRedundancy = "none" | "path_redundant" | "device_redundant";

/**
 * The required properties of a connectivity request (the
 * quality-of-service facet). All numeric bounds are positive finite
 * numbers; `isolation` and `redundancy` are required closed unions.
 */
export interface ConnectivityProperties {
  /** Upper bound on round-trip latency, in milliseconds (> 0). */
  readonly maxLatencyMs?: number;
  /** Lower bound on throughput, in megabits per second (> 0). */
  readonly minThroughputMbps?: number;
  /** Availability target in (0, 1] (e.g. 0.999). */
  readonly availabilityTarget?: number;
  /** The isolation requirement (required). */
  readonly isolation: ConnectivityIsolation;
  /** The redundancy requirement (required). */
  readonly redundancy: ConnectivityRedundancy;
}

/**
 * The hard constraints of a connectivity request — the conditions the
 * provider MUST satisfy (never best-effort). Set-like fields are sorted
 * + deduplicated deterministically at translation.
 */
export interface ConnectivityHardConstraints {
  /** Network zones the path must stay within (may be empty). */
  readonly requiredZones: readonly string[];
  /** Network zones the path must never traverse (may be empty). */
  readonly forbiddenZones: readonly string[];
  /** Maximum path hop count (> 0, optional). */
  readonly maxPathHops?: number;
  /** Whether internet egress is permitted on the path (required). */
  readonly egressAllowed: boolean;
}

/**
 * The requested duration of the connectivity. Either a bounded window
 * (`startAt` + optional `endAt`) or an indefinite engagement
 * (`indefinite: true`, which forbids `endAt`).
 */
export interface ConnectivityDuration {
  /** The requested start instant (ISO 8601; injected by the caller — no clock reads). */
  readonly startAt: string;
  /** The requested end instant (ISO 8601, after `startAt`), for bounded windows. */
  readonly endAt?: string;
  /** True for an indefinite engagement (forbids `endAt`). */
  readonly indefinite?: boolean;
}

/**
 * The budget/policy refs of a connectivity request — OPAQUE tenant-side
 * references (never amounts, never provider billing objects). Absent
 * refs mean "no budget/policy constraint", an explicit absence — never a
 * silent default.
 */
export interface ConnectivityBudget {
  /** An opaque reference to the tenant's budget policy, when one governs the request. */
  readonly budgetRef?: string;
  /** Opaque references to governing policies (sorted + deduplicated at translation). */
  readonly policyRefs: readonly string[];
}

/** The security requirements of a connectivity request. */
export interface ConnectivitySecurityRequirements {
  /** Whether traffic encryption is required (required, closed union). */
  readonly encryption: "required" | "not_required";
  /** Whether traffic must stay on private network paths (required). */
  readonly privateRouting: boolean;
  /** Opaque compliance references (sorted + deduplicated at translation). */
  readonly complianceRefs: readonly string[];
}

/**
 * The caller-supplied requirement profile joined with the frozen intent
 * payload at translation time. Every facet is validated; a malformed or
 * outcome-inconsistent profile is refused with machine-stable reasons.
 */
export interface ConnectivityIntentRequirements {
  /** The workload the connectivity serves, when bound to a workload. */
  readonly workloadId?: string;
  /** The required properties (required facet). */
  readonly properties: ConnectivityProperties;
  /** The hard constraints (required facet). */
  readonly constraints: ConnectivityHardConstraints;
  /** The requested duration (required facet). */
  readonly duration: ConnectivityDuration;
  /** The budget/policy refs (optional facet; absent = unconstrained). */
  readonly budget?: ConnectivityBudget;
  /** The security requirements (required facet). */
  readonly security: ConnectivitySecurityRequirements;
}

// ---------------------------------------------------------------------------
// The translated request (provider-neutral, plain data)
// ---------------------------------------------------------------------------

/** The traceability ref back to the originating Fleet intent. */
export interface ConnectivityIntentRef {
  readonly intentId: IntentId;
  readonly version: number;
  readonly createdAt: string;
}

/**
 * The typed, provider-neutral ADCOS connectivity request — the D1
 * translation product. Pure plain data: every field is
 * JSON-serializable, tenant-scoped, and free of provider topology,
 * credentials and SDK objects (asserted by the D2 boundary tests).
 *
 * Set-like fields (`requiredZones`, `forbiddenZones`, `policyRefs`,
 * `complianceRefs`) are sorted + deduplicated so that input permutations
 * produce byte-identical requests (and therefore identical digests).
 */
export interface AdcosConnectivityRequest {
  /** The tenant scope (from the intent envelope, verbatim). */
  readonly tenantId: TenantId;
  /** Traceability back to the originating intent. */
  readonly intentRef: ConnectivityIntentRef;
  /** The recognized outcome: canonical class + the raw payload string verbatim. */
  readonly outcome: {
    readonly canonical: CanonicalConnectivityOutcome;
    readonly raw: string;
  };
  /** The target device/workload refs. */
  readonly targets: Readonly<ConnectivityTargets>;
  /** The required properties (validated, frozen). */
  readonly properties: Readonly<ConnectivityProperties>;
  /** The hard constraints (validated, sets sorted + deduplicated, frozen). */
  readonly constraints: Readonly<ConnectivityHardConstraints>;
  /** The requested duration (validated, frozen). */
  readonly duration: Readonly<ConnectivityDuration>;
  /** The budget/policy refs (validated, sets sorted + deduplicated, frozen). */
  readonly budget: Readonly<ConnectivityBudget>;
  /** The security requirements (validated, sets sorted + deduplicated, frozen). */
  readonly security: Readonly<ConnectivitySecurityRequirements>;
  /** Deterministic content digest (FNV-1a over canonical JSON of the request). */
  readonly requestDigest: string;
}

// ---------------------------------------------------------------------------
// Requirement validation (pure, machine-stable failures)
// ---------------------------------------------------------------------------

/** A single machine-stable validation failure (path + reason). */
export interface RequirementFailure {
  /** JSON-pointer-style path to the invalid facet. */
  readonly path: string;
  /** The machine-stable reason (never localized, never free text). */
  readonly reason: string;
}

/** The result of requirement validation — tagged union. */
export type RequirementValidation =
  | { readonly ok: true; readonly requirements: Readonly<ConnectivityIntentRequirements> }
  | { readonly ok: false; readonly failures: readonly RequirementFailure[] };

/**
 * Validate a caller-supplied requirement profile. Pure, deterministic,
 * non-throwing; collects EVERY failure (never fails fast — the caller
 * surfaces the complete machine-stable refusal set). Machine-stable
 * reasons: `required`, `empty`, `not_iso`, `not_positive`,
 * `not_integer`, `out_of_range`, `invalid_union`, `conflicting_zones`,
 * `conflicting_duration`.
 *
 * @param requirements the caller-supplied profile (unknown at runtime boundaries)
 * @returns the tagged validation result with a frozen, normalized profile on success
 */
export function validateConnectivityRequirements(
  requirements: unknown,
): RequirementValidation {
  const failures: RequirementFailure[] = [];
  const r = (requirements ?? {}) as Partial<ConnectivityIntentRequirements>;

  if (r.workloadId !== undefined && (typeof r.workloadId !== "string" || r.workloadId.length === 0)) {
    failures.push({ path: "/workloadId", reason: "empty" });
  }

  // --- properties ---------------------------------------------------------
  const properties = (r.properties ?? {}) as Partial<ConnectivityProperties>;
  if (r.properties === undefined) {
    failures.push({ path: "/properties", reason: "required" });
  } else {
    if (properties.maxLatencyMs !== undefined && !isPositiveFinite(properties.maxLatencyMs)) {
      failures.push({ path: "/properties/maxLatencyMs", reason: "not_positive" });
    }
    if (properties.minThroughputMbps !== undefined && !isPositiveFinite(properties.minThroughputMbps)) {
      failures.push({ path: "/properties/minThroughputMbps", reason: "not_positive" });
    }
    if (
      properties.availabilityTarget !== undefined &&
      (typeof properties.availabilityTarget !== "number" ||
        !(properties.availabilityTarget > 0 && properties.availabilityTarget <= 1))
    ) {
      failures.push({ path: "/properties/availabilityTarget", reason: "out_of_range" });
    }
    if (
      properties.isolation === undefined ||
      !["private", "public", "any"].includes(properties.isolation as string)
    ) {
      failures.push({ path: "/properties/isolation", reason: "invalid_union" });
    }
    if (
      properties.redundancy === undefined ||
      !["none", "path_redundant", "device_redundant"].includes(properties.redundancy as string)
    ) {
      failures.push({ path: "/properties/redundancy", reason: "invalid_union" });
    }
  }

  // --- constraints ---------------------------------------------------------
  const constraints = (r.constraints ?? {}) as Partial<ConnectivityHardConstraints>;
  if (r.constraints === undefined) {
    failures.push({ path: "/constraints", reason: "required" });
  } else {
    validateStringSet(constraints.requiredZones, "/constraints/requiredZones", failures);
    validateStringSet(constraints.forbiddenZones, "/constraints/forbiddenZones", failures);
    if (constraints.maxPathHops !== undefined && !isPositiveInteger(constraints.maxPathHops)) {
      failures.push({ path: "/constraints/maxPathHops", reason: "not_positive" });
    }
    if (typeof constraints.egressAllowed !== "boolean") {
      failures.push({ path: "/constraints/egressAllowed", reason: "invalid_union" });
    }
    if (
      Array.isArray(constraints.requiredZones) &&
      Array.isArray(constraints.forbiddenZones) &&
      sortedUnique(constraints.requiredZones.filter(isNonEmptyString)).some((zone) =>
        sortedUnique(constraints.forbiddenZones?.filter(isNonEmptyString) ?? []).includes(zone),
      )
    ) {
      failures.push({ path: "/constraints", reason: "conflicting_zones" });
    }
  }

  // --- duration -------------------------------------------------------------
  const duration = (r.duration ?? {}) as Partial<ConnectivityDuration>;
  if (r.duration === undefined) {
    failures.push({ path: "/duration", reason: "required" });
  } else {
    if (typeof duration.startAt !== "string" || !looksLikeIso(duration.startAt)) {
      failures.push({ path: "/duration/startAt", reason: "not_iso" });
    }
    if (duration.endAt !== undefined && (typeof duration.endAt !== "string" || !looksLikeIso(duration.endAt))) {
      failures.push({ path: "/duration/endAt", reason: "not_iso" });
    }
    if (
      typeof duration.startAt === "string" &&
      looksLikeIso(duration.startAt) &&
      typeof duration.endAt === "string" &&
      looksLikeIso(duration.endAt) &&
      !(parseIsoMs(duration.endAt) > parseIsoMs(duration.startAt))
    ) {
      failures.push({ path: "/duration/endAt", reason: "out_of_range" });
    }
    if (duration.indefinite === true && duration.endAt !== undefined) {
      failures.push({ path: "/duration", reason: "conflicting_duration" });
    }
  }

  // --- budget ---------------------------------------------------------------
  const budget = (r.budget ?? {}) as Partial<ConnectivityBudget>;
  if (r.budget !== undefined) {
    if (budget.budgetRef !== undefined && (typeof budget.budgetRef !== "string" || budget.budgetRef.length === 0)) {
      failures.push({ path: "/budget/budgetRef", reason: "empty" });
    }
    if (budget.policyRefs !== undefined) {
      validateStringSet(budget.policyRefs, "/budget/policyRefs", failures);
    }
  }

  // --- security ---------------------------------------------------------------
  const security = (r.security ?? {}) as Partial<ConnectivitySecurityRequirements>;
  if (r.security === undefined) {
    failures.push({ path: "/security", reason: "required" });
  } else {
    if (
      security.encryption === undefined ||
      !["required", "not_required"].includes(security.encryption as string)
    ) {
      failures.push({ path: "/security/encryption", reason: "invalid_union" });
    }
    if (typeof security.privateRouting !== "boolean") {
      failures.push({ path: "/security/privateRouting", reason: "invalid_union" });
    }
    if (security.complianceRefs !== undefined) {
      validateStringSet(security.complianceRefs, "/security/complianceRefs", failures);
    } else {
      failures.push({ path: "/security/complianceRefs", reason: "required" });
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures: frozenArray(failures) };
  }

  // Success: normalize the set-like facets deterministically.
  const normalized: ConnectivityIntentRequirements = compact({
    workloadId: r.workloadId,
    properties: frozen({
      maxLatencyMs: properties.maxLatencyMs,
      minThroughputMbps: properties.minThroughputMbps,
      availabilityTarget: properties.availabilityTarget,
      isolation: properties.isolation as ConnectivityIsolation,
      redundancy: properties.redundancy as ConnectivityRedundancy,
    }),
    constraints: frozen({
      requiredZones: sortedUnique(constraints.requiredZones ?? []),
      forbiddenZones: sortedUnique(constraints.forbiddenZones ?? []),
      maxPathHops: constraints.maxPathHops,
      egressAllowed: constraints.egressAllowed as boolean,
    }),
    duration: frozen({
      startAt: duration.startAt as string,
      endAt: duration.endAt,
      indefinite: duration.indefinite,
    }),
    budget: frozen({
      budgetRef: r.budget === undefined ? undefined : budget.budgetRef,
      policyRefs: sortedUnique(r.budget === undefined ? [] : (budget.policyRefs ?? [])),
    }),
    security: frozen({
      encryption: security.encryption as "required" | "not_required",
      privateRouting: security.privateRouting as boolean,
      complianceRefs: sortedUnique(security.complianceRefs ?? []),
    }),
  });
  return { ok: true, requirements: normalized };
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateStringSet(
  values: unknown,
  path: string,
  failures: RequirementFailure[],
): void {
  if (!Array.isArray(values)) {
    failures.push({ path, reason: "required" });
    return;
  }
  for (const value of values) {
    if (!isNonEmptyString(value)) {
      failures.push({ path, reason: "empty" });
      return;
    }
  }
}
