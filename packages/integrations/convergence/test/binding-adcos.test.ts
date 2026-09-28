/**
 * W051 convergence — D1: contract compatibility, ADCOS binding.
 *
 * Binds the REAL @fleetos/integration-adcos surface to the REAL W031
 * Contract Guardian engine (@fleetos/policy) with REAL rule sets — the
 * tech-lead-owned convergence proof that the guardian-gated ADCOS
 * submission flow behaves invariantly at the binding site:
 *
 *   - an empty rule set decides ALLOW: the submission dispatches (the
 *     transport is reached);
 *   - a REQUIRE_APPROVAL rule PARKS the submission — the transport is
 *     NEVER reached (never auto-executes);
 *   - a BLOCK rule REJECTS with the engine's machine-stable reasons;
 *   - a cross-tenant rule set is REFUSED (tenant scoping everywhere);
 *   - the REAL identity TenantContext passes the convergence scope
 *     guard (the structural-scope proof);
 *   - the consequential mutations are audited to the REAL audit log
 *     through the REAL sink adapter.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import { createAuditSinkAdapter } from "@fleetos/audit";
import {
  ADCOS_SUBMISSION_ACTION,
  submitConnectivityIntent,
  createInMemorySubmissionStore,
  createInMemoryConnectivityRecordStore,
  createInMemoryAdcosTransport,
} from "@fleetos/integration-adcos";
import {
  T0,
  TENANT_A,
  TENANT_B,
  CORR,
  REAL_SCOPE_CHECK,
  adcosHarness,
  connectivityIntent,
  connectivityRequirements,
  realCtx,
  realAuditLog,
  realGuardianAdcos,
  ruleSet,
  approvalRule,
  blockRule,
} from "./helpers";

test("D1/adcos: the REAL identity TenantContext satisfies the convergence scope guard", () => {
  expect(REAL_SCOPE_CHECK.ok).toBe(true);
  if (!REAL_SCOPE_CHECK.ok) throw new Error(REAL_SCOPE_CHECK.reason);
  expect(REAL_SCOPE_CHECK.tenantId).toBe(TENANT_A);
});

test("D1/adcos: an empty rule set decides ALLOW through the REAL engine — the submission dispatches", () => {
  const { result, transport } = adcosHarness([]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("SUBMITTED");
  expect(transport.submissions.length).toBe(1);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("ALLOW");
  // The decision is the FROZEN GuardianDecision shape from the real engine.
  expect(head.decision?.schemaVersion).toBe(1);
  expect(head.decision?.decidedAt).toBe(T0);
});

test("D1/adcos: REQUIRE_APPROVAL parks the submission — the transport is NEVER reached", () => {
  const { result, transport, auditSink } = adcosHarness([
    approvalRule(TENANT_A, ADCOS_SUBMISSION_ACTION),
  ]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("PARKED");
  expect(transport.submissions.length).toBe(0);
  expect(auditSink.records.map((r) => r.action)).toContain("adcos.submission.parked");
});

test("D1/adcos: BLOCK rejects the submission with the engine's machine-stable reasons", () => {
  const { result, transport } = adcosHarness([blockRule(TENANT_A, ADCOS_SUBMISSION_ACTION)]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  expect(transport.submissions.length).toBe(0);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("BLOCK");
});

test("D1/adcos: a tenant-B rule set is refused by the REAL engine (tenant scoping)", () => {
  const transport = createInMemoryAdcosTransport();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    connectivityIntent(TENANT_A),
    connectivityRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_B, []), // foreign rule set
      evaluator: realGuardianAdcos,
      transport,
    },
  );
  // The engine's rejection rides the submission record: REJECTED with
  // the machine-stable tenant_mismatch code — never a wrong-tenant decision.
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.error?.code).toBe("policy.guardian.tenant_mismatch");
  expect(transport.submissions.length).toBe(0);
});

test("D1/adcos: the consequential mutations ride the REAL audit log through the REAL sink adapter", () => {
  const log = realAuditLog();
  const sink = createAuditSinkAdapter(log, { source: "integration-convergence.adcos" });
  const transport = createInMemoryAdcosTransport();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    connectivityIntent(TENANT_A),
    connectivityRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardianAdcos,
      transport,
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  // The REAL @fleetos/audit log accepted the adapter's audit emissions.
  const records = log.records(realCtx(TENANT_A, CORR));
  expect(records.length).toBeGreaterThan(0);
  expect(records.some((r) => r.source === "integration-convergence.adcos")).toBe(true);
});
