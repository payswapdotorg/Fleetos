/**
 * @fleetos/contracts — Error taxonomy + API wire shape.
 *
 * Every error that crosses a module boundary MUST be expressible as a
 * `FleetError`. The error carries a stable machine `code`, a human
 * message, and the tenant + correlation ids needed to trace it through
 * the audit trail. Module-specific error subclasses extend `FleetError` and
 * carry their own context.
 *
 * Reference: `spec/ARCHITECTURE-LOCK.md` item 4 (consequential actions
 * have authorization, idempotency, audit and verification).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId } from "./ids";

// ---------------------------------------------------------------------------
// FleetError base
// ---------------------------------------------------------------------------

/**
 * The stable machine code for a FleetError. Codes are dotted strings
 * following the convention `<domain>.<error>` — for example,
 * `policy.blocked`, `authorization.denied`, `adapter.unsupported`.
 *
 * Codes are STABLE: changing a code is a contract change requiring an
 * ADR. Callers (HTTP surfaces, CLI tools, monitoring) match on codes.
 */
export type FleetErrorCode = string;

/**
 * The base shape for every error that crosses a module boundary.
 *
 * `FleetError` is a discriminated union of the specific error subclasses
 * below. Callers can switch on the `kind` field to handle each subclass
 * without parsing the `message`.
 *
 * Every `FleetError` carries:
 *   - `code`: the stable machine code (callers match on this)
 *   - `message`: a human-readable message (NOT for matching)
 *   - `tenantId`: the tenant scope (never undefined; system errors use
 *     a synthetic `tnt_system` tenant id)
 *   - `correlationId`: the correlation id of the request that produced
 *     this error (never undefined; if no request context exists, a
 *     fresh correlation id is stamped)
 */
export interface FleetErrorBase {
  /** The stable machine code. Callers match on this; never localize. */
  readonly code: FleetErrorCode;
  /** Human-readable message. May be localized; never matched on. */
  readonly message: string;
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Correlation id of the request that produced this error. */
  readonly correlationId: CorrelationId;
}

// ---------------------------------------------------------------------------
// Specific error subclasses
// ---------------------------------------------------------------------------

/**
 * A domain-level error. Examples: an invariant violation, an illegal
 * state transition, a missing required field. The error is the domain's
 * way of saying "the requested operation does not make sense in the
 * current state."
 */
export interface DomainError extends FleetErrorBase {
  readonly kind: "DomainError";
  /** The domain context that produced the error (e.g., "device.lifecycle"). */
  readonly domain: string;
  /** The specific invariant that was violated. */
  readonly invariant?: string;
}

/**
 * A policy error. The Contract Guardian evaluated the action and returned
 * a decision of `BLOCK` or `REQUIRE_APPROVAL`. Carries the
 * `GuardianDecision` reference so the caller can surface rule ids and
 * evidence.
 */
export interface PolicyError extends FleetErrorBase {
  readonly kind: "PolicyError";
  /** The Guardian decision that caused the policy error. */
  readonly decision: "REQUIRE_APPROVAL" | "BLOCK";
  /** The rule ids that fired. */
  readonly ruleIds: readonly string[];
  /** Optional: reference to the evidence artifacts supporting the decision. */
  readonly evidenceRefs?: readonly string[];
}

/**
 * An authorization error. The principal is not permitted to perform the
 * requested action. Distinct from `PolicyError`: authorization is about
 * the principal's identity and role; policy is about the action's
 * consequences.
 */
export interface AuthorizationError extends FleetErrorBase {
  readonly kind: "AuthorizationError";
  /** The principal that was denied. */
  readonly principalId: string;
  /** The action that was attempted. */
  readonly action: string;
  /** The reason for denial (e.g., "missing_role", "tenant_mismatch"). */
  readonly reason: string;
}

/**
 * An adapter error. The Device Adapter could not satisfy a capability
 * request. Carries the capability context so the caller can decide
 * whether to retry, escalate, or refuse.
 */
export interface AdapterError extends FleetErrorBase {
  readonly kind: "AdapterError";
  /** The capability that was requested. */
  readonly capability: string;
  /** The adapter family (e.g., "windows", "macos", "linux", "ios", "android"). */
  readonly adapterFamily: string;
  /** The device id, if known. */
  readonly deviceId?: string;
  /** Whether the error is retryable. */
  readonly retryable: boolean;
}

/**
 * A conflict error. The requested operation conflicts with another
 * in-flight operation (e.g., a write-write conflict, or an idempotency-key
 * collision with a different payload).
 */
export interface ConflictError extends FleetErrorBase {
  readonly kind: "ConflictError";
  /** The conflicting resource identifier. */
  readonly resource: string;
  /** The conflicting operation identifier (if known). */
  readonly conflictingOperationId?: string;
}

/**
 * A validation error. The input failed schema validation. Carries the
 * list of validation failures (path + reason) so the caller can surface
 * them to the user.
 */
export interface ValidationError extends FleetErrorBase {
  readonly kind: "ValidationError";
  /** The list of validation failures. */
  readonly failures: readonly ValidationFailure[];
}

/**
 * A single validation failure.
 */
export interface ValidationFailure {
  /** The JSON-pointer path to the invalid field (e.g., "/payload/deviceId"). */
  readonly path: string;
  /** The reason the field is invalid (machine-stable string). */
  readonly reason: string;
}

/**
 * The discriminated union of all FleetOS errors.
 */
export type FleetError =
  | DomainError
  | PolicyError
  | AuthorizationError
  | AdapterError
  | ConflictError
  | ValidationError;

// ---------------------------------------------------------------------------
// HTTP / API wire shape
// ---------------------------------------------------------------------------

/**
 * The wire shape for errors returned by HTTP surfaces. The HTTP layer
 * translates a `FleetError` into an `ApiError` (with an HTTP status code)
 * before sending it to the client. The translation is the
 * responsibility of the HTTP surface, not the contracts package.
 */
export interface ApiError {
  /** The HTTP status code (4xx or 5xx). */
  readonly status: number;
  /** The stable machine code (mirrors `FleetError.code`). */
  readonly code: FleetErrorCode;
  /** The human-readable message (mirrors `FleetError.message`). */
  readonly message: string;
  /** The tenant scope (mirrors `FleetError.tenantId`). */
  readonly tenantId: TenantId;
  /** The correlation id (mirrors `FleetError.correlationId`). */
  readonly correlationId: CorrelationId;
  /** The error kind (mirrors `FleetError.kind`). */
  readonly kind: FleetError["kind"];
  /** Optional: additional context (e.g., validation failures). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Translate a `FleetError` into an `ApiError`. The HTTP status code is
 * derived from the error kind:
 *   - DomainError            -> 400 (Bad Request) — the request does not
 *                                          make sense in the current state.
 *   - PolicyError           -> 403 (Forbidden) when BLOCK; 422 (Unprocessable
 *                                          Entity) when REQUIRE_APPROVAL.
 *   - AuthorizationError    -> 403 (Forbidden).
 *   - AdapterError          -> 502 (Bad Gateway) — the upstream adapter
 *                                          could not satisfy the request.
 *   - ConflictError         -> 409 (Conflict).
 *   - ValidationError       -> 400 (Bad Request).
 *
 * @param error the FleetError to translate
 * @returns the ApiError wire shape
 */
export function toApiError(error: FleetError): ApiError {
  let status: number;
  switch (error.kind) {
    case "DomainError":
      status = 400;
      break;
    case "PolicyError":
      status = error.decision === "BLOCK" ? 403 : 422;
      break;
    case "AuthorizationError":
      status = 403;
      break;
    case "AdapterError":
      status = 502;
      break;
    case "ConflictError":
      status = 409;
      break;
    case "ValidationError":
      status = 400;
      break;
  }
  return Object.freeze({
    status,
    code: error.code,
    message: error.message,
    tenantId: error.tenantId,
    correlationId: error.correlationId,
    kind: error.kind,
    details: error.kind === "ValidationError" ? { failures: error.failures } : undefined,
  });
}
