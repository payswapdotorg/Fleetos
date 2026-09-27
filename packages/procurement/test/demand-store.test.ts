/**
 * W032 D2 tests — the tenant-scoped demand store: W012's isolation
 * harness + exhaustive store-level checks.
 */

import { describe, expect, test } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { TenantIsolationError, makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import { asTenantScopedDemandStore, createInMemoryDemandStore } from "../src/demand-store";
import type { ProcurementDemand } from "../src/demand";
import { buildDemand } from "../src/demand";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  demandInput,
} from "./helpers";

describe("D2: W012 isolation harness over the demand store's raw KV view", () => {
  test("runTenantIsolationSuite passes all seven checks", () => {
    const report = runTenantIsolationSuite<ProcurementDemand>({
      tenantA: TENANT_A,
      tenantB: TENANT_B,
      makeStore: () => asTenantScopedDemandStore(createInMemoryDemandStore()),
      makeValue: (tenantId, key) => {
        const built = buildDemand(tenantId, {
          ...demandInput(),
          procurementIntent: { workloadId: key, description: `demand for ${key}` },
        });
        if (!built.ok) throw new Error(built.error.message);
        return built.demand;
      },
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

describe("D2: demand store rich-operation isolation", () => {
  test("demands created in tenant A are invisible to tenant B", () => {
    const store = createInMemoryDemandStore();
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const ctxA = makeTenantContext(TENANT_A, CORR);
    const ctxB = makeTenantContext(TENANT_B, CORR);
    expect(store.put(ctxA, built.demand).ok).toBe(true);
    expect(store.get(ctxB, built.demand.demandId)).toBeUndefined();
    expect(store.list(ctxB)).toEqual([]);
    expect(store.size(ctxB)).toBe(0);
    expect(store.list(ctxA).length).toBe(1);
    expect(store.size(ctxA)).toBe(1);
  });

  test("context-free access is rejected by the runtime guard", () => {
    const store = createInMemoryDemandStore();
    expect(() => store.get(undefined as unknown as TenantContext, "x")).toThrow(TenantIsolationError);
    expect(() => store.list(null as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() => store.size(undefined as unknown as TenantContext)).toThrow(TenantIsolationError);
  });

  test("duplicate demand ids in one tenant fail; different tenants may share the id", () => {
    const store = createInMemoryDemandStore();
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const ctxA = makeTenantContext(TENANT_A, CORR);
    const ctxB = makeTenantContext(TENANT_B, CORR);
    expect(store.put(ctxA, built.demand).ok).toBe(true);
    expect(store.put(ctxA, built.demand).ok).toBe(false);
    // Same id in tenant B is a different demand (partitioned).
    const builtB = buildDemand(TENANT_B, demandInput());
    if (!builtB.ok) throw new Error(builtB.error.message);
    expect(store.put(ctxB, builtB.demand).ok).toBe(true);
  });

  test("cross-tenant put is rejected (tenant mismatch)", () => {
    const store = createInMemoryDemandStore();
    const built = buildDemand(TENANT_A, demandInput());
    if (!built.ok) throw new Error(built.error.message);
    const ctxB = makeTenantContext(TENANT_B, CORR);
    const result = store.put(ctxB, built.demand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind !== "DomainError") return;
    expect(result.error.invariant).toBe("tenant_mismatch");
  });

  test("an empty tenant partition reads as empty", () => {
    const store = createInMemoryDemandStore();
    const freshCtx = makeTenantContext(asTenantId("tnt_freshtenant0"));
    expect(store.list(freshCtx)).toEqual([]);
    expect(store.size(freshCtx)).toBe(0);
  });
});
