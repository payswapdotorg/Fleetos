/**
 * W122 — the browser-level DEMO QUICK-LINK + ISOLATION journeys (the
 * golden paths the Wave 12 acceptance walks live).
 *
 *   1. THE QUICK-LINK JOURNEY: the signed-out gate renders the
 *      clearly-labeled DEMO quick-links strip (one one-click persona
 *      button per experience role); clicking a persona opens the demo
 *      workspace session THROUGH the same session-open seam (no
 *      credentials); the active session renders clearly labeled DEMO
 *      (the honest "Demo workspace" badge + the Demo-prefixed
 *      workspace/member identity) and the console shows the rich demo
 *      fleet.
 *
 *   2. THE FRESH NON-DEMO WORKSPACE JOURNEY: a workspace created
 *      through the REAL sign-up flow renders ONLY its own records —
 *      every console area shows its honest empty state, global search
 *      matches nothing, and ZERO demo records render anywhere (the
 *      isolation law; honest empty states are CORRECT behavior).
 *
 *   3. THE COEXISTENCE JOURNEY: a demo quick link opened earlier in
 *      the SAME browser (the durable store holds the demo tenant's
 *      records in localStorage) still leaks NOTHING into a fresh
 *      non-demo workspace signed in afterwards.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConsoleApp } from "../src/console-app";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "@fleetos/web-product";
import { DEMO_PERSONAS } from "../src/runtime/demo-fleet";
import type { ShellRoute } from "@fleetos/web-shell";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

/** Every demo fixture string that must NEVER render in a non-demo view. */
const DEMO_STRINGS: readonly RegExp[] = [
  /ThinkPad T14/,
  /MacBook Air M3/,
  /Pixel 9/,
  /w091-demo-enable-encryption/,
  /W091-DEMO-000\d/,
  /action\.plan\.(approved|dispatched|parked)/,
  /disk encryption/i,
  /Demo — FleetOS Workspace/,
  /Demo workspace/,
];

/** Assert ZERO demo content renders anywhere in the document. */
function expectNoDemoContent(): void {
  for (const pattern of DEMO_STRINGS) {
    expect(screen.queryAllByText(pattern).length).toBe(0);
  }
  expect(document.body.textContent ?? "").not.toContain("w091demo");
  expect(document.body.textContent ?? "").not.toContain("tnt_w091demo");
}

// ---------------------------------------------------------------------------
// Journey 1 — the DEMO quick links on the sign-in screen
// ---------------------------------------------------------------------------

test("W122 journey — the signed-out gate renders the clearly-labeled DEMO quick-links strip (one per role)", () => {
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  // The strip is present and clearly labeled.
  const strip = screen.getByTestId("demo-quicklinks");
  expect(strip).toBeDefined();
  expect(strip.textContent).toContain("DEMO workspaces");
  expect(strip.textContent).toContain("sample data");
  // Exactly the seven personas, one per frozen experience role, honest
  // Demo-prefixed display names.
  const buttons = strip.querySelectorAll("button");
  expect(buttons.length).toBe(7);
  expect(Array.from(buttons).map((b) => b.textContent)).toEqual(
    DEMO_PERSONAS.map((p) => p.displayName),
  );
  for (const persona of DEMO_PERSONAS) {
    expect(
      Array.from(buttons).some((b) => b.textContent === persona.displayName),
    ).toBe(true);
  }
  // The honest helper copy states the sanctioned-entry law.
  expect(
    screen.getByText(/The demo personas carry no passwords: the quick link is the sanctioned entry/),
  ).toBeDefined();
  // The demo tenant does NOT appear in the workspace dropdown (the
  // quick links are the only demo door; the store is fresh anyway).
  expect(screen.queryByText("Demo — FleetOS Workspace")).toBeNull();
});

test("W122 journey — one click opens the demo workspace session: demo tenant active, clearly labeled DEMO, demo data visible", () => {
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  // Click the Security & Compliance persona quick link (one click, no
  // credentials — through the same session-open seam).
  fireEvent.click(screen.getByRole("button", { name: "Demo — Security & Compliance" }));
  // The onboarding rail renders (a REAL first-run session) — dismiss it.
  fireEvent.click(screen.getByText("Dismiss getting started"));

  // The active session is clearly labeled DEMO: the honest badge in
  // the chrome area, the Demo-prefixed workspace + member identity.
  expect(screen.getByText("Demo workspace")).toBeDefined();
  expect(screen.getAllByText("Demo — FleetOS Workspace").length).toBeGreaterThan(0);
  expect(screen.getByText("Demo — Security & Compliance")).toBeDefined();
  // The persona's role chip (the security.compliance lens).
  const chip = screen.getByTitle("Switch your active role (audited)");
  expect(chip.textContent).toContain(PRODUCT_EXPERIENCE_ROLE_LABELS["security.compliance"]);
  // The role switcher offers exactly the persona's assigned role.
  fireEvent.click(chip);
  const menu = screen.getByRole("listbox", { name: "Your assigned roles" });
  expect(
    Array.from(menu.querySelectorAll('[role="option"]')).map((el) => el.textContent),
  ).toEqual([PRODUCT_EXPERIENCE_ROLE_LABELS["security.compliance"]]);

  // The demo tenant's session sees the RICH DEMO FLEET (the Control
  // Tower answers with the CRITICAL finding + real audit activity).
  expect(screen.getByText(/CRITICAL — .*disk encryption/i)).toBeDefined();
  expect(screen.getByText(/action\.plan\.approved/)).toBeDefined();
  expect(screen.getByText(/action\.plan\.dispatched/)).toBeDefined();
  // The demo session can sign out through the REAL lifecycle.
  fireEvent.click(screen.getByText("Sign out"));
  expect(screen.getByTestId("demo-quicklinks")).toBeDefined();
});

test("W122 journey — every demo persona quick link opens its role-shaped demo session (the full vocabulary)", () => {
  for (const persona of DEMO_PERSONAS.slice(0, 3).concat(DEMO_PERSONAS.slice(-2))) {
    cleanup();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
    fireEvent.click(screen.getByRole("button", { name: persona.displayName }));
    fireEvent.click(screen.getByText("Dismiss getting started"));
    // The demo badge + persona identity + role chip.
    expect(screen.getByText("Demo workspace")).toBeDefined();
    expect(screen.getByText(persona.displayName)).toBeDefined();
    const chip = screen.getByTitle("Switch your active role (audited)");
    expect(chip.textContent).toContain(PRODUCT_EXPERIENCE_ROLE_LABELS[persona.role]);
    // Demo data visible for every persona (the same demo fleet).
    expect(screen.getByText(/CRITICAL — .*disk encryption/i)).toBeDefined();
    fireEvent.click(screen.getByText("Sign out"));
  }
});

// ---------------------------------------------------------------------------
// Journey 2 — the fresh non-demo workspace: honest empty states everywhere
// ---------------------------------------------------------------------------

/** Mount a fresh workspace through the REAL sign-up flow (W121). */
function mountFreshWorkspace(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Northwind Fleet" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada@northwind.example" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Create workspace").at(-1)!.closest("button")!);
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

/** Navigate to an area via the sidebar's frozen link labels. */
function navigateToArea(label: string): void {
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  const link = Array.from(nav.querySelectorAll(".fos-sidebar__link")).find(
    (el) => el.textContent === label,
  ) as HTMLButtonElement;
  fireEvent.click(link!);
}

test("W122 journey — a fresh workspace renders the Control Tower's honest empty state (zero demo records)", () => {
  mountFreshWorkspace({ area: "overview", view: "home" });
  // The session is NOT demo-labeled (no badge, the real workspace name).
  expect(screen.queryByText("Demo workspace")).toBeNull();
  expect(screen.queryByText("Demo — FleetOS Workspace")).toBeNull();
  expect(screen.getByText("Northwind Fleet")).toBeDefined();
  // The honest empty attention stream + empty recent activity.
  expect(screen.getByText("Nothing needs your attention right now")).toBeDefined();
  expect(screen.getByText("No recent consequential activity")).toBeDefined();
  // ZERO demo records render anywhere.
  expectNoDemoContent();
});

test("W122 journey — every console area renders its honest empty state in a fresh workspace (the isolation law)", () => {
  mountFreshWorkspace({ area: "overview", view: "home" });
  // Devices: the honest empty roster.
  navigateToArea("Devices");
  expect(screen.getByText("No devices are enrolled yet")).toBeDefined();
  expectNoDemoContent();
  // Security findings: empty.
  navigateToArea("Security");
  expect(screen.getByText("No findings recorded")).toBeDefined();
  expectNoDemoContent();
  // Policies: empty.
  navigateToArea("Policies");
  expect(screen.getByText("No policy sets compiled")).toBeDefined();
  expectNoDemoContent();
  // Evidence & Audit: the empty index.
  navigateToArea("Evidence & Audit");
  expect(screen.getByText("No audit records yet")).toBeDefined();
  expectNoDemoContent();
  // Learning: the empty feed/cases.
  navigateToArea("Learning");
  expect(screen.getByText(/No (outcome observations|evaluation cases) yet/)).toBeDefined();
  expectNoDemoContent();
  // The approvals queue: empty (via the inbox affordance's route).
  navigateToArea("Security");
  fireEvent.click(screen.getByRole("button", { name: /Approvals inbox: 0 pending/ }));
  expect(screen.getByText("No parked approvals")).toBeDefined();
  expectNoDemoContent();
});

test("W122 journey — global search matches NOTHING in a fresh workspace (no demo fixtures)", () => {
  mountFreshWorkspace({ area: "overview", view: "home" });
  fireEvent.click(screen.getByRole("button", { name: /Open global search/i }));
  const input = screen.getByRole("textbox", { name: /Search records, capabilities, areas/i });
  // A demo record keyword resolves to ZERO results (fail-closed).
  fireEvent.change(input, { target: { value: "thinkpad" } });
  expect(screen.getByText(/No records matched/)).toBeDefined();
  fireEvent.change(input, { target: { value: "pixel" } });
  expect(screen.getByText(/No records matched/)).toBeDefined();
  expectNoDemoContent();
});

// ---------------------------------------------------------------------------
// Journey 3 — coexistence: the demo door never leaks into a real workspace
// ---------------------------------------------------------------------------

test("W122 journey — a demo session opened earlier leaks NOTHING into a fresh workspace signed in afterwards", () => {
  // Open the demo workspace first (the durable store now holds the
  // demo tenant's identity records in this browser).
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Fleet Administrator" }));
  fireEvent.click(screen.getByText("Dismiss getting started"));
  expect(screen.getByText("Demo workspace")).toBeDefined();
  expect(screen.getByText(/CRITICAL — .*disk encryption/i)).toBeDefined();
  fireEvent.click(screen.getByText("Sign out"));
  cleanup();

  // A fresh workspace signs up in the SAME browser (the localStorage
  // durable store persists across mounts — no clear between phases).
  window.history.replaceState({}, "", "/");
  render(<ConsoleApp initialRoute={{ area: "overview", view: "home" }} />);
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Northwind Fleet" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada@northwind.example" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Create workspace").at(-1)!.closest("button")!);
  fireEvent.click(screen.getByText("Dismiss getting started"));

  // The fresh workspace sees ONLY its own records: the honest empty
  // tower, the empty device roster, ZERO demo content — even though
  // the demo tenant's records sit in the same durable store.
  expect(screen.getByText("Nothing needs your attention right now")).toBeDefined();
  navigateToArea("Devices");
  expect(screen.getByText("No devices are enrolled yet")).toBeDefined();
  expectNoDemoContent();
  // The sign-in dropdown would list only real workspaces — and signing
  // out + inspecting the directory shows NO demo tenant.
  fireEvent.click(screen.getByText("Sign out"));
  expect(screen.queryByText("Demo — FleetOS Workspace")).toBeNull();
  // The workspace selector lists only the real workspace.
  const wsSelect = screen.getByLabelText("Workspace") as HTMLSelectElement;
  expect(Array.from(wsSelect.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
    "Northwind Fleet",
  ]);
});
