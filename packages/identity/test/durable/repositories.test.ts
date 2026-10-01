/**
 * W100C D2 — the durable repositories: record <-> row translation,
 * idempotent assignments, token uniqueness, tenant isolation.
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  createDurableInvitationRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableSessionRepository,
  createDurableTenantRepository,
  createInMemoryDurableRecordStore,
  makeRoleAssignment,
  makeTenantContext,
} from "../../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const FOUNDER = asUserId("usr_founder0001");
const JOINER = asUserId("usr_joiner00001");
const CORR = asCorrelationId("cor_w100c_repos01");
const AT = "2026-10-01T09:00:00Z";

function makeRepositories() {
  const store = createInMemoryDurableRecordStore();
  return {
    store,
    tenants: createDurableTenantRepository(store),
    principals: createDurablePrincipalRepository(store),
    assignments: createDurableRoleAssignmentRepository(store),
    sessions: createDurableSessionRepository(store),
    invitations: createDurableInvitationRepository(store),
  };
}

test("workspace records roundtrip through the tenant repository", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const record = {
    tenantId: TENANT_A,
    name: "Acme Fleet",
    status: "active" as const,
    createdAt: AT,
    createdBy: `usr:${FOUNDER}`,
  };
  expect(repos.tenants.putWorkspace(ctxA, record).ok).toBe(true);
  const read = repos.tenants.getWorkspace(ctxA);
  expect(read).toEqual(record);
  // Duplicate insert refuses.
  expect(repos.tenants.putWorkspace(ctxA, record).ok).toBe(false);
  // A foreign tenant sees nothing.
  expect(repos.tenants.getWorkspace(makeTenantContext(TENANT_B, CORR))).toBeUndefined();
});

test("principal memberships roundtrip and partition per tenant", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  repos.principals.putPrincipal(ctxA, {
    tenantId: TENANT_A,
    principalId: `usr:${JOINER}`,
    kind: "user",
    memberRef: JOINER,
    displayName: "Joiner One",
    createdAt: AT,
  });
  repos.principals.putPrincipal(ctxB, {
    tenantId: TENANT_B,
    principalId: `usr:${JOINER}`,
    kind: "user",
    memberRef: JOINER,
    displayName: "Joiner In B",
    createdAt: AT,
  });
  expect(repos.principals.getPrincipal(ctxA, `usr:${JOINER}`)!.displayName).toBe("Joiner One");
  expect(repos.principals.getPrincipal(ctxB, `usr:${JOINER}`)!.displayName).toBe("Joiner In B");
  expect(repos.principals.listPrincipals(ctxA).length).toBe(1);
});

test("role assignments are idempotent per (principal, role) and rehydrate as domain records", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const assignment = makeRoleAssignment({
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "fleet.admin",
    assignedAt: AT,
    assignedBy: `usr:${FOUNDER}`,
  });
  const first = repos.assignments.addAssignment(ctxA, assignment);
  expect(first.ok).toBe(true);
  if (first.ok) expect(first.deduped).toBe(false);
  const second = repos.assignments.addAssignment(ctxA, assignment);
  expect(second.ok).toBe(true);
  if (second.ok) expect(second.deduped).toBe(true);
  // Only ONE row exists.
  expect(repos.assignments.listAssignments(ctxA).length).toBe(1);
  // The rehydrated record equals the domain record.
  expect(repos.assignments.listAssignments(ctxA)[0]).toEqual(assignment);
});

test("assignments with expiry roundtrip (nullable expires_at)", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const assignment = makeRoleAssignment({
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "team.manager",
    assignedAt: AT,
    assignedBy: `usr:${FOUNDER}`,
    expiresAt: "2027-01-01T00:00:00Z",
  });
  repos.assignments.addAssignment(ctxA, assignment);
  const read = repos.assignments.listForPrincipal(ctxA, `usr:${FOUNDER}`);
  expect(read[0]!.expiresAt).toBe("2027-01-01T00:00:00Z");
});

test("cross-tenant assignment writes are refused with an AuthorizationError", () => {
  const repos = makeRepositories();
  const ctxB = makeTenantContext(TENANT_B, CORR);
  const foreign = makeRoleAssignment({
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    roleName: "fleet.admin",
    assignedAt: AT,
    assignedBy: `usr:${FOUNDER}`,
  });
  const result = repos.assignments.addAssignment(ctxB, foreign);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("AuthorizationError");
    expect(result.error.code).toBe("identity.assignment.tenant_mismatch");
  }
});

function sessionRecord(tenantId: typeof TENANT_A, sessionId: string, token: string) {
  return {
    tenantId,
    sessionId,
    token,
    principalId: `usr:${FOUNDER}`,
    principalKind: "user" as const,
    principalMemberRef: FOUNDER,
    activeRole: null as string | null,
    issuedAt: AT,
    expiresAt: "2026-10-08T09:00:00Z",
    lastSeenAt: AT,
    revokedAt: null as string | null,
    issuer: "identity.control-plane",
  };
}

test("sessions roundtrip; token lookup is tenant-scoped and unique", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  const record = sessionRecord(TENANT_A, "ses_1", "fst_w100c0000000000000001");
  expect(repos.sessions.putSession(ctxA, record).ok).toBe(true);
  expect(repos.sessions.getSessionByToken(ctxA, "fst_w100c0000000000000001")!.sessionId).toBe("ses_1");
  // The SAME token in tenant B is unknown (isolation).
  expect(repos.sessions.getSessionByToken(ctxB, "fst_w100c0000000000000001")).toBeUndefined();
  // A second session with the same token in tenant A refuses.
  const clash = repos.sessions.putSession(ctxA, sessionRecord(TENANT_A, "ses_2", "fst_w100c0000000000000001"));
  expect(clash.ok).toBe(false);
  if (!clash.ok) expect(clash.reason).toBe("already_exists");
});

test("session updates persist the active-role selector; updates refuse unknown sessions", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const record = sessionRecord(TENANT_A, "ses_1", "fst_w100c0000000000000001");
  repos.sessions.putSession(ctxA, record);
  const switched = { ...record, activeRole: "asset.manager" };
  expect(repos.sessions.updateSession(ctxA, switched).ok).toBe(true);
  expect(repos.sessions.getSession(ctxA, "ses_1")!.activeRole).toBe("asset.manager");
  expect(repos.sessions.updateSession(ctxA, { ...record, sessionId: "ses_9" }).ok).toBe(false);
});

test("invitation records roundtrip; the code-hash resolver is the cross-tenant seam", () => {
  const repos = makeRepositories();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const invitation = {
    tenantId: TENANT_A,
    invitationId: "inv_1",
    codeHash: "jch_00000001",
    createdBy: `usr:${FOUNDER}`,
    createdAt: AT,
    expiresAt: "2026-10-02T09:00:00Z",
    usedAt: null,
    usedBy: null,
  };
  expect(repos.invitations.putInvitation(ctxA, invitation).ok).toBe(true);
  const resolved = repos.invitations.findInvitationByCodeHash("jch_00000001");
  expect(resolved!.tenantId).toBe(TENANT_A);
  // The used-transition persists.
  const used = { ...invitation, usedAt: "2026-10-01T12:00:00Z", usedBy: `usr:${JOINER}` };
  expect(repos.invitations.updateInvitation(ctxA, used).ok).toBe(true);
  expect(repos.invitations.getInvitation(ctxA, "inv_1")!.usedBy).toBe(`usr:${JOINER}`);
});
