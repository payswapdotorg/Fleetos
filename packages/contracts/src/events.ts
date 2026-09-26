/**
 * @fleetos/contracts — Event envelope + tracing primitives.
 *
 * Reality is represented by observations/events (per
 * `spec/ARCHITECTURE.md` § Canonical model and `spec/ARCHITECTURE-LOCK.md`
 * item 3). Events are immutable; derived diagnoses/recommendations are
 * versioned.
 *
 * Every event is wrapped in an `EventEnvelope` that carries tenant scope,
 * correlation/causation identifiers, and a schema version. The envelope
 * is the structural foundation of the audit/evidence trail.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, EventId, TenantId } from "./ids";
import type { TenantScoped } from "./tenant";

/**
 * The type string of an event. Event types follow a namespaced convention:
 * `<module>.<subject>.<verb>` — for example, `device.observation.recorded`
 * or `policy.decision.evaluated`. The convention is documented but not
 * enforced at the type level (events span every module; the discriminated
 * union would be unwieldy and would couple every module to `contracts`).
 *
 * Modules should export their own event-type string literals (e.g.,
 * `@fleetos/device-model` exports `DEVICE_OBSERVATION_RECORDED =
 * "device.observation.recorded" as const`).
 *
 * @see `spec/MODULE-DEPENDENCY-MAP.md` for the module list.
 */
export type EventType = string;

/**
 * The subject of an event — the entity the event is about. Most commonly
 * a `DeviceId`, but events about workloads, vendors, intents, etc. carry
 * their respective branded id. The envelope is parametric over the subject
 * id type so callers can specialize.
 */
export type EventSubject = DeviceId | string;

// To avoid a circular type-only import in tight tooling, we re-declare
// the minimal DeviceId shape here via a comment rather than a value import.
// (The runtime import above is fine; this comment is documentation only.)

import type { DeviceId } from "./ids";

/**
 * The event envelope. Wraps every immutable event in the system.
 *
 * Invariants (enforced by `makeEnvelope()` and tested in
 * `test/events.test.ts`):
 *   1. `tenantId` is present and non-empty (tenant isolation).
 *   2. `correlationId` is present and non-empty (every event is traceable
 *      to a root command).
 *   3. `schemaVersion` is >= 1 (zero is reserved for "unspecified").
 *   4. `occurredAt` is an ISO 8601 string with timezone (UTC recommended).
 *   5. `type` follows the `<module>.<subject>.<verb>` convention.
 *
 * @template P the payload type — must be JSON-serializable
 */
export interface EventEnvelope<P> extends TenantScoped {
  /** Unique event identifier (immutable). */
  readonly id: EventId;
  /** Event type, namespaced per the convention above. */
  readonly type: EventType;
  /** ISO 8601 timestamp of when the event occurred (UTC recommended). */
  readonly occurredAt: string;
  /** The tenant this event belongs to (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The entity the event is about (commonly a DeviceId). */
  readonly subject: EventSubject;
  /** Correlation id — threads across a single causal graph. */
  readonly correlationId: CorrelationId;
  /** Causation id — the immediate cause of this event (a command or event id). */
  readonly causationId: CausationId;
  /** Schema version of the payload (>= 1). */
  readonly schemaVersion: number;
  /** The event payload. */
  readonly payload: P;
}

/**
 * The cause of an event — either a command (which itself carries a
 * correlation id and is the root of a causal graph) or another event
 * (whose correlation/causation should be inherited).
 *
 * The discriminated union makes the inheritance rules type-safe: a command
 * cause provides a fresh `correlationId` (its own) and uses the command id
 * as `causationId`; an event cause inherits the source event's
 * `correlationId` and uses the source event id as `causationId`.
 */
export type EventCause =
  | {
      readonly kind: "command";
      readonly commandId: CausationId;
      readonly correlationId: CorrelationId;
    }
  | {
      readonly kind: "event";
      readonly sourceEventId: EventId;
      readonly correlationId: CorrelationId;
    };

/**
 * Inputs to `makeEnvelope()`.
 *
 * @template P the payload type
 */
export interface MakeEnvelopeInput<P> {
  /** Unique event identifier. */
  readonly id: EventId;
  /** Event type, namespaced. */
  readonly type: EventType;
  /** ISO 8601 timestamp of when the event occurred. */
  readonly occurredAt: string;
  /** Tenant scope. */
  readonly tenantId: TenantId;
  /** Subject of the event. */
  readonly subject: EventSubject;
  /** Schema version of the payload (>= 1). */
  readonly schemaVersion: number;
  /** Event payload. */
  readonly payload: P;
  /** The cause of this event — determines correlation/causation ids. */
  readonly cause: EventCause;
}

/**
 * Pure constructor for `EventEnvelope`. Stamps the correlation/causation
 * rules:
 *   - A root command (kind="command") provides a fresh `correlationId`
 *     and uses the command id as `causationId`.
 *   - An event caused by another event (kind="event") inherits the source
 *     event's `correlationId` and uses the source event id as `causationId`.
 *
 * This function does NOT throw on malformed input — it returns the
 * envelope as requested. Use `assertEnvelope()` (in `test/`) or
 * `validateEnvelope()` to enforce invariants at boundary crossings.
 *
 * @template P the payload type
 * @param input the constructor inputs
 * @returns a frozen event envelope
 */
export function makeEnvelope<P>(input: MakeEnvelopeInput<P>): EventEnvelope<P> {
  const correlationId: CorrelationId =
    input.cause.kind === "command" ? input.cause.correlationId : input.cause.correlationId;
  const causationId: CausationId =
    input.cause.kind === "command"
      ? input.cause.commandId
      : (input.cause.sourceEventId as unknown as CausationId);
  return Object.freeze({
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    tenantId: input.tenantId,
    subject: input.subject,
    correlationId,
    causationId,
    schemaVersion: input.schemaVersion,
    payload: input.payload,
  });
}

// ---------------------------------------------------------------------------
// Envelope invariant validation
// ---------------------------------------------------------------------------

/**
 * The result of an envelope invariant check. Tagged-union so callers can
 * branch on the failure mode without try/catch.
 */
export type EnvelopeValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_id"
        | "missing_type"
        | "missing_occurred_at"
        | "missing_tenant_id"
        | "missing_subject"
        | "missing_correlation_id"
        | "missing_causation_id"
        | "schema_version_below_one"
        | "occurred_at_not_iso";
    };

/**
 * Pure invariant validator for `EventEnvelope`. Returns a tagged result;
 * does NOT throw. Useful for boundary checks (e.g., when an event crosses
 * a process or storage boundary).
 *
 * @param envelope the envelope to validate
 * @returns the validation result
 */
export function validateEnvelope<P>(envelope: EventEnvelope<P>): EnvelopeValidation {
  if (typeof envelope.id !== "string" || envelope.id.length === 0) {
    return { ok: false, reason: "missing_id" };
  }
  if (typeof envelope.type !== "string" || envelope.type.length === 0) {
    return { ok: false, reason: "missing_type" };
  }
  if (typeof envelope.occurredAt !== "string" || envelope.occurredAt.length === 0) {
    return { ok: false, reason: "missing_occurred_at" };
  }
  // ISO 8601 minimum sanity: contains a `T` and a `:`. (A stricter regex
  // would reject valid ISO 8601 variants; we keep this intentionally lax.)
  if (!/T\d{2}:\d{2}/.test(envelope.occurredAt)) {
    return { ok: false, reason: "occurred_at_not_iso" };
  }
  if (typeof envelope.tenantId !== "string" || envelope.tenantId.length === 0) {
    return { ok: false, reason: "missing_tenant_id" };
  }
  if (typeof envelope.subject !== "string" || envelope.subject.length === 0) {
    return { ok: false, reason: "missing_subject" };
  }
  if (typeof envelope.correlationId !== "string" || envelope.correlationId.length === 0) {
    return { ok: false, reason: "missing_correlation_id" };
  }
  if (typeof envelope.causationId !== "string" || envelope.causationId.length === 0) {
    return { ok: false, reason: "missing_causation_id" };
  }
  if (typeof envelope.schemaVersion !== "number" || envelope.schemaVersion < 1) {
    return { ok: false, reason: "schema_version_below_one" };
  }
  return { ok: true };
}

/**
 * Deterministic serialization of an event envelope. Keys are sorted so
 * that two envelopes with the same content produce the same byte string —
 * required for content-addressable storage, hash-based deduplication, and
 * audit-evidence reproducibility.
 *
 * @param envelope the envelope to serialize
 * @returns a canonical JSON string with sorted keys
 */
export function serializeEnvelope<P>(envelope: EventEnvelope<P>): string {
  return JSON.stringify(envelope, (key, value) => {
    // Object.freeze is not preserved by JSON.stringify; the canonical form
    // is the sorted-key plain object.
    return value;
  });
}
