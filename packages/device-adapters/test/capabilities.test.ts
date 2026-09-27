/**
 * W010 D2 — capability discovery + negotiation tests.
 *
 * Covers:
 *   - Declared capability record construction (built on AdapterCapabilities)
 *   - Supported/unsupported enumerable set derivation
 *   - Negotiation refusal modes:
 *     - `unsupported` (capability not declared) -> AdapterError
 *     - `destructive_unauthorized` (no policy grant) -> PolicyError REQUIRE_APPROVAL
 *     - `destructive_offline_default_deny` (policy cache stale) -> PolicyError BLOCK
 *   - Non-destructive capability acceptance (no policy grant required)
 *   - The CRITICAL invariant: unsupported destructive behavior is NEVER emulated
 *   - Determinism (same inputs => same record)
 */

import { test, expect } from "bun:test";
import {
  ALL_ADAPTER_CAPABILITIES,
  DESTRUCTIVE_CAPABILITIES,
  assertSupported,
  isDestructive,
  isSupported,
  type AdapterCapabilities,
} from "@fleetos/contracts";
import {
  AGENT_ALL_CAPABILITIES,
  AGENT_DESTRUCTIVE_CAPABILITIES,
  declareAgentCapabilities,
  isCapabilityDestructive,
  isCapabilitySupported,
  negotiateCapability,
  type CapabilityNegotiationRequest,
  type DeclaredAgentCapabilities,
} from "../src/capabilities";
import { ERROR_CODES } from "../src/internal";
import {
  makeAdapterCapabilities,
  makeCorrelationId,
  makeDeviceId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";

// ---------------------------------------------------------------------------
// Declared capability record construction
// ---------------------------------------------------------------------------

test("D2: declareAgentCapabilities derives the supported/unsupported sets from the frozen flag set", () => {
  const tenantId = makeTenantId("caps-tenant");
  const caps = makeAdapterCapabilities({
    supported: ["observe", "health", "locate"],
    unsupported: ["wipe"],
  });
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: caps,
    declaredAt: makeTimestamp("caps-at"),
  });
  expect(declared.adapterFamily).toBe("windows");
  expect(declared.tenantId).toBe(tenantId);
  // The supported set is derived by iterating ALL_ADAPTER_CAPABILITIES
  // (the frozen canonical order), so the order matches that list, not
  // the input order. We compare as sets (sorted copies).
  expect([...declared.supported].sort()).toEqual(["health", "locate", "observe"]);
  // `unsupported` is the FULL set minus supported — i.e. all caps not flagged true.
  expect(declared.unsupported).toContain("wipe");
  expect(declared.unsupported).toContain("enforce");
  expect(declared.unsupported).not.toContain("observe");
});

test("D2: declareAgentCapabilities produces a record whose flag set round-trips through isSupported (frozen contracts)", () => {
  const tenantId = makeTenantId("roundtrip-tenant");
  const caps = makeAdapterCapabilities({
    supported: ["identify", "observe", "health"],
  });
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "macos",
    capabilities: caps,
    declaredAt: makeTimestamp("roundtrip-at"),
  });
  expect(isSupported("identify", declared.capabilities)).toBe(true);
  expect(isSupported("observe", declared.capabilities)).toBe(true);
  expect(isSupported("health", declared.capabilities)).toBe(true);
  expect(isSupported("wipe", declared.capabilities)).toBe(false);
});

test("D2: AGENT_ALL_CAPABILITIES and AGENT_DESTRUCTIVE_CAPABILITIES re-export the frozen sets", () => {
  expect(AGENT_ALL_CAPABILITIES).toEqual(ALL_ADAPTER_CAPABILITIES);
  expect(AGENT_DESTRUCTIVE_CAPABILITIES).toEqual(DESTRUCTIVE_CAPABILITIES);
});

test("D2: isCapabilityDestructive agrees with the frozen isDestructive everywhere", () => {
  for (const cap of ALL_ADAPTER_CAPABILITIES) {
    expect(isCapabilityDestructive(cap)).toBe(isDestructive(cap));
  }
});

// ---------------------------------------------------------------------------
// Negotiation — happy path (non-destructive, supported)
// ---------------------------------------------------------------------------

test("D2: negotiateCapability accepts a supported non-destructive capability without a policy grant", () => {
  const tenantId = makeTenantId("happy-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "linux",
    capabilities: makeAdapterCapabilities({ supported: ["observe", "health"] }),
    declaredAt: makeTimestamp("happy-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "observe",
    policyGrant: false,
    policyCacheReady: false,
    correlationId: makeCorrelationId("happy-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.capability).toBe("observe");
    expect(result.destructive).toBe(false);
  }
});

test("D2: negotiateCapability accepts a supported destructive capability WITH a policy grant and fresh cache", () => {
  const tenantId = makeTenantId("happy-destructive-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: makeAdapterCapabilities({ supported: ["wipe", "lock"] }),
    declaredAt: makeTimestamp("happy-destructive-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "wipe",
    policyGrant: true,
    policyCacheReady: true,
    correlationId: makeCorrelationId("happy-destructive-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.destructive).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Negotiation — refusal: unsupported (CRITICAL INVARIANT — never emulate)
// ---------------------------------------------------------------------------

test("D2: CRITICAL — negotiateCapability REFUSES an unsupported capability with an AdapterError (never emulates)", () => {
  const tenantId = makeTenantId("refuse-unsupported-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "android",
    capabilities: makeAdapterCapabilities({
      supported: ["observe", "health"],
      unsupported: ["wipe", "lock"],
    }),
    declaredAt: makeTimestamp("refuse-unsupported-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "wipe",
    policyGrant: true, // even with a grant — unsupported is unsupported
    policyCacheReady: true,
    correlationId: makeCorrelationId("refuse-unsupported-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported");
    expect(result.capability).toBe("wipe");
    expect(result.destructive).toBe(true);
    expect(result.error.kind).toBe("AdapterError");
    expect(result.error.code).toBe(ERROR_CODES.capabilityUnsupported);
    expect((result.error as { adapterFamily: string }).adapterFamily).toBe("android");
  }
});

test("D2: CRITICAL — negotiateCapability REFUSES an unsupported NON-destructive capability too", () => {
  const tenantId = makeTenantId("refuse-unsupported-nondest-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "ios",
    capabilities: makeAdapterCapabilities({
      supported: ["identify"],
      unsupported: ["observe"],
    }),
    declaredAt: makeTimestamp("refuse-nondest-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "observe",
    policyGrant: false,
    policyCacheReady: false,
    correlationId: makeCorrelationId("refuse-nondest-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported");
    expect(result.error.kind).toBe("AdapterError");
  }
});

// ---------------------------------------------------------------------------
// Negotiation — refusal: destructive_unauthorized (no policy grant)
// ---------------------------------------------------------------------------

test("D2: negotiateCapability REFUSES a destructive capability WITHOUT a policy grant (PolicyError REQUIRE_APPROVAL)", () => {
  const tenantId = makeTenantId("refuse-unauth-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: makeAdapterCapabilities({ supported: ["wipe"] }),
    declaredAt: makeTimestamp("refuse-unauth-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "wipe",
    policyGrant: false,
    policyCacheReady: true,
    correlationId: makeCorrelationId("refuse-unauth-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("destructive_unauthorized");
    expect(result.error.kind).toBe("PolicyError");
    expect((result.error as { decision: string }).decision).toBe("REQUIRE_APPROVAL");
    expect(result.error.code).toBe(ERROR_CODES.capabilityDestructiveUnauthorized);
  }
});

// ---------------------------------------------------------------------------
// Negotiation — refusal: destructive_offline_default_deny (stale policy cache)
// ---------------------------------------------------------------------------

test("D2: negotiateCapability DEFAULT-DENIES a destructive capability when the policy cache is stale", () => {
  const tenantId = makeTenantId("default-deny-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "linux",
    capabilities: makeAdapterCapabilities({ supported: ["reboot", "update"] }),
    declaredAt: makeTimestamp("default-deny-at"),
  });
  // Even with a policy grant, the cache is not ready -> default-deny.
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "reboot",
    policyGrant: true,
    policyCacheReady: false,
    correlationId: makeCorrelationId("default-deny-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("destructive_offline_default_deny");
    expect(result.error.kind).toBe("PolicyError");
    expect((result.error as { decision: string }).decision).toBe("BLOCK");
    expect(result.error.code).toBe(ERROR_CODES.capabilityDestructiveOfflineDefaultDeny);
  }
});

test("D2: negotiateCapability default-denies when BOTH the grant is missing AND the cache is stale (precedence: unauthorized wins)", () => {
  // When the policy grant is missing, the frozen assertSupported returns
  // `destructive_unauthorized` first; the cache-staleness check is only
  // reached when the grant IS present. This is the correct precedence:
  // a missing grant is a stronger refusal than a stale cache (the grant
  // cannot be trusted when the cache is stale, but a missing grant is a
  // definitive refusal regardless of cache state).
  const tenantId = makeTenantId("precedence-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: makeAdapterCapabilities({ supported: ["wipe"] }),
    declaredAt: makeTimestamp("precedence-at"),
  });
  const request: CapabilityNegotiationRequest = {
    tenantId,
    capability: "wipe",
    policyGrant: false,
    policyCacheReady: false,
    correlationId: makeCorrelationId("precedence-cor"),
  };
  const result = negotiateCapability(declared, request);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("destructive_unauthorized");
  }
});

// ---------------------------------------------------------------------------
// Negotiation — the assertSupported seam (frozen contracts delegation)
// ---------------------------------------------------------------------------

test("D2: negotiateCapability's supported/destructive predicates agree with the frozen assertSupported everywhere", () => {
  const tenantId = makeTenantId("exhaustive-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "windows",
    capabilities: makeAdapterCapabilities({
      supported: ["identify", "observe", "diagnose", "enforce", "remediate", "lock", "locate", "wipe", "reboot", "update", "health"],
    }),
    declaredAt: makeTimestamp("exhaustive-at"),
  });
  for (const cap of ALL_ADAPTER_CAPABILITIES) {
    const grant = isDestructive(cap);
    const frozen = assertSupported(cap, declared.capabilities, grant);
    const lane = negotiateCapability(declared, {
      tenantId,
      capability: cap,
      policyGrant: grant,
      policyCacheReady: true,
      correlationId: makeCorrelationId("exhaustive-cor"),
    });
    expect(lane.ok).toBe(frozen.ok);
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("D2: declareAgentCapabilities is deterministic — same inputs produce byte-identical records", () => {
  const tenantId = makeTenantId("determ-caps-tenant");
  const caps = makeAdapterCapabilities({ supported: ["observe", "wipe"], unsupported: ["locate"] });
  const inputs = {
    tenantId,
    adapterFamily: "linux",
    capabilities: caps,
    declaredAt: makeTimestamp("determ-caps-at"),
  };
  const a = declareAgentCapabilities(inputs);
  const b = declareAgentCapabilities(inputs);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

test("D2: isCapabilitySupported delegates to the frozen isSupported", () => {
  const tenantId = makeTenantId("pred-tenant");
  const declared = declareAgentCapabilities({
    tenantId,
    adapterFamily: "macos",
    capabilities: makeAdapterCapabilities({ supported: ["locate"] }),
    declaredAt: makeTimestamp("pred-at"),
  });
  expect(isCapabilitySupported(declared, "locate")).toBe(true);
  expect(isCapabilitySupported(declared, "wipe")).toBe(false);
});
