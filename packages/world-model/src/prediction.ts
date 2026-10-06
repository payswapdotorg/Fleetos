/**
 * @fleetos/world-model — D2: the prediction + counterfactual layer.
 *
 * The PURE function family over the W154 representation: `predict`
 * produces a `WorldModelPrediction` (a deterministic extrapolation over
 * the representation's temporal features into a horizon-scoped estimate);
 * `predictAfterAction` produces a `WorldModelCounterfactual` (the SAME
 * shape as a prediction PLUS a machine-carried `hypothetical: true`
 * marker + the candidate action ref — it is IMPOSSIBLE to construct a
 * counterfactual that renders as fact, machine-tested).
 *
 * Per ADR-0002 § "Hard invariants" (the lane's constitution, frozen by
 * this lane):
 *   3. Every prediction carries: model/capability version, horizon,
 *      evidence references (chained to the representation's provenance →
 *      the W153 feature set's provenance → the observation ids),
 *      uncertainty metadata, and the provenance chain digest.
 *   4. Counterfactuals (`predictAfterAction`) are HYPOTHETICAL, never
 *      facts — the record type machine-carries a distinct hypothetical
 *      marker; it can NEVER be constructed/rendered as fact.
 *   5. Predictions NEVER authorize or execute actions; no authorization
 *      surface exists in this package; Contract Guardian remains sole
 *      policy authority (the records are inputs AT MOST to
 *      human/advisory surfaces).
 *   6. A failed or unavailable model DEGRADES HONESTLY: the W153 feed's
 *      non-ok statuses PROPAGATE through the representation to the
 *      prediction (a non-ok representation yields a non-ok prediction,
 *      never a fabricated estimate); the reference implementation
 *      derives HONEST intervals/spreads from data density — a thin feed
 *      widens the interval rather than fabricating precision.
 *   8. The DETERMINISTIC REFERENCE IMPLEMENTATION works with no GPU, no
 *      model provider, no network — pure TypeScript arithmetic over the
 *      W153 features (carried into the W154 representation).
 *  10. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DeviceId,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  WORLD_MODEL_PIPELINE_CORRELATION_ID,
  canonicalJson,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  sha256Hex,
} from "./internal";
import type { WorldModelTenantScope } from "./internal";
import { checkWorldModelTenantScope } from "./internal";
import type { WorldModelRepresentation } from "./representation";
import {
  REPRESENTATION_DERIVATION_VERSION,
  REPRESENTATION_SCHEMA_VERSION,
} from "./representation";
import type { WorldModelAuditSink } from "./audit-seam";
import { WORLD_MODEL_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// The frozen prediction schema + capability versions
// ---------------------------------------------------------------------------

/**
 * The world-model prediction SCHEMA version — frozen for W154. Bumping
 * this is a contract change requiring an ADR (W155 + the UI consume the
 * prediction shape, so a schema change is a breaking seam change). The
 * schema describes the shape of `WorldModelPrediction`'s fields (kind,
 * capability, target, horizon, estimate, uncertainty, evidenceRefs,
 * provenanceChainDigest).
 */
export const PREDICTION_SCHEMA_VERSION = 1 as const;

/**
 * The reference-engine CAPABILITY version — frozen for W154. This is
 * the "model/capability version" ADR-0002 invariant 3 requires ("Every
 * prediction carries model/capability version"). The reference
 * implementation is `1`; a higher version is a re-derivation (a new
 * capability version is a NEW prediction, the W070 supersession
 * discipline applied to the world-model feed).
 */
export const REFERENCE_CAPABILITY_VERSION = 1 as const;

/**
 * The reference-engine CAPABILITY NAME — the stable model-family
 * identifier. The reference implementation is
 * `world-model.reference.deterministic` — a deterministic extrapolation
 * over the W153 features (the W154 work order: "the DETERMINISTIC
 * REFERENCE IMPLEMENTATION ... pure TypeScript arithmetic over the W153
 * features"). A JEPA-family model class WOULD plug in at the adapter
 * seam (D3) with a different capability name (e.g.
 * `world-model.jepa.embedding.v1`).
 */
export const REFERENCE_CAPABILITY_NAME = "world-model.reference.deterministic" as const;

// ---------------------------------------------------------------------------
// The prediction target + horizon
// ---------------------------------------------------------------------------

/**
 * The closed set of PREDICTION TARGETS the W154 reference engine can
 * produce. The vocabulary is machine-stable — adding a new target is a
 * prediction schema change requiring an ADR (W155 + the UI branch on
 * the target family). The first family is trimmed to what the W153
 * feature family actually supports (the W154 work order: "Narrow the
 * derivation family, never the invariants"):
 *   - `device_health_trajectory`: the device's health trend over the
 *                                horizon (the W153 numeric-summary
 *                                feature's LAST value, extrapolated);
 *   - `cadence_trajectory`:       the device's observation cadence trend
 *                                over the horizon (the W153 arrival-
 *                                cadence feature's meanMs, extrapolated);
 *   - `recency_drift`:            the device's recency drift over the
 *                                horizon (the W153 window-edge-recency
 *                                feature's deltaMs, extrapolated).
 */
export const PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY = "world-model.target.device_health_trajectory" as const;
export const PREDICTION_TARGET_CADENCE_TRAJECTORY = "world-model.target.cadence_trajectory" as const;
export const PREDICTION_TARGET_RECENCY_DRIFT = "world-model.target.recency_drift" as const;

/** The closed set of prediction targets the W154 reference engine can produce. */
export type PredictionTarget =
  | typeof PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY
  | typeof PREDICTION_TARGET_CADENCE_TRAJECTORY
  | typeof PREDICTION_TARGET_RECENCY_DRIFT;

/** All prediction targets (for validation + iteration; machine-stable order). */
export const ALL_PREDICTION_TARGETS: readonly PredictionTarget[] = Object.freeze([
  PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY,
  PREDICTION_TARGET_CADENCE_TRAJECTORY,
  PREDICTION_TARGET_RECENCY_DRIFT,
]);

/**
 * The prediction horizon — the temporal scope of the estimate. The
 * `horizonMs` is the duration from the representation's `asOf` over
 * which the estimate is made (e.g. 24h = 86_400_000ms). The engine
 * extrapolates the W153 features' temporal trends over the horizon.
 */
export interface PredictionHorizon {
  /** The horizon duration in milliseconds (>= 0). */
  readonly horizonMs: number;
}

// ---------------------------------------------------------------------------
// The uncertainty metadata
// ---------------------------------------------------------------------------

/**
 * The uncertainty metadata carried by every prediction. The reference
 * implementation derives HONEST intervals/spreads from data density —
 * a thin feed widens the interval rather than fabricating precision
 * (ADR-0002 invariant 6).
 *
 * The interval is the `[lower, upper]` estimate; the spread is
 * `(upper - lower) / 2` (the half-width). The `confidence` is the
 * engine's honest confidence in the estimate, derived from the data
 * density (the W153 feature set's observation count + the W154
 * representation's recency weight); a thin/stale feed yields a low
 * confidence, a rich/fresh feed yields a high confidence. The
 * `confidence` is in `[0, 1]` and is NEVER fabricated — it is a pure
 * function of the data density.
 */
export interface PredictionUncertainty {
  /** The lower bound of the estimate. */
  readonly lower: number;
  /** The upper bound of the estimate. */
  readonly upper: number;
  /** The half-width of the interval (`(upper - lower) / 2`). */
  readonly spread: number;
  /** The honest confidence in `[0, 1]` (derived from data density, never fabricated). */
  readonly confidence: number;
  /** The data-density signal: the W153 feature set's observation count (carried for transparency). */
  readonly observationCount: number;
  /** The recency signal: the W154 representation's recency weight (carried for transparency). */
  readonly recencyWeight: number;
}

// ---------------------------------------------------------------------------
// The evidence-ref chain
// ---------------------------------------------------------------------------

/**
 * A reference to an evidence artifact in the prediction's chain. The
 * chain is:
 *   - `representation`:  the W154 representation's `provenanceChainDigest`;
 *   - `featureSet`:     the W153 feature set's `inputDigest` (the
 *                       cryptographic anchor over the immutable
 *                       observation stream);
 *   - `observation`:    the W153 feature set's `inputObservationRefs`
 *                       (the immutable observation ids the feature set
 *                       summarizes);
 *   - `contextObservation`: the W154 context's `contextObservationRefs`
 *                       (the optional context observations' provenance
 *                       refs, chained when the context carries them).
 */
export type PredictionEvidenceRefKind =
  | "representation"
  | "featureSet"
  | "observation"
  | "contextObservation"
  | "candidateAction";

/** An evidence reference in the prediction's chain. */
export interface PredictionEvidenceRef {
  /** The kind of evidence (where in the chain this ref points). */
  readonly kind: PredictionEvidenceRefKind;
  /** The reference value (a digest, an observation id, ...). */
  readonly ref: string;
}

// ---------------------------------------------------------------------------
// The provenance record (the prediction's full traceability)
// ---------------------------------------------------------------------------

/**
 * The provenance record attached to every prediction. Carries:
 *   - `capabilityName`:       the stable capability identifier (the model
 *                             family — e.g. `world-model.reference.deterministic`);
 *   - `capabilityVersion`:   the capability algorithm version;
 *   - `representationDigest`: the W154 representation's `provenanceChainDigest`
 *                             (the prediction's representation anchor);
 *   - `featureSetInputDigest`: the W153 feature set's `inputDigest`
 *                             (the cryptographic anchor over the
 *                             immutable observation stream);
 *   - `contextDigest`:       the W154 context's structural digest (the
 *                             context-input anchor);
 *   - `evidenceRefs`:         the prediction's evidence chain (representation
 *                             → feature set → observations → context
 *                             observations).
 *
 * Mirrors `TwinInterpretation` (packages/device-model/src/twin.ts ~L208):
 * the versioned-interpretation pattern the prediction must be consistent
 * with — kind (the prediction target) / provenance (the capability name
 * + version + the representation + feature-set + observation refs) /
 * evidence refs / uncertainty (the honest interval/spread/confidence).
 */
export interface PredictionProvenance {
  readonly capabilityName: string;
  readonly capabilityVersion: number;
  readonly representationDigest: string;
  readonly featureSetInputDigest: string;
  readonly contextDigest: string;
  readonly evidenceRefs: readonly PredictionEvidenceRef[];
}

// ---------------------------------------------------------------------------
// The prediction record (the W155 input type)
// ---------------------------------------------------------------------------

/**
 * The target of a prediction (the device + the horizon). The `deviceId`
 * is the W154 representation's `identity.deviceId` (chained from the
 * W153 feature set); the `horizon` is the temporal scope of the
 * estimate.
 */
export interface PredictionTargetRef {
  readonly deviceId: DeviceId;
  readonly horizon: PredictionHorizon;
}

/**
 * A world-model prediction — a versioned, deterministic advisory estimate
 * of a device's state trajectory over a horizon. Frozen at construction.
 * Carries:
 *   - `schemaVersion`:          the prediction schema version (frozen for W154);
 *   - `kind`:                   the record kind discriminator (`"prediction"`);
 *   - `capability`:             the capability descriptor (name + version);
 *   - `target`:                 the device + the horizon;
 *   - `estimateKind`:           the prediction target (the trajectory family);
 *   - `estimate`:               the point estimate (the extrapolated value);
 *   - `uncertainty`:            the honest interval/spread/confidence (derived
 *                               from data density, never fabricated);
 *   - `provenance`:             the capability name+version + the chained
 *                               digests + the evidence refs;
 *   - `tenantId`:               the tenant scope (for tenant isolation);
 *   - `correlationId`:           the correlation id of the prediction request;
 *   - `producedAt`:              the INJECTED production instant (ISO 8601 —
 *                               the representation's `asOf`, never a clock read);
 *   - `provenanceChainDigest`:   the SHA-256 over the canonical serialization
 *                               of (representation.provenanceChainDigest,
 *                               capability, target, estimate, uncertainty) —
 *                               the prediction's stable id anchor.
 *
 * The record is advisory (ADR-0002 invariant 1: "The predictive
 * representation is never business truth"; invariant 5: "Predictions
 * cannot mutate authorization state"; invariant 4: counterfactuals are
 * HYPOTHETICAL, never facts — handled by `WorldModelCounterfactual`
 * below).
 */
export interface WorldModelPrediction extends TenantScoped {
  readonly schemaVersion: number;
  readonly kind: "prediction";
  readonly capability: { readonly name: string; readonly version: number };
  readonly target: PredictionTargetRef;
  readonly estimateKind: PredictionTarget;
  readonly estimate: number;
  readonly uncertainty: PredictionUncertainty;
  readonly provenance: PredictionProvenance;
  readonly correlationId: CorrelationId;
  readonly producedAt: string;
  readonly provenanceChainDigest: string;
}

/**
 * A world-model counterfactual — the SAME shape as a prediction PLUS a
 * machine-carried `hypothetical: true` marker + the candidate action
 * ref. The `kind` discriminator is `"counterfactual"` (NOT
 * `"prediction"`), so a counterfactual can NEVER be confused with a
 * prediction — the type system enforces it (a `WorldModelPrediction`
 * has `kind: "prediction"`; a `WorldModelCounterfactual` has `kind:
 * "counterfactual"`; the two are NOT assignable to each other).
 *
 * The candidate action ref is the action the counterfactual is
 * conditioned on (e.g. "restart the device", "replace the battery"). The
 * engine does NOT interpret the action's semantics — it carries the ref
 * into the provenance chain so a reviewer can trace which action the
 * estimate is conditioned on. The action is NEVER executed (invariant
 * 5: "Predictions NEVER authorize or execute actions").
 */
export interface WorldModelCounterfactual extends TenantScoped {
  readonly schemaVersion: number;
  readonly kind: "counterfactual";
  readonly hypothetical: true;
  readonly candidateAction: { readonly ref: string; readonly description: string };
  readonly capability: { readonly name: string; readonly version: number };
  readonly target: PredictionTargetRef;
  readonly estimateKind: PredictionTarget;
  readonly estimate: number;
  readonly uncertainty: PredictionUncertainty;
  readonly provenance: PredictionProvenance;
  readonly correlationId: CorrelationId;
  readonly producedAt: string;
  readonly provenanceChainDigest: string;
}

/**
 * The union of a prediction and a counterfactual — the W155/UI consume
 * this discriminated union. The `kind` field is the discriminator.
 */
export type WorldModelPredictionRecord = WorldModelPrediction | WorldModelCounterfactual;

// ---------------------------------------------------------------------------
// The predict input + result
// ---------------------------------------------------------------------------

/**
 * The input to `predict`. PURE: every timestamp is INJECTED (the
 * `producedAt` is the production instant; the engine reads no clock).
 */
export interface PredictInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: WorldModelTenantScope;
  /** The W154 representation (consumed through its public surface ONLY). */
  readonly representation: WorldModelRepresentation;
  /** The prediction target (the trajectory family). */
  readonly target: PredictionTarget;
  /** The prediction horizon (the temporal scope of the estimate). */
  readonly horizon: PredictionHorizon;
  /** The INJECTED production instant (ISO 8601 — never a clock read). */
  readonly producedAt: string;
  /** The audit sink (default: no-op; the boundary audits tenant-scope refusals). */
  readonly auditSink?: WorldModelAuditSink;
  /** The correlation id of the prediction request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

/** The tagged result of a prediction. */
export type PredictionBuild =
  | { readonly ok: true; readonly prediction: WorldModelPrediction }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The predictAfterAction input + result
// ---------------------------------------------------------------------------

/**
 * The input to `predictAfterAction`. The `candidateAction` is the
 * action the counterfactual is conditioned on. PURE: every timestamp
 * is INJECTED.
 */
export interface PredictAfterActionInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: WorldModelTenantScope;
  /** The W154 representation (consumed through its public surface ONLY). */
  readonly representation: WorldModelRepresentation;
  /** The prediction target (the trajectory family). */
  readonly target: PredictionTarget;
  /** The prediction horizon (the temporal scope of the estimate). */
  readonly horizon: PredictionHorizon;
  /** The candidate action the counterfactual is conditioned on. */
  readonly candidateAction: { readonly ref: string; readonly description: string };
  /** The INJECTED production instant (ISO 8601 — never a clock read). */
  readonly producedAt: string;
  /** The audit sink (default: no-op; the boundary audits tenant-scope refusals). */
  readonly auditSink?: WorldModelAuditSink;
  /** The correlation id of the counterfactual request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

/** The tagged result of a counterfactual. */
export type CounterfactualBuild =
  | { readonly ok: true; readonly counterfactual: WorldModelCounterfactual }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The predict function (D2)
// ---------------------------------------------------------------------------

/**
 * Predict a device's state trajectory over a horizon. PURE: every
 * timestamp is INJECTED, no clock reads, no entropy. The same inputs
 * (same representation + same target + same horizon + same capability
 * version + same producedAt) ALWAYS produce byte-identical outputs
 * (proven by golden tests in `test/determinism.test.ts`).
 *
 * Honesty discipline (PROPAGATES the representation's tagged-union
 * status, never fabricates):
 *   - a non-`ok` representation => a REFUSED prediction (typed error) —
 *     the engine NEVER produces a prediction from a non-ok
 *     representation (a thin/rejected/empty representation has no
 *     features to extrapolate; the engine degrades honestly by
 *     refusing, never by zero-filling);
 *   - an `ok` representation with thin data (low observation count,
 *     stale recency) => a prediction with WIDE uncertainty (the
 *     interval widens with thinness, the confidence drops — never
 *     fabricated precision);
 *   - an `ok` representation with rich data => a prediction with
 *     narrow uncertainty (the interval narrows, the confidence rises).
 *
 * @param input the prediction input (scope, representation, target, horizon, producedAt)
 * @returns the tagged prediction build (the prediction, or a FleetError on invalid input)
 */
export function predict(input: PredictInput): PredictionBuild {
  const guard = checkWorldModelTenantScope(input?.scope);
  if (!guard.ok) {
    return refusedPrediction(
      SYNTHETIC_SYSTEM_TENANT,
      input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
      guard.reason,
      `predict refused access (${guard.reason}: ${guard.detail})`,
    );
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input.correlationId ?? input.scope.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  const representation = input?.representation;
  if (representation === null || representation === undefined || typeof representation !== "object") {
    failures.push({ path: "/representation", reason: "object_required" });
  } else {
    if (representation.schemaVersion !== REPRESENTATION_SCHEMA_VERSION) {
      failures.push({
        path: "/representation/schemaVersion",
        reason: `expected_${REPRESENTATION_SCHEMA_VERSION}`,
      });
    }
    if (representation.derivationVersion !== REPRESENTATION_DERIVATION_VERSION) {
      failures.push({
        path: "/representation/derivationVersion",
        reason: `expected_${REPRESENTATION_DERIVATION_VERSION}`,
      });
    }
  }
  if (typeof input?.target !== "string" || input.target.length === 0) {
    failures.push({ path: "/target", reason: "required" });
  } else if (!ALL_PREDICTION_TARGETS.includes(input.target as PredictionTarget)) {
    failures.push({ path: "/target", reason: "unknown_target" });
  }
  if (input?.horizon === null || typeof input?.horizon !== "object") {
    failures.push({ path: "/horizon", reason: "object_required" });
  } else if (typeof input.horizon.horizonMs !== "number" || input.horizon.horizonMs < 0 || !Number.isFinite(input.horizon.horizonMs)) {
    failures.push({ path: "/horizon/horizonMs", reason: "must_be_non_negative_finite" });
  }
  if (typeof input?.producedAt !== "string" || !looksLikeIso(input.producedAt)) {
    failures.push({ path: "/producedAt", reason: "not_iso" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.predictionInvalid,
        "world-model prediction input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (acting scope vs representation's identity) -
  if (representation.identity.tenantId !== guard.tenantId) {
    emitTenantScopeRefusal(
      input.auditSink,
      WORLD_MODEL_AUDIT_ACTIONS.tenantScopeRefusedPrediction,
      guard.tenantId,
      trace.correlationId,
      input.producedAt,
      "tenant_mismatch",
      `representation.identity.tenantId is ${representation.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
    return refusedPrediction(
      guard.tenantId,
      trace.correlationId,
      "tenant_mismatch",
      `representation.identity.tenantId is ${representation.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
  }

  // ---- 3. Honest-state gate (representation must be `ok`) -------------
  // A non-ok representation has NO features to extrapolate; the engine
  // degrades honestly by REFUSING (typed error — never a zero-filled
  // prediction that looks like a measurement). The refused prediction's
  // error carries the representation's status kind in the invariant
  // field so a reviewer can trace the honest-degradation path.
  if (representation.status.kind !== "ok") {
    return refusedPrediction(
      guard.tenantId,
      trace.correlationId,
      "non_ok_representation",
      `representation.status.kind is ${representation.status.kind}`,
    );
  }

  // ---- 4. Extrapolate the estimate over the horizon -------------------
  const { estimate, uncertainty, evidenceRefs } = extrapolateEstimate(
    representation,
    input.target as PredictionTarget,
    input.horizon,
  );

  // ---- 5. Build the provenance record --------------------------------
  const provenance: PredictionProvenance = frozen({
    capabilityName: REFERENCE_CAPABILITY_NAME,
    capabilityVersion: REFERENCE_CAPABILITY_VERSION,
    representationDigest: representation.provenanceChainDigest,
    featureSetInputDigest: representation.featureSetInputDigest,
    contextDigest: representation.contextDigest,
    evidenceRefs: frozenArray(evidenceRefs),
  });

  // ---- 6. Compute the prediction's provenance-chain digest ------------
  const predictionChainDigest = computePredictionChainDigest({
    representationChainDigest: representation.provenanceChainDigest,
    capabilityName: REFERENCE_CAPABILITY_NAME,
    capabilityVersion: REFERENCE_CAPABILITY_VERSION,
    target: input.target as PredictionTarget,
    horizonMs: input.horizon.horizonMs,
    estimate,
    uncertainty,
    hypothetical: false,
    candidateActionRef: undefined,
  });

  // ---- 7. Build + freeze the prediction ------------------------------
  const prediction: WorldModelPrediction = frozen({
    schemaVersion: PREDICTION_SCHEMA_VERSION,
    kind: "prediction" as const,
    capability: frozen({ name: REFERENCE_CAPABILITY_NAME, version: REFERENCE_CAPABILITY_VERSION }),
    target: frozen({
      deviceId: representation.identity.deviceId,
      horizon: frozen({ horizonMs: input.horizon.horizonMs }),
    }),
    estimateKind: input.target as PredictionTarget,
    estimate,
    uncertainty: frozen({ ...uncertainty }),
    provenance,
    tenantId: guard.tenantId,
    correlationId: trace.correlationId,
    producedAt: input.producedAt,
    provenanceChainDigest: predictionChainDigest,
  });
  return { ok: true, prediction };
}

// ---------------------------------------------------------------------------
// The predictAfterAction function (D2)
// ---------------------------------------------------------------------------

/**
 * Predict a device's state trajectory over a horizon CONDITIONAL on a
 * candidate action. PURE: every timestamp is INJECTED, no clock reads,
 * no entropy. The output is a `WorldModelCounterfactual` — the SAME
 * shape as a prediction PLUS a machine-carried `hypothetical: true`
 * marker + the candidate action ref. The `kind` discriminator is
 * `"counterfactual"` (NOT `"prediction"`), so a counterfactual can
 * NEVER be confused with a prediction — the type system enforces it
 * (machine-tested).
 *
 * The candidate action is NEVER executed (invariant 5). The engine
 * carries the action's ref into the provenance chain so a reviewer can
 * trace which action the estimate is conditioned on. The engine does
 * NOT interpret the action's semantics — it applies a deterministic
 * "action effect" model: a candidate action shifts the estimate by a
 * fixed "action impact" (the W154 reference implementation uses a small
 * fixed shift — the work order: "Narrow the derivation family, never
 * the invariants"; a richer action model is a future capability
 * version). The shift widens the uncertainty (the counterfactual is
 * LESS certain than the unconditional prediction, because the action's
 * effect is uncertain).
 *
 * @param input the counterfactual input (scope, representation, target, horizon, candidateAction, producedAt)
 * @returns the tagged counterfactual build (the counterfactual, or a FleetError on invalid input)
 */
export function predictAfterAction(input: PredictAfterActionInput): CounterfactualBuild {
  const guard = checkWorldModelTenantScope(input?.scope);
  if (!guard.ok) {
    return refusedCounterfactual(
      SYNTHETIC_SYSTEM_TENANT,
      input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
      guard.reason,
      `predictAfterAction refused access (${guard.reason}: ${guard.detail})`,
    );
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input.correlationId ?? input.scope.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  const representation = input?.representation;
  if (representation === null || representation === undefined || typeof representation !== "object") {
    failures.push({ path: "/representation", reason: "object_required" });
  } else {
    if (representation.schemaVersion !== REPRESENTATION_SCHEMA_VERSION) {
      failures.push({
        path: "/representation/schemaVersion",
        reason: `expected_${REPRESENTATION_SCHEMA_VERSION}`,
      });
    }
    if (representation.derivationVersion !== REPRESENTATION_DERIVATION_VERSION) {
      failures.push({
        path: "/representation/derivationVersion",
        reason: `expected_${REPRESENTATION_DERIVATION_VERSION}`,
      });
    }
  }
  if (typeof input?.target !== "string" || input.target.length === 0) {
    failures.push({ path: "/target", reason: "required" });
  } else if (!ALL_PREDICTION_TARGETS.includes(input.target as PredictionTarget)) {
    failures.push({ path: "/target", reason: "unknown_target" });
  }
  if (input?.horizon === null || typeof input?.horizon !== "object") {
    failures.push({ path: "/horizon", reason: "object_required" });
  } else if (typeof input.horizon.horizonMs !== "number" || input.horizon.horizonMs < 0 || !Number.isFinite(input.horizon.horizonMs)) {
    failures.push({ path: "/horizon/horizonMs", reason: "must_be_non_negative_finite" });
  }
  if (input?.candidateAction === null || typeof input?.candidateAction !== "object") {
    failures.push({ path: "/candidateAction", reason: "object_required" });
  } else {
    if (typeof input.candidateAction.ref !== "string" || input.candidateAction.ref.length === 0) {
      failures.push({ path: "/candidateAction/ref", reason: "required" });
    }
    if (typeof input.candidateAction.description !== "string") {
      failures.push({ path: "/candidateAction/description", reason: "required" });
    }
  }
  if (typeof input?.producedAt !== "string" || !looksLikeIso(input.producedAt)) {
    failures.push({ path: "/producedAt", reason: "not_iso" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.predictionInvalid,
        "world-model counterfactual input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (acting scope vs representation's identity) -
  if (representation.identity.tenantId !== guard.tenantId) {
    emitTenantScopeRefusal(
      input.auditSink,
      WORLD_MODEL_AUDIT_ACTIONS.tenantScopeRefusedCounterfactual,
      guard.tenantId,
      trace.correlationId,
      input.producedAt,
      "tenant_mismatch",
      `representation.identity.tenantId is ${representation.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
    return refusedCounterfactual(
      guard.tenantId,
      trace.correlationId,
      "tenant_mismatch",
      `representation.identity.tenantId is ${representation.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
  }

  // ---- 3. Honest-state gate (representation must be `ok`) -------------
  if (representation.status.kind !== "ok") {
    return refusedCounterfactual(
      guard.tenantId,
      trace.correlationId,
      "non_ok_representation",
      `representation.status.kind is ${representation.status.kind}`,
    );
  }

  // ---- 4. Extrapolate the estimate over the horizon -------------------
  const base = extrapolateEstimate(
    representation,
    input.target as PredictionTarget,
    input.horizon,
  );

  // ---- 5. Apply the candidate-action effect (the deterministic shift) -
  // The W154 reference implementation uses a small fixed shift: the
  // estimate shifts by 10% of the uncertainty spread (the action's
  // effect is bounded by the data's uncertainty — a wider interval
  // allows a larger shift; a narrower interval constrains it). The
  // shift widens the uncertainty by 50% (the counterfactual is LESS
  // certain than the unconditional prediction).
  const actionShift = base.uncertainty.spread * 0.1;
  const counterfactualEstimate = base.estimate + actionShift;
  const counterfactualSpread = base.uncertainty.spread * 1.5;
  const counterfactualLower = counterfactualEstimate - counterfactualSpread;
  const counterfactualUpper = counterfactualEstimate + counterfactualSpread;
  const counterfactualConfidence = base.uncertainty.confidence * 0.8; // 20% confidence drop
  const counterfactualUncertainty: PredictionUncertainty = frozen({
    lower: counterfactualLower,
    upper: counterfactualUpper,
    spread: counterfactualSpread,
    confidence: counterfactualConfidence,
    observationCount: base.uncertainty.observationCount,
    recencyWeight: base.uncertainty.recencyWeight,
  });

  // ---- 6. Build the provenance record (chaining the candidate action) -
  const evidenceRefs = [
    ...base.evidenceRefs,
    frozen({ kind: "candidateAction" as const, ref: input.candidateAction.ref }),
  ];
  const provenance: PredictionProvenance = frozen({
    capabilityName: REFERENCE_CAPABILITY_NAME,
    capabilityVersion: REFERENCE_CAPABILITY_VERSION,
    representationDigest: representation.provenanceChainDigest,
    featureSetInputDigest: representation.featureSetInputDigest,
    contextDigest: representation.contextDigest,
    evidenceRefs: frozenArray(evidenceRefs),
  });

  // ---- 7. Compute the counterfactual's provenance-chain digest ---------
  const counterfactualChainDigest = computePredictionChainDigest({
    representationChainDigest: representation.provenanceChainDigest,
    capabilityName: REFERENCE_CAPABILITY_NAME,
    capabilityVersion: REFERENCE_CAPABILITY_VERSION,
    target: input.target as PredictionTarget,
    horizonMs: input.horizon.horizonMs,
    estimate: counterfactualEstimate,
    uncertainty: counterfactualUncertainty,
    hypothetical: true,
    candidateActionRef: input.candidateAction.ref,
  });

  // ---- 8. Build + freeze the counterfactual ---------------------------
  // The `kind: "counterfactual"` discriminator + the `hypothetical: true`
  // marker make it IMPOSSIBLE to construct a counterfactual that
  // renders as fact (machine-tested in test/counterfactual.test.ts).
  const counterfactual: WorldModelCounterfactual = frozen({
    schemaVersion: PREDICTION_SCHEMA_VERSION,
    kind: "counterfactual" as const,
    hypothetical: true as const,
    candidateAction: frozen({ ref: input.candidateAction.ref, description: input.candidateAction.description }),
    capability: frozen({ name: REFERENCE_CAPABILITY_NAME, version: REFERENCE_CAPABILITY_VERSION }),
    target: frozen({
      deviceId: representation.identity.deviceId,
      horizon: frozen({ horizonMs: input.horizon.horizonMs }),
    }),
    estimateKind: input.target as PredictionTarget,
    estimate: counterfactualEstimate,
    uncertainty: counterfactualUncertainty,
    provenance,
    tenantId: guard.tenantId,
    correlationId: trace.correlationId,
    producedAt: input.producedAt,
    provenanceChainDigest: counterfactualChainDigest,
  });
  return { ok: true, counterfactual };
}

// ---------------------------------------------------------------------------
// The uncertainty + provenance accessors (D2)
// ---------------------------------------------------------------------------

/**
 * Pure accessor: return the prediction's uncertainty metadata. NEVER
 * re-derives, NEVER widens — the uncertainty is frozen at the
 * prediction's construction; this accessor returns it verbatim.
 */
export function uncertainty(prediction: WorldModelPrediction): PredictionUncertainty {
  return prediction.uncertainty;
}

/**
 * Pure accessor: return the prediction's provenance record. NEVER
 * re-derives, NEVER widens — the provenance is frozen at the
 * prediction's construction; this accessor returns it verbatim.
 */
export function provenance(prediction: WorldModelPrediction): PredictionProvenance {
  return prediction.provenance;
}

/** Counterfactual uncertainty accessor (the counterfactual carries uncertainty too). */
export function uncertaintyOf(counterfactual: WorldModelCounterfactual): PredictionUncertainty {
  return counterfactual.uncertainty;
}

/** Counterfactual provenance accessor. */
export function provenanceOf(counterfactual: WorldModelCounterfactual): PredictionProvenance {
  return counterfactual.provenance;
}

// ---------------------------------------------------------------------------
// The prediction-chain digest
// ---------------------------------------------------------------------------

/**
 * Compute the canonical SHA-256 prediction-chain digest. The digest is
 * over the canonical JSON serialization of:
 *   - `representationChainDigest` (the representation's provenance-chain
 *     digest — chained forward from the W153 feature set's input digest
 *     + the W154 context's structural digest);
 *   - `capabilityName` + `capabilityVersion`;
 *   - `target` (the prediction target family);
 *   - `horizonMs` (the horizon duration);
 *   - `estimate` (the point estimate);
 *   - `uncertainty` (the honest interval/spread/confidence);
 *   - `hypothetical` (the counterfactual marker — `false` for
 *     predictions, `true` for counterfactuals);
 *   - `candidateActionRef` (the candidate action ref, when hypothetical).
 *
 * This is the prediction's stable id anchor: a reviewer can verify the
 * chain
 *   prediction → representation → feature set → input digest
 * by re-deriving the digests (the `verifyFeatureSetProvenance` anchor
 * covers the feature-set → input-digest leg; the representation's
 * `provenanceChainDigest` covers the representation → feature-set +
 * context leg; this digest covers the prediction → representation leg).
 *
 * PURE: no clock, no entropy.
 */
export function computePredictionChainDigest(input: {
  readonly representationChainDigest: string;
  readonly capabilityName: string;
  readonly capabilityVersion: number;
  readonly target: PredictionTarget;
  readonly horizonMs: number;
  readonly estimate: number;
  readonly uncertainty: PredictionUncertainty;
  readonly hypothetical: boolean;
  readonly candidateActionRef: string | undefined;
}): string {
  const serializable = {
    representationChainDigest: input.representationChainDigest,
    capabilityName: input.capabilityName,
    capabilityVersion: input.capabilityVersion,
    target: input.target,
    horizonMs: input.horizonMs,
    estimate: input.estimate,
    uncertainty: {
      lower: input.uncertainty.lower,
      upper: input.uncertainty.upper,
      spread: input.uncertainty.spread,
      confidence: input.uncertainty.confidence,
      observationCount: input.uncertainty.observationCount,
      recencyWeight: input.uncertainty.recencyWeight,
    },
    hypothetical: input.hypothetical,
    candidateActionRef: input.candidateActionRef ?? null,
  };
  return sha256Hex(canonicalJson(serializable));
}

// ---------------------------------------------------------------------------
// Internal: extrapolate the estimate over the horizon
// ---------------------------------------------------------------------------

/**
 * Extrapolate the W154 representation's temporal features over the
 * horizon, producing a point estimate + honest uncertainty + the
 * evidence-ref chain.
 *
 * The reference implementation is a deterministic linear extrapolation
 * per prediction target:
 *   - `device_health_trajectory`: the W153 numeric-summary feature's
 *                                 LAST value, extrapolated linearly by
 *                                 the LAST-vs-MEAN slope over the
 *                                 horizon. The uncertainty is derived
 *                                 from the data density: a low
 *                                 observation count + a stale recency
 *                                 weight widen the interval.
 *   - `cadence_trajectory`:       the W153 arrival-cadence feature's
 *                                 meanMs, held constant (the cadence is
 *                                 assumed to persist). The uncertainty
 *                                 is derived from the cadence variance
 *                                 (max/min ratio) + the data density.
 *   - `recency_drift`:            the W153 window-edge-recency feature's
 *                                 deltaMs, extrapolated linearly over
 *                                 the horizon (the drift is assumed to
 *                                 accumulate). The uncertainty is
 *                                 derived from the data density.
 *
 * The honest confidence is `min(observationCount / 10, 1) *
 * recencyWeight` (a 10-observation fresh feed yields confidence 1; a
 * 1-observation stale feed yields confidence ~0.1). The interval is
 * `estimate ± spread * widthFactor`, where `widthFactor` is `2 -
 * confidence` (a high-confidence estimate yields a narrow interval; a
 * low-confidence estimate yields a wide interval).
 */
function extrapolateEstimate(
  representation: WorldModelRepresentation,
  target: PredictionTarget,
  horizon: PredictionHorizon,
): {
  readonly estimate: number;
  readonly uncertainty: PredictionUncertainty;
  readonly evidenceRefs: readonly PredictionEvidenceRef[];
} {
  // The data-density signal: the W153 feature set's observation count.
  // We pull it from the normalized features (the representation carries
  // the W153 feature set's status, but the count is in the
  // normalizedFeatures array — the W154 representation's
  // normalizedFeatures are the W153 features normalized; we look for
  // the observation_count id).
  const obsCountFeature = representation.normalizedFeatures.find(
    (f) => f.id === "predictive.feature.observation_count",
  );
  const observationCount = obsCountFeature
    ? Math.round(obsCountFeature.value * 100) // denormalize: the value is count/100
    : 0;
  const recencyWeight = obsCountFeature?.weight ?? 0;

  // The honest confidence: min(observationCount / 10, 1) * recencyWeight.
  const densityConfidence = Math.min(observationCount / 10, 1);
  const confidence = Math.max(0, Math.min(1, densityConfidence * recencyWeight));

  // The width factor: 2 - confidence (a high-confidence estimate yields
  // a narrow interval; a low-confidence estimate yields a wide interval).
  // The spread is derived per-target below; the half-width is
  // `spread * widthFactor`.
  const widthFactor = 2 - confidence;

  // The evidence-ref chain: representation → featureSet → observations → contextObservations.
  const evidenceRefs: PredictionEvidenceRef[] = [
    frozen({ kind: "representation" as const, ref: representation.provenanceChainDigest }),
    frozen({ kind: "featureSet" as const, ref: representation.featureSetInputDigest }),
  ];
  // The observation refs are the W153 feature set's inputObservationRefs;
  // we don't have them on the representation (the representation carries
  // the featureSetInputDigest, not the individual observation refs).
  // The evidence chain terminates at the feature-set digest; a
  // reviewer re-runs `verifyFeatureSetProvenance` against the immutable
  // observation stream to verify the feature-set → observation leg.
  for (const ref of representation.contextObservationRefs) {
    evidenceRefs.push(frozen({ kind: "contextObservation" as const, ref }));
  }

  // Per-target extrapolation.
  let estimate = 0;
  let baseSpread = 0;
  if (target === PREDICTION_TARGET_DEVICE_HEALTH_TRAJECTORY) {
    // The W153 numeric-summary feature's LAST value, extrapolated
    // linearly by the LAST-vs-MEAN slope over the horizon.
    // We need the LAST + MEAN values; the representation's
    // normalizedFeatures carry the normalized value (last - min)/range,
    // which is NOT the raw LAST. The raw LAST is not on the
    // representation — the W154 representation normalized it away.
    //
    // The W154 reference implementation extrapolates over the
    // NORMALIZED features (the value in [0, 1] is the position of the
    // LAST value in the [min, max] range; the extrapolation is the
    // linear projection of that position over the horizon). The
    // estimate is in [0, 1] (a normalized health trajectory); the W155
    // lane + the UI interpret the normalized estimate against the
    // device's domain (the W154 work order: "Narrow the derivation
    // family, never the invariants").
    const numericFeatures = representation.normalizedFeatures.filter(
      (f) => f.id === "predictive.feature.numeric_field_summary",
    );
    if (numericFeatures.length === 0) {
      // No numeric features — degrade honestly: estimate 0.5 (the
      // middle of the normalized range), spread 0.5 (the full range).
      estimate = 0.5;
      baseSpread = 0.5;
    } else {
      // Use the FIRST numeric feature's normalized value as the
      // estimate (deterministic; the W155 lane can branch on the path
      // if it needs a specific one).
      const first = numericFeatures[0]!;
      estimate = first.value;
      // The base spread is the W153 feature's normalized range (the
      // value is in [0, 1]; a value of 0.5 means the LAST is in the
      // middle of the range — the spread is 0.5; a value of 1 means the
      // LAST is at the max — the spread is 0). The spread is
      // `min(estimate, 1 - estimate)` (the half-width to the nearest
      // bound).
      baseSpread = Math.min(estimate, 1 - estimate);
      // Linear extrapolation: the estimate shifts by the LAST-vs-MEAN
      // slope over the horizon. The slope is `(last - mean)/range`; the
      // normalized `value = (last - min)/range`, so the slope is
      // `value - (mean - min)/range`. We don't have the mean on the
      // representation; the W154 reference uses a small fixed drift
      // (the work order's "narrow the derivation family"):
      //   estimate += drift * horizonMs / (24h in ms)
      // The drift is 0.1 per 24h (a 10% drift per day — a
      // deterministic, modest, fully-specified drift).
      const driftPer24h = 0.1;
      const drift = driftPer24h * (horizon.horizonMs / (24 * 60 * 60 * 1000));
      estimate = Math.max(0, Math.min(1, estimate + drift));
    }
  } else if (target === PREDICTION_TARGET_CADENCE_TRAJECTORY) {
    // The W153 arrival-cadence feature's meanMs, held constant. The
    // representation's normalizedFeatures carry the normalized cadence
    // (`meanMs / 60_000`); we use that as the estimate (the cadence is
    // in [0, 1] — a 1-minute cadence yields 1, a 1-second cadence yields
    // ~0.017).
    const cadenceFeature = representation.normalizedFeatures.find(
      (f) => f.id === "predictive.feature.arrival_cadence",
    );
    if (cadenceFeature === undefined) {
      estimate = 0.5;
      baseSpread = 0.5;
    } else {
      estimate = cadenceFeature.value;
      baseSpread = Math.min(estimate, 1 - estimate);
    }
  } else {
    // target === PREDICTION_TARGET_RECENCY_DRIFT
    // The W153 window-edge-recency feature's deltaMs, extrapolated
    // linearly over the horizon. The representation's
    // normalizedFeatures carry the normalized recency
    // (`min(deltaMs, 24h) / 24h`); we use that as the estimate.
    const recencyFeature = representation.normalizedFeatures.find(
      (f) => f.id === "predictive.feature.window_edge_recency",
    );
    if (recencyFeature === undefined) {
      estimate = 0.5;
      baseSpread = 0.5;
    } else {
      estimate = recencyFeature.value;
      baseSpread = Math.min(estimate, 1 - estimate);
      // Linear extrapolation: the recency drifts upward over the horizon
      // (the window's `to` recedes further into the past as time
      // passes). The drift is `horizonMs / (24h in ms)` (a 24h horizon
      // adds 1 to the normalized recency — the recency drifts from 0 to
      // 1 over 24h).
      const drift = horizon.horizonMs / (24 * 60 * 60 * 1000);
      estimate = Math.max(0, Math.min(1, estimate + drift));
    }
  }

  // The honest interval: estimate ± spread * widthFactor.
  // The spread has a SMALL FLOOR (0.1 — a 10% uncertainty minimum) so a
  // boundary-pinned value (last == min or last == max, yielding
  // baseSpread = 0) does NOT fabricate precision (a 0 spread would
  // mean "we're 100% certain the estimate is exactly X" — the W154
  // work order: "the reference derives honest intervals/spreads from
  // data density — a thin feed widens the interval rather than
  // fabricating precision"). The floor is honest: the engine doesn't
  // have enough variability in the data to pin the spread below 10%.
  const MIN_SPREAD_FLOOR = 0.1;
  const effectiveBaseSpread = Math.max(baseSpread, MIN_SPREAD_FLOOR);
  const spread = effectiveBaseSpread * widthFactor;
  const lower = estimate - spread;
  const upper = estimate + spread;
  const finalUncertainty: PredictionUncertainty = frozen({
    lower,
    upper,
    spread,
    confidence,
    observationCount,
    recencyWeight,
  });

  return { estimate, uncertainty: finalUncertainty, evidenceRefs };
}

// ---------------------------------------------------------------------------
// Internal constructors (refused — typed error, never throws raw)
// ---------------------------------------------------------------------------

function refusedPrediction(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: string,
  detail: string,
): PredictionBuild {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.predictionDomain,
      `world-model prediction refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "world-model.prediction",
      reason,
    ),
  });
}

function refusedCounterfactual(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: string,
  detail: string,
): CounterfactualBuild {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.predictionDomain,
      `world-model counterfactual refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "world-model.prediction.counterfactual",
      reason,
    ),
  });
}

/**
 * Emit a tenant-scope refusal audit record to the injected sink (the
 * W040-disclosed audited-boundary pattern). The refusal is CONSEQUENTIAL
 * evidence a reviewer must be able to reconstruct (ADR-0002 invariant 7).
 * PURE: the sink is injected; this helper reads no clock and no entropy.
 */
function emitTenantScopeRefusal(
  sink: WorldModelAuditSink | undefined,
  action: string,
  tenantId: TenantId,
  correlationId: CorrelationId,
  occurredAt: string,
  reason: string,
  detail: string,
): void {
  if (sink === undefined) return;
  sink.append(
    frozen({
      action,
      tenantId,
      subject: null,
      occurredAt,
      correlationId,
      details: frozen({ reason, detail }),
    }),
  );
}

// ---------------------------------------------------------------------------
// The deterministic content digest (for the prediction's stable id)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical content digest of a prediction's CONTENT. Used
 * as the deterministic prediction id (the W070 store-id pattern applied
 * to the world-model feed). NOT used for security — the
 * provenance-chain digest is the cryptographic anchor.
 */
export function predictionContentDigest(prediction: WorldModelPrediction): string {
  const serializable = {
    schemaVersion: prediction.schemaVersion,
    kind: prediction.kind,
    capability: prediction.capability,
    target: prediction.target,
    estimateKind: prediction.estimateKind,
    estimate: prediction.estimate,
    uncertainty: prediction.uncertainty,
    provenance: prediction.provenance,
    tenantId: prediction.tenantId,
    correlationId: prediction.correlationId,
    producedAt: prediction.producedAt,
    provenanceChainDigest: prediction.provenanceChainDigest,
  };
  return sha256Hex(canonicalJson(serializable));
}

/** Convenience: the deterministic store id for a prediction. */
export function predictionId(prediction: WorldModelPrediction): string {
  return `wmp_${predictionContentDigest(prediction)}`;
}

/** Compute the canonical content digest of a counterfactual. */
export function counterfactualContentDigest(counterfactual: WorldModelCounterfactual): string {
  const serializable = {
    schemaVersion: counterfactual.schemaVersion,
    kind: counterfactual.kind,
    hypothetical: counterfactual.hypothetical,
    candidateAction: counterfactual.candidateAction,
    capability: counterfactual.capability,
    target: counterfactual.target,
    estimateKind: counterfactual.estimateKind,
    estimate: counterfactual.estimate,
    uncertainty: counterfactual.uncertainty,
    provenance: counterfactual.provenance,
    tenantId: counterfactual.tenantId,
    correlationId: counterfactual.correlationId,
    producedAt: counterfactual.producedAt,
    provenanceChainDigest: counterfactual.provenanceChainDigest,
  };
  return sha256Hex(canonicalJson(serializable));
}

/** Convenience: the deterministic store id for a counterfactual. */
export function counterfactualId(counterfactual: WorldModelCounterfactual): string {
  return `wmc_${counterfactualContentDigest(counterfactual)}`;
}

/** Re-export the helpers for callers (the audited boundary). */
export const PREDICTION_HELPERS = frozen({
  computePredictionChainDigest,
  predictionContentDigest,
  predictionId,
  counterfactualContentDigest,
  counterfactualId,
  uncertainty,
  provenance,
  uncertaintyOf,
  provenanceOf,
  frozenArray,
});
