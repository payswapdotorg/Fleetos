/**
 * W142 web-actions — the Fleet Actions RUNTIME FEED composition tests.
 *
 * These tests are the machine proof that EVERY lane-phase transition
 * of the Fleet Actions feed is honest:
 *
 *   loading -> ready                  (the composition over real state)
 *   loading -> blocked                (plan not in the acting partition)
 *   loading -> error                  (a source that refuses)
 *   ready -> approval_required         (a PARKED plan)
 *   fresh tenant -> empty             (the plans list's honest empty)
 *   scope refused -> blocked          (fail-closed, no data)
 *
 * And that the eight-stage JOURNEY (intent -> proposal -> Guardian
 * gate -> approval -> dispatch -> per-target result -> verification
 * -> evidence) renders from REAL runtime state with honest
 * not-yet-observed states.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asDeviceId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  composeFleetActionsFeed,
  errorFleetActionsFeed,
  fleetActionsLanePhase,
  FLEET_ACTION_JOURNEY_STAGES,
  loadingFleetActionsFeed,
} from "../src/index";
import type {
  ActionPlanSource,
  ActionsPrincipal,
  FleetActionVerificationRecord,
  FleetActionVerificationSource,
  FleetActionsRuntimeState,
  PlanDecisionSource,
} from "../src/index";
import type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
} from "../src/surface-contracts";

const TENANT = makeTenantId("w142-act");
const OTHER_TENANT = makeTenantId("w142-oth");
const PLAN_ID = "plan_w142_act_01";
const NOW = "2026-04-01T00:00:00Z";
const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-02-01T00:00:00Z";
const T2 = "2026-03-01T00:00:00Z";
const USER = asUserId("usr_w142actownr");
const CORR = asCorrelationId("cor_w142_act");
const DEV1 = asDeviceId("dev_w142_act_a1");
const DEV2 = asDeviceId("dev_w142_act_a2");

/** A deterministic plan record. */
function plan(overrides: Partial<SurfaceActionPlanRecord> = {}): SurfaceActionPlanRecord {
  const version = overrides.version ?? 1;
  const status = overrides.status ?? "PROPOSAL";
  const selectedTargets = overrides.selectedTargets ?? [DEV1, DEV2];
  return {
    planId: overrides.planId ?? PLAN_ID,
    tenantId: overrides.tenantId ?? TENANT,
    name: overrides.name ?? "w142-action-plan",
    description: overrides.description,
    version,
    selector: overrides.selector ?? { kind: "all" },
    capability: overrides.capability ?? "lock",
    selectedTargets,
    targetCount: overrides.targetCount ?? selectedTargets.length,
    status,
    createdAt: overrides.createdAt ?? T0,
    transitionedAt:
      overrides.transitionedAt !== undefined
        ? overrides.transitionedAt
        : status === "PROPOSAL"
          ? undefined
          : T1,
    requestedBy: overrides.requestedBy ?? USER,
    evidence: overrides.evidence ?? [
      { key: "evidence/w142-1", sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
    ],
    contentDigest: overrides.contentDigest ?? `digest_${version}_${status}`,
  };
}

/** A deterministic Guardian decision record. */
function decision(
  overrides: Partial<GuardianDecisionRecord> = {},
): GuardianDecisionRecord {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    decision: overrides.decision ?? "REQUIRE_APPROVAL",
    rules: overrides.rules ?? [],
    evidence: overrides.evidence ?? [],
    decidedAt: overrides.decidedAt ?? T1,
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

/** A deterministic verification record. */
function verification(): FleetActionVerificationRecord {
  return {
    planId: PLAN_ID,
    tenantId: TENANT,
    verifiedAt: T2,
    summary: "All targets succeeded",
    evidenceCount: 2,
    perTarget: [
      { deviceId: DEV1 as string, outcome: "succeeded", evidenceCount: 1 },
      { deviceId: DEV2 as string, outcome: "succeeded", evidenceCount: 1 },
    ],
  };
}

/** Compose a runtime state with the given plan + decision + verification. */
function state(
  plans: readonly SurfaceActionPlanRecord[],
  decisions: readonly GuardianDecisionRecord[],
  verifications: readonly FleetActionVerificationRecord[],
): FleetActionsRuntimeState {
  return {
    plans: {
      list: (tenant) => plans.filter((p) => p.tenantId === tenant),
      get: (tenant, planId) =>
        plans.find((p) => p.tenantId === tenant && p.planId === planId),
    },
    decisions: {
      decisionFor: (tenant, planId) =>
        decisions.find((d) => d.tenantId === tenant && planId === PLAN_ID),
    },
    verifications: {
      verificationFor: (tenant, planId) =>
        verifications.find((v) => v.tenantId === tenant && v.planId === planId),
    },
  };
}

describe("W142 actions: the loading + error feeds are machine-stable", () => {
  test("the loading feed is the pre-resolution state", () => {
    const loading = loadingFleetActionsFeed();
    expect(loading.phase.kind).toBe("loading");
    expect(loading.lanePhase.kind).toBe("loading");
    expect(loading.journey).toBeUndefined();
    expect(loading.data.plan).toBeNull();
  });

  test("the error feed is machine-stable", () => {
    const error = errorFleetActionsFeed("The source refused.");
    expect(error.phase.kind).toBe("error");
    expect(error.lanePhase.kind).toBe("error");
    expect(error.journey).toBeUndefined();
  });
});

describe("W142 actions: LOADING -> READY — the feed composes the journey over real state", () => {
  test("a PROPOSAL plan with no decision composes the not-yet-observed states", () => {
    const s = state([plan()], [], []);
    const feed = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    expect(feed.phase.kind).toBe("ready");
    expect(feed.data.plan).not.toBeNull();

    const journey = feed.journey;
    expect(journey).toBeDefined();
    if (journey === undefined) throw new Error("unreachable");
    expect(journey.stages.map((stage) => stage.id)).toEqual([
      ...FLEET_ACTION_JOURNEY_STAGES,
    ]);
    const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("intent")?.state).toBe("ready");
    expect(byId.get("proposal")?.state).toBe("ready");
    expect(byId.get("guardian_gate")?.state).toBe("not_yet_observed");
    expect(byId.get("approval")?.state).toBe("not_yet_observed");
    expect(byId.get("dispatch")?.state).toBe("blocked"); // not APPROVED
    expect(byId.get("per_target_result")?.state).toBe("not_yet_observed");
    expect(byId.get("verification")?.state).toBe("not_yet_observed");
    expect(byId.get("evidence")?.state).toBe("ready");
    expect(journey.approvalPending).toBe(false);
    expect(journey.planState).toBe("proposal");
  });

  test("a PARKED plan composes the approval_required lane phase", () => {
    const s = state(
      [plan({ status: "PARKED", version: 2 })],
      [decision({ decision: "REQUIRE_APPROVAL" })],
      [],
    );
    const feed = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("approval_required");
    if (feed.lanePhase.kind !== "approval_required") throw new Error("unreachable");
    expect(feed.lanePhase.reason).toBe("approval_required_before_dispatch");
    expect(feed.data.plan?.status).toBe("PARKED");
    expect(feed.data.decision?.decision).toBe("REQUIRE_APPROVAL");
    expect(feed.journey?.approvalPending).toBe(true);
    expect(feed.journey?.planState).toBe("parked");
    // The screen phase still composes the view (the state is semantic).
    expect(feed.phase.kind).toBe("ready");
  });

  test("an APPROVED plan with verification composes the dispatch + verification stages", () => {
    const s = state(
      [plan({ status: "APPROVED", version: 3 })],
      [decision({ decision: "ALLOW" })],
      [verification()],
    );
    const feed = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    const journey = feed.journey;
    if (journey === undefined) throw new Error("unreachable");
    const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("guardian_gate")?.state).toBe("ready");
    expect(byId.get("approval")?.state).toBe("empty"); // ALLOW — no approval required
    expect(byId.get("dispatch")?.state).toBe("ready");
    expect(byId.get("per_target_result")?.state).toBe("ready");
    expect(byId.get("verification")?.state).toBe("ready");
    expect(journey.planState).toBe("approved");
    expect(journey.approvalPending).toBe(false);
    expect(feed.data.verification).not.toBeNull();
    expect(feed.data.verification?.perTarget.length).toBe(2);
  });

  test("a REJECTED plan composes the rejected state (never auto-executed)", () => {
    const s = state(
      [plan({ status: "REJECTED", version: 2 })],
      [decision({ decision: "BLOCK" })],
      [],
    );
    const feed = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    expect(feed.journey?.planState).toBe("rejected");
    expect(feed.journey?.approvalPending).toBe(false);
    expect(feed.data.plan?.status).toBe("REJECTED");
  });
});

describe("W142 actions: LOADING -> BLOCKED — a plan outside the acting partition is honest", () => {
  test("a foreign plan composes the blocked phase (no existence side channel)", () => {
    const foreignPlan = plan({ tenantId: OTHER_TENANT });
    const s = state([foreignPlan], [], []);
    const feed = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("blocked");
    if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
    expect(feed.lanePhase.reason).toBe("plan_not_in_tenant_partition");
    expect(feed.data.plan).toBeNull();
    // The screen renders its honest not-found state.
    expect(feed.phase.kind).toBe("ready");
  });
});

describe("W142 actions: a refused scope grammar fails closed (no data, no leak)", () => {
  test("an empty tenant id composes the scope_refused blocked phase", () => {
    const s = state([plan()], [], []);
    const refused = composeFleetActionsFeed({ tenantId: "" as never }, s, PLAN_ID, {
      now: NOW,
    });
    expect(refused.lanePhase.kind).toBe("blocked");
    if (refused.lanePhase.kind !== "blocked") throw new Error("unreachable");
    expect(refused.lanePhase.reason).toBe("scope_refused");
    expect(refused.journey).toBeUndefined();
  });

  test("a missing now instant composes the error feed", () => {
    const s = state([plan()], [], []);
    const error = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, {
      now: "",
    });
    expect(error.lanePhase.kind).toBe("error");
    expect(error.phase.kind).toBe("error");
  });
});

describe("W142 actions: a source that throws composes the machine-stable error feed", () => {
  test("a throwing plans source yields the error phase", () => {
    const throwingState: FleetActionsRuntimeState = {
      ...state([plan()], [], []),
      plans: {
        list: (): never => {
          throw new Error("source refused");
        },
        get: (): never => {
          throw new Error("source refused");
        },
      },
    };
    const feed = composeFleetActionsFeed(
      { tenantId: TENANT },
      throwingState,
      PLAN_ID,
      { now: NOW },
    );
    expect(feed.lanePhase.kind).toBe("error");
    expect(feed.phase.kind).toBe("error");
    expect(feed.journey).toBeUndefined();
  });
});

describe("W142 actions: the fresh tenant's plan list is the honest EMPTY lane phase", () => {
  test("a tenant with no plans composes the empty phase", () => {
    const empty: ActionPlanSource = {
      list: () => [],
      get: () => undefined,
    };
    const phase = fleetActionsLanePhase({ tenantId: TENANT }, empty);
    expect(phase.kind).toBe("empty");
    if (phase.kind !== "empty") throw new Error("unreachable");
    expect(phase.reason).toBe("no_action_plans");
    expect(phase.view).toHaveLength(0);
  });

  test("a tenant with plans composes the ready phase", () => {
    const populated: ActionPlanSource = {
      list: (tenant) => (tenant === TENANT ? [plan()] : []),
      get: (tenant, id) =>
        tenant === TENANT && id === PLAN_ID ? plan() : undefined,
    };
    const phase = fleetActionsLanePhase({ tenantId: TENANT }, populated);
    expect(phase.kind).toBe("ready");
  });
});

describe("W142 actions: determinism — the same runtime state composes byte-identical feeds", () => {
  test("two compositions of the same state produce the same serialized feed", () => {
    const s = state(
      [plan({ status: "PARKED", version: 2 })],
      [decision({ decision: "REQUIRE_APPROVAL" })],
      [],
    );
    const first = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, { now: NOW });
    const second = composeFleetActionsFeed({ tenantId: TENANT }, s, PLAN_ID, { now: NOW });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first.journey)).toBe(JSON.stringify(second.journey));
  });
});
