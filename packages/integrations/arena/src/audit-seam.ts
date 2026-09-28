/**
 * @fleetos/integration-arena — the audit emission seam (W011/W021/W022/
 * W031/W032/W040/W041's pattern).
 *
 * Arena consequential mutations (case submitted/parked/rejected,
 * capability adopted/superseded, uncertified capability refused) emit
 * append-only audit records to an INJECTED audit sink. The audit PACKAGE
 * is lane C's `@fleetos/audit` (W012, accepted); the ownership gate
 * forbids importing it from this lane-B integration package
 * (`tools/check-ownership.mjs`: only `@fleetos/contracts` may cross
 * lanes), so this seam is structurally identical to `@fleetos/device-model`'s
 * W011 `AuditSink`, `@fleetos/health`'s W021 seam, `@fleetos/workloads`'
 * W022 seam, `@fleetos/policy`'s W031 seam, `@fleetos/actions`' W041 seam
 * and `@fleetos/recovery`'s W040 seam: `{ tenantId, action, subject,
 * occurredAt, correlationId, causationId?, details }`. W012's sink
 * adapter (`packages/audit/src/sink-adapter.ts`) adapts any append-only
 * audit log to any structurally identical seam without a cross-lane
 * import (proven by test in this package's test suite — records flow
 * into the hash-chained AuditLog, the chain verifies, per-tenant
 * chains stay separate).
 *
 * Emission policy (documented, mirrors the W011/W021/W022/W031/W040/W041
 * judgment calls): audit records are emitted for CONSEQUENTIAL events
 * only — every arena state mutation that a later actor must be able to
 * reconstruct from evidence. Pure reads, in-memory derivations and
 * failed validations never audit (the frozen error taxonomy carries its
 * own trace). The certification-boundary refusal is consequential
 * (ARCHITECTURE-LOCK item 16 destructive-action evidence trail analog;
 * ARENA.md invariant: "FleetOS never treats an uncertified model output
 * as action permission" — the refusal MUST be auditable so a reviewer
 * can prove the boundary held).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * An append-only audit record handed to the sink by the arena modules.
 * Carries the full traceability set: tenant scope, subject (the entity
 * the record is about — case id, adoption id, refusal id — or null when
 * unattributed), action, time, correlation/causation ids, and a
 * JSON-serializable details bag.
 */
export interface ArenaAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "arena.case.submitted"). */
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
 * The interface is synchronous by design — the arena reference
 * implementation is pure and in-memory; a durable implementation may
 * queue internally, but MUST NOT drop records.
 */
export interface ArenaAuditSink {
  append(record: ArenaAuditRecord): void;
}

/** Convenience constructor for a frozen audit record. */
export function makeArenaAuditRecord(record: ArenaAuditRecord): ArenaAuditRecord {
  return frozen(record);
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_ARENA_AUDIT_SINK: ArenaAuditSink = frozen({
  append: (_record: ArenaAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryArenaAuditSink(): ArenaAuditSink & {
  readonly records: readonly ArenaAuditRecord[];
} {
  const records: ArenaAuditRecord[] = [];
  return frozen({
    append(record: ArenaAuditRecord): void {
      records.push(record);
    },
    get records(): readonly ArenaAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the arena modules. The
 * consequential-mutation set from the W050B work order: case submitted /
 * parked / rejected, capability adopted / superseded, uncertified
 * capability refused — plus the documented additions (supersession
 * recorded: a revision that cites a prior; refusal reason recorded: the
 * certification-boundary refusal carrying the machine-stable reasons
 * verbatim).
 */
export const ARENA_AUDIT_ACTIONS = frozen({
  /** An evaluation case was submitted (Guardian ALLOW/WARN advanced it; the case is now durable in the ledger). */
  caseSubmitted: "arena.case.submitted",
  /** An evaluation case was parked (Guardian REQUIRE_APPROVAL — held for human review). */
  caseParked: "arena.case.parked",
  /** An evaluation case was rejected (Guardian BLOCK — refused with the Guardian's machine-stable reasons). */
  caseRejected: "arena.case.rejected",
  /** A certified capability was adopted (version 1 appended into the adoption ledger). */
  capabilityAdopted: "arena.capability.adopted",
  /** A certified capability adoption was superseded by a new revision. */
  capabilitySuperseded: "arena.capability.superseded",
  /** An uncertified capability was refused at the certification boundary (fail-closed; the refusal reasons are recorded). */
  capabilityRefused: "arena.capability.refused",
} as const);
