/**
 * @fleetos/maintenance — D4: the tenant-scoped service work order store.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, `packages/identity`):
 *   - every operation takes the acting `TenantContext` (from the same-lane
 *     `@fleetos/identity`) as its FIRST parameter;
 *   - the runtime guard `requireTenantContext` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types;
 *   - storage is partitioned per tenant (`Map<tenantId, Map<workOrderId,
 *     revisions[]>>`), and NO operation accepts a tenant override — a
 *     tenant-A context can never read tenant-B work orders because the
 *     only tenant it can name is its own.
 *
 * `asTenantScopedWorkOrderStore` projects the store onto W012's
 * `TenantScopedStore<V>` interface so the REUSABLE isolation harness
 * (`runTenantIsolationSuite`) verifies the partitions — the same-lane
 * consumption W012 documented for this package.
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
import type { ServiceWorkOrder } from "./service-work-order";
import {
  ERROR_CODES,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";

/** The tagged result of a work order store write. */
export type WorkOrderStoreWrite =
  | { readonly ok: true; readonly workOrder: ServiceWorkOrder }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped service work order store. Every operation takes the
 * acting `TenantContext` as its FIRST parameter and touches only the
 * acting tenant's partition. Revisions are append-only: `reviseWorkOrder`
 * appends revision prior+1 and never rewrites history.
 */
export interface ServiceWorkOrderStore {
  /** Put revision 1 of a work order. Fails with `workorder_already_exists` when present. */
  put(ctx: TenantContext, workOrder: ServiceWorkOrder): WorkOrderStoreWrite;
  /** Append the next revision of a work order in the ACTING tenant's partition. */
  appendRevision(ctx: TenantContext, workOrder: ServiceWorkOrder): WorkOrderStoreWrite;
  /** The latest revision of a work order (own partition only). */
  getLatestWorkOrder(ctx: TenantContext, workOrderId: string): ServiceWorkOrder | undefined;
  /** A specific revision (own partition only). */
  getWorkOrderRevision(
    ctx: TenantContext,
    workOrderId: string,
    revision: number,
  ): ServiceWorkOrder | undefined;
  /** Every work order (latest revision) in the acting partition, workOrderId order. */
  listWorkOrders(ctx: TenantContext): readonly ServiceWorkOrder[];
  /** The full revision history of one work order (own partition only), revision order. */
  listRevisions(ctx: TenantContext, workOrderId: string): readonly ServiceWorkOrder[];
  /** The number of distinct work orders in the acting partition. */
  size(ctx: TenantContext): number;
}

/**
 * The in-memory reference work order store, extended with the raw
 * tenant-scoped KV view (for W012's isolation harness).
 */
export interface InMemoryServiceWorkOrderStore extends ServiceWorkOrderStore {
  readonly tenantScopedView: TenantScopedStore<ServiceWorkOrder>;
}

/**
 * Create the in-memory reference `ServiceWorkOrderStore`. Storage is
 * partitioned by tenant id; revisions are append-only per work order.
 *
 * Judgment call (documented, mirrors W032's demand store): the store
 * maintains TWO separate per-tenant partition maps:
 *   1. the RICH store's `Map<workOrderId, revisions[]>` — the domain
 *      store, keyed by the work order's deterministic `workOrderId`;
 *   2. the RAW KV view's `Map<key, workOrder>` — the W012 isolation-
 *      harness view, keyed by the harness's caller-supplied key (which
 *      may be any non-empty string — the harness uses fixed "k1"/"k2"
 *      keys).
 *
 * The work order's `workOrderId` is computed deterministically (a
 * `swo_<hash>` string), so it cannot be controlled by the caller;
 * the W012 isolation harness's `makeValue(tenantId, key)` cannot
 * produce a work order whose `workOrderId === key`. Sharing partitions
 * would break the harness's reference-equality check.
 */
export function createInMemoryServiceWorkOrderStore(): InMemoryServiceWorkOrderStore {
  /** tenantId -> (workOrderId -> revisions, append order). */
  const partitions = new Map<string, Map<string, ServiceWorkOrder[]>>();
  /** tenantId -> (key -> workOrder) — the raw KV view (W012 harness). */
  const rawPartitions = new Map<string, Map<string, ServiceWorkOrder>>();

  function partitionOf(tenantId: TenantId): Map<string, ServiceWorkOrder[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ServiceWorkOrder[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function rawPartitionOf(tenantId: TenantId): Map<string, ServiceWorkOrder> {
    let partition = rawPartitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ServiceWorkOrder>();
      rawPartitions.set(tenantId, partition);
    }
    return partition;
  }

  function appendRevisionInternal(
    tenantId: TenantId,
    workOrder: ServiceWorkOrder,
  ): WorkOrderStoreWrite {
    if (
      typeof workOrder !== "object" ||
      workOrder === null ||
      typeof workOrder.workOrderId !== "string" ||
      workOrder.workOrderId.length === 0
    ) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.workOrderStoreDomain,
          "service work order id must be a non-empty string",
          { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "maintenance.workorder.store",
          "workorder_id_invalid",
        ),
      };
    }
    if (workOrder.tenantId !== tenantId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.workOrderStoreDomain,
          "service work order tenantId does not match the acting context",
          { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "maintenance.workorder.store",
          "tenant_mismatch",
        ),
      };
    }
    const partition = partitionOf(tenantId);
    let revisions = partition.get(workOrder.workOrderId);
    if (revisions === undefined) {
      if (workOrder.revision !== 1) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.workOrderStoreDomain,
            "service work order revision 1 expected for an unknown work order",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "maintenance.workorder.store",
            "revision_out_of_sequence",
          ),
        };
      }
      revisions = [];
      partition.set(workOrder.workOrderId, revisions);
    }
    const expectedRevision =
      revisions.length === 0 ? 1 : (revisions[revisions.length - 1] as ServiceWorkOrder).revision + 1;
    if (workOrder.revision !== expectedRevision) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.workOrderStoreDomain,
          `service work order revision out of sequence (expected ${expectedRevision}, got ${workOrder.revision})`,
          { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
          "maintenance.workorder.store",
          "revision_out_of_sequence",
        ),
      };
    }
    revisions.push(workOrder);
    return { ok: true, workOrder };
  }

  const rich: ServiceWorkOrderStore = frozen({
    put(ctx: TenantContext, workOrder: ServiceWorkOrder): WorkOrderStoreWrite {
      const tenantId = requireTenantContext(ctx);
      if (
        typeof workOrder !== "object" ||
        workOrder === null ||
        typeof workOrder.workOrderId !== "string" ||
        workOrder.workOrderId.length === 0
      ) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.workOrderStoreDomain,
            "service work order id must be a non-empty string",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "maintenance.workorder.store",
            "workorder_id_invalid",
          ),
        };
      }
      if (workOrder.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.workOrderStoreDomain,
            "service work order tenantId does not match the acting context",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "maintenance.workorder.store",
            "tenant_mismatch",
          ),
        };
      }
      if (workOrder.revision !== 1) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.workOrderStoreDomain,
            "service work order put requires revision 1 (use appendRevision for subsequent revisions)",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "maintenance.workorder.store",
            "revision_not_one",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      if (partition.has(workOrder.workOrderId)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.workOrderStoreDomain,
            "service work order already exists in the acting tenant's partition",
            { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
            "maintenance.workorder.store",
            "workorder_already_exists",
          ),
        };
      }
      partition.set(workOrder.workOrderId, [workOrder]);
      return { ok: true, workOrder };
    },

    appendRevision(ctx: TenantContext, workOrder: ServiceWorkOrder): WorkOrderStoreWrite {
      const tenantId = requireTenantContext(ctx);
      return appendRevisionInternal(tenantId, workOrder);
    },

    getLatestWorkOrder(
      ctx: TenantContext,
      workOrderId: string,
    ): ServiceWorkOrder | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof workOrderId !== "string" || workOrderId.length === 0) return undefined;
      const revisions = partitions.get(tenantId)?.get(workOrderId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },

    getWorkOrderRevision(
      ctx: TenantContext,
      workOrderId: string,
      revision: number,
    ): ServiceWorkOrder | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(workOrderId);
      if (revisions === undefined) return undefined;
      if (!Number.isInteger(revision) || revision < 1 || revision > revisions.length) {
        return undefined;
      }
      return revisions[revision - 1];
    },

    listWorkOrders(ctx: TenantContext): readonly ServiceWorkOrder[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.values()]
          .filter((revisions) => revisions.length > 0)
          .map((revisions) => revisions[revisions.length - 1] as ServiceWorkOrder)
          .sort((a, b) =>
            a.workOrderId < b.workOrderId ? -1 : a.workOrderId > b.workOrderId ? 1 : 0,
          ),
      );
    },

    listRevisions(
      ctx: TenantContext,
      workOrderId: string,
    ): readonly ServiceWorkOrder[] {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(workOrderId);
      if (revisions === undefined) return frozenArray([]);
      return frozenArray(revisions);
    },

    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return 0;
      let count = 0;
      for (const revisions of partition.values()) {
        if (revisions.length > 0) count += 1;
      }
      return count;
    },
  });

  // The raw KV view — SEPARATE partitions (judgment call above).
  // The view uses the harness's caller-supplied key directly (any
  // non-empty string), not the work order's workOrderId. This is the
  // W012 isolation-harness contract: `put(ctx, key, value)` round-trips
  // a value under a key, and `list(ctx)` returns the entries with the
  // SAME keys used in `put`.
  const tenantScopedView: TenantScopedStore<ServiceWorkOrder> = frozen({
    put(ctx: TenantContext, key: string, value: ServiceWorkOrder): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null) {
        throw new TypeError("tenantScopedView: value must be a ServiceWorkOrder object");
      }
      rawPartitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): ServiceWorkOrder | undefined {
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
    list(ctx: TenantContext): readonly TenantStoreEntry<ServiceWorkOrder>[] {
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
export function asTenantScopedWorkOrderStore(
  store: InMemoryServiceWorkOrderStore,
): TenantScopedStore<ServiceWorkOrder> {
  return store.tenantScopedView;
}
