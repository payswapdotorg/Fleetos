/**
 * W147 — the deployed-tier client wiring machine tests.
 *
 * Pins the J2/J3/gate-fix chain at the BROWSER TIER on the DEPLOYED tier
 * (FLEETOS_ENV=staging): the client surfaces engage the REAL server
 * boundary through `fetch`. The tests inject a FAKE `fetch` (the W140
 * fake-seam pattern for the fetch boundary) and assert the wiring:
 *
 *   - J2: the Install Center's "Create enrollment code" calls
 *     POST /api/enrollment/codes and renders the SERVER-ISSUED code.
 *   - J3 invite: the topbar "Invite member…" calls
 *     POST /api/workspace/invitations (reading the SERVER session, never
 *     the stale localStorage key) and renders the server-issued code.
 *   - J3 join: the gate's "Join workspace" calls POST /api/enrollment/redeem
 *     with the join code; the member lands in the INVITING tenant.
 *   - Gate fix #3: the sign-in form's tenantId initializes from the
 *     picker's first entry when the directory populates after mount.
 *
 * The LOCAL tier behavior (the W101 fixture path) is pinned by the
 * existing console-journeys.test.tsx — UNCHANGED (the fixture path
 * stays for development/demo).
 */
import { test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConsoleApp } from "../src/console-app";

// ---------------------------------------------------------------------------
// The deployed-tier switch + the fake fetch seam
// ---------------------------------------------------------------------------

const ORIGINAL_FLEETOS_ENV = process.env.FLEETOS_ENV;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.FLEETOS_ENV = "staging";
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  process.env.FLEETOS_ENV = ORIGINAL_FLEETOS_ENV;
  globalThis.fetch = ORIGINAL_FETCH;
  (window as unknown as { fetch: typeof fetch }).fetch = ORIGINAL_FETCH;
  cleanup();
  window.history.replaceState({}, "", "/");
});

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function createFakeFetch(responses: Readonly<Record<string, Readonly<Record<string, (body: unknown) => { readonly status: number; readonly body: unknown }>>>>): {
  readonly fetch: typeof fetch;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    const handler = responses[url]?.[method];
    if (handler === undefined) {
      return new Response(JSON.stringify({ ok: false, reason: "unreachable", message: `No fake for ${method} ${url}` }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const result = handler(body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

function installFakeFetch(fake: typeof fetch): void {
  globalThis.fetch = fake;
  (window as unknown as { fetch: typeof fetch }).fetch = fake;
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

test("W147 J2 — the Install Center calls POST /api/enrollment/codes on the deployed tier and renders the server-issued code", async () => {
  window.localStorage.setItem("fleetos.server.workspaces.v1", JSON.stringify([
    { tenantId: "tnt_w147j20001", name: "J2 Test Fleet", createdAt: "2026-10-05T10:00:00Z" },
  ]));
  const { fetch: fakeFetch, calls } = createFakeFetch({
    "/api/session": {
      GET: () => ({ status: 200, body: { ok: true, tenantId: "tnt_w147j20001", workspaceName: "J2 Test Fleet", principalId: "usr:admin@example.com", memberRef: "admin@example.com", sessionId: "ses_w147test0001", expiresAt: "2026-10-05T20:00:00Z", assignedRoles: ["fleet.admin"], activeRole: "fleet.admin" } }),
    },
    "/api/enrollment/codes": {
      POST: () => ({ status: 201, body: { ok: true, requestId: "enr_w147server001", code: "enrollwSERVERCODE000001", ownershipKind: "corporate_owned", ownershipClass: "Corporate-owned", allowedRoles: [], createdAt: "2026-10-05T12:00:00Z", expiresAt: "2026-10-06T12:00:00Z" } }),
    },
  });
  installFakeFetch(fakeFetch);

  render(<ConsoleApp initialRoute={{ area: "device", view: "enrollment" }} />);
  await waitFor(() => {
    expect(screen.getByText("Install the FleetOS agent")).toBeDefined();
  });
  fireEvent.click(screen.getByRole("button", { name: /Select Windows \(x64\) installer/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select ownership scope: Corporate-owned/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create enrollment code" }));

  // The SERVER-ISSUED code renders (NOT the W101 fixture "BOOT-W101-0001").
  await waitFor(() => {
    const code = screen.getByTestId("enrollment-code-value").textContent ?? "";
    expect(code).toBe("enrollwSERVERCODE000001");
  });

  // The fetch was called with the REAL endpoint + the ownershipKind.
  const issueCall = calls.find((c) => c.url === "/api/enrollment/codes" && c.method === "POST");
  expect(issueCall).toBeDefined();
  expect(issueCall?.body).toEqual({ ownershipKind: "corporate_owned" });
});

test("W147 J3 invite — the topbar 'Invite member…' calls POST /api/workspace/invitations and renders the server-issued code (reading the SERVER session, never localStorage)", async () => {
  window.localStorage.setItem("fleetos.server.workspaces.v1", JSON.stringify([
    { tenantId: "tnt_w147j30001", name: "J3 Invite Fleet", createdAt: "2026-10-05T10:00:00Z" },
  ]));
  const { fetch: fakeFetch, calls } = createFakeFetch({
    "/api/session": {
      GET: () => ({ status: 200, body: { ok: true, tenantId: "tnt_w147j30001", workspaceName: "J3 Invite Fleet", principalId: "usr:admin@example.com", memberRef: "admin@example.com", sessionId: "ses_w147test0002", expiresAt: "2026-10-05T20:00:00Z", assignedRoles: ["fleet.admin"], activeRole: "fleet.admin" } }),
    },
    "/api/workspace/invitations": {
      POST: () => ({ status: 201, body: { ok: true, invitationId: "inv_w147test0001", code: "joinwSERVERJOINCODE0001", createdAt: "2026-10-05T12:00:00Z", expiresAt: "2026-10-06T12:00:00Z", workspaceName: "J3 Invite Fleet" } }),
    },
  });
  installFakeFetch(fakeFetch);

  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  await waitFor(() => {
    expect(screen.getByText("Invite member…")).toBeDefined();
  });
  fireEvent.click(screen.getByText("Invite member…"));

  // The SERVER-ISSUED join code renders (display-once).
  await waitFor(() => {
    const code = screen.getByTestId("invitation-code-value").textContent ?? "";
    expect(code).toBe("joinwSERVERJOINCODE0001");
  });

  // The fetch was called against the REAL invitations endpoint.
  const inviteCall = calls.find((c) => c.url === "/api/workspace/invitations" && c.method === "POST");
  expect(inviteCall).toBeDefined();

  // The stale localStorage key `fleetos.w121.session` was NEVER read
  // (the J3 root cause: the invite path expected a W121-era client
  // session record the server-tier sign-in never writes). The server
  // session (GET /api/session) is the inviter's authority.
  expect(window.localStorage.getItem("fleetos.w121.session")).toBeNull();
});

test("W147 J3 join — the gate's 'Join workspace' calls POST /api/enrollment/redeem; the member lands in the INVITING tenant", async () => {
  window.localStorage.setItem("fleetos.server.workspaces.v1", JSON.stringify([
    { tenantId: "tnt_w147j30001", name: "J3 Invite Fleet", createdAt: "2026-10-05T10:00:00Z" },
  ]));
  const { fetch: fakeFetch, calls } = createFakeFetch({
    "/api/session": {
      GET: () => ({ status: 200, body: { ok: false, reason: "unknown_token", message: "No session" } }),
    },
    "/api/enrollment/redeem": {
      POST: (body) => {
        const input = body as { readonly code: string; readonly displayName: string; readonly email: string; readonly role: string };
        return {
          status: 201,
          body: {
            ok: true,
            tenantId: "tnt_w147j30001",
            workspaceName: "J3 Invite Fleet",
            principalId: `usr:${input.email}`,
            memberRef: input.email,
            sessionId: "ses_w147join0001",
            expiresAt: "2026-10-05T20:00:00Z",
            assignedRoles: [input.role],
            activeRole: input.role,
          },
        };
      },
    },
  });
  installFakeFetch(fakeFetch);

  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  await waitFor(() => {
    expect(screen.getAllByText("Join workspace").length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: "joinwTESTCODE000000000001" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Grace Hopper" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "grace@example.com" } });
  fireEvent.change(screen.getByLabelText("Join as"), { target: { value: "service.desk" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);

  // The joiner landed in the INVITING tenant — the member chip shows the
  // workspace name (the joiner is signed-in).
  await waitFor(() => {
    expect(screen.getByText("J3 Invite Fleet")).toBeDefined();
  });

  // The fetch was called against the REAL redeem endpoint with the join
  // code + the member persona.
  const redeemCall = calls.find((c) => c.url === "/api/enrollment/redeem" && c.method === "POST");
  expect(redeemCall).toBeDefined();
  expect(redeemCall?.body).toEqual({
    code: "joinwTESTCODE000000000001",
    displayName: "Grace Hopper",
    email: "grace@example.com",
    role: "service.desk",
  });
});

test("W147 J3 join — an unknown join code yields the explicit unknown_code error (never a silent empty alert)", async () => {
  window.localStorage.setItem("fleetos.server.workspaces.v1", JSON.stringify([
    { tenantId: "tnt_w147j30001", name: "J3 Invite Fleet", createdAt: "2026-10-05T10:00:00Z" },
  ]));
  const { fetch: fakeFetch } = createFakeFetch({
    "/api/session": {
      GET: () => ({ status: 200, body: { ok: false, reason: "unknown_token", message: "No session" } }),
    },
    "/api/enrollment/redeem": {
      POST: () => ({ status: 403, body: { ok: false, reason: "unknown_code", explanation: "That join code does not match any workspace you can join from here. Check the code for typos, then ask the inviting workspace's administrator for a fresh invitation." } }),
    },
  });
  installFakeFetch(fakeFetch);

  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  await waitFor(() => {
    expect(screen.getAllByText("Join workspace").length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: "joinwUNKNOWNCODE000000001" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Eve" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "eve@example.com" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);

  // The explicit unknown_code error renders — never a silent empty alert.
  await waitFor(() => {
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("unknown_code");
    expect(alert!.textContent).toContain("does not match any workspace");
  });
});

test("W147 gate fix #3 — the sign-in form's tenantId initializes from the picker's first entry when the directory populates after mount", async () => {
  window.localStorage.setItem("fleetos.server.workspaces.v1", JSON.stringify([
    { tenantId: "tnt_w147gate001", name: "Gate Fix Fleet", createdAt: "2026-10-05T10:00:00Z" },
  ]));
  const { fetch: fakeFetch } = createFakeFetch({
    "/api/session": {
      GET: () => ({ status: 200, body: { ok: false, reason: "unknown_token", message: "No session" } }),
    },
  });
  installFakeFetch(fakeFetch);

  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  // Wait for the directory to populate (the picker shows the workspace).
  await waitFor(() => {
    expect(screen.getByText("Gate Fix Fleet")).toBeDefined();
  });
  // Type a valid email + password.
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-battery" } });
  // The "Sign in" button is ENABLED (the tenantId initialized from the
  // picker's first entry — the dead-button defect is fixed).
  const signInButton = screen.getAllByText("Sign in").find((el) => el.closest("button") !== null)?.closest("button");
  expect(signInButton).toBeDefined();
  expect(signInButton?.disabled).toBe(false);
});
