/**
 * @fleetos/audit — The append-only audit record (W012 D3).
 *
 * Every consequential action is audited (`spec/ARCHITECTURE.md` § Control
 * plane; ARCHITECTURE-LOCK item 4). The `AuditRecord` answers
 * who / what / when / where / outcome with full traceability:
 *
 *   - WHO    — `actor` (a tenant-bound principal reference);
 *   - WHAT   — `action` (stable machine name) + `details`;
 *   - WHEN   — `occurredAt` (injected ISO 8601 — no clock reads);
 *   - WHERE  — `source` (the emitting module/boundary);
 *   - OUTCOME— success / failure (with the `FleetError`) / denied (with
 *              the machine-stable reasons);
 *   - TRACE  — `correlationId` / `causationId` and `relatedEventIds`
 *              correlating to `EventEnvelope` ids from the frozen
 *              contracts; an optional `guardianDecision` correlates the
 *              Contract Guardian decision for consequential actions
 *              (populated from W031 onward).
 *
 * Records are hash-chained: each record carries the PRIOR record's hash and
 * its own content hash (`computeRecordHash`), enabling the tampering
 * detection walk (`verifyAuditChain`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  AuditRecordId,
  CausationId,
  CorrelationId,
  EventId,
  FleetError,
  GuardianDecision,
  TenantId,
} from "@fleetos/contracts";
import { asAuditRecordId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { canonicalJson, frozen } from "./internal";
import type { HashFn } from "./hash";
import { AUDIT_GENESIS_HASH } from "./hash";

// ---------------------------------------------------------------------------
// Actor reference
// ---------------------------------------------------------------------------

/** The actor kinds recorded in the audit trail. */
export type AuditActorKind = "user" | "service" | "agent" | "system";

/**
 * The WHO of an audit record: a tenant-bound actor reference. Structurally
 * compatible with `@fleetos/identity`'s `PrincipalRef` (same lane) — a
 * principal projects onto it without conversion. The extra `"system"` kind
 * covers control-plane emissions with no acting principal.
 */
export interface AuditActorRef extends TenantScoped {
  readonly kind: AuditActorKind;
  readonly principalId: string;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/**
 * The OUTCOME of an audited action. Failure carries the `FleetError`
 * taxonomy record; denial carries the machine-stable reasons.
 */
export type AuditOutcome =
  | { readonly status: "success" }
  | { readonly status: "failure"; readonly error: FleetError }
  | { readonly status: "denied"; readonly reasons: readonly string[] };

// ---------------------------------------------------------------------------
// Record + append input
// ---------------------------------------------------------------------------

/**
 * The hash-chained append-only audit record. Immutable once appended — the
 * `AuditLog` abstraction exposes NO update or delete operation at all.
 */
export interface AuditRecord extends TenantScoped {
  /** Unique record identifier (assigned by the log at append time). */
  readonly id: AuditRecordId;
  /** 1-based, per-tenant, gapless position in the chain. */
  readonly sequence: number;
  /** WHO: the acting principal (tenant-bound). */
  readonly actor: AuditActorRef;
  /** WHAT: the stable machine action name (e.g. "device.wipe.executed"). */
  readonly action: string;
  /** WHEN: injected ISO 8601 timestamp. */
  readonly occurredAt: string;
  /** WHERE: the emitting module/boundary (e.g. "device-model.ingestion"). */
  readonly source: string;
  /** OUTCOME: success / failure / denied. */
  readonly outcome: AuditOutcome;
  /** Correlation id — threads across the causal graph of the request. */
  readonly correlationId: CorrelationId;
  /** Optional causation id — the immediate cause of the audited action. */
  readonly causationId?: CausationId;
  /** Correlation to `EventEnvelope` ids from the frozen contracts. */
  readonly relatedEventIds: readonly EventId[];
  /** JSON-serializable action context (counts, digests, revisions). */
  readonly details: Readonly<Record<string, unknown>>;
  /**
   * The Contract Guardian decision for consequential actions
   * (`@fleetos/contracts` policy.ts: every consequential action MUST carry
   * a GuardianDecision in its audit record). Optional here because the
   * Guardian itself is W031 — primitive-layer records may predate it.
   */
  readonly guardianDecision?: GuardianDecision;
  /** The hash of the PRIOR record in this tenant's chain (genesis for #1). */
  readonly priorRecordHash: string;
  /** The content hash of THIS record (binds priorRecordHash + content). */
  readonly recordHash: string;
}

/**
 * The input of an append operation. The log assigns `id`, `sequence`, and
 * the hash chain fields; everything else is caller-supplied and validated.
 */
export interface AuditAppendInput extends TenantScoped {
  readonly actor: AuditActorRef;
  readonly action: string;
  readonly occurredAt: string;
  readonly source: string;
  readonly outcome: AuditOutcome;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly relatedEventIds?: readonly EventId[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly guardianDecision?: GuardianDecision;
}

/**
 * The record content that feeds the content hash: everything except the
 * computed `recordHash` itself.
 */
export type HashableAuditRecord = Omit<AuditRecord, "recordHash">;

// ---------------------------------------------------------------------------
// Record id generation
// ---------------------------------------------------------------------------

/** The injectable record-id generator. */
export type AuditRecordIdGenerator = () => AuditRecordId;

/**
 * The reference record-id generator: `aud_` + a deterministic per-instance
 * counter rendered as 12 lowercase base32 characters. Deterministic per
 * log instance; inject a real generator (ULID/UUID) at the storage boundary.
 *
 * @returns a generator producing `aud_...` ids
 */
export function createSequentialAuditRecordIdGenerator(): AuditRecordIdGenerator {
  let counter = 0;
  return () => {
    counter += 1;
    const digits = counter.toString(36).padStart(12, "0").slice(-12);
    return asAuditRecordId(`aud_${digits}`);
  };
}

// ---------------------------------------------------------------------------
// Hash chain
// ---------------------------------------------------------------------------

/**
 * Compute the content hash of an audit record (without its `recordHash`).
 * The hash binds the full record content INCLUDING `priorRecordHash`, so
 * every record transitively commits to the entire chain before it.
 *
 * Pure and deterministic: the same record content + prior hash + hash
 * function produce the same digest, independent of property insertion
 * order (canonical JSON with recursively sorted keys).
 *
 * @param record the record content (any object satisfying HashableAuditRecord)
 * @param priorRecordHash the prior record's hash (genesis for the first)
 * @param hash the injected hash function
 * @returns the content hash
 */
export function computeRecordHash(
  record: HashableAuditRecord,
  hash: HashFn,
): string {
  const canonical = canonicalJson({
    id: record.id,
    sequence: record.sequence,
    tenantId: record.tenantId,
    actor: record.actor,
    action: record.action,
    occurredAt: record.occurredAt,
    source: record.source,
    outcome: record.outcome,
    correlationId: record.correlationId,
    causationId: record.causationId,
    relatedEventIds: record.relatedEventIds,
    details: record.details,
    guardianDecision: record.guardianDecision,
    priorRecordHash: record.priorRecordHash,
  });
  return hash(canonical);
}

/** The verification failure modes, machine-stable. */
export type AuditVerificationFailureKind =
  | "empty_chain"
  | "hash_mismatch"
  | "chain_break"
  | "sequence_gap"
  | "tenant_mismatch";

/**
 * The result of a verification walk. On failure, `atSequence` names the
 * first offending record and `expected`/`actual` carry the differing digests
 * where applicable.
 */
export type AuditVerificationResult =
  | { readonly ok: true; readonly records: number; readonly headHash: string }
  | {
      readonly ok: false;
      readonly kind: AuditVerificationFailureKind;
      readonly atSequence: number;
      readonly expected?: string;
      readonly actual?: string;
    };

/**
 * The tampering-detection verification walk over a chain of records.
 *
 * Per record (in order), the walk checks — and reports the FIRST failure:
 *   1. `tenant_mismatch` — a record whose tenant differs from the first
 *      record's (a spliced foreign record);
 *   2. `sequence_gap` — `records[i].sequence !== i + 1` (a removed or
 *      reordered record);
 *   3. `chain_break` — `priorRecordHash` does not equal the previous
 *      record's `recordHash` (or genesis for the first record);
 *   4. `hash_mismatch` — the recomputed content hash differs from the
 *      stored `recordHash` (the record's content was tampered with).
 *
 * An empty chain is reported as `empty_chain` (callers decide whether that
 * is a failure — the `AuditLog.verify` wrapper treats it as ok with zero
 * records; this pure function reports it so hand-built chains cannot skip
 * the check).
 *
 * Pure: the input array is never mutated.
 *
 * @param records the chain to verify (ordered by sequence)
 * @param hash the injected hash function (MUST match the one used at append)
 * @returns the tagged verification result
 */
export function verifyAuditChain(
  records: readonly AuditRecord[],
  hash: HashFn,
): AuditVerificationResult {
  if (records.length === 0) {
    return { ok: false, kind: "empty_chain", atSequence: 0 };
  }
  const chainTenant = records[0]?.tenantId;
  let previousHash: string = AUDIT_GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined) continue; // unreachable; satisfies noUncheckedIndexedAccess-style readers
    const position = i + 1;
    if (record.tenantId !== chainTenant) {
      return {
        ok: false,
        kind: "tenant_mismatch",
        atSequence: record.sequence,
        expected: chainTenant,
        actual: record.tenantId,
      };
    }
    if (record.sequence !== position) {
      return {
        ok: false,
        kind: "sequence_gap",
        atSequence: record.sequence,
        expected: String(position),
        actual: String(record.sequence),
      };
    }
    if (record.priorRecordHash !== previousHash) {
      return {
        ok: false,
        kind: "chain_break",
        atSequence: record.sequence,
        expected: previousHash,
        actual: record.priorRecordHash,
      };
    }
    const recomputed = computeRecordHash(record, hash);
    if (recomputed !== record.recordHash) {
      return {
        ok: false,
        kind: "hash_mismatch",
        atSequence: record.sequence,
        expected: record.recordHash,
        actual: recomputed,
      };
    }
    previousHash = record.recordHash;
  }
  const last = records[records.length - 1];
  return {
    ok: true,
    records: records.length,
    headHash: last === undefined ? AUDIT_GENESIS_HASH : last.recordHash,
  };
}

/**
 * Convenience constructor for a frozen `AuditActorRef`.
 *
 * @param kind the actor kind
 * @param principalId the stable principal identifier
 * @param tenantId the tenant scope
 * @returns a frozen AuditActorRef
 */
export function makeAuditActorRef(
  kind: AuditActorKind,
  principalId: string,
  tenantId: TenantId,
): AuditActorRef {
  return frozen({ kind, principalId, tenantId });
}
