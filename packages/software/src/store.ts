/**
 * @fleetos/software — D4: the tenant-scoped subscription store + the
 * audited service boundary.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `TenantContext` as its FIRST parameter; the runtime
 * guard `requireTenantContext` rejects context-free and invalid-tenant
 * access; storage is partitioned per tenant.
 *
 * `asTenantScopedSubscriptionStore` projects the store onto W012's
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
import type {
  AllocateSubscriptionInput,
  ReviseSubscriptionInput,
  SoftwareSubscription,
} from "./subscription";
import { allocateSubscription, reviseSubscription } from "./subscription";
import type { SoftwareAuditRecord, SoftwareAuditSink } from "./audit-seam";
import { NOOP_SOFTWARE_AUDIT_SINK, SOFTWARE_AUDIT_ACTIONS } from "./audit-seam";
import { ERROR_CODES, SYNTHETIC_SYSTEM_CORRELATION_ID, frozen, frozenArray, makeDomainError } from "./internal";

/** The tagged result of a store write. */
export type SubscriptionStoreWrite =
  | { readonly ok: true; readonly subscription: SoftwareSubscription }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped subscription store. Every operation takes the
 * acting `TenantContext` as its FIRST parameter. Revisions are
 * append-only.
 */
export interface SubscriptionStore {
  /** Allocate revision 1. Fails with `subscription_already_exists` when present. */
  allocate(
    ctx: TenantContext,
    input: AllocateSubscriptionInput,
  ): SubscriptionStoreWrite;
  /**
   * Append the next revision. A subscription id that exists only in
   * another tenant's partition is indistinguishable from an unknown
   * subscription.
   */
  revise(
    ctx: TenantContext,
    subscriptionId: string,
    input: ReviseSubscriptionInput,
  ): SubscriptionStoreWrite;
  /** The latest revision (own partition only). */
  getLatest(ctx: TenantContext, subscriptionId: string): SoftwareSubscription | undefined;
  /** Every subscription (latest revision) in the acting partition, subscriptionId order. */
  list(ctx: TenantContext): readonly SoftwareSubscription[];
  /** The full revision history of one subscription, revision order. */
  listRevisions(ctx: TenantContext, subscriptionId: string): readonly SoftwareSubscription[];
  /** The number of distinct subscriptions in the acting partition. */
  size(ctx: TenantContext): number;
}

/**
 * The in-memory reference store, extended with the raw tenant-scoped
 * KV view (for W012's isolation harness).
 */
export interface InMemorySubscriptionStore extends SubscriptionStore {
  readonly tenantScopedView: TenantScopedStore<SoftwareSubscription>;
}

/**
 * Create the in-memory reference `SubscriptionStore`. Storage is
 * partitioned by tenant id; revisions are append-only per subscription.
 *
 * Judgment call (documented): like the demand store, the subscription
 * store maintains TWO separate per-tenant partition maps (one for the
 * rich store, keyed by subscriptionId; one for the raw KV view, keyed
 * by the harness's caller-supplied key). The subscriptionId is
 * computed deterministically (a `sub_<hash>` string), so it cannot
 * equal the W012 harness's fixed "k1"/"k2" keys; sharing partitions
 * would break the harness's reference-equality check.
 */
export function createInMemorySubscriptionStore(): InMemorySubscriptionStore {
  /** tenantId -> (subscriptionId -> revisions) — the rich store. */
  const partitions = new Map<string, Map<string, SoftwareSubscription[]>>();
  /** tenantId -> (key -> subscription) — the raw KV view (W012 harness). */
  const rawPartitions = new Map<string, Map<string, SoftwareSubscription>>();

  function partitionOf(tenantId: TenantId): Map<string, SoftwareSubscription[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, SoftwareSubscription[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function rawPartitionOf(tenantId: TenantId): Map<string, SoftwareSubscription> {
    let partition = rawPartitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, SoftwareSubscription>();
      rawPartitions.set(tenantId, partition);
    }
    return partition;
  }

  function notFound(tenantId: TenantId, subscriptionId: string): FleetError {
    return makeDomainError(
      ERROR_CODES.subscriptionDomain,
      "subscription not found in the acting tenant's partition",
      { tenantId, correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID },
      "software.subscription.store",
      "subscription_unknown",
    );
  }

  const rich: SubscriptionStore = frozen({
    allocate(
      ctx: TenantContext,
      input: AllocateSubscriptionInput,
    ): SubscriptionStoreWrite {
      const tenantId = requireTenantContext(ctx);
      const built = allocateSubscription(tenantId, input);
      if (!built.ok) return built;
      const partition = partitionOf(tenantId);
      if (partition.has(built.subscription.subscriptionId)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.subscriptionDomain,
            "subscription already exists in the acting tenant's partition",
            { tenantId, correlationId: input.correlationId },
            "software.subscription.store",
            "subscription_already_exists",
          ),
        };
      }
      partition.set(built.subscription.subscriptionId, [built.subscription]);
      return { ok: true, subscription: built.subscription };
    },

    revise(
      ctx: TenantContext,
      subscriptionId: string,
      input: ReviseSubscriptionInput,
    ): SubscriptionStoreWrite {
      const tenantId = requireTenantContext(ctx);
      if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.subscriptionDomain,
            "subscription id must be a non-empty string",
            { tenantId, correlationId: input?.correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID },
            "software.subscription.store",
            "subscription_id_invalid",
          ),
        };
      }
      const partition = partitions.get(tenantId);
      const revisions = partition?.get(subscriptionId);
      if (revisions === undefined || revisions.length === 0) {
        return { ok: false, error: notFound(tenantId, subscriptionId) };
      }
      const prior = revisions[revisions.length - 1] as SoftwareSubscription;
      const built = reviseSubscription(prior, input);
      if (!built.ok) return built;
      revisions.push(built.subscription);
      return { ok: true, subscription: built.subscription };
    },

    getLatest(ctx: TenantContext, subscriptionId: string): SoftwareSubscription | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(subscriptionId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },

    list(ctx: TenantContext): readonly SoftwareSubscription[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.values()]
          .filter((revisions) => revisions.length > 0)
          .map((revisions) => revisions[revisions.length - 1] as SoftwareSubscription)
          .sort((a, b) =>
            a.subscriptionId < b.subscriptionId ? -1 : a.subscriptionId > b.subscriptionId ? 1 : 0,
          ),
      );
    },

    listRevisions(
      ctx: TenantContext,
      subscriptionId: string,
    ): readonly SoftwareSubscription[] {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(subscriptionId);
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
  const tenantScopedView: TenantScopedStore<SoftwareSubscription> = frozen({
    put(ctx: TenantContext, key: string, value: SoftwareSubscription): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null) {
        throw new TypeError("tenantScopedView: value must be a SoftwareSubscription object");
      }
      rawPartitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): SoftwareSubscription | undefined {
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
    list(ctx: TenantContext): readonly TenantStoreEntry<SoftwareSubscription>[] {
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
export function asTenantScopedSubscriptionStore(
  store: InMemorySubscriptionStore,
): TenantScopedStore<SoftwareSubscription> {
  return store.tenantScopedView;
}

// ---------------------------------------------------------------------------
// The audited service boundary
// ---------------------------------------------------------------------------

/** Dependencies of the audited subscription service. */
export interface SubscriptionServiceOptions {
  readonly store: SubscriptionStore;
  readonly auditSink?: SoftwareAuditSink;
}

/** The audited boundary over a `SubscriptionStore`. */
export interface SubscriptionService {
  allocate(
    ctx: TenantContext,
    input: AllocateSubscriptionInput,
  ): SubscriptionStoreWrite;
  revise(
    ctx: TenantContext,
    subscriptionId: string,
    input: ReviseSubscriptionInput,
  ): SubscriptionStoreWrite;
}

/**
 * Create the audited subscription service. Every successful mutation
 * emits exactly one audit record.
 */
export function createSubscriptionService(
  options: SubscriptionServiceOptions,
): SubscriptionService {
  if (typeof options?.store !== "object" || options?.store === null) {
    throw new TypeError("createSubscriptionService: store is required");
  }
  const store = options.store;
  const sink: SoftwareAuditSink = options.auditSink ?? NOOP_SOFTWARE_AUDIT_SINK;

  return frozen({
    allocate(
      ctx: TenantContext,
      input: AllocateSubscriptionInput,
    ): SubscriptionStoreWrite {
      const result = store.allocate(ctx, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: SOFTWARE_AUDIT_ACTIONS.subscriptionAllocated,
            tenantId: result.subscription.tenantId,
            subject: result.subscription.subscriptionId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              softwareId: result.subscription.softwareId,
              seatCount: result.subscription.seatCount,
              termDays: result.subscription.termDays,
              workloadId: result.subscription.workloadId,
              revision: result.subscription.revision,
              contentHash: result.subscription.contentHash,
              modelVersion: result.subscription.modelVersion,
            },
          } satisfies SoftwareAuditRecord),
        );
      }
      return result;
    },

    revise(
      ctx: TenantContext,
      subscriptionId: string,
      input: ReviseSubscriptionInput,
    ): SubscriptionStoreWrite {
      const prior = store.getLatest(ctx, subscriptionId);
      const result = store.revise(ctx, subscriptionId, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: SOFTWARE_AUDIT_ACTIONS.subscriptionRevised,
            tenantId: result.subscription.tenantId,
            subject: result.subscription.subscriptionId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              fromRevision: prior === undefined ? null : prior.revision,
              toRevision: result.subscription.revision,
              softwareId: result.subscription.softwareId,
              fromSeatCount: prior === undefined ? null : prior.seatCount,
              toSeatCount: result.subscription.seatCount,
              fromTermDays: prior === undefined ? null : prior.termDays,
              toTermDays: result.subscription.termDays,
              contentHash: result.subscription.contentHash,
              priorContentHash: prior === undefined ? null : prior.contentHash,
            },
          } satisfies SoftwareAuditRecord),
        );
      }
      return result;
    },
  });
}
