/**
 * @fleetos/web-workloads — the COMPOSITE workload journey view-model
 * (W090C D3): workload plan recommendation -> software need ->
 * procurement request/quote -> VERIFIED connectivity.
 *
 * The UX-journey simulation's 🟡 finding (Journey 5): the workload ->
 * commerce graph currently hides Software and Vendors inside Commerce,
 * and the built-in descriptor ends in Communication — not the VERIFIED
 * connectivity outcome. This module closes that gap as a PURE,
 * DETERMINISTIC, versioned view-model:
 *
 *   - ONE frozen stage list in canonical order (machine-stable ids);
 *   - every stage derives its own state from the INJECTED domain
 *     records through the established seams (nothing invented): the
 *     W022 recommendation ledger, the W032 software subscription, the
 *     W032 procurement demand + quote acceptance, the W050A
 *     connectivity submission and the adopted connectivity record;
 *   - the terminal `connectivity-verified` stage is DONE only when
 *     the adopted record's latest revision is ACTIVE, carries
 *     measurements, and has no failure — the VERIFIED outcome, with
 *     its evidence visible (measurement kinds + the digest chain);
 *   - the navigation machine (`reduceJourneyNavState`) is PURE with
 *     machine-stable `illegal_event` refusals — the shell/test drives
 *     it with events; React only renders (LOCK 19).
 *
 * The commerce-stage inputs arrive as MINIMAL facets declared here
 * (the W040-disclosed pattern — each surface package declares the
 * minimum it displays; the real records are assignable by structural
 * typing and injected at the binding site, proven by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; every timestamp is echoed from the domain records.
 */

import type { TenantId } from "@fleetos/contracts";
import type {
  ConnectivityResourceFacets,
  RecommendationLedgerFacets,
  SoftwareResourceFacets,
  WorkloadProfileFacets,
} from "./seams";
import type { WorkloadResourceLinkageStatus } from "./resources";
import { frozen, frozenArray, makeSurfaceDomainError, makeSurfaceValidationError, tenantMismatch, SURFACE_SYSTEM_TENANT_ID } from "./internal";
import { deriveRecommendationStatus } from "./recommendations";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The composite journey view-model schema version. */
export const WORKLOAD_JOURNEY_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The commerce-stage facets (locally declared — the W040 pattern)
// ---------------------------------------------------------------------------

/**
 * The procurement-request facet — the W032 `ProcurementDemand` is
 * ASSIGNABLE to this shape at the binding site (the minimum the
 * journey stage displays).
 */
export interface JourneyDemandFacets {
  readonly demandId: string;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  readonly description: string;
  readonly deadline: string;
}

/**
 * The procurement-quote facet — the W032 `Quote` plus its LEDGER-derived
 * acceptance state (the acceptance entry is the machine-stable record
 * of the proposal-gated transition; the binding site supplies it).
 */
export interface JourneyQuoteFacets {
  readonly quoteId: string;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly vendorId: string;
  /** The quote lifecycle status, verbatim (DRAFT/ISSUED/...). */
  readonly status: string;
  /** True when the ledger records an acceptance entry for this quote. */
  readonly accepted: boolean;
  /** The acceptance instant, when accepted. */
  readonly acceptedAt: string | null;
}

/**
 * The adopted-connectivity verification facet — the W050A
 * `ConnectivityRecord` reduced to the verification evidence the
 * terminal stage displays (latest revision only). The seam EXCLUDES
 * the provider handle (LOCK 6-8).
 */
export interface JourneyConnectivityVerificationFacets {
  readonly tenantId: TenantId;
  readonly connectivityId: string;
  /** The latest revision's NORMALIZED execution state, verbatim. */
  readonly executionState: string;
  /** True when the latest revision carries a failure (kind != "none"). */
  readonly failed: boolean;
  /** True when the latest revision is degraded (kind != "none"). */
  readonly degraded: boolean;
  /** The latest revision's measurement kinds (sorted, machine-stable). */
  readonly measurementKinds: readonly string[];
  /** The latest revision's content digest (the chain evidence). */
  readonly latestContentDigest: string;
}

/** The composite journey's injected source records (all optional after the profile). */
export interface WorkloadProcurementJourneySource {
  readonly profile: WorkloadProfileFacets;
  readonly ledger: RecommendationLedgerFacets;
  /** The allocated software subscription (the satisfied need), when present. */
  readonly subscription: SoftwareResourceFacets | null;
  /** The procurement demand (the request stage), when present. */
  readonly demand: JourneyDemandFacets | null;
  /** The quote + acceptance (the quote stage), when present. */
  readonly quote: JourneyQuoteFacets | null;
  /** The W050A connectivity submission (the request stage), when present. */
  readonly submission: ConnectivityResourceFacets | null;
  /** The adopted connectivity record's verification summary, when present. */
  readonly verification: JourneyConnectivityVerificationFacets | null;
}

// ---------------------------------------------------------------------------
// The stage vocabulary (machine-stable, frozen)
// ---------------------------------------------------------------------------

/** The canonical stage ids in journey order. */
export const JOURNEY_STAGE_IDS = [
  "workload-plan",
  "software-need",
  "procurement-request",
  "procurement-quote",
  "connectivity-request",
  "connectivity-verified",
] as const;

/** One journey stage id (machine-stable). */
export type JourneyStageId = (typeof JOURNEY_STAGE_IDS)[number];

/**
 * The shell route target of each stage (the W091 route vocabulary:
 * workloads.planning / commerce.software / commerce.procurement /
 * commerce.connectivity). Machine-stable — the shell navigates by it.
 */
export const JOURNEY_STAGE_ROUTES: Readonly<
  Record<JourneyStageId, { readonly area: "workloads" | "commerce"; readonly view: string }>
> = Object.freeze({
  "workload-plan": { area: "workloads", view: "planning" },
  "software-need": { area: "commerce", view: "software" },
  "procurement-request": { area: "commerce", view: "procurement" },
  "procurement-quote": { area: "commerce", view: "procurement" },
  "connectivity-request": { area: "commerce", view: "connectivity" },
  "connectivity-verified": { area: "commerce", view: "connectivity" },
});

// ---------------------------------------------------------------------------
// The view models
// ---------------------------------------------------------------------------

/** One journey stage display row (the rail every stage screen renders). */
export interface JourneyRailStageView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  /** The machine-stable stage id. */
  readonly stageId: JourneyStageId;
  /** The operator-facing stage title. */
  readonly title: string;
  /** The derived stage state (done/current/pending/approval/blocked). */
  readonly state: "done" | "current" | "pending" | "approval" | "blocked";
  /** The machine-stable one-line summary (record id + key fact). */
  readonly summary: string;
  /** The domain record backing the stage, when one exists. */
  readonly recordRef: string | null;
  /** The machine-stable evidence refs visible on the stage. */
  readonly evidenceRefs: readonly string[];
  /** The shell route the stage navigates to. */
  readonly route: { readonly area: "workloads" | "commerce"; readonly view: string };
}

/** The composite journey view (the rail + the terminal verification). */
export interface WorkloadProcurementJourneyView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  /** The stages in canonical journey order. */
  readonly stages: readonly JourneyRailStageView[];
  /** The current (first not-done) stage id, when one exists. */
  readonly currentStageId: JourneyStageId | null;
  /** True when the terminal VERIFIED connectivity outcome is reached. */
  readonly verified: boolean;
  /** The verification evidence summary, when verified. */
  readonly verificationSummary: string | null;
}

/** The tagged result of a journey build. */
export type WorkloadJourneyResult =
  | { readonly ok: true; readonly view: WorkloadProcurementJourneyView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// Stage derivations (pure)
// ---------------------------------------------------------------------------

/**
 * Derive the VERIFIED connectivity predicate (PURE): the adopted
 * record's latest revision is ACTIVE, carries measurements, and has
 * no failure. Degraded-but-measured connectivity is verified AND
 * flagged (the degradation stays visible — never hidden).
 */
export function deriveConnectivityVerification(
  verification: JourneyConnectivityVerificationFacets,
): boolean {
  return (
    verification.executionState === "ACTIVE" &&
    verification.measurementKinds.length > 0 &&
    !verification.failed
  );
}

/** Find the workload's CURRENT (ACTIVE) recommendation record, if any. */
function findActiveRecommendation(ledger: RecommendationLedgerFacets): {
  readonly id: string;
  readonly candidateId: string;
  readonly label: string;
  readonly rationale: string;
  readonly proposedIntentCount: number;
  readonly recommendationVersion: number;
  readonly evidenceCount: number;
} | null {
  const recommendations = ledger.entries
    .filter((entry) => entry.kind === "recommendation")
    .map((entry) => entry.recommendation);
  const active = recommendations.find(
    (record) => deriveRecommendationStatus(ledger.entries, record.id) === "ACTIVE",
  );
  if (active === undefined) return null;
  return {
    id: active.id,
    candidateId: active.candidateId,
    label: active.label,
    rationale: active.rationale,
    proposedIntentCount: active.proposedIntents.length,
    recommendationVersion: active.recommendationVersion,
    evidenceCount: active.evidence.length,
  };
}

/** The software-need evidence: the subscription's seat/term facts. */
function softwareNeedSummary(subscription: SoftwareResourceFacets): string {
  return `Subscription ${subscription.subscriptionId} allocated: ${subscription.softwareId}, ${subscription.seatCount} seat${subscription.seatCount === 1 ? "" : "s"}, ${subscription.termDays}-day term.`;
}

// ---------------------------------------------------------------------------
// The journey builder
// ---------------------------------------------------------------------------

/**
 * Build the composite workload -> software -> procurement ->
 * VERIFIED-connectivity journey view. PURE and DETERMINISTIC: the
 * same injected source records always produce the same stages in the
 * same canonical order. Stage states derive ONLY from the records
 * (done = the stage's evidence record exists; approval = a PARKED
 * submission; blocked = a REJECTED submission or quote; the current
 * stage is the first non-done stage).
 *
 * Tenant scoping: every record's tenant scope must match the acting
 * tenant (`tenant_mismatch` refusal otherwise — LOCK 17).
 *
 * @param tenantId the acting tenant
 * @param source the journey's injected domain records
 * @returns the tagged journey view result
 */
export function buildWorkloadProcurementJourneyView(
  tenantId: TenantId,
  source: WorkloadProcurementJourneySource,
): WorkloadJourneyResult {
  if (source === null || typeof source !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-workloads.journey",
        "journey request is invalid",
        tenantId,
        [{ path: "/source", reason: "source_required" }],
      ),
    };
  }
  const profileMismatch = tenantMismatch(tenantId, source.profile?.tenantId, "web-workloads.journey");
  if (profileMismatch !== null) return { ok: false, error: profileMismatch };
  const ledgerMismatch = tenantMismatch(tenantId, source.ledger?.tenantId, "web-workloads.journey");
  if (ledgerMismatch !== null) return { ok: false, error: ledgerMismatch };
  const subscriptionMismatch = tenantMismatch(
    tenantId,
    source.subscription?.tenantId,
    "web-workloads.journey",
  );
  if (subscriptionMismatch !== null) return { ok: false, error: subscriptionMismatch };
  const demandMismatch = tenantMismatch(tenantId, source.demand?.tenantId, "web-workloads.journey");
  if (demandMismatch !== null) return { ok: false, error: demandMismatch };
  const quoteMismatch = tenantMismatch(tenantId, source.quote?.tenantId, "web-workloads.journey");
  if (quoteMismatch !== null) return { ok: false, error: quoteMismatch };
  const submissionMismatch = tenantMismatch(
    tenantId,
    source.submission?.tenantId,
    "web-workloads.journey",
  );
  if (submissionMismatch !== null) return { ok: false, error: submissionMismatch };
  const verificationMismatch = tenantMismatch(
    tenantId,
    source.verification?.tenantId,
    "web-workloads.journey",
  );
  if (verificationMismatch !== null) return { ok: false, error: verificationMismatch };

  const workloadId = source.profile.workloadId;
  const active = findActiveRecommendation(source.ledger);

  // --- Stage 1: the workload plan recommendation (the journey's origin) ---
  const planDone = active !== null && active.proposedIntentCount > 0;
  const planEvidence =
    active !== null
      ? frozenArray([
          `recommendation:${active.id}`,
          `profileRevision:${String(source.profile.revision)}`,
          `evidenceLinks:${String(active.evidenceCount)}`,
        ])
      : frozenArray([]);

  // --- Stage 2: the software need (the proposed intent -> the allocation) ---
  const needDone = source.subscription !== null;

  // --- Stage 3: the procurement request (the demand) ---
  const requestDone = source.demand !== null;

  // --- Stage 4: the procurement quote (+ the acceptance state) ---
  const quote = source.quote;
  const quoteState: "done" | "approval" | "blocked" | "pending" =
    quote === null
      ? "pending"
      : quote.accepted
        ? "done"
        : quote.status === "REJECTED"
          ? "blocked"
          : "approval";

  // --- Stage 5: the connectivity request (the W050A submission) ---
  const submission = source.submission;
  const submissionStatus = (submission?.status ?? null) as WorkloadResourceLinkageStatus | null;
  const request5State: "done" | "approval" | "blocked" | "pending" =
    submission === null
      ? "pending"
      : submissionStatus === "APPROVED"
        ? "done"
        : submissionStatus === "PARKED"
          ? "approval"
          : submissionStatus === "REJECTED"
            ? "blocked"
            : "pending";

  // --- Stage 6: the VERIFIED connectivity outcome ---
  const verification = source.verification;
  const verified = verification !== null && deriveConnectivityVerification(verification);

  const rawStates: readonly ("done" | "approval" | "blocked" | "pending")[] = frozenArray([
    planDone ? "done" : "pending",
    needDone ? "done" : "pending",
    requestDone ? "done" : "pending",
    quoteState,
    request5State,
    verified ? "done" : "pending",
  ]);

  // The CURRENT stage: the first non-done stage (approval/blocked/pending).
  const firstOpen = rawStates.findIndex((state) => state !== "done");
  const currentStageId: JourneyStageId | null =
    firstOpen === -1 ? null : JOURNEY_STAGE_IDS[firstOpen] ?? null;

  // Only PENDING stages become "current" — an approval-required or
  // blocked stage keeps its explicit state (authorization semantics
  // are never masked by the cursor).
  const states: readonly ("done" | "current" | "pending" | "approval" | "blocked")[] =
    rawStates.map((state, index) =>
      state === "pending" && JOURNEY_STAGE_IDS[index] === currentStageId ? "current" : state,
    );

  const summaries: readonly string[] = frozenArray([
    active !== null
      ? `Recommendation ${active.id} (v${String(active.recommendationVersion)}) proposes ${String(active.proposedIntentCount)} draft intent${active.proposedIntentCount === 1 ? "" : "s"} for ${active.label}.`
      : `No active recommendation for workload ${workloadId} yet.`,
    source.subscription !== null
      ? softwareNeedSummary(source.subscription)
      : "The software subscription requirement is not yet allocated.",
    source.demand !== null
      ? `Procurement demand ${source.demand.demandId} opened for workload ${source.demand.workloadId} (deadline ${source.demand.deadline}).`
      : "No procurement demand is open for this workload yet.",
    quote !== null
      ? quote.accepted
        ? `Quote ${quote.quoteId} from vendor ${quote.vendorId} ACCEPTED at ${quote.acceptedAt ?? "an unrecorded instant"} — the order can form.`
        : quote.status === "REJECTED"
          ? `Quote ${quote.quoteId} from vendor ${quote.vendorId} was REJECTED — the procurement path is blocked.`
          : `Quote ${quote.quoteId} from vendor ${quote.vendorId} is ${quote.status} — acceptance (the operator approval) is pending.`
      : "No quote is issued for the demand yet.",
    submission !== null
      ? `Connectivity submission ${submission.submissionId} is ${submission.status} (outcome ${submission.request.outcome.canonical}).`
      : "No connectivity request is submitted for the workload yet.",
    verification !== null
      ? verified
        ? `Connectivity ${verification.connectivityId} VERIFIED: ${verification.executionState} with measurements (${verification.measurementKinds.join(", ")}).`
        : `Connectivity ${verification.connectivityId} is ${verification.executionState}${verification.failed ? " (failure observed)" : verification.measurementKinds.length === 0 ? " (no measurements yet)" : ""} — not yet verified.`
      : "No adopted connectivity record verifies the outcome yet.",
  ]);

  const recordRefs: readonly (string | null)[] = frozenArray([
    active?.id ?? null,
    source.subscription?.subscriptionId ?? null,
    source.demand?.demandId ?? null,
    quote?.quoteId ?? null,
    submission?.submissionId ?? null,
    verification?.connectivityId ?? null,
  ]);

  const evidenceRefs: readonly (readonly string[])[] = frozenArray([
    planEvidence,
    source.subscription !== null
      ? frozenArray([
          `subscription:${source.subscription.subscriptionId}`,
          `allocatedAt:${source.subscription.allocatedAt}`,
        ])
      : frozenArray([]),
    source.demand !== null
      ? frozenArray([`demand:${source.demand.demandId}`, `deadline:${source.demand.deadline}`])
      : frozenArray([]),
    quote !== null
      ? frozenArray([
          `quote:${quote.quoteId}`,
          ...(quote.acceptedAt !== null ? [`acceptedAt:${quote.acceptedAt}`] : []),
        ])
      : frozenArray([]),
    submission !== null
      ? frozenArray([
          `submission:${submission.submissionId}`,
          `outcome:${submission.request.outcome.canonical}`,
        ])
      : frozenArray([]),
    verification !== null
      ? frozenArray([
          `connectivity:${verification.connectivityId}`,
          `measurements:${verification.measurementKinds.join("+")}`,
          `digest:${verification.latestContentDigest}`,
        ])
      : frozenArray([]),
  ]);

  const titles: readonly string[] = frozenArray([
    "Workload plan recommendation",
    "Software need",
    "Procurement request",
    "Procurement quote & acceptance",
    "Connectivity request",
    "Verified connectivity",
  ]);

  const stages: JourneyRailStageView[] = JOURNEY_STAGE_IDS.map((stageId, index) =>
    frozen({
      viewVersion: WORKLOAD_JOURNEY_VIEW_VERSION,
      tenantId,
      workloadId,
      stageId,
      title: titles[index] ?? stageId,
      state: states[index] ?? "pending",
      summary: summaries[index] ?? "",
      recordRef: recordRefs[index] ?? null,
      evidenceRefs: evidenceRefs[index] ?? frozenArray([]),
      route: JOURNEY_STAGE_ROUTES[stageId],
    }),
  );

  return {
    ok: true,
    view: frozen({
      viewVersion: WORKLOAD_JOURNEY_VIEW_VERSION,
      tenantId,
      workloadId,
      stages: frozenArray(stages),
      currentStageId,
      verified,
      verificationSummary: verified && verification !== null
        ? `Connectivity ${verification.connectivityId} is ACTIVE with measurements (${verification.measurementKinds.join(", ")}) and no failure — the verified outcome.`
        : null,
    }),
  };
}

// ---------------------------------------------------------------------------
// The journey navigation machine (pure)
// ---------------------------------------------------------------------------

/** The journey navigation state (discriminated on the stage). */
export type JourneyNavState = { readonly stageId: JourneyStageId };

/** The journey navigation events. */
export type JourneyNavEvent =
  | { readonly type: "goto_stage"; readonly stageId: JourneyStageId }
  | { readonly type: "advance" }
  | { readonly type: "reset" };

/** The initial navigation state (the journey's origin stage). */
export const INITIAL_JOURNEY_NAV_STATE: JourneyNavState = frozen({
  stageId: "workload-plan",
});

/** The tagged result of a navigation reduction. */
export type JourneyNavResult =
  | { readonly ok: true; readonly state: JourneyNavState }
  | {
      readonly ok: false;
      readonly error: import("@fleetos/contracts").FleetError;
      readonly reason: "illegal_event";
    };

/**
 * Reduce one navigation event against the journey state. PURE and
 * DETERMINISTIC; never throws. `advance` moves to the NEXT stage in
 * the canonical order (refusing at the terminal stage);
 * `goto_stage` refuses unknown ids with the machine-stable
 * `illegal_event` reason. The DATA stays in the view-model — this
 * machine only moves the cursor.
 */
export function reduceJourneyNavState(
  state: JourneyNavState,
  event: JourneyNavEvent,
): JourneyNavResult {
  switch (event.type) {
    case "goto_stage": {
      if (!JOURNEY_STAGE_IDS.includes(event.stageId)) {
        return {
          ok: false,
          error: makeSurfaceDomainError(
            "web-workloads.journey",
            "illegal_event",
            "unknown journey stage id",
            SURFACE_SYSTEM_TENANT_ID,
          ),
          reason: "illegal_event",
        };
      }
      return { ok: true, state: frozen({ stageId: event.stageId }) };
    }
    case "advance": {
      const index = JOURNEY_STAGE_IDS.indexOf(state.stageId);
      if (index === -1 || index === JOURNEY_STAGE_IDS.length - 1) {
        return {
          ok: false,
          error: makeSurfaceDomainError(
            "web-workloads.journey",
            "illegal_event",
            "cannot advance past the terminal stage",
            SURFACE_SYSTEM_TENANT_ID,
          ),
          reason: "illegal_event",
        };
      }
      return {
        ok: true,
        state: frozen({ stageId: JOURNEY_STAGE_IDS[index + 1] ?? state.stageId }),
      };
    }
    case "reset":
      return { ok: true, state: INITIAL_JOURNEY_NAV_STATE };
    default:
      return {
        ok: false,
        error: makeSurfaceDomainError(
          "web-workloads.journey",
          "illegal_event",
          "unknown journey event",
          SURFACE_SYSTEM_TENANT_ID,
        ),
        reason: "illegal_event",
      };
  }
}

/**
 * Pure helper: the stages of the journey rail in canonical display
 * order (deterministic — consumers never re-sort ad hoc).
 */
export function journeyRailStages(
  view: WorkloadProcurementJourneyView,
): readonly JourneyRailStageView[] {
  return frozenArray(
    [...view.stages].sort((a, b) => journeyOrder(a.stageId) - journeyOrder(b.stageId)),
  );
}

function journeyOrder(stageId: JourneyStageId): number {
  const index = JOURNEY_STAGE_IDS.indexOf(stageId);
  return index === -1 ? JOURNEY_STAGE_IDS.length : index;
}
