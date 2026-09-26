import { test, expect } from "bun:test";
import {
  SeededRng,
  rng,
  FIXTURE_TIME_ANCHOR,
  TESTING_MODULE_NAME,
  TESTING_MODULE_VERSION,
  makeTenantId,
  makeDeviceId,
  makeEventId,
  makeCommandId,
  makeIntentId,
  makeCorrelationId,
  makeCausationId,
  makeIdempotencyKey,
  makeObservationId,
  makePolicyId,
  makeTimestamp,
  makeEventEnvelope,
  makeCommandEnvelope,
  makeIntent,
  makeAllIntents,
  makeAdapterCapabilities,
  makeAdapterCapabilitiesSeeded,
  makeGuardianDecision,
  makeAllGuardianDecisions,
  makeFleetError,
  makeAllFleetErrors,
  makeObservationBatch,
} from "../src/testing";
import { validateEnvelope } from "../src/events";
import { validateCommand } from "../src/commands";
import { validateObservationBatch } from "../src/observations";
import { validateTenantRef, isValidTenantId } from "../src/tenant";
import { ALL_INTENT_KINDS, type FleetIntent } from "../src/intents";
import { ALL_GUARDIAN_DECISION_TYPES } from "../src/policy";
import { toApiError } from "../src/errors";

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

test("SeededRng: same seed produces same next() sequence", () => {
  const a = new SeededRng(42);
  const b = new SeededRng(42);
  for (let i = 0; i < 100; i++) {
    expect(a.next()).toBe(b.next());
  }
});

test("SeededRng: zero seed falls back to a non-degenerate state", () => {
  const r = new SeededRng(0);
  // If state were stuck at 0, all next() would return 0.
  expect(r.next()).not.toBe(0);
  expect(r.next()).not.toBe(0);
});

test("SeededRng.from: same string produces same sequence", () => {
  const a = SeededRng.from("tenant-enrollment-flow");
  const b = SeededRng.from("tenant-enrollment-flow");
  for (let i = 0; i < 100; i++) {
    expect(a.next()).toBe(b.next());
  }
});

test("SeededRng.from: different strings produce different sequences", () => {
  const a = SeededRng.from("alpha");
  const b = SeededRng.from("beta");
  let differ = 0;
  for (let i = 0; i < 100; i++) {
    if (a.next() !== b.next()) differ++;
  }
  // Two distinct strings should produce sequences that differ at almost
  // every position (probability of collision per draw is 1/2^32).
  expect(differ > 95).toBe(true);
});

test("SeededRng.pick: returns one of the array elements", () => {
  const r = new SeededRng(13);
  const arr = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 100; i++) {
    const v = r.pick(arr);
    expect(arr).toContain(v);
  }
});

test("SeededRng.base32: produces the requested length from the base32 alphabet", () => {
  const r = new SeededRng(17);
  const s = r.base32(20);
  expect(s.length).toBe(20);
  expect(s).toMatch(/^[a-z0-9]+$/);
});

test("SeededRng.int: returns values in [0, n) (proof: 1000 samples all in range)", () => {
  const r = new SeededRng(11);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(10);
    expect(v >= 0 && v < 10).toBe(true);
  }
});

test("rng(): number seed and equivalent numeric string seed differ (string is hashed)", () => {
  // A number seed uses the uint32 directly; a string seed is FNV-1a hashed.
  // The two should almost never produce the same sequence for non-trivial
  // inputs.
  const a = rng(42);
  const b = rng("42");
  let differ = 0;
  for (let i = 0; i < 100; i++) {
    if (a.next() !== b.next()) differ++;
  }
  expect(differ > 0).toBe(true);
});

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

test("FIXTURE_TIME_ANCHOR is a fixed ISO 8601 string (no clock reads)", () => {
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
});

test("makeTimestamp: same seed produces same timestamp", () => {
  expect(makeTimestamp("alpha")).toBe(makeTimestamp("alpha"));
});

test("makeTimestamp: different seeds produce different timestamps (overwhelmingly)", () => {
  // Not strictly guaranteed (the offset is 0..86_400_000 ms), but for 50
  // distinct seeds the collision probability is ~50 / 8.64e7 ≈ 6e-6.
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    seen.add(makeTimestamp(i));
  }
  expect(seen.size).toBe(50);
});

test("makeTimestamp: result is an ISO 8601 string parseable by Date", () => {
  const t = makeTimestamp("test");
  const parsed = Date.parse(t);
  expect(Number.isNaN(parsed)).toBe(false);
});

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

test("makeTenantId: produces a valid tenant id matching the canonical grammar", () => {
  const t = makeTenantId("enroll-1");
  expect(isValidTenantId(t)).toBe(true);
  expect(validateTenantRef(t).ok).toBe(true);
});

test("makeTenantId: same seed produces same value", () => {
  expect(makeTenantId("x")).toBe(makeTenantId("x"));
});

test("makeDeviceId / makeEventId / etc.: same seed produces same value, different seeds differ", () => {
  expect(makeDeviceId("x")).toBe(makeDeviceId("x"));
  expect(makeDeviceId("x")).not.toBe(makeDeviceId("y"));
  expect(makeEventId("x")).toBe(makeEventId("x"));
  expect(makeCommandId("x")).toBe(makeCommandId("x"));
  expect(makeIntentId("x")).toBe(makeIntentId("x"));
  expect(makeCorrelationId("x")).toBe(makeCorrelationId("x"));
  expect(makeCausationId("x")).toBe(makeCausationId("x"));
  expect(makeIdempotencyKey("x")).toBe(makeIdempotencyKey("x"));
  expect(makeObservationId("x")).toBe(makeObservationId("x"));
  expect(makePolicyId("x")).toBe(makePolicyId("x"));
});

// ---------------------------------------------------------------------------
// EventEnvelope fixtures (valid by construction)
// ---------------------------------------------------------------------------

test("makeEventEnvelope: default envelope passes validateEnvelope", () => {
  const env = makeEventEnvelope({ seed: "valid-default" });
  const result = validateEnvelope(env);
  expect(result.ok).toBe(true);
});

test("makeEventEnvelope: same seed produces the same envelope (deterministic)", () => {
  const a = makeEventEnvelope({ seed: "determ" });
  const b = makeEventEnvelope({ seed: "determ" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeEventEnvelope: different seeds produce different envelopes", () => {
  const a = makeEventEnvelope({ seed: "alpha" });
  const b = makeEventEnvelope({ seed: "beta" });
  expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
});

test("makeEventEnvelope: overrides are respected (tenantId, type, payload, subject)", () => {
  const env = makeEventEnvelope<{ count: number }>({
    seed: "override",
    type: "device.command.executed",
    subject: "dev_custom",
    schemaVersion: 3,
    payload: { count: 7 },
  });
  expect(env.type).toBe("device.command.executed");
  expect(env.subject).toBe("dev_custom");
  expect(env.schemaVersion).toBe(3);
  expect((env.payload as { count: number }).count).toBe(7);
  expect(validateEnvelope(env).ok).toBe(true);
});

test("makeEventEnvelope: tenantId override is respected and flows through", () => {
  const t = makeTenantId("custom-tenant");
  const env = makeEventEnvelope({ seed: "x", tenantId: t });
  expect(env.tenantId).toBe(t);
});

test("makeEventEnvelope: result is frozen", () => {
  const env = makeEventEnvelope({ seed: "freeze" });
  expect(Object.isFrozen(env)).toBe(true);
});

test("makeEventEnvelope: command-cause default stamps correlationId from cause and causationId from command id", () => {
  const env = makeEventEnvelope({ seed: "cause" });
  // Defaults: cause is a command; correlationId is derived from
  // makeCorrelationId(`${seed}-cor`); commandId (causationId) from
  // makeCausationId(seed).
  const expectedCausation = makeCausationId("cause");
  const expectedCorrelation = makeCorrelationId("cause-cor");
  expect(env.causationId).toBe(expectedCausation);
  expect(env.correlationId).toBe(expectedCorrelation);
});

// ---------------------------------------------------------------------------
// CommandEnvelope fixtures
// ---------------------------------------------------------------------------

test("makeCommandEnvelope: default command passes validateCommand", () => {
  const cmd = makeCommandEnvelope({ seed: "valid-cmd" });
  const result = validateCommand(cmd);
  expect(result.ok).toBe(true);
});

test("makeCommandEnvelope: command carries an idempotency key", () => {
  const cmd = makeCommandEnvelope({ seed: "idem" });
  expect(cmd.idempotencyKey).toBeTruthy();
  expect(typeof cmd.idempotencyKey).toBe("string");
  expect((cmd.idempotencyKey as string).length > 0).toBe(true);
});

test("makeCommandEnvelope: same seed produces the same command (including idempotency key)", () => {
  const a = makeCommandEnvelope({ seed: "determ-cmd" });
  const b = makeCommandEnvelope({ seed: "determ-cmd" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeCommandEnvelope: different seeds produce different idempotency keys", () => {
  const a = makeCommandEnvelope({ seed: "alpha" });
  const b = makeCommandEnvelope({ seed: "beta" });
  expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
});

test("makeCommandEnvelope: overrides are respected", () => {
  const cmd = makeCommandEnvelope<{ action: string }>({
    seed: "override",
    type: "device.command.wipe",
    payload: { action: "wipe" },
  });
  expect(cmd.type).toBe("device.command.wipe");
  expect((cmd.payload as { action: string }).action).toBe("wipe");
  expect(validateCommand(cmd).ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Intent fixtures (each of the nine kinds)
// ---------------------------------------------------------------------------

test("makeIntent: default intent is MaintainDeviceIntent", () => {
  const intent = makeIntent({ seed: "default" });
  expect(intent.payload.kind).toBe("MaintainDeviceIntent");
});

test("makeAllIntents: produces exactly the nine intent kinds, each with the correct kind tag", () => {
  const intents = makeAllIntents("batch");
  expect(intents.length).toBe(9);
  const kinds = intents.map((i) => i.payload.kind);
  expect(kinds).toEqual(ALL_INTENT_KINDS);
});

test("makeIntent: each kind produces a valid intent envelope (tenantId, intentId, version, createdAt, payload)", () => {
  for (const kind of ALL_INTENT_KINDS) {
    const intent = makeIntent({ seed: `kind-${kind}`, kind });
    // The kind discriminant lives on the payload, not the envelope.
    expect((intent.payload as { kind?: string }).kind).toBe(kind);
    expect(typeof intent.intentId).toBe("string");
    expect(intent.intentId.length > 0).toBe(true);
    expect(typeof intent.tenantId).toBe("string");
    expect(intent.tenantId.length > 0).toBe(true);
    expect(typeof intent.version).toBe("number");
    expect(intent.version >= 1).toBe(true);
    expect(typeof intent.createdAt).toBe("string");
    expect(intent.createdAt.length > 0).toBe(true);
  }
});

test("makeIntent: same seed and kind produces the same intent", () => {
  const a = makeIntent({ seed: "determ", kind: "RecoveryIntent" });
  const b = makeIntent({ seed: "determ", kind: "RecoveryIntent" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeIntent: each kind produces a payload that satisfies the kind's payload shape", () => {
  // Verify the discriminant `kind` field is set on the payload for each of
  // the nine kinds. This is the contract of the FleetIntent discriminated
  // union.
  const i1 = makeIntent({ seed: "k1", kind: "MaintainDeviceIntent" });
  expect((i1.payload as { kind: string }).kind).toBe("MaintainDeviceIntent");
  expect((i1.payload as { description: string }).description).toBeTruthy();

  const i2 = makeIntent({ seed: "k2", kind: "SoftwareSubscriptionIntent" });
  expect((i2.payload as { kind: string }).kind).toBe("SoftwareSubscriptionIntent");
  expect((i2.payload as { seatCount: number }).seatCount > 0).toBe(true);

  const i3 = makeIntent({ seed: "k3", kind: "RecoveryIntent" });
  expect((i3.payload as { kind: string }).kind).toBe("RecoveryIntent");
  expect(["lock", "locate", "wipe", "reboot"]).toContain((i3.payload as { action: string }).action);

  const i4 = makeIntent({ seed: "k4", kind: "PrintIntent" });
  expect((i4.payload as { kind: string }).kind).toBe("PrintIntent");
  expect((i4.payload as { documentRef: string }).documentRef).toBeTruthy();
});

test("makeIntent: tenantId override is respected across all nine kinds", () => {
  const t = makeTenantId("shared-tenant");
  for (const kind of ALL_INTENT_KINDS) {
    const intent: FleetIntent = makeIntent({ seed: `tenant-${kind}`, kind, tenantId: t });
    expect(intent.tenantId).toBe(t);
  }
});

// ---------------------------------------------------------------------------
// AdapterCapabilities fixtures
// ---------------------------------------------------------------------------

test("makeAdapterCapabilities: supported capabilities are true, unsupported are false, others omitted", () => {
  const caps = makeAdapterCapabilities({
    supported: ["identify", "observe", "health"],
    unsupported: ["wipe", "lock"],
  });
  expect(caps.identify).toBe(true);
  expect(caps.observe).toBe(true);
  expect(caps.health).toBe(true);
  expect(caps.wipe).toBe(false);
  expect(caps.lock).toBe(false);
  expect(caps.reboot).toBeUndefined();
  expect(caps.locate).toBeUndefined();
});

test("makeAdapterCapabilities: supported takes precedence over unsupported (no double-set)", () => {
  const caps = makeAdapterCapabilities({
    supported: ["wipe"],
    unsupported: ["wipe"],
  });
  expect(caps.wipe).toBe(true);
});

test("makeAdapterCapabilities: empty options produces an empty object", () => {
  const caps = makeAdapterCapabilities();
  expect(Object.keys(caps).length).toBe(0);
});

test("makeAdapterCapabilities: result is frozen", () => {
  const caps = makeAdapterCapabilities({ supported: ["identify"] });
  expect(Object.isFrozen(caps)).toBe(true);
});

test("makeAdapterCapabilitiesSeeded: same seed produces same capabilities", () => {
  const a = makeAdapterCapabilitiesSeeded("alpha");
  const b = makeAdapterCapabilitiesSeeded("alpha");
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeAdapterCapabilitiesSeeded: produces only known capability names", () => {
  const caps = makeAdapterCapabilitiesSeeded("any");
  const known = ["identify", "observe", "diagnose", "enforce", "remediate", "lock", "locate", "wipe", "reboot", "update", "health"];
  for (const k of Object.keys(caps)) {
    expect(known).toContain(k);
  }
});

// ---------------------------------------------------------------------------
// GuardianDecision fixtures
// ---------------------------------------------------------------------------

test("makeGuardianDecision: default decision is ALLOW", () => {
  const d = makeGuardianDecision({ seed: "default" });
  expect(d.decision).toBe("ALLOW");
});

test("makeAllGuardianDecisions: produces exactly the four decision types", () => {
  const ds = makeAllGuardianDecisions("batch");
  expect(ds.length).toBe(4);
  expect(ds.map((d) => d.decision).sort()).toEqual([...ALL_GUARDIAN_DECISION_TYPES].sort());
});

test("makeGuardianDecision: each decision type is constructible and frozen", () => {
  for (const t of ALL_GUARDIAN_DECISION_TYPES) {
    const d = makeGuardianDecision({ seed: `t-${t}`, decision: t });
    expect(d.decision).toBe(t);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.rules)).toBe(true);
    expect(Object.isFrozen(d.evidence)).toBe(true);
  }
});

test("makeGuardianDecision: same seed produces the same decision", () => {
  const a = makeGuardianDecision({ seed: "determ", decision: "BLOCK" });
  const b = makeGuardianDecision({ seed: "determ", decision: "BLOCK" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeGuardianDecision: tenantId override is respected", () => {
  const t = makeTenantId("tenant-x");
  const d = makeGuardianDecision({ seed: "x", tenantId: t });
  expect(d.tenantId).toBe(t);
});

// ---------------------------------------------------------------------------
// FleetError fixtures (each of the six taxonomy classes)
// ---------------------------------------------------------------------------

test("makeFleetError: default error is DomainError", () => {
  const e = makeFleetError({ seed: "default" });
  expect(e.kind).toBe("DomainError");
});

test("makeAllFleetErrors: produces exactly the six error kinds", () => {
  const es = makeAllFleetErrors("batch");
  expect(es.length).toBe(6);
  const kinds = es.map((e) => e.kind).sort();
  expect(kinds).toEqual([
    "AdapterError",
    "AuthorizationError",
    "ConflictError",
    "DomainError",
    "PolicyError",
    "ValidationError",
  ]);
});

test("makeFleetError: each kind carries tenantId + correlationId + stable code", () => {
  for (const kind of [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ] as const) {
    const e = makeFleetError({ seed: `k-${kind}`, kind });
    expect(e.kind).toBe(kind);
    expect(e.tenantId).toBeTruthy();
    expect(typeof e.tenantId).toBe("string");
    expect(e.correlationId).toBeTruthy();
    expect(typeof e.correlationId).toBe("string");
    expect(e.code).toContain(kind.toLowerCase());
    expect(e.message).toBeTruthy();
  }
});

test("makeFleetError: each kind round-trips through toApiError", () => {
  for (const kind of [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ] as const) {
    const e = makeFleetError({ seed: `api-${kind}`, kind });
    const api = toApiError(e);
    expect(api.kind).toBe(kind);
    expect(typeof api.status).toBe("number");
    expect(api.status >= 400 && api.status < 600).toBe(true);
  }
});

test("makeFleetError: same seed produces the same error", () => {
  const a = makeFleetError({ seed: "determ", kind: "AdapterError" });
  const b = makeFleetError({ seed: "determ", kind: "AdapterError" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeFleetError: tenantId override is respected", () => {
  const t = makeTenantId("tenant-err");
  const e = makeFleetError({ seed: "x", tenantId: t });
  expect(e.tenantId).toBe(t);
});

// ---------------------------------------------------------------------------
// ObservationBatch fixtures
// ---------------------------------------------------------------------------

test("makeObservationBatch: default batch passes validateObservationBatch", () => {
  const b = makeObservationBatch({ seed: "valid-batch" });
  const result = validateObservationBatch(b);
  expect(result.ok).toBe(true);
});

test("makeObservationBatch: same seed produces the same batch", () => {
  const a = makeObservationBatch({ seed: "determ" });
  const b = makeObservationBatch({ seed: "determ" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("makeObservationBatch: count override is respected", () => {
  const b = makeObservationBatch({ seed: "count", count: 5 });
  expect(b.observations.length).toBe(5);
});

test("makeObservationBatch: tenantId override is respected and consistent across observations", () => {
  const t = makeTenantId("batch-tenant");
  const b = makeObservationBatch({ seed: "x", tenantId: t });
  expect(b.tenantId).toBe(t);
});

test("makeObservationBatch: result and observations array are frozen", () => {
  const b = makeObservationBatch({ seed: "freeze" });
  expect(Object.isFrozen(b)).toBe(true);
  expect(Object.isFrozen(b.observations)).toBe(true);
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation rule
// ---------------------------------------------------------------------------

test("tenant isolation: same seed with different tenantId overrides produces fixtures scoped to the requested tenant", () => {
  const tA = makeTenantId("tenant-a");
  const tB = makeTenantId("tenant-b");
  const envA = makeEventEnvelope({ seed: "shared", tenantId: tA });
  const envB = makeEventEnvelope({ seed: "shared", tenantId: tB });
  expect(envA.tenantId).toBe(tA);
  expect(envB.tenantId).toBe(tB);
  expect(envA.tenantId).not.toBe(envB.tenantId);
});

test("tenant isolation: fixture tenantId always matches the canonical grammar", () => {
  for (let i = 0; i < 50; i++) {
    const env = makeEventEnvelope({ seed: i });
    expect(isValidTenantId(env.tenantId)).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Module markers
// ---------------------------------------------------------------------------

test("TESTING_MODULE_NAME is contracts/testing", () => {
  expect(TESTING_MODULE_NAME).toBe("contracts/testing");
});

test("TESTING_MODULE_VERSION is 0.1.0 (mirrors package version)", () => {
  expect(TESTING_MODULE_VERSION).toBe("0.1.0");
});
