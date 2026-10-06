/**
 * @fleetos/world-context — the audit emission seam (D4; the W011/W021/
 * W022/W031/W032/W040/W041/W050B/W070/W153/W154 pattern).
 *
 * World-context consequential mutations (a context projected from the
 * workload/procurement surfaces; a prediction converted into an
 * evaluation-case proposal; an outcome bound to a prediction — the loop
 * CLOSES; a tenant-scope rejection at any boundary) emit append-only
 * audit records to an INJECTED audit sink. The audit PACKAGE is lane
 * C's `@fleetos/audit` (W012, accepted); this package's src/ discipline
 * permits only `@fleetos/contracts` imports, so this seam is structurally
 * identical to `@fleetos/world-model`'s `WorldModelAuditSink`,
 * `@fleetos/learning`'s `LearningAuditSink`, `@fleetos/predictive`'s
 * `PredictiveAuditSink`, AND `@fleetos/audit`'s own `AuditSink`:
 * `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import (proven
 * by test in this package's test suite — records flow into the
 * hash-chained AuditLog, the chain verifies, per-tenant chains stay
 * separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041/
 * W050B/W070/W153/W154 judgment calls): audit records are emitted for
 * CONSEQUENTIAL events only — every world-context state mutation that a
 * later actor must be able to reconstruct from evidence. Pure reads,
 * in-memory derivations and failed validations never audit (the frozen
 * error taxonomy carries its own trace). The consequential boundaries
 * audited by this lane:
 *   - a CONTEXT PROJECTED (a workload/project context projection built —
 *     the input to the W154 engine; a later actor must be able to
 *     reconstruct which workload/procurement records fed the prediction);
 *   - a BRIDGE CONVERTED (a prediction converted into an evaluation-case
 *     proposal — the predictive-evaluation loop's intake; a later actor
 *     must be able to trace which prediction became which proposal);
 *   - an OUTCOME BOUND (a prediction bound to an observed outcome — the
 *     loop CLOSES; a later actor must be able to reconstruct which
 *     prediction the bound outcome validates);
 *   - tenant-scope refusals at ANY boundary (cross-tenant
 *     projection/bridge/bind calls — ADR-0002 invariant 7 "Tenant
 *     isolation applies to training data, inference context,
 *     representations, predictions and evaluation cases"; the refusal is
 *     evidence a reviewer must be able to prove).
 * Honest refusals (the bridge REFUSED on a non-ok prediction or a
 * missing-provenance prediction; the outcome binding REFUSED on a
 * horizon mismatch or a missing-provenance prediction) are CONSEQUENTIAL
 * — a reviewer must be able to reconstruct the honest-degradation path,
 * so they emit `bridge.refused` / `outcome_binding.refused`. The
 * tenant-scope refusal emits `tenant.scope.refused.<boundary>`.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the world-context
 * modules. Carries the full traceability set: tenant scope, subject
 * (the entity the record is about — context id, proposal id, prediction
 * id, tenant scope — or null when unattributed), action, time,
 * correlation/causation ids, and a JSON-serializable details bag.
 */
export interface WorldContextAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "world-context.context.projected"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (projection/bridge/bind evidence trail). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the world-context reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface WorldContextAuditSink {
  append(record: WorldContextAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeWorldContextAuditRecord(record: WorldContextAuditRecord): WorldContextAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_WORLD_CONTEXT_AUDIT_SINK: WorldContextAuditSink = frozen({
  append: (_record: WorldContextAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryWorldContextAuditSink(): WorldContextAuditSink & {
  readonly records: readonly WorldContextAuditRecord[];
} {
  const records: WorldContextAuditRecord[] = [];
  return frozen({
    append(record: WorldContextAuditRecord): void {
      records.push(record);
    },
    get records(): readonly WorldContextAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the world-context modules. The
 * consequential-mutation set from the W155 work order: context
 * projections (D1 — the W154 input), bridge conversions + refusals (D2 —
 * the predictive-evaluation loop's intake), outcome bindings + refusals
 * (D3 — the loop CLOSES), and tenant-scope refusals at any boundary
 * (D4 — the audited tenant-isolation boundary).
 */
export const WORLD_CONTEXT_AUDIT_ACTIONS = frozen({
  /** A workload/project context was projected (the W154 input). */
  contextProjected: "world-context.context.projected",
  /** A prediction was converted into an evaluation-case proposal (the loop's intake). */
  bridgeConverted: "world-context.bridge.converted",
  /** A bridge conversion was refused (the honest-degradation evidence — non-ok prediction, missing provenance, cross-tenant). */
  bridgeRefused: "world-context.bridge.refused",
  /** A prediction was bound to an observed outcome (the loop CLOSES). */
  outcomeBound: "world-context.outcome_binding.bound",
  /** An outcome binding was refused (the honest-degradation evidence — horizon mismatch, missing provenance, cross-tenant). */
  outcomeBindingRefused: "world-context.outcome_binding.refused",
  /** A cross-tenant context projection was refused at the boundary. */
  tenantScopeRefusedProjection: "world-context.tenant.scope.refused.projection",
  /** A cross-tenant bridge conversion was refused at the boundary. */
  tenantScopeRefusedBridge: "world-context.tenant.scope.refused.bridge",
  /** A cross-tenant outcome binding was refused at the boundary. */
  tenantScopeRefusedBinding: "world-context.tenant.scope.refused.binding",
} as const);
