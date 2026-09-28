/**
 * W072 D1/D5 tests — vendor scorecards: the four machine-stable quality
 * dimensions over injected closed interactions, the structural seams
 * over the REAL W032/W042 surfaces, supersession discipline, the
 * append-only ledger, tenant isolation, audit emission (into the REAL
 * hash-chained log), and byte-identical determinism.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asDeviceId, asTenantId } from "@fleetos/contracts";
import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
// REAL lane packages injected at the binding sites (test scope only —
// src/ consumes them through the structural twins).
import {
  buildDemand,
  matchDemand,
  issueQuote,
  acceptQuote,
  appendQuote,
  createQuoteLedger,
} from "@fleetos/procurement";
import type { CreateDemandInput } from "@fleetos/procurement";
import { buildServiceWorkOrder, matchServiceWorkOrder } from "@fleetos/maintenance";
import { buildVendor } from "../src/vendor";
import {
  ALL_SCORECARD_DIMENSIONS,
  SCORECARD_AUDIT_ACTIONS,
  SCORECARD_MODEL_VERSION,
  SCORECARD_SCHEMA_VERSION,
  appendVendorScorecard,
  buildVendorScorecard,
  createInMemoryVendorsOutcomeAuditSink,
  createVendorScorecardLedger,
  listScorecardHistory,
  resolveLatestScorecard,
} from "../src/index";
import type {
  MatchOutcomeInteraction,
  QuoteAcceptanceInteraction,
  ScorecardInteraction,
  ServiceWorkOrderOutcomeInteraction,
  VendorScorecard,
  VendorScorecardLedger,
} from "../src/index";
import type { FleetError } from "@fleetos/contracts";
import type { VendorsOutcomeAuditSink } from "../src/index";
import { CORR, T0, T1, VND_1, VND_2, createInput } from "./helpers";

/** A window covering the whole test fixture timeline. */
const WINDOW = { from: T0, to: "2026-03-01T00:00:00Z" } as const;
/** A later window (for supersession). */
const WINDOW_2 = { from: T0, to: "2026-04-01T00:00:00Z" } as const;
/** A completion timestamp inside the window. */
const DELIVERED_AT = "2026-01-15T00:00:00Z" as const;

/** Tenant A (the acting tenant for most tests). */
const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
/** Tenant B (the foreign tenant). */
const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");
/** A second correlation id. */
const CORR_2: CorrelationId = asCorrelationId("cor_w072_score_2");

/** A closed match-outcome interaction (the W032 seam twin). */
function matchInteraction(overrides: Partial<MatchOutcomeInteraction> = {}): MatchOutcomeInteraction {
  return {
    kind: "match_outcome",
    tenantId: TENANT_A,
    vendorId: VND_1,
    demandId: "dmd_w072match0001",
    satisfiable: true,
    rankScore: 0.9,
    recordedAt: T0,
    closedAt: T0,
    ...overrides,
  };
}

/** A closed quote-acceptance interaction (the W032 seam twin). */
function quoteInteraction(overrides: Partial<QuoteAcceptanceInteraction> = {}): QuoteAcceptanceInteraction {
  return {
    kind: "quote_acceptance",
    tenantId: TENANT_A,
    vendorId: VND_1,
    demandId: "dmd_w072quote0001",
    quoteId: "qt_w072quote00001",
    unitPriceUsd: 100,
    leadTimeDays: 7,
    warrantyDays: 365,
    slaCoverage: 0.95,
    acceptedAt: T0,
    delivered: true,
    deliveredAt: DELIVERED_AT,
    deliveredUnitPriceUsd: 100,
    slaMet: true,
    warrantyHonored: true,
    closedAt: DELIVERED_AT,
    ...overrides,
  };
}

/** A closed service work-order outcome interaction (the W042 seam twin). */
function serviceInteraction(
  overrides: Partial<ServiceWorkOrderOutcomeInteraction> = {},
): ServiceWorkOrderOutcomeInteraction {
  return {
    kind: "service_work_order_outcome",
    tenantId: TENANT_A,
    vendorId: VND_1,
    workOrderId: "swo_w072service01",
    serviceArea: "us-east-1",
    deadline: "2026-02-01T00:00:00Z",
    completed: true,
    completedAt: "2026-01-20T00:00:00Z",
    slaMet: true,
    warrantyHonored: false,
    closedAt: "2026-01-20T00:00:00Z",
    ...overrides,
  };
}

/** A REAL vendor record (the W032 surface, injected at the binding site). */
function realVendor() {
  const built = buildVendor(TENANT_A, createInput());
  if (!built.ok) throw new Error(built.error.message);
  return built.vendor;
}

/** A REAL W032 demand record (injected at the binding site). */
function realDemand() {
  const built = buildDemand(TENANT_A, {
    procurementIntent: {
      workloadId: "wl_testworkload01",
      description: "Procure a standard laptop for the W072 scorecard binding test.",
    },
    quantity: 1,
    at: T0,
    deadline: "2026-02-01T00:00:00Z",
    deliveryArea: "us-east-1",
    budget: { usd: 2000 },
    slaFloor: { coverage: 0.8 },
    warrantyFloor: { days: 90 },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    allowedSubstitutions: ["class.standard_laptop"],
    correlationId: CORR,
  } satisfies CreateDemandInput);
  if (!built.ok) throw new Error(built.error.message);
  return built.demand;
}

/** Build a scorecard for tenant A (throws on failure). */
function scorecard(
  interactions: readonly ScorecardInteraction[],
  overrides: { window?: { from: string; to: string }; prior?: VendorScorecard } = {},
): VendorScorecard {
  const built = buildVendorScorecard(TENANT_A, {
    vendorId: VND_1,
    window: overrides.window ?? WINDOW,
    interactions,
    at: T1,
    correlationId: CORR,
    prior: overrides.prior,
  });
  if (!built.ok) throw new Error(`scorecard build failed: ${built.error.message}`);
  return built.scorecard;
}

/** Narrow a failed tagged result's error to its DomainError invariant. */
function invariantOf(result: { readonly ok: false; readonly error: FleetError }): string {
  if (result.error.kind !== "DomainError" || result.error.invariant === undefined) {
    throw new Error(`expected DomainError with an invariant, got ${result.error.kind}`);
  }
  return result.error.invariant;
}

/** Append to the ledger (throws on failure). */
function appendOk(
  ledger: VendorScorecardLedger,
  sc: VendorScorecard,
): VendorScorecardLedger {
  const appended = appendVendorScorecard(ledger, sc);
  if (!appended.ok) throw new Error(appended.error.message);
  return appended.ledger;
}

describe("W072 D1: the machine-stable quality dimensions", () => {
  test("the four dimensions are computed from the injected interactions (documented mapping)", () => {
    const sc = scorecard([
      quoteInteraction(), // delivered, sla met, warranty honored, price accurate
      quoteInteraction({ quoteId: "qt_w072quote00002", delivered: false, deliveredAt: null, deliveredUnitPriceUsd: null, slaMet: null, warrantyHonored: null }),
      serviceInteraction(), // completed, sla met, warranty NOT honored
      matchInteraction(), // pre-contractual: never counted in a dimension
    ]);
    const dimension = (kind: string) => sc.dimensions.find((d) => d.kind === kind);
    // fulfillment: 3 contracted (2 quotes + 1 service), 2 fulfilled.
    expect(dimension("fulfillment")).toEqual({
      kind: "fulfillment",
      numerator: 2,
      denominator: 3,
      value: 2 / 3,
      countedRefs: dimension("fulfillment")?.countedRefs,
    });
    // sla_adherence: 2 fulfilled, 2 slaMet.
    expect(dimension("sla_adherence")?.numerator).toBe(2);
    expect(dimension("sla_adherence")?.denominator).toBe(2);
    expect(dimension("sla_adherence")?.value).toBe(1);
    // warranty_honoring: 2 fulfilled, 1 honored (service interaction false).
    expect(dimension("warranty_honoring")?.numerator).toBe(1);
    expect(dimension("warranty_honoring")?.denominator).toBe(2);
    expect(dimension("warranty_honoring")?.value).toBe(0.5);
    // quote_accuracy: 1 priced fulfilled quote, accurate.
    expect(dimension("quote_accuracy")?.numerator).toBe(1);
    expect(dimension("quote_accuracy")?.denominator).toBe(1);
    expect(dimension("quote_accuracy")?.value).toBe(1);
    // The dimensions carry canonical order + the refs they counted.
    expect(sc.dimensions.map((d) => d.kind)).toEqual([...ALL_SCORECARD_DIMENSIONS]);
    expect(dimension("fulfillment")?.countedRefs).toContain("qt_w072quote00001");
    expect(dimension("fulfillment")?.countedRefs).toContain("swo_w072service01");
    // Match outcomes are carried in the summary + refs, never a dimension.
    expect(sc.matchSummary).toEqual({ total: 1, satisfiable: 1, rejected: 0 });
    expect(sc.interactionRefs).toContain("dmd_w072match0001");
    expect(sc.interactionCounts).toEqual({
      match_outcome: 1,
      quote_acceptance: 2,
      service_work_order_outcome: 1,
    });
  });

  test("a dimension with no applicable evidence is null (unmeasured, never zero)", () => {
    const sc = scorecard([matchInteraction({ satisfiable: false, rankScore: 0 })]);
    for (const dimension of sc.dimensions) {
      expect(dimension.value).toBeNull();
      expect(dimension.denominator).toBe(0);
    }
    expect(sc.matchSummary).toEqual({ total: 1, satisfiable: 0, rejected: 1 });
  });

  test("quote accuracy excludes fulfilled quotes without a delivered price", () => {
    const sc = scorecard([
      quoteInteraction({ deliveredUnitPriceUsd: null }),
    ]);
    const accuracy = sc.dimensions.find((d) => d.kind === "quote_accuracy");
    expect(accuracy?.numerator).toBe(0);
    expect(accuracy?.denominator).toBe(0);
    expect(accuracy?.value).toBeNull();
    // SLA/warranty still measured over the fulfilled interaction.
    const sla = sc.dimensions.find((d) => d.kind === "sla_adherence");
    expect(sla?.numerator).toBe(1);
    expect(sla?.denominator).toBe(1);
  });

  test("undelivered interactions carry null outcome fields (machine-stable totality)", () => {
    const sc = scorecard([
      quoteInteraction({ delivered: false, deliveredAt: null, deliveredUnitPriceUsd: null, slaMet: null, warrantyHonored: null }),
      serviceInteraction({ completed: false, completedAt: null, slaMet: null, warrantyHonored: null }),
    ]);
    const fulfillment = sc.dimensions.find((d) => d.kind === "fulfillment");
    expect(fulfillment?.numerator).toBe(0);
    expect(fulfillment?.denominator).toBe(2);
    expect(fulfillment?.value).toBe(0);
    expect(sc.dimensions.find((d) => d.kind === "sla_adherence")?.value).toBeNull();
  });
});

describe("W072 D1: validation (fail closed, machine-stable)", () => {
  test("an empty interaction set refuses (nothing to derive)", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.code).toBe("vendors.scorecard.invalid_request");
    expect(JSON.stringify(built.error)).toContain("must_be_non_empty_array");
  });

  test("an interaction outside the evaluation window refuses", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: { from: "2026-02-01T00:00:00Z", to: "2026-03-01T00:00:00Z" },
      interactions: [quoteInteraction()],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("outside_window");
  });

  test("a duplicate interaction ref refuses", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction(), quoteInteraction()],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("duplicate_interaction_ref");
  });

  test("an interaction for a foreign vendor refuses (fail closed, never dropped)", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction({ vendorId: VND_2 })],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("foreign_interaction");
  });

  test("an interaction from a foreign tenant refuses", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction({ tenantId: TENANT_B })],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("tenant_mismatch");
  });

  test("a delivered interaction with a non-ISO deliveredAt refuses", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction({ deliveredAt: "not-a-timestamp" })],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("not_iso");
  });

  test("an undelivered interaction with a non-null deliveredAt refuses (totality)", () => {
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [
        quoteInteraction({ delivered: false, deliveredUnitPriceUsd: null, slaMet: null, warrantyHonored: null }),
      ],
      at: T1,
      correlationId: CORR,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(JSON.stringify(built.error)).toContain("must_be_null_when_undelivered");
  });
});

describe("W072 D1: supersession discipline (new window -> new revision)", () => {
  test("revision 1 carries no supersedes; the window is carried verbatim", () => {
    const sc = scorecard([quoteInteraction()]);
    expect(sc.revision).toBe(1);
    expect(sc.supersedes).toBeUndefined();
    expect(sc.window).toEqual(WINDOW);
    expect(sc.scorecardId).toMatch(/^vsc_[0-9a-f]{8}$/);
    expect(sc.schemaVersion).toBe(SCORECARD_SCHEMA_VERSION);
    expect(sc.modelVersion).toBe(SCORECARD_MODEL_VERSION);
  });

  test("a new window produces revision 2 citing the prior via supersedes", () => {
    const first = scorecard([quoteInteraction()]);
    const second = scorecard([quoteInteraction(), serviceInteraction()], {
      window: WINDOW_2,
      prior: first,
    });
    expect(second.revision).toBe(2);
    expect(second.supersedes).toBe(first.scorecardId);
    expect(second.window).toEqual(WINDOW_2);
  });

  test("revising with an identical window refuses (window_unchanged)", () => {
    const first = scorecard([quoteInteraction()]);
    const built = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction()],
      at: T1,
      correlationId: CORR,
      prior: first,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(invariantOf(built)).toBe("window_unchanged");
  });

  test("a prior from another vendor or tenant refuses (prior_scope_mismatch)", () => {
    const foreign = scorecard([quoteInteraction()]);
    const built = buildVendorScorecard(TENANT_B, {
      vendorId: VND_1,
      window: WINDOW_2,
      interactions: [quoteInteraction({ tenantId: TENANT_B })],
      at: T1,
      correlationId: CORR,
      prior: foreign,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(invariantOf(built)).toBe("prior_scope_mismatch");
  });
});

describe("W072 D1: the append-only ledger + tenant isolation", () => {
  test("appends are sequential; lookups see the full history", () => {
    const first = scorecard([quoteInteraction()]);
    const second = scorecard([quoteInteraction(), serviceInteraction()], {
      window: WINDOW_2,
      prior: first,
    });
    const ledger = appendOk(appendOk(createVendorScorecardLedger(TENANT_A), first), second);
    expect(ledger.entries.length).toBe(2);
    expect(resolveLatestScorecard(ledger, VND_1)?.revision).toBe(2);
    expect(listScorecardHistory(ledger, VND_1).map((s) => s.revision)).toEqual([1, 2]);
  });

  test("duplicate scorecard ids refuse (append-only discipline)", () => {
    const first = scorecard([quoteInteraction()]);
    const ledger = appendOk(createVendorScorecardLedger(TENANT_A), first);
    const dup = appendVendorScorecard(ledger, first);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(invariantOf(dup)).toBe("duplicate_scorecard");
  });

  test("revision 1 after an existing history refuses (revision_conflict)", () => {
    const first = scorecard([quoteInteraction()]);
    const second = scorecard([quoteInteraction()], { window: WINDOW_2, prior: first });
    const ledger = appendOk(appendOk(createVendorScorecardLedger(TENANT_A), first), second);
    // A fresh revision-1 build for the same vendor (different content
    // -> different id) is refused: revision 1 may only be first.
    const rogue = scorecard([
      quoteInteraction({ quoteId: "qt_w072quote00003", demandId: "dmd_w072quote0003" }),
    ]);
    const appended = appendVendorScorecard(ledger, rogue);
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(invariantOf(appended)).toBe("revision_conflict");
  });

  test("a revision without its prior in the ledger refuses (revision_gap)", () => {
    const first = scorecard([quoteInteraction()]);
    const second = scorecard([quoteInteraction()], { window: WINDOW_2, prior: first });
    const appended = appendVendorScorecard(createVendorScorecardLedger(TENANT_A), second);
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(invariantOf(appended)).toBe("revision_gap");
  });

  test("a supersedes that does not cite the ledger's prior refuses (supersedes_mismatch)", () => {
    const first = scorecard([quoteInteraction()]);
    // A scorecard for ANOTHER vendor (revision 1, its own lineage).
    const otherResult = buildVendorScorecard(TENANT_A, {
      vendorId: VND_2,
      window: WINDOW,
      interactions: [serviceInteraction({ vendorId: VND_2 })],
      at: T1,
      correlationId: CORR,
    });
    if (!otherResult.ok) throw new Error(otherResult.error.message);
    const other = otherResult.scorecard;
    const second = scorecard([quoteInteraction()], { window: WINDOW_2, prior: first });
    // Swap the supersedes to cite a scorecard not in the vendor's chain.
    const forged: VendorScorecard = { ...second, supersedes: other.scorecardId };
    const ledger = appendOk(appendOk(createVendorScorecardLedger(TENANT_A), first), other);
    const appended = appendVendorScorecard(ledger, forged);
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(invariantOf(appended)).toBe("supersedes_mismatch");
  });

  test("a foreign-tenant scorecard refuses to append; foreign lookups are indistinguishable from unknown", () => {
    const foreignBuild = buildVendorScorecard(TENANT_B, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction({ tenantId: TENANT_B })],
      at: T1,
      correlationId: CORR,
    });
    expect(foreignBuild.ok).toBe(true);
    if (!foreignBuild.ok) return;
    const own = scorecard([quoteInteraction()]);
    const appended = appendVendorScorecard(
      createVendorScorecardLedger(TENANT_A),
      foreignBuild.scorecard,
    );
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(invariantOf(appended)).toBe("tenant_mismatch");
    // Tenant A's ledger has its own scorecard; tenant B's vendor data is
    // invisible and indistinguishable from unknown.
    const ledgerA = appendOk(createVendorScorecardLedger(TENANT_A), own);
    expect(resolveLatestScorecard(ledgerA, VND_1)?.scorecardId).toBe(own.scorecardId);
    expect(resolveLatestScorecard(ledgerA, VND_2)).toBeUndefined();
    expect(listScorecardHistory(ledgerA, VND_2)).toEqual([]);
  });
});

describe("W072 D5: structural seam bindings over the REAL lane surfaces", () => {
  test("REAL W032 match outcomes flow verbatim through the MatchOutcomeInteraction twin", () => {
    const v = realVendor();
    const demand = realDemand();
    const matched = matchDemand(demand, [v], { at: T0, correlationId: CORR });
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    const satisfiable = matched.matches[0];
    expect(satisfiable).toBeDefined();
    if (satisfiable === undefined) return;
    // The binding site projects the REAL match through the twin, field
    // for field, verbatim.
    const interaction: MatchOutcomeInteraction = {
      kind: "match_outcome",
      tenantId: demand.tenantId,
      vendorId: satisfiable.vendor.vendorId,
      demandId: demand.demandId,
      satisfiable: satisfiable.satisfiable,
      rankScore: satisfiable.rankScore,
      recordedAt: T0,
      closedAt: T0,
    };
    expect(interaction.vendorId).toBe(v.vendorId);
    expect(interaction.satisfiable).toBe(true);
    expect(interaction.rankScore).toBeGreaterThan(0);
    const sc = scorecard([interaction]);
    expect(sc.matchSummary).toEqual({ total: 1, satisfiable: 1, rejected: 0 });
    expect(sc.interactionRefs).toEqual([demand.demandId]);
  });

  test("REAL W032 accepted quotes flow verbatim through the QuoteAcceptanceInteraction twin", () => {
    const v = realVendor();
    const demand = realDemand();
    const matched = matchDemand(demand, [v], { at: T0, correlationId: CORR });
    if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
    const quoteResult = issueQuote({
      demand,
      match: matched.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: T0,
      correlationId: CORR,
    });
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;
    const quote = quoteResult.quote;
    const appendedQuote = appendQuote(createQuoteLedger(TENANT_A), quote);
    expect(appendedQuote.ok).toBe(true);
    if (!appendedQuote.ok) return;
    const accepted = acceptQuote(appendedQuote.ledger, quote.quoteId, {
      at: DELIVERED_AT,
      correlationId: CORR,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.ledger.entries.some((e) => e.kind === "acceptance")).toBe(true);
    // The binding site projects the REAL accepted quote + the INJECTED
    // delivery evidence through the twin, verbatim.
    const interaction: QuoteAcceptanceInteraction = {
      kind: "quote_acceptance",
      tenantId: quote.tenantId,
      vendorId: quote.vendorId,
      demandId: quote.demandId,
      quoteId: quote.quoteId,
      unitPriceUsd: quote.unitPriceUsd,
      leadTimeDays: quote.leadTimeDays,
      warrantyDays: quote.warrantyDays,
      slaCoverage: quote.slaCoverage,
      acceptedAt: DELIVERED_AT,
      delivered: true,
      deliveredAt: DELIVERED_AT,
      deliveredUnitPriceUsd: 1500,
      slaMet: true,
      warrantyHonored: true,
      closedAt: DELIVERED_AT,
    };
    expect(interaction.quoteId).toMatch(/^qt_/);
    const sc = scorecard([interaction]);
    expect(sc.interactionRefs).toEqual([quote.quoteId]);
    const fulfillment = sc.dimensions.find((d) => d.kind === "fulfillment");
    expect(fulfillment?.numerator).toBe(1);
    expect(fulfillment?.denominator).toBe(1);
    expect(fulfillment?.value).toBe(1);
    expect(sc.dimensions.find((d) => d.kind === "quote_accuracy")?.value).toBe(1);
  });

  test("REAL W042 service work orders flow verbatim through the ServiceWorkOrderOutcomeInteraction twin", () => {
    // A REAL vendor declaring the service capability the work order needs
    // (the W042 matcher requires the service-category capability).
    const serviceVendorResult = buildVendor(TENANT_A, {
      ...createInput(),
      capabilities: [{ kind: "service", id: "service.battery" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
    });
    if (!serviceVendorResult.ok) throw new Error(serviceVendorResult.error.message);
    const v = serviceVendorResult.vendor;
    const built = buildServiceWorkOrder(TENANT_A, {
      deviceId: asDeviceId("dev_w072_service"),
      diagnosis: {
        hypothesisId: "hyp_w072",
        recommendationId: "tr_w072",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: {
          intentKind: "MaintainDeviceIntent",
          payload: { description: "Battery service for W072." },
        },
        observationIds: ["obs_w072_1"],
      },
      serviceArea: "us-east-1",
      deadline: "2026-02-01T00:00:00Z",
      slaFloor: { coverage: 0.8 },
      warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
      qualityFloor: { score: 0.7 },
      availabilityFloor: { ratio: 0.5 },
      serviceCategory: "service.battery",
      at: T0,
      correlationId: CORR,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const wo = built.workOrder;
    const matched = matchServiceWorkOrder(wo, [v], { at: T0, correlationId: CORR });
    expect(matched.ok).toBe(true);
    if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
    const matchedVendor = matched.matches[0]!.vendor;
    const interaction: ServiceWorkOrderOutcomeInteraction = {
      kind: "service_work_order_outcome",
      tenantId: wo.tenantId,
      vendorId: matchedVendor.vendorId,
      workOrderId: wo.workOrderId,
      serviceArea: wo.serviceArea,
      deadline: wo.deadline,
      completed: true,
      completedAt: "2026-01-18T00:00:00Z",
      slaMet: true,
      warrantyHonored: false,
      closedAt: "2026-01-18T00:00:00Z",
    };
    expect(interaction.workOrderId).toMatch(/^swo_/);
    expect(interaction.vendorId).toBe(v.vendorId);
    const sc = scorecard([interaction]);
    expect(sc.interactionRefs).toEqual([wo.workOrderId]);
    const warranty = sc.dimensions.find((d) => d.kind === "warranty_honoring");
    expect(warranty?.numerator).toBe(0);
    expect(warranty?.denominator).toBe(1);
    expect(warranty?.value).toBe(0);
  });
});

describe("W072 D5: audit emission (the injected sink seam)", () => {
  test("a successful build emits exactly one vendors.scorecard.recorded record; failures emit none", () => {
    const sink = createInMemoryVendorsOutcomeAuditSink();
    const ok = buildVendorScorecard(
      TENANT_A,
      { vendorId: VND_1, window: WINDOW, interactions: [quoteInteraction()], at: T1, correlationId: CORR },
      sink,
    );
    expect(ok.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe(SCORECARD_AUDIT_ACTIONS.scorecardRecorded);
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(ok.ok ? ok.scorecard.scorecardId : null);
    expect(record.occurredAt).toBe(T1);
    expect(record.correlationId).toBe(CORR);
    const details = record.details as { revision: number; vendorId: string; contentHash: string };
    expect(details.revision).toBe(1);
    expect(details.vendorId).toBe(VND_1);
    expect(typeof details.contentHash).toBe("string");

    const failed = buildVendorScorecard(
      TENANT_A,
      { vendorId: VND_1, window: WINDOW, interactions: [], at: T1, correlationId: CORR },
      sink,
    );
    expect(failed.ok).toBe(false);
    expect(sink.records.length).toBe(1);
  });

  test("the W012 sink adapter satisfies VendorsOutcomeAuditSink structurally; records land in the REAL hash-chained log", () => {
    const log = createInMemoryAuditLog();
    const sink: VendorsOutcomeAuditSink = createAuditSinkAdapter(log, {
      source: "vendors.scorecard.test",
    });
    const built = buildVendorScorecard(
      TENANT_A,
      { vendorId: VND_1, window: WINDOW, interactions: [quoteInteraction(), serviceInteraction()], at: T1, correlationId: CORR },
      sink,
    );
    expect(built.ok).toBe(true);
    const ctx = makeTenantContext(TENANT_A, CORR);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    const record = records[0]!;
    expect(record.action).toBe("vendors.scorecard.recorded");
    expect(record.source).toBe("vendors.scorecard.test");
    expect((record.details as { subject: string }).subject).toBe(
      built.ok ? built.scorecard.scorecardId : "",
    );
    // The REAL hash-chained log verifies.
    expect(log.verify(ctx).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(record.sequence).toBe(1);
  });

  test("per-tenant chains stay separate in the REAL log", () => {
    const log = createInMemoryAuditLog();
    const sink: AuditSink = createAuditSinkAdapter(log, { source: "vendors.scorecard.test" });
    buildVendorScorecard(
      TENANT_A,
      { vendorId: VND_1, window: WINDOW, interactions: [quoteInteraction()], at: T1, correlationId: CORR },
      sink,
    );
    buildVendorScorecard(
      TENANT_B,
      {
        vendorId: VND_1,
        window: WINDOW,
        interactions: [quoteInteraction({ tenantId: TENANT_B })],
        at: T1,
        correlationId: CORR,
      },
      sink,
    );
    const ctxA = makeTenantContext(TENANT_A, CORR);
    const ctxB = makeTenantContext(TENANT_B, CORR);
    expect(log.records(ctxA).length).toBe(1);
    expect(log.records(ctxB).length).toBe(1);
    expect(log.verify(ctxA).ok).toBe(true);
    expect(log.verify(ctxB).ok).toBe(true);
  });
});

describe("W072 D5: byte-identical determinism", () => {
  test("the same inputs produce the byte-identical scorecard across runs", () => {
    const interactions: readonly ScorecardInteraction[] = [
      quoteInteraction(),
      serviceInteraction(),
      matchInteraction(),
    ];
    const a = scorecard(interactions);
    const b = scorecard(interactions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.scorecardId).toBe(b.scorecardId);
  });

  test("interaction input order NEVER matters (permutation invariance)", () => {
    const interactions: readonly ScorecardInteraction[] = [
      quoteInteraction(),
      quoteInteraction({ quoteId: "qt_w072quote00002", delivered: false, deliveredAt: null, deliveredUnitPriceUsd: null, slaMet: null, warrantyHonored: null }),
      serviceInteraction(),
      matchInteraction(),
      serviceInteraction({ workOrderId: "swo_w072service02", completed: false, completedAt: null, slaMet: null, warrantyHonored: null }),
    ];
    const forward = scorecard(interactions);
    const reversed = scorecard([...interactions].reverse());
    const rotated = scorecard([interactions[2]!, interactions[0]!, interactions[4]!, interactions[3]!, interactions[1]!]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(rotated));
    // The refs are carried in canonical (sorted) order.
    expect(forward.interactionRefs).toEqual([...forward.interactionRefs].sort());
  });

  test("object key insertion order never matters (canonical digests)", () => {
    const a = scorecard([quoteInteraction()]);
    const reordered = scorecard([
      {
        closedAt: DELIVERED_AT,
        warrantyHonored: true,
        slaMet: true,
        deliveredUnitPriceUsd: 100,
        deliveredAt: DELIVERED_AT,
        delivered: true,
        acceptedAt: T0,
        slaCoverage: 0.95,
        warrantyDays: 365,
        leadTimeDays: 7,
        unitPriceUsd: 100,
        quoteId: "qt_w072quote00001",
        demandId: "dmd_w072quote0001",
        vendorId: VND_1,
        tenantId: TENANT_A,
        kind: "quote_acceptance",
      },
    ]);
    expect(a.contentHash).toBe(reordered.contentHash);
    expect(a.scorecardId).toBe(reordered.scorecardId);
  });

  test("a second correlation id changes nothing structural (determinism is input-scoped)", () => {
    const a = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction()],
      at: T1,
      correlationId: CORR,
    });
    const b = buildVendorScorecard(TENANT_A, {
      vendorId: VND_1,
      window: WINDOW,
      interactions: [quoteInteraction()],
      at: T1,
      correlationId: CORR_2,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // The record content is identical (the correlation id is not part
    // of the record — it threads the audit trail only).
    expect(a.scorecard.contentHash).toBe(b.scorecard.contentHash);
    expect(a.scorecard.scorecardId).toBe(b.scorecard.scorecardId);
  });
});
