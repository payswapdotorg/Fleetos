/**
 * @fleetos/identity — FleetError-shaped identity errors.
 *
 * Errors that cross a module boundary MUST be expressible as a `FleetError`
 * (see `@fleetos/contracts` errors.ts). This package throws small Error
 * subclasses that CARRY their `FleetError` projection, so callers can either
 * catch the class or read the frozen taxonomy shape.
 *
 * Conventions (frozen contracts):
 *   - tenant scope: context-free violations use the synthetic `tnt_system`
 *     tenant id documented on `FleetErrorBase` in @fleetos/contracts.
 *   - correlation: context-free violations use the deterministic sentinel
 *     `cor_system` (a fresh random correlation id would break determinism).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  AuthorizationError,
  CorrelationId,
  FleetError,
  TenantId,
  ValidationFailure,
} from "@fleetos/contracts";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * The synthetic tenant id used when a violation predates tenant attribution
 * (context-free store access). Mirrors the frozen `FleetErrorBase` doc
 * convention: "system errors use a synthetic `tnt_system` tenant id".
 */
export const SYNTHETIC_SYSTEM_TENANT_ID: TenantId = asTenantId("tnt_system");

/**
 * The deterministic correlation sentinel used when no request context exists
 * (the frozen `FleetErrorBase` convention is "a fresh correlation id is
 * stamped"; a random one would violate the no-entropy determinism rule of
 * this package, so a fixed sentinel is used instead — judgment call,
 * documented in SKELETON-NOTES lane C).
 */
export const SYNTHETIC_SYSTEM_CORRELATION_ID: CorrelationId = asCorrelationId("cor_system");

/**
 * Base class for identity errors. Carries the frozen `FleetError` projection
 * so callers can map to `ApiError` via `toApiError` without instanceof chains.
 */
export class IdentityError extends Error {
  /** The stable machine code (mirrors `fleet.code`). */
  readonly code: string;
  /** The FleetError taxonomy projection (frozen). */
  readonly fleet: FleetError;

  constructor(fleet: FleetError) {
    super(fleet.message);
    this.name = "IdentityError";
    this.code = fleet.code;
    this.fleet = frozen(fleet);
  }
}

/**
 * Build a `ValidationError`-shaped `FleetError` (see contracts errors.ts).
 * Pure helper — callers decide to throw it or return it.
 *
 * @param code the stable machine code (e.g. "identity.invalid_principal")
 * @param message the human-readable message
 * @param failures the list of validation failures
 * @param tenantId the tenant scope
 * @param correlationId the correlation id
 * @returns a frozen ValidationError-shaped FleetError
 */
export function validationError(
  code: string,
  message: string,
  failures: readonly ValidationFailure[],
  tenantId: TenantId,
  correlationId: CorrelationId,
): FleetError {
  return frozen({
    kind: "ValidationError",
    code,
    message,
    failures: Object.freeze([...failures]),
    tenantId,
    correlationId,
  });
}

/**
 * Build an `AuthorizationError`-shaped `FleetError` (see contracts errors.ts).
 * Pure helper — callers decide to throw it or return it.
 *
 * @param code the stable machine code (e.g. "tenant.isolation.cross_tenant")
 * @param message the human-readable message
 * @param principalId the principal that was denied (or "unknown")
 * @param action the action that was attempted
 * @param reason the machine-stable denial reason
 * @param tenantId the tenant scope
 * @param correlationId the correlation id
 * @returns a frozen AuthorizationError-shaped FleetError
 */
export function authorizationError(
  code: string,
  message: string,
  principalId: string,
  action: string,
  reason: string,
  tenantId: TenantId,
  correlationId: CorrelationId,
): AuthorizationError {
  return frozen({
    kind: "AuthorizationError",
    code,
    message,
    principalId,
    action,
    reason,
    tenantId,
    correlationId,
  });
}
