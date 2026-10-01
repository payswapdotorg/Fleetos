"use client";
/**
 * @fleetos/web-product — the session chrome affordances (W101 [TL]).
 *
 * The topbar affordances of the authenticated product shell: the
 * active-role switcher (audited, assigned-only — the switch writes the
 * identity audit trail through the REAL role-switch service), the
 * notifications/approval inbox badge, and the member chip. Fully
 * presentational, fully controlled.
 */
import type { JSX } from "react";
import { useState } from "react";
import { Badge, Button } from "@fleetos/web-shell";
import type { ProductExperienceRole } from "./role-bridge";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "./role-bridge";

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
  return (
    <div className="fos-memberchip">
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
