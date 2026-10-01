/**
 * W090C web-workloads — the composite journey view-model tests (D3/D4):
 * the workload -> software -> procurement -> VERIFIED-connectivity
 * journey derived from the REAL domain records through the established
 * seams, plus the pure navigation machine's legal/illegal transitions.
 *
 * The REAL records (W022 profile + ledger with proposed intents, W032
 * subscription + demand + accepted quote, W050A submission + adopted
 * record) are constructed with the REAL same-lane builders — the
 * journey view-model is exercised end-to-end exactly as the shell will
 * bind it.
 */

import { test, expect } from "bun:test";
import {
  buildWorkloadProcurementJourneyView,
  deriveConnectivityVerification,
  journeyRailStages,
  reduceJourneyNavState,
  INITIAL_JOURNEY_NAV_STATE,
  JOURNEY_STAGE_IDS,
  JOURNEY_STAGE_ROUTES,
  WORKLOAD_JOURNEY_VIEW_VERSION,
} from "../src/journey";
import type {
  JourneyConnectivityVerificationFacets,
  JourneyDemandFacets,
  JourneyQuoteFacets,
  WorkloadProcurementJourneySource,
} from "../src/journey";
import {
  appendRecommendation,
  createRecommendationLedger,
  recommendForProfile,
} from "@fleetos/workloads";
import type { WorkloadRecommendationLedger } from "@fleetos/workloads";
import { allocateSubscription } from "@fleetos/software";
import type { SoftwareSubscription } from "@fleetos/software";
import {
  acceptQuote,
  appendQuote,
  createDemand,
  createQuoteLedger,
  issueQuote,
} from "@fleetos/procurement";
import type { ProcurementDemand, Quote, VendorMatch } from "@fleetos/procurement";
import type { ConnectivityRecord } from "@fleetos/integration-adcos";
import {
  CORR,
  TENANT_A,
  T0,
  T1,
  T2,
  WORKLOAD_ID,
  procurementWorkstationCandidate,
  realProfile,
} from "./helpers";
import { asTenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The full-journey fixture (REAL records, deterministic instants)
// ---------------------------------------------------------------------------

/** A REAL W022 candidate that proposes BOTH procurement and software intents. */
function subscriptionWorkstationCandidate(): ReturnType<typeof procurementWorkstationCandidate> {
  return {
    ...procurementWorkstationCandidate(),
    availableApplications: [
      { appId: "app.financial_suite", version: "2026.2", subscriptionRequired: true },
    ],
  };
}

/** The REAL W022 ledger whose ACTIVE recommendation carries both intents. */
function journeyLedger(): WorkloadRecommendationLedger {
  const profile = realProfile();
  let ledger = createRecommendationLedger(TENANT_A, WORKLOAD_ID);
  const run = recommendForProfile(profile, [subscriptionWorkstationCandidate()], {
    at: T0,
    correlationId: CORR,
  });
  if (!run.ok) throw new Error(run.error.message);
  for (const recommendation of run.recommendations) {
    const appended = appendRecommendation(ledger, recommendation);
    if (!appended.ok) throw new Error(appended.error.message);
    ledger = appended.ledger;
  }
  return ledger;
}

/** The REAL W032 software subscription satisfying the need. */
function journeySubscription(): SoftwareSubscription {
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

/** The REAL W032 procurement demand for the workstation class. */
function journeyDemand(): ProcurementDemand {
  const created = createDemand(TENANT_A, {
    procurementIntent: {
      workloadId: WORKLOAD_ID,
      description: "Engineering workstations for the finance analyst fleet",
    },
    quantity: 10,
    at: T0,
    deadline: "2026-01-15T17:00:00Z",
    deliveryArea: "us-east",
    budget: { usd: 25_000 },
    slaFloor: { coverage: 0.8 },
    warrantyFloor: { days: 365 },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    allowedSubstitutions: ["class.engineering_workstation"],
    correlationId: CORR,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.demand;
}

/** A REAL W032 satisfiable VendorMatch (the minimal engine output shape). */
function journeyMatch(demand: ProcurementDemand): VendorMatch {
  return {
    vendor: {
      vendorId: "vnd_w090c_aaaa" as never,
      tenantId: TENANT_A,
      name: "acme.local",
      description: "Acme local fulfillment",
      revision: 1,
      capabilities: [{ kind: "device-class", id: "class.engineering_workstation" }],
      inventory: [
        {
          capability: { kind: "device-class", id: "class.engineering_workstation" },
          availability: { ratio: 0.9 },
          leadTime: { days: 5 },
        },
      ],
      terms: { quality: { score: 0.85 }, sla: { coverage: 0.9 }, warranty: { days: 730 } },
      regions: ["us-east"],
      createdAt: T0,
      contentHash: "hash_w090c_vendor_a",
      schemaVersion: 1,
      modelVersion: 1,
    },
    matchedCapability: { kind: "device-class", id: "class.engineering_workstation" },
    matchedInventory: {
      capability: { kind: "device-class", id: "class.engineering_workstation" },
      availability: { ratio: 0.9 },
      leadTime: { days: 5 },
    },
    rankScore: 1,
    satisfiable: true,
    reasons: [],
  };
}

/** The REAL W032 quote (ISSUED) over the demand. */
function journeyQuote(): Quote {
  const demand = journeyDemand();
  const issued = issueQuote({
    demand,
    match: journeyMatch(demand),
    unitPriceUsd: 2_200,
    leadTimeDays: 5,
    warrantyDays: 730,
    slaCoverage: 0.9,
    at: T1,
    correlationId: CORR,
  });
  if (!issued.ok) throw new Error(issued.error.message);
  return issued.quote;
}

/** The journey's quote facet composed from the REAL accepted ledger. */
function acceptedQuoteFacets(): {
  quoteId: string;
  tenantId: typeof TENANT_A;
  demandId: string;
  vendorId: string;
  status: string;
  accepted: boolean;
  acceptedAt: string | null;
} {
  const quote = journeyQuote();
  let ledger = createQuoteLedger(TENANT_A);
  const appended = appendQuote(ledger, quote);
  if (!appended.ok) throw new Error(appended.error.message);
  ledger = appended.ledger;
  const accepted = acceptQuote(ledger, quote.quoteId, { at: T2, correlationId: CORR });
  if (!accepted.ok) throw new Error(accepted.error.message);
  return {
    quoteId: quote.quoteId,
    tenantId: TENANT_A,
    demandId: quote.demandId,
    vendorId: quote.vendorId,
    status: quote.status,
    accepted: true,
    acceptedAt: T2,
  };
}


/** The W100C vendor-match facets (satisfiable — the selection stage's DONE evidence). */
function matchedVendorFacets() {
  return {
    tenantId: TENANT_A,
    vendorId: "ven_w100c0000001",
    vendorName: "Nordwerk IT Service",
    matchedCapabilityId: "cap.procure.laptop",
    rankScore: 0.82,
    satisfiable: true,
    reasons: ["capability_declared", "region_covered"],
  };
}

/** The W100C maintenance facets (work order + satisfiable service match). */
function fulfilledMaintenanceFacets() {
  return {
    tenantId: TENANT_A,
    workOrderId: "swo_w100c000001",
    deviceId: "dev_w090c_0001",
    serviceCategory: "service.battery",
    deadline: "2026-04-01T00:00:00Z",
    matchedVendor: {
      tenantId: TENANT_A,
      vendorId: "ven_w100c0000002",
      vendorName: "Akku Kolonial",
      matchedCapabilityId: "service.battery",
      rankScore: 0.9,
      satisfiable: true,
      reasons: ["sla_headroom", "quality_headroom"],
    },
  };
}

/** The W050A submission facets (APPROVED, adopted). */
function approvedSubmission() {
  return {
    tenantId: TENANT_A,
    submissionId: "adcos-sub-w090c0001",
    status: "APPROVED",
    request: {
      targets: { sourceDeviceId: "dev_w090c_0001", workloadId: WORKLOAD_ID },
      outcome: { canonical: "secure_private_connectivity", raw: "secure private connectivity" },
    },
    revisions: [{ revision: 1, status: "APPROVED", at: T1 }],
  };
}

/** The adopted-record verification facets (ACTIVE + measurements, no failure). */
function verifiedConnectivity(): JourneyConnectivityVerificationFacets {
  return {
    tenantId: TENANT_A,
    connectivityId: "conn_w090c0001",
    executionState: "ACTIVE",
    failed: false,
    degraded: false,
    measurementKinds: ["latency_ms", "throughput_mbps"],
    latestContentDigest: "cccc0000dddd1111",
  };
}

/** The full journey source (every stage's record present). */
function fullSource(): WorkloadProcurementJourneySource {
  return {
    profile: realProfile(),
    ledger: journeyLedger(),
    subscription: journeySubscription(),
    demand: journeyDemand(),
    quote: acceptedQuoteFacets(),
    vendorMatch: matchedVendorFacets(),
    maintenance: fulfilledMaintenanceFacets(),
    submission: approvedSubmission(),
    verification: verifiedConnectivity(),
  };
}

// ---------------------------------------------------------------------------
// The view-model derivations
// ---------------------------------------------------------------------------

test("journey: the full source derives all EIGHT stages DONE and the terminal VERIFIED outcome", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const view = result.view;
  expect(view.viewVersion).toBe(WORKLOAD_JOURNEY_VIEW_VERSION);
  expect(view.workloadId).toBe(WORKLOAD_ID);
  expect(view.stages.map((stage) => stage.stageId)).toEqual([...JOURNEY_STAGE_IDS]);
  expect(view.stages.every((stage) => stage.state === "done")).toBe(true);
  expect(view.currentStageId).toBeNull();
  expect(view.verified).toBe(true);
  expect(view.verificationSummary).toContain("conn_w090c0001");
  expect(view.verificationSummary).toContain("ACTIVE");
  expect(view.verificationSummary).toContain("latency_ms");
});

test("journey: every stage carries its route target (the shell vocabulary)", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  if (!result.ok) throw new Error(result.error.message);
  for (const stage of result.view.stages) {
    expect(JOURNEY_STAGE_ROUTES[stage.stageId]).toEqual(stage.route);
  }
  expect(result.view.stages[0]?.route).toEqual({ area: "workloads", view: "planning" });
  expect(result.view.stages[1]?.route).toEqual({ area: "commerce", view: "software" });
  expect(result.view.stages[4]?.route).toEqual({ area: "commerce", view: "vendors" });
  expect(result.view.stages[5]?.route).toEqual({ area: "commerce", view: "maintenance" });
  expect(result.view.stages[6]?.route).toEqual({ area: "commerce", view: "connectivity" });
  expect(result.view.stages[7]?.route).toEqual({ area: "commerce", view: "connectivity" });
});

test("journey: a PARKED submission derives the connectivity-request stage as the approval state", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    submission: { ...approvedSubmission(), status: "PARKED" },
    verification: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const request = result.view.stages.find((stage) => stage.stageId === "connectivity-request");
  expect(request?.state).toBe("approval");
  expect(result.view.currentStageId).toBe("connectivity-request");
  expect(result.view.verified).toBe(false);
  expect(request?.summary).toContain("PARKED");
});

test("journey: a REJECTED quote blocks the procurement-quote stage and the journey stops there", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    quote: { ...acceptedQuoteFacets(), accepted: false, acceptedAt: null, status: "REJECTED" },
    submission: null,
    verification: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const quoteStage = result.view.stages.find((stage) => stage.stageId === "procurement-quote");
  expect(quoteStage?.state).toBe("blocked");
  expect(quoteStage?.summary).toContain("REJECTED");
  // The current stage is the blocked one; later stages stay pending.
  expect(result.view.currentStageId).toBe("procurement-quote");
  const verifiedStage = result.view.stages.find((stage) => stage.stageId === "connectivity-verified");
  expect(verifiedStage?.state).toBe("pending");
  expect(result.view.verified).toBe(false);
});

test("journey: an unaccepted (ISSUED) quote derives the approval state at the quote stage", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    quote: { ...acceptedQuoteFacets(), accepted: false, acceptedAt: null, status: "ISSUED" },
    vendorMatch: null,
    maintenance: null,
    submission: null,
    verification: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const quoteStage = result.view.stages.find((stage) => stage.stageId === "procurement-quote");
  expect(quoteStage?.state).toBe("approval");
  expect(quoteStage?.summary).toContain("acceptance (the operator approval) is pending");
});

test("journey: records absent -> the first open stage is current, the plan stage is done", () => {
  const source: WorkloadProcurementJourneySource = {
    profile: realProfile(),
    ledger: journeyLedger(),
    subscription: null,
    demand: null,
    quote: null,
    vendorMatch: null,
    maintenance: null,
    submission: null,
    verification: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const plan = result.view.stages.find((stage) => stage.stageId === "workload-plan");
  expect(plan?.state).toBe("done");
  const need = result.view.stages.find((stage) => stage.stageId === "software-need");
  expect(need?.state).toBe("current");
  expect(result.view.currentStageId).toBe("software-need");
  expect(result.view.verified).toBe(false);
});

test("journey: cross-tenant records are refused (tenant_mismatch, LOCK 17)", () => {
  const other = asTenantId("tnt_w090c_other99");
  const result = buildWorkloadProcurementJourneyView(other, fullSource());
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.code).toContain("tenant_mismatch");
});

test("journey: evidence refs are machine-stable and visible per stage", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  if (!result.ok) throw new Error(result.error.message);
  const verifiedStage = result.view.stages.find((stage) => stage.stageId === "connectivity-verified");
  expect(verifiedStage?.evidenceRefs).toContain("connectivity:conn_w090c0001");
  expect(verifiedStage?.evidenceRefs).toContain("measurements:latency_ms+throughput_mbps");
  expect(verifiedStage?.evidenceRefs).toContain("digest:cccc0000dddd1111");
  const quoteStage = result.view.stages.find((stage) => stage.stageId === "procurement-quote");
  expect(quoteStage?.evidenceRefs).toContain(`acceptedAt:${T2}`);
});

test("journey: rail stages return in canonical order regardless of construction", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  if (!result.ok) throw new Error(result.error.message);
  const rail = journeyRailStages(result.view);
  expect(rail.map((stage) => stage.stageId)).toEqual([...JOURNEY_STAGE_IDS]);
});

// ---------------------------------------------------------------------------
// The verification predicate
// ---------------------------------------------------------------------------

test("verification: ACTIVE + measurements + no failure is VERIFIED; anything else is not", () => {
  expect(deriveConnectivityVerification(verifiedConnectivity())).toBe(true);
  expect(
    deriveConnectivityVerification({ ...verifiedConnectivity(), executionState: "PROVISIONING" }),
  ).toBe(false);
  expect(
    deriveConnectivityVerification({ ...verifiedConnectivity(), measurementKinds: [] }),
  ).toBe(false);
  expect(deriveConnectivityVerification({ ...verifiedConnectivity(), failed: true })).toBe(false);
});

// ---------------------------------------------------------------------------
// The navigation machine
// ---------------------------------------------------------------------------

test("nav: advance walks the canonical stage order and refuses past the terminal stage", () => {
  let state = INITIAL_JOURNEY_NAV_STATE;
  expect(state.stageId).toBe("workload-plan");
  for (const stageId of JOURNEY_STAGE_IDS.slice(1)) {
    const next = reduceJourneyNavState(state, { type: "advance" });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.error.message);
    expect(next.state.stageId).toBe(stageId);
    state = next.state;
  }
  const past = reduceJourneyNavState(state, { type: "advance" });
  expect(past.ok).toBe(false);
  if (past.ok) throw new Error("expected refusal");
  expect(past.reason).toBe("illegal_event");
});

test("nav: goto_stage accepts known ids and refuses unknown ones", () => {
  const result = reduceJourneyNavState(INITIAL_JOURNEY_NAV_STATE, {
    type: "goto_stage",
    stageId: "connectivity-verified",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.state.stageId).toBe("connectivity-verified");

  const bad = reduceJourneyNavState(INITIAL_JOURNEY_NAV_STATE, {
    type: "goto_stage",
    stageId: "not-a-stage" as never,
  });
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected refusal");
  expect(bad.reason).toBe("illegal_event");
});

test("nav: reset returns to the origin stage", () => {
  const mid = reduceJourneyNavState(INITIAL_JOURNEY_NAV_STATE, {
    type: "goto_stage",
    stageId: "procurement-quote",
  });
  if (!mid.ok) throw new Error(mid.error.message);
  const reset = reduceJourneyNavState(mid.state, { type: "reset" });
  expect(reset.ok).toBe(true);
  if (!reset.ok) throw new Error(reset.error.message);
  expect(reset.state.stageId).toBe("workload-plan");
});

// ---------------------------------------------------------------------------
// The binding-site TYPE PROOFS: the journey facets are satisfied by the
// REAL domain records (the shell binds them exactly this way)
// ---------------------------------------------------------------------------

test("TYPE PROOF: the real W032 ProcurementDemand is directly assignable to JourneyDemandFacets", () => {
  const demand: ProcurementDemand = journeyDemand();
  const seam: JourneyDemandFacets = demand;
  expect(seam.demandId).toBe(demand.demandId);
  expect(seam.workloadId).toBe(demand.workloadId);
  expect(seam.deadline).toBe(demand.deadline);
});

test("TYPE PROOF: JourneyQuoteFacets composes field-by-field from the real Quote + the accepted ledger", () => {
  const quote: Quote = journeyQuote();
  const accepted = acceptedQuoteFacets();
  // Every facet field type-checks against the REAL record's field — the
  // compile-time provenance proof (the shell composes exactly this).
  const seam: JourneyQuoteFacets = {
    quoteId: quote.quoteId,
    tenantId: quote.tenantId,
    demandId: quote.demandId,
    vendorId: quote.vendorId,
    status: quote.status,
    accepted: accepted.accepted,
    acceptedAt: accepted.acceptedAt,
  };
  expect(seam.quoteId).toBe(quote.quoteId);
  expect(seam.status).toBe(quote.status);
  expect(seam.accepted).toBe(true);
});

test("TYPE PROOF: JourneyConnectivityVerificationFacets composes from the real W050A adopted record", () => {
  const record: ConnectivityRecord = {
    tenantId: TENANT_A,
    connectivityId: "conn_w090c0001",
    handle: "opq_provider_handle_9" as ConnectivityRecord["handle"],
    intentRef: {
      intentId: "int_w060c0001" as NonNullable<ConnectivityRecord["intentRef"]>["intentId"],
      version: 1,
      createdAt: T0,
    },
    requestDigest: "0123456789abcdef",
    executionState: "ACTIVE",
    revisions: [
      {
        revision: 1,
        adoptedAt: T1,
        acceptedRequirements: {
          outcome: "secure_private_connectivity",
          properties: { isolation: "private", redundancy: "path_redundant", availabilityTarget: 0.999 },
          constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
          duration: { startAt: T0, endAt: T1 },
          security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
        },
        executionState: "PROVISIONING",
        measurements: [],
        degradation: { kind: "none" },
        failure: { kind: "none" },
        termination: null,
        contentDigest: "ffff0000aaaa1111",
        priorDigest: null,
      },
      {
        revision: 2,
        adoptedAt: T2,
        acceptedRequirements: {
          outcome: "secure_private_connectivity",
          properties: { isolation: "private", redundancy: "path_redundant", availabilityTarget: 0.999 },
          constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
          duration: { startAt: T0, endAt: T1 },
          security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
        },
        executionState: "ACTIVE",
        measurements: [
          { kind: "latency_ms", value: 31, measuredAt: T2, evidence: { key: "ev/9", sizeBytes: 10, hash: "h9", hashAlgorithm: "sha256" } },
          { kind: "throughput_mbps", value: 118, measuredAt: T2, evidence: { key: "ev/10", sizeBytes: 10, hash: "h10", hashAlgorithm: "sha256" } },
        ],
        degradation: { kind: "none" },
        failure: { kind: "none" },
        termination: null,
        contentDigest: "ffff0000aaaa2222",
        priorDigest: "ffff0000aaaa1111",
      },
    ],
  };
  const latest = record.revisions[record.revisions.length - 1];
  if (latest === undefined) throw new Error("fixture revision missing");
  // Every facet field type-checks against the REAL record's field — the
  // compile-time provenance proof (the shell reduces exactly this).
  const seam: JourneyConnectivityVerificationFacets = {
    tenantId: record.tenantId,
    connectivityId: record.connectivityId,
    executionState: record.executionState,
    failed: latest.failure.kind !== "none",
    degraded: latest.degradation.kind !== "none",
    measurementKinds: [...new Set(latest.measurements.map((m) => m.kind))].sort(),
    latestContentDigest: latest.contentDigest,
  };
  expect(seam.executionState).toBe("ACTIVE");
  expect(seam.failed).toBe(false);
  expect(seam.measurementKinds).toEqual(["latency_ms", "throughput_mbps"]);
  expect(deriveConnectivityVerification(seam)).toBe(true);
});

// ---------------------------------------------------------------------------
// W100C — the vendor-selection + maintenance-service stages
// ---------------------------------------------------------------------------

test("W100C: a satisfiable vendor match derives the vendor-selection stage DONE", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    maintenance: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const vendorStage = result.view.stages.find((stage) => stage.stageId === "vendor-selection");
  expect(vendorStage?.state).toBe("done");
  expect(vendorStage?.summary).toContain("Nordwerk IT Service");
  expect(vendorStage?.summary).toContain("rank 0.82");
  expect(vendorStage?.recordRef).toBe("ven_w100c0000001");
  expect(vendorStage?.evidenceRefs).toContain("vendorMatch:ven_w100c0000001");
  expect(vendorStage?.route).toEqual({ area: "commerce", view: "vendors" });
});

test("W100C: an unsatisfiable vendor match BLOCKS the vendor-selection stage", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    vendorMatch: {
      ...matchedVendorFacets(),
      satisfiable: false,
      reasons: ["region_not_covered"],
    },
    maintenance: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const vendorStage = result.view.stages.find((stage) => stage.stageId === "vendor-selection");
  expect(vendorStage?.state).toBe("blocked");
  expect(vendorStage?.summary).toContain("UNSATISFIABLE");
  expect(vendorStage?.summary).toContain("region_not_covered");
});

test("W100C: an absent vendor match leaves the stage PENDING (never invented)", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    vendorMatch: null,
    maintenance: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  // The vendor stage is the FIRST open stage here: pending + cursor =>
  // "current" (the cursor discipline — authorization states are never
  // masked, and a plain pending stage leads the journey).
  const vendorStage = result.view.stages.find((stage) => stage.stageId === "vendor-selection");
  expect(vendorStage?.state).toBe("current");
  expect(vendorStage?.summary).toContain("No vendor match is recorded");
});

test("W100C: a work order with a satisfiable service match derives the maintenance stage DONE", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  if (!result.ok) throw new Error(result.error.message);
  const maintenanceStage = result.view.stages.find(
    (stage) => stage.stageId === "maintenance-service",
  );
  expect(maintenanceStage?.state).toBe("done");
  expect(maintenanceStage?.summary).toContain("swo_w100c000001");
  expect(maintenanceStage?.summary).toContain("Akku Kolonial");
  expect(maintenanceStage?.recordRef).toBe("swo_w100c000001");
  expect(maintenanceStage?.route).toEqual({ area: "commerce", view: "maintenance" });
  expect(maintenanceStage?.evidenceRefs).toContain("serviceVendor:ven_w100c0000002");
});

test("W100C: a work order WITHOUT a service match derives the maintenance stage APPROVAL", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    maintenance: { ...fulfilledMaintenanceFacets(), matchedVendor: null },
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  const maintenanceStage = result.view.stages.find(
    (stage) => stage.stageId === "maintenance-service",
  );
  expect(maintenanceStage?.state).toBe("approval");
  expect(maintenanceStage?.summary).toContain("awaits a vendor assignment");
});

test("W100C: an absent work order leaves the maintenance stage PENDING", () => {
  const source: WorkloadProcurementJourneySource = {
    ...fullSource(),
    maintenance: null,
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, source);
  if (!result.ok) throw new Error(result.error.message);
  // The maintenance stage is the FIRST open stage here: pending +
  // cursor => "current".
  const maintenanceStage = result.view.stages.find(
    (stage) => stage.stageId === "maintenance-service",
  );
  expect(maintenanceStage?.state).toBe("current");
  expect(maintenanceStage?.summary).toContain("No maintenance service work order");
});

test("W100C: the full 8-stage journey is workload -> software -> procurement -> vendor -> maintenance -> connectivity", () => {
  const result = buildWorkloadProcurementJourneyView(TENANT_A, fullSource());
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.stages.map((stage) => stage.stageId)).toEqual([
    "workload-plan",
    "software-need",
    "procurement-request",
    "procurement-quote",
    "vendor-selection",
    "maintenance-service",
    "connectivity-request",
    "connectivity-verified",
  ]);
});

test("W100C: cross-tenant vendor/maintenance records are refused (tenant_mismatch, LOCK 17)", () => {
  const foreignVendor = {
    ...matchedVendorFacets(),
    tenantId: asTenantId("tnt_w060cbbbbbbbb2"),
  };
  const result = buildWorkloadProcurementJourneyView(TENANT_A, {
    ...fullSource(),
    vendorMatch: foreignVendor,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toContain("tenant_mismatch");

  const foreignMaintenance = {
    ...fulfilledMaintenanceFacets(),
    tenantId: asTenantId("tnt_w060cbbbbbbbb2"),
  };
  const result2 = buildWorkloadProcurementJourneyView(TENANT_A, {
    ...fullSource(),
    maintenance: foreignMaintenance,
  });
  expect(result2.ok).toBe(false);
  if (!result2.ok) expect(result2.error.code).toContain("tenant_mismatch");
});
