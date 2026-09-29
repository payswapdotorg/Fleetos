/**
 * W090B web-actions — JOURNEY EVIDENCE tests (D4): the two
 * actions-lane journeys from the UX simulation's required list,
 * walked through the FULL RENDERED screens with the REAL domain
 * packages bound at the test's binding site:
 *
 *   1. "approve / execute / verify a Fleet Action" — the intent ->
 *      proposal -> Guardian gate (REQUIRE_APPROVAL) -> the human
 *      approval (the REAL W041 `approveParkedPlan` step, invoked by
 *      the binding site) -> the APPROVED plan with the DOWNSTREAM
 *      DISPATCH handoff disclosed -> the VERIFIED outcome with
 *      evidence visible. A proposal is NEVER presented as an executed
 *      action (the stop-the-line rule).
 *
 *   2. "route a print job" — the print intent -> the REAL router ->
 *      the REAL queue (enqueuePrintJob) -> the recorded COMPLETED
 *      revision (the binding site records the physical printer's
 *      completion report through the REAL append-only store) -> the
 *      SUCCEEDED job state with the verification evidence visible.
 *      The REFUSED path is asserted too: the routing refusal is
 *      visible and actionable, never a hidden technical error.
 *
 * The happy-dom window is installed by the test preload.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import {
  asCorrelationId,
  asDeviceId,
} from "@fleetos/contracts";
import {
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  createInMemoryPrintStore,
  enqueuePrintJob,
  routePrintJob,
  submitActionPlan,
} from "@fleetos/actions";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  FleetActionsScreen,
  PrintScreen,
  buildActionPlanView,
  buildGroupSelectionView,
  buildPlanProgressionView,
  buildPrintRoutingView,
} from "../src/index";
import type { FleetActionJourneyData, PrintJourneyData } from "../src/index";
import { TENANT_A, scopeA } from "./helpers";

afterEach(() => {
  cleanup();
});

import { cleanup } from "@testing-library/react";

const AT = "2026-04-01T00:00:00Z";
const AT2 = "2026-05-01T00:00:00Z";
const AT3 = "2026-06-01T00:00:00Z";
const DEVICE = asDeviceId("dev_w090b_actjourney");

test("journey: approve / execute / verify a Fleet Action — the gated path end-to-end", () => {
  // 1. The REAL W041 intent: create the plan (a PROPOSAL).
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
  const created = createActionPlan({
    name: "w090b-journey-lock",
    selector: { kind: "byId", deviceIds: [DEVICE] },
    capability: "lock",
    tenantId: TENANT_A,
    registry,
    at: AT,
  });
  if (!created.ok) throw new Error(created.error.message);

  // 2. The REAL Guardian gate: REQUIRE_APPROVAL parks the plan.
  const rule = defineGuardianRule(TENANT_A, {
    name: "w090b-journey-approval",
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
    { at: AT2, correlationId: asCorrelationId("cor_w090b_actj_1") },
  );
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  const submitted = submitActionPlan(created.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_A, action: { action: "fleet.action.execute" } },
    at: AT2,
    correlationId: asCorrelationId("cor_w090b_actj_2") as never,
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  if (submitted.status !== "PARKED") throw new Error(`expected PARKED, got ${submitted.status}`);

  // 3. The rendered PARKED journey (the approval requirement visible).
  const parkedView = buildActionPlanView(scopeA(), submitted.plan, evaluation.evaluation.decision);
  if (!parkedView.ok) throw new Error(parkedView.error.message);
  const progression = buildPlanProgressionView(scopeA(), [created.plan, submitted.plan]);
  if (!progression.ok) throw new Error(progression.error.message);
  const selection = buildGroupSelectionView(scopeA(), submitted.plan.selector, [DEVICE]);
  if (!selection.ok) throw new Error(selection.error.message);
  const parkedJourney: FleetActionJourneyData = {
    plan: parkedView.view,
    progression: progression.view,
    selection: selection.view,
    verification: null,
  };

  const { unmount } = render(<FleetActionsScreen phase={{ kind: "ready", view: parkedJourney }} />);
  // The seven consequential fields are visible.
  expect(screen.getAllByText("PARKED").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Approval REQUIRED: the plan is parked until an owner/i).length).toBeGreaterThan(0);
  // The authorization + expected effect + evidence are visible.
  expect(screen.getAllByText(/lock/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/1 device/i).length).toBeGreaterThan(0);
  // A proposal is NEVER presented as executed.
  expect(screen.getAllByText(/a PROPOSAL, never an execution/i).length).toBeGreaterThan(0);
  unmount();

  // 4. The REAL human approval: the W041 approveParkedPlan step (the
  //    binding site invokes it; the screen never executes anything).
  const approved = approveParkedPlan(submitted.plan, "approve", {
    at: AT3,
    correlationId: asCorrelationId("cor_w090b_actj_3") as never,
    approverId: "usr_w090b_owner",
  });
  if (!approved.ok) throw new Error(approved.error.message);
  if (approved.status !== "APPROVED") throw new Error(`expected APPROVED, got ${approved.status}`);

  // 5. The TERMINAL VERIFIED STATE: the approved plan with the
  //    downstream-dispatch handoff + the verification record.
  const approvedView = buildActionPlanView(scopeA(), approved.plan, evaluation.evaluation.decision);
  if (!approvedView.ok) throw new Error(approvedView.error.message);
  const approvedProgression = buildPlanProgressionView(scopeA(), [
    created.plan,
    submitted.plan,
    approved.plan,
  ]);
  if (!approvedProgression.ok) throw new Error(approvedProgression.error.message);
  const verifiedJourney: FleetActionJourneyData = {
    plan: approvedView.view,
    progression: approvedProgression.view,
    selection: selection.view,
    verification: {
      verifiedAt: AT3,
      summary: "lock capability verified on 1 target",
      evidenceCount: approved.plan.evidence.length + 1,
    },
  };
  render(<FleetActionsScreen phase={{ kind: "ready", view: verifiedJourney }} />);
  // The APPROVED status + the downstream-dispatch disclosure.
  expect(screen.getAllByText("APPROVED").length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/execution is a DOWNSTREAM DISPATCH handoff \(never performed on this surface\)/i)
      .length,
  ).toBeGreaterThan(0);
  // The verification result + evidence are visible.
  expect(screen.getAllByText(/lock capability verified on 1 target/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/verification cites/i).length).toBeGreaterThan(0);
  const timeline = screen.getByRole("list", { name: "Fleet action journey" });
  expect(within(timeline).getByText("Verification")).toBeDefined();
  // The walked progression includes the human approval gate.
  const progressionList = screen.getByRole("list", { name: "Plan progression" });
  expect(within(progressionList).getAllByText(/gate human_approval/i).length).toBeGreaterThan(0);
  // The evidence section renders with the content digest (opaque).
  expect(screen.getAllByText(/content digest/i).length).toBeGreaterThan(0);
});

test("journey: route a print job — intent -> router -> queue -> COMPLETED with verification", () => {
  const printers = [
    {
      printerId: "prn_w090b_color",
      tenantId: TENANT_A,
      capabilities: { color: true, duplex: true },
      preferences: {},
      approved: true,
      location: "hq",
    },
    {
      printerId: "prn_w090b_mono",
      tenantId: TENANT_A,
      capabilities: { duplex: true },
      preferences: {},
      approved: true,
      location: "annex",
    },
  ];

  // 1. The REAL router: the intent resolves to the supporting printer.
  const routed = routePrintJob({
    payload: { documentRef: "doc://w090b-journey-report", targetUserId: "usr_w090b_actj" as never },
    requiredFeatures: { color: true },
    tenantId: TENANT_A,
    printers,
    at: AT,
    correlationId: asCorrelationId("cor_w090b_prntj_1"),
  });
  if (!routed.ok) throw new Error(routed.error.message);
  if (routed.job.status !== "ROUTED") throw new Error(`expected ROUTED, got ${routed.job.status}`);

  // 2. The REAL queue: the job enqueues at its printer.
  const enqueued = enqueuePrintJob(routed.job, {
    at: AT2,
    correlationId: asCorrelationId("cor_w090b_prntj_2"),
  });
  if (!enqueued.ok) throw new Error(enqueued.error.message);
  if (enqueued.job.status !== "QUEUED") throw new Error(`expected QUEUED, got ${enqueued.job.status}`);

  // 3. The rendered queued journey (the Running semantics).
  const queuedView = buildPrintRoutingView(scopeA(), enqueued.job, printers);
  if (!queuedView.ok) throw new Error(queuedView.error.message);
  const queuedJourney: PrintJourneyData = {
    job: queuedView.view,
    queue: {
      printerId: enqueued.job.printerId as string,
      depth: enqueued.queueState.depth,
      queuedJobIds: [...enqueued.queueState.queuedJobIds],
      updatedAt: enqueued.queueState.updatedAt,
    },
    verification: null,
  };
  const { unmount } = render(<PrintScreen phase={{ kind: "ready", view: queuedJourney }} />);
  expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  expect(screen.getAllByText("QUEUED").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/prn_w090b_color/).length).toBeGreaterThan(0);
  // The mono printer is disclosed as NOT satisfying the color requirement.
  expect(screen.getAllByText("Does not satisfy").length).toBeGreaterThan(0);
  unmount();

  // 4. The completion: the binding site records the physical
  //    printer's completion report through the REAL append-only
  //    store (a NEW revision — the prior is never rewritten).
  const store = createInMemoryPrintStore();
  const scope = { tenantId: TENANT_A, correlationId: asCorrelationId("cor_w090b_prntj_3") };
  const appendRouted = store.appendJob(scope, routed.job);
  if (!appendRouted.ok) throw new Error(appendRouted.error.message);
  const appendQueued = store.appendJob(scope, enqueued.job);
  if (!appendQueued.ok) throw new Error(appendQueued.error.message);
  const completedRevision = {
    ...enqueued.job,
    version: enqueued.job.version + 1,
    status: "COMPLETED" as const,
    transitionedAt: AT3,
    contentDigest: `printdigest_completed_${enqueued.job.jobId}`,
  };
  const appendCompleted = store.appendJob(scope, completedRevision);
  if (!appendCompleted.ok) throw new Error(appendCompleted.error.message);
  const latest = store.getLatestJob(scope, enqueued.job.jobId);
  if (latest === undefined || latest.status !== "COMPLETED") throw new Error("latest is not COMPLETED");

  // 5. The TERMINAL STATE: the COMPLETED job with the Succeeded
  //    semantics + the verification evidence visible.
  const completedView = buildPrintRoutingView(scopeA(), latest, printers);
  if (!completedView.ok) throw new Error(completedView.error.message);
  const completedJourney: PrintJourneyData = {
    job: completedView.view,
    queue: null,
    verification: {
      verifiedAt: AT3,
      summary: "document printed and collected",
    },
  };
  render(<PrintScreen phase={{ kind: "ready", view: completedJourney }} />);
  expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
  expect(screen.getAllByText("COMPLETED").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/document printed and collected/i).length).toBeGreaterThan(0);
  // The evidence + content digest are visible.
  expect(screen.getAllByText(/content digest/i).length).toBeGreaterThan(0);
  const timeline = screen.getByRole("list", { name: "Print orchestration journey" });
  expect(within(timeline).getByText("Verification")).toBeDefined();
  expect(within(timeline).getAllByText(/Done/i).length).toBeGreaterThan(0);
});

test("journey: a refused print job renders the routing refusal visibly and actionably", () => {
  const printers = [
    {
      printerId: "prn_w090b_mono",
      tenantId: TENANT_A,
      capabilities: { duplex: true },
      preferences: {},
      approved: true,
      location: "annex",
    },
  ];

  // 1. The REAL router refuses: no printer supports the staple feature
  //    (a tagged `routing_refused` error — never an emulation).
  const refused = routePrintJob({
    payload: { documentRef: "doc://w090b-journey-stapled" },
    requiredFeatures: { staple: true },
    tenantId: TENANT_A,
    printers,
    at: AT,
    correlationId: asCorrelationId("cor_w090b_prntj_4"),
  });
  if (refused.ok) throw new Error("expected the router to refuse the staple requirement");

  // 2. The binding site records the REFUSED job (the observable
  //    outcome of the refusal) with the router's machine-stable
  //    reason — the same record shape the router audits.
  const refusedJob = {
    jobId: `prn_refused_w090b_stapled`,
    tenantId: TENANT_A,
    version: 1,
    payload: { documentRef: "doc://w090b-journey-stapled" },
    requiredFeatures: { staple: true },
    status: "REFUSED" as const,
    createdAt: AT,
    evidence: [],
    correlationId: asCorrelationId("cor_w090b_prntj_4"),
    routingReasons: ["unsupported_feature:staple"],
    contentDigest: "printdigest_refused_staple",
  };

  const view = buildPrintRoutingView(scopeA(), refusedJob, printers);
  if (!view.ok) throw new Error(view.error.message);
  const journey: PrintJourneyData = { job: view.view, queue: null, verification: null };
  render(<PrintScreen phase={{ kind: "ready", view: journey }} />);
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("Routing refused")).toBeDefined();
  // The machine-stable refusal reason is visible verbatim.
  expect(within(alert).getAllByText("unsupported_feature:staple").length).toBeGreaterThan(0);
  // The Failed semantics + the verbatim status.
  expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  expect(screen.getAllByText("REFUSED").length).toBeGreaterThan(0);
  // No printer is suggested as a fallback; the capability gap stays visible.
  expect(screen.getAllByText("Does not satisfy").length).toBeGreaterThan(0);
});
