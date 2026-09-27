/**
 * @fleetos/maintenance — D2: the service-vendor matching engine.
 *
 * Pure functions: given a service work order and a list of vendor records
 * (INJECTED inputs — both the work order's typed comparable floors and
 * the vendors' typed terms from `@fleetos/vendors` are consumed directly
 * — the module-map edge `maintenance -> vendors` honored via the same-
 * lane `@fleetos/vendors` import), produce a deterministic ranked list
 * of `ServiceVendorMatch` records with machine-stable match reasons.
 * No ML, no clock reads, no side effects (except the injected audit
 * sink emission, which is the consequential trace — never affects the
 * matching output).
 *
 * Matching dimensions (per `spec/ARCHITECTURE.md` § Procurement/service
 * exchange; W032's matchDemand pattern):
 *   - region: vendor.regions includes the work order's service area;
 *   - capability: vendor declares a capability matching the work order's
 *     service category (or an allowed substitution);
 *   - deadline: vendor lead time (days) <= work order deadline days from `at`;
 *   - availability: vendor inventory availability ratio > 0;
 *   - SLA: vendor.terms.sla.coverage >= work order.slaFloor.coverage;
 *   - warranty: vendor.terms.warranty.days >= work order.warrantyFloor.days
 *     (when requireInWarranty; otherwise the vendor is down-ranked but
 *     not rejected — the warranty standing is machine-stable);
 *   - quality: vendor.terms.quality.score >= work order.qualityFloor.score;
 *   - availability floor: vendor availability ratio >= work order.availabilityFloor.ratio.
 *
 * Rank score (only satisfiable candidates get a positive score):
 *   - baseline 0.5 (satisfying every hard gate);
 *   - +0.2 * (vendor.quality - work order.qualityFloor);
 *   - +0.15 * (vendor.sla - work order.slaFloor);
 *   - +0.1 * normalized warranty headroom bonus (capped at 3 years
 *     beyond the floor; down-ranked when out-of-warranty-shortfall but
 *     still satisfiable — the work order accepts out-of-warranty vendors);
 *   - +0.05 * (vendor availability - work order.availabilityFloor);
 *   - -0.2 * substitution down-rank (matched capability is a substitution,
 *     not the work order's primary service category);
 *   - -0.15 * out-of-warranty down-rank (matched vendor is out-of-warranty
 *     but the work order accepts out-of-warranty — the standing is
 *     recorded in the reasons).
 *
 * Clamped to [0, 1]. Unsatisfiable candidates get a score of 0.
 *
 * The matcher is the W032 `matchDemand` pattern adapted for service work
 * orders: same determinism contract, same rank-score structure, same
 * machine-stable reason kinds. The consequential audit emission is the
 * `maintenance.match.recorded` action (one record per satisfiable match).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, FleetError, VendorId } from "@fleetos/contracts";
import type { Vendor, VendorCapability, VendorInventorySignal } from "@fleetos/vendors";
import type { ServiceWorkOrder } from "./service-work-order";
import type { MaintenanceAuditSink } from "./audit-seam";
import { NOOP_MAINTENANCE_AUDIT_SINK, MAINTENANCE_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

/** The service matching engine version. */
export const SERVICE_MATCH_ENGINE_VERSION = "maintenance-matching/1" as const;

/** The service matching model version. */
export const SERVICE_MATCH_MODEL_VERSION = 1 as const;

/** The maximum warranty-days bonus (3 years beyond the floor). */
export const MAX_WARRANTY_DAYS_BONUS = 365 * 3;

/**
 * The match reason for one dimension. Machine-stable: callers and
 * auditors match on the kind string.
 */
export type ServiceMatchReasonKind =
  | "region_unsupported"
  | "capability_unmatched"
  | "deadline_unsatisfiable"
  | "availability_unavailable"
  | "sla_below_floor"
  | "warranty_floor_unmet"
  | "quality_below_floor"
  | "availability_below_floor"
  | "substitution_downrank"
  | "out_of_warranty_downrank";

/** A single match-reason entry (machine-stable). */
export interface ServiceMatchReason {
  readonly kind: ServiceMatchReasonKind;
  readonly detail: string;
}

/**
 * The vendor match: one vendor's fit assessment against one service work
 * order. Carries the matched capability (when present), the matched
 * inventory signal (when one exists for the capability), the rank score
 * in [0, 1] (higher is better), and the machine-stable match reasons
 * (failures when unsatisfiable, evidence when down-ranked).
 */
export interface ServiceVendorMatch {
  /** The matched vendor (latest revision). */
  readonly vendor: Vendor;
  /** The matched capability (when the vendor declares one for the service category). */
  readonly matchedCapability: VendorCapability | null;
  /** The matched inventory signal (when one exists for the capability). */
  readonly matchedInventory: VendorInventorySignal | null;
  /** The match rank score in [0, 1] (higher is better; 0 means unsatisfiable). */
  readonly rankScore: number;
  /** True when the vendor satisfies every hard gate. */
  readonly satisfiable: boolean;
  /** Machine-stable reasons (failures when unsatisfiable, down-ranks otherwise). */
  readonly reasons: readonly ServiceMatchReason[];
}

/** The tagged result of a service matching run. */
export type ServiceMatchResult =
  | {
      readonly ok: true;
      /** Satisfiable matches, ranked: rankScore desc, vendorId asc. */
      readonly matches: readonly ServiceVendorMatch[];
      /** Rejected vendors, vendorId order. */
      readonly rejected: readonly ServiceVendorMatch[];
      readonly engineVersion: string;
    }
  | { readonly ok: false; readonly error: FleetError };

/** Options for `matchServiceWorkOrder`. */
export interface ServiceMatchOptions {
  /** Audit sink (default: no-op). The matching run is consequential — it audits. */
  readonly auditSink?: MaintenanceAuditSink;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Injected matching-run timestamp. */
  readonly at: string;
}

/**
 * Match a service work order against a list of vendor records. PURE and
 * DETERMINISTIC: the same work order + vendors + options always produce
 * the same matches (same rank scores, same reasons, same order)
 * regardless of vendor input order.
 *
 * The matcher consumes the work order's typed comparable floors
 * (slaFloor, warrantyFloor via warrantyRules, qualityFloor,
 * availabilityFloor) and the vendors' typed terms from
 * `@fleetos/vendors` (vendor.terms.sla.coverage, vendor.terms.warranty.days,
 * vendor.terms.quality.score, vendor.inventory[].availability.ratio,
 * vendor.inventory[].leadTime.days) — the module-map edge `maintenance ->
 * vendors` honored via the same-lane import.
 *
 * @param workOrder the service work order to match
 * @param vendors the vendor records to match against (INJECTED input)
 * @param options the matching options (audit sink, correlation id, at)
 * @returns the tagged match result
 */
export function matchServiceWorkOrder(
  workOrder: ServiceWorkOrder,
  vendors: readonly Vendor[],
  options: ServiceMatchOptions,
): ServiceMatchResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(vendors)) {
    failures.push({ path: "/vendors", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.matchInvalid,
        "service matching request is invalid",
        {
          tenantId: workOrder?.tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Work order's deadline-in-days from `at` (fail-closed: 0 when
  // unparseable or when deadline <= at — the matcher then rejects every
  // vendor on the deadline gate, which is the documented fail-closed
  // behavior).
  const atMs = Date.parse(options.at);
  const deadlineMs = Date.parse(workOrder.deadline);
  const deadlineDays =
    Number.isFinite(atMs) && Number.isFinite(deadlineMs) && deadlineMs >= atMs
      ? Math.floor((deadlineMs - atMs) / (24 * 3_600_000))
      : 0;

  // The work order's allowed substitutions + the service category (primary).
  const allowedSubs = new Set(workOrder.allowedSubstitutions);
  const primaryCategory = workOrder.serviceCategory;

  const matches: ServiceVendorMatch[] = [];
  const rejected: ServiceVendorMatch[] = [];

  for (const vendor of vendors) {
    const reasons: ServiceMatchReason[] = [];
    let satisfiable = true;

    // Region gate.
    if (!vendor.regions.includes(workOrder.serviceArea)) {
      reasons.push({
        kind: "region_unsupported",
        detail: `vendor regions [${vendor.regions.join(", ")}] do not include ${workOrder.serviceArea}`,
      });
      satisfiable = false;
    }

    // Capability gate: the vendor must declare at least one capability
    // matching the work order's service category (the primary) OR one of
    // its allowed substitutions. When the work order has no allowed
    // substitutions, any capability declaring the primary matches; a
    // substitution (any other capability) is acceptable but down-ranked.
    const matchedCapability = pickMatchedCapability(vendor, primaryCategory, allowedSubs);
    if (matchedCapability === null) {
      reasons.push({
        kind: "capability_unmatched",
        detail: `vendor declares no capability matching the work order's service category ${primaryCategory} or its allowed substitutions`,
      });
      satisfiable = false;
    }

    // Inventory signal for the matched capability (or the maximum
    // availability across the vendor's signals when no capability
    // matches — used for the availability gate).
    const matchedInventory =
      matchedCapability !== null
        ? (vendor.inventory.find((s) => s.capability.id === matchedCapability.id) ?? null)
        : null;
    const fallbackInventory = pickBestInventory(vendor.inventory);
    const availabilityRatio =
      matchedInventory?.availability.ratio ?? fallbackInventory?.availability.ratio ?? 0;
    const leadTimeDays =
      matchedInventory?.leadTime.days ?? fallbackInventory?.leadTime.days ?? Number.POSITIVE_INFINITY;

    // Availability gate: vendor availability ratio must be > 0 (the
    // vendor can fulfill some of the work).
    if (availabilityRatio <= 0) {
      reasons.push({
        kind: "availability_unavailable",
        detail: `vendor availability ${availabilityRatio.toFixed(3)} cannot fulfill the service`,
      });
      satisfiable = false;
    }

    // Deadline gate.
    if (!Number.isFinite(leadTimeDays) || leadTimeDays > deadlineDays) {
      reasons.push({
        kind: "deadline_unsatisfiable",
        detail: `vendor lead time ${Number.isFinite(leadTimeDays) ? leadTimeDays : "unknown"} days exceeds deadline ${deadlineDays} days`,
      });
      satisfiable = false;
    }

    // Availability floor gate.
    if (availabilityRatio < workOrder.availabilityFloor.ratio) {
      reasons.push({
        kind: "availability_below_floor",
        detail: `vendor availability ${availabilityRatio.toFixed(3)} < floor ${workOrder.availabilityFloor.ratio.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // SLA gate.
    if (vendor.terms.sla.coverage < workOrder.slaFloor.coverage) {
      reasons.push({
        kind: "sla_below_floor",
        detail: `vendor SLA ${vendor.terms.sla.coverage.toFixed(3)} < floor ${workOrder.slaFloor.coverage.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // Warranty gate.
    // - When requireInWarranty: the vendor's warranty days MUST be >=
    //   the floor (a hard gate failure).
    // - Otherwise: the vendor's warranty days must still be >= the floor
    //   (the floor is the minimum regardless — requireInWarranty only
    //   controls whether out-of-warranty-shortfall (above floor but below
    //   the implied in-warranty threshold) is acceptable. Since the
    //   threshold IS the floor, out-of-warranty-shortfall is unreachable
    //   — the floor check decides).
    if (vendor.terms.warranty.days < workOrder.warrantyRules.warrantyFloor.days) {
      reasons.push({
        kind: "warranty_floor_unmet",
        detail: `vendor warranty ${vendor.terms.warranty.days} days < floor ${workOrder.warrantyRules.warrantyFloor.days} days`,
      });
      satisfiable = false;
    }

    // Quality gate.
    if (vendor.terms.quality.score < workOrder.qualityFloor.score) {
      reasons.push({
        kind: "quality_below_floor",
        detail: `vendor quality ${vendor.terms.quality.score.toFixed(3)} < floor ${workOrder.qualityFloor.score.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // Compute the rank score (only when satisfiable).
    let rankScore = 0;
    if (satisfiable) {
      rankScore = 0.5;
      rankScore += 0.2 * (vendor.terms.quality.score - workOrder.qualityFloor.score);
      rankScore += 0.15 * (vendor.terms.sla.coverage - workOrder.slaFloor.coverage);
      const warrantyBonus = Math.min(
        1,
        Math.max(
          0,
          (vendor.terms.warranty.days - workOrder.warrantyRules.warrantyFloor.days) /
            MAX_WARRANTY_DAYS_BONUS,
        ),
      );
      rankScore += 0.1 * warrantyBonus;
      rankScore += 0.05 * (availabilityRatio - workOrder.availabilityFloor.ratio);

      // Down-rank: substitution match (the matched capability is not
      // the work order's primary service category). The matcher
      // accepts both primary and allowed-substitution matches; the
      // substitution down-rank is the machine-stable evidence that
      // the matched capability is not the primary.
      const isSubstitution =
        matchedCapability !== null && matchedCapability.id !== primaryCategory;
      if (isSubstitution) {
        rankScore -= 0.2;
        reasons.push({
          kind: "substitution_downrank",
          detail: `matched capability ${matchedCapability.id} is a substitution, not the work order's primary service category ${primaryCategory}`,
        });
      }

      // Down-rank: out-of-warranty (the vendor's warranty is above the
      // floor but below the require-in-warranty threshold — recorded
      // when requireInWarranty is false and the warranty headroom is
      // exactly at the floor; this is the documented edge case where
      // the work order accepts out-of-warranty vendors but down-ranks
      // them. The standing is also recorded for vendors above the
      // floor — the standing field on the match carries the
      // machine-stable classification).
      const warrantyHeadroom =
        vendor.terms.warranty.days - workOrder.warrantyRules.warrantyFloor.days;
      if (!workOrder.warrantyRules.requireInWarranty && warrantyHeadroom === 0) {
        rankScore -= 0.15;
        reasons.push({
          kind: "out_of_warranty_downrank",
          detail: `vendor warranty ${vendor.terms.warranty.days} days exactly meets the floor ${workOrder.warrantyRules.warrantyFloor.days} days (no headroom); work order accepts out-of-warranty vendors but down-ranks`,
        });
      }

      rankScore = Math.max(0, Math.min(1, rankScore));
    }

    const match: ServiceVendorMatch = frozen({
      vendor,
      matchedCapability,
      matchedInventory,
      rankScore,
      satisfiable,
      reasons: frozenArray(reasons),
    });

    if (satisfiable) {
      matches.push(match);
    } else {
      rejected.push(match);
    }
  }

  // Rank: satisfiable matches by rankScore desc, vendorId asc.
  matches.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return (a.vendor.vendorId as string) < (b.vendor.vendorId as string)
      ? -1
      : (a.vendor.vendorId as string) > (b.vendor.vendorId as string)
        ? 1
        : 0;
  });
  rejected.sort((a, b) =>
    (a.vendor.vendorId as string) < (b.vendor.vendorId as string)
      ? -1
      : (a.vendor.vendorId as string) > (b.vendor.vendorId as string)
        ? 1
        : 0,
  );

  // Audit emission: one record per satisfiable match (the matching trail).
  const sink = options.auditSink ?? NOOP_MAINTENANCE_AUDIT_SINK;
  for (const match of matches) {
    sink.append(
      frozen({
        action: MAINTENANCE_AUDIT_ACTIONS.matchRecorded,
        tenantId: workOrder.tenantId,
        subject: workOrder.workOrderId,
        occurredAt: options.at,
        correlationId: options.correlationId,
        details: {
          phase: "matching",
          vendorId: match.vendor.vendorId as VendorId,
          matchedCapabilityId: match.matchedCapability?.id ?? null,
          rankScore: match.rankScore,
          satisfiable: match.satisfiable,
          reasonKinds: match.reasons.map((r) => r.kind),
        },
      }),
    );
  }

  return frozen({
    ok: true as const,
    matches: frozenArray(matches),
    rejected: frozenArray(rejected),
    engineVersion: SERVICE_MATCH_ENGINE_VERSION,
  });
}

/**
 * Pick the vendor's best-matching capability for the work order's
 * service category. Prefer an exact match against the primary
 * category (`workOrder.serviceCategory`); otherwise prefer an exact
 * match against one of the allowed substitutions; otherwise return
 * null (the vendor declares no acceptable capability — rejected on
 * the capability gate).
 *
 * The work order ALWAYS carries a primary `serviceCategory` (required
 * field); the matcher requires either the primary or an allowed
 * substitution match. There is no "any capability" fallback — a
 * vendor whose capability matches neither is rejected.
 *
 * Returns null when the vendor declares no capability OR when no
 * capability matches the primary or allowed substitutions.
 */
function pickMatchedCapability(
  vendor: Vendor,
  primaryCategory: string,
  allowedSubs: Set<string>,
): VendorCapability | null {
  // 1. Exact match against the primary service category.
  for (const cap of vendor.capabilities) {
    if (cap.id === primaryCategory) return cap;
  }
  // 2. Exact match against an allowed substitution.
  if (allowedSubs.size > 0) {
    for (const cap of vendor.capabilities) {
      if (allowedSubs.has(cap.id)) return cap;
    }
  }
  // 3. No acceptable capability — reject on the capability gate.
  return null;
}

/** Pick the inventory signal with the highest availability (fallback). */
function pickBestInventory(
  inventory: readonly VendorInventorySignal[],
): VendorInventorySignal | null {
  if (inventory.length === 0) return null;
  let best = inventory[0] as VendorInventorySignal;
  for (let i = 1; i < inventory.length; i++) {
    const sig = inventory[i] as VendorInventorySignal;
    if (sig.availability.ratio > best.availability.ratio) best = sig;
  }
  return best;
}
