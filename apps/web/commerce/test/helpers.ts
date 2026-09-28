/**
 * W060C web-commerce — binding-site test helpers.
 *
 * Constructs REAL accepted domain records with the REAL same-lane
 * package builders (W032 vendors/demand/matching/quotes/aggregation,
 * W042 service work orders/service matching/service aggregation) and
 * REAL-typed W050A submission/record + W050C outbox/delivery values, so
 * the binding-site tests prove:
 *   1. TYPE-LEVEL: every real record is ASSIGNABLE to the surface seams
 *      (the W040-disclosed pattern);
 *   2. RUNTIME: the view-models derive the right display values.
 *
 * The ownership gate permits these cross-lane imports in `test/` ONLY
 * (src/ consumes the seams, never the packages).
 */

import { buildVendor } from "@fleetos/vendors";
import type { Vendor } from "@fleetos/vendors";
import { createDemand, matchDemand } from "@fleetos/procurement";
import type { ProcurementDemand, VendorMatch } from "@fleetos/procurement";
import {
  acceptQuote,
  appendQuote,
  createQuoteLedger,
  issueQuote,
  aggregateAcceptedQuotes,
} from "@fleetos/procurement";
import type { AggregatedOrder, Quote, QuoteLedger } from "@fleetos/procurement";
import { buildServiceWorkOrder } from "@fleetos/maintenance";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import { matchServiceWorkOrder } from "@fleetos/maintenance";
import type { ServiceVendorMatch } from "@fleetos/maintenance";
import type { ConnectivityRecord, ConnectivitySubmissionRecord } from "@fleetos/integration-adcos";
import type { DeliveryRecord, OutboxEntry } from "@fleetos/integration-aurum";
import {
  asCorrelationId,
  asDeviceId,
  asIntentId,
  asTenantId,
  asVendorId,
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
export const T3 = "2026-01-08T09:00:00Z";
export const NOW = "2026-01-09T09:00:00Z"; // 4 days before the deadlines below
export const CORR = asCorrelationId("corr_w060c_commerce1");
export const WORKLOAD_ID = asWorkloadId("wl_w060c_analyst");

// ---------------------------------------------------------------------------
// W032 — the real vendor records
// ---------------------------------------------------------------------------

/** A REAL vendor: strong terms, local region, laptop class + service. */
export function realVendorA(): Vendor {
  const built = buildVendor(TENANT_A, {
    vendorId: asVendorId("vnd_w060c_aaaa"),
    name: "acme.local",
    description: "Acme local fulfillment",
    capabilities: [
      { kind: "device-class", id: "class.standard_laptop" },
      { kind: "service", id: "service.battery" },
    ],
    inventory: [
      {
        capability: { kind: "device-class", id: "class.standard_laptop" },
        availability: { ratio: 0.9 },
        leadTime: { days: 5 },
      },
      {
        capability: { kind: "service", id: "service.battery" },
        availability: { ratio: 0.8 },
        leadTime: { days: 3 },
      },
    ],
    terms: { quality: { score: 0.85 }, sla: { coverage: 0.9 }, warranty: { days: 730 } },
    regions: ["us-east"],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.vendor;
}

/** A REAL vendor: weaker terms, same region (for rank contrast). */
export function realVendorB(): Vendor {
  const built = buildVendor(TENANT_A, {
    vendorId: asVendorId("vnd_w060c_bbbb"),
    name: "beta.local",
    description: "Beta local fulfillment",
    capabilities: [{ kind: "device-class", id: "class.standard_laptop" }],
    inventory: [
      {
        capability: { kind: "device-class", id: "class.standard_laptop" },
        availability: { ratio: 0.6 },
        leadTime: { days: 9 },
      },
    ],
    terms: { quality: { score: 0.75 }, sla: { coverage: 0.82 }, warranty: { days: 400 } },
    regions: ["us-east"],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.vendor;
}

/** A REAL vendor in another region (hard-gate rejection evidence). */
export function realVendorFar(): Vendor {
  const built = buildVendor(TENANT_A, {
    vendorId: asVendorId("vnd_w060c_cccc"),
    name: "far.local",
    description: "Far-away fulfillment",
    capabilities: [{ kind: "device-class", id: "class.standard_laptop" }],
    inventory: [
      {
        capability: { kind: "device-class", id: "class.standard_laptop" },
        availability: { ratio: 0.95 },
        leadTime: { days: 2 },
      },
    ],
    terms: { quality: { score: 0.95 }, sla: { coverage: 0.95 }, warranty: { days: 1095 } },
    regions: ["eu-west"],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.vendor;
}

// ---------------------------------------------------------------------------
// W032 — the real procurement demand + matching + quotes + aggregation
// ---------------------------------------------------------------------------

/** A REAL demand for 10 laptops in us-east, deadline 10 days out. */
export function realDemand(): ProcurementDemand {
  const created = createDemand(TENANT_A, {
    procurementIntent: {
      workloadId: WORKLOAD_ID,
      description: "10 standard laptops for the finance analyst fleet",
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
    allowedSubstitutions: ["class.standard_laptop"],
    correlationId: CORR,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.demand;
}

/**
 * The REAL matching run's full output: satisfiable matches (the engine's
 * rank order) + the rejected vendor records, so the surface's
 * satisfiable/rejected split is exercised end-to-end.
 */
export function realMatches(): readonly VendorMatch[] {
  const result = matchDemand(realDemand(), [realVendorB(), realVendorFar(), realVendorA()], {
    at: T0,
    correlationId: CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  return [...result.matches, ...result.rejected];
}

/** A REAL issued quote from the top-ranked match. */
export function realIssuedQuote(): Quote {
  const demand = realDemand();
  const matches = realMatches();
  const top = matches[0];
  if (top === undefined) throw new Error("no satisfiable match");
  const issued = issueQuote(
    {
      demand,
      match: top,
      unitPriceUsd: 2_200,
      leadTimeDays: 5,
      warrantyDays: 730,
      slaCoverage: 0.9,
      at: T1,
      correlationId: CORR,
    },
  );
  if (!issued.ok) throw new Error(issued.error.message);
  return issued.quote;
}

/** A REAL quote ledger: issued -> accepted, plus a superseding revision. */
export function realQuoteLedger(): QuoteLedger {
  const quote1 = realIssuedQuote();
  let ledger = createQuoteLedger(TENANT_A);
  const appended1 = appendQuote(ledger, quote1);
  if (!appended1.ok) throw new Error(appended1.error.message);
  ledger = appended1.ledger;

  const accepted = acceptQuote(ledger, quote1.quoteId, { at: T2, correlationId: CORR });
  if (!accepted.ok) throw new Error(accepted.error.message);
  ledger = accepted.ledger;
  return ledger;
}

/**
 * The REAL aggregation context: the aggregated orders + the per-demand
 * accepted-quote map (the per-contract identity for the LOCK 14 display).
 */
export function realAggregationContext(): {
  readonly aggregations: readonly AggregatedOrder[];
  readonly quotesByDemand: ReadonlyMap<string, Quote>;
} {
  const aggregation = realAggregation();
  const demand = realDemand();
  const quote = realIssuedQuote();
  const quotesByDemand = new Map<string, Quote>([
    [demand.demandId, quote],
    ["dmd_w060c_second", quote],
  ]);
  return { aggregations: [aggregation], quotesByDemand };
}

/** A REAL aggregated order over two accepted quotes (LOCK 14). */
export function realAggregation(): AggregatedOrder {
  const demand = realDemand();
  const quote = realIssuedQuote();
  // A second accepted quote for a second demand sharing the
  // (vendor, deliveryArea, deadline) tuple.
  const demand2 = {
    ...demand,
    demandId: "dmd_w060c_second",
    description: "5 more laptops",
    quantity: 5,
  } as ProcurementDemand;
  const quote2 = {
    ...quote,
    quoteId: `${quote.quoteId}_2`,
    demandId: demand2.demandId,
    totalPriceUsd: 11_000,
  } as Quote;
  const result = aggregateAcceptedQuotes(
    TENANT_A,
    [
      { demand, quote },
      { demand: demand2, quote: quote2 },
    ],
    T3,
    CORR,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.aggregations[0] as AggregatedOrder;
}

// ---------------------------------------------------------------------------
// W042 — the real service work order + service matching + aggregation
// ---------------------------------------------------------------------------

/** A REAL W042 service work order (battery service, deadline 6 days out). */
export function realServiceWorkOrder(): ServiceWorkOrder {
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
    deadline: "2026-01-15T17:00:00Z",
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

/** The REAL service matching run (vendorA satisfiable, far rejected). */
export function realServiceMatches(): readonly ServiceVendorMatch[] {
  const result = matchServiceWorkOrder(
    realServiceWorkOrder(),
    [realVendorFar(), realVendorA()],
    { at: T1, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return [...result.matches, ...result.rejected];
}

// ---------------------------------------------------------------------------
// W050A — the real-typed connectivity submission + adopted record
// ---------------------------------------------------------------------------

/** A REAL-typed W050A ConnectivitySubmissionRecord (PARKED for approval). */
export function realParkedSubmission(): ConnectivitySubmissionRecord {
  return {
    tenantId: TENANT_A,
    submissionId: "adcos-sub-w060c0001",
    request: {
      tenantId: TENANT_A,
      intentRef: { intentId: asIntentId("int_w060c0001"), version: 1, createdAt: T0 },
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

/**
 * A REAL-typed W050A ConnectivityRecord: the adopted status timeline with
 * a DEGRADED revision (latency_degraded — machine-stable) then a
 * TERMINATED revision. The provider handle exists on the real record but
 * is NOT part of the surface seam.
 */
export function realConnectivityRecord(): ConnectivityRecord {
  return {
    tenantId: TENANT_A,
    connectivityId: "conn_w060c0001",
    handle: "opq_provider_handle_1" as ConnectivityRecord["handle"],
    intentRef: { intentId: asIntentId("int_w060c0001"), version: 1, createdAt: T0 },
    requestDigest: "0123456789abcdef",
    executionState: "TERMINATED",
    revisions: [
      {
        revision: 1,
        adoptedAt: T0,
        acceptedRequirements: {
          outcome: "secure_private_connectivity",
          properties: {
            isolation: "private",
            redundancy: "path_redundant",
            availabilityTarget: 0.999,
          },
          constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
          duration: { startAt: T0, endAt: T1 },
          security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
        },
        executionState: "ACTIVE",
        measurements: [
          { kind: "latency_ms", value: 32, measuredAt: T0, evidence: { key: "ev/1", sizeBytes: 10, hash: "h1", hashAlgorithm: "sha256" } },
          { kind: "throughput_mbps", value: 120, measuredAt: T0, evidence: { key: "ev/2", sizeBytes: 10, hash: "h2", hashAlgorithm: "sha256" } },
        ],
        degradation: { kind: "none" },
        failure: { kind: "none" },
        termination: null,
        contentDigest: "cccc0000dddd1111",
        priorDigest: null,
      },
      {
        revision: 2,
        adoptedAt: T1,
        acceptedRequirements: {
          outcome: "secure_private_connectivity",
          properties: {
            isolation: "private",
            redundancy: "path_redundant",
            availabilityTarget: 0.999,
          },
          constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
          duration: { startAt: T0, endAt: T1 },
          security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
        },
        executionState: "ACTIVE",
        measurements: [
          { kind: "latency_ms", value: 95, measuredAt: T1, evidence: { key: "ev/3", sizeBytes: 10, hash: "h3", hashAlgorithm: "sha256" } },
        ],
        degradation: { kind: "latency_degraded" },
        failure: { kind: "none" },
        termination: null,
        contentDigest: "cccc0000dddd2222",
        priorDigest: "cccc0000dddd1111",
      },
      {
        revision: 3,
        adoptedAt: T2,
        acceptedRequirements: {
          outcome: "secure_private_connectivity",
          properties: {
            isolation: "private",
            redundancy: "path_redundant",
            availabilityTarget: 0.999,
          },
          constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
          duration: { startAt: T0, endAt: T1 },
          security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
        },
        executionState: "TERMINATED",
        measurements: [],
        degradation: { kind: "none" },
        failure: { kind: "none" },
        termination: { reason: "duration_elapsed", terminatedAt: T2 },
        contentDigest: "cccc0000dddd3333",
        priorDigest: "cccc0000dddd2222",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// W050C — the real-typed outbox + delivery records (metadata-only)
// ---------------------------------------------------------------------------

/** A REAL-typed W050C OutboxEntry (a maintenance notice). */
export function realOutboxEntry(): OutboxEntry {
  return {
    sequence: 1,
    tenantId: TENANT_A,
    intent: {
      messageId: "aurum_msg_w060c0001",
      tenantId: TENANT_A,
      kind: "maintenance_notice",
      subjectRef: "swo_w060c_0001",
      recipient: { kind: "role", role: "fleet-ops" },
      priority: "normal",
      content: {
        title: "Maintenance notice: work order created",
        summary: "work order swo_w060c_0001 created for device dev_w060c_0001",
        fields: [
          { key: "workOrderId", value: "swo_w060c_0001", sensitivity: "machine" },
          { key: "deviceId", value: "dev_w060c_0001", sensitivity: "machine" },
        ],
      },
      redactedFieldKeys: [],
      contentDigest: "eeee0000ffff1111",
      emittedAt: T1,
      correlationId: CORR,
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

/** A REAL-typed W050C OutboxEntry (an approval request). */
export function realOutboxApprovalEntry(): OutboxEntry {
  return {
    sequence: 2,
    tenantId: TENANT_A,
    intent: {
      messageId: "aurum_msg_w060c0002",
      tenantId: TENANT_A,
      kind: "approval_request",
      subjectRef: "adcos-sub-w060c0001",
      recipient: { kind: "principal", principalId: "usr_w060c_0001" },
      priority: "high",
      content: {
        title: "Approval request: connectivity submission parked",
        summary: "connectivity submission adcos-sub-w060c0001 requires approval",
        fields: [
          { key: "submissionId", value: "adcos-sub-w060c0001", sensitivity: "machine" },
        ],
      },
      redactedFieldKeys: [],
      contentDigest: "eeee0000ffff2222",
      emittedAt: T1,
      correlationId: CORR,
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

/** REAL-typed W050C DeliveryRecords: queued -> sent -> delivered for one message. */
export function realDeliveryRecords(): readonly DeliveryRecord[] {
  return [
    {
      tenantId: TENANT_A,
      messageRef: "aurum_msg_w060c0001",
      deliveryAttempt: 1,
      state: "queued",
      recipient: { recipientRef: "role:fleet-ops", channel: "email" },
      disposition: "in_progress",
      ingestedAt: T1,
      correlationId: CORR,
      contentDigest: "aaaa1111",
      schemaVersion: 1,
    },
    {
      tenantId: TENANT_A,
      messageRef: "aurum_msg_w060c0001",
      deliveryAttempt: 1,
      state: "sent",
      recipient: { recipientRef: "role:fleet-ops", channel: "email" },
      disposition: "in_progress",
      ingestedAt: T2,
      correlationId: CORR,
      contentDigest: "aaaa2222",
      schemaVersion: 1,
    },
    {
      tenantId: TENANT_A,
      messageRef: "aurum_msg_w060c0001",
      deliveryAttempt: 1,
      state: "delivered",
      recipient: { recipientRef: "role:fleet-ops", channel: "email" },
      disposition: "succeeded",
      ingestedAt: T3,
      correlationId: CORR,
      contentDigest: "aaaa3333",
      schemaVersion: 1,
    },
  ];
}
