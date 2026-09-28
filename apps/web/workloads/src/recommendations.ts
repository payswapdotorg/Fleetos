/**
 * @fleetos/web-workloads — the workload-RECOMMENDATION display surface.
 *
 * "Recommendation: workload -> capabilities -> device configuration ->
 * software -> connectivity -> lifecycle policy." —
 * `spec/ARCHITECTURE.md` § Workload Intelligence.
 *
 * This module projects the W022 per-workload recommendation ledger
 * (injected through the structural seams) into READ-ONLY display
 * view-models: the versioned recommendation records with their derived
 * status (ACTIVE / SUPERSEDED / DISMISSED — the versioned-interpretation
 * discipline, ARCHITECTURE-LOCK item 3), the fit evidence (per-dimension
 * satisfaction, deficits, hard-gate failures — all machine-stable), the
 * DRAFT intent proposals displayed as descriptors ONLY, and the
 * supersession lineages.
 *
 * The display NEVER mutates the ledger, NEVER constructs an intent, and
 * NEVER re-ranks the engine's output — the recommendation display is a
 * pure projection of the versioned records (recommendations are
 * PROPOSALS; the deterministic policy layer remains authoritative).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; every timestamp is echoed from the versioned records.
 */

import type { TenantId } from "@fleetos/contracts";
import type {
  RecommendationDismissalFacets,
  RecommendationLedgerFacets,
  WorkloadIntentProposalFacets,
  WorkloadRecommendationFacets,
} from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceDomainError, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The recommendation-display view-model schema version. */
export const RECOMMENDATION_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The derived status (the versioned-interpretation discipline)
// ---------------------------------------------------------------------------

/**
 * The derived display status of a recommendation record, computed from
 * the ledger (never stored on the record — derived, machine-stable):
 *   - ACTIVE    — the current record of its lineage, not dismissed;
 *   - SUPERSEDED — a later record in the same lineage supersedes it;
 *   - DISMISSED — an operator/policy dismissal entry cites it;
 *   - unknown   — not present in the ledger (defensive).
 */
export type RecommendationDisplayStatus = "ACTIVE" | "SUPERSEDED" | "DISMISSED" | "unknown";

// ---------------------------------------------------------------------------
// The view models
// ---------------------------------------------------------------------------

/** One constraint-failure display row (machine-stable kind + detail). */
export interface ConstraintFailureView {
  readonly kind: string;
  /** The offending values rendered as `key=value` pairs, key-sorted. */
  readonly detail: string;
}

/** The fit-evidence display (soft score + hard gate + verdict). */
export interface FitEvidenceView {
  /** The aggregate satisfaction, verbatim. */
  readonly satisfaction: number;
  /** True when the assessment met the threshold, verbatim. */
  readonly meetsThreshold: boolean;
  /** The threshold applied, verbatim. */
  readonly threshold: number;
  /** The hard-gate verdict, verbatim. */
  readonly constraintsSatisfied: boolean;
  /** The hard-gate failures, in the engine's deterministic order. */
  readonly constraintFailures: readonly ConstraintFailureView[];
  /** Dimensions where the candidate falls short (canonical order). */
  readonly deficitDimensions: readonly string[];
  /** The worst-satisfaction dimension, when one exists. */
  readonly worstDimension: string | null;
}

/** One DRAFT intent-proposal descriptor (read-only display). */
export interface IntentProposalView {
  /** The frozen intent kind string, verbatim. */
  readonly intentKind: string;
  /** The proposal's payload rendered as `key=value` pairs, key-sorted. */
  readonly payloadSummary: readonly string[];
}

/** One recommendation display row (versioned, read-only). */
export interface WorkloadRecommendationRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly recommendationId: string;
  readonly workloadId: string;
  /** The profile revision this record was derived from, verbatim. */
  readonly profileRevision: number;
  /** "device-class" | "procurement" (verbatim from the record). */
  readonly kind: string;
  readonly candidateId: string;
  readonly label: string;
  /** The derived display status (ACTIVE/SUPERSEDED/DISMISSED). */
  readonly status: RecommendationDisplayStatus;
  /** The 1-based lineage position for (workloadId, candidateId). */
  readonly recommendationVersion: number;
  /** The prior record in this lineage, when re-recommended. */
  readonly supersedes: string | null;
  readonly confidence: number;
  readonly fit: FitEvidenceView;
  /** The DRAFT intent proposals as read-only descriptors. */
  readonly proposedIntents: readonly IntentProposalView[];
  /** The engine's deterministic rationale, verbatim. */
  readonly rationale: string;
  readonly recommendedAt: string;
  readonly engineVersion: string;
  readonly modelVersion: number;
  /** The evidence observation-link count on this record. */
  readonly evidenceCount: number;
}

/** The recommendation ledger display (rows + lineage summaries). */
export interface WorkloadRecommendationDisplayView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  /** All recommendation records, ordered: recommendationVersion per
   * lineage, then candidateId (deterministic). */
  readonly rows: readonly WorkloadRecommendationRowView[];
  /** The dismissal entries (machine-stable reasons), dismissedAt order. */
  readonly dismissals: readonly RecommendationDismissalFacets[];
  /** One summary per candidate lineage, candidateId order. */
  readonly lineages: readonly RecommendationLineageView[];
}

/** One candidate lineage summary. */
export interface RecommendationLineageView {
  readonly candidateId: string;
  readonly label: string;
  /** The lineage positions present in the ledger. */
  readonly versions: readonly number[];
  /** The current (latest non-superseded, non-dismissed) record id, if any. */
  readonly currentRecommendationId: string | null;
  /** The derived lineage status (machine-stable). */
  readonly status: RecommendationDisplayStatus;
}

/** The tagged result of a display build. */
export type RecommendationDisplayResult =
  | { readonly ok: true; readonly view: WorkloadRecommendationDisplayView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Derivations (pure)
// ---------------------------------------------------------------------------

/**
 * Render a constraint failure's offending values as `key=value` pairs in
 * key-sorted order (machine-stable; skips undefined values).
 */
function renderConstraintFailureDetail(
  failure: WorkloadRecommendationFacets["fit"]["constraintCheck"]["failures"][number],
): string {
  const pairs: string[] = [];
  const entries = Object.entries(failure).filter(([key]) => key !== "kind");
  entries.sort(([a], [b]) => compareStrings(a, b));
  for (const [key, value] of entries) {
    if (value !== undefined) pairs.push(`${key}=${String(value)}`);
  }
  return pairs.join(" ");
}

/** Project the fit assessment into the display evidence. */
export function deriveFitEvidence(
  fit: WorkloadRecommendationFacets["fit"],
): FitEvidenceView {
  return frozen({
    satisfaction: fit.satisfaction,
    meetsThreshold: fit.meetsThreshold,
    threshold: fit.threshold,
    constraintsSatisfied: fit.constraintCheck.satisfied,
    constraintFailures: frozenArray(
      fit.constraintCheck.failures.map((failure) =>
        frozen({
          kind: failure.kind,
          detail: renderConstraintFailureDetail(failure),
        }),
      ),
    ),
    deficitDimensions: frozenArray([...fit.comparison.deficits]),
    worstDimension: fit.comparison.worstDimension,
  });
}

/** Render a draft intent payload as key-sorted `key=value` descriptors. */
function renderIntentPayload(
  payload: WorkloadIntentProposalFacets["payload"],
): readonly string[] {
  const pairs: string[] = [];
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  entries.sort(([a], [b]) => compareStrings(a, b));
  for (const [key, value] of entries) {
    pairs.push(`${key}=${String(value)}`);
  }
  return frozenArray(pairs);
}

/**
 * Derive the display status of one recommendation record from the full
 * ledger entry list (PURE): SUPERSEDED when any later record cites it in
 * `supersedes`; DISMISSED when a dismissal entry cites it; else ACTIVE.
 */
export function deriveRecommendationStatus(
  entries: RecommendationLedgerFacets["entries"],
  recommendationId: string,
): RecommendationDisplayStatus {
  const known = entries.some(
    (entry) => entry.kind === "recommendation" && entry.recommendation.id === recommendationId,
  );
  if (!known) return "unknown";
  const superseded = entries.some(
    (entry) =>
      entry.kind === "recommendation" &&
      entry.recommendation.supersedes === recommendationId,
  );
  if (superseded) return "SUPERSEDED";
  const dismissed = entries.some(
    (entry) => entry.kind === "dismissal" && entry.dismissal.recommendationId === recommendationId,
  );
  if (dismissed) return "DISMISSED";
  return "ACTIVE";
}

// ---------------------------------------------------------------------------
// The display builder
// ---------------------------------------------------------------------------

/**
 * Build the READ-ONLY recommendation display for one workload's ledger.
 * PURE and DETERMINISTIC: the same ledger always produces the same rows,
 * statuses, and lineages regardless of entry order effects on rendering
 * (rows sort by candidateId then recommendationVersion).
 *
 * Tenant scoping: the ledger's tenant AND every recommendation record's
 * tenant must match the acting tenant (`tenant_mismatch` refusal
 * otherwise — never a silent drop).
 *
 * @param tenantId the acting tenant
 * @param ledger the W022 per-workload recommendation ledger, injected at
 *        the binding site
 * @returns the tagged display result
 */
export function buildWorkloadRecommendationDisplay(
  tenantId: TenantId,
  ledger: RecommendationLedgerFacets | undefined,
): RecommendationDisplayResult {
  if (ledger === undefined || ledger === null || typeof ledger !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-workloads.recommendations",
        "recommendation display request is invalid",
        tenantId,
        [{ path: "/ledger", reason: "ledger_required" }],
      ),
    };
  }
  const ledgerMismatch = tenantMismatch(tenantId, ledger.tenantId, "web-workloads.recommendations");
  if (ledgerMismatch !== null) return { ok: false, error: ledgerMismatch };

  const recommendationEntries = ledger.entries.filter(
    (entry): entry is Extract<RecommendationLedgerFacets["entries"][number], { kind: "recommendation" }> =>
      entry.kind === "recommendation",
  );
  for (const entry of recommendationEntries) {
    const mismatch = tenantMismatch(
      tenantId,
      entry.recommendation.tenantId,
      "web-workloads.recommendations",
    );
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const rows: WorkloadRecommendationRowView[] = recommendationEntries.map((entry) => {
    const record = entry.recommendation;
    return frozen({
      viewVersion: RECOMMENDATION_VIEW_VERSION,
      tenantId,
      recommendationId: record.id,
      workloadId: record.workloadId,
      profileRevision: record.profileRevision,
      kind: record.kind,
      candidateId: record.candidateId,
      label: record.label,
      status: deriveRecommendationStatus(ledger.entries, record.id),
      recommendationVersion: record.recommendationVersion,
      supersedes: record.supersedes ?? null,
      confidence: record.confidence,
      fit: deriveFitEvidence(record.fit),
      proposedIntents: frozenArray(
        record.proposedIntents.map((proposal) =>
          frozen({
            intentKind: proposal.intentKind,
            payloadSummary: renderIntentPayload(proposal.payload),
          }),
        ),
      ),
      rationale: record.rationale,
      recommendedAt: record.recommendedAt,
      engineVersion: record.engineVersion,
      modelVersion: record.modelVersion,
      evidenceCount: record.evidence.length,
    });
  });
  rows.sort((a, b) => {
    const byCandidate = compareStrings(a.candidateId, b.candidateId);
    if (byCandidate !== 0) return byCandidate;
    return a.recommendationVersion - b.recommendationVersion;
  });

  // The dismissal entries, dismissedAt order (append order preserved by
  // the ledger; re-sorted by dismissedAt then recommendationId for
  // machine stability).
  const dismissals = ledger.entries
    .filter(
      (entry): entry is Extract<RecommendationLedgerFacets["entries"][number], { kind: "dismissal" }> =>
        entry.kind === "dismissal",
    )
    .map((entry) => entry.dismissal)
    .sort((a, b) => {
      const byAt = compareStrings(a.dismissedAt, b.dismissedAt);
      if (byAt !== 0) return byAt;
      return compareStrings(a.recommendationId, b.recommendationId);
    });

  // The lineage summaries, one per candidateId.
  const candidateIds = [...new Set(rows.map((row) => row.candidateId))].sort(compareStrings);
  const lineages: RecommendationLineageView[] = candidateIds.map((candidateId) => {
    const lineageRows = rows.filter((row) => row.candidateId === candidateId);
    const currentRow =
      lineageRows.find((row) => row.status === "ACTIVE") ?? null;
    const lineageStatus: RecommendationDisplayStatus = currentRow !== null
      ? "ACTIVE"
      : lineageRows.some((row) => row.status === "DISMISSED")
        ? "DISMISSED"
        : lineageRows.length > 0
          ? "SUPERSEDED"
          : "unknown";
    return frozen({
      candidateId,
      label: (lineageRows[lineageRows.length - 1] ?? { label: "" }).label,
      versions: frozenArray(lineageRows.map((row) => row.recommendationVersion)),
      currentRecommendationId: currentRow !== null ? currentRow.recommendationId : null,
      status: lineageStatus,
    });
  });

  return {
    ok: true,
    view: frozen({
      viewVersion: RECOMMENDATION_VIEW_VERSION,
      tenantId,
      workloadId: ledger.workloadId,
      rows: frozenArray(rows),
      dismissals: frozenArray(dismissals),
      lineages: frozenArray(lineages),
    }),
  };
}

/**
 * Select ONE recommendation's display row by id (read-only lookup).
 * Returns the row or the machine-stable `unknown_recommendation`
 * DomainError — never a guess, never a partial row.
 */
export function selectRecommendationRow(
  view: WorkloadRecommendationDisplayView,
  recommendationId: string,
): { readonly ok: true; readonly row: WorkloadRecommendationRowView } | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError } {
  const row = view.rows.find((candidate) => candidate.recommendationId === recommendationId);
  if (row === undefined) {
    return {
      ok: false,
      error: makeSurfaceDomainError(
        "web-workloads.recommendations",
        "unknown_recommendation",
        "recommendation id is not present in the display view",
        view.tenantId,
      ),
    };
  }
  return { ok: true, row };
}
