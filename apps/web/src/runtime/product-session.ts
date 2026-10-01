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
  asOpaqueToken,
  isValidOpaqueToken,
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

/** The SHA-256 round constants (FIPS 180-4). */
const SHA256_K: readonly number[] = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Rotate a 32-bit word right by `n` bits. */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure SHA-256 (FIPS 180-4) over a UTF-8 string, hex output.
 * Deterministic, dependency-free, synchronous — the honest browser-tier
 * building block for the injected PasswordHasher (the async WebCrypto
 * API cannot fit the synchronous identity seam). Verified against the
 * standard test vectors by machine test.
 */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  // padded to a 64-byte multiple: message || 0x80 || zeros || 64-bit bit length
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

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
    // W121: persist the session token through the INJECTED store seam so
    // reload re-resolves THIS session (fail-closed — see restore below).
    persistSession({ tenantId, token: opened.session.token });
    return { ok: true, state: project(onboardingDone ? "active" : "onboarding") };
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
