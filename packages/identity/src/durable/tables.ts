/**
 * @fleetos/identity — durable table definitions (W100C D1).
 *
 * The Neon durable-schema basis for the persistent identity records
 * (W100C: "persistent user/principal/session records over Neon — durable
 * storage; schema + repository seams consistent with the frozen contracts
 * and the free-tier provider matrix"). Neon is the AUTHORITY
 * (docs/tech-lead/FREE-TIER-PROVIDER-MATRIX.md — "Do not move truth into
 * Redis or R2"); this module declares the TYPED tables the durable
 * repositories persist into, and `ddl.ts` renders them to deterministic
 * `CREATE TABLE` SQL for the W102 [TL] Neon migration binding.
 *
 * Design rulings (binding for this lane):
 *   - ONE source of truth: the table definitions here; the DDL is DERIVED
 *     (`renderCreateTablesSql`), never hand-written beside them.
 *   - Every table is TENANT-SCOPED (LOCK 17 — "tenant isolation is
 *     enforced at persistence and action boundaries"): each row carries a
 *     non-null `tenant_id` and every repository read filters on it.
 *   - Rows are FLAT (`DurableValue` columns): nested domain records are
 *     serialized to canonical JSON in `jsonb` columns by the repository
 *     layer — the seam stays driver-neutral (LOCK 6: provider-specific
 *     types never enter core domain contracts; there is no pg/postgres
 *     dependency here at all).
 *   - Column types are the minimal driver-neutral set (`text`,
 *     `timestamptz`, `integer`, `boolean`, `jsonb`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen, frozenArray } from "../internal";

// ---------------------------------------------------------------------------
// Column + table shapes
// ---------------------------------------------------------------------------

/**
 * The driver-neutral column type union. These map 1:1 onto the PostgreSQL
 * types Neon hosts (the W102 binding renders the SQL).
 */
export type DurableColumnType = "text" | "timestamptz" | "integer" | "boolean" | "jsonb";

/** One column of a durable table. */
export interface DurableColumnDefinition {
  /** The column name (snake_case, stable). */
  readonly name: string;
  /** The column type. */
  readonly type: DurableColumnType;
  /** Whether the column may be NULL. */
  readonly nullable: boolean;
  /** The column's human-facing purpose (schema documentation). */
  readonly description: string;
}

/** One durable table (all FleetOS identity tables are tenant-scoped). */
export interface DurableTableDefinition {
  /** The table name (`fleetos_` prefix, stable). */
  readonly name: string;
  /** The tenant-isolation property (always true — the column is mandatory). */
  readonly tenantScoped: true;
  /**
   * The primary-key column(s). Composite keys list their columns in key
   * order. The repository seam addresses rows by these columns.
   */
  readonly primaryKey: readonly string[];
  /** The table's columns, definition order (deterministic DDL). */
  readonly columns: readonly DurableColumnDefinition[];
  /** The table's human-facing purpose (schema documentation). */
  readonly description: string;
}

/** The value types a durable row column may carry (flat, JSON-safe). */
export type DurableValue = string | number | boolean | null;

/** A durable row: column name -> value (flat). */
export type DurableRow = Readonly<Record<string, DurableValue>>;

// ---------------------------------------------------------------------------
// The tenant_id / key columns (shared by every table)
// ---------------------------------------------------------------------------

/** The tenant-isolation column present on EVERY durable table. */
export const TENANT_ID_COLUMN: DurableColumnDefinition = frozen({
  name: "tenant_id",
  type: "text",
  nullable: false,
  description: "The owning tenant (tenant isolation is enforced at persistence).",
});

// ---------------------------------------------------------------------------
// The W100C durable tables
// ---------------------------------------------------------------------------

/**
 * `fleetos_tenants` — the workspace/tenant records. One row per
 * workspace created through the workspace lifecycle (W100C D2).
 */
export const TENANTS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_tenants",
  tenantScoped: true,
  primaryKey: frozenArray(["tenant_id"]),
  description: "Workspace/tenant records — the create/join lifecycle's durable truth.",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "name",
      type: "text",
      nullable: false,
      description: "The workspace's display name.",
    },
    {
      name: "status",
      type: "text",
      nullable: false,
      description: "The workspace status (active | archived).",
    },
    {
      name: "created_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 creation instant (injected).",
    },
    {
      name: "created_by",
      type: "text",
      nullable: false,
      description: "The founding principal id (usr:<userId> grammar).",
    },
  ]),
});

/**
 * `fleetos_principals` — the persistent principal records: the tenant
 * membership truth (which user/service/agent principals exist in which
 * tenant).
 */
export const PRINCIPALS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_principals",
  tenantScoped: true,
  primaryKey: frozenArray(["principal_id"]),
  description: "Persistent principal records — the tenant membership truth.",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "principal_id",
      type: "text",
      nullable: false,
      description: "The principal id (usr:/svc:/agt: grammar).",
    },
    {
      name: "kind",
      type: "text",
      nullable: false,
      description: "The principal kind (user | service | agent).",
    },
    {
      name: "member_ref",
      type: "text",
      nullable: false,
      description: "The kind's member reference (userId / serviceName / deviceId).",
    },
    {
      name: "display_name",
      type: "text",
      nullable: false,
      description: "The human-facing display name.",
    },
    {
      name: "created_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 membership-creation instant (injected).",
    },
  ]),
});

/**
 * `fleetos_role_assignments` — the persistent role assignments. THE
 * authoritative set of assigned roles per principal per tenant
 * (spec/ui/ROLE-EXPERIENCE-MATRIX.yaml: "effective permissions come from
 * identity and guardian"; the active-role SELECTOR never widens this).
 */
export const ROLE_ASSIGNMENTS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_role_assignments",
  tenantScoped: true,
  primaryKey: frozenArray(["assignment_id"]),
  description: "Persistent role assignments — the authoritative assigned-role set.",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "assignment_id",
      type: "text",
      nullable: false,
      description: "Deterministic assignment id (asn_ prefix).",
    },
    {
      name: "principal_id",
      type: "text",
      nullable: false,
      description: "The assigned principal id.",
    },
    {
      name: "role_name",
      type: "text",
      nullable: false,
      description: "The assigned role name (e.g. fleet.admin).",
    },
    {
      name: "assigned_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 assignment instant (injected).",
    },
    {
      name: "assigned_by",
      type: "text",
      nullable: false,
      description: "The assigning principal id.",
    },
    {
      name: "expires_at",
      type: "timestamptz",
      nullable: true,
      description: "Optional ISO 8601 expiry — the assignment is inactive at/past it.",
    },
  ]),
});

/**
 * `fleetos_sessions` — the persistent session records. The durable
 * browser-session truth: the issued credential binding plus the
 * active-role SELECTOR (a presentation selector ONLY — the authoritative
 * assigned-role set lives in `fleetos_role_assignments`).
 */
export const SESSIONS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_sessions",
  tenantScoped: true,
  primaryKey: frozenArray(["session_id"]),
  description: "Persistent session records — the durable browser-session truth.",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "session_id",
      type: "text",
      nullable: false,
      description: "Deterministic session id (ses_ prefix).",
    },
    {
      name: "token",
      type: "text",
      nullable: false,
      description: "The opaque session token (fst_ grammar; a lookup key, never parsed).",
    },
    {
      name: "principal_id",
      type: "text",
      nullable: false,
      description: "The authenticated principal id.",
    },
    {
      name: "principal_kind",
      type: "text",
      nullable: false,
      description: "The authenticated principal kind (user | service | agent).",
    },
    {
      name: "principal_member_ref",
      type: "text",
      nullable: false,
      description: "The principal's member reference (userId / serviceName / deviceId).",
    },
    {
      name: "active_role",
      type: "text",
      nullable: true,
      description: "The active-role SELECTOR (presentation only; may be NULL).",
    },
    {
      name: "issued_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 issuance instant (injected).",
    },
    {
      name: "expires_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 expiry instant (issuedAt + ttl).",
    },
    {
      name: "last_seen_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 last-observed instant (touched on resolve/switch).",
    },
    {
      name: "revoked_at",
      type: "timestamptz",
      nullable: true,
      description: "ISO 8601 revocation instant, when revoked.",
    },
    {
      name: "issuer",
      type: "text",
      nullable: false,
      description: "The issuing authority identity.",
    },
  ]),
});

/**
 * `fleetos_workspace_invitations` — the workspace-join invitation
 * records. The durable join-lifecycle truth: an invitation code binds a
 * prospective member to a workspace until used or expired.
 */
export const WORKSPACE_INVITATIONS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_workspace_invitations",
  tenantScoped: true,
  primaryKey: frozenArray(["invitation_id"]),
  description: "Workspace-join invitation records — the durable join-lifecycle truth.",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "invitation_id",
      type: "text",
      nullable: false,
      description: "Deterministic invitation id (inv_ prefix).",
    },
    {
      name: "code_hash",
      type: "text",
      nullable: false,
      description: "A deterministic hash of the join code (the raw code is never stored).",
    },
    {
      name: "created_by",
      type: "text",
      nullable: false,
      description: "The inviting principal id.",
    },
    {
      name: "created_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 issuance instant (injected).",
    },
    {
      name: "expires_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 expiry instant (fail-closed when unparseable).",
    },
    {
      name: "used_at",
      type: "timestamptz",
      nullable: true,
      description: "ISO 8601 usage instant, when the invitation was redeemed.",
    },
    {
      name: "used_by",
      type: "text",
      nullable: true,
      description: "The joining principal id, when redeemed.",
    },
  ]),
});

/**
 * `fleetos_password_credentials` — the persistent password-credential
 * records (W121). The durable account-credential truth: a member's
 * sign-in verifier + salt, bound to its tenant and principal. The
 * PLAIN password is NEVER stored — only the PasswordHasher verifier
 * output and its per-credential salt (the seam in `../password.ts`;
 * the hasher implementation is injected at the composition root).
 */
export const PASSWORD_CREDENTIALS_TABLE: DurableTableDefinition = frozen({
  name: "fleetos_password_credentials",
  tenantScoped: true,
  primaryKey: frozenArray(["credential_id"]),
  description:
    "Persistent password-credential records — the durable account-credential truth (verifier + salt; the plain password is never stored).",
  columns: frozenArray([
    TENANT_ID_COLUMN,
    {
      name: "credential_id",
      type: "text",
      nullable: false,
      description: "Deterministic credential id (pwd_ prefix).",
    },
    {
      name: "principal_id",
      type: "text",
      nullable: false,
      description: "The credential's principal id (usr: grammar).",
    },
    {
      name: "member_ref",
      type: "text",
      nullable: false,
      description: "The sign-in member reference (the member's email).",
    },
    {
      name: "salt",
      type: "text",
      nullable: false,
      description: "The per-credential salt (injected generator; never the plain password).",
    },
    {
      name: "verifier",
      type: "text",
      nullable: false,
      description: "The PasswordHasher verifier output (the plain password is never stored).",
    },
    {
      name: "created_at",
      type: "timestamptz",
      nullable: false,
      description: "ISO 8601 credential-creation instant (injected).",
    },
    {
      name: "created_by",
      type: "text",
      nullable: false,
      description: "The creating principal id.",
    },
    {
      name: "revoked_at",
      type: "timestamptz",
      nullable: true,
      description: "ISO 8601 revocation instant, when the credential was revoked.",
    },
  ]),
});

/** Every identity-lane durable table, definition order (deterministic DDL). */
export const IDENTITY_DURABLE_TABLES: readonly DurableTableDefinition[] = frozenArray([
  TENANTS_TABLE,
  PRINCIPALS_TABLE,
  ROLE_ASSIGNMENTS_TABLE,
  SESSIONS_TABLE,
  WORKSPACE_INVITATIONS_TABLE,
  PASSWORD_CREDENTIALS_TABLE,
]);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Find a durable table definition by name. Pure.
 *
 * @param name the table name
 * @returns the definition, or undefined when no such table is declared
 */
export function findDurableTable(name: string): DurableTableDefinition | undefined {
  return IDENTITY_DURABLE_TABLES.find((table) => table.name === name);
}
