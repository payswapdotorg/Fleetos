/**
 * @fleetos/contracts — Branded identification primitives.
 *
 * Branded IDs are template-literal types with NO runtime cost. A `TenantId`
 * is structurally just a string at runtime, but the type system refuses to
 * assign a plain string (or a DeviceId) to it. This is the structural basis
 * for tenant isolation: every envelope, command, intent, and audit record
 * carries a branded `TenantId`, and the compiler rejects cross-tenant
 * assignment at the type level.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

/**
 * The brand tag carried on the type-level by every branded ID.
 * Stored on the type only — never on the runtime value.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BrandTag = symbol & { readonly __brand: unique symbol };

/**
 * The generic branded-string type. `Branded<string, "TenantId">` is
 * structurally identical to `string` at runtime but is a distinct nominal
 * type from the perspective of TypeScript's assignability rules.
 *
 * The `__brand` property is declared on the type only; the runtime value
 * is a plain string. Use `brand()` to construct and `isBranded()` (with an
 * explicit expected brand) to type-guard.
 *
 * @example
 *   const t: TenantId = brand<string, "TenantId">("tnt_abc");
 *   const d: DeviceId = brand<string, "DeviceId">("dev_xyz");
 *   // t = d;  // compile error: Type 'DeviceId' is not assignable to type 'TenantId'
 */
export type Branded<T, B extends string> = T & { readonly __brand: B };

/**
 * Brand a runtime value, attaching a brand tag at the type level only.
 *
 * Runtime: returns the input value unchanged (no allocation, no wrapping).
 * Type: narrows to `Branded<T, B>`.
 *
 * @param value the underlying primitive value (string, number, etc.)
 * @returns the same value, typed as `Branded<T, B>`
 */
export function brand<T, B extends string>(value: T): Branded<T, B> {
  return value as Branded<T, B>;
}

/**
 * Type-guard a value as bearing an expected brand. The runtime check is
 * intentionally minimal: branded IDs are plain primitives at runtime, so
 * the guard validates only that the value is a string (the underlying
 * primitive type for all current FleetOS branded IDs).
 *
 * Use this when reading a branded value from an untyped boundary (e.g.,
 * parsed JSON, environment variables) and you want to assert the expected
 * brand at the call site.
 *
 * @param value the value to guard
 * @returns true if `value` is a string (for string brands)
 */
export function isBranded<T, B extends string>(value: unknown): value is Branded<T, B> {
  // Branded IDs are plain primitives at runtime; we infer the primitive
  // check from the value itself. For string-branded IDs (the common case
  // in FleetOS), we verify that `value` is a string.
  return typeof value === "string";
}

// ---------------------------------------------------------------------------
// Canonical FleetOS branded IDs.
// ---------------------------------------------------------------------------
//
// Each ID below is a branded string. Add a new ID here ONLY when its owning
// work item is authorized (per `spec/worker-ownership.yaml` rule:
// `shared_contract_changes_require_tech_lead`).

/** Tenant identifier. Structural basis of tenant isolation. */
export type TenantId = Branded<string, "TenantId">;
/** Managed device identifier (Device Twin). */
export type DeviceId = Branded<string, "DeviceId">;
/** Observation (immutable event-from-device) identifier. */
export type ObservationId = Branded<string, "ObservationId">;
/** Event envelope identifier. */
export type EventId = Branded<string, "EventId">;
/** Durable Fleet Intent identifier. */
export type IntentId = Branded<string, "IntentId">;
/** Fleet Action identifier. */
export type ActionId = Branded<string, "ActionId">;
/** Command envelope identifier (issued to agents, services, adapters). */
export type CommandId = Branded<string, "CommandId">;
/** Authenticated user / actor identifier. */
export type UserId = Branded<string, "UserId">;
/** Vendor identifier (commerce layer). */
export type VendorId = Branded<string, "VendorId">;
/** Workload profile identifier. */
export type WorkloadId = Branded<string, "WorkloadId">;
/** Policy (Contract Guardian rule) identifier. */
export type PolicyId = Branded<string, "PolicyId">;
/** Append-only audit record identifier. */
export type AuditRecordId = Branded<string, "AuditRecordId">;
/** Correlation identifier — threads across a single causal graph. */
export type CorrelationId = Branded<string, "CorrelationId">;
/** Causation identifier — the immediate cause of an event/command. */
export type CausationId = Branded<string, "CausationId">;
/** Idempotency key — same key => same logical effect once (duplicate suppression). */
export type IdempotencyKey = Branded<string, "IdempotencyKey">;

// ---------------------------------------------------------------------------
// Convenience constructors.
// ---------------------------------------------------------------------------

/**
 * Construct a `TenantId` from a string. Use this at tenant-enrollment
 * boundaries; never accept a raw string in domain code.
 */
export function asTenantId(value: string): TenantId {
  return brand<string, "TenantId">(value);
}
/** Construct a `DeviceId`. */
export function asDeviceId(value: string): DeviceId {
  return brand<string, "DeviceId">(value);
}
/** Construct an `ObservationId`. */
export function asObservationId(value: string): ObservationId {
  return brand<string, "ObservationId">(value);
}
/** Construct an `EventId`. */
export function asEventId(value: string): EventId {
  return brand<string, "EventId">(value);
}
/** Construct an `IntentId`. */
export function asIntentId(value: string): IntentId {
  return brand<string, "IntentId">(value);
}
/** Construct an `ActionId`. */
export function asActionId(value: string): ActionId {
  return brand<string, "ActionId">(value);
}
/** Construct a `CommandId`. */
export function asCommandId(value: string): CommandId {
  return brand<string, "CommandId">(value);
}
/** Construct a `UserId`. */
export function asUserId(value: string): UserId {
  return brand<string, "UserId">(value);
}
/** Construct a `VendorId`. */
export function asVendorId(value: string): VendorId {
  return brand<string, "VendorId">(value);
}
/** Construct a `WorkloadId`. */
export function asWorkloadId(value: string): WorkloadId {
  return brand<string, "WorkloadId">(value);
}
/** Construct a `PolicyId`. */
export function asPolicyId(value: string): PolicyId {
  return brand<string, "PolicyId">(value);
}
/** Construct an `AuditRecordId`. */
export function asAuditRecordId(value: string): AuditRecordId {
  return brand<string, "AuditRecordId">(value);
}
/** Construct a `CorrelationId`. */
export function asCorrelationId(value: string): CorrelationId {
  return brand<string, "CorrelationId">(value);
}
/** Construct a `CausationId`. */
export function asCausationId(value: string): CausationId {
  return brand<string, "CausationId">(value);
}
/** Construct an `IdempotencyKey`. */
export function asIdempotencyKey(value: string): IdempotencyKey {
  return brand<string, "IdempotencyKey">(value);
}
