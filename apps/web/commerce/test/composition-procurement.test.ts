/**
 * W143 web-commerce — the RUNTIME FEED composition tests, over the
 * REAL `@fleetos/procurement` + `@fleetos/vendors` domain (the W032
 * demand / vendor-match / quote-ledger / aggregated-order store, the
 * vendor catalog at the binding site).
 *
 * These tests are the machine proof that EVERY lane-phase transition of
 * the procurement cases feed is honest:
 *
 *   CASES FEED    loading -> empty (fresh tenant) -> ready;
 *                selected demand detail + journey; foreign demand
 *                indistinguishable; scope refused -> blocked;
 *                no satisfiable vendor -> unsupported; an accepted
 *                quote -> the honest `decisions_recorded` walk
 *
 * The frozen-doctrine invariants asserted:
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources — never fabricated.
 *   - NO EXISTENCE SIDE CHANNEL: a demand outside the acting tenant's
 *     partition is `blocked` with the demand-not-in-tenant reason.
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the journey's
 *     decision walk carries the acceptance/order state only — the feed
 *     performs, accepts and dispatches NOTHING.
 *   - Fresh tenants honestly empty (never demo data).
 */

import { test, expect } from "bun:test";
import {
  composeProcurementCasesFeed,
  COMMERCE_LANE_REASONS,
  PROCUREMENT_CASE_JOURNEY_STAGES,
} from "../src/index";
import type {
  ProcurementRuntimeState,
  ProcurementDemandSource,
  ProcurementMatchSource,
  ProcurementQuoteSource,
  ProcurementOrderSource,
  VendorSource,
} from "../src/index";
import type {
  AggregatedOrderFacets,
  ProcurementDemandFacets,
  QuoteLedgerFacets,
  VendorFacets,
  VendorMatchFacets,
} from "../src/index";
import {
  CORR,
  NOW,
  TENANT_A,
  T0,
  T1,
  T2,
  realAggregation,
  realDemand,
  realIssuedQuote,
  realMatches,
  realQuoteLedger,
  realVendorA,
  realVendorB,
  realVendorFar,
} from "./helpers";
import type {
  AggregatedOrder,
  ProcurementDemand,
  Quote,
  QuoteLedger,
  VendorMatch,
} from "@fleetos/procurement";
import type { Vendor } from "@fleetos/vendors";
import { asTenantId } from "@fleetos/contracts";

const TENANT_B = asTenantId("tnt_w060cbbbbbbbb2");
const OTHER_DEMAND = "dmd_w143_other";

// ---------------------------------------------------------------------------
// In-memory source builders (the binding site for the REAL packages)
// ---------------------------------------------------------------------------

/** A demand source backed by an in-memory list. */
function demandSource(demands: readonly ProcurementDemand[]): ProcurementDemandSource {
  return {
    list: (tenantId) =>
      demands
        .filter((demand) => demand.tenantId === tenantId)
        .map((demand) => demand as unknown as ProcurementDemandFacets),
  };
}

/** A match source backed by an in-memory map. */
function matchSource(map: ReadonlyMap<string, readonly VendorMatch[]>): ProcurementMatchSource {
  return {
    matches: (tenantId, demandId) => {
      const matches = map.get(demandId);
      if (matches === undefined) return [];
      return matches
        .filter((match) => match.vendor.tenantId === tenantId)
        .map((match) => match as unknown as VendorMatchFacets);
    },
  };
}

/** A quote source backed by an in-memory ledger (or undefined when none). */
function quoteSource(ledger: QuoteLedger | undefined): ProcurementQuoteSource {
  return {
    ledger: (tenantId) => {
      if (ledger === undefined) return undefined;
      if (ledger.tenantId !== tenantId) return undefined;
      return ledger as unknown as QuoteLedgerFacets;
    },
  };
}

/** An order source backed by an in-memory list. */
function orderSource(orders: readonly AggregatedOrder[]): ProcurementOrderSource {
  return {
    orders: (tenantId) =>
      orders
        .filter((order) => order.tenantId === tenantId)
        .map((order) => order as unknown as AggregatedOrderFacets),
  };
}

/** A vendor source backed by an in-memory list. */
function vendorSource(vendors: readonly Vendor[]): VendorSource {
  return {
    list: (tenantId) =>
      vendors
        .filter((vendor) => vendor.tenantId === tenantId)
        .map((vendor) => vendor as unknown as VendorFacets),
  };
}

/** A runtime state bundle over the REAL domain stores. */
function runtimeState(input: {
  readonly demands: readonly ProcurementDemand[];
  readonly matches?: ReadonlyMap<string, readonly VendorMatch[]>;
  readonly ledger?: QuoteLedger | undefined;
  readonly orders?: readonly AggregatedOrder[];
  readonly vendors?: readonly Vendor[];
}): ProcurementRuntimeState {
  return {
    demands: demandSource(input.demands),
    matches: matchSource(input.matches ?? new Map()),
    quotes: quoteSource(input.ledger),
    orders: orderSource(input.orders ?? []),
    vendors: vendorSource(input.vendors ?? []),
  };
}

// ---------------------------------------------------------------------------
// The composition tests
// ---------------------------------------------------------------------------

test("CASES: a missing reference instant composes the error phase (no data)", () => {
  const state = runtimeState({ demands: [realDemand()] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: "" },
  );
  expect(feed.lanePhase.kind).toBe("error");
  if (feed.lanePhase.kind !== "error") throw new Error("unreachable");
  expect(feed.lanePhase.message).toContain("reference instant");
  expect(feed.phase.kind).toBe("error");
  expect(feed.journey).toBeUndefined();
});

test("CASES: the fresh tenant composes the honest EMPTY phase (never demo data)", () => {
  const state = runtimeState({ demands: [] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("empty");
  if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(COMMERCE_LANE_REASONS.noDemands);
  expect(feed.lanePhase.view.demands.rows).toHaveLength(0);
  expect(feed.lanePhase.view.demands.total).toBe(0);
  expect(feed.lanePhase.view.selected).toBeNull();
  // The screen renders the honest empty list.
  expect(feed.phase.kind).toBe("ready");
  if (feed.phase.kind !== "ready") throw new Error("unreachable");
  expect(feed.phase.view.demands.rows).toHaveLength(0);
  expect(feed.journey).toBeUndefined();
});

test("CASES: the refused scope grammar fails closed (blocked, the deterministic empty view)", () => {
  const state = runtimeState({ demands: [realDemand()] });
  const feed = composeProcurementCasesFeed(
    { tenantId: "" as never },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(COMMERCE_LANE_REASONS.scopeRefused);
  // The deterministic empty view — no data, no leak.
  expect(feed.lanePhase.view.demands.rows).toHaveLength(0);
  expect(feed.lanePhase.view.demands.total).toBe(0);
  expect(feed.journey).toBeUndefined();
});

test("CASES: EMPTY -> READY over real demands; the listing is the surface's subject", () => {
  const demand = realDemand();
  const state = runtimeState({ demands: [demand] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.demands.rows).toHaveLength(1);
  expect(feed.lanePhase.view.demands.rows[0]?.demandId).toBe(demand.demandId);
  expect(feed.lanePhase.view.selected).toBeNull();
  expect(feed.journey).toBeUndefined();
});

test("CASES: READY -> READY (selected demand) + the seven-stage journey composes over REAL state", () => {
  const demand = realDemand();
  const matches = realMatches();
  const ledger = realQuoteLedger();
  const matchMap = new Map<string, readonly VendorMatch[]>([[demand.demandId, matches]]);
  const state = runtimeState({
    demands: [demand],
    matches: matchMap,
    ledger,
    vendors: [realVendorA(), realVendorB(), realVendorFar()],
  });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedDemandId: demand.demandId },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.selected).not.toBeNull();
  if (feed.lanePhase.view.selected === null) throw new Error("unreachable");
  expect(feed.lanePhase.view.selected.demand.demandId).toBe(demand.demandId);
  expect(feed.lanePhase.view.selected.matching.ranked.length).toBeGreaterThan(0);
  // The seven-stage journey composes over the REAL runtime state.
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.demandId).toBe(demand.demandId);
  expect(feed.journey.stages.map((stage) => stage.id)).toEqual([
    ...PROCUREMENT_CASE_JOURNEY_STAGES,
  ]);
  // The need + case + vendor_context + authorization stages are ready
  // (the demand + matches + ledger exist).
  const need = feed.journey.stages.find((stage) => stage.id === "need");
  expect(need?.state).toBe("ready");
  const caseStage = feed.journey.stages.find((stage) => stage.id === "case");
  expect(caseStage?.state).toBe("ready");
  const vendorContext = feed.journey.stages.find((stage) => stage.id === "vendor_context");
  expect(vendorContext?.state).toBe("ready");
  // The vendor-context walk carries the satisfiable matches.
  expect(feed.journey.vendorContext.state).toBe("vendors_matched");
  expect(feed.journey.vendorContext.steps.length).toBeGreaterThan(0);
  // The decision walk carries the accepted quote (the ledger records
  // an acceptance — the recommendation was accepted via the policy
  // layer, NOT via this surface).
  expect(feed.journey.decisions.state).toBe("decisions_recorded");
  const acceptedStep = feed.journey.decisions.steps.find((step) => step.acceptance === "accepted");
  expect(acceptedStep).toBeDefined();
  // The order stage is not_yet_observed (no aggregated order cites the demand).
  const order = feed.journey.stages.find((stage) => stage.id === "order");
  expect(order?.state).toBe("not_yet_observed");
});

test("CASES: the selected demand NOT in tenant composes blocked (no existence side channel)", () => {
  const demand = realDemand();
  const state = runtimeState({ demands: [demand] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedDemandId: OTHER_DEMAND },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(COMMERCE_LANE_REASONS.demandNotInTenant);
  // The listing stays visible (the surface's subject); the detail is null.
  expect(feed.lanePhase.view.demands.rows).toHaveLength(1);
  expect(feed.lanePhase.view.selected).toBeNull();
  expect(feed.journey).toBeUndefined();
});

test("CASES: a demand with matches but no satisfiable vendor composes unsupported (the honest unsupported state)", () => {
  const demand = realDemand();
  // The "far" vendor is REJECTED by the matching engine (region hard
  // gate); use it as the only match — the surface composes the
  // honest `unsupported` phase (no fabricated match).
  const farMatches: readonly VendorMatch[] = realMatches().filter(
    (match) => !match.satisfiable,
  );
  // When realMatches() returns satisfiable matches, construct an
  // unsatisfiable-only set manually (flip the satisfiable flag to
  // false — the surface only reads the engine's verdict).
  const allUnsatisfiable: readonly VendorMatch[] = realMatches().map((match) => ({
    ...match,
    satisfiable: false,
  }));
  const matchesForTest = farMatches.length > 0 ? farMatches : allUnsatisfiable;
  expect(matchesForTest.length).toBeGreaterThan(0);
  const matchMap = new Map<string, readonly VendorMatch[]>([
    [demand.demandId, matchesForTest],
  ]);
  const state = runtimeState({
    demands: [demand],
    matches: matchMap,
    vendors: [realVendorFar()],
  });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedDemandId: demand.demandId },
  );
  expect(feed.lanePhase.kind).toBe("unsupported");
  if (feed.lanePhase.kind !== "unsupported") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(COMMERCE_LANE_REASONS.noSatisfiableVendor);
  expect(feed.lanePhase.view.selected).not.toBeNull();
  // The journey's vendor-context walk carries the honest no-satisfiable
  // vendor state — never a fabricated match.
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.vendorContext.state).toBe("no_satisfiable_vendor");
});

test("CASES: a demand with no recorded matches composes ready + the honest no_matches_recorded walk", () => {
  const demand = realDemand();
  const state = runtimeState({ demands: [demand] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedDemandId: demand.demandId },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.vendorContext.state).toBe("no_matches_recorded");
  expect(feed.journey.vendorContext.steps).toHaveLength(0);
  // The vendor_context stage is not_yet_observed (honest absence).
  const vendorContext = feed.journey.stages.find((stage) => stage.id === "vendor_context");
  expect(vendorContext?.state).toBe("not_yet_observed");
});

test("CASES: an aggregated order citing the demand composes ready + the dispatched order state", () => {
  const demand = realDemand();
  const matches = realMatches();
  const ledger = realQuoteLedger();
  const aggregation = realAggregation();
  const matchMap = new Map<string, readonly VendorMatch[]>([[demand.demandId, matches]]);
  const state = runtimeState({
    demands: [demand],
    matches: matchMap,
    ledger,
    orders: [aggregation],
    vendors: [realVendorA(), realVendorB(), realVendorFar()],
  });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedDemandId: demand.demandId },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  // The decision walk records the ordered state (the aggregated order
  // cites the demand — LOCK 14: per-contract identity preserved).
  expect(feed.journey.decisions.state).toBe("decisions_recorded");
  const orderedStep = feed.journey.decisions.steps.find((step) => step.order === "ordered");
  expect(orderedStep).toBeDefined();
  // The order stage is ready (an aggregated order cites the demand).
  const order = feed.journey.stages.find((stage) => stage.id === "order");
  expect(order?.state).toBe("ready");
});

test("CASES: no fabricated data can reach a screen — a foreign-tenant demand is filtered out by the source", () => {
  // The REAL W032 demand is tenant-A; tenant-B's source returns no
  // demands at all (the listing composes the honest empty phase).
  const state = runtimeState({ demands: [realDemand()] });
  const feed = composeProcurementCasesFeed(
    { tenantId: TENANT_B },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("empty");
  if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(feed.lanePhase.view.demands.rows).toHaveLength(0);
  expect(feed.lanePhase.view.demands.total).toBe(0);
});
