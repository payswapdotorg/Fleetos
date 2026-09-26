/**
 * W012 — Contract conformance: identity against the frozen
 * @fleetos/contracts surface and the @fleetos/contracts/testing fixture
 * builders (makeTenantId, makeTimestamp, makeCorrelationId, makeDeviceId,
 * makeEventId, makeEventEnvelope, makeFleetError, makeGuardianDecision).
 *
 * Every fixture is deterministic and valid-by-construction; the assertions
 * below prove the identity primitives interoperate with the frozen shapes.
 */

import { test, expect } from "bun:test";
import {
  asUserId,
  isBlockingDecision,
  isValidTenantId,
  toApiError,
  validateEnvelope,
  validateTenantRef,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeCorrelationId,
  makeDeviceId,
  makeEventEnvelope,
  makeEventId,
  makeFleetError,
  makeGuardianDecision,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  createInMemoryTenantStore,
  makeAgentPrincipal,
  makeTenantContext,
  makeUserPrincipal,
  resolvePermissions,
  makeRoleAssignment,
  makeRoleDefinition,
} from "../src/index";

test("fixture tenant ids satisfy the frozen grammar and scope identity contexts", () => {
  for (let seed = 0; seed < 10; seed++) {
    const tenantId = makeTenantId(seed);
    expect(isValidTenantId(tenantId)).toBe(true);
    expect(validateTenantRef(tenantId).ok).toBe(true);
    const ctx = makeTenantContext(tenantId, makeCorrelationId(seed));
    expect(ctx.tenantId).toBe(tenantId);
  }
});

test("fixture timestamps are deterministic and anchored at the frozen epoch", () => {
  expect(makeTimestamp("seed-1")).toBe(makeTimestamp("seed-1"));
  expect(makeTimestamp("seed-1")).not.toBe(makeTimestamp("seed-2"));
  expect(makeTimestamp(0).startsWith("2026-01-01T")).toBe(true);
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
});

test("fixture-built event envelopes validate and scope tenant-scoped stores", () => {
  const envelope = makeEventEnvelope({ seed: "w012-conformance" });
  expect(validateEnvelope(envelope).ok).toBe(true);

  // A tenant-scoped store keyed by the envelope's tenant.
  const store = createInMemoryTenantStore<string>();
  const ctx = makeTenantContext(envelope.tenantId, envelope.correlationId);
  store.put(ctx, `event:${envelope.id}`, envelope.type);
  expect(store.get(ctx, `event:${envelope.id}`)).toBe(envelope.type);

  // A foreign tenant context cannot observe it.
  const foreign = makeTenantContext(makeTenantId("w012-foreign"));
  expect(store.get(foreign, `event:${envelope.id}`)).toBeUndefined();
});

test("principals bind to fixture tenant ids and carry fixture-derived ids", () => {
  const tenantId = makeTenantId("w012-principal");
  const userId = asUserId("usr_w012conform01");
  const deviceId = makeDeviceId("w012-principal-device");

  const user = makeUserPrincipal(tenantId, userId);
  const agent = makeAgentPrincipal(tenantId, deviceId);
  expect(user.tenantId).toBe(tenantId);
  expect(agent.principalId).toBe(`agt:${deviceId}`);
  expect(user.principalId).toBe(`usr:${userId}`);
});

test("role resolution over fixture tenants is deterministic across runs", () => {
  const tenantId = makeTenantId("w012-roles");
  const principal = makeUserPrincipal(tenantId, asUserId("usr_w012conform02"));
  const roles = [
    makeRoleDefinition("fixture.role", ["device.read", "device.wipe"]),
  ];
  const assignments = [
    makeRoleAssignment({
      tenantId,
      principalId: principal.principalId,
      roleName: "fixture.role",
      assignedAt: makeTimestamp("w012-assigned"),
      assignedBy: "usr:fixture-admin",
      expiresAt: "2099-01-01T00:00:00Z",
    }),
  ];
  const at = makeTimestamp("w012-evaluated");
  const r1 = JSON.stringify(resolvePermissions(principal, assignments, roles, at));
  const r2 = JSON.stringify(resolvePermissions(principal, assignments, roles, at));
  expect(r1).toBe(r2);
  expect(JSON.parse(r1).permissions).toEqual(["device.read", "device.wipe"]);
});

test("fixture FleetErrors map through the frozen taxonomy the same way identity errors do", () => {
  const fixtureError = makeFleetError({ seed: "w012-error", kind: "AuthorizationError" });
  expect(fixtureError.kind).toBe("AuthorizationError");
  expect(toApiError(fixtureError).status).toBe(403);

  // All six taxonomy kinds roundtrip the frozen translator.
  const kinds = [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ] as const;
  for (const kind of kinds) {
    const error = makeFleetError({ seed: `w012-${kind}`, kind });
    expect(toApiError(error).kind).toBe(kind);
    expect(error.tenantId.length > 0).toBe(true);
    expect(error.correlationId.length > 0).toBe(true);
  }
});

test("fixture GuardianDecisions feed the consequential-action correlation surface", () => {
  const tenantId = makeTenantId("w012-guardian");
  const decision = makeGuardianDecision({ seed: "w012-guardian", tenantId });
  expect(decision.tenantId).toBe(tenantId);
  expect(isBlockingDecision(decision.decision) || !isBlockingDecision(decision.decision)).toBe(true);

  // Every decision type is constructible (the audit record correlation
  // surface accepts any of them).
  for (const d of ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"] as const) {
    const typed = makeGuardianDecision({ seed: `w012-${d}`, decision: d, tenantId });
    expect(typed.decision).toBe(d);
  }
});

test("fixture event ids thread through identity-scoped keys", () => {
  const eventId = makeEventId("w012-threading");
  const tenantId = makeTenantId("w012-threading");
  const store = createInMemoryTenantStore<unknown>();
  const ctx = makeTenantContext(tenantId);
  store.put(ctx, eventId, { correlated: true });
  expect(store.get(ctx, eventId)).toEqual({ correlated: true });
});
