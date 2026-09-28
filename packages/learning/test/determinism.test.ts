/**
 * W070 learning — D4 tests: byte-identical determinism across runs and
 * input permutations.
 *
 * Every deterministic surface of the package is proven stable:
 *   - outcome observations (ids, digests, records) across repeated
 *     runs AND across permuted inputs (evidence order, ref order,
 *     store insertion order);
 *   - conversion drafts + gated proposals (byte-identical JSON);
 *   - adoption records (ids, digests) + the supersession chain;
 *   - store listings are id-order stable regardless of insertion order.
 */

import { test, expect } from "bun:test";
import {
  convertOutcomeToEvaluationCase,
  createInMemoryLearningAdoptionStore,
  createInMemoryOutcomeObservationStore,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  observeHealthTreatmentOutcome,
  observeMaintenanceOutcome,
  recordCapabilityAdoption,
  recordOutcomeObservation,
  type ActionPlanFacet,
  type HealthHypothesisFacet,
  type HealthTreatmentFacet,
  type MaintenanceWorkOrderFacet,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  T0,
  T1,
  adoptionProposal,
  certifiedMetadata,
  evidenceRef,
  realGuardian,
  redaction,
  ruleSet,
  scopeA,
  caseSubmitRequest,
} from "./helpers";

/** A canonical plan facet with MULTIPLE evidence refs (for permutations). */
function planFacet(): ActionPlanFacet {
  return {
    planId: "pln_test00000001",
    tenantId: TENANT_A,
    name: "lock-fleet",
    version: 2,
    status: "APPROVED",
    capability: "lock",
    selectedTargets: [DEV_A1],
    targetCount: 1,
    createdAt: T0,
    transitionedAt: T1,
    contentDigest: "abcdef01",
    evidence: [
      evidenceRef("evidence/plan-basis-3"),
      evidenceRef("evidence/plan-basis-1"),
      evidenceRef("evidence/plan-basis-2"),
    ],
  };
}

/** A canonical hypothesis facet with permutable evidence links. */
function hypothesisFacet(): HealthHypothesisFacet {
  return {
    id: "hyp_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    causeId: "health.battery_aging",
    label: "Battery degraded",
    confidence: 0.8,
    evidence: [
      { anomalyId: "anm_test0003", observationIds: ["obs_test_0003", "obs_test_0001"] },
      { anomalyId: "anm_test0001", observationIds: ["obs_test_0001"] },
      { anomalyId: "anm_test0002", observationIds: ["obs_test_0002", "obs_test_0002"] },
    ],
    interpretationVersion: 1,
    proposedAt: T0,
  };
}

/** A canonical treatment facet. */
function treatmentFacet(): HealthTreatmentFacet {
  return {
    id: "trt_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    hypothesisId: "hyp_test00000001",
    actionId: "maintain.battery_service",
    proposedIntent: { intentKind: "MaintainDeviceIntent", payload: {} },
    confidence: 0.8,
    recommendationVersion: 1,
    proposedAt: T0,
  };
}

/** A canonical work-order facet with permutable observation ids. */
function workOrderFacet(): MaintenanceWorkOrderFacet {
  return {
    workOrderId: "swo_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    revision: 1,
    diagnosis: {
      hypothesisId: "hyp_test00000001",
      recommendationId: "trt_test00000001",
      causeId: "health.battery_aging",
      confidence: 0.8,
      observationIds: ["obs_test_0002", "obs_test_0001", "obs_test_0002"],
    },
    serviceArea: "us-east-1",
    deadline: T1,
    serviceCategory: "service.battery",
    createdAt: T0,
    contentDigest: "abcdef01",
  };
}

test("outcome observations are byte-identical across runs and across EVIDENCE-LINK permutations", () => {
  const run1 = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: {
        kind: "dismissed",
        dismissal: { hypothesisId: "hyp_test00000001", reason: "operator_rejected", dismissedAt: T1, correlationId: CORR },
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  // A permuted hypothesis: evidence links reversed + observation ids
  // within links reversed + a duplicate ref (normalization dedupes).
  const permuted: HealthHypothesisFacet = {
    ...hypothesisFacet(),
    evidence: [
      { anomalyId: "anm_test0002", observationIds: ["obs_test_0002"] },
      { anomalyId: "anm_test0001", observationIds: ["obs_test_0001"] },
      { anomalyId: "anm_test0003", observationIds: ["obs_test_0001", "obs_test_0003"] },
    ],
  };
  const run2 = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: permuted,
      recommendation: treatmentFacet(),
      decision: {
        kind: "dismissed",
        dismissal: { hypothesisId: "hyp_test00000001", reason: "operator_rejected", dismissedAt: T1, correlationId: CORR },
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  // A third run for good measure (repeated identical inputs).
  const run3 = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: {
        kind: "dismissed",
        dismissal: { hypothesisId: "hyp_test00000001", reason: "operator_rejected", dismissedAt: T1, correlationId: CORR },
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(run1.ok).toBe(true);
  expect(run2.ok).toBe(true);
  expect(run3.ok).toBe(true);
  if (!run1.ok || !run2.ok || !run3.ok) return;
  expect(JSON.stringify(run1.observation)).toBe(JSON.stringify(run2.observation));
  expect(JSON.stringify(run1.observation)).toBe(JSON.stringify(run3.observation));
});

test("evidence artifacts are normalized by key (permuted evidence produces the identical record)", () => {
  const base = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  const permuted = observeActionPlanOutcome(
    scopeA(),
    {
      plan: {
        ...planFacet(),
        evidence: [
          evidenceRef("evidence/plan-basis-2"),
          evidenceRef("evidence/plan-basis-3"),
          evidenceRef("evidence/plan-basis-1"),
        ],
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(base.ok).toBe(true);
  expect(permuted.ok).toBe(true);
  if (!base.ok || !permuted.ok) return;
  expect(JSON.stringify(base.observation)).toBe(JSON.stringify(permuted.observation));
  expect([...base.observation.observationRefs]).toEqual([
    "evidence/plan-basis-1",
    "evidence/plan-basis-2",
    "evidence/plan-basis-3",
  ]);
});

test("maintenance observations are byte-identical across OBSERVATION-ID permutations (duplicates deduped)", () => {
  const run1 = observeMaintenanceOutcome(
    scopeA(),
    { workOrder: workOrderFacet(), fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" } },
    { observedAt: T1, correlationId: CORR },
  );
  const run2 = observeMaintenanceOutcome(
    scopeA(),
    {
      workOrder: {
        ...workOrderFacet(),
        diagnosis: {
          ...workOrderFacet().diagnosis,
          observationIds: ["obs_test_0001", "obs_test_0002", "obs_test_0001"],
        },
      },
      fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(run1.ok).toBe(true);
  expect(run2.ok).toBe(true);
  if (!run1.ok || !run2.ok) return;
  expect(JSON.stringify(run1.observation)).toBe(JSON.stringify(run2.observation));
});

test("conversion drafts and gated proposals are byte-identical across runs (the full pure chain)", () => {
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  const convert = () =>
    convertOutcomeToEvaluationCase(scopeA(), observed.observation, {
      tenantPolicyRefs: ["policy/tenant-a-v1"],
      redaction: redaction(),
    });
  const a = convert();
  const b = convert();
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));

  // The gate with the SAME real decision is byte-identical too.
  const decide = () =>
    realGuardian(ruleSet(TENANT_A, []), caseSubmitRequest(TENANT_A), {
      at: T1,
      correlationId: CORR,
    });
  const decisionA = decide();
  const decisionB = decide();
  if (!decisionA.ok || !decisionB.ok) throw new Error("guardian failed");
  expect(JSON.stringify(decisionA.evaluation.decision)).toBe(
    JSON.stringify(decisionB.evaluation.decision),
  );
  const gatedA = gateEvaluationCaseProposal(scopeA(), a.draft, decisionA.evaluation.decision);
  const gatedB = gateEvaluationCaseProposal(scopeA(), b.draft, decisionB.evaluation.decision);
  expect(gatedA.ok).toBe(true);
  expect(gatedB.ok).toBe(true);
  if (!gatedA.ok || !gatedB.ok) return;
  expect(JSON.stringify(gatedA.proposal)).toBe(JSON.stringify(gatedB.proposal));
});

test("adoption records are byte-identical across runs (identity + digest stability)", () => {
  const adopt = () => {
    const store = createInMemoryLearningAdoptionStore();
    const result = recordCapabilityAdoption(
      scopeA(),
      store,
      certifiedMetadata(),
      adoptionProposal(),
      { at: T1, correlationId: CORR },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.record;
  };
  const a = adopt();
  const b = adopt();
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("store listings are ID-ORDER stable regardless of insertion order", () => {
  // Build three observations; insert in REVERSE order into one store and
  // FORWARD order into another; the listings agree byte-for-byte.
  const observed1 = observeActionPlanOutcome(
    scopeA(),
    { plan: { ...planFacet(), planId: "pln_test00000001" } },
    { observedAt: T1, correlationId: CORR },
  );
  const observed2 = observeActionPlanOutcome(
    scopeA(),
    { plan: { ...planFacet(), planId: "pln_test00000002" } },
    { observedAt: T1, correlationId: CORR },
  );
  const observed3 = observeActionPlanOutcome(
    scopeA(),
    { plan: { ...planFacet(), planId: "pln_test00000003" } },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed1.ok || !observed2.ok || !observed3.ok) throw new Error("observe failed");
  const forward = createInMemoryOutcomeObservationStore();
  for (const o of [observed1.observation, observed2.observation, observed3.observation]) {
    recordOutcomeObservation(scopeA(), forward, o);
  }
  const reverse = createInMemoryOutcomeObservationStore();
  for (const o of [observed3.observation, observed2.observation, observed1.observation]) {
    recordOutcomeObservation(scopeA(), reverse, o);
  }
  expect(JSON.stringify(forward.listObservations(scopeA()))).toBe(
    JSON.stringify(reverse.listObservations(scopeA())),
  );
  expect(JSON.stringify(forward.listObservationIds(scopeA()))).toBe(
    JSON.stringify(reverse.listObservationIds(scopeA())),
  );
});

test("the supersession chain is deterministic across runs", () => {
  const supersede = () => {
    const store = createInMemoryLearningAdoptionStore();
    const v1 = recordCapabilityAdoption(
      scopeA(),
      store,
      certifiedMetadata(),
      adoptionProposal(),
      { at: T1, correlationId: CORR },
    );
    if (!v1.ok) throw new Error(v1.error.message);
    const v2 = recordCapabilityAdoption(
      scopeA(),
      store,
      certifiedMetadata({ capabilityVersion: "1.3.0" }),
      adoptionProposal({
        proposalId: "prop/test-2",
        supersedes: v1.record.recordId,
        rollbackVersion: "1.2.0",
      }),
      { at: T1, correlationId: CORR },
    );
    if (!v2.ok) throw new Error(v2.error.message);
    return store.listAdoptionRevisions(scopeA(), v1.record.adoptionId);
  };
  const a = supersede();
  const b = supersede();
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a).toHaveLength(2);
});
