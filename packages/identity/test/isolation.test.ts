/**
 * W012 D1 — The reusable tenant-isolation harness.
 *
 * Two directions of proof:
 *   1. POSITIVE: the reference in-memory store passes every check.
 *   2. NEGATIVE CONTROL: a deliberately broken store (single global map,
 *      tenant ignored) FAILS the suite — the harness detects violations,
 *      it does not just rubber-stamp implementations.
 */

import { test, expect } from "bun:test";
import { asTenantId, type TenantId } from "@fleetos/contracts";
import {
  type TenantScopedStore,
  createInMemoryTenantStore,
  makeTenantContext,
  runTenantIsolationSuite,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");

test("the reference in-memory store passes the full isolation suite", () => {
  const report = runTenantIsolationSuite<string>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: () => createInMemoryTenantStore<string>(),
    makeValue: (tenantId: TenantId, key: string) => `${tenantId}:${key}`,
  });
  expect(report.ok).toBe(true);
  expect(report.checks).toHaveLength(7);
  const names = report.checks.map((check) => check.name);
  expect(names).toEqual([
    "own_tenant_roundtrip",
    "cross_tenant_read_miss",
    "same_key_partition",
    "context_free_rejected",
    "invalid_context_rejected",
    "enumeration_scoped",
    "remove_scoped",
  ]);
});

test("NEGATIVE CONTROL: a tenant-ignoring store fails the suite", () => {
  // A store that keys ONLY by key — the tenant partition is ignored, which
  // is the classic cross-tenant leak. It still satisfies the guard shape
  // (a context is required), proving the guard alone is not isolation.
  const makeBrokenStore = (): TenantScopedStore<string> => {
    const global = new Map<string, string>();
    return {
      put(_ctx, key, value) {
        global.set(key, value);
      },
      get(_ctx, key) {
        return global.get(key);
      },
      has(_ctx, key) {
        return global.has(key);
      },
      remove(_ctx, key) {
        return global.delete(key);
      },
      list(_ctx) {
        return [...global.entries()]
          .map(([key, value]) => ({ key, value }))
          .sort((a, b) => (a.key < b.key ? -1 : 1));
      },
      size() {
        return global.size;
      },
    };
  };

  const report = runTenantIsolationSuite<string>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: makeBrokenStore,
    makeValue: (tenantId: TenantId, key: string) => `${tenantId}:${key}`,
  });
  expect(report.ok).toBe(false);
  const failedNames = report.checks.filter((c) => !c.passed).map((c) => c.name);
  expect(failedNames).toContain("cross_tenant_read_miss");
  expect(failedNames).toContain("same_key_partition");
  expect(failedNames).toContain("enumeration_scoped");
  expect(failedNames).toContain("remove_scoped");
});

test("NEGATIVE CONTROL: a guard-ignoring store fails the context-free check", () => {
  // A store that partitions correctly but skips the guard: context-free
  // access is silently tolerated.
  const makeGuardlessStore = (): TenantScopedStore<string> => {
    const partitions = new Map<string, Map<string, string>>();
    const partitionOf = (tenantId: string): Map<string, string> => {
      let partition = partitions.get(tenantId);
      if (partition === undefined) {
        partition = new Map<string, string>();
        partitions.set(tenantId, partition);
      }
      return partition;
    };
    return {
      put(ctx, key, value) {
        partitionOf((ctx as { tenantId: string }).tenantId ?? "none").set(key, value);
      },
      get(ctx, key) {
        return partitionOf((ctx as { tenantId: string }).tenantId ?? "none").get(key);
      },
      has(ctx, key) {
        return partitionOf((ctx as { tenantId: string }).tenantId ?? "none").has(key);
      },
      remove(ctx, key) {
        return partitionOf((ctx as { tenantId: string }).tenantId ?? "none").delete(key);
      },
      list(ctx) {
        return [...partitionOf((ctx as { tenantId: string }).tenantId ?? "none").entries()]
          .map(([key, value]) => ({ key, value }))
          .sort((a, b) => (a.key < b.key ? -1 : 1));
      },
      size(ctx) {
        return partitionOf((ctx as { tenantId: string }).tenantId ?? "none").size;
      },
    };
  };

  const report = runTenantIsolationSuite<string>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: makeGuardlessStore,
    makeValue: (tenantId: TenantId, key: string) => `${tenantId}:${key}`,
  });
  expect(report.ok).toBe(false);
  const failedNames = report.checks.filter((c) => !c.passed).map((c) => c.name);
  expect(failedNames).toContain("context_free_rejected");
  expect(failedNames).toContain("invalid_context_rejected");
});

test("the harness is deterministic: two runs produce identical reports", () => {
  const run = (): string =>
    JSON.stringify(
      runTenantIsolationSuite<string>({
        tenantA: TENANT_A,
        tenantB: TENANT_B,
        makeStore: () => createInMemoryTenantStore<string>(),
        makeValue: (tenantId: TenantId, key: string) => `${tenantId}:${key}`,
      }),
    );
  expect(run()).toBe(run());
});

test("the harness works with structured values too", () => {
  interface Sample {
    readonly tenant: string;
    readonly payload: number;
  }
  const report = runTenantIsolationSuite<Sample>({
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    makeStore: () => createInMemoryTenantStore<Sample>(),
    makeValue: (tenantId: TenantId, key: string) => ({
      tenant: tenantId,
      payload: key.length,
    }),
  });
  expect(report.ok).toBe(true);
  // makeTenantContext is exercised implicitly by the harness.
  expect(makeTenantContext(TENANT_A).tenantId).toBe(TENANT_A);
});
