/**
 * @fleetos/web-device — the honest LANE PHASE vocabulary (W141).
 *
 * The W090A screens render `ScreenPhase` (loading / error / invalid /
 * ready) — the RENDER contract. W141 adds the runtime-composition truth
 * the lane must carry alongside it: the machine-stable semantic state
 * of a lane surface, distinguished beyond what a render phase can say:
 *
 *   loading           the runtime has not resolved the data yet
 *   empty             the tenant honestly has nothing (fresh workspace)
 *   ready             the view-model composed from real runtime state
 *   blocked           the surface refuses (scope refused, device not in
 *                     the fleet, the destructive-gate precondition
 *                     unmet) — never a fabricated fallback
 *   approval_required a durable request is PARKED awaiting a human
 *   error             the composition failed machine-stably
 *   unsupported       the device's adapter does not declare the
 *                     capability — visibly, never a disabled fake
 *
 * Every feed in this lane exposes BOTH: `lanePhase` (this vocabulary —
 * the machine-proven truth the tests assert transition-by-transition)
 * and `phase` (the exact `ScreenPhase` the screen renders, derived by
 * `toScreenPhase`). The mapping is total and honest: `empty` and
 * `blocked` and `approval_required` and `unsupported` are all REAL
 * states with REAL views — an empty roster IS a ready render of an
 * honest empty view — so they map to `ready` renders that say what they
 * are, never to fabricated content.
 *
 * PURE + DETERMINISTIC. No `any` in public signatures. Strict TS.
 */

import type { ScreenPhase } from "./ui/primitives";

// ---------------------------------------------------------------------------
// The phase kinds (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable lane phase kinds (the W141 honest-state set). */
export const DEVICE_LANE_PHASE_KINDS = [
  "loading",
  "empty",
  "ready",
  "blocked",
  "approval_required",
  "error",
  "unsupported",
] as const;

export type DeviceLanePhaseKind = (typeof DEVICE_LANE_PHASE_KINDS)[number];

/**
 * The lane phase of one device-lane surface. `empty`, `blocked`,
 * `approval_required` and `unsupported` carry their machine-stable
 * reason; every resolved phase carries the view-model that renders the
 * state honestly (an empty roster IS a ready render of an honest empty
 * view — never fabricated content). When the screen's view is optional
 * (`T` itself includes `undefined`, like the doctor's not-found state),
 * a blocked/unsupported phase carries the `undefined` view.
 */
export type DeviceLanePhase<T> =
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

export const DEVICE_LANE_REASONS = Object.freeze({
  /** The tenant scope grammar refused (fail-closed; no data). */
  scopeRefused: "scope_refused",
  /** The acting tenant has no devices at all (fresh workspace). */
  noDevices: "no_devices_enrolled",
  /** The requested device is not in the acting tenant's partition. */
  deviceNotInFleet: "device_not_in_fleet",
  /** The device exists but has no observations yet (honest absence). */
  noObservations: "no_observations_recorded",
  /** A durable remediation request is parked for a human decision. */
  approvalPending: "approval_required_before_dispatch",
  /** The device's adapter does not declare the capability. */
  capabilityUnsupported: "adapter_capability_absent",
  /** The composition source refused (machine-stable error). */
  compositionRefused: "composition_refused",
} as const);

// ---------------------------------------------------------------------------
// Constructors (pure)
// ---------------------------------------------------------------------------

/** The `loading` phase (the async tier's pre-resolution state). */
export function deviceLaneLoading<T>(): DeviceLanePhase<T> {
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
export function toDeviceScreenPhase<T>(lanePhase: DeviceLanePhase<T>): ScreenPhase<T> {
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
export function deviceLaneHasView<T>(lanePhase: DeviceLanePhase<T>): boolean {
  return (
    lanePhase.kind === "ready" ||
    lanePhase.kind === "empty" ||
    lanePhase.kind === "blocked" ||
    lanePhase.kind === "approval_required" ||
    lanePhase.kind === "unsupported"
  );
}
