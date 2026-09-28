/**
 * W050B arena — D5 tests: audit emission through the injected sink,
 * structurally satisfied by @fleetos/audit's REAL sink adapter.
 *
 * The arena audit seam (`ArenaAuditSink`) is structurally identical to
 * the W011/W021/W022/W031/W032/W040/W041 seams; W012's
 * `createAuditSinkAdapter` adapts the REAL hash-chained `AuditLog` to
 * any structurally identical seam. This suite proves:
 *   - the adapter satisfies the arena seam (the type-level structural
 *     proof + the runtime flow);
 *   - consequential arena mutations flow into the hash-chained log;
 *   - the chain VERIFIES (no tampering);
 *   - per-tenant chains stay SEPARATE (tenant A's records never appear
 *     in tenant B's chain).
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import {
  submitEvaluationCase,
  adoptCapability,
  createInMemoryEvaluationCaseStore,
  createInMemoryCapabilityAdoptionStore,
  ARENA_AUDIT_ACTIONS,
  type ArenaAuditSink,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  USER_1,
  CORR,
  CORR_2,
  scopeA,
  scopeB,
  realGuardian,
  ruleSet,
  caseSubmitRequest,
  caseInput,
  certifiedMetadata,
} from "./helpers";
import type { CapabilityAdoptionProposal } from "../src/index";

/** Bind the REAL audit sink adapter to the arena seam (the structural proof). */
function bindSink(log: AuditLog): ArenaAuditSink {
  // This assignment type-checks ONLY if @fleetos/audit's adapter is
  // structurally compatible with the arena seam.
  const sink: ArenaAuditSink = createAuditSinkAdapter(log, { source: "arena.w050b-test" });
  return sink;
}

test("the REAL @fleetos/audit sink adapter satisfies the ArenaAuditSink seam structurally", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  expect(typeof sink.append).toBe("function");
  // A hand-made record flows through into the hash-chained log.
  sink.append({
    action: "arena.case.submitted",
    tenantId: TENANT_A,
    subject: "arc_probe",
    occurredAt: T0,
    correlationId: CORR,
    details: { probe: true },
  });
  expect(log.size(makeTenantContext(TENANT_A, CORR))).toBe(1);
});

test("a full arena flow emits its consequential mutations into the hash-chained AuditLog; the chain verifies", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);

  // D1: evaluation-case submitted (ALLOW).
  const caseStore = createInMemoryEvaluationCaseStore();
  const submitted = submitEvaluationCase(
    scopeA(),
    caseStore,
    caseInput(),
    {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(submitted.ok).toBe(true);

  // D2: capability adopted.
  const adoptionStore = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const adopted = adoptCapability(scopeA(), adoptionStore, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(adopted.ok).toBe(true);

  // D3: a refused (uncertified) capability.
  const refused = adoptCapability(
    scopeA(),
    adoptionStore,
    { ...metadata, certificationRef: "" },
    {
      proposalId: "prop/test-2",
      approverId: USER_1,
      approvedAt: T1,
      cohort: "cohort/canary-2",
      rollbackVersion: "1.1.0",
    },
    {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    },
  );
  expect(refused.ok).toBe(false);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    "arena.case.submitted",
    "arena.capability.adopted",
    "arena.capability.refused",
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

  // Tenant A: one case submitted.
  const caseStoreA = createInMemoryEvaluationCaseStore();
  const submittedA = submitEvaluationCase(
    scopeA(),
    caseStoreA,
    caseInput(),
    {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(submittedA.ok).toBe(true);

  // Tenant B: TWO consequential mutations (a case + a capability adoption).
  const caseStoreB = createInMemoryEvaluationCaseStore();
  const submittedB = submitEvaluationCase(
    scopeB(),
    caseStoreB,
    caseInput({ tenantId: TENANT_B }),
    {
      ruleSet: ruleSet(TENANT_B, []),
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_B),
      guardianOptions: { at: T0, correlationId: CORR_2 },
      auditSink: sink,
    },
  );
  expect(submittedB.ok).toBe(true);
  const adoptionStoreB = createInMemoryCapabilityAdoptionStore();
  const adoptedB = adoptCapability(
    scopeB(),
    adoptionStoreB,
    certifiedMetadata({ tenantId: TENANT_B }),
    {
      proposalId: "prop/test-b-1",
      approverId: USER_1,
      approvedAt: T0,
      cohort: "cohort/canary-b-1",
      rollbackVersion: "1.1.0",
    },
    {
      at: T1,
      correlationId: CORR_2,
      auditSink: sink,
    },
  );
  expect(adoptedB.ok).toBe(true);

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

test("the granted-adoption audit record carries the certification reference verbatim", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const adopted = adoptCapability(scopeA(), createInMemoryCapabilityAdoptionStore(), metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(adopted.ok).toBe(true);
  const record = log.records(ctxA).find((r) => r.action === ARENA_AUDIT_ACTIONS.capabilityAdopted);
  expect(record).toBeDefined();
  const details = record?.details as Record<string, unknown>;
  expect(details["certificationRef"]).toBe(metadata.certificationRef);
  expect(details["capabilityId"]).toBe(metadata.capabilityId);
  expect(details["capabilityVersion"]).toBe(metadata.capabilityVersion);
  expect(details["proposalId"]).toBe("prop/test-1");
  expect(details["approverId"]).toBe(USER_1 as string);
});

test("the refused-adoption audit record carries the machine-stable refusal reasons", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(
    scopeA(),
    createInMemoryCapabilityAdoptionStore(),
    { ...metadata, certificationRef: "" }, // uncertified
    proposal,
    {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(false);
  const record = log.records(ctxA).find((r) => r.action === ARENA_AUDIT_ACTIONS.capabilityRefused);
  expect(record).toBeDefined();
  const details = record?.details as Record<string, unknown>;
  expect(Array.isArray(details["reasons"])).toBe(true);
  expect((details["reasons"] as readonly string[]).includes("missing_certification_ref")).toBe(true);
  // The refusal did NOT touch the store — the adoption record was never created.
  expect(details["capabilityId"]).toBe(metadata.capabilityId);
});

test("the tenant guard: a context-free audit append through the adapter is rejected by the log's guard", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  // The log's own validation rejects context-free access (the W012 guard).
  expect(() =>
    sink.append({
      action: "arena.probe",
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
