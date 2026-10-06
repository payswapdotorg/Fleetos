/**
 * @fleetos/world-model — the audit emission seam (D4; the W011/W021/
 * W022/W031/W032/W040/W041/W050B/W070/W153 pattern).
 *
 * World-model consequential mutations (a representation materialized
 * from a feature set + context; a prediction produced; a
 * counterfactual produced; a tenant-scope rejection at the boundary)
 * emit append-only audit records to an INJECTED audit sink. The audit
 * PACKAGE is lane C's `@fleetos/audit` (W012, accepted); this package's
 * src/ discipline permits only `@fleetos/contracts` AND
 * `@fleetos/predictive` imports, so this seam is structurally identical
 * to `@fleetos/predictive`'s `PredictiveAuditSink`, `@fleetos/device-model`'s
 * W011 `AuditSink`, `@fleetos/health`'s W021 seam, `@fleetos/policy`'s
 * W031 seam, `@fleetos/actions`' W041 seam, `@fleetos/recovery`'s W040
 * seam, the arena lane's W050B seam and `@fleetos/learning`'s W070 seam:
 * `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import (proven
 * by test in this package's test suite — records flow into the
 * hash-chained AuditLog, the chain verifies, per-tenant chains stay
 * separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041/
 * W050B/W070/W153 judgment calls): audit records are emitted for
 * CONSEQUENTIAL events only — every world-model state mutation that a
 * later actor must be able to reconstruct from evidence. Pure reads,
 * in-memory derivations and failed validations never audit (the frozen
 * error taxonomy carries its own trace). One consequential boundary IS
 * audited: a tenant-scope refusal at the engine boundary (a cross-tenant
 * represent/predict/compare call attempted — ADR-0002 invariant 7
 * "Tenant isolation applies to training data, inference context,
 * representations, predictions and evaluation cases"; the refusal is
 * evidence a reviewer must be able to prove). Representations and
 * predictions themselves are advisory (ADR-0002 invariant 1: "The
 * predictive representation is never business truth") — they are
 * computed on demand and never persisted by this lane, so the
 * representation/prediction COMPUTATION is not itself audited as a
 * consequential mutation; the tenant-scope REFUSAL is.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the world-model
 * modules. Carries the full traceability set: tenant scope, subject
 * (the entity the record is about — representation id, prediction id,
 * tenant scope — or null when unattributed), action, time,
 * correlation/causation ids, and a JSON-serializable details bag.
 */
export interface WorldModelAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "world-model.tenant.scope.refused"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (representation digest, evidence trail). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the world-model reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface WorldModelAuditSink {
  append(record: WorldModelAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeWorldModelAuditRecord(record: WorldModelAuditRecord): WorldModelAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_WORLD_MODEL_AUDIT_SINK: WorldModelAuditSink = frozen({
  append: (_record: WorldModelAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryWorldModelAuditSink(): WorldModelAuditSink & {
  readonly records: readonly WorldModelAuditRecord[];
} {
  const records: WorldModelAuditRecord[] = [];
  return frozen({
    append(record: WorldModelAuditRecord): void {
      records.push(record);
    },
    get records(): readonly WorldModelAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the world-model modules. The
 * consequential-mutation set from the W154 work order: tenant-scope
 * refusals at the engine boundary (cross-tenant represent/predict/
 * compare calls — the refusal is evidence a reviewer must be able to
 * prove). Representations and predictions are advisory, computed on
 * demand, never persisted — they audit nothing as consequential
 * mutations (the W070 outcome-observation emission policy applied to
 * the world-model feed: pure reads + in-memory derivations never
 * audit; the tenant-scope refusal is the only consequential boundary).
 */
export const WORLD_MODEL_AUDIT_ACTIONS = frozen({
  /** A cross-tenant represent call was refused at the engine boundary. */
  tenantScopeRefusedRepresentation: "world-model.tenant.scope.refused.representation",
  /** A cross-tenant predict call was refused at the engine boundary. */
  tenantScopeRefusedPrediction: "world-model.tenant.scope.refused.prediction",
  /** A cross-tenant predictAfterAction call was refused at the engine boundary. */
  tenantScopeRefusedCounterfactual: "world-model.tenant.scope.refused.counterfactual",
  /** A cross-tenant compare call was refused at the engine boundary. */
  tenantScopeRefusedComparison: "world-model.tenant.scope.refused.comparison",
} as const);
