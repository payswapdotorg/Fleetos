/**
 * W143 web-workloads — the RUNTIME FEED composition tests, over the
 * REAL `@fleetos/workloads` + `@fleetos/software` + `@fleetos/maintenance`
 * + `@fleetos/integration-adcos` domain (the W022 profile + ledger, the
 * W032 software subscriptions, the W042 service work orders, the W050A
 * connectivity submissions at the binding site).
 *
 * These tests are the machine proof that EVERY lane-phase transition of
 * the workload planning feed is honest:
 *
 *   PLANNING FEED   loading -> empty (fresh tenant) -> ready;
 *                   selected workload detail + journey; foreign workload
 *                   indistinguishable; scope refused -> blocked;
 *                   PARKED connectivity submission -> approval_required;
 *                   no recommendation ledger -> the honest
 *                   `no_recommendations_proposed` walk
 *
 * The frozen-doctrine invariants asserted:
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources — never fabricated.
 *   - NO EXISTENCE SIDE CHANNEL: a workload outside the acting tenant's
 *     partition is `blocked` with the workload-not-in-tenant reason.
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the journey's
 *     decision walk carries the durable-request state only — the feed
 *     performs, proposes and dispatches NOTHING.
 *   - Fresh tenants honestly empty (never demo data).
 */

import { test, expect } from "bun:test";
import {
  composeWorkloadPlanningFeed,
  WORKLOAD_LANE_REASONS,
  WORKLOAD_PLANNING_JOURNEY_STAGES,
} from "../src/index";
import type {
  WorkloadPlanningRuntimeState,
  WorkloadProfileSource,
  WorkloadRecommendationSource,
  WorkloadResourceSource,
} from "../src/index";
import type {
  ConnectivityResourceFacets,
  MaintenanceResourceFacets,
  RecommendationLedgerFacets,
  SoftwareResourceFacets,
  WorkloadProfileFacets,
  WorkloadResourceLinkSource,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  T0,
  T1,
  WORKLOAD_ID,
  fieldedLaptopCandidate,
  procurementWorkstationCandidate,
  realLedger,
  realParkedSubmission,
  realProfile,
  realRejectedSubmission,
  realSubscription,
  realWorkOrder,
} from "./helpers";
import type { WorkloadProfile, WorkloadRecommendationLedger } from "@fleetos/workloads";
import type { SoftwareSubscription } from "@fleetos/software";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import type { ConnectivitySubmissionRecord } from "@fleetos/integration-adcos";
import { asTenantId, asWorkloadId } from "@fleetos/contracts";

const NOW = "2026-01-08T09:00:00Z";
const TENANT_B = asTenantId("tnt_w060cbbbbbbbb2");
const OTHER_WORKLOAD = asWorkloadId("wl_w143_other");

// ---------------------------------------------------------------------------
// In-memory source builders (the binding site for the REAL packages)
// ---------------------------------------------------------------------------

/** A workload profile source backed by an in-memory list. */
function profileSource(profiles: readonly WorkloadProfile[]): WorkloadProfileSource {
  return {
    list: (tenantId) =>
      profiles
        .filter((profile) => profile.tenantId === tenantId)
        .map((profile) => profile as unknown as WorkloadProfileFacets),
  };
}

/** A recommendation source backed by an in-memory map. */
function recommendationSource(
  map: ReadonlyMap<string, WorkloadRecommendationLedger>,
): WorkloadRecommendationSource {
  return {
    ledger: (tenantId, workloadId) => {
      const ledger = map.get(workloadId as string);
      if (ledger === undefined) return undefined;
      if (ledger.tenantId !== tenantId) return undefined;
      return ledger as unknown as RecommendationLedgerFacets;
    },
  };
}

/** A resource source backed by in-memory lists. */
function resourceSource(input: {
  readonly software?: readonly SoftwareSubscription[];
  readonly connectivity?: readonly ConnectivitySubmissionRecord[];
  readonly maintenance?: readonly ServiceWorkOrder[];
}): WorkloadResourceSource {
  const software = input.software ?? [];
  const connectivity = input.connectivity ?? [];
  const maintenance = input.maintenance ?? [];
  return {
    software: (tenantId, workloadId) =>
      software
        .filter((record) => record.tenantId === tenantId && record.workloadId === workloadId)
        .map((record) => record as unknown as SoftwareResourceFacets),
    connectivity: (tenantId, workloadId) =>
      connectivity
        .filter((record) => record.tenantId === tenantId)
        .filter((record) => {
          const targets = record.request.targets as { workloadId?: string } | undefined;
          return targets?.workloadId === (workloadId as string);
        })
        .map((record) => record as unknown as ConnectivityResourceFacets),
    maintenance: (tenantId, workloadId) =>
      maintenance
        .filter((record) => record.tenantId === tenantId)
        // The W042 work order carries no workloadId; the binding site
        // associates work orders to workloads out-of-band. For the
        // tests, we treat all maintenance records as belonging to the
        // selected workload when at least one was injected.
        .map((record) => record as unknown as MaintenanceResourceFacets),
    links: (tenantId, workloadId) => {
      const rows: WorkloadResourceLinkSource[] = [];
      for (const record of software) {
        if (record.tenantId !== tenantId || record.workloadId !== workloadId) continue;
        rows.push({
          kind: "software",
          workloadId,
          tenantId,
          resource: record as unknown as SoftwareResourceFacets,
        });
      }
      for (const record of connectivity) {
        if (record.tenantId !== tenantId) continue;
        const targets = record.request.targets as { workloadId?: string } | undefined;
        if (targets?.workloadId !== (workloadId as string)) continue;
        rows.push({
          kind: "connectivity",
          workloadId,
          tenantId,
          resource: record as unknown as ConnectivityResourceFacets,
        });
      }
      for (const record of maintenance) {
        if (record.tenantId !== tenantId) continue;
        rows.push({
          kind: "maintenance",
          workloadId,
          tenantId,
          resource: record as unknown as MaintenanceResourceFacets,
        });
      }
      return rows;
    },
  };
}

/** A runtime state bundle over the REAL domain stores. */
function runtimeState(input: {
  readonly profiles: readonly WorkloadProfile[];
  readonly ledger?: WorkloadRecommendationLedger | undefined;
  readonly software?: readonly SoftwareSubscription[];
  readonly connectivity?: readonly ConnectivitySubmissionRecord[];
  readonly maintenance?: readonly ServiceWorkOrder[];
}): WorkloadPlanningRuntimeState {
  const ledgerMap = new Map<string, WorkloadRecommendationLedger>();
  if (input.ledger !== undefined) {
    ledgerMap.set(input.ledger.workloadId as string, input.ledger);
  }
  return {
    profiles: profileSource(input.profiles),
    recommendations: recommendationSource(ledgerMap),
    resources: resourceSource({
      software: input.software,
      connectivity: input.connectivity,
      maintenance: input.maintenance,
    }),
  };
}

// ---------------------------------------------------------------------------
// The composition tests
// ---------------------------------------------------------------------------

test("PLANNING: a missing reference instant composes the error phase (no data)", () => {
  const state = runtimeState({ profiles: [realProfile()] });
  const feed = composeWorkloadPlanningFeed(
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

test("PLANNING: the fresh tenant composes the honest EMPTY phase (never demo data)", () => {
  const state = runtimeState({ profiles: [] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("empty");
  if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(WORKLOAD_LANE_REASONS.noProfiles);
  expect(feed.lanePhase.view.profiles.rows).toHaveLength(0);
  expect(feed.lanePhase.view.profiles.total).toBe(0);
  expect(feed.lanePhase.view.selected).toBeNull();
  // The screen renders the honest empty list.
  expect(feed.phase.kind).toBe("ready");
  if (feed.phase.kind !== "ready") throw new Error("unreachable");
  expect(feed.phase.view.profiles.rows).toHaveLength(0);
  expect(feed.journey).toBeUndefined();
});

test("PLANNING: the refused scope grammar fails closed (blocked, the deterministic empty view)", () => {
  const state = runtimeState({ profiles: [realProfile()] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: "" as never },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(WORKLOAD_LANE_REASONS.scopeRefused);
  // The deterministic empty view — no data, no leak.
  expect(feed.lanePhase.view.profiles.rows).toHaveLength(0);
  expect(feed.lanePhase.view.profiles.total).toBe(0);
  expect(feed.journey).toBeUndefined();
});

test("PLANNING: EMPTY -> READY over real profiles; the listing is the surface's subject", () => {
  const profile = realProfile();
  const state = runtimeState({ profiles: [profile] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.profiles.rows).toHaveLength(1);
  expect(feed.lanePhase.view.profiles.rows[0]?.workloadId).toBe(WORKLOAD_ID as string);
  expect(feed.lanePhase.view.selected).toBeNull();
  expect(feed.journey).toBeUndefined();
});

test("PLANNING: READY -> READY (selected workload) + the six-stage journey composes over REAL state", () => {
  const profile = realProfile();
  const ledger = realLedger();
  const state = runtimeState({ profiles: [profile], ledger });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: WORKLOAD_ID },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.selected).not.toBeNull();
  if (feed.lanePhase.view.selected === null) throw new Error("unreachable");
  expect(feed.lanePhase.view.selected.profile.workloadId).toBe(WORKLOAD_ID as string);
  expect(feed.lanePhase.view.selected.recommendations.rows.length).toBeGreaterThan(0);
  // The six-stage journey composes over the REAL runtime state.
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.workloadId).toBe(WORKLOAD_ID);
  expect(feed.journey.stages.map((stage) => stage.id)).toEqual([
    ...WORKLOAD_PLANNING_JOURNEY_STAGES,
  ]);
  // The fleet_inventory + workload_proposal + recommendation_review stages
  // are ready (the profile + the ledger exist).
  const fleetInventory = feed.journey.stages.find((stage) => stage.id === "fleet_inventory");
  expect(fleetInventory?.state).toBe("ready");
  const workloadProposal = feed.journey.stages.find((stage) => stage.id === "workload_proposal");
  expect(workloadProposal?.state).toBe("ready");
  const recommendationReview = feed.journey.stages.find((stage) => stage.id === "recommendation_review");
  expect(recommendationReview?.state).toBe("ready");
  // The recommendation walk carries the ACTIVE recommendations.
  expect(feed.journey.recommendations.state).toBe("recommendations_proposed");
  expect(feed.journey.recommendations.steps.length).toBeGreaterThan(0);
  // The decision walk carries the honest not-requested default (no
  // linked resources exist yet — the recommendation is NOT an action).
  expect(feed.journey.decisions.state).toBe("no_decisions_recorded");
  for (const step of feed.journey.decisions.steps) {
    expect(step.disposition).toBe("not_decided");
    expect(step.gating).toBe("not_evaluated");
    expect(step.request).toBe("not_requested");
  }
  // The plan stage is not_yet_observed (no linked resources yet).
  const plan = feed.journey.stages.find((stage) => stage.id === "plan");
  expect(plan?.state).toBe("not_yet_observed");
});

test("PLANNING: the selected workload NOT in tenant composes blocked (no existence side channel)", () => {
  const profile = realProfile();
  const state = runtimeState({ profiles: [profile] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: OTHER_WORKLOAD },
  );
  expect(feed.lanePhase.kind).toBe("blocked");
  if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(WORKLOAD_LANE_REASONS.workloadNotInTenant);
  // The listing stays visible (the surface's subject); the detail is null.
  expect(feed.lanePhase.view.profiles.rows).toHaveLength(1);
  expect(feed.lanePhase.view.selected).toBeNull();
  expect(feed.journey).toBeUndefined();
});

test("PLANNING: a PARKED connectivity submission composes approval_required (the human gate is visible)", () => {
  const profile = realProfile();
  const ledger = realLedger();
  const parkedSubmission = realParkedSubmission();
  const state = runtimeState({
    profiles: [profile],
    ledger,
    connectivity: [parkedSubmission],
  });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: WORKLOAD_ID },
  );
  expect(feed.lanePhase.kind).toBe("approval_required");
  if (feed.lanePhase.kind !== "approval_required") throw new Error("unreachable");
  expect(feed.lanePhase.reason).toBe(WORKLOAD_LANE_REASONS.approvalPending);
  expect(feed.lanePhase.view.selected).not.toBeNull();
  // The journey's decision stage is approval_required (the PARKED
  // connectivity submission is the human gate).
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.approvalPending).toBe(true);
  const decisionStage = feed.journey.stages.find((stage) => stage.id === "decision");
  expect(decisionStage?.state).toBe("approval_required");
  // The decision walk carries the parked request (a recommendation is
  // NOT an executed action — the request state is parked, not
  // dispatched).
  expect(feed.journey.decisions.state).toBe("decisions_recorded");
  const parkedStep = feed.journey.decisions.steps.find((step) => step.request === "parked");
  expect(parkedStep).toBeDefined();
});

test("PLANNING: a REJECTED connectivity submission composes ready (the surface stays operational; the rejection is visible)", () => {
  const profile = realProfile();
  const ledger = realLedger();
  const rejectedSubmission = realRejectedSubmission();
  const state = runtimeState({
    profiles: [profile],
    ledger,
    connectivity: [rejectedSubmission],
  });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: WORKLOAD_ID },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view.selected).not.toBeNull();
  // The journey's decision walk records the rejected request.
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.decisions.state).toBe("decisions_recorded");
  const rejectedStep = feed.journey.decisions.steps.find((step) => step.request === "rejected");
  expect(rejectedStep).toBeDefined();
  expect(feed.journey.approvalPending).toBe(false);
});

test("PLANNING: a software subscription linked to the workload composes ready + the dispatched decision", () => {
  const profile = realProfile();
  const ledger = realLedger();
  const subscription = realSubscription();
  const state = runtimeState({
    profiles: [profile],
    ledger,
    software: [subscription],
  });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: WORKLOAD_ID },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  // The journey's decision walk records the dispatched request (the
  // software subscription is a durable record — a recommendation was
  // executed via the policy layer, NOT via this surface).
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.decisions.state).toBe("decisions_recorded");
  const dispatchedStep = feed.journey.decisions.steps.find((step) => step.request === "dispatched");
  expect(dispatchedStep).toBeDefined();
  // The plan stage is ready (a linked resource exists).
  const plan = feed.journey.stages.find((stage) => stage.id === "plan");
  expect(plan?.state).toBe("ready");
});

test("PLANNING: a profile with no recommendation ledger composes ready + the honest no_recommendations_proposed walk", () => {
  const profile = realProfile();
  const state = runtimeState({ profiles: [profile] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_A },
    state,
    { now: NOW, selectedWorkloadId: WORKLOAD_ID },
  );
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.journey).toBeDefined();
  if (feed.journey === undefined) throw new Error("unreachable");
  expect(feed.journey.recommendations.state).toBe("no_recommendations_proposed");
  expect(feed.journey.recommendations.steps).toHaveLength(0);
  // The recommendation_review stage is empty (honest absence).
  const reviewStage = feed.journey.stages.find((stage) => stage.id === "recommendation_review");
  expect(reviewStage?.state).toBe("empty");
});

test("PLANNING: no fabricated data can reach a screen — a foreign-tenant profile is filtered out by the source", () => {
  // The REAL W022 profile is tenant-A; tenant-B's source returns no
  // profiles at all (the listing composes the honest empty phase).
  const state = runtimeState({ profiles: [realProfile()] });
  const feed = composeWorkloadPlanningFeed(
    { tenantId: TENANT_B },
    state,
    { now: NOW },
  );
  expect(feed.lanePhase.kind).toBe("empty");
  if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
  expect(feed.lanePhase.view.profiles.rows).toHaveLength(0);
  expect(feed.lanePhase.view.profiles.total).toBe(0);
});
