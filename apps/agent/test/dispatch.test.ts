/**
 * W020 D4 tests — the AgentRuntime composition of the endpoint adapter
 * SDK (apps/agent). The runtime owns an AdapterRegistry, registers
 * adapters at construction, and exposes `dispatchCommand` with the
 * runtime-injected defaults:
 *
 *   - target device = the runtime's identity device,
 *   - policy-cache readiness = derived from the runtime's own local
 *     signed-policy cache at `executedAt` (fresh + signature-verified =>
 *     ready; anything else => destructive default-deny),
 *   - policy grant = false unless the caller passes one (fail-closed).
 */

import { describe, expect, test } from "bun:test";
import { makeCommand, type AdapterCapabilities, type CommandEnvelope } from "@fleetos/contracts";
import {
  makeTenantId,
  makeDeviceId,
  makeCorrelationId,
  makeTimestamp,
  makeCommandId,
  makeIdempotencyKey,
  makeAdapterCapabilities,
  makePolicyId,
} from "@fleetos/contracts/testing";
import {
  ACCEPT_ALL_VERIFIER,
  createEndpointAdapter,
  createInMemoryWindowsSeam,
  createSignedPolicyDocument,
  type AgentIdentity,
  type AgentVersionInfo,
} from "@fleetos/device-adapters";
import type { InMemoryWindowsSeam } from "@fleetos/device-adapters";
import type { EndpointAdapter } from "@fleetos/device-adapters";
import { createAgentRuntime, type AgentRuntime, type AgentDispatchCommandInputs } from "../src/runtime";

const TENANT = makeTenantId("w020-runtime-tenant");
const DEVICE = makeDeviceId("w020-runtime-device");
const CORRELATION = makeCorrelationId("w020-runtime-cor");
const RECEIVED_AT = makeTimestamp("w020-runtime-received");
const EXECUTED_AT = makeTimestamp("w020-runtime-executed");
const COMPLETED_AT = makeTimestamp("w020-runtime-completed");

const IDENTITY: AgentIdentity = {
  tenantId: TENANT,
  deviceId: DEVICE,
  adapterFamily: "windows",
};

const AGENT: AgentVersionInfo = {
  moduleName: "agent",
  moduleVersion: "0.1.0",
  protocolVersion: 1,
};

function makeRuntimeWithAdapter(
  capabilities: readonly (keyof AdapterCapabilities)[],
  policyStaleness?: { maxAgeMs: number; mustRefetchMs: number | null },
): { runtime: AgentRuntime; seam: InMemoryWindowsSeam } {
  const seam = createInMemoryWindowsSeam();
  const adapter = createEndpointAdapter({
    descriptor: { adapterId: "adp_w020_runtime", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
    seams: seam,
    capabilities: makeAdapterCapabilities({ supported: capabilities }),
    declaredAt: makeTimestamp("w020-runtime-declared"),
  });
  const runtime = createAgentRuntime({
    identity: IDENTITY,
    agent: AGENT,
    capabilities: { observe: true, health: true },
    policyVerifier: ACCEPT_ALL_VERIFIER,
    policyStaleness,
    adapters: [adapter],
  });
  return { runtime, seam };
}

function lockCommand(): CommandEnvelope<unknown> {
  return makeCommand<unknown>({
    id: makeCommandId("w020-runtime-lock"),
    idempotencyKey: makeIdempotencyKey("w020-runtime-lock"),
    issuedAt: RECEIVED_AT,
    tenantId: TENANT,
    correlationId: CORRELATION,
    type: "device.command.lock",
    payload: { reason: "runtime test" },
  });
}

function dispatchInputs(overrides: Partial<AgentDispatchCommandInputs> = {}): AgentDispatchCommandInputs {
  return {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

describe("W020 D4: AgentRuntime adapter registry composition", () => {
  test("the runtime owns an adapter registry; construction-time adapters are registered", () => {
    const { runtime } = makeRuntimeWithAdapter(["lock"]);
    expect(runtime.adapterRegistry.list(TENANT)).toHaveLength(1);
    expect(runtime.adapterRegistry.forDevice(TENANT, DEVICE)?.descriptor.adapterId).toBe("adp_w020_runtime");
  });

  test("adapters can be registered after construction through the registry handle", () => {
    const runtime = createAgentRuntime({
      identity: IDENTITY,
      agent: AGENT,
      capabilities: {},
      policyVerifier: ACCEPT_ALL_VERIFIER,
    });
    expect(runtime.adapterRegistry.list(TENANT)).toHaveLength(0);
    const seam = createInMemoryWindowsSeam();
    const adapter = createEndpointAdapter({
      descriptor: { adapterId: "adp_late", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
      seams: seam,
      capabilities: makeAdapterCapabilities({ supported: ["health"] }),
      declaredAt: makeTimestamp("w020-runtime-late"),
    });
    expect(runtime.adapterRegistry.register(adapter).ok).toBe(true);
  });

  test("a structurally invalid construction-time adapter throws", () => {
    const broken = {
      descriptor: { adapterId: "", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
      capabilities: { supported: [], unsupported: [] },
      invoke: () => ({ ok: true }),
    };
    expect(() =>
      createAgentRuntime({
        identity: IDENTITY,
        agent: AGENT,
        capabilities: {},
        policyVerifier: ACCEPT_ALL_VERIFIER,
        adapters: [broken as unknown as EndpointAdapter],
      }),
    ).toThrow(/failed registry validation/);
  });
});

describe("W020 D4: runtime dispatchCommand", () => {
  test("a granted lock command dispatches end-to-end with the runtime's identity as target", () => {
    const { runtime, seam } = makeRuntimeWithAdapter(["lock"]);
    const outcome = runtime.dispatchCommand(lockCommand(), dispatchInputs({ policyGrant: true, policyCacheReady: true }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("succeeded");
    expect(seam.calls().filter((call) => call.method === "execute").length).toBe(1);
  });

  test("the deviceId default is the runtime's identity device (no explicit target needed)", () => {
    const { runtime, seam } = makeRuntimeWithAdapter(["health"]);
    const outcome = runtime.dispatchCommand(
      makeCommand<unknown>({
        id: makeCommandId("w020-runtime-health"),
        idempotencyKey: makeIdempotencyKey("w020-runtime-health"),
        issuedAt: RECEIVED_AT,
        tenantId: TENANT,
        correlationId: CORRELATION,
        type: "device.command.health",
        payload: {},
      }),
      dispatchInputs(),
    );
    expect(outcome.ok).toBe(true);
    expect(seam.calls().length).toBe(2);
  });

  test("policy grant defaults to false (fail-closed): destructive commands are refused", () => {
    const { runtime, seam } = makeRuntimeWithAdapter(["wipe"]);
    const outcome = runtime.dispatchCommand(
      makeCommand<unknown>({
        id: makeCommandId("w020-runtime-wipe"),
        idempotencyKey: makeIdempotencyKey("w020-runtime-wipe"),
        issuedAt: RECEIVED_AT,
        tenantId: TENANT,
        correlationId: CORRELATION,
        type: "device.command.wipe",
        payload: {},
      }),
      dispatchInputs({ policyCacheReady: true }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect((outcome.error as { decision: string }).decision).toBe("REQUIRE_APPROVAL");
    expect(seam.calls().length).toBe(0);
  });

  test("policy-cache readiness is derived from the runtime's own cache: an empty cache default-denies even WITH a grant", () => {
    const { runtime, seam } = makeRuntimeWithAdapter(["wipe"]);
    const cmd = makeCommand<unknown>({
      id: makeCommandId("w020-runtime-deny"),
      idempotencyKey: makeIdempotencyKey("w020-runtime-deny"),
      issuedAt: RECEIVED_AT,
      tenantId: TENANT,
      correlationId: CORRELATION,
      type: "device.command.wipe",
      payload: {},
    });
    const outcome = runtime.dispatchCommand(cmd, dispatchInputs({ policyGrant: true }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect((outcome.error as { decision: string }).decision).toBe("BLOCK");
    expect(seam.calls().length).toBe(0);
  });

  test("a fresh signed policy document flips the derived cache signal and unlocks the granted wipe", async () => {
    // Tiny staleness window so the injected timestamps produce freshness.
    const { runtime, seam } = makeRuntimeWithAdapter(["wipe"], { maxAgeMs: 60_000 * 60, mustRefetchMs: null });
    const doc = createSignedPolicyDocument({
      policyId: makePolicyId("w020-runtime-policy"),
      version: 1,
      signedAt: EXECUTED_AT,
      payload: { rules: [] },
      signature: "sig",
      signatureAlgorithm: "ed25519",
    });
    const put = await runtime.policyCache.put(doc, EXECUTED_AT);
    expect(put.ok).toBe(true);
    const wipe = makeCommand<unknown>({
      id: makeCommandId("w020-runtime-wipe-2"),
      idempotencyKey: makeIdempotencyKey("w020-runtime-wipe-2"),
      issuedAt: RECEIVED_AT,
      tenantId: TENANT,
      correlationId: CORRELATION,
      type: "device.command.wipe",
      payload: {},
    });
    const outcome = runtime.dispatchCommand(wipe, dispatchInputs({ policyGrant: true }));
    expect(outcome.ok).toBe(true);
    expect(seam.calls().filter((call) => call.method === "execute").length).toBe(1);
  });

  test("redelivery through the runtime replays the original result and never re-executes", () => {
    const { runtime, seam } = makeRuntimeWithAdapter(["lock"]);
    const cmd = lockCommand();
    const first = runtime.dispatchCommand(cmd, dispatchInputs({ policyGrant: true, policyCacheReady: true }));
    expect(first.ok).toBe(true);
    const second = runtime.dispatchCommand(cmd, dispatchInputs({ policyGrant: true, policyCacheReady: true }));
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.result).toBe(first.result);
    expect(seam.calls().filter((call) => call.method === "execute").length).toBe(1);
  });

  test("the runtime's receipt tracker is the dispatcher's tracker (acknowledge + dispatch share idempotency state)", () => {
    const { runtime } = makeRuntimeWithAdapter(["lock"]);
    const cmd = lockCommand();
    // Pre-acknowledge through the W010 operation surface.
    const ack = runtime.acknowledgeCommand(cmd, RECEIVED_AT);
    expect(ack.ok).toBe(true);
    // Dispatch completes the same tracked entry (the receipt is replayed,
    // the result is recorded, never re-admitted).
    const outcome = runtime.dispatchCommand(cmd, dispatchInputs({ policyGrant: true, policyCacheReady: true }));
    if (!outcome.ok) {
      // The acknowledged-but-uncompleted entry is fail-safe: the command
      // is not re-executed through the dispatcher.
      expect(outcome.status).toBe("incomplete");
      expect(runtime.receipts.size()).toBe(1);
      return;
    }
    expect(outcome.replayed).toBe(true);
    expect(runtime.receipts.size()).toBe(1);
  });

  test("the W010 runtime surface is unaffected by the W020 composition (smoke)", () => {
    const { runtime } = makeRuntimeWithAdapter(["lock"]);
    expect(runtime.identity).toBe(IDENTITY);
    expect(runtime.collector.tenantId).toBe(TENANT);
    const negotiation = runtime.negotiateCapability({
      tenantId: TENANT,
      capability: "observe",
      policyGrant: false,
      policyCacheReady: false,
      correlationId: CORRELATION,
    });
    expect(negotiation.ok).toBe(true);
  });
});
