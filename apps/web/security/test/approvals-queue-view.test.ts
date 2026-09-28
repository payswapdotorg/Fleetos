/**
 * W060B D3 tests — the parked approvals queue surface:
 * REQUIRE_APPROVAL items awaiting human decision, presented with the
 * gated approval transitions (PARKED -> APPROVED / REJECTED via the
 * human-approval step). The queue NEVER executes: no dispatch path,
 * no one-click approval (LOCK 16) — the surface exposes the gated path
 * with its decision context only.
 */

import { describe, expect, test } from "bun:test";
import {
  APPROVAL_QUEUE_TRANSITIONS,
  buildApprovalsQueueView,
  type ApprovalsQueueView,
} from "../src/approvals-queue-view";
import type { SurfaceResult } from "../src/internal";
import {
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  T2,
  approvalItem,
  decision,
  evaluation,
  parkedPlan,
  reason,
  scopeA,
} from "./helpers";

function queue(result: SurfaceResult<ApprovalsQueueView>): ApprovalsQueueView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

describe("D3: the queue presents REQUIRE_APPROVAL items awaiting human decision", () => {
  test("an item surfaces the plan facts + the parking decision context", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), [approvalItem()]));
    expect(view.total).toBe(1);
    const item = view.items[0];
    expect(item?.planId).toBe("plan_w060b_01");
    expect(item?.name).toBe("w060b-parked-plan");
    expect(item?.version).toBe(2);
    expect(item?.capability).toBe("lock");
    expect(item?.targetCount).toBe(3);
    expect(item?.parkedAt).toBe(T1);
    expect(item?.requestedBy).toBe("usr_w060buser01");
    // The decision context is the REQUIRE_APPROVAL presentation.
    expect(item?.parkedByDecision.decision).toBe("REQUIRE_APPROVAL");
    expect(item?.parkedByDecision.isBlocking).toBe(true);
    expect(item?.parkedByDecision.reasons.length).toBe(2);
    expect(item?.parkedByDecision.matchedRules.length).toBe(1);
  });

  test("the queue is ordered by parkedAt asc, then planId asc (FIFO, machine-stable)", () => {
    const view = queue(
      buildApprovalsQueueView(scopeA(), [
        approvalItem({ planId: "plan_b", transitionedAt: T2 }),
        approvalItem({ planId: "plan_z", transitionedAt: T0 }),
        approvalItem({ planId: "plan_a", transitionedAt: T0 }),
        approvalItem({ planId: "plan_c", transitionedAt: T1 }),
      ]),
    );
    expect(view.items.map((item) => item.planId)).toEqual(["plan_a", "plan_z", "plan_c", "plan_b"]);
  });

  test("input order never matters — the same items in any order produce a byte-identical queue", () => {
    const items = [
      approvalItem({ planId: "plan_a", transitionedAt: T0 }),
      approvalItem({ planId: "plan_b", transitionedAt: T1 }),
      approvalItem({ planId: "plan_c", transitionedAt: T2 }),
    ];
    const a = queue(buildApprovalsQueueView(scopeA(), items));
    const b = queue(buildApprovalsQueueView(scopeA(), [...items].reverse()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("an empty queue is a valid empty view", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), []));
    expect(view.total).toBe(0);
    expect(view.items).toEqual([]);
  });
});

describe("D3: the approval transitions are an explicit, gated state machine", () => {
  test("every item exposes EXACTLY the two human-gated transitions (approve / reject)", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), [approvalItem()]));
    const transitions = view.items[0]?.availableTransitions;
    expect(transitions).toHaveLength(2);
    expect(transitions?.[0]).toEqual({
      action: "approve",
      from: "PARKED",
      to: "APPROVED",
      gate: "human_decision",
      confirmationRequired: true,
    });
    expect(transitions?.[1]).toEqual({
      action: "reject",
      from: "PARKED",
      to: "REJECTED",
      gate: "human_decision",
      confirmationRequired: true,
    });
  });

  test("the frozen transition table is the W041 parked-plan machine", () => {
    expect(APPROVAL_QUEUE_TRANSITIONS).toEqual([
      { action: "approve", from: "PARKED", to: "APPROVED", gate: "human_decision", confirmationRequired: true },
      { action: "reject", from: "PARKED", to: "REJECTED", gate: "human_decision", confirmationRequired: true },
    ]);
  });

  test("no item carries an execution/dispatch path (never one-click)", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), [approvalItem()]));
    const item = view.items[0];
    expect(item?.directExecutionAvailable).toBe(false);
    const serialized = JSON.stringify(item);
    for (const forbidden of ["execute", "dispatch", "intentId", "commandId"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    // No transition is ever presented as confirmable-without-context.
    for (const transition of item?.availableTransitions ?? []) {
      expect(transition.confirmationRequired).toBe(true);
    }
  });

  test("the parked decision context carries the engine's machine-stable reasons verbatim", () => {
    const reasons = [
      reason({ code: "policy.rule.matched", effect: "REQUIRE_APPROVAL", conditionKind: "action" }),
      reason({ code: "policy.precedence.resolved", chosen: "REQUIRE_APPROVAL" }),
    ];
    const view = queue(
      buildApprovalsQueueView(scopeA(), [
        approvalItem({}, { decision: decision({ decision: "REQUIRE_APPROVAL" }), reasons }),
      ]),
    );
    expect(view.items[0]?.parkedByDecision.reasons).toEqual(reasons);
    expect(view.items[0]?.parkedByDecision.matchedRules).toEqual(
      evaluation().matchedRules,
    );
  });
});

describe("D3: the queue is fail-closed on wrong-status or wrong-decision input", () => {
  test("a non-PARKED plan REFUSES with item_not_parked", () => {
    const result = buildApprovalsQueueView(scopeA(), [
      approvalItem({ status: "PROPOSAL" }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.approval_item_invalid");
    expect(result.error.failures[0]?.path).toBe("/items/0/plan/status");
    expect(result.error.failures[0]?.reason).toBe("item_not_parked");
  });

  test("a non-REQUIRE_APPROVAL decision REFUSES with item_not_require_approval", () => {
    const result = buildApprovalsQueueView(scopeA(), [
      { plan: parkedPlan(), evaluation: evaluation({ decision: decision({ decision: "ALLOW" }) }) },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/items/0/evaluation/decision/decision");
    expect(result.error.failures[0]?.reason).toBe("item_not_require_approval");
  });

  test("a parked plan without transitionedAt refuses (the parked-at instant is required)", () => {
    const result = buildApprovalsQueueView(scopeA(), [
      { plan: { ...parkedPlan(), transitionedAt: undefined }, evaluation: evaluation() },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/items/0/plan/transitionedAt");
    expect(result.error.failures[0]?.reason).toBe("required");
  });

  test("a cross-tenant plan REFUSES (tenant mismatch, fail-closed)", () => {
    const result = buildApprovalsQueueView(scopeA(), [
      approvalItem({ tenantId: TENANT_B }, {}),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.tenant_mismatch");
    expect(result.error.failures[0]?.path).toBe("/items/0/plan/tenantId");
  });

  test("a cross-tenant evaluation REFUSES too", () => {
    const result = buildApprovalsQueueView(scopeA(), [
      approvalItem({}, { decision: decision({ decision: "REQUIRE_APPROVAL", tenantId: TENANT_B }) }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/items/0/evaluation/decision/tenantId");
  });
});

describe("D3: read-only + determinism", () => {
  test("the queue view is deeply frozen", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), [approvalItem()]));
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.items)).toBe(true);
    expect(Object.isFrozen(view.items[0])).toBe(true);
    expect(Object.isFrozen(view.items[0]?.availableTransitions)).toBe(true);
    expect(Object.isFrozen(view.items[0]?.parkedByDecision)).toBe(true);
  });

  test("the same items twice produce a byte-identical queue (determinism)", () => {
    const items = [approvalItem(), approvalItem({ planId: "plan_x", transitionedAt: T2 })];
    const a = queue(buildApprovalsQueueView(scopeA(), items));
    const b = queue(buildApprovalsQueueView(scopeA(), items));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the builder never mutates its input", () => {
    const items = [approvalItem()];
    const snapshot = JSON.stringify(items);
    buildApprovalsQueueView(scopeA(), items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  test("the tenant scope is carried on the view", () => {
    const view = queue(buildApprovalsQueueView(scopeA(), [approvalItem()]));
    expect(view.tenantId).toBe(TENANT_A);
    expect(view.items[0]?.parkedByDecision.tenantId).toBe(TENANT_A);
  });
});
