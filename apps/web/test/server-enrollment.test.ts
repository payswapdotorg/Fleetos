/**
 * W140 — the server-side enrollment plane tests: crypto-random W130-
 * shape code issuance (verifier-only persistence, display-once),
 * tenant-scoped redemption with the full frozen refusal matrix (the
 * W130 law: cross-tenant codes are machine-stable code_not_found; the
 * demo tenant is never a scope), the REAL device record + membership +
 * trust issuance, and the audit trail.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createDurableAuditLog } from "@fleetos/audit";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import {
  handleIssueEnrollmentCode,
  handleRedeemEnrollmentCode,
  enrollmentCodeVerifier,
  AGENT_TRUST_TTL_MS,
} from "../src/server/server-enrollment";
import { ENROLLMENT_CODE_PATTERN, isEnrollmentCodeShape } from "../src/server/server-entropy";
import { handleServerSignIn, SERVER_SESSION_COOKIE_NAME } from "../src/server/server-sessions";
import { createServerEntropy } from "../src/server/server-entropy";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { FakeDurableDriver } from "./server-fake-driver";
import { seedWorkspace } from "./server-test-seed";

const TENANT = "tnt_w140enrl0001";
const OTHER = "tnt_w140enrl0002";
const DEMO = "tnt_w091demo000001";
const NOW = "2026-10-02T12:00:00Z";

const deps = { now: NOW, correlationId: asCorrelationId("cor_w140enrl0001") };

async function seededDriver(): Promise<FakeDurableDriver> {
  const driver = new FakeDurableDriver();
  await seedWorkspace(driver, {
    tenantId: TENANT,
    name: "Enroll Fleet",
    members: [
      { email: "admin@example.com", displayName: "Admin", roles: ["fleet.admin"], password: "correct-horse-battery" },
      { email: "viewer@example.com", displayName: "Viewer", roles: ["vendor.operator"], password: "viewer-pass-12345" },
    ],
  });
  await seedWorkspace(driver, {
    tenantId: OTHER,
    name: "Other Fleet",
    members: [
      { email: "boss@example.com", displayName: "Boss", roles: ["fleet.admin"], password: "other-pass-12345" },
    ],
  });
  return driver;
}

/** Sign in and return the cookie header. */
async function operatorCookie(driver: FakeDurableDriver, tenantId = TENANT, email = "admin@example.com", password = "correct-horse-battery"): Promise<string> {
  const response = await handleServerSignIn(new Request("http://localhost/api/session", {
    method: "POST",
    body: JSON.stringify({ tenantId, email, password }),
  }), { ...deps, driver, entropy: createServerEntropy() });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!;
}

async function issueCode(
  driver: FakeDurableDriver,
  cookie: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Response> {
  return handleIssueEnrollmentCode(new Request("http://localhost/api/enrollment/codes", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ ownershipKind: "corporate_owned", ...overrides }),
  }), { ...deps, driver, entropy: createServerEntropy() });
}

function redeemRequest(tenantId: string, requestId: string, code: string, deviceId: string): Request {
  return new Request("http://localhost/api/enrollment/redeem", {
    method: "POST",
    body: JSON.stringify({
      tenantId,
      requestId,
      code,
      deviceId,
      adapterFamily: "windows",
      hardware: { manufacturer: "Lenovo", model: "ThinkPad X1", serialNumber: "SN-001" },
    }),
  });
}

/** Issue an enrollment code through the REAL boundary and return the request id + code. */
async function issuedCode(driver: FakeDurableDriver, overrides: Readonly<Record<string, unknown>> = {}): Promise<{ readonly requestId: string; readonly code: string }> {
  const cookie = await operatorCookie(driver);
  const response = await issueCode(driver, cookie, overrides);
  const body = JSON.parse(await response.text()) as Record<string, unknown>;
  return { requestId: body["requestId"] as string, code: body["code"] as string };
}

describe("W140 enrollment issuance", () => {
  test("an operator issues a crypto-random W130-shape code, persisted verifier-only, displayed exactly once", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const response = await issueCode(driver, cookie);
    expect(response.status).toBe(201);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const code = body["code"] as string;
    expect(isEnrollmentCodeShape(code)).toBe(true);
    expect(code).toMatch(new RegExp(`^${ENROLLMENT_CODE_PATTERN}$`));
    expect(body["expiresAt"]).toBe(new Date(Date.parse(NOW) + 24 * 60 * 60 * 1000).toISOString());

    // Verifier-only persistence: the raw code never appears in ANY row
    // or audit record — only its verifier.
    const rows = driver.allRows("fleetos_enrollment_requests");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.["code_verifier"]).toBe(enrollmentCodeVerifier(TENANT, code));
    expect(rows[0]?.["status"]).toBe("pending");
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const log = createDurableAuditLog(scoped.store);
    const chain = log.records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140enrl0002")));
    expect(chain.map((r) => r.action)).toContain("enrollment.request.created");
    expect(JSON.stringify(chain)).not.toContain(code);
  });

  test("codes are high-entropy and tenant-unique (two issuances never collide)", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const codes = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const response = await issueCode(driver, cookie);
      const body = JSON.parse(await response.text()) as Record<string, unknown>;
      codes.add(body["code"] as string);
    }
    expect(codes.size).toBe(8);
    // ~100-bit base32 bodies: 20 chars from the unambiguous alphabet.
    for (const code of codes) {
      expect(code).toMatch(/^enrollw[A-Z2-7]{20}$/);
    }
  });

  test("the issuance refusal matrix (fail-closed)", async () => {
    const driver = await seededDriver();
    const adminCookie = await operatorCookie(driver);
    const viewerCookie = await operatorCookie(driver, TENANT, "viewer@example.com", "viewer-pass-12345");

    // No session cookie.
    const none = await handleIssueEnrollmentCode(new Request("http://localhost/api/enrollment/codes", {
      method: "POST",
      body: JSON.stringify({ ownershipKind: "corporate_owned" }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await none.text()).reason).toBe("unauthenticated");

    // A viewer role (vendor.operator) receives the frozen W130 denial.
    const viewer = await issueCode(driver, viewerCookie);
    expect(viewer.status).toBe(403);
    const viewerBody = JSON.parse(await viewer.text()) as Record<string, unknown>;
    expect(viewerBody["reason"]).toBe("interaction_forbidden");
    expect(viewerBody["message"]).toContain("cannot create enrollment codes");
    expect(viewerBody["message"]).toContain("Fleet Administrator or Service Desk");

    // A dead session cookie fails closed.
    const deadCookie = `${SERVER_SESSION_COOKIE_NAME}=${TENANT}::fst_w140dead00000000000001`;
    const dead = await issueCode(driver, deadCookie);
    expect(JSON.parse(await dead.text()).reason).toBe("unauthenticated");

    // Invalid ownership kind / ttl bounds.
    expect(JSON.parse(await (await issueCode(driver, adminCookie, { ownershipKind: "personal" })).text()).reason).toBe("invalid_input");
    expect(JSON.parse(await (await issueCode(driver, adminCookie, { ttlMs: 100 })).text()).reason).toBe("invalid_input");
    expect(JSON.parse(await (await issueCode(driver, adminCookie, { ttlMs: 8 * 24 * 60 * 60 * 1000 })).text()).reason).toBe("invalid_input");
  });

  test("role-restricted codes carry the allowed set; the demo tenant is never an issuance scope", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const restricted = await issueCode(driver, cookie, { allowedRoles: ["service.desk"] });
    const body = JSON.parse(await restricted.text()) as Record<string, unknown>;
    expect(body["allowedRoles"]).toEqual(["service.desk"]);

    // The demo tenant cannot issue (its sessions are never a scope).
    const demoSeeded = new FakeDurableDriver();
    await seedWorkspace(demoSeeded, {
      tenantId: DEMO,
      name: "Demo",
      members: [{ email: "demo@example.com", displayName: "Demo", roles: ["fleet.admin"], password: "demo-pass-123456" }],
    });
    const demoCookie = await operatorCookie(demoSeeded, DEMO, "demo@example.com", "demo-pass-123456");
    const demo = await issueCode(demoSeeded, demoCookie);
    expect(demo.status).toBe(403);
    expect(JSON.parse(await demo.text()).reason).toBe("invalid_scope");
  });
});

describe("W140 enrollment redemption", () => {
  test("a valid redemption creates the REAL device record + membership + trust record", async () => {
    const driver = await seededDriver();
    const { requestId, code } = await issuedCode(driver);
    const response = await handleRedeemEnrollmentCode(redeemRequest(TENANT, requestId, code, "dev_w140device001"), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(201);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["deviceId"]).toBe("dev_w140device001");
    const deviceView = body["device"] as Record<string, unknown>;
    expect(deviceView["lifecycleState"]).toBe("ENROLL");
    expect(deviceView["twinRevision"]).toBe(1);

    // The device record (the REAL domain twin) is durable.
    const twinRow = driver.findRow("fleetos_device_twins", { tenant_id: TENANT, device_id: "dev_w140device001" });
    expect(twinRow).toBeDefined();
    expect(twinRow?.["lifecycle_state"]).toBe("ENROLL");

    // The membership: the agt: principal through the identity repository.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const principalRow = scoped.store.get(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140enrl0003")), "fleetos_principals", "agt:dev_w140device001");
    expect(principalRow?.row["kind"]).toBe("agent");
    expect(principalRow?.row["member_ref"]).toBe("dev_w140device001");

    // The trust record: durable, device-scoped, 24h.
    const trustRows = driver.allRows("fleetos_agent_sessions");
    expect(trustRows).toHaveLength(1);
    expect(trustRows[0]?.["device_id"]).toBe("dev_w140device001");
    expect(trustRows[0]?.["expires_at"]).toBe(new Date(Date.parse(NOW) + AGENT_TRUST_TTL_MS).toISOString());
    const tokenView = body["sessionToken"] as Record<string, unknown>;
    expect(tokenView["value"]).toBe(trustRows[0]?.["token"]);

    // The request is fulfilled (one-time) and the audit trail carries it.
    const requestRow = driver.findRow("fleetos_enrollment_requests", { tenant_id: TENANT, request_id: requestId });
    expect(requestRow?.["status"]).toBe("fulfilled");
    expect(requestRow?.["fulfilled_device_id"]).toBe("dev_w140device001");
    const log = createDurableAuditLog(scoped.store);
    const actions = log.records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140enrl0004"))).map((r) => r.action);
    expect(actions).toContain("enrollment.request.created");
    expect(actions).toContain("enrollment.request.fulfilled");
  });

  test("the W130 law: a cross-tenant code is a machine-stable code_not_found (indistinguishable from unknown)", async () => {
    const driver = await seededDriver();
    const { requestId, code } = await issuedCode(driver);
    // Present tenant B's scope with tenant A's code.
    const cross = await handleRedeemEnrollmentCode(redeemRequest(OTHER, requestId, code, "dev_w140device002"), { ...deps, driver, entropy: createServerEntropy() });
    expect(cross.status).toBe(404);
    const body = JSON.parse(await cross.text()) as Record<string, unknown>;
    expect(body["reason"]).toBe("code_not_found");
    expect(body["explanation"]).toContain("not valid for your workspace");

    // An unknown request id and a wrong code produce the SAME refusal
    // (no existence side channel).
    const unknown = await handleRedeemEnrollmentCode(redeemRequest(TENANT, "enr_unknown0001", code, "dev_w140device003"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await unknown.text()).reason).toBe("code_not_found");
    const wrongCode = await handleRedeemEnrollmentCode(redeemRequest(TENANT, requestId, "enrollwWRONGCODEWRONGCODE1", "dev_w140device004"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await wrongCode.text()).reason).toBe("code_not_found");

    // Nothing was created by the refused attempts.
    expect(driver.allRows("fleetos_device_twins")).toHaveLength(0);
    expect(driver.allRows("fleetos_agent_sessions")).toHaveLength(0);
  });

  test("the demo tenant is never a redemption scope", async () => {
    const driver = await seededDriver();
    const { requestId, code } = await issuedCode(driver);
    const response = await handleRedeemEnrollmentCode(redeemRequest(DEMO, requestId, code, "dev_w140device005"), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(403);
    expect(JSON.parse(await response.text()).reason).toBe("invalid_scope");
  });

  test("expiry, one-time use, revocation, pre-assignment and duplicate enrollment refuse machine-stably", async () => {
    const driver = await seededDriver();

    // EXPIRED: issue with a minimal ttl, then redeem after it.
    const expired = await issuedCode(driver, { ttlMs: 60 * 1000 });
    const response = await handleRedeemEnrollmentCode(redeemRequest(TENANT, expired.requestId, expired.code, "dev_w140device006"), { ...deps, now: new Date(Date.parse(NOW) + 61 * 1000).toISOString(), driver, entropy: createServerEntropy() });
    expect(JSON.parse(await response.text()).reason).toBe("code_expired");
    // The observed expiry is persisted (short-lived is first-class).
    expect(driver.findRow("fleetos_enrollment_requests", { tenant_id: TENANT, request_id: expired.requestId })?.["status"]).toBe("expired");

    // ALREADY USED: redeem once, then again.
    const once = await issuedCode(driver);
    const first = await handleRedeemEnrollmentCode(redeemRequest(TENANT, once.requestId, once.code, "dev_w140device007"), { ...deps, driver, entropy: createServerEntropy() });
    expect(first.status).toBe(201);
    const second = await handleRedeemEnrollmentCode(redeemRequest(TENANT, once.requestId, once.code, "dev_w140device008"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await second.text()).reason).toBe("code_already_used");

    // REVOKED: set the status directly (the operator revoke UX is a
    // neighboring lane's item; the refusal path is the frozen law).
    const revoked = await issuedCode(driver);
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const ctx = makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140enrl0005"));
    const row = scoped.store.get(ctx, "fleetos_enrollment_requests", revoked.requestId);
    scoped.store.put(ctx, "fleetos_enrollment_requests", revoked.requestId, { ...row!.row, status: "revoked", revoked_at: NOW, revoked_reason: "operator test" });
    await scoped.flush();
    const refused = await handleRedeemEnrollmentCode(redeemRequest(TENANT, revoked.requestId, revoked.code, "dev_w140device009"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await refused.text()).reason).toBe("code_revoked");

    // DEVICE ALREADY ENROLLED: a second code, same device.
    const again = await issuedCode(driver);
    const duplicate = await handleRedeemEnrollmentCode(redeemRequest(TENANT, again.requestId, again.code, "dev_w140device007"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await duplicate.text()).reason).toBe("device_already_enrolled");

    // PRE-ASSIGNED DEVICE: the code is bound to another device.
    const bound = await issuedCode(driver, { deviceId: "dev_w140bound0001" });
    const other = await handleRedeemEnrollmentCode(redeemRequest(TENANT, bound.requestId, bound.code, "dev_w140device010"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await other.text()).reason).toBe("enrollment_refused_by_policy");
    // ...but the bound device redeems fine.
    const boundOk = await handleRedeemEnrollmentCode(redeemRequest(TENANT, bound.requestId, bound.code, "dev_w140bound0001"), { ...deps, driver, entropy: createServerEntropy() });
    expect(boundOk.status).toBe(201);

    // ROLE-RESTRICTED: no presenter role.
    const restricted = await issuedCode(driver, { allowedRoles: ["service.desk"] });
    const noRole = await handleRedeemEnrollmentCode(redeemRequest(TENANT, restricted.requestId, restricted.code, "dev_w140device011"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await noRole.text()).reason).toBe("tenant_role_mismatch");
    const withRole = await handleRedeemEnrollmentCode(new Request("http://localhost/api/enrollment/redeem", {
      method: "POST",
      body: JSON.stringify({
        tenantId: TENANT, requestId: restricted.requestId, code: restricted.code,
        deviceId: "dev_w140device012", adapterFamily: "macos", presenterRole: "service.desk",
        hardware: { manufacturer: "Apple", model: "MacBook Pro" },
      }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(withRole.status).toBe(201);
  });

  test("malformed redemptions are refused invalid_input (fail-closed)", async () => {
    const driver = await seededDriver();
    const missing = await handleRedeemEnrollmentCode(new Request("http://localhost/api/enrollment/redeem", {
      method: "POST",
      body: JSON.stringify({ tenantId: TENANT, code: "enrollwAAAAAAAAAAAAAAAAAA1" }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await missing.text()).reason).toBe("invalid_input");

    const badHardware = await handleRedeemEnrollmentCode(new Request("http://localhost/api/enrollment/redeem", {
      method: "POST",
      body: JSON.stringify({ tenantId: TENANT, requestId: "enr_x", code: "enrollwAAAAAAAAAAAAAAAAAA1", deviceId: "dev_x", adapterFamily: "windows", hardware: { manufacturer: "" } }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await badHardware.text()).reason).toBe("invalid_input");
  });
});

// ---------------------------------------------------------------------------
// W147 — the JOIN-CODE redemption path (the member-join plane)
// ---------------------------------------------------------------------------

describe("W147 join-code redemption", () => {
  /** Issue a join code through the invitations boundary and return it. */
  async function issuedJoinCode(driver: FakeDurableDriver): Promise<string> {
    const { handleIssueInvitation } = await import("../src/server/server-invitations");
    const cookie = await operatorCookie(driver);
    const response = await handleIssueInvitation(new Request("http://localhost/api/workspace/invitations", {
      method: "POST",
      headers: { cookie },
    }), { ...deps, driver, entropy: createServerEntropy() });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    return body["code"] as string;
  }

  function joinRequest(code: string, displayName: string, email: string, role: string): Request {
    return new Request("http://localhost/api/enrollment/redeem", {
      method: "POST",
      body: JSON.stringify({ code, displayName, email, role }),
    });
  }

  test("a valid join code redeems: the member lands in the INVITING tenant with the assigned role + a session cookie", async () => {
    const driver = await seededDriver();
    const code = await issuedJoinCode(driver);
    const response = await handleRedeemEnrollmentCode(
      joinRequest(code, "Grace Hopper", "grace@example.com", "service.desk"),
      { ...deps, driver, entropy: createServerEntropy() },
    );
    expect(response.status).toBe(201);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    // The joining member lands in the INVITING tenant (TENANT — where the
    // invitation was issued), never a caller-supplied tenant.
    expect(body["tenantId"]).toBe(TENANT);
    expect(body["workspaceName"]).toBe("Enroll Fleet");
    expect(body["memberRef"]).toBe("grace@example.com");
    expect(body["activeRole"]).toBe("service.desk");
    expect(body["assignedRoles"]).toEqual(["service.desk"]);
    // The session cookie is set (httpOnly — the joiner lands signed-in).
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("fleetos_session=");
    expect(setCookie).toContain("HttpOnly");

    // The membership is durable: the joining principal exists in TENANT.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const { createDurablePrincipalRepository } = await import("@fleetos/identity");
    const principals = createDurablePrincipalRepository(scoped.store);
    const { makeTenantContext } = await import("@fleetos/identity");
    const membership = principals
      .listPrincipals(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w147join01")))
      .find((p) => p.kind === "user" && p.memberRef === "grace@example.com");
    expect(membership).toBeDefined();
    expect(membership?.displayName).toBe("Grace Hopper");

    // The invitation is marked USED (single-use).
    const invRows = driver.allRows("fleetos_workspace_invitations");
    expect(invRows).toHaveLength(1);
    expect(invRows[0]?.["used_at"]).not.toBeNull();
    expect(invRows[0]?.["used_by"]).not.toBeNull();
  });

  test("an unknown join code is the explicit unknown_code (never a silent empty alert)", async () => {
    const driver = await seededDriver();
    // A code that MATCHES the join grammar (joinw + 20 base32 chars) but
    // doesn't resolve to any invitation — the explicit unknown_code.
    const response = await handleRedeemEnrollmentCode(
      joinRequest("joinwBBBBBBBBBBBBBBBBBBBB", "Eve", "eve@example.com", "employee"),
      { ...deps, driver, entropy: createServerEntropy() },
    );
    expect(response.status).toBe(403);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["reason"]).toBe("unknown_code");
    expect(body["explanation"]).toContain("does not match any workspace");
    // No membership was created by the refusal.
    expect(driver.allRows("fleetos_workspace_invitations")).toHaveLength(0);
  });

  test("the device-enrollment path is unchanged: an enroll code continues to the device handler (the dispatch is grammar-keyed)", async () => {
    const driver = await seededDriver();
    const { requestId, code } = await issuedCode(driver);
    // An enroll-code redemption (with deviceId/adapterFamily/hardware) still
    // works byte-identically — the join-code dispatch does NOT shift the
    // device-enrollment path.
    const response = await handleRedeemEnrollmentCode(redeemRequest(TENANT, requestId, code, "dev_w147device050"), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(201);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["deviceId"]).toBe("dev_w147device050");
  });
});

// ---------------------------------------------------------------------------
// W147 — the ENROLLMENT-CODE revocation path (DELETE /api/enrollment/codes)
// ---------------------------------------------------------------------------

describe("W147 enrollment-code revocation", () => {
  async function revokeCode(driver: FakeDurableDriver, cookie: string, requestId: string): Promise<Response> {
    const { handleRevokeEnrollmentCode } = await import("../src/server/server-enrollment");
    return handleRevokeEnrollmentCode(new Request("http://localhost/api/enrollment/codes", {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ requestId }),
    }), { ...deps, driver, entropy: createServerEntropy() });
  }

  test("an operator revokes a pending enrollment code (the 'Disable this code…' path)", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const { requestId, code } = await issuedCode(driver);
    const response = await revokeCode(driver, cookie, requestId);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["status"]).toBe("revoked");
    expect(body["revokedAt"]).toBe(NOW);

    // The durable record reflects the revoked status.
    const row = driver.findRow("fleetos_enrollment_requests", { tenant_id: TENANT, request_id: requestId });
    expect(row?.["status"]).toBe("revoked");
    expect(row?.["revoked_at"]).toBe(NOW);

    // A subsequent redemption of the revoked code (with the SAME code that
    // was issued) is code_revoked — the revocation is durable.
    const redeemAgain = await handleRedeemEnrollmentCode(redeemRequest(TENANT, requestId, code, "dev_w147device051"), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await redeemAgain.text()).reason).toBe("code_revoked");
  });

  test("the revocation refusal matrix (fail-closed)", async () => {
    const driver = await seededDriver();
    const adminCookie = await operatorCookie(driver);
    const viewerCookie = await operatorCookie(driver, TENANT, "viewer@example.com", "viewer-pass-12345");

    // No session cookie.
    const { handleRevokeEnrollmentCode } = await import("../src/server/server-enrollment");
    const none = await handleRevokeEnrollmentCode(new Request("http://localhost/api/enrollment/codes", {
      method: "DELETE",
      body: JSON.stringify({ requestId: "enr_x" }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await none.text()).reason).toBe("unauthenticated");

    // A viewer role cannot revoke.
    const { requestId } = await issuedCode(driver);
    const viewer = await revokeCode(driver, viewerCookie, requestId);
    expect(viewer.status).toBe(403);
    expect(JSON.parse(await viewer.text()).reason).toBe("interaction_forbidden");

    // An unknown requestId is code_not_found.
    const unknown = await revokeCode(driver, adminCookie, "enr_unknown0001");
    expect(JSON.parse(await unknown.text()).reason).toBe("code_not_found");

    // A fulfilled code cannot be revoked (it's already redeemed).
    const { requestId: fulfilledId, code: fulfilledCode } = await issuedCode(driver);
    const redeemed = await handleRedeemEnrollmentCode(redeemRequest(TENANT, fulfilledId, fulfilledCode, "dev_w147device060"), { ...deps, driver, entropy: createServerEntropy() });
    expect(redeemed.status).toBe(201);
    const fulfilledRevoke = await revokeCode(driver, adminCookie, fulfilledId);
    expect(JSON.parse(await fulfilledRevoke.text()).reason).toBe("code_already_used");
  });
});
