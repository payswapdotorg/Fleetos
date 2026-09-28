/**
 * W072 D2/D5 tests — subscription commercial reconciliation: the
 * five-kind machine-stable classification over subscription ->
 * agreed terms -> provision evidence chains, the structural seam over
 * the REAL SoftwareSubscription record, the READ-ONLY contract, audit
 * emission (into the REAL hash-chained log), and byte-identical
 * determinism.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import {
  SOFTWARE_RECONCILIATION_AUDIT_ACTIONS,
  SUBSCRIPTION_RECONCILIATION_MODEL_VERSION,
  SUBSCRIPTION_RECONCILIATION_SCHEMA_VERSION,
  runSubscriptionReconciliation,
} from "../src/index";
import type {
  SoftwareAuditSink,
  SubscriptionChainSource,
} from "../src/index";
import { createInMemorySoftwareAuditSink } from "../src/audit-seam";
import { allocateSubscription } from "../src/subscription";
import { CORR, T0, T1, TENANT_A, TENANT_B, WL_1, allocateInput } from "./helpers";

/** A second correlation id. */
const CORR_2: CorrelationId = asCorrelationId("cor_w072_srecon2");

/** A fully-agreed, fully-provisioned, clean chain. */
function cleanChain(overrides: Partial<SubscriptionChainSource> = {}): SubscriptionChainSource {
  return {
    subscription: {
      tenantId: TENANT_A,
      subscriptionId: "sub_w072clean0001",
      softwareId: "app.bi_dashboard",
      agreedSeatCount: 5,
      agreedTermDays: 365,
    },
    agreed: {
      unitPriceUsd: 20,
      slaCoverage: 0.95,
      warrantyDays: 90,
    },
    provision: {
      provisionId: "prv_w072clean00001",
      provisionedSeatCount: 5,
      provisionedTermDays: 365,
      deliveredUnitPriceUsd: 20,
      deliveredSlaCoverage: 0.95,
      deliveredWarrantyDays: 90,
      provisionedAt: T1,
    },
    ...overrides,
  };
}

/** Run a subscription reconciliation for tenant A (throws on failure). */
function reconcile(
  chains: readonly SubscriptionChainSource[],
  overrides: { correlationId?: CorrelationId } = {},
) {
  const result = runSubscriptionReconciliation(TENANT_A, chains, {
    at: T1,
    correlationId: overrides.correlationId ?? CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.report;
}

describe("W072 D2: the five-kind classification over subscription chains", () => {
  test("a clean chain produces zero discrepancies with both counts carried", () => {
    const report = reconcile([cleanChain()]);
    expect(report.discrepancyCount).toBe(0);
    expect(report.chainCount).toBe(1);
    expect(report.provisionedChainCount).toBe(1);
    expect(report.byKind).toEqual({
      price_mismatch: 0,
      sla_breach: 0,
      warranty_gap: 0,
      undelivered: 0,
      over_delivered: 0,
    });
    expect(report.reportId).toMatch(/^srecon_[0-9a-f]{8}$/);
    expect(report.schemaVersion).toBe(SUBSCRIPTION_RECONCILIATION_SCHEMA_VERSION);
    expect(report.modelVersion).toBe(SUBSCRIPTION_RECONCILIATION_MODEL_VERSION);
  });

  test("no provision evidence classifies undelivered (both refs verbatim)", () => {
    const report = reconcile([
      cleanChain({
        provision: null,
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072unprov0001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
      }),
    ]);
    expect(report.byKind.undelivered).toBe(1);
    expect(report.provisionedChainCount).toBe(0);
    const discrepancy = report.discrepancies[0]!;
    expect(discrepancy.kind).toBe("undelivered");
    expect(discrepancy.subscriptionRef).toBe("sub_w072unprov0001");
    expect(discrepancy.provisionRef).toBeNull();
    expect(discrepancy.agreed.seatCount).toBe(5);
    expect(discrepancy.delivered).toBeNull();
  });

  test("provisioned seats short of the agreed classify undelivered; overages classify over_delivered", () => {
    const report = reconcile([
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072short0001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
        provision: {
          provisionId: "prv_w072short00001",
          provisionedSeatCount: 3,
          provisionedTermDays: 365,
          deliveredUnitPriceUsd: 20,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 90,
          provisionedAt: T1,
        },
      }),
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072over00001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 2,
          agreedTermDays: 365,
        },
        provision: {
          provisionId: "prv_w072over000001",
          provisionedSeatCount: 6,
          provisionedTermDays: 365,
          deliveredUnitPriceUsd: 20,
          deliveredSlaCoverage: 0.95,
          deliveredWarrantyDays: 90,
          provisionedAt: T1,
        },
      }),
    ]);
    expect(report.byKind.undelivered).toBe(1);
    expect(report.byKind.over_delivered).toBe(1);
    const short = report.discrepancies.find((d) => d.kind === "undelivered")!;
    expect(short.delivered?.seatCount).toBe(3);
    expect(short.provisionRef).toBe("prv_w072short00001");
    const over = report.discrepancies.find((d) => d.kind === "over_delivered")!;
    expect(over.agreed.seatCount).toBe(2);
    expect(over.delivered?.seatCount).toBe(6);
  });

  test("price, SLA and warranty mismatches classify machine-stably (both snapshots verbatim)", () => {
    const report = reconcile([
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072terms0001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
        provision: {
          provisionId: "prv_w072terms0001",
          provisionedSeatCount: 5,
          provisionedTermDays: 365,
          deliveredUnitPriceUsd: 25,
          deliveredSlaCoverage: 0.8,
          deliveredWarrantyDays: 30,
          provisionedAt: T1,
        },
      }),
    ]);
    expect(report.discrepancies.map((d) => d.kind)).toEqual([
      "price_mismatch",
      "sla_breach",
      "warranty_gap",
    ]);
    const price = report.discrepancies[0]!;
    expect(price.agreed.unitPriceUsd).toBe(20);
    expect(price.delivered?.unitPriceUsd).toBe(25);
    const sla = report.discrepancies[1]!;
    expect(sla.agreed.slaCoverage).toBe(0.95);
    expect(sla.delivered?.slaCoverage).toBe(0.8);
    const warranty = report.discrepancies[2]!;
    expect(warranty.agreed.warrantyDays).toBe(90);
    expect(warranty.delivered?.warrantyDays).toBe(30);
    // The term facts are carried in both snapshots (documented: not
    // classified — the v1 taxonomy has no term kind).
    expect(warranty.agreed.termDays).toBe(365);
    expect(warranty.delivered?.termDays).toBe(365);
  });
});

describe("W072 D2: READ-ONLY (a report surface, never a mutation path)", () => {
  test("the chains are never mutated; the report is frozen", () => {
    const chains: SubscriptionChainSource[] = [
      cleanChain(),
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072ro0000001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
        provision: null,
      }),
    ];
    const before = JSON.stringify(chains);
    const report = reconcile(chains);
    expect(JSON.stringify(chains)).toBe(before);
    expect(Object.isFrozen(report)).toBe(true);
  });
});

describe("W072 D2: validation (fail closed, machine-stable)", () => {
  test("an empty chain set refuses", () => {
    const result = runSubscriptionReconciliation(TENANT_A, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("software.reconciliation.invalid_request");
    expect(JSON.stringify(result.error)).toContain("must_be_non_empty_array");
  });

  test("a foreign-tenant chain refuses (tenant isolation by construction)", () => {
    const result = runSubscriptionReconciliation(TENANT_A, [
      cleanChain({
        subscription: {
          tenantId: TENANT_B,
          subscriptionId: "sub_w072foreign01",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
      }),
    ], { at: T1, correlationId: CORR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("tenant_mismatch");
  });

  test("a duplicate subscription ref refuses (the chain identity)", () => {
    const result = runSubscriptionReconciliation(TENANT_A, [cleanChain(), cleanChain()], {
      at: T1,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("duplicate_subscription_ref");
  });

  test("a non-integer seat count refuses", () => {
    const result = runSubscriptionReconciliation(TENANT_A, [
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072badseats01",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 2.5,
          agreedTermDays: 365,
        },
      }),
    ], { at: T1, correlationId: CORR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("must_be_integer_at_least_0");
  });
});

describe("W072 D5: structural seam binding over the REAL subscription record", () => {
  test("a REAL SoftwareSubscription projects verbatim into the SubscriptionChainFacts twin", () => {
    const allocated = allocateSubscription(TENANT_A, allocateInput({ at: T0, correlationId: CORR }));
    if (!allocated.ok) throw new Error(allocated.error.message);
    const subscription = allocated.subscription;
    expect(subscription.subscriptionId).toMatch(/^sub_/);
    // The binding site projects the REAL subscription's commercial
    // facts field-for-field, verbatim.
    const chain: SubscriptionChainSource = {
      subscription: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.subscriptionId,
        softwareId: subscription.softwareId,
        agreedSeatCount: subscription.seatCount,
        agreedTermDays: subscription.termDays,
      },
      agreed: { unitPriceUsd: 20, slaCoverage: 0.95, warrantyDays: 90 },
      provision: {
        provisionId: `prv_${subscription.subscriptionId.slice(4)}`,
        provisionedSeatCount: subscription.seatCount,
        provisionedTermDays: subscription.termDays,
        deliveredUnitPriceUsd: 20,
        deliveredSlaCoverage: 0.95,
        deliveredWarrantyDays: 90,
        provisionedAt: T1,
      },
    };
    const report = reconcile([chain]);
    expect(report.discrepancyCount).toBe(0);
    // A seat shortfall on the SAME real subscription classifies machine-stably.
    const short = reconcile([
      { ...chain, provision: { ...chain.provision!, provisionedSeatCount: subscription.seatCount - 1 } },
    ]);
    expect(short.byKind.undelivered).toBe(1);
    expect(short.discrepancies[0]!.subscriptionRef).toBe(subscription.subscriptionId);
    expect(short.discrepancies[0]!.agreed.seatCount).toBe(subscription.seatCount);
  });
});

describe("W072 D5: audit emission (the injected sink seam)", () => {
  test("a successful run emits exactly one software.reconciliation.computed record; failures emit none", () => {
    const sink = createInMemorySoftwareAuditSink();
    const ok = runSubscriptionReconciliation(TENANT_A, [cleanChain()], {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(ok.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe(SOFTWARE_RECONCILIATION_AUDIT_ACTIONS.reportComputed);
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(ok.ok ? ok.report.reportId : "");
    expect(record.occurredAt).toBe(T1);
    expect(record.correlationId).toBe(CORR);
    const details = record.details as { chainCount: number; readOnly: boolean };
    expect(details.chainCount).toBe(1);
    expect(details.readOnly).toBe(true);

    const failed = runSubscriptionReconciliation(TENANT_A, [], {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(failed.ok).toBe(false);
    expect(sink.records.length).toBe(1);
  });

  test("the W012 sink adapter satisfies SoftwareAuditSink; records land in the REAL hash-chained log", () => {
    const log = createInMemoryAuditLog();
    const sink: SoftwareAuditSink = createAuditSinkAdapter(log, {
      source: "software.reconciliation.test",
    });
    runSubscriptionReconciliation(TENANT_A, [cleanChain()], {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    const ctx = makeTenantContext(TENANT_A, CORR);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    expect(records[0]!.action).toBe("software.reconciliation.computed");
    expect(log.verify(ctx).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    const ctxB = makeTenantContext(TENANT_B, CORR);
    expect(log.records(ctxB).length).toBe(0);
  });
});

describe("W072 D5: byte-identical determinism", () => {
  test("the same chains produce the byte-identical report across runs", () => {
    const chains: readonly SubscriptionChainSource[] = [
      cleanChain(),
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072det0000001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 5,
          agreedTermDays: 365,
        },
        provision: null,
      }),
    ];
    const a = reconcile(chains);
    const b = reconcile(chains);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.reportId).toBe(b.reportId);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("chain input order NEVER matters (permutation invariance)", () => {
    const chains: readonly SubscriptionChainSource[] = [
      cleanChain(),
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072perm00001",
          softwareId: "app.bi_dashboard",
          agreedSeatCount: 8,
          agreedTermDays: 365,
        },
      }),
      cleanChain({
        subscription: {
          tenantId: TENANT_A,
          subscriptionId: "sub_w072perm00002",
          softwareId: "app.crm_suite",
          agreedSeatCount: 3,
          agreedTermDays: 30,
        },
      }),
    ];
    const forward = reconcile(chains);
    const reversed = reconcile([...chains].reverse());
    const rotated = reconcile([chains[2]!, chains[0]!, chains[1]!]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(rotated));
  });

  test("the correlation id changes nothing structural (input-scoped determinism)", () => {
    const chains: readonly SubscriptionChainSource[] = [cleanChain()];
    const a = reconcile(chains);
    const b = reconcile(chains, { correlationId: CORR_2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
