/**
 * W012 D3 — The append-only AuditLog abstraction: append semantics, per-
 * tenant chains, the NO-update/delete surface, validation, and the
 * verification walk.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asEventId, asTenantId, asUserId, toApiError } from "@fleetos/contracts";
import { makeFleetError, makeGuardianDecision } from "@fleetos/contracts/testing";
import { TenantIsolationError, makeTenantContext, makeUserPrincipal } from "@fleetos/identity";
import {
  type AuditLog,
  AuditValidationError,
  createInMemoryAuditLog,
  makeAuditActorRef,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const AT = "2026-03-01T00:00:00Z";

const ACTOR_A = makeAuditActorRef("user", "usr:u1", TENANT_A);
const ACTOR_B = makeAuditActorRef("user", "usr:u2", TENANT_B);

function appendInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT_A,
    actor: ACTOR_A,
    action: "device.wipe.executed",
    occurredAt: AT,
    source: "test.boundary",
    outcome: { status: "success" },
    correlationId: asCorrelationId("cor_w012log0001"),
    ...overrides,
  };
}

test("append assigns sequence, genesis link, and a verifiable content hash", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const record = log.append(ctx, appendInput() as never);
  expect(record.sequence).toBe(1);
  expect(record.priorRecordHash).toBe("genesis");
  expect(record.recordHash.length > 0).toBe(true);
  expect(record.id.startsWith("aud_")).toBe(true);
  expect(Object.isFrozen(record)).toBe(true);
  expect(log.verify(ctx).ok).toBe(true);
  expect(log.size(ctx)).toBe(1);
});

test("appends chain: each record carries the prior record's hash", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const r1 = log.append(ctx, appendInput() as never);
  const r2 = log.append(
    ctx,
    appendInput({ correlationId: asCorrelationId("cor_w012log0002") }) as never,
  );
  const r3 = log.append(
    ctx,
    appendInput({ correlationId: asCorrelationId("cor_w012log0003") }) as never,
  );
  expect(r2.sequence).toBe(2);
  expect(r2.priorRecordHash).toBe(r1.recordHash);
  expect(r3.priorRecordHash).toBe(r2.recordHash);
  expect(log.head(ctx)).toEqual({ sequence: 3, recordHash: r3.recordHash });
  expect(log.verify(ctx).ok).toBe(true);
});

test("each tenant owns an independent chain (own genesis, own sequence)", () => {
  const log = createInMemoryAuditLog();
  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  log.append(ctxA, appendInput() as never);
  log.append(ctxA, appendInput({ correlationId: asCorrelationId("cor_x1") }) as never);
  const firstB = log.append(
    ctxB,
    appendInput({ tenantId: TENANT_B, actor: ACTOR_B }) as never,
  );
  expect(firstB.sequence).toBe(1);
  expect(firstB.priorRecordHash).toBe("genesis");
  expect(log.size(ctxA)).toBe(2);
  expect(log.size(ctxB)).toBe(1);
  expect(log.records(ctxB)).toEqual([firstB]);
});

test("cross-tenant injection (context tenant != input tenant) is rejected", () => {
  const log = createInMemoryAuditLog();
  const ctxA = makeTenantContext(TENANT_A);
  expect(() =>
    log.append(
      ctxA,
      appendInput({ tenantId: TENANT_B, actor: ACTOR_B }) as never,
    ),
  ).toThrow(TenantIsolationError);
});

test("context-free access is rejected on every operation", () => {
  const log = createInMemoryAuditLog();
  const ops: (() => unknown)[] = [
    () => log.append(undefined as never, appendInput() as never),
    () => log.records(undefined as never),
    () => log.head(undefined as never),
    () => log.verify(undefined as never),
    () => log.size(undefined as never),
  ];
  for (const op of ops) expect(op).toThrow(TenantIsolationError);
});

test("TYPE-LEVEL: the AuditLog surface has NO update/delete/truncate members", () => {
  type AuditLogKeys = keyof AuditLog;
  type ExpectedKeys = "append" | "records" | "head" | "verify" | "size";
  // Both directions of assignability: no extra members, none missing.
  const exactBothWays: AuditLogKeys extends ExpectedKeys
    ? ExpectedKeys extends AuditLogKeys
      ? true
      : never
    : never = true;
  expect(exactBothWays).toBe(true);
  // And the runtime object exposes exactly those keys.
  const log = createInMemoryAuditLog();
  expect(Object.keys(log).sort()).toEqual(["append", "head", "records", "size", "verify"]);
});

test("records() returns a frozen copy — external mutation is impossible", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  log.append(ctx, appendInput() as never);
  const view = log.records(ctx);
  expect(Object.isFrozen(view)).toBe(true);
  expect(() => {
    (view as unknown as { push: (v: unknown) => number }).push({});
  }).toThrow();
  // Tampering the copy does not affect the log.
  expect(log.size(ctx)).toBe(1);
  expect(log.verify(ctx).ok).toBe(true);
});

test("validation rejects malformed inputs with a ValidationError projection", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const bad: Record<string, unknown>[] = [
    appendInput({ action: "" }),
    appendInput({ occurredAt: "not-a-date" }),
    appendInput({ source: "" }),
    appendInput({ correlationId: "" }),
    appendInput({ actor: { kind: "robot", principalId: "x", tenantId: TENANT_A } }),
    appendInput({ actor: { kind: "user", principalId: "", tenantId: TENANT_A } }),
    appendInput({ actor: ACTOR_B }), // actor tenant != record tenant
    appendInput({ outcome: { status: "crashed" } }),
    appendInput({ outcome: { status: "failure" } }), // failure requires error
    appendInput({ outcome: { status: "denied" } }), // denied requires reasons
    appendInput({ relatedEventIds: [""] }),
    appendInput({ relatedEventIds: "not-an-array" }),
    appendInput({ details: "not-an-object" }),
  ];
  for (const input of bad) {
    expect(() => log.append(ctx, input as never)).toThrow(AuditValidationError);
  }
  // Nothing was appended by rejected inputs.
  expect(log.size(ctx)).toBe(0);
});

test("a validation error carries the frozen FleetError taxonomy (400 via toApiError)", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  let caught: unknown;
  try {
    log.append(ctx, appendInput({ action: "" }) as never);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AuditValidationError);
  const auditError = caught as AuditValidationError;
  expect(auditError.fleet.kind).toBe("ValidationError");
  expect(auditError.fleet.code).toBe("audit.append.invalid");
  if (auditError.fleet.kind === "ValidationError") {
    expect(auditError.fleet.failures[0]?.path).toBe("/action");
  }
  expect(toApiError(auditError.fleet).status).toBe(400);
});

test("guardianDecision tenant mismatch is rejected", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const foreignDecision = makeGuardianDecision({ seed: "w012", tenantId: TENANT_B });
  expect(() =>
    log.append(ctx, appendInput({ guardianDecision: foreignDecision }) as never),
  ).toThrow(AuditValidationError);
});

test("a failure outcome carries the FleetError; a denied outcome carries reasons", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const error = makeFleetError({ seed: "w012-failure", kind: "DomainError", tenantId: TENANT_A });
  const failure = log.append(ctx, appendInput({ outcome: { status: "failure", error } }) as never);
  expect(failure.outcome.status).toBe("failure");
  if (failure.outcome.status === "failure") {
    expect(failure.outcome.error).toEqual(error);
  }
  const denied = log.append(
    ctx,
    appendInput({
      outcome: { status: "denied", reasons: ["consequential_requires_explicit_grant"] },
    }) as never,
  );
  expect(denied.outcome.status).toBe("denied");
  if (denied.outcome.status === "denied") {
    expect(denied.outcome.reasons).toEqual(["consequential_requires_explicit_grant"]);
  }
  expect(log.verify(ctx).ok).toBe(true);
});

test("relatedEventIds default to empty; supplied ids are preserved frozen", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const record = log.append(ctx, appendInput() as never);
  expect(record.relatedEventIds).toEqual([]);
  const withIds = log.append(
    ctx,
    appendInput({ relatedEventIds: [asEventId("evt_w012event01")] }) as never,
  );
  expect(withIds.relatedEventIds).toEqual([asEventId("evt_w012event01")]);
  expect(Object.isFrozen(withIds.relatedEventIds)).toBe(true);
});

test("empty chains verify ok with zero records and no head", () => {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const result = log.verify(ctx);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.records).toBe(0);
    expect(result.headHash).toBe("genesis");
  }
  expect(log.head(ctx)).toBeUndefined();
  expect(log.records(ctx)).toEqual([]);
});

test("the log is deterministic: identical appends produce identical chains", () => {
  const build = (): string => {
    const log = createInMemoryAuditLog();
    const ctx = makeTenantContext(TENANT_A);
    for (let i = 0; i < 3; i++) {
      log.append(
        ctx,
        appendInput({ correlationId: asCorrelationId(`cor_w012det00${i}`), details: { i } }) as never,
      );
    }
    return JSON.stringify(log.records(ctx));
  };
  expect(build()).toBe(build());
});

test("identity principals project onto audit actor refs structurally", () => {
  const principal = makeUserPrincipal(TENANT_A, asUserId("usr_w012proj0001"));
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const record = log.append(ctx, appendInput({ actor: principal }) as never);
  // Structural projection: the principal satisfies AuditActorRef (extra
  // fields like userId are legal under structural typing).
  expect(record.actor.kind).toBe("user");
  expect(record.actor.principalId).toBe(`usr:${principal.userId}`);
  expect(record.actor.tenantId).toBe(TENANT_A);
});
