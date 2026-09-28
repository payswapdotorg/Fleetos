/**
 * W060A web-recovery — D3 binding tests: the Fleet Action surfaces
 * (W041) over the REAL `@fleetos/actions` domain + the REAL W031
 * Contract Guardian engine.
 *
 * The REAL `ActionPlanTemplate` values flow where the surface's
 * `ActionPlanLike` seam is expected (the recursive REAL
 * `DeviceGroupSelector` flows where `SelectorLike` is expected), and
 * the REAL `ACTION_PLAN_TRANSITIONS` + terminal + parked tables are
 * injected where `StatusMachineTable` is expected — the structural
 * proofs. These tests are the runtime proof that:
 *
 *   - the group-selection display renders the REAL selector tree
 *     deterministically (composed algebra included);
 *   - plan creation resolves targets through the REAL registry view;
 *   - the policy-gated transitions display as state machines with the
 *     REQUIRE_APPROVAL PARKED states VISIBLE — plans submitted to the
 *     REAL Guardian (ALLOW advances, WARN advances with the warning
 *     context, REQUIRE_APPROVAL parks, BLOCK rejects);
 *   - the plan list surfaces the parked queue FIRST with counts;
 *   - a foreign plan is indistinguishable from unknown; the views
 *     replay byte-identically (determinism).
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asUserId } from "@fleetos/contracts";
import type { GuardianRequestContext } from "@fleetos/policy";
import { submitActionPlan } from "@fleetos/actions";
import {
  buildActionPlanListViewModel,
  buildActionPlanViewModel,
  planStateMachineView,
  selectorNodeView,
} from "../src/index";
import {
  COMPOSED_SELECTOR,
  DEV_A1,
  DEV_A2,
  DEV_A3,
  DEV_B1,
  REAL_PLAN_TABLE,
  SCOPE_A,
  SCOPE_B,
  T0,
  atHour,
  createInMemoryActionStore,
  descriptor,
  planOrThrow,
  realPlanSource,
  registry,
  rule,
  ruleSet,
  storePlans,
  warnRule,
  approvalRule,
  blockRule,
  realGuardian,
} from "./helpers";

/** A canonical Guardian request context for plan submissions. */
function guardianRequest(actionKind: string): GuardianRequestContext {
  return {
    tenantId: SCOPE_A.tenantId,
    action: { action: actionKind, targetKind: "fleet_action" },
    principal: { userId: asUserId("usr_testuser00001") },
  };
}

/** The canonical registry: three tenant-A devices + one tenant-B. */
function fleetRegistry() {
  return registry([
    descriptor(SCOPE_A.tenantId, DEV_A1, { platform: "windows", ownership: "corporate" }),
    descriptor(SCOPE_A.tenantId, DEV_A2, { platform: "windows", ownership: "byod" }),
    descriptor(SCOPE_A.tenantId, DEV_A3, { platform: "macos", ownership: "corporate" }),
    descriptor(SCOPE_B.tenantId, DEV_B1, { platform: "windows" }),
  ]);
}

test("the group-selection display renders the REAL selector tree deterministically", () => {
  const view = selectorNodeView(COMPOSED_SELECTOR);
  expect(view.kind).toBe("intersect");
  expect(view.label).toBe("Intersection of");
  expect(view.detail).toBe("2 selector(s)");
  expect(view.children).toHaveLength(2);
  expect(view.children[0]?.kind).toBe("byPlatform");
  expect(view.children[0]?.detail).toBe("windows");
  expect(view.children[1]?.kind).toBe("subtract");
  expect(view.children[1]?.children).toHaveLength(2);
  expect(view.children[1]?.children[0]?.kind).toBe("all");
  expect(view.children[1]?.children[1]?.kind).toBe("byId");
  expect(view.children[1]?.children[1]?.detail).toBe("1 device(s)");

  // every leaf kind renders with a stable label
  expect(selectorNodeView({ kind: "all" }).label).toBe("All devices");
  expect(selectorNodeView({ kind: "byOwnership", ownership: "corporate" }).detail).toBe("corporate");
  expect(selectorNodeView({ kind: "byLifecycleState", state: "OBSERVE" }).detail).toBe("OBSERVE");
  expect(selectorNodeView({ kind: "byCapability", capability: "lock" }).detail).toBe("lock");
  expect(selectorNodeView({ kind: "byPostureSummary", summary: "AT_RISK" }).detail).toBe("AT_RISK");
  expect(selectorNodeView({ kind: "union", selectors: [{ kind: "all" }] }).label).toBe("Union of");
});

test("plan creation resolves targets through the REAL registry; the view carries them read-only", () => {
  const plan = planOrThrow(SCOPE_A.tenantId, {
    name: "lock-windows-fleet",
    selector: COMPOSED_SELECTOR,
    capability: "lock",
    registry: fleetRegistry(),
    at: T0,
    requestedBy: asUserId("usr_testuser00001"),
  });
  // windows (a1 + a2) minus {a2} = {a1}
  expect(plan.targetCount).toBe(1);
  expect([...plan.selectedTargets]).toEqual([DEV_A1]);

  const store = storePlans(createInMemoryActionStore(), [plan]);
  const source = realPlanSource(store);
  const view = buildActionPlanViewModel(SCOPE_A, source, plan.planId, REAL_PLAN_TABLE);
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.name).toBe("lock-windows-fleet");
  expect(view.capability).toBe("lock");
  expect(view.status).toBe("PROPOSAL");
  expect(view.group.targetCount).toBe(1);
  expect([...view.group.targets]).toEqual([DEV_A1]);
  expect(view.group.selector.kind).toBe("intersect");
  expect(view.stateMachine.isParked).toBe(false);
  expect([...view.stateMachine.legalNext]).toEqual(["ADVANCED", "PARKED", "REJECTED"]);
  expect(view.requestedBy).toBe("usr_testuser00001");
});

test("the plan state machine mirrors the REAL frozen table (parked + terminal visible)", () => {
  const expectations: readonly (readonly [string, readonly string[]])[] = [
    ["PROPOSAL", ["ADVANCED", "PARKED", "REJECTED"]],
    ["PARKED", ["APPROVED", "REJECTED"]],
    ["ADVANCED", []],
    ["APPROVED", []],
    ["REJECTED", []],
  ];
  for (const [status, legalNext] of expectations) {
    const view = planStateMachineView(status, REAL_PLAN_TABLE);
    expect(view.current).toBe(status);
    expect([...view.legalNext]).toEqual([...legalNext]);
    expect(view.isParked).toBe(status === "PARKED");
    expect(view.isTerminal).toBe(status === "ADVANCED" || status === "APPROVED" || status === "REJECTED");
  }
});

test("REQUIRE_APPROVAL parks a REAL plan — the parked state is VISIBLE with the human-approval continuation", () => {
  const plan = planOrThrow(SCOPE_A.tenantId, {
    name: "wipe-byod",
    selector: { kind: "byOwnership", ownership: "byod" },
    capability: "wipe",
    registry: fleetRegistry(),
    at: T0,
  });
  const parked = submitActionPlan(plan, {
    ruleSet: ruleSet(SCOPE_A.tenantId, [approvalRule(SCOPE_A.tenantId, "fleet.action.execute")]),
    request: guardianRequest("fleet.action.execute"),
    at: atHour(1),
    correlationId: asCorrelationId("cor_webrecov_tst1"),
  });
  expect(parked.ok).toBe(true);
  if (!parked.ok) throw new Error(parked.error.message);
  expect(parked.status).toBe("PARKED");
  expect(parked.decision.decision).toBe("REQUIRE_APPROVAL");

  const store = storePlans(createInMemoryActionStore(), [parked.plan]);
  const source = realPlanSource(store);
  const view = buildActionPlanViewModel(SCOPE_A, source, plan.planId, REAL_PLAN_TABLE);
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.status).toBe("PARKED");
  expect(view.stateMachine.isParked).toBe(true); // the REQUIRE_APPROVAL hold, VISIBLE
  expect([...view.stateMachine.legalNext]).toEqual(["APPROVED", "REJECTED"]); // the human step
  expect(view.stateMachine.isTerminal).toBe(false);
  expect(view.transitionedAt).toBe(atHour(1));
});

test("BLOCK rejects a REAL plan; ALLOW advances it — the gate is the domain's, the display is read-only", () => {
  const blockedPlan = planOrThrow(SCOPE_A.tenantId, {
    name: "reboot-all",
    selector: { kind: "all" },
    capability: "reboot",
    registry: fleetRegistry(),
    at: T0,
  });
  const blocked = submitActionPlan(blockedPlan, {
    ruleSet: ruleSet(SCOPE_A.tenantId, [blockRule(SCOPE_A.tenantId, "fleet.action.execute")]),
    request: guardianRequest("fleet.action.execute"),
    at: atHour(1),
    correlationId: asCorrelationId("cor_webrecov_tst1"),
  });
  expect(blocked.ok).toBe(true);
  if (!blocked.ok) throw new Error(blocked.error.message);
  expect(blocked.status).toBe("REJECTED");

  const allowedPlan = planOrThrow(SCOPE_A.tenantId, {
    name: "observe-all",
    selector: { kind: "all" },
    capability: "observe",
    registry: fleetRegistry(),
    at: T0,
  });
  const allowed = submitActionPlan(allowedPlan, {
    ruleSet: ruleSet(SCOPE_A.tenantId, []), // no rules => ALLOW
    request: guardianRequest("fleet.action.execute"),
    at: atHour(1),
    correlationId: asCorrelationId("cor_webrecov_tst1"),
  });
  expect(allowed.ok).toBe(true);
  if (!allowed.ok) throw new Error(allowed.error.message);
  expect(allowed.status).toBe("ADVANCED");

  const warned = submitActionPlan(
    planOrThrow(SCOPE_A.tenantId, {
      name: "identify-all",
      selector: { kind: "all" },
      capability: "identify",
      registry: fleetRegistry(),
      at: T0,
    }),
    {
      ruleSet: ruleSet(SCOPE_A.tenantId, [warnRule(SCOPE_A.tenantId, "fleet.action.execute")]),
      request: guardianRequest("fleet.action.execute"),
      at: atHour(1),
      correlationId: asCorrelationId("cor_webrecov_tst1"),
    },
  );
  expect(warned.ok).toBe(true);
  expect(warned.ok ? warned.status : "").toBe("ADVANCED"); // WARN is non-blocking
  if (!blocked.ok || !allowed.ok || !warned.ok) throw new Error("submission failed");

  const store = storePlans(createInMemoryActionStore(), [blocked.plan, allowed.plan, warned.plan]);
  const source = realPlanSource(store);
  const list = buildActionPlanListViewModel(SCOPE_A, source, REAL_PLAN_TABLE);
  expect(list.counts).toEqual({ total: 3, proposal: 0, parked: 0, advanced: 2, approved: 0, rejected: 1 });
});

test("the plan list surfaces the PARKED queue first with counts", () => {
  const registryView = fleetRegistry();
  const parked = submitActionPlan(
    planOrThrow(SCOPE_A.tenantId, {
      name: "aaa-parked",
      selector: { kind: "all" },
      capability: "wipe",
      registry: registryView,
      at: T0,
    }),
    {
      ruleSet: ruleSet(SCOPE_A.tenantId, [approvalRule(SCOPE_A.tenantId, "fleet.action.execute")]),
      request: guardianRequest("fleet.action.execute"),
      at: atHour(1),
      correlationId: asCorrelationId("cor_webrecov_tst1"),
    },
  );
  const proposal = planOrThrow(SCOPE_A.tenantId, {
    name: "bbb-proposal",
    selector: { kind: "all" },
    capability: "observe",
    registry: registryView,
    at: T0,
  });
  const advanced = submitActionPlan(
    planOrThrow(SCOPE_A.tenantId, {
      name: "ccc-advanced",
      selector: { kind: "all" },
      capability: "identify",
      registry: registryView,
      at: T0,
    }),
    {
      ruleSet: ruleSet(SCOPE_A.tenantId, []),
      request: guardianRequest("fleet.action.execute"),
      at: atHour(1),
      correlationId: asCorrelationId("cor_webrecov_tst1"),
    },
  );
  if (!parked.ok || !advanced.ok) throw new Error("submission failed");
  const store = storePlans(createInMemoryActionStore(), [proposal, advanced.plan, parked.plan]);
  const source = realPlanSource(store);
  const list = buildActionPlanListViewModel(SCOPE_A, source, REAL_PLAN_TABLE);
  expect(list.counts).toEqual({ total: 3, proposal: 1, parked: 1, advanced: 1, approved: 0, rejected: 0 });
  // PARKED first (the visible human-approval queue), then planId ascending
  expect(list.plans[0]?.isParked).toBe(true);
  expect(list.plans[0]?.status).toBe("PARKED");
  const rest = list.plans.slice(1).map((p) => p.planId);
  expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : 1)));
});

test("tenant isolation: a foreign plan is indistinguishable from unknown; a refused scope is empty", () => {
  const plan = planOrThrow(SCOPE_A.tenantId, {
    name: "tenant-a-plan",
    selector: { kind: "all" },
    capability: "observe",
    registry: fleetRegistry(),
    at: T0,
  });
  const store = storePlans(createInMemoryActionStore(), [plan]);
  const source = realPlanSource(store);

  expect(buildActionPlanViewModel(SCOPE_B, source, plan.planId, REAL_PLAN_TABLE)).toBeUndefined();
  expect(buildActionPlanViewModel(SCOPE_A, source, "plan_unknown", REAL_PLAN_TABLE)).toBeUndefined();

  const refused = buildActionPlanListViewModel({ tenantId: "" as never }, source, REAL_PLAN_TABLE);
  expect(refused.plans).toHaveLength(0);
  expect(refused.counts.total).toBe(0);

  const foreignList = buildActionPlanListViewModel(SCOPE_B, source, REAL_PLAN_TABLE);
  expect(foreignList.plans).toHaveLength(0);
});

test("determinism: the same (source, plan, table) replay byte-identically", () => {
  const plan = planOrThrow(SCOPE_A.tenantId, {
    name: "stable-plan",
    selector: COMPOSED_SELECTOR,
    capability: "lock",
    registry: fleetRegistry(),
    at: T0,
  });
  const store = storePlans(createInMemoryActionStore(), [plan]);
  const source = realPlanSource(store);
  const first = buildActionPlanViewModel(SCOPE_A, source, plan.planId, REAL_PLAN_TABLE);
  const second = buildActionPlanViewModel(SCOPE_A, source, plan.planId, REAL_PLAN_TABLE);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
