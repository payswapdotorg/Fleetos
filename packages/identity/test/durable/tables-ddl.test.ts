/**
 * W100C D1 — durable table definitions + deterministic DDL rendering.
 */

import { test, expect } from "bun:test";
import {
  IDENTITY_DURABLE_SCHEMA_VERSION,
  IDENTITY_DURABLE_TABLES,
  buildIdentityDurableSchemaManifest,
  findDurableTable,
  renderCreateTableSql,
  renderIdentityDurableSchemaSql,
} from "../../src/index";

test("every identity durable table is tenant-scoped with a tenant_id column", () => {
  expect(IDENTITY_DURABLE_TABLES.length).toBe(5);
  for (const table of IDENTITY_DURABLE_TABLES) {
    expect(table.tenantScoped).toBe(true);
    const tenantColumn = table.columns.find((c) => c.name === "tenant_id");
    expect(tenantColumn).toBeDefined();
    expect(tenantColumn!.nullable).toBe(false);
    expect(table.primaryKey.length).toBeGreaterThan(0);
  }
});

test("the declared tables cover the W100C durable surfaces", () => {
  const names = IDENTITY_DURABLE_TABLES.map((t) => t.name);
  expect(names).toEqual([
    "fleetos_tenants",
    "fleetos_principals",
    "fleetos_role_assignments",
    "fleetos_sessions",
    "fleetos_workspace_invitations",
  ]);
});

test("the sessions table carries the active-role selector as a nullable column", () => {
  const sessions = findDurableTable("fleetos_sessions");
  expect(sessions).toBeDefined();
  const activeRole = sessions!.columns.find((c) => c.name === "active_role");
  expect(activeRole).toBeDefined();
  expect(activeRole!.nullable).toBe(true);
  expect(activeRole!.type).toBe("text");
});

test("DDL rendering is deterministic (byte-identical for the same definitions)", () => {
  const a = renderIdentityDurableSchemaSql();
  const b = renderIdentityDurableSchemaSql();
  expect(a).toBe(b);
  expect(a).toContain("CREATE TABLE IF NOT EXISTS fleetos_sessions");
  expect(a).toContain("CREATE INDEX IF NOT EXISTS fleetos_sessions_tenant_idx ON fleetos_sessions (tenant_id)");
  expect(a).toContain(`-- schema_version: ${String(IDENTITY_DURABLE_SCHEMA_VERSION)}`);
});

test("one table's DDL carries NOT NULL on every mandatory column and a PRIMARY KEY", () => {
  const sql = renderCreateTableSql(findDurableTable("fleetos_role_assignments")!);
  expect(sql).toContain("tenant_id text NOT NULL");
  expect(sql).toContain("expires_at timestamptz");
  expect(sql).toContain("PRIMARY KEY (assignment_id)");
  // The NOT NULL list is exactly the non-nullable columns.
  expect(sql).not.toContain("expires_at timestamptz NOT NULL");
});

test("the DDL manifest is frozen, machine-stable, and self-consistent", () => {
  const manifest = buildIdentityDurableSchemaManifest();
  expect(Object.isFrozen(manifest)).toBe(true);
  expect(manifest.schemaVersion).toBe(IDENTITY_DURABLE_SCHEMA_VERSION);
  expect(manifest.tables).toEqual(IDENTITY_DURABLE_TABLES.map((t) => t.name));
  expect(manifest.sql).toBe(renderIdentityDurableSchemaSql());
});

test("findDurableTable returns undefined for unknown tables", () => {
  expect(findDurableTable("fleetos_nope")).toBeUndefined();
});
