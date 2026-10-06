/**
 * @fleetos/predictive — the audit emission seam (D4; the W011/W021/W022/
 * W031/W032/W040/W041/W050B/W070 pattern).
 *
 * Predictive feed events (extraction runs, extraction refusals,
 * provenance rejections, feature-set cache materializations) emit
 * append-only audit records to an INJECTED audit sink. The audit PACKAGE
 * is lane C's `@fleetos/audit` (W012, accepted); this package's src/
 * discipline permits only `@fleetos/contracts` imports, so this seam is
 * structurally identical to `@fleetos/device-model`'s W011 `AuditSink`,
 * `@fleetos/health`'s W021 seam, `@fleetos/policy`'s W031 seam,
 * `@fleetos/actions`' W041 seam, `@fleetos/recovery`'s W040 seam and the
 * learning lane's W070 seam: `{ tenantId, action, subject, occurredAt,
 * correlationId, causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import (proven
 * by test in this package's test suite — records flow into the
 * hash-chained AuditLog, the chain verifies, per-tenant chains stay
 * separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041/
 * W070 judgment calls ADAPTED to the W153 work order's D4 directive
 * "extraction runs and provenance rejections are handed to the injected
 * sink as append-only records"):
 *   - every attributable EXTRACTION RUN emits
 *     `predictive.device_history.extracted` (the run's status, digest and
 *     window are the evidence a later actor needs to reconstruct WHICH
 *     immutable inputs fed the predictive layer — the W154 engine's trust
 *     anchor begins here);
 *   - an extraction REFUSAL at the tenant/privacy boundary emits
 *     `predictive.device_history.rejected` (the boundary holding is
 *     evidence a reviewer must be able to prove — the same reasoning as
 *     the learning certification-boundary refusal);
 *   - every attributable provenance REJECTION emits
 *     `predictive.provenance.rejected` (a trust-anchor refusal is a
 *     decision a later actor must be able to reconstruct);
 *   - a feature-set cache materialization that CREATES a record emits
 *     `predictive.featureset.materialized`; an idempotent re-append
 *     mutates nothing and audits nothing;
 *   - structurally invalid extraction requests with NO usable tenant
 *     scope never audit through the tenant-scoped seam (mirrors W011);
 *   - successful provenance VERIFICATION is a pure read and never audits.
 * The feature feed itself CANNOT mutate authorization/decision state
 * (ADR-0002 invariant 4/5): these records are evidence, never authority.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the predictive
 * modules. Carries the full traceability set: tenant scope, subject (the
 * entity the record is about — device id or feature-set id — or null
 * when unattributed), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface PredictiveAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "predictive.device_history.extracted"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (status, digest, window, versions). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the predictive reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface PredictiveAuditSink {
  append(record: PredictiveAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makePredictiveAuditRecord(record: PredictiveAuditRecord): PredictiveAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_PREDICTIVE_AUDIT_SINK: PredictiveAuditSink = frozen({
  append: (_record: PredictiveAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryPredictiveAuditSink(): PredictiveAuditSink & {
  readonly records: readonly PredictiveAuditRecord[];
} {
  const records: PredictiveAuditRecord[] = [];
  return frozen({
    append(record: PredictiveAuditRecord): void {
      records.push(record);
    },
    get records(): readonly PredictiveAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the predictive modules (W153
 * D4). See the module docblock for the emission policy.
 */
export const PREDICTIVE_AUDIT_ACTIONS = frozen({
  /** A device-history feature extraction ran (any honest status: ok / insufficient_history / empty_window). */
  featuresExtracted: "predictive.device_history.extracted",
  /** An extraction was refused at the tenant/privacy boundary (the boundary holding — provable). */
  featuresRejected: "predictive.device_history.rejected",
  /** A provenance verification refused a feature set (the trust anchor holding — provable). */
  provenanceRefused: "predictive.provenance.rejected",
  /** A derived feature set was materialized into the tenant's append-only cache (a new record appended). */
  featureSetMaterialized: "predictive.featureset.materialized",
} as const);
