/**
 * @fleetos/integration-adcos — D1: the forward intent-translation tests.
 *
 * Pure, deterministic translation of the FROZEN ConnectivityIntent
 * envelope + requirement profile into the typed provider-neutral request,
 * with machine-stable refusals for malformed/unsupported intents — never
 * a guess, never a silent default.
 */

import { test, expect } from "bun:test";
import { translateConnectivityIntent } from "./translation";
import {
  CORR,
  DEV_A1,
  DEV_A2,
  INTENT_1,
  TENANT_A,
  T0,
  T1,
  connectivityIntent,
  lowLatencyRequirements,
  resilientRequirements,
  securePrivateRequirements,
} from "./test-support";

// ---------------------------------------------------------------------------
// Valid translations
// ---------------------------------------------------------------------------

test("a well-formed secure-private intent translates into the typed request", () => {
  const result = translateConnectivityIntent(
    connectivityIntent({
      sourceDeviceId: DEV_A1,
      targetDeviceId: DEV_A2,
      outcome: "secure private connectivity",
    }),
    securePrivateRequirements(),
    CORR,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const request = result.request;
  expect(request.tenantId).toBe(TENANT_A);
  expect(request.outcome.canonical).toBe("secure_private_connectivity");
  expect(request.outcome.raw).toBe("secure private connectivity");
  expect(request.targets.sourceDeviceId).toBe(DEV_A1);
  expect(request.targets.targetDeviceId).toBe(DEV_A2);
  expect(request.intentRef.intentId).toBe(INTENT_1);
  expect(request.intentRef.version).toBe(1);
  expect(request.intentRef.createdAt).toBe(T0);
  expect(request.properties.isolation).toBe("private");
  expect(request.security.encryption).toBe("required");
  expect(request.security.complianceRefs).toEqual(["soc2"]);
  expect(request.budget.budgetRef).toBe("budget/test-quarterly");
  expect(request.requestDigest).toMatch(/^[0-9a-f]{8}$/);
});

test("the workload ref rides the targets when supplied with the requirements", () => {
  const requirements = {
    ...securePrivateRequirements(),
    workloadId: "wl_testworkload01",
  };
  const result = translateConnectivityIntent(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    requirements,
    CORR,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.request.targets.workloadId).toBe("wl_testworkload01");
  }
});

test("set-like facets are sorted + deduplicated deterministically (input permutations digest identically)", () => {
  const base = {
    ...securePrivateRequirements(),
    constraints: {
      requiredZones: ["zone-b", "zone-a", "zone-b"],
      forbiddenZones: ["zone-y", "zone-x"],
      egressAllowed: false,
    },
    security: {
      ...securePrivateRequirements().security,
      complianceRefs: ["iso2", "soc2", "iso1", "soc2"],
    },
    budget: {
      budgetRef: "budget/q",
      policyRefs: ["pol-b", "pol-a"],
    },
  };
  const permuted = {
    ...securePrivateRequirements(),
    constraints: {
      egressAllowed: false,
      forbiddenZones: ["zone-x", "zone-y"],
      requiredZones: ["zone-a", "zone-b"],
    },
    security: {
      ...securePrivateRequirements().security,
      complianceRefs: ["soc2", "iso1", "iso2"],
    },
    budget: {
      policyRefs: ["pol-a", "pol-b"],
      budgetRef: "budget/q",
    },
  };
  const a = translateConnectivityIntent(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    base,
    CORR,
  );
  const b = translateConnectivityIntent(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    permuted,
    CORR,
  );
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (a.ok && b.ok) {
    expect(a.request.requestDigest).toBe(b.request.requestDigest);
    expect(a.request.constraints.requiredZones).toEqual(["zone-a", "zone-b"]);
    expect(a.request.constraints.forbiddenZones).toEqual(["zone-x", "zone-y"]);
    expect(a.request.security.complianceRefs).toEqual(["iso1", "iso2", "soc2"]);
    expect(a.request.budget.policyRefs).toEqual(["pol-a", "pol-b"]);
  }
});

test("the same inputs produce a byte-identical request every run", () => {
  const intent = connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "resilient connectivity" });
  const a = translateConnectivityIntent(intent, resilientRequirements(), CORR);
  const b = translateConnectivityIntent(intent, resilientRequirements(), CORR);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (a.ok && b.ok) {
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
  }
});

// ---------------------------------------------------------------------------
// Machine-stable refusals (malformed / unsupported)
// ---------------------------------------------------------------------------

function refusalOf(intent: unknown, requirements: unknown): { code: string; failures: { path: string; reason: string }[] } {
  const result = translateConnectivityIntent(intent, requirements, CORR);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  const error = result.error;
  if (error.kind !== "ValidationError") {
    throw new Error(`expected a ValidationError, got ${error.kind}`);
  }
  return {
    code: error.code,
    failures: error.failures.map((f) => ({ path: f.path, reason: f.reason })),
  };
}

test("a wrong intent kind is refused with wrong_intent_kind", () => {
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", kind: "MaintainDeviceIntent" }),
    securePrivateRequirements(),
  );
  expect(refusal.code).toBe("adcos.translation.refused");
  expect(refusal.failures.some((f) => f.path === "/payload/kind" && f.reason === "wrong_intent_kind")).toBe(true);
});

test("an invalid tenant id is refused with invalid_tenant (the frozen grammar)", () => {
  const refusal = refusalOf(
    { ...connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }), tenantId: "not-a-tenant" },
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/tenantId" && f.reason === "invalid_tenant")).toBe(true);
});

test("an invalid envelope version is refused with invalid_version", () => {
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", version: 0 }),
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/version" && f.reason === "invalid_version")).toBe(true);
});

test("a non-ISO createdAt is refused with not_iso", () => {
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", createdAt: "yesterday" }),
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/createdAt" && f.reason === "not_iso")).toBe(true);
});

test("an unsupported outcome is refused with unsupported_outcome — the open payload string is never guessed", () => {
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "connected-0" }),
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/payload/outcome" && f.reason === "unsupported_outcome")).toBe(true);
});

test("an intent with no target refs at all is refused with no_target_ref", () => {
  const refusal = refusalOf(
    connectivityIntent({ outcome: "secure private connectivity" }),
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/payload" && f.reason === "no_target_ref")).toBe(true);
});

test("an empty device ref is refused with empty", () => {
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: "", outcome: "secure private connectivity" }),
    securePrivateRequirements(),
  );
  expect(refusal.failures.some((f) => f.path === "/payload/sourceDeviceId" && f.reason === "empty")).toBe(true);
});

// ---------------------------------------------------------------------------
// Requirement-profile refusals (machine-stable)
// ---------------------------------------------------------------------------

test("outcome-inconsistent profiles are refused: secure private requires encryption + private isolation", () => {
  const noEncryption = {
    ...securePrivateRequirements(),
    security: { encryption: "not_required" as const, privateRouting: true, complianceRefs: ["soc2"] },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    noEncryption,
  );
  expect(refusal.failures.some((f) => f.path === "/security/encryption" && f.reason === "outcome_requires_encryption")).toBe(true);

  const publicIsolation = {
    ...securePrivateRequirements(),
    properties: { ...securePrivateRequirements().properties, isolation: "public" as const },
  };
  const refusal2 = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    publicIsolation,
  );
  expect(refusal2.failures.some((f) => f.path === "/properties/isolation" && f.reason === "outcome_requires_private_isolation")).toBe(true);
});

test("outcome-inconsistent profiles are refused: low-latency requires a latency bound", () => {
  const noLatencyBound = {
    ...lowLatencyRequirements(),
    properties: {
      isolation: "any" as const,
      redundancy: "none" as const,
    },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "low-latency local device group" }),
    noLatencyBound,
  );
  expect(refusal.failures.some((f) => f.path === "/properties/maxLatencyMs" && f.reason === "outcome_requires_max_latency")).toBe(true);
});

test("outcome-inconsistent profiles are refused: resilient requires redundancy", () => {
  const none = {
    ...resilientRequirements(),
    properties: { ...resilientRequirements().properties, redundancy: "none" as const },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "resilient connectivity" }),
    none,
  );
  expect(refusal.failures.some((f) => f.path === "/properties/redundancy" && f.reason === "outcome_requires_redundancy")).toBe(true);
});

test("conflicting zones are refused with conflicting_zones", () => {
  const conflicting = {
    ...securePrivateRequirements(),
    constraints: {
      requiredZones: ["dmz"],
      forbiddenZones: ["dmz"],
      egressAllowed: false,
    },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    conflicting,
  );
  expect(refusal.failures.some((f) => f.path === "/constraints" && f.reason === "conflicting_zones")).toBe(true);
});

test("a bounded duration with endAt before startAt is refused with out_of_range", () => {
  const reversed = {
    ...securePrivateRequirements(),
    duration: { startAt: T1, endAt: T0 },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    reversed,
  );
  expect(refusal.failures.some((f) => f.path === "/duration/endAt" && f.reason === "out_of_range")).toBe(true);
});

test("indefinite duration with an endAt is refused with conflicting_duration", () => {
  const conflicting = {
    ...securePrivateRequirements(),
    duration: { startAt: T0, endAt: T1, indefinite: true },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    conflicting,
  );
  expect(refusal.failures.some((f) => f.path === "/duration" && f.reason === "conflicting_duration")).toBe(true);
});

test("out-of-range and non-positive numeric facets are refused (never clamped)", () => {
  const bad = {
    ...securePrivateRequirements(),
    properties: {
      isolation: "private" as const,
      redundancy: "path_redundant" as const,
      availabilityTarget: 1.5,
    },
  };
  const refusal = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    bad,
  );
  expect(refusal.failures.some((f) => f.path === "/properties/availabilityTarget" && f.reason === "out_of_range")).toBe(true);

  const badLatency = {
    ...lowLatencyRequirements(),
    properties: { ...lowLatencyRequirements().properties, maxLatencyMs: -5 },
  };
  const refusal2 = refusalOf(
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "low-latency local device group" }),
    { ...badLatency, properties: { ...badLatency.properties, maxLatencyMs: -5 } },
  );
  expect(refusal2.failures.some((f) => f.path === "/properties/maxLatencyMs" && f.reason === "not_positive")).toBe(true);
});

test("missing required facets are refused (never defaulted): properties/constraints/duration/security", () => {
  const refusal = refusalOf(
    connectivityIntent({ outcome: "secure private connectivity" }),
    {},
  );
  expect(refusal.failures.some((f) => f.path === "/properties" && f.reason === "required")).toBe(true);
  expect(refusal.failures.some((f) => f.path === "/constraints" && f.reason === "required")).toBe(true);
  expect(refusal.failures.some((f) => f.path === "/duration" && f.reason === "required")).toBe(true);
  expect(refusal.failures.some((f) => f.path === "/security" && f.reason === "required")).toBe(true);
  expect(refusal.failures.some((f) => f.path === "/payload" && f.reason === "no_target_ref")).toBe(true);
});

test("refusals collect EVERY failure, never fail fast", () => {
  const refusal = refusalOf(
    { tenantId: "bad", version: 0, createdAt: "nope", intentId: "", payload: { kind: "Other", outcome: " " } },
    {},
  );
  const paths = refusal.failures.map((f) => f.path);
  expect(paths).toContain("/payload/kind");
  expect(paths).toContain("/tenantId");
  expect(paths).toContain("/version");
  expect(paths).toContain("/createdAt");
  expect(paths).toContain("/intentId");
  expect(paths).toContain("/payload/outcome");
});
