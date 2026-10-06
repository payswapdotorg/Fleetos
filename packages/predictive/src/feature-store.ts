/**
 * @fleetos/predictive — D3: the tenant-partitioned, append-only derived
 * feature-set cache (W153 lane A).
 *
 * The store materializes feature sets as a RECOMPUTABLE cache — never a
 * second source of truth (ADR-0002 invariant 1; `spec/ARCHITECTURE-LOCK.md`
 * item 18: caches cannot become business truth). Every stored set carries
 * its input digest, so a store hit is verifiable against the immutable
 * observation stream through `verifyFeatureSetProvenance` (proven by
 * test: a store round-trip re-verifies).
 *
 * Follows the learning lane's store pattern (outcome-observation.ts):
 *   - every operation takes the acting `PredictiveTenantScope` FIRST and
 *     touches only the acting tenant's partition (tenant isolation at the
 *     persistence boundary — ARCHITECTURE-LOCK item 17);
 *   - append-only by identity: a set's identity tuple (tenant, device,
 *     versions, resolved window, input digest, extraction instant)
 *     derives its deterministic `featureSetId`; re-appending the SAME
 *     content is idempotent
 *     (`created: false`); appending DIFFERENT content under the same
 *     identity is refused (the slot is occupied — the append-only
 *     discipline holding: the same immutable inputs + the same versions
 *     must always yield the same set);
 *   - `rejected` sets are refused at the door (nothing was derived —
 *     there is nothing to cache);
 *   - the store audits NOTHING: a CREATED materialization's audit is
 *     emitted by the `materializeFeatureSet` boundary through ITS
 *     injected sink (one coherent emission policy across the package).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  DeviceId,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import {
  ERROR_CODES,
  PREDICTIVE_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  checkPredictiveTenantScope,
  epochMs,
  frozen,
  looksLikeIso,
  sha256Hex,
} from "./internal";
import type { PredictiveAuditRecord, PredictiveAuditSink } from "./audit-seam";
import { PREDICTIVE_AUDIT_ACTIONS } from "./audit-seam";
import type { DeviceHistoryFeatureSet } from "./device-history-features";
import { featureSetIdentityCanonical } from "./device-history-features";
import type { PredictiveTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The deterministic set id
// ---------------------------------------------------------------------------

/**
 * The deterministic feature-set id: "fsset_" + the first 24 hex chars of
 * the SHA-256 over the set's canonical identity tuple (tenant, device,
 * versions, resolved window, input digest, extraction instant). The
 * same identity inputs always derive the same id; divergent content
 * under the same identity is REFUSED by the store (append-only
 * discipline — a re-materialization at a later injected instant is a
 * NEW cache record).
 */
export function featureSetId(set: DeviceHistoryFeatureSet): string {
  return `fsset_${sha256Hex(featureSetIdentityCanonical(set)).slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The tagged result of a feature-set store write. */
export type FeatureSetStoreWrite =
  | { readonly ok: true; readonly record: DeviceHistoryFeatureSet; readonly created: boolean }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only feature-set store. Every operation
 * takes the acting `PredictiveTenantScope` FIRST and touches only the
 * acting tenant's partition.
 */
export interface FeatureSetStore {
  /** Append a feature set into the ACTING tenant's partition (tenant must match). */
  appendFeatureSet(scope: PredictiveTenantScope, set: DeviceHistoryFeatureSet): FeatureSetStoreWrite;
  /** One feature set by id (own partition only; undefined when absent/foreign). */
  getFeatureSet(scope: PredictiveTenantScope, featureSetId: string): DeviceHistoryFeatureSet | undefined;
  /** Every feature-set id in the acting partition (sorted). */
  listFeatureSetIds(scope: PredictiveTenantScope): readonly string[];
  /** Every feature set in the acting partition, featureSetId order. */
  listFeatureSets(scope: PredictiveTenantScope): readonly DeviceHistoryFeatureSet[];
  /**
   * The latest set for one device (max extractedAt epoch, then id —
   * deterministic) or undefined.
   */
  latestFeatureSet(scope: PredictiveTenantScope, deviceId: DeviceId): DeviceHistoryFeatureSet | undefined;
  /** The number of feature sets in the acting partition. */
  size(scope: PredictiveTenantScope): number;
}

/**
 * Create the in-memory reference `FeatureSetStore`. Storage is
 * partitioned by tenant id; sets are append-only by featureSetId. The
 * store audits NOTHING (the `materializeFeatureSet` boundary owns the
 * emission policy).
 */
export function createInMemoryFeatureSetStore(): FeatureSetStore {
  /** tenantId -> (featureSetId -> DeviceHistoryFeatureSet). */
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
        error: frozen<FleetError>({
          kind: "DomainError",
          code: ERROR_CODES.storeDomain,
          message: `predictive feature-set store refused access (${check.reason}: ${check.detail})`,
          tenantId: SYNTHETIC_SYSTEM_TENANT,
          correlationId: scope?.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
          domain: "predictive.store",
          invariant: check.reason,
        }),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    appendFeatureSet(
      scope: PredictiveTenantScope,
      set: DeviceHistoryFeatureSet,
    ): FeatureSetStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;

      // The set must belong to the acting tenant's partition.
      if (set?.tenantId !== (tenantId as TenantId)) {
        return {
          ok: false,
          error: frozen<FleetError>({
            kind: "DomainError",
            code: ERROR_CODES.storeDomain,
            message: "feature set tenant does not match the acting tenant scope",
            tenantId: tenantId as TenantId,
            correlationId: scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
            domain: "predictive.store",
            invariant: "tenant_mismatch",
          }),
        };
      }
      // Structural sanity (defense in depth; the cache never holds garbage).
      const structure = checkStoreableSet(set);
      if (!structure.ok) return { ok: false, error: structure.error };

      const id = featureSetId(set);
      const partition = partitionOf(tenantId);
      const existing = partition.get(id);
      if (existing !== undefined) {
        if (canonicalJson(existing) === canonicalJson(set)) {
          return { ok: true, record: existing, created: false };
        }
        return {
          ok: false,
          error: frozen<FleetError>({
            kind: "DomainError",
            code: ERROR_CODES.storeDomain,
            message:
              "feature set identity already holds different content (append-only: the same inputs + versions must always yield the same set)",
            tenantId: tenantId as TenantId,
            correlationId: scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
            domain: "predictive.store",
            invariant: "slot_occupied",
          }),
        };
      }
      partition.set(id, set);
      return { ok: true, record: set, created: true };
    },

    getFeatureSet(scope: PredictiveTenantScope, id: string): DeviceHistoryFeatureSet | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      return partition.get(id);
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

    latestFeatureSet(scope: PredictiveTenantScope, deviceId: DeviceId): DeviceHistoryFeatureSet | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      let latest: DeviceHistoryFeatureSet | undefined = undefined;
      let latestKey = "";
      for (const set of partition.values()) {
        if (set.deviceId !== deviceId) continue;
        const key = `${String(epochMs(set.extractedAt) ?? -1).padStart(16, "0")}|${featureSetId(set)}`;
        if (latest === undefined || key > latestKey) {
          latest = set;
          latestKey = key;
        }
      }
      return latest;
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
// The audited materialization boundary
// ---------------------------------------------------------------------------

/** Options for `materializeFeatureSet`. */
export interface MaterializeFeatureSetOptions {
  /** The injected audit sink (a CREATED append emits; default: no-op). */
  readonly auditSink?: PredictiveAuditSink;
  /** The causation id, when the materialization is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

/**
 * Materialize a feature set into the tenant's append-only derived cache
 * (the audited boundary). PURE: the set, the store and the sink are
 * injected; this boundary reads no clock and no entropy. The cache is
 * RECOMPUTABLE: every stored set carries the input digest, so a store
 * hit re-verifies against the immutable observation stream.
 *
 * Audit: a CREATED append emits `predictive.featureset.materialized` to
 * the injected sink. An idempotent re-append (same content) mutates
 * nothing and audits nothing. Failed validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the feature-set store
 * @param set the derived feature set to cache
 * @param options the recording options (audit sink, causation id)
 * @returns the tagged store write
 */
export function materializeFeatureSet(
  scope: PredictiveTenantScope,
  store: FeatureSetStore,
  set: DeviceHistoryFeatureSet,
  options: MaterializeFeatureSetOptions = {},
): FeatureSetStoreWrite {
  const write = store.appendFeatureSet(scope, set);
  if (!write.ok) return write;
  if (write.created) {
    const sink: PredictiveAuditSink = options.auditSink ?? NOOP_SINK;
    sink.append(
      frozen({
        tenantId: write.record.tenantId,
        action: PREDICTIVE_AUDIT_ACTIONS.featureSetMaterialized,
        subject: featureSetId(write.record),
        occurredAt: write.record.extractedAt,
        correlationId: scope.correlationId ?? PREDICTIVE_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          featureSetId: featureSetId(write.record),
          deviceId: write.record.deviceId,
          statusKind: write.record.status.kind,
          featureCount: write.record.features.length,
          inputDigestAlgorithm: write.record.inputDigest?.algorithm ?? null,
          inputDigestValue: write.record.inputDigest?.value ?? null,
          windowFrom: write.record.window.from,
          windowTo: write.record.window.to,
          featureSetSchemaVersion: write.record.featureSetSchemaVersion,
          extractorVersion: write.record.extractorVersion,
        }),
      }),
    );
  }
  return write;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const NOOP_SINK: PredictiveAuditSink = frozen({
  append: (_record: PredictiveAuditRecord): void => undefined,
});

/** A set is storeable only when it carries a derivation (never a rejected set). */
function checkStoreableSet(
  set: DeviceHistoryFeatureSet,
): { ok: true } | { ok: false; error: FleetError } {
  if (set === null || typeof set !== "object") {
    return storeError("malformed_set", "the feature set is absent");
  }
  if (typeof set.deviceId !== "string" || set.deviceId.length === 0) {
    return storeError("malformed_set", "the feature set carries no deviceId");
  }
  if (typeof set.extractedAt !== "string" || !looksLikeIso(set.extractedAt)) {
    return storeError("malformed_set", "the feature set's extractedAt is not ISO 8601");
  }
  if (set.status?.kind === "rejected") {
    return storeError(
      "rejected_not_cacheable",
      "a rejected feature set carries no derivation (nothing to cache — honesty discipline)",
    );
  }
  if (set.inputDigest === null || set.inputDigest.algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(set.inputDigest.value)) {
    return storeError("malformed_set", "the feature set's input digest is malformed");
  }
  return { ok: true };
}

function storeError(invariant: string, message: string): { ok: false; error: FleetError } {
  return {
    ok: false,
    error: frozen<FleetError>({
      kind: "DomainError",
      code: ERROR_CODES.storeDomain,
      message,
      tenantId: SYNTHETIC_SYSTEM_TENANT,
      correlationId: PREDICTIVE_PIPELINE_CORRELATION_ID,
      domain: "predictive.store",
      invariant,
    }),
  };
}
