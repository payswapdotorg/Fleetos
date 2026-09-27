/**
 * @fleetos/workloads — D3: versioned WorkloadRecommendation contracts.
 *
 * "Recommendation: workload -> capabilities -> device configuration ->
 * software -> connectivity -> lifecycle policy." —
 * `spec/ARCHITECTURE.md` § Workload Intelligence.
 *
 * Everything this module produces is a PROPOSAL:
 *   - A `WorkloadRecommendation` is a versioned interpretation — a
 *     device-class or procurement-oriented candidate derived
 *     deterministically from a profile's requirement vector, with fit
 *     evidence, confidence, and DRAFT Fleet Intent payloads.
 *   - A draft `WorkloadIntentProposal` carries ONLY an intent kind + the
 *     frozen payload shape (`ProcurementIntentPayload` /
 *     `SoftwareSubscriptionIntentPayload` from `@fleetos/contracts`): no
 *     intent id, no lifecycle state, no dispatch. Creating, authorizing,
 *     or executing a Fleet Intent belongs to the intent owners and the
 *     deterministic policy layer (W031's Contract Guardian boundary) —
 *     NEVER to this engine. Recommendations are never automatic.
 *
 * Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md`
 * item 3): recommendations are recorded in an append-only per-workload
 * ledger. Re-recommendation appends NEW records (recommendationVersion =
 * prior + 1, `supersedes` pointing at the prior record); dismissal
 * appends a dismissal entry. An existing record is NEVER rewritten.
 *
 * Audit: every consequential proposal and dismissal is emitted to an
 * INJECTED sink (W012's seam pattern; see `audit-seam.ts`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import {
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
} from "@fleetos/contracts";
import type {
  ProcurementIntentPayload,
  SoftwareSubscriptionIntentPayload,
} from "@fleetos/contracts";
import type { WorkloadProfile } from "./profile";
import type { CandidateCapabilities, ConstraintFailure, FitAssessment } from "./constraints";
import { assessFit } from "./constraints";
import type { WorkloadAuditRecord, WorkloadAuditSink } from "./audit-seam";
import { NOOP_WORKLOAD_AUDIT_SINK, WORKLOAD_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The recommendation model version. Bumped when the ranking rule, the
 * confidence formula, the intent-linkage policy, or the rationale
 * template changes. Recorded on every recommendation; a new version
 * never rewrites old records.
 */
export const RECOMMENDATION_MODEL_VERSION = 1 as const;

/** The engine identity recorded on every interpretation it produces. */
export const RECOMMENDATION_ENGINE_VERSION = "workload-recommendations/1" as const;

/**
 * The confidence cap. A recommendation is never certain: 0.99 encodes
 * "very strong fit, still an interpretation" (reality is observations).
 */
export const MAX_RECOMMENDATION_CONFIDENCE = 0.99;

/** The default satisfaction threshold a candidate must meet. */
export const DEFAULT_FIT_THRESHOLD = 0.75;

/** The default maximum number of recommendations per run. */
export const DEFAULT_MAX_RECOMMENDATIONS = 3;

// ---------------------------------------------------------------------------
// Fleet Intent proposals (linked to the frozen contracts intent kinds)
// ---------------------------------------------------------------------------

/**
 * A DRAFT Fleet Intent proposal. The discriminated union mirrors the
 * payload interfaces of the intent kinds the workloads engine may
 * propose. The payload carries NO intent id and NO lifecycle state —
 * turning a proposal into a durable Fleet Intent is the PLAN/AUTHORIZE
 * stage's job, under the deterministic policy layer (W031).
 */
export type WorkloadIntentProposal =
  | {
      readonly intentKind: typeof PROCUREMENT_INTENT_KIND;
      readonly payload: ProcurementIntentPayload;
    }
  | {
      readonly intentKind: typeof SOFTWARE_SUBSCRIPTION_INTENT_KIND;
      readonly payload: SoftwareSubscriptionIntentPayload;
    };

/** The intent kinds the workloads engine may propose (closed set, documented). */
export const PROPOSABLE_INTENT_KINDS: readonly (WorkloadIntentProposal["intentKind"])[] = Object.freeze([
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
]);

// ---------------------------------------------------------------------------
// The recommendation record
// ---------------------------------------------------------------------------

/**
 * What the recommendation proposes:
 *   - "device-class" — advisory standardization on a device class the
 *     tenant already fields (no procurement intent);
 *   - "procurement"  — procurement-oriented: the candidate declares
 *     `procurementRequired` (buy new hardware) and the recommendation
 *     carries a ProcurementIntent draft.
 */
export type WorkloadRecommendationKind = "device-class" | "procurement";

/**
 * A versioned workload recommendation: a PROPOSAL derived
 * deterministically from a profile's requirement vector. Frozen;
 * supersession is recorded on the NEW record, never by editing this one.
 */
export interface WorkloadRecommendation {
  /** Deterministic id: `rec_` + fnv1a32 of the identity tuple. */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly workloadId: WorkloadId;
  /** The profile revision this recommendation was derived from. */
  readonly profileRevision: number;
  readonly kind: WorkloadRecommendationKind;
  /** The recommended candidate (device class / procurement offering). */
  readonly candidateId: string;
  readonly label: string;
  /** The deterministic fit assessment (score + per-dimension evidence). */
  readonly fit: FitAssessment;
  /** Confidence in [0, 0.99]: fit satisfaction x profile vector confidence. */
  readonly confidence: number;
  /** Evidence links carried from the profile revision. */
  readonly evidence: readonly WorkloadProfile["evidence"][number][];
  /** Draft Fleet Intent payloads (kind + payload, NO intent id). */
  readonly proposedIntents: readonly WorkloadIntentProposal[];
  /** Deterministic rationale (see buildRationale). */
  readonly rationale: string;
  /** 1-based lineage position for (workloadId, candidateId). */
  readonly recommendationVersion: number;
  /** The prior recommendation in this lineage, when re-recommending. */
  readonly supersedes?: string;
  /** Injected proposal timestamp. */
  readonly recommendedAt: string;
  readonly engineVersion: string;
  readonly modelVersion: number;
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// The append-only recommendation ledger
// ---------------------------------------------------------------------------

/** A recorded dismissal of a recommendation (operator/policy judgment). */
export interface RecommendationDismissal {
  /** The dismissed recommendation. */
  readonly recommendationId: string;
  /** Machine-stable dismissal reason (e.g. "operator_rejected", "stale_fit"). */
  readonly reason: string;
  /** Injected dismissal timestamp. */
  readonly dismissedAt: string;
  readonly correlationId: CorrelationId;
  /** Free-form context (JSON-serializable). */
  readonly note?: string;
}

/** One append-only ledger entry. */
export type RecommendationLedgerEntry =
  | { readonly kind: "recommendation"; readonly recommendation: WorkloadRecommendation }
  | { readonly kind: "dismissal"; readonly dismissal: RecommendationDismissal };

/**
 * The per-workload interpretation ledger: an append-only journal of every
 * recommendation and dismissal. Entries are never removed, reordered, or
 * rewritten; ledger operations return NEW ledgers.
 */
export interface WorkloadRecommendationLedger {
  readonly tenantId: TenantId;
  readonly workloadId: WorkloadId;
  readonly entries: readonly RecommendationLedgerEntry[];
}

/** Create an empty ledger for one workload. */
export function createRecommendationLedger(
  tenantId: TenantId,
  workloadId: WorkloadId,
): WorkloadRecommendationLedger {
  return frozen({ tenantId, workloadId, entries: frozenArray([]) });
}

/** The derived status of a recommendation record. */
export type RecommendationStatus = "ACTIVE" | "SUPERSEDED" | "DISMISSED" | "unknown";

/**
 * Append a recommendation to a ledger. Returns a NEW ledger; the input is
 * untouched. Rejects scope mismatches (tenant/workload) and duplicate ids
 * with DomainErrors.
 */
export function appendRecommendation(
  ledger: WorkloadRecommendationLedger,
  recommendation: WorkloadRecommendation,
):
  | { ok: true; ledger: WorkloadRecommendationLedger }
  | { ok: false; error: ReturnType<typeof makeDomainError> } {
  if (
    recommendation.tenantId !== ledger.tenantId ||
    recommendation.workloadId !== ledger.workloadId
  ) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.recommendationTenantMismatch,
        "ledger entry does not match the ledger scope",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "workloads.recommendation",
        "ledger_scope_mismatch",
      ),
    };
  }
  if (
    ledger.entries.some(
      (e) => e.kind === "recommendation" && e.recommendation.id === recommendation.id,
    )
  ) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.recommendationInvalid,
        "recommendation id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "workloads.recommendation",
        "duplicate_recommendation_id",
      ),
    };
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([
        ...ledger.entries,
        frozen({ kind: "recommendation" as const, recommendation }),
      ]),
    }),
  };
}

/** Options for `dismissRecommendation`. */
export interface DismissRecommendationOptions {
  readonly at: string;
  readonly reason: string;
  readonly correlationId: CorrelationId;
  readonly note?: string;
  /** Audit sink (default: no-op). A dismissal is a consequential interpretation. */
  readonly auditSink?: WorkloadAuditSink;
}

/**
 * Dismiss a recommendation: appends a dismissal entry (a NEW ledger;
 * nothing is rewritten) and emits `workloads.recommendation.dismissed`
 * to the sink. Dismissing a SUPERSEDED or already-DISMISSED record is a
 * DomainError — the journal stays clean.
 */
export function dismissRecommendation(
  ledger: WorkloadRecommendationLedger,
  recommendationId: string,
  options: DismissRecommendationOptions,
):
  | { ok: true; ledger: WorkloadRecommendationLedger; dismissal: RecommendationDismissal }
  | {
      ok: false;
      error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError>;
    } {
  const failures: { path: string; reason: string }[] = [];
  if (typeof recommendationId !== "string" || recommendationId.length === 0) {
    failures.push({ path: "/recommendationId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.reason !== "string" || options.reason.length === 0) {
    failures.push({ path: "/reason", reason: "required" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.recommendationInvalid,
        "dismissal request is invalid",
        {
          tenantId: ledger.tenantId,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const status = recommendationStatus(ledger, recommendationId);
  if (status === "unknown") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.recommendationInvalid,
        "recommendation not found in the ledger",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "workloads.recommendation",
        "recommendation_unknown",
      ),
    };
  }
  if (status === "SUPERSEDED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.recommendationInvalid,
        "recommendation is already superseded; dismiss the active interpretation instead",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "workloads.recommendation",
        "already_superseded",
      ),
    };
  }
  if (status === "DISMISSED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.recommendationInvalid,
        "recommendation is already dismissed",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "workloads.recommendation",
        "already_dismissed",
      ),
    };
  }

  const dismissal: RecommendationDismissal = frozen({
    recommendationId,
    reason: options.reason,
    dismissedAt: options.at,
    correlationId: options.correlationId,
    note: options.note,
  });
  const next: WorkloadRecommendationLedger = frozen({
    ...ledger,
    entries: frozenArray([...ledger.entries, frozen({ kind: "dismissal" as const, dismissal })]),
  });

  const recommendation = ledger.entries
    .filter((e): e is Extract<RecommendationLedgerEntry, { kind: "recommendation" }> => e.kind === "recommendation")
    .map((e) => e.recommendation)
    .find((r) => r.id === recommendationId)!;

  (options.auditSink ?? NOOP_WORKLOAD_AUDIT_SINK).append(
    frozen({
      action: WORKLOAD_AUDIT_ACTIONS.recommendationDismissed,
      tenantId: ledger.tenantId,
      subject: ledger.workloadId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        recommendationId,
        candidateId: recommendation.candidateId,
        reason: options.reason,
        note: options.note ?? null,
        engineVersion: RECOMMENDATION_ENGINE_VERSION,
      },
    } satisfies WorkloadAuditRecord),
  );

  return { ok: true, ledger: next, dismissal };
}

/**
 * The derived status of a recommendation: ACTIVE (current
 * interpretation of its candidate lineage), SUPERSEDED (a later
 * recommendation in the same lineage follows it), DISMISSED (a dismissal
 * entry targets it), or "unknown" (not in the ledger).
 */
export function recommendationStatus(
  ledger: WorkloadRecommendationLedger,
  recommendationId: string,
): RecommendationStatus {
  const known = ledger.entries.some(
    (e) => e.kind === "recommendation" && e.recommendation.id === recommendationId,
  );
  if (!known) return "unknown";
  const superseded = ledger.entries.some(
    (e) => e.kind === "recommendation" && e.recommendation.supersedes === recommendationId,
  );
  if (superseded) return "SUPERSEDED";
  const dismissed = ledger.entries.some(
    (e) => e.kind === "dismissal" && e.dismissal.recommendationId === recommendationId,
  );
  if (dismissed) return "DISMISSED";
  return "ACTIVE";
}

/** The resolved ACTIVE recommendations of a ledger, candidate order. */
export function resolveActiveRecommendations(
  ledger: WorkloadRecommendationLedger,
): readonly WorkloadRecommendation[] {
  const recommendations: WorkloadRecommendation[] = [];
  for (const entry of ledger.entries) {
    if (entry.kind === "recommendation") recommendations.push(entry.recommendation);
  }
  return frozenArray(
    recommendations
      .filter((r) => recommendationStatus(ledger, r.id) === "ACTIVE")
      .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0)),
  );
}

// ---------------------------------------------------------------------------
// The recommendation engine
// ---------------------------------------------------------------------------

/** Options for `recommendForProfile`. */
export interface RecommendOptions {
  /** Injected proposal timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph (also stamped on audit records). */
  readonly correlationId: CorrelationId;
  /** Prior ledger entries (for lineage versioning + supersedes links). */
  readonly history?: readonly RecommendationLedgerEntry[];
  /** Maximum recommendations per run (default 3). */
  readonly maxRecommendations?: number;
  /** Satisfaction threshold in [0, 1) (default 0.75). */
  readonly fitThreshold?: number;
  /** Audit sink (default: no-op). Proposals are consequential interpretations. */
  readonly auditSink?: WorkloadAuditSink;
}

/**
 * A candidate that did NOT produce a recommendation, with the machine-
 * stable reasons. Rejections are evidence for later waves (e.g. W032
 * procurement matching).
 */
export interface CandidateRejection {
  readonly candidateId: string;
  readonly constraintFailures: readonly ConstraintFailure[];
  /** The vector satisfaction (unthresholded — evidence, not a verdict). */
  readonly satisfaction: number;
  readonly meetsThreshold: boolean;
}

/** The result of a recommendation run (tagged union; never throws). */
export type RecommendResult =
  | {
      readonly ok: true;
      /** Satisfiable candidates, ranked: satisfaction desc, candidateId asc. */
      readonly recommendations: readonly WorkloadRecommendation[];
      /** Rejected candidates, candidateId order. */
      readonly rejected: readonly CandidateRejection[];
      readonly engineVersion: string;
    }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError };

/**
 * Recommend candidates for a workload profile: assess every injected
 * candidate's fit (hard constraints + vector satisfaction), rank the
 * satisfiable ones (satisfaction desc, candidateId asc), and emit at most
 * `maxRecommendations` versioned PROPOSALS. Deterministic: the same
 * profile + candidates + options always produce the same records (same
 * ids, same order) regardless of candidate input order.
 *
 * PROPOSALS ONLY — this function never creates a Fleet Intent, never
 * mutates the ledger (callers append via `appendRecommendation`), and
 * never performs an action. The deterministic policy layer (W031) stays
 * authoritative.
 *
 * @param profile the workload profile (the requirement source)
 * @param candidates the injected candidate capabilities (any order)
 * @param options the run options
 * @returns the tagged recommendation result
 */
export function recommendForProfile(
  profile: WorkloadProfile,
  candidates: readonly CandidateCapabilities[],
  options: RecommendOptions,
): RecommendResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (typeof profile?.tenantId !== "string" || profile.tenantId.length === 0) {
    failures.push({ path: "/profile/tenantId", reason: "required" });
  }
  if (typeof profile?.workloadId !== "string" || profile.workloadId.length === 0) {
    failures.push({ path: "/profile/workloadId", reason: "required" });
  }
  if (!Array.isArray(candidates)) {
    failures.push({ path: "/candidates", reason: "required" });
  }
  const maxRecommendations = options?.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;
  if (
    typeof maxRecommendations !== "number" ||
    !Number.isInteger(maxRecommendations) ||
    maxRecommendations < 1
  ) {
    failures.push({ path: "/maxRecommendations", reason: "must_be_positive_integer" });
  }
  const fitThreshold = options?.fitThreshold ?? DEFAULT_FIT_THRESHOLD;
  if (typeof fitThreshold !== "number" || !Number.isFinite(fitThreshold) || fitThreshold < 0 || fitThreshold >= 1) {
    failures.push({ path: "/fitThreshold", reason: "must_be_in_0_1_exclusive" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.recommendationInvalid,
        "recommendation request is invalid",
        {
          tenantId: profile?.tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Candidate structural validation (injected inputs are untrusted).
  const checked: { candidate: CandidateCapabilities; fit: FitAssessment }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (
      candidate === undefined ||
      typeof candidate.candidateId !== "string" ||
      candidate.candidateId.length === 0 ||
      typeof candidate.vector !== "object" ||
      candidate.vector === null
    ) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.recommendationInvalid,
          "recommendation request is invalid",
          { tenantId: profile.tenantId, correlationId: options.correlationId },
          [{ path: `/candidates/${i}`, reason: "invalid_candidate" }],
        ),
      };
    }
    const fit = assessFit(profile.requirements, profile.constraints, candidate, fitThreshold);
    checked.push({ candidate, fit });
  }

  // Rank: satisfiable candidates by satisfaction desc, candidateId asc.
  const satisfiable = checked
    .filter((entry) => entry.fit.meetsThreshold)
    .sort((a, b) => {
      if (b.fit.satisfaction !== a.fit.satisfaction) return b.fit.satisfaction - a.fit.satisfaction;
      return a.candidate.candidateId < b.candidate.candidateId
        ? -1
        : a.candidate.candidateId > b.candidate.candidateId
          ? 1
          : 0;
    })
    .slice(0, maxRecommendations);

  const rejected: CandidateRejection[] = checked
    .filter((entry) => !entry.fit.meetsThreshold)
    .map((entry) =>
      frozen({
        candidateId: entry.candidate.candidateId,
        constraintFailures: entry.fit.constraintCheck.failures,
        satisfaction: entry.fit.satisfaction,
        meetsThreshold: false,
      } satisfies CandidateRejection),
    )
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));

  const history = options.history ?? [];
  const sink = options.auditSink ?? NOOP_WORKLOAD_AUDIT_SINK;
  const recommendations: WorkloadRecommendation[] = [];

  for (const { candidate, fit } of satisfiable) {
    const recommendationVersion = nextVersionForCandidate(history, profile.workloadId, candidate.candidateId);
    const priorId = latestRecommendationIdForCandidate(history, profile.workloadId, candidate.candidateId);
    const confidence = Math.min(
      MAX_RECOMMENDATION_CONFIDENCE,
      fit.satisfaction * profile.requirements.confidence,
    );
    const recommendation: WorkloadRecommendation = frozen({
      id: `rec_${fnv1a32Hex(
        canonicalJson({
          tenantId: profile.tenantId as string,
          workloadId: profile.workloadId as string,
          candidateId: candidate.candidateId,
          recommendationVersion,
        }),
      )}`,
      tenantId: profile.tenantId,
      workloadId: profile.workloadId,
      profileRevision: profile.revision,
      kind: candidate.procurementRequired === true ? "procurement" : "device-class",
      candidateId: candidate.candidateId,
      label: candidate.label,
      fit,
      confidence,
      evidence: frozenArray(profile.evidence),
      proposedIntents: buildIntentProposals(profile, candidate),
      rationale: buildRationale(profile, candidate, fit),
      recommendationVersion,
      ...(priorId !== undefined ? { supersedes: priorId } : {}),
      recommendedAt: options.at,
      engineVersion: RECOMMENDATION_ENGINE_VERSION,
      modelVersion: RECOMMENDATION_MODEL_VERSION,
      schemaVersion: 1,
    });
    recommendations.push(recommendation);
  }

  // Audit emission: one record per consequential proposal. Records are
  // deterministic functions of the inputs; the sink contract requires
  // append-only durability.
  for (const recommendation of recommendations) {
    sink.append(
      frozen({
        action: WORKLOAD_AUDIT_ACTIONS.recommendationProposed,
        tenantId: profile.tenantId,
        subject: profile.workloadId,
        occurredAt: options.at,
        correlationId: options.correlationId,
        details: {
          recommendationId: recommendation.id,
          candidateId: recommendation.candidateId,
          kind: recommendation.kind,
          satisfaction: recommendation.fit.satisfaction,
          confidence: recommendation.confidence,
          profileRevision: recommendation.profileRevision,
          recommendationVersion: recommendation.recommendationVersion,
          supersedes: recommendation.supersedes ?? null,
          proposedIntentKinds: recommendation.proposedIntents.map((p) => p.intentKind),
          engineVersion: RECOMMENDATION_ENGINE_VERSION,
        },
      } satisfies WorkloadAuditRecord),
    );
  }

  return frozen({
    ok: true as const,
    recommendations: frozenArray(recommendations),
    rejected: frozenArray(rejected),
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Engine helpers (pure)
// ---------------------------------------------------------------------------

function nextVersionForCandidate(
  history: readonly RecommendationLedgerEntry[],
  workloadId: WorkloadId,
  candidateId: string,
): number {
  let max = 0;
  for (const entry of history) {
    if (
      entry.kind === "recommendation" &&
      entry.recommendation.workloadId === workloadId &&
      entry.recommendation.candidateId === candidateId
    ) {
      max = Math.max(max, entry.recommendation.recommendationVersion);
    }
  }
  return max + 1;
}

function latestRecommendationIdForCandidate(
  history: readonly RecommendationLedgerEntry[],
  workloadId: WorkloadId,
  candidateId: string,
): string | undefined {
  let latest: { id: string; version: number } | undefined;
  for (const entry of history) {
    if (
      entry.kind === "recommendation" &&
      entry.recommendation.workloadId === workloadId &&
      entry.recommendation.candidateId === candidateId
    ) {
      if (latest === undefined || entry.recommendation.recommendationVersion > latest.version) {
        latest = { id: entry.recommendation.id, version: entry.recommendation.recommendationVersion };
      }
    }
  }
  return latest?.id;
}

/**
 * Build the draft Fleet Intent payloads for one recommendation
 * (deterministic policy, documented):
 *   - the candidate declares `procurementRequired` -> one
 *     ProcurementIntent draft naming the workload and the candidate;
 *   - every required application the candidate lists with
 *     `subscriptionRequired: true` -> one SoftwareSubscriptionIntent
 *     draft (softwareId = appId, seatCount = 1 — one seat for this
 *     workload's principal).
 * Drafts carry NO intent id and NO lifecycle state.
 */
function buildIntentProposals(
  profile: WorkloadProfile,
  candidate: CandidateCapabilities,
): readonly WorkloadIntentProposal[] {
  const proposals: WorkloadIntentProposal[] = [];
  if (candidate.procurementRequired === true) {
    proposals.push(
      frozen({
        intentKind: PROCUREMENT_INTENT_KIND,
        payload: frozen({
          workloadId: profile.workloadId as string,
          description: `Procure ${candidate.label} (${candidate.candidateId}) for workload ${profile.name} (${profile.workloadId}).`,
        } satisfies ProcurementIntentPayload),
      }),
    );
  }
  const requiredApps = profile.constraints.requiredApplications ?? [];
  const availableApps = candidate.availableApplications ?? [];
  for (const required of requiredApps) {
    const available = availableApps.find((a) => a.appId === required.appId);
    if (available !== undefined && available.subscriptionRequired === true) {
      proposals.push(
        frozen({
          intentKind: SOFTWARE_SUBSCRIPTION_INTENT_KIND,
          payload: frozen({
            softwareId: available.appId,
            seatCount: 1,
          } satisfies SoftwareSubscriptionIntentPayload),
        }),
      );
    }
  }
  return frozenArray(proposals);
}

/** Deterministic rationale text (evidence summary). */
function buildRationale(
  profile: WorkloadProfile,
  candidate: CandidateCapabilities,
  fit: FitAssessment,
): string {
  const worst = fit.comparison.worstDimension;
  const worstText =
    worst === null
      ? "all dimensions satisfied"
      : `weakest dimension ${worst} at ${round3(fit.comparison.dimensions.find((d) => d.dimension === worst)?.satisfaction ?? 0)} satisfaction`;
  return (
    `Workload ${profile.name} fits ${candidate.label}: vector satisfaction ` +
    `${round3(fit.satisfaction)} (threshold ${round3(fit.threshold)}), ` +
    `${fit.constraintCheck.failures.length} constraint failures, ${worstText}; ` +
    `derived from profile revision ${profile.revision} ` +
    `(requirement confidence ${round3(profile.requirements.confidence)}).`
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
