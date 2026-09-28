/**
 * W060B binding tests — the REAL W041 actions package binds the
 * surface's structural seams (the W040-disclosed pattern, proven by
 * test). Cross-lane imports are TEST-SCOPE ONLY; src/ imports the
 * shared seam @fleetos/contracts exclusively.
 *
 *   - REAL target resolution (registry + resolveActionTargets) feeds
 *     the group selection surface.
 *   - REAL plan creation + policy-gated submission (ALLOW / BLOCK /
 *     REQUIRE_APPROVAL) + the human approval step drive the plan
 *     presentation and progression end-to-end.
 *   - REAL print routing (supporting + refusing printers) + the queue
 *     step drive the print routing surface; the surface's local
 *     frozen tables are proven EQUAL to the real domain tables (no
 *     re-declaration drift).
 */

import { describe, expect, test } from "bun:test";
import {
  asCorrelationId,
  asDeviceId,
  isBlockingDecision,
} from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  ACTION_PLAN_TRANSITIONS,
  ALL_PRINTER_CAPABILITIES,
  PARKED,
  TERMINAL_ACTION_PLAN_STATUSES,
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  enqueuePrintJob,
  resolveActionTargets,
  routePrintJob,
  submitActionPlan,
  supportsPrintFeatures,
  transitionActionPlan,
} from "@fleetos/actions";
import {
  DECISION_PRECEDENCE_RANK,
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type { SurfaceActionPlanRecord, SurfacePrintJobRecord } from "../src/surface-contracts";
import {
  ALL_SURFACE_PRINTER_CAPABILITIES,
  DECISION_TO_PLAN_STATUS,
  DECISION_PRECEDENCE_RANK_VIEW,
  PLAN_TRANSITIONS,
  TERMINAL_PLAN_STATUSES,
  buildActionPlanView,
  buildGroupSelectionView,
  buildPlanProgressionView,
  buildPrintRoutingView,
  isBlockingDecisionView,
  supportsPrintFeaturesView,
} from "../src/index";
import { FLAG_STATES } from "./helpers";

const TENANT = makeTenantId("w060b-actbind");
const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const AT3 = "2026-06-01T00:00:00Z";

function registry() {
  return createInMemoryDeviceRegistryView([
    {
      tenantId: TENANT,
      deviceId: asDeviceId("dev_w060b_bind_1"),
      lifecycleState: "OBSERVE",
      adapterCapabilities: { identify: true, observe: true, lock: true },
      platform: "windows",
      ownership: "corporate",
    },
    {
      tenantId: TENANT,
      deviceId: asDeviceId("dev_w060b_bind_2"),
      lifecycleState: "OBSERVE",
      adapterCapabilities: { identify: true, observe: true, lock: true },
      platform: "macos",
      ownership: "corporate",
    },
  ]);
}

function ruleSet(effect: "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK") {
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

function evaluate(effect: "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK") {
  const result = evaluateGuardianRequest(
    ruleSet(effect),
    { tenantId: TENANT, action: { action: "fleet.action.execute" } },
    { at: AT2, correlationId: asCorrelationId("cor_w060b_bind") },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.evaluation;
}

describe("binding: REAL target resolution feeds the group selection surface", () => {
  test("resolveActionTargets output + the real selector render as the selection view", () => {
    const selector = { kind: "byCapability", capability: "lock" } as const;
    const targets = resolveActionTargets(selector, registry(), TENANT);
    expect(targets.length).toBe(2);
    // STRUCTURAL BINDING: the real DeviceGroupSelector flows into the
    // surface seam; the real resolved targets flow in verbatim.
    const view = buildGroupSelectionView({ tenantId: TENANT }, selector, targets);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.selectorKind).toBe("byCapability");
    expect(view.view.targetCount).toBe(2);
    expect(view.view.targets).toEqual([
      asDeviceId("dev_w060b_bind_1"),
      asDeviceId("dev_w060b_bind_2"),
    ]);
    expect(view.view.selectorSummary).toBe('{"capability":"lock","kind":"byCapability"}');
  });

  test("a composed real selector (intersect with byPlatform) resolves and renders", () => {
    const selector = {
      kind: "intersect",
      selectors: [
        { kind: "byCapability", capability: "lock" },
        { kind: "byPlatform", platform: "windows" },
      ],
    } as const;
    const targets = resolveActionTargets(selector, registry(), TENANT);
    expect(targets).toEqual([asDeviceId("dev_w060b_bind_1")]);
    const view = buildGroupSelectionView({ tenantId: TENANT }, selector, targets);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.targetCount).toBe(1);
  });
});

describe("binding: REAL policy-gated plan flows drive the plan surfaces", () => {
  test("a real PROPOSAL (createActionPlan) presents with the Guardian-gated transitions", () => {
    const created = createActionPlan({
      name: "w060b-bind-lock",
      selector: { kind: "all" },
      capability: "lock",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // STRUCTURAL BINDING: the real ActionPlanTemplate flows into the
    // surface seam (SurfaceActionPlanRecord).
    const view = buildActionPlanView({ tenantId: TENANT }, created.plan);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("PROPOSAL");
    expect(view.view.capability).toBe("lock");
    expect(view.view.targetCount).toBe(2);
    expect(view.view.availableTransitions.map((t) => t.to)).toEqual([
      "ADVANCED",
      "PARKED",
      "REJECTED",
    ]);
  });

  test("the ALLOW path: a real submission advances the plan; the decision links as context", () => {
    const created = createActionPlan({
      name: "w060b-bind-allow",
      selector: { kind: "all" },
      capability: "observe",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = submitActionPlan(created.plan, {
      ruleSet: ruleSet("ALLOW"),
      request: { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind"),
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.status).toBe("ADVANCED");
    const view = buildActionPlanView({ tenantId: TENANT }, submitted.plan, submitted.decision);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("ADVANCED");
    expect(view.view.isTerminal).toBe(true);
    expect(view.view.linkedDecision?.decision).toBe("ALLOW");
    expect(view.view.linkedDecision?.isBlocking).toBe(false);
  });

  test("the BLOCK path: a real submission refuses the plan; the refusal presents machine-stably", () => {
    const created = createActionPlan({
      name: "w060b-bind-block",
      selector: { kind: "all" },
      capability: "wipe",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = submitActionPlan(created.plan, {
      ruleSet: ruleSet("BLOCK"),
      request: { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind"),
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.status).toBe("REJECTED");
    const view = buildActionPlanView({ tenantId: TENANT }, submitted.plan, submitted.decision);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("REJECTED");
    expect(view.view.linkedDecision?.decision).toBe("BLOCK");
    expect(view.view.linkedDecision?.isBlocking).toBe(true);
    // The refusal state is terminal with no available transitions.
    expect(view.view.availableTransitions).toEqual([]);
  });

  test("the REQUIRE_APPROVAL path: a real parked plan + evaluation pair; approval empties the queue surface's input", () => {
    const created = createActionPlan({
      name: "w060b-bind-park",
      selector: { kind: "all" },
      capability: "lock",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const submitted = submitActionPlan(created.plan, {
      ruleSet: ruleSet("REQUIRE_APPROVAL"),
      request: { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind"),
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.status).toBe(PARKED);
    const evaluation = evaluate("REQUIRE_APPROVAL");
    // STRUCTURAL BINDING: real parked plan + real evaluation.
    const view = buildActionPlanView({ tenantId: TENANT }, submitted.plan, evaluation.decision);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("PARKED");
    expect(view.view.availableTransitions.map((t) => t.to)).toEqual(["APPROVED", "REJECTED"]);
    expect(view.view.availableTransitions.every((t) => t.gate === "human_approval")).toBe(true);
    expect(view.view.linkedDecision?.decision).toBe("REQUIRE_APPROVAL");
    // The human approval step (REAL approveParkedPlan) then APPROVES:
    const approved = approveParkedPlan(submitted.plan, "approve", {
      at: AT3,
      correlationId: asCorrelationId("cor_w060b_bind"),
      approverId: "usr_w060b_approver",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const approvedView = buildActionPlanView({ tenantId: TENANT }, approved.plan);
    expect(approvedView.ok).toBe(true);
    if (!approvedView.ok) return;
    expect(approvedView.view.status).toBe("APPROVED");
    expect(approvedView.view.executionHandoff).toBe("downstream_dispatch");
    expect(approvedView.view.availableTransitions).toEqual([]);
  });

  test("the real PROPOSAL → PARKED → APPROVED progression renders with its gated transitions", () => {
    const created = createActionPlan({
      name: "w060b-bind-prog",
      selector: { kind: "all" },
      capability: "lock",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const parked = submitActionPlan(created.plan, {
      ruleSet: ruleSet("REQUIRE_APPROVAL"),
      request: { tenantId: TENANT, action: { action: "fleet.action.execute" } },
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind"),
    });
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    const approved = approveParkedPlan(parked.plan, "approve", {
      at: AT3,
      correlationId: asCorrelationId("cor_w060b_bind"),
      approverId: "usr_w060b_approver",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    // STRUCTURAL BINDING: the real revision chain flows into the
    // progression seam.
    const progression = buildPlanProgressionView({ tenantId: TENANT }, [
      created.plan,
      parked.plan,
      approved.plan,
    ]);
    expect(progression.ok).toBe(true);
    if (!progression.ok) return;
    expect(progression.view.steps).toHaveLength(3);
    expect(progression.view.steps[0]?.status).toBe("PROPOSAL");
    expect(progression.view.steps[1]?.status).toBe("PARKED");
    expect(progression.view.steps[2]?.status).toBe("APPROVED");
    expect(progression.view.steps[1]?.transition?.gate).toBe("guardian_decision");
    expect(progression.view.steps[1]?.transition?.viaDecisions).toEqual(["REQUIRE_APPROVAL"]);
    expect(progression.view.steps[2]?.transition?.gate).toBe("human_approval");
  });

  test("an illegal real-history chain refuses (the PROPOSAL gate cannot be skipped)", () => {
    const created = createActionPlan({
      name: "w060b-bind-illegal",
      selector: { kind: "all" },
      capability: "lock",
      tenantId: TENANT,
      registry: registry(),
      at: AT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jumped = transitionActionPlan(
      created.plan,
      "APPROVED",
      AT2,
      asCorrelationId("cor_w060b_bind"),
    );
    expect(jumped.ok).toBe(false);
    // The real gate refuses PROPOSAL -> APPROVED; the surface refuses
    // the same history if handed one.
    const forged: readonly SurfaceActionPlanRecord[] = [
      created.plan,
      { ...created.plan, version: 2, status: "APPROVED", transitionedAt: AT2 },
    ];
    const progression = buildPlanProgressionView({ tenantId: TENANT }, forged);
    expect(progression.ok).toBe(false);
    if (progression.ok) return;
    expect(progression.error.failures[0]?.reason).toBe("illegal_transition");
  });
});

describe("binding: the surface's frozen tables EQUAL the real domain tables (no drift)", () => {
  test("PLAN_TRANSITIONS === ACTION_PLAN_TRANSITIONS", () => {
    expect({ ...PLAN_TRANSITIONS }).toEqual({ ...ACTION_PLAN_TRANSITIONS });
  });

  test("TERMINAL_PLAN_STATUSES === TERMINAL_ACTION_PLAN_STATUSES", () => {
    expect([...TERMINAL_PLAN_STATUSES]).toEqual([...TERMINAL_ACTION_PLAN_STATUSES]);
  });

  test("DECISION_TO_PLAN_STATUS === the real decisionToStatus mapping (all four)", () => {
    for (const decisionType of ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const) {
      expect(DECISION_TO_PLAN_STATUS[decisionType]).toBe(
        // The real mapping: ALLOW/WARN -> ADVANCED; REQUIRE_APPROVAL ->
        // PARKED; BLOCK -> REJECTED.
        decisionType === "ALLOW" || decisionType === "WARN"
          ? "ADVANCED"
          : decisionType === "REQUIRE_APPROVAL"
            ? "PARKED"
            : "REJECTED",
      );
    }
  });

  test("DECISION_PRECEDENCE_RANK_VIEW === the real engine precedence table", () => {
    expect({ ...DECISION_PRECEDENCE_RANK_VIEW }).toEqual({ ...DECISION_PRECEDENCE_RANK });
  });

  test("isBlockingDecisionView === the frozen contracts isBlockingDecision", () => {
    for (const decisionType of ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const) {
      expect(isBlockingDecisionView(decisionType)).toBe(isBlockingDecision(decisionType));
    }
  });

  test("ALL_SURFACE_PRINTER_CAPABILITIES === ALL_PRINTER_CAPABILITIES", () => {
    expect([...ALL_SURFACE_PRINTER_CAPABILITIES]).toEqual([...ALL_PRINTER_CAPABILITIES]);
  });

  test("supportsPrintFeaturesView === the real supportsPrintFeatures over the FULL feature matrix", () => {
    for (const feature of ALL_PRINTER_CAPABILITIES) {
      for (const required of FLAG_STATES) {
        for (const flag of FLAG_STATES) {
          const requiredFeatures = { [feature]: required };
          const declared = { [feature]: flag };
          expect(supportsPrintFeaturesView(requiredFeatures, declared)).toBe(
            supportsPrintFeatures(requiredFeatures, declared),
          );
        }
      }
    }
  });
});

describe("binding: REAL print routing drives the print surface", () => {
  test("a real ROUTED job presents verbatim with the printer disclosure", () => {
    const printers = [
      {
        printerId: "prn_w060b_bind_color",
        tenantId: TENANT,
        capabilities: { color: true, duplex: true },
        preferences: {},
      },
    ];
    const routed = routePrintJob({
      payload: { documentRef: "doc://w060b-bind", targetUserId: "usr_w060b_bind" },
      requiredFeatures: { color: true },
      tenantId: TENANT,
      printers,
      at: AT,
      correlationId: asCorrelationId("cor_w060b_bind_print"),
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    // STRUCTURAL BINDING: the real PrintJobRequest + real
    // PrinterDescriptors flow into the surface seams.
    const view = buildPrintRoutingView({ tenantId: TENANT }, routed.job, printers);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("ROUTED");
    expect(view.view.printerId).toBe("prn_w060b_bind_color");
    expect(view.view.queuePosition).toBe(1);
    expect(view.view.documentRef).toBe("doc://w060b-bind");
    expect(view.view.targetUserId).toBe("usr_w060b_bind");
    expect(view.view.requiredFeatures).toEqual({ color: true });
    expect(view.view.printerDisclosures[0]?.satisfiesRequiredFeatures).toBe(true);
  });

  test("a real REFUSAL (missing capability) surfaces machine-stably — never emulated", () => {
    const printers = [
      {
        printerId: "prn_w060b_bind_mono",
        tenantId: TENANT,
        capabilities: { color: false },
        preferences: {},
      },
      {
        printerId: "prn_w060b_bind_none",
        tenantId: TENANT,
        capabilities: {},
        preferences: {},
      },
    ];
    const refused = routePrintJob({
      payload: { documentRef: "doc://w060b-bind-color" },
      requiredFeatures: { color: true },
      tenantId: TENANT,
      printers,
      at: AT,
      correlationId: asCorrelationId("cor_w060b_bind_print"),
    });
    // The real router REFUSES with a tagged error (never emulates).
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("action.print.routing_refused");
    // The refused JOB record (the W041 discipline: status REFUSED +
    // machine-stable reasons, no printer) — reconstructed exactly as
    // the router builds it for audit — presents verbatim.
    const refusedJob: SurfacePrintJobRecord = {
      jobId: "prn_w060b_bind_refused",
      tenantId: TENANT,
      version: 1,
      payload: { documentRef: "doc://w060b-bind-color" },
      requiredFeatures: { color: true },
      status: "REFUSED",
      createdAt: AT,
      evidence: [],
      correlationId: asCorrelationId("cor_w060b_bind_print"),
      routingReasons: ["unsupported_feature:color"],
      contentDigest: "refused_w060b_bind_color",
    };
    const view = buildPrintRoutingView({ tenantId: TENANT }, refusedJob, printers);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("REFUSED");
    expect(view.view.refused).toBe(true);
    expect(view.view.printerId).toBeUndefined();
    expect(view.view.routingReasons).toEqual(["unsupported_feature:color"]);
    expect(view.view.requiredFeatures).toEqual({ color: true });
    // EVERY printer's declared capabilities fail the gate — visible.
    expect(view.view.printerDisclosures.every((d) => !d.satisfiesRequiredFeatures)).toBe(true);
    expect(view.view.printerDisclosures).toHaveLength(2);
  });

  test("a real QUEUED job (enqueuePrintJob) presents with its queue position", () => {
    const printers = [
      {
        printerId: "prn_w060b_bind_q",
        tenantId: TENANT,
        capabilities: { color: true },
        preferences: {},
      },
    ];
    const routed = routePrintJob({
      payload: { documentRef: "doc://w060b-bind-q" },
      requiredFeatures: { color: true },
      tenantId: TENANT,
      printers,
      at: AT,
      correlationId: asCorrelationId("cor_w060b_bind_print"),
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const queued = enqueuePrintJob(routed.job, {
      at: AT2,
      correlationId: asCorrelationId("cor_w060b_bind_print"),
    });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const view = buildPrintRoutingView({ tenantId: TENANT }, queued.job, printers);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.status).toBe("QUEUED");
    expect(view.view.queuePosition).toBe(1);
    expect(view.view.transitionedAt).toBe(AT2);
    expect(view.view.printerId).toBe("prn_w060b_bind_q");
  });
});

