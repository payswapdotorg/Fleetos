/**
 * @fleetos/web — the product session runtime (W101 [TL], the console's
 * composition root — the sanctioned identity binding site).
 *
 * The COMPOSITION-ONLY product auth/session lifecycle over the REAL
 * W100C durable identity services: the workspace create/join
 * lifecycle, the durable session service (open/resolve/revoke), the
 * audited role-switch service, and the W121 password-credential
 * service — over the W100C DurableRecordStore seam (the in-memory
 * reference store by default; a shared/injected store at the
 * composition root). This module owns NO business truth: every
 * domain decision is the identity package's; this runtime only
 * sequences the product journey and projects UI state through the
 * pure types in @fleetos/web-product.
 *
 * The product state machine (the shell's session gate):
 *
 *   signed-out --create/join/sign-in--> onboarding? --> active
 *   active --sign-out(revoke)--> signed-out
 *   active --expiry(resolve refuses)--> expired --recover--> active
 *
 * W121 (proper authentication) adds, through the REAL identity seams:
 *   - SIGN-UP: createWorkspace registers the founder's password
 *     credential (hash through the INJECTED PasswordHasher seam; the
 *     plain password never persists) before opening the session;
 *   - SIGN-IN: workspace + email + password verified against the
 *     stored verifier — machine-stable unknown-account vs
 *     wrong-password refusals with frozen human words;
 *   - SIGN-OUT: revokes the session AND clears the persisted browser
 *     session;
 *   - PERSISTENT BROWSER SESSIONS: every session-opening transition
 *     persists the token through the INJECTED session-store seam and
 *     construction re-resolves it — reload KEEPS the session honest
 *     (expiry still enforced via the resolve seam; corrupted /
 *     unknown / mismatched tokens fail closed to the gate; an expired
 *     or revoked token is never auto-logged-in).
 *
 * W130 (invite/join integrity) adds, at THIS composition root:
 *   - HIGH-ENTROPY JOIN CODES: the default `joinCode` generator is
 *     CRYPTO-RANDOM (Web Crypto over an unambiguous base32 body,
 *     ~100 bits) — never sequential, never predictable, never the
 *     same first code across workspaces/processes/page loads. The
 *     display-once law and the 24h TTL are the identity seam's
 *     unchanged truth;
 *   - TENANT-SCOPED REDEMPTION: joinWorkspace resolves the invitation
 *     STRICTLY within the redemption scope (the active session's
 *     tenant when signed in; the workspace directory's tenants at the
 *     gate — the demo tenant is never a scope). A code outside the
 *     scope is a machine-stable unknown_code; a redeemed/expired code
 *     is already_used/expired_code — never a fall-through into
 *     another tenant's record, never a cross-tenant principal.
 *
 * Every timestamp is injected (the `now` seam — no clock reads); every
 * generator is injected (deterministic tests). Fail-closed throughout:
 * unknown principals, wrong passwords, expired codes and revoked
 * sessions are machine-stable refusals with frozen human explanations
 * — never fabricated success.
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
  createDurablePasswordCredentialRepository,
  createPasswordCredentialService,
  createReferencePasswordHasher,
  createSessionService,
  createWorkspaceLifecycleService,
  createRoleSwitchService,
  makeUserPrincipal,
  makeTenantContext,
  makeRoleAssignment,
  asOpaqueToken,
  isValidOpaqueToken,
  joinCodeHash,
  MIN_PASSWORD_LENGTH,
} from "@fleetos/identity";
import type {
  TenantRepository,
  PrincipalRepository,
  RoleAssignmentRepository,
  SessionRepository,
  InvitationRepository,
  PasswordCredentialRepository,
  PasswordHasher,
  DurableRecordStore,
  DurableStoredRow,
  RoleDefinition,
  TenantContext,
} from "@fleetos/identity";
import type {
  ProductSessionState,
  ProductActiveSession,
  ProductAuthRefusal,
  ProductSessionSeams,
  ProductSessionStore,
  ProductPersistedSession,
  ProductWorkspaceSummary,
  IssueInvitationResult,
  ProductTransitionResult,
  ProductDemoPersonaSummary,
} from "@fleetos/web-product";
import type { ProductExperienceRole } from "@fleetos/web-product";
import {
  experienceRoleFromAssignment,
  PRODUCT_EXPERIENCE_ROLES,
} from "@fleetos/web-product";
import {
  DEMO_PERSONAS,
  DEMO_WORKSPACE_NAME,
  TENANT_ID as DEMO_TENANT_ID,
} from "./demo-fleet";

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

/**
 * The join-invitation lifetime the runtime requests from the REAL
 * identity seam (W110: 24 hours). The seam owns the expiry truth (the
 * invitation's `expiresAt` is persisted in the tenant store); the
 * shell surfaces this number ONLY as the display-once expiry note.
 */
export const INVITATION_TTL_SECONDS: number = 60 * 60 * 24;

function counterGenerator(prefix: string, pad: number): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(pad, "0")}`;
  };
}

// ---------------------------------------------------------------------------
// W130 — the crypto-random join-code generator (entropy at the composition
// root, exactly like the salts/tokens the gate injects; the identity
// package's purity law — no randomness inside packages/identity — holds)
// ---------------------------------------------------------------------------

/**
 * The join-code body alphabet: RFC 4648 base32 (A-Z, 2-7) — 32
 * unambiguous characters (no 0/O or 1/I confusion) and exactly a power
 * of two, so `byte % 32` is bias-free over Web Crypto's uniform bytes.
 */
const JOIN_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" as const;

/** The join-code grammar prefix (human-recognizable; the body carries the entropy). */
export const JOIN_CODE_PREFIX = "joinw" as const;

/**
 * The join-code body length: 20 base32 characters = 100 bits of
 * entropy. Two workspaces (or two processes, or two page loads over a
 * shared durable store) issuing colliding codes is computationally
 * negligible — the W130 fix for the sequential first-code collision
 * ("joinw10100000001" everywhere).
 */
export const JOIN_CODE_BODY_LENGTH = 20 as const;

/** The frozen join-code grammar (prefix + base32 body), as a regex source. */
export const JOIN_CODE_PATTERN = `${JOIN_CODE_PREFIX}[A-Z2-7]{${JOIN_CODE_BODY_LENGTH}}` as const;

/**
 * The crypto-random join-code generator (W130): a high-entropy,
 * collision-resistant raw code over the generous unambiguous base32
 * alphabet — every issued code is unique across workspaces, processes
 * and page loads by construction, so a code-hash can never resolve into
 * another tenant's invitation record.
 *
 * Entropy is injected HERE (the composition root) — the identity seam
 * stays pure (deterministic tests inject their own `joinCode` seam).
 * Falls back to a best-effort `Math.random` body when the Web Crypto
 * RNG is unavailable (the same tier discipline as the gate's session
 * token / salt generators).
 */
export function createCryptoJoinCodeGenerator(): () => string {
  const root: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (root !== undefined && typeof root.getRandomValues === "function") {
    const bytes = new Uint8Array(JOIN_CODE_BODY_LENGTH);
    return () => {
      root.getRandomValues(bytes);
      const body = Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % 32]!).join("");
      return `${JOIN_CODE_PREFIX}${body}`;
    };
  }
  return () => {
    let body = "";
    for (let i = 0; i < JOIN_CODE_BODY_LENGTH; i += 1) {
      body += JOIN_CODE_ALPHABET[Math.floor(Math.random() * 32)]!;
    }
    return `${JOIN_CODE_PREFIX}${body}`;
  };
}

// ---------------------------------------------------------------------------
// W121 — the browser-tier PasswordHasher (injected at the gate)
// ---------------------------------------------------------------------------

/**
 * The durable record-store shape the runtime composes: the W100C seam
 * plus the snapshot view the workspace directory lists (the shape
 * `createInMemoryDurableRecordStore` returns; the composition root's
 * browser/localStorage store implements the same surface).
 */
export type ProductDurableStore = DurableRecordStore & {
  readonly snapshot: Readonly<Record<string, Readonly<Record<string, readonly DurableStoredRow[]>>>>;
};

/**
 * The composition-root seams this runtime accepts beyond the pure
 * presentation seams (`ProductSessionSeams` — web-product types):
 * identity-owned seam types can only be named HERE, at the sanctioned
 * binding site (apps/web/src — the composition root; the web-product
 * package stays free of identity imports by the lane-ownership law).
 */
export interface ProductRuntimeSeams extends ProductSessionSeams {
  /**
   * The password hasher the credential service uses. Default: the
   * identity package's deterministic reference (local/test tier). The
   * composition root injects `createBrowserPasswordHasher()` (an
   * iterated SHA-256 — see below) for the browser tier.
   */
  readonly passwordHasher?: PasswordHasher;
  /** The per-credential salt generator (deterministic default). */
  readonly saltGenerator?: () => string;
  /**
   * The session-token generator (must match the `fst_` grammar).
   * Inject UNIQUE-per-runtime sequences when a durable store is shared:
   * the session table enforces token uniqueness across ALL records
   * (revoked ones stay), so reloaded runtimes need fresh sequences.
   */
  readonly sessionToken?: () => string;
  /**
   * The session-id generator (`ses_` prefix). Same uniqueness ruling
   * as the token generator: session ids are the durable primary key.
   */
  readonly sessionId?: () => string;
  /**
   * The durable identity store. Default: a fresh in-memory store (the
   * W100C reference). The composition root injects a SHARED store so
   * the durable identity records survive the runtime — "the underlying
   * durable store survives the runtime (sessions persist)".
   */
  readonly durableStore?: ProductDurableStore;
}

/**
 * SHA-256 + password-hashing rounds — extracted to `./sha256` (W144 deploy
 * convergence: the server modules import the hash WITHOUT pulling this
 * module's client runtime). Public API preserved via re-export.
 */
export { sha256Hex } from "./sha256";
import { sha256Hex } from "./sha256";

/**
 * The browser-tier hash rounds: an iterated salted SHA-256 (a
 * deliberate poor-man's KDF for the demo/local composition — one
 * thousand single-block compressions keeps sign-in well under a
 * frame while making offline inversion of the stored verifiers a
 * real, non-trivial computation; a server-side KDF replaces it at
 * the future Neon binding).
 */
export const BROWSER_PASSWORD_ROUNDS = 1000 as const;

/**
 * The REAL PasswordHasher the composition root injects (W121): an
 * iterated salted SHA-256 — pure, synchronous, dependency-free (the
 * identity package's seam discipline holds: no crypto dependency
 * inside identity; the implementation is injected HERE).
 *
 * @param rounds the iteration count (defaults to BROWSER_PASSWORD_ROUNDS)
 * @returns the frozen hasher
 */
export function createBrowserPasswordHasher(rounds: number = BROWSER_PASSWORD_ROUNDS): PasswordHasher {
  function derive(plain: string, salt: string): string {
    let acc = sha256Hex(`${salt}::fleetos-password::${plain}`);
    for (let round = 1; round < rounds; round += 1) {
      acc = sha256Hex(`${acc}${salt}`);
    }
    return `pwv_${acc}`;
  }
  return Object.freeze({
    hash: (plain: string, salt: string): string => derive(plain, salt),
    verify: (plain: string, salt: string, verifier: string): boolean =>
      typeof verifier === "string" && derive(plain, salt) === verifier,
  });
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/**
 * Create the product session runtime over the REAL identity services.
 *
 * One runtime instance == one browser session's product lifecycle. With
 * an injected durable store + session store (the composition root's
 * binding) the durable identity records and the session token SURVIVE
 * the runtime — reload KEEPS the session honest through the resolve
 * seam; without them (the default, and every deterministic test) each
 * runtime is a fresh browser session over a fresh in-memory store.
 *
 * W122 — the demo persona surface: the runtime lists the dedicated
 * demo tenant's pre-seeded personas (`demoPersonas`) and opens a
 * persona's session (`openDemoPersonaSession`) THROUGH THE SAME
 * session-open seam as create/join/sign-in (no second auth path: the
 * demo personas carry no passwords; the one-click quick link is the
 * sanctioned entry). The demo tenant is seeded lazily + idempotently
 * through the REAL identity repositories on the persona entry — a
 * tenant like any other for the whole session lifecycle
 * (open/resolve/expire/revoke; no special-cased demo branch).
 */
export function createProductSessionRuntime(seams: ProductRuntimeSeams): {
  /** List the workspaces (the choice screen's directory). */
  readonly listWorkspaces: () => readonly ProductWorkspaceSummary[];
  /** Issue a join invitation for the active workspace (code shown once). */
  readonly issueInvitation: () => IssueInvitationResult;
  /** Create a workspace (the founder becomes the first session). */
  readonly createWorkspace: (input: {
    readonly name: string;
    readonly founderDisplayName: string;
    readonly founderEmail: string;
    /** The founder's sign-up password (hashed through the injected seam; never stored). */
    readonly password: string;
  }) => ProductTransitionResult;
  /** Join a workspace with a one-time code (joiner becomes a session). */
  readonly joinWorkspace: (input: {
    readonly code: string;
    readonly displayName: string;
    readonly email: string;
    readonly roles?: readonly string[];
  }) => ProductTransitionResult;
  /** Sign in to a listed workspace by member email + password. */
  readonly signIn: (input: {
    readonly tenantId: string;
    readonly email: string;
    /** The sign-in password (verified against the stored verifier; never stored). */
    readonly password: string;
  }) => ProductTransitionResult;
  /** W122: the demo persona catalog (the sign-in quick links' input). */
  readonly demoPersonas: () => readonly ProductDemoPersonaSummary[];
  /**
   * W122: open a demo persona's workspace session — the sanctioned demo
   * entry (the same session-open seam; the personas carry no passwords).
   */
  readonly openDemoPersonaSession: (personaId: string) => ProductTransitionResult;
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
  // W130: the join-code generator's DEFAULT is crypto-random — a
  // per-runtime counter would seed identically on every page load, so
  // every workspace's first issued code would collide (the sim-b
  // defect). Deterministic tests inject their own `joinCode` seam.
  const nextJoinCode: () => string =
    seams.joinCode ?? createCryptoJoinCodeGenerator();
  const nextCorr =
    seams.correlationId ?? counterGenerator("cor_w101p", 8);

  // -- the REAL durable composition (the W100C seam + services) --------
  const store: ProductDurableStore = seams.durableStore ?? createInMemoryDurableRecordStore();
  const tenants: TenantRepository = createDurableTenantRepository(store);
  const principals: PrincipalRepository = createDurablePrincipalRepository(store);
  const assignments: RoleAssignmentRepository = createDurableRoleAssignmentRepository(store);
  const sessions: SessionRepository = createDurableSessionRepository(store);
  const invitations: InvitationRepository = createDurableInvitationRepository(store);
  const credentials: PasswordCredentialRepository = createDurablePasswordCredentialRepository(store);

  const sessionService = createSessionService({
    sessions,
    generators:
      seams.sessionToken !== undefined || seams.sessionId !== undefined
        ? { token: seams.sessionToken, sessionId: seams.sessionId }
        : undefined,
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
  // W121: the password-credential service over the SAME durable store —
  // the hasher is the INJECTED seam (deterministic reference default;
  // the composition root injects the browser-tier SHA-256 hasher).
  const passwordService = createPasswordCredentialService({
    credentials,
    hasher: seams.passwordHasher ?? createReferencePasswordHasher(),
    saltGenerator: seams.saltGenerator,
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

  /**
   * W130 — TENANT-SCOPED REDEMPTION: the tenants a join code may resolve
   * within, at this instant of the product journey:
   *
   *   - SIGNED IN: strictly the ACTIVE session's tenant (a member of
   *     workspace B redeeming workspace A's code is an unknown_code —
   *     never a fall-through into another tenant's invitation record);
   *   - SIGNED OUT (the gate's Join tab): the workspace directory's
   *     tenants — the runtime's honest composition scope. The dedicated
   *     demo tenant is NEVER a redemption scope (the W122 isolation
   *     law: the demo workspace is reachable only through its quick
   *     links), so a demo-issued code can never route a real joiner
   *     into the demo tenant — the sim-b cross-tenant defect.
   */
  function redemptionScope(): ReadonlySet<string> {
    if (rememberedTenantId !== null) {
      return new Set([rememberedTenantId]);
    }
    return new Set(listWorkspaces().map((ws) => ws.tenantId));
  }

  function listWorkspaces(): readonly ProductWorkspaceSummary[] {
    // The directory: every workspace partition in the store snapshot
    // (the runtime owns the store — this is its composition scope) plus
    // any seeded directory entries. W122 (the isolation law): the
    // dedicated demo tenant is NEVER a directory entry — the demo
    // workspace is reachable ONLY through the sign-in screen's clearly-
    // labeled quick links (the sanctioned entry), so no workspace list
    // ever shows a demo tenant.
    const seen = new Map<string, ProductWorkspaceSummary>();
    for (const seed of seams.seedWorkspaces ?? []) {
      if (seed.tenantId === DEMO_TENANT_ID) continue;
      seen.set(seed.tenantId, seed);
    }
    for (const tenantId of Object.keys(store.snapshot.fleetos_tenants ?? {})) {
      if (tenantId === DEMO_TENANT_ID) continue;
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
    // W121: persist the session token through the INJECTED store seam so
    // reload re-resolves THIS session (fail-closed — see restore below).
    persistSession({ tenantId, token: opened.session.token });
    return { ok: true, state: project(onboardingDone ? "active" : "onboarding") };
  }

  // -- W122: the demo persona surface (the sanctioned demo entry) ------

  /** The frozen demo-seed instant (no clock reads; deterministic). */
  const DEMO_SEED_AT = "2026-10-01T00:00:00Z" as const;

  /**
   * Ensure the dedicated demo tenant + its persona catalog exist in the
   * durable store (LAZY + IDEMPOTENT — the composition runs on the
   * persona entry, never at construction, so deterministic runtimes and
   * non-demo browser sessions stay untouched). Every record is written
   * through the REAL identity repositories (the same seams the
   * workspace lifecycle service composes); NO password credential is
   * ever registered (the personas carry no passwords — the quick link
   * is the sanctioned entry, never a credential).
   */
  function ensureDemoTenantSeeded(): { ok: true } | { ok: false; message: string } {
    const ctx = ctxOf(DEMO_TENANT_ID);
    const existing = tenants.getWorkspace(ctx);
    if (existing === undefined) {
      const founder = makeUserPrincipal(DEMO_TENANT_ID, DEMO_PERSONAS[0]!.memberRef as never);
      const put = tenants.putWorkspace(ctx, {
        tenantId: DEMO_TENANT_ID,
        name: DEMO_WORKSPACE_NAME,
        status: "active",
        createdAt: DEMO_SEED_AT,
        createdBy: founder.principalId,
      });
      if (!put.ok) {
        return { ok: false, message: `demo tenant seed refused (${put.reason})` };
      }
    }
    for (const persona of DEMO_PERSONAS) {
      const principal = makeUserPrincipal(DEMO_TENANT_ID, persona.memberRef as never);
      const membership = principals.putPrincipal(ctx, {
        tenantId: DEMO_TENANT_ID,
        principalId: principal.principalId,
        kind: "user",
        memberRef: persona.memberRef,
        displayName: persona.displayName,
        createdAt: DEMO_SEED_AT,
      });
      // already_exists is the idempotent re-seed over a shared store.
      if (!membership.ok && membership.reason !== "already_exists") {
        return { ok: false, message: `demo persona seed refused (${membership.reason})` };
      }
      const assignment = assignments.addAssignment(
        ctx,
        makeRoleAssignment({
          tenantId: DEMO_TENANT_ID,
          principalId: principal.principalId,
          roleName: persona.role,
          assignedAt: DEMO_SEED_AT,
          assignedBy: makeUserPrincipal(
            DEMO_TENANT_ID,
            DEMO_PERSONAS[0]!.memberRef as never,
          ).principalId,
        }),
      );
      if (!assignment.ok) {
        return { ok: false, message: `demo role assignment refused (${assignment.error.message})` };
      }
    }
    return { ok: true };
  }

  function demoPersonas(): readonly ProductDemoPersonaSummary[] {
    return DEMO_PERSONAS.map((persona) => ({
      personaId: persona.personaId,
      role: persona.role,
      displayName: persona.displayName,
      workspaceName: DEMO_WORKSPACE_NAME,
    }));
  }

  function openDemoPersonaSession(personaId: string): ProductTransitionResult {
    const persona = DEMO_PERSONAS.find((p) => p.personaId === personaId);
    if (persona === undefined) {
      return {
        ok: false,
        reason: "invalid_input",
        message: `openDemoPersonaSession: unknown demo persona '${String(personaId)}'`,
      };
    }
    const seeded = ensureDemoTenantSeeded();
    if (!seeded.ok) {
      return {
        ok: false,
        reason: "invalid_input",
        message: `openDemoPersonaSession: ${seeded.message}`,
      };
    }
    // THE SAME session-open seam as create/join/sign-in — no second
    // auth path: the demo persona carries no credential; the quick
    // link (this sanctioned transition) is the entry. From here the
    // demo session flows the REAL lifecycle like any tenant's.
    return openSession(DEMO_TENANT_ID as string, persona.memberRef, [persona.role]);
  }

  // -- W121: the persisted browser-session seam (fail-closed) ----------

  /** Persist (or clear) the current session token through the seam. */
  function persistSession(session: ProductPersistedSession | null): void {
    const sessionStore: ProductSessionStore | undefined = seams.sessionStore;
    if (sessionStore === undefined) return;
    try {
      sessionStore.save(session);
    } catch {
      // Persistence is best-effort availability-wise, but NEVER a
      // fabricated session: a failing store cannot break authentication.
    }
  }

  /**
   * Validate an UNTRUSTED loaded value against the persisted-session
   * shape + the frozen grammars (the store's own impl may have already
   * refused it — the runtime re-validates defensively either way).
   */
  function asValidPersistedSession(loaded: unknown): ProductPersistedSession | null {
    if (typeof loaded !== "object" || loaded === null) return null;
    const candidate = loaded as { readonly tenantId?: unknown; readonly token?: unknown };
    if (typeof candidate.tenantId !== "string" || typeof candidate.token !== "string") {
      return null;
    }
    if (!candidate.tenantId.startsWith("tnt_")) return null;
    if (!isValidOpaqueToken(asOpaqueToken(candidate.token))) return null;
    return { tenantId: candidate.tenantId, token: candidate.token };
  }

  /**
   * RELOAD RESTORE: re-resolve the persisted token through the REAL
   * session seam at the injected `now`. Fail-closed on everything —
   * corrupted shape, grammar refusal, unknown token, tenant mismatch,
   * revocation, expiry: the runtime stays signed-out (the gate) and
   * the dead residue is cleared. An expired or revoked token is NEVER
   * auto-logged-in.
   */
  function restorePersistedSession(): void {
    const sessionStore: ProductSessionStore | undefined = seams.sessionStore;
    if (sessionStore === undefined) return;
    let loaded: unknown;
    try {
      loaded = sessionStore.load();
    } catch {
      return; // an unreadable store never widens access
    }
    if (loaded === null || loaded === undefined) return; // nothing persisted
    const persisted = asValidPersistedSession(loaded);
    if (persisted === null) {
      // corrupted beyond recognition — clear the residue, stay signed-out
      persistSession(null);
      return;
    }
    const resolved = sessionService.resolveSession(ctxOf(persisted.tenantId), persisted.token, now());
    if (resolved.ok) {
      token = resolved.session.token;
      sessionId = resolved.session.sessionId;
      rememberedTenantId = resolved.session.tenantId as string;
      rememberedEmail = resolved.session.principalMemberRef;
      return;
    }
    // unknown / mismatched / revoked / expired: never auto-login — clear
    // the dead token so the next reload starts honest at the gate.
    persistSession(null);
  }

  // The reload restore runs ONCE at construction (before any caller
  // observes state): a re-created runtime over a shared durable store
  // + session store re-enters the session the browser persisted.
  restorePersistedSession();

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
        ttlSeconds: INVITATION_TTL_SECONDS,
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
      if (
        typeof input.password !== "string" ||
        input.password.length < MIN_PASSWORD_LENGTH
      ) {
        return {
          ok: false,
          reason: "invalid_input",
          message: `createWorkspace: a password of at least ${String(MIN_PASSWORD_LENGTH)} characters is required`,
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
      // W121: the signed-up founder gets a durable password credential
      // (hashed through the injected seam; the plain password never
      // persists) BEFORE the first session opens.
      const registered = passwordService.registerCredential({
        now: now(),
        tenantId: created.tenantId,
        principalId: created.principalId,
        memberRef: input.founderEmail.trim(),
        plainPassword: input.password,
        createdBy: created.principalId,
        correlationId: asCorrelationId(nextCorr()),
      });
      if (!registered.ok) {
        return {
          ok: false,
          reason: "invalid_input",
          message: `createWorkspace: credential registration refused (${registered.reason}): ${registered.message}`,
        };
      }
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
      // W130 — TENANT-SCOPED REDEMPTION: the invitation resolves STRICTLY
      // within the redemption scope (the active session's tenant when
      // signed in; the workspace directory's tenants at the gate). The
      // frozen identity seam's code-hash lookup is system-level, so the
      // composition root enforces the scope BEFORE delegating: a code
      // that does not exist in the scope is a machine-stable
      // unknown_code — it NEVER falls through to another tenant's
      // record (never a cross-tenant principal).
      const scope = redemptionScope();
      const resolvable = invitations.findInvitationByCodeHash(
        joinCodeHash(input.code.trim()),
      );
      if (resolvable === undefined || !scope.has(resolvable.tenantId as string)) {
        return {
          ok: false,
          reason: "unknown_code",
          message: `joinWorkspace: no invitation matches this code within the redemption scope (${resolvable === undefined ? "unresolved code" : `tenant ${resolvable.tenantId} is outside the scope`})`,
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
            ? "unknown_code"
            : joined.reason === "invitation_expired"
              ? "expired_code"
              : joined.reason === "invitation_already_used"
                ? "already_used"
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
      if (!input.tenantId.trim() || !input.email.trim() || !input.password) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "signIn: workspace, email and password are required",
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
      // W121: the password requirement — verified against the STORED
      // verifier through the identity seam. Unknown account (no
      // credential for this member), wrong password and revoked
      // credentials are machine-stable refusals with frozen words.
      const verified = passwordService.verifyCredential({
        tenantId: asTenantId(input.tenantId.trim()),
        memberRef: input.email.trim(),
        plainPassword: input.password,
        correlationId: asCorrelationId(nextCorr()),
      });
      if (!verified.ok) {
        const reason: ProductAuthRefusal =
          verified.reason === "credential_already_exists" ? "invalid_input" : verified.reason;
        return {
          ok: false,
          reason,
          message: `signIn refused (${verified.reason}): ${verified.message}`,
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

    // W122: the demo persona surface (the sign-in screen's quick links).
    demoPersonas,

    openDemoPersonaSession,

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
      // W121: sign-out clears the persisted browser session — a reload
      // after signing out lands on the gate, never a resurrected session.
      persistSession(null);
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
