/**
 * @fleetos/web-security — W142: the Security Doctor JOURNEY view-model.
 *
 * The full operator journey the accepted deep screen must carry, as ONE
 * machine-stable walk (SIM-B ask 3; UX-JOURNEY-SIMULATION Journey 3 —
 * the record pattern's sequence):
 *
 *   finding -> inspect -> proposed remediation -> Contract Guardian
 *   decision -> approval if required -> human confirmation -> execution
 *   -> evidence -> verified result
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: `not_yet_observed` is a first-class state (a finding that
 *     has not been evaluated yet says exactly that — nothing is ever
 *     fabricated). A finding outside the acting tenant's partition is
 *     `blocked` (no existence side channel, no fabricated header).
 *   - The CONTRACT GUARDIAN DECISION stage is the gate: ALLOW / WARN
 *     advances, REQUIRE_APPROVAL parks, BLOCK refuses. A parked
 *     decision VISIBLY requires a human approval (the SIM-B ask).
 *   - The HUMAN CONFIRMATION stage is the gate's terminal transition:
 *     an explicit approval (an owner — never auto-promoted), or a
 *     rejection. A duplicate decision is handled safely (the
 *     `already_decided` refusal — never a silent no-op).
 *   - The EXECUTION stage DISCLOSES the downstream dispatch handoff
 *     (never executed on this surface). The VERIFIED RESULT stage
 *     carries its evidence.
 *   - Evidence stays OPAQUE: content-addressable refs verbatim, never
 *     interpreted.
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type {
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  RemediationProposalDraft,
  SecurityFindingRecord,
  SurfaceDecisionType,
  SurfaceSeverity,
} from "./surface-contracts";
import type {
  DecisionPlanState,
  SecurityRemediationRequestLike,
  VerificationRecord,
} from "./seams";
import { SURFACE_SEVERITY_RANK } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The Security Doctor journey stage ids, in the frozen journey order. */
export const SECURITY_DOCTOR_JOURNEY_STAGES = [
  "finding",
  "inspect",
  "proposed_remediation",
  "guardian_decision",
  "approval",
  "human_confirmation",
  "execution",
  "evidence",
  "verified_result",
] as const;

export type SecurityDoctorJourneyStageId =
  (typeof SECURITY_DOCTOR_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type SecurityDoctorJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface SecurityDoctorJourneyStage {
  readonly id: SecurityDoctorJourneyStageId;
  readonly state: SecurityDoctorJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const SECURITY_DOCTOR_JOURNEY_HEADLINES: Readonly<
  Record<SecurityDoctorJourneyStageId, string>
> = Object.freeze({
  finding: "Finding detected",
  inspect: "Inspecting the evidence",
  proposed_remediation: "Remediation proposed",
  guardian_decision: "Contract Guardian decision",
  approval: "Approval required",
  human_confirmation: "Human decision",
  execution: "Action requested",
  evidence: "Evidence artifacts",
  verified_result: "Verified outcome",
} as const);

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The Security Doctor journey: the nine frozen stages with honest
 * states, derived from REAL runtime state (the real-observations-only
 * doctrine).
 */
export interface SecurityDoctorJourney {
  readonly tenantId: TenantId;
  readonly findingId: string;
  readonly deviceId: DeviceId;
  /** The injected reference instant (display context; never a clock read). */
  readonly asOf: string;
  readonly stages: readonly SecurityDoctorJourneyStage[];
  /** Machine-stable: is the finding's remediation parked for a human? */
  readonly approvalPending: boolean;
  /** Machine-stable: the final decision state (none / parked / approved / rejected / blocked). */
  readonly decisionState:
    | "not_evaluated"
    | "parked"
    | "approved"
    | "rejected"
    | "blocked";
}

/** The journey build's inputs (all REAL state; nothing optional is fabricated). */
export interface SecurityDoctorJourneyInput {
  /** The finding under remediation (undefined when not in the acting tenant). */
  readonly finding: SecurityFindingRecord | undefined;
  /** The Guardian evaluation that produced the parking decision (when applicable). */
  readonly evaluation: GuardianEvaluationRecord | undefined;
  /** The durable remediation request records (lifecycle, disposition, evidence). */
  readonly remediationRequests: readonly SecurityRemediationRequestLike[];
  /** The parked approval item (when the decision is REQUIRE_APPROVAL and a plan is parked). */
  readonly parkedApproval: ParkedApprovalItemInput | undefined;
  /** The post-decision plan state (when the human decided or the Guardian refused). */
  readonly planState: DecisionPlanState | undefined;
  /** The verification record (when execution completed and was verified). */
  readonly verification: VerificationRecord | undefined;
  /** The injected "now" (ISO 8601). */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// Pure stage-state derivation (honest defaults)
// ---------------------------------------------------------------------------

/** The state of the proposed-remediation stage from the finding's draft. PURE. */
function proposedRemediationStageState(
  finding: SecurityFindingRecord | undefined,
): SecurityDoctorJourneyStageState {
  if (finding === undefined) return "blocked";
  return finding.remediation === undefined ? "empty" : "ready";
}

/** The state of the Guardian-decision stage from the evaluation. PURE. */
function guardianDecisionStageState(
  evaluation: GuardianEvaluationRecord | undefined,
): SecurityDoctorJourneyStageState {
  if (evaluation === undefined) return "not_yet_observed";
  return "ready";
}

/** The state of the approval stage from the parking decision. PURE. */
function approvalStageState(
  evaluation: GuardianEvaluationRecord | undefined,
  parkedApproval: ParkedApprovalItemInput | undefined,
): SecurityDoctorJourneyStageState {
  if (evaluation === undefined) return "not_yet_observed";
  if (evaluation.decision.decision === "REQUIRE_APPROVAL") {
    return parkedApproval === undefined ? "not_yet_observed" : "approval_required";
  }
  // ALLOW / WARN / BLOCK — no human approval required.
  return "empty";
}

/** The state of the human-confirmation stage from the plan state. PURE. */
function humanConfirmationStageState(
  planState: DecisionPlanState | undefined,
  evaluation: GuardianEvaluationRecord | undefined,
): SecurityDoctorJourneyStageState {
  if (evaluation === undefined) return "not_yet_observed";
  if (evaluation.decision.decision !== "REQUIRE_APPROVAL") {
    // No human step required for ALLOW / WARN / BLOCK.
    return "empty";
  }
  // REQUIRE_APPROVAL — a human decision IS required:
  if (planState === undefined) return "approval_required"; // awaiting the owner decision
  return planState.status === "APPROVED" || planState.status === "REJECTED"
    ? "ready"
    : "approval_required"; // PARKED — still awaiting the decision
}

/** The state of the execution stage from the plan state. PURE. */
function executionStageState(
  planState: DecisionPlanState | undefined,
): SecurityDoctorJourneyStageState {
  if (planState === undefined) return "not_yet_observed";
  return planState.status === "APPROVED" ? "ready" : "blocked";
}

/** The state of the verified-result stage from the verification record. PURE. */
function verifiedResultStageState(
  verification: VerificationRecord | undefined,
): SecurityDoctorJourneyStageState {
  if (verification === undefined) return "not_yet_observed";
  return "ready";
}

/**
 * The frozen final decision state derived from the journey's inputs.
 * PURE; mirrors the surface's status union (the surface's
 * `decisionState` is the machine-stable truth the screen renders).
 *
 *   not_evaluated — no Guardian evaluation exists yet.
 *   parked        — the engine said REQUIRE_APPROVAL (a human approval
 *                   is required; the plan is parked or no plan has been
 *                   filed yet).
 *   approved      — the plan is APPROVED (the human approved) or the
 *                   engine said ALLOW/WARN (advanced past the gate).
 *   rejected      — the plan is REJECTED (the human rejected).
 *   blocked       — the engine said BLOCK (the Guardian refused).
 */
function deriveDecisionState(
  input: Pick<
    SecurityDoctorJourneyInput,
    "evaluation" | "parkedApproval" | "planState"
  >,
): SecurityDoctorJourney["decisionState"] {
  const evaluation = input.evaluation;
  if (evaluation === undefined) return "not_evaluated";
  const decisionType = evaluation.decision.decision;
  if (decisionType === "ALLOW" || decisionType === "WARN") return "approved";
  if (decisionType === "BLOCK") return "blocked";
  // REQUIRE_APPROVAL — the parking decision:
  if (input.planState === undefined) {
    // The engine requires a human approval. Whether a plan has been
    // parked yet or not, the decision state IS "parked" — the engine
    // said approval is required.
    return "parked";
  }
  if (input.planState.status === "APPROVED") return "approved";
  if (input.planState.status === "REJECTED") return "rejected";
  return "parked";
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the Security Doctor journey view-model. PURE and DETERMINISTIC:
 * the same inputs produce a byte-identical journey. A finding that is
 * absent yields the `blocked` finding stage (the honest not-in-tenant
 * state — no existence side channel, no fabricated header); absent
 * runtime state yields the honest `not_yet_observed` / `empty` states.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param findingId the finding the journey belongs to
 * @param input the REAL runtime state (every stage's source)
 */
export function buildSecurityDoctorJourney(
  scope: { readonly tenantId: TenantId },
  findingId: string,
  input: SecurityDoctorJourneyInput,
): SecurityDoctorJourney {
  const finding = input.finding;
  const evaluation = input.evaluation;
  const planState = input.planState;

  // The remediation request (latest per finding wins; the seam orders).
  const remediationRequest =
    input.remediationRequests.length > 0
      ? (input.remediationRequests[input.remediationRequests.length - 1] as SecurityRemediationRequestLike)
      : undefined;

  // The decision type, when evaluated.
  const decisionType: SurfaceDecisionType | undefined =
    evaluation !== undefined ? evaluation.decision.decision : undefined;

  const stages: SecurityDoctorJourneyStage[] = [
    frozen<SecurityDoctorJourneyStage>({
      id: "finding",
      state: finding === undefined ? "blocked" : "ready",
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.finding,
      rows:
        finding === undefined
          ? frozenArray([
              { label: "Finding", value: findingId },
              { label: "State", value: "Not in the acting tenant" },
            ])
          : frozenArray([
              { label: "Finding", value: finding.findingId },
              { label: "Code", value: finding.code },
              { label: "Severity", value: finding.severity },
              { label: "Class", value: finding.classification },
              { label: "Detected at", value: finding.detectedAt },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "inspect",
      state: finding === undefined ? "blocked" : finding.evidence.length === 0 ? "empty" : "ready",
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.inspect,
      rows:
        finding === undefined
          ? frozenArray([{ label: "Evidence", value: "Not in the acting tenant" }])
          : frozenArray([
              { label: "Observations", value: String(finding.evidence.length) },
              {
                label: "Kinds",
                value:
                  finding.evidence.length === 0
                    ? "—"
                    : [...new Set(finding.evidence.map((e) => e.kind))].join(", "),
              },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "proposed_remediation",
      state: proposedRemediationStageState(finding),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.proposed_remediation,
      rows:
        finding === undefined || finding.remediation === undefined
          ? frozenArray([
              { label: "Proposal", value: finding === undefined ? "Not in the acting tenant" : "None attached" },
            ])
          : frozenArray([
              { label: "Intent", value: finding.remediation.intentKind },
              {
                label: "Description",
                value: (finding.remediation as { payload: RemediationProposalDraft["payload"] }).payload.description,
              },
              { label: "Presentation", value: "PROPOSAL — never an execution" },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "guardian_decision",
      state: guardianDecisionStageState(evaluation),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.guardian_decision,
      rows:
        evaluation === undefined
          ? frozenArray([{ label: "Decision", value: "Not yet evaluated" }])
          : frozenArray([
              { label: "Decision", value: decisionType ?? "—" },
              { label: "Rule set", value: evaluation.ruleSetId },
              { label: "Version", value: String(evaluation.ruleSetVersion) },
              { label: "Matched rules", value: String(evaluation.matchedRules.length) },
              { label: "Reasons", value: String(evaluation.reasons.length) },
              { label: "Decided at", value: evaluation.decision.decidedAt },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "approval",
      state: approvalStageState(evaluation, input.parkedApproval),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.approval,
      rows:
        evaluation === undefined
          ? frozenArray([{ label: "Approval", value: "Not yet evaluated" }])
          : evaluation.decision.decision === "REQUIRE_APPROVAL"
            ? frozenArray([
                {
                  label: "Required",
                  value: "Yes — an owner must approve",
                },
                {
                  label: "Parked plan",
                  value: input.parkedApproval?.plan.planId ?? "—",
                },
                {
                  label: "Parked at",
                  value: input.parkedApproval?.plan.transitionedAt ?? "—",
                },
              ])
            : frozenArray([{ label: "Required", value: "No" }]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "human_confirmation",
      state: humanConfirmationStageState(planState, evaluation),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.human_confirmation,
      rows:
        planState === undefined
          ? frozenArray([
              {
                label: "Decision",
                value:
                  evaluation?.decision.decision === "REQUIRE_APPROVAL"
                    ? "Awaiting the owner decision"
                    : "Not required",
              },
            ])
          : frozenArray([
              { label: "Status", value: planState.status },
              {
                label: "Approver",
                value: planState.approverId ?? "—",
              },
              {
                label: "Rejection reason",
                value: planState.rejectionReason ?? "—",
              },
              {
                label: "Decided at",
                value: planState.transitionedAt ?? "—",
              },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "execution",
      state: executionStageState(planState),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.execution,
      rows:
        planState === undefined
          ? frozenArray([{ label: "Plan", value: "No plan yet" }])
          : frozenArray([
              { label: "Plan", value: planState.planId },
              { label: "Status", value: planState.status },
              { label: "Capability", value: planState.capability },
              { label: "Targets", value: String(planState.targetCount) },
              {
                label: "Handoff",
                value: planState.executionHandoff ?? "—",
              },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "evidence",
      state:
        remediationRequest === undefined
          ? "not_yet_observed"
          : remediationRequest.evidence.length === 0
            ? "not_yet_observed"
            : "ready",
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.evidence,
      rows:
        remediationRequest === undefined
          ? frozenArray([{ label: "Artifacts", value: "None recorded yet" }])
          : frozenArray([
              { label: "Artifacts", value: String(remediationRequest.evidence.length) },
              {
                label: "Algorithms",
                value:
                  remediationRequest.evidence.length === 0
                    ? "—"
                    : [...new Set(remediationRequest.evidence.map((r) => r.hashAlgorithm))]
                        .sort()
                        .join(", "),
              },
            ]),
    }),
    frozen<SecurityDoctorJourneyStage>({
      id: "verified_result",
      state: verifiedResultStageState(input.verification),
      headline: SECURITY_DOCTOR_JOURNEY_HEADLINES.verified_result,
      rows:
        input.verification === undefined
          ? frozenArray([{ label: "Verification", value: "Not yet verified" }])
          : frozenArray([
              { label: "Verified at", value: input.verification.verifiedAt },
              { label: "Summary", value: input.verification.summary },
              { label: "Evidence", value: String(input.verification.evidenceCount) },
            ]),
    }),
  ];

  return frozen({
    tenantId: scope.tenantId,
    findingId,
    deviceId: finding?.deviceId ?? ("" as DeviceId),
    asOf: input.now,
    stages: frozenArray(stages),
    approvalPending:
      evaluation?.decision.decision === "REQUIRE_APPROVAL" &&
      planState === undefined,
    decisionState: deriveDecisionState(input),
  });
}

/** Severity rank for ordering (re-exported for journey consumers). */
export const SEVERITY_RANK: Readonly<Record<SurfaceSeverity, number>> =
  SURFACE_SEVERITY_RANK;
