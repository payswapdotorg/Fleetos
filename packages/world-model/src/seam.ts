/**
 * @fleetos/world-model — the W153 feed structural seam (the W040 pattern).
 *
 * The src/ discipline of this package permits only `@fleetos/contracts`
 * imports — the W154 work order mandates the engine CONSUME the W153
 * `@fleetos/predictive` feed through its public surface, but the
 * ownership gate (`tools/check-ownership.mjs`) forbids cross-lane src/
 * imports of anything other than `@fleetos/contracts`. The resolution
 * is the W040-disclosed structural-seam pattern: declare LOCAL
 * structural interfaces (structurally compatible with the W153 public
 * surface), and inject the REAL `@fleetos/predictive` outputs at the
 * binding site (tests). TypeScript's structural typing means the real
 * W153 `DeviceHistoryFeatureSet` satisfies this lane's
 * `FeatureSetLike` interface without a cross-lane src/ import.
 *
 * The pattern is the same one `@fleetos/predictive`'s own
 * `PredictiveAuditSink` uses: a LOCAL interface (`PredictiveAuditSink`)
 * is structurally compatible with `@fleetos/audit`'s `AuditSink`, and
 * the binding site (tests) injects the real
 * `createAuditSinkAdapter(log, ...)` output. The src/ files NEVER
 * import `@fleetos/audit`.
 *
 * Per ADR-0002 § "Hard invariants":
 *   6. A failed or unavailable model DEGRADES HONESTLY: the W153 feed's
 *      non-ok statuses (insufficient_history / empty_window / rejected)
 *      PROPAGATE as explicit honest representation states. The
 *      structural seam carries the W153 feed's tagged-union status
 *      through VERBATIM — the local `FeatureStatusLike` is a wider
 *      structural type that the W153 `FeatureStatus` (a narrower
 *      discriminated union with specific literal types for `reason`)
 *      satisfies structurally.
 *
 * The frozen public surface (W154 work order): the W153 feed exports
 * `extractDeviceHistoryFeatures` + the tagged-union status (ok |
 * insufficient_history | empty_window | rejected) +
 * `computeInputDigest` + `verifyFeatureSetProvenance` + the
 * `PrivacyRedactionSeam` + `createInMemoryFeatureSetStore`. The
 * structural seam here mirrors the W153 `DeviceHistoryFeatureSet`,
 * `Feature`, `FeatureStatus`, `FeatureValue`, `FeatureProvenance`,
 * `FeatureSetIdentity`, `FeatureWindow` shapes — the W154 engine
 * consumes these local shapes; the binding site (tests) injects the
 * REAL W153 outputs.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The frozen W153 feature-kind vocabulary (local constants)
// ---------------------------------------------------------------------------

/**
 * The W153 feature-kind vocabulary — local constants with the SAME
 * string values as the W153 `FEATURE_KIND_*` exports. The W154 engine
 * branches on these string values; the W153 feed produces features with
 * these `id` fields. The local constants are NOT coupled to the W153
 * package at compile time (the W154 src/ does not import
 * `@fleetos/predictive`); they are frozen string literals that match
 * the W153 public surface verbatim (the W154 work order: "the frozen
 * surface is real and tested").
 */
export const FEATURE_KIND_OBSERVATION_COUNT = "predictive.feature.observation_count" as const;
export const FEATURE_KIND_OBSERVATION_KIND_MIX = "predictive.feature.observation_kind_mix" as const;
export const FEATURE_KIND_ARRIVAL_CADENCE = "predictive.feature.arrival_cadence" as const;
export const FEATURE_KIND_NUMERIC_FIELD_SUMMARY = "predictive.feature.numeric_field_summary" as const;
export const FEATURE_KIND_WINDOW_EDGE_RECENCY = "predictive.feature.window_edge_recency" as const;

// ---------------------------------------------------------------------------
// The structural feature-window + identity + provenance interfaces
// ---------------------------------------------------------------------------

/**
 * The feature window `[from, to)`. Structurally compatible with the
 * W153 `FeatureWindow`.
 */
export interface FeatureWindowLike {
  /** ISO 8601 — inclusive lower bound. */
  readonly from: string;
  /** ISO 8601 — exclusive upper bound. */
  readonly to: string;
}

/**
 * The identity tuple of a feature set (tenant/device/window).
 * Structurally compatible with the W153 `FeatureSetIdentity`.
 */
export interface FeatureSetIdentityLike {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly window: FeatureWindowLike;
}

/**
 * The provenance record attached to every feature. Structurally
 * compatible with the W153 `FeatureProvenance`.
 */
export interface FeatureProvenanceLike {
  readonly methodId: string;
  readonly methodVersion: number;
  readonly sourceObservationRefs: readonly string[];
  readonly method: string;
}

// ---------------------------------------------------------------------------
// The structural feature-value discriminated union
// ---------------------------------------------------------------------------

/**
 * The discriminated value union for a feature. Structurally compatible
 * with the W153 `FeatureValue`. The W154 engine branches on the `kind`
 * discriminator (the W153 `FeatureValue` is a discriminated union with
 * the same `kind` strings).
 */
export type FeatureValueLike =
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
// The structural feature record
// ---------------------------------------------------------------------------

/**
 * A single feature in a feature set. Structurally compatible with the
 * W153 `Feature`. Carries the value, the kind/unit, and the
 * per-feature provenance.
 */
export interface FeatureLike {
  /** The stable feature identifier (one of FEATURE_KIND_*). */
  readonly id: string;
  /** The machine-stable unit name. */
  readonly unit: string;
  /** The feature value (discriminated by `kind`). */
  readonly value: FeatureValueLike;
  /** The per-feature provenance. */
  readonly provenance: FeatureProvenanceLike;
}

// ---------------------------------------------------------------------------
// The structural feature-status discriminated union (PROPAGATES the W153 feed)
// ---------------------------------------------------------------------------

/**
 * The honest status of a feature set. Structurally compatible with the
 * W153 `FeatureStatus` — a wider structural type that the W153
 * `FeatureStatus` (a narrower discriminated union with specific
 * literal types for `reason`) satisfies structurally. The W154 engine
 * PROPAGATES the W153 feed's status through VERBATIM (the reason +
 * minimumRequired + detail are carried unchanged).
 *
 * The W154 work order: "the W153 feed's non-ok statuses
 * (insufficient_history / empty_window / rejected) PROPAGATE as
 * explicit honest representation states — NEVER zero-filled features,
 * NEVER fabricated confidence."
 */
export type FeatureStatusLike =
  | { readonly kind: "ok" }
  | {
      readonly kind: "insufficient_history";
      readonly reason: "below_minimum_count" | "single_observation" | "no_numeric_payloads";
      readonly minimumRequired: number;
    }
  | { readonly kind: "empty_window" }
  | {
      readonly kind: "rejected";
      readonly reason: "tenant_mismatch" | "device_mismatch" | "privacy_refusal" | "invalid_input" | "observation_out_of_window";
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// The structural feature-set interface (the W153 feed's public surface)
// ---------------------------------------------------------------------------

/**
 * A device-history feature set — the W153 feed's public surface.
 * Structurally compatible with the W153 `DeviceHistoryFeatureSet`.
 * The W154 engine consumes this local shape; the binding site (tests)
 * injects the REAL `@fleetos/predictive` `extractDeviceHistoryFeatures`
 * output (TypeScript's structural typing means the real W153
 * `DeviceHistoryFeatureSet` satisfies this interface without a
 * cross-lane src/ import).
 */
export interface FeatureSetLike {
  readonly schemaVersion: number;
  readonly extractorVersion: number;
  readonly identity: FeatureSetIdentityLike;
  readonly status: FeatureStatusLike;
  readonly features: readonly FeatureLike[];
  /** The SHA-256 hex of the canonical (sorted) input observation ids + payload hashes. */
  readonly inputDigest: string;
  /** The normalized (deduplicated + sorted) observation ids the digest covers. */
  readonly inputObservationRefs: readonly string[];
  /** The INJECTED extraction instant (ISO 8601 — never a clock read). */
  readonly extractedAt: string;
}

// ---------------------------------------------------------------------------
// The structural privacy-redaction seam (the W040 pattern)
// ---------------------------------------------------------------------------

/**
 * The privacy / consent / redaction structural seam. Structurally
 * compatible with the W153 `PrivacyRedactionSeam`. The W154 engine
 * delegates privacy checks to this seam; the binding site (tests)
 * injects the REAL `@fleetos/predictive` `DEFAULT_PRIVACY_SEAM` or a
 * custom seam (the W040 pattern).
 *
 * The W154 work order: "the `PrivacyRedactionSeam` (pass-through
 * default — you inject a real one at YOUR binding sites where the
 * engine is bound, per the W040 pattern)".
 */
export interface PrivacyRedactionSeamLike {
  check(input: {
    readonly tenantId: TenantId;
    readonly deviceId: DeviceId;
    readonly observations: readonly unknown[];
  }): { readonly ok: true } | { readonly ok: false; readonly reason: "privacy_refused"; readonly detail: string };
}
