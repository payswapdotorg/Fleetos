/**
 * W072 D4/D5 tests — marketplace-quality evidence packs: fully-cited
 * claims composed from REAL scorecards + REAL reconciliation reports
 * + REAL aggregation measurements (structural twin bindings), the
 * citation discipline (no uncited numbers, ever), PROPOSAL-grade
 * status, the append-only ledger, tenant isolation, audit emission
 * (into the REAL hash-chained log), and byte-identical determinism.
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId, asTenantId, asVendorId, asWorkloadId } from "@fleetos/contracts";
import type { TenantId, VendorId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
// REAL lane packages injected at the binding sites (test scope only —
// src/ consumes them through the structural twins).
import {
  buildDemand,
  issueQuote,
  matchDemand,
  runCommercialReconciliation,
} from "@fleetos/procurement";
import { allocateSubscription, runSubscriptionReconciliation } from "@fleetos/software";
import {
  aggregateServiceWorkOrders,
  buildServiceWorkOrder,
  matchServiceWorkOrder,
  measureServiceAggregationOutcomes,
} from "@fleetos/maintenance";
import {
  ALL_EVIDENCE_CLAIM_KINDS,
  EVIDENCE_PACK_MODEL_VERSION,
  EVIDENCE_PACK_SCHEMA_VERSION,
  MARKETPLACE_EVIDENCE_AUDIT_ACTIONS,
  appendMarketplaceEvidencePack,
  buildMarketplaceEvidencePack,
  createInMemoryVendorsOutcomeAuditSink,
  createMarketplaceEvidencePackLedger,
  listPackHistory,
  projectCommercialReportToVendorImpacts,
  resolveLatestPack,
} from "../src/index";
import type {
  AggregationMeasurementSource,
  CommercialReportProjection,
  MarketplaceEvidencePack,
  MarketplaceEvidencePackLedger,
  VendorReconciliationImpact,
} from "../src/index";
import type { FleetError } from "@fleetos/contracts";
import type { VendorsOutcomeAuditSink } from "../src/index";
import { buildVendorScorecard } from "../src/scorecard";
import { buildVendor } from "../src/vendor";
import { CORR, T0, T1, VND_1, VND_2, createInput } from "./helpers";

/** Tenant A (the acting tenant). */
const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
/** Tenant B (the foreign tenant). */
const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");
/** The evaluation window (January 2026). */
const WINDOW = { from: T0, to: "2026-01-31T00:00:00Z" } as const;
/** A delivery/completion timestamp inside the window. */
const DONE_AT = "2026-01-15T00:00:00Z" as const;
/** A second correlation id. */
const CORR_2 = "cor_w072_pack0002" as never;

/** A REAL service-capable vendor for tenant A. */
function serviceVendor(vendorId: VendorId = VND_1) {
  const built = buildVendor(TENANT_A, {
    ...createInput(),
    vendorId,
    capabilities: [
      { kind: "service", id: "service.battery" },
      { kind: "device-class", id: "class.standard_laptop" },
    ],
    inventory: [
      {
        capability: { kind: "service", id: "service.battery" },
        availability: { ratio: 0.9 },
        leadTime: { days: 7 },
      },
      {
        capability: { kind: "device-class", id: "class.standard_laptop" },
        availability: { ratio: 0.9 },
        leadTime: { days: 7 },
      },
    ],
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.vendor;
}

/** A REAL scorecard revision for VND_1 (one delivered quote interaction). */
function realScorecard() {
  const built = buildVendorScorecard(
    TENANT_A,
    {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [
        {
          kind: "quote_acceptance",
          tenantId: TENANT_A,
          vendorId: VND_1,
          demandId: "dmd_w072pack00001",
          quoteId: "qt_w072pack000001",
          unitPriceUsd: 100,
          leadTimeDays: 7,
          warrantyDays: 365,
          slaCoverage: 0.95,
          acceptedAt: T0,
          delivered: true,
          deliveredAt: DONE_AT,
          deliveredUnitPriceUsd: 100,
          slaMet: true,
          warrantyHonored: true,
          closedAt: DONE_AT,
        },
      ],
      at: T1,
      correlationId: CORR,
    },
  );
  if (!built.ok) throw new Error(built.error.message);
  return built.scorecard;
}

/** A REAL procurement reconciliation report projected per vendor (the binding site). */
function realReconciliationImpacts(): VendorReconciliationImpact[] {
  const v = serviceVendor();
  const demandResult = buildDemand(TENANT_A, {
    procurementIntent: {
      workloadId: "wl_testworkload01",
      description: "Procure a standard laptop for the W072 pack binding test.",
    },
    quantity: 1,
    at: T0,
    deadline: "2026-02-01T00:00:00Z",
    deliveryArea: "us-east-1",
    budget: { usd: 2000 },
    slaFloor: { coverage: 0.8 },
    warrantyFloor: { days: 90 },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    allowedSubstitutions: ["class.standard_laptop"],
    correlationId: CORR,
  });
  if (!demandResult.ok) throw new Error(demandResult.error.message);
  const demand = demandResult.demand;
  const matched = matchDemand(demand, [v], { at: T0, correlationId: CORR });
  if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
  const quoteResult = issueQuote({
    demand,
    match: matched.matches[0]!,
    unitPriceUsd: 1500,
    leadTimeDays: 7,
    warrantyDays: 365,
    slaCoverage: 0.95,
    at: T0,
    correlationId: CORR,
  });
  if (!quoteResult.ok) throw new Error(quoteResult.error.message);
  const quote = quoteResult.quote;
  // Reconcile a price-drifted delivery against the REAL agreed quote.
  const reportResult = runCommercialReconciliation(
    TENANT_A,
    [
      {
        demand: {
          tenantId: demand.tenantId,
          demandId: demand.demandId,
          quantity: demand.quantity,
        },
        quote: {
          quoteId: quote.quoteId,
          vendorId: quote.vendorId,
          unitPriceUsd: quote.unitPriceUsd,
          slaCoverage: quote.slaCoverage,
          warrantyDays: quote.warrantyDays,
        },
        accepted: true,
        delivery: {
          deliveryId: `dlv_${quote.quoteId.slice(3)}`,
          deliveredQuantity: demand.quantity,
          deliveredUnitPriceUsd: 1600, // price drift
          deliveredSlaCoverage: quote.slaCoverage,
          deliveredWarrantyDays: quote.warrantyDays,
          deliveredAt: DONE_AT,
        },
      },
    ],
    { at: T1, correlationId: CORR },
  );
  if (!reportResult.ok) throw new Error(reportResult.error.message);
  const report = reportResult.report;
  expect(report.byKind.price_mismatch).toBe(1);
  // THE BINDING SITE: project the REAL report's discrepancies (both-side
  // refs verbatim) into the CommercialReportProjection twin.
  const projection: CommercialReportProjection = {
    reportId: report.reportId,
    tenantId: report.tenantId,
    discrepancies: report.discrepancies.map((d) => ({
      kind: d.kind,
      vendorId: d.vendorId,
      expectedRef: d.quoteRef,
      deliveredRef: d.deliveryRef,
    })),
  };
  return [...projectCommercialReportToVendorImpacts(projection)];
}

/** A REAL aggregation measurement projected into the twin (the binding site). */
function realMeasurement(): AggregationMeasurementSource {
  const v = serviceVendor();
  const pairs = ["p1", "p2"].map((suffix) => {
    const built = buildServiceWorkOrder(TENANT_A, {
      deviceId: asDeviceId(`dev_w072_pack_${suffix}`),
      diagnosis: {
        hypothesisId: `hyp_w072_pack_${suffix}`,
        recommendationId: `tr_w072_pack_${suffix}`,
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: {
          intentKind: "MaintainDeviceIntent",
          payload: { description: `Pack service ${suffix}.` },
        },
        observationIds: [`obs_w072_pack_${suffix}`],
      },
      serviceArea: "us-east-1",
      deadline: "2026-02-01T00:00:00Z",
      slaFloor: { coverage: 0.8 },
      warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
      qualityFloor: { score: 0.7 },
      availabilityFloor: { ratio: 0.5 },
      serviceCategory: "service.battery",
      at: T0,
      correlationId: CORR,
    });
    if (!built.ok) throw new Error(built.error.message);
    const matched = matchServiceWorkOrder(built.workOrder, [v], { at: T0, correlationId: CORR });
    if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
    return { workOrder: built.workOrder, match: matched.matches[0]! };
  });
  const grouped = aggregateServiceWorkOrders(TENANT_A, pairs, T0, CORR);
  if (!grouped.ok) throw new Error(grouped.error.message);
  const aggregation = grouped.aggregations[0]!;
  const measured = measureServiceAggregationOutcomes(
    TENANT_A,
    [aggregation],
    aggregation.memberWorkOrderIds.map((id) => ({
      workOrderId: id,
      vendorId: VND_1,
      completedAt: DONE_AT,
    })),
    { at: T1, correlationId: CORR },
  );
  if (!measured.ok) throw new Error(measured.error.message);
  const outcome = measured.outcomes[0]!;
  // THE BINDING SITE: project the REAL measurement field-for-field.
  return {
    outcomeId: outcome.outcomeId,
    tenantId: outcome.tenantId,
    aggregationId: outcome.aggregationId,
    vendorId: outcome.vendorId,
    coverageRatio: outcome.coverageRatio,
    servedCount: outcome.ordersServed,
    ordersAggregated: outcome.ordersAggregated,
    onTimeRatio: outcome.deadlineAdherence.onTimeRatio,
    vendorContributions: outcome.vendorContributions,
  };
}

/** Compose a pack for tenant A / VND_1 (throws on failure). */
function pack(overrides: {
  scorecard?: ReturnType<typeof realScorecard>;
  impacts?: readonly VendorReconciliationImpact[];
  measurements?: readonly AggregationMeasurementSource[];
  prior?: MarketplaceEvidencePack;
  at?: string;
} = {}): MarketplaceEvidencePack {
  const built = buildMarketplaceEvidencePack(TENANT_A, {
    vendorId: VND_1,
    scorecard: overrides.scorecard ?? realScorecard(),
    reconciliationImpacts: overrides.impacts ?? [],
    aggregationMeasurements: overrides.measurements ?? [],
    at: overrides.at ?? T1,
    correlationId: CORR,
    prior: overrides.prior,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.pack;
}

/** Narrow a failed tagged result's error to its DomainError invariant. */
function invariantOf(result: { readonly ok: false; readonly error: FleetError }): string {
  if (result.error.kind !== "DomainError" || result.error.invariant === undefined) {
    throw new Error(`expected DomainError with an invariant, got ${result.error.kind}`);
  }
  return result.error.invariant;
}

/** Append to the pack ledger (throws on failure). */
function packAppendOk(
  ledger: MarketplaceEvidencePackLedger,
  entry: MarketplaceEvidencePack,
): MarketplaceEvidencePackLedger {
  const appended = appendMarketplaceEvidencePack(ledger, entry);
  if (!appended.ok) throw new Error(appended.error.message);
  return appended.ledger;
}

describe("W072 D4: composition + the citation discipline (no uncited numbers)", () => {
  test("scorecard dimension claims cite the scorecard id plus the counted interaction refs", () => {
    const scorecard = realScorecard();
    const composed = pack({ scorecard });
    const fulfillment = composed.claims.find((c) => c.kind === "scorecard.fulfillment")!;
    expect(fulfillment).toBeDefined();
    expect(fulfillment.value).toBe(1);
    expect(fulfillment.sourceRefs).toEqual([scorecard.scorecardId, "qt_w072pack000001"]);
    // Every applicable dimension produces exactly one claim.
    const dimensionClaims = composed.claims.filter((c) => c.kind.startsWith("scorecard."));
    expect(dimensionClaims.length).toBe(4);
    // The not-applicable list is empty (every dimension had evidence).
    expect(composed.notApplicableScorecardDimensions).toEqual([]);
    expect(composed.sourceRecordIds).toEqual([scorecard.scorecardId]);
    expect(composed.claims.map((c) => c.kind).every((kind) =>
      (ALL_EVIDENCE_CLAIM_KINDS as readonly string[]).includes(kind),
    )).toBe(true);
  });

  test("a not-applicable dimension produces NO claim and is listed instead", () => {
    // A scorecard with ONLY match outcomes: every dimension null.
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [
        {
          kind: "match_outcome",
          tenantId: TENANT_A,
          vendorId: VND_1,
          demandId: "dmd_w072packmatch1",
          satisfiable: false,
          rankScore: 0,
          recordedAt: T0,
          closedAt: DONE_AT,
        },
      ],
      at: T1,
      correlationId: CORR,
    });
    if (!built.ok) throw new Error(built.error.message);
    const composed = pack({ scorecard: built.scorecard });
    expect(composed.claims.filter((c) => c.kind.startsWith("scorecard."))).toEqual([]);
    expect(composed.notApplicableScorecardDimensions).toEqual([
      "fulfillment",
      "quote_accuracy",
      "sla_adherence",
      "warranty_honoring",
    ]);
  });

  test("reconciliation claims cite the report id plus the both-side discrepancy refs", () => {
    const impacts = realReconciliationImpacts();
    expect(impacts.length).toBe(1);
    const impact = impacts[0]!;
    expect(impact.vendorId).toBe(VND_1);
    const composed = pack({ impacts });
    const claim = composed.claims.find((c) => c.kind === "reconciliation.price_mismatch")!;
    expect(claim).toBeDefined();
    expect(claim.value).toBe(1);
    // The refs cited: the report id + the agreed-side and delivered-side
    // refs of the counted discrepancy, verbatim.
    expect(claim.sourceRefs.length).toBe(3);
    expect(claim.sourceRefs[0]).toMatch(/^recon_/);
    expect(claim.sourceRefs.slice(1)).toEqual([
      // expectedRef then deliveredRef (both-side, in projection order)
      impact.byKind[0]!.refs[0],
      impact.byKind[0]!.refs[1],
    ]);
    expect(claim.sourceRefs.slice(1)).toEqual(
      impact.byKind[0]!.refs.slice(0, 2),
    );
  });

  test("measurement claims cite the measurement id + aggregation id (+ member refs for contributions)", () => {
    const measurement = realMeasurement();
    const composed = pack({ measurements: [measurement] });
    const coverage = composed.claims.find((c) => c.kind === "aggregation.coverage_ratio")!;
    expect(coverage.value).toBe(1);
    expect(coverage.sourceRefs).toEqual([measurement.outcomeId, measurement.aggregationId]);
    const onTime = composed.claims.find((c) => c.kind === "aggregation.on_time_ratio")!;
    expect(onTime.value).toBe(1);
    const contribution = composed.claims.find((c) => c.kind === "aggregation.contribution_count")!;
    expect(contribution.value).toBe(2);
    expect(contribution.sourceRefs.slice(0, 2)).toEqual([
      measurement.outcomeId,
      measurement.aggregationId,
    ]);
    expect(contribution.sourceRefs.slice(2)).toEqual(
      measurement.vendorContributions[0]!.memberRefs,
    );
  });

  test("an uncited claim REFUSES (a count with no refs — fail closed)", () => {
    const scorecard = realScorecard();
    const built = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard,
      reconciliationImpacts: [
        {
          reportId: "recon_w072uncited",
          tenantId: TENANT_A,
          vendorId: VND_1,
          byKind: [{ kind: "price_mismatch", count: 3, refs: [] }],
        },
      ],
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.code).toBe("vendors.evidencepack.invalid_request");
    expect(JSON.stringify(built.error)).toContain("uncited_claim");
  });

  test("zero-count kinds produce no claims (no number, no claim)", () => {
    const scorecard = realScorecard();
    const composed = pack({
      impacts: [
        {
          reportId: "recon_w072zeros000",
          tenantId: TENANT_A,
          vendorId: VND_1,
          byKind: [{ kind: "sla_breach", count: 0, refs: [] }],
        },
      ],
    });
    expect(composed.claims.find((c) => c.kind === "reconciliation.sla_breach")).toBeUndefined();
    expect(composed.sourceRecordIds).toContain("recon_w072zeros000");
  });
});

describe("W072 D4: PROPOSAL-grade (never auto-published)", () => {
  test("every pack is born PROPOSAL; the record is frozen", () => {
    const composed = pack({ impacts: realReconciliationImpacts(), measurements: [realMeasurement()] });
    expect(composed.status).toBe("PROPOSAL");
    expect(Object.isFrozen(composed)).toBe(true);
    expect(Object.isFrozen(composed.claims)).toBe(true);
    // The status type admits only PROPOSAL (compile-time contract); the
    // surface exports no publish/accept transition.
    const status: MarketplaceEvidencePack["status"] = composed.status;
    expect(status).toBe("PROPOSAL");
  });

  test("revision 1 carries no supersedes; schema/model versions stamped", () => {
    const composed = pack();
    expect(composed.revision).toBe(1);
    expect(composed.supersedes).toBeUndefined();
    expect(composed.packId).toMatch(/^mep_[0-9a-f]{8}$/);
    expect(composed.schemaVersion).toBe(EVIDENCE_PACK_SCHEMA_VERSION);
    expect(composed.modelVersion).toBe(EVIDENCE_PACK_MODEL_VERSION);
    // The window is carried verbatim from the scorecard.
    expect(composed.window).toEqual(WINDOW);
  });
});

describe("W072 D4: source validation (fail closed)", () => {
  test("a source for a foreign vendor refuses (foreign_source)", () => {
    const scorecard = realScorecard();
    const built = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard,
      reconciliationImpacts: [
        {
          reportId: "recon_w072foreign01",
          tenantId: TENANT_A,
          vendorId: VND_2,
          byKind: [{ kind: "price_mismatch", count: 1, refs: ["a", "b"] }],
        },
      ],
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("foreign_source");
  });

  test("a source from a foreign tenant refuses (tenant_mismatch)", () => {
    const scorecard = realScorecard();
    const built = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard,
      reconciliationImpacts: [],
      aggregationMeasurements: [
        {
          outcomeId: "mout_w072foreign01",
          tenantId: TENANT_B,
          aggregationId: "magg_w072foreign01",
          vendorId: VND_1,
          coverageRatio: 0.5,
          servedCount: 1,
          ordersAggregated: 2,
          onTimeRatio: null,
          vendorContributions: [],
        },
      ],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("tenant_mismatch");
  });

  test("a duplicate source record id refuses (duplicate_source)", () => {
    const scorecard = realScorecard();
    const measurement = realMeasurement();
    const built = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard,
      reconciliationImpacts: [],
      aggregationMeasurements: [measurement, { ...measurement }],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("duplicate_source");
  });

  test("a scorecard for another vendor/tenant refuses (scorecard_scope_mismatch)", () => {
    const foreignScorecard = buildVendorScorecard(TENANT_B, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [
        {
          kind: "quote_acceptance",
          tenantId: TENANT_B,
          vendorId: VND_1,
          demandId: "dmd_w072foreign02",
          quoteId: "qt_w072foreign0002",
          unitPriceUsd: 100,
          leadTimeDays: 7,
          warrantyDays: 365,
          slaCoverage: 0.95,
          acceptedAt: T0,
          delivered: true,
          deliveredAt: DONE_AT,
          deliveredUnitPriceUsd: 100,
          slaMet: true,
          warrantyHonored: true,
          closedAt: DONE_AT,
        },
      ],
      at: T1,
      correlationId: CORR,
    });
    if (!foreignScorecard.ok) throw new Error(foreignScorecard.error.message);
    const built = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard: foreignScorecard.scorecard,
      reconciliationImpacts: [],
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(invariantOf(built)).toBe("scorecard_scope_mismatch");
  });
});

describe("W072 D4: supersession + the append-only ledger", () => {
  test("a revision cites the prior via supersedes; the ledger enforces the chain", () => {
    const first = pack();
    const second = pack({ prior: first, measurements: [realMeasurement()] });
    expect(second.revision).toBe(2);
    expect(second.supersedes).toBe(first.packId);
    const ledger = packAppendOk(
      packAppendOk(createMarketplaceEvidencePackLedger(TENANT_A), first),
      second,
    );
    expect(resolveLatestPack(ledger, VND_1)?.revision).toBe(2);
    expect(listPackHistory(ledger, VND_1).map((p) => p.revision)).toEqual([1, 2]);
    // A duplicate pack id refuses.
    const dup = appendMarketplaceEvidencePack(ledger, first);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(invariantOf(dup)).toBe("duplicate_pack");
    // A revision without its prior refuses.
    const gap = appendMarketplaceEvidencePack(
      createMarketplaceEvidencePackLedger(TENANT_A),
      second,
    );
    expect(gap.ok).toBe(false);
    if (gap.ok) return;
    expect(invariantOf(gap)).toBe("revision_gap");
  });

  test("a foreign-tenant pack refuses to append; foreign lookups are indistinguishable from unknown", () => {
    const foreign = buildMarketplaceEvidencePack(TENANT_B, {
      vendorId: VND_1,
      scorecard: (() => {
        const built = buildVendorScorecard(TENANT_B, {
          vendorId: VND_1,
          window: WINDOW,
          interactions: [
            {
              kind: "match_outcome",
              tenantId: TENANT_B,
              vendorId: VND_1,
              demandId: "dmd_w072foreign03",
              satisfiable: true,
              rankScore: 0.9,
              recordedAt: T0,
              closedAt: DONE_AT,
            },
          ],
          at: T1,
          correlationId: CORR,
        });
        if (!built.ok) throw new Error(built.error.message);
        return built.scorecard;
      })(),
      reconciliationImpacts: [],
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR,
    });
    if (!foreign.ok) throw new Error(foreign.error.message);
    const appended = appendMarketplaceEvidencePack(
      createMarketplaceEvidencePackLedger(TENANT_A),
      foreign.pack,
    );
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(invariantOf(appended)).toBe("tenant_mismatch");
    const own = pack();
    const ledger = packAppendOk(createMarketplaceEvidencePackLedger(TENANT_A), own);
    expect(resolveLatestPack(ledger, VND_1)?.packId).toBe(own.packId);
    expect(resolveLatestPack(ledger, VND_2)).toBeUndefined();
    expect(listPackHistory(ledger, VND_2)).toEqual([]);
  });
});

describe("W072 D4: the report projection helper (pure, deterministic)", () => {
  test("projectCommercialReportToVendorImpacts groups per vendor with canonical kind order", () => {
    const projection: CommercialReportProjection = {
      reportId: "recon_w072proj00001",
      tenantId: TENANT_A,
      discrepancies: [
        { kind: "undelivered", vendorId: VND_2, expectedRef: "qt_b", deliveredRef: null },
        { kind: "price_mismatch", vendorId: VND_1, expectedRef: "qt_a", deliveredRef: "dlv_a" },
        { kind: "price_mismatch", vendorId: VND_2, expectedRef: "qt_c", deliveredRef: "dlv_c" },
        { kind: "sla_breach", vendorId: VND_1, expectedRef: "qt_d", deliveredRef: "dlv_d" },
      ],
    };
    const impacts = projectCommercialReportToVendorImpacts(projection);
    expect(impacts.map((i) => i.vendorId as string)).toEqual([VND_1 as string, VND_2 as string]);
    const vnd1 = impacts[0]!;
    expect(vnd1.reportId).toBe("recon_w072proj00001");
    expect(vnd1.byKind.map((k) => k.kind)).toEqual(["price_mismatch", "sla_breach"]);
    expect(vnd1.byKind[0]!.refs).toEqual(["qt_a", "dlv_a"]);
    const vnd2 = impacts[1]!;
    expect(vnd2.byKind.map((k) => k.kind)).toEqual(["price_mismatch", "undelivered"]);
    // The undelivered discrepancy has NO delivered ref — one-sided refs
    // stay one-sided (both-side refs verbatim).
    expect(vnd2.byKind[1]!.refs).toEqual(["qt_b"]);
    // Deterministic across input permutations.
    const shuffled = projectCommercialReportToVendorImpacts({
      ...projection,
      discrepancies: [...projection.discrepancies].reverse(),
    });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(impacts));
  });
});

describe("W072 D5: audit emission (the injected sink seam)", () => {
  test("a successful compose emits exactly one vendors.marketplace.pack.composed record; failures emit none", () => {
    const sink = createInMemoryVendorsOutcomeAuditSink();
    const ok = buildMarketplaceEvidencePack(
      TENANT_A,
      {
        vendorId: VND_1,
        scorecard: realScorecard(),
        reconciliationImpacts: [],
        aggregationMeasurements: [],
        at: T1,
        correlationId: CORR,
      },
      sink,
    );
    expect(ok.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe(MARKETPLACE_EVIDENCE_AUDIT_ACTIONS.packComposed);
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(ok.ok ? ok.pack.packId : null);
    expect(record.occurredAt).toBe(T1);
    expect(record.correlationId).toBe(CORR);
    const details = record.details as {
      revision: number;
      status: string;
      claimCount: number;
      proposalGrade: boolean;
    };
    expect(details.revision).toBe(1);
    expect(details.status).toBe("PROPOSAL");
    expect(details.claimCount).toBeGreaterThan(0);
    expect(details.proposalGrade).toBe(true);

    const failed = buildMarketplaceEvidencePack(
      TENANT_A,
      {
        vendorId: VND_1,
        scorecard: realScorecard(),
        reconciliationImpacts: [
          {
            reportId: "recon_w072auditfail",
            tenantId: TENANT_A,
            vendorId: VND_2,
            byKind: [],
          },
        ],
        aggregationMeasurements: [],
        at: T1,
        correlationId: CORR,
      },
      sink,
    );
    expect(failed.ok).toBe(false);
    expect(sink.records.length).toBe(1);
  });

  test("the W012 sink adapter satisfies VendorsOutcomeAuditSink; records land in the REAL hash-chained log", () => {
    const log = createInMemoryAuditLog();
    const sink: VendorsOutcomeAuditSink = createAuditSinkAdapter(log, {
      source: "vendors.evidencepack.test",
    });
    buildMarketplaceEvidencePack(
      TENANT_A,
      {
        vendorId: VND_1,
        scorecard: realScorecard(),
        reconciliationImpacts: realReconciliationImpacts(),
        aggregationMeasurements: [realMeasurement()],
        at: T1,
        correlationId: CORR,
      },
      sink,
    );
    const ctx = makeTenantContext(TENANT_A, CORR);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    expect(records[0]!.action).toBe("vendors.marketplace.pack.composed");
    expect(records[0]!.source).toBe("vendors.evidencepack.test");
    expect(log.verify(ctx).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(log.records(makeTenantContext(TENANT_B, CORR)).length).toBe(0);
  });
});

describe("W072 D5: byte-identical determinism", () => {
  test("the same sources produce the byte-identical pack across runs", () => {
    const impacts = realReconciliationImpacts();
    const measurement = realMeasurement();
    const a = pack({ impacts, measurements: [measurement] });
    const b = pack({ impacts, measurements: [measurement] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.packId).toBe(b.packId);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("source input order NEVER matters (permutation invariance)", () => {
    const impacts = realReconciliationImpacts();
    const measurement = realMeasurement();
    const forward = pack({ impacts, measurements: [measurement] });
    const extraImpact: VendorReconciliationImpact = {
      reportId: "recon_w072perm00001",
      tenantId: TENANT_A,
      vendorId: VND_1,
      byKind: [{ kind: "warranty_gap", count: 1, refs: ["qt_x", "dlv_x"] }],
    };
    const shuffled = pack({
      impacts: [extraImpact, ...impacts],
      measurements: [measurement],
    });
    // Same sources in a different order compose the identical pack.
    const canonical = pack({
      impacts: [...impacts, extraImpact],
      measurements: [measurement],
    });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(canonical));
    // And the first composition (fewer sources) is a distinct record.
    expect(JSON.stringify(forward)).not.toBe(JSON.stringify(canonical));
    // Claims are in canonical order (kind, then sourceRefs).
    const kinds = canonical.claims.map((c) => c.kind);
    expect(kinds).toEqual([...kinds].sort());
  });

  test("the correlation id changes nothing structural (input-scoped determinism)", () => {
    const impacts = realReconciliationImpacts();
    const a = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard: realScorecard(),
      reconciliationImpacts: impacts,
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR,
    });
    const b = buildMarketplaceEvidencePack(TENANT_A, {
      vendorId: VND_1,
      scorecard: realScorecard(),
      reconciliationImpacts: impacts,
      aggregationMeasurements: [],
      at: T1,
      correlationId: CORR_2,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.pack)).toBe(JSON.stringify(b.pack));
  });
});

describe("W072 D5: full composition over three REAL sources end to end", () => {
  test("a pack composed from a REAL scorecard + REAL reports + REAL measurements carries only cited claims", () => {
    const scorecard = realScorecard();
    const impacts = realReconciliationImpacts();
    const measurement = realMeasurement();
    const composed = pack({ scorecard, impacts, measurements: [measurement] });
    // Every claim cites at least one source ref (no uncited numbers).
    for (const claim of composed.claims) {
      expect(claim.sourceRefs.length).toBeGreaterThan(0);
      expect(claim.sourceRefs.every((ref) => typeof ref === "string" && ref.length > 0)).toBe(
        true,
      );
    }
    // The source record ids are the union of the composed sources.
    expect(composed.sourceRecordIds).toEqual(
      [scorecard.scorecardId, impacts[0]!.reportId, measurement.outcomeId].sort(),
    );
    // The window is carried verbatim from the scorecard.
    expect(composed.window).toEqual(scorecard.window);
    // Claim kinds present: four scorecard dimensions + one price_mismatch
    // + coverage/on-time/contribution.
    const kinds = composed.claims.map((c) => c.kind);
    expect(kinds).toContain("scorecard.fulfillment");
    expect(kinds).toContain("reconciliation.price_mismatch");
    expect(kinds).toContain("aggregation.coverage_ratio");
    expect(kinds).toContain("aggregation.contribution_count");
    // PROPOSAL-grade, always.
    expect(composed.status).toBe("PROPOSAL");
  });

  test("a REAL software subscription report also feeds the pack through the twin", () => {
    const allocated = allocateSubscription(TENANT_A, {
      softwareIntent: { softwareId: "app.bi_dashboard", seatCount: 5 },
      workloadId: asWorkloadId("wl_testworkload01"),
      termDays: 365,
      at: T0,
      correlationId: CORR,
    });
    if (!allocated.ok) throw new Error(allocated.error.message);
    const subscription = allocated.subscription;
    const reportResult = runSubscriptionReconciliation(
      TENANT_A,
      [
        {
          subscription: {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.subscriptionId,
            softwareId: subscription.softwareId,
            agreedSeatCount: subscription.seatCount,
            agreedTermDays: subscription.termDays,
          },
          agreed: { unitPriceUsd: 20, slaCoverage: 0.95, warrantyDays: 90 },
          provision: {
            provisionId: `prv_${subscription.subscriptionId.slice(4)}`,
            provisionedSeatCount: subscription.seatCount - 2, // short
            provisionedTermDays: subscription.termDays,
            deliveredUnitPriceUsd: 20,
            deliveredSlaCoverage: 0.95,
            deliveredWarrantyDays: 90,
            provisionedAt: DONE_AT,
          },
        },
      ],
      { at: T1, correlationId: CORR },
    );
    if (!reportResult.ok) throw new Error(reportResult.error.message);
    const report = reportResult.report;
    expect(report.byKind.undelivered).toBe(1);
    // THE BINDING SITE: the software report projects through the SAME
    // twin (the five-kind vocabulary is shared).
    const projection: CommercialReportProjection = {
      reportId: report.reportId,
      tenantId: report.tenantId,
      discrepancies: report.discrepancies.map((d) => ({
        kind: d.kind,
        vendorId: asVendorId("vnd_testvendor0001"),
        expectedRef: d.subscriptionRef,
        deliveredRef: d.provisionRef,
      })),
    };
    const impacts = projectCommercialReportToVendorImpacts(projection);
    // The projected vendor is the pack's vendor (binding-site decision).
    const composed = pack({ impacts });
    const claim = composed.claims.find((c) => c.kind === "reconciliation.undelivered")!;
    expect(claim.value).toBe(1);
    expect(claim.sourceRefs[0]).toMatch(/^srecon_/);
    expect(composed.sourceRecordIds).toContain(report.reportId);
  });
});
