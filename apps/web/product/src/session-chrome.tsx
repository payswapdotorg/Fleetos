"use client";
/**
 * @fleetos/web-product — the session chrome affordances (W101 [TL];
 * W110 invite-member surface).
 *
 * The topbar affordances of the authenticated product shell: the
 * active-role switcher (audited, assigned-only — the switch writes the
 * identity audit trail through the REAL role-switch service), the
 * notifications/approval inbox badge, the member chip, and the
 * invite-member surface (W110). Fully presentational, fully controlled.
 *
 * W120: the member chip carries the account-area treatment (avatar
 * initial + two-line identity inside the account pill) — pure
 * presentation; every style comes from the shell's fos-* classes.
 *
 * W110: `InviteMemberControl` surfaces the runtime's REAL
 * `issueInvitation()` seam — the raw join code renders DISPLAY-ONCE
 * (mirroring the Install Center's enrollment-code law): shown with a
 * copy affordance and an explicit "I copied it — hide it" confirm;
 * after the confirm the SHELL discards the raw code from memory, so
 * this component can never re-render it (the console stores only a
 * verifier — the identity seam's truth). Issuance refusals render
 * their machine-stable reason — never a silent no-op.
 */
import type { JSX } from "react";
import { useState } from "react";
import { Badge, Button } from "@fleetos/web-shell";
import type { ProductAuthRefusal } from "./product-session-types";
import type { ProductExperienceRole } from "./role-bridge";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "./role-bridge";
import { RefusalExplanation } from "./session-screens";

/** The active-role switcher (assigned roles only; switch is audited). */
export function RoleSwitcher(props: {
  readonly activeRole: ProductExperienceRole | null;
  readonly assignedRoles: readonly ProductExperienceRole[];
  readonly onSwitch: (role: ProductExperienceRole) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const label = props.activeRole ? PRODUCT_EXPERIENCE_ROLE_LABELS[props.activeRole] : "No role";
  return (
    <div className="fos-roleswitcher">
      <button
        type="button"
        className="fos-rolechip"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Switch your active role (audited)"
      >
        <Badge status="healthy">{label}</Badge>
      </button>
      {open ? (
        <ul className="fos-rolemenu" role="listbox" aria-label="Your assigned roles">
          {props.assignedRoles.length === 0 ? <li className="fos-role-empty">No roles assigned yet</li> : null}
          {props.assignedRoles.map((role) => (
            <li key={role} role="option" aria-selected={role === props.activeRole}>
              <Button
                variant={role === props.activeRole ? "primary" : "ghost"}
                onClick={() => {
                  setOpen(false);
                  props.onSwitch(role);
                }}
              >
                {PRODUCT_EXPERIENCE_ROLE_LABELS[role]}
              </Button>
            </li>
          ))}
          <li className="fos-role-note">Role switches are audited and never change your permissions.</li>
        </ul>
      ) : null}
    </div>
  );
}

/** The notifications/approval inbox badge (controlled). */
export function ApprovalInboxBadge(props: {
  readonly pending: number;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="fos-inbox"
      onClick={props.onOpen}
      aria-label={`Approvals inbox: ${props.pending} pending`}
      title="Approvals inbox"
    >
      <span aria-hidden="true">Approvals</span>
      {props.pending > 0 ? <Badge status="needs_attention">{String(props.pending)}</Badge> : <Badge status="healthy">0</Badge>}
    </button>
  );
}

/** The signed-in member chip (workspace + member identity). */
export function MemberChip(props: {
  readonly workspaceName: string;
  readonly displayName: string;
  readonly onSignOut: () => void;
}): JSX.Element {
  // W120: the account-area treatment — the avatar carries the display
  // name's initial (pure presentation; no identity truth derived here).
  const initial = props.displayName.trim().length > 0
    ? props.displayName.trim().slice(0, 1).toUpperCase()
    : "·";
  return (
    <div className="fos-memberchip">
      <span className="fos-member-avatar" aria-hidden="true">
        {initial}
      </span>
      <span className="fos-member-identity">
        <strong>{props.workspaceName}</strong>
        <span>{props.displayName}</span>
      </span>
      <Button variant="ghost" onClick={props.onSignOut}>
        Sign out
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// W110: the invite-member surface (the display-once join code)
// ---------------------------------------------------------------------------

/**
 * The invite-member surface state — FULLY CONTROLLED by the shell (the
 * gate). The DISPLAY-ONCE LAW is structural: the `hidden` state carries
 * NO raw code, so once the inviter confirms the hide the code can never
 * be re-rendered (the shell must drop it from memory on `onHide`).
 */
export type InviteMemberState =
  | { readonly kind: "closed" }
  | { readonly kind: "issued"; readonly rawCode: string }
  | { readonly kind: "hidden" }
  | { readonly kind: "refused"; readonly reason: ProductAuthRefusal; readonly message: string };

/**
 * The invitation expiry note — pure arithmetic over the seam's TTL
 * (no clock reads; the instant-level truth stays in the identity seam).
 */
function invitationExpiryNote(ttlSeconds: number): string {
  const hours = Math.round(ttlSeconds / 3600);
  return `Expires ${hours} hour${hours === 1 ? "" : "s"} after the code is issued.`;
}

/**
 * The invite-member affordance (W110): a discoverable control near the
 * member chip that surfaces the runtime's REAL `issueInvitation()` seam.
 *
 * The raw code renders exactly once — shown with a copy affordance and
 * the "I copied it — hide it" confirm (the Install Center's
 * enrollment-code law, mirrored); the honest note states that the
 * console stores only a verifier and the code cannot be shown again,
 * plus the expiry derived from the seam's TTL. Refusals render the
 * machine-stable reason + frozen human words — never a silent no-op.
 * Fully controlled: every intent flows through callbacks; no business
 * truth lives here.
 */
export function InviteMemberControl(props: {
  /** The acting workspace (the invitation's scope). */
  readonly workspaceName: string;
  /** The invite surface state (the shell owns the display-once lifecycle). */
  readonly state: InviteMemberState;
  /** The identity seam's invitation TTL in seconds (the expiry note's input). */
  readonly ttlSeconds: number;
  /** Issue a join invitation (routes to `runtime.issueInvitation()`). */
  readonly onIssue: () => void;
  /** Copy the raw code (the SHELL performs the copy — I/O stays out). */
  readonly onCopyCode: (code: string) => void;
  /** Confirm the code was copied — hide it permanently (display-once). */
  readonly onHide: () => void;
  /** Dismiss a rendered refusal. */
  readonly onDismissRefusal: () => void;
}): JSX.Element {
  if (props.state.kind === "refused") {
    return (
      <section className="fos-invite" aria-label="Invite a member">
        <RefusalExplanation reason={props.state.reason} message={props.state.message} />
        <div className="fos-row">
          <Button variant="secondary" onClick={props.onDismissRefusal}>
            Dismiss the refusal
          </Button>
        </div>
      </section>
    );
  }
  if (props.state.kind === "issued") {
    const rawCode = props.state.rawCode;
    return (
      <section className="fos-invite" aria-label="Invite a member">
        <p className="fos-invite-label">
          Your one-time join code <Badge status="healthy">shown once</Badge>
        </p>
        <p className="fos-mono" data-testid="invitation-code-value">
          {rawCode}
        </p>
        <p className="fos-meta">
          Shown once — the console stores only a verifier; this code cannot be shown again.{" "}
          {invitationExpiryNote(props.ttlSeconds)} Give it to the person you are inviting to this
          workspace; they redeem it from the gate's Join tab.
        </p>
        <div className="fos-row">
          <Button variant="secondary" onClick={() => props.onCopyCode(rawCode)}>
            Copy join code
          </Button>
          <Button variant="secondary" onClick={props.onHide}>
            I copied it — hide it
          </Button>
        </div>
      </section>
    );
  }
  if (props.state.kind === "hidden") {
    return (
      <section className="fos-invite" aria-label="Invite a member">
        <p className="fos-meta">
          The join code was shown once and is now hidden. It remains valid until used or expired —
          issue a new one if you lost it.
        </p>
        <div className="fos-row">
          <Button variant="secondary" onClick={props.onIssue}>
            Invite member…
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className="fos-invite" aria-label="Invite a member">
      <div className="fos-row">
        <Button variant="secondary" onClick={props.onIssue}>
          Invite member…
        </Button>
        <span className="fos-meta">
          Issue a one-time join code for {props.workspaceName}. {invitationExpiryNote(props.ttlSeconds)}
        </span>
      </div>
    </section>
  );
}
