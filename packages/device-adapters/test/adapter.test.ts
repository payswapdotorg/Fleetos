/**
 * W020 D1/D3 tests — the normalized EndpointAdapter contract and the
 * capability negotiation / refusal behavior.
 *
 * EXHAUSTIVE refusal matrix (the "unsupported destructive behavior may
 * never be emulated" invariant — ARCHITECTURE-LOCK.md item 16):
 *
 *   - for EVERY one of the 11 normalized capabilities: declared + invoked
 *     => executes on the seam; NOT declared + invoked => refused
 *     (AdapterError, capability.unsupported) and the seam is NEVER
 *     invoked,
 *   - for EVERY one of the 7 destructive capabilities: declared + grant
 *     + fresh cache => executes; declared + no grant => refused
 *     (PolicyError, REQUIRE_APPROVAL); declared + grant + stale cache =>
 *     refused (PolicyError, BLOCK — offline default-deny); in every
 *     refusal the seam is NEVER invoked,
 *   - for the 4 non-destructive capabilities: no grant needed.
 *
 * Plus: construction validation, the tenant-isolation refusal at the
 * action boundary, seam-failure FleetError mapping, the observe
 * operation (W010 collector composition + back-pressure + fail-closed
 * malformed source records), the invoke() router, and the capability
 * probe helpers.
 */

import { describe, expect, test } from "bun:test";
import {
  assertSupported,
  isDestructive,
  isSupported,
  type AdapterCapabilities,
} from "@fleetos/contracts";
import { makeTenantId, makeDeviceId, makeCorrelationId, makeTimestamp, makeAdapterCapabilities } from "@fleetos/contracts/testing";
import {
  createEndpointAdapter,
  probeCapabilities,
  reconcileProbedCapabilities,
  type AdapterCommandContext,
  type AdapterInvocationRequest,
  type EndpointAdapter,
  type EndpointAdapterDescriptor,
} from "../src/adapter";
import { createInMemoryMacOsSeam, createInMemoryWindowsSeam } from "../src/seams-inmemory";
import type { InMemoryWindowsSeam } from "../src/seams-inmemory";
import type { ObservationRecord } from "../src/observations";
import { ERROR_CODES } from "../src/internal";

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

const DESTRUCTIVE = [
  "enforce",
  "remediate",
  "lock",
  "locate",
  "wipe",
  "reboot",
  "update",
] as const;

const NON_DESTRUCTIVE = ["identify", "observe", "diagnose", "health"] as const;

const TENANT = makeTenantId("w020-adapter-tenant");
const DEVICE = makeDeviceId("w020-adapter-device");
const CORRELATION = makeCorrelationId("w020-adapter-cor");
const EXECUTED_AT = makeTimestamp("w020-adapter-exec");
const DECLARED_AT = makeTimestamp("w020-adapter-declared");

function descriptor(platform: "windows" | "macos" | "linux" = "windows"): EndpointAdapterDescriptor {
  return {
    adapterId: "adp_w020_test",
    platform,
    tenantId: TENANT,
    deviceId: DEVICE,
    adapterVersion: "0.1.0",
  };
}

function context(overrides: Partial<AdapterCommandContext> = {}): AdapterCommandContext {
  return {
    tenantId: TENANT,
    correlationId: CORRELATION,
    executedAt: EXECUTED_AT,
    policyGrant: true,
    policyCacheReady: true,
    ...overrides,
  };
}

function makeAdapter(
  capabilities: AdapterCapabilities,
  seamOptions: Parameters<typeof createInMemoryWindowsSeam>[0] = {},
): { adapter: EndpointAdapter; seam: InMemoryWindowsSeam } {
  const seam = createInMemoryWindowsSeam(seamOptions);
  const adapter = createEndpointAdapter({
    descriptor: descriptor(),
    seams: seam,
    capabilities,
    declaredAt: DECLARED_AT,
  });
  return { adapter, seam };
}

function observation(kind: string, idx: number): ObservationRecord {
  return {
    kind,
    observedAt: EXECUTED_AT,
    schemaVersion: 1,
    payload: { idx },
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("W020 D1: adapter construction", () => {
  test("declares capabilities through the W010 record (supported/unsupported enumerable)", () => {
    const { adapter } = makeAdapter(makeAdapterCapabilities({ supported: ["lock", "health"] }));
    expect(adapter.capabilities.adapterFamily).toBe("windows");
    expect(adapter.capabilities.supported).toEqual(["lock", "health"]);
    expect(adapter.capabilities.unsupported).toContain("wipe");
    expect(adapter.capabilities.tenantId).toBe(TENANT);
    expect(adapter.platform).toBe("windows");
  });

  test("wires the W010 observation collector to the descriptor's tenant + device", () => {
    const { adapter } = makeAdapter(makeAdapterCapabilities({ supported: ["observe"] }));
    expect(adapter.collector.tenantId).toBe(TENANT);
    expect(adapter.collector.deviceId).toBe(DEVICE);
  });

  test("refuses construction when the seam platform does not match the descriptor", () => {
    expect(() =>
      createEndpointAdapter({
        descriptor: descriptor(),
        seams: createInMemoryMacOsSeam(),
        capabilities: makeAdapterCapabilities({ supported: ["lock"] }),
        declaredAt: DECLARED_AT,
      }),
    ).toThrow(/does not match/);
  });

  test("refuses construction on an empty adapter id", () => {
    expect(() =>
      createEndpointAdapter({
        descriptor: { ...descriptor(), adapterId: "" },
        seams: createInMemoryWindowsSeam(),
        capabilities: {},
        declaredAt: DECLARED_AT,
      }),
    ).toThrow(/adapterId/);
  });

  test("refuses construction on a non-ISO declaredAt", () => {
    expect(() =>
      createEndpointAdapter({
        descriptor: descriptor(),
        seams: createInMemoryWindowsSeam(),
        capabilities: {},
        declaredAt: "not-a-timestamp",
      }),
    ).toThrow(/declaredAt/);
  });
});

// ---------------------------------------------------------------------------
// D3 — exhaustive refusal matrix
// ---------------------------------------------------------------------------

describe("W020 D3: exhaustive capability support matrix (11 capabilities)", () => {
  for (const capability of ALL_CAPABILITIES) {
    test(`declared "${capability}" executes on the seam`, () => {
      const { adapter, seam } = makeAdapter(
        makeAdapterCapabilities({ supported: [capability] }),
      );
      const outcome = adapter.invoke({ capability }, context());
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.status).toBe("succeeded");
      if (capability === "observe") {
        // observe drains the seam's observation sources (no platform
        // command execution); empty sources still observe successfully.
        // (poll + wmiQuery + readEventLog)
        expect(seam.calls().length).toBe(3);
        expect(seam.calls().every((call) => call.surface === "observations")).toBe(true);
        return;
      }
      expect(outcome.evidence.length).toBe(1);
      // The seam executed exactly the requested capability.
      const executeCall = seam.calls().find((call) => call.method === "execute");
      expect((executeCall?.detail as { capability: string }).capability).toBe(capability);
    });

    test(`undeclared "${capability}" is refused and NEVER reaches the seam`, () => {
      const supported = ALL_CAPABILITIES.filter((c) => c !== capability);
      const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported }));
      const outcome = adapter.invoke({ capability }, context());
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe("rejected");
      expect(outcome.error.kind).toBe("AdapterError");
      expect(outcome.error.code).toBe(ERROR_CODES.capabilityUnsupported);
      // THE invariant: the platform seam was never invoked — unsupported
      // behavior is never emulated through another path.
      expect(seam.calls().length).toBe(0);
      // Cross-check against the frozen contracts assertSupported.
      expect(assertSupported(capability, { [capability]: false } as AdapterCapabilities, true).ok).toBe(false);
    });
  }
});

describe("W020 D3: exhaustive destructive grant matrix (7 destructive capabilities)", () => {
  for (const capability of DESTRUCTIVE) {
    test(`destructive "${capability}" + grant + fresh cache executes`, () => {
      const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: [capability] }));
      const outcome = adapter.invoke(
        { capability },
        context({ policyGrant: true, policyCacheReady: true }),
      );
      expect(outcome.ok).toBe(true);
      expect(seam.calls().length).toBe(2); // execute + runPowerShell
    });

    test(`destructive "${capability}" without a grant is refused (REQUIRE_APPROVAL) and never reaches the seam`, () => {
      const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: [capability] }));
      const outcome = adapter.invoke(
        { capability },
        context({ policyGrant: false, policyCacheReady: true }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe("rejected");
      expect(outcome.error.kind).toBe("PolicyError");
      expect(outcome.error.code).toBe(ERROR_CODES.capabilityDestructiveUnauthorized);
      expect((outcome.error as { decision: string }).decision).toBe("REQUIRE_APPROVAL");
      expect(seam.calls().length).toBe(0);
    });

    test(`destructive "${capability}" with a grant but a stale cache is default-denied (BLOCK) and never reaches the seam`, () => {
      const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: [capability] }));
      const outcome = adapter.invoke(
        { capability },
        context({ policyGrant: true, policyCacheReady: false }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe("rejected");
      expect(outcome.error.kind).toBe("PolicyError");
      expect(outcome.error.code).toBe(ERROR_CODES.capabilityDestructiveOfflineDefaultDeny);
      expect((outcome.error as { decision: string }).decision).toBe("BLOCK");
      expect(seam.calls().length).toBe(0);
    });

    test(`destructive "${capability}" is in the frozen DESTRUCTIVE set`, () => {
      expect(isDestructive(capability)).toBe(true);
    });
  }
});

describe("W020 D3: non-destructive capabilities need no grant", () => {
  for (const capability of NON_DESTRUCTIVE) {
    test(`non-destructive "${capability}" executes without a grant or cache`, () => {
      const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: [capability] }));
      const outcome = adapter.invoke(
        { capability },
        context({ policyGrant: false, policyCacheReady: false }),
      );
      expect(outcome.ok).toBe(true);
      if (capability !== "observe") {
        expect(seam.calls().length).toBe(2);
      } else {
        // observe polls sources (no command execution on the seam).
        expect(seam.calls().every((call) => call.surface === "observations")).toBe(true);
      }
      expect(isDestructive(capability)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// D3 — other refusals
// ---------------------------------------------------------------------------

describe("W020 D3: other adapter refusals", () => {
  test("unknown capability names are rejected as malformed (never routed)", () => {
    const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: ["lock"] }));
    const request = { capability: "detonate" } as unknown as AdapterInvocationRequest;
    const outcome = adapter.invoke(request, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("ValidationError");
    expect(outcome.error.code).toBe(ERROR_CODES.adapterUnknownCapability);
    expect(seam.calls().length).toBe(0);
  });

  test("cross-tenant invocation is refused at the action boundary (tenant isolation)", () => {
    const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: ["lock"] }));
    const foreignTenant = makeTenantId("w020-foreign-tenant");
    const outcome = adapter.invoke(
      { capability: "lock" },
      context({ tenantId: foreignTenant }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error.kind).toBe("AuthorizationError");
    expect(outcome.error.code).toBe(ERROR_CODES.adapterTenantMismatch);
    expect(seam.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Execution + FleetError mapping
// ---------------------------------------------------------------------------

describe("W020 D1: seam execution + FleetError mapping", () => {
  test("a seam failure maps onto the FleetError taxonomy (AdapterError, retryable)", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["wipe"] }),
      { commandOutcomes: [{ capability: "wipe", status: "failed", failureKind: "adapter_internal", message: "BitLocker refused" }] },
    );
    const outcome = adapter.invoke({ capability: "wipe" }, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("failed");
    expect(outcome.error.kind).toBe("AdapterError");
    expect(outcome.error.code).toBe(ERROR_CODES.commandRejected);
    expect((outcome.error as { retryable: boolean }).retryable).toBe(true);
    expect((outcome.error as { capability: string }).capability).toBe("wipe");
    expect((outcome.error as { adapterFamily: string }).adapterFamily).toBe("windows");
    expect(outcome.error.message).toContain("BitLocker refused");
    // The seam's evidence flows into the failure outcome.
    expect(outcome.evidence.length).toBe(1);
  });

  test("a seam timeout maps onto the FleetError taxonomy (DomainError)", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["reboot"] }),
      { commandOutcomes: [{ capability: "reboot", status: "failed", failureKind: "timeout" }] },
    );
    const outcome = adapter.invoke({ capability: "reboot" }, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("DomainError");
  });

  test("the payload flows through to the seam request", () => {
    const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: ["locate"] }));
    adapter.invoke({ capability: "locate", payload: { accuracy: "high" } }, context());
    const executeCall = seam.calls().find((call) => call.method === "execute");
    expect((executeCall?.detail as { payload?: unknown }).payload).toEqual({ accuracy: "high" });
  });

  test("invoke() dispatches to the per-capability method (method parity)", () => {
    const { adapter, seam } = makeAdapter(
      makeAdapterCapabilities({ supported: ["lock", "health", "identify", "diagnose", "enforce"] }),
    );
    adapter.lock(context());
    expect((seam.calls()[0].detail as { capability: string }).capability).toBe("lock");
    seam.reset();
    adapter.health(context(), { payload: { deep: true } });
    expect((seam.calls()[0].detail as { capability: string }).capability).toBe("health");
    expect((seam.calls()[0].detail as { payload?: unknown }).payload).toEqual({ deep: true });
    seam.reset();
    adapter.identify(context());
    expect((seam.calls()[0].detail as { capability: string }).capability).toBe("identify");
    seam.reset();
    adapter.diagnose(context());
    expect((seam.calls()[0].detail as { capability: string }).capability).toBe("diagnose");
    seam.reset();
    adapter.enforce(context());
    expect((seam.calls()[0].detail as { capability: string }).capability).toBe("enforce");
  });

  test("deterministic execution: identical requests produce identical outcomes", () => {
    const { adapter } = makeAdapter(makeAdapterCapabilities({ supported: ["health"] }));
    const a = adapter.invoke({ capability: "health", payload: { q: 1 } }, context());
    const b = adapter.invoke({ capability: "health", payload: { q: 1 } }, context());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// observe — W010 collector composition
// ---------------------------------------------------------------------------

describe("W020 D1: the observe operation (W010 collector composition)", () => {
  test("observes the scripted sources and emits a valid batch with content-addressed evidence", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["observe"] }),
      {
        primaryObservations: [observation("device.health", 1)],
        secondaryObservations: [observation("device.security", 2)],
      },
    );
    const outcome = adapter.observe(context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.batch).toBeDefined();
    expect(outcome.batch?.observations).toHaveLength(2);
    expect((outcome.output as { count: number }).count).toBe(2);
    expect(outcome.evidence.length).toBe(1);
    expect(outcome.evidence[0].key).toContain(`observations://${DEVICE as string}/`);
    expect(outcome.batch?.tenantId).toBe(TENANT);
    expect(outcome.batch?.deviceId).toBe(DEVICE);
    // The collector assigned deterministic sequence ids.
    expect(outcome.batch?.observations[0].id as string).toBe(`${DEVICE as string}-seq-1`);
    // Nothing left pending after the flush.
    expect(adapter.collector.pending()).toBe(0);
  });

  test("empty sources observe successfully with no batch", () => {
    const { adapter } = makeAdapter(makeAdapterCapabilities({ supported: ["observe"] }));
    const outcome = adapter.observe(context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.batch).toBeUndefined();
    expect((outcome.output as { count: number }).count).toBe(0);
    expect(outcome.evidence.length).toBe(0);
  });

  test("a malformed source record fails the observe fail-closed", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["observe"] }),
      {
        primaryObservations: [
          { kind: "", observedAt: EXECUTED_AT, schemaVersion: 1, payload: {} },
        ],
      },
    );
    const outcome = adapter.observe(context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe("failed");
    expect(outcome.error.kind).toBe("ValidationError");
  });

  test("back-pressure: a mid-observe flush keeps recording when the batch fills", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["observe"] }),
      {
        primaryObservations: [
          observation("device.health", 1),
          observation("device.health", 2),
          observation("device.health", 3),
        ],
        secondaryObservations: [],
      },
    );
    // Rebuild the adapter with maxBatchSize 2 to force a mid-observe flush.
    const seam = createInMemoryWindowsSeam({
      primaryObservations: [
        observation("device.health", 1),
        observation("device.health", 2),
        observation("device.health", 3),
      ],
    });
    const smallAdapter = createEndpointAdapter({
      descriptor: descriptor(),
      seams: seam,
      capabilities: makeAdapterCapabilities({ supported: ["observe"] }),
      declaredAt: DECLARED_AT,
      maxBatchSize: 2,
    });
    const outcome = smallAdapter.observe(context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect((outcome.output as { count: number; batches: number }).count).toBe(3);
    expect((outcome.output as { count: number; batches: number }).batches).toBe(2);
    // The first batch is the outcome's batch; two flushes => two evidence refs.
    expect(outcome.batch?.observations).toHaveLength(2);
    expect(outcome.evidence.length).toBe(2);
    expect(smallAdapter.collector.pending()).toBe(0);
    expect(adapter).toBeDefined();
  });

  test("the collector is reused across observe invocations (sequence continues)", () => {
    const { adapter } = makeAdapter(
      makeAdapterCapabilities({ supported: ["observe"] }),
      { primaryObservations: [observation("device.health", 1)] },
    );
    const first = adapter.observe(context());
    expect(first.ok).toBe(true);
    const second = adapter.observe(context());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.batch?.observations[0].id as string).toBe(`${DEVICE as string}-seq-2`);
  });

  test("observe respects the negotiation gate (undeclared observe is refused)", () => {
    const { adapter, seam } = makeAdapter(makeAdapterCapabilities({ supported: ["lock"] }));
    const outcome = adapter.observe(context());
    expect(outcome.ok).toBe(false);
    expect(seam.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Capability probe helpers
// ---------------------------------------------------------------------------

describe("W020 D2/D3: capability probe helpers", () => {
  test("probeCapabilities reads the seam's probe", () => {
    const seam = createInMemoryWindowsSeam({ probedCapabilities: { lock: true } });
    const probed = probeCapabilities(seam);
    expect(isSupported("lock", probed)).toBe(true);
    expect(isSupported("wipe", probed)).toBe(false);
  });

  test("reconciliation agrees when every declared capability is probed", () => {
    const declared = makeAdapterCapabilities({ supported: ["lock", "health"] });
    const probed = makeAdapterCapabilities({ supported: ["lock", "health", "observe"] });
    const reconciliation = reconcileProbedCapabilities(declared, probed);
    expect(reconciliation.agrees).toBe(true);
    expect(reconciliation.declaredAndProbed).toEqual(["lock", "health"]);
    expect(reconciliation.declaredOnly).toEqual([]);
    expect(reconciliation.probedOnly).toEqual(["observe"]);
  });

  test("reconciliation surfaces a declared-but-not-probed mismatch (declaration stays authoritative)", () => {
    const declared = makeAdapterCapabilities({ supported: ["wipe"] });
    const probed = makeAdapterCapabilities({ supported: ["observe"] });
    const reconciliation = reconcileProbedCapabilities(declared, probed);
    expect(reconciliation.agrees).toBe(false);
    expect(reconciliation.declaredOnly).toEqual(["wipe"]);
    expect(reconciliation.probedOnly).toEqual(["observe"]);
    // The DECLARED set remains the routing authority: the adapter still
    // routes wipe (the mismatch is surfaced for audit, not used to gate).
    const { adapter } = makeAdapter(declared);
    const outcome = adapter.invoke({ capability: "wipe" }, context());
    expect(outcome.ok).toBe(true);
  });

  test("macOS adapters route through macOS seams (cross-platform parity)", () => {
    const seam = createInMemoryMacOsSeam();
    const adapter = createEndpointAdapter({
      descriptor: descriptor("macos"),
      seams: seam,
      capabilities: makeAdapterCapabilities({ supported: ["enforce"] }),
      declaredAt: DECLARED_AT,
    });
    const outcome = adapter.invoke({ capability: "enforce" }, context());
    expect(outcome.ok).toBe(true);
    expect(seam.calls().map((call) => call.method)).toEqual(["execute", "runProfilesCommand"]);
  });
});
