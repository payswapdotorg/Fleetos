/**
 * @fleetos/actions — D4: the tenant-scoped PrintStore.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, declared locally
 * because `@fleetos/identity` is worker-c's lane — the ownership gate
 * forbids the import):
 *   - every operation takes the acting `ActionTenantScope` as its FIRST
 *     parameter;
 *   - the runtime guard `checkActionTenantScope` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types
 *     (proven by test with `undefined as never`);
 *   - storage is partitioned per tenant (`Map<tenantId, Map<printerId,
 *     PrintJobRequest[]>>` — the queued jobs are append-only per printer
 *     queue), and NO operation accepts a tenant override — a tenant-A
 *     scope can never read tenant-B jobs because the only tenant it can
 *     name is its own. A job that exists only in another tenant's partition
 *     is INDISTINGUISHABLE from an absent one (no existence side channel).
 *
 * Job revisions are append-only per job id: a new revision (the queue
 * transition ROUTED -> QUEUED -> COMPLETED) appends to the job's revision
 * array (the prior is never rewritten — versioned-interpretation
 * discipline). The per-printer queue state is DERIVED from the queued
 * job revisions (the latest QUEUED revision per job id, in queue order);
 * the store never keeps a separate mutable queue state.
 *
 * Audit: a job enqueue/queue mutation emits `action.print.job.queued`
 * from the routing module (see `print-orchestration.ts`); this store's
 * audit covers the job's persistence step (the append to the
 * tenant-scoped store). Pure reads never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { FleetError, TenantId } from "@fleetos/contracts";
import type { ActionAuditSink } from "./audit-seam";
import { NOOP_ACTION_AUDIT_SINK } from "./audit-seam";
import type { PrintJobRequest, PrinterQueueState } from "./print-orchestration";
import { PRINT_JOB_QUEUED, PRINT_JOB_REFUSED } from "./print-orchestration";
import type { ActionTenantScope } from "./internal";
import {
  ACTIONS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  checkActionTenantScope,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";

/** The tagged result of a store write. */
export type PrintStoreWrite =
  | { readonly ok: true; readonly job: PrintJobRequest }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped PrintStore. Every operation takes the acting
 * `ActionTenantScope` as its FIRST parameter and touches only the
 * acting tenant's partition. Job revisions are append-only per job id;
 * the per-printer queue state is derived.
 */
export interface PrintStore {
  /**
   * Append a job revision into the ACTING tenant's partition. The
   * job's tenant MUST match the acting scope; the job id + version
   * slot is append-only (an existing version slot is never overwritten;
   * idempotent appends of the same content are no-ops; out-of-sequence
   * versions are rejected).
   */
  appendJob(scope: ActionTenantScope, job: PrintJobRequest): PrintStoreWrite;
  /** The LATEST revision of the job (own partition only; undefined when absent). */
  getLatestJob(scope: ActionTenantScope, jobId: string): PrintJobRequest | undefined;
  /** A specific revision of the job (own partition only; undefined when absent). */
  getJobRevision(scope: ActionTenantScope, jobId: string, version: number): PrintJobRequest | undefined;
  /** Every revision of a job, version order (own partition only). */
  listJobRevisions(scope: ActionTenantScope, jobId: string): readonly PrintJobRequest[];
  /** The queue state for a printer (own partition only; derived from the queued jobs). */
  getQueueState(scope: ActionTenantScope, printerId: string): PrinterQueueState | undefined;
  /** All job ids in the acting partition (sorted; never crosses tenants). */
  listJobIds(scope: ActionTenantScope): readonly string[];
  /** The number of jobs in the acting partition (one per distinct job id). */
  size(scope: ActionTenantScope): number;
}

/** Options for the in-memory store. */
export interface InMemoryPrintStoreOptions {
  /** The injected audit sink (default: no-op). The store does not emit on append — the routing module emits. */
  readonly auditSink?: ActionAuditSink;
}

/**
 * Create the in-memory reference `PrintStore`. Storage is partitioned
 * by tenant id; job revisions are append-only per job id (the prior is
 * never rewritten — versioned-interpretation discipline). The per-printer
 * queue state is DERIVED from the latest QUEUED revisions in queue
 * order.
 *
 * @param opts the store options
 * @returns a frozen PrintStore
 */
export function createInMemoryPrintStore(
  opts: InMemoryPrintStoreOptions = {},
): PrintStore {
  /** tenantId -> (jobId -> PrintJobRequest[]). */
  const partitions = new Map<string, Map<string, PrintJobRequest[]>>();
  const sink: ActionAuditSink = opts.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  // Note: the store does not emit on append; the routing module emits the
  // consequential audit records (routed / queued). The sink is plumbed
  // here so future store-level emissions (e.g. a queue reorder) can be
  // added without changing the constructor signature.
  void sink;

  function partitionOf(tenantId: string): Map<string, PrintJobRequest[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, PrintJobRequest[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: ActionTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkActionTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.printStoreDomain,
          `print store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ACTIONS_PIPELINE_CORRELATION_ID },
          "action.print.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(
    tenantId: string,
    correlationId: ActionTenantScope["correlationId"],
  ): { tenantId: TenantId; correlationId: typeof ACTIONS_PIPELINE_CORRELATION_ID } {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? ACTIONS_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendJob(scope: ActionTenantScope, job: PrintJobRequest): PrintStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (job.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.printStoreDomain,
            "job tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "action.print.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(job.jobId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(job.jobId, revisions);
      }
      const existing = revisions.find((r) => r.version === job.version);
      if (existing !== undefined) {
        if (existing.contentDigest === job.contentDigest) {
          return { ok: true, job: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.printStoreDomain,
            "job version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "action.print.store",
            "version_slot_occupied",
          ),
        };
      }
      // Version discipline: when the job has no prior revisions, the
      // caller may append ANY version as the first revision (the chain
      // "starts" at that version — supports the case where the caller
      // transitioned the job before persisting it). When there are
      // prior revisions, the new version MUST be exactly prior + 1
      // (no gaps, no out-of-sequence).
      const expectedVersion = revisions.length === 0 ? job.version : revisions[revisions.length - 1].version + 1;
      if (job.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.printStoreDomain,
            `job revision version out of sequence (expected ${expectedVersion}, got ${job.version})`,
            trace(tenantId, scope.correlationId),
            "action.print.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(job);
      return { ok: true, job };
    },
    getLatestJob(scope: ActionTenantScope, jobId: string): PrintJobRequest | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(jobId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getJobRevision(
      scope: ActionTenantScope,
      jobId: string,
      version: number,
    ): PrintJobRequest | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(jobId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listJobRevisions(scope: ActionTenantScope, jobId: string): readonly PrintJobRequest[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(jobId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    getQueueState(scope: ActionTenantScope, printerId: string): PrinterQueueState | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      // Derive the queue state from the latest QUEUED revisions across
      // all jobs whose latest revision targets this printer and is QUEUED.
      const queuedJobs: PrintJobRequest[] = [];
      let updatedAt = "";
      for (const revisions of partition.values()) {
        if (revisions.length === 0) continue;
        const latest = revisions[revisions.length - 1];
        if (latest.printerId !== printerId) continue;
        if (latest.status !== PRINT_JOB_QUEUED) continue;
        queuedJobs.push(latest);
        if (latest.transitionedAt !== undefined && latest.transitionedAt > updatedAt) {
          updatedAt = latest.transitionedAt;
        }
      }
      if (queuedJobs.length === 0) {
        // No queued jobs at this printer; return an empty state (depth 0).
        return frozen({
          tenantId: scope.tenantId,
          printerId,
          depth: 0,
          queuedJobIds: frozenArray([]),
          evidence: frozenArray([]),
          updatedAt: updatedAt.length === 0 ? "1970-01-01T00:00:00Z" : updatedAt,
        });
      }
      // Sort by queue position (ascending) — the position was assigned
      // at enqueue time; ties broken by jobId ascending for determinism.
      queuedJobs.sort((a, b) => {
        const pa = a.queuePosition ?? 0;
        const pb = b.queuePosition ?? 0;
        if (pa !== pb) return pa - pb;
        return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
      });
      return frozen({
        tenantId: scope.tenantId,
        printerId,
        depth: queuedJobs.length,
        queuedJobIds: frozenArray(queuedJobs.map((j) => j.jobId)),
        evidence: frozenArray(
          queuedJobs.flatMap((j) => j.evidence.map((e) => e)),
        ),
        updatedAt,
      });
    },
    listJobIds(scope: ActionTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: ActionTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

/** A convenience export: PRINT_JOB_REFUSED re-exported for tests. */
export { PRINT_JOB_REFUSED };
// Re-export PRINT_JOB_QUEUED too (callers may need it for type guards).
void PRINT_JOB_QUEUED;
