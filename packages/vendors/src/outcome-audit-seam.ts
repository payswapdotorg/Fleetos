/**
 * @fleetos/vendors — the W072 outcome-quality audit emission seam.
 *
 * The W072 surfaces (vendor scorecards, marketplace-quality evidence
 * packs) emit append-only audit records to an INJECTED audit sink. This
 * seam is structurally identical to the W011/W021/W022/W031/W032/W040/
 * W041/W042 seams — `{ tenantId, action, subject, occurredAt,
 * correlationId, causationId?, details }` — with the maintenance lane's
 * subject flexibility (`string | null`): the W072 subjects are scorecard
 * ids and evidence-pack ids, not vendor ids, so the existing
 * `VendorAuditSink` (whose subject is the branded `VendorId`) is
 * intentionally NOT reused — this seam sits BESIDE it (additive; the
 * frozen W032 seam is untouched).
 *
 * The audit PACKAGE is this lane's `@fleetos/audit` (W012, accepted);
 * W012's sink adapter (`packages/audit/src/sink-adapter.ts`) satisfies
 * this seam structurally WITHOUT any cross-package wiring (proven by
 * test in this package's suite — records flow into the hash-chained
 * AuditLog, the chain verifies, per-tenant chains stay separate).
 *
 * Emission policy (mirrors the lane's judgment calls): audit records
 * are emitted for the consequential W072 derivations ONLY — a scorecard
 * revision recorded, an evidence pack composed. Failed builds emit
 * none. Pure reads never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the W072
 * outcome-quality surfaces. Carries the full traceability set: tenant
 * scope, subject (the scorecard id / evidence-pack id — null when
 * unattributed), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface VendorsOutcomeAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "vendors.scorecard.recorded"). */
  readonly action: string;
  /** The entity the record is about (scorecard/pack id), or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (ids, revisions, hashes). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 */
export interface VendorsOutcomeAuditSink {
  append(record: VendorsOutcomeAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeVendorsOutcomeAuditRecord(
  record: VendorsOutcomeAuditRecord,
): VendorsOutcomeAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_VENDORS_OUTCOME_AUDIT_SINK: VendorsOutcomeAuditSink = frozen({
  append: (_record: VendorsOutcomeAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryVendorsOutcomeAuditSink(): VendorsOutcomeAuditSink & {
  readonly records: readonly VendorsOutcomeAuditRecord[];
} {
  const records: VendorsOutcomeAuditRecord[] = [];
  return frozen({
    append(record: VendorsOutcomeAuditRecord): void {
      records.push(record);
    },
    get records(): readonly VendorsOutcomeAuditRecord[] {
      return records;
    },
  });
}
