/**
 * @fleetos/recovery — W071: the destructive-intent review surface.
 *
 * ARCHITECTURE-LOCK.md item 16 (CENTER STAGE for this module):
 * "Destructive actions require an explicit policy grant and evidence
 * trail." The W040 gate (destructive-gate.ts — untouched) enforces the
 * grant at evaluation time. This module adds the REVIEW surface that
 * runs BEFORE the gate (fail-fast):
 *
 *   - Every destructive intent (lock / locate / wipe / reboot — the
 *     frozen `RecoveryIntentPayload` action set) is PRESENTED with its
 *     FULL §16 evidence bundle: the intent identity (case, device,
 *     action, requester, instant), the last-seen evidence basis
 *     (record id + observed instant), the posture finding refs, the
 *     observation evidence artifacts (non-empty `EvidenceRef` set),
 *     and the explicit policy grant reference.
 *   - A MISSING evidence field refuses machine-stably
 *     (`evidence_incomplete`) with the SORTED list of missing field
 *     paths — BEFORE the W040 gate runs. The gate is never consulted
 *     for an incomplete bundle (proven by test: the store stays empty,
 *     the adapter seam is never called, the gate call-log stays at
 *     zero).
 *   - A bundle whose identity disagrees with the recovery case it
 *     cites refuses machine-stably (`bundle_case_mismatch`) — a
 *     reviewer must never be shown evidence that belongs to another
 *     case/device/tenant.
 *
 * The composition `requestDestructiveActionWithReview` runs the review
 * FIRST, then delegates to the EXISTING `requestDestructiveAction`
 * verbatim (the W040 gate's behavior — capability refusals, Guardian
 * routing, human approval, §16 execution trail — is preserved
 * exactly; only the entry is hardened).
 *
 * Every review pass and refusal is audited through the injected
 * `RecoveryAuditSink` seam (the W011/W040 pattern). Tenant isolation
 * is by construction: the acting `RecoveryTenantScope` comes FIRST and
 * a foreign bundle is refused before any presentation.
 *
 * ADDITIVE ONLY: the W040 gate, its options, and its records are
 * consumed verbatim; this module is new beside them.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
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
import type { RecoveryCaseRecord } from "./recovery-case";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK } from "./audit-seam";
import type {
  DestructiveRecoveryAction,
  DestructiveRequestRecord,
  DestructiveRequestStore,
} from "./destructive-request";
import { ALL_DESTRUCTIVE_RECOVERY_ACTIONS } from "./destructive-request";
import { requestDestructiveAction } from "./destructive-gate";
import type { RequestDestructiveOptions, RequestDestructiveResult } from "./destructive-gate";
import {
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// W071.1 — The §16 evidence bundle
// ---------------------------------------------------------------------------

/**
 * The FULL §16 evidence bundle a destructive intent is presented with.
 * Every field is REQUIRED — the review refuses `evidence_incomplete`
 * listing the sorted missing paths. The bundle carries:
 *
 *   - intent identity: tenant, device, case, action, requestedAt,
 *     requestedBy;
 *   - the last-seen evidence basis: the record id + the observed
 *     instant (when the device was last seen);
 *   - the posture finding refs backing the case (non-empty);
 *   - the observation evidence artifacts (non-empty `EvidenceRef` set
 *     — the §16 observation trail);
 *   - the explicit policy grant reference (the grant the request
 *     asserts will authorize it — the gate re-asserts the real grant
 *     at evaluation; the review only demands the reference EXIST).
 */
export interface DestructiveIntentEvidenceBundle extends TenantScoped {
  /** The device the intent targets. */
  readonly deviceId: DeviceId;
  /** The recovery case the intent belongs to. */
  readonly caseId: string;
  /** The destructive action (lock / locate / wipe / reboot). */
  readonly action: DestructiveRecoveryAction;
  /** The injected request instant (ISO 8601). */
  readonly requestedAt: string;
  /** The requesting principal (non-empty). */
  readonly requestedBy: string;
  /** The last-seen record id backing the case evidence. */
  readonly lastSeenRecordId: string;
  /** The last-seen observed instant (ISO 8601). */
  readonly lastSeenObservedAt: string;
  /** The posture finding refs backing the case (non-empty). */
  readonly postureFindingRefs: readonly string[];
  /** The observation evidence artifacts (non-empty; order-insensitive — sorted canonically). */
  readonly observationEvidence: readonly EvidenceRef[];
  /** The explicit policy grant reference (non-empty; the gate re-asserts the grant itself). */
  readonly policyGrantRef: string;
}

/**
 * The reviewed intent: the bundle plus its deterministic review
 * identity + content digest. Frozen, append-only-safe (a review is a
 * presentation record, never a mutation of the W040 stores).
 */
export interface ReviewedDestructiveIntent extends DestructiveIntentEvidenceBundle {
  /** Deterministic review id: `drw_` + fnv1a32(tenant, caseId, action, requestedAt). */
  readonly reviewId: string;
  /** Canonical digest of the review's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// W071.2 — Machine-stable refusal taxonomy
// ---------------------------------------------------------------------------

/**
 * The machine-stable refusal reasons of the review surface.
 * `evidence_incomplete` is the §16 fail-fast: a missing evidence field
 * refuses BEFORE the W040 gate runs. `bundle_case_mismatch` is the
 * consistency refusal: the bundle's identity disagrees with the case
 * it cites. `tenant_mismatch`: the bundle belongs to a foreign tenant.
 */
export type DestructiveReviewRefusalReason =
  | "evidence_incomplete"
  | "bundle_case_mismatch"
  | "tenant_mismatch"
  | "invalid_scope";

/** Every refusal reason, frozen, for validation + iteration. */
export const ALL_DESTRUCTIVE_REVIEW_REFUSAL_REASONS: readonly DestructiveReviewRefusalReason[] =
  frozenArray([
    "evidence_incomplete",
    "bundle_case_mismatch",
    "tenant_mismatch",
    "invalid_scope",
  ]);

/** A machine-stable review refusal. */
export interface DestructiveReviewRefusal {
  /** The tenant the refusal is attributed to (the acting scope's tenant). */
  readonly tenantId: TenantId;
  /** The machine-stable refusal reason. */
  readonly reason: DestructiveReviewRefusalReason;
  /** The sorted missing field paths, on `evidence_incomplete`. */
  readonly missingFields?: readonly string[];
  /** The review id, when the bundle was complete enough to derive one. */
  readonly reviewId?: string;
}

// ---------------------------------------------------------------------------
// W071.3 — Deterministic review identity
// ---------------------------------------------------------------------------

/** The deterministic review id: digest of (tenantId, caseId, action, requestedAt). */
export function destructiveReviewId(
  tenantId: TenantId,
  caseId: string,
  action: DestructiveRecoveryAction,
  requestedAt: string,
): string {
  return `drw_${fnv1a32Hex(canonicalJson([tenantId, caseId, action, requestedAt]))}`;
}

/**
 * The canonical content digest of a reviewed intent: FNV-1a over the
 * canonical JSON of the content fields with ORDER-INSENSITIVE sets
 * sorted (posture finding refs sorted; observation evidence sorted by
 * key) — two structurally equal bundles review byte-identically
 * regardless of input order. Never for security.
 */
export function destructiveReviewContentDigest(
  bundle: Omit<ReviewedDestructiveIntent, "reviewId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      bundle.tenantId,
      bundle.deviceId,
      bundle.caseId,
      bundle.action,
      bundle.requestedAt,
      bundle.requestedBy,
      bundle.lastSeenRecordId,
      bundle.lastSeenObservedAt,
      [...bundle.postureFindingRefs].sort(),
      [...bundle.observationEvidence].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      bundle.policyGrantRef,
    ]),
  );
}

// ---------------------------------------------------------------------------
// W071.4 — The review (fail-fast, BEFORE the W040 gate)
// ---------------------------------------------------------------------------

/** The result of the review step. */
export type DestructiveReviewResult =
  | { readonly ok: true; readonly review: ReviewedDestructiveIntent }
  | { readonly ok: false; readonly refusal: DestructiveReviewRefusal };

/**
 * Review a destructive intent's §16 evidence bundle. PURE: no store,
 * no gate, no audit — the composition boundary
 * (`requestDestructiveActionWithReview`) owns the audit emission.
 *
 * Order of checks (all machine-stable):
 *   1. completeness — every required field present + well-formed
 *      (non-empty strings, ISO timestamps, the action in the frozen
 *      set, non-empty arrays, a non-empty grant ref). A missing field
 *      refuses `evidence_incomplete` with the SORTED missing paths.
 *      THE GATE IS NEVER CONSULTED (the review takes no gate).
 *   2. scope — the bundle's tenant must match the acting scope
 *      (`tenant_mismatch` / `invalid_scope`): a foreign bundle is
 *      refused before any presentation.
 */
export function reviewDestructiveIntent(
  scope: RecoveryTenantScope,
  bundle: unknown,
): DestructiveReviewResult {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      refusal: frozen({
        tenantId: SYNTHETIC_SYSTEM_TENANT,
        reason: "invalid_scope",
      }),
    };
  }
  const candidate =
    bundle !== null && typeof bundle === "object"
      ? (bundle as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  // --- 1. completeness: every §16 field present + well-formed ---------
  const missing: string[] = [];
  if (typeof candidate.deviceId !== "string" || (candidate.deviceId as string).length === 0) {
    missing.push("/deviceId");
  }
  if (typeof candidate.caseId !== "string" || (candidate.caseId as string).length === 0) {
    missing.push("/caseId");
  }
  if (
    !(ALL_DESTRUCTIVE_RECOVERY_ACTIONS as readonly string[]).includes(candidate.action as string)
  ) {
    missing.push("/action");
  }
  if (typeof candidate.requestedAt !== "string" || !looksLikeIso(candidate.requestedAt)) {
    missing.push("/requestedAt");
  }
  if (typeof candidate.requestedBy !== "string" || (candidate.requestedBy as string).length === 0) {
    missing.push("/requestedBy");
  }
  if (
    typeof candidate.lastSeenRecordId !== "string" ||
    (candidate.lastSeenRecordId as string).length === 0
  ) {
    missing.push("/lastSeenRecordId");
  }
  if (
    typeof candidate.lastSeenObservedAt !== "string" ||
    !looksLikeIso(candidate.lastSeenObservedAt)
  ) {
    missing.push("/lastSeenObservedAt");
  }
  if (
    !Array.isArray(candidate.postureFindingRefs) ||
    candidate.postureFindingRefs.length === 0 ||
    candidate.postureFindingRefs.some((ref) => typeof ref !== "string" || ref.length === 0)
  ) {
    missing.push("/postureFindingRefs");
  }
  if (
    !Array.isArray(candidate.observationEvidence) ||
    candidate.observationEvidence.length === 0 ||
    candidate.observationEvidence.some(
      (ref) =>
        ref === null ||
        typeof ref !== "object" ||
        typeof (ref as EvidenceRef).key !== "string" ||
        (ref as EvidenceRef).key.length === 0,
    )
  ) {
    missing.push("/observationEvidence");
  }
  if (
    typeof candidate.policyGrantRef !== "string" ||
    (candidate.policyGrantRef as string).length === 0
  ) {
    missing.push("/policyGrantRef");
  }
  if (missing.length > 0) {
    // THE fail-fast: an incomplete §16 bundle NEVER reaches the W040
    // gate. Sorted missing paths — deterministic across permutations.
    return {
      ok: false,
      refusal: frozen({
        tenantId: guard.tenantId,
        reason: "evidence_incomplete",
        missingFields: frozenArray(missing.sort()),
      }),
    };
  }
  // --- 2. tenant scope: a foreign bundle is refused before presentation
  if ((candidate.tenantId as string) !== (guard.tenantId as string)) {
    return {
      ok: false,
      refusal: frozen({
        tenantId: guard.tenantId,
        reason: "tenant_mismatch",
      }),
    };
  }
  const complete: Omit<ReviewedDestructiveIntent, "reviewId" | "contentDigest"> = frozen({
    tenantId: candidate.tenantId as TenantId,
    deviceId: candidate.deviceId as DeviceId,
    caseId: candidate.caseId as string,
    action: candidate.action as DestructiveRecoveryAction,
    requestedAt: candidate.requestedAt as string,
    requestedBy: candidate.requestedBy as string,
    lastSeenRecordId: candidate.lastSeenRecordId as string,
    lastSeenObservedAt: candidate.lastSeenObservedAt as string,
    postureFindingRefs: frozenArray(candidate.postureFindingRefs as string[]),
    observationEvidence: frozenArray(candidate.observationEvidence as EvidenceRef[]),
    policyGrantRef: candidate.policyGrantRef as string,
  });
  const reviewId = destructiveReviewId(
    complete.tenantId,
    complete.caseId,
    complete.action,
    complete.requestedAt,
  );
  return {
    ok: true,
    review: frozen({
      ...complete,
      reviewId,
      contentDigest: destructiveReviewContentDigest(complete),
    }),
  };
}

// ---------------------------------------------------------------------------
// W071.5 — The composition boundary (review THEN the W040 gate, verbatim)
// ---------------------------------------------------------------------------

/** Stable machine audit action names for the review layer. */
export const DESTRUCTIVE_REVIEW_AUDIT_ACTIONS = frozen({
  /** A destructive intent's §16 evidence bundle passed review (gate follows). */
  reviewPassed: "recovery.destructive.review_passed",
  /** A destructive intent's §16 evidence bundle was refused at review (gate never runs). */
  reviewRefused: "recovery.destructive.review_refused",
} as const);

/**
 * The result of the composed boundary: the gate's verbatim result on
 * pass, or the review's machine-stable refusal on fail — staged so
 * callers can distinguish WHICH boundary held.
 */
export type DestructiveReviewGateResult =
  | { readonly ok: true; readonly record: DestructiveRequestRecord }
  | { readonly ok: false; readonly stage: "review"; readonly refusal: DestructiveReviewRefusal }
  | { readonly ok: false; readonly stage: "gate"; readonly error: FleetError };

/**
 * Request a destructive action WITH the §16 evidence review running
 * FIRST (fail-fast). The review validates the bundle's completeness
 * and tenant scope; a refusal NEVER reaches the W040 gate (the store
 * stays untouched, the adapter seam is never called). On pass, the
 * bundle's identity must agree with the cited recovery case
 * (`bundle_case_mismatch` otherwise), and THEN the EXISTING
 * `requestDestructiveAction` runs verbatim — the W040 gate's
 * capability refusals, Guardian routing, human-approval parking, and
 * §16 execution trail are preserved exactly.
 *
 * Audit: `recovery.destructive.review_passed` / `.review_refused` emit
 * to the injected sink (the review boundary holding is evidence); the
 * gate emits its own W040 audit records as always.
 */
export function requestDestructiveActionWithReview<R>(
  scope: RecoveryTenantScope,
  store: DestructiveRequestStore,
  caseRecord: RecoveryCaseRecord,
  bundle: unknown,
  options: RequestDestructiveOptions<R> & {
    /** The injected audit sink for the REVIEW stage (default: no-op). */
    readonly reviewAuditSink?: RecoveryAuditSink;
  },
): DestructiveReviewGateResult {
  const sink: RecoveryAuditSink = options.reviewAuditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  const correlationId: CorrelationId =
    (options as { correlationId?: CorrelationId }).correlationId ??
    RECOVERY_PIPELINE_CORRELATION_ID;
  const review = reviewDestructiveIntent(scope, bundle);
  if (!review.ok) {
    sink.append(
      frozen({
        action: DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewRefused,
        tenantId: review.refusal.tenantId,
        subject: null,
        occurredAt: typeof (options as { at?: string }).at === "string"
          ? ((options as { at?: string }).at as string)
          : "",
        correlationId,
        details: frozen({
          reason: review.refusal.reason,
          missingFields: review.refusal.missingFields ?? [],
          caseId: caseRecord?.caseId ?? null,
        }),
      }),
    );
    return { ok: false, stage: "review", refusal: review.refusal };
  }
  const reviewed = review.review;
  // Bundle/case consistency: a reviewer must never be shown evidence
  // that belongs to another case, device, or tenant.
  if (
    reviewed.tenantId !== caseRecord.tenantId ||
    (reviewed.deviceId as string) !== (caseRecord.deviceId as string) ||
    reviewed.caseId !== caseRecord.caseId
  ) {
    const refusal = frozen({
      tenantId: reviewed.tenantId,
      reason: "bundle_case_mismatch" as const,
      reviewId: reviewed.reviewId,
    });
    sink.append(
      frozen({
        action: DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewRefused,
        tenantId: reviewed.tenantId,
        subject: reviewed.requestedBy,
        occurredAt: reviewed.requestedAt,
        correlationId,
        details: frozen({
          reason: refusal.reason,
          reviewId: reviewed.reviewId,
          bundleCaseId: reviewed.caseId,
          caseCaseId: caseRecord.caseId,
          bundleDeviceId: reviewed.deviceId as string,
          caseDeviceId: caseRecord.deviceId as string,
        }),
      }),
    );
    return { ok: false, stage: "review", refusal };
  }
  sink.append(
    frozen({
      action: DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewPassed,
      tenantId: reviewed.tenantId,
      subject: reviewed.reviewId,
      occurredAt: reviewed.requestedAt,
      correlationId,
      details: frozen({
        reviewId: reviewed.reviewId,
        caseId: reviewed.caseId,
        deviceId: reviewed.deviceId as string,
        action: reviewed.action,
        requestedBy: reviewed.requestedBy,
        lastSeenRecordId: reviewed.lastSeenRecordId,
        lastSeenObservedAt: reviewed.lastSeenObservedAt,
        postureFindingRefs: [...reviewed.postureFindingRefs].sort(),
        observationEvidence: reviewed.observationEvidence
          .map((ref) => ref.key)
          .sort(),
        policyGrantRef: reviewed.policyGrantRef,
        contentDigest: reviewed.contentDigest,
      }),
    }),
  );
  // The W040 gate, VERBATIM. The reviewed evidence rides as the gate's
  // §16 observation evidence set (sorted, deterministic).
  const gate: RequestDestructiveResult = requestDestructiveAction(
    scope,
    store,
    caseRecord,
    reviewed.action,
    {
      ...options,
      requestedBy: reviewed.requestedBy,
      evidence: reviewed.observationEvidence,
    },
  );
  if (!gate.ok) {
    return { ok: false, stage: "gate", error: gate.error };
  }
  return { ok: true, record: gate.record };
}
