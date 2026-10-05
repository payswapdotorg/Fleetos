/**
 * @fleetos/web — W140: the server-plane durable tables (the physical
 * Neon schema of the server-side control plane).
 *
 * SERVER-ONLY (apps/web/src/server — imported exclusively by API route
 * handlers; NEVER from a client bundle — proven by the import-boundary
 * test in apps/web/test/server-isolation.test.ts).
 *
 * The physical schema hosts THREE table families over ONE database:
 *
 *   1. the FROZEN identity tables (`packages/identity/src/durable/tables.ts`)
 *      — mirrored here with TENANT-PARTITIONED primary keys: the frozen
 *      seam addresses rows by a per-tenant key, so the physical PRIMARY
 *      KEY is `(tenant_id, <frozen pk columns>)` (LOCK 17 — tenant
 *      isolation at the persistence boundary — made physical). The
 *      COLUMN definitions are DERIVED from the frozen definitions at
 *      runtime (never duplicated), so a frozen definition change flows
 *      through automatically.
 *   2. the FROZEN audit table (`packages/audit/src/durable-log.ts`) —
 *      same mirroring rule (its frozen pk is `sequence`, which is
 *      per-tenant; the physical pk gains `tenant_id`).
 *   3. the SERVER-OWNED tables declared below (the server control
 *      plane's own state: enrollment requests, agent trust sessions,
 *      device twins, the agent check-in idempotency registry, and the
 *      observation-ingestion durable registries).
 *
 * The DDL is DERIVED from the definitions (renderCreateTableSql from the
 * identity lane's public API — the single source of truth for rendering;
 * the same discipline as the identity schema). Applying it is idempotent
 * (`CREATE TABLE IF NOT EXISTS`).
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */

import type { DurableTableDefinition } from "@fleetos/identity";
import { renderCreateTableSql } from "@fleetos/identity";
import { IDENTITY_DURABLE_TABLES } from "@fleetos/identity";
import { AUDIT_DURABLE_TABLE } from "@fleetos/audit";
import { frozen, frozenArray } from "./server-internal";

// ---------------------------------------------------------------------------
// Tenant-partitioned mirroring of the frozen tables
// ---------------------------------------------------------------------------

/**
 * Mirror a frozen table definition with a TENANT-PARTITIONED primary key:
 * `tenant_id` is prepended to the frozen pk when absent (the frozen
 * `DurableRecordStore` seam addresses rows by a per-tenant key; the
 * physical database enforces the partition). Columns are shared by
 * reference — never re-declared.
 */
function tenantPartitioned(table: DurableTableDefinition): DurableTableDefinition {
  const pk = table.primaryKey.includes("tenant_id")
    ? table.primaryKey
    : frozenArray(["tenant_id", ...table.primaryKey]);
  return frozen({ ...table, primaryKey: pk });
}

/** The identity tables as physical Neon tables (tenant-partitioned pks). */
export const PHYSICAL_IDENTITY_TABLES: readonly DurableTableDefinition[] = frozenArray(
  IDENTITY_DURABLE_TABLES.map(tenantPartitioned),
);

/** The audit table as a physical Neon table (tenant-partitioned pk). */
export const PHYSICAL_AUDIT_TABLE: DurableTableDefinition = tenantPartitioned(AUDIT_DURABLE_TABLE);

// ---------------------------------------------------------------------------
// The server-owned tables
// ---------------------------------------------------------------------------

/**
 * `fleetos_enrollment_requests` — the server-issued enrollment codes
 * (the W140 scoped-code truth). VERIFIER-ONLY storage: the raw code is
 * never persisted (the install contract's rule); the record carries the
 * code verifier, lifecycle status and scope, mirroring the frozen
 * enrollment-request record shape structurally.
 */
export const ENROLLMENT_REQUESTS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_enrollment_requests",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "request_id"]),
  description: "Server-issued enrollment codes — verifier-only storage, one-time, tenant-scoped.",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "request_id", type: "text", nullable: false, description: "Stable request id (enr_ prefix)." },
    { name: "device_id", type: "text", nullable: true, description: "The pre-assigned device, when set." },
    { name: "ownership_kind", type: "text", nullable: false, description: "The install contract's ownership kind." },
    { name: "ownership_class", type: "text", nullable: false, description: "The frozen W071 ownership class." },
    { name: "allowed_roles", type: "jsonb", nullable: false, description: "Roles permitted to redeem (canonical JSON array)." },
    { name: "created_at", type: "timestamptz", nullable: false, description: "ISO 8601 issuance instant." },
    { name: "expires_at", type: "timestamptz", nullable: false, description: "ISO 8601 expiry instant." },
    { name: "status", type: "text", nullable: false, description: "pending | fulfilled | revoked | expired." },
    { name: "code_verifier", type: "text", nullable: false, description: "The bootstrap-code verifier (never the code)." },
    { name: "fulfilled_at", type: "timestamptz", nullable: true, description: "Fulfillment instant, when redeemed." },
    { name: "fulfilled_device_id", type: "text", nullable: true, description: "The device that redeemed, when fulfilled." },
    { name: "revoked_at", type: "timestamptz", nullable: true, description: "Revocation instant, when revoked." },
    { name: "revoked_reason", type: "text", nullable: true, description: "Operator revocation reason, when revoked." },
    { name: "correlation_id", type: "text", nullable: true, description: "The creation correlation id, when supplied." },
  ] as const),
});

/**
 * `fleetos_agent_sessions` — the device-scoped trust records issued at
 * enrollment redemption (the check-in session layer's credential). The
 * token is opaque to the agent; the control plane is its sole validator.
 */
export const AGENT_SESSIONS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_agent_sessions",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "agent_session_id"]),
  description: "Device-scoped agent trust sessions — the check-in credential truth.",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "agent_session_id", type: "text", nullable: false, description: "Stable session id (agses_ prefix)." },
    { name: "device_id", type: "text", nullable: false, description: "The trusted device." },
    { name: "token", type: "text", nullable: false, description: "The opaque trust token (fagt_ grammar; a lookup key, never parsed)." },
    { name: "enrollment_request_id", type: "text", nullable: false, description: "The redeemed enrollment request." },
    { name: "issued_at", type: "timestamptz", nullable: false, description: "ISO 8601 issuance instant." },
    { name: "expires_at", type: "timestamptz", nullable: false, description: "ISO 8601 expiry instant." },
    { name: "last_seen_at", type: "timestamptz", nullable: false, description: "ISO 8601 last check-in instant." },
    { name: "revoked_at", type: "timestamptz", nullable: true, description: "ISO 8601 revocation instant, when revoked." },
    { name: "check_in_count", type: "integer", nullable: false, description: "Accepted check-ins (idempotent replays excluded)." },
  ] as const),
});

/**
 * `fleetos_device_twins` — the durable Device Twin store backing the
 * server-side `TwinStore` seam. The twin aggregate serializes as
 * canonical JSON; `revision` and `lifecycle_state` are promoted to
 * columns for the twin-status lookup path.
 */
export const DEVICE_TWINS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_device_twins",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "device_id"]),
  description: "Durable Device Twins — the canonical device record (canonical-JSON aggregate).",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "device_id", type: "text", nullable: false, description: "The device." },
    { name: "revision", type: "integer", nullable: false, description: "The twin's current revision." },
    { name: "lifecycle_state", type: "text", nullable: false, description: "The device lifecycle state." },
    { name: "enrolled_at", type: "timestamptz", nullable: false, description: "ISO 8601 enrollment instant." },
    { name: "twin", type: "jsonb", nullable: false, description: "The Device Twin aggregate (canonical JSON)." },
    { name: "updated_at", type: "timestamptz", nullable: false, description: "ISO 8601 last-mutation instant." },
  ] as const),
});

/**
 * `fleetos_agent_checkins` — the agent check-in idempotency registry:
 * one row per accepted check-in command. The seam key is the
 * collision-resistant digest `chk_<sha256(deviceId, idempotencyKey)>`
 * (the frozen seam bans `::`-embedded composite keys); the columns
 * carry the parts. A replay of the same command returns the STORED ack
 * (never re-executes); a different command under the same key is a
 * machine-stable conflict.
 */
export const AGENT_CHECKINS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_agent_checkins",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "checkin_key"]),
  description: "Agent check-in idempotency registry — replay returns the stored ack.",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "checkin_key", type: "text", nullable: false, description: "chk_ + sha256(deviceId, idempotencyKey)." },
    { name: "device_id", type: "text", nullable: false, description: "The checking-in device." },
    { name: "idempotency_key", type: "text", nullable: false, description: "The command's idempotency key." },
    { name: "command_digest", type: "text", nullable: false, description: "Digest of the canonical command." },
    { name: "ack", type: "jsonb", nullable: false, description: "The stored ack event envelope (canonical JSON)." },
    { name: "correlation_id", type: "text", nullable: false, description: "The command's correlation id." },
    { name: "causation_id", type: "text", nullable: false, description: "The command's id (the ack's cause)." },
    { name: "occurred_at", type: "timestamptz", nullable: false, description: "ISO 8601 accepted-at instant." },
  ] as const),
});

/**
 * `fleetos_observation_batches` — the batch-level idempotency registry
 * of the server-side observation ingestion (the durable twin of the
 * frozen in-memory service's admitted-batch map). Seam key:
 * `bat_` + sha256(deviceId, idempotencyKey).
 */
export const OBSERVATION_BATCHES_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_observation_batches",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "batch_key"]),
  description: "Observation batch idempotency registry (batch key -> stored outcome).",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "batch_key", type: "text", nullable: false, description: "bat_ + sha256(deviceId, idempotencyKey)." },
    { name: "device_id", type: "text", nullable: false, description: "The observing device." },
    { name: "idempotency_key", type: "text", nullable: false, description: "The batch's idempotency key." },
    { name: "batch_digest", type: "text", nullable: false, description: "Digest of the canonical batch." },
    { name: "first_admitted_at", type: "timestamptz", nullable: false, description: "ISO 8601 first-admission instant." },
    { name: "admitted_observations", type: "integer", nullable: false, description: "Newly admitted events." },
    { name: "duplicate_observations", type: "integer", nullable: false, description: "Suppressed (already-admitted) events." },
    { name: "twin_revision", type: "integer", nullable: false, description: "The twin revision after admission." },
  ] as const),
});

/**
 * `fleetos_observation_events` — the event-level dedup registry: an
 * observation id is admitted exactly once per (tenant, device). Seam
 * key: `obs_` + sha256(deviceId, observationId).
 */
export const OBSERVATION_EVENTS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_observation_events",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id", "event_key"]),
  description: "Observation event dedup registry — one row per admitted observation id.",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "event_key", type: "text", nullable: false, description: "obs_ + sha256(deviceId, observationId)." },
    { name: "device_id", type: "text", nullable: false, description: "The observing device." },
    { name: "observation_id", type: "text", nullable: false, description: "The admitted observation id." },
    { name: "admitted_at", type: "timestamptz", nullable: false, description: "ISO 8601 admission instant." },
  ] as const),
});

/**
 * `fleetos_observation_queue` — the per-tenant admitted-but-undrained
 * observation depth (the durable back-pressure signal).
 */
export const OBSERVATION_QUEUE_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_observation_queue",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id"]),
  description: "Per-tenant observation queue depth (the back-pressure signal).",
  columns: frozenArray([
    { name: "tenant_id", type: "text", nullable: false, description: "The owning tenant (isolation)." },
    { name: "depth", type: "integer", nullable: false, description: "Admitted-but-undrained observation count." },
  ] as const),
});

/** The server-owned tables, declaration order. */
export const SERVER_OWNED_TABLES: readonly DurableTableDefinition[] = frozenArray([
  ENROLLMENT_REQUESTS_TABLE,
  AGENT_SESSIONS_TABLE,
  DEVICE_TWINS_TABLE,
  AGENT_CHECKINS_TABLE,
  OBSERVATION_BATCHES_TABLE,
  OBSERVATION_EVENTS_TABLE,
  OBSERVATION_QUEUE_TABLE,
]);

/** Every physical table the server plane manages (application order). */
export const SERVER_DURABLE_TABLES: readonly DurableTableDefinition[] = frozenArray([
  ...PHYSICAL_IDENTITY_TABLES,
  PHYSICAL_AUDIT_TABLE,
  ...SERVER_OWNED_TABLES,
]);

/** The table names the request-scoped store manages (lookup by name). */
export const SERVER_DURABLE_TABLE_NAMES: readonly string[] = frozenArray(
  SERVER_DURABLE_TABLES.map((table) => table.name),
);

/**
 * Find a managed physical table definition by name. Pure.
 *
 * @param name the table name
 * @returns the definition, or undefined when the table is not managed
 */
export function findServerDurableTable(name: string): DurableTableDefinition | undefined {
  return SERVER_DURABLE_TABLES.find((table) => table.name === name);
}

/**
 * Render the full server-plane schema as one deterministic SQL script
 * (`CREATE TABLE IF NOT EXISTS` per table + the tenant index — the
 * identity lane's renderer, so the rendering rules are shared).
 */
export function renderServerDurableSchemaSql(): string {
  const statements = SERVER_DURABLE_TABLES.map((table) => renderCreateTableSql(table));
  const header = [
    "-- FleetOS server-plane durable schema (Neon / PostgreSQL) — W140",
    "-- Hosts the frozen identity + audit tables (tenant-partitioned physical",
    "-- primary keys; column definitions derived from the frozen packages) and",
    "-- the server-owned control-plane tables. Idempotent: CREATE IF NOT EXISTS.",
  ].join("\n");
  return `${header}\n\n${statements.join("\n\n")}\n`;
}
