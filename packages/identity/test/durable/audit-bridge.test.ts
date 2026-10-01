/**
 * W100C — the audit BRIDGE: `@fleetos/audit`'s sink adapter satisfies the
 * identity audit seam STRUCTURALLY (no wiring dependency), and identity
 * lifecycle emissions land in the REAL hash-chained audit trail.
 *
 * This is the same-lane proof the W022/W032/W042 seams established:
 * the adapter returned by `createAuditSinkAdapter(log, { source })`
 * accepts `IdentityAuditRecord` because the record shape satisfies
 * `AuditSinkRecord` — TypeScript structural typing, verified here at
 * runtime over the REAL audit log.
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import { createInMemoryAuditLog, createAuditSinkAdapter, makeAuditActorRef } from "@fleetos/audit";
import {
  createDurableRoleAssignmentRepository,
  createDurableSessionRepository,
  createInMemoryDurableRecordStore,
  createInMemoryIdentityAuditSink,
  createRoleSwitchService,
  createSessionService,
  makeRoleDefinition,
  makeTenantContext,
  makeUserPrincipal,
} from "../../src/index";
import type { IdentityAuditSink } from "../../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const FOUNDER = asUserId("usr_founder0001");
const CORR = asCorrelationId("cor_w100c_bridge01");
const T0 = "2026-10-01T09:00:00Z";
const T1 = "2026-10-01T12:00:00Z";

const ROLE_DEFS = [
  makeRoleDefinition("fleet.admin", ["device.read"]),
  makeRoleDefinition("asset.manager", ["workload.read"]),
];

test("the audit sink adapter satisfies the IdentityAuditSink seam structurally", () => {
  const log = createInMemoryAuditLog();
  const sink: IdentityAuditSink = createAuditSinkAdapter(log, {
    source: "identity.lifecycle",
    actor: (record) => makeAuditActorRef("user", (record as unknown as { actorPrincipalId: string }).actorPrincipalId, record.tenantId),
  });
  sink.append({
    tenantId: TENANT_A,
    action: "identity.role.switched",
    subject: "ses_1",
    actorPrincipalId: `usr:${FOUNDER}`,
    occurredAt: T0,
    correlationId: CORR,
    details: { fromRole: null, toRole: "fleet.admin" },
  });
  const ctx = makeTenantContext(TENANT_A, CORR);
  expect(log.size(ctx)).toBe(1);
  const record = log.records(ctx)[0]!;
  expect(record.action).toBe("identity.role.switched");
  expect(record.actor.kind).toBe("user");
  expect(record.actor.principalId).toBe(`usr:${FOUNDER}`);
  expect(record.details["subject"]).toBe("ses_1");
  expect(record.details["toRole"]).toBe("fleet.admin");
  // The chain verifies.
  expect(log.verify(ctx).ok).toBe(true);
});

test("the full durable identity lifecycle emits into the REAL hash-chained audit trail", () => {
  const store = createInMemoryDurableRecordStore();
  const log = createInMemoryAuditLog();
  const bridged: IdentityAuditSink = createAuditSinkAdapter(log, {
    source: "identity.lifecycle",
    actor: (record) => makeAuditActorRef("user", (record as unknown as { actorPrincipalId: string }).actorPrincipalId, record.tenantId),
  });
  const audit = createInMemoryIdentityAuditSink();
  const sessions = createDurableSessionRepository(store);
  const assignments = createDurableRoleAssignmentRepository(store);

  const sessionService = createSessionService({ sessions, auditSink: audit });
  const switchService = createRoleSwitchService({
    sessions,
    assignmentsOf: (ctx) => assignments.listAssignments(ctx),
    auditSink: audit,
  });

  const ctxA = makeTenantContext(TENANT_A, CORR);
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  assignments.addAssignment(ctxA, {
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "fleet.admin",
    assignedAt: T0,
    assignedBy: `usr:${FOUNDER}`,
  });
  const opened = sessionService.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("open failed");
  const switched = switchService.switchActiveRole(ctxA, {
    now: T1,
    sessionId: opened.session.sessionId,
    targetRole: "fleet.admin",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(switched.ok).toBe(true);

  // EVERY identity emission bridges into the real audit trail verbatim.
  for (const record of audit.records) {
    bridged.append(record);
  }
  expect(log.size(ctxA)).toBe(2);
  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual(["identity.session.opened", "identity.role.switched"]);
  // The chain verifies end-to-end.
  expect(log.verify(ctxA).ok).toBe(true);
  // The switch record carries the from/to detail.
  const switchRecord = log.records(ctxA)[1]!;
  expect(switchRecord.details["fromRole"]).toBe(null);
  expect(switchRecord.details["toRole"]).toBe("fleet.admin");
  expect(switchRecord.details["tenantUnchanged"]).toBe(true);
});
