/**
 * W060C web-commerce — the AUTHORITY-BOUNDARY tests (LOCK 10 + read-only
 * surface discipline).
 *
 * The AURUM.md invariant surfaced at the UI layer: "Aurum returns
 * delivery/outcome metadata and cannot mutate FleetOS truth except
 * through explicitly authorized FleetOS action APIs." The communication
 * surface (and every other commerce surface) exposes ONLY pure/read-only
 * view-model builders — no store mutation, no emission, no ingestion,
 * no dispatch.
 *
 * Two-layer allowlist:
 *   1. RUNTIME: every VALUE export (functions/constants) is asserted
 *      against an exhaustive allowlist — every name is classified PURE
 *      BUILDER / DERIVATION / SELECTOR / FROZEN CONSTANT / STATE MACHINE.
 *      Anything NOT on the list fails the boundary by definition.
 *      Adding a name here is a deliberate, reviewable authority-boundary
 *      change (the W050C precedent).
 *   2. TYPE-LEVEL: every facet/view TYPE is imported by name below, so
 *      `tsc` verifies the compile-time surface (types vanish at runtime;
 *      their presence is proven by the import itself).
 */

import { test, expect } from "bun:test";
import * as commerce from "../src/index";
import * as workloads from "../../workloads/src/index";
import type {
  // seams.ts — the structural facets (compile-time surface verification)
  VendorCapabilityFacets,
  VendorInventoryFacets,
  VendorTermsFacets,
  VendorFacets,
  ProcurementDemandFacets,
  VendorMatchFacets,
  QuoteFacets,
  QuoteLedgerEntryFacets,
  QuoteLedgerFacets,
  AggregatedOrderFacets,
  SoftwareSubscriptionFacets,
  DiagnosisEvidenceFacets,
  WarrantyRulesFacets,
  ServiceWorkOrderFacets,
  ServiceVendorMatchFacets,
  AggregatedServiceOrderFacets,
  ConnectivitySubmissionFacets,
  ConnectivityRecordFacets,
  MessageContentFacets,
  CommunicationIntentFacets,
  OutboxEntryFacets,
  DeliveryRecordFacets,
  SurfaceFieldView,
  // catalog.ts
  VendorCatalogRowView,
  VendorInventorySignalView,
  VendorCatalogView,
  VendorCatalogResult,
  SoftwareCatalogRowView,
  SoftwareCatalogView,
  SoftwareCatalogResult,
  // procurement.ts
  DeadlinePressureBucket,
  ProcurementDemandRowView,
  ProcurementDemandListView,
  DemandListResult,
  HeadroomView,
  VendorMatchRowView,
  VendorMatchingView,
  VendorMatchingResult,
  QuoteRowView,
  QuoteLedgerDisplayView,
  QuoteLedgerDisplayResult,
  QuoteEvaluationView,
  QuoteEvaluationResult,
  AggregatedOrderRowView,
  AggregationDisplayView,
  AggregationDisplayResult,
  // maintenance.ts
  DiagnosisEvidenceView,
  ServiceWorkOrderRowView,
  ServiceWorkOrderListView,
  ServiceWorkOrderListResult,
  WarrantyStandingView,
  WarrantyEligibilityRowView,
  WarrantyEligibilityResult,
  ServiceMatchRowView,
  ServiceMatchingView,
  ServiceMatchingResult,
  AggregatedServiceOrderRowView,
  AggregatedServiceOrderListView,
  AggregatedServiceOrderListResult,
  // connectivity.ts
  SubmissionRevisionView,
  ConnectivityRequestView,
  ConnectivityRequestResult,
  ConnectivitySubmissionListView,
  ConnectivitySubmissionListResult,
  ConnectivityTimelineEntryView,
  ConnectivityTimelineView,
  ConnectivityTimelineResult,
  // communication.ts
  OutboxRowView,
  OutboxListView,
  OutboxListResult,
  DeliveryAttemptView,
  DeliveryTimelineView,
  DeliveryTimelineResult,
  CommunicationSummaryView,
  CommunicationSummaryResult,
  // state.ts
  ProcurementSurfaceState,
  ProcurementSurfaceEvent,
  ProcurementReduceResult,
  MaintenanceSurfaceState,
  MaintenanceSurfaceEvent,
  MaintenanceReduceResult,
  // outcomes.ts — the W090C verification + outcome view-models
  ScorecardDimensionFacets,
  VendorScorecardFacets,
  EvidenceClaimFacets,
  MarketplaceEvidencePackFacets,
  ServiceContractOutcomeFacets,
  ServiceAggregationOutcomeFacets,
  CommercialReconciliationFacets,
  SubscriptionReconciliationFacets,
  VendorScorecardRowView,
  VendorScorecardsView,
  VendorScorecardsResult,
  EvidencePackRowView,
  EvidencePacksView,
  EvidencePacksResult,
  MaintenanceOutcomeRowView,
  MaintenanceOutcomesView,
  MaintenanceOutcomesResult,
  OrderVerificationView,
  OrderVerificationResult,
  EntitlementVerificationView,
  EntitlementVerificationResult,
  SoftwareNeedSource,
  SoftwareNeedRowView,
  SoftwareNeedsView,
  SoftwareNeedsResult,
  SubscriptionLifecycleState,
  SubscriptionLifecycleView,
  SubscriptionLifecycleSource,
  FleetConnectivityRowView,
  FleetConnectivityStatusView,
  FleetConnectivityStatusResult,
  // ui/status.ts — the nine-state console vocabulary + the domain mappings
  ConsoleStatus,
  CommerceJourneyStageState,
} from "../src/index";
import type {
  // workloads journey.ts — the W090C D3 composite journey view-model
  JourneyStageId,
  JourneyRailStageView,
  WorkloadProcurementJourneySource,
  WorkloadProcurementJourneyView,
  WorkloadJourneyResult,
  JourneyNavState,
  JourneyNavEvent,
  JourneyNavResult,
} from "../../workloads/src/index";

/**
 * Compile-time surface pin: every facet/view type above must exist on the
 * public surface. (If one is removed or renamed, THIS FILE fails to
 * typecheck — the type-level boundary proof.)
 */
type CommerceTypeSurfacePin = [
  VendorCapabilityFacets,
  VendorInventoryFacets,
  VendorTermsFacets,
  VendorFacets,
  ProcurementDemandFacets,
  VendorMatchFacets,
  QuoteFacets,
  QuoteLedgerEntryFacets,
  QuoteLedgerFacets,
  AggregatedOrderFacets,
  SoftwareSubscriptionFacets,
  DiagnosisEvidenceFacets,
  WarrantyRulesFacets,
  ServiceWorkOrderFacets,
  ServiceVendorMatchFacets,
  AggregatedServiceOrderFacets,
  ConnectivitySubmissionFacets,
  ConnectivityRecordFacets,
  MessageContentFacets,
  CommunicationIntentFacets,
  OutboxEntryFacets,
  DeliveryRecordFacets,
  SurfaceFieldView,
  VendorCatalogRowView,
  VendorInventorySignalView,
  VendorCatalogView,
  VendorCatalogResult,
  SoftwareCatalogRowView,
  SoftwareCatalogView,
  SoftwareCatalogResult,
  DeadlinePressureBucket,
  ProcurementDemandRowView,
  ProcurementDemandListView,
  DemandListResult,
  HeadroomView,
  VendorMatchRowView,
  VendorMatchingView,
  VendorMatchingResult,
  QuoteRowView,
  QuoteLedgerDisplayView,
  QuoteLedgerDisplayResult,
  QuoteEvaluationView,
  QuoteEvaluationResult,
  AggregatedOrderRowView,
  AggregationDisplayView,
  AggregationDisplayResult,
  DiagnosisEvidenceView,
  ServiceWorkOrderRowView,
  ServiceWorkOrderListView,
  ServiceWorkOrderListResult,
  WarrantyStandingView,
  WarrantyEligibilityRowView,
  WarrantyEligibilityResult,
  ServiceMatchRowView,
  ServiceMatchingView,
  ServiceMatchingResult,
  AggregatedServiceOrderRowView,
  AggregatedServiceOrderListView,
  AggregatedServiceOrderListResult,
  SubmissionRevisionView,
  ConnectivityRequestView,
  ConnectivityRequestResult,
  ConnectivitySubmissionListView,
  ConnectivitySubmissionListResult,
  ConnectivityTimelineEntryView,
  ConnectivityTimelineView,
  ConnectivityTimelineResult,
  OutboxRowView,
  OutboxListView,
  OutboxListResult,
  DeliveryAttemptView,
  DeliveryTimelineView,
  DeliveryTimelineResult,
  CommunicationSummaryView,
  CommunicationSummaryResult,
  ProcurementSurfaceState,
  ProcurementSurfaceEvent,
  ProcurementReduceResult,
  MaintenanceSurfaceState,
  MaintenanceSurfaceEvent,
  MaintenanceReduceResult,
  // outcomes.ts — the W090C verification + outcome view-models
  ScorecardDimensionFacets,
  VendorScorecardFacets,
  EvidenceClaimFacets,
  MarketplaceEvidencePackFacets,
  ServiceContractOutcomeFacets,
  ServiceAggregationOutcomeFacets,
  CommercialReconciliationFacets,
  SubscriptionReconciliationFacets,
  VendorScorecardRowView,
  VendorScorecardsView,
  VendorScorecardsResult,
  EvidencePackRowView,
  EvidencePacksView,
  EvidencePacksResult,
  MaintenanceOutcomeRowView,
  MaintenanceOutcomesView,
  MaintenanceOutcomesResult,
  OrderVerificationView,
  OrderVerificationResult,
  EntitlementVerificationView,
  EntitlementVerificationResult,
  SoftwareNeedSource,
  SoftwareNeedRowView,
  SoftwareNeedsView,
  SoftwareNeedsResult,
  SubscriptionLifecycleState,
  SubscriptionLifecycleView,
  SubscriptionLifecycleSource,
  FleetConnectivityRowView,
  FleetConnectivityStatusView,
  FleetConnectivityStatusResult,
  ConsoleStatus,
  CommerceJourneyStageState,
  JourneyStageId,
  JourneyRailStageView,
  WorkloadProcurementJourneySource,
  WorkloadProcurementJourneyView,
  WorkloadJourneyResult,
  JourneyNavState,
  JourneyNavEvent,
  JourneyNavResult,
];
void (undefined as unknown as CommerceTypeSurfacePin);

/** The exhaustive RUNTIME (value) export allowlist for @fleetos/web-commerce. */
const COMMERCE_VALUE_EXPORTS = new Set([
  // catalog.ts — PURE builders + frozen constants
  "VENDOR_CATALOG_VIEW_VERSION",
  "SOFTWARE_CATALOG_VIEW_VERSION",
  "buildVendorCatalogView",
  "buildSoftwareCatalogView",
  // procurement.ts — PURE builders + derivations + frozen constants
  "PROCUREMENT_VIEW_VERSION",
  "DEADLINE_PRESSURE_BUCKETS",
  "deriveDeadlinePressure",
  "buildProcurementDemandListView",
  "buildVendorMatchingView",
  "buildQuoteLedgerDisplay",
  "buildQuoteEvaluationView",
  "buildAggregationDisplayView",
  // maintenance.ts — PURE builders + derivations + frozen constants
  "MAINTENANCE_VIEW_VERSION",
  "deriveWarrantyStanding",
  "buildWarrantyEligibilityView",
  "buildServiceWorkOrderListView",
  "buildServiceMatchingView",
  "buildAggregatedServiceOrderListView",
  // connectivity.ts — PURE builders + frozen constants (LOCK 6-8)
  "CONNECTIVITY_VIEW_VERSION",
  "buildConnectivityRequestView",
  "buildConnectivitySubmissionListView",
  "buildConnectivityTimelineView",
  // communication.ts — PURE read-only builders + frozen constants (LOCK 10)
  "COMMUNICATION_VIEW_VERSION",
  "COMMUNICATION_KIND_SET",
  "buildOutboxListView",
  "buildDeliveryTimelineView",
  "buildCommunicationSummaryView",
  "selectOutboxRowsByKind",
  // state.ts — the pure state machines + frozen tables
  "PROCUREMENT_SURFACE_VIEWS",
  "PROCUREMENT_SURFACE_TRANSITIONS",
  "INITIAL_PROCUREMENT_SURFACE_STATE",
  "reduceProcurementSurfaceState",
  "MAINTENANCE_SURFACE_VIEWS",
  "MAINTENANCE_SURFACE_TRANSITIONS",
  "INITIAL_MAINTENANCE_SURFACE_STATE",
  "reduceMaintenanceSurfaceState",
  // outcomes.ts — the W090C verification + outcome view-models (PURE)
  "OUTCOMES_VIEW_VERSION",
  "buildVendorScorecardsView",
  "buildEvidencePacksView",
  "buildMaintenanceOutcomesView",
  "buildOrderVerificationView",
  "buildEntitlementVerificationView",
  "buildSoftwareNeedsView",
  "buildFleetConnectivityStatusView",
  "deriveMaintenanceVerification",
  "deriveRecordConnectivityVerification",
  // outcomes.ts — the W090C entitlement lifecycle derivation (PURE)
  "SUBSCRIPTION_LIFECYCLE_VIEW_VERSION",
  "SUBSCRIPTION_EXPIRING_WINDOW_DAYS",
  "deriveSubscriptionLifecycle",
  // ui/tokens.tsx — the local console design tokens (frozen CSS string)
  "CONSOLE_CSS",
  // ui/status.ts — the nine-state console vocabulary + domain mappings
  "CONSOLE_STATUS_LABEL",
  "CONSOLE_STATUS_ORDER",
  "chainStatusConsoleStatus",
  "deadlinePressureConsoleStatus",
  "deliveryStateConsoleStatus",
  "executionStateConsoleStatus",
  "journeyStageConsoleStatus",
  "maintenanceOutcomeConsoleStatus",
  "matchConsoleStatus",
  "quoteConsoleStatus",
  "submissionConsoleStatus",
  "warrantyStandingConsoleStatus",
  "subscriptionLifecycleConsoleStatus",
  // ui/primitives.tsx — the local shadcn-style primitives (PRESENTATIONAL)
  "AlertError",
  "Badge",
  "Breadcrumb",
  "Button",
  "Card",
  "CheckField",
  "ConsoleStyles",
  "DefinitionList",
  "Dialog",
  "Dropdown",
  "EmptyState",
  "Field",
  "Sheet",
  "Skeleton",
  "StatusIndicator",
  "Stepper",
  "Tabs",
  "Timeline",
  "Tooltip",
  // screens — the W090C rendered commerce screens (PRESENTATIONAL,
  // fully controlled; business truth stays in the W060C view-models)
  "CommerceJourneyRail",
  "ConsequentialActionCard",
  "PhasePresentation",
  "ProcurementScreen",
  "SoftwareScreen",
  "VendorsScreen",
  "MaintenanceScreen",
  "ConnectivityScreen",
  "CommunicationScreen",
  // W100C role-lens.ts — the role-aware commerce projection (PURE +
  // presentation-only constants)
  "COMMERCE_ROLE_LENSES",
  "COMMERCE_ROLE_LENS_IDS",
  "COMMERCE_ROLE_LENS_VIEW_VERSION",
  "applyCommerceRoleLens",
  // W100C discovery.ts — the Apify enrichment view (PROPOSAL-grade +
  // fail-visible provider-unavailable states; PURE builder)
  "VENDOR_DISCOVERY_VIEW_VERSION",
  "buildVendorDiscoveryView",
  // W143 lane-phase.ts — the honest lane-phase vocabulary + ScreenPhase mapping
  "COMMERCE_LANE_PHASE_KINDS",
  "COMMERCE_LANE_REASONS",
  "commerceLaneLoading",
  "toCommerceScreenPhase",
  "commerceLaneHasView",
  // W143 procurement-journey.ts — the seven-stage case journey view-model
  "PROCUREMENT_CASE_JOURNEY_STAGES",
  "PROCUREMENT_CASE_JOURNEY_HEADLINES",
  "buildProcurementVendorContextWalk",
  "buildProcurementDecisionWalk",
  "buildProcurementCaseJourney",
  // W143 procurement-feed.ts — the runtime composition function + system tenant
  "composeProcurementCasesFeed",
  "COMMERCE_FEED_SYSTEM_TENANT",
  // index.ts — module markers
  "MODULE_NAME",
  "MODULE_VERSION",
]);

/** The exhaustive RUNTIME (value) export allowlist for @fleetos/web-workloads. */
const WORKLOADS_VALUE_EXPORTS = new Set([
  // seams.ts — the LOCK 12 resource kinds (frozen constant)
  "WORKLOAD_RESOURCE_KINDS",
  // listing.ts — PURE builders + derivations + frozen constants
  "PROFILE_LIST_VIEW_VERSION",
  "REQUIREMENT_HIGHLIGHT_LIMIT",
  "deriveRequirementHighlights",
  "deriveConstraintCounts",
  "buildWorkloadProfileListView",
  // recommendations.ts — PURE builders + derivations + frozen constants
  "RECOMMENDATION_VIEW_VERSION",
  "deriveFitEvidence",
  "deriveRecommendationStatus",
  "buildWorkloadRecommendationDisplay",
  "selectRecommendationRow",
  // resources.ts — the LOCK 12 linkage surface (PURE)
  "RESOURCE_LINKAGE_VIEW_VERSION",
  "buildWorkloadResourceLinkageView",
  "selectResourceKindRows",
  // state.ts — the pure state machine + frozen tables
  "WORKLOAD_SURFACE_VIEWS",
  "WORKLOAD_SURFACE_TRANSITIONS",
  "INITIAL_WORKLOAD_SURFACE_STATE",
  "reduceWorkloadSurfaceState",
  "isLegalWorkloadSurfaceEvent",
  // journey.ts — the W090C D3 composite journey view-model + nav machine
  "WORKLOAD_JOURNEY_VIEW_VERSION",
  "JOURNEY_STAGE_IDS",
  "JOURNEY_STAGE_ROUTES",
  "INITIAL_JOURNEY_NAV_STATE",
  "buildWorkloadProcurementJourneyView",
  "journeyRailStages",
  "deriveConnectivityVerification",
  "reduceJourneyNavState",
  // ui/tokens.tsx — the local console design tokens (frozen CSS string)
  "CONSOLE_CSS",
  // ui/status.ts — the nine-state console vocabulary + domain mappings
  "CONSOLE_STATUS_LABEL",
  "CONSOLE_STATUS_ORDER",
  "deadlinePressureConsoleStatus",
  "fitConsoleStatus",
  "journeyStageConsoleStatus",
  "linkageConsoleStatus",
  "recommendationConsoleStatus",
  // ui/primitives.tsx — the local shadcn-style primitives (PRESENTATIONAL)
  "AlertError",
  "Badge",
  "Breadcrumb",
  "Button",
  "Card",
  "CheckField",
  "ConsoleStyles",
  "DefinitionList",
  "Dialog",
  "Dropdown",
  "EmptyState",
  "Field",
  "PhasePresentation",
  "Sheet",
  "Skeleton",
  "StatusIndicator",
  "Stepper",
  "Tabs",
  "Timeline",
  "Tooltip",
  // screens — the W090C rendered workload screens (PRESENTATIONAL)
  "WorkloadPlanningScreen",
  "RecommendationRecordCard",
  // W100C role-lens.ts — the role-aware workload projection (PURE +
  // presentation-only constants)
  "WORKLOAD_ROLE_LENSES",
  "WORKLOAD_ROLE_LENS_IDS",
  "WORKLOAD_ROLE_LENS_VIEW_VERSION",
  "applyWorkloadRoleLens",
  // W143 lane-phase.ts — the honest lane-phase vocabulary + ScreenPhase mapping
  "WORKLOAD_LANE_PHASE_KINDS",
  "WORKLOAD_LANE_REASONS",
  "workloadLaneLoading",
  "toWorkloadScreenPhase",
  "workloadLaneHasView",
  // W143 planning-journey.ts — the six-stage planning journey view-model
  "WORKLOAD_PLANNING_JOURNEY_STAGES",
  "WORKLOAD_PLANNING_JOURNEY_HEADLINES",
  "buildWorkloadPlanningRecommendationWalk",
  "buildWorkloadPlanningDecisionWalk",
  "buildWorkloadPlanningJourney",
  // W143 planning-feed.ts — the runtime composition function + system tenant
  "composeWorkloadPlanningFeed",
  "WORKLOAD_FEED_SYSTEM_TENANT",
  // index.ts — module markers
  "MODULE_NAME",
  "MODULE_VERSION",
]);

test("AUTHORITY BOUNDARY: the web-commerce VALUE export surface is exactly the allowlist", () => {
  const actual = new Set(Object.keys(commerce));
  const missing = [...COMMERCE_VALUE_EXPORTS].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !COMMERCE_VALUE_EXPORTS.has(name));
  expect(missing).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("AUTHORITY BOUNDARY: the web-workloads VALUE export surface is exactly the allowlist", () => {
  const actual = new Set(Object.keys(workloads));
  const missing = [...WORKLOADS_VALUE_EXPORTS].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !WORKLOADS_VALUE_EXPORTS.has(name));
  expect(missing).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("AUTHORITY BOUNDARY: the state machines never mutate their input state", () => {
  const before = Object.freeze({ view: "demands" } as const);
  const result = commerce.reduceProcurementSurfaceState(before, {
    type: "open_demand",
    demandId: "dmd_1",
  });
  expect(result.ok).toBe(true);
  expect(before.view).toBe("demands"); // the input state is untouched

  const maintenanceBefore = Object.freeze({ view: "workOrders" } as const);
  const maintenanceResult = commerce.reduceMaintenanceSurfaceState(maintenanceBefore, {
    type: "reset",
  });
  expect(maintenanceResult.ok).toBe(true);
  expect(maintenanceBefore.view).toBe("workOrders");
});

test("the six communication kinds are surfaced verbatim (LOCK 10 metadata-only)", () => {
  expect(commerce.COMMUNICATION_KIND_SET).toEqual([
    "maintenance_notice",
    "incident_warning",
    "approval_request",
    "recovery_message",
    "procurement_update",
    "manager_briefing",
  ]);
});

test("the state machines refuse illegal events machine-stably", () => {
  const state = { view: "quote", demandId: "dmd_1", quoteId: "qt_1" } as const;
  const refused = commerce.reduceProcurementSurfaceState(state, { type: "open_matching" });
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  expect(refused.error.code).toBe("web-commerce.state.illegal_event");
  expect(refused.reason).toBe("illegal_event");

  const workloadsRefused = workloads.reduceWorkloadSurfaceState(
    { view: "list" },
    { type: "back" },
  );
  expect(workloadsRefused.ok).toBe(false);
  if (workloadsRefused.ok) throw new Error("expected refusal");
  expect(workloadsRefused.reason).toBe("illegal_event");
});

test("the workload journey machine walks the full legal path", () => {
  let state = workloads.INITIAL_WORKLOAD_SURFACE_STATE;
  const select = workloads.reduceWorkloadSurfaceState(state, {
    type: "select_profile",
    workloadId: "wl_1",
  });
  if (!select.ok) throw new Error(select.error.message);
  state = select.state;
  expect(state.view).toBe("profile");

  const open = workloads.reduceWorkloadSurfaceState(state, {
    type: "open_recommendation",
    recommendationId: "rec_1",
  });
  if (!open.ok) throw new Error(open.error.message);
  state = open.state;
  expect(state).toEqual({
    view: "recommendation",
    workloadId: "wl_1",
    recommendationId: "rec_1",
  });

  const back = workloads.reduceWorkloadSurfaceState(state, { type: "back" });
  if (!back.ok) throw new Error(back.error.message);
  expect(back.state).toEqual({ view: "profile", workloadId: "wl_1" });
});
