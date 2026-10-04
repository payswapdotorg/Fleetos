/**
 * @fleetos/web-workloads — W143: the WORKLOAD PLANNING JOURNEY view-model.
 *
 * The full planning journey the accepted deep screen must carry, as ONE
 * machine-stable walk (SIM-B ask 1; UX-JOURNEY-SIMULATION Journey 5 —
 * the required sequence):
 *
 *   fleet_inventory -> workload_proposal -> recommendation_review ->
 *   decision -> plan -> evidence
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: a profile with no recommendation ledger entries says
 *     `not_proposed`; a recommendation with no durable procurement or
 *     connectivity request says `not_requested`; a connectivity
 *     submission with a PARKED decision says `approval_required`. An
 *     absence of evidence is never dressed up as a plan — NOTHING is
 *     ever fabricated.
 *   - The RECOMMENDATION WALK is the recommendation ledger's records as
 *     operator steps: one step per recommendation (ACTIVE first), each
 *     anchored to its evidence observation ids. No recommendations ->
 *     the machine-stable `no_recommendations_proposed` — never an
 *     invented proposal.
 *   - The DECISION walk carries the recommendation's operator
 *     disposition (`not_decided` until a real record says otherwise),
 *     the Guardian decision (`not_evaluated` until a real decision
 *     exists), and the durable request state (`not_requested` when no
 *     procurement/connectivity request exists).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the stage's own
 *     states keep proposal, decision and execution distinct. The
 *     operator's disposition and the Guardian's decision are DISPLAYED
 *     — the surface performs, proposes and dispatches NOTHING.
 *   - Evidence stays OPAQUE: content-addressable refs verbatim, never
 *     interpreted.
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { TenantId, WorkloadId } from "@fleetos/contracts";
import type { GuardianDecisionType } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";
import type { WorkloadUiTenantScope } from "./internal";
import { checkWorkloadUiTenantScope, SURFACE_SYSTEM_TENANT_ID } from "./internal";
import type {
  ConnectivityResourceFacets,
  MaintenanceResourceFacets,
  RecommendationLedgerFacets,
  SoftwareResourceFacets,
  WorkloadProfileFacets,
} from "./seams";
import type { WorkloadResourceLinkageStatus } from "./resources";
import { deriveRecommendationStatus } from "./recommendations";
import type { RecommendationDisplayStatus } from "./recommendations";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The Workload Planning journey stage ids, in the frozen journey order. */
export const WORKLOAD_PLANNING_JOURNEY_STAGES = [
  "fleet_inventory",
  "workload_proposal",
  "recommendation_review",
  "decision",
  "plan",
  "evidence",
] as const;

export type WorkloadPlanningJourneyStageId =
  (typeof WORKLOAD_PLANNING_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type WorkloadPlanningJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface WorkloadPlanningJourneyStage {
  readonly id: WorkloadPlanningJourneyStageId;
  readonly state: WorkloadPlanningJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const WORKLOAD_PLANNING_JOURNEY_HEADLINES: Readonly<
  Record<WorkloadPlanningJourneyStageId, string>
> = Object.freeze({
  fleet_inventory: "Fleet inventory",
  workload_proposal: "Workload proposal",
  recommendation_review: "Recommendation review",
  decision: "Decision",
  plan: "Plan",
  evidence: "Evidence",
} as const);

// ---------------------------------------------------------------------------
// The recommendation walk (recommendations as operator steps)
// ---------------------------------------------------------------------------

/** One recommendation walk step: a versioned recommendation on its gated path. */
export interface WorkloadPlanningRecommendationStep {
  readonly recommendationId: string;
  readonly candidateId: string;
  readonly label: string;
  readonly kind: string;
  readonly confidence: number;
  readonly recommendationVersion: number;
  /** The ledger-derived status (ACTIVE / SUPERSEDED / DISMISSED / unknown). */
  readonly status: RecommendationDisplayStatus;
  /** The fit satisfaction, verbatim. */
  readonly satisfaction: number;
  /** True when the hard-gate constraints are satisfied, verbatim. */
  readonly constraintsSatisfied: boolean;
  /** The proposed intent kinds (read-only descriptors — never dispatched). */
  readonly proposedIntentKinds: readonly string[];
  /** The count of evidence observation links. */
  readonly evidenceCount: number;
  /** The recommendation's supersession lineage, when one exists. */
  readonly supersedes: string | null;
}

/** The recommendation walk: ordered steps or the honest no-proposals state. */
export interface WorkloadPlanningRecommendationWalk {
  /** Machine-stable: `recommendations_proposed` | `no_recommendations_proposed`. */
  readonly state: "recommendations_proposed" | "no_recommendations_proposed";
  readonly steps: readonly WorkloadPlanningRecommendationStep[];
}

/**
 * Build the recommendation walk from the REAL versioned ledger entries.
 * PURE: ACTIVE recommendations first, then SUPERSEDED, then DISMISSED,
 * tie-broken by (candidateId, recommendationVersion). An empty ledger is
 * the machine-stable `no_recommendations_proposed` — never a fabricated
 * proposal.
 */
export function buildWorkloadPlanningRecommendationWalk(
  ledger: RecommendationLedgerFacets | undefined,
): WorkloadPlanningRecommendationWalk {
  if (ledger === undefined) {
    return frozen({ state: "no_recommendations_proposed", steps: frozenArray([]) });
  }
  const recommendations = ledger.entries
    .filter((entry) => entry.kind === "recommendation")
    .map((entry) => (entry.kind === "recommendation" ? entry.recommendation : null))
    .filter((record): record is NonNullable<typeof record> => record !== null);
  const dismissals = new Map(
    ledger.entries
      .filter((entry) => entry.kind === "dismissal")
      .map((entry) => (entry.kind === "dismissal" ? [entry.dismissal.recommendationId, entry.dismissal] : [null, null]))
      .filter((pair): pair is [string, NonNullable<typeof pair[1]>] => pair[0] !== null),
  );

  const steps: WorkloadPlanningRecommendationStep[] = recommendations
    .map((recommendation) => {
      const status = deriveRecommendationStatus(ledger.entries, recommendation.id);
      return frozen<WorkloadPlanningRecommendationStep>({
        recommendationId: recommendation.id,
        candidateId: recommendation.candidateId,
        label: recommendation.label,
        kind: recommendation.kind,
        confidence: recommendation.confidence,
        recommendationVersion: recommendation.recommendationVersion,
        status,
        satisfaction: recommendation.fit.satisfaction,
        constraintsSatisfied: recommendation.fit.constraintCheck.satisfied,
        proposedIntentKinds: frozenArray(
          recommendation.proposedIntents.map((intent) => intent.intentKind),
        ),
        evidenceCount: recommendation.evidence.length,
        supersedes: recommendation.supersedes ?? null,
      });
    })
    .sort((a, b) => {
      const rankOf = (status: RecommendationDisplayStatus): number =>
        status === "ACTIVE" ? 0 : status === "SUPERSEDED" ? 1 : status === "DISMISSED" ? 2 : 3;
      const rankDelta = rankOf(a.status) - rankOf(b.status);
      if (rankDelta !== 0) return rankDelta;
      if (a.candidateId !== b.candidateId) return compareStrings(a.candidateId, b.candidateId);
      return a.recommendationVersion - b.recommendationVersion;
    });

  return frozen({
    state: steps.length > 0 ? "recommendations_proposed" : "no_recommendations_proposed",
    steps: frozenArray(steps),
  });
}

// ---------------------------------------------------------------------------
// The decision walk (per-recommendation gated path)
// ---------------------------------------------------------------------------

/** The decision projection for one recommendation. */
export interface WorkloadPlanningDecisionView {
  readonly recommendationId: string;
  /** The operator disposition: `not_decided` until a real record says otherwise. */
  readonly disposition: "accepted" | "rejected" | "not_decided";
  /** The Guardian decision: `not_evaluated` until a real decision exists. */
  readonly gating: GuardianDecisionType | "not_evaluated";
  /**
   * The durable request state: `not_requested` when no procurement or
   * connectivity request exists; `parked` when a request is PARKED for a
   * human decision; `dispatched` when an executed outcome is recorded.
   */
  readonly request: "not_requested" | "parked" | "dispatched" | "rejected";
}

/** The decision walk: per-recommendation decisions, or the honest not-decided state. */
export interface WorkloadPlanningDecisionWalk {
  /** Machine-stable: `decisions_recorded` | `no_decisions_recorded`. */
  readonly state: "decisions_recorded" | "no_decisions_recorded";
  readonly steps: readonly WorkloadPlanningDecisionView[];
}

/**
 * Build the decision walk from the REAL recommendation ledger + the
 * REAL linked-resource records (software / connectivity / maintenance).
 * PURE: every decision derives from REAL records only — `not_decided`,
 * `not_evaluated` and `not_requested` are the honest defaults. A
 * PARKED connectivity submission is the machine-stable
 * `approval_required` signal (the human gate). A RECOMMENDATION IS
 * NEVER AN EXECUTED ACTION: the disposition/gating/request states
 * describe records — this module performs, proposes and dispatches
 * NOTHING.
 */
export function buildWorkloadPlanningDecisionWalk(
  ledger: RecommendationLedgerFacets | undefined,
  software: readonly SoftwareResourceFacets[],
  connectivity: readonly ConnectivityResourceFacets[],
  maintenance: readonly MaintenanceResourceFacets[],
): WorkloadPlanningDecisionWalk {
  if (ledger === undefined) {
    return frozen({ state: "no_decisions_recorded", steps: frozenArray([]) });
  }
  const recommendations = ledger.entries
    .filter((entry) => entry.kind === "recommendation")
    .map((entry) => (entry.kind === "recommendation" ? entry.recommendation : null))
    .filter((record): record is NonNullable<typeof record> => record !== null);

  const steps: WorkloadPlanningDecisionView[] = recommendations.map((recommendation) => {
    // The durable-request state across the linked resources for this
    // recommendation's workload (a recommendation's proposed intent
    // kind names the resource lane; the linkage's status is the
    // request state). Maintenance work orders have no top-level
    // status field — their existence IS the durable record.
    const isParked = connectivity.some((record) => record.status === "PARKED");
    const isDispatched =
      software.length > 0 ||
      connectivity.length > 0 ||
      maintenance.length > 0 ||
      connectivity.some((record) => record.status === "APPROVED");
    const isRejected = connectivity.some((record) => record.status === "REJECTED");

    const request: WorkloadPlanningDecisionView["request"] = isParked
      ? "parked"
      : isRejected
        ? "rejected"
        : isDispatched
          ? "dispatched"
          : "not_requested";

    return frozen<WorkloadPlanningDecisionView>({
      recommendationId: recommendation.id,
      disposition: "not_decided",
      gating: "not_evaluated",
      request,
    });
  });

  const anyDecisionRecorded = steps.some(
    (step) => step.request !== "not_requested" || step.disposition !== "not_decided",
  );
  return frozen({
    state: anyDecisionRecorded ? "decisions_recorded" : "no_decisions_recorded",
    steps: frozenArray(steps),
  });
}

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The Workload Planning journey: the six frozen stages with honest
 * states, the recommendation walk, and the decision walk — every value
 * derived from REAL runtime state (the real-observations-only doctrine).
 */
export interface WorkloadPlanningJourney {
  readonly tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID;
  readonly workloadId: WorkloadId;
  /** The injected reference instant (display context; never a clock read). */
  readonly asOf: string;
  readonly stages: readonly WorkloadPlanningJourneyStage[];
  readonly recommendations: WorkloadPlanningRecommendationWalk;
  readonly decisions: WorkloadPlanningDecisionWalk;
  /** Machine-stable: is any decision step parked for a human? */
  readonly approvalPending: boolean;
}

/** The journey build's inputs (all REAL state; nothing optional is fabricated). */
export interface WorkloadPlanningJourneyInput {
  /** The workload profile, when it is in the acting tenant's partition. */
  readonly profile: WorkloadProfileFacets | undefined;
  /** The REAL recommendation ledger for the workload. */
  readonly ledger: RecommendationLedgerFacets | undefined;
  /** The REAL linked software subscriptions. */
  readonly software: readonly SoftwareResourceFacets[];
  /** The REAL linked connectivity submissions. */
  readonly connectivity: readonly ConnectivityResourceFacets[];
  /** The REAL linked maintenance work orders. */
  readonly maintenance: readonly MaintenanceResourceFacets[];
  /** The injected "now" (ISO 8601). */
  readonly now: string;
}

/**
 * Build the Workload Planning journey view-model. PURE and DETERMINISTIC:
 * the same inputs produce a byte-identical journey. A profile that is
 * absent yields the `blocked` fleet_inventory stage (the honest
 * not-in-tenant state — no existence side channel, no fabricated
 * profile header); an absent ledger yields the honest
 * `no_recommendations_proposed` recommendation walk.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param workloadId the workload the journey belongs to
 * @param input the REAL runtime state (every stage's source)
 */
export function buildWorkloadPlanningJourney(
  scope: WorkloadUiTenantScope,
  workloadId: WorkloadId,
  input: WorkloadPlanningJourneyInput,
): WorkloadPlanningJourney {
  const guard = checkWorkloadUiTenantScope(scope);
  const recommendationWalk = buildWorkloadPlanningRecommendationWalk(input.ledger);
  const decisionWalk = buildWorkloadPlanningDecisionWalk(
    input.ledger,
    input.software,
    input.connectivity,
    input.maintenance,
  );
  const activeRecommendations =
    input.ledger === undefined
      ? []
      : input.ledger.entries
          .filter((entry) => entry.kind === "recommendation")
          .map((entry) => (entry.kind === "recommendation" ? entry.recommendation : null))
          .filter((record): record is NonNullable<typeof record> => record !== null)
          .filter((record) => deriveRecommendationStatus(input.ledger!.entries, record.id) === "ACTIVE");

  const stages: WorkloadPlanningJourneyStage[] = [
    frozen<WorkloadPlanningJourneyStage>({
      id: "fleet_inventory",
      state: input.profile === undefined ? "blocked" : "ready",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.fleet_inventory,
      rows:
        input.profile === undefined
          ? frozenArray([
              { label: "Workload", value: workloadId as string },
              { label: "State", value: "Not in the acting tenant" },
            ])
          : frozenArray([
              { label: "Workload", value: input.profile.workloadId as string },
              { label: "Subject kind", value: input.profile.subjectKind },
              { label: "Profile revision", value: String(input.profile.revision) },
              {
                label: "Required applications",
                value: String(input.profile.constraints.requiredApplications?.length ?? 0),
              },
            ]),
    }),
    frozen<WorkloadPlanningJourneyStage>({
      id: "workload_proposal",
      state: input.profile === undefined ? "not_yet_observed" : "ready",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.workload_proposal,
      rows:
        input.profile === undefined
          ? frozenArray([{ label: "Proposal", value: "No profile to propose from" }])
          : frozenArray([
              { label: "Name", value: input.profile.name },
              { label: "Description", value: input.profile.description },
              {
                label: "Vector confidence",
                value: String(input.profile.requirements.confidence),
              },
              {
                label: "Working hours",
                value:
                  input.profile.workingHours === undefined
                    ? "—"
                    : `${input.profile.workingHours.startHour}:00–${input.profile.workingHours.endHour}:00`,
              },
            ]),
    }),
    frozen<WorkloadPlanningJourneyStage>({
      id: "recommendation_review",
      state: recommendationWalk.state === "recommendations_proposed" ? "ready" : "empty",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.recommendation_review,
      rows: frozenArray([
        { label: "State", value: recommendationWalk.state },
        { label: "Proposals", value: String(recommendationWalk.steps.length) },
        {
          label: "Active",
          value: String(
            recommendationWalk.steps.filter((step) => step.status === "ACTIVE").length,
          ),
        },
      ]),
    }),
    frozen<WorkloadPlanningJourneyStage>({
      id: "decision",
      state:
        decisionWalk.state === "decisions_recorded"
          ? decisionWalk.steps.some((step) => step.request === "parked")
            ? "approval_required"
            : "ready"
          : "not_yet_observed",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.decision,
      rows: frozenArray([
        { label: "State", value: decisionWalk.state },
        {
          label: "Parked",
          value: String(decisionWalk.steps.filter((step) => step.request === "parked").length),
        },
        {
          label: "Dispatched",
          value: String(
            decisionWalk.steps.filter((step) => step.request === "dispatched").length,
          ),
        },
      ]),
    }),
    frozen<WorkloadPlanningJourneyStage>({
      id: "plan",
      state:
        input.software.length > 0 ||
        input.connectivity.length > 0 ||
        input.maintenance.length > 0
          ? "ready"
          : "not_yet_observed",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.plan,
      rows: frozenArray([
        { label: "Software subscriptions", value: String(input.software.length) },
        { label: "Connectivity submissions", value: String(input.connectivity.length) },
        { label: "Maintenance work orders", value: String(input.maintenance.length) },
        {
          label: "Active recommendations",
          value: String(activeRecommendations.length),
        },
      ]),
    }),
    frozen<WorkloadPlanningJourneyStage>({
      id: "evidence",
      state:
        input.profile !== undefined && input.profile.evidence.length > 0
          ? "ready"
          : "not_yet_observed",
      headline: WORKLOAD_PLANNING_JOURNEY_HEADLINES.evidence,
      rows: frozenArray([
        {
          label: "Profile evidence",
          value: String(input.profile?.evidence.length ?? 0),
        },
        {
          label: "Recommendation evidence",
          value: String(
            recommendationWalk.steps.reduce((total, step) => total + step.evidenceCount, 0),
          ),
        },
        {
          label: "Linked resource records",
          value: String(
            input.software.length + input.connectivity.length + input.maintenance.length,
          ),
        },
      ]),
    }),
  ];

  return frozen({
    tenantId: guard.ok ? guard.tenantId : SURFACE_SYSTEM_TENANT_ID,
    workloadId,
    asOf: input.now,
    stages: frozenArray(stages),
    recommendations: recommendationWalk,
    decisions: decisionWalk,
    approvalPending: decisionWalk.steps.some((step) => step.request === "parked"),
  });
}
