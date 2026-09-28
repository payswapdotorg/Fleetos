/**
 * @fleetos/learning — the audit emission seam (D4; the W011/W021/W022/
 * W031/W032/W040/W041/W050B pattern).
 *
 * Learning consequential mutations (outcome observations recorded,
 * evaluation-case proposals gated to PROPOSED/PARKED/REJECTED, capability
 * adoptions recorded/superseded, uncertified capability refused) emit
 * append-only audit records to an INJECTED audit sink. The audit PACKAGE
 * is lane C's `@fleetos/audit` (W012, accepted); this package's src/
 * discipline permits only `@fleetos/contracts` imports, so this seam is
 * structurally identical to `@fleetos/device-model`'s W011 `AuditSink`,
 * `@fleetos/health`'s W021 seam, `@fleetos/policy`'s W031 seam,
 * `@fleetos/actions`' W041 seam, `@fleetos/recovery`'s W040 seam and the
 * arena lane's W050B seam: `{ tenantId, action, subject, occurredAt,
 * correlationId, causationId?, details }`. W012's sink adapter
 * (`packages/audit/src/sink-adapter.ts`) adapts any append-only audit log
 * to any structurally identical seam without a cross-lane import (proven
 * by test in this package's test suite — records flow into the
 * hash-chained AuditLog, the chain verifies, per-tenant chains stay
 * separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041/
 * W050B judgment calls): audit records are emitted for CONSEQUENTIAL
 * events only — every learning state mutation that a later actor must be
 * able to reconstruct from evidence. Pure reads, in-memory derivations
 * and failed validations never audit (the frozen error taxonomy carries
 * its own trace). Two refusals ARE consequential (and therefore audited):
 *   - the certification-boundary refusal (the fail-closed gate holding is
 *     evidence a reviewer must be able to prove — the ARENA.md invariant
 *     "FleetOS never treats an uncertified model output as action
 *     permission");
 *   - a BLOCK-gated evaluation-case proposal (the Guardian's refusal is a
 *     decision a later actor must be able to reconstruct).
 * Idempotent re-appends (same content, same slot) mutate nothing and
 * therefore audit nothing.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the learning modules.
 * Carries the full traceability set: tenant scope, subject (the entity
 * the record is about — observation id, proposal id, adoption id — or
 * null when unattributed), action, time, correlation/causation ids, and
 * a JSON-serializable details bag.
 */
export interface LearningAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "learning.outcome.observed"). */
  readonly action: string;
  /** The entity the record is about, or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context (outcome, decision, evidence trail). */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The minimal audit sink interface. Implementations MUST be append-only:
 * a record handed to `append` is durably recorded and never rewritten.
 * The interface is synchronous by design — the learning reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface LearningAuditSink {
  append(record: LearningAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeLearningAuditRecord(record: LearningAuditRecord): LearningAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_LEARNING_AUDIT_SINK: LearningAuditSink = frozen({
  append: (_record: LearningAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryLearningAuditSink(): LearningAuditSink & {
  readonly records: readonly LearningAuditRecord[];
} {
  const records: LearningAuditRecord[] = [];
  return frozen({
    append(record: LearningAuditRecord): void {
      records.push(record);
    },
    get records(): readonly LearningAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the learning modules. The
 * consequential-mutation set from the W070 work order: outcome
 * observations recorded; evaluation-case proposals gated (proposed /
 * parked / rejected — the disposition is a Guardian decision a later
 * actor must be able to reconstruct); capability adoptions recorded /
 * superseded; uncertified capability refused at the fail-closed
 * certification boundary.
 */
export const LEARNING_AUDIT_ACTIONS = frozen({
  /** An outcome observation was recorded into the tenant's ledger (a new record appended). */
  outcomeObserved: "learning.outcome.observed",
  /** An evaluation-case submission proposal was gated to PROPOSED (Guardian ALLOW/WARN). */
  caseProposed: "learning.case.proposed",
  /** An evaluation-case submission proposal was gated to PARKED (Guardian REQUIRE_APPROVAL). */
  caseParked: "learning.case.parked",
  /** An evaluation-case submission proposal was gated to REJECTED (Guardian BLOCK). */
  caseRejected: "learning.case.rejected",
  /** A certified capability adoption was recorded (a new revision appended into the ledger). */
  adoptionRecorded: "learning.adoption.recorded",
  /** A certified capability adoption was superseded by a new revision. */
  adoptionSuperseded: "learning.adoption.superseded",
  /** An uncertified capability was refused at the certification boundary (fail-closed; the refusal reasons are recorded). */
  adoptionRefused: "learning.adoption.refused",
} as const);
