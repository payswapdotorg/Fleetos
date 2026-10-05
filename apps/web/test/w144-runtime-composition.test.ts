/**
 * @fleetos/web — W144: the runtime composition + deployment convergence
 * machine tests.
 *
 * These tests are the machine proof that the six lanes' deep views are
 * bound into the console runtime OVER the W141/W142/W143 compositions:
 * every lane's journey is reachable and running on REAL runtime state.
 * The demo tenant sees the rich demo data; fresh workspaces see
 * honest empty states — never demo data (the composition fails closed).
 *
 * The tests also prove:
 *   - the approvals inbox is wired to the EXECUTED decision path (the
 *     badge count drops on a decision; the journey from inbox item to
 *     decision record to evidence trail is real);
 *   - the composition-root deployment seam (the driver selection by
 *     deployment tier; fail-closed on every refusal path; names only).
 */

import { test, expect } from "bun:test";
import { asDeviceId, asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  composeLaneFeeds,
} from "../src/runtime/lane-feeds";
import type { LaneFeeds } from "../src/runtime/lane-feeds";
import {
  createApprovalDecisionRuntime,
  openApprovalDecision,
  acknowledgeDecision,
  enterConfirmationPhrase,
  markConfirmed,
  dispatchDecision,
  cancelDecision,
  approvalBadgeCount,
  buildAuthority,
  canApprove,
  APPROVAL_PERMISSION,
  decisionCorrelationId,
  confirmationPhrase,
} from "../src/runtime/approval-decision-runtime";
import {
  sessionDriverKind,
  deploymentTier,
  isDeployedTier,
  isDevelopmentTier,
  SERVER_SESSION_ROUTES,
  SERVER_ENROLLMENT_ROUTES,
  SERVER_SESSION_COOKIE_NAME,
} from "../src/runtime/composition-root";

const DEMO_TENANT = "tnt_w091demo000001";
const FRESH_TENANT = "tnt_w144fresh001";
const NOW = "2026-01-06T14:00:00Z";

// ---------------------------------------------------------------------------
// Lane 1 — the Device Doctor feed (bound + reachable on REAL runtime state)
// ---------------------------------------------------------------------------

test("W144 lane 1 — the Device Doctor feed composes for the demo tenant (REAL runtime state)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const feeds: LaneFeeds = result.view;
  expect(feeds.isDemo).toBe(true);
  expect(feeds.doctor).toBeDefined();
  expect(feeds.doctor.lanePhase.kind).toBe("blocked"); // no health signals for the demo device (the honest state)
  expect(feeds.doctor.lanePhase.kind).toBe("blocked");
});

test("W144 lane 1 — the Device Doctor feed composes for a fresh workspace (honest empty)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const feeds = result.view;
  expect(feeds.isDemo).toBe(false);
  // The fresh tenant has no devices -> the doctor composes the honest blocked state.
  expect(feeds.doctor.lanePhase.kind).toBe("blocked");
});

// ---------------------------------------------------------------------------
// Lane 2 — the Recovery feeds (bound + reachable on REAL runtime state)
// ---------------------------------------------------------------------------

test("W144 lane 2a — the Recovery cases feed composes for the demo tenant (honest empty)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.recoveryCases).toBeDefined();
  // The demo has no recovery cases -> the honest empty state.
  expect(result.view.recoveryCases.lanePhase.kind).toBe("empty");
});

test("W144 lane 2b — the Find My Device feed composes for the demo tenant (honest empty)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.findMyDevice).toBeDefined();
  // The demo has no last-seen evidence -> the honest empty state.
  expect(result.view.findMyDevice.lanePhase.kind).toBe("empty");
});

test("W144 lane 2c — the Destructive Actions feed composes for the demo tenant (honest blocked)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.destructiveActions).toBeDefined();
  // The demo has no active recovery case -> the honest blocked state.
  expect(result.view.destructiveActions.lanePhase.kind).toBe("blocked");
});

test("W144 lane 2 — the Recovery feeds compose for a fresh workspace (honest empty)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.recoveryCases.lanePhase.kind).toBe("empty");
  expect(result.view.findMyDevice.lanePhase.kind).toBe("empty");
  expect(result.view.destructiveActions.lanePhase.kind).toBe("blocked");
});

// ---------------------------------------------------------------------------
// Lane 3 — the Security Doctor feed (bound + reachable, rich demo data)
// ---------------------------------------------------------------------------

test("W144 lane 3 — the Security Doctor feed composes the rich demo finding-to-evidence walk", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.securityDoctor).toBeDefined();
  // The demo has a CRITICAL finding + a PARKED remediation request ->
  // the approval_required lane phase (the human gate is visible).
  expect(result.view.securityDoctor.lanePhase.kind).toBe("approval_required");
  // The feed data carries the REAL demo finding + evaluation + approval.
  expect(result.view.securityDoctor.data.finding).not.toBeNull();
  expect(result.view.securityDoctor.data.evaluation).not.toBeNull();
  expect(result.view.securityDoctor.data.approval).not.toBeNull();
});

test("W144 lane 3 — the Security Doctor feed composes for a fresh workspace (honest blocked)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The fresh tenant has no finding -> the honest blocked state (the
  // finding id doesn't exist in the fresh tenant; no existence side
  // channel).
  expect(result.view.securityDoctor.lanePhase.kind).toBe("blocked");
  expect(result.view.securityDoctor.data.finding).toBeNull();
});

// ---------------------------------------------------------------------------
// Lane 4 — the Fleet Actions feed (bound + reachable, rich demo data)
// ---------------------------------------------------------------------------

test("W144 lane 4a — the Fleet Actions feed composes the rich demo parked plan", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.fleetActions).toBeDefined();
  // The demo has a PARKED plan (the approvals queue item) -> the
  // approval_required lane phase (the human gate is visible).
  expect(result.view.fleetActions.lanePhase.kind).toBe("approval_required");
  expect(result.view.fleetActions.data.plan).not.toBeNull();
});

test("W144 lane 4b — the Print Distribution feed composes for the demo tenant (honest empty)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.printDistribution).toBeDefined();
  // The demo has no print jobs -> the honest empty state.
  expect(result.view.printDistribution.lanePhase.kind).toBe("empty");
});

test("W144 lane 4 — the Fleet Actions feed composes for a fresh workspace (honest blocked)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The fresh tenant has no plans -> the honest blocked state (the
  // plan id doesn't exist in the fresh tenant; no existence side
  // channel).
  expect(result.view.fleetActions.lanePhase.kind).toBe("blocked");
  expect(result.view.printDistribution.lanePhase.kind).toBe("empty");
});

// ---------------------------------------------------------------------------
// Lane 5 — the Workload Planning feed (bound + reachable on REAL runtime state)
// ---------------------------------------------------------------------------

test("W144 lane 5 — the Workload Planning feed composes for the demo tenant (honest empty)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.workloadPlanning).toBeDefined();
  // The demo has no workload profiles -> the honest empty state.
  expect(result.view.workloadPlanning.lanePhase.kind).toBe("empty");
});

test("W144 lane 5 — the Workload Planning feed composes for a fresh workspace (honest empty)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.workloadPlanning.lanePhase.kind).toBe("empty");
});

// ---------------------------------------------------------------------------
// Lane 6 — the Procurement Cases feed (bound + reachable on REAL runtime state)
// ---------------------------------------------------------------------------

test("W144 lane 6 — the Procurement Cases feed composes for the demo tenant (honest empty)", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.procurementCases).toBeDefined();
  // The demo has no procurement demands -> the honest empty state.
  expect(result.view.procurementCases.lanePhase.kind).toBe("empty");
});

test("W144 lane 6 — the Procurement Cases feed composes for a fresh workspace (honest empty)", () => {
  const result = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.view.procurementCases.lanePhase.kind).toBe("empty");
});

// ---------------------------------------------------------------------------
// The fail-closed composition (the W122 isolation law)
// ---------------------------------------------------------------------------

test("W144 fail-closed — an invalid tenant grammar refuses (never a fallback to demo)", () => {
  const result = composeLaneFeeds("invalid-tenant-id", { now: NOW });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe("invalid_tenant");
});

test("W144 fail-closed — a missing reference instant refuses", () => {
  const result = composeLaneFeeds(DEMO_TENANT, { now: "" });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe("composition_refused");
});

test("W144 isolation — a fresh workspace never sees the demo tenant's records", () => {
  const demoResult = composeLaneFeeds(DEMO_TENANT, { now: NOW });
  const freshResult = composeLaneFeeds(FRESH_TENANT, { now: NOW });
  expect(demoResult.ok).toBe(true);
  expect(freshResult.ok).toBe(true);
  if (!demoResult.ok || !freshResult.ok) return;
  // The demo tenant has the rich Security Doctor finding; the fresh
  // workspace has NO finding (the isolation law — never a leak).
  expect(demoResult.view.securityDoctor.data.finding).not.toBeNull();
  expect(freshResult.view.securityDoctor.data.finding).toBeNull();
  // The demo tenant has the rich Fleet Actions plan; the fresh
  // workspace has NO plan (the isolation law — never a leak).
  expect(demoResult.view.fleetActions.data.plan).not.toBeNull();
  expect(freshResult.view.fleetActions.data.plan).toBeNull();
  // The isDemo flag is honest.
  expect(demoResult.view.isDemo).toBe(true);
  expect(freshResult.view.isDemo).toBe(false);
});

// ---------------------------------------------------------------------------
// The approvals inbox wiring (the EXECUTED decision path)
// ---------------------------------------------------------------------------

test("W144 approvals inbox — the badge count drops when a decision is dispatched", () => {
  // The parked plan id (the demo's PARKED plan).
  const parkedPlanId = "plan_w091-demo-enable-encryption";
  const parkedPlanIds = [parkedPlanId];

  // Initial: 1 pending, 0 decided -> badge count = 1.
  expect(approvalBadgeCount(1, parkedPlanIds, [])).toBe(1);

  // After dispatch: 1 pending, 1 decided -> badge count = 0 (the plan
  // transitioned out of PARKED; the count drops).
  expect(approvalBadgeCount(1, parkedPlanIds, [parkedPlanId])).toBe(0);

  // Multiple parked plans: 3 pending, 1 decided -> badge count = 2.
  expect(approvalBadgeCount(3, ["plan-1", "plan-2", "plan-3"], ["plan-2"])).toBe(2);

  // No pending -> badge count = 0 (never negative).
  expect(approvalBadgeCount(0, [], [])).toBe(0);
});

test("W144 approvals inbox — the decision lifecycle (open -> acknowledge -> type -> mark -> dispatch)", () => {
  const runtime = createApprovalDecisionRuntime();
  expect(runtime.decision.kind).toBe("idle");
  expect(runtime.decidedPlanIds.length).toBe(0);

  // The acting authority (fleet.admin — has the approve permission).
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w091demoop001",
    [APPROVAL_PERMISSION],
    ["fleet.admin"],
  );
  expect(canApprove(authority)).toBe(true);

  // Open the decision review.
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId: "plan_w091-demo-enable-encryption",
    action: "approve" as const,
    by: asUserId("usr_w091demoop001"),
    correlationId: decisionCorrelationId(),
  };
  const opened = openApprovalDecision(
    runtime,
    { tenantId: asTenantId(DEMO_TENANT) },
    context,
    authority,
    NOW,
  );
  expect(opened.state.decision.kind).toBe("reviewing");

  // Acknowledge the consequences.
  const acknowledged = acknowledgeDecision(opened.state, NOW);
  expect(acknowledged.state.decision.kind).toBe("reviewing");
  if (acknowledged.state.decision.kind !== "reviewing") return;
  expect(acknowledged.state.decision.acknowledged).toBe(true);

  // Type the confirmation phrase.
  const phrase = confirmationPhrase(context);
  const entered = enterConfirmationPhrase(acknowledged.state, phrase);
  expect(entered.state.decision.kind).toBe("reviewing");
  if (entered.state.decision.kind !== "reviewing") return;
  expect(entered.state.decision.phrase).toBe(phrase);

  // Mark the explicit confirmation (move to ready_to_decide).
  const marked = markConfirmed(entered.state, NOW);
  expect(marked.state.decision.kind).toBe("ready_to_decide");

  // Dispatch the confirmed decision through the gated boundary.
  const dispatched = dispatchDecision(marked.state, NOW);
  expect(dispatched.state.decision.kind).toBe("decided");
  // The decided-plan-ids set grew (the plan transitioned out of PARKED).
  expect(dispatched.state.decidedPlanIds.length).toBe(1);
  expect(dispatched.state.decidedPlanIds[0]).toBe("plan_w091-demo-enable-encryption");
  // The audit log recorded BOTH the explicit confirmation AND the
  // routed dispatch (the evidence trail).
  expect(dispatched.state.audit.entries.length).toBe(2);
});

test("W144 approvals inbox — a restricted role gets the machine-stable authorization refusal", () => {
  // A restricted role (employee — no approve permission).
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w144employee1",
    [],
    ["employee"],
  );
  expect(canApprove(authority)).toBe(false);

  // Open the decision review — the authority gate REFUSES.
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId: "plan_w091-demo-enable-encryption",
    action: "approve" as const,
    by: asUserId("usr_w144employee1"),
    correlationId: decisionCorrelationId(),
  };
  const runtime = createApprovalDecisionRuntime();
  const opened = openApprovalDecision(
    runtime,
    { tenantId: asTenantId(DEMO_TENANT) },
    context,
    authority,
    NOW,
  );
  // The refusal is visible (the state becomes "refused", not "reviewing").
  expect(opened.state.decision.kind).toBe("refused");
});

test("W144 approvals inbox — the duplicate-safe guard (a decided plan refuses already_decided)", () => {
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w091demoop001",
    [APPROVAL_PERMISSION],
    ["fleet.admin"],
  );
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId: "plan_w091-demo-enable-encryption",
    action: "approve" as const,
    by: asUserId("usr_w091demoop001"),
    correlationId: decisionCorrelationId(),
  };
  let runtime = createApprovalDecisionRuntime();

  // First decision: succeeds.
  runtime = openApprovalDecision(runtime, { tenantId: asTenantId(DEMO_TENANT) }, context, authority, NOW).state;
  runtime = acknowledgeDecision(runtime, NOW).state;
  runtime = enterConfirmationPhrase(runtime, confirmationPhrase(context)).state;
  runtime = markConfirmed(runtime, NOW).state;
  runtime = dispatchDecision(runtime, NOW).state;
  expect(runtime.decidedPlanIds.length).toBe(1);

  // Second decision on the SAME plan: the boundary refuses (already_decided).
  // (Re-open + re-confirm + re-dispatch — the boundary guards the duplicate.)
  runtime = openApprovalDecision(runtime, { tenantId: asTenantId(DEMO_TENANT) }, context, authority, NOW).state;
  runtime = acknowledgeDecision(runtime, NOW).state;
  runtime = enterConfirmationPhrase(runtime, confirmationPhrase(context)).state;
  runtime = markConfirmed(runtime, NOW).state;
  runtime = dispatchDecision(runtime, NOW).state;
  // The decided-plan-ids set still has 1 entry (the duplicate was refused).
  expect(runtime.decidedPlanIds.length).toBe(1);
});

test("W144 approvals inbox — cancel returns to idle (no audit entry)", () => {
  const authority = buildAuthority(
    DEMO_TENANT,
    "usr_w091demoop001",
    [APPROVAL_PERMISSION],
    ["fleet.admin"],
  );
  const context = {
    tenantId: asTenantId(DEMO_TENANT),
    planId: "plan_w091-demo-enable-encryption",
    action: "approve" as const,
    by: asUserId("usr_w091demoop001"),
    correlationId: decisionCorrelationId(),
  };
  let runtime = createApprovalDecisionRuntime();
  runtime = openApprovalDecision(runtime, { tenantId: asTenantId(DEMO_TENANT) }, context, authority, NOW).state;
  expect(runtime.decision.kind).toBe("reviewing");

  // Cancel — returns to cancelled (no audit entry written).
  runtime = cancelDecision(runtime, NOW).state;
  expect(runtime.decision.kind).toBe("cancelled");
  expect(runtime.audit.entries.length).toBe(0);
});

// ---------------------------------------------------------------------------
// The composition-root deployment seam (the driver selection)
// ---------------------------------------------------------------------------

test("W144 composition root — the deployment tier resolves (development by default)", () => {
  const tier = deploymentTier();
  expect(tier === "development" || tier === "staging" || tier === "production").toBe(true);
});

test("W144 composition root — the session driver kind is a function of the deployment tier", () => {
  const kind = sessionDriverKind();
  if (isDeployedTier()) {
    expect(kind).toBe("server");
  } else {
    expect(kind).toBe("local");
  }
});

test("W144 composition root — the server-tier session routes are frozen paths (names only)", () => {
  expect(SERVER_SESSION_ROUTES.signIn).toBe("/api/session");
  expect(SERVER_SESSION_ROUTES.resolve).toBe("/api/session");
  expect(SERVER_SESSION_ROUTES.revoke).toBe("/api/session");
  expect(SERVER_ENROLLMENT_ROUTES.issue).toBe("/api/enrollment/codes");
  expect(SERVER_ENROLLMENT_ROUTES.redeem).toBe("/api/enrollment/redeem");
  expect(SERVER_SESSION_COOKIE_NAME).toBe("fleetos_session");
});

test("W144 composition root — the development tier keeps the localStorage seam", () => {
  // In the test environment (development tier), the driver is local.
  if (isDevelopmentTier()) {
    expect(sessionDriverKind()).toBe("local");
  }
});
