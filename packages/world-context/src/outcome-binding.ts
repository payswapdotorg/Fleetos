/**
 * @fleetos/world-context — D3: the outcome binding (the loop CLOSES).
 *
 * The PURE function family that JOINS an OBSERVED LATER STATE (the
 * actual device health/cadence at the horizon's end — derived from the
 * observation stream at evaluation time, INJECTED by the caller) to the
 * PREDICTED estimate (by prediction id + the provenance chain),
 * producing an outcome-observation-shaped record (structurally
 * compatible with the W070 learning package's `OutcomeObservation` —
 * the W155 lane NEVER imports `@fleetos/learning` directly).
 *
 * This is the piece that makes the loop CLOSE: prediction → proposal →
 * (outcome observed) → outcome binding → evaluation → (eventual
 * adoption). The binding is the JOIN of the observed outcome to the
 * PREDICTED estimate; the W070 evaluation loop scores the prediction's
 * accuracy by comparing the `outcome` (the GROUND TRUTH) to the
 * `context.predictedEstimate` + `context.predictedUncertainty` (the
 * prediction's advisory payload).
 *
 * Per ADR-0002 § "Hard invariants" + the W155 work order:
 *   3. Every binding carries the prediction's evidence chain (chained
 *      forward from the W154 representation's provenance → the W153
 *      feature set's provenance → the observation ids) as
 *      `observationRefs` + the prediction's `provenanceChainDigest` as
 *      the `subjectRef`. The binding's `outcome` carries the GROUND
 *      TRUTH (the observed device health/cadence at the horizon's end);
 *      the binding's `context` carries the prediction's estimate +
 *      uncertainty (for the evaluation to score).
 *   4. Counterfactual-derived bindings carry the hypothetical marker
 *      THROUGH the binding (the W154 marker propagated — the binding's
 *      `hypothetical: boolean` field + the `context.hypothetical`
 *      field). Machine-tested.
 *   5. The binding NEVER authorizes or executes anything — the binding
 *      is a RECORD (a SHAPE, not an action); adoption happens only
 *      through explicit versioned adoption records (the W070
 *      `adoption-ledger` boundary; the W155 lane does NOT call it).
 *   6. Honest refusals: a horizon-mismatch (the observed `observedAt`
 *      is BEFORE the prediction's `producedAt + horizonMs` — the
 *      outcome hasn't materialized yet) REFUSES with the reason
 *      `horizon_mismatch`; a prediction lacking the provenance chain
 *      REFUSES with the reason `missing_provenance_chain` (the trust
 *      anchor discipline — the W155 outcome binding NEVER fabricates
 *      the chain); cross-tenant REFUSES.
 *   7. Tenant isolation at every boundary; cross-tenant inputs rejected.
 *   8. Determinism: the same prediction + the same outcome + the same
 *      observedAt => byte-identical binding. The binding's `bindingId`
 *      is the SHA-256 over (tenant, prediction, outcome, observedAt);
 *      the `contentDigest` is the SHA-256 over the binding's content
 *      fields.
 *  10. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  CausationId,
  DeviceId,
  EvidenceRef,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  PREDICTIVE_OUTCOME_SOURCE_SURFACE,
  PREDICTIVE_PROBLEM_CLASS_PREFIX,
  type OutcomeGroundTruthLike,
  type PredictiveOutcomeBindingLike,
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
  normalizeRefs,
  sha256Hex,
} from "./internal";
import type { WorldContextTenantScope } from "./internal";
import { checkWorldContextTenantScope } from "./internal";
import type { WorldContextAuditSink } from "./audit-seam";
import { NOOP_WORLD_CONTEXT_AUDIT_SINK, WORLD_CONTEXT_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// The frozen binding schema + binding algorithm versions
// ---------------------------------------------------------------------------

/**
 * The binding SCHEMA version — frozen for W155. Bumping this is a
 * contract change requiring an ADR (the W156 lane + the W070 evaluation
 * loop consume the binding's shape; a schema change is a breaking seam
 * change). The schema describes the shape of
 * `PredictiveOutcomeBindingLike`'s fields (bindingId, tenantId,
 * sourcePredictionId, sourcePredictionKind, hypothetical, sourceSurface,
 * subjectRef, problemClass, deviceId, observationRefs, actionHistoryRefs,
 * context, outcome, evidenceRefs, observedAt, contentDigest).
 */
export const BINDING_SCHEMA_VERSION = 1 as const;

/**
 * The binding ALGORITHM version — frozen for W155. Bumping this is a
 * binding re-derivation: the same prediction + the same outcome at a
 * higher binding version produce a NEW binding (the W070 supersession
 * discipline applied to the world-context feed). The first
 * implementation is `1`.
 */
export const BINDING_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The observed outcome (the GROUND TRUTH — injected by the caller)
// ---------------------------------------------------------------------------

/**
 * The OBSERVED LATER STATE — the actual device health/cadence at the
 * horizon's end. The caller (the actor that observed the outcome —
 * typically a periodic evaluation job that re-runs the W153
 * `extractDeviceHistoryFeatures` at the horizon's end + compares the
 * W154 prediction to the observed reality) supplies:
 *   - `groundTruth`: the GROUND-TRUTH annotation (label + value,
 *     machine-stable strings; the caller defines the value set — e.g.
 *     `device_health_observed` / `healthy` | `degraded` | `failed`);
 *   - `observedAt`: the INJECTED observation instant (ISO 8601 — the
 *     moment the outcome was observed, NEVER a clock read; MUST be >=
 *     the prediction's `producedAt + horizonMs` — a horizon-mismatch
 *     REFUSES);
 *   - `evidenceRefs`: the evidence artifacts supporting the outcome
 *     (the observed evidence — e.g. the W153 feature set extracted at
 *     the horizon's end; merged with the prediction's evidence chain
 *     into the binding's `evidenceRefs`).
 *
 * The W155 lane NEVER re-derives or fabricates a ground truth — the
 * binding REFUSES machine-stably when the caller-supplied ground truth
 * is empty (the trust anchor discipline, mirroring the W070
 * outcome-observation seams).
 */
export interface ObservedOutcomeInput {
  /** The GROUND-TRUTH annotation (label + value, machine-stable — the caller defines the value set). */
  readonly groundTruth: OutcomeGroundTruthLike;
  /** The INJECTED observation instant (ISO 8601 — MUST be >= the prediction's producedAt + horizonMs). */
  readonly observedAt: string;
  /** The evidence artifacts supporting the outcome (the observed evidence — merged with the prediction's evidence chain). */
  readonly evidenceRefs: readonly EvidenceRef[];
}

// ---------------------------------------------------------------------------
// The binding options + result
// ---------------------------------------------------------------------------

/** Options for `bindPredictiveOutcome`. */
export interface OutcomeBindingOptions {
  /** The correlation id of the binding request (default: the prediction's correlationId). */
  readonly correlationId?: CorrelationId;
  /** The causation id, when the binding is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the binding + refusal emit; default: no-op). */
  readonly auditSink?: WorldContextAuditSink;
}

/** The tagged result of an outcome binding. */
export type OutcomeBinding =
  | { readonly ok: true; readonly binding: PredictiveOutcomeBindingLike }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The deterministic binding identity + content digest
// ---------------------------------------------------------------------------

/**
 * The deterministic binding identity. SHA-256 over the canonical
 * serialization of (tenantId, sourcePredictionId, groundTruth,
 * observedAt). Identical inputs produce identical binding ids (proven
 * by test).
 */
export function bindingId(
  tenantId: TenantId,
  sourcePredictionId: string,
  groundTruth: OutcomeGroundTruthLike,
  observedAt: string,
): string {
  return `wcb_${sha256Hex(canonicalJson([tenantId, sourcePredictionId, groundTruth, observedAt]))}`;
}

/**
 * The canonical content digest of a binding's CONTENT (identity fields
 * excluded — the digest is over the binding's substance, not its id).
 */
export function bindingContentDigest(
  binding: Omit<PredictiveOutcomeBindingLike, "bindingId" | "contentDigest">,
): string {
  return sha256Hex(
    canonicalJson([
      binding.tenantId,
      binding.sourcePredictionId,
      binding.sourcePredictionKind,
      binding.hypothetical,
      binding.sourceSurface,
      binding.subjectRef,
      binding.problemClass,
      binding.deviceId,
      binding.observationRefs,
      binding.actionHistoryRefs,
      binding.context,
      binding.outcome,
      binding.evidenceRefs,
      binding.observedAt,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The bind function (D3)
// ---------------------------------------------------------------------------

/**
 * Bind an observed outcome to a W154 prediction. PURE: every input is
 * injected; the binding reads no clock and no entropy. The same inputs
 * (same prediction + same outcome + same observedAt) ALWAYS produce
 * byte-identical outputs (proven by golden tests in
 * `test/determinism.test.ts`).
 *
 * The binding is the JOIN of the observed outcome to the PREDICTED
 * estimate (by prediction id + the provenance chain). The binding's
 * `outcome` carries the GROUND TRUTH (the observed device health/cadence
 * at the horizon's end); the binding's `context` carries the prediction's
 * estimate + uncertainty (for the W070 evaluation loop to score the
 * prediction's accuracy).
 *
 * Honest refusals (the W154 honest-degradation discipline applied to
 * the binding):
 *   - a horizon-mismatch (the observed `observedAt` is BEFORE the
 *     prediction's `producedAt + horizonMs` — the outcome hasn't
 *     materialized yet) => REFUSED with the reason `horizon_mismatch`
 *     (the W155 work order: "a horizon-mismatch REFUSES");
 *   - a prediction LACKING the provenance chain (the
 *     `provenanceChainDigest` is empty OR the
 *     `provenance.evidenceRefs` array is empty) => REFUSED with the
 *     reason `missing_provenance_chain` (the trust anchor discipline —
 *     the W155 outcome binding NEVER fabricates the chain);
 *   - cross-tenant (the prediction's `tenantId` does not match the
 *     acting scope's `tenantId`) => REFUSED with the reason
 *     `tenant_mismatch` (invariant 7);
 *   - a missing/malformed ground truth (empty label/value) or a
 *     non-ISO `observedAt` => a typed ValidationError.
 *
 * Counterfactual visibility (invariant 4): the `hypothetical` marker
 * SURVIVES the binding on TWO surfaces (the binding's top-level
 * `hypothetical` field + the `context.hypothetical` field).
 * Machine-tested.
 *
 * Audit: the binding + the refusal ARE CONSEQUENTIAL (a later actor
 * must be able to reconstruct which prediction the bound outcome
 * validates, AND the honest-degradation path). The binding emits
 * `world-context.outcome_binding.bound`; the refusal emits
 * `world-context.outcome_binding.refused`. PURE: the sink is injected;
 * the `occurredAt` is the caller-supplied `observedAt`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param prediction the W154 prediction/counterfactual to bind to
 * @param outcome the observed outcome (the GROUND TRUTH — injected by the caller)
 * @param options the binding options (correlation id, causation id, audit sink)
 * @returns the tagged binding result
 */
export function bindPredictiveOutcome(
  scope: WorldContextTenantScope,
  prediction: WorldModelPredictionRecordLike,
  outcome: ObservedOutcomeInput,
  options: OutcomeBindingOptions = {},
): OutcomeBinding {
  const guard = checkWorldContextTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.outcomeBindingDomain,
        `world-context outcome binding refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: WORLD_CONTEXT_PIPELINE_CORRELATION_ID },
        "world-context.outcome_binding",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? scope.correlationId ?? prediction?.correlationId ?? WORLD_CONTEXT_PIPELINE_CORRELATION_ID,
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
    } else {
      if (typeof prediction.target.horizon !== "object" || typeof prediction.target.horizon.horizonMs !== "number") {
        failures.push({ path: "/prediction/target/horizon/horizonMs", reason: "required_number" });
      }
      if (typeof prediction.target.deviceId !== "string" || prediction.target.deviceId.length === 0) {
        failures.push({ path: "/prediction/target/deviceId", reason: "required" });
      }
    }
    if (prediction.uncertainty === null || typeof prediction.uncertainty !== "object") {
      failures.push({ path: "/prediction/uncertainty", reason: "object_required" });
    }
    if (prediction.provenance === null || typeof prediction.provenance !== "object") {
      failures.push({ path: "/prediction/provenance", reason: "object_required" });
    } else {
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
      } else if (typeof cf.candidateAction.ref !== "string" || cf.candidateAction.ref.length === 0) {
        failures.push({ path: "/prediction/candidateAction/ref", reason: "required" });
      }
    }
  }
  if (outcome === null || outcome === undefined || typeof outcome !== "object") {
    failures.push({ path: "/outcome", reason: "object_required" });
  } else {
    if (outcome.groundTruth === null || typeof outcome.groundTruth !== "object") {
      failures.push({ path: "/outcome/groundTruth", reason: "object_required" });
    } else {
      if (typeof outcome.groundTruth.label !== "string" || outcome.groundTruth.label.length === 0) {
        failures.push({ path: "/outcome/groundTruth/label", reason: "required" });
      }
      if (typeof outcome.groundTruth.value !== "string" || outcome.groundTruth.value.length === 0) {
        failures.push({ path: "/outcome/groundTruth/value", reason: "required" });
      }
    }
    if (typeof outcome.observedAt !== "string" || !looksLikeIso(outcome.observedAt)) {
      failures.push({ path: "/outcome/observedAt", reason: "not_iso" });
    }
    if (!Array.isArray(outcome.evidenceRefs)) {
      failures.push({ path: "/outcome/evidenceRefs", reason: "array_required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.outcomeBindingInvalid,
        "world-context outcome binding input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (acting scope vs prediction's tenantId) ----
  if (prediction.tenantId !== guard.tenantId) {
    emitBindingRefusal(
      options.auditSink,
      WORLD_CONTEXT_AUDIT_ACTIONS.tenantScopeRefusedBinding,
      guard.tenantId,
      trace.correlationId,
      outcome.observedAt,
      "tenant_mismatch",
      `prediction.tenantId is ${prediction.tenantId as string}; acting scope is ${guard.tenantId as string}`,
      prediction.provenanceChainDigest,
    );
    return refusedBinding(guard.tenantId, trace.correlationId, "tenant_mismatch", `prediction.tenantId is ${prediction.tenantId as string}; acting scope is ${guard.tenantId as string}`);
  }

  // ---- 3. Honest-state gate (the trust anchor discipline — missing provenance chain REFUSES) ----
  if (prediction.provenance.evidenceRefs.length === 0) {
    emitBindingRefusal(
      options.auditSink,
      WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBindingRefused,
      guard.tenantId,
      trace.correlationId,
      outcome.observedAt,
      "missing_provenance_chain",
      `prediction ${prediction.provenanceChainDigest} has empty provenance.evidenceRefs`,
      prediction.provenanceChainDigest,
    );
    return refusedBinding(guard.tenantId, trace.correlationId, "missing_provenance_chain", `prediction ${prediction.provenanceChainDigest} has empty provenance.evidenceRefs`);
  }

  // ---- 4. Horizon-mismatch gate (the W155 work order: "a horizon-mismatch REFUSES") ----
  // The prediction's horizon is `target.horizon.horizonMs` (the
  // duration from the prediction's `producedAt` over which the estimate
  // is made). The outcome's `observedAt` MUST be >= the prediction's
  // `producedAt + horizonMs` — a horizon-mismatch (the outcome observed
  // BEFORE the horizon's end) REFUSES (the outcome hasn't materialized
  // yet; the binding would join an unobserved outcome to a prediction —
  // the W155 lane NEVER fabricates the join).
  const producedAtMs = Date.parse(prediction.producedAt);
  const observedAtMs = Date.parse(outcome.observedAt);
  const horizonMs = prediction.target.horizon.horizonMs;
  if (Number.isFinite(producedAtMs) && Number.isFinite(observedAtMs)) {
    const horizonEndMs = producedAtMs + horizonMs;
    if (observedAtMs < horizonEndMs) {
      emitBindingRefusal(
        options.auditSink,
        WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBindingRefused,
        guard.tenantId,
        trace.correlationId,
        outcome.observedAt,
        "horizon_mismatch",
        `observedAt ${outcome.observedAt} is before the horizon's end (producedAt ${prediction.producedAt} + horizonMs ${horizonMs})`,
        prediction.provenanceChainDigest,
      );
      return refusedBinding(
        guard.tenantId,
        trace.correlationId,
        "horizon_mismatch",
        `observedAt ${outcome.observedAt} is before the horizon's end (producedAt ${prediction.producedAt} + horizonMs ${horizonMs})`,
      );
    }
  }

  // ---- 5. Build the binding's content (verbatim mapping — nothing re-derived) ----
  const hypothetical = prediction.kind === "counterfactual";
  const predictionId = prediction.provenanceChainDigest; // the W154 stable id anchor
  const candidateActionRef =
    prediction.kind === "counterfactual"
      ? (prediction as WorldModelCounterfactualLike).candidateAction.ref
      : null;

  // 5a. observationRefs — the prediction's evidence chain (the
  // representation digest → the feature-set input digest → the
  // observation refs → the context observation refs → the candidate
  // action ref when applicable). Joined by `kind:ref` pairs, normalized.
  const observationRefs: string[] = [];
  for (const ref of prediction.provenance.evidenceRefs) {
    observationRefs.push(`${ref.kind}:${ref.ref}`);
  }
  const normalizedObservationRefs = normalizeRefs(observationRefs);

  // 5b. actionHistoryRefs — the counterfactual's candidateAction.ref
  // when present + the prediction's correlationId (the request that
  // produced the prediction — the causation trail). Normalized.
  const actionHistoryRefs: string[] = [];
  if (candidateActionRef !== null) {
    actionHistoryRefs.push(`candidate-action:${candidateActionRef}`);
  }
  actionHistoryRefs.push(`prediction-correlation:${prediction.correlationId}`);
  const normalizedActionHistoryRefs = normalizeRefs(actionHistoryRefs);

  // 5c. context — the prediction's full advisory payload (the GROUND
  // TRUTH arrives LATER via D3, but the prediction's estimate +
  // uncertainty ARE the binding's context — for the W070 evaluation
  // loop to score the prediction's accuracy). Carries the hypothetical
  // marker on the SECOND surface (the context.hypothetical field).
  const caseContext: Readonly<Record<string, unknown>> = frozen({
    target: prediction.target,
    horizon: prediction.target.horizon,
    predictedEstimate: prediction.estimate,
    predictedEstimateKind: prediction.estimateKind,
    predictedUncertainty: prediction.uncertainty,
    capability: prediction.capability,
    hypothetical, // the SECOND surface — the context.hypothetical field
    candidateAction: prediction.kind === "counterfactual" ? (prediction as WorldModelCounterfactualLike).candidateAction : null,
    producedAt: prediction.producedAt,
    correlationId: prediction.correlationId,
    provenanceChainDigest: prediction.provenanceChainDigest,
  });

  // 5d. evidenceRefs — the observed evidence (the outcome's
  // evidenceRefs) MERGED with the prediction's evidence chain (the
  // representation digest, the feature-set input digest, the context
  // observation refs). Normalized by key (the W070 `normalizeEvidence`
  // discipline). The prediction's evidence chain is converted to
  // EvidenceRef-shaped objects (the `key` is the `kind:ref` pair; the
  // `sizeBytes` is 0 — these are content-addressable refs, not
  // object-storage artifacts; the `hash` is the ref itself; the
  // `hashAlgorithm` is "sha256" — the W154 engine's digest algorithm).
  const predictionEvidenceAsRefs: EvidenceRef[] = [];
  for (const ref of prediction.provenance.evidenceRefs) {
    predictionEvidenceAsRefs.push({
      key: `${ref.kind}:${ref.ref}`,
      sizeBytes: 0,
      hash: ref.ref,
      hashAlgorithm: "sha256",
    });
  }
  const mergedEvidence = normalizeEvidence([
    ...predictionEvidenceAsRefs,
    ...outcome.evidenceRefs,
  ]);

  // 5e. problemClass — `world-model.prediction.<estimateKind>` (the W155
  // bridge's source-surface prefix + the prediction's target family).
  const problemClass = `${PREDICTIVE_PROBLEM_CLASS_PREFIX}.${prediction.estimateKind}`;

  // 5f. deviceId — the prediction's target.deviceId (the device the
  // binding concerns).
  const deviceId = prediction.target.deviceId;

  // ---- 6. Build + freeze the binding ----
  const bindingContent: Omit<PredictiveOutcomeBindingLike, "bindingId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    sourcePredictionId: predictionId,
    sourcePredictionKind: prediction.kind,
    hypothetical, // the FIRST surface — the binding's top-level field
    sourceSurface: PREDICTIVE_OUTCOME_SOURCE_SURFACE,
    subjectRef: predictionId,
    problemClass,
    deviceId,
    observationRefs: normalizedObservationRefs,
    actionHistoryRefs: normalizedActionHistoryRefs,
    context: caseContext,
    outcome: outcome.groundTruth,
    evidenceRefs: mergedEvidence,
    observedAt: outcome.observedAt,
  });
  const binding: PredictiveOutcomeBindingLike = frozen({
    ...bindingContent,
    bindingId: bindingId(guard.tenantId, predictionId, outcome.groundTruth, outcome.observedAt),
    contentDigest: bindingContentDigest(bindingContent),
  });

  // ---- 7. Audit the binding (consequential — a later actor must be
  // able to reconstruct which prediction the bound outcome validates).
  // PURE: the sink is injected; the `occurredAt` is the caller-supplied
  // `observedAt`.
  const sink: WorldContextAuditSink = options.auditSink ?? NOOP_WORLD_CONTEXT_AUDIT_SINK;
  sink.append(
    frozen({
      action: WORLD_CONTEXT_AUDIT_ACTIONS.outcomeBound,
      tenantId: binding.tenantId,
      subject: binding.bindingId,
      occurredAt: outcome.observedAt,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        bindingId: binding.bindingId,
        sourcePredictionId: binding.sourcePredictionId,
        sourcePredictionKind: binding.sourcePredictionKind,
        hypothetical: binding.hypothetical,
        outcomeLabel: binding.outcome.label,
        outcomeValue: binding.outcome.value,
        problemClass: binding.problemClass,
        deviceId: binding.deviceId,
        contentDigest: binding.contentDigest,
      }),
    }),
  );

  return { ok: true, binding };
}

// ---------------------------------------------------------------------------
// Internal: refused constructor + audit emitter
// ---------------------------------------------------------------------------

/** Build + freeze a `refused` binding result (typed error, never throws raw). */
function refusedBinding(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: string,
  detail: string,
): OutcomeBinding {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.outcomeBindingDomain,
      `world-context outcome binding refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "world-context.outcome_binding",
      reason,
    ),
  });
}

/**
 * Emit a binding refusal audit record to the injected sink (the
 * W040-disclosed audited-boundary pattern). PURE: the sink is injected;
 * this helper reads no clock and no entropy.
 */
function emitBindingRefusal(
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

/** Re-export the helpers for callers (the audited boundary). */
export const BINDING_HELPERS = frozen({
  bindingId,
  bindingContentDigest,
  frozenArray,
});
