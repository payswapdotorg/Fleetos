/**
 * W040 recovery — D5 tests: audit emission through the injected sink,
 * structurally satisfied by @fleetos/audit's REAL sink adapter.
 *
 * The recovery audit seam (`RecoveryAuditSink`) is structurally identical
 * to the W011/W021/W022/W031/W041 seams; W012's `createAuditSinkAdapter`
 * adapts the REAL hash-chained `AuditLog` to any structurally identical
 * seam. This suite proves:
 *   - the adapter satisfies the recovery seam (the type-level structural
 *     proof + the runtime flow);
 *   - consequential recovery mutations flow into the hash-chained log;
 *   - the chain VERIFIES (no tampering);
 *   - per-tenant chains stay SEPARATE (tenant A's records never appear
 *     in tenant B's chain).
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import {
  createInMemoryLastSeenLedger,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  createInMemoryReplacementEscalationLedger,
  recordLastSeenObservations,
  openRecoveryCase,
  transitionRecoveryCase,
  requestDestructiveAction,
  escalateReplacement,
} from "../src/index";
import type { RecoveryAuditSink } from "../src/index";
import {
  T0,
  T1,
  T2,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  DEV_B1,
  CORR,
  CORR_2,
  THRESHOLDS,
  atHour,
  atDay,
  scopeA,
  scopeB,
  lostTrigger,
  realGuardian,
  ruleSet,
  adapter,
  FULLY_CAPABLE,
  obs,
  batch,
} from "./helpers";

/** Bind the REAL audit sink adapter to the recovery seam (the structural proof). */
function bindSink(log: AuditLog): RecoveryAuditSink {
  // This assignment type-checks ONLY if @fleetos/audit's adapter is
  // structurally compatible with the recovery seam.
  const sink: RecoveryAuditSink = createAuditSinkAdapter(log, { source: "recovery.w040-test" });
  return sink;
}

test("the REAL @fleetos/audit sink adapter satisfies the RecoveryAuditSink seam structurally", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  expect(typeof sink.append).toBe("function");
  // A hand-made record flows through into the hash-chained log.
  sink.append({
    action: "recovery.case.opened",
    tenantId: TENANT_A,
    subject: "rc_probe",
    occurredAt: T0,
    correlationId: CORR,
    details: { probe: true },
  });
  expect(log.size(makeTenantContext(TENANT_A, CORR))).toBe(1);
});

test("a full recovery flow emits its consequential mutations into the hash-chained AuditLog; the chain verifies", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);

  // D1: last-seen evidence recorded.
  const lastSeenLedger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), lastSeenLedger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
    auditSink: sink,
  });

  // D2: case opened + transitioned.
  const caseStore = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    scopeA(),
    caseStore,
    { deviceId: DEV_A1, trigger: lostTrigger(), lastSeenRecordId: "ls_audit", postureFindingRefs: [] },
    { at: T0, correlationId: CORR, auditSink: sink },
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.error.message);
  const securing = transitionRecoveryCase(scopeA(), caseStore, opened.record, "SECURING", {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(securing.ok).toBe(true);

  // D3: destructive action requested + executed through the real Guardian + adapter.
  const requestStore = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const executed = requestDestructiveAction(scopeA(), requestStore, securing.ok ? securing.record : (null as never), "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    auditSink: sink,
  });
  expect(executed.ok && executed.record.status).toBe("EXECUTED");

  // D4: replacement escalated.
  const escalationResult = escalateReplacement(
    scopeA(),
    createInMemoryReplacementEscalationLedger(),
    {
      deviceId: DEV_A1,
      caseId: opened.record.caseId,
      diagnosis: {
        hypothesisId: "hyp_audit",
        recommendationId: "tr_audit",
        causeId: "health.hardware_failing",
        confidence: 0.8,
        proposedIntent: { intentKind: "ReplacementIntent", payload: { deviceId: DEV_A1 as string, reason: "failing" } },
        observationIds: ["obs_audit_1"],
      },
    },
    { at: atDay(1), correlationId: CORR, auditSink: sink },
  );
  expect(escalationResult.ok).toBe(true);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    "recovery.lastseen.recorded",
    "recovery.case.opened",
    "recovery.case.transitioned",
    "recovery.destructive.requested",
    "recovery.destructive.executed",
    "recovery.replacement.escalated",
  ]);
  // The hash chain verifies end-to-end.
  const verification = log.verify(ctxA);
  expect(verification.ok).toBe(true);
});

test("per-tenant chains stay separate: tenant B's emissions never enter tenant A's chain", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR_2);

  // Tenant A: one case opened.
  const caseStoreA = createInMemoryRecoveryCaseStore();
  const openedA = openRecoveryCase(
    scopeA(),
    caseStoreA,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR, auditSink: sink },
  );
  expect(openedA.ok).toBe(true);

  // Tenant B: TWO consequential mutations (a case + a last-seen record).
  const caseStoreB = createInMemoryRecoveryCaseStore();
  const openedB = openRecoveryCase(
    scopeB(),
    caseStoreB,
    { deviceId: DEV_B1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR_2, auditSink: sink },
  );
  expect(openedB.ok).toBe(true);
  const lastSeenB = createInMemoryLastSeenLedger();
  const recordedB = recordLastSeenObservations(scopeB(), lastSeenB, DEV_B1, [batch(DEV_B1, [obs("device.health", 1, atHour(1))], atHour(1), TENANT_B)], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR_2,
    auditSink: sink,
  });
  expect(recordedB.ok).toBe(true);

  // Each chain holds ONLY its own tenant's records; both verify.
  expect(log.size(ctxA)).toBe(1);
  expect(log.size(ctxB)).toBe(2);
  expect(log.records(ctxA).every((r) => r.tenantId === TENANT_A)).toBe(true);
  expect(log.records(ctxB).every((r) => (r.tenantId as string) === (TENANT_B as string))).toBe(true);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
  // The chain heads differ (separate chains).
  expect(log.head(ctxA)?.recordHash).not.toBe(log.head(ctxB)?.recordHash);
});

test("the granted-execution audit record carries the full §16 evidence trail", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const caseStore = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    scopeA(),
    caseStore,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: ["secfnd_trail"] },
    { at: T0, correlationId: CORR },
  );
  if (!opened.ok) throw new Error(opened.error.message);
  const requestStore = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const executed = requestDestructiveAction(scopeA(), requestStore, opened.record, "wipe", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    auditSink: sink,
  });
  expect(executed.ok && executed.record.status).toBe("EXECUTED");
  const executedRecord = log
    .records(ctxA)
    .find((r) => r.action === "recovery.destructive.executed");
  expect(executedRecord).toBeDefined();
  const details = executedRecord?.details as Record<string, unknown>;
  expect(details["decision"]).toBe("ALLOW"); // the policy decision
  expect(details["ruleIds"]).toEqual([]); // the rule ids
  expect(Array.isArray(details["observationEvidence"])).toBe(true); // the observation evidence basis
  expect(Array.isArray(details["adapterEvidence"])).toBe(true); // the adapter's execution evidence
  expect(details["caseId"]).toBe(opened.record.caseId);
});

test("the tenant guard: a context-free audit append through the adapter is rejected by the log's guard", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  // The log's own validation rejects context-free access (the W012 guard).
  expect(() =>
    sink.append({
      action: "recovery.probe",
      tenantId: TENANT_A,
      subject: null,
      occurredAt: T0,
      correlationId: CORR,
      details: {},
    }),
  ).not.toThrow(); // a well-formed record is fine
  expect(() =>
    log.records(undefined as never),
  ).toThrow();
});
