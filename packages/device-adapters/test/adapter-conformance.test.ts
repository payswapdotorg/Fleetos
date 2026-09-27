/**
 * W020 contract-conformance tests — the endpoint adapter SDK built
 * AGAINST the frozen @fleetos/contracts surface, verified with the W003
 * fixture builders from @fleetos/contracts/testing.
 *
 * Fixture builders consumed here (and across the other W020 test files):
 *   makeTenantId, makeDeviceId, makeCorrelationId, makeTimestamp,
 *   makeIdempotencyKey, makeCommandId, makeCommandEnvelope,
 *   makeAdapterCapabilities, makeObservationBatch, makeFleetError
 * plus the frozen validators and helpers (validateCommand,
 * validateObservationBatch, assertSupported, isSupported, isDestructive,
 * toApiError) and the FIXTURE_TIME_ANCHOR.
 */

import { describe, expect, test } from "bun:test";
import {
  assertSupported,
  isDestructive,
  isSupported,
  toApiError,
  validateCommand,
  validateObservationBatch,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeAdapterCapabilities,
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeFleetError,
  makeIdempotencyKey,
  makeObservationBatch,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  createAdapterRegistry,
  createAdapterCommandDispatcher,
  createCommandReceiptTracker,
  createEndpointAdapter,
  type AdapterCommandContext,
  type EndpointAdapterDescriptor,
} from "../src";
import { createInMemoryWindowsSeam } from "../src/seams-inmemory";
import { ERROR_CODES } from "../src/internal";

const TENANT = makeTenantId("w020-conf-tenant");
const DEVICE = makeDeviceId("w020-conf-device");
const DECLARED_AT = makeTimestamp("w020-conf-declared");

function conformanceHarness(
  supported: readonly string[],
): ReturnType<typeof createAdapterCommandDispatcher> {
  const registry = createAdapterRegistry();
  const tracker = createCommandReceiptTracker();
  const descriptor: EndpointAdapterDescriptor = {
    adapterId: "adp_w020_conf",
    platform: "windows",
    tenantId: TENANT,
    deviceId: DEVICE,
    adapterVersion: "0.1.0",
  };
  const adapter = createEndpointAdapter({
    descriptor,
    seams: createInMemoryWindowsSeam(),
    capabilities: makeAdapterCapabilities({ supported: supported as never }),
    declaredAt: DECLARED_AT,
  });
  registry.register(adapter);
  return createAdapterCommandDispatcher({ registry, tracker });
}

describe("W020 conformance: command envelope fixtures drive dispatch", () => {
  test("makeCommandEnvelope produces a dispatchable lock command (the frozen default type)", () => {
    const dispatcher = conformanceHarness(["lock"]);
    const cmd = makeCommandEnvelope({
      seed: "w020-conf-lock",
      tenantId: TENANT,
      type: "device.command.lock",
      payload: { reason: "conformance" },
    });
    expect(validateCommand(cmd).ok).toBe(true);
    const outcome = dispatcher.dispatch(cmd, {
      receivedAt: makeTimestamp("w020-conf-received"),
      executedAt: makeTimestamp("w020-conf-executed"),
      completedAt: makeTimestamp("w020-conf-completed"),
      deviceId: DEVICE,
      policyGrant: true,
      policyCacheReady: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("succeeded");
    expect(outcome.result.commandId).toBe(cmd.id);
    expect(outcome.result.idempotencyKey).toBe(cmd.idempotencyKey);
  });

  test("makeCommandEnvelope's idempotency key drives duplicate suppression end-to-end", () => {
    const dispatcher = conformanceHarness(["lock"]);
    const cmd = makeCommandEnvelope({
      seed: "w020-conf-replay",
      tenantId: TENANT,
      type: "device.command.lock",
    });
    const inputs = {
      receivedAt: makeTimestamp("w020-conf-replay-in"),
      executedAt: makeTimestamp("w020-conf-replay-ex"),
      completedAt: makeTimestamp("w020-conf-replay-done"),
      deviceId: DEVICE,
      policyGrant: true,
      policyCacheReady: true,
    };
    const first = dispatcher.dispatch(cmd, inputs);
    const second = dispatcher.dispatch(cmd, inputs);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.result).toBe(first.result);
  });

  test("makeIdempotencyKey fixtures key independent commands", () => {
    const dispatcher = conformanceHarness(["lock"]);
    const base = {
      tenantId: TENANT,
      type: "device.command.lock" as const,
      issuedAt: FIXTURE_TIME_ANCHOR,
      correlationId: makeCorrelationId("w020-conf-keys"),
    };
    const a = dispatcher.dispatch(makeCommandEnvelope({ ...base, idempotencyKey: makeIdempotencyKey("k-a") }), { receivedAt: FIXTURE_TIME_ANCHOR, executedAt: FIXTURE_TIME_ANCHOR, completedAt: FIXTURE_TIME_ANCHOR, deviceId: DEVICE, policyGrant: true, policyCacheReady: true });
    const b = dispatcher.dispatch(makeCommandEnvelope({ ...base, idempotencyKey: makeIdempotencyKey("k-b") }), { receivedAt: FIXTURE_TIME_ANCHOR, executedAt: FIXTURE_TIME_ANCHOR, completedAt: FIXTURE_TIME_ANCHOR, deviceId: DEVICE, policyGrant: true, policyCacheReady: true });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("W020 conformance: capability fixtures drive the SDK refusal", () => {
  test("makeAdapterCapabilities populates the adapter's declared record (contracts reuse)", () => {
    const caps = makeAdapterCapabilities({ supported: ["observe", "wipe"], unsupported: ["locate"] });
    const adapter = createEndpointAdapter({
      descriptor: { adapterId: "adp_conf_caps", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
      seams: createInMemoryWindowsSeam(),
      capabilities: caps,
      declaredAt: DECLARED_AT,
    });
    expect(isSupported("observe", adapter.capabilities.capabilities)).toBe(true);
    expect(isSupported("wipe", adapter.capabilities.capabilities)).toBe(true);
    expect(isSupported("locate", adapter.capabilities.capabilities)).toBe(false);
    // The frozen helpers read the same record the SDK gates routing on.
    expect(adapter.capabilities.supported).toEqual(["observe", "wipe"]);
  });

  test("the SDK refusal matches the frozen assertSupported refusal (unsupported)", () => {
    const dispatcher = conformanceHarness(["lock"]);
    const cmd = makeCommandEnvelope({
      seed: "w020-conf-unsupported",
      tenantId: TENANT,
      type: "device.command.wipe",
    });
    const outcome = dispatcher.dispatch(cmd, {
      receivedAt: FIXTURE_TIME_ANCHOR,
      executedAt: FIXTURE_TIME_ANCHOR,
      completedAt: FIXTURE_TIME_ANCHOR,
      deviceId: DEVICE,
      policyGrant: true,
      policyCacheReady: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The frozen assertSupported agrees: wipe is not declared.
    const frozen = assertSupported("wipe", makeAdapterCapabilities({ supported: ["lock"] }), true);
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(frozen.reason).toBe("unsupported");
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("AdapterError");
  });

  test("the SDK refusal matches the frozen assertSupported refusal (destructive unauthorized)", () => {
    const dispatcher = conformanceHarness(["wipe"]);
    const cmd = makeCommandEnvelope({ seed: "w020-conf-unauth", tenantId: TENANT, type: "device.command.wipe" });
    const outcome = dispatcher.dispatch(cmd, {
      receivedAt: FIXTURE_TIME_ANCHOR,
      executedAt: FIXTURE_TIME_ANCHOR,
      completedAt: FIXTURE_TIME_ANCHOR,
      deviceId: DEVICE,
      policyGrant: false,
      policyCacheReady: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const frozen = assertSupported("wipe", makeAdapterCapabilities({ supported: ["wipe"] }), false);
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(frozen.reason).toBe("destructive_unauthorized");
    expect(outcome.error.kind).toBe("PolicyError");
  });

  test("isDestructive cross-check: the 7 destructive capabilities need grants in dispatch", () => {
    const destructive = ["enforce", "remediate", "lock", "locate", "wipe", "reboot", "update"] as const;
    expect(destructive.every((c) => isDestructive(c))).toBe(true);
    const dispatcher = conformanceHarness([...destructive]);
    for (const capability of destructive) {
      const cmd = makeCommandEnvelope({
        seed: `w020-conf-${capability}`,
        tenantId: TENANT,
        type: `device.command.${capability}`,
      });
      const withoutGrant = dispatcher.dispatch(cmd, {
        receivedAt: FIXTURE_TIME_ANCHOR,
        executedAt: FIXTURE_TIME_ANCHOR,
        completedAt: FIXTURE_TIME_ANCHOR,
        deviceId: DEVICE,
        policyGrant: false,
        policyCacheReady: true,
      });
      expect(withoutGrant.ok).toBe(false);
    }
  });
});

describe("W020 conformance: observation batch fixtures feed the observe pipeline", () => {
  test("makeObservationBatch observations flow through the seam into a valid emitted batch", () => {
    const fixtureBatch = makeObservationBatch({ seed: "w020-conf-batch", tenantId: TENANT, deviceId: DEVICE, count: 4 });
    // The seam sources observe the fixture batch's observations (records
    // without ids — the adapter's collector assigns them).
    const records = fixtureBatch.observations.map((observation) => ({
      kind: observation.kind,
      observedAt: observation.observedAt,
      schemaVersion: observation.schemaVersion,
      payload: observation.payload,
    }));
    const seam = createInMemoryWindowsSeam({ primaryObservations: records.slice(0, 2), secondaryObservations: records.slice(2) });
    const adapter = createEndpointAdapter({
      descriptor: { adapterId: "adp_conf_obs", platform: "windows", tenantId: TENANT, deviceId: DEVICE, adapterVersion: "0.1.0" },
      seams: seam,
      capabilities: makeAdapterCapabilities({ supported: ["observe"] }),
      declaredAt: DECLARED_AT,
    });
    const context: AdapterCommandContext = {
      tenantId: TENANT,
      correlationId: makeCorrelationId("w020-conf-obs"),
      executedAt: makeTimestamp("w020-conf-obs-exec"),
      policyGrant: false,
      policyCacheReady: false,
    };
    const outcome = adapter.invoke({ capability: "observe" }, context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.batch).toBeDefined();
    // The emitted batch satisfies the FROZEN validator (W003 guarantee
    // transferred: fixture observations in, valid batch out).
    expect(validateObservationBatch(outcome.batch!).ok).toBe(true);
    expect(outcome.batch!.observations).toHaveLength(4);
  });

  test("the SDK's error envelope is a first-class FleetError for the frozen translator", () => {
    const dispatcher = conformanceHarness(["lock"]);
    const cmd = makeCommandEnvelope({ seed: "w020-conf-api-error", tenantId: TENANT, type: "device.command.wipe" });
    const outcome = dispatcher.dispatch(cmd, {
      receivedAt: FIXTURE_TIME_ANCHOR,
      executedAt: FIXTURE_TIME_ANCHOR,
      completedAt: FIXTURE_TIME_ANCHOR,
      deviceId: DEVICE,
      policyGrant: true,
      policyCacheReady: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const api = toApiError(outcome.error);
    expect(api.status).toBe(502);
    expect(api.kind).toBe("AdapterError");
    expect(api.code).toBe(ERROR_CODES.capabilityUnsupported);
    expect(api.tenantId).toBe(TENANT);

    // A fixture error of the same kind round-trips identically — the
    // SDK's errors and the fixture errors are the same taxonomy.
    const fixture = makeFleetError({ seed: "w020-conf-same", kind: "AdapterError", tenantId: TENANT });
    expect(toApiError(fixture).status).toBe(api.status);
    expect(toApiError(fixture).kind).toBe(api.kind);
  });

  test("the SDK's destructive-refusal PolicyErrors translate through the frozen taxonomy", () => {
    const dispatcher = conformanceHarness(["wipe"]);
    const unauthorized = dispatcher.dispatch(
      makeCommandEnvelope({ seed: "w020-conf-403a", tenantId: TENANT, type: "device.command.wipe" }),
      { receivedAt: FIXTURE_TIME_ANCHOR, executedAt: FIXTURE_TIME_ANCHOR, completedAt: FIXTURE_TIME_ANCHOR, deviceId: DEVICE, policyGrant: false, policyCacheReady: true },
    );
    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) return;
    // The frozen translator maps REQUIRE_APPROVAL to 422 (not 403 — only
    // BLOCK is 403).
    expect(toApiError(unauthorized.error).status).toBe(422);
    expect((unauthorized.error as { decision: string }).decision).toBe("REQUIRE_APPROVAL");

    const offlineDeny = dispatcher.dispatch(
      makeCommandEnvelope({ seed: "w020-conf-403b", tenantId: TENANT, type: "device.command.wipe" }),
      { receivedAt: FIXTURE_TIME_ANCHOR, executedAt: FIXTURE_TIME_ANCHOR, completedAt: FIXTURE_TIME_ANCHOR, deviceId: DEVICE, policyGrant: true, policyCacheReady: false },
    );
    expect(offlineDeny.ok).toBe(false);
    if (offlineDeny.ok) return;
    expect(toApiError(offlineDeny.error).status).toBe(403);
    expect((offlineDeny.error as { decision: string }).decision).toBe("BLOCK");
  });

  test("the registry keys on fixture tenant/device ids (contracts ids are the SDK's ids)", () => {
    const registry = createAdapterRegistry();
    const tenantA = makeTenantId("w020-conf-iso-a");
    const tenantB = makeTenantId("w020-conf-iso-b");
    const device = makeDeviceId("w020-conf-iso-device");
    const adapter = createEndpointAdapter({
      descriptor: { adapterId: "adp_iso", platform: "windows", tenantId: tenantA, deviceId: device, adapterVersion: "0.1.0" },
      seams: createInMemoryWindowsSeam(),
      capabilities: makeAdapterCapabilities({ supported: ["health"] }),
      declaredAt: DECLARED_AT,
    });
    expect(registry.register(adapter).ok).toBe(true);
    expect(registry.get(tenantA, "adp_iso")).toBe(adapter);
    // A different fixture tenant cannot observe it.
    expect(registry.get(tenantB, "adp_iso")).toBeUndefined();
  });
});
