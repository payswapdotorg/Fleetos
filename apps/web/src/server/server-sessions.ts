/**
 * @fleetos/web — W140: the server-issued operator session service.
 *
 * SERVER-ONLY (apps/web/src/server). The server-side session lifecycle
 * over the ACCEPTED durable identity seams — the same frozen services
 * the development composition roots use (`@fleetos/identity`'s session
 * service, password-credential service, durable repositories) — bound
 * to the request-scoped Neon store:
 *
 *   - SIGN-IN (`handleServerSignIn`): workspace + member lookup,
 *     password verification through the identity password seam, then a
 *     durable session opened and set as an HTTPONLY server cookie (the
 *     token value NEVER enters a response body — the cookie is its
 *     only carrier).
 *   - RESOLVE (`handleServerResolveSession`): cookie → token → the
 *     frozen `resolveSession` — FAILS CLOSED on every refusal path
 *     (malformed cookie/token, unknown token, tenant mismatch,
 *     expiry, revocation — machine-stable reasons, HTTP 401).
 *   - REVOKE (`handleServerRevokeSession`): cookie → the frozen
 *     `revokeSession` (audited `identity.session.revoked`) → the
 *     cookie is cleared.
 *
 * Development tier behavior is UNCHANGED: the localStorage session
 * seam at the composition root stays the development path; these
 * handlers are the deployed-tier binding (the W144 composition wires
 * them at the composition root).
 *
 * No `any` in public signatures. Strict TS. The domain never reads a
 * clock — `now` arrives injected per request.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import {
  createDurableTenantRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableSessionRepository,
  createDurablePasswordCredentialRepository,
  createPasswordCredentialService,
  createSessionService,
  makeTenantContext,
} from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import { experienceRoleFromAssignment } from "@fleetos/web-product/src/role-bridge";
import { parseJsonBody, jsonResponse, refusalBody, stringField, frozen } from "./server-internal";
import { createServerPasswordHasher } from "./server-password-hasher";
import type { ServerHandlerDeps, ServerRequestContext } from "./server-context";
import { openServerRequest, flushOrRefuse } from "./server-context";

// ---------------------------------------------------------------------------
// The httpOnly session cookie
// ---------------------------------------------------------------------------

/** The server session cookie's name (frozen). */
export const SERVER_SESSION_COOKIE_NAME = "fleetos_session" as const;

/** The server session's TTL (one working session, mirroring the dev runtime). */
export const SERVER_SESSION_TTL_SECONDS = 60 * 60 * 8;

/** The cookie's value layout: `<tenantId>::<token>` (both grammar-safe). */
const COOKIE_SEPARATOR = "::";

/** The shape of the session projection returned on success (never the token). */
export interface ServerSessionProjection {
  readonly ok: true;
  readonly tenantId: string;
  readonly workspaceName: string;
  readonly principalId: string;
  readonly memberRef: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly assignedRoles: readonly string[];
  readonly activeRole: string | null;
}

/** The machine-stable refusal vocabulary of the server session routes. */
export type ServerSessionRefusal =
  | "invalid_json"
  | "invalid_input"
  | "unknown_workspace"
  | "unknown_principal"
  | "unknown_account"
  | "wrong_password"
  | "credential_revoked"
  | "no_experience_role"
  | "malformed_cookie"
  | "malformed_token"
  | "unknown_token"
  | "tenant_mismatch"
  | "expired"
  | "revoked"
  | "invalid_now"
  | "server_store_unavailable"
  | "server_store_write_failed"
  | "server_entropy_unavailable";

/** The HTTP status of each refusal (machine-stable). */
const REFUSAL_STATUS: Readonly<Record<string, number>> = frozen({
  invalid_json: 400,
  invalid_input: 400,
  malformed_cookie: 401,
  malformed_token: 401,
  unknown_workspace: 401,
  unknown_principal: 401,
  unknown_account: 401,
  wrong_password: 401,
  credential_revoked: 401,
  no_experience_role: 403,
  unknown_token: 401,
  tenant_mismatch: 401,
  expired: 401,
  revoked: 401,
  invalid_now: 400,
});

/** Build the refusal response for a session route. */
function refuse(reason: ServerSessionRefusal, message: string): Response {
  const status = REFUSAL_STATUS[reason] ?? 400;
  return jsonResponse(refusalBody(reason, message), status);
}

/** Serialize the session cookie (httpOnly — the token's ONLY carrier). */
export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.FLEETOS_ENV === "production" ? "; Secure" : "";
  return `${SERVER_SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAgeSeconds)}${secure}`;
}

/** The cleared-cookie header (sign-out / dead-token residue). */
function clearedSessionCookie(): string {
  return `${SERVER_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Parse the session cookie from a request (fail-closed on any garbage). */
export function parseSessionCookie(request: Request): { readonly tenantId: string; readonly token: string } | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${SERVER_SESSION_COOKIE_NAME}=`)) continue;
    const value = trimmed.slice(SERVER_SESSION_COOKIE_NAME.length + 1);
    const separator = value.indexOf(COOKIE_SEPARATOR);
    if (separator <= 0 || separator === value.length - COOKIE_SEPARATOR.length + 1) return undefined;
    const tenantId = value.slice(0, separator);
    const token = value.slice(separator + COOKIE_SEPARATOR.length);
    if (tenantId.length === 0 || token.length === 0) return undefined;
    return { tenantId, token };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The composed identity services over a request store
// ---------------------------------------------------------------------------

/** The frozen identity services bound to one request's store. */
interface IdentityServices {
  readonly ctx: (tenantId: string) => TenantContext;
  readonly workspaceName: (tenantId: string) => string | undefined;
  readonly membershipOf: (tenantId: string, email: string) => { readonly principalId: string } | undefined;
  readonly rolesOf: (tenantId: string, principalId: string) => readonly string[];
}

function bindIdentityServices(context: ServerRequestContext): IdentityServices {
  const store = context.store.store;
  const tenants = createDurableTenantRepository(store);
  const principals = createDurablePrincipalRepository(store);
  const assignments = createDurableRoleAssignmentRepository(store);
  return {
    ctx: (tenantId: string): TenantContext =>
      makeTenantContext(asTenantId(tenantId), context.deps.correlationId),
    workspaceName: (tenantId: string): string | undefined =>
      tenants.getWorkspace(makeTenantContext(asTenantId(tenantId), context.deps.correlationId))?.name,
    membershipOf: (tenantId: string, email: string) => {
      const ctx = makeTenantContext(asTenantId(tenantId), context.deps.correlationId);
      return principals
        .listPrincipals(ctx)
        .find((p) => p.kind === "user" && p.memberRef === email);
    },
    rolesOf: (tenantId: string, principalId: string): readonly string[] => {
      const ctx = makeTenantContext(asTenantId(tenantId), context.deps.correlationId);
      return assignments
        .listAssignments(ctx)
        .filter((a) => a.principalId === principalId)
        .map((a) => a.roleName);
    },
  };
}

// ---------------------------------------------------------------------------
// The reusable operator-session resolution (sync, over an open context)
// ---------------------------------------------------------------------------

/** A resolved operator session (the authenticated browser principal). */
export interface OperatorSessionResolution {
  readonly tenantId: string;
  readonly workspaceName: string;
  readonly principalId: string;
  readonly memberRef: string;
  readonly sessionId: string;
  readonly assignedRoles: readonly string[];
  readonly activeRole: string | null;
  readonly expiresAt: string;
}

/** The operator-session resolution result (fail-closed, machine-stable). */
export type OperatorSessionCheck =
  | { readonly ok: true; readonly session: OperatorSessionResolution }
  | { readonly ok: false; readonly reason: ServerSessionRefusal; readonly message: string };

/**
 * Resolve the request's cookie session over an ALREADY-OPEN server
 * request context (the enrollment-issuance path reuses this). The
 * frozen `resolveSession` semantics apply verbatim: unknown, expired,
 * revoked and mismatched tokens all fail closed.
 */
export function resolveOperatorSessionInContext(
  context: ServerRequestContext,
  request: Request,
): OperatorSessionCheck {
  const cookie = parseSessionCookie(request);
  if (cookie === undefined) {
    return { ok: false, reason: "malformed_cookie", message: "No server session cookie is present." };
  }
  const services = bindIdentityServices(context);
  const sessionService = createSessionService({
    sessions: createDurableSessionRepository(context.store.store),
  });
  const resolved = sessionService.resolveSession(
    services.ctx(cookie.tenantId),
    cookie.token,
    context.deps.now,
  );
  if (!resolved.ok) {
    const reason: ServerSessionRefusal =
      resolved.reason === "malformed_token"
        ? "malformed_token"
        : resolved.reason === "unknown_token"
          ? "unknown_token"
          : resolved.reason === "expired"
            ? "expired"
            : resolved.reason === "revoked"
              ? "revoked"
              : "invalid_now";
    return { ok: false, reason, message: `The server session was refused (${resolved.reason}).` };
  }
  const session = resolved.session;
  if (session.tenantId !== cookie.tenantId) {
    return { ok: false, reason: "tenant_mismatch", message: "The session token does not belong to this workspace." };
  }
  return {
    ok: true,
    session: frozen({
      tenantId: cookie.tenantId,
      workspaceName: services.workspaceName(cookie.tenantId) ?? cookie.tenantId,
      principalId: session.principalId,
      memberRef: session.principalMemberRef,
      sessionId: session.sessionId,
      assignedRoles: services.rolesOf(cookie.tenantId, session.principalId),
      activeRole: session.activeRole,
      expiresAt: session.expiresAt,
    }),
  };
}

// ---------------------------------------------------------------------------
// SIGN-IN (session issuance)
// ---------------------------------------------------------------------------

/**
 * POST /api/session — sign in through the accepted identity password
 * seam; on success the durable session token is set as an httpOnly
 * cookie (never in the body) and the session projection is returned.
 */
export async function handleServerSignIn(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;
  const tenantId = stringField(source, "tenantId");
  const email = stringField(source, "email");
  const password = typeof source["password"] === "string" ? source["password"] : undefined;
  if (tenantId === undefined || email === undefined || password === undefined || password.length === 0) {
    return refuse("invalid_input", "Sign-in requires a workspace id, an email and a password.");
  }

  const opened = await openServerRequest([tenantId], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const services = bindIdentityServices(context);
    const workspaceName = services.workspaceName(tenantId);
    if (workspaceName === undefined) {
      return refuse("unknown_workspace", `No workspace ${tenantId} exists on this server.`);
    }
    const membership = services.membershipOf(tenantId, email);
    if (membership === undefined) {
      return refuse("unknown_principal", `No member ${email} exists in ${workspaceName}.`);
    }

    // The password seam (the accepted identity service): machine-stable
    // unknown_account / wrong_password / credential_revoked refusals.
    const passwordService = createPasswordCredentialService({
      credentials: createDurablePasswordCredentialRepository(context.store.store),
      hasher: createServerPasswordHasher(),
    });
    const verified = passwordService.verifyCredential({
      tenantId: asTenantId(tenantId),
      memberRef: email,
      plainPassword: password,
      correlationId: context.deps.correlationId,
    });
    if (!verified.ok) {
      const reason: ServerSessionRefusal =
        verified.reason === "unknown_account"
          ? "unknown_account"
          : verified.reason === "wrong_password"
            ? "wrong_password"
            : verified.reason === "credential_revoked"
              ? "credential_revoked"
              : "invalid_input";
      return refuse(reason, `Sign-in refused (${verified.reason}): ${verified.message}`);
    }

    const assigned = services.rolesOf(tenantId, membership.principalId);
    if (!assigned.some((role) => experienceRoleFromAssignment(role) !== null)) {
      return refuse("no_experience_role", `${email} has no product role in ${workspaceName}.`);
    }

    // Open the durable session through the frozen session service (the
    // identity audit sink bridges the lifecycle events into the durable
    // hash-chained audit trail).
    const sessionService = createSessionService({
      sessions: createDurableSessionRepository(context.store.store),
      auditSink: context.audit.identitySink,
      generators: {
        token: () => `fst_w140s${context.deps.entropy.hex(19)}`,
        sessionId: () => `ses_w140s${context.deps.entropy.hex(16)}`,
      },
    });
    const principal = {
      kind: "user" as const,
      tenantId: asTenantId(tenantId),
      userId: email as never,
      principalId: membership.principalId,
    };
    const open = sessionService.openSession({
      now: context.deps.now,
      ttlSeconds: SERVER_SESSION_TTL_SECONDS,
      principal,
      initialActiveRole: assigned.find((r) => experienceRoleFromAssignment(r) !== null),
      issuer: "web.server-control-plane",
      correlationId: context.deps.correlationId,
    });
    if (!open.ok) {
      return refuse("invalid_input", `Session open refused (${open.reason}): ${open.message}`);
    }

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const projection: ServerSessionProjection = frozen({
      ok: true as const,
      tenantId,
      workspaceName,
      principalId: open.session.principalId,
      memberRef: open.session.principalMemberRef,
      sessionId: open.session.sessionId,
      expiresAt: open.session.expiresAt,
      assignedRoles: assigned,
      activeRole: open.session.activeRole,
    });
    return jsonResponse(projection, 200, {
      "set-cookie": sessionCookie(
        `${tenantId}${COOKIE_SEPARATOR}${open.session.token}`,
        SERVER_SESSION_TTL_SECONDS,
      ),
    });
  } catch {
    return refuse("server_store_unavailable", "The sign-in could not be completed; nothing was recorded.");
  }
}

// ---------------------------------------------------------------------------
// RESOLVE (fail-closed on every refusal path)
// ---------------------------------------------------------------------------

/**
 * GET /api/session — resolve the httpOnly cookie's session through the
 * frozen resolve seam. Fail-closed: every refusal is a machine-stable
 * 401 (unknown/mismatched/expired/revoked — never a fabricated session).
 */
export async function handleServerResolveSession(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const cookie = parseSessionCookie(request);
  if (cookie === undefined) {
    return refuse("malformed_cookie", "No server session cookie is present.");
  }
  const opened = await openServerRequest([cookie.tenantId], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const operator = resolveOperatorSessionInContext(context, request);
    if (!operator.ok) {
      return refuse(operator.reason, operator.message);
    }
    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const projection: ServerSessionProjection = frozen({
      ok: true as const,
      tenantId: operator.session.tenantId,
      workspaceName: operator.session.workspaceName,
      principalId: operator.session.principalId,
      memberRef: operator.session.memberRef,
      sessionId: operator.session.sessionId,
      expiresAt: operator.session.expiresAt,
      assignedRoles: operator.session.assignedRoles,
      activeRole: operator.session.activeRole,
    });
    return jsonResponse(projection, 200);
  } catch {
    return refuse("server_store_unavailable", "The session could not be resolved; nothing was recorded.");
  }
}

// ---------------------------------------------------------------------------
// REVOKE (sign-out)
// ---------------------------------------------------------------------------

/**
 * DELETE /api/session — revoke the cookie's session through the frozen
 * revoke seam (audited `identity.session.revoked`; idempotent) and
 * clear the cookie. Fail-closed: an unknown/foreign session refuses
 * machine-stably (the cookie is still cleared — dead residue never
 * resurrects).
 */
export async function handleServerRevokeSession(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const cookie = parseSessionCookie(request);
  if (cookie === undefined) {
    return jsonResponse(refusalBody("malformed_cookie", "No server session cookie is present."), 401, {
      "set-cookie": clearedSessionCookie(),
    });
  }
  const opened = await openServerRequest([cookie.tenantId], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const sessionService = createSessionService({
      sessions: createDurableSessionRepository(context.store.store),
      auditSink: context.audit.identitySink,
    });
    const resolved = sessionService.resolveSession(
      makeTenantContext(asTenantId(cookie.tenantId), context.deps.correlationId),
      cookie.token,
      context.deps.now,
    );
    if (resolved.ok) {
      sessionService.revokeSession(
        makeTenantContext(asTenantId(cookie.tenantId), context.deps.correlationId),
        resolved.session.sessionId,
        context.deps.now,
        context.deps.correlationId,
      );
    }
    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;
    return jsonResponse({ ok: true, revoked: true }, 200, {
      "set-cookie": clearedSessionCookie(),
    });
  } catch {
    return refuse("server_store_unavailable", "The sign-out could not be completed; nothing was recorded.");
  }
}

/** The server-plane correlation id of a request (diagnostics/tests). */
export function serverCorrelationOf(deps: ServerHandlerDeps): CorrelationId | undefined {
  return deps.correlationId;
}
