/**
 * W070 learning — D1 tests: the outcome-observation seams (unit level).
 *
 * Core invariants under test:
 *   - every observation carries tenant scope, subject ref, ground-truth
 *     label/value, evidence refs, and an INJECTED observedAt instant;
 *   - the ground-truth discipline: REFUSAL (machine-stable) whenever the
 *     source surface lacks the required annotation — never a fabricated
 *     label;
 *   - deterministic ids + content digests; normalized refs;
 *   - the tenant-partitioned append-only store (idempotency, slot
 *     occupancy) and the audited recording boundary.
 *
 * The REAL cross-surface bindings (real W021/W041/W042/W050C records
 * flowing through the seams) are proven in binding-outcomes.test.ts.
 */

import { test, expect } from "bun:test";
import { asDeviceId, asTenantId } from "@fleetos/contracts";
import {
  ACTION_PLAN_PROBLEM_CLASS,
  DELIVERY_OUTCOME_DISPOSITIONS,
  DELIVERY_PROBLEM_CLASS,
  HEALTH_TREATMENT_PROBLEM_CLASS,
  MAINTENANCE_WORK_ORDER_PROBLEM_CLASS,
  OUTCOME_SOURCE_ACTION_PLAN,
  OUTCOME_SOURCE_AURUM_DELIVERY,
  OUTCOME_SOURCE_HEALTH_TREATMENT,
  OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER,
  TERMINAL_ACTION_PLAN_OUTCOME_STATUSES,
  createInMemoryLearningAuditSink,
  createInMemoryOutcomeObservationStore,
  observeActionPlanOutcome,
  observeDeliveryOutcome,
  observeHealthTreatmentOutcome,
  observeMaintenanceOutcome,
  outcomeObservationContentDigest,
  outcomeObservationId,
  recordOutcomeObservation,
  LEARNING_AUDIT_ACTIONS,
  type ActionPlanFacet,
  type DeliveryFacet,
  type HealthDismissalFacet,
  type HealthHypothesisFacet,
  type HealthTreatmentFacet,
  type MaintenanceFulfillmentAnnotation,
  type MaintenanceWorkOrderFacet,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  atHour,
  evidenceRef,
  failuresOf,
  invariantOf,
  scopeA,
  scopeB,
} from "./helpers";

// ---------------------------------------------------------------------------
// Deterministic local facets (unit level; the binding tests use the REAL records)
// ---------------------------------------------------------------------------

function hypothesisFacet(overrides: Partial<HealthHypothesisFacet> = {}): HealthHypothesisFacet {
  return {
    id: "hyp_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    causeId: "health.battery_aging",
    label: "Battery degraded",
    confidence: 0.8,
    evidence: [
      { anomalyId: "anm_test0001", observationIds: ["obs_test_0003", "obs_test_0001"] },
      { anomalyId: "anm_test0002", observationIds: ["obs_test_0002"] },
    ],
    interpretationVersion: 1,
    proposedAt: T0,
    ...overrides,
  };
}

function treatmentFacet(overrides: Partial<HealthTreatmentFacet> = {}): HealthTreatmentFacet {
  return {
    id: "trt_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    hypothesisId: "hyp_test00000001",
    actionId: "maintain.battery_service",
    proposedIntent: {
      intentKind: "MaintainDeviceIntent",
      payload: { deviceId: DEV_A1 as string, description: "Battery replacement" },
    },
    confidence: 0.8,
    recommendationVersion: 1,
    proposedAt: T0,
    ...overrides,
  };
}

function dismissalFacet(overrides: Partial<HealthDismissalFacet> = {}): HealthDismissalFacet {
  return {
    hypothesisId: "hyp_test00000001",
    reason: "operator_rejected",
    dismissedAt: T1,
    correlationId: CORR,
    ...overrides,
  };
}

function planFacet(overrides: Partial<ActionPlanFacet> = {}): ActionPlanFacet {
  return {
    planId: "pln_test00000001",
    tenantId: TENANT_A,
    name: "lock-fleet",
    version: 2,
    status: "ADVANCED",
    capability: "lock",
    selectedTargets: [DEV_A1],
    targetCount: 1,
    createdAt: T0,
    transitionedAt: T1,
    contentDigest: "abcdef01",
    evidence: [evidenceRef("evidence/plan-basis-2"), evidenceRef("evidence/plan-basis-1")],
    ...overrides,
  };
}

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

function workOrderFacet(overrides: Partial<MaintenanceWorkOrderFacet> = {}): MaintenanceWorkOrderFacet {
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
      observationIds: ["obs_test_0002", "obs_test_0001"],
    },
    serviceArea: "us-east-1",
    deadline: T1,
    serviceCategory: "service.battery",
    createdAt: T0,
    contentDigest: "abcdef01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The health treatment seam
// ---------------------------------------------------------------------------

test("a DISMISSED treatment derives its ground truth from the recorded dismissal reason", () => {
  const result = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const observation = result.observation;
  expect(observation.tenantId).toBe(TENANT_A);
  expect(observation.sourceSurface).toBe(OUTCOME_SOURCE_HEALTH_TREATMENT);
  expect(observation.subjectRef).toBe("trt_test00000001");
  expect(observation.problemClass).toBe(HEALTH_TREATMENT_PROBLEM_CLASS);
  expect(observation.outcome).toEqual({ label: "treatment_dismissed", value: "operator_rejected" });
  expect(observation.observedAt).toBe(T1);
  // Normalized observation refs: sorted + deduplicated across evidence links.
  expect([...observation.observationRefs]).toEqual([
    "obs_test_0001",
    "obs_test_0002",
    "obs_test_0003",
  ]);
  expect([...observation.actionHistoryRefs]).toEqual(["hyp_test00000001", "trt_test00000001"]);
  expect(observation.deviceId).toBe(DEV_A1);
});

test("an ACCEPTED treatment requires observable acceptance refs (never an unobservable intent)", () => {
  // Without refs: refused machine-stably.
  const refused = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "accepted", acceptanceChannel: "service_escalation", acceptanceRefs: [] },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(failuresOf(refused.error).map((f) => f.path)).toContain("/decision/acceptanceRefs");

  // With refs: the ground truth is the acceptance channel.
  const accepted = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: {
        kind: "accepted",
        acceptanceChannel: "service_escalation",
        acceptanceRefs: ["swo_test00000001"],
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) return;
  expect(accepted.observation.outcome).toEqual({
    label: "treatment_accepted",
    value: "service_escalation",
  });
  expect(accepted.observation.context.acceptanceRefs).toEqual(["swo_test00000001"]);
});

test("the health seam refuses incoherent sources machine-stably", () => {
  // A recommendation that does not cite the hypothesis.
  const mismatch = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet({ hypothesisId: "hyp_OTHER0000001" }),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(mismatch.ok).toBe(false);
  if (mismatch.ok) return;
  expect(invariantOf(mismatch.error)).toBe("recommendation_hypothesis_mismatch");

  // A dismissal that targets a different hypothesis.
  const wrongTarget = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet({ hypothesisId: "hyp_OTHER0000001" }) },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(wrongTarget.ok).toBe(false);
  if (wrongTarget.ok) return;
  expect(invariantOf(wrongTarget.error)).toBe("dismissal_hypothesis_mismatch");

  // A tenant mismatch.
  const tenant = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet({ tenantId: TENANT_B }),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(tenant.ok).toBe(false);
  if (tenant.ok) return;
  expect(invariantOf(tenant.error)).toBe("tenant_mismatch");

  // A non-ISO injected instant.
  const badTime = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: "not-a-time", correlationId: CORR },
  );
  expect(badTime.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The action plan seam
// ---------------------------------------------------------------------------

test("a TERMINAL action plan derives its ground truth from the terminal status", () => {
  for (const status of TERMINAL_ACTION_PLAN_OUTCOME_STATUSES) {
    const result = observeActionPlanOutcome(
      scopeA(),
      { plan: planFacet({ status }) },
      { observedAt: T1, correlationId: CORR },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(result.observation.sourceSurface).toBe(OUTCOME_SOURCE_ACTION_PLAN);
    expect(result.observation.subjectRef).toBe("pln_test00000001");
    expect(result.observation.problemClass).toBe(ACTION_PLAN_PROBLEM_CLASS);
    expect(result.observation.outcome).toEqual({ label: "action_plan_outcome", value: status });
    // The plan's evidence keys are the observation refs (content-addressable).
    expect([...result.observation.observationRefs]).toEqual([
      "evidence/plan-basis-1",
      "evidence/plan-basis-2",
    ]);
    expect([...result.observation.actionHistoryRefs]).toEqual(["pln_test00000001"]);
  }
});

test("a NON-TERMINAL action plan is refused (no outcome ground truth)", () => {
  for (const status of ["PROPOSAL", "PARKED", "SOMETHING_ELSE"]) {
    const result = observeActionPlanOutcome(
      scopeA(),
      { plan: planFacet({ status }) },
      { observedAt: T1, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    expect(invariantOf(result.error)).toBe("plan_not_terminal");
  }
});

// ---------------------------------------------------------------------------
// The delivery seam
// ---------------------------------------------------------------------------

test("a TERMINAL delivery disposition derives its ground truth", () => {
  for (const disposition of DELIVERY_OUTCOME_DISPOSITIONS) {
    const state = disposition === "succeeded" ? "delivered" : "failed";
    const result = observeDeliveryOutcome(
      scopeA(),
      { delivery: deliveryFacet({ disposition, state }) },
      { observedAt: T1, correlationId: CORR },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(result.observation.sourceSurface).toBe(OUTCOME_SOURCE_AURUM_DELIVERY);
    expect(result.observation.subjectRef).toBe("aurum_msg_test0001");
    expect(result.observation.problemClass).toBe(DELIVERY_PROBLEM_CLASS);
    expect(result.observation.outcome).toEqual({ label: "message_delivery", value: disposition });
    expect([...result.observation.observationRefs]).toEqual(["aurum_msg_test0001"]);
    expect([...result.observation.actionHistoryRefs]).toEqual(["aurum_msg_test0001"]);
  }
});

test("an IN-PROGRESS delivery is refused (no terminal ground truth)", () => {
  const result = observeDeliveryOutcome(
    scopeA(),
    { delivery: deliveryFacet({ disposition: "in_progress", state: "sent" }) },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(invariantOf(result.error)).toBe("disposition_in_progress");
});

test("an UNKNOWN delivery disposition is refused", () => {
  const result = observeDeliveryOutcome(
    scopeA(),
    { delivery: deliveryFacet({ disposition: "mysterious" }) },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(invariantOf(result.error)).toBe("unknown_disposition");
});

// ---------------------------------------------------------------------------
// The maintenance seam
// ---------------------------------------------------------------------------

test("a maintenance work-order outcome carries the INJECTED fulfillment annotation as ground truth", () => {
  const fulfillment: MaintenanceFulfillmentAnnotation = {
    outcomeLabel: "service_fulfilled",
    outcomeValue: "warranty_covered",
    evidenceRefs: [evidenceRef("evidence/fulfillment-1")],
  };
  const result = observeMaintenanceOutcome(
    scopeA(),
    { workOrder: workOrderFacet(), fulfillment },
    { observedAt: T1, correlationId: CORR, evidenceRefs: [evidenceRef("evidence/extra-1")] },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.observation.sourceSurface).toBe(OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER);
  expect(result.observation.subjectRef).toBe("swo_test00000001");
  expect(result.observation.problemClass).toBe(MAINTENANCE_WORK_ORDER_PROBLEM_CLASS);
  expect(result.observation.outcome).toEqual({
    label: "service_fulfilled",
    value: "warranty_covered",
  });
  expect(result.observation.deviceId).toBe(DEV_A1);
  expect([...result.observation.observationRefs]).toEqual(["obs_test_0001", "obs_test_0002"]);
  expect([...result.observation.actionHistoryRefs]).toEqual([
    "hyp_test00000001",
    "swo_test00000001",
    "trt_test00000001",
  ]);
  // Evidence merged: fulfillment evidence + seam-option evidence, keyed + sorted.
  expect(result.observation.evidenceRefs.map((e) => e.key)).toEqual([
    "evidence/extra-1",
    "evidence/fulfillment-1",
  ]);
});

test("a maintenance work-order outcome WITHOUT an annotation is refused (never fabricated)", () => {
  const result = observeMaintenanceOutcome(
    scopeA(),
    { workOrder: workOrderFacet(), fulfillment: { outcomeLabel: "", outcomeValue: "" } },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const paths = failuresOf(result.error).map((f) => f.path);
  expect(paths).toContain("/fulfillment/outcomeLabel");
  expect(paths).toContain("/fulfillment/outcomeValue");
});

// ---------------------------------------------------------------------------
// Determinism: ids + digests + ref normalization
// ---------------------------------------------------------------------------

test("identical inputs produce identical observation ids and content digests; permuted inputs too", () => {
  const a = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  // Same facets, evidence links in a DIFFERENT order (input permutation).
  const b = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet({
        evidence: [
          { anomalyId: "anm_test0002", observationIds: ["obs_test_0002"] },
          { anomalyId: "anm_test0001", observationIds: ["obs_test_0001", "obs_test_0003"] },
        ],
      }),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.observation.observationId).toBe(b.observation.observationId);
  expect(a.observation.contentDigest).toBe(b.observation.contentDigest);
  expect(JSON.stringify(a.observation)).toBe(JSON.stringify(b.observation));

  // A different ground truth is a DIFFERENT observation (identity includes it).
  const c = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet({ reason: "stale_evidence" }) },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  expect(c.observation.observationId !== a.observation.observationId).toBe(true);

  // The identity/digest helpers agree with the seam's outputs.
  expect(a.observation.observationId).toBe(
    outcomeObservationId(
      TENANT_A,
      OUTCOME_SOURCE_HEALTH_TREATMENT,
      "trt_test00000001",
      { label: "treatment_dismissed", value: "operator_rejected" },
      T1,
    ),
  );
  const { observationId: _id, contentDigest: _digest, ...content } = a.observation;
  void _id;
  void _digest;
  expect(a.observation.contentDigest).toBe(outcomeObservationContentDigest(content));
});

test("the observation id is prefixed `loo_` and the digest is 8 lowercase hex chars", () => {
  const result = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.observation.observationId.startsWith("loo_")).toBe(true);
  expect(/^[0-9a-f]{8}$/.test(result.observation.contentDigest)).toBe(true);
});

// ---------------------------------------------------------------------------
// The store + the audited recording boundary
// ---------------------------------------------------------------------------

test("the outcome store: append is idempotent on identical content; a different content on the same id is refused", () => {
  const store = createInMemoryOutcomeObservationStore();
  const built = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const first = store.appendObservation(scopeA(), built.observation);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.created).toBe(true);
  const second = store.appendObservation(scopeA(), built.observation);
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.created).toBe(false);
  expect(second.record).toBe(first.record);
  // A different outcome on the SAME identity slot (same subject + instant,
  // different ground truth -> different digest, same id? No: the identity
  // includes the ground truth, so the id differs. To occupy the same slot we
  // need the same identity tuple with different CONTENT: e.g. a different
  // context with the same ground truth.)
  const mutated = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet({ label: "Battery severely degraded" }),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(mutated.ok).toBe(true);
  if (!mutated.ok) return;
  const base = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis: hypothesisFacet(),
      recommendation: treatmentFacet(),
      decision: { kind: "dismissed", dismissal: dismissalFacet() },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(base.ok).toBe(true);
  if (!base.ok) return;
  expect(mutated.observation.observationId).toBe(base.observation.observationId);
  expect(mutated.observation.contentDigest !== base.observation.contentDigest).toBe(true);
  store.appendObservation(scopeA(), base.observation);
  const occupied = store.appendObservation(scopeA(), mutated.observation);
  expect(occupied.ok).toBe(false);
  if (occupied.ok) return;
  expect(invariantOf(occupied.error)).toBe("observation_slot_occupied");
});

test("the recording boundary audits CREATED appends only (idempotent re-appends audit nothing)", () => {
  const store = createInMemoryOutcomeObservationStore();
  const sink = createInMemoryLearningAuditSink();
  const built = observeDeliveryOutcome(
    scopeA(),
    { delivery: deliveryFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const first = recordOutcomeObservation(scopeA(), store, built.observation, { auditSink: sink });
  expect(first.ok).toBe(true);
  expect(sink.records).toHaveLength(1);
  expect(sink.records[0].action).toBe(LEARNING_AUDIT_ACTIONS.outcomeObserved);
  expect(sink.records[0].subject).toBe(built.observation.observationId);
  expect(sink.records[0].occurredAt).toBe(built.observation.observedAt);
  const second = recordOutcomeObservation(scopeA(), store, built.observation, { auditSink: sink });
  expect(second.ok).toBe(true);
  expect(sink.records).toHaveLength(1); // no second audit
});

test("the observation store partitions by tenant (tenant B never sees tenant A's observations)", () => {
  const store = createInMemoryOutcomeObservationStore();
  const built = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  store.appendObservation(scopeA(), built.observation);
  expect(store.size(scopeA())).toBe(1);
  expect(store.size(scopeB())).toBe(0);
  expect(store.getObservation(scopeB(), built.observation.observationId)).toBeUndefined();
  expect(store.listObservationIds(scopeB())).toEqual([]);
  expect(store.listObservations(scopeB())).toEqual([]);
  // A tenant-B append of a tenant-A observation is refused.
  const cross = store.appendObservation(scopeB(), built.observation);
  expect(cross.ok).toBe(false);
});

test("facets with foreign tenants are refused before any store touch (context-free guards)", () => {
  // The tenant-scope guard itself (also covered in tenant-isolation.test.ts).
  const foreignDevice = observeMaintenanceOutcome(
    scopeA(),
    {
      workOrder: workOrderFacet({ tenantId: TENANT_B, deviceId: asDeviceId("dev_otherdevice01") }),
      fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(foreignDevice.ok).toBe(false);
  if (foreignDevice.ok) return;
  expect(invariantOf(foreignDevice.error)).toBe("tenant_mismatch");
});

test("the observedAt instant is INJECTED and never derived from the source records", () => {
  // The delivery record's ingestedAt is T1; the injected observedAt is atHour(48).
  const result = observeDeliveryOutcome(
    scopeA(),
    { delivery: deliveryFacet({ ingestedAt: T0 }) },
    { observedAt: atHour(48), correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.observation.observedAt).toBe(atHour(48));
  expect(result.observation.context.ingestedAt).toBe(T0); // evidence, verbatim
  // A tenant id with bad grammar is rejected at the guard.
  const bad = observeDeliveryOutcome(
    { tenantId: asTenantId("invalid") },
    { delivery: deliveryFacet() },
    { observedAt: atHour(48), correlationId: CORR },
  );
  expect(bad.ok).toBe(false);
});
