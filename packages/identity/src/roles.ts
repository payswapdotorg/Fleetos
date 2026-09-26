/**
 * @fleetos/identity — Role assignment records + deterministic permission
 * resolution (W012 D2).
 *
 * The role model is deliberately flat and deterministic:
 *   - a `RoleDefinition` maps a role name to a sorted, unique permission set;
 *   - a `RoleAssignment` binds a principal (within a tenant) to a role,
 *     optionally time-boxed by an injected `expiresAt`;
 *   - `resolvePermissions` folds the active assignments of one principal
 *     into a sorted, unique permission set — a pure function of its inputs
 *     evaluated at an injected time `at` (no clock reads).
 *
 * Resolution NEVER throws on data problems (unknown roles, expired
 * assignments): deviations are reported in the `skipped` list so callers
 * decide. The decision boundary stays deterministic.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { PrincipalRef } from "./principal";

/**
 * A permission name. Convention: `<domain>.<action>` — for example
 * `device.read`, `procurement.order.create`, `software.entitlement.grant`.
 * The consequential flag lives on the ACTION CATALOG (authorization.ts),
 * not on the permission string.
 */
export type PermissionName = string;

/**
 * A role definition: role name -> permission set. Constructors normalize
 * the permission set to sorted-unique; the frozen record carries it as a
 * readonly array.
 */
export interface RoleDefinition {
  /** The role name, e.g. "fleet.admin" (stable, machine-matched). */
  readonly name: string;
  /** The sorted-unique permission set granted by this role. */
  readonly permissions: readonly PermissionName[];
  /** Optional human description. */
  readonly description?: string;
}

/**
 * Construct a `RoleDefinition` with a normalized (sorted-unique) permission
 * set. Deterministic: the same input permissions produce the same record
 * regardless of input order or duplicates.
 *
 * @param name the role name (non-empty string)
 * @param permissions the permission names (order-independent)
 * @param description optional human description
 * @returns a frozen RoleDefinition
 * @throws TypeError on an empty name
 */
export function makeRoleDefinition(
  name: string,
  permissions: readonly PermissionName[],
  description?: string,
): RoleDefinition {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("makeRoleDefinition: name must be a non-empty string");
  }
  const normalized = [...new Set(permissions)].sort();
  return frozen({ name, permissions: Object.freeze(normalized), description });
}

/**
 * A role assignment record: principal -> role, within a tenant, optionally
 * time-boxed. Assignments are data (created by admin flows of later waves);
 * resolution is the pure fold below.
 */
export interface RoleAssignment {
  /** The tenant the assignment belongs to (tenant isolation). */
  readonly tenantId: TenantId;
  /** The principal the assignment binds (see principal.ts grammar). */
  readonly principalId: string;
  /** The role name the principal is assigned to. */
  readonly roleName: string;
  /** ISO 8601 assignment timestamp (injected). */
  readonly assignedAt: string;
  /** The principal that made the assignment (admin actor). */
  readonly assignedBy: string;
  /** Optional ISO 8601 expiry — the assignment is inactive at/past it. */
  readonly expiresAt?: string;
}

/**
 * Construct a `RoleAssignment`. Deterministic and frozen.
 *
 * @param input the assignment fields
 * @returns a frozen RoleAssignment
 * @throws TypeError on empty identifiers
 */
export function makeRoleAssignment(input: RoleAssignment): RoleAssignment {
  if (typeof input.principalId !== "string" || input.principalId.length === 0) {
    throw new TypeError("makeRoleAssignment: principalId must be a non-empty string");
  }
  if (typeof input.roleName !== "string" || input.roleName.length === 0) {
    throw new TypeError("makeRoleAssignment: roleName must be a non-empty string");
  }
  return frozen({ ...input });
}

/** Why an assignment contributed nothing to the resolved permission set. */
export type RoleSkipReason = "unknown_role" | "expired" | "invalid_expiry";

/** One skipped assignment, disclosed for auditability. */
export interface SkippedAssignment {
  readonly roleName: string;
  readonly reason: RoleSkipReason;
}

/**
 * The deterministic result of resolving one principal's permissions.
 */
export interface ResolvedPermissions {
  /** The principal the resolution is for. */
  readonly principalId: string;
  /** The tenant scope of the resolution. */
  readonly tenantId: TenantId;
  /** Sorted-unique permission names from all active assignments. */
  readonly permissions: readonly PermissionName[];
  /** Sorted-unique role names that contributed permissions. */
  readonly roles: readonly string[];
  /** Assignments that contributed nothing, with machine-stable reasons. */
  readonly skipped: readonly SkippedAssignment[];
}

/**
 * Parse an ISO 8601 timestamp to epoch millis; undefined when unparseable.
 * Used for fail-closed expiry handling.
 */
function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Resolve the effective permission set of a principal at the injected time
 * `at`. PURE and deterministic: the same inputs produce byte-identical
 * output; assignments are filtered by (tenantId, principalId), inactive ones
 * are skipped with a disclosed reason, and the output sets are sorted.
 *
 * Fail-closed policy: an assignment whose `expiresAt` is unparseable is
 * treated as EXPIRED (skipped with reason "invalid_expiry"), and an
 * unparseable evaluation time `at` treats every time-boxed assignment as
 * expired — a malformed time box or clock input never widens permissions.
 *
 * @param principal the principal (or ref) being resolved
 * @param assignments all assignment records visible to the resolver
 * @param roles the known role definitions
 * @param at the injected evaluation time (ISO 8601)
 * @returns a frozen ResolvedPermissions
 */
export function resolvePermissions(
  principal: PrincipalRef,
  assignments: readonly RoleAssignment[],
  roles: readonly RoleDefinition[],
  at: string,
): ResolvedPermissions {
  const roleMap = new Map<string, RoleDefinition>(roles.map((r) => [r.name, r]));
  // Fail-closed: an unparseable evaluation time `at` treats every time-boxed
  // assignment as expired. Unbounded assignments still contribute — there is
  // no time box to evaluate.
  const atMs = parseIsoMs(at);

  const permissions = new Set<PermissionName>();
  const contributingRoles = new Set<string>();
  const skipped: SkippedAssignment[] = [];

  for (const assignment of assignments) {
    // Tenant + principal scoping: only this principal's assignments in this
    // tenant contribute. Foreign records are ignored entirely (isolation).
    if (assignment.tenantId !== principal.tenantId) continue;
    if (assignment.principalId !== principal.principalId) continue;

    const role = roleMap.get(assignment.roleName);
    if (role === undefined) {
      skipped.push({ roleName: assignment.roleName, reason: "unknown_role" });
      continue;
    }

    if (assignment.expiresAt !== undefined) {
      const expiryMs = parseIsoMs(assignment.expiresAt);
      if (expiryMs === undefined) {
        // Fail-closed: malformed expiry cannot widen permissions.
        skipped.push({ roleName: assignment.roleName, reason: "invalid_expiry" });
        continue;
      }
      if (atMs === undefined || atMs >= expiryMs) {
        skipped.push({ roleName: assignment.roleName, reason: "expired" });
        continue;
      }
    }

    for (const permission of role.permissions) {
      permissions.add(permission);
    }
    contributingRoles.add(assignment.roleName);
  }

  return frozen({
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    permissions: Object.freeze([...permissions].sort()),
    roles: Object.freeze([...contributingRoles].sort()),
    skipped: Object.freeze(
      skipped.sort((a, b) =>
        a.roleName === b.roleName
          ? a.reason < b.reason
            ? -1
            : 1
          : a.roleName < b.roleName
            ? -1
            : 1,
      ),
    ),
  });
}
