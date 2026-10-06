/**
 * @fleetos/web — W156 (TL convergence): the PREDICTIVE TWIN ADVISORY binding.
 *
 * The Wave-14 convergence lane (issue #3; ADR-0002 ACCEPTED): bind the
 * three predictive packages into the product WITHOUT changing the
 * canonical Device Twin semantics —
 *
 *   - `@fleetos/predictive`   (W153) — the device-history feature /
 *                                     provenance feed: the extractor is
 *                                     consumed through its PUBLIC API
 *                                     (`extractDeviceHistoryFeatures`),
 *                                     with the privacy seam INJECTED at
 *                                     this binding site (the W040
 *                                     pattern, adjudicated in the W153
 *                                     + W154 merge records);
 *   - `@fleetos/world-model`  (W154) — the model-neutral engine:
 *                                     consumed through the
 *                                     `WorldModelAdapter` INTERFACE
 *                                     ONLY (the adapter-interface-only
 *                                     law, adjudicated in the W154
 *                                     merge — the D1/D2 functions are
 *                                     NEVER imported here); the
 *                                     deterministic REFERENCE adapter
 *                                     is what the product binds (no
 *                                     GPU, no model provider, no
 *                                     network — ADR-0002 invariant 8);
 *   - `@fleetos/world-context`(W155) — the workload/procurement context
 *                                     projection (`buildWorldModelContext`)
 *                                     + the Learning/Arena evaluation
 *                                     bridge (`convertPredictionToEvaluationProposal`
 *                                     — the PROPOSAL-GATED law: the
 *                                     bridge NEVER submits).
 *
 * ADR-0002 § "Acceptance" mapping (every bullet machine-tested in
 * `apps/web/test/w156-predictive-advisory.test.ts`):
 *   - the canonical Device Twin remains authoritative — the OBSERVED
 *     section of the advisory view model is sourced from the twin's own
 *     telemetry section ONLY; the predicted/hypothetical sections are
 *     ADVISORY records that carry `advisory: true` machine markers and
 *     have NO authorization surface (no action, no execution, no
 *     mutation path — the view model's type is the proof);
 *   - deterministic reference behavior exists — the reference adapter
 *     is pure TypeScript arithmetic; the whole advisory build is PURE
 *     (every timestamp INJECTED — no clock, no entropy, no I/O);
 *   - predictions carry evidence/version/uncertainty/provenance — the
 *     predicted/hypothetical sections surface the W154 uncertainty
 *     metadata, the capability version, the evidence-ref count, the
 *     feature-set input digest, the context digest and the provenance
 *     chain digest VERBATIM (nothing re-derived, nothing fabricated);
 *   - counterfactual outputs are visibly distinct from observed facts —
 *     the HYPOTHETICAL section exists ONLY when a candidate action is
 *     supplied, carries the W154 machine marker `hypothetical: true`
 *     surfaced as a first-class field, and is a SEPARATE section from
 *     both the observed twin state and the unconditional prediction;
 *   - unavailable-model behavior is fail-closed and honest — an
 *     unavailable adapter yields the `degraded` view with reason
 *     `model_unavailable` (NEVER a fabricated estimate); a thin feed
 *     (insufficient history / empty window / rejected) yields the
 *     `degraded` view with the W153 feed's own reason, propagated
 *     VERBATIM (never zero-filled);
 *   - tenant isolation is machine-tested — the cross-tenant inputs are
 *     refused by the underlying guards and surfaced as hard errors;
 *   - no predictive result can bypass Guardian authorization — the
 *     Arena note (`buildEvaluationAdvisoryNote`) is the W155 bridge's
 *     PROPOSAL disposition under the FROZEN GuardianDecision
 *     (ALLOW/WARN → PROPOSED, REQUIRE_APPROVAL → PARKED, BLOCK →
 *     REJECTED) — an advisory NOTE, never a submission;
 *   - at least one real FleetOS journey demonstrates predictive output
 *     used as advisory context — the Device Doctor → device lifecycle
 *     route renders the Predictive Twin advisory panel over the REAL
 *     session twin store (the console binding);
 *   - the capability can be exported/evaluated through Arena without
 *     making Arena operational truth — the evaluation note documents
 *     the PROPOSED/PARKED/REJECTED disposition; adoption happens only
 *     through explicit versioned adoption records (the W070 law);
 *   - live product UI clearly distinguishes observed, predicted and
 *     hypothetical state — the view model's three sections are
 *     type-distinct and the panel renders them with distinct labels.
 *
 * The deployment configuration remains optional-GPU/provider-neutral:
 * this module takes the adapter as an INJECTED parameter — the product
 * binds the deterministic reference adapter; a future provider adapter
 * (JEPA-family or other) plugs in at the same seam WITHOUT changing
 * this module or its consumers.
 *
 * PURE + DETERMINISTIC: no clock reads, no entropy, no I/O; every
 * timestamp is injected by the caller. Strict TS; no `any` in public
 * signatures. Zero runtime dependencies beyond the workspace packages'
 * public APIs.
 */

import type { CorrelationId, DeviceId, Observation, TenantId } from "@fleetos/contracts";
import type { FleetError } from "@fleetos/contracts";
import { asTenantId, asCorrelationId } from "@fleetos/contracts";
import { extractDeviceHistoryFeatures } from "@fleetos/predictive";
import type { PrivacyRedactionSeam } from "@fleetos/predictive";
import type { DeviceHistoryFeatureSet } from "@fleetos/predictive";
import type { WorldModelAdapter, WorldModelPrediction, WorldModelCounterfactual } from "@fleetos/world-model";
import { PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY } from "@fleetos/world-model";
import { buildWorldModelContext, convertPredictionToEvaluationProposal } from "@fleetos/world-context";
import type { ProcurementStageFacet, WorkloadAssignmentFacet } from "@fleetos/world-context";
import type { GuardianDecision } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The structural twin seam (the OBSERVED state's source of truth)
// ---------------------------------------------------------------------------

/**
 * The consumed subset of the Device Twin — the OBSERVED state's ONLY
 * source. The canonical Device Twin remains authoritative (ADR-0002):
 * this module READS the twin's telemetry section (the bounded window
 * of latest admitted canonical observations) and never derives the
 * observed state from anything else.
 *
 * STRUCTURAL seam (the W040 pattern): the REAL `DeviceTwinLike` from
 * `@fleetos/web-device`'s seams satisfies this shape structurally —
 * the console binding passes the session twin store's record directly.
 */
export interface PredictiveAdvisoryTwinLike {
  readonly deviceId: DeviceId;
  readonly telemetry: {
    readonly lastObservedAt: string | null;
    readonly observationCount: number;
    readonly latest: readonly Observation[];
  };
}

// ---------------------------------------------------------------------------
// The advisory input (every timestamp INJECTED; the adapter INJECTED)
// ---------------------------------------------------------------------------

/**
 * The candidate action a hypothetical (counterfactual) estimate is
 * conditioned on. The action is NEVER executed (ADR-0002 invariant 5:
 * "Predictions NEVER authorize or execute actions") — the ref is
 * carried into the counterfactual's provenance chain only.
 */
export interface AdvisoryCandidateAction {
  readonly ref: string;
  readonly description: string;
}

/** The advisory build's input. PURE: every timestamp injected by the caller. */
export interface PredictiveAdvisoryInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: { readonly tenantId: TenantId };
  /** The device the advisory is for (MUST match the twin's deviceId). */
  readonly deviceId: DeviceId;
  /** The device twin (the OBSERVED state's source of truth). */
  readonly twin: PredictiveAdvisoryTwinLike;
  /** The injected world-model adapter (the seam — the reference adapter in the product). */
  readonly adapter: WorldModelAdapter;
  /** The workload assignment facets in scope (the W155 projection's input; empty = honest minimal). */
  readonly workloadAssignments?: readonly WorkloadAssignmentFacet[];
  /** The procurement stage facets in scope (the W155 projection's input; empty = honest minimal). */
  readonly procurementStages?: readonly ProcurementStageFacet[];
  /** The absolute feature/advisory window [from, to). */
  readonly window: { readonly from: string; readonly to: string };
  /** The INJECTED reference instant (ISO 8601) — the advisory's `asOf`/`producedAt`. */
  readonly asOf: string;
  /** The prediction horizon (milliseconds from `asOf`). */
  readonly horizonMs: number;
  /** The candidate action the HYPOTHETICAL section is conditioned on (omitted = no hypothetical section). */
  readonly candidateAction?: AdvisoryCandidateAction;
  /** The privacy/consent/redaction seam (default: the pass-through; injected at this binding site per the W040 pattern). */
  readonly privacy?: PrivacyRedactionSeam;
  /** The correlation id of the advisory request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

// ---------------------------------------------------------------------------
// The advisory view model (observed | predicted | hypothetical — distinct)
// ---------------------------------------------------------------------------

/** The OBSERVED section — sourced from the canonical Device Twin ONLY. */
export interface PredictiveObservedSection {
  readonly kind: "observed";
  /** The twin's latest admitted observation instant (null = none). */
  readonly lastObservedAt: string | null;
  /** The twin's total admitted canonical observation count. */
  readonly observationCount: number;
  /** The observations inside the advisory window [from, to). */
  readonly windowObservationCount: number;
  readonly windowFrom: string;
  readonly windowTo: string;
}

/** The honest uncertainty metadata, carried VERBATIM from the W154 record. */
export interface AdvisoryUncertainty {
  readonly lower: number;
  readonly upper: number;
  readonly spread: number;
  readonly confidence: number;
  readonly observationCount: number;
  readonly recencyWeight: number;
}

/** The PREDICTED section — an ADVISORY estimate (machine-marked, never business truth). */
export interface PredictivePredictedSection {
  readonly kind: "predicted";
  /** The machine marker: this section is ADVISORY, never the twin's state. */
  readonly advisory: true;
  readonly estimateKind: string;
  readonly estimate: number;
  readonly uncertainty: AdvisoryUncertainty;
  readonly horizonMs: number;
  readonly producedAt: string;
  readonly capability: { readonly name: string; readonly version: number };
}

/**
 * The HYPOTHETICAL section — the counterfactual conditioned on a
 * candidate action. Exists ONLY when a candidate action was supplied;
 * carries the W154 machine-carried `hypothetical: true` marker as a
 * first-class field (a counterfactual can NEVER render as fact).
 */
export interface PredictiveHypotheticalSection {
  readonly kind: "hypothetical";
  readonly hypothetical: true;
  readonly candidateAction: { readonly ref: string; readonly description: string };
  readonly estimateKind: string;
  readonly estimate: number;
  readonly uncertainty: AdvisoryUncertainty;
  readonly horizonMs: number;
  readonly producedAt: string;
  readonly capability: { readonly name: string; readonly version: number };
}

/** The model-health section (the adapter's public face). */
export interface PredictiveModelSection {
  readonly capabilityName: string;
  readonly capabilityVersion: number;
  readonly available: boolean;
  /** The unavailability reason (when `available` is false). */
  readonly unavailableReason: string | null;
}

/** The provenance section — the evidence chain, carried VERBATIM. */
export interface PredictiveProvenanceSection {
  readonly featureSetInputDigest: string;
  readonly contextDigest: string;
  readonly provenanceChainDigest: string;
  readonly evidenceRefCount: number;
  readonly inputObservationRefCount: number;
  readonly contextObservationCount: number;
}

/** The context-projection summary (the W155 projection's honest shape). */
export interface PredictiveContextSection {
  readonly workloadAssignmentCount: number;
  readonly procurementStageCount: number;
}

/** The READY advisory view: observed + predicted (+ hypothetical) + model + provenance + context. */
export interface PredictiveAdvisoryReadyView {
  readonly kind: "ready";
  readonly observed: PredictiveObservedSection;
  readonly predicted: PredictivePredictedSection;
  /** The hypothetical section — null when no candidate action was supplied. */
  readonly hypothetical: PredictiveHypotheticalSection | null;
  readonly model: PredictiveModelSection;
  readonly provenance: PredictiveProvenanceSection;
  readonly context: PredictiveContextSection;
  /**
   * The W154 source records (carried for downstream advisory consumers —
   * e.g. the Arena note builder converts the prediction into the W155
   * evaluation PROPOSAL under the Guardian decision). The records are
   * ADVISORY evidence, never business truth.
   */
  readonly sourcePrediction: WorldModelPrediction;
  readonly sourceCounterfactual: WorldModelCounterfactual | null;
}

/**
 * The DEGRADED advisory view — the honest states (ADR-0002 invariant 6:
 * a failed or unavailable predictive model degrades to an honest
 * deterministic/unknown state rather than fabricating confidence).
 * The OBSERVED section + the model-health section are still present
 * (the twin remains authoritative; the model's state is visible).
 */
export interface PredictiveAdvisoryDegradedView {
  readonly kind: "degraded";
  readonly reason:
    | "insufficient_history"
    | "empty_window"
    | "rejected"
    | "model_unavailable";
  /** The propagated detail (the W153 feed's reason / the adapter's reason — VERBATIM, never fabricated). */
  readonly detail: string;
  readonly observed: PredictiveObservedSection;
  readonly model: PredictiveModelSection;
}

/** The advisory view model — the discriminated union the UI renders. */
export type PredictiveAdvisoryView = PredictiveAdvisoryReadyView | PredictiveAdvisoryDegradedView;

/** The tagged result of an advisory build. */
export type PredictiveAdvisoryBuild =
  | { readonly ok: true; readonly advisory: PredictiveAdvisoryView }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The Arena advisory note (the W155 bridge disposition — never a submission)
// ---------------------------------------------------------------------------

/**
 * The Arena advisory note: the W155 bridge's PROPOSAL disposition under
 * the FROZEN GuardianDecision. This is an advisory NOTE for the product
 * UI — the bridge NEVER submits (the W070 arena adapter owns the
 * submission ledger); adoption happens only through explicit versioned
 * adoption records.
 */
export interface EvaluationAdvisoryNote {
  /** The proposal disposition under the Guardian decision. */
  readonly disposition: "PROPOSED" | "PARKED" | "REJECTED";
  /** The deterministic proposal id (`wcp_` + digest). */
  readonly proposalId: string;
  /** Whether the source record was a counterfactual (the hypothetical marker survives conversion). */
  readonly hypothetical: boolean;
  /** The machine marker: an advisory NOTE — never a submission. */
  readonly advisory: true;
}

/** The tagged result of a note build (a refusal yields the typed error — never a fabricated note). */
export type EvaluationAdvisoryNoteBuild =
  | { readonly ok: true; readonly note: EvaluationAdvisoryNote }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The procurement facet derivation (the structural demand mapping)
// ---------------------------------------------------------------------------

/**
 * The consumed subset of a procurement demand record (the structural
 * seam — the REAL demand records from the workloads/commerce surfaces
 * satisfy this shape structurally; the console binding passes the
 * demo tier's REAL demand records).
 */
export interface ProcurementDemandLike {
  readonly demandId: string;
  readonly workloadId: string;
  readonly quantity: number;
  readonly createdAt: string;
  readonly deadline: string;
}

/**
 * Derive the W155 procurement stage facets from structural demand
 * records. PURE: the stage is `unknown` when no quote exists (the
 * honest pre-quote state — the W155 projection includes such open
 * cases; REJECTED/SUPERSEDED are excluded by the projection itself).
 * NEVER fabricates a quote id: `activeQuoteId` is empty when absent.
 */
export function deriveProcurementStageFacets(
  demands: readonly ProcurementDemandLike[],
): readonly ProcurementStageFacet[] {
  if (!Array.isArray(demands)) return [];
  const facets: ProcurementStageFacet[] = [];
  for (const demand of demands) {
    if (demand === null || demand === undefined) continue;
    if (
      typeof demand.demandId !== "string" || demand.demandId.length === 0 ||
      typeof demand.workloadId !== "string" || demand.workloadId.length === 0 ||
      typeof demand.createdAt !== "string" || typeof demand.deadline !== "string"
    ) {
      continue;
    }
    facets.push({
      demandId: demand.demandId,
      workloadId: demand.workloadId,
      quantity: typeof demand.quantity === "number" && demand.quantity > 0 ? demand.quantity : 1,
      activeQuoteId: "",
      stage: "unknown",
      createdAt: demand.createdAt,
      deadline: demand.deadline,
    });
  }
  return facets;
}

// ---------------------------------------------------------------------------
// The advisory build (the W153 → W155 → W154 pipeline, honestly propagated)
// ---------------------------------------------------------------------------

/** Count the observations inside the absolute window [from, to). PURE. */
function countInWindow(
  observations: readonly Observation[],
  from: string,
  to: string,
): number {
  let count = 0;
  for (const obs of observations) {
    if (typeof obs?.observedAt === "string" && obs.observedAt >= from && obs.observedAt < to) {
      count += 1;
    }
  }
  return count;
}

/** Build the OBSERVED section from the twin (the ONLY observed source). PURE. */
function observedSection(
  twin: PredictiveAdvisoryTwinLike,
  window: { readonly from: string; readonly to: string },
): PredictiveObservedSection {
  return {
    kind: "observed",
    lastObservedAt: twin.telemetry.lastObservedAt,
    observationCount: twin.telemetry.observationCount,
    windowObservationCount: countInWindow(twin.telemetry.latest, window.from, window.to),
    windowFrom: window.from,
    windowTo: window.to,
  };
}

/** Build the model-health section from the adapter's public face. PURE. */
function modelSection(
  adapter: WorldModelAdapter,
  scope: { readonly tenantId: TenantId },
): PredictiveModelSection {
  const availability = adapter.capability.isAvailable(scope);
  return {
    capabilityName: adapter.capability.name,
    capabilityVersion: adapter.capability.version,
    available: availability.ok,
    unavailableReason: availability.ok ? null : availability.reason,
  };
}

/** The honest uncertainty metadata, carried VERBATIM from the W154 record. PURE. */
function uncertaintyOf(uncertainty: {
  readonly lower: number;
  readonly upper: number;
  readonly spread: number;
  readonly confidence: number;
  readonly observationCount: number;
  readonly recencyWeight: number;
}): AdvisoryUncertainty {
  return {
    lower: uncertainty.lower,
    upper: uncertainty.upper,
    spread: uncertainty.spread,
    confidence: uncertainty.confidence,
    observationCount: uncertainty.observationCount,
    recencyWeight: uncertainty.recencyWeight,
  };
}

/**
 * Build the Predictive Twin advisory view model.
 *
 * The pipeline (every stage's honest state PROPAGATES — never zero-filled,
 * never fabricated):
 *   1. W153 `extractDeviceHistoryFeatures` over the twin's telemetry
 *      window — the feed's non-ok statuses yield the DEGRADED view with
 *      the feed's own reason;
 *   2. W155 `buildWorldModelContext` over the workload/procurement
 *      facets — the projection's refusals yield hard errors;
 *   3. the injected adapter's `represent` — an unavailable adapter (or
 *      an unavailable-model representation) yields the DEGRADED view
 *      with reason `model_unavailable`;
 *   4. the adapter's `predict` (+ `predictAfterAction` when a candidate
 *      action is supplied) — the advisory sections carry the records'
 *      uncertainty/provenance VERBATIM.
 *
 * PURE: every timestamp injected; no clock, no entropy, no I/O.
 */
export function buildPredictiveAdvisory(input: PredictiveAdvisoryInput): PredictiveAdvisoryBuild {
  if (input === null || input === undefined) {
    return {
      ok: false,
      error: makeInputError({ tenantId: asTenantId("tnt_system") }, "input_required", "the advisory input is required"),
    };
  }
  const { scope, deviceId, twin, adapter, window, asOf } = input;

  // ---- 0. The twin/device coherence guard --------------------------------
  if (twin === null || twin === undefined || twin.deviceId !== deviceId) {
    return {
      ok: false,
      error: makeInputError(scope, "twin_device_coherence", "the advisory twin must carry the same deviceId as the advisory request"),
    };
  }

  const observed = observedSection(twin, window);
  const model = modelSection(adapter, scope);

  // ---- 1. The adapter availability (fail-closed, honest) -----------------
  const availability = adapter.capability.isAvailable(scope);
  if (!availability.ok) {
    const degraded: PredictiveAdvisoryDegradedView = {
      kind: "degraded",
      reason: "model_unavailable",
      detail: availability.reason,
      observed,
      model,
    };
    return { ok: true, advisory: degraded };
  }

  // ---- 2. The W153 feature feed (the honest status propagates) -----------
  const feed = extractDeviceHistoryFeatures({
    tenantId: scope.tenantId,
    deviceId,
    observations: twin.telemetry.latest,
    window: { from: window.from, to: window.to },
    extractedAt: asOf,
    privacy: input.privacy,
    correlationId: input.correlationId,
  });
  if (!feed.ok) {
    return { ok: false, error: feed.error };
  }
  const featureSet: DeviceHistoryFeatureSet = feed.featureSet;
  if (featureSet.status.kind !== "ok") {
    // The honest degraded feed — the W153 status's own reason, VERBATIM
    // (never zero-filled features, never fabricated confidence).
    const status = featureSet.status as {
      readonly kind: string;
      readonly reason?: string;
      readonly minimumRequired?: number;
      readonly detail?: string;
    };
    const detail =
      status.kind === "insufficient_history"
        ? `${status.reason ?? "below_minimum_count"} (minimum ${status.minimumRequired ?? 2})`
        : String(status.reason ?? status.detail ?? status.kind);
    const degraded: PredictiveAdvisoryDegradedView = {
      kind: "degraded",
      reason: status.kind === "insufficient_history" || status.kind === "empty_window" || status.kind === "rejected"
        ? status.kind
        : "rejected",
      detail,
      observed,
      model,
    };
    return { ok: true, advisory: degraded };
  }

  // ---- 3. The W155 context projection (the workload/procurement state) ---
  const contextBuild = buildWorldModelContext({
    scope: { tenantId: scope.tenantId },
    deviceId,
    asOf,
    workloadAssignments: input.workloadAssignments ?? [],
    procurementStages: input.procurementStages ?? [],
  });
  if (!contextBuild.ok) {
    return { ok: false, error: contextBuild.error };
  }
  const context = contextBuild.context;

  // ---- 4. The W154 representation (through the adapter interface) --------
  const representationBuild = adapter.represent({
    scope: { tenantId: scope.tenantId },
    featureSet,
    context,
  });
  if (!representationBuild.ok) {
    return { ok: false, error: representationBuild.error };
  }
  const representation = representationBuild.representation;
  if (representation.status.kind !== "ok") {
    // The engine's own honest propagation (e.g. the unavailable-model
    // representation state) — surfaced, never fabricated.
    const degraded: PredictiveAdvisoryDegradedView = {
      kind: "degraded",
      reason: "model_unavailable",
      detail: `representation status: ${representation.status.kind}`,
      observed,
      model,
    };
    return { ok: true, advisory: degraded };
  }

  // ---- 5. The unconditional prediction (ADVISORY) ------------------------
  const predictionBuild = adapter.predict({
    scope: { tenantId: scope.tenantId },
    representation,
    target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
    horizon: { horizonMs: input.horizonMs },
    producedAt: asOf,
  });
  if (!predictionBuild.ok) {
    return { ok: false, error: predictionBuild.error };
  }
  const prediction: WorldModelPrediction = predictionBuild.prediction;

  // ---- 6. The counterfactual (HYPOTHETICAL — only when asked) ------------
  let counterfactual: WorldModelCounterfactual | null = null;
  if (input.candidateAction !== undefined) {
    const counterfactualBuild = adapter.predictAfterAction({
      scope: { tenantId: scope.tenantId },
      representation,
      target: PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
      horizon: { horizonMs: input.horizonMs },
      candidateAction: input.candidateAction,
      producedAt: asOf,
    });
    if (!counterfactualBuild.ok) {
      return { ok: false, error: counterfactualBuild.error };
    }
    counterfactual = counterfactualBuild.counterfactual;
  }

  // ---- 7. The view model (observed | predicted | hypothetical) -----------
  const predicted: PredictivePredictedSection = {
    kind: "predicted",
    advisory: true,
    estimateKind: prediction.estimateKind,
    estimate: prediction.estimate,
    uncertainty: uncertaintyOf(prediction.uncertainty),
    horizonMs: input.horizonMs,
    producedAt: prediction.producedAt,
    capability: { name: prediction.capability.name, version: prediction.capability.version },
  };
  const hypothetical: PredictiveHypotheticalSection | null = counterfactual === null
    ? null
    : {
        kind: "hypothetical",
        hypothetical: true,
        candidateAction: {
          ref: counterfactual.candidateAction.ref,
          description: counterfactual.candidateAction.description,
        },
        estimateKind: counterfactual.estimateKind,
        estimate: counterfactual.estimate,
        uncertainty: uncertaintyOf(counterfactual.uncertainty),
        horizonMs: input.horizonMs,
        producedAt: counterfactual.producedAt,
        capability: {
          name: counterfactual.capability.name,
          version: counterfactual.capability.version,
        },
      };
  const ready: PredictiveAdvisoryReadyView = {
    kind: "ready",
    observed,
    predicted,
    hypothetical,
    model,
    provenance: {
      featureSetInputDigest: featureSet.inputDigest,
      contextDigest: representation.contextDigest,
      provenanceChainDigest: prediction.provenanceChainDigest,
      evidenceRefCount: prediction.provenance.evidenceRefs.length,
      inputObservationRefCount: featureSet.inputObservationRefs.length,
      contextObservationCount: representation.contextObservationRefs.length,
    },
    context: {
      workloadAssignmentCount: input.workloadAssignments?.length ?? 0,
      procurementStageCount: input.procurementStages?.length ?? 0,
    },
    sourcePrediction: prediction,
    sourceCounterfactual: counterfactual,
  };
  return { ok: true, advisory: ready };
}

// ---------------------------------------------------------------------------
// The Arena advisory note (the W155 bridge under the FROZEN Guardian decision)
// ---------------------------------------------------------------------------

/**
 * Build the Arena advisory note for a prediction/counterfactual under
 * the FROZEN GuardianDecision: the W155 bridge's PROPOSAL disposition
 * (ALLOW/WARN → PROPOSED, REQUIRE_APPROVAL → PARKED, BLOCK → REJECTED).
 *
 * The note is ADVISORY ONLY — the bridge NEVER submits (machine-tested
 * in the W155 lane: no `submit*` function exists on any surface). The
 * note exists so the product UI can show the Arena intake state
 * honestly ("evaluation proposal: PARKED pending approval") without
 * ever making Arena operational truth.
 */
export function buildEvaluationAdvisoryNote(
  scope: { readonly tenantId: TenantId },
  prediction: WorldModelPrediction | WorldModelCounterfactual,
  guardianDecision: GuardianDecision,
): EvaluationAdvisoryNoteBuild {
  const bridge = convertPredictionToEvaluationProposal(
    { tenantId: scope.tenantId },
    prediction,
    {
      tenantPolicyRefs: ["w156-product-advisory-binding"],
      redaction: { state: "raw", appliedPolicies: [] },
      guardianDecision,
    },
  );
  if (!bridge.ok) {
    return { ok: false, error: bridge.error };
  }
  const proposal = bridge.proposal;
  const note: EvaluationAdvisoryNote = {
    disposition: proposal.disposition,
    proposalId: proposal.proposalId,
    hypothetical: proposal.hypothetical,
    advisory: true,
  };
  return { ok: true, note };
}

// ---------------------------------------------------------------------------
// The input-error helper (a typed FleetError — never a throw)
// ---------------------------------------------------------------------------

/** The advisory binding's own domain (machine-stable). */
const ADVISORY_DOMAIN = "web.predictive_advisory" as const;

/** The advisory binding's own error code (machine-stable). */
const ADVISORY_ERROR_CODE = "fleetos.web.predictive_advisory" as const;

/**
 * A typed DomainError for input validation refusals (the contracts'
 * FleetError union — the callers branch on `ok`; never a throw).
 */
function makeInputError(scope: { readonly tenantId: TenantId }, invariant: string, message: string): FleetError {
  return {
    kind: "DomainError",
    code: ADVISORY_ERROR_CODE,
    message,
    tenantId: scope.tenantId,
    correlationId: asCorrelationId("corr_w156_predictive_advisory"),
    domain: ADVISORY_DOMAIN,
    invariant,
  };
}
