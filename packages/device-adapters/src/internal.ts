/**
 * @fleetos/device-adapters — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the device-adapters modules: timestamp sanity,
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
  AdapterError,
  AuthorizationError,
  CausationId,
  ConflictError,
  CorrelationId,
  DomainError,
  FleetError,
  PolicyError,
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
 * JSON-serializable; this is the device-adapters' enforcement seam.
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
 * Freeze a record at construction time. The device-adapters lane never
 * mutates a returned structure in place: every mutation returns a NEW
 * structure. Freezing is defense in depth so a downstream caller cannot
 * silently corrupt a frozen value either.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into device-adapters state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/**
 * Stable machine error codes used across the device-adapters lane.
 * Dotted strings following the `<domain>.<error>` convention from
 * `@fleetos/contracts` errors.ts.
 */
export const ERROR_CODES = {
  // D1 — check-in / registration
  checkinInvalidRequest: "agent.checkin.invalid_request",
  checkinTenantMismatch: "agent.checkin.tenant_mismatch",
  checkinSessionExpired: "agent.checkin.session_expired",
  checkinSessionRevoked: "agent.checkin.session_revoked",
  // D2 — capability negotiation
  capabilityUnsupported: "agent.capability.unsupported",
  capabilityDestructiveUnauthorized: "agent.capability.destructive_unauthorized",
  capabilityDestructiveOfflineDefaultDeny: "agent.capability.destructive_offline_default_deny",
  // D3 — observation batching
  observationsMalformed: "agent.observations.malformed",
  observationsSequencingError: "agent.observations.sequencing_error",
  // D4 — command receipt / result
  commandUnknown: "agent.command.unknown",
  commandIdempotencyConflict: "agent.command.idempotency_conflict",
  commandRejected: "agent.command.rejected",
  // D5 — local signed-policy cache
  policyCacheEmpty: "agent.policy_cache.empty",
  policyCacheStale: "agent.policy_cache.stale",
  policyCacheSignatureInvalid: "agent.policy_cache.signature_invalid",
  policyCacheDefaultDeny: "agent.policy_cache.default_deny",
  // W020 — endpoint adapter SDK (adapter surface, registry, dispatch)
  adapterTenantMismatch: "agent.adapter.tenant_mismatch",
  adapterNotFound: "agent.adapter.not_found",
  adapterUnknownCapability: "agent.adapter.unknown_capability",
  adapterUnknownCommandType: "agent.adapter.unknown_command_type",
  adapterRegistrationConflict: "agent.adapter.registration_conflict",
  adapterRegistrationInvalid: "agent.adapter.registration_invalid",
  dispatchIncomplete: "agent.dispatch.incomplete",
  dispatchTargetUnresolved: "agent.dispatch.target_unresolved",
} as const;

/** Traceability fields every device-adapters error must carry. */
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

export function makeAdapterError(
  code: string,
  message: string,
  trace: ErrorTrace,
  capability: string,
  adapterFamily: string,
  retryable: boolean,
  deviceId?: string,
): AdapterError {
  return frozen<AdapterError>({
    kind: "AdapterError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    capability,
    adapterFamily,
    retryable,
    deviceId,
  });
}

export function makePolicyError(
  code: string,
  message: string,
  trace: ErrorTrace,
  decision: "REQUIRE_APPROVAL" | "BLOCK",
  ruleIds: readonly string[],
  evidenceRefs?: readonly string[],
): PolicyError {
  return frozen<PolicyError>({
    kind: "PolicyError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    decision,
    ruleIds: frozenArray(ruleIds),
    evidenceRefs: evidenceRefs ? frozenArray(evidenceRefs) : undefined,
  });
}

/**
 * A sentinel "no error" helper for branches that the type system cannot
 * prove are unreachable. Used by exhaustive switches.
 */
export function unreachableFleetError(trace: ErrorTrace): FleetError {
  return makeDomainError(
    "agent.internal.unreachable",
    "unreachable branch executed in device-adapters",
    trace,
    "device-adapters",
    "internal_unreachable",
  );
}
