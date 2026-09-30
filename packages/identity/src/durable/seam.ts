/**
 * @fleetos/identity — the durable record-store seam (W100C D1).
 *
 * THE repository seam between the identity domain and durable storage
 * (Neon). This interface is what W102 [TL] implements over the real
 * database at the binding site; the in-memory reference implementation
 * (`memory.ts`, same directory) serves local development and the
 * deterministic test suite — the FREE-TIER-PROVIDER-MATRIX local tier
 * ("local/in-memory adapters; deterministic demo tenant").
 *
 * Discipline (LOCK 17 — tenant isolation at the persistence boundary):
 *   - EVERY operation takes the acting `TenantContext` as its FIRST
 *     parameter and can only touch the acting tenant's partition of the
 *     table. There is NO operation that names another tenant.
 *   - The runtime guard (`requireTenantContext`) rejects context-free
 *     and invalid-tenant access even when a caller bypasses the types.
 *   - The one sanctioned EXCEPTION is the invitation-code resolver
 *     (`findInvitationByCodeHash`): joining a workspace happens BEFORE
 *     the joining principal has a tenant context, so the invitation
 *     lookup is an explicit SYSTEM-level operation on the invitation
 *     table only (exact code-hash match; returns the invitation with its
 *     tenant scope). It is loudly documented here and tested to reveal
 *     nothing beyond one invitation row.
 *
 * The seam is deliberately SYNCHRONOUS and FLAT: rows are
 * `Record<string, DurableValue>`; nested domain records are serialized
 * by the repository layer into `jsonb` columns. A real Neon binding may
 * queue/batch internally but MUST NOT drop or reorder writes.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, FleetError, TenantId } from "@fleetos/contracts";
import type { TenantContext } from "../tenant-context";
import { requireTenantContext } from "../tenant-context";
import { frozen } from "../internal";
import { authorizationError, SYNTHETIC_SYSTEM_CORRELATION_ID } from "../errors";
import { SYNTHETIC_SYSTEM_TENANT_ID } from "../errors";
import type { DurableRow, DurableValue } from "./tables";

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** One stored row with its key (the primary-key column values joined). */
export interface DurableStoredRow {
  /** The row's storage key (derived from the primary-key columns). */
  readonly key: string;
  /** The row's columns. */
  readonly row: DurableRow;
}

/** The tagged result of a durable write. */
export type DurableWrite =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: FleetError;
      readonly reason: "already_exists" | "tenant_mismatch";
    };

/** Filter options for `list`. */
export interface DurableListOptions {
  /**
   * Only rows whose key starts with this prefix (the key is the joined
   * primary-key column values — see the repositories for the layouts).
   */
  readonly prefix?: string;
  /**
   * Only rows whose columns EQUAL these values (exact match on every
   * named column). The acting tenant's `tenant_id` is ALWAYS applied on
   * top (never nameable by the caller).
   */
  readonly where?: Readonly<Record<string, DurableValue>>;
}

/**
 * The durable record-store seam. Every tenant-scoped operation takes the
 * acting `TenantContext` FIRST and touches only the acting tenant's
 * partition of the named table.
 */
export interface DurableRecordStore {
  /**
   * Insert a row. Fails with `already_exists` when the key is present in
   * the acting tenant's partition.
   */
  insert(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite;
  /**
   * Insert or overwrite a row (upsert) in the acting tenant's partition.
   */
  put(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite;
  /** Read one row by key (own partition only). */
  get(ctx: TenantContext, table: string, key: string): DurableStoredRow | undefined;
  /**
   * List rows (own partition only), key order, optionally filtered by
   * key prefix and exact column equality.
   */
  list(ctx: TenantContext, table: string, opts?: DurableListOptions): readonly DurableStoredRow[];
  /** Delete one row by key (own partition only); true when removed. */
  remove(ctx: TenantContext, table: string, key: string): boolean;
  /** The number of rows in the acting tenant's partition of the table. */
  count(ctx: TenantContext, table: string): number;
  /**
   * The SYSTEM-level invitation-code resolver (see the module docs): an
   * exact code-hash match over the workspace-invitation table that
   * returns the invitation row WITH its tenant scope. This is the single
   * documented cross-tenant read in the identity persistence layer — it
   * exists because join happens before the joining principal holds a
   * tenant context.
   */
  findInvitationByCodeHash(codeHash: string): DurableStoredRow | undefined;
}

// ---------------------------------------------------------------------------
// Key layout (deterministic, shared by every repository)
// ---------------------------------------------------------------------------

/**
 * The key layout separator. A row key joins its primary-key column
 * values with this separator (e.g. `asn_<tenantId>::<principalId>::<role>`).
 */
export const DURABLE_KEY_SEPARATOR = "::" as const;

/**
 * Build a row key from primary-key column values. Deterministic.
 *
 * @param parts the key parts in primary-key order
 * @returns the joined key
 */
export function durableKey(...parts: readonly string[]): string {
  return parts.join(DURABLE_KEY_SEPARATOR);
}

// ---------------------------------------------------------------------------
// Validation helpers (shared by implementations)
// ---------------------------------------------------------------------------

/**
 * Validate that a table name is a declared non-empty identifier. Throws
 * `TypeError` otherwise (a repository naming an undeclared table is a
 * programming error, not a domain refusal).
 */
export function requireTableName(table: string): string {
  if (typeof table !== "string" || table.length === 0) {
    throw new TypeError("DurableRecordStore: table must be a non-empty string");
  }
  return table;
}

/**
 * Validate that a row key is a non-empty string without the key
 * separator (keys are joined BY the separator; embedded separators would
 * make key parsing ambiguous).
 */
export function requireRowKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("DurableRecordStore: key must be a non-empty string");
  }
  if (key.includes(DURABLE_KEY_SEPARATOR)) {
    throw new TypeError(
      `DurableRecordStore: key must not contain the separator "${DURABLE_KEY_SEPARATOR}"`,
    );
  }
  return key;
}

/**
 * Validate that a row's values are flat durable values. Returns the list
 * of offending column names (empty when valid).
 */
export function invalidRowColumns(row: DurableRow): readonly string[] {
  const offenders: string[] = [];
  for (const [name, value] of Object.entries(row)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      offenders.push(name);
    }
  }
  return offenders;
}

/**
 * The stable error for cross-tenant write attempts detected at the seam
 * (a row whose `tenant_id` column disagrees with the acting context).
 */
export function durableTenantMismatch(table: string): FleetError {
  return authorizationError(
    "identity.durable.tenant_mismatch",
    `DurableRecordStore: the ${table} row's tenant_id does not match the acting context`,
    "system",
    `durable.${table}.write`,
    "tenant_mismatch",
    SYNTHETIC_SYSTEM_TENANT_ID,
    SYNTHETIC_SYSTEM_CORRELATION_ID,
  );
}

/**
 * The stable error for duplicate-key insert attempts.
 *
 * @param table the table name
 * @param key the row key
 * @param tenantId the acting tenant
 * @param correlationId the request correlation (defaults to the sentinel)
 */
export function durableAlreadyExists(
  table: string,
  key: string,
  tenantId: TenantId,
  correlationId?: CorrelationId,
): FleetError {
  return frozen({
    kind: "DomainError",
    code: "identity.durable.already_exists",
    message: `DurableRecordStore: ${table} key ${key} already exists in the acting tenant's partition`,
    tenantId,
    correlationId: correlationId ?? SYNTHETIC_SYSTEM_CORRELATION_ID,
    domain: `durable.${table}`,
    invariant: "already_exists",
  });
}

/**
 * Enforce that a written row carries the acting tenant's id in its
 * `tenant_id` column. Returns the tagged failure when it does not.
 * Pure.
 */
export function checkRowTenant(
  tenantId: TenantId,
  row: DurableRow,
  table: string,
): DurableWrite | undefined {
  if (row["tenant_id"] !== tenantId) {
    return {
      ok: false,
      error: durableTenantMismatch(table),
      reason: "tenant_mismatch",
    };
  }
  return undefined;
}
