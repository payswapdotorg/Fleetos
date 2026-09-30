/**
 * @fleetos/identity — the in-memory reference `DurableRecordStore`
 * (W100C D1).
 *
 * Serves the local tier (FREE-TIER-PROVIDER-MATRIX.md — "local/in-memory
 * adapters; deterministic demo tenant") and the deterministic test
 * suite. Storage is partitioned PER TABLE PER TENANT: a tenant-A context
 * can never observe tenant-B rows because the only partition its
 * operations address is its own.
 *
 * The W102 [TL] Neon binding implements the same `DurableRecordStore`
 * interface over the real database; until then this reference keeps the
 * repositories fully exercisable — the repository code paths are
 * IDENTICAL whichever implementation is injected.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantContext } from "../tenant-context";
import { requireTenantContext } from "../tenant-context";
import { frozen, frozenArray } from "../internal";
import type {
  DurableListOptions,
  DurableRecordStore,
  DurableStoredRow,
  DurableWrite,
} from "./seam";
import {
  checkRowTenant,
  durableAlreadyExists,
  invalidRowColumns,
  requireRowKey,
  requireTableName,
} from "./seam";
import type { DurableRow } from "./tables";

/** A single stored row (mutable internally, frozen on read). */
interface StoredEntry {
  readonly key: string;
  readonly row: Record<string, string | number | boolean | null>;
}

/**
 * Create the in-memory reference `DurableRecordStore`.
 *
 * @returns the frozen store (plus a test-only `snapshot` accessor)
 */
export function createInMemoryDurableRecordStore(): DurableRecordStore & {
  /**
   * The full table-name -> tenant-id -> row map (test/diagnostic only;
   * frozen copies — never a mutation path).
   */
  readonly snapshot: Readonly<
    Record<string, Readonly<Record<string, readonly DurableStoredRow[]>>>
  >;
} {
  /** table -> tenantId -> (key -> row). */
  const tables = new Map<string, Map<string, Map<string, StoredEntry>>>();
  /** The system-level invitation index: codeHash -> entry (all tenants). */
  const invitationIndex = new Map<string, StoredEntry>();

  function partitionOf(table: string, tenantId: string): Map<string, StoredEntry> {
    let perTenant = tables.get(table);
    if (perTenant === undefined) {
      perTenant = new Map<string, Map<string, StoredEntry>>();
      tables.set(table, perTenant);
    }
    let partition = perTenant.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, StoredEntry>();
      perTenant.set(tenantId, partition);
    }
    return partition;
  }

  function toStoredRow(entry: StoredEntry): DurableStoredRow {
    return frozen({ key: entry.key, row: frozen({ ...entry.row }) });
  }

  function validateRow(table: string, row: DurableRow): void {
    const offenders = invalidRowColumns(row);
    if (offenders.length > 0) {
      throw new TypeError(
        `DurableRecordStore: ${table} row carries non-durable values in: ${offenders.join(", ")}`,
      );
    }
  }

  return frozen({
    insert(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      validateRow(table_, row);
      const tenantFailure = checkRowTenant(tenantId, row, table_);
      if (tenantFailure !== undefined) return tenantFailure;

      const partition = partitionOf(table_, tenantId);
      if (partition.has(key_)) {
        return {
          ok: false,
          error: durableAlreadyExists(table_, key_, tenantId, ctx.correlationId),
          reason: "already_exists",
        };
      }
      const entry: StoredEntry = { key: key_, row: { ...row } };
      partition.set(key_, entry);
      if (table_ === "fleetos_workspace_invitations" && typeof row["code_hash"] === "string") {
        invitationIndex.set(row["code_hash"], entry);
      }
      return { ok: true };
    },

    put(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      validateRow(table_, row);
      const tenantFailure = checkRowTenant(tenantId, row, table_);
      if (tenantFailure !== undefined) return tenantFailure;

      const partition = partitionOf(table_, tenantId);
      // Maintain the invitation index on upsert too (a re-put of the same
      // invitation id keeps one index entry per code hash).
      if (table_ === "fleetos_workspace_invitations" && typeof row["code_hash"] === "string") {
        const prior = partition.get(key_);
        if (prior !== undefined && typeof prior.row["code_hash"] === "string") {
          if (prior.row["code_hash"] !== row["code_hash"]) {
            invitationIndex.delete(prior.row["code_hash"]);
          }
        }
        invitationIndex.set(row["code_hash"], { key: key_, row: { ...row } });
      }
      partition.set(key_, { key: key_, row: { ...row } });
      return { ok: true };
    },

    get(ctx: TenantContext, table: string, key: string): DurableStoredRow | undefined {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const entry = tables.get(table_)?.get(tenantId)?.get(key_);
      return entry === undefined ? undefined : toStoredRow(entry);
    },

    list(
      ctx: TenantContext,
      table: string,
      opts?: DurableListOptions,
    ): readonly DurableStoredRow[] {
      const table_ = requireTableName(table);
      const tenantId = requireTenantContext(ctx);
      const partition = tables.get(table_)?.get(tenantId);
      if (partition === undefined) return frozenArray([]);
      const prefix = opts?.prefix;
      const where = opts?.where;
      const rows: DurableStoredRow[] = [];
      for (const entry of [...partition.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (prefix !== undefined && !entry[0].startsWith(prefix)) continue;
        if (where !== undefined) {
          let matches = true;
          for (const [column, value] of Object.entries(where)) {
            if (entry[1].row[column] !== value) {
              matches = false;
              break;
            }
          }
          if (!matches) continue;
        }
        rows.push(toStoredRow(entry[1]));
      }
      return frozenArray(rows);
    },

    remove(ctx: TenantContext, table: string, key: string): boolean {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const partition = tables.get(table_)?.get(tenantId);
      const entry = partition?.get(key_);
      if (entry === undefined) return false;
      partition?.delete(key_);
      if (
        table_ === "fleetos_workspace_invitations" &&
        typeof entry.row["code_hash"] === "string"
      ) {
        // Only drop the index entry when it still points at this row.
        const indexed = invitationIndex.get(entry.row["code_hash"]);
        if (indexed !== undefined && indexed.key === key_) {
          invitationIndex.delete(entry.row["code_hash"]);
        }
      }
      return true;
    },

    count(ctx: TenantContext, table: string): number {
      const table_ = requireTableName(table);
      const tenantId = requireTenantContext(ctx);
      return tables.get(table_)?.get(tenantId)?.size ?? 0;
    },

    findInvitationByCodeHash(codeHash: string): DurableStoredRow | undefined {
      if (typeof codeHash !== "string" || codeHash.length === 0) return undefined;
      const entry = invitationIndex.get(codeHash);
      return entry === undefined ? undefined : toStoredRow(entry);
    },

    get snapshot(): Readonly<Record<string, Readonly<Record<string, readonly DurableStoredRow[]>>>> {
      const out: Record<string, Record<string, readonly DurableStoredRow[]>> = {};
      for (const [table, perTenant] of tables.entries()) {
        const perTable: Record<string, readonly DurableStoredRow[]> = {};
        for (const [tenantId, partition] of perTenant.entries()) {
          perTable[tenantId] = Object.freeze(
            [...partition.values()]
              .sort((a, b) => (a.key < b.key ? -1 : 1))
              .map(toStoredRow),
          );
        }
        out[table] = Object.freeze(perTable);
      }
      return frozen(out);
    },
  });
}
