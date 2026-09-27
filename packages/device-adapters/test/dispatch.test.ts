/**
 * W020 D4 tests — capability-aware command dispatch.
 *
 * Verifies the full dispatch pipeline: envelope validation, command-type
 * -> capability mapping, adapter resolution (adapterId / device /
 * singleton fallback), capability negotiation refusal (born-rejected
 * receipts; the seam is never invoked), idempotent receipt (replays
 * return the ORIGINAL result and never re-execute; a different command
 * under the same key is a conflict), the status lifecycle transitions,
 * and the result envelope with FleetError mapping.
 */

import { describe, expect, test } from "bun:test";
import { makeCommand, type AdapterCapabilities, type CommandEnvelope } from "@fleetos/contracts";
import {
  makeTenantId,
  makeDeviceId,
  makeCorrelationId,
  makeTimestamp,
  makeIdempotencyKey,
  makeCommandId,
  makeAdapterCapabilities,
} from "@fleetos/contracts/testing";
import {
  createAdapterRegistry,
  createAdapterCommandDispatcher,
  createCommandReceiptTracker,
  createEndpointAdapter,
  capabilityForCommandType,
  commandTypeForCapability,
  CAPABILITY_COMMAND_TYPES,
  type AdapterCommandDispatcher,
  type AdapterDispatchInputs,
  type AdapterDispatchOutcome,
  type EndpointAdapter,
  type EndpointAdapterDescriptor,
} from "../src";
import { createInMemoryWindowsSeam, createInMemoryLinuxSeam } from "../src/seams-inmemory";
import type { InMemoryWindowsSeam } from "../src/seams-inmemory";
import { ERROR_CODES } from "../src/internal";

const TENANT = makeTenantId("w020-dispatch-tenant");
const TENANT_B = makeTenantId("w020-dispatch-tenant-b");
const DEVICE = makeDeviceId("w020-dispatch-device");
const DEVICE_LINUX = makeDeviceId("w020-dispatch-device-linux");
const CORRELATION = makeCorrelationId("w020-dispatch-cor");
const RECEIVED_AT = makeTimestamp("w020-dispatch-received");
const EXECUTED_AT = makeTimestamp("w020-dispatch-executed");
const COMPLETED_AT = makeTimestamp("w020-dispatch-completed");
const DECLARED_AT = makeTimestamp("w020-dispatch-declared");

const ALL_CAPABILITIES = [
  "identify",
  "observe",
  "diagnose",
  "enforce",
  "remediate",
  "lock",
  "locate",
  "wipe",
  "reboot",
  "update",
  "health",
] as const;

function command(type: string, overrides: { idempotencyKey?: string; payload?: unknown; tenantId?: typeof TENANT } = {}): CommandEnvelope<unknown> {
  const seed = overrides.idempotencyKey ?? `w020-${type}`;
  return makeCommand<unknown>({
    id: makeCommandId(seed),
    idempotencyKey: makeIdempotencyKey(seed),
    issuedAt: RECEIVED_AT,
    tenantId: overrides.tenantId ?? TENANT,
    correlationId: CORRELATION,
    type,
    payload: overrides.payload ?? {},
  });
}

function inputs(overrides: Partial<AdapterDispatchInputs> = {}): AdapterDispatchInputs {
  return {
    receivedAt: RECEIVED_AT,
    executedAt: EXECUTED_AT,
    completedAt: COMPLETED_AT,
    deviceId: DEVICE,
    policyGrant: true,
    policyCacheReady: true,
    ...overrides,
  };
}

/** The terminal arms of the dispatch outcome (receipt + result present). */
type TerminalDispatchOutcome = Extract<
  AdapterDispatchOutcome,
  { status: "succeeded" | "rejected" | "failed" }
>;

/** Narrow a dispatch outcome to its terminal arms (fails the test otherwise). */
function terminal(outcome: AdapterDispatchOutcome): TerminalDispatchOutcome {
  if (outcome.status === "malformed" || outcome.status === "conflict" || outcome.status === "incomplete") {
    throw new Error(`expected a terminal dispatch outcome, got "${outcome.status}" (${outcome.error.message})`);
  }
  return outcome as TerminalDispatchOutcome;
}

interface Harness {
  readonly dispatcher: AdapterCommandDispatcher;
  readonly registry: ReturnType<typeof createAdapterRegistry>;
  readonly tracker: ReturnType<typeof createCommandReceiptTracker>;
  readonly adapter: EndpointAdapter;
  readonly seam: InMemoryWindowsSeam;
}

function harness(
  supported: readonly (keyof AdapterCapabilities)[] = ALL_CAPABILITIES,
  seamOptions: Parameters<typeof createInMemoryWindowsSeam>[0] = {},
): Harness {
  const registry = createAdapterRegistry();
  const tracker = createCommandReceiptTracker();
  const seam = createInMemoryWindowsSeam(seamOptions);
  const descriptor: EndpointAdapterDescriptor = {
    adapterId: "adp_w020_dispatch",
    platform: "windows",
    tenantId: TENANT,
    deviceId: DEVICE,
    adapterVersion: "0.1.0",
  };
  const adapter = createEndpointAdapter({
    descriptor,
    seams: seam,
    capabilities: makeAdapterCapabilities({ supported }),
    declaredAt: DECLARED_AT,
  });
  registry.register(adapter);
  const dispatcher = createAdapterCommandDispatcher({ registry, tracker });
  return { dispatcher, registry, tracker, adapter, seam };
}

// ---------------------------------------------------------------------------
// Command-type mapping
// ---------------------------------------------------------------------------

describe("W020 D4: command type <-> capability mapping", () => {
  test("every normalized capability has a device.command.<capability> type (round trip)", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(commandTypeForCapability(capability)).toBe(`device.command.${capability}`);
      expect(capabilityForCommandType(`device.command.${capability}`)).toBe(capability);
    }
    expect(Object.keys(CAPABILITY_COMMAND_TYPES).length).toBe(11);
  });

  test("unknown command types map to undefined", () => {
    expect(capabilityForCommandType("device.command.detonate")).toBeUndefined();
    expect(capabilityForCommandType("procurement.command.quote")).toBeUndefined();
    expect(capabilityForCommandType("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Happy path + idempotency
// ---------------------------------------------------------------------------

describe("W020 D4: dispatch happy path", () => {
  test("a granted destructive command executes and records the full lifecycle", () => {
    const h = harness(["lock"]);
    const cmd = command("device.command.lock");
    const outcome = h.dispatcher.dispatch(cmd, inputs());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("succeeded");
    expect(outcome.replayed).toBe(false);
    // The receipt reached the terminal status via accepted -> executing -> succeeded.
    expect(outcome.receipt.status).toBe("succeeded");
    expect(outcome.receipt.commandId).toBe(cmd.id);
    expect(outcome.receipt.idempotencyKey).toBe(cmd.idempotencyKey);
    expect(outcome.receipt.receivedAt).toBe(RECEIVED_AT);
    // The result envelope carries the terminal status + evidence.
    expect(outcome.result.status).toBe("succeeded");
    expect(outcome.result.commandId).toBe(cmd.id);
    expect(outcome.result.tenantId).toBe(TENANT);
    expect(outcome.result.correlationId).toBe(CORRELATION);
    expect(outcome.result.completedAt).toBe(COMPLETED_AT);
    expect(outcome.result.evidence.length).toBe(1);
    // The seam executed exactly once.
    const executeCalls = h.seam.calls().filter((call) => call.method === "execute");
    expect(executeCalls.length).toBe(1);
    expect((executeCalls[0].detail as { capability: string }).capability).toBe("lock");
  });

  test("a non-destructive command executes without a grant", () => {
    const h = harness(["health"]);
    const outcome = h.dispatcher.dispatch(command("device.command.health"), inputs({ policyGrant: false, policyCacheReady: false }));
    expect(outcome.ok).toBe(true);
  });

  test("the observe command routes to the observe operation and emits evidence", () => {
    const h = harness(["observe"], { primaryObservations: [{ kind: "device.health", observedAt: EXECUTED_AT, schemaVersion: 1, payload: { v: 1 } }] });
    const outcome = h.dispatcher.dispatch(command("device.command.observe"), inputs());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.evidence.length).toBe(1);
    expect(outcome.result.evidence[0].key).toContain("observations://");
  });
});

describe("W020 D4: idempotent receipt (duplicate suppression)", () => {
  test("a redelivery replays the ORIGINAL result and never re-executes", () => {
    const h = harness(["lock"]);
    const cmd = command("device.command.lock");
    const first = h.dispatcher.dispatch(cmd, inputs());
    expect(first.ok).toBe(true);
    const executeCallsAfterFirst = h.seam.calls().filter((c) => c.method === "execute").length;
    const second = h.dispatcher.dispatch(cmd, inputs({ receivedAt: makeTimestamp("w020-replay") }));
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.replayed).toBe(true);
    // The ORIGINAL result is returned (referential equality).
    expect(second.result).toBe(first.result);
    // The seam executed exactly once across both deliveries.
    expect(h.seam.calls().filter((c) => c.method === "execute").length).toBe(executeCallsAfterFirst);
    // The tracker holds one entry.
    expect(h.tracker.size()).toBe(1);
  });

  test("a refused command replays its ORIGINAL rejection even after the refusal cause is fixed", () => {
    const h = harness(["wipe"]);
    const cmd = command("device.command.wipe");
    // First delivery: no grant -> born-rejected.
    const first = terminal(h.dispatcher.dispatch(cmd, inputs({ policyGrant: false })));
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.status).toBe("rejected");
    // Second delivery: grant now present — but idempotency wins: the
    // command was already processed to a terminal state and is NEVER
    // re-executed.
    const second = terminal(h.dispatcher.dispatch(cmd, inputs({ policyGrant: true })));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.status).toBe("rejected");
    expect(second.result).toBe(first.result);
    // The seam was never invoked at any point.
    expect(h.seam.calls().length).toBe(0);
  });

  test("the same idempotency key with a DIFFERENT command is a conflict", () => {
    const h = harness(["lock", "wipe"]);
    const key = makeIdempotencyKey("w020-conflict-key");
    const first = h.dispatcher.dispatch(command("device.command.lock", { idempotencyKey: key as string }), inputs());
    expect(first.ok).toBe(true);
    const second = h.dispatcher.dispatch(
      command("device.command.wipe", { idempotencyKey: key as string, payload: { different: true } }),
      inputs(),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe("conflict");
    expect(second.error.kind).toBe("ConflictError");
    expect(second.error.code).toBe(ERROR_CODES.commandIdempotencyConflict);
  });
});

// ---------------------------------------------------------------------------
// Refusals (born-rejected receipts; the seam is never invoked)
// ---------------------------------------------------------------------------

describe("W020 D4: dispatch refusals", () => {
  test("an unsupported capability command is born-rejected and never reaches the seam", () => {
    const h = harness(["lock"]); // wipe NOT declared
    const outcome = terminal(h.dispatcher.dispatch(command("device.command.wipe"), inputs()));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.receipt.status).toBe("rejected");
    expect(outcome.result.status).toBe("rejected");
    expect(outcome.error.kind).toBe("AdapterError");
    expect(outcome.error.code).toBe(ERROR_CODES.capabilityUnsupported);
    expect(h.seam.calls().length).toBe(0);
  });

  test("a destructive command without a grant is born-rejected (REQUIRE_APPROVAL)", () => {
    const h = harness(["wipe"]);
    const outcome = h.dispatcher.dispatch(command("device.command.wipe"), inputs({ policyGrant: false }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("PolicyError");
    expect(outcome.error.code).toBe(ERROR_CODES.capabilityDestructiveUnauthorized);
    expect((outcome.error as { decision: string }).decision).toBe("REQUIRE_APPROVAL");
    expect(h.seam.calls().length).toBe(0);
  });

  test("a destructive command with a grant but a stale policy cache is default-denied (BLOCK)", () => {
    const h = harness(["wipe"]);
    const outcome = h.dispatcher.dispatch(command("device.command.wipe"), inputs({ policyGrant: true, policyCacheReady: false }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("PolicyError");
    expect(outcome.error.code).toBe(ERROR_CODES.capabilityDestructiveOfflineDefaultDeny);
    expect((outcome.error as { decision: string }).decision).toBe("BLOCK");
    expect(h.seam.calls().length).toBe(0);
  });

  test("an unknown command type is born-rejected as unroutable", () => {
    const h = harness();
    const outcome = h.dispatcher.dispatch(command("fleet.command.detonate"), inputs());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("AdapterError");
    expect(outcome.error.code).toBe(ERROR_CODES.adapterUnknownCommandType);
    expect(h.seam.calls().length).toBe(0);
  });

  test("a command for an unknown device is rejected (adapter not found)", () => {
    const h = harness(["lock"]);
    const unknownDevice = makeDeviceId("w020-unknown-device");
    const outcome = h.dispatcher.dispatch(command("device.command.lock"), inputs({ deviceId: unknownDevice }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("AdapterError");
    expect(outcome.error.code).toBe(ERROR_CODES.adapterNotFound);
    expect(h.seam.calls().length).toBe(0);
  });

  test("an explicit unknown adapterId is rejected (adapter not found)", () => {
    const h = harness(["lock"]);
    const outcome = h.dispatcher.dispatch(command("device.command.lock"), inputs({ adapterId: "adp_missing" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe(ERROR_CODES.adapterNotFound);
  });

  test("an explicit adapterId takes precedence over deviceId", () => {
    const registry = createAdapterRegistry();
    const tracker = createCommandReceiptTracker();
    const seamA = createInMemoryWindowsSeam();
    const adapterA = createEndpointAdapter({
      descriptor: { adapterId: "adp_a", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
      seams: seamA,
      capabilities: makeAdapterCapabilities({ supported: ["lock"] }),
      declaredAt: DECLARED_AT,
    });
    const seamB = createInMemoryWindowsSeam();
    const adapterB = createEndpointAdapter({
      descriptor: { adapterId: "adp_b", platform: "windows", tenantId: TENANT, deviceId: DEVICE_LINUX, adapterVersion: "0.1.0" },
      seams: seamB,
      capabilities: makeAdapterCapabilities({ supported: ["lock"] }),
      declaredAt: DECLARED_AT,
    });
    registry.register(adapterA);
    registry.register(adapterB);
    const dispatcher = createAdapterCommandDispatcher({ registry, tracker });
    const outcome = dispatcher.dispatch(command("device.command.lock"), inputs({ adapterId: "adp_b", deviceId: DEVICE }));
    expect(outcome.ok).toBe(true);
    expect(seamB.calls().length).toBe(2);
    expect(seamA.calls().length).toBe(0);
  });

  test("a tenant-B command cannot reach a tenant-A adapter (registry-scoped routing)", () => {
    const h = harness(["lock"]);
    const outcome = h.dispatcher.dispatch(
      command("device.command.lock", { tenantId: TENANT_B }),
      inputs({ deviceId: DEVICE }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.code).toBe(ERROR_CODES.adapterNotFound);
    expect(h.seam.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Adapter resolution fallbacks
// ---------------------------------------------------------------------------

describe("W020 D4: adapter resolution fallbacks", () => {
  test("with no target and exactly one registered adapter, the singleton is used", () => {
    const h = harness(["lock"]);
    const outcome = h.dispatcher.dispatch(command("device.command.lock"), inputs({ deviceId: undefined }));
    expect(outcome.ok).toBe(true);
  });

  test("with no target and multiple adapters, the dispatch is rejected as unresolved", () => {
    const registry = createAdapterRegistry();
    const tracker = createCommandReceiptTracker();
    for (const [id, device] of [
      ["adp_1", DEVICE],
      ["adp_2", DEVICE_LINUX],
    ] as const) {
      registry.register(
        createEndpointAdapter({
          descriptor: { adapterId: id, platform: "windows", tenantId: TENANT, deviceId: device, adapterVersion: "0.1.0" },
          seams: createInMemoryWindowsSeam(),
          capabilities: makeAdapterCapabilities({ supported: ["lock"] }),
          declaredAt: DECLARED_AT,
        }),
      );
    }
    const dispatcher = createAdapterCommandDispatcher({ registry, tracker });
    const outcome = dispatcher.dispatch(command("device.command.lock"), inputs({ deviceId: undefined }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("ValidationError");
    expect(outcome.error.code).toBe(ERROR_CODES.dispatchTargetUnresolved);
  });

  test("with no adapters at all, the dispatch is rejected as unresolved", () => {
    const dispatcher = createAdapterCommandDispatcher({
      registry: createAdapterRegistry(),
      tracker: createCommandReceiptTracker(),
    });
    const outcome = dispatcher.dispatch(command("device.command.lock"), inputs({ deviceId: undefined }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe(ERROR_CODES.dispatchTargetUnresolved);
  });

  test("a linux device routes to the linux adapter through the registry", () => {
    const registry = createAdapterRegistry();
    const tracker = createCommandReceiptTracker();
    const seam = createInMemoryLinuxSeam();
    registry.register(
      createEndpointAdapter({
        descriptor: { adapterId: "adp_linux", platform: "linux", tenantId: TENANT, deviceId: DEVICE_LINUX, adapterVersion: "0.1.0" },
        seams: seam,
        capabilities: makeAdapterCapabilities({ supported: ["reboot"] }),
        declaredAt: DECLARED_AT,
      }),
    );
    const dispatcher = createAdapterCommandDispatcher({ registry, tracker });
    const outcome = dispatcher.dispatch(command("device.command.reboot"), inputs({ deviceId: DEVICE_LINUX }));
    expect(outcome.ok).toBe(true);
    expect(seam.calls().map((c) => c.method)).toEqual(["execute", "runShell"]);
  });
});

// ---------------------------------------------------------------------------
// Malformed inputs
// ---------------------------------------------------------------------------

describe("W020 D4: malformed dispatch inputs", () => {
  test("an invalid envelope is refused before admission (no receipt)", () => {
    const h = harness(["lock"]);
    const broken = { ...command("device.command.lock"), idempotencyKey: "" } as unknown as CommandEnvelope<unknown>;
    const outcome = h.dispatcher.dispatch(broken, inputs());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("malformed");
    expect(outcome.error.kind).toBe("ValidationError");
    expect(outcome.receipt).toBeUndefined();
    expect(h.tracker.size()).toBe(0);
  });

  test("non-ISO timestamps are refused for each of the three inputs", () => {
    const h = harness(["lock"]);
    for (const field of ["receivedAt", "executedAt", "completedAt"] as const) {
      const outcome = h.dispatcher.dispatch(command("device.command.lock"), inputs({ [field]: "not-iso" }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe("malformed");
      expect((outcome.error as unknown as { failures: readonly { path: string }[] }).failures[0].path).toBe(`/${field}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Execution failures
// ---------------------------------------------------------------------------

describe("W020 D4: execution failures map into the result envelope", () => {
  test("a seam failure produces a failed result with the FleetError", () => {
    const h = harness(
      ["wipe"],
      { commandOutcomes: [{ capability: "wipe", status: "failed", failureKind: "timeout", message: "wipe timed out" }] },
    );
    const outcome = terminal(h.dispatcher.dispatch(command("device.command.wipe"), inputs()));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("failed");
    expect(outcome.receipt.status).toBe("failed");
    expect(outcome.result.status).toBe("failed");
    expect(outcome.error.kind).toBe("DomainError");
    expect(outcome.result.error?.kind).toBe("DomainError");
    expect(outcome.result.evidence.length).toBe(1);
    // The failure result is itself idempotent: a replay returns it verbatim.
    const replay = terminal(h.dispatcher.dispatch(command("device.command.wipe"), inputs()));
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.result).toBe(outcome.result);
  });

  test("every capability command type dispatches to its capability (exhaustive)", () => {
    const h = harness(ALL_CAPABILITIES);
    for (const capability of ALL_CAPABILITIES) {
      const outcome = h.dispatcher.dispatch(command(`device.command.${capability}`), inputs());
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.status).toBe("succeeded");
    }
    const executeCalls = h.seam.calls().filter((c) => c.method === "execute");
    // observe never executes a platform command; the other 10 do.
    expect(executeCalls.length).toBe(10);
    const routed = executeCalls.map((c) => (c.detail as { capability: string }).capability);
    for (const capability of ALL_CAPABILITIES) {
      if (capability === "observe") continue;
      expect(routed).toContain(capability);
    }
  });
});
