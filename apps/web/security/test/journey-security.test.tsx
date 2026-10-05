/**
 * W090B web-security — JOURNEY EVIDENCE test (D4): the "remediate a
 * security finding" journey from the UX simulation's required list,
 * walked through the FULL RENDERED screens with the REAL domain
 * packages bound at the test's binding site:
 *
 *   finding -> evidence -> Guardian decision -> approval queue when
 *   parked -> action plan -> verification
 *
 * The flow: the operator sees the CRITICAL finding on the rendered
 * FindingsScreen, opens the record-pattern detail (the remediation is
 * a PROPOSAL — never an execution), walks into the Security Doctor
 * (the gated journey Timeline), reviews the parked plan in the
 * Approvals queue (owner-only, confirm-required — never one-click),
 * approves it (the REAL W041 `approveParkedPlan` step is invoked by
 * the binding site), and lands on the TERMINAL VERIFIED STATE: the
 * APPROVED plan with the downstream-dispatch handoff disclosed and
 * the verification outcome + evidence visible. The proposal/execution
 * distinction is preserved end-to-end (LOCK items 3, 4, 16).
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { asCorrelationId, asDeviceId, asObservationId } from "@fleetos/contracts";
import {
  assessSecurityPosture,
} from "@fleetos/security";
import {
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
} from "@fleetos/actions";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  ApprovalsQueueScreen,
  FindingsScreen,
  SecurityDoctorScreen,
  buildApprovalsQueueView,
  buildFindingsListView,
  presentGuardianDecision,
  requiredApprovalConfirmationPhrase,
} from "../src/index";
import type {
  ApprovalsQueueView,
  FindingsListView,
  SecurityDoctorData,
} from "../src/index";
import { TENANT_A, scopeA } from "./helpers";

afterEach(() => {
  cleanup();
});

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const AT3 = "2026-06-01T00:00:00Z";
const DEVICE = asDeviceId("dev_w090b_journey");

/** The REAL binding-site composition (the whole remediation journey). */
function remediationJourney(): {
  findingsView: FindingsListView;
  decisionView: SecurityDoctorData["decision"];
  queueView: ApprovalsQueueView;
  approvedPlan: SecurityDoctorData["plan"];
  verification: SecurityDoctorData["verification"];
} {
  // 1. The REAL Security Doctor assesses posture -> a CRITICAL finding
  //    with a remediation DRAFT.
  const assessed = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    observations: [
      {
        id: asObservationId("obs_w090b_journey_1"),
        kind: "device.security",
        observedAt: AT,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: AT,
  });
  if (!assessed.ok) throw new Error(assessed.error.message);
  const finding = assessed.posture.findings.find((f) => f.severity === "CRITICAL");
  if (finding === undefined) throw new Error("no CRITICAL finding");

  const findingsBuild = buildFindingsListView(scopeA(), assessed.posture.findings);
  if (!findingsBuild.ok) throw new Error("findings build failed");

  // 2. The REAL Guardian rule set + evaluation -> REQUIRE_APPROVAL.
  const rule = defineGuardianRule(TENANT_A, {
    name: "w090b-journey-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: AT,
  });
  if (!rule.ok) throw new Error(rule.error.message);
  const compiled = compileGuardianRuleSet(TENANT_A, { rules: [rule.rule], version: 1, at: AT });
  if (!compiled.ok) throw new Error(compiled.error.message);
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    { at: AT2, correlationId: asCorrelationId("cor_w090b_journey_1") },
  );
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  const presented = presentGuardianDecision(scopeA(), evaluation.evaluation);
  if (!presented.ok) throw new Error(presented.error.message);

  // 3. The REAL W041 policy gate: create + submit the remediation plan
  //    -> PARKED by the REQUIRE_APPROVAL decision.
  const registry = createInMemoryDeviceRegistryView([
    {
      tenantId: TENANT_A,
      deviceId: DEVICE,
      lifecycleState: "OBSERVE",
      adapterCapabilities: { identify: true, observe: true, lock: true },
      platform: "windows",
      ownership: "corporate",
    },
  ]);
  const plan = createActionPlan({
    name: "w090b-journey-remediation",
    selector: { kind: "byId", deviceIds: [DEVICE] },
    capability: "lock",
    tenantId: TENANT_A,
    registry,
    at: AT2,
  });
  if (!plan.ok) throw new Error(plan.error.message);
  const submitted = submitActionPlan(plan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    at: AT2,
    correlationId: asCorrelationId("cor_w090b_journey_2") as never,
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  if (submitted.status !== "PARKED") throw new Error(`expected PARKED, got ${submitted.status}`);

  const queueBuild = buildApprovalsQueueView(scopeA(), [
    { plan: submitted.plan, evaluation: evaluation.evaluation },
  ]);
  if (!queueBuild.ok) throw new Error(queueBuild.error.message);

  // 4. The REAL human approval: the W041 approveParkedPlan step (the
  //    binding site invokes it; the screen never executes anything).
  const approved = approveParkedPlan(submitted.plan, "approve", {
    at: AT3,
    correlationId: asCorrelationId("cor_w090b_journey_3") as never,
    approverId: "usr_w090b_owner",
  });
  if (!approved.ok) throw new Error(approved.error.message);
  if (approved.status !== "APPROVED") throw new Error(`expected APPROVED, got ${approved.status}`);

  // 5. The post-approval composite (the plan state + the verification
  //    the binding site records after the downstream dispatch).
  const approvedPlan: SecurityDoctorData["plan"] = {
    planId: approved.plan.planId,
    status: approved.plan.status,
    capability: approved.plan.capability,
    targetCount: approved.plan.targetCount,
    approverId: "usr_w090b_owner",
    transitionedAt: approved.plan.transitionedAt,
    executionHandoff: "downstream_dispatch",
    evidenceCount: approved.plan.evidence.length,
    contentDigest: approved.plan.contentDigest,
  };
  const verification: SecurityDoctorData["verification"] = {
    verifiedAt: AT3,
    summary: "lock capability verified on 1 target",
    evidenceCount: approved.plan.evidence.length + 1,
  };

  return {
    findingsView: findingsBuild.view,
    decisionView: presented.view,
    queueView: queueBuild.view,
    approvedPlan,
    verification,
  };
}

test("journey: remediate a finding — proposal -> Guardian gate -> owner approval -> VERIFIED outcome", async () => {
  const user = userEvent.setup();
  const journey = remediationJourney();

  // Step 1 — the findings screen shows the CRITICAL finding.
  function FindingsShell(props: { readonly onRemediate: () => void }): React.JSX.Element {
    const [openFindingId, setOpenFindingId] = useState<string | null>(null);
    return (
      <FindingsScreen
        phase={{ kind: "ready", view: journey.findingsView }}
        severityFilter="all"
        onSeverityFilterChange={(): void => {}}
        openFindingId={openFindingId}
        onOpenFinding={setOpenFindingId}
        onCloseFinding={(): void => setOpenFindingId(null)}
        onRemediate={(): void => props.onRemediate()}
      />
    );
  }
  let remediated = false;
  const { unmount } = render(<FindingsShell onRemediate={(): void => { remediated = true; }} />);
  expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);

  // Step 2 — open the record-pattern detail; the remediation is a PROPOSAL.
  await user.click(screen.getAllByRole("button", { name: /Inspect finding/ })[0] as HTMLElement);
  const sheet = await screen.findByRole("dialog", { name: /Security finding/ });
  expect(within(sheet).getAllByText("PROPOSAL").length).toBeGreaterThan(0);
  expect(within(sheet).getAllByText("SecurityRemediationIntent").length).toBeGreaterThan(0);
  expect(within(sheet).getAllByText(/No direct-execution path/i).length).toBeGreaterThan(0);
  await user.click(within(sheet).getByRole("button", { name: /Walk the remediation journey/ }));
  expect(remediated).toBe(true);
  unmount();

  // Step 3 — the Security Doctor shows the gated journey (REQUIRE_APPROVAL).
  const gatedData: SecurityDoctorData = {
    finding: journey.findingsView.items[0] as SecurityDoctorData["finding"],
    decision: journey.decisionView,
    approval: null,
    plan: null,
    verification: null,
  };
  const { unmount: unmount2 } = render(
    <SecurityDoctorScreen phase={{ kind: "ready", view: gatedData }} />,
  );
  const timeline = screen.getByRole("list", { name: "Remediation journey" });
  expect(within(timeline).getByText("Contract Guardian decision")).toBeDefined();
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("REQUIRE_APPROVAL").length).toBeGreaterThan(0);
  unmount2();

  // Step 4 — the approvals queue: the parked plan with the gated,
  // confirm-required approve (never one-click, never auto-executed).
  let confirmed: [string, "approve" | "reject"] | null = null;
  function QueueShell(): React.JSX.Element {
    const [pending, setPending] = useState<{ planId: string; action: "approve" | "reject" } | null>(null);
    const [acknowledged, setAcknowledged] = useState<boolean>(false);
    const [phrase, setPhrase] = useState<string>("");
    const dialog = pending === null ? null : {
      pending,
      acknowledged,
      phrase,
      refusal: null,
      rejectionReason: "",
    };
    const requiredPhrase = pending === null ? "" : `CONFIRM ${pending.action.toUpperCase()} ${pending.planId}`;
    return (
      <ApprovalsQueueScreen
        phase={{ kind: "ready", view: journey.queueView }}
        actingApprover={{ userId: "usr_w090b_owner" }}
        decisionDialog={dialog}
        onRequestDecision={(planId, action): void => {
          setPending({ planId, action });
          setAcknowledged(false);
          setPhrase("");
        }}
        onCancelDecision={(): void => setPending(null)}
        onAcknowledgeConsequences={(): void => setAcknowledged(true)}
        onPhraseChange={(next): void => setPhrase(next)}
        onRejectionReasonChange={(): void => undefined}
        onConfirmDecision={(): void => {
          if (!acknowledged || phrase !== requiredPhrase) return;
          confirmed = [pending!.planId, pending!.action];
          setPending(null);
        }}
      />
    );
  }
  const { unmount: unmount3 } = render(<QueueShell />);
  await user.click(screen.getByRole("button", { name: /Approve the parked plan w090b-journey-remediation/ }));
  const confirmDialog = await screen.findByRole("alertdialog", { name: /Approve parked plan/ });
  expect(within(confirmDialog).getByText("human_decision")).toBeDefined();
  // W148 — the typed-phrase gate: the operator MUST acknowledge the
  // consequences AND type the exact confirmation phrase. The Confirm
  // button is DISABLED until both hold (never one-click).
  const confirmButton = within(confirmDialog).getByRole("button", { name: "Confirm approve" }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);
  await user.click(within(confirmDialog).getByTestId("confirm-acknowledged"));
  await user.type(within(confirmDialog).getByTestId("confirm-phrase"), requiredApprovalConfirmationPhrase({
    tenantId: "" as never,
    planId: journey.queueView.items[0]!.planId,
    action: "approve",
    by: "" as never,
    correlationId: "" as never,
  }));
  await user.click(confirmButton);
  expect(confirmed).toEqual([journey.queueView.items[0]?.planId, "approve"]);
  // The queue REFUSES the approved plan (fail-closed — no longer PARKED).
  const queueItem = journey.queueView.items[0];
  if (queueItem === undefined) throw new Error("no queue item");
  const approvedPlanRecord: Record<string, unknown> = {
    planId: queueItem.planId,
    tenantId: TENANT_A,
    name: queueItem.name,
    version: queueItem.version,
    status: "APPROVED",
    capability: queueItem.capability,
    targetCount: queueItem.targetCount,
    createdAt: AT,
    transitionedAt: AT3,
    requestedBy: queueItem.requestedBy,
  };
  const rebuilt = buildApprovalsQueueView(scopeA(), [
    {
      plan: approvedPlanRecord as never,
      evaluation: { decision: { decision: "REQUIRE_APPROVAL" } } as never,
    },
  ]);
  expect(rebuilt.ok).toBe(false);
  if (rebuilt.ok) return;
  expect(rebuilt.error.failures.some((failure) => failure.reason === "item_not_parked")).toBe(true);
  unmount3();

  // Step 5 — the TERMINAL VERIFIED STATE: the Security Doctor with the
  // APPROVED plan + the verification outcome + evidence visible.
  const verifiedData: SecurityDoctorData = {
    finding: journey.findingsView.items[0] as SecurityDoctorData["finding"],
    decision: journey.decisionView,
    approval: null,
    plan: journey.approvedPlan,
    verification: journey.verification,
  };
  render(<SecurityDoctorScreen phase={{ kind: "ready", view: verifiedData }} />);
  // The plan is APPROVED with the downstream-dispatch handoff disclosed.
  expect(screen.getAllByText("APPROVED").length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/execution is a downstream dispatch handoff, never performed on this surface/i)
      .length,
  ).toBeGreaterThan(0);
  // The verified outcome is visible with its evidence.
  expect(screen.getAllByText(/lock capability verified on 1 target/i).length).toBeGreaterThan(0);
  const verifiedTimeline = screen.getByRole("list", { name: "Remediation journey" });
  expect(within(verifiedTimeline).getByText("Verified outcome")).toBeDefined();
  expect(within(verifiedTimeline).getAllByText(/Done/i).length).toBeGreaterThan(0);
  // The evidence sections are visible (observations + verification artifacts).
  expect(screen.getAllByText(/obs_w090b_journey_1|verification artifact/i).length).toBeGreaterThan(0);
  // The approver grant is visible.
  expect(screen.getAllByText("usr_w090b_owner").length).toBeGreaterThan(0);
});
