/**
 * @fleetos/workloads — D1/D4: the tenant-scoped profile store + the
 * audited service boundary.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, `packages/identity`):
 *   - every operation takes the acting `TenantContext` (from the same-lane
 *     `@fleetos/identity`) as its FIRST parameter;
 *   - the runtime guard `requireTenantContext` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types;
 *   - storage is partitioned per tenant (`Map<tenantId, Map<workloadId,
 *     revisions[]>>`), and NO operation accepts a tenant override — a
 *     tenant-A context can never read tenant-B profiles because the only
 *     tenant it can name is its own.
 *
 * The `WorkloadProfileService` wraps a store with an INJECTED audit sink
 * (W012's audit primitives pattern): every consequential mutation
 * (profile created, profile revised) emits an append-only audit record.
 * Pure reads never audit.
 *
 * `asTenantScopedProfileStore` projects the store onto W012's
 * `TenantScopedStore<V>` interface so the REUSABLE isolation harness
 * (`runTenantIsolationSuite`) verifies the partitions — the same-lane
 * consumption W012 documented for this package.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId, WorkloadId } from "@fleetos/contracts";
import type { FleetError } from "@fleetos/contracts";
import type {
  TenantContext,
  TenantScopedStore,
  TenantStoreEntry,
} from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type {
  CreateWorkloadProfileInput,
  ProfileBuildResult,
  ReviseWorkloadProfileInput,
  WorkloadProfile,
} from "./profile";
import { WORKLOADS_PIPELINE_CORRELATION_ID, buildWorkloadProfile, reviseWorkloadProfile } from "./profile";
import type { WorkloadAuditRecord, WorkloadAuditSink } from "./audit-seam";
import { NOOP_WORKLOAD_AUDIT_SINK, WORKLOAD_AUDIT_ACTIONS } from "./audit-seam";
import { ERROR_CODES, frozen, frozenArray, makeDomainError } from "./internal";

// ---------------------------------------------------------------------------
// The store contract
// ---------------------------------------------------------------------------

/** The tagged result of a store write. */
export type ProfileStoreWrite =
  | { readonly ok: true; readonly profile: WorkloadProfile }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped workload-profile store. Every operation takes the
 * acting `TenantContext` as its FIRST parameter and touches only the
 * acting tenant's partition. Revisions are append-only: `reviseProfile`
 * appends revision prior+1 and never rewrites history.
 */
export interface WorkloadProfileStore {
  /** Create revision 1. Fails with `workload_already_exists` when present. */
  createProfile(ctx: TenantContext, input: CreateWorkloadProfileInput): ProfileStoreWrite;
  /**
   * Append the next revision of a profile in the ACTING tenant's
   * partition. A workload id that exists only in another tenant's
   * partition is indistinguishable from an unknown workload
   * (`workload_unknown`) — existence never leaks across tenants.
   */
  reviseProfile(
    ctx: TenantContext,
    workloadId: WorkloadId,
    input: ReviseWorkloadProfileInput,
  ): ProfileStoreWrite;
  /** The latest revision of a profile (own partition only). */
  getLatestProfile(ctx: TenantContext, workloadId: WorkloadId): WorkloadProfile | undefined;
  /** A specific revision (own partition only). */
  getProfileRevision(
    ctx: TenantContext,
    workloadId: WorkloadId,
    revision: number,
  ): WorkloadProfile | undefined;
  /** Every profile (latest revision) in the acting partition, workloadId order. */
  listProfiles(ctx: TenantContext): readonly WorkloadProfile[];
  /** The full revision history of one profile (own partition only), revision order. */
  listRevisions(ctx: TenantContext, workloadId: WorkloadId): readonly WorkloadProfile[];
  /** The number of distinct workloads in the acting partition. */
  size(ctx: TenantContext): number;
}

// ---------------------------------------------------------------------------
// The in-memory reference implementation (+ the W012 isolation view)
// ---------------------------------------------------------------------------

/**
 * The in-memory reference store, extended with the raw tenant-scoped KV
 * view over the SAME partitions (see `asTenantScopedProfileStore` below
 * for the view semantics).
 */
export interface InMemoryWorkloadProfileStore extends WorkloadProfileStore {
  /** Raw tenant-scoped KV view over this store's partitions (W012 harness). */
  readonly tenantScopedView: TenantScopedStore<WorkloadProfile>;
}

/**
 * Create the in-memory reference `WorkloadProfileStore`. Storage is
 * partitioned by tenant id; revisions are append-only per workload. The
 * returned store also exposes `tenantScopedView` — a raw `TenantScopedStore`
 * projection over the SAME per-tenant partitions, built for W012's reusable
 * isolation harness (`runTenantIsolationSuite`).
 *
 * @returns a frozen InMemoryWorkloadProfileStore
 */
export function createInMemoryWorkloadProfileStore(): InMemoryWorkloadProfileStore {
  /** tenantId -> (workloadId -> revisions, append order). */
  const partitions = new Map<string, Map<string, WorkloadProfile[]>>();

  function partitionOf(tenantId: TenantId): Map<string, WorkloadProfile[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, WorkloadProfile[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function notFound(tenantId: TenantId, workloadId: WorkloadId): FleetError {
    return makeDomainError(
      ERROR_CODES.profileDomain,
      "workload profile not found in the acting tenant's partition",
      { tenantId, correlationId: WORKLOADS_PIPELINE_CORRELATION_ID },
      "workloads.profile.store",
      "workload_unknown",
    );
  }

  const rich: WorkloadProfileStore = frozen({
    createProfile(ctx: TenantContext, input: CreateWorkloadProfileInput): ProfileStoreWrite {
      const tenantId = requireTenantContext(ctx);
      const built = buildWorkloadProfile(tenantId, input);
      if (!built.ok) return built;
      const partition = partitionOf(tenantId);
      if (partition.has(built.profile.workloadId)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.profileDomain,
            "workload profile already exists in the acting tenant's partition",
            { tenantId, correlationId: input.correlationId },
            "workloads.profile.store",
            "workload_already_exists",
          ),
        };
      }
      partition.set(built.profile.workloadId, [built.profile]);
      return { ok: true, profile: built.profile };
    },

    reviseProfile(
      ctx: TenantContext,
      workloadId: WorkloadId,
      input: ReviseWorkloadProfileInput,
    ): ProfileStoreWrite {
      const tenantId = requireTenantContext(ctx);
      if (typeof workloadId !== "string" || workloadId.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.profileDomain,
            "workload id must be a non-empty string",
            { tenantId, correlationId: input?.correlationId ?? WORKLOADS_PIPELINE_CORRELATION_ID },
            "workloads.profile.store",
            "workload_id_invalid",
          ),
        };
      }
      const partition = partitions.get(tenantId);
      const revisions = partition?.get(workloadId);
      if (revisions === undefined || revisions.length === 0) {
        return { ok: false, error: notFound(tenantId, workloadId) };
      }
      const prior = revisions[revisions.length - 1] as WorkloadProfile;
      const built = reviseWorkloadProfile(prior, input);
      if (!built.ok) return built;
      revisions.push(built.profile);
      return { ok: true, profile: built.profile };
    },

    getLatestProfile(ctx: TenantContext, workloadId: WorkloadId): WorkloadProfile | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(workloadId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },

    getProfileRevision(
      ctx: TenantContext,
      workloadId: WorkloadId,
      revision: number,
    ): WorkloadProfile | undefined {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(workloadId);
      if (revisions === undefined) return undefined;
      if (!Number.isInteger(revision) || revision < 1 || revision > revisions.length) return undefined;
      return revisions[revision - 1];
    },

    listProfiles(ctx: TenantContext): readonly WorkloadProfile[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.values()]
          .filter((revisions) => revisions.length > 0)
          .map((revisions) => revisions[revisions.length - 1] as WorkloadProfile)
          .sort((a, b) => (a.workloadId < b.workloadId ? -1 : a.workloadId > b.workloadId ? 1 : 0)),
      );
    },

    listRevisions(ctx: TenantContext, workloadId: WorkloadId): readonly WorkloadProfile[] {
      const tenantId = requireTenantContext(ctx);
      const revisions = partitions.get(tenantId)?.get(workloadId);
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

  // The raw KV view — SAME partitions, no domain validation (the harness
  // requires reference-equal read-backs of pre-built profiles).
  const tenantScopedView: TenantScopedStore<WorkloadProfile> = frozen({
    put(ctx: TenantContext, key: string, value: WorkloadProfile): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null || value.workloadId !== key) {
        throw new TypeError(
          "tenantScopedView: value.workloadId must equal the key (raw storage view)",
        );
      }
      partitionOf(tenantId).set(key, [value]);
    },
    get(ctx: TenantContext, key: string): WorkloadProfile | undefined {
      return rich.getLatestProfile(ctx, key as WorkloadId);
    },
    has(ctx: TenantContext, key: string): boolean {
      return rich.getLatestProfile(ctx, key as WorkloadId) !== undefined;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      return partitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<WorkloadProfile>[] {
      return rich
        .listProfiles(ctx)
        .map((profile) => frozen({ key: profile.workloadId, value: profile }));
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
 * View semantics (documented judgment call): `put` stores a pre-built
 * profile under its `workloadId` key WITHOUT the domain validation of
 * `createProfile`/`reviseProfile` — the harness requires
 * reference-equal read-backs, which rebuilding would break. Domain
 * validation is tested separately against the rich operations.
 * `remove` deletes the raw storage entry (a storage-layer concern; the
 * domain API has no removal — revisions are append-only).
 *
 * @param store the in-memory workload profile store
 * @returns the store's raw tenant-scoped KV view
 */
export function asTenantScopedProfileStore(
  store: InMemoryWorkloadProfileStore,
): TenantScopedStore<WorkloadProfile> {
  return store.tenantScopedView;
}

// ---------------------------------------------------------------------------
// The audited service boundary
// ---------------------------------------------------------------------------

/** Dependencies of the audited profile service. */
export interface WorkloadProfileServiceOptions {
  readonly store: WorkloadProfileStore;
  /** Audit sink (default: no-op). Mutations are consequential — they audit. */
  readonly auditSink?: WorkloadAuditSink;
}

/**
 * The audited boundary over a `WorkloadProfileStore`: profile creation
 * and revision emit append-only audit records to the injected sink
 * (`workloads.profile.created` / `workloads.profile.revised`) with the
 * full traceability set, then return the store's tagged result unchanged.
 */
export interface WorkloadProfileService {
  createProfile(ctx: TenantContext, input: CreateWorkloadProfileInput): ProfileStoreWrite;
  reviseProfile(
    ctx: TenantContext,
    workloadId: WorkloadId,
    input: ReviseWorkloadProfileInput,
  ): ProfileStoreWrite;
}

/**
 * Create the audited workload-profile service. Every successful mutation
 * emits exactly one audit record; failed mutations emit none (the error
 * is the caller's to handle — the frozen error taxonomy already carries
 * tenant + correlation).
 *
 * @param options the service dependencies
 * @returns a frozen WorkloadProfileService
 */
export function createWorkloadProfileService(
  options: WorkloadProfileServiceOptions,
): WorkloadProfileService {
  if (typeof options?.store !== "object" || options?.store === null) {
    throw new TypeError("createWorkloadProfileService: store is required");
  }
  const store = options.store;
  const sink: WorkloadAuditSink = options.auditSink ?? NOOP_WORKLOAD_AUDIT_SINK;

  return frozen({
    createProfile(ctx: TenantContext, input: CreateWorkloadProfileInput): ProfileStoreWrite {
      const result = store.createProfile(ctx, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: WORKLOAD_AUDIT_ACTIONS.profileCreated,
            tenantId: result.profile.tenantId,
            subject: result.profile.workloadId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              revision: result.profile.revision,
              name: result.profile.name,
              subjectKind: result.profile.subjectKind,
              contentHash: result.profile.contentHash,
              requirementsConfidence: result.profile.requirements.confidence,
              evidenceCount: result.profile.evidence.length,
            },
          } satisfies WorkloadAuditRecord),
        );
      }
      return result;
    },

    reviseProfile(
      ctx: TenantContext,
      workloadId: WorkloadId,
      input: ReviseWorkloadProfileInput,
    ): ProfileStoreWrite {
      const prior = store.getLatestProfile(ctx, workloadId);
      const result = store.reviseProfile(ctx, workloadId, input);
      if (result.ok) {
        sink.append(
          frozen({
            action: WORKLOAD_AUDIT_ACTIONS.profileRevised,
            tenantId: result.profile.tenantId,
            subject: result.profile.workloadId,
            occurredAt: input.at,
            correlationId: input.correlationId,
            details: {
              fromRevision: prior === undefined ? null : prior.revision,
              toRevision: result.profile.revision,
              name: result.profile.name,
              contentHash: result.profile.contentHash,
              priorContentHash: prior === undefined ? null : prior.contentHash,
              requirementsConfidence: result.profile.requirements.confidence,
              evidenceCount: result.profile.evidence.length,
            },
          } satisfies WorkloadAuditRecord),
        );
      }
      return result;
    },
  });
}
