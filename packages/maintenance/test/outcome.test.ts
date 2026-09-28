/**
 * W072 D3/D5 tests — aggregation outcome measurement: per-aggregate
 * coverage ratios with machine-stable denominators (zero-aggregate
 * refuses), per-contract deadline adherence from injected timestamps,
 * per-vendor contribution breakdowns deterministic under input
 * permutations, the REAL W042 aggregation binding, audit emission (into
 * the REAL hash-chained log), and byte-identical determinism.
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import {
  MAINTENANCE_OUTCOME_AUDIT_ACTIONS,
  OUTCOME_MODEL_VERSION,
  OUTCOME_SCHEMA_VERSION,
  measureServiceAggregationOutcome,
  measureServiceAggregationOutcomes,
} from "../src/index";
import type {
  AggregatedServiceOrder,
  MaintenanceAuditSink,
  ServiceCompletionEvidence,
} from "../src/index";
import { createInMemoryMaintenanceAuditSink } from "../src/audit-seam";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  CORR,
  VND_1,
  VND_2,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";
import { buildServiceWorkOrder, matchServiceWorkOrder, formServiceAggregation, aggregateServiceWorkOrders } from "../src/index";

/** A second correlation id. */
const CORR_2 = "cor_w072_outcome2" as never;
/** A completion well before the deadline. */
const EARLY = "2026-01-10T00:00:00Z" as const;
/** A completion after the deadline. */
const LATE = "2026-02-15T00:00:00Z" as const;

/**
 * Build a REAL two-member aggregation for tenant A with the standard
 * helper fixtures (deadline 2026-02-01).
 */
function realAggregation(): AggregatedServiceOrder {
  const v = vendor();
  const pairs = ["a", "b"].map((suffix) => {
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput({
      deviceId: asDeviceId(`dev_w072_${suffix}`),
      diagnosis: {
        hypothesisId: `hyp_w072_${suffix}`,
        recommendationId: `tr_w072_${suffix}`,
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: {
          intentKind: "MaintainDeviceIntent",
          payload: { description: `Battery service ${suffix}.` },
        },
        observationIds: [`obs_w072_${suffix}`],
      },
    }));
    if (!built.ok) throw new Error(built.error.message);
    const matched = matchServiceWorkOrder(built.workOrder, [v], matchOptions());
    if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
    return { workOrder: built.workOrder, match: matched.matches[0]! };
  });
  const formed = formServiceAggregation(TENANT_A, pairs, T0, CORR);
  if (!formed.ok) throw new Error(formed.error.message);
  return formed.aggregation;
}

describe("W072 D3: per-aggregate measurement (machine-stable denominators)", () => {
  test("full coverage + full deadline adherence from INJECTED timestamps", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY },
      { workOrderId: agg.memberWorkOrderIds[1]!, vendorId: VND_1, completedAt: EARLY },
    ];
    const measured = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const outcome = measured.outcome;
    expect(outcome.outcomeId).toMatch(/^mout_[0-9a-f]{8}$/);
    expect(outcome.aggregationId).toBe(agg.aggregationId);
    expect(outcome.vendorId).toBe(agg.vendorId);
    expect(outcome.deadline).toBe(agg.deadline);
    // Machine-stable denominator: ordersAggregated = member count.
    expect(outcome.ordersAggregated).toBe(2);
    expect(outcome.ordersServed).toBe(2);
    expect(outcome.coverageRatio).toBe(1);
    expect(outcome.deadlineAdherence).toEqual({ metCount: 2, missedCount: 0, onTimeRatio: 1 });
    expect(outcome.schemaVersion).toBe(OUTCOME_SCHEMA_VERSION);
    expect(outcome.modelVersion).toBe(OUTCOME_MODEL_VERSION);
    // Per-contract outcomes cite the work order's own deadline verbatim.
    for (const contract of outcome.perContract) {
      expect(agg.memberWorkOrderIds).toContain(contract.workOrderId);
      expect(contract.metDeadline).toBe(true);
      expect(contract.deadline).toBe("2026-02-01T00:00:00Z");
    }
    // Per-vendor contribution: one vendor, both members.
    expect(outcome.vendorContributions).toEqual([
      { vendorId: VND_1, completedCount: 2, memberRefs: [...agg.memberWorkOrderIds] },
    ]);
  });

  test("partial coverage: unserved members stay in the denominator; missed deadlines count", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      // Only the first member is served — and it completed LATE.
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: LATE },
    ];
    const measured = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const outcome = measured.outcome;
    expect(outcome.ordersAggregated).toBe(2);
    expect(outcome.ordersServed).toBe(1);
    expect(outcome.coverageRatio).toBe(0.5);
    expect(outcome.deadlineAdherence).toEqual({ metCount: 0, missedCount: 1, onTimeRatio: 0 });
    // Exactly one unserved member.
    const served = new Set(outcome.perContract.map((c) => c.workOrderId));
    expect(served.size).toBe(1);
    expect(agg.memberWorkOrderIds.filter((id) => !served.has(id))).toHaveLength(1);
  });

  test("zero evidence: coverage 0, onTimeRatio null (unmeasured, never zero)", () => {
    const agg = realAggregation();
    const measured = measureServiceAggregationOutcome(TENANT_A, agg, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const outcome = measured.outcome;
    expect(outcome.ordersAggregated).toBe(2);
    expect(outcome.ordersServed).toBe(0);
    expect(outcome.coverageRatio).toBe(0);
    expect(outcome.deadlineAdherence).toEqual({ metCount: 0, missedCount: 0, onTimeRatio: null });
    expect(outcome.perContract).toEqual([]);
    expect(outcome.vendorContributions).toEqual([]);
  });

  test("a zero-aggregate REFUSES (empty_aggregation — machine-stable refusal)", () => {
    const agg = realAggregation();
    const hollow: AggregatedServiceOrder = {
      ...agg,
      memberCount: 0,
      memberWorkOrderIds: [],
      memberWorkOrders: [],
    };
    const measured = measureServiceAggregationOutcome(TENANT_A, hollow, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(measured.error.code).toBe("maintenance.outcome.invalid_request");
    expect(JSON.stringify(measured.error)).toContain("empty_aggregation");
  });

  test("a member-count/ids mismatch refuses (denominator integrity)", () => {
    const agg = realAggregation();
    const inconsistent: AggregatedServiceOrder = {
      ...agg,
      memberCount: 5,
    };
    const measured = measureServiceAggregationOutcome(TENANT_A, inconsistent, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(JSON.stringify(measured.error)).toContain("empty_aggregation");
  });

  test("a foreign-tenant aggregation refuses (tenant isolation by construction)", () => {
    const agg = realAggregation();
    const measured = measureServiceAggregationOutcome(TENANT_B, agg, [], {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(JSON.stringify(measured.error)).toContain("tenant_mismatch");
  });

  test("evidence for a non-member work order refuses (fail closed, never dropped)", () => {
    const agg = realAggregation();
    const measured = measureServiceAggregationOutcome(
      TENANT_A,
      agg,
      [{ workOrderId: "swo_w072_foreign", vendorId: VND_1, completedAt: EARLY }],
      { at: T1, correlationId: CORR },
    );
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(JSON.stringify(measured.error)).toContain("evidence_not_member");
  });

  test("duplicate evidence for one work order refuses", () => {
    const agg = realAggregation();
    const one: ServiceCompletionEvidence = {
      workOrderId: agg.memberWorkOrderIds[0]!,
      vendorId: VND_1,
      completedAt: EARLY,
    };
    const measured = measureServiceAggregationOutcome(TENANT_A, agg, [one, one], {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(JSON.stringify(measured.error)).toContain("duplicate_evidence");
  });
});

describe("W072 D3: per-vendor contribution breakdowns", () => {
  test("contributions group by the vendor that actually completed each contract", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_2, completedAt: EARLY },
      { workOrderId: agg.memberWorkOrderIds[1]!, vendorId: VND_1, completedAt: EARLY },
    ];
    const measured = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const outcome = measured.outcome;
    // Sorted by vendorId; the aggregation's matched vendor is still
    // carried verbatim on the outcome.
    expect(outcome.vendorId).toBe(agg.vendorId);
    expect(outcome.vendorContributions).toEqual([
      { vendorId: VND_1, completedCount: 1, memberRefs: [agg.memberWorkOrderIds[1]!] },
      { vendorId: VND_2, completedCount: 1, memberRefs: [agg.memberWorkOrderIds[0]!] },
    ]);
  });
});

describe("W072 D3: multi-aggregate measurement (deterministic routing)", () => {
  /** Build two REAL aggregations with different deadlines (different groups). */
  function twoAggregations(): AggregatedServiceOrder[] {
    const v = vendor();
    const mk = (deviceSuffix: string, deadline: string) => {
      const built = buildServiceWorkOrder(TENANT_A, workOrderInput({
        deviceId: asDeviceId(`dev_w072_m_${deviceSuffix}`),
        deadline,
        diagnosis: {
          hypothesisId: `hyp_w072_m_${deviceSuffix}`,
          recommendationId: `tr_w072_m_${deviceSuffix}`,
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: {
            intentKind: "MaintainDeviceIntent",
            payload: { description: `Multi service ${deviceSuffix}.` },
          },
          observationIds: [`obs_w072_m_${deviceSuffix}`],
        },
      }));
      if (!built.ok) throw new Error(built.error.message);
      const matched = matchServiceWorkOrder(built.workOrder, [v], matchOptions());
      if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
      return { workOrder: built.workOrder, match: matched.matches[0]! };
    };
    const grouped = aggregateServiceWorkOrders(TENANT_A, [
      mk("a", "2026-02-01T00:00:00Z"),
      mk("b", "2026-02-01T00:00:00Z"),
      mk("c", "2026-03-01T00:00:00Z"),
    ], T0, CORR);
    if (!grouped.ok) throw new Error(grouped.error.message);
    expect(grouped.aggregations.length).toBe(2);
    return [...grouped.aggregations];
  }

  test("a flat evidence list routes to the owning aggregation; outcomes sort by aggregationId", () => {
    const aggregations = twoAggregations();
    // Identify the groups by their (verbatim) deadlines — the output
    // sorts by aggregationId, which is a content hash.
    const february = aggregations.find((a) => a.deadline === "2026-02-01T00:00:00Z")!;
    const march = aggregations.find((a) => a.deadline === "2026-03-01T00:00:00Z")!;
    expect(february).toBeDefined();
    expect(march).toBeDefined();
    const evidence: ServiceCompletionEvidence[] = [
      // Every member of the February aggregation, only one of March's.
      ...february.memberWorkOrderIds.map((id) => ({
        workOrderId: id,
        vendorId: VND_1,
        completedAt: EARLY,
      })),
      { workOrderId: march.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: LATE },
    ];
    const measured = measureServiceAggregationOutcomes(TENANT_A, aggregations, evidence, {
      at: T1,
      correlationId: CORR,
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const outcomes = measured.outcomes;
    expect(outcomes.length).toBe(2);
    expect([...outcomes.map((o) => o.aggregationId)].sort()).toEqual(
      outcomes.map((o) => o.aggregationId),
    );
    const byId = new Map(outcomes.map((o) => [o.aggregationId, o]));
    const februaryOutcome = byId.get(february.aggregationId)!;
    const marchOutcome = byId.get(march.aggregationId)!;
    expect(februaryOutcome.coverageRatio).toBe(1);
    expect(marchOutcome.coverageRatio).toBe(1 / march.memberWorkOrderIds.length);
    // The LATE (Feb 15) completion is measured against MARCH's deadline
    // (met) — never against February's.
    expect(marchOutcome.deadlineAdherence.metCount).toBe(1);
    expect(februaryOutcome.deadlineAdherence.metCount).toBe(february.memberWorkOrderIds.length);
  });

  test("evidence for an unknown work order refuses (evidence_unknown)", () => {
    const aggregations = twoAggregations();
    const measured = measureServiceAggregationOutcomes(
      TENANT_A,
      aggregations,
      [{ workOrderId: "swo_w072_unknown", vendorId: VND_1, completedAt: EARLY }],
      { at: T1, correlationId: CORR },
    );
    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(JSON.stringify(measured.error)).toContain("evidence_unknown");
  });

  test("duplicate aggregations refuse; an empty aggregation set refuses", () => {
    const aggregations = twoAggregations();
    const dup = measureServiceAggregationOutcomes(
      TENANT_A,
      [aggregations[0]!, aggregations[0]!],
      [],
      { at: T1, correlationId: CORR },
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(JSON.stringify(dup.error)).toContain("duplicate_aggregation");

    const empty = measureServiceAggregationOutcomes(TENANT_A, [], [], {
      at: T1,
      correlationId: CORR,
    });
    expect(empty.ok).toBe(false);
  });
});

describe("W072 D5: audit emission (the injected sink seam)", () => {
  test("a successful measurement emits exactly one maintenance.outcome.measured record; failures emit none", () => {
    const agg = realAggregation();
    const sink = createInMemoryMaintenanceAuditSink();
    const ok = measureServiceAggregationOutcome(
      TENANT_A,
      agg,
      [{ workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY }],
      { at: T1, correlationId: CORR, auditSink: sink },
    );
    expect(ok.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe(MAINTENANCE_OUTCOME_AUDIT_ACTIONS.outcomeMeasured);
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(ok.ok ? ok.outcome.outcomeId : null);
    expect(record.occurredAt).toBe(T1);
    expect(record.correlationId).toBe(CORR);
    const details = record.details as { coverageRatio: number; ordersAggregated: number };
    expect(details.ordersAggregated).toBe(2);
    expect(details.coverageRatio).toBe(0.5);

    const failed = measureServiceAggregationOutcome(TENANT_A, agg, [], {
      at: "not-a-timestamp",
      correlationId: CORR,
      auditSink: sink,
    });
    expect(failed.ok).toBe(false);
    expect(sink.records.length).toBe(1);
  });

  test("the W012 sink adapter satisfies MaintenanceAuditSink; records land in the REAL hash-chained log", () => {
    const agg = realAggregation();
    const log = createInMemoryAuditLog();
    const sink: MaintenanceAuditSink = createAuditSinkAdapter(log, {
      source: "maintenance.outcome.test",
    });
    measureServiceAggregationOutcome(
      TENANT_A,
      agg,
      agg.memberWorkOrderIds.map((id) => ({
        workOrderId: id,
        vendorId: agg.vendorId,
        completedAt: EARLY,
      })),
      { at: T1, correlationId: CORR, auditSink: sink },
    );
    const ctx = makeTenantContext(TENANT_A, CORR);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    expect(records[0]!.action).toBe("maintenance.outcome.measured");
    expect(log.verify(ctx).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    // Cross-context read sees only its own chain.
    expect(log.records(makeTenantContext(TENANT_B, CORR)).length).toBe(0);
  });

  test("the multi-measurement emits one record per aggregation (in canonical order)", () => {
    const pairs = ["x", "y"].map((suffix) => {
      const built = buildServiceWorkOrder(TENANT_A, workOrderInput({
        deviceId: asDeviceId(`dev_w072_a_${suffix}`),
        diagnosis: {
          hypothesisId: `hyp_w072_a_${suffix}`,
          recommendationId: `tr_w072_a_${suffix}`,
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: {
            intentKind: "MaintainDeviceIntent",
            payload: { description: `Audit service ${suffix}.` },
          },
          observationIds: [`obs_w072_a_${suffix}`],
        },
      }));
      if (!built.ok) throw new Error(built.error.message);
      const matched = matchServiceWorkOrder(built.workOrder, [vendor()], matchOptions());
      if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
      return { workOrder: built.workOrder, match: matched.matches[0]! };
    });
    const formed = formServiceAggregation(TENANT_A, pairs, T0, CORR);
    if (!formed.ok) throw new Error(formed.error.message);
    const sink = createInMemoryMaintenanceAuditSink();
    measureServiceAggregationOutcomes(
      TENANT_A,
      [formed.aggregation],
      [{ workOrderId: formed.aggregation.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY }],
      { at: T1, correlationId: CORR, auditSink: sink },
    );
    expect(sink.records.length).toBe(1);
  });
});

describe("W072 D5: byte-identical determinism", () => {
  test("the same aggregation + evidence produce the byte-identical outcome across runs", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY },
      { workOrderId: agg.memberWorkOrderIds[1]!, vendorId: VND_2, completedAt: LATE },
    ];
    const a = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    const b = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.outcome)).toBe(JSON.stringify(b.outcome));
    expect(a.outcome.contentHash).toBe(b.outcome.contentHash);
    expect(a.outcome.outcomeId).toBe(b.outcome.outcomeId);
  });

  test("evidence input order NEVER matters (permutation invariance)", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY },
      { workOrderId: agg.memberWorkOrderIds[1]!, vendorId: VND_2, completedAt: LATE },
    ];
    const forward = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    const reversed = measureServiceAggregationOutcome(TENANT_A, agg, [...evidence].reverse(), {
      at: T1,
      correlationId: CORR,
    });
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(JSON.stringify(forward.outcome)).toBe(JSON.stringify(reversed.outcome));
    // Per-contract outcomes are in canonical (sorted) order.
    const ids = forward.outcome.perContract.map((c) => c.workOrderId);
    expect(ids).toEqual([...ids].sort());
  });

  test("the aggregation input order NEVER matters in the multi-measurement", () => {
    // Two single-member aggregations with different deadlines.
    const v = vendor();
    const mk = (suffix: string, deadline: string) => {
      const built = buildServiceWorkOrder(TENANT_A, workOrderInput({
        deviceId: asDeviceId(`dev_w072_d_${suffix}`),
        deadline,
        diagnosis: {
          hypothesisId: `hyp_w072_d_${suffix}`,
          recommendationId: `tr_w072_d_${suffix}`,
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: {
            intentKind: "MaintainDeviceIntent",
            payload: { description: `Det service ${suffix}.` },
          },
          observationIds: [`obs_w072_d_${suffix}`],
        },
      }));
      if (!built.ok) throw new Error(built.error.message);
      const matched = matchServiceWorkOrder(built.workOrder, [v], matchOptions());
      if (!matched.ok || matched.matches.length === 0) throw new Error("match failed");
      return formServiceAggregation(TENANT_A, [{ workOrder: built.workOrder, match: matched.matches[0]! }], T0, CORR);
    };
    const a1 = mk("1", "2026-02-01T00:00:00Z");
    const a2 = mk("2", "2026-03-01T00:00:00Z");
    if (!a1.ok || !a2.ok) throw new Error("aggregation failed");
    const flatEvidence: ServiceCompletionEvidence[] = [
      { workOrderId: a1.aggregation.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY },
      { workOrderId: a2.aggregation.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: LATE },
    ];
    const forward = measureServiceAggregationOutcomes(TENANT_A, [a1.aggregation, a2.aggregation], flatEvidence, {
      at: T1,
      correlationId: CORR,
    });
    const reversed = measureServiceAggregationOutcomes(TENANT_A, [a2.aggregation, a1.aggregation], [...flatEvidence].reverse(), {
      at: T1,
      correlationId: CORR,
    });
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(JSON.stringify(forward.outcomes)).toBe(JSON.stringify(reversed.outcomes));
  });

  test("the correlation id changes nothing structural (input-scoped determinism)", () => {
    const agg = realAggregation();
    const evidence: ServiceCompletionEvidence[] = [
      { workOrderId: agg.memberWorkOrderIds[0]!, vendorId: VND_1, completedAt: EARLY },
    ];
    const a = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR,
    });
    const b = measureServiceAggregationOutcome(TENANT_A, agg, evidence, {
      at: T1,
      correlationId: CORR_2,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.outcome)).toBe(JSON.stringify(b.outcome));
  });
});
