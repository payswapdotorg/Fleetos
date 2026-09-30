/**
 * W100C D2 — the workspace/tenant create/join lifecycle: the durable
 * happy paths, the machine-stable refusals, and the audit emissions.
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  createDurableInvitationRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableTenantRepository,
  createInMemoryDurableRecordStore,
  createInMemoryIdentityAuditSink,
  createWorkspaceLifecycleService,
  joinCodeHash,
  makeTenantContext,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const FOUNDER = asUserId("usr_founder0001");
const JOINER = asUserId("usr_joiner00001");
const CORR = asCorrelationId("cor_w100c_ws001");
const T0 = "2026-10-01T09:00:00Z";
const T1 = "2026-10-01T12:00:00Z";
const T2 = "2026-10-05T09:00:00Z";

function makeService() {
  const store = createInMemoryDurableRecordStore();
  const audit = createInMemoryIdentityAuditSink();
  const service = createWorkspaceLifecycleService({
    tenants: createDurableTenantRepository(store),
    principals: createDurablePrincipalRepository(store),
    assignments: createDurableRoleAssignmentRepository(store),
    invitations: createDurableInvitationRepository(store),
    auditSink: audit,
    generators: {
      tenantId: (() => {
        let n = 0;
        return () => {
          n += 1;
          return asTenantId(`tnt_gen${String(n).padStart(8, "0")}`);
        };
      })(),
      joinCode: (() => {
        let n = 0;
        return () => {
          n += 1;
          return `joincode${String(n).padStart(4, "0")}`;
        };
      })(),
    },
  });
  return { store, audit, service };
}

test("createWorkspace mints the tenant, persists founder + roles, and audits", () => {
  const { store, audit, service } = makeService();
  const result = service.createWorkspace({
    now: T0,
    name: "Acme Fleet",
    founderUserId: FOUNDER,
    founderDisplayName: "Founder Faye",
    initialRoles: ["fleet.admin", "asset.manager"],
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  const tenantId = result.tenantId;
  expect(tenantId).toBe(asTenantId("tnt_gen00000001"));

  // The workspace record is durable.
  const ctx = makeTenantContext(tenantId, CORR);
  const workspace = createDurableTenantRepository(store).getWorkspace(ctx);
  expect(workspace!.name).toBe("Acme Fleet");
  expect(workspace!.status).toBe("active");

  // The founder's membership + assignments are durable.
  const principals = createDurablePrincipalRepository(store);
  expect(principals.getPrincipal(ctx, `usr:${FOUNDER}`)!.displayName).toBe("Founder Faye");
  const assignments = createDurableRoleAssignmentRepository(store).listForPrincipal(ctx, `usr:${FOUNDER}`);
  expect(assignments.map((a) => a.roleName)).toEqual(["asset.manager", "fleet.admin"]);

  // One audit record for the creation.
  const created = audit.records.filter((r) => r.action === "identity.workspace.created");
  expect(created.length).toBe(1);
  expect(created[0]!.tenantId).toBe(tenantId);
  expect(created[0]!.actorPrincipalId).toBe(`usr:${FOUNDER}`);
  expect(created[0]!.details["initialRoles"]).toEqual(["asset.manager", "fleet.admin"]);
});

test("createWorkspace is deterministic for the same generator sequence", () => {
  const a = makeService();
  const b = makeService();
  const input = {
    now: T0,
    name: "Acme Fleet",
    founderUserId: FOUNDER,
    founderDisplayName: "Founder Faye",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  };
  expect(a.service.createWorkspace(input)).toEqual(b.service.createWorkspace(input));
});

test("the full create -> invite -> join lifecycle lands the joiner in the TARGET tenant", () => {
  const { store, audit, service } = makeService();
  const created = service.createWorkspace({
    now: T0,
    name: "Acme Fleet",
    founderUserId: FOUNDER,
    founderDisplayName: "Founder Faye",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  });
  const tenantId = created.tenantId;
  const ctx = makeTenantContext(tenantId, CORR);

  const issued = service.createInvitation(ctx, {
    now: T1,
    ttlSeconds: 60 * 60 * 24 * 7,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(issued.ok).toBe(true);
  const rawCode = issued.ok ? issued.issued.rawCode : "";

  // Only the HASH of the code is persisted.
  const invitations = createDurableInvitationRepository(store);
  const persisted = invitations.findInvitationByCodeHash(joinCodeHash(rawCode));
  expect(persisted).toBeDefined();
  expect(JSON.stringify(store.snapshot)).not.toContain(rawCode);

  // JOIN: the code resolves the tenant (never caller-supplied).
  const joined = service.joinWorkspace({
    now: T2,
    code: rawCode,
    userId: JOINER,
    displayName: "Joiner Jade",
    roles: ["employee", "team.manager"],
    correlationId: CORR,
  });
  expect(joined.ok).toBe(true);
  if (joined.ok) {
    expect(joined.tenantId).toBe(tenantId);
    expect(joined.principalId).toBe(`usr:${JOINER}`);
    expect(joined.assignments.map((a) => a.roleName)).toEqual(["employee", "team.manager"]);
    expect(joined.invitation!.usedAt).toBe(T2);
  }

  // The joiner's membership lives in the TARGET tenant.
  const principals = createDurablePrincipalRepository(store);
  expect(principals.getPrincipal(ctx, `usr:${JOINER}`)!.displayName).toBe("Joiner Jade");
  // The invitation is spent.
  expect(invitations.findInvitationByCodeHash(joinCodeHash(rawCode))!.usedAt).toBe(T2);

  // Audit: invitation created + workspace joined.
  expect(audit.records.filter((r) => r.action === "identity.workspace.invitation_created").length).toBe(1);
  const joinedAudits = audit.records.filter((r) => r.action === "identity.workspace.joined");
  expect(joinedAudits.length).toBe(1);
  expect(joinedAudits[0]!.tenantId).toBe(tenantId);
});

test("a used invitation cannot be redeemed twice (invitation_already_used)", () => {
  const { service } = makeService();
  const created = service.createWorkspace({
    now: T0,
    name: "Acme",
    founderUserId: FOUNDER,
    founderDisplayName: "F",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  });
  const ctx = makeTenantContext(created.tenantId, CORR);
  const issued = service.createInvitation(ctx, { now: T1, ttlSeconds: 604800, createdBy: `usr:${FOUNDER}`, correlationId: CORR });
  const rawCode = issued.ok ? issued.issued.rawCode : "";
  expect(
    service.joinWorkspace({ now: T2, code: rawCode, userId: JOINER, displayName: "J", roles: ["employee"], correlationId: CORR }).ok,
  ).toBe(true);
  const second = service.joinWorkspace({
    now: T2,
    code: rawCode,
    userId: asUserId("usr_other0000001"),
    displayName: "O",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.reason).toBe("invitation_already_used");
});

test("an expired invitation refuses with invitation_expired; malformed expiry is fail-closed", () => {
  const { store, service } = makeService();
  const created = service.createWorkspace({
    now: T0,
    name: "Acme",
    founderUserId: FOUNDER,
    founderDisplayName: "F",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  });
  const ctx = makeTenantContext(created.tenantId, CORR);
  const issued = service.createInvitation(ctx, { now: T1, ttlSeconds: 60, createdBy: `usr:${FOUNDER}`, correlationId: CORR });
  const rawCode = issued.ok ? issued.issued.rawCode : "";
  const expired = service.joinWorkspace({
    now: "2026-10-02T12:00:01Z",
    code: rawCode,
    userId: JOINER,
    displayName: "J",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(expired.ok).toBe(false);
  if (!expired.ok) expect(expired.reason).toBe("invitation_expired");

  // Fail-closed: an invitation whose expiry is malformed is expired.
  const invitations = createDurableInvitationRepository(store);
  const hash = joinCodeHash(rawCode);
  const malformed = invitations.findInvitationByCodeHash(hash)!;
  invitations.updateInvitation(ctx, { ...malformed, expiresAt: "not-a-time", usedAt: null, usedBy: null });
  const failClosed = service.joinWorkspace({
    now: T2,
    code: rawCode,
    userId: JOINER,
    displayName: "J",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(failClosed.ok).toBe(false);
  if (!failClosed.ok) expect(failClosed.reason).toBe("invitation_expired");
});

test("an unknown code refuses with invitation_unknown (existence never leaks)", () => {
  const { service } = makeService();
  const result = service.joinWorkspace({
    now: T2,
    code: "joincode9999",
    userId: JOINER,
    displayName: "J",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("invitation_unknown");
});

test("an existing membership refuses the join WITHOUT burning the invitation", () => {
  const { service } = makeService();
  const created = service.createWorkspace({
    now: T0,
    name: "Acme",
    founderUserId: FOUNDER,
    founderDisplayName: "F",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  });
  const ctx = makeTenantContext(created.tenantId, CORR);
  const issued = service.createInvitation(ctx, { now: T1, ttlSeconds: 604800, createdBy: `usr:${FOUNDER}`, correlationId: CORR });
  const rawCode = issued.ok ? issued.issued.rawCode : "";
  // The founder tries to join their own workspace.
  const result = service.joinWorkspace({
    now: T2,
    code: rawCode,
    userId: FOUNDER,
    displayName: "F",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("membership_already_exists");
  // The invitation is still unused.
  const reissued = service.joinWorkspace({
    now: T2,
    code: rawCode,
    userId: JOINER,
    displayName: "J",
    roles: ["employee"],
    correlationId: CORR,
  });
  expect(reissued.ok).toBe(true);
});

test("invalid join inputs refuse machine-stably", () => {
  const { service } = makeService();
  const noCode = service.joinWorkspace({ now: T2, code: "", userId: JOINER, displayName: "J", roles: ["employee"], correlationId: CORR });
  expect(noCode.ok).toBe(false);
  if (!noCode.ok) expect(noCode.reason).toBe("invalid_input");
  const noRoles = service.joinWorkspace({ now: T2, code: "joincode0001", userId: JOINER, displayName: "J", roles: [], correlationId: CORR });
  expect(noRoles.ok).toBe(false);
  if (!noRoles.ok) expect(noRoles.reason).toBe("invalid_input");
  const badNow = service.joinWorkspace({ now: "yesterday", code: "joincode0001", userId: JOINER, displayName: "J", roles: ["employee"], correlationId: CORR });
  expect(badNow.ok).toBe(false);
  if (!badNow.ok) expect(badNow.reason).toBe("invalid_input");
});

test("joinCodeHash is deterministic and injective across the reference vocabulary", () => {
  expect(joinCodeHash("joincode0001")).toBe(joinCodeHash("joincode0001"));
  expect(joinCodeHash("joincode0001")).not.toBe(joinCodeHash("joincode0002"));
  expect(joinCodeHash("joincode0001")).toMatch(/^jch_[0-9a-f]+$/);
});

test("a join writes the joiner's audit trail in the TARGET tenant's scope", () => {
  const { audit, service } = makeService();
  const created = service.createWorkspace({
    now: T0,
    name: "Acme",
    founderUserId: FOUNDER,
    founderDisplayName: "F",
    initialRoles: ["fleet.admin"],
    correlationId: CORR,
  });
  const ctx = makeTenantContext(created.tenantId, CORR);
  const issued = service.createInvitation(ctx, { now: T1, ttlSeconds: 604800, createdBy: `usr:${FOUNDER}`, correlationId: CORR });
  const rawCode = issued.ok ? issued.issued.rawCode : "";
  service.joinWorkspace({ now: T2, code: rawCode, userId: JOINER, displayName: "J", roles: ["employee"], correlationId: CORR });
  // EVERY audit record belongs to the single tenant of the lifecycle.
  for (const record of audit.records) {
    expect(record.tenantId).toBe(created.tenantId);
  }
  expect(audit.records.length).toBe(3); // created + invitation_created + joined
});
