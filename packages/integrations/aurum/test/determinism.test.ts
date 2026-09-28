/**
 * W050C aurum adapter — byte-identical determinism tests (D5).
 *
 * The full pipeline (build → redact → emit → transport → ingest) run
 * twice from fresh instances must produce byte-identical ledgers,
 * audit records and transport logs; input PERMUTATIONS (array orders,
 * rule orders, object key insertion orders) must never change the
 * output.
 */

import { test, expect } from "bun:test";
import {
  buildApprovalRequest,
  buildIncidentWarning,
  buildMaintenanceNotice,
  buildManagerBriefing,
  buildProcurementUpdate,
  buildRecoveryMessage,
  createInMemoryAurumAuditSink,
  createInMemoryDeliveryLedger,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
  ingestDeliveryMetadata,
  type DeliveryIngestInput,
  type MaintenanceNoticeSource,
  type ManagerBriefingSource,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  T0,
  T1,
  T2,
  TENANT_A,
  ctxA,
  roleRecipient,
} from "./helpers";

function workOrderSource(): MaintenanceNoticeSource {
  return {
    workOrderId: "swo_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    revision: 1,
    serviceArea: "us-east-1",
    deadline: T2,
    serviceCategory: "service.battery",
  };
}

/** A full pipeline run: every kind emitted + deliveries ingested. */
function fullPipelineRun(briefing: ManagerBriefingSource) {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const sink = createInMemoryAurumAuditSink();
  const deliveries = createInMemoryDeliveryLedger();

  const notice = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
    redaction: { rules: [{ kind: "sensitivity", sensitivity: "identity" }] },
  });
  if (!notice.ok) throw new Error(notice.error.message);
  const emittedNotice = emitCommunicationMessage(ctxA(), outbox, notice.intent, {
    transport,
    auditSink: sink,
  });
  if (!emittedNotice.ok) throw new Error(emittedNotice.error.message);

  const warning = buildIncidentWarning({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    finding: {
      findingId: "sec_test00000001",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      code: "security.device.disk_encryption.off",
      severity: "CRITICAL",
      classification: "compliance",
      detectedAt: T0,
    },
  });
  if (!warning.ok) throw new Error(warning.error.message);
  const emittedWarning = emitCommunicationMessage(ctxA(), outbox, warning.intent, {
    transport,
    auditSink: sink,
  });
  if (!emittedWarning.ok) throw new Error(emittedWarning.error.message);

  const briefingBuild = buildManagerBriefing({
    recipient: roleRecipient("manager"),
    at: T1,
    correlationId: CORR,
    briefing,
  });
  if (!briefingBuild.ok) throw new Error(briefingBuild.error.message);
  const emittedBriefing = emitCommunicationMessage(ctxA(), outbox, briefingBuild.intent, {
    transport,
    auditSink: sink,
  });
  if (!emittedBriefing.ok) throw new Error(emittedBriefing.error.message);

  const deliveryInputs: DeliveryIngestInput[] = [
    {
      messageRef: emittedNotice.entry.intent.messageId,
      deliveryAttempt: 1,
      state: "sent",
      recipient: { recipientRef: "fleet_manager", channel: "email" },
      disposition: "in_progress",
      ingestedAt: T2,
      correlationId: CORR,
    },
    {
      messageRef: emittedWarning.entry.intent.messageId,
      deliveryAttempt: 1,
      state: "delivered",
      recipient: { recipientRef: "fleet_manager", channel: "push" },
      disposition: "succeeded",
      ingestedAt: T2,
      correlationId: CORR,
    },
  ];
  for (const input of deliveryInputs) {
    const ingested = ingestDeliveryMetadata(ctxA(), outbox, deliveries, input, {
      auditSink: sink,
    });
    if (!ingested.ok) throw new Error(ingested.error.message);
  }

  return {
    outbox: JSON.stringify(outbox.list(ctxA())),
    transport: JSON.stringify(transport.emissions),
    acceptances: JSON.stringify(transport.acceptances),
    audit: JSON.stringify(sink.records),
    deliveries: JSON.stringify(deliveries.list(ctxA())),
  };
}

test("the full pipeline is byte-identical across runs", () => {
  const briefing: ManagerBriefingSource = {
    tenantId: TENANT_A,
    windowStart: T0,
    windowEnd: T1,
    openRecoveryCaseIds: ["rc_a", "rc_b"],
    criticalSecurityFindingIds: ["sec_1"],
    parkedDecisionRefs: ["pln_1", "pln_2"],
    deadlineRefs: [
      { ref: "swo_1", deadline: T0, source: "maintenance" },
      { ref: "dmd_1", deadline: T2, source: "procurement" },
    ],
  };
  const first = fullPipelineRun(briefing);
  const second = fullPipelineRun(briefing);
  expect(first.outbox).toBe(second.outbox);
  expect(first.transport).toBe(second.transport);
  expect(first.acceptances).toBe(second.acceptances);
  expect(first.audit).toBe(second.audit);
  expect(first.deliveries).toBe(second.deliveries);
});

test("briefing id arrays are permutation-invariant (order never matters)", () => {
  const sorted = {
    tenantId: TENANT_A,
    windowStart: T0,
    windowEnd: T1,
    openRecoveryCaseIds: ["rc_a", "rc_b", "rc_c"],
    criticalSecurityFindingIds: ["sec_1", "sec_2"],
    parkedDecisionRefs: ["pln_1", "pln_2"],
    deadlineRefs: [
      { ref: "swo_1", deadline: T0, source: "maintenance" as const },
      { ref: "dmd_1", deadline: T2, source: "procurement" as const },
    ],
  };
  const permuted = {
    ...sorted,
    openRecoveryCaseIds: ["rc_c", "rc_a", "rc_b"],
    criticalSecurityFindingIds: ["sec_2", "sec_1"],
    parkedDecisionRefs: ["pln_2", "pln_1"],
    deadlineRefs: [
      { ref: "dmd_1", deadline: T2, source: "procurement" as const },
      { ref: "swo_1", deadline: T0, source: "maintenance" as const },
    ],
  };
  const a = buildManagerBriefing({ recipient: roleRecipient(), at: T1, correlationId: CORR, briefing: sorted });
  const b = buildManagerBriefing({ recipient: roleRecipient(), at: T1, correlationId: CORR, briefing: permuted });
  if (!a.ok) throw new Error(a.error.message);
  if (!b.ok) throw new Error(b.error.message);
  expect(JSON.stringify(a.intent)).toBe(JSON.stringify(b.intent));
});

test("duplicate briefing id entries collapse deterministically", () => {
  const withDupes = {
    tenantId: TENANT_A,
    windowStart: T0,
    windowEnd: T1,
    openRecoveryCaseIds: ["rc_a", "rc_a", "rc_b"],
    criticalSecurityFindingIds: ["sec_1", "sec_1"],
    parkedDecisionRefs: ["pln_1"],
    deadlineRefs: [
      { ref: "swo_1", deadline: T0, source: "maintenance" as const },
      { ref: "swo_1", deadline: T0, source: "maintenance" as const },
    ],
  };
  const withoutDupes = {
    tenantId: TENANT_A,
    windowStart: T0,
    windowEnd: T1,
    openRecoveryCaseIds: ["rc_a", "rc_b"],
    criticalSecurityFindingIds: ["sec_1"],
    parkedDecisionRefs: ["pln_1"],
    deadlineRefs: [{ ref: "swo_1", deadline: T0, source: "maintenance" as const }],
  };
  const a = buildManagerBriefing({ recipient: roleRecipient(), at: T1, correlationId: CORR, briefing: withDupes });
  const b = buildManagerBriefing({ recipient: roleRecipient(), at: T1, correlationId: CORR, briefing: withoutDupes });
  if (!a.ok) throw new Error(a.error.message);
  if (!b.ok) throw new Error(b.error.message);
  expect(JSON.stringify(a.intent)).toBe(JSON.stringify(b.intent));
});

test("input object key insertion order never matters (canonical digests)", () => {
  const keysFirst = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  // Same values, different key insertion order on the source object.
  const reorderedSource: MaintenanceNoticeSource = {
    serviceCategory: "service.battery",
    deadline: T2,
    serviceArea: "us-east-1",
    revision: 1,
    deviceId: DEV_A1,
    tenantId: TENANT_A,
    workOrderId: "swo_test00000001",
  };
  const keysLast = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: reorderedSource,
    event: "created",
  });
  if (!keysFirst.ok || !keysLast.ok) throw new Error("expected success");
  expect(keysFirst.intent.messageId).toBe(keysLast.intent.messageId);
  expect(keysFirst.intent.contentDigest).toBe(keysLast.intent.contentDigest);
  expect(JSON.stringify(keysFirst.intent.content)).toBe(JSON.stringify(keysLast.intent.content));
});

test("redaction rule order never matters", () => {
  const build = (rules: { kind: "field"; fieldKey: string }[]) =>
    buildMaintenanceNotice({
      recipient: roleRecipient(),
      at: T1,
      correlationId: CORR,
      workOrder: workOrderSource(),
      event: "created",
      redaction: { rules },
    });
  const a = build([
    { kind: "field", fieldKey: "subject_ref" },
    { kind: "field", fieldKey: "service_area" },
  ]);
  const b = build([
    { kind: "field", fieldKey: "service_area" },
    { kind: "field", fieldKey: "subject_ref" },
  ]);
  if (!a.ok || !b.ok) throw new Error("expected success");
  expect(JSON.stringify(a.intent)).toBe(JSON.stringify(b.intent));
});

test("matched guardian rule order never matters (sorted on derivation)", () => {
  const decision = {
    tenantId: TENANT_A,
    decision: "REQUIRE_APPROVAL",
    rules: [
      { ruleId: "pol_rule000002", ruleVersion: 1 },
      { ruleId: "pol_rule000001", ruleVersion: 1 },
    ],
    decidedAt: T0,
  };
  const permuted = {
    ...decision,
    rules: [...decision.rules].reverse(),
  };
  const a = buildApprovalRequest({ recipient: roleRecipient(), at: T1, correlationId: CORR, surface: "guardian_decision", decision });
  const b = buildApprovalRequest({ recipient: roleRecipient(), at: T1, correlationId: CORR, surface: "guardian_decision", decision: permuted });
  if (!a.ok) throw new Error(a.error.message);
  if (!b.ok) throw new Error(b.error.message);
  expect(JSON.stringify(a.intent.content)).toBe(JSON.stringify(b.intent.content));
  // The rule-ORDER is part of the identity digest (rules array), so the
  // subjectRefs differ — but the DERIVED CONTENT (sorted rule ids) is
  // identical: derivation is order-invariant even when identity is not.
  const fields = new Map(a.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("matched_rule_ids")).toBe("pol_rule000001,pol_rule000002");
});

test("all six kinds produce distinct message ids for the same emission tuple", () => {
  const base = { recipient: roleRecipient(), at: T1, correlationId: CORR };
  const results = [
    buildMaintenanceNotice({ ...base, workOrder: workOrderSource(), event: "created" }),
    buildIncidentWarning({
      ...base,
      finding: {
        findingId: "sec_test00000001",
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        code: "c",
        severity: "HIGH",
        classification: "configuration",
        detectedAt: T0,
      },
    }),
    buildApprovalRequest({
      ...base,
      surface: "action_plan",
      plan: {
        planId: "pln_test00000001",
        tenantId: TENANT_A,
        name: "p",
        capability: "lock",
        status: "PARKED",
        targetCount: 1,
        version: 1,
        transitionedAt: T1,
      },
    }),
    buildRecoveryMessage({
      ...base,
      caseRecord: {
        caseId: "rc_test00000001",
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        version: 1,
        status: "OPENED",
        trigger: { kind: "lost_report" },
        openedAt: T0,
      },
    }),
    buildProcurementUpdate({
      ...base,
      surface: "quote",
      event: "issued",
      quote: {
        quoteId: "qt_test00000001",
        tenantId: TENANT_A,
        demandId: "dmd_test0000001",
        vendorId: "vnd_testvendor0001",
        quoteVersion: 1,
        unitPriceUsd: 1,
        totalPriceUsd: 1,
        leadTimeDays: 1,
        warrantyDays: 1,
        slaCoverage: 1,
        status: "ISSUED",
        issuedAt: T1,
      },
    }),
    buildManagerBriefing({
      ...base,
      briefing: {
        tenantId: TENANT_A,
        windowStart: T0,
        windowEnd: T1,
        openRecoveryCaseIds: [],
        criticalSecurityFindingIds: [],
        parkedDecisionRefs: [],
        deadlineRefs: [],
      },
    }),
  ];
  const ids = results.map((r) => {
    if (!r.ok) throw new Error(r.error.message);
    return r.intent.messageId;
  });
  expect(new Set(ids).size).toBe(6);
});
