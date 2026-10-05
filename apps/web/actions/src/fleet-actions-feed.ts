/**
 * @fleetos/web-actions — W142: the Fleet Actions RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composeFleetActionsFeed`; the returned feed is everything the
 * FleetActionsScreen renders: the screen's exact `ScreenPhase` prop,
 * the machine-proven `lanePhase` (loading / empty / ready / blocked /
 * approval_required / error / unsupported — every transition honest),
 * the full eight-stage JOURNEY (intent -> proposal -> Guardian gate ->
 * approval -> dispatch -> per-target result -> verification ->
 * evidence), the linked Guardian decision, and the verification record.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL `@fleetos/actions` plan ledger, the REAL
 *     `@fleetos/policy` Guardian engine's evaluation, the REAL
 *     action-boundary verification records). Nothing is fabricated; a
 *     fresh tenant composes the honest `empty` phase.
 *   - NO EXISTENCE SIDE CHANNEL: a plan outside the acting tenant's
 *     partition is `blocked` with the plan-not-in-tenant reason —
 *     indistinguishable from unknown, and the journey stays `undefined`.
 *   - A PROPOSAL IS NEVER AN EXECUTED ACTION: the feed only ever
 *     DESCRIBES records; this module performs, proposes and dispatches
 *     NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { SurfaceTenantScope } from "./surface-contracts";
import type { GuardianDecisionRecord, SurfaceActionPlanRecord } from "./surface-contracts";
import { buildFleetActionJourney } from "./fleet-actions-journey";
import type { FleetActionJourney } from "./fleet-actions-journey";
import type { ScreenPhase } from "./ui/primitives";
import {
  ACTIONS_LANE_REASONS,
  actionsLaneLoading,
  toActionsScreenPhase,
} from "./lane-phase";
import type { ActionsLanePhase } from "./lane-phase";
import type {
  ActionPlanSource,
  FleetActionVerificationRecord,
  FleetActionVerificationSource,
  PlanDecisionSource,
} from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The actions lane's runtime state for the Fleet Actions surface: the
 * tenant-partitioned sources the feed composes from. INJECTED at the
 * binding site (the console composition root binds the REAL packages;
 * the machine tests bind them the same way).
 */
export interface FleetActionsRuntimeState {
  /** The REAL `@fleetos/actions` plan ledger. */
  readonly plans: ActionPlanSource;
  /** The REAL `@fleetos/policy` Guardian decision source (linked per plan). */
  readonly decisions: PlanDecisionSource;
  /** The verification records (when execution completed and was verified). */
  readonly verifications: FleetActionVerificationSource;
}

/** Options for the fleet-actions feed composition. */
export interface FleetActionsFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// The composite data the screen renders
// ---------------------------------------------------------------------------

/**
 * The composed data the FleetActionsScreen renders. Each field is a
 * real projection from the runtime state contract; absent runtime state
 * yields the honest `null`.
 */
export interface FleetActionsFeedData {
  /** The plan (or null when not in the acting tenant). */
  readonly plan: SurfaceActionPlanRecord | null;
  /** The linked Guardian decision (or null). */
  readonly decision: GuardianDecisionRecord | null;
  /** The verification record (or null). */
  readonly verification: FleetActionVerificationRecord | null;
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/**
 * The Fleet Actions feed: everything the screen renders, composed from
 * real runtime state.
 */
export interface FleetActionsFeed {
  /** The EXACT phase prop the FleetActionsScreen takes. */
  readonly phase: ScreenPhase<FleetActionsFeedData>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: ActionsLanePhase<FleetActionsFeedData>;
  /** The full eight-stage fleet-action journey (undefined while loading/error). */
  readonly journey: FleetActionJourney | undefined;
  /** The composite data the screen renders. */
  readonly data: FleetActionsFeedData;
}

/** The loading feed (the async tier's pre-resolution state). PURE. */
export function loadingFleetActionsFeed(): FleetActionsFeed {
  const emptyData: FleetActionsFeedData = frozen({
    plan: null,
    decision: null,
    verification: null,
  });
  return frozen({
    phase: { kind: "loading" },
    lanePhase: actionsLaneLoading<FleetActionsFeedData>(),
    journey: undefined,
    data: emptyData,
  });
}

/** The error feed (the source refused; machine-stable message). PURE. */
export function errorFleetActionsFeed(message: string): FleetActionsFeed {
  const emptyData: FleetActionsFeedData = frozen({
    plan: null,
    decision: null,
    verification: null,
  });
  const lanePhase: ActionsLanePhase<FleetActionsFeedData> = {
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
 * Compose the Fleet Actions feed from the runtime state. PURE and
 * DETERMINISTIC.
 *
 * Phase transitions (all machine-proven by the composition tests):
 *   - refused scope grammar          -> blocked (scope_refused; no data)
 *   - plan not in the partition      -> blocked (plan_not_in_tenant_partition)
 *   - fresh tenant / no plans        -> empty only for the LANE LIST feed
 *   - plan present, no decision      -> ready (not_yet_observed states)
 *   - a PARKED plan                  -> approval_required (view composed)
 *   - a refused source               -> error (machine-stable)
 */
export function composeFleetActionsFeed(
  scope: SurfaceTenantScope,
  state: FleetActionsRuntimeState,
  planId: string,
  options: FleetActionsFeedOptions,
): FleetActionsFeed {
  // Fail-closed: an invalid instant or scope grammar never reaches a source.
  if (typeof options?.now !== "string" || options.now.length === 0) {
    return errorFleetActionsFeed("The fleet actions feed requires an injected reference instant.");
  }
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    const emptyData: FleetActionsFeedData = frozen({
      plan: null,
      decision: null,
      verification: null,
    });
    const lanePhase: ActionsLanePhase<FleetActionsFeedData> = {
      kind: "blocked",
      reason: ACTIONS_LANE_REASONS.scopeRefused,
      view: emptyData,
    };
    return frozen({
      phase: toActionsScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
      data: emptyData,
    });
  }

  // The composition reads the REAL sources through the seams. A source
  // that throws refuses machine-stably -> the error feed (never data).
  let plan: SurfaceActionPlanRecord | undefined;
  let decision: GuardianDecisionRecord | undefined;
  let verification: FleetActionVerificationRecord | undefined;
  try {
    plan = state.plans.get(tenantId, planId);
    decision = state.decisions.decisionFor(tenantId, planId);
    verification = state.verifications.verificationFor(tenantId, planId);
  } catch {
    return errorFleetActionsFeed("The fleet actions feed's runtime state refused to resolve.");
  }

  // The honest blocked state: the plan is not in the acting tenant's
  // partition (no existence side channel; never fabricated).
  if (plan === undefined) {
    const emptyData: FleetActionsFeedData = frozen({
      plan: null,
      decision: null,
      verification: null,
    });
    const lanePhase: ActionsLanePhase<FleetActionsFeedData> = {
      kind: "blocked",
      reason: ACTIONS_LANE_REASONS.planNotInTenant,
      view: emptyData,
    };
    const journey = buildFleetActionJourney({ tenantId }, planId, {
      plan: undefined,
      linkedDecision: undefined,
      verification: undefined,
      now: options.now,
    });
    return frozen({
      phase: toActionsScreenPhase(lanePhase),
      lanePhase,
      journey,
      data: emptyData,
    });
  }

  // Compose the journey from real runtime state.
  const journey = buildFleetActionJourney({ tenantId }, planId, {
    plan,
    linkedDecision: decision,
    verification,
    now: options.now,
  });

  const data: FleetActionsFeedData = frozen({
    plan,
    decision: decision ?? null,
    verification: verification ?? null,
  });

  // The approval-required lane phase: a PARKED plan holds a human
  // decision (the honest semantic — the view still composes).
  const parked = plan.status === "PARKED";
  const lanePhase: ActionsLanePhase<FleetActionsFeedData> = parked
    ? { kind: "approval_required", reason: ACTIONS_LANE_REASONS.approvalPending, view: data }
    : { kind: "ready", view: data };

  return frozen({
    phase: toActionsScreenPhase(lanePhase),
    lanePhase,
    journey,
    data,
  });
}

/**
 * The fleet action plans list feed's honest semantic phase. A fresh
 * tenant (no plans) composes the machine-stable `empty`.
 */
export function fleetActionsLanePhase(
  scope: SurfaceTenantScope,
  plans: ActionPlanSource,
): ActionsLanePhase<readonly SurfaceActionPlanRecord[]> {
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    return {
      kind: "blocked",
      reason: ACTIONS_LANE_REASONS.scopeRefused,
      view: [] as readonly SurfaceActionPlanRecord[],
    };
  }
  let listed: readonly SurfaceActionPlanRecord[];
  try {
    listed = plans.list(tenantId);
  } catch {
    return { kind: "error", message: "The plans list's runtime state refused to resolve." };
  }
  if (listed.length === 0) {
    return { kind: "empty", reason: ACTIONS_LANE_REASONS.noPlans, view: listed };
  }
  return { kind: "ready", view: listed };
}
