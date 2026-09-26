/**
 * W012 D4 — Scoped authorization primitives: deterministic allow/deny with
 * reasons, scope model, consequential-action explicit-grant requirement.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asTenantId, asUserId, asWorkloadId, toApiError } from "@fleetos/contracts";
import {
  type ExplicitGrant,
  type ResourceScope,
  deviceScope,
  checkPermission,
  createActionCatalog,
  makeActionDescriptor,
  makeExplicitGrant,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  scopeCovers,
  tenantScope,
  toAuthorizationFleetError,
  workloadScope,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const USER_1 = asUserId("usr_w012user0001");
const DEVICE_1 = asDeviceId("dev_w012device01");
const DEVICE_2 = asDeviceId("dev_w012device02");
const WORKLOAD_1 = asWorkloadId("wkl_w012work001");
const AT = "2026-03-01T00:00:00Z";

const PRINCIPAL_A = makeUserPrincipal(TENANT_A, USER_1);
const PRINCIPAL_B = makeUserPrincipal(TENANT_B, USER_1);

const ROLES = [
  makeRoleDefinition("fleet.viewer", ["device.read", "workload.read"]),
  makeRoleDefinition("fleet.operator", ["device.read", "device.command.lock", "device.wipe"]),
];

const ACTIONS = [
  makeActionDescriptor({ action: "device.read", consequential: false }),
  makeActionDescriptor({ action: "device.command.lock", consequential: false }),
  makeActionDescriptor({ action: "device.wipe", consequential: true }),
];

function assignmentsFor(principalId: string, roleName: string): ReturnType<typeof makeRoleAssignment>[] {
  return [
    makeRoleAssignment({
      tenantId: TENANT_A,
      principalId,
      roleName,
      assignedAt: "2026-01-01T00:00:00Z",
      assignedBy: "usr:admin",
    }),
  ];
}

function grantFor(overrides: Partial<ExplicitGrant> = {}): ExplicitGrant {
  return makeExplicitGrant({
    grantId: "grt_w012grant0001",
    tenantId: TENANT_A,
    principalId: `usr:${USER_1}`,
    action: "device.wipe",
    scope: deviceScope(TENANT_A, DEVICE_1),
    grantedAt: "2026-01-15T00:00:00Z",
    grantedBy: "usr:admin",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Scope model
// ---------------------------------------------------------------------------

test("scopeCovers: tenant scope covers same-tenant device and workload scopes", () => {
  const wide = tenantScope(TENANT_A);
  expect(scopeCovers(wide, tenantScope(TENANT_A))).toBe(true);
  expect(scopeCovers(wide, deviceScope(TENANT_A, DEVICE_1))).toBe(true);
  expect(scopeCovers(wide, workloadScope(TENANT_A, WORKLOAD_1))).toBe(true);
  expect(scopeCovers(wide, tenantScope(TENANT_B))).toBe(false);
  expect(scopeCovers(wide, deviceScope(TENANT_B, DEVICE_1))).toBe(false);
});

test("scopeCovers: device scope covers only the same device in the same tenant", () => {
  const scope = deviceScope(TENANT_A, DEVICE_1);
  expect(scopeCovers(scope, deviceScope(TENANT_A, DEVICE_1))).toBe(true);
  expect(scopeCovers(scope, deviceScope(TENANT_A, DEVICE_2))).toBe(false);
  expect(scopeCovers(scope, tenantScope(TENANT_A))).toBe(false);
  expect(scopeCovers(scope, workloadScope(TENANT_A, WORKLOAD_1))).toBe(false);
});

test("scopeCovers: workload scope covers only the same workload", () => {
  const scope = workloadScope(TENANT_A, WORKLOAD_1);
  expect(scopeCovers(scope, workloadScope(TENANT_A, WORKLOAD_1))).toBe(true);
  expect(scopeCovers(scope, workloadScope(TENANT_A, asWorkloadId("wkl_w012work002")))).toBe(false);
  expect(scopeCovers(scope, deviceScope(TENANT_A, DEVICE_1))).toBe(false);
});

test("scope constructors are frozen", () => {
  for (const scope of [
    tenantScope(TENANT_A),
    deviceScope(TENANT_A, DEVICE_1),
    workloadScope(TENANT_A, WORKLOAD_1),
  ] as ResourceScope[]) {
    expect(Object.isFrozen(scope)).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

test("tenant mismatch denies before any other evaluation", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_B, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.read" },
    { assignments: [], roles: ROLES, grants: [], actions: ACTIONS, at: AT },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["tenant_mismatch"]);
});

test("unknown actions deny deterministically", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.unknown" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["unknown_action"]);
});

test("missing permission denies with the single failed requirement", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.read" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("allow");

  const missing = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.command.lock" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(missing.decision).toBe("deny");
  expect(missing.reasons).toEqual(["missing_permission"]);
});

test("non-consequential allow carries the contributing role reasons", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.read" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("allow");
  expect(decision.reasons).toEqual(["role:fleet.viewer"]);
});

test("CONSEQUENTIAL actions require an explicit grant even with the role permission", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [], // NO explicit grant.
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["consequential_requires_explicit_grant"]);
});

test("a matching explicit grant allows the consequential action with grant reasons", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [grantFor()],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("allow");
  expect(decision.reasons).toEqual([
    "explicit_grant:grt_w012grant0001",
    "role:fleet.operator",
  ]);
});

test("a device-scoped grant does NOT cover a different device", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_2), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [grantFor()], // scoped to DEVICE_1
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["consequential_requires_explicit_grant"]);
});

test("a tenant-wide grant covers device-scoped consequential checks", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_2), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [grantFor({ scope: tenantScope(TENANT_A) })],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("allow");
});

test("an expired explicit grant no longer authorizes", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [grantFor({ expiresAt: "2026-02-01T00:00:00Z" })],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["consequential_requires_explicit_grant"]);
});

test("a malformed grant expiry fails closed", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [grantFor({ expiresAt: "not-a-date" })],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
});

test("grants for other principals, tenants, or actions never authorize", () => {
  const foreign: ExplicitGrant[] = [
    grantFor({ principalId: `usr:${asUserId("usr_w012user0099")}` }),
    grantFor({ tenantId: TENANT_B, scope: deviceScope(TENANT_B, DEVICE_1) }),
    grantFor({ action: "device.command.lock" }),
  ];
  for (const grants of [foreign]) {
    const decision = checkPermission(
      { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" },
      {
        assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
        roles: ROLES,
        grants,
        actions: ACTIONS,
        at: AT,
      },
    );
    expect(decision.decision).toBe("deny");
  }
});

test("an unparseable evaluation time denies fail-closed", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.read" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: "not-a-date",
    },
  );
  expect(decision.decision).toBe("deny");
  expect(decision.reasons).toEqual(["invalid_evaluation_time"]);
});

test("the action catalog object is accepted in place of raw descriptors", () => {
  const catalog = createActionCatalog(ACTIONS);
  const viaCatalog = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.read" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: catalog,
      at: AT,
    },
  );
  const viaArray = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.read" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.viewer"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(JSON.stringify(viaCatalog)).toBe(JSON.stringify(viaArray));
});

test("checkPermission is deterministic: identical inputs, identical decisions", () => {
  const inputs = {
    assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
    roles: ROLES,
    grants: [grantFor()],
    actions: ACTIONS,
    at: AT,
  };
  const check = { principal: PRINCIPAL_A, scope: deviceScope(TENANT_A, DEVICE_1), action: "device.wipe" } as const;
  const r1 = checkPermission(check, inputs);
  const r2 = checkPermission(check, inputs);
  expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  // Reason arrays are sorted deterministically.
  expect([...r1.reasons]).toEqual([...r1.reasons].sort());
});

test("deny decisions project to AuthorizationError FleetErrors (403)", () => {
  const decision = checkPermission(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.wipe" },
    {
      assignments: assignmentsFor(`usr:${USER_1}`, "fleet.operator"),
      roles: ROLES,
      grants: [],
      actions: ACTIONS,
      at: AT,
    },
  );
  expect(decision.decision).toBe("deny");
  const fleetError = toAuthorizationFleetError(
    { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.wipe" },
    decision,
    asCorrelationId("cor_w012auth0001"),
  );
  expect(fleetError.kind).toBe("AuthorizationError");
  expect(fleetError.code).toBe("authorization.denied");
  expect(fleetError.reason).toBe("consequential_requires_explicit_grant");
  expect(toApiError(fleetError).status).toBe(403);
  expect(() =>
    toAuthorizationFleetError(
      { principal: PRINCIPAL_A, scope: tenantScope(TENANT_A), action: "device.read" },
      { decision: "allow", reasons: [] },
      asCorrelationId("cor_w012auth0002"),
    ),
  ).toThrow(TypeError);
});

test("makeExplicitGrant validates identifiers", () => {
  expect(() => makeExplicitGrant({ ...grantFor(), grantId: "" })).toThrow(TypeError);
  expect(() => makeExplicitGrant({ ...grantFor(), principalId: "" })).toThrow(TypeError);
  expect(() => makeExplicitGrant({ ...grantFor(), action: "" })).toThrow(TypeError);
});

test("makeActionDescriptor validates the action name", () => {
  expect(() => makeActionDescriptor({ action: "", consequential: false })).toThrow(TypeError);
});
