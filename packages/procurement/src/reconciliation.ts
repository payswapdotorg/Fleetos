/**
 * @fleetos/procurement — W072 D2: commercial reconciliation.
 *
 * A reconciliation pass over demand -> quote -> acceptance -> delivery
 * chains, consumed STRUCTURALLY: every chain link carries typed
 * commercial facts (agreed price/SLA/warranty vs delivered evidence),
 * injected by the caller. The twin types below are structurally
 * satisfiable by the REAL W032 surfaces (`ProcurementDemand`, accepted
 * `Quote`, the quote-ledger acceptance entries) plus the injected
 * delivery evidence — proven by test in this package's suite (the
 * binding site projects the real records field-for-field).
 *
 * Discrepancies classify machine-stably, with the refs of BOTH sides
 * carried verbatim:
 *
 *   - `price_mismatch`  — the delivered unit price differs from the
 *                         agreed quote's unit price;
 *   - `sla_breach`      — the delivered SLA coverage is below the agreed;
 *   - `warranty_gap`    — the delivered warranty days are below the agreed;
 *   - `undelivered`     — an accepted chain with no delivery evidence, or
 *                         a delivery short of the demanded quantity;
 *   - `over_delivered`  — a delivery exceeding the demanded quantity, or
 *                         any delivery on a chain that was never accepted
 *                         (delivered without an agreed contract).
 *
 * READ-ONLY: reconciliation is a REPORT surface, never a mutation path.
 * `runCommercialReconciliation` accepts readonly inputs, mutates
 * nothing, writes no store, and returns a new frozen report. The only
 * side effect is the audit emission (append-only logging of the report's
 * computation — the W011/W032 pattern: consequential derivations are
 * auditable; the domain records themselves are never touched).
 *
 * Determinism: the report is a pure function of its inputs — the same
 * chains (in any order) plus the same injected `at` produce the
 * byte-identical report (content-addressed reportId, canonical
 * discrepancy ordering, canonical chain summaries).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, FleetError, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { ProcurementAuditSink } from "./audit-seam";
import { NOOP_PROCUREMENT_AUDIT_SINK } from "./audit-seam";
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

/** The reconciliation report schema version. */
export const RECONCILIATION_SCHEMA_VERSION = 1 as const;

/** The reconciliation report model version. */
export const RECONCILIATION_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Machine-stable discrepancy classification
// ---------------------------------------------------------------------------

/**
 * The machine-stable discrepancy kinds. The list order below is the
 * CANONICAL classification order (reports sort discrepancies by
 * kind, then refs).
 */
export type CommercialDiscrepancyKind =
  | "price_mismatch"
  | "sla_breach"
  | "warranty_gap"
  | "undelivered"
  | "over_delivered";

/** All discrepancy kinds in canonical order. */
export const COMMERCIAL_DISCREPANCY_KINDS: readonly CommercialDiscrepancyKind[] = Object.freeze([
  "price_mismatch",
  "sla_breach",
  "warranty_gap",
  "undelivered",
  "over_delivered",
] as const);

/** The canonical kind order (for deterministic report ordering). */
function kindOrder(kind: CommercialDiscrepancyKind): number {
  return COMMERCIAL_DISCREPANCY_KINDS.indexOf(kind);
}

// ---------------------------------------------------------------------------
// Chain sources (STRUCTURAL twins of the frozen surfaces)
// ---------------------------------------------------------------------------

/**
 * The demand link of one commercial chain (STRUCTURAL twin of
 * `ProcurementDemand`'s commercial facts). Injected verbatim by the
 * binding site.
 */
export interface CommercialChainDemandFacts {
  readonly tenantId: TenantId;
  /** The demand id (the chain's machine-stable origin ref). */
  readonly demandId: string;
  /** The demanded quantity (>= 1). */
  readonly quantity: number;
}

/**
 * The quote link (STRUCTURAL twin of the quote's agreed terms). Null
 * when the demand was never quoted (the chain is then summarized as
 * `unquoted` — no agreed side exists to reconcile against).
 */
export interface CommercialChainQuoteFacts {
  /** The quote id (the agreed side's machine-stable ref). */
  readonly quoteId: string;
  /** The vendor issuing the quote. */
  readonly vendorId: VendorId;
  /** The agreed unit price (USD). */
  readonly unitPriceUsd: number;
  /** The agreed SLA coverage in [0, 1]. */
  readonly slaCoverage: number;
  /** The agreed warranty duration (days). */
  readonly warrantyDays: number;
}

/**
 * The delivery link (the delivered evidence, injected). Null when no
 * delivery evidence exists for the chain.
 */
export interface CommercialChainDeliveryFacts {
  /** The delivery id (the delivered side's machine-stable ref). */
  readonly deliveryId: string;
  /** The delivered quantity (>= 0). */
  readonly deliveredQuantity: number;
  /** The delivered unit price (USD). */
  readonly deliveredUnitPriceUsd: number;
  /** The delivered SLA coverage in [0, 1]. */
  readonly deliveredSlaCoverage: number;
  /** The delivered warranty duration (days). */
  readonly deliveredWarrantyDays: number;
  /** When the delivery occurred (injected). */
  readonly deliveredAt: string;
}

/** One demand->quote->acceptance->delivery chain, consumed structurally. */
export interface CommercialChainSource {
  readonly demand: CommercialChainDemandFacts;
  /** The quote link (null: never quoted). */
  readonly quote: CommercialChainQuoteFacts | null;
  /** True when the quote was accepted (the agreed contract exists). */
  readonly accepted: boolean;
  /** The delivery link (null: no delivery evidence). */
  readonly delivery: CommercialChainDeliveryFacts | null;
}

/** The chain's derived status (machine-stable summary of the links). */
export type CommercialChainStatus = "unquoted" | "unaccepted" | "delivered" | "agreed";

/** All chain statuses in canonical order. */
export const COMMERCIAL_CHAIN_STATUSES: readonly CommercialChainStatus[] = Object.freeze([
  "unquoted",
  "unaccepted",
  "delivered",
  "agreed",
] as const);

// ---------------------------------------------------------------------------
// The discrepancy record (both sides verbatim)
// ---------------------------------------------------------------------------

/**
 * One classified discrepancy. Carries the refs of BOTH sides verbatim
 * (the agreed side's quote id, the delivered side's delivery id — null
 * when the delivered side is absent) plus the typed fact snapshots of
 * both sides.
 */
export interface CommercialDiscrepancy {
  readonly kind: CommercialDiscrepancyKind;
  /** The vendor the discrepancy is about (from the quote). */
  readonly vendorId: VendorId;
  /** The chain origin ref (the demand id), verbatim. */
  readonly demandRef: string;
  /** The agreed side's ref (the quote id), verbatim. */
  readonly quoteRef: string;
  /** The delivered side's ref (the delivery id), verbatim; null when absent. */
  readonly deliveryRef: string | null;
  /** The agreed facts (typed snapshot, verbatim). */
  readonly agreed: Readonly<{
    readonly quantity: number;
    readonly unitPriceUsd: number;
    readonly slaCoverage: number;
    readonly warrantyDays: number;
  }>;
  /** The delivered facts (typed snapshot, verbatim); null when absent. */
  readonly delivered: Readonly<{
    readonly quantity: number;
    readonly unitPriceUsd: number;
    readonly slaCoverage: number;
    readonly warrantyDays: number;
  }> | null;
}

// ---------------------------------------------------------------------------
// The report record
// ---------------------------------------------------------------------------

/**
 * A commercial reconciliation report: the READ-ONLY outcome of one
 * reconciliation pass. Frozen at construction; content-addressed
 * (identical content produces the identical reportId). Nothing in this
 * surface writes back to any demand, quote, ledger, or store.
 */
export interface CommercialReconciliationReport extends TenantScoped {
  /** Deterministic id: `recon_` + fnv1a32 of the report content. */
  readonly reportId: string;
  readonly tenantId: TenantId;
  /** The number of reconciled chains. */
  readonly chainCount: number;
  /** Per-status chain counts (machine-stable). */
  readonly chainStatusCounts: Readonly<Record<CommercialChainStatus, number>>;
  /** The classified discrepancies (canonical order). */
  readonly discrepancies: readonly CommercialDiscrepancy[];
  /** The total discrepancy count. */
  readonly discrepancyCount: number;
  /** Per-kind discrepancy counts (machine-stable). */
  readonly byKind: Readonly<Record<CommercialDiscrepancyKind, number>>;
  /** Injected computation timestamp. */
  readonly computedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
  /** Deterministic content hash (fnv1a32 over canonical JSON; not security). */
  readonly contentHash: string;
}

/** Options of a reconciliation run. */
export interface ReconciliationOptions {
  /** Injected run timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** Audit sink (default: no-op). The report computation is consequential — it audits. */
  readonly auditSink?: ProcurementAuditSink;
}

/** The tagged result of a reconciliation run. */
export type ReconciliationResult =
  | { readonly ok: true; readonly report: CommercialReconciliationReport }
  | { readonly ok: false; readonly error: FleetError };

/** Stable machine action names emitted by the reconciliation surface. */
export const RECONCILIATION_AUDIT_ACTIONS = frozen({
  /** A reconciliation report was computed (READ-ONLY derivation). */
  reportComputed: "procurement.reconciliation.computed",
} as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate one chain source. Returns the failure list (empty = ok). */
function validateChain(
  chain: unknown,
  index: number,
  tenantId: TenantId,
): { path: string; reason: string }[] {
  const failures: { path: string; reason: string }[] = [];
  const path = `/chains/${index}`;
  if (chain === null || typeof chain !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = chain as Record<string, unknown>;
  const demand = candidate["demand"];
  if (demand === null || typeof demand !== "object") {
    failures.push({ path: `${path}/demand`, reason: "object_required" });
    return failures;
  }
  const demandRecord = demand as Record<string, unknown>;
  if (demandRecord["tenantId"] !== tenantId) {
    failures.push({ path: `${path}/demand/tenantId`, reason: "tenant_mismatch" });
  }
  if (typeof demandRecord["demandId"] !== "string" || (demandRecord["demandId"] as string).length === 0) {
    failures.push({ path: `${path}/demand/demandId`, reason: "required" });
  }
  const quantity = demandRecord["quantity"];
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    failures.push({ path: `${path}/demand/quantity`, reason: "must_be_integer_at_least_1" });
  }

  if (typeof candidate["accepted"] !== "boolean") {
    failures.push({ path: `${path}/accepted`, reason: "boolean_required" });
  }

  const quote = candidate["quote"];
  if (quote !== null && quote !== undefined) {
    if (typeof quote !== "object") {
      failures.push({ path: `${path}/quote`, reason: "object_or_null_required" });
    } else {
      const quoteRecord = quote as Record<string, unknown>;
      if (typeof quoteRecord["quoteId"] !== "string" || (quoteRecord["quoteId"] as string).length === 0) {
        failures.push({ path: `${path}/quote/quoteId`, reason: "required" });
      }
      if (typeof quoteRecord["vendorId"] !== "string" || (quoteRecord["vendorId"] as string).length === 0) {
        failures.push({ path: `${path}/quote/vendorId`, reason: "required" });
      }
      if (
        typeof quoteRecord["unitPriceUsd"] !== "number" ||
        !Number.isFinite(quoteRecord["unitPriceUsd"] as number) ||
        (quoteRecord["unitPriceUsd"] as number) < 0
      ) {
        failures.push({ path: `${path}/quote/unitPriceUsd`, reason: "must_be_non_negative" });
      }
      if (
        typeof quoteRecord["slaCoverage"] !== "number" ||
        !Number.isFinite(quoteRecord["slaCoverage"] as number) ||
        (quoteRecord["slaCoverage"] as number) < 0 ||
        (quoteRecord["slaCoverage"] as number) > 1
      ) {
        failures.push({ path: `${path}/quote/slaCoverage`, reason: "must_be_in_0_1" });
      }
      if (
        typeof quoteRecord["warrantyDays"] !== "number" ||
        !Number.isFinite(quoteRecord["warrantyDays"] as number) ||
        (quoteRecord["warrantyDays"] as number) < 0
      ) {
        failures.push({ path: `${path}/quote/warrantyDays`, reason: "must_be_non_negative" });
      }
    }
  } else if (candidate["accepted"] === true) {
    failures.push({ path: `${path}/quote`, reason: "required_when_accepted" });
  }

  const delivery = candidate["delivery"];
  if (delivery !== null && delivery !== undefined) {
    if (typeof delivery !== "object") {
      failures.push({ path: `${path}/delivery`, reason: "object_or_null_required" });
    } else {
      const deliveryRecord = delivery as Record<string, unknown>;
      if (
        typeof deliveryRecord["deliveryId"] !== "string" ||
        (deliveryRecord["deliveryId"] as string).length === 0
      ) {
        failures.push({ path: `${path}/delivery/deliveryId`, reason: "required" });
      }
      const deliveredQuantity = deliveryRecord["deliveredQuantity"];
      if (
        typeof deliveredQuantity !== "number" ||
        !Number.isInteger(deliveredQuantity) ||
        deliveredQuantity < 0
      ) {
        failures.push({ path: `${path}/delivery/deliveredQuantity`, reason: "must_be_integer_at_least_0" });
      }
      if (
        typeof deliveryRecord["deliveredUnitPriceUsd"] !== "number" ||
        !Number.isFinite(deliveryRecord["deliveredUnitPriceUsd"] as number) ||
        (deliveryRecord["deliveredUnitPriceUsd"] as number) < 0
      ) {
        failures.push({ path: `${path}/delivery/deliveredUnitPriceUsd`, reason: "must_be_non_negative" });
      }
      if (
        typeof deliveryRecord["deliveredSlaCoverage"] !== "number" ||
        !Number.isFinite(deliveryRecord["deliveredSlaCoverage"] as number) ||
        (deliveryRecord["deliveredSlaCoverage"] as number) < 0 ||
        (deliveryRecord["deliveredSlaCoverage"] as number) > 1
      ) {
        failures.push({ path: `${path}/delivery/deliveredSlaCoverage`, reason: "must_be_in_0_1" });
      }
      if (
        typeof deliveryRecord["deliveredWarrantyDays"] !== "number" ||
        !Number.isFinite(deliveryRecord["deliveredWarrantyDays"] as number) ||
        (deliveryRecord["deliveredWarrantyDays"] as number) < 0
      ) {
        failures.push({ path: `${path}/delivery/deliveredWarrantyDays`, reason: "must_be_non_negative" });
      }
      if (
        typeof deliveryRecord["deliveredAt"] !== "string" ||
        !looksLikeIso(deliveryRecord["deliveredAt"] as string)
      ) {
        failures.push({ path: `${path}/delivery/deliveredAt`, reason: "not_iso" });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Classification (pure)
// ---------------------------------------------------------------------------

/** Derive one chain's machine-stable status. */
function chainStatus(chain: CommercialChainSource): CommercialChainStatus {
  if (chain.quote === null) return "unquoted";
  if (!chain.accepted) return "unaccepted";
  return chain.delivery === null ? "agreed" : "delivered";
}

/**
 * Classify one chain's discrepancies. PURE and deterministic. Both-side
 * refs and fact snapshots are carried verbatim.
 */
function classifyChain(chain: CommercialChainSource): readonly CommercialDiscrepancy[] {
  if (chain.quote === null) {
    // No agreed side exists — nothing to reconcile against (the chain
    // status carries the fact; documented judgment call).
    return [];
  }
  const quote = chain.quote;
  const agreed = {
    quantity: chain.demand.quantity,
    unitPriceUsd: quote.unitPriceUsd,
    slaCoverage: quote.slaCoverage,
    warrantyDays: quote.warrantyDays,
  };
  const delivered =
    chain.delivery === null
      ? null
      : {
          quantity: chain.delivery.deliveredQuantity,
          unitPriceUsd: chain.delivery.deliveredUnitPriceUsd,
          slaCoverage: chain.delivery.deliveredSlaCoverage,
          warrantyDays: chain.delivery.deliveredWarrantyDays,
        };
  const base = {
    vendorId: quote.vendorId,
    demandRef: chain.demand.demandId,
    quoteRef: quote.quoteId,
    deliveryRef: chain.delivery === null ? null : chain.delivery.deliveryId,
  };

  const discrepancies: CommercialDiscrepancy[] = [];

  if (!chain.accepted) {
    // Delivered without an agreed contract: any delivery is
    // over-delivery (the agreed quantity is zero).
    if (chain.delivery !== null) {
      discrepancies.push(frozen({ ...base, kind: "over_delivered", agreed, delivered }));
    }
    return discrepancies;
  }

  // Accepted chains: the five-kind classification.
  if (chain.delivery === null || chain.delivery.deliveredQuantity < chain.demand.quantity) {
    discrepancies.push(frozen({ ...base, kind: "undelivered", agreed, delivered }));
  }
  if (chain.delivery !== null && chain.delivery.deliveredQuantity > chain.demand.quantity) {
    discrepancies.push(frozen({ ...base, kind: "over_delivered", agreed, delivered }));
  }
  if (chain.delivery !== null && chain.delivery.deliveredUnitPriceUsd !== quote.unitPriceUsd) {
    discrepancies.push(frozen({ ...base, kind: "price_mismatch", agreed, delivered }));
  }
  if (chain.delivery !== null && chain.delivery.deliveredSlaCoverage < quote.slaCoverage) {
    discrepancies.push(frozen({ ...base, kind: "sla_breach", agreed, delivered }));
  }
  if (chain.delivery !== null && chain.delivery.deliveredWarrantyDays < quote.warrantyDays) {
    discrepancies.push(frozen({ ...base, kind: "warranty_gap", agreed, delivered }));
  }
  return discrepancies;
}

// ---------------------------------------------------------------------------
// The reconciliation run (READ-ONLY)
// ---------------------------------------------------------------------------

/**
 * Run one commercial reconciliation pass over the injected chains.
 * READ-ONLY: the chains are never mutated, no store is touched, and the
 * result is a new frozen report. DETERMINISTIC: chain input order never
 * matters (canonical discrepancy ordering; status counts over the full
 * set); the same inputs plus the same `at` produce the byte-identical
 * report (content-addressed reportId).
 *
 * @param tenantId the acting tenant (the report's scope)
 * @param chains the demand->quote->acceptance->delivery chains (injected)
 * @param options the run options (at, correlationId, audit sink)
 * @returns the tagged reconciliation result
 */
export function runCommercialReconciliation(
  tenantId: TenantId,
  chains: readonly CommercialChainSource[],
  options: ReconciliationOptions,
): ReconciliationResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(chains) || chains.length === 0) {
    failures.push({ path: "/chains", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reconciliationInvalid,
        "reconciliation request is invalid",
        {
          tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const chainFailures: { path: string; reason: string }[] = [];
  for (let i = 0; i < chains.length; i++) {
    chainFailures.push(...validateChain(chains[i], i, tenantId));
  }
  // Duplicate demand refs (the chain identity) are refused.
  const demandIds = chains.map((c) => c?.demand?.demandId ?? "");
  const seen = new Set<string>();
  for (const id of demandIds) {
    if (id.length === 0) continue; // already reported as a field failure
    if (seen.has(id)) {
      chainFailures.push({ path: "/chains", reason: "duplicate_demand_ref" });
      break;
    }
    seen.add(id);
  }
  if (chainFailures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.reconciliationInvalid,
        "reconciliation request is invalid",
        { tenantId, correlationId: options.correlationId },
        chainFailures,
      ),
    };
  }

  // Canonical chain order (deterministic under permutations).
  const sortedChains = [...chains].sort((a, b) =>
    a.demand.demandId < b.demand.demandId ? -1 : a.demand.demandId > b.demand.demandId ? 1 : 0,
  );

  const chainStatusCounts: Record<CommercialChainStatus, number> = {
    unquoted: 0,
    unaccepted: 0,
    delivered: 0,
    agreed: 0,
  };
  for (const chain of sortedChains) {
    chainStatusCounts[chainStatus(chain)] += 1;
  }

  const discrepancies = sortedChains
    .flatMap((chain) => [...classifyChain(chain)])
    .sort((a, b) => {
      const byKind = kindOrder(a.kind) - kindOrder(b.kind);
      if (byKind !== 0) return byKind;
      if (a.demandRef !== b.demandRef) return a.demandRef < b.demandRef ? -1 : 1;
      if (a.quoteRef !== b.quoteRef) return a.quoteRef < b.quoteRef ? -1 : 1;
      const aDelivery = a.deliveryRef ?? "";
      const bDelivery = b.deliveryRef ?? "";
      return aDelivery < bDelivery ? -1 : aDelivery > bDelivery ? 1 : 0;
    });

  const byKind: Record<CommercialDiscrepancyKind, number> = {
    price_mismatch: 0,
    sla_breach: 0,
    warranty_gap: 0,
    undelivered: 0,
    over_delivered: 0,
  };
  for (const discrepancy of discrepancies) {
    byKind[discrepancy.kind] += 1;
  }

  const content: Omit<CommercialReconciliationReport, "contentHash" | "reportId"> = frozen({
    tenantId,
    chainCount: sortedChains.length,
    chainStatusCounts: frozen(chainStatusCounts),
    discrepancies: frozenArray(discrepancies),
    discrepancyCount: discrepancies.length,
    byKind: frozen(byKind),
    computedAt: options.at,
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    modelVersion: RECONCILIATION_MODEL_VERSION,
  });
  const contentHash = fnv1a32Hex(
    canonicalJson({
      tenantId: content.tenantId as string,
      chainCount: content.chainCount,
      chainStatusCounts: content.chainStatusCounts,
      discrepancies: content.discrepancies,
      byKind: content.byKind,
      computedAt: content.computedAt,
      schemaVersion: content.schemaVersion,
      modelVersion: content.modelVersion,
    }),
  );
  const reportId = `recon_${fnv1a32Hex(
    canonicalJson({ tenantId: tenantId as string, contentHash }),
  )}`;
  const report: CommercialReconciliationReport = frozen({ ...content, reportId, contentHash });

  (options.auditSink ?? NOOP_PROCUREMENT_AUDIT_SINK).append(
    frozen({
      action: RECONCILIATION_AUDIT_ACTIONS.reportComputed,
      tenantId,
      subject: reportId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        chainCount: report.chainCount,
        chainStatusCounts: report.chainStatusCounts,
        discrepancyCount: report.discrepancyCount,
        byKind: report.byKind,
        contentHash: report.contentHash,
        readOnly: true,
      },
    }),
  );

  return { ok: true, report };
}
