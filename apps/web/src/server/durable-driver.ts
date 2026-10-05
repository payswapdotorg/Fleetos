/**
 * @fleetos/web — W140: the server-plane durable driver seam + the Neon
 * adapter (the ONLY module that imports `@neondatabase/serverless`).
 *
 * SERVER-ONLY. This module (and every module that imports it) lives in
 * apps/web/src/server and is imported exclusively by API route handlers
 * — never from a client bundle (proven by the import-boundary test in
 * apps/web/test/server-isolation.test.ts).
 *
 * THE SEAM (`DurableDriver`): the minimal async surface the
 * request-scoped record store needs — partition/table loads, a
 * cross-tenant indexed lookup (the trust-token path — the same
 * documented exception shape as the identity seam's invitation
 * resolver), ONE atomic ordered write batch, and idempotent schema
 * application. Tests bind an in-memory fake; the Neon adapter speaks
 * real SQL through the fetch-based `@neondatabase/serverless` driver
 * over DATABASE_URL.
 *
 * ATOMICITY: `applyWrites` executes the ordered batch as a SINGLE
 * non-interactive Postgres transaction (`sql.transaction([...])`) —
 * all-or-nothing. The frozen seam law ("MUST NOT drop or reorder
 * writes") is thereby strengthened: a failed batch leaves NO partial
 * state, and the order inside the batch is the queue order.
 *
 * THE ENV LAW: DATABASE_URL is read through `resolveDatabaseUrl()` at
 * REQUEST time (never inlined, never logged, never echoed in a
 * response — the env module law: NAMES may surface, VALUES never).
 *
 * Value discipline (the frozen seam's rule): rows are FLAT
 * (`string | number | boolean | null`). `jsonb` columns carry
 * canonical-JSON TEXT at the seam; the adapter casts text→jsonb on
 * write and re-serializes parsed jsonb objects back to canonical text
 * on read, so the frozen repositories (e.g. the audit log's
 * `rowToRecord`) work unchanged over real Postgres.
 *
 * No `any` in public signatures. Strict TS.
 */

import { neon } from "@neondatabase/serverless";
import type { DurableRow, DurableValue } from "@fleetos/identity";
import { findServerDurableTable } from "./server-tables";
import { canonicalJson, frozen } from "./server-internal";

// ---------------------------------------------------------------------------
// The write-op union (the atomic batch's elements)
// ---------------------------------------------------------------------------

/** One semantic write. `insert` conflicts THROW (fail-closed, never a silent drop). */
export type DurableWriteOp =
  | { readonly kind: "insert"; readonly table: string; readonly row: DurableRow }
  | { readonly kind: "upsert"; readonly table: string; readonly row: DurableRow }
  | { readonly kind: "delete"; readonly table: string; readonly where: Readonly<Record<string, string>> };

// ---------------------------------------------------------------------------
// The driver seam
// ---------------------------------------------------------------------------

/**
 * The async durable-driver seam. Implementations MUST preserve write
 * order, apply each batch atomically (all-or-nothing), and fail closed
 * (a refused write throws — never a silent drop).
 */
export interface DurableDriver {
  /** Load every row of one table's tenant partition. */
  loadPartition(table: string, tenantId: string): Promise<readonly DurableRow[]>;
  /** Load EVERY row of one table, all tenants (the invitation index path). */
  loadTable(table: string): Promise<readonly DurableRow[]>;
  /**
   * Load the first row where `column` equals `value` (ALL tenants —
   * the documented cross-tenant lookup for opaque-token resolution;
   * reveals nothing beyond the one matched row).
   */
  loadRowWhere(table: string, column: string, value: string): Promise<DurableRow | null>;
  /**
   * Apply an ordered batch of writes as ONE atomic transaction. A
   * conflict or error throws and leaves NO partial state.
   */
  applyWrites(writes: readonly DurableWriteOp[]): Promise<void>;
  /** Apply idempotent DDL statements (CREATE TABLE IF NOT EXISTS ...). */
  applySchema(statements: readonly string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// The DATABASE_URL seam (the env module law: names, never values)
// ---------------------------------------------------------------------------

/** The env NAME the Neon driver binds (values never surface). */
export const DATABASE_URL_ENV_NAME = "DATABASE_URL" as const;

/**
 * Resolve the database URL at REQUEST time. Undefined when absent —
 * the control plane then refuses machine-stably (fail-closed: the
 * server tier is NEVER silently replaced by an in-memory fabrication).
 */
export function resolveDatabaseUrl(): string | undefined {
  const raw = process.env[DATABASE_URL_ENV_NAME];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

// ---------------------------------------------------------------------------
// SQL rendering (shared by the write paths)
// ---------------------------------------------------------------------------

/** The name-prefix every FleetOS durable table carries (guard). */
const TABLE_PREFIX = "fleetos_";

/** Is this table managed by the server plane? (Guard against typos.) */
function requireManagedTable(table: string): string {
  if (!table.startsWith(TABLE_PREFIX)) {
    throw new TypeError(`NeonDriver: unmanaged table "${table}"`);
  }
  if (findServerDurableTable(table) === undefined) {
    throw new TypeError(`NeonDriver: unknown server table "${table}"`);
  }
  return table;
}

/** The row's column names in the table definition's order (stable SQL). */
function columnsOf(table: string): readonly string[] {
  const def = findServerDurableTable(table);
  if (def === undefined) throw new TypeError(`NeonDriver: unknown server table "${table}"`);
  return def.columns.map((column) => column.name);
}

/** The physical primary-key columns (tenant-partitioned) of a table. */
function primaryKeyOf(table: string): readonly string[] {
  const def = findServerDurableTable(table);
  if (def === undefined) throw new TypeError(`NeonDriver: unknown server table "${table}"`);
  return def.primaryKey;
}

/** The jsonb column names of a table (the text<->jsonb boundary). */
function jsonbColumnsOf(table: string): ReadonlySet<string> {
  const def = findServerDurableTable(table);
  if (def === undefined) throw new TypeError(`NeonDriver: unknown server table "${table}"`);
  return new Set(def.columns.filter((c) => c.type === "jsonb").map((c) => c.name));
}

/** Quote-join identifiers for SQL (column lists, conflict targets). */
function identList(columns: readonly string[]): string {
  return columns.join(", ");
}

/** Render one INSERT (with jsonb casts on the jsonb columns). */
function renderInsert(table: string, row: DurableRow): { readonly sql: string; readonly params: readonly DurableValue[] } {
  const columns = columnsOf(table);
  const jsonb = jsonbColumnsOf(table);
  const names = columns.filter((column) => row[column] !== undefined);
  if (names.length === 0) {
    throw new TypeError(`NeonDriver: an empty row for ${table}`);
  }
  const casts = names
    .map((column, index) => (jsonb.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`))
    .join(", ");
  const params = names.map((column) => row[column] as DurableValue);
  return { sql: `INSERT INTO ${table} (${identList(names)}) VALUES (${casts})`, params };
}

/** Render one upsert (ON CONFLICT (pk) DO UPDATE). */
function renderUpsert(table: string, row: DurableRow): { readonly sql: string; readonly params: readonly DurableValue[] } {
  const columns = columnsOf(table);
  const jsonb = jsonbColumnsOf(table);
  const names = columns.filter((column) => row[column] !== undefined);
  if (names.length === 0) {
    throw new TypeError(`NeonDriver: an empty row for ${table}`);
  }
  const pk = primaryKeyOf(table);
  const nonPk = names.filter((column) => !pk.includes(column));
  const casts = names
    .map((column, index) => (jsonb.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`))
    .join(", ");
  const params = names.map((column) => row[column] as DurableValue);
  const conflict = nonPk.length > 0
    ? ` DO UPDATE SET ${nonPk.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
    : " DO NOTHING";
  return {
    sql: `INSERT INTO ${table} (${identList(names)}) VALUES (${casts}) ON CONFLICT (${identList(pk)})${conflict}`,
    params,
  };
}

/** Render one DELETE by column-equality WHERE. */
function renderDelete(table: string, where: Readonly<Record<string, string>>): { readonly sql: string; readonly params: readonly string[] } {
  const entries = Object.entries(where);
  if (entries.length === 0) {
    throw new TypeError(`NeonDriver: an empty WHERE would delete the whole ${table} table`);
  }
  const clauses = entries.map(([column], index) => `${column} = $${index + 1}`).join(" AND ");
  return { sql: `DELETE FROM ${table} WHERE ${clauses}`, params: entries.map(([, value]) => value) };
}

/**
 * Normalize one loaded row to the seam's flat discipline: a jsonb
 * column that the driver returned as a PARSED object/array is
 * re-serialized to canonical JSON text (the frozen repositories parse
 * it themselves); everything else passes through unchanged.
 */
function normalizeRow(table: string, raw: Record<string, unknown>): DurableRow {
  const jsonb = jsonbColumnsOf(table);
  const out: Record<string, DurableValue> = {};
  for (const [column, value] of Object.entries(raw)) {
    if (value instanceof Date) {
      // timestamptz columns arrive as JS Date objects over the Neon HTTP
      // driver — the frozen seam's ISO-8601 TEXT contract requires the
      // instant string (canonicalJson of a Date would be "{}" — the
      // expiry-blindness bug this branch fixes; found by the W144 local
      // production dress rehearsal).
      out[column] = value.toISOString();
    } else if (jsonb.has(column) && value !== null && typeof value === "object") {
      out[column] = canonicalJson(value);
    } else if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[column] = value;
    } else {
      // Unexpected shape (e.g. a Postgres array type) — canonical JSON
      // keeps the value lossless for the flat seam.
      out[column] = canonicalJson(value);
    }
  }
  return frozen(out) as DurableRow;
}

// ---------------------------------------------------------------------------
// The Neon adapter
// ---------------------------------------------------------------------------

/**
 * Create the Neon durable driver (fetch-based
 * `@neondatabase/serverless` over DATABASE_URL).
 *
 * @param databaseUrl the resolved connection string (values never logged)
 * @returns the frozen driver
 */
export function createNeonDriver(databaseUrl: string): DurableDriver {
  const sql = neon(databaseUrl);

  async function run(
    query: string,
    params: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]> {
    const rows = (await sql(query, params as never[])) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows as Record<string, unknown>[];
  }

  return frozen({
    async loadPartition(table: string, tenantId: string): Promise<readonly DurableRow[]> {
      requireManagedTable(table);
      const rows = await run(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      return rows.map((row) => normalizeRow(table, row));
    },

    async loadTable(table: string): Promise<readonly DurableRow[]> {
      requireManagedTable(table);
      const rows = await run(`SELECT * FROM ${table}`, []);
      return rows.map((row) => normalizeRow(table, row));
    },

    async loadRowWhere(table: string, column: string, value: string): Promise<DurableRow | null> {
      requireManagedTable(table);
      const rows = await run(`SELECT * FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value]);
      const first = rows[0];
      return first === undefined ? null : normalizeRow(table, first);
    },

    async applyWrites(writes: readonly DurableWriteOp[]): Promise<void> {
      // Render every op, then submit the batch as ONE non-interactive
      // Postgres transaction: all-or-nothing, in order.
      const queries = writes.map((write) => {
        if (write.kind === "insert") {
          const rendered = renderInsert(requireManagedTable(write.table), write.row);
          return sql(rendered.sql, rendered.params as never[]);
        }
        if (write.kind === "upsert") {
          const rendered = renderUpsert(requireManagedTable(write.table), write.row);
          return sql(rendered.sql, rendered.params as never[]);
        }
        const rendered = renderDelete(requireManagedTable(write.table), write.where);
        return sql(rendered.sql, rendered.params as never[]);
      });
      await sql.transaction(queries as never);
    },

    async applySchema(statements: readonly string[]): Promise<void> {
      for (const statement of statements) {
        await run(statement, []);
      }
    },
  });
}

/**
 * Create the production driver from the environment, or undefined when
 * DATABASE_URL is absent (the caller refuses machine-stably — the
 * server tier never fabricates an in-memory replacement).
 */
export function createDriverFromEnv(): DurableDriver | undefined {
  const url = resolveDatabaseUrl();
  return url === undefined ? undefined : createNeonDriver(url);
}
