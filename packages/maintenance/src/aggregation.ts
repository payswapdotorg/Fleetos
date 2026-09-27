/**
 * @fleetos/maintenance — D3: deadline aggregation of compatible service
 * orders.
 *
 * Compatible service orders may be aggregated before a customer
 * deadline (per `spec/ARCHITECTURE.md` § Procurement/service exchange:
 * "Compatible orders may be aggregated before a customer deadline.
 * Individual customer contracts remain auditable."). The aggregation is
 * deterministic (grouping by vendor, service area, deadline window;
 * member order ids sorted; aggregation id is a stable hash of the
 * grouping tuple + member work order ids). The aggregation is a
 * PROPOSAL — never automatic dispatch (`spec/ARCHITECTURE-LOCK.md`
 * item 4: every dispatched action requires explicit authorization;
 * nothing here dispatches, fulfills, or procures — the procurement
 * wave is responsible for materializing any procurement).
 *
 * The aggregation traces to its member work orders (every aggregated
 * batch carries `memberWorkOrderIds` — the individual customer
 * contracts remain auditable). The aggregation id is derived from
 * (tenant, vendor, serviceArea, deadline, member work order ids), so
 * the same set of compatible work orders always produces the same
 * aggregation id byte-for-byte (deterministic grouping).
 *
 * The matcher (D2) produces ranked vendor matches; the aggregation
 * consumes the work order + the matched vendor (NOT the quote —
 * maintenance does not own quote/acceptance; that's the procurement
 * wave's domain). The aggregation groups work orders that share a
 * compatible (vendor, serviceArea, deadline-window) tuple.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, FleetError, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { ServiceWorkOrder } from "./service-work-order";
import type { ServiceVendorMatch } from "./matching";
import type { MaintenanceAuditSink } from "./audit-seam";
import { NOOP_MAINTENANCE_AUDIT_SINK, MAINTENANCE_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The aggregation schema version. */
export const AGGREGATION_SCHEMA_VERSION = 1 as const;

/** The aggregation model version. */
export const AGGREGATION_MODEL_VERSION = 1 as const;

/**
 * The deadline-window size in days. Two work orders whose deadlines fall
 * within the same window (relative to the aggregation formation instant)
 * are considered compatible on the deadline dimension. The window is
 * the spec's "deadline window" — a fixed calendar window, NOT a
 * relative offset. The matcher uses the deadline-days-from-`at` value
 * directly; the aggregator groups work orders whose deadlines share the
 * same calendar day (window = 1 day, the strictest interpretation).
 *
 * Judgment call: the window is FIXED at 1 day (calendar day). A later
 * wave may relax this to a tenant-configurable window; the aggregator
 * would need a tenant-supplied window parameter (currently
 * unimplemented — the strict window preserves determinism without
 * requiring tenant configuration).
 */
export const AGGREGATION_DEADLINE_WINDOW_DAYS = 1 as const;

// ---------------------------------------------------------------------------
// The aggregated service order record
// ---------------------------------------------------------------------------

/**
 * An aggregated service order: one or more compatible service work
 * orders grouped by (vendor, serviceArea, deadline window) before a
 * customer deadline. Each aggregated order traces to its member work
 * orders (individual customer contracts remain auditable).
 *
 * PROPOSAL only: the aggregation never dispatches. The procurement
 * wave is responsible for materializing any procurement (creating
 * demands, matching vendors for fulfillment, issuing quotes, accepting
 * quotes). This package creates no demand and orders nothing — the
 * aggregation is a deterministic grouping proposal.
 */
export interface AggregatedServiceOrder extends TenantScoped {
  /** Deterministic id: `magg_` + fnv1a32 of the grouping tuple + member work order ids. */
  readonly aggregationId: string;
  readonly tenantId: TenantId;
  /** The vendor fulfilling the aggregated order (the matched vendor). */
  readonly vendorId: VendorId;
  /** The shared service area. */
  readonly serviceArea: string;
  /** The shared deadline (the earliest member work order's deadline). */
  readonly deadline: string;
  /** The member work order ids (sorted — deterministic). */
  readonly memberWorkOrderIds: readonly string[];
  /** The member work orders (sorted by workOrderId — deterministic; for trace). */
  readonly memberWorkOrders: readonly ServiceWorkOrder[];
  /** The aggregated member count. */
  readonly memberCount: number;
  /** The total warranty headroom across members (sum of vendor.warranty.days - floor). */
  readonly totalWarrantyHeadroomDays: number;
  /** Injected aggregation-formation timestamp. */
  readonly formedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/** The tagged result of an aggregation operation. */
export type AggregationResult =
  | { readonly ok: true; readonly aggregation: AggregatedServiceOrder }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The grouping key for compatible service orders: (vendorId,
 * serviceArea, deadline). Two work orders with the same key may be
 * aggregated. The deadline-window is the work order's `deadline` (per
 * spec — compatible orders share the same customer deadline).
 */
export interface ServiceAggregationGroupKey {
  readonly vendorId: VendorId;
  readonly serviceArea: string;
  readonly deadline: string;
}

/**
 * A (work order, matched vendor) pair — the input to aggregation. The
 * match must be satisfiable (the caller verifies — the matcher (D2)
 * produces satisfiable matches separately from rejected ones).
 */
export interface ServiceWorkOrderMatchPair {
  readonly workOrder: ServiceWorkOrder;
  readonly match: ServiceVendorMatch;
}

// ---------------------------------------------------------------------------
// Aggregation formation
// ---------------------------------------------------------------------------

/**
 * Form an aggregated service order from a list of compatible
 * (work order, matched vendor) pairs. The aggregation is
 * deterministic: member work order ids are sorted; the aggregationId
 * is a stable hash of the grouping tuple + member work order ids.
 *
 * @param tenantId the acting tenant
 * @param pairs the (work order, matched vendor) pairs to aggregate
 *        (each pair's match must be satisfiable — the caller verifies)
 * @param at the injected aggregation-formation timestamp
 * @param correlationId the correlation id
 * @param sink the audit sink (default: no-op)
 */
export function formServiceAggregation(
  tenantId: TenantId,
  pairs: readonly ServiceWorkOrderMatchPair[],
  at: string,
  correlationId: CorrelationId,
  sink: MaintenanceAuditSink = NOOP_MAINTENANCE_AUDIT_SINK,
): AggregationResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof at !== "string" || !looksLikeIso(at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof correlationId !== "string" || correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(pairs) || pairs.length === 0) {
    failures.push({ path: "/pairs", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.aggregationInvalid,
        "service aggregation request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Validate each pair carries a satisfiable match + a same-tenant work order.
  const validatedFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i] as ServiceWorkOrderMatchPair;
    if (
      typeof pair !== "object" ||
      pair === null ||
      typeof pair.workOrder !== "object" ||
      pair.workOrder === null ||
      typeof pair.match !== "object" ||
      pair.match === null
    ) {
      validatedFailures.push({ path: `/pairs/${i}`, reason: "object_required" });
      continue;
    }
    if (pair.workOrder.tenantId !== tenantId) {
      validatedFailures.push({
        path: `/pairs/${i}/workOrder/tenantId`,
        reason: "tenant_mismatch",
      });
    }
    if (!pair.match.satisfiable) {
      validatedFailures.push({
        path: `/pairs/${i}/match/satisfiable`,
        reason: "must_be_satisfiable",
      });
    }
  }
  if (validatedFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.aggregationInvalid,
        "service aggregation request is invalid",
        { tenantId, correlationId },
        validatedFailures,
      ),
    };
  }

  // Sort member work orders by workOrderId (deterministic).
  const sortedPairs = [...pairs].sort((a, b) =>
    a.workOrder.workOrderId < b.workOrder.workOrderId
      ? -1
      : a.workOrder.workOrderId > b.workOrder.workOrderId
        ? 1
        : 0,
  );
  const memberWorkOrders = sortedPairs.map((p) => p.workOrder);
  const memberWorkOrderIds = memberWorkOrders.map((w) => w.workOrderId);

  // All pairs must share the same (vendor, serviceArea, deadline) tuple.
  const firstPair = sortedPairs[0] as ServiceWorkOrderMatchPair;
  const vendorId = firstPair.match.vendor.vendorId;
  const serviceArea = firstPair.workOrder.serviceArea;
  const deadline = firstPair.workOrder.deadline;
  for (let i = 1; i < sortedPairs.length; i++) {
    const pair = sortedPairs[i] as ServiceWorkOrderMatchPair;
    if (pair.match.vendor.vendorId !== vendorId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.aggregationInvalid,
          "service aggregation request is invalid",
          { tenantId, correlationId },
          [
            {
              path: `/pairs/${i}/match/vendorId`,
              reason: "vendor_mismatch",
            },
          ],
        ),
      };
    }
    if (pair.workOrder.serviceArea !== serviceArea) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.aggregationInvalid,
          "service aggregation request is invalid",
          { tenantId, correlationId },
          [
            {
              path: `/pairs/${i}/workOrder/serviceArea`,
              reason: "service_area_mismatch",
            },
          ],
        ),
      };
    }
    if (pair.workOrder.deadline !== deadline) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.aggregationInvalid,
          "service aggregation request is invalid",
          { tenantId, correlationId },
          [
            {
              path: `/pairs/${i}/workOrder/deadline`,
              reason: "deadline_mismatch",
            },
          ],
        ),
      };
    }
  }

  // Total warranty headroom across members (sum of vendor.warranty.days - floor).
  const totalWarrantyHeadroomDays = sortedPairs.reduce((sum, pair) => {
    const headroom =
      pair.match.vendor.terms.warranty.days -
      pair.workOrder.warrantyRules.warrantyFloor.days;
    return sum + Math.max(0, headroom);
  }, 0);

  const aggregationId = `magg_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      vendorId: vendorId as string,
      serviceArea,
      deadline,
      memberWorkOrderIds,
    }),
  )}`;
  const aggregation: AggregatedServiceOrder = frozen({
    aggregationId,
    tenantId,
    vendorId,
    serviceArea,
    deadline,
    memberWorkOrderIds: frozenArray(memberWorkOrderIds),
    memberWorkOrders: frozenArray(memberWorkOrders),
    memberCount: memberWorkOrderIds.length,
    totalWarrantyHeadroomDays,
    formedAt: at,
    schemaVersion: AGGREGATION_SCHEMA_VERSION,
    modelVersion: AGGREGATION_MODEL_VERSION,
  });

  sink.append(
    frozen({
      action: MAINTENANCE_AUDIT_ACTIONS.aggregationFormed,
      tenantId,
      subject: aggregationId,
      occurredAt: at,
      correlationId,
      details: {
        vendorId,
        serviceArea,
        deadline,
        memberWorkOrderIds,
        memberCount: memberWorkOrderIds.length,
        totalWarrantyHeadroomDays,
      },
    }),
  );

  return { ok: true, aggregation };
}

/**
 * Deterministic grouping: group (work order, matched vendor) pairs by
 * (vendorId, serviceArea, deadline-window) — the spec's "compatible
 * service orders may be aggregated before a customer deadline". Returns
 * one AggregatedServiceOrder per group, sorted by aggregationId.
 *
 * The deadline-window is the work order's `deadline` (per spec —
 * compatible orders share the same customer deadline). Two work orders
 * with the same (vendorId, serviceArea, deadline) form one group.
 *
 * @param tenantId the acting tenant
 * @param pairs the (work order, matched vendor) pairs to group (each
 *        pair's match must be satisfiable — the caller verifies)
 * @param at the injected aggregation-formation timestamp
 * @param correlationId the correlation id
 * @param sink the audit sink
 */
export function aggregateServiceWorkOrders(
  tenantId: TenantId,
  pairs: readonly ServiceWorkOrderMatchPair[],
  at: string,
  correlationId: CorrelationId,
  sink: MaintenanceAuditSink = NOOP_MAINTENANCE_AUDIT_SINK,
):
  | { ok: true; aggregations: readonly AggregatedServiceOrder[] }
  | { ok: false; error: FleetError } {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.aggregationInvalid,
        "service aggregation request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        [{ path: "/pairs", reason: "must_be_non_empty_array" }],
      ),
    };
  }

  // Group by (vendorId, serviceArea, deadline).
  const groups = new Map<string, ServiceWorkOrderMatchPair[]>();
  for (const pair of pairs) {
    const key = canonicalJson({
      vendorId: pair.match.vendor.vendorId as string,
      serviceArea: pair.workOrder.serviceArea,
      deadline: pair.workOrder.deadline,
    });
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [pair]);
    } else {
      group.push(pair);
    }
  }

  const aggregations: AggregatedServiceOrder[] = [];
  for (const groupPairs of groups.values()) {
    const result = formServiceAggregation(
      tenantId,
      groupPairs,
      at,
      correlationId,
      sink,
    );
    if (!result.ok) return result;
    aggregations.push(result.aggregation);
  }

  aggregations.sort((a, b) =>
    a.aggregationId < b.aggregationId ? -1 : a.aggregationId > b.aggregationId ? 1 : 0,
  );

  return { ok: true, aggregations: frozenArray(aggregations) };
}

/**
 * Verify that an aggregated service order traces to its member work
 * orders. PURE: every member work order id in
 * `aggregation.memberWorkOrderIds` must appear in
 * `aggregation.memberWorkOrders` (and vice versa). The aggregation's
 * `memberWorkOrders` array is the auditable trace — every aggregated
 * batch cites its member work orders verbatim.
 *
 * @param aggregation the aggregated service order to verify
 * @returns true when the trace is complete and consistent
 */
export function verifyAggregationTrace(
  aggregation: AggregatedServiceOrder,
): boolean {
  const ids = new Set(aggregation.memberWorkOrderIds);
  if (ids.size !== aggregation.memberWorkOrderIds.length) return false;
  if (aggregation.memberWorkOrders.length !== aggregation.memberWorkOrderIds.length) {
    return false;
  }
  for (const wo of aggregation.memberWorkOrders) {
    if (!ids.has(wo.workOrderId)) return false;
    if (wo.tenantId !== aggregation.tenantId) return false;
  }
  return true;
}
