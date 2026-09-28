/**
 * W050C aurum adapter — contract-conformance tests (D5).
 *
 * Consumes the @fleetos/contracts/testing fixture builders (the frozen
 * test surface) and asserts the adapter's conformance to the frozen
 * contracts: branded-id threading, the GuardianDecision union (only
 * REQUIRE_APPROVAL is an approval surface), the nine intent kinds'
 * distinctness from the six communication kinds, envelope validation,
 * and the fixture determinism the adapter's own determinism builds on.
 */

import { test, expect } from "bun:test";
import {
  makeGuardianDecision,
  makeAllGuardianDecisions,
  makeIntent,
  makeAllIntents,
  makeEventEnvelope,
  makeTimestamp,
  makeTenantId,
  makeDeviceId,
  makeCorrelationId,
  makeCausationId,
  makeEventId,
  FIXTURE_TIME_ANCHOR,
  rng,
} from "@fleetos/contracts/testing";
import { ALL_INTENT_KINDS, REQUIRE_APPROVAL, asCausationId, validateEnvelope } from "@fleetos/contracts";
import {
  ALL_COMMUNICATION_KINDS,
  buildApprovalRequest,
  buildIncidentWarning,
  buildMaintenanceNotice,
  COMMUNICATION_KINDS,
  type GuardianApprovalSource,
  type IncidentWarningSource,
  type MaintenanceNoticeSource,
} from "../src/index";
import { CORR, DEV_A1, TENANT_A, T2, failuresOf, roleRecipient } from "./helpers";

const base = { recipient: roleRecipient(), correlationId: CORR };

test("fixture builders produce deterministic tenant/device/correlation ids", () => {
  expect(makeTenantId("aurum-seed") as string).toBe(makeTenantId("aurum-seed") as string);
  expect(makeTenantId("aurum-a") as string).not.toBe(makeTenantId("aurum-b") as string);
  expect(makeDeviceId("aurum-seed") as string).toMatch(/^dev_/);
  expect(makeCorrelationId("aurum-seed") as string).toMatch(/^cor_/);
  expect(makeCausationId("aurum-seed") as string).toMatch(/^cau_/);
  expect(makeEventId("aurum-seed") as string).toMatch(/^evt_/);
  expect(makeTimestamp("aurum-seed")).toBe(makeTimestamp("aurum-seed"));
  expect(makeTimestamp("aurum-seed")).toMatch(/^2026-/);
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
});

test("fixture-derived ids flow through the builders verbatim (branded-id threading)", () => {
  const tenantId = makeTenantId("aurum-conformance");
  const deviceId = makeDeviceId("aurum-conformance");
  const correlationId = makeCorrelationId("aurum-conformance");
  const workOrder: MaintenanceNoticeSource = {
    workOrderId: "swo_conformance1",
    tenantId,
    deviceId,
    revision: 1,
    serviceArea: "eu-west-1",
    deadline: makeTimestamp("aurum-deadline"),
    serviceCategory: "service.screen",
  };
  const result = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: makeTimestamp("aurum-at"),
    correlationId,
    workOrder,
    event: "created",
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.tenantId).toBe(tenantId);
  expect(result.intent.correlationId).toBe(correlationId);
  const deviceField = result.intent.content.fields.find((f) => f.key === "device_id");
  expect(deviceField?.value).toBe(deviceId as string);
});

test("makeAllGuardianDecisions: only REQUIRE_APPROVAL is an approval surface", () => {
  const decisions = makeAllGuardianDecisions("aurum-seed");
  expect(decisions).toHaveLength(4);
  for (const decision of decisions) {
    const seam: GuardianApprovalSource = decision;
    const result = buildApprovalRequest({
      ...base,
      at: makeTimestamp("aurum-at"),
      surface: "guardian_decision",
      decision: seam,
    });
    if (decision.decision === REQUIRE_APPROVAL) {
      if (!result.ok) throw new Error(result.error.message);
      expect(result.intent.kind).toBe(COMMUNICATION_KINDS.approvalRequest);
    } else {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected refusal");
      expect(failuresOf(result.error).map((f) => f.reason)).toContain("decision_not_parked");
    }
  }
});

test("makeGuardianDecision with REQUIRE_APPROVAL threads rules + decidedAt verbatim", () => {
  const decision = makeGuardianDecision({
    seed: "aurum-approval",
    decision: REQUIRE_APPROVAL,
  });
  const result = buildApprovalRequest({
    ...base,
    at: makeTimestamp("aurum-at"),
    surface: "guardian_decision",
    decision,
  });
  if (!result.ok) throw new Error(result.error.message);
  const fields = new Map(result.intent.content.fields.map((f) => [f.key, f.value]));
  expect(fields.get("decided_at")).toBe(decision.decidedAt);
  expect(fields.get("matched_rule_ids")).toBe(
    [...decision.rules].map((r) => r.ruleId as string).sort().join(","),
  );
});

test("the nine frozen intent kinds never collide with the six communication kinds", () => {
  expect(ALL_INTENT_KINDS).toHaveLength(9);
  expect(ALL_COMMUNICATION_KINDS).toHaveLength(6);
  for (const kind of ALL_INTENT_KINDS) {
    expect((ALL_COMMUNICATION_KINDS as readonly string[]).includes(kind)).toBe(false);
  }
  expect(new Set(ALL_COMMUNICATION_KINDS).size).toBe(6);
});

test("makeIntent fixtures: the frozen FleetIntent kinds are not aurum message kinds", () => {
  const intents = makeAllIntents("aurum-seed");
  expect(intents).toHaveLength(9);
  for (const intent of intents) {
    expect((ALL_COMMUNICATION_KINDS as readonly string[]).includes(intent.payload.kind)).toBe(false);
  }
  const single = makeIntent({ seed: "aurum-single", kind: "RecoveryIntent" });
  expect(single.payload.kind).toBe("RecoveryIntent");
});

test("makeEventEnvelope fixtures validate under the frozen validator", () => {
  const envelope = makeEventEnvelope({
    seed: "aurum-envelope",
    type: "aurum.message.emitted",
    payload: { hello: "world" },
  });
  const validation = validateEnvelope(envelope);
  expect(validation.ok).toBe(true);
  // The aurum builders thread correlation ids exactly like the frozen
  // envelope contract: verbatim, never rewritten.
  const withCorrelation = makeEventEnvelope({
    seed: "aurum-envelope",
    type: "aurum.message.emitted",
    cause: { kind: "command", commandId: makeCausationId("aurum-envelope"), correlationId: CORR },
  });
  expect(withCorrelation.correlationId).toBe(CORR);
  expect(withCorrelation.causationId).toBe(makeCausationId("aurum-envelope"));
});

test("the seeded rng is deterministic per seed (the fixture foundation)", () => {
  const a = rng("aurum-seed");
  const b = rng("aurum-seed");
  expect(a.next()).toBe(b.next());
  expect(a.base32(8)).toBe(b.base32(8));
});

test("fixture severity extremes derive the full priority range through the warning builder", () => {
  const cases: { severity: "CRITICAL" | "LOW"; priority: string }[] = [
    { severity: "CRITICAL", priority: "urgent" },
    { severity: "LOW", priority: "low" },
  ];
  for (const { severity, priority } of cases) {
    const finding: IncidentWarningSource = {
      findingId: `sec_conf_${severity}`,
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      code: "security.device.disk_encryption.off",
      severity,
      classification: "compliance",
      detectedAt: makeTimestamp("aurum-detected"),
    };
    const result = buildIncidentWarning({
      ...base,
      at: makeTimestamp("aurum-at"),
      finding,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.intent.priority).toBe(priority);
  }
});

test("causation ids from the frozen fixtures thread verbatim", () => {
  const causationId = asCausationId(makeCausationId("aurum-cause") as string);
  const result = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: makeTimestamp("aurum-at"),
    correlationId: CORR,
    causationId,
    workOrder: {
      workOrderId: "swo_conformance2",
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      revision: 1,
      serviceArea: "us-east-1",
      deadline: T2,
      serviceCategory: "service.battery",
    },
    event: "created",
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.intent.causationId).toBe(causationId);
});
