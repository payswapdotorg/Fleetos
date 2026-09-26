/**
 * @fleetos/identity — Scoped authorization primitives (W012 D4).
 *
 * The PRIMITIVE layer only: `PermissionCheck` (principal, resource scope,
 * action) evaluated by a deterministic, pure function to allow/deny WITH
 * machine-stable reasons. Authorization is policy, not ML — every decision
 * is a total function of the injected inputs.
 *
 * Scope model (per the work order):
 *   - tenant-wide   — covers everything in one tenant;
 *   - device-scoped — covers exactly one device;
 *   - workload-scoped — covers exactly one workload.
 *
 * Consequential actions (ARCHITECTURE-LOCK item 4: "all consequential
 * actions have authorization, idempotency, audit and verification") require
 * an EXPLICIT GRANT in addition to the role permission: a role alone never
 * authorizes a consequential action.
 *
 * The policy EVALUATION strategy (Contract Guardian) is W031 — deliberately
 * NOT built here. This module answers only "is this principal permitted to
 * perform this action on this scope, given these records?".
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  AuthorizationError as AuthorizationErrorShape,
  CorrelationId,
  DeviceId,
  TenantId,
  WorkloadId,
} from "@fleetos/contracts";
import { frozen } from "./internal";
import { authorizationError } from "./errors";
import type { Principal } from "./principal";
import { principalRef } from "./principal";
import type { RoleAssignment, RoleDefinition } from "./roles";
import { resolvePermissions } from "./roles";

// ---------------------------------------------------------------------------
// Scope model
// ---------------------------------------------------------------------------

/** The scope kind discriminators. */
export const SCOPE_KIND_TENANT = "tenant" as const;
export const SCOPE_KIND_DEVICE = "device" as const;
export const SCOPE_KIND_WORKLOAD = "workload" as const;

/** The union of scope kinds. */
export type ScopeKind =
  | typeof SCOPE_KIND_TENANT
  | typeof SCOPE_KIND_DEVICE
  | typeof SCOPE_KIND_WORKLOAD;

/**
 * The resource scope of a permission check. Every scope carries its tenant;
 * device/workload scopes narrow to exactly one resource. All fields are
 * branded ids from the frozen contracts.
 */
export type ResourceScope =
  | { readonly kind: typeof SCOPE_KIND_TENANT; readonly tenantId: TenantId }
  | { readonly kind: typeof SCOPE_KIND_DEVICE; readonly tenantId: TenantId; readonly deviceId: DeviceId }
  | {
      readonly kind: typeof SCOPE_KIND_WORKLOAD;
      readonly tenantId: TenantId;
      readonly workloadId: WorkloadId;
    };

/**
 * Pure coverage test: does `covering` scope include `covered`?
 *
 * Rules (deterministic):
 *   - a tenant scope covers every scope of the SAME tenant;
 *   - a device scope covers only the same-device scope of the same tenant;
 *   - a workload scope covers only the same-workload scope of the same
 *     tenant;
 *   - anything else (different tenant or different kind/resource) covers
 *     nothing.
 *
 * @param covering the broader scope (e.g. of a grant)
 * @param covered the narrower scope (e.g. of a check)
 * @returns true when `covering` includes `covered`
 */
export function scopeCovers(covering: ResourceScope, covered: ResourceScope): boolean {
  if (covering.tenantId !== covered.tenantId) return false;
  if (covering.kind === SCOPE_KIND_TENANT) return true;
  if (covering.kind === SCOPE_KIND_DEVICE) {
    return covered.kind === SCOPE_KIND_DEVICE && covering.deviceId === covered.deviceId;
  }
  return covered.kind === SCOPE_KIND_WORKLOAD && covering.workloadId === covered.workloadId;
}

/**
 * Construct a tenant-wide scope. Deterministic and frozen.
 *
 * @param tenantId the tenant
 * @returns a frozen ResourceScope
 */
export function tenantScope(tenantId: TenantId): ResourceScope {
  return frozen({ kind: SCOPE_KIND_TENANT, tenantId });
}

/**
 * Construct a device scope. Deterministic and frozen.
 *
 * @param tenantId the tenant
 * @param deviceId the device
 * @returns a frozen ResourceScope
 */
export function deviceScope(tenantId: TenantId, deviceId: DeviceId): ResourceScope {
  return frozen({ kind: SCOPE_KIND_DEVICE, tenantId, deviceId });
}

/**
 * Construct a workload scope. Deterministic and frozen.
 *
 * @param tenantId the tenant
 * @param workloadId the workload
 * @returns a frozen ResourceScope
 */
export function workloadScope(tenantId: TenantId, workloadId: WorkloadId): ResourceScope {
  return frozen({ kind: SCOPE_KIND_WORKLOAD, tenantId, workloadId });
}

// ---------------------------------------------------------------------------
// Action catalog (consequential-action flag)
// ---------------------------------------------------------------------------

/**
 * An action descriptor: the permission name exercised by an action plus the
 * consequential flag. A CONSEQUENTIAL action requires an explicit grant on
 * top of the role permission (ARCHITECTURE-LOCK item 4).
 */
export interface ActionDescriptor {
  /** The permission name this action exercises (e.g. "device.wipe"). */
  readonly action: string;
  /** True when the action is consequential (requires an explicit grant). */
  readonly consequential: boolean;
  /** Optional human description. */
  readonly description?: string;
}

/**
 * Construct an `ActionDescriptor`. Deterministic and frozen.
 *
 * @param input the descriptor fields
 * @returns a frozen ActionDescriptor
 * @throws TypeError on an empty action name
 */
export function makeActionDescriptor(input: ActionDescriptor): ActionDescriptor {
  if (typeof input.action !== "string" || input.action.length === 0) {
    throw new TypeError("makeActionDescriptor: action must be a non-empty string");
  }
  return frozen({ ...input });
}

/** A lookup of action descriptors by permission name. */
export interface ActionCatalog {
  /** @param action the permission name */
  lookup(action: string): ActionDescriptor | undefined;
}

/**
 * Construct an `ActionCatalog` from descriptors. Later occurrence wins on
 * duplicate action names (data policy: last-write-wins ingestion), and
 * lookup order is irrelevant — the catalog is a pure map.
 *
 * @param actions the descriptors
 * @returns a frozen ActionCatalog
 */
export function createActionCatalog(actions: readonly ActionDescriptor[]): ActionCatalog {
  const map = new Map<string, ActionDescriptor>(actions.map((a) => [a.action, a]));
  return frozen({
    lookup(action: string): ActionDescriptor | undefined {
      return map.get(action);
    },
  });
}

// ---------------------------------------------------------------------------
// Explicit grants (consequential actions)
// ---------------------------------------------------------------------------

/**
 * An explicit grant: the additional, scoped, time-boxed authorization a
 * consequential action requires. A role permission alone NEVER authorizes a
 * consequential action.
 */
export interface ExplicitGrant {
  /** Stable grant identifier (for audit correlation). */
  readonly grantId: string;
  /** The tenant the grant belongs to. */
  readonly tenantId: TenantId;
  /** The principal the grant is for. */
  readonly principalId: string;
  /** The consequential action the grant covers. */
  readonly action: string;
  /** The scope the grant covers (see `scopeCovers`). */
  readonly scope: ResourceScope;
  /** ISO 8601 grant timestamp (injected). */
  readonly grantedAt: string;
  /** The principal that made the grant (admin actor). */
  readonly grantedBy: string;
  /** Optional ISO 8601 expiry — the grant is inactive at/past it. */
  readonly expiresAt?: string;
}

/**
 * Construct an `ExplicitGrant`. Deterministic and frozen.
 *
 * @param input the grant fields
 * @returns a frozen ExplicitGrant
 * @throws TypeError on empty identifiers
 */
export function makeExplicitGrant(input: ExplicitGrant): ExplicitGrant {
  if (typeof input.grantId !== "string" || input.grantId.length === 0) {
    throw new TypeError("makeExplicitGrant: grantId must be a non-empty string");
  }
  if (typeof input.principalId !== "string" || input.principalId.length === 0) {
    throw new TypeError("makeExplicitGrant: principalId must be a non-empty string");
  }
  if (typeof input.action !== "string" || input.action.length === 0) {
    throw new TypeError("makeExplicitGrant: action must be a non-empty string");
  }
  return frozen({ ...input });
}

// ---------------------------------------------------------------------------
// Permission check — deterministic allow/deny with reasons
// ---------------------------------------------------------------------------

/**
 * A permission check: principal x resource scope x action.
 */
export interface PermissionCheck {
  /** The acting principal (tenant-bound). */
  readonly principal: Principal;
  /** The resource scope being acted on. */
  readonly scope: ResourceScope;
  /** The action (permission name) being performed. */
  readonly action: string;
}

/** The decision outcome. */
export type AuthorizationOutcome = "allow" | "deny";

/**
 * The deterministic decision: allow or deny, always with machine-stable
 * reasons (sorted, unique). Deny reasons never enumerate what WOULD have
 * been granted — they name exactly the failed requirement.
 */
export interface AuthorizationDecision {
  readonly decision: AuthorizationOutcome;
  readonly reasons: readonly string[];
}

/**
 * The injected inputs of a permission check. All of them are data records
 * (assignments, roles, grants, action descriptors) plus the injected
 * evaluation time `at` (no clock reads).
 */
export interface AuthorizationInputs {
  /** Role assignment records visible to the evaluator. */
  readonly assignments: readonly RoleAssignment[];
  /** Known role definitions. */
  readonly roles: readonly RoleDefinition[];
  /** Explicit grants (consequential actions only). */
  readonly grants: readonly ExplicitGrant[];
  /** The action catalog (or raw descriptors). */
  readonly actions: readonly ActionDescriptor[] | ActionCatalog;
  /** The injected evaluation time (ISO 8601). */
  readonly at: string;
}

function isActionCatalog(actions: AuthorizationInputs["actions"]): actions is ActionCatalog {
  return !Array.isArray(actions);
}

function catalogOf(actions: AuthorizationInputs["actions"]): ActionCatalog {
  return isActionCatalog(actions) ? actions : createActionCatalog(actions);
}

function parseIsoMs(value: string): number | undefined {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Evaluate a `PermissionCheck`. PURE and deterministic: the same inputs
 * always produce the same decision AND the same sorted reasons.
 *
 * Evaluation order (fixed precedence; the first failure short-circuits):
 *   1. `tenant_mismatch` — the principal's tenant differs from the scope's
 *      tenant (structural tenant isolation).
 *   2. `invalid_evaluation_time` — the injected `at` is unparseable
 *      (fail-closed).
 *   3. `unknown_action` — the action is not in the catalog.
 *   4. `missing_permission` — the resolved permission set (deterministic
 *      fold of active role assignments) does not include the action.
 *   5. `consequential_requires_explicit_grant` — the action is
 *      consequential and no active explicit grant covers (principal,
 *      action, scope) — a role permission alone never suffices.
 *   6. allow — reasons name the contributing roles (and the covering grant
 *      for consequential actions).
 *
 * @param check the permission check
 * @param inputs the injected authorization inputs
 * @returns a frozen AuthorizationDecision
 */
export function checkPermission(
  check: PermissionCheck,
  inputs: AuthorizationInputs,
): AuthorizationDecision {
  const deny = (reason: string): AuthorizationDecision =>
    frozen({ decision: "deny", reasons: Object.freeze([reason]) });

  // 1. Structural tenant isolation.
  if (check.principal.tenantId !== check.scope.tenantId) {
    return deny("tenant_mismatch");
  }

  // 2. Fail-closed evaluation time.
  const atMs = parseIsoMs(inputs.at);
  if (atMs === undefined) {
    return deny("invalid_evaluation_time");
  }

  // 3. Known action.
  const catalog = catalogOf(inputs.actions);
  const descriptor = catalog.lookup(check.action);
  if (descriptor === undefined) {
    return deny("unknown_action");
  }

  // 4. Deterministic permission resolution.
  const ref = principalRef(check.principal);
  const resolved = resolvePermissions(ref, inputs.assignments, inputs.roles, inputs.at);
  if (!resolved.permissions.includes(check.action)) {
    return deny("missing_permission");
  }

  // 5. Consequential actions require an explicit grant covering the scope.
  if (descriptor.consequential) {
    const activeGrants = inputs.grants.filter((grant) => {
      if (grant.tenantId !== ref.tenantId) return false;
      if (grant.principalId !== ref.principalId) return false;
      if (grant.action !== check.action) return false;
      if (grant.expiresAt !== undefined) {
        const expiryMs = parseIsoMs(grant.expiresAt);
        if (expiryMs === undefined || atMs >= expiryMs) return false;
      }
      return scopeCovers(grant.scope, check.scope);
    });
    if (activeGrants.length === 0) {
      return deny("consequential_requires_explicit_grant");
    }
    // Reasons are globally sorted-unique (deterministic contract).
    const reasons = new Set<string>([
      ...resolved.roles.map((r) => `role:${r}`),
      ...activeGrants.map((g) => `explicit_grant:${g.grantId}`),
    ]);
    return frozen({
      decision: "allow",
      reasons: Object.freeze([...reasons].sort()),
    });
  }

  // 6. Allow (non-consequential).
  return frozen({
    decision: "allow",
    reasons: Object.freeze(resolved.roles.map((r) => `role:${r}`).sort()),
  });
}

/**
 * Project a deny decision to an `AuthorizationError`-shaped `FleetError`
 * (403 via `toApiError`). Pure; callers decide to throw or return.
 *
 * @param check the denied permission check
 * @param decision the deny decision
 * @param correlationId the correlation id of the originating request
 * @returns a frozen AuthorizationError-shaped FleetError
 */
export function toAuthorizationFleetError(
  check: PermissionCheck,
  decision: AuthorizationDecision,
  correlationId: CorrelationId,
): AuthorizationErrorShape {
  if (decision.decision !== "deny") {
    throw new TypeError("toAuthorizationFleetError: decision must be a deny");
  }
  return authorizationError(
    "authorization.denied",
    `toAuthorizationFleetError: ${check.action} denied for ${check.principal.principalId}`,
    check.principal.principalId,
    check.action,
    decision.reasons.join(","),
    check.principal.tenantId,
    correlationId,
  );
}
