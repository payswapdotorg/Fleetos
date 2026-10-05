/**
 * @fleetos/web — the server-side WORKSPACE-CREATION plane (W144 deploy
 * convergence, TL scope: apps/web/src/server/**).
 *
 * POST /api/workspace — the deployed tier's J1 journey: the founder
 * creates a workspace through the REAL frozen boundary
 * (`createWorkspaceLifecycleService` over the durable repositories —
 * the SAME service the browser tier composes), the founder's password
 * credential is registered through the identity password service
 * (verifier-only persistence; the plain password never persists), and
 * the founder's first session opens immediately (httpOnly cookie; the
 * response carries the session projection — exactly the sign-in
 * response's shape, so the client lands signed-in).
 *
 * FAIL-CLOSED on every refusal path, machine-stable reasons throughout,
 * mirroring server-sessions/server-enrollment exactly.
 */
import { asCorrelationId, asTenantId, asUserId } from "@fleetos/contracts";
import {
  createWorkspaceLifecycleService,
  createDurableTenantRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableInvitationRepository,
  createPasswordCredentialService,
  createDurablePasswordCredentialRepository,
  createSessionService,
  createDurableSessionRepository,
} from "@fleetos/identity";
import { parseJsonBody, jsonResponse, refusalBody, stringField, frozen } from "./server-internal";
import { openServerRequest, flushOrRefuse } from "./server-context";
import { createServerPasswordHasher } from "./server-password-hasher";
import { sessionCookie, SERVER_SESSION_TTL_SECONDS } from "./server-sessions";
import type { ServerHandlerDeps } from "./server-context";
import type { ServerSessionProjection } from "../runtime/composition-root";

// ---------------------------------------------------------------------------
// The refusal vocabulary
// ---------------------------------------------------------------------------

export type ServerWorkspaceRefusal =
  | "invalid_json"
  | "invalid_input"
  | "workspace_creation_refused"
  | "credential_registration_refused"
  | "session_open_refused"
  | "server_store_unavailable";

const REFUSAL_EXPLANATIONS: Readonly<Record<ServerWorkspaceRefusal, string>> = frozen({
  invalid_json: "The workspace-creation request body is not valid JSON.",
  invalid_input: "Workspace creation requires a workspace name, a display name, an email and a password of at least 8 characters.",
  workspace_creation_refused: "The workspace lifecycle boundary refused the creation.",
  credential_registration_refused: "The founder's password credential could not be registered.",
  session_open_refused: "The founder's first session could not be opened.",
  server_store_unavailable: "The server control plane's durable store is unavailable.",
});

function refuse(reason: ServerWorkspaceRefusal, status: number, detail?: string): Response {
  const explanation = detail ?? REFUSAL_EXPLANATIONS[reason];
  return jsonResponse(refusalBody(reason, explanation), status);
}

// ---------------------------------------------------------------------------
// POST /api/workspace
// ---------------------------------------------------------------------------

export async function handleCreateWorkspace(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;
  const name = stringField(source, "workspaceName");
  const displayName = stringField(source, "founderDisplayName");
  const email = stringField(source, "founderEmail");
  const password = typeof source["password"] === "string" ? source["password"] : undefined;

  if (
    name === undefined || name.trim().length === 0 ||
    displayName === undefined || displayName.trim().length === 0 ||
    email === undefined || email.trim().length === 0 ||
    password === undefined || password.length < 8
  ) {
    return refuse("invalid_input", 400);
  }

  // No tenant context exists yet (the workspace mints its own) — open the
  // request against a scratch scope; the durable writes carry their own
  // tenant partitions.
  const opened = await openServerRequest(["tnt_scratch_creation"], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const store = context.store.store;
    const now = context.deps.now;
    const correlationId = context.deps.correlationId;

    // ---- The REAL frozen workspace boundary (durable repositories) ------
    const workspaceService = createWorkspaceLifecycleService({
      tenants: createDurableTenantRepository(store),
      principals: createDurablePrincipalRepository(store),
      assignments: createDurableRoleAssignmentRepository(store),
      invitations: createDurableInvitationRepository(store),
      auditSink: context.audit.identitySink,
      generators: {
        tenantId: (): ReturnType<typeof asTenantId> =>
          asTenantId(`tnt_w144w${context.deps.entropy.hex(12)}`),
      },
    });
    // The frozen boundary THROWS on collision-type refusals (the reference
    // service contract) — the catch below maps any throw to the
    // machine-stable refusal.
    const created = workspaceService.createWorkspace({
      now,
      name: name.trim(),
      founderUserId: asUserId(email.trim()),
      founderDisplayName: displayName.trim(),
      initialRoles: ["fleet.admin"],
      correlationId,
    });

    // ---- The founder's durable password credential (verifier-only) -----
    const passwordService = createPasswordCredentialService({
      credentials: createDurablePasswordCredentialRepository(store),
      hasher: createServerPasswordHasher(),
    });
    const registered = passwordService.registerCredential({
      now,
      tenantId: created.tenantId,
      principalId: created.principalId,
      memberRef: email.trim(),
      plainPassword: password,
      createdBy: created.principalId,
      correlationId: asCorrelationId(context.deps.entropy.hex(12)),
    });
    if (!registered.ok) {
      return refuse("credential_registration_refused", 422, registered.message);
    }

    // ---- The founder's first session (httpOnly cookie) ------------------
    const sessionService = createSessionService({
      sessions: createDurableSessionRepository(store),
      auditSink: context.audit.identitySink,
      generators: {
        token: () => `fst_w144w${context.deps.entropy.hex(19)}`,
        sessionId: () => `ses_w144w${context.deps.entropy.hex(16)}`,
      },
    });
    const principal = {
      kind: "user" as const,
      tenantId: created.tenantId,
      userId: asUserId(email.trim()),
      principalId: created.principalId,
    };
    const open = sessionService.openSession({
      now,
      ttlSeconds: SERVER_SESSION_TTL_SECONDS,
      principal,
      initialActiveRole: "fleet.admin",
      issuer: "web.server-control-plane",
      correlationId,
    });
    if (!open.ok) {
      return refuse("session_open_refused", 422, open.message);
    }

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const projection: ServerSessionProjection = frozen({
      ok: true as const,
      tenantId: created.tenantId as string,
      workspaceName: name.trim(),
      principalId: created.principalId,
      memberRef: email.trim(),
      sessionId: open.session.sessionId,
      expiresAt: open.session.expiresAt,
      assignedRoles: ["fleet.admin"],
      activeRole: "fleet.admin",
    });
    return jsonResponse(projection, 201, {
      "set-cookie": sessionCookie(
        `${created.tenantId as string}::${open.session.token}`,
        SERVER_SESSION_TTL_SECONDS,
      ),
    });
  } catch {
    return refuse("server_store_unavailable", 503, "The workspace creation could not be completed; nothing was recorded.");
  }
}
