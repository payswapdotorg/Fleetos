/**
 * W050C aurum adapter — delivery/outcome metadata ingestion tests (D2).
 *
 * The metadata-only return path: idempotency by (message ref, delivery
 * attempt), unknown-ref refusals (never a guess), disposition/recipient
 * validation, the terminal-state absorption, and the audit emission
 * policy.
 */

import { test, expect } from "bun:test";
import {
  AURUM_AUDIT_ACTIONS,
  DELIVERY_STATE_TRANSITIONS,
  buildMaintenanceNotice,
  canTransitionDeliveryState,
  createInMemoryAurumAuditSink,
  createInMemoryDeliveryLedger,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  dispositionForState,
  emitCommunicationMessage,
  ingestDeliveryMetadata,
  summarizeDeliveries,
  type DeliveryIngestInput,
  type MaintenanceNoticeSource,
} from "../src/index";
import { CORR, DEV_A1, T1, T2, TENANT_A, ctxA, ctxB, failuresOf, invariantOf, roleRecipient } from "./helpers";

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

/** Emit one message and return its outbox message id. */
function emittedMessageId(): string {
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient("fleet_manager"),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const result = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.entry.intent.messageId;
}

function deliveryInput(
  messageRef: string,
  overrides: Partial<DeliveryIngestInput> = {},
): DeliveryIngestInput {
  return {
    messageRef,
    deliveryAttempt: 1,
    state: "sent",
    recipient: { recipientRef: "fleet_manager", channel: "email" },
    disposition: "in_progress",
    ingestedAt: T2,
    correlationId: CORR,
    ...overrides,
  };
}

/** A full emission + ingestion fixture shared by several tests. */
function emittedFixture() {
  const outbox = createInMemoryOutboxLedger();
  const built = buildMaintenanceNotice({
    recipient: roleRecipient("fleet_manager"),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const emission = emitCommunicationMessage(ctxA(), outbox, built.intent, {
    transport: createInMemoryTransport(),
  });
  if (!emission.ok) throw new Error(emission.error.message);
  return { outbox, messageId: emission.entry.intent.messageId };
}

test("a delivery record ingests, audits, and summarizes", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const sink = createInMemoryAurumAuditSink();
  const result = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInput(messageId), {
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.duplicate).toBe(false);
  expect(result.record.state).toBe("sent");
  expect(result.record.disposition).toBe("in_progress");
  expect(result.record.contentDigest).toHaveLength(8);
  expect(sink.records.map((r) => r.action)).toEqual([AURUM_AUDIT_ACTIONS.deliveryIngested]);
  const summary = summarizeDeliveries(ledger.listForMessage(ctxA(), messageId));
  expect(summary.attempts).toBe(1);
  expect(summary.latestState).toBe("sent");
  expect(summary.terminal).toBe(false);
});

test("ingestion is idempotent by (message ref, delivery attempt)", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const sink = createInMemoryAurumAuditSink();
  const first = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInput(messageId), {
    auditSink: sink,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInput(messageId), {
    auditSink: sink,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.duplicate).toBe(true);
  expect(ledger.size(ctxA())).toBe(1);
  expect(sink.records).toHaveLength(1); // no second audit
});

test("the same (ref, attempt) with different content is a conflict", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const first = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInput(messageId));
  if (!first.ok) throw new Error(first.error.message);
  const conflicting = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { ingestedAt: T1 }),
  );
  expect(conflicting.ok).toBe(false);
  if (conflicting.ok) throw new Error("expected refusal");
  expect(invariantOf(conflicting.error)).toBe("delivery_conflict");
  expect(ledger.size(ctxA())).toBe(1);
});

test("an unknown message ref is refused with a machine-stable reason", () => {
  const { outbox } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const sink = createInMemoryAurumAuditSink();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput("aurum_msg_00000000"),
    { auditSink: sink },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("unknown_message_ref");
  expect(ledger.size(ctxA())).toBe(0);
  expect(sink.records.map((r) => r.action)).toContain(AURUM_AUDIT_ACTIONS.deliveryRefused);
  expect(sink.records[0]?.details.reason).toBe("unknown_message_ref");
});

test("a foreign tenant's message ref is indistinguishable from unknown", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  // ctxB never emitted the message; the ref is unknown to tenant B.
  const result = ingestDeliveryMetadata(ctxB(), outbox, ledger, deliveryInput(messageId));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("unknown_message_ref");
  expect(ledger.size(ctxB())).toBe(0);
});

test("a disposition that does not match the state is refused", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { state: "delivered", disposition: "in_progress" }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("disposition_mismatch");
});

test("an unknown delivery state is refused (never a guess)", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    // @ts-expect-error — the type is bypassed on purpose (runtime guard)
    deliveryInput(messageId, { state: "vaporized" }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("ValidationError");
  expect(failuresOf(result.error).map((f) => f.reason)).toContain("unknown_delivery_state");
});

test("a recipient mismatch is refused", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, {
      recipient: { recipientRef: "someone_else", channel: "email" },
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("recipient_mismatch");
});

test("a terminal state absorbs further records for the same ref", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const read = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { state: "read", disposition: "succeeded" }),
  );
  if (!read.ok) throw new Error(read.error.message);
  // A NEW attempt after a terminal state is refused...
  const after = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { deliveryAttempt: 2, state: "sent" }),
  );
  expect(after.ok).toBe(false);
  if (after.ok) throw new Error("expected refusal");
  expect(invariantOf(after.error)).toBe("message_terminal");
  // ...but re-reporting the SAME terminal record stays an idempotent duplicate.
  const dup = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { state: "read", disposition: "succeeded" }),
  );
  expect(dup.ok).toBe(true);
  if (!dup.ok) throw new Error(dup.error.message);
  expect(dup.duplicate).toBe(true);
  expect(ledger.size(ctxA())).toBe(1);
  expect(summarizeDeliveries(ledger.listForMessage(ctxA(), messageId)).terminal).toBe(true);
});

test("a failed attempt may be followed by a new attempt", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const failed = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, { state: "failed", disposition: "failed" }),
  );
  if (!failed.ok) throw new Error(failed.error.message);
  const retried = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, {
      deliveryAttempt: 2,
      state: "delivered",
      disposition: "succeeded",
      ingestedAt: T2,
    }),
  );
  expect(retried.ok).toBe(true);
  if (!retried.ok) throw new Error(retried.error.message);
  expect(ledger.size(ctxA())).toBe(2);
  const summary = summarizeDeliveries(ledger.listForMessage(ctxA(), messageId));
  expect(summary.attempts).toBe(2);
  expect(summary.latestState).toBe("delivered");
});

test("malformed delivery input is refused with machine-stable failures", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, {
      messageRef: "",
      deliveryAttempt: 0,
      // @ts-expect-error — the type is bypassed on purpose (runtime guard)
      recipient: null,
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  const reasons = failuresOf(result.error).map((f) => f.reason);
  expect(reasons).toContain("non_empty_string_required");
  expect(reasons).toContain("positive_integer_required");
  expect(reasons).toContain("recipient_metadata_required");
});

test("a context-free ingestion is rejected by the runtime guard", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    // @ts-expect-error — the type is bypassed on purpose (runtime guard)
    undefined,
    outbox,
    ledger,
    deliveryInput(messageId),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("acting_context_invalid");
});

test("the delivery lifecycle table and disposition derivation are machine-stable", () => {
  expect(canTransitionDeliveryState("queued", "sent")).toBe(true);
  expect(canTransitionDeliveryState("sent", "delivered")).toBe(true);
  expect(canTransitionDeliveryState("delivered", "read")).toBe(true);
  expect(canTransitionDeliveryState("queued", "read")).toBe(false);
  expect(canTransitionDeliveryState("read", "sent")).toBe(false);
  expect(DELIVERY_STATE_TRANSITIONS.read).toHaveLength(0);
  expect(dispositionForState("queued")).toBe("in_progress");
  expect(dispositionForState("sent")).toBe("in_progress");
  expect(dispositionForState("delivered")).toBe("succeeded");
  expect(dispositionForState("read")).toBe("succeeded");
  expect(dispositionForState("failed")).toBe("failed");
  expect(dispositionForState("undeliverable")).toBe("failed");
});

test("delivery records are tenant-partitioned (cross-tenant reads miss)", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const ingested = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInput(messageId));
  if (!ingested.ok) throw new Error(ingested.error.message);
  expect(ledger.size(ctxA())).toBe(1);
  expect(ledger.size(ctxB())).toBe(0);
  expect(ledger.listForMessage(ctxB(), messageId)).toHaveLength(0);
});

test("the provider message id rides the recipient metadata verbatim", () => {
  const { outbox, messageId } = emittedFixture();
  const ledger = createInMemoryDeliveryLedger();
  const result = ingestDeliveryMetadata(
    ctxA(),
    outbox,
    ledger,
    deliveryInput(messageId, {
      recipient: { recipientRef: "fleet_manager", channel: "email", providerMessageId: "prov_1" },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.recipient.providerMessageId).toBe("prov_1");
});
