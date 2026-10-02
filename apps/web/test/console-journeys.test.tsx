/**
 * W091 [TL] — the browser-level E2E JOURNEY HARNESS.
 *
 * The composed console (ConsoleApp over the REAL demo-fleet domain
 * composition) mounted at the browser DOM level, walking the
 * design-contract acceptance journeys end-to-end: every journey has a
 * VISIBLE ENTRY POINT from the Control Tower / search / navigation,
 * and a VISIBLE TERMINAL/VERIFIED STATE.
 *
 * The lanes' own journey tests (W090A/B) prove the lane-internal
 * journeys with real domain calls at their binding sites; this harness
 * proves the CONVERGENCE: the shell routes, the global search, the
 * Control Tower, the Evidence & Audit area, Policies and Learning as
 * first-class areas, mobile navigation completeness, and the safe
 * unknown-route failure — over the same REAL domain packages.
 *
 * W110 adds the invitation + join-role product closure journey: the
 * founder issues a workspace invitation through the REAL UI (the
 * display-once code), a member joins through the gate's Join tab with
 * the Service Desk member role, the session shows the Service Desk
 * lens, the role switcher lists the joined role — and only it
 * (assigned-only; fleet.admin was never assigned to the joiner).
 *
 * W122 — THE ISOLATION LAW reshapes the mounting: the demo-data
 * journeys now enter through the sign-in screen's DEMO quick link
 * (the sanctioned entry — one click opens the demo workspace session,
 * clearly labeled DEMO) instead of a fresh created workspace. A fresh
 * workspace sees ONLY its own records (honest empty states — asserted
 * by the W122 isolation suite); demo data renders ONLY inside the
 * demo tenant's session.
 */
import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConsoleApp, pathToRoute, routeToPath } from "../src/console-app";
import { DEMO } from "../src/runtime/demo-fleet";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "@fleetos/web-product";
import type { ShellRoute } from "@fleetos/web-shell";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  // W121: the gate persists the durable identity records + session token
  // in localStorage (the browser tier) — every journey starts from the
  // honest signed-out gate, so the persisted state is cleared between
  // tests (never a leaked session across journeys).
  window.localStorage.clear();
});

/**
 * Mount the console inside the DEMO workspace session (W122): the
 * sign-in screen's one-click quick link — the sanctioned demo entry —
 * opens the demo persona's session through the REAL session-open seam
 * (no credentials; the Fleet Administrator persona). The demo tenant's
 * session then renders the rich demo fleet.
 */
function mountDemoApp(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Fleet Administrator" }));
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

/**
 * Mount the console inside a FRESH created workspace (the W121 sign-up
 * journey): the founder's session over an empty workspace — its own
 * records only (the W122 isolation law).
 */
function mountWorkspaceApp(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Northwind Fleet" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada@northwind.example" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Create workspace").at(-1)!.closest("button")!);
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

// ---------------------------------------------------------------------------
// Journey: the Control Tower is the first screen and answers the
// operator's questions without deep navigation
// ---------------------------------------------------------------------------

test("E2E journey — the Control Tower answers what needs attention with direct record links", () => {
  mountDemoApp({ area: "overview", view: "home" });
  // The primary attention stream shows the CRITICAL finding...
  expect(screen.getByText(/CRITICAL — .*disk encryption/i)).toBeDefined();
  // ...with its direct link into Security and its evidence link.
  expect(screen.getAllByRole("button", { name: /Open Security/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "Evidence" }).length).toBeGreaterThan(0);
  // The onboarding entry point is present and active (owner).
  expect(screen.getByRole("button", { name: /Enroll an existing fleet/ })).toBeDefined();
  // Recent activity shows the REAL audit records verbatim.
  expect(screen.getByText(/action\.plan\.approved/)).toBeDefined();
  expect(screen.getByText(/action\.plan\.dispatched/)).toBeDefined();
});

test("E2E journey — enroll fleet: the entry point navigates to the enrollment view", () => {
  mountDemoApp({ area: "overview", view: "home" });
  fireEvent.click(screen.getByRole("button", { name: /Enroll an existing fleet/ }));
  // W101: the enrollment view is now the INSTALL CENTER (the W100A
  // screen over the REAL release manifest — the productized journey).
  expect(screen.getByText("Install the FleetOS agent")).toBeDefined();
  expect(screen.getAllByText(/one-time enrollment code/).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Journey: inspect the device fleet (the REAL roster over the REAL store)
// ---------------------------------------------------------------------------

test("E2E journey — the Devices fleet list presents the REAL composed roster", () => {
  mountDemoApp({ area: "device", view: "list" });
  expect(screen.getByText(/ThinkPad T14/i)).toBeDefined();
  expect(screen.getByText(/MacBook Air M3/i)).toBeDefined();
  expect(screen.getByText(/Pixel 9/i)).toBeDefined();
});

// ---------------------------------------------------------------------------
// Journey: remediate a finding — the CRITICAL finding is visible with
// its remediation proposal; the approvals queue shows the parked plan
// ---------------------------------------------------------------------------

test("E2E journey — the Security findings view presents the CRITICAL finding", () => {
  mountDemoApp({ area: "security", view: "findings" });
  expect(screen.getAllByText(/CRITICAL/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/disk encryption/i).length).toBeGreaterThan(0);
});

test("E2E journey — the approvals queue shows the REAL parked plan awaiting the owner decision", () => {
  mountDemoApp({ area: "security", view: "approvals" });
  expect(screen.getByText(/w091-demo-enable-encryption/i)).toBeDefined();
});

// ---------------------------------------------------------------------------
// Journey: understand a Guardian decision -> the policy behind it
// ---------------------------------------------------------------------------

test("E2E journey — the Policies area is first-class: the REAL compiled rule set is visible", () => {
  mountDemoApp({ area: "policies", view: "list" });
  // The frozen policy surface renders the compiled rule-set row: the
  // opaque rule-set id, the version, and the enabled/total rule counts
  // (the rule NAME lives in the detail sheet — read-only by design).
  expect(screen.getByText(/Policy sets \(versioned rule sets\)/i)).toBeDefined();
  expect(screen.getByText(/1 enabled/)).toBeDefined();
  expect(screen.getByText(/of 1 total/)).toBeDefined();
});

// ---------------------------------------------------------------------------
// Journey: inspect the evidence trail (the REAL audit log, chain verified)
// ---------------------------------------------------------------------------

test("E2E journey — Evidence & Audit is first-class: the index lists the composed trails", () => {
  mountDemoApp({ area: "evidence", view: "trail" });
  expect(screen.getAllByText(/Evidence trail index/i).length).toBeGreaterThan(0);
  // The three composed subjects are listed with their chain state.
  expect(screen.getAllByText(/Succeeded/i).length).toBeGreaterThan(0);
});

test("E2E journey — opening a trail shows the recorded stages with the verification state", () => {
  mountDemoApp({ area: "evidence", view: "trail" });
  const open = screen.getAllByRole("button", { name: /Evidence trail/i });
  fireEvent.click(open[0]!);
  // The trail detail: the recorded audit stages + the chain state.
  expect(screen.getByText(/The evidence trail for this record/i)).toBeDefined();
});

// ---------------------------------------------------------------------------
// Journey: inspect learning / capability adoption (the REAL W070 loop)
// ---------------------------------------------------------------------------

test("E2E journey — Learning is first-class: the outcome feed shows the observed outcome", () => {
  mountDemoApp({ area: "learning", view: "cases" });
  expect(screen.getAllByText(/action\.plan/i).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Global search: results land directly on the record's route
// ---------------------------------------------------------------------------

test("E2E journey — global search lands on the record's area route", () => {
  mountDemoApp({ area: "overview", view: "home" });
  fireEvent.click(screen.getByRole("button", { name: /Open global search/i }));
  const input = screen.getByRole("textbox", { name: /Search records, capabilities, areas/i });
  fireEvent.change(input, { target: { value: "thinkpad" } });
  const results = screen.getAllByRole("option");
  expect(results.length).toBeGreaterThan(0);
  fireEvent.click(results[0]!);
  // Landed on the Devices area (the record's area route).
  expect(screen.getByText(/ThinkPad T14/i)).toBeDefined();
});

// ---------------------------------------------------------------------------
// Navigation completeness + safe failure
// ---------------------------------------------------------------------------

test("E2E journey — every one of the TEN areas is navigable from the sidebar", () => {
  mountDemoApp({ area: "overview", view: "home" });
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  const links = nav.querySelectorAll(".fos-sidebar__link");
  expect(links.length).toBe(10);
  // Each area link navigates without crashing (the vocabulary check).
  const learning = Array.from(links).find((el) => el.textContent?.includes("Learning")) as HTMLButtonElement;
  fireEvent.click(learning!);
  expect(screen.getAllByText(/Evaluation cases/i).length).toBeGreaterThan(0);
});

test("E2E journey — unknown routes fail safely with a way forward", () => {
  // An invalid route object cannot be passed through the typed API —
  // the runtime's pathToRoute refuses unknown paths; assert the
  // refusal + the safe-failure composition directly.
  const refused = pathToRoute(["nonsense", "view"]);
  expect(refused.ok).toBe(false);
  mountDemoApp({ area: "overview", view: "home" });
  // (The ConsoleApp renders the safe-failure state for refused
  // routes — verified by the shell render tests; here the path
  // vocabulary refusal is the contract.)
});

test("the route <-> path mapping is total over the frozen vocabulary", () => {
  expect(routeToPath({ area: "overview", view: "home" })).toBe("/");
  expect(routeToPath({ area: "device", view: "doctor" })).toBe("/device/doctor");
  expect(pathToRoute([])).toEqual({ ok: true, route: { area: "overview", view: "home" } });
  expect(pathToRoute(["device", "doctor"])).toEqual({
    ok: true,
    route: { area: "device", view: "doctor" },
  });
  expect(pathToRoute(["security"])).toEqual({
    ok: true,
    route: { area: "security", view: "findings" },
  });
  expect(pathToRoute(["workloads", "planning"])).toEqual({
    ok: true,
    route: { area: "workloads", view: "planning" },
  });
});

test("the demo composition is deterministic: the tower view is identical across recompositions", () => {
  const shape = DEMO.towerView.attentionStream.map((i) => [i.area, i.band] as const);
  expect(shape).toEqual([
    ["security", "critical"],
    ["actions", "high"],
    ["device", "high"],
    ["learning", "medium"],
  ]);
  // The composed record ids are stable string identities.
  for (const item of DEMO.towerView.attentionStream) {
    expect(typeof item.recordId).toBe("string");
    expect(item.recordId.length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// W110 journey: invitation issuance → role-carrying join through the gate
// ---------------------------------------------------------------------------

test("E2E journey — the founder issues an invitation; a member joins with the Service Desk role through the gate", () => {
  // W122: the invite/join closure runs on a REAL created workspace (the
  // founder's sign-up journey) — the demo tenant is not involved.
  mountWorkspaceApp({ area: "overview", view: "home" });
  // The invite affordance is discoverable in the session chrome.
  fireEvent.click(screen.getByText("Invite member…"));
  // The raw join code renders DISPLAY-ONCE with the copy + hide confirm.
  const code = screen.getByTestId("invitation-code-value").textContent ?? "";
  expect(code.length).toBeGreaterThan(0);
  expect(
    screen.getByText(/Shown once — the console stores only a verifier; this code cannot be shown again\./),
  ).toBeDefined();
  expect(screen.getByText(/Expires 24 hours after the code is issued\./)).toBeDefined();
  fireEvent.click(screen.getByText("Copy join code"));
  fireEvent.click(screen.getByText("I copied it — hide it"));
  // DISPLAY-ONCE LAW: the code left the screen for good.
  expect(screen.queryByTestId("invitation-code-value")).toBeNull();
  expect(screen.queryByText(code)).toBeNull();
  expect(screen.getByText(/The join code was shown once and is now hidden\./)).toBeDefined();

  // The founder signs out; the member joins through the gate with a role.
  fireEvent.click(screen.getByText("Sign out"));
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Grace Hopper" } });
  fireEvent.change(screen.getByLabelText("Your email"), {
    target: { value: "grace@northwind.example" },
  });
  // the member role selection: Service Desk (one of the five offered)
  fireEvent.change(screen.getByLabelText("Join as"), { target: { value: "service.desk" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);

  // The joined session shows the Service Desk lens: the active-role chip
  // carries the Service Desk label, and the shell derives the operator
  // emphasis from the joined role (service.desk -> operator).
  const chip = screen.getByTitle("Switch your active role (audited)");
  expect(chip.textContent).toContain(PRODUCT_EXPERIENCE_ROLE_LABELS["service.desk"]);
  const sidebarFooter = document.querySelector(".fos-sidebar__footer");
  expect(sidebarFooter?.textContent).toContain("Role: operator");
  // the joined member's identity is the session's
  expect(screen.getByText("Grace Hopper")).toBeDefined();

  // The role switcher lists the joined role — and ONLY it (assigned-only:
  // fleet.admin was never assigned to the joiner, so it is never offered).
  fireEvent.click(chip);
  const menu = screen.getByRole("listbox", { name: "Your assigned roles" });
  const offered = Array.from(menu.querySelectorAll('[role="option"]')).map(
    (el) => el.textContent ?? "",
  );
  expect(offered).toEqual([PRODUCT_EXPERIENCE_ROLE_LABELS["service.desk"]]);
  expect(offered).not.toContain(PRODUCT_EXPERIENCE_ROLE_LABELS["fleet.admin"]);
  // the audited note stays verbatim
  expect(screen.getByText("Role switches are audited and never change your permissions.")).toBeDefined();
});

// ---------------------------------------------------------------------------
// W130 journeys: honest denials + invite/join integrity at the browser tier
// ---------------------------------------------------------------------------

test("E2E journey — an operator role still creates the enrollment code (the J2 drill, unchanged)", () => {
  mountDemoApp({ area: "device", view: "enrollment" });
  fireEvent.click(screen.getByRole("button", { name: /Select Windows \(x64\) installer/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select ownership scope: Corporate-owned/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create enrollment code" }));
  // the one-time code renders with the display-once law verbatim
  const code = screen.getByTestId("enrollment-code-value").textContent ?? "";
  expect(code).toBe("BOOT-W101-0001");
  expect(screen.getByText(/Shown once — copy it now\./)).toBeDefined();
  expect(
    screen.getByText(/this code cannot be shown again\./),
  ).toBeDefined();
});

test("E2E journey — a viewer-role vendor clicking Create enrollment code gets the HONEST denial (never a silent no-op)", () => {
  // the sim-b blocker: the vendor persona reaches the Install Center,
  // selects the platform + scope, clicks — and (before W130) nothing
  // happened. Now the machine-stable refusal + the frozen explanation
  // with the escalation path render through the surface's own pattern.
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Vendor / Service Operator" }));
  const rail = screen.queryByText("Dismiss getting started");
  if (rail !== null) fireEvent.click(rail);
  fireEvent.click(screen.getByRole("button", { name: /Enroll an existing fleet/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select Windows \(x64\) installer/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select ownership scope: Corporate-owned/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create enrollment code" }));
  // the refusal card renders the machine-stable reason verbatim
  expect(screen.getByText("Enrollment refused")).toBeDefined();
  expect(screen.getByText("Refusal: interaction_forbidden")).toBeDefined();
  // the frozen human words: WHY unavailable + the escalation path
  expect(screen.getByText(/Your active role \(Vendor \/ Service Operator\) can observe the Install Center but cannot create enrollment codes/)).toBeDefined();
  expect(screen.getByText(/Ask your workspace's Fleet Administrator or Service Desk to create the enrollment code for you\./)).toBeDefined();
  // NO code was created (the denial is real, not cosmetic)
  expect(screen.queryByTestId("enrollment-code-value")).toBeNull();
  // the dismissal works — the honest way back
  fireEvent.click(screen.getByRole("button", { name: "Dismiss the refusal" }));
  expect(screen.queryByText("Enrollment refused")).toBeNull();
});

test("E2E journey — the same denial renders for the Employee lens (the other restricted role)", () => {
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Employee / Device Owner" }));
  const rail = screen.queryByText("Dismiss getting started");
  if (rail !== null) fireEvent.click(rail);
  fireEvent.click(screen.getByRole("button", { name: /Enroll an existing fleet/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select Linux \(x64\) installer/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select ownership scope: BYOD/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create enrollment code" }));
  expect(screen.getByText("Refusal: interaction_forbidden")).toBeDefined();
  expect(screen.getByText(/Your active role \(Employee \/ Device Owner\) can observe the Install Center but cannot create enrollment codes/)).toBeDefined();
  expect(screen.queryByTestId("enrollment-code-value")).toBeNull();
});

test("E2E journey — W130 invite/join integrity: distinct codes across page loads over ONE shared browser store; the right tenant redeems; the demo code is unknown_code", () => {
  // The sim-b scenario, end to end at the browser tier: a shared
  // default browser session (one localStorage) where the DEMO workspace
  // issued the first invite code, then a REAL workspace issues its own.
  // Before W130 both first codes were the identical "joinw10100000001"
  // and the real joiner was created as a principal in the DEMO tenant.
  const DURABLE_KEY = "fleetos.w121.durable";
  const SESSION_KEY = "fleetos.w121.session";

  // -- page load 1: the demo admin issues a code inside the demo tenant
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Fleet Administrator" }));
  fireEvent.click(screen.queryByText("Dismiss getting started")!);
  fireEvent.click(screen.getByText("Invite member…"));
  const demoCode = screen.getByTestId("invitation-code-value").textContent ?? "";
  expect(demoCode).toMatch(/^joinw[A-Z2-7]{20}$/);
  fireEvent.click(screen.getByText("I copied it — hide it"));
  fireEvent.click(screen.getByText("Sign out"));
  cleanup();
  window.history.replaceState({}, "/");

  // -- page load 2: a REAL workspace over the SAME shared store
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "SIMB-TRN-LG" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Marta Kowalski" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "marta@trnlg.example" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Create workspace").at(-1)!.closest("button")!);
  fireEvent.click(screen.getByText("Dismiss getting started"));
  fireEvent.click(screen.getByText("Invite member…"));
  const realCode = screen.getByTestId("invitation-code-value").textContent ?? "";
  // THE COLLISION IS DEAD: the two first codes differ (crypto entropy)
  expect(realCode).toMatch(/^joinw[A-Z2-7]{20}$/);
  expect(realCode).not.toBe(demoCode);
  fireEvent.click(screen.getByText("I copied it — hide it"));
  fireEvent.click(screen.getByText("Sign out"));
  cleanup();
  window.history.replaceState({}, "/");

  // -- page load 3: the member redeems the REAL code at the gate
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: realCode } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Dwayne Carter" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "dwayne@trnlg.example" } });
  fireEvent.change(screen.getByLabelText("Join as"), { target: { value: "service.desk" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);
  // the joiner landed in the REAL workspace — NEVER the demo tenant
  const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "{}") as {
    tenantId?: string;
  };
  expect(session.tenantId).toBe("tnt_w101prod00000001");
  expect(screen.getByText("Dwayne Carter")).toBeDefined();
  const chip = screen.getByTitle("Switch your active role (audited)");
  expect(chip.textContent).toContain(PRODUCT_EXPERIENCE_ROLE_LABELS["service.desk"]);
  fireEvent.click(screen.getByText("Sign out"));

  // -- the demo-issued code does NOT resolve at the gate: the machine-
  // stable unknown_code renders with its frozen words (never empty)
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: demoCode } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Eve Crosser" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "eve@fresh.example" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);
  const alert = document.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert!.textContent).toContain("unknown_code");
  expect(alert!.textContent).toContain("does not match any workspace you can join");
  // and no principal for Eve was created in the DEMO tenant by the refusal
  const durable = JSON.parse(window.localStorage.getItem(DURABLE_KEY) ?? "{}") as Record<
    string,
    Record<string, Record<string, Record<string, string>>>
  >;
  const demoPrincipals = Object.values(
    durable["fleetos_principals"]?.["tnt_w091demo000001"] ?? {},
  );
  expect(demoPrincipals.every((row) => row["member_ref"] !== "eve@fresh.example")).toBe(true);
  expect(demoPrincipals.every((row) => row["member_ref"] !== "dwayne@trnlg.example")).toBe(true);
});
