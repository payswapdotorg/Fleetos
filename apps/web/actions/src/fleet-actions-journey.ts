/**
 * @fleetos/web-actions — W142: the Fleet Action JOURNEY view-model.
 *
 * The full operator journey the accepted deep screen must carry, as ONE
 * machine-stable walk (SIM-B ask 6; UX-JOURNEY-SIMULATION Journey 6 —
 * the record pattern's sequence):
 *
 *   intent -> proposal -> Guardian gate -> approval if required ->
 *   dispatch -> per-target result -> verification -> evidence
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: `not_yet_observed` is a first-class state. A plan outside
 *     the acting tenant's partition is `blocked` (no existence side
 *     channel).
 *   - The GUARDIAN GATE stage is the gate: ALLOW / WARN advances,
 *     REQUIRE_APPROVAL parks, BLOCK refuses. A parked decision
 *     VISIBLY requires a human approval.
 *   - The DISPATCH stage DISCLOSES the downstream dispatch handoff
 *     (never executed on this surface). The VERIFICATION stage carries
 *     its evidence + per-target outcomes.
 *   - Evidence stays OPAQUE: content-addressable refs verbatim, never
 *     interpreted.
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type { ScreenPhase } from "./ui/primitives";
import {
  ACTIONS_LANE_REASONS,
  actionsLaneLoading,
  toActionsScreenPhase,
} from "./lane-phase";
import type { ActionsLanePhase } from "./lane-phase";
import type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
  SurfacePlanStatus,
  SurfaceTenantScope,
} from "./surface-contracts";
import type {
  FleetActionVerificationRecord,
} from "./seams";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The Fleet Action journey stage ids, in the frozen journey order. */
export const FLEET_ACTION_JOURNEY_STAGES = [
  "intent",
  "proposal",
  "guardian_gate",
  "approval",
  "dispatch",
  "per_target_result",
  "verification",
  "evidence",
] as const;

export type FleetActionJourneyStageId =
  (typeof FLEET_ACTION_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type FleetActionJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface FleetActionJourneyStage {
  readonly id: FleetActionJourneyStageId;
  readonly state: FleetActionJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const FLEET_ACTION_JOURNEY_HEADLINES: Readonly<
  Record<FleetActionJourneyStageId, string>
> = Object.freeze({
  intent: "Intent expressed",
  proposal: "Plan proposed",
  guardian_gate: "Contract Guardian gate",
  approval: "Approval required",
  dispatch: "Dispatched",
  per_target_result: "Per-target result",
  verification: "Verified outcome",
  evidence: "Evidence artifacts",
} as const);

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The Fleet Action journey: the eight frozen stages with honest states,
 * derived from REAL runtime state.
 */
export interface FleetActionJourney {
  readonly tenantId: TenantId;
  readonly planId: string;
  /** The injected reference instant (display context; never a clock read). */
  readonly asOf: string;
  readonly stages: readonly FleetActionJourneyStage[];
  /** Machine-stable: is the plan parked for a human? */
  readonly approvalPending: boolean;
  /** Machine-stable: the final plan state (none / parked / approved / rejected / blocked). */
  readonly planState:
    | "not_proposed"
    | "proposal"
    | "parked"
    | "approved"
    | "rejected"
    | "blocked";
}

/** The journey build's inputs (all REAL state; nothing optional is fabricated). */
export interface FleetActionJourneyInput {
  /** The plan (undefined when not in the acting tenant). */
  readonly plan: SurfaceActionPlanRecord | undefined;
  /** The Guardian decision that produced the current status, when linked. */
  readonly linkedDecision: GuardianDecisionRecord | undefined;
  /** The verification record, when verification completed. */
  readonly verification: FleetActionVerificationRecord | undefined;
  /** The injected "now" (ISO 8601). */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// Pure stage-state derivation (honest defaults)
// ---------------------------------------------------------------------------

/** The state of the proposal stage from the plan's status. PURE. */
function proposalStageState(
  plan: SurfaceActionPlanRecord | undefined,
): FleetActionJourneyStageState {
  if (plan === undefined) return "blocked";
  return "ready";
}

/** The state of the Guardian-gate stage from the linked decision. PURE. */
function guardianGateStageState(
  linkedDecision: GuardianDecisionRecord | undefined,
): FleetActionJourneyStageState {
  if (linkedDecision === undefined) return "not_yet_observed";
  return "ready";
}

/** The state of the approval stage from the parking decision. PURE. */
function approvalStageState(
  plan: SurfaceActionPlanRecord | undefined,
  linkedDecision: GuardianDecisionRecord | undefined,
): FleetActionJourneyStageState {
  if (linkedDecision === undefined) return "not_yet_observed";
  if (linkedDecision.decision === "REQUIRE_APPROVAL") {
    return plan === undefined || plan.status === "PARKED"
      ? "approval_required"
      : "ready";
  }
  // ALLOW / WARN / BLOCK — no human approval required.
  return "empty";
}

/** The state of the dispatch stage from the plan's status. PURE. */
function dispatchStageState(
  plan: SurfaceActionPlanRecord | undefined,
): FleetActionJourneyStageState {
  if (plan === undefined) return "not_yet_observed";
  return plan.status === "APPROVED" ? "ready" : "blocked";
}

/** The state of the per-target-result stage from the verification. PURE. */
function perTargetResultStageState(
  verification: FleetActionVerificationRecord | undefined,
): FleetActionJourneyStageState {
  if (verification === undefined) return "not_yet_observed";
  return "ready";
}

/** The state of the verification stage from the verification record. PURE. */
function verificationStageState(
  verification: FleetActionVerificationRecord | undefined,
): FleetActionJourneyStageState {
  if (verification === undefined) return "not_yet_observed";
  return "ready";
}

/**
 * The frozen final plan state derived from the journey's inputs. PURE.
 */
function derivePlanState(
  input: Pick<FleetActionJourneyInput, "plan" | "linkedDecision">,
): FleetActionJourney["planState"] {
  const plan = input.plan;
  if (plan === undefined) return "not_proposed";
  const status = plan.status;
  if (status === "PROPOSAL") return "proposal";
  if (status === "PARKED") return "parked";
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  // ADVANCED — the Guardian ALLOW/WARN path; not parked, not approved,
  // not rejected.
  if (input.linkedDecision !== undefined && input.linkedDecision.decision === "BLOCK") {
    return "blocked";
  }
  return "approved";
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the Fleet Action journey view-model. PURE and DETERMINISTIC.
 */
export function buildFleetActionJourney(
  scope: { readonly tenantId: TenantId },
  planId: string,
  input: FleetActionJourneyInput,
): FleetActionJourney {
  const plan = input.plan;
  const decision = input.linkedDecision;
  const verification = input.verification;

  const stages: FleetActionJourneyStage[] = [
    frozen<FleetActionJourneyStage>({
      id: "intent",
      state: plan === undefined ? "blocked" : "ready",
      headline: FLEET_ACTION_JOURNEY_HEADLINES.intent,
      rows:
        plan === undefined
          ? frozenArray([
              { label: "Plan", value: planId },
              { label: "State", value: "Not in the acting tenant" },
            ])
          : frozenArray([
              { label: "Plan", value: plan.planId },
              { label: "Capability", value: plan.capability },
              { label: "Targets", value: String(plan.targetCount) },
              { label: "Requested by", value: plan.requestedBy ?? "—" },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "proposal",
      state: proposalStageState(plan),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.proposal,
      rows:
        plan === undefined
          ? frozenArray([{ label: "Plan", value: "Not in the acting tenant" }])
          : frozenArray([
              { label: "Name", value: plan.name },
              { label: "Version", value: String(plan.version) },
              { label: "Status", value: plan.status },
              { label: "Selector", value: plan.selector.kind },
              { label: "Created at", value: plan.createdAt },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "guardian_gate",
      state: guardianGateStageState(decision),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.guardian_gate,
      rows:
        decision === undefined
          ? frozenArray([{ label: "Decision", value: "Not yet evaluated" }])
          : frozenArray([
              { label: "Decision", value: decision.decision },
              { label: "Rules", value: String(decision.rules.length) },
              { label: "Evidence", value: String(decision.evidence.length) },
              { label: "Decided at", value: decision.decidedAt },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "approval",
      state: approvalStageState(plan, decision),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.approval,
      rows:
        decision === undefined
          ? frozenArray([{ label: "Approval", value: "Not yet evaluated" }])
          : decision.decision === "REQUIRE_APPROVAL"
            ? frozenArray([
                { label: "Required", value: "Yes — an owner must approve" },
                {
                  label: "Parked at",
                  value: plan?.transitionedAt ?? "—",
                },
              ])
            : frozenArray([{ label: "Required", value: "No" }]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "dispatch",
      state: dispatchStageState(plan),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.dispatch,
      rows:
        plan === undefined
          ? frozenArray([{ label: "Plan", value: "No plan yet" }])
          : frozenArray([
              { label: "Plan", value: plan.planId },
              { label: "Status", value: plan.status },
              {
                label: "Handoff",
                value:
                  plan.status === "APPROVED"
                    ? "downstream_dispatch"
                    : "—",
              },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "per_target_result",
      state: perTargetResultStageState(verification),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.per_target_result,
      rows:
        verification === undefined
          ? frozenArray([{ label: "Per-target result", value: "Not yet verified" }])
          : frozenArray([
              { label: "Targets", value: String(verification.perTarget.length) },
              {
                label: "Succeeded",
                value: String(
                  verification.perTarget.filter((t) => t.outcome === "succeeded").length,
                ),
              },
              {
                label: "Failed",
                value: String(
                  verification.perTarget.filter((t) => t.outcome === "failed").length,
                ),
              },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "verification",
      state: verificationStageState(verification),
      headline: FLEET_ACTION_JOURNEY_HEADLINES.verification,
      rows:
        verification === undefined
          ? frozenArray([{ label: "Verification", value: "Not yet verified" }])
          : frozenArray([
              { label: "Verified at", value: verification.verifiedAt },
              { label: "Summary", value: verification.summary },
              { label: "Evidence", value: String(verification.evidenceCount) },
            ]),
    }),
    frozen<FleetActionJourneyStage>({
      id: "evidence",
      state:
        plan === undefined
          ? "blocked"
          : plan.evidence.length === 0
            ? "not_yet_observed"
            : "ready",
      headline: FLEET_ACTION_JOURNEY_HEADLINES.evidence,
      rows:
        plan === undefined
          ? frozenArray([{ label: "Artifacts", value: "Not in the acting tenant" }])
          : frozenArray([
              { label: "Artifacts", value: String(plan.evidence.length) },
              {
                label: "Algorithms",
                value:
                  plan.evidence.length === 0
                    ? "—"
                    : [...new Set(plan.evidence.map((r) => r.hashAlgorithm))]
                        .sort()
                        .join(", "),
              },
            ]),
    }),
  ];

  return frozen({
    tenantId: scope.tenantId,
    planId,
    asOf: input.now,
    stages: frozenArray(stages),
    approvalPending:
      plan !== undefined &&
      plan.status === "PARKED",
    planState: derivePlanState(input),
  });
}

/** Re-export for the feed's plan status usage. */
export type { SurfacePlanStatus } from "./surface-contracts";
