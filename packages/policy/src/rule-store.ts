/**
 * @fleetos/policy — D4: the tenant-scoped rule-set store.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, declared locally
 * because `@fleetos/identity` is worker-c's lane — the ownership gate
 * forbids the import):
 *   - every operation takes the acting `PolicyTenantScope` as its FIRST
 *     parameter;
 *   - the runtime guard `checkPolicyTenantScope` rejects context-free and
 *     invalid-tenant access even when a caller bypasses the types
 *     (proven by test with `undefined as never`);
 *   - storage is partitioned per tenant (`Map<tenantId, Map<version,
 *     ruleSet>>`), and NO operation accepts a tenant override — a
 *     tenant-A scope can never read tenant-B rule sets because the only
 *     tenant it can name is its own. A rule-set version that exists only
 *     in another tenant's partition is indistinguishable from an absent
 *     one.
 *
 * Publications are append-only per version: a version slot is written
 * once and never overwritten (same version + different content is
 * rejected; same version + identical content is an idempotent no-op).
 *
 * Audit: publishing a rule-set version emits
 * `policy.ruleset.published` to the injected sink — a rule-set
 * publication changes the tenant's authorization posture, so it is a
 * consequential mutation. Pure reads never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { asTenantId } from "@fleetos/contracts";
import type { CorrelationId, FleetError, TenantId } from "@fleetos/contracts";
import type { PolicyAuditSink } from "./audit-seam";
import { NOOP_POLICY_AUDIT_SINK, POLICY_AUDIT_ACTIONS } from "./audit-seam";
import type { GuardianRuleSet, PolicyTenantScope } from "./rule-model";
import {
  ERROR_CODES,
  POLICY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  checkPolicyTenantScope,
  frozen,
  makeDomainError,
} from "./internal";

/** The tagged result of a store write. */
export type RuleSetStoreWrite =
  | { readonly ok: true; readonly ruleSet: GuardianRuleSet }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped Guardian rule-set store. Every operation takes the
 * acting `PolicyTenantScope` as its FIRST parameter and touches only the
 * acting tenant's partition.
 */
export interface GuardianRuleSetStore {
  /**
   * Publish a rule-set version into the ACTING tenant's partition.
   * Append-only per version: an existing version slot is never
   * overwritten. The rule set's tenant must match the acting scope.
   */
  putRuleSet(scope: PolicyTenantScope, ruleSet: GuardianRuleSet): RuleSetStoreWrite;
  /** The highest-version rule set in the acting partition (undefined when empty). */
  getLatestRuleSet(scope: PolicyTenantScope): GuardianRuleSet | undefined;
  /** A specific rule-set version (own partition only; undefined when absent). */
  getRuleSetVersion(scope: PolicyTenantScope, version: number): GuardianRuleSet | undefined;
  /** Every published rule set in the acting partition, version order. */
  listRuleSets(scope: PolicyTenantScope): readonly GuardianRuleSet[];
  /** The number of published versions in the acting partition. */
  size(scope: PolicyTenantScope): number;
}

/** Options for the in-memory store. */
export interface InMemoryGuardianRuleSetStoreOptions {
  /** The injected audit sink (default: no-op). */
  readonly auditSink?: PolicyAuditSink;
}

/**
 * Create the in-memory reference `GuardianRuleSetStore`. Storage is
 * partitioned by tenant id; version slots are append-only.
 *
 * @param opts the store options
 * @returns a frozen GuardianRuleSetStore
 */
export function createInMemoryGuardianRuleSetStore(
  opts: InMemoryGuardianRuleSetStoreOptions = {},
): GuardianRuleSetStore {
  /** tenantId -> (version -> ruleSet). */
  const partitions = new Map<string, Map<number, GuardianRuleSet>>();
  const sink: PolicyAuditSink = opts.auditSink ?? NOOP_POLICY_AUDIT_SINK;

  function partitionOf(tenantId: string): Map<number, GuardianRuleSet> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<number, GuardianRuleSet>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function trace(
    tenantId: string,
    correlationId: PolicyTenantScope["correlationId"],
  ): { tenantId: TenantId; correlationId: CorrelationId } {
    return {
      tenantId: asTenantId(tenantId),
      correlationId: correlationId ?? POLICY_PIPELINE_CORRELATION_ID,
    };
  }

  function guarded(
    scope: PolicyTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkPolicyTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.ruleStoreDomain,
          `guardian rule set store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: POLICY_PIPELINE_CORRELATION_ID },
          "policy.ruleset.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    putRuleSet(scope: PolicyTenantScope, ruleSet: GuardianRuleSet): RuleSetStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (ruleSet.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ruleStoreDomain,
            "rule set tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "policy.ruleset.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const existing = partition.get(ruleSet.version);
      if (existing !== undefined) {
        if (existing.ruleSetId === ruleSet.ruleSetId) {
          // Idempotent republication of identical content: a no-op.
          return { ok: true, ruleSet: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ruleStoreDomain,
            "rule set version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "policy.ruleset.store",
            "version_slot_occupied",
          ),
        };
      }
      partition.set(ruleSet.version, ruleSet);
      sink.append(
        frozen({
          action: POLICY_AUDIT_ACTIONS.ruleSetPublished,
          tenantId: ruleSet.tenantId,
          subject: ruleSet.ruleSetId,
          occurredAt: ruleSet.compiledAt,
          correlationId: scope.correlationId ?? POLICY_PIPELINE_CORRELATION_ID,
          details: frozen({
            ruleSetId: ruleSet.ruleSetId,
            version: ruleSet.version,
            contentDigest: ruleSet.contentDigest,
            ruleCount: ruleSet.rules.length,
          }),
        }),
      );
      return { ok: true, ruleSet };
    },
    getLatestRuleSet(scope: PolicyTenantScope): GuardianRuleSet | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined || partition.size === 0) return undefined;
      let latest: GuardianRuleSet | undefined;
      for (const ruleSet of partition.values()) {
        if (latest === undefined || ruleSet.version > latest.version) {
          latest = ruleSet;
        }
      }
      return latest;
    },
    getRuleSetVersion(scope: PolicyTenantScope, version: number): GuardianRuleSet | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      return partitions.get(guard.tenantId)?.get(version);
    },
    listRuleSets(scope: PolicyTenantScope): readonly GuardianRuleSet[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return [...partition.values()].sort((a, b) => a.version - b.version);
    },
    size(scope: PolicyTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      return partitions.get(guard.tenantId)?.size ?? 0;
    },
  });
}
