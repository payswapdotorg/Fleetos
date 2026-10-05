/**
 * @fleetos/web-commerce — W143: the PROCUREMENT CASE RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composeProcurementCasesFeed`; the returned feed is everything the
 * ProcurementScreen renders: the screen's exact `ScreenPhase` prop, the
 * machine-proven `lanePhase` (loading / empty / ready / blocked /
 * approval_required / error / unsupported — every transition honest),
 * the full seven-stage procurement case JOURNEY (need -> case -> vendor
 * context -> authorization -> decision -> order -> evidence), the
 * tenant-scoped demand list, the selected demand's vendor matching +
 * quote ledger display, and the LOCK 14 aggregated orders — every value
 * derived from REAL runtime state.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL W032 demand / vendor-match / quote-ledger /
 *     aggregated-order store, the REAL vendor catalog at the binding
 *     site). Nothing is fabricated; a fresh tenant composes the honest
 *     `empty` phase (no demands — never demo data).
 *   - NO EXISTENCE SIDE CHANNEL: a demand outside the acting tenant's
 *     partition is `blocked` with the demand-not-in-tenant reason —
 *     indistinguishable from unknown, and the case view-model stays
 *     `undefined` (the screen renders its honest not-found state).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feed's
 *     decision walk only ever DESCRIBES records (acceptance, gating,
 *     order state); this module performs, accepts and dispatches
 *     NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { CommerceUiTenantScope } from "./internal";
import { checkCommerceUiTenantScope, SURFACE_SYSTEM_TENANT_ID } from "./internal";
import { buildProcurementDemandListView } from "./procurement";
import type { ProcurementDemandListView } from "./procurement";
import { buildVendorMatchingView } from "./procurement";
import type { VendorMatchingView } from "./procurement";
import { buildQuoteLedgerDisplay } from "./procurement";
import type { QuoteLedgerDisplayView, QuoteRowView } from "./procurement";
import { buildAggregationDisplayView } from "./procurement";
import type { AggregationDisplayView } from "./procurement";
import { buildProcurementCaseJourney } from "./procurement-journey";
import type { ProcurementCaseJourney } from "./procurement-journey";
import { COMMERCE_LANE_REASONS, toCommerceScreenPhase } from "./lane-phase";
import type { CommerceLanePhase } from "./lane-phase";
import type { ScreenPhase } from "./ui/primitives";
import type {
  AggregatedOrderFacets,
  ProcurementDemandFacets,
  QuoteFacets,
  QuoteLedgerFacets,
  VendorFacets,
  VendorMatchFacets,
} from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The structural source for the per-tenant procurement demands.
 * INJECTED at the binding site (the REAL W032 demand store).
 */
export interface ProcurementDemandSource {
  list(tenantId: TenantId): readonly ProcurementDemandFacets[];
}

/**
 * The structural source for the per-demand vendor matches. INJECTED at
 * the binding site (the REAL W032 matching-engine outputs). Returns the
 * empty list when the demand has no recorded matches yet.
 */
export interface ProcurementMatchSource {
  matches(tenantId: TenantId, demandId: string): readonly VendorMatchFacets[];
}

/**
 * The structural source for the per-tenant quote ledger. INJECTED at
 * the binding site (the REAL W032 quote ledger). Returns `undefined`
 * when the tenant has no ledger yet — the honest absence (never
 * fabricated).
 */
export interface ProcurementQuoteSource {
  ledger(tenantId: TenantId): QuoteLedgerFacets | undefined;
}

/**
 * The structural source for the per-tenant aggregated orders (LOCK 14).
 * INJECTED at the binding site (the REAL W032 aggregation store).
 */
export interface ProcurementOrderSource {
  orders(tenantId: TenantId): readonly AggregatedOrderFacets[];
}

/**
 * The structural source for the per-tenant vendor records. INJECTED at
 * the binding site (the REAL vendor store). Returns the empty list when
 * the tenant has no vendors yet — the honest fresh-tenant state.
 */
export interface VendorSource {
  list(tenantId: TenantId): readonly VendorFacets[];
}

/**
 * The commerce lane's runtime state: the tenant-partitioned sources the
 * feed composes from. INJECTED at the binding site (the console
 * composition root binds the REAL packages; the machine tests bind them
 * the same way).
 */
export interface ProcurementRuntimeState {
  /** The REAL procurement demand store. */
  readonly demands: ProcurementDemandSource;
  /** The REAL per-demand matching-engine outputs. */
  readonly matches: ProcurementMatchSource;
  /** The REAL quote ledger (tenant-wide). */
  readonly quotes: ProcurementQuoteSource;
  /** The REAL aggregated orders (tenant-wide, LOCK 14). */
  readonly orders: ProcurementOrderSource;
  /** The REAL vendor catalog (tenant-wide). */
  readonly vendors: VendorSource;
}

// ---------------------------------------------------------------------------
// The procurement cases view-model (the screen's data shape)
// ---------------------------------------------------------------------------

/**
 * The composed procurement cases data: the tenant-scoped demand list
 * plus the selected demand's detail (the demand record + the engine's
 * ranked matches + the quote-ledger display + the LOCK 14 aggregated
 * orders + the vendor catalog context).
 */
export interface ProcurementCasesViewModel {
  readonly tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID;
  readonly demands: ProcurementDemandListView;
  /** The selected demand's detail (null in the demands view or when not in tenant). */
  readonly selected: {
    readonly demand: ProcurementDemandFacets;
    readonly matching: VendorMatchingView;
    readonly quoteRows: readonly QuoteRowView[];
    readonly quoteLedger: QuoteLedgerDisplayView;
    readonly orders: AggregationDisplayView;
  } | null;
  /** The vendor catalog (the vendor-context enrichment), tenant-wide. */
  readonly vendors: readonly VendorFacets[];
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/** Options for the procurement cases feed composition. */
export interface ProcurementCasesFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
  /** The selected demand id (the detail Sheet's subject), when open. */
  readonly selectedDemandId?: string;
}

/**
 * The Procurement Cases feed: everything the screen renders, composed
 * from real runtime state. `phase` is the screen's prop (derived);
 * `lanePhase` is the machine-proven semantic state.
 */
export interface ProcurementCasesFeed {
  /** The EXACT phase prop the ProcurementScreen takes. */
  readonly phase: ScreenPhase<ProcurementCasesViewModel>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: CommerceLanePhase<ProcurementCasesViewModel>;
  /** The selected demand's journey (the seven-stage walk). */
  readonly journey: ProcurementCaseJourney | undefined;
}

/** A deterministic empty cases view (the fresh-tenant / blocked state). */
function emptyCasesView(
  tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID,
  now: string,
): ProcurementCasesViewModel {
  const emptyList: ProcurementDemandListView = frozen({
    viewVersion: 1,
    tenantId: tenantId as TenantId,
    rows: [],
    total: 0,
    byPressure: {
      overdue: 0,
      critical: 0,
      urgent: 0,
      soon: 0,
      comfortable: 0,
    },
  });
  const emptyOrders: AggregationDisplayView = frozen({
    viewVersion: 1,
    tenantId: tenantId as TenantId,
    rows: [],
    total: 0,
  });
  return frozen({
    tenantId,
    demands: emptyList,
    selected: null,
    vendors: [],
    orders: emptyOrders,
  });
}

/**
 * Compose the Procurement Cases feed for one tenant: resolve the
 * tenant's procurement demands + the selected demand's vendor matches +
 * quote ledger + aggregated orders + the seven-stage journey. PURE and
 * DETERMINISTIC. Phase transitions (machine-proven by the composition
 * tests):
 *
 *   - refused scope grammar  -> blocked (scope_refused; the empty view)
 *   - no demands recorded     -> empty (no_procurement_demands_recorded;
 *     the honest fresh-tenant state — never demo data)
 *   - demands + no selected  -> ready (the listing is the surface's
 *     subject)
 *   - demands + selected     -> ready (the listing + the selected detail)
 *   - selected not in tenant -> blocked (demand_not_in_tenant; no
 *     existence side channel)
 *   - selected + no
 *     satisfiable vendor     -> unsupported (no_satisfiable_vendor;
 *     the matching engine produced no satisfiable match — never a
 *     fabricated match)
 *
 * The journey composes only when the selected demand is in the acting
 * tenant's partition. The vendor-context walk builds from the REAL
 * engine matches (or the honest `no_matches_recorded` state when no
 * matches exist).
 */
export function composeProcurementCasesFeed(
  scope: CommerceUiTenantScope,
  state: ProcurementRuntimeState,
  options: ProcurementCasesFeedOptions,
): ProcurementCasesFeed {
  const guard = checkCommerceUiTenantScope(scope);
  const invalidInstant = typeof options?.now !== "string" || options.now.length === 0;

  if (invalidInstant) {
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: "The procurement cases feed requires an injected reference instant.",
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  if (!guard.ok) {
    const view = emptyCasesView(SURFACE_SYSTEM_TENANT_ID, options.now);
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "blocked",
      reason: COMMERCE_LANE_REASONS.scopeRefused,
      view,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the tenant's procurement demands through the REAL source.
  let listed: readonly ProcurementDemandFacets[];
  try {
    listed = state.demands.list(guard.tenantId);
  } catch {
    const view = emptyCasesView(guard.tenantId, options.now);
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: "The procurement cases feed's demand source refused to resolve.",
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the tenant's vendor catalog (tenant-wide context).
  let vendors: readonly VendorFacets[];
  try {
    vendors = state.vendors.list(guard.tenantId);
  } catch {
    vendors = [];
  }

  // The listing build is total — fail-closed to an error view on a
  // tenant-mismatch or invalid input.
  const listResult = buildProcurementDemandListView(guard.tenantId, [...listed], options.now);
  if (!listResult.ok) {
    const view = emptyCasesView(guard.tenantId, options.now);
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: listResult.error.message,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the tenant's quote ledger + aggregated orders (tenant-wide).
  let ledger: QuoteLedgerFacets | undefined;
  try {
    ledger = state.quotes.ledger(guard.tenantId);
  } catch {
    const view = emptyCasesView(guard.tenantId, options.now);
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: "The procurement cases feed's quote ledger source refused to resolve.",
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  let orders: readonly AggregatedOrderFacets[];
  try {
    orders = state.orders.orders(guard.tenantId);
  } catch {
    const view = emptyCasesView(guard.tenantId, options.now);
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: "The procurement cases feed's order source refused to resolve.",
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The fresh-tenant honest empty state — never demo data.
  if (listResult.view.rows.length === 0) {
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "empty",
      reason: COMMERCE_LANE_REASONS.noDemands,
      view,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The selected demand's detail (when one is open).
  const selectedDemandId = options.selectedDemandId;
  if (selectedDemandId === undefined) {
    // Ready: the listing is the surface's subject; no detail open.
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "ready",
      view,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the selected demand from the listing (the demand-not-in-
  // tenant guard: a demand outside the acting tenant's partition is
  // indistinguishable from unknown — no existence side channel).
  const selectedDemand = [...listed].find(
    (demand) => demand.demandId === selectedDemandId && demand.tenantId === guard.tenantId,
  );
  if (selectedDemand === undefined) {
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "blocked",
      reason: COMMERCE_LANE_REASONS.demandNotInTenant,
      view,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the selected demand's REAL vendor matches.
  let matches: readonly VendorMatchFacets[];
  try {
    matches = state.matches.matches(guard.tenantId, selectedDemandId);
  } catch {
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: "The procurement cases feed's match source refused to resolve.",
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the vendor-matching display from the REAL engine matches.
  // The matching engine's version is opaque to the surface (the real
  // engine emits it; we pass null when unknown — the display degrades
  // honestly without inventing a version).
  const matchingResult = buildVendorMatchingView(
    guard.tenantId,
    selectedDemand,
    [...matches],
    null,
  );
  if (!matchingResult.ok) {
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: matchingResult.error.message,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the quote-ledger display from the REAL ledger. When the
  // tenant has no ledger yet, the display is the honest empty view
  // (zero quote rows, zero acceptances, zero supersessions).
  const quoteLedgerResult =
    ledger === undefined
      ? { ok: true as const, view: frozen<QuoteLedgerDisplayView>({ viewVersion: 1, tenantId: guard.tenantId, rows: [], acceptances: [], supersessions: [] }) }
      : buildQuoteLedgerDisplay(guard.tenantId, ledger);
  if (!quoteLedgerResult.ok) {
    const view = frozen({
      tenantId: guard.tenantId,
      demands: listResult.view,
      selected: null,
      vendors,
      orders: buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now),
    });
    const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = {
      kind: "error",
      message: quoteLedgerResult.error.message,
    };
    return frozen({
      phase: toCommerceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the LOCK 14 aggregated-orders display from the REAL orders.
  const ordersView = buildAggregationDisplayViewSafe(guard.tenantId, orders, ledger, options.now);

  // Build the seven-stage procurement case journey from the REAL state.
  const journey = buildProcurementCaseJourney(scope, {
    demand: selectedDemand,
    matches,
    ledger,
    orders,
    vendors,
    now: options.now,
  });

  // The lane phase: when no satisfiable vendor matched the demand,
  // the surface is `unsupported` (the honest unsupported state — never
  // a fabricated match); otherwise ready.
  const anySatisfiable = matches.some((match) => match.satisfiable);
  const lanePhase: CommerceLanePhase<ProcurementCasesViewModel> = !anySatisfiable && matches.length > 0
    ? {
        kind: "unsupported",
        reason: COMMERCE_LANE_REASONS.noSatisfiableVendor,
        view: frozen({
          tenantId: guard.tenantId,
          demands: listResult.view,
          selected: {
            demand: selectedDemand,
            matching: matchingResult.view,
            quoteRows: quoteLedgerResult.view.rows,
            quoteLedger: quoteLedgerResult.view,
            orders: ordersView,
          },
          vendors,
          orders: ordersView,
        }),
      }
    : {
        kind: "ready",
        view: frozen({
          tenantId: guard.tenantId,
          demands: listResult.view,
          selected: {
            demand: selectedDemand,
            matching: matchingResult.view,
            quoteRows: quoteLedgerResult.view.rows,
            quoteLedger: quoteLedgerResult.view,
            orders: ordersView,
          },
          vendors,
          orders: ordersView,
        }),
      };

  return frozen({
    phase: toCommerceScreenPhase(lanePhase),
    lanePhase,
    journey,
  });
}

/**
 * Build the aggregated-orders display, swallowing a build failure into
 * the deterministic empty view (the cases feed must not crash on an
 * isolated aggregation failure — the rest of the surface still
 * composes). PURE.
 *
 * The `quotesByDemand` map is derived from the REAL quote ledger's
 * accepted-quote entries (the per-contract identity the LOCK 14
 * aggregation display surfaces). An empty map when no ledger exists.
 */
function buildAggregationDisplayViewSafe(
  tenantId: TenantId,
  orders: readonly AggregatedOrderFacets[],
  ledger: QuoteLedgerFacets | undefined,
  now: string,
): AggregationDisplayView {
  const quotesByDemand = new Map<string, QuoteFacets>();
  if (ledger !== undefined) {
    for (const entry of ledger.entries) {
      if (entry.kind !== "quote") continue;
      const quote = entry.quote;
      if (quote.status !== "ACCEPTED") continue;
      // The latest accepted quote per demand wins (highest quoteVersion).
      const prior = quotesByDemand.get(quote.demandId);
      if (prior === undefined || quote.quoteVersion > prior.quoteVersion) {
        quotesByDemand.set(quote.demandId, quote);
      }
    }
  }
  const result = buildAggregationDisplayView(tenantId, orders, quotesByDemand, now);
  if (result.ok) return result.view;
  return frozen({
    viewVersion: 1,
    tenantId,
    rows: [],
    total: 0,
  });
}

/** The synthetic system tenant (re-exported for the feed's consumers). */
export const COMMERCE_FEED_SYSTEM_TENANT = SURFACE_SYSTEM_TENANT_ID;
