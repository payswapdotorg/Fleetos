/**
 * @fleetos/web-actions — W142: the honest LANE PHASE vocabulary.
 *
 * The W090B screens render `ScreenPhase` (loading / error / ready) — the
 * RENDER contract. W142 adds the runtime-composition truth the actions
 * lane must carry alongside it (mirrors the security lane's vocabulary
 * so a single composition-root pattern composes both lanes).
 *
 *   loading           the runtime has not resolved the data yet
 *   empty             the tenant honestly has nothing (fresh workspace —
 *                     no plans, no parked approvals, no print jobs)
 *   ready             the view-model composed from real runtime state
 *   blocked           the surface refuses (scope refused, plan not in
 *                     the acting tenant's partition, the RBAC gate
 *                     unmet) — never a fabricated fallback
 *   approval_required a plan is PARKED awaiting a human decision
 *   error             the composition failed machine-stably
 *   unsupported       the action's capability is not declared (visibly
 *                     unsupported — never a disabled fake)
 *
 * PURE + DETERMINISTIC. No `any` in public signatures. Strict TS.
 */

import type { ScreenPhase } from "./ui/primitives";

// ---------------------------------------------------------------------------
// The phase kinds (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable lane phase kinds (the W142 honest-state set). */
export const ACTIONS_LANE_PHASE_KINDS = [
  "loading",
  "empty",
  "ready",
  "blocked",
  "approval_required",
  "error",
  "unsupported",
] as const;

export type ActionsLanePhaseKind = (typeof ACTIONS_LANE_PHASE_KINDS)[number];

/**
 * The lane phase of one actions-lane surface. `empty`, `blocked`,
 * `approval_required` and `unsupported` carry their machine-stable
 * reason; every resolved phase carries the view-model that renders
 * the state honestly.
 */
export type ActionsLanePhase<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reason: string; readonly view: T }
  | { readonly kind: "ready"; readonly view: T }
  | { readonly kind: "blocked"; readonly reason: string; readonly view: T }
  | { readonly kind: "approval_required"; readonly reason: string; readonly view: T }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unsupported"; readonly reason: string; readonly view: T };

// ---------------------------------------------------------------------------
// The machine-stable phase reasons (frozen vocabulary)
// ---------------------------------------------------------------------------

export const ACTIONS_LANE_REASONS = Object.freeze({
  /** The tenant scope grammar refused (fail-closed; no data). */
  scopeRefused: "scope_refused",
  /** The acting tenant has no plans / no parked approvals / no print jobs. */
  noPlans: "no_action_plans",
  noParkedApprovals: "no_parked_approvals",
  noPrintJobs: "no_print_jobs",
  /** The requested plan is not in the acting tenant's partition. */
  planNotInTenant: "plan_not_in_tenant_partition",
  /** A plan is parked for a human decision. */
  approvalPending: "approval_required_before_dispatch",
  /** The action's capability is not declared (visibly unsupported). */
  capabilityUnsupported: "capability_unsupported",
  /** The composition source refused (machine-stable error). */
  compositionRefused: "composition_refused",
  /** The acting principal lacks the required permission (RBAC — explicit). */
  authorizationRefused: "authorization_required",
} as const);

// ---------------------------------------------------------------------------
// Constructors (pure)
// ---------------------------------------------------------------------------

/** The `loading` phase (the async tier's pre-resolution state). */
export function actionsLaneLoading<T>(): ActionsLanePhase<T> {
  return { kind: "loading" };
}

// ---------------------------------------------------------------------------
// The ScreenPhase mapping (total + honest)
// ---------------------------------------------------------------------------

/**
 * Derive the screen's render phase from the lane phase. PURE.
 */
export function toActionsScreenPhase<T>(lanePhase: ActionsLanePhase<T>): ScreenPhase<T> {
  switch (lanePhase.kind) {
    case "loading":
      return { kind: "loading" };
    case "error":
      return { kind: "error", message: lanePhase.message };
    case "empty":
    case "ready":
    case "blocked":
    case "approval_required":
    case "unsupported":
      return { kind: "ready", view: lanePhase.view };
  }
}

/**
 * Is the lane phase terminal-resolved (a view exists the screen can
 * render)? PURE; used by feeds to decide whether the journey composes.
 */
export function actionsLaneHasView<T>(lanePhase: ActionsLanePhase<T>): boolean {
  return (
    lanePhase.kind === "ready" ||
    lanePhase.kind === "empty" ||
    lanePhase.kind === "blocked" ||
    lanePhase.kind === "approval_required" ||
    lanePhase.kind === "unsupported"
  );
}
