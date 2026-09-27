/**
 * @fleetos/procurement — D3: versioned Quote contracts + acceptance +
 * aggregation.
 *
 * The flow (per `spec/procurement/PROCUREMENT-EXCHANGE.md`):
 *   demand -> matching -> quote -> acceptance -> fulfillment ->
 *   delivery -> verification.
 *
 * Quotes are VERSIONED records (append-only ledger with supersession —
 * the "versioned-interpretation discipline" from `spec/ARCHITECTURE-LOCK.md`
 * item 3). A new quote revision is a NEW record; the prior is never
 * rewritten. Supersession is recorded on the NEW record (`supersedes`
 * pointing at the prior id).
 *
 * Quote acceptance is a PROPOSAL-GATED transition (never automatic): the
 * `acceptQuote` operation is the explicit acceptance step. Acceptance is
 * a one-way transition (DRAFT -> ISSUED -> ACCEPTED -> SUPERSEDED is the
 * legal path). Re-issuing a quote (e.g. updated price) creates a NEW
 * revision that supersedes the prior; the prior's acceptance is void.
 *
 * Compatible-order aggregation: when two demands share a compatible
 * (vendor, deliveryArea, deadline-window) tuple, they may be aggregated
 * into one aggregated order before the customer deadline. The
 * aggregation is deterministic (group by the tuple, sort member demand
 * ids). Individual customer contracts remain auditable: every aggregated
 * order traces to its member demands (memberDemandIds).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type { CorrelationId, TenantId, VendorId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { ProcurementDemand } from "./demand";
import type { VendorMatch } from "./matching";
import type { ProcurementAuditSink } from "./audit-seam";
import { NOOP_PROCUREMENT_AUDIT_SINK, PROCUREMENT_AUDIT_ACTIONS } from "./audit-seam";
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

/** The quote schema version. */
export const QUOTE_SCHEMA_VERSION = 1 as const;

/** The quote model version. */
export const QUOTE_MODEL_VERSION = 1 as const;

/** The aggregation schema version. */
export const AGGREGATION_SCHEMA_VERSION = 1 as const;

/** The aggregation model version. */
export const AGGREGATION_MODEL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Quote lifecycle
// ---------------------------------------------------------------------------

/** The lifecycle of a quote (per spec/procurement/PROCUREMENT-EXCHANGE.md). */
export type QuoteStatus = "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED";

/** The legal status transitions for a quote. */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = Object.freeze({
  DRAFT: Object.freeze(["ISSUED", "REJECTED"] as const),
  ISSUED: Object.freeze(["ACCEPTED", "SUPERSEDED", "REJECTED"] as const),
  ACCEPTED: Object.freeze(["SUPERSEDED"] as const),
  SUPERSEDED: Object.freeze([] as const),
  REJECTED: Object.freeze([] as const),
});

/** Pure transition predicate: true when `from -> to` is legal. */
export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  const allowed = QUOTE_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// The Quote record
// ---------------------------------------------------------------------------

/**
 * A versioned Quote: a vendor's binding offer to fulfill a demand, at
 * one immutable revision. Frozen at construction; supersession creates
 * a NEW revision (the prior is never rewritten).
 */
export interface Quote extends TenantScoped {
  /** Deterministic id: `qt_<demandId>_<vendorId>_<version>` short-hash. */
  readonly quoteId: string;
  readonly tenantId: TenantId;
  /** The demand this quote fulfills. */
  readonly demandId: string;
  /** The vendor issuing the quote. */
  readonly vendorId: VendorId;
  /** The matched capability id (when one was matched). */
  readonly matchedCapabilityId: string | null;
  /** 1-based lineage position for (demandId, vendorId). */
  readonly quoteVersion: number;
  /** The prior quote in this lineage, when re-quoting. */
  readonly supersedes?: string;
  /** The quoted unit price (USD). */
  readonly unitPriceUsd: number;
  /** The quoted total price (USD) = unitPriceUsd * demand.quantity. */
  readonly totalPriceUsd: number;
  /** The quoted lead time (days). */
  readonly leadTimeDays: number;
  /** The quoted warranty duration (days). */
  readonly warrantyDays: number;
  /** The quoted SLA coverage in [0, 1]. */
  readonly slaCoverage: number;
  /** The lifecycle status. */
  readonly status: QuoteStatus;
  /** Injected issuance timestamp. */
  readonly issuedAt: string;
  /** Injected acceptance timestamp (when status === ACCEPTED). */
  readonly acceptedAt?: string;
  /** The quote payload schema version. */
  readonly schemaVersion: number;
  /** The quote model version. */
  readonly modelVersion: number;
}

/** The input of a quote issuance (revision 1, DRAFT -> ISSUED). */
export interface IssueQuoteInput {
  readonly demand: ProcurementDemand;
  readonly match: VendorMatch;
  /** The quoted unit price (USD). */
  readonly unitPriceUsd: number;
  /** The quoted lead time (days). */
  readonly leadTimeDays: number;
  /** The quoted warranty duration (days). */
  readonly warrantyDays: number;
  /** The quoted SLA coverage in [0, 1]. */
  readonly slaCoverage: number;
  /** Injected issuance timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
}

/** The tagged result of a quote operation. */
export type QuoteResult =
  | { readonly ok: true; readonly quote: Quote }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/** The append-only quote ledger. */
export interface QuoteLedger {
  readonly tenantId: TenantId;
  /** Entries are append-only; nothing is ever rewritten. */
  readonly entries: readonly QuoteLedgerEntry[];
}

/** One append-only quote-ledger entry. */
export type QuoteLedgerEntry =
  | { readonly kind: "quote"; readonly quote: Quote }
  | { readonly kind: "acceptance"; readonly acceptance: QuoteAcceptance }
  | { readonly kind: "supersession"; readonly supersession: QuoteSupersession };

/** A recorded acceptance (PROPOSAL-GATED — never automatic). */
export interface QuoteAcceptance {
  readonly quoteId: string;
  /** Injected acceptance timestamp. */
  readonly acceptedAt: string;
  readonly correlationId: CorrelationId;
}

/** A recorded supersession (a later revision supersedes this one). */
export interface QuoteSupersession {
  readonly quoteId: string;
  /** The new quote's id. */
  readonly supersededBy: string;
  readonly supersededAt: string;
  readonly correlationId: CorrelationId;
}

/** Create an empty quote ledger. */
export function createQuoteLedger(tenantId: TenantId): QuoteLedger {
  return frozen({ tenantId, entries: frozenArray([]) });
}

/** The derived status of a quote record. */
export type QuoteDerivedStatus = QuoteStatus | "unknown";

/**
 * The derived status of a quote record in the ledger: ACTIVE (current
 * revision of its lineage, ISSUED or ACCEPTED — caller checks `status`),
 * SUPERSEDED (a later revision follows), or "unknown" (not in the ledger).
 */
export function quoteStatus(ledger: QuoteLedger, quoteId: string): QuoteDerivedStatus {
  const known = ledger.entries.some(
    (e) => e.kind === "quote" && e.quote.quoteId === quoteId,
  );
  if (!known) return "unknown";
  const superseded = ledger.entries.some(
    (e) => e.kind === "quote" && e.quote.supersedes === quoteId,
  );
  if (superseded) return "SUPERSEDED";
  // Find the quote's own status.
  const quote = ledger.entries
    .filter((e): e is Extract<QuoteLedgerEntry, { kind: "quote" }> => e.kind === "quote")
    .map((e) => e.quote)
    .find((q) => q.quoteId === quoteId);
  return quote?.status ?? "unknown";
}

/**
 * Append a quote to the ledger. Returns a NEW ledger; the input is
 * untouched. Rejects scope mismatches and duplicate ids.
 */
export function appendQuote(
  ledger: QuoteLedger,
  quote: Quote,
):
  | { ok: true; ledger: QuoteLedger }
  | { ok: false; error: ReturnType<typeof makeDomainError> } {
  if (quote.tenantId !== ledger.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote tenantId does not match the ledger scope",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "procurement.quote.ledger",
        "tenant_mismatch",
      ),
    };
  }
  if (
    ledger.entries.some(
      (e) => e.kind === "quote" && e.quote.quoteId === quote.quoteId,
    )
  ) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
        "procurement.quote.ledger",
        "duplicate_quote_id",
      ),
    };
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([
        ...ledger.entries,
        frozen({ kind: "quote" as const, quote }),
      ]),
    }),
  };
}

/**
 * Issue a quote (revision 1, DRAFT -> ISSUED). Pure builder + audit
 * emission. The quote is created in the ISSUED status (the DRAFT state
 * is internal to the vendor — FleetOS only sees issued quotes).
 *
 * @param input the issuance input
 * @param sink the audit sink (default: no-op)
 * @returns the tagged quote result
 */
export function issueQuote(
  input: IssueQuoteInput,
  sink: ProcurementAuditSink = NOOP_PROCUREMENT_AUDIT_SINK,
): QuoteResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof input?.correlationId !== "string" || input.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (typeof input?.demand !== "object" || input?.demand === null) {
    failures.push({ path: "/demand", reason: "required" });
  }
  if (typeof input?.match !== "object" || input?.match === null) {
    failures.push({ path: "/match", reason: "required" });
  }
  if (
    typeof input?.unitPriceUsd !== "number" ||
    !Number.isFinite(input.unitPriceUsd) ||
    input.unitPriceUsd < 0
  ) {
    failures.push({ path: "/unitPriceUsd", reason: "must_be_non_negative" });
  }
  if (
    typeof input?.leadTimeDays !== "number" ||
    !Number.isFinite(input.leadTimeDays) ||
    input.leadTimeDays < 0
  ) {
    failures.push({ path: "/leadTimeDays", reason: "must_be_non_negative" });
  }
  if (
    typeof input?.warrantyDays !== "number" ||
    !Number.isFinite(input.warrantyDays) ||
    input.warrantyDays < 0
  ) {
    failures.push({ path: "/warrantyDays", reason: "must_be_non_negative" });
  }
  if (
    typeof input?.slaCoverage !== "number" ||
    !Number.isFinite(input.slaCoverage) ||
    input.slaCoverage < 0 ||
    input.slaCoverage > 1
  ) {
    failures.push({ path: "/slaCoverage", reason: "must_be_in_0_1" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.quoteInvalid,
        "quote request is invalid",
        {
          tenantId: input?.demand?.tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID,
          correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const demand = input.demand;
  const match = input.match;
  const quoteVersion = 1; // first issuance
  const quoteId = `qt_${fnv1a32Hex(
    canonicalJson({
      tenantId: demand.tenantId as string,
      demandId: demand.demandId,
      vendorId: match.vendor.vendorId as string,
      quoteVersion,
    }),
  )}`;
  const quote: Quote = frozen({
    quoteId,
    tenantId: demand.tenantId,
    demandId: demand.demandId,
    vendorId: match.vendor.vendorId,
    matchedCapabilityId: match.matchedCapability?.id ?? null,
    quoteVersion,
    unitPriceUsd: input.unitPriceUsd,
    totalPriceUsd: input.unitPriceUsd * demand.quantity,
    leadTimeDays: input.leadTimeDays,
    warrantyDays: input.warrantyDays,
    slaCoverage: input.slaCoverage,
    status: "ISSUED",
    issuedAt: input.at,
    schemaVersion: QUOTE_SCHEMA_VERSION,
    modelVersion: QUOTE_MODEL_VERSION,
  });

  sink.append(
    frozen({
      action: PROCUREMENT_AUDIT_ACTIONS.quoteIssued,
      tenantId: quote.tenantId,
      subject: quote.quoteId,
      occurredAt: input.at,
      correlationId: input.correlationId,
      details: {
        demandId: quote.demandId,
        vendorId: quote.vendorId,
        matchedCapabilityId: quote.matchedCapabilityId,
        quoteVersion: quote.quoteVersion,
        unitPriceUsd: quote.unitPriceUsd,
        totalPriceUsd: quote.totalPriceUsd,
        leadTimeDays: quote.leadTimeDays,
        warrantyDays: quote.warrantyDays,
        slaCoverage: quote.slaCoverage,
        status: quote.status,
      },
    }),
  );

  return { ok: true, quote };
}

/**
 * Accept a quote (PROPOSAL-GATED transition — never automatic). The
 * quote's status transitions ISSUED -> ACCEPTED. A SUPERSEDED or
 * REJECTED quote cannot be accepted. The acceptance is recorded as a
 * new ledger entry (append-only); the quote's `status` field on the
 * ledger entry stays ISSUED — the acceptance entry is the
 * machine-stable record of the transition.
 *
 * @param ledger the quote ledger (the prior state)
 * @param quoteId the id of the quote to accept
 * @param options the acceptance options
 * @returns the tagged result (the new ledger + the acceptance record)
 */
export function acceptQuote(
  ledger: QuoteLedger,
  quoteId: string,
  options: {
    at: string;
    correlationId: CorrelationId;
    auditSink?: ProcurementAuditSink;
  },
):
  | {
      ok: true;
      ledger: QuoteLedger;
      acceptance: QuoteAcceptance;
    }
  | {
      ok: false;
      error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError>;
    } {
  const failures: { path: string; reason: string }[] = [];
  if (typeof quoteId !== "string" || quoteId.length === 0) {
    failures.push({ path: "/quoteId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.quoteInvalid,
        "acceptance request is invalid",
        {
          tenantId: ledger.tenantId,
          correlationId: options?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  const status = quoteStatus(ledger, quoteId);
  if (status === "unknown") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote not found in the ledger",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "quote_unknown",
      ),
    };
  }
  if (status === "SUPERSEDED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote is already superseded; accept the active revision instead",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "already_superseded",
      ),
    };
  }
  // Find the quote and check its own status.
  const quote = ledger.entries
    .filter((e): e is Extract<QuoteLedgerEntry, { kind: "quote" }> => e.kind === "quote")
    .map((e) => e.quote)
    .find((q) => q.quoteId === quoteId);
  if (quote === undefined) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote not found in the ledger",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "quote_unknown",
      ),
    };
  }
  // Check whether the ledger already records an acceptance for this quote.
  // The quote's own `status` field is immutable (it stays "ISSUED" — the
  // acceptance is a separate ledger entry, the machine-stable record of
  // the PROPOSAL-GATED transition).
  const alreadyAccepted = ledger.entries.some(
    (e) => e.kind === "acceptance" && e.acceptance.quoteId === quoteId,
  );
  if (alreadyAccepted) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote is already accepted",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "already_accepted",
      ),
    };
  }
  if (quote.status === "REJECTED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        "quote is rejected; cannot accept",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "rejected_cannot_accept",
      ),
    };
  }
  if (quote.status !== "ISSUED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.quoteDomain,
        `quote status ${quote.status} cannot be accepted`,
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "procurement.quote.acceptance",
        "illegal_transition",
      ),
    };
  }

  const acceptance: QuoteAcceptance = frozen({
    quoteId,
    acceptedAt: options.at,
    correlationId: options.correlationId,
  });
  const next: QuoteLedger = frozen({
    ...ledger,
    entries: frozenArray([
      ...ledger.entries,
      frozen({ kind: "acceptance" as const, acceptance }),
    ]),
  });

  (options.auditSink ?? NOOP_PROCUREMENT_AUDIT_SINK).append(
    frozen({
      action: PROCUREMENT_AUDIT_ACTIONS.quoteAccepted,
      tenantId: ledger.tenantId,
      subject: quoteId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        demandId: quote.demandId,
        vendorId: quote.vendorId,
        quoteVersion: quote.quoteVersion,
        totalPriceUsd: quote.totalPriceUsd,
        leadTimeDays: quote.leadTimeDays,
        warrantyDays: quote.warrantyDays,
        slaCoverage: quote.slaCoverage,
      },
    }),
  );

  return { ok: true, ledger: next, acceptance };
}

/**
 * Re-issue a quote (supersession — a new revision with `supersedes`
 * pointing at the prior quote). The prior quote's status is recorded
 * as SUPERSEDED via a new ledger entry. Pure builder + audit emission.
 *
 * @param prior the prior quote (must be the latest revision)
 * @param overrides the new quote's terms
 * @param sink the audit sink
 */
export function supersedeQuote(
  prior: Quote,
  overrides: {
    unitPriceUsd: number;
    leadTimeDays: number;
    warrantyDays: number;
    slaCoverage: number;
    at: string;
    correlationId: CorrelationId;
  },
  sink: ProcurementAuditSink = NOOP_PROCUREMENT_AUDIT_SINK,
): QuoteResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof overrides?.at !== "string" || !looksLikeIso(overrides.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof overrides?.correlationId !== "string" || overrides.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (
    typeof overrides?.unitPriceUsd !== "number" ||
    !Number.isFinite(overrides.unitPriceUsd) ||
    overrides.unitPriceUsd < 0
  ) {
    failures.push({ path: "/unitPriceUsd", reason: "must_be_non_negative" });
  }
  if (
    typeof overrides?.leadTimeDays !== "number" ||
    !Number.isFinite(overrides.leadTimeDays) ||
    overrides.leadTimeDays < 0
  ) {
    failures.push({ path: "/leadTimeDays", reason: "must_be_non_negative" });
  }
  if (
    typeof overrides?.warrantyDays !== "number" ||
    !Number.isFinite(overrides.warrantyDays) ||
    overrides.warrantyDays < 0
  ) {
    failures.push({ path: "/warrantyDays", reason: "must_be_non_negative" });
  }
  if (
    typeof overrides?.slaCoverage !== "number" ||
    !Number.isFinite(overrides.slaCoverage) ||
    overrides.slaCoverage < 0 ||
    overrides.slaCoverage > 1
  ) {
    failures.push({ path: "/slaCoverage", reason: "must_be_in_0_1" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.quoteInvalid,
        "supersession request is invalid",
        { tenantId: prior.tenantId, correlationId: overrides?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  const quoteVersion = prior.quoteVersion + 1;
  const quoteId = `qt_${fnv1a32Hex(
    canonicalJson({
      tenantId: prior.tenantId as string,
      demandId: prior.demandId,
      vendorId: prior.vendorId as string,
      quoteVersion,
    }),
  )}`;
  const quote: Quote = frozen({
    quoteId,
    tenantId: prior.tenantId,
    demandId: prior.demandId,
    vendorId: prior.vendorId,
    matchedCapabilityId: prior.matchedCapabilityId,
    quoteVersion,
    supersedes: prior.quoteId,
    unitPriceUsd: overrides.unitPriceUsd,
    totalPriceUsd: overrides.unitPriceUsd * (prior.totalPriceUsd / Math.max(1, prior.unitPriceUsd)),
    leadTimeDays: overrides.leadTimeDays,
    warrantyDays: overrides.warrantyDays,
    slaCoverage: overrides.slaCoverage,
    status: "ISSUED",
    issuedAt: overrides.at,
    schemaVersion: QUOTE_SCHEMA_VERSION,
    modelVersion: QUOTE_MODEL_VERSION,
  });

  sink.append(
    frozen({
      action: PROCUREMENT_AUDIT_ACTIONS.quoteSuperseded,
      tenantId: quote.tenantId,
      subject: prior.quoteId,
      occurredAt: overrides.at,
      correlationId: overrides.correlationId,
      details: {
        supersededBy: quote.quoteId,
        priorQuoteVersion: prior.quoteVersion,
        newQuoteVersion: quote.quoteVersion,
        demandId: quote.demandId,
        vendorId: quote.vendorId,
        newUnitPriceUsd: quote.unitPriceUsd,
        newTotalPriceUsd: quote.totalPriceUsd,
        newLeadTimeDays: quote.leadTimeDays,
        newWarrantyDays: quote.warrantyDays,
        newSlaCoverage: quote.slaCoverage,
      },
    }),
  );

  return { ok: true, quote };
}

/** The resolved ACTIVE quote of a (demandId, vendorId) lineage. */
export function resolveActiveQuote(
  ledger: QuoteLedger,
  demandId: string,
  vendorId: VendorId,
): Quote | undefined {
  const quotes = ledger.entries
    .filter((e): e is Extract<QuoteLedgerEntry, { kind: "quote" }> => e.kind === "quote")
    .map((e) => e.quote)
    .filter((q) => q.demandId === demandId && q.vendorId === vendorId)
    .sort((a, b) => a.quoteVersion - b.quoteVersion);
  if (quotes.length === 0) return undefined;
  // The active quote is the latest revision that has not been superseded.
  for (let i = quotes.length - 1; i >= 0; i--) {
    const q = quotes[i] as Quote;
    const superseded = quotes.some((other) => other.supersedes === q.quoteId);
    if (!superseded) return q;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Compatible-order aggregation (before the customer deadline)
// ---------------------------------------------------------------------------

/**
 * An aggregated order: one or more compatible demands grouped by
 * (vendor, deliveryArea, deadline window) before a customer deadline.
 * Each aggregated order traces to its member demands (individual
 * customer contracts remain auditable).
 */
export interface AggregatedOrder extends TenantScoped {
  /** Deterministic id: `agg_` + fnv1a32 of the grouping tuple + member demand ids. */
  readonly aggregationId: string;
  readonly tenantId: TenantId;
  /** The vendor fulfilling the aggregated order. */
  readonly vendorId: VendorId;
  /** The shared delivery area. */
  readonly deliveryArea: string;
  /** The shared deadline window (the earliest member demand's deadline). */
  readonly deadline: string;
  /** The member demands (sorted by demandId — deterministic). */
  readonly memberDemandIds: readonly string[];
  /** The aggregated total quantity. */
  readonly totalQuantity: number;
  /** The aggregated total price (sum of accepted quotes' totalPriceUsd). */
  readonly totalAggregatedPriceUsd: number;
  /** Injected aggregation-formation timestamp. */
  readonly formedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/** The tagged result of an aggregation operation. */
export type AggregationResult =
  | { readonly ok: true; readonly aggregation: AggregatedOrder }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

/**
 * The grouping key for compatible orders: (vendorId, deliveryArea,
 * deadlineWindow). Two demands with the same key may be aggregated.
 */
export interface AggregationGroupKey {
  readonly vendorId: VendorId;
  readonly deliveryArea: string;
  readonly deadline: string;
}

/**
 * Form an aggregated order from a list of compatible (vendor,
 * deliveryArea, deadline) accepted quotes. The aggregation is
 * deterministic: member demand ids are sorted; the aggregationId is a
 * stable hash of the grouping tuple + member demand ids.
 *
 * @param tenantId the acting tenant
 * @param vendorId the vendor fulfilling the aggregated order
 * @param deliveryArea the shared delivery area
 * @param deadline the shared deadline (the earliest member demand's deadline)
 * @param acceptedQuotes the accepted quotes to aggregate (each carries a demandId)
 * @param at the injected aggregation-formation timestamp
 * @param correlationId the correlation id
 * @param sink the audit sink (default: no-op)
 */
export function formAggregation(
  tenantId: TenantId,
  vendorId: VendorId,
  deliveryArea: string,
  deadline: string,
  acceptedQuotes: readonly Quote[],
  at: string,
  correlationId: CorrelationId,
  sink: ProcurementAuditSink = NOOP_PROCUREMENT_AUDIT_SINK,
): AggregationResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof vendorId !== "string" || vendorId.length === 0) {
    failures.push({ path: "/vendorId", reason: "required" });
  }
  if (typeof deliveryArea !== "string" || deliveryArea.length === 0) {
    failures.push({ path: "/deliveryArea", reason: "required" });
  }
  if (typeof deadline !== "string" || !looksLikeIso(deadline)) {
    failures.push({ path: "/deadline", reason: "not_iso" });
  }
  if (typeof at !== "string" || !looksLikeIso(at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof correlationId !== "string" || correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(acceptedQuotes) || acceptedQuotes.length === 0) {
    failures.push({ path: "/acceptedQuotes", reason: "must_be_non_empty_array" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.aggregationInvalid,
        "aggregation request is invalid",
        { tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID, correlationId: correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        failures,
      ),
    };
  }

  // Sort member quotes by demandId (deterministic).
  const sortedQuotes = [...acceptedQuotes].sort((a, b) =>
    a.demandId < b.demandId ? -1 : a.demandId > b.demandId ? 1 : 0,
  );
  const memberDemandIds = sortedQuotes.map((q) => q.demandId);
  const totalQuantity = sortedQuotes.reduce((sum, q) => sum + (q.totalPriceUsd / Math.max(1, q.unitPriceUsd)), 0);
  const totalAggregatedPriceUsd = sortedQuotes.reduce((sum, q) => sum + q.totalPriceUsd, 0);

  const aggregationId = `agg_${fnv1a32Hex(
    canonicalJson({
      tenantId: tenantId as string,
      vendorId: vendorId as string,
      deliveryArea,
      deadline,
      memberDemandIds,
    }),
  )}`;
  const aggregation: AggregatedOrder = frozen({
    aggregationId,
    tenantId,
    vendorId,
    deliveryArea,
    deadline,
    memberDemandIds: frozenArray(memberDemandIds),
    totalQuantity,
    totalAggregatedPriceUsd,
    formedAt: at,
    schemaVersion: AGGREGATION_SCHEMA_VERSION,
    modelVersion: AGGREGATION_MODEL_VERSION,
  });

  sink.append(
    frozen({
      action: PROCUREMENT_AUDIT_ACTIONS.aggregationFormed,
      tenantId,
      subject: aggregationId,
      occurredAt: at,
      correlationId,
      details: {
        vendorId,
        deliveryArea,
        deadline,
        memberDemandIds,
        memberCount: memberDemandIds.length,
        totalQuantity,
        totalAggregatedPriceUsd,
      },
    }),
  );

  return { ok: true, aggregation };
}

/**
 * Deterministic grouping: group accepted (demand, quote) pairs by
 * (vendorId, deliveryArea, deadline-window) — the spec's "compatible
 * orders may be aggregated before a customer deadline". Returns one
 * AggregatedOrder per group, sorted by aggregationId.
 *
 * The deadline-window is the demand's `deadline` (per spec — compatible
 * orders share the same customer deadline). Two demands with the same
 * (vendorId, deliveryArea, deadline) form one group.
 *
 * @param tenantId the acting tenant
 * @param pairs the (demand, quote) pairs to group (each pair's quote
 *        must be accepted — the caller verifies)
 * @param at the injected aggregation-formation timestamp
 * @param correlationId the correlation id
 * @param sink the audit sink
 */
export function aggregateAcceptedQuotes(
  tenantId: TenantId,
  pairs: readonly { demand: ProcurementDemand; quote: Quote }[],
  at: string,
  correlationId: CorrelationId,
  sink: ProcurementAuditSink = NOOP_PROCUREMENT_AUDIT_SINK,
):
  | { ok: true; aggregations: readonly AggregatedOrder[] }
  | { ok: false; error: import("@fleetos/contracts").FleetError } {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.aggregationInvalid,
        "aggregation request is invalid",
        { tenantId: tenantId ?? SYNTHETIC_SYSTEM_TENANT_ID, correlationId: correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
        [{ path: "/pairs", reason: "must_be_non_empty_array" }],
      ),
    };
  }

  // Group by (vendorId, deliveryArea, deadline).
  const groups = new Map<string, { demand: ProcurementDemand; quote: Quote }[]>();
  for (const pair of pairs) {
    const key = canonicalJson({
      vendorId: pair.quote.vendorId as string,
      deliveryArea: pair.demand.deliveryArea,
      deadline: pair.demand.deadline,
    });
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [pair]);
    } else {
      group.push(pair);
    }
  }

  const aggregations: AggregatedOrder[] = [];
  for (const groupPairs of groups.values()) {
    const firstPair = groupPairs[0] as { demand: ProcurementDemand; quote: Quote };
    const quotes = groupPairs.map((p) => p.quote);
    const result = formAggregation(
      tenantId,
      firstPair.quote.vendorId,
      firstPair.demand.deliveryArea,
      firstPair.demand.deadline,
      quotes,
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
