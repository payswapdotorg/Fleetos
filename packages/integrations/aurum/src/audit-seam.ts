/**
 * @fleetos/integration-aurum — the audit emission seam (the W011/W021/
 * W022/W031/W032/W040/W041/W042 pattern).
 *
 * Aurum-adapter consequential mutations (message emitted, redaction
 * applied, delivery ingested, refusal) emit append-only audit records to
 * an INJECTED audit sink. The audit PACKAGE is this lane's `@fleetos/audit`
 * (W012, accepted); the ownership gate permits the cross-package import
 * only at the TEST boundary (src/ never imports `@fleetos/audit`); this
 * seam is structurally identical to the established lane seams:
 * `{ tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }`. W012's sink adapter (`packages/audit/src/sink-adapter.ts`)
 * adapts any append-only audit log to any structurally identical seam
 * without a cross-lane import (proven by test in this package's test
 * suite — records flow into the hash-chained AuditLog, the chain
 * verifies, per-tenant chains stay separate).
 *
 * Emission policy (documented, mirrors the established judgment calls):
 * audit records are emitted for CONSEQUENTIAL mutations only — every
 * aurum-adapter state mutation that a later actor must be able to
 * reconstruct from evidence (a message actually appended to the outbox,
 * redaction actually applied at emission, a delivery record actually
 * ingested, a refusal that a later actor must be able to reconstruct).
 * Pure reads, pure builders, in-memory derivations, idempotent duplicate
 * no-ops (nothing mutated) and failed validations that never reached a
 * ledger never audit on their own — refusals at the BOUNDARY audit
 * `*.refused` carrying the machine-stable reason (the frozen error
 * taxonomy carries its own trace for pure-builder refusals).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the aurum-adapter
 * boundary functions. Carries the full traceability set: tenant scope,
 * subject (the entity the record is about — the emitted message id or
 * the delivery (messageRef, attempt) pair — null when unattributed),
 * action, time, correlation/causation ids, and a JSON-serializable
 * details bag.
 */
export interface AurumAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "aurum.message.emitted"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (kind, digest, redactions, reasons). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the aurum reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface AurumAuditSink {
  append(record: AurumAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeAurumAuditRecord(record: AurumAuditRecord): AurumAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_AURUM_AUDIT_SINK: AurumAuditSink = frozen({
  append: (_record: AurumAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryAurumAuditSink(): AurumAuditSink & {
  readonly records: readonly AurumAuditRecord[];
} {
  const records: AurumAuditRecord[] = [];
  return frozen({
    append(record: AurumAuditRecord): void {
      records.push(record);
    },
    get records(): readonly AurumAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the aurum-adapter boundary
 * functions. The consequential-mutation set from the W050C work order:
 * message emitted, redaction applied, delivery ingested, refusal.
 */
export const AURUM_AUDIT_ACTIONS = frozen({
  /** A communication message was appended to the outbox ledger. */
  messageEmitted: "aurum.message.emitted",
  /** A redaction policy redacted at least one field at emission. */
  redactionApplied: "aurum.redaction.applied",
  /** A delivery/outcome metadata record was ingested. */
  deliveryIngested: "aurum.delivery.ingested",
  /** An outbox emission was refused with a machine-stable reason. */
  messageRefused: "aurum.message.refused",
  /** A delivery ingestion was refused with a machine-stable reason. */
  deliveryRefused: "aurum.delivery.refused",
} as const);
