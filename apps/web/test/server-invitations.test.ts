/**
 * W147 — the server-side workspace-invitation issuance plane tests.
 *
 * Pins the J3 invite path: an authenticated operator session (httpOnly
 * cookie) issues a high-entropy workspace-join code (the W130 shape:
 * base32, ~100-bit body; verifier-only persistence; display-once). The
 * durable `fleetos_workspace_invitations` table gains a REAL row (the
 * J3 residual blocker's durable-store proof — the table was EMPTY
 * across all tenants before this boundary existed).
 *
 * Follows the W140 fake-seam pattern (FakeDurableDriver + handler-direct
 * calls — deterministic, no network).
 */
import { describe, expect, test } from "bun:test";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import { createDurableAuditLog } from "@fleetos/audit";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { handleIssueInvitation, INVITATION_TTL_SECONDS } from "../src/server/server-invitations";
import { handleServerSignIn } from "../src/server/server-sessions";
import { createServerEntropy } from "../src/server/server-entropy";
import { isJoinCodeShape } from "../src/server/server-entropy";
import { FakeDurableDriver } from "./server-fake-driver";
import { seedWorkspace } from "./server-test-seed";

const TENANT = "tnt_w147inv0001";
const OTHER = "tnt_w147inv0002";
const DEMO = "tnt_w091demo000001";
const NOW = "2026-10-05T12:00:00Z";

const deps = { now: NOW, correlationId: asCorrelationId("cor_w147inv0001") };

async function seededDriver(): Promise<FakeDurableDriver> {
  const driver = new FakeDurableDriver();
  await seedWorkspace(driver, {
    tenantId: TENANT,
    name: "W147 Invite Fleet",
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

async function operatorCookie(
  driver: FakeDurableDriver,
  tenantId = TENANT,
  email = "admin@example.com",
  password = "correct-horse-battery",
): Promise<string> {
  const response = await handleServerSignIn(new Request("http://localhost/api/session", {
    method: "POST",
    body: JSON.stringify({ tenantId, email, password }),
  }), { ...deps, driver, entropy: createServerEntropy() });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!;
}

async function issueInvitation(
  driver: FakeDurableDriver,
  cookie: string,
): Promise<Response> {
  return handleIssueInvitation(new Request("http://localhost/api/workspace/invitations", {
    method: "POST",
    headers: { cookie },
  }), { ...deps, driver, entropy: createServerEntropy() });
}

describe("W147 invitation issuance", () => {
  test("an operator issues a crypto-random W130-shape join code, persisted verifier-only, displayed exactly once", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const response = await issueInvitation(driver, cookie);
    expect(response.status).toBe(201);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const code = body["code"] as string;
    expect(isJoinCodeShape(code)).toBe(true);
    expect(code).toMatch(/^joinw[A-Z2-7]{20}$/);
    expect(body["expiresAt"]).toBe(new Date(Date.parse(NOW) + INVITATION_TTL_SECONDS * 1000).toISOString());
    expect(body["workspaceName"]).toBe("W147 Invite Fleet");

    // The durable invitations table gains a REAL row (the J3 durable-store proof).
    const rows = driver.allRows("fleetos_workspace_invitations");
    expect(rows).toHaveLength(1);
    // Verifier-only: the raw code NEVER appears in any row.
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.["tenant_id"]).toBe(TENANT);
    expect(rows[0]?.["used_at"]).toBeNull();

    // The audit trail carries the invitation-created action.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const log = createDurableAuditLog(scoped.store);
    const chain = log.records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w147inv0002")));
    expect(chain.map((r) => r.action)).toContain("identity.workspace.invitation_created");
    // The raw code never reaches the audit log either.
    expect(JSON.stringify(chain)).not.toContain(code);
  });

  test("join codes are high-entropy and tenant-unique (two issuances never collide)", async () => {
    const driver = await seededDriver();
    const cookie = await operatorCookie(driver);
    const codes = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const response = await issueInvitation(driver, cookie);
      const body = JSON.parse(await response.text()) as Record<string, unknown>;
      codes.add(body["code"] as string);
    }
    expect(codes.size).toBe(8);
    for (const code of codes) {
      expect(code).toMatch(/^joinw[A-Z2-7]{20}$/);
    }
    // The invitations table carries all 8 rows.
    expect(driver.allRows("fleetos_workspace_invitations").length).toBe(8);
  });

  test("the issuance refusal matrix (fail-closed)", async () => {
    const driver = await seededDriver();
    const adminCookie = await operatorCookie(driver);
    const viewerCookie = await operatorCookie(driver, TENANT, "viewer@example.com", "viewer-pass-12345");

    // No session cookie.
    const none = await handleIssueInvitation(new Request("http://localhost/api/workspace/invitations", {
      method: "POST",
    }), { ...deps, driver, entropy: createServerEntropy() });
    expect(JSON.parse(await none.text()).reason).toBe("unauthenticated");

    // A viewer role (vendor.operator) receives the frozen W130 denial.
    const viewer = await issueInvitation(driver, viewerCookie);
    expect(viewer.status).toBe(403);
    const viewerBody = JSON.parse(await viewer.text()) as Record<string, unknown>;
    expect(viewerBody["reason"]).toBe("interaction_forbidden");
    expect(viewerBody["message"]).toContain("cannot issue invitations");

    // A dead session cookie fails closed.
    const deadCookie = `fleetos_session=${TENANT}::fst_w147dead00000000000001`;
    const dead = await issueInvitation(driver, deadCookie);
    expect(JSON.parse(await dead.text()).reason).toBe("unauthenticated");
    // No rows were written by the refused attempts.
    expect(driver.allRows("fleetos_workspace_invitations").length).toBe(0);

    void adminCookie; // (the admin cookie is exercised above)
  });

  test("the demo tenant is never an invitation scope", async () => {
    const driver = new FakeDurableDriver();
    await seedWorkspace(driver, {
      tenantId: DEMO,
      name: "Demo",
      members: [{ email: "demo@example.com", displayName: "Demo", roles: ["fleet.admin"], password: "demo-pass-123456" }],
    });
    const demoCookie = await operatorCookie(driver, DEMO, "demo@example.com", "demo-pass-123456");
    const response = await issueInvitation(driver, demoCookie);
    expect(response.status).toBe(403);
    expect(JSON.parse(await response.text()).reason).toBe("invalid_scope");
    expect(driver.allRows("fleetos_workspace_invitations").length).toBe(0);
  });
});
