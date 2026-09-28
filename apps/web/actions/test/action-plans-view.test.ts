/**
 * W060B tests — the Fleet Action plan surfaces: group selection view,
 * the policy-gated plan presentation state machine (PROPOSAL →
 * approval → dispatch; parked states visible; refusal states
 * machine-stable), the plan progression, and the frozen transition
 * tables. LOCK 16: gated transitions are NEVER one-click — every step
 * carries its gate + confirmation requirement.
 */

import { describe, expect, test } from "bun:test";
import {
  buildActionPlanView,
  buildGroupSelectionView,
  buildPlanProgressionView,
  DECISION_TO_PLAN_STATUS,
  PLAN_TRANSITION_STEPS,
  PLAN_TRANSITIONS,
  TERMINAL_PLAN_STATUSES,
  type ActionPlanPresentationView,
  type GroupSelectionView,
  type PlanProgressionView,
} from "../src/action-plans-view";
import type { SurfaceResult } from "../src/internal";
import type { SurfaceActionPlanRecord } from "../src/surface-contracts";
import {
  ALL_STATUSES,
  DEV_A1,
  DEV_A2,
  DEV_A3,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  T2,
  decision,
  plan,
  printJob,
  scopeA,
} from "./helpers";

function okView<T>(result: SurfaceResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

describe("group selection surface", () => {
  test("the view presents the selector kind, a canonical summary, the count and SORTED targets", () => {
    const view = okView(
      buildGroupSelectionView(scopeA(), { kind: "all" }, [DEV_A2, DEV_A1, DEV_A3]),
    ) as GroupSelectionView;
    expect(view.selectorKind).toBe("all");
    expect(view.targetCount).toBe(3);
    expect(view.targets).toEqual([DEV_A1, DEV_A2, DEV_A3]);
    // The canonical summary is machine-stable (canonical JSON of the selector).
    expect(view.selectorSummary).toBe('{"kind":"all"}');
    expect(view.tenantId).toBe(TENANT_A);
  });

  test("input order never matters — target order and summary are canonical", () => {
    const a = okView(
      buildGroupSelectionView(scopeA(), { kind: "byPlatform", platform: "windows" }, [DEV_A2, DEV_A1]),
    ) as GroupSelectionView;
    const b = okView(
      buildGroupSelectionView(scopeA(), { kind: "byPlatform", platform: "windows" }, [DEV_A1, DEV_A2]),
    ) as GroupSelectionView;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("a composed selector's summary is canonical (sorted keys, stable order)", () => {
    const view = okView(
      buildGroupSelectionView(
        scopeA(),
        { kind: "intersect", selectors: [{ kind: "all" }, { kind: "byCapability", capability: "lock" }] },
        [DEV_A1],
      ),
    ) as GroupSelectionView;
    expect(view.selectorSummary).toBe(
      '{"kind":"intersect","selectors":[{"kind":"all"},{"capability":"lock","kind":"byCapability"}]}',
    );
  });

  test("a malformed selector refuses with machine-stable failures", () => {
    const result = buildGroupSelectionView(scopeA(), { kind: "byId", deviceIds: [] }, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.selector_invalid");
    expect(result.error.failures[0]?.path).toBe("/selector/deviceIds");
    expect(result.error.failures[0]?.reason).toBe("non_empty_string_array_required");
  });

  test("an unknown selector kind refuses", () => {
    const result = buildGroupSelectionView(
      scopeA(),
      { kind: "mystery" } as never,
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("unknown_selector_kind");
  });

  test("an empty intersect/union refuses; subtract requires both arms", () => {
    const emptyUnion = buildGroupSelectionView(scopeA(), { kind: "union", selectors: [] }, []);
    expect(emptyUnion.ok).toBe(false);
    const missingMinus = buildGroupSelectionView(
      scopeA(),
      { kind: "subtract", base: { kind: "all" } } as never,
      [],
    );
    expect(missingMinus.ok).toBe(false);
  });

  test("targets are non-empty strings; malformed targets refuse", () => {
    const result = buildGroupSelectionView(scopeA(), { kind: "all" }, ["" as never]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/targets/0");
  });
});

describe("the frozen plan state machine (the W041 policy-gate semantics)", () => {
  test("PLAN_TRANSITIONS is the proposal-gated boundary table", () => {
    expect(PLAN_TRANSITIONS.PROPOSAL).toEqual(["ADVANCED", "PARKED", "REJECTED"]);
    expect(PLAN_TRANSITIONS.PARKED).toEqual(["APPROVED", "REJECTED"]);
    expect(PLAN_TRANSITIONS.ADVANCED).toEqual([]);
    expect(PLAN_TRANSITIONS.APPROVED).toEqual([]);
    expect(PLAN_TRANSITIONS.REJECTED).toEqual([]);
  });

  test("TERMINAL_PLAN_STATUSES is [ADVANCED, APPROVED, REJECTED]", () => {
    expect(TERMINAL_PLAN_STATUSES).toEqual(["ADVANCED", "APPROVED", "REJECTED"]);
  });

  test("DECISION_TO_PLAN_STATUS is the frozen Guardian mapping", () => {
    expect(DECISION_TO_PLAN_STATUS.ALLOW).toBe("ADVANCED");
    expect(DECISION_TO_PLAN_STATUS.WARN).toBe("ADVANCED");
    expect(DECISION_TO_PLAN_STATUS.REQUIRE_APPROVAL).toBe("PARKED");
    expect(DECISION_TO_PLAN_STATUS.BLOCK).toBe("REJECTED");
  });

  test("every transition step carries its gate + confirmation (never one-click)", () => {
    for (const step of PLAN_TRANSITION_STEPS) {
      expect(step.confirmationRequired).toBe(true);
      expect(step.gate === "guardian_decision" || step.gate === "human_approval").toBe(true);
    }
    // The proposal gate: only the Guardian decision moves a PROPOSAL.
    const proposalSteps = PLAN_TRANSITION_STEPS.filter((s) => s.from === "PROPOSAL");
    expect(proposalSteps.map((s) => s.gate)).toEqual([
      "guardian_decision",
      "guardian_decision",
      "guardian_decision",
    ]);
    // The parked gate: only the human approval moves a PARKED plan.
    const parkedSteps = PLAN_TRANSITION_STEPS.filter((s) => s.from === "PARKED");
    expect(parkedSteps.map((s) => s.gate)).toEqual(["human_approval", "human_approval"]);
  });
});

describe("plan presentation view", () => {
  test("a PROPOSAL presents with the three Guardian-gated transitions", () => {
    const view = okView(buildActionPlanView(scopeA(), plan())) as ActionPlanPresentationView;
    expect(view.status).toBe("PROPOSAL");
    expect(view.isTerminal).toBe(false);
    expect(view.executionHandoff).toBeNull();
    expect(view.availableTransitions.map((t) => t.to)).toEqual(["ADVANCED", "PARKED", "REJECTED"]);
    expect(view.availableTransitions[0]?.viaDecisions).toEqual(["ALLOW", "WARN"]);
    expect(view.availableTransitions[1]?.viaDecisions).toEqual(["REQUIRE_APPROVAL"]);
    expect(view.availableTransitions[2]?.viaDecisions).toEqual(["BLOCK"]);
    expect(view.capability).toBe("lock");
    expect(view.targetCount).toBe(2);
    expect(view.selectedTargets).toEqual([DEV_A1, DEV_A2]);
    expect(view.linkedDecision).toBeNull();
  });

  test("a PARKED plan presents the two human-gated transitions + the linked decision context", () => {
    const parked = plan({ status: "PARKED", version: 2, transitionedAt: T1 });
    const linked = decision({ decision: "REQUIRE_APPROVAL" });
    const view = okView(buildActionPlanView(scopeA(), parked, linked)) as ActionPlanPresentationView;
    expect(view.status).toBe("PARKED");
    expect(view.availableTransitions.map((t) => t.to)).toEqual(["APPROVED", "REJECTED"]);
    expect(view.availableTransitions.every((t) => t.gate === "human_approval")).toBe(true);
    expect(view.linkedDecision?.decision).toBe("REQUIRE_APPROVAL");
    expect(view.linkedDecision?.isBlocking).toBe(true);
    expect(view.linkedDecision?.rules.length).toBe(1);
    expect(view.transitionedAt).toBe(T1);
  });

  test("a REJECTED plan presents refusal state machine-stably with the BLOCK context", () => {
    const rejected = plan({ status: "REJECTED", version: 2, transitionedAt: T1 });
    const linked = decision({ decision: "BLOCK" });
    const view = okView(buildActionPlanView(scopeA(), rejected, linked)) as ActionPlanPresentationView;
    expect(view.status).toBe("REJECTED");
    expect(view.isTerminal).toBe(true);
    expect(view.availableTransitions).toEqual([]);
    expect(view.linkedDecision?.decision).toBe("BLOCK");
    expect(view.linkedDecision?.isBlocking).toBe(true);
  });

  test("an ADVANCED plan is terminal-from-policy-gate with the ALLOW context", () => {
    const advanced = plan({ status: "ADVANCED", version: 2, transitionedAt: T1 });
    const view = okView(
      buildActionPlanView(scopeA(), advanced, decision({ decision: "ALLOW" })),
    ) as ActionPlanPresentationView;
    expect(view.status).toBe("ADVANCED");
    expect(view.isTerminal).toBe(true);
    expect(view.availableTransitions).toEqual([]);
    expect(view.linkedDecision?.decision).toBe("ALLOW");
  });

  test("an APPROVED plan discloses the downstream dispatch handoff (never executed here)", () => {
    const approved = plan({ status: "APPROVED", version: 3, transitionedAt: T2 });
    const view = okView(buildActionPlanView(scopeA(), approved)) as ActionPlanPresentationView;
    expect(view.status).toBe("APPROVED");
    expect(view.availableTransitions).toEqual([]);
    expect(view.executionHandoff).toBe("downstream_dispatch");
    // The serialized presentation carries NO dispatch path of its own.
    const serialized = JSON.stringify(view);
    for (const forbidden of ["intentId", "commandId", "dispatched"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  test("every status presents consistently (exhaustive, no dangling states)", () => {
    for (const status of ALL_STATUSES) {
      const record = plan({ status, version: 2, transitionedAt: status === "PROPOSAL" ? undefined : T1 });
      const result = buildActionPlanView(scopeA(), record);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.view.status).toBe(status);
      expect(result.view.isTerminal).toBe(TERMINAL_PLAN_STATUSES.includes(status));
      expect(result.view.availableTransitions.map((t) => t.to)).toEqual(PLAN_TRANSITIONS[status]);
    }
  });
});

describe("plan presentation validation + tenant discipline", () => {
  test("a target-count mismatch refuses (the count must mirror selectedTargets)", () => {
    const bad = plan({ targetCount: 5 });
    const result = buildActionPlanView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.plan_invalid");
    expect(result.error.failures[0]?.path).toBe("/targetCount");
    expect(result.error.failures[0]?.reason).toBe("target_count_mismatch");
  });

  test("a cross-tenant plan REFUSES (fail-closed)", () => {
    const result = buildActionPlanView(scopeA(), plan({ tenantId: TENANT_B }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.tenant_mismatch");
    expect(result.error.failures[0]?.path).toBe("/plan/tenantId");
  });

  test("a cross-tenant linked decision REFUSES too", () => {
    const result = buildActionPlanView(
      scopeA(),
      plan({ status: "PARKED", version: 2, transitionedAt: T1 }),
      decision({ decision: "REQUIRE_APPROVAL", tenantId: TENANT_B }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/linkedDecision/tenantId");
  });

  test("a malformed plan refuses with a JSON-pointer path", () => {
    const bad = { ...plan(), status: "MYSTERY" } as unknown as SurfaceActionPlanRecord;
    const result = buildActionPlanView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/status");
    expect(result.error.failures[0]?.reason).toBe("unknown_status");
  });

  test("a malformed scope refuses with scope_invalid", () => {
    const result = buildActionPlanView({ tenantId: "" as never }, plan());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.scope_invalid");
  });
});

describe("plan progression surface (explicit transitions walked)", () => {
  test("the PROPOSAL → PARKED → APPROVED path walks with its gated transitions", () => {
    const revisions = [
      plan({ version: 1, status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 2, status: "PARKED", transitionedAt: T1 }),
      plan({ version: 3, status: "APPROVED", transitionedAt: T2 }),
    ];
    const view = okView(buildPlanProgressionView(scopeA(), revisions)) as PlanProgressionView;
    expect(view.steps).toHaveLength(3);
    expect(view.steps[0]?.version).toBe(1);
    expect(view.steps[0]?.transition).toBeNull();
    expect(view.steps[1]?.transition?.to).toBe("PARKED");
    expect(view.steps[1]?.transition?.gate).toBe("guardian_decision");
    expect(view.steps[1]?.transition?.viaDecisions).toEqual(["REQUIRE_APPROVAL"]);
    expect(view.steps[2]?.transition?.to).toBe("APPROVED");
    expect(view.steps[2]?.transition?.gate).toBe("human_approval");
    expect(view.steps[2]?.transitionedAt).toBe(T2);
  });

  test("the PROPOSAL → REJECTED refusal path is machine-stable", () => {
    const revisions = [
      plan({ version: 1, status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 2, status: "REJECTED", transitionedAt: T1 }),
    ];
    const view = okView(buildPlanProgressionView(scopeA(), revisions)) as PlanProgressionView;
    expect(view.steps[1]?.transition?.to).toBe("REJECTED");
    expect(view.steps[1]?.transition?.gate).toBe("guardian_decision");
    expect(view.steps[1]?.transition?.viaDecisions).toEqual(["BLOCK"]);
  });

  test("an illegal transition in the provided history REFUSES", () => {
    const revisions = [
      plan({ version: 1, status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 2, status: "APPROVED", transitionedAt: T1 }),
    ];
    const result = buildPlanProgressionView(scopeA(), revisions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.progression_invalid");
    expect(result.error.failures[0]?.path).toBe("/revisions/1");
    expect(result.error.failures[0]?.reason).toBe("illegal_transition");
  });

  test("duplicate versions refuse; mixed plan ids refuse; empty revisions refuse", () => {
    const dup = buildPlanProgressionView(scopeA(), [
      plan({ version: 1, status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 1, status: "PARKED", transitionedAt: T1 }),
    ]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.failures[0]?.reason).toBe("version_not_increasing");
    const mixed = buildPlanProgressionView(scopeA(), [
      plan({ version: 1, planId: "plan_a", status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 2, planId: "plan_b", status: "PARKED", transitionedAt: T1 }),
    ]);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error.failures[0]?.reason).toBe("plan_id_mismatch");
    const empty = buildPlanProgressionView(scopeA(), []);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.failures[0]?.reason).toBe("array_required");
  });

  test("input order never matters — revisions are ordered by version", () => {
    const revisions = [
      plan({ version: 1, status: "PROPOSAL", transitionedAt: undefined }),
      plan({ version: 2, status: "PARKED", transitionedAt: T1 }),
      plan({ version: 3, status: "APPROVED", transitionedAt: T2 }),
    ];
    const a = okView(buildPlanProgressionView(scopeA(), revisions));
    const b = okView(buildPlanProgressionView(scopeA(), [...revisions].reverse()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("read-only + determinism", () => {
  test("every view is deeply frozen", () => {
    const view = okView(
      buildActionPlanView(
        scopeA(),
        plan({ status: "PARKED", version: 2, transitionedAt: T1 }),
        decision({ decision: "REQUIRE_APPROVAL" }),
      ),
    ) as ActionPlanPresentationView;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.availableTransitions)).toBe(true);
    expect(Object.isFrozen(view.availableTransitions[0])).toBe(true);
    expect(Object.isFrozen(view.linkedDecision)).toBe(true);
    expect(Object.isFrozen(view.selectedTargets)).toBe(true);
  });

  test("the same inputs twice produce byte-identical views", () => {
    const record = plan({ status: "PARKED", version: 2, transitionedAt: T1 });
    const linked = decision({ decision: "REQUIRE_APPROVAL" });
    const a = okView(buildActionPlanView(scopeA(), record, linked));
    const b = okView(buildActionPlanView(scopeA(), record, linked));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the builders never mutate their inputs", () => {
    const record = plan();
    const snapshot = JSON.stringify(record);
    buildActionPlanView(scopeA(), record);
    buildGroupSelectionView(scopeA(), record.selector, record.selectedTargets);
    expect(JSON.stringify(record)).toBe(snapshot);
  });

  test("a print job helper used cross-suite stays untouched (no shared state)", () => {
    // Guards against accidental shared mutable fixtures between files.
    const job = printJob();
    const snapshot = JSON.stringify(job);
    expect(JSON.stringify(printJob())).toBe(snapshot);
    expect(job.status).toBe("ROUTED");
  });
});
