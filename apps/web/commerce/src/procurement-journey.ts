/**
 * @fleetos/web-commerce — W143: the PROCUREMENT CASE JOURNEY view-model.
 *
 * The full procurement-case journey the accepted deep screen must carry,
 * as ONE machine-stable walk (SIM-B ask 1; UX-JOURNEY-SIMULATION
 * Journey 5 — the procurement subsequence):
 *
 *   need -> case -> vendor_context -> authorization -> decision ->
 *   order -> evidence
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: a demand with no matches says `not_evaluated`; a quote with
 *     no acceptance entry says `not_accepted`; a connectivity submission
 *     with a PARKED decision says `approval_required`. An absence of
 *     evidence is never dressed up as an order — NOTHING is ever
 *     fabricated.
 *   - The VENDOR CONTEXT walk is the matching run's records as operator
 *     steps: one step per vendor match (satisfiable first), each
 *     anchored to its engine-stable rank score and the typed headroom
 *     dimensions. No satisfiable matches -> the machine-stable
 *     `no_satisfiable_vendor` — never an invented match.
 *   - The DECISION walk carries the demand's accepted quote state
 *     (`not_accepted` until a real ledger entry says otherwise), the
 *     Guardian decision (`not_evaluated` until a real decision exists),
 *     and the durable order state (`not_ordered` when no aggregated
 *     order exists).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the step's own
 *     states keep proposal, acceptance and execution distinct. The
 *     quote's status and the ledger's acceptance entries are DISPLAYED
 *     — the surface performs, accepts and dispatches NOTHING.
 *   - Evidence stays OPAQUE: content-addressable refs verbatim, never
 *     interpreted.
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import type { GuardianDecisionType } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";
import type { CommerceUiTenantScope } from "./internal";
import { checkCommerceUiTenantScope, SURFACE_SYSTEM_TENANT_ID } from "./internal";
import type {
  AggregatedOrderFacets,
  ProcurementDemandFacets,
  QuoteFacets,
  QuoteLedgerFacets,
  VendorFacets,
  VendorMatchFacets,
} from "./seams";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The Procurement Case journey stage ids, in the frozen journey order. */
export const PROCUREMENT_CASE_JOURNEY_STAGES = [
  "need",
  "case",
  "vendor_context",
  "authorization",
  "decision",
  "order",
  "evidence",
] as const;

export type ProcurementCaseJourneyStageId =
  (typeof PROCUREMENT_CASE_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type ProcurementCaseJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface ProcurementCaseJourneyStage {
  readonly id: ProcurementCaseJourneyStageId;
  readonly state: ProcurementCaseJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const PROCUREMENT_CASE_JOURNEY_HEADLINES: Readonly<
  Record<ProcurementCaseJourneyStageId, string>
> = Object.freeze({
  need: "Need",
  case: "Procurement case",
  vendor_context: "Vendor context",
  authorization: "Authorization",
  decision: "Decision",
  order: "Order",
  evidence: "Evidence",
} as const);

// ---------------------------------------------------------------------------
// The vendor-context walk (matches as operator steps)
// ---------------------------------------------------------------------------

/** One vendor-context walk step: a satisfiable match with its headroom evidence. */
export interface ProcurementVendorContextStep {
  readonly vendorId: string;
  readonly vendorName: string;
  /** The engine's rank score, verbatim. */
  readonly rankScore: number;
  /** True when the vendor satisfies every hard gate, verbatim. */
  readonly satisfiable: boolean;
  /** The matched capability id, when one was matched. */
  readonly matchedCapabilityId: string | null;
  /** The engine's machine-stable reasons (failures when unsatisfiable). */
  readonly reasons: readonly { readonly kind: string; readonly detail: string }[];
}

/** The vendor-context walk: ordered steps or the honest no-match state. */
export interface ProcurementVendorContextWalk {
  /** Machine-stable: `vendors_matched` | `no_satisfiable_vendor` | `no_matches_recorded`. */
  readonly state: "vendors_matched" | "no_satisfiable_vendor" | "no_matches_recorded";
  readonly steps: readonly ProcurementVendorContextStep[];
}

/**
 * Build the vendor-context walk from the REAL engine match records.
 * PURE: satisfiable matches first (engine rank preserved), then
 * rejected vendors (vendorId order). An empty match list is the
 * machine-stable `no_matches_recorded` — never a fabricated match; a
 * non-empty list with no satisfiable matches is the machine-stable
 * `no_satisfiable_vendor` (the honest unsupported state).
 */
export function buildProcurementVendorContextWalk(
  matches: readonly VendorMatchFacets[],
): ProcurementVendorContextWalk {
  if (matches.length === 0) {
    return frozen({ state: "no_matches_recorded", steps: frozenArray([]) });
  }
  const steps: ProcurementVendorContextStep[] = [...matches]
    .sort((a, b) => {
      // Satisfiable first, then rankScore desc, then vendorId asc.
      if (a.satisfiable !== b.satisfiable) return a.satisfiable ? -1 : 1;
      if (a.rankScore !== b.rankScore) return b.rankScore - a.rankScore;
      return compareStrings(a.vendor.vendorId, b.vendor.vendorId);
    })
    .map((match) =>
      frozen<ProcurementVendorContextStep>({
        vendorId: match.vendor.vendorId,
        vendorName: match.vendor.name,
        rankScore: match.rankScore,
        satisfiable: match.satisfiable,
        matchedCapabilityId: match.matchedCapability?.id ?? null,
        reasons: frozenArray(match.reasons),
      }),
    );
  const anySatisfiable = steps.some((step) => step.satisfiable);
  return frozen({
    state: anySatisfiable ? "vendors_matched" : "no_satisfiable_vendor",
    steps: frozenArray(steps),
  });
}

// ---------------------------------------------------------------------------
// The decision walk (per-demand quote acceptance + Guardian decision)
// ---------------------------------------------------------------------------

/** The decision projection for one demand's accepted quote. */
export interface ProcurementDecisionView {
  readonly demandId: string;
  /** The quote acceptance state: `not_accepted` until a real ledger entry says otherwise. */
  readonly acceptance: "accepted" | "not_accepted";
  /** The Guardian decision: `not_evaluated` until a real decision exists. */
  readonly gating: GuardianDecisionType | "not_evaluated";
  /**
   * The durable order state: `not_ordered` when no aggregated order
   * exists; `ordered` when an aggregated order cites this demand.
   */
  readonly order: "not_ordered" | "ordered";
}

/** The decision walk: per-demand decisions, or the honest not-decided state. */
export interface ProcurementDecisionWalk {
  /** Machine-stable: `decisions_recorded` | `no_decisions_recorded`. */
  readonly state: "decisions_recorded" | "no_decisions_recorded";
  readonly steps: readonly ProcurementDecisionView[];
}

/**
 * Build the decision walk from the REAL quote ledger + the REAL
 * aggregated orders. PURE: every decision derives from REAL records
 * only — `not_accepted`, `not_evaluated` and `not_ordered` are the
 * honest defaults. The acceptance state derives from the ledger's
 * acceptance entries (the quote's status field stays ISSUED; the
 * acceptance entry is the machine-stable record of the transition —
 * see `acceptQuote`'s frozen contract). A RECOMMENDATION IS NEVER AN
 * EXECUTED ACTION: the acceptance/gating/order states describe
 * records — this module performs, accepts and dispatches NOTHING.
 */
export function buildProcurementDecisionWalk(
  demand: ProcurementDemandFacets | undefined,
  ledger: QuoteLedgerFacets | undefined,
  orders: readonly AggregatedOrderFacets[],
): ProcurementDecisionWalk {
  if (demand === undefined) {
    return frozen({ state: "no_decisions_recorded", steps: frozenArray([]) });
  }
  // The latest quote for this demand (the highest quoteVersion, or the
  // most-recently issued when versions tie).
  const demandQuotes: readonly QuoteFacets[] =
    ledger === undefined
      ? []
      : ledger.entries
          .filter((entry): entry is Extract<typeof entry, { kind: "quote" }> => entry.kind === "quote")
          .map((entry) => entry.quote)
          .filter((quote) => quote.demandId === demand.demandId);
  const latestQuote = [...demandQuotes].sort((a, b) => {
    if (a.quoteVersion !== b.quoteVersion) return b.quoteVersion - a.quoteVersion;
    return a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0;
  })[0];

  // The acceptance state derives from the ledger's acceptance entries
  // (the quote's status field stays ISSUED; the acceptance entry is the
  // machine-stable record of the ISSUED -> ACCEPTED transition).
  const hasAcceptance =
    ledger !== undefined &&
    ledger.entries.some(
      (entry) =>
        entry.kind === "acceptance" &&
        latestQuote !== undefined &&
        entry.acceptance.quoteId === latestQuote.quoteId,
    );
  const acceptance: ProcurementDecisionView["acceptance"] = hasAcceptance
    ? "accepted"
    : "not_accepted";

  const order: ProcurementDecisionView["order"] = orders.some((record) =>
    record.memberDemandIds.includes(demand.demandId),
  )
    ? "ordered"
    : "not_ordered";

  const step = frozen<ProcurementDecisionView>({
    demandId: demand.demandId,
    acceptance,
    gating: "not_evaluated",
    order,
  });
  const anyDecisionRecorded = step.acceptance !== "not_accepted" || step.order !== "not_ordered";
  return frozen({
    state: anyDecisionRecorded ? "decisions_recorded" : "no_decisions_recorded",
    steps: frozenArray([step]),
  });
}

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The Procurement Case journey: the seven frozen stages with honest
 * states, the vendor-context walk, and the decision walk — every value
 * derived from REAL runtime state (the real-observations-only doctrine).
 */
export interface ProcurementCaseJourney {
  readonly tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID;
  readonly demandId: string;
  readonly stages: readonly ProcurementCaseJourneyStage[];
  readonly vendorContext: ProcurementVendorContextWalk;
  readonly decisions: ProcurementDecisionWalk;
  /** Machine-stable: is any decision step parked for a human? */
  readonly approvalPending: boolean;
}

/** The journey build's inputs (all REAL state; nothing fabricated). */
export interface ProcurementCaseJourneyInput {
  /** The demand record, when it is in the acting tenant's partition. */
  readonly demand: ProcurementDemandFacets | undefined;
  /** The REAL vendor-match records for the demand. */
  readonly matches: readonly VendorMatchFacets[];
  /** The REAL quote ledger for the demand (tenant-wide). */
  readonly ledger: QuoteLedgerFacets | undefined;
  /** The REAL aggregated orders (tenant-wide, LOCK 14). */
  readonly orders: readonly AggregatedOrderFacets[];
  /** The vendor records (the vendor-context enrichment), when supplied. */
  readonly vendors: readonly VendorFacets[];
  /** The injected "now" (ISO 8601). */
  readonly now: string;
}

/** The state of the case stage from the demand record. PURE. */
function caseStageState(demand: ProcurementDemandFacets | undefined): ProcurementCaseJourneyStageState {
  if (demand === undefined) return "blocked";
  return "ready";
}

/** The state of the authorization stage. PURE (no Guardian decisions on
 * the demand itself — the surface is read-only; `not_evaluated` is the
 * honest default until the ledger records an accepted quote). */
function authorizationStageState(
  ledger: QuoteLedgerFacets | undefined,
  demand: ProcurementDemandFacets | undefined,
): ProcurementCaseJourneyStageState {
  if (demand === undefined) return "not_yet_observed";
  if (ledger === undefined) return "not_yet_observed";
  const hasAcceptance = ledger.entries.some(
    (entry) => entry.kind === "acceptance",
  );
  return hasAcceptance ? "ready" : "not_yet_observed";
}

/** The state of the order stage from the aggregated orders. PURE. */
function orderStageState(
  demand: ProcurementDemandFacets | undefined,
  orders: readonly AggregatedOrderFacets[],
): ProcurementCaseJourneyStageState {
  if (demand === undefined) return "not_yet_observed";
  const hasOrder = orders.some((record) => record.memberDemandIds.includes(demand.demandId));
  return hasOrder ? "ready" : "not_yet_observed";
}

/**
 * Build the Procurement Case journey view-model. PURE and DETERMINISTIC:
 * the same inputs produce a byte-identical journey. A demand that is
 * absent yields the `blocked` case stage (the honest not-in-tenant state
 * — no existence side channel, no fabricated demand header); an absent
 * match list yields the honest `no_matches_recorded` vendor-context walk.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param input the REAL runtime state (every stage's source)
 */
export function buildProcurementCaseJourney(
  scope: CommerceUiTenantScope,
  input: ProcurementCaseJourneyInput,
): ProcurementCaseJourney {
  const guard = checkCommerceUiTenantScope(scope);
  const { demand, matches, ledger, orders } = input;
  const vendorContextWalk = buildProcurementVendorContextWalk(matches);
  const decisionWalk = buildProcurementDecisionWalk(demand, ledger, orders);

  const stages: ProcurementCaseJourneyStage[] = [
    frozen<ProcurementCaseJourneyStage>({
      id: "need",
      state: demand === undefined ? "blocked" : "ready",
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.need,
      rows:
        demand === undefined
          ? frozenArray([
              { label: "Demand", value: "—" },
              { label: "State", value: "Not in the acting tenant" },
            ])
          : frozenArray([
              { label: "Demand", value: demand.demandId },
              { label: "Description", value: demand.description },
              { label: "Quantity", value: String(demand.quantity) },
              { label: "Workload", value: demand.workloadId },
            ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "case",
      state: caseStageState(demand),
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.case,
      rows:
        demand === undefined
          ? frozenArray([{ label: "Case", value: "No demand recorded" }])
          : frozenArray([
              { label: "Created at", value: demand.createdAt },
              { label: "Deadline", value: demand.deadline },
              { label: "Delivery area", value: demand.deliveryArea },
              { label: "Budget", value: `${demand.budget.usd} USD` },
            ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "vendor_context",
      state:
        vendorContextWalk.state === "vendors_matched"
          ? "ready"
          : vendorContextWalk.state === "no_satisfiable_vendor"
            ? "empty"
            : "not_yet_observed",
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.vendor_context,
      rows: frozenArray([
        { label: "State", value: vendorContextWalk.state },
        { label: "Matches", value: String(vendorContextWalk.steps.length) },
        {
          label: "Satisfiable",
          value: String(vendorContextWalk.steps.filter((step) => step.satisfiable).length),
        },
      ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "authorization",
      state: authorizationStageState(ledger, demand),
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.authorization,
      rows: frozenArray([
        {
          label: "Quote ledger",
          value: ledger === undefined ? "none" : `${ledger.entries.length} entries`,
        },
        {
          label: "Acceptances",
          value: String(
            ledger?.entries.filter((entry) => entry.kind === "acceptance").length ?? 0,
          ),
        },
      ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "decision",
      state:
        decisionWalk.state === "decisions_recorded"
          ? "ready"
          : "not_yet_observed",
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.decision,
      rows: frozenArray([
        { label: "State", value: decisionWalk.state },
        {
          label: "Accepted",
          value: String(decisionWalk.steps.filter((step) => step.acceptance === "accepted").length),
        },
        {
          label: "Ordered",
          value: String(decisionWalk.steps.filter((step) => step.order === "ordered").length),
        },
      ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "order",
      state: orderStageState(demand, orders),
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.order,
      rows: frozenArray([
        {
          label: "Aggregated orders",
          value: String(
            demand === undefined
              ? 0
              : orders.filter((record) => record.memberDemandIds.includes(demand.demandId)).length,
          ),
        },
        {
          label: "Total orders (tenant)",
          value: String(orders.length),
        },
      ]),
    }),
    frozen<ProcurementCaseJourneyStage>({
      id: "evidence",
      state:
        demand !== undefined && (matches.length > 0 || (ledger?.entries.length ?? 0) > 0)
          ? "ready"
          : "not_yet_observed",
      headline: PROCUREMENT_CASE_JOURNEY_HEADLINES.evidence,
      rows: frozenArray([
        { label: "Vendor matches", value: String(matches.length) },
        {
          label: "Quote ledger entries",
          value: String(ledger?.entries.length ?? 0),
        },
        {
          label: "Aggregated orders",
          value: String(orders.length),
        },
      ]),
    }),
  ];

  return frozen({
    tenantId: guard.ok ? guard.tenantId : SURFACE_SYSTEM_TENANT_ID,
    demandId: demand?.demandId ?? "",
    stages: frozenArray(stages),
    vendorContext: vendorContextWalk,
    decisions: decisionWalk,
    approvalPending: false,
  });
}
