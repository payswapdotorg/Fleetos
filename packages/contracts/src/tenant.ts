/**
 * @fleetos/contracts — Tenant scoping primitives.
 *
 * Tenant isolation is structural: every envelope, command, intent, and
 * audit record carries a branded `TenantId`. The `TenantScoped` base shape
 * is enforced by the type system on every cross-module contract.
 *
 * Reference: `spec/ARCHITECTURE-LOCK.md` item 17 ("Tenant isolation is
 * enforced at persistence and action boundaries") and `spec/ARCHITECTURE.md`
 * § Control plane ("tenants and identities").
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "./ids";

/**
 * The base shape for every tenant-isolated contract. Anything that crosses
 * a module boundary MUST extend or include this shape. The `tenantId` field
 * is non-optional: contracts without a tenant scope are forbidden.
 *
 * @example
 *   interface MyEvent extends TenantScoped {
 *     // ...domain payload...
 *   }
 */
export interface TenantScoped {
  readonly tenantId: TenantId;
}

/**
 * The maximum length of a tenant identifier string. The minimum is enforced
 * at the validation boundary; the maximum bounds storage cost in indexes.
 */
export const TENANT_ID_MAX_LENGTH = 64;
/** The minimum length of a tenant identifier string (after the prefix). */
export const TENANT_ID_MIN_LENGTH = 8;

/**
 * A tenant identifier is a non-empty string, between
 * `TENANT_ID_MIN_LENGTH` and `TENANT_ID_MAX_LENGTH` characters, matching
 * the canonical FleetOS tenant-id grammar:
 * `tnt_` prefix followed by one or more URL-safe base32 characters
 * (lowercase a-z plus 0-9). This grammar keeps tenant ids safe for use in
 * URLs, log lines, SQL identifiers, and object-storage prefixes.
 */
export const TENANT_ID_PATTERN = /^tnt_[a-z0-9]{8,64}$/;

/**
 * A pure validation helper for tenant identifiers. Returns `true` if the
 * underlying string of a `TenantId` candidate matches the canonical
 * FleetOS tenant-id grammar; `false` otherwise.
 *
 * This function does NOT throw — callers decide how to react (e.g., wrap
 * in a `ValidationError` from `errors.ts`).
 *
 * @param tenantId the candidate tenant identifier
 * @returns true if the candidate is well-formed
 */
export function isValidTenantId(tenantId: TenantId): boolean {
  return (
    typeof tenantId === "string" &&
    tenantId.length >= TENANT_ID_MIN_LENGTH &&
    tenantId.length <= TENANT_ID_MAX_LENGTH &&
    TENANT_ID_PATTERN.test(tenantId)
  );
}

/**
 * Result of a `TenantRef` validation. The error cases are enumerable so
 * that callers can map them to specific `ValidationError` codes without
 * parsing human messages.
 */
export type TenantRefValidation =
  | { ok: true; tenantId: TenantId }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "bad_format" };

/**
 * Validate a `TenantRef` candidate. The return value is a tagged union so
 * that callers can branch on the failure mode without try/catch.
 *
 * A `TenantRef` is the same as a `TenantId` at the type level — the term
 * "ref" is used in the spec to emphasize that a contract references a
 * tenant (the tenant itself is owned by `@fleetos/identity`).
 *
 * @param tenantId the candidate tenant reference
 * @returns a tagged validation result
 */
export function validateTenantRef(tenantId: TenantId): TenantRefValidation {
  if (typeof tenantId !== "string") {
    return { ok: false, reason: "empty" };
  }
  if (tenantId.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (tenantId.length < TENANT_ID_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (tenantId.length > TENANT_ID_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return { ok: false, reason: "bad_format" };
  }
  return { ok: true, tenantId };
}
