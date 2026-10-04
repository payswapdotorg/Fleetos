/**
 * @fleetos/web-commerce — the honest LANE PHASE vocabulary (W143).
 *
 * The W090C screens render `ScreenPhase` (loading / error / invalid /
 * ready) — the RENDER contract. W143 adds the runtime-composition truth
 * the commerce lane must carry alongside it: the machine-stable semantic
 * state of a lane surface, distinguished beyond what a render phase can
 * say:
 *
 *   loading           the runtime has not resolved the data yet
 *   empty             the tenant honestly has no procurement cases /
 *                     vendors (fresh workspace — never demo data)
 *   ready             the view-model composed from real runtime state
 *   blocked           the surface refuses (scope refused, the demand is
 *                     not in the acting tenant's partition, the
 *                     procurement gate's precondition unmet) — never a
 *                     fabricated fallback
 *   approval_required a durable quote acceptance / connectivity
 *                     submission is PARKED awaiting a human decision
 *   error             the composition failed machine-stably
 *   unsupported       the matching engine produced no satisfiable
 *                     vendor for the demand (honest absence — never a
 *                     fabricated match)
 *
 * Every feed in this lane exposes BOTH: `lanePhase` (this vocabulary —
 * the machine-proven truth the tests assert transition-by-transition)
 * and `phase` (the exact `ScreenPhase` the screen renders, derived by
 * `toCommerceScreenPhase`). The mapping is total and honest: `empty`,
 * `blocked`, `approval_required` and `unsupported` are all REAL states
 * with REAL views — an empty demand list IS a ready render of an
 * honest empty view — so they map to `ready` renders that say what they
 * are, never to fabricated content.
 *
 * PURE + DETERMINISTIC. No `any` in public signatures. Strict TS.
 */

import type { ScreenPhase } from "./ui/primitives";

// ---------------------------------------------------------------------------
// The phase kinds (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable lane phase kinds (the W143 honest-state set). */
export const COMMERCE_LANE_PHASE_KINDS = [
  "loading",
  "empty",
  "ready",
  "blocked",
  "approval_required",
  "error",
  "unsupported",
] as const;

export type CommerceLanePhaseKind = (typeof COMMERCE_LANE_PHASE_KINDS)[number];

/**
 * The lane phase of one commerce-lane surface. `empty`, `blocked`,
 * `approval_required` and `unsupported` carry their machine-stable
 * reason; every resolved phase carries the view-model that renders the
 * state honestly (an empty demand list IS a ready render of an honest
 * empty view — never fabricated content). When the screen's view is
 * optional (`T` itself includes `undefined`, like the procurement
 * screen's no-demand state), a blocked/unsupported phase carries the
 * `undefined` view.
 */
export type CommerceLanePhase<T> =
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

export const COMMERCE_LANE_REASONS = Object.freeze({
  /** The tenant scope grammar refused (fail-closed; no data). */
  scopeRefused: "scope_refused",
  /** The acting tenant has no procurement demands (fresh workspace). */
  noDemands: "no_procurement_demands_recorded",
  /** The acting tenant has no vendors (fresh workspace). */
  noVendors: "no_vendors_recorded",
  /** The requested demand is not in the acting tenant's partition. */
  demandNotInTenant: "demand_not_in_tenant",
  /** The demand has no recorded vendor matches yet (honest absence). */
  noMatches: "no_vendor_matches_recorded",
  /** A durable quote acceptance or connectivity submission is PARKED. */
  approvalPending: "approval_required_before_dispatch",
  /** The matching engine produced no satisfiable vendor for the demand. */
  noSatisfiableVendor: "no_satisfiable_vendor",
  /** The composition source refused (machine-stable error). */
  compositionRefused: "composition_refused",
} as const);

// ---------------------------------------------------------------------------
// Constructors (pure)
// ---------------------------------------------------------------------------

/** The `loading` phase (the async tier's pre-resolution state). */
export function commerceLaneLoading<T>(): CommerceLanePhase<T> {
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
export function toCommerceScreenPhase<T>(lanePhase: CommerceLanePhase<T>): ScreenPhase<T> {
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
export function commerceLaneHasView<T>(lanePhase: CommerceLanePhase<T>): boolean {
  return (
    lanePhase.kind === "ready" ||
    lanePhase.kind === "empty" ||
    lanePhase.kind === "blocked" ||
    lanePhase.kind === "approval_required" ||
    lanePhase.kind === "unsupported"
  );
}
