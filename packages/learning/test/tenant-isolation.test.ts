/**
 * W070 learning — D4 tests: tenant isolation by construction.
 *
 * Per `spec/ARCHITECTURE-LOCK.md` item 17: "Tenant isolation is
 * enforced at persistence and action boundaries." This suite proves
 * the learning package's surfaces are tenant-partitioned by
 * construction:
 *
 *   - Every operation takes the acting `LearningTenantScope` FIRST.
 *   - Storage is partitioned by tenant id (both stores).
 *   - The runtime guard rejects context-free access, invalid-grammar
 *     tenant ids, and cross-tenant access WITH THE TYPES BYPASSED
 *     (`undefined as never` — proven by test).
 *   - A foreign observation/adoption id is indistinguishable from an
 *     unknown one (no existence side channel).
 *   - Every seam refuses a facet whose tenant does not match the
 *     acting scope (fail-closed `tenant_mismatch`).
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId } from "@fleetos/contracts";
import {
  checkLearningTenantScope,
  convertOutcomeToEvaluationCase,
  createInMemoryLearningAdoptionStore,
  createInMemoryOutcomeObservationStore,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  observeDeliveryOutcome,
  observeHealthTreatmentOutcome,
  observeMaintenanceOutcome,
  recordCapabilityAdoption,
  recordOutcomeObservation,
  type ActionPlanFacet,
  type DeliveryFacet,
  type HealthHypothesisFacet,
  type HealthTreatmentFacet,
  type MaintenanceWorkOrderFacet,
} from "../src/index";
import {
  CORR,
  DEV_A1,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  adoptionProposal,
  certifiedMetadata,
  evidenceRef,
  invariantOf,
  redaction,
  scopeA,
  scopeB,
} from "./helpers";

// ---------------------------------------------------------------------------
// The tenant-scope guard
// ---------------------------------------------------------------------------

test("the tenant-scope guard: a context-free scope is rejected (missing_scope)", () => {
  expect(checkLearningTenantScope(undefined).ok).toBe(false);
  expect(checkLearningTenantScope(null).ok).toBe(false);
  expect(checkLearningTenantScope({}).ok).toBe(false);
  expect(checkLearningTenantScope({ tenantId: "" }).ok).toBe(false);
  expect(checkLearningTenantScope({ tenantId: undefined }).ok).toBe(false);
});

test("the tenant-scope guard: an invalid tenant id (bad grammar) is rejected (invalid_tenant_id)", () => {
  expect(checkLearningTenantScope({ tenantId: asTenantId("invalid") }).ok).toBe(false);
  expect(checkLearningTenantScope({ tenantId: asTenantId("tnt_short") }).ok).toBe(false);
  expect(checkLearningTenantScope({ tenantId: asTenantId("BAD_PREFIX_aaaaaaaa") }).ok).toBe(false);
  expect(checkLearningTenantScope({ tenantId: asTenantId("tnt_UPPERCASE0a") }).ok).toBe(false);
});

test("the tenant-scope guard: a valid tenant id passes (the canonical grammar)", () => {
  expect(checkLearningTenantScope({ tenantId: TENANT_A }).ok).toBe(true);
  expect(checkLearningTenantScope({ tenantId: TENANT_B }).ok).toBe(true);
  expect(checkLearningTenantScope({ tenantId: asTenantId("tnt_testtenant000c") }).ok).toBe(true);
});

test("the tenant-scope guard: with the types bypassed (`undefined as never`), context-free access is rejected", () => {
  // Bypass the type system with `undefined as never` — the runtime guard
  // still catches it.
  expect(checkLearningTenantScope(undefined as never).ok).toBe(false);
  expect(checkLearningTenantScope(null as never).ok).toBe(false);
  expect(checkLearningTenantScope("not-an-object" as never).ok).toBe(false);
  expect(checkLearningTenantScope(42 as never).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The seams: cross-tenant facets are refused
// ---------------------------------------------------------------------------

/** A canonical APPROVED plan facet for tenant A. */
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
    evidence: [evidenceRef("evidence/plan-basis-1")],
  };
}

test("every seam refuses a facet from a foreign tenant (fail-closed tenant_mismatch)", () => {
  // The action plan seam.
  const plan = observeActionPlanOutcome(scopeA(), { plan: planFacet() }, {
    observedAt: T1,
    correlationId: CORR,
  });
  expect(plan.ok).toBe(true);

  // The delivery seam.
  const delivery: DeliveryFacet = {
    tenantId: TENANT_A,
    messageRef: "aurum_msg_test0001",
    deliveryAttempt: 1,
    state: "delivered",
    recipient: { recipientRef: "fleet_manager", channel: "email" },
    disposition: "succeeded",
    ingestedAt: T1,
    contentDigest: "12345678",
  };
  const delivered = observeDeliveryOutcome(scopeA(), { delivery }, {
    observedAt: T1,
    correlationId: CORR,
  });
  expect(delivered.ok).toBe(true);

  // The health seam.
  const hypothesis: HealthHypothesisFacet = {
    id: "hyp_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    causeId: "health.battery_aging",
    label: "Battery degraded",
    confidence: 0.8,
    evidence: [{ anomalyId: "anm_test0001", observationIds: ["obs_test_0001"] }],
    interpretationVersion: 1,
    proposedAt: T0,
  };
  const recommendation: HealthTreatmentFacet = {
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
  const dismissed = observeHealthTreatmentOutcome(
    scopeA(),
    {
      hypothesis,
      recommendation,
      decision: {
        kind: "dismissed",
        dismissal: { hypothesisId: "hyp_test00000001", reason: "operator_rejected", dismissedAt: T1, correlationId: CORR },
      },
    },
    { observedAt: T1, correlationId: CORR },
  );
  expect(dismissed.ok).toBe(true);

  // The maintenance seam.
  const workOrder: MaintenanceWorkOrderFacet = {
    workOrderId: "swo_test00000001",
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    revision: 1,
    diagnosis: {
      hypothesisId: "hyp_test00000001",
      recommendationId: "trt_test00000001",
      causeId: "health.battery_aging",
      confidence: 0.8,
      observationIds: ["obs_test_0001"],
    },
    serviceArea: "us-east-1",
    deadline: T1,
    serviceCategory: "service.battery",
    createdAt: T0,
    contentDigest: "abcdef01",
  };
  const maintained = observeMaintenanceOutcome(
    scopeA(),
    { workOrder, fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" } },
    { observedAt: T1, correlationId: CORR },
  );
  expect(maintained.ok).toBe(true);

  // ALL of them refuse under tenant B's scope with the types BYPASSED
  // (a tenant-B actor cannot derive a tenant-A outcome).
  expect(invariantOf((observeActionPlanOutcome(scopeB(), { plan: planFacet() }, { observedAt: T1, correlationId: CORR }) as { ok: false; error: import("@fleetos/contracts").FleetError }).error)).toBe("tenant_mismatch");
  expect(invariantOf((observeDeliveryOutcome(scopeB(), { delivery }, { observedAt: T1, correlationId: CORR }) as { ok: false; error: import("@fleetos/contracts").FleetError }).error)).toBe("tenant_mismatch");
  expect(
    invariantOf(
      (
        observeHealthTreatmentOutcome(
          scopeB(),
          {
            hypothesis,
            recommendation,
            decision: {
              kind: "dismissed",
              dismissal: { hypothesisId: "hyp_test00000001", reason: "operator_rejected", dismissedAt: T1, correlationId: CORR },
            },
          },
          { observedAt: T1, correlationId: CORR },
        ) as { ok: false; error: import("@fleetos/contracts").FleetError }
      ).error,
    ),
  ).toBe("tenant_mismatch");
  expect(
    invariantOf(
      (
        observeMaintenanceOutcome(
          scopeB(),
          { workOrder, fulfillment: { outcomeLabel: "service_fulfilled", outcomeValue: "warranty_covered" } },
          { observedAt: T1, correlationId: CORR },
        ) as { ok: false; error: import("@fleetos/contracts").FleetError }
      ).error,
    ),
  ).toBe("tenant_mismatch");
});

// ---------------------------------------------------------------------------
// The stores: per-tenant partitioning + no existence side channel
// ---------------------------------------------------------------------------

test("the outcome store: a context-free scope is refused; foreign ids are indistinguishable from unknown", () => {
  const store = createInMemoryOutcomeObservationStore();
  // Context-free access (types bypassed).
  expect(store.appendObservation(undefined as never, {} as never).ok).toBe(false);
  expect(store.getObservation(undefined as never, "loo_any")).toBeUndefined();
  expect(store.listObservationIds(undefined as never)).toEqual([]);
  expect(store.listObservations(undefined as never)).toEqual([]);
  expect(store.size(undefined as never)).toBe(0);
  // An invalid-grammar tenant scope is refused.
  expect(store.size({ tenantId: asTenantId("invalid") })).toBe(0);

  // Tenant A records an observation; tenant B cannot see it (a foreign
  // id is indistinguishable from an unknown one).
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  recordOutcomeObservation(scopeA(), store, observed.observation);
  expect(store.getObservation(scopeB(), observed.observation.observationId)).toBeUndefined();
  expect(store.getObservation(scopeA(), "loo_unknown0000")).toBeUndefined();
  expect(store.size(scopeB())).toBe(0);
});

test("the adoption store: a context-free scope is refused; foreign ids are indistinguishable from unknown", () => {
  const store = createInMemoryLearningAdoptionStore();
  // Context-free access (types bypassed).
  expect(store.appendAdoption(undefined as never, {} as never).ok).toBe(false);
  expect(store.getLatestAdoption(undefined as never, "adp_any")).toBeUndefined();
  expect(store.getAdoptionRevision(undefined as never, "adp_any", 1)).toBeUndefined();
  expect(store.listAdoptionRevisions(undefined as never, "adp_any")).toEqual([]);
  expect(store.listAdoptionIds(undefined as never)).toEqual([]);
  expect(store.size(undefined as never)).toBe(0);
  expect(store.size({ tenantId: asTenantId("invalid") })).toBe(0);

  // Tenant A adopts; tenant B cannot see the adoption.
  const adopted = recordCapabilityAdoption(
    scopeA(),
    store,
    certifiedMetadata(),
    adoptionProposal(),
    { at: T1, correlationId: CORR },
  );
  if (!adopted.ok) throw new Error(adopted.error.message);
  expect(store.getLatestAdoption(scopeB(), adopted.record.adoptionId)).toBeUndefined();
  expect(store.getAdoptionRevision(scopeB(), adopted.record.adoptionId, 1)).toBeUndefined();
  expect(store.listAdoptionIds(scopeB())).toEqual([]);
  expect(store.size(scopeB())).toBe(0);
});

test("the conversion + gate: cross-tenant observations and decisions are refused", () => {
  const observed = observeActionPlanOutcome(
    scopeA(),
    { plan: planFacet() },
    { observedAt: T1, correlationId: CORR },
  );
  if (!observed.ok) throw new Error(observed.error.message);
  // A tenant-B conversion of a tenant-A observation.
  const cross = convertOutcomeToEvaluationCase(scopeB(), observed.observation, {
    tenantPolicyRefs: ["policy/tenant-b-v1"],
    redaction: redaction(),
  });
  expect(cross.ok).toBe(false);
  if (cross.ok) return;
  expect(invariantOf(cross.error)).toBe("tenant_mismatch");

  // A context-free conversion (types bypassed).
  expect(convertOutcomeToEvaluationCase(undefined as never, observed.observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  }).ok).toBe(false);

  // The gate with a context-free scope (types bypassed).
  const own = convertOutcomeToEvaluationCase(scopeA(), observed.observation, {
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  });
  if (!own.ok) throw new Error(own.error.message);
  expect(gateEvaluationCaseProposal(undefined as never, own.draft, {
    tenantId: TENANT_A,
    decision: "ALLOW",
    rules: [],
    evidence: [],
    decidedAt: T1,
    schemaVersion: 1,
  }).ok).toBe(false);
});

test("the adoption boundary: a context-free scope is refused (types bypassed)", () => {
  const store = createInMemoryLearningAdoptionStore();
  expect(
    recordCapabilityAdoption(undefined as never, store, certifiedMetadata(), adoptionProposal(), {
      at: T1,
      correlationId: asCorrelationId("cor_any"),
    }).ok,
  ).toBe(false);
});
