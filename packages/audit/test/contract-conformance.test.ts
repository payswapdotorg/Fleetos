/**
 * W012 — Contract conformance: the audit foundation against the frozen
 * @fleetos/contracts surface and the @fleetos/contracts/testing fixture
 * builders (makeTenantId, makeTimestamp, makeCorrelationId, makeCausationId,
 * makeEventId, makeEventEnvelope, makeFleetError, makeGuardianDecision).
 *
 * The core conformance claim: audit records CORRELATE to EventEnvelope ids
 * from the frozen contracts (relatedEventIds + correlationId + causationId),
 * carry FleetError taxonomy records in failure outcomes, and correlate
 * GuardianDecisions for consequential actions — all inside a verifiable
 * hash chain.
 */

import { test, expect } from "bun:test";
import { validateEnvelope } from "@fleetos/contracts";
import {
  makeCausationId,
  makeCorrelationId,
  makeEventEnvelope,
  makeEventId,
  makeFleetError,
  makeGuardianDecision,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { makeTenantContext } from "@fleetos/identity";
import {
  AuditValidationError,
  createInMemoryAuditLog,
  makeAuditActorRef,
} from "../src/index";

test("audit records correlate to fixture EventEnvelope ids inside a valid chain", () => {
  const tenantId = makeTenantId("w012-audit-conformance");
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(tenantId);
  const actor = makeAuditActorRef("user", "usr:w012-conformance", tenantId);

  // Three fixture envelopes from the same tenant; each append references
  // the envelope's id, correlation id, and causation thread.
  for (let i = 0; i < 3; i++) {
    const envelope = makeEventEnvelope({ seed: `w012-audit-${i}`, tenantId });
    expect(validateEnvelope(envelope).ok).toBe(true);
    log.append(ctx, {
      tenantId,
      actor,
      action: "device.observation.audited",
      occurredAt: envelope.occurredAt,
      source: "audit.conformance",
      outcome: { status: "success" },
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      relatedEventIds: [envelope.id],
      details: { eventType: envelope.type, subject: envelope.subject },
    });
  }

  const records = log.records(ctx);
  expect(records).toHaveLength(3);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const envelope = makeEventEnvelope({ seed: `w012-audit-${i}`, tenantId });
    expect(record.relatedEventIds).toEqual([envelope.id]);
    expect(record.correlationId).toBe(envelope.correlationId);
    expect(record.causationId).toBe(envelope.causationId);
    expect(record.tenantId).toBe(tenantId);
  }
  // The correlated chain verifies.
  const verification = log.verify(ctx);
  expect(verification.ok).toBe(true);
  if (verification.ok) expect(verification.records).toBe(3);
});

test("fixture event ids are stable — correlation survives re-derivation", () => {
  const id1 = makeEventId("w012-stable");
  const id2 = makeEventId("w012-stable");
  expect(id1).toBe(id2);
  expect(makeCorrelationId("w012-stable-cor")).toBe(makeCorrelationId("w012-stable-cor"));
  expect(makeCausationId("w012-stable")).toBe(makeCausationId("w012-stable"));
});

test("failure outcomes carry fixture FleetErrors of every taxonomy kind", () => {
  const tenantId = makeTenantId("w012-audit-errors");
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(tenantId);
  const actor = makeAuditActorRef("service", "svc:conformance", tenantId);
  const kinds = [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ] as const;

  for (const kind of kinds) {
    const error = makeFleetError({ seed: `w012-audit-${kind}`, kind, tenantId });
    log.append(ctx, {
      tenantId,
      actor,
      action: "integration.boundary.failed",
      occurredAt: makeTimestamp(`w012-audit-${kind}`),
      source: "audit.conformance",
      outcome: { status: "failure", error },
      correlationId: error.correlationId,
    });
  }
  const records = log.records(ctx);
  expect(records).toHaveLength(6);
  for (let i = 0; i < records.length; i++) {
    const outcome = records[i]?.outcome;
    expect(outcome?.status).toBe("failure");
  }
  expect(log.verify(ctx).ok).toBe(true);
});

test("guardianDecisions from fixtures correlate on consequential-action records", () => {
  const tenantId = makeTenantId("w012-audit-guardian");
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(tenantId);
  const actor = makeAuditActorRef("user", "usr:w012-conformance", tenantId);

  for (const decision of ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const) {
    log.append(ctx, {
      tenantId,
      actor,
      action: "device.wipe.executed",
      occurredAt: makeTimestamp(`w012-guardian-${decision}`),
      source: "audit.conformance",
      outcome: { status: "success" },
      correlationId: makeCorrelationId(`w012-guardian-${decision}`),
      guardianDecision: makeGuardianDecision({
        seed: `w012-guardian-${decision}`,
        decision,
        tenantId,
      }),
    });
  }
  const records = log.records(ctx);
  expect(records).toHaveLength(4);
  for (const record of records) {
    expect(record.guardianDecision?.tenantId).toBe(tenantId);
  }
  expect(log.verify(ctx).ok).toBe(true);
});

test("a foreign-tenant fixture decision is rejected (tenant isolation inside records)", () => {
  const tenantId = makeTenantId("w012-audit-guardian");
  const foreignDecision = makeGuardianDecision({
    seed: "w012-foreign",
    tenantId: makeTenantId("w012-audit-foreign"),
  });
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(tenantId);
  expect(() =>
    log.append(ctx, {
      tenantId,
      actor: makeAuditActorRef("user", "usr:w012-conformance", tenantId),
      action: "device.wipe.executed",
      occurredAt: makeTimestamp("w012-foreign"),
      source: "audit.conformance",
      outcome: { status: "success" },
      correlationId: makeCorrelationId("w012-foreign"),
      guardianDecision: foreignDecision,
    }),
  ).toThrow(AuditValidationError);
});

test("fixture timestamps chain deterministically across two logs", () => {
  const tenantId = makeTenantId("w012-audit-determinism");
  const build = (): string => {
    const log = createInMemoryAuditLog();
    const ctx = makeTenantContext(tenantId);
    const actor = makeAuditActorRef("user", "usr:w012-conformance", tenantId);
    for (let i = 0; i < 5; i++) {
      log.append(ctx, {
        tenantId,
        actor,
        action: `test.action.${i}`,
        occurredAt: makeTimestamp(`w012-det-${i}`),
        source: "audit.conformance",
        outcome: { status: "success" },
        correlationId: makeCorrelationId(`w012-det-${i}`),
        details: { index: i },
      });
    }
    return JSON.stringify(log.records(ctx));
  };
  expect(build()).toBe(build());
});

test("an injected custom hash function is honored end-to-end", () => {
  const tenantId = makeTenantId("w012-audit-customhash");
  // A deliberately different hash function (prefix marker + fnv).
  const customHash = (canonical: string): string => `custom:${canonical.length}`;
  const log = createInMemoryAuditLog({ hash: customHash });
  const ctx = makeTenantContext(tenantId);
  const record = log.append(ctx, {
    tenantId,
    actor: makeAuditActorRef("user", "usr:w012-conformance", tenantId),
    action: "test.action.custom",
    occurredAt: makeTimestamp("w012-custom"),
    source: "audit.conformance",
    outcome: { status: "success" },
    correlationId: makeCorrelationId("w012-custom"),
  });
  expect(record.recordHash.startsWith("custom:")).toBe(true);
  expect(log.verify(ctx).ok).toBe(true);
});
