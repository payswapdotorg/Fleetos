/**
 * W012 D2 — Credential/token shapes + validator seam tests.
 *
 * Covers: opaque token grammar, issue/validate roundtrip, EXPIRED-token
 * rejection (the work-order-required case), not-yet-valid, tenant binding,
 * revocation, determinism of the default generator, computeExpiry.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asTenantId, asUserId } from "@fleetos/contracts";
import {
  type OpaqueToken,
  IdentityError,
  OPAQUE_TOKEN_PATTERN,
  OPAQUE_TOKEN_PREFIX,
  asOpaqueToken,
  computeExpiry,
  createInMemoryTokenRegistry,
  isValidOpaqueToken,
  makeServicePrincipal,
  makeTenantContext,
  makeUserPrincipal,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const USER_1 = asUserId("usr_w012user0001");

const ISSUED_AT = "2026-01-01T00:00:00Z";
const ONE_HOUR = 3600;

function validToken(): OpaqueToken {
  return asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"a".repeat(24)}`);
}

test("opaque token grammar: prefix + 24-128 base32 chars", () => {
  expect(isValidOpaqueToken(validToken())).toBe(true);
  expect(isValidOpaqueToken(asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"a".repeat(23)}`))).toBe(false);
  expect(isValidOpaqueToken(asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"a".repeat(129)}`))).toBe(false);
  expect(isValidOpaqueToken(asOpaqueToken("fst_SHORTUPPER!"))).toBe(false);
  expect(OPAQUE_TOKEN_PATTERN.test(validToken())).toBe(true);
});

test("computeExpiry adds the ttl deterministically", () => {
  expect(computeExpiry(ISSUED_AT, ONE_HOUR)).toBe("2026-01-01T01:00:00.000Z");
  expect(computeExpiry("2026-01-01T00:00:00.000Z", 60)).toBe("2026-01-01T00:01:00.000Z");
});

test("computeExpiry rejects malformed inputs", () => {
  expect(() => computeExpiry("not-a-date", 60)).toThrow(IdentityError);
  expect(() => computeExpiry(ISSUED_AT, 0)).toThrow(IdentityError);
  expect(() => computeExpiry(ISSUED_AT, -1)).toThrow(IdentityError);
  expect(() => computeExpiry(ISSUED_AT, 1.5)).toThrow(IdentityError);
});

test("issue/validate roundtrip: token authenticates the principal in its tenant", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });

  expect(credential.tenantId).toBe(TENANT_A);
  expect(credential.principal).toEqual(principal);
  expect(credential.issuedAt).toBe(ISSUED_AT);
  expect(credential.expiresAt).toBe(computeExpiry(ISSUED_AT, ONE_HOUR));

  const result = registry.validate(
    credential.token,
    makeTenantContext(TENANT_A),
    "2026-01-01T00:30:00Z",
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.principal).toEqual(principal);
    expect(result.credential).toEqual(credential);
  }
});

test("EXPIRED tokens are rejected at and after the expiry instant", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });
  const ctx = makeTenantContext(TENANT_A);

  // One millisecond before expiry: still valid.
  const before = registry.validate(credential.token, ctx, "2026-01-01T00:59:59.999Z");
  expect(before.ok).toBe(true);
  // At the expiry instant: expired (boundary is inclusive).
  const atExpiry = registry.validate(credential.token, ctx, "2026-01-01T01:00:00.000Z");
  expect(atExpiry.ok).toBe(false);
  if (!atExpiry.ok) expect(atExpiry.reason).toBe("expired");
  // Well after: expired.
  const after = registry.validate(credential.token, ctx, "2026-06-01T00:00:00Z");
  expect(after.ok).toBe(false);
  if (!after.ok) expect(after.reason).toBe("expired");
});

test("not-yet-valid tokens are rejected (injected now precedes issuedAt)", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: "2026-01-02T00:00:00Z", ttlSeconds: 60 });
  const result = registry.validate(
    credential.token,
    makeTenantContext(TENANT_A),
    "2026-01-01T00:00:00Z",
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("not_yet_valid");
});

test("tenant binding: a token issued in tenant A does not validate for tenant B", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });
  const result = registry.validate(
    credential.token,
    makeTenantContext(TENANT_B),
    "2026-01-01T00:30:00Z",
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("tenant_mismatch");
});

test("unknown and malformed tokens are rejected with distinct reasons", () => {
  const registry = createInMemoryTokenRegistry();
  const unknown = registry.validate(
    asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"b".repeat(24)}`),
    makeTenantContext(TENANT_A),
    ISSUED_AT,
  );
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.reason).toBe("unknown_token");

  const malformed = registry.validate(
    asOpaqueToken("garbage"),
    makeTenantContext(TENANT_A),
    ISSUED_AT,
  );
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) expect(malformed.reason).toBe("malformed_token");
});

test("revoked tokens are rejected permanently", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });
  expect(registry.revoke(credential.token)).toBe(true);
  expect(registry.revoke(credential.token)).toBe(false);
  expect(registry.revoke(asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"c".repeat(24)}`))).toBe(false);
  const result = registry.validate(
    credential.token,
    makeTenantContext(TENANT_A),
    "2026-01-01T00:30:00Z",
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("revoked");
});

test("an unparseable injected `now` fails closed", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });
  const result = registry.validate(credential.token, makeTenantContext(TENANT_A), "not-a-date");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("invalid_now");
});

test("issue rejects caller-supplied tokens that violate the grammar", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  expect(() =>
    registry.issue(principal, { now: ISSUED_AT, ttlSeconds: 60, token: asOpaqueToken("bad") }),
  ).toThrow(IdentityError);
});

test("the default token generator is deterministic per registry instance", () => {
  const registry1 = createInMemoryTokenRegistry();
  const registry2 = createInMemoryTokenRegistry();
  const principal = makeServicePrincipal(TENANT_A, "test.service");
  const c1 = registry1.issue(principal, { now: ISSUED_AT, ttlSeconds: 60 });
  const c2 = registry2.issue(principal, { now: ISSUED_AT, ttlSeconds: 60 });
  expect(c1.token).toBe(c2.token);
  expect(isValidOpaqueToken(c1.token)).toBe(true);
  // Sequential issues produce sequential tokens (counter-based).
  const c3 = registry1.issue(principal, { now: ISSUED_AT, ttlSeconds: 60 });
  expect(c3.token).not.toBe(c1.token);
});

test("caller-injected generators make issuance fully deterministic for tests", () => {
  const tokens = [validToken(), asOpaqueToken(`${OPAQUE_TOKEN_PREFIX}${"d".repeat(24)}`)];
  let index = 0;
  const registry = createInMemoryTokenRegistry({
    tokenGenerator: () => tokens[index++ % tokens.length] as OpaqueToken,
  });
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const first = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: 60 });
  const second = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: 60 });
  expect(first.token).toBe(tokens[0]);
  expect(second.token).toBe(tokens[1]);
});

test("validation is deterministic: same inputs, same result, every run", () => {
  const registry = createInMemoryTokenRegistry();
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const credential = registry.issue(principal, { now: ISSUED_AT, ttlSeconds: ONE_HOUR });
  const ctx = makeTenantContext(TENANT_A, asCorrelationId("cor_w012tok0001"));
  const r1 = registry.validate(credential.token, ctx, "2026-01-01T00:30:00Z");
  const r2 = registry.validate(credential.token, ctx, "2026-01-01T00:30:00Z");
  expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
});
