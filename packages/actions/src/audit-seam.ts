/**
 * @fleetos/actions — the audit emission seam (W011/W021/W022/W031's pattern).
 *
 * Fleet Action consequential mutations (plan created / submitted /
 * approved / parked / rejected, print job routed / queued) emit
 * append-only audit records to an INJECTED audit sink. The audit PACKAGE
 * is lane C's `@fleetos/audit` (W012, accepted); the ownership gate
 * forbids importing it from this lane (worker-c's lane), so this seam is
 * structurally identical to `@fleetos/device-model`'s W011 `AuditSink`,
 * `@fleetos/health`'s W021 seam, `@fleetos/workloads`'s W022 seam, and
 * `@fleetos/policy`'s W031 seam: `{ tenantId, action, subject,
 * occurredAt, correlationId, causationId?, details }`. W012's sink
 * adapter (`packages/audit/src/sink-adapter.ts`) adapts any append-only
 * audit log to any structurally identical seam without a cross-lane
 * import (proven by test in this package's test suite).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031 judgment
 * calls): audit records are emitted for CONSEQUENTIAL events only — a
 * Fleet Action plan submission whose Guardian decision is ADVANCED /
 * PARKED / REJECTED (the policy-gated transitions), a plan approval (the
 * human-approval step the W031 Guardian defers to W041), and a print job
 * routing/queuing (a consequential dispatch). Pure reads, in-memory
 * derivations and failed mutations never audit (the frozen error
 * taxonomy carries its own trace).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the Fleet Action
 * modules. Carries the full traceability set: tenant scope, subject (the
 * plan or print job the record is about — null when unattributed),
 * action, time, correlation/causation ids, and a JSON-serializable
 * details bag.
 */
export interface ActionAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "action.plan.submitted"). */
  readonly action: string;
  /** The entity the record is about (plan id or print job id), or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (status, decision, plan, queue state). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the actions reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface ActionAuditSink {
  append(record: ActionAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeActionAuditRecord(record: ActionAuditRecord): ActionAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_ACTION_AUDIT_SINK: ActionAuditSink = frozen({
  append: (_record: ActionAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryActionAuditSink(): ActionAuditSink & {
  readonly records: readonly ActionAuditRecord[];
} {
  const records: ActionAuditRecord[] = [];
  return frozen({
    append(record: ActionAuditRecord): void {
      records.push(record);
    },
    get records(): readonly ActionAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the Fleet Action modules. */
export const ACTION_AUDIT_ACTIONS = frozen({
  /** An action plan was created (the proposal was drafted). */
  planCreated: "action.plan.created",
  /** An action plan was submitted to the Guardian (the policy-gated transition). */
  planSubmitted: "action.plan.submitted",
  /** A parked plan was approved (the human-approval step). */
  planApproved: "action.plan.approved",
  /** A print job was routed to a printer. */
  printJobRouted: "action.print.job.routed",
  /** A print job was queued at a printer. */
  printJobQueued: "action.print.job.queued",
} as const);
