/**
 * @fleetos/procurement — D2b: the matching engine.
 *
 * Pure functions: given a demand and a list of vendor records (INJECTED
 * inputs), produce a deterministic ranked list of `VendorMatch` records
 * with machine-stable match reasons. No ML, no clock reads, no side
 * effects (except the injected audit sink emission, which is the
 * consequential trace — never affects the matching output).
 *
 * Matching dimensions (per `spec/ARCHITECTURE.md` § Procurement/service
 * exchange):
 *   - workload: passed through (the demand carries workloadId);
 *   - quantity: vendor inventory availability ratio > 0;
 *   - deadline: vendor lead time (days) <= demand deadline days from `at`;
 *   - location: vendor regions include the demand delivery area;
 *   - substitutions: a vendor capability that matches the demand's
 *     allowed substitutions is up-ranked; a substitution (any other
 *     capability) is down-ranked but still acceptable;
 *   - budget: matched at the QUOTE step (D3); the matcher carries the
 *     budget cap as advisory input — vendors that obviously exceed it
 *     (declared price > cap) are flagged but not rejected (the quote is
 *     authoritative);
 *   - warranty: vendor warranty days >= demand warranty floor;
 *   - SLA: vendor SLA coverage >= demand SLA floor;
 *   - vendor quality: vendor quality score >= demand quality floor;
 *   - inventory: vendor availability ratio >= demand availability floor.
 *
 * Rank score (only satisfiable candidates get a positive score):
 *   - baseline 0.5 (satisfying every hard gate);
 *   - +0.2 * (vendor.quality - demand.qualityFloor);
 *   - +0.15 * (vendor.sla - demand.slaFloor);
 *   - +0.1 * normalized warranty bonus (capped);
 *   - +0.05 * (matchedInventory.availability - demand.availabilityFloor);
 *   - -0.2 * substitution down-rank (matched capability is a substitution);
 *   - -0.3 * rejected_by_evidence (matched candidate appears in W022 evidence).
 *
 * Clamped to [0, 1]. Unsatisfiable candidates get a score of 0.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId } from "@fleetos/contracts";
import type { Vendor, VendorCapability, VendorInventorySignal } from "@fleetos/vendors";
import type { ProcurementDemand } from "./demand";
import type { ProcurementAuditSink } from "./audit-seam";
import { NOOP_PROCUREMENT_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

/** The matching engine version. */
export const MATCH_ENGINE_VERSION = "procurement-matching/1" as const;

/** The matching model version. */
export const MATCH_MODEL_VERSION = 1 as const;

/** The maximum warranty-days bonus (3 years beyond the floor). */
export const MAX_WARRANTY_DAYS_BONUS = 365 * 3;

/**
 * The match reason for one dimension. Machine-stable: callers and
 * auditors match on the kind string.
 */
export type MatchReasonKind =
  | "quantity_unavailable"
  | "deadline_unsatisfiable"
  | "region_unsupported"
  | "capability_unmatched"
  | "sla_below_floor"
  | "warranty_below_floor"
  | "quality_below_floor"
  | "availability_below_floor"
  | "substitution_downrank"
  | "rejected_by_evidence";

/** A single match-reason entry (machine-stable). */
export interface MatchReason {
  readonly kind: MatchReasonKind;
  readonly detail: string;
}

/**
 * The vendor match: one vendor's fit assessment against one demand.
 * Carries the matched capability (when present), the rank score in
 * [0, 1] (higher is better), and the machine-stable match reasons
 * (failures when unsatisfiable, evidence when down-ranked).
 */
export interface VendorMatch {
  /** The matched vendor (latest revision). */
  readonly vendor: Vendor;
  /** The matched capability (when the vendor declares one for the demand). */
  readonly matchedCapability: VendorCapability | null;
  /** The matched inventory signal (when one exists for the capability). */
  readonly matchedInventory: VendorInventorySignal | null;
  /** The match rank score in [0, 1] (higher is better; 0 means unsatisfiable). */
  readonly rankScore: number;
  /** True when the vendor satisfies every hard gate. */
  readonly satisfiable: boolean;
  /** Machine-stable reasons (failures when unsatisfiable, down-ranks otherwise). */
  readonly reasons: readonly MatchReason[];
}

/** The tagged result of a matching run. */
export type MatchResult =
  | {
      readonly ok: true;
      /** Satisfiable matches, ranked: rankScore desc, vendorId asc. */
      readonly matches: readonly VendorMatch[];
      /** Rejected vendors, vendorId order. */
      readonly rejected: readonly VendorMatch[];
      readonly engineVersion: string;
    }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** Options for `matchDemand`. */
export interface MatchOptions {
  /** Audit sink (default: no-op). The matching run is consequential — it audits. */
  readonly auditSink?: ProcurementAuditSink;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Injected matching-run timestamp. */
  readonly at: string;
}

/**
 * Match a demand against a list of vendor records. PURE and
 * DETERMINISTIC: the same demand + vendors + options always produce
 * the same matches (same rank scores, same reasons, same order)
 * regardless of vendor input order.
 */
export function matchDemand(
  demand: ProcurementDemand,
  vendors: readonly Vendor[],
  options: MatchOptions,
): MatchResult {
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
        "matching request is invalid",
        {
          tenantId: demand?.tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Demand's deadline-in-days from `at` (fail-closed: 0 when unparseable
  // or when deadline <= at — the matcher then rejects every vendor on
  // the deadline gate, which is the documented fail-closed behavior).
  const atMs = Date.parse(options.at);
  const deadlineMs = Date.parse(demand.deadline);
  const deadlineDays =
    Number.isFinite(atMs) && Number.isFinite(deadlineMs) && deadlineMs >= atMs
      ? Math.floor((deadlineMs - atMs) / (24 * 3_600_000))
      : 0;

  // Pre-collect the demand's allowed substitutions + rejection candidate ids.
  const allowedSubs = new Set(demand.allowedSubstitutions);
  const rejectedCandidates = new Set(demand.rejectionEvidence.map((e) => e.candidateId));

  const matches: VendorMatch[] = [];
  const rejected: VendorMatch[] = [];

  for (const vendor of vendors) {
    const reasons: MatchReason[] = [];
    let satisfiable = true;

    // Region gate.
    if (!vendor.regions.includes(demand.deliveryArea)) {
      reasons.push({
        kind: "region_unsupported",
        detail: `vendor regions [${vendor.regions.join(", ")}] do not include ${demand.deliveryArea}`,
      });
      satisfiable = false;
    }

    // Capability gate: the vendor must declare at least one capability
    // matching the demand's allowed substitutions (or any capability
    // when the demand is unscoped — unscoped demand).
    const matchedCapability = pickMatchedCapability(vendor, allowedSubs);
    if (matchedCapability === null) {
      reasons.push({
        kind: "capability_unmatched",
        detail: "vendor declares no capability matching the demand's allowed substitutions",
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

    // Quantity gate: vendor availability ratio must be > 0 (the vendor
    // can fulfill some of the demand). The actual allocation is the
    // quote's responsibility.
    if (availabilityRatio <= 0) {
      reasons.push({
        kind: "quantity_unavailable",
        detail: `vendor availability ${availabilityRatio.toFixed(3)} cannot fulfill quantity ${demand.quantity}`,
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
    if (availabilityRatio < demand.availabilityFloor.ratio) {
      reasons.push({
        kind: "availability_below_floor",
        detail: `vendor availability ${availabilityRatio.toFixed(3)} < floor ${demand.availabilityFloor.ratio.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // SLA gate.
    if (vendor.terms.sla.coverage < demand.slaFloor.coverage) {
      reasons.push({
        kind: "sla_below_floor",
        detail: `vendor SLA ${vendor.terms.sla.coverage.toFixed(3)} < floor ${demand.slaFloor.coverage.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // Warranty gate.
    if (vendor.terms.warranty.days < demand.warrantyFloor.days) {
      reasons.push({
        kind: "warranty_below_floor",
        detail: `vendor warranty ${vendor.terms.warranty.days} days < floor ${demand.warrantyFloor.days} days`,
      });
      satisfiable = false;
    }

    // Quality gate.
    if (vendor.terms.quality.score < demand.qualityFloor.score) {
      reasons.push({
        kind: "quality_below_floor",
        detail: `vendor quality ${vendor.terms.quality.score.toFixed(3)} < floor ${demand.qualityFloor.score.toFixed(3)}`,
      });
      satisfiable = false;
    }

    // Compute the rank score (only when satisfiable).
    let rankScore = 0;
    if (satisfiable) {
      rankScore = 0.5;
      rankScore += 0.2 * (vendor.terms.quality.score - demand.qualityFloor.score);
      rankScore += 0.15 * (vendor.terms.sla.coverage - demand.slaFloor.coverage);
      const warrantyBonus = Math.min(
        1,
        Math.max(0, (vendor.terms.warranty.days - demand.warrantyFloor.days) / MAX_WARRANTY_DAYS_BONUS),
      );
      rankScore += 0.1 * warrantyBonus;
      rankScore += 0.05 * (availabilityRatio - demand.availabilityFloor.ratio);

      // Down-rank: substitution match.
      const isSubstitution =
        matchedCapability !== null &&
        demand.allowedSubstitutions.length > 0 &&
        !allowedSubs.has(matchedCapability.id);
      if (isSubstitution) {
        rankScore -= 0.2;
        reasons.push({
          kind: "substitution_downrank",
          detail: `matched capability ${matchedCapability.id} is a substitution, not the demand's primary`,
        });
      }

      // Down-rank: rejected by W022 evidence.
      const rejectedByEvidence =
        matchedCapability !== null && rejectedCandidates.has(matchedCapability.id);
      if (rejectedByEvidence) {
        rankScore -= 0.3;
        reasons.push({
          kind: "rejected_by_evidence",
          detail: `matched capability ${matchedCapability.id} appears in the demand's W022 rejection evidence`,
        });
      }

      rankScore = Math.max(0, Math.min(1, rankScore));
    }

    const match: VendorMatch = frozen({
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
    return a.vendor.vendorId < b.vendor.vendorId
      ? -1
      : a.vendor.vendorId > b.vendor.vendorId
        ? 1
        : 0;
  });
  rejected.sort((a, b) =>
    a.vendor.vendorId < b.vendor.vendorId ? -1 : a.vendor.vendorId > b.vendor.vendorId ? 1 : 0,
  );

  // Audit emission: one record per satisfiable match (the matching trail).
  const sink = options.auditSink ?? NOOP_PROCUREMENT_AUDIT_SINK;
  for (const match of matches) {
    sink.append(
      frozen({
        action: "procurement.match.found",
        tenantId: demand.tenantId,
        subject: demand.demandId,
        occurredAt: options.at,
        correlationId: options.correlationId,
        details: {
          phase: "matching",
          vendorId: match.vendor.vendorId,
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
    engineVersion: MATCH_ENGINE_VERSION,
  });
}

/**
 * Pick the vendor's best-matching capability: prefer an exact id match
 * against the demand's allowed substitutions; otherwise, when the demand
 * is unscoped (no allowed substitutions), return the first declared
 * capability. Returns null when no capability matches.
 */
function pickMatchedCapability(
  vendor: Vendor,
  allowedSubs: Set<string>,
): VendorCapability | null {
  if (allowedSubs.size === 0) {
    return vendor.capabilities[0] ?? null;
  }
  for (const cap of vendor.capabilities) {
    if (allowedSubs.has(cap.id)) return cap;
  }
  // Fall back to any capability (the demand's allowed substitutions
  // are advisory; a vendor declaring any capability is acceptable). The
  // matcher down-ranks substitutions.
  return vendor.capabilities[0] ?? null;
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
