/**
 * W140 — the server-issued session route tests: sign-in through the
 * identity password seam (httpOnly cookie; the token NEVER enters a
 * body), fail-closed resolution on every refusal path, audited
 * revocation — all against the REAL route handlers over the fake
 * driver.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createDurableAuditLog } from "@fleetos/audit";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import {
  handleServerSignIn,
  handleServerResolveSession,
  handleServerRevokeSession,
  SERVER_SESSION_COOKIE_NAME,
} from "../src/server/server-sessions";
import { createServerEntropy } from "../src/server/server-entropy";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { FakeDurableDriver } from "./server-fake-driver";
import { seedWorkspace } from "./server-test-seed";

const TENANT = "tnt_w140sess0001";
const OTHER = "tnt_w140sess0002";
const NOW = "2026-10-02T12:00:00Z";
const LATER = "2026-10-02T20:00:00Z"; // +8h = the session TTL boundary
const DRIVER = () => new FakeDurableDriver();

const deps = { now: NOW, correlationId: asCorrelationId("cor_w140sess0001") };

async function seededDriver(): Promise<FakeDurableDriver> {
  const driver = DRIVER();
  await seedWorkspace(driver, {
    tenantId: TENANT,
    name: "Session Fleet",
    members: [
      { email: "admin@example.com", displayName: "Admin", roles: ["fleet.admin"], password: "correct-horse-battery" },
      { email: "employee@example.com", displayName: "Employee", roles: ["employee"], password: "employee-pass-123" },
      { email: "norole@example.com", displayName: "No Role", roles: ["custom.role"], password: "norole-pass-1234" },
      { email: "nocred@example.com", displayName: "No Credential", roles: ["fleet.admin"] },
    ],
  });
  await seedWorkspace(driver, {
    tenantId: OTHER,
    name: "Other Fleet",
    members: [
      { email: "admin@example.com", displayName: "Other Admin", roles: ["fleet.admin"], password: "other-pass-12345" },
    ],
  });
  return driver;
}

function signInRequest(tenantId: string, email: string, password: string): Request {
  return new Request("http://localhost/api/session", {
    method: "POST",
    body: JSON.stringify({ tenantId, email, password }),
    headers: { "content-type": "application/json" },
  });
}

async function signInForCookie(driver: FakeDurableDriver): Promise<string> {
  const response = await handleServerSignIn(signInRequest(TENANT, "admin@example.com", "correct-horse-battery"), { ...deps, driver, entropy: createServerEntropy() });
  const cookie = response.headers.get("set-cookie");
  expect(cookie).not.toBeNull();
  return cookie!;
}

describe("W140 server sessions — sign-in (issuance)", () => {
  test("a correct sign-in opens a durable session and sets an httpOnly cookie (never the token in the body)", async () => {
    const driver = await seededDriver();
    const response = await handleServerSignIn(signInRequest(TENANT, "admin@example.com", "correct-horse-battery"), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["tenantId"]).toBe(TENANT);
    expect(body["principalId"]).toBe("usr:admin@example.com");
    expect(body["assignedRoles"]).toEqual(["fleet.admin"]);
    // The token value NEVER enters the body (the cookie is its only carrier).
    expect(JSON.stringify(body)).not.toContain("fst_");

    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain(`${SERVER_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).toContain(TENANT);
  });

  test("the machine-stable refusal matrix (fail-closed, one reason per path)", async () => {
    const driver = await seededDriver();
    const cases: readonly [string, Request, string][] = [
      ["unknown workspace", signInRequest("tnt_w140nosuch00", "admin@example.com", "correct-horse-battery"), "unknown_workspace"],
      ["unknown principal", signInRequest(TENANT, "ghost@example.com", "correct-horse-battery"), "unknown_principal"],
      ["wrong password", signInRequest(TENANT, "admin@example.com", "wrong-password-xxx"), "wrong_password"],
      ["member with no credential (unknown account)", signInRequest(TENANT, "nocred@example.com", "some-password-12345"), "unknown_account"],
      ["member of ANOTHER workspace (tenant A's verifier never matches tenant B's partition)", signInRequest(OTHER, "admin@example.com", "correct-horse-battery"), "wrong_password"],
      ["missing fields", new Request("http://localhost/api/session", { method: "POST", body: JSON.stringify({ tenantId: TENANT }) }), "invalid_input"],
      ["invalid json", new Request("http://localhost/api/session", { method: "POST", body: "{not json" }), "invalid_json"],
    ];
    for (const [name, request, reason] of cases) {
      const response = await handleServerSignIn(request, { ...deps, driver, entropy: createServerEntropy() });
      const body = JSON.parse(await response.text()) as Record<string, unknown>;
      expect(body["ok"]).toBe(false);
      expect(body["reason"]).toBe(reason);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.status).toBeGreaterThanOrEqual(400);
      void name;
    }
  });

  test("a member with no product experience role is refused machine-stably", async () => {
    const driver = await seededDriver();
    const response = await handleServerSignIn(signInRequest(TENANT, "norole@example.com", "norole-pass-1234"), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(403);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["reason"]).toBe("no_experience_role");
  });

  test("a revoked credential fails closed", async () => {
    const driver = await seededDriver();
    // Revoke the credential row directly through the store (the
    // operator-side revocation flow is a neighboring lane's item).
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const ctx = makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140sess0002"));
    const rows = scoped.store.list(ctx, "fleetos_password_credentials");
    const row = rows.find((entry) => entry.row["member_ref"] === "admin@example.com");
    expect(row).toBeDefined();
    scoped.store.put(ctx, "fleetos_password_credentials", row!.key, { ...row!.row, revoked_at: NOW });
    await scoped.flush();

    const response = await handleServerSignIn(signInRequest(TENANT, "admin@example.com", "correct-horse-battery"), { ...deps, driver, entropy: createServerEntropy() });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["reason"]).toBe("credential_revoked");
  });
});

describe("W140 server sessions — resolve (fail-closed on every path)", () => {
  test("the cookie session resolves and projects (never the token)", async () => {
    const driver = await seededDriver();
    const cookie = await signInForCookie(driver);
    const response = await handleServerResolveSession(new Request("http://localhost/api/session", {
      method: "GET",
      headers: { cookie },
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["workspaceName"]).toBe("Session Fleet");
    expect(JSON.stringify(body)).not.toContain("fst_");
  });

  test("no cookie, garbage cookie, unknown token, foreign tenant, expiry and revocation all fail closed", async () => {
    const driver = await seededDriver();
    const cookie = await signInForCookie(driver);
    const tokenPart = cookie.slice(`${SERVER_SESSION_COOKIE_NAME}=`.length).split(";")[0]!;

    const cases: readonly [string, string, string][] = [
      ["no cookie", "", "malformed_cookie"],
      ["garbage cookie", `${SERVER_SESSION_COOKIE_NAME}=garbage`, "malformed_cookie"],
      ["unknown token", `${SERVER_SESSION_COOKIE_NAME}=${TENANT}::fst_w140unknown0000000000001`, "unknown_token"],
      ["foreign tenant (the token is unknown in another tenant's partition)", `${SERVER_SESSION_COOKIE_NAME}=${OTHER}::${tokenPart.split("::")[1]}`, "unknown_token"],
    ];
    for (const [name, cookieHeader, reason] of cases) {
      const response = await handleServerResolveSession(new Request("http://localhost/api/session", {
        method: "GET",
        headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {},
      }), { ...deps, driver, entropy: createServerEntropy() });
      expect(response.status).toBe(401);
      const body = JSON.parse(await response.text()) as Record<string, unknown>;
      expect(body["reason"]).toBe(reason);
      void name;
    }

    // Expiry: resolve at the TTL boundary (>= expiry is expired).
    const expired = await handleServerResolveSession(new Request("http://localhost/api/session", {
      method: "GET",
      headers: { cookie },
    }), { ...deps, now: LATER, driver, correlationId: asCorrelationId("cor_w140sess0003"), entropy: createServerEntropy() });
    const expiredBody = JSON.parse(await expired.text()) as Record<string, unknown>;
    expect(expiredBody["reason"]).toBe("expired");

    // Revocation: sign out, then resolve refuses `revoked`.
    await handleServerRevokeSession(new Request("http://localhost/api/session", {
      method: "DELETE",
      headers: { cookie },
    }), { ...deps, driver, entropy: createServerEntropy() });
    const revoked = await handleServerResolveSession(new Request("http://localhost/api/session", {
      method: "GET",
      headers: { cookie },
    }), { ...deps, driver, entropy: createServerEntropy() });
    const revokedBody = JSON.parse(await revoked.text()) as Record<string, unknown>;
    expect(revokedBody["reason"]).toBe("revoked");
  });
});

describe("W140 server sessions — revoke (audited sign-out)", () => {
  test("sign-out revokes through the frozen seam, clears the cookie, and audits identity.session.revoked", async () => {
    const driver = await seededDriver();
    const cookie = await signInForCookie(driver);
    const response = await handleServerRevokeSession(new Request("http://localhost/api/session", {
      method: "DELETE",
      headers: { cookie },
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const log = createDurableAuditLog(scoped.store);
    const chain = log.records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140sess0004")));
    const actions = chain.map((record) => record.action);
    expect(actions).toContain("identity.session.opened");
    expect(actions).toContain("identity.session.revoked");
    expect(log.verify(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140sess0005"))).ok).toBe(true);
  });
});
