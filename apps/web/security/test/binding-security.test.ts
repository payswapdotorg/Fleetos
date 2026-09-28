/**
 * W060B binding tests — the REAL domain packages bind the surface's
 * structural seams (the W040-disclosed pattern, proven by test).
 * Cross-lane imports are TEST-SCOPE ONLY (per the W060 work order);
 * src/ imports the shared seam @fleetos/contracts exclusively.
 *
 *   - REAL W031 Security Doctor: assessSecurityPosture + the findings
 *     ledger's derived active view feed the findings surface.
 *   - REAL W031 Guardian engine: defineGuardianRule +
 *     compileGuardianRuleSet + evaluateGuardianRequest feed the decision
 *     presentation and the BLOCK history.
 *   - REAL W041 policy gate: createActionPlan + submitActionPlan +
 *     approveParkedPlan feed the parked approvals queue end-to-end.
 *   - The surface's local frozen tables are proven EQUAL to the real
 *     domain tables (no re-declaration drift).
 */

import { describe, expect, test } from "bun:test";
import {
  asCorrelationId,
  asDeviceId,
  asObservationId,
  isBlockingDecision,
} from "@fleetos/contracts";
import {
  makeDeviceId,
  makeTenantId,
} from "@fleetos/contracts/testing";
import {
  assessSecurityPosture,
  createInMemoryPostureFindingsLedger,
} from "@fleetos/security";
import {
  ACTION_PLAN_TRANSITIONS,
  PARKED,
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
} from "@fleetos/actions";
import {
  DECISION_PRECEDENCE_RANK,
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  APPROVAL_QUEUE_TRANSITIONS,
  DECISION_PRECEDENCE_RANK_VIEW,
  buildApprovalsQueueView,
  buildBlockHistoryView,
  buildFindingsListView,
  isBlockingDecisionView,
  presentGuardianDecision,
} from "../src/index";
const TENANT = makeTenantId("w060b-bind");
const DEVICE = makeDeviceId("w060b-binddev");
const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";

function bindScope(): { tenantId: typeof TENANT } {
  return { tenantId: TENANT };
}

describe("binding: the REAL Security Doctor feeds the findings surface", () => {
  test("real assessSecurityPosture findings satisfy the structural seam and render", () => {
    const result = assessSecurityPosture({
      tenantId: TENANT,
      deviceId: DEVICE,
      observations: [
        {
          id: asObservationId("obs_w060b_bind_1"),
          kind: "device.security",
          observedAt: AT,
          schemaVersion: 1,
          payload: { diskEncryption: false },
        },
        {
          id: asObservationId("obs_w060b_bind_2"),
          kind: "device.security",
          observedAt: AT,
          schemaVersion: 1,
          payload: { screenLock: { enabled: false } },
        },
      ],
      at: AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.findings.length).toBe(2);
    // STRUCTURAL BINDING: real SecurityFinding[] flows into the surface
    // seam (readonly SecurityFindingRecord[]).
    const view = buildFindingsListView({ tenantId: TENANT }, result.posture.findings);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(2);
    expect(view.view.tenantId).toBe(TENANT);
    // Real posture ordering is severity-first; the surface preserves it.
    expect(view.view.items[0]?.severity).toBe("CRITICAL");
    // A real CRITICAL finding carries a remediation DRAFT presented as a
    // PROPOSAL with the frozen intent kind.
    expect(view.view.items[0]?.remediationProposal?.presentation).toBe("PROPOSAL");
    expect(view.view.items[0]?.remediationProposal?.intentKind).toBe("SecurityRemediationIntent");
    expect(view.view.items[0]?.remediationProposal?.executionPath).toBe("none");
    // Real evidence refs pass through opaquely.
    expect(view.view.items[0]?.evidence[0]?.observationId).toBe("obs_w060b_bind_1");
    expect(view.view.items[0]?.evidence[0]?.kind).toBe("device.security");
  });

  test("the REAL ledger's derived active view feeds the findings surface (re-assessment supersession visible)", () => {
    const ledger = createInMemoryPostureFindingsLedger({});
    const device2 = asDeviceId("dev_w060b_bind_2");
    const first = assessSecurityPosture({
      tenantId: TENANT,
      deviceId: device2,
      observations: [
        {
          id: asObservationId("obs_w060b_bind_3"),
          kind: "device.security",
          observedAt: AT,
          schemaVersion: 1,
          payload: { diskEncryption: false },
        },
      ],
      at: AT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const recorded = ledger.recordFindings(
      bindScope(),
      device2,
      first.posture.findings,
      { at: AT, correlationId: asCorrelationId("cor_w060b_bind_1") },
    );
    expect(recorded.ok).toBe(true);
    // A later assessment with the same condition supersedes (version 2).
    const second = assessSecurityPosture({
      tenantId: TENANT,
      deviceId: device2,
      observations: [
        {
          id: asObservationId("obs_w060b_bind_4"),
          kind: "device.security",
          observedAt: AT2,
          schemaVersion: 1,
          payload: { diskEncryption: false },
        },
      ],
      at: AT2,
      history: ledger.listEntries(bindScope(), device2),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const recorded2 = ledger.recordFindings(
      bindScope(),
      device2,
      second.posture.findings,
      { at: AT2, correlationId: asCorrelationId("cor_w060b_bind_2") },
    );
    expect(recorded2.ok).toBe(true);
    const active = ledger.resolveActiveFindings(bindScope(), device2);
    expect(active.length).toBe(1);
    const view = buildFindingsListView({ tenantId: TENANT }, active);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.items[0]?.interpretationVersion).toBe(2);
    expect(view.view.items[0]?.supersedes).toBe(first.posture.findings[0]?.recordId);
    expect(view.view.items[0]?.detectedAt).toBe(AT2);
  });
});

describe("binding: the REAL Guardian engine feeds the decision surface", () => {
  function rulesetWith(effect: "REQUIRE_APPROVAL" | "BLOCK" | "ALLOW") {
    const built = defineGuardianRule(TENANT, {
      name: `w060b-bind-${effect.toLowerCase()}`,
      condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
      effect,
      at: AT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT, { rules: [built.rule], version: 1, at: AT });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error.message);
    return compiled.ruleSet;
  }

  test("a real REQUIRE_APPROVAL evaluation presents with the engine's reasons and matched rules", () => {
    // Two rules fire (WARN + REQUIRE_APPROVAL): the engine resolves the
    // blocking precedence and emits the precedence reason.
    const warnRule = defineGuardianRule(TENANT, {
      name: "w060b-bind-warn",
      condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
      effect: "WARN",
      at: AT,
    });
    expect(warnRule.ok).toBe(true);
    if (!warnRule.ok) return;
    const compiled = compileGuardianRuleSet(TENANT, {
      rules: [warnRule.rule, ...rulesetWith("REQUIRE_APPROVAL").rules],
      version: 1,
      at: AT,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const evaluation = evaluateGuardianRequest(compiled.ruleSet, {
      tenantId: TENANT,
      action: { action: "fleet.action.execute" },
    }, { at: AT, correlationId: asCorrelationId("cor_w060b_bind_3") });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    // STRUCTURAL BINDING: the real GuardianEvaluation flows into the
    // surface seam (GuardianEvaluationRecord).
    const presented = presentGuardianDecision({ tenantId: TENANT }, evaluation.evaluation);
    expect(presented.ok).toBe(true);
    if (!presented.ok) return;
    expect(presented.view.decision).toBe("REQUIRE_APPROVAL");
    expect(presented.view.isBlocking).toBe(true);
    expect(presented.view.matchedRules.length).toBe(2);
    expect(presented.view.matchedRules[0]?.effect).toBe("WARN");
    expect(presented.view.matchedRules[1]?.effect).toBe("REQUIRE_APPROVAL");
    // The engine's machine-stable reason codes surface verbatim.
    const codes = presented.view.reasons.map((r) => r.code);
    expect(codes).toContain("policy.rule.matched");
    expect(codes).toContain("policy.precedence.resolved");
    expect(presented.view.ruleSetId).toBe(evaluation.evaluation.ruleSetId);
    expect(presented.view.decidedAt).toBe(AT);
  });

  test("a real BLOCK evaluation lands in the read-only BLOCK history", () => {
    const evaluation = evaluateGuardianRequest(rulesetWith("BLOCK"), {
      tenantId: TENANT,
      action: { action: "fleet.action.execute" },
    }, { at: AT, correlationId: asCorrelationId("cor_w060b_bind_4") });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const history = buildBlockHistoryView({ tenantId: TENANT }, [evaluation.evaluation.decision]);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.view.total).toBe(1);
    expect(history.view.items[0]?.decision).toBe("BLOCK");
    expect(history.view.items[0]?.rules).toEqual(evaluation.evaluation.decision.rules);
  });

  test("the surface's frozen precedence table EQUALS the engine's table (no drift)", () => {
    expect({ ...DECISION_PRECEDENCE_RANK_VIEW }).toEqual({ ...DECISION_PRECEDENCE_RANK });
  });

  test("the surface's blocking semantics EQUALS the frozen contracts helper", () => {
    for (const decisionType of ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const) {
      expect(isBlockingDecisionView(decisionType)).toBe(isBlockingDecision(decisionType));
    }
  });
});

describe("binding: the REAL W041 policy gate feeds the parked approvals queue", () => {
  function parkedPlanWithApprovalRule() {
    const registry = createInMemoryDeviceRegistryView([
      {
        tenantId: TENANT,
        deviceId: asDeviceId("dev_w060b_bind_dev"),
        lifecycleState: "OBSERVE",
        adapterCapabilities: { identify: true, observe: true, lock: true },
        platform: "windows",
        ownership: "corporate",
      },
    ]);
    const plan = createActionPlan({
      name: "w060b-bind-plan",
      selector: { kind: "all" },
      capability: "lock",
      tenantId: TENANT,
      registry,
      at: AT,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.error.message);
    const built = defineGuardianRule(TENANT, {
      name: "w060b-bind-require-approval",
      condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
      effect: "REQUIRE_APPROVAL",
      at: AT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT, { rules: [built.rule], version: 1, at: AT });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error.message);
    const evaluation = evaluateGuardianRequest(compiled.ruleSet, {
      tenantId: TENANT,
      action: { action: "fleet.action.execute" },
    }, { at: AT2, correlationId: asCorrelationId("cor_w060b_bind_5") });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) throw new Error(evaluation.error.message);
    const submitted = submitActionPlan(plan.plan, {
      ruleSet: compiled.ruleSet,
      request: { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind_6"),
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.error.message);
    return submitted;
  }

  test("a real PARKED plan + real REQUIRE_APPROVAL evaluation queue together (structural seam)", () => {
    const submitted = parkedPlanWithApprovalRule();
    expect(submitted.status).toBe(PARKED);
    const evaluation = evaluateGuardianRequest(
      // Re-evaluate identically — deterministic, byte-identical decision.
      (() => {
        const built = defineGuardianRule(TENANT, {
          name: "w060b-bind-require-approval",
          condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
          effect: "REQUIRE_APPROVAL",
          at: AT,
        });
        if (!built.ok) throw new Error(built.error.message);
        const compiled = compileGuardianRuleSet(TENANT, { rules: [built.rule], version: 1, at: AT });
        if (!compiled.ok) throw new Error(compiled.error.message);
        return compiled.ruleSet;
      })(),
      { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      { at: AT2, correlationId: asCorrelationId("cor_w060b_bind_6") },
    );
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const queue = buildApprovalsQueueView({ tenantId: TENANT }, [
      // STRUCTURAL BINDING: real ActionPlanTemplate + real
      // GuardianEvaluation pair flows into the queue seam.
      { plan: submitted.plan, evaluation: evaluation.evaluation },
    ]);
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(queue.view.total).toBe(1);
    const item = queue.view.items[0];
    expect(item?.planId).toBe(submitted.plan.planId);
    expect(item?.capability).toBe("lock");
    expect(item?.targetCount).toBe(1);
    expect(item?.parkedAt).toBe(AT2);
    expect(item?.parkedByDecision.decision).toBe("REQUIRE_APPROVAL");
    expect(item?.availableTransitions.length).toBe(2);
  });

  test("the queue's frozen transition table EQUALS the real W041 parked-plan machine", () => {
    expect(APPROVAL_QUEUE_TRANSITIONS.map((t) => [t.from, t.to])).toEqual(
      ACTION_PLAN_TRANSITIONS[PARKED].map((to) => ["PARKED", to]),
    );
  });

  test("a real APPROVED plan (after approveParkedPlan) REFUSES the queue (fail-closed gate)", () => {
    const submitted = parkedPlanWithApprovalRule();
    const approved = approveParkedPlan(submitted.plan, "approve", {
      at: "2026-06-01T00:00:00Z",
      correlationId: asCorrelationId("cor_w060b_bind_7"),
      approverId: "usr_w060b_approver",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.status).toBe("APPROVED");
    // The approved plan is no longer parked: the queue REFUSES it.
    const built = defineGuardianRule(TENANT, {
      name: "w060b-bind-require-approval",
      condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
      effect: "REQUIRE_APPROVAL",
      at: AT,
    });
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT, { rules: [built.rule], version: 1, at: AT });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const evaluation = evaluateGuardianRequest(compiled.ruleSet, {
      tenantId: TENANT,
      action: { action: "fleet.action.execute" },
    }, { at: AT2, correlationId: asCorrelationId("cor_w060b_bind_6") });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const queue = buildApprovalsQueueView({ tenantId: TENANT }, [
      { plan: approved.plan, evaluation: evaluation.evaluation },
    ]);
    expect(queue.ok).toBe(false);
    if (queue.ok) return;
    expect(queue.error.failures[0]?.reason).toBe("item_not_parked");
  });

  test("a tenant-B scope REFUSES a real tenant-A parked plan (cross-tenant fail-closed)", () => {
    const submitted = parkedPlanWithApprovalRule();
    const built = defineGuardianRule(TENANT, {
      name: "w060b-bind-require-approval",
      condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
      effect: "REQUIRE_APPROVAL",
      at: AT,
    });
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT, { rules: [built.rule], version: 1, at: AT });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const evaluation = evaluateGuardianRequest(compiled.ruleSet, {
      tenantId: TENANT,
      action: { action: "fleet.action.execute" },
    }, { at: AT2, correlationId: asCorrelationId("cor_w060b_bind_6") });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const queue = buildApprovalsQueueView(
      { tenantId: makeTenantId("w060b-other") },
      [{ plan: submitted.plan, evaluation: evaluation.evaluation }],
    );
    expect(queue.ok).toBe(false);
    if (queue.ok) return;
    expect(queue.error.code).toBe("surface.tenant_mismatch");
  });
});
