/**
 * @fleetos/identity — deterministic DDL rendering (W100C D1).
 *
 * Renders the durable table definitions (`tables.ts`) into the
 * `CREATE TABLE` SQL the W102 [TL] Neon migration binding applies.
 * The rendering is a PURE function of the definitions — the schema has
 * exactly one source of truth (LOCK discipline: derived artifacts are
 * never maintained by hand beside their inputs).
 *
 * The rendered SQL is driver-neutral PostgreSQL (Neon hosts it; the
 * reference stack names Neon Free as the authoritative business store —
 * FREE-TIER-PROVIDER-MATRIX.md). This module itself has NO driver
 * dependency and performs NO I/O.
 *
 * Determinism: the same definitions always render byte-identical SQL
 * (asserted by test) — a schema diff is meaningful exactly when the
 * definitions changed.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DurableTableDefinition } from "./tables";
import { IDENTITY_DURABLE_TABLES } from "./tables";
import { frozen } from "../internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The identity durable-schema version. Bumped ONLY when a table
 * definition changes; the W102 migration runner sequences forward from
 * this number (the frozen-surface guard discipline from @fleetos/ops
 * applies: `@fleetos/contracts` is never a migration target).
 *
 * v2 (W121): `fleetos_password_credentials` added — the durable
 * account-credential truth (verifier + salt; the plain password is
 * never stored).
 */
export const IDENTITY_DURABLE_SCHEMA_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render one table definition to its `CREATE TABLE` statement. Pure.
 *
 * Shape: `CREATE TABLE IF NOT EXISTS <name> (...)` with
 *   - every column in definition order (`<name> <type> NOT NULL?`);
 *   - a composite `PRIMARY KEY (<columns>)` clause;
 *   - a trailing `CREATE INDEX IF NOT EXISTS <name>_tenant_idx ON
 *     <name> (tenant_id)` — the tenant-isolation access path (every
 *     repository read filters on `tenant_id`).
 *
 * @param table the table definition
 * @returns the deterministic SQL text
 */
export function renderCreateTableSql(table: DurableTableDefinition): string {
  const columnLines = table.columns.map((column) => {
    const nullPart = column.nullable ? "" : " NOT NULL";
    return `  ${column.name} ${column.type}${nullPart}`;
  });
  const keyColumns = table.primaryKey.join(", ");
  const body = [...columnLines, `  PRIMARY KEY (${keyColumns})`].join(",\n");
  const create = `CREATE TABLE IF NOT EXISTS ${table.name} (\n${body}\n);`;
  const index = `CREATE INDEX IF NOT EXISTS ${table.name}_tenant_idx ON ${table.name} (tenant_id);`;
  return `${create}\n${index}`;
}

/**
 * Render every identity-lane durable table to one deterministic SQL
 * script (table definition order). This is the artifact the W102 Neon
 * migration binding applies; it carries a leading schema-version comment.
 *
 * Pure: the same definitions render byte-identical output.
 *
 * @param tables the table definitions to render (defaults to
 *   `IDENTITY_DURABLE_TABLES`)
 * @returns the deterministic SQL script
 */
export function renderIdentityDurableSchemaSql(
  tables: readonly DurableTableDefinition[] = IDENTITY_DURABLE_TABLES,
): string {
  const statements = tables.map((table) => renderCreateTableSql(table));
  const header = [
    "-- FleetOS identity durable schema (Neon / PostgreSQL)",
    `-- schema_version: ${String(IDENTITY_DURABLE_SCHEMA_VERSION)}`,
    "-- Generated from packages/identity/src/durable/tables.ts — DO NOT hand-edit;",
    "-- change the definitions and re-render (single source of truth).",
  ].join("\n");
  return `${header}\n\n${statements.join("\n\n")}\n`;
}

/** The frozen machine-stable DDL manifest (one entry per table). */
export interface DurableSchemaManifest {
  readonly schemaVersion: number;
  /** Table names in definition order. */
  readonly tables: readonly string[];
  /** The byte-stable digest input: the rendered SQL script. */
  readonly sql: string;
}

/**
 * Build the machine-stable DDL manifest (the W102 migration input).
 * Pure and deterministic.
 *
 * @param tables the table definitions (defaults to the identity tables)
 * @returns the frozen manifest
 */
export function buildIdentityDurableSchemaManifest(
  tables: readonly DurableTableDefinition[] = IDENTITY_DURABLE_TABLES,
): DurableSchemaManifest {
  return frozen({
    schemaVersion: IDENTITY_DURABLE_SCHEMA_VERSION,
    tables: tables.map((table) => table.name),
    sql: renderIdentityDurableSchemaSql(tables),
  });
}
