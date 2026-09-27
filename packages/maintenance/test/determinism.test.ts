/**
 * W042 D5 tests — byte-identical determinism across runs and input
 * permutations.
 *
 * Every builder, matcher, and aggregator is a pure function of its
 * inputs. The same inputs produce the byte-identical outputs regardless
 * of:
 *   - the audit sink's emission count (the sink is the consequential
 *     trace; it never affects the domain output);
 *   - the vendor input order (the matcher sorts by rankScore desc,
 *     vendorId asc — input order is irrelevant);
 *   - the diagnosis evidence's observation id order (the builder sorts
 *     them before computing the content digest);
 *   - the work order input order in aggregation (the aggregator sorts
 *     by workOrderId before computing the aggregation id).
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asDeviceId, asVendorId } from "@fleetos/contracts";
import { MAINTAIN_DEVICE_INTENT_KIND } from "@fleetos/contracts";
import { buildVendor } from "@fleetos/vendors";
import {
  buildServiceWorkOrder,
  buildServiceWorkOrderRevision,
  matchServiceWorkOrder,
  formServiceAggregation,
  aggregateServiceWorkOrders,
  createInMemoryMaintenanceAuditSink,
  NOOP_MAINTENANCE_AUDIT_SINK,
} from "../src/index";
import {
  T0,
  TENANT_A,
  VND_1,
  VND_2,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";

/** A deterministic correlation id used by the aggregation tests below. */
const CORR_X = asCorrelationId("cor_w042_det_x");

describe("D5: byte-identical determinism (work order builder)", () => {
  test("the same inputs produce the byte-identical work order id + content digest", () => {
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput());
    const b = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!a.ok || !b.ok) throw new Error("build failed");
    expect(a.workOrder.workOrderId).toBe(b.workOrder.workOrderId);
    expect(a.workOrder.contentDigest).toBe(b.workOrder.contentDigest);
    expect(JSON.stringify(a.workOrder)).toBe(JSON.stringify(b.workOrder));
  });

  test("observation ids in different orders produce the byte-identical work order", () => {
    const obsForward = ["obs_a", "obs_b", "obs_c"];
    const obsReverse = ["obs_c", "obs_b", "obs_a"];
    const a = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        diagnosis: {
          hypothesisId: "hyp",
          recommendationId: "tr",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: {
            intentKind: MAINTAIN_DEVICE_INTENT_KIND,
            payload: { description: "x" },
          },
          observationIds: obsForward,
        },
      }),
    );
    const b = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        diagnosis: {
          hypothesisId: "hyp",
          recommendationId: "tr",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: {
            intentKind: MAINTAIN_DEVICE_INTENT_KIND,
            payload: { description: "x" },
          },
          observationIds: obsReverse,
        },
      }),
    );
    if (!a.ok || !b.ok) throw new Error("build failed");
    expect(a.workOrder.workOrderId).toBe(b.workOrder.workOrderId);
    expect(a.workOrder.contentDigest).toBe(b.workOrder.contentDigest);
  });

  test("revision builder is byte-identical across runs", () => {
    const v1 = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!v1.ok) throw new Error(v1.error.message);
    const a = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: "2026-02-01T00:00:00Z",
      correlationId: CORR_X,
    });
    const b = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: "2026-02-01T00:00:00Z",
      correlationId: CORR_X,
    });
    if (!a.ok || !b.ok) throw new Error("rev failed");
    expect(a.workOrder.contentDigest).toBe(b.workOrder.contentDigest);
  });
});

describe("D5: byte-identical determinism (matcher — input order invariant)", () => {
  test("vendor input order is irrelevant: identical matches + rejects", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v1 = vendor({ vendorId: VND_1 });
    const v2 = vendor({
      vendorId: VND_2,
      terms: { quality: { score: 0.95 }, sla: { coverage: 0.99 }, warranty: { days: 730 } },
    });
    const r1 = matchServiceWorkOrder(wo.workOrder, [v1, v2], matchOptions());
    const r2 = matchServiceWorkOrder(wo.workOrder, [v2, v1], matchOptions());
    if (!r1.ok || !r2.ok) throw new Error("match failed");
    expect(JSON.stringify(r1.matches)).toBe(JSON.stringify(r2.matches));
    expect(JSON.stringify(r1.rejected)).toBe(JSON.stringify(r2.rejected));
  });

  test("the audit sink's emission count never affects the matching output", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor();
    // Run with a no-op sink and with a collecting sink: identical matches.
    const r1 = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    const sink = createInMemoryMaintenanceAuditSink();
    const r2 = matchServiceWorkOrder(wo.workOrder, [v], { ...matchOptions(), auditSink: sink });
    if (!r1.ok || !r2.ok) throw new Error("match failed");
    expect(JSON.stringify(r1.matches)).toBe(JSON.stringify(r2.matches));
    expect(sink.records.length > 0).toBe(true); // the sink captured records
  });

  test("a second matching run with the same inputs produces the same match ids + rank scores", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v1 = vendor({ vendorId: VND_1 });
    const v2 = vendor({ vendorId: VND_2 });
    const r1 = matchServiceWorkOrder(wo.workOrder, [v1, v2], matchOptions());
    const r2 = matchServiceWorkOrder(wo.workOrder, [v1, v2], matchOptions());
    if (!r1.ok || !r2.ok) throw new Error("match failed");
    expect(r1.matches.map((m) => m.vendor.vendorId)).toEqual(
      r2.matches.map((m) => m.vendor.vendorId),
    );
    expect(r1.matches.map((m) => m.rankScore)).toEqual(
      r2.matches.map((m) => m.rankScore),
    );
  });
});

describe("D5: byte-identical determinism (aggregator — input order invariant)", () => {
  test("member work order input order is irrelevant: identical aggregation ids + member ids", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wo1 = buildServiceWorkOrder(tenantId, workOrderInput({
      deviceId: asDeviceId("dev_a"),
      diagnosis: {
        hypothesisId: "hyp_a",
        recommendationId: "tr_a",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_a"],
      },
    }));
    const wo2 = buildServiceWorkOrder(tenantId, workOrderInput({
      deviceId: asDeviceId("dev_b"),
      diagnosis: {
        hypothesisId: "hyp_b",
        recommendationId: "tr_b",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_b"],
      },
    }));
    if (!wo1!.ok || !wo2!.ok) throw new Error("build failed");
    const m1 = matchServiceWorkOrder(wo1!.workOrder, [v], matchOptions());
    const m2 = matchServiceWorkOrder(wo2!.workOrder, [v], matchOptions());
    if (!m1.ok || !m2.ok) throw new Error("match failed");
    const pairs1 = [
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
    ];
    const pairs2 = [
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
    ];
    const r1 = aggregateServiceWorkOrders(tenantId, pairs1, T0, CORR_X);
    const r2 = aggregateServiceWorkOrders(tenantId, pairs2, T0, CORR_X);
    if (!r1.ok || !r2.ok) throw new Error("agg failed");
    expect(r1.aggregations.map((a) => a.aggregationId)).toEqual(
      r2.aggregations.map((a) => a.aggregationId),
    );
    expect(r1.aggregations[0]!.memberWorkOrderIds).toEqual(
      r2.aggregations[0]!.memberWorkOrderIds,
    );
  });

  test("the same aggregation inputs produce byte-identical totalWarrantyHeadroomDays", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wo = buildServiceWorkOrder(tenantId, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.matches[0]! }];
    const a = formServiceAggregation(tenantId, pairs, T0, CORR_X);
    const b = formServiceAggregation(tenantId, pairs, T0, CORR_X);
    if (!a.ok || !b.ok) throw new Error("agg failed");
    expect(a.aggregation.totalWarrantyHeadroomDays).toBe(
      b.aggregation.totalWarrantyHeadroomDays,
    );
  });
});

describe("D5: determinism with the REAL vendor package", () => {
  test("two real vendors built with the same inputs produce the same vendor record", () => {
    const tenantId = TENANT_A;
    const input = {
      vendorId: asVendorId("vnd_real_det"),
      name: "Acme Service",
      description: "test",
      capabilities: [{ kind: "service", id: "service.battery" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
      terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 365 } },
      regions: ["us-east-1"],
      at: T0,
      correlationId: CORR_X,
    } as const;
    const a = buildVendor(tenantId, input);
    const b = buildVendor(tenantId, input);
    if (!a.ok || !b.ok) throw new Error("vendor build failed");
    expect(a.vendor.contentHash).toBe(b.vendor.contentHash);
    expect(JSON.stringify(a.vendor)).toBe(JSON.stringify(b.vendor));
  });
});

// Suppress unused import warnings.
void NOOP_MAINTENANCE_AUDIT_SINK;
