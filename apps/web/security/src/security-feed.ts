/**
 * @fleetos/web-security — W142: the Security Doctor RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composeSecurityDoctorFeed`; the returned feed is everything the
 * SecurityDoctorScreen renders: the screen's exact `ScreenPhase` prop,
 * the machine-proven `lanePhase` (loading / empty / ready / blocked /
 * approval_required / error / unsupported — every transition honest),
 * the full nine-stage JOURNEY (finding -> inspect -> proposed
 * remediation -> Contract Guardian decision -> approval -> human
 * confirmation -> execution -> evidence -> verified result), the
 * linked Guardian decision context, the parked approval item, the
 * post-decision plan state, and the verification record.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL W031 Security Doctor's findings ledger, the
 *     REAL `@fleetos/policy` Guardian engine's evaluation, the REAL
 *     `@fleetos/actions` action plan + the parked approval queue, the
 *     REAL action-boundary verification records). Nothing is
 *     fabricated; a fresh tenant composes the honest `empty` phase
 *     (no findings — never demo data).
 *   - NO EXISTENCE SIDE CHANNEL: a finding outside the acting
 *     tenant's partition is `blocked` with the finding-not-in-tenant
 *     reason — indistinguishable from unknown, and the journey stays
 *     `undefined` (the screen renders its honest not-found state).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feed only
 *     ever DESCRIBES records; this module performs, proposes and
 *     dispatches NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { SurfaceTenantScope } from "./surface-contracts";
import { buildSecurityDoctorJourney } from "./security-journey";
import type { SecurityDoctorJourney } from "./security-journey";
import type { ScreenPhase } from "./ui/primitives";
import type {
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  SecurityFindingRecord,
} from "./surface-contracts";
import {
  SECURITY_LANE_REASONS,
  securityLaneLoading,
  toSecurityScreenPhase,
} from "./lane-phase";
import type { SecurityLanePhase } from "./lane-phase";
import type {
  DecisionPlanState,
  SecurityApprovalSource,
  SecurityDecisionPlanSource,
  SecurityEvaluationSource,
  SecurityFindingSource,
  SecurityRemediationRequestLike,
  SecurityRemediationRequestSource,
  SecurityVerificationSource,
  VerificationRecord,
} from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The security lane's runtime state for the Security Doctor surface: the
 * tenant-partitioned sources the feed composes from. INJECTED at the
 * binding site (the console composition root binds the REAL packages;
 * the machine tests bind them the same way).
 */
export interface SecurityDoctorRuntimeState {
  /** The REAL W031 Security Doctor findings ledger (derived active view). */
  readonly findings: SecurityFindingSource;
  /** The REAL `@fleetos/policy` Guardian engine's evaluation records. */
  readonly evaluations: SecurityEvaluationSource;
  /** The durable security-remediation request records. */
  readonly remediation: SecurityRemediationRequestSource;
  /** The parked approval items (the W041 parked plan + parking decision pair). */
  readonly approvals: SecurityApprovalSource;
  /** The post-decision plan state (when the human decided or the Guardian refused). */
  readonly plans: SecurityDecisionPlanSource;
  /** The verification records (when execution completed and was verified). */
  readonly verifications: SecurityVerificationSource;
}

/** Options for the doctor feed composition. */
export interface SecurityDoctorFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// The composite data the screen renders (presentational composition)
// ---------------------------------------------------------------------------

/**
 * The composed data the SecurityDoctorScreen renders. Each field is a
 * real projection from the runtime state contract; absent runtime state
 * yields the honest `null` (the screen renders its not-found / not-yet
 * states — never fabricated content).
 */
export interface SecurityDoctorFeedData {
  /** The finding under remediation (or null when not in the acting tenant). */
  readonly finding: SecurityFindingRecord | null;
  /** The Guardian evaluation that produced the parking decision (or null). */
  readonly evaluation: GuardianEvaluationRecord | null;
  /** The parked approval item (when the decision parked a plan). */
  readonly approval: ParkedApprovalItemInput | null;
  /** The post-decision plan state (when the human decided). */
  readonly planState: DecisionPlanState | null;
  /** The verification record (when execution was verified). */
  readonly verification: VerificationRecord | null;
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/**
 * The Security Doctor feed: everything the screen renders, composed from
 * real runtime state. `phase` is the screen's prop (derived);
 * `lanePhase` is the machine-proven semantic state; `journey` is the
 * nine-stage walk; `data` is the composite projection.
 */
export interface SecurityDoctorFeed {
  /** The EXACT phase prop the SecurityDoctorScreen takes. */
  readonly phase: ScreenPhase<SecurityDoctorFeedData>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: SecurityLanePhase<SecurityDoctorFeedData>;
  /** The full nine-stage diagnosis journey (undefined while loading/error). */
  readonly journey: SecurityDoctorJourney | undefined;
  /** The composite data the screen renders. */
  readonly data: SecurityDoctorFeedData;
}

/** The loading feed (the async tier's pre-resolution state). PURE. */
export function loadingSecurityDoctorFeed(): SecurityDoctorFeed {
  const emptyData: SecurityDoctorFeedData = frozen({
    finding: null,
    evaluation: null,
    approval: null,
    planState: null,
    verification: null,
  });
  return frozen({
    phase: { kind: "loading" },
    lanePhase: securityLaneLoading<SecurityDoctorFeedData>(),
    journey: undefined,
    data: emptyData,
  });
}

/** The error feed (the source refused; machine-stable message). PURE. */
export function errorSecurityDoctorFeed(message: string): SecurityDoctorFeed {
  const emptyData: SecurityDoctorFeedData = frozen({
    finding: null,
    evaluation: null,
    approval: null,
    planState: null,
    verification: null,
  });
  const lanePhase: SecurityLanePhase<SecurityDoctorFeedData> = {
    kind: "error",
    message,
  };
  return frozen({
    phase: { kind: "error", message },
    lanePhase,
    journey: undefined,
    data: emptyData,
  });
}

/** Resolve the acting tenant id (the scope guard, typed). PURE. */
function actingTenantId(scope: SurfaceTenantScope): TenantId | undefined {
  const record = scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  return typeof record?.tenantId === "string" && record.tenantId.length > 0
    ? (record.tenantId as TenantId)
    : undefined;
}

/**
 * Compose the Security Doctor feed from the runtime state. PURE and
 * DETERMINISTIC: the same (scope, state, findingId, options) produce a
 * byte-identical feed.
 *
 * Phase transitions (all machine-proven by the composition tests):
 *   - refused scope grammar            -> blocked (scope_refused; no data)
 *   - finding not in the partition     -> blocked (finding_not_in_tenant_partition)
 *   - fresh tenant / no findings       -> empty only for the LANE LIST feed;
 *     the doctor detail for an absent finding stays blocked (honest)
 *   - finding present, no evaluation   -> ready (not_yet_observed states)
 *   - a PARKED remediation request     -> approval_required (view composed)
 *   - a refused source                 -> error (machine-stable)
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param state the injected runtime state (the REAL sources)
 * @param findingId the finding the doctor detail is requested for
 * @param options the injected reference instant
 */
export function composeSecurityDoctorFeed(
  scope: SurfaceTenantScope,
  state: SecurityDoctorRuntimeState,
  findingId: string,
  options: SecurityDoctorFeedOptions,
): SecurityDoctorFeed {
  // Fail-closed: an invalid instant or scope grammar never reaches a source.
  if (typeof options?.now !== "string" || options.now.length === 0) {
    return errorSecurityDoctorFeed("The security doctor feed requires an injected reference instant.");
  }
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    const emptyData: SecurityDoctorFeedData = frozen({
      finding: null,
      evaluation: null,
      approval: null,
      planState: null,
      verification: null,
    });
    const lanePhase: SecurityLanePhase<SecurityDoctorFeedData> = {
      kind: "blocked",
      reason: SECURITY_LANE_REASONS.scopeRefused,
      view: emptyData,
    };
    return frozen({
      phase: toSecurityScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
      data: emptyData,
    });
  }

  // The composition reads the REAL sources through the seams. A source
  // that throws refuses machine-stably -> the error feed (never data).
  let finding: SecurityFindingRecord | undefined;
  let evaluation: GuardianEvaluationRecord | undefined;
  let remediationRequests: readonly SecurityRemediationRequestLike[];
  let parkedApproval: ParkedApprovalItemInput | undefined;
  let planState: DecisionPlanState | undefined;
  let verification: VerificationRecord | undefined;
  try {
    finding = state.findings.get(tenantId, findingId);
    remediationRequests = state.remediation.requests(tenantId, findingId);
    evaluation = state.evaluations.evaluationFor(tenantId, findingId);
    // The binding site links the remediation request to its parked plan
    // through the explicit `planId` field (when the Guardian parked it).
    // When no planId is available, the approval + plan state stay
    // honestly undefined (the screen renders not_yet_observed).
    const latestRequest =
      remediationRequests.length > 0
        ? (remediationRequests[remediationRequests.length - 1] as SecurityRemediationRequestLike)
        : undefined;
    const linkedPlanId = latestRequest?.planId;
    if (linkedPlanId !== undefined) {
      parkedApproval = state.approvals.parkedByPlan(tenantId, linkedPlanId);
      planState = state.plans.stateFor(tenantId, linkedPlanId);
    }
    verification = state.verifications.verificationFor(tenantId, findingId);
  } catch {
    return errorSecurityDoctorFeed("The security doctor feed's runtime state refused to resolve.");
  }

  // The honest blocked state: the finding is not in the acting tenant's
  // partition (no existence side channel; never fabricated).
  if (finding === undefined) {
    const emptyData: SecurityDoctorFeedData = frozen({
      finding: null,
      evaluation: null,
      approval: null,
      planState: null,
      verification: null,
    });
    const lanePhase: SecurityLanePhase<SecurityDoctorFeedData> = {
      kind: "blocked",
      reason: SECURITY_LANE_REASONS.findingNotInTenant,
      view: emptyData,
    };
    const journey = buildSecurityDoctorJourney({ tenantId }, findingId, {
      finding: undefined,
      evaluation: undefined,
      remediationRequests: [],
      parkedApproval: undefined,
      planState: undefined,
      verification: undefined,
      now: options.now,
    });
    return frozen({
      phase: toSecurityScreenPhase(lanePhase),
      lanePhase,
      journey,
      data: emptyData,
    });
  }

  // Compose the journey from real runtime state.
  const journey = buildSecurityDoctorJourney({ tenantId }, findingId, {
    finding,
    evaluation,
    remediationRequests,
    parkedApproval,
    planState,
    verification,
    now: options.now,
  });

  const data: SecurityDoctorFeedData = frozen({
    finding,
    evaluation: evaluation ?? null,
    approval: parkedApproval ?? null,
    planState: planState ?? null,
    verification: verification ?? null,
  });

  // The approval-required lane phase: a PARKED remediation request holds
  // a human decision (the honest semantic — the view still composes).
  const parked =
    evaluation !== undefined &&
    evaluation.decision.decision === "REQUIRE_APPROVAL" &&
    parkedApproval !== undefined &&
    (planState === undefined || planState.status === "PARKED");
  const lanePhase: SecurityLanePhase<SecurityDoctorFeedData> = parked
    ? { kind: "approval_required", reason: SECURITY_LANE_REASONS.approvalPending, view: data }
    : { kind: "ready", view: data };

  return frozen({
    phase: toSecurityScreenPhase(lanePhase),
    lanePhase,
    journey,
    data,
  });
}

/**
 * The security findings list feed's honest semantic phase (the LANE
 * empty-state proof): a fresh tenant (no findings in the partition)
 * composes the machine-stable `empty` — never demo data.
 */
export function securityFindingsLanePhase(
  scope: SurfaceTenantScope,
  findings: SecurityFindingSource,
): SecurityLanePhase<readonly SecurityFindingRecord[]> {
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    return {
      kind: "blocked",
      reason: SECURITY_LANE_REASONS.scopeRefused,
      view: [] as readonly SecurityFindingRecord[],
    };
  }
  let listed: readonly SecurityFindingRecord[];
  try {
    listed = findings.list(tenantId);
  } catch {
    return { kind: "error", message: "The findings list's runtime state refused to resolve." };
  }
  if (listed.length === 0) {
    return { kind: "empty", reason: SECURITY_LANE_REASONS.noFindings, view: listed };
  }
  return { kind: "ready", view: listed };
}

/**
 * The parked-approvals list feed's honest semantic phase. A fresh tenant
 * (no parked approvals) composes the machine-stable `empty`.
 */
export function parkedApprovalsLanePhase(
  scope: SurfaceTenantScope,
  approvals: SecurityApprovalSource,
): SecurityLanePhase<readonly ParkedApprovalItemInput[]> {
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    return {
      kind: "blocked",
      reason: SECURITY_LANE_REASONS.scopeRefused,
      view: [] as readonly ParkedApprovalItemInput[],
    };
  }
  let listed: readonly ParkedApprovalItemInput[];
  try {
    listed = approvals.parked(tenantId);
  } catch {
    return { kind: "error", message: "The approvals list's runtime state refused to resolve." };
  }
  if (listed.length === 0) {
    return { kind: "empty", reason: SECURITY_LANE_REASONS.noParkedApprovals, view: listed };
  }
  return { kind: "ready", view: listed };
}
