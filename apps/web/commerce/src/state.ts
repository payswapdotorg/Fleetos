/**
 * @fleetos/web-commerce — the commerce-surface state machine.
 *
 * ARCHITECTURE-LOCK item 19: "UI journeys must expose architecture-level
 * capabilities." The commerce journey is TWO typed, deterministic state
 * machines — the procurement journey and the maintenance journey — the
 * shell (W061) drives with events; this module owns the legal
 * transitions and refuses everything else with machine-stable reasons.
 *
 * Procurement journey:
 *
 *   demands --open_demand--> demand
 *   demand --open_matching--> matching
 *   demand --open_quote--> quote
 *   matching --back--> demand
 *   quote --back--> demand
 *   demand --back--> demands
 *   any --reset--> demands
 *
 * Maintenance journey:
 *
 *   workOrders --open_work_order--> workOrder
 *   workOrder --open_service_matching--> serviceMatching
 *   workOrder --open_eligibility--> eligibility
 *   serviceMatching --back--> workOrder
 *   eligibility --back--> workOrder
 *   workOrder --back--> workOrders
 *   any --reset--> workOrders
 *
 * The machines are PURE: the reducers are total functions of
 * (state, event); no clock, no randomness, no I/O. Illegal events are
 * refused with the machine-stable reason `illegal_event`.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { SURFACE_SYSTEM_TENANT_ID, frozen, makeSurfaceDomainError } from "./internal";

// ---------------------------------------------------------------------------
// The procurement journey machine
// ---------------------------------------------------------------------------

/** The procurement-surface views (machine-stable). */
export const PROCUREMENT_SURFACE_VIEWS = [
  "demands",
  "demand",
  "matching",
  "quote",
] as const;

/** The procurement-surface state (discriminated on `view`). */
export type ProcurementSurfaceState =
  | { readonly view: "demands" }
  | { readonly view: "demand"; readonly demandId: string }
  | { readonly view: "matching"; readonly demandId: string }
  | { readonly view: "quote"; readonly demandId: string; readonly quoteId: string };

/** The procurement-surface events. */
export type ProcurementSurfaceEvent =
  | { readonly type: "open_demand"; readonly demandId: string }
  | { readonly type: "open_matching" }
  | { readonly type: "open_quote"; readonly quoteId: string }
  | { readonly type: "back" }
  | { readonly type: "reset" };

/** The legal event types per procurement view (frozen table). */
export const PROCUREMENT_SURFACE_TRANSITIONS: Readonly<
  Record<ProcurementSurfaceState["view"], readonly ProcurementSurfaceEvent["type"][]>
> = Object.freeze({
  demands: Object.freeze(["open_demand", "reset"] as const),
  demand: Object.freeze(["open_matching", "open_quote", "back", "reset"] as const),
  matching: Object.freeze(["back", "reset"] as const),
  quote: Object.freeze(["back", "reset"] as const),
});

/** The initial procurement state. */
export const INITIAL_PROCUREMENT_SURFACE_STATE: ProcurementSurfaceState = frozen({ view: "demands" });

/** The tagged result of a procurement reduction. */
export type ProcurementReduceResult =
  | { readonly ok: true; readonly state: ProcurementSurfaceState }
  | {
      readonly ok: false;
      readonly error: import("@fleetos/contracts").FleetError;
      readonly reason: "illegal_event";
    };

/**
 * Reduce one event against the procurement-surface state. PURE and
 * DETERMINISTIC; never throws; subject continuity is enforced (the
 * matching/quote views stay bound to the OPEN demand's id).
 */
export function reduceProcurementSurfaceState(
  state: ProcurementSurfaceState,
  event: ProcurementSurfaceEvent,
): ProcurementReduceResult {
  const legal = PROCUREMENT_SURFACE_TRANSITIONS[state.view];
  if (legal === undefined || !legal.includes(event.type)) {
    return {
      ok: false,
      error: makeSurfaceDomainError(
        "web-commerce.state",
        "illegal_event",
        `event ${event.type} is not legal in view ${state.view}`,
        SURFACE_SYSTEM_TENANT_ID,
      ),
      reason: "illegal_event",
    };
  }
  switch (event.type) {
    case "open_demand":
      return { ok: true, state: frozen({ view: "demand", demandId: event.demandId }) };
    case "open_matching":
      if (state.view !== "demand") return refuse("open_matching requires the demand view");
      return { ok: true, state: frozen({ view: "matching", demandId: state.demandId }) };
    case "open_quote":
      if (state.view !== "demand") return refuse("open_quote requires the demand view");
      return {
        ok: true,
        state: frozen({ view: "quote", demandId: state.demandId, quoteId: event.quoteId }),
      };
    case "back":
      if (state.view === "demand") return { ok: true, state: frozen({ view: "demands" }) };
      if (state.view === "matching") {
        return { ok: true, state: frozen({ view: "demand", demandId: state.demandId }) };
      }
      if (state.view === "quote") {
        return { ok: true, state: frozen({ view: "demand", demandId: state.demandId }) };
      }
      return { ok: true, state: frozen({ view: "demands" }) };
    case "reset":
      return { ok: true, state: frozen({ view: "demands" }) };
  }
}

// ---------------------------------------------------------------------------
// The maintenance journey machine
// ---------------------------------------------------------------------------

/** The maintenance-surface views (machine-stable). */
export const MAINTENANCE_SURFACE_VIEWS = [
  "workOrders",
  "workOrder",
  "serviceMatching",
  "eligibility",
] as const;

/** The maintenance-surface state (discriminated on `view`). */
export type MaintenanceSurfaceState =
  | { readonly view: "workOrders" }
  | { readonly view: "workOrder"; readonly workOrderId: string }
  | { readonly view: "serviceMatching"; readonly workOrderId: string }
  | { readonly view: "eligibility"; readonly workOrderId: string; readonly vendorId: string };

/** The maintenance-surface events. */
export type MaintenanceSurfaceEvent =
  | { readonly type: "open_work_order"; readonly workOrderId: string }
  | { readonly type: "open_service_matching" }
  | { readonly type: "open_eligibility"; readonly vendorId: string }
  | { readonly type: "back" }
  | { readonly type: "reset" };

/** The legal event types per maintenance view (frozen table). */
export const MAINTENANCE_SURFACE_TRANSITIONS: Readonly<
  Record<MaintenanceSurfaceState["view"], readonly MaintenanceSurfaceEvent["type"][]>
> = Object.freeze({
  workOrders: Object.freeze(["open_work_order", "reset"] as const),
  workOrder: Object.freeze(["open_service_matching", "open_eligibility", "back", "reset"] as const),
  serviceMatching: Object.freeze(["back", "reset"] as const),
  eligibility: Object.freeze(["back", "reset"] as const),
});

/** The initial maintenance state. */
export const INITIAL_MAINTENANCE_SURFACE_STATE: MaintenanceSurfaceState = frozen({ view: "workOrders" });

/** The tagged result of a maintenance reduction. */
export type MaintenanceReduceResult =
  | { readonly ok: true; readonly state: MaintenanceSurfaceState }
  | {
      readonly ok: false;
      readonly error: import("@fleetos/contracts").FleetError;
      readonly reason: "illegal_event";
    };

/**
 * Reduce one event against the maintenance-surface state. PURE and
 * DETERMINISTIC; never throws; subject continuity is enforced (the
 * service-matching/eligibility views stay bound to the OPEN work
 * order's id).
 */
export function reduceMaintenanceSurfaceState(
  state: MaintenanceSurfaceState,
  event: MaintenanceSurfaceEvent,
): MaintenanceReduceResult {
  const legal = MAINTENANCE_SURFACE_TRANSITIONS[state.view];
  if (legal === undefined || !legal.includes(event.type)) {
    return {
      ok: false,
      error: makeSurfaceDomainError(
        "web-commerce.state",
        "illegal_event",
        `event ${event.type} is not legal in view ${state.view}`,
        SURFACE_SYSTEM_TENANT_ID,
      ),
      reason: "illegal_event",
    };
  }
  switch (event.type) {
    case "open_work_order":
      return { ok: true, state: frozen({ view: "workOrder", workOrderId: event.workOrderId }) };
    case "open_service_matching":
      if (state.view !== "workOrder") return refuse("open_service_matching requires the workOrder view");
      return { ok: true, state: frozen({ view: "serviceMatching", workOrderId: state.workOrderId }) };
    case "open_eligibility":
      if (state.view !== "workOrder") return refuse("open_eligibility requires the workOrder view");
      return {
        ok: true,
        state: frozen({
          view: "eligibility",
          workOrderId: state.workOrderId,
          vendorId: event.vendorId,
        }),
      };
    case "back":
      if (state.view === "workOrder") return { ok: true, state: frozen({ view: "workOrders" }) };
      if (state.view === "serviceMatching" || state.view === "eligibility") {
        return { ok: true, state: frozen({ view: "workOrder", workOrderId: state.workOrderId }) };
      }
      return { ok: true, state: frozen({ view: "workOrders" }) };
    case "reset":
      return { ok: true, state: frozen({ view: "workOrders" }) };
  }
}

// ---------------------------------------------------------------------------
// Shared refusal helper
// ---------------------------------------------------------------------------

function refuse(message: string): { ok: false; error: import("@fleetos/contracts").FleetError; reason: "illegal_event" } {
  return {
    ok: false,
    error: makeSurfaceDomainError(
      "web-commerce.state",
      "illegal_event",
      message,
      SURFACE_SYSTEM_TENANT_ID,
    ),
    reason: "illegal_event" as const,
  };
}
