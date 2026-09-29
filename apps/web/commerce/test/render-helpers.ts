/**
 * W090C web-commerce — render/outcome test helpers.
 *
 * Constructs the REAL W072 + reconciliation records with the REAL
 * same-lane builders (vendor scorecards + marketplace evidence packs
 * from @fleetos/vendors, the measured service aggregation outcome +
 * the service aggregation from @fleetos/maintenance, the commercial
 * and subscription reconciliation reports, the adopted ACTIVE
 * connectivity record), so the W090C outcome view-models and rendered
 * screens are exercised end-to-end exactly as the shell will bind
 * them. Builds on the W060C binding-site helpers (`./helpers`).
 *
 * The ownership gate permits these cross-lane imports in `test/` ONLY.
 */

import { buildVendorScorecard } from "@fleetos/vendors";
import type { VendorScorecard } from "@fleetos/vendors";
import { buildMarketplaceEvidencePack } from "@fleetos/vendors";
import type { MarketplaceEvidencePack } from "@fleetos/vendors";
import {
  aggregateServiceWorkOrders,
  measureServiceAggregationOutcome,
  buildServiceWorkOrder,
  matchServiceWorkOrder,
} from "@fleetos/maintenance";
import type { AggregatedServiceOrder, ServiceAggregationOutcome, ServiceWorkOrder } from "@fleetos/maintenance";
import { runCommercialReconciliation } from "@fleetos/procurement";
import type { CommercialReconciliationReport } from "@fleetos/procurement";
import { allocateSubscription, runSubscriptionReconciliation } from "@fleetos/software";
import type {
  SoftwareSubscription,
  SubscriptionReconciliationReport,
} from "@fleetos/software";
import type { ConnectivityRecord } from "@fleetos/integration-adcos";
import { asDeviceId, asVendorId } from "@fleetos/contracts";
import {
  CORR,
  NOW,
  T0,
  T1,
  T2,
  T3,
  TENANT_A,
  WORKLOAD_ID,
  realDemand,
  realIssuedQuote,
  realServiceWorkOrder,
  realVendorA,
} from "./helpers";

// ---------------------------------------------------------------------------
// The W072 vendor scorecard + marketplace evidence pack (REAL builders)
// ---------------------------------------------------------------------------

/** A REAL W072 vendor scorecard over closed interactions. */
export function realScorecard(): VendorScorecard {
  const built = buildVendorScorecard(TENANT_A, {
    vendorId: asVendorId("vnd_w060c_aaaa"),
    window: { from: T0, to: T3 },
    interactions: [
      {
        kind: "match_outcome",
        tenantId: TENANT_A,
        vendorId: asVendorId("vnd_w060c_aaaa"),
        demandId: realDemand().demandId,
        satisfiable: true,
        rankScore: 1,
        recordedAt: T0,
        closedAt: T1,
      },
      {
        kind: "quote_acceptance",
        tenantId: TENANT_A,
        vendorId: asVendorId("vnd_w060c_aaaa"),
        demandId: realDemand().demandId,
        quoteId: realIssuedQuote().quoteId,
        unitPriceUsd: 2_200,
        leadTimeDays: 5,
        warrantyDays: 730,
        slaCoverage: 0.9,
        acceptedAt: T2,
        delivered: true,
        deliveredAt: T3,
        deliveredUnitPriceUsd: 2_200,
        slaMet: true,
        warrantyHonored: true,
        closedAt: T3,
      },
      {
        kind: "service_work_order_outcome",
        tenantId: TENANT_A,
        vendorId: asVendorId("vnd_w060c_aaaa"),
        workOrderId: realServiceWorkOrder().workOrderId,
        serviceArea: "us-east",
        deadline: "2026-01-15T17:00:00Z",
        completed: true,
        completedAt: T2,
        slaMet: true,
        warrantyHonored: true,
        closedAt: T3,
      },
    ],
    at: T3,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.scorecard;
}

/** A REAL W072 marketplace evidence pack over the scorecard. */
export function realEvidencePack(): MarketplaceEvidencePack {
  const built = buildMarketplaceEvidencePack(TENANT_A, {
    vendorId: asVendorId("vnd_w060c_aaaa"),
    scorecard: realScorecard(),
    reconciliationImpacts: [],
    aggregationMeasurements: [
      {
        outcomeId: "mout_w090c0001",
        tenantId: TENANT_A,
        aggregationId: "agg_w090c0001",
        vendorId: asVendorId("vnd_w060c_aaaa"),
        coverageRatio: 1,
        servedCount: 1,
        ordersAggregated: 1,
        onTimeRatio: 1,
        vendorContributions: [
          { vendorId: asVendorId("vnd_w060c_aaaa"), completedCount: 1, memberRefs: [realServiceWorkOrder().workOrderId] },
        ],
      },
    ],
    at: T3,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.pack;
}

// ---------------------------------------------------------------------------
// The W042 aggregated service order + the W072 measured outcome
// ---------------------------------------------------------------------------

/** A REAL W042 aggregated service order over the matched work order. */
export function realServiceAggregation(): AggregatedServiceOrder {
  const workOrder = realServiceWorkOrder();
  const matched = matchServiceWorkOrder(workOrder, [realVendorA()], {
    at: T1,
    correlationId: CORR,
  });
  if (!matched.ok) throw new Error(matched.error.message);
  const result = aggregateServiceWorkOrders(
    TENANT_A,
    [{ workOrder, match: matched.matches[0] as never }],
    T2,
    CORR,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.aggregations[0] as AggregatedServiceOrder;
}

/** A REAL W072 measured service aggregation outcome (full coverage — VERIFIED). */
export function realMaintenanceOutcome(): ServiceAggregationOutcome {
  const aggregation = realServiceAggregation();
  const workOrder = realServiceWorkOrder();
  const measured = measureServiceAggregationOutcome(
    TENANT_A,
    aggregation,
    [{ workOrderId: workOrder.workOrderId, vendorId: asVendorId("vnd_w060c_aaaa"), completedAt: T2 }],
    { at: T3, correlationId: CORR },
  );
  if (!measured.ok) throw new Error(measured.error.message);
  return measured.outcome;
}

/** A second REAL work order (for a two-member aggregation). */
export function realSecondWorkOrder(): ServiceWorkOrder {
  const built = buildServiceWorkOrder(TENANT_A, {
    deviceId: asDeviceId("dev_w060c_0002"),
    diagnosis: {
      hypothesisId: "hyp_w060c_0002",
      recommendationId: "trt_w060c_0002",
      causeId: "health.keyboard_fault",
      confidence: 0.75,
      proposedIntent: {
        intentKind: "MaintainDeviceIntent",
        payload: { deviceId: "dev_w060c_0002", description: "Keyboard replacement" },
      },
      observationIds: ["obs_w060c_0201"],
    },
    serviceArea: "us-east",
    deadline: "2026-01-15T17:00:00Z",
    slaFloor: { coverage: 0.8 },
    warrantyRules: { warrantyFloor: { days: 365 }, requireInWarranty: true },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    serviceCategory: "service.keyboard",
    at: T1,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.workOrder;
}

// ---------------------------------------------------------------------------
// The W032 reconciliations (order + entitlement verification evidence)
// ---------------------------------------------------------------------------

/** A REAL commercial reconciliation report (one delivered, agreeing chain). */
export function realCommercialReconciliation(): CommercialReconciliationReport {
  const demand = realDemand();
  const quote = realIssuedQuote();
  const report = runCommercialReconciliation(
    TENANT_A,
    [
      {
        demand: { tenantId: TENANT_A, demandId: demand.demandId, quantity: demand.quantity },
        quote: {
          quoteId: quote.quoteId,
          vendorId: quote.vendorId,
          unitPriceUsd: quote.unitPriceUsd,
          slaCoverage: quote.slaCoverage,
          warrantyDays: quote.warrantyDays,
        },
        accepted: true,
        delivery: {
          deliveryId: "dlv_w090c0001",
          deliveredQuantity: demand.quantity,
          deliveredUnitPriceUsd: quote.unitPriceUsd,
          deliveredSlaCoverage: quote.slaCoverage,
          deliveredWarrantyDays: quote.warrantyDays,
          deliveredAt: T3,
        },
      },
    ],
    { at: NOW, correlationId: CORR },
  );
  if (!report.ok) throw new Error(report.error.message);
  return report.report;
}

/** A REAL software subscription (allocated for the workload's need). */
export function realSoftwareSubscription(): SoftwareSubscription {
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

/** A REAL subscription reconciliation report (one provisioned, agreeing chain). */
export function realSubscriptionReconciliation(): SubscriptionReconciliationReport {
  const subscription = realSoftwareSubscription();
  const report = runSubscriptionReconciliation(
    TENANT_A,
    [
      {
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: subscription.subscriptionId,
          softwareId: subscription.softwareId,
          agreedSeatCount: subscription.seatCount,
          agreedTermDays: subscription.termDays,
        },
        agreed: { unitPriceUsd: 120, slaCoverage: 0.9, warrantyDays: 365 },
        provision: {
          provisionId: "prv_w090c0001",
          provisionedSeatCount: subscription.seatCount,
          provisionedTermDays: subscription.termDays,
          deliveredUnitPriceUsd: 120,
          deliveredSlaCoverage: 0.9,
          deliveredWarrantyDays: 365,
          provisionedAt: T2,
        },
      },
    ],
    { at: NOW, correlationId: CORR },
  );
  if (!report.ok) throw new Error(report.error.message);
  return report.report;
}

// ---------------------------------------------------------------------------
// The W050A adopted ACTIVE connectivity record (the VERIFIED outcome)
// ---------------------------------------------------------------------------

/**
 * A REAL-typed W050A ConnectivityRecord whose latest revision is ACTIVE
 * with measurements and no failure — the VERIFIED connectivity outcome
 * (joined to the submission by the originating intent id).
 */
export function realVerifiedConnectivityRecord(): ConnectivityRecord {
  return {
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
}

/**
 * A REAL W032 software subscription whose 17-day term (allocated at T1)
 * ends 14 days after the frozen NOW — the EXPIRING lifecycle state
 * (inside the 30-day window).
 */
export function realExpiringSubscription(): SoftwareSubscription {
  const allocated = allocateSubscription(TENANT_A, {
    softwareIntent: { softwareId: "app.design_suite", seatCount: 6 },
    workloadId: WORKLOAD_ID,
    termDays: 17,
    at: T1,
    correlationId: CORR,
  });
  if (!allocated.ok) throw new Error(allocated.error.message);
  return allocated.subscription;
}

/**
 * A REAL W032 software subscription whose 2-day term (allocated at T1)
 * ended one day before the frozen NOW — the EXPIRED lifecycle state.
 */
export function realExpiredSubscription(): SoftwareSubscription {
  const allocated = allocateSubscription(TENANT_A, {
    softwareIntent: { softwareId: "app.analytics_suite", seatCount: 3 },
    workloadId: WORKLOAD_ID,
    termDays: 2,
    at: T1,
    correlationId: CORR,
  });
  if (!allocated.ok) throw new Error(allocated.error.message);
  return allocated.subscription;
}
