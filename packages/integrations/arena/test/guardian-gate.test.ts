/**
 * W050B arena — D5 tests: Guardian-gate coverage.
 *
 * Per the W050B work order: submission is PROPOSAL-gated through the W031
 * Guardian decision model — REQUIRE_APPROVAL parks, BLOCK rejects,
 * never auto-submit. This suite proves every decision path runs
 * end-to-end through the REAL Guardian engine (injected at the binding
 * site; `evaluateGuardianRequest` from `@fleetos/policy`):
 *   - ALLOW   -> SUBMITTED (the case is durable in the ledger)
 *   - WARN    -> SUBMITTED (the case is durable; warnings carried verbatim)
 *   - REQUIRE_APPROVAL -> PARKED (held for human review; never auto-submitted)
 *   - BLOCK   -> REJECTED (refused with the Guardian's machine-stable reasons)
 *
 * Also: tenant-mismatch refusals, rule-set identity tracking, matched
 * rule ids verbatim in the case record, the human-approval step for
 * PARKED cases (capability adoption's PROPOSAL gate — the
 * `CapabilityAdoptionProposal` seam).
 */

import { test, expect } from "bun:test";
import { asTenantId, isBlockingDecision } from "@fleetos/contracts";
import {
  submitEvaluationCase,
  adoptCapability,
  createInMemoryEvaluationCaseStore,
  createInMemoryCapabilityAdoptionStore,
  createInMemoryArenaAuditSink,
  CASE_SUBMITTED,
  CASE_PARKED,
  CASE_REJECTED,
  ADOPTION_ACTIVE,
  ARENA_AUDIT_ACTIONS,
  type ArenaTenantScope,
  type CapabilityAdoptionProposal,
  type CertifiedCapabilityMetadata,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  USER_1,
  USER_2,
  CORR,
  scopeA,
  scopeB,
  realGuardian,
  ruleSet,
  warnRule,
  approvalRule,
  blockRule,
  caseSubmitRequest,
  caseInput,
  certifiedMetadata,
} from "./helpers";

test("ALLOW (no rules match): the case is SUBMITTED, the decision is carried verbatim", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, []);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_SUBMITTED);
  expect(result.record.guardianDecision.decision).toBe("ALLOW");
  expect(result.record.guardianDecision.tenantId).toBe(TENANT_A);
  // The decision's rules array is empty (no rules matched).
  expect(result.record.guardianDecision.rules).toEqual([]);
  // The audit emitted `arena.case.submitted`.
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(ARENA_AUDIT_ACTIONS.caseSubmitted);
  expect(sink.records[0].details.decision).toBe("ALLOW");
  expect(sink.records[0].details.isBlocking).toBe(false);
});

test("WARN: the case is SUBMITTED, the warning rules are carried verbatim", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [warnRule(TENANT_A, "arena.case.submit")]);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_SUBMITTED);
  expect(result.record.guardianDecision.decision).toBe("WARN");
  // The matched rule is carried verbatim in the decision.
  expect(result.record.guardianDecision.rules.length).toBe(1);
  // WARN is non-blocking per the frozen isBlockingDecision helper.
  expect(isBlockingDecision(result.record.guardianDecision.decision)).toBe(false);
  expect(sink.records[0].details.decision).toBe("WARN");
  expect(sink.records[0].details.isBlocking).toBe(false);
  // The matched rule id is in the audit details.
  expect(Array.isArray(sink.records[0].details.matchedRuleIds)).toBe(true);
  expect(sink.records[0].details.matchedRuleIds.length).toBe(1);
});

test("REQUIRE_APPROVAL: the case is PARKED (held for human review; never auto-submitted)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [approvalRule(TENANT_A, "arena.case.submit")]);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_PARKED);
  expect(result.record.guardianDecision.decision).toBe("REQUIRE_APPROVAL");
  expect(isBlockingDecision(result.record.guardianDecision.decision)).toBe(true);
  expect(sink.records[0].action).toBe(ARENA_AUDIT_ACTIONS.caseParked);
  expect(sink.records[0].details.decision).toBe("REQUIRE_APPROVAL");
  expect(sink.records[0].details.isBlocking).toBe(true);
});

test("BLOCK: the case is REJECTED with the Guardian's machine-stable reasons", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [blockRule(TENANT_A, "arena.case.submit")]);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_REJECTED);
  expect(result.record.guardianDecision.decision).toBe("BLOCK");
  expect(isBlockingDecision(result.record.guardianDecision.decision)).toBe(true);
  expect(sink.records[0].action).toBe(ARENA_AUDIT_ACTIONS.caseRejected);
  expect(sink.records[0].details.decision).toBe("BLOCK");
  expect(sink.records[0].details.isBlocking).toBe(true);
  // The matched rule id is carried verbatim.
  expect(result.record.guardianDecision.rules.length).toBe(1);
});

test("tenant mismatch: a tenant-A submission against a tenant-B rule set is refused (tenant_mismatch)", () => {
  const store = createInMemoryEvaluationCaseStore();
  // Build a rule set for tenant B; submit a case from tenant A's scope.
  const rsB = ruleSet(TENANT_B, []);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rsB,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  // The Guardian engine itself rejects the request/rule-set tenant mismatch.
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.invariant).toBe("tenant_mismatch");
});

test("the acting scope's tenant mismatch with the request's tenant is refused (tenant_mismatch at the submission boundary)", () => {
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, []);
  // Scope is tenant B; request is for tenant A — mismatch at the boundary.
  const result = submitEvaluationCase(
    scopeB(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(TENANT_A),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.invariant).toBe("tenant_mismatch");
});

test("rule-set identity is tracked verbatim in the case record's audit details", () => {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const rs = ruleSet(TENANT_A, [warnRule(TENANT_A, "arena.case.submit")], 7);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // The rule-set id and version are carried verbatim in the audit details.
  expect(sink.records[0].details.ruleSetId).toBe(rs.ruleSetId);
  expect(sink.records[0].details.ruleSetVersion).toBe(7);
});

test("the submission is PROPOSAL-gated: the Guardian decision is the SOLE authority (no auto-submit path)", () => {
  // Proof: submitEvaluationCase REQUIRES the `evaluator` option (the
  // Guardian evaluation function). There is NO overload that bypasses
  // the Guardian — the case never advances without a decision.
  // This is a structural proof: the function signature has the
  // `evaluator: GuardianEvaluateFn<R>` parameter as REQUIRED.
  // The test exercises the gate end-to-end through the real engine.
  const store = createInMemoryEvaluationCaseStore();
  const rs = ruleSet(TENANT_A, [blockRule(TENANT_A, "arena.case.submit")]);
  const result = submitEvaluationCase(
    scopeA(),
    store,
    caseInput(),
    {
      ruleSet: rs,
      evaluator: realGuardian,
      request: caseSubmitRequest(),
      guardianOptions: { at: T0, correlationId: CORR },
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(CASE_REJECTED);
  // The case is REJECTED (not submitted) — the BLOCK decision prevented
  // the case from being durable as SUBMITTED. The case IS durable as
  // REJECTED (the audit trail records the refusal).
  expect(result.record.guardianDecision.decision).toBe("BLOCK");
});

test("capability adoption is PROPOSAL-gated: the proposal seam requires human approval (no auto-adopt path)", () => {
  // Proof: adoptCapability REQUIRES the `proposal` parameter (the
  // human-approved adoption proposal). The proposal carries
  // `approverId`, `approvedAt`, `proposalId` — all caller-supplied.
  // There is NO overload that adopts without a proposal.
  const store = createInMemoryCapabilityAdoptionStore();
  const sink = createInMemoryArenaAuditSink();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe(ADOPTION_ACTIVE);
  expect(result.record.approverId as string).toBe(USER_1 as string);
  expect(result.record.proposalId).toBe("prop/test-1");
  expect(result.record.approvedAt).toBe(T0);
  expect(result.record.adoptedAt).toBe(T1);
  expect(result.record.cohort).toBe("cohort/canary-1");
  expect(result.record.rollbackVersion).toBe("1.1.0");
  // The audit emitted `arena.capability.adopted`.
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(ARENA_AUDIT_ACTIONS.capabilityAdopted);
  expect(sink.records[0].details.approverId).toBe(USER_1 as string);
});

test("capability adoption: the certified capability is returned alongside the record (the D3 gate's output)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // The certified capability is returned alongside the record — the
  // D3 gate's narrowed output.
  expect(result.certified).toBeDefined();
  expect(result.certified.capabilityId).toBe(metadata.capabilityId);
  expect(result.certified.certificationRef).toBe(metadata.certificationRef);
  expect(result.certified.fleetOSCompatibilityStatement).toBe(metadata.fleetOSCompatibilityStatement);
});

test("capability adoption: a supersession requires an explicit proposal carrying the prior recordId (PROPOSAL-gated transition)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  // First adoption (version 1).
  const metadata = certifiedMetadata({ capabilityVersion: "1.2.0" });
  const proposal1: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const r1 = adoptCapability(scopeA(), store, metadata, proposal1, {
    at: T0,
    correlationId: CORR,
  });
  expect(r1.ok).toBe(true);
  if (!r1.ok) throw new Error(r1.error.message);
  expect(r1.record.version).toBe(1);
  expect(r1.record.status).toBe(ADOPTION_ACTIVE);
  // Supersession: a new proposal citing the prior recordId.
  const proposal2: CapabilityAdoptionProposal = {
    proposalId: "prop/test-2",
    approverId: USER_2,
    approvedAt: T1,
    cohort: "cohort/canary-2",
    rollbackVersion: "1.2.0",
    supersedes: r1.record.recordId,
  };
  const metadata2 = certifiedMetadata({ capabilityVersion: "1.3.0" });
  const r2 = adoptCapability(scopeA(), store, metadata2, proposal2, {
    at: T1,
    correlationId: CORR,
  });
  expect(r2.ok).toBe(true);
  if (!r2.ok) throw new Error(r2.error.message);
  expect(r2.record.version).toBe(2);
  expect(r2.record.supersedes).toBe(r1.record.recordId);
  expect(r2.record.status).toBe(ADOPTION_ACTIVE);
});

test("capability adoption: a supersession of a non-existent prior recordId is refused (supersession_target_unknown)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  const metadata = certifiedMetadata();
  const proposal: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
    supersedes: "adpv_nonexistent", // does not exist
  };
  const result = adoptCapability(scopeA(), store, metadata, proposal, {
    at: T0,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.invariant).toBe("supersession_target_unknown");
});

test("capability adoption: a non-supersession revision on an existing adoptionId is refused (supersedes_required_for_existing_adoption)", () => {
  const store = createInMemoryCapabilityAdoptionStore();
  // First adoption (version 1).
  const metadata = certifiedMetadata();
  const proposal1: CapabilityAdoptionProposal = {
    proposalId: "prop/test-1",
    approverId: USER_1,
    approvedAt: T0,
    cohort: "cohort/canary-1",
    rollbackVersion: "1.1.0",
  };
  const r1 = adoptCapability(scopeA(), store, metadata, proposal1, {
    at: T0,
    correlationId: CORR,
  });
  expect(r1.ok).toBe(true);
  if (!r1.ok) throw new Error(r1.error.message);
  // Second adoption on the SAME adoptionId WITHOUT supersedes — refused.
  const proposal2: CapabilityAdoptionProposal = {
    proposalId: "prop/test-2",
    approverId: USER_2,
    approvedAt: T1,
    cohort: "cohort/canary-2",
    rollbackVersion: "1.1.0",
    // supersedes is OMITTED — illegal on an existing adoptionId.
  };
  const r2 = adoptCapability(scopeA(), store, metadata, proposal2, {
    at: T1,
    correlationId: CORR,
  });
  expect(r2.ok).toBe(false);
  if (r2.ok) throw new Error("expected refusal");
  expect(r2.error.invariant).toBe("supersedes_required_for_existing_adoption");
});
