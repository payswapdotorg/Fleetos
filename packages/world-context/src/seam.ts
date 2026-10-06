/**
 * @fleetos/world-context — the W040/W154 structural-seam pattern.
 *
 * The src/ discipline of this package permits only `@fleetos/contracts`
 * imports (the W155 work order: "Consume @fleetos/world-model +
 * @fleetos/learning + the domain packages through STRUCTURAL SEAMS in
 * src/ (the W040/W154 pattern — the ownership gate forbids cross-lane
 * src/ imports beyond @fleetos/contracts)"). The W155 lane consumes
 * FOUR sibling surfaces:
 *   - @fleetos/world-model  (W154 — the engine that consumes the
 *                            context MY lane projects; the prediction/
 *                            counterfactual records MY lane converts);
 *   - @fleetos/learning     (W070 — the evaluation-conversion + outcome-
 *                            observation shapes MY bridge binds into);
 *   - @fleetos/workloads    (W022 — the workload-assignment surface
 *                            MY projection derives from);
 *   - @fleetos/procurement  (the procurement-stage surface MY projection
 *                            derives from).
 *
 * The resolution is the W040-disclosed structural-seam pattern: declare
 * LOCAL structural interfaces (structurally compatible with each sibling's
 * public surface), and inject the REAL sibling outputs at the binding
 * site (tests). TypeScript's structural typing means the REAL
 * `@fleetos/world-model` `WorldModelContext`, `WorldModelPrediction`,
 * `WorldModelCounterfactual`; the REAL `@fleetos/learning`
 * `EvaluationCaseProposalFacet`, `OutcomeObservation`; the REAL
 * `@fleetos/workloads` `WorkloadRecommendation`, `WorkloadProfile`; AND
 * the REAL `@fleetos/procurement` `ProcurementDemand`, `Quote`,
 * `QuoteLedger` all satisfy this lane's local interfaces WITHOUT a
 * cross-lane src/ import (the binding-site tests prove it).
 *
 * The pattern is the same one `@fleetos/world-model`'s own
 * `WorldModelAuditSink` uses: a LOCAL interface structurally compatible
 * with `@fleetos/audit`'s `AuditSink`, the binding site (tests) injects
 * the real `createAuditSinkAdapter(log, ...)` output. The src/ files
 * NEVER import `@fleetos/audit` / `@fleetos/world-model` /
 * `@fleetos/learning` / `@fleetos/workloads` / `@fleetos/procurement`.
 *
 * Per ADR-0002 § "Hard invariants":
 *   3. Every prediction carries model/capability version, horizon,
 *      evidence references and uncertainty metadata. The structural
 *      seam carries these VERBATIM — the local PredictionLike interface
 *      mirrors the W154 WorldModelPrediction + WorldModelCounterfactual
 *      shapes (the discriminated union with the `kind` discriminator +
 *      the machine-carried `hypothetical: true` marker).
 *   6. A failed or unavailable model DEGRADES HONESTLY: the W154
 *      representation's non-ok statuses PROPAGATE through to the
 *      prediction — a non-ok representation yields a non-ok prediction
 *      (the W154 engine REFUSES the prediction). The structural seam
 *      carries the W154 prediction's `kind` discriminator + the
 *      `provenanceChainDigest` VERBATIM — the W155 bridge REFUSES a
 *      non-ok prediction (which never exists as a record — the W154
 *      engine returns a typed error, not a non-ok prediction), but it
 *      DOES refuse a prediction record that LACKS the provenance chain
 *      (the trust anchor discipline — the W154 work order: "a
 *      prediction lacking the provenance chain REFUSES").
 *   7. Tenant isolation at every boundary; cross-tenant inputs rejected.
 *      The structural seam carries the W154 prediction's `tenantId` +
 *      the W070 outcome-observation's `tenantId` VERBATIM; the W155
 *      lane's guard REFUSES cross-tenant inputs at every boundary.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The W154 WorldModelContext structural seam (the FROZEN input type
// W155 builds the workload/project projection against)
// ---------------------------------------------------------------------------

/**
 * A single context observation item — STRUCTURAL twin of the W154
 * `ContextObservationItem` (the W154 work order FROZE this shape for
 * W155 to build against). The W155 projection produces
 * `workload_assignment` and `procurement_stage` items here; the W154
 * engine chains their provenance refs into the representation's
 * provenance chain digest WITHOUT interpreting the content.
 */
export interface ContextObservationItemLike {
  /** Stable kind identifier (e.g. "workload_assignment", "procurement_stage"). */
  readonly kind: string;
  /** The observation's content (JSON-serializable; the W154 engine does NOT interpret it). */
  readonly value: unknown;
  /** Provenance refs (the caller's evidence trail — the source record ids). */
  readonly provenanceRefs: readonly string[];
}

/**
 * The W154 WorldModelContext — STRUCTURAL twin of the W154 frozen
 * `WorldModelContext` (the W155 lane builds the workload/project
 * projection against this shape; the W154 engine consumes the
 * projection's output UNCHANGED at the binding site — TypeScript
 * structural typing means the W155 projection's output satisfies the
 * REAL W154 `WorldModelContext` interface without a cross-lane src/
 * import, the W040-disclosed pattern).
 *
 * A MINIMAL context (refs + asOf only) is valid — the W154 engine
 * degrades honestly on thin context, never fabricates. The context
 * schema is VERSIONED (`WORLD_MODEL_CONTEXT_SCHEMA_VERSION` — frozen at
 * 1 by the W154 lane; the W155 projection's output carries
 * `schemaVersion: 1` so the W154 engine accepts it without a schema
 * bump).
 */
export interface WorldModelContextLike extends TenantScoped {
  /** The schema version (frozen at the W154 `WORLD_MODEL_CONTEXT_SCHEMA_VERSION = 1`). */
  readonly schemaVersion: number;
  /** The device the representation is for (MUST match the W153 feature set's identity.deviceId). */
  readonly deviceId: DeviceId;
  /** The INJECTED asOf instant (ISO 8601 — never a clock read). */
  readonly asOf: string;
  /** OPTIONAL context observations (workload/procurement state with provenance). */
  readonly observations?: readonly ContextObservationItemLike[];
  /** The correlation id of the representation request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

// ---------------------------------------------------------------------------
// The W154 WorldModelPrediction + WorldModelCounterfactual structural seam
// (the discriminated union MY lane converts into evaluation-case proposals)
// ---------------------------------------------------------------------------

/**
 * The W154 prediction uncertainty metadata — STRUCTURAL twin of the W154
 * `PredictionUncertainty`. Carried VERBATIM into the bridge's proposal
 * context (the W155 bridge does NOT re-derive or widen the uncertainty;
 * the W154 engine's honest interval/spread/confidence is the ground
 * truth the bridge forwards to the evaluation loop).
 */
export interface PredictionUncertaintyLike {
  /** The lower bound of the estimate. */
  readonly lower: number;
  /** The upper bound of the estimate. */
  readonly upper: number;
  /** The half-width of the interval (`(upper - lower) / 2`). */
  readonly spread: number;
  /** The honest confidence in `[0, 1]` (derived from data density, never fabricated). */
  readonly confidence: number;
  /** The data-density signal: the W153 feature set's observation count. */
  readonly observationCount: number;
  /** The recency signal: the W154 representation's recency weight. */
  readonly recencyWeight: number;
}

/**
 * The W154 prediction horizon — STRUCTURAL twin of the W154
 * `PredictionHorizon`. Carried VERBATIM into the bridge's proposal
 * context (the horizon scopes the prediction's estimate; the W155 outcome
 * binding checks the horizon against the observed outcome's instant — a
 * horizon mismatch REFUSES).
 */
export interface PredictionHorizonLike {
  /** The horizon duration in milliseconds (>= 0). */
  readonly horizonMs: number;
}

/**
 * The W154 prediction target ref — STRUCTURAL twin of the W154
 * `PredictionTargetRef` (the device + the horizon). Carried VERBATIM
 * into the bridge's proposal context (the target identifies the device
 * the prediction concerns; the W155 outcome binding's `deviceId` is
 * derived from this).
 */
export interface PredictionTargetRefLike {
  readonly deviceId: DeviceId;
  readonly horizon: PredictionHorizonLike;
}

/**
 * An evidence reference in the prediction's chain — STRUCTURAL twin of
 * the W154 `PredictionEvidenceRef`. The chain:
 *   - `representation`:  the W154 representation's `provenanceChainDigest`;
 *   - `featureSet`:       the W153 feature set's `inputDigest`;
 *   - `observation`:     the W153 feature set's `inputObservationRefs`;
 *   - `contextObservation`: the W154 context's `contextObservationRefs`;
 *   - `candidateAction`: the counterfactual's candidate action ref.
 */
export type PredictionEvidenceRefKindLike =
  | "representation"
  | "featureSet"
  | "observation"
  | "contextObservation"
  | "candidateAction";

/** An evidence reference in the prediction's chain. */
export interface PredictionEvidenceRefLike {
  /** The kind of evidence (where in the chain this ref points). */
  readonly kind: PredictionEvidenceRefKindLike;
  /** The reference value (a digest, an observation id, ...). */
  readonly ref: string;
}

/**
 * The W154 prediction provenance record — STRUCTURAL twin of the W154
 * `PredictionProvenance`. Carried VERBATIM into the bridge's proposal
 * (the capability name + version + the chained digests + the evidence
 * refs are the prediction's trust anchor — the W155 bridge chains them
 * into the proposal's observation refs so the evaluation loop can verify
 * the prediction's lineage).
 */
export interface PredictionProvenanceLike {
  readonly capabilityName: string;
  readonly capabilityVersion: number;
  readonly representationDigest: string;
  readonly featureSetInputDigest: string;
  readonly contextDigest: string;
  readonly evidenceRefs: readonly PredictionEvidenceRefLike[];
}

/**
 * The W154 prediction record — STRUCTURAL twin of the W154
 * `WorldModelPrediction`. The discriminated union's `"prediction"` kind.
 * The W155 bridge consumes this shape; the binding site (tests) injects
 * the REAL `@fleetos/world-model` `predict()` output (TypeScript
 * structural typing means the real W154 `WorldModelPrediction` satisfies
 * this interface without a cross-lane src/ import).
 */
export interface WorldModelPredictionLike extends TenantScoped {
  readonly schemaVersion: number;
  /** The kind discriminator — `"prediction"` (NEVER `"counterfactual"`). */
  readonly kind: "prediction";
  readonly capability: { readonly name: string; readonly version: number };
  readonly target: PredictionTargetRefLike;
  readonly estimateKind: string;
  readonly estimate: number;
  readonly uncertainty: PredictionUncertaintyLike;
  readonly provenance: PredictionProvenanceLike;
  readonly correlationId: CorrelationId;
  /** The INJECTED production instant (ISO 8601 — the W154 representation's `asOf`). */
  readonly producedAt: string;
  /** The SHA-256 over the canonical serialization of the prediction's chain anchor. */
  readonly provenanceChainDigest: string;
}

/**
 * The W154 counterfactual record — STRUCTURAL twin of the W154
 * `WorldModelCounterfactual`. The discriminated union's
 * `"counterfactual"` kind. The SAME shape as a prediction PLUS a
 * machine-carried `hypothetical: true` marker + the candidate action
 * ref. The `kind` discriminator is `"counterfactual"` (NOT
 * `"prediction"`), so a counterfactual can NEVER be confused with a
 * prediction — the type system enforces it (machine-tested in this
 * lane's test suite).
 */
export interface WorldModelCounterfactualLike extends TenantScoped {
  readonly schemaVersion: number;
  /** The kind discriminator — `"counterfactual"` (NEVER `"prediction"`). */
  readonly kind: "counterfactual";
  /** The machine-carried hypothetical marker — ALWAYS `true` for a counterfactual. */
  readonly hypothetical: true;
  readonly candidateAction: { readonly ref: string; readonly description: string };
  readonly capability: { readonly name: string; readonly version: number };
  readonly target: PredictionTargetRefLike;
  readonly estimateKind: string;
  readonly estimate: number;
  readonly uncertainty: PredictionUncertaintyLike;
  readonly provenance: PredictionProvenanceLike;
  readonly correlationId: CorrelationId;
  readonly producedAt: string;
  readonly provenanceChainDigest: string;
}

/**
 * The union of a prediction and a counterfactual — STRUCTURAL twin of
 * the W154 `WorldModelPredictionRecord`. The `kind` field is the
 * discriminator (the W155 bridge branches on `kind` to detect
 * counterfactuals and carry the hypothetical marker through the
 * conversion — invariant 4).
 */
export type WorldModelPredictionRecordLike =
  | WorldModelPredictionLike
  | WorldModelCounterfactualLike;

// ---------------------------------------------------------------------------
// The W070 evaluation-conversion structural seam (the proposal shape MY
// lane's bridge produces, structurally compatible with the W070
// `EvaluationCaseProposalFacet`)
// ---------------------------------------------------------------------------

/**
 * The redaction / de-identification state of an evaluation case —
 * STRUCTURAL twin of the W070 `RedactionStateFacet` (the same
 * machine-stable union; the case carries the state EXPLICITLY, a typed
 * record — never a guessed flag).
 */
export type RedactionStateFacetLike = "raw" | "deidentified" | "redacted";

/** All redaction states (for validation + iteration). */
export const ALL_REDACTION_STATE_FACETS: readonly RedactionStateFacetLike[] = Object.freeze([
  "raw",
  "deidentified",
  "redacted",
]);

/**
 * The ground-truth outcome an evaluation case carries — STRUCTURAL twin
 * of the W070 `EvaluationOutcomeFacet`. The W155 bridge produces a
 * PENDING outcome at conversion time (`label: "prediction_pending"`,
 * `value: <estimateKind>`, `observedAt: <producedAt>`, empty
 * `evidenceRefs`); the W155 outcome binding (D3) REPLACES the
 * placeholder with the actual observed ground truth when the outcome
 * materializes.
 */
export interface EvaluationOutcomeFacetLike {
  /** The outcome label (machine-stable). */
  readonly label: string;
  /** The outcome value (machine-stable). */
  readonly value: string;
  /** The injected observation instant of the outcome (ISO 8601). */
  readonly observedAt: string;
  /** The evidence artifacts supporting the outcome (content-addressable refs). */
  readonly evidenceRefs: readonly EvidenceRef[];
}

/**
 * An evaluation label — a key/value pair annotating the case with
 * ground truth. STRUCTURAL twin of the W070 `EvaluationLabelFacet`.
 */
export interface EvaluationLabelFacetLike {
  /** The label key (machine-stable). */
  readonly key: string;
  /** The label value (machine-stable string). */
  readonly value: string;
}

/**
 * The redaction / de-identification state record — STRUCTURAL twin of
 * the W070 `RedactionRecordFacet`.
 */
export interface RedactionRecordFacetLike {
  /** The redaction state. */
  readonly state: RedactionStateFacetLike;
  /** The tenant policy refs that governed the redaction (may be empty — caller-supplied). */
  readonly appliedPolicies: readonly string[];
}

/**
 * The evaluation-case submission proposal's case payload — STRUCTURAL
 * twin of the W070 `EvaluationCaseProposalFacet` (problem class,
 * normalized observation refs, context, action history refs, outcome
 * ground truth, evaluation labels, tenant policy refs, typed redaction
 * state). The real arena adapter's input type is structurally assignable
 * to this facet (bidirectional structural compatibility — proven by
 * test: a converted proposal's `case` flows through the REAL
 * `submitEvaluationCase` unchanged when the binding site submits it).
 */
export interface EvaluationCaseProposalFacetLike {
  /** The problem class (machine-stable string — the capability class the case concerns). */
  readonly problemClass: string;
  /** The normalized observation refs (content-addressable strings — opaque to the control plane). */
  readonly observationRefs: readonly string[];
  /** The case context (JSON-serializable — the situation the case arose in). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The action history refs (content-addressable strings — past actions/intents the case cites). */
  readonly actionHistoryRefs: readonly string[];
  /** The ground-truth outcome. */
  readonly outcome: EvaluationOutcomeFacetLike;
  /** The evaluation labels (ground-truth annotations). */
  readonly labels: readonly EvaluationLabelFacetLike[];
  /** The tenant policy refs in force at submission (content-addressable strings). */
  readonly tenantPolicyRefs: readonly string[];
  /** The redaction / de-identification state. */
  readonly redaction: RedactionRecordFacetLike;
}

/**
 * The gated proposal's disposition — STRUCTURAL twin of the W070
 * `EvaluationCaseDisposition`. The projection of the FROZEN
 * `GuardianDecision` onto the proposal's fate:
 *   - ALLOW / WARN          -> PROPOSED (the case may be submitted);
 *   - REQUIRE_APPROVAL      -> PARKED   (held for human review);
 *   - BLOCK                 -> REJECTED (refused with the Guardian's reasons).
 */
export type EvaluationCaseDispositionLike = "PROPOSED" | "PARKED" | "REJECTED";

/**
 * The W155 bridge's evaluation-case submission proposal — STRUCTURAL
 * twin of the W070 `EvaluationCaseSubmissionProposal` PLUS the
 * predictive-specific extension (the source prediction id + the
 * machine-carried hypothetical marker, which survives the conversion).
 *
 * The proposal is the W155 bridge's OUTPUT (the closed loop's
 * midsection): a prediction → proposal → (outcome observed) → outcome
 * observation → evaluation → adoption. The W155 bridge produces the
 * proposal with a PENDING outcome (the ground truth arrives later via
 * D3); the W070 arena adapter consumes the proposal's `case` shape
 * UNCHANGED when the binding site submits it (after the outcome is
 * bound and the ground truth is filled in).
 *
 * The proposal is GATED by the FROZEN `GuardianDecision` (from
 * `@fleetos/contracts` — produced by the real W031 engine at the
 * binding site). The mapping is the STRUCTURAL TWIN of the W070
 * `decisionToDisposition` (same decision types, same semantics). The
 * bridge NEVER submits — there is NO submission path inside this
 * package (machine-tested: no `submit()` function exists).
 */
export interface PredictiveEvaluationProposalLike extends TenantScoped {
  /** Deterministic proposal identity: `wcp_` + sha256(tenant, prediction, case content, decision). */
  readonly proposalId: string;
  readonly tenantId: TenantId;
  /** The W154 prediction/counterfactual id this proposal was converted from. */
  readonly sourcePredictionId: string;
  /** The W154 prediction's kind discriminator (`"prediction"` | `"counterfactual"`). */
  readonly sourcePredictionKind: "prediction" | "counterfactual";
  /**
   * The machine-carried hypothetical marker — SURVIVES the conversion
   * (a counterfactual-derived proposal CARRIES `hypothetical: true`
   * through to the evaluation case; the evaluation loop KNOWS the case
   * was trained on a hypothetical, never a fact — ADR-0002 invariant 4
   * "counterfactuals are HYPOTHETICAL, never facts"). Machine-tested.
   */
  readonly hypothetical: boolean;
  /** The Guardian-gated disposition. */
  readonly disposition: EvaluationCaseDispositionLike;
  /** The case payload (structurally assignable to the W070 arena submission input). */
  readonly case: EvaluationCaseProposalFacetLike;
  /** The FROZEN Guardian decision that gated the proposal (verbatim). */
  readonly guardianDecision: GuardianDecision;
  /** Canonical digest of the proposal's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// The W070 outcome-observation structural seam (the record shape MY
// lane's outcome binding produces, structurally compatible with the W070
// `OutcomeObservation`)
// ---------------------------------------------------------------------------

/**
 * The W155 outcome-binding source surface — a NEW surface the W070
 * module map does not include (the W070 four surfaces are health /
 * action plan / aurum delivery / maintenance; the W155 lane adds the
 * PREDICTIVE surface — a prediction's outcome, observed at the horizon's
 * end). The W070 closed loop's intake expands from four surfaces to
 * five; the binding record's `sourceSurface` is `world-model.prediction`
 * (machine-stable).
 */
export const PREDICTIVE_OUTCOME_SOURCE_SURFACE = "world-model.prediction" as const;

/**
 * The problem class of the predictive-evaluation surface's evaluation
 * cases. Machine-stable; the W155 bridge produces
 * `world-model.prediction.<estimateKind>` (the W154 prediction's target
 * family — e.g. `world-model.prediction.device_health_trajectory`).
 */
export const PREDICTIVE_PROBLEM_CLASS_PREFIX = "world-model.prediction" as const;

/**
 * The ground-truth annotation an outcome binding carries — STRUCTURAL
 * twin of the W070 `OutcomeGroundTruth`. The label/value are
 * machine-stable strings; the binding's caller (the actor that observed
 * the actual device health/cadence at the horizon's end) supplies the
 * ground truth. The W155 lane NEVER re-derives or fabricates a ground
 * truth — the binding REFUSES machine-stably when the caller-supplied
 * ground truth is empty (the trust anchor discipline).
 */
export interface OutcomeGroundTruthLike {
  /** The outcome label (machine-stable — e.g. "device_health_observed"). */
  readonly label: string;
  /** The outcome value (machine-stable; the caller defines the value set). */
  readonly value: string;
}

/**
 * The W155 outcome-binding record — STRUCTURAL twin of the W070
 * `OutcomeObservation` PLUS the predictive-specific extension (the
 * source prediction id + the predicted estimate/uncertainty, which the
 * evaluation loop scores the binding against). This is the record that
 * feeds the W070 evaluation loop: the binding's `outcome` carries the
 * GROUND TRUTH (the observed device health/cadence at the horizon's
 * end), and the `context` carries the prediction's estimate +
 * uncertainty (for the evaluation to score the prediction's accuracy).
 *
 * The closed loop CLOSES here: prediction → proposal → (outcome
 * observed) → outcome binding → evaluation → (eventual adoption). The
 * binding is the JOIN of the observed outcome to the PREDICTED estimate
 * (by prediction id + the provenance chain).
 */
export interface PredictiveOutcomeBindingLike extends TenantScoped {
  /** Deterministic binding identity: `wcb_` + sha256(tenant, prediction, outcome, observedAt). */
  readonly bindingId: string;
  readonly tenantId: TenantId;
  /** The W154 prediction/counterfactual id this binding is joined to. */
  readonly sourcePredictionId: string;
  /** The W154 prediction's kind discriminator (`"prediction"` | `"counterfactual"`). */
  readonly sourcePredictionKind: "prediction" | "counterfactual";
  /** The machine-carried hypothetical marker — SURVIVES through the binding (the W154 marker propagated). */
  readonly hypothetical: boolean;
  /** The W070 outcome-observation surface (machine-stable — `world-model.prediction`). */
  readonly sourceSurface: typeof PREDICTIVE_OUTCOME_SOURCE_SURFACE;
  /** The W154 prediction id (the entity the binding is about). */
  readonly subjectRef: string;
  /** The problem class of the evaluation cases this binding feeds. */
  readonly problemClass: string;
  /** The device the binding concerns (the W154 prediction's target.deviceId). */
  readonly deviceId: DeviceId;
  /** Normalized observation refs (the prediction's evidence chain — representation + featureSet + contextObservations). */
  readonly observationRefs: readonly string[];
  /** Normalized action history refs (the counterfactual's candidateAction.ref when present + the prediction's correlationId). */
  readonly actionHistoryRefs: readonly string[];
  /** The situation the binding arose in (target/horizon/predictedEstimate/predictedUncertainty/hypothetical/candidateAction?). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The GROUND-TRUTH outcome (the observed device health/cadence at the horizon's end). */
  readonly outcome: OutcomeGroundTruthLike;
  /** The evidence artifacts supporting the outcome (the observed evidence + the prediction's evidence chain). */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The INJECTED observation instant (ISO 8601 — the moment the outcome was observed, never a clock read). */
  readonly observedAt: string;
  /** Canonical digest of the binding's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// The W022 workloads structural seam (the workload-assignment surface
// MY lane's projection derives from)
// ---------------------------------------------------------------------------

/**
 * A W022 workload-assignment facet — STRUCTURAL twin of the W022
 * `WorkloadRecommendation` + `WorkloadProfile` surfaces the W155
 * projection consumes (the recommendation's status IS the assignment's
 * stage/phase — ACTIVE / SUPERSEDED / DISMISSED). The binding site
 * (tests) injects the REAL `@fleetos/workloads`
 * `resolveActiveRecommendations(ledger)` output + the corresponding
 * `WorkloadProfile` records; TypeScript structural typing means the
 * real W022 records satisfy this interface without a cross-lane src/
 * import.
 *
 * The W155 projection branches on the `stage` to derive the
 * `workload_assignment` context observation's value
 * (`WorkloadAssignmentValue`); the provenance refs are the workload
 * profile id + the recommendation id + the recommendation's evidence
 * refs (the same discipline as the W153 feature provenance).
 */
export interface WorkloadAssignmentFacet {
  /** The workload identity (stable across revisions). */
  readonly workloadId: string;
  /** The workload profile revision (1-based, immutable per revision). */
  readonly profileRevision: number;
  /** The recommendation id (`rec_` + digest). */
  readonly recommendationId: string;
  /** The recommended candidate id (device class / procurement offering). */
  readonly candidateId: string;
  /** The recommendation's derived status (the "stage/phase"). */
  readonly stage: "ACTIVE" | "SUPERSEDED" | "DISMISSED" | "unknown";
  /** The recommendation's kind (device-class | procurement). */
  readonly kind: "device-class" | "procurement";
  /** The recommendation's confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The profile's evidence refs (the workload profile's observation evidence). */
  readonly evidenceRefs: readonly string[];
  /** The INJECTED recommendation timestamp (ISO 8601). */
  readonly recommendedAt: string;
}

// ---------------------------------------------------------------------------
// The procurement structural seam (the procurement-stage surface MY
// lane's projection derives from)
// ---------------------------------------------------------------------------

/**
 * A procurement-stage facet — STRUCTURAL twin of the procurement
 * package's `ProcurementDemand` + `Quote` + `QuoteLedger` surfaces the
 * W155 projection consumes (the quote's status IS the procurement
 * stage — DRAFT / ISSUED / ACCEPTED / SUPERSEDED / REJECTED). The
 * binding site (tests) injects the REAL `@fleetos/procurement`
 * `ProcurementDemand` records + the corresponding `QuoteLedger` /
 * `quoteStatus(ledger, quoteId)` outputs; TypeScript structural typing
 * means the real procurement records satisfy this interface without a
 * cross-lane src/ import.
 *
 * The W155 projection branches on the `stage` to derive the
 * `procurement_stage` context observation's value
 * (`ProcurementStageValue`); the provenance refs are the demand id +
 * the active quote id (when present).
 */
export interface ProcurementStageFacet {
  /** The procurement demand id (`dmd_` + digest). */
  readonly demandId: string;
  /** The workload this demand serves. */
  readonly workloadId: string;
  /** The demand quantity (default 1). */
  readonly quantity: number;
  /** The active quote id (when a quote exists; empty when no quote yet). */
  readonly activeQuoteId: string;
  /** The procurement stage (the quote's derived status — DRAFT / ISSUED / ACCEPTED / SUPERSEDED / REJECTED). */
  readonly stage: "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED" | "unknown";
  /** The INJECTED demand creation timestamp (ISO 8601). */
  readonly createdAt: string;
  /** The customer deadline (injected, ISO 8601). */
  readonly deadline: string;
}
