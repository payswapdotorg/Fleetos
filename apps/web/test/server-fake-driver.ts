/**
 * W140 — the in-memory fake `DurableDriver` (the deterministic test
 * binding for the server plane; no real Neon, no network).
 *
 * Semantics mirror the Neon adapter: partition loads, the cross-tenant
 * indexed lookup, ordered atomic-ish writes (an insert conflict throws
 * — fail-closed), and a no-op idempotent schema application. Shared
 * by every server-plane test file.
 */

import type { DurableRow } from "@fleetos/identity";
import type { DurableDriver, DurableWriteOp } from "../src/server/durable-driver";
import { findServerDurableTable } from "../src/server/server-tables";

/** The row store: table -> rows (each row a flat record). */
export class FakeDurableDriver implements DurableDriver {
  private readonly tables = new Map<string, DurableRow[]>();
  public schemaApplied = 0;

  /** Every applied write op, in order (the no-drop/no-reorder proof). */
  public readonly appliedWrites: DurableWriteOp[] = [];

  private rowsOf(table: string): DurableRow[] {
    let rows = this.tables.get(table);
    if (rows === undefined) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  /** The pk tuple of a row (its table's physical pk column values). */
  private pkOf(table: string, row: DurableRow): string {
    const def = findServerDurableTable(table);
    if (def === undefined) throw new TypeError(`FakeDriver: unknown table ${table}`);
    return def.primaryKey.map((column) => String(row[column])).join("\u0000");
  }

  async loadPartition(table: string, tenantId: string): Promise<readonly DurableRow[]> {
    return this.rowsOf(table).filter((row) => row["tenant_id"] === tenantId);
  }

  async loadTable(table: string): Promise<readonly DurableRow[]> {
    return [...this.rowsOf(table)];
  }

  async loadRowWhere(table: string, column: string, value: string): Promise<DurableRow | null> {
    return this.rowsOf(table).find((row) => row[column] === value) ?? null;
  }

  async applyWrites(writes: readonly DurableWriteOp[]): Promise<void> {
    for (const write of writes) {
      this.appliedWrites.push(write);
      if (write.kind === "insert") {
        const rows = this.rowsOf(write.table);
        const key = this.pkOf(write.table, write.row);
        if (rows.some((row) => this.pkOf(write.table, row) === key)) {
          throw new Error(`FakeDriver: duplicate primary key ${key} on ${write.table}`);
        }
        rows.push(write.row);
      } else if (write.kind === "upsert") {
        const rows = this.rowsOf(write.table);
        const key = this.pkOf(write.table, write.row);
        const index = rows.findIndex((row) => this.pkOf(write.table, row) === key);
        if (index === -1) {
          rows.push(write.row);
        } else {
          rows[index] = write.row;
        }
      } else {
        const rows = this.rowsOf(write.table);
        const entries = Object.entries(write.where);
        const kept = rows.filter((row) => !entries.every(([column, value]) => String(row[column]) === value));
        this.tables.set(write.table, kept);
      }
    }
  }

  async applySchema(statements: readonly string[]): Promise<void> {
    this.schemaApplied += statements.length;
  }

  /** Test-only: read one row by (table, where). */
  findRow(table: string, where: Readonly<Record<string, string>>): DurableRow | undefined {
    const entries = Object.entries(where);
    return this.rowsOf(table).find((row) => entries.every(([column, value]) => String(row[column]) === value));
  }

  /** Test-only: all rows of a table. */
  allRows(table: string): readonly DurableRow[] {
    return [...this.rowsOf(table)];
  }
}
