/**
 * @fleetos/web-commerce — the VERIFICATION + OUTCOME view-models
 * (W090C D2/D4): the read-only surfaces that close the 🟡 journey
 * gaps — the terminal VERIFIED states for procurement orders, software
 * entitlements, maintenance exchanges and fleet connectivity, plus the
 * W072 vendor scorecards and marketplace evidence packs rendered
 * read-only, and the D3 software-need view.
 *
 * Every builder is a PURE projection over INJECTED domain records
 * declared as local facets (the W040-disclosed pattern — each surface
 * package declares the minimum it displays; the REAL records
 * (`VendorScorecard`, `MarketplaceEvidencePack` from @fleetos/vendors,
 * `ServiceAggregationOutcome` from @fleetos/maintenance,
 * `CommercialReconciliationReport` from @fleetos/procurement,
 * `SubscriptionReconciliationReport` from @fleetos/software, the W050A
 * submission + adopted records) are ASSIGNABLE by structural typing
 * and proven by test).
 *
 * The verification semantics are NEVER invented here:
 *   - a procurement order is verified by the commercial
 *     reconciliation (delivered chains with zero discrepancies);
 *   - a software entitlement is verified by the provision evidence
 *     (provisioned chains with zero discrepancies);
 *   - a maintenance exchange is verified by the measured aggregation
 *     outcome (every member contract served — completion evidence);
 *   - a fleet connectivity row is verified by the adopted record's
 *     latest revision (ACTIVE + measurements + no failure).
 *
 * No runtime dependencies beyond @fleetos/contracts (the software-need
 * input reuses the FROZEN `SoftwareSubscriptionIntentPayload`). No
 * `any` in public signatures. Strict TS. No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import type { SoftwareSubscriptionIntentPayload } from "@fleetos/contracts";
import {
  compareStrings,
  frozen,
  frozenArray,
  makeSurfaceValidationError,
  parseIsoMs,
  tenantMismatch,
} from "./internal";
import type { ConnectivityRecordFacets, ConnectivitySubmissionFacets } from "./seams";
import type { SoftwareCatalogView } from "./catalog";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The outcomes view-model schema version. */
export const OUTCOMES_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The W072 facets (locally declared — the W040 pattern)
// ---------------------------------------------------------------------------

/** One scorecard dimension score (the W072 shape). */
export interface ScorecardDimensionFacets {
  readonly kind: string;
  readonly numerator: number;
  readonly denominator: number;
  /** value = numerator / denominator; null iff denominator === 0. */
  readonly value: number | null;
}

/**
 * The vendor-scorecard facets — the W072 `VendorScorecard` is
 * ASSIGNABLE to this shape (read-only render input).
 */
export interface VendorScorecardFacets {
  readonly scorecardId: string;
  readonly tenantId: TenantId;
  readonly vendorId: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly interactionRefs: readonly string[];
  readonly matchSummary: Readonly<{
    readonly total: number;
    readonly satisfiable: number;
    readonly rejected: number;
  }>;
  readonly dimensions: readonly ScorecardDimensionFacets[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/** One marketplace evidence claim (the W072 shape). */
export interface EvidenceClaimFacets {
  readonly kind: string;
  readonly value: number;
  readonly sourceRefs: readonly string[];
}

/**
 * The marketplace evidence-pack facets — the W072
 * `MarketplaceEvidencePack` is ASSIGNABLE to this shape. The status is
 * always PROPOSAL (never auto-published) — rendered explicitly.
 */
export interface MarketplaceEvidencePackFacets {
  readonly packId: string;
  readonly tenantId: TenantId;
  readonly vendorId: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly status: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly claims: readonly EvidenceClaimFacets[];
  readonly notApplicableScorecardDimensions: readonly string[];
  readonly sourceRecordIds: readonly string[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/** One served contract's measured outcome (the W072 shape). */
export interface ServiceContractOutcomeFacets {
  readonly workOrderId: string;
  readonly vendorId: string;
  readonly completedAt: string;
  readonly deadline: string;
  readonly metDeadline: boolean;
}

/**
 * The service-aggregation-outcome facets — the W072
 * `ServiceAggregationOutcome` is ASSIGNABLE to this shape. This is the
 * VERIFIED maintenance outcome surface (per-contract completion
 * evidence + coverage + deadline adherence).
 */
export interface ServiceAggregationOutcomeFacets {
  readonly outcomeId: string;
  readonly tenantId: TenantId;
  readonly aggregationId: string;
  readonly vendorId: string;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly ordersAggregated: number;
  readonly ordersServed: number;
  readonly coverageRatio: number;
  readonly deadlineAdherence: Readonly<{
    readonly metCount: number;
    readonly missedCount: number;
    readonly onTimeRatio: number | null;
  }>;
  readonly perContract: readonly ServiceContractOutcomeFacets[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/**
 * The commercial-reconciliation facets — the W032
 * `CommercialReconciliationReport` is ASSIGNABLE to this shape (the
 * procurement order verification evidence).
 */
export interface CommercialReconciliationFacets {
  readonly reportId: string;
  readonly tenantId: TenantId;
  readonly chainCount: number;
  readonly chainStatusCounts: Readonly<Record<string, number>>;
  readonly discrepancyCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly computedAt: string;
  readonly contentHash: string;
}

/**
 * The subscription-reconciliation facets — the W032B
 * `SubscriptionReconciliationReport` is ASSIGNABLE to this shape (the
 * software entitlement verification evidence).
 */
export interface SubscriptionReconciliationFacets {
  readonly reportId: string;
  readonly tenantId: TenantId;
  readonly chainCount: number;
  readonly provisionedChainCount: number;
  readonly discrepancyCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly computedAt: string;
  readonly contentHash: string;
}

// ---------------------------------------------------------------------------
// The vendor scorecards view (read-only, W072)
// ---------------------------------------------------------------------------

/** One vendor scorecard display row. */
export interface VendorScorecardRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly scorecardId: string;
  readonly vendorId: string;
  readonly revision: number;
  readonly supersedes: string | null;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly interactionCount: number;
  readonly matchTotal: number;
  readonly matchSatisfiable: number;
  readonly matchRejected: number;
  /** The measured dimensions (canonical order preserved). */
  readonly dimensions: readonly ScorecardDimensionFacets[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/** The scorecards list view. */
export interface VendorScorecardsView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by vendorId then revision (deterministic). */
  readonly rows: readonly VendorScorecardRowView[];
  readonly total: number;
}

/** The tagged result of a scorecards build. */
export type VendorScorecardsResult =
  | { readonly ok: true; readonly view: VendorScorecardsView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the read-only vendor scorecards view (the W072 surfaces).
 * PURE and DETERMINISTIC: rows order by vendorId then revision;
 * cross-tenant records are REFUSED.
 */
export function buildVendorScorecardsView(
  tenantId: TenantId,
  scorecards: readonly VendorScorecardFacets[],
): VendorScorecardsResult {
  if (!Array.isArray(scorecards)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.outcomes",
        "scorecards view request is invalid",
        tenantId,
        [{ path: "/scorecards", reason: "array_required" }],
      ),
    };
  }
  for (const scorecard of scorecards) {
    const mismatch = tenantMismatch(tenantId, scorecard?.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const rows: VendorScorecardRowView[] = scorecards.map((scorecard) =>
    frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      scorecardId: scorecard.scorecardId,
      vendorId: scorecard.vendorId,
      revision: scorecard.revision,
      supersedes: scorecard.supersedes ?? null,
      windowFrom: scorecard.window.from,
      windowTo: scorecard.window.to,
      interactionCount: scorecard.interactionRefs.length,
      matchTotal: scorecard.matchSummary.total,
      matchSatisfiable: scorecard.matchSummary.satisfiable,
      matchRejected: scorecard.matchSummary.rejected,
      dimensions: frozenArray([...scorecard.dimensions]),
      computedAt: scorecard.computedAt,
      contentHash: scorecard.contentHash,
    }),
  );
  rows.sort((a, b) => {
    const byVendor = compareStrings(a.vendorId, b.vendorId);
    if (byVendor !== 0) return byVendor;
    return a.revision - b.revision;
  });
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The marketplace evidence packs view (read-only, W072)
// ---------------------------------------------------------------------------

/** One evidence-pack display row. */
export interface EvidencePackRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly packId: string;
  readonly vendorId: string;
  readonly revision: number;
  readonly supersedes: string | null;
  /** Always PROPOSAL — rendered explicitly (never auto-published). */
  readonly status: string;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly claims: readonly EvidenceClaimFacets[];
  readonly notApplicableScorecardDimensions: readonly string[];
  readonly sourceRecordIds: readonly string[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/** The evidence packs list view. */
export interface EvidencePacksView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by vendorId then revision (deterministic). */
  readonly rows: readonly EvidencePackRowView[];
  readonly total: number;
}

/** The tagged result of an evidence-packs build. */
export type EvidencePacksResult =
  | { readonly ok: true; readonly view: EvidencePacksView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the read-only marketplace evidence packs view (the W072
 * quality-evidence surfaces). PURE and DETERMINISTIC.
 */
export function buildEvidencePacksView(
  tenantId: TenantId,
  packs: readonly MarketplaceEvidencePackFacets[],
): EvidencePacksResult {
  if (!Array.isArray(packs)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.outcomes",
        "evidence packs view request is invalid",
        tenantId,
        [{ path: "/packs", reason: "array_required" }],
      ),
    };
  }
  for (const pack of packs) {
    const mismatch = tenantMismatch(tenantId, pack?.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const rows: EvidencePackRowView[] = packs.map((pack) =>
    frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      packId: pack.packId,
      vendorId: pack.vendorId,
      revision: pack.revision,
      supersedes: pack.supersedes ?? null,
      status: pack.status,
      windowFrom: pack.window.from,
      windowTo: pack.window.to,
      claims: frozenArray([...pack.claims]),
      notApplicableScorecardDimensions: frozenArray([...pack.notApplicableScorecardDimensions]),
      sourceRecordIds: frozenArray([...pack.sourceRecordIds]),
      computedAt: pack.computedAt,
      contentHash: pack.contentHash,
    }),
  );
  rows.sort((a, b) => {
    const byVendor = compareStrings(a.vendorId, b.vendorId);
    if (byVendor !== 0) return byVendor;
    return a.revision - b.revision;
  });
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The VERIFIED maintenance outcome view (W072 D3 — the terminal state)
// ---------------------------------------------------------------------------

/** One measured maintenance outcome display row. */
export interface MaintenanceOutcomeRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly outcomeId: string;
  readonly aggregationId: string;
  readonly vendorId: string;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly ordersAggregated: number;
  readonly ordersServed: number;
  readonly coverageRatio: number;
  readonly metCount: number;
  readonly missedCount: number;
  readonly onTimeRatio: number | null;
  /** True when EVERY member contract was served (full coverage). */
  readonly fullCoverage: boolean;
  /** The per-contract completion evidence (sorted by workOrderId). */
  readonly perContract: readonly ServiceContractOutcomeFacets[];
  readonly computedAt: string;
  readonly contentHash: string;
}

/** The maintenance outcomes list view. */
export interface MaintenanceOutcomesView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by aggregationId (deterministic). */
  readonly rows: readonly MaintenanceOutcomeRowView[];
  readonly total: number;
  /** The count of VERIFIED outcomes (full coverage). */
  readonly verifiedCount: number;
}

/** The tagged result of a maintenance-outcomes build. */
export type MaintenanceOutcomesResult =
  | { readonly ok: true; readonly view: MaintenanceOutcomesView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Derive the maintenance-outcome verification predicate (PURE): full
 * coverage — every aggregated member contract carries completion
 * evidence.
 */
export function deriveMaintenanceVerification(outcome: ServiceAggregationOutcomeFacets): boolean {
  return outcome.ordersServed === outcome.ordersAggregated && outcome.ordersAggregated > 0;
}

/**
 * Build the VERIFIED maintenance outcome view (the W072 measured
 * aggregation outcomes — the terminal verification state of the
 * maintenance exchange journey). PURE and DETERMINISTIC.
 */
export function buildMaintenanceOutcomesView(
  tenantId: TenantId,
  outcomes: readonly ServiceAggregationOutcomeFacets[],
): MaintenanceOutcomesResult {
  if (!Array.isArray(outcomes)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.outcomes",
        "maintenance outcomes view request is invalid",
        tenantId,
        [{ path: "/outcomes", reason: "array_required" }],
      ),
    };
  }
  for (const outcome of outcomes) {
    const mismatch = tenantMismatch(tenantId, outcome?.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const rows: MaintenanceOutcomeRowView[] = outcomes.map((outcome) => {
    const perContract = frozenArray(
      [...outcome.perContract].sort((a, b) => compareStrings(a.workOrderId, b.workOrderId)),
    );
    return frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      outcomeId: outcome.outcomeId,
      aggregationId: outcome.aggregationId,
      vendorId: outcome.vendorId,
      serviceArea: outcome.serviceArea,
      deadline: outcome.deadline,
      ordersAggregated: outcome.ordersAggregated,
      ordersServed: outcome.ordersServed,
      coverageRatio: outcome.coverageRatio,
      metCount: outcome.deadlineAdherence.metCount,
      missedCount: outcome.deadlineAdherence.missedCount,
      onTimeRatio: outcome.deadlineAdherence.onTimeRatio,
      fullCoverage: deriveMaintenanceVerification(outcome),
      perContract,
      computedAt: outcome.computedAt,
      contentHash: outcome.contentHash,
    });
  });
  rows.sort((a, b) => compareStrings(a.aggregationId, b.aggregationId));
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      verifiedCount: rows.filter((row) => row.fullCoverage).length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The order verification view (procurement — commercial reconciliation)
// ---------------------------------------------------------------------------

/** The procurement order verification display (read-only). */
export interface OrderVerificationView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly reportId: string;
  readonly computedAt: string;
  readonly chainCount: number;
  readonly chainStatusCounts: Readonly<Record<string, number>>;
  readonly discrepancyCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  /** True when at least one delivered chain exists and ZERO discrepancies. */
  readonly verified: boolean;
  readonly verificationSummary: string;
  readonly contentHash: string;
}

/** The tagged result of an order-verification build. */
export type OrderVerificationResult =
  | { readonly ok: true; readonly view: OrderVerificationView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the procurement ORDER verification view (the commercial
 * reconciliation report rendered as the terminal verification state):
 * verified = delivered chains exist and zero discrepancies. PURE.
 */
export function buildOrderVerificationView(
  tenantId: TenantId,
  report: CommercialReconciliationFacets | null,
): OrderVerificationResult {
  if (report !== null) {
    const mismatch = tenantMismatch(tenantId, report.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  if (report === null) {
    return {
      ok: true,
      view: frozen({
        viewVersion: OUTCOMES_VIEW_VERSION,
        tenantId,
        reportId: "",
        computedAt: "",
        chainCount: 0,
        chainStatusCounts: frozen({}),
        discrepancyCount: 0,
        byKind: frozen({}),
        verified: false,
        verificationSummary: "No reconciliation report verifies the orders yet.",
        contentHash: "",
      }),
    };
  }
  const delivered = report.chainStatusCounts["delivered"] ?? 0;
  const verified = delivered > 0 && report.discrepancyCount === 0;
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      reportId: report.reportId,
      computedAt: report.computedAt,
      chainCount: report.chainCount,
      chainStatusCounts: frozen({ ...report.chainStatusCounts }),
      discrepancyCount: report.discrepancyCount,
      byKind: frozen({ ...report.byKind }),
      verified,
      verificationSummary: verified
        ? `Orders verified against delivery evidence: ${String(delivered)} delivered chain${delivered === 1 ? "" : "s"}, zero discrepancies.`
        : `Orders not yet verified: ${String(report.discrepancyCount)} discrepanc${report.discrepancyCount === 1 ? "y" : "ies"} across ${String(report.chainCount)} chain${report.chainCount === 1 ? "" : "s"}.`,
      contentHash: report.contentHash,
    }),
  };
}

// ---------------------------------------------------------------------------
// The entitlement verification view (software — provision evidence)
// ---------------------------------------------------------------------------

/** The software entitlement verification display (read-only). */
export interface EntitlementVerificationView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly reportId: string;
  readonly computedAt: string;
  readonly chainCount: number;
  readonly provisionedChainCount: number;
  readonly discrepancyCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  /** True when every chain carries provision evidence and zero discrepancies. */
  readonly verified: boolean;
  readonly verificationSummary: string;
  readonly contentHash: string;
}

/** The tagged result of an entitlement-verification build. */
export type EntitlementVerificationResult =
  | { readonly ok: true; readonly view: EntitlementVerificationView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the software ENTITLEMENT verification view (the subscription
 * reconciliation report rendered as the terminal verification state):
 * verified = every chain provisioned with zero discrepancies. PURE.
 */
export function buildEntitlementVerificationView(
  tenantId: TenantId,
  report: SubscriptionReconciliationFacets | null,
): EntitlementVerificationResult {
  if (report !== null) {
    const mismatch = tenantMismatch(tenantId, report.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  if (report === null) {
    return {
      ok: true,
      view: frozen({
        viewVersion: OUTCOMES_VIEW_VERSION,
        tenantId,
        reportId: "",
        computedAt: "",
        chainCount: 0,
        provisionedChainCount: 0,
        discrepancyCount: 0,
        byKind: frozen({}),
        verified: false,
        verificationSummary: "No provision evidence verifies the entitlements yet.",
        contentHash: "",
      }),
    };
  }
  const verified =
    report.chainCount > 0 &&
    report.provisionedChainCount === report.chainCount &&
    report.discrepancyCount === 0;
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      reportId: report.reportId,
      computedAt: report.computedAt,
      chainCount: report.chainCount,
      provisionedChainCount: report.provisionedChainCount,
      discrepancyCount: report.discrepancyCount,
      byKind: frozen({ ...report.byKind }),
      verified,
      verificationSummary: verified
        ? `Entitlements verified against provision evidence: ${String(report.provisionedChainCount)} of ${String(report.chainCount)} chain${report.chainCount === 1 ? "" : "s"} provisioned, zero discrepancies.`
        : `Entitlements not yet verified: ${String(report.provisionedChainCount)} of ${String(report.chainCount)} chain${report.chainCount === 1 ? "" : "s"} provisioned, ${String(report.discrepancyCount)} discrepanc${report.discrepancyCount === 1 ? "y" : "ies"}.`,
      contentHash: report.contentHash,
    }),
  };
}

// ---------------------------------------------------------------------------
// The software-needs view (D3 — the recommendation -> need -> allocation)
// ---------------------------------------------------------------------------

/** One software-need source (the workload recommendation's draft intent). */
export interface SoftwareNeedSource {
  readonly workloadId: string;
  readonly payload: SoftwareSubscriptionIntentPayload;
}

/** One software-need display row. */
export interface SoftwareNeedRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  readonly softwareId: string | null;
  readonly seatCount: number;
  /** True when the catalog carries an allocated subscription for the need. */
  readonly satisfied: boolean;
  /** The satisfying subscription id, when allocated. */
  readonly subscriptionId: string | null;
  readonly summary: string;
}

/** The software-needs view. */
export interface SoftwareNeedsView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by workloadId then softwareId (deterministic). */
  readonly rows: readonly SoftwareNeedRowView[];
  readonly total: number;
  readonly satisfiedCount: number;
}

/** The tagged result of a software-needs build. */
export type SoftwareNeedsResult =
  | { readonly ok: true; readonly view: SoftwareNeedsView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the software-NEEDS view: the workload recommendations' draft
 * software-subscription intents joined against the allocated catalog
 * (a need is SATISFIED when a subscription with the same softwareId
 * and workloadId exists). PURE and DETERMINISTIC.
 */
export function buildSoftwareNeedsView(
  tenantId: TenantId,
  needs: readonly SoftwareNeedSource[],
  catalog: SoftwareCatalogView,
): SoftwareNeedsResult {
  if (!Array.isArray(needs)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.outcomes",
        "software needs view request is invalid",
        tenantId,
        [{ path: "/needs", reason: "array_required" }],
      ),
    };
  }
  // LOCK 17: the catalog view's tenant scope must match the acting tenant.
  const catalogMismatch = tenantMismatch(
    tenantId,
    catalog?.tenantId,
    "web-commerce.outcomes",
  );
  if (catalogMismatch !== null) return { ok: false, error: catalogMismatch };
  const rows: SoftwareNeedRowView[] = needs.map((need) => {
    const softwareId = need.payload.softwareId ?? null;
    const match =
      softwareId === null
        ? undefined
        : catalog.rows.find(
            (row) => row.softwareId === softwareId && row.workloadId === need.workloadId,
          );
    return frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      workloadId: need.workloadId,
      softwareId,
      seatCount: need.payload.seatCount,
      satisfied: match !== undefined,
      subscriptionId: match?.subscriptionId ?? null,
      summary:
        match !== undefined
          ? `Need satisfied: subscription ${match.subscriptionId} allocates ${String(match.seatCount)} seat${match.seatCount === 1 ? "" : "s"} of ${match.softwareId} for workload ${need.workloadId}.`
          : `Need open: ${String(need.payload.seatCount)} seat${need.payload.seatCount === 1 ? "" : "s"} of ${softwareId ?? "unspecified software"} for workload ${need.workloadId} — no subscription is allocated yet.`,
    });
  });
  rows.sort((a, b) => {
    const byWorkload = compareStrings(a.workloadId, b.workloadId);
    if (byWorkload !== 0) return byWorkload;
    return compareStrings(a.softwareId ?? "", b.softwareId ?? "");
  });
  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      satisfiedCount: rows.filter((row) => row.satisfied).length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The entitlement lifecycle derivation (allocated / expiring / expired)
// ---------------------------------------------------------------------------

/** The entitlement lifecycle states (D2.2): the term window drives the state. */
export type SubscriptionLifecycleState = "allocated" | "expiring" | "expired";

/** The machine-stable expiring window (days before the term ends). */
export const SUBSCRIPTION_EXPIRING_WINDOW_DAYS = 30 as const;

/** The entitlement lifecycle view-model schema version. */
export const SUBSCRIPTION_LIFECYCLE_VIEW_VERSION = 1 as const;

/** The derived lifecycle facts of one allocated subscription. */
export interface SubscriptionLifecycleView {
  readonly viewVersion: number;
  /** The derived lifecycle state (allocated/expiring/expired). */
  readonly state: SubscriptionLifecycleState;
  /** The term's end instant (allocatedAt + termDays), ISO 8601. */
  readonly endsAt: string;
  /** Whole days from `now` until the term ends (negative once expired). */
  readonly daysRemaining: number;
  /** The machine-stable one-line summary. */
  readonly summary: string;
}

/** The minimum subscription facts the lifecycle derivation reads (the W040 pattern). */
export interface SubscriptionLifecycleSource {
  readonly subscriptionId: string;
  readonly softwareId: string;
  readonly allocatedAt: string;
  readonly termDays: number;
}

/** One day in milliseconds (the machine-stable term unit). */
const DAY_MS = 86_400_000;

/**
 * Derive one entitlement's lifecycle state from the INJECTED `now`
 * (PURE and DETERMINISTIC — the same `now` + row always produce the
 * same state; no clock is read): a term is EXPIRED once `now` passes
 * its end, EXPIRING within the frozen window before that, ALLOCATED
 * (healthy) otherwise.
 */
export function deriveSubscriptionLifecycle(
  now: string,
  row: SubscriptionLifecycleSource,
): SubscriptionLifecycleView {
  const nowMs = parseIsoMs(now);
  const endsAtMs = parseIsoMs(row.allocatedAt) + row.termDays * DAY_MS;
  const daysRemaining = Math.floor((endsAtMs - nowMs) / DAY_MS);
  const state: SubscriptionLifecycleState =
    daysRemaining < 0
      ? "expired"
      : daysRemaining <= SUBSCRIPTION_EXPIRING_WINDOW_DAYS
        ? "expiring"
        : "allocated";
  const endsAt = new Date(endsAtMs).toISOString();
  const daysLabel = (days: number): string =>
    `${String(Math.abs(days))} day${Math.abs(days) === 1 ? "" : "s"}`;
  return frozen({
    viewVersion: SUBSCRIPTION_LIFECYCLE_VIEW_VERSION,
    state,
    endsAt,
    daysRemaining,
    summary:
      state === "expired"
        ? `Subscription ${row.subscriptionId} of ${row.softwareId} expired at ${endsAt} (${daysLabel(daysRemaining)} past).`
        : `Subscription ${row.subscriptionId} of ${row.softwareId} term ends ${endsAt} (${daysLabel(daysRemaining)} remaining).`,
  });
}

// ---------------------------------------------------------------------------
// The fleet connectivity status view (per-device, D2.5)
// ---------------------------------------------------------------------------

/** One per-device connectivity status row. */
export interface FleetConnectivityRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  /** The workload the submissions target, when present. */
  readonly workloadId: string | null;
  /** The submissions targeting this device (submissionId order). */
  readonly submissionIds: readonly string[];
  /** The latest submission status targeting the device, when present. */
  readonly latestSubmissionStatus: string | null;
  /** True when a PARKED submission awaits human approval. */
  readonly awaitingApproval: boolean;
  /** The adopted connectivity record joined by intent id, when present. */
  readonly connectivityId: string | null;
  /** The adopted record's current execution state, when present. */
  readonly executionState: string | null;
  /** The adopted record's latest revision is degraded. */
  readonly degraded: boolean;
  /** The adopted record's latest revision carries a failure. */
  readonly failed: boolean;
  /** The measurement kinds on the latest revision (sorted). */
  readonly measurementKinds: readonly string[];
  /** VERIFIED: ACTIVE + measurements + no failure. */
  readonly verified: boolean;
  readonly summary: string;
}

/** The fleet connectivity status view (per-device rows). */
export interface FleetConnectivityStatusView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by deviceId (deterministic). */
  readonly rows: readonly FleetConnectivityRowView[];
  readonly total: number;
  readonly verifiedCount: number;
  readonly awaitingApprovalCount: number;
}

/** The tagged result of a fleet-status build. */
export type FleetConnectivityStatusResult =
  | { readonly ok: true; readonly view: FleetConnectivityStatusView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Derive the connectivity verification predicate over an adopted
 * record's facets (PURE): the current execution state is ACTIVE, the
 * latest revision carries measurements, and no failure is present.
 */
export function deriveRecordConnectivityVerification(
  record: ConnectivityRecordFacets,
): boolean {
  const latest = record.revisions[record.revisions.length - 1];
  return (
    record.executionState === "ACTIVE" &&
    latest !== undefined &&
    latest.measurements.length > 0 &&
    latest.failure.kind === "none"
  );
}

/**
 * Build the per-device FLEET CONNECTIVITY STATUS view: every device
 * referenced by a submission target (source or target device) gets one
 * row with its submissions' statuses and the adopted record joined by
 * the originating intent id (the machine-stable join). PURE and
 * DETERMINISTIC: rows order by deviceId; verification derives ONLY
 * from the adopted record's own state.
 */
export function buildFleetConnectivityStatusView(
  tenantId: TenantId,
  submissions: readonly ConnectivitySubmissionFacets[],
  records: readonly ConnectivityRecordFacets[],
): FleetConnectivityStatusResult {
  if (!Array.isArray(submissions) || !Array.isArray(records)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.outcomes",
        "fleet connectivity view request is invalid",
        tenantId,
        [{ path: "/submissions", reason: "array_required" }],
      ),
    };
  }
  for (const submission of submissions) {
    const mismatch = tenantMismatch(tenantId, submission?.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  for (const record of records) {
    const mismatch = tenantMismatch(tenantId, record?.tenantId, "web-commerce.outcomes");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const deviceIds = new Set<string>();
  const submissionsByDevice = new Map<string, ConnectivitySubmissionFacets[]>();
  for (const submission of submissions) {
    const targets = [
      submission.request.targets.sourceDeviceId,
      submission.request.targets.targetDeviceId,
    ];
    for (const deviceId of targets) {
      if (deviceId === undefined) continue;
      deviceIds.add(deviceId);
      const list = submissionsByDevice.get(deviceId) ?? [];
      list.push(submission);
      submissionsByDevice.set(deviceId, list);
    }
  }

  const latestRevision = (record: ConnectivityRecordFacets) =>
    record.revisions[record.revisions.length - 1];

  const rows: FleetConnectivityRowView[] = [...deviceIds].sort(compareStrings).map((deviceId) => {
    const deviceSubmissions = (submissionsByDevice.get(deviceId) ?? []).sort((a, b) =>
      compareStrings(a.submissionId, b.submissionId),
    );
    // The latest submission = the greatest submissionId (deterministic).
    const latestSubmission = deviceSubmissions[deviceSubmissions.length - 1] ?? null;
    const awaitingApproval = deviceSubmissions.some((submission) => submission.status === "PARKED");
    const workloadId =
      deviceSubmissions.find((submission) => submission.request.targets.workloadId !== undefined)
        ?.request.targets.workloadId ?? null;

    // Join the adopted record through the submission's intent ref.
    const joined = deviceSubmissions
      .map((submission) => {
        const record =
          records.find((candidate) => candidate.intentRef !== null && candidate.intentRef.intentId === submission.request.intentRef.intentId) ?? null;
        return { submission, record };
      })
      .filter((pair) => pair.record !== null)
      .sort((a, b) => compareStrings(a.submission.submissionId, b.submission.submissionId));
    const adopted = joined.length > 0 ? (joined[joined.length - 1]?.record ?? null) : null;

    const verified = adopted !== null && deriveRecordConnectivityVerification(adopted);
    const latest = adopted !== null ? latestRevision(adopted) : undefined;
    const degraded = latest !== undefined && latest.degradation.kind !== "none";
    const failed = latest !== undefined && latest.failure.kind !== "none";
    const measurementKinds =
      latest !== undefined
        ? frozenArray([...new Set(latest.measurements.map((m) => m.kind))].sort(compareStrings))
        : frozenArray([]);

    const summary =
      adopted !== null && verified
        ? `Device ${deviceId} connectivity ${adopted.connectivityId} VERIFIED: ACTIVE with measurements (${measurementKinds.join(", ")}).`
        : adopted !== null
          ? `Device ${deviceId} connectivity ${adopted.connectivityId} is ${adopted.executionState}${failed ? " (failure observed)" : degraded ? " (degraded)" : ""} — not yet verified.`
          : latestSubmission !== null
            ? `Device ${deviceId} has submission ${latestSubmission.submissionId} (${latestSubmission.status}) with no adopted connectivity record yet.`
            : `Device ${deviceId} has no connectivity request.`;

    return frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      deviceId,
      workloadId,
      submissionIds: frozenArray(deviceSubmissions.map((submission) => submission.submissionId)),
      latestSubmissionStatus: latestSubmission?.status ?? null,
      awaitingApproval,
      connectivityId: adopted?.connectivityId ?? null,
      executionState: adopted?.executionState ?? null,
      degraded,
      failed,
      measurementKinds,
      verified,
      summary,
    });
  });

  return {
    ok: true,
    view: frozen({
      viewVersion: OUTCOMES_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      verifiedCount: rows.filter((row) => row.verified).length,
      awaitingApprovalCount: rows.filter((row) => row.awaitingApproval).length,
    }),
  };
}
