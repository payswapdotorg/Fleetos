/**
 * @fleetos/actions — D4: the tenant-scoped ActionStore.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, declared locally
 * because `@fleetos/identity` is worker-c's lane — the ownership gate
 * forbids the import):
 *   - every operation takes the acting `ActionTenantScope` as its FIRST
 *     parameter;
 *   - the runtime guard `checkActionTenantScope` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types
 *     (proven by test with `undefined as never`);
 *   - storage is partitioned per tenant (`Map<tenantId, Map<planId,
 *     ActionPlanTemplate[]>>` — the version revisions are append-only
 *     per plan id), and NO operation accepts a tenant override — a
 *     tenant-A scope can never read tenant-B plans because the only
 *     tenant it can name is its own. A plan that exists only in another
 *     tenant's partition is INDISTINGUISHABLE from an absent one (no
 *     existence side channel).
 *
 * Plan revisions are append-only per plan id: a new revision appends to
 * the plan's revision array (the prior is never rewritten — versioned-
 * interpretation discipline). The LATEST revision is the active view;
 * the prior revisions are kept in history for audit.
 *
 * Audit: a plan creation appends `action.plan.created` to the injected
 * sink — the plan is a consequential proposal (it advances through the
 * policy gate). Pure reads never audit. Submissions emit their own
 * `action.plan.submitted` from the policy gate (see `policy-gate.ts`);
 * this store's audit covers the creation step only.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { FleetError, TenantId } from "@fleetos/contracts";
import type { ActionAuditSink } from "./audit-seam";
import { ACTION_AUDIT_ACTIONS, NOOP_ACTION_AUDIT_SINK } from "./audit-seam";
import type { ActionPlanTemplate } from "./fleet-action";
import type { ActionTenantScope } from "./internal";
import {
  ACTIONS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  checkActionTenantScope,
  frozen,
  makeDomainError,
} from "./internal";

/** The tagged result of a store write. */
export type ActionStoreWrite =
  | { readonly ok: true; readonly plan: ActionPlanTemplate }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped ActionStore. Every operation takes the acting
 * `ActionTenantScope` as its FIRST parameter and touches only the
 * acting tenant's partition. Plan revisions are append-only per plan id.
 */
export interface ActionStore {
  /**
   * Append a plan revision into the ACTING tenant's partition. The
   * plan's tenant MUST match the acting scope; the plan id + version
   * slot is append-only (an existing version slot is never overwritten;
   * idempotent appends of the same content are no-ops; out-of-sequence
   * versions are rejected).
   */
  appendPlan(scope: ActionTenantScope, plan: ActionPlanTemplate): ActionStoreWrite;
  /** The LATEST revision of the plan (own partition only; undefined when absent). */
  getLatestPlan(scope: ActionTenantScope, planId: string): ActionPlanTemplate | undefined;
  /** A specific revision of the plan (own partition only; undefined when absent). */
  getPlanRevision(scope: ActionTenantScope, planId: string, version: number): ActionPlanTemplate | undefined;
  /** Every revision of a plan, version order (own partition only). */
  listPlanRevisions(scope: ActionTenantScope, planId: string): readonly ActionPlanTemplate[];
  /** All plan ids in the acting partition (sorted; never crosses tenants). */
  listPlanIds(scope: ActionTenantScope): readonly string[];
  /** The number of plans in the acting partition (one per distinct plan id). */
  size(scope: ActionTenantScope): number;
}

/** Options for the in-memory store. */
export interface InMemoryActionStoreOptions {
  /** The injected audit sink (default: no-op). */
  readonly auditSink?: ActionAuditSink;
}

/**
 * Create the in-memory reference `ActionStore`. Storage is partitioned
 * by tenant id; plan revisions are append-only per plan id (the prior
 * is never rewritten — versioned-interpretation discipline).
 *
 * @param opts the store options
 * @returns a frozen ActionStore
 */
export function createInMemoryActionStore(
  opts: InMemoryActionStoreOptions = {},
): ActionStore {
  /** tenantId -> (planId -> ActionPlanTemplate[]). */
  const partitions = new Map<string, Map<string, ActionPlanTemplate[]>>();
  const sink: ActionAuditSink = opts.auditSink ?? NOOP_ACTION_AUDIT_SINK;

  function partitionOf(tenantId: string): Map<string, ActionPlanTemplate[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, ActionPlanTemplate[]>();
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
          ERROR_CODES.planStoreDomain,
          `action store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ACTIONS_PIPELINE_CORRELATION_ID },
          "action.plan.store",
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
    appendPlan(scope: ActionTenantScope, plan: ActionPlanTemplate): ActionStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (plan.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.planStoreDomain,
            "plan tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "action.plan.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(plan.planId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(plan.planId, revisions);
      }
      const existing = revisions.find((r) => r.version === plan.version);
      if (existing !== undefined) {
        if (existing.contentDigest === plan.contentDigest) {
          // Idempotent append of identical content: a no-op.
          return { ok: true, plan: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.planStoreDomain,
            "plan version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "action.plan.store",
            "version_slot_occupied",
          ),
        };
      }
      // Version discipline: when the plan has no prior revisions, the
      // caller may append ANY version as the first revision (the chain
      // "starts" at that version — supports the case where the caller
      // transitioned the plan before persisting it). When there are
      // prior revisions, the new version MUST be exactly prior + 1
      // (no gaps, no out-of-sequence).
      const expectedVersion = revisions.length === 0 ? plan.version : revisions[revisions.length - 1].version + 1;
      if (plan.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.planStoreDomain,
            `plan revision version out of sequence (expected ${expectedVersion}, got ${plan.version})`,
            trace(tenantId, scope.correlationId),
            "action.plan.store",
            "version_out_of_sequence",
          ),
        };
      }
      const isFirstRevision = revisions.length === 0;
      revisions.push(plan);
      // Audit only the FIRST revision appended (the plan's initial
      // persistence into the store) — subsequent revisions (the
      // policy-gate transitions) emit their own audit from the policy
      // gate. Pure reads never audit. The first revision's version may
      // be > 1 if the caller transitioned the plan before persisting
      // (the persistence boundary is the audit trigger, not the version
      // number).
      if (isFirstRevision) {
        sink.append(
          frozen({
            action: ACTION_AUDIT_ACTIONS.planCreated,
            tenantId: plan.tenantId,
            subject: plan.planId,
            occurredAt: plan.createdAt,
            correlationId: scope.correlationId ?? ACTIONS_PIPELINE_CORRELATION_ID,
            details: frozen({
              planId: plan.planId,
              name: plan.name,
              capability: plan.capability,
              targetCount: plan.targetCount,
              status: plan.status,
              contentDigest: plan.contentDigest,
            }),
          }),
        );
      }
      return { ok: true, plan };
    },
    getLatestPlan(scope: ActionTenantScope, planId: string): ActionPlanTemplate | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(planId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getPlanRevision(
      scope: ActionTenantScope,
      planId: string,
      version: number,
    ): ActionPlanTemplate | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(planId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listPlanRevisions(scope: ActionTenantScope, planId: string): readonly ActionPlanTemplate[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(planId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listPlanIds(scope: ActionTenantScope): readonly string[] {
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
