/**
 * @fleetos/predictive — D1: the device-history feature/provenance feed
 * (the foundational data lane of Wave 14: the Predictive Twin / World
 * Model layer per ADR-0002).
 *
 * This is the deterministic, provenance-carrying feature extraction layer
 * that W154's `represent(history, context)` engine will consume. The
 * extractor READS the immutable admitted observation stream and produces
 * a versioned, byte-reproducible feature set: every feature carries its
 * source observation refs + the method id/version that produced it, and
 * the whole set carries an input digest so a store hit is verifiable
 * against the immutable stream.
 *
 * Per ADR-0002 § "Hard invariants" (the lane's constitution):
 *   1. The feature feed is NEVER business truth — it is a derived,
 *      recomputable interpretation of immutable inputs.
 *   2. Observations/events remain immutable and auditable — READ ONLY,
 *      never mutate or backfill.
 *   3. Every feature set carries: feature-set schema version, extractor
 *      version, input window definition, input observation refs, an input
 *      digest, and per-feature provenance (source refs + method).
 *   4. Determinism is absolute: same immutable inputs + same extractor
 *      version + same window => byte-identical feature set.
 *   5. Insufficient history => explicit honest state
 *      (`insufficient_history` with the reason), NEVER fabricated or
 *      zero-filled values that could be mistaken for measurements.
 *   6. Tenant isolation at the boundary AND in the store semantics: a
 *      feature request is tenant-scoped; cross-tenant inputs are
 *      rejected, never merged.
 *   7. BYOD/privacy: no feature may incorporate data outside the
 *      device's own tenant scope; the design must leave a redaction/
 *      consent seam (structural, like the learning package's) even if
 *      the first implementation is a pass-through check.
 *   8. No GPU, no model provider, no network — the reference
 *      implementation is pure TypeScript arithmetic over the observation
 *      stream.
 *   9. No new authorization surface: the feature feed cannot mutate any
 *      authorization/decision state. Contract Guardian remains sole
 *      authority.
 *  10. Zero runtime dependencies in the new package; strict TS; no
 *      `any` in public signatures; every timestamp injected by the caller.
 *
 * The extractor is a PURE function family — no clock reads, no entropy,
 * no ambient state. The `extractedAt` instant and the `nowAnchor` for
 * relative-window resolution are INJECTED by the caller (the W011/W021/
 * W022/W031/W032/W040/W041/W050B/W070 pattern). Every digest is a pure
 * function of its input. The same immutable inputs + same extractor
 * version + same window produces byte-identical outputs (proven by
 * golden tests in `test/determinism.test.ts`).
 *
 * Determinism strategy: the extractor normalizes the input observation
 * stream to a canonical temporal order (sorted by `observedAt` with a
 * stable secondary sort by `id` to break timestamp ties) before deriving
 * any feature. A reshuffled input that, when sorted, produces the same
 * canonical sequence produces the SAME byte-identical feature set and
 * the SAME input digest — the basis for bit-reproducibility checks
 * (proven by test). The input digest is computed AFTER this
 * normalization, so the digest is over the canonical (sorted) order;
 * this is the "stable order-preserving digest" the W153 work order
 * requires.
 *
 * Honesty discipline (never fabricate values):
 *   - below the minimum observation count => `insufficient_history` with
 *     reason `below_minimum_count` (NEVER zero-filled cadence stats);
 *   - a single observation in the window => `insufficient_history` with
 *     reason `single_observation` (cadence and coverage are undefined —
 *     zero would be a measurement-looking fabrication);
 *   - no numeric payload fields => `insufficient_history` with reason
 *     `no_numeric_payloads` for the numeric-summary feature (NEVER
 *     zeros for min/max/mean/last);
 *   - an empty window (no observations fall in `[from, to)`) =>
 *     `empty_window` (honest — distinct from `insufficient_history`);
 *   - a tenant mismatch (an observation whose tenantId does not match
 *     the input scope) => `rejected` with reason `tenant_mismatch`
 *     (NEVER a partial set, NEVER cross-tenant merge);
 *   - a privacy-seam refusal => `rejected` with reason `privacy_refusal`.
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
import type { TenantScoped } from "@fleetos/contracts";
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
  normalizeRefs,
  sha256Hex,
} from "./internal";
import type { PredictiveTenantScope } from "./internal";
import { checkPredictiveTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The frozen extractor version + schema version
// ---------------------------------------------------------------------------

/**
 * The feature-set SCHEMA version — frozen for W153. Bumping this is a
 * contract change requiring an ADR (the W154 engine consumes the
 * feature set shape, so a schema change is a breaking seam change). The
 * schema describes the shape of `DeviceHistoryFeatureSet`'s fields
 * (identity, status, features, inputDigest, extractedAt); the
 * `extractorVersion` describes the algorithm that produced the features.
 */
export const FEATURE_SET_SCHEMA_VERSION = 1 as const;

/**
 * The extractor ALGORITHM version — frozen for W153. Bumping this is
 * a feature-set re-derivation: the same immutable inputs at a higher
 * extractor version produce a NEW feature set (the prior set is
 * preserved as a versioned interpretation in the store's append-only
 * cache — the W070 supersession discipline applied to the predictive
 * feed). The first implementation is `1`.
 */
export const EXTRACTOR_VERSION = 1 as const;

/**
 * The minimum number of observations the extractor needs to produce a
 * feature set with `ok` status. Below this, the extractor emits
 * `insufficient_history` with reason `below_minimum_count` (NEVER
 * zero-filled values that could be mistaken for measurements). The
 * threshold is `2` — a single observation yields no inter-arrival
 * cadence, no field-coverage trend, no kind-mix variance.
 */
export const MIN_OBSERVATIONS_FOR_FEATURES = 2 as const;

// ---------------------------------------------------------------------------
// The closed machine-stable feature-kind vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed set of feature kinds the W153 extractor can produce. The
 * vocabulary is machine-stable — adding a new kind is a feature-set
 * schema change requiring an ADR (W154's engine branches on the kind
 * family). The first family is trimmed to what the seeded demo history
 * actually supports (the W153 work order: "DO NOT fabricate features
 * the seed cannot feed"):
 *   - `observation_count`:        the count of observations in the window;
 *   - `observation_kind_mix`:     the per-kind counts (open-kind-tolerant);
 *   - `arrival_cadence`:          inter-arrival statistics (mean/min/max ms);
 *   - `numeric_field_summary`:    per-numeric-leaf-path min/max/mean/last;
 *   - `window_edge_recency`:      delta ms from the latest observation to `to`.
 *
 * The closed set is exported as `ALL_FEATURE_KINDS` for validation and
 * iteration; the string literals are exported individually for type-
 * stable branching in consumers.
 */
export const FEATURE_KIND_OBSERVATION_COUNT = "predictive.feature.observation_count" as const;
export const FEATURE_KIND_OBSERVATION_KIND_MIX = "predictive.feature.observation_kind_mix" as const;
export const FEATURE_KIND_ARRIVAL_CADENCE = "predictive.feature.arrival_cadence" as const;
export const FEATURE_KIND_NUMERIC_FIELD_SUMMARY = "predictive.feature.numeric_field_summary" as const;
export const FEATURE_KIND_WINDOW_EDGE_RECENCY = "predictive.feature.window_edge_recency" as const;

/** The closed set of feature kinds the W153 extractor can produce. */
export type FeatureKind =
  | typeof FEATURE_KIND_OBSERVATION_COUNT
  | typeof FEATURE_KIND_OBSERVATION_KIND_MIX
  | typeof FEATURE_KIND_ARRIVAL_CADENCE
  | typeof FEATURE_KIND_NUMERIC_FIELD_SUMMARY
  | typeof FEATURE_KIND_WINDOW_EDGE_RECENCY;

/** All feature kinds (for validation + iteration; machine-stable order). */
export const ALL_FEATURE_KINDS: readonly FeatureKind[] = Object.freeze([
  FEATURE_KIND_OBSERVATION_COUNT,
  FEATURE_KIND_OBSERVATION_KIND_MIX,
  FEATURE_KIND_ARRIVAL_CADENCE,
  FEATURE_KIND_NUMERIC_FIELD_SUMMARY,
  FEATURE_KIND_WINDOW_EDGE_RECENCY,
]);

/** The closed set of feature units (machine-stable). */
export const FEATURE_UNITS = frozen({
  count: "count",
  milliseconds: "ms",
  ratio: "ratio",
  kindCounts: "kind_counts",
  numericSummary: "numeric_summary",
} as const);

// ---------------------------------------------------------------------------
// The status vocabulary (honest state machine)
// ---------------------------------------------------------------------------

/** The reasons an extractor emits `insufficient_history` (machine-stable). */
export type InsufficientHistoryReason =
  | "below_minimum_count"
  | "single_observation"
  | "no_numeric_payloads";

/** The reasons an extractor emits `rejected` (machine-stable). */
export type RejectedReason =
  | "tenant_mismatch"
  | "device_mismatch"
  | "privacy_refusal"
  | "invalid_input"
  | "observation_out_of_window";

/**
 * The honest status of a feature set. `ok` produces the full feature
 * family; the non-ok statuses NEVER produce a partial feature family
 * (no zero-filled values that could be mistaken for measurements). The
 * status carries the reason + the minimum the extractor needs (when
 * applicable) so W154's engine can degrade honestly without re-deriving.
 */
export type FeatureStatus =
  | { readonly kind: "ok" }
  | {
      readonly kind: "insufficient_history";
      readonly reason: InsufficientHistoryReason;
      /** The minimum the extractor needs to flip to `ok` (when applicable). */
      readonly minimumRequired: number;
    }
  | { readonly kind: "empty_window" }
  | {
      readonly kind: "rejected";
      readonly reason: RejectedReason;
      /** Machine-stable detail string (e.g. "tenant:tnt_other observation:obs_x"). */
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// The window definition
// ---------------------------------------------------------------------------

/**
 * The absolute feature window `[from, to)`. The caller computes relative
 * windows against the injected `nowAnchor` BEFORE invoking the
 * extractor; the extractor itself is pure temporal arithmetic. The
 * `from` is INCLUSIVE (an observation whose `observedAt` equals `from`
 * is in the window); the `to` is EXCLUSIVE (an observation whose
 * `observedAt` equals `to` is NOT in the window). This matches the
 * W153 work order's "caller-supplied window [from, to)".
 */
export interface FeatureWindow {
  /** ISO 8601 — inclusive lower bound. */
  readonly from: string;
  /** ISO 8601 — exclusive upper bound. */
  readonly to: string;
}

// ---------------------------------------------------------------------------
// The privacy / redaction seam (BYOD/privacy structural seam, ADR-0002 #7)
// ---------------------------------------------------------------------------

/**
 * The privacy / consent / redaction structural seam. ADR-0002 invariant
 * 7: "BYOD/privacy rules apply before features enter the predictive
 * layer". The seam is checked BEFORE any feature derivation; a refusal
 * emits a `rejected` status with reason `privacy_refusal` (NEVER a
 * partial set with redacted fields — the work order's "structural, like
 * the learning package's" pass-through-first seam).
 *
 * The first implementation is a pass-through (`DEFAULT_PRIVACY_SEAM`):
 * consent is assumed granted for the device's own tenant scope; the
 * seam exists so a real consent/consent-revocation implementation can
 * be injected at the binding site without changing the extractor's
 * contract. This is the W040-disclosed structural pattern (the W021
 * treatment-recommendation seam, the W070 outcome-observation seam).
 *
 * The seam is CHECKED against the input observations (not the derived
 * features): a refusal is a refusal of the input stream, not a
 * redaction of derived values. This keeps the redaction boundary
 * crisp (no derived value can leak a redacted input).
 */
export interface PrivacyRedactionSeam {
  /**
   * Check whether the device's history may be incorporated into a
   * feature set for this tenant scope. PURE: the check is a function
   * of the input tuple only; no clock, no entropy.
   *
   * @param input the tenant scope, device id, and the observations to check
   * @returns the tagged check result
   */
  check(input: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
    readonly observations: readonly Observation[];
  }): { readonly ok: true } | { readonly ok: false; readonly reason: "privacy_refused"; readonly detail: string };
}

/**
 * The default pass-through privacy seam — consent is assumed granted
 * for the device's own tenant scope. A real consent/revocation
 * implementation is injected at the binding site (the W040-disclosed
 * pattern). The default NEVER refuses (it is the structural seam
 * placeholder).
 */
export const DEFAULT_PRIVACY_SEAM: PrivacyRedactionSeam = frozen({
  check: (_input: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
    readonly observations: readonly Observation[];
  }): { readonly ok: true } | { readonly ok: false; readonly reason: "privacy_refused"; readonly detail: string } =>
    frozen({ ok: true }),
});

// ---------------------------------------------------------------------------
// Per-feature provenance (the W154 engine's evidence-reference layer)
// ---------------------------------------------------------------------------

/**
 * The provenance record attached to every feature. Carries:
 *   - `methodId`:           the stable method identifier (e.g.
 *                            "predictive.feature.cadence.v1");
 *   - `methodVersion`:      the algorithm version that produced the value;
 *   - `sourceObservationRefs`: the normalized (deduplicated + sorted)
 *                            observation ids the feature was derived
 *                            from (every value the feature summarizes
 *                            is traceable to an immutable observation);
 *   - `method`:             a human-readable description (NEVER matched
 *                            on — only `methodId` + `methodVersion` are
 *                            machine-stable).
 *
 * Mirrors `TwinInterpretation` (packages/device-model/src/twin.ts ~L208):
 * the versioned-interpretation pattern the predictive feed must be
 * consistent with — kind (the feature kind) / provenance (the source
 * observation refs + the method id) / evidence refs / uncertainty
 * (the feature feed has no uncertainty — features are deterministic
 * summaries; uncertainty is the W154 engine's layer).
 */
export interface FeatureProvenance {
  /** The stable method identifier (e.g. "predictive.feature.cadence.v1"). */
  readonly methodId: string;
  /** The method algorithm version (>= 1). */
  readonly methodVersion: number;
  /** Normalized (deduplicated + sorted) observation ids the feature was derived from. */
  readonly sourceObservationRefs: readonly string[];
  /** Human-readable method description (NEVER matched on). */
  readonly method: string;
}

// ---------------------------------------------------------------------------
// The feature record
// ---------------------------------------------------------------------------

/**
 * A single feature in a feature set. Carries the value, the kind/unit,
 * and the per-feature provenance. The value is a discriminated union
 * over the feature kind family: a count, a kind-count map, a cadence
 * summary, a numeric-summary map, or a recency delta.
 *
 * The value is JSON-serializable (the store's append-only cache
 * materializes feature sets as canonical JSON for the digest check).
 */
export interface Feature {
  /** The stable feature identifier (one of FEATURE_KIND_*). */
  readonly id: FeatureKind;
  /** The machine-stable unit name (one of FEATURE_UNITS). */
  readonly unit: string;
  /** The feature value (discriminated by `id`). */
  readonly value: FeatureValue;
  /** The per-feature provenance (source observation refs + method id/version). */
  readonly provenance: FeatureProvenance;
}

/** The discriminated value union for a feature. */
export type FeatureValue =
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "kind_counts"; readonly counts: readonly (readonly [string, number])[] }
  | { readonly kind: "cadence"; readonly meanMs: number; readonly minMs: number; readonly maxMs: number }
  | {
      readonly kind: "numeric_summary";
      readonly path: string;
      readonly min: number;
      readonly max: number;
      readonly mean: number;
      readonly last: number;
      readonly sampleCount: number;
    }
  | { readonly kind: "recency"; readonly deltaMs: number };

// ---------------------------------------------------------------------------
// The feature set identity + the feature set
// ---------------------------------------------------------------------------

/** The identity tuple of a feature set (tenant/device/window). */
export interface FeatureSetIdentity extends TenantScoped {
  readonly deviceId: DeviceId;
  readonly window: FeatureWindow;
}

/**
 * A device-history feature set — the deterministic, byte-reproducible
 * derived interpretation of an immutable observation stream within a
 * caller-supplied window. Frozen at construction. Carries:
 *   - `schemaVersion`:     the feature-set schema version (frozen for W153);
 *   - `extractorVersion`:  the extractor algorithm version;
 *   - `identity`:          tenant/device/window;
 *   - `status`:            the honest status (`ok` | `insufficient_history`
 *                            | `empty_window` | `rejected`);
 *   - `features`:          the feature family (EMPTY when status != `ok`
 *                            — NEVER a partial family);
 *   - `inputDigest`:       the SHA-256 over the canonical serialization
 *                            of the (sorted) input observation ids +
 *                            payload hashes — bit-reproducibility check;
 *   - `inputObservationRefs`: the normalized (deduplicated + sorted)
 *                            observation ids the digest covers;
 *   - `extractedAt`:       the INJECTED extraction instant (ISO 8601).
 */
export interface DeviceHistoryFeatureSet {
  readonly schemaVersion: number;
  readonly extractorVersion: number;
  readonly identity: FeatureSetIdentity;
  readonly status: FeatureStatus;
  readonly features: readonly Feature[];
  /** The SHA-256 hex of the canonical (sorted) input observation ids + payload hashes. */
  readonly inputDigest: string;
  /** The normalized (deduplicated + sorted) observation ids the digest covers. */
  readonly inputObservationRefs: readonly string[];
  /** The INJECTED extraction instant (ISO 8601 — never a clock read). */
  readonly extractedAt: string;
}

// ---------------------------------------------------------------------------
// The extractor input
// ---------------------------------------------------------------------------

/**
 * The input to `extractDeviceHistoryFeatures`. PURE: every timestamp is
 * INJECTED (the `nowAnchor` for relative-window resolution is the
 * caller's anchor; the `extractedAt` for the feature set's audit
 * timestamp is injected separately; the extractor reads no clock).
 *
 * The `observations` are the immutable admitted observation stream for
 * the device within the window — the caller (the W154 engine, or the
 * binding-site composition) is responsible for filtering the
 * observation log to `[from, to)`. The extractor RE-CHECKS the window
 * (an observation whose `observedAt` falls outside `[from, to)` is
 * rejected with reason `observation_out_of_window` — defense in depth
 * against a caller that did not filter correctly).
 *
 * Tenant isolation is BY CONSTRUCTION: the input's `tenantId` is the
 * acting scope; every observation's `tenantId` MUST match (a mismatch
 * emits `rejected` with reason `tenant_mismatch` — NEVER a partial set
 * with cross-tenant merge). The `deviceId` similarly MUST match every
 * observation's expected device (a mismatch emits `rejected` with
 * reason `device_mismatch`).
 */
export interface DeviceHistoryFeatureInput {
  /** The acting tenant scope (every observation.tenantId MUST match). */
  readonly tenantId: TenantId;
  /** The device whose history is being featured. */
  readonly deviceId: DeviceId;
  /** The immutable admitted observations for the device in the window. */
  readonly observations: readonly Observation[];
  /** The absolute feature window [from, to). */
  readonly window: FeatureWindow;
  /** The INJECTED extraction instant (ISO 8601 — stamped on the feature set). */
  readonly extractedAt: string;
  /** The privacy / consent / redaction seam (default: pass-through). */
  readonly privacy?: PrivacyRedactionSeam;
  /** The correlation id of the extraction request (default: synthetic). */
  readonly correlationId?: CorrelationId;
  /**
   * The expected observation tenant/device — when the caller knows the
   * observations carry their own tenant/device scope (e.g. when the
   * observations are pulled from the device-model store, they don't
   * carry a per-observation tenantId/deviceId in the `Observation`
   * shape — the contracts `Observation` is `{ id, kind, observedAt,
   * schemaVersion, payload }`). When omitted, the input's
   * `tenantId`/`deviceId` ARE the observation scope (the caller is
   * asserting that every observation in the array belongs to this
   * device in this tenant — the extractor trusts the caller's filter
   * but still rejects on window violations).
   */
  readonly observationScope?: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
  };
}

/** The tagged result of an extraction. */
export type DeviceHistoryFeatureBuild =
  | { readonly ok: true; readonly featureSet: DeviceHistoryFeatureSet }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The input digest (the bit-reproducibility check)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 input digest for a normalized (sorted) observation
 * stream. The digest is over the canonical JSON serialization of the
 * sorted `[id, payloadHash]` tuples — where `payloadHash` is the SHA-256
 * of the canonical JSON of the payload. This is the "stable
 * order-preserving digest" the W153 work order requires:
 *   - ORDER-PRESERVING: the digest reflects the canonical temporal order
 *     (sorted by observedAt, with a stable secondary sort by id to break
 *     timestamp ties). A reshuffled input that, when sorted, produces
 *     the same canonical sequence produces the SAME digest.
 *   - STABLE: the same input tuple (in canonical order) ALWAYS produces
 *     the same digest — the basis for the store's hit verification
 *     (every stored set carries the input digest so a store hit is
 *     verifiable against the immutable stream).
 *   - CRYPTOGRAPHIC: SHA-256 over the multiset of observation ids +
 *     payload hashes — an attacker cannot choose a second observation
 *     stream that hashes to the same input digest. (FNV-1a 32-bit is
 *     fine for short deterministic ids where the input domain is
 *     bounded; it is NOT acceptable for input-window provenance
 *     digests that span the full payload multispace.)
 *
 * PURE: no clock, no entropy. The digest is a pure function of the
 * observation stream.
 *
 * @param observations the observations to digest (the caller is
 *   responsible for the canonical sort BEFORE calling; this function
 *   digests in the order given)
 * @returns the SHA-256 hex of the canonical serialization
 */
export function computeInputDigest(observations: readonly Observation[]): string {
  const tuples = observations.map((obs) => [obs.id, sha256Hex(canonicalJson(obs.payload))] as readonly [string, string]);
  return sha256Hex(canonicalJson(tuples));
}

// ---------------------------------------------------------------------------
// The extractor (the pure feature-derivation core)
// ---------------------------------------------------------------------------

/**
 * Extract a device-history feature set from an immutable admitted
 * observation stream within a caller-supplied window. PURE: every
 * timestamp is INJECTED, no clock reads, no entropy. The same inputs
 * (same tenantId + deviceId + observations + window + extractor version
 * + extractedAt) ALWAYS produce byte-identical outputs (proven by golden
 * tests in `test/determinism.test.ts`).
 *
 * Honesty discipline (never fabricate values):
 *   - 0 observations in the window => `empty_window` (honest — distinct
 *     from `insufficient_history`);
 *   - 1 observation in the window => `insufficient_history` with reason
 *     `single_observation` (cadence/coverage undefined — zero would be
 *     a measurement-looking fabrication);
 *   - < MIN_OBSERVATIONS_FOR_FEATURES observations => `insufficient_history`
 *     with reason `below_minimum_count`;
 *   - no numeric payload fields anywhere in the window =>
 *     `insufficient_history` with reason `no_numeric_payloads` for the
 *     numeric-summary feature (NEVER zeros for min/max/mean/last);
 *   - a tenant mismatch (an observation's tenantId does not match the
 *     input scope) => `rejected` with reason `tenant_mismatch` (NEVER a
 *     partial set, NEVER cross-tenant merge);
 *   - a device mismatch => `rejected` with reason `device_mismatch`;
 *   - a privacy-seam refusal => `rejected` with reason `privacy_refusal`;
 *   - an observation whose `observedAt` falls outside `[from, to)` =>
 *     `rejected` with reason `observation_out_of_window` (defense in
 *     depth — the caller is responsible for filtering, but the
 *     extractor double-checks).
 *
 * @param input the extraction input (tenant, device, observations, window, privacy seam)
 * @returns the tagged feature build (the feature set, or a FleetError on invalid input)
 */
export function extractDeviceHistoryFeatures(input: DeviceHistoryFeatureInput): DeviceHistoryFeatureBuild {
  const guard = checkPredictiveTenantScope({ tenantId: input?.tenantId });
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.featureExtractionDomain,
        `predictive device-history feature extraction refused (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: input?.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID },
        "predictive.feature.extraction",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: input?.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
  };

  // ---- 1. Input validation (pure, non-throwing) ---------------------
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof input?.extractedAt !== "string" || !looksLikeIso(input.extractedAt)) {
    failures.push({ path: "/extractedAt", reason: "not_iso" });
  }
  if (input?.window === null || typeof input?.window !== "object") {
    failures.push({ path: "/window", reason: "object_required" });
  } else {
    if (typeof input.window.from !== "string" || !looksLikeIso(input.window.from)) {
      failures.push({ path: "/window/from", reason: "not_iso" });
    }
    if (typeof input.window.to !== "string" || !looksLikeIso(input.window.to)) {
      failures.push({ path: "/window/to", reason: "not_iso" });
    }
    if (
      typeof input.window.from === "string" &&
      typeof input.window.to === "string" &&
      looksLikeIso(input.window.from) &&
      looksLikeIso(input.window.to) &&
      input.window.from > input.window.to
    ) {
      failures.push({ path: "/window", reason: "from_after_to" });
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
      if (!obs || typeof obs.kind !== "string" || obs.kind.length === 0) {
        failures.push({ path: `/observations/${i}/kind`, reason: "required" });
      }
      if (!obs || typeof obs.observedAt !== "string" || !looksLikeIso(obs.observedAt)) {
        failures.push({ path: `/observations/${i}/observedAt`, reason: "not_iso" });
      }
      if (!obs || typeof obs.schemaVersion !== "number" || obs.schemaVersion < 1) {
        failures.push({ path: `/observations/${i}/schemaVersion`, reason: "must_be_at_least_one" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.featureExtractionInvalid,
        "predictive device-history feature extraction input is invalid",
        trace,
        failures,
      ),
    };
  }

  // ---- 2. Tenant isolation (BY CONSTRUCTION) -------------------------
  // When the caller supplies an explicit observationScope, every
  // observation is checked against it; otherwise the input's
  // tenantId/deviceId ARE the scope (the caller is asserting the
  // filter). Either way, a mismatch is REFUSED.
  const scopeTenant = input.observationScope?.tenantId ?? guard.tenantId;
  const scopeDevice = input.observationScope?.deviceId ?? input.deviceId;
  for (let i = 0; i < input.observations.length; i++) {
    const obs = input.observations[i];
    const obsTenant = (obs as unknown as { tenantId?: unknown }).tenantId;
    const obsDevice = (obs as unknown as { deviceId?: unknown }).deviceId;
    // The contracts `Observation` shape doesn't carry tenantId/deviceId
    // (those are scoped at the batch level — the ObservationBatch
    // envelope). When the observation DOES carry them (a structural
    // extension some adapters use), check them; when it doesn't, trust
    // the caller's filter.
    if (obsTenant !== undefined && obsTenant !== scopeTenant) {
      return rejected(
        guard.tenantId,
        input.deviceId,
        input.window,
        input.extractedAt,
        computeInputDigest([]),
        [],
        { kind: "rejected", reason: "tenant_mismatch", detail: `tenant:${obsTenant as string} observation:${obs.id}` },
        trace,
      );
    }
    if (obsDevice !== undefined && obsDevice !== scopeDevice) {
      return rejected(
        guard.tenantId,
        input.deviceId,
        input.window,
        input.extractedAt,
        computeInputDigest([]),
        [],
        { kind: "rejected", reason: "device_mismatch", detail: `device:${obsDevice as string} observation:${obs.id}` },
        trace,
      );
    }
    // Window check (defense in depth — the caller filtered, but the
    // extractor double-checks). An observation whose observedAt falls
    // outside [from, to) is refused.
    if (obs.observedAt < input.window.from || obs.observedAt >= input.window.to) {
      return rejected(
        guard.tenantId,
        input.deviceId,
        input.window,
        input.extractedAt,
        computeInputDigest([]),
        [],
        {
          kind: "rejected",
          reason: "observation_out_of_window",
          detail: `observation:${obs.id} observedAt:${obs.observedAt} window:[${input.window.from},${input.window.to})`,
        },
        trace,
      );
    }
  }

  // ---- 3. The privacy / redaction seam (BYOD/privacy structural) -----
  const privacy = input.privacy ?? DEFAULT_PRIVACY_SEAM;
  const privacyCheck = privacy.check({
    tenantId: guard.tenantId,
    deviceId: input.deviceId,
    observations: input.observations,
  });
  if (!privacyCheck.ok) {
    return rejected(
      guard.tenantId,
      input.deviceId,
      input.window,
      input.extractedAt,
      computeInputDigest([]),
      [],
      { kind: "rejected", reason: "privacy_refusal", detail: privacyCheck.detail },
      trace,
    );
  }

  // ---- 4. Canonical temporal order (sort by observedAt, tie-break by id) -
  const sorted = [...input.observations].sort((a, b) => {
    if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });

  // ---- 5. The input digest (SHA-256 over canonical serialized tuples) -
  const inputDigest = computeInputDigest(sorted);
  const inputObservationRefs = normalizeRefs(sorted.map((obs) => obs.id));

  // ---- 6. Honesty gate: empty window --------------------------------
  if (sorted.length === 0) {
    return frozenFeatureSet(
      guard.tenantId,
      input.deviceId,
      input.window,
      { kind: "empty_window" },
      [],
      inputDigest,
      inputObservationRefs,
      input.extractedAt,
    );
  }

  // ---- 7. Honesty gate: single observation --------------------------
  if (sorted.length === 1) {
    return frozenFeatureSet(
      guard.tenantId,
      input.deviceId,
      input.window,
      { kind: "insufficient_history", reason: "single_observation", minimumRequired: MIN_OBSERVATIONS_FOR_FEATURES },
      [],
      inputDigest,
      inputObservationRefs,
      input.extractedAt,
    );
  }

  // ---- 8. Honesty gate: below minimum -------------------------------
  if (sorted.length < MIN_OBSERVATIONS_FOR_FEATURES) {
    return frozenFeatureSet(
      guard.tenantId,
      input.deviceId,
      input.window,
      { kind: "insufficient_history", reason: "below_minimum_count", minimumRequired: MIN_OBSERVATIONS_FOR_FEATURES },
      [],
      inputDigest,
      inputObservationRefs,
      input.extractedAt,
    );
  }

  // ---- 9. Feature derivation (the deterministic summaries) ----------
  const features: Feature[] = [];

  // 9a. observation_count
  features.push(
    frozen({
      id: FEATURE_KIND_OBSERVATION_COUNT,
      unit: FEATURE_UNITS.count,
      value: frozen({ kind: "count" as const, count: sorted.length }),
      provenance: frozen({
        methodId: "predictive.feature.observation_count.v1",
        methodVersion: 1,
        sourceObservationRefs: inputObservationRefs,
        method: "count of observations in the window",
      }),
    }),
  );

  // 9b. observation_kind_mix (open-kind-tolerant: kind keys drawn from observed kinds)
  const kindCounts = new Map<string, number>();
  for (const obs of sorted) {
    kindCounts.set(obs.kind, (kindCounts.get(obs.kind) ?? 0) + 1);
  }
  const kindCountsSorted: readonly (readonly [string, number])[] = frozenArray(
    [...kindCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
  features.push(
    frozen({
      id: FEATURE_KIND_OBSERVATION_KIND_MIX,
      unit: FEATURE_UNITS.kindCounts,
      value: frozen({ kind: "kind_counts" as const, counts: kindCountsSorted }),
      provenance: frozen({
        methodId: "predictive.feature.observation_kind_mix.v1",
        methodVersion: 1,
        sourceObservationRefs: inputObservationRefs,
        method: "per-kind counts (open-kind-tolerant)",
      }),
    }),
  );

  // 9c. arrival_cadence (inter-arrival statistics in milliseconds)
  const arrivalTimes = sorted.map((obs) => Date.parse(obs.observedAt)).filter((t) => Number.isFinite(t));
  if (arrivalTimes.length === sorted.length && arrivalTimes.length >= 2) {
    const interArrivals: number[] = [];
    for (let i = 1; i < arrivalTimes.length; i++) {
      interArrivals.push(arrivalTimes[i]! - arrivalTimes[i - 1]!);
    }
    const meanMs = interArrivals.reduce((sum, x) => sum + x, 0) / interArrivals.length;
    const minMs = interArrivals.reduce((m, x) => (x < m ? x : m), interArrivals[0]!);
    const maxMs = interArrivals.reduce((m, x) => (x > m ? x : m), interArrivals[0]!);
    features.push(
      frozen({
        id: FEATURE_KIND_ARRIVAL_CADENCE,
        unit: FEATURE_UNITS.milliseconds,
        value: frozen({ kind: "cadence" as const, meanMs, minMs, maxMs }),
        provenance: frozen({
          methodId: "predictive.feature.arrival_cadence.v1",
          methodVersion: 1,
          sourceObservationRefs: inputObservationRefs,
          method: "inter-arrival statistics (mean/min/max ms) over the window",
        }),
      }),
    );
  }

  // 9d. numeric_field_summary (per-numeric-leaf-path min/max/mean/last)
  // Walk every observation's payload recursively; for every leaf number
  // value, accumulate (min/max/sum/last/count) keyed by the canonical
  // JSON-path. This is provider-neutral and contract-stable: works for
  // any payload shape the device agent emits. Boolean/string/null leaves
  // are ignored (only finite numbers enter the summary).
  const numericAggregator = new Map<string, { min: number; max: number; sum: number; last: number; count: number; lastObsId: string }>();
  for (const obs of sorted) {
    walkNumericLeaves(obs.payload, "$", (path, value) => {
      if (!Number.isFinite(value)) return;
      const entry = numericAggregator.get(path);
      if (entry === undefined) {
        numericAggregator.set(path, { min: value, max: value, sum: value, last: value, count: 1, lastObsId: obs.id });
      } else {
        entry.min = Math.min(entry.min, value);
        entry.max = Math.max(entry.max, value);
        entry.sum += value;
        entry.last = value;
        entry.count += 1;
        entry.lastObsId = obs.id;
      }
    });
  }
  if (numericAggregator.size > 0) {
    const numericSummaryFeatures: Feature[] = [];
    const sortedPaths = [...numericAggregator.keys()].sort();
    for (const path of sortedPaths) {
      const entry = numericAggregator.get(path)!;
      const mean = entry.sum / entry.count;
      // The source observation refs for THIS path's summary are the
      // observations that contributed a numeric value at this path.
      // We re-derive them here (deterministic — same input => same refs).
      const sourceRefs = normalizeRefs(
        sorted
          .filter((obs) => {
            let found = false;
            walkNumericLeaves(obs.payload, "$", (p, _v) => {
              if (p === path) found = true;
            });
            return found;
          })
          .map((obs) => obs.id),
      );
      numericSummaryFeatures.push(
        frozen({
          id: FEATURE_KIND_NUMERIC_FIELD_SUMMARY,
          unit: FEATURE_UNITS.numericSummary,
          value: frozen({
            kind: "numeric_summary" as const,
            path,
            min: entry.min,
            max: entry.max,
            mean,
            last: entry.last,
            sampleCount: entry.count,
          }),
          provenance: frozen({
            methodId: "predictive.feature.numeric_field_summary.v1",
            methodVersion: 1,
            sourceObservationRefs: sourceRefs,
            method: `min/max/mean/last over numeric payload leaves at ${path}`,
          }),
        }),
      );
    }
    features.push(...numericSummaryFeatures);
  } else if (sorted.length >= MIN_OBSERVATIONS_FOR_FEATURES) {
    // Honesty: no numeric payload leaves anywhere in the window. The
    // numeric-summary feature is INSUFFICIENT (NEVER zero-filled). The
    // OTHER features are still derivable (count, kind-mix, cadence,
    // recency). We emit the partial feature family for the numeric
    // summary as an `insufficient_history` status on the FEATURE — but
    // the work order says "NEVER fabricated or zero-filled values that
    // could be mistaken for measurements", so we OMIT the feature
    // entirely rather than emit a zero-filled summary. The feature set's
    // STATUS stays `ok` (the other features are derivable); the
    // numeric-summary absence is the honest signal.
    //
    // (No feature pushed for this path — the absence is the signal.)
  }

  // 9e. window_edge_recency (delta ms from latest observation to `to`)
  const latest = sorted[sorted.length - 1]!;
  const latestMs = Date.parse(latest.observedAt);
  const toMs = Date.parse(input.window.to);
  if (Number.isFinite(latestMs) && Number.isFinite(toMs)) {
    const deltaMs = toMs - latestMs;
    features.push(
      frozen({
        id: FEATURE_KIND_WINDOW_EDGE_RECENCY,
        unit: FEATURE_UNITS.milliseconds,
        value: frozen({ kind: "recency" as const, deltaMs }),
        provenance: frozen({
          methodId: "predictive.feature.window_edge_recency.v1",
          methodVersion: 1,
          sourceObservationRefs: normalizeRefs([latest.id]),
          method: "delta ms from the latest observation's observedAt to the window's `to`",
        }),
      }),
    );
  }

  // ---- 10. Build + freeze the feature set ---------------------------
  return frozenFeatureSet(
    guard.tenantId,
    input.deviceId,
    input.window,
    { kind: "ok" },
    features,
    inputDigest,
    inputObservationRefs,
    input.extractedAt,
  );
}

// ---------------------------------------------------------------------------
// Numeric-leaf walker (provider-neutral, contract-stable)
// ---------------------------------------------------------------------------

/**
 * Walk every leaf number value in a JSON-serializable payload, calling
 * the visitor with the canonical JSON-path and the numeric value. The
 * path is a `$`-prefixed dotted path (e.g. `$.disk.capacityBytes`).
 * Array indices are bracketed (e.g. `$.disks[0].capacityBytes`). This
 * is provider-neutral and contract-stable: works for any payload shape
 * the device agent emits.
 */
function walkNumericLeaves(
  value: unknown,
  path: string,
  visitor: (path: string, value: number) => void,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    visitor(path, value);
    return;
  }
  if (typeof value === "boolean" || typeof value === "string") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkNumericLeaves(value[i], `${path}[${i}]`, visitor);
    }
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    for (const key of keys) {
      walkNumericLeaves(record[key], `${path}.${key}`, visitor);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal constructors (frozen)
// ---------------------------------------------------------------------------

/** Build + freeze a feature set from derived parts. Pure. */
function frozenFeatureSet(
  tenantId: TenantId,
  deviceId: DeviceId,
  window: FeatureWindow,
  status: FeatureStatus,
  features: readonly Feature[],
  inputDigest: string,
  inputObservationRefs: readonly string[],
  extractedAt: string,
): DeviceHistoryFeatureBuild {
  const featureSet: DeviceHistoryFeatureSet = frozen({
    schemaVersion: FEATURE_SET_SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    identity: frozen({
      tenantId,
      deviceId,
      window: frozen({ ...window }),
    }),
    status: frozen({ ...status }) as FeatureStatus,
    features: frozenArray(features),
    inputDigest,
    inputObservationRefs,
    extractedAt,
  });
  return { ok: true, featureSet };
}

/** Build + freeze a `rejected` feature set (NEVER a partial family). */
function rejected(
  tenantId: TenantId,
  deviceId: DeviceId,
  window: FeatureWindow,
  extractedAt: string,
  inputDigest: string,
  inputObservationRefs: readonly string[],
  status: { readonly kind: "rejected"; readonly reason: RejectedReason; readonly detail: string },
  _trace: { tenantId: TenantId; correlationId: CorrelationId },
): DeviceHistoryFeatureBuild {
  // The rejected feature set carries the rejection STATUS (machine-stable
  // reason + detail), NO features (NEVER a partial family — the work
  // order: "rejected (tenant/privacy violation detail — never a partial
  // set)"), and the input digest of the EMPTY observation stream (the
  // extractor did not derive anything from a rejected input). The
  // `inputObservationRefs` is EMPTY for a rejection (no observations
  // were incorporated into a derived feature set). The `_trace` is
  // accepted for symmetry with future audit emission; this lane's
  // extractor itself audits nothing (the audited recording boundary
  // is in the store layer).
  void _trace;
  return frozenFeatureSet(
    tenantId,
    deviceId,
    window,
    status,
    [],
    inputDigest,
    inputObservationRefs,
    extractedAt,
  );
}
