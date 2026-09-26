/**
 * @fleetos/identity — Actor identity: the principal model (W012 D2).
 *
 * Principals are the actors of the control plane: users (humans), services
 * (control-plane components acting on their own behalf), and agents (device
 * agents acting for a specific enrolled device). Every principal is bound to
 * EXACTLY ONE tenant — a principal is created by tenant enrollment and
 * carries its tenant scope structurally (`TenantScoped` from the frozen
 * contracts).
 *
 * Principal identity is deterministic: the constructors are pure, and the
 * derived `principalId` strings follow a stable grammar so role
 * assignments, explicit grants, and audit actor references key on them
 * without parsing.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId, UserId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { frozen } from "./internal";
import { IdentityError, SYNTHETIC_SYSTEM_CORRELATION_ID } from "./errors";
import { SYNTHETIC_SYSTEM_TENANT_ID } from "./errors";
import { validationError } from "./errors";

/** The principal kind discriminators. */
export const PRINCIPAL_KIND_USER = "user" as const;
export const PRINCIPAL_KIND_SERVICE = "service" as const;
export const PRINCIPAL_KIND_AGENT = "agent" as const;

/** The union of principal kinds. */
export type PrincipalKind =
  | typeof PRINCIPAL_KIND_USER
  | typeof PRINCIPAL_KIND_SERVICE
  | typeof PRINCIPAL_KIND_AGENT;

/**
 * The compact reference to a principal: kind + principalId + tenant scope.
 * This is the shape role assignments, explicit grants, and audit records
 * key on. `Principal` itself satisfies it structurally.
 */
export interface PrincipalRef extends TenantScoped {
  readonly kind: PrincipalKind;
  readonly principalId: string;
}

/**
 * Base shape of every principal. `principalId` is the stable, derived
 * identifier (see the per-kind grammar below).
 */
export interface PrincipalBase extends PrincipalRef {
  readonly kind: PrincipalKind;
  readonly principalId: string;
}

/**
 * A human actor. `principalId` grammar: `usr:<userId>`.
 */
export interface UserPrincipal extends PrincipalBase {
  readonly kind: typeof PRINCIPAL_KIND_USER;
  readonly userId: UserId;
}

/**
 * A control-plane service actor (e.g. the ingestion boundary, a scheduler).
 * `principalId` grammar: `svc:<serviceName>`.
 */
export interface ServicePrincipal extends PrincipalBase {
  readonly kind: typeof PRINCIPAL_KIND_SERVICE;
  readonly serviceName: string;
}

/**
 * A device agent actor, bound to one enrolled device. `principalId`
 * grammar: `agt:<deviceId>`.
 */
export interface AgentPrincipal extends PrincipalBase {
  readonly kind: typeof PRINCIPAL_KIND_AGENT;
  readonly deviceId: DeviceId;
}

/** The principal discriminated union. */
export type Principal = UserPrincipal | ServicePrincipal | AgentPrincipal;

function principalFailure(path: string, reason: string): IdentityError {
  return new IdentityError(
    validationError(
      "identity.invalid_principal",
      `makePrincipal: ${reason}`,
      [{ path, reason }],
      SYNTHETIC_SYSTEM_TENANT_ID,
      SYNTHETIC_SYSTEM_CORRELATION_ID,
    ),
  );
}

/**
 * Construct a `UserPrincipal`. Deterministic and frozen.
 *
 * @param tenantId the tenant the user belongs to (validated against the
 *   frozen grammar)
 * @param userId the authenticated user id (non-empty string)
 * @returns a frozen UserPrincipal
 * @throws IdentityError on invalid tenant or empty user id
 */
export function makeUserPrincipal(tenantId: TenantId, userId: UserId): UserPrincipal {
  if (typeof userId !== "string" || userId.length === 0) {
    throw principalFailure("/userId", "user id must be a non-empty string");
  }
  return frozen({
    kind: PRINCIPAL_KIND_USER,
    principalId: `usr:${userId}`,
    tenantId,
    userId,
  } satisfies UserPrincipal);
}

/**
 * Construct a `ServicePrincipal`. Deterministic and frozen.
 *
 * @param tenantId the tenant the service acts within
 * @param serviceName the service name (non-empty string, e.g.
 *   "device-model.ingestion")
 * @returns a frozen ServicePrincipal
 * @throws IdentityError on empty service name
 */
export function makeServicePrincipal(tenantId: TenantId, serviceName: string): ServicePrincipal {
  if (typeof serviceName !== "string" || serviceName.length === 0) {
    throw principalFailure("/serviceName", "service name must be a non-empty string");
  }
  return frozen({
    kind: PRINCIPAL_KIND_SERVICE,
    principalId: `svc:${serviceName}`,
    tenantId,
    serviceName,
  } satisfies ServicePrincipal);
}

/**
 * Construct an `AgentPrincipal` bound to one device. Deterministic and
 * frozen.
 *
 * @param tenantId the tenant the device belongs to
 * @param deviceId the enrolled device id (non-empty string)
 * @returns a frozen AgentPrincipal
 * @throws IdentityError on empty device id
 */
export function makeAgentPrincipal(tenantId: TenantId, deviceId: DeviceId): AgentPrincipal {
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw principalFailure("/deviceId", "device id must be a non-empty string");
  }
  return frozen({
    kind: PRINCIPAL_KIND_AGENT,
    principalId: `agt:${deviceId}`,
    tenantId,
    deviceId,
  } satisfies AgentPrincipal);
}

/**
 * Project any `Principal` (or structurally compatible record) to its compact
 * `PrincipalRef`. Pure; useful when storing references without the full
 * principal.
 *
 * @param principal the principal to project
 * @returns a frozen PrincipalRef
 */
export function principalRef(principal: PrincipalRef): PrincipalRef {
  return frozen({
    kind: principal.kind,
    principalId: principal.principalId,
    tenantId: principal.tenantId,
  });
}

/**
 * Type-guard a value as a `PrincipalRef`-bearing record. Checks the
 * discriminator set and non-empty identifier strings at the runtime
 * boundary (parsed JSON, wire payloads).
 *
 * @param value the candidate
 * @returns true when the value structurally satisfies PrincipalRef
 */
export function isPrincipalRef(value: unknown): value is PrincipalRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as { kind?: unknown; principalId?: unknown; tenantId?: unknown };
  return (
    (v.kind === PRINCIPAL_KIND_USER ||
      v.kind === PRINCIPAL_KIND_SERVICE ||
      v.kind === PRINCIPAL_KIND_AGENT) &&
    typeof v.principalId === "string" &&
    v.principalId.length > 0 &&
    typeof v.tenantId === "string" &&
    v.tenantId.length > 0
  );
}
