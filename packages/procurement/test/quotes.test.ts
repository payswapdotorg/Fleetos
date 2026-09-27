/**
 * W032 D3 tests — versioned Quote contracts: issuance, acceptance
 * (PROPOSAL-GATED), supersession, aggregation.
 */

import { describe, expect, test } from "bun:test";
import type { VendorMatch } from "../src/matching";
import { acceptQuote, appendQuote, createQuoteLedger, issueQuote, quoteStatus, resolveActiveQuote, supersedeQuote, formAggregation, aggregateAcceptedQuotes } from "../src/quotes";
import type { Quote } from "../src/quotes";
import { createInMemoryProcurementAuditSink } from "../src/audit-seam";
import { buildDemand } from "../src/demand";
import { matchDemand } from "../src/matching";
import {
  CORR,
  CORR_2,
  DEADLINE,
  TENANT_A,
  T0,
  T1,
  VND_1,
  demandInput,
  matchOptions,
  vendor,
} from "./helpers";

function setup(): { quote: Quote; match: VendorMatch } {
  const built = buildDemand(TENANT_A, demandInput());
  if (!built.ok) throw new Error(built.error.message);
  const matchResult = matchDemand(built.demand, [vendor()], matchOptions());
  if (!matchResult.ok) throw new Error(matchResult.error.message);
  const match = matchResult.matches[0];
  if (match === undefined) throw new Error("no match");
  const quoteResult = issueQuote({
    demand: built.demand,
    match,
    unitPriceUsd: 1500,
    leadTimeDays: 7,
    warrantyDays: 365,
    slaCoverage: 0.95,
    at: T0,
    correlationId: CORR,
  });
  if (!quoteResult.ok) throw new Error(quoteResult.error.message);
  return { quote: quoteResult.quote, match };
}

describe("D3: quote issuance (versioned, deterministic)", () => {
  test("issueQuote produces a frozen revision-1 quote in ISSUED status", () => {
    const { quote } = setup();
    expect(quote.quoteVersion).toBe(1);
    expect(quote.status).toBe("ISSUED");
    expect(quote.unitPriceUsd).toBe(1500);
    expect(quote.totalPriceUsd).toBe(1500);
    expect(quote.leadTimeDays).toBe(7);
    expect(quote.warrantyDays).toBe(365);
    expect(quote.slaCoverage).toBe(0.95);
    expect(quote.vendorId).toBe(VND_1);
    expect(quote.issuedAt).toBe(T0);
    expect(quote.supersedes).toBeUndefined();
    expect(Object.isFrozen(quote)).toBe(true);
  });

  test("deterministic: the same inputs produce byte-identical quotes", () => {
    const a = setup().quote;
    const b = setup().quote;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("emits one procurement.quote.issued audit record per issuance", () => {
    const sink = createInMemoryProcurementAuditSink();
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const matchResult = matchDemand(built.demand, [vendor()], matchOptions());
    if (!matchResult.ok) throw new Error(matchResult.error.message);
    const result = issueQuote({
      demand: built.demand,
      match: matchResult.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: T0,
      correlationId: CORR,
    }, sink);
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe("procurement.quote.issued");
  });

  test("validation rejects invalid inputs", () => {
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const matchResult = matchDemand(built.demand, [vendor()], matchOptions());
    if (!matchResult.ok) throw new Error(matchResult.error.message);
    expect(issueQuote({
      demand: built.demand,
      match: matchResult.matches[0]!,
      unitPriceUsd: -1,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: T0,
      correlationId: CORR,
    }).ok).toBe(false);
    expect(issueQuote({
      demand: built.demand,
      match: matchResult.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 1.5,
      at: T0,
      correlationId: CORR,
    }).ok).toBe(false);
  });
});

describe("D3: quote ledger (append-only with supersession)", () => {
  test("appendQuote appends without rewriting history; duplicate ids fail", () => {
    const { quote } = setup();
    const ledger = createQuoteLedger(TENANT_A);
    const first = appendQuote(ledger, quote);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = appendQuote(first.ledger, quote);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.invariant).toBe("duplicate_quote_id");
  });

  test("tenant scope mismatch is rejected", () => {
    const { quote } = setup();
    const ledger = createQuoteLedger(TENANT_B);
    const result = appendQuote(ledger, quote);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.invariant).toBe("tenant_mismatch");
  });

  test("quoteStatus resolves ACTIVE/SUPERSEDED/unknown", () => {
    const { quote } = setup();
    const ledger = createQuoteLedger(TENANT_A);
    expect(quoteStatus(ledger, quote.quoteId)).toBe("unknown");
    const appended = appendQuote(ledger, quote);
    if (!appended.ok) throw new Error(appended.error.message);
    expect(quoteStatus(appended.ledger, quote.quoteId)).toBe("ISSUED");
    // Supersede: a new revision supersedes the prior.
    const next = supersedeQuote(quote, {
      unitPriceUsd: 1400,
      leadTimeDays: 5,
      warrantyDays: 400,
      slaCoverage: 0.96,
      at: T1,
      correlationId: CORR_2,
    });
    if (!next.ok) throw new Error(next.error.message);
    const finalLedger = appendQuote(appended.ledger, next.quote);
    if (!finalLedger.ok) throw new Error(finalLedger.error.message);
    expect(quoteStatus(finalLedger.ledger, quote.quoteId)).toBe("SUPERSEDED");
    expect(quoteStatus(finalLedger.ledger, next.quote.quoteId)).toBe("ISSUED");
  });
});

describe("D3: quote acceptance (PROPOSAL-GATED — never automatic)", () => {
  test("acceptQuote transitions ISSUED -> ACCEPTED (recorded as a new ledger entry)", () => {
    const { quote } = setup();
    const ledger = createQuoteLedger(TENANT_A);
    const appended = appendQuote(ledger, quote);
    if (!appended.ok) throw new Error(appended.error.message);
    const accepted = acceptQuote(appended.ledger, quote.quoteId, {
      at: T1,
      correlationId: CORR_2,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.acceptance.acceptedAt).toBe(T1);
    expect(accepted.ledger.entries.length).toBe(2);
    expect(accepted.ledger.entries[1]?.kind).toBe("acceptance");
  });

  test("emits one procurement.quote.accepted audit record", () => {
    const { quote } = setup();
    const sink = createInMemoryProcurementAuditSink();
    const ledger = createQuoteLedger(TENANT_A);
    const appended = appendQuote(ledger, quote);
    if (!appended.ok) throw new Error(appended.error.message);
    acceptQuote(appended.ledger, quote.quoteId, {
      at: T1,
      correlationId: CORR_2,
      auditSink: sink,
    });
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe("procurement.quote.accepted");
  });

  test("cannot accept an unknown quote", () => {
    const ledger = createQuoteLedger(TENANT_A);
    const result = acceptQuote(ledger, "qt_unknown", { at: T1, correlationId: CORR_2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind !== "DomainError") return;
    expect(result.error.invariant).toBe("quote_unknown");
  });

  test("cannot accept an already-accepted quote", () => {
    const { quote } = setup();
    const ledger = createQuoteLedger(TENANT_A);
    const appended = appendQuote(ledger, quote);
    if (!appended.ok) throw new Error(appended.error.message);
    const first = acceptQuote(appended.ledger, quote.quoteId, { at: T1, correlationId: CORR_2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = acceptQuote(first.ledger, quote.quoteId, { at: T1, correlationId: CORR_2 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("DomainError");
    if (second.error.kind !== "DomainError") return;
    expect(second.error.invariant).toBe("already_accepted");
  });
});

describe("D3: quote supersession (versioned-interpretation discipline)", () => {
  test("supersedeQuote produces revision+1 with supersedes pointing at the prior", () => {
    const { quote } = setup();
    const next = supersedeQuote(quote, {
      unitPriceUsd: 1400,
      leadTimeDays: 5,
      warrantyDays: 400,
      slaCoverage: 0.96,
      at: T1,
      correlationId: CORR_2,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.quote.quoteVersion).toBe(2);
    expect(next.quote.supersedes).toBe(quote.quoteId);
    expect(next.quote.unitPriceUsd).toBe(1400);
    expect(next.quote.status).toBe("ISSUED");
  });

  test("emits one procurement.quote.superseded audit record (subject is the prior)", () => {
    const { quote } = setup();
    const sink = createInMemoryProcurementAuditSink();
    supersedeQuote(quote, {
      unitPriceUsd: 1400,
      leadTimeDays: 5,
      warrantyDays: 400,
      slaCoverage: 0.96,
      at: T1,
      correlationId: CORR_2,
    }, sink);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe("procurement.quote.superseded");
    expect(sink.records[0]?.subject).toBe(quote.quoteId);
  });

  test("resolveActiveQuote returns the latest non-superseded revision", () => {
    const { quote } = setup();
    const next = supersedeQuote(quote, {
      unitPriceUsd: 1400,
      leadTimeDays: 5,
      warrantyDays: 400,
      slaCoverage: 0.96,
      at: T1,
      correlationId: CORR_2,
    });
    if (!next.ok) throw new Error(next.error.message);
    let ledger = createQuoteLedger(TENANT_A);
    const a = appendQuote(ledger, quote);
    if (!a.ok) throw new Error(a.error.message);
    const b = appendQuote(a.ledger, next.quote);
    if (!b.ok) throw new Error(b.error.message);
    ledger = b.ledger;
    const active = resolveActiveQuote(ledger, quote.demandId, quote.vendorId);
    expect(active?.quoteVersion).toBe(2);
    expect(active?.unitPriceUsd).toBe(1400);
  });
});

describe("D3: compatible-order aggregation", () => {
  test("formAggregation produces a deterministic aggregation record", () => {
    const { quote } = setup();
    const result = formAggregation(
      TENANT_A,
      VND_1,
      "us-east-1",
      DEADLINE,
      [quote],
      T1,
      CORR_2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agg = result.aggregation;
    expect(agg.tenantId).toBe(TENANT_A);
    expect(agg.vendorId).toBe(VND_1);
    expect(agg.deliveryArea).toBe("us-east-1");
    expect(agg.deadline).toBe(DEADLINE);
    expect(agg.memberDemandIds.length).toBe(1);
    expect(agg.totalAggregatedPriceUsd).toBe(1500);
    expect(agg.formedAt).toBe(T1);
    expect(Object.isFrozen(agg)).toBe(true);
    expect(agg.aggregationId.startsWith("agg_")).toBe(true);
  });

  test("aggregateAcceptedQuotes groups compatible pairs by (vendor, deliveryArea, deadline)", () => {
    const built1 = buildDemand(TENANT_A, demandInput());
    if (!built1.ok) throw new Error(built1.error.message);
    const built2 = buildDemand(TENANT_A, demandInput({ procurementIntent: { workloadId: "wl_testworkload02", description: "second demand" } }));
    if (!built2.ok) throw new Error(built2.error.message);
    const match1 = matchDemand(built1.demand, [vendor()], matchOptions());
    const match2 = matchDemand(built2.demand, [vendor()], matchOptions());
    if (!match1.ok || !match2.ok) throw new Error("match failed");
    const quote1 = issueQuote({
      demand: built1.demand,
      match: match1.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: T0,
      correlationId: CORR,
    });
    const quote2 = issueQuote({
      demand: built2.demand,
      match: match2.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: T0,
      correlationId: CORR,
    });
    if (!quote1.ok || !quote2.ok) throw new Error("issue failed");
    // Two demands with the same (vendor, deliveryArea, deadline) -> one group.
    const result = aggregateAcceptedQuotes(
      TENANT_A,
      [
        { demand: built1.demand, quote: quote1.quote },
        { demand: built2.demand, quote: quote2.quote },
      ],
      T1,
      CORR_2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aggregations.length).toBe(1);
    const agg = result.aggregations[0]!;
    expect(agg.memberDemandIds.length).toBe(2);
    // Sorted by demandId.
    expect(agg.memberDemandIds).toEqual([...agg.memberDemandIds].sort());
    expect(agg.totalAggregatedPriceUsd).toBe(3000);
  });

  test("formAggregation validation rejects empty quote lists", () => {
    const result = formAggregation(TENANT_A, VND_1, "us-east-1", DEADLINE, [], T1, CORR_2);
    expect(result.ok).toBe(false);
  });
});

// Local import for the tenant B ledger test.
import { asTenantId } from "@fleetos/contracts";
const TENANT_B = asTenantId("tnt_testtenant000b");
