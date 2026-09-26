/**
 * @fleetos/health — The audit emission seam (W011's pattern).
 *
 * The diagnosis engine emits append-only audit records to an INJECTED
 * audit sink. The audit PACKAGE is lane C's `@fleetos/audit` (W012,
 * accepted); the ownership gate forbids importing it from this lane, so
 * this seam mirrors `@fleetos/device-model`'s W011 `AuditSink`:
 * structurally, `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }` — W012's sink adapter (`packages/audit/src/
 * sink-adapter.ts`) adapts any append-only audit log to any structurally
 * identical seam without a cross-lane import.
 *
 * Emission policy (documented, mirrors W011's judgment call): audit
 * records are emitted for CONSEQUENTIAL interpretations — diagnosis
 * hypotheses proposed and dismissed, treatment recommendations proposed.
 * Derived data (signals, baselines, anomalies) is deterministic and
 * recomputable from the immutable observation history; it does not audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the health engine.
 * Carries the full traceability set: tenant scope, subject, action,
 * time, correlation/causation ids, and a JSON-serializable details bag.
 */
export interface HealthAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "health.diagnosis.proposed"). */
  readonly action: string;
  /** The device the record is about. */
  readonly subject: DeviceId;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (ids, cause ids, confidences, counts). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the health reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface HealthAuditSink {
  append(record: HealthAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeHealthAuditRecord(record: HealthAuditRecord): HealthAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_HEALTH_AUDIT_SINK: HealthAuditSink = frozen({
  append: (_record: HealthAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryHealthAuditSink(): HealthAuditSink & {
  readonly records: readonly HealthAuditRecord[];
} {
  const records: HealthAuditRecord[] = [];
  return frozen({
    append(record: HealthAuditRecord): void {
      records.push(record);
    },
    get records(): readonly HealthAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the diagnosis engine. */
export const HEALTH_AUDIT_ACTIONS = frozen({
  diagnosisProposed: "health.diagnosis.proposed",
  treatmentProposed: "health.treatment.proposed",
  hypothesisDismissed: "health.diagnosis.dismissed",
} as const);
