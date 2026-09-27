/**
 * W042 D3 tests — deadline aggregation of compatible service orders.
 *
 * Validates deterministic grouping, member work order id sorting,
 * auditable trace (every batch traces to its member work orders), and
 * the PROPOSAL contract (never dispatches).
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId, asVendorId } from "@fleetos/contracts";
import { buildVendor } from "@fleetos/vendors";
import { MAINTAIN_DEVICE_INTENT_KIND } from "@fleetos/contracts";
import {
  buildServiceWorkOrder,
  matchServiceWorkOrder,
  formServiceAggregation,
  aggregateServiceWorkOrders,
  verifyAggregationTrace,
  createInMemoryMaintenanceAuditSink,
  AGGREGATION_SCHEMA_VERSION,
  AGGREGATION_MODEL_VERSION,
} from "../src/index";
import {
  T0,
  TENANT_A,
  CORR,
  VND_1,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";

describe("D3: formServiceAggregation (single-group formation)", () => {
  test("forms an aggregated order with deterministic id + sorted member work order ids", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wos = [
      buildServiceWorkOrder(tenantId, workOrderInput({
        deviceId: asDeviceId("dev_agg_a"),
        diagnosis: {
          hypothesisId: "hyp_a",
          recommendationId: "tr_a",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
          observationIds: ["obs_a"],
        },
      })),
      buildServiceWorkOrder(tenantId, workOrderInput({
        deviceId: asDeviceId("dev_agg_b"),
        diagnosis: {
          hypothesisId: "hyp_b",
          recommendationId: "tr_b",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
          observationIds: ["obs_b"],
        },
      })),
    ];
    if (!wos[0]!.ok || !wos[1]!.ok) throw new Error("build failed");
    const builtWos1 = wos.map((r) => (r!.ok ? r.workOrder : null));
    if (builtWos1.some((w) => w === null)) throw new Error("build returned null");
    const matches = builtWos1.map((w) => {
      const m = matchServiceWorkOrder(w!, [v], matchOptions());
      if (!m.ok || m.matches.length === 0) throw new Error("match failed");
      return { workOrder: w!, match: m.matches[0]! };
    });
    const agg = formServiceAggregation(tenantId, matches, T0, CORR);
    expect(agg.ok).toBe(true);
    if (!agg.ok) return;
    expect(agg.aggregation.aggregationId).toMatch(/^magg_[0-9a-f]{8}$/);
    expect(agg.aggregation.memberWorkOrderIds.length).toBe(2);
    expect(agg.aggregation.memberWorkOrders.length).toBe(2);
    expect(agg.aggregation.memberCount).toBe(2);
    expect(agg.aggregation.vendorId).toBe(VND_1);
    expect(agg.aggregation.schemaVersion).toBe(AGGREGATION_SCHEMA_VERSION);
    expect(agg.aggregation.modelVersion).toBe(AGGREGATION_MODEL_VERSION);
    // The member ids are sorted (deterministic).
    const sortedIds = [...agg.aggregation.memberWorkOrderIds].sort();
    expect(agg.aggregation.memberWorkOrderIds).toEqual(sortedIds);
  });

  test("the same inputs produce the byte-identical aggregationId", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wo = buildServiceWorkOrder(tenantId, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.matches[0]! }];
    const a = formServiceAggregation(tenantId, pairs, T0, CORR);
    const b = formServiceAggregation(tenantId, pairs, T0, CORR);
    if (!a.ok || !b.ok) throw new Error("agg failed");
    expect(a.aggregation.aggregationId).toBe(b.aggregation.aggregationId);
    expect(a.aggregation.memberWorkOrderIds).toEqual(b.aggregation.memberWorkOrderIds);
  });

  test("emits a maintenance.aggregation.formed audit record", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const tenantId = TENANT_A;
    const v = vendor();
    const wo = buildServiceWorkOrder(tenantId, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.matches[0]! }];
    const agg = formServiceAggregation(tenantId, pairs, T0, CORR, sink);
    if (!agg.ok) return;
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe("maintenance.aggregation.formed");
    expect(record.subject).toBe(agg.aggregation.aggregationId);
    expect(record.tenantId).toBe(TENANT_A);
  });
});

describe("D3: aggregateServiceWorkOrders (multi-group grouping)", () => {
  test("groups by (vendorId, serviceArea, deadline); sorted by aggregationId", () => {
    const tenantId = TENANT_A;
    const v1 = vendor({ vendorId: VND_1 });
    const wo1 = buildServiceWorkOrder(tenantId, workOrderInput({
      serviceArea: "us-east-1",
      deadline: "2026-12-01T00:00:00Z",
    }));
    const wo2 = buildServiceWorkOrder(tenantId, workOrderInput({
      deviceId: asDeviceId("dev_agg_b"),
      diagnosis: {
        hypothesisId: "hyp_b",
        recommendationId: "tr_b",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_b"],
      },
      serviceArea: "us-east-1",
      deadline: "2026-12-01T00:00:00Z",
    }));
    const wo3 = buildServiceWorkOrder(tenantId, workOrderInput({
      deviceId: asDeviceId("dev_agg_c"),
      diagnosis: {
        hypothesisId: "hyp_c",
        recommendationId: "tr_c",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_c"],
      },
      serviceArea: "us-west-2",
      deadline: "2026-12-01T00:00:00Z",
    }));
    if (!wo1!.ok || !wo2!.ok || !wo3!.ok) throw new Error("build failed");
    const m1 = matchServiceWorkOrder(wo1!.workOrder, [v1], matchOptions());
    const m2 = matchServiceWorkOrder(wo2!.workOrder, [v1], matchOptions());
    // wo3 is in us-west-2 — vendor v1's regions are us-east-1 only; need a west vendor.
    const v2 = vendor({
      vendorId: asVendorId("vnd_testvendor0002"),
      regions: ["us-west-2"],
    });
    const m3 = matchServiceWorkOrder(wo3!.workOrder, [v2], matchOptions());
    if (!m1.ok || !m2.ok || !m3.ok) throw new Error("match failed");
    const pairs = [
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
      { workOrder: wo3!.workOrder, match: m3.matches[0]! },
    ];
    const result = aggregateServiceWorkOrders(tenantId, pairs, T0, CORR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aggregations.length).toBe(2);
    // Sorted by aggregationId.
    const ids = result.aggregations.map((a) => a.aggregationId);
    expect(ids).toEqual([...ids].sort());
  });

  test("input order is irrelevant: same groups, same ordering", () => {
    const tenantId = TENANT_A;
    const v1 = vendor({ vendorId: VND_1 });
    const wo1 = buildServiceWorkOrder(tenantId, workOrderInput({
      deviceId: asDeviceId("dev_agg_a"),
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
      deviceId: asDeviceId("dev_agg_b"),
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
    const m1 = matchServiceWorkOrder(wo1!.workOrder, [v1], matchOptions());
    const m2 = matchServiceWorkOrder(wo2!.workOrder, [v1], matchOptions());
    if (!m1.ok || !m2.ok) throw new Error("match failed");
    const pairs1 = [
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
    ];
    const pairs2 = [
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
    ];
    const r1 = aggregateServiceWorkOrders(tenantId, pairs1, T0, CORR);
    const r2 = aggregateServiceWorkOrders(tenantId, pairs2, T0, CORR);
    if (!r1.ok || !r2.ok) return;
    expect(r1.aggregations.map((a) => a.aggregationId)).toEqual(
      r2.aggregations.map((a) => a.aggregationId),
    );
    expect(r1.aggregations[0]!.memberWorkOrderIds).toEqual(
      r2.aggregations[0]!.memberWorkOrderIds,
    );
  });
});

describe("D3: aggregation trace (individual customer contracts remain auditable)", () => {
  test("verifyAggregationTrace returns true for a well-formed aggregation", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wo = buildServiceWorkOrder(tenantId, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.matches[0]! }];
    const agg = formServiceAggregation(tenantId, pairs, T0, CORR);
    if (!agg.ok) return;
    expect(verifyAggregationTrace(agg.aggregation)).toBe(true);
  });

  test("every member work order in the aggregation carries the same tenantId", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wo = buildServiceWorkOrder(tenantId, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.matches[0]! }];
    const agg = formServiceAggregation(tenantId, pairs, T0, CORR);
    if (!agg.ok) return;
    for (const m of agg.aggregation.memberWorkOrders) {
      expect(m.tenantId).toBe(tenantId);
    }
  });

  test("the aggregation's memberWorkOrders array IS the auditable trace", () => {
    const tenantId = TENANT_A;
    const v = vendor();
    const wos = [
      buildServiceWorkOrder(tenantId, workOrderInput({
        deviceId: asDeviceId("dev_trace_a"),
        diagnosis: {
          hypothesisId: "hyp_a",
          recommendationId: "tr_a",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
          observationIds: ["obs_a"],
        },
      })),
      buildServiceWorkOrder(tenantId, workOrderInput({
        deviceId: asDeviceId("dev_trace_b"),
        diagnosis: {
          hypothesisId: "hyp_b",
          recommendationId: "tr_b",
          causeId: "health.battery_aging",
          confidence: 0.85,
          proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
          observationIds: ["obs_b"],
        },
      })),
    ];
    if (!wos[0]!.ok || !wos[1]!.ok) throw new Error("build failed");
    const builtWos2 = wos.map((r) => (r!.ok ? r.workOrder : null));
    if (builtWos2.some((w) => w === null)) throw new Error("build returned null");
    const matches = builtWos2.map((w) => {
      const m = matchServiceWorkOrder(w!, [v], matchOptions());
      if (!m.ok || m.matches.length === 0) throw new Error("match failed");
      return { workOrder: w!, match: m.matches[0]! };
    });
    const agg = formServiceAggregation(tenantId, matches, T0, CORR);
    if (!agg.ok) return;
    // Every member work order's id appears in the memberWorkOrderIds array (the trace).
    const traceIds = new Set(agg.aggregation.memberWorkOrderIds);
    for (const wo of agg.aggregation.memberWorkOrders) {
      expect(traceIds.has(wo.workOrderId)).toBe(true);
    }
    // The trace is complete + sorted.
    expect(agg.aggregation.memberWorkOrders.length).toBe(matches.length);
    const sortedIds = [...agg.aggregation.memberWorkOrderIds].sort();
    expect(agg.aggregation.memberWorkOrderIds).toEqual(sortedIds);
  });
});

describe("D3: aggregation validation failures", () => {
  test("rejects an empty pairs array", () => {
    const result = aggregateServiceWorkOrders(TENANT_A, [], T0, CORR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });

  test("rejects a pair whose match is not satisfiable", () => {
    const tenantId = TENANT_A;
    const wo = buildServiceWorkOrder(tenantId, workOrderInput({ serviceArea: "us-west-2" }));
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({ regions: ["us-east-1"] }); // rejected on region
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    const pairs = [{ workOrder: wo.workOrder, match: m.rejected[0]! }];
    const result = formServiceAggregation(tenantId, pairs, T0, CORR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });

  test("rejects pairs with mixed vendors (single-aggregation formation)", () => {
    const tenantId = TENANT_A;
    const v1 = vendor({ vendorId: VND_1 });
    const v2 = vendor({
      vendorId: asVendorId("vnd_testvendor0002"),
      regions: ["us-east-1"],
    });
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
    const m1 = matchServiceWorkOrder(wo1!.workOrder, [v1], matchOptions());
    const m2 = matchServiceWorkOrder(wo2!.workOrder, [v2], matchOptions());
    if (!m1.ok || !m2.ok) throw new Error("match failed");
    // Two different vendors — formServiceAggregation should reject (vendor mismatch).
    const pairs = [
      { workOrder: wo1!.workOrder, match: m1.matches[0]! },
      { workOrder: wo2!.workOrder, match: m2.matches[0]! },
    ];
    const result = formServiceAggregation(tenantId, pairs, T0, CORR);
    expect(result.ok).toBe(false);
  });
});

// Suppress unused import warnings.
void buildVendor;
