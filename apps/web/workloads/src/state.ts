/**
 * @fleetos/web-workloads — the workload-surface state machine.
 *
 * ARCHITECTURE-LOCK item 19: "UI journeys must expose architecture-level
 * capabilities." The workload-planning journey is a TYPED, deterministic
 * state machine — the shell (W061) drives it with events; this module
 * owns the legal transitions and refuses everything else with
 * machine-stable reasons (never a guess, never a silent no-op).
 *
 * Journey shape (the workload-planning surface):
 *
 *   list --select_profile--> profile
 *   profile --open_recommendation--> recommendation
 *   profile --open_resources--> resources
 *   recommendation --back--> profile
 *   resources --back--> profile
 *   profile --back--> list
 *   any --reset--> list
 *
 * The machine is PURE: `reduceWorkloadSurfaceState` is a total function
 * of (state, event); no clock, no randomness, no I/O. Every refusal
 * carries the machine-stable reason `illegal_event` plus the offending
 * view/event pair.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { SURFACE_SYSTEM_TENANT_ID, frozen, makeSurfaceDomainError } from "./internal";

// ---------------------------------------------------------------------------
// The states
// ---------------------------------------------------------------------------

/** The workload-surface views (machine-stable). */
export const WORKLOAD_SURFACE_VIEWS = ["list", "profile", "recommendation", "resources"] as const;

/** The workload-surface state (discriminated on `view`). */
export type WorkloadSurfaceState =
  | { readonly view: "list" }
  | { readonly view: "profile"; readonly workloadId: string }
  | { readonly view: "recommendation"; readonly workloadId: string; readonly recommendationId: string }
  | { readonly view: "resources"; readonly workloadId: string };

// ---------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------

/** The workload-surface events (discriminated on `type`). */
export type WorkloadSurfaceEvent =
  | { readonly type: "select_profile"; readonly workloadId: string }
  | { readonly type: "open_recommendation"; readonly recommendationId: string }
  | { readonly type: "open_resources" }
  | { readonly type: "back" }
  | { readonly type: "reset" };

// ---------------------------------------------------------------------------
// The transition table (machine-stable, frozen)
// ---------------------------------------------------------------------------

/**
 * The legal event types per view. The reducer additionally validates
 * subject continuity: `open_recommendation` / `open_resources` are legal
 * only in the `profile` view; `back` from `recommendation`/`resources`
 * returns to the SAME workload's profile (the workloadId is preserved).
 */
export const WORKLOAD_SURFACE_TRANSITIONS: Readonly<
  Record<WorkloadSurfaceState["view"], readonly WorkloadSurfaceEvent["type"][]>
> = Object.freeze({
  list: Object.freeze(["select_profile", "reset"] as const),
  profile: Object.freeze(["open_recommendation", "open_resources", "back", "reset"] as const),
  recommendation: Object.freeze(["back", "reset"] as const),
  resources: Object.freeze(["back", "reset"] as const),
});

// ---------------------------------------------------------------------------
// The reducer (pure)
// ---------------------------------------------------------------------------

/** The tagged result of a reduction. */
export type WorkloadSurfaceReduceResult =
  | { readonly ok: true; readonly state: WorkloadSurfaceState }
  | {
      readonly ok: false;
      readonly error: import("@fleetos/contracts").FleetError;
      /** The machine-stable refusal reason. */
      readonly reason: "illegal_event";
    };

/**
 * The initial state (the list view).
 */
export const INITIAL_WORKLOAD_SURFACE_STATE: WorkloadSurfaceState = frozen({ view: "list" });

/**
 * Reduce one event against the workload-surface state. PURE and
 * DETERMINISTIC; never throws. Illegal events are refused with the
 * machine-stable `illegal_event` reason (the state is never mutated on
 * refusal — the caller keeps the prior state).
 *
 * @param state the current state
 * @param event the surface event
 * @returns the tagged reduction result
 */
export function reduceWorkloadSurfaceState(
  state: WorkloadSurfaceState,
  event: WorkloadSurfaceEvent,
): WorkloadSurfaceReduceResult {
  const legal = WORKLOAD_SURFACE_TRANSITIONS[state.view];
  if (legal === undefined || !legal.includes(event.type)) {
    return {
      ok: false,
      error: makeSurfaceDomainError(
        "web-workloads.state",
        "illegal_event",
        `event ${event.type} is not legal in view ${state.view}`,
        // The state machine is tenant-agnostic; the synthetic system
        // tenant is used for the error projection only.
        SURFACE_SYSTEM_TENANT_ID,
      ),
      reason: "illegal_event",
    };
  }

  switch (event.type) {
    case "select_profile":
      return {
        ok: true,
        state: frozen({ view: "profile", workloadId: event.workloadId }),
      };
    case "open_recommendation":
      if (state.view !== "profile") {
        return {
          ok: false,
          error: makeSurfaceDomainError(
            "web-workloads.state",
            "illegal_event",
            "open_recommendation requires the profile view",
            SURFACE_SYSTEM_TENANT_ID,
          ),
          reason: "illegal_event",
        };
      }
      return {
        ok: true,
        state: frozen({
          view: "recommendation",
          workloadId: state.workloadId,
          recommendationId: event.recommendationId,
        }),
      };
    case "open_resources":
      if (state.view !== "profile") {
        return {
          ok: false,
          error: makeSurfaceDomainError(
            "web-workloads.state",
            "illegal_event",
            "open_resources requires the profile view",
            SURFACE_SYSTEM_TENANT_ID,
          ),
          reason: "illegal_event",
        };
      }
      return {
        ok: true,
        state: frozen({ view: "resources", workloadId: state.workloadId }),
      };
    case "back":
      if (state.view === "profile") return { ok: true, state: frozen({ view: "list" }) };
      if (state.view === "recommendation" || state.view === "resources") {
        return { ok: true, state: frozen({ view: "profile", workloadId: state.workloadId }) };
      }
      return { ok: true, state: frozen({ view: "list" }) };
    case "reset":
      return { ok: true, state: frozen({ view: "list" }) };
  }
}

/**
 * Pure predicate: is the event legal in the view? (Convenience for the
 * shell's enable/disable logic — the reducer remains the authority.)
 */
export function isLegalWorkloadSurfaceEvent(
  view: WorkloadSurfaceState["view"],
  eventType: WorkloadSurfaceEvent["type"],
): boolean {
  const legal = WORKLOAD_SURFACE_TRANSITIONS[view];
  return legal !== undefined && legal.includes(eventType);
}
