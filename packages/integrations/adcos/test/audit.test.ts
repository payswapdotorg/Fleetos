/**
 * W050A ADCOS — audit emission through the injected sink, structurally
 * satisfied by @fleetos/audit's REAL sink adapter.
 *
 * The ADCOS audit seam (`AdcosAuditSink`) is structurally identical to
 * the W011/W021/W022/W031/W040/W041 seams; W012's `createAuditSinkAdapter`
 * adapts the REAL hash-chained `AuditLog` to any structurally identical
 * seam. This suite proves:
 *   - the adapter satisfies the ADCOS seam (the type-level structural
 *     proof + the runtime flow);
 *   - consequential ADCOS mutations flow into the hash-chained log;
 *   - the chain VERIFIES (no tampering);
 *   - per-tenant chains stay SEPARATE (tenant A's records never appear
 *     in tenant B's chain);
 *   - the full consequential-mutation action set is emitted by the
 *     complete lifecycle.
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { submitConnectivityIntent, approveSubmission, rejectSubmission } from "../src/submission-gate";
import { createInMemorySubmissionStore } from "../src/submission";
import {
  createInMemoryConnectivityRecordStore,
  syncConnectivityStatus,
  terminateConnectivity,
} from "../src/adoption";
import { createInMemoryAdcosTransport } from "../src/inmemory-transport";
import type { AdcosAuditSink } from "../src/audit-seam";
import { ADCOS_SUBMISSION_ACTION } from "../src/policy-seam";
import type { ConnectivityIntentRequirements } from "../src/request-model";
import type { AdcosStatusReport } from "../src/status-model";
import type { AdcosProviderHandle } from "../src/provider-boundary";
import { asAdcosProviderHandle } from "../src/provider-boundary";
import {
  CORR,
  CORR_2,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  approvalRule,
  realGuardian,
  ruleSet,
} from "./helpers";

/** Bind the REAL audit sink adapter to the ADCOS seam (the structural proof). */
function bindSink(log: AuditLog): AdcosAuditSink {
  // This assignment type-checks ONLY if @fleetos/audit's adapter is
  // structurally compatible with the ADCOS seam.
  const sink: AdcosAuditSink = createAuditSinkAdapter(log, { source: "adcos.w050a-test" });
  return sink;
}

/** A canonical secure-private intent envelope. */
function intentFor(tenantId: typeof TENANT_A): {
  intentId: string;
  tenantId: typeof TENANT_A;
  version: number;
  createdAt: string;
  payload: { kind: string; sourceDeviceId: string; outcome: string };
} {
  return {
    intentId: `int_testtenant0${tenantId === TENANT_A ? "a" : "b"}`,
    tenantId,
    version: 1,
    createdAt: T0,
    payload: {
      kind: "ConnectivityIntent",
      sourceDeviceId: DEV_A1,
      outcome: "secure private connectivity",
    },
  };
}

/** A canonical secure-private requirement profile. */
function requirements(): ConnectivityIntentRequirements {
  return {
    properties: { isolation: "private", redundancy: "path_redundant", availabilityTarget: 0.999 },
    constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
    duration: { startAt: T0, endAt: T1 },
    budget: { budgetRef: "budget/test-quarterly", policyRefs: ["policy/test-connectivity"] },
    security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
  };
}

test("the REAL @fleetos/audit sink adapter satisfies the AdcosAuditSink seam structurally", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  expect(typeof sink.append).toBe("function");
  sink.append({
    action: "adcos.submission.proposed",
    tenantId: TENANT_A,
    subject: "adcos-sub-probe00000",
    occurredAt: T0,
    correlationId: CORR,
    details: { probe: true },
  });
  expect(log.size(makeTenantContext(TENANT_A, CORR))).toBe(1);
});

test("the full ALLOW lifecycle emits into the hash-chained AuditLog; the chain verifies", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const transport = createInMemoryAdcosTransport();
  const recordStore = createInMemoryConnectivityRecordStore();

  const submitted = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    recordStore,
    intentFor(TENANT_A),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      transport,
      auditSink: sink,
    },
  );
  expect(submitted.ok).toBe(true);
  if (!submitted.ok || submitted.connectivityRecord === null) throw new Error("setup failed");
  const connectivityId = submitted.connectivityRecord.connectivityId;
  const handle = submitted.connectivityRecord.handle;

  // A degraded status report arrives and is adopted.
  const degraded: AdcosStatusReport = {
    connectivityId,
    handle,
    executionState: "ACTIVE",
    acceptedRequirements: submitted.connectivityRecord.revisions[0].acceptedRequirements,
    measurements: [
      {
        kind: "latency_ms",
        value: 190,
        measuredAt: T1,
        evidence: { key: "evidence/adcos-lat-1", sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
      },
    ],
    degradation: { kind: "latency_degraded" },
    failure: { kind: "none" },
    termination: null,
    reportedAt: T1,
  };
  transport.pushStatusReport(degraded);
  const adopted = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  expect(adopted.ok).toBe(true);

  // Terminate.
  const terminated = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR_2, auditSink: sink },
  );
  expect(terminated.ok).toBe(true);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted", // seed
    "adcos.status.adopted", // degraded revision
    "adcos.degradation.recorded",
    "adcos.termination.requested",
    "adcos.status.adopted", // TERMINATED revision
    "adcos.termination.adopted",
  ]);
  // The hash chain verifies end-to-end.
  const verification = log.verify(ctxA);
  expect(verification.ok).toBe(true);
});

test("the parked + approved + rejected lifecycles audit into the hash-chained log", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);

  // A parked submission (REQUIRE_APPROVAL rule) approved then dispatched.
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const parked = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intentFor(TENANT_A),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, [approvalRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]),
      evaluator: realGuardian,
      transport,
      auditSink: sink,
    },
  );
  if (!parked.ok) throw new Error(parked.error.message);
  const approved = approveSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    submissionStore,
    recordStore,
    parked.record.submissionId,
    { at: T1, correlationId: CORR_2, transport, auditSink: sink },
  );
  expect(approved.ok).toBe(true);

  // A second parked submission rejected by a human.
  const parked2 = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    { ...intentFor(TENANT_A), intentId: "int_testtenant0a2" },
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, [approvalRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]),
      evaluator: realGuardian,
      transport,
      auditSink: sink,
    },
  );
  if (!parked2.ok) throw new Error(parked2.error.message);
  const rejected = rejectSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    submissionStore,
    parked2.record.submissionId,
    { at: T1, correlationId: CORR_2, auditSink: sink },
  );
  expect(rejected.ok).toBe(true);

  const actions = log.records(ctxA).map((r) => r.action);
  expect(actions).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.parked",
    "adcos.submission.approved",
    "adcos.submission.submitted",
    "adcos.status.adopted",
    "adcos.submission.proposed",
    "adcos.submission.parked",
    "adcos.submission.rejected",
  ]);
  expect(log.verify(ctxA).ok).toBe(true);
});

test("per-tenant chains stay separate: tenant B's emissions never enter tenant A's chain", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR_2);

  // Tenant A: one submitted connectivity.
  const submittedA = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intentFor(TENANT_A),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      transport: createInMemoryAdcosTransport(),
      auditSink: sink,
    },
  );
  expect(submittedA.ok).toBe(true);

  // Tenant B: one submitted connectivity (its own rule set + intent).
  const submittedB = submitConnectivityIntent(
    { tenantId: TENANT_B, correlationId: CORR_2 },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intentFor(TENANT_B),
    requirements(),
    {
      at: T0,
      correlationId: CORR_2,
      ruleSet: ruleSet(TENANT_B, []),
      evaluator: realGuardian,
      transport: createInMemoryAdcosTransport(),
      auditSink: sink,
    },
  );
  expect(submittedB.ok).toBe(true);

  // Each chain holds ONLY its own tenant's records; both verify.
  expect(log.size(ctxA)).toBe(3);
  expect(log.size(ctxB)).toBe(3);
  expect(log.records(ctxA).every((r) => r.tenantId === TENANT_A)).toBe(true);
  expect(log.records(ctxB).every((r) => (r.tenantId as string) === (TENANT_B as string))).toBe(true);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
  // The chain heads differ (separate chains).
  expect(log.head(ctxA)?.recordHash).not.toBe(log.head(ctxB)?.recordHash);
});

test("the submitted audit record carries the full policy context (decision + rule ids + reasons)", () => {
  const log = createInMemoryAuditLog();
  const sink = bindSink(log);
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const submitted = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intentFor(TENANT_A),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      transport: createInMemoryAdcosTransport(),
      auditSink: sink,
    },
  );
  expect(submitted.ok).toBe(true);
  const submittedRecord = log.records(ctxA).find((r) => r.action === "adcos.submission.submitted");
  expect(submittedRecord).toBeDefined();
  const details = submittedRecord?.details as Record<string, unknown>;
  expect(details["decision"]).toBe("ALLOW"); // the policy decision
  expect(Array.isArray(details["ruleIds"])).toBe(true); // the rule ids
  expect(Array.isArray(details["reasonCodes"])).toBe(true); // the machine-stable reasons
  expect(details["outcome"]).toBe("secure_private_connectivity");
  expect(typeof details["connectivityId"]).toBe("string");

  // The consequential properties ride the PROPOSED record's trail.
  const proposedRecord = log.records(ctxA).find((r) => r.action === "adcos.submission.proposed");
  const proposedDetails = proposedRecord?.details as Record<string, unknown>;
  expect(proposedDetails["budgetRef"]).toBe("budget/test-quarterly");
  expect(proposedDetails["policyRefCount"]).toBe(1);
  expect(proposedDetails["encryption"]).toBe("required");
  expect(proposedDetails["privateRouting"]).toBe(true);
  void asAdcosProviderHandle; // the opaque handle type is exercised across the suite
});
