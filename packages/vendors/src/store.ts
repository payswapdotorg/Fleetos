/**
 * @fleetos/vendors — D1/D4: the tenant-scoped vendor store + the
 * audited service boundary.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, `packages/identity`):
 *   - every operation takes the acting `TenantContext` (from the same-lane
 *     `@fleetos/identity`) as its FIRST parameter;
 *   - the runtime guard `requireTenantContext` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types;
 *   - storage is partitioned per tenant (`Map<tenantId, Map<vendorId,
 *     revisions[]>>`), and NO operation accepts a tenant override — a
 *     tenant-A context can never read tenant-B vendors because the only
 *     tenant it can name is its own.
 *
 * The `VendorService` wraps a store with an INJECTED audit sink
 * (W012's audit primitives pattern): every consequential mutation
 * (vendor created, vendor revised) emits an append-only audit record.
 * Pure reads never audit.
 *
 * `asTenantScopedVendorStore` projects the store onto W012's
 * `TenantScopedStore<V>` interface so the REUSABLE isolation harness
 * (`runTenantIsolationSuite`) verifies the partitions.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId, VendorId, FleetError } from "@fleetos/contracts";
import type {
  TenantContext,
  TenantScopedStore,
  TenantStoreEntry,
} from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type {
  CreateVendorInput,
  ReviseVendorInput,
  Vendor,
  VendorBuildResult,
} from "./vendor";
import { VENDORS_PIPELINE_CORRELATION_ID, buildVendor, reviseVendor } from "./vendor";
import type { VendorAuditRecord, VendorAuditSink } from "./audit-seam";
import { NOOP_VENDOR_AUDIT_SINK, VENDOR_AUDIT_ACTIONS } from "./audit-seam";
import { ERROR_CODES, frozen, frozenArray, makeDomainError } from "./internal";

// ---------------------------------------------------------------------------
// The store contract
// ---------------------------------------------------------------------------

/** The tagged result of a store write. */
export type VendorStoreWrite =
  | { readonly ok: true; readonly vendor: Vendor }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped vendor store. Every operation takes the acting
 * `TenantContext` as its FIRST parameter and touches only the acting
 * tenant's partition. Revisions are append-only: `reviseVendor`
 * appends revision prior+1 and never rewrites history.
 */
export interface VendorStore {
  /** Create revision 1. Fails with `vendor_already_exists` when present. */
  createVendor(ctx: TenantContext, input: CreateVendorInput): VendorStoreWrite;
  /**
   * Append the next revision of a vendor in the ACTING tenant's
   * partition. A vendor id that exists only in another tenant's
   * partition is indistinguishable from an unknown vendor
   * (`vendor_unknown`) — existence never leaks across tenants.
   */
  reviseVendor(
    ctx: TenantContext,
    vendorId: VendorId,
    input: ReviseVendorInput,
  ): VendorStoreWrite;
  /** The latest revision of a vendor (own partition only). */
  getLatestVendor(ctx: TenantContext, vendorId: VendorId): Vendor | undefined;
  /** A specific revision (own partition only). */
  getVendorRevision(
    ctx: TenantContext,
    vendorId: VendorId,
    revision: number,
  ): Vendor | undefined;
  /** Every vendor (latest revision) in the acting partition, vendorId order. */
  listVendors(ctx: TenantContext): readonly Vendor[];
  /** The full revision history of one vendor (own partition only), revision order. */
  listRevisions(ctx: TenantContext, vendorId: VendorId): readonly Vendor[];
  /** The number of distinct vendors in the acting partition. */
  size(ctx: TenantContext): number;
}

// ---------------------------------------------------------------------------
// The in-memory reference implementation (+ the W012 isolation view)
// ---------------------------------------------------------------------------

/**
 * The in-memory reference store, extended with the raw tenant-scoped KV
 * view over the SAME partitions (for W012's isolation harness).
 */
export interface InMemoryVendorStore extends VendorStore {
  /** Raw tenant-scoped KV view over this store's partitions (W012 harness). */
  readonly tenantScopedView: TenantScopedStore<Vendor>;
}

/**
 * Create the in-memory reference `VendorStore`. Storage is partitioned
 * by tenant id; revisions are append-only per vendor.
 *
 * @returns a frozen InMemoryVendorStore
 */
export function createInMemoryVendorStore(): InMemoryVendorStore {
  /** tenantId -> (vendorId -> revisions, append order). */
  const partitions = new Map<string, Map<string, Vendor[]>>();

  function partitionOf(tenantId: TenantId): Map<string, Vendor[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, Vendor[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function notFound(tenantId: TenantId, vendorId: VendorId): FleetError {
    return makeDomainError(
      ERROR_CODES.vendorDomain,
      "vendor not found in the acting tenant's partition",
      { tenantId, correlationId: VENDORS_PIPELINE_CORRELATION_ID },
      "vendors.vendor.store",
      "vendor_unknown",
    );
  }

  const rich: VendorStore = frozen({
    createVendor(ctx: TenantContext, input: CreateVendorInput): VendorStoreWrite {
      const tenantId = requireTenantContext(ctx);
      const built = buildVendor(tenantId, input);
      if (!built.ok) return built;
      const partition = partitionOf(tenantId);
      if (partition.has(built.vendor.vendorId)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.vendorDomain,
            "vendor already exists in the acting tenant's partition",
            { tenantId, correlationId: input.correlationId },
            "vendors.vendor.store",
            "vendor_already_exists",
          ),
        };
      }
      partition.set(built.vendor.vendorId, [built.vendor]);
      return { ok: true, vendor: built.vendor };
    },

    reviseVendor(
      ctx: TenantContext,
      vendorId: VendorId,
      input: ReviseVendorInput,
    ): VendorStoreWrite {
      const tenantId = requireTenantContext(ctx);
      if (typeof vendorId !== "string" || vendorId.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.vendorDomain,
            "vendor id must be a non-empty string",
            { tenantId, correlationId: input?.correlationId ?? VENDORS_PIPELINE_CORRELATION_ID },
            "vendors.vendor.store",
            "vendor_id_invalid",
          ),
        };
      }
      const partition = partitions.get(tenantId);
      const revisions = partition?.get(vendorId);
      if (revisions === undefined || revisions.length === 0) {
        return { ok: false, error: notFound(tenantId, vendorId) };
      }
      const prior = revisions[revisions.length - 1] as Vendor;
      const built = reviseVendor(prior, input);
      if (!built.ok) return built;
      revisions.push(built.vendor);
      return { ok: true, vendor: built.vendor };
    },

    getLatestVendor(ctx: TenantContext, vendorId: VendorId): Vendor | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(vendorId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },

    getVendorRevision(
      ctx: TenantContext,
      vendorId: VendorId,
      revision: number,
    ): Vendor | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(vendorId);
      if (revisions === undefined) return undefined;
      if (!Number.isInteger(revision) || revision < 1 || revision > revisions.length) return undefined;
      return revisions[revision - 1];
    },

    listVendors(ctx: TenantContext): readonly Vendor[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.values()]
          .filter((revisions) => revisions.length > 0)
          .map((revisions) => revisions[revisions.length - 1] as Vendor)
          .sort((a, b) => (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0)),
      );
    },

    listRevisions(ctx: TenantContext, vendorId: VendorId): readonly Vendor[] {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(vendorId);
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

  // The raw KV view — SAME partitions, no domain validation.
  const tenantScopedView: TenantScopedStore<Vendor> = frozen({
    put(ctx: TenantContext, key: string, value: Vendor): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null || value.vendorId !== key) {
        throw new TypeError(
          "tenantScopedView: value.vendorId must equal the key (raw storage view)",
        );
      }
      partitionOf(tenantId).set(key, [value]);
    },
    get(ctx: TenantContext, key: string): Vendor | undefined {
      return rich.getLatestVendor(ctx, key as VendorId);
    },
    has(ctx: TenantContext, key: string): boolean {
      return rich.getLatestVendor(ctx, key as VendorId) !== undefined;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      return partitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<Vendor>[] {
      return rich
        .listVendors(ctx)
        .map((vendor) => frozen({ key: vendor.vendorId, value: vendor }));
    },
    size(ctx: TenantContext): number {
      return rich.size(ctx);
    },
  });

  return frozen({ ...rich, tenantScopedView });
}

// ---------------------------------------------------------------------------
// The W012 isolation-harness view
// ---------------------------------------------------------------------------

/**
 * Project the in-memory store's `tenantScopedView` for W012's reusable
 * isolation harness (`runTenantIsolationSuite`). The view shares the
 * store's per-tenant partitions, so the harness verifies the REAL
 * partitioning, not a copy.
 *
 * @param store the in-memory vendor store
 * @returns the store's raw tenant-scoped KV view
 */
export function asTenantScopedVendorStore(
  store: InMemoryVendorStore,
): TenantScopedStore<Vendor> {
  return store.tenantScopedView;
}

// ---------------------------------------------------------------------------
// The audited service boundary
// ---------------------------------------------------------------------------

/** Dependencies of the audited vendor service. */
export interface VendorServiceOptions {
  readonly store: VendorStore;
  /** Audit sink (default: no-op). Mutations are consequential — they audit. */
  readonly auditSink?: VendorAuditSink;
}

/**
 * The audited boundary over a `VendorStore`: vendor creation and
 * revision emit append-only audit records to the injected sink
 * (`vendors.vendor.created` / `vendors.vendor.revised`), then return
 * the store's tagged result unchanged.
 */
export interface VendorService {
  createVendor(ctx: TenantContext, input: CreateVendorInput): VendorStoreWrite;
  reviseVendor(
    ctx: TenantContext,
    vendorId: VendorId,
    input: ReviseVendorInput,
  ): VendorStoreWrite;
}

/**
 * Create the audited vendor service. Every successful mutation emits
 * exactly one audit record; failed mutations emit none.
 *
 * @param options the service dependencies
 * @returns a frozen VendorService
 */
export function createVendorService(options: VendorServiceOptions): VendorService {
  if (typeof options?.store !== "object" || options?.store === null) {
    throw new TypeError("createVendorService: store is required");
  }
  const store = options.store;
  const sink: VendorAuditSink = options.auditSink ?? NOOP_VENDOR_AUDIT_SINK;

  return frozen({
    createVendor(ctx: TenantContext, input: CreateVendorInput): VendorStoreWrite {
      const result = store.createVendor(ctx, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: VENDOR_AUDIT_ACTIONS.vendorCreated,
            tenantId: result.vendor.tenantId,
            subject: result.vendor.vendorId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              revision: result.vendor.revision,
              name: result.vendor.name,
              capabilityCount: result.vendor.capabilities.length,
              inventorySignalCount: result.vendor.inventory.length,
              regions: result.vendor.regions,
              contentHash: result.vendor.contentHash,
              modelVersion: result.vendor.modelVersion,
            },
          } satisfies VendorAuditRecord),
        );
      }
      return result;
    },

    reviseVendor(
      ctx: TenantContext,
      vendorId: VendorId,
      input: ReviseVendorInput,
    ): VendorStoreWrite {
      const prior = store.getLatestVendor(ctx, vendorId);
      const result = store.reviseVendor(ctx, vendorId, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: VENDOR_AUDIT_ACTIONS.vendorRevised,
            tenantId: result.vendor.tenantId,
            subject: result.vendor.vendorId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              fromRevision: prior === undefined ? null : prior.revision,
              toRevision: result.vendor.revision,
              name: result.vendor.name,
              contentHash: result.vendor.contentHash,
              priorContentHash: prior === undefined ? null : prior.contentHash,
              capabilityCount: result.vendor.capabilities.length,
              inventorySignalCount: result.vendor.inventory.length,
              regions: result.vendor.regions,
            },
          } satisfies VendorAuditRecord),
        );
      }
      return result;
    },
  });
}

/** Re-export the type for convenience (used by service consumers). */
export type { VendorBuildResult };
