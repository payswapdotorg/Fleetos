/**
 * @fleetos/identity — Tenant-scoped store interfaces (W012 D1).
 *
 * Every read/write is keyed by the `TenantId` carried on the mandatory
 * `TenantContext` (first parameter of every operation). A tenant-scoped
 * store has NO API that accepts a tenant override: cross-tenant reads are
 * impossible by construction, because the only tenant a caller can name is
 * the one on its own context.
 *
 * The in-memory reference implementation partitions storage by tenant id
 * (`Map<tenantId, Map<key, value>>`) and routes every operation through the
 * context guard (`requireTenantContext`). Later lane-C work items
 * (workloads, vendors, procurement, software, maintenance) implement this
 * interface against durable storage.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { TenantContext } from "./tenant-context";
import { requireTenantContext } from "./tenant-context";

/**
 * A key/value entry in a tenant-scoped store. `key` is unique per tenant,
 * not globally.
 */
export interface TenantStoreEntry<V> {
  readonly key: string;
  readonly value: V;
}

/**
 * The tenant-scoped store contract for this lane. Every operation takes the
 * acting `TenantContext` as its FIRST parameter and can only touch the
 * context's tenant partition.
 */
export interface TenantScopedStore<V> {
  /** Write `value` under `key` in the acting tenant's partition. */
  put(ctx: TenantContext, key: string, value: V): void;
  /** Read `key` from the acting tenant's partition (undefined when absent). */
  get(ctx: TenantContext, key: string): V | undefined;
  /** Whether `key` exists in the acting tenant's partition. */
  has(ctx: TenantContext, key: string): boolean;
  /** Remove `key` from the acting tenant's partition; true when removed. */
  remove(ctx: TenantContext, key: string): boolean;
  /**
   * All entries in the acting tenant's partition, deterministically sorted
   * by key. The returned array is a frozen copy — callers cannot mutate the
   * store through it.
   */
  list(ctx: TenantContext): readonly TenantStoreEntry<V>[];
  /** The number of entries in the acting tenant's partition. */
  size(ctx: TenantContext): number;
}

/**
 * Create the in-memory reference implementation of `TenantScopedStore`.
 * Storage is partitioned by tenant id; no operation can cross partitions.
 *
 * @template V the stored value type
 * @returns a frozen TenantScopedStore
 */
export function createInMemoryTenantStore<V>(): TenantScopedStore<V> {
  /** Keyed by tenant id string; values are the per-tenant partitions. */
  const partitions = new Map<string, Map<string, V>>();

  function partitionOf(tenantId: TenantId): Map<string, V> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, V>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function checkKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("TenantScopedStore: key must be a non-empty string");
    }
  }

  return frozen({
    put(ctx: TenantContext, key: string, value: V): void {
      const tenantId = requireTenantContext(ctx);
      checkKey(key);
      partitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): V | undefined {
      const tenantId = requireTenantContext(ctx);
      checkKey(key);
      return partitions.get(tenantId)?.get(key);
    },
    has(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      checkKey(key);
      return partitions.get(tenantId)?.has(key) ?? false;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      checkKey(key);
      return partitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<V>[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return Object.freeze([]) as readonly TenantStoreEntry<V>[];
      const entries: TenantStoreEntry<V>[] = [...partition.entries()]
        .map(([key, value]) => frozen({ key, value } as TenantStoreEntry<V>))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return Object.freeze(entries);
    },
    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return partitions.get(tenantId)?.size ?? 0;
    },
  });
}
