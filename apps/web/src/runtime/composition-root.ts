/**
 * @fleetos/web — W144: the composition root (the deployment-tier driver
 * selection — the deployment seam).
 *
 * The composition root selects the session/enrollment driver by the
 * deployment tier (declared by `FLEETOS_ENV`):
 *
 *   - DEVELOPMENT (the default): the LOCAL driver — the localStorage
 *     session seam (the W101/W121 browser tier; the demo/local path).
 *     Sessions resolve through the in-browser durable identity store;
 *     enrollment resolves through the install-center's local boundary.
 *
 *   - STAGING / PRODUCTION (the deployed tier): the SERVER driver — the
 *     W140 server-tier routes (/api/session httpOnly cookie;
 *     /api/enrollment/* through the real boundary). Sessions resolve
 *     through the server's identity services (Neon-backed); enrollment
 *     resolves through the server's enrollment handlers.
 *
 * FAIL-CLOSED on every refusal path: a server-tier request that
 * refuses (malformed cookie/token, unknown token, tenant mismatch,
 * expiry, revocation) returns the machine-stable refusal — never a
 * silent fallback to the local driver. The driver selection is PURE
 * with respect to the deployment tier (a function of `FLEETOS_ENV`
 * only — never a runtime value).
 *
 * The env module law: this module exposes secret NAMES only, never
 * VALUES (per `runtime/env.ts` — the deployment tier is a label, not
 * a credential; the server routes are paths, not secrets). No secret
 * value is read, logged, or transmitted by this module.
 *
 * No `any` in public signatures. Strict TS. Deterministic.
 */

import { fleetOsEnv } from "./env";
import type { FleetOsEnv } from "./env";

// ---------------------------------------------------------------------------
// The deployment tier (the driver selection's input)
// ---------------------------------------------------------------------------

/** The deployment tier label (the driver-selection predicate). */
export type DeploymentTier = "development" | "staging" | "production";

/** Resolve the deployment tier (a function of `FLEETOS_ENV` only). PURE. */
export function deploymentTier(): DeploymentTier {
  return fleetOsEnv();
}

/** Whether the acting tier is the deployed tier (server-driver). */
export function isDeployedTier(): boolean {
  const tier = deploymentTier();
  return tier === "staging" || tier === "production";
}

/** Whether the acting tier is the development tier (local-driver). */
export function isDevelopmentTier(): boolean {
  return deploymentTier() === "development";
}

// ---------------------------------------------------------------------------
// The driver kind (the composition root's selection)
// ---------------------------------------------------------------------------

/** The session/enrollment driver kind (the composition root's choice). */
export type SessionDriverKind = "local" | "server";

/**
 * Resolve the session driver kind for the acting deployment tier.
 *
 *   development  -> local (the localStorage seam — the W101/W121 path)
 *   staging      -> server (the W140 /api/session httpOnly cookie)
 *   production   -> server (the W140 /api/session httpOnly cookie)
 *
 * PURE: a function of `FLEETOS_ENV` only — never a runtime value.
 */
export function sessionDriverKind(): SessionDriverKind {
  return isDeployedTier() ? "server" : "local";
}

// ---------------------------------------------------------------------------
// The server-tier session routes (the deployed driver's HTTP paths)
// ---------------------------------------------------------------------------

/** The frozen server-tier session route paths (the deployed driver). */
export const SERVER_SESSION_ROUTES = Object.freeze({
  /** POST: sign in (workspace + email + password -> httpOnly cookie). */
  signIn: "/api/session" as const,
  /** GET: resolve (cookie -> session projection; fail-closed). */
  resolve: "/api/session" as const,
  /** DELETE: revoke (cookie -> cleared; audited). */
  revoke: "/api/session" as const,
} as const);

/** The frozen server-tier enrollment route paths (the deployed driver). */
export const SERVER_ENROLLMENT_ROUTES = Object.freeze({
  /** POST: issue an enrollment code (the REAL boundary). */
  issue: "/api/enrollment/codes" as const,
  /** POST: redeem an enrollment code OR a join code (the REAL boundary). */
  redeem: "/api/enrollment/redeem" as const,
  /** DELETE: revoke an enrollment code (W147 — the "Disable this code…" path). */
  revoke: "/api/enrollment/codes" as const,
} as const);

/** The frozen server-tier workspace-creation route (the deployed driver, W144). */
export const SERVER_WORKSPACE_ROUTES = Object.freeze({
  /** POST: create a workspace + founder session (the REAL identity boundary). */
  create: "/api/workspace" as const,
} as const);

/**
 * W147 — the frozen server-tier workspace-invitation route (the deployed
 * driver). POST issues a one-time join code (verifier-only persistence;
 * the code is returned exactly once for display).
 */
export const SERVER_INVITATION_ROUTES = Object.freeze({
  /** POST: issue a workspace-join code (the REAL identity boundary). */
  issue: "/api/workspace/invitations" as const,
} as const);

/** The frozen server-tier device route paths (the deployed driver, W145). */
export const SERVER_DEVICE_ROUTES = Object.freeze({
  /** POST: declare a manual device record (the durable W145 path). */
  declaredImport: "/api/device/declared-import" as const,
  /** GET: the tenant's durable twin list (the roster hydration source). */
  twins: "/api/device/twins" as const,
} as const);

/** The server session cookie's name (the httpOnly carrier; names only). */
export const SERVER_SESSION_COOKIE_NAME = "fleetos_session" as const;

// ---------------------------------------------------------------------------
// The server-tier driver's fetch-based client (the deployed path)
// ---------------------------------------------------------------------------

/** The server-tier session projection (the success response's body). */
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

/** The server-tier refusal (fail-closed — never a silent fallback). */
export interface ServerSessionRefusal {
  readonly ok: false;
  readonly reason: string;
  readonly message: string;
}

/** The server-tier resolve result (success | refusal). */
export type ServerSessionResolveResult = ServerSessionProjection | ServerSessionRefusal;

/**
 * Resolve the active session through the SERVER driver (the deployed
 * tier only — the httpOnly cookie carries the token; the server
 * resolves it through the REAL identity services). FAIL-CLOSED: any
 * refusal (malformed cookie/token, unknown token, tenant mismatch,
 * expiry, revocation) returns the machine-stable refusal — never a
 * silent fallback to the local driver.
 *
 * This function is the fetch-based client the composition root calls
 * when `sessionDriverKind() === "server"`. It is PURE with respect to
 * the injected fetch seam (deterministic tests inject their own).
 */
export async function resolveServerSession(
  fetchImpl: typeof fetch,
): Promise<ServerSessionResolveResult> {
  try {
    const response = await fetchImpl(SERVER_SESSION_ROUTES.resolve, {
      method: "GET",
      credentials: "include",
      headers: { "accept": "application/json" },
    });
    if (!response.ok) {
      const body = await response.json() as { readonly reason?: string; readonly message?: string };
      return {
        ok: false,
        reason: typeof body.reason === "string" ? body.reason : "unknown_refusal",
        message: typeof body.message === "string" ? body.message : "The server session refused.",
      };
    }
    const projection = await response.json() as ServerSessionProjection;
    if (projection.ok !== true || typeof projection.tenantId !== "string") {
      return {
        ok: false,
        reason: "malformed_projection",
        message: "The server session projection was malformed.",
      };
    }
    return projection;
  } catch {
    // A network/parse failure fails closed — never a silent fallback.
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The server session endpoint could not be reached.",
    };
  }
}

/** The server-tier sign-in input (the deployed driver's POST body). */
export interface ServerSignInInput {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

/** POST /api/session — sign in over the httpOnly-cookie plane (fail-closed). */
export async function serverSignIn(
  fetchImpl: typeof fetch,
  input: ServerSignInInput,
): Promise<ServerSessionResolveResult> {
  try {
    const response = await fetchImpl(SERVER_SESSION_ROUTES.signIn, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
      const projection = body as ServerSessionProjection;
      if (typeof projection.tenantId === "string") {
        return projection;
      }
    }
    const refusal = body as { reason?: string; message?: string } | null;
    return {
      ok: false,
      reason: typeof refusal?.reason === "string" ? refusal.reason : "unknown_refusal",
      message: typeof refusal?.message === "string" ? refusal.message : "The server sign-in refused.",
    };
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The server session endpoint could not be reached.",
    };
  }
}

/** The server-tier workspace-creation input (the deployed driver's POST body). */
export interface ServerCreateWorkspaceInput {
  readonly workspaceName: string;
  readonly founderDisplayName: string;
  readonly founderEmail: string;
  readonly password: string;
}

/** POST /api/workspace — create a workspace + founder session (fail-closed). */
export async function serverCreateWorkspace(
  fetchImpl: typeof fetch,
  input: ServerCreateWorkspaceInput,
): Promise<ServerSessionResolveResult> {
  try {
    const response = await fetchImpl(SERVER_WORKSPACE_ROUTES.create, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
      const projection = body as ServerSessionProjection;
      if (typeof projection.tenantId === "string") {
        return projection;
      }
    }
    const refusal = body as { reason?: string; message?: string } | null;
    return {
      ok: false,
      reason: typeof refusal?.reason === "string" ? refusal.reason : "unknown_refusal",
      message: typeof refusal?.message === "string" ? refusal.message : "The workspace creation refused.",
    };
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The workspace endpoint could not be reached.",
    };
  }
}

/** DELETE /api/session — revoke the cookie session (fail-closed, idempotent). */
export async function serverSignOut(
  fetchImpl: typeof fetch,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  try {
    await fetchImpl(SERVER_SESSION_ROUTES.revoke, {
      method: "DELETE",
      credentials: "include",
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "server_unreachable" };
  }
}

/**
 * Sign in through the SERVER driver (the deployed tier only). On
 * success, the server sets the httpOnly cookie (the token's only
 * carrier) and returns the session projection. FAIL-CLOSED.
 */
export async function signInViaServer(
  fetchImpl: typeof fetch,
  input: { readonly tenantId: string; readonly email: string; readonly password: string },
): Promise<ServerSessionResolveResult> {
  try {
    const response = await fetchImpl(SERVER_SESSION_ROUTES.signIn, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        tenantId: input.tenantId,
        email: input.email,
        password: input.password,
      }),
    });
    if (!response.ok) {
      const body = await response.json() as { readonly reason?: string; readonly message?: string };
      return {
        ok: false,
        reason: typeof body.reason === "string" ? body.reason : "unknown_refusal",
        message: typeof body.message === "string" ? body.message : "The server sign-in refused.",
      };
    }
    const projection = await response.json() as ServerSessionProjection;
    if (projection.ok !== true || typeof projection.tenantId !== "string") {
      return {
        ok: false,
        reason: "malformed_projection",
        message: "The server sign-in projection was malformed.",
      };
    }
    return projection;
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The server sign-in endpoint could not be reached.",
    };
  }
}

/**
 * Revoke the active session through the SERVER driver (the deployed
 * tier only). The server clears the httpOnly cookie and audits the
 * revocation. FAIL-CLOSED.
 */
export async function revokeServerSession(
  fetchImpl: typeof fetch,
): Promise<{ readonly ok: boolean; readonly reason?: string; readonly message?: string }> {
  try {
    const response = await fetchImpl(SERVER_SESSION_ROUTES.revoke, {
      method: "DELETE",
      credentials: "include",
      headers: { "accept": "application/json" },
    });
    if (!response.ok) {
      const body = await response.json() as { readonly reason?: string; readonly message?: string };
      return {
        ok: false,
        reason: typeof body.reason === "string" ? body.reason : "unknown_refusal",
        message: typeof body.message === "string" ? body.message : "The server revoke refused.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The server revoke endpoint could not be reached.",
    };
  }
}

// ---------------------------------------------------------------------------
// The deployment-tier label (the AppShell's identity chip — names only)
// ---------------------------------------------------------------------------

/**
 * The deployment-tier label (the driver-selection's human-readable
 * form). Exposed for the AppShell's environment chip — NAMES only,
 * never VALUES (per the env module law).
 */
export function deploymentTierLabel(): string {
  const tier = deploymentTier();
  if (tier === "production") return "production (server-tier session)";
  if (tier === "staging") return "staging (server-tier session — free tier, non-commercial)";
  return "development (local session)";
}

/**
 * The driver description (the composition root's selection, human-
 * readable). Exposed for diagnostics + the console's runtime info.
 */
export function sessionDriverDescription(): string {
  const kind = sessionDriverKind();
  if (kind === "server") {
    return `Server driver (${deploymentTier()}): sessions resolve through ${SERVER_SESSION_ROUTES.resolve} (httpOnly cookie); enrollment through ${SERVER_ENROLLMENT_ROUTES.issue} + ${SERVER_ENROLLMENT_ROUTES.redeem}.`;
  }
  return `Local driver (${deploymentTier()}): sessions resolve through the localStorage seam (the W101/W121 browser tier); enrollment through the install-center's local boundary.`;
}

// ---------------------------------------------------------------------------
// W147 — the server-tier invitation + join fetch helpers (the deployed path)
// ---------------------------------------------------------------------------

/** The server-tier invitation-issuance success body (the display-once code). */
export interface ServerInvitationIssuance {
  readonly ok: true;
  readonly invitationId: string;
  readonly code: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly workspaceName: string;
}

/** The server-tier invitation-issuance result (success | refusal). */
export type ServerInvitationResult = ServerInvitationIssuance | ServerSessionRefusal;

/**
 * W147 — POST /api/workspace/invitations — issue a workspace-join code
 * over the httpOnly-cookie plane (the inviter's operator session). The
 * raw code is returned exactly once for display. FAIL-CLOSED.
 */
export async function serverIssueInvitation(
  fetchImpl: typeof fetch,
): Promise<ServerInvitationResult> {
  try {
    const response = await fetchImpl(SERVER_INVITATION_ROUTES.issue, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
      const issued = body as ServerInvitationIssuance;
      if (typeof issued.code === "string" && typeof issued.invitationId === "string") {
        return issued;
      }
    }
    const refusal = body as { reason?: string; message?: string; explanation?: string } | null;
    return {
      ok: false,
      reason: typeof refusal?.reason === "string" ? refusal.reason : "unknown_refusal",
      message: typeof refusal?.message === "string"
        ? refusal.message
        : typeof refusal?.explanation === "string"
          ? refusal.explanation
          : "The invitation refused.",
    };
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The invitation endpoint could not be reached.",
    };
  }
}

/** The server-tier join input (the deployed driver's POST body for /api/enrollment/redeem). */
export interface ServerJoinInput {
  readonly code: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: string;
}

/**
 * W147 — POST /api/enrollment/redeem (with a join code) — the joining
 * member redeems a workspace-join code. On success the server opens a
 * session for the joiner in the INVITING tenant (httpOnly cookie — the
 * joiner lands signed-in with the assigned role). FAIL-CLOSED.
 */
export async function serverJoinWorkspace(
  fetchImpl: typeof fetch,
  input: ServerJoinInput,
): Promise<ServerSessionResolveResult> {
  try {
    const response = await fetchImpl(SERVER_ENROLLMENT_ROUTES.redeem, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
      const projection = body as ServerSessionProjection;
      if (typeof projection.tenantId === "string") {
        return projection;
      }
    }
    const refusal = body as { reason?: string; message?: string; explanation?: string } | null;
    return {
      ok: false,
      reason: typeof refusal?.reason === "string" ? refusal.reason : "unknown_refusal",
      message: typeof refusal?.message === "string"
        ? refusal.message
        : typeof refusal?.explanation === "string"
          ? refusal.explanation
          : "The join refused.",
    };
  } catch {
    return {
      ok: false,
      reason: "server_unreachable",
      message: "The redemption endpoint could not be reached.",
    };
  }
}
