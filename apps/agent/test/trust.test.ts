/**
 * W071 tests — the agent trust-assertion layer (apps/agent).
 *
 * Proves, against the REAL surfaces:
 *
 *   - the STRUCTURAL seams: the real W020 check-in `AgentIdentity`
 *     satisfies `TrustedAgentIdentity`; the real W010
 *     `DeclaredAgentCapabilities` (from `declareAgentCapabilities`)
 *     satisfies `EnrolledCapabilityRecordShape`; the REAL
 *     `AgentRuntime` (from `createAgentRuntime`, with a REAL W020
 *     EndpointAdapter over the in-memory Windows seam) satisfies
 *     `TrustedDispatchSurface` — the binding site injects the real
 *     shapes (type-level + runtime proof);
 *   - a trusted assertion GRANTS dispatch: the dispatch surface is
 *     invoked (call-log grows; the platform seam executes the lock);
 *   - untrusted assertions NEVER reach dispatch — proven by the
 *     dispatch CALL-LOG (a recording wrapper around the real runtime's
 *     dispatchCommand) AND the platform seam's own call recording:
 *     - `unknown_agent` — no enrolled record, or an adapter-family
 *       mismatch with the enrolled identity, or a foreign tenant;
 *     - `capability_not_enrolled` — the command's exercised capability
 *       is not both claimed and enrolled;
 *     - `assertion_malformed` — a malformed shape, an unknown
 *       capability name in the claim set, or a command type that maps
 *       to no adapter capability;
 *   - the enrolled capability record is the CEILING (the verified
 *     trust reports the enrolled set, never the asserted superset);
 *   - every grant and refusal is audited through the INJECTED sink
 *     (machine-stable action names; refusals attributed tenant-stably);
 *   - tenant isolation: the trust store is partitioned per tenant;
 *   - determinism: byte-identical refusals + audit records across runs
 *     and claim-order permutations.
 */

import { describe, expect, test } from "bun:test";
import { makeCommand } from "@fleetos/contracts";
import type { AdapterCapabilities, CommandEnvelope } from "@fleetos/contracts";
import {
  makeAdapterCapabilities,
  makeCommandId,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  ACCEPT_ALL_VERIFIER,
  createEndpointAdapter,
  createInMemoryWindowsSeam,
  declareAgentCapabilities,
} from "@fleetos/device-adapters";
import type {
  AgentIdentity,
  AgentVersionInfo,
  EndpointAdapter,
  InMemoryWindowsSeam,
} from "@fleetos/device-adapters";
import { createAgentRuntime } from "../src/runtime";
import type { AgentRuntime } from "../src/runtime";
import {
  AGENT_TRUST_AUDIT_ACTIONS,
  AGENT_TRUST_ERROR_CODES,
  ALL_AGENT_TRUST_REFUSAL_REASONS,
  createInMemoryAgentTrustAuditSink,
  createInMemoryAgentTrustStore,
  createTrustedDispatchGuard,
  verifyAgentTrust,
} from "../src/trust";
import type {
  AgentTrustAssertion,
  AgentTrustStore,
  EnrolledAgentRecord,
  TrustedAgentIdentity,
  TrustedDispatchSurface,
} from "../src/trust";

const TENANT = makeTenantId("w071-trust-tenant");
const TENANT_B = makeTenantId("w071-trust-tenb");
const DEVICE = makeDeviceId("w071-trust-device");
const DEVICE_B = makeDeviceId("w071-trust-devib");
const CORRELATION = makeCorrelationId("w071-trust-corr");
const AT = "2026-01-01T00:00:00Z";

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

const ENROLLED_CAPS = ["observe", "health", "lock"] as const;

/** A REAL declared capability record (the W010 shape, structurally consumed). */
function realDeclaredCapabilities() {
  return declareAgentCapabilities({
    tenantId: TENANT,
    adapterFamily: "windows",
    capabilities: makeAdapterCapabilities({ supported: [...ENROLLED_CAPS] }),
    declaredAt: makeTimestamp("w071-trust-declared"),
    deviceId: DEVICE,
  });
}

/** A REAL agent runtime with a REAL adapter over the in-memory Windows seam. */
function realRuntime(): { runtime: AgentRuntime; seam: InMemoryWindowsSeam; adapter: EndpointAdapter } {
  const seam = createInMemoryWindowsSeam();
  const adapter = createEndpointAdapter({
    descriptor: {
      adapterId: "adp_w071_trust",
      platform: "windows",
      tenantId: TENANT,
      deviceId: DEVICE,
      adapterVersion: "0.1.0",
    },
    seams: seam,
    capabilities: makeAdapterCapabilities({ supported: [...ENROLLED_CAPS] }),
    declaredAt: makeTimestamp("w071-trust-declared"),
  });
  const runtime = createAgentRuntime({
    identity: IDENTITY,
    agent: AGENT,
    capabilities: { observe: true, health: true, lock: true },
    policyVerifier: ACCEPT_ALL_VERIFIER,
    adapters: [adapter],
  });
  return { runtime, seam, adapter };
}

/** A call-logging wrapper around a dispatch surface (the dispatch call-log). */
function recordingDispatch(
  surface: TrustedDispatchSurface,
): TrustedDispatchSurface & { readonly calls: readonly CommandEnvelope<unknown>[] } {
  const calls: CommandEnvelope<unknown>[] = [];
  return {
    dispatchCommand(command, inputs) {
      calls.push(command);
      return surface.dispatchCommand(command, inputs);
    },
    get calls(): readonly CommandEnvelope<unknown>[] {
      return calls;
    },
  };
}

/** A trust store with the runtime's agent enrolled (real shapes). */
function enrolledStore(): AgentTrustStore {
  const store = createInMemoryAgentTrustStore();
  const enrolled = store.enroll({
    identity: IDENTITY,
    capabilities: realDeclaredCapabilities(),
    enrolledAt: AT,
  });
  if (!enrolled.ok) throw new Error(enrolled.detail);
  return store;
}

function lockCommand(): CommandEnvelope<unknown> {
  return makeCommand<unknown>({
    id: makeCommandId("w071-trust-cmd"),
    idempotencyKey: makeIdempotencyKey("w071-trust-key"),
    issuedAt: AT,
    tenantId: TENANT,
    correlationId: CORRELATION,
    type: "device.command.lock",
    payload: { reason: "w071-trust-test" },
  });
}

function dispatchInputs(
  assertion: AgentTrustAssertion,
  overrides: Record<string, unknown> = {},
): Parameters<TrustedDispatchSurface["dispatchCommand"]>[1] & {
  assertion: AgentTrustAssertion;
  at: string;
  correlationId?: ReturnType<typeof makeCorrelationId>;
} {
  return {
    receivedAt: AT,
    executedAt: AT,
    completedAt: AT,
    assertion,
    at: AT,
    correlationId: CORRELATION,
    policyGrant: true,
    policyCacheReady: true,
    ...overrides,
  } as never;
}

function assertion(overrides: Partial<AgentTrustAssertion> = {}): AgentTrustAssertion {
  return {
    identity: { tenantId: TENANT, deviceId: DEVICE, adapterFamily: "windows" },
    claimedCapabilities: ["observe", "health", "lock"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The structural seams (real shapes injected at the binding site)
// ---------------------------------------------------------------------------

describe("W071: agent trust — the structural seams", () => {
  test("the REAL W020 AgentIdentity satisfies TrustedAgentIdentity (structural)", () => {
    const real: TrustedAgentIdentity = IDENTITY; // type-checks only if structural
    expect(real.tenantId).toBe(TENANT);
    expect(real.deviceId).toBe(DEVICE);
    expect(real.adapterFamily).toBe("windows");
  });

  test("the REAL W010 DeclaredAgentCapabilities satisfies EnrolledCapabilityRecordShape (structural)", () => {
    const declared = realDeclaredCapabilities();
    const record: EnrolledAgentRecord = {
      identity: IDENTITY,
      capabilities: declared, // structurally consumed — the real shape
      enrolledAt: AT,
    };
    // The real record's supported set follows ALL_ADAPTER_CAPABILITIES order.
    expect(record.capabilities.supported).toEqual(["observe", "lock", "health"]);
    expect(record.capabilities.tenantId).toBe(TENANT);
  });

  test("the REAL AgentRuntime satisfies TrustedDispatchSurface (structural + runtime)", () => {
    const { runtime } = realRuntime();
    const surface: TrustedDispatchSurface = runtime; // dispatchCommand is the seam
    expect(typeof surface.dispatchCommand).toBe("function");
  });

  test("the enrollment refuses malformed records + duplicates (machine-stable)", () => {
    const store = createInMemoryAgentTrustStore();
    expect(store.enroll(null).ok).toBe(false);
    expect(store.enroll({ identity: IDENTITY }).ok).toBe(false);
    expect(store.enroll({ identity: IDENTITY, capabilities: realDeclaredCapabilities() }).ok).toBe(false);
    expect(store.enroll({
      identity: IDENTITY,
      capabilities: { ...realDeclaredCapabilities(), supported: ["not-a-capability"] },
      enrolledAt: AT,
    }).ok).toBe(false);
    const first = store.enroll({ identity: IDENTITY, capabilities: realDeclaredCapabilities(), enrolledAt: AT });
    expect(first.ok).toBe(true);
    const duplicate = store.enroll({ identity: IDENTITY, capabilities: realDeclaredCapabilities(), enrolledAt: AT });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("unreachable");
    expect(duplicate.reason).toBe("duplicate_enrollment");
  });
});

// ---------------------------------------------------------------------------
// Trust verification (the pure gate)
// ---------------------------------------------------------------------------

describe("W071: agent trust — verification (machine-stable taxonomy)", () => {
  test("a well-formed assertion against the enrolled record GRANTS (enrolled set is the ceiling)", () => {
    const result = verifyAgentTrust(assertion(), enrolledStore(), { at: AT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.refusal.reason);
    expect(result.trust.tenantId).toBe(TENANT);
    expect(result.trust.deviceId).toBe(DEVICE);
    expect(result.trust.adapterFamily).toBe("windows");
    expect(result.trust.permittedCapabilities).toEqual(["health", "lock", "observe"]); // the ENROLLED set
    expect(result.trust.verifiedAt).toBe(AT);
  });

  test("unknown_agent: an unenrolled device / a foreign tenant / a family mismatch", () => {
    const store = enrolledStore();
    const unknownDevice = verifyAgentTrust(
      assertion({ identity: { tenantId: TENANT, deviceId: DEVICE_B, adapterFamily: "windows" } }),
      store,
      { at: AT },
    );
    expect(unknownDevice.ok).toBe(false);
    if (unknownDevice.ok) throw new Error("unreachable");
    expect(unknownDevice.refusal.reason).toBe("unknown_agent");

    const foreignTenant = verifyAgentTrust(
      assertion({ identity: { tenantId: TENANT_B, deviceId: DEVICE, adapterFamily: "windows" } }),
      store,
      { at: AT },
    );
    expect(foreignTenant.ok).toBe(false);
    if (foreignTenant.ok) throw new Error("unreachable");
    expect(foreignTenant.refusal.reason).toBe("unknown_agent");

    const familyMismatch = verifyAgentTrust(
      assertion({ identity: { tenantId: TENANT, deviceId: DEVICE, adapterFamily: "linux" } }),
      store,
      { at: AT },
    );
    expect(familyMismatch.ok).toBe(false);
    if (familyMismatch.ok) throw new Error("unreachable");
    expect(familyMismatch.refusal.reason).toBe("unknown_agent");
  });

  test("capability_not_enrolled: a claim outside the enrolled record", () => {
    const result = verifyAgentTrust(
      assertion({ claimedCapabilities: ["observe", "wipe"] }),
      enrolledStore(),
      { at: AT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("capability_not_enrolled");
    expect(result.refusal.capabilities).toEqual(["wipe"]);
  });

  test("capability_not_enrolled: the EXERCISED capability not claimed", () => {
    const result = verifyAgentTrust(
      assertion({ claimedCapabilities: ["observe", "health"] }),
      enrolledStore(),
      { at: AT, capability: "lock" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("capability_not_enrolled");
    expect(result.refusal.capability).toBe("lock");
    expect(result.refusal.capabilities).toEqual(["lock"]);
  });

  test("capability_not_enrolled: the exercised capability claimed but NOT enrolled", () => {
    // The enrolled record lacks wipe; the assertion claims wipe anyway.
    const result = verifyAgentTrust(
      assertion({ claimedCapabilities: ["observe", "health", "lock", "wipe"] }),
      enrolledStore(),
      { at: AT, capability: "lock" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("capability_not_enrolled");
  });

  test("assertion_malformed: absent / malformed identity / bad claim sets", () => {
    const store = enrolledStore();
    expect(verifyAgentTrust(null, store, { at: AT }).refusal?.reason).toBe("assertion_malformed");
    expect(verifyAgentTrust({}, store, { at: AT }).refusal?.reason).toBe("assertion_malformed");
    expect(
      verifyAgentTrust({ identity: { tenantId: "", deviceId: DEVICE, adapterFamily: "windows" }, claimedCapabilities: [] }, store, { at: AT }).refusal?.reason,
    ).toBe("assertion_malformed");
    expect(
      verifyAgentTrust({ identity: { tenantId: TENANT, deviceId: "", adapterFamily: "windows" }, claimedCapabilities: [] }, store, { at: AT }).refusal?.reason,
    ).toBe("assertion_malformed");
    expect(
      verifyAgentTrust({ identity: IDENTITY, claimedCapabilities: "lock" }, store, { at: AT }).refusal?.reason,
    ).toBe("assertion_malformed");
    expect(
      verifyAgentTrust({ identity: IDENTITY, claimedCapabilities: ["observe", "detonate"] }, store, { at: AT }).refusal?.reason,
    ).toBe("assertion_malformed");
  });

  test("the refusal taxonomy is the frozen three-reason set with stable error codes", () => {
    expect(ALL_AGENT_TRUST_REFUSAL_REASONS).toEqual([
      "unknown_agent",
      "capability_not_enrolled",
      "assertion_malformed",
    ]);
    expect(AGENT_TRUST_ERROR_CODES).toEqual({
      unknownAgent: "agent.trust.unknown_agent",
      capabilityNotEnrolled: "agent.trust.capability_not_enrolled",
      assertionMalformed: "agent.trust.assertion_malformed",
    });
  });
});

// ---------------------------------------------------------------------------
// The trusted dispatch guard (untrusted NEVER reaches dispatch — call-log)
// ---------------------------------------------------------------------------

describe("W071: agent trust — the dispatch guard (call-log proof)", () => {
  test("a TRUSTED assertion dispatches: the call-log grows, the real seam executes the lock, the grant is audited", () => {
    const { runtime, seam } = realRuntime();
    const recorded = recordingDispatch(runtime);
    const sink = createInMemoryAgentTrustAuditSink();
    const guard = createTrustedDispatchGuard({
      store: enrolledStore(),
      dispatch: recorded,
      auditSink: sink,
    });
    const outcome = guard.dispatchWithTrust(lockCommand(), dispatchInputs(assertion()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.refusal.reason);
    expect(outcome.outcome.ok).toBe(true); // the real dispatch succeeded
    expect(outcome.trust.permittedCapabilities).toEqual(["health", "lock", "observe"]);
    expect(recorded.calls.length).toBe(1); // the dispatch surface WAS invoked
    expect(seam.calls().length).toBeGreaterThan(0); // the real platform seam executed
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(AGENT_TRUST_AUDIT_ACTIONS.granted);
    expect(sink.records[0].subject).toBe(DEVICE as string);
    expect(sink.records[0].details.capability).toBe("lock");
    expect(sink.records[0].details.commandType).toBe("device.command.lock");
  });

  test("unknown_agent: dispatch NEVER invoked (call-log 0, seam 0, audited refusal)", () => {
    const { runtime, seam } = realRuntime();
    const recorded = recordingDispatch(runtime);
    const sink = createInMemoryAgentTrustAuditSink();
    const guard = createTrustedDispatchGuard({
      store: enrolledStore(),
      dispatch: recorded,
      auditSink: sink,
    });
    const outcome = guard.dispatchWithTrust(
      lockCommand(),
      dispatchInputs(assertion({ identity: { tenantId: TENANT, deviceId: DEVICE_B, adapterFamily: "windows" } })),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.reason).toBe("unknown_agent");
    expect(recorded.calls.length).toBe(0); // NEVER reached dispatch
    expect(seam.calls().length).toBe(0); // the platform seam never invoked
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(AGENT_TRUST_AUDIT_ACTIONS.refused);
    expect(sink.records[0].details.reason).toBe("unknown_agent");
  });

  test("capability_not_enrolled: dispatch NEVER invoked (the exercised capability is the ceiling)", () => {
    const { runtime, seam } = realRuntime();
    const recorded = recordingDispatch(runtime);
    const sink = createInMemoryAgentTrustAuditSink();
    const guard = createTrustedDispatchGuard({
      store: enrolledStore(),
      dispatch: recorded,
      auditSink: sink,
    });
    // The assertion claims only observe/health — the lock command's
    // exercised capability is not claimed.
    const outcome = guard.dispatchWithTrust(
      lockCommand(),
      dispatchInputs(assertion({ claimedCapabilities: ["observe", "health"] })),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.reason).toBe("capability_not_enrolled");
    expect(outcome.refusal.capability).toBe("lock");
    expect(recorded.calls.length).toBe(0);
    expect(seam.calls().length).toBe(0);
    expect(sink.records[0].action).toBe(AGENT_TRUST_AUDIT_ACTIONS.refused);
    expect(sink.records[0].details.capability).toBe("lock");
  });

  test("assertion_malformed: a malformed assertion NEVER reaches dispatch", () => {
    const { runtime, seam } = realRuntime();
    const recorded = recordingDispatch(runtime);
    const guard = createTrustedDispatchGuard({ store: enrolledStore(), dispatch: recorded });
    const outcome = guard.dispatchWithTrust(
      lockCommand(),
      dispatchInputs({ identity: { tenantId: TENANT, deviceId: "", adapterFamily: "windows" }, claimedCapabilities: ["lock"] }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.reason).toBe("assertion_malformed");
    expect(recorded.calls.length).toBe(0);
    expect(seam.calls().length).toBe(0);
  });

  test("assertion_malformed: a command type mapping to NO adapter capability refuses at the trust boundary", () => {
    const { runtime, seam } = realRuntime();
    const recorded = recordingDispatch(runtime);
    const sink = createInMemoryAgentTrustAuditSink();
    const guard = createTrustedDispatchGuard({
      store: enrolledStore(),
      dispatch: recorded,
      auditSink: sink,
    });
    const unknownCommand = makeCommand<unknown>({
      id: makeCommandId("w071-trust-unknown"),
      idempotencyKey: makeIdempotencyKey("w071-trust-unknown-key"),
      issuedAt: AT,
      tenantId: TENANT,
      correlationId: CORRELATION,
      type: "device.command.detonate", // maps to no capability
      payload: {},
    });
    const outcome = guard.dispatchWithTrust(unknownCommand, dispatchInputs(assertion()));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.reason).toBe("assertion_malformed");
    expect(outcome.refusal.detail).toContain("device.command.detonate");
    expect(recorded.calls.length).toBe(0);
    expect(seam.calls().length).toBe(0);
    expect(sink.records[0].action).toBe(AGENT_TRUST_AUDIT_ACTIONS.refused);
  });

  test("construction requires the store + the dispatch surface (injected, never defaulted)", () => {
    const { runtime } = realRuntime();
    expect(() => createTrustedDispatchGuard({ dispatch: runtime } as never)).toThrow(/store is required/);
    expect(() =>
      createTrustedDispatchGuard({ store: enrolledStore(), dispatch: { dispatchCommand: 42 } as never }),
    ).toThrow(/dispatch surface is required/);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation + determinism
// ---------------------------------------------------------------------------

describe("W071: agent trust — tenant isolation + determinism", () => {
  test("tenant isolation: the trust store partitions enrollments per tenant", () => {
    const store = createInMemoryAgentTrustStore();
    const enrolled = store.enroll({
      identity: IDENTITY,
      capabilities: realDeclaredCapabilities(),
      enrolledAt: AT,
    });
    expect(enrolled.ok).toBe(true);
    expect(store.lookup(TENANT_B, DEVICE)).toBeUndefined(); // foreign partition
    expect(store.lookup(TENANT, DEVICE)).toBeDefined();
    expect(store.listDeviceIds(TENANT_B)).toEqual([]);
    expect(store.size(TENANT_B)).toBe(0);
    expect(store.size(TENANT)).toBe(1);
    // A tenant-B assertion is unknown_agent against tenant A's store.
    const result = verifyAgentTrust(
      assertion({ identity: { tenantId: TENANT_B, deviceId: DEVICE, adapterFamily: "windows" } }),
      store,
      { at: AT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("unknown_agent");
  });

  test("byte-identical refusals + audit records across runs and claim-order permutations", () => {
    function run(claimOrder: "forward" | "reverse"): string {
      const store = createInMemoryAgentTrustStore();
      const first = store.enroll({
        identity: IDENTITY,
        capabilities: realDeclaredCapabilities(),
        enrolledAt: AT,
      });
      if (!first.ok) throw new Error(first.detail);
      const sink = createInMemoryAgentTrustAuditSink();
      const { runtime } = realRuntime();
      const recorded = recordingDispatch(runtime);
      const guard = createTrustedDispatchGuard({ store, dispatch: recorded, auditSink: sink });
      guard.dispatchWithTrust(
        lockCommand(),
        dispatchInputs(
          assertion({
            claimedCapabilities:
              claimOrder === "forward" ? ["observe", "health", "lock"] : ["lock", "health", "observe"],
          }),
        ),
      );
      const refusal = verifyAgentTrust(
        assertion({ claimedCapabilities: ["wipe", "update"] }),
        store,
        { at: AT },
      );
      return JSON.stringify({
        refusal: refusal.ok ? null : refusal.refusal,
        audit: sink.records,
        dispatchCalls: recorded.calls.length,
      });
    }
    expect(run("forward")).toBe(run("reverse")); // permutation invariance
    expect(run("forward")).toBe(run("forward")); // run determinism
  });

  test("audit records carry the injected tenant + subject attribution machine-stably", () => {
    const { runtime } = realRuntime();
    const sink = createInMemoryAgentTrustAuditSink();
    const guard = createTrustedDispatchGuard({
      store: enrolledStore(),
      dispatch: recordingDispatch(runtime),
      auditSink: sink,
    });
    guard.dispatchWithTrust(lockCommand(), dispatchInputs(assertion()));
    expect(sink.records[0].tenantId).toBe(TENANT);
    expect(sink.records[0].occurredAt).toBe(AT);
    expect(sink.records[0].correlationId).toBe(CORRELATION);
    expect(sink.records[0].details.adapterFamily).toBe("windows");
  });
});
