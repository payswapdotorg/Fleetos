/**
 * @fleetos/web-learning — the structural surface contracts (W090B D3).
 *
 * The W040/W060-disclosed pattern: this surface lane consumes domain
 * shapes through LOCALLY-DECLARED structural seam types that the real
 * `@fleetos/learning` (W070) records structurally satisfy, WITHOUT
 * importing the domain package from src/ (src/ imports the shared seam
 * `@fleetos/contracts` only; the real binding is proven by cross-lane
 * tests in `test/` — `@fleetos/learning` is a DEV-dependency).
 *
 *   - `OutcomeObservationLike` is structurally satisfied by the W070
 *     `OutcomeObservation` (outcome-observation.ts).
 *   - `EvaluationCaseProposalLike` is structurally satisfied by the
 *     W070 `EvaluationCaseSubmissionProposal` (evaluation-conversion.ts)
 *     — the Guardian-gated disposition of a converted outcome.
 *   - `AdoptionRecordLike` is structurally satisfied by the W070
 *     `LearningAdoptionRecord` (adoption-ledger.ts) — the versioned,
 *     append-only adoption revision with the explicit human grant.
 *
 * Every seam type carries the domain field shapes verbatim (closed
 * unions preserved). Extra fields the domain records carry are
 * tolerated (structural supertypes); the surface NEVER re-derives
 * domain truth — it presents observable fields only.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { EvidenceRef, TenantId, UserId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The acting tenant scope
// ---------------------------------------------------------------------------

/** The acting tenant scope (first parameter of every surface builder). */
export interface LearningSurfaceTenantScope {
  /** The tenant whose data the surface presents (structural tenant isolation). */
  readonly tenantId: TenantId;
}

// ---------------------------------------------------------------------------
// Outcome observations (structural seam for W070's OutcomeObservation)
// ---------------------------------------------------------------------------

/** The W070 outcome source surfaces (the frozen closed union). */
export type LearningSourceSurface =
  | "health.treatment"
  | "action.plan"
  | "aurum.delivery"
  | "maintenance.work_order";

/** All outcome source surfaces (canonical order). */
export const ALL_LEARNING_SOURCE_SURFACES: readonly LearningSourceSurface[] = Object.freeze([
  "health.treatment",
  "action.plan",
  "aurum.delivery",
  "maintenance.work_order",
] as const);

/** The ground-truth annotation an outcome observation carries. */
export interface OutcomeGroundTruthLike {
  /** The outcome label (machine-stable — e.g. "treatment_dismissed"). */
  readonly label: string;
  /** The outcome value (machine-stable; the owning surface defines the value set). */
  readonly value: string;
}

/**
 * A typed, provider-neutral OUTCOME observation record — the closed
 * loop's intake (structural seam for W070's `OutcomeObservation`).
 */
export interface OutcomeObservationLike {
  /** Deterministic observation identity (`loo_`-prefixed digest). */
  readonly observationId: string;
  readonly tenantId: TenantId;
  /** The established domain surface the outcome was derived from. */
  readonly sourceSurface: LearningSourceSurface;
  /** The entity the outcome is about (recommendation id, plan id, message ref, work order id). */
  readonly subjectRef: string;
  /** The problem class of the evaluation cases this observation feeds. */
  readonly problemClass: string;
  /** The device the outcome concerns, when the surface is device-scoped. */
  readonly deviceId?: string;
  /** Normalized observation refs (content-addressable strings — opaque). */
  readonly observationRefs: readonly string[];
  /** Normalized action history refs (content-addressable strings — opaque). */
  readonly actionHistoryRefs: readonly string[];
  /** The situation the outcome arose in (JSON-serializable, verbatim). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The ground-truth annotation. */
  readonly outcome: OutcomeGroundTruthLike;
  /** The evidence artifacts supporting the outcome (content-addressable refs). */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The INJECTED observation instant (ISO 8601 — never a clock read). */
  readonly observedAt: string;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// Evaluation-case submission proposals (seam for the W070 gated proposal)
// ---------------------------------------------------------------------------

/** The Guardian-gated disposition of an evaluation-case submission proposal. */
export type EvaluationDisposition = "PROPOSED" | "PARKED" | "REJECTED";

/** All dispositions (canonical order). */
export const ALL_EVALUATION_DISPOSITIONS: readonly EvaluationDisposition[] = Object.freeze([
  "PROPOSED",
  "PARKED",
  "REJECTED",
] as const);

/** The redaction / de-identification state (the W070 frozen union). */
export type RedactionState = "raw" | "deidentified" | "redacted";

/** All redaction states (canonical order). */
export const ALL_REDACTION_STATES: readonly RedactionState[] = Object.freeze([
  "raw",
  "deidentified",
  "redacted",
] as const);

/** The redaction record a case carries (the state + governing policy refs). */
export interface RedactionRecordLike {
  /** The redaction state. */
  readonly state: RedactionState;
  /** The tenant policy refs that governed the redaction (may be empty). */
  readonly appliedPolicies: readonly string[];
}

/** One ground-truth evaluation label (a key/value annotation). */
export interface EvaluationLabelLike {
  /** The label key (machine-stable). */
  readonly key: string;
  /** The label value (machine-stable string). */
  readonly value: string;
}

/** The ground-truth outcome an evaluation case carries. */
export interface EvaluationOutcomeLike {
  /** The outcome label (machine-stable). */
  readonly label: string;
  /** The outcome value (machine-stable). */
  readonly value: string;
  /** The injected observation instant of the outcome (ISO 8601). */
  readonly observedAt: string;
  /** The evidence artifacts supporting the outcome (content-addressable refs). */
  readonly evidenceRefs: readonly EvidenceRef[];
}

/** The frozen Guardian decision types (the shared contracts union). */
export type GuardianDecisionKind = "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";

/** The observable Guardian decision that gated a proposal (structural subset). */
export interface GuardianDecisionSummaryLike {
  /** The decision type. */
  readonly decision: GuardianDecisionKind;
  /** ISO 8601 decision instant (verbatim). */
  readonly decidedAt: string;
}

/** The case payload of a submission proposal (the W070 facet, verbatim). */
export interface EvaluationCaseFacetLike {
  /** The problem class (machine-stable string — the capability class the case concerns). */
  readonly problemClass: string;
  /** The normalized observation refs (content-addressable — opaque). */
  readonly observationRefs: readonly string[];
  /** The case context (JSON-serializable — the situation the case arose in). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The action history refs (content-addressable — opaque). */
  readonly actionHistoryRefs: readonly string[];
  /** The ground-truth outcome. */
  readonly outcome: EvaluationOutcomeLike;
  /** The evaluation labels (ground-truth annotations). */
  readonly labels: readonly EvaluationLabelLike[];
  /** The tenant policy refs in force at submission (content-addressable — opaque). */
  readonly tenantPolicyRefs: readonly string[];
  /** The redaction / de-identification state. */
  readonly redaction: RedactionRecordLike;
}

/**
 * A GATED evaluation-case submission proposal (structural seam for
 * W070's `EvaluationCaseSubmissionProposal`): the disposition (the
 * Guardian decision's projection), the case payload, and the decision
 * that gated it. The proposal is NEVER auto-submitted — PARKED items
 * are held for human review.
 */
export interface EvaluationCaseProposalLike {
  /** Deterministic proposal identity (`lcp_`-prefixed digest). */
  readonly proposalId: string;
  readonly tenantId: TenantId;
  /** The outcome observation this proposal was converted from. */
  readonly sourceObservationId: string;
  /** The Guardian-gated disposition. */
  readonly disposition: EvaluationDisposition;
  /** The case payload. */
  readonly case: EvaluationCaseFacetLike;
  /** The FROZEN Guardian decision that gated the proposal (observable subset). */
  readonly guardianDecision: GuardianDecisionSummaryLike;
  /** Canonical digest of the proposal's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// Capability adoption revisions (seam for W070's LearningAdoptionRecord)
// ---------------------------------------------------------------------------

/** The rollout policy kind (the W070 frozen union). */
export type RolloutKind = "canary" | "ring" | "full";

/** All rollout kinds (canonical order). */
export const ALL_ROLLOUT_KINDS: readonly RolloutKind[] = Object.freeze([
  "canary",
  "ring",
  "full",
] as const);

/** The rollout policy record (the W070 shape, verbatim). */
export interface RolloutPolicyLike {
  /** The rollout kind. */
  readonly kind: RolloutKind;
  /** The percentage (0-100) for canary rollouts. */
  readonly percentage?: number;
  /** The ring ids for ring rollouts. */
  readonly ringIds?: readonly string[];
}

/** The adoption status of a revision (the W070 frozen union). */
export type AdoptionStatus = "ACTIVE" | "SUPERSEDED";

/** All adoption statuses (canonical order). */
export const ALL_ADOPTION_STATUSES: readonly AdoptionStatus[] = Object.freeze([
  "ACTIVE",
  "SUPERSEDED",
] as const);

/**
 * A versioned capability adoption revision (structural seam for W070's
 * `LearningAdoptionRecord`): the append-only revision with the
 * EXPLICIT human grant (approverId + approvedAt), the Arena
 * certification reference, and the supersession citation (a new
 * revision cites the prior recordId; the prior is never rewritten).
 */
export interface AdoptionRecordLike {
  /** Deterministic adoption identity (`adp_`-prefixed digest — stable across revisions). */
  readonly adoptionId: string;
  /** Deterministic revision id (`adpv_`-prefixed digest). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The adoption status (verbatim). */
  readonly status: AdoptionStatus;
  /** The capability id (from the certified metadata — verbatim). */
  readonly capabilityId: string;
  /** The capability version (from the certified metadata — verbatim). */
  readonly capabilityVersion: string;
  /** The Arena certification reference (verbatim — `acr_`-prefixed). */
  readonly certificationRef: string;
  /** The evaluation-suite revision the certification was granted against. */
  readonly evaluationSuiteRevision: string;
  /** The FleetOS compatibility statement (verbatim). */
  readonly fleetOSCompatibilityStatement: string;
  /** Machine-stable warnings (may be empty). */
  readonly warnings: readonly string[];
  /** The optional capability class. */
  readonly capabilityClass?: string;
  /** The rollout policy (verbatim). */
  readonly rolloutPolicy: RolloutPolicyLike;
  /** The cohort the adoption is targeted at. */
  readonly cohort: string;
  /** The prior capability version to roll back to if the adoption fails. */
  readonly rollbackVersion: string;
  /** The proposal id (verbatim). */
  readonly proposalId: string;
  /** The approving principal (the EXPLICIT GRANT — verbatim). */
  readonly approverId: UserId;
  /** The injected approval instant (ISO 8601 — the explicit grant). */
  readonly approvedAt: string;
  /** The injected adoption instant (ISO 8601 — when the revision was created). */
  readonly adoptedAt: string;
  /** The prior adoption recordId this revision supersedes (absent on version 1). */
  readonly supersedes?: string;
  /** Canonical digest of the revision's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}
