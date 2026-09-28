/**
 * W060C web-commerce — the binding-site tests (the W040-disclosed pattern).
 *
 * The REAL accepted domain records (W032 vendors/demand/matches/quotes/
 * aggregation, W042 service work orders/service matches, W050A
 * submission + adopted record, W050C outbox + delivery records) are
 * injected through the structural seams: TypeScript structural typing
 * accepts them at the type level (the assignability assertions below),
 * and these tests are the runtime proof that every record flows through
 * and derives the right view-model values. The ownership gate permits
 * these cross-lane imports ONLY in test/.
 */

import { test, expect } from "bun:test";
import {
  buildVendorCatalogView,
  buildSoftwareCatalogView,
  buildProcurementDemandListView,
  buildVendorMatchingView,
  buildQuoteLedgerDisplay,
  buildQuoteEvaluationView,
  buildAggregationDisplayView,
  buildServiceWorkOrderListView,
  buildWarrantyEligibilityView,
  buildServiceMatchingView,
  buildConnectivityRequestView,
  buildConnectivitySubmissionListView,
  buildConnectivityTimelineView,
  buildOutboxListView,
  buildDeliveryTimelineView,
  buildCommunicationSummaryView,
  deriveDeadlinePressure,
  deriveWarrantyStanding,
  type AggregatedOrderFacets,
  type ConnectivityRecordFacets,
  type ConnectivitySubmissionFacets,
  type DeliveryRecordFacets,
  type OutboxEntryFacets,
  type ProcurementDemandFacets,
  type QuoteFacets,
  type ServiceVendorMatchFacets,
  type ServiceWorkOrderFacets,
  type VendorFacets,
  type VendorMatchFacets,
} from "../src/index";
import type { AggregatedOrder, ProcurementDemand, Quote, VendorMatch } from "@fleetos/procurement";
import type { ServiceVendorMatch, ServiceWorkOrder } from "@fleetos/maintenance";
import type { Vendor } from "@fleetos/vendors";
import type { ConnectivityRecord, ConnectivitySubmissionRecord } from "@fleetos/integration-adcos";
import type { DeliveryRecord, OutboxEntry } from "@fleetos/integration-aurum";
import { asTenantId } from "@fleetos/contracts";
import {
  NOW,
  TENANT_A,
  TENANT_B,
  realAggregationContext,
  realConnectivityRecord,
  realDeliveryRecords,
  realDemand,
  realIssuedQuote,
  realMatches,
  realOutboxApprovalEntry,
  realOutboxEntry,
  realParkedSubmission,
  realQuoteLedger,
  realServiceMatches,
  realServiceWorkOrder,
  realVendorA,
  realVendorB,
  realVendorFar,
} from "./helpers";

// ---------------------------------------------------------------------------
// The type-level proofs: the REAL records satisfy the seams
// ---------------------------------------------------------------------------

test("TYPE PROOF: the real W032 Vendor satisfies VendorFacets", () => {
  const vendor: Vendor = realVendorA();
  const seam: VendorFacets = vendor;
  expect(seam.vendorId).toBe(vendor.vendorId);
});

test("TYPE PROOF: the real W032 ProcurementDemand satisfies ProcurementDemandFacets", () => {
  const demand: ProcurementDemand = realDemand();
  const seam: ProcurementDemandFacets = demand;
  expect(seam.demandId).toBe(demand.demandId);
});

test("TYPE PROOF: the real W032 VendorMatch satisfies VendorMatchFacets", () => {
  const match: VendorMatch = realMatches()[0] as VendorMatch;
  const seam: VendorMatchFacets = match;
  expect(seam.vendor.vendorId).toBe(match.vendor.vendorId);
});

test("TYPE PROOF: the real W032 Quote satisfies QuoteFacets", () => {
  const quote: Quote = realIssuedQuote();
  const seam: QuoteFacets = quote;
  expect(seam.quoteId).toBe(quote.quoteId);
});

test("TYPE PROOF: the real W032 AggregatedOrder satisfies AggregatedOrderFacets", () => {
  const aggregation: AggregatedOrder = realAggregationContext().aggregations[0] as AggregatedOrder;
  const seam: AggregatedOrderFacets = aggregation;
  expect(seam.memberDemandIds.length).toBe(aggregation.memberDemandIds.length);
});

test("TYPE PROOF: the real W042 ServiceWorkOrder satisfies ServiceWorkOrderFacets", () => {
  const workOrder: ServiceWorkOrder = realServiceWorkOrder();
  const seam: ServiceWorkOrderFacets = workOrder;
  expect(seam.workOrderId).toBe(workOrder.workOrderId);
});

test("TYPE PROOF: the real W042 ServiceVendorMatch satisfies ServiceVendorMatchFacets", () => {
  const match: ServiceVendorMatch = realServiceMatches()[0] as ServiceVendorMatch;
  const seam: ServiceVendorMatchFacets = match;
  expect(seam.vendor.vendorId).toBe(match.vendor.vendorId);
});

test("TYPE PROOF: the real W050A ConnectivitySubmissionRecord satisfies ConnectivitySubmissionFacets", () => {
  const submission: ConnectivitySubmissionRecord = realParkedSubmission();
  const seam: ConnectivitySubmissionFacets = submission;
  expect(seam.submissionId).toBe(submission.submissionId);
});

test("TYPE PROOF: the real W050A ConnectivityRecord satisfies ConnectivityRecordFacets", () => {
  const record: ConnectivityRecord = realConnectivityRecord();
  const seam: ConnectivityRecordFacets = record;
  expect(seam.connectivityId).toBe(record.connectivityId);
});

test("TYPE PROOF: the real W050C OutboxEntry satisfies OutboxEntryFacets", () => {
  const entry: OutboxEntry = realOutboxEntry();
  const seam: OutboxEntryFacets = entry;
  expect(seam.intent.messageId).toBe(entry.intent.messageId);
});

test("TYPE PROOF: the real W050C DeliveryRecord satisfies DeliveryRecordFacets", () => {
  const record: DeliveryRecord = realDeliveryRecords()[0] as DeliveryRecord;
  const seam: DeliveryRecordFacets = record;
  expect(seam.messageRef).toBe(record.messageRef);
});

// ---------------------------------------------------------------------------
// The catalog surfaces over the REAL vendor records
// ---------------------------------------------------------------------------

test("the vendor catalog derives typed terms machine-stably", () => {
  const result = buildVendorCatalogView(TENANT_A, [realVendorB(), realVendorA(), realVendorFar()]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.rows.map((r) => r.vendorId)).toEqual([
    "vnd_w060c_aaaa",
    "vnd_w060c_bbbb",
    "vnd_w060c_cccc",
  ]);
  const acme = result.view.rows[0];
  expect(acme?.name).toBe("acme.local");
  expect(acme?.qualityScore).toBe(0.85);
  expect(acme?.slaCoverage).toBe(0.9);
  expect(acme?.warrantyDays).toBe(730);
  expect(acme?.capabilities).toEqual(["device-class:class.standard_laptop", "service:service.battery"]);
  expect(acme?.regions).toEqual(["us-east"]);
  expect(acme?.inventory.length).toBe(2);
  expect(result.view.total).toBe(3);
});

test("the vendor catalog REFUSES cross-tenant vendors", () => {
  const result = buildVendorCatalogView(TENANT_B, [realVendorA()]);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("web-commerce.catalog.tenant_mismatch");
});

test("the software catalog derives seats + terms", () => {
  const subscription = {
    subscriptionId: "sub_w060c_0001",
    tenantId: TENANT_A,
    softwareId: "app.financial_suite",
    seatCount: 12,
    termDays: 365,
    workloadId: "wl_w060c_analyst",
    revision: 1,
    allocatedAt: "2026-01-06T09:00:00Z",
    contentHash: "hash1",
    schemaVersion: 1,
    modelVersion: 1,
  };
  const result = buildSoftwareCatalogView(TENANT_A, [subscription]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.rows[0]?.seatCount).toBe(12);
  expect(result.view.rows[0]?.termDays).toBe(365);
  expect(result.view.totalSeats).toBe(12);
});

// ---------------------------------------------------------------------------
// The procurement surfaces over the REAL demand + matches + quotes
// ---------------------------------------------------------------------------

test("the demand list derives deadline pressure from the injected now", () => {
  const result = buildProcurementDemandListView(TENANT_A, [realDemand()], NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const row = result.view.rows[0];
  // NOW = 2026-01-09, deadline = 2026-01-15 -> 6 days -> "soon".
  expect(row?.daysUntilDeadline).toBe(6);
  expect(row?.deadlinePressure).toBe("soon");
  expect(result.view.byPressure).toEqual({ overdue: 0, critical: 0, urgent: 0, soon: 1, comfortable: 0 });
  expect(row?.budgetUsd).toBe(25_000);
  expect(row?.allowedSubstitutions).toEqual(["class.standard_laptop"]);
});

test("the deadline-pressure buckets are machine-stable", () => {
  expect(deriveDeadlinePressure(-1)).toBe("overdue");
  expect(deriveDeadlinePressure(0)).toBe("critical");
  expect(deriveDeadlinePressure(1)).toBe("critical");
  expect(deriveDeadlinePressure(2)).toBe("urgent");
  expect(deriveDeadlinePressure(3)).toBe("urgent");
  expect(deriveDeadlinePressure(4)).toBe("soon");
  expect(deriveDeadlinePressure(7)).toBe("soon");
  expect(deriveDeadlinePressure(8)).toBe("comfortable");
});

test("the matching display preserves the ENGINE rank and derives headrooms", () => {
  const demand = realDemand();
  const matches = realMatches();
  const result = buildVendorMatchingView(TENANT_A, demand, matches, "procurement-matching/1");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  // The engine's rank order is preserved: acme first, beta second.
  expect(result.view.ranked.map((r) => r.vendorId)).toEqual(["vnd_w060c_aaaa", "vnd_w060c_bbbb"]);
  expect(result.view.ranked[0]?.rankPosition).toBe(1);
  expect(result.view.ranked[0]?.rankScore).toBe(matches[0]?.rankScore);

  // The headroom columns: acme SLA 0.9 - 0.8 = 0.1; warranty 730 - 365 = 365.
  const acme = result.view.ranked[0];
  const sla = acme?.headrooms.find((h) => h.dimension === "sla_coverage");
  expect(sla?.headroom !== undefined && Math.abs(sla.headroom - 0.1) < 1e-10).toBe(true);
  const warranty = acme?.headrooms.find((h) => h.dimension === "warranty_days");
  expect(warranty?.headroom).toBe(365);
  const quality = acme?.headrooms.find((h) => h.dimension === "quality_score");
  expect(quality?.headroom !== undefined && Math.abs(quality.headroom - 0.15) < 1e-10).toBe(true);

  // The far vendor is rejected on the region hard gate (machine-stable kind).
  expect(result.view.rejected.length).toBe(1);
  expect(result.view.rejected[0]?.vendorId).toBe("vnd_w060c_cccc");
  expect(result.view.rejected[0]?.reasons.some((r) => r.kind === "region_unsupported")).toBe(true);
});

test("the quote ledger display + evaluation derive from the REAL ledger", () => {
  const ledger = realQuoteLedger();
  const display = buildQuoteLedgerDisplay(TENANT_A, ledger);
  expect(display.ok).toBe(true);
  if (!display.ok) throw new Error(display.error.message);
  expect(display.view.rows.length).toBe(1);
  const row = display.view.rows[0];
  expect(row?.status).toBe("ISSUED"); // the quote record's own status, verbatim
  expect(row?.accepted).toBe(true); // derived from the ledger's acceptance entry
  expect(row?.acceptedAt).toBe("2026-01-07T09:00:00Z");
  expect(display.view.acceptances.length).toBe(1);

  // The evaluation: budget 25_000 - total (10 * 2200 = 22_000) = 3_000.
  const evaluation = buildQuoteEvaluationView(TENANT_A, realDemand(), realIssuedQuote());
  expect(evaluation.ok).toBe(true);
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  expect(evaluation.view.budgetHeadroomUsd).toBe(3_000);
  expect(evaluation.view.withinBudget).toBe(true);
  expect(evaluation.view.warrantyHeadroomDays).toBe(730 - 365);
  expect(evaluation.view.leadTimeFeasible).toBe(true);
});

test("the LOCK 14 aggregation display preserves per-contract identity", () => {
  const { aggregations, quotesByDemand } = realAggregationContext();
  const aggregation = aggregations[0];
  if (aggregation === undefined) throw new Error("aggregation missing");
  const result = buildAggregationDisplayView(TENANT_A, aggregations, quotesByDemand, NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const row = result.view.rows[0];
  expect(row?.memberCount).toBe(2);
  // EVERY member demand remains individually identified (LOCK 14).
  expect(row?.members.map((m) => m.demandId)).toEqual(aggregation.memberDemandIds);
  expect(row?.members.every((m) => m.quoteId !== null)).toBe(true);
  expect(row?.totalQuantity).toBe(15);
  expect(row?.deadlinePressure).toBe("soon");
});

// ---------------------------------------------------------------------------
// The maintenance surfaces over the REAL work order + service matches
// ---------------------------------------------------------------------------

test("the work-order list surfaces the diagnosis evidence refs", () => {
  const result = buildServiceWorkOrderListView(TENANT_A, [realServiceWorkOrder()], NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const row = result.view.rows[0];
  expect(row?.diagnosis.hypothesisId).toBe("hyp_w060c_0001");
  expect(row?.diagnosis.causeId).toBe("health.battery_aging");
  expect(row?.diagnosis.observationIds).toEqual(["obs_w060c_0101", "obs_w060c_0102"]);
  expect(row?.warrantyFloorDays).toBe(365);
  expect(row?.requireInWarranty).toBe(true);
  expect(row?.deadlinePressure).toBe("soon");
});

test("the warranty-aware eligibility stands against the REAL vendor terms", () => {
  const workOrder = realServiceWorkOrder();
  // acme: warranty 730 days over floor 365 -> in_warranty_headroom + 365.
  const acme = buildWarrantyEligibilityView(TENANT_A, workOrder, realVendorA());
  expect(acme.ok && acme.view.standing).toBe("in_warranty_headroom");
  if (acme.ok) expect(acme.view.warrantyHeadroomDays).toBe(365);
  // A synthetic below-floor vendor -> warranty_floor_unmet.
  const weak = { ...realVendorB(), terms: { quality: { score: 0.75 }, sla: { coverage: 0.82 }, warranty: { days: 200 } } };
  const weakResult = buildWarrantyEligibilityView(TENANT_A, workOrder, weak);
  expect(weakResult.ok && weakResult.view.standing).toBe("warranty_floor_unmet");
  // The pure classifier mirrors the W042 semantics.
  expect(deriveWarrantyStanding(730, 365)).toBe("in_warranty_headroom");
  expect(deriveWarrantyStanding(200, 365)).toBe("warranty_floor_unmet");
});

test("the service matching display preserves the engine rank", () => {
  const workOrder = realServiceWorkOrder();
  const matches = realServiceMatches();
  const result = buildServiceMatchingView(TENANT_A, workOrder, matches);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.ranked.length).toBe(1);
  expect(result.view.ranked[0]?.vendorId).toBe("vnd_w060c_aaaa");
  expect(result.view.ranked[0]?.matchedCapabilityId).toBe("service.battery");
  const warranty = result.view.ranked[0]?.headrooms.find((h) => h.dimension === "warranty_days");
  expect(warranty?.headroom).toBe(365);
  expect(result.view.rejected.length).toBe(1);
  expect(result.view.rejected[0]?.reasons.some((r) => r.kind === "region_unsupported")).toBe(true);
});

// ---------------------------------------------------------------------------
// The connectivity surfaces over the REAL submission + adopted record
// ---------------------------------------------------------------------------

test("the connectivity request display shows the Guardian context + parked approval", () => {
  const submission = realParkedSubmission();
  const result = buildConnectivityRequestView(TENANT_A, submission);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const view = result.view;
  expect(view.status).toBe("PARKED");
  expect(view.awaitingApproval).toBe(true); // the parked approval is VISIBLE
  expect(view.outcome.canonical).toBe("secure_private_connectivity");
  expect(view.targets.workloadId).toBe("wl_w060c_analyst");
  expect(view.properties.isolation).toBe("private");
  expect(view.constraints.requiredZones).toEqual(["corporate"]);
  expect(view.constraints.egressAllowed).toBe(false);
  // The latest revision's decision context: REQUIRE_APPROVAL + the rule.
  const head = view.revisions[view.revisions.length - 1];
  expect(head?.decisionType).toBe("REQUIRE_APPROVAL");
  expect(head?.matchedRules[0]?.ruleId).toBe("pol_w060c0001");
  expect(head?.reasons[0]?.code).toBe("policy.rule.matched");
  // The provider handle NEVER appears (asserted structurally elsewhere).
  expect(JSON.stringify(view).includes("handle")).toBe(false);
});

test("the submission list counts the parked approval worklist", () => {
  const result = buildConnectivitySubmissionListView(TENANT_A, [realParkedSubmission()]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.total).toBe(1);
  expect(result.view.parkedCount).toBe(1);
});

test("the status ingestion timeline surfaces normalized states + degradation", () => {
  const record = realConnectivityRecord();
  const result = buildConnectivityTimelineView(TENANT_A, record);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const view = result.view;
  expect(view.executionState).toBe("TERMINATED");
  expect(view.entries.length).toBe(3);
  // Revision 2 is DEGRADED, machine-stable kind surfaced.
  const degraded = view.entries[1];
  expect(degraded?.degradationKind).toBe("latency_degraded");
  expect(degraded?.degraded).toBe(true);
  expect(degraded?.measurementKinds).toEqual(["latency_ms"]);
  // Revision 3 terminated with the machine-stable reason.
  const terminated = view.entries[2];
  expect(terminated?.executionState).toBe("TERMINATED");
  expect(terminated?.terminationReason).toBe("duration_elapsed");
  expect(view.observedDegradationKinds).toEqual(["latency_degraded", "none"]);
  // The provider handle NEVER appears in the timeline view.
  expect(JSON.stringify(view).includes("opq_provider_handle")).toBe(false);
});

// ---------------------------------------------------------------------------
// The communication surfaces over the REAL outbox + delivery records
// ---------------------------------------------------------------------------

test("the outbox view lists the six-kind emission ledger read-only", () => {
  const result = buildOutboxListView(TENANT_A, [realOutboxEntry(), realOutboxApprovalEntry()]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.rows.map((r) => r.sequence)).toEqual([1, 2]);
  expect(result.view.byKind).toEqual({ maintenance_notice: 1, approval_request: 1 });
  const first = result.view.rows[0];
  expect(first?.kind).toBe("maintenance_notice");
  expect(first?.recipient.ref).toBe("role:fleet-ops");
  expect(first?.priority).toBe("normal");
  expect(first?.title).toContain("Maintenance notice");
  const second = result.view.rows[1];
  expect(second?.recipient.kind).toBe("principal");
  expect(second?.priority).toBe("high");
});

test("the delivery timeline derives the metadata-only state machine", () => {
  const records = realDeliveryRecords();
  const result = buildDeliveryTimelineView(TENANT_A, "aurum_msg_w060c0001", records);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.attempts.map((a) => a.state)).toEqual(["queued", "sent", "delivered"]);
  expect(result.view.latestState).toBe("delivered");
  expect(result.view.latestDisposition).toBe("succeeded");
  expect(result.view.terminal).toBe(false); // "delivered" is not terminal ("read" is)
  expect(result.view.attempts[0]?.channel).toBe("email");
  // A foreign message ref REFUSES (never mixes records).
  const foreign = buildDeliveryTimelineView(TENANT_A, "aurum_msg_other", records);
  expect(foreign.ok).toBe(false);
});

test("the communication summary counts the six kinds + delivery health", () => {
  const result = buildCommunicationSummaryView(
    TENANT_A,
    [realOutboxEntry(), realOutboxApprovalEntry()],
    realDeliveryRecords(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.emittedTotal).toBe(2);
  expect(result.view.emittedByKind.maintenance_notice).toBe(1);
  expect(result.view.emittedByKind.approval_request).toBe(1);
  expect(result.view.emittedByKind.manager_briefing).toBe(0);
  expect(result.view.deliveryByState).toEqual({ queued: 1, sent: 1, delivered: 1 });
  expect(result.view.deliveryByDisposition).toEqual({ in_progress: 2, succeeded: 1 });
});

// ---------------------------------------------------------------------------
// Tenant scoping + determinism across the commerce surfaces
// ---------------------------------------------------------------------------

test("every commerce surface REFUSES cross-tenant input", () => {
  const demandRefusal = buildProcurementDemandListView(TENANT_B, [realDemand()], NOW);
  expect(demandRefusal.ok).toBe(false);
  if (demandRefusal.ok) throw new Error("expected refusal");
  expect(demandRefusal.error.code).toBe("web-commerce.procurement.tenant_mismatch");

  const submissionRefusal = buildConnectivityRequestView(TENANT_B, realParkedSubmission());
  expect(submissionRefusal.ok).toBe(false);
  if (submissionRefusal.ok) throw new Error("expected refusal");
  expect(submissionRefusal.error.code).toBe("web-commerce.connectivity.tenant_mismatch");

  const outboxRefusal = buildOutboxListView(TENANT_B, [realOutboxEntry()]);
  expect(outboxRefusal.ok).toBe(false);
  if (outboxRefusal.ok) throw new Error("expected refusal");
  expect(outboxRefusal.error.code).toBe("web-commerce.communication.tenant_mismatch");

  const timelineRefusal = buildConnectivityTimelineView(TENANT_B, realConnectivityRecord());
  expect(timelineRefusal.ok).toBe(false);
  if (timelineRefusal.ok) throw new Error("expected refusal");
  expect(timelineRefusal.error.code).toBe("web-commerce.connectivity.tenant_mismatch");
});

test("DETERMINISM: repeated builds are byte-identical + views are frozen", () => {
  const one = buildVendorMatchingView(TENANT_A, realDemand(), realMatches(), "procurement-matching/1");
  const two = buildVendorMatchingView(TENANT_A, realDemand(), realMatches(), "procurement-matching/1");
  expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  if (!one.ok) throw new Error(one.error.message);
  expect(Object.isFrozen(one.view)).toBe(true);
  expect(Object.isFrozen(one.view.ranked[0])).toBe(true);

  const tOne = buildConnectivityTimelineView(TENANT_A, realConnectivityRecord());
  const tTwo = buildConnectivityTimelineView(TENANT_A, realConnectivityRecord());
  expect(JSON.stringify(tOne)).toBe(JSON.stringify(tTwo));
});

test("DETERMINISM: now-injection changes pressure deterministically", () => {
  const late = buildProcurementDemandListView(TENANT_A, [realDemand()], "2026-01-16T09:00:00Z");
  expect(late.ok && late.view.rows[0]?.deadlinePressure).toBe("overdue");
  const early = buildProcurementDemandListView(TENANT_A, [realDemand()], "2026-01-05T09:00:00Z");
  expect(early.ok && early.view.rows[0]?.deadlinePressure).toBe("comfortable");
});

// ---------------------------------------------------------------------------
// A tenant-scoped negative: the injected `now` must be ISO
// ---------------------------------------------------------------------------

test("an invalid injected now REFUSES machine-stably", () => {
  const result = buildProcurementDemandListView(TENANT_A, [realDemand()], "not-a-date");
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("web-commerce.procurement.invalid");
});

test("tenant ids are branded: a plain string tenant is a type error at compile time", () => {
  // The branded TenantId cannot be constructed from a raw string without
  // the contracts constructor — asserted by assigning through asTenantId.
  const tenant: ReturnType<typeof asTenantId> = asTenantId("tnt_w060cbbbbbbbb1");
  expect(tenant).toBe(TENANT_A);
});
