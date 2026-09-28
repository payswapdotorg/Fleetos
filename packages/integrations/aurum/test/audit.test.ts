/**
 * W050C aurum adapter — audit tests (D4).
 *
 * The audit seam is structurally satisfied by @fleetos/audit's sink
 * adapter (W012): the binding below is the type-level proof, and these
 * tests are the runtime proof — records flow into the REAL hash-chained
 * AuditLog, the chain verifies, per-tenant chains stay separate, and
 * every consequential aurum mutation (message emitted, redaction
 * applied, delivery ingested, refusal) lands in the trail.
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createAuditSinkAdapter } from "@fleetos/audit";
import {
  AURUM_AUDIT_ACTIONS,
  buildMaintenanceNotice,
  createInMemoryDeliveryLedger,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
  ingestDeliveryMetadata,
  type DeliveryIngestInput,
  type MaintenanceNoticeSource,
} from "../src/index";
import type { AurumAuditSink } from "../src/index";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T1,
  T2,
  ctxA,
  ctxB,
  realAuditLog,
  realAurumAuditSink,
  roleRecipient,
} from "./helpers";

function workOrderSource(tenantId = TENANT_A): MaintenanceNoticeSource {
  return {
    workOrderId: "swo_test00000001",
    tenantId,
    deviceId: DEV_A1,
    revision: 1,
    serviceArea: "us-east-1",
    deadline: T2,
    serviceCategory: "service.battery",
  };
}

test("TYPE PROOF: @fleetos/audit's sink adapter satisfies the AurumAuditSink seam", () => {
  const log = realAuditLog();
  const sink: AurumAuditSink = createAuditSinkAdapter(log, {
    source: "integration-aurum.test",
  });
  expect(typeof sink.append).toBe("function");
});

test("an emission lands in the REAL hash-chained AuditLog and the chain verifies", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
    redaction: { rules: [{ kind: "sensitivity", sensitivity: "identity" }] },
  });
  if (!built.ok) throw new Error(built.error.message);
  const result = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
    auditSink: sink,
  });
  if (!result.ok) throw new Error(result.error.message);
  const records = log.records(makeTenantContext(TENANT_A));
  expect(records.length).toBe(2); // redactionApplied + messageEmitted
  expect(records[0]?.action).toBe(AURUM_AUDIT_ACTIONS.redactionApplied);
  expect(records[1]?.action).toBe(AURUM_AUDIT_ACTIONS.messageEmitted);
  expect(records[1]?.details.transportAccepted).toBe(true);
  expect(records[1]?.details.sequence).toBe(1);
  const verification = log.verify(makeTenantContext(TENANT_A));
  if (!verification.ok) throw new Error(`chain verification failed: ${verification.kind}`);
  expect(verification.records).toBe(2);
});

test("a delivery ingestion lands in the REAL audit trail with the (ref, attempt) subject", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient("fleet_manager"),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const emitted = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
    auditSink: sink,
  });
  if (!emitted.ok) throw new Error(emitted.error.message);
  const input: DeliveryIngestInput = {
    messageRef: emitted.entry.intent.messageId,
    deliveryAttempt: 1,
    state: "delivered",
    recipient: { recipientRef: "fleet_manager", channel: "email" },
    disposition: "succeeded",
    ingestedAt: T2,
    correlationId: CORR,
  };
  const ingested = ingestDeliveryMetadata(ctxA(), outbox, createInMemoryDeliveryLedger(), input, {
    auditSink: sink,
  });
  if (!ingested.ok) throw new Error(ingested.error.message);
  const records = log.records(makeTenantContext(TENANT_A));
  expect(records.length).toBe(2);
  expect(records[1]?.action).toBe(AURUM_AUDIT_ACTIONS.deliveryIngested);
  expect(records[1]?.details.subject).toBe(`${input.messageRef}:1`);
  const verification = log.verify(makeTenantContext(TENANT_A));
  if (!verification.ok) throw new Error("chain verification failed");
  expect(verification.records).toBe(2);
});

test("a refusal lands in the REAL audit trail with the machine-stable reason", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  const ingested = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    createInMemoryDeliveryLedger(),
    {
      messageRef: "aurum_msg_00000000",
      deliveryAttempt: 1,
      state: "sent",
      recipient: { recipientRef: "fleet_manager", channel: "email" },
      disposition: "in_progress",
      ingestedAt: T2,
      correlationId: CORR,
    },
    { auditSink: sink },
  );
  expect(ingested.ok).toBe(false);
  const records = log.records(makeTenantContext(TENANT_A));
  expect(records.length).toBe(1);
  expect(records[0]?.action).toBe(AURUM_AUDIT_ACTIONS.deliveryRefused);
  expect(records[0]?.details.reason).toBe("unknown_message_ref");
  const verification = log.verify(makeTenantContext(TENANT_A));
  if (!verification.ok) throw new Error("chain verification failed");
});

test("per-tenant audit chains stay separate (tenant isolation in the trail)", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  for (const tenantId of [TENANT_A, TENANT_B]) {
    const built = buildMaintenanceNotice({
      recipient: roleRecipient(),
      at: T1,
      correlationId: CORR,
      workOrder: workOrderSource(tenantId),
      event: "created",
    });
    if (!built.ok) throw new Error(built.error.message);
    const result = emitCommunicationMessage(
      makeTenantContext(tenantId, CORR),
      outbox,
      built.intent,
      { transport: createInMemoryTransport(), auditSink: sink },
    );
    if (!result.ok) throw new Error(result.error.message);
  }
  const recordsA = log.records(makeTenantContext(TENANT_A));
  const recordsB = log.records(makeTenantContext(TENANT_B));
  expect(recordsA.length).toBe(1);
  expect(recordsB.length).toBe(1);
  expect(recordsA[0]?.tenantId).toBe(TENANT_A);
  expect(recordsB[0]?.tenantId).toBe(TENANT_B);
  expect(recordsA[0]?.id).not.toBe(recordsB[0]?.id);
  expect(log.verify(makeTenantContext(TENANT_A)).ok).toBe(true);
  expect(log.verify(makeTenantContext(TENANT_B)).ok).toBe(true);
});

test("an idempotent duplicate emission audits nothing (nothing mutated)", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const first = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
    auditSink: sink,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
    auditSink: sink,
  });
  if (!second.ok) throw new Error(second.error.message);
  expect(second.duplicate).toBe(true);
  expect(log.records(makeTenantContext(TENANT_A)).length).toBe(1);
});

test("the audit trail correlates via the frozen contracts correlation ids", () => {
  const log = realAuditLog();
  const sink = realAurumAuditSink(log);
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const result = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
    auditSink: sink,
  });
  if (!result.ok) throw new Error(result.error.message);
  const record = log.records(makeTenantContext(TENANT_A))[0];
  expect(record?.correlationId).toBe(CORR);
  expect(record?.source).toBe("integration-aurum.boundary");
  expect(record?.outcome.status).toBe("success");
});
