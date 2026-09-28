/**
 * W070 learning — D1 binding tests: the REAL domain surfaces flow
 * through the structural seams (the W040-disclosed pattern, proven).
 *
 * The ownership gate scans only src/ files, so test files may import
 * across lanes — the established W011/W021/W031/W040/W041/W042/W050B
 * pattern. This suite drives the REAL packages end-to-end:
 *
 *   - @fleetos/health (W021): a REAL diagnosis (signals -> anomalies ->
 *     hypothesis + treatment recommendation) and a REAL dismissal flow
 *     through the health seam;
 *   - @fleetos/actions (W041): a REAL action plan created and submitted
 *     through the REAL Guardian to the ADVANCED terminal status;
 *   - @fleetos/maintenance (W042): a REAL service work order citing the
 *     REAL W021 diagnosis (the cross-surface acceptance evidence);
 *   - @fleetos/integration-aurum (W050C): a REAL outbox emission + a
 *     REAL delivered delivery record.
 *
 * The type-level proofs are the ASSIGNMENTS: passing a real
 * `DiagnosisHypothesis` where a `HealthHypothesisFacet` is expected
 * type-checks ONLY if the shapes are structurally compatible (and
 * likewise for every other facet). The runtime proofs are the derived
 * observations' contents.
 */

import { test, expect } from "bun:test";
import {
  ACTION_PLAN_PROBLEM_CLASS,
  DELIVERY_PROBLEM_CLASS,
  HEALTH_TREATMENT_PROBLEM_CLASS,
  MAINTENANCE_WORK_ORDER_PROBLEM_CLASS,
  OUTCOME_SOURCE_ACTION_PLAN,
  OUTCOME_SOURCE_AURUM_DELIVERY,
  OUTCOME_SOURCE_HEALTH_TREATMENT,
  OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER,
  observeActionPlanOutcome,
  observeDeliveryOutcome,
  observeHealthTreatmentOutcome,
  observeMaintenanceOutcome,
  recordOutcomeObservation,
  createInMemoryOutcomeObservationStore,
  type ActionPlanFacet,
  type DeliveryFacet,
  type HealthHypothesisFacet,
  type HealthTreatmentFacet,
  type MaintenanceWorkOrderFacet,
} from "../src/index";
import type { ActionPlanTemplate } from "@fleetos/actions";
import type { DeliveryRecord } from "@fleetos/integration-aurum";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import type { DiagnosisHypothesis, TreatmentRecommendation } from "@fleetos/health";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  T1,
  realAdvancedActionPlan,
  realDeliveredRecord,
  realHealthDiagnosis,
  realHealthDismissal,
  realWorkOrder,
  scopeA,
} from "./helpers";

// ---------------------------------------------------------------------------
// The type-level structural proofs (assignability of the REAL records)
// ---------------------------------------------------------------------------

test("the REAL W021 records are structurally assignable to the learning facets (the type-level proof)", () => {
  const { hypothesis, recommendation } = realHealthDiagnosis();
  // These assignments type-check ONLY if the real records satisfy the
  // structural twins.
  const hypothesisFacet: HealthHypothesisFacet = hypothesis;
  const treatmentFacet: HealthTreatmentFacet = recommendation;
  expect(hypothesisFacet.id).toBe(hypothesis.id);
  expect(treatmentFacet.id).toBe(recommendation.id);
});

test("the REAL W041 action plan is structurally assignable to the learning facet", () => {
  const plan: ActionPlanTemplate = realAdvancedActionPlan();
  const facet: ActionPlanFacet = plan;
  expect(facet.planId).toBe(plan.planId);
});

test("the REAL W050C delivery record is structurally assignable to the learning facet", () => {
  const delivery: DeliveryRecord = realDeliveredRecord();
  const facet: DeliveryFacet = delivery;
  expect(facet.messageRef).toBe(delivery.messageRef);
});

test("the REAL W042 service work order is structurally assignable to the learning facet", () => {
  const { hypothesis, recommendation, observationIds } = realHealthDiagnosis();
  const workOrder: ServiceWorkOrder = realWorkOrder(hypothesis, recommendation, observationIds);
  const facet: MaintenanceWorkOrderFacet = workOrder;
  expect(facet.workOrderId).toBe(workOrder.workOrderId);
});

// ---------------------------------------------------------------------------
// The runtime flows (the REAL records through the seams)
// ---------------------------------------------------------------------------

test("a REAL W021 dismissal flows through the health seam (ground truth = the recorded reason)", () => {
  const { hypothesis, recommendation, observationIds } = realHealthDiagnosis();
  const dismissal = realHealthDismissal(hypothesis);
  const result = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis,
      recommendation,
      decision: { kind: "dismissed", dismissal },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const observation = result.observation;
  expect(observation.sourceSurface).toBe(OUTCOME_SOURCE_HEALTH_TREATMENT);
  expect(observation.subjectRef).toBe(recommendation.id);
  expect(observation.problemClass).toBe(HEALTH_TREATMENT_PROBLEM_CLASS);
  expect(observation.outcome).toEqual({ label: "treatment_dismissed", value: "operator_rejected" });
  expect(observation.deviceId).toBe(DEV_A1);
  // The REAL observation ids behind the anomalies (normalized: sorted + dedup).
  expect([...observation.observationRefs]).toEqual([...observationIds].sort());
  expect([...observation.actionHistoryRefs]).toEqual([hypothesis.id, recommendation.id].sort());
  // The REAL context fields flow verbatim.
  expect(observation.context.causeId).toBe("health.battery_aging");
  expect(observation.context.intentKind).toBe(recommendation.proposedIntent.intentKind);
  expect(observation.context.actionId).toBe(recommendation.actionId);
});

test("the cross-surface loop: a REAL W042 work order citing the W021 recommendation IS the acceptance evidence", () => {
  const { hypothesis, recommendation, observationIds } = realHealthDiagnosis();
  const workOrder = realWorkOrder(hypothesis, recommendation, observationIds);
  // The health seam: the recommendation was ACCEPTED via the service
  // escalation (the work order is the observable consequence ref).
  const accepted = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis,
      recommendation,
      decision: {
        kind: "accepted",
        acceptanceChannel: "service_escalation",
        acceptanceRefs: [workOrder.workOrderId],
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

  // The maintenance seam: the SAME work order with an injected
  // fulfillment annotation.
  const fulfilled = observeMaintenanceOutcome(
    scopeA(),
    {
      workOrder,
      fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(fulfilled.ok).toBe(true);
  if (!fulfilled.ok) return;
  expect(fulfilled.observation.sourceSurface).toBe(OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER);
  expect(fulfilled.observation.subjectRef).toBe(workOrder.workOrderId);
  expect(fulfilled.observation.problemClass).toBe(MAINTENANCE_WORK_ORDER_PROBLEM_CLASS);
  expect(fulfilled.observation.outcome).toEqual({
    label: "service_fulfilled",
    value: "warranty_covered",
  });
  // The action history cites the FULL causal chain: hypothesis ->
  // recommendation -> work order (normalized).
  expect([...fulfilled.observation.actionHistoryRefs]).toEqual(
    [hypothesis.id, recommendation.id, workOrder.workOrderId].sort(),
  );
  // The observation refs are the REAL W021 observation ids.
  expect([...fulfilled.observation.observationRefs]).toEqual([...observationIds].sort());
  expect(fulfilled.observation.deviceId).toBe(DEV_A1);
  expect(fulfilled.observation.context.serviceCategory).toBe("service.battery");

  // Both observations record into the SAME tenant ledger.
  const store = createInMemoryOutcomeObservationStore();
  const w1 = recordOutcomeObservation(scopeA(), store, accepted.observation);
  const w2 = recordOutcomeObservation(scopeA(), store, fulfilled.observation);
  expect(w1.ok).toBe(true);
  expect(w2.ok).toBe(true);
  expect(store.size(scopeA())).toBe(2);
});

test("a REAL W041 ADVANCED plan flows through the action-plan seam", () => {
  const plan = realAdvancedActionPlan();
  const result = observeActionPlanOutcome(
    scopeA(),
    { plan },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const observation = result.observation;
  expect(observation.sourceSurface).toBe(OUTCOME_SOURCE_ACTION_PLAN);
  expect(observation.subjectRef).toBe(plan.planId);
  expect(observation.problemClass).toBe(ACTION_PLAN_PROBLEM_CLASS);
  expect(observation.outcome).toEqual({ label: "action_plan_outcome", value: "ADVANCED" });
  // The plan's evidence keys are the observation refs (content-addressable).
  expect([...observation.observationRefs]).toEqual(plan.evidence.map((e) => e.key));
  expect([...observation.actionHistoryRefs]).toEqual([plan.planId]);
  expect(observation.context.capability).toBe("lock");
  expect(observation.context.targetCount).toBe(1);
  expect(observation.context.transitionedAt).toBe(plan.transitionedAt);
});

test("a REAL W050C delivered record flows through the delivery seam", () => {
  const delivery = realDeliveredRecord();
  const result = observeDeliveryOutcome(
    scopeA(),
    { delivery },
    { observedAt: T1, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const observation = result.observation;
  expect(observation.sourceSurface).toBe(OUTCOME_SOURCE_AURUM_DELIVERY);
  expect(observation.subjectRef).toBe(delivery.messageRef);
  expect(observation.problemClass).toBe(DELIVERY_PROBLEM_CLASS);
  expect(observation.outcome).toEqual({ label: "message_delivery", value: "succeeded" });
  expect([...observation.observationRefs]).toEqual([delivery.messageRef]);
  expect(observation.context.channel).toBe("email");
  expect(observation.context.recipientRef).toBe("fleet_manager");
  expect(observation.context.deliveryAttempt).toBe(1);
  expect(observation.context.deliveryContentDigest).toBe(delivery.contentDigest);
});

test("the four surfaces coexist in one tenant ledger (the closed loop's intake)", () => {
  const { hypothesis, recommendation, observationIds } = realHealthDiagnosis();
  const workOrder = realWorkOrder(hypothesis, recommendation, observationIds);
  const dismissal = realHealthDismissal(hypothesis);
  const plan = realAdvancedActionPlan();
  const delivery = realDeliveredRecord();

  const store = createInMemoryOutcomeObservationStore();
  const flows = [
    observeHealthTreatmentOutcome(
      scopeA(),
      { hypothesis, recommendation, decision: { kind: "dismissed", dismissal } },
      { observedAt: T1, correlationId: CORR },
    ),
    observeHealthTreatmentOutcome(
      scopeA(),
      {
        hypothesis,
        recommendation,
        decision: {
          kind: "accepted",
          acceptanceChannel: "service_escalation",
          acceptanceRefs: [workOrder.workOrderId],
        },
      },
      { observedAt: T1, correlationId: CORR },
    ),
    observeActionPlanOutcome(scopeA(), { plan }, { observedAt: T1, correlationId: CORR }),
    observeDeliveryOutcome(scopeA(), { delivery }, { observedAt: T1, correlationId: CORR }),
    observeMaintenanceOutcome(
      scopeA(),
      {
        workOrder,
        fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" },
      },
      { observedAt: T1, correlationId: CORR },
    ),
  ];
  for (const flow of flows) {
    expect(flow.ok).toBe(true);
    if (!flow.ok) throw new Error(flow.error.message);
  }
  for (const flow of flows) {
    if (!flow.ok) return;
    const write = recordOutcomeObservation(scopeA(), store, flow.observation);
    expect(write.ok).toBe(true);
  }
  expect(store.size(scopeA())).toBe(flows.length);
  // Every recorded observation is tenant A's.
  const surfaces = store.listObservations(scopeA()).map((o) => o.sourceSurface).sort();
  expect(surfaces).toEqual(
    [
      OUTCOME_SOURCE_ACTION_PLAN,
      OUTCOME_SOURCE_AURUM_DELIVERY,
      OUTCOME_SOURCE_HEALTH_TREATMENT,
      OUTCOME_SOURCE_HEALTH_TREATMENT,
      OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER,
    ].sort(),
  );
  expect(store.listObservations(scopeA()).every((o) => o.tenantId === TENANT_A)).toBe(true);
});
