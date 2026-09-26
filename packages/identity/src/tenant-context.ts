/**
 * @fleetos/identity — Tenant isolation primitives (W012 D1).
 *
 * FleetOS is multi-tenant: tenants and identities are owned by the control
 * plane (`spec/ARCHITECTURE.md` § Control plane) and "tenant isolation is
 * enforced at persistence and action boundaries"
 * (`spec/ARCHITECTURE-LOCK.md` item 17).
 *
 * The structural rule of this lane: a `TenantContext` MUST accompany every
 * repository/store operation. Store interfaces in this package (and, by
 * convention, every store implemented by later lane-C work items) take the
 * context as their FIRST parameter; the runtime guard rejects context-free
 * access even when a caller bypasses the type system.
 *
 * The decision boundary stays deterministic — the guard is a pure policy
 * check, never ML.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  TenantId,
  TenantRefValidation,
  TenantScoped,
} from "@fleetos/contracts";
import { asTenantId, validateTenantRef } from "@fleetos/contracts";
import { frozen } from "./internal";
import {
  IdentityError,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  authorizationError,
} from "./errors";

/**
 * The context that MUST accompany every repository/store operation in this
 * lane. It carries the acting tenant scope (structural isolation) and an
 * optional correlation id for tracing.
 *
 * `tenantId` is non-optional: an operation without a tenant scope is
 * forbidden by construction.
 */
export interface TenantContext {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) context check. Tagged union so callers
 * can branch on the failure mode without try/catch.
 */
export type TenantContextCheck =
  | { readonly ok: true; readonly tenantId: TenantId }
  | {
      readonly ok: false;
      readonly reason: "missing_context" | "invalid_tenant_id";
      readonly detail: string;
    };

/**
 * Construct a `TenantContext`. Validates the tenant id against the canonical
 * FleetOS tenant-id grammar (`validateTenantRef` from the frozen contracts)
 * and throws an `IdentityError` (ValidationError shape) when invalid.
 *
 * Deterministic: the same inputs produce the same context or the same error.
 *
 * @param tenantId the tenant scope (must satisfy the frozen grammar)
 * @param correlationId optional correlation id for tracing
 * @returns a frozen TenantContext
 * @throws IdentityError when the tenant id does not satisfy the grammar
 */
export function makeTenantContext(
  tenantId: TenantId,
  correlationId?: CorrelationId,
): TenantContext {
  const ref: TenantRefValidation = validateTenantRef(tenantId);
  if (!ref.ok) {
    throw new IdentityError({
      kind: "ValidationError",
      code: "tenant.context.invalid",
      message: `makeTenantContext: invalid tenant id (${ref.reason})`,
      failures: [
        { path: "/tenantId", reason: ref.reason },
      ],
      tenantId: SYNTHETIC_SYSTEM_TENANT_ID,
      correlationId: SYNTHETIC_SYSTEM_CORRELATION_ID,
    });
  }
  return frozen({ tenantId, correlationId });
}

/**
 * Pure, non-throwing context check. Use at store boundaries that prefer
 * tagged results over exceptions.
 *
 * @param ctx the candidate context (`null`/`undefined` allowed — that is the
 *   context-free case the guard exists to reject)
 * @returns a tagged check result
 */
export function checkTenantContext(ctx: TenantContext | null | undefined): TenantContextCheck {
  if (ctx === null || ctx === undefined || typeof ctx !== "object") {
    return {
      ok: false,
      reason: "missing_context",
      detail: "no TenantContext accompanies the operation",
    };
  }
  const tenantId: unknown = (ctx as { readonly tenantId?: unknown }).tenantId;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return {
      ok: false,
      reason: "missing_context",
      detail: "TenantContext carries no tenantId",
    };
  }
  const ref = validateTenantRef(asTenantId(tenantId));
  if (!ref.ok) {
    return {
      ok: false,
      reason: "invalid_tenant_id",
      detail: `tenantId fails the canonical grammar (${ref.reason})`,
    };
  }
  return { ok: true, tenantId: ref.tenantId };
}

/**
 * The runtime guard that rejects context-free access. Returns the validated
 * tenant id on success; throws `TenantIsolationError` otherwise.
 *
 * The type system already requires a `TenantContext` on every store
 * operation; this guard also rejects callers that bypass the types (e.g.
 * `store.get(undefined as never, ...)`), which is what "context-free access"
 * means at the persistence boundary.
 *
 * @param ctx the context that must accompany the operation
 * @returns the validated tenant id
 * @throws TenantIsolationError when the context is absent or invalid
 */
export function requireTenantContext(ctx: TenantContext | null | undefined): TenantId {
  const check = checkTenantContext(ctx);
  if (!check.ok) {
    throw new TenantIsolationError(
      "tenant.isolation.context_free",
      `requireTenantContext: ${check.detail}`,
      "unknown",
      "tenant.store.access",
      check.reason,
    );
  }
  return check.tenantId;
}

/**
 * The guard that rejects cross-tenant access: the acting context's tenant
 * must equal the tenant-scoped resource's tenant. Throws on violation.
 *
 * @param ctx the acting context
 * @param resource the tenant-scoped resource being accessed
 * @throws TenantIsolationError when the scopes differ or the context is absent
 */
export function assertTenantIsolation(ctx: TenantContext, resource: TenantScoped): void {
  const actingTenant = requireTenantContext(ctx);
  if (actingTenant !== resource.tenantId) {
    throw new TenantIsolationError(
      "tenant.isolation.cross_tenant",
      "assertTenantIsolation: acting context tenant does not match the resource tenant",
      "unknown",
      "tenant.store.access",
      "tenant_mismatch",
    );
  }
}

/**
 * Thrown by the isolation guards. Carries an `AuthorizationError`-shaped
 * `FleetError` projection (403 when translated via `toApiError`), because a
 * tenant-isolation violation is an authorization failure, not a policy
 * evaluation (`@fleetos/contracts` errors.ts distinguishes the two).
 */
export class TenantIsolationError extends IdentityError {
  /**
   * @param code the stable machine code
   * @param message the human-readable message
   * @param principalId the principal that was denied
   * @param action the action that was attempted
   * @param reason the machine-stable denial reason
   */
  constructor(
    code: "tenant.isolation.context_free" | "tenant.isolation.cross_tenant",
    message: string,
    principalId: string,
    action: string,
    reason: string,
  ) {
    super(
      authorizationError(
        code,
        message,
        principalId,
        action,
        reason,
        SYNTHETIC_SYSTEM_TENANT_ID,
        SYNTHETIC_SYSTEM_CORRELATION_ID,
      ),
    );
    this.name = "TenantIsolationError";
  }
}
