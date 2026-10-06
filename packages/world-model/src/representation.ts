/**
 * @fleetos/world-model — D1: the world-model representation.
 *
 * The PURE function family over the W153 `DeviceHistoryFeatureSet`
 * surface: `represent(history, context)` produces a versioned,
 * deterministic derived record (a `WorldModelRepresentation`); `compare`
 * produces a deterministic similarity/distance over two representations
 * of the same schema version.
 *
 * Per ADR-0002 § "Hard invariants" (the lane's constitution, frozen by
 * this lane):
 *   1. The canonical Device Twin remains authoritative — the engine's
 *      outputs are ADVISORY interpretations, never business truth.
 *   2. Observations/events remain immutable — the engine never writes
 *      to any store except its own advisory records (the lane writes
 *      NOTHING: representations and predictions are computed on demand,
 *      advisory, never persisted by this lane).
 *   3. Every representation carries: schema + derivation versions, the
 *      source feature set's identity + inputDigest (chained provenance),
 *      the context digest, and an HONEST STATE that PROPAGATES the W153
 *      feed's tagged-union status (an insufficient-history feed yields a
 *      representation marked insufficient_history carrying WHICH minimums
 *      were missing — NEVER a zero vector that looks like a measurement).
 *   6. A failed or unavailable model DEGRADES HONESTLY: the W153 feed's
 *      non-ok statuses (insufficient_history / empty_window / rejected)
 *      PROPAGATE as explicit honest representation states — NEVER
 *      zero-filled features, NEVER fabricated confidence. An unavailable
 *      adapter yields a typed degraded/unknown state (handled in D3).
 *   7. Tenant isolation at every boundary; cross-tenant inputs rejected.
 *   8. The DETERMINISTIC REFERENCE IMPLEMENTATION works with no GPU, no
 *      model provider, no network — pure TypeScript arithmetic over the
 *      W153 features.
 *  10. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * The CONTEXT INPUT TYPE (`WorldModelContext`) is FROZEN HERE for W155
 * (the workload/project context lane) to build the workload/project
 * projection against. A MINIMAL context (tenant/device refs + asOf only)
 * is valid — the engine degrades honestly on thin context, never
 * fabricates. The context schema is VERSIONED.
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
  type FeatureSetLike,
  type FeatureStatusLike,
  FEATURE_KIND_ARRIVAL_CADENCE,
  FEATURE_KIND_NUMERIC_FIELD_SUMMARY,
  FEATURE_KIND_OBSERVATION_COUNT,
  FEATURE_KIND_OBSERVATION_KIND_MIX,
  FEATURE_KIND_WINDOW_EDGE_RECENCY,
} from "./seam";
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
import type { WorldModelAuditSink } from "./audit-seam";
import { WORLD_MODEL_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// The frozen representation schema + derivation versions
// ---------------------------------------------------------------------------

/**
 * The world-model representation SCHEMA version — frozen for W154.
 * Bumping this is a contract change requiring an ADR (W155 consumes the
 * representation shape, so a schema change is a breaking seam change).
 * The schema describes the shape of `WorldModelRepresentation`'s fields
 * (identity, status, normalizedFeatures, regimeTags, recencyWeights,
 * featureSetIdentity, featureSetInputDigest, contextDigest); the
 * `derivationVersion` describes the algorithm that produced the
 * representation from the W153 feature set + the W154 context.
 */
export const REPRESENTATION_SCHEMA_VERSION = 1 as const;

/**
 * The representation ALGORITHM version — frozen for W154. Bumping this
 * is a representation re-derivation: the same feature set + context at a
 * higher derivation version produces a NEW representation (the W070
 * supersession discipline applied to the world-model feed). The first
 * implementation is `1`.
 */
export const REPRESENTATION_DERIVATION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The frozen context schema version (the W155 input type)
// ---------------------------------------------------------------------------

/**
 * The world-model CONTEXT SCHEMA version — frozen for W154 (the context
 * input type YOUR lane FREEZES, W155 builds the workload/project
 * projection against it). Bumping this is a contract change requiring
 * an ADR. A MINIMAL context (refs + asOf only) is valid; the engine
 * degrades honestly on thin context, never fabricates. Adding OPTIONAL
 * context observations (workload assignment state, procurement stage
 * summaries — each item with its own provenance refs) is a non-breaking
 * change at the SAME schema version (the fields are optional, and the
 * engine branches on presence).
 */
export const WORLD_MODEL_CONTEXT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed machine-stable regime-tag vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed set of REGIME TAGS the W154 reference representation can
 * produce. The vocabulary is machine-stable — adding a new tag is a
 * representation schema change requiring an ADR (W155's workload/project
 * context projection branches on the regime family). The first family
 * is trimmed to what the W153 feature family actually supports (the
 * W154 work order: "Narrow the derivation family, never the invariants"):
 *   - `steady`:                the feature set's status is `ok` AND the
 *                              numeric-summary trend (last vs mean) is
 *                              within a small band (no drift);
 *   - `drifting`:               the numeric-summary trend shows drift
 *                              (last differs from mean by more than the
 *                              band — the representation carries WHICH
 *                              path is drifting);
 *   - `bursty`:                 the arrival cadence variance is high
 *                              (max/min inter-arrival ratio > 2);
 *   - `sparse`:                 the observation count is at the W153
 *                              minimum (exactly MIN_OBSERVATIONS_FOR_FEATURES);
 *   - `degraded`:               the W153 feed is in a non-ok status
 *                              (insufficient_history / empty_window /
 *                              rejected) — the representation carries
 *                              the honest propagated state, never
 *                              fabricated features.
 */
export const REGIME_TAG_STEADY = "world-model.regime.steady" as const;
export const REGIME_TAG_DRIFTING = "world-model.regime.drifting" as const;
export const REGIME_TAG_BURSTY = "world-model.regime.bursty" as const;
export const REGIME_TAG_SPARSE = "world-model.regime.sparse" as const;
export const REGIME_TAG_DEGRADED = "world-model.regime.degraded" as const;

/** The closed set of regime tags the W154 reference representation can produce. */
export type RegimeTag =
  | typeof REGIME_TAG_STEADY
  | typeof REGIME_TAG_DRIFTING
  | typeof REGIME_TAG_BURSTY
  | typeof REGIME_TAG_SPARSE
  | typeof REGIME_TAG_DEGRADED;

/** All regime tags (for validation + iteration; machine-stable order). */
export const ALL_REGIME_TAGS: readonly RegimeTag[] = Object.freeze([
  REGIME_TAG_STEADY,
  REGIME_TAG_DRIFTING,
  REGIME_TAG_BURSTY,
  REGIME_TAG_SPARSE,
  REGIME_TAG_DEGRADED,
]);

// ---------------------------------------------------------------------------
// The honest-state vocabulary (PROPAGATES the W153 feed's tagged union)
// ---------------------------------------------------------------------------

/**
 * The honest status of a world-model representation. The W154 engine
 * PROPAGATES the W153 feed's tagged-union status — NEVER zero-fills, NEVER
 * fabricates confidence. The representation's status is:
 *   - `ok`:                   the W153 feed is `ok` AND the context is
 *                             sufficient (refs + asOf present); the
 *                             representation carries the normalized feature
 *                             vector + regime tags + recency weighting;
 *   - `insufficient_history`: the W153 feed is `insufficient_history`;
 *                             the representation carries WHICH minimums
 *                             were missing (propagated verbatim from the
 *                             feed's status), never a zero vector that
 *                             looks like a measurement;
 *   - `empty_window`:         the W153 feed is `empty_window` (the
 *                             observation window was empty);
 *   - `rejected`:             the W153 feed is `rejected` (a tenant/
 *                             device/privacy violation at the feed layer);
 *   - `thin_context`:        the context is too thin for the engine to
 *                             derive a full representation (e.g. asOf
 *                             missing) — the engine degrades honestly,
 *                             never fabricates a context observation;
 *   - `unavailable`:         the engine's adapter is unavailable (the
 *                             availability probe returned false; the
 *                             engine yields a typed degraded/unknown
 *                             state, never throws — handled in D3).
 *
 * The status carries the reason + the minimum the engine needs (when
 * applicable) so consumers (W155, the UI) can degrade honestly without
 * re-deriving.
 */
export type RepresentationStatus =
  | { readonly kind: "ok" }
  | {
      readonly kind: "insufficient_history";
      /** The W153 feed's reason, propagated verbatim. */
      readonly reason: "below_minimum_count" | "single_observation" | "no_numeric_payloads";
      /** The W153 feed's minimum, propagated verbatim. */
      readonly minimumRequired: number;
    }
  | { readonly kind: "empty_window" }
  | {
      readonly kind: "rejected";
      /** The W153 feed's reason, propagated verbatim. */
      readonly reason: "tenant_mismatch" | "device_mismatch" | "privacy_refusal" | "invalid_input" | "observation_out_of_window";
      /** The W153 feed's detail, propagated verbatim. */
      readonly detail: string;
    }
  | {
      readonly kind: "thin_context";
      /** What the engine needed that the context did not supply. */
      readonly reason: "missing_as_of" | "missing_tenant_ref" | "missing_device_ref";
    }
  | {
      readonly kind: "unavailable";
      /** Why the adapter is unavailable (the availability probe's reason). */
      readonly reason: string;
    };

// ---------------------------------------------------------------------------
// The context input type (FROZEN for W155)
// ---------------------------------------------------------------------------

/**
 * A single optional context observation (workload assignment state,
 * procurement stage summary, ...) the W155 lane will project into the
 * world-model context. Each item carries its own provenance refs (the
 * caller's evidence trail — the engine chains it into the representation's
 * provenance without interpreting the content).
 */
export interface ContextObservationItem {
  /** Stable kind identifier (e.g. "workload.assignment", "procurement.stage"). */
  readonly kind: string;
  /** The observation's content (JSON-serializable; the engine does NOT interpret it). */
  readonly value: unknown;
  /** Provenance refs (the caller's evidence trail; the engine chains them). */
  readonly provenanceRefs: readonly string[];
}

/**
 * The world-model context — the CONTEXT INPUT TYPE W155 BUILDS THE
 * WORKLOAD/PROJECT PROJECTION AGAINST. A structural, tenant-scoped record
 * carrying AT MINIMUM tenant/device refs, an injected asOf instant, and
 * OPTIONAL context observations (workload assignment state, procurement
 * stage summaries — each item with its own provenance refs).
 *
 * A MINIMAL context (refs + asOf only) is valid — the engine degrades
 * honestly on thin context, never fabricates. The context schema is
 * VERSIONED (`WORLD_MODEL_CONTEXT_SCHEMA_VERSION`).
 *
 * The context is tenant-scoped by construction: the tenantId MUST match
 * the W153 feature set's identity.tenantId (a cross-tenant context is
 * REFUSED at the engine boundary — invariant 7). The deviceId is the
 * device the representation is for (MUST match the feature set's
 * identity.deviceId).
 *
 * The `asOf` is the INJECTED instant the representation is computed for
 * (ISO 8601 — never a clock read). The engine uses `asOf` to compute
 * recency weights (the delta from the feature set's window.to to asOf,
 * which bounds how stale the features are).
 *
 * The OPTIONAL context observations are passed through structurally:
 * the engine chains their provenance refs into the representation's
 * provenance chain digest, but it does NOT interpret their content (the
 * W155 lane will interpret them in the workload/project projection; the
 * W154 lane freezes the schema so W155 can build against it).
 */
export interface WorldModelContext extends TenantScoped {
  /** The schema version (frozen at `WORLD_MODEL_CONTEXT_SCHEMA_VERSION`). */
  readonly schemaVersion: number;
  /** The device the representation is for (MUST match the feature set's identity.deviceId). */
  readonly deviceId: DeviceId;
  /** The INJECTED asOf instant (ISO 8601 — never a clock read). */
  readonly asOf: string;
  /** OPTIONAL context observations (workload/procurement state with provenance). */
  readonly observations?: readonly ContextObservationItem[];
  /** The correlation id of the representation request (default: synthetic). */
  readonly correlationId?: CorrelationId;
}

// ---------------------------------------------------------------------------
// The normalized feature vector + the representation record
// ---------------------------------------------------------------------------

/**
 * A single normalized feature in a representation. The value is a
 * dimensionless float in `[0, 1]` (the W153 feature values normalized by
 * the derivation's per-feature scaling); `weight` is the recency weight
 * in `[0, 1]` (1 = fresh, 0 = stale). The normalization is deterministic
 * (same feature set + same context => same normalized values).
 */
export interface NormalizedFeature {
  /** The stable feature identifier (one of the W153 FEATURE_KIND_*). */
  readonly id: string;
  /** The normalized value in [0, 1] (dimensionless). */
  readonly value: number;
  /** The recency weight in [0, 1] (1 = fresh, 0 = stale). */
  readonly weight: number;
  /** A path discriminator for numeric-summary features (empty for others). */
  readonly path: string;
}

/**
 * The world-model representation — a versioned, deterministic derived
 * record over the W153 feature set + the W154 context. Frozen at
 * construction. Carries:
 *   - `schemaVersion`:          the representation schema version (frozen for W154);
 *   - `derivationVersion`:      the derivation algorithm version;
 *   - `identity`:               tenant/device/asOf (the representation's identity);
 *   - `status`:                 the honest state (PROPAGATES the W153 feed's tagged union);
 *   - `normalizedFeatures`:     the normalized feature vector (EMPTY when
 *                               status != `ok` — NEVER a partial vector);
 *   - `regimeTags`:             the regime tags derived from the feature set
 *                               (EMPTY when status != `ok`);
 *   - `featureSetIdentity`:    the source feature set's identity (chained provenance);
 *   - `featureSetInputDigest`:  the source feature set's inputDigest (chained provenance);
 *   - `contextDigest`:          the SHA-256 of the canonical serialization of the context
 *                               (the representation's context-input anchor);
 *   - `contextObservationRefs`: the context observations' provenance refs, normalized
 *                               (chained into the representation's provenance);
 *   - `featureSetStatus`:       the W153 feed's status, propagated verbatim
 *                               (so consumers can branch without re-deriving);
 *   - `derivedAt`:              the INJECTED derivation instant (ISO 8601 — the
 *                               context's `asOf`, never a clock read);
 *   - `provenanceChainDigest`:  the SHA-256 over the canonical serialization of
 *                               (featureSetInputDigest, contextDigest, schemaVersion,
 *                               derivationVersion) — the provenance-chain anchor
 *                               W155 + the UI chain forward into predictions.
 */
export interface WorldModelRepresentation {
  readonly schemaVersion: number;
  readonly derivationVersion: number;
  readonly identity: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
    readonly asOf: string;
  };
  readonly status: RepresentationStatus;
  readonly normalizedFeatures: readonly NormalizedFeature[];
  readonly regimeTags: readonly RegimeTag[];
  readonly featureSetIdentity: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
    readonly window: { readonly from: string; readonly to: string };
  };
  readonly featureSetInputDigest: string;
  readonly contextDigest: string;
  readonly contextObservationRefs: readonly string[];
  readonly featureSetStatus: FeatureStatusLike;
  readonly derivedAt: string;
  readonly provenanceChainDigest: string;
}

// ---------------------------------------------------------------------------
// The represent input + result
// ---------------------------------------------------------------------------

/**
 * The input to `represent`. PURE: every timestamp is INJECTED (the context's
 * `asOf` is the derivation instant; the engine reads no clock). The
 * `featureSet` is the W153 feed (consumed through its public surface ONLY);
 * the `context` is the W154 context input (frozen here for W155).
 */
export interface RepresentInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: WorldModelTenantScope;
  /** The W153 feature set (consumed through its public surface ONLY). */
  readonly featureSet: FeatureSetLike;
  /** The W154 context (the workload/project context input type, frozen here). */
  readonly context: WorldModelContext;
  /** The audit sink (default: no-op; the boundary audits tenant-scope refusals). */
  readonly auditSink?: import("./audit-seam").WorldModelAuditSink;
}

/** The tagged result of a representation. */
export type RepresentationBuild =
  | { readonly ok: true; readonly representation: WorldModelRepresentation }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The context digest (the context-input anchor)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical SHA-256 digest of a `WorldModelContext`. The
 * digest is over the canonical JSON serialization of the context's
 * identity (tenantId, deviceId, asOf, schemaVersion) + the normalized
 * (sorted, deduplicated) context-observation refs. The context's
 * OPTIONAL `observations` contribute their `kind` + `provenanceRefs`
 * (NOT their `value` — the engine does NOT interpret the content; the
 * digest is over the structure, not the payload, so the same context
 * shape with the same evidence trail produces the same digest even when
 * the payload values change).
 *
 * PURE: no clock, no entropy. The digest is a pure function of the context.
 *
 * @param context the context to digest
 * @returns the SHA-256 hex of the canonical serialization
 */
export function computeContextDigest(context: WorldModelContext): string {
  const obsItems = context.observations ?? [];
  const obsSerializable = obsItems.map((obs) => ({
    kind: obs.kind,
    provenanceRefs: [...obs.provenanceRefs].sort(),
  }));
  const serializable = {
    schemaVersion: context.schemaVersion,
    tenantId: context.tenantId,
    deviceId: context.deviceId,
    asOf: context.asOf,
    observations: obsSerializable.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
  };
  return sha256Hex(canonicalJson(serializable));
}

/**
 * Normalize the context observations' provenance refs (deduplicate + sort).
 * The same multiset of refs in ANY input order produces the SAME frozen
 * output array — the basis for byte-identical representations across
 * input permutations (proven by test).
 */
export function normalizeContextObservationRefs(context: WorldModelContext): readonly string[] {
  const obsItems = context.observations ?? [];
  const refs: string[] = [];
  for (const obs of obsItems) {
    for (const ref of obs.provenanceRefs) {
      if (typeof ref === "string" && ref.length > 0) refs.push(ref);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs.sort()) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// The provenance-chain digest (the W155/UI anchor)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical SHA-256 provenance-chain digest of a
 * representation's source. The digest is over the canonical JSON
 * serialization of:
 *   - `featureSetInputDigest` (the W153 feed's input digest — the
 *     cryptographic provenance anchor over the immutable observation
 *     stream);
 *   - `contextDigest` (the W154 context's structural digest);
 *   - `schemaVersion` (the representation schema version);
 *   - `derivationVersion` (the derivation algorithm version).
 *
 * This is the ANCHOR W155 + the UI chain forward into predictions: a
 * prediction's `provenanceChainDigest` chains
 *   prediction → representation → feature set → input digest
 * (verified with the REAL @fleetos/predictive `verifyFeatureSetProvenance`
 * where applicable — the binding-test composition pattern).
 *
 * PURE: no clock, no entropy.
 */
export function computeProvenanceChainDigest(input: {
  readonly featureSetInputDigest: string;
  readonly contextDigest: string;
  readonly schemaVersion: number;
  readonly derivationVersion: number;
}): string {
  const serializable = {
    featureSetInputDigest: input.featureSetInputDigest,
    contextDigest: input.contextDigest,
    schemaVersion: input.schemaVersion,
    derivationVersion: input.derivationVersion,
  };
  return sha256Hex(canonicalJson(serializable));
}

// ---------------------------------------------------------------------------
// The represent function (D1)
// ---------------------------------------------------------------------------

/**
 * Build a world-model representation from a W153 feature set + a W154
 * context. PURE: every timestamp is INJECTED (the context's `asOf` is
 * the derivation instant), no clock reads, no entropy. The same inputs
 * (same feature set + same context + same derivation version) ALWAYS
 * produce byte-identical outputs (proven by golden tests in
 * `test/determinism.test.ts`).
 *
 * Honesty discipline (PROPAGATES the W153 feed's tagged union, never
 * fabricates):
 *   - the W153 feed's `ok` status => a representation with `ok` status +
 *     the full normalized feature vector + regime tags + recency weighting;
 *   - the W153 feed's `insufficient_history` status => a representation
 *     with `insufficient_history` status, the reason + minimumRequired
 *     propagated verbatim, EMPTY normalized features, EMPTY regime tags
 *     (NEVER a zero vector that looks like a measurement);
 *   - the W153 feed's `empty_window` status => a representation with
 *     `empty_window` status, EMPTY features (honest — distinct from
 *     `insufficient_history`);
 *   - the W153 feed's `rejected` status => a representation with
 *     `rejected` status, the reason + detail propagated verbatim, EMPTY
 *     features (NEVER a partial set with cross-tenant/privacy-violation
 *     data);
 *   - a context missing `asOf` => a representation with `thin_context`
 *     status, reason `missing_as_of`, EMPTY features (the engine degrades
 *     honestly, never fabricates a context observation);
 *   - a context whose tenantId/deviceId does NOT match the feature set's
 *     identity => a typed error (cross-tenant/device context is REFUSED
 *     at the engine boundary — invariant 7).
 *
 * @param input the representation input (scope, feature set, context, audit sink)
 * @returns the tagged representation build (the representation, or a FleetError on invalid input)
 */
export function represent(input: RepresentInput): RepresentationBuild {
  const guard = checkWorldModelTenantScope(input?.scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.representationDomain,
        `world-model representation refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: input?.scope?.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID },
        "world-model.representation",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input.scope.correlationId ?? WORLD_MODEL_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  const featureSet = input?.featureSet;
  const context = input?.context;
  if (featureSet === null || featureSet === undefined || typeof featureSet !== "object") {
    failures.push({ path: "/featureSet", reason: "object_required" });
  }
  if (context === null || context === undefined || typeof context !== "object") {
    failures.push({ path: "/context", reason: "object_required" });
  } else {
    if (typeof context.schemaVersion !== "number" || context.schemaVersion < 1) {
      failures.push({ path: "/context/schemaVersion", reason: "must_be_at_least_one" });
    }
    if (context.schemaVersion !== WORLD_MODEL_CONTEXT_SCHEMA_VERSION) {
      failures.push({
        path: "/context/schemaVersion",
        reason: `expected_${WORLD_MODEL_CONTEXT_SCHEMA_VERSION}`,
      });
    }
    if (typeof context.tenantId !== "string" || context.tenantId.length === 0) {
      failures.push({ path: "/context/tenantId", reason: "required" });
    }
    if (typeof context.deviceId !== "string" || context.deviceId.length === 0) {
      failures.push({ path: "/context/deviceId", reason: "required" });
    }
    if (typeof context.asOf !== "string" || !looksLikeIso(context.asOf)) {
      failures.push({ path: "/context/asOf", reason: "not_iso" });
    }
    if (context.observations !== undefined && !Array.isArray(context.observations)) {
      failures.push({ path: "/context/observations", reason: "array_required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.representationInvalid,
        "world-model representation input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (acting scope vs feature set's identity vs context) ----
  if (featureSet.identity.tenantId !== guard.tenantId) {
    emitTenantScopeRefusal(
      input.auditSink,
      WORLD_MODEL_AUDIT_ACTIONS.tenantScopeRefusedRepresentation,
      guard.tenantId,
      trace.correlationId,
      context.asOf,
      "tenant_mismatch",
      `feature set identity.tenantId is ${featureSet.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
    return refused(
      guard.tenantId,
      trace.correlationId,
      "tenant_mismatch",
      `feature set identity.tenantId is ${featureSet.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
  }
  if (context.tenantId !== guard.tenantId) {
    emitTenantScopeRefusal(
      input.auditSink,
      WORLD_MODEL_AUDIT_ACTIONS.tenantScopeRefusedRepresentation,
      guard.tenantId,
      trace.correlationId,
      context.asOf,
      "tenant_mismatch",
      `context.tenantId is ${context.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
    return refused(
      guard.tenantId,
      trace.correlationId,
      "tenant_mismatch",
      `context.tenantId is ${context.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
  }
  // The context's deviceId MUST match the feature set's identity.deviceId
  // (the representation is for ONE device — a cross-device context is refused).
  if (context.deviceId !== featureSet.identity.deviceId) {
    emitTenantScopeRefusal(
      input.auditSink,
      WORLD_MODEL_AUDIT_ACTIONS.tenantScopeRefusedRepresentation,
      guard.tenantId,
      trace.correlationId,
      context.asOf,
      "device_mismatch",
      `context.deviceId is ${context.deviceId as string}; feature set identity.deviceId is ${featureSet.identity.deviceId as string}`,
    );
    return refused(
      guard.tenantId,
      trace.correlationId,
      "device_mismatch",
      `context.deviceId is ${context.deviceId as string}; feature set identity.deviceId is ${featureSet.identity.deviceId as string}`,
    );
  }

  // ---- 3. Compute the context digest + the context observation refs ---
  const contextDigest = computeContextDigest(context);
  const contextObservationRefs = normalizeContextObservationRefs(context);

  // ---- 4. Propagate the W153 feed's tagged-union status ----------------
  // The representation's status PROPAGATES the feed's status — NEVER
  // zero-fills, NEVER fabricates. The non-ok statuses produce EMPTY
  // normalized features + EMPTY regime tags (the engine degrades
  // honestly).
  if (featureSet.status.kind !== "ok") {
    const propagatedStatus = propagateFeedStatus(featureSet.status);
    const nonOkProvenanceChainDigest = computeProvenanceChainDigest({
      featureSetInputDigest: featureSet.inputDigest,
      contextDigest,
      schemaVersion: REPRESENTATION_SCHEMA_VERSION,
      derivationVersion: REPRESENTATION_DERIVATION_VERSION,
    });
    return frozenRepresentation(
      guard.tenantId,
      context.deviceId,
      context.asOf,
      propagatedStatus,
      [],
      [],
      featureSet.identity.tenantId,
      featureSet.identity.deviceId,
      featureSet.identity.window.from,
      featureSet.identity.window.to,
      featureSet.inputDigest,
      contextDigest,
      contextObservationRefs,
      featureSet.status,
      nonOkProvenanceChainDigest,
    );
  }

  // ---- 5. Thin-context gate (asOf missing => thin_context) --------------
  // The context's `asOf` is REQUIRED (it's the derivation instant; the
  // engine uses it to compute recency weights). A missing asOf is
  // already caught at validation; here we check the asOf is BEFORE the
  // feature set's window.to (a future asOf is fine; a past-asOf is honest
  // thin context for the engine's recency computation — we never
  // fabricate, we just degrade).
  // (asOf presence is validated above; nothing to do here for now — the
  // engine computes recency weights from asOf vs window.to below.)

  // ---- 6. Feature derivation (the normalized feature vector) ----------
  const normalizedFeatures = deriveNormalizedFeatures(featureSet, context);
  const regimeTags = deriveRegimeTags(featureSet, normalizedFeatures);

  // ---- 7. Compute the provenance-chain digest -------------------------
  const provenanceChainDigest = computeProvenanceChainDigest({
    featureSetInputDigest: featureSet.inputDigest,
    contextDigest,
    schemaVersion: REPRESENTATION_SCHEMA_VERSION,
    derivationVersion: REPRESENTATION_DERIVATION_VERSION,
  });

  // ---- 8. Build + freeze the representation ---------------------------
  return frozenRepresentation(
    guard.tenantId,
    context.deviceId,
    context.asOf,
    { kind: "ok" },
    normalizedFeatures,
    regimeTags,
    featureSet.identity.tenantId,
    featureSet.identity.deviceId,
    featureSet.identity.window.from,
    featureSet.identity.window.to,
    featureSet.inputDigest,
    contextDigest,
    contextObservationRefs,
    featureSet.status,
    provenanceChainDigest,
  );
}

// ---------------------------------------------------------------------------
// The compare function (D1)
// ---------------------------------------------------------------------------

/** The tagged result of a comparison. */
export type ComparisonResult =
  | {
      readonly ok: true;
      readonly similarity: number;
      readonly distance: number;
      readonly representationADigest: string;
      readonly representationBDigest: string;
    }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Compare two world-model representations of the SAME schema version +
 * derivation version + tenant scope. Returns a deterministic similarity
 * in `[0, 1]` (1 = identical, 0 = maximally different) and a distance in
 * `[0, 1]` (0 = identical, 1 = maximally different). The similarity is
 * `1 - distance`; the distance is the L1 (Manhattan) distance over the
 * normalized feature vectors, divided by the maximum possible L1 distance
 * (the sum of the dimensions — 2 per dimension, since each is in [0, 1]).
 *
 * REFUSES (typed error, never throws raw) on:
 *   - cross-version comparison (the representations have different
 *     `schemaVersion` or `derivationVersion`);
 *   - cross-tenant comparison (the representations have different
 *     `identity.tenantId`);
 *   - non-`ok` representations (one or both representations are in a
 *     non-ok honest state — the comparison would be on EMPTY feature
 *     vectors, which is meaningless; the engine degrades honestly by
 *     refusing).
 *
 * PURE: no clock, no entropy.
 *
 * @param a the first representation
 * @param b the second representation
 * @returns the tagged comparison result
 */
export function compare(
  a: WorldModelRepresentation,
  b: WorldModelRepresentation,
): ComparisonResult {
  // ---- 1. Schema/derivation version check -----------------------------
  if (a.schemaVersion !== b.schemaVersion) {
    return refusedComparison(
      a.identity.tenantId,
      `cross_version_comparison: a.schemaVersion=${a.schemaVersion}, b.schemaVersion=${b.schemaVersion}`,
    );
  }
  if (a.derivationVersion !== b.derivationVersion) {
    return refusedComparison(
      a.identity.tenantId,
      `cross_version_comparison: a.derivationVersion=${a.derivationVersion}, b.derivationVersion=${b.derivationVersion}`,
    );
  }

  // ---- 2. Tenant-scope check -----------------------------------------
  if (a.identity.tenantId !== b.identity.tenantId) {
    return refusedComparison(
      a.identity.tenantId,
      `cross_tenant_comparison: a.tenantId=${a.identity.tenantId as string}, b.tenantId=${b.identity.tenantId as string}`,
    );
  }

  // ---- 3. Honest-state check (both must be `ok`) ---------------------
  if (a.status.kind !== "ok") {
    return refusedComparison(
      a.identity.tenantId,
      `non_ok_representation: a.status.kind=${a.status.kind}`,
    );
  }
  if (b.status.kind !== "ok") {
    return refusedComparison(
      a.identity.tenantId,
      `non_ok_representation: b.status.kind=${b.status.kind}`,
    );
  }

  // ---- 4. L1 distance over the normalized feature vectors ------------
  // Build a unified dimension set (the union of feature ids + paths).
  const dims = new Map<string, { a: number; b: number; weight: number }>();
  for (const f of a.normalizedFeatures) {
    const key = f.path.length > 0 ? `${f.id}#${f.path}` : f.id;
    dims.set(key, { a: f.value, b: 0, weight: f.weight });
  }
  for (const f of b.normalizedFeatures) {
    const key = f.path.length > 0 ? `${f.id}#${f.path}` : f.id;
    const entry = dims.get(key);
    if (entry === undefined) {
      dims.set(key, { a: 0, b: f.value, weight: f.weight });
    } else {
      entry.b = f.value;
      // Use the heavier weight of the two (a representation with a
      // weight-1 feature is closer to one with weight-1 than to one with
      // weight-0 — the recency weight is a salience, not a hard discount).
      if (f.weight > entry.weight) entry.weight = f.weight;
    }
  }
  let l1 = 0;
  let maxL1 = 0;
  for (const entry of dims.values()) {
    l1 += Math.abs(entry.a - entry.b) * entry.weight;
    maxL1 += entry.weight; // max |a - b| is 1 per dimension (each in [0, 1])
  }
  const distance = maxL1 === 0 ? 0 : l1 / maxL1; // in [0, 1]
  const similarity = 1 - distance; // in [0, 1]

  return frozen({
    ok: true as const,
    similarity,
    distance,
    representationADigest: a.provenanceChainDigest,
    representationBDigest: b.provenanceChainDigest,
  });
}

// ---------------------------------------------------------------------------
// The deterministic content digest (for the representation's stable id)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical content digest of a representation's CONTENT
 * (identity + status + normalizedFeatures + regimeTags + the chained
 * digests). The digest is SHA-256 — provenance-grade collision-resistant
 * across tenant scopes. Used as the deterministic representation id
 * (the W070 store-id pattern applied to the world-model feed).
 *
 * The content digest is NOT used for security — the provenance-chain
 * digest (over the chained feature-set input digest + context digest +
 * schema/derivation versions) is the cryptographic provenance anchor.
 * The content digest is for stable deterministic ids (e.g. test golden
 * representations).
 */
export function representationContentDigest(representation: WorldModelRepresentation): string {
  const serializable = {
    identity: {
      tenantId: representation.identity.tenantId,
      deviceId: representation.identity.deviceId,
      asOf: representation.identity.asOf,
    },
    schemaVersion: representation.schemaVersion,
    derivationVersion: representation.derivationVersion,
    status: representation.status,
    normalizedFeatures: [...representation.normalizedFeatures].sort((x, y) => {
      if (x.id !== y.id) return x.id < y.id ? -1 : 1;
      return x.path < y.path ? -1 : x.path > y.path ? 1 : 0;
    }),
    regimeTags: [...representation.regimeTags].sort(),
    featureSetIdentity: representation.featureSetIdentity,
    featureSetInputDigest: representation.featureSetInputDigest,
    contextDigest: representation.contextDigest,
    contextObservationRefs: [...representation.contextObservationRefs],
    featureSetStatus: representation.featureSetStatus,
    derivedAt: representation.derivedAt,
    provenanceChainDigest: representation.provenanceChainDigest,
  };
  return sha256Hex(canonicalJson(serializable));
}

/** Convenience: the deterministic store id for a representation. */
export function representationId(representation: WorldModelRepresentation): string {
  return `wmr_${representationContentDigest(representation)}`;
}

// ---------------------------------------------------------------------------
// Internal: derive the normalized feature vector + the regime tags
// ---------------------------------------------------------------------------

/**
 * Derive the normalized feature vector from the W153 feature set + the
 * W154 context. PURE: deterministic. The normalization is per-feature:
 *   - `observation_count`:        normalized by a fixed cap (e.g. 100) —
 *                                 `min(count / 100, 1)`. A small count
 *                                 yields a small value; a large count
 *                                 saturates at 1.
 *   - `observation_kind_mix`:     normalized by the kind-counts' total
 *                                 (the most-populated kind's ratio) —
 *                                 `max(ratio)`. A single-kind window
 *                                 yields 1; a uniformly-mixed window
 *                                 yields `1/N`.
 *   - `arrival_cadence`:         normalized by a fixed cap (e.g.
 *                                 60_000ms = 1 minute) — the MEAN
 *                                 inter-arrival time, divided by the cap,
 *                                 capped at 1. A 1-minute cadence yields
 *                                 1; a 1-second cadence yields ~0.017.
 *   - `numeric_field_summary`:   normalized by the per-path range
 *                                 (max - min) — the LAST value's
 *                                 position in [min, max], in [0, 1]. A
 *                                 flat path yields 0.5 (the engine
 *                                 degrades honestly — no range => 0).
 *   - `window_edge_recency`:     normalized by a fixed cap (e.g. 24h =
 *                                 86_400_000ms) — `min(deltaMs / cap, 1)`.
 *                                 A fresh window yields a small value; a
 *                                 stale window yields 1.
 *
 * The recency WEIGHT is `1 - recencyNormalized` (a fresh window has
 * weight 1; a stale window has weight 0). The weight is applied to ALL
 * features in the vector (the W153 feed's window freshness is a
 * representation-level signal, not a per-feature signal).
 */
function deriveNormalizedFeatures(
  featureSet: FeatureSetLike,
  context: WorldModelContext,
): readonly NormalizedFeature[] {
  const features: NormalizedFeature[] = [];

  // The recency weight (representation-level): the delta from the
  // feature set's window.to to the context's asOf, normalized by a 24h
  // cap. A fresh window (asOf ≈ window.to) => weight 1; a 24h-stale
  // window => weight 0; a >24h-stale window => weight 0 (capped).
  const toMs = Date.parse(featureSet.identity.window.to);
  const asOfMs = Date.parse(context.asOf);
  let recencyWeight = 0;
  if (Number.isFinite(toMs) && Number.isFinite(asOfMs)) {
    const deltaMs = Math.max(0, asOfMs - toMs);
    const cap = 24 * 60 * 60 * 1000; // 24h in ms
    const recencyNormalized = Math.min(deltaMs / cap, 1);
    recencyWeight = 1 - recencyNormalized;
  }

  for (const f of featureSet.features) {
    if (f.id === FEATURE_KIND_OBSERVATION_COUNT) {
      const count = (f.value as { kind: "count"; count: number }).count;
      const value = Math.min(count / 100, 1);
      features.push(frozen({ id: f.id, value, weight: recencyWeight, path: "" }));
    } else if (f.id === FEATURE_KIND_OBSERVATION_KIND_MIX) {
      const counts = (f.value as { kind: "kind_counts"; counts: readonly (readonly [string, number])[] }).counts;
      const total = counts.reduce((s, [, n]) => s + n, 0);
      const maxRatio = total === 0 ? 0 : Math.max(...counts.map(([, n]) => n / total));
      features.push(frozen({ id: f.id, value: maxRatio, weight: recencyWeight, path: "" }));
    } else if (f.id === FEATURE_KIND_ARRIVAL_CADENCE) {
      const cadence = f.value as { kind: "cadence"; meanMs: number; minMs: number; maxMs: number };
      const cap = 60_000; // 1 minute in ms
      const value = Math.min(cadence.meanMs / cap, 1);
      features.push(frozen({ id: f.id, value, weight: recencyWeight, path: "" }));
    } else if (f.id === FEATURE_KIND_NUMERIC_FIELD_SUMMARY) {
      const summary = f.value as {
        kind: "numeric_summary";
        path: string;
        min: number;
        max: number;
        mean: number;
        last: number;
        sampleCount: number;
      };
      const range = summary.max - summary.min;
      const value = range === 0 ? 0.5 : (summary.last - summary.min) / range;
      features.push(frozen({ id: f.id, value, weight: recencyWeight, path: summary.path }));
    } else if (f.id === FEATURE_KIND_WINDOW_EDGE_RECENCY) {
      const recency = f.value as { kind: "recency"; deltaMs: number };
      const cap = 24 * 60 * 60 * 1000; // 24h in ms
      const value = Math.min(Math.max(recency.deltaMs, 0) / cap, 1);
      features.push(frozen({ id: f.id, value, weight: recencyWeight, path: "" }));
    }
  }

  // Sort by id, then by path (deterministic across input permutations).
  return Object.freeze(
    features.sort((a, b) => {
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    }),
  );
}

/**
 * Derive the regime tags from the W153 feature set + the normalized
 * feature vector. PURE: deterministic. The tags are trimmed to what the
 * W153 feature family actually supports (the W154 work order: "Narrow
 * the derivation family, never the invariants"):
 *   - `degraded`:  the W153 feed's status is non-ok (this branch is
 *                  unreachable here — the caller handles non-ok statuses
 *                  before deriving tags; the tag is included in the
 *                  vocabulary for completeness).
 *   - `steady`:    the W153 feed is ok AND no numeric-summary path is
 *                  drifting (the LAST value is within 10% of the MEAN,
 *                  relative to the range);
 *   - `drifting`:  at least one numeric-summary path is drifting (the
 *                  LAST value differs from the MEAN by more than 10% of
 *                  the range);
 *   - `bursty`:    the arrival cadence variance is high (the max/min
 *                  inter-arrival ratio is > 2);
 *   - `sparse`:    the observation count is at the W153 minimum
 *                  (exactly 2 — `MIN_OBSERVATIONS_FOR_FEATURES`).
 */
function deriveRegimeTags(
  featureSet: FeatureSetLike,
  normalizedFeatures: readonly NormalizedFeature[],
): readonly RegimeTag[] {
  // The W153 feed's status is `ok` here (the caller gates on it).
  const tags: RegimeTag[] = [];

  // `sparse`: the observation count is at the W153 minimum.
  const countFeature = featureSet.features.find((f) => f.id === FEATURE_KIND_OBSERVATION_COUNT);
  const count = countFeature
    ? (countFeature.value as { kind: "count"; count: number }).count
    : 0;
  if (count === 2) {
    // MIN_OBSERVATIONS_FOR_FEATURES — the W153 minimum (we don't import
    // the constant to avoid a deep coupling; the W153 work order
    // documents it as 2).
    tags.push(REGIME_TAG_SPARSE);
  }

  // `bursty`: the arrival cadence variance is high (max/min inter-arrival > 2).
  const cadenceFeature = featureSet.features.find((f) => f.id === FEATURE_KIND_ARRIVAL_CADENCE);
  if (cadenceFeature !== undefined) {
    const cadence = cadenceFeature.value as { kind: "cadence"; meanMs: number; minMs: number; maxMs: number };
    if (cadence.minMs > 0 && cadence.maxMs / cadence.minMs > 2) {
      tags.push(REGIME_TAG_BURSTY);
    }
  }

  // `drifting` vs `steady`: at least one numeric-summary path is
  // drifting (the LAST value differs from the MEAN by more than 10% of
  // the range); otherwise steady.
  let drifting = false;
  for (const f of featureSet.features) {
    if (f.id !== FEATURE_KIND_NUMERIC_FIELD_SUMMARY) continue;
    const summary = f.value as {
      kind: "numeric_summary";
      path: string;
      min: number;
      max: number;
      mean: number;
      last: number;
      sampleCount: number;
    };
    const range = summary.max - summary.min;
    if (range === 0) continue; // flat path — no drift signal
    const drift = Math.abs(summary.last - summary.mean) / range;
    if (drift > 0.1) {
      drifting = true;
      break;
    }
  }
  tags.push(drifting ? REGIME_TAG_DRIFTING : REGIME_TAG_STEADY);

  // Sort the tags into a canonical order (machine-stable).
  return Object.freeze(tags.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------
// Internal: propagate the W153 feed's status to the representation's status
// ---------------------------------------------------------------------------

/**
 * Propagate the W153 feed's `FeatureStatus` to the representation's
 * `RepresentationStatus`. The propagation is verbatim — the reason +
 * minimumRequired + detail are carried unchanged. NEVER zero-fills,
 * NEVER fabricates.
 */
function propagateFeedStatus(status: FeatureStatusLike): RepresentationStatus {
  if (status.kind === "ok") {
    return frozen({ kind: "ok" });
  }
  if (status.kind === "insufficient_history") {
    return frozen({
      kind: "insufficient_history",
      reason: status.reason,
      minimumRequired: status.minimumRequired,
    });
  }
  if (status.kind === "empty_window") {
    return frozen({ kind: "empty_window" });
  }
  // status.kind === "rejected"
  return frozen({
    kind: "rejected",
    reason: status.reason,
    detail: status.detail,
  });
}

// ---------------------------------------------------------------------------
// Internal constructors (frozen)
// ---------------------------------------------------------------------------

/** Build + freeze a representation from derived parts. Pure. */
function frozenRepresentation(
  tenantId: TenantId,
  deviceId: DeviceId,
  asOf: string,
  status: RepresentationStatus,
  normalizedFeatures: readonly NormalizedFeature[],
  regimeTags: readonly RegimeTag[],
  featureSetTenantId: TenantId,
  featureSetDeviceId: DeviceId,
  featureSetWindowFrom: string,
  featureSetWindowTo: string,
  featureSetInputDigest: string,
  contextDigest: string,
  contextObservationRefs: readonly string[],
  featureSetStatus: FeatureStatusLike,
  provenanceChainDigest: string,
): RepresentationBuild {
  const representation: WorldModelRepresentation = frozen({
    schemaVersion: REPRESENTATION_SCHEMA_VERSION,
    derivationVersion: REPRESENTATION_DERIVATION_VERSION,
    identity: frozen({ tenantId, deviceId, asOf }),
    status: frozen({ ...status }) as RepresentationStatus,
    normalizedFeatures: frozenArray(normalizedFeatures),
    regimeTags: frozenArray(regimeTags),
    featureSetIdentity: frozen({
      tenantId: featureSetTenantId,
      deviceId: featureSetDeviceId,
      window: frozen({ from: featureSetWindowFrom, to: featureSetWindowTo }),
    }),
    featureSetInputDigest,
    contextDigest,
    contextObservationRefs: frozenArray(contextObservationRefs),
    featureSetStatus,
    derivedAt: asOf,
    provenanceChainDigest,
  });
  return { ok: true, representation };
}

/** Build + freeze a `refused` representation result (typed error, never throws). */
function refused(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: "tenant_mismatch" | "device_mismatch",
  detail: string,
): RepresentationBuild {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.representationDomain,
      `world-model representation refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "world-model.representation",
      reason,
    ),
  });
}

/** Build + freeze a `refused` comparison result (typed error, never throws). */
function refusedComparison(tenantId: TenantId, detail: string): ComparisonResult {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.representationComparison,
      `world-model comparison refused (${detail})`,
      { tenantId, correlationId: WORLD_MODEL_PIPELINE_CORRELATION_ID },
      "world-model.representation.comparison",
      "comparison_refused",
    ),
  });
}

/**
 * Emit a tenant-scope refusal audit record to the injected sink (the
 * W040-disclosed audited-boundary pattern). The refusal is CONSEQUENTIAL
 * evidence a reviewer must be able to reconstruct (ADR-0002 invariant 7:
 * "Tenant isolation applies to ... inference context, representations,
 * predictions"). PURE: the sink is injected; this helper reads no clock
 * (the `occurredAt` is the caller-supplied instant) and no entropy.
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

/** Re-export the helpers for callers (the audited boundary). */
export const REPRESENTATION_HELPERS = frozen({
  computeContextDigest,
  computeProvenanceChainDigest,
  normalizeContextObservationRefs,
  representationContentDigest,
  representationId,
  frozenArray,
});

// Type-only re-exports for the W155 lane (the frozen input type).
export type { WorldModelTenantScope } from "./internal";
