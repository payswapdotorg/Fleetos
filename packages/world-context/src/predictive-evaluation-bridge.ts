/**
 * @fleetos/world-context — D2: the predictive-evaluation bridge.
 *
 * The PURE function family that converts a W154 prediction/counterfactual
 * record (consumed through the structural seam — the W155 lane NEVER
 * imports `@fleetos/world-model` directly) into a Guardian-GATED
 * evaluation-case SUBMISSION PROPOSAL (structurally compatible with the
 * W070 learning package's `EvaluationCaseProposalFacet` — the W155
 * lane NEVER imports `@fleetos/learning` directly). The bridge is the
 * predictive-evaluation loop's INTAKE: a prediction → proposal → (outcome
 * observed) → outcome binding → evaluation → (eventual adoption).
 *
 * Per ADR-0002 § "Hard invariants" + the W155 work order:
 *   3. The PROPOSAL-GATED law: a `GuardianDecision` seam (structural,
 *      like the learning package's) gates ALLOW/WARN → PROPOSED,
 *      REQUIRE_APPROVAL → PARKED, BLOCK → REJECTED. The bridge NEVER
 *      submits — there is NO submission path inside this package
 *      (machine-tested: no `submit()` function exists in the public
 *      surface). The W070 arena adapter owns the submission ledger; the
 *      W155 bridge produces the proposal SHAPE, the binding site
 *      submits it AFTER the outcome is bound + the ground truth is
 *      filled in (the W070 evaluation-conversion's validation refuses
 *      a proposal with a PENDING outcome label — the W070 pipeline is
 *      the ground-truth gate; the W155 bridge is the predictive-evidence
 *      intake).
 *   4. Counterfactual-derived proposals carry the hypothetical marker
 *      THROUGH the conversion (the evaluation case KNOWS it was trained
 *      on a hypothetical, never a fact — ADR-0002 invariant 4
 *      "counterfactuals are HYPOTHETICAL, never facts"). The marker
 *      is machine-carried on THREE surfaces:
 *        - the proposal's top-level `hypothetical: boolean` field;
 *        - the proposal's `case.context.hypothetical` field (the JSON-
 *          serializable context carries the marker for the W070 arena
 *          adapter to read);
 *        - the proposal's `case.labels` array (a `hypothetical: "true" |
 *          "false"` label so the W070 evaluation loop can filter on it).
 *      Machine-tested: a counterfactual-derived proposal's three
 *      surfaces ALL carry `true`/`"true"`; a prediction-derived
 *      proposal's three surfaces ALL carry `false`/`"false"`.
 *   5. Predictions remain ADVISORY until adoption — no predictive
 *      output authorizes/executes/mutates business truth. The bridge's
 *      output is a PROPOSAL (a SHAPE, not an action); the Guardian
 *      decision gates the proposal's fate (PROPOSED / PARKED /
 *      REJECTED), but the gate does NOT submit — the arena adapter
 *      owns the submission.
 *   6. Honest refusals: a non-ok prediction record (the W154 honest
 *      states — a non-ok prediction NEVER exists as a record; the W154
 *      engine returns a typed error, not a non-ok prediction record)
 *      REFUSES the conversion with the reason; cross-tenant REFUSES;
 *      a prediction lacking the provenance chain (the trust anchor
 *      discipline — a prediction record without a `provenanceChainDigest`
 *      or without the `provenance.evidenceRefs` chain REFUSES, never
 *      fabricates the chain).
 *   7. Tenant isolation at every boundary; cross-tenant inputs rejected.
 *   8. Determinism: the same prediction + the same options + the same
 *      Guardian decision => byte-identical proposal. The proposal's
 *      `proposalId` is the SHA-256 over (tenant, prediction id, case
 *      content, decision); the `contentDigest` is the SHA-256 over the
 *      proposal's content fields.
 *  10. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  CausationId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  GuardianDecisionType,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ALL_REDACTION_STATE_FACETS,
  type EvaluationCaseProposalFacetLike,
  type EvaluationCaseDispositionLike,
  type EvaluationLabelFacetLike,
  type EvaluationOutcomeFacetLike,
  PREDICTIVE_PROBLEM_CLASS_PREFIX,
  type PredictionEvidenceRefLike,
  type PredictiveEvaluationProposalLike,
  type RedactionRecordFacetLike,
  type RedactionStateFacetLike,
  type WorldModelCounterfactualLike,
  type WorldModelPredictionLike,
  type WorldModelPredictionRecordLike,
} from "./seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  WORLD_CONTEXT_PIPELINE_CORRELATION_ID,
  canonicalJson,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  normalizeEvidence,
  sha256Hex,
} from "./internal";
import type { WorldContextTenantScope } from "./internal";
import { checkWorldContextTenantScope } from "./internal";
import type { WorldContextAuditSink } from "./audit-seam";
import { NOOP_WORLD_CONTEXT_AUDIT_SINK, WORLD_CONTEXT_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// The frozen bridge schema + bridge algorithm versions
// ---------------------------------------------------------------------------

/**
 * The bridge SCHEMA version — frozen for W155. Bumping this is a
 * contract change requiring an ADR (the W156 lane + the W070 arena
 * adapter consume the proposal's shape; a schema change is a breaking
 * seam change). The schema describes the shape of
 * `PredictiveEvaluationProposalLike`'s fields (proposalId, tenantId,
 * sourcePredictionId, sourcePredictionKind, hypothetical, disposition,
 * case, guardianDecision, contentDigest).
 */
export const BRIDGE_SCHEMA_VERSION = 1 as const;

/**
 * The bridge ALGORITHM version — frozen for W155. Bumping this is a
 * bridge re-derivation: the same prediction + the same options + the
 * same decision at a higher bridge version produce a NEW proposal
 * (the W070 supersession discipline applied to the world-context feed).
 * The first implementation is `1`.
 */
export const BRIDGE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed machine-stable vocabulary
// ---------------------------------------------------------------------------

/**
 * The source-surface label the W155 bridge stamps on every proposal
 * (the W070 evaluation loop branches on `source_surface` to route the
 * case to the right evaluation suite). The W155 lane adds a NEW source
 * surface — `world-model.prediction` — to the W070 module map's four
 * (health / action plan / aurum delivery / maintenance). The W070
 * `ALL_OUTCOME_SOURCE_SURFACES` constant is FROZEN at four; the W155
 * lane's bridge does NOT modify the W070 vocabulary (the proposal's
 * `source_surface` label is the bridge's own — the W070 pipeline does
 * not validate it against the four-surface closed set; it carries the
 * label through to the evaluation case).
 */
export const BRIDGE_SOURCE_SURFACE = "world-model.prediction" as const;

/**
 * The pending-outcome label the bridge stamps on every proposal's
 * `outcome.label` field at conversion time. The ground truth ARRIVES
 * LATER (when the outcome is observed + bound via D3). The W070
 * evaluation-conversion's validation REFUSES an outcome with an empty
 * label — the W155 bridge's PENDING label is non-empty (machine-stable),
 * so a converted proposal's `case.outcome` is structurally valid; the
 * W070 pipeline submits the proposal only AFTER the outcome is bound
 * (the binding REPLACES the PENDING outcome with the actual ground
 * truth).
 */
export const BRIDGE_PENDING_OUTCOME_LABEL = "prediction_pending" as const;

/**
 * The pending-outcome value the bridge stamps on every proposal's
 * `outcome.value` field at conversion time. The value is the W154
 * prediction's `estimateKind` (the trajectory family — e.g.
 * `world-model.target.device_health_trajectory`). This gives the
 * evaluation loop a STABLE IDENTIFIER for the prediction's target
 * family — the loop can group cases by `outcome.value` to score the
 * capability per target.
 */
export const BRIDGE_PENDING_OUTCOME_VALUE_PREFIX = "prediction_pending" as const;

// ---------------------------------------------------------------------------
// The proposal-gate mapping (the W070 `decisionToDisposition` twin)
// ---------------------------------------------------------------------------

/** The gated proposal may be submitted (Guardian ALLOW or WARN). */
export const PROPOSAL_PROPOSED = "PROPOSED" as const;
/** The gated proposal is held for human review (Guardian REQUIRE_APPROVAL). */
export const PROPOSAL_PARKED = "PARKED" as const;
/** The gated proposal is refused (Guardian BLOCK). */
export const PROPOSAL_REJECTED = "REJECTED" as const;

/** All proposal dispositions (for validation + iteration). */
export const ALL_PROPOSAL_DISPOSITIONS: readonly EvaluationCaseDispositionLike[] = Object.freeze([
  PROPOSAL_PROPOSED,
  PROPOSAL_PARKED,
  PROPOSAL_REJECTED,
]);

/**
 * Map a Guardian decision type to the proposal disposition. Pure and
 * deterministic — the STRUCTURAL TWIN of the W070
 * `decisionToDisposition` (same frozen decision types, same semantics):
 *   - ALLOW          -> PROPOSED (the case may be submitted);
 *   - WARN           -> PROPOSED (non-blocking; warnings carried verbatim
 *                        in the frozen decision);
 *   - REQUIRE_APPROVAL -> PARKED   (held for human review; never auto-submitted);
 *   - BLOCK          -> REJECTED  (refused with the Guardian's machine-stable reasons).
 */
export function decisionToDisposition(
  decision: GuardianDecisionType,
): EvaluationCaseDispositionLike {
  if (decision === "ALLOW") return PROPOSAL_PROPOSED;
  if (decision === "WARN") return PROPOSAL_PROPOSED;
  if (decision === "REQUIRE_APPROVAL") return PROPOSAL_PARKED;
  // BLOCK — the proposal is refused with the Guardian's reasons.
  return PROPOSAL_REJECTED;
}

// ---------------------------------------------------------------------------
// The conversion options + result
// ---------------------------------------------------------------------------

/**
 * Options for `convertPredictionToEvaluationProposal`. The bridge
 * NEVER fabricates a redaction state or policy refs — the caller
 * supplies them (the W070 evaluation-conversion's discipline).
 */
export interface BridgeOptions {
  /** The tenant policy refs in force (NON-EMPTY required — the arena submission requires them). */
  readonly tenantPolicyRefs: readonly string[];
  /** The typed redaction state (REQUIRED — the bridge never fabricates a redaction state). */
  readonly redaction: RedactionRecordFacetLike;
  /** Extra ground-truth labels to annotate the case with (derived labels are always present). */
  readonly extraLabels?: readonly EvaluationLabelFacetLike[];
  /** The FROZEN Guardian decision gating the proposal (REQUIRED — the bridge NEVER auto-submits). */
  readonly guardianDecision: GuardianDecision;
  /** The injected audit sink (the conversion + refusal emit; default: no-op). */
  readonly auditSink?: WorldContextAuditSink;
  /** The causation id, when the conversion is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

/** The tagged result of a bridge conversion. */
export type BridgeResult =
  | { readonly ok: true; readonly proposal: PredictiveEvaluationProposalLike }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The deterministic proposal identity + content digest
// ---------------------------------------------------------------------------

/**
 * The deterministic proposal identity. SHA-256 over the canonical
 * serialization of (tenantId, sourcePredictionId, hypothetical, case
 * content, decision). Identical inputs produce identical proposal ids
 * (proven by test).
 */
export function proposalId(
  tenantId: TenantId,
  sourcePredictionId: string,
  hypothetical: boolean,
  caseFacet: EvaluationCaseProposalFacetLike,
  decision: GuardianDecision,
): string {
  return `wcp_${sha256Hex(canonicalJson([
    tenantId,
    sourcePredictionId,
    hypothetical,
    caseFacet,
    decision.decision,
    decision.decidedAt,
    decision.rules,
    decision.evidence,
  ]))}`;
}

/**
 * The canonical content digest of a proposal's CONTENT (identity fields
 * excluded — the digest is over the proposal's substance, not its id).
 */
export function proposalContentDigest(
  proposal: Omit<PredictiveEvaluationProposalLike, "proposalId" | "contentDigest">,
): string {
  return sha256Hex(
    canonicalJson([
      proposal.tenantId,
      proposal.sourcePredictionId,
      proposal.sourcePredictionKind,
      proposal.hypothetical,
      proposal.disposition,
      proposal.case,
      proposal.guardianDecision.decision,
      proposal.guardianDecision.decidedAt,
      proposal.guardianDecision.rules,
      proposal.guardianDecision.evidence,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The bridge function (D2)
// ---------------------------------------------------------------------------

/**
 * Convert a W154 prediction/counterfactual into a Guardian-gated
 * evaluation-case SUBMISSION PROPOSAL. PURE: every input is injected;
 * the bridge reads no clock and no entropy; the bridge NEVER submits
 * (the W070 arena adapter owns the submission ledger).
 *
 * Mapping (verbatim — nothing re-derived, nothing fabricated):
 *   - problemClass       <- `world-model.prediction.<estimateKind>` (the
 *                            W154 prediction's target family, prefixed
 *                            with the W155 bridge's source-surface
 *                            constant);
 *   - observationRefs    <- the prediction's evidence chain (the
 *                            `provenance.evidenceRefs` array — the
 *                            representation digest, the feature-set input
 *                            digest, the context observation refs, the
 *                            candidate-action ref when applicable);
 *   - context            <- { target, horizon, estimate, uncertainty,
 *                            hypothetical, candidateAction? } (the
 *                            prediction's full advisory payload — the
 *                            ground truth arrives LATER via D3);
 *   - actionHistoryRefs  <- the counterfactual's candidateAction.ref
 *                            when present (the action the counterfactual
 *                            is conditioned on — the W154 invariant 5
 *                            "the action is NEVER executed"; the bridge
 *                            carries the REF, never the execution);
 *   - outcome            <- { label: "prediction_pending", value:
 *                            `prediction_pending:<estimateKind>`,
 *                            observedAt: prediction.producedAt,
 *                            evidenceRefs: [] } (the PENDING marker —
 *                            the ground truth arrives LATER via D3,
 *                            when the outcome is observed + bound);
 *   - labels             <- derived (source_surface, subject_ref,
 *                            prediction_kind, hypothetical, device) +
 *                            the caller's extraLabels;
 *   - tenantPolicyRefs   <- options.tenantPolicyRefs (injected);
 *   - redaction          <- options.redaction (injected, typed).
 *
 * Counterfactual visibility (invariant 4): the `hypothetical` marker
 * SURVIVES the conversion on THREE surfaces (the proposal's top-level
 * `hypothetical` field, the `case.context.hypothetical` field, AND the
 * `case.labels` array — machine-tested).
 *
 * Honest refusals (the W154 honest-degradation discipline applied to
 * the bridge):
 *   - a prediction record LACKING the provenance chain (the
 *     `provenanceChainDigest` is empty OR the
 *     `provenance.evidenceRefs` array is empty) => REFUSED with the
 *     reason `missing_provenance_chain` (the trust anchor discipline —
 *     a prediction without a provenance chain cannot become an
 *     evaluation case; the bridge NEVER fabricates the chain);
 *   - cross-tenant (the prediction's `tenantId` does not match the
 *     acting scope's `tenantId`) => REFUSED with the reason
 *     `tenant_mismatch` (invariant 7);
 *   - a Guardian decision whose `tenantId` does not match the acting
 *     scope's `tenantId` => REFUSED with the reason `tenant_mismatch`
 *     (a tenant-A proposal can never be gated by a tenant-B decision —
 *     fail-closed, never a wrong-tenant gate);
 *   - a malformed redaction record / empty tenant policy refs => a
 *     typed ValidationError (the W070 conversion's validation mirrors
 *     these requirements).
 *
 * Audit: the conversion + the refusal ARE CONSEQUENTIAL (a later actor
 * must be able to reconstruct which prediction became which proposal,
 * AND the honest-degradation path). The conversion emits
 * `world-context.bridge.converted`; the refusal emits
 * `world-context.bridge.refused`. PURE: the sink is injected; the
 * `occurredAt` is the prediction's `producedAt`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param prediction the W154 prediction/counterfactual to convert
 * @param options the bridge options (policy refs, redaction, extra labels, Guardian decision, audit sink)
 * @returns the tagged conversion result
 */
export function convertPredictionToEvaluationProposal(
  scope: WorldContextTenantScope,
  prediction: WorldModelPredictionRecordLike,
  options: BridgeOptions,
): BridgeResult {
  const guard = checkWorldContextTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.bridgeDomain,
        `world-context bridge refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: WORLD_CONTEXT_PIPELINE_CORRELATION_ID },
        "world-context.bridge.convert",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: scope.correlationId ?? WORLD_CONTEXT_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  if (prediction === null || prediction === undefined || typeof prediction !== "object") {
    failures.push({ path: "/prediction", reason: "object_required" });
  } else {
    if (prediction.kind !== "prediction" && prediction.kind !== "counterfactual") {
      failures.push({ path: "/prediction/kind", reason: "unknown_kind" });
    }
    if (typeof prediction.tenantId !== "string" || prediction.tenantId.length === 0) {
      failures.push({ path: "/prediction/tenantId", reason: "required" });
    }
    if (typeof prediction.provenanceChainDigest !== "string" || prediction.provenanceChainDigest.length === 0) {
      failures.push({ path: "/prediction/provenanceChainDigest", reason: "required" });
    }
    if (typeof prediction.estimateKind !== "string" || prediction.estimateKind.length === 0) {
      failures.push({ path: "/prediction/estimateKind", reason: "required" });
    }
    if (typeof prediction.producedAt !== "string" || !looksLikeIso(prediction.producedAt)) {
      failures.push({ path: "/prediction/producedAt", reason: "not_iso" });
    }
    if (prediction.target === null || typeof prediction.target !== "object") {
      failures.push({ path: "/prediction/target", reason: "object_required" });
    }
    if (prediction.uncertainty === null || typeof prediction.uncertainty !== "object") {
      failures.push({ path: "/prediction/uncertainty", reason: "object_required" });
    }
    if (prediction.provenance === null || typeof prediction.provenance !== "object") {
      failures.push({ path: "/prediction/provenance", reason: "object_required" });
    } else {
      if (typeof prediction.provenance.capabilityName !== "string" || prediction.provenance.capabilityName.length === 0) {
        failures.push({ path: "/prediction/provenance/capabilityName", reason: "required" });
      }
      if (typeof prediction.provenance.capabilityVersion !== "number" || prediction.provenance.capabilityVersion < 1) {
        failures.push({ path: "/prediction/provenance/capabilityVersion", reason: "must_be_at_least_one" });
      }
      if (!Array.isArray(prediction.provenance.evidenceRefs)) {
        failures.push({ path: "/prediction/provenance/evidenceRefs", reason: "array_required" });
      }
    }
    if (prediction.kind === "counterfactual") {
      const cf = prediction as WorldModelCounterfactualLike;
      if (cf.hypothetical !== true) {
        failures.push({ path: "/prediction/hypothetical", reason: "must_be_true_for_counterfactual" });
      }
      if (cf.candidateAction === null || typeof cf.candidateAction !== "object") {
        failures.push({ path: "/prediction/candidateAction", reason: "object_required" });
      } else {
        if (typeof cf.candidateAction.ref !== "string" || cf.candidateAction.ref.length === 0) {
          failures.push({ path: "/prediction/candidateAction/ref", reason: "required" });
        }
        if (typeof cf.candidateAction.description !== "string") {
          failures.push({ path: "/prediction/candidateAction/description", reason: "required" });
        }
      }
    }
  }
  if (options === null || options === undefined || typeof options !== "object") {
    failures.push({ path: "/options", reason: "object_required" });
  } else {
    if (
      !Array.isArray(options.tenantPolicyRefs) ||
      options.tenantPolicyRefs.length === 0 ||
      !options.tenantPolicyRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/options/tenantPolicyRefs", reason: "string_array_required" });
    }
    const redaction = options.redaction;
    if (redaction === null || redaction === undefined || typeof redaction !== "object") {
      failures.push({ path: "/options/redaction", reason: "object_required" });
    } else {
      if (
        typeof redaction.state !== "string" ||
        !(ALL_REDACTION_STATE_FACETS as readonly string[]).includes(redaction.state)
      ) {
        failures.push({ path: "/options/redaction/state", reason: "unknown_redaction_state" });
      }
      if (
        !Array.isArray(redaction.appliedPolicies) ||
        !redaction.appliedPolicies.every((p) => typeof p === "string" && p.length > 0)
      ) {
        failures.push({ path: "/options/redaction/appliedPolicies", reason: "string_array_required" });
      }
    }
    if (
      options.extraLabels !== undefined &&
      (!Array.isArray(options.extraLabels) ||
        !options.extraLabels.every(
          (l) =>
            typeof l === "object" &&
            l !== null &&
            typeof (l as { key?: unknown }).key === "string" &&
            (l as { key?: unknown }).key !== undefined &&
            ((l as { key?: unknown }).key as string).length > 0 &&
            typeof (l as { value?: unknown }).value === "string",
        ))
    ) {
      failures.push({ path: "/options/extraLabels", reason: "label_array_required" });
    }
    if (options.guardianDecision === null || options.guardianDecision === undefined || typeof options.guardianDecision !== "object") {
      failures.push({ path: "/options/guardianDecision", reason: "object_required" });
    } else {
      if (typeof options.guardianDecision.decision !== "string" || options.guardianDecision.decision.length === 0) {
        failures.push({ path: "/options/guardianDecision/decision", reason: "required" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.bridgeInvalid,
        "world-context bridge conversion input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (acting scope vs prediction's tenantId vs decision's tenantId) ----
  if (prediction.tenantId !== guard.tenantId) {
    emitBridgeRefusal(
      options.auditSink,
      WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBridge,
      guard.tenantId,
      trace.correlationId,
      prediction.producedAt,
      "tenant_mismatch",
      `prediction.tenantId is ${prediction.tenantId as string}; acting scope is ${guard.tenantId as string}`,
      prediction.provenanceChainDigest,
    );
    return refusedBridge(guard.tenantId, trace.correlationId, "tenant_mismatch", `prediction.tenantId is ${prediction.tenantId as string}; acting scope is ${guard.tenantId as string}`);
  }
  if (options.guardianDecision.tenantId !== guard.tenantId) {
    emitBridgeRefusal(
      options.auditSink,
      WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBridge,
      guard.tenantId,
      trace.correlationId,
      prediction.producedAt,
      "tenant_mismatch",
      `guardianDecision.tenantId is ${options.guardianDecision.tenantId as string}; acting scope is ${guard.tenantId as string}`,
      prediction.provenanceChainDigest,
    );
    return refusedBridge(guard.tenantId, trace.correlationId, "tenant_mismatch", `guardianDecision.tenantId is ${options.guardianDecision.tenantId as string}; acting scope is ${guard.tenantId as string}`);
  }

  // ---- 3. Honest-state gate (the trust anchor discipline — missing provenance chain REFUSES) ----
  // The prediction's provenance chain is the trust anchor: the
  // `provenanceChainDigest` is the prediction's stable id anchor; the
  // `provenance.evidenceRefs` array is the chain
  // (representation → feature-set → observations → context observations).
  // A prediction LACKING either is REFUSED — the bridge NEVER fabricates
  // the chain.
  if (prediction.provenance.evidenceRefs.length === 0) {
    emitBridgeRefusal(
      options.auditSink,
      WORLD_CONTEXT_AUDIT_ACTIONS.bridgeRefused,
      guard.tenantId,
      trace.correlationId,
      prediction.producedAt,
      "missing_provenance_chain",
      `prediction ${prediction.provenanceChainDigest} has empty provenance.evidenceRefs`,
      prediction.provenanceChainDigest,
    );
    return refusedBridge(guard.tenantId, trace.correlationId, "missing_provenance_chain", `prediction ${prediction.provenanceChainDigest} has empty provenance.evidenceRefs`);
  }

  // ---- 4. Build the case payload (verbatim mapping — nothing re-derived) ----
  const hypothetical = prediction.kind === "counterfactual";
  const predictionId = prediction.provenanceChainDigest; // the W154 stable id anchor
  const candidateActionRef =
    prediction.kind === "counterfactual"
      ? (prediction as WorldModelCounterfactualLike).candidateAction.ref
      : null;

  // 4a. observationRefs — the prediction's evidence chain (the
  // representation digest → the feature-set input digest → the
  // observation refs → the context observation refs → the candidate
  // action ref when applicable).
  const observationRefs: string[] = [];
  for (const ref of prediction.provenance.evidenceRefs) {
    observationRefs.push(`${ref.kind}:${ref.ref}`);
  }
  const normalizedObservationRefs = frozenArray(
    [...new Set(observationRefs)].filter((r) => typeof r === "string" && r.length > 0).sort(),
  );

  // 4b. context — the prediction's full advisory payload (the ground
  // truth arrives LATER via D3). Carries the hypothetical marker on the
  // SECOND surface (the case.context JSON-serializable field).
  const caseContext: Readonly<Record<string, unknown>> = frozen({
    target: prediction.target,
    horizon: prediction.target.horizon,
    estimate: prediction.estimate,
    estimateKind: prediction.estimateKind,
    uncertainty: prediction.uncertainty,
    capability: prediction.capability,
    hypothetical, // the SECOND surface — the case.context.hypothetical field
    candidateAction: prediction.kind === "counterfactual" ? (prediction as WorldModelCounterfactualLike).candidateAction : null,
    producedAt: prediction.producedAt,
    correlationId: prediction.correlationId,
    provenanceChainDigest: prediction.provenanceChainDigest,
  });

  // 4c. actionHistoryRefs — the counterfactual's candidateAction.ref
  // when present (the action the counterfactual is conditioned on — the
  // W154 invariant 5 "the action is NEVER executed"; the bridge carries
  // the REF, never the execution). Plus the prediction's correlationId
  // (the request that produced the prediction — the causation trail).
  const actionHistoryRefs: string[] = [];
  if (candidateActionRef !== null) {
    actionHistoryRefs.push(`candidate-action:${candidateActionRef}`);
  }
  actionHistoryRefs.push(`prediction-correlation:${prediction.correlationId}`);
  const normalizedActionHistoryRefs = frozenArray(
    [...new Set(actionHistoryRefs)].filter((r) => typeof r === "string" && r.length > 0).sort(),
  );

  // 4d. outcome — the PENDING marker (the ground truth arrives LATER via D3).
  const outcome: EvaluationOutcomeFacetLike = frozen({
    label: BRIDGE_PENDING_OUTCOME_LABEL,
    value: `${BRIDGE_PENDING_OUTCOME_VALUE_PREFIX}:${prediction.estimateKind}`,
    observedAt: prediction.producedAt,
    evidenceRefs: frozenArray([]), // empty until D3 binds the outcome
  });

  // 4e. labels — derived (source_surface, subject_ref, prediction_kind,
  // hypothetical, device) + the caller's extraLabels. The hypothetical
  // marker is carried on the THIRD surface (the case.labels array — a
  // `hypothetical: "true" | "false"` label so the W070 evaluation loop
  // can filter on it).
  const labels: EvaluationLabelFacetLike[] = [
    { key: "source_surface", value: BRIDGE_SOURCE_SURFACE },
    { key: "subject_ref", value: predictionId },
    { key: "prediction_kind", value: prediction.kind },
    { key: "hypothetical", value: hypothetical ? "true" : "false" },
    { key: "device", value: prediction.target.deviceId as string },
    { key: "capability", value: `${prediction.capability.name}@${prediction.capability.version}` },
    ...(options.extraLabels ?? []),
  ];

  // 4f. case — the structurally-W070-compatible case payload.
  const caseFacet: EvaluationCaseProposalFacetLike = frozen({
    problemClass: `${PREDICTIVE_PROBLEM_CLASS_PREFIX}.${prediction.estimateKind}`,
    observationRefs: normalizedObservationRefs,
    context: caseContext,
    actionHistoryRefs: normalizedActionHistoryRefs,
    outcome,
    labels: frozenArray(labels),
    tenantPolicyRefs: frozenArray([...options.tenantPolicyRefs]),
    redaction: frozen({
      state: options.redaction.state,
      appliedPolicies: frozenArray([...options.redaction.appliedPolicies]),
    }),
  });

  // ---- 5. Gate the proposal through the Guardian decision (the W070 `decisionToDisposition` twin) ----
  const disposition = decisionToDisposition(options.guardianDecision.decision);

  // ---- 6. Build + freeze the proposal ----
  const proposalContent: Omit<PredictiveEvaluationProposalLike, "proposalId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    sourcePredictionId: predictionId,
    sourcePredictionKind: prediction.kind,
    hypothetical, // the FIRST surface — the proposal's top-level field
    disposition,
    case: caseFacet,
    guardianDecision: options.guardianDecision,
  });
  const proposal: PredictiveEvaluationProposalLike = frozen({
    ...proposalContent,
    proposalId: proposalId(
      guard.tenantId,
      predictionId,
      hypothetical,
      caseFacet,
      options.guardianDecision,
    ),
    contentDigest: proposalContentDigest(proposalContent),
  });

  // ---- 7. Audit the conversion (consequential — a later actor must be
  // able to reconstruct which prediction became which proposal). PURE:
  // the sink is injected; the `occurredAt` is the prediction's
  // `producedAt`.
  const sink: WorldContextAuditSink = options.auditSink ?? NOOP_WORLD_CONTEXT_AUDIT_SINK;
  sink.append(
    frozen({
      action: WORLD_CONTEXT_AUDIT_ACTIONS.bridgeConverted,
      tenantId: proposal.tenantId,
      subject: proposal.proposalId,
      occurredAt: prediction.producedAt,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        proposalId: proposal.proposalId,
        sourcePredictionId: proposal.sourcePredictionId,
        sourcePredictionKind: proposal.sourcePredictionKind,
        hypothetical: proposal.hypothetical,
        disposition: proposal.disposition,
        guardianDecision: options.guardianDecision.decision,
        problemClass: caseFacet.problemClass,
        contentDigest: proposal.contentDigest,
      }),
    }),
  );

  return { ok: true, proposal };
}

// ---------------------------------------------------------------------------
// Internal: refused constructor + audit emitter
// ---------------------------------------------------------------------------

/** Build + freeze a `refused` bridge result (typed error, never throws raw). */
function refusedBridge(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: string,
  detail: string,
): BridgeResult {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.bridgeDomain,
      `world-context bridge refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "world-context.bridge",
      reason,
    ),
  });
}

/**
 * Emit a bridge refusal audit record to the injected sink (the
 * W040-disclosed audited-boundary pattern). The refusal is
 * CONSEQUENTIAL evidence a reviewer must be able to reconstruct
 * (ADR-0002 invariant 7 + the honest-degradation discipline). PURE: the
 * sink is injected; this helper reads no clock and no entropy.
 */
function emitBridgeRefusal(
  sink: WorldContextAuditSink | undefined,
  action: string,
  tenantId: TenantId,
  correlationId: CorrelationId,
  occurredAt: string,
  reason: string,
  detail: string,
  predictionDigest: string,
): void {
  if (sink === undefined) return;
  sink.append(
    frozen({
      action,
      tenantId,
      subject: predictionDigest,
      occurredAt,
      correlationId,
      details: frozen({ reason, detail, predictionDigest }),
    }),
  );
}

// ---------------------------------------------------------------------------
// The "no submit path" machine-test helper (the W155 work order: "the
// bridge NEVER submits (no submit path exists — machine-tested)")
// ---------------------------------------------------------------------------

/**
 * The set of public function names exposed by this module. The
 * contract-conformance test asserts NO name in this set matches
 * `/submit/i` — the bridge NEVER submits (the W070 arena adapter owns
 * the submission ledger). Machine-tested.
 */
export const BRIDGE_PUBLIC_FUNCTIONS = frozen([
  "convertPredictionToEvaluationProposal",
  "decisionToDisposition",
  "proposalId",
  "proposalContentDigest",
] as const);

/** Re-export the helpers for callers (the audited boundary). */
export const BRIDGE_HELPERS = frozen({
  decisionToDisposition,
  proposalId,
  proposalContentDigest,
  BRIDGE_PUBLIC_FUNCTIONS,
  frozenArray,
});
