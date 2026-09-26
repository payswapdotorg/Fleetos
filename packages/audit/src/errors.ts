/**
 * @fleetos/audit — FleetError-shaped audit errors.
 *
 * Mirrors the identity package convention: small Error subclasses that
 * carry their `FleetError` projection so callers can map to `ApiError`
 * without instanceof chains.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CorrelationId,
  FleetError,
  TenantId,
  ValidationFailure,
} from "@fleetos/contracts";
import { frozen } from "./internal";

/**
 * Thrown when an audit append input fails validation. Carries a
 * `ValidationError`-shaped `FleetError` projection (400 via `toApiError`).
 */
export class AuditValidationError extends Error {
  /** The stable machine code (mirrors `fleet.code`). */
  readonly code: string;
  /** The FleetError taxonomy projection (frozen). */
  readonly fleet: FleetError;

  constructor(fleet: FleetError) {
    super(fleet.message);
    this.name = "AuditValidationError";
    this.code = fleet.code;
    this.fleet = frozen(fleet);
  }
}

/**
 * Build the `ValidationError`-shaped projection for an audit rejection.
 * Pure helper.
 *
 * @param message the human-readable message
 * @param failures the list of validation failures
 * @param tenantId the tenant scope of the rejected append
 * @param correlationId the correlation id of the rejected append
 * @returns a frozen ValidationError-shaped FleetError
 */
export function auditValidationFailure(
  message: string,
  failures: readonly ValidationFailure[],
  tenantId: TenantId,
  correlationId: CorrelationId,
): FleetError {
  return frozen({
    kind: "ValidationError",
    code: "audit.append.invalid",
    message,
    failures: Object.freeze([...failures]),
    tenantId,
    correlationId,
  });
}
