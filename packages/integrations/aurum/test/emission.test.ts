/**
 * W050C aurum adapter — emission boundary tests (D1/D3/D4).
 *
 * The boundary: guard → outbox append (idempotent, tamper-guarded) →
 * transport (injected) → audit (injected). Duplicates skip transport
 * and audit; refusals audit `aurum.message.refused`.
 */

import { test, expect } from "bun:test";
import {
  AURUM_AUDIT_ACTIONS,
  buildMaintenanceNotice,
  createInMemoryAurumAuditSink,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
  summarizeOutbox,
  type CommunicationIntent,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  T0,
  T1,
  T2,
  TENANT_A,
  TENANT_B,
  ctxA,
  ctxB,
  invariantOf,
  roleRecipient,
} from "./helpers";
import type { RedactionPolicy } from "../src/index";
import type { MaintenanceNoticeSource } from "../src/index";

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

function builtIntent(overrides: { at?: string; redaction?: RedactionPolicy } = {}): CommunicationIntent {
  const result = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: overrides.at ?? T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
    ...(overrides.redaction ? { redaction: overrides.redaction } : {}),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.intent;
}

test("an emission appends, transports, and audits exactly once", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const sink = createInMemoryAurumAuditSink();
  const result = emitCommunicationMessage(ctxA(), outbox, builtIntent(), {
    transport,
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.duplicate).toBe(false);
  expect(result.entry.sequence).toBe(1);
  expect(result.entry.tenantId).toBe(TENANT_A);
  expect(result.acceptance?.accepted).toBe(true);
  expect(transport.emissions).toHaveLength(1);
  expect(transport.emissions[0]?.messageId).toBe(result.entry.intent.messageId);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0]?.action).toBe(AURUM_AUDIT_ACTIONS.messageEmitted);
  expect(sink.records[0]?.subject).toBe(result.entry.intent.messageId);
  expect(outbox.size(ctxA())).toBe(1);
  expect(summarizeOutbox(outbox.list(ctxA())).total).toBe(1);
});

test("re-emitting the same identity+content is an idempotent duplicate (no transport, no audit)", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const sink = createInMemoryAurumAuditSink();
  const intent = builtIntent();
  const first = emitCommunicationMessage(ctxA(), outbox, intent, { transport, auditSink: sink });
  if (!first.ok) throw new Error(first.error.message);
  const second = emitCommunicationMessage(ctxA(), outbox, intent, { transport, auditSink: sink });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.duplicate).toBe(true);
  expect(second.acceptance).toBeNull();
  expect(outbox.size(ctxA())).toBe(1);
  expect(transport.emissions).toHaveLength(1);
  expect(sink.records).toHaveLength(1);
});

test("a hand-forged id collision with different content is refused as tampering", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const sink = createInMemoryAurumAuditSink();
  const plain = builtIntent();
  const first = emitCommunicationMessage(ctxA(), outbox, plain, { transport, auditSink: sink });
  if (!first.ok) throw new Error(first.error.message);
  // Forge: the SAME messageId with DIFFERENT content. The builder derives
  // content-addressed ids (different content -> different id), so this can
  // only happen through a hand-crafted/forged intent — the outbox's
  // digest guard refuses it (defense in depth).
  const redacted = builtIntent({ redaction: { rules: [{ kind: "sensitivity", sensitivity: "reference" }] } });
  expect(redacted.messageId).not.toBe(plain.messageId);
  const forged = { ...redacted, messageId: plain.messageId };
  const second = emitCommunicationMessage(ctxA(), outbox, forged, { transport, auditSink: sink });
  expect(second.ok).toBe(false);
  if (second.ok) throw new Error("expected refusal");
  expect(invariantOf(second.error)).toBe("content_digest_mismatch");
  expect(outbox.size(ctxA())).toBe(1);
  expect(transport.emissions).toHaveLength(1);
  const actions = sink.records.map((r) => r.action);
  expect(actions).toContain(AURUM_AUDIT_ACTIONS.messageRefused);
  const refusal = sink.records.find((r) => r.action === AURUM_AUDIT_ACTIONS.messageRefused);
  expect(refusal?.details.reason).toBe("content_digest_mismatch");
});

test("two DIFFERENT messages about the same source at the same instant coexist (content-addressed ids)", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const revision1 = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  const revision2 = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: { ...workOrderSource(), revision: 2 },
    event: "revised",
  });
  if (!revision1.ok || !revision2.ok) throw new Error("expected success");
  const a = emitCommunicationMessage(ctxA(), outbox, revision1.intent, { transport });
  const b = emitCommunicationMessage(ctxA(), outbox, revision2.intent, { transport });
  if (!a.ok || !b.ok) throw new Error("expected success");
  expect(a.entry.sequence).toBe(1);
  expect(b.entry.sequence).toBe(2);
  expect(outbox.size(ctxA())).toBe(2);
});

test("a cross-tenant append is refused (tenant_mismatch) and audited", () => {
  const outbox = createInMemoryOutboxLedger();
  const sink = createInMemoryAurumAuditSink();
  const result = emitCommunicationMessage(ctxB(), outbox, builtIntent(), { auditSink: sink });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("tenant_mismatch");
  expect(outbox.size(ctxB())).toBe(0);
  expect(sink.records.map((r) => r.action)).toContain(AURUM_AUDIT_ACTIONS.messageRefused);
});

test("a context-free emission is rejected by the runtime guard with the types bypassed", () => {
  const outbox = createInMemoryOutboxLedger();
  const result = emitCommunicationMessage(
    // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
    undefined,
    outbox,
    builtIntent(),
    {},
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("acting_context_invalid");
});

test("redaction at emission audits redactionApplied before messageEmitted", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const sink = createInMemoryAurumAuditSink();
  const intent = builtIntent({
    redaction: { rules: [{ kind: "sensitivity", sensitivity: "reference" }] },
  });
  expect(intent.redactedFieldKeys.length).toBeGreaterThan(0);
  const result = emitCommunicationMessage(ctxA(), outbox, intent, { transport, auditSink: sink });
  if (!result.ok) throw new Error(result.error.message);
  expect(sink.records.map((r) => r.action)).toEqual([
    AURUM_AUDIT_ACTIONS.redactionApplied,
    AURUM_AUDIT_ACTIONS.messageEmitted,
  ]);
  expect(sink.records[0]?.details.redactedFieldKeys).toEqual(intent.redactedFieldKeys);
});

test("a transport refusal keeps the outbox entry and rides the audit", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport({ refusal: () => "provider_down" });
  const sink = createInMemoryAurumAuditSink();
  const result = emitCommunicationMessage(ctxA(), outbox, builtIntent(), { transport, auditSink: sink });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const refusal = result.acceptance;
  if (refusal === null || refusal.accepted) throw new Error("expected refusal");
  expect(refusal.reason).toBe("provider_down");
  expect(outbox.size(ctxA())).toBe(1);
  const emitted = sink.records.find((r) => r.action === AURUM_AUDIT_ACTIONS.messageEmitted);
  expect(emitted?.details.transportAccepted).toBe(false);
  expect(emitted?.details.transportRefusalReason).toBe("provider_down");
});

test("an unbound transport refuses deterministically (transport_not_bound)", () => {
  const outbox = createInMemoryOutboxLedger();
  const result = emitCommunicationMessage(ctxA(), outbox, builtIntent(), {});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const refusal = result.acceptance;
  if (refusal === null || refusal.accepted) throw new Error("expected refusal");
  expect(refusal.reason).toBe("transport_not_bound");
});

test("per-tenant outbox sequences are gapless and independent", () => {
  const outbox = createInMemoryOutboxLedger();
  const tenantBWorkOrder: MaintenanceNoticeSource = {
    ...workOrderSource(),
    tenantId: TENANT_B,
  };
  const tenantBIntent = buildMaintenanceNotice({
    recipient: roleRecipient(),
    at: T1,
    correlationId: CORR,
    workOrder: tenantBWorkOrder,
    event: "created",
  });
  if (!tenantBIntent.ok) throw new Error(tenantBIntent.error.message);
  const a1 = emitCommunicationMessage(ctxA(), outbox, builtIntent(), {});
  const a2 = emitCommunicationMessage(
    ctxA(),
    outbox,
    builtIntent({ at: T0 }),
    {},
  );
  const b1 = emitCommunicationMessage(ctxB(), outbox, tenantBIntent.intent, {});
  if (!a1.ok || !a2.ok || !b1.ok) throw new Error("expected success");
  expect(a1.entry.sequence).toBe(1);
  expect(a2.entry.sequence).toBe(2);
  expect(b1.entry.sequence).toBe(1);
  const sequencesA = outbox.list(ctxA()).map((e) => e.sequence);
  expect(sequencesA).toEqual([1, 2]);
  expect(outbox.size(ctxA())).toBe(2);
  expect(outbox.size(ctxB())).toBe(1);
});

test("the transport never sees unredacted content", () => {
  const outbox = createInMemoryOutboxLedger();
  const transport = createInMemoryTransport();
  const intent = builtIntent({
    redaction: { rules: [{ kind: "sensitivity", sensitivity: "identity" }] },
  });
  emitCommunicationMessage(ctxA(), outbox, intent, { transport });
  const emission = transport.emissions[0];
  if (emission === undefined) throw new Error("no emission recorded");
  const deviceField = emission.content.fields.find((f) => f.key === "device_id");
  expect(deviceField?.value).toBe("[redacted]");
});
