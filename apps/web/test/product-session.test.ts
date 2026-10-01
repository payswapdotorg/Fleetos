/**
 * W101 web-product — the product session runtime over the REAL W100C
 * identity services: the full product journey (create workspace ->
 * onboarding -> active; join via one-time code; sign-in of a known
 * member; audited role switch; assigned-only switch refusal; session
 * expiry -> recovery; sign-out revocation), all fail-closed refusals
 * machine-stable with frozen human explanations, and every timestamp
 * injected (deterministic — the generator sequences are counters).
 */

import { describe, test, expect } from "bun:test";
import { createProductSessionRuntime } from "../src/runtime/product-session";
import {
  PRODUCT_REFUSAL_EXPLANATIONS,
  operatorRoleFor,
  isRestrictedExperienceRole,
  searchResultContextFor,
} from "@fleetos/web-product";
import type { ProductSessionSeams } from "@fleetos/web-product";

const T0 = "2026-10-01T09:00:00Z";
const TTL = 60 * 60; // one hour

function counter(prefix: string, pad: number): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n).padStart(pad, "0")}`;
  };
}

/** A runtime with the deterministic reference seams (fixed clock T0). */
function makeRuntime() {
  return createProductSessionRuntime({
    now: () => T0,
    ttlSeconds: TTL,
    tenantId: counter("tnt_w101test", 4),
    joinCode: counter("joinw101c", 6),
    sessionToken: counter("fst_w101test", 19),
    correlationId: counter("cor_w101t", 6),
  });
}

/** A runtime with an ADVANCEABLE clock (the expiry test's seam). */
function makeAdvanceableRuntime(): { readonly rt: ReturnType<typeof makeRuntime>; readonly advance: (seconds: number) => void } {
  let clock = T0;
  const rt = createProductSessionRuntime({
    now: () => clock,
    ttlSeconds: TTL,
    tenantId: counter("tnt_w101test", 4),
    joinCode: counter("joinw101c", 6),
    sessionToken: counter("fst_w101test", 19),
    correlationId: counter("cor_w101t", 6),
  });
  return {
    rt,
    advance: (seconds: number) => {
      clock = new Date(Date.parse(clock) + seconds * 1000).toISOString();
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
    });
    rt.completeOnboarding();
    rt.signOut();
    // unknown workspace
    const badWs = rt.signIn({ tenantId: "tnt_missing0001", email: "ada@northwind.example" });
    expect(badWs.ok).toBe(false);
    if (badWs.ok) return;
    expect(badWs.reason).toBe("unknown_workspace");
    // unknown principal
    const badUser = rt.signIn({ tenantId: "tnt_w101test0001", email: "nobody@northwind.example" });
    expect(badUser.ok).toBe(false);
    if (badUser.ok) return;
    expect(badUser.reason).toBe("unknown_principal");
    expect(PRODUCT_REFUSAL_EXPLANATIONS[badUser.reason]).toContain("invite you");
    // a known member signs back in (onboarding already completed here)
    const ok = rt.signIn({ tenantId: "tnt_w101test0001", email: "ada@northwind.example" });
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
    });
    rt.completeOnboarding();
    expect(rt.state().phase).toBe("active");
    // advance beyond the TTL: the resolve truth flips to expired
    advance(TTL + 1);
    const refreshed = rt.refresh();
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.state.phase).toBe("expired");
    // recovery: sign back in (a FRESH session — distinct token, same member)
    const recovered = rt.signIn({ tenantId: "tnt_w101test0001", email: "ada@northwind.example" });
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
    });
    const out = rt.signOut();
    expect(out.ok).toBe(true);
    expect(rt.state().phase).toBe("signed-out");
  });

  test("empty-input refusals are machine-stable", () => {
    const rt = makeRuntime();
    const noName = rt.createWorkspace({ name: "  ", founderDisplayName: "x", founderEmail: "y" });
    expect(noName.ok).toBe(false);
    if (noName.ok) return;
    expect(noName.reason).toBe("invalid_input");
    const noCode = rt.joinWorkspace({ code: "", displayName: "x", email: "y" });
    expect(noCode.ok).toBe(false);
    if (noCode.ok) return;
    expect(noCode.reason).toBe("invalid_input");
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
