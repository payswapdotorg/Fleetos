/**
 * W100C D1 — the in-memory reference DurableRecordStore: tenant
 * partitioning, tagged writes, validation, and the system-level
 * invitation-code resolver.
 */

import { test, expect } from "bun:test";
import { asTenantId, asCorrelationId } from "@fleetos/contracts";
import { makeTenantContext, TenantIsolationError } from "../../src/index";
import { createInMemoryDurableRecordStore } from "../../src/index";
import { DURABLE_KEY_SEPARATOR } from "../../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const CORR = asCorrelationId("cor_w100c_seam01");
const AT = "2026-10-01T09:00:00Z";

const ROW_A = { tenant_id: TENANT_A, name: "Workspace A", status: "active", created_at: AT, created_by: "usr:founder" };

test("insert/get roundtrip within one tenant partition", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const write = store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A);
  expect(write.ok).toBe(true);
  const read = store.get(ctxA, "fleetos_tenants", TENANT_A);
  expect(read).toBeDefined();
  expect(read!.row["name"]).toBe("Workspace A");
});

test("a duplicate insert is refused with already_exists (idempotency guard)", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  expect(store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A).ok).toBe(true);
  const dup = store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A);
  expect(dup.ok).toBe(false);
  if (!dup.ok) {
    expect(dup.reason).toBe("already_exists");
    expect(dup.error.code).toBe("identity.durable.already_exists");
  }
});

test("cross-tenant reads are impossible: tenant B cannot observe tenant A's rows", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A);
  expect(store.get(ctxB, "fleetos_tenants", TENANT_A)).toBeUndefined();
  expect(store.count(ctxB, "fleetos_tenants")).toBe(0);
  expect(store.list(ctxB, "fleetos_tenants")).toEqual([]);
});

test("a row whose tenant_id disagrees with the acting context is refused (tenant_mismatch)", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxB = makeTenantContext(TENANT_B, CORR);
  const write = store.insert(ctxB, "fleetos_tenants", TENANT_B, ROW_A);
  expect(write.ok).toBe(false);
  if (!write.ok) {
    expect(write.reason).toBe("tenant_mismatch");
    expect(write.error.kind).toBe("AuthorizationError");
  }
});

test("same-key writes in different tenants never interfere", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  store.put(ctxA, "fleetos_principals", "usr:user0001", { tenant_id: TENANT_A, principal_id: "usr:user0001", kind: "user", member_ref: "user0001", display_name: "A User", created_at: AT });
  store.put(ctxB, "fleetos_principals", "usr:user0001", { tenant_id: TENANT_B, principal_id: "usr:user0001", kind: "user", member_ref: "user0001", display_name: "B User", created_at: AT });
  expect(store.get(ctxA, "fleetos_principals", "usr:user0001")!.row["display_name"]).toBe("A User");
  expect(store.get(ctxB, "fleetos_principals", "usr:user0001")!.row["display_name"]).toBe("B User");
});

test("context-free access is rejected by the runtime guard", () => {
  const store = createInMemoryDurableRecordStore();
  expect(() => store.get(undefined as never, "fleetos_tenants", TENANT_A)).toThrow(TenantIsolationError);
  expect(() => store.insert(null as never, "fleetos_tenants", TENANT_A, ROW_A)).toThrow(TenantIsolationError);
});

test("list filters by key prefix and exact column equality, key-sorted deterministically", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  store.put(ctxA, "fleetos_role_assignments", "asn_a", { tenant_id: TENANT_A, assignment_id: "asn_a", principal_id: "usr:p1", role_name: "fleet.admin", assigned_at: AT, assigned_by: "usr:p0", expires_at: null });
  store.put(ctxA, "fleetos_role_assignments", "asn_b", { tenant_id: TENANT_A, assignment_id: "asn_b", principal_id: "usr:p1", role_name: "employee", assigned_at: AT, assigned_by: "usr:p0", expires_at: null });
  store.put(ctxA, "fleetos_role_assignments", "asn_c", { tenant_id: TENANT_A, assignment_id: "asn_c", principal_id: "usr:p2", role_name: "employee", assigned_at: AT, assigned_by: "usr:p0", expires_at: null });

  const forP1 = store.list(ctxA, "fleetos_role_assignments", { where: { principal_id: "usr:p1" } });
  expect(forP1.map((r) => r.row["assignment_id"])).toEqual(["asn_a", "asn_b"]);
  const prefixed = store.list(ctxA, "fleetos_role_assignments", { prefix: "asn_a" });
  expect(prefixed.map((r) => r.row["assignment_id"])).toEqual(["asn_a"]);
});

test("the invitation-code resolver finds an invitation across tenants by exact hash only", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  store.put(ctxA, "fleetos_workspace_invitations", "inv_1", {
    tenant_id: TENANT_A,
    invitation_id: "inv_1",
    code_hash: "jch_deadbeef",
    created_by: "usr:founder",
    created_at: AT,
    expires_at: "2026-10-02T09:00:00Z",
    used_at: null,
    used_by: null,
  });
  expect(store.findInvitationByCodeHash("jch_deadbeef")!.row["tenant_id"]).toBe(TENANT_A);
  expect(store.findInvitationByCodeHash("jch_other")).toBeUndefined();
  expect(store.findInvitationByCodeHash("")).toBeUndefined();
});

test("rows with non-durable values are rejected (flat rows only)", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  expect(() =>
    store.put(ctxA, "fleetos_tenants", TENANT_A, {
      ...ROW_A,
      nested: { nope: true } as never,
    }),
  ).toThrow(TypeError);
});

test("keys containing the separator are rejected (unambiguous key grammar)", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  expect(() => store.put(ctxA, "fleetos_tenants", `bad${DURABLE_KEY_SEPARATOR}key`, ROW_A)).toThrow(TypeError);
  expect(() => store.put(ctxA, "fleetos_tenants", "", ROW_A)).toThrow(TypeError);
});

test("remove is tenant-scoped; another tenant's remove is a no-op", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  const ctxB = makeTenantContext(TENANT_B, CORR);
  store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A);
  expect(store.remove(ctxB, "fleetos_tenants", TENANT_A)).toBe(false);
  expect(store.get(ctxA, "fleetos_tenants", TENANT_A)).toBeDefined();
  expect(store.remove(ctxA, "fleetos_tenants", TENANT_A)).toBe(true);
  expect(store.get(ctxA, "fleetos_tenants", TENANT_A)).toBeUndefined();
});

test("the snapshot accessor exposes frozen copies (never a mutation path)", () => {
  const store = createInMemoryDurableRecordStore();
  const ctxA = makeTenantContext(TENANT_A, CORR);
  store.insert(ctxA, "fleetos_tenants", TENANT_A, ROW_A);
  const rows = store.snapshot["fleetos_tenants"]![TENANT_A]!;
  expect(rows.length).toBe(1);
  expect(Object.isFrozen(rows)).toBe(true);
  expect(Object.isFrozen(rows[0]!.row)).toBe(true);
});
