/**
 * @fleetos/web-security — W142: the honest LANE PHASE vocabulary.
 *
 * The W090B screens render `ScreenPhase` (loading / error / ready) — the
 * RENDER contract. W142 adds the runtime-composition truth the security
 * lane must carry alongside it: the machine-stable semantic state of a
 * lane surface, distinguished beyond what a render phase can say:
 *
 *   loading           the runtime has not resolved the data yet
 *   empty             the tenant honestly has nothing (fresh workspace —
 *                     no findings, no parked approvals)
 *   ready             the view-model composed from real runtime state
 *   blocked           the surface refuses (scope refused, finding not in
 *                     the acting tenant's partition, the RBAC gate
 *                     unmet) — never a fabricated fallback
 *   approval_required a durable request is PARKED awaiting a human
 *                     decision (the central SIM-B demand)
 *   error             the composition failed machine-stably
 *   unsupported       the action's capability is not declared (visibly
 *                     unsupported — never a disabled fake)
 *
 * Every feed in this lane exposes BOTH: `lanePhase` (this vocabulary —
 * the machine-proven truth the tests assert transition-by-transition)
 * and `phase` (the exact `ScreenPhase` the screen renders, derived by
 * `toScreenPhase`). The mapping is total and honest: `empty` and
 * `blocked` and `approval_required` and `unsupported` are all REAL
 * states with REAL views — they map to `ready` renders that say what
 * they are, never to fabricated content.
 *
 * PURE + DETERMINISTIC. No `any` in public signatures. Strict TS.
 */

import type { ScreenPhase } from "./ui/primitives";

// ---------------------------------------------------------------------------
// The phase kinds (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable lane phase kinds (the W142 honest-state set). */
export const SECURITY_LANE_PHASE_KINDS = [
  "loading",
  "empty",
  "ready",
  "blocked",
  "approval_required",
  "error",
  "unsupported",
] as const;

export type SecurityLanePhaseKind = (typeof SECURITY_LANE_PHASE_KINDS)[number];

/**
 * The lane phase of one security-lane surface. `empty`, `blocked`,
 * `approval_required` and `unsupported` carry their machine-stable
 * reason; every resolved phase carries the view-model that renders the
 * state honestly. When the screen's view is optional (`T` itself
 * includes `undefined`, like the doctor's not-found state), a blocked /
 * unsupported phase carries the `undefined` view.
 */
export type SecurityLanePhase<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly reason: string; readonly view: T }
  | { readonly kind: "ready"; readonly view: T }
  | { readonly kind: "blocked"; readonly reason: string; readonly view: T }
  | { readonly kind: "approval_required"; readonly reason: string; readonly view: T }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unsupported"; readonly reason: string; readonly view: T };

// ---------------------------------------------------------------------------
// The machine-stable phase reasons (frozen vocabulary — the tests assert
// these exact strings; never free-form prose)
// ---------------------------------------------------------------------------

export const SECURITY_LANE_REASONS = Object.freeze({
  /** The tenant scope grammar refused (fail-closed; no data). */
  scopeRefused: "scope_refused",
  /** The acting tenant has no findings / no parked approvals (fresh workspace). */
  noFindings: "no_findings_recorded",
  noParkedApprovals: "no_parked_approvals",
  /** The requested finding is not in the acting tenant's partition. */
  findingNotInTenant: "finding_not_in_tenant_partition",
  /** A durable remediation request is parked for a human decision. */
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
export function securityLaneLoading<T>(): SecurityLanePhase<T> {
  return { kind: "loading" };
}

// ---------------------------------------------------------------------------
// The ScreenPhase mapping (total + honest)
// ---------------------------------------------------------------------------

/**
 * Derive the screen's render phase from the lane phase. PURE.
 *
 *   loading            -> loading (the skeleton)
 *   error              -> error (the actionable alert)
 *   empty / ready /
 *   blocked /
 *   approval_required /
 *   unsupported        -> ready (the view-model carries the honest state;
 *                          the screens render empty states, refusals and
 *                          gates from REAL content — never fabricated)
 */
export function toSecurityScreenPhase<T>(lanePhase: SecurityLanePhase<T>): ScreenPhase<T> {
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
export function securityLaneHasView<T>(lanePhase: SecurityLanePhase<T>): boolean {
  return (
    lanePhase.kind === "ready" ||
    lanePhase.kind === "empty" ||
    lanePhase.kind === "blocked" ||
    lanePhase.kind === "approval_required" ||
    lanePhase.kind === "unsupported"
  );
}
