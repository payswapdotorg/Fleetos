import { test, expect } from "bun:test";
import { composeLaneFeeds } from "../src/runtime/lane-feeds";
import { mapProcurementJourneyToRail } from "../src/runtime/procurement-journey-rail";
import {
  INITIAL_PROCUREMENT_SURFACE_STATE,
  reduceProcurementSurfaceState,
  buildOrderVerificationView,
} from "@fleetos/web-commerce";

const DEMO_TENANT = "tnt_w091demo000001";
const DEMO_DEMAND = "dmd_w091demo000001";
const NOW = "2026-01-06T14:00:00Z";

// ---------------------------------------------------------------------------
// P0 — the surface state machine (the lane's declared reducer)
// ---------------------------------------------------------------------------

test("W151 P0 — the initial procurement surface state is the demands view", () => {
  expect(INITIAL_PROCUREMENT_SURFACE_STATE.view).toBe("demands");
});

test("W151 P0 — open_demand drives the surface from demands to the demand detail", () => {
  const result = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "open_demand", demandId: DEMO_DEMAND },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.view).toBe("demand");
  if (result.state.view !== "demand") return;
  expect(result.state.demandId).toBe(DEMO_DEMAND);
});

test("W151 P0 — back from the demand view returns to the demands list", () => {
  const opened = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "open_demand", demandId: DEMO_DEMAND },
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const back = reduceProcurementSurfaceState(opened.state, { type: "back" });
  expect(back.ok).toBe(true);
  if (!back.ok) return;
  expect(back.state.view).toBe("demands");
});

test("W151 P0 — the matching/quote transitions are subject-continuous (the demand id is preserved)", () => {
  const opened = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "open_demand", demandId: DEMO_DEMAND },
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  // open_matching from the demand view -> matching (same demandId).
  const matching = reduceProcurementSurfaceState(opened.state, { type: "open_matching" });
  expect(matching.ok).toBe(true);
  if (!matching.ok) return;
  expect(matching.state.view).toBe("matching");
  if (matching.state.view !== "matching") return;
  expect(matching.state.demandId).toBe(DEMO_DEMAND);

  // back from matching -> demand (same demandId).
  const backFromMatching = reduceProcurementSurfaceState(matching.state, { type: "back" });
  expect(backFromMatching.ok).toBe(true);
  if (!backFromMatching.ok) return;
  expect(backFromMatching.state.view).toBe("demand");
  if (backFromMatching.state.view !== "demand") return;
  expect(backFromMatching.state.demandId).toBe(DEMO_DEMAND);

  // open_quote from the demand view -> quote (same demandId).
  const quote = reduceProcurementSurfaceState(opened.state, {
    type: "open_quote",
    quoteId: "qt_demo001",
  });
  expect(quote.ok).toBe(true);
  if (!quote.ok) return;
  expect(quote.state.view).toBe("quote");
  if (quote.state.view !== "quote") return;
  expect(quote.state.demandId).toBe(DEMO_DEMAND);

  // back from quote -> demand (same demandId).
  const backFromQuote = reduceProcurementSurfaceState(quote.state, { type: "back" });
  expect(backFromQuote.ok).toBe(true);
  if (!backFromQuote.ok) return;
  expect(backFromQuote.state.view).toBe("demand");
});

test("W151 P0 — reset from any view returns to the demands list", () => {
  const opened = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "open_demand", demandId: DEMO_DEMAND },
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const reset = reduceProcurementSurfaceState(opened.state, { type: "reset" });
  expect(reset.ok).toBe(true);
  if (!reset.ok) return;
  expect(reset.state.view).toBe("demands");
});

test("W151 P0 — illegal events are refused (the reducer returns ok:false, never throws)", () => {
  // open_matching is not legal in the demands view.
  const illegal = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "open_matching" },
  );
  expect(illegal.ok).toBe(false);
  // back is not legal in the demands view.
  const illegalBack = reduceProcurementSurfaceState(
    INITIAL_PROCUREMENT_SURFACE_STATE,
    { type: "back" },
  );
  expect(illegalBack.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// P1 — the feed composition (the selected demand + the seven-stage journey)
// ---------------------------------------------------------------------------

test("W151 P1 — the procurement feed composes the demo tenant's REAL demand (ready, not blocked)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.procurementCases.lanePhase.kind).toBe("ready");
});

test("W151 P1 — WITHOUT selectedDemandId the feed's selected is null and journey is undefined (the W148/W149 stub's behavior, pinned)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  if (result.view.procurementCases.lanePhase.kind !== "ready") return;
  const view = result.view.procurementCases.lanePhase.view;
  expect(view.selected).toBe(null);
  expect(result.view.procurementCases.journey).toBe(undefined);
});

test("W151 P1 — WITH selectedDemandId the feed's selected is non-null and the journey is composed (the W151 fix's binding)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, {
    now: NOW,
    selectedDemandId: DEMO_DEMAND,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  if (result.view.procurementCases.lanePhase.kind !== "ready") return;
  const view = result.view.procurementCases.lanePhase.view;
  // The selected demand's detail is composed from the REAL W143 state.
  expect(view.selected).not.toBe(null);
  if (view.selected === null) return;
  expect(view.selected.demand.demandId).toBe(DEMO_DEMAND);
  // The seven-stage case journey is composed.
  expect(result.view.procurementCases.journey).toBeDefined();
  if (result.view.procurementCases.journey === undefined) return;
  expect(result.view.procurementCases.journey.stages.length).toBe(7);
  // The honest stage order: need -> case -> vendor_context -> authorization -> decision -> order -> evidence.
  const stageIds = result.view.procurementCases.journey.stages.map((s) => s.id);
  expect(stageIds).toEqual([
    "need",
    "case",
    "vendor_context",
    "authorization",
    "decision",
    "order",
    "evidence",
  ]);
});

// ---------------------------------------------------------------------------
// P2 — the journey-rail adapter (the lane's journey -> the screen's rail)
// ---------------------------------------------------------------------------

test("W151 P2 — mapProcurementJourneyToRail maps the seven stages to the CommerceJourneyRailStage vocabulary", () => {
  const result = composeLaneFeeds(DEMO_TENANT, {
    now: NOW,
    selectedDemandId: DEMO_DEMAND,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const journey = result.view.procurementCases.journey;
  if (journey === undefined) return;
  const rail = mapProcurementJourneyToRail(journey);
  expect(rail.length).toBe(7);
  // Each rail stage has the required fields + an honest state.
  for (const stage of rail) {
    expect(stage.stageId).toBeDefined();
    expect(stage.title).toBeDefined();
    expect(["done", "current", "pending", "approval", "blocked"]).toContain(stage.state);
    // The lane's stage type carries no record ref / evidence refs —
    // the honest null / empty array (never fabricated).
    expect(stage.recordRef).toBe(null);
    expect(stage.evidenceRefs).toEqual([]);
  }
  // The stageIds are preserved (the lane's frozen order).
  expect(rail.map((s) => s.stageId)).toEqual([
    "need",
    "case",
    "vendor_context",
    "authorization",
    "decision",
    "order",
    "evidence",
  ]);
});

test("W151 P2 — the rail marks at most one not-yet-done stage as current (the focus stage)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, {
    now: NOW,
    selectedDemandId: DEMO_DEMAND,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const journey = result.view.procurementCases.journey;
  if (journey === undefined) return;
  const rail = mapProcurementJourneyToRail(journey);
  // At most one stage is marked "current" (the focus stage).
  const currentStages = rail.filter((s) => s.state === "current");
  expect(currentStages.length).toBeLessThanOrEqual(1);
  // The "current" stage (if any) corresponds to a lane stage whose
  // mapped state would have been "pending" (not_yet_observed or empty).
  if (currentStages.length === 1) {
    const currentIdx = rail.findIndex((s) => s.state === "current");
    const laneStage = journey.stages[currentIdx];
    expect(["not_yet_observed", "empty"]).toContain(laneStage.state);
  }
});

// ---------------------------------------------------------------------------
// P3 — the binding-site composition (the no-crash assertion)
// ---------------------------------------------------------------------------

test("W151 P3 — the composed procurement route does not crash WITH a selected demand (the detail + the journey rail)", () => {
  // The W151 fix's binding-site composition: build the screenPhase +
  // the journeyRail from the REAL W143 feed — no crash, no fabricated
  // data. This is the same code path console-app.tsx runs.
  const result = composeLaneFeeds(DEMO_TENANT, {
    now: NOW,
    selectedDemandId: DEMO_DEMAND,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  if (result.view.procurementCases.lanePhase.kind !== "ready") return;
  const feed = result.view.procurementCases.lanePhase.view;
  // The W149 P0 fix's verification composition (preserved).
  const verificationResult = buildOrderVerificationView(feed.tenantId, null);
  expect(verificationResult.ok).toBe(true);
  if (!verificationResult.ok) return;
  const verification = verificationResult.view;
  // The screenPhase composition (the W149 P0 fix's shape, preserved).
  const screenPhase = {
    kind: "ready" as const,
    view: {
      demands: feed.demands,
      selected:
        feed.selected === null
          ? null
          : {
              demand: feed.selected.demand,
              matching: feed.selected.matching,
              quoteRows: feed.selected.quoteRows,
              evaluations: Object.freeze([]) as readonly never[],
            },
      orders: feed.orders,
      verification,
    },
  };
  // The W151 fix's journey-rail composition.
  const journey =
    result.view.procurementCases.journey !== undefined
      ? mapProcurementJourneyToRail(result.view.procurementCases.journey)
      : null;
  // No crash — the binding composes without throwing.
  expect(screenPhase.kind).toBe("ready");
  expect(screenPhase.view.selected).not.toBe(null);
  expect(journey).not.toBe(null);
  if (journey === null) return;
  expect(journey.length).toBe(7);
});

test("W151 P3 — the composed procurement route does not crash WITHOUT a selected demand (the list view)", () => {
  // The list view (no demand selected) — the binding composes without
  // crashing; the journey rail is null (the screen's guard hides it).
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  if (result.view.procurementCases.lanePhase.kind !== "ready") return;
  const feed = result.view.procurementCases.lanePhase.view;
  const verificationResult = buildOrderVerificationView(feed.tenantId, null);
  expect(verificationResult.ok).toBe(true);
  if (!verificationResult.ok) return;
  const verification = verificationResult.view;
  const screenPhase = {
    kind: "ready" as const,
    view: {
      demands: feed.demands,
      selected: null,
      orders: feed.orders,
      verification,
    },
  };
  const journey =
    result.view.procurementCases.journey !== undefined
      ? mapProcurementJourneyToRail(result.view.procurementCases.journey)
      : null;
  expect(screenPhase.kind).toBe("ready");
  expect(screenPhase.view.selected).toBe(null);
  expect(journey).toBe(null);
});
