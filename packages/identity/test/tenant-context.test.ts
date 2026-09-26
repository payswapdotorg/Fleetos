/**
 * W012 D1 — TenantContext + guards: contract tests.
 *
 * Covers: construction validation, context-free rejection, cross-tenant
 * assertion, FleetError projections (AuthorizationError shape, 403 via
 * toApiError), determinism of the synthetic sentinels.
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId, toApiError } from "@fleetos/contracts";
import {
  IdentityError,
  SYNTHETIC_SYSTEM_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT_ID,
  TenantIsolationError,
  assertTenantIsolation,
  checkTenantContext,
  makeTenantContext,
  requireTenantContext,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");

test("makeTenantContext builds a frozen context for a valid tenant id", () => {
  const correlation = asCorrelationId("cor_test_0001");
  const ctx = makeTenantContext(TENANT_A, correlation);
  expect(ctx.tenantId).toBe(TENANT_A);
  expect(ctx.correlationId).toBe(correlation);
  expect(Object.isFrozen(ctx)).toBe(true);
});

test("makeTenantContext omits correlation when not supplied", () => {
  const ctx = makeTenantContext(TENANT_B);
  expect(ctx.correlationId).toBeUndefined();
});

test("makeTenantContext rejects an invalid tenant id with a ValidationError projection", () => {
  expect(() => makeTenantContext(asTenantId("bad-id"))).toThrow(IdentityError);
  try {
    makeTenantContext(asTenantId("short"));
  } catch (err) {
    const identityError = err as IdentityError;
    expect(identityError.fleet.kind).toBe("ValidationError");
    expect(identityError.fleet.code).toBe("tenant.context.invalid");
    expect(toApiError(identityError.fleet).status).toBe(400);
  }
});

test("checkTenantContext is a pure tagged check", () => {
  expect(checkTenantContext(makeTenantContext(TENANT_A))).toEqual({
    ok: true,
    tenantId: TENANT_A,
  });
  expect(checkTenantContext(undefined).ok).toBe(false);
  expect(checkTenantContext(null).ok).toBe(false);
  expect(checkTenantContext({} as never).ok).toBe(false);
  const invalid = checkTenantContext({ tenantId: asTenantId("nope") } as never);
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) {
    expect(invalid.reason).toBe("invalid_tenant_id");
  }
});

test("requireTenantContext rejects context-free access with TenantIsolationError", () => {
  expect(() => requireTenantContext(undefined)).toThrow(TenantIsolationError);
  expect(() => requireTenantContext(null)).toThrow(TenantIsolationError);
  try {
    requireTenantContext(undefined);
  } catch (err) {
    const isolationError = err as TenantIsolationError;
    expect(isolationError.fleet.kind).toBe("AuthorizationError");
    expect(isolationError.fleet.code).toBe("tenant.isolation.context_free");
    expect(toApiError(isolationError.fleet).status).toBe(403);
  }
});

test("requireTenantContext returns the validated tenant id on success", () => {
  expect(requireTenantContext(makeTenantContext(TENANT_A))).toBe(TENANT_A);
});

test("assertTenantIsolation accepts matching scopes and rejects mismatches", () => {
  const ctxA = makeTenantContext(TENANT_A);
  expect(() => assertTenantIsolation(ctxA, { tenantId: TENANT_A })).not.toThrow();
  expect(() => assertTenantIsolation(ctxA, { tenantId: TENANT_B })).toThrow(
    TenantIsolationError,
  );
  try {
    assertTenantIsolation(ctxA, { tenantId: TENANT_B });
  } catch (err) {
    const isolationError = err as TenantIsolationError;
    expect(isolationError.fleet.code).toBe("tenant.isolation.cross_tenant");
    if (isolationError.fleet.kind === "AuthorizationError") {
      expect(isolationError.fleet.reason).toBe("tenant_mismatch");
    } else {
      throw new Error("expected an AuthorizationError projection");
    }
  }
});

test("synthetic system sentinels are deterministic and documented", () => {
  expect(SYNTHETIC_SYSTEM_TENANT_ID).toBe("tnt_system");
  expect(SYNTHETIC_SYSTEM_CORRELATION_ID).toBe("cor_system");
});
