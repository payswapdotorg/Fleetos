/**
 * @fleetos/security — the audit emission seam (W011/W021/W022's pattern).
 *
 * The Security Doctor emits append-only audit records to an INJECTED
 * audit sink. The audit PACKAGE is lane C's `@fleetos/audit` (W012,
 * accepted); the ownership gate forbids importing it from this lane, so
 * this seam is structurally identical to `@fleetos/device-model`'s W011
 * `AuditSink`, `@fleetos/health`'s W021 seam and `@fleetos/workloads`'s
 * W022 seam: `{ tenantId, action, subject, occurredAt, correlationId,
 * causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import
 * (proven by test in this package's test suite).
 *
 * Emission policy (documented, mirrors the W011/W021/W022 judgment
 * calls): audit records are emitted for CONSEQUENTIAL mutations only —
 * posture-finding mutations (a finding recorded at version 1, a finding
 * superseded by a new version, a finding dismissed). Pure derivations
 * (posture assessment over the immutable observation history) are
 * deterministic and recomputable; they do not audit. Failed mutations
 * never audit (the frozen error taxonomy carries its own trace).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the Security Doctor.
 * Carries the full traceability set: tenant scope, subject (the device),
 * action, time, correlation/causation ids, and a JSON-serializable
 * details bag.
 */
export interface SecurityAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "security.finding.recorded"). */
  readonly action: string;
  /** The device the record is about. */
  readonly subject: DeviceId;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (finding ids, versions, severities). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the security reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface SecurityAuditSink {
  append(record: SecurityAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeSecurityAuditRecord(record: SecurityAuditRecord): SecurityAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_SECURITY_AUDIT_SINK: SecurityAuditSink = frozen({
  append: (_record: SecurityAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemorySecurityAuditSink(): SecurityAuditSink & {
  readonly records: readonly SecurityAuditRecord[];
} {
  const records: SecurityAuditRecord[] = [];
  return frozen({
    append(record: SecurityAuditRecord): void {
      records.push(record);
    },
    get records(): readonly SecurityAuditRecord[] {
      return records;
    },
  });
}

/** Stable machine action names emitted by the Security Doctor. */
export const SECURITY_AUDIT_ACTIONS = frozen({
  /** A posture finding was recorded (version 1 — a new finding identity). */
  findingRecorded: "security.finding.recorded",
  /** A posture finding was superseded by a new interpretation version. */
  findingSuperseded: "security.finding.superseded",
  /** A posture finding was dismissed (remediated / false positive / risk accepted). */
  findingDismissed: "security.finding.dismissed",
} as const);

/** Stable machine-stable dismissal reasons (open set — callers may use their own). */
export const FINDING_DISMISSAL_REASONS = frozen({
  remediated: "remediated",
  falsePositive: "false_positive",
  riskAccepted: "risk_accepted",
} as const);
