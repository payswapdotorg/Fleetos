import { test, expect } from "bun:test";
import {
  makeEnvelope,
  validateEnvelope,
  serializeEnvelope,
  type EventEnvelope,
  type EventCause,
} from "../src/events";
import { asEventId, asTenantId, asCorrelationId, asCausationId, asDeviceId, type EventId } from "../src/ids";

function goodCause(): EventCause {
  return {
    kind: "command",
    commandId: asCausationId("cmd_001"),
    correlationId: asCorrelationId("cor_001"),
  };
}

test("makeEnvelope: command cause stamps correlationId from cause and causationId from command id", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: { hello: "world" },
    cause: goodCause(),
  });
  expect(env.correlationId).toBe("cor_001");
  expect(env.causationId).toBe("cmd_001");
});

test("makeEnvelope: event cause inherits correlationId and uses source event id as causationId", () => {
  const env = makeEnvelope({
    id: asEventId("evt_002"),
    type: "device.observation.normalized",
    occurredAt: "2026-09-26T12:01:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: {
      kind: "event",
      sourceEventId: asEventId("evt_001"),
      correlationId: asCorrelationId("cor_001"),
    },
  });
  expect(env.correlationId).toBe("cor_001");
  expect(env.causationId).toBe("evt_001");
});

test("envelope invariants: tenant-scoped, correlation present, version >= 1, ISO timestamps", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: goodCause(),
  });
  const result = validateEnvelope(env);
  expect(result.ok).toBe(true);
});

test("envelope validation: missing tenantId fails", () => {
  const env = {
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: "" as unknown as ReturnType<typeof asTenantId>,
    subject: asDeviceId("dev_xyz"),
    correlationId: asCorrelationId("cor_001"),
    causationId: asCausationId("cmd_001"),
    schemaVersion: 1,
    payload: {},
  } as EventEnvelope<unknown>;
  expect(validateEnvelope(env)).toEqual({ ok: false, reason: "missing_tenant_id" });
});

test("envelope validation: missing correlationId fails", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: goodCause(),
  });
  // Mutate to break invariant (envelopes are frozen, so we cast).
  const broken = { ...env, correlationId: "" } as unknown as EventEnvelope<unknown>;
  expect(validateEnvelope(broken)).toEqual({ ok: false, reason: "missing_correlation_id" });
});

test("envelope validation: schemaVersion below 1 fails", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 0,
    payload: {},
    cause: goodCause(),
  });
  // The constructor accepts schemaVersion 0 (it doesn't enforce), so the
  // validator is the gatekeeper.
  const broken = { ...env, schemaVersion: 0 } as unknown as EventEnvelope<unknown>;
  expect(validateEnvelope(broken)).toEqual({ ok: false, reason: "schema_version_below_one" });
});

test("envelope validation: non-ISO timestamp fails", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "yesterday",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: goodCause(),
  });
  const broken = { ...env, occurredAt: "yesterday" } as unknown as EventEnvelope<unknown>;
  expect(validateEnvelope(broken)).toEqual({ ok: false, reason: "occurred_at_not_iso" });
});

test("deterministic serialization: same content produces same byte string", () => {
  const make = (): EventEnvelope<{ a: number; b: string }> =>
    makeEnvelope({
      id: asEventId("evt_001"),
      type: "device.observation.recorded",
      occurredAt: "2026-09-26T12:00:00Z",
      tenantId: asTenantId("tnt_abc12345"),
      subject: asDeviceId("dev_xyz"),
      schemaVersion: 1,
      payload: { a: 1, b: "hello" },
      cause: goodCause(),
    });
  const a = make();
  const b = make();
  expect(serializeEnvelope(a)).toBe(serializeEnvelope(b));
});

test("makeEnvelope returns a frozen envelope (immutable)", () => {
  const env = makeEnvelope({
    id: asEventId("evt_001"),
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: goodCause(),
  });
  expect(Object.isFrozen(env)).toBe(true);
});

// Type-level test (compile-only; no runtime assertion).
// If the EventId type were accidentally widened, this assignment would fail.
test("EventId brand survives round-trip through envelope", () => {
  const id: EventId = asEventId("evt_roundtrip");
  const env = makeEnvelope({
    id,
    type: "device.observation.recorded",
    occurredAt: "2026-09-26T12:00:00Z",
    tenantId: asTenantId("tnt_abc12345"),
    subject: asDeviceId("dev_xyz"),
    schemaVersion: 1,
    payload: {},
    cause: goodCause(),
  });
  expect(env.id).toBe(id);
});
