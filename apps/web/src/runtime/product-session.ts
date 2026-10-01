/**
 * @fleetos/web — the product session runtime (W101 [TL], the console's
 * composition root — the sanctioned identity binding site).
 *
 * The COMPOSITION-ONLY product auth/session lifecycle over the REAL
 * W100C durable identity services: the workspace create/join
 * lifecycle, the durable session service (open/resolve/revoke), and
 * the audited role-switch service — over the W100C DurableRecordStore
 * seam (the in-memory reference store; the production seam — Neon —
 * is injected through the same interface). This module owns NO
 * business truth: every domain decision is the identity package's;
 * this runtime only sequences the product journey and projects UI
 * state through the pure types in @fleetos/web-product.
 *
 * The product state machine (the shell's session gate):
 *
 *   signed-out --create/join/sign-in--> onboarding? --> active
 *   active --sign-out(revoke)--> signed-out
 *   active --expiry(resolve refuses)--> expired --recover--> active
 *
 * Every timestamp is injected (the `now` seam — no clock reads); every
 * generator is injected (deterministic tests). Fail-closed throughout:
 * unknown principals, expired codes and revoked sessions are machine-
 * stable refusals with frozen human explanations — never fabricated
 * success.
 */

import { asCorrelationId, asTenantId, asUserId } from "@fleetos/contracts";
import type { CorrelationId } from "@fleetos/contracts";
import {
  createInMemoryDurableRecordStore,
  createDurableTenantRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurableSessionRepository,
  createDurableInvitationRepository,
  createSessionService,
  createWorkspaceLifecycleService,
  createRoleSwitchService,
  makeUserPrincipal,
  makeTenantContext,
} from "@fleetos/identity";
import type {
  TenantRepository,
  PrincipalRepository,
  RoleAssignmentRepository,
  SessionRepository,
  InvitationRepository,
  RoleDefinition,
  TenantContext,
} from "@fleetos/identity";
import type {
  ProductSessionState,
  ProductActiveSession,
  ProductAuthRefusal,
  ProductSessionSeams,
  ProductWorkspaceSummary,
  IssueInvitationResult,
  ProductTransitionResult,
} from "@fleetos/web-product";
import type { ProductExperienceRole } from "@fleetos/web-product";
import {
  experienceRoleFromAssignment,
  PRODUCT_EXPERIENCE_ROLES,
} from "@fleetos/web-product";

// ---------------------------------------------------------------------------
// The seven product role definitions (presentation-level; authority is
// the identity package's — these mirror the frozen matrix names so the
// audited switch service can validate the vocabulary)
// ---------------------------------------------------------------------------

/** The product experience-role definitions (matrix names, presentation permissions). */
export const PRODUCT_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze(
  PRODUCT_EXPERIENCE_ROLES.map((name) => ({
    name,
    permissions: [`product.experience.${name}`],
    description: `The ${name} experience lens (ROLE-EXPERIENCE-MATRIX v1).`,
  })),
);


const DEFAULT_TTL_SECONDS = 60 * 60 * 8; // one working session, then expiry UX.

function counterGenerator(prefix: string, pad: number): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(pad, "0")}`;
  };
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/**
 * Create the product session runtime over the REAL identity services.
 *
 * One runtime instance == one browser session's product lifecycle. The
 * underlying durable store survives the runtime (sessions persist);
 * the runtime holds the CURRENT token + session id in memory only —
 * exactly the browser-session contract.
 */
export function createProductSessionRuntime(seams: ProductSessionSeams): {
  /** List the workspaces (the choice screen's directory). */
  readonly listWorkspaces: () => readonly ProductWorkspaceSummary[];
  /** Issue a join invitation for the active workspace (code shown once). */
  readonly issueInvitation: () => IssueInvitationResult;
  /** Create a workspace (the founder becomes the first session). */
  readonly createWorkspace: (input: {
    readonly name: string;
    readonly founderDisplayName: string;
    readonly founderEmail: string;
  }) => ProductTransitionResult;
  /** Join a workspace with a one-time code (joiner becomes a session). */
  readonly joinWorkspace: (input: {
    readonly code: string;
    readonly displayName: string;
    readonly email: string;
    readonly roles?: readonly string[];
  }) => ProductTransitionResult;
  /** Sign in to a listed workspace by member email. */
  readonly signIn: (input: {
    readonly tenantId: string;
    readonly email: string;
  }) => ProductTransitionResult;
  /** Switch the active experience role (audited; assigned-only). */
  readonly switchActiveRole: (role: ProductExperienceRole) => ProductTransitionResult;
  /** Mark onboarding complete (first-run rail dismissed). */
  readonly completeOnboarding: () => ProductTransitionResult;
  /** Re-resolve the session (expiry detection; the resolve truth). */
  readonly refresh: () => ProductTransitionResult;
  /** Sign out (revoke the session; return to the choice screen). */
  readonly signOut: () => ProductTransitionResult;
  /** The current UI state projection (pure derivation). */
  readonly state: () => ProductSessionState;
} {
  const ttl = seams.ttlSeconds > 0 ? seams.ttlSeconds : DEFAULT_TTL_SECONDS;
  const now = seams.now;
  const nextTenantId: () => string =
    seams.tenantId ?? counterGenerator("tnt_w101prod", 8);
  const nextJoinCode = seams.joinCode ?? counterGenerator("joinw101", 8);
  const nextCorr =
    seams.correlationId ?? counterGenerator("cor_w101p", 8);

  // -- the REAL durable composition (the W100C seam + services) --------
  const store = createInMemoryDurableRecordStore();
  const tenants: TenantRepository = createDurableTenantRepository(store);
  const principals: PrincipalRepository = createDurablePrincipalRepository(store);
  const assignments: RoleAssignmentRepository = createDurableRoleAssignmentRepository(store);
  const sessions: SessionRepository = createDurableSessionRepository(store);
  const invitations: InvitationRepository = createDurableInvitationRepository(store);

  const sessionService = createSessionService({
    sessions,
    generators: seams.sessionToken ? { token: seams.sessionToken } : undefined,
  });
  const workspaceService = createWorkspaceLifecycleService({
    tenants,
    principals,
    assignments,
    invitations,
    generators: { tenantId: () => asTenantId(nextTenantId()), joinCode: nextJoinCode },
  });
  const roleSwitchService = createRoleSwitchService({
    sessions,
    assignmentsOf: (ctx: TenantContext) => assignments.listAssignments(ctx),
  });

  // -- the runtime's browser-session memory (token + id, memory only) --
  let token: string | null = null;
  let sessionId: string | null = null;
  let onboardingDone = false;
  let rememberedTenantId: string | null = null;
  let rememberedEmail: string | null = null;

  function ctxOf(tenantId: string): TenantContext {
    return makeTenantContext(tenantId as never, asCorrelationId(nextCorr()));
  }

  function systemCtx(): TenantContext {
    return ctxOf(rememberedTenantId ?? "tnt_system0001");
  }

  function workspacesOfTenant(tenantId: string): ProductWorkspaceSummary | null {
    const record = tenants.getWorkspace(ctxOf(tenantId));
    return record ? { tenantId: record.tenantId, name: record.name, createdAt: record.createdAt } : null;
  }

  function listWorkspaces(): readonly ProductWorkspaceSummary[] {
    // The directory: every workspace partition in the store snapshot
    // (the runtime owns the store — this is its composition scope) plus
    // any seeded directory entries.
    const seen = new Map<string, ProductWorkspaceSummary>();
    for (const seed of seams.seedWorkspaces ?? []) {
      seen.set(seed.tenantId, seed);
    }
    for (const tenantId of Object.keys(store.snapshot.fleetos_tenants ?? {})) {
      const ws = workspacesOfTenant(tenantId);
      if (ws) seen.set(tenantId, ws);
    }
    return [...seen.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.tenantId < b.tenantId ? -1 : 1,
    );
  }

  function assignmentsOf(tenantId: string, principalId: string): readonly string[] {
    return assignments
      .listAssignments(ctxOf(tenantId))
      .filter((a) => a.principalId === principalId)
      .map((a) => a.roleName);
  }

  function project(phase: "onboarding" | "active" | "expired"): ProductSessionState {
    if (token === null || sessionId === null) return { phase: "signed-out" };
    const tenantId = rememberedTenantId ?? "";
    const resolved = sessionService.resolveSession(ctxOf(tenantId), token, now());
    if (!resolved.ok) {
      // phase=expired keeps the banner projection (recovery UX); the
      // token no longer resolves — presentation only.
      return {
        phase,
        tenantId,
        workspaceName: workspacesOfTenant(tenantId)?.name ?? tenantId,
        principalId: "",
        memberRef: rememberedEmail ?? "",
        displayName: rememberedEmail ?? "",
        sessionToken: token,
        sessionId,
        expiresAt: "",
        assignedRoles: [],
        activeRole: null,
        isFirstRun: !onboardingDone,
      };
    }
    const session = resolved.session;
    const assigned = assignmentsOf(tenantId, session.principalId);
    const membership = principals
      .listPrincipals(ctxOf(tenantId))
      .find((p) => p.principalId === session.principalId);
    const activeName =
      session.activeRole ??
      assigned.find((r) => experienceRoleFromAssignment(r) !== null) ??
      null;
    return {
      phase,
      tenantId,
      workspaceName: workspacesOfTenant(tenantId)?.name ?? tenantId,
      principalId: session.principalId,
      memberRef: session.principalMemberRef,
      displayName: membership?.displayName ?? session.principalMemberRef,
      sessionToken: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      assignedRoles: assigned,
      activeRole: activeName !== null ? experienceRoleFromAssignment(activeName) : null,
      isFirstRun: !onboardingDone,
    };
  }

  function openSession(
    tenantId: string,
    email: string,
    assigned: readonly string[],
  ): ProductTransitionResult {
    const principal = makeUserPrincipal(tenantId as never, email as never);
    const initialRole = assigned.find((r) => experienceRoleFromAssignment(r) !== null);
    const opened = sessionService.openSession({
      now: now(),
      ttlSeconds: ttl,
      principal,
      initialActiveRole: initialRole,
      correlationId: asCorrelationId(nextCorr()),
    });
    if (!opened.ok) {
      return {
        ok: false,
        reason: "invalid_input",
        message: `session open refused (${opened.reason}): ${opened.message}`,
      };
    }
    token = opened.session.token;
    sessionId = opened.session.sessionId;
    rememberedTenantId = tenantId;
    rememberedEmail = email;
    return { ok: true, state: project(onboardingDone ? "active" : "onboarding") };
  }

  return {
    listWorkspaces,

    issueInvitation: () => {
      if (token === null || rememberedTenantId === null) {
        return {
          ok: false,
          reason: "unknown_session",
          message: "issueInvitation: no active session",
        };
      }
      const issued = workspaceService.createInvitation(ctxOf(rememberedTenantId), {
        now: now(),
        ttlSeconds: 60 * 60 * 24,
        createdBy: "console",
        correlationId: asCorrelationId(nextCorr()),
      });
      if (!issued.ok) {
        return {
          ok: false,
          reason: "invalid_input",
          message: `issueInvitation refused: ${issued.message}`,
        };
      }
      return { ok: true, rawCode: issued.issued.rawCode };
    },

    createWorkspace: (input) => {
      if (!input.name.trim() || !input.founderDisplayName.trim() || !input.founderEmail.trim()) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "createWorkspace: workspace name, display name and email are required",
        };
      }
      const created = workspaceService.createWorkspace({
        now: now(),
        name: input.name.trim(),
        founderUserId: asUserId(input.founderEmail.trim()),
        founderDisplayName: input.founderDisplayName.trim(),
        initialRoles: ["fleet.admin"],
        correlationId: asCorrelationId(nextCorr()),
      });
      return openSession(created.tenantId as string, input.founderEmail.trim(), ["fleet.admin"]);
    },

    joinWorkspace: (input) => {
      if (!input.code.trim() || !input.displayName.trim() || !input.email.trim()) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "joinWorkspace: code, display name and email are required",
        };
      }
      const roles = input.roles && input.roles.length > 0 ? input.roles : ["employee"];
      const joined = workspaceService.joinWorkspace({
        now: now(),
        code: input.code.trim(),
        userId: asUserId(input.email.trim()),
        displayName: input.displayName.trim(),
        roles,
        correlationId: asCorrelationId(nextCorr()),
      });
      if (!joined.ok) {
        const reason: ProductAuthRefusal =
          joined.reason === "invitation_unknown"
            ? "invalid_code"
            : joined.reason === "invitation_expired"
              ? "expired_code"
              : joined.reason === "invitation_already_used"
                ? "revoked_code"
                : "invalid_input";
        return {
          ok: false,
          reason,
          message: `joinWorkspace refused (${joined.reason}): ${joined.message}`,
        };
      }
      return openSession(
        joined.tenantId as string,
        input.email.trim(),
        joined.assignments.map((a) => a.roleName),
      );
    },

    signIn: (input) => {
      if (!input.tenantId.trim() || !input.email.trim()) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "signIn: workspace and email are required",
        };
      }
      const workspace = workspacesOfTenant(input.tenantId.trim());
      if (workspace === null) {
        return {
          ok: false,
          reason: "unknown_workspace",
          message: `signIn: no workspace ${input.tenantId}`,
        };
      }
      const ctx = ctxOf(input.tenantId.trim());
      const membership = principals
        .listPrincipals(ctx)
        .find((p) => p.kind === "user" && p.memberRef === input.email.trim());
      if (membership === undefined) {
        return {
          ok: false,
          reason: "unknown_principal",
          message: `signIn: no member ${input.email} in ${workspace.name}`,
        };
      }
      const assigned = assignmentsOf(input.tenantId.trim(), membership.principalId);
      if (!assigned.some((r) => experienceRoleFromAssignment(r) !== null)) {
        return {
          ok: false,
          reason: "no_experience_role",
          message: `signIn: ${input.email} has no product role in ${workspace.name}`,
        };
      }
      return openSession(input.tenantId.trim(), input.email.trim(), assigned);
    },

    switchActiveRole: (role) => {
      if (token === null || sessionId === null || rememberedTenantId === null) {
        return {
          ok: false,
          reason: "unknown_session",
          message: "switchActiveRole: no active session",
        };
      }
      const switched = roleSwitchService.switchActiveRole(ctxOf(rememberedTenantId), {
        now: now(),
        sessionId,
        targetRole: role,
        roleDefinitions: PRODUCT_ROLE_DEFINITIONS,
        correlationId: asCorrelationId(nextCorr()),
      });
      if (!switched.ok) {
        const assignedNow = assignmentsOf(rememberedTenantId, principals
          .listPrincipals(ctxOf(rememberedTenantId))
          .find((p) => p.kind === "user" && p.memberRef === rememberedEmail)
          ?.principalId ?? "");
        const reason: ProductAuthRefusal = assignedNow.includes(role)
          ? "unknown_session"
          : "role_not_assigned";
        return {
          ok: false,
          reason,
          message: `switchActiveRole refused (${switched.reason}): ${switched.message}`,
        };
      }
      return { ok: true, state: project(onboardingDone ? "active" : "onboarding") };
    },

    completeOnboarding: () => {
      onboardingDone = true;
      return { ok: true, state: project("active") };
    },

    refresh: () => {
      if (token === null || sessionId === null) {
        return { ok: true, state: { phase: "signed-out" } };
      }
      const resolved = sessionService.resolveSession(ctxOf(rememberedTenantId ?? ""), token, now());
      if (resolved.ok) return { ok: true, state: project(onboardingDone ? "active" : "onboarding") };
      if (resolved.reason === "expired") return { ok: true, state: project("expired") };
      return { ok: true, state: { phase: "signed-out" } };
    },

    signOut: () => {
      if (token !== null && sessionId !== null && rememberedTenantId !== null) {
        sessionService.revokeSession(
          ctxOf(rememberedTenantId),
          sessionId,
          now(),
          asCorrelationId(nextCorr()),
        );
      }
      token = null;
      sessionId = null;
      rememberedTenantId = null;
      rememberedEmail = null;
      return { ok: true, state: { phase: "signed-out" } };
    },

    state: () => {
      if (token === null || sessionId === null) return { phase: "signed-out" };
      void systemCtx;
      const resolved = sessionService.resolveSession(ctxOf(rememberedTenantId ?? ""), token, now());
      if (resolved.ok) return project(onboardingDone ? "active" : "onboarding");
      if (resolved.reason === "expired") return project("expired");
      return { phase: "signed-out" };
    },
  };
}
