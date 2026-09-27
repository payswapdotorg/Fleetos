/**
 * W050A ADCOS — the Guardian gate through the REAL W031 engine.
 *
 * Proves the D3a structural seam end-to-end: the REAL
 * `evaluateGuardianRequest` + REAL compiled rule sets are injected at
 * the binding site, and every decision path (ALLOW / WARN /
 * REQUIRE_APPROVAL / BLOCK) routes the submission gate correctly:
 *   - ALLOW/WARN submit (WARN non-blocking, reasons riding the revision);
 *   - REQUIRE_APPROVAL parks (the transport is NEVER reached);
 *   - BLOCK rejects with the engine's machine-stable reasons;
 *   - a network-zone rule fires through the request's zone facet;
 *   - a tenant-mismatched rule set rejects the submission.
 */

import { test, expect } from "bun:test";
import {
  ADCOS_SUBMISSION_ACTION,
} from "../src/policy-seam";
import { submitConnectivityIntent, approveSubmission } from "../src/submission-gate";
import { createInMemorySubmissionStore } from "../src/submission";
import { createInMemoryConnectivityRecordStore } from "../src/adoption";
import { createInMemoryAdcosTransport } from "../src/inmemory-transport";
import { createInMemoryAdcosAuditSink } from "../src/audit-seam";
import type { ConnectivityIntentRequirements } from "../src/request-model";
import {
  CORR,
  CORR_2,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  approvalRule,
  blockRule,
  privateZoneApprovalRule,
  realGuardian,
  ruleSet,
  warnRule,
} from "./helpers";

/** A canonical secure-private intent envelope (the frozen shape). */
function intent(tenantId: typeof TENANT_A = TENANT_A): {
  intentId: string;
  tenantId: typeof TENANT_A;
  version: number;
  createdAt: string;
  payload: { kind: string; sourceDeviceId: string; outcome: string };
} {
  return {
    intentId: "int_testintent0001",
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
    properties: {
      isolation: "private",
      redundancy: "path_redundant",
      availabilityTarget: 0.999,
    },
    constraints: {
      requiredZones: ["corporate"],
      forbiddenZones: ["public"],
      egressAllowed: false,
    },
    duration: { startAt: T0, endAt: T1 },
    budget: { budgetRef: "budget/test-quarterly", policyRefs: ["policy/test-connectivity"] },
    security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
  };
}

/** The gated-submit harness with the REAL engine. */
function harness(rules: Parameters<typeof ruleSet>[1]) {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intent(),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, rules),
      evaluator: realGuardian,
      transport,
      auditSink,
    },
  );
  return { transport, submissionStore, recordStore, auditSink, result };
}

test("an empty rule set decides ALLOW through the REAL engine: the submission dispatches", () => {
  const { result, transport } = harness([]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("SUBMITTED");
  expect(transport.submissions.length).toBe(1);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("ALLOW");
  // The decision is the FROZEN GuardianDecision shape, produced by the
  // real engine (schema version, decidedAt, rules, evidence).
  expect(head.decision?.schemaVersion).toBe(1);
  expect(head.decision?.decidedAt).toBe(T0);
  expect(Array.isArray(head.decision?.rules)).toBe(true);
  expect(Array.isArray(head.decision?.evidence)).toBe(true);
});

test("a WARN rule fires through the REAL engine: the submission still dispatches with the warning context", () => {
  const { result, transport } = harness([warnRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("SUBMITTED");
  expect(transport.submissions.length).toBe(1);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("WARN");
  expect(head.reasons.some((r) => r.code === "policy.rule.matched")).toBe(true);
  expect(head.matchedRules.length).toBe(1);
});

test("a REQUIRE_APPROVAL rule parks the submission — the transport is NEVER reached", () => {
  const { result, transport, auditSink } = harness([approvalRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("PARKED");
  expect(transport.submissions.length).toBe(0);
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.parked",
  ]);
});

test("a BLOCK rule rejects the submission with the engine's machine-stable reasons", () => {
  const { result, transport, auditSink } = harness([blockRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  expect(transport.submissions.length).toBe(0);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("BLOCK");
  expect(head.matchedRules.length).toBe(1);
  const rejected = auditSink.records[1];
  expect((rejected.details as Record<string, unknown>)["ruleIds"]).toEqual([
    head.matchedRules[0].ruleId,
  ]);
});

test("a network-zone rule fires through the request's zone facet (the corporate-zone approval)", () => {
  const { result, transport } = harness([privateZoneApprovalRule(TENANT_A)]);
  // The requirement profile constrains the path to the corporate zone —
  // the gate maps it onto the engine's network facet, the rule fires.
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("PARKED");
  expect(transport.submissions.length).toBe(0);
});

test("approving a REAL-engine parked submission dispatches it", () => {
  const parked = harness([approvalRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]);
  if (!parked.result.ok) throw new Error(parked.result.error.message);
  const approved = approveSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    parked.submissionStore,
    parked.recordStore,
    parked.result.record.submissionId,
    { at: T1, correlationId: CORR_2, transport: parked.transport, auditSink: parked.auditSink },
  );
  expect(approved.ok).toBe(true);
  if (!approved.ok) throw new Error(approved.error.message);
  expect(approved.record.status).toBe("SUBMITTED");
  expect(parked.transport.submissions.length).toBe(1);
  expect(approved.connectivityRecord).not.toBeNull();
});

test("a tenant-mismatched rule set is refused by the REAL engine: the submission rejects with the engine's error", () => {
  const transport = createInMemoryAdcosTransport();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intent(),
    requirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_B, []), // foreign rule set
      evaluator: realGuardian,
      transport,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.error?.code).toBe("policy.guardian.tenant_mismatch");
  expect(transport.submissions.length).toBe(0);
});

// ---------------------------------------------------------------------------
// The frozen decision shape (produced by the REAL engine)
// ---------------------------------------------------------------------------

test("the REAL engine's decision types are the frozen GuardianDecision shape", () => {
  const { result } = harness([]);
  if (!result.ok) throw new Error(result.error.message);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision).not.toBeNull();
  expect(head.decision?.schemaVersion).toBe(1);
  expect(typeof head.decision?.decidedAt).toBe("string");
  expect(Array.isArray(head.decision?.rules)).toBe(true);
  expect(Array.isArray(head.decision?.evidence)).toBe(true);
});
