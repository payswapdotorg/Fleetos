/**
 * @fleetos/procurement — D2c: the tenant-scoped demand store.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `TenantContext` as its FIRST parameter; the runtime
 * guard `requireTenantContext` rejects context-free and invalid-tenant
 * access even when a caller bypasses the types; storage is partitioned
 * per tenant.
 *
 * `asTenantScopedDemandStore` projects the store onto W012's
 * `TenantScopedStore<V>` interface for the reusable isolation harness.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { FleetError, TenantId } from "@fleetos/contracts";
import type {
  TenantContext,
  TenantScopedStore,
  TenantStoreEntry,
} from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { ProcurementDemand } from "./demand";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";

/** The tagged result of a demand store write. */
export type DemandStoreWrite =
  | { readonly ok: true; readonly demand: ProcurementDemand }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped demand store. Every operation takes the acting
 * `TenantContext` as its FIRST parameter and touches only the acting
 * tenant's partition.
 */
export interface DemandStore {
  /** Put a demand. Fails with `demand_already_exists` when present. */
  put(ctx: TenantContext, demand: ProcurementDemand): DemandStoreWrite;
  /** Get a demand by id (own partition only). */
  get(ctx: TenantContext, demandId: string): ProcurementDemand | undefined;
  /** Every demand in the acting partition, demandId order. */
  list(ctx: TenantContext): readonly ProcurementDemand[];
  /** The number of demands in the acting partition. */
  size(ctx: TenantContext): number;
}

/**
 * The in-memory reference demand store, extended with the raw
 * tenant-scoped KV view (for W012's isolation harness).
 */
export interface InMemoryDemandStore extends DemandStore {
  readonly tenantScopedView: TenantScopedStore<ProcurementDemand>;
}

/**
 * Create the in-memory reference `DemandStore`. Storage is partitioned
 * by tenant id; demands are stored by id.
 *
 * Judgment call (documented): unlike the workloads store (which
 * shares partitions with its tenantScopedView because the workloadId
 * is caller-supplied), the demand store maintains TWO separate
 * per-tenant partition maps:
 *   1. the RICH store's `Map<demandId, demand>` — the domain store,
 *      keyed by the demand's deterministic `demandId`;
 *   2. the RAW KV view's `Map<key, demand>` — the W012 isolation-
 *      harness view, keyed by the harness's caller-supplied key
 *      (which may be any non-empty string — the harness uses fixed
 *      "k1"/"k2" keys).
 *
 * The demand's `demandId` is computed deterministically (a
 * `dmd_<hash>` string), so it cannot be controlled by the caller;
 * the W012 isolation harness's `makeValue(tenantId, key)` cannot
 * produce a demand whose `demandId === key`. Sharing partitions
 * would break the harness's reference-equality check.
 */
export function createInMemoryDemandStore(): InMemoryDemandStore {
  /** tenantId -> (demandId -> demand) — the rich store. */
  const partitions = new Map<string, Map<string, ProcurementDemand>>();
  /** tenantId -> (key -> demand) — the raw KV view (W012 harness). */
  const rawPartitions = new Map<string, Map<string, ProcurementDemand>>();

  function partitionOf(tenantId: TenantId): Map<string, ProcurementDemand> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ProcurementDemand>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function rawPartitionOf(tenantId: TenantId): Map<string, ProcurementDemand> {
    let partition = rawPartitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ProcurementDemand>();
      rawPartitions.set(tenantId, partition);
    }
    return partition;
  }

  const rich: DemandStore = frozen({
    put(ctx: TenantContext, demand: ProcurementDemand): DemandStoreWrite {
      const tenantId = requireTenantContext(ctx);
      if (
        typeof demand !== "object" ||
        demand === null ||
        typeof demand.demandId !== "string" ||
        demand.demandId.length === 0
      ) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.demandDomain,
            "demand id must be a non-empty string",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "procurement.demand.store",
            "demand_id_invalid",
          ),
        };
      }
      if (demand.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.demandDomain,
            "demand tenantId does not match the acting context",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "procurement.demand.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      if (partition.has(demand.demandId)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.demandDomain,
            "demand already exists in the acting tenant's partition",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "procurement.demand.store",
            "demand_already_exists",
          ),
        };
      }
      partition.set(demand.demandId, demand);
      return { ok: true, demand };
    },
    get(ctx: TenantContext, demandId: string): ProcurementDemand | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof demandId !== "string" || demandId.length === 0) return undefined;
      return partitions.get(tenantId)?.get(demandId);
    },
    list(ctx: TenantContext): readonly ProcurementDemand[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.values()].sort((a, b) =>
          a.demandId < b.demandId ? -1 : a.demandId > b.demandId ? 1 : 0,
        ),
      );
    },
    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return partitions.get(tenantId)?.size ?? 0;
    },
  });

  // The raw KV view — SEPARATE partitions (judgment call above).
  // The view uses the harness's caller-supplied key directly (any
  // non-empty string), not the demand's demandId. This is the W012
  // isolation-harness contract: `put(ctx, key, value)` round-trips a
  // value under a key, and `list(ctx)` returns the entries with the
  // SAME keys used in `put`.
  const tenantScopedView: TenantScopedStore<ProcurementDemand> = frozen({
    put(ctx: TenantContext, key: string, value: ProcurementDemand): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null) {
        throw new TypeError("tenantScopedView: value must be a ProcurementDemand object");
      }
      rawPartitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): ProcurementDemand | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return undefined;
      return rawPartitions.get(tenantId)?.get(key);
    },
    has(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.has(key) ?? false;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<ProcurementDemand>[] {
      const tenantId = requireTenantContext(ctx);
      const partition = rawPartitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.entries()]
          .map(([key, value]) => frozen({ key, value }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      );
    },
    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return rawPartitions.get(tenantId)?.size ?? 0;
    },
  });

  return frozen({ ...rich, tenantScopedView });
}

/** Project the in-memory store's view for W012's isolation harness. */
export function asTenantScopedDemandStore(
  store: InMemoryDemandStore,
): TenantScopedStore<ProcurementDemand> {
  return store.tenantScopedView;
}
