/**
 * @fleetos/web — W147: the server-side workspace-invitation issuance plane.
 *
 * SERVER-ONLY (apps/web/src/server).
 *
 * POST /api/workspace/invitations — an authenticated operator session
 * (httpOnly cookie) with an operator-and-above role issues a high-entropy
 * workspace-join code (the W130 shape: base32, ~100-bit body; the
 * `joinw` grammar — the structural twin of the enrollment code). The code
 * is created through the REAL frozen `createInvitation` boundary (via
 * @fleetos/identity's `createWorkspaceLifecycleService`) and persisted
 * VERIFIER-ONLY (the raw code never reaches a row, a log, or an audit
 * entry — only its deterministic `joinCodeHash`); it is returned EXACTLY
 * ONCE for display (the install contract's display-once law, carried to
 * the member-invitation plane).
 *
 * This closes the J3 residual blocker (sim-c-report §4.8 #2): the durable
 * `fleetos_workspace_invitations` table stays EMPTY on the deployed tier
 * until an operator issues a REAL invitation through this boundary.
 *
 * FAIL-CLOSED on every refusal path, machine-stable reasons throughout,
 * mirroring server-sessions/server-enrollment/server-workspace exactly.
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */
import { asTenantId } from "@fleetos/contracts";
import {
  createWorkspaceLifecycleService,
  createDurableTenantRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableInvitationRepository,
  joinCodeHash,
  makeTenantContext,
} from "@fleetos/identity";
import { experienceRoleFromAssignment } from "@fleetos/web-product/src/role-bridge";
import { canInteract } from "@fleetos/web-shell/src/permissions";
import { operatorRoleFor } from "@fleetos/web-product/src/role-bridge";
import { parseJsonBody, jsonResponse, refusalBody, frozen } from "./server-internal";
import type { ServerHandlerDeps } from "./server-context";
import { openServerRequest, flushOrRefuse } from "./server-context";
import { resolveOperatorSessionInContext, parseSessionCookie } from "./server-sessions";

// ---------------------------------------------------------------------------
// The refusal vocabulary
// ---------------------------------------------------------------------------

export type ServerInvitationRefusal =
  | "invalid_json"
  | "invalid_input"
  | "unauthenticated"
  | "interaction_forbidden"
  | "invalid_scope"
  | "server_store_unavailable"
  | "server_store_write_failed"
  | "server_entropy_unavailable";

const REFUSAL_EXPLANATIONS: Readonly<Record<ServerInvitationRefusal, string>> = frozen({
  invalid_json: "The invitation request body is not valid JSON.",
  invalid_input: "The invitation request was malformed. Nothing was recorded.",
  unauthenticated: "No server session cookie is present. Sign in to issue an invitation.",
  interaction_forbidden:
    "Your active role can observe the members surface but cannot issue invitations. Ask a workspace operator to issue the invitation for you.",
  invalid_scope: "The demo tenant is never an invitation scope.",
  server_store_unavailable: "The server control plane's durable store is unavailable. The request was refused; nothing was recorded.",
  server_store_write_failed: "A durable write was refused. The request failed closed; no partial state was kept.",
  server_entropy_unavailable: "The server could not mint a high-entropy credential. The request was refused; nothing was recorded.",
});

function refuse(reason: ServerInvitationRefusal, status: number, detail?: string): Response {
  const explanation = detail ?? REFUSAL_EXPLANATIONS[reason];
  return jsonResponse(refusalBody(reason, explanation), status);
}

// ---------------------------------------------------------------------------
// The invitation lifetime (the install contract's 24h rule, carried to the
// member-invitation plane)
// ---------------------------------------------------------------------------

/** The workspace-invitation lifetime (24h — the install contract's short-lived rule). */
export const INVITATION_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// The issuance success body
// ---------------------------------------------------------------------------

export interface InvitationIssuanceBody {
  readonly ok: true;
  /** The invitation's stable id (the durable row's primary key). */
  readonly invitationId: string;
  /** The one-time join code (display-once; never persisted, never echoed again). */
  readonly code: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The issuing workspace's name (for the UI's "Issue a join code for …" copy). */
  readonly workspaceName: string;
}

// ---------------------------------------------------------------------------
// POST /api/workspace/invitations — issue a workspace-join code
// ---------------------------------------------------------------------------

/**
 * Issue a server-side workspace-join code (operator session +
 * operator-and-above role required; the code is crypto-random in the W130
 * shape and persists verifier-only).
 */
export async function handleIssueInvitation(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  // The body is OPTIONAL (no inputs required — the tenant comes from the
  // session cookie). An empty body or `{}` is fine; a genuinely malformed
  // body (unparseable JSON) returns the refusal. We read the text
  // directly to avoid the parser's empty-body refusal (the invitation
  // boundary carries no body contract today).
  let bodyParsed = true;
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      JSON.parse(text); // validate (result unused — no body contract)
    }
  } catch {
    bodyParsed = false;
  }
  if (!bodyParsed) {
    return refuse("invalid_json", 400);
  }

  // The operator session (httpOnly cookie) — fail-closed.
  const cookieTenant = parseSessionCookie(request)?.tenantId;
  if (cookieTenant === undefined) {
    return refuse("unauthenticated", 401, "no server session cookie is present");
  }

  const opened = await openServerRequest([cookieTenant], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const operator = resolveOperatorSessionInContext(context, request);
    if (!operator.ok) {
      return refuse("unauthenticated", 401, operator.reason);
    }

    // The W130 permission law (mirrored from the enrollment plane):
    // operator-and-above roles may issue; viewer roles receive the frozen
    // denial with the escalation path.
    const mayIssue = operator.session.assignedRoles.some((role) => {
      const experience = experienceRoleFromAssignment(role);
      return experience !== null && canInteract(operatorRoleFor(experience), "propose").ok;
    });
    if (!mayIssue) {
      return jsonResponse(
        refusalBody("interaction_forbidden", REFUSAL_EXPLANATIONS.interaction_forbidden),
        403,
      );
    }

    // The demo tenant is never an invitation scope (the W122 isolation law).
    if (operator.session.tenantId === "tnt_w091demo000001") {
      return refuse("invalid_scope", 403, "the demo tenant is never an invitation scope");
    }

    const store = context.store.store;
    const workspaceService = createWorkspaceLifecycleService({
      tenants: createDurableTenantRepository(store),
      principals: createDurablePrincipalRepository(store),
      assignments: createDurableRoleAssignmentRepository(store),
      invitations: createDurableInvitationRepository(store),
      auditSink: context.audit.identitySink,
      generators: {
        // The crypto-random join-code generator (the W130 shape; the
        // entropy seam's joinCode() method — W147).
        joinCode: () => context.deps.entropy.joinCode(),
      },
    });

    const ctx = makeTenantContext(asTenantId(operator.session.tenantId), context.deps.correlationId);
    const issued = workspaceService.createInvitation(ctx, {
      now: context.deps.now,
      ttlSeconds: INVITATION_TTL_SECONDS,
      createdBy: operator.session.principalId,
      correlationId: context.deps.correlationId,
    });
    if (!issued.ok) {
      return refuse("server_store_write_failed", 503, issued.message);
    }

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const issuance: InvitationIssuanceBody = frozen({
      ok: true as const,
      invitationId: issued.issued.invitation.invitationId,
      code: issued.issued.rawCode,
      createdAt: issued.issued.invitation.createdAt,
      expiresAt: issued.issued.invitation.expiresAt,
      workspaceName: operator.session.workspaceName,
    });
    return jsonResponse(issuance, 201);
  } catch {
    return refuse("server_store_unavailable", 503, "The invitation could not be issued; nothing was recorded.");
  }
}
