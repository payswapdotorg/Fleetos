/**
 * W072 D2/D5 tests — commercial reconciliation: the five machine-stable
 * discrepancy kinds with both-side refs verbatim, the READ-ONLY contract,
 * the structural seam over the REAL W032 surfaces, tenant isolation,
 * audit emission (into the REAL hash-chained log), and byte-identical
 * determinism.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId } from "@fleetos/contracts";
import type { CorrelationId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import {
  RECONCILIATION_AUDIT_ACTIONS,
  RECONCILIATION_MODEL_VERSION,
  RECONCILIATION_SCHEMA_VERSION,
  runCommercialReconciliation,
} from "../src/index";
import type {
  CommercialChainSource,
  ProcurementAuditSink,
} from "../src/index";
import { createInMemoryProcurementAuditSink } from "../src/audit-seam";
import { buildDemand } from "../src/demand";
import { issueQuote } from "../src/quotes";
import { matchDemand } from "../src/matching";
import {
  CORR,
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  VND_1,
  VND_2,
  demandInput,
  matchOptions,
  vendor,
} from "./helpers";

/** A second correlation id. */
const CORR_2: CorrelationId = asCorrelationId("cor_w072_recon2");

/** A fully-agreed, fully-delivered, clean chain. */
function cleanChain(overrides: Partial<CommercialChainSource> = {}): CommercialChainSource {
  return {
    demand: { tenantId: TENANT_A, demandId: "dmd_w072clean0001", quantity: 10 },
    quote: {
      quoteId: "qt_w072clean00001",
      vendorId: VND_1,
      unitPriceUsd: 100,
      slaCoverage: 0.95,
      warrantyDays: 365,
    },
    accepted: true,
    delivery: {
      deliveryId: "dlv_w072clean00001",
      deliveredQuantity: 10,
      deliveredUnitPriceUsd: 100,
      deliveredSlaCoverage: 0.95,
      deliveredWarrantyDays: 365,
      deliveredAt: T1,
    },
    ...overrides,
  };
}

/** Run a reconciliation for tenant A (throws on failure). */
function reconcile(
  chains: readonly CommercialChainSource[],
  overrides: { correlationId?: CorrelationId; at?: string } = {},
) {
  const result = runCommercialReconciliation(TENANT_A, chains, {
    at: overrides.at ?? T1,
    correlationId: overrides.correlationId ?? CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.report;
}

describe("W072 D2: the five machine-stable discrepancy kinds (both sides verbatim)", () => {
  test("a clean chain produces zero discrepancies and status counts", () => {
    const report = reconcile([cleanChain()]);
    expect(report.discrepancyCount).toBe(0);
    expect(report.discrepancies).toEqual([]);
    expect(report.byKind).toEqual({
      price_mismatch: 0,
      sla_breach: 0,
      warranty_gap: 0,
      undelivered: 0,
      over_delivered: 0,
    });
    expect(report.chainStatusCounts).toEqual({
      unquoted: 0,
      unaccepted: 0,
      agreed: 0,
      delivered: 1,
    });
    expect(report.chainCount).toBe(1);
    expect(report.reportId).toMatch(/^recon_[0-9a-f]{8}$/);
    expect(report.schemaVersion).toBe(RECONCILIATION_SCHEMA_VERSION);
    expect(report.modelVersion).toBe(RECONCILIATION_MODEL_VERSION);
  });

  test("an accepted chain with no delivery evidence classifies undelivered (both refs verbatim)", () => {
    const report = reconcile([
      cleanChain({
        delivery: null,
        demand: { tenantId: TENANT_A, demandId: "dmd_w072undeliv001", quantity: 5 },
      }),
    ]);
    expect(report.byKind.undelivered).toBe(1);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.kind).toBe("undelivered");
    expect(discrepancy.vendorId).toBe(VND_1);
    expect(discrepancy.demandRef).toBe("dmd_w072undeliv001");
    expect(discrepancy.quoteRef).toBe("qt_w072clean00001");
    expect(discrepancy.deliveryRef).toBeNull();
    expect(discrepancy.agreed).toEqual({
      quantity: 5,
      unitPriceUsd: 100,
      slaCoverage: 0.95,
      warrantyDays: 365,
    });
    expect(discrepancy.delivered).toBeNull();
  });

  test("a short delivery classifies undelivered; an over-delivery classifies over_delivered", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072short0001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072short00001",
          deliveredQuantity: 8,
          deliveredUnitPriceUsd: 100,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 365,
          deliveredAt: T1,
        },
      }),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072over00001", quantity: 4 },
        quote: {
          quoteId: "qt_w072over000001",
          vendorId: VND_1,
          unitPriceUsd: 100,
          slaCoverage: 0.95,
          warrantyDays: 365,
        },
        delivery: {
          deliveryId: "dlv_w072over000001",
          deliveredQuantity: 6,
          deliveredUnitPriceUsd: 100,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 365,
          deliveredAt: T1,
        },
      }),
    ]);
    expect(report.byKind.undelivered).toBe(1);
    expect(report.byKind.over_delivered).toBe(1);
    const short = report.discrepancies.find((d) => d.kind === "undelivered")!;
    expect(short.delivered?.quantity).toBe(8);
    expect(short.deliveryRef).toBe("dlv_w072short00001");
    const over = report.discrepancies.find((d) => d.kind === "over_delivered")!;
    expect(over.delivered?.quantity).toBe(6);
    expect(over.agreed.quantity).toBe(4);
  });

  test("a delivered price differing from the agreed price classifies price_mismatch", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072price0001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072price00001",
          deliveredQuantity: 10,
          deliveredUnitPriceUsd: 120,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 365,
          deliveredAt: T1,
        },
      }),
    ]);
    expect(report.byKind.price_mismatch).toBe(1);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.kind).toBe("price_mismatch");
    expect(discrepancy.agreed.unitPriceUsd).toBe(100);
    expect(discrepancy.delivered?.unitPriceUsd).toBe(120);
  });

  test("a delivered SLA below the agreed classifies sla_breach", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072sla00001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072sla000001",
          deliveredQuantity: 10,
          deliveredUnitPriceUsd: 100,
          deliveredSlaCoverage: 0.9,
          deliveredWarrantyDays: 365,
          deliveredAt: T1,
        },
      }),
    ]);
    expect(report.byKind.sla_breach).toBe(1);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.agreed.slaCoverage).toBe(0.95);
    expect(discrepancy.delivered?.slaCoverage).toBe(0.9);
  });

  test("a delivered warranty below the agreed classifies warranty_gap", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072warr0001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072warr000001",
          deliveredQuantity: 10,
          deliveredUnitPriceUsd: 100,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 180,
          deliveredAt: T1,
        },
      }),
    ]);
    expect(report.byKind.warranty_gap).toBe(1);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.agreed.warrantyDays).toBe(365);
    expect(discrepancy.delivered?.warrantyDays).toBe(180);
  });

  test("a delivery without acceptance classifies over_delivered (delivered without an agreed contract)", () => {
    const report = reconcile([
      cleanChain({
        accepted: false,
        demand: { tenantId: TENANT_A, demandId: "dmd_w072unacc0001", quantity: 10 },
      }),
    ]);
    expect(report.chainStatusCounts.unaccepted).toBe(1);
    expect(report.byKind.over_delivered).toBe(1);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.deliveryRef).toBe("dlv_w072clean00001");
  });

  test("an unquoted chain is summarized, never classified (no agreed side to reconcile against)", () => {
    const report = reconcile([
      cleanChain({
        quote: null,
        accepted: false,
        delivery: null,
        demand: { tenantId: TENANT_A, demandId: "dmd_w072unq00001", quantity: 10 },
      }),
    ]);
    expect(report.chainStatusCounts.unquoted).toBe(1);
    expect(report.discrepancyCount).toBe(0);
  });

  test("one chain can carry several discrepancies; the report sorts them canonically", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072multi0001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072multi0001",
          deliveredQuantity: 12,
          deliveredUnitPriceUsd: 130,
          deliveredSlaCoverage: 0.5,
          deliveredWarrantyDays: 30,
          deliveredAt: T1,
        },
      }),
    ]);
    // over_delivered + price_mismatch + sla_breach + warranty_gap (quantity 12 > 10 so not undelivered).
    expect(report.discrepancies.map((d) => d.kind)).toEqual([
      "price_mismatch",
      "sla_breach",
      "warranty_gap",
      "over_delivered",
    ]);
    expect(report.discrepancyCount).toBe(4);
  });
});

describe("W072 D2: READ-ONLY (a report surface, never a mutation path)", () => {
  test("the chains are never mutated; the report is frozen", () => {
    const chains: CommercialChainSource[] = [
      cleanChain(),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072ro000001", quantity: 3 },
        delivery: null,
      }),
    ];
    const before = JSON.stringify(chains);
    const report = reconcile(chains);
    expect(JSON.stringify(chains)).toBe(before);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.discrepancies)).toBe(true);
  });
});

describe("W072 D2: validation (fail closed, machine-stable)", () => {
  test("an empty chain set refuses", () => {
    const result = runCommercialReconciliation(TENANT_A, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("procurement.reconciliation.invalid_request");
    expect(JSON.stringify(result.error)).toContain("must_be_non_empty_array");
  });

  test("a foreign-tenant chain refuses (tenant isolation by construction)", () => {
    const result = runCommercialReconciliation(TENANT_A, [
      cleanChain({
        demand: { tenantId: TENANT_B, demandId: "dmd_w072foreign01", quantity: 1 },
      }),
    ], { at: T1, correlationId: CORR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("tenant_mismatch");
  });

  test("a duplicate demand ref refuses (the chain identity)", () => {
    const result = runCommercialReconciliation(
      TENANT_A,
      [cleanChain(), cleanChain()],
      { at: T1, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("duplicate_demand_ref");
  });

  test("an accepted chain without a quote refuses; invalid quantities refuse", () => {
    const noQuote = runCommercialReconciliation(TENANT_A, [
      cleanChain({ quote: null, accepted: true }),
    ], { at: T1, correlationId: CORR });
    expect(noQuote.ok).toBe(false);
    if (noQuote.ok) return;
    expect(JSON.stringify(noQuote.error)).toContain("required_when_accepted");

    const badQuantity = runCommercialReconciliation(TENANT_A, [
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072badq0001", quantity: 0 },
      }),
    ], { at: T1, correlationId: CORR });
    expect(badQuantity.ok).toBe(false);
    if (badQuantity.ok) return;
    expect(JSON.stringify(badQuantity.error)).toContain("must_be_integer_at_least_1");
  });

  test("a non-ISO at refuses", () => {
    const result = runCommercialReconciliation(TENANT_A, [cleanChain()], {
      at: "not-a-timestamp",
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
  });
});

describe("W072 D5: structural seam binding over the REAL W032 surfaces", () => {
  test("a REAL demand + accepted quote project verbatim into the chain twin", () => {
    const v = vendor();
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const demand = built.demand;
    const matched = matchDemand(demand, [v], matchOptions());
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
    if (!quoteResult.ok) throw new Error(quoteResult.error.message);
    const quote = quoteResult.quote;
    // The binding site projects the REAL records field-for-field.
    const chain: CommercialChainSource = {
      demand: {
        tenantId: demand.tenantId,
        demandId: demand.demandId,
        quantity: demand.quantity,
      },
      quote: {
        quoteId: quote.quoteId,
        vendorId: quote.vendorId,
        unitPriceUsd: quote.unitPriceUsd,
        slaCoverage: quote.slaCoverage,
        warrantyDays: quote.warrantyDays,
      },
      accepted: true,
      delivery: {
        deliveryId: `dlv_${quote.quoteId.slice(3)}`,
        deliveredQuantity: demand.quantity,
        deliveredUnitPriceUsd: quote.unitPriceUsd,
        deliveredSlaCoverage: quote.slaCoverage,
        deliveredWarrantyDays: quote.warrantyDays,
        deliveredAt: T1,
      },
    };
    const report = reconcile([chain]);
    expect(report.discrepancyCount).toBe(0);
    expect(report.chainStatusCounts.delivered).toBe(1);
    expect(report.chainCount).toBe(1);
    // A price drift on the SAME real quote classifies machine-stably.
    const drifted = reconcile([
      { ...chain, delivery: { ...chain.delivery!, deliveredUnitPriceUsd: 1600 } },
    ]);
    expect(drifted.byKind.price_mismatch).toBe(1);
    expect(drifted.discrepancies[0]!.quoteRef).toBe(quote.quoteId);
    expect(drifted.discrepancies[0]!.demandRef).toBe(demand.demandId);
  });
});

describe("W072 D5: audit emission (the injected sink seam)", () => {
  test("a successful run emits exactly one procurement.reconciliation.computed record; failures emit none", () => {
    const sink = createInMemoryProcurementAuditSink();
    const ok = runCommercialReconciliation(TENANT_A, [cleanChain()], {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(ok.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe(RECONCILIATION_AUDIT_ACTIONS.reportComputed);
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(ok.ok ? ok.report.reportId : "");
    expect(record.occurredAt).toBe(T1);
    expect(record.correlationId).toBe(CORR);
    const details = record.details as { chainCount: number; readOnly: boolean };
    expect(details.chainCount).toBe(1);
    expect(details.readOnly).toBe(true);

    const failed = runCommercialReconciliation(TENANT_A, [], {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(failed.ok).toBe(false);
    expect(sink.records.length).toBe(1);
  });

  test("the W012 sink adapter satisfies ProcurementAuditSink; records land in the REAL hash-chained log", () => {
    const log = createInMemoryAuditLog();
    const sink: ProcurementAuditSink = createAuditSinkAdapter(log, {
      source: "procurement.reconciliation.test",
    });
    runCommercialReconciliation(
      TENANT_A,
      [
        cleanChain(),
        cleanChain({
          demand: { tenantId: TENANT_A, demandId: "dmd_w072audit0001", quantity: 10 },
          delivery: null,
        }),
      ],
      { at: T1, correlationId: CORR, auditSink: sink },
    );
    const ctx = makeTenantContext(TENANT_A, CORR);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    expect(records[0]!.action).toBe("procurement.reconciliation.computed");
    expect(records[0]!.source).toBe("procurement.reconciliation.test");
    expect(log.verify(ctx).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    // Cross-context read sees only its own chain.
    const ctxB = makeTenantContext(TENANT_B, CORR);
    expect(log.records(ctxB).length).toBe(0);
  });
});

describe("W072 D5: byte-identical determinism", () => {
  test("the same chains produce the byte-identical report across runs", () => {
    const chains: readonly CommercialChainSource[] = [
      cleanChain(),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072det000001", quantity: 9 },
        delivery: null,
      }),
    ];
    const a = reconcile(chains);
    const b = reconcile(chains);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.reportId).toBe(b.reportId);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("chain input order NEVER matters (permutation invariance)", () => {
    const chains: readonly CommercialChainSource[] = [
      cleanChain(),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072perm0001", quantity: 9 },
        delivery: null,
      }),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072perm0002", quantity: 2 },
        quote: {
          quoteId: "qt_w072perm000002",
          vendorId: VND_2,
          unitPriceUsd: 50,
          slaCoverage: 0.9,
          warrantyDays: 180,
        },
      }),
    ];
    const forward = reconcile(chains);
    const reversed = reconcile([...chains].reverse());
    const rotated = reconcile([chains[1]!, chains[2]!, chains[0]!]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(rotated));
  });

  test("discrepancies sort canonically (kind order, then refs)", () => {
    const report = reconcile([
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072z000001", quantity: 10 },
        delivery: {
          deliveryId: "dlv_w072z0000001",
          deliveredQuantity: 3,
          deliveredUnitPriceUsd: 999,
          deliveredSlaCoverage: 0.2,
          deliveredWarrantyDays: 1,
          deliveredAt: T1,
        },
      }),
      cleanChain({
        demand: { tenantId: TENANT_A, demandId: "dmd_w072a000001", quantity: 10 },
        delivery: null,
      }),
    ]);
    const kinds = report.discrepancies.map((d) => d.kind);
    // Canonical kind order: price_mismatch < sla_breach < warranty_gap < undelivered < over_delivered.
    expect(kinds).toEqual([
      "price_mismatch",
      "sla_breach",
      "warranty_gap",
      "undelivered",
      "undelivered",
    ]);
    // Within one kind, the demand refs sort (a < z).
    const undeliveredRefs = report.discrepancies
      .filter((d) => d.kind === "undelivered")
      .map((d) => d.demandRef);
    expect(undeliveredRefs).toEqual([...undeliveredRefs].sort());
  });

  test("the correlation id changes nothing structural (input-scoped determinism)", () => {
    const chains: readonly CommercialChainSource[] = [cleanChain()];
    const a = reconcile(chains);
    const b = reconcile(chains, { correlationId: CORR_2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
