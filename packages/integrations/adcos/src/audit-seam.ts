/**
 * @fleetos/integration-adcos — the audit emission seam (the
 * W011/W021/W022/W031/W041 pattern).
 *
 * ADCOS consequential mutations (submission proposed / submitted /
 * parked / approved / rejected / refused, status adopted, degradation
 * recorded, termination requested / adopted) emit append-only audit
 * records to an INJECTED audit sink. The audit PACKAGE is lane C's
 * `@fleetos/audit` (W012, accepted); the ownership gate forbids
 * importing it from this lane (worker-c's lane), so this seam is
 * structurally identical to `@fleetos/device-model`'s W011 `AuditSink`,
 * `@fleetos/recovery`'s W040 seam and the W021/W022/W031/W041 seams:
 * `{ tenantId, action, subject, occurredAt, correlationId, causationId?,
 * details }`. W012's sink adapter (`packages/audit/src/sink-adapter.ts`)
 * adapts any append-only audit log to any structurally identical seam
 * without a cross-lane import (proven by test in this package's test
 * suite — records flow into the hash-chained AuditLog, the chain
 * verifies, per-tenant chains stay separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041
 * judgment calls): audit records are emitted for CONSEQUENTIAL events
 * only — every adapter state mutation that a later actor must be able to
 * reconstruct from evidence. Pure reads, pure translations (including
 * translation refusals — no state was created), in-memory derivations
 * and failed validations never audit (the frozen error taxonomy carries
 * its own trace). The submission-gate audit records carry the full
 * policy context (the frozen `GuardianDecision` + matched rule ids +
 * machine-stable reasons) per the §4 consequential-action discipline.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the ADCOS adapter
 * modules. Carries the full traceability set: tenant scope, subject (the
 * entity the record is about — submission id or connectivity id — null
 * when unattributed), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface AdcosAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "adcos.submission.submitted"). */
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
 * The interface is synchronous by design — the ADCOS reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface AdcosAuditSink {
  append(record: AdcosAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeAdcosAuditRecord(record: AdcosAuditRecord): AdcosAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_ADCOS_AUDIT_SINK: AdcosAuditSink = frozen({
  append: (_record: AdcosAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryAdcosAuditSink(): AdcosAuditSink & {
  readonly records: readonly AdcosAuditRecord[];
} {
  const records: AdcosAuditRecord[] = [];
  return frozen({
    append(record: AdcosAuditRecord): void {
      records.push(record);
    },
    get records(): readonly AdcosAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the ADCOS adapter modules. The
 * consequential-mutation set from the W050A work order: request
 * submitted / parked / rejected, status adopted, degradation recorded —
 * plus the documented additions (proposed: the proposal opening;
 * approved: the human-approval grant; refused: a provider-side dispatch
 * refusal; termination requested/adopted: the tenant-initiated
 * termination flow).
 */
export const ADCOS_AUDIT_ACTIONS = frozen({
  /** A connectivity submission proposal was opened (revision 1, PROPOSED). */
  submissionProposed: "adcos.submission.proposed",
  /** A submission was dispatched to the provider and accepted (SUBMITTED). */
  submissionSubmitted: "adcos.submission.submitted",
  /** A submission was parked (Guardian REQUIRE_APPROVAL — held for human approval). */
  submissionParked: "adcos.submission.parked",
  /** A parked submission was approved by a human (the explicit grant). */
  submissionApproved: "adcos.submission.approved",
  /** A submission was rejected (Guardian BLOCK, human rejection, or evaluation failure). */
  submissionRejected: "adcos.submission.rejected",
  /** A granted submission was refused by the provider at dispatch. */
  submissionRefused: "adcos.submission.refused",
  /** A provider-reported status was adopted (a new revision appended). */
  statusAdopted: "adcos.status.adopted",
  /** An adopted revision carries a degradation (non-none classification). */
  degradationRecorded: "adcos.degradation.recorded",
  /** A tenant requested termination of a connectivity contract. */
  terminationRequested: "adcos.termination.requested",
  /** An adopted revision carries a termination (the contract ended). */
  terminationAdopted: "adcos.termination.adopted",
} as const);
