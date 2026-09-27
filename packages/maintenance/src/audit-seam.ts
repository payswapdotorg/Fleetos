/**
 * @fleetos/maintenance — the audit emission seam (W011/W021/W022/W031/W032/
 * W040/W041's pattern).
 *
 * Maintenance consequential mutations (work order created, work order
 * revised, match recorded, aggregation formed) emit append-only audit
 * records to an INJECTED audit sink. The audit PACKAGE is this lane's
 * `@fleetos/audit` (W012, accepted); the ownership gate permits the
 * cross-package import only at the TEST boundary (src/ never imports
 * `@fleetos/audit`); this seam is structurally identical to the W011/
 * W021/W022/W031/W032/W040/W041 seams: `{ tenantId, action, subject,
 * occurredAt, correlationId, causationId?, details }`. W012's sink
 * adapter (`packages/audit/src/sink-adapter.ts`) adapts any append-only
 * audit log to any structurally identical seam without a cross-lane
 * import (proven by test in this package's test suite — records flow
 * into the hash-chained AuditLog, the chain verifies, per-tenant chains
 * stay separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W032/
 * W040/W041 judgment calls): audit records are emitted for
 * CONSEQUENTIAL events only — every maintenance state mutation that a
 * later actor must be able to reconstruct from evidence. Pure reads,
 * in-memory derivations and failed validations never audit (the frozen
 * error taxonomy carries its own trace).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the maintenance
 * modules. Carries the full traceability set: tenant scope, subject (the
 * entity the record is about — work order id, match id, aggregation id —
 * null when unattributed), action, time, correlation/causation ids, and
 * a JSON-serializable details bag.
 */
export interface MaintenanceAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "maintenance.workorder.created"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (status, decision, evidence trail). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the maintenance reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface MaintenanceAuditSink {
  append(record: MaintenanceAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeMaintenanceAuditRecord(record: MaintenanceAuditRecord): MaintenanceAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_MAINTENANCE_AUDIT_SINK: MaintenanceAuditSink = frozen({
  append: (_record: MaintenanceAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryMaintenanceAuditSink(): MaintenanceAuditSink & {
  readonly records: readonly MaintenanceAuditRecord[];
} {
  const records: MaintenanceAuditRecord[] = [];
  return frozen({
    append(record: MaintenanceAuditRecord): void {
      records.push(record);
    },
    get records(): readonly MaintenanceAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the maintenance modules. The
 * consequential-mutation set from the W042 work order: work order
 * created / revised, match recorded, aggregation formed.
 */
export const MAINTENANCE_AUDIT_ACTIONS = frozen({
  /** A service work order was created (version 1 appended). */
  workOrderCreated: "maintenance.workorder.created",
  /** A service work order was revised (new revision appended). */
  workOrderRevised: "maintenance.workorder.revised",
  /** A vendor match was recorded for a service work order. */
  matchRecorded: "maintenance.match.recorded",
  /** A compatible-order aggregation was formed (a PROPOSAL — never dispatch). */
  aggregationFormed: "maintenance.aggregation.formed",
} as const);
