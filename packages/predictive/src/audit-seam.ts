/**
 * @fleetos/predictive — the audit emission seam (D4; the W011/W021/
 * W022/W031/W032/W040/W041/W050B/W070 pattern).
 *
 * Predictive device-history feature extraction consequential mutations
 * (a feature set materialized into the tenant's derived cache; a
 * provenance re-verification refusal at the trust anchor) emit
 * append-only audit records to an INJECTED audit sink. The audit PACKAGE
 * is lane C's `@fleetos/audit` (W012, accepted); this package's src/
 * discipline permits only `@fleetos/contracts` imports, so this seam is
 * structurally identical to `@fleetos/device-model`'s W011 `AuditSink`,
 * `@fleetos/health`'s W021 seam, `@fleetos/policy`'s W031 seam,
 * `@fleetos/actions`' W041 seam, `@fleetos/recovery`'s W040 seam, the
 * arena lane's W050B seam and `@fleetos/learning`'s W070 seam:
 * `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import (proven
 * by test in this package's test suite — records flow into the
 * hash-chained AuditLog, the chain verifies, per-tenant chains stay
 * separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041/
 * W050B/W070 judgment calls): audit records are emitted for
 * CONSEQUENTIAL events only — every predictive state mutation that a
 * later actor must be able to reconstruct from evidence. Pure reads,
 * in-memory derivations and failed validations never audit (the frozen
 * error taxonomy carries its own trace). One refusal IS consequential
 * (and therefore audited):
 *   - a `verifyFeatureSetProvenance` mismatch at the trust anchor (the
 *     refusal is evidence a reviewer must be able to prove — ADR-0002
 *     invariant 3 "every prediction carries model/capability version,
 *     horizon, evidence references and uncertainty metadata"; the
 *     feature feed is the evidence-reference layer W154's engine
 *     consumes, so a provenance refusal is a provenance-break the
 *     reviewer must be able to reconstruct).
 * Idempotent re-appends (same content, same slot) mutate nothing and
 * therefore audit nothing.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the predictive
 * modules. Carries the full traceability set: tenant scope, subject (the
 * entity the record is about — feature set id, observation ref, tenant
 * scope — or null when unattributed), action, time, correlation/causation
 * ids, and a JSON-serializable details bag.
 */
export interface PredictiveAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "predictive.feature.extracted"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (feature set digest, evidence trail). */
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
 * Stable machine action names emitted by the predictive modules. The
 * consequential-mutation set from the W153 work order: feature sets
 * materialized into the derived cache; provenance re-verification
 * refusals at the trust anchor (the W154 engine's trust anchor —
 * a provenance break is evidence a reviewer must be able to prove).
 */
export const PREDICTIVE_AUDIT_ACTIONS = frozen({
  /** A feature set was extracted and materialized into the tenant's derived cache (a new record appended). */
  featureExtracted: "predictive.feature.extracted",
  /** A feature set was re-extracted idempotently (same input digest; the existing record was returned). */
  featureReextracted: "predictive.feature.reextracted",
  /** A feature set's provenance was re-verified at the trust anchor and the verification PASSED. */
  provenanceVerified: "predictive.provenance.verified",
  /** A feature set's provenance was re-verified at the trust anchor and the verification REFUSED (mismatch/gap/cross-tenant/digest-mismatch). */
  provenanceRefused: "predictive.provenance.refused",
} as const);
