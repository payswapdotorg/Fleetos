/**
 * W060C web-workloads — binding-site test helpers.
 *
 * Constructs REAL accepted domain records with the REAL same-lane
 * package builders (W022 profiles/recommendations, W032 software
 * subscriptions, W042 service work orders) and a REAL-typed W050A
 * submission record, so the binding-site tests prove:
 *   1. TYPE-LEVEL: every real record is ASSIGNABLE to the surface seams
 *      (the W040-disclosed pattern);
 *   2. RUNTIME: the view-models derive the right display values from
 *      the real records.
 *
 * The ownership gate permits these cross-lane imports in `test/` ONLY
 * (src/ consumes the seams, never the packages).
 */

import {
  appendRecommendation,
  buildWorkloadProfile,
  createRecommendationLedger,
  recommendForProfile,
} from "@fleetos/workloads";
import type {
  CandidateCapabilities,
  RequirementVector,
  WorkloadProfile,
  WorkloadRecommendationLedger,
} from "@fleetos/workloads";
import { allocateSubscription } from "@fleetos/software";
import type { SoftwareSubscription } from "@fleetos/software";
import { buildServiceWorkOrder } from "@fleetos/maintenance";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import type { ConnectivitySubmissionRecord } from "@fleetos/integration-adcos";
import {
  asCorrelationId,
  asDeviceId,
  asIntentId,
  asTenantId,
  asWorkloadId,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Shared fixtures (deterministic, injected instants — no clock reads)
// ---------------------------------------------------------------------------

export const TENANT_A = asTenantId("tnt_w060cbbbbbbbb1");
export const TENANT_B = asTenantId("tnt_w060cbbbbbbbb2");
export const T0 = "2026-01-05T09:00:00Z";
export const T1 = "2026-01-06T09:00:00Z";
export const T2 = "2026-01-07T09:00:00Z";
export const CORR = asCorrelationId("corr_w060c_binding_1");
export const WORKLOAD_ID = asWorkloadId("wl_w060c_analyst");

/** A canonical requirement vector (all ten W022 dimensions). */
export function requirementVector(): RequirementVector {
  return {
    vectorVersion: 1,
    values: {
      cpuDemand: 0.7,
      gpuDemand: 0.1,
      memoryDemand: 0.6,
      storageDemand: 0.5,
      networkDemand: 0.4,
      powerDependence: 0.8,
      mobilityDemand: 0.9,
      peripheralDemand: 0.3,
      securityDemand: 0.65,
      downtimeSensitivity: 0.7,
    },
    confidence: 0.9,
  };
}

// ---------------------------------------------------------------------------
// W022 — the real workload profile + recommendation ledger
// ---------------------------------------------------------------------------

/** Build a REAL W022 WorkloadProfile via the domain builder. */
export function realProfile(): WorkloadProfile {
  const built = buildWorkloadProfile(TENANT_A, {
    workloadId: WORKLOAD_ID,
    subjectKind: "role",
    name: "finance.analyst",
    description: "Financial analyst workstation workload",
    requirements: requirementVector(),
    constraints: {
      requiredApplications: [{ appId: "app.financial_suite", minVersion: "2026.1" }],
      environments: ["office", "home"],
      peripherals: ["external_display", "dock"],
      classification: "confidential",
    },
    workingHours: { startHour: 8, endHour: 18 },
    evidence: [
      { observationId: "obs_w060c_0001", kind: "device.workload", note: "p90 factors" },
    ],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.profile;
}

/** A REAL W022 candidate: a fielded standard laptop class. */
export function fieldedLaptopCandidate(): CandidateCapabilities {
  return {
    candidateId: "class.standard_laptop",
    label: "Standard Laptop",
    maxSecurityClassification: "restricted",
    vector: {
      vectorVersion: 1,
      values: {
        cpuDemand: 0.8,
        gpuDemand: 0.2,
        memoryDemand: 0.7,
        storageDemand: 0.6,
        networkDemand: 0.5,
        powerDependence: 0.9,
        mobilityDemand: 0.95,
        peripheralDemand: 0.6,
        securityDemand: 0.7,
        downtimeSensitivity: 0.8,
      },
      confidence: 0.95,
    },
    availableApplications: [
      { appId: "app.financial_suite", version: "2026.2" },
    ],
    environments: ["office", "home", "travel"],
    peripherals: ["external_display", "dock", "printer"],
  };
}

/** A REAL W022 candidate that requires procurement. */
export function procurementWorkstationCandidate(): CandidateCapabilities {
  return {
    candidateId: "class.engineering_workstation",
    label: "Engineering Workstation",
    procurementRequired: true,
    maxSecurityClassification: "restricted",
    vector: {
      vectorVersion: 1,
      values: {
        cpuDemand: 0.95,
        gpuDemand: 0.9,
        memoryDemand: 0.9,
        storageDemand: 0.8,
        networkDemand: 0.7,
        powerDependence: 0.4,
        mobilityDemand: 0.2,
        peripheralDemand: 0.7,
        securityDemand: 0.9,
        downtimeSensitivity: 0.5,
      },
      confidence: 0.9,
    },
    availableApplications: [{ appId: "app.financial_suite", version: "2026.2" }],
    environments: ["office", "home", "datacenter"],
    peripherals: ["external_display", "dock"],
  };
}

/**
 * Build a REAL W022 recommendation ledger: one run with both candidates,
 * then a RECOMMENDATION run (supersession) for the laptop lineage, plus
 * a DISMISSAL of the superseded record. Deterministic ids throughout.
 */
export function realLedger(): WorkloadRecommendationLedger {
  const profile = realProfile();
  let ledger = createRecommendationLedger(TENANT_A, WORKLOAD_ID);

  // Run 1: both candidates; append every proposal to the ledger FIRST
  // (the engine reads the ledger history for lineage versioning).
  const run1 = recommendForProfile(profile, [procurementWorkstationCandidate(), fieldedLaptopCandidate()], {
    at: T0,
    correlationId: CORR,
  });
  if (!run1.ok) throw new Error(run1.error.message);
  for (const recommendation of run1.recommendations) {
    const appended = appendRecommendation(ledger, recommendation);
    if (!appended.ok) throw new Error(appended.error.message);
    ledger = appended.ledger;
  }
  const firstLaptop = run1.recommendations.find((r) => r.candidateId === "class.standard_laptop");
  if (firstLaptop === undefined) throw new Error("laptop recommendation missing");

  // Run 2 (re-recommendation): the laptop lineage advances to v2 and
  // supersedes the v1 record.
  const run2 = recommendForProfile(profile, [fieldedLaptopCandidate()], {
    at: T1,
    correlationId: CORR,
    history: ledger.entries,
  });
  if (!run2.ok) throw new Error(run2.error.message);
  const secondLaptop = run2.recommendations.find((r) => r.candidateId === "class.standard_laptop");
  if (secondLaptop === undefined) throw new Error("second laptop recommendation missing");
  const appended2 = appendRecommendation(ledger, secondLaptop);
  if (!appended2.ok) throw new Error(appended2.error.message);
  ledger = appended2.ledger;
  return ledger;
}

// ---------------------------------------------------------------------------
// W032 — the real software subscription (the software resource)
// ---------------------------------------------------------------------------

/** Build a REAL W032 SoftwareSubscription via the allocation engine. */
export function realSubscription(): SoftwareSubscription {
  const allocated = allocateSubscription(TENANT_A, {
    softwareIntent: { softwareId: "app.financial_suite", seatCount: 12 },
    workloadId: WORKLOAD_ID,
    termDays: 365,
    at: T1,
    correlationId: CORR,
  });
  if (!allocated.ok) throw new Error(allocated.error.message);
  return allocated.subscription;
}

// ---------------------------------------------------------------------------
// W042 — the real service work order (the maintenance resource)
// ---------------------------------------------------------------------------

/** Build a REAL W042 ServiceWorkOrder via the domain builder. */
export function realWorkOrder(): ServiceWorkOrder {
  const built = buildServiceWorkOrder(TENANT_A, {
    deviceId: asDeviceId("dev_w060c_0001"),
    diagnosis: {
      hypothesisId: "hyp_w060c_0001",
      recommendationId: "trt_w060c_0001",
      causeId: "health.battery_aging",
      confidence: 0.82,
      proposedIntent: {
        intentKind: "MaintainDeviceIntent",
        payload: { deviceId: "dev_w060c_0001", description: "Battery replacement" },
      },
      observationIds: ["obs_w060c_0101", "obs_w060c_0102"],
    },
    serviceArea: "us-east",
    deadline: "2026-01-20T17:00:00Z",
    slaFloor: { coverage: 0.8 },
    warrantyRules: { warrantyFloor: { days: 365 }, requireInWarranty: true },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    serviceCategory: "service.battery",
    at: T1,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.workOrder;
}

// ---------------------------------------------------------------------------
// W050A — the real-typed connectivity submission record (the
// connectivity resource). Constructed as a REAL ConnectivitySubmissionRecord
// value (the frozen public shape the submission gate produces; the gate's
// own W050A suite proves the flow).
// ---------------------------------------------------------------------------

/** A REAL-typed W050A ConnectivitySubmissionRecord (PARKED for approval). */
export function realParkedSubmission(): ConnectivitySubmissionRecord {
  return {
    tenantId: TENANT_A,
    submissionId: "adcos-sub-w060c0001",
    request: {
      tenantId: TENANT_A,
      intentRef: {
        intentId: asIntentId("int_w060c0001"),
        version: 1,
        createdAt: T0,
      },
      outcome: { canonical: "secure_private_connectivity", raw: "secure private connectivity" },
      targets: { sourceDeviceId: "dev_w060c_0001", workloadId: WORKLOAD_ID },
      properties: {
        maxLatencyMs: 40,
        minThroughputMbps: 100,
        availabilityTarget: 0.999,
        isolation: "private",
        redundancy: "path_redundant",
      },
      constraints: {
        requiredZones: ["corporate"],
        forbiddenZones: ["public"],
        egressAllowed: false,
      },
      duration: { startAt: T0, endAt: T1 },
      budget: { budgetRef: "budget/test-quarterly", policyRefs: ["policy/test-connectivity"] },
      security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
      requestDigest: "0123456789abcdef",
    },
    status: "PARKED",
    revisions: [
      {
        revision: 1,
        status: "PROPOSED",
        at: T0,
        decision: null,
        reasons: [],
        matchedRules: [],
        providerRefusal: null,
        handle: null,
        connectivityId: null,
        error: null,
        contentDigest: "aaaa0000bbbb1111",
        priorDigest: null,
      },
      {
        revision: 2,
        status: "PARKED",
        at: T0,
        decision: {
          tenantId: TENANT_A,
          decision: "REQUIRE_APPROVAL",
          rules: [],
          evidence: [],
          decidedAt: T0,
          schemaVersion: 1,
        },
        reasons: [
          {
            code: "policy.rule.matched",
            ruleId: "pol_w060c0001",
            ruleVersion: 1,
            effect: "REQUIRE_APPROVAL",
            chosen: "REQUIRE_APPROVAL",
          },
        ],
        matchedRules: [{ ruleId: "pol_w060c0001", version: 1 }],
        providerRefusal: null,
        handle: null,
        connectivityId: null,
        error: null,
        contentDigest: "aaaa0000bbbb2222",
        priorDigest: "aaaa0000bbbb1111",
      },
    ],
  };
}
