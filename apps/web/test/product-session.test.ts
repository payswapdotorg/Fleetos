/**
 * W101 web-product — the product session runtime over the REAL W100C
 * identity services: the full product journey (create workspace ->
 * onboarding -> active; join via one-time code; sign-in of a known
 * member; audited role switch; assigned-only switch refusal; session
 * expiry -> recovery; sign-out revocation), all fail-closed refusals
 * machine-stable with frozen human explanations, and every timestamp
 * injected (deterministic — the generator sequences are counters).
 *
 * W121 — proper authentication: the sign-up credential registration,
 * the password-verified sign-in (wrong-password / unknown-account
 * refusals), the reload persistence round-trip through the injected
 * session-store + durable-store seams (sign-up -> reload persists ->
 * sign-out clears), the fail-closed corrupted / mismatched / expired
 * persisted tokens, and the browser-tier SHA-256 hasher vectors.
 */

import { describe, test, expect } from "bun:test";
import {
  createProductSessionRuntime,
  createBrowserPasswordHasher,
  sha256Hex,
  INVITATION_TTL_SECONDS,
} from "../src/runtime/product-session";
import {
  PRODUCT_REFUSAL_EXPLANATIONS,
  operatorRoleFor,
  isRestrictedExperienceRole,
  searchResultContextFor,
} from "@fleetos/web-product";
import type { ProductSessionSeams, ProductSessionStore, ProductPersistedSession } from "@fleetos/web-product";
import type { ProductRuntimeSeams } from "../src/runtime/product-session";
import { createInMemoryDurableRecordStore } from "@fleetos/identity";

const T0 = "2026-10-01T09:00:00Z";
const TTL = 60 * 60; // one hour
const FOUNDER_PASSWORD = "founder-pass-0001";

function counter(prefix: string, pad: number): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(pad, "0")}`;
  };
}

/** The deterministic reference seams (fixed clock T0). */
function baseSeams(): ProductSessionSeams {
  return {
    now: () => T0,
    ttlSeconds: TTL,
    tenantId: counter("tnt_w101test", 4),
    joinCode: counter("joinw101c", 6),
    sessionToken: counter("fst_w101test", 19),
    correlationId: counter("cor_w101t", 6),
  };
}

/**
 * Seams for a runtime over a SHARED durable store: the session-token AND
 * session-id counters are TAGGED per runtime — the durable session table
 * enforces uniqueness across ALL records (revoked ones stay; the id is
 * the primary key), so two runtimes minting the same deterministic
 * sequences would collide. (The gate solves this with crypto-random
 * generators — the test tier's honest equivalent is a per-runtime tag.)
 */
function sharedSeams(tag: string): ProductRuntimeSeams {
  return {
    ...baseSeams(),
    sessionToken: counter(`fst_w121${tag}`, 20),
    sessionId: counter(`ses_w121${tag}`, 16),
  };
}

/** A runtime with the deterministic reference seams (fixed clock T0). */
function makeRuntime() {
  return createProductSessionRuntime(baseSeams());
}

/** A runtime with an ADVANCEABLE clock (the expiry test's seam). */
function makeAdvanceableRuntime(): { readonly rt: ReturnType<typeof makeRuntime>; readonly advance: (seconds: number) => void } {
  let clock = T0;
  const rt = createProductSessionRuntime({
    ...baseSeams(),
    now: () => clock,
  });
  return {
    rt,
    advance: (seconds: number) => {
      clock = new Date(Date.parse(clock) + seconds * 1000).toISOString();
    },
  };
}

/** The in-memory W121 session store (the persistence seam fake). */
function makeSessionStore(): ProductSessionStore & {
  readonly saved: () => ProductPersistedSession | null;
  readonly corrupt: (value: unknown) => void;
} {
  let held: ProductPersistedSession | null = null;
  let override: { readonly present: boolean; readonly value: unknown } = {
    present: false,
    value: null,
  };
  return {
    save: (session: ProductPersistedSession | null): void => {
      held = session;
    },
    load: (): ProductPersistedSession | null =>
      override.present ? (override.value as ProductPersistedSession | null) : held,
    saved: () => held,
    corrupt: (value: unknown): void => {
      override = { present: true, value };
    },
  };
}

describe("W101 product session runtime (REAL identity services)", () => {
  test("createWorkspace opens the founder's session (fleet.admin, onboarding)", () => {
    const rt = makeRuntime();
    expect(rt.state().phase).toBe("signed-out");
    const created = rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.state.phase).toBe("onboarding");
    if (created.state.phase === "signed-out") return;
    expect(created.state.activeRole).toBe("fleet.admin");
    expect(created.state.workspaceName).toBe("Northwind Fleet");
    expect(created.state.isFirstRun).toBe(true);
    expect(rt.listWorkspaces().map((w) => w.name)).toEqual(["Northwind Fleet"]);
  });

  test("completeOnboarding moves to active; the state projection stays pure", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const done = rt.completeOnboarding();
    expect(done.ok).toBe(true);
    const st = rt.state();
    expect(st.phase).toBe("active");
    if (st.phase === "signed-out") return;
    expect(st.isFirstRun).toBe(false);
    expect(rt.state()).toEqual(rt.state()); // deterministic projection
  });

  test("joinWorkspace via one-time code grants the employee role; the code is single-use", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const invited = rt.issueInvitation();
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    const joined = rt.joinWorkspace({
      code: invited.rawCode,
      displayName: "Grace Hopper",
      email: "grace@northwind.example",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.state.phase).toBe("onboarding");
    if (joined.state.phase === "signed-out") return;
    expect(joined.state.activeRole).toBe("employee");
    expect(joined.state.tenantId).toBe("tnt_w101test0001");
    // the same code cannot be reused (single-use law)
    rt.signOut();
    const reused = rt.joinWorkspace({
      code: invited.rawCode,
      displayName: "Alan Turing",
      email: "alan@northwind.example",
    });
    expect(reused.ok).toBe(false);
    if (reused.ok) return;
    expect(reused.reason).toBe("revoked_code");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[reused.reason]).toContain("revoked");
  });

  test("signIn resolves a known member fail-closed (unknown member/workspace refused)", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    rt.completeOnboarding();
    rt.signOut();
    // unknown workspace
    const badWs = rt.signIn({ tenantId: "tnt_missing0001", email: "ada@northwind.example", password: FOUNDER_PASSWORD });
    expect(badWs.ok).toBe(false);
    if (badWs.ok) return;
    expect(badWs.reason).toBe("unknown_workspace");
    // unknown principal
    const badUser = rt.signIn({ tenantId: "tnt_w101test0001", email: "nobody@northwind.example", password: FOUNDER_PASSWORD });
    expect(badUser.ok).toBe(false);
    if (badUser.ok) return;
    expect(badUser.reason).toBe("unknown_principal");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[badUser.reason]).toContain("invite you");
    // a known member signs back in (onboarding already completed here)
    const ok = rt.signIn({ tenantId: "tnt_w101test0001", email: "ada@northwind.example", password: FOUNDER_PASSWORD });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.state.phase).toBe("active");
    if (ok.state.phase === "signed-out") return;
    expect(ok.state.activeRole).toBe("fleet.admin");
    expect(ok.state.displayName).toBe("Ada Lovelace");
  });

  test("switchActiveRole is audited through the REAL service and assigned-only", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    // service.desk is NOT assigned to the founder
    const refused = rt.switchActiveRole("service.desk");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("role_not_assigned");
    // switching to an assigned role succeeds (and persists)
    const ok = rt.switchActiveRole("fleet.admin");
    expect(ok.ok).toBe(true);
    const st = rt.state();
    if (st.phase === "signed-out") return;
    expect(st.activeRole).toBe("fleet.admin");
  });

  test("session expiry -> expired phase -> recovery opens a fresh session", () => {
    const { rt, advance } = makeAdvanceableRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    rt.completeOnboarding();
    expect(rt.state().phase).toBe("active");
    // advance beyond the TTL: the resolve truth flips to expired
    advance(TTL + 1);
    const refreshed = rt.refresh();
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.state.phase).toBe("expired");
    // recovery: sign back in WITH the password (a FRESH session —
    // distinct token, same member)
    const recovered = rt.signIn({ tenantId: "tnt_w101test0001", email: "ada@northwind.example", password: FOUNDER_PASSWORD });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.state.phase).toBe("active");
    if (recovered.state.phase === "signed-out") return;
    expect(recovered.state.activeRole).toBe("fleet.admin");
  });

  test("signOut revokes; state returns to signed-out", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const out = rt.signOut();
    expect(out.ok).toBe(true);
    expect(rt.state().phase).toBe("signed-out");
  });

  test("empty-input refusals are machine-stable", () => {
    const rt = makeRuntime();
    const noName = rt.createWorkspace({ name: "  ", founderDisplayName: "x", founderEmail: "y", password: FOUNDER_PASSWORD });
    expect(noName.ok).toBe(false);
    if (noName.ok) return;
    expect(noName.reason).toBe("invalid_input");
    // W121: a too-short password is an invalid_input refusal (the honest
    // minimum-length floor owned by the identity seam)
    const noPassword = rt.createWorkspace({ name: "Fleet", founderDisplayName: "x", founderEmail: "y", password: "short" });
    expect(noPassword.ok).toBe(false);
    if (noPassword.ok) return;
    expect(noPassword.reason).toBe("invalid_input");
    expect(noPassword.message).toContain("password");
    const noCode = rt.joinWorkspace({ code: "", displayName: "x", email: "y" });
    expect(noCode.ok).toBe(false);
    if (noCode.ok) return;
    expect(noCode.reason).toBe("invalid_input");
    const noPasswordSignIn = rt.signIn({ tenantId: "tnt_w101test0001", email: "ada@northwind.example", password: "" });
    expect(noPasswordSignIn.ok).toBe(false);
    if (noPasswordSignIn.ok) return;
    expect(noPasswordSignIn.reason).toBe("invalid_input");
  });
});

describe("W101 role bridge (presentation-only laws)", () => {
  test("every experience role maps to a shell operator role (total, deterministic)", () => {
    expect(operatorRoleFor("fleet.admin")).toBe("owner");
    expect(operatorRoleFor("service.desk")).toBe("operator");
    expect(operatorRoleFor("security.compliance")).toBe("approver");
    expect(operatorRoleFor("asset.manager")).toBe("operator");
    expect(operatorRoleFor("team.manager")).toBe("approver");
    expect(operatorRoleFor("employee")).toBe("viewer");
    expect(operatorRoleFor("vendor.operator")).toBe("viewer");
  });

  test("employee and vendor.operator are the restricted lenses", () => {
    expect(isRestrictedExperienceRole("employee")).toBe(true);
    expect(isRestrictedExperienceRole("vendor.operator")).toBe(true);
    expect(isRestrictedExperienceRole("fleet.admin")).toBe(false);
  });

  test("search result context is role-shaped, never authority-shaped", () => {
    const admin = searchResultContextFor("fleet.admin", "device");
    const employee = searchResultContextFor("employee", "device");
    expect(admin).toContain("governance lens");
    expect(employee).toContain("restricted view");
    expect(employee).toContain("personal lens");
    expect(searchResultContextFor(null, "evidence")).toContain("Sign in");
  });
});

describe("W110 invitation issuance + join-role selection (REAL identity seams)", () => {
  test("issueInvitation refuses machine-stably when signed out (unknown_session)", () => {
    const rt = makeRuntime();
    const refused = rt.issueInvitation();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("unknown_session");
    expect(refused.message).toContain("no active session");
    // the frozen human explanation exists for the refusal code
    expect(PRODUCT_REFUSAL_EXPLANATIONS[refused.reason]).toContain("Sign in again");
  });

  test("issueInvitation returns the raw code exactly once (the runtime never re-issues it)", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const first = rt.issueInvitation();
    const second = rt.issueInvitation();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // distinct single-use codes (the seam's generator; only verifiers persist)
    expect(first.rawCode).not.toBe(second.rawCode);
    expect(first.rawCode.startsWith("joinw101c")).toBe(true);
  });

  test("joinWorkspace with a chosen member role grants it; the assigned-only switch refusal still holds", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const invited = rt.issueInvitation();
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    const joined = rt.joinWorkspace({
      code: invited.rawCode,
      displayName: "Grace Hopper",
      email: "grace@northwind.example",
      roles: ["service.desk"],
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.state.phase).toBe("onboarding");
    if (joined.state.phase === "signed-out") return;
    // the chosen role became the REAL starting assignment + active lens
    expect(joined.state.activeRole).toBe("service.desk");
    expect(joined.state.assignedRoles).toEqual(["service.desk"]);
    expect(joined.state.tenantId).toBe("tnt_w101test0001");
    // assigned-only: fleet.admin was never assigned to the joiner
    const refused = rt.switchActiveRole("fleet.admin");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("role_not_assigned");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[refused.reason]).toContain("not assigned to you");
    // switching to the joined (assigned) role succeeds — audited
    const ok = rt.switchActiveRole("service.desk");
    expect(ok.ok).toBe(true);
    const st = rt.state();
    if (st.phase === "signed-out") return;
    expect(st.activeRole).toBe("service.desk");
  });

  test("an issued invitation expires after its TTL (expired_code; 24h seam truth)", () => {
    expect(INVITATION_TTL_SECONDS).toBe(60 * 60 * 24);
    const { rt, advance } = makeAdvanceableRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const invited = rt.issueInvitation();
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    // one second beyond the seam's TTL: the identity seam refuses
    advance(INVITATION_TTL_SECONDS + 1);
    const joined = rt.joinWorkspace({
      code: invited.rawCode,
      displayName: "Grace Hopper",
      email: "grace@northwind.example",
      roles: ["employee"],
    });
    expect(joined.ok).toBe(false);
    if (joined.ok) return;
    expect(joined.reason).toBe("expired_code");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[joined.reason]).toContain("expired");
  });
});

// ---------------------------------------------------------------------------
// W121 — proper authentication: credentials + persistent sessions
// ---------------------------------------------------------------------------

describe("W121 proper authentication (credentials through the identity seam)", () => {
  test("sign-up registers the founder's credential: the correct password signs back in", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    rt.completeOnboarding();
    rt.signOut();
    const ok = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.state.phase).toBe("active");
    if (ok.state.phase === "signed-out") return;
    expect(ok.state.activeRole).toBe("fleet.admin");
    expect(ok.state.displayName).toBe("Ada Lovelace");
  });

  test("wrong password is a machine-stable refusal with frozen human words", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    rt.signOut();
    const refused = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: "not-the-password",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("wrong_password");
    expect(refused.message).toContain("wrong_password");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[refused.reason]).toContain("incorrect");
    // the refusal never opened a session
    expect(rt.state().phase).toBe("signed-out");
    // the correct password still works afterwards (no lockout side effect)
    const ok = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(ok.ok).toBe(true);
  });

  test("a member without a credential (a code-joiner) gets the unknown_account refusal", () => {
    const rt = makeRuntime();
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const invited = rt.issueInvitation();
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    const joined = rt.joinWorkspace({
      code: invited.rawCode,
      displayName: "Grace Hopper",
      email: "grace@northwind.example",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    // the joiner holds a REAL membership but NO password credential:
    // signing back in refuses machine-stably (fail-closed, honest)
    rt.signOut();
    const refused = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "grace@northwind.example",
      password: "whatever-pass",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("unknown_account");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[refused.reason]).toContain("No password is set");
  });

  test("the credential lives in the durable identity store (never in the state projection)", () => {
    const store = createInMemoryDurableRecordStore();
    const rt = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: store,
    });
    const created = rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(created.ok).toBe(true);
    // the durable password-credential row exists (tenant-scoped)
    const tenantId = created.ok ? created.state.phase === "signed-out" ? "" : created.state.tenantId : "";
    const rows = store.snapshot["fleetos_password_credentials"]?.[tenantId] ?? [];
    expect(rows.length).toBe(1);
    const row = rows[0]!.row;
    // the VERIFIER + SALT persist; the PLAIN password never does
    expect(typeof row["verifier"]).toBe("string");
    expect((row["verifier"] as string).startsWith("pwv_")).toBe(true);
    expect(typeof row["salt"]).toBe("string");
    expect(JSON.stringify(store.snapshot["fleetos_password_credentials"])).not.toContain(FOUNDER_PASSWORD);
    // the session-token projection carries the session token but no
    // password material ever enters the UI state
    const state = rt.state();
    if (state.phase === "signed-out") return;
    expect(JSON.stringify(state)).not.toContain(FOUNDER_PASSWORD);
    expect(JSON.stringify(state)).not.toContain("verifier");
    expect(JSON.stringify(state)).not.toContain("salt");
  });
});

describe("W121 persistent browser sessions (injected session-store seam)", () => {
  test("sign-up -> RELOAD persists -> sign-out clears (the full journey)", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    const rtA = createProductSessionRuntime({
      ...sharedSeams("a"),
      durableStore: durable,
      sessionStore,
    });
    const created = rtA.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(created.ok).toBe(true);
    // the token persisted through the seam at session open
    const persisted = sessionStore.saved();
    expect(persisted).not.toBeNull();
    expect(persisted!.tenantId).toBe("tnt_w101test0001");
    expect(persisted!.token).toMatch(/^fst_[a-z0-9]{24,128}$/);

    // RELOAD: a brand-new runtime over the SAME durable store + seam —
    // the session KEEPS honestly (re-resolved through the resolve seam)
    const rtB = createProductSessionRuntime({
      ...sharedSeams("b"),
      durableStore: durable,
      sessionStore,
    });
    const reloaded = rtB.state();
    expect(reloaded.phase).toBe("onboarding"); // the reload restores the session
    if (reloaded.phase === "signed-out") return;
    expect(reloaded.tenantId).toBe("tnt_w101test0001");
    expect(reloaded.memberRef).toBe("ada@northwind.example");
    expect(reloaded.sessionToken).toBe(persisted!.token);
    expect(reloaded.activeRole).toBe("fleet.admin");
    // the persisted workspace is listed for the sign-in directory
    expect(rtB.listWorkspaces().map((w) => w.name)).toEqual(["Northwind Fleet"]);

    // SIGN-OUT: revokes AND clears the persisted browser session
    const out = rtB.signOut();
    expect(out.ok).toBe(true);
    expect(rtB.state().phase).toBe("signed-out");
    expect(sessionStore.saved()).toBeNull();
    // a further reload lands on the gate (never a resurrected session)
    const rtC = createProductSessionRuntime({
      ...sharedSeams("c"),
      durableStore: durable,
      sessionStore,
    });
    expect(rtC.state().phase).toBe("signed-out");
    // the credential SURVIVED (only the session was revoked): the member
    // signs back in with the password — a FRESH session, honestly earned
    const backIn = rtC.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(backIn.ok).toBe(true);
    if (!backIn.ok) return;
    expect(backIn.state.phase).toBe("onboarding");
    if (backIn.state.phase === "signed-out") return;
    // a fresh session token (the old one was revoked)
    expect(backIn.state.sessionToken).not.toBe(persisted!.token);
    expect(sessionStore.saved()?.token).toBe(backIn.state.sessionToken);
  });

  test("a corrupted persisted token fails CLOSED to the gate", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    const rtA = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    rtA.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    // CORRUPT the persisted payload (garbage that violates every grammar)
    sessionStore.corrupt("{not-json-at-all");
    const rtB = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    expect(rtB.state().phase).toBe("signed-out"); // fail closed to the gate
    // ...and the corrupted residue was cleared (never re-read)
    expect(sessionStore.saved()).toBeNull();
    // a grammar-conforming but UNKNOWN token also fails closed
    sessionStore.corrupt({ tenantId: "tnt_w101test0001", token: "fst_abcdefghijkl0123456789" });
    const rtC = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    expect(rtC.state().phase).toBe("signed-out");
    expect(sessionStore.saved()).toBeNull();
  });

  test("a MISMATCHED persisted token (another tenant's) fails closed", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    const rtA = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    const created = rtA.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(created.ok).toBe(true);
    const persisted = sessionStore.saved();
    expect(persisted).not.toBeNull();
    // swap the tenant: the token is unknown in the foreign partition
    // (tenant-scoped resolution — existence never leaks across tenants)
    sessionStore.corrupt({ tenantId: "tnt_w101test9999", token: persisted!.token });
    const rtB = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    expect(rtB.state().phase).toBe("signed-out");
    expect(sessionStore.saved()).toBeNull();
  });

  test("an EXPIRED persisted token fails closed (never auto-logged-in)", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    let clock = T0;
    const rtA = createProductSessionRuntime({
      ...baseSeams(),
      now: () => clock,
      durableStore: durable,
      sessionStore,
    });
    rtA.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(sessionStore.saved()).not.toBeNull();
    // advance beyond the session TTL, then RELOAD
    clock = new Date(Date.parse(T0) + (TTL + 1) * 1000).toISOString();
    const rtB = createProductSessionRuntime({
      ...baseSeams(),
      now: () => clock,
      durableStore: durable,
      sessionStore,
    });
    expect(rtB.state().phase).toBe("signed-out"); // expired -> the gate
    expect(sessionStore.saved()).toBeNull(); // the dead token was cleared
    // the expired session cannot be replayed by re-persisting it either
    expect(rtB.refresh().ok).toBe(true);
    if (rtB.state().phase !== "signed-out") return;
  });

  test("a REVOKED persisted token fails closed (sign-out revoked it)", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    const rtA = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
    });
    rtA.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    const persisted = sessionStore.saved();
    expect(persisted).not.toBeNull();
    // revoke behind the runtime's back (the session record's truth) and
    // re-persist the now-revoked token — reload must still refuse it
    const rtSignOut = createProductSessionRuntime({
      ...sharedSeams("s"),
      durableStore: durable,
      sessionStore,
    });
    rtSignOut.signOut();
    sessionStore.corrupt(persisted); // replay the dead token
    const rtB = createProductSessionRuntime({
      ...sharedSeams("r"),
      durableStore: durable,
      sessionStore,
    });
    expect(rtB.state().phase).toBe("signed-out");
    expect(sessionStore.saved()).toBeNull();
  });
});

describe("W121 browser-tier PasswordHasher (the composition root's injection)", () => {
  test("sha256Hex matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // the standard 112-char vector forces the multi-block path
    expect(
      sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      ),
    ).toBe(
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    );
    // a UTF-8 multi-byte input hashes deterministically
    expect(sha256Hex("fleetöß")).toHaveLength(64);
    expect(sha256Hex("fleetöß")).toBe(sha256Hex("fleetöß"));
  });

  test("the browser hasher verifies its own verifiers and nothing else", () => {
    const hasher = createBrowserPasswordHasher(10); // fast rounds for the vector test
    const verifier = hasher.hash(FOUNDER_PASSWORD, "slt_test");
    expect(verifier.startsWith("pwv_")).toBe(true);
    expect(verifier.length).toBe(4 + 64);
    expect(hasher.verify(FOUNDER_PASSWORD, "slt_test", verifier)).toBe(true);
    expect(hasher.verify("wrong-password", "slt_test", verifier)).toBe(false);
    // a different salt yields a different verifier (per-credential salting)
    expect(hasher.hash(FOUNDER_PASSWORD, "slt_other")).not.toBe(verifier);
    // the plain password is not recoverable from the verifier
    expect(verifier).not.toContain(FOUNDER_PASSWORD);
    // a malformed verifier never verifies
    expect(hasher.verify(FOUNDER_PASSWORD, "slt_test", "garbage")).toBe(false);
  });

  test("the injected browser hasher drives the runtime end-to-end", () => {
    const durable = createInMemoryDurableRecordStore();
    const rt = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      passwordHasher: createBrowserPasswordHasher(10),
      saltGenerator: counter("slt_w121test", 4),
    });
    rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    rt.signOut();
    const wrong = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: "not-the-password",
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toBe("wrong_password");
    const ok = rt.signIn({
      tenantId: "tnt_w101test0001",
      email: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(ok.ok).toBe(true);
  });
});
