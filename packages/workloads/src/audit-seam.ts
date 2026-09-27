/**
 * @fleetos/workloads — the audit emission seam (W012's pattern).
 *
 * Profile mutations and recommendation proposals emit append-only audit
 * records to an INJECTED audit sink. The audit PACKAGE is lane C's
 * `@fleetos/audit` (W012, accepted); this seam is structurally identical
 * to W011's device-model seam and W021's health seam:
 * `{ tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }`. W012's sink adapter (`packages/audit/src/sink-adapter.ts`)
 * adapts any `AuditLog` to any structurally identical seam — the adapter
 * returned by `createAuditSinkAdapter(log, { source })` satisfies
 * `WorkloadAuditSink` WITHOUT any cross-package wiring (proven by test).
 *
 * Emission policy (documented, mirrors the W011/W021 judgment calls):
 * audit records are emitted for CONSEQUENTIAL mutations and proposals —
 * profile created, profile revised, recommendation proposed,
 * recommendation dismissed. Pure reads (get/list) and derived folds
 * (status resolution, fit assessment) do not audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the workloads
 * package. Carries the full traceability set: tenant scope, subject (the
 * workload), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface WorkloadAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "workloads.profile.created"). */
  readonly action: string;
  /** The workload the record is about. */
  readonly subject: WorkloadId;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (ids, revisions, hashes, confidences). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the workloads reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface WorkloadAuditSink {
  append(record: WorkloadAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeWorkloadAuditRecord(record: WorkloadAuditRecord): WorkloadAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_WORKLOAD_AUDIT_SINK: WorkloadAuditSink = frozen({
  append: (_record: WorkloadAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryWorkloadAuditSink(): WorkloadAuditSink & {
  readonly records: readonly WorkloadAuditRecord[];
} {
  const records: WorkloadAuditRecord[] = [];
  return frozen({
    append(record: WorkloadAuditRecord): void {
      records.push(record);
    },
    get records(): readonly WorkloadAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the workloads package. */
export const WORKLOAD_AUDIT_ACTIONS = frozen({
  profileCreated: "workloads.profile.created",
  profileRevised: "workloads.profile.revised",
  recommendationProposed: "workloads.recommendation.proposed",
  recommendationDismissed: "workloads.recommendation.dismissed",
} as const);
