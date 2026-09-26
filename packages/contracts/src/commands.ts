/**
 * @fleetos/contracts — Command envelope + idempotency contract.
 *
 * User and system requests become durable Fleet Intents (see `intents.ts`).
 * An Intent is the durable record of a desired outcome; a Command is the
 * envelope issued to a specific executor (agent, service, adapter) to
 * advance that outcome. Every command carries an idempotency key so that
 * duplicate redelivery (network retries, agent reconnects) does not
 * produce duplicate side effects.
 *
 * Reference: `spec/ARCHITECTURE.md` § Intent model and § Decision boundary;
 * `spec/ARCHITECTURE-LOCK.md` item 4 ("All consequential actions have
 * authorization, idempotency, audit and verification").
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CommandId,
  CorrelationId,
  IdempotencyKey,
  TenantId,
} from "./ids";
import type { TenantScoped } from "./tenant";

/**
 * The command type string. Like `EventType`, follows a namespaced
 * convention: `<module>.<subject>.<verb>` — for example,
 * `device.command.lock` or `procurement.command.quote`.
 */
export type CommandType = string;

/**
 * The command envelope.
 *
 * Invariants (enforced by `makeCommand()` and tested in
 * `test/commands.test.ts`):
 *   1. `tenantId` is present and non-empty (tenant isolation).
 *   2. `idempotencyKey` is present and non-empty (duplicate suppression).
 *   3. `correlationId` is present and non-empty (traceable to root).
 *   4. `issuedAt` is an ISO 8601 timestamp.
 *
 * Duplicate-suppression contract:
 *   Two commands with the same `(tenantId, idempotencyKey)` pair MUST
 *   produce the same logical effect exactly once. Concretely: if a command
 *   with key K has already been applied (verified by outcome), a second
 *   command with key K is treated as a duplicate and the original
 *   outcome is returned — never re-executed, never partially applied.
 *
 * @template P the payload type — must be JSON-serializable
 */
export interface CommandEnvelope<P> extends TenantScoped {
  /** Unique command identifier. */
  readonly id: CommandId;
  /** Idempotency key — same key => same logical effect once. */
  readonly idempotencyKey: IdempotencyKey;
  /** ISO 8601 timestamp of when the command was issued. */
  readonly issuedAt: string;
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Correlation id — threads across the causal graph. */
  readonly correlationId: CorrelationId;
  /** Command type, namespaced. */
  readonly type: CommandType;
  /** Command payload. */
  readonly payload: P;
}

/**
 * Inputs to `makeCommand()`.
 *
 * @template P the payload type
 */
export interface MakeCommandInput<P> {
  /** Unique command identifier. */
  readonly id: CommandId;
  /** Idempotency key. */
  readonly idempotencyKey: IdempotencyKey;
  /** ISO 8601 timestamp. */
  readonly issuedAt: string;
  /** Tenant scope. */
  readonly tenantId: TenantId;
  /** Correlation id (a root command stamps a fresh one). */
  readonly correlationId: CorrelationId;
  /** Command type, namespaced. */
  readonly type: CommandType;
  /** Command payload. */
  readonly payload: P;
}

/**
 * Pure constructor for `CommandEnvelope`. Returns a frozen envelope; does
 * NOT throw on malformed input. Use `validateCommand()` to enforce
 * invariants at boundary crossings.
 *
 * @template P the payload type
 * @param input the constructor inputs
 * @returns a frozen command envelope
 */
export function makeCommand<P>(input: MakeCommandInput<P>): CommandEnvelope<P> {
  return Object.freeze({
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.issuedAt,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    type: input.type,
    payload: input.payload,
  });
}

// ---------------------------------------------------------------------------
// Command invariant validation
// ---------------------------------------------------------------------------

/**
 * The result of a command invariant check.
 */
export type CommandValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_id"
        | "missing_idempotency_key"
        | "missing_issued_at"
        | "missing_tenant_id"
        | "missing_correlation_id"
        | "missing_type"
        | "issued_at_not_iso";
    };

/**
 * Pure invariant validator for `CommandEnvelope`. Returns a tagged result;
 * does NOT throw.
 *
 * @param command the command to validate
 * @returns the validation result
 */
export function validateCommand<P>(command: CommandEnvelope<P>): CommandValidation {
  if (typeof command.id !== "string" || command.id.length === 0) {
    return { ok: false, reason: "missing_id" };
  }
  if (typeof command.idempotencyKey !== "string" || command.idempotencyKey.length === 0) {
    return { ok: false, reason: "missing_idempotency_key" };
  }
  if (typeof command.issuedAt !== "string" || command.issuedAt.length === 0) {
    return { ok: false, reason: "missing_issued_at" };
  }
  if (!/T\d{2}:\d{2}/.test(command.issuedAt)) {
    return { ok: false, reason: "issued_at_not_iso" };
  }
  if (typeof command.tenantId !== "string" || command.tenantId.length === 0) {
    return { ok: false, reason: "missing_tenant_id" };
  }
  if (typeof command.correlationId !== "string" || command.correlationId.length === 0) {
    return { ok: false, reason: "missing_correlation_id" };
  }
  if (typeof command.type !== "string" || command.type.length === 0) {
    return { ok: false, reason: "missing_type" };
  }
  return { ok: true };
}
