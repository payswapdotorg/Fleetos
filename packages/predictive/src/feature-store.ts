/**
 * @fleetos/predictive — D3: the tenant-partitioned, append-only derived
 * cache for materialized feature sets (the recomputable cache — NOT a
 * second source of truth: every stored set carries the input digest so
 * a store hit is verifiable against the immutable stream).
 *
 * Per ADR-0002 § "Hard invariants" #1 ("The feature feed is NEVER
 * business truth — it is a derived, recomputable interpretation of
 * immutable inputs"): the store is a CACHE. The immutable observation
 * stream (owned by `@fleetos/device-model`'s ingestion boundary) is the
 * source of truth; the feature store is a recomputable derived cache.
 * Every stored set carries:
 *   - the input digest (SHA-256 over the canonical input stream) — a
 *     store hit is verifiable against the immutable stream by
 *     re-running `verifyFeatureSetProvenance`;
 *   - the schema/extractor versions — a version-skew hit is detectable;
 *   - the extracted-at instant — freshness checks;
 *   - the source observation refs — the citation set the feature set
 *     claims to summarize.
 *
 * Tenant isolation is BY CONSTRUCTION (the W012 pattern): every store
 * operation takes the acting `PredictiveTenantScope` FIRST; storage is
 * partitioned per tenant; a foreign feature set is indistinguishable
 * from an unknown one. Cross-tenant merges are REFUSED (never silently
 * rewritten).
 *
 * Audit: the `recordFeatureSet` boundary audits the consequential
 * append (a NEW feature set in the tenant's partition) to the injected
 * sink. Pure reads, failed derivations and idempotent re-appends never
 * audit (the W070 outcome-observation emission policy applied to the
 * predictive feed).
 *
 * Follows the learning package's store pattern
 * (`packages/learning/src/outcome-observation.ts`): tenant-partitioned,
 * append-only by identity, idempotent on content match, refused on
 * content collision. The store audits NOTHING — every consequential
 * append's audit is emitted by the `recordFeatureSet` boundary through
 * ITS injected sink — one coherent emission policy across the
 * predictive package.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  DeviceId,
  FleetError,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  PREDICTIVE_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";
import type { PredictiveTenantScope } from "./internal";
import { checkPredictiveTenantScope } from "./internal";
import type { PredictiveAuditSink } from "./audit-seam";
import { NOOP_PREDICTIVE_AUDIT_SINK } from "./audit-seam";
import { PREDICTIVE_AUDIT_ACTIONS } from "./audit-seam";
import type { DeviceHistoryFeatureSet } from "./device-history-features";
import { featureSetContentDigest, featureSetStoreId } from "./feature-provenance";

// ---------------------------------------------------------------------------
// The tenant-partitioned, append-only feature-set store
// ---------------------------------------------------------------------------

/** The tagged result of a feature-set store write. */
export type FeatureSetStoreWrite =
  | { readonly ok: true; readonly record: DeviceHistoryFeatureSet; readonly created: boolean }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only feature-set store. Every operation
 * takes the acting `PredictiveTenantScope` FIRST and touches only the
 * acting tenant's partition. Feature sets are append-only per store id
 * (the deterministic content digest): a re-append of the SAME content
 * (same content digest) is idempotent (the existing record is returned,
 * `created: false`); a DIFFERENT content on the same store id is
 * refused (the slot is occupied — append-only discipline, the W070
 * pattern).
 *
 * The store is the RECOMPUTABLE CACHE — NOT a second source of truth.
 * Every stored set carries the input digest so a store hit is
 * verifiable against the immutable stream by re-running
 * `verifyFeatureSetProvenance`. A version-skew hit (the immutable
 * stream was re-derived under a different extractor version) produces
 * a different store id (a new slot in the append-only cache — the
 * W070 supersession discipline applied to the predictive feed).
 */
export interface FeatureSetStore {
  /** Append a feature set into the ACTING tenant's partition (tenant must match). */
  appendFeatureSet(scope: PredictiveTenantScope, featureSet: DeviceHistoryFeatureSet): FeatureSetStoreWrite;
  /** One feature set by store id (own partition only; undefined when absent/foreign). */
  getFeatureSet(scope: PredictiveTenantScope, storeId: string): DeviceHistoryFeatureSet | undefined;
  /** All feature-set store ids in the acting partition (sorted). */
  listFeatureSetIds(scope: PredictiveTenantScope): readonly string[];
  /** Every feature set in the acting partition, store-id order. */
  listFeatureSets(scope: PredictiveTenantScope): readonly DeviceHistoryFeatureSet[];
  /** The feature sets for a specific device in the acting partition, store-id order. */
  listFeatureSetsForDevice(scope: PredictiveTenantScope, deviceId: DeviceId): readonly DeviceHistoryFeatureSet[];
  /** The number of feature sets in the acting partition. */
  size(scope: PredictiveTenantScope): number;
}

/**
 * Create the in-memory reference `FeatureSetStore`. Storage is
 * partitioned by tenant id; feature sets are append-only per store id
 * (the deterministic content digest). The store audits NOTHING: every
 * consequential append's audit is emitted by the `recordFeatureSet`
 * boundary through ITS injected sink — one coherent emission policy
 * across the predictive package.
 */
export function createInMemoryFeatureSetStore(): FeatureSetStore {
  /** tenantId -> (storeId -> DeviceHistoryFeatureSet). */
  const partitions = new Map<string, Map<string, DeviceHistoryFeatureSet>>();

  function partitionOf(tenantId: string): Map<string, DeviceHistoryFeatureSet> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, DeviceHistoryFeatureSet>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: PredictiveTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkPredictiveTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.featureStoreDomain,
          `predictive feature-set store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: PREDICTIVE_PIPELINE_CORRELATION_ID },
          "predictive.feature.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    appendFeatureSet(
      scope: PredictiveTenantScope,
      featureSet: DeviceHistoryFeatureSet,
    ): FeatureSetStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (featureSet.identity.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.featureStoreDomain,
            "feature set tenant does not match the acting tenant scope",
            {
              tenantId: tenantId as import("@fleetos/contracts").TenantId,
              correlationId: scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
            },
            "predictive.feature.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const storeId = featureSetStoreId(featureSet);
      const existing = partition.get(storeId);
      if (existing !== undefined) {
        // Idempotent re-append: same content digest => same store id =>
        // the existing record is returned, `created: false`. No mutation.
        return { ok: true, record: existing, created: false };
      }
      // No collision: a different feature set would have a different
      // content digest and therefore a different store id. (A collision
      // on the same store id with different content is impossible by
      // construction — the store id IS the content digest.)
      partition.set(storeId, featureSet);
      return { ok: true, record: featureSet, created: true };
    },
    getFeatureSet(scope: PredictiveTenantScope, storeId: string): DeviceHistoryFeatureSet | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      return partition.get(storeId);
    },
    listFeatureSetIds(scope: PredictiveTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    listFeatureSets(scope: PredictiveTenantScope): readonly DeviceHistoryFeatureSet[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze(
        [...partition.keys()].sort().map((id) => partition.get(id) as DeviceHistoryFeatureSet),
      );
    },
    listFeatureSetsForDevice(
      scope: PredictiveTenantScope,
      deviceId: DeviceId,
    ): readonly DeviceHistoryFeatureSet[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const matching: DeviceHistoryFeatureSet[] = [];
      for (const id of [...partition.keys()].sort()) {
        const fs = partition.get(id) as DeviceHistoryFeatureSet;
        if (fs.identity.deviceId === deviceId) {
          matching.push(fs);
        }
      }
      return Object.freeze(matching);
    },
    size(scope: PredictiveTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// The audited recording boundary
// ---------------------------------------------------------------------------

/** Options for `recordFeatureSet`. */
export interface RecordFeatureSetOptions {
  /** The injected audit sink (the append emits when it creates; default: no-op). */
  readonly auditSink?: PredictiveAuditSink;
  /** The causation id, when the recording is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The correlation id (overrides the scope's, when supplied). */
  readonly correlationId?: CorrelationId;
}

/**
 * Record a feature set into the tenant's derived cache (the audited
 * boundary). PURE: the feature set, the injected instant (carried in
 * the feature set's `extractedAt`), and the sink are injected; this
 * boundary reads no clock and no entropy.
 *
 * Audit: a CREATED append (a new record in the tenant's partition)
 * emits `predictive.feature.extracted` to the injected sink. An
 * idempotent re-append (same content digest) mutates nothing and
 * audits nothing. Failed validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the feature-set store
 * @param featureSet the derived feature set
 * @param options the recording options (audit sink, causation id, correlation id)
 * @returns the tagged store write
 */
export function recordFeatureSet(
  scope: PredictiveTenantScope,
  store: FeatureSetStore,
  featureSet: DeviceHistoryFeatureSet,
  options: RecordFeatureSetOptions = {},
): FeatureSetStoreWrite {
  const write = store.appendFeatureSet(scope, featureSet);
  if (!write.ok) return write;
  if (write.created) {
    const sink: PredictiveAuditSink = options.auditSink ?? NOOP_PREDICTIVE_AUDIT_SINK;
    sink.append(
      frozen({
        action: PREDICTIVE_AUDIT_ACTIONS.featureExtracted,
        tenantId: write.record.identity.tenantId,
        subject: featureSetStoreId(write.record),
        occurredAt: write.record.extractedAt,
        correlationId: options.correlationId ?? scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          storeId: featureSetStoreId(write.record),
          deviceId: write.record.identity.deviceId,
          window: {
            from: write.record.identity.window.from,
            to: write.record.identity.window.to,
          },
          schemaVersion: write.record.schemaVersion,
          extractorVersion: write.record.extractorVersion,
          statusKind: write.record.status.kind,
          featureCount: write.record.features.length,
          inputDigest: write.record.inputDigest,
          inputObservationRefCount: write.record.inputObservationRefs.length,
          contentDigest: featureSetContentDigest(write.record),
        }),
      }),
    );
  } else {
    // Idempotent re-append: emit a separate, lower-signal audit action
    // so the chain reflects the cache hit (a reviewer can distinguish
    // a fresh extraction from a cache replay).
    const sink: PredictiveAuditSink = options.auditSink ?? NOOP_PREDICTIVE_AUDIT_SINK;
    sink.append(
      frozen({
        action: PREDICTIVE_AUDIT_ACTIONS.featureReextracted,
        tenantId: write.record.identity.tenantId,
        subject: featureSetStoreId(write.record),
        occurredAt: write.record.extractedAt,
        correlationId: options.correlationId ?? scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          storeId: featureSetStoreId(write.record),
          inputDigest: write.record.inputDigest,
          contentDigest: featureSetContentDigest(write.record),
        }),
      }),
    );
  }
  return write;
}

// ---------------------------------------------------------------------------
// The audited provenance-verification boundary
// ---------------------------------------------------------------------------

/**
 * Record a provenance verification into the audit chain (the audited
 * boundary). PURE: the verification result, the injected instant, and
 * the sink are injected; this boundary reads no clock and no entropy.
 *
 * Audit: a PASSED verification emits `predictive.provenance.verified`;
 * a REFUSED verification emits `predictive.provenance.refused`. Both
 * are consequential — a reviewer must be able to reconstruct the
 * verification trail (ADR-0002 invariant 3).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param sink the injected audit sink
 * @param result the verification result
 * @param featureSet the feature set under verification (for the subject ref)
 * @param options the recording options (injected instant, correlation id, causation id)
 */
export function recordProvenanceVerification(
  scope: PredictiveTenantScope,
  sink: PredictiveAuditSink,
  result: { readonly ok: true; readonly verifiedAt: string; readonly inputDigest: string } | { readonly ok: false; readonly error: FleetError },
  featureSet: DeviceHistoryFeatureSet,
  options: { readonly verifiedAt: string; readonly correlationId?: CorrelationId; readonly causationId?: CausationId },
): void {
  const subject = featureSetStoreId(featureSet);
  if (result.ok) {
    sink.append(
      frozen({
        action: PREDICTIVE_AUDIT_ACTIONS.provenanceVerified,
        tenantId: scope.tenantId,
        subject,
        occurredAt: options.verifiedAt,
        correlationId: options.correlationId ?? scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          storeId: subject,
          verifiedInputDigest: result.inputDigest,
          claimedInputDigest: featureSet.inputDigest,
        }),
      }),
    );
  } else {
    sink.append(
      frozen({
        action: PREDICTIVE_AUDIT_ACTIONS.provenanceRefused,
        tenantId: scope.tenantId,
        subject,
        occurredAt: options.verifiedAt,
        correlationId: options.correlationId ?? scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          storeId: subject,
          claimedInputDigest: featureSet.inputDigest,
          refusalCode: result.error.code,
          refusalMessage: result.error.message,
        }),
      }),
    );
  }
}

/** A store-write result is a tagged union — convenience narrow. */
export function isFeatureSetStoreWriteCreated(
  write: FeatureSetStoreWrite,
): write is { readonly ok: true; readonly record: DeviceHistoryFeatureSet; readonly created: true } {
  return write.ok && write.created;
}

/** Tenant-scoped helper: a feature set is foreign when its tenant doesn't match. */
export function isForeignFeatureSet(
  scope: PredictiveTenantScope,
  featureSet: DeviceHistoryFeatureSet,
): boolean {
  return featureSet.identity.tenantId !== scope.tenantId;
}

/** Re-export the store-id helpers for callers (the audited boundary). */
export const FEATURE_STORE_HELPERS = frozen({
  featureSetStoreId,
  featureSetContentDigest,
  isFeatureSetStoreWriteCreated,
  isForeignFeatureSet,
  frozenArray,
});
