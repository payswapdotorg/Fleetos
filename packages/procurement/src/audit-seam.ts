/**
 * @fleetos/procurement — the audit emission seam (W012's pattern).
 *
 * Demand creation, quote issued/accepted/superseded, and aggregation
 * emit append-only audit records to an INJECTED audit sink. Structurally
 * identical to W011/W021/W022's seams. W012's sink adapter satisfies
 * `ProcurementAuditSink` structurally (proven by test).
 *
 * Emission policy: consequential mutations only (demand created, quote
 * issued, quote accepted, quote superseded, aggregation formed).
 * Pure reads (get/list) and derived folds do not audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/** The subject of a procurement audit record (demand id, quote id, etc.). */
export type ProcurementSubject = string;

/**
 * An append-only audit record handed to the sink by the procurement
 * package. Carries the full traceability set: tenant scope, subject
 * (the demand/quote/aggregation id), action, time, correlation/causation
 * ids, and a JSON-serializable details bag.
 */
export interface ProcurementAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "procurement.demand.created"). */
  readonly action: string;
  /** The record the audit is about (demand id / quote id / aggregation id). */
  readonly subject: ProcurementSubject;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** The minimal audit sink interface. */
export interface ProcurementAuditSink {
  append(record: ProcurementAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeProcurementAuditRecord(record: ProcurementAuditRecord): ProcurementAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_PROCUREMENT_AUDIT_SINK: ProcurementAuditSink = frozen({
  append: (_record: ProcurementAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryProcurementAuditSink(): ProcurementAuditSink & {
  readonly records: readonly ProcurementAuditRecord[];
} {
  const records: ProcurementAuditRecord[] = [];
  return frozen({
    append(record: ProcurementAuditRecord): void {
      records.push(record);
    },
    get records(): readonly ProcurementAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the procurement package. */
export const PROCUREMENT_AUDIT_ACTIONS = frozen({
  demandCreated: "procurement.demand.created",
  quoteIssued: "procurement.quote.issued",
  quoteAccepted: "procurement.quote.accepted",
  quoteSuperseded: "procurement.quote.superseded",
  aggregationFormed: "procurement.aggregation.formed",
} as const);
