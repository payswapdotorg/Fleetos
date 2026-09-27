/**
 * @fleetos/recovery — the audit emission seam (W011/W021/W022/W031/W041's
 * pattern).
 *
 * Recovery consequential mutations (last-seen evidence recorded, case
 * opened/transitioned, destructive action requested/parked/approved/
 * rejected/executed/failed/refused, replacement escalated/superseded)
 * emit append-only audit records to an INJECTED audit sink. The audit
 * PACKAGE is lane C's `@fleetos/audit` (W012, accepted); the ownership
 * gate forbids importing it from this lane (worker-c's lane), so this
 * seam is structurally identical to `@fleetos/device-model`'s W011
 * `AuditSink`, `@fleetos/health`'s W021 seam, `@fleetos/workloads`' W022
 * seam, `@fleetos/policy`'s W031 seam and `@fleetos/actions`' W041 seam:
 * `{ tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }`. W012's sink adapter (`packages/audit/src/sink-adapter.ts`)
 * adapts any append-only audit log to any structurally identical seam
 * without a cross-lane import (proven by test in this package's test
 * suite — records flow into the hash-chained AuditLog, the chain
 * verifies, per-tenant chains stay separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W041
 * judgment calls): audit records are emitted for CONSEQUENTIAL events
 * only — every recovery state mutation that a later actor must be able
 * to reconstruct from evidence. Pure reads, in-memory derivations and
 * failed validations never audit (the frozen error taxonomy carries its
 * own trace). `spec/ARCHITECTURE-LOCK.md` item 16: every GRANTED
 * destructive action carries the full evidence trail (policy decision +
 * rule ids + observation evidence) — the destructive-gate audit record
 * carries exactly that set.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the recovery
 * modules. Carries the full traceability set: tenant scope, subject (the
 * entity the record is about — case id, request id, escalation id or
 * device id — null when unattributed), action, time,
 * correlation/causation ids, and a JSON-serializable details bag.
 */
export interface RecoveryAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "recovery.case.opened"). */
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
 * The interface is synchronous by design — the recovery reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface RecoveryAuditSink {
  append(record: RecoveryAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeRecoveryAuditRecord(record: RecoveryAuditRecord): RecoveryAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_RECOVERY_AUDIT_SINK: RecoveryAuditSink = frozen({
  append: (_record: RecoveryAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryRecoveryAuditSink(): RecoveryAuditSink & {
  readonly records: readonly RecoveryAuditRecord[];
} {
  const records: RecoveryAuditRecord[] = [];
  return frozen({
    append(record: RecoveryAuditRecord): void {
      records.push(record);
    },
    get records(): readonly RecoveryAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the recovery modules. The
 * consequential-mutation set from the W040 work order: case opened /
 * transitioned, destructive action requested / parked / approved /
 * executed / refused, replacement escalated — plus the documented
 * additions (rejected: the negative human-approval terminal; failed: a
 * dispatched execution that failed at the adapter; superseded: an
 * escalation revision) and the last-seen evidence recording.
 */
export const RECOVERY_AUDIT_ACTIONS = frozen({
  /** Last-seen evidence recorded for a device (versioned record appended). */
  lastSeenRecorded: "recovery.lastseen.recorded",
  /** A recovery case was opened (version 1 appended). */
  caseOpened: "recovery.case.opened",
  /** A recovery case transitioned (new revision appended). */
  caseTransitioned: "recovery.case.transitioned",
  /** A destructive recovery action was requested (proposal created + evaluated). */
  destructiveRequested: "recovery.destructive.requested",
  /** A destructive request was parked (Guardian REQUIRE_APPROVAL). */
  destructiveParked: "recovery.destructive.parked",
  /** A parked destructive request was approved by a human. */
  destructiveApproved: "recovery.destructive.approved",
  /** A parked destructive request was rejected by a human. */
  destructiveRejected: "recovery.destructive.rejected",
  /** A granted destructive action executed successfully at the adapter. */
  destructiveExecuted: "recovery.destructive.executed",
  /** A granted destructive action failed at the adapter. */
  destructiveFailed: "recovery.destructive.failed",
  /** A destructive request was refused (capability/tenant/authorization refusal). */
  destructiveRefused: "recovery.destructive.refused",
  /** A replacement escalation was recorded (a PROPOSAL — never procurement). */
  replacementEscalated: "recovery.replacement.escalated",
  /** A replacement escalation was superseded by a new revision. */
  replacementSuperseded: "recovery.replacement.superseded",
} as const);
