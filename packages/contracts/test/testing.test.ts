import { test, expect } from "bun:test";
import {
  makeTenantId,
  makeDeviceId,
  makeEventId,
  makeCorrelationId,
  makeCausationId,
  makeCommandId,
  makeIdempotencyKey,
  makeIntentId,
  makePolicyId,
  makeTimestamp,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAdapterCapabilities,
  makeGuardianDecision,
  makeFleetError,
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
  MAINTAIN_DEVICE_INTENT_KIND,
  SECURITY_REMEDIATION_INTENT_KIND,
  CONNECTIVITY_INTENT_KIND,
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  RECOVERY_INTENT_KIND,
  PRINT_INTENT_KIND,
  FLEET_ACTION_INTENT_KIND,
  type MakeEventEnvelopeOptions,
  type MakeCommandEnvelopeOptions,
} from "../src/testing";

import {
  validateEnvelope,
} from "../src/events";
import { validateCommand as validateCmdFromCommands } from "../src/commands";
import {
  validateTenantRef as validateTenantFromTenant,
  TENANT_ID_PATTERN,
} from "../src/tenant";
import { validateObservationBatch } from "../src/observations";
import { ALL_INTENT_KINDS } from "../src/intents";
import { ALL_GUARDIAN_DECISION_TYPES } from "../src/policy";
import { ALL_ADAPTER_CAPABILITIES, DESTRUCTIVE_CAPABILITIES } from "../src/device";
import { asObservationId, asTenantId, type TenantId, type IdempotencyKey } from "../src/ids";
import type { ObservationBatch } from "../src/observations";

// ---------------------------------------------------------------------------
// Determinism: same seed => same values
// ---------------------------------------------------------------------------

test("makeTenantId: same seed produces same value; different seeds produce different values", () => {
  const a = makeTenantId("alpha");
  const b = makeTenantId("alpha");
  const c = makeTenantId("beta");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test("makeTenantId: returns a tenant id that matches the canonical grammar", () => {
  for (const seed of ["default", "alpha", "beta", "tenant-1", "tenant-2"]) {
    const t = makeTenantId(seed);
    expect(TENANT_ID_PATTERN.test(t)).toBe(true);
    expect(validateTenantFromTenant(t)).toEqual({ ok: true, tenantId: t });
  }
});

test("makeDeviceId: same seed produces same value; different seeds produce different values", () => {
  const a = makeDeviceId("alpha");
  const b = makeDeviceId("alpha");
  const c = makeDeviceId("beta");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test("makeTimestamp: returns the same ISO 8601 string for the same offset", () => {
  expect(makeTimestamp(0)).toBe(makeTimestamp(0));
  expect(makeTimestamp(100)).toBe(makeTimestamp(100));
  expect(makeTimestamp(0)).not.toBe(makeTimestamp(100));
});

test("makeTimestamp: returns a value with the T...:... structure", () => {
  expect(makeTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
});

test("makeTimestamp: same value across two test runs (deterministic base epoch)", () => {
  // The fixture base epoch is fixed at 2026-01-01T00:00:00.000Z, so the
  // produced timestamp for offset 0 is always that exact string.
  expect(makeTimestamp(0)).toBe("2026-01-01T00:00:00.000Z");
});

test("every seeded id builder is deterministic and domain-tagged", () => {
  // Same seed should produce the same id within a single builder.
  expect(makeEventId("s")).toBe(makeEventId("s"));
  expect(makeCorrelationId("s")).toBe(makeCorrelationId("s"));
  expect(makeCausationId("s")).toBe(makeCausationId("s"));
  expect(makeCommandId("s")).toBe(makeCommandId("s"));
  expect(makeIdempotencyKey("s")).toBe(makeIdempotencyKey("s"));
  expect(makeIntentId("s")).toBe(makeIntentId("s"));
  expect(makePolicyId("s")).toBe(makePolicyId("s"));

  // Different builders using the same seed should produce DIFFERENT ids
  // (because each is tagged with a different domain prefix internally).
  expect(makeEventId("s")).not.toBe(makeCommandId("s"));
  expect(makeIntentId("s")).not.toBe(makePolicyId("s"));
});

// ---------------------------------------------------------------------------
// makeEventEnvelope: valid by construction
// ---------------------------------------------------------------------------

test("makeEventEnvelope: default fixture passes validateEnvelope", () => {
  const env = makeEventEnvelope();
  const result = validateEnvelope(env);
  expect(result.ok).toBe(true);
});

test("makeEventEnvelope: explicit payload passes validateEnvelope", () => {
  const env = makeEventEnvelope({ payload: { foo: "bar", count: 42 }, type: "device.test.synthetic" });
  expect(validateEnvelope(env).ok).toBe(true);
  expect(env.type).toBe("device.test.synthetic");
  expect(env.payload.foo).toBe("bar");
});

test("makeEventEnvelope: same seed produces the same envelope", () => {
  const a = makeEventEnvelope({}, "abc");
  const b = makeEventEnvelope({}, "abc");
  const c = makeEventEnvelope({}, "xyz");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
});

test("makeEventEnvelope: tenant id is well-formed and matches the canonical grammar", () => {
  const env = makeEventEnvelope({}, "tenant-check");
  expect(validateTenantFromTenant(env.tenantId)).toEqual({ ok: true, tenantId: env.tenantId });
});

test("makeEventEnvelope: different seeds produce different tenants (no cross-seed tenant collision)", () => {
  const a = makeEventEnvelope({}, "alpha");
  const b = makeEventEnvelope({}, "beta");
  expect(a.tenantId).not.toBe(b.tenantId);
});

test("makeEventEnvelope: throws when an override would produce an invalid envelope (missing tenantId)", () => {
  const overrides: MakeEventEnvelopeOptions<unknown> = {
    tenantId: "" as unknown as TenantId,
  };
  expect(() => makeEventEnvelope(overrides)).toThrow(/invalid envelope.*missing_tenant_id/);
});

test("makeEventEnvelope: throws when schemaVersion override is below 1", () => {
  expect(() => makeEventEnvelope({ schemaVersion: 0 })).toThrow(/invalid envelope.*schema_version_below_one/);
});

test("makeEventEnvelope: throws when occurredAt override is not ISO", () => {
  expect(() => makeEventEnvelope({ occurredAt: "yesterday" })).toThrow(/invalid envelope.*occurred_at_not_iso/);
});

// ---------------------------------------------------------------------------
// makeCommandEnvelope: valid by construction + idempotency key
// ---------------------------------------------------------------------------

test("makeCommandEnvelope: default fixture passes validateCommand", () => {
  const cmd = makeCommandEnvelope();
  expect(validateCmdFromCommands(cmd).ok).toBe(true);
});

test("makeCommandEnvelope: idempotency key is non-empty (duplicate-suppression contract)", () => {
  const cmd = makeCommandEnvelope({}, "idem-check");
  expect(typeof cmd.idempotencyKey).toBe("string");
  expect(cmd.idempotencyKey.length).toBeGreaterThan(0);
});

test("makeCommandEnvelope: same seed produces the same idempotency key", () => {
  const a = makeCommandEnvelope({}, "idem-same");
  const b = makeCommandEnvelope({}, "idem-same");
  expect(a.idempotencyKey).toBe(b.idempotencyKey);
});

test("makeCommandEnvelope: different seeds produce different idempotency keys", () => {
  const a = makeCommandEnvelope({}, "idem-a");
  const b = makeCommandEnvelope({}, "idem-b");
  expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
});

test("makeCommandEnvelope: throws when an override would produce an invalid command", () => {
  const overrides: MakeCommandEnvelopeOptions<unknown> = {
    idempotencyKey: "" as unknown as IdempotencyKey,
  };
  expect(() => makeCommandEnvelope(overrides)).toThrow(/invalid command.*missing_idempotency_key/);
});

test("makeCommandEnvelope: tenant id matches canonical grammar", () => {
  const cmd = makeCommandEnvelope({}, "tenant-grammar");
  expect(validateTenantFromTenant(cmd.tenantId)).toEqual({ ok: true, tenantId: cmd.tenantId });
});

// ---------------------------------------------------------------------------
// makeIntent: each of the nine kinds
// ---------------------------------------------------------------------------

test("makeIntent: produces a FleetIntent for each of the nine kinds", () => {
  const kinds = ALL_INTENT_KINDS;
  expect(kinds.length).toBe(9);
  for (const kind of kinds) {
    const intent = makeIntent(kind, {}, `seed:${kind}`);
    expect(intent.payload.kind).toBe(kind);
    expect(typeof intent.intentId).toBe("string");
    expect(intent.intentId.length).toBeGreaterThan(0);
    expect(typeof intent.tenantId).toBe("string");
    expect(validateTenantFromTenant(intent.tenantId)).toEqual({ ok: true, tenantId: intent.tenantId });
    expect(typeof intent.createdAt).toBe("string");
    expect(intent.version).toBeGreaterThanOrEqual(1);
  }
});

test("makeIntent: same seed produces the same intent", () => {
  const a = makeIntent(PRINT_INTENT_KIND, {}, "seed");
  const b = makeIntent(PRINT_INTENT_KIND, {}, "seed");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeIntent: payload overrides merge correctly (kind is preserved)", () => {
  const intent = makeIntent(SOFTWARE_SUBSCRIPTION_INTENT_KIND, {
    payload: { seatCount: 100 },
  });
  expect(intent.payload.kind).toBe(SOFTWARE_SUBSCRIPTION_INTENT_KIND);
  expect((intent.payload as { seatCount: number }).seatCount).toBe(100);
});

test("makeIntent: each of the nine kinds is covered by an explicit fixture (sanity)", () => {
  // Constructing each kind explicitly exercises the defaultIntentPayload switch.
  expect(makeIntent(MAINTAIN_DEVICE_INTENT_KIND).payload.kind).toBe(MAINTAIN_DEVICE_INTENT_KIND);
  expect(makeIntent(SECURITY_REMEDIATION_INTENT_KIND).payload.kind).toBe(SECURITY_REMEDIATION_INTENT_KIND);
  expect(makeIntent(CONNECTIVITY_INTENT_KIND).payload.kind).toBe(CONNECTIVITY_INTENT_KIND);
  expect(makeIntent(PROCUREMENT_INTENT_KIND).payload.kind).toBe(PROCUREMENT_INTENT_KIND);
  expect(makeIntent(SOFTWARE_SUBSCRIPTION_INTENT_KIND).payload.kind).toBe(SOFTWARE_SUBSCRIPTION_INTENT_KIND);
  expect(makeIntent(REPLACEMENT_INTENT_KIND).payload.kind).toBe(REPLACEMENT_INTENT_KIND);
  expect(makeIntent(RECOVERY_INTENT_KIND).payload.kind).toBe(RECOVERY_INTENT_KIND);
  expect(makeIntent(PRINT_INTENT_KIND).payload.kind).toBe(PRINT_INTENT_KIND);
  expect(makeIntent(FLEET_ACTION_INTENT_KIND).payload.kind).toBe(FLEET_ACTION_INTENT_KIND);
});

test("makeIntent: different seeds produce different tenant ids (no cross-tenant leakage by seed)", () => {
  const a = makeIntent(MAINTAIN_DEVICE_INTENT_KIND, {}, "tenant-a");
  const b = makeIntent(MAINTAIN_DEVICE_INTENT_KIND, {}, "tenant-b");
  expect(a.tenantId).not.toBe(b.tenantId);
});

// ---------------------------------------------------------------------------
// makeAdapterCapabilities: explicit supported/unsupported sets
// ---------------------------------------------------------------------------

test("makeAdapterCapabilities: supported capabilities are true, unsupported are false, others omitted", () => {
  const caps = makeAdapterCapabilities(["identify", "observe"], ["wipe"]);
  expect(caps.identify).toBe(true);
  expect(caps.observe).toBe(true);
  expect(caps.wipe).toBe(false);
  expect(caps.lock).toBeUndefined();
  expect(caps.health).toBeUndefined();
});

test("makeAdapterCapabilities: every capability can be marked supported (covers all 11)", () => {
  const caps = makeAdapterCapabilities(ALL_ADAPTER_CAPABILITIES);
  for (const cap of ALL_ADAPTER_CAPABILITIES) {
    expect(caps[cap]).toBe(true);
  }
});

test("makeAdapterCapabilities: every destructive capability can be marked supported", () => {
  const caps = makeAdapterCapabilities(DESTRUCTIVE_CAPABILITIES);
  for (const cap of DESTRUCTIVE_CAPABILITIES) {
    expect(caps[cap]).toBe(true);
  }
});

test("makeAdapterCapabilities: empty supported+unsupported produces an empty flag set", () => {
  const caps = makeAdapterCapabilities();
  expect(Object.keys(caps).length).toBe(0);
});

test("makeAdapterCapabilities: throws if a capability appears in BOTH supported and unsupported", () => {
  expect(() => makeAdapterCapabilities(["wipe"], ["wipe"])).toThrow(
    /capabilities appear in both supported and unsupported/,
  );
});

test("makeAdapterCapabilities: returned object is frozen", () => {
  const caps = makeAdapterCapabilities(["identify"]);
  expect(Object.isFrozen(caps)).toBe(true);
});

// ---------------------------------------------------------------------------
// makeGuardianDecision: each decision type
// ---------------------------------------------------------------------------

test("makeGuardianDecision: produces a decision for each of the four decision types", () => {
  for (const dt of ALL_GUARDIAN_DECISION_TYPES) {
    const decision = makeGuardianDecision(dt, {}, `seed:${dt}`);
    expect(decision.decision).toBe(dt);
    expect(typeof decision.tenantId).toBe("string");
    expect(validateTenantFromTenant(decision.tenantId)).toEqual({ ok: true, tenantId: decision.tenantId });
    expect(typeof decision.decidedAt).toBe("string");
    expect(Array.isArray(decision.rules)).toBe(true);
    expect(Array.isArray(decision.evidence)).toBe(true);
    expect(decision.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(decision)).toBe(true);
  }
});

test("makeGuardianDecision: same seed produces the same decision", () => {
  const a = makeGuardianDecision(BLOCK, {}, "abc");
  const b = makeGuardianDecision(BLOCK, {}, "abc");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeGuardianDecision: explicit rule refs and evidence are preserved", () => {
  const decision = makeGuardianDecision(REQUIRE_APPROVAL, {
    rules: [{ ruleId: makePolicyId("rule-1"), ruleVersion: 1 }],
    evidence: [
      {
        key: "evidence/fixture",
        sizeBytes: 256,
        hash: "deadbeef",
        hashAlgorithm: "sha256",
      },
    ],
  });
  expect(decision.rules.length).toBe(1);
  expect(decision.evidence.length).toBe(1);
  expect(decision.decision).toBe(REQUIRE_APPROVAL);
});

test("makeGuardianDecision: ALLOW / WARN / REQUIRE_APPROVAL / BLOCK constants are re-exported", () => {
  expect(ALLOW).toBe("ALLOW");
  expect(WARN).toBe("WARN");
  expect(REQUIRE_APPROVAL).toBe("REQUIRE_APPROVAL");
  expect(BLOCK).toBe("BLOCK");
});

// ---------------------------------------------------------------------------
// makeFleetError: each taxonomy class
// ---------------------------------------------------------------------------

test("makeFleetError: produces a FleetError for each of the six taxonomy kinds", () => {
  const kinds = [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ] as const;
  for (const kind of kinds) {
    const err = makeFleetError(kind, {}, `seed:${kind}`);
    expect(err.kind).toBe(kind);
    expect(typeof err.code).toBe("string");
    expect(err.code.length).toBeGreaterThan(0);
    expect(typeof err.message).toBe("string");
    expect(typeof err.tenantId).toBe("string");
    expect(validateTenantFromTenant(err.tenantId)).toEqual({ ok: true, tenantId: err.tenantId });
    expect(typeof err.correlationId).toBe("string");
  }
});

test("makeFleetError: PolicyError defaults to decision=BLOCK", () => {
  const err = makeFleetError("PolicyError");
  expect(err.kind).toBe("PolicyError");
  if (err.kind === "PolicyError") {
    expect(err.decision).toBe("BLOCK");
  }
});

test("makeFleetError: ValidationError carries a fixture failure", () => {
  const err = makeFleetError("ValidationError");
  if (err.kind === "ValidationError") {
    expect(err.failures.length).toBe(1);
    expect(err.failures[0].path).toBe("/fixture");
  }
});

test("makeFleetError: same seed produces the same error", () => {
  const a = makeFleetError("AdapterError", {}, "seed");
  const b = makeFleetError("AdapterError", {}, "seed");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeFleetError: code default is `fixture.<kind>` (lowercased)", () => {
  expect(makeFleetError("DomainError").code).toBe("fixture.domainerror");
  expect(makeFleetError("PolicyError").code).toBe("fixture.policyerror");
  expect(makeFleetError("ValidationError").code).toBe("fixture.validationerror");
});

// ---------------------------------------------------------------------------
// Cross-cutting: tenant isolation
// ---------------------------------------------------------------------------

test("tenant isolation: no two fixture builders produce the same tenant id for the same seed", () => {
  // Two different builders using the same seed should produce different
  // tenant ids (because each builder uses a different domain tag).
  const seed = "isolation-check";
  const eventTenant = makeEventEnvelope({}, seed).tenantId;
  const commandTenant = makeCommandEnvelope({}, seed).tenantId;
  const intentTenant = makeIntent(MAINTAIN_DEVICE_INTENT_KIND, {}, seed).tenantId;
  const decisionTenant = makeGuardianDecision(BLOCK, {}, seed).tenantId;
  const errorTenant = makeFleetError("DomainError", {}, seed).tenantId;
  const unique = new Set([eventTenant, commandTenant, intentTenant, decisionTenant, errorTenant]);
  expect(unique.size).toBe(5);
});

test("validateObservationBatch is reusable on fixture-built subjects (smoke check that the W002 validators compose with the fixture builders)", () => {
  // Build a minimal observation batch using fixture IDs to prove the W002
  // invariant validators accept the fixture outputs as inputs.
  const tenant = makeTenantId("obs-batch");
  const device = makeDeviceId("obs-batch");
  const batch: ObservationBatch = {
    tenantId: tenant,
    deviceId: device,
    observedAt: makeTimestamp(),
    observations: [
      {
        id: asObservationId(String(makeEventId("obs-1"))),
        kind: "device.health",
        observedAt: makeTimestamp(),
        schemaVersion: 1,
        payload: { status: "ok" },
      },
    ],
  };
  const result = validateObservationBatch(batch);
  expect(result.ok).toBe(true);
});
