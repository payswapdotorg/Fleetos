/**
 * @fleetos/web-commerce — the MAINTENANCE surface (W042).
 *
 * "FleetOS owns maintenance plans; local vendors own fulfillment." —
 * `spec/ARCHITECTURE.md` § Procurement/service exchange.
 *
 * This module projects W042 service work orders (derived from W021
 * health diagnoses) and the maintenance exchange (service vendor
 * matching) into read-only display view-models:
 *
 *   - the work-order view: the diagnosis-evidence refs (hypothesis,
 *     treatment recommendation, cause, observation ids — machine-stable),
 *     the service area, the deadline, the floors;
 *   - the WARRANTY-AWARE ELIGIBILITY display: the work order's warranty
 *     rules against a vendor's typed terms (the machine-stable standing
 *     vocabulary: `in_warranty_headroom` / `out_of_warranty_shortfall` /
 *     `warranty_floor_unmet`, with the warranty headroom in days);
 *   - the maintenance-exchange display: the service vendor matches
 *     (hard gates + headroom ranks, machine-stable);
 *   - the DEADLINE-PRESSURE views: bucketed days-until-deadline from the
 *     injected `now`, and the aggregated service orders (LOCK 14: member
 *     work-order identities preserved).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads; `now` is injected.
 */

import type { TenantId } from "@fleetos/contracts";
import type {
  AggregatedServiceOrderFacets,
  ServiceVendorMatchFacets,
  ServiceWorkOrderFacets,
  VendorFacets,
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
import { deriveDeadlinePressure, type DeadlinePressureBucket } from "./procurement";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The maintenance view-model schema version. */
export const MAINTENANCE_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The service work-order view (from health diagnoses)
// ---------------------------------------------------------------------------

/** The diagnosis-evidence display (W021 refs, machine-stable). */
export interface DiagnosisEvidenceView {
  readonly hypothesisId: string;
  readonly recommendationId: string;
  readonly causeId: string;
  /** The hypothesis confidence, verbatim. */
  readonly confidence: number;
  /** The observation ids behind the anomalies (order preserved). */
  readonly observationIds: readonly string[];
}

/** One service work-order display row. */
export interface ServiceWorkOrderRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workOrderId: string;
  readonly deviceId: string;
  readonly revision: number;
  readonly supersedes: string | null;
  readonly diagnosis: DiagnosisEvidenceView;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly serviceCategory: string;
  readonly slaFloor: number;
  readonly warrantyFloorDays: number;
  readonly requireInWarranty: boolean;
  readonly qualityFloor: number;
  readonly availabilityFloor: number;
  readonly allowedSubstitutions: readonly string[];
  readonly createdAt: string;
  readonly contentDigest: string;
  /** The deadline-pressure bucket (injected `now`). */
  readonly deadlinePressure: DeadlinePressureBucket;
  /** Whole days until the deadline (negative = overdue). */
  readonly daysUntilDeadline: number;
}

/** The work-order list view. */
export interface ServiceWorkOrderListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by workOrderId (deterministic). */
  readonly rows: readonly ServiceWorkOrderRowView[];
  readonly total: number;
  /** Count by pressure bucket, all five keys always present. */
  readonly byPressure: Readonly<Record<DeadlinePressureBucket, number>>;
}

/** The tagged result of a work-order list build. */
export type ServiceWorkOrderListResult =
  | { readonly ok: true; readonly view: ServiceWorkOrderListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the tenant-scoped service work-order list view (the W042 work
 * orders derived from W021 health diagnoses) with deadline-pressure
 * columns. PURE and DETERMINISTIC given the injected `now`; an
 * unparseable deadline REFUSES the build (fail-closed).
 *
 * @param tenantId the acting tenant
 * @param workOrders the W042 `ServiceWorkOrder` records
 * @param now the injected display instant (ISO 8601)
 * @returns the tagged list result
 */
export function buildServiceWorkOrderListView(
  tenantId: TenantId,
  workOrders: readonly ServiceWorkOrderFacets[],
  now: string,
): ServiceWorkOrderListResult {
  if (!Array.isArray(workOrders)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "work order list request is invalid",
        tenantId,
        [{ path: "/workOrders", reason: "array_required" }],
      ),
    };
  }
  if (typeof now !== "string" || !looksLikeIso(now)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "work order list request is invalid",
        tenantId,
        [{ path: "/now", reason: "not_iso" }],
      ),
    };
  }
  for (const workOrder of workOrders) {
    const mismatch = tenantMismatch(tenantId, workOrder?.tenantId, "web-commerce.maintenance");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const nowMs = parseIsoMs(now);

  const rows: ServiceWorkOrderRowView[] = [];
  for (const workOrder of workOrders) {
    const days = daysUntil(nowMs, workOrder.deadline);
    if (days === null) {
      return {
        ok: false,
        error: makeSurfaceValidationError(
          "web-commerce.maintenance",
          "work order deadline is unparseable",
          tenantId,
          [{ path: `/workOrders/${workOrder.workOrderId}/deadline`, reason: "not_iso" }],
        ),
      };
    }
    rows.push(
      frozen({
        viewVersion: MAINTENANCE_VIEW_VERSION,
        tenantId,
        workOrderId: workOrder.workOrderId,
        deviceId: workOrder.deviceId,
        revision: workOrder.revision,
        supersedes: workOrder.supersedes ?? null,
        diagnosis: frozen({
          hypothesisId: workOrder.diagnosis.hypothesisId,
          recommendationId: workOrder.diagnosis.recommendationId,
          causeId: workOrder.diagnosis.causeId,
          confidence: workOrder.diagnosis.confidence,
          observationIds: frozenArray([...workOrder.diagnosis.observationIds]),
        }),
        serviceArea: workOrder.serviceArea,
        deadline: workOrder.deadline,
        serviceCategory: workOrder.serviceCategory,
        slaFloor: workOrder.slaFloor.coverage,
        warrantyFloorDays: workOrder.warrantyRules.warrantyFloor.days,
        requireInWarranty: workOrder.warrantyRules.requireInWarranty,
        qualityFloor: workOrder.qualityFloor.score,
        availabilityFloor: workOrder.availabilityFloor.ratio,
        allowedSubstitutions: frozenArray([...workOrder.allowedSubstitutions].sort(compareStrings)),
        createdAt: workOrder.createdAt,
        contentDigest: workOrder.contentDigest,
        deadlinePressure: deriveDeadlinePressure(days),
        daysUntilDeadline: days,
      }),
    );
  }
  rows.sort((a, b) => compareStrings(a.workOrderId, b.workOrderId));

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
      viewVersion: MAINTENANCE_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      byPressure: frozen({ ...byPressure }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The warranty-aware eligibility display (with the vendor terms)
// ---------------------------------------------------------------------------

/**
 * The warranty-eligibility standing display (the W042 vocabulary,
 * machine-stable):
 *   - `in_warranty_headroom` — the vendor warranty covers the floor with
 *     headroom >= 0;
 *   - `out_of_warranty_shortfall` — reserved for a later configurable
 *     threshold (forward compatibility; currently unreachable);
 *   - `warranty_floor_unmet` — the vendor warranty is below the floor.
 */
export type WarrantyStandingView =
  | "in_warranty_headroom"
  | "out_of_warranty_shortfall"
  | "warranty_floor_unmet";

/** The warranty-eligibility display row (work order x vendor terms). */
export interface WarrantyEligibilityRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workOrderId: string;
  readonly vendorId: string;
  /** The work order's warranty floor in days, verbatim. */
  readonly warrantyFloorDays: number;
  /** True when the work order requires in-warranty fulfillment. */
  readonly requireInWarranty: boolean;
  /** The vendor's standard warranty days, verbatim. */
  readonly vendorWarrantyDays: number;
  /** headroom = vendorWarrantyDays - warrantyFloorDays (sign-preserved). */
  readonly warrantyHeadroomDays: number;
  /** The machine-stable standing. */
  readonly standing: WarrantyStandingView;
}

/** The tagged result of a warranty-eligibility build. */
export type WarrantyEligibilityResult =
  | { readonly ok: true; readonly view: WarrantyEligibilityRowView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Derive the warranty-eligibility standing (PURE, mirrors the W042
 * classifier's semantics over the seam facets): the vendor's warranty
 * days against the work order's warranty floor.
 */
export function deriveWarrantyStanding(
  vendorWarrantyDays: number,
  warrantyFloorDays: number,
): WarrantyStandingView {
  if (vendorWarrantyDays < warrantyFloorDays) return "warranty_floor_unmet";
  return "in_warranty_headroom";
}

/**
 * Build the WARRANTY-AWARE eligibility display for one work order
 * against one vendor's typed terms: the standing (machine-stable), the
 * warranty headroom in days, and the vendor's standard warranty window
 * displayed WITH the work order's rules (LOCK 12's maintenance arm).
 *
 * @param tenantId the acting tenant
 * @param workOrder the W042 service work order
 * @param vendor the W032 vendor whose terms are evaluated
 * @returns the tagged eligibility result
 */
export function buildWarrantyEligibilityView(
  tenantId: TenantId,
  workOrder: ServiceWorkOrderFacets,
  vendor: VendorFacets,
): WarrantyEligibilityResult {
  if (workOrder === null || typeof workOrder !== "object" || vendor === null || typeof vendor !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "warranty eligibility request is invalid",
        tenantId,
        [{ path: "/workOrder", reason: "work_order_required" }],
      ),
    };
  }
  const orderMismatch = tenantMismatch(tenantId, workOrder.tenantId, "web-commerce.maintenance");
  if (orderMismatch !== null) return { ok: false, error: orderMismatch };
  const vendorMismatch = tenantMismatch(tenantId, vendor.tenantId, "web-commerce.maintenance");
  if (vendorMismatch !== null) return { ok: false, error: vendorMismatch };

  const vendorWarrantyDays = vendor.terms.warranty.days;
  const warrantyFloorDays = workOrder.warrantyRules.warrantyFloor.days;
  return {
    ok: true,
    view: frozen({
      viewVersion: MAINTENANCE_VIEW_VERSION,
      tenantId,
      workOrderId: workOrder.workOrderId,
      vendorId: vendor.vendorId,
      warrantyFloorDays,
      requireInWarranty: workOrder.warrantyRules.requireInWarranty,
      vendorWarrantyDays,
      warrantyHeadroomDays: vendorWarrantyDays - warrantyFloorDays,
      standing: deriveWarrantyStanding(vendorWarrantyDays, warrantyFloorDays),
    }),
  };
}

// ---------------------------------------------------------------------------
// The maintenance-exchange display (service vendor matching)
// ---------------------------------------------------------------------------

/** One service vendor-match display row (hard gates + headroom ranks). */
export interface ServiceMatchRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workOrderId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  /** The engine's rank position (1-based, in the engine's order). */
  readonly rankPosition: number;
  /** The engine's rank score, verbatim. */
  readonly rankScore: number;
  /** The engine's satisfiable verdict, verbatim. */
  readonly satisfiable: boolean;
  readonly matchedCapabilityId: string | null;
  /** The engine's machine-stable reasons. */
  readonly reasons: readonly { readonly kind: string; readonly detail: string }[];
  /** The typed headroom ranks (vendor terms over the work order floors). */
  readonly headrooms: readonly {
    readonly dimension: "sla_coverage" | "warranty_days" | "quality_score" | "availability_ratio";
    readonly floor: number;
    readonly vendorValue: number;
    readonly headroom: number;
  }[];
}

/** The maintenance-exchange display view. */
export interface ServiceMatchingView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly workOrderId: string;
  /** Satisfiable matches in the ENGINE's rank order. */
  readonly ranked: readonly ServiceMatchRowView[];
  /** Rejected vendors, vendorId order (the hard-gate failures). */
  readonly rejected: readonly ServiceMatchRowView[];
}

/** The tagged result of a service-matching display build. */
export type ServiceMatchingResult =
  | { readonly ok: true; readonly view: ServiceMatchingView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the maintenance-exchange display for ONE work order: the
 * ENGINE's ranked satisfiable service matches (rank preserved verbatim)
 * plus the rejected vendors with their machine-stable hard-gate failure
 * reasons, and the typed headroom ranks per vendor (SLA / warranty /
 * quality / availability over the work order's floors).
 *
 * @param tenantId the acting tenant
 * @param workOrder the W042 service work order
 * @param matches the W042 `ServiceVendorMatch` records (the engine's output)
 * @returns the tagged matching-display result
 */
export function buildServiceMatchingView(
  tenantId: TenantId,
  workOrder: ServiceWorkOrderFacets,
  matches: readonly ServiceVendorMatchFacets[],
): ServiceMatchingResult {
  if (workOrder === null || typeof workOrder !== "object") {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "service matching display request is invalid",
        tenantId,
        [{ path: "/workOrder", reason: "work_order_required" }],
      ),
    };
  }
  const orderMismatch = tenantMismatch(tenantId, workOrder.tenantId, "web-commerce.maintenance");
  if (orderMismatch !== null) return { ok: false, error: orderMismatch };
  if (!Array.isArray(matches)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "service matching display request is invalid",
        tenantId,
        [{ path: "/matches", reason: "array_required" }],
      ),
    };
  }
  for (const match of matches) {
    const mismatch = tenantMismatch(tenantId, match?.vendor?.tenantId, "web-commerce.maintenance");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const toRow = (match: ServiceVendorMatchFacets, rankPosition: number): ServiceMatchRowView =>
    frozen({
      viewVersion: MAINTENANCE_VIEW_VERSION,
      tenantId,
      workOrderId: workOrder.workOrderId,
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
          floor: workOrder.slaFloor.coverage,
          vendorValue: match.vendor.terms.sla.coverage,
          headroom: match.vendor.terms.sla.coverage - workOrder.slaFloor.coverage,
        }),
        frozen({
          dimension: "warranty_days" as const,
          floor: workOrder.warrantyRules.warrantyFloor.days,
          vendorValue: match.vendor.terms.warranty.days,
          headroom: match.vendor.terms.warranty.days - workOrder.warrantyRules.warrantyFloor.days,
        }),
        frozen({
          dimension: "quality_score" as const,
          floor: workOrder.qualityFloor.score,
          vendorValue: match.vendor.terms.quality.score,
          headroom: match.vendor.terms.quality.score - workOrder.qualityFloor.score,
        }),
        frozen({
          dimension: "availability_ratio" as const,
          floor: workOrder.availabilityFloor.ratio,
          vendorValue: match.matchedInventory?.availability.ratio ?? 0,
          headroom: (match.matchedInventory?.availability.ratio ?? 0) - workOrder.availabilityFloor.ratio,
        }),
      ]),
    });

  const rankedRows = matches
    .filter((match) => match.satisfiable)
    .map((match, index) => toRow(match, index + 1));
  const rejectedRows = [...matches.filter((match) => !match.satisfiable)]
    .sort((a, b) => compareStrings(a.vendor.vendorId, b.vendor.vendorId))
    .map((match) => toRow(match, 0));

  return {
    ok: true,
    view: frozen({
      viewVersion: MAINTENANCE_VIEW_VERSION,
      tenantId,
      workOrderId: workOrder.workOrderId,
      ranked: frozenArray(rankedRows),
      rejected: frozenArray(rejectedRows),
    }),
  };
}

// ---------------------------------------------------------------------------
// The aggregated service-order display (LOCK 14 — deadline pressure)
// ---------------------------------------------------------------------------

/** One aggregated service-order display row (member identities preserved). */
export interface AggregatedServiceOrderRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly aggregationId: string;
  readonly vendorId: string;
  readonly serviceArea: string;
  readonly deadline: string;
  /** The member work-order ids — PER-CONTRACT IDENTITY PRESERVED (LOCK 14). */
  readonly memberWorkOrderIds: readonly string[];
  readonly memberCount: number;
  /** The total warranty headroom across members, verbatim. */
  readonly totalWarrantyHeadroomDays: number;
  readonly formedAt: string;
  /** The deadline-pressure bucket of the shared deadline (injected `now`). */
  readonly deadlinePressure: DeadlinePressureBucket;
}

/** The aggregated service-order view. */
export interface AggregatedServiceOrderListView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by aggregationId (deterministic). */
  readonly rows: readonly AggregatedServiceOrderRowView[];
  readonly total: number;
}

/** The tagged result of an aggregated service-order list build. */
export type AggregatedServiceOrderListResult =
  | { readonly ok: true; readonly view: AggregatedServiceOrderListView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the aggregated service-order display (the maintenance arm of the
 * LOCK 14 deadline aggregation): one row per aggregated service order,
 * every member work order individually identified, with the shared
 * deadline's pressure bucket from the injected `now`.
 *
 * @param tenantId the acting tenant
 * @param aggregations the W042 `AggregatedServiceOrder` records
 * @param now the injected display instant (ISO 8601)
 * @returns the tagged list result
 */
export function buildAggregatedServiceOrderListView(
  tenantId: TenantId,
  aggregations: readonly AggregatedServiceOrderFacets[],
  now: string,
): AggregatedServiceOrderListResult {
  if (!Array.isArray(aggregations)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "aggregated service order list request is invalid",
        tenantId,
        [{ path: "/aggregations", reason: "array_required" }],
      ),
    };
  }
  if (typeof now !== "string" || !looksLikeIso(now)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.maintenance",
        "aggregated service order list request is invalid",
        tenantId,
        [{ path: "/now", reason: "not_iso" }],
      ),
    };
  }
  for (const aggregation of aggregations) {
    const mismatch = tenantMismatch(tenantId, aggregation?.tenantId, "web-commerce.maintenance");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }
  const nowMs = parseIsoMs(now);

  const rows: AggregatedServiceOrderRowView[] = [];
  for (const aggregation of aggregations) {
    const days = daysUntil(nowMs, aggregation.deadline);
    if (days === null) {
      return {
        ok: false,
        error: makeSurfaceValidationError(
          "web-commerce.maintenance",
          "aggregated service order deadline is unparseable",
          tenantId,
          [{ path: `/aggregations/${aggregation.aggregationId}/deadline`, reason: "not_iso" }],
        ),
      };
    }
    rows.push(
      frozen({
        viewVersion: MAINTENANCE_VIEW_VERSION,
        tenantId,
        aggregationId: aggregation.aggregationId,
        vendorId: aggregation.vendorId,
        serviceArea: aggregation.serviceArea,
        deadline: aggregation.deadline,
        memberWorkOrderIds: frozenArray([...aggregation.memberWorkOrderIds]),
        memberCount: aggregation.memberCount,
        totalWarrantyHeadroomDays: aggregation.totalWarrantyHeadroomDays,
        formedAt: aggregation.formedAt,
        deadlinePressure: deriveDeadlinePressure(days),
      }),
    );
  }
  rows.sort((a, b) => compareStrings(a.aggregationId, b.aggregationId));

  return {
    ok: true,
    view: frozen({
      viewVersion: MAINTENANCE_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
    }),
  };
}
