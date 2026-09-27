/**
 * W050C aurum adapter — pure intent-builder tests (D1).
 *
 * Covers every builder's happy path, every machine-stable validation
 * refusal, the priority derivation tables, the derived content
 * templates, and the redaction model (application + soundness).
 */

import { test, expect } from "bun:test";
import {
  COMMUNICATION_KINDS,
  INCIDENT_PRIORITY_BY_SEVERITY,
  RECOVERY_PRIORITY_BY_STATUS,
  REDACTED_VALUE,
  applyRedaction,
  buildApprovalRequest,
  buildIncidentWarning,
  buildMaintenanceNotice,
  buildManagerBriefing,
  buildProcurementUpdate,
  buildRecoveryMessage,
  contentFieldKeys,
  type MaintenanceNoticeSource,
  type ManagerBriefingSource,
  type RecoveryCaseSource,
} from "../src/index";
import { CORR, DEV_A1, T0, T1, T2, T3, TENANT_A, asCausation, failuresOf, principalRecipient, roleRecipient } from "./helpers";

const base = { recipient: roleRecipient(), at: T1, correlationId: CORR };

function workOrderSource(overrides: Partial<MaintenanceNoticeSource> = {}): MaintenanceNoticeSource {
  return {
    workOrderId: "swo_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    revision: 1,
    serviceArea: "us-east-1",
    deadline: T2,
    serviceCategory: "service.battery",
    ...overrides,
  };
}

test("buildMaintenanceNotice derives fields, identity, and normal priority", () => {
  const result = buildMaintenanceNotice({
    ...base,
    workOrder: workOrderSource(),
    event: "created",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const intent = result.intent;
  expect(intent.kind).toBe(COMMUNICATION_KINDS.maintenanceNotice);
  expect(intent.tenantId).toBe(TENANT_A);
  expect(intent.subjectRef).toBe("swo_test00000001");
  expect(intent.priority).toBe("normal");
  expect(intent.schemaVersion).toBe(1);
  expect(intent.contentDigest).toHaveLength(8);
  expect(intent.messageId).toMatch(/^aurum_msg_[0-9a-f]{8}$/);
  expect(contentFieldKeys(intent.content)).toEqual([
    "deadline",
    "device_id",
    "event",
    "revision",
    "service_area",
    "service_category",
    "subject_ref",
  ]);
  const deviceIdField = intent.content.fields.find((f) => f.key === "device_id");
  expect(deviceIdField?.value).toBe(DEV_A1 as string);
  expect(deviceIdField?.sensitivity).toBe("identity");
});

test("buildMaintenanceNotice derives urgent priority when the deadline is past", () => {
  const result = buildMaintenanceNotice({
    ...base,
    workOrder: workOrderSource({ deadline: T0 }),
    event: "revised",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.priority).toBe("urgent");
  expect(result.intent.content.title).toBe("Service work order revised");
});

test("buildMaintenanceNotice refuses invalid input with machine-stable failures", () => {
  const bad = buildMaintenanceNotice({
    ...base,
    workOrder: workOrderSource({ revision: 0, deadline: "not-a-date" }),
    // @ts-expect-error — the type is bypassed on purpose (runtime guard)
    event: "deleted",
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(bad.error.kind).toBe("ValidationError");
  expect(bad.error.code).toBe("aurum.intent.invalid_request");
  const paths = failuresOf(bad.error).map((f) => f.reason);
  expect(paths).toContain("positive_integer_required");
  expect(paths).toContain("not_iso");
  expect(paths).toContain("unknown_notice_event");
});

test("buildIncidentWarning derives priority from the severity table", () => {
  for (const [severity, priority] of Object.entries(INCIDENT_PRIORITY_BY_SEVERITY)) {
    const result = buildIncidentWarning({
      ...base,
      finding: {
        findingId: `sec_test${severity}`,
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        code: "security.device.disk_encryption.off",
        severity: severity as keyof typeof INCIDENT_PRIORITY_BY_SEVERITY,
        classification: "compliance",
        detectedAt: T0,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.intent.priority).toBe(priority);
    expect(result.intent.kind).toBe(COMMUNICATION_KINDS.incidentWarning);
  }
});

test("buildIncidentWarning refuses an unknown severity", () => {
  const bad = buildIncidentWarning({
    ...base,
    finding: {
      findingId: "sec_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      code: "security.device.x",
      // @ts-expect-error — runtime guard
      severity: "EXTREME",
      classification: "compliance",
      detectedAt: T0,
    },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("unknown_severity");
});

test("buildApprovalRequest refuses a plan that is not PARKED", () => {
  const bad = buildApprovalRequest({
    ...base,
    surface: "action_plan",
    plan: {
      planId: "pln_test",
      tenantId: TENANT_A,
      name: "test plan",
      capability: "lock",
      status: "PROPOSAL",
      targetCount: 1,
      version: 1,
    },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("decision_not_parked");
});

test("buildApprovalRequest refuses a destructive request that is not PARKED", () => {
  const bad = buildApprovalRequest({
    ...base,
    surface: "destructive_request",
    request: {
      requestId: "dr_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      caseId: "rc_test",
      intentPayload: { action: "wipe" },
      status: "EXECUTED",
      version: 3,
      requestedAt: T0,
    },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("decision_not_parked");
});

test("buildApprovalRequest refuses a Guardian decision that is not REQUIRE_APPROVAL", () => {
  const bad = buildApprovalRequest({
    ...base,
    surface: "guardian_decision",
    decision: {
      tenantId: TENANT_A,
      decision: "ALLOW",
      rules: [],
      decidedAt: T0,
    },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("decision_not_parked");
});

test("buildApprovalRequest derives the guardian decision ref deterministically", () => {
  const decision = {
    tenantId: TENANT_A,
    decision: "REQUIRE_APPROVAL",
    rules: [{ ruleId: "pol_rule000002", ruleVersion: 1 }],
    decidedAt: T0,
  };
  const first = buildApprovalRequest({ ...base, surface: "guardian_decision", decision });
  const second = buildApprovalRequest({ ...base, surface: "guardian_decision", decision });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) throw new Error("expected success");
  expect(first.intent.subjectRef).toBe(second.intent.subjectRef);
  expect(first.intent.subjectRef).toMatch(/^gdec_[0-9a-f]{8}$/);
  expect(first.intent.priority).toBe("high");
  const rules = first.intent.content.fields.find((f) => f.key === "matched_rule_ids");
  expect(rules?.value).toBe("pol_rule000002");
});

test("buildRecoveryMessage derives priority from the status table and version from the record", () => {
  for (const [status, priority] of Object.entries(RECOVERY_PRIORITY_BY_STATUS)) {
    const version = status === "OPENED" ? 1 : 2;
    const source: RecoveryCaseSource = {
      caseId: "rc_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      version,
      status,
      trigger: { kind: "lost_report" },
      openedAt: T0,
      ...(version > 1 ? { transitionedAt: T1 } : {}),
      ...(status === "CLOSED" ? { closureReason: "device_replaced" } : {}),
    };
    const result = buildRecoveryMessage({ ...base, caseRecord: source });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.intent.priority).toBe(priority);
  }
});

test("buildRecoveryMessage refuses unknown status, version mismatch, and missing closure", () => {
  const unknown = buildRecoveryMessage({
    ...base,
    caseRecord: {
      caseId: "rc_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      version: 1,
      status: "TELEPORTED",
      trigger: { kind: "lost_report" },
      openedAt: T0,
    },
  });
  expect(unknown.ok).toBe(false);
  if (unknown.ok) throw new Error("expected refusal");
  expect(failuresOf(unknown.error).map((f) => f.reason)).toContain("unknown_case_status");

  const v1NotOpened = buildRecoveryMessage({
    ...base,
    caseRecord: {
      caseId: "rc_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      version: 1,
      status: "SECURING",
      trigger: { kind: "lost_report" },
      openedAt: T0,
      transitionedAt: T1,
    },
  });
  expect(v1NotOpened.ok).toBe(false);
  if (v1NotOpened.ok) throw new Error("expected refusal");
  expect(failuresOf(v1NotOpened.error).map((f) => f.reason)).toContain("case_version_status_mismatch");

  const noTransition = buildRecoveryMessage({
    ...base,
    caseRecord: {
      caseId: "rc_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      version: 2,
      status: "SECURING",
      trigger: { kind: "lost_report" },
      openedAt: T0,
    },
  });
  expect(noTransition.ok).toBe(false);
  if (noTransition.ok) throw new Error("expected refusal");
  expect(failuresOf(noTransition.error).map((f) => f.reason)).toContain("transition_instant_required");

  const noClosure = buildRecoveryMessage({
    ...base,
    caseRecord: {
      caseId: "rc_test",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      version: 3,
      status: "CLOSED",
      trigger: { kind: "lost_report" },
      openedAt: T0,
      transitionedAt: T1,
    },
  });
  expect(noClosure.ok).toBe(false);
  if (noClosure.ok) throw new Error("expected refusal");
  expect(failuresOf(noClosure.error).map((f) => f.reason)).toContain("closure_reason_required");
});

test("buildProcurementUpdate refuses event/status mismatches", () => {
  const quote = {
    quoteId: "qt_test0001",
    tenantId: TENANT_A,
    demandId: "dmd_test0001",
    vendorId: "vnd_testvendor0001",
    quoteVersion: 1,
    unitPriceUsd: 2500,
    totalPriceUsd: 7500,
    leadTimeDays: 14,
    warrantyDays: 730,
    slaCoverage: 0.95,
    status: "ISSUED",
    issuedAt: T1,
  };
  const mismatch = buildProcurementUpdate({ ...base, surface: "quote", event: "accepted", quote });
  expect(mismatch.ok).toBe(false);
  if (mismatch.ok) throw new Error("expected refusal");
  expect(failuresOf(mismatch.error).map((f) => f.reason)).toContain("event_status_mismatch");

  const ok = buildProcurementUpdate({ ...base, surface: "quote", event: "issued", quote });
  expect(ok.ok).toBe(true);
  if (!ok.ok) throw new Error(ok.error.message);
  expect(ok.intent.priority).toBe("normal");

  const accepted = buildProcurementUpdate({
    ...base,
    surface: "quote",
    event: "accepted",
    quote: { ...quote, status: "ACCEPTED" },
  });
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(accepted.error.message);
  expect(accepted.intent.priority).toBe("high");
});

test("buildProcurementUpdate derives urgent priority for an overdue demand", () => {
  const result = buildProcurementUpdate({
    ...base,
    surface: "demand",
    event: "created",
    demand: {
      demandId: "dmd_test0001",
      tenantId: TENANT_A,
      workloadId: "wl_testworkload01",
      description: "Fleet refresh",
      quantity: 3,
      deadline: T0,
      deliveryArea: "us-east-1",
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.priority).toBe("urgent");
});

test("buildManagerBriefing classifies deadlines and derives priority", () => {
  const briefing: ManagerBriefingSource = {
    tenantId: TENANT_A,
    windowStart: T1,
    windowEnd: T2,
    openRecoveryCaseIds: ["rc_b", "rc_a", "rc_a"],
    criticalSecurityFindingIds: [],
    parkedDecisionRefs: ["pln_1"],
    deadlineRefs: [
      { ref: "swo_overdue", deadline: T0, source: "maintenance" },
      { ref: "swo_due", deadline: T1, source: "maintenance" },
      { ref: "dmd_later", deadline: T3, source: "procurement" },
    ],
  };
  const result = buildManagerBriefing({ ...base, briefing });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("open_recovery_cases")).toBe("2"); // deduplicated
  expect(fields.get("deadlines_overdue")).toBe("1");
  expect(fields.get("deadlines_due")).toBe("1");
  expect(fields.get("deadlines_later")).toBe("1");
  expect(fields.get("overdue_refs")).toBe("swo_overdue");
  expect(fields.get("recovery_case_refs")).toBe("rc_a,rc_b"); // sorted
  expect(result.intent.priority).toBe("high"); // one overdue
  expect(result.intent.subjectRef).toMatch(/^brief_[0-9a-f]{8}$/);
});

test("buildManagerBriefing derives normal priority with nothing overdue or critical", () => {
  const result = buildManagerBriefing({
    ...base,
    briefing: {
      tenantId: TENANT_A,
      windowStart: T1,
      windowEnd: T2,
      openRecoveryCaseIds: ["rc_a"],
      criticalSecurityFindingIds: [],
      parkedDecisionRefs: [],
      deadlineRefs: [],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.priority).toBe("normal");
});

test("buildManagerBriefing refuses an inverted window", () => {
  const bad = buildManagerBriefing({
    ...base,
    briefing: {
      tenantId: TENANT_A,
      windowStart: T2,
      windowEnd: T1,
      openRecoveryCaseIds: [],
      criticalSecurityFindingIds: [],
      parkedDecisionRefs: [],
      deadlineRefs: [],
    },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("window_inverted");
});

test("redaction replaces reference/identity values with the stable marker, machine fields stay", () => {
  const result = buildMaintenanceNotice({
    ...base,
    workOrder: workOrderSource(),
    event: "created",
    redaction: {
      rules: [
        { kind: "sensitivity", sensitivity: "identity" },
        { kind: "field", fieldKey: "service_area" },
      ],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("device_id")).toBe(REDACTED_VALUE);
  expect(fields.get("service_area")).toBe(REDACTED_VALUE);
  expect(fields.get("deadline")).toBe(T2);
  expect(fields.get("service_category")).toBe("service.battery");
  expect(result.intent.redactedFieldKeys).toEqual(["device_id", "service_area"]);
  // The digest binds the POST-redaction content.
  const unredacted = buildMaintenanceNotice({ ...base, workOrder: workOrderSource(), event: "created" });
  if (!unredacted.ok) throw new Error(unredacted.error.message);
  expect(result.intent.contentDigest).not.toBe(unredacted.intent.contentDigest);
});

test("redaction is sound: title/summary never change under any redaction policy", () => {
  const policies = [
    { rules: [{ kind: "sensitivity" as const, sensitivity: "reference" as const }] },
    { rules: [{ kind: "sensitivity" as const, sensitivity: "identity" as const }] },
    {
      rules: [
        { kind: "sensitivity" as const, sensitivity: "reference" as const },
        { kind: "sensitivity" as const, sensitivity: "identity" as const },
      ],
    },
  ];
  const plain = buildMaintenanceNotice({ ...base, workOrder: workOrderSource(), event: "created" });
  if (!plain.ok) throw new Error(plain.error.message);
  for (const redaction of policies) {
    const redacted = buildMaintenanceNotice({
      ...base,
      workOrder: workOrderSource(),
      event: "created",
      redaction,
    });
    if (!redacted.ok) throw new Error(redacted.error.message);
    expect(redacted.intent.content.title).toBe(plain.intent.content.title);
    expect(redacted.intent.content.summary).toBe(plain.intent.content.summary);
  }
});

test("a redaction rule targeting a machine field is refused", () => {
  const bad = buildMaintenanceNotice({
    ...base,
    workOrder: workOrderSource(),
    event: "created",
    redaction: { rules: [{ kind: "field", fieldKey: "deadline" }] },
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("rule_targets_machine_field");
});

test("applyRedaction is rule-order independent and idempotent", () => {
  const build = (rules: { kind: "field"; fieldKey: string }[]) =>
    buildMaintenanceNotice({
      ...base,
      workOrder: workOrderSource(),
      event: "created",
      redaction: { rules },
    });
  const a = build([{ kind: "field", fieldKey: "subject_ref" }, { kind: "field", fieldKey: "service_area" }]);
  const b = build([{ kind: "field", fieldKey: "service_area" }, { kind: "field", fieldKey: "subject_ref" }]);
  if (!a.ok || !b.ok) throw new Error("expected success");
  expect(a.intent.content.fields).toEqual(b.intent.content.fields);
  expect(a.intent.redactedFieldKeys).toEqual(b.intent.redactedFieldKeys);
  expect(a.intent.contentDigest).toBe(b.intent.contentDigest);
});

test("every builder threads the injected correlation/causation/recipient verbatim", () => {
  const result = buildMaintenanceNotice({
    recipient: principalRecipient("usr_testuser00001"),
    at: T1,
    correlationId: CORR,
    causationId: asCausation(CORR as string),
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.correlationId).toBe(CORR);
  expect(result.intent.causationId).toBe(asCausation(CORR as string));
  expect(result.intent.recipient).toEqual({ kind: "principal", principalId: "usr_testuser00001" });
  expect(result.intent.emittedAt).toBe(T1);
});

test("a malformed recipient is refused with machine-stable reasons", () => {
  const bad = buildMaintenanceNotice({
    ...base,
    // @ts-expect-error — the type is bypassed on purpose (runtime guard)
    recipient: { kind: "carrier_pigeon", address: "the moon" },
    workOrder: workOrderSource(),
    event: "created",
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(failuresOf(bad.error).map((f) => f.reason)).toContain("unknown_recipient_kind");
});

test("applyRedaction over derived content dedupes and sorts redacted keys", () => {
  const content = {
    title: "t",
    summary: "s",
    fields: [
      { key: "b", value: "x", sensitivity: "reference" as const },
      { key: "a", value: "y", sensitivity: "identity" as const },
      { key: "c", value: "z", sensitivity: "machine" as const },
    ],
  };
  const result = applyRedaction(content, {
    rules: [
      { kind: "sensitivity", sensitivity: "reference" },
      { kind: "sensitivity", sensitivity: "identity" },
    ],
  });
  expect([...result.redactedFieldKeys]).toEqual(["a", "b"]);
  expect(result.content.fields[0]?.value).toBe(REDACTED_VALUE);
  expect(result.content.fields[2]?.value).toBe("z");
});
