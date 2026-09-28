/**
 * @fleetos/integration-convergence — D4: integration evidence.
 *
 * The append-only, per-tenant, hash-chained evidence ledger for every
 * integration-adapter effect:
 *
 *   - `createIntegrationEvidenceLedger()` → `recorderFor(scope)` /
 *     `readerFor(scope)` — the per-tenant closures are ISOLATED BY
 *     CONSTRUCTION: a recorder/reader can only ever touch its OWN
 *     tenant's partition (there is no foreign-tenant API on the
 *     surface at all);
 *   - every record carries the FNV-1a canonical-JSON `payloadDigest`
 *     (over `details`) and `recordHash` (over the record content incl.
 *     the prior hash — the chain);
 *   - `verifyEvidenceChain(reader)` — the tamper-detection walk:
 *     gapless sequences, prior-hash linkage, record-hash and
 *     payload-digest recomputation. Any tampering is reported with the
 *     machine-stable reason and the sequence it was detected at.
 *
 * Pure: no clock reads (instants are injected), no entropy, no runtime
 * dependencies. Strict TS; no `any`.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";
import {
  canonicalJson,
  checkConvergenceTenantScope,
  fnv1a32Hex,
  frozen,
  frozenArray,
  type ConvergenceTenantScope,
} from "./internal";

/** The genesis sentinel for chain position #1 (the audit package's convention). */
export const EVIDENCE_GENESIS_HASH = "genesis" as const;

/** The evidence record schema version. */
export const INTEGRATION_EVIDENCE_SCHEMA_VERSION = 1 as const;

/** One append-only evidence record (per-tenant, hash-chained). */
export interface IntegrationEvidenceRecord {
  /** The owning tenant. */
  readonly tenantId: TenantId;
  /** 1-based, per-tenant, gapless chain position. */
  readonly sequence: number;
  /** The adapter the effect rode through ("adcos" / "arena" / "aurum" / ...). */
  readonly adapter: string;
  /** The machine-stable action (e.g. "connectivity.submitted"). */
  readonly action: string;
  /** The injected occurrence instant (ISO 8601). */
  readonly occurredAt: string;
  /** Correlation id threading the causal graph. */
  readonly correlationId: CorrelationId;
  /** JSON-serializable action context (counts, digests, revisions). */
  readonly details: Readonly<Record<string, unknown>>;
  /** FNV-1a over canonicalJson(details). */
  readonly payloadDigest: string;
  /** The PRIOR record's hash in this tenant's chain (genesis for #1). */
  readonly priorHash: string;
  /** FNV-1a over the canonical record content (sans recordHash). */
  readonly recordHash: string;
}

/** The append input (the ledger assigns sequence + hashes). */
export interface IntegrationEvidenceAppendInput {
  readonly adapter: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly details: Readonly<Record<string, unknown>>;
}

/** The tagged append result (machine-stable refusal reasons). */
export type IntegrationEvidenceAppendResult =
  | { readonly ok: true; readonly record: IntegrationEvidenceRecord }
  | { readonly ok: false; readonly reason: string };

/** The per-tenant recorder (own partition only — by construction). */
export interface IntegrationEvidenceRecorder {
  /** The owning tenant. */
  readonly tenantId: TenantId;
  /** Append one record (assigns sequence + digests + chain linkage). */
  append(input: IntegrationEvidenceAppendInput): IntegrationEvidenceAppendResult;
  /** The latest record (null on an empty chain). */
  head(): IntegrationEvidenceRecord | null;
  /** The chain length. */
  size(): number;
}

/** The per-tenant reader (own partition only — by construction). */
export interface IntegrationEvidenceReader {
  /** The owning tenant. */
  readonly tenantId: TenantId;
  /** Every record in this tenant's chain, sequence order. */
  records(): readonly IntegrationEvidenceRecord[];
  /** One record by sequence (undefined when absent — own partition only). */
  at(sequence: number): IntegrationEvidenceRecord | undefined;
  /** The chain length. */
  size(): number;
}

/** The ledger factory product: per-tenant recorders + readers. */
export interface IntegrationEvidenceLedger {
  /** A recorder bound to the acting scope's tenant (isolated by construction). */
  recorderFor(scope: ConvergenceTenantScope): IntegrationEvidenceRecorder;
  /** A reader bound to the acting scope's tenant (isolated by construction). */
  readerFor(scope: ConvergenceTenantScope): IntegrationEvidenceReader;
}

/** The chain verification result. */
export type ChainVerification =
  | { readonly ok: true; readonly tenantId: TenantId; readonly size: number }
  | { readonly ok: false; readonly tenantId: TenantId; readonly atSequence: number; readonly reason: string };

/** The record content that the record hash covers (sans recordHash). */
function recordHashContent(record: Omit<IntegrationEvidenceRecord, "recordHash">): string {
  return canonicalJson({
    action: record.action,
    adapter: record.adapter,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt,
    payloadDigest: record.payloadDigest,
    priorHash: record.priorHash,
    sequence: record.sequence,
    tenantId: record.tenantId,
  });
}

/** Validate an append input (pure, non-throwing, machine-stable reasons). */
function validateAppendInput(input: IntegrationEvidenceAppendInput): string | null {
  if (input === null || typeof input !== "object") return "input_required";
  if (typeof input.adapter !== "string" || input.adapter.length === 0) return "adapter_required";
  if (typeof input.action !== "string" || input.action.length === 0) return "action_required";
  if (typeof input.occurredAt !== "string" || input.occurredAt.length === 0) return "occurred_at_required";
  if (typeof input.correlationId !== "string" || input.correlationId.length === 0) return "correlation_id_required";
  if (input.details === null || typeof input.details !== "object" || Array.isArray(input.details)) {
    return "details_object_required";
  }
  try {
    canonicalJson(input.details);
  } catch {
    return "details_not_serializable";
  }
  return null;
}

/**
 * Create the in-memory reference evidence ledger. Per-tenant partitions;
 * the recorders/readers handed out by `recorderFor`/`readerFor` close
 * over exactly ONE partition — no foreign-tenant API exists on this
 * surface (isolation by construction).
 */
export function createIntegrationEvidenceLedger(): IntegrationEvidenceLedger {
  /** tenantId -> chain (append order). */
  const partitions = new Map<string, IntegrationEvidenceRecord[]>();

  function partitionOf(tenantId: TenantId): IntegrationEvidenceRecord[] {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = [];
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function appendTo(
    tenantId: TenantId,
    input: IntegrationEvidenceAppendInput,
  ): IntegrationEvidenceAppendResult {
    const failure = validateAppendInput(input);
    if (failure !== null) {
      return { ok: false, reason: failure };
    }
    const partition = partitionOf(tenantId);
    const sequence = partition.length + 1;
    const priorHash = partition.length > 0 ? partition[partition.length - 1].recordHash : EVIDENCE_GENESIS_HASH;
    const payloadDigest = fnv1a32Hex(canonicalJson(input.details));
    const withoutHash = frozen({
      tenantId,
      sequence,
      adapter: input.adapter,
      action: input.action,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      details: input.details,
      payloadDigest,
      priorHash,
    });
    const recordHash = fnv1a32Hex(recordHashContent(withoutHash));
    const record: IntegrationEvidenceRecord = frozen({ ...withoutHash, recordHash });
    partition.push(record);
    return { ok: true, record };
  }

  return frozen({
    recorderFor(scope: ConvergenceTenantScope): IntegrationEvidenceRecorder {
      const guard = checkConvergenceTenantScope(scope);
      if (!guard.ok) {
        throw new TypeError(`recorderFor: acting scope rejected (${guard.reason})`);
      }
      const tenantId = guard.tenantId;
      return frozen({
        tenantId,
        append: (input) => appendTo(tenantId, input),
        head: () => {
          const partition = partitionOf(tenantId);
          return partition.length > 0 ? partition[partition.length - 1] : null;
        },
        size: () => partitionOf(tenantId).length,
      });
    },
    readerFor(scope: ConvergenceTenantScope): IntegrationEvidenceReader {
      const guard = checkConvergenceTenantScope(scope);
      if (!guard.ok) {
        throw new TypeError(`readerFor: acting scope rejected (${guard.reason})`);
      }
      const tenantId = guard.tenantId;
      return frozen({
        tenantId,
        records: () => frozenArray(partitionOf(tenantId)),
        at: (sequence: number) => {
          if (!Number.isInteger(sequence) || sequence < 1) return undefined;
          const partition = partitionOf(tenantId);
          return sequence <= partition.length ? partition[sequence - 1] : undefined;
        },
        size: () => partitionOf(tenantId).length,
      });
    },
  });
}

/**
 * The tamper-detection walk over one tenant's chain (the reader's own
 * partition). Verifies, per record: gapless 1-based sequence, prior-hash
 * linkage (genesis for #1), record-hash recomputation, and
 * payload-digest recomputation from `details`. The FIRST violation is
 * reported with a machine-stable reason and the sequence it was
 * detected at.
 */
export function verifyEvidenceChain(reader: IntegrationEvidenceReader): ChainVerification {
  if (reader === null || typeof reader !== "object") {
    throw new TypeError("verifyEvidenceChain: reader required");
  }
  const records = reader.records();
  let priorHash: string = EVIDENCE_GENESIS_HASH;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const sequence = i + 1;
    if (record.sequence !== sequence) {
      return { ok: false, tenantId: reader.tenantId, atSequence: sequence, reason: "sequence_gap" };
    }
    if (record.tenantId !== reader.tenantId) {
      return { ok: false, tenantId: reader.tenantId, atSequence: sequence, reason: "tenant_mismatch" };
    }
    if (record.priorHash !== priorHash) {
      return { ok: false, tenantId: reader.tenantId, atSequence: sequence, reason: "prior_hash_mismatch" };
    }
    const recomputedPayload = fnv1a32Hex(canonicalJson(record.details));
    if (record.payloadDigest !== recomputedPayload) {
      return { ok: false, tenantId: reader.tenantId, atSequence: sequence, reason: "payload_digest_mismatch" };
    }
    const recomputedRecord = fnv1a32Hex(
      recordHashContent({
        tenantId: record.tenantId,
        sequence: record.sequence,
        adapter: record.adapter,
        action: record.action,
        occurredAt: record.occurredAt,
        correlationId: record.correlationId,
        details: record.details,
        payloadDigest: record.payloadDigest,
        priorHash: record.priorHash,
      }),
    );
    if (record.recordHash !== recomputedRecord) {
      return { ok: false, tenantId: reader.tenantId, atSequence: sequence, reason: "record_hash_mismatch" };
    }
    priorHash = record.recordHash;
  }
  return { ok: true, tenantId: reader.tenantId, size: records.length };
}
