/**
 * W122 — the demo persona SESSION surface (machine tests over the REAL
 * product session runtime + the REAL identity seams).
 *
 * The demo personas are pre-seeded principals of the dedicated demo
 * tenant (tnt_w091demo000001), one per experience role. The one-click
 * quick link is the SANCTIONED ENTRY: `openDemoPersonaSession` opens
 * the persona's session through the SAME session-open seam as
 * create/join/sign-in (no second auth path — the personas carry NO
 * password credentials, and password sign-in for them fails closed
 * with the machine-stable unknown_account refusal).
 *
 * The demo tenant is a TENANT: its sessions flow the REAL lifecycle
 * (open -> resolve/refresh -> expire -> revoke) with no special-cased
 * demo branch; the seeding is lazy + idempotent over the shared
 * durable store; and the workspace DIRECTORY never lists the demo
 * tenant (the quick links are the only demo door — the isolation law).
 */

import { describe, test, expect } from "bun:test";
import {
  createProductSessionRuntime,
  INVITATION_TTL_SECONDS,
} from "../src/runtime/product-session";
import type { ProductRuntimeSeams } from "../src/runtime/product-session";
import {
  DEMO_PERSONAS,
  DEMO_WORKSPACE_NAME,
  TENANT_ID,
} from "../src/runtime/demo-fleet";
import {
  PRODUCT_EXPERIENCE_ROLES,
  PRODUCT_REFUSAL_EXPLANATIONS,
} from "@fleetos/web-product";
import type { ProductSessionSeams, ProductSessionStore, ProductPersistedSession } from "@fleetos/web-product";
import { createInMemoryDurableRecordStore } from "@fleetos/identity";

const T0 = "2026-10-01T09:00:00Z";
const TTL = 60 * 60;
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
    tenantId: counter("tnt_w122test", 4),
    joinCode: counter("joinw122c", 6),
    sessionToken: counter("fst_w122test", 19),
    correlationId: counter("cor_w122t", 6),
  };
}

/** A runtime with an ADVANCEABLE clock (the expiry test's seam). */
function makeAdvanceableRuntime(): {
  readonly rt: ReturnType<typeof makeRuntime>;
  readonly advance: (seconds: number) => void;
} {
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

function makeRuntime() {
  return createProductSessionRuntime(baseSeams());
}

/** The in-memory session store seam fake (the persistence journey). */
function makeSessionStore(): ProductSessionStore & {
  readonly saved: () => ProductPersistedSession | null;
} {
  let held: ProductPersistedSession | null = null;
  return {
    save: (session: ProductPersistedSession | null): void => {
      held = session;
    },
    load: (): ProductPersistedSession | null => held,
    saved: () => held,
  };
}

describe("W122 demoPersonas — the catalog the sign-in quick links render", () => {
  test("exactly one persona per frozen experience role, honest Demo-prefixed display names", () => {
    const rt = makeRuntime();
    const personas = rt.demoPersonas();
    expect(personas.map((p) => p.role)).toEqual([...PRODUCT_EXPERIENCE_ROLES]);
    for (const persona of personas) {
      expect(persona.displayName.startsWith("Demo — ")).toBe(true);
      expect(persona.workspaceName).toBe(DEMO_WORKSPACE_NAME);
      // The catalog is the frozen seed (deterministic across runtimes).
      const seed = DEMO_PERSONAS.find((p) => p.personaId === persona.personaId);
      expect(seed).toBeDefined();
      expect(seed!.displayName).toBe(persona.displayName);
    }
    // A fresh runtime composes the catalog WITHOUT seeding anything.
    expect(rt.state().phase).toBe("signed-out");
    expect(rt.listWorkspaces()).toEqual([]);
  });
});

describe("W122 openDemoPersonaSession — the sanctioned entry through the same session-open seam", () => {
  test("every persona opens the demo workspace session with its role, name and tenant", () => {
    for (const persona of DEMO_PERSONAS) {
      const rt = makeRuntime();
      const opened = rt.openDemoPersonaSession(persona.personaId);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.state.phase).toBe("onboarding");
      if (opened.state.phase === "signed-out") return;
      expect(opened.state.tenantId).toBe(TENANT_ID);
      expect(opened.state.workspaceName).toBe(DEMO_WORKSPACE_NAME);
      expect(opened.state.memberRef).toBe(persona.memberRef);
      expect(opened.state.displayName).toBe(persona.displayName);
      expect(opened.state.activeRole).toBe(persona.role);
      expect(opened.state.assignedRoles).toEqual([persona.role]);
      expect(opened.state.sessionToken).toMatch(/^fst_/);
      // The session persists through the injected store seam (the same
      // W121 reload honesty as any session).
      expect(rt.state().phase).toBe("onboarding");
    }
  });

  test("the demo tenant is seeded LAZILY + IDEMPOTENTLY (re-opening keeps one workspace, one assignment each)", () => {
    const rt = makeRuntime();
    const first = rt.openDemoPersonaSession("demo-fleet-admin");
    expect(first.ok).toBe(true);
    rt.signOut();
    const second = rt.openDemoPersonaSession("demo-employee");
    expect(second.ok).toBe(true);
    // The demo workspace stays OUT of the directory (the quick links
    // are the only door) and the assignment set stays one per persona.
    expect(rt.listWorkspaces()).toEqual([]);
    if (!second.ok) return;
    expect(second.state.phase === "signed-out").toBe(false);
    if (second.state.phase !== "signed-out") {
      expect(second.state.assignedRoles).toEqual(["employee"]);
      expect(second.state.tenantId).toBe(TENANT_ID);
    }
  });

  test("an unknown persona id is a machine-stable refusal (fail-closed)", () => {
    const rt = makeRuntime();
    for (const bad of ["", "nobody", "demo-fleet-admin ", "demo-hacker"]) {
      const refused = rt.openDemoPersonaSession(bad);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.reason).toBe("invalid_input");
      expect(refused.message).toContain(bad.trim().length > 0 ? bad.trim() : "unknown demo persona");
    }
    // The refusal never opened anything or seeded the tenant.
    expect(rt.state().phase).toBe("signed-out");
    expect(rt.listWorkspaces()).toEqual([]);
  });

  test("the demo personas carry NO passwords: password sign-in fails closed (no second auth path)", () => {
    const rt = makeRuntime();
    // Seed the demo tenant through the sanctioned entry, then leave.
    expect(rt.openDemoPersonaSession("demo-fleet-admin").ok).toBe(true);
    rt.signOut();
    // Any password attempt for a demo persona is REFUSED: the persona
    // has no credential (unknown_account — the frozen human words).
    const attempt = rt.signIn({
      tenantId: TENANT_ID,
      email: "demo.fleet.admin@fleetos.demo",
      password: "any-password-at-all",
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.reason).toBe("unknown_account");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[attempt.reason]).toContain("No password is set");
    expect(rt.state().phase).toBe("signed-out");
  });
});

describe("W122 the demo tenant is a tenant (the REAL session lifecycle, no demo branch)", () => {
  test("refresh resolves; expiry moves the demo session to expired; recovery returns to the gate", () => {
    const { rt, advance } = makeAdvanceableRuntime();
    expect(rt.openDemoPersonaSession("demo-security-compliance").ok).toBe(true);
    const refreshed = rt.refresh();
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok && refreshed.state.phase !== "signed-out") {
      expect(refreshed.state.tenantId).toBe(TENANT_ID);
      expect(refreshed.state.activeRole).toBe("security.compliance");
    }
    // Expiry is enforced through the resolve seam like any session.
    advance(TTL + 1);
    const expired = rt.refresh();
    expect(expired.ok).toBe(true);
    if (expired.ok) expect(expired.state.phase).toBe("expired");
    const st = rt.state();
    expect(st.phase).toBe("expired");
    if (st.phase !== "signed-out") {
      expect(st.tenantId).toBe(TENANT_ID);
      expect(st.workspaceName).toBe(DEMO_WORKSPACE_NAME);
    }
    // Recovery clears the dead session (back to the gate).
    const recovered = rt.signOut();
    expect(recovered.ok).toBe(true);
    expect(rt.state().phase).toBe("signed-out");
  });

  test("sign-out revokes the demo session; the revoked token can never re-enter", () => {
    const durable = createInMemoryDurableRecordStore();
    // A session-store fake whose load can be overridden (to re-present
    // the REVOKED token to a fresh runtime — the fail-closed check).
    let held: ProductPersistedSession | null = null;
    let override: { readonly present: boolean; readonly value: unknown } = { present: false, value: null };
    const sessionStore: ProductSessionStore = {
      save: (session: ProductPersistedSession | null): void => {
        held = session;
      },
      load: (): ProductPersistedSession | null =>
        override.present ? (override.value as ProductPersistedSession | null) : held,
    };
    const rt = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
      sessionToken: counter("fst_w122rvk", 20),
      sessionId: counter("ses_w122rvk", 16),
    });
    expect(rt.openDemoPersonaSession("demo-team-manager").ok).toBe(true);
    const st = rt.state();
    expect(st.phase).toBe("onboarding");
    if (st.phase === "signed-out") return;
    const revokedToken = st.sessionToken;
    rt.signOut();
    expect(rt.state().phase).toBe("signed-out");
    expect(held).toBeNull();
    // A NEW runtime over the same durable store + a re-presented
    // REVOKED token fails CLOSED to the gate (the W121 law — the demo
    // tenant's revoked sessions get no pass; the dead residue clears).
    override = { present: true, value: { tenantId: TENANT_ID, token: revokedToken } };
    const rtNext = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
      sessionToken: counter("fst_w122rvn", 20),
      sessionId: counter("ses_w122rvn", 16),
    });
    expect(rtNext.state().phase).toBe("signed-out");
    // Re-open works (a FRESH session through the sanctioned entry —
    // the previous token stays revoked, a new one is minted).
    const again = rt.openDemoPersonaSession("demo-team-manager");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    if (again.state.phase === "signed-out") return;
    expect(again.state.sessionToken).not.toBe(revokedToken);
  });

  test("the demo session persists through reload (the W121 seam — the demo tenant is a tenant)", () => {
    const durable = createInMemoryDurableRecordStore();
    const sessionStore = makeSessionStore();
    const rtA = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
      sessionToken: counter("fst_w122rta", 20),
      sessionId: counter("ses_w122rta", 16),
    });
    expect(rtA.openDemoPersonaSession("demo-vendor-operator").ok).toBe(true);
    const persisted = sessionStore.saved();
    expect(persisted).not.toBeNull();
    expect(persisted!.tenantId).toBe(TENANT_ID);
    // RELOAD: a brand-new runtime over the SAME seams re-enters the
    // demo session honestly (re-resolved through the resolve seam).
    const rtB = createProductSessionRuntime({
      ...baseSeams(),
      durableStore: durable,
      sessionStore,
      sessionToken: counter("fst_w122rtb", 20),
      sessionId: counter("ses_w122rtb", 16),
    });
    const reloaded = rtB.state();
    expect(reloaded.phase).toBe("onboarding");
    if (reloaded.phase === "signed-out") return;
    expect(reloaded.tenantId).toBe(TENANT_ID);
    expect(reloaded.memberRef).toBe("demo.vendor.operator@fleetos.demo");
    expect(reloaded.activeRole).toBe("vendor.operator");
    expect(reloaded.sessionToken).toBe(persisted!.token);
    // The directory still lists NO demo tenant after the reload.
    expect(rtB.listWorkspaces()).toEqual([]);
  });

  test("the audited role switch works inside the demo session (assigned-only, like any tenant)", () => {
    const rt = makeRuntime();
    expect(rt.openDemoPersonaSession("demo-fleet-admin").ok).toBe(true);
    // Only fleet.admin is assigned to the admin persona — switching to
    // another role is the machine-stable role_not_assigned refusal.
    const refused = rt.switchActiveRole("employee");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("role_not_assigned");
    // Switching to the persona's OWN assigned role succeeds (audited).
    const same = rt.switchActiveRole("fleet.admin");
    expect(same.ok).toBe(true);
  });
});

describe("W122 the isolation law at the session layer (the directory + coexistence)", () => {
  test("the demo tenant NEVER appears in the workspace directory — before, during or after demo sessions", () => {
    const rt = makeRuntime();
    expect(rt.listWorkspaces()).toEqual([]);
    expect(rt.openDemoPersonaSession("demo-employee").ok).toBe(true);
    expect(rt.listWorkspaces()).toEqual([]);
    rt.signOut();
    expect(rt.listWorkspaces()).toEqual([]);
  });

  test("a REAL workspace coexists with the demo tenant: the directory lists only the real one", () => {
    const rt = makeRuntime();
    const created = rt.createWorkspace({
      name: "Northwind Fleet",
      founderDisplayName: "Ada Lovelace",
      founderEmail: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(created.ok).toBe(true);
    expect(rt.listWorkspaces().map((w) => w.name)).toEqual(["Northwind Fleet"]);
    // A demo quick link opens the demo tenant (the shared store holds
    // both); the directory still lists ONLY the real workspace.
    expect(rt.openDemoPersonaSession("demo-fleet-admin").ok).toBe(true);
    expect(rt.listWorkspaces().map((w) => w.name)).toEqual(["Northwind Fleet"]);
    rt.signOut();
    // The real workspace's sign-in still works (its credential is
    // untouched by the demo seeding).
    const backIn = rt.signIn({
      tenantId: "tnt_w122test0001",
      email: "ada@northwind.example",
      password: FOUNDER_PASSWORD,
    });
    expect(backIn.ok).toBe(true);
    if (backIn.ok && backIn.state.phase !== "signed-out") {
      expect(backIn.state.tenantId).toBe("tnt_w122test0001");
      expect(backIn.state.activeRole).toBe("fleet.admin");
    }
    expect(rt.listWorkspaces().map((w) => w.name)).toEqual(["Northwind Fleet"]);
  });

  test("the invitation TTL seam stays untouched (the demo surface adds no join-code path)", () => {
    expect(INVITATION_TTL_SECONDS).toBe(60 * 60 * 24);
  });
});
