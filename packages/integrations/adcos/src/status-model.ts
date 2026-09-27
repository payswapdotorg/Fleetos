/**
 * @fleetos/integration-adcos — D1: the reverse-direction typed model —
 * the provider-neutral ADCOS connectivity contract/status shapes and
 * their normalization inputs.
 *
 * Per `spec/integration/ADCOS.md`, the ADCOS -> FleetOS direction
 * returns "normalized connectivity contract/status with ID, accepted
 * requirements, execution state, evidence/measurements, degradation/
 * failure and termination."
 *
 * Every shape here is PROVIDER-NEUTRAL plain data: the provider-side
 * transport (the injected D2 seam) must produce these shapes — provider
 * topology, native credentials and provider SDK objects never cross the
 * boundary (asserted by the D2 boundary checks; a non-neutral report is
 * refused at normalization with a machine-stable reason).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { EvidenceRef } from "@fleetos/contracts";
import type { CanonicalConnectivityOutcome } from "./outcomes";
import type { AdcosProviderHandle } from "./provider-boundary";
import type {
  ConnectivityDuration,
  ConnectivityHardConstraints,
  ConnectivityProperties,
  ConnectivitySecurityRequirements,
} from "./request-model";
import {
  compact,
  frozen,
  frozenArray,
  looksLikeIso,
  parseIsoMs,
  sortedUnique,
} from "./internal";
import { asAdcosProviderHandle } from "./provider-boundary";

// ---------------------------------------------------------------------------
// The execution-state lifecycle (typed, machine-stable)
// ---------------------------------------------------------------------------

export const CONNECTIVITY_PROVISIONING = "PROVISIONING" as const;
export const CONNECTIVITY_ACTIVE = "ACTIVE" as const;
export const CONNECTIVITY_TERMINATING = "TERMINATING" as const;
export const CONNECTIVITY_TERMINATED = "TERMINATED" as const;

/**
 * The typed execution-state lifecycle of an ADCOS connectivity contract:
 *
 *   PROVISIONING -> ACTIVE -> TERMINATING -> TERMINATED
 *
 * Degradation is a FACET of active execution (not a lifecycle state);
 * failure is a machine-stable taxonomy, likewise orthogonal to the
 * lifecycle except that `termination` is present if and only if the
 * state is TERMINATED.
 */
export type ConnectivityExecutionState =
  | typeof CONNECTIVITY_PROVISIONING
  | typeof CONNECTIVITY_ACTIVE
  | typeof CONNECTIVITY_TERMINATING
  | typeof CONNECTIVITY_TERMINATED;

/** The full execution-state set, for validation + iteration. */
export const ALL_CONNECTIVITY_EXECUTION_STATES: readonly ConnectivityExecutionState[] =
  Object.freeze([
    CONNECTIVITY_PROVISIONING,
    CONNECTIVITY_ACTIVE,
    CONNECTIVITY_TERMINATING,
    CONNECTIVITY_TERMINATED,
  ]);

// ---------------------------------------------------------------------------
// The degradation / failure taxonomies (machine-stable)
// ---------------------------------------------------------------------------

/** The degradation taxonomy (machine-stable; `none` = not degraded). */
export type ConnectivityDegradationKind =
  | "none"
  | "latency_degraded"
  | "throughput_degraded"
  | "availability_degraded"
  | "path_changed";

/** The full degradation taxonomy, for validation + iteration. */
export const ALL_CONNECTIVITY_DEGRADATION_KINDS: readonly ConnectivityDegradationKind[] =
  Object.freeze([
    "none",
    "latency_degraded",
    "throughput_degraded",
    "availability_degraded",
    "path_changed",
  ]);

/** The failure taxonomy (machine-stable; `none` = not failed). */
export type ConnectivityFailureKind =
  | "none"
  | "provider_error"
  | "constraint_violation"
  | "security_violation"
  | "timeout"
  | "budget_exhausted";

/** The full failure taxonomy, for validation + iteration. */
export const ALL_CONNECTIVITY_FAILURE_KINDS: readonly ConnectivityFailureKind[] = Object.freeze([
  "none",
  "provider_error",
  "constraint_violation",
  "security_violation",
  "timeout",
  "budget_exhausted",
]);

/** A typed classification (kind + optional machine detail). */
export interface ConnectivityClassification {
  readonly kind:
    | ConnectivityDegradationKind
    | ConnectivityFailureKind;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// The termination taxonomy (machine-stable)
// ---------------------------------------------------------------------------

/** The termination reason taxonomy (machine-stable). */
export type ConnectivityTerminationReason =
  | "tenant_requested"
  | "provider_initiated"
  | "duration_elapsed"
  | "policy_violation";

/** The full termination-reason set, for validation + iteration. */
export const ALL_CONNECTIVITY_TERMINATION_REASONS: readonly ConnectivityTerminationReason[] =
  Object.freeze([
    "tenant_requested",
    "provider_initiated",
    "duration_elapsed",
    "policy_violation",
  ]);

/** A typed termination record. */
export interface ConnectivityTermination {
  readonly reason: ConnectivityTerminationReason;
  readonly terminatedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence-carrying measurements (typed)
// ---------------------------------------------------------------------------

/** The typed measurement kinds. */
export type ConnectivityMeasurementKind =
  | "latency_ms"
  | "throughput_mbps"
  | "availability_ratio";

/** The full measurement-kind set, for validation + iteration. */
export const ALL_CONNECTIVITY_MEASUREMENT_KINDS: readonly ConnectivityMeasurementKind[] =
  Object.freeze(["latency_ms", "throughput_mbps", "availability_ratio"]);

/**
 * A typed, evidence-ref-carrying measurement. The control plane never
 * interprets the evidence artifact's contents — it records that the
 * artifact exists and supports the measurement (the frozen `EvidenceRef`
 * contract, verbatim).
 */
export interface ConnectivityMeasurement {
  readonly kind: ConnectivityMeasurementKind;
  readonly value: number;
  /** The provider-reported measurement instant (ISO 8601). */
  readonly measuredAt: string;
  /** The evidence artifact supporting the measurement. */
  readonly evidence: EvidenceRef;
}

// ---------------------------------------------------------------------------
// The accepted-requirements echo (typed)
// ---------------------------------------------------------------------------

/**
 * The requirements the provider ACCEPTED — the typed echo of the request
 * facets the connectivity contract commits to. Validated with the same
 * invariants as the request side (never trusted blindly).
 */
export interface AcceptedConnectivityRequirements {
  readonly outcome: CanonicalConnectivityOutcome;
  readonly properties: Readonly<ConnectivityProperties>;
  readonly constraints: Readonly<ConnectivityHardConstraints>;
  readonly duration: Readonly<ConnectivityDuration>;
  readonly security: Readonly<ConnectivitySecurityRequirements>;
}

// ---------------------------------------------------------------------------
// The provider-neutral status report (the D2 seam's response shape)
// ---------------------------------------------------------------------------

/**
 * A provider-neutral ADCOS connectivity status report — what the
 * injected transport returns for a known handle. Plain data only; the
 * normalization layer validates every facet and refuses malformed or
 * non-neutral reports with machine-stable reasons.
 */
export interface AdcosStatusReport {
  /** The connectivity contract's id (opaque provider-assigned identity). */
  readonly connectivityId: string;
  /** The opaque provider handle (subsequent status fetches). */
  readonly handle: AdcosProviderHandle;
  /** The execution state. */
  readonly executionState: ConnectivityExecutionState;
  /** The accepted-requirements echo. */
  readonly acceptedRequirements: AcceptedConnectivityRequirements;
  /** Evidence-carrying measurements (normalized to deterministic order). */
  readonly measurements: readonly ConnectivityMeasurement[];
  /** The degradation classification. */
  readonly degradation: ConnectivityClassification;
  /** The failure classification. */
  readonly failure: ConnectivityClassification;
  /** The termination record (present iff executionState is TERMINATED). */
  readonly termination: ConnectivityTermination | null;
  /** The provider-side report instant (ISO 8601). */
  readonly reportedAt: string;
}

// ---------------------------------------------------------------------------
// Report validation (pure, machine-stable failures)
// ---------------------------------------------------------------------------

/** A single machine-stable report-validation failure. */
export interface ReportFailure {
  readonly path: string;
  readonly reason: string;
}

/** The result of report validation — tagged union. */
export type ReportValidation =
  | { readonly ok: true; readonly report: Readonly<AdcosStatusReport> }
  | { readonly ok: false; readonly failures: readonly ReportFailure[] };

/**
 * Validate + normalize a provider-side status report. Pure, deterministic,
 * non-throwing; collects EVERY failure. Machine-stable reasons include
 * `required`, `empty`, `not_iso`, `invalid_union`, `out_of_range`,
 * `invalid_evidence`, `termination_state_conflict` and
 * `degradation_state_conflict`.
 *
 * Normalization on success: measurements sorted deterministically by
 * (kind, measuredAt, evidence.key); set-like accepted facets sorted +
 * deduplicated — so report input permutations produce byte-identical
 * revisions (and therefore identical content digests).
 *
 * @param report the candidate report (unknown at runtime boundaries)
 * @returns the tagged validation result with a frozen, normalized report
 */
export function validateStatusReport(report: unknown): ReportValidation {
  const failures: ReportFailure[] = [];
  const r = (report ?? {}) as Partial<AdcosStatusReport>;

  if (typeof r.connectivityId !== "string" || r.connectivityId.length === 0) {
    failures.push({ path: "/connectivityId", reason: "required" });
  }
  if (typeof r.handle !== "string" || r.handle.length === 0) {
    failures.push({ path: "/handle", reason: "required" });
  }
  if (
    r.executionState === undefined ||
    !ALL_CONNECTIVITY_EXECUTION_STATES.includes(r.executionState as ConnectivityExecutionState)
  ) {
    failures.push({ path: "/executionState", reason: "invalid_union" });
  }
  if (typeof r.reportedAt !== "string" || !looksLikeIso(r.reportedAt)) {
    failures.push({ path: "/reportedAt", reason: "not_iso" });
  }

  // --- accepted requirements (reuse the request-side invariants) -------------
  const accepted = (r.acceptedRequirements ?? {}) as {
    outcome?: unknown;
    properties?: unknown;
    constraints?: unknown;
    duration?: unknown;
    security?: unknown;
  };
  if (r.acceptedRequirements === undefined) {
    failures.push({ path: "/acceptedRequirements", reason: "required" });
  } else {
    if (
      typeof accepted.outcome !== "string" ||
      ![
        "low_latency_local_device_group",
        "secure_private_connectivity",
        "high_throughput_transfer",
        "resilient_connectivity",
      ].includes(accepted.outcome)
    ) {
      failures.push({ path: "/acceptedRequirements/outcome", reason: "invalid_union" });
    }
    validateAcceptedProperties(accepted.properties, failures);
    validateAcceptedConstraints(accepted.constraints, failures);
    validateAcceptedDuration(accepted.duration, failures);
    validateAcceptedSecurity(accepted.security, failures);
  }

  // --- measurements ------------------------------------------------------------
  const measurements: ConnectivityMeasurement[] = [];
  if (!Array.isArray(r.measurements)) {
    failures.push({ path: "/measurements", reason: "required" });
  } else {
    r.measurements.forEach((measurement, index) => {
      const m = (measurement ?? {}) as Partial<ConnectivityMeasurement>;
      const base = `/measurements/${index}`;
      if (
        m.kind === undefined ||
        !ALL_CONNECTIVITY_MEASUREMENT_KINDS.includes(m.kind as ConnectivityMeasurementKind)
      ) {
        failures.push({ path: `${base}/kind`, reason: "invalid_union" });
      }
      if (typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < 0) {
        failures.push({ path: `${base}/value`, reason: "out_of_range" });
      }
      if (typeof m.measuredAt !== "string" || !looksLikeIso(m.measuredAt)) {
        failures.push({ path: `${base}/measuredAt`, reason: "not_iso" });
      }
      const evidence = m.evidence as Partial<EvidenceRef> | undefined;
      if (
        evidence === undefined ||
        typeof evidence.key !== "string" ||
        evidence.key.length === 0 ||
        typeof evidence.sizeBytes !== "number" ||
        !Number.isInteger(evidence.sizeBytes) ||
        evidence.sizeBytes < 0 ||
        typeof evidence.hash !== "string" ||
        evidence.hash.length === 0 ||
        typeof evidence.hashAlgorithm !== "string" ||
        evidence.hashAlgorithm.length === 0
      ) {
        failures.push({ path: `${base}/evidence`, reason: "invalid_evidence" });
      }
      if (
        m.kind === "availability_ratio" &&
        typeof m.value === "number" &&
        Number.isFinite(m.value) &&
        !(m.value >= 0 && m.value <= 1)
      ) {
        failures.push({ path: `${base}/value`, reason: "out_of_range" });
      }
    });
  }

  // --- degradation / failure classifications ------------------------------------
  const degradation = validateClassification(
    r.degradation,
    "/degradation",
    ALL_CONNECTIVITY_DEGRADATION_KINDS,
    failures,
  );
  const failure = validateClassification(
    r.failure,
    "/failure",
    ALL_CONNECTIVITY_FAILURE_KINDS,
    failures,
  );

  // --- termination ---------------------------------------------------------------
  let termination: ConnectivityTermination | null = null;
  if (r.termination !== undefined && r.termination !== null) {
    const t = r.termination as Partial<ConnectivityTermination>;
    if (
      t.reason === undefined ||
      !ALL_CONNECTIVITY_TERMINATION_REASONS.includes(t.reason as ConnectivityTerminationReason)
    ) {
      failures.push({ path: "/termination/reason", reason: "invalid_union" });
    }
    if (typeof t.terminatedAt !== "string" || !looksLikeIso(t.terminatedAt)) {
      failures.push({ path: "/termination/terminatedAt", reason: "not_iso" });
    }
    if (r.executionState !== undefined && r.executionState !== CONNECTIVITY_TERMINATED) {
      failures.push({ path: "/termination", reason: "termination_state_conflict" });
    }
    termination = frozen({
      reason: t.reason as ConnectivityTerminationReason,
      terminatedAt: t.terminatedAt as string,
    });
  } else if (r.executionState === CONNECTIVITY_TERMINATED) {
    failures.push({ path: "/termination", reason: "required" });
  }

  // Degradation describes ongoing ACTIVE execution only.
  if (
    degradation !== undefined &&
    degradation !== "none" &&
    r.executionState !== undefined &&
    r.executionState !== CONNECTIVITY_ACTIVE
  ) {
    failures.push({ path: "/degradation", reason: "degradation_state_conflict" });
  }

  if (failures.length > 0) {
    return { ok: false, failures: frozenArray(failures) };
  }

  // Success: normalize deterministically (measurements sorted; sets sorted).
  const sortedMeasurements = [...(r.measurements as ConnectivityMeasurement[])]
    .map((m) =>
      frozen({
        kind: m.kind,
        value: m.value,
        measuredAt: m.measuredAt,
        evidence: frozen({ ...m.evidence }),
      }),
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      if (a.measuredAt !== b.measuredAt) return a.measuredAt < b.measuredAt ? -1 : 1;
      return a.evidence.key < b.evidence.key ? -1 : a.evidence.key > b.evidence.key ? 1 : 0;
    });

  const normalized: AdcosStatusReport = compact({
    connectivityId: r.connectivityId as string,
    handle: asAdcosProviderHandle(r.handle as string),
    executionState: r.executionState as ConnectivityExecutionState,
    acceptedRequirements: frozen({
      outcome: (r.acceptedRequirements as AcceptedConnectivityRequirements).outcome,
      properties: frozen({
        ...(r.acceptedRequirements as AcceptedConnectivityRequirements).properties,
      }),
      constraints: frozen({
        ...(r.acceptedRequirements as AcceptedConnectivityRequirements).constraints,
        requiredZones: sortedUnique(
          (r.acceptedRequirements as AcceptedConnectivityRequirements).constraints.requiredZones,
        ),
        forbiddenZones: sortedUnique(
          (r.acceptedRequirements as AcceptedConnectivityRequirements).constraints.forbiddenZones,
        ),
      }),
      duration: frozen({
        ...(r.acceptedRequirements as AcceptedConnectivityRequirements).duration,
      }),
      security: frozen({
        ...(r.acceptedRequirements as AcceptedConnectivityRequirements).security,
        complianceRefs: sortedUnique(
          (r.acceptedRequirements as AcceptedConnectivityRequirements).security.complianceRefs,
        ),
      }),
    }),
    measurements: frozenArray(sortedMeasurements),
    degradation: frozen({ ...(r.degradation as ConnectivityClassification) }),
    failure: frozen({ ...(r.failure as ConnectivityClassification) }),
    termination,
    reportedAt: r.reportedAt as string,
  });
  return { ok: true, report: normalized };
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateClassification(
  value: unknown,
  path: string,
  allowed: readonly string[],
  failures: ReportFailure[],
): string | undefined {
  const c = (value ?? {}) as Partial<ConnectivityClassification>;
  if (value === undefined || c.kind === undefined || !allowed.includes(c.kind as string)) {
    failures.push({ path: `${path}/kind`, reason: "invalid_union" });
    return undefined;
  }
  if (c.detail !== undefined && typeof c.detail !== "string") {
    failures.push({ path: `${path}/detail`, reason: "invalid_union" });
  }
  return c.kind as string;
}

function validateAcceptedProperties(value: unknown, failures: ReportFailure[]): void {
  const p = (value ?? {}) as Record<string, unknown>;
  if (value === undefined) {
    failures.push({ path: "/acceptedRequirements/properties", reason: "required" });
    return;
  }
  if (p.maxLatencyMs !== undefined && !(typeof p.maxLatencyMs === "number" && p.maxLatencyMs > 0)) {
    failures.push({ path: "/acceptedRequirements/properties/maxLatencyMs", reason: "not_positive" });
  }
  if (
    p.minThroughputMbps !== undefined &&
    !(typeof p.minThroughputMbps === "number" && p.minThroughputMbps > 0)
  ) {
    failures.push({
      path: "/acceptedRequirements/properties/minThroughputMbps",
      reason: "not_positive",
    });
  }
  if (
    p.availabilityTarget !== undefined &&
    !(typeof p.availabilityTarget === "number" && p.availabilityTarget > 0 && p.availabilityTarget <= 1)
  ) {
    failures.push({
      path: "/acceptedRequirements/properties/availabilityTarget",
      reason: "out_of_range",
    });
  }
  if (!["private", "public", "any"].includes(p.isolation as string)) {
    failures.push({ path: "/acceptedRequirements/properties/isolation", reason: "invalid_union" });
  }
  if (!["none", "path_redundant", "device_redundant"].includes(p.redundancy as string)) {
    failures.push({ path: "/acceptedRequirements/properties/redundancy", reason: "invalid_union" });
  }
}

function validateAcceptedConstraints(value: unknown, failures: ReportFailure[]): void {
  const c = (value ?? {}) as Record<string, unknown>;
  if (value === undefined) {
    failures.push({ path: "/acceptedRequirements/constraints", reason: "required" });
    return;
  }
  if (!Array.isArray(c.requiredZones)) {
    failures.push({ path: "/acceptedRequirements/constraints/requiredZones", reason: "required" });
  }
  if (!Array.isArray(c.forbiddenZones)) {
    failures.push({ path: "/acceptedRequirements/constraints/forbiddenZones", reason: "required" });
  }
  if (
    Array.isArray(c.requiredZones) &&
    Array.isArray(c.forbiddenZones) &&
    sortedUnique(
      (c.requiredZones as unknown[]).filter((z): z is string => typeof z === "string" && z.length > 0),
    ).some((zone) =>
      sortedUnique(
        (c.forbiddenZones as unknown[]).filter((z): z is string => typeof z === "string" && z.length > 0),
      ).includes(zone),
    )
  ) {
    failures.push({ path: "/acceptedRequirements/constraints", reason: "conflicting_zones" });
  }
  if (c.maxPathHops !== undefined && !(typeof c.maxPathHops === "number" && Number.isInteger(c.maxPathHops) && c.maxPathHops > 0)) {
    failures.push({ path: "/acceptedRequirements/constraints/maxPathHops", reason: "not_positive" });
  }
  if (typeof c.egressAllowed !== "boolean") {
    failures.push({ path: "/acceptedRequirements/constraints/egressAllowed", reason: "invalid_union" });
  }
}

function validateAcceptedDuration(value: unknown, failures: ReportFailure[]): void {
  const d = (value ?? {}) as Record<string, unknown>;
  if (value === undefined) {
    failures.push({ path: "/acceptedRequirements/duration", reason: "required" });
    return;
  }
  if (typeof d.startAt !== "string" || !looksLikeIso(d.startAt)) {
    failures.push({ path: "/acceptedRequirements/duration/startAt", reason: "not_iso" });
  }
  if (d.endAt !== undefined && (typeof d.endAt !== "string" || !looksLikeIso(d.endAt))) {
    failures.push({ path: "/acceptedRequirements/duration/endAt", reason: "not_iso" });
  }
  if (
    typeof d.startAt === "string" &&
    looksLikeIso(d.startAt) &&
    typeof d.endAt === "string" &&
    looksLikeIso(d.endAt) &&
    !(parseIsoMs(d.endAt) > parseIsoMs(d.startAt))
  ) {
    failures.push({ path: "/acceptedRequirements/duration/endAt", reason: "out_of_range" });
  }
  if (d.indefinite === true && d.endAt !== undefined) {
    failures.push({ path: "/acceptedRequirements/duration", reason: "conflicting_duration" });
  }
}

function validateAcceptedSecurity(value: unknown, failures: ReportFailure[]): void {
  const s = (value ?? {}) as Record<string, unknown>;
  if (value === undefined) {
    failures.push({ path: "/acceptedRequirements/security", reason: "required" });
    return;
  }
  if (!["required", "not_required"].includes(s.encryption as string)) {
    failures.push({ path: "/acceptedRequirements/security/encryption", reason: "invalid_union" });
  }
  if (typeof s.privateRouting !== "boolean") {
    failures.push({ path: "/acceptedRequirements/security/privateRouting", reason: "invalid_union" });
  }
  if (!Array.isArray(s.complianceRefs)) {
    failures.push({ path: "/acceptedRequirements/security/complianceRefs", reason: "required" });
  }
}
