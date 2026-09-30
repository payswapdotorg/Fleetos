/**
 * W100C — the durable audit log: restart continuity, tamper detection,
 * tenant isolation, and byte-compatibility with the in-memory reference.
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId, asCausationId, asEventId, asAuditRecordId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import { createInMemoryDurableRecordStore } from "@fleetos/identity";
import {
  AUDIT_DURABLE_DDL,
  AUDIT_DURABLE_TABLE,
  AuditValidationError,
  createDurableAuditLog,
  createInMemoryAuditLog,
  makeAuditActorRef,
} from "../src/index";
import type { AuditAppendInput } from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const CORR = asCorrelationId("cor_w100c_audit01");
const T0 = "2026-10-01T09:00:00Z";
const T1 = "2026-10-01T12:00:00Z";
const T2 = "2026-10-02T09:00:00Z";

function appendInput(action: string, at: string): AuditAppendInput {
  return {
    tenantId: TENANT_A,
    actor: makeAuditActorRef("user", "usr:founder0001", TENANT_A),
    action,
    occurredAt: at,
    source: "identity.lifecycle",
    outcome: { status: "success" },
    correlationId: CORR,
    relatedEventIds: [asEventId("evt_000000000001")],
    details: { note: action },
  };
}

test("the durable table declares the append-only audit trail with a sequence key", () => {
  expect(AUDIT_DURABLE_TABLE.name).toBe("fleetos_audit_records");
  expect(AUDIT_DURABLE_TABLE.primaryKey).toEqual(["sequence"]);
  expect(AUDIT_DURABLE_TABLE.columns.find((c) => c.name === "record_hash")!.nullable).toBe(false);
  expect(AUDIT_DURABLE_DDL).toContain("CREATE TABLE IF NOT EXISTS fleetos_audit_records");
  expect(AUDIT_DURABLE_DDL).toContain("PRIMARY KEY (sequence)");
});

test("append/records/head/verify/size work over the durable seam", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctx = makeTenantContext(TENANT_A, CORR);

  const first = log.append(ctx, appendInput("identity.session.opened", T0));
  const second = log.append(ctx, appendInput("identity.role.switched", T1));

  expect(first.sequence).toBe(1);
  expect(second.sequence).toBe(2);
  expect(second.priorRecordHash).toBe(first.recordHash);

  expect(log.size(ctx)).toBe(2);
  expect(log.records(ctx).map((r) => r.action)).toEqual([
    "identity.session.opened",
    "identity.role.switched",
  ]);
  const head = log.head(ctx);
  expect(head!.sequence).toBe(2);
  expect(head!.recordHash).toBe(second.recordHash);
  expect(log.verify(ctx).ok).toBe(true);
});

test("RESTART CONTINUITY: a new log instance over the same store continues the chain", () => {
  const store = createInMemoryDurableRecordStore();
  const ctx = makeTenantContext(TENANT_A, CORR);

  const firstLog = createDurableAuditLog(store);
  const a = firstLog.append(ctx, appendInput("identity.workspace.created", T0));
  const b = firstLog.append(ctx, appendInput("identity.session.opened", T1));

  // "Restart" — a brand-new log instance over the SAME durable store.
  const secondLog = createDurableAuditLog(store);
  const c = secondLog.append(ctx, appendInput("identity.role.switched", T2));

  // The chain continued: sequence 3 links to record 2's hash.
  expect(c.sequence).toBe(3);
  expect(c.priorRecordHash).toBe(b.recordHash);
  expect(secondLog.records(ctx).map((r) => r.sequence)).toEqual([1, 2, 3]);
  // The full chain verifies across the restart.
  expect(secondLog.verify(ctx).ok).toBe(true);
  // Record ids are restart-stable and collision-free.
  const ids = secondLog.records(ctx).map((r) => r.id);
  expect(new Set(ids).size).toBe(3);
  expect(a.id).not.toBe(b.id);
  void a;
});

test("TAMPER DETECTION: mutating a persisted row breaks the chain verification", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctx = makeTenantContext(TENANT_A, CORR);
  log.append(ctx, appendInput("identity.workspace.created", T0));
  log.append(ctx, appendInput("identity.session.opened", T1));
  expect(log.verify(ctx).ok).toBe(true);

  // Tamper: overwrite the SECOND record's action directly in the store
  // (bypassing the append-only API — the threat model of the chain walk).
  const rows = store.list(ctx, "fleetos_audit_records");
  const tamperedRow = { ...rows[1]!.row, action: "identity.evil.action" };
  store.put(ctx, "fleetos_audit_records", rows[1]!.key, tamperedRow);

  const verification = log.verify(ctx);
  expect(verification.ok).toBe(false);
});

test("TAMPER DETECTION: a spliced/renumbered row breaks the chain", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctx = makeTenantContext(TENANT_A, CORR);
  log.append(ctx, appendInput("one", T0));
  log.append(ctx, appendInput("two", T1));

  // Splice: rewrite the FIRST record's hash link so the chain breaks.
  const rows = store.list(ctx, "fleetos_audit_records");
  const spliced = { ...rows[0]!.row, record_hash: "deadbeef" };
  store.put(ctx, "fleetos_audit_records", rows[0]!.key, spliced);
  expect(log.verify(ctx).ok).toBe(false);
});

test("tenant isolation: each tenant owns an independent chain", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);

  log.append(ctxA, appendInput("identity.workspace.created", T0));
  log.append(
    ctxB,
    { ...appendInput("identity.workspace.created", T0), tenantId: TENANT_B, actor: makeAuditActorRef("user", "usr:b", TENANT_B) },
  );
  log.append(ctxA, appendInput("identity.role.switched", T1));

  expect(log.size(ctxA)).toBe(2);
  expect(log.size(ctxB)).toBe(1);
  // Independent chains: tenant B's head is its own record.
  expect(log.head(ctxB)!.sequence).toBe(1);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
});

test("a cross-tenant append (ctx vs input) is rejected", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  expect(() => log.append(ctxB, appendInput("identity.role.switched", T1))).toThrow(AuditValidationError);
});

test("invalid append inputs refuse identically to the in-memory log", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctx = makeTenantContext(TENANT_A, CORR);
  const bad = { ...appendInput("nope", T0), occurredAt: "not-a-time" };
  expect(() => log.append(ctx, bad)).toThrow(AuditValidationError);
  const badOutcome = { ...appendInput("nope", T0), outcome: { status: "maybe" } as never };
  expect(() => log.append(ctx, badOutcome)).toThrow(AuditValidationError);
  // Nothing was persisted.
  expect(log.size(ctx)).toBe(0);
});

test("records rehydrate with full fidelity (nested fields + optionals)", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createDurableAuditLog(store);
  const ctx = makeTenantContext(TENANT_A, CORR);
  const input: AuditAppendInput = {
    tenantId: TENANT_A,
    actor: makeAuditActorRef("user", "usr:founder0001", TENANT_A),
    action: "device.wipe.executed",
    occurredAt: T0,
    source: "actions.control-plane",
    outcome: { status: "denied", reasons: ["policy_block", "requires_approval"] },
    correlationId: CORR,
    causationId: asCausationId("cau_000000000001"),
    relatedEventIds: [asEventId("evt_000000000001"), asEventId("evt_000000000002")],
    details: { deviceId: "dev_1", nested: { deep: [1, 2, 3] } },
  };
  const appended = log.append(ctx, input);
  const rehydrated = log.records(ctx)[0]!;

  expect(rehydrated.action).toBe(appended.action);
  expect(rehydrated.outcome).toEqual(appended.outcome);
  expect(rehydrated.causationId).toBe(appended.causationId);
  expect(rehydrated.relatedEventIds).toEqual(appended.relatedEventIds);
  expect(rehydrated.details).toEqual(appended.details);
  expect(rehydrated.recordHash).toBe(appended.recordHash);
  expect(rehydrated).toEqual(appended);
});

test("the durable and in-memory logs produce IDENTICAL records for identical inputs", () => {
  const store = createInMemoryDurableRecordStore();
  const durable = createDurableAuditLog(store, {
    idGenerator: (tenantId, sequence) =>
      asAuditRecordId(`aud_x${tenantId.slice(4)}_${String(sequence).padStart(6, "0")}`),
  });
  const memory = createInMemoryAuditLog({
    idGenerator: (() => {
      let n = 0;
      return () => {
        n += 1;
        return asAuditRecordId(`aud_x${TENANT_A.slice(4)}_${String(n).padStart(6, "0")}`);
      };
    })(),
  });
  const ctx = makeTenantContext(TENANT_A, CORR);
  const input = appendInput("identity.workspace.created", T0);
  const durableRecord = durable.append(ctx, input);
  const memoryRecord = memory.append(ctx, input);
  expect(durableRecord).toEqual(memoryRecord);
  expect(durable.verify(ctx)).toEqual(memory.verify(ctx));
});
