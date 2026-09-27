/**
 * @fleetos/integration-adcos — D4: exhaustive tenant-isolation tests.
 *
 * Tenant isolation BY CONSTRUCTION: tenant-first scopes, per-tenant
 * partitions, runtime guards rejecting context-free/invalid-grammar
 * access with the types bypassed, cross-tenant access refused with
 * machine-stable reasons, foreign ids INDISTINGUISHABLE from unknown.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import type { TenantId } from "@fleetos/contracts";
import { createInMemorySubmissionStore } from "./submission";
import {
  adoptConnectivityStatus,
  createInMemoryConnectivityRecordStore,
  syncConnectivityStatus,
  terminateConnectivity,
} from "./adoption";
import { submitConnectivityIntent, approveSubmission } from "./submission-gate";
import { createInMemoryAdcosAuditSink } from "./audit-seam";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  connectivityIntent,
  degradedActiveReport,
  domainErrorOf,
  localGuardian,
  ruleset,
  securePrivateRequirements,
} from "./test-support";

/** Submit one ALLOW flow for the given tenant; returns the connectivity id. */
function submitFor(tenantId: TenantId): {
  submissionStore: ReturnType<typeof createInMemorySubmissionStore>;
  recordStore: ReturnType<typeof createInMemoryConnectivityRecordStore>;
  connectivityId: string;
  submissionId: string;
  handle: string;
} {
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const result = submitConnectivityIntent(
    { tenantId, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", tenantId }),
    securePrivateRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleset("ALLOW", tenantId),
      evaluator: localGuardian,
      transport: createInMemoryAdcosTransport(),
    },
  );
  if (!result.ok || result.connectivityRecord === null) throw new Error("setup failed");
  return {
    submissionStore,
    recordStore,
    connectivityId: result.connectivityRecord.connectivityId,
    submissionId: result.record.submissionId,
    handle: result.connectivityRecord.handle,
  };
}

// ---------------------------------------------------------------------------
// Runtime guards (types bypassed)
// ---------------------------------------------------------------------------

test("a missing tenant scope is rejected by the stores with the types bypassed", () => {
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const noScopeSubmission = submissionStore.get(undefined as never, "adcos-sub-x");
  const noScopeRecord = recordStore.get(null as never, "adcos-c-x");
  expect(noScopeSubmission.ok).toBe(false);
  expect(noScopeRecord.ok).toBe(false);
  if (!noScopeSubmission.ok) {
    expect(domainErrorOf(noScopeSubmission.error).invariant).toBe("missing_scope");
  }
  if (!noScopeRecord.ok) {
    expect(domainErrorOf(noScopeRecord.error).invariant).toBe("missing_scope");
  }
  expect(submissionStore.list({} as never)).toEqual([]);
  expect(recordStore.list({} as never)).toEqual([]);
});

test("an invalid-grammar tenant id is rejected by the stores (frozen canonical grammar)", () => {
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const bad = { tenantId: asTenantId("not-a-tenant"), correlationId: CORR };
  const badSubmission = submissionStore.get(bad, "adcos-sub-x");
  const badRecord = recordStore.get(bad, "adcos-c-x");
  expect(badSubmission.ok).toBe(false);
  expect(badRecord.ok).toBe(false);
  if (!badSubmission.ok) {
    expect(domainErrorOf(badSubmission.error).invariant).toBe("invalid_tenant_id");
  }
  if (!badRecord.ok) {
    expect(domainErrorOf(badRecord.error).invariant).toBe("invalid_tenant_id");
  }
});

// ---------------------------------------------------------------------------
// Foreign ids are indistinguishable from unknown
// ---------------------------------------------------------------------------

test("a foreign submission id is indistinguishable from an unknown one (submission store)", () => {
  const a = submitFor(TENANT_A);
  const foreign = a.submissionStore.get({ tenantId: TENANT_B, correlationId: CORR }, a.submissionId);
  const unknown = a.submissionStore.get({ tenantId: TENANT_B, correlationId: CORR }, "adcos-sub-unknown0");
  expect(foreign.ok).toBe(false);
  expect(unknown.ok).toBe(false);
  // IDENTICAL error results — no tenant oracle.
  if (foreign.ok || unknown.ok) throw new Error("expected refusals");
  expect(JSON.stringify(foreign.error)).toBe(JSON.stringify(unknown.error));
  // Tenant B sees nothing.
  expect(a.submissionStore.list({ tenantId: TENANT_B, correlationId: CORR })).toEqual([]);
  expect(a.submissionStore.list({ tenantId: TENANT_A, correlationId: CORR }).length).toBe(1);
});

test("a foreign connectivity id is indistinguishable from an unknown one (record store + flows)", () => {
  const a = submitFor(TENANT_A);
  const b = submitFor(TENANT_B);

  // Record store: tenant B cannot read tenant A's connectivity.
  const foreignRead = a.recordStore.get({ tenantId: TENANT_B, correlationId: CORR }, a.connectivityId);
  const unknownRead = a.recordStore.get({ tenantId: TENANT_B, correlationId: CORR }, "adcos-c-unknown000");
  expect(foreignRead.ok).toBe(false);
  expect(unknownRead.ok).toBe(false);
  if (foreignRead.ok || unknownRead.ok) throw new Error("expected refusals");
  expect(JSON.stringify(foreignRead.error)).toBe(JSON.stringify(unknownRead.error));

  // Sync flow: tenant B cannot sync tenant A's connectivity (same error as unknown).
  const foreignSync = syncConnectivityStatus(
    { tenantId: TENANT_B, correlationId: CORR },
    a.recordStore,
    createInMemoryAdcosTransport(),
    a.connectivityId,
    { at: T0, correlationId: CORR },
  );
  expect(foreignSync.ok).toBe(false);
  if (!foreignSync.ok) {
    expect((foreignSync.error as { invariant?: string }).invariant).toBe("not_found");
  }

  // Terminate flow: tenant B cannot terminate tenant A's connectivity.
  const foreignTerminate = terminateConnectivity(
    { tenantId: TENANT_B, correlationId: CORR },
    a.recordStore,
    createInMemoryAdcosTransport(),
    a.connectivityId,
    { at: T0, correlationId: CORR },
  );
  expect(foreignTerminate.ok).toBe(false);
  if (!foreignTerminate.ok) {
    expect((foreignTerminate.error as { invariant?: string }).invariant).toBe("not_found");
  }
});

test("approving a foreign submission is refused (indistinguishable from unknown)", () => {
  const a = submitFor(TENANT_A);
  const approve = approveSubmission(
    { tenantId: TENANT_B, correlationId: CORR },
    a.submissionStore,
    a.recordStore,
    a.submissionId,
    { at: T0, correlationId: CORR, transport: createInMemoryAdcosTransport() },
  );
  expect(approve.ok).toBe(false);
  if (!approve.ok) expect(domainErrorOf(approve.error).invariant).toBe("not_found");
});

// ---------------------------------------------------------------------------
// Partition hygiene
// ---------------------------------------------------------------------------

test("per-tenant partitions never leak: two tenants, two records, disjoint lists", () => {
  const a = submitFor(TENANT_A);
  const b = submitFor(TENANT_B);
  const listA = a.recordStore.list({ tenantId: TENANT_A, correlationId: CORR });
  const listB = b.recordStore.list({ tenantId: TENANT_B, correlationId: CORR });
  expect(listA.length).toBe(1);
  expect(listB.length).toBe(1);
  expect(listA[0].connectivityId).not.toBe(listB[0].connectivityId);
  expect(listA[0].tenantId).toBe(TENANT_A);
  expect(listB[0].tenantId).toBe(TENANT_B);
  // Same intent content, different tenants -> different submission ids
  // (the identity digest is tenant-scoped).
  expect(a.submissionId).not.toBe(b.submissionId);
});

test("cross-tenant adoption is refused: tenant B cannot adopt a report for tenant A's connectivity", () => {
  const a = submitFor(TENANT_A);
  const report = degradedActiveReport(a.connectivityId, a.handle as never, T0);
  const adopted = adoptConnectivityStatus(
    { tenantId: TENANT_B, correlationId: CORR },
    a.recordStore,
    report,
    { at: T0 },
  );
  expect(adopted.ok).toBe(false);
  if (!adopted.ok) {
    expect((adopted.error as { invariant?: string }).invariant).toBe("not_found");
  }
  // Tenant A's record is untouched.
  const after = a.recordStore.get({ tenantId: TENANT_A, correlationId: CORR }, a.connectivityId);
  if (after.ok) expect(after.value.revisions.length).toBe(1);
});

// ---------------------------------------------------------------------------
// The gate's own tenancy
// ---------------------------------------------------------------------------

test("the submission gate refuses a scope whose tenant fails the canonical grammar (types bypassed)", () => {
  const result = submitConnectivityIntent(
    { tenantId: asTenantId("bad"), correlationId: CORR } as never,
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    securePrivateRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleset("ALLOW"),
      evaluator: localGuardian,
      transport: createInMemoryAdcosTransport(),
      auditSink: createInMemoryAdcosAuditSink(),
    },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(domainErrorOf(result.error).invariant).toBe("invalid_tenant_id");
});
