/**
 * @fleetos/device-model — The audit emission seam.
 *
 * The ingestion boundary emits append-only audit records to an INJECTED
 * audit sink. The audit PACKAGE itself is lane C's W012
 * (`@fleetos/audit`); this lane defines only the minimal interface the
 * boundary depends on, so W012 can adapt its real append-only store to
 * this seam without a device-model change (dependency inversion at the
 * lane boundary — the only cross-lane contract surface is
 * `@fleetos/contracts`, so this seam lives here and points TOWARD the
 * future implementation).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the device-model.
 * Carries the full traceability set: tenant scope, subject, action,
 * time, correlation/causation ids, and a JSON-serializable details bag.
 *
 * `subject` is null only for rejections that predate device attribution
 * (e.g. a request with no batch at all).
 */
export interface DeviceModelAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "device.observations.admitted"). */
  readonly action: string;
  /** The device the record is about (null when not attributable). */
  readonly subject: DeviceId | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (counts, digests, revisions). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the device-model reference
 * implementation is pure and in-memory; a durable W012 implementation
 * may queue internally, but MUST NOT drop records.
 */
export interface AuditSink {
  append(record: DeviceModelAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeAuditRecord(record: DeviceModelAuditRecord): DeviceModelAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_AUDIT_SINK: AuditSink = frozen({
  append: (_record: DeviceModelAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryAuditSink(): AuditSink & { readonly records: readonly DeviceModelAuditRecord[] } {
  const records: DeviceModelAuditRecord[] = [];
  return frozen({
    append(record: DeviceModelAuditRecord): void {
      records.push(record);
    },
    get records(): readonly DeviceModelAuditRecord[] {
      return records;
    },
  });
}
