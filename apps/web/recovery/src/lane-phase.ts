/**
 * @fleetos/web-recovery — the honest LANE PHASE vocabulary (W141).
 *
 * The machine-stable semantic state of a recovery-lane surface, carried
 * alongside the screens' render `ScreenPhase` (the same W141 contract
 * as the device lane's vocabulary, mirrored here because each lane
 * package is self-contained — the ownership gate forbids importing the
 * device lane's module from here):
 *
 *   loading            the runtime has not resolved the data yet
 *   empty              the tenant honestly has no recovery cases
 *   ready              the view-model composed from real runtime state
 *   blocked            the surface refuses (scope refused; no active
 *                      recovery case — the destructive gate's
 *                      precondition unmet) — never a fabricated fallback
 *   approval_required  a destructive request is PARKED awaiting a human
 *   error              the composition failed machine-stably
 *   unsupported        the device's adapter does not declare the
 *                      destructive capability — visibly, never a fake
 *
 * Every feed exposes BOTH `lanePhase` (this vocabulary — machine-proven
 * by the composition tests, transition by transition) and `phase` (the
 * exact `ScreenPhase` the screen renders, derived by `toScreenPhase`).
 *
 * PURE + DETERMINISTIC. No `any` in public signatures. Strict TS.
 */

import type { ScreenPhase } from "./ui/primitives";

// ---------------------------------------------------------------------------
// The phase kinds (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable lane phase kinds (the W141 honest-state set). */
export const RECOVERY_LANE_PHASE_KINDS = [
  "loading",
  "empty",
  "ready",
  "blocked",
  "approval_required",
  "error",
  "unsupported",
] as const;

export type RecoveryLanePhaseKind = (typeof RECOVERY_LANE_PHASE_KINDS)[number];

/**
 * The lane phase of one recovery-lane surface. Every resolved phase
 * carries the view-model that renders the state honestly; when the
 * screen's view is optional (`T` includes `undefined`, like the
 * destructive screen's no-active-case state), the blocked/unsupported
 * phases carry the `undefined` view.
 */
export type RecoveryLanePhase<T> =
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

export const RECOVERY_LANE_REASONS = Object.freeze({
  /** The tenant scope grammar refused (fail-closed; no data). */
  scopeRefused: "scope_refused",
  /** The acting tenant has no recovery cases (fresh workspace). */
  noCases: "no_recovery_cases",
  /** The requested case is not in the acting tenant's partition. */
  caseNotFound: "case_not_found",
  /** No last-seen evidence exists for the device (honest absence). */
  noLastSeenEvidence: "no_last_seen_evidence",
  /** No active recovery case exists for the device (the gate precondition). */
  noActiveCase: "no_active_recovery_case",
  /** A destructive request is PARKED for a human decision. */
  approvalPending: "approval_required_before_dispatch",
  /** The device's adapter does not declare the destructive capability. */
  capabilityUnsupported: "adapter_capability_absent",
  /** The composition source refused (machine-stable error). */
  compositionRefused: "composition_refused",
} as const);

// ---------------------------------------------------------------------------
// Constructors (pure)
// ---------------------------------------------------------------------------

/** The `loading` phase (the async tier's pre-resolution state). */
export function recoveryLaneLoading<T>(): RecoveryLanePhase<T> {
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
export function toRecoveryScreenPhase<T>(lanePhase: RecoveryLanePhase<T>): ScreenPhase<T> {
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
 * render)? PURE.
 */
export function recoveryLaneHasView<T>(lanePhase: RecoveryLanePhase<T>): boolean {
  return (
    lanePhase.kind === "ready" ||
    lanePhase.kind === "empty" ||
    lanePhase.kind === "blocked" ||
    lanePhase.kind === "approval_required" ||
    lanePhase.kind === "unsupported"
  );
}
