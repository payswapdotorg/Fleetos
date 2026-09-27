/**
 * @fleetos/device-adapters — D1: Agent check-in / registration handshake.
 *
 * The device agent announces itself to the control plane at check-in. The
 * handshake is a deterministic, tenant-scoped, envelope-compatible
 * request/response:
 *
 *   - The agent announces its identity (DeviceId + tenant binding), its
 *     module/protocol version, and — when renewing — the session token
 *     the control plane previously issued.
 *   - The control plane acknowledges with session state (a fresh or
 *     renewed session id, an expiry, and a status of
 *     active/expired/revoked).
 *
 * Envelope compatibility: the request payload fits inside a
 * `CommandEnvelope<CheckInCommandPayload>` (the agent -> control-plane
 * direction is a command); the ack payload fits inside an
 * `EventEnvelope<CheckInAckEventPayload>` (the control-plane -> agent
 * direction is an event). The frozen envelope shapes are REUSED — not
 * duplicated — via `makeCommand` and `makeEnvelope` from
 * `@fleetos/contracts`.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  makeCommand,
  makeEnvelope,
  validateCommand,
  validateEnvelope,
  validateTenantRef,
  type CommandEnvelope,
  type CommandId,
  type CorrelationId,
  type CausationId,
  type EventEnvelope,
  type EventId,
  type IdempotencyKey,
  type TenantId,
  type DeviceId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D1.1 — Agent identity, version, session token
// ---------------------------------------------------------------------------

/**
 * The agent's identity: which device it is, under which tenant. The
 * tenant binding is structural (a branded `TenantId`); the agent cannot
 * self-declare a tenant it is not enrolled under.
 *
 * `adapterFamily` is included so the control plane can route to the
 * correct adapter lane (windows/macos/linux/ios/android/...).
 */
export interface AgentIdentity extends TenantScoped {
  /** The device this agent runs on. */
  readonly deviceId: DeviceId;
  /** Adapter family (windows, macos, linux, ios, android, ...). */
  readonly adapterFamily: string;
}

/**
 * The agent's self-reported version. The control plane uses this to
 * gate feature negotiation (D2) and to refuse incompatible agents.
 *
 * `moduleName` and `moduleVersion` SHOULD mirror the
 * `MODULE_NAME`/`MODULE_VERSION` exports of the agent package; they are
 * re-declared here (not imported) so the wire shape is self-contained
 * and free of runtime imports.
 */
export interface AgentVersionInfo {
  /** Agent module name (e.g. "agent"). */
  readonly moduleName: string;
  /** Agent module version (e.g. "0.1.0"). */
  readonly moduleVersion: string;
  /** Check-in protocol version (>= 1). */
  readonly protocolVersion: number;
}

/**
 * The session token shape the control plane issues and the agent presents
 * on renewal. The token is OPAQUE to the agent: the agent does not
 * interpret, validate, or sign it. The control plane is the sole
 * authority.
 *
 * The token carries `issuedAt`/`expiresAt` for the agent to decide when
 * to renew; it carries `issuer` for diagnostic routing. The `value` is
 * the bearer string the agent presents on renewal.
 */
export interface SessionToken {
  /** Opaque bearer value issued by the control plane. */
  readonly value: string;
  /** ISO 8601 timestamp of issuance (control-plane clock). */
  readonly issuedAt: string;
  /** ISO 8601 timestamp of expiry (control-plane clock). */
  readonly expiresAt: string;
  /** Issuer identifier (e.g. "control-plane@fleetos"). */
  readonly issuer: string;
}

/**
 * Session state returned by the control plane on check-in. The agent uses
 * `status` to decide its next move:
 *   - `active` — proceed with observation/command traffic.
 *   - `expired` — renew before sending any traffic.
 *   - `revoked` — shut down; the device is no longer managed.
 */
export interface SessionState {
  /** The session id (control-plane-issued, opaque to the agent). */
  readonly sessionId: string;
  /** Session status. */
  readonly status: "active" | "expired" | "revoked";
  /** ISO 8601 timestamp of session expiry. */
  readonly expiresAt: string;
  /**
   * Optional advisory refresh hint (millis until the agent SHOULD renew).
   * Null when the control plane does not advise a refresh.
   */
  readonly refreshAfterMs: number | null;
}

// ---------------------------------------------------------------------------
// D1.2 — Check-in request / ack (payload shapes)
// ---------------------------------------------------------------------------

/**
 * The check-in request payload. Carried inside a `CommandEnvelope` on the
 * wire (the agent -> control-plane direction is a command). The envelope
 * supplies `tenantId`, `idempotencyKey`, `correlationId`, `issuedAt`, and
 * `id`; the payload supplies the agent-specific fields.
 *
 * `tenantId` is intentionally NOT repeated in the payload — it lives on
 * the envelope (single source of truth, structural tenant isolation).
 */
export interface CheckInCommandPayload {
  /** The agent's identity (device + adapter family). */
  readonly identity: AgentIdentity;
  /** The agent's self-reported version. */
  readonly agent: AgentVersionInfo;
  /** The current session token, when renewing; absent on first enrollment. */
  readonly sessionToken?: SessionToken;
}

/**
 * The check-in ack payload. Carried inside an `EventEnvelope` on the wire
 * (the control-plane -> agent direction is an event). The envelope
 * supplies `tenantId`, `correlationId`, `causationId` (= the command id),
 * `occurredAt`, `id`, `subject` (= the device id), and `schemaVersion`.
 */
export interface CheckInAckEventPayload {
  /** The session state established by the control plane. */
  readonly session: SessionState;
  /** The ack kind: `registered` (new session) or `renewed` (existing session). */
  readonly kind: "registered" | "renewed" | "rejected";
  /** Optional diagnostic message (e.g. rejection reason). */
  readonly message?: string;
}

// ---------------------------------------------------------------------------
// D1.3 — Envelope-construction helpers (reuse, not duplicate)
// ---------------------------------------------------------------------------

/**
 * Inputs needed to construct a check-in command envelope beyond the
 * payload itself. The caller (the agent runtime) supplies these from its
 * auth/correlation context.
 */
export interface CheckInCommandEnvelopeInputs {
  readonly id: CommandId;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly issuedAt: string;
  readonly tenantId: TenantId;
}

/**
 * Wrap a check-in payload in a `CommandEnvelope`, reusing the frozen
 * `makeCommand` constructor. The envelope is the wire shape the
 * control-plane ingestion boundary expects.
 */
export function wrapCheckInCommand(
  payload: CheckInCommandPayload,
  inputs: CheckInCommandEnvelopeInputs,
): CommandEnvelope<CheckInCommandPayload> {
  return makeCommand<CheckInCommandPayload>({
    id: inputs.id,
    idempotencyKey: inputs.idempotencyKey,
    issuedAt: inputs.issuedAt,
    tenantId: inputs.tenantId,
    correlationId: inputs.correlationId,
    type: "agent.command.check-in",
    payload,
  });
}

/**
 * Inputs needed to construct a check-in ack event envelope beyond the
 * payload itself. The control plane supplies these.
 */
export interface CheckInAckEventEnvelopeInputs {
  readonly id: EventId;
  readonly tenantId: TenantId;
  readonly subject: DeviceId;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId;
}

/**
 * Wrap a check-in ack payload in an `EventEnvelope`, reusing the frozen
 * `makeEnvelope` constructor. The envelope is the wire shape the agent
 * runtime consumes.
 */
export function wrapCheckInAck(
  payload: CheckInAckEventPayload,
  inputs: CheckInAckEventEnvelopeInputs,
): EventEnvelope<CheckInAckEventPayload> {
  return makeEnvelope<CheckInAckEventPayload>({
    id: inputs.id,
    type: "agent.session.established",
    occurredAt: inputs.occurredAt,
    tenantId: inputs.tenantId,
    subject: inputs.subject,
    schemaVersion: 1,
    payload,
    cause: {
      kind: "command",
      commandId: inputs.causationId,
      correlationId: inputs.correlationId,
    },
  });
}

// ---------------------------------------------------------------------------
// D1.4 — Pure validation
// ---------------------------------------------------------------------------

/**
 * The result of a check-in request validation. Tagged-union so callers
 * can branch on the failure mode without try/catch.
 */
export type CheckInRequestValidation =
  | { ok: true }
  | { ok: false; reason: "missing_identity" | "missing_device_id" | "missing_adapter_family" | "missing_agent_version" | "bad_protocol_version" | "bad_session_token" | "tenant_mismatch"; field?: string };

/**
 * Validate a check-in request payload against the lane's invariants. The
 * frozen `validateCommand` covers the envelope; this covers the payload
 * inside it.
 *
 * Invariants:
 *   1. `identity` is present and carries a non-empty `deviceId` and
 *      non-empty `adapterFamily`.
 *   2. `agent` is present and carries a `protocolVersion` >= 1.
 *   3. If `sessionToken` is present, it carries non-empty `value`,
 *      `issuedAt`, `expiresAt`, and ISO 8601 timestamps.
 *   4. The identity's `tenantId` matches the envelope's `tenantId` (the
 *      caller passes both).
 *
 * @param payload the check-in command payload
 * @param envelopeTenantId the tenant scope from the carrying envelope
 * @returns the validation result
 */
export function validateCheckInPayload(
  payload: CheckInCommandPayload,
  envelopeTenantId: TenantId,
): CheckInRequestValidation {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "missing_identity", field: "/payload" };
  }
  const identity = payload.identity;
  if (!identity || typeof identity !== "object") {
    return { ok: false, reason: "missing_identity", field: "/payload/identity" };
  }
  if (typeof identity.deviceId !== "string" || identity.deviceId.length === 0) {
    return { ok: false, reason: "missing_device_id", field: "/payload/identity/deviceId" };
  }
  if (typeof identity.adapterFamily !== "string" || identity.adapterFamily.length === 0) {
    return { ok: false, reason: "missing_adapter_family", field: "/payload/identity/adapterFamily" };
  }
  if (identity.tenantId !== envelopeTenantId) {
    return { ok: false, reason: "tenant_mismatch", field: "/payload/identity/tenantId" };
  }
  const agent = payload.agent;
  if (!agent || typeof agent !== "object") {
    return { ok: false, reason: "missing_agent_version", field: "/payload/agent" };
  }
  if (typeof agent.protocolVersion !== "number" || agent.protocolVersion < 1) {
    return { ok: false, reason: "bad_protocol_version", field: "/payload/agent/protocolVersion" };
  }
  if (payload.sessionToken !== undefined) {
    const token = payload.sessionToken;
    if (
      !token ||
      typeof token.value !== "string" ||
      token.value.length === 0 ||
      typeof token.issuedAt !== "string" ||
      !looksLikeIso(token.issuedAt) ||
      typeof token.expiresAt !== "string" ||
      !looksLikeIso(token.expiresAt) ||
      typeof token.issuer !== "string" ||
      token.issuer.length === 0
    ) {
      return { ok: false, reason: "bad_session_token", field: "/payload/sessionToken" };
    }
  }
  return { ok: true };
}

/**
 * Validate a full check-in command envelope: the frozen `validateCommand`
 * for the envelope, plus the lane's payload validation. Returns a
 * tagged-union result.
 */
export type CheckInCommandValidation =
  | { ok: true }
  | { ok: false; error: ReturnType<typeof makeValidationError> };

/**
 * Validate a check-in command envelope end-to-end.
 *
 * @param command the check-in command envelope
 * @returns either ok or a ValidationError mapped onto the FleetError taxonomy
 */
export function validateCheckInCommand(
  command: CommandEnvelope<CheckInCommandPayload>,
): CheckInCommandValidation {
  const trace: ErrorTrace = {
    tenantId: command.tenantId,
    correlationId: command.correlationId,
  };
  const envelopeValidation = validateCommand(command);
  if (!envelopeValidation.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        `check-in command envelope is invalid: ${envelopeValidation.reason}`,
        trace,
        [{ path: "/", reason: envelopeValidation.reason }],
      ),
    };
  }
  const tenantRef = validateTenantRef(command.tenantId);
  if (!tenantRef.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        `check-in command tenant id is invalid: ${tenantRef.reason}`,
        trace,
        [{ path: "/tenantId", reason: tenantRef.reason }],
      ),
    };
  }
  const payloadValidation = validateCheckInPayload(command.payload, command.tenantId);
  if (!payloadValidation.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        `check-in command payload is invalid: ${payloadValidation.reason}`,
        trace,
        [{ path: payloadValidation.field ?? "/", reason: payloadValidation.reason }],
      ),
    };
  }
  return { ok: true };
}

/**
 * Validate a check-in ack event envelope end-to-end. Mirrors the command
 * validation for the response direction.
 */
export type CheckInAckValidation =
  | { ok: true }
  | { ok: false; error: ReturnType<typeof makeValidationError> };

/**
 * Validate a check-in ack event envelope end-to-end.
 *
 * @param event the check-in ack event envelope
 * @returns either ok or a ValidationError mapped onto the FleetError taxonomy
 */
export function validateCheckInAck(
  event: EventEnvelope<CheckInAckEventPayload>,
): CheckInAckValidation {
  const trace: ErrorTrace = {
    tenantId: event.tenantId,
    correlationId: event.correlationId,
  };
  const envelopeValidation = validateEnvelope(event);
  if (!envelopeValidation.ok) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        `check-in ack event envelope is invalid: ${envelopeValidation.reason}`,
        trace,
        [{ path: "/", reason: envelopeValidation.reason }],
      ),
    };
  }
  const payload = event.payload;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        "check-in ack payload is missing",
        trace,
        [{ path: "/payload", reason: "required" }],
      ),
    };
  }
  const session = payload.session;
  if (!session || typeof session !== "object") {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        "check-in ack payload is missing session state",
        trace,
        [{ path: "/payload/session", reason: "required" }],
      ),
    };
  }
  if (typeof session.sessionId !== "string" || session.sessionId.length === 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        "check-in ack session id is missing",
        trace,
        [{ path: "/payload/session/sessionId", reason: "required" }],
      ),
    };
  }
  if (session.status !== "active" && session.status !== "expired" && session.status !== "revoked") {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        `check-in ack session status is invalid: ${session.status}`,
        trace,
        [{ path: "/payload/session/status", reason: "invalid_status" }],
      ),
    };
  }
  if (typeof session.expiresAt !== "string" || !looksLikeIso(session.expiresAt)) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.checkinInvalidRequest,
        "check-in ack session expiresAt is not ISO 8601",
        trace,
        [{ path: "/payload/session/expiresAt", reason: "not_iso" }],
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// D1.5 — Ack construction (control-plane side, pure)
// ---------------------------------------------------------------------------

/**
 * Inputs needed to construct a check-in ack. The control plane supplies
 * the session state and the kind; the lane wires the rest deterministically.
 */
export interface CheckInAckInputs {
  /** The session state established by the control plane. */
  readonly session: SessionState;
  /** The ack kind: `registered` (new session) or `renewed` (existing session). */
  readonly kind: "registered" | "renewed" | "rejected";
  /** Optional diagnostic message (e.g. rejection reason). */
  readonly message?: string;
}

/**
 * Construct a check-in ack event envelope from inputs. Pure: the caller
 * supplies the timestamps, ids, and traceability; the lane assembles a
 * valid-by-construction envelope that satisfies `validateCheckInAck`.
 *
 * @param inputs the ack inputs
 * @param envelopeInputs the envelope-level inputs (ids, tenant, subject, traceability)
 * @returns a frozen check-in ack event envelope
 */
export function createCheckInAck(
  inputs: CheckInAckInputs,
  envelopeInputs: CheckInAckEventEnvelopeInputs,
): EventEnvelope<CheckInAckEventPayload> {
  const payload: CheckInAckEventPayload = frozen({
    session: frozen({
      sessionId: inputs.session.sessionId,
      status: inputs.session.status,
      expiresAt: inputs.session.expiresAt,
      refreshAfterMs: inputs.session.refreshAfterMs,
    }),
    kind: inputs.kind,
    message: inputs.message,
  });
  return wrapCheckInAck(payload, envelopeInputs);
}

// ---------------------------------------------------------------------------
// D1.6 — Session state predicates
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is the session active at the given time?
 *
 * @param session the session state
 * @param at ISO 8601 timestamp (injected; never the system clock)
 * @returns true if the session is `active` and has not expired by `at`
 */
export function isSessionActive(session: SessionState, at: string): boolean {
  if (session.status !== "active") return false;
  if (!looksLikeIso(at) || !looksLikeIso(session.expiresAt)) return false;
  return at < session.expiresAt;
}

/**
 * Pure predicate: does the session need refresh by `at`? Returns true
 * when the session is expired OR when the `refreshAfterMs` hint has
 * elapsed since `at`.
 */
export function needsRefresh(session: SessionState, at: string): boolean {
  if (session.status !== "active") return true;
  if (!looksLikeIso(at) || !looksLikeIso(session.expiresAt)) return true;
  if (at >= session.expiresAt) return true;
  if (session.refreshAfterMs === null) return false;
  // We cannot compare absolute times across issuers without a known
  // issuedAt anchor. The control plane sets refreshAfterMs relative to
  // its own clock; the agent compares only the expiry boundary here.
  // A richer refresh policy is the runtime's responsibility.
  return false;
}

// ---------------------------------------------------------------------------
// D1.7 — Check-in request result (lane-side projection)
// ---------------------------------------------------------------------------

/**
 * The result of a check-in request. Either the agent receives an ack
 * payload (carried inside an event envelope — the caller may unwrap) or
 * an error mapped onto the FleetError taxonomy.
 *
 * Note: the lane does NOT execute the check-in HTTP/RPC call — that is
 * the runtime's responsibility. The lane provides the wire shapes,
 * validators, and pure helpers. The runtime composes them.
 */
export type CheckInResult =
  | { ok: true; ack: CheckInAckEventPayload }
  | { ok: false; error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError> };

/**
 * Convenience: project a validated ack event envelope into a
 * `CheckInResult`. If validation fails, returns an error result.
 */
export function projectCheckInAck(
  event: EventEnvelope<CheckInAckEventPayload>,
): CheckInResult {
  const validation = validateCheckInAck(event);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  return { ok: true, ack: event.payload };
}

/**
 * Convenience: list of all check-in-related event types this lane emits
 * or consumes. Useful for audit and adapter manifests.
 */
export const CHECKIN_EVENT_TYPES = frozenArray([
  "agent.session.established",
  "agent.session.renewed",
  "agent.session.revoked",
] as const);

/**
 * Convenience: the check-in command type string.
 */
export const CHECKIN_COMMAND_TYPE = "agent.command.check-in" as const;
