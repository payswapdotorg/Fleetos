/**
 * @fleetos/web-learning — the Learning/Area view-models (W090B D3).
 *
 * The W060 pattern applied to the W070 learning/evaluation loop: three
 * PURE, deterministic, seam-injected view builders —
 *
 *   - `buildOutcomeFeedView`     the outcome observation feed (the
 *                                closed loop's intake, read-only);
 *   - `buildEvaluationCasesView` the Guardian-gated evaluation-case
 *                                submission proposals (problem class,
 *                                labels, redaction state, disposition);
 *   - `buildAdoptionLedgerView`  the versioned capability adoption
 *                                ledger (supersession visible, the
 *                                certification state + the explicit
 *                                human grant verbatim).
 *
 * Every builder: validates its inputs machine-stably (tagged
 * {path, reason} failures — never a throw), REFUSES cross-tenant
 * records (fail-closed, never silently filtered), orders its output
 * machine-stably (input order never matters), and returns a deeply
 * frozen view.
 *
 * The surface NEVER submits, adopts, supersedes or certifies anything
 * — it presents observable records only (LOCK 4/16: the gated paths
 * are visible with their decision context, never one-click). The
 * uncertified-output disclosure is a property of the RENDERED screen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  compareStrings,
  deepFrozen,
  frozen,
  frozenArray,
  isNonEmptyString,
  isNonEmptyStringArray,
  isPlainObject,
  isPositiveInteger,
  looksLikeIso,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import type {
  AdoptionRecordLike,
  AdoptionStatus,
  EvaluationCaseProposalLike,
  EvaluationDisposition,
  LearningSourceSurface,
  LearningSurfaceTenantScope,
  OutcomeObservationLike,
  RedactionState,
  RolloutKind,
} from "./seams";
import {
  ALL_ADOPTION_STATUSES,
  ALL_EVALUATION_DISPOSITIONS,
  ALL_LEARNING_SOURCE_SURFACES,
  ALL_REDACTION_STATES,
  ALL_ROLLOUT_KINDS,
} from "./seams";

// Re-export the seam vocabulary (the surface's public data tables).
export {
  ALL_ADOPTION_STATUSES,
  ALL_EVALUATION_DISPOSITIONS,
  ALL_LEARNING_SOURCE_SURFACES,
  ALL_REDACTION_STATES,
  ALL_ROLLOUT_KINDS,
};

// ---------------------------------------------------------------------------
// The outcome observation feed view
// ---------------------------------------------------------------------------

/** One read-only outcome-feed row. */
export interface OutcomeFeedItemView {
  /** The observation identity. */
  readonly observationId: string;
  /** The established domain surface the outcome was derived from (verbatim). */
  readonly sourceSurface: LearningSourceSurface;
  /** The entity the outcome is about (opaque). */
  readonly subjectRef: string;
  /** The problem class the observation feeds (verbatim). */
  readonly problemClass: string;
  /** The device the outcome concerns, when device-scoped. */
  readonly deviceId?: string;
  /** The ground-truth annotation (verbatim). */
  readonly outcome: { readonly label: string; readonly value: string };
  /** The number of supporting evidence artifacts (derived). */
  readonly evidenceCount: number;
  /** The number of cited action-history refs (derived). */
  readonly actionHistoryCount: number;
  /** The injected observation instant (verbatim). */
  readonly observedAt: string;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The outcome observation feed view (ordered, counted, read-only). */
export interface OutcomeFeedView {
  /** The acting tenant scope. */
  readonly tenantId: LearningSurfaceTenantScope["tenantId"];
  /** The total number of observations. */
  readonly total: number;
  /** The derived per-surface counts. */
  readonly sourceCounts: Readonly<Record<LearningSourceSurface, number>>;
  /** The ordered rows (observedAt asc, observationId asc — input-order invariant). */
  readonly items: readonly OutcomeFeedItemView[];
}

/** The tagged result of `buildOutcomeFeedView`. */
export type OutcomeFeedViewResult = SurfaceResult<OutcomeFeedView>;

function validateObservation(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["observationId", "subjectRef", "problemClass", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  const sourceSurface = candidate["sourceSurface"];
  if (
    typeof sourceSurface !== "string" ||
    !(ALL_LEARNING_SOURCE_SURFACES as readonly string[]).includes(sourceSurface)
  ) {
    failures.push({ path: `${path}/sourceSurface`, reason: "unknown_source_surface" });
  }
  const outcome = candidate["outcome"];
  if (
    !isPlainObject(outcome) ||
    !isNonEmptyString(outcome["label"]) ||
    !isNonEmptyString(outcome["value"])
  ) {
    failures.push({ path: `${path}/outcome`, reason: "ground_truth_invalid" });
  }
  if (!looksLikeIso(String(candidate["observedAt"] ?? ""))) {
    failures.push({ path: `${path}/observedAt`, reason: "not_iso" });
  }
  const evidenceRefs = candidate["evidenceRefs"];
  if (!Array.isArray(evidenceRefs)) {
    failures.push({ path: `${path}/evidenceRefs`, reason: "array_required" });
  }
  const actionHistoryRefs = candidate["actionHistoryRefs"];
  if (!Array.isArray(actionHistoryRefs)) {
    failures.push({ path: `${path}/actionHistoryRefs`, reason: "array_required" });
  }
  if (candidate["deviceId"] !== undefined && !isNonEmptyString(candidate["deviceId"])) {
    failures.push({ path: `${path}/deviceId`, reason: "non_empty_string_required" });
  }
}

/**
 * Build the read-only outcome observation feed. Ordering (machine-stable,
 * input-order invariant): observedAt asc, then observationId asc.
 *
 * @param scope the acting tenant scope (first parameter, tenant discipline)
 * @param observations the outcome observations (the real W070 records, bound at the binding site)
 * @returns the tagged result: the ordered feed or a machine-stable error
 */
export function buildOutcomeFeedView(
  scope: LearningSurfaceTenantScope,
  observations: readonly OutcomeObservationLike[],
): OutcomeFeedViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "outcome feed surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every observation.
  if (!Array.isArray(observations)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.observationInvalid,
        "outcome feed surface requires an array of observation records",
        scope.tenantId,
        [{ path: "/observations", reason: "array_required" }],
      ),
    };
  }
  const structural: SurfaceValidationFailure[] = [];
  for (let i = 0; i < observations.length; i++) {
    validateObservation(observations[i], `/observations/${i}`, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.observationInvalid,
        "outcome feed surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < observations.length; i++) {
    if ((observations[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/observations/${i}`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "outcome feed surface refuses cross-tenant observations",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, counted projection.
  const sourceCounts: Record<LearningSourceSurface, number> = {
    "health.treatment": 0,
    "action.plan": 0,
    "aurum.delivery": 0,
    "maintenance.work_order": 0,
  };
  const items: OutcomeFeedItemView[] = observations.map(
    (record: OutcomeObservationLike): OutcomeFeedItemView => {
      sourceCounts[record.sourceSurface] += 1;
      return frozen({
        observationId: record.observationId,
        sourceSurface: record.sourceSurface,
        subjectRef: record.subjectRef,
        problemClass: record.problemClass,
        deviceId: record.deviceId,
        outcome: frozen({ label: record.outcome.label, value: record.outcome.value }),
        evidenceCount: record.evidenceRefs.length,
        actionHistoryCount: record.actionHistoryRefs.length,
        observedAt: record.observedAt,
        contentDigest: record.contentDigest,
      } satisfies OutcomeFeedItemView);
    },
  );
  items.sort((a, b) => {
    const byInstant = compareStrings(a.observedAt, b.observedAt);
    if (byInstant !== 0) return byInstant;
    return compareStrings(a.observationId, b.observationId);
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: items.length,
        sourceCounts: frozen({ ...sourceCounts }),
        items: frozenArray(items),
      } satisfies OutcomeFeedView),
    ),
  };
}

// ---------------------------------------------------------------------------
// The evaluation-case submissions view
// ---------------------------------------------------------------------------

/** One evaluation-case submission row (read-only, gated). */
export interface EvaluationCaseItemView {
  /** The proposal identity. */
  readonly proposalId: string;
  /** The outcome observation this proposal was converted from. */
  readonly sourceObservationId: string;
  /** The problem class (verbatim). */
  readonly problemClass: string;
  /** The Guardian-gated disposition (verbatim). */
  readonly disposition: EvaluationDisposition;
  /** The Guardian decision type that produced the disposition (verbatim). */
  readonly gateDecision: string;
  /** The decision instant (verbatim). */
  readonly decidedAt: string;
  /** The ground-truth outcome label/value (verbatim). */
  readonly outcomeLabel: string;
  readonly outcomeValue: string;
  /** The evaluation labels (key/value pairs, verbatim order). */
  readonly labels: readonly { readonly key: string; readonly value: string }[];
  /** The redaction state (verbatim). */
  readonly redactionState: RedactionState;
  /** The tenant policy refs that governed the redaction (verbatim, opaque). */
  readonly redactionPolicies: readonly string[];
  /** The tenant policy refs in force at submission (count derived). */
  readonly tenantPolicyCount: number;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The evaluation-case submissions view (ordered, counted, read-only). */
export interface EvaluationCasesView {
  /** The acting tenant scope. */
  readonly tenantId: LearningSurfaceTenantScope["tenantId"];
  /** The total number of proposals. */
  readonly total: number;
  /** The derived per-disposition counts. */
  readonly dispositionCounts: Readonly<Record<EvaluationDisposition, number>>;
  /** The ordered rows (proposalId asc — input-order invariant). */
  readonly items: readonly EvaluationCaseItemView[];
}

/** The tagged result of `buildEvaluationCasesView`. */
export type EvaluationCasesViewResult = SurfaceResult<EvaluationCasesView>;

function validateProposal(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["proposalId", "sourceObservationId", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  const disposition = candidate["disposition"];
  if (
    typeof disposition !== "string" ||
    !(ALL_EVALUATION_DISPOSITIONS as readonly string[]).includes(disposition)
  ) {
    failures.push({ path: `${path}/disposition`, reason: "unknown_disposition" });
  }
  const casePayload = candidate["case"];
  if (!isPlainObject(casePayload)) {
    failures.push({ path: `${path}/case`, reason: "object_required" });
    return;
  }
  if (!isNonEmptyString(casePayload["problemClass"])) {
    failures.push({ path: `${path}/case/problemClass`, reason: "non_empty_string_required" });
  }
  const outcome = casePayload["outcome"];
  if (
    !isPlainObject(outcome) ||
    !isNonEmptyString(outcome["label"]) ||
    !isNonEmptyString(outcome["value"]) ||
    !looksLikeIso(String(outcome["observedAt"] ?? ""))
  ) {
    failures.push({ path: `${path}/case/outcome`, reason: "outcome_invalid" });
  }
  const labels = casePayload["labels"];
  if (!Array.isArray(labels)) {
    failures.push({ path: `${path}/case/labels`, reason: "array_required" });
  } else {
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (
        !isPlainObject(label) ||
        !isNonEmptyString(label["key"]) ||
        !isNonEmptyString(label["value"])
      ) {
        failures.push({ path: `${path}/case/labels/${i}`, reason: "label_invalid" });
      }
    }
  }
  const redaction = casePayload["redaction"];
  if (
    !isPlainObject(redaction) ||
    typeof redaction["state"] !== "string" ||
    !(ALL_REDACTION_STATES as readonly string[]).includes(redaction["state"]) ||
    !Array.isArray(redaction["appliedPolicies"])
  ) {
    failures.push({ path: `${path}/case/redaction`, reason: "redaction_invalid" });
  }
  if (!Array.isArray(casePayload["tenantPolicyRefs"])) {
    failures.push({ path: `${path}/case/tenantPolicyRefs`, reason: "array_required" });
  }
  const decision = candidate["guardianDecision"];
  if (
    !isPlainObject(decision) ||
    typeof decision["decision"] !== "string" ||
    !["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"].includes(decision["decision"]) ||
    !looksLikeIso(String(decision["decidedAt"] ?? ""))
  ) {
    failures.push({ path: `${path}/guardianDecision`, reason: "decision_invalid" });
  }
}

/**
 * Build the read-only evaluation-case submissions view. Ordering
 * (machine-stable, input-order invariant): proposalId asc.
 *
 * @param scope the acting tenant scope
 * @param proposals the Guardian-gated submission proposals (the real W070 records, bound at the binding site)
 * @returns the tagged result: the ordered view or a machine-stable error
 */
export function buildEvaluationCasesView(
  scope: LearningSurfaceTenantScope,
  proposals: readonly EvaluationCaseProposalLike[],
): EvaluationCasesViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "evaluation cases surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every proposal.
  if (!Array.isArray(proposals)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.proposalInvalid,
        "evaluation cases surface requires an array of proposal records",
        scope.tenantId,
        [{ path: "/proposals", reason: "array_required" }],
      ),
    };
  }
  const structural: SurfaceValidationFailure[] = [];
  for (let i = 0; i < proposals.length; i++) {
    validateProposal(proposals[i], `/proposals/${i}`, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.proposalInvalid,
        "evaluation cases surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < proposals.length; i++) {
    if ((proposals[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/proposals/${i}`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "evaluation cases surface refuses cross-tenant proposals",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, counted projection.
  const dispositionCounts: Record<EvaluationDisposition, number> = {
    PROPOSED: 0,
    PARKED: 0,
    REJECTED: 0,
  };
  const items: EvaluationCaseItemView[] = proposals.map(
    (record: EvaluationCaseProposalLike): EvaluationCaseItemView => {
      dispositionCounts[record.disposition] += 1;
      return frozen({
        proposalId: record.proposalId,
        sourceObservationId: record.sourceObservationId,
        problemClass: record.case.problemClass,
        disposition: record.disposition,
        gateDecision: record.guardianDecision.decision,
        decidedAt: record.guardianDecision.decidedAt,
        outcomeLabel: record.case.outcome.label,
        outcomeValue: record.case.outcome.value,
        labels: frozenArray(
          record.case.labels.map((label) => frozen({ key: label.key, value: label.value })),
        ),
        redactionState: record.case.redaction.state,
        redactionPolicies: frozenArray(record.case.redaction.appliedPolicies),
        tenantPolicyCount: record.case.tenantPolicyRefs.length,
        contentDigest: record.contentDigest,
      } satisfies EvaluationCaseItemView);
    },
  );
  items.sort((a, b) => compareStrings(a.proposalId, b.proposalId));
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: items.length,
        dispositionCounts: frozen({ ...dispositionCounts }),
        items: frozenArray(items),
      } satisfies EvaluationCasesView),
    ),
  };
}

// ---------------------------------------------------------------------------
// The capability adoption ledger view
// ---------------------------------------------------------------------------

/** One adoption revision row (the versioned lineage, read-only). */
export interface AdoptionRevisionView {
  /** The revision number (>= 1). */
  readonly version: number;
  /** The revision id. */
  readonly recordId: string;
  /** The adoption status (verbatim). */
  readonly status: AdoptionStatus;
  /** The prior recordId this revision supersedes (absent on version 1). */
  readonly supersedes?: string;
  /**
   * The recordId of the revision that SUPERSEDES this one (derived
   * from the chain: a revision is superseded when a later revision
   * cites its recordId). Null on the current revision. Every W070
   * revision record carries status ACTIVE at append time — the
   * supersession is the OBSERVABLE citation, never a rewrite.
   */
  readonly supersededBy: string | null;
  /** The capability version adopted by this revision (verbatim). */
  readonly capabilityVersion: string;
  /** The certification reference (verbatim). */
  readonly certificationRef: string;
  /** The approving principal (the EXPLICIT GRANT — verbatim). */
  readonly approverId: AdoptionRecordLike["approverId"];
  /** The approval instant (verbatim). */
  readonly approvedAt: string;
  /** The adoption instant (verbatim). */
  readonly adoptedAt: string;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** One adoption (the revision chain grouped by adoptionId, read-only). */
export interface AdoptionEntryView {
  /** The stable adoption identity (constant across revisions). */
  readonly adoptionId: string;
  /** The capability id (verbatim). */
  readonly capabilityId: string;
  /** The capability class, when present (verbatim). */
  readonly capabilityClass?: string;
  /** The number of revisions in the chain (derived). */
  readonly revisionCount: number;
  /** The LATEST revision's version (derived). */
  readonly latestVersion: number;
  /** The latest revision's capability version (verbatim). */
  readonly latestCapabilityVersion: string;
  /** The latest revision's certification reference (verbatim). */
  readonly certificationRef: string;
  /** The evaluation-suite revision the certification was granted against (verbatim). */
  readonly evaluationSuiteRevision: string;
  /** The FleetOS compatibility statement (verbatim). */
  readonly compatibilityStatement: string;
  /** Machine-stable warnings (verbatim; may be empty). */
  readonly warnings: readonly string[];
  /** The rollout policy kind (verbatim). */
  readonly rolloutKind: RolloutKind;
  /** The rollout summary (machine-stable, human-displayed). */
  readonly rolloutSummary: string;
  /** The cohort (verbatim). */
  readonly cohort: string;
  /** The rollback version (verbatim). */
  readonly rollbackVersion: string;
  /** The approving principal of the LATEST revision (the EXPLICIT GRANT). */
  readonly approverId: AdoptionRecordLike["approverId"];
  /** The approval instant of the LATEST revision (verbatim). */
  readonly approvedAt: string;
  /** The adoption instant of the LATEST revision (verbatim). */
  readonly adoptedAt: string;
  /** The revision chain, version ascending (the supersession lineage). */
  readonly revisions: readonly AdoptionRevisionView[];
}

/** The capability adoption ledger view (ordered, read-only). */
export interface AdoptionLedgerView {
  /** The acting tenant scope. */
  readonly tenantId: LearningSurfaceTenantScope["tenantId"];
  /** The total number of adoptions (distinct adoptionIds). */
  readonly total: number;
  /** The total number of revisions across all adoptions (derived). */
  readonly revisionTotal: number;
  /** The ordered entries (adoptionId asc — input-order invariant). */
  readonly items: readonly AdoptionEntryView[];
}

/** The tagged result of `buildAdoptionLedgerView`. */
export type AdoptionLedgerViewResult = SurfaceResult<AdoptionLedgerView>;

/** The machine-stable rollout summary (pure). */
function rolloutSummaryOf(policy: AdoptionRecordLike["rolloutPolicy"]): string {
  switch (policy.kind) {
    case "canary":
      return `canary ${policy.percentage ?? 0}%`;
    case "ring":
      return `ring ${(policy.ringIds ?? []).join(", ")}`;
    default:
      return "full rollout";
  }
}

function validateAdoption(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of [
    "adoptionId",
    "recordId",
    "capabilityId",
    "capabilityVersion",
    "certificationRef",
    "evaluationSuiteRevision",
    "fleetOSCompatibilityStatement",
    "cohort",
    "rollbackVersion",
    "proposalId",
    "contentDigest",
  ] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isNonEmptyString(candidate["approverId"])) {
    failures.push({ path: `${path}/approverId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  const status = candidate["status"];
  if (typeof status !== "string" || !(ALL_ADOPTION_STATUSES as readonly string[]).includes(status)) {
    failures.push({ path: `${path}/status`, reason: "unknown_status" });
  }
  if (!looksLikeIso(String(candidate["approvedAt"] ?? ""))) {
    failures.push({ path: `${path}/approvedAt`, reason: "not_iso" });
  }
  if (!looksLikeIso(String(candidate["adoptedAt"] ?? ""))) {
    failures.push({ path: `${path}/adoptedAt`, reason: "not_iso" });
  }
  if (candidate["supersedes"] !== undefined && !isNonEmptyString(candidate["supersedes"])) {
    failures.push({ path: `${path}/supersedes`, reason: "non_empty_string_required" });
  }
  if (candidate["capabilityClass"] !== undefined && !isNonEmptyString(candidate["capabilityClass"])) {
    failures.push({ path: `${path}/capabilityClass`, reason: "non_empty_string_required" });
  }
  const warnings = candidate["warnings"];
  if (!Array.isArray(warnings) || !isNonEmptyStringArray(warnings)) {
    failures.push({ path: `${path}/warnings`, reason: "string_array_required" });
  }
  const rollout = candidate["rolloutPolicy"];
  if (
    !isPlainObject(rollout) ||
    typeof rollout["kind"] !== "string" ||
    !(ALL_ROLLOUT_KINDS as readonly string[]).includes(rollout["kind"])
  ) {
    failures.push({ path: `${path}/rolloutPolicy`, reason: "rollout_invalid" });
  }
}

/**
 * Build the read-only capability adoption ledger view: the revision
 * chains grouped by adoptionId (version ascending — the supersession
 * lineage visible), the certification state of the latest revision,
 * and the EXPLICIT human grant (approver + instant) on every revision.
 * Ordering (machine-stable): adoptionId asc.
 *
 * @param scope the acting tenant scope
 * @param records the adoption revisions (the real W070 ledger records, bound at the binding site)
 * @returns the tagged result: the ordered ledger or a machine-stable error
 */
export function buildAdoptionLedgerView(
  scope: LearningSurfaceTenantScope,
  records: readonly AdoptionRecordLike[],
): AdoptionLedgerViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "adoption ledger surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every revision.
  if (!Array.isArray(records)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.adoptionInvalid,
        "adoption ledger surface requires an array of adoption records",
        scope.tenantId,
        [{ path: "/records", reason: "array_required" }],
      ),
    };
  }
  const structural: SurfaceValidationFailure[] = [];
  for (let i = 0; i < records.length; i++) {
    validateAdoption(records[i], `/records/${i}`, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.adoptionInvalid,
        "adoption ledger surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < records.length; i++) {
    if ((records[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/records/${i}`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "adoption ledger surface refuses cross-tenant records",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — group by adoptionId, order revisions by version, project.
  const byAdoption = new Map<string, AdoptionRecordLike[]>();
  for (const record of records) {
    const chain = byAdoption.get(record.adoptionId);
    if (chain === undefined) {
      byAdoption.set(record.adoptionId, [record]);
    } else {
      chain.push(record);
    }
  }
  const adoptionIds = [...byAdoption.keys()].sort(compareStrings);
  let revisionTotal = 0;
  const items: AdoptionEntryView[] = adoptionIds.map((adoptionId) => {
    const chain = (byAdoption.get(adoptionId) as AdoptionRecordLike[])
      .slice()
      .sort((a, b) => a.version - b.version);
    revisionTotal += chain.length;
    const latest = chain[chain.length - 1] as AdoptionRecordLike;
    // The derived supersession map: a revision is superseded when a
    // later revision cites its recordId (the observable citation —
    // every appended W070 revision carries status ACTIVE; the prior is
    // never rewritten).
    const supersededBy = new Map<string, string>();
    for (const record of chain) {
      if (record.supersedes !== undefined) {
        supersededBy.set(record.supersedes, record.recordId);
      }
    }
    const revisions = frozenArray(
      chain.map((record) =>
        frozen({
          version: record.version,
          recordId: record.recordId,
          status: record.status,
          supersedes: record.supersedes,
          supersededBy: supersededBy.get(record.recordId) ?? null,
          capabilityVersion: record.capabilityVersion,
          certificationRef: record.certificationRef,
          approverId: record.approverId,
          approvedAt: record.approvedAt,
          adoptedAt: record.adoptedAt,
          contentDigest: record.contentDigest,
        } satisfies AdoptionRevisionView),
      ),
    );
    return frozen({
      adoptionId,
      capabilityId: latest.capabilityId,
      capabilityClass: latest.capabilityClass,
      revisionCount: chain.length,
      latestVersion: latest.version,
      latestCapabilityVersion: latest.capabilityVersion,
      certificationRef: latest.certificationRef,
      evaluationSuiteRevision: latest.evaluationSuiteRevision,
      compatibilityStatement: latest.fleetOSCompatibilityStatement,
      warnings: frozenArray(latest.warnings),
      rolloutKind: latest.rolloutPolicy.kind,
      rolloutSummary: rolloutSummaryOf(latest.rolloutPolicy),
      cohort: latest.cohort,
      rollbackVersion: latest.rollbackVersion,
      approverId: latest.approverId,
      approvedAt: latest.approvedAt,
      adoptedAt: latest.adoptedAt,
      revisions,
    } satisfies AdoptionEntryView);
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: items.length,
        revisionTotal,
        items: frozenArray(items),
      } satisfies AdoptionLedgerView),
    ),
  };
}
