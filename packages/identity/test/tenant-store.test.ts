/**
 * W012 D1 — TenantScopedStore: cross-tenant reads impossible by construction.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  TenantIsolationError,
  createInMemoryTenantStore,
  makeTenantContext,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const TENANT_C = asTenantId("tnt_gamma000003");

test("put/get roundtrip within one tenant", () => {
  const store = createInMemoryTenantStore<string>();
  const ctx = makeTenantContext(TENANT_A);
  store.put(ctx, "device-1", "twin");
  expect(store.get(ctx, "device-1")).toBe("twin");
  expect(store.has(ctx, "device-1")).toBe(true);
  expect(store.has(ctx, "device-2")).toBe(false);
});

test("cross-tenant reads are impossible by construction (no tenant override API)", () => {
  const store = createInMemoryTenantStore<string>();
  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  store.put(ctxA, "secret", "tenant-a-value");

  // The only tenant context B can present is its own — and its partition is
  // empty. There is no API to name tenant A.
  expect(store.get(ctxB, "secret")).toBeUndefined();
  expect(store.has(ctxB, "secret")).toBe(false);
  expect(store.size(ctxB)).toBe(0);
  expect(store.list(ctxB)).toHaveLength(0);
});

test("the same key in different tenants holds independent values", () => {
  const store = createInMemoryTenantStore<number>();
  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  store.put(ctxA, "k", 1);
  store.put(ctxB, "k", 2);
  expect(store.get(ctxA, "k")).toBe(1);
  expect(store.get(ctxB, "k")).toBe(2);
});

test("list returns a key-sorted, frozen view scoped to the acting tenant", () => {
  const store = createInMemoryTenantStore<string>();
  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  store.put(ctxA, "b", "2");
  store.put(ctxA, "a", "1");
  store.put(ctxA, "c", "3");
  store.put(ctxB, "z", "foreign");

  const listed = store.list(ctxA);
  expect(listed.map((entry) => entry.key)).toEqual(["a", "b", "c"]);
  expect(Object.isFrozen(listed)).toBe(true);
  expect(() => {
    (listed as unknown as { push: (v: unknown) => number }).push({ key: "x", value: "x" });
  }).toThrow();
  expect(store.size(ctxA)).toBe(3);
  expect(store.size(ctxB)).toBe(1);
});

test("remove is scoped to the acting tenant", () => {
  const store = createInMemoryTenantStore<string>();
  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  store.put(ctxA, "k", "a-value");
  expect(store.remove(ctxB, "k")).toBe(false);
  expect(store.get(ctxA, "k")).toBe("a-value");
  expect(store.remove(ctxA, "k")).toBe(true);
  expect(store.get(ctxA, "k")).toBeUndefined();
});

test("every operation rejects context-free access", () => {
  const store = createInMemoryTenantStore<string>();
  const ops: (() => unknown)[] = [
    () => store.put(undefined as never, "k", "v"),
    () => store.get(undefined as never, "k"),
    () => store.has(undefined as never, "k"),
    () => store.remove(undefined as never, "k"),
    () => store.list(undefined as never),
    () => store.size(undefined as never),
  ];
  for (const op of ops) {
    expect(op).toThrow(TenantIsolationError);
  }
});

test("empty keys are rejected deterministically", () => {
  const store = createInMemoryTenantStore<string>();
  const ctx = makeTenantContext(TENANT_C);
  expect(() => store.put(ctx, "", "v")).toThrow(TypeError);
  expect(() => store.get(ctx, "")).toThrow(TypeError);
});

test("fresh tenants observe empty partitions without materializing them", () => {
  const store = createInMemoryTenantStore<string>();
  const ctxC = makeTenantContext(TENANT_C);
  expect(store.get(ctxC, "anything")).toBeUndefined();
  expect(store.list(ctxC)).toEqual([]);
  expect(store.size(ctxC)).toBe(0);
});
