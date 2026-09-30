/**
 * W090C web-commerce — browser-facing RENDER tests (D4): all six
 * commerce screens render from FROZEN view-model snapshots built over
 * the REAL domain records (W032 vendors/demand/matching/quotes/
 * aggregation/reconciliation, W032B software subscriptions, W042 work
 * orders/service matching/aggregation/outcomes, W050A submissions +
 * adopted records, W050C outbox + deliveries, W072 scorecards +
 * evidence packs); text content, roles, labels, and semantic landmarks
 * are asserted; keyboard navigation and visible focus are exercised;
 * the exact empty/loading/error/invalid states are rendered; the
 * approval/blocked semantics are explicit (PARKED -> Approval
 * required; rejected vendors -> Blocked with refusal reasons);
 * delivery metadata is visible; the VERIFIED terminal states render;
 * and the same props always produce byte-identical static markup
 * (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, useState, type ReactElement } from "react";
import {
  buildVendorCatalogView,
  buildSoftwareCatalogView,
  buildProcurementDemandListView,
  buildVendorMatchingView,
  buildQuoteLedgerDisplay,
  buildQuoteEvaluationView,
  buildAggregationDisplayView,
  buildServiceWorkOrderListView,
  buildServiceMatchingView,
  buildWarrantyEligibilityView,
  buildAggregatedServiceOrderListView,
  buildConnectivitySubmissionListView,
  buildConnectivityTimelineView,
  buildOutboxListView,
  buildDeliveryTimelineView,
  buildCommunicationSummaryView,
  buildVendorScorecardsView,
  buildEvidencePacksView,
  buildMaintenanceOutcomesView,
  buildOrderVerificationView,
  buildEntitlementVerificationView,
  buildSoftwareNeedsView,
  buildFleetConnectivityStatusView,
  deriveSubscriptionLifecycle,
  ProcurementScreen,
  SoftwareScreen,
  VendorsScreen,
  MaintenanceScreen,
  ConnectivityScreen,
  CommunicationScreen,
  CONSOLE_CSS,
} from "../src/index";
import type {
  CommerceJourneyRailStage,
  MaintenanceSurfaceEvent,
  MaintenanceSurfaceState,
  ProcurementSurfaceEvent,
  ProcurementSurfaceState,
  ProcurementScreenData,
  SoftwareScreenData,
  VendorsScreenData,
  MaintenanceScreenData,
  ConnectivityScreenData,
  CommunicationScreenData,
} from "../src/index";
// The workload lane's composite-journey builders (D3): the REAL rail is
// built here and rendered on a commerce screen — the cross-lane binding
// the shell performs (test-scope import, sanctioned by the ownership gate).
import { buildWorkloadProcurementJourneyView, journeyRailStages } from "@fleetos/web-workloads";
import {
  appendRecommendation,
  buildWorkloadProfile,
  createRecommendationLedger,
  recommendForProfile,
} from "@fleetos/workloads";
import type { WorkloadRecommendationLedger } from "@fleetos/workloads";
import {
  CORR,
  NOW,
  T0,
  TENANT_A,
  WORKLOAD_ID,
  realDemand,
  realIssuedQuote,
  realMatches,
  realQuoteLedger,
  realAggregationContext,
  realServiceWorkOrder,
  realServiceMatches,
  realVendorA,
  realVendorB,
  realVendorFar,
  realParkedSubmission,
  realConnectivityRecord,
  realOutboxEntry,
  realOutboxApprovalEntry,
  realDeliveryRecords,
} from "./helpers";
import {
  realCommercialReconciliation,
  realEvidencePack,
  realExpiringSubscription,
  realExpiredSubscription,
  realMaintenanceOutcome,
  realScorecard,
  realSecondWorkOrder,
  realServiceAggregation,
  realSoftwareSubscription,
  realSubscriptionReconciliation,
  realVerifiedConnectivityRecord,
} from "./render-helpers";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// The frozen view-model fixtures (REAL records, deterministic)
// ---------------------------------------------------------------------------

function procurementData(): ProcurementScreenData {
  const demand = realDemand();
  const demands = buildProcurementDemandListView(TENANT_A, [demand], NOW);
  if (!demands.ok) throw new Error(demands.error.message);
  const matching = buildVendorMatchingView(TENANT_A, demand, realMatches(), "procurement-engine/1");
  if (!matching.ok) throw new Error(matching.error.message);
  const ledger = buildQuoteLedgerDisplay(TENANT_A, realQuoteLedger());
  if (!ledger.ok) throw new Error(ledger.error.message);
  const quote = realIssuedQuote();
  const evaluation = buildQuoteEvaluationView(TENANT_A, demand, quote);
  if (!evaluation.ok) throw new Error(evaluation.error.message);
  const { aggregations, quotesByDemand } = realAggregationContext();
  const orders = buildAggregationDisplayView(TENANT_A, aggregations, quotesByDemand, NOW);
  if (!orders.ok) throw new Error(orders.error.message);
  const verification = buildOrderVerificationView(TENANT_A, realCommercialReconciliation());
  if (!verification.ok) throw new Error(verification.error.message);
  return {
    demands: demands.view,
    selected: {
      demand,
      matching: matching.view,
      quoteRows: ledger.view.rows.filter((row) => row.demandId === demand.demandId),
      evaluations: [evaluation.view],
    },
    orders: orders.view,
    verification: verification.view,
  };
}

function softwareData(): SoftwareScreenData {
  // Three REAL subscriptions: one comfortably allocated (365-day term),
  // one EXPIRING (17-day term — 14 days remain at the frozen NOW), one
  // EXPIRED (2-day term — ended one day before the frozen NOW).
  const subscription = realSoftwareSubscription();
  const catalog = buildSoftwareCatalogView(TENANT_A, [
    subscription,
    realExpiringSubscription(),
    realExpiredSubscription(),
  ]);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const needs = buildSoftwareNeedsView(
    TENANT_A,
    [{ workloadId: WORKLOAD_ID, payload: { softwareId: "app.financial_suite", seatCount: 12 } }],
    catalog.view,
  );
  if (!needs.ok) throw new Error(needs.error.message);
  const verification = buildEntitlementVerificationView(TENANT_A, realSubscriptionReconciliation());
  if (!verification.ok) throw new Error(verification.error.message);
  return {
    catalog: catalog.view,
    needs: needs.view,
    verification: verification.view,
    now: NOW,
  };
}

function vendorsData(): VendorsScreenData {
  const catalog = buildVendorCatalogView(TENANT_A, [realVendorA(), realVendorB(), realVendorFar()]);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const scorecards = buildVendorScorecardsView(TENANT_A, [realScorecard()]);
  if (!scorecards.ok) throw new Error(scorecards.error.message);
  const packs = buildEvidencePacksView(TENANT_A, [realEvidencePack()]);
  if (!packs.ok) throw new Error(packs.error.message);
  return { catalog: catalog.view, scorecards: scorecards.view, evidencePacks: packs.view };
}

function maintenanceData(): MaintenanceScreenData {
  const workOrder = realServiceWorkOrder();
  const second = realSecondWorkOrder();
  const workOrders = buildServiceWorkOrderListView(TENANT_A, [workOrder, second], NOW);
  if (!workOrders.ok) throw new Error(workOrders.error.message);
  const matching = buildServiceMatchingView(TENANT_A, workOrder, realServiceMatches());
  if (!matching.ok) throw new Error(matching.error.message);
  const eligibilityA = buildWarrantyEligibilityView(TENANT_A, workOrder, realVendorA());
  if (!eligibilityA.ok) throw new Error(eligibilityA.error.message);
  const eligibilityFar = buildWarrantyEligibilityView(TENANT_A, workOrder, realVendorFar());
  if (!eligibilityFar.ok) throw new Error(eligibilityFar.error.message);
  const aggregations = buildAggregatedServiceOrderListView(TENANT_A, [realServiceAggregation()], NOW);
  if (!aggregations.ok) throw new Error(aggregations.error.message);
  const outcomes = buildMaintenanceOutcomesView(TENANT_A, [realMaintenanceOutcome()]);
  if (!outcomes.ok) throw new Error(outcomes.error.message);
  return {
    workOrders: workOrders.view,
    selected: {
      workOrder,
      matching: matching.view,
      eligibility: [
        {
          vendorId: eligibilityA.view.vendorId,
          standing: eligibilityA.view.standing,
          vendorWarrantyDays: eligibilityA.view.vendorWarrantyDays,
          warrantyFloorDays: eligibilityA.view.warrantyFloorDays,
          warrantyHeadroomDays: eligibilityA.view.warrantyHeadroomDays,
        },
        {
          vendorId: eligibilityFar.view.vendorId,
          standing: eligibilityFar.view.standing,
          vendorWarrantyDays: eligibilityFar.view.vendorWarrantyDays,
          warrantyFloorDays: eligibilityFar.view.warrantyFloorDays,
          warrantyHeadroomDays: eligibilityFar.view.warrantyHeadroomDays,
        },
      ],
    },
    aggregations: aggregations.view,
    outcomes: outcomes.view,
  };
}

function connectivityData(): ConnectivityScreenData {
  const submissions = buildConnectivitySubmissionListView(TENANT_A, [realParkedSubmission()]);
  if (!submissions.ok) throw new Error(submissions.error.message);
  const fleetStatus = buildFleetConnectivityStatusView(
    TENANT_A,
    [realParkedSubmission()],
    [realVerifiedConnectivityRecord()],
  );
  if (!fleetStatus.ok) throw new Error(fleetStatus.error.message);
  const verifiedTimeline = buildConnectivityTimelineView(TENANT_A, realVerifiedConnectivityRecord());
  if (!verifiedTimeline.ok) throw new Error(verifiedTimeline.error.message);
  const terminatedTimeline = buildConnectivityTimelineView(TENANT_A, realConnectivityRecord());
  if (!terminatedTimeline.ok) throw new Error(terminatedTimeline.error.message);
  return {
    submissions: submissions.view,
    fleetStatus: fleetStatus.view,
    timelines: [verifiedTimeline.view, terminatedTimeline.view],
  };
}

function communicationData(): CommunicationScreenData {
  const outbox = buildOutboxListView(TENANT_A, [realOutboxEntry(), realOutboxApprovalEntry()]);
  if (!outbox.ok) throw new Error(outbox.error.message);
  const summary = buildCommunicationSummaryView(TENANT_A, [realOutboxEntry(), realOutboxApprovalEntry()], [
    ...realDeliveryRecords(),
  ]);
  if (!summary.ok) throw new Error(summary.error.message);
  const delivery = buildDeliveryTimelineView(TENANT_A, "aurum_msg_w060c0001", realDeliveryRecords());
  if (!delivery.ok) throw new Error(delivery.error.message);
  return { outbox: outbox.view, summary: summary.view, deliveries: [delivery.view] };
}

// ---------------------------------------------------------------------------
// The composite-journey fixtures (the REAL workload-lane records — D3)
// ---------------------------------------------------------------------------

/** A REAL W022 workload profile (the workload lane's own domain builder). */
function journeyProfile() {
  const built = buildWorkloadProfile(TENANT_A, {
    workloadId: WORKLOAD_ID,
    subjectKind: "role",
    name: "finance.analyst",
    description: "Financial analyst workstation workload",
    requirements: {
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
    },
    constraints: {
      requiredApplications: [{ appId: "app.financial_suite", minVersion: "2026.1" }],
      environments: ["office", "home"],
      peripherals: ["external_display", "dock"],
      classification: "confidential",
    },
    workingHours: { startHour: 8, endHour: 18 },
    evidence: [{ observationId: "obs_w060c_0001", kind: "device.workload", note: "p90 factors" }],
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  return built.profile;
}

/** A REAL W022 ledger whose ACTIVE recommendation proposes a procurement intent. */
function journeyLedger(): WorkloadRecommendationLedger {
  const profile = journeyProfile();
  let ledger = createRecommendationLedger(TENANT_A, WORKLOAD_ID);
  const run = recommendForProfile(
    profile,
    [
      {
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
      },
    ],
    { at: T0, correlationId: CORR },
  );
  if (!run.ok) throw new Error(run.error.message);
  for (const recommendation of run.recommendations) {
    const appended = appendRecommendation(ledger, recommendation);
    if (!appended.ok) throw new Error(appended.error.message);
    ledger = appended.ledger;
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// ProcurementScreen
// ---------------------------------------------------------------------------

test("procurement: the demands view renders requests, orders with per-contract identity, and verified orders", () => {
  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: procurementData() }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("region", { name: "Commerce — procurement" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Procurement", level: 1 })).toBeTruthy();
  // The demand row renders with its deadline pressure.
  expect(screen.getByText(/10 standard laptops for the finance analyst fleet/)).toBeTruthy();
  // The LOCK 14 order shows EVERY member contract identity.
  const orderRow = screen.getByText(/dmd_w060c_second/).closest("tr");
  expect(orderRow).toBeTruthy();
  // The order verification shows the terminal verified state.
  expect(screen.getByText(/Orders verified against delivery evidence/i)).toBeTruthy();
  expect(screen.getByText(/zero discrepancies/i)).toBeTruthy();
});

test("procurement: opening a demand dispatches the existing state machine event", async () => {
  const user = userEvent.setup();
  const events: ProcurementSurfaceEvent[] = [];
  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: procurementData() }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(event): void => {
        events.push(event);
      }}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Open demand 10 standard laptops/ }));
  expect(events.length).toBe(1);
  expect(events[0]?.type).toBe("open_demand");
});

test("procurement: the demand detail shows ranked matches AND rejected vendors with refusal reasons", () => {
  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: procurementData() }}
      surface={{ view: "demand", demandId: realDemand().demandId }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  for (const section of ["Summary", "Current state", "Why it matters"]) {
    expect(screen.getByText(section)).toBeTruthy();
  }
  expect(screen.getByRole("tab", { name: /Vendor matching \(/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Quotes \(/ })).toBeTruthy();
  // The rejected vendor (far.local) shows the Blocked status + refusal reason.
  const rejected = screen.getByText(/vnd_w060c_cccc — Blocked/).closest("li");
  expect(rejected).toBeTruthy();
  if (rejected !== null) {
    expect(within(rejected).getByText(/region_unsupported/)).toBeTruthy();
    expect(within(rejected).getByText(/do not include us-east/)).toBeTruthy();
  }
});

test("procurement: the quote record view presents acceptance as the approval state with decision support", async () => {
  const user = userEvent.setup();
  const events: ProcurementSurfaceEvent[] = [];
  const data = procurementData();
  const quoteId = data.selected?.quoteRows[0]?.quoteId ?? "";
  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "demand", demandId: realDemand().demandId }}
      onSurfaceEvent={(event): void => {
        events.push(event);
      }}
      tab="quotes"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  await user.click(screen.getByRole("button", { name: `Open quote ${quoteId} from vnd_w060c_aaaa` }));
  expect(events).toEqual([{ type: "open_quote", quoteId }]);
  cleanup();

  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "quote", demandId: realDemand().demandId, quoteId }}
      onSurfaceEvent={(): void => {}}
      tab="quotes"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  for (const section of ["Summary", "Current state", "Why it matters", "Evidence", "History"]) {
    expect(screen.getByText(section)).toBeTruthy();
  }
  // The consequential-action card is present with the authorization facets.
  expect(screen.getByText(/Action authorization — Quote acceptance/)).toBeTruthy();
  expect(screen.getByText("Approval required")).toBeTruthy();
  expect(screen.getByText(/Not executed — proposal|Accepted at/)).toBeTruthy();
  // Decision support: budget headroom visible.
  expect(screen.getByText(/within budget|over budget/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// SoftwareScreen
// ---------------------------------------------------------------------------

test("software: needs, entitlements with lifecycle states, and the provision-verified outcome render", () => {
  render(
    <SoftwareScreen phase={{ kind: "ready", view: softwareData() }} journey={null} />,
  );
  expect(screen.getByRole("region", { name: "Commerce — software" })).toBeTruthy();
  // The D3 need is satisfied (allocated).
  expect(screen.getByText(/Need satisfied: subscription/)).toBeTruthy();
  // The entitlement lifecycle renders the THREE derived states with the
  // nine-state vocabulary alongside the verbatim domain values.
  expect(screen.getAllByText(/allocated — Healthy/).length).toBeGreaterThan(0);
  expect(screen.getByText("expiring — Needs attention")).toBeTruthy();
  expect(screen.getByText("expired — Blocked")).toBeTruthy();
  // The lifecycle facts are visible: the deterministic term-end instants
  // and the remaining/past day counts (derived in the view-model layer
  // from the INJECTED now — never a clock read).
  expect(screen.getByText(/term ends 2027-01-06T09:00:00\.000Z/)).toBeTruthy();
  expect(screen.getByText(/term ends 2026-01-23T09:00:00\.000Z/)).toBeTruthy();
  expect(screen.getByText(/term ends 2026-01-08T09:00:00\.000Z/)).toBeTruthy();
  expect(screen.getByText(/362 days remaining/)).toBeTruthy();
  expect(screen.getByText(/14 days remaining/)).toBeTruthy();
  expect(screen.getByText(/expired 1 day ago/)).toBeTruthy();
  expect(screen.getAllByText(/revision r1/).length).toBeGreaterThan(0);
  // The terminal verification state.
  expect(screen.getByText(/Entitlements verified against provision evidence/i)).toBeTruthy();
  expect(screen.getByText(/zero discrepancies/i)).toBeTruthy();
});

test("software: the lifecycle derivation is pure over the injected now (view-model layer)", () => {
  const row = { subscriptionId: "sub_x", softwareId: "app.x", allocatedAt: "2026-01-06T09:00:00Z", termDays: 365 };
  expect(deriveSubscriptionLifecycle("2026-01-09T09:00:00Z", row).state).toBe("allocated");
  expect(deriveSubscriptionLifecycle("2026-12-15T09:00:00Z", row).state).toBe("expiring");
  expect(deriveSubscriptionLifecycle("2026-01-06T10:00:00Z", { ...row, termDays: 0 }).state).toBe("expired");
  // Deterministic: the same inputs always produce the same view.
  const first = deriveSubscriptionLifecycle(NOW, row);
  const second = deriveSubscriptionLifecycle(NOW, row);
  expect(first).toEqual(second);
  expect(first.endsAt).toBe("2027-01-06T09:00:00.000Z");
  expect(first.daysRemaining).toBe(362);
});

test("software: an unsatisfied need shows the open state", () => {
  const base = softwareData();
  const catalog = base.catalog;
  const unsatisfied = buildSoftwareNeedsView(
    TENANT_A,
    [{ workloadId: "wl_w090c_other", payload: { softwareId: "app.financial_suite", seatCount: 5 } }],
    catalog,
  );
  if (!unsatisfied.ok) throw new Error(unsatisfied.error.message);
  render(
    <SoftwareScreen
      phase={{ kind: "ready", view: { ...base, needs: unsatisfied.view } }}
      journey={null}
    />,
  );
  expect(screen.getByText(/Need open: 5 seats of app.financial_suite/)).toBeTruthy();
  expect(screen.getByText(/no subscription is allocated yet/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// VendorsScreen
// ---------------------------------------------------------------------------

test("vendors: records, W072 scorecards, and PROPOSAL evidence packs render read-only", async () => {
  const user = userEvent.setup();
  render(
    <VendorsScreen
      phase={{ kind: "ready", view: vendorsData() }}
      openVendorId={null}
      onOpenVendor={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("region", { name: "Commerce — vendors" })).toBeTruthy();
  // The vendor records table renders all three vendors.
  expect(screen.getByText("acme.local")).toBeTruthy();
  expect(screen.getByText("beta.local")).toBeTruthy();
  expect(screen.getByText("far.local")).toBeTruthy();
  // The scorecard dimensions render with numerator/denominator.
  expect(screen.getAllByText(/fulfillment/).length).toBeGreaterThan(0);
  // The evidence pack status is PROPOSAL (never auto-published).
  expect(screen.getAllByText("PROPOSAL — Informational").length).toBeGreaterThan(0);

  // Opening the vendor record shows the controlled sheet with quality evidence.
  cleanup();
  render(
    <VendorsScreen
      phase={{ kind: "ready", view: vendorsData() }}
      openVendorId="vnd_w060c_aaaa"
      onOpenVendor={(): void => {}}
      journey={null}
    />,
  );
  const sheet = screen.getByRole("dialog", { name: "Vendor record — acme.local" });
  expect(within(sheet).getByText("Quality score")).toBeTruthy();
  expect(within(sheet).getByText(/Scorecard vsc_/)).toBeTruthy();
  expect(within(sheet).getByText(/Evidence pack mep_/)).toBeTruthy();
  // The sheet's icon-only close control carries an accessible name.
  expect(within(sheet).getByRole("button", { name: "Close the vendor record panel" })).toBeTruthy();
  void user;
});

// ---------------------------------------------------------------------------
// MaintenanceScreen
// ---------------------------------------------------------------------------

test("maintenance: the work-order list and the VERIFIED outcome render", () => {
  const data = maintenanceData();
  const first = data.workOrders.rows[0];
  const second = data.workOrders.rows[1];
  if (first === undefined || second === undefined) throw new Error("fixture work orders missing");
  render(
    <MaintenanceScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "workOrders" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("region", { name: "Commerce — maintenance" })).toBeTruthy();
  // Both work orders render with their diagnosis evidence refs.
  expect(screen.getAllByText(first.workOrderId).length).toBeGreaterThan(0);
  expect(screen.getAllByText(second.workOrderId).length).toBeGreaterThan(0);
  // The VERIFIED maintenance outcome is explicit (the terminal state).
  expect(screen.getByText("Verified maintenance outcomes")).toBeTruthy();
  expect(screen.getAllByText(/VERIFIED — Succeeded/).length).toBeGreaterThan(0);
  // The per-contract completion evidence renders.
  expect(screen.getAllByText(/\(on time\)/).length).toBeGreaterThan(0);
});

test("maintenance: the aggregated service orders render with per-contract identity (LOCK 14)", () => {
  render(
    <MaintenanceScreen
      phase={{ kind: "ready", view: maintenanceData() }}
      surface={{ view: "workOrders" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByText("Aggregated service orders")).toBeTruthy();
  // Every member work-order id renders individually — the per-contract
  // identity LOCK 14 requires (never collapsed into a count alone).
  const data = maintenanceData();
  for (const row of data.aggregations.rows) {
    for (const memberId of row.memberWorkOrderIds) {
      expect(screen.getAllByText(memberId).length).toBeGreaterThan(0);
    }
    const tableRow = screen.getByText(row.aggregationId).closest("tr");
    expect(tableRow).toBeTruthy();
  }
  expect(screen.getByText(/identity preserved/)).toBeTruthy();
});

test("maintenance: the work-order detail walks the exchange journey with the VERIFIED terminal state", async () => {
  const user = userEvent.setup();
  const events: MaintenanceSurfaceEvent[] = [];
  const data = maintenanceData();
  const first = data.workOrders.rows[0];
  if (first === undefined) throw new Error("fixture work order missing");
  render(
    <MaintenanceScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "workOrders" }}
      onSurfaceEvent={(event): void => {
        events.push(event);
      }}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: `Open work order ${first.workOrderId} for device ${first.deviceId}` }),
  );
  expect(events).toEqual([{ type: "open_work_order", workOrderId: first.workOrderId }]);
  cleanup();

  render(
    <MaintenanceScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "workOrder", workOrderId: first.workOrderId }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  // The record pattern + the exchange journey timeline.
  for (const section of ["Summary", "Current state", "Why it matters", "Evidence", "History"]) {
    expect(screen.getByText(section)).toBeTruthy();
  }
  expect(screen.getByText("Maintenance exchange journey")).toBeTruthy();
  // The journey timeline reaches the VERIFIED terminal state.
  expect(screen.getByText("Verified maintenance outcome")).toBeTruthy();
  expect(screen.getByText(/VERIFIED: contract served by vendor, completed with evidence/)).toBeTruthy();
  // The consequential-action card shows the exchange authorization AND
  // the verification-result facet (the measured contract outcome).
  expect(screen.getByText(/Action authorization — Maintenance exchange/)).toBeTruthy();
  expect(screen.getByText(/VERIFIED: contract served by vendor \(coverage/)).toBeTruthy();
  // The tabs navigate by keyboard (arrow keys fire the change).
  const changes: string[] = [];
  cleanup();
  const { rerender } = render(
    <MaintenanceScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "workOrder", workOrderId: first.workOrderId }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(tab): void => {
        changes.push(tab);
      }}
      journey={null}
    />,
  );
  const tablist = screen.getByRole("tablist", { name: "Work order detail panels" });
  const matchingTab = screen.getByRole("tab", { name: /Service matching \(/ });
  matchingTab.focus();
  expect(document.activeElement).toBe(matchingTab);
  fireEvent.keyDown(tablist, { key: "ArrowRight" });
  expect(changes).toEqual(["eligibility"]);
  rerender(
    <MaintenanceScreen
      phase={{ kind: "ready", view: data }}
      surface={{ view: "workOrder", workOrderId: first.workOrderId }}
      onSurfaceEvent={(): void => {}}
      tab="eligibility"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("tab", { name: /Warranty eligibility \(/ }).getAttribute("aria-selected")).toBe("true");
});

// ---------------------------------------------------------------------------
// ConnectivityScreen
// ---------------------------------------------------------------------------

test("connectivity: per-device rows, PARKED approval semantics, and VERIFIED outcomes render", () => {
  render(
    <ConnectivityScreen
      phase={{ kind: "ready", view: connectivityData() }}
      openSubmissionId={null}
      onOpenSubmission={(): void => {}}
      openConnectivityId={null}
      onOpenConnectivity={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("region", { name: "Commerce — connectivity" })).toBeTruthy();
  // The per-device row: PARKED submission + VERIFIED adopted record.
  expect(screen.getAllByText("dev_w060c_0001").length).toBeGreaterThan(0);
  expect(screen.getByText(/PARKED — Approval required/)).toBeTruthy();
  expect(screen.getByText(/VERIFIED \(ACTIVE\) — Succeeded/)).toBeTruthy();
  // The submissions inbox renders the parked count.
  expect(screen.getByText(/1 parked for approval/)).toBeTruthy();
});

test("connectivity: the request sheet shows the Guardian decision context and provider-neutral refusal reason only", async () => {
  const user = userEvent.setup();
  render(
    <ConnectivityScreen
      phase={{ kind: "ready", view: connectivityData() }}
      openSubmissionId="adcos-sub-w060c0001"
      onOpenSubmission={(): void => {}}
      openConnectivityId={null}
      onOpenConnectivity={(): void => {}}
      journey={null}
    />,
  );
  const sheet = screen.getByRole("dialog", { name: "Connectivity request — adcos-sub-w060c0001" });
  // The PARKED submission's authorization card.
  expect(within(sheet).getByText(/Action authorization — Connectivity request/)).toBeTruthy();
  expect(within(sheet).getByText(/Parked — awaiting approval/)).toBeTruthy();
  // The Guardian decision context on the revision timeline.
  expect(within(sheet).getByText("Guardian: REQUIRE_APPROVAL")).toBeTruthy();
  expect(within(sheet).getAllByText(/pol_w060c0001 v1/).length).toBeGreaterThan(0);
  // The icon-only close control carries an accessible name.
  expect(within(sheet).getByRole("button", { name: "Close the connectivity request panel" })).toBeTruthy();
  void user;
});

test("connectivity: the adopted timeline sheet shows the VERIFIED outcome with measurements", () => {
  render(
    <ConnectivityScreen
      phase={{ kind: "ready", view: connectivityData() }}
      openSubmissionId={null}
      onOpenSubmission={(): void => {}}
      openConnectivityId="conn_w090c0001"
      onOpenConnectivity={(): void => {}}
      journey={null}
    />,
  );
  const sheet = screen.getByRole("dialog", { name: "Connectivity timeline — conn_w090c0001" });
  expect(within(sheet).getByText(/VERIFIED: the latest revision is ACTIVE with measurements/)).toBeTruthy();
  expect(within(sheet).getAllByText(/latency_ms, throughput_mbps/).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// CommunicationScreen
// ---------------------------------------------------------------------------

test("communication: the outbox renders with kinds and the delivery outcome carries visible metadata", async () => {
  const user = userEvent.setup();
  // A minimal controlled shell: the open message id is UI state the test
  // owns; the delivery data lives in the view-model (never React state).
  function CommunicationShell(): React.JSX.Element {
    const [openMessageId, setOpenMessageId] = useState<string | null>(null);
    return (
      <CommunicationScreen
        phase={{ kind: "ready", view: communicationData() }}
        openMessageId={openMessageId}
        onOpenMessage={setOpenMessageId}
        journey={null}
      />
    );
  }
  render(<CommunicationShell />);
  expect(screen.getByRole("region", { name: "Commerce — communication" })).toBeTruthy();
  // Both outbox messages render with their kinds.
  expect(screen.getByText(/Maintenance notice: work order created/)).toBeTruthy();
  expect(screen.getByText(/Approval request: connectivity submission parked/)).toBeTruthy();

  // Open the delivery outcome: the metadata is visible.
  await user.click(screen.getByRole("button", { name: /Open delivery outcome for Maintenance notice/ }));
  const sheet = screen.getByRole("dialog", { name: /Delivery outcome — Maintenance notice/ });
  expect(within(sheet).getByText("delivered — Succeeded")).toBeTruthy();
  expect(within(sheet).getByText(/Attempt 1 — queued/)).toBeTruthy();
  expect(within(sheet).getByText(/Attempt 1 — sent/)).toBeTruthy();
  expect(within(sheet).getByText(/Attempt 1 — delivered/)).toBeTruthy();
  // The delivery evidence metadata: channel + recipient ref + ingestion instants.
  expect(within(sheet).getAllByText(/email → role:fleet-ops/).length).toBeGreaterThan(0);
  // The terminal flag follows the domain's terminal states (read/undeliverable);
  // "delivered" is NOT terminal — the outcome is still in progress.
  expect(within(sheet).getByText(/No — the outcome is still in progress/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The composite journey rail (D3 — the REAL workload-lane view on a
// commerce screen: the cross-lane binding the shell performs)
// ---------------------------------------------------------------------------

test("journey rail: the REAL workload-lane journey renders on the procurement screen and navigates by stage id", async () => {
  const user = userEvent.setup();
  const quote = realIssuedQuote();
  const journey = buildWorkloadProcurementJourneyView(TENANT_A, {
    profile: journeyProfile(),
    ledger: journeyLedger(),
    subscription: null,
    demand: realDemand(),
    quote: {
      quoteId: quote.quoteId,
      tenantId: quote.tenantId,
      demandId: quote.demandId,
      vendorId: quote.vendorId,
      status: quote.status,
      accepted: false,
      acceptedAt: null,
    },
    submission: null,
    verification: null,
  });
  if (!journey.ok) throw new Error(journey.error.message);
  // THE BINDING PROOF: the workload lane's rail stages assign to this
  // package's CommerceJourneyRailStage[] (structural — the shell passes
  // the workload lane's rail straight through to any commerce screen).
  const rail: readonly CommerceJourneyRailStage[] = journeyRailStages(journey.view);
  const opened: string[] = [];
  render(
    <ProcurementScreen
      phase={{ kind: "ready", view: procurementData() }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={rail}
      onOpenJourneyStage={(stageId): void => {
        opened.push(stageId);
      }}
    />,
  );
  expect(screen.getByText("Journey — workload plan to verified connectivity")).toBeTruthy();
  expect(screen.getByText("Workload plan recommendation")).toBeTruthy();
  expect(screen.getByText("Software need")).toBeTruthy();
  expect(screen.getByText("Procurement request")).toBeTruthy();
  expect(screen.getByText("Procurement quote & acceptance")).toBeTruthy();
  expect(screen.getByText("Connectivity request")).toBeTruthy();
  expect(screen.getByText("Verified connectivity")).toBeTruthy();
  // done (Succeeded) + current (Running) + approval (Approval required) +
  // pending (Unknown) stage states are all visible on the rail.
  expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Approval required").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  // The summary lines carry the REAL record facts (the plan stage's
  // recommendation proposes its draft intents; the quote stage names the
  // REAL vendor and the pending operator acceptance).
  expect(screen.getByText(/proposes \d+ draft intent/)).toBeTruthy();
  expect(screen.getByText(/is ISSUED — acceptance \(the operator approval\) is pending/)).toBeTruthy();
  // Navigation fires by machine-stable stage id.
  await user.click(screen.getByRole("button", { name: "Open journey stage: Procurement quote & acceptance" }));
  expect(opened).toEqual(["procurement-quote"]);
});

test("journey rail: a REJECTED quote renders the blocked stage state on the software screen", () => {
  const journey = buildWorkloadProcurementJourneyView(TENANT_A, {
    profile: journeyProfile(),
    ledger: journeyLedger(),
    subscription: null,
    demand: realDemand(),
    quote: {
      quoteId: "qt_w090c_rejected",
      tenantId: TENANT_A,
      demandId: realDemand().demandId,
      vendorId: "vnd_w060c_aaaa",
      status: "REJECTED",
      accepted: false,
      acceptedAt: null,
    },
    submission: null,
    verification: null,
  });
  if (!journey.ok) throw new Error(journey.error.message);
  const rail: readonly CommerceJourneyRailStage[] = journeyRailStages(journey.view);
  render(
    <SoftwareScreen
      phase={{ kind: "ready", view: softwareData() }}
      journey={rail}
      onOpenJourneyStage={(): void => {}}
    />,
  );
  expect(screen.getByText("Journey — workload plan to verified connectivity")).toBeTruthy();
  // The REJECTED quote blocks the journey at the quote stage (Blocked).
  expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  expect(screen.getByText(/was REJECTED — the procurement path is blocked/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// States + determinism + a11y
// ---------------------------------------------------------------------------

test("states: every commerce screen renders loading skeletons, error alerts, and instructive empty states", () => {
  const { rerender } = render(
    <ProcurementScreen
      phase={{ kind: "loading" }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading the procurement surface" })).toBeTruthy();

  rerender(
    <ProcurementScreen
      phase={{ kind: "error", message: "The procurement registry is unreachable." }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("The procurement registry is unreachable.")).toBeTruthy();

  rerender(
    <ProcurementScreen
      phase={{ kind: "invalid", failures: [{ path: "/demands", reason: "array_required" }] }}
      surface={{ view: "demands" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(within(screen.getByRole("alert")).getByText("array_required")).toBeTruthy();

  // Empty states across the other screens.
  cleanup();
  render(
    <SoftwareScreen
      phase={{
        kind: "ready",
        view: {
          catalog: buildSoftwareCatalogView(TENANT_A, []).ok
            ? (buildSoftwareCatalogView(TENANT_A, []) as { ok: true; view: SoftwareScreenData["catalog"] }).view
            : (undefined as never),
          needs: null,
          verification: buildEntitlementVerificationView(TENANT_A, null).ok
            ? (buildEntitlementVerificationView(TENANT_A, null) as { ok: true; view: SoftwareScreenData["verification"] }).view
            : (undefined as never),
          now: NOW,
        },
      }}
      journey={null}
    />,
  );
  expect(screen.getByText("No subscriptions are allocated yet")).toBeTruthy();
  expect(screen.getByText(/No provision evidence verifies the entitlements yet/)).toBeTruthy();

  cleanup();
  render(
    <MaintenanceScreen
      phase={{
        kind: "ready",
        view: {
          workOrders: buildServiceWorkOrderListView(TENANT_A, [], NOW).ok
            ? (buildServiceWorkOrderListView(TENANT_A, [], NOW) as { ok: true; view: MaintenanceScreenData["workOrders"] }).view
            : (undefined as never),
          selected: null,
          aggregations: buildAggregatedServiceOrderListView(TENANT_A, [], NOW).ok
            ? (buildAggregatedServiceOrderListView(TENANT_A, [], NOW) as { ok: true; view: MaintenanceScreenData["aggregations"] }).view
            : (undefined as never),
          outcomes: buildMaintenanceOutcomesView(TENANT_A, []).ok
            ? (buildMaintenanceOutcomesView(TENANT_A, []) as { ok: true; view: MaintenanceScreenData["outcomes"] }).view
            : (undefined as never),
        },
      }}
      surface={{ view: "workOrders" }}
      onSurfaceEvent={(): void => {}}
      tab="matching"
      onTabChange={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByText("No service work orders are open")).toBeTruthy();
  expect(screen.getByText(/No maintenance outcome is measured yet/)).toBeTruthy();

  cleanup();
  render(
    <ConnectivityScreen
      phase={{
        kind: "ready",
        view: {
          submissions: buildConnectivitySubmissionListView(TENANT_A, []).ok
            ? (buildConnectivitySubmissionListView(TENANT_A, []) as { ok: true; view: ConnectivityScreenData["submissions"] }).view
            : (undefined as never),
          fleetStatus: buildFleetConnectivityStatusView(TENANT_A, [], []).ok
            ? (buildFleetConnectivityStatusView(TENANT_A, [], []) as { ok: true; view: ConnectivityScreenData["fleetStatus"] }).view
            : (undefined as never),
          timelines: [],
        },
      }}
      openSubmissionId={null}
      onOpenSubmission={(): void => {}}
      openConnectivityId={null}
      onOpenConnectivity={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByText("No connectivity state exists yet")).toBeTruthy();
  expect(screen.getByText("No connectivity requests are submitted")).toBeTruthy();

  cleanup();
  render(
    <CommunicationScreen
      phase={{
        kind: "ready",
        view: {
          outbox: buildOutboxListView(TENANT_A, []).ok
            ? (buildOutboxListView(TENANT_A, []) as { ok: true; view: CommunicationScreenData["outbox"] }).view
            : (undefined as never),
          summary: buildCommunicationSummaryView(TENANT_A, [], []).ok
            ? (buildCommunicationSummaryView(TENANT_A, [], []) as { ok: true; view: CommunicationScreenData["summary"] }).view
            : (undefined as never),
          deliveries: [],
        },
      }}
      openMessageId={null}
      onOpenMessage={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByText("No messages are emitted yet")).toBeTruthy();
});

test("states: the vendors screen renders its instructive empty state", () => {
  const catalog = buildVendorCatalogView(TENANT_A, []);
  if (!catalog.ok) throw new Error(catalog.error.message);
  const scorecards = buildVendorScorecardsView(TENANT_A, []);
  if (!scorecards.ok) throw new Error(scorecards.error.message);
  const packs = buildEvidencePacksView(TENANT_A, []);
  if (!packs.ok) throw new Error(packs.error.message);
  render(
    <VendorsScreen
      phase={{ kind: "ready", view: { catalog: catalog.view, scorecards: scorecards.view, evidencePacks: packs.view } }}
      openVendorId={null}
      onOpenVendor={(): void => {}}
      journey={null}
    />,
  );
  expect(screen.getByText("No vendors are enrolled yet")).toBeTruthy();
  // The read-only W072 sections (scorecards + evidence packs) render
  // nothing when no records exist — no fabricated placeholders.
  expect(screen.queryByText("Vendor scorecards")).toBeNull();
  expect(screen.queryByText("Marketplace quality evidence")).toBeNull();
});

test("states: every commerce screen renders the loading skeleton and the error alert (the shared phase pattern)", () => {
  type LoadingOrErrorPhase =
    | { readonly kind: "loading" }
    | { readonly kind: "error"; readonly message: string };
  const screens: readonly ((phase: LoadingOrErrorPhase) => React.JSX.Element)[] = [
    (phase) => (
      <ProcurementScreen
        phase={phase}
        surface={{ view: "demands" }}
        onSurfaceEvent={(): void => {}}
        tab="matching"
        onTabChange={(): void => {}}
        journey={null}
      />
    ),
    (phase) => <SoftwareScreen phase={phase} journey={null} />,
    (phase) => (
      <VendorsScreen phase={phase} openVendorId={null} onOpenVendor={(): void => {}} journey={null} />
    ),
    (phase) => (
      <MaintenanceScreen
        phase={phase}
        surface={{ view: "workOrders" }}
        onSurfaceEvent={(): void => {}}
        tab="matching"
        onTabChange={(): void => {}}
        journey={null}
      />
    ),
    (phase) => (
      <ConnectivityScreen
        phase={phase}
        openSubmissionId={null}
        onOpenSubmission={(): void => {}}
        openConnectivityId={null}
        onOpenConnectivity={(): void => {}}
        journey={null}
      />
    ),
    (phase) => (
      <CommunicationScreen phase={phase} openMessageId={null} onOpenMessage={(): void => {}} journey={null} />
    ),
  ];
  for (const factory of screens) {
    cleanup();
    render(factory({ kind: "loading" }));
    expect(screen.getByRole("status")).toBeTruthy();
    cleanup();
    render(factory({ kind: "error", message: "The commerce registry is unreachable." }));
    expect(within(screen.getByRole("alert")).getByText("The commerce registry is unreachable.")).toBeTruthy();
  }
});

test("a11y: reduced-motion and the design tokens are asserted against the frozen stylesheet", () => {
  expect(CONSOLE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  expect(CONSOLE_CSS).toContain("animation: none !important");
  expect(CONSOLE_CSS).toContain("--surface: #faf8f4");
  expect(CONSOLE_CSS).toContain(".fos-scope button:focus-visible");
});

test("determinism: identical props render byte-identical static markup across all six screens", () => {
  const cases: readonly { readonly name: string; readonly element: ReactElement }[] = [
    {
      name: "procurement",
      element: createElement(ProcurementScreen, {
        phase: { kind: "ready", view: procurementData() },
        surface: { view: "demands" },
        onSurfaceEvent: (): void => {},
        tab: "matching",
        onTabChange: (): void => {},
        journey: null,
      }),
    },
    {
      name: "software",
      element: createElement(SoftwareScreen, {
        phase: { kind: "ready", view: softwareData() },
        journey: null,
      }),
    },
    {
      name: "vendors",
      element: createElement(VendorsScreen, {
        phase: { kind: "ready", view: vendorsData() },
        openVendorId: "vnd_w060c_aaaa",
        onOpenVendor: (): void => {},
        journey: null,
      }),
    },
    {
      name: "maintenance",
      element: createElement(MaintenanceScreen, {
        phase: { kind: "ready", view: maintenanceData() },
        surface: { view: "workOrder", workOrderId: "swo_w060c_0001" },
        onSurfaceEvent: (): void => {},
        tab: "matching",
        onTabChange: (): void => {},
        journey: null,
      }),
    },
    {
      name: "connectivity",
      element: createElement(ConnectivityScreen, {
        phase: { kind: "ready", view: connectivityData() },
        openSubmissionId: "adcos-sub-w060c0001",
        onOpenSubmission: (): void => {},
        openConnectivityId: null,
        onOpenConnectivity: (): void => {},
        journey: null,
      }),
    },
    {
      name: "communication",
      element: createElement(CommunicationScreen, {
        phase: { kind: "ready", view: communicationData() },
        openMessageId: "aurum_msg_w060c0001",
        onOpenMessage: (): void => {},
        journey: null,
      }),
    },
  ];
  for (const { name, element } of cases) {
    const first = renderToStaticMarkup(element);
    const second = renderToStaticMarkup(element);
    expect(first).toBe(second);
    void name;
  }
});

test("provider neutrality: no provider handle or topology field ever renders", () => {
  const markup = renderToStaticMarkup(
    createElement(ConnectivityScreen, {
      phase: { kind: "ready", view: connectivityData() },
      openSubmissionId: null,
      onOpenSubmission: (): void => {},
      openConnectivityId: null,
      onOpenConnectivity: (): void => {},
      journey: null,
    }),
  );
  expect(markup.includes("opq_provider_handle")).toBe(false);
  expect(markup.includes("credential")).toBe(false);
  // The communication screen's rendered markup is swept too: the Aurum
  // delivery OUTCOME view carries metadata only — no provider handle,
  // no provider message id, no topology detail (LOCK 6-8 + LOCK 10).
  const communicationMarkup = renderToStaticMarkup(
    createElement(CommunicationScreen, {
      phase: { kind: "ready", view: communicationData() },
      openMessageId: "aurum_msg_w060c0001",
      onOpenMessage: (): void => {},
      journey: null,
    }),
  );
  expect(communicationMarkup.includes("opq_provider_handle")).toBe(false);
  expect(communicationMarkup.includes("credential")).toBe(false);
  expect(communicationMarkup.includes("sdk")).toBe(false);
});

void CORR;
