/**
 * W041 D5 tests — Guardian-gate coverage: ALLOW / REQUIRE_APPROVAL / BLOCK
 * paths. A plan advances ONLY when the Guardian decision is ALLOW (or
 * WARN — non-blocking); REQUIRE_APPROVAL parks the plan for approval;
 * BLOCK rejects with the Guardian's machine-stable reasons. The parked-
 * plan approval step (the W031-deferred human-approval transition) lives
 * in this package.
 */

import { describe, expect, test } from "bun:test";
import { ALLOW, BLOCK, REQUIRE_APPROVAL, WARN } from "@fleetos/contracts";
import {
  createActionPlan,
  submitActionPlan,
  approveParkedPlan,
  transitionActionPlan,
  decisionToStatus,
  canTransitionActionPlan,
  PROPOSAL,
  ADVANCED,
  PARKED,
  APPROVED,
  REJECTED,
  ACTION_PLAN_TRANSITIONS,
  TERMINAL_ACTION_PLAN_STATUSES,
} from "../src/index";
import type { GuardianRequestContext } from "@fleetos/policy";
import {
  CAP_LOCK,
  CAP_OBSERVE,
  CAP_WIPE,
  CORR,
  CORR_2,
  T0,
  T1,
  TENANT_A,
  allSelector,
  actionCondition,
  descriptor,
  evidenceRef,
  registry,
  rule,
  ruleSet,
  scopeA,
} from "./helpers";
import { asDeviceId } from "@fleetos/contracts";

describe("D5: decision-to-status mapping is the frozen Guardian's semantics", () => {
  test("ALLOW -> ADVANCED", () => {
    expect(decisionToStatus(ALLOW)).toBe(ADVANCED);
  });
  test("WARN -> ADVANCED (non-blocking — surfaces the warning, does not hold)", () => {
    expect(decisionToStatus(WARN)).toBe(ADVANCED);
  });
  test("REQUIRE_APPROVAL -> PARKED (held for human approval)", () => {
    expect(decisionToStatus(REQUIRE_APPROVAL)).toBe(PARKED);
  });
  test("BLOCK -> REJECTED (refused with the Guardian's reasons)", () => {
    expect(decisionToStatus(BLOCK)).toBe(REJECTED);
  });
});

describe("D5: the action-plan transition table is the proposal-gated boundary", () => {
  test("PROPOSAL -> ADVANCED / PARKED / REJECTED only", () => {
    expect(ACTION_PLAN_TRANSITIONS[PROPOSAL]).toEqual([ADVANCED, PARKED, REJECTED]);
  });
  test("PARKED -> APPROVED / REJECTED only (the human-approval step)", () => {
    expect(ACTION_PLAN_TRANSITIONS[PARKED]).toEqual([APPROVED, REJECTED]);
  });
  test("ADVANCED / APPROVED / REJECTED are terminal from the policy-gate perspective", () => {
    expect(TERMINAL_ACTION_PLAN_STATUSES).toEqual([ADVANCED, APPROVED, REJECTED]);
    expect(ACTION_PLAN_TRANSITIONS[ADVANCED]).toEqual([]);
    expect(ACTION_PLAN_TRANSITIONS[APPROVED]).toEqual([]);
    expect(ACTION_PLAN_TRANSITIONS[REJECTED]).toEqual([]);
  });
  test("canTransitionActionPlan respects the table", () => {
    expect(canTransitionActionPlan(PROPOSAL, ADVANCED)).toBe(true);
    expect(canTransitionActionPlan(PROPOSAL, PARKED)).toBe(true);
    expect(canTransitionActionPlan(PROPOSAL, REJECTED)).toBe(true);
    expect(canTransitionActionPlan(PROPOSAL, APPROVED)).toBe(false);
    expect(canTransitionActionPlan(PARKED, APPROVED)).toBe(true);
    expect(canTransitionActionPlan(PARKED, REJECTED)).toBe(true);
    expect(canTransitionActionPlan(PARKED, ADVANCED)).toBe(false);
    expect(canTransitionActionPlan(ADVANCED, APPROVED)).toBe(false);
    expect(canTransitionActionPlan(APPROVED, REJECTED)).toBe(false);
    expect(canTransitionActionPlan(REJECTED, PROPOSAL)).toBe(false);
  });
});

describe("D5: Guardian ALLOW path — a plan advances", () => {
  test("ALLOW decision advances the plan and audits the submission", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_allow_01"))]);
    const plan = createActionPlan({
      name: "allow-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The rule set carries an ALLOW rule for the action.
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "allow-rule",
        condition: actionCondition,
        effect: ALLOW,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const sink = { records: [] as unknown[] };
    const auditSink = {
      append: (record: unknown) => {
        sink.records.push(record);
      },
    };
    const result = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: auditSink as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(ADVANCED);
    expect(result.plan.status).toBe(ADVANCED);
    expect(result.plan.version).toBe(2);
    expect(result.decision.decision).toBe(ALLOW);
    // The audit sink received exactly one emission (planSubmitted).
    expect(sink.records.length).toBe(1);
    const record = sink.records[0] as { action: string; details: { decision: string } };
    expect(record.action).toBe("action.plan.submitted");
    expect(record.details.decision).toBe("ALLOW");
  });
});

describe("D5: Guardian REQUIRE_APPROVAL path — a plan parks for approval", () => {
  test("REQUIRE_APPROVAL decision parks the plan and audits the held submission", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_park_01"))]);
    const plan = createActionPlan({
      name: "park-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "require-approval-rule",
        condition: actionCondition,
        effect: REQUIRE_APPROVAL,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const sink = { records: [] as unknown[] };
    const auditSink = {
      append: (record: unknown) => {
        sink.records.push(record);
      },
    };
    const result = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: auditSink as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(PARKED);
    expect(result.plan.status).toBe(PARKED);
    expect(result.plan.version).toBe(2);
    expect(result.decision.decision).toBe(REQUIRE_APPROVAL);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0] as { action: string; details: { decision: string } };
    expect(record.action).toBe("action.plan.submitted");
    expect(record.details.decision).toBe("REQUIRE_APPROVAL");
  });

  test("a parked plan can be approved (the W031-deferred human-approval step lives here)", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_approve_01"))]);
    const plan = createActionPlan({
      name: "approve-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "require-approval-rule",
        condition: actionCondition,
        effect: REQUIRE_APPROVAL,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const parked = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
    });
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    expect(parked.status).toBe(PARKED);
    // The approval step:
    const approved = approveParkedPlan(parked.plan, "approve", {
      at: "2026-03-01T00:00:00Z",
      correlationId: CORR_2,
      approverId: "usr_manager_01",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.status).toBe(APPROVED);
    expect(approved.plan.version).toBe(3);
    expect(approved.plan.status).toBe(APPROVED);
  });

  test("a parked plan can be rejected via the human-approval step", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_reject_parked_01"))]);
    const plan = createActionPlan({
      name: "reject-parked-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "require-approval-rule",
        condition: actionCondition,
        effect: REQUIRE_APPROVAL,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const parked = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
    });
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    const rejected = approveParkedPlan(parked.plan, "reject", {
      at: "2026-03-01T00:00:00Z",
      correlationId: CORR_2,
      approverId: "usr_manager_01",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.status).toBe(REJECTED);
    expect(rejected.plan.version).toBe(3);
  });
});

describe("D5: Guardian BLOCK path — a plan is refused with machine-stable reasons", () => {
  test("BLOCK decision rejects the plan and audits the refusal with the matched rule ids", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_block_01"))]);
    const plan = createActionPlan({
      name: "block-plan",
      selector: allSelector,
      capability: CAP_WIPE, // destructive capability
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const blockRule = rule(TENANT_A, {
      name: "block-destructive-wipe",
      condition: actionCondition,
      effect: BLOCK,
      at: T0,
    });
    const rs = ruleSet(TENANT_A, [blockRule]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const sink = { records: [] as unknown[] };
    const auditSink = {
      append: (record: unknown) => {
        sink.records.push(record);
      },
    };
    const result = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: auditSink as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(REJECTED);
    expect(result.plan.status).toBe(REJECTED);
    expect(result.decision.decision).toBe(BLOCK);
    expect(result.matchedRuleIds).toEqual([blockRule.ruleId as string]);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0] as {
      action: string;
      details: { decision: string; matchedRuleIds: string[] };
    };
    expect(record.action).toBe("action.plan.submitted");
    expect(record.details.decision).toBe("BLOCK");
    expect(record.details.matchedRuleIds).toEqual([blockRule.ruleId as string]);
  });
});

describe("D5: NEVER auto-execute — the proposal-gated boundary is enforced", () => {
  test("submitting a plan that is not in PROPOSAL status is rejected", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_illegal_01"))]);
    const plan = createActionPlan({
      name: "illegal-submit-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Transition the plan to ADVANCED first (simulating a prior submission).
    const advanced = transitionActionPlan(plan.plan, ADVANCED, T1);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    const rs = ruleSet(TENANT_A, []);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const result = submitActionPlan(advanced.plan, {
      ruleSet: rs,
      request,
      at: "2026-03-01T00:00:00Z",
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.plan.illegal_transition");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("status_not_proposal");
    }
  });

  test("approving a plan that is not in PARKED status is rejected", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_illegal_approve_01"))]);
    const plan = createActionPlan({
      name: "illegal-approve-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The plan is in PROPOSAL status; approving it is illegal (the
    // approval step requires PARKED).
    const result = approveParkedPlan(plan.plan, "approve", {
      at: T1,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.plan.illegal_transition");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("status_not_parked");
    }
  });
});

describe("D5: tenant mismatch is rejected at the action boundary", () => {
  test("a plan's tenant must match the rule set's and request's tenant (fail-closed)", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_tenant_mismatch_01"))]);
    const plan = createActionPlan({
      name: "tenant-mismatch-plan",
      selector: allSelector,
      capability: CAP_LOCK,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Build a rule set for tenant B and a request for tenant B; the plan
    // is for tenant A — the submission MUST refuse.
    const rs = ruleSet(
      // Note: ruleSet helper takes a TenantId; we use a tenant-B rule set.
      TENANT_A,
      [rule(TENANT_A, { name: "x", condition: actionCondition, effect: ALLOW, at: T0 })],
    );
    // Construct a request that names tenant B explicitly:
    const request: GuardianRequestContext = {
      tenantId: TENANT_A, // same as the plan
      action: { action: "fleet.action.execute" },
    };
    // Now mutate the rule set's tenant (via a synthetic cross-tenant
    // simulation): we build a SEPARATE rule set for tenant B and try to
    // submit the tenant-A plan against it.
    const tenantBRuleSet = {
      ...rs,
      tenantId: "tnt_testtenant000b" as never,
      rules: rs.rules.map((r) => ({ ...r, tenantId: "tnt_testtenant000b" as never })),
    } as typeof rs;
    const result = submitActionPlan(plan.plan, {
      ruleSet: tenantBRuleSet,
      request,
      at: T1,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.plan.tenant_mismatch");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("tenant_mismatch");
    }
  });
});

// Suppress unused import warnings (CAP_LOCK, evidenceRef kept for future expansion).
void CAP_LOCK;
void evidenceRef;
void scopeA;
