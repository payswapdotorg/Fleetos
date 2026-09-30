/**
 * W100C D3 — the durable session service: open/resolve/revoke, the
 * fail-closed time discipline, tenant-scoped token resolution, and the
 * active-role session semantics constants.
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  ACTIVE_ROLE_MATRIX_RULES,
  createDurableSessionRepository,
  createInMemoryDurableRecordStore,
  createInMemoryIdentityAuditSink,
  createSessionService,
  makeTenantContext,
  makeUserPrincipal,
  sessionBelongsToTenant,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const FOUNDER = asUserId("usr_founder0001");
const CORR = asCorrelationId("cor_w100c_sess001");
const T0 = "2026-10-01T09:00:00Z";
const T1 = "2026-10-01T12:00:00Z";
const T2 = "2026-10-02T09:00:00Z";
const T8 = "2026-10-08T09:00:00Z";

function makeSessionService() {
  const store = createInMemoryDurableRecordStore();
  const audit = createInMemoryIdentityAuditSink();
  const sessions = createDurableSessionRepository(store);
  const service = createSessionService({ sessions, auditSink: audit });
  return { store, audit, sessions, service };
}

test("openSession persists a durable record and audits identity.session.opened", () => {
  const { audit, sessions, service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const result = service.openSession({
    now: T0,
    ttlSeconds: 60 * 60 * 24 * 7,
    principal,
    initialActiveRole: "fleet.admin",
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");

  // The token conforms to the frozen opaque-token grammar.
  expect(result.session.token).toMatch(/^fst_[a-z0-9]{24,128}$/);
  // The active-role selector is recorded (presentation only).
  expect(result.session.activeRole).toBe("fleet.admin");

  const ctx = makeTenantContext(TENANT_A, CORR);
  const persisted = sessions.getSession(ctx, result.session.sessionId);
  expect(persisted!.activeRole).toBe("fleet.admin");
  expect(persisted!.expiresAt).toBe("2026-10-08T09:00:00.000Z");

  const opened = audit.records.filter((r) => r.action === "identity.session.opened");
  expect(opened.length).toBe(1);
  expect(opened[0]!.actorPrincipalId).toBe(`usr:${FOUNDER}`);
});

test("resolveSession returns the live record and touches lastSeenAt (never audited)", () => {
  const { audit, service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  const ctx = makeTenantContext(TENANT_A, CORR);

  const resolved = service.resolveSession(ctx, opened.session.token, T1);
  expect(resolved.ok).toBe(true);
  if (resolved.ok) {
    expect(resolved.session.sessionId).toBe(opened.session.sessionId);
    expect(resolved.session.lastSeenAt).toBe(T1);
  }
  // Resolution is bookkeeping, NOT consequential: no audit records.
  expect(audit.records.length).toBe(1); // only the open
});

test("resolveSession refuses expired sessions exactly at the expiry instant", () => {
  const { service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  const ctx = makeTenantContext(TENANT_A, CORR);
  expect(service.resolveSession(ctx, opened.session.token, T8).ok).toBe(false);
  const atExpiry = service.resolveSession(ctx, opened.session.token, T8);
  if (!atExpiry.ok) expect(atExpiry.reason).toBe("expired");
});

test("resolveSession is fail-closed on an unparseable now (invalid_now)", () => {
  const { service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  const ctx = makeTenantContext(TENANT_A, CORR);
  const result = service.resolveSession(ctx, opened.session.token, "later");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("invalid_now");
});

test("a malformed token refuses without a store lookup (malformed_token)", () => {
  const { service } = makeSessionService();
  const ctx = makeTenantContext(TENANT_A, CORR);
  const result = service.resolveSession(ctx, "not-a-token", T1);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("malformed_token");
});

test("a token issued in tenant A is UNKNOWN in tenant B (isolation by context)", () => {
  const { service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  const ctxB = makeTenantContext(TENANT_B, CORR);
  const result = service.resolveSession(ctxB, opened.session.token, T1);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("unknown_token");
});

test("revocation is permanent, audited once, and idempotent", () => {
  const { audit, service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  const ctx = makeTenantContext(TENANT_A, CORR);

  const revoked = service.revokeSession(ctx, opened.session.sessionId, T1, CORR);
  expect(revoked.ok).toBe(true);
  if (revoked.ok) expect(revoked.session.revokedAt).toBe(T1);

  // Resolution refuses.
  const resolved = service.resolveSession(ctx, opened.session.token, T2);
  expect(resolved.ok).toBe(false);
  if (!resolved.ok) expect(resolved.reason).toBe("revoked");

  // Re-revoking is a no-op (no second audit record).
  service.revokeSession(ctx, opened.session.sessionId, T8, CORR);
  expect(audit.records.filter((r) => r.action === "identity.session.revoked").length).toBe(1);
});

test("openSession refuses invalid inputs machine-stably", () => {
  const { service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const badTtl = service.openSession({ now: T0, ttlSeconds: 0, principal, correlationId: CORR });
  expect(badTtl.ok).toBe(false);
  if (!badTtl.ok) expect(badTtl.reason).toBe("invalid_input");
  const badNow = service.openSession({ now: "nope", ttlSeconds: 60, principal, correlationId: CORR });
  expect(badNow.ok).toBe(false);
  if (!badNow.ok) expect(badNow.reason).toBe("invalid_input");
});

test("the ACTIVE-ROLE matrix rules are encoded verbatim from the frozen YAML", () => {
  expect(ACTIVE_ROLE_MATRIX_RULES).toEqual([
    "experience_profiles_do_not_grant_permissions",
    "effective_permissions_come_from_identity_and_guardian",
    "active_role_is_scoped_to_current_tenant",
    "role_switch_is_audited",
    "role_switch_never_changes_tenant",
    "unavailable_capabilities_show_reason_and_escalation_path",
  ]);
});

test("sessionBelongsToTenant is the pure tenant-scope predicate", () => {
  const { service } = makeSessionService();
  const principal = makeUserPrincipal(TENANT_A, FOUNDER);
  const opened = service.openSession({ now: T0, ttlSeconds: 604800, principal, correlationId: CORR });
  if (!opened.ok) throw new Error("unreachable");
  expect(sessionBelongsToTenant(opened.session, TENANT_A)).toBe(true);
  expect(sessionBelongsToTenant(opened.session, TENANT_B)).toBe(false);
});
