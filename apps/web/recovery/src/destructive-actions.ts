/**
 * @fleetos/web-recovery — D4: the destructive action surfaces (W040 D3
 * + W031 Guardian decision context).
 *
 * The destructive recovery actions — lock / locate / wipe / reboot —
 * displayed with the W031 Contract Guardian decision context and
 * NEVER as one-click direct execution. The UI surface exposes the
 * GATED PATH ONLY:
 *
 *   - The affordance type `DestructiveActionAffordance` has EXACTLY
 *     ONE variant — `{ kind: "gated_path_only" }`. There is no
 *     direct-execution variant in the surface contracts: the type
 *     system itself makes "one-click wipe" unrepresentable
 *     (`spec/ARCHITECTURE-LOCK.md` items 16 + 19).
 *   - Every affordance carries the full gate-step ledger: tenant
 *     scope, active recovery case, adapter capability, Guardian
 *     evaluation, human approval, execution dispatch — each step
 *     machine-stably met / unmet / pending. The steps DISPLAY the
 *     domain's gate order; they do not perform it.
 *   - The Guardian decision context view surfaces the FROZEN
 *     contracts decision (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK),
 *     the blocking semantics (the frozen `isBlockingDecision`), the
 *     matched rule refs, the machine-stable reasons, and the OPAQUE
 *     evidence refs — verbatim, never interpreted.
 *   - The request view-model surfaces the versioned append-only
 *     history (REQUESTED -> ADVANCED/PARKED/REJECTED -> ... ->
 *     EXECUTED/FAILED), the approval state, the refusal reason, and
 *     the execution dispatch evidence — all read-only.
 *
 * The action kind union is derived from the FROZEN
 * `RecoveryIntentPayload` (contracts) — never re-declared.
 *
 * PURE + DETERMINISTIC: no clock, no randomness, no I/O. No `any` in
 * public signatures. Strict TS.
 */

import { isBlockingDecision } from "@fleetos/contracts";
import type {
  GuardianDecision,
  GuardianDecisionType,
  RecoveryIntentPayload,
  TenantId,
} from "@fleetos/contracts";
import { SYNTHETIC_SYSTEM_TENANT, checkRecoveryUiTenantScope, frozen, frozenArray } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import type {
  DestructiveRequestLike,
  DestructiveRequestSource,
  StatusMachineTable,
} from "./seams";
import type { CaseStateMachineView } from "./recovery-case";

// ---------------------------------------------------------------------------
// The action kind (derived from the FROZEN payload — never re-declared)
// ---------------------------------------------------------------------------

/**
 * The destructive recovery action set — the action union of the FROZEN
 * `RecoveryIntentPayload`, derived from the frozen shape (the same
 * derivation the recovery domain itself uses).
 */
export type DestructiveActionKind = RecoveryIntentPayload["action"];

// ---------------------------------------------------------------------------
// The Guardian decision context view (the W031 surface)
// ---------------------------------------------------------------------------

/**
 * The W031 Contract Guardian decision context, surfaced read-only: the
 * decision type (the FROZEN contracts union), the blocking semantics
 * (the frozen `isBlockingDecision` helper), the matched rule refs, the
 * machine-stable evaluation reasons, and the OPAQUE evidence refs
 * (verbatim, never interpreted).
 */
export interface GuardianDecisionContextView {
  readonly decision: GuardianDecisionType;
  /** The frozen blocking semantics: REQUIRE_APPROVAL and BLOCK hold/refuse. */
  readonly isBlocking: boolean;
  readonly decidedAt: string | undefined;
  readonly matchedRules: readonly { readonly ruleId: string; readonly version: number }[];
  readonly reasons: readonly { readonly code: string; readonly ruleId: string | undefined }[];
  /** OPAQUE content-addressable evidence refs, verbatim. */
  readonly evidence: readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[];
}

/**
 * Project the frozen Guardian decision (plus the request's matched
 * rules + reasons) into the decision context view. PURE; the decision
 * fields pass through verbatim — the surface never re-evaluates.
 */
export function guardianDecisionContext(
  decision: GuardianDecision,
  matchedRules: readonly { readonly ruleId: string; readonly version: number }[] | undefined,
  reasons: readonly { readonly code: string; readonly ruleId?: string }[] | undefined,
): GuardianDecisionContextView {
  return frozen({
    decision: decision.decision,
    isBlocking: isBlockingDecision(decision.decision),
    decidedAt: decision.decidedAt,
    matchedRules: frozenArray(
      (matchedRules ?? []).map((rule) => frozen({ ruleId: rule.ruleId, version: rule.version })),
    ),
    reasons: frozenArray(
      (reasons ?? []).map((reason) => frozen({ code: reason.code, ruleId: reason.ruleId })),
    ),
    evidence: frozenArray(
      decision.evidence.map((ref) =>
        frozen({
          key: ref.key,
          sizeBytes: ref.sizeBytes,
          hash: ref.hash,
          hashAlgorithm: ref.hashAlgorithm,
        }),
      ),
    ),
  });
}

// ---------------------------------------------------------------------------
// The gated-path-only affordance (NO direct-execution variant exists)
// ---------------------------------------------------------------------------

/** The machine-stable gate-step ids, in the domain's gate order. */
export const DESTRUCTIVE_GATE_STEP_IDS = [
  "tenant_scope",
  "active_recovery_case",
  "adapter_capability",
  "guardian_evaluation",
  "human_approval",
  "execution_dispatch",
] as const;

export type DestructiveGateStepId = (typeof DESTRUCTIVE_GATE_STEP_IDS)[number];

/** The machine-stable state of one gate step. */
export type GateStepState = "unmet" | "pending" | "met";

/** One displayed gate step: the machine-stable id + its state. */
export interface DestructiveGateStep {
  readonly id: DestructiveGateStepId;
  readonly state: GateStepState;
}

/**
 * THE destructive action affordance. Exactly ONE variant exists —
 * `gated_path_only`. There is no `direct_execution` variant: the
 * surface contracts make one-click destructive execution
 * UNREPRESENTABLE (`spec/ARCHITECTURE-LOCK.md` items 16 + 19). The
 * affordance carries the requirement flags (all `true`, permanently —
 * the surface cannot waive them), the Guardian decision context (or
 * `not_evaluated`), the approval state, and the gate-step ledger.
 */
export interface DestructiveActionAffordance {
  readonly kind: "gated_path_only";
  readonly action: string;
  readonly requiresActiveCase: true;
  readonly requiresGuardianEvaluation: true;
  readonly requiresEvidenceTrail: true;
  /** REQUIRE_APPROVAL decision => a human must approve before dispatch. */
  readonly approvalRequired: boolean;
  /** The plan/request is PARKED awaiting the human decision. */
  readonly approvalPending: boolean;
  /** The recorded human approval, when decided. */
  readonly approvalDecided: { readonly by: string; readonly at: string } | undefined;
  /** The Guardian decision context, or the machine-stable `not_evaluated`. */
  readonly guardian: GuardianDecisionContextView | "not_evaluated";
  readonly steps: readonly DestructiveGateStep[];
}

/** Derive the gate-step ledger. PURE (machine-stable ids + states). */
function gateSteps(
  caseGateMet: boolean,
  request: DestructiveRequestLike | undefined,
): readonly DestructiveGateStep[] {
  const decision = request?.decision;
  const status = request?.status;
  const dispatched = request?.execution !== undefined;
  const refused = request?.refusalReason !== undefined;

  const humanApproval: GateStepState =
    request === undefined || decision === undefined
      ? "unmet" // nothing has been evaluated to approve
      : decision.decision === "REQUIRE_APPROVAL"
        ? status === "PARKED"
          ? "pending" // awaiting the human decision
          : "met" // the human decided (approve or reject)
        : decision.decision === "BLOCK"
          ? "unmet" // the path was refused before any approval step
          : "met"; // ALLOW/WARN — no human step required

  const executionDispatch: GateStepState = dispatched
    ? "met"
    : decision !== undefined && !refused && (decision.decision === "ALLOW" || decision.decision === "WARN")
      ? "pending" // granted, dispatch in progress
      : "unmet";

  return frozenArray([
    frozen<DestructiveGateStep>({ id: "tenant_scope", state: "met" }), // the surface is tenant-scoped by construction
    frozen<DestructiveGateStep>({
      id: "active_recovery_case",
      state: caseGateMet ? "met" : "unmet",
    }),
    frozen<DestructiveGateStep>({
      id: "adapter_capability",
      state: request === undefined ? "unmet" : refused ? "unmet" : "met",
    }),
    frozen<DestructiveGateStep>({
      id: "guardian_evaluation",
      state: decision !== undefined ? "met" : "unmet",
    }),
    frozen<DestructiveGateStep>({ id: "human_approval", state: humanApproval }),
    frozen<DestructiveGateStep>({ id: "execution_dispatch", state: executionDispatch }),
  ]);
}

/**
 * Derive the gated-path-only affordance for one destructive action on
 * one case. PURE: the affordance is a projection of the case gate +
 * the LATEST request revision (when a request exists); it never
 * performs, proposes, or dispatches anything.
 *
 * @param action the destructive action kind
 * @param caseMachine the case's read-only state machine (the ACTIVE gate)
 * @param request the LATEST request revision for (case, action), when one exists
 */
export function destructiveActionAffordance(
  action: string,
  caseMachine: CaseStateMachineView,
  request: DestructiveRequestLike | undefined,
): DestructiveActionAffordance {
  const decision = request?.decision;
  const approvalRequired = decision?.decision === "REQUIRE_APPROVAL" || request?.approvedBy !== undefined;
  const approvalPending = request?.status === "PARKED";
  const approvalDecided =
    request?.approvedBy !== undefined && request?.approvalDecidedAt !== undefined
      ? frozen({ by: request.approvedBy, at: request.approvalDecidedAt })
      : undefined;

  return frozen({
    kind: "gated_path_only",
    action,
    requiresActiveCase: true,
    requiresGuardianEvaluation: true,
    requiresEvidenceTrail: true,
    approvalRequired,
    approvalPending,
    approvalDecided,
    guardian:
      decision !== undefined
        ? guardianDecisionContext(decision, request?.matchedRules, request?.reasons)
        : "not_evaluated",
    steps: gateSteps(caseMachine.isActive, request),
  });
}

// ---------------------------------------------------------------------------
// The request view-model (versioned, read-only)
// ---------------------------------------------------------------------------

/** One append-only request revision, surfaced read-only. */
export interface DestructiveRevisionView {
  readonly version: number;
  readonly recordId: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly decidedAt: string | undefined;
  readonly approvalDecidedAt: string | undefined;
  readonly closedAt: string | undefined;
  readonly refusalReason: string | undefined;
  readonly execution: { readonly attemptedAt: string; readonly outcome: string } | undefined;
  readonly contentDigest: string;
}

/**
 * The destructive request view-model: the action, the read-only status
 * machine, the Guardian decision context, the approval state, the
 * versioned append-only history, the OPAQUE evidence trail, and the
 * refusal reason (machine-stable, verbatim).
 */
export interface DestructiveRequestViewModel {
  readonly tenantId: TenantId | typeof SYNTHETIC_SYSTEM_TENANT;
  readonly requestId: string;
  readonly deviceId: string;
  readonly caseId: string;
  readonly action: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly requestedBy: string | undefined;
  readonly stateMachine: PlanMachineLikeView;
  readonly guardian: GuardianDecisionContextView | "not_evaluated";
  readonly approval: {
    readonly required: boolean;
    readonly pending: boolean;
    readonly decided: { readonly by: string; readonly at: string } | undefined;
  };
  readonly refusalReason: string | undefined;
  readonly execution:
    | { readonly attemptedAt: string; readonly outcome: string; readonly evidenceCount: number }
    | undefined;
  readonly history: readonly DestructiveRevisionView[];
  /** OPAQUE content-addressable evidence refs (the §16 trail), verbatim. */
  readonly evidence: readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[];
}

/** The read-only request status machine view (injected table). */
export interface PlanMachineLikeView {
  readonly current: string;
  readonly legalNext: readonly string[];
  readonly isTerminal: boolean;
}

/**
 * Build the destructive request view-model. PURE and DETERMINISTIC;
 * `undefined` when the request is not in the acting tenant's partition.
 */
export function buildDestructiveRequestViewModel(
  scope: RecoveryUiTenantScope,
  source: DestructiveRequestSource,
  requestId: string,
  table: StatusMachineTable,
): DestructiveRequestViewModel | undefined {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) return undefined;
  const latest = source.latest(guard.tenantId, requestId);
  if (latest === undefined) return undefined;
  const history = source.history(guard.tenantId, requestId);

  return frozen({
    tenantId: guard.tenantId,
    requestId: latest.requestId,
    deviceId: latest.deviceId as string,
    caseId: latest.caseId,
    action: latest.action,
    status: latest.status,
    requestedAt: latest.requestedAt,
    requestedBy: latest.requestedBy,
    stateMachine: frozen({
      current: latest.status,
      legalNext: frozenArray((table.transitions[latest.status] ?? []) as readonly string[]),
      isTerminal: table.terminal.includes(latest.status),
    }),
    guardian:
      latest.decision !== undefined
        ? guardianDecisionContext(latest.decision, latest.matchedRules, latest.reasons)
        : "not_evaluated",
    approval: frozen({
      required: latest.decision?.decision === "REQUIRE_APPROVAL" || latest.approvedBy !== undefined,
      pending: latest.status === "PARKED",
      decided:
        latest.approvedBy !== undefined && latest.approvalDecidedAt !== undefined
          ? frozen({ by: latest.approvedBy, at: latest.approvalDecidedAt })
          : undefined,
    }),
    refusalReason: latest.refusalReason,
    execution:
      latest.execution !== undefined
        ? frozen({
            attemptedAt: latest.execution.attemptedAt,
            outcome: latest.execution.outcome,
            evidenceCount: latest.execution.adapterEvidence.length,
          })
        : undefined,
    history: frozenArray(
      [...history]
        .sort((a, b) => a.version - b.version)
        .map((revision) =>
          frozen({
            version: revision.version,
            recordId: revision.recordId,
            status: revision.status,
            requestedAt: revision.requestedAt,
            decidedAt: revision.decidedAt,
            approvalDecidedAt: revision.approvalDecidedAt,
            closedAt: revision.decidedAt,
            refusalReason: revision.refusalReason,
            execution:
              revision.execution !== undefined
                ? frozen({ attemptedAt: revision.execution.attemptedAt, outcome: revision.execution.outcome })
                : undefined,
            contentDigest: revision.contentDigest,
          }),
        ),
    ),
    evidence: frozenArray(
      latest.evidence.map((ref) =>
        frozen({
          key: ref.key,
          sizeBytes: ref.sizeBytes,
          hash: ref.hash,
          hashAlgorithm: ref.hashAlgorithm,
        }),
      ),
    ),
  });
}
