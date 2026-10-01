"use client";
/**
 * @fleetos/web-product — the session screens (W101 [TL]; W110 join-role
 * selection; W121 password credentials).
 *
 * The sign-in / workspace-choice / onboarding surfaces of the product
 * shell: fully presentational, fully controlled (the W090 pattern —
 * callbacks out, no internal routing, no business truth). The design
 * is the shell's shared system (tokens + primitives).
 *
 * W110: the Join tab carries the role selection — the five MEMBER
 * roles (`JOIN_MEMBER_ROLES`, labels verbatim from the matrix) with
 * the honest helper copy (`JOIN_ROLE_NOTE`); the chosen role flows
 * through `onJoin` to the runtime's `joinWorkspace({..., roles})`
 * seam. `fleet.admin` and `vendor.operator` are never offered (never
 * self-service through a bearer code).
 *
 * W121: the Sign-in and Create tabs carry the password fields —
 * `type="password"` semantics with the right `autoComplete` hints;
 * the password value NEVER renders visibly (masked input, controlled
 * for the disabled logic only) and flows only into the controlled
 * callbacks bound to the identity seam's verifier inputs.
 */
import type { JSX } from "react";
import { useState } from "react";
import { Button, Card, EmptyState } from "@fleetos/web-shell";
import type { ProductWorkspaceSummary, ProductSessionState, ProductAuthRefusal } from "./product-session-types";
import { PRODUCT_REFUSAL_EXPLANATIONS } from "./product-session-types";
import type { ProductExperienceRole } from "./role-bridge";
import { PRODUCT_EXPERIENCE_ROLE_LABELS } from "./role-bridge";

/** The refusal explanation block (machine reason + human words). */
export function RefusalExplanation(props: {
  readonly reason: ProductAuthRefusal;
  readonly message: string;
}): JSX.Element {
  return (
    <div className="fos-refusal" role="alert">
      <p className="fos-refusal-reason">
        <strong>{props.reason}</strong>
      </p>
      <p className="fos-refusal-words">{PRODUCT_REFUSAL_EXPLANATIONS[props.reason]}</p>
    </div>
  );
}

/** The workspace choice screen: create, join, or sign in (controlled). */
export function WorkspaceChoiceScreen(props: {
  readonly workspaces: readonly ProductWorkspaceSummary[];
  readonly environmentLabel: string;
  readonly onCreate: (input: {
    readonly name: string;
    readonly displayName: string;
    readonly email: string;
    readonly password: string;
  }) => void;
  readonly onJoin: (input: {
    readonly code: string;
    readonly displayName: string;
    readonly email: string;
    readonly role: ProductExperienceRole;
  }) => void;
  readonly onSignIn: (input: {
    readonly tenantId: string;
    readonly email: string;
    readonly password: string;
  }) => void;
  readonly refusal?: { readonly reason: ProductAuthRefusal; readonly message: string } | null;
}): JSX.Element {
  const [tab, setTab] = useState<"signin" | "create" | "join">("signin");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState<ProductExperienceRole>("employee");
  const [tenantId, setTenantId] = useState(props.workspaces[0]?.tenantId ?? "");
  return (
    <main className="fos-signin" aria-label="FleetOS sign in">
      <header className="fos-signin-head">
        <h1>FleetOS</h1>
        <p className="fos-env">{props.environmentLabel}</p>
      </header>
      <nav className="fos-signin-tabs" aria-label="Sign-in mode">
        <Button variant={tab === "signin" ? "primary" : "ghost"} onClick={() => setTab("signin")}>
          Sign in
        </Button>
        <Button variant={tab === "create" ? "primary" : "ghost"} onClick={() => setTab("create")}>
          Create workspace
        </Button>
        <Button variant={tab === "join" ? "primary" : "ghost"} onClick={() => setTab("join")}>
          Join workspace
        </Button>
      </nav>
      {props.refusal ? <RefusalExplanation reason={props.refusal.reason} message={props.refusal.message} /> : null}
      {tab === "signin" ? (
        props.workspaces.length === 0 ? (
          <EmptyState
            title="No workspaces yet"
            hint="Create the first workspace to start using FleetOS."
          />
        ) : (
          <Card title="Sign in" subtitle="Pick your workspace and member email">
            <label htmlFor="fos-ws">Workspace</label>
            <select id="fos-ws" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {props.workspaces.map((ws) => (
                <option key={ws.tenantId} value={ws.tenantId}>
                  {ws.name}
                </option>
              ))}
            </select>
            <label htmlFor="fos-email">Email</label>
            <input
              id="fos-email"
              type="email"
              value={email}
              placeholder="you@company.example"
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="fos-password">Password</label>
            <input
              id="fos-password"
              type="password"
              value={password}
              placeholder="Your password"
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              variant="primary"
              onClick={() => props.onSignIn({ tenantId, email, password })}
              disabled={!email.trim() || !tenantId || !password}
            >
              Sign in
            </Button>
          </Card>
        )
      ) : null}
      {tab === "create" ? (
        <Card title="Create a workspace" subtitle="You become the Fleet Administrator">
          <label htmlFor="fos-newname">Workspace name</label>
          <input id="fos-newname" value={name} placeholder="Northwind Fleet" onChange={(e) => setName(e.target.value)} />
          <label htmlFor="fos-newdisplay">Your name</label>
          <input id="fos-newdisplay" value={displayName} placeholder="Ada Lovelace" onChange={(e) => setDisplayName(e.target.value)} />
          <label htmlFor="fos-newemail">Your email</label>
          <input id="fos-newemail" type="email" value={email} placeholder="ada@northwind.example" onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="fos-newpassword">Password</label>
          <input
            id="fos-newpassword"
            type="password"
            value={password}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            variant="primary"
            disabled={!name.trim() || !displayName.trim() || !email.trim() || !password}
            onClick={() => props.onCreate({ name, displayName, email, password })}
          >
            Create workspace
          </Button>
        </Card>
      ) : null}
      {tab === "join" ? (
        <Card title="Join a workspace" subtitle="Use the one-time code you were given">
          <label htmlFor="fos-code">Join code</label>
          <input id="fos-code" value={code} placeholder="joinw101…" onChange={(e) => setCode(e.target.value)} />
          <label htmlFor="fos-joindisplay">Your name</label>
          <input id="fos-joindisplay" value={displayName} placeholder="Grace Hopper" onChange={(e) => setDisplayName(e.target.value)} />
          <label htmlFor="fos-joinemail">Your email</label>
          <input id="fos-joinemail" type="email" value={email} placeholder="grace@northwind.example" onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="fos-joinrole">Join as</label>
          <select
            id="fos-joinrole"
            value={role}
            onChange={(e) => setRole(e.target.value as ProductExperienceRole)}
          >
            {JOIN_MEMBER_ROLES.map((memberRole) => (
              <option key={memberRole} value={memberRole}>
                {PRODUCT_EXPERIENCE_ROLE_LABELS[memberRole]}
              </option>
            ))}
          </select>
          <p className="fos-meta">{JOIN_ROLE_NOTE}</p>
          <Button
            variant="primary"
            disabled={!code.trim() || !displayName.trim() || !email.trim()}
            onClick={() => props.onJoin({ code, displayName, email, role })}
          >
            Join workspace
          </Button>
        </Card>
      ) : null}
    </main>
  );
}

/** The first-run onboarding rail steps (the install contract journey). */
export const ONBOARDING_STEPS: readonly { readonly id: string; readonly title: string; readonly hint: string }[] =
  Object.freeze([
    { id: "workspace", title: "Workspace created", hint: "Your fleet's home in FleetOS." },
    { id: "role", title: "Role assigned", hint: "Your experience lens is set from your assigned role." },
    { id: "install", title: "Install the agent", hint: "Devices → Install Center: create an enrollment code and run the installer." },
    { id: "first-checkin", title: "First check-in", hint: "The agent checks in and streams its first observation." },
    { id: "doctor", title: "Device Doctor", hint: "FleetOS starts diagnosing devices from real observations." },
  ]);

// ---------------------------------------------------------------------------
// W110: the Join tab's role selection (the member-role vocabulary)
// ---------------------------------------------------------------------------

/**
 * The MEMBER roles offered at the Join tab (W110): the frozen matrix
 * vocabulary minus the two roles that are never self-service —
 * `fleet.admin` (granted by workspace operators) and `vendor.operator`
 * (isolated vendor access, provisioned separately). Joining with one
 * of these roles creates a REAL starting role assignment through the
 * identity seam's `joinWorkspace({..., roles})` — the seam's own
 * authority, never widened by this presentation. `employee` is the
 * default (the seam's own default when no role is passed).
 */
export const JOIN_MEMBER_ROLES: readonly ProductExperienceRole[] = Object.freeze([
  "employee",
  "service.desk",
  "team.manager",
  "asset.manager",
  "security.compliance",
]);

/**
 * The honest join-role helper copy (frozen): what choosing a role does,
 * and why the two non-member roles are absent — never a silent gap.
 */
export const JOIN_ROLE_NOTE: string =
  "Joining with a role sets your starting role assignment and experience lens. fleet.admin and vendor.operator are not offered here — elevated roles are granted by workspace operators, and isolated vendor access is provisioned separately; never self-service through a bearer code.";

/** The onboarding rail (current step highlighted; fully controlled). */
export function OnboardingRail(props: {
  readonly role: ProductExperienceRole | null;
  readonly currentStep: number;
  readonly onDismiss: () => void;
}): JSX.Element {
  const roleLabel = props.role ? PRODUCT_EXPERIENCE_ROLE_LABELS[props.role] : "your role";
  return (
    <aside className="fos-onboarding" aria-label="Getting started">
      <h2>Getting started as {roleLabel}</h2>
      <ol className="fos-onboarding-steps">
        {ONBOARDING_STEPS.map((step, index) => (
          <li
            key={step.id}
            className={index === props.currentStep ? "fos-step-current" : index < props.currentStep ? "fos-step-done" : "fos-step-todo"}
            aria-current={index === props.currentStep ? "step" : undefined}
          >
            <strong>{step.title}</strong>
            <span>{step.hint}</span>
          </li>
        ))}
      </ol>
      <Button variant="secondary" onClick={props.onDismiss}>
        Dismiss getting started
      </Button>
    </aside>
  );
}

/** The session-expired recovery banner (fail-visible, recoverable). */
export function SessionExpiredBanner(props: {
  readonly onRecover: () => void;
  readonly onSignOut: () => void;
}): JSX.Element {
  return (
    <div className="fos-session-expired" role="alert">
      <p>
        <strong>Your session has expired.</strong> Your work is saved — sign back in to continue
        where you left off.
      </p>
      <nav className="fos-expired-actions">
        <Button variant="primary" onClick={props.onRecover}>
          Sign back in
        </Button>
        <Button variant="ghost" onClick={props.onSignOut}>
          Back to workspaces
        </Button>
      </nav>
    </div>
  );
}
