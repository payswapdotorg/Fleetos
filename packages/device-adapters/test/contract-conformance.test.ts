/**
 * W010 contract-conformance tests — the device-adapters built AGAINST the
 * frozen @fleetos/contracts surface, verified with the W003 fixture
 * builders from @fleetos/contracts/testing.
 *
 * Fixture builders consumed here (and across the other W010 test files):
 *   makeTenantId, makeDeviceId, makeObservationId, makeCorrelationId,
 *   makeCausationId, makeIdempotencyKey, makePolicyId, makeTimestamp,
 *   makeEventEnvelope, makeCommandEnvelope, makeObservationBatch,
 *   makeAdapterCapabilities, makeFleetError, makeGuardianDecision
 * plus the frozen validators (validateEnvelope, validateCommand,
 * validateObservationBatch, validateTenantRef, assertSupported,
 * isSupported, isDestructive, canTransitionDevice, toApiError).
 */

import { test, expect } from "bun:test";
import {
  assertSupported,
  isDestructive,
  isSupported,
  makeCommand,
  makeEnvelope,
  toApiError,
  validateCommand,
  validateEnvelope,
  validateObservationBatch,
  validateTenantRef,
  type CommandEnvelope,
  type EventEnvelope,
} from "@fleetos/contracts";
import {
  makeAdapterCapabilities,
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeEventEnvelope,
  makeEventId,
  makeFleetError,
  makeIdempotencyKey,
  makeObservationBatch,
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  CHECKIN_COMMAND_TYPE,
  createCheckInAck,
  validateCheckInAck,
  validateCheckInCommand,
  wrapCheckInAck,
  wrapCheckInCommand,
  type CheckInAckEventPayload,
  type CheckInCommandPayload,
} from "../src/checkin";
import { declareAgentCapabilities, negotiateCapability } from "../src/capabilities";
import { createObservationCollector, deriveBatchIdempotencyKey } from "../src/observations";
import { createCommandReceiptTracker, mapAgentFailure } from "../src/commands";
import {
  ACCEPT_ALL_VERIFIER,
  createPolicyCache,
  createSignedPolicyDocument,
} from "../src/policy-cache";
import { ERROR_CODES } from "../src/internal";

// ---------------------------------------------------------------------------
// ID fixtures -> device-adapters lane
// ---------------------------------------------------------------------------

test("conformance: makeDeviceId feeds the check-in identity; the lane round-trips it", () => {
  const tenantId = makeTenantId("conf-tenant");
  const deviceId = makeDeviceId("conf-device");
  expect(validateTenantRef(tenantId).ok).toBe(true);

  const payload: CheckInCommandPayload = {
    identity: { tenantId, deviceId, adapterFamily: "windows" },
    agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
  };
  const command = wrapCheckInCommand(payload, {
    id: makeCommandEnvelope({ seed: "conf-cmd" }).id,
    idempotencyKey: makeIdempotencyKey("conf-key"),
    correlationId: makeCorrelationId("conf-cor"),
    issuedAt: makeTimestamp("conf-issued"),
    tenantId,
  });
  expect(command.payload.identity.deviceId).toBe(deviceId);
  expect(command.tenantId).toBe(tenantId);
  expect(validateCheckInCommand(command).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Command envelope conformance (makeCommandEnvelope) — the check-in command
// ---------------------------------------------------------------------------

test("conformance: the check-in command's idempotency key drives command receipt (contracts idempotency)", () => {
  const tenantId = makeTenantId("conf-cmd-tenant");
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({
    seed: "conf-check-in",
    tenantId,
    type: "agent.command.check-in",
    payload: {} as Record<string, never>,
  });

  // First delivery: new receipt.
  const first = tracker.acknowledge(command, makeTimestamp("conf-first"));
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.replayed).toBe(false);

  // Redelivery: replay (same logical effect once).
  const replay = tracker.acknowledge(command, makeTimestamp("conf-retry"));
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.replayed).toBe(true);
});

// ---------------------------------------------------------------------------
// Event envelope conformance (makeEventEnvelope) — the check-in ack event
// ---------------------------------------------------------------------------

test("conformance: the check-in ack event interops with the frozen envelope contract", () => {
  const tenantId = makeTenantId("conf-ack-tenant");
  const deviceId = makeDeviceId("conf-ack-device");
  const ackPayload: CheckInAckEventPayload = {
    session: {
      sessionId: "sess_conf",
      status: "active",
      expiresAt: "2026-01-01T12:00:00Z",
      refreshAfterMs: 60_000,
    },
    kind: "registered",
  };
  const event = wrapCheckInAck(ackPayload, {
    id: makeEventId("conf-ack"),
    tenantId,
    subject: deviceId,
    occurredAt: makeTimestamp("conf-ack-occurred"),
    correlationId: makeCorrelationId("conf-ack-cor"),
    causationId: makeCommandEnvelope({ seed: "conf-ack" }).id as never,
  });
  expect(validateEnvelope(event).ok).toBe(true);
  expect(event.subject).toBe(deviceId);
  expect(event.tenantId).toBe(tenantId);
});

test("conformance: createCheckInAck produces an event that satisfies validateCheckInAck", () => {
  const tenantId = makeTenantId("conf-create-ack-tenant");
  const deviceId = makeDeviceId("conf-create-ack-device");
  const event = createCheckInAck(
    {
      session: {
        sessionId: "sess_create",
        status: "active",
        expiresAt: "2026-01-01T12:00:00Z",
        refreshAfterMs: 60_000,
      },
      kind: "registered",
    },
    {
      id: makeEventId("conf-create-ack"),
      tenantId,
      subject: deviceId,
      occurredAt: makeTimestamp("conf-create-ack"),
      correlationId: makeCorrelationId("conf-create-ack-cor"),
      causationId: makeCommandEnvelope({ seed: "conf-create-ack" }).id as never,
    },
  );
  expect(validateCheckInAck(event).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Observation batch conformance (makeObservationBatch)
// ---------------------------------------------------------------------------

test("conformance: makeObservationBatch feeds the device-adapters producer invariant", () => {
  const tenantId = makeTenantId("conf-batch-tenant");
  const deviceId = makeDeviceId("conf-batch-device");
  const batch = makeObservationBatch({ seed: "conf-batch", tenantId, deviceId, count: 5 });
  // The frozen validator MUST accept the fixture batch (W003 guarantee).
  expect(validateObservationBatch(batch).ok).toBe(true);

  // The lane's idempotency-key derivation is a pure function of the batch
  // (deterministic canonical JSON digest). Re-derive on the same batch
  // and confirm equality.
  const key1 = deriveBatchIdempotencyKey(batch);
  const key2 = deriveBatchIdempotencyKey(batch);
  expect(key1 as string).toBe(key2 as string);
});

test("conformance: the device-adapters observation collector emits batches the frozen validator accepts", () => {
  const tenantId = makeTenantId("conf-collector-tenant");
  const deviceId = makeDeviceId("conf-collector-device");
  const collector = createObservationCollector({ tenantId, deviceId });
  for (let i = 0; i < 5; i++) {
    collector.record({
      kind: "device.health",
      observedAt: makeTimestamp(`conf-coll-${i}`),
      schemaVersion: 1,
      payload: { idx: i },
    });
  }
  const flush = collector.flush(makeTimestamp("conf-coll-flush"));
  expect(flush.ok).toBe(true);
  if (!flush.ok) return;
  // The collector's output is valid by construction — the frozen
  // validator MUST accept it.
  expect(validateObservationBatch(flush.batch).ok).toBe(true);
  expect(flush.batch.tenantId).toBe(tenantId);
  expect(flush.batch.deviceId).toBe(deviceId);
});

// ---------------------------------------------------------------------------
// Adapter capabilities conformance (makeAdapterCapabilities)
// ---------------------------------------------------------------------------

test("conformance: makeAdapterCapabilities populates the declared record (contracts reuse)", () => {
  const tenantId = makeTenantId("conf-caps-tenant");
  const deviceId = makeDeviceId("conf-caps-device");
  const caps = makeAdapterCapabilities({
    supported: ["observe", "health", "wipe"],
    unsupported: ["locate"],
  });
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: caps,
    declaredAt: makeTimestamp("conf-caps-at"),
    deviceId,
  });
  // The frozen contracts helpers read the record directly.
  expect(isSupported("observe", declared.capabilities)).toBe(true);
  expect(isSupported("wipe", declared.capabilities)).toBe(true);
  expect(isSupported("locate", declared.capabilities)).toBe(false);
  expect(isDestructive("wipe")).toBe(true);
  expect(isDestructive("observe")).toBe(false);
});

test("conformance: the lane's negotiateCapability delegates to the frozen assertSupported", () => {
  const tenantId = makeTenantId("conf-negotiate-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "linux",
    capabilities: makeAdapterCapabilities({ supported: ["wipe"] }),
    declaredAt: makeTimestamp("conf-negotiate-at"),
  });
  // Supported + grant + cache ready => ok (matches assertSupported).
  const frozen = assertSupported("wipe", declared.capabilities, true);
  const lane = negotiateCapability(declared, {
    tenantId,
    capability: "wipe",
    policyGrant: true,
    policyCacheReady: true,
    correlationId: makeCorrelationId("conf-negotiate-cor"),
  });
  expect(lane.ok).toBe(frozen.ok);
});

// ---------------------------------------------------------------------------
// FleetError taxonomy conformance (makeFleetError + toApiError)
// ---------------------------------------------------------------------------

test("conformance: device-adapters errors are first-class FleetErrors for the frozen translator", () => {
  const tenantId = makeTenantId("conf-error-tenant");
  const correlationId = makeCorrelationId("conf-error-cor");

  // AdapterError: unsupported capability -> 502 via the FROZEN contracts
  // toApiError translator.
  const unsupported = negotiateCapability(
    declareAgentCapabilities({
      tenantId,
      adapterFamily: "android",
      capabilities: makeAdapterCapabilities({ supported: ["observe"] }),
      declaredAt: makeTimestamp("conf-err-at"),
    }),
    {
      tenantId,
      capability: "wipe",
      policyGrant: true,
      policyCacheReady: true,
      correlationId,
    },
  );
  expect(unsupported.ok).toBe(false);
  if (unsupported.ok) return;
  const api = toApiError(unsupported.error);
  expect(api.status).toBe(502);
  expect(api.kind).toBe("AdapterError");
  expect(api.code).toBe(ERROR_CODES.capabilityUnsupported);
  expect(api.tenantId).toBe(tenantId);
  expect(api.correlationId).toBe(correlationId);

  // The fixture error of the same kind round-trips identically — the
  // device-adapters's errors and the fixture errors are the same taxonomy.
  const fixture = makeFleetError({ seed: "conf-same-kind", kind: "AdapterError", tenantId, correlationId });
  expect(toApiError(fixture).status).toBe(api.status);
  expect(toApiError(fixture).kind).toBe(api.kind);
});

test("conformance: all six fixture error kinds translate through the frozen taxonomy", () => {
  const tenantId = makeTenantId("conf-taxonomy-tenant");
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
    const error = makeFleetError({ seed: `conf-tax-${kind}`, kind, tenantId });
    const api = toApiError(error);
    expect(api.status).toBe(expected[kind]);
    expect(api.tenantId).toBe(tenantId);
  }
});

test("conformance: mapAgentFailure's PolicyError (BLOCK) translates to HTTP 403 (matches the frozen translator)", () => {
  const tenantId = makeTenantId("conf-map-tenant");
  const error = mapAgentFailure(
    "destructive_offline_default_deny",
    "test default-deny",
    { tenantId, correlationId: makeCorrelationId("conf-map-cor") },
    { capability: "wipe", adapterFamily: "windows" },
  );
  const api = toApiError(error);
  expect(api.status).toBe(403);
  expect(api.kind).toBe("PolicyError");
});

// ---------------------------------------------------------------------------
// Guardian decision conformance (the policy cache's default-deny mirrors
// the frozen BLOCK decision)
// ---------------------------------------------------------------------------

test("conformance: the policy cache's default-deny is a BLOCK decision (contracts decision type)", async () => {
  const tenantId = makeTenantId("conf-deny-tenant");
  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  // Empty cache -> default-deny.
  const result = cache.authorizeConsequential(makeTimestamp("conf-deny-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    // The lane's PolicyError carries decision: "BLOCK" — the frozen
    // contracts decision type that prevents an action from executing.
    expect((result.error as { decision: string }).decision).toBe("BLOCK");
    // The frozen toApiError translates BLOCK to HTTP 403.
    expect(toApiError(result.error).status).toBe(403);
  }
});

// ---------------------------------------------------------------------------
// Signed policy document construction (uses makePolicyId fixture)
// ---------------------------------------------------------------------------

test("conformance: createSignedPolicyDocument accepts a makePolicyId fixture", async () => {
  const tenantId = makeTenantId("conf-doc-tenant");
  const policyId = makePolicyId("conf-doc");
  const doc = createSignedPolicyDocument({
    policyId,
    version: 1,
    signedAt: makeTimestamp("conf-doc-signed"),
    payload: { rules: [] },
    signature: "sig",
    signatureAlgorithm: "ed25519",
  });
  expect(doc.policyId).toBe(policyId);

  const cache = createPolicyCache({ tenantId, verifier: ACCEPT_ALL_VERIFIER });
  const result = await cache.put(doc, makeTimestamp("conf-doc-fetched"));
  expect(result.ok).toBe(true);
});
