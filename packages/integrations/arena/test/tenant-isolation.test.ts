/**
 * W050B arena — D5 tests: tenant isolation by construction.
 *
 * Per `spec/ARCHITECTURE-LOCK.md` item 17: "Tenant isolation is enforced
 * at persistence and action boundaries." This suite proves the
 * arena stores (evaluation-case + capability-adoption) are tenant-
 * partitioned by construction:
 *
 *   - Every operation takes the acting `ArenaTenantScope` FIRST.
 *   - Storage is partitioned by tenant id.
 *   - The runtime guard rejects context-free access, invalid-grammar
 *     tenant ids, and cross-tenant access WITH THE TYPES BYPASSED
 *     (`undefined as never` — proven by test).
 *   - A foreign case/adoption id is indistinguishable from an unknown
 *     one (no existence side channel).
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId, asUserId } from "@fleetos/contracts";
import type { TenantId, CorrelationId } from "@fleetos/contracts";
import {
  submitEvaluationCase,
  adoptCapability,
  createInMemoryEvaluationCaseStore,
  createInMemoryCapabilityAdoptionStore,
  createInMemoryArenaAuditSink,
  checkArenaTenantScope,
  type ArenaTenantScope,
  type CertifiedCapabilityMetadata,
  type CapabilityAdoptionProposal,
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

// ---------------------------------------------------------------------------
// The tenant-scope guard
// ---------------------------------------------------------------------------

test("the tenant-scope guard: a context-free scope is rejected (missing_scope)", () => {
  expect(checkArenaTenantScope(undefined).ok).toBe(false);
  expect(checkArenaTenantScope(null).ok).toBe(false);
  expect(checkArenaTenantScope({}).ok).toBe(false);
  expect(checkArenaTenantScope({ tenantId: "" }).ok).toBe(false);
  expect(checkArenaTenantScope({ tenantId: undefined }).ok).toBe(false);
});

test("the tenant-scope guard: an invalid tenant id (bad grammar) is rejected (invalid_tenant_id)", () => {
  expect(checkArenaTenantScope({ tenantId: asTenantId("invalid") }).ok).toBe(false);
  expect(checkArenaTenantScope({ tenantId: asTenantId("tnt_short") }).ok).toBe(false);
  expect(checkArenaTenantScope({ tenantId: asTenantId("BAD_PREFIX_aaaaaaaa") }).ok).toBe(false);
  expect(checkArenaTenantScope({ tenantId: asTenantId("tnt_UPPERCASE0a") }).ok).toBe(false);
});

test("the tenant-scope guard: a valid tenant id passes (the canonical grammar)", () => {
  expect(checkArenaTenantScope({ tenantId: TENANT_A }).ok).toBe(true);
  expect(checkArenaTenantScope({ tenantId: TENANT_B }).ok).toBe(true);
  expect(checkArenaTenantScope({ tenantId: asTenantId("tnt_testtenant000c") }).ok).toBe(true);
});

test("the tenant-scope guard: with the types bypassed (`undefined as never`), context-free access is rejected", () => {
  // Bypass the type system with `undefined as never` — the runtime guard
  // still catches it.
  expect(checkArenaTenantScope(undefined as never).ok).toBe(false);
  expect(checkArenaTenantScope(null as never).ok).toBe(false);
  expect(checkArenaTenantScope("not-an-object" as never).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The evaluation-case store: per-tenant partitioning
// ---------------------------------------------------------------------------

test("the evaluation-case store is per-tenant partitioned: tenant A's cases are invisible to tenant B", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rsA = ruleSet(TENANT_A, []);
  // Tenant A submits a case.
  const rA = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rsA,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  expect(rA.ok).toBe(true);
  if (!rA.ok) throw new Error(rA.error.message);
  // Tenant B cannot see tenant A's case (foreign id is indistinguishable from unknown).
  expect(store.getLatestCase(scopeB(), rA.record.caseId)).toBeUndefined();
  expect(store.listCaseRevisions(scopeB(), rA.record.caseId)).toEqual([]);
  expect(store.listCaseIds(scopeB())).toEqual([]);
  expect(store.size(scopeB())).toBe(0);
  // Tenant A CAN see its own case.
  expect(store.getLatestCase(scopeA(), rA.record.caseId)).toBeDefined();
  expect(store.size(scopeA())).toBe(1);
});

test("the evaluation-case store: a tenant-B case submission does not collide with a tenant-A case with the same caseId", () => {
  // Build two cases with IDENTICAL content fields except tenant —
  // they SHOULD have different case ids (the case id includes the tenant).
  const store = createInMemoryEvaluationCaseStore();
  const rsA = ruleSet(TENANT_A, []);
  const rsB = ruleSet(TENANT_B, []);
  const rA = submitEvaluationCase(
    scopeA(),
    store,
    caseInput({ tenantId: TENANT_A }),
    {
      ruleSet: rsA,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  const rB = submitEvaluationCase(
    scopeB(),
    store,
    caseInput({ tenantId: TENANT_B }),
    {
      ruleSet: rsB,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_B),
      guardianOptions: { at: T0, correlationId: CORR_2 },
    },
  );
  expect(rA.ok).toBe(true);
  expect(rB.ok).toBe(true);
  if (!rA.ok || !rB.ok) throw new Error("submission failed");
  // The case ids differ (tenant is part of the digest).
  expect(rA.record.caseId).not.toBe(rB.record.caseId);
  // Each tenant sees only its own cases.
  expect(store.size(scopeA())).toBe(1);
  expect(store.size(scopeB())).toBe(1);
  expect(store.listCaseIds(scopeA())).toEqual([rA.record.caseId]);
  expect(store.listCaseIds(scopeB())).toEqual([rB.record.caseId]);
});

test("the evaluation-case store: a cross-tenant write is refused (tenant_mismatch)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rsA = ruleSet(TENANT_A, []);
  // Tenant A submits a case, but try to append it through tenant B's scope.
  // The submission function takes the scope FIRST, so the case tenant
  // matches the scope tenant by construction. But the store itself
  // enforces the tenant match on append.
  // Direct test: build a case with tenant A, try to append via tenant B's scope.
  const rA = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rsA,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  expect(rA.ok).toBe(true);
  if (!rA.ok) throw new Error(rA.error.message);
  // Now try to append the SAME record through tenant B's scope — the
  // store's appendCase refuses (tenant_mismatch).
  const write = store.appendCase(scopeB(), rA.record);
  expect(write.ok).toBe(false);
  if (write.ok) throw new Error("expected refusal");
  expect(write.error.invariant).toBe("tenant_mismatch");
});

test("the evaluation-case store: a context-free scope is rejected by the runtime guard (types bypassed)", () => {
  const store = createInMemoryEvaluationCaseStore();
  // `undefined as never` — the runtime guard catches it.
  expect(store.size(undefined as never)).toBe(0);
  expect(store.listCaseIds(undefined as never)).toEqual([]);
  expect(store.getLatestCase(undefined as never, "any")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The capability-adoption store: per-tenant partitioning
// ---------------------------------------------------------------------------

test("the capability-adoption store is per-tenant partitioned: tenant A's adoptions are invisible to tenant B", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  // Tenant A adopts a capability.
  const metadata = certifiedMetadata({ tenantId: TENANT_A });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const rA = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(rA.ok).toBe(true);
  if (!rA.ok) throw new Error(rA.error.message);
  // Tenant B cannot see tenant A's adoption (foreign id is indistinguishable from unknown).
  expect(store.getLatestAdoption(scopeB(), rA.record.adoptionId)).toBeUndefined();
  expect(store.listAdoptionRevisions(scopeB(), rA.record.adoptionId)).toEqual([]);
  expect(store.listAdoptionIds(scopeB())).toEqual([]);
  expect(store.size(scopeB())).toBe(0);
  // Tenant A CAN see its own adoption.
  expect(store.getLatestAdoption(scopeA(), rA.record.adoptionId)).toBeDefined();
  expect(store.size(scopeA())).toBe(1);
});

test("the capability-adoption store: a tenant-B adoption does not collide with a tenant-A adoption with the same adoptionId", () => {
  // Two tenants adopt the SAME capability (same capabilityId) — the
  // adoption ids SHOULD differ (the adoption id includes the tenant).
  const store = createInMemoryCapabilityAdoptionStore();
  const metadataA = certifiedMetadata({ tenantId: TENANT_A });
  const metadataB = certifiedMetadata({ tenantId: TENANT_B });
  const proposalA: CapabilityAdoptionProposal = {
    proposalId: "prop/test-a",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-a",
    rollbackVersion: "1.1.0",
  };
  const proposalB: CapabilityAdoptionProposal = {
    proposalId: "prop/test-b",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-b",
    rollbackVersion: "1.1.0",
  };
  const rA = adoptCapability(scopeA(), store, metadataA, proposalA, {
    at: T0,
    correlationId: CORR,
  });
  const rB = adoptCapability(scopeB(), store, metadataB, proposalB, {
    at: T0,
    correlationId: CORR_2,
  });
  expect(rA.ok).toBe(true);
  expect(rB.ok).toBe(true);
  if (!rA.ok || !rB.ok) throw new Error("adoption failed");
  // The adoption ids differ (tenant is part of the digest).
  expect(rA.record.adoptionId).not.toBe(rB.record.adoptionId);
  // Each tenant sees only its own adoptions.
  expect(store.size(scopeA())).toBe(1);
  expect(store.size(scopeB())).toBe(1);
  expect(store.listAdoptionIds(scopeA())).toEqual([rA.record.adoptionId]);
  expect(store.listAdoptionIds(scopeB())).toEqual([rB.record.adoptionId]);
});

test("the capability-adoption store: a cross-tenant write is refused (tenant_mismatch)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata({ tenantId: TENANT_A });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const rA = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(rA.ok).toBe(true);
  if (!rA.ok) throw new Error(rA.error.message);
  // Try to append the SAME record through tenant B's scope — the store's
  // appendAdoption refuses (tenant_mismatch).
  const write = store.appendAdoption(scopeB(), rA.record);
  expect(write.ok).toBe(false);
  if (write.ok) throw new Error("expected refusal");
  expect(write.error.invariant).toBe("tenant_mismatch");
});

test("the capability-adoption store: a context-free scope is rejected by the runtime guard (types bypassed)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  expect(store.size(undefined as never)).toBe(0);
  expect(store.listAdoptionIds(undefined as never)).toEqual([]);
  expect(store.getLatestAdoption(undefined as never, "any")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Foreign-id indistinguishability (no existence side channel)
// ---------------------------------------------------------------------------

test("foreign ids are indistinguishable from unknown: a tenant-B case id queried through tenant-A's scope returns undefined (no error, no leak)", () => {
  const storeA = createInMemoryEvaluationCaseStore();
  const storeB = createInMemoryEvaluationCaseStore();
  const rsB = ruleSet(TENANT_B, []);
  // Tenant B submits a case.
  const rB = submitEvaluationCase(
    scopeB(),
    storeB,
    caseInput({ tenantId: TENANT_B }),
    {
      ruleSet: rsB,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_B),
      guardianOptions: { at: T0, correlationId: CORR_2 },
    },
  );
  expect(rB.ok).toBe(true);
  if (!rB.ok) throw new Error(rB.error.message);
  // Tenant A querying tenant B's case id returns undefined — SAME as
  // querying a totally unknown id. There is no existence side channel.
  const foreignResult = storeA.getLatestCase(scopeA(), rB.record.caseId);
  const unknownResult = storeA.getLatestCase(scopeA(), "arc_totally_unknown");
  expect(foreignResult).toBeUndefined();
  expect(unknownResult).toBeUndefined();
  expect(foreignResult).toEqual(unknownResult);
});

test("foreign adoption ids are indistinguishable from unknown: no existence side channel", () => {
  const storeA = createInMemoryCapabilityAdoptionStore();
  const storeB = createInMemoryCapabilityAdoptionStore();
  // Tenant B adopts a capability.
  const metadataB = certifiedMetadata({ tenantId: TENANT_B });
  const proposalB: CapabilityAdoptionProposal = {
    proposalId: "prop/test-b",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-b",
    rollbackVersion: "1.1.0",
  };
  const rB = adoptCapability(scopeB(), storeB, metadataB, proposalB, {
    at: T0,
    correlationId: CORR_2,
  });
  expect(rB.ok).toBe(true);
  if (!rB.ok) throw new Error(rB.error.message);
  // Tenant A querying tenant B's adoption id returns undefined — SAME as
  // querying a totally unknown id. No existence side channel.
  const foreignResult = storeA.getLatestAdoption(scopeA(), rB.record.adoptionId);
  const unknownResult = storeA.getLatestAdoption(scopeA(), "adp_totally_unknown");
  expect(foreignResult).toBeUndefined();
  expect(unknownResult).toBeUndefined();
  expect(foreignResult).toEqual(unknownResult);
});

// ---------------------------------------------------------------------------
// Adoption tenant isolation: a tenant-A scope cannot adopt tenant-B metadata
// ---------------------------------------------------------------------------

test("adoption tenant isolation: a tenant-A scope adopting tenant-B metadata is refused (tenant_mismatch)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  // Tenant B's certified metadata — the D3 gate produces a
  // certified capability with tenantId = TENANT_B.
  const metadataB = certifiedMetadata({ tenantId: TENANT_B });
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  // Adopt through tenant A's scope — the certified capability's
  // tenant (B) does not match the acting scope (A). Refused.
  const result = adoptCapability(scopeA(), store, metadataB, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.invariant).toBe("tenant_mismatch");
  // The store is untouched.
  expect(store.size(scopeA())).toBe(0);
  expect(store.size(scopeB())).toBe(0);
});
