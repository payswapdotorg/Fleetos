/**
 * W010 apps/agent — AgentRuntime composition tests.
 *
 * Verifies the thin composition layer in apps/agent wires the
 * device-adapters modules into a single AgentRuntime entry type. The
 * runtime delegates every operation to device-adapters; this test
 * verifies the delegation is correct and the runtime is a faithful
 * composition.
 */

import { test, expect } from "bun:test";
import {
  validateCommand,
  validateObservationBatch,
  type AdapterCapabilities,
} from "@fleetos/contracts";
import {
  makeAdapterCapabilities,
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { ACCEPT_ALL_VERIFIER } from "@fleetos/device-adapters";
import {
  createAgentRuntime,
  type AgentIdentity,
  type AgentRuntime,
  type AgentVersionInfo,
} from "../src/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRuntime(seed: string, caps?: AdapterCapabilities): AgentRuntime {
  const tenantId = makeTenantId(`rt-${seed}`);
  const deviceId = makeDeviceId(`rt-${seed}`);
  const identity: AgentIdentity = {
    tenantId,
    deviceId,
    adapterFamily: "windows",
  };
  const agent: AgentVersionInfo = {
    moduleName: "agent",
    moduleVersion: "0.1.0",
    protocolVersion: 1,
  };
  return createAgentRuntime({
    identity,
    agent,
    capabilities: caps ?? makeAdapterCapabilities({ supported: ["observe", "health", "wipe"] }),
    policyVerifier: ACCEPT_ALL_VERIFIER,
  });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("runtime: createAgentRuntime wires the device-adapters modules into a single entry", () => {
  const rt = makeRuntime("ctor");
  expect(rt.identity.adapterFamily).toBe("windows");
  expect(rt.agent.moduleName).toBe("agent");
  expect(rt.declaredCapabilities.capabilities.observe).toBe(true);
  expect(rt.collector.tenantId).toBe(rt.identity.tenantId);
  expect(rt.policyCache.tenantId).toBe(rt.identity.tenantId);
});

// ---------------------------------------------------------------------------
// Check-in command composition
// ---------------------------------------------------------------------------

test("runtime: composeCheckInCommand produces a valid command envelope", () => {
  const rt = makeRuntime("checkin");
  const result = rt.composeCheckInCommand({
    id: makeCommandEnvelope({ seed: "rt-checkin" }).id,
    idempotencyKey: makeIdempotencyKey("rt-checkin-key"),
    correlationId: makeCorrelationId("rt-checkin-cor"),
    issuedAt: makeTimestamp("rt-checkin-issued"),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(validateCommand(result.command).ok).toBe(true);
  expect(result.command.type).toBe("agent.command.check-in");
  expect(result.command.tenantId).toBe(rt.identity.tenantId);
});

// ---------------------------------------------------------------------------
// Capability negotiation delegation
// ---------------------------------------------------------------------------

test("runtime: negotiateCapability delegates to device-adapters (refuses unsupported destructive)", () => {
  const rt = makeRuntime("negotiate", makeAdapterCapabilities({ supported: ["observe"] }));
  // Supported non-destructive: ok.
  const ok = rt.negotiateCapability({
    tenantId: rt.identity.tenantId,
    capability: "observe",
    policyGrant: false,
    policyCacheReady: false,
    correlationId: makeCorrelationId("rt-negotiate-ok"),
  });
  expect(ok.ok).toBe(true);

  // Unsupported destructive: refused (AdapterError).
  const refused = rt.negotiateCapability({
    tenantId: rt.identity.tenantId,
    capability: "wipe",
    policyGrant: true,
    policyCacheReady: true,
    correlationId: makeCorrelationId("rt-negotiate-refused"),
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.reason).toBe("unsupported");
  }
});

// ---------------------------------------------------------------------------
// Consequential authorization delegation (default-deny when empty)
// ---------------------------------------------------------------------------

test("runtime: authorizeConsequential default-denies when the policy cache is empty", () => {
  const rt = makeRuntime("authz-empty");
  const result = rt.authorizeConsequential(makeTimestamp("rt-authz-empty-at"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("empty");
  }
});

test("runtime: authorizeConsequential allows when the cache is fresh", async () => {
  const rt = makeRuntime("authz-fresh");
  // Store a policy document first.
  await rt.policyCache.put(
    {
      policyId: makeIdempotencyKey("rt-policy") as never, // any string-typed PolicyId-shaped value works for the test
      version: 1,
      signedAt: makeTimestamp("rt-policy-signed"),
      payload: { rules: [] },
      signature: "sig",
      signatureAlgorithm: "ed25519",
    },
    "2026-01-01T00:00:00Z",
  );
  const result = rt.authorizeConsequential("2026-01-01T00:00:30Z");
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Command acknowledgment delegation (idempotent)
// ---------------------------------------------------------------------------

test("runtime: acknowledgeCommand is idempotent (delegates to CommandReceiptTracker)", () => {
  const rt = makeRuntime("ack");
  const command = makeCommandEnvelope({
    seed: "rt-ack",
    tenantId: rt.identity.tenantId,
    type: "device.command.lock",
  });
  const first = rt.acknowledgeCommand(command, makeTimestamp("rt-ack-first"));
  const replay = rt.acknowledgeCommand(command, makeTimestamp("rt-ack-retry"));
  expect(first.ok).toBe(true);
  expect(replay.ok).toBe(true);
  if (!first.ok || !replay.ok) return;
  expect(replay.replayed).toBe(true);
});

// ---------------------------------------------------------------------------
// Observation flush delegation
// ---------------------------------------------------------------------------

test("runtime: flushObservations delegates to the collector and produces a valid batch", () => {
  const rt = makeRuntime("flush");
  rt.collector.record({
    kind: "device.health",
    observedAt: makeTimestamp("rt-flush-obs"),
    schemaVersion: 1,
    payload: { ok: true },
  });
  const result = rt.flushObservations(makeTimestamp("rt-flush-at"));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(validateObservationBatch(result.batch).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Batch idempotency-key derivation
// ---------------------------------------------------------------------------

test("runtime: deriveBatchIdempotencyKey is deterministic (delegates to device-adapters)", () => {
  const rt = makeRuntime("idem");
  rt.collector.record({
    kind: "device.health",
    observedAt: makeTimestamp("rt-idem-obs"),
    schemaVersion: 1,
    payload: { v: 1 },
  });
  const flush = rt.flushObservations(makeTimestamp("rt-idem-flush"));
  if (!flush.ok) throw new Error("flush failed");
  const k1 = rt.deriveBatchIdempotencyKey(flush.batch);
  const k2 = rt.deriveBatchIdempotencyKey(flush.batch);
  expect(k1 as string).toBe(k2 as string);
});

// ---------------------------------------------------------------------------
// MODULE_NAME / MODULE_VERSION exports
// ---------------------------------------------------------------------------

test("runtime: the agent package exports MODULE_NAME and MODULE_VERSION (skeleton check)", async () => {
  const mod = await import("../src/index");
  expect(mod.MODULE_NAME).toBe("agent");
  expect(mod.MODULE_VERSION).toBe("0.1.0");
});

// ---------------------------------------------------------------------------
// Tenant isolation (the runtime is tenant-scoped at construction)
// ---------------------------------------------------------------------------

test("runtime: the runtime is tenant-scoped — its identity, collector, and policyCache share one tenantId", () => {
  const rt = makeRuntime("iso");
  const t = rt.identity.tenantId;
  expect(rt.collector.tenantId).toBe(t);
  expect(rt.policyCache.tenantId).toBe(t);
  expect(rt.declaredCapabilities.tenantId).toBe(t);
});
