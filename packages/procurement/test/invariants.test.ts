/**
 * W032 D5 — Cross-cutting invariants: end-to-end determinism, frozen-
 * record discipline, the W022 → W032 pipeline (W022 recommendation
 * -> demand -> matching -> quote -> acceptance -> aggregation).
 *
 * These tests complement the per-module suites: they run FULL
 * pipelines and assert byte-identical outputs across runs and across
 * input permutations.
 */

import { describe, expect, test } from "bun:test";
import { asVendorId, asWorkloadId } from "@fleetos/contracts";
import { buildVendor } from "@fleetos/vendors";
import {
  appendQuote,
  acceptQuote,
  aggregateAcceptedQuotes,
  buildDemand,
  createDemand,
  createInMemoryProcurementAuditSink,
  createQuoteLedger,
  issueQuote,
  matchDemand,
} from "../src/index";
import {
  CORR,
  CORR_2,
  DEADLINE,
  TENANT_A,
  T0,
  T1,
  demandInput,
  matchOptions,
  stdCapability,
  stdInventory,
  stdTerms,
  vendorInput,
} from "./helpers";

/** The full deterministic pipeline under test. */
function runPipeline(audit: boolean) {
  const sink = createInMemoryProcurementAuditSink();
  const tenantId = TENANT_A;

  // Build a vendor (local fulfillment provider).
  const vendorBuilt = buildVendor(tenantId, vendorInput());
  if (!vendorBuilt.ok) throw new Error(vendorBuilt.error.message);

  // Build a demand from a W022 DRAFT ProcurementIntentPayload.
  const demandBuilt = buildDemand(tenantId, demandInput());
  if (!demandBuilt.ok) throw new Error(demandBuilt.error.message);

  // Match the demand against the vendor.
  const match = matchDemand(demandBuilt.demand, [vendorBuilt.vendor], {
    ...matchOptions(),
    auditSink: audit ? sink : undefined,
  });
  if (!match.ok) throw new Error(match.error.message);

  // Issue a quote (revision 1).
  const quote = issueQuote({
    demand: demandBuilt.demand,
    match: match.matches[0]!,
    unitPriceUsd: 1500,
    leadTimeDays: 7,
    warrantyDays: 365,
    slaCoverage: 0.95,
    at: T0,
    correlationId: CORR,
  }, audit ? sink : undefined);
  if (!quote.ok) throw new Error(quote.error.message);

  // Append to the ledger, accept, then aggregate.
  let ledger = createQuoteLedger(tenantId);
  const appended = appendQuote(ledger, quote.quote);
  if (!appended.ok) throw new Error(appended.error.message);
  ledger = appended.ledger;

  const accepted = acceptQuote(ledger, quote.quote.quoteId, {
    at: T1,
    correlationId: CORR_2,
    auditSink: audit ? sink : undefined,
  });
  if (!accepted.ok) throw new Error(accepted.error.message);
  ledger = accepted.ledger;

  const aggregation = aggregateAcceptedQuotes(
    tenantId,
    [{ demand: demandBuilt.demand, quote: quote.quote }],
    T1,
    CORR_2,
    audit ? sink : undefined,
  );
  if (!aggregation.ok) throw new Error(aggregation.error.message);

  return {
    vendor: vendorBuilt.vendor,
    demand: demandBuilt.demand,
    match: match.matches[0]!,
    quote: quote.quote,
    ledger,
    aggregation: aggregation.aggregations[0]!,
    auditRecords: sink.records,
  };
}

describe("invariants: end-to-end determinism", () => {
  test("the full pipeline is byte-identical across runs", () => {
    const first = runPipeline(true);
    const second = runPipeline(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("vendor input order never changes the matching output", () => {
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const v1 = buildVendor(TENANT_A, vendorInput({ vendorId: asVendorId("vnd_a") }));
    const v2 = buildVendor(TENANT_A, vendorInput({ vendorId: asVendorId("vnd_b") }));
    if (!v1.ok || !v2.ok) throw new Error("vendor build failed");
    const forward = matchDemand(built.demand, [v1.vendor, v2.vendor], matchOptions());
    const backward = matchDemand(built.demand, [v2.vendor, v1.vendor], matchOptions());
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  test("audit emission never changes the domain outputs (evidence, not side effect)", () => {
    const withAudit = runPipeline(true);
    const withoutAudit = runPipeline(false);
    expect(JSON.stringify(withoutAudit.vendor)).toBe(JSON.stringify(withAudit.vendor));
    expect(JSON.stringify(withoutAudit.demand)).toBe(JSON.stringify(withAudit.demand));
    expect(JSON.stringify(withoutAudit.match)).toBe(JSON.stringify(withAudit.match));
    expect(JSON.stringify(withoutAudit.quote)).toBe(JSON.stringify(withAudit.quote));
    expect(JSON.stringify(withoutAudit.aggregation)).toBe(JSON.stringify(withAudit.aggregation));
    expect(withAudit.auditRecords.length > 0).toBe(true);
    expect(withoutAudit.auditRecords.length).toBe(0);
  });
});

describe("invariants: revision immutability under store operations", () => {
  test("every record the package produces is frozen at construction", () => {
    const pipeline = runPipeline(true);
    expect(Object.isFrozen(pipeline.vendor)).toBe(true);
    expect(Object.isFrozen(pipeline.vendor.capabilities)).toBe(true);
    expect(Object.isFrozen(pipeline.vendor.inventory)).toBe(true);
    expect(Object.isFrozen(pipeline.vendor.terms)).toBe(true);
    expect(Object.isFrozen(pipeline.demand)).toBe(true);
    expect(Object.isFrozen(pipeline.demand.allowedSubstitutions)).toBe(true);
    expect(Object.isFrozen(pipeline.demand.rejectionEvidence)).toBe(true);
    expect(Object.isFrozen(pipeline.match)).toBe(true);
    expect(Object.isFrozen(pipeline.match.reasons)).toBe(true);
    expect(Object.isFrozen(pipeline.quote)).toBe(true);
    expect(Object.isFrozen(pipeline.aggregation)).toBe(true);
    expect(Object.isFrozen(pipeline.aggregation.memberDemandIds)).toBe(true);
    for (const record of pipeline.auditRecords) {
      expect(Object.isFrozen(record)).toBe(true);
    }
  });

  test("demand ids are deterministic for the same identity tuple", () => {
    const a = buildDemand(TENANT_A, demandInput());
    const b = buildDemand(TENANT_A, demandInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.demand.demandId).toBe(b.demand.demandId);
  });

  test("content hashes are unique per distinct content (vendor revisions)", () => {
    const prior = buildVendor(TENANT_A, vendorInput({ description: "rev1" }));
    const next = buildVendor(TENANT_A, vendorInput({ description: "rev2" }));
    expect(prior.ok && next.ok).toBe(true);
    if (!prior.ok || !next.ok) return;
    expect(prior.vendor.contentHash).not.toBe(next.vendor.contentHash);
  });
});

describe("invariants: no hidden state (purity)", () => {
  test("matchDemand never mutates the demand or vendors", () => {
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const vendor = buildVendor(TENANT_A, vendorInput());
    if (!vendor.ok) throw new Error(vendor.error.message);
    const demandSnapshot = JSON.stringify(built.demand);
    const vendorSnapshot = JSON.stringify(vendor.vendor);
    for (let run = 0; run < 3; run++) {
      matchDemand(built.demand, [vendor.vendor], matchOptions());
    }
    expect(JSON.stringify(built.demand)).toBe(demandSnapshot);
    expect(JSON.stringify(vendor.vendor)).toBe(vendorSnapshot);
  });
});

describe("invariants: the demand + workloadId linkage (W022 → W032)", () => {
  test("the demand carries the W022 ProcurementIntentPayload's workloadId", () => {
    const built = buildDemand(TENANT_A, demandInput({ procurementIntent: { workloadId: "wl_w022_link", description: "test" } }));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.demand.workloadId).toBe(asWorkloadId("wl_w022_link"));
  });
  test("the demand carries the W022 payload's description verbatim", () => {
    const built = buildDemand(TENANT_A, demandInput({ procurementIntent: { workloadId: "wl_x", description: "verbatim description from W022" } }));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.demand.description).toBe("verbatim description from W022");
  });
});

// Suppress unused-symbol lint.
void stdCapability;
void stdInventory;
void stdTerms;
void DEADLINE;
void createDemand;
