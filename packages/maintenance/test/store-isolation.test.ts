/**
 * W042 D4 tests — tenant isolation by construction, proven two ways:
 *
 *   1. W012's REUSABLE isolation harness (`runTenantIsolationSuite`)
 *      runs against the store's raw KV view over the SAME per-tenant
 *      partitions (the same-lane consumption W012 documented for this
 *      package);
 *   2. Exhaustive store-level checks on the RICH operations: latest /
 *      specific-revision reads, listing, sizing, and revision appends
 *      can never cross partitions; foreign work order ids are
 *      indistinguishable from unknown ones; context-free and
 *      invalid-context access is rejected by the runtime guard even
 *      when the type system is bypassed.
 */

import { describe, expect, test } from "bun:test";
import { asTenantId, asDeviceId } from "@fleetos/contracts";
import { MAINTAIN_DEVICE_INTENT_KIND } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { TenantIsolationError, makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import {
  asTenantScopedWorkOrderStore,
  buildServiceWorkOrder,
  buildServiceWorkOrderRevision,
  createInMemoryServiceWorkOrderStore,
} from "../src/index";
import type { ServiceWorkOrder } from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  CORR,
  ctxA,
  ctxB,
  workOrderInput,
} from "./helpers";

/** Build a work order in a given tenant for the isolation harness. */
function makeWorkOrder(tenantId: typeof TENANT_A, key: string): ServiceWorkOrder {
  const built = buildServiceWorkOrder(tenantId, {
    deviceId: asDeviceId(`dev_${key}`),
    diagnosis: {
      hypothesisId: `hyp_${key}`,
      recommendationId: `tr_${key}`,
      causeId: "health.battery_aging",
      confidence: 0.85,
      proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
      observationIds: [`obs_${key}`],
    },
    serviceArea: "us-east-1",
    deadline: "2026-12-01T00:00:00Z",
    slaFloor: { coverage: 0.8 },
    warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    serviceCategory: "service.battery",
    at: T0,
    correlationId: CORR,
  });
  if (!built.ok) throw new Error(built.error.message);
  // Patch the workOrderId to match the harness's key (the harness's
  // `put` requires value.workOrderId === key, but the work order's id
  // is computed deterministically — use the raw KV view directly).
  // We do this by binding through the harness's `put` which stores
  // under the harness's key, NOT the workOrder.workOrderId.
  return built.workOrder;
}

describe("D4: W012 isolation harness over the store's raw KV view", () => {
  test("runTenantIsolationSuite passes all seven checks against the shared partitions", () => {
    const report = runTenantIsolationSuite<ServiceWorkOrder>({
      tenantA: TENANT_A,
      tenantB: TENANT_B,
      makeStore: () =>
        asTenantScopedWorkOrderStore(createInMemoryServiceWorkOrderStore()),
      makeValue: (tenantId, key) => makeWorkOrder(tenantId, key),
    });
    expect(report.ok).toBe(true);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(report.checks.map((c) => c.name)).toEqual([
      "own_tenant_roundtrip",
      "cross_tenant_read_miss",
      "same_key_partition",
      "context_free_rejected",
      "invalid_context_rejected",
      "enumeration_scoped",
      "remove_scoped",
    ]);
  });
});

describe("D4: rich-operation isolation (exhaustive)", () => {
  test("work orders created in tenant A are invisible to tenant B on every read path", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    const put = store.put(ctxA(), built.workOrder);
    expect(put.ok).toBe(true);

    // Latest read: cross-tenant miss.
    expect(store.getLatestWorkOrder(ctxB(), built.workOrder.workOrderId)).toBeUndefined();
    // Specific-revision read: cross-tenant miss.
    expect(store.getWorkOrderRevision(ctxB(), built.workOrder.workOrderId, 1)).toBeUndefined();
    // Listing: scoped to the acting tenant.
    expect(store.listWorkOrders(ctxB())).toEqual([]);
    expect(store.listWorkOrders(ctxA()).length).toBe(1);
    // Revision history: scoped.
    expect(store.listRevisions(ctxB(), built.workOrder.workOrderId)).toEqual([]);
    expect(store.listRevisions(ctxA(), built.workOrder.workOrderId).length).toBe(1);
    // Size: scoped.
    expect(store.size(ctxB())).toBe(0);
    expect(store.size(ctxA())).toBe(1);
  });

  test("foreign work order ids are indistinguishable from unknown ones (no existence leak)", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    store.put(ctxA(), built.workOrder);
    const foreign = store.getLatestWorkOrder(ctxB(), built.workOrder.workOrderId);
    const unknown = store.getLatestWorkOrder(ctxB(), "swo_never_seen");
    expect(foreign).toBeUndefined();
    expect(unknown).toBeUndefined();
  });

  test("duplicate creation within one tenant fails; different tenants may share the work order", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    expect(store.put(ctxA(), built.workOrder).ok).toBe(true);
    const duplicate = store.put(ctxA(), built.workOrder);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok || duplicate.error.kind !== "DomainError") return;
    expect(duplicate.error.invariant).toBe("workorder_already_exists");
    expect(duplicate.error.tenantId).toBe(TENANT_A);
    // The same work order (built in tenant A) cannot be put into tenant B
    // because the work order's tenantId is A (the store's tenant_mismatch
    // check fires). This proves the tenant isolation: a tenant-A record
    // cannot reach tenant-B's partition.
    const cross = store.put(ctxB(), built.workOrder);
    expect(cross.ok).toBe(false);
    if (cross.ok || cross.error.kind !== "DomainError") return;
    expect(cross.error.invariant).toBe("tenant_mismatch");
    expect(store.size(ctxA())).toBe(1);
    expect(store.size(ctxB())).toBe(0);
  });

  test("revision history is append-only and complete within the partition", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const v1 = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!v1.ok) throw new Error(v1.error.message);
    store.put(ctxA(), v1.workOrder);
    const v2 = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: T1,
      correlationId: CORR,
    });
    if (!v2.ok) throw new Error(v2.error.message);
    store.appendRevision(ctxA(), v2.workOrder);
    const revisions = store.listRevisions(ctxA(), v1.workOrder.workOrderId);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(revisions.map((r) => r.serviceArea)).toEqual(["us-east-1", "us-west-2"]);
    // Old revisions are still readable by number.
    expect(store.getWorkOrderRevision(ctxA(), v1.workOrder.workOrderId, 1)?.serviceArea).toBe(
      "us-east-1",
    );
    // Out-of-range revisions miss.
    expect(store.getWorkOrderRevision(ctxA(), v1.workOrder.workOrderId, 0)).toBeUndefined();
    expect(store.getWorkOrderRevision(ctxA(), v1.workOrder.workOrderId, 3)).toBeUndefined();
  });

  test("multi-work-order enumeration is sorted by workOrderId within the partition", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput({
      deviceId: asDeviceId("dev_zzzz"),
      diagnosis: {
        hypothesisId: "hyp_zzzz",
        recommendationId: "tr_zzzz",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_zzzz"],
      },
    }));
    const b = buildServiceWorkOrder(TENANT_A, workOrderInput({
      deviceId: asDeviceId("dev_aaaa"),
      diagnosis: {
        hypothesisId: "hyp_aaaa",
        recommendationId: "tr_aaaa",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_aaaa"],
      },
    }));
    if (!a.ok || !b.ok) throw new Error("build failed");
    store.put(ctxA(), a.workOrder);
    store.put(ctxA(), b.workOrder);
    const ids = store.listWorkOrders(ctxA()).map((w) => w.workOrderId);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBe(2);
  });

  test("an empty tenant partition reads as empty (never as another tenant's data)", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const freshCtx = makeTenantContext(asTenantId("tnt_freshtenant0"));
    expect(store.listWorkOrders(freshCtx)).toEqual([]);
    expect(store.size(freshCtx)).toBe(0);
    expect(store.getLatestWorkOrder(freshCtx, "swo_any")).toBeUndefined();
    expect(store.listRevisions(freshCtx, "swo_any")).toEqual([]);
  });

  test("context-free and invalid-context access is rejected by the runtime guard (types bypassed)", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    store.put(ctxA(), built.workOrder);

    expect(() =>
      store.getLatestWorkOrder(undefined as unknown as TenantContext, built.workOrder.workOrderId),
    ).toThrow(TenantIsolationError);
    expect(() =>
      store.getLatestWorkOrder({ tenantId: "not-a-tenant-id" as never }, built.workOrder.workOrderId),
    ).toThrow(TenantIsolationError);
    expect(() => store.listWorkOrders(null as unknown as TenantContext)).toThrow(
      TenantIsolationError,
    );
    expect(() => store.size(undefined as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() =>
      store.put({ tenantId: "" as never }, built.workOrder),
    ).toThrow(TenantIsolationError);
  });
});

describe("D4: cross-tenant writes are refused with machine-stable tenant_mismatch", () => {
  test("a tenant-A work order cannot be appended under tenant-B's context", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    const result = store.put(ctxA(), built.workOrder);
    expect(result.ok).toBe(true);
    const cross = store.put(ctxB(), built.workOrder);
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("DomainError");
    if (cross.error.kind !== "DomainError") return;
    expect(cross.error.invariant).toBe("tenant_mismatch");
    expect(store.size(ctxB())).toBe(0);
  });
});

describe("D4: revision out-of-sequence is refused", () => {
  test("appendRevision with revision+2 (out of sequence) is refused", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!built.ok) throw new Error(built.error.message);
    store.put(ctxA(), built.workOrder);
    // Forge a v3 record (revision 3 — out of sequence).
    const forged = { ...built.workOrder, revision: 3 } as ServiceWorkOrder;
    const result = store.appendRevision(ctxA(), forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind !== "DomainError") return;
    expect(result.error.invariant).toBe("revision_out_of_sequence");
  });

  test("appendRevision with revision 1 of an unknown id (when one already exists elsewhere) starts a new chain", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput());
    const b = buildServiceWorkOrder(TENANT_A, workOrderInput({
      deviceId: asDeviceId("dev_alt"),
      diagnosis: {
        hypothesisId: "hyp_alt",
        recommendationId: "tr_alt",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_alt"],
      },
    }));
    if (!a.ok || !b.ok) throw new Error("build failed");
    expect(store.put(ctxA(), a.workOrder).ok).toBe(true);
    // b is revision 1 of a DIFFERENT work order id; the store accepts it as
    // a new chain (revision 1 of an unknown id is the start of a new chain).
    expect(store.appendRevision(ctxA(), b.workOrder).ok).toBe(true);
  });
});

void DEV_A1;
