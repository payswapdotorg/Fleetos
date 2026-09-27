/**
 * @fleetos/integration-aurum — D1: the versioned append-only outbox ledger.
 *
 * The outbox is FleetOS's durable record of WHAT it asked Aurum to
 * communicate. Entries are append-only and versioned (schema-versioned
 * records; a later payload shape appends schema v2 — the prior is never
 * rewritten); per-tenant sequences are 1-based and GAPLESS (the audit-log
 * discipline); ids and digests are deterministic (the intent's
 * `messageId` + `contentDigest` — pure functions of the identity tuple
 * and the derived post-redaction content).
 *
 * Idempotency: re-appending the SAME message identity (same
 * `messageId`) with the SAME content digest is a DUPLICATE no-op
 * (`{ ok: true, duplicate: true }`, nothing appended); the same
 * `messageId` with a DIFFERENT digest is refused with the
 * machine-stable invariant `content_digest_mismatch` — a tampering
 * signal, never silently rewritten.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, `packages/
 * identity` — same lane): every operation takes the acting
 * `TenantContext` FIRST; storage is partitioned per tenant; the runtime
 * guard (`requireTenantContext`) rejects context-free and
 * invalid-tenant access even when a caller bypasses the types; foreign
 * message ids are indistinguishable from unknown ones (no existence
 * side channel). The store audits NOTHING — the emission boundary
 * (emission.ts) owns ALL audit emissions (the W042 store pattern).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { FleetError, TenantId } from "@fleetos/contracts";
import type { TenantContext, TenantScopedStore, TenantStoreEntry } from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { CommunicationIntent } from "./intents";
import {
  AURUM_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  ERROR_CODES,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";

/** The outbox ledger-entry payload schema version. */
export const OUTBOX_ENTRY_SCHEMA_VERSION = 1 as const;

/**
 * One appended outbox entry: the frozen communication intent + the
 * per-tenant 1-based gapless sequence position.
 */
export interface OutboxEntry {
  /** 1-based, per-tenant, gapless position in the outbox. */
  readonly sequence: number;
  /** The tenant scope (mirrors the intent's; validated at append). */
  readonly tenantId: TenantId;
  /** The frozen communication intent. */
  readonly intent: CommunicationIntent;
  /** The ledger-entry payload schema version. */
  readonly schemaVersion: number;
}

/** The tagged result of an outbox append. */
export type OutboxAppendResult =
  | { readonly ok: true; readonly entry: OutboxEntry; readonly duplicate: boolean }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only outbox ledger. Every operation takes
 * the acting `TenantContext` as its FIRST parameter and touches only the
 * acting tenant's partition. There is NO update and NO delete — the
 * ledger is append-only by construction.
 */
export interface OutboxLedger {
  /** Append a message (idempotent by messageId + digest; refuses tampering). */
  append(ctx: TenantContext, intent: CommunicationIntent): OutboxAppendResult;
  /** One entry by message id (own partition only; foreign = unknown). */
  get(ctx: TenantContext, messageId: string): OutboxEntry | undefined;
  /** Every entry in the acting partition, sequence order. */
  list(ctx: TenantContext): readonly OutboxEntry[];
  /** The number of entries in the acting partition. */
  size(ctx: TenantContext): number;
}

/**
 * The in-memory reference outbox ledger, extended with the raw
 * tenant-scoped KV view (for W012's reusable isolation harness).
 */
export interface InMemoryOutboxLedger extends OutboxLedger {
  readonly tenantScopedView: TenantScopedStore<OutboxEntry>;
}

/**
 * Create the in-memory reference `OutboxLedger`.
 *
 * Judgment call (documented, mirrors W032/W042's stores): the ledger
 * maintains TWO separate per-tenant partition maps:
 *   1. the RICH ledger's `Map<messageId, entries[]>` — the domain
 *      ledger, keyed by the intent's deterministic `messageId`;
 *   2. the RAW KV view's `Map<key, entry>` — the W012 isolation-harness
 *      view, keyed by the harness's caller-supplied key (which may be
 *      any non-empty string — the harness uses fixed "k1"/"k2" keys).
 *
 * The intent's `messageId` is computed deterministically (an
 * `aurum_msg_<hash>` string), so it cannot be controlled by the
 * harness's caller-supplied key; sharing partitions would break the
 * harness's reference-equality check.
 */
export function createInMemoryOutboxLedger(): InMemoryOutboxLedger {
  /** tenantId -> (messageId -> entries, append order). */
  const partitions = new Map<string, Map<string, OutboxEntry[]>>();
  /** tenantId -> (key -> entry) — the raw KV view (W012 harness). */
  const rawPartitions = new Map<string, Map<string, OutboxEntry>>();

  function partitionOf(tenantId: TenantId): Map<string, OutboxEntry[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, OutboxEntry[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function rawPartitionOf(tenantId: TenantId): Map<string, OutboxEntry> {
    let partition = rawPartitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, OutboxEntry>();
      rawPartitions.set(tenantId, partition);
    }
    return partition;
  }

  const rich: OutboxLedger = frozen({
    append(ctx: TenantContext, intent: CommunicationIntent): OutboxAppendResult {
      const tenantId = requireTenantContext(ctx);
      if (
        typeof intent !== "object" ||
        intent === null ||
        typeof intent.messageId !== "string" ||
        intent.messageId.length === 0 ||
        typeof intent.contentDigest !== "string" ||
        intent.contentDigest.length === 0
      ) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.outboxDomain,
            "outbox append requires a well-formed communication intent",
            { tenantId, correlationId: AURUM_PIPELINE_CORRELATION_ID },
            "aurum.outbox",
            "intent_invalid",
          ),
        };
      }
      if (intent.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.outboxDomain,
            "outbox append refused: intent tenantId does not match the acting context",
            { tenantId, correlationId: AURUM_PIPELINE_CORRELATION_ID },
            "aurum.outbox",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const existing = partition.get(intent.messageId);
      if (existing !== undefined && existing.length > 0) {
        const prior = existing[0] as OutboxEntry;
        if (prior.intent.contentDigest === intent.contentDigest) {
          // Idempotent duplicate: the same identity + the same content.
          // Nothing is appended (the ledger is append-only; a duplicate
          // is not a mutation).
          return { ok: true, entry: prior, duplicate: true };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.outboxDomain,
            "outbox append refused: message identity re-emitted with different content",
            { tenantId, correlationId: AURUM_PIPELINE_CORRELATION_ID },
            "aurum.outbox",
            "content_digest_mismatch",
          ),
        };
      }
      const sequence = (() => {
        let max = 0;
        for (const entries of partition.values()) {
          if (entries.length > 0) {
            const last = entries[entries.length - 1] as OutboxEntry;
            if (last.sequence > max) max = last.sequence;
          }
        }
        return max + 1;
      })();
      const entry: OutboxEntry = frozen({
        sequence,
        tenantId,
        intent: frozen({ ...intent }),
        schemaVersion: OUTBOX_ENTRY_SCHEMA_VERSION,
      });
      partition.set(intent.messageId, [entry]);
      return { ok: true, entry, duplicate: false };
    },

    get(ctx: TenantContext, messageId: string): OutboxEntry | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof messageId !== "string" || messageId.length === 0) return undefined;
      const entries = partitions.get(tenantId)?.get(messageId);
      if (entries === undefined || entries.length === 0) return undefined;
      return entries[0];
    },

    list(ctx: TenantContext): readonly OutboxEntry[] {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      const all: OutboxEntry[] = [];
      for (const entries of partition.values()) {
        for (const entry of entries) all.push(entry);
      }
      all.sort((a, b) => a.sequence - b.sequence);
      return frozenArray(all);
    },

    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      const partition = partitions.get(tenantId);
      if (partition === undefined) return 0;
      let count = 0;
      for (const entries of partition.values()) {
        if (entries.length > 0) count += 1;
      }
      return count;
    },
  });

  // The raw KV view — SEPARATE partitions (judgment call above). The
  // view uses the harness's caller-supplied key directly; the W012
  // isolation-harness contract: `put(ctx, key, value)` round-trips a
  // value under a key, and `list(ctx)` returns the entries with the
  // SAME keys used in `put`.
  const tenantScopedView: TenantScopedStore<OutboxEntry> = frozen({
    put(ctx: TenantContext, key: string, value: OutboxEntry): void {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("tenantScopedView: key must be a non-empty string");
      }
      if (typeof value !== "object" || value === null) {
        throw new TypeError("tenantScopedView: value must be an OutboxEntry object");
      }
      rawPartitionOf(tenantId).set(key, value);
    },
    get(ctx: TenantContext, key: string): OutboxEntry | undefined {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return undefined;
      return rawPartitions.get(tenantId)?.get(key);
    },
    has(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.has(key) ?? false;
    },
    remove(ctx: TenantContext, key: string): boolean {
      const tenantId = requireTenantContext(ctx);
      if (typeof key !== "string" || key.length === 0) return false;
      return rawPartitions.get(tenantId)?.delete(key) ?? false;
    },
    list(ctx: TenantContext): readonly TenantStoreEntry<OutboxEntry>[] {
      const tenantId = requireTenantContext(ctx);
      const partition = rawPartitions.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      return frozenArray(
        [...partition.entries()]
          .map(([key, value]) => frozen({ key, value }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      );
    },
    size(ctx: TenantContext): number {
      const tenantId = requireTenantContext(ctx);
      return rawPartitions.get(tenantId)?.size ?? 0;
    },
  });

  return frozen({ ...rich, tenantScopedView });
}

/** Project the in-memory ledger's view for W012's isolation harness. */
export function asTenantScopedOutboxStore(
  ledger: InMemoryOutboxLedger,
): TenantScopedStore<OutboxEntry> {
  return ledger.tenantScopedView;
}

/**
 * The derived delivery-readiness summary of an outbox partition (a pure
 * read for binding sites; never audited).
 */
export interface OutboxSummary {
  readonly total: number;
  readonly byKind: Readonly<Record<string, number>>;
}

/**
 * Summarize an outbox partition by message kind (pure read; kinds in
 * first-appearance sequence order for deterministic rendering).
 *
 * @param entries the partition's entries (sequence order)
 * @returns the frozen summary
 */
export function summarizeOutbox(entries: readonly OutboxEntry[]): OutboxSummary {
  const byKind: Record<string, number> = {};
  for (const entry of entries) {
    const kind = entry.intent.kind;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return frozen({ total: entries.length, byKind: frozen({ ...byKind }) });
}

/** Re-exported for boundary error traces (the synthetic system tenant). */
export { SYNTHETIC_SYSTEM_TENANT_ID };
