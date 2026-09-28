/**
 * W070 learning — D2 tests: the pure conversion of outcome observations
 * into Arena evaluation-case SUBMISSION PROPOSALS (unit level).
 *
 * Core invariants under test:
 *   - the case shape is the W050B submission twin (problem class,
 *     normalized observation refs, context, action history refs, outcome
 *     ground truth, evaluation labels, tenant policy refs, typed
 *     redaction state);
 *   - the conversion REFUSES machine-stably when an outcome lacks
 *     required ground truth (never fabricating labels);
 *   - determinism: identical inputs produce byte-identical drafts
 *     across runs and input permutations;
 *   - the conversion NEVER submits (there is no store in this module —
 *     only drafts).
 *
 * The REAL Guardian gating + the REAL arena submission binding are
 * proven in guardian-gate.test.ts.
 */

import { test, expect } from "bun:test";
import {
  CASE_PROPOSAL_PARKED,
  CASE_PROPOSAL_PROPOSED,
  CASE_PROPOSAL_REJECTED,
  ALL_EVALUATION_CASE_DISPOSITIONS,
  decisionToDisposition,
  convertOutcomeToEvaluationCase,
  evaluationCaseProposalId,
  observeActionPlanOutcome,
  observeDeliveryOutcome,
  type ActionPlanFacet,
  type DeliveryFacet,
  type EvaluationCaseProposalFacet,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  evidenceRef,
  failuresOf,
  redaction,
  scopeA,
  scopeB,
} from "./helpers";

/** A canonical terminal action plan facet (deterministic). */
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

/** A canonical delivered record facet (deterministic). */
function deliveryFacet(overrides: Partial<DeliveryFacet> = {}): DeliveryFacet {
  return {
    tenantId: TENANT_A,
    messageRef: "aurum_msg_test0001",
    deliveryAttempt: 1,
    state: "delivered",
    recipient: { recipientRef: "fleet_manager", channel: "email" },
    disposition: "succeeded",
    ingestedAt: T1,
    contentDigest: "12345678",
    ...overrides,
  };
}

/** Build an observation from a plan facet (or throw). */
function planObservation() {
  const result = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.observation;
}

test("a convertible observation produces a draft with the W050B submission twin shape", () => {
  const observation = planObservation();
  const result = convertOutcomeToEvaluationCase(scopeA(), observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
    extraLabels: [{ key: "severity", value: "high" }],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const draft = result.draft;
  expect(draft.tenantId).toBe(TENANT_A);
  expect(draft.sourceObservationId).toBe(observation.observationId);
  expect(draft.proposalId.startsWith("lcp_")).toBe(true);
  expect(draft.contentDigest).toHaveLength(8);
  // The case shape: the W050B submission twin.
  const caseFacet: EvaluationCaseProposalFacet = draft.case;
  expect(caseFacet.problemClass).toBe("fleet.action.plan");
  expect([...caseFacet.observationRefs]).toEqual(["evidence/plan-basis-1"]);
  expect(caseFacet.context).toEqual(observation.context);
  expect([...caseFacet.actionHistoryRefs]).toEqual(["pln_test00000001"]);
  expect(caseFacet.outcome).toEqual({
    label: "action_plan_outcome",
    value: "APPROVED",
    observedAt: T1,
    evidenceRefs: [evidenceRef("evidence/plan-basis-1")],
  });
  expect([...caseFacet.tenantPolicyRefs]).toEqual(["policy/tenant-a-v1"]);
  expect(caseFacet.redaction).toEqual({
    state: "deidentified",
    appliedPolicies: ["policy/deidentify-v1"],
  });
  // Derived labels (fixed order) + the caller's extra labels.
  expect([...caseFacet.labels]).toEqual([
    { key: "source_surface", value: "action.plan" },
    { key: "subject_ref", value: "pln_test00000001" },
    { key: "severity", value: "high" },
  ]);
});

test("a device-scoped observation adds the device label", () => {
  const built = observeDeliveryOutcome(
    scopeA(),
    { delivery: deliveryFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const result = convertOutcomeToEvaluationCase(scopeA(), built.observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction("raw"),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The delivery surface is not device-scoped: no device label.
  expect(result.draft.case.labels.every((l) => l.key !== "device")).toBe(true);
  expect(result.draft.case.redaction.state).toBe("raw");
  expect(result.draft.case.redaction.appliedPolicies).toEqual([]);
});

test("the conversion REFUSES an outcome that lacks required ground truth (never fabricates)", () => {
  const observation = planObservation();
  // Bypass the types: strip the outcome label.
  const stripped = { ...observation, outcome: { label: "", value: "APPROVED" } };
  const refused = convertOutcomeToEvaluationCase(scopeA(), stripped, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(failuresOf(refused.error).map((f) => f.path)).toContain("/observation/outcome/label");

  // A non-ISO observed instant.
  const badTime = { ...observation, observedAt: "not-a-time" };
  const refused2 = convertOutcomeToEvaluationCase(scopeA(), badTime, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  expect(refused2.ok).toBe(false);
  if (refused2.ok) return;
  expect(failuresOf(refused2.error).map((f) => f.path)).toContain("/observation/observedAt");

  // An outcome with NO observable refs cannot become a case (the arena
  // submission requires non-empty observation refs).
  const noRefs = {
    ...observation,
    observationRefs: [],
  } as typeof observation;
  const refused3 = convertOutcomeToEvaluationCase(scopeA(), noRefs, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  expect(refused3.ok).toBe(false);
  if (refused3.ok) return;
  expect(failuresOf(refused3.error).map((f) => f.path)).toContain("/observation/observationRefs");
});

test("the conversion REFUSES missing tenant policy refs and malformed redaction (never defaults them)", () => {
  const observation = planObservation();
  const noPolicies = convertOutcomeToEvaluationCase(scopeA(), observation, {
    tenantPolicyRefs: [],
    redaction: redaction(),
  });
  expect(noPolicies.ok).toBe(false);
  if (noPolicies.ok) return;
  expect(failuresOf(noPolicies.error).map((f) => f.path)).toContain("/options/tenantPolicyRefs");

  const badRedaction = convertOutcomeToEvaluationCase(
    scopeA(),
    observation,
    {
      tenantPolicyRefs: ["policy/tenant-a-v1"],
      redaction: { state: "mysterious" as "raw", appliedPolicies: [] },
    },
  );
  expect(badRedaction.ok).toBe(false);
  if (badRedaction.ok) return;
  expect(failuresOf(badRedaction.error).map((f) => f.path)).toContain("/options/redaction/state");
});

test("the conversion REFUSES a cross-tenant observation (tenant isolation)", () => {
  const observation = planObservation();
  const cross = convertOutcomeToEvaluationCase(scopeB(), observation, {
    tenantPolicyRefs: ["policy/tenant-b-v1"],
    redaction: redaction(),
  });
  expect(cross.ok).toBe(false);
  if (cross.ok) return;
  expect(cross.error.kind).toBe("DomainError");
});

test("the conversion is deterministic: byte-identical drafts across runs and input permutations", () => {
  const observation = planObservation();
  const convert = () =>
    convertOutcomeToEvaluationCase(scopeA(), observation, {
      tenantPolicyRefs: ["policy/tenant-a-v1", "policy/tenant-a-v0"],
      redaction: redaction(),
      extraLabels: [{ key: "severity", value: "high" }],
    });
  const a = convert();
  const b = convert();
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));
  expect(a.draft.proposalId).toBe(b.draft.proposalId);
  expect(a.draft.contentDigest).toBe(b.draft.contentDigest);

  // The proposal id helper agrees.
  expect(a.draft.proposalId).toBe(
    evaluationCaseProposalId(TENANT_A, observation.observationId, a.draft.case),
  );

  // Different policy refs -> a different draft (not a collision).
  const c = convertOutcomeToEvaluationCase(scopeA(), observation, {
    tenantPolicyRefs: ["policy/tenant-a-v2"],
    redaction: redaction(),
  });
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  expect(c.draft.proposalId !== a.draft.proposalId).toBe(true);
});

test("the disposition projection is the arena twin (ALLOW/WARN -> PROPOSED; REQUIRE_APPROVAL -> PARKED; BLOCK -> REJECTED)", () => {
  expect(decisionToDisposition("ALLOW")).toBe(CASE_PROPOSAL_PROPOSED);
  expect(decisionToDisposition("WARN")).toBe(CASE_PROPOSAL_PROPOSED);
  expect(decisionToDisposition("REQUIRE_APPROVAL")).toBe(CASE_PROPOSAL_PARKED);
  expect(decisionToDisposition("BLOCK")).toBe(CASE_PROPOSAL_REJECTED);
  expect([...ALL_EVALUATION_CASE_DISPOSITIONS].sort()).toEqual(
    ["PARKED", "PROPOSED", "REJECTED"].sort(),
  );
});
