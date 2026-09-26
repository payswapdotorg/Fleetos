/**
 * W012 D2 — Role definitions, assignments, and deterministic permission
 * resolution.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  type RoleAssignment,
  makeRoleAssignment,
  makeRoleDefinition,
  makeUserPrincipal,
  resolvePermissions,
} from "../src/index";
import { asUserId } from "@fleetos/contracts";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const USER_1 = asUserId("usr_w012user0001");
const USER_2 = asUserId("usr_w012user0002");
const AT = "2026-03-01T00:00:00Z";

const VIEWER = makeRoleDefinition("fleet.viewer", ["device.read", "workload.read"]);
const OPERATOR = makeRoleDefinition("fleet.operator", [
  "device.read",
  "device.command.lock",
  "device.wipe",
]);

test("makeRoleDefinition normalizes permissions to sorted-unique", () => {
  const role = makeRoleDefinition("r", ["b.perm", "a.perm", "b.perm"]);
  expect(role.permissions).toEqual(["a.perm", "b.perm"]);
  expect(Object.isFrozen(role.permissions)).toBe(true);
  expect(() => makeRoleDefinition("", [])).toThrow(TypeError);
});

test("makeRoleAssignment freezes the record and validates identifiers", () => {
  const assignment = makeRoleAssignment({
    tenantId: TENANT_A,
    principalId: `usr:${USER_1}`,
    roleName: "fleet.viewer",
    assignedAt: AT,
    assignedBy: "usr:admin",
  });
  expect(Object.isFrozen(assignment)).toBe(true);
  expect(() =>
    makeRoleAssignment({
      tenantId: TENANT_A,
      principalId: "",
      roleName: "r",
      assignedAt: AT,
      assignedBy: "a",
    }),
  ).toThrow(TypeError);
});

function assignmentFor(
  principalId: string,
  roleName: string,
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  return makeRoleAssignment({
    tenantId: TENANT_A,
    principalId,
    roleName,
    assignedAt: "2026-01-01T00:00:00Z",
    assignedBy: "usr:admin",
    ...overrides,
  });
}

test("resolution unions the permissions of the principal's active roles (sorted-unique)", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_1}`, "fleet.viewer"),
      assignmentFor(`usr:${USER_1}`, "fleet.operator"),
    ],
    [VIEWER, OPERATOR],
    AT,
  );
  expect(resolved.permissions).toEqual([
    "device.command.lock",
    "device.read",
    "device.wipe",
    "workload.read",
  ]);
  expect(resolved.roles).toEqual(["fleet.operator", "fleet.viewer"]);
  expect(resolved.skipped).toEqual([]);
});

test("resolution ignores other principals and other tenants", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_2}`, "fleet.operator"),
      makeRoleAssignment({
        tenantId: TENANT_B,
        principalId: `usr:${USER_1}`,
        roleName: "fleet.operator",
        assignedAt: "2026-01-01T00:00:00Z",
        assignedBy: "usr:admin",
      }),
    ],
    [VIEWER, OPERATOR],
    AT,
  );
  expect(resolved.permissions).toEqual([]);
  expect(resolved.roles).toEqual([]);
});

test("expired assignments are skipped with a disclosed reason", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_1}`, "fleet.viewer", {
        expiresAt: "2026-02-01T00:00:00Z",
      }),
    ],
    [VIEWER],
    AT,
  );
  expect(resolved.permissions).toEqual([]);
  expect(resolved.skipped).toEqual([{ roleName: "fleet.viewer", reason: "expired" }]);

  // One millisecond before expiry: active.
  const justBefore = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_1}`, "fleet.viewer", {
        expiresAt: "2026-03-01T00:00:00.001Z",
      }),
    ],
    [VIEWER],
    AT,
  );
  expect(justBefore.permissions).toEqual(VIEWER.permissions);
});

test("unknown roles are skipped with a disclosed reason", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [assignmentFor(`usr:${USER_1}`, "fleet.ghost")],
    [VIEWER],
    AT,
  );
  expect(resolved.permissions).toEqual([]);
  expect(resolved.skipped).toEqual([{ roleName: "fleet.ghost", reason: "unknown_role" }]);
});

test("malformed expiry fails closed (invalid_expiry, no permission widening)", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_1}`, "fleet.operator", {
        expiresAt: "not-a-date",
      }),
    ],
    [OPERATOR],
    AT,
  );
  expect(resolved.permissions).toEqual([]);
  expect(resolved.skipped).toEqual([{ roleName: "fleet.operator", reason: "invalid_expiry" }]);
});

test("an unparseable evaluation time expires every time-boxed assignment (fail-closed)", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const resolved = resolvePermissions(
    principal,
    [
      assignmentFor(`usr:${USER_1}`, "fleet.viewer", {
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    ],
    [VIEWER],
    "not-a-date",
  );
  expect(resolved.permissions).toEqual([]);
  expect(resolved.skipped).toEqual([{ roleName: "fleet.viewer", reason: "expired" }]);
});

test("resolution is deterministic: same inputs, byte-identical output", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const assignments = [
    assignmentFor(`usr:${USER_1}`, "fleet.operator"),
    assignmentFor(`usr:${USER_1}`, "fleet.viewer", { expiresAt: "2026-02-01T00:00:00Z" }),
    assignmentFor(`usr:${USER_1}`, "fleet.ghost"),
  ];
  const r1 = JSON.stringify(resolvePermissions(principal, assignments, [VIEWER, OPERATOR], AT));
  const r2 = JSON.stringify(resolvePermissions(principal, assignments, [VIEWER, OPERATOR], AT));
  expect(r1).toBe(r2);
});

test("input order does not change the resolved output (sorted determinism)", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const a = [assignmentFor(`usr:${USER_1}`, "fleet.viewer"), assignmentFor(`usr:${USER_1}`, "fleet.operator")];
  const b = [assignmentFor(`usr:${USER_1}`, "fleet.operator"), assignmentFor(`usr:${USER_1}`, "fleet.viewer")];
  const r1 = resolvePermissions(principal, a, [VIEWER, OPERATOR], AT);
  const r2 = resolvePermissions(principal, b, [VIEWER, OPERATOR], AT);
  expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
});
