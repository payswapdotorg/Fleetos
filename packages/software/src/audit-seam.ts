/**
 * @fleetos/software — the audit emission seam (W012's pattern).
 *
 * Subscription allocation mutations emit append-only audit records to
 * an INJECTED audit sink. Structurally identical to W011/W021/W022/W032
 * seams. W012's sink adapter satisfies `SoftwareAuditSink` structurally
 * (proven by test).
 *
 * Emission policy: consequential mutations only (subscription allocated,
 * subscription revised).
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

/** The subject of a software audit record (subscription id). */
export type SoftwareSubject = string;

/**
 * An append-only audit record handed to the sink by the software
 * package. Carries the full traceability set: tenant scope, subject
 * (the subscription id), action, time, correlation/causation ids,
 * and a JSON-serializable details bag.
 */
export interface SoftwareAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "software.subscription.allocated"). */
  readonly action: string;
  /** The subscription the record is about. */
  readonly subject: SoftwareSubject;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** The minimal audit sink interface. */
export interface SoftwareAuditSink {
  append(record: SoftwareAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeSoftwareAuditRecord(record: SoftwareAuditRecord): SoftwareAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_SOFTWARE_AUDIT_SINK: SoftwareAuditSink = frozen({
  append: (_record: SoftwareAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemorySoftwareAuditSink(): SoftwareAuditSink & {
  readonly records: readonly SoftwareAuditRecord[];
} {
  const records: SoftwareAuditRecord[] = [];
  return frozen({
    append(record: SoftwareAuditRecord): void {
      records.push(record);
    },
    get records(): readonly SoftwareAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the software package. */
export const SOFTWARE_AUDIT_ACTIONS = frozen({
  subscriptionAllocated: "software.subscription.allocated",
  subscriptionRevised: "software.subscription.revised",
} as const);
