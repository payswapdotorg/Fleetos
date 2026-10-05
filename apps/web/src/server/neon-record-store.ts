/**
 * @fleetos/web — W140: the request-scoped Neon `DurableRecordStore`.
 *
 * SERVER-ONLY (apps/web/src/server).
 *
 * THE BRIDGE between the frozen SYNCHRONOUS `DurableRecordStore` seam
 * (`@fleetos/identity`) and the ASYNC fetch-based Neon driver. The
 * seam's own law sanctions the design: "The seam is deliberately
 * SYNCHRONOUS and FLAT ... A real Neon binding may queue/batch
 * internally but MUST NOT drop or reorder writes."
 *
 * The request lifecycle (every API route follows it):
 *
 *   1. `createRequestScopedRecordStore({ driver, tenants })` — the
 *      async CONSTRUCTION preloads the managed tables' partitions for
 *      the acting tenants (plus the full workspace-invitation table —
 *      the frozen seam's system-level invitation index) into the
 *      request cache.
 *   2. The SYNC phase — the frozen identity/audit repositories and
 *      services run UNCHANGED over the store: reads hit the cache
 *      (read-your-writes), writes update the cache AND enqueue an
 *      ordered write op.
 *   3. `await flush()` — the ordered write log executes against the
 *      driver IN ORDER (no drops, no reordering, fail-closed on any
 *      refusal) BEFORE the route responds, so the next request's
 *      preload observes every write of this one.
 *
 * The sync surface implements the EXACT frozen contract: per-tenant
 * partitions, `already_exists` / `tenant_mismatch` refusals, the
 * `findInvitationByCodeHash` system-level exception, key validation —
 * all reusing the identity package's exported helpers so the semantics
 * cannot drift.
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */

import type {
  DurableListOptions,
  DurableRecordStore,
  DurableStoredRow,
  DurableWrite,
} from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type { DurableRow } from "@fleetos/identity";
import {
  checkRowTenant,
  durableAlreadyExists,
  invalidRowColumns,
  requireRowKey,
  requireTableName,
} from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { DurableDriver, DurableWriteOp } from "./durable-driver";
import { findServerDurableTable, SERVER_DURABLE_TABLE_NAMES } from "./server-tables";
import { frozen, frozenArray } from "./server-internal";

/** The frozen system-level invitation table (loaded across ALL tenants). */
const INVITATION_TABLE = "fleetos_workspace_invitations";

/** One cached row (mutable internally, frozen on read). */
interface CachedRow {
  readonly key: string;
  row: Record<string, string | number | boolean | null>;
}

/** One queued write op (the ordered write log's entry). */
type WriteOp =
  | { readonly kind: "insert"; readonly table: string; readonly key: string; readonly row: DurableRow }
  | { readonly kind: "put"; readonly table: string; readonly key: string; readonly row: DurableRow }
  | { readonly kind: "remove"; readonly table: string; readonly key: string; readonly tenantId: string };

/** Options for creating a request-scoped store. */
export interface RequestScopedStoreOptions {
  /** The durable driver (Neon in production; an in-memory fake in tests). */
  readonly driver: DurableDriver;
  /**
   * The tenants whose partitions are preloaded for every managed table
   * (the request's acting tenant(s)). The workspace-invitation table is
   * ALWAYS preloaded across all tenants (the frozen seam's system-level
   * invitation index).
   */
  readonly tenants: readonly string[];
}

/** The request-scoped store: the sync seam + the ordered `flush`. */
export interface RequestScopedRecordStore {
  /** The synchronous frozen `DurableRecordStore` (this request's view). */
  readonly store: DurableRecordStore;
  /**
   * Execute the ordered write log against the driver. Resolves when
   * every queued write has been applied IN ORDER; rejects on the first
   * refusal (fail-closed — no write is ever silently dropped).
   */
  flush(): Promise<void>;
  /** The number of queued write ops (diagnostics/tests). */
  readonly pendingWrites: number;
}

/**
 * Create the request-scoped record store (async construction — the
 * preload). The managed tables are the server plane's physical tables.
 */
export async function createRequestScopedRecordStore(
  options: RequestScopedStoreOptions,
): Promise<RequestScopedRecordStore> {
  const driver = options.driver;
  const preloadTenants: readonly string[] = [...new Set(options.tenants)];

  /** table -> tenantId -> (key -> CachedRow). */
  const tables = new Map<string, Map<string, Map<string, CachedRow>>>();
  /** The system-level invitation index (all tenants, by code hash). */
  const invitationIndex = new Map<string, CachedRow>();
  /** The ordered write log. */
  const writeLog: WriteOp[] = [];

  function partitionOf(table: string, tenantId: string): Map<string, CachedRow> {
    let perTenant = tables.get(table);
    if (perTenant === undefined) {
      perTenant = new Map<string, Map<string, CachedRow>>();
      tables.set(table, perTenant);
    }
    let partition = perTenant.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, CachedRow>();
      perTenant.set(tenantId, partition);
    }
    return partition;
  }

  /** Build the physical WHERE record for a (tenant, key) row address. */
  function whereForKey(
    table: string,
    tenantId: string,
    key: string,
  ): Record<string, string> | undefined {
    const def = findServerDurableTable(table);
    if (def === undefined) return undefined;
    const pk = def.primaryKey;
    // A tenant-only pk (e.g. the tenants table): the row IS the tenant's.
    if (pk.length === 1) {
      return pk[0] === "tenant_id" ? { tenant_id: tenantId } : undefined;
    }
    const values = key.split("::");
    const pkColumns = pk.slice(1);
    if (pkColumns.length !== values.length) return undefined;
    const where: Record<string, string> = { tenant_id: tenantId };
    for (let i = 0; i < pkColumns.length; i += 1) {
      where[pkColumns[i]!] = values[i]!;
    }
    return where;
  }

  function toStoredRow(entry: CachedRow): DurableStoredRow {
    return frozen({ key: entry.key, row: frozen({ ...entry.row }) });
  }

  function indexInvitation(table: string, entry: CachedRow): void {
    if (table === INVITATION_TABLE && typeof entry.row["code_hash"] === "string") {
      invitationIndex.set(entry.row["code_hash"], entry);
    }
  }

  // ---- Phase 1: the preload -------------------------------------------
  for (const table of SERVER_DURABLE_TABLE_NAMES) {
    for (const tenantId of preloadTenants) {
      const rows = await driver.loadPartition(table, tenantId);
      const partition = partitionOf(table, tenantId);
      for (const row of rows) {
        const key = seamKeyOf(table, row);
        if (key === undefined) continue;
        const entry: CachedRow = { key, row: { ...row } };
        partition.set(key, entry);
        indexInvitation(table, entry);
      }
    }
  }
  // The invitation index spans ALL tenants (the frozen system-level
  // exception): rows of tenants outside the preload set are loaded too.
  for (const row of await driver.loadTable(INVITATION_TABLE)) {
    const key = seamKeyOf(INVITATION_TABLE, row);
    if (key === undefined) continue;
    const tenantId = typeof row["tenant_id"] === "string" ? row["tenant_id"] : undefined;
    if (tenantId === undefined || preloadTenants.includes(tenantId)) continue;
    const entry: CachedRow = { key, row: { ...row } };
    partitionOf(INVITATION_TABLE, tenantId).set(key, entry);
    indexInvitation(INVITATION_TABLE, entry);
  }

  // ---- Phase 2: the sync surface (the frozen seam, verbatim) ----------
  const store: DurableRecordStore = frozen({
    insert(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const offenders = invalidRowColumns(row);
      if (offenders.length > 0) {
        throw new TypeError(
          `DurableRecordStore: ${table_} row carries non-durable values in: ${offenders.join(", ")}`,
        );
      }
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
      const entry: CachedRow = { key: key_, row: { ...row } };
      partition.set(key_, entry);
      indexInvitation(table_, entry);
      writeLog.push({ kind: "insert", table: table_, key: key_, row: frozen({ ...row }) });
      return { ok: true };
    },

    put(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const offenders = invalidRowColumns(row);
      if (offenders.length > 0) {
        throw new TypeError(
          `DurableRecordStore: ${table_} row carries non-durable values in: ${offenders.join(", ")}`,
        );
      }
      const tenantFailure = checkRowTenant(tenantId, row, table_);
      if (tenantFailure !== undefined) return tenantFailure;

      const partition = partitionOf(table_, tenantId);
      const prior = partition.get(key_);
      if (
        table_ === INVITATION_TABLE &&
        prior !== undefined &&
        typeof prior.row["code_hash"] === "string" &&
        typeof row["code_hash"] === "string" &&
        prior.row["code_hash"] !== row["code_hash"]
      ) {
        invitationIndex.delete(prior.row["code_hash"]);
      }
      const entry: CachedRow = { key: key_, row: { ...row } };
      partition.set(key_, entry);
      indexInvitation(table_, entry);
      writeLog.push({ kind: "put", table: table_, key: key_, row: frozen({ ...row }) });
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
        table_ === INVITATION_TABLE &&
        typeof entry.row["code_hash"] === "string" &&
        invitationIndex.get(entry.row["code_hash"])?.key === key_
      ) {
        invitationIndex.delete(entry.row["code_hash"]);
      }
      writeLog.push({ kind: "remove", table: table_, key: key_, tenantId });
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
  });

  // ---- Phase 3: the atomic ordered flush -------------------------------
  async function flush(): Promise<void> {
    if (writeLog.length === 0) return;
    const ops: DurableWriteOp[] = [];
    for (const op of writeLog) {
      if (op.kind === "insert") {
        ops.push({ kind: "insert", table: op.table, row: op.row });
      } else if (op.kind === "put") {
        ops.push({ kind: "upsert", table: op.table, row: op.row });
      } else {
        const where = whereForKey(op.table, op.tenantId, op.key);
        if (where === undefined) {
          throw new TypeError(
            `RequestScopedStore.flush: cannot address ${op.table} key ${op.key}`,
          );
        }
        ops.push({ kind: "delete", table: op.table, where });
      }
    }
    // ONE atomic transaction: all-or-nothing, in queue order. A
    // refusal throws and leaves NO partial state (fail-closed).
    await driver.applyWrites(ops);
    writeLog.length = 0;
  }

  return frozen({
    store,
    flush,
    get pendingWrites(): number {
      return writeLog.length;
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the seam key of a loaded row: the physical pk column values
 * AFTER the leading `tenant_id` partition column, joined with the seam
 * separator. A tenant-only pk (the tenants table's `[tenant_id]`) keys
 * the row by the tenant id itself — the frozen tenant repository's
 * convention. An INTEGER pk value is zero-padded to 10 digits (the
 * frozen audit log's `sequenceKey` convention), so a preloaded row's
 * derived key is IDENTICAL to the key its repository would insert
 * under (the within-request duplicate check stays honest).
 */
function seamKeyOf(table: string, row: DurableRow): string | undefined {
  const def = findServerDurableTable(table);
  if (def === undefined) return undefined;
  const pk = def.primaryKey;
  const keyColumns = pk.length === 1 ? pk : pk.slice(1);
  const values: string[] = [];
  for (const column of keyColumns) {
    const value = row[column];
    if (value === undefined || value === null) return undefined;
    const columnDef = def.columns.find((c) => c.name === column);
    if (columnDef?.type === "integer" && typeof value === "number") {
      values.push(String(value).padStart(10, "0"));
    } else {
      values.push(String(value));
    }
  }
  return values.join("::");
}
