/**
 * @fleetos/vendors — W072 D4: marketplace-quality evidence packs.
 *
 * A typed evidence pack surface composing the W072 outcome-quality
 * sources into a versioned, append-only marketplace-quality evidence
 * record PER VENDOR:
 *
 *   - the vendor's scorecard (this package's `VendorScorecard` — the
 *     native source);
 *   - commercial reconciliation reports (the procurement + software
 *     lanes' W072 reports — consumed through the
 *     `VendorReconciliationImpact` STRUCTURAL twin);
 *   - aggregation outcome measurements (the maintenance lane's W072
 *     `ServiceAggregationOutcome` — consumed through the
 *     `AggregationMeasurementSource` STRUCTURAL twin).
 *
 * The twins are STRUCTURAL: the binding site (the caller / the test
 * suite) projects the REAL report and measurement records
 * field-for-field through them; `src/` never imports the procurement,
 * software, or maintenance packages (the W040/W042 structural-seam
 * pattern, preserved deliberately). The pure projection helper
 * `projectCommercialReportToVendorImpacts` operates on the
 * `CommercialReportProjection` twin (also structurally satisfiable by
 * the real reports' discrepancy lists).
 *
 * CITATION DISCIPLINE — no uncited numbers, ever: every claim in the
 * pack carries its numeric value AND the refs of its source records
 * verbatim (the source record id plus the refs that source record
 * carries for the claim). A reconciliation count claim cites the
 * report id plus the both-side refs of the discrepancies counted; a
 * scorecard dimension claim cites the scorecard id plus the refs of
 * the interactions the dimension counted; an aggregation claim cites
 * the measurement id, the aggregation id, and (for contribution
 * claims) the member refs. A count with no refs is REFUSED
 * (`uncited_claim`) — the builder fails closed rather than compose an
 * uncited number.
 *
 * PROPOSAL-GRADE — never auto-published: every pack is born
 * `status: "PROPOSAL"`. This surface provides NO publish/accept
 * transition (documented contract): operator review and any
 * publication decision happen OUTSIDE this surface; nothing here can
 * promote a pack (`spec/ARCHITECTURE-LOCK.md` items 4 and 16 —
 * consequential transitions are explicit, authorized, and evidenced
 * elsewhere).
 *
 * Supersession discipline (`spec/ARCHITECTURE-LOCK.md` item 3): a pack
 * revision is a NEW record citing the prior via `supersedes`; the
 * prior is never rewritten.
 *
 * Emission policy: a successful pack build emits exactly one
 * `vendors.marketplace.pack.composed` audit record to the injected
 * `VendorsOutcomeAuditSink` (the W072 seam — structurally identical to
 * the lane's W012-pattern seams); failed builds emit none.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, FleetError, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { VendorsOutcomeAuditSink } from "./outcome-audit-seam";
import { NOOP_VENDORS_OUTCOME_AUDIT_SINK } from "./outcome-audit-seam";
import type {
  ScorecardQualityDimension,
  ScorecardWindow,
  VendorScorecard,
} from "./scorecard";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The evidence pack schema version. */
export const EVIDENCE_PACK_SCHEMA_VERSION = 1 as const;

/** The evidence pack model version. */
export const EVIDENCE_PACK_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The pack's publication status (PROPOSAL-grade only)
// ---------------------------------------------------------------------------

/**
 * The pack's publication status. The single legal value is
 * `"PROPOSAL"`: every pack is a DRAFT for operator review. This
 * surface deliberately provides NO publication transition — a pack can
 * never be auto-published (the type itself has no other member).
 */
export type MarketplaceEvidencePackStatus = "PROPOSAL";

// ---------------------------------------------------------------------------
// Machine-stable claim kinds
// ---------------------------------------------------------------------------

/**
 * The machine-stable claim kinds a pack can carry. Callers and auditors
 * match on the kind string; every kind maps 1:1 onto a source record
 * field (the citation discipline forbids derived or uncited numbers).
 */
export type EvidenceClaimKind =
  | "scorecard.fulfillment"
  | "scorecard.sla_adherence"
  | "scorecard.warranty_honoring"
  | "scorecard.quote_accuracy"
  | "reconciliation.price_mismatch"
  | "reconciliation.sla_breach"
  | "reconciliation.warranty_gap"
  | "reconciliation.undelivered"
  | "reconciliation.over_delivered"
  | "aggregation.coverage_ratio"
  | "aggregation.on_time_ratio"
  | "aggregation.contribution_count";

/** All claim kinds in canonical order. */
export const ALL_EVIDENCE_CLAIM_KINDS: readonly EvidenceClaimKind[] = Object.freeze([
  "scorecard.fulfillment",
  "scorecard.sla_adherence",
  "scorecard.warranty_honoring",
  "scorecard.quote_accuracy",
  "reconciliation.price_mismatch",
  "reconciliation.sla_breach",
  "reconciliation.warranty_gap",
  "reconciliation.undelivered",
  "reconciliation.over_delivered",
  "aggregation.coverage_ratio",
  "aggregation.on_time_ratio",
  "aggregation.contribution_count",
] as const);

// ---------------------------------------------------------------------------
// The composed sources (STRUCTURAL twins)
// ---------------------------------------------------------------------------

/**
 * The machine-stable discrepancy kind vocabulary of the W072
 * reconciliation surfaces (procurement + software) — the STRUCTURAL
 * twin of both lanes' `CommercialDiscrepancyKind` /
 * `SubscriptionDiscrepancyKind` unions.
 */
export type CommercialDiscrepancyKind =
  | "price_mismatch"
  | "sla_breach"
  | "warranty_gap"
  | "undelivered"
  | "over_delivered";

/**
 * One commercial reconciliation report's per-vendor impact (STRUCTURAL
 * twin): the discrepancies counted for ONE vendor, by kind, with the
 * both-side refs of the counted discrepancies verbatim. Projected at
 * the binding site from the real report's discrepancy list.
 */
export interface VendorReconciliationImpact {
  /** The source report's id (cited verbatim by every claim it feeds). */
  readonly reportId: string;
  readonly tenantId: TenantId;
  /** The vendor the impacts describe (must be the pack's vendor). */
  readonly vendorId: VendorId;
  /** The per-kind counts with their both-side discrepancy refs. */
  readonly byKind: readonly {
    readonly kind: CommercialDiscrepancyKind;
    readonly count: number;
    /** The both-side refs of the discrepancies counted (verbatim). */
    readonly refs: readonly string[];
  }[];
}

/**
 * A reconciliation report projection input (STRUCTURAL twin of the
 * real reports' discrepancy lists): the report id, tenant, and the
 * discrepancies with their kind, vendor, and BOTH-side refs. The pure
 * helper `projectCommercialReportToVendorImpacts` groups them per
 * vendor.
 */
export interface CommercialReportProjection {
  readonly reportId: string;
  readonly tenantId: TenantId;
  readonly discrepancies: readonly {
    readonly kind: CommercialDiscrepancyKind;
    readonly vendorId: VendorId;
    /** The agreed side's ref (e.g. the quote id / subscription id). */
    readonly expectedRef: string;
    /** The delivered side's ref (the delivery/provision id); null when absent. */
    readonly deliveredRef: string | null;
  }[];
}

/**
 * Project a reconciliation report's discrepancies into per-vendor
 * impacts. PURE and deterministic: byKind entries in canonical kind
 * order, refs in input order (both-side pairs), impacts sorted by
 * vendorId. Zero-count kinds are omitted (no number, no entry).
 *
 * @param report the report projection (structurally projected from the real report)
 * @returns the per-vendor impacts, sorted by vendorId
 */
export function projectCommercialReportToVendorImpacts(
  report: CommercialReportProjection,
): readonly VendorReconciliationImpact[] {
  const kindOrder: readonly CommercialDiscrepancyKind[] = [
    "price_mismatch",
    "sla_breach",
    "warranty_gap",
    "undelivered",
    "over_delivered",
  ];
  const byVendor = new Map<string, { vendorId: VendorId; kinds: Map<CommercialDiscrepancyKind, { count: number; refs: string[] }> }>();
  for (const discrepancy of report.discrepancies) {
    const key = discrepancy.vendorId as string;
    let entry = byVendor.get(key);
    if (entry === undefined) {
      entry = { vendorId: discrepancy.vendorId, kinds: new Map() };
      byVendor.set(key, entry);
    }
    let bucket = entry.kinds.get(discrepancy.kind);
    if (bucket === undefined) {
      bucket = { count: 0, refs: [] };
      entry.kinds.set(discrepancy.kind, bucket);
    }
    bucket.count += 1;
    bucket.refs.push(discrepancy.expectedRef);
    if (discrepancy.deliveredRef !== null) {
      bucket.refs.push(discrepancy.deliveredRef);
    }
  }
  const impacts: VendorReconciliationImpact[] = [];
  for (const entry of byVendor.values()) {
    const byKind = kindOrder
      .filter((kind) => entry.kinds.has(kind))
      .map((kind) => {
        const bucket = entry.kinds.get(kind);
        if (bucket === undefined) throw new Error("unreachable: kind present");
        return frozen({
          kind,
          count: bucket.count,
          refs: frozenArray(bucket.refs),
        });
      });
    impacts.push(frozen({ reportId: report.reportId, tenantId: report.tenantId, vendorId: entry.vendorId, byKind: frozenArray(byKind) }));
  }
  impacts.sort((a, b) => (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0));
  return frozenArray(impacts);
}

/**
 * One aggregation outcome measurement (STRUCTURAL twin of
 * `@fleetos/maintenance`'s `ServiceAggregationOutcome`): the coverage,
 * deadline adherence, and per-vendor contribution facts, projected
 * verbatim at the binding site.
 */
export interface AggregationMeasurementSource {
  /** The source measurement's id (cited verbatim by every claim it feeds). */
  readonly outcomeId: string;
  readonly tenantId: TenantId;
  /** The measured aggregation's id (cited verbatim). */
  readonly aggregationId: string;
  /** The aggregation's matched vendor (must be the pack's vendor). */
  readonly vendorId: VendorId;
  /** coverageRatio = ordersServed / ordersAggregated, in [0, 1]. */
  readonly coverageRatio: number;
  /** Orders served (members with completion evidence). */
  readonly servedCount: number;
  /** Machine-stable denominator: orders aggregated (member count). */
  readonly ordersAggregated: number;
  /** metCount / servedCount; null when nothing was served. */
  readonly onTimeRatio: number | null;
  /** Per-vendor contribution breakdowns (verbatim from the measurement). */
  readonly vendorContributions: readonly {
    readonly vendorId: VendorId;
    readonly completedCount: number;
    readonly memberRefs: readonly string[];
  }[];
}

// ---------------------------------------------------------------------------
// The claim record
// ---------------------------------------------------------------------------

/**
 * One claim in the pack: a machine-stable kind, a numeric value, and
 * the refs of its source records verbatim (NEVER empty — the builder
 * refuses an uncited claim). Every value is carried EXACTLY as it
 * appears in the cited source record (no derivation, no rounding).
 */
export interface EvidenceClaim {
  readonly kind: EvidenceClaimKind;
  /** The claim's numeric value, verbatim from the cited source record. */
  readonly value: number;
  /** The source record refs cited verbatim (the record id + the refs it carries for this claim). */
  readonly sourceRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// The pack record
// ---------------------------------------------------------------------------

/**
 * A marketplace-quality evidence pack for ONE vendor, at one immutable
 * revision: the composed, fully-cited claims from the vendor's
 * scorecard, the commercial reconciliation reports, and the aggregation
 * outcome measurements. PROPOSAL-grade (a draft for operator review —
 * never auto-published; no publish path exists in this surface).
 * Frozen at construction; a new revision cites the prior via
 * `supersedes`.
 */
export interface MarketplaceEvidencePack extends TenantScoped {
  /** Deterministic id: `mep_` + fnv1a32 of the identity + content hash. */
  readonly packId: string;
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  /** 1-based revision (append-only). */
  readonly revision: number;
  /** The prior pack this revision supersedes (absent on revision 1). */
  readonly supersedes?: string;
  /** Always "PROPOSAL" — the single legal status (never auto-published). */
  readonly status: MarketplaceEvidencePackStatus;
  /** The evaluation window (carried verbatim from the scorecard). */
  readonly window: ScorecardWindow;
  /** The composed claims (canonical order: kind, then sourceRefs). */
  readonly claims: readonly EvidenceClaim[];
  /** The scorecard dimensions the scorecard could not score (no applicable evidence). */
  readonly notApplicableScorecardDimensions: readonly ScorecardQualityDimension[];
  /** The ids of every source record composed (sorted, deduplicated). */
  readonly sourceRecordIds: readonly string[];
  /** Injected computation timestamp. */
  readonly computedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
  /** Deterministic content hash (fnv1a32 over canonical JSON; not security). */
  readonly contentHash: string;
}

/** The input of a pack build. */
export interface BuildEvidencePackInput {
  readonly vendorId: VendorId;
  /** The vendor's scorecard (the native source; the window is carried from it). */
  readonly scorecard: VendorScorecard;
  /** The per-vendor reconciliation impacts (structural twins, projected from the real reports). */
  readonly reconciliationImpacts: readonly VendorReconciliationImpact[];
  /** The aggregation measurements (structural twins, projected from the real measurements). */
  readonly aggregationMeasurements: readonly AggregationMeasurementSource[];
  /** Injected computation timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** The prior pack revision (supersession). */
  readonly prior?: MarketplaceEvidencePack;
}

/** The tagged result of a pack build. */
export type EvidencePackBuildResult =
  | { readonly ok: true; readonly pack: MarketplaceEvidencePack }
  | { readonly ok: false; readonly error: FleetError };

/** Stable machine action names emitted by the evidence-pack surface. */
export const MARKETPLACE_EVIDENCE_AUDIT_ACTIONS = frozen({
  /** An evidence pack revision was composed (PROPOSAL-grade). */
  packComposed: "vendors.marketplace.pack.composed",
} as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate one reconciliation impact twin. Returns the failure list (empty = ok). */
function validateReconciliationImpact(
  impact: unknown,
  index: number,
  tenantId: TenantId,
  vendorId: VendorId,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const path = `/reconciliationImpacts/${index}`;
  if (impact === null || typeof impact !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = impact as Record<string, unknown>;
  if (typeof candidate["reportId"] !== "string" || (candidate["reportId"] as string).length === 0) {
    failures.push({ path: `${path}/reportId`, reason: "required" });
  }
  if (candidate["tenantId"] !== tenantId) {
    failures.push({ path: `${path}/tenantId`, reason: "tenant_mismatch" });
  }
  if (candidate["vendorId"] !== vendorId) {
    failures.push({ path: `${path}/vendorId`, reason: "foreign_source" });
  }
  if (!Array.isArray(candidate["byKind"])) {
    failures.push({ path: `${path}/byKind`, reason: "array_required" });
    return failures;
  }
  const byKind = candidate["byKind"] as Record<string, unknown>[];
  for (let i = 0; i < byKind.length; i++) {
    const entry = byKind[i];
    const entryPath = `${path}/byKind/${i}`;
    if (entry === null || typeof entry !== "object") {
      failures.push({ path: entryPath, reason: "object_required" });
      continue;
    }
    const kind = entry["kind"];
    if (
      kind !== "price_mismatch" &&
      kind !== "sla_breach" &&
      kind !== "warranty_gap" &&
      kind !== "undelivered" &&
      kind !== "over_delivered"
    ) {
      failures.push({ path: `${entryPath}/kind`, reason: "unknown_discrepancy_kind" });
    }
    const count = entry["count"];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      failures.push({ path: `${entryPath}/count`, reason: "must_be_integer_at_least_0" });
    } else if (count > 0 && (!Array.isArray(entry["refs"]) || (entry["refs"] as unknown[]).length === 0)) {
      // The citation discipline: a count with no refs is an uncited
      // number — REFUSED, never composed.
      failures.push({ path: `${entryPath}/refs`, reason: "uncited_claim" });
    }
  }
  return failures;
}

/** Validate one aggregation measurement twin. Returns the failure list (empty = ok). */
function validateAggregationMeasurement(
  measurement: unknown,
  index: number,
  tenantId: TenantId,
  vendorId: VendorId,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const path = `/aggregationMeasurements/${index}`;
  if (measurement === null || typeof measurement !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = measurement as Record<string, unknown>;
  for (const field of ["outcomeId", "aggregationId"] as const) {
    if (typeof candidate[field] !== "string" || (candidate[field] as string).length === 0) {
      failures.push({ path: `${path}/${field}`, reason: "required" });
    }
  }
  if (candidate["tenantId"] !== tenantId) {
    failures.push({ path: `${path}/tenantId`, reason: "tenant_mismatch" });
  }
  if (candidate["vendorId"] !== vendorId) {
    failures.push({ path: `${path}/vendorId`, reason: "foreign_source" });
  }
  const coverageRatio = candidate["coverageRatio"];
  if (
    typeof coverageRatio !== "number" ||
    !Number.isFinite(coverageRatio) ||
    coverageRatio < 0 ||
    coverageRatio > 1
  ) {
    failures.push({ path: `${path}/coverageRatio`, reason: "must_be_in_0_1" });
  }
  const onTimeRatio = candidate["onTimeRatio"];
  if (
    onTimeRatio !== null &&
    (typeof onTimeRatio !== "number" || !Number.isFinite(onTimeRatio) || onTimeRatio < 0 || onTimeRatio > 1)
  ) {
    failures.push({ path: `${path}/onTimeRatio`, reason: "must_be_in_0_1_or_null" });
  }
  const servedCount = candidate["servedCount"];
  if (typeof servedCount !== "number" || !Number.isInteger(servedCount) || servedCount < 0) {
    failures.push({ path: `${path}/servedCount`, reason: "must_be_integer_at_least_0" });
  }
  const ordersAggregated = candidate["ordersAggregated"];
  if (typeof ordersAggregated !== "number" || !Number.isInteger(ordersAggregated) || ordersAggregated < 0) {
    failures.push({ path: `${path}/ordersAggregated`, reason: "must_be_integer_at_least_0" });
  }
  if (!Array.isArray(candidate["vendorContributions"])) {
    failures.push({ path: `${path}/vendorContributions`, reason: "array_required" });
  } else {
    const contributions = candidate["vendorContributions"] as Record<string, unknown>[];
    for (let i = 0; i < contributions.length; i++) {
      const entry = contributions[i];
      const entryPath = `${path}/vendorContributions/${i}`;
      if (entry === null || typeof entry !== "object") {
        failures.push({ path: entryPath, reason: "object_required" });
        continue;
      }
      if (typeof entry["vendorId"] !== "string" || (entry["vendorId"] as string).length === 0) {
        failures.push({ path: `${entryPath}/vendorId`, reason: "required" });
      }
      const completedCount = entry["completedCount"];
      if (typeof completedCount !== "number" || !Number.isInteger(completedCount) || completedCount < 0) {
        failures.push({ path: `${entryPath}/completedCount`, reason: "must_be_integer_at_least_0" });
      }
      if (!Array.isArray(entry["memberRefs"])) {
        failures.push({ path: `${entryPath}/memberRefs`, reason: "array_required" });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Claim composition (pure, fully cited)
// ---------------------------------------------------------------------------

/**
 * Compose the pack's claims from the validated sources. PURE and
 * deterministic. Every claim's value is carried VERBATIM from its
 * source record and cites the source record's id plus the refs the
 * source carries for that claim.
 */
function composeClaims(
  scorecard: VendorScorecard,
  reconciliationImpacts: readonly VendorReconciliationImpact[],
  aggregationMeasurements: readonly AggregationMeasurementSource[],
): readonly EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];

  // Scorecard dimension claims: one per APPLICABLE dimension (value
  // !== null); each cites the scorecard id plus the dimension's
  // counted interaction refs.
  for (const dimension of scorecard.dimensions) {
    if (dimension.value === null) continue;
    claims.push(
      frozen({
        kind: `scorecard.${dimension.kind}` as EvidenceClaimKind,
        value: dimension.value,
        sourceRefs: frozenArray([scorecard.scorecardId, ...dimension.countedRefs]),
      }),
    );
  }

  // Reconciliation claims: one per (report, kind) with a positive
  // count; each cites the report id plus the both-side refs of the
  // discrepancies counted.
  for (const impact of reconciliationImpacts) {
    for (const entry of impact.byKind) {
      if (entry.count === 0) continue;
      claims.push(
        frozen({
          kind: `reconciliation.${entry.kind}` as EvidenceClaimKind,
          value: entry.count,
          sourceRefs: frozenArray([impact.reportId, ...entry.refs]),
        }),
      );
    }
  }

  // Aggregation measurement claims: the coverage ratio, the on-time
  // ratio (when measured), and THIS vendor's contribution count (when
  // present). Each cites the measurement id + the aggregation id (+
  // the contributed member refs for contribution claims).
  for (const measurement of aggregationMeasurements) {
    claims.push(
      frozen({
        kind: "aggregation.coverage_ratio" as const,
        value: measurement.coverageRatio,
        sourceRefs: frozenArray([measurement.outcomeId, measurement.aggregationId]),
      }),
    );
    if (measurement.onTimeRatio !== null) {
      claims.push(
        frozen({
          kind: "aggregation.on_time_ratio" as const,
          value: measurement.onTimeRatio,
          sourceRefs: frozenArray([measurement.outcomeId, measurement.aggregationId]),
        }),
      );
    }
    const ownContribution = measurement.vendorContributions.find(
      (c) => c.vendorId === measurement.vendorId,
    );
    if (ownContribution !== undefined && ownContribution.completedCount > 0) {
      claims.push(
        frozen({
          kind: "aggregation.contribution_count" as const,
          value: ownContribution.completedCount,
          sourceRefs: frozenArray([
            measurement.outcomeId,
            measurement.aggregationId,
            ...ownContribution.memberRefs,
          ]),
        }),
      );
    }
  }

  // Canonical claim order: kind, then sourceRefs (joined canonically).
  claims.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const aRefs = a.sourceRefs.join("|");
    const bRefs = b.sourceRefs.join("|");
    return aRefs < bRefs ? -1 : aRefs > bRefs ? 1 : 0;
  });
  return frozenArray(claims);
}

// ---------------------------------------------------------------------------
// The content hash + id
// ---------------------------------------------------------------------------

/** Compute the deterministic content hash of a pack revision. */
function computePackContentHash(content: Omit<MarketplaceEvidencePack, "contentHash" | "packId">): string {
  return fnv1a32Hex(
    canonicalJson({
      tenantId: content.tenantId as string,
      vendorId: content.vendorId as string,
      revision: content.revision,
      supersedes: content.supersedes,
      status: content.status,
      window: content.window,
      claims: content.claims,
      notApplicableScorecardDimensions: content.notApplicableScorecardDimensions,
      sourceRecordIds: content.sourceRecordIds,
      computedAt: content.computedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
}

// ---------------------------------------------------------------------------
// The pure builder (+ audit emission at the boundary)
// ---------------------------------------------------------------------------

/**
 * Compose one marketplace-quality evidence pack revision. PURE and
 * deterministic: the same sources (in any order) plus the same
 * injected `at` produce the byte-identical frozen pack. The only side
 * effect is the audit emission on success.
 *
 * Machine-stable refusals (fail closed):
 *   - a source record from another tenant or another vendor
 *     (`tenant_mismatch` / `foreign_source`);
 *   - a duplicate source record id (`duplicate_source`);
 *   - an uncited claim — a count with no refs (`uncited_claim`).
 *
 * The pack is PROPOSAL-grade: `status` is always `"PROPOSAL"` and this
 * surface provides no publication path (operator review happens
 * outside).
 *
 * @param tenantId the acting tenant (structural isolation)
 * @param input the pack build input
 * @param sink the audit sink (default: no-op)
 * @returns the tagged build result
 */
export function buildMarketplaceEvidencePack(
  tenantId: TenantId,
  input: BuildEvidencePackInput,
  sink: VendorsOutcomeAuditSink = NOOP_VENDORS_OUTCOME_AUDIT_SINK,
): EvidencePackBuildResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.evidencePackInvalid,
        "evidence pack request is invalid",
        { tenantId: SYNTHETIC_SYSTEM_TENANT_ID, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/tenantId", reason: "required" }],
      ),
    };
  }
  if (typeof input?.vendorId !== "string" || input.vendorId.length === 0) {
    failures.push({ path: "/vendorId", reason: "required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.scorecard === null || typeof input?.scorecard !== "object") {
    failures.push({ path: "/scorecard", reason: "object_required" });
  }
  if (!Array.isArray(input?.reconciliationImpacts)) {
    failures.push({ path: "/reconciliationImpacts", reason: "array_required" });
  }
  if (!Array.isArray(input?.aggregationMeasurements)) {
    failures.push({ path: "/aggregationMeasurements", reason: "array_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.evidencePackInvalid,
        "evidence pack request is invalid",
        { tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const vendorId = input.vendorId;

  // The scorecard is the native source and MUST describe this vendor
  // in this tenant.
  const scorecard = input.scorecard;
  if (scorecard.tenantId !== tenantId || scorecard.vendorId !== vendorId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.evidencePackDomain,
        "the scorecard belongs to another vendor or tenant",
        { tenantId, correlationId: input.correlationId },
        "vendors.evidencepack.composition",
        "scorecard_scope_mismatch",
      ),
    };
  }

  // Source validation: every twin must be this tenant's and this
  // vendor's (fail closed, never silently dropped).
  const sourceFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < input.reconciliationImpacts.length; i++) {
    sourceFailures.push(
      ...validateReconciliationImpact(input.reconciliationImpacts[i], i, tenantId, vendorId),
    );
  }
  for (let i = 0; i < input.aggregationMeasurements.length; i++) {
    sourceFailures.push(
      ...validateAggregationMeasurement(input.aggregationMeasurements[i], i, tenantId, vendorId),
    );
  }
  // Duplicate source record ids are refused (append-only composition:
  // a source composed twice is a binding-site error).
  const sourceIds = [
    scorecard.scorecardId,
    ...input.reconciliationImpacts.map((impact) => impact?.reportId ?? ""),
    ...input.aggregationMeasurements.map((measurement) => measurement?.outcomeId ?? ""),
  ];
  const seenSources = new Set<string>();
  for (const id of sourceIds) {
    if (id.length === 0) continue; // already reported as a field failure
    if (seenSources.has(id)) {
      sourceFailures.push({ path: "/sources", reason: "duplicate_source" });
      break;
    }
    seenSources.add(id);
  }
  if (sourceFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.evidencePackInvalid,
        "evidence pack request is invalid",
        { tenantId, correlationId: input.correlationId },
        sourceFailures,
      ),
    };
  }

  // Supersession discipline: a new revision cites the prior.
  let revision = 1;
  let supersedes: string | undefined = undefined;
  if (input.prior !== undefined) {
    if (input.prior.tenantId !== tenantId || input.prior.vendorId !== vendorId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.evidencePackDomain,
          "prior pack belongs to another vendor or tenant",
          { tenantId, correlationId: input.correlationId },
          "vendors.evidencepack.supersession",
          "prior_scope_mismatch",
        ),
      };
    }
    revision = input.prior.revision + 1;
    supersedes = input.prior.packId;
  }

  // Canonical source order (deterministic under input permutations).
  const sortedImpacts = [...input.reconciliationImpacts].sort((a, b) =>
    a.reportId < b.reportId ? -1 : a.reportId > b.reportId ? 1 : 0,
  );
  const sortedMeasurements = [...input.aggregationMeasurements].sort((a, b) =>
    a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0,
  );

  const claims = composeClaims(scorecard, sortedImpacts, sortedMeasurements);
  const notApplicableScorecardDimensions = frozenArray(
    [...scorecard.dimensions]
      .filter((d) => d.value === null)
      .map((d) => d.kind)
      .sort(),
  );
  const sourceRecordIds = frozenArray(
    [...new Set([scorecard.scorecardId, ...sortedImpacts.map((i) => i.reportId), ...sortedMeasurements.map((m) => m.outcomeId)])].sort(),
  );

  const content: Omit<MarketplaceEvidencePack, "contentHash" | "packId"> = frozen({
    tenantId,
    vendorId,
    revision,
    supersedes,
    status: "PROPOSAL" as const,
    window: frozen({ ...scorecard.window }),
    claims,
    notApplicableScorecardDimensions,
    sourceRecordIds,
    computedAt: input.at,
    schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
    modelVersion: EVIDENCE_PACK_MODEL_VERSION,
  });
  const contentHash = computePackContentHash(content);
  const packId = `mep_${fnv1a32Hex(
    canonicalJson({ tenantId: tenantId as string, vendorId: vendorId as string, revision, contentHash }),
  )}`;
  const pack: MarketplaceEvidencePack = frozen({ ...content, packId, contentHash });

  sink.append(
    frozen({
      action: MARKETPLACE_EVIDENCE_AUDIT_ACTIONS.packComposed,
      tenantId,
      subject: packId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      details: {
        vendorId: vendorId as string,
        revision,
        supersedes: supersedes ?? null,
        status: pack.status,
        window: pack.window,
        claimCount: pack.claims.length,
        claimKinds: pack.claims.map((c) => c.kind),
        sourceRecordIds: pack.sourceRecordIds,
        contentHash: pack.contentHash,
        proposalGrade: true,
      },
    }),
  );

  return { ok: true, pack };
}

// ---------------------------------------------------------------------------
// The append-only pack ledger (per-tenant partition)
// ---------------------------------------------------------------------------

/** The append-only, per-tenant evidence pack ledger. */
export interface MarketplaceEvidencePackLedger {
  readonly tenantId: TenantId;
  /** Entries are append-only; nothing is ever rewritten. */
  readonly entries: readonly MarketplaceEvidencePack[];
}

/** The tagged result of a ledger append. */
export type EvidencePackLedgerAppend =
  | { readonly ok: true; readonly ledger: MarketplaceEvidencePackLedger }
  | { readonly ok: false; readonly error: FleetError };

/** Create an empty evidence pack ledger (one tenant's partition). */
export function createMarketplaceEvidencePackLedger(tenantId: TenantId): MarketplaceEvidencePackLedger {
  return frozen({ tenantId, entries: frozenArray([]) });
}

/**
 * Append a pack revision to the ledger. Returns a NEW ledger; the
 * input is untouched. Enforces the append-only supersession
 * discipline (the scorecard-ledger rules): tenant scope, no duplicate
 * ids, sequential revisions with a `supersedes` chain.
 */
export function appendMarketplaceEvidencePack(
  ledger: MarketplaceEvidencePackLedger,
  pack: MarketplaceEvidencePack,
): EvidencePackLedgerAppend {
  if (pack.tenantId !== ledger.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.evidencePackDomain,
        "pack tenantId does not match the ledger scope",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "vendors.evidencepack.ledger",
        "tenant_mismatch",
      ),
    };
  }
  if (ledger.entries.some((e) => e.packId === pack.packId)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.evidencePackDomain,
        "pack id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "vendors.evidencepack.ledger",
        "duplicate_pack",
      ),
    };
  }
  const vendorHistory = ledger.entries.filter((e) => e.vendorId === pack.vendorId);
  if (pack.revision === 1) {
    if (vendorHistory.length > 0) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.evidencePackDomain,
          "revision 1 appended after an existing history for this vendor",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.evidencepack.ledger",
          "revision_conflict",
        ),
      };
    }
  } else {
    const priorRevision = vendorHistory.find((e) => e.revision === pack.revision - 1);
    if (priorRevision === undefined) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.evidencePackDomain,
          "pack revision is not sequential in this ledger",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.evidencepack.ledger",
          "revision_gap",
        ),
      };
    }
    if (pack.supersedes !== priorRevision.packId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.evidencePackDomain,
          "pack supersedes does not cite the ledger's prior revision",
          { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "vendors.evidencepack.ledger",
          "supersedes_mismatch",
        ),
      };
    }
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([...ledger.entries, pack]),
    }),
  };
}

/**
 * The latest pack revision of a vendor in THIS tenant's partition. A
 * vendor that exists only in another tenant's partition is
 * indistinguishable from an unknown vendor (undefined — no existence
 * side channel).
 */
export function resolveLatestPack(
  ledger: MarketplaceEvidencePackLedger,
  vendorId: VendorId,
): MarketplaceEvidencePack | undefined {
  const history = ledger.entries
    .filter((e) => e.vendorId === vendorId)
    .sort((a, b) => a.revision - b.revision);
  return history.length === 0 ? undefined : history[history.length - 1];
}

/** The full revision history of one vendor's packs (revision order; own partition only). */
export function listPackHistory(
  ledger: MarketplaceEvidencePackLedger,
  vendorId: VendorId,
): readonly MarketplaceEvidencePack[] {
  return frozenArray(
    [...ledger.entries]
      .filter((e) => e.vendorId === vendorId)
      .sort((a, b) => a.revision - b.revision),
  );
}
