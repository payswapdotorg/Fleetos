/**
 * W050A ADCOS — the end-to-end binding suite.
 *
 * The structural-compatibility proofs (compile-time) plus the complete
 * lifecycle through the REAL W031 Guardian engine, the deterministic
 * reference transport, and the REAL @fleetos/audit hash-chained log:
 * translate -> gate -> submit -> adopt (degradation) -> terminate, with
 * the revision chains + audit chain verifying and byte-identical replay
 * across two independent runs.
 */

import { test, expect } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import type { GuardianRuleSet } from "@fleetos/policy";
import { evaluateGuardianRequest } from "@fleetos/policy";
import {
  createInMemoryAdcosTransport,
  providerStatusReport,
} from "../src/inmemory-transport";
import type { InMemoryAdcosTransport } from "../src/inmemory-transport";
import { submitConnectivityIntent } from "../src/submission-gate";
import { createInMemorySubmissionStore } from "../src/submission";
import {
  createInMemoryConnectivityRecordStore,
  syncConnectivityStatus,
  terminateConnectivity,
} from "../src/adoption";
import { translateConnectivityIntent } from "../src/translation";
import { isProviderNeutral } from "../src/provider-boundary";
import type { AdcosProviderHandle } from "../src/provider-boundary";
import type {
  AdcosAuditSink,
  AdcosTransportPort,
  AdcosGuardianEvaluateFn,
} from "../src/index";
import type { ConnectivityIntentRequirements, AdcosConnectivityRequest } from "../src/request-model";
import type { AcceptedConnectivityRequirements } from "../src/status-model";
import {
  CORR,
  CORR_2,
  DEV_A1,
  TENANT_A,
  T0,
  T1,
  realGuardian,
  ruleSet,
} from "./helpers";

// ---------------------------------------------------------------------------
// Compile-time structural proofs (the assignment type-checks)
// ---------------------------------------------------------------------------

test("the REAL evaluateGuardianRequest satisfies the AdcosGuardianEvaluateFn seam STRUCTURALLY", () => {
  // This assignment type-checks ONLY if the real engine's parameters
  // accept the seam's request/options (subtypes of the engine's) and its
  // return type is a subtype of the seam's outcome.
  const evaluator: AdcosGuardianEvaluateFn<GuardianRuleSet> = evaluateGuardianRequest;
  expect(typeof evaluator).toBe("function");
});

test("the reference transport satisfies the neutral AdcosTransportPort seam STRUCTURALLY", () => {
  const transport: AdcosTransportPort = createInMemoryAdcosTransport();
  expect(typeof transport.submit).toBe("function");
});

test("the REAL audit sink adapter output satisfies the AdcosAuditSink seam STRUCTURALLY", () => {
  const sink: AdcosAuditSink = createAuditSinkAdapter(createInMemoryAuditLog(), {
    source: "adcos.w050a-binding",
  });
  expect(typeof sink.append).toBe("function");
});

// ---------------------------------------------------------------------------
// The end-to-end lifecycle
// ---------------------------------------------------------------------------

/** A canonical secure-private intent envelope. */
function intent(): {
  intentId: string;
  tenantId: typeof TENANT_A;
  version: number;
  createdAt: string;
  payload: { kind: string; sourceDeviceId: string; outcome: string };
} {
  return {
    intentId: "int_testintent0001",
    tenantId: TENANT_A,
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

/** The complete lifecycle through the REAL engine + reference transport + REAL audit log. */
function runLifecycle(): {
  auditActions: string[];
  submissionRevisionDigests: string[];
  recordRevisionDigests: string[];
  submissionId: string;
  connectivityId: string;
  chainVerified: boolean;
} {
  const log = createInMemoryAuditLog();
  const sink: AdcosAuditSink = createAuditSinkAdapter(log, { source: "adcos.w050a-binding" });
  const transport: InMemoryAdcosTransport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();

  // 1. Translate (pure).
  const translation = translateConnectivityIntent(intent(), requirements(), CORR);
  if (!translation.ok) throw new Error(translation.error.message);
  const request: AdcosConnectivityRequest = translation.request;

  // 2. Gate + submit through the REAL engine.
  const submitted = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intent(),
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
  if (!submitted.ok || submitted.connectivityRecord === null) throw new Error("submit failed");
  const connectivityId = submitted.connectivityRecord.connectivityId;
  const handle = submitted.connectivityRecord.handle;

  // 3. The provider reports an ACTIVE degraded state.
  const accepted: AcceptedConnectivityRequirements =
    submitted.connectivityRecord.revisions[0].acceptedRequirements;
  transport.pushStatusReport(
    providerStatusReport({
      connectivityId,
      handle,
      executionState: "ACTIVE",
      acceptedRequirements: accepted,
      measurements: [
        {
          kind: "latency_ms",
          value: 210,
          measuredAt: T1,
          evidence: { key: "evidence/adcos-lat-1", sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
        },
      ],
      degradation: { kind: "latency_degraded", detail: "p99 above the accepted bound" },
      reportedAt: T1,
    }),
  );
  const degraded = syncConnectivityStatus(
    { tenantId: TENANT_A, correlationId: CORR },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR, auditSink: sink },
  );
  if (!degraded.ok) throw new Error(degraded.error.message);

  // 4. Terminate (tenant-initiated).
  const terminated = terminateConnectivity(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    recordStore,
    transport,
    connectivityId,
    { at: T1, correlationId: CORR_2, auditSink: sink },
  );
  if (!terminated.ok) throw new Error(terminated.error.message);

  // 5. Collect the evidence: audit actions, revision chains, chain verify.
  const ctx = makeTenantContext(TENANT_A, CORR);
  const verification = log.verify(ctx);
  const record = recordStore.get({ tenantId: TENANT_A, correlationId: CORR }, connectivityId);
  if (!record.ok) throw new Error("record vanished");
  return {
    auditActions: log.records(ctx).map((r) => r.action),
    submissionRevisionDigests: submitted.record.revisions.map((r) => r.contentDigest),
    recordRevisionDigests: record.value.revisions.map((r) => r.contentDigest),
    submissionId: submitted.record.submissionId,
    connectivityId,
    chainVerified: verification.ok,
  };
}

test("the end-to-end lifecycle runs through the REAL engine + transport + audit log; the chains verify", () => {
  const lifecycle = runLifecycle();
  expect(lifecycle.chainVerified).toBe(true);
  expect(lifecycle.submissionRevisionDigests.length).toBe(2); // PROPOSED -> SUBMITTED
  expect(lifecycle.recordRevisionDigests.length).toBe(3); // seed -> degraded -> TERMINATED
  expect(lifecycle.auditActions).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted", // seed
    "adcos.status.adopted", // degraded
    "adcos.degradation.recorded",
    "adcos.termination.requested",
    "adcos.status.adopted", // TERMINATED
    "adcos.termination.adopted",
  ]);
});

test("the lifecycle replays byte-identically (independent stores, transports, logs)", () => {
  const first = runLifecycle();
  const second = runLifecycle();
  expect(first.submissionId).toBe(second.submissionId);
  expect(first.connectivityId).toBe(second.connectivityId);
  expect(first.auditActions).toEqual(second.auditActions);
  expect(first.submissionRevisionDigests).toEqual(second.submissionRevisionDigests);
  expect(first.recordRevisionDigests).toEqual(second.recordRevisionDigests);
  expect(first.chainVerified).toBe(true);
  expect(second.chainVerified).toBe(true);
});

test("every value crossing the transport seam through the whole lifecycle is provider-neutral", () => {
  const transport = createInMemoryAdcosTransport();
  const submitted = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intent(),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      transport,
    },
  );
  if (!submitted.ok || submitted.connectivityRecord === null) throw new Error("setup failed");
  const handle: AdcosProviderHandle = submitted.connectivityRecord.handle;
  const report = transport.fetchStatus(handle, { at: T1, correlationId: CORR });
  expect(report).not.toBeNull();
  // The full walk: request (outbound), ack (inbound), report (inbound).
  expect(isProviderNeutral(transport.submissions[0].request).ok).toBe(true);
  expect(
    isProviderNeutral({
      handle,
      connectivityId: submitted.connectivityRecord.connectivityId,
      initialState: "PROVISIONING",
      acceptedRequirements: submitted.connectivityRecord.revisions[0].acceptedRequirements,
    }).ok,
  ).toBe(true);
  const reportNeutrality = isProviderNeutral(report);
  expect(reportNeutrality.ok).toBe(true);
  if (!reportNeutrality.ok) throw new Error(`${reportNeutrality.path}: ${reportNeutrality.detail}`);
  void CORR_2;
});
