/**
 * @fleetos/predictive — D2: the versioned provenance record + the
 * `verifyFeatureSetProvenance` pure trust anchor.
 *
 * The W154 engine's trust anchor: given a feature set + the immutable
 * inputs it claims, RE-DERIVE the digest and CONFIRM the observation
 * refs exist in the supplied window. REFUSES (typed error, never throws
 * raw) on mismatch, gap, or cross-tenant ref. This is the seam that lets
 * W154 verify a stored feature set (the recomputable cache) against the
 * immutable observation stream WITHOUT re-running the extractor — the
 * cache hit is verifiable.
 *
 * Per ADR-0002 § "Hard invariants" #2 ("Observations/events remain
 * immutable and auditable") and #3 ("Every feature set carries ... an
 * input digest"): the trust anchor does NOT trust the feature set's own
 * `inputDigest` field — it RE-DERIVES the digest from the supplied
 * observations and compares. A tampered feature set whose `inputDigest`
 * field was overwritten to match a different input stream is REFUSED
 * when the re-derived digest of the actual supplied observations does
 * not match the feature set's claim.
 *
 * Refusals (machine-stable, typed — never throws raw):
 *   - `digest_mismatch`:        the re-derived digest of the supplied
 *                                observations does not match the feature
 *                                set's `inputDigest` field;
 *   - `missing_observation_ref`: a feature's `sourceObservationRefs`
 *                                names an observation id that is NOT in
 *                                the supplied window's observation set;
 *   - `cross_tenant_ref`:        a feature's `sourceObservationRefs`
 *                                names an observation whose tenant scope
 *                                does not match the feature set's tenant;
 *   - `window_mismatch`:         an observation in the supplied set
 *                                falls outside the feature set's window
 *                                (the window the feature set CLAIMS
 *                                does not contain all the observations
 *                                the feature set's refs cite);
 *   - `schema_version_mismatch`: the feature set's `schemaVersion` is
 *                                not the frozen `FEATURE_SET_SCHEMA_VERSION`;
 *   - `extractor_version_mismatch`: the feature set's `extractorVersion`
 *                                is not the frozen `EXTRACTOR_VERSION`;
 *   - `tenant_mismatch`:         the feature set's `identity.tenantId`
 *                                does not match the supplied observations'
 *                                tenant scope.
 *
 * PURE: no clock, no entropy, no I/O. The verification is a pure
 * function of (featureSet, observations) — the same tuple ALWAYS
 * produces the same verification result (proven by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  DeviceId,
  FleetError,
  Observation,
  TenantId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  PREDICTIVE_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  sha256Hex,
} from "./internal";
import type { PredictiveTenantScope } from "./internal";
import { checkPredictiveTenantScope } from "./internal";
import {
  EXTRACTOR_VERSION,
  FEATURE_SET_SCHEMA_VERSION,
  computeInputDigest,
} from "./device-history-features";
import type { DeviceHistoryFeatureSet, FeatureWindow } from "./device-history-features";

// ---------------------------------------------------------------------------
// The verification input + result
// ---------------------------------------------------------------------------

/**
 * The input to `verifyFeatureSetProvenance`. Carries the feature set
 * under verification + the immutable observations the feature set
 * CLAIMS to be derived from. The observations are the ACTING TENANT's
 * own partition (a foreign-tenant observation set is REFUSED with
 * `tenant_mismatch` — never a cross-tenant merge).
 */
export interface VerifyProvenanceInput {
  /** The acting tenant scope (FIRST parameter — the guard). */
  readonly scope: PredictiveTenantScope;
  /** The feature set under verification. */
  readonly featureSet: DeviceHistoryFeatureSet;
  /** The immutable observations the feature set claims to be derived from. */
  readonly observations: readonly Observation[];
  /**
   * The expected device id (when known) — the feature set's
   * `identity.deviceId` MUST match. When omitted, the feature set's
   * `identity.deviceId` is the expected device (the caller trusts the
   * feature set's claim).
   */
  readonly expectedDeviceId?: DeviceId;
  /**
   * The expected window (when known) — the feature set's
   * `identity.window` MUST match. When omitted, the feature set's
   * `identity.window` is the expected window.
   */
  readonly expectedWindow?: FeatureWindow;
}

/** The tagged result of a provenance verification. */
export type VerifyFeatureSetProvenanceResult =
  | { readonly ok: true; readonly verifiedAt: string; readonly inputDigest: string }
  | { readonly ok: false; readonly error: FleetError };

/** The injected verification instant (ISO 8601 — never a clock read). */
export interface VerifyProvenanceOptions {
  /** The INJECTED verification instant (ISO 8601 — never a clock read). */
  readonly verifiedAt: string;
  /** The causation id, when the verification is caused by a specific command. */
  readonly causationId?: import("@fleetos/contracts").CausationId;
}

// ---------------------------------------------------------------------------
// The machine-stable refusal reasons
// ---------------------------------------------------------------------------

/** The stable machine refusal reasons (the trust anchor's invariant set). */
export type ProvenanceRefusalReason =
  | "digest_mismatch"
  | "missing_observation_ref"
  | "cross_tenant_ref"
  | "window_mismatch"
  | "schema_version_mismatch"
  | "extractor_version_mismatch"
  | "tenant_mismatch"
  | "device_mismatch"
  | "invalid_input";

// ---------------------------------------------------------------------------
// The trust anchor (the pure verification core)
// ---------------------------------------------------------------------------

/**
 * Verify a feature set's provenance against the immutable observation
 * stream it claims to be derived from. PURE: no clock, no entropy, no
 * I/O. The verification re-derives the input digest from the supplied
 * observations and compares against the feature set's `inputDigest`
 * field — a tampered feature set whose `inputDigest` field was
 * overwritten to match a different input stream is REFUSED when the
 * re-derived digest does not match.
 *
 * Verification steps (each refusal is a typed error — never throws raw):
 *   1. tenant-scope guard (the acting scope must validate against the
 *      frozen grammar; the feature set's `identity.tenantId` must
 *      match the acting scope's tenant);
 *   2. input validation (the feature set + observations are
 *      well-formed — non-empty fields, ISO 8601 timestamps, valid
 *      schema/extractor versions);
 *   3. schema/extractor version check (the feature set's
 *      `schemaVersion` must be `FEATURE_SET_SCHEMA_VERSION`; the
 *      `extractorVersion` must be `EXTRACTOR_VERSION` — a feature
 *      set claiming a different version is a stale or tampered set);
 *   4. tenant match (the feature set's `identity.tenantId` must
 *      match the acting scope's tenant; every observation that
 *      carries its own tenant scope must match too);
 *   5. device match (the feature set's `identity.deviceId` must
 *      match the expected device id, when supplied);
 *   6. window match (the feature set's `identity.window` must match
 *      the expected window, when supplied);
 *   7. observation refs coverage (every observation ref the feature
 *      set's features cite must be present in the supplied observation
 *      set — a missing ref means the feature set cites an observation
 *      that was NOT in the supplied stream);
 *   8. window containment (every supplied observation's `observedAt`
 *      must fall within the feature set's `identity.window` — a
 *      supplied observation outside the window means the feature set's
 *      digest was computed over a different stream than the supplied
 *      one);
 *   9. digest re-derivation (the SHA-256 of the canonical
 *      serialization of the supplied observation ids + payload hashes,
 *      sorted into the canonical temporal order, MUST equal the
 *      feature set's `inputDigest` field — a mismatch means the
 *      feature set was tampered with or was derived from a different
 *      stream).
 *
 * @param input the verification input (scope, feature set, observations, expected device/window)
 * @param options the verification options (injected instant)
 * @returns the tagged verification result
 */
export function verifyFeatureSetProvenance(
  input: VerifyProvenanceInput,
  options: VerifyProvenanceOptions,
): VerifyFeatureSetProvenanceResult {
  const guard = checkPredictiveTenantScope(input?.scope);
  if (!guard.ok) {
    return refused(
      SYNTHETIC_SYSTEM_TENANT,
      PREDICTIVE_PIPELINE_CORRELATION_ID,
      "invalid_input",
      `predictive trust anchor refused access (${guard.reason}: ${guard.detail})`,
    );
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input.scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  const featureSet = input?.featureSet;
  if (featureSet === null || featureSet === undefined || typeof featureSet !== "object") {
    failures.push({ path: "/featureSet", reason: "object_required" });
  } else {
    if (typeof featureSet.schemaVersion !== "number" || featureSet.schemaVersion < 1) {
      failures.push({ path: "/featureSet/schemaVersion", reason: "must_be_at_least_one" });
    }
    if (typeof featureSet.extractorVersion !== "number" || featureSet.extractorVersion < 1) {
      failures.push({ path: "/featureSet/extractorVersion", reason: "must_be_at_least_one" });
    }
    if (typeof featureSet.inputDigest !== "string" || featureSet.inputDigest.length === 0) {
      failures.push({ path: "/featureSet/inputDigest", reason: "required" });
    }
    if (typeof featureSet.extractedAt !== "string" || !looksLikeIso(featureSet.extractedAt)) {
      failures.push({ path: "/featureSet/extractedAt", reason: "not_iso" });
    }
    if (featureSet.identity === null || typeof featureSet.identity !== "object") {
      failures.push({ path: "/featureSet/identity", reason: "object_required" });
    } else {
      if (typeof featureSet.identity.deviceId !== "string" || featureSet.identity.deviceId.length === 0) {
        failures.push({ path: "/featureSet/identity/deviceId", reason: "required" });
      }
      if (featureSet.identity.window === null || typeof featureSet.identity.window !== "object") {
        failures.push({ path: "/featureSet/identity/window", reason: "object_required" });
      } else {
        if (typeof featureSet.identity.window.from !== "string" || !looksLikeIso(featureSet.identity.window.from)) {
          failures.push({ path: "/featureSet/identity/window/from", reason: "not_iso" });
        }
        if (typeof featureSet.identity.window.to !== "string" || !looksLikeIso(featureSet.identity.window.to)) {
          failures.push({ path: "/featureSet/identity/window/to", reason: "not_iso" });
        }
      }
    }
  }
  if (!Array.isArray(input?.observations)) {
    failures.push({ path: "/observations", reason: "array_required" });
  } else {
    for (let i = 0; i < input.observations.length; i++) {
      const obs = input.observations[i];
      if (!obs || typeof obs.id !== "string" || obs.id.length === 0) {
        failures.push({ path: `/observations/${i}/id`, reason: "required" });
      }
      if (!obs || typeof obs.observedAt !== "string" || !looksLikeIso(obs.observedAt)) {
        failures.push({ path: `/observations/${i}/observedAt`, reason: "not_iso" });
      }
    }
  }
  if (typeof options?.verifiedAt !== "string" || !looksLikeIso(options.verifiedAt)) {
    failures.push({ path: "/verifiedAt", reason: "not_iso" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.provenanceInvalid,
        "predictive feature-set provenance verification input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Schema / extractor version check --------------------------
  if (featureSet.schemaVersion !== FEATURE_SET_SCHEMA_VERSION) {
    return refused(
      guard.tenantId,
      trace.correlationId,
      "schema_version_mismatch",
      `feature set schemaVersion is ${featureSet.schemaVersion}; expected ${FEATURE_SET_SCHEMA_VERSION}`,
    );
  }
  if (featureSet.extractorVersion !== EXTRACTOR_VERSION) {
    return refused(
      guard.tenantId,
      trace.correlationId,
      "extractor_version_mismatch",
      `feature set extractorVersion is ${featureSet.extractorVersion}; expected ${EXTRACTOR_VERSION}`,
    );
  }

  // ---- 3. Tenant match (acting scope vs feature set's identity) ------
  if (featureSet.identity.tenantId !== guard.tenantId) {
    return refused(
      guard.tenantId,
      trace.correlationId,
      "tenant_mismatch",
      `feature set identity.tenantId is ${featureSet.identity.tenantId as string}; acting scope is ${guard.tenantId as string}`,
    );
  }

  // ---- 4. Device match (when an expected device id is supplied) -----
  if (input.expectedDeviceId !== undefined && featureSet.identity.deviceId !== input.expectedDeviceId) {
    return refused(
      guard.tenantId,
      trace.correlationId,
      "device_mismatch",
      `feature set identity.deviceId is ${featureSet.identity.deviceId as string}; expected ${input.expectedDeviceId as string}`,
    );
  }

  // ---- 5. Window match (when an expected window is supplied) --------
  if (input.expectedWindow !== undefined) {
    if (
      featureSet.identity.window.from !== input.expectedWindow.from ||
      featureSet.identity.window.to !== input.expectedWindow.to
    ) {
      return refused(
        guard.tenantId,
        trace.correlationId,
        "window_mismatch",
        `feature set identity.window is [${featureSet.identity.window.from}, ${featureSet.identity.window.to}); expected [${input.expectedWindow.from}, ${input.expectedWindow.to})`,
      );
    }
  }

  // ---- 6. Tenant isolation on observations (every obs scope matches) -
  for (const obs of input.observations) {
    const obsTenant = (obs as unknown as { tenantId?: unknown }).tenantId;
    if (obsTenant !== undefined && obsTenant !== guard.tenantId) {
      return refused(
        guard.tenantId,
        trace.correlationId,
        "cross_tenant_ref",
        `observation ${obs.id} carries tenant scope ${obsTenant as string}; acting scope is ${guard.tenantId as string}`,
      );
    }
  }

  // ---- 7. Window containment (every supplied obs is in the window) --
  for (const obs of input.observations) {
    if (obs.observedAt < featureSet.identity.window.from || obs.observedAt >= featureSet.identity.window.to) {
      return refused(
        guard.tenantId,
        trace.correlationId,
        "window_mismatch",
        `observation ${obs.id} observedAt ${obs.observedAt} is outside the feature set's window [${featureSet.identity.window.from}, ${featureSet.identity.window.to})`,
      );
    }
  }

  // ---- 8. Observation refs coverage (every feature's refs are present) -
  // Build the set of supplied observation ids.
  const suppliedIds = new Set<string>();
  for (const obs of input.observations) {
    suppliedIds.add(obs.id);
  }
  // Also check the feature set's inputObservationRefs — every ref must
  // be present in the supplied set (a missing ref means the feature
  // set's digest was computed over a different stream).
  for (const ref of featureSet.inputObservationRefs) {
    if (!suppliedIds.has(ref)) {
      return refused(
        guard.tenantId,
        trace.correlationId,
        "missing_observation_ref",
        `feature set inputObservationRefs cites ${ref}; not present in the supplied observations`,
      );
    }
  }
  // And every feature's per-feature sourceObservationRefs must be present.
  for (const feature of featureSet.features) {
    for (const ref of feature.provenance.sourceObservationRefs) {
      if (!suppliedIds.has(ref)) {
        return refused(
          guard.tenantId,
          trace.correlationId,
          "missing_observation_ref",
          `feature ${feature.id} provenance.sourceObservationRefs cites ${ref}; not present in the supplied observations`,
        );
      }
    }
  }

  // ---- 9. Digest re-derivation (the SHA-256 of the canonical stream) -
  // Re-sort the supplied observations into the canonical temporal order
  // (sorted by observedAt, tie-broken by id) — the same canonicalization
  // the extractor applies BEFORE computing the digest.
  const sorted = [...input.observations].sort((a, b) => {
    if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  const rederivedDigest = computeInputDigest(sorted);
  if (rederivedDigest !== featureSet.inputDigest) {
    return refused(
      guard.tenantId,
      trace.correlationId,
      "digest_mismatch",
      `re-derived input digest is ${rederivedDigest}; feature set claims ${featureSet.inputDigest}`,
    );
  }

  // ---- 10. Verification PASSED -------------------------------------
  // The feature set's provenance is verified: the input digest matches,
  // every observation ref is present, the window contains every supplied
  // observation, the schema/extractor versions match, the tenant scopes
  // match. The `verifiedAt` instant is INJECTED by the caller (never a
  // clock read). The `inputDigest` is returned so the caller (the W154
  // engine or the binding-site store) can stamp it into the audit
  // record without re-deriving.
  return frozen({
    ok: true as const,
    verifiedAt: options.verifiedAt,
    inputDigest: rederivedDigest,
  });
}

// ---------------------------------------------------------------------------
// Internal constructor (refused — typed error, never throws raw)
// ---------------------------------------------------------------------------

/** Build + freeze a `refused` verification result (typed error, never throws). */
function refused(
  tenantId: TenantId,
  correlationId: CorrelationId,
  reason: ProvenanceRefusalReason,
  detail: string,
): VerifyFeatureSetProvenanceResult {
  return frozen({
    ok: false as const,
    error: makeDomainError(
      ERROR_CODES.provenanceMismatch,
      `predictive feature-set provenance verification refused (${reason}: ${detail})`,
      { tenantId, correlationId },
      "predictive.provenance",
      reason,
    ),
  });
}

// ---------------------------------------------------------------------------
// The deterministic feature-set content digest (for store id + audit)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical content digest of a feature set's CONTENT
 * (identity + status + features + inputDigest fields). The digest is
 * FNV-1a 32-bit hex — the same seam used by `@fleetos/device-model`
 * and `@fleetos/learning` for deterministic ids. Used as the
 * deterministic store id (the feature set's slot in the tenant's
 * append-only derived cache).
 *
 * The digest is over the CANONICAL serialization (sorted keys, sorted
 * arrays where order-invariant) of:
 *   - identity (tenantId, deviceId, window.from, window.to);
 *   - schemaVersion + extractorVersion;
 *   - status (kind + reason + minimumRequired + detail);
 *   - features (sorted by id, then by path within numeric-summary);
 *   - inputDigest (the SHA-256 over the input stream);
 *   - inputObservationRefs (sorted — they already are);
 *   - extractedAt (the injected instant).
 *
 * The digest is NOT used for security — the input digest (SHA-256 over
 * the canonical input stream) is the cryptographic provenance check.
 * The content digest is for stable deterministic ids in the store.
 */
export function featureSetContentDigest(featureSet: DeviceHistoryFeatureSet): string {
  // Sort the features into a canonical order: by id, then by path
  // within the numeric-summary feature family.
  const sortedFeatures = [...featureSet.features].sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.value.kind === "numeric_summary" && b.value.kind === "numeric_summary") {
      return a.value.path < b.value.path ? -1 : a.value.path > b.value.path ? 1 : 0;
    }
    return 0;
  });
  const serializable = {
    identity: {
      tenantId: featureSet.identity.tenantId,
      deviceId: featureSet.identity.deviceId,
      window: {
        from: featureSet.identity.window.from,
        to: featureSet.identity.window.to,
      },
    },
    schemaVersion: featureSet.schemaVersion,
    extractorVersion: featureSet.extractorVersion,
    status: featureSet.status,
    features: sortedFeatures.map((f) => ({
      id: f.id,
      unit: f.unit,
      value: f.value,
      provenance: {
        methodId: f.provenance.methodId,
        methodVersion: f.provenance.methodVersion,
        sourceObservationRefs: [...f.provenance.sourceObservationRefs],
        method: f.provenance.method,
      },
    })),
    inputDigest: featureSet.inputDigest,
    inputObservationRefs: [...featureSet.inputObservationRefs],
    extractedAt: featureSet.extractedAt,
  };
  // We use sha256Hex here for stability across the larger content
  // multispace (FNV-1a 32-bit is fine for short deterministic ids but
  // would collide on feature-set content; SHA-256 is the provenance-
  // grade digest).
  return sha256Hex(canonicalJson(serializable));
}

/** Convenience: the deterministic store id for a feature set. */
export function featureSetStoreId(featureSet: DeviceHistoryFeatureSet): string {
  return `pfs_${featureSetContentDigest(featureSet)}`;
}

/** Re-export the content digest helpers for the store layer. */
export const PROVENANCE_HELPERS = frozen({
  featureSetContentDigest,
  featureSetStoreId,
  computeInputDigest,
});

/** A frozen-array helper for callers that need to copy observation refs. */
export function copyObservationRefs(refs: readonly string[]): readonly string[] {
  return frozenArray(refs);
}
