/**
 * W050C aurum adapter — tenant-isolation tests (D4).
 *
 * Isolation by construction, proven two ways (the W042 pattern):
 *   1. W012's REUSABLE isolation harness (`runTenantIsolationSuite`)
 *      over each ledger's raw tenant-scoped KV view;
 *   2. exhaustive rich-operation isolation: cross-tenant emissions
 *      refused with `tenant_mismatch`, foreign message ids
 *      indistinguishable from unknown (no existence side channel),
 *      context-free and invalid-grammar access rejected by the runtime
 *      guard WITH THE TYPES BYPASSED.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import { makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import {
  asTenantScopedDeliveryStore,
  asTenantScopedOutboxStore,
  buildMaintenanceNotice,
  createInMemoryDeliveryLedger,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
  ingestDeliveryMetadata,
  type DeliveryIngestInput,
  type MaintenanceNoticeSource,
  type OutboxEntry,
  type DeliveryRecord,
} from "../src/index";
import { CORR, DEV_A1, TENANT_A, TENANT_B, T1, T2, ctxA, ctxB, invariantOf, roleRecipient } from "./helpers";

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

/** Emit one maintenance notice into the given tenant's outbox, or throw. */
function emitOne(outbox: ReturnType<typeof createInMemoryOutboxLedger>, tenantId = TENANT_A) {
  const built = buildMaintenanceNotice({
    recipient: roleRecipient("fleet_manager"),
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
    { transport: createInMemoryTransport() },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.entry;
}

function deliveryInputFor(messageRef: string, overrides: Partial<DeliveryIngestInput> = {}): DeliveryIngestInput {
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

// ---------------------------------------------------------------------------
// 1. W012's reusable isolation harness over the raw KV views
// ---------------------------------------------------------------------------

test("W012 harness: the outbox ledger's raw KV view passes every isolation check", () => {
  const report = runTenantIsolationSuite<OutboxEntry>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: () => asTenantScopedOutboxStore(createInMemoryOutboxLedger()),
    makeValue: (tenantId, key) =>
      ({
        sequence: 1,
        tenantId,
        intent: {
          messageId: `aurum_msg_${key}`,
          tenantId,
          kind: "maintenance_notice",
          subjectRef: "swo_test00000001",
          recipient: { kind: "role", role: "fleet_manager" },
          priority: "normal",
          content: { title: "t", summary: "s", fields: [] },
          redactedFieldKeys: [],
          contentDigest: "00000000",
          emittedAt: T1,
          correlationId: CORR,
          schemaVersion: 1,
        },
        schemaVersion: 1,
      }) as OutboxEntry,
  });
  expect(report.ok).toBe(true);
  for (const check of report.checks) {
    expect(check.passed).toBe(true);
  }
});

test("W012 harness: the delivery ledger's raw KV view passes every isolation check", () => {
  const report = runTenantIsolationSuite<DeliveryRecord>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: () => asTenantScopedDeliveryStore(createInMemoryDeliveryLedger()),
    makeValue: (tenantId, key) =>
      ({
        tenantId,
        messageRef: `aurum_msg_${key}`,
        deliveryAttempt: 1,
        state: "sent",
        recipient: { recipientRef: "fleet_manager", channel: "email" },
        disposition: "in_progress",
        ingestedAt: T2,
        correlationId: CORR,
        contentDigest: "00000000",
        schemaVersion: 1,
      }) as DeliveryRecord,
  });
  expect(report.ok).toBe(true);
  for (const check of report.checks) {
    expect(check.passed).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// 2. Rich-operation isolation
// ---------------------------------------------------------------------------

test("a cross-tenant emission is refused; the foreign partition is untouched", () => {
  const outbox = createInMemoryOutboxLedger();
  const tenantAEntry = emitOne(outbox, TENANT_A);
  const built = buildMaintenanceNotice({
    recipient: roleRecipient("fleet_manager"),
    at: T1,
    correlationId: CORR,
    workOrder: workOrderSource(TENANT_B),
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const result = emitCommunicationMessage(ctxA(), outbox, built.intent, {});
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("tenant_mismatch");
  expect(outbox.size(ctxA())).toBe(1);
  expect(outbox.size(ctxB())).toBe(0);
  // The tenant-A message id is unknown to tenant B (no side channel).
  expect(outbox.get(ctxB(), tenantAEntry.intent.messageId)).toBeUndefined();
});

test("a tenant-B emission and a tenant-A emission with the same tuple get distinct partitions", () => {
  const outbox = createInMemoryOutboxLedger();
  emitOne(outbox, TENANT_A);
  emitOne(outbox, TENANT_B);
  expect(outbox.size(ctxA())).toBe(1);
  expect(outbox.size(ctxB())).toBe(1);
  expect(outbox.list(ctxA())[0]?.sequence).toBe(1);
  expect(outbox.list(ctxB())[0]?.sequence).toBe(1);
});

test("delivery ingestion for a foreign tenant's ref is indistinguishable from unknown", () => {
  const outbox = createInMemoryOutboxLedger();
  const entry = emitOne(outbox, TENANT_A);
  const ledger = createInMemoryDeliveryLedger();
  // Tenant B attempts to report delivery metadata for tenant A's message.
  const result = ingestDeliveryMetadata(ctxB(), outbox, ledger, deliveryInputFor(entry.intent.messageId));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(invariantOf(result.error)).toBe("unknown_message_ref");
  expect(ledger.size(ctxB())).toBe(0);
  // And the identical error surfaces for a truly unknown ref (byte-equal reason).
  const unknown = ingestDeliveryMetadata(ctxB(), outbox, ledger, deliveryInputFor("aurum_msg_00000000"));
  expect(unknown.ok).toBe(false);
  if (unknown.ok) throw new Error("expected refusal");
  expect(invariantOf(unknown.error)).toBe("unknown_message_ref");
});

test("delivery records are partitioned: cross-tenant reads and listForMessage miss", () => {
  const outbox = createInMemoryOutboxLedger();
  const entry = emitOne(outbox, TENANT_A);
  const ledger = createInMemoryDeliveryLedger();
  const ingested = ingestDeliveryMetadata(ctxA(), outbox, ledger, deliveryInputFor(entry.intent.messageId));
  if (!ingested.ok) throw new Error(ingested.error.message);
  expect(ledger.size(ctxA())).toBe(1);
  expect(ledger.size(ctxB())).toBe(0);
  expect(ledger.listForMessage(ctxB(), entry.intent.messageId)).toHaveLength(0);
  expect(ledger.list(ctxA())).toHaveLength(1);
});

test("context-free outbox access is rejected by the runtime guard with the types bypassed", () => {
  const outbox = createInMemoryOutboxLedger();
  expect(() =>
    outbox.get(
      // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
      undefined,
      "aurum_msg_00000000",
    ),
  ).toThrow();
  expect(() =>
    // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
    outbox.list(undefined),
  ).toThrow();
});

test("an invalid-grammar tenant context is rejected by the runtime guard", () => {
  const outbox = createInMemoryOutboxLedger();
  expect(() =>
    outbox.list(makeTenantContext(asTenantId("NOT_A_VALID_TENANT"))),
  ).toThrow();
});

test("context-free delivery-ledger access is rejected by the runtime guard", () => {
  const ledger = createInMemoryDeliveryLedger();
  expect(() =>
    // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
    ledger.list(undefined),
  ).toThrow();
  expect(() =>
    ledger.listForMessage(
      // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
      null,
      "aurum_msg_00000000",
    ),
  ).toThrow();
});

test("the raw KV views reject context-free access too (defense in depth)", () => {
  const outbox = createInMemoryOutboxLedger();
  const deliveries = createInMemoryDeliveryLedger();
  expect(() =>
    // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
    outbox.tenantScopedView.get(undefined, "k1"),
  ).toThrow();
  expect(() =>
    // @ts-expect-error — the type is bypassed on purpose (runtime guard proof)
    deliveries.tenantScopedView.has(null, "k1"),
  ).toThrow();
});

test("per-tenant outbox sequences stay gapless under interleaved tenants", () => {
  const outbox = createInMemoryOutboxLedger();
  const a1 = emitOne(outbox, TENANT_A);
  const b1 = emitOne(outbox, TENANT_B);
  const a2 = (() => {
    const built = buildMaintenanceNotice({
      recipient: roleRecipient("fleet_manager"),
      at: T1,
      correlationId: CORR,
      workOrder: { ...workOrderSource(TENANT_A), revision: 2 },
      event: "revised",
    });
    if (!built.ok) throw new Error(built.error.message);
    const result = emitCommunicationMessage(ctxA(), outbox, built.intent, {});
    if (!result.ok) throw new Error(result.error.message);
    return result.entry;
  })();
  expect(a1.sequence).toBe(1);
  expect(a2.sequence).toBe(2);
  expect(b1.sequence).toBe(1);
  expect(outbox.list(ctxA()).map((e) => e.sequence)).toEqual([1, 2]);
  expect(outbox.list(ctxB()).map((e) => e.sequence)).toEqual([1]);
});
