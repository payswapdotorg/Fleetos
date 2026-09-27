/**
 * W010 D1 — check-in / registration handshake tests.
 *
 * Covers:
 *   - Envelope construction (reuses frozen makeCommand / makeEnvelope)
 *   - Payload validation (lane invariants)
 *   - End-to-end command + ack envelope validation
 *   - Session-state predicates (active / needs refresh)
 *   - Tenant isolation (identity.tenantId must match envelope.tenantId)
 *   - Determinism (same inputs => same envelopes, byte-for-byte)
 */

import { test, expect } from "bun:test";
import {
  makeCommand,
  makeEnvelope,
  validateCommand,
  validateEnvelope,
  type EventEnvelope,
} from "@fleetos/contracts";
import {
  CHECKIN_COMMAND_TYPE,
  createCheckInAck,
  isSessionActive,
  needsRefresh,
  projectCheckInAck,
  validateCheckInAck,
  validateCheckInCommand,
  validateCheckInPayload,
  wrapCheckInAck,
  wrapCheckInCommand,
  type CheckInAckEventPayload,
  type CheckInCommandPayload,
  type SessionState,
} from "../src/checkin";
import { ERROR_CODES } from "../src/internal";
import {
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeEventEnvelope,
  makeEventId,
  makeIdempotencyKey,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPayload(tenantId: ReturnType<typeof makeTenantId>): CheckInCommandPayload {
  return {
    identity: {
      tenantId,
      deviceId: makeDeviceId("checkin-device"),
      adapterFamily: "windows",
    },
    agent: {
      moduleName: "agent",
      moduleVersion: "0.1.0",
      protocolVersion: 1,
    },
  };
}

function validSession(): SessionState {
  return {
    sessionId: "sess_abc",
    status: "active",
    expiresAt: "2026-01-01T12:00:00Z",
    refreshAfterMs: 60_000,
  };
}

// ---------------------------------------------------------------------------
// Envelope construction — reuses frozen makeCommand/makeEnvelope (no duplication)
// ---------------------------------------------------------------------------

test("D1: wrapCheckInCommand produces a command envelope that satisfies validateCommand", () => {
  const tenantId = makeTenantId("checkin-tenant");
  const command = wrapCheckInCommand(validPayload(tenantId), {
    id: makeCommandEnvelope({ seed: "cmd" }).id,
    idempotencyKey: makeIdempotencyKey("checkin-key"),
    correlationId: makeCorrelationId("checkin-cor"),
    issuedAt: makeTimestamp("checkin-issued"),
    tenantId,
  });
  expect(command.type).toBe(CHECKIN_COMMAND_TYPE);
  expect(validateCommand(command).ok).toBe(true);
  expect(command.tenantId).toBe(tenantId);
});

test("D1: wrapCheckInAck produces an event envelope that satisfies validateEnvelope", () => {
  const tenantId = makeTenantId("ack-tenant");
  const deviceId = makeDeviceId("ack-device");
  const ackPayload: CheckInAckEventPayload = {
    session: validSession(),
    kind: "registered",
  };
  const event = wrapCheckInAck(ackPayload, {
    id: makeEventId("ack-event"),
    tenantId,
    subject: deviceId,
    occurredAt: makeTimestamp("ack-occurred"),
    correlationId: makeCorrelationId("ack-cor"),
    causationId: makeCommandEnvelope({ seed: "ack-cmd" }).id as never,
  });
  expect(event.type).toBe("agent.session.established");
  expect(validateEnvelope(event).ok).toBe(true);
  expect(event.subject).toBe(deviceId);
});

test("D1: the lane does NOT duplicate envelope shapes — wrapCheckInCommand delegates to makeCommand", () => {
  const tenantId = makeTenantId("delegate-tenant");
  const payload = validPayload(tenantId);
  const wrapped = wrapCheckInCommand(payload, {
    id: makeCommandEnvelope({ seed: "delegate" }).id,
    idempotencyKey: makeIdempotencyKey("delegate-key"),
    correlationId: makeCorrelationId("delegate-cor"),
    issuedAt: makeTimestamp("delegate-issued"),
    tenantId,
  });
  // Construct the same envelope directly with the frozen constructor.
  const direct = makeCommand<CheckInCommandPayload>({
    id: wrapped.id,
    idempotencyKey: wrapped.idempotencyKey,
    issuedAt: wrapped.issuedAt,
    tenantId: wrapped.tenantId,
    correlationId: wrapped.correlationId,
    type: wrapped.type,
    payload,
  });
  expect(JSON.stringify(wrapped)).toBe(JSON.stringify(direct));
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

test("D1: validateCheckInPayload accepts a well-formed payload", () => {
  const tenantId = makeTenantId("valid-tenant");
  const result = validateCheckInPayload(validPayload(tenantId), tenantId);
  expect(result.ok).toBe(true);
});

test("D1: validateCheckInPayload rejects a payload with a tenant mismatch", () => {
  const tenantA = makeTenantId("tenant-a");
  const tenantB = makeTenantId("tenant-b");
  const payload = validPayload(tenantA);
  const result = validateCheckInPayload(payload, tenantB);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("tenant_mismatch");
  }
});

test("D1: validateCheckInPayload rejects a payload with a missing device id", () => {
  const tenantId = makeTenantId("missing-device-tenant");
  const payload: CheckInCommandPayload = {
    identity: {
      tenantId,
      deviceId: "" as never,
      adapterFamily: "windows",
    },
    agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
  };
  const result = validateCheckInPayload(payload, tenantId);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("missing_device_id");
  }
});

test("D1: validateCheckInPayload rejects a payload with a bad protocol version", () => {
  const tenantId = makeTenantId("bad-proto-tenant");
  const payload: CheckInCommandPayload = {
    identity: {
      tenantId,
      deviceId: makeDeviceId("proto-device"),
      adapterFamily: "linux",
    },
    agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 0 },
  };
  const result = validateCheckInPayload(payload, tenantId);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("bad_protocol_version");
  }
});

test("D1: validateCheckInPayload rejects a payload with a bad session token", () => {
  const tenantId = makeTenantId("bad-token-tenant");
  const payload: CheckInCommandPayload = {
    identity: {
      tenantId,
      deviceId: makeDeviceId("token-device"),
      adapterFamily: "macos",
    },
    agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
    sessionToken: {
      value: "",
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T01:00:00Z",
      issuer: "control-plane",
    },
  };
  const result = validateCheckInPayload(payload, tenantId);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("bad_session_token");
  }
});

// ---------------------------------------------------------------------------
// End-to-end command + ack validation
// ---------------------------------------------------------------------------

test("D1: validateCheckInCommand accepts a fully-valid command envelope", () => {
  const tenantId = makeTenantId("e2e-cmd-tenant");
  const command = wrapCheckInCommand(validPayload(tenantId), {
    id: makeCommandEnvelope({ seed: "e2e-cmd" }).id,
    idempotencyKey: makeIdempotencyKey("e2e-cmd-key"),
    correlationId: makeCorrelationId("e2e-cmd-cor"),
    issuedAt: makeTimestamp("e2e-cmd-issued"),
    tenantId,
  });
  const result = validateCheckInCommand(command);
  expect(result.ok).toBe(true);
});

test("D1: validateCheckinCommand rejects an envelope with a bad issuedAt", () => {
  const tenantId = makeTenantId("bad-ts-tenant");
  const command = wrapCheckInCommand(validPayload(tenantId), {
    id: makeCommandEnvelope({ seed: "bad-ts" }).id,
    idempotencyKey: makeIdempotencyKey("bad-ts-key"),
    correlationId: makeCorrelationId("bad-ts-cor"),
    issuedAt: "not-iso",
    tenantId,
  });
  const result = validateCheckInCommand(command);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(ERROR_CODES.checkinInvalidRequest);
    expect(result.error.kind).toBe("ValidationError");
  }
});

test("D1: validateCheckInAck accepts a fully-valid ack event envelope", () => {
  const tenantId = makeTenantId("e2e-ack-tenant");
  const deviceId = makeDeviceId("e2e-ack-device");
  const event = createCheckInAck(
    { session: validSession(), kind: "registered" },
    {
      id: makeEventId("e2e-ack"),
      tenantId,
      subject: deviceId,
      occurredAt: makeTimestamp("e2e-ack-occurred"),
      correlationId: makeCorrelationId("e2e-ack-cor"),
      causationId: makeCommandEnvelope({ seed: "e2e-ack" }).id as never,
    },
  );
  const result = validateCheckInAck(event);
  expect(result.ok).toBe(true);
});

test("D1: projectCheckInAck returns the ack payload for a valid event", () => {
  const tenantId = makeTenantId("project-ack-tenant");
  const deviceId = makeDeviceId("project-ack-device");
  const event = createCheckInAck(
    { session: validSession(), kind: "registered" },
    {
      id: makeEventId("project-ack"),
      tenantId,
      subject: deviceId,
      occurredAt: makeTimestamp("project-ack"),
      correlationId: makeCorrelationId("project-ack"),
      causationId: makeCommandEnvelope({ seed: "project-ack" }).id as never,
    },
  );
  const result = projectCheckInAck(event);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.ack.kind).toBe("registered");
    expect(result.ack.session.status).toBe("active");
  }
});

// ---------------------------------------------------------------------------
// Session-state predicates
// ---------------------------------------------------------------------------

test("D1: isSessionActive returns true for an active session before expiry", () => {
  const session = validSession();
  expect(isSessionActive(session, "2026-01-01T10:00:00Z")).toBe(true);
});

test("D1: isSessionActive returns false after expiry", () => {
  const session = validSession();
  expect(isSessionActive(session, "2026-01-01T13:00:00Z")).toBe(false);
});

test("D1: isSessionActive returns false for a revoked session", () => {
  const session: SessionState = { ...validSession(), status: "revoked" };
  expect(isSessionActive(session, "2026-01-01T10:00:00Z")).toBe(false);
});

test("D1: needsRefresh returns true for a non-active session", () => {
  const session: SessionState = { ...validSession(), status: "expired" };
  expect(needsRefresh(session, "2026-01-01T10:00:00Z")).toBe(true);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("D1: wrapCheckInCommand is deterministic — same inputs produce byte-identical envelopes", () => {
  const tenantId = makeTenantId("determ-tenant");
  const payload = validPayload(tenantId);
  const inputs = {
    id: makeCommandEnvelope({ seed: "determ" }).id,
    idempotencyKey: makeIdempotencyKey("determ-key"),
    correlationId: makeCorrelationId("determ-cor"),
    issuedAt: makeTimestamp("determ-issued"),
    tenantId,
  };
  const a = wrapCheckInCommand(payload, inputs);
  const b = wrapCheckInCommand(payload, inputs);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("D1: createCheckInAck is deterministic — same inputs produce byte-identical acks", () => {
  const tenantId = makeTenantId("determ-ack-tenant");
  const deviceId = makeDeviceId("determ-ack-device");
  const ackInputs = { session: validSession(), kind: "registered" as const };
  const envInputs = {
    id: makeEventId("determ-ack"),
    tenantId,
    subject: deviceId,
    occurredAt: makeTimestamp("determ-ack"),
    correlationId: makeCorrelationId("determ-ack-cor"),
    causationId: makeCommandEnvelope({ seed: "determ-ack" }).id as never,
  };
  const a = createCheckInAck(ackInputs, envInputs);
  const b = createCheckInAck(ackInputs, envInputs);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
