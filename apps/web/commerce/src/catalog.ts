/**
 * @fleetos/web-commerce — the vendor + software CATALOG surface.
 *
 * "FleetOS is the demand-side orchestrator. Local vendors own inventory,
 * pricing and fulfillment." — `spec/ARCHITECTURE.md` § Procurement/service
 * exchange. The catalog surfaces the tenant-approved vendor records
 * (typed terms: quality score, SLA coverage, warranty days — with their
 * inventory signals and regions) and the allocated software
 * subscriptions (typed terms: seat count + term — the subscription's
 * warranty window is its term).
 *
 * The catalog is READ-ONLY and machine-stable: rows order by resource id
 * (code-unit order); every numeric value is echoed verbatim from the
 * domain record (the surface never recomputes a domain value).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import type { SoftwareSubscriptionFacets, VendorCapabilityFacets, VendorFacets } from "./seams";
import { compareStrings, frozen, frozenArray, makeSurfaceValidationError, tenantMismatch } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The vendor-catalog view-model schema version. */
export const VENDOR_CATALOG_VIEW_VERSION = 1 as const;

/** The software-catalog view-model schema version. */
export const SOFTWARE_CATALOG_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The vendor catalog
// ---------------------------------------------------------------------------

/** One vendor catalog row (typed terms displayed machine-stably). */
export interface VendorCatalogRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly vendorId: string;
  readonly name: string;
  readonly revision: number;
  /** The vendor quality score in [0, 1], verbatim. */
  readonly qualityScore: number;
  /** The SLA coverage in [0, 1], verbatim. */
  readonly slaCoverage: number;
  /** The standard warranty window in days, verbatim. */
  readonly warrantyDays: number;
  /** The capability ids this vendor declares (kind-sorted). */
  readonly capabilities: readonly string[];
  /** The service regions (sorted). */
  readonly regions: readonly string[];
  /** Per-capability inventory signals (availability + lead time). */
  readonly inventory: readonly VendorInventorySignalView[];
  /** The revision's content hash (the immutability evidence). */
  readonly contentHash: string;
  readonly createdAt: string;
}

/** One inventory-signal display row. */
export interface VendorInventorySignalView {
  readonly capabilityId: string;
  readonly capabilityKind: string;
  /** The availability ratio in [0, 1], verbatim. */
  readonly availabilityRatio: number;
  /** The lead time in days, verbatim. */
  readonly leadTimeDays: number;
}

/** The vendor catalog view. */
export interface VendorCatalogView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by vendorId (deterministic). */
  readonly rows: readonly VendorCatalogRowView[];
  readonly total: number;
}

/** The tagged result of a vendor-catalog build. */
export type VendorCatalogResult =
  | { readonly ok: true; readonly view: VendorCatalogView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the tenant-scoped vendor catalog view. PURE and DETERMINISTIC:
 * rows order by vendorId; capabilities/regions sort by code-unit order;
 * inventory signals order by capability id. Cross-tenant vendor records
 * are REFUSED (`tenant_mismatch`).
 *
 * @param tenantId the acting tenant
 * @param vendors the vendor records (latest revisions), injected at the
 *        binding site
 * @returns the tagged catalog result
 */
export function buildVendorCatalogView(
  tenantId: TenantId,
  vendors: readonly VendorFacets[],
): VendorCatalogResult {
  if (!Array.isArray(vendors)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.catalog",
        "vendor catalog request is invalid",
        tenantId,
        [{ path: "/vendors", reason: "array_required" }],
      ),
    };
  }
  for (const vendor of vendors) {
    const mismatch = tenantMismatch(tenantId, vendor?.tenantId, "web-commerce.catalog");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const rows: VendorCatalogRowView[] = vendors.map((vendor) =>
    frozen({
      viewVersion: VENDOR_CATALOG_VIEW_VERSION,
      tenantId,
      vendorId: vendor.vendorId,
      name: vendor.name,
      revision: vendor.revision,
      qualityScore: vendor.terms.quality.score,
      slaCoverage: vendor.terms.sla.coverage,
      warrantyDays: vendor.terms.warranty.days,
      capabilities: frozenArray(
        [...vendor.capabilities.map((c: VendorCapabilityFacets) => `${c.kind}:${c.id}`)].sort(
          compareStrings,
        ),
      ),
      regions: frozenArray([...vendor.regions].sort(compareStrings)),
      inventory: frozenArray(
        [...vendor.inventory]
          .sort((a, b) => compareStrings(a.capability.id, b.capability.id))
          .map((signal) =>
            frozen({
              capabilityId: signal.capability.id,
              capabilityKind: signal.capability.kind,
              availabilityRatio: signal.availability.ratio,
              leadTimeDays: signal.leadTime.days,
            }),
          ),
      ),
      contentHash: vendor.contentHash,
      createdAt: vendor.createdAt,
    }),
  );
  rows.sort((a, b) => compareStrings(a.vendorId, b.vendorId));

  return {
    ok: true,
    view: frozen({
      viewVersion: VENDOR_CATALOG_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
    }),
  };
}

// ---------------------------------------------------------------------------
// The software catalog
// ---------------------------------------------------------------------------

/** One software catalog row (typed terms: seats + term window). */
export interface SoftwareCatalogRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly subscriptionId: string;
  readonly softwareId: string;
  /** The seat count, verbatim. */
  readonly seatCount: number;
  /** The subscription term in days (the warranty window), verbatim. */
  readonly termDays: number;
  /** The workload the subscription serves. */
  readonly workloadId: string;
  readonly revision: number;
  readonly allocatedAt: string;
  /** The revision's content hash (the immutability evidence). */
  readonly contentHash: string;
}

/** The software catalog view. */
export interface SoftwareCatalogView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** Rows ordered by subscriptionId (deterministic). */
  readonly rows: readonly SoftwareCatalogRowView[];
  readonly total: number;
  /** Total seats across all subscriptions (machine-stable sum). */
  readonly totalSeats: number;
}

/** The tagged result of a software-catalog build. */
export type SoftwareCatalogResult =
  | { readonly ok: true; readonly view: SoftwareCatalogView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * Build the tenant-scoped software catalog view (the allocated
 * subscriptions with their typed terms). PURE and DETERMINISTIC: rows
 * order by subscriptionId; cross-tenant records are REFUSED.
 *
 * @param tenantId the acting tenant
 * @param subscriptions the software subscription records, injected at
 *        the binding site
 * @returns the tagged catalog result
 */
export function buildSoftwareCatalogView(
  tenantId: TenantId,
  subscriptions: readonly SoftwareSubscriptionFacets[],
): SoftwareCatalogResult {
  if (!Array.isArray(subscriptions)) {
    return {
      ok: false,
      error: makeSurfaceValidationError(
        "web-commerce.catalog",
        "software catalog request is invalid",
        tenantId,
        [{ path: "/subscriptions", reason: "array_required" }],
      ),
    };
  }
  for (const subscription of subscriptions) {
    const mismatch = tenantMismatch(tenantId, subscription?.tenantId, "web-commerce.catalog");
    if (mismatch !== null) return { ok: false, error: mismatch };
  }

  const rows: SoftwareCatalogRowView[] = subscriptions.map((subscription) =>
    frozen({
      viewVersion: SOFTWARE_CATALOG_VIEW_VERSION,
      tenantId,
      subscriptionId: subscription.subscriptionId,
      softwareId: subscription.softwareId,
      seatCount: subscription.seatCount,
      termDays: subscription.termDays,
      workloadId: subscription.workloadId,
      revision: subscription.revision,
      allocatedAt: subscription.allocatedAt,
      contentHash: subscription.contentHash,
    }),
  );
  rows.sort((a, b) => compareStrings(a.subscriptionId, b.subscriptionId));

  const totalSeats = rows.reduce((sum, row) => sum + row.seatCount, 0);

  return {
    ok: true,
    view: frozen({
      viewVersion: SOFTWARE_CATALOG_VIEW_VERSION,
      tenantId,
      rows: frozenArray(rows),
      total: rows.length,
      totalSeats,
    }),
  };
}
