/**
 * W011 contract-conformance tests — the device-model built AGAINST the
 * frozen @fleetos/contracts surface, verified with the W003 fixture
 * builders from @fleetos/contracts/testing.
 *
 * Fixture builders consumed here (and across the other W011 test files):
 *   makeTenantId, makeDeviceId, makeObservationId, makeCorrelationId,
 *   makeCausationId, makeIdempotencyKey, makeTimestamp,
 *   makeEventEnvelope, makeCommandEnvelope, makeObservationBatch,
 *   makeAdapterCapabilities, makeFleetError
 * plus the frozen validators (validateEnvelope, validateObservationBatch,
 * validateTenantRef, canTransitionDevice, toApiError, isSupported).
 */

import { test, expect } from "bun:test";
import {
  canTransitionDevice,
  isSupported,
  toApiError,
  validateEnvelope,
  validateObservationBatch,
  validateTenantRef,
} from "@fleetos/contracts";
import {
  makeAdapterCapabilities,
  makeCausationId,
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeEventEnvelope,
  makeFleetError,
  makeIdempotencyKey,
  makeObservationBatch,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { OWNERSHIP_TYPE_FLEET_PURCHASED, enrollDevice, transitionDeviceLifecycle } from "../src/identity";
import { createTwin, recordTwinObservations } from "../src/twin";
import { createObservationIngestionService } from "../src/ingestion";
import { createInMemoryAuditSink } from "../src/audit-seam";
import { createInMemoryTwinStore } from "../src/store";

// ---------------------------------------------------------------------------
// ID fixtures -> device-model lane
// ---------------------------------------------------------------------------

test("conformance: makeDeviceId feeds enrollment and the twin round-trips it", () => {
  const tenantId = makeTenantId("conformance-tenant");
  const deviceId = makeDeviceId("conformance-device");
  expect(validateTenantRef(tenantId).ok).toBe(true);

  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "windows",
    hardware: { manufacturer: "HP", model: "EliteBook" },
    ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
    at: makeTimestamp("conformance-enroll"),
    provenance: { correlationId: makeCorrelationId("conformance") },
  });
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) return;
  expect(enrolled.identity.deviceId).toBe(deviceId);
  expect(enrolled.identity.tenantId).toBe(tenantId);

  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: makeTimestamp("conformance-create"), correlationId: makeCorrelationId("conformance") },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.twin.deviceId).toBe(deviceId);
  expect(created.twin.revisions[0].correlationId).toBe(makeCorrelationId("conformance"));
});

// ---------------------------------------------------------------------------
// Event envelope conformance (makeEventEnvelope)
// ---------------------------------------------------------------------------

test("conformance: the observation-recorded event interops with the frozen envelope contract", () => {
  const tenantId = makeTenantId("envelope-tenant");
  const deviceId = makeDeviceId("envelope-device");
  const correlationId = makeCorrelationId("envelope-cor");

  // The device-model's revision carries the correlation id; an event
  // envelope for the same causal graph validates against the frozen
  // validator and threads the same correlation.
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "macos",
    hardware: { manufacturer: "Apple", model: "Mac mini" },
    ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
    at: makeTimestamp("envelope-at"),
    provenance: { correlationId },
  });
  if (!enrolled.ok) throw new Error("enrollment failed");
  const created = createTwin({ identity: enrolled.identity, ctx: { at: makeTimestamp("envelope-at"), correlationId } });
  if (!created.ok) throw new Error("creation failed");

  const observationId = makeObservationId("envelope-obs");
  const recorded = recordTwinObservations(
    created.twin,
    [
      {
        id: observationId,
        kind: "device.health",
        observedAt: makeTimestamp("envelope-obs-at"),
        schemaVersion: 1,
        payload: { ok: true },
      },
    ],
    { at: makeTimestamp("envelope-record-at"), correlationId },
  );
  if (!recorded.ok) throw new Error("record failed");

  const envelope = makeEventEnvelope({
    seed: "envelope",
    tenantId,
    type: "device.observation.recorded",
    subject: deviceId,
    payload: { observationId: observationId as string, twinRevision: recorded.twin.revision },
    occurredAt: makeTimestamp("envelope-record-at"),
  });
  expect(validateEnvelope(envelope).ok).toBe(true);
  // Same causal graph: the twin revision and the envelope agree on time.
  expect(envelope.occurredAt).toBe(recorded.revision.at);
  expect(envelope.subject).toBe(recorded.twin.deviceId);
});

// ---------------------------------------------------------------------------
// Command envelope conformance (makeCommandEnvelope) — the check-in command
// ---------------------------------------------------------------------------

test("conformance: the agent check-in command's idempotency key drives admission (contracts idempotency)", () => {
  const tenantId = makeTenantId("command-tenant");
  const deviceId = makeDeviceId("command-device");
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "linux",
    hardware: { manufacturer: "Purism", model: "Librem 14" },
    ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
    at: makeTimestamp("command-at"),
    provenance: { correlationId: makeCorrelationId("command") },
  });
  if (!enrolled.ok) throw new Error("enrollment failed");
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: makeTimestamp("command-at"), correlationId: makeCorrelationId("command") },
  });
  if (!created.ok) throw new Error("creation failed");
  store.put(created.twin);

  const service = createObservationIngestionService({ store });
  const command = makeCommandEnvelope({
    seed: "check-in-command",
    tenantId,
    type: "device.command.check-in",
    payload: { deviceId: deviceId as string },
  });

  const batch = makeObservationBatch({ seed: "command-batch", tenantId, deviceId, count: 2 });
  const first = service.ingest({
    tenantId,
    batch,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.id as never,
    receivedAt: makeTimestamp("command-received"),
  });
  expect(first.ok).toBe(true);
  if (!first.ok || first.ack.kind !== "admitted") return;

  // Redelivery of the SAME command (network retry): the frozen contracts
  // duplicate-suppression contract — same (tenantId, idempotencyKey) =>
  // same logical effect once; the original outcome is returned.
  const replay = service.ingest({
    tenantId,
    batch,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    causationId: command.id as never,
    receivedAt: makeTimestamp("command-retry"),
  });
  expect(replay.ok).toBe(true);
  if (!replay.ok || replay.ack.kind !== "duplicate") return;
  expect(replay.ack.admittedObservations).toBe(first.ack.admittedObservations);
  expect(makeIdempotencyKey("x")).not.toBe(makeIdempotencyKey("y"));
});

// ---------------------------------------------------------------------------
// Observation batch conformance (makeObservationBatch)
// ---------------------------------------------------------------------------

test("conformance: makeObservationBatch flows through the full ingestion boundary", () => {
  const tenantId = makeTenantId("batch-tenant");
  const deviceId = makeDeviceId("batch-device");
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "windows",
    hardware: { manufacturer: "Lenovo", model: "Yoga" },
    ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
    at: makeTimestamp("batch-at"),
    provenance: { correlationId: makeCorrelationId("batch") },
  });
  if (!enrolled.ok) throw new Error("enrollment failed");
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: makeTimestamp("batch-at"), correlationId: makeCorrelationId("batch") },
  });
  if (!created.ok) throw new Error("creation failed");
  store.put(created.twin);

  const batch = makeObservationBatch({ seed: "conformance-batch", tenantId, deviceId, count: 5 });
  // Valid by construction (W003 guarantee) — re-verified here.
  expect(validateObservationBatch(batch).ok).toBe(true);

  const audit = createInMemoryAuditSink();
  const service = createObservationIngestionService({ store, auditSink: audit });
  const result = service.ingest({
    tenantId,
    batch,
    idempotencyKey: makeIdempotencyKey("conformance-batch-key"),
    correlationId: makeCorrelationId("conformance-batch-cor"),
    causationId: makeCausationId("conformance-batch-cause"),
    receivedAt: makeTimestamp("batch-received"),
  });
  expect(result.ok).toBe(true);
  if (!result.ok || result.ack.kind !== "admitted") return;
  expect(result.ack.admittedObservations).toBe(5);

  const twin = store.get(tenantId, deviceId);
  if (!twin) throw new Error("twin missing");
  expect(twin.telemetry.observationCount).toBe(5);
  // The stored observations are the fixture's, byte for byte.
  expect(twin.telemetry.latest.map((o) => o.id)).toEqual(batch.observations.map((o) => o.id));
});

// ---------------------------------------------------------------------------
// Adapter capabilities conformance
// ---------------------------------------------------------------------------

test("conformance: makeAdapterCapabilities populates the twin capability section (contracts reuse)", () => {
  const tenantId = makeTenantId("caps-tenant");
  const deviceId = makeDeviceId("caps-device");
  const caps = makeAdapterCapabilities({ supported: ["observe", "health", "locate"], unsupported: ["wipe"] });
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "android",
    hardware: { manufacturer: "Google", model: "Pixel 9" },
    ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
    at: makeTimestamp("caps-at"),
    provenance: { correlationId: makeCorrelationId("caps") },
  });
  if (!enrolled.ok) throw new Error("enrollment failed");
  const created = createTwin({
    identity: enrolled.identity,
    adapterCapabilities: caps,
    ctx: { at: makeTimestamp("caps-at"), correlationId: makeCorrelationId("caps") },
  });
  if (!created.ok) throw new Error("creation failed");
  // The frozen contracts helpers read the twin's section directly.
  expect(isSupported("observe", created.twin.capabilities.adapterCapabilities)).toBe(true);
  expect(isSupported("locate", created.twin.capabilities.adapterCapabilities)).toBe(true);
  expect(isSupported("wipe", created.twin.capabilities.adapterCapabilities)).toBe(false);
});

// ---------------------------------------------------------------------------
// FleetError taxonomy conformance (makeFleetError + toApiError)
// ---------------------------------------------------------------------------

test("conformance: device-model errors are first-class FleetErrors for the frozen translator", () => {
  const tenantId = makeTenantId("error-tenant");
  const correlationId = makeCorrelationId("error-cor");

  // DomainError: illegal lifecycle transition -> 400 via the FROZEN
  // contracts toApiError translator.
  const illegal = transitionDeviceLifecycle("ENROLL", "AUTHORIZE", { tenantId, correlationId });
  expect(illegal.ok).toBe(false);
  if (illegal.ok) return;
  const api = toApiError(illegal.error);
  expect(api.status).toBe(400);
  expect(api.kind).toBe("DomainError");
  expect(api.code).toBe("device.lifecycle.illegal_transition");
  expect(api.tenantId).toBe(tenantId);
  expect(api.correlationId).toBe(correlationId);

  // The fixture error of the same kind round-trips identically — the
  // device-model's errors and the fixture errors are the same taxonomy.
  const fixture = makeFleetError({ seed: "same-kind", kind: "DomainError", tenantId, correlationId });
  expect(toApiError(fixture).status).toBe(api.status);
  expect(toApiError(fixture).kind).toBe(api.kind);
});

test("conformance: all six fixture error kinds translate through the frozen taxonomy", () => {
  const tenantId = makeTenantId("taxonomy-tenant");
  const kinds = ["DomainError", "PolicyError", "AuthorizationError", "AdapterError", "ConflictError", "ValidationError"] as const;
  const expected: Record<string, number> = {
    DomainError: 400,
    PolicyError: 403,
    AuthorizationError: 403,
    AdapterError: 502,
    ConflictError: 409,
    ValidationError: 400,
  };
  for (const kind of kinds) {
    const error = makeFleetError({ seed: `taxonomy-${kind}`, kind, tenantId });
    const api = toApiError(error);
    expect(api.status).toBe(expected[kind]);
    expect(api.tenantId).toBe(tenantId);
  }
});

// ---------------------------------------------------------------------------
// Lifecycle conformance against the frozen table
// ---------------------------------------------------------------------------

test("conformance: the lane's transition function agrees with the frozen contracts predicate everywhere", () => {
  const tenantId = makeTenantId("lifecycle-tenant");
  const correlationId = makeCorrelationId("lifecycle-cor");
  const states = [
    "ENROLL",
    "OBSERVE",
    "ASSESS",
    "DIAGNOSE",
    "PLAN",
    "AUTHORIZE",
    "EXECUTE",
    "VERIFY",
    "LEARN",
  ] as const;
  for (const from of states) {
    for (const to of states) {
      const expected = canTransitionDevice(from, to);
      const result = transitionDeviceLifecycle(from, to, { tenantId, correlationId });
      expect(result.ok).toBe(expected);
    }
  }
});
