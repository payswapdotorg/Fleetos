/**
 * W070 learning — D2 binding tests: the REAL W031 Contract Guardian
 * gates the proposals; the gated case flows into the REAL W050B arena
 * submission ledger.
 *
 * The closed loop's proof:
 *   1. an outcome observation converts into a draft (pure);
 *   2. the REAL Guardian engine (`@fleetos/policy`'s
 *      `evaluateGuardianRequest`, injected at the binding site) produces
 *      a FROZEN GuardianDecision;
 *   3. the learning gate projects the disposition (ALLOW/WARN ->
 *      PROPOSED, REQUIRE_APPROVAL -> PARKED, BLOCK -> REJECTED);
 *   4. the gated proposal's `case` is STRUCTURALLY ASSIGNABLE to the
 *      arena adapter's `SubmitEvaluationCaseInput` and flows through
 *      the REAL `submitEvaluationCase` into the REAL ledger;
 *   5. the dispositions CONVERGE with the arena case statuses
 *      (PROPOSED <-> SUBMITTED, PARKED <-> PARKED, REJECTED <->
 *      REJECTED) — the same Guardian decision, the same fate.
 *
 * The conversion NEVER submits: step 4 is the BINDING SITE's call (the
 * arena adapter owns the submission ledger and its own Guardian
 * routing); the learning package only produces the gated proposal.
 */

import { test, expect } from "bun:test";
import {
  submitEvaluationCase,
  createInMemoryEvaluationCaseStore,
  decisionToCaseStatus,
  type ArenaGuardianRequest,
  type SubmitEvaluationCaseInput,
} from "@fleetos/integration-arena";
import {
  CASE_PROPOSAL_PARKED,
  CASE_PROPOSAL_PROPOSED,
  CASE_PROPOSAL_REJECTED,
  convertOutcomeToEvaluationCase,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  LEARNING_AUDIT_ACTIONS,
  createInMemoryLearningAuditSink,
  type ActionPlanFacet,
  type EvaluationCaseSubmissionProposal,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  atHour,
  evidenceRef,
  invariantOf,
  realGuardian,
  redaction,
  ruleSet,
  scopeA,
  scopeB,
  approvalRule,
  blockRule,
  warnRule,
  caseSubmitRequest,
  LEARNING_CASE_ACTION,
} from "./helpers";

/** A canonical APPROVED action plan facet (deterministic). */
function planFacet(overrides: Partial<ActionPlanFacet> = {}): ActionPlanFacet {
  return {
    planId: "pln_test00000001",
    tenantId: TENANT_A,
    name: "lock-fleet",
    version: 2,
    status: "APPROVED",
    capability: "lock",
    selectedTargets: [],
    targetCount: 1,
    createdAt: T0,
    transitionedAt: T1,
    contentDigest: "abcdef01",
    evidence: [evidenceRef("evidence/plan-basis-1")],
    ...overrides,
  };
}

/** Convert a plan facet into a gated-ready draft (or throw). */
function draftFromPlan() {
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  const converted = convertOutcomeToEvaluationCase(scopeA(), observed.observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  if (!converted.ok) throw new Error(converted.error.message);
  return converted.draft;
}

/** Evaluate the REAL Guardian and return the FROZEN decision. */
function realDecision(decisionKind: "allow" | "warn" | "approval" | "block") {
  const rules =
    decisionKind === "allow"
      ? ruleSet(TENANT_A, [])
      : decisionKind === "warn"
        ? ruleSet(TENANT_A, [warnRule(TENANT_A, LEARNING_CASE_ACTION)])
        : decisionKind === "approval"
          ? ruleSet(TENANT_A, [approvalRule(TENANT_A, LEARNING_CASE_ACTION)])
          : ruleSet(TENANT_A, [blockRule(TENANT_A, LEARNING_CASE_ACTION)]);
  const request: ArenaGuardianRequest = caseSubmitRequest(TENANT_A);
  const outcome = realGuardian(rules, request, { at: T1, correlationId: CORR });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return { decision: outcome.evaluation.decision, request, rules };
}

test("the gated proposal's case is structurally assignable to the REAL arena submission input (the type-level proof)", () => {
  const draft = draftFromPlan();
  const { decision } = realDecision("allow");
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision);
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  // This assignment type-checks ONLY if the learning case facet is
  // structurally compatible with the arena adapter's submission input.
  const arenaInput: SubmitEvaluationCaseInput = gated.proposal.case;
  expect(arenaInput.problemClass).toBe(gated.proposal.case.problemClass);
  expect(arenaInput.outcome.label).toBe("action_plan_outcome");
});

test("ALLOW gates the proposal to PROPOSED and the case SUBMITS into the REAL arena ledger (convergent statuses)", () => {
  const draft = draftFromPlan();
  const { decision, request } = realDecision("allow");
  expect(decision.decision).toBe("ALLOW");
  const sink = createInMemoryLearningAuditSink();
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision, { auditSink: sink });
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  expect(gated.proposal.disposition).toBe(CASE_PROPOSAL_PROPOSED);
  expect(gated.proposal.guardianDecision).toBe(decision);
  expect(gated.proposal.tenantId).toBe(TENANT_A);
  expect(gated.proposal.sourceObservationId).toBe(draft.sourceObservationId);
  // The gate audited the disposition.
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.caseProposed);
  expect(sink.records[0].subject).toBe(gated.proposal.proposalId);

  // The BINDING SITE submits the gated case into the REAL arena ledger.
  const caseStore = createInMemoryEvaluationCaseStore();
  const submitted = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: T1, correlationId: CORR },
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) return;
  expect(submitted.record.status).toBe("SUBMITTED");
  expect(submitted.record.problemClass).toBe(gated.proposal.case.problemClass);
  expect(submitted.record.outcome.label).toBe("action_plan_outcome");
  expect(submitted.record.outcome.value).toBe("APPROVED");
  // Convergence: the learning disposition and the arena status are the
  // same Guardian decision's projections.
  expect(decisionToCaseStatus(decision.decision)).toBe("SUBMITTED");
  expect(caseStore.size(scopeA())).toBe(1);
});

test("WARN gates the proposal to PROPOSED (non-blocking; the arena case SUBMITS)", () => {
  const draft = draftFromPlan();
  const { decision } = realDecision("warn");
  expect(decision.decision).toBe("WARN");
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision);
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  expect(gated.proposal.disposition).toBe(CASE_PROPOSAL_PROPOSED);
});

test("REQUIRE_APPROVAL gates the proposal to PARKED (never auto-submitted)", () => {
  const draft = draftFromPlan();
  const { decision, request } = realDecision("approval");
  expect(decision.decision).toBe("REQUIRE_APPROVAL");
  const sink = createInMemoryLearningAuditSink();
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision, { auditSink: sink });
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  expect(gated.proposal.disposition).toBe(CASE_PROPOSAL_PARKED);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.caseParked);

  // The arena twin: the same case parks in the REAL ledger.
  const caseStore = createInMemoryEvaluationCaseStore();
  const parked = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, [approvalRule(TENANT_A, LEARNING_CASE_ACTION)]),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: T1, correlationId: CORR },
  });
  expect(parked.ok).toBe(true);
  if (!parked.ok) return;
  expect(parked.record.status).toBe("PARKED");
});

test("BLOCK gates the proposal to REJECTED (the Guardian's refusal)", () => {
  const draft = draftFromPlan();
  const { decision, request } = realDecision("block");
  expect(decision.decision).toBe("BLOCK");
  const sink = createInMemoryLearningAuditSink();
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision, { auditSink: sink });
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  expect(gated.proposal.disposition).toBe(CASE_PROPOSAL_REJECTED);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.caseRejected);

  // The arena twin: the same case is rejected in the REAL ledger.
  const caseStore = createInMemoryEvaluationCaseStore();
  const rejected = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, [blockRule(TENANT_A, LEARNING_CASE_ACTION)]),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: T1, correlationId: CORR },
  });
  expect(rejected.ok).toBe(true);
  if (!rejected.ok) return;
  expect(rejected.record.status).toBe("REJECTED");
});

test("the gate REFUSES a decision from a foreign tenant (never a wrong-tenant gate)", () => {
  const draft = draftFromPlan();
  // A tenant-B rule set + request produce a tenant-B decision.
  const foreign = realGuardian(
    ruleSet(TENANT_B, []),
    caseSubmitRequest(TENANT_B),
    { at: T1, correlationId: CORR },
  );
  if (!foreign.ok) throw new Error(foreign.error.message);
  expect(foreign.evaluation.decision.tenantId).toBe(TENANT_B);
  const gated = gateEvaluationCaseProposal(scopeA(), draft, foreign.evaluation.decision);
  expect(gated.ok).toBe(false);
  if (gated.ok) return;
  expect(invariantOf(gated.error)).toBe("tenant_mismatch");
});

test("the gate is deterministic: identical inputs produce byte-identical proposals", () => {
  const draft = draftFromPlan();
  const { decision } = realDecision("approval");
  const a = gateEvaluationCaseProposal(scopeA(), draft, decision);
  const b = gateEvaluationCaseProposal(scopeA(), draft, decision);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.proposal)).toBe(JSON.stringify(b.proposal));
  const proposal: EvaluationCaseSubmissionProposal = a.proposal;
  expect(proposal.contentDigest).toBe(b.proposal.contentDigest);
  expect(proposal.proposalId).toBe(draft.proposalId);
});

test("a full closed-loop run: outcome -> draft -> REAL Guardian -> gated proposal -> REAL arena submission, twice idempotently", () => {
  // The same proposal.case submitted twice into the arena ledger is
  // idempotent (the arena store returns the same record).
  const draft = draftFromPlan();
  const { decision, request } = realDecision("allow");
  const gated = gateEvaluationCaseProposal(scopeA(), draft, decision);
  expect(gated.ok).toBe(true);
  if (!gated.ok) return;
  const caseStore = createInMemoryEvaluationCaseStore();
  const first = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: T1, correlationId: CORR },
  });
  const second = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: T1, correlationId: CORR },
  });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(second.record.caseId).toBe(first.record.caseId);
  expect(second.record.recordId).toBe(first.record.recordId);
  expect(caseStore.size(scopeA())).toBe(1);
  // A DIFFERENT decision instant is a different content digest on the
  // same version slot — the arena append-only discipline REFUSES it
  // (version_slot_occupied). The closed loop surfaces the refusal; it
  // never rewrites the prior submission.
  const later = submitEvaluationCase(scopeA(), caseStore, gated.proposal.case, {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    request,
    guardianOptions: { at: atHour(48), correlationId: CORR },
  });
  expect(later.ok).toBe(false);
  if (later.ok) return;
  expect(later.error.kind).toBe("DomainError");
  expect(caseStore.size(scopeA())).toBe(1);
});
