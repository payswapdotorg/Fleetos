/**
 * W101 web-product — browser-facing RENDER tests for the session
 * screens + chrome: the workspace choice screen renders
 * create/join/sign-in tabs with controlled callbacks; the refusal
 * explanation renders the machine reason AND the human words verbatim;
 * the onboarding rail renders the five install-journey steps with the
 * current step highlighted; the session-expired banner renders the
 * recovery affordances; the role switcher lists ONLY assigned roles
 * with the audited note; the approval inbox badge counts pending; and
 * every screen is byte-identical across renders (determinism).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  WorkspaceChoiceScreen,
  OnboardingRail,
  SessionExpiredBanner,
  ONBOARDING_STEPS,
} from "../src/session-screens";
import { RoleSwitcher, ApprovalInboxBadge, MemberChip } from "../src/session-chrome";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "../src/role-bridge";

afterEach(cleanup);

const WORKSPACES = [{ tenantId: "tnt_w101test0001", name: "Northwind Fleet", createdAt: "2026-10-01T09:00:00Z" }];

test("the workspace choice screen renders the three modes with a listed workspace", () => {
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: WORKSPACES,
    environmentLabel: "staging",
    onCreate: () => {},
    onJoin: () => {},
    onSignIn: () => {},
  }));
  expect(screen.getByText("FleetOS")).toBeTruthy();
  expect(screen.getByText("staging")).toBeTruthy();
  expect(screen.getAllByText("Sign in").length).toBeGreaterThanOrEqual(2); // tab + card title
  expect(screen.getAllByText("Create workspace").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("Join workspace").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Northwind Fleet")).toBeTruthy();
});

test("the choice screen's create tab wires the controlled callback", () => {
  let created: { name: string; displayName: string; email: string; password: string } | null = null;
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: WORKSPACES,
    environmentLabel: "staging",
    onCreate: (input) => {
      created = input;
    },
    onJoin: () => {},
    onSignIn: () => {},
  }));
  // the tab switch: the FIRST 'Create workspace' text is the tab button
  const createTab = screen.getAllByText("Create workspace")[0]!.closest("button");
  expect(createTab).toBeTruthy();
  fireEvent.click(createTab!);
  const nameBox = screen.getByLabelText("Workspace name");
  const displayBox = screen.getByLabelText("Your name");
  const emailBox = screen.getByLabelText("Your email");
  const passwordBox = screen.getByLabelText("Password");
  fireEvent.change(nameBox, { target: { value: "Northwind Fleet" } });
  fireEvent.change(displayBox, { target: { value: "Ada Lovelace" } });
  fireEvent.change(emailBox, { target: { value: "ada@northwind.example" } });
  fireEvent.change(passwordBox, { target: { value: "founder-pass-0001" } });
  // the submit button is the LAST 'Create workspace' button (inside the card)
  const submit = screen.getAllByText("Create workspace").at(-1)!.closest("button");
  expect(submit).toBeTruthy();
  expect(submit).not.toBe(createTab);
  fireEvent.click(submit!);
  expect(created).toEqual({ name: "Northwind Fleet", displayName: "Ada Lovelace", email: "ada@northwind.example", password: "founder-pass-0001" });
});

// ---------------------------------------------------------------------------
// W121 — the password fields (the never-render law)
// ---------------------------------------------------------------------------

test("W121: the create tab's password field is type=password (masked, never rendered)", () => {
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: WORKSPACES,
    environmentLabel: "staging",
    onCreate: () => {},
    onJoin: () => {},
    onSignIn: () => {},
  }));
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  const passwordBox = screen.getByLabelText("Password") as HTMLInputElement;
  expect(passwordBox.type).toBe("password");
  expect(passwordBox.autocomplete).toBe("new-password");
  // the submit stays disabled until EVERY field (incl. the password) is set
  const submit = screen.getAllByText("Create workspace").at(-1)!.closest("button") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Northwind Fleet" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada@northwind.example" } });
  expect(submit.disabled).toBe(true); // still disabled: no password yet
  fireEvent.change(passwordBox, { target: { value: "founder-pass-0001" } });
  expect(submit.disabled).toBe(false);
});

test("W121: the sign-in tab's password field is type=password and flows through onSignIn", () => {
  let signedIn: { tenantId: string; email: string; password: string } | null = null;
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: WORKSPACES,
    environmentLabel: "staging",
    onCreate: () => {},
    onJoin: () => {},
    onSignIn: (input) => {
      signedIn = input;
    },
  }));
  const passwordBox = screen.getByLabelText("Password") as HTMLInputElement;
  expect(passwordBox.type).toBe("password");
  expect(passwordBox.autocomplete).toBe("current-password");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@northwind.example" } });
  fireEvent.change(passwordBox, { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Sign in").at(-1)!.closest("button")!);
  expect(signedIn).toEqual({
    tenantId: "tnt_w101test0001",
    email: "ada@northwind.example",
    password: "founder-pass-0001",
  });
});

test("the refusal explanation renders the machine reason AND the human words verbatim", () => {
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: WORKSPACES,
    environmentLabel: "staging",
    onCreate: () => {},
    onJoin: () => {},
    onSignIn: () => {},
    refusal: { reason: "unknown_principal", message: "signIn: no member…" },
  }));
  expect(screen.getByText("unknown_principal")).toBeTruthy();
  expect(
    screen.getByText("No member with that email exists in this workspace. Ask an administrator to invite you."),
  ).toBeTruthy();
});

test("the empty directory renders the no-workspaces state (fail-visible)", () => {
  render(createElement(WorkspaceChoiceScreen, {
    workspaces: [],
    environmentLabel: "staging",
    onCreate: () => {},
    onJoin: () => {},
    onSignIn: () => {},
  }));
  expect(screen.getByText("No workspaces yet")).toBeTruthy();
});

test("the onboarding rail renders the five install-journey steps with the current one", () => {
  render(createElement(OnboardingRail, {
    role: "fleet.admin",
    currentStep: 2,
    onDismiss: () => {},
  }));
  expect(screen.getByText(`Getting started as ${PRODUCT_EXPERIENCE_ROLE_LABELS["fleet.admin"]}`)).toBeTruthy();
  for (const step of ONBOARDING_STEPS) {
    expect(screen.getByText(step.title)).toBeTruthy();
  }
  const current = screen
    .getAllByText("Install the agent")
    .find((el) => el.closest("li")?.getAttribute("aria-current") === "step");
  expect(current).toBeTruthy();
});

test("the session-expired banner renders recovery affordances", () => {
  let recovered = false;
  render(createElement(SessionExpiredBanner, {
    onRecover: () => {
      recovered = true;
    },
    onSignOut: () => {},
  }));
  expect(screen.getByText("Your session has expired.")).toBeTruthy();
  fireEvent.click(screen.getByText("Sign back in"));
  expect(recovered).toBe(true);
});

test("the role switcher lists ONLY assigned roles with the audited note", () => {
  let switched: string | null = null;
  render(createElement(RoleSwitcher, {
    activeRole: "fleet.admin",
    assignedRoles: ["fleet.admin", "team.manager"],
    onSwitch: (role) => {
      switched = role;
    },
  }));
  expect(screen.getByText(PRODUCT_EXPERIENCE_ROLE_LABELS["fleet.admin"])).toBeTruthy();
  fireEvent.click(screen.getByTitle("Switch your active role (audited)"));
  expect(screen.getByText(PRODUCT_EXPERIENCE_ROLE_LABELS["team.manager"])).toBeTruthy();
  expect(screen.queryByText(PRODUCT_EXPERIENCE_ROLE_LABELS["employee"])).toBeNull();
  expect(screen.getByText("Role switches are audited and never change your permissions.")).toBeTruthy();
  fireEvent.click(screen.getByText(PRODUCT_EXPERIENCE_ROLE_LABELS["team.manager"]));
  expect(switched).toBe("team.manager");
});

test("the approval inbox badge counts pending approvals", () => {
  let opened = false;
  render(createElement(ApprovalInboxBadge, {
    pending: 3,
    onOpen: () => {
      opened = true;
    },
  }));
  expect(screen.getByLabelText("Approvals inbox: 3 pending")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Approvals inbox: 3 pending"));
  expect(opened).toBe(true);
});

test("the member chip shows workspace + member + sign out", () => {
  let signedOut = false;
  render(createElement(MemberChip, {
    workspaceName: "Northwind Fleet",
    displayName: "Ada Lovelace",
    onSignOut: () => {
      signedOut = true;
    },
  }));
  expect(screen.getByText("Northwind Fleet")).toBeTruthy();
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  fireEvent.click(screen.getByText("Sign out"));
  expect(signedOut).toBe(true);
});

test("the screens are deterministic (byte-identical static markup)", () => {
  const a = renderToStaticMarkup(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
    }),
  );
  const b = renderToStaticMarkup(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
    }),
  );
  expect(a).toEqual(b);
  const railA = renderToStaticMarkup(
    createElement(OnboardingRail, { role: "employee", currentStep: 0, onDismiss: () => {} }),
  );
  const railB = renderToStaticMarkup(
    createElement(OnboardingRail, { role: "employee", currentStep: 0, onDismiss: () => {} }),
  );
  expect(railA).toEqual(railB);
});
