/**
 * @fleetos/web-commerce — the PROCUREMENT exchange surface (W032).
 *
 * The demand-side orchestrator's display: demand views, vendor matching
 * (deterministic hard gates + HEADROOM RANKS displayed machine-stable),
 * versioned quotes with acceptance, and the W042-style deadline
 * aggregation display — compatible order aggregation with PER-CONTRACT
 * IDENTITY PRESERVED (`spec/ARCHITECTURE-LOCK.md` item 14).
 *
 * Headroom ranks: for every vendor match the surface derives the typed
 * headrooms of the vendor's terms over the demand's floors (SLA
 * coverage, warranty days, quality score, inventory availability) plus
 * the budget headroom at the quoted price. Every value is a pure
 * subtraction of domain-typed comparables — never recomputed, never
 * re-ranked: the RANK ORDER is the engine's own (`rankScore` desc,
 * vendorId asc); the surface displays the engine's rank and adds the
 * per-dimension headrooms as evidence columns.
 *
 * The surface is READ-ONLY: acceptance is DISPLAYED (the quote's status
 * and the ledger's acceptance entries), never performed.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; `now` is injected for deadline-pressure columns.
 */

import type { TenantId } from "@fleetos/contracts";
import type {
  AggregatedOrderFacets,
  ProcurementDemandFacets,
  QuoteFacets,
  QuoteLedgerFacets,
  VendorMatchFacets,
} from "./seams";
import {
  compareStrings,
  daysUntil,
  frozen,
  frozenArray,
  looksLikeIso,
  makeSurfaceValidationError,
  parseIsoMs,
  tenantMismatch,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The procurement view-model schema version. */
export const PROCUREMENT_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Deadline pressure (machine-stable buckets, injected `now`)
// ---------------------------------------------------------------------------

/**
 * The deadline-pressure buckets (machine-stable): whole days from the
 * injected `now` to the deadline.
 */
export type DeadlinePressureBucket = "overdue" | "critical" | "urgent" | "soon" | "comfortable";

/** The bucket boundaries (whole days, inclusive). */
export const DEADLINE_PRESSURE_BUCKETS: Readonly<
  Record<Exclude<DeadlinePressureBucket, "overdue">, readonly [number, number]>
> = Object.freeze({
  critical: [0, 1],
  urgent: [2, 3],
  soon: [4, 7],
  comfortable: [8, Number.MAX_SAFE_INTEGER],
});

/**
 * Derive the deadline-pressure bucket from whole days-until-deadline.
 * Negative days are `overdue`. PURE.
 */
export function deriveDeadlinePressure(days: number): DeadlinePressureBucket {
  if (days < 0) return "overdue";
  if (days <= 1) return "critical";
  if (days <= 3) return "urgent";
  if (days <= 7) return "soon";
  return "comfortable";
}

// ---------------------------------------------------------------------------
// The demand view
// ---------------------------------------------------------------------------

/** The demand display row. */
export interface ProcurementDemandRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly workloadId: string;
  readonly description: string;
  readonly quantity: number;
  readonly createdAt: string;
  readonly deadline: string;
  readonly deliveryArea: string;
  /** The budget cap in USD, verbatim. */
  readonly budgetUsd: number;
  /** The typed floors, verbatim. */
  readonly slaFloor: number;
  readonly warrantyFloorDays: number;
  readonly qualityFloor: number;
  readonly availabilityFloor: number;
  /** The allowed substitution capability ids (sorted). */
  readonly allowedSubstitutions: readonly string[];
  /** The W022 rejection-evidence candidates carried into matching. */
  readonly rejectionEvidence: readonly { candidateId: string; reason: string }[];
  /** The deadline-pressure bucket (injected `now`). */
  readonly deadlinePressure: DeadlinePressureBucket;
  /** Whole days until the deadline (negative = overdue). */
  readonly daysUntilDeadline: number;
}

/** The demand list view. */
export interface ProcurementDemandListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by demandId (deterministic). */
  readonly rows: readonly ProcurementDemandRowView[];
  readonly total: number;
  /** Count by pressure bucket, all five keys always present. */
  readonly byPressure: Readonly<Record<DeadlinePressureBucket, number>>;
}

/** The tagged result of a demand-list build. */
export type DemandListResult =
  | { readonly ok: true; readonly view: ProcurementDemandListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the tenant-scoped demand list view with deadline-pressure
 * columns. PURE and DETERMINISTIC given the injected `now`. A demand
 * with an unparseable deadline REFUSES the build (fail-closed — the
 * domain validated deadlines at creation; a malformed one is a
 * tampering signal, never a guess).
 *
 * @param tenantId the acting tenant
 * @param demands the W032 demand records, injected at the binding site
 * @param now the injected display instant (ISO 8601 — no clock reads)
 * @returns the tagged list result
 */
export function buildProcurementDemandListView(
  tenantId: TenantId,
  demands: readonly ProcurementDemandFacets[],
  now: string,
): DemandListResult {
  if (!Array.isArray(demands)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "demand list request is invalid",
        tenantId,
        [{ path: "/demands", reason: "array_required" }],
      ),
    };
  }
  if (typeof now !== "string" || !looksLikeIso(now)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "demand list request is invalid",
        tenantId,
        [{ path: "/now", reason: "not_iso" }],
      ),
    };
  }
  for (const demand of demands) {
    const mismatch = tenantMismatch(tenantId, demand?.tenantId, "web-commerce.procurement");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const nowMs = parseIsoMs(now);

  const rows: ProcurementDemandRowView[] = [];
  for (const demand of demands) {
    const days = daysUntil(nowMs, demand.deadline);
    if (days === null) {
      return {
        ok: false,
        error: makeSurfaceValidationError(
          "web-commerce.procurement",
          "demand deadline is unparseable",
          tenantId,
          [{ path: `/demands/${demand.demandId}/deadline`, reason: "not_iso" }],
        ),
      };
    }
    rows.push(
      frozen({
        viewVersion: PROCUREMENT_VIEW_VERSION,
        tenantId,
        demandId: demand.demandId,
        workloadId: demand.workloadId,
        description: demand.description,
        quantity: demand.quantity,
        createdAt: demand.createdAt,
        deadline: demand.deadline,
        deliveryArea: demand.deliveryArea,
        budgetUsd: demand.budget.usd,
        slaFloor: demand.slaFloor.coverage,
        warrantyFloorDays: demand.warrantyFloor.days,
        qualityFloor: demand.qualityFloor.score,
        availabilityFloor: demand.availabilityFloor.ratio,
        allowedSubstitutions: frozenArray([...demand.allowedSubstitutions].sort(compareStrings)),
        rejectionEvidence: frozenArray(
          [...demand.rejectionEvidence].sort((a, b) => compareStrings(a.candidateId, b.candidateId)),
        ),
        deadlinePressure: deriveDeadlinePressure(days),
        daysUntilDeadline: days,
      }),
    );
  }
  rows.sort((a, b) => compareStrings(a.demandId, b.demandId));

  const byPressure: Record<DeadlinePressureBucket, number> = {
    overdue: 0,
    critical: 0,
    urgent: 0,
    soon: 0,
    comfortable: 0,
  };
  for (const row of rows) byPressure[row.deadlinePressure] += 1;

  return {
    ok: true,
    view: frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      byPressure: frozen({ ...byPressure }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The vendor-matching display (hard gates + headroom ranks)
// ---------------------------------------------------------------------------

/** One typed headroom evidence column (vendor over the demand floor). */
export interface HeadroomView {
  /** The headroom dimension (machine-stable). */
  readonly dimension: "sla_coverage" | "warranty_days" | "quality_score" | "availability_ratio";
  /** The demand floor, verbatim. */
  readonly floor: number;
  /** The vendor's typed value, verbatim. */
  readonly vendorValue: number;
  /** headroom = vendorValue - floor (sign-preserved, pure arithmetic). */
  readonly headroom: number;
}

/** One vendor-match display row. */
export interface VendorMatchRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  /** The engine's rank position (1-based, rankScore desc, vendorId asc). */
  readonly rankPosition: number;
  /** The engine's rank score, verbatim. */
  readonly rankScore: number;
  /** The engine's satisfiable verdict, verbatim. */
  readonly satisfiable: boolean;
  /** The matched capability id, when one was matched. */
  readonly matchedCapabilityId: string | null;
  /** The engine's machine-stable reasons (failures when unsatisfiable). */
  readonly reasons: readonly { readonly kind: string; readonly detail: string }[];
  /** The typed headroom ranks (machine-stable display columns). */
  readonly headrooms: readonly HeadroomView[];
}

/** The matching display view. */
export interface VendorMatchingView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly demandId: string;
  /** Satisfiable matches in the ENGINE's rank order (rankScore desc, vendorId asc). */
  readonly ranked: readonly VendorMatchRowView[];
  /** Rejected vendors, vendorId order (the hard-gate failures). */
  readonly rejected: readonly VendorMatchRowView[];
  readonly engineVersion: string | null;
}

/** The tagged result of a matching-display build. */
export type VendorMatchingResult =
  | { readonly ok: true; readonly view: VendorMatchingView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the vendor-matching display for ONE demand: the ENGINE's ranked
 * satisfiable matches (rank preserved verbatim — the surface never
 * re-ranks) plus the rejected vendors with their machine-stable
 * hard-gate failure reasons, and the typed HEADROOM ranks per vendor.
 *
 * The rank order of the injected matches is preserved EXACTLY as the
 * engine produced it (the engine documents rankScore desc, vendorId
 * asc); the surface assigns 1-based rank positions and derives the
 * headroom evidence columns.
 *
 * @param tenantId the acting tenant
 * @param demand the W032 demand record
 * @param matches the W032 `VendorMatch` records (the engine's output)
 * @param engineVersion the engine version string, when known
 * @returns the tagged matching-display result
 */
export function buildVendorMatchingView(
  tenantId: TenantId,
  demand: ProcurementDemandFacets,
  matches: readonly VendorMatchFacets[],
  engineVersion: string | null,
): VendorMatchingResult {
  if (demand === null || typeof demand !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "matching display request is invalid",
        tenantId,
        [{ path: "/demand", reason: "demand_required" }],
      ),
    };
  }
  const demandMismatch = tenantMismatch(tenantId, demand.tenantId, "web-commerce.procurement");
  if (demandMismatch !== null) return { ok: false, error: demandMismatch };
  if (!Array.isArray(matches)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "matching display request is invalid",
        tenantId,
        [{ path: "/matches", reason: "array_required" }],
      ),
    };
  }
  for (const match of matches) {
    const mismatch = tenantMismatch(tenantId, match?.vendor?.tenantId, "web-commerce.procurement");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const satisfiable = matches.filter((match) => match.satisfiable);
  const rejected = [...matches.filter((match) => !match.satisfiable)].sort((a, b) =>
    compareStrings(a.vendor.vendorId, b.vendor.vendorId),
  );

  const toRow = (match: VendorMatchFacets, rankPosition: number): VendorMatchRowView =>
    frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      demandId: demand.demandId,
      vendorId: match.vendor.vendorId,
      vendorName: match.vendor.name,
      rankPosition,
      rankScore: match.rankScore,
      satisfiable: match.satisfiable,
      matchedCapabilityId: match.matchedCapability?.id ?? null,
      reasons: frozenArray(match.reasons),
      headrooms: frozenArray([
        frozen({
          dimension: "sla_coverage" as const,
          floor: demand.slaFloor.coverage,
          vendorValue: match.vendor.terms.sla.coverage,
          headroom: match.vendor.terms.sla.coverage - demand.slaFloor.coverage,
        }),
        frozen({
          dimension: "warranty_days" as const,
          floor: demand.warrantyFloor.days,
          vendorValue: match.vendor.terms.warranty.days,
          headroom: match.vendor.terms.warranty.days - demand.warrantyFloor.days,
        }),
        frozen({
          dimension: "quality_score" as const,
          floor: demand.qualityFloor.score,
          vendorValue: match.vendor.terms.quality.score,
          headroom: match.vendor.terms.quality.score - demand.qualityFloor.score,
        }),
        frozen({
          dimension: "availability_ratio" as const,
          floor: demand.availabilityFloor.ratio,
          vendorValue: match.matchedInventory?.availability.ratio ?? 0,
          headroom: (match.matchedInventory?.availability.ratio ?? 0) - demand.availabilityFloor.ratio,
        }),
      ]),
    });

  const rankedRows = satisfiable.map((match, index) => toRow(match, index + 1));
  const rejectedRows = rejected.map((match) => toRow(match, 0));

  return {
    ok: true,
    view: frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      demandId: demand.demandId,
      ranked: frozenArray(rankedRows),
      rejected: frozenArray(rejectedRows),
      engineVersion,
    }),
  };
}

// ---------------------------------------------------------------------------
// The quote + acceptance display (versioned, read-only)
// ---------------------------------------------------------------------------

/** One quote display row (versioned, read-only). */
export interface QuoteRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly quoteId: string;
  readonly demandId: string;
  readonly vendorId: string;
  readonly matchedCapabilityId: string | null;
  readonly quoteVersion: number;
  readonly supersedes: string | null;
  readonly unitPriceUsd: number;
  readonly totalPriceUsd: number;
  readonly leadTimeDays: number;
  readonly warrantyDays: number;
  readonly slaCoverage: number;
  /** The quote lifecycle status, verbatim (machine-stable). */
  readonly status: string;
  readonly issuedAt: string;
  /** True when the ledger records an acceptance entry for this quote. */
  readonly accepted: boolean;
  /** The acceptance instant from the ledger's acceptance entry, if any. */
  readonly acceptedAt: string | null;
}

/** The quote-ledger display view. */
export interface QuoteLedgerDisplayView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** All quote records, ordered by demandId then vendorId then version. */
  readonly rows: readonly QuoteRowView[];
  /** The recorded acceptance entries (acceptedAt then quoteId order). */
  readonly acceptances: readonly { readonly quoteId: string; readonly acceptedAt: string }[];
  /** The recorded supersession entries (supersededAt then quoteId order). */
  readonly supersessions: readonly {
    readonly quoteId: string;
    readonly supersededBy: string;
    readonly supersededAt: string;
  }[];
}

/** The tagged result of a quote-ledger display build. */
export type QuoteLedgerDisplayResult =
  | { readonly ok: true; readonly view: QuoteLedgerDisplayView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the READ-ONLY quote-ledger display: every versioned quote record
 * (with its lifecycle status and acceptance instant), every acceptance
 * entry, every supersession entry. PURE and DETERMINISTIC (rows sort by
 * demandId, vendorId, quoteVersion).
 *
 * @param tenantId the acting tenant
 * @param ledger the W032 quote ledger, injected at the binding site
 * @returns the tagged display result
 */
export function buildQuoteLedgerDisplay(
  tenantId: TenantId,
  ledger: QuoteLedgerFacets,
): QuoteLedgerDisplayResult {
  if (ledger === null || typeof ledger !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "quote ledger display request is invalid",
        tenantId,
        [{ path: "/ledger", reason: "ledger_required" }],
      ),
    };
  }
  const ledgerMismatch = tenantMismatch(tenantId, ledger.tenantId, "web-commerce.procurement");
  if (ledgerMismatch !== null) return { ok: false, error: ledgerMismatch };

  const quoteEntries = ledger.entries.filter(
    (entry): entry is Extract<QuoteLedgerFacets["entries"][number], { kind: "quote" }> =>
      entry.kind === "quote",
  );
  for (const entry of quoteEntries) {
    const mismatch = tenantMismatch(tenantId, entry.quote.tenantId, "web-commerce.procurement");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  // The acceptance entries first (the machine-stable record of the
  // PROPOSAL-GATED acceptance transitions; the quote record's own status
  // stays verbatim — the acceptance is a separate ledger entry).
  const acceptanceByQuote = new Map<string, { quoteId: string; acceptedAt: string }>();
  for (const entry of ledger.entries) {
    if (entry.kind === "acceptance") {
      acceptanceByQuote.set(entry.acceptance.quoteId, {
        quoteId: entry.acceptance.quoteId,
        acceptedAt: entry.acceptance.acceptedAt,
      });
    }
  }

  const rows: QuoteRowView[] = quoteEntries.map((entry) => {
    const acceptance = acceptanceByQuote.get(entry.quote.quoteId);
    return frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      quoteId: entry.quote.quoteId,
      demandId: entry.quote.demandId,
      vendorId: entry.quote.vendorId,
      matchedCapabilityId: entry.quote.matchedCapabilityId,
      quoteVersion: entry.quote.quoteVersion,
      supersedes: entry.quote.supersedes ?? null,
      unitPriceUsd: entry.quote.unitPriceUsd,
      totalPriceUsd: entry.quote.totalPriceUsd,
      leadTimeDays: entry.quote.leadTimeDays,
      warrantyDays: entry.quote.warrantyDays,
      slaCoverage: entry.quote.slaCoverage,
      status: entry.quote.status,
      issuedAt: entry.quote.issuedAt,
      accepted: acceptance !== undefined,
      acceptedAt: acceptance?.acceptedAt ?? null,
    });
  });
  rows.sort((a, b) => {
    const byDemand = compareStrings(a.demandId, b.demandId);
    if (byDemand !== 0) return byDemand;
    const byVendor = compareStrings(a.vendorId, b.vendorId);
    if (byVendor !== 0) return byVendor;
    return a.quoteVersion - b.quoteVersion;
  });

  const acceptances = ledger.entries
    .filter(
      (entry): entry is Extract<QuoteLedgerFacets["entries"][number], { kind: "acceptance" }> =>
        entry.kind === "acceptance",
    )
    .map((entry) => entry.acceptance)
    .sort((a, b) => {
      const byAt = compareStrings(a.acceptedAt, b.acceptedAt);
      if (byAt !== 0) return byAt;
      return compareStrings(a.quoteId, b.quoteId);
    })
    .map((acceptance) => frozen({ quoteId: acceptance.quoteId, acceptedAt: acceptance.acceptedAt }));

  const supersessions = ledger.entries
    .filter(
      (entry): entry is Extract<QuoteLedgerFacets["entries"][number], { kind: "supersession" }> =>
        entry.kind === "supersession",
    )
    .map((entry) => entry.supersession)
    .sort((a, b) => {
      const byAt = compareStrings(a.supersededAt, b.supersededAt);
      if (byAt !== 0) return byAt;
      return compareStrings(a.quoteId, b.quoteId);
    })
    .map((supersession) =>
      frozen({
        quoteId: supersession.quoteId,
        supersededBy: supersession.supersededBy,
        supersededAt: supersession.supersededAt,
      }),
    );

  return {
    ok: true,
    view: frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      acceptances: frozenArray(acceptances),
      supersessions: frozenArray(supersessions),
    }),
  };
}

// ---------------------------------------------------------------------------
// The quote-evaluation display (acceptance decision support)
// ---------------------------------------------------------------------------

/** The quote-vs-demand evaluation row (budget + lead-time + terms headrooms). */
export interface QuoteEvaluationView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly quoteId: string;
  readonly vendorId: string;
  readonly quoteVersion: number;
  /** budget headroom = demand.budget.usd - quote.totalPriceUsd (negative = over budget). */
  readonly budgetHeadroomUsd: number;
  /** True when the quoted total is within the demand budget. */
  readonly withinBudget: boolean;
  /** The warranty headroom in days (quote over the demand floor). */
  readonly warrantyHeadroomDays: number;
  /** The SLA headroom (quote over the demand floor). */
  readonly slaHeadroom: number;
  /** Whole days from the quote's issuance to the demand deadline. */
  readonly leadTimeHeadroomDays: number;
  /** True when the quoted lead time fits the deadline window. */
  readonly leadTimeFeasible: boolean;
  /** The quote's lifecycle status, verbatim. */
  readonly status: string;
}

/** The tagged result of a quote evaluation. */
export type QuoteEvaluationResult =
  | { readonly ok: true; readonly view: QuoteEvaluationView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Evaluate ONE quote against its demand for the acceptance decision
 * display: the budget headroom (demand budget minus quoted total), the
 * warranty/SLA headrooms over the demand floors, and the lead-time
 * feasibility against the deadline window (whole days from the quote's
 * issuance instant to the demand deadline, minus the quoted lead time).
 * READ-ONLY decision support — the surface never accepts a quote.
 *
 * @param tenantId the acting tenant
 * @param demand the W032 demand the quote fulfills
 * @param quote the W032 quote under evaluation
 * @returns the tagged evaluation result
 */
export function buildQuoteEvaluationView(
  tenantId: TenantId,
  demand: ProcurementDemandFacets,
  quote: QuoteFacets,
): QuoteEvaluationResult {
  if (demand === null || typeof demand !== "object" || quote === null || typeof quote !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "quote evaluation request is invalid",
        tenantId,
        [{ path: "/demand", reason: "demand_required" }],
      ),
    };
  }
  const demandMismatch = tenantMismatch(tenantId, demand.tenantId, "web-commerce.procurement");
  if (demandMismatch !== null) return { ok: false, error: demandMismatch };
  const quoteMismatch = tenantMismatch(tenantId, quote.tenantId, "web-commerce.procurement");
  if (quoteMismatch !== null) return { ok: false, error: quoteMismatch };
  if (quote.demandId !== demand.demandId) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "quote evaluation request is invalid",
        tenantId,
        [{ path: "/quote/demandId", reason: "demand_mismatch" }],
      ),
    };
  }

  const deadlineDays = daysUntil(parseIsoMs(quote.issuedAt), demand.deadline);
  const leadTimeHeadroomDays = deadlineDays === null ? Number.NaN : deadlineDays - quote.leadTimeDays;

  return {
    ok: true,
    view: frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      demandId: demand.demandId,
      quoteId: quote.quoteId,
      vendorId: quote.vendorId,
      quoteVersion: quote.quoteVersion,
      budgetHeadroomUsd: demand.budget.usd - quote.totalPriceUsd,
      withinBudget: quote.totalPriceUsd <= demand.budget.usd,
      warrantyHeadroomDays: quote.warrantyDays - demand.warrantyFloor.days,
      slaHeadroom: quote.slaCoverage - demand.slaFloor.coverage,
      leadTimeHeadroomDays,
      leadTimeFeasible: Number.isFinite(leadTimeHeadroomDays) && leadTimeHeadroomDays >= 0,
      status: quote.status,
    }),
  };
}

// ---------------------------------------------------------------------------
// The LOCK 14 deadline-aggregation display
// ---------------------------------------------------------------------------

/**
 * One aggregated-order display row: the compatible group AND its member
 * contracts — per-contract identity preserved (LOCK 14). Every member
 * demand id is listed individually with its own accepted quote id and
 * price; the aggregation NEVER erases the member identities.
 */
export interface AggregatedOrderRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly aggregationId: string;
  readonly vendorId: string;
  readonly deliveryArea: string;
  readonly deadline: string;
  /** The member contracts — PER-CONTRACT IDENTITY PRESERVED (LOCK 14). */
  readonly members: readonly {
    readonly demandId: string;
    readonly quoteId: string | null;
    readonly totalPriceUsd: number | null;
  }[];
  readonly memberCount: number;
  readonly totalQuantity: number;
  readonly totalAggregatedPriceUsd: number;
  readonly formedAt: string;
  /** The deadline-pressure bucket of the shared deadline (injected `now`). */
  readonly deadlinePressure: DeadlinePressureBucket;
}

/** The aggregation display view. */
export interface AggregationDisplayView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by aggregationId (deterministic). */
  readonly rows: readonly AggregatedOrderRowView[];
  readonly total: number;
}

/** The tagged result of an aggregation-display build. */
export type AggregationDisplayResult =
  | { readonly ok: true; readonly view: AggregationDisplayView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the LOCK 14 deadline-aggregation display: one row per aggregated
 * order, with EVERY member contract individually identified (demand id +
 * accepted quote id + price — the per-contract identity the aggregation
 * preserved). PURE and DETERMINISTIC; `now` is injected for the
 * deadline-pressure column.
 *
 * @param tenantId the acting tenant
 * @param aggregations the W032 `AggregatedOrder` records
 * @param quotesByDemand the accepted quotes keyed by demandId (the
 *        per-member contract identity), injected at the binding site
 * @param now the injected display instant (ISO 8601)
 * @returns the tagged aggregation-display result
 */
export function buildAggregationDisplayView(
  tenantId: TenantId,
  aggregations: readonly AggregatedOrderFacets[],
  quotesByDemand: ReadonlyMap<string, QuoteFacets>,
  now: string,
): AggregationDisplayResult {
  if (!Array.isArray(aggregations)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "aggregation display request is invalid",
        tenantId,
        [{ path: "/aggregations", reason: "array_required" }],
      ),
    };
  }
  if (typeof now !== "string" || !looksLikeIso(now)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.procurement",
        "aggregation display request is invalid",
        tenantId,
        [{ path: "/now", reason: "not_iso" }],
      ),
    };
  }
  for (const aggregation of aggregations) {
    const mismatch = tenantMismatch(tenantId, aggregation?.tenantId, "web-commerce.procurement");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  for (const [demandId, quote] of quotesByDemand) {
    const mismatch = tenantMismatch(tenantId, quote?.tenantId, "web-commerce.procurement");
    if (mismatch !== null) return { ok: false, error: mismatch };
    void demandId;
  }
  const nowMs = parseIsoMs(now);

  const rows: AggregatedOrderRowView[] = [];
  for (const aggregation of aggregations) {
    const days = daysUntil(nowMs, aggregation.deadline);
    if (days === null) {
      return {
        ok: false,
        error: makeSurfaceValidationError(
          "web-commerce.procurement",
          "aggregation deadline is unparseable",
          tenantId,
          [{ path: `/aggregations/${aggregation.aggregationId}/deadline`, reason: "not_iso" }],
        ),
      };
    }
    const members = aggregation.memberDemandIds.map((demandId: string) => {
      const quote = quotesByDemand.get(demandId);
      return frozen({
        demandId,
        quoteId: quote?.quoteId ?? null,
        totalPriceUsd: quote?.totalPriceUsd ?? null,
      });
    });
    rows.push(
      frozen({
        viewVersion: PROCUREMENT_VIEW_VERSION,
        tenantId,
        aggregationId: aggregation.aggregationId,
        vendorId: aggregation.vendorId,
        deliveryArea: aggregation.deliveryArea,
        deadline: aggregation.deadline,
        members: frozenArray(members),
        memberCount: aggregation.memberDemandIds.length,
        totalQuantity: aggregation.totalQuantity,
        totalAggregatedPriceUsd: aggregation.totalAggregatedPriceUsd,
        formedAt: aggregation.formedAt,
        deadlinePressure: deriveDeadlinePressure(days),
      }),
    );
  }
  rows.sort((a, b) => compareStrings(a.aggregationId, b.aggregationId));

  return {
    ok: true,
    view: frozen({
      viewVersion: PROCUREMENT_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
    }),
  };
}
