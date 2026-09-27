/**
 * W042 D4 tests — tenant isolation by construction (the reusable
 * isolation suite pattern).
 *
 * Mirrors W040's tenant-isolation.test.ts pattern (the recovery lane's
 * exhaustive isolation suite). Every store and every boundary function
 * is tenant-isolated by construction; foreign ids are indistinguishable
 * from unknown ones (no existence side channel); cross-tenant writes
 * are refused with machine-stable `tenant_mismatch` DomainErrors.
 *
 * Note: W012's REUSABLE isolation harness is exercised against the
 * store's raw KV view in `store-isolation.test.ts`. This file covers
 * the cross-cutting isolation checks across the boundary functions
 * (createServiceWorkOrder, reviseServiceWorkOrder, matchServiceWorkOrder,
 * formServiceAggregation, aggregateServiceWorkOrders).
 */

import { describe, expect, test } from "bun:test";
import { asTenantId, asDeviceId } from "@fleetos/contracts";
import { MAINTAIN_DEVICE_INTENT_KIND } from "@fleetos/contracts";
import {
  createServiceWorkOrder,
  reviseServiceWorkOrder,
  matchServiceWorkOrder,
  formServiceAggregation,
  aggregateServiceWorkOrders,
  createInMemoryServiceWorkOrderStore,
  createInMemoryMaintenanceAuditSink,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  CORR,
  scopeA,
  scopeB,
  ctxA,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";

/** An invalid tenant id (fails the frozen canonical grammar). */
const BAD_TENANT = asTenantId("not_a_tenant_id");
const BAD_SCOPE = { tenantId: BAD_TENANT, correlationId: CORR };

// ---------------------------------------------------------------------------
// Boundary function isolation
// ---------------------------------------------------------------------------

describe("D4: createServiceWorkOrder tenant isolation", () => {
  test("a context-free scope is rejected (types bypassed)", () => {
    const result = createServiceWorkOrder(
      undefined as never,
      workOrderInput(),
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
  });

  test("an invalid tenant id (bad grammar) is rejected", () => {
    const result = createServiceWorkOrder(
      BAD_SCOPE,
      workOrderInput(),
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
  });

  test("a malformed scope object (no tenantId) is rejected", () => {
    const result = createServiceWorkOrder(
      { correlationId: CORR } as never,
      workOrderInput(),
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
  });
});

describe("D4: reviseServiceWorkOrder tenant isolation", () => {
  test("cross-tenant revision is refused with tenant_mismatch", () => {
    const v1 = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!v1.ok) throw new Error(v1.error.message);
    const cross = reviseServiceWorkOrder(
      scopeB(),
      v1.workOrder,
      { serviceArea: "us-west-2" },
      { at: T1, correlationId: CORR },
    );
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("DomainError");
    if (cross.error.kind !== "DomainError") return;
    expect(cross.error.invariant).toBe("tenant_mismatch");
  });

  test("context-free scope is rejected at the revision boundary", () => {
    const v1 = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!v1.ok) throw new Error(v1.error.message);
    const result = reviseServiceWorkOrder(
      undefined as never,
      v1.workOrder,
      { serviceArea: "us-west-2" },
      { at: T1, correlationId: CORR },
    );
    expect(result.ok).toBe(false);
  });
});

describe("D4: the in-memory store enforces tenant isolation across every read path", () => {
  test("a tenant-A work order cannot be read from tenant-B's context", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const result = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!result.ok) throw new Error(result.error.message);
    const put = store.put(ctxA(), result.workOrder);
    expect(put.ok).toBe(true);
    // Tenant B cannot read tenant A's work order by id.
    expect(store.getLatestWorkOrder({ tenantId: TENANT_B }, result.workOrder.workOrderId)).toBeUndefined();
    expect(store.getWorkOrderRevision({ tenantId: TENANT_B }, result.workOrder.workOrderId, 1)).toBeUndefined();
    expect(store.listRevisions({ tenantId: TENANT_B }, result.workOrder.workOrderId)).toEqual([]);
    expect(store.listWorkOrders({ tenantId: TENANT_B })).toEqual([]);
    expect(store.size({ tenantId: TENANT_B })).toBe(0);
  });

  test("a tenant-A work order cannot be put into tenant-B's partition", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const result = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!result.ok) throw new Error(result.error.message);
    const cross = store.put({ tenantId: TENANT_B }, result.workOrder);
    expect(cross.ok).toBe(false);
    if (cross.ok || cross.error.kind !== "DomainError") return;
    expect(cross.error.invariant).toBe("tenant_mismatch");
  });
});

describe("D4: the matcher + aggregator never cross tenants (they consume typed refs)", () => {
  test("the matcher's audit emission is scoped to the work order's tenant", () => {
    const sinkA = createInMemoryMaintenanceAuditSink();
    const sinkB = createInMemoryMaintenanceAuditSink();
    // Build the same work order in two different tenants (different ids).
    const a = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sinkA,
    });
    const b = createServiceWorkOrder(scopeB(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sinkB,
    });
    if (!a.ok || !b.ok) throw new Error("create failed");
    // Tenant A's matcher emits to sinkA; tenant B's to sinkB.
    const v = vendor();
    matchServiceWorkOrder(a.workOrder, [v], { ...matchOptions(), auditSink: sinkA });
    matchServiceWorkOrder(b.workOrder, [v], { ...matchOptions(), auditSink: sinkB });
    expect(sinkA.records.every((r) => r.tenantId === TENANT_A)).toBe(true);
    expect(sinkB.records.every((r) => r.tenantId === TENANT_B)).toBe(true);
  });

  test("the aggregator refuses cross-tenant pairs (tenantId must match the acting tenant)", () => {
    const woA = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    const woB = createServiceWorkOrder(scopeB(), workOrderInput({
      deviceId: asDeviceId("dev_b"),
      diagnosis: {
        hypothesisId: "hyp_b",
        recommendationId: "tr_b",
        causeId: "health.battery_aging",
        confidence: 0.85,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_b"],
      },
    }), {
      at: T0,
      correlationId: CORR,
    });
    if (!woA.ok || !woB.ok) throw new Error("create failed");
    const v = vendor();
    const mA = matchServiceWorkOrder(woA.workOrder, [v], matchOptions());
    const mB = matchServiceWorkOrder(woB.workOrder, [v], matchOptions());
    if (!mA.ok || !mB.ok) throw new Error("match failed");
    // Aggregating tenant A's pair + tenant B's pair under tenant A's id
    // should be refused (the tenant B work order's tenantId mismatches).
    const result = formServiceAggregation(
      TENANT_A,
      [
        { workOrder: woA.workOrder, match: mA.matches[0]! },
        { workOrder: woB.workOrder, match: mB.matches[0]! },
      ],
      T0,
      CORR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });
});

describe("D4: a correlation id never grants cross-tenant reach", () => {
  test("tenant-B scope carrying tenant-A's correlation id: still only tenant B's partition", () => {
    const store = createInMemoryServiceWorkOrderStore();
    const a = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!a.ok) throw new Error(a.error.message);
    store.put(ctxA(), a.workOrder);
    const scopeBWithCorrA = { tenantId: TENANT_B, correlationId: CORR };
    expect(store.getLatestWorkOrder(scopeBWithCorrA, a.workOrder.workOrderId)).toBeUndefined();
    expect(store.listWorkOrders(scopeBWithCorrA)).not.toContain(a.workOrder);
  });
});

void DEV_A1;
void T1;
