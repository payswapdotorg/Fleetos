/**
 * @fleetos/predictive — D1: the device-history feature extractor (W153
 * lane A — the foundational data lane of the Predictive Twin / World
 * Model layer per ADR-0002).
 *
 * A PURE function family over the immutable admitted observation
 * stream. The feed is NEVER business truth (ADR-0002 invariant 1): it
 * is a derived, recomputable interpretation of immutable inputs —
 * observations/events stay immutable and auditable (invariant 2; the
 * extractor READS `Observation` records, never mutates or backfills
 * them), and the ONLY source of device history is the observation
 * admission boundary (`@fleetos/device-model` ingestion — W011) whose
 * records the caller hands in read-only.
 *
 * Determinism is absolute (invariant 4): the same immutable inputs +
 * the same extractor version + the same window => a byte-identical
 * feature set. No clock reads (every timestamp — `extractedAt`, the
 * relative window's anchor — is injected by the caller), no randomness,
 * no ambient state, no network, no GPU, no model provider (invariant
 * 8): the reference implementation is pure TypeScript arithmetic over
 * the observation stream.
 *
 * Honesty (invariant 6 of ADR-0002's spirit + W153's invariant 5):
 * insufficient history => the explicit `insufficient_history` state
 * with the reason and the minimum the extractor needs; an empty window
 * => `empty_window`; NEVER fabricated or zero-filled values that could
 * be mistaken for measurements.
 *
 * Tenant isolation (invariant 6): the feature request is tenant-scoped
 * and every supplied observation carries its admission attribution
 * (tenant + device); a cross-tenant or cross-device input is REJECTED,
 * never merged. BYOD/privacy (invariant 7): a structural privacy/
 * redaction gate seam runs BEFORE derivation — a refusal yields the
 * `rejected` state with the violation detail and NO partial set; the
 * first implementation is the documented pass-through gate.
 *
 * Provenance (invariant 3): every feature set carries the feature-set
 * schema version, the extractor version, the resolved input window, the
 * input observation refs, an input digest (sha256 over the canonical
 * serialization of the canonically-ordered in-window admitted
 * observations), and per-feature provenance (source observation refs +
 * method id + method version). The digest seam (`FeatureDigestFn`) is
 * structural: callers may inject any pure hash over the canonical
 * serialization (the REAL `apps/web/src/runtime/sha256.ts` module
 * satisfies it and is byte-compatible with the in-package default —
 * proven by the binding-site test).
 *
 * The v1 feature family is trimmed to what the frozen contracts and the
 * seeded demo history actually support (the W153 work order: "DO NOT
 * fabricate features the seed cannot feed"): arrival cadence (count,
 * span, inter-arrival min/max/mean, window-edge recency, first/last
 * observed instants), observation-kind mix, telemetry field presence/
 * coverage, and per-field numeric summary stats (min/max/mean/last over
 * top-level numeric payload fields). An event-vs-reading ratio is
 * DELIBERATELY absent: the frozen `Observation` contract carries no
 * event/reading discriminator, and the feed never invents one.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * Every timestamp injected by the caller.
 */

import { validateTenantRef } from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  DeviceId,
  Observation,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  PREDICTIVE_PIPELINE_CORRELATION_ID,
  canonicalJson,
  epochMs,
  epochToIsoUtc,
  frozen,
  frozenArray,
  looksLikeIso,
  sha256Hex,
} from "./internal";
import type { PredictiveAuditSink } from "./audit-seam";
import { PREDICTIVE_AUDIT_ACTIONS } from "./audit-seam";

// ---------------------------------------------------------------------------
// Frozen versions + the closed vocabularies
// ---------------------------------------------------------------------------

/** The frozen feature-set SCHEMA version (the `DeviceHistoryFeatureSet` shape). */
export const FEATURE_SET_SCHEMA_VERSION = 1 as const;

/** The frozen extractor version (the derivation semantics of the v1 family). */
export const EXTRACTOR_VERSION = "1.0.0" as const;

/** The frozen per-feature METHOD version (every v1 method). */
export const METHOD_VERSION = 1 as const;

/**
 * The minimum number of IN-WINDOW observations the v1 family needs
 * (the inter-arrival statistics require at least one arrival gap).
 * Fewer => the explicit `insufficient_history` state — never zeros.
 */
export const MINIMUM_WINDOW_OBSERVATIONS = 2 as const;

/** The closed status vocabulary of a device-history feature set. */
export const ALL_FEATURE_SET_STATUS_KINDS: readonly string[] = Object.freeze([
  "ok",
  "insufficient_history",
  "empty_window",
  "rejected",
]);

/** The closed unit vocabulary of a derived feature. */
export const ALL_FEATURE_UNITS: readonly string[] = Object.freeze([
  "count",
  "ms",
  "fraction",
  "iso8601",
  "number",
]);

/** The closed method-id vocabulary of the v1 feature family. */
export const FEATURE_METHOD_IDS: readonly string[] = Object.freeze([
  "count",
  "arrival.extremes",
  "arrival.span",
  "arrival.interarrival_stats",
  "arrival.recency",
  "kind.mix",
  "payload.field_presence",
  "payload.numeric_summary",
]);

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/**
 * The caller-supplied window definition. Absolute windows are
 * half-open `[from, to)` ISO 8601 instants. Relative windows resolve
 * against the INJECTED anchor (the now-anchor — the extractor never
 * reads a clock): `[anchor - durationMs, anchor)`.
 */
export type FeatureWindowDefinition =
  | { readonly kind: "absolute"; readonly from: string; readonly to: string }
  | { readonly kind: "relative"; readonly anchor: string; readonly durationMs: number };

/**
 * The RESOLVED window carried on every feature set: the half-open
 * `[from, to)` instants the derivation actually selected from, plus the
 * anchor a relative window resolved against (null for absolute
 * windows). Relative windows resolve to canonical UTC ISO instants
 * (`epochToIsoUtc`); absolute windows carry the caller's strings
 * verbatim.
 */
export interface ResolvedFeatureWindow {
  readonly kind: "absolute" | "relative";
  /** ISO 8601 — the inclusive window start. */
  readonly from: string;
  /** ISO 8601 — the EXCLUSIVE window end. */
  readonly to: string;
  /** The injected anchor a relative window resolved against (null for absolute). */
  readonly anchor: string | null;
}

// ---------------------------------------------------------------------------
// The digest
// ---------------------------------------------------------------------------

/**
 * A structural digest seam: a PURE function over the canonical
 * serialization. The default is the in-package FIPS 180-4 SHA-256; the
 * REAL `apps/web/src/runtime/sha256.ts` module satisfies this seam
 * structurally and is byte-compatible (proven by the binding-site
 * test). Never used for security — only for bit-reproducibility.
 */
export type FeatureDigestFn = (canonical: string) => string;

/** The input digest of a feature set: algorithm + value. */
export interface FeatureInputDigest {
  /** The digest algorithm (frozen: sha256). */
  readonly algorithm: "sha256";
  /** 64 lowercase hex chars. */
  readonly value: string;
}

// ---------------------------------------------------------------------------
// The privacy/redaction seam (BYOD/consent — ADR-0002 invariant 7)
// ---------------------------------------------------------------------------

/** The privacy state attached to a feature set (mirrors the learning lane's redaction states). */
export interface FeaturePrivacyState {
  readonly state: "raw" | "deidentified" | "redacted";
  readonly appliedPolicies: readonly string[];
}

/** The request handed to the privacy gate before derivation. */
export interface DeviceHistoryPrivacyCheckRequest {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The in-window observation ids the derivation would consume. */
  readonly observationIds: readonly ObservationId[];
}

/**
 * The gate's decision. `ok: false` refuses derivation (the extractor
 * returns the `rejected` status with the reason + detail — never a
 * partial set). `ok: true` may attach a redaction state that flows
 * onto the feature set (the first implementation is the pass-through
 * gate below; a real BYOD/consent gate binds at the composition site).
 */
export type DeviceHistoryPrivacyDecision =
  | { readonly ok: true; readonly redaction?: FeaturePrivacyState }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/**
 * The BYOD/privacy structural seam. The gate runs BEFORE derivation:
 * no feature may incorporate data outside the device's own tenant
 * scope, and consent/redaction policy applies before features enter
 * the predictive layer (ADR-0002 invariant 8).
 */
export interface DeviceHistoryPrivacyGate {
  check(request: DeviceHistoryPrivacyCheckRequest): DeviceHistoryPrivacyDecision;
}

/**
 * The first implementation: a PASS-THROUGH check (the W153 work order
 * sanctions exactly this — the seam is structural, the policy lands
 * later). Every request is admitted with the `raw` redaction state.
 */
export const PASS_THROUGH_PRIVACY_GATE: DeviceHistoryPrivacyGate = frozen({
  check(_request: DeviceHistoryPrivacyCheckRequest): DeviceHistoryPrivacyDecision {
    return { ok: true, redaction: { state: "raw", appliedPolicies: [] } };
  },
});

// ---------------------------------------------------------------------------
// Features + the set
// ---------------------------------------------------------------------------

/** A derived feature value: a number, or an ISO 8601 instant string. */
export type FeatureValue = number | string;

/** The unit/kind of a derived feature value. */
export type FeatureUnit = "count" | "ms" | "fraction" | "iso8601" | "number";

/** Per-feature provenance: the source observation refs + the method identity. */
export interface FeatureProvenance {
  /** The source observation ids (canonical order: observedAt, then id). */
  readonly sourceObservationIds: readonly ObservationId[];
  /** The stable method id (see FEATURE_METHOD_IDS). */
  readonly methodId: string;
  /** The frozen method version. */
  readonly methodVersion: number;
}

/** One derived feature: id, value, unit, and its provenance. */
export interface DeviceFeature {
  /** Stable feature id (e.g. "arrival.interarrival_mean_ms", "kind.device.health.fraction"). */
  readonly id: string;
  readonly value: FeatureValue;
  readonly unit: FeatureUnit;
  readonly provenance: FeatureProvenance;
}

/**
 * The honest status vocabulary. `insufficient_history` carries the
 * reason, the observed count and the minimum the extractor needs;
 * `rejected` carries the machine-stable reason + detail (tenant/
 * privacy violation, malformed input, invalid window) and NEVER a
 * partial feature set.
 */
export type FeatureSetStatus =
  | { readonly kind: "ok" }
  | {
      readonly kind: "insufficient_history";
      readonly reason: "observation_count_below_minimum";
      readonly observedCount: number;
      readonly minimumRequired: number;
    }
  | { readonly kind: "empty_window" }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "tenant_scope_invalid"
        | "tenant_mismatch"
        | "privacy_refused"
        | "malformed_input"
        | "invalid_window";
      readonly detail: string;
    };

/**
 * An admitted observation with its admission attribution: the tenant +
 * device whose stream the caller read it from. The extractor enforces
 * that every attribution matches the request's (tenantId, deviceId) —
 * cross-tenant inputs are rejected, never merged (invariant 6).
 */
export interface AdmittedDeviceObservation {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly observation: Observation;
}

/**
 * The device-history feature set: the derived, recomputable
 * interpretation of the immutable inputs. NEVER business truth.
 * `features` is non-empty ONLY for `ok`; `inputDigest` and
 * `inputObservationIds` anchor the derivation for every honest state
 * (ok / insufficient_history / empty_window) and are null/empty for
 * `rejected` (nothing was derived — never a partial set).
 */
export interface DeviceHistoryFeatureSet {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly featureSetSchemaVersion: number;
  readonly extractorVersion: string;
  readonly window: ResolvedFeatureWindow;
  readonly status: FeatureSetStatus;
  readonly features: readonly DeviceFeature[];
  /** The in-window observation ids in canonical order ([] for rejected). */
  readonly inputObservationIds: readonly ObservationId[];
  /** The input digest (null for rejected — nothing was derived). */
  readonly inputDigest: FeatureInputDigest | null;
  /** The privacy/redaction state the gate attached (raw for rejected). */
  readonly privacy: FeaturePrivacyState;
  /** The injected extraction instant (echoed verbatim; never a clock read). */
  readonly extractedAt: string;
}

// ---------------------------------------------------------------------------
// The extractor input
// ---------------------------------------------------------------------------

/** The input of `extractDeviceHistoryFeatures`. */
export interface DeviceHistoryFeatureInput {
  /** The acting tenant scope — the feature request is tenant-scoped. */
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /**
   * The device's admitted observations (the caller read them from the
   * immutable observation stream — read-only). Entries outside the
   * window are excluded by the window filter; every entry must carry
   * the request's (tenantId, deviceId) attribution and a well-formed
   * observation. Array ORDER is irrelevant: the extractor canonicalizes
   * by (observedAt, id).
   */
  readonly observations: readonly AdmittedDeviceObservation[];
  readonly window: FeatureWindowDefinition;
  /** The injected extraction instant (ISO 8601; echoed onto the set). */
  readonly extractedAt: string;
  /** Feature-set schema version override (default: FEATURE_SET_SCHEMA_VERSION). */
  readonly featureSetSchemaVersion?: number;
  /** Extractor version override (default: EXTRACTOR_VERSION). */
  readonly extractorVersion?: string;
  /** The BYOD/privacy gate (default: the pass-through gate). */
  readonly privacyGate?: DeviceHistoryPrivacyGate;
  /** The digest seam (default: the in-package FIPS 180-4 SHA-256). */
  readonly digest?: FeatureDigestFn;
  /** Correlation id for the audit trail (default: the synthetic pipeline id). */
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  /** The injected audit sink (default: no audit emission). */
  readonly auditSink?: PredictiveAuditSink;
}

// ---------------------------------------------------------------------------
// Canonical serialization + identity helpers
// ---------------------------------------------------------------------------

/**
 * The canonical JSON serialization of a feature set (sorted keys,
 * recursive) — the byte-identical basis for golden determinism proofs
 * and the provenance record's content digest. Two structurally equal
 * sets serialize to the same string.
 */
export function canonicalFeatureSetJson(set: DeviceHistoryFeatureSet): string {
  return canonicalJson(set);
}

/**
 * The canonical JSON of a feature set's IDENTITY tuple (tenant, device,
 * versions, resolved window, input digest, extraction instant) — the
 * basis for the deterministic featureSetId (D3) and provenanceId (D2).
 * Two sets with the same identity tuple and the same content are the
 * same set; the extraction instant is part of the identity (a
 * re-materialization at a later injected instant is a NEW cache
 * record — the append-only discipline).
 */
export function featureSetIdentityCanonical(set: DeviceHistoryFeatureSet): string {
  return canonicalJson({
    tenantId: set.tenantId,
    deviceId: set.deviceId,
    featureSetSchemaVersion: set.featureSetSchemaVersion,
    extractorVersion: set.extractorVersion,
    windowFrom: set.window.from,
    windowTo: set.window.to,
    inputDigest: set.inputDigest === null ? null : set.inputDigest.value,
    extractedAt: set.extractedAt,
  });
}

/**
 * The canonical serialization the input digest is computed over: the
 * canonically-ordered (observedAt, then id) in-window admitted
 * observations — attribution + observation content. The same multiset
 * of admitted observations in ANY input array order serializes
 * identically (order-preserving in the canonical sense: the digest
 * preserves the canonical arrival order, so reordering cannot forge a
 * match).
 */
export function canonicalObservationSelectionJson(
  selection: readonly AdmittedDeviceObservation[],
): string {
  return canonicalJson(selection.map((entry) => ({
    tenantId: entry.tenantId,
    deviceId: entry.deviceId,
    observation: entry.observation,
  })));
}

// ---------------------------------------------------------------------------
// The extractor (pure; the only entry point)
// ---------------------------------------------------------------------------

/**
 * Extract the device-history feature set. PURE and deterministic: the
 * same immutable inputs + the same extractor version + the same window
 * => a byte-identical feature set (proven by the golden determinism
 * tests). NEVER throws for domain flows — every refusal is the honest
 * `rejected` status inside the returned set (typed errors live in the
 * D2/D3 operations, which return result unions).
 *
 * Order semantics: the input array's order is IRRELEVANT — the
 * derivation canonicalizes the in-window selection by (observedAt,
 * id), so a reshuffled-but-equivalent input yields the byte-identical
 * set. The digest covers the canonical selection; observations outside
 * the window do not participate.
 *
 * Audit (D4): every attributable run emits
 * `predictive.device_history.extracted` (status, digest, window,
 * versions) to the injected sink; an attributable tenant/privacy/
 * validation refusal emits `predictive.device_history.rejected`.
 * A request whose tenant scope fails the frozen grammar is not
 * attributable and never audits through the tenant-scoped seam.
 */
export function extractDeviceHistoryFeatures(
  input: DeviceHistoryFeatureInput,
): DeviceHistoryFeatureSet {
  const schemaVersion = input?.featureSetSchemaVersion ?? FEATURE_SET_SCHEMA_VERSION;
  const extractorVersion = input?.extractorVersion ?? EXTRACTOR_VERSION;
  const digestFn: FeatureDigestFn = input?.digest ?? sha256Hex;
  const gate: DeviceHistoryPrivacyGate = input?.privacyGate ?? PASS_THROUGH_PRIVACY_GATE;
  const sink: PredictiveAuditSink | undefined = input?.auditSink;
  const correlationId: CorrelationId = input?.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID;
  const tenantId: TenantId = input?.tenantId;
  const deviceId: DeviceId = input?.deviceId;

  const emit = (action: string, details: Readonly<Record<string, unknown>>): void => {
    if (sink === undefined) return;
    const occurredAt = typeof input?.extractedAt === "string" ? input.extractedAt : "";
    // Attributable discipline (mirrors W011): a record without a usable
    // tenant scope or a usable instant never reaches the tenant-scoped
    // seam (a malformed audit record is worse than no record).
    if (!looksLikeIso(occurredAt)) return;
    sink.append(
      frozen({
        tenantId,
        action,
        subject: typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null,
        occurredAt,
        correlationId,
        causationId: input?.causationId,
        details,
      }),
    );
  };

  // ---- 1. Tenant scope (the request is tenant-scoped; invariant 6) -----
  const tenantCheck = validateTenantRef(tenantId);
  if (!tenantCheck.ok) {
    // Unattributable: no tenant-scoped audit is possible (mirrors W011).
    return rejectedSet(
      tenantId,
      deviceId,
      schemaVersion,
      extractorVersion,
      input?.window,
      input?.extractedAt,
      { kind: "rejected", reason: "tenant_scope_invalid", detail: `tenantId ${tenantCheck.reason}` },
    );
  }

  const rejected = (
    reason: Extract<FeatureSetStatus, { kind: "rejected" }>,
  ): DeviceHistoryFeatureSet => {
    emit(PREDICTIVE_AUDIT_ACTIONS.featuresRejected, {
      deviceId,
      reason: reason.reason,
      detail: reason.detail,
      featureSetSchemaVersion: schemaVersion,
      extractorVersion,
    });
    return rejectedSet(
      tenantId,
      deviceId,
      schemaVersion,
      extractorVersion,
      input?.window,
      input?.extractedAt,
      reason,
    );
  };

  // ---- 2. Structural validation ----------------------------------------
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    return rejected({
      kind: "rejected",
      reason: "malformed_input",
      detail: "/deviceId:required",
    });
  }
  if (typeof input?.extractedAt !== "string" || !looksLikeIso(input.extractedAt)) {
    return rejected({
      kind: "rejected",
      reason: "malformed_input",
      detail: "/extractedAt:not_iso",
    });
  }
  if (typeof schemaVersion !== "number" || schemaVersion < 1) {
    return rejected({
      kind: "rejected",
      reason: "malformed_input",
      detail: "/featureSetSchemaVersion:must_be_at_least_one",
    });
  }
  if (typeof extractorVersion !== "string" || extractorVersion.length === 0) {
    return rejected({
      kind: "rejected",
      reason: "malformed_input",
      detail: "/extractorVersion:required",
    });
  }

  // ---- 3. Window resolution --------------------------------------------
  const fromEpochRaw = epochMsOfWindow(input.window, "from");
  const toEpochRaw = epochMsOfWindow(input.window, "to");
  const fromEpoch = fromEpochRaw.value;
  const toEpoch = toEpochRaw.value;
  if (fromEpoch === null || toEpoch === null || !(fromEpoch < toEpoch)) {
    return rejected({
      kind: "rejected",
      reason: "invalid_window",
      detail:
        fromEpoch === null || toEpoch === null
          ? "/window:not_iso"
          : "/window:from_must_precede_to",
    });
  }
  const resolvedWindow: ResolvedFeatureWindow =
    input.window?.kind === "relative"
      ? frozen({
          kind: "relative",
          from: epochToIsoUtc(fromEpoch),
          to: epochToIsoUtc(toEpoch),
          anchor: input.window.anchor,
        })
      : frozen({
          kind: "absolute",
          from: input.window.from,
          to: input.window.to,
          anchor: null,
        });

  // ---- 4. Observation validation (attribution + shape + uniqueness) ---
  if (!Array.isArray(input?.observations)) {
    return rejected({ kind: "rejected", reason: "malformed_input", detail: "/observations:required" });
  }
  const seenIds = new Set<string>();
  const failures: string[] = [];
  for (let i = 0; i < input.observations.length; i++) {
    const entry = input.observations[i];
    if (entry === null || typeof entry !== "object") {
      failures.push(`/observations/${i}:required`);
      continue;
    }
    if (entry.tenantId !== tenantId) {
      failures.push(`/observations/${i}/tenantId:tenant_mismatch`);
      continue;
    }
    if (entry.deviceId !== deviceId) {
      failures.push(`/observations/${i}/deviceId:device_mismatch`);
      continue;
    }
    const obs = entry.observation;
    if (obs === null || typeof obs !== "object") {
      failures.push(`/observations/${i}/observation:required`);
      continue;
    }
    if (typeof obs.id !== "string" || obs.id.length === 0) {
      failures.push(`/observations/${i}/observation/id:required`);
      continue;
    }
    if (seenIds.has(obs.id)) {
      failures.push(`/observations/${i}/observation/id:duplicate`);
      continue;
    }
    seenIds.add(obs.id);
    if (typeof obs.kind !== "string" || obs.kind.length === 0) {
      failures.push(`/observations/${i}/observation/kind:required`);
      continue;
    }
    if (typeof obs.observedAt !== "string" || !looksLikeIso(obs.observedAt)) {
      failures.push(`/observations/${i}/observation/observedAt:not_iso`);
      continue;
    }
    if (epochMs(obs.observedAt) === null) {
      failures.push(`/observations/${i}/observation/observedAt:unparseable`);
      continue;
    }
    if (typeof obs.schemaVersion !== "number" || obs.schemaVersion < 1) {
      failures.push(`/observations/${i}/observation/schemaVersion:must_be_at_least_one`);
      continue;
    }
  }
  if (failures.length > 0) {
    // A cross-tenant/cross-device attribution is a tenant violation (never
    // merged); everything else is malformed input. Both are honest
    // refusals with NO partial set.
    const attributionFailure = failures.find((failure) => failure.includes(":tenant_mismatch"));
    return rejected({
      kind: "rejected",
      reason: attributionFailure !== undefined ? "tenant_mismatch" : "malformed_input",
      detail: failures.slice(0, 3).join(";"),
    });
  }

  // ---- 5. Window selection (canonical order: observedAt, then id) -----
  const inWindow: AdmittedDeviceObservation[] = [];
  for (const entry of input.observations) {
    const at = epochMs(entry.observation.observedAt);
    if (at !== null && at >= fromEpoch && at < toEpoch) {
      inWindow.push(entry);
    }
  }
  inWindow.sort((a, b) => {
    const ea = epochMs(a.observation.observedAt)!;
    const eb = epochMs(b.observation.observedAt)!;
    if (ea !== eb) return ea - eb;
    return a.observation.id < b.observation.id ? -1 : a.observation.id > b.observation.id ? 1 : 0;
  });

  // ---- 6. The privacy/consent gate (BEFORE derivation; invariant 7) ---
  const privacyDecision = gate.check({
    tenantId,
    deviceId,
    observationIds: frozenArray(inWindow.map((entry) => entry.observation.id)),
  });
  if (!privacyDecision || privacyDecision.ok !== true) {
    const reason = privacyDecision && typeof privacyDecision.reason === "string" ? privacyDecision.reason : "unknown";
    const detail = privacyDecision && typeof privacyDecision.detail === "string" ? privacyDecision.detail : "privacy gate refused";
    return rejected({
      kind: "rejected",
      reason: "privacy_refused",
      detail: `${reason}: ${detail}`,
    });
  }
  const privacy: FeaturePrivacyState = privacyDecision.redaction ?? {
    state: "raw",
    appliedPolicies: [],
  };

  // ---- 7. The input digest (over the canonical selection) -------------
  const canonicalSelection = canonicalObservationSelectionJson(inWindow);
  const inputDigest: FeatureInputDigest = frozen({
    algorithm: "sha256",
    value: digestFn(canonicalSelection),
  });
  const inputObservationIds = frozenArray(inWindow.map((entry) => entry.observation.id));

  // ---- 8. Honest status ------------------------------------------------
  let status: FeatureSetStatus;
  let features: readonly DeviceFeature[];
  if (inWindow.length === 0) {
    status = frozen<FeatureSetStatus>({ kind: "empty_window" });
    features = frozenArray([]);
  } else if (inWindow.length < MINIMUM_WINDOW_OBSERVATIONS) {
    status = frozen<FeatureSetStatus>({
      kind: "insufficient_history",
      reason: "observation_count_below_minimum",
      observedCount: inWindow.length,
      minimumRequired: MINIMUM_WINDOW_OBSERVATIONS,
    });
    features = frozenArray([]);
  } else {
    status = frozen<FeatureSetStatus>({ kind: "ok" });
    features = computeFeatures(inWindow, toEpoch);
  }

  const set: DeviceHistoryFeatureSet = frozen({
    tenantId,
    deviceId,
    featureSetSchemaVersion: schemaVersion,
    extractorVersion,
    window: resolvedWindow,
    status,
    features,
    inputObservationIds,
    inputDigest,
    privacy: frozen({ state: privacy.state, appliedPolicies: frozenArray(privacy.appliedPolicies) }),
    extractedAt: input.extractedAt,
  });

  // ---- 9. Audit ---------------------------------------------------------
  emit(PREDICTIVE_AUDIT_ACTIONS.featuresExtracted, frozen({
    deviceId,
    statusKind: status.kind,
    featureCount: features.length,
    inputDigestAlgorithm: inputDigest.algorithm,
    inputDigestValue: inputDigest.value,
    windowFrom: resolvedWindow.from,
    windowTo: resolvedWindow.to,
    featureSetSchemaVersion: schemaVersion,
    extractorVersion,
    privacyState: privacy.state,
  }));

  return set;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function epochMsOfWindow(
  window: FeatureWindowDefinition | undefined,
  edge: "from" | "to",
): { value: number | null } {
  if (window === null || typeof window !== "object") return { value: null };
  if (window.kind === "absolute") {
    const iso = edge === "from" ? window.from : window.to;
    if (typeof iso !== "string" || !looksLikeIso(iso)) return { value: null };
    return { value: epochMs(iso) };
  }
  if (window.kind === "relative") {
    if (typeof window.anchor !== "string" || !looksLikeIso(window.anchor)) return { value: null };
    const anchorEpoch = epochMs(window.anchor);
    if (anchorEpoch === null) return { value: null };
    const duration = window.durationMs;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0) {
      return { value: null };
    }
    return { value: edge === "from" ? anchorEpoch - duration : anchorEpoch };
  }
  return { value: null };
}

function rejectedSet(
  tenantId: TenantId,
  deviceId: DeviceId,
  schemaVersion: number,
  extractorVersion: string,
  window: FeatureWindowDefinition | undefined,
  extractedAt: string | undefined,
  status: Extract<FeatureSetStatus, { kind: "rejected" }>,
): DeviceHistoryFeatureSet {
  const fromEpoch = epochMsOfWindow(window, "from").value;
  const toEpoch = epochMsOfWindow(window, "to").value;
  const windowIsValid = fromEpoch !== null && toEpoch !== null && fromEpoch < toEpoch;
  const resolvedWindow: ResolvedFeatureWindow =
    windowIsValid && window?.kind === "relative"
      ? frozen({
          kind: "relative",
          from: epochToIsoUtc(fromEpoch),
          to: epochToIsoUtc(toEpoch),
          anchor: window.anchor,
        })
      : frozen({
          kind: "absolute",
          from: windowIsValid && window?.kind === "absolute" ? window.from : "1970-01-01T00:00:00.000Z",
          to: windowIsValid && window?.kind === "absolute" ? window.to : "1970-01-01T00:00:00.000Z",
          anchor: null,
        });
  return frozen({
    tenantId,
    deviceId,
    featureSetSchemaVersion: typeof schemaVersion === "number" && schemaVersion >= 1 ? schemaVersion : FEATURE_SET_SCHEMA_VERSION,
    extractorVersion: typeof extractorVersion === "string" && extractorVersion.length > 0 ? extractorVersion : EXTRACTOR_VERSION,
    window: resolvedWindow,
    status: frozen(status),
    features: frozenArray([]),
    inputObservationIds: frozenArray([]),
    inputDigest: null,
    privacy: frozen({ state: "raw", appliedPolicies: [] }),
    extractedAt: typeof extractedAt === "string" ? extractedAt : "",
  });
}

/** Is the payload a plain JSON object (the only shape field features derive from)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A numeric carrier: a finite number (never NaN/Infinity, never a boolean). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Compute the v1 feature family over the canonically-ordered in-window
 * selection. PURE: every value is arithmetic over the selection (no
 * clocks, no entropy, no fabricated values).
 */
function computeFeatures(
  sorted: readonly AdmittedDeviceObservation[],
  toEpoch: number,
): readonly DeviceFeature[] {
  const features: DeviceFeature[] = [];
  const ids = sorted.map((entry) => entry.observation.id);
  const epochs = sorted.map((entry) => epochMs(entry.observation.observedAt)!);
  const n = sorted.length;

  const push = (
    id: string,
    value: FeatureValue,
    unit: FeatureUnit,
    methodId: string,
    sourceIds: readonly ObservationId[],
  ): void => {
    features.push(
      frozen({
        id,
        value,
        unit,
        provenance: frozen({
          sourceObservationIds: frozenArray(sourceIds),
          methodId,
          methodVersion: METHOD_VERSION,
        }),
      }),
    );
  };

  // 1. Count.
  push("observation.count", n, "count", "count", ids);

  // 2. Arrival extremes (verbatim source instants — never reformatted).
  push("arrival.first_observed_at", sorted[0]!.observation.observedAt, "iso8601", "arrival.extremes", ids);
  push("arrival.last_observed_at", sorted[n - 1]!.observation.observedAt, "iso8601", "arrival.extremes", ids);

  // 3. Window span.
  push("window.span_ms", epochs[n - 1]! - epochs[0]!, "ms", "arrival.span", ids);

  // 4. Inter-arrival statistics (n - 1 gaps; summed in canonical order).
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) {
    gaps.push(epochs[i]! - epochs[i - 1]!);
  }
  let gapSum = 0;
  let gapMin = gaps[0]!;
  let gapMax = gaps[0]!;
  for (const gap of gaps) {
    gapSum += gap;
    if (gap < gapMin) gapMin = gap;
    if (gap > gapMax) gapMax = gap;
  }
  push("arrival.interarrival_min_ms", gapMin, "ms", "arrival.interarrival_stats", ids);
  push("arrival.interarrival_max_ms", gapMax, "ms", "arrival.interarrival_stats", ids);
  push("arrival.interarrival_mean_ms", gapSum / gaps.length, "ms", "arrival.interarrival_stats", ids);

  // 5. Window-edge recency (the exclusive `to` edge minus the last arrival).
  push("arrival.recency_last_ms", toEpoch - epochs[n - 1]!, "ms", "arrival.recency", ids);

  // 6. Observation-kind mix (only the kinds PRESENT — never fabricated).
  const kindBuckets = new Map<string, { count: number; ids: ObservationId[] }>();
  for (const entry of sorted) {
    const bucket = kindBuckets.get(entry.observation.kind) ?? { count: 0, ids: [] };
    bucket.count += 1;
    bucket.ids.push(entry.observation.id);
    kindBuckets.set(entry.observation.kind, bucket);
  }
  for (const kind of [...kindBuckets.keys()].sort()) {
    const bucket = kindBuckets.get(kind)!;
    push(`kind.${kind}.count`, bucket.count, "count", "kind.mix", bucket.ids);
    push(`kind.${kind}.fraction`, bucket.count / n, "fraction", "kind.mix", bucket.ids);
  }

  // 7. Telemetry field presence/coverage (plain-object payloads only;
  //    the denominator is every in-window observation).
  const fieldCarriers = new Map<string, { carriers: number; ids: ObservationId[]; values: number[]; lastValue: number | null; allNumeric: boolean }>();
  for (const entry of sorted) {
    const payload = entry.observation.payload;
    if (!isPlainObject(payload)) continue;
    for (const field of Object.keys(payload)) {
      const bucket =
        fieldCarriers.get(field) ??
        { carriers: 0, ids: [], values: [], lastValue: null, allNumeric: true };
      bucket.carriers += 1;
      bucket.ids.push(entry.observation.id);
      const value = payload[field];
      if (isFiniteNumber(value)) {
        bucket.values.push(value);
        bucket.lastValue = value;
      } else {
        bucket.allNumeric = false;
      }
      fieldCarriers.set(field, bucket);
    }
  }
  for (const field of [...fieldCarriers.keys()].sort()) {
    const bucket = fieldCarriers.get(field)!;
    push(
      `payload.${field}.presence_fraction`,
      bucket.carriers / n,
      "fraction",
      "payload.field_presence",
      bucket.ids,
    );
    // 8. Per-field numeric summary stats — ONLY when EVERY carrier's value
    //    is a finite number (a mixed-type field is never summarized
    //    numerically: no fabricated stats).
    if (bucket.allNumeric && bucket.values.length > 0) {
      let sum = 0;
      let min = bucket.values[0]!;
      let max = bucket.values[0]!;
      for (const value of bucket.values) {
        sum += value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      push(`payload.${field}.min`, min, "number", "payload.numeric_summary", bucket.ids);
      push(`payload.${field}.max`, max, "number", "payload.numeric_summary", bucket.ids);
      push(`payload.${field}.mean`, sum / bucket.values.length, "number", "payload.numeric_summary", bucket.ids);
      push(`payload.${field}.last`, bucket.lastValue as number, "number", "payload.numeric_summary", bucket.ids);
    }
  }

  return frozenArray(features);
}
