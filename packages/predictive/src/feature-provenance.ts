/**
 * @fleetos/predictive — D2: the versioned feature-set provenance record
 * + the provenance verification boundary (W153 lane A).
 *
 * This is the W154 engine's trust anchor (the model-neutral
 * `represent(history, context)` seam of ADR-0002 consumes feature sets
 * ONLY after their provenance verifies against the immutable inputs
 * they claim).
 *
 * `verifyFeatureSetProvenance` is PURE and REFUSES with typed errors
 * (never throws raw) on mismatch, gap, or cross-tenant ref:
 *   - the acting scope's tenant must match the set's tenant (a
 *     cross-tenant ref is refused — never merged);
 *   - every claimed observation must carry the acting scope's
 *     attribution (cross-tenant claimed inputs are refused);
 *   - the set's input observation refs must exist EXACTLY in the
 *     supplied claimed window selection (a missing ref or an uncovered
 *     in-window observation — a gap — is refused);
 *   - the re-derived input digest must equal the set's claimed digest;
 *   - the FULL feature set must be byte-identically reproducible from
 *     the claimed inputs under the set's own recorded identity
 *     (versions, resolved window, extractedAt) — a TAMPERED value is
 *     refused and the divergent feature is named. This is the strength
 *     of ADR-0002 invariant 4 (absolute determinism): re-derivation IS
 *     the complete proof.
 *
 * Verification scope (documented honestly): the proof anchors the
 * INPUT -> FEATURES derivation. The set's `privacy` field is
 * caller-declared gate metadata carried verbatim (the pass-through
 * gate's decision is not re-runnable — the real BYOD/consent gate is a
 * later wave's composition concern), and a `rejected` set makes no
 * derivation claim at all — it is refused as not verifiable.
 * The internal re-derivation runs the public extractor with the
 * DEFAULT pass-through gate and NO audit sink (a pure read audits
 * nothing — the house emission policy).
 *
 * The provenance record itself (the versioned interpretation record,
 * consistent with the `TwinInterpretation` pattern: kind/source/
 * versions/evidence refs/content digest) is what the W154 engine
 * attaches to its representations.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { validateTenantRef } from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  DeviceId,
  DomainError,
  FleetError,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  PREDICTIVE_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  epochMs,
  frozen,
  looksLikeIso,
  sha256Hex,
} from "./internal";
import type { PredictiveAuditSink } from "./audit-seam";
import { PREDICTIVE_AUDIT_ACTIONS } from "./audit-seam";
import type {
  AdmittedDeviceObservation,
  DeviceHistoryFeatureSet,
  FeatureDigestFn,
  FeatureInputDigest,
  ResolvedFeatureWindow,
} from "./device-history-features";
import { extractDeviceHistoryFeatures } from "./device-history-features";

// ---------------------------------------------------------------------------
// The versioned provenance record
// ---------------------------------------------------------------------------

/**
 * The versioned provenance record of a device-history feature set — the
 * interpretation record the W154 engine attaches to its representations
 * (structurally consistent with the device-model `TwinInterpretation`
 * pattern: kind, source, versions, evidence refs, generation instant,
 * content digest). Frozen: a record is derived deterministically from
 * its set (never hand-built).
 */
export interface FeatureSetProvenanceRecord {
  /** Deterministic record id ("prv_" + 24 hex chars of the identity anchor). */
  readonly provenanceId: string;
  /** The interpretation kind (machine-stable). */
  readonly kind: "device-history-feature-set";
  /** The producing module (machine-stable). */
  readonly source: "@fleetos/predictive";
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly featureSetSchemaVersion: number;
  readonly extractorVersion: string;
  /** The resolved window the derivation selected from. */
  readonly window: ResolvedFeatureWindow;
  /** The input digest the derivation anchored (null never occurs — only derivations get records). */
  readonly inputDigest: FeatureInputDigest;
  /** The evidence refs: the in-window observation ids in canonical order. */
  readonly inputObservationIds: readonly ObservationId[];
  /** The injected generation instant (the set's extractedAt, echoed). */
  readonly generatedAt: string;
  /**
   * sha256 over the canonical JSON of the ENTIRE feature set — the
   * content anchor (any tampering with the set breaks this digest).
   */
  readonly contentDigest: string;
}

/**
 * Derive the provenance record of a feature set. PURE and
 * deterministic: the record is a pure function of the set. REFUSES
 * (typed error, never throws) when the set carries no derivation to
 * anchor (a `rejected` set) or is structurally malformed.
 */
export function makeFeatureSetProvenanceRecord(
  set: DeviceHistoryFeatureSet,
): { ok: true; record: FeatureSetProvenanceRecord } | { ok: false; error: FleetError } {
  if (set?.status?.kind === "rejected") {
    return {
      ok: false,
      error: frozen<FleetError>({
        kind: "DomainError",
        code: ERROR_CODES.provenanceInvalid,
        message: "a rejected feature set makes no derivation claim (nothing to anchor)",
        tenantId: set.tenantId ?? SYNTHETIC_SYSTEM_TENANT,
        correlationId: PREDICTIVE_PIPELINE_CORRELATION_ID,
        domain: "predictive.provenance",
        invariant: "rejected_not_anchorable",
      }),
    };
  }
  const structure = checkSetStructure(set);
  if (!structure.ok) return { ok: false, error: structure.error };
  const identityAnchor = canonicalJson({
    tenantId: set.tenantId,
    deviceId: set.deviceId,
    featureSetSchemaVersion: set.featureSetSchemaVersion,
    extractorVersion: set.extractorVersion,
    windowFrom: set.window.from,
    windowTo: set.window.to,
    inputDigest: set.inputDigest!.value,
    extractedAt: set.extractedAt,
  });
  const record: FeatureSetProvenanceRecord = frozen({
    provenanceId: `prv_${sha256Hex(identityAnchor).slice(0, 24)}`,
    kind: "device-history-feature-set",
    source: "@fleetos/predictive",
    tenantId: set.tenantId,
    deviceId: set.deviceId,
    featureSetSchemaVersion: set.featureSetSchemaVersion,
    extractorVersion: set.extractorVersion,
    window: set.window,
    inputDigest: set.inputDigest!,
    inputObservationIds: set.inputObservationIds,
    generatedAt: set.extractedAt,
    contentDigest: sha256Hex(canonicalJson(set)),
  });
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// The verification boundary
// ---------------------------------------------------------------------------

/** The input of `verifyFeatureSetProvenance`. */
export interface ProvenanceVerificationInput {
  /** The acting tenant scope — the verification is tenant-scoped (cross-tenant refusal). */
  readonly tenantId: TenantId;
  /** The device the claimed observations belong to. */
  readonly deviceId: DeviceId;
  /**
   * The immutable inputs the set CLAIMS: the caller's read of the
   * device's admitted observation stream (read-only; may include
   * entries outside the set's window — the window filter selects).
   */
  readonly claimedObservations: readonly AdmittedDeviceObservation[];
  /** The digest seam (default: the in-package FIPS 180-4 SHA-256). */
  readonly digest?: FeatureDigestFn;
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  /** The injected audit sink (refusals audit; successful verification never audits). */
  readonly auditSink?: PredictiveAuditSink;
}

/** The tagged result of a provenance verification. */
export type ProvenanceVerification =
  | { readonly ok: true; readonly set: DeviceHistoryFeatureSet; readonly record: FeatureSetProvenanceRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Verify a feature set's provenance against the immutable inputs it
 * claims. PURE, non-throwing, tenant-scoped. REFUSES (typed
 * FleetError, code `predictive.provenance.refused`, never a raw throw)
 * on: cross-tenant scope, device mismatch, malformed set/claims, a
 * missing observation ref, an uncovered in-window observation (a gap),
 * a digest mismatch, or a feature-set mismatch (a tampered value — the
 * divergent feature is named in the error message). A `rejected` set
 * makes no derivation claim and is refused as not verifiable.
 *
 * Audit (D4): an attributable refusal emits
 * `predictive.provenance.rejected` (the trust anchor holding is
 * evidence a reviewer must be able to reconstruct). A successful
 * verification is a pure read and NEVER audits.
 */
export function verifyFeatureSetProvenance(
  set: DeviceHistoryFeatureSet,
  input: ProvenanceVerificationInput,
): ProvenanceVerification {
  const trace = {
    tenantId: input?.tenantId ?? SYNTHETIC_SYSTEM_TENANT,
    correlationId: input?.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
  };
  const digestFn: FeatureDigestFn = input?.digest ?? sha256Hex;
  const sink: PredictiveAuditSink | undefined = input?.auditSink;

  const refuse = (invariant: string, message: string, details?: Readonly<Record<string, unknown>>): ProvenanceVerification => {
    const error = frozen<FleetError>({
      kind: "DomainError",
      code: ERROR_CODES.provenanceRefused,
      message,
      tenantId: trace.tenantId,
      correlationId: trace.correlationId,
      domain: "predictive.provenance",
      invariant,
    });
    // Attributable discipline (mirrors W011): a refusal audits only when
    // the record carries a usable instant; a malformed set never produces
    // a malformed audit record.
    const occurredAt = typeof set?.extractedAt === "string" && looksLikeIso(set.extractedAt)
      ? set.extractedAt
      : null;
    if (sink !== undefined && occurredAt !== null) {
      sink.append(
        frozen({
          tenantId: trace.tenantId,
          action: PREDICTIVE_AUDIT_ACTIONS.provenanceRefused,
          subject: typeof input?.deviceId === "string" && input.deviceId.length > 0 ? input.deviceId : null,
          occurredAt,
          correlationId: trace.correlationId,
          causationId: input?.causationId,
          details: frozen({
            invariant,
            ...(details ?? {}),
            ...(set?.inputDigest ? { claimedDigest: set.inputDigest.value } : {}),
          }),
        }),
      );
    }
    return { ok: false, error };
  };

  // ---- 1. The acting tenant scope (cross-tenant refusal) ----------------
  const tenantCheck = validateTenantRef(input?.tenantId);
  if (!tenantCheck.ok) {
    return refuse("tenant_scope_invalid", `verification tenant scope is invalid (${tenantCheck.reason})`);
  }
  if (set?.tenantId !== input.tenantId) {
    return refuse(
      "tenant_mismatch",
      "feature set tenant does not match the acting verification scope (cross-tenant ref refused)",
      { setTenant: set?.tenantId as string, scopeTenant: input.tenantId as string },
    );
  }
  if (set?.deviceId !== input.deviceId) {
    return refuse("device_mismatch", "feature set device does not match the claimed device", {
      setDevice: set?.deviceId as string,
      claimedDevice: input.deviceId as string,
    });
  }

  // ---- 2. The set must carry a derivation claim -------------------------
  const structure = checkSetStructure(set);
  if (!structure.ok) {
    return refuse(structure.error.invariant ?? "malformed_set", structure.error.message);
  }
  if (set.status.kind === "rejected") {
    return refuse(
      "set_not_verifiable",
      "a rejected feature set makes no derivation claim (nothing to verify)",
    );
  }

  // ---- 3. The claimed inputs (attribution + shape + uniqueness) ---------
  if (!Array.isArray(input?.claimedObservations)) {
    return refuse("malformed_claim", "claimed observations are absent");
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < input.claimedObservations.length; i++) {
    const entry = input.claimedObservations[i];
    if (entry === null || typeof entry !== "object") {
      return refuse("malformed_claim", `claimed observation ${i} is malformed`);
    }
    if (entry.tenantId !== input.tenantId || entry.deviceId !== input.deviceId) {
      return refuse(
        "cross_tenant_claim",
        `claimed observation ${i} carries a foreign tenant/device attribution (never merged)`,
      );
    }
    const obs = entry.observation;
    if (
      obs === null ||
      typeof obs !== "object" ||
      typeof obs.id !== "string" ||
      obs.id.length === 0 ||
      typeof obs.kind !== "string" ||
      obs.kind.length === 0 ||
      typeof obs.observedAt !== "string" ||
      !looksLikeIso(obs.observedAt) ||
      epochMs(obs.observedAt) === null ||
      typeof obs.schemaVersion !== "number" ||
      obs.schemaVersion < 1
    ) {
      return refuse("malformed_claim", `claimed observation ${i} violates the frozen Observation invariants`);
    }
    if (seenIds.has(obs.id)) {
      return refuse("malformed_claim", `claimed observation id is duplicated: ${obs.id}`);
    }
    seenIds.add(obs.id);
  }

  // ---- 4. The window selection + the ref check --------------------------
  const fromEpoch = epochMs(set.window.from);
  const toEpoch = epochMs(set.window.to);
  if (fromEpoch === null || toEpoch === null || !(fromEpoch < toEpoch)) {
    return refuse("malformed_set", "the feature set's resolved window is not a valid [from, to) interval");
  }
  const claimedInWindow: AdmittedDeviceObservation[] = [];
  for (const entry of input.claimedObservations) {
    const at = epochMs(entry.observation.observedAt);
    if (at !== null && at >= fromEpoch && at < toEpoch) {
      claimedInWindow.push(entry);
    }
  }
  claimedInWindow.sort((a, b) => {
    const ea = epochMs(a.observation.observedAt)!;
    const eb = epochMs(b.observation.observedAt)!;
    if (ea !== eb) return ea - eb;
    return a.observation.id < b.observation.id ? -1 : a.observation.id > b.observation.id ? 1 : 0;
  });
  const claimedIds = claimedInWindow.map((entry) => entry.observation.id);
  const setIdentifiers = [...set.inputObservationIds];

  // 4a. Missing ref: the set references an id absent from the claimed inputs.
  const claimedIdSet = new Set(claimedIds);
  for (const id of setIdentifiers) {
    if (!claimedIdSet.has(id)) {
      return refuse("missing_observation_ref", `the set references an observation absent from the claimed inputs: ${id}`, {
        missingRef: id,
      });
    }
  }
  // 4b. Gap: a claimed in-window observation the set does not cover.
  const setIdSet = new Set(setIdentifiers);
  for (const id of claimedIds) {
    if (!setIdSet.has(id)) {
      return refuse("uncovered_observation", `a claimed in-window observation is not covered by the set (gap): ${id}`, {
        uncovered: id,
      });
    }
  }
  if (claimedIds.length !== setIdentifiers.length) {
    return refuse("uncovered_observation", "the claimed in-window selection and the set's refs disagree");
  }

  // ---- 5. The digest re-derivation --------------------------------------
  const canonicalSelection = canonicalJson(
    claimedInWindow.map((entry) => ({
      tenantId: entry.tenantId,
      deviceId: entry.deviceId,
      observation: entry.observation,
    })),
  );
  const derivedDigest = digestFn(canonicalSelection);
  if (set.inputDigest!.value !== derivedDigest || set.inputDigest!.algorithm !== "sha256") {
    return refuse(
      "digest_mismatch",
      "the re-derived input digest does not match the set's claimed digest (the claimed inputs differ from what the set was derived from)",
      { claimedDigest: set.inputDigest!.value, derivedDigest },
    );
  }

  // ---- 6. The full re-derivation (determinism IS the proof) -------------
  // Re-extract under the set's OWN recorded identity with the default
  // pass-through gate and NO audit sink (a pure read audits nothing).
  const rederived = extractDeviceHistoryFeatures({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    observations: input.claimedObservations,
    window: { kind: "absolute", from: set.window.from, to: set.window.to },
    extractedAt: set.extractedAt,
    featureSetSchemaVersion: set.featureSetSchemaVersion,
    extractorVersion: set.extractorVersion,
    digest: digestFn,
  });
  if (rederived.status.kind === "rejected") {
    return refuse(
      "feature_set_mismatch",
      `the re-derivation refused where the claimed set did not (${rederived.status.reason}: ${rederived.status.detail})`,
    );
  }
  const mismatch = firstDivergentFeature(set, rederived);
  if (mismatch !== null) {
    return refuse(
      "feature_set_mismatch",
      `the feature set is not reproducible from the claimed inputs (first divergent feature: ${mismatch})`,
      { divergentFeature: mismatch },
    );
  }
  if (
    canonicalJson(rederived.status) !== canonicalJson(set.status) ||
    canonicalJson(rederived.inputObservationIds) !== canonicalJson(set.inputObservationIds) ||
    canonicalJson(rederived.inputDigest) !== canonicalJson(set.inputDigest) ||
    rederived.extractedAt !== set.extractedAt
  ) {
    return refuse(
      "feature_set_mismatch",
      "the feature set's status, refs, digest or extraction instant is not reproducible from the claimed inputs",
    );
  }

  // ---- 7. Accepted: the record anchors the verified set -----------------
  const record = makeFeatureSetProvenanceRecord(set);
  if (!record.ok) {
    return refuse("malformed_set", record.error.message);
  }
  return { ok: true, set, record: record.record };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Structural sanity of a feature set (defense in depth at the boundary). */
function checkSetStructure(
  set: DeviceHistoryFeatureSet,
): { ok: true } | { ok: false; error: DomainError } {
  if (set === null || typeof set !== "object") {
    return structureError("malformed_set", "the feature set is absent");
  }
  if (typeof set.tenantId !== "string" || set.tenantId.length === 0) {
    return structureError("malformed_set", "the feature set carries no tenantId");
  }
  if (typeof set.deviceId !== "string" || set.deviceId.length === 0) {
    return structureError("malformed_set", "the feature set carries no deviceId");
  }
  if (typeof set.featureSetSchemaVersion !== "number" || set.featureSetSchemaVersion < 1) {
    return structureError("malformed_set", "the feature set's schema version must be >= 1");
  }
  if (typeof set.extractorVersion !== "string" || set.extractorVersion.length === 0) {
    return structureError("malformed_set", "the feature set carries no extractor version");
  }
  if (typeof set.extractedAt !== "string" || !looksLikeIso(set.extractedAt)) {
    return structureError("malformed_set", "the feature set's extractedAt is not ISO 8601");
  }
  if (set.window === null || typeof set.window !== "object" || typeof set.window.from !== "string" || typeof set.window.to !== "string") {
    return structureError("malformed_set", "the feature set's resolved window is malformed");
  }
  if (set.status === null || typeof set.status !== "object" || typeof set.status.kind !== "string") {
    return structureError("malformed_set", "the feature set's status is malformed");
  }
  if (!Array.isArray(set.inputObservationIds) || !Array.isArray(set.features)) {
    return structureError("malformed_set", "the feature set's refs/features are malformed");
  }
  if (set.status.kind === "rejected") {
    if (set.inputDigest !== null || set.features.length > 0 || set.inputObservationIds.length > 0) {
      return structureError(
        "malformed_set",
        "a rejected feature set must carry no derivation (never a partial set)",
      );
    }
    return { ok: true };
  }
  if (set.inputDigest === null || set.inputDigest.algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(set.inputDigest.value)) {
    return structureError("malformed_set", "the feature set's input digest is malformed (64 lowercase hex expected)");
  }
  if (set.status.kind !== "ok" && set.features.length > 0) {
    return structureError(
      "malformed_set",
      "only an ok feature set may carry features (honest states never fabricate)",
    );
  }
  for (const feature of set.features) {
    if (feature === null || typeof feature !== "object" || typeof feature.id !== "string") {
      return structureError("malformed_set", "a feature entry is malformed");
    }
  }
  return { ok: true };
}

function structureError(invariant: string, message: string): { ok: false; error: DomainError } {
  return {
    ok: false,
    error: frozen<DomainError>({
      kind: "DomainError",
      code: ERROR_CODES.provenanceInvalid,
      message,
      tenantId: SYNTHETIC_SYSTEM_TENANT,
      correlationId: PREDICTIVE_PIPELINE_CORRELATION_ID,
      domain: "predictive.provenance",
      invariant,
    }),
  };
}

/**
 * The first feature-level divergence between the claimed set and the
 * re-derived set (feature-id order and canonical content compared), or
 * null when identical. Names the tampered feature.
 */
function firstDivergentFeature(
  claimed: DeviceHistoryFeatureSet,
  rederived: DeviceHistoryFeatureSet,
): string | null {
  const claimedFeatures = claimed.features;
  const rederivedFeatures = rederived.features;
  if (claimedFeatures.length !== rederivedFeatures.length) {
    return rederivedFeatures.length < claimedFeatures.length
      ? `${claimedFeatures[rederivedFeatures.length]?.id ?? "(feature list length)"}`
      : "(feature list length)";
  }
  for (let i = 0; i < claimedFeatures.length; i++) {
    if (canonicalJson(claimedFeatures[i]) !== canonicalJson(rederivedFeatures[i])) {
      return claimedFeatures[i].id;
    }
  }
  return null;
}
