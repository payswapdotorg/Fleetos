/**
 * W110 web-product — browser-facing RENDER tests for the two product
 * closures: the invite-member surface and the join-role selection.
 *
 * The invite surface (InviteMemberControl) is fully controlled: the
 * DISPLAY-ONCE LAW is asserted end-to-end — the raw code renders with
 * the copy affordance + the "I copied it — hide it" confirm, and after
 * the confirm the code is NEVER re-rendered (the hidden state carries
 * no code — structural, so no re-render can resurrect it); the
 * issuance refusal renders the machine-stable reason AND the frozen
 * human words verbatim (never a silent no-op).
 *
 * The Join tab's role selection asserts the frozen member-role
 * vocabulary: EXACTLY the five member roles with verbatim matrix
 * labels (fleet.admin + vendor.operator asserted ABSENT), the default
 * employee, the honest helper copy, and the selected role flowing
 * through the controlled onJoin callback.
 *
 * Every surface is byte-identical across renders (determinism).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { WorkspaceChoiceScreen, JOIN_MEMBER_ROLES, JOIN_ROLE_NOTE } from "../src/session-screens";
import { InviteMemberControl } from "../src/session-chrome";
import type { InviteMemberState } from "../src/session-chrome";
import {
  PRODUCT_EXPERIENCE_ROLE_LABELS,
  PRODUCT_EXPERIENCE_ROLES,
  RESTRICTED_EXPERIENCE_ROLES,
  operatorRoleFor,
  enrollmentCodeCreationDenial,
} from "../src/role-bridge";
import { PRODUCT_REFUSAL_EXPLANATIONS } from "../src/product-session-types";
import type { ProductAuthRefusal } from "../src/product-session-types";
import { canInteract } from "@fleetos/web-shell";

afterEach(cleanup);

const WORKSPACES = [
  { tenantId: "tnt_w101test0001", name: "Northwind Fleet", createdAt: "2026-10-01T09:00:00Z" },
];
const TTL_SECONDS = 60 * 60 * 24; // the seam's 24h invitation TTL

/** The control's props fixture (every intent observable). */
function inviteProps(state: InviteMemberState): {
  readonly workspaceName: string;
  readonly state: InviteMemberState;
  readonly ttlSeconds: number;
  readonly onIssue: () => void;
  readonly onCopyCode: (code: string) => void;
  readonly onHide: () => void;
  readonly onDismissRefusal: () => void;
} {
  return {
    workspaceName: "Northwind Fleet",
    state,
    ttlSeconds: TTL_SECONDS,
    onIssue: () => {},
    onCopyCode: () => {},
    onHide: () => {},
    onDismissRefusal: () => {},
  };
}

// ---------------------------------------------------------------------------
// The invite-member surface (W110)
// ---------------------------------------------------------------------------

test("the closed invite surface renders the discoverable affordance with the expiry note", () => {
  render(createElement(InviteMemberControl, inviteProps({ kind: "closed" })));
  expect(screen.getByRole("button", { name: "Invite member…" })).toBeTruthy();
  expect(screen.getByText(/Issue a one-time join code for Northwind Fleet\./)).toBeTruthy();
  // the expiry is stated from the seam's TTL (24 hours, pure arithmetic)
  expect(screen.getByText(/Expires 24 hours after the code is issued\./)).toBeTruthy();
  // no code is rendered before issuance
  expect(screen.queryByTestId("invitation-code-value")).toBeNull();
});

test("the issued invite surface renders the raw code display-once with copy + hide affordances", () => {
  render(
    createElement(InviteMemberControl, inviteProps({ kind: "issued", rawCode: "joinw101c000001" })),
  );
  expect(screen.getByTestId("invitation-code-value").textContent).toBe("joinw101c000001");
  // the Install Center's one-time law, mirrored verbatim
  expect(
    screen.getByText(
      "Shown once — the console stores only a verifier; this code cannot be shown again. Expires 24 hours after the code is issued. Give it to the person you are inviting to this workspace; they redeem it from the gate's Join tab.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy join code" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "I copied it — hide it" })).toBeTruthy();
});

test("the copy affordance routes the raw code out (controlled; the shell performs the copy)", () => {
  let copied: string | null = null;
  const props = inviteProps({ kind: "issued", rawCode: "joinw101c000001" });
  render(
    createElement(InviteMemberControl, {
      ...props,
      onCopyCode: (code) => {
        copied = code;
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy join code" }));
  expect(copied).toBe("joinw101c000001");
});

test("the display-once law: after the hide confirm the code never renders again", () => {
  const CODE = "joinw101c000001";
  let state: InviteMemberState = { kind: "issued", rawCode: CODE };
  const base = inviteProps(state);
  const { rerender } = render(
    createElement(InviteMemberControl, {
      ...base,
      onHide: () => {
        // the SHELL's onHide drops the raw code from memory for good
        state = { kind: "hidden" };
      },
    }),
  );
  expect(screen.getByTestId("invitation-code-value").textContent).toBe(CODE);
  fireEvent.click(screen.getByRole("button", { name: "I copied it — hide it" }));
  // the hidden state renders the honest note — and NO code
  rerender(createElement(InviteMemberControl, { ...inviteProps(state) }));
  expect(screen.queryByTestId("invitation-code-value")).toBeNull();
  expect(screen.queryByText(CODE)).toBeNull();
  expect(
    screen.getByText(
      "The join code was shown once and is now hidden. It remains valid until used or expired — issue a new one if you lost it.",
    ),
  ).toBeTruthy();
  // repeated re-renders can never resurrect it (structural: hidden carries no code)
  rerender(createElement(InviteMemberControl, { ...inviteProps(state) }));
  rerender(createElement(InviteMemberControl, { ...inviteProps(state) }));
  expect(screen.queryByTestId("invitation-code-value")).toBeNull();
  expect(screen.queryByText(CODE)).toBeNull();
  // the affordance is offered again (a NEW invitation, never the old code)
  expect(screen.getByRole("button", { name: "Invite member…" })).toBeTruthy();
});

test("the issuance refusal renders the machine-stable reason + frozen human words (never a silent no-op)", () => {
  let dismissed = false;
  const props = inviteProps({
    kind: "refused",
    reason: "unknown_session",
    message: "issueInvitation: no active session",
  });
  render(
    createElement(InviteMemberControl, {
      ...props,
      onDismissRefusal: () => {
        dismissed = true;
      },
    }),
  );
  expect(screen.getByText("unknown_session")).toBeTruthy();
  expect(screen.getByText(PRODUCT_REFUSAL_EXPLANATIONS["unknown_session"])).toBeTruthy();
  // the choice screen's refusal pattern (machine reason + frozen words,
  // never a re-derived explanation) — mirrored by the invite surface
  expect(screen.queryByText("issueInvitation: no active session")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss the refusal" }));
  expect(dismissed).toBe(true);
});

test("the invite surfaces are deterministic (byte-identical static markup)", () => {
  const closedA = renderToStaticMarkup(
    createElement(InviteMemberControl, inviteProps({ kind: "closed" })),
  );
  const closedB = renderToStaticMarkup(
    createElement(InviteMemberControl, inviteProps({ kind: "closed" })),
  );
  expect(closedA).toEqual(closedB);
  const issuedA = renderToStaticMarkup(
    createElement(InviteMemberControl, inviteProps({ kind: "issued", rawCode: "joinw101c000001" })),
  );
  const issuedB = renderToStaticMarkup(
    createElement(InviteMemberControl, inviteProps({ kind: "issued", rawCode: "joinw101c000001" })),
  );
  expect(issuedA).toEqual(issuedB);
  const hiddenA = renderToStaticMarkup(createElement(InviteMemberControl, inviteProps({ kind: "hidden" })));
  const hiddenB = renderToStaticMarkup(createElement(InviteMemberControl, inviteProps({ kind: "hidden" })));
  expect(hiddenA).toEqual(hiddenB);
});

// ---------------------------------------------------------------------------
// The Join tab's role selection (W110)
// ---------------------------------------------------------------------------

test("the join tab offers EXACTLY the five member roles with verbatim matrix labels", () => {
  // the vocabulary law: the join set is a strict subset of the frozen
  // seven, and never contains the two non-self-service roles
  expect([...JOIN_MEMBER_ROLES]).toEqual([
    "employee",
    "service.desk",
    "team.manager",
    "asset.manager",
    "security.compliance",
  ]);
  for (const role of JOIN_MEMBER_ROLES) {
    expect(PRODUCT_EXPERIENCE_ROLES.includes(role)).toBe(true);
  }
  expect(JOIN_MEMBER_ROLES.includes("fleet.admin")).toBe(false);
  expect(JOIN_MEMBER_ROLES.includes("vendor.operator")).toBe(false);

  render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
    }),
  );
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  const select = screen.getByLabelText("Join as") as HTMLSelectElement;
  const options = Array.from(select.querySelectorAll("option"));
  // exactly the five member roles, labels VERBATIM from the matrix
  expect(options.map((option) => option.value)).toEqual([...JOIN_MEMBER_ROLES]);
  expect(options.map((option) => option.textContent)).toEqual(
    JOIN_MEMBER_ROLES.map((role) => PRODUCT_EXPERIENCE_ROLE_LABELS[role]),
  );
  // admin + vendor are NOT offered (the honest absence)
  expect(options.map((option) => option.textContent)).not.toContain(
    PRODUCT_EXPERIENCE_ROLE_LABELS["fleet.admin"],
  );
  expect(options.map((option) => option.textContent)).not.toContain(
    PRODUCT_EXPERIENCE_ROLE_LABELS["vendor.operator"],
  );
  // the default is employee (the seam's own default)
  expect(select.value).toBe("employee");
  // the honest helper copy renders verbatim next to the select
  expect(screen.getByText(JOIN_ROLE_NOTE)).toBeTruthy();
});

test("the join submit passes the SELECTED role through the controlled callback", () => {
  let joined: { code: string; displayName: string; email: string; role: string } | null = null;
  render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: (input) => {
        joined = input;
      },
      onSignIn: () => {},
    }),
  );
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: "joinw101c000001" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Grace Hopper" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "grace@northwind.example" } });
  fireEvent.change(screen.getByLabelText("Join as"), { target: { value: "service.desk" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);
  expect(joined).toEqual({
    code: "joinw101c000001",
    displayName: "Grace Hopper",
    email: "grace@northwind.example",
    role: "service.desk",
  });
});

test("the join submit keeps the employee default when the role is untouched", () => {
  let joined: { code: string; displayName: string; email: string; role: string } | null = null;
  render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: (input) => {
        joined = input;
      },
      onSignIn: () => {},
    }),
  );
  fireEvent.click(screen.getAllByText("Join workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: "joinw101c000002" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Alan Turing" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "alan@northwind.example" } });
  fireEvent.click(screen.getAllByText("Join workspace").at(-1)!.closest("button")!);
  expect(joined).toEqual({
    code: "joinw101c000002",
    displayName: "Alan Turing",
    email: "alan@northwind.example",
    role: "employee",
  });
});

// ---------------------------------------------------------------------------
// W130 — the gate's Join tab: EXPLICIT redemption errors (machine-stable
// reason + frozen human words + resolve guidance — never an empty alert)
// ---------------------------------------------------------------------------

test("the Join tab renders the machine-stable unknown_code with its frozen words (never an empty alert)", () => {
  render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
      refusal: {
        reason: "unknown_code",
        message: "joinWorkspace: no invitation matches this code within the redemption scope (unresolved code)",
      },
    }),
  );
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("unknown_code");
  expect(alert.textContent).toContain(PRODUCT_REFUSAL_EXPLANATIONS["unknown_code"]);
  // the frozen words carry the resolve guidance (the honest pattern)
  expect(PRODUCT_REFUSAL_EXPLANATIONS["unknown_code"]).toContain("fresh invitation");
  // never an empty alert: both the machine reason and the human words render
  expect(alert.textContent!.trim().length).toBeGreaterThan("unknown_code".length);
});

test("the Join tab renders the machine-stable expired_code and already_used with their frozen words", () => {
  const { rerender } = render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
      refusal: { reason: "expired_code", message: "joinWorkspace refused (invitation_expired)" },
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain("expired_code");
  expect(screen.getByRole("alert").textContent).toContain(PRODUCT_REFUSAL_EXPLANATIONS["expired_code"]);

  rerender(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
      refusal: {
        reason: "already_used",
        message: "joinWorkspace refused (invitation_already_used)",
      },
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain("already_used");
  expect(screen.getByRole("alert").textContent).toContain(PRODUCT_REFUSAL_EXPLANATIONS["already_used"]);
  expect(PRODUCT_REFUSAL_EXPLANATIONS["already_used"]).toContain("Ask an administrator");
});

test("an out-of-vocabulary refusal reason renders the fail-visible fallback — the alert is NEVER empty", () => {
  // the corrupted-state defense: a reason the frozen map does not know
  // (a stale build's value, a persisted bug) still renders a visible,
  // honest sentence instead of the sim-b "silent empty <alert>".
  render(
    createElement(WorkspaceChoiceScreen, {
      workspaces: WORKSPACES,
      environmentLabel: "staging",
      onCreate: () => {},
      onJoin: () => {},
      onSignIn: () => {},
      refusal: {
        reason: "mystery_refusal" as ProductAuthRefusal,
        message: "stale build value",
      },
    }),
  );
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("mystery_refusal");
  expect(alert.textContent!.trim().length).toBeGreaterThan("mystery_refusal".length);
  expect(alert.textContent).toContain("no further explanation is available");
});

test("the honest-denial copy for restricted roles carries why + the escalation path (the matrix law)", () => {
  const denial = enrollmentCodeCreationDenial("vendor.operator");
  expect(denial.reason).toBe("interaction_forbidden");
  // why unavailable
  expect(denial.explanation).toContain("Vendor / Service Operator");
  expect(denial.explanation).toContain("cannot create enrollment codes");
  // the escalation path
  expect(denial.explanation).toContain("Ask your workspace's Fleet Administrator or Service Desk");
  // the same frozen copy for the employee lens, and the null-role case
  const employeeDenial = enrollmentCodeCreationDenial("employee");
  expect(employeeDenial.reason).toBe("interaction_forbidden");
  expect(employeeDenial.explanation).toContain("Employee / Device Owner");
  const nullDenial = enrollmentCodeCreationDenial(null);
  expect(nullDenial.explanation).toContain("your current role");
  // the restricted roles are exactly the viewer lenses
  expect(RESTRICTED_EXPERIENCE_ROLES).toEqual(["employee", "vendor.operator"]);
});

test("viewer roles are observe-only in the shell's REAL interaction matrix (the denial's authority)", () => {
  // the frozen matrix is the authority the composition root checks:
  // viewer (employee + vendor.operator) may NOT propose; the five
  // operator-and-above roles may.
  expect(canInteract("viewer", "propose")).toEqual({
    ok: false,
    reason: "interaction_forbidden",
    role: "viewer",
    interaction: "propose",
  });
  expect(canInteract(operatorRoleFor("employee"), "propose").ok).toBe(false);
  expect(canInteract(operatorRoleFor("vendor.operator"), "propose").ok).toBe(false);
  expect(canInteract(operatorRoleFor("fleet.admin"), "propose").ok).toBe(true);
  expect(canInteract(operatorRoleFor("service.desk"), "propose").ok).toBe(true);
  expect(canInteract(operatorRoleFor("asset.manager"), "propose").ok).toBe(true);
  expect(canInteract(operatorRoleFor("team.manager"), "propose").ok).toBe(true);
  expect(canInteract(operatorRoleFor("security.compliance"), "propose").ok).toBe(true);
});
