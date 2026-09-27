/**
 * @fleetos/recovery — D4: warranty-aware replacement escalation.
 *
 * Consumes W021 health's versioned diagnosis hypotheses carrying DRAFT
 * `ReplacementIntentPayload` (the FROZEN shape from `@fleetos/contracts`
 * — owned by this package per the frozen doc comments; consumed
 * verbatim, never re-declared) plus W032 vendor warranty terms (the
 * `recovery -> vendors` module-map edge, honored via typed comparable
 * values — the ownership gate forbids importing `@fleetos/vendors`,
 * worker-c's lane, so the caller injects the vendor package's REAL
 * warranty terms at the binding site; structural typing, proven by test
 * with `@fleetos/vendors`' built `Vendor` terms).
 *
 * The escalation record is warranty-aware: `in_warranty` vs
 * `out_of_warranty` against the vendor's typed warranty duration (days)
 * measured from an injected warranty-start instant, or
 * `no_warranty_terms` when no vendor terms were supplied. Each
 * escalation cites its diagnosis evidence refs (the hypothesis id, the
 * recommendation id, the cause id, the confidence, and the observation
 * ids behind the anomalies — typed refs, never re-derived here).
 *
 * Escalations are PROPOSALS: an append-only ledger with supersession
 * discipline (a new revision cites the prior via `supersedes`; a prior
 * revision is NEVER rewritten — versioned-interpretation discipline,
 * ARCHITECTURE-LOCK item 3). NEVER automatic procurement: nothing in
 * this module creates a demand, matches a vendor, or orders anything —
 * procurement is `@fleetos/procurement`'s wave (W032, accepted), invoked
 * by a human decision this package does not make.
 *
 * Determinism: escalation ids + content digests are deterministic
 * (FNV-1a over canonical JSON); the same inputs produce byte-identical
 * records regardless of input order (evidence refs sorted).
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `RecoveryTenantScope` FIRST; storage is partitioned
 * per tenant; a foreign escalation id is indistinguishable from an
 * unknown one.
 *
 * Audit (D5): an escalation recorded emits
 * `recovery.replacement.escalated`; a supersession emits
 * `recovery.replacement.superseded`. Pure reads never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { REPLACEMENT_INTENT_KIND } from "@fleetos/contracts";
import type { CorrelationId, CausationId, DeviceId, FleetError, ReplacementIntentPayload, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK, RECOVERY_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  parseIsoMs,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The diagnosis evidence input (the health module edge)
// ---------------------------------------------------------------------------

/**
 * A W021 health diagnosis proposal carrying a DRAFT
 * `ReplacementIntentPayload` — a STRUCTURAL twin of the health
 * package's `TreatmentRecommendation` replacement arm (the ownership
 * gate forbids importing `@fleetos/health`, worker-b's lane, from this
 * lane-A package). The binding site passes health's REAL
 * `TreatmentRecommendation.proposedIntent` value through this shape
 * (proven by test); the payload is the FROZEN contracts shape.
 */
export interface ReplacementDiagnosisProposal {
  /** The frozen intent kind this proposal drafts (`ReplacementIntent`). */
  readonly intentKind: typeof REPLACEMENT_INTENT_KIND;
  /** The DRAFT payload — the FROZEN `ReplacementIntentPayload` shape, verbatim. */
  readonly payload: ReplacementIntentPayload;
}

/** The diagnosis evidence refs an escalation cites. */
export interface ReplacementDiagnosisEvidence {
  /** The W021 diagnosis hypothesis id (a typed ref). */
  readonly hypothesisId: string;
  /** The W021 treatment-recommendation id (a typed ref). */
  readonly recommendationId: string;
  /** The hypothesized cause id (e.g. "health.hardware_failing"). */
  readonly causeId: string;
  /** The hypothesis confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The DRAFT replacement intent proposal the recommendation carries. */
  readonly proposedIntent: ReplacementDiagnosisProposal;
  /** The observation ids behind the anomalies that produced the hypothesis. */
  readonly observationIds: readonly string[];
}

// ---------------------------------------------------------------------------
// The vendor warranty terms input (the vendors module edge)
// ---------------------------------------------------------------------------

/**
 * The vendor warranty terms — a STRUCTURAL twin of `@fleetos/vendors`'
 * `VendorTerms` comparable values (the `recovery -> vendors` module-map
 * edge honored via typed comparable values; the ownership gate forbids
 * the cross-lane import — the binding site injects the vendor package's
 * REAL terms, proven by test). Warranty is a `DaysDuration`-shaped
 * comparable: longer is better.
 */
export interface VendorWarrantyTerms {
  /** The vendor's standard warranty duration in days (>= 0). */
  readonly warranty: { readonly days: number };
}

/** The injected warranty context of one escalation. */
export interface WarrantyContext {
  /** The vendor whose terms apply (a typed ref). */
  readonly vendorId: string;
  /** The vendor's display name, when known (never matched on). */
  readonly vendorName?: string;
  /** The vendor's warranty terms (the typed comparable value). */
  readonly terms: VendorWarrantyTerms;
  /** The injected instant warranty coverage began (ISO 8601). */
  readonly warrantyStartAt: string;
}

// ---------------------------------------------------------------------------
// Warranty standing (machine-stable, deterministic)
// ---------------------------------------------------------------------------

/** The warranty-aware standing of an escalation. */
export type WarrantyStanding = "in_warranty" | "out_of_warranty" | "no_warranty_terms";

/** All standings (for validation + iteration). */
export const ALL_WARRANTY_STANDINGS: readonly WarrantyStanding[] = Object.freeze([
  "in_warranty",
  "out_of_warranty",
  "no_warranty_terms",
]);

/** One day in milliseconds (the comparable-unit conversion of DaysDuration). */
export const MS_PER_DAY = 86_400_000;

/**
 * Classify the warranty standing of a proposed replacement at the
 * injected escalation instant. PURE and deterministic:
 *   - `no_warranty_terms` — no vendor warranty context was supplied;
 *   - `in_warranty` — the coverage age (escalation instant minus
 *     warranty start) is within [0, warranty days] (measured in the
 *     vendor terms' comparable unit: days);
 *   - `out_of_warranty` — the coverage age exceeds the warranty days,
 *     or the warranty start postdates the escalation instant
 *     (future-dated coverage — a machine-stable classification, never a
 *     guess, never a clamp).
 *
 * @param proposedAt the injected escalation instant (ISO 8601)
 * @param warranty the injected warranty context (undefined -> no terms)
 * @returns the machine-stable standing
 */
export function classifyWarrantyStanding(
  proposedAt: string,
  warranty: WarrantyContext | undefined,
): WarrantyStanding {
  if (warranty === undefined) return "no_warranty_terms";
  const proposedMs = parseIsoMs(proposedAt);
  const startMs = parseIsoMs(warranty.warrantyStartAt);
  if (Number.isNaN(proposedMs) || Number.isNaN(startMs)) return "no_warranty_terms";
  const ageMs = proposedMs - startMs;
  if (ageMs < 0) return "out_of_warranty";
  if (ageMs <= warranty.terms.warranty.days * MS_PER_DAY) return "in_warranty";
  return "out_of_warranty";
}

// ---------------------------------------------------------------------------
// The versioned escalation record
// ---------------------------------------------------------------------------

/**
 * A versioned replacement escalation record — a PROPOSAL, never
 * automatic procurement. Append-only: supersession appends
 * `version = prior + 1` citing the prior via `supersedes`; a prior
 * revision is never rewritten.
 */
export interface ReplacementEscalationRecord extends TenantScoped {
  /** Deterministic identity: `re_` + fnv1a32(tenant, device, diagnosis refs, proposedAt). */
  readonly escalationId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The recovery case the escalation belongs to, when one exists. */
  readonly caseId?: string;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The prior revision this one supersedes (absent on version 1). */
  readonly supersedes?: string;
  /** The diagnosis evidence the escalation cites (W021 refs + the DRAFT payload). */
  readonly diagnosis: ReplacementDiagnosisEvidence;
  /** The injected vendor warranty context, when terms were supplied. */
  readonly warranty?: WarrantyContext;
  /** The warranty-aware standing (machine-stable). */
  readonly warrantyStanding: WarrantyStanding;
  /** The injected proposal instant. */
  readonly proposedAt: string;
  /** Canonical digest of the revision's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic escalation identity. */
export function replacementEscalationId(
  tenantId: TenantId,
  deviceId: DeviceId,
  diagnosis: ReplacementDiagnosisEvidence,
  proposedAt: string,
): string {
  return `re_${fnv1a32Hex(
    canonicalJson([
      tenantId,
      deviceId,
      diagnosis.hypothesisId,
      diagnosis.recommendationId,
      diagnosis.causeId,
      proposedAt,
    ]),
  )}`;
}

/** The canonical content digest of an escalation revision's content fields. */
export function replacementEscalationContentDigest(
  record: Omit<ReplacementEscalationRecord, "escalationId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.deviceId,
      record.version,
      record.caseId ?? null,
      record.supersedes ?? null,
      record.diagnosis,
      record.warranty ?? null,
      record.warrantyStanding,
      record.proposedAt,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The tenant-partitioned escalation ledger
// ---------------------------------------------------------------------------

/** The tagged result of an escalation-ledger write. */
export type ReplacementEscalationWrite =
  | { readonly ok: true; readonly record: ReplacementEscalationRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only replacement-escalation ledger. Every
 * operation takes the acting `RecoveryTenantScope` FIRST and touches
 * only the acting tenant's partition. Escalation revisions are
 * append-only per escalation id.
 */
export interface ReplacementEscalationLedger {
  /** Append an escalation revision into the ACTING tenant's partition (tenant must match). */
  appendEscalation(scope: RecoveryTenantScope, record: ReplacementEscalationRecord): ReplacementEscalationWrite;
  /** The LATEST revision of an escalation (own partition only; undefined when absent/foreign). */
  getLatestEscalation(scope: RecoveryTenantScope, escalationId: string): ReplacementEscalationRecord | undefined;
  /** Every revision of an escalation, version order (own partition only). */
  listEscalationRevisions(
    scope: RecoveryTenantScope,
    escalationId: string,
  ): readonly ReplacementEscalationRecord[];
  /** All escalation ids in the acting partition (sorted). */
  listEscalationIds(scope: RecoveryTenantScope): readonly string[];
  /** The number of escalations in the acting partition. */
  size(scope: RecoveryTenantScope): number;
}

/**
 * Create the in-memory reference `ReplacementEscalationLedger`. Storage
 * is partitioned by tenant id; escalation revisions are append-only per
 * escalation id (the prior is never rewritten — supersession
 * discipline).
 */
export function createInMemoryReplacementEscalationLedger(): ReplacementEscalationLedger {
  /** tenantId -> (escalationId -> ReplacementEscalationRecord[]). */
  const partitions = new Map<string, Map<string, ReplacementEscalationRecord[]>>();

  function partitionOf(tenantId: string): Map<string, ReplacementEscalationRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ReplacementEscalationRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: RecoveryTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkRecoveryTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.escalationStoreDomain,
          `replacement escalation ledger refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
          "recovery.replacement.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: RecoveryTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendEscalation(
      scope: RecoveryTenantScope,
      record: ReplacementEscalationRecord,
    ): ReplacementEscalationWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.escalationStoreDomain,
            "replacement escalation tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "recovery.replacement.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(record.escalationId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(record.escalationId, revisions);
      }
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.escalationStoreDomain,
            "escalation version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "recovery.replacement.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.escalationStoreDomain,
            `escalation revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "recovery.replacement.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    getLatestEscalation(
      scope: RecoveryTenantScope,
      escalationId: string,
    ): ReplacementEscalationRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(escalationId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    listEscalationRevisions(
      scope: RecoveryTenantScope,
      escalationId: string,
    ): readonly ReplacementEscalationRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(escalationId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listEscalationIds(scope: RecoveryTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: RecoveryTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Recording + superseding escalations
// ---------------------------------------------------------------------------

/** The input of an escalation recording. */
export interface EscalateReplacementInput {
  /** The device the replacement concerns. */
  readonly deviceId: DeviceId;
  /** The diagnosis evidence the escalation cites (W021 refs + the DRAFT payload). */
  readonly diagnosis: ReplacementDiagnosisEvidence;
  /** The recovery case the escalation belongs to, when one exists. */
  readonly caseId?: string;
  /** The injected vendor warranty context, when terms were supplied. */
  readonly warranty?: WarrantyContext;
}

/** Options for `escalateReplacement`. */
export interface EscalateReplacementOptions {
  /** The injected proposal instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the escalation request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the escalation is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the escalation emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** Validate a diagnosis-evidence input (returns null on success; failures otherwise). */
function validateDiagnosisEvidence(
  diagnosis: unknown,
  path: string,
): { path: string; reason: string }[] | null {
  const failures: { path: string; reason: string }[] = [];
  if (diagnosis === null || typeof diagnosis !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = diagnosis as Record<string, unknown>;
  for (const field of ["hypothesisId", "recommendationId", "causeId"] as const) {
    if (typeof candidate[field] !== "string" || (candidate[field] as string).length === 0) {
      failures.push({ path: `${path}/${field}`, reason: "required" });
    }
  }
  const confidence = candidate["confidence"];
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    failures.push({ path: `${path}/confidence`, reason: "unit_interval_number_required" });
  }
  const intent = candidate["proposedIntent"];
  if (intent === null || typeof intent !== "object") {
    failures.push({ path: `${path}/proposedIntent`, reason: "object_required" });
  } else {
    const intentRecord = intent as Record<string, unknown>;
    if (intentRecord["intentKind"] !== REPLACEMENT_INTENT_KIND) {
      failures.push({ path: `${path}/proposedIntent/intentKind`, reason: "replacement_intent_kind_required" });
    }
    const payload = intentRecord["payload"];
    if (payload === null || typeof payload !== "object") {
      failures.push({ path: `${path}/proposedIntent/payload`, reason: "object_required" });
    } else {
      const payloadRecord = payload as Record<string, unknown>;
      if (
        payloadRecord["deviceId"] !== undefined &&
        (typeof payloadRecord["deviceId"] !== "string" || (payloadRecord["deviceId"] as string).length === 0)
      ) {
        failures.push({ path: `${path}/proposedIntent/payload/deviceId`, reason: "non_empty_string_required" });
      }
      if (typeof payloadRecord["reason"] !== "string" || (payloadRecord["reason"] as string).length === 0) {
        failures.push({ path: `${path}/proposedIntent/payload/reason`, reason: "required" });
      }
    }
  }
  const observationIds = candidate["observationIds"];
  if (
    !Array.isArray(observationIds) ||
    !observationIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    failures.push({ path: `${path}/observationIds`, reason: "string_array_required" });
  }
  return failures.length === 0 ? null : failures;
}

/** Validate a warranty context (returns null on success; failures otherwise). */
function validateWarranty(
  warranty: unknown,
  path: string,
): { path: string; reason: string }[] | null {
  if (warranty === undefined) return null;
  const failures: { path: string; reason: string }[] = [];
  if (warranty === null || typeof warranty !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = warranty as Record<string, unknown>;
  if (typeof candidate["vendorId"] !== "string" || (candidate["vendorId"] as string).length === 0) {
    failures.push({ path: `${path}/vendorId`, reason: "required" });
  }
  if (
    candidate["vendorName"] !== undefined &&
    (typeof candidate["vendorName"] !== "string" || (candidate["vendorName"] as string).length === 0)
  ) {
    failures.push({ path: `${path}/vendorName`, reason: "non_empty_string_required" });
  }
  const terms = candidate["terms"];
  if (terms === null || typeof terms !== "object") {
    failures.push({ path: `${path}/terms`, reason: "object_required" });
  } else {
    const days = (terms as Record<string, unknown>)["warranty"];
    if (
      days === null ||
      typeof days !== "object" ||
      typeof (days as Record<string, unknown>)["days"] !== "number" ||
      !Number.isFinite((days as Record<string, unknown>)["days"] as number) ||
      (days as Record<string, unknown>)["days"] as number < 0
    ) {
      failures.push({ path: `${path}/terms/warranty/days`, reason: "non_negative_number_required" });
    }
  }
  if (typeof candidate["warrantyStartAt"] !== "string" || !looksLikeIso(candidate["warrantyStartAt"] as string)) {
    failures.push({ path: `${path}/warrantyStartAt`, reason: "not_iso" });
  }
  return failures.length === 0 ? null : failures;
}

/**
 * Record a warranty-aware replacement escalation — a PROPOSAL, never
 * automatic procurement. DETERMINISTIC: the escalation identity + the
 * revision content are pure functions of (tenant, device, diagnosis
 * refs, proposedAt, warranty context). The standing is classified
 * against the vendor's typed warranty terms (see
 * `classifyWarrantyStanding`).
 *
 * Audit: the recording emits `recovery.replacement.escalated`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param ledger the escalation ledger
 * @param input the escalation input
 * @param options the injected options
 * @returns the tagged write result
 */
export function escalateReplacement(
  scope: RecoveryTenantScope,
  ledger: ReplacementEscalationLedger,
  input: EscalateReplacementInput,
  options: EscalateReplacementOptions,
): ReplacementEscalationWrite {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.escalationStoreDomain,
        `replacement escalation ledger refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.replacement.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  const diagnosisFailures = validateDiagnosisEvidence(input?.diagnosis, "/diagnosis");
  if (diagnosisFailures !== null) failures.push(...diagnosisFailures);
  const warrantyFailures = validateWarranty(input?.warranty, "/warranty");
  if (warrantyFailures !== null) failures.push(...warrantyFailures);
  if (input?.caseId !== undefined && (typeof input.caseId !== "string" || input.caseId.length === 0)) {
    failures.push({ path: "/caseId", reason: "non_empty_string_required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.escalationInvalid,
        "replacement escalation request is invalid",
        trace,
        failures,
      ),
    };
  }
  const diagnosis: ReplacementDiagnosisEvidence = frozen({
    ...input.diagnosis,
    observationIds: Object.freeze([...input.diagnosis.observationIds].sort()),
  });
  const escalationId = replacementEscalationId(guard.tenantId, input.deviceId, diagnosis, options.at);
  const content: Omit<ReplacementEscalationRecord, "escalationId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    deviceId: input.deviceId,
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
    version: 1,
    diagnosis,
    ...(input.warranty !== undefined ? { warranty: input.warranty } : {}),
    warrantyStanding: classifyWarrantyStanding(options.at, input.warranty),
    proposedAt: options.at,
  });
  const record: ReplacementEscalationRecord = frozen({
    ...content,
    escalationId,
    contentDigest: replacementEscalationContentDigest(content),
  });
  const write = ledger.appendEscalation(scope, record);
  if (!write.ok) return write;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.replacementEscalated,
      tenantId: guard.tenantId,
      subject: escalationId,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        escalationId,
        deviceId: input.deviceId as string,
        caseId: input.caseId ?? null,
        hypothesisId: diagnosis.hypothesisId,
        recommendationId: diagnosis.recommendationId,
        causeId: diagnosis.causeId,
        confidence: diagnosis.confidence,
        intentKind: diagnosis.proposedIntent.intentKind,
        intentPayload: diagnosis.proposedIntent.payload,
        warrantyStanding: record.warrantyStanding,
        vendorId: record.warranty?.vendorId ?? null,
        warrantyDays: record.warranty?.terms.warranty.days ?? null,
        observationIds: diagnosis.observationIds,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return { ok: true, record };
}

/** Options for `supersedeReplacementEscalation`. */
export interface SupersedeReplacementOptions {
  /** The injected proposal instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the supersession request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the supersession is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The updated vendor warranty context (or undefined to record no terms). */
  readonly warranty?: WarrantyContext;
  /** The injected audit sink (the supersession emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/**
 * Supersede a replacement escalation with a new revision — the
 * append-only supersession discipline: the new revision cites the prior
 * via `supersedes`; the prior revision is NEVER rewritten (its content
 * digest remains valid history). The new revision re-classifies the
 * warranty standing against the supplied terms at the new injected
 * instant. STILL a proposal — nothing here procures.
 *
 * Audit: the supersession emits `recovery.replacement.superseded`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param ledger the escalation ledger
 * @param prior the prior escalation revision (LATEST, from the acting partition)
 * @param options the injected options
 * @returns the tagged write result
 */
export function supersedeReplacementEscalation(
  scope: RecoveryTenantScope,
  ledger: ReplacementEscalationLedger,
  prior: ReplacementEscalationRecord,
  options: SupersedeReplacementOptions,
): ReplacementEscalationWrite {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.escalationStoreDomain,
        `replacement escalation ledger refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.replacement.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (prior === null || typeof prior !== "object") {
    failures.push({ path: "/prior", reason: "escalation_required" });
  }
  const warrantyFailures = validateWarranty(options?.warranty, "/warranty");
  if (warrantyFailures !== null) failures.push(...warrantyFailures);
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.escalationInvalid,
        "replacement supersession request is invalid",
        trace,
        failures,
      ),
    };
  }
  if (prior.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.escalationStoreDomain,
        "replacement escalation tenant does not match the acting tenant scope",
        trace,
        "recovery.replacement.supersede",
        "tenant_mismatch",
      ),
    };
  }
  const version = prior.version + 1;
  const content: Omit<ReplacementEscalationRecord, "escalationId" | "contentDigest"> = frozen({
    tenantId: prior.tenantId,
    deviceId: prior.deviceId,
    ...(prior.caseId !== undefined ? { caseId: prior.caseId } : {}),
    version,
    supersedes: prior.escalationId,
    diagnosis: prior.diagnosis,
    ...(options.warranty !== undefined ? { warranty: options.warranty } : {}),
    warrantyStanding: classifyWarrantyStanding(options.at, options.warranty),
    proposedAt: options.at,
  });
  const record: ReplacementEscalationRecord = frozen({
    ...content,
    escalationId: prior.escalationId,
    contentDigest: replacementEscalationContentDigest(content),
  });
  const write = ledger.appendEscalation(scope, record);
  if (!write.ok) return write;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.replacementSuperseded,
      tenantId: guard.tenantId,
      subject: prior.escalationId,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        escalationId: prior.escalationId,
        version,
        supersedes: prior.escalationId,
        priorWarrantyStanding: prior.warrantyStanding,
        warrantyStanding: record.warrantyStanding,
        vendorId: record.warranty?.vendorId ?? null,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return { ok: true, record };
}
