/**
 * W050C aurum adapter — binding-site tests (the W040-disclosed pattern).
 *
 * The REAL accepted domain records are injected through the structural
 * seams: TypeScript structural typing accepts them at the type level
 * (the assignability assertions below), and these tests are the runtime
 * proof that every record flows through and derives the right content.
 * The ownership gate permits these cross-lane imports ONLY in test/
 * (src/ consumes the seams, never the packages).
 */

import { test, expect } from "bun:test";
import {
  buildApprovalRequest,
  buildIncidentWarning,
  buildMaintenanceNotice,
  buildProcurementUpdate,
  buildRecoveryMessage,
  buildManagerBriefing,
  type DestructiveApprovalSource,
  type GuardianApprovalSource,
  type IncidentWarningSource,
  type MaintenanceNoticeSource,
  type QuoteUpdateSource,
  type RecoveryCaseSource,
  type DemandUpdateSource,
  type ActionPlanApprovalSource,
} from "../src/index";
import {
  CORR,
  T0,
  T1,
  TENANT_A,
  roleRecipient,
  realWorkOrder,
  realSecurityFindings,
  realParkedActionPlan,
  realParkedDestructiveRequest,
  realRecoveryCase,
  realTransitionedRecoveryCase,
  realDemand,
  realIssuedQuote,
  ruleSet,
  approvalRule,
} from "./helpers";
import { evaluateGuardianRequest } from "@fleetos/policy";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import type { SecurityFinding } from "@fleetos/security";
import type { ActionPlanTemplate } from "@fleetos/actions";
import type { RecoveryCaseRecord } from "@fleetos/recovery";
import type { ProcurementDemand, Quote } from "@fleetos/procurement";

const base = { recipient: roleRecipient(), at: T1, correlationId: CORR };

// ---------------------------------------------------------------------------
// The type-level proofs: the REAL records are assignable to the seams
// ---------------------------------------------------------------------------

test("TYPE PROOF: the real W042 ServiceWorkOrder satisfies MaintenanceNoticeSource", () => {
  const workOrder: ServiceWorkOrder = realWorkOrder();
  const seam: MaintenanceNoticeSource = workOrder;
  expect(seam.workOrderId).toBe(workOrder.workOrderId);
});

test("TYPE PROOF: the real W031 SecurityFinding satisfies IncidentWarningSource", () => {
  const finding: SecurityFinding = realSecurityFindings()[0] as SecurityFinding;
  const seam: IncidentWarningSource = finding;
  expect(seam.findingId).toBe(finding.findingId);
});

test("TYPE PROOF: the real W041 parked ActionPlanTemplate satisfies ActionPlanApprovalSource", () => {
  const plan: ActionPlanTemplate = realParkedActionPlan();
  const seam: ActionPlanApprovalSource = plan;
  expect(seam.status).toBe("PARKED");
});

test("TYPE PROOF: the real W040 parked DestructiveRequestRecord satisfies DestructiveApprovalSource", () => {
  const { record } = realParkedDestructiveRequest();
  const seam: DestructiveApprovalSource = record;
  expect(seam.status).toBe("PARKED");
});

test("TYPE PROOF: the real RecoveryCaseRecord satisfies RecoveryCaseSource", () => {
  const record: RecoveryCaseRecord = realRecoveryCase();
  const seam: RecoveryCaseSource = record;
  expect(seam.caseId).toBe(record.caseId);
});

test("TYPE PROOF: the real W032 Quote satisfies QuoteUpdateSource", () => {
  const quote: Quote = realIssuedQuote();
  const seam: QuoteUpdateSource = quote;
  expect(seam.quoteId).toBe(quote.quoteId);
});

test("TYPE PROOF: the real W032 ProcurementDemand satisfies DemandUpdateSource", () => {
  const demand: ProcurementDemand = realDemand();
  const seam: DemandUpdateSource = demand;
  expect(seam.demandId).toBe(demand.demandId);
});

// ---------------------------------------------------------------------------
// The runtime proofs: the real records flow through the seams
// ---------------------------------------------------------------------------

test("a REAL service work order derives a maintenance notice (created + revised)", () => {
  const workOrder = realWorkOrder();
  const created = buildMaintenanceNotice({ ...base, workOrder, event: "created" });
  if (!created.ok) throw new Error(created.error.message);
  expect(created.intent.subjectRef).toBe(workOrder.workOrderId);
  expect(created.intent.tenantId).toBe(workOrder.tenantId);
  const fields = new Map(created.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("device_id")).toBe(workOrder.deviceId as string);
  expect(fields.get("revision")).toBe("1");
  expect(fields.get("service_category")).toBe(workOrder.serviceCategory);
  expect(fields.get("deadline")).toBe(workOrder.deadline);

  const revised = buildMaintenanceNotice({
    ...base,
    workOrder: { ...workOrder, revision: 2 },
    event: "revised",
  });
  if (!revised.ok) throw new Error(revised.error.message);
  expect(revised.intent.content.title).toBe("Service work order revised");
});

test("a REAL security finding derives an incident warning with the right priority", () => {
  const findings = realSecurityFindings();
  expect(findings.length).toBeGreaterThanOrEqual(2);
  const critical = findings.find((f) => f.severity === "CRITICAL");
  const high = findings.find((f) => f.severity === "HIGH");
  if (critical === undefined || high === undefined) throw new Error("fixture findings missing");
  const criticalWarning = buildIncidentWarning({ ...base, finding: critical });
  if (!criticalWarning.ok) throw new Error(criticalWarning.error.message);
  expect(criticalWarning.intent.priority).toBe("urgent");
  expect(criticalWarning.intent.subjectRef).toBe(critical.findingId);
  const fields = new Map(criticalWarning.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("finding_code")).toBe("security.device.disk_encryption.off");
  expect(fields.get("classification")).toBe("compliance");

  const highWarning = buildIncidentWarning({ ...base, finding: high });
  if (!highWarning.ok) throw new Error(highWarning.error.message);
  expect(highWarning.intent.priority).toBe("high");
});

test("a REAL parked action plan derives an approval request (via the real Guardian)", () => {
  const plan = realParkedActionPlan();
  const result = buildApprovalRequest({ ...base, surface: "action_plan", plan });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.subjectRef).toBe(plan.planId);
  expect(result.intent.priority).toBe("high");
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("requested_action")).toBe("lock");
  expect(fields.get("target_count")).toBe(String(plan.targetCount));
  expect(fields.get("parked_at")).toBe(plan.transitionedAt);
});

test("a REAL parked destructive recovery request derives an URGENT approval request; the adapter seam was never invoked", () => {
  const { record, seam } = realParkedDestructiveRequest();
  const result = buildApprovalRequest({ ...base, surface: "destructive_request", request: record });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.priority).toBe("urgent");
  expect(result.intent.subjectRef).toBe(record.requestId);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("requested_action")).toBe("wipe");
  expect(fields.get("case_ref")).toBe(record.caseId);
  // The parked request never reached the W020 adapter (authority: the
  // human approval step owns the dispatch decision, not this adapter).
  expect(seam.calls()).toHaveLength(0);
});

test("a REAL REQUIRE_APPROVAL Guardian decision (the real engine) derives an approval request", () => {
  const rules = ruleSet(TENANT_A, [approvalRule(TENANT_A, "device.wipe")]);
  const evaluation = evaluateGuardianRequest(
    rules,
    {
      tenantId: TENANT_A,
      action: { action: "device.wipe", targetKind: "device" },
    },
    { at: T1, correlationId: CORR },
  );
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  const decision = evaluation.evaluation.decision;
  expect(decision.decision).toBe("REQUIRE_APPROVAL");
  const seam: GuardianApprovalSource = decision;
  const result = buildApprovalRequest({ ...base, surface: "guardian_decision", decision: seam });
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("matched_rule_ids")).toBe(
    decision.rules.map((r) => r.ruleId as string).sort().join(","),
  );
  expect(result.intent.priority).toBe("high");
});

test("REAL recovery case records derive recovery messages (opened + transitioned)", () => {
  const opened = realRecoveryCase();
  const openedMessage = buildRecoveryMessage({ ...base, caseRecord: opened });
  if (!openedMessage.ok) throw new Error(openedMessage.error.message);
  expect(openedMessage.intent.content.title).toBe("Recovery case opened");
  expect(openedMessage.intent.priority).toBe("normal");
  const fields = new Map(openedMessage.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("trigger_kind")).toBe("lost_report");

  const escalated = realTransitionedRecoveryCase("ESCALATED");
  const escalatedMessage = buildRecoveryMessage({ ...base, caseRecord: escalated });
  if (!escalatedMessage.ok) throw new Error(escalatedMessage.error.message);
  expect(escalatedMessage.intent.content.title).toBe("Recovery case update");
  expect(escalatedMessage.intent.priority).toBe("urgent");
  expect(escalatedMessage.intent.subjectRef).toBe(escalated.caseId);
});

test("a REAL closed recovery case carries the closure reason", () => {
  const closed = realTransitionedRecoveryCase("CLOSED");
  expect(closed.closureReason).toBe("device_recovered");
  const result = buildRecoveryMessage({ ...base, caseRecord: closed });
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("case_status")).toBe("CLOSED");
  expect(fields.get("closure_reason")).toBe("device_recovered");
  expect(result.intent.priority).toBe("low");
});

test("a REAL issued quote derives a procurement update", () => {
  const quote = realIssuedQuote();
  const result = buildProcurementUpdate({ ...base, surface: "quote", event: "issued", quote });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.subjectRef).toBe(quote.quoteId);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("demand_ref")).toBe(quote.demandId);
  expect(fields.get("vendor_id")).toBe(quote.vendorId as string);
  expect(fields.get("total_price_usd")).toBe(String(quote.totalPriceUsd));
  expect(fields.get("sla_coverage")).toBe(String(quote.slaCoverage));
  expect(result.intent.priority).toBe("normal");
});

test("a REAL demand derives a procurement update with the workload linkage", () => {
  const demand = realDemand();
  const result = buildProcurementUpdate({ ...base, surface: "demand", event: "created", demand });
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("workload_ref")).toBe(demand.workloadId as string);
  expect(fields.get("quantity")).toBe(String(demand.quantity));
  expect(fields.get("delivery_area")).toBe(demand.deliveryArea);
});

test("REAL domain refs compose into a manager briefing", () => {
  const workOrder = realWorkOrder();
  const finding = realSecurityFindings()[0] as SecurityFinding;
  const plan = realParkedActionPlan();
  const caseRecord = realRecoveryCase();
  const briefing = buildManagerBriefing({
    ...base,
    briefing: {
      tenantId: TENANT_A,
      windowStart: T0,
      windowEnd: T1,
      openRecoveryCaseIds: [caseRecord.caseId],
      criticalSecurityFindingIds: [finding.findingId],
      parkedDecisionRefs: [plan.planId],
      deadlineRefs: [{ ref: workOrder.workOrderId, deadline: workOrder.deadline, source: "maintenance" }],
    },
  });
  if (!briefing.ok) throw new Error(briefing.error.message);
  expect(briefing.intent.priority).toBe("high"); // critical findings present
  const fields = new Map(briefing.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("open_recovery_cases")).toBe("1");
  expect(fields.get("critical_security_findings")).toBe("1");
  expect(fields.get("parked_decisions")).toBe("1");
});
