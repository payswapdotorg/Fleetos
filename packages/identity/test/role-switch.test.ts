/**
 * W100C D4 — the auditable active-role switch: the frozen
 * ROLE-EXPERIENCE-MATRIX rules proven end-to-end over durable state.
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  createDurableRoleAssignmentRepository,
  createDurableSessionRepository,
  createInMemoryDurableRecordStore,
  createInMemoryIdentityAuditSink,
  createRoleSwitchService,
  createSessionService,
  makeRoleDefinition,
  makeTenantContext,
  makeUserPrincipal,
  projectRoleAwareSession,
  roleSwitchRefusalError,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const FOUNDER = asUserId("usr_founder0001");
const JOINER = asUserId("usr_joiner00001");
const CORR = asCorrelationId("cor_w100c_role001");
const T0 = "2026-10-01T09:00:00Z";
const T1 = "2026-10-01T12:00:00Z";
const T2 = "2026-10-02T09:00:00Z";
const T8 = "2026-10-08T09:00:00Z";

const ROLE_DEFS = [
  makeRoleDefinition("fleet.admin", ["device.read", "workload.read", "procurement.order.create"]),
  makeRoleDefinition("asset.manager", ["workload.read", "procurement.order.create"]),
  makeRoleDefinition("team.manager", ["workload.read"]),
  makeRoleDefinition("employee", ["device.read"]),
  makeRoleDefinition("vendor.operator", ["commerce.quote.respond"]),
];

function makeWorld() {
  const store = createInMemoryDurableRecordStore();
  const audit = createInMemoryIdentityAuditSink();
  const sessions = createDurableSessionRepository(store);
  const assignments = createDurableRoleAssignmentRepository(store);
  const sessionService = createSessionService({ sessions, auditSink: audit });
  const switchService = createRoleSwitchService({
    sessions,
    assignmentsOf: (ctx) => assignments.listAssignments(ctx),
    auditSink: audit,
  });
  return { store, audit, sessions, assignments, sessionService, switchService };
}

/** Create a workspace-like tenant A with FOUNDER holding three roles + a live session. */
function founderWorld() {
  const world = makeWorld();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = world.sessionService.openSession({
    now: T0,
    ttlSeconds: 604800,
    principal,
    correlationId: CORR,
  });
  if (!opened.ok) throw new Error("open failed");
  for (const role of ["fleet.admin", "asset.manager", "employee"]) {
    const added = world.assignments.addAssignment(ctxA, {
      tenantId: TENANT_A,
      principalId: `usr:${FOUNDER}`,
      roleName: role,
      assignedAt: T0,
      assignedBy: `usr:${FOUNDER}`,
    });
    if (!added.ok) throw new Error("assignment failed");
  }
  return { ...world, session: opened.session, ctxA, principal };
}

test("a successful switch updates ONLY the selector and audits from -> to", () => {
  const world = founderWorld();
  const result = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "asset.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.fromRole).toBe(null);
  expect(result.toRole).toBe("asset.manager");

  // RULE: role_switch_never_changes_tenant — same tenant, same principal,
  // same lifecycle fields; ONLY activeRole + lastSeenAt moved.
  expect(result.session.tenantId).toBe(TENANT_A);
  expect(result.session.principalId).toBe(`usr:${FOUNDER}`);
  expect(result.session.issuedAt).toBe(world.session.issuedAt);
  expect(result.session.expiresAt).toBe(world.session.expiresAt);
  expect(result.session.revokedAt).toBe(null);
  expect(result.session.lastSeenAt).toBe(T1);

  // The persisted record carries the new selector.
  expect(world.sessions.getSession(world.ctxA, world.session.sessionId)!.activeRole).toBe("asset.manager");

  // RULE: role_switch_is_audited.
  const switched = world.audit.records.filter((r) => r.action === "identity.role.switched");
  expect(switched.length).toBe(1);
  expect(switched[0]!.details["fromRole"]).toBe(null);
  expect(switched[0]!.details["toRole"]).toBe("asset.manager");
  expect(switched[0]!.details["tenantUnchanged"]).toBe(true);
  expect(switched[0]!.details["assignedRoles"]).toEqual(["asset.manager", "employee", "fleet.admin"]);
});

test("an idempotent switch (same target) STILL audits — every switch writes the trail", () => {
  const world = founderWorld();
  const input = {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "asset.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  };
  world.switchService.switchActiveRole(world.ctxA, input);
  const second = world.switchService.switchActiveRole(world.ctxA, input);
  expect(second.ok).toBe(true);
  if (second.ok) {
    expect(second.fromRole).toBe("asset.manager");
    expect(second.toRole).toBe("asset.manager");
  }
  expect(world.audit.records.filter((r) => r.action === "identity.role.switched").length).toBe(2);
});

test("switching to an UNASSIGNED role refuses with role_not_assigned + a denied audit record", () => {
  const world = founderWorld();
  const result = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "vendor.operator",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("role_not_assigned");
  // The selector never moved.
  expect(world.sessions.getSession(world.ctxA, world.session.sessionId)!.activeRole).toBe(null);
  // The refusal audited.
  const denied = world.audit.records.filter((r) => r.action === "identity.role.switch_denied");
  expect(denied.length).toBe(1);
  expect(denied[0]!.details["reasons"]).toEqual(["role_not_assigned", "vendor.operator"]);
});

test("switching to an UNKNOWN role name refuses with role_unknown", () => {
  const world = founderWorld();
  const result = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "space.wizard",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("role_unknown");
  expect(world.audit.records.filter((r) => r.action === "identity.role.switch_denied").length).toBe(1);
});

test("RULE: a session belonging to ANOTHER tenant is refused — the switch NEVER changes tenant", () => {
  const world = founderWorld();
  // A session in tenant B for the same-looking principal id.
  const ctxB = makeTenantContext(TENANT_B, CORR);
  const bPrincipal = makeUserPrincipal(TENANT_B, FOUNDER);
  const bOpened = world.sessionService.openSession({
    now: T0,
    ttlSeconds: 604800,
    principal: bPrincipal,
    correlationId: CORR,
  });
  if (!bOpened.ok) throw new Error("open failed");
  world.assignments.addAssignment(ctxB, {
    tenantId: TENANT_B,
    principalId: `usr:${FOUNDER}`,
    roleName: "fleet.admin",
    assignedAt: T0,
    assignedBy: `usr:${FOUNDER}`,
  });

  // Acting in tenant A's context, switching tenant B's session: the
  // tenant-partitioned lookup CANNOT observe the foreign session — it is
  // indistinguishable from an unknown one (existence never leaks across
  // tenants), and the switch NEVER falls back to a cross-tenant write.
  const result = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: bOpened.session.sessionId,
    targetRole: "fleet.admin",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("session_unknown");
  // Tenant B's session is untouched.
  expect(world.sessions.getSession(ctxB, bOpened.session.sessionId)!.activeRole).toBe(null);
  // And the denial audited in the ACTING tenant (A).
  const denied = world.audit.records.filter((r) => r.action === "identity.role.switch_denied");
  expect(denied.length).toBe(1);
  expect(denied[0]!.tenantId).toBe(TENANT_A);
});

test("RULE: active_role_is_scoped_to_current_tenant — a foreign-tenant assignment never counts", () => {
  const world = founderWorld();
  const ctxB = makeTenantContext(TENANT_B, CORR);
  // JOINER has vendor.operator in tenant B ONLY.
  const joinerB = makeUserPrincipal(TENANT_B, JOINER);
  const joinerOpenedB = world.sessionService.openSession({
    now: T0,
    ttlSeconds: 604800,
    principal: joinerB,
    correlationId: CORR,
  });
  if (!joinerOpenedB.ok) throw new Error("open failed");
  world.assignments.addAssignment(ctxB, {
    tenantId: TENANT_B,
    principalId: `usr:${JOINER}`,
    roleName: "vendor.operator",
    assignedAt: T0,
    assignedBy: `usr:${FOUNDER}`,
  });

  // In tenant B the switch succeeds.
  const inB = world.switchService.switchActiveRole(ctxB, {
    now: T1,
    sessionId: joinerOpenedB.session.sessionId,
    targetRole: "vendor.operator",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(inB.ok).toBe(true);

  // The same principal in tenant A (with an assignment-less session)
  // cannot reach vendor.operator — the assignment is tenant-scoped.
  const joinerA = makeUserPrincipal(TENANT_A, JOINER);
  const joinerOpenedA = world.sessionService.openSession({
    now: T0,
    ttlSeconds: 604800,
    principal: joinerA,
    correlationId: CORR,
  });
  if (!joinerOpenedA.ok) throw new Error("open failed");
  const inA = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: joinerOpenedA.session.sessionId,
    targetRole: "vendor.operator",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(inA.ok).toBe(false);
  if (!inA.ok) expect(inA.reason).toBe("role_not_assigned");
});

test("an expired session refuses the switch (fail-closed on malformed expiry)", () => {
  const world = founderWorld();
  // Expire the session by switching past its expiry.
  const expired = world.switchService.switchActiveRole(world.ctxA, {
    now: T8,
    sessionId: world.session.sessionId,
    targetRole: "asset.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(expired.ok).toBe(false);
  if (!expired.ok) expect(expired.reason).toBe("session_expired");
});

test("a revoked session refuses the switch", () => {
  const world = founderWorld();
  world.sessionService.revokeSession(world.ctxA, world.session.sessionId, T1, CORR);
  const result = world.switchService.switchActiveRole(world.ctxA, {
    now: T2,
    sessionId: world.session.sessionId,
    targetRole: "asset.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("session_revoked");
});

test("an expired ROLE ASSIGNMENT no longer authorizes the switch (time-boxed roles)", () => {
  const world = founderWorld();
  // Give the founder a time-boxed team.manager assignment that expires at T1.
  world.assignments.addAssignment(world.ctxA, {
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "team.manager",
    assignedAt: T0,
    assignedBy: `usr:${FOUNDER}`,
    expiresAt: T1,
  });
  const before = world.switchService.switchActiveRole(world.ctxA, {
    now: "2026-10-01T09:30:00Z",
    sessionId: world.session.sessionId,
    targetRole: "team.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(before.ok).toBe(true);
  // After expiry the same switch refuses.
  const after = world.switchService.switchActiveRole(world.ctxA, {
    now: "2026-10-01T12:30:00Z",
    sessionId: world.session.sessionId,
    targetRole: "team.manager",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  expect(after.ok).toBe(false);
  if (!after.ok) expect(after.reason).toBe("role_not_assigned");
});

test("clearActiveRole nulls the selector, keeps the tenant, and audits the transition", () => {
  const world = founderWorld();
  world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "fleet.admin",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  const cleared = world.switchService.clearActiveRole(world.ctxA, {
    now: T2,
    sessionId: world.session.sessionId,
    correlationId: CORR,
  });
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) throw new Error("unreachable");
  expect(cleared.session.activeRole).toBe(null);
  expect(cleared.session.tenantId).toBe(TENANT_A);
  expect(cleared.fromRole).toBe("fleet.admin");
  expect(cleared.toRole).toBe(null);
  // The clear audited as a switch to null.
  const audits = world.audit.records.filter((r) => r.action === "identity.role.switched");
  expect(audits[audits.length - 1]!.details["toRole"]).toBe(null);
});

test("RULE: experience_profiles_do_not_grant_permissions — the selector never widens the fold", () => {
  const world = founderWorld();
  const assignments = world.assignments.listAssignments(world.ctxA);

  const neutral = projectRoleAwareSession(world.session, assignments, ROLE_DEFS, T1);
  // Set the selector to fleet.admin WITHOUT any new assignment.
  const switched = world.switchService.switchActiveRole(world.ctxA, {
    now: T1,
    sessionId: world.session.sessionId,
    targetRole: "fleet.admin",
    roleDefinitions: ROLE_DEFS,
    correlationId: CORR,
  });
  if (!switched.ok) throw new Error("unreachable");
  const withSelector = projectRoleAwareSession(switched.session, assignments, ROLE_DEFS, T1);

  expect(withSelector.activeRole).toBe("fleet.admin");
  expect(neutral.activeRole).toBe(null);
  // The authoritative sets are IDENTICAL — the selector changed nothing.
  expect(withSelector.assignedRoles).toEqual(neutral.assignedRoles);
  expect(withSelector.effectivePermissions).toEqual(neutral.effectivePermissions);
  expect(withSelector.effectivePermissions).toEqual([
    "device.read",
    "procurement.order.create",
    "workload.read",
  ]);
});

test("the role-aware projection discloses skipped assignments for auditability", () => {
  const world = founderWorld();
  // An assignment for a role with NO definition in the tenant's catalog.
  world.assignments.addAssignment(world.ctxA, {
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "ghost.role",
    assignedAt: T0,
    assignedBy: `usr:${FOUNDER}`,
  });
  const assignments = world.assignments.listAssignments(world.ctxA);
  const projection = projectRoleAwareSession(world.session, assignments, ROLE_DEFS, T1);
  expect(projection.skipped).toEqual([{ roleName: "ghost.role", reason: "unknown_role" }]);
});

test("roleSwitchRefusalError projects an AuthorizationError-shaped FleetError", () => {
  const error = roleSwitchRefusalError({
    reason: "role_not_assigned",
    message: "nope",
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
  });
  expect(error.kind).toBe("AuthorizationError");
  expect(error.code).toBe("identity.role.switch.role_not_assigned");
  if (error.kind === "AuthorizationError") {
    expect(error.reason).toBe("role_not_assigned");
    expect(error.principalId).toBe(`usr:${FOUNDER}`);
    expect(error.action).toBe("identity.role.switch");
  }
});
