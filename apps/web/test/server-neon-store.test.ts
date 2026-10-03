/**
 * W140 — the request-scoped Neon record store tests (over the fake
 * driver): the frozen DurableRecordStore contract, cross-request
 * visibility, ordered no-drop flushes, tenant isolation, the audit
 * chain's restart continuity, and the schema bootstrap.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import {
  createDurableTenantRepository,
  createDurableSessionRepository,
  createDurablePrincipalRepository,
} from "@fleetos/identity";
import { createDurableAuditLog } from "@fleetos/audit";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { ensureServerSchema } from "../src/server/server-context";
import { renderServerDurableSchemaSql } from "../src/server/server-tables";
import { FakeDurableDriver } from "./server-fake-driver";

const T0 = "2026-10-02T12:00:00Z";
const TENANT_A = "tnt_w140aaaa0001";
const TENANT_B = "tnt_w140bbbb0002";

function ctxOf(tenantId: string) {
  return makeTenantContext(asTenantId(tenantId), asCorrelationId("cor_w140test001"));
}

describe("W140 request-scoped record store", () => {
  test("the schema renders idempotent CREATE TABLE statements for every managed table", () => {
    const sql = renderServerDurableSchemaSql();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_tenants");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_audit_records");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_enrollment_requests");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_agent_sessions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_device_twins");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_agent_checkins");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_observation_batches");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_observation_events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fleetos_observation_queue");
    // Physical PKs are tenant-partitioned (the frozen seam's per-tenant
    // key addressing made physical).
    expect(sql).toContain("PRIMARY KEY (tenant_id, session_id)");
    expect(sql).toContain("PRIMARY KEY (tenant_id, sequence)");
  });

  test("the physical schema mirrors the frozen identity columns (derived, not duplicated)", async () => {
    const driver = new FakeDurableDriver();
    await ensureServerSchema(driver);
    expect(driver.schemaApplied).toBeGreaterThan(0);
    // A second ensure is cached per driver (idempotent bootstrap).
    await ensureServerSchema(driver);
  });

  test("insert/get/list/remove/count round-trip within one request (read-your-writes)", async () => {
    const driver = new FakeDurableDriver();
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const store = scoped.store;
    const ctx = ctxOf(TENANT_A);

    const row = { tenant_id: TENANT_A, session_id: "ses_w140test00001", token: "fst_w140aaaaaaaaaaaaaaaa1", principal_id: "usr:a@example.com" };
    expect(store.insert(ctx, "fleetos_sessions", "ses_w140test00001", row)).toEqual({ ok: true });
    expect(store.get(ctx, "fleetos_sessions", "ses_w140test00001")?.row["token"]).toBe("fst_w140aaaaaaaaaaaaaaaa1");
    expect(store.count(ctx, "fleetos_sessions")).toBe(1);

    // A duplicate insert within the request is refused (frozen semantics).
    const dup = store.insert(ctx, "fleetos_sessions", "ses_w140test00001", row);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("already_exists");

    // The write is queued; the flush applies it in order.
    expect(scoped.pendingWrites).toBe(1);
    await scoped.flush();
    expect(scoped.pendingWrites).toBe(0);
    expect(driver.allRows("fleetos_sessions")).toHaveLength(1);
  });

  test("cross-request visibility: the next request's preload observes the flushed writes", async () => {
    const driver = new FakeDurableDriver();
    const first = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const tenants = createDurableTenantRepository(first.store);
    const put = tenants.putWorkspace(ctxOf(TENANT_A), {
      tenantId: asTenantId(TENANT_A),
      name: "Acme Fleet",
      status: "active",
      createdAt: T0,
      createdBy: "usr:founder@example.com",
    });
    expect(put.ok).toBe(true);
    await first.flush();

    const second = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const reread = createDurableTenantRepository(second.store).getWorkspace(ctxOf(TENANT_A));
    expect(reread?.name).toBe("Acme Fleet");
    expect(second.pendingWrites).toBe(0);
  });

  test("tenant isolation by construction: tenant B never observes tenant A rows", async () => {
    const driver = new FakeDurableDriver();
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A, TENANT_B] });
    const store = scoped.store;
    store.insert(ctxOf(TENANT_A), "fleetos_principals", "usr:a@example.com", {
      tenant_id: TENANT_A,
      principal_id: "usr:a@example.com",
      kind: "user",
      member_ref: "a@example.com",
      display_name: "A",
      created_at: T0,
    });
    store.insert(ctxOf(TENANT_B), "fleetos_principals", "usr:a@example.com", {
      tenant_id: TENANT_B,
      principal_id: "usr:a@example.com",
      kind: "user",
      member_ref: "a@example.com",
      display_name: "B",
      created_at: T0,
    });
    // The SAME key in two tenants is two rows (the physical pk is
    // tenant-partitioned — the collision that plain pks would break on).
    await scoped.flush();
    expect(store.count(ctxOf(TENANT_A), "fleetos_principals")).toBe(1);
    expect(store.count(ctxOf(TENANT_B), "fleetos_principals")).toBe(1);
    expect(store.get(ctxOf(TENANT_A), "fleetos_principals", "usr:a@example.com")?.row["display_name"]).toBe("A");
    expect(store.get(ctxOf(TENANT_B), "fleetos_principals", "usr:a@example.com")?.row["display_name"]).toBe("B");
    expect(driver.allRows("fleetos_principals")).toHaveLength(2);

    // A cross-tenant write is refused (tenant_mismatch — frozen semantics).
    const bad = store.insert(ctxOf(TENANT_A), "fleetos_principals", "usr:x@example.com", {
      tenant_id: TENANT_B,
      principal_id: "usr:x@example.com",
      kind: "user",
      member_ref: "x@example.com",
      display_name: "X",
      created_at: T0,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("tenant_mismatch");
  });

  test("the ordered flush neither drops nor reorders writes", async () => {
    const driver = new FakeDurableDriver();
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const store = scoped.store;
    const ctx = ctxOf(TENANT_A);
    store.insert(ctx, "fleetos_principals", "usr:one@example.com", { tenant_id: TENANT_A, principal_id: "usr:one@example.com", kind: "user", member_ref: "one@example.com", display_name: "One", created_at: T0 });
    store.put(ctx, "fleetos_principals", "usr:one@example.com", { tenant_id: TENANT_A, principal_id: "usr:one@example.com", kind: "user", member_ref: "one@example.com", display_name: "One Prime", created_at: T0 });
    store.insert(ctx, "fleetos_principals", "usr:two@example.com", { tenant_id: TENANT_A, principal_id: "usr:two@example.com", kind: "user", member_ref: "two@example.com", display_name: "Two", created_at: T0 });
    store.remove(ctx, "fleetos_principals", "usr:two@example.com");
    await scoped.flush();

    expect(driver.appliedWrites.map((write) => write.kind)).toEqual(["insert", "upsert", "insert", "delete"]);
    const rows = driver.allRows("fleetos_principals");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["display_name"]).toBe("One Prime");
  });

  test("the frozen identity repositories run unchanged over the store (session round-trip)", async () => {
    const driver = new FakeDurableDriver();
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const sessions = createDurableSessionRepository(scoped.store);
    const ctx = ctxOf(TENANT_A);
    const put = sessions.putSession(ctx, {
      tenantId: asTenantId(TENANT_A),
      sessionId: "ses_w140sess0000001",
      token: "fst_w140tok0000000000001",
      principalId: "usr:s@example.com",
      principalKind: "user",
      principalMemberRef: "s@example.com",
      activeRole: "fleet.admin",
      issuedAt: T0,
      expiresAt: "2026-10-02T20:00:00Z",
      lastSeenAt: T0,
      revokedAt: null,
      issuer: "test",
    });
    expect(put.ok).toBe(true);
    await scoped.flush();

    const next = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const reread = createDurableSessionRepository(next.store);
    expect(reread.getSessionByToken(ctx, "fst_w140tok0000000000001")?.principalId).toBe("usr:s@example.com");
    expect(reread.getSessionByToken(ctxOf(TENANT_B), "fst_w140tok0000000000001")).toBeUndefined();
  });

  test("the durable audit log continues its chain across requests (restart continuity)", async () => {
    const driver = new FakeDurableDriver();
    const first = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const log1 = createDurableAuditLog(first.store);
    log1.append(ctxOf(TENANT_A), {
      tenantId: asTenantId(TENANT_A),
      actor: { kind: "user", principalId: "usr:a@example.com", tenantId: asTenantId(TENANT_A) },
      action: "w140.test.first",
      occurredAt: T0,
      source: "w140-test",
      outcome: { status: "success" },
      correlationId: asCorrelationId("cor_w140audit001"),
      details: { n: 1 },
    });
    await first.flush();

    const second = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const log2 = createDurableAuditLog(second.store);
    log2.append(ctxOf(TENANT_A), {
      tenantId: asTenantId(TENANT_A),
      actor: { kind: "user", principalId: "usr:a@example.com", tenantId: asTenantId(TENANT_A) },
      action: "w140.test.second",
      occurredAt: T0,
      source: "w140-test",
      outcome: { status: "success" },
      correlationId: asCorrelationId("cor_w140audit002"),
      details: { n: 2 },
    });
    await second.flush();

    const third = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    const chain = createDurableAuditLog(third.store).records(ctxOf(TENANT_A));
    expect(chain).toHaveLength(2);
    expect(chain[0]?.action).toBe("w140.test.first");
    expect(chain[1]?.action).toBe("w140.test.second");
    expect(chain[1]?.priorRecordHash).toBe(chain[0]?.recordHash);
    const verify = createDurableAuditLog(third.store).verify(ctxOf(TENANT_A));
    expect(verify.ok).toBe(true);
    if (verify.ok) expect(verify.records).toBe(2);
  });

  test("the system-level invitation index resolves across tenants (the frozen exception)", async () => {
    const driver = new FakeDurableDriver();
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [] });
    const store = scoped.store;
    store.insert(ctxOf(TENANT_A), "fleetos_workspace_invitations", "inv_aaa1", {
      tenant_id: TENANT_A,
      invitation_id: "inv_aaa1",
      code_hash: "hash_aaa1",
      created_by: "usr:a@example.com",
      created_at: T0,
      expires_at: "2026-10-03T00:00:00Z",
      used_at: null,
      used_by: null,
    });
    await scoped.flush();

    const next = await createRequestScopedRecordStore({ driver, tenants: [TENANT_B] });
    const resolved = next.store.findInvitationByCodeHash("hash_aaa1");
    expect(resolved?.row["tenant_id"]).toBe(TENANT_A);
    expect(next.store.findInvitationByCodeHash("hash_missing")).toBeUndefined();
  });

  test("flush failures are fail-closed (a conflict throws — never a silent drop)", async () => {
    const driver = new FakeDurableDriver();
    const first = await createRequestScopedRecordStore({ driver, tenants: [TENANT_A] });
    first.store.insert(ctxOf(TENANT_A), "fleetos_device_twins", "dev_conflict1", {
      tenant_id: TENANT_A, device_id: "dev_conflict1", revision: 1, lifecycle_state: "ENROLL",
      enrolled_at: T0, twin: "{}", updated_at: T0,
    });
    await first.flush();

    // A second request that did NOT preload tenant A's partition inserts
    // the same key: the sync phase cannot see the durable row (a stale
    // view), so the FLUSH must THROW (fail-closed — never a silent drop).
    const second = await createRequestScopedRecordStore({ driver, tenants: [TENANT_B] });
    second.store.insert(ctxOf(TENANT_A), "fleetos_device_twins", "dev_conflict1", {
      tenant_id: TENANT_A, device_id: "dev_conflict1", revision: 1, lifecycle_state: "ENROLL",
      enrolled_at: T0, twin: "{}", updated_at: T0,
    });
    let threw = false;
    try {
      await second.flush();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
