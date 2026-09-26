/**
 * @fleetos/device-model — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the device-model modules: timestamp sanity,
 * deterministic canonical JSON, content digests, and FleetError
 * constructors mapped onto the frozen `@fleetos/contracts` error
 * taxonomy (`errors.ts`).
 *
 * Design rules (inherited from the Wave 0 rulings):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 */

import type {
  AuthorizationError,
  CausationId,
  ConflictError,
  CorrelationId,
  DomainError,
  TenantId,
  ValidationError,
  ValidationFailure,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Timestamp sanity
// ---------------------------------------------------------------------------

/**
 * Minimal ISO 8601 sanity check — deliberately the SAME laxness as the
 * frozen contracts validators (`validateEnvelope`, `validateCommand`,
 * `validateObservationBatch`): the string must contain a `T` followed by
 * two digits, a colon, and two more digits. Anything stricter would reject
 * valid ISO 8601 variants the frozen contracts accept, and anything laxer
 * would accept junk the frozen contracts reject.
 */
export function looksLikeIso(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

// ---------------------------------------------------------------------------
// Deterministic canonical JSON
// ---------------------------------------------------------------------------

/**
 * Deterministic (canonical) JSON serialization: object keys sorted
 * recursively, arrays preserved in order. Two JSON-serializable values
 * that are structurally equal produce the same string — the basis for
 * content-addressed idempotency comparison and audit digests in this
 * package (mirrors `serializeEnvelope`'s intent in contracts, generalized
 * to arbitrary JSON values).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return primitive(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => serialize(entry)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => JSON.stringify(key) + ":" + serialize(record[key])).join(",");
  return "{" + body + "}";
}

function primitive(value: unknown): string {
  if (value === undefined) return "null"; // JSON.stringify(array) semantics
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/**
 * FNV-1a 32-bit hash as 8 lowercase hex chars. Deterministic, dependency
 * free — the same algorithm the contracts testing subpath documents for
 * string-seeded PRNGs. Used for stable, short content digests in audit
 * records (never for security).
 */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// JSON-serializability
// ---------------------------------------------------------------------------

/**
 * True when the value is a legal JSON value at the top level (no
 * `undefined`, functions, symbols, or bigints; plain data all the way
 * down). The frozen contracts require observation payloads to be
 * JSON-serializable; this is the device-model's enforcement seam.
 */
export function isJsonSerializable(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return false;
  }
  if (value === null || typeof value !== "object") return true;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/**
 * Freeze a record at construction time. The device-model never mutates a
 * returned structure in place: every mutation returns a NEW aggregate with
 * a new revision (append-only history). Freezing is defense in depth so a
 * downstream caller cannot silently corrupt a frozen revision either.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into device-model state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the device-model lane. */
export const ERROR_CODES = {
  lifecycleIllegalTransition: "device.lifecycle.illegal_transition",
  lifecycleNotInLearn: "device.lifecycle.not_in_learn",
  deviceUnknown: "device.unknown",
  identityInvalid: "device.identity.invalid",
  twinInvalid: "device.twin.invalid",
  observationsMalformed: "device.observations.malformed",
  ingestionInvalidRequest: "device.ingestion.invalid_request",
  ingestionTenantMismatch: "device.ingestion.tenant_mismatch",
  ingestionIdempotencyConflict: "device.ingestion.idempotency_conflict",
} as const;

/** Traceability fields every device-model error must carry. */
export interface ErrorTrace {
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
}

export function makeDomainError(
  code: string,
  message: string,
  trace: ErrorTrace,
  domain: string,
  invariant: string,
): DomainError {
  return frozen<DomainError>({
    kind: "DomainError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    domain,
    invariant,
  });
}

export function makeValidationError(
  code: string,
  message: string,
  trace: ErrorTrace,
  failures: readonly ValidationFailure[],
): ValidationError {
  return frozen<ValidationError>({
    kind: "ValidationError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    failures: frozenArray(failures),
  });
}

export function makeConflictError(
  code: string,
  message: string,
  trace: ErrorTrace,
  resource: string,
  conflictingOperationId?: CausationId,
): ConflictError {
  return frozen<ConflictError>({
    kind: "ConflictError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    resource,
    conflictingOperationId,
  });
}

export function makeAuthorizationError(
  code: string,
  message: string,
  trace: ErrorTrace,
  principalId: string,
  action: string,
  reason: string,
): AuthorizationError {
  return frozen<AuthorizationError>({
    kind: "AuthorizationError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    principalId,
    action,
    reason,
  });
}
