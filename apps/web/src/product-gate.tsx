"use client";
/**
 * @fleetos/web — the ProductGate (W101 [TL], the product shell's session
 * gate; W110 invitation + join-role closure).
 *
 * The composition-only product entry: it owns the product session
 * runtime (over the REAL W100C identity services) and gates the
 * authenticated console behind it. The gate renders:
 *
 *   signed-out -> the WorkspaceChoiceScreen (create / join / sign in);
 *   onboarding -> the console + the first-run onboarding rail;
 *   active     -> the console with the session chrome (role switcher,
 *                 approval inbox, member chip) and role-shaped shell;
 *   expired    -> the console with the session-expired recovery banner.
 *
 * W110: the gate also composes the two product closures over the REAL
 * seams (no new business truth — the identity package owns every
 * decision):
 *
 *   - the INVITE-MEMBER surface (signed-in shell only): the invite
 *     affordance calls `runtime.issueInvitation()`; on success the raw
 *     code renders DISPLAY-ONCE (copy affordance + "I copied it — hide
 *     it" confirm; the raw code leaves this gate's memory on confirm,
 *     so it can never be re-rendered); on refusal the machine-stable
 *     reason renders — never a silent no-op;
 *   - the JOIN-ROLE selection: the choice screen's chosen member role
 *     flows through `onJoin` into `runtime.joinWorkspace({..., roles:
 *     [role]})` (the seam's own authority creates the real starting
 *     role assignment).
 *
 * The clock seam is INJECTED HERE (the composition root — the runtime
 * and every view-model stay deterministic/pure). Business truth never
 * enters this file: the identity package owns it; the shell renders it.
 */

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import {
  WorkspaceChoiceScreen,
  SessionExpiredBanner,
  InviteMemberControl,
} from "@fleetos/web-product";
import type {
  ProductSessionState,
  ProductTransitionResult,
  ProductAuthRefusal,
  ProductExperienceRole,
  InviteMemberState,
} from "@fleetos/web-product";
import { createProductSessionRuntime, INVITATION_TTL_SECONDS } from "./runtime/product-session";
import { ConsoleSessionApp } from "./console-app";
import type { ShellRoute } from "@fleetos/web-shell";
import { environmentLabel } from "./runtime/env";

export interface ConsoleAppProps {
  /**
   * The initial route (server-rendered from the path; controlled).
   * `null` means the initial path REFUSED the route vocabulary — the
   * app renders the safe-failure state (never a silent redirect).
   */
  readonly initialRoute?: ShellRoute | null;
}

/** The browser-session clock seam (injected at the composition root). */
function realClock(): string {
  return new Date().toISOString();
}

export function ConsoleApp({ initialRoute }: ConsoleAppProps): JSX.Element {
  const runtime = useMemo(
    () =>
      createProductSessionRuntime({
        now: realClock,
        ttlSeconds: 60 * 60 * 8,
      }),
    [],
  );
  const [state, setState] = useState<ProductSessionState>(() => runtime.state());
  const [refusal, setRefusal] = useState<
    { readonly reason: ProductAuthRefusal; readonly message: string } | null
  >(null);
  const [directory, setDirectory] = useState(() => runtime.listWorkspaces());
  // W110: the invite-member surface state (the display-once lifecycle).
  // The raw code lives here ONLY between issuance and the hide confirm.
  const [invite, setInvite] = useState<InviteMemberState>({ kind: "closed" });

  /**
   * A session-opening (or closing) transition resets the invite surface:
   * the display-once window belongs to the ACTING member's session,
   * never to the next one. Role switches keep it (same member).
   */
  const resetInvite = useCallback((): void => {
    setInvite({ kind: "closed" });
  }, []);

  const apply = useCallback(
    (result: ProductTransitionResult): void => {
      if (result.ok) {
        setRefusal(null);
        setState(result.state);
        setDirectory(runtime.listWorkspaces());
      } else {
        setRefusal({ reason: result.reason, message: result.message });
        setState(runtime.state());
      }
    },
    [runtime],
  );

  const onCreate = useCallback(
    (input: { readonly name: string; readonly displayName: string; readonly email: string }) => {
      apply(
        runtime.createWorkspace({
          name: input.name,
          founderDisplayName: input.displayName,
          founderEmail: input.email,
        }),
      );
      resetInvite();
    },
    [apply, runtime, resetInvite],
  );

  const onJoin = useCallback(
    (input: {
      readonly code: string;
      readonly displayName: string;
      readonly email: string;
      readonly role: ProductExperienceRole;
    }) => {
      // W110: the chosen member role flows into the REAL seam — the
      // identity service creates the starting role assignment (the
      // seam's authority; this gate never widens it).
      apply(
        runtime.joinWorkspace({
          code: input.code,
          displayName: input.displayName,
          email: input.email,
          roles: [input.role],
        }),
      );
      resetInvite();
    },
    [apply, runtime, resetInvite],
  );

  const onSignIn = useCallback(
    (input: { readonly tenantId: string; readonly email: string }) => {
      apply(runtime.signIn(input));
      resetInvite();
    },
    [apply, runtime, resetInvite],
  );

  const onRoleSwitch = useCallback(
    (role: Parameters<typeof runtime.switchActiveRole>[0]) => {
      apply(runtime.switchActiveRole(role));
    },
    [apply, runtime],
  );

  const onSignOut = useCallback(() => {
    apply(runtime.signOut());
    resetInvite();
  }, [apply, runtime, resetInvite]);

  const onCompleteOnboarding = useCallback(() => {
    apply(runtime.completeOnboarding());
  }, [apply, runtime]);

  const onRecover = useCallback(() => {
    // Recovery signs the SAME member back into the SAME workspace (the
    // expired session's remembered identity — never a silent re-auth).
    const current = runtime.state();
    if (current.phase === "expired") {
      apply(runtime.signIn({ tenantId: current.tenantId, email: current.memberRef }));
      resetInvite();
    }
  }, [apply, runtime, resetInvite]);

  // -- W110: the invite-member surface over the REAL seam -------------

  const onInviteIssue = useCallback((): void => {
    const issued = runtime.issueInvitation();
    if (issued.ok) {
      // The raw code enters the view EXACTLY ONCE, held only until the
      // inviter confirms the hide (the console stores a verifier; the
      // identity seam owns the code's single-use + expiry truth).
      setInvite({ kind: "issued", rawCode: issued.rawCode });
    } else {
      // Fail-visible: the machine-stable refusal renders — never a
      // silent no-op (e.g. the seam's unknown_session refusal).
      setInvite({ kind: "refused", reason: issued.reason, message: issued.message });
    }
  }, [runtime]);

  const onInviteCopy = useCallback((code: string): void => {
    // The SHELL performs the copy (the product package stays I/O-free —
    // the W090 controlled-screen law). Best-effort: where the
    // clipboard API is unavailable the display-once confirm remains
    // the honest path (the copy never fabricates success feedback).
    const clipboard: Clipboard | undefined =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      void clipboard.writeText(code).catch(() => undefined);
    }
  }, []);

  const onInviteHide = useCallback((): void => {
    // DISPLAY-ONCE LAW: the raw code leaves this gate's memory for
    // good — the "hidden" state carries no code, so no later render
    // can ever show it again.
    setInvite({ kind: "hidden" });
  }, []);

  const onInviteDismissRefusal = useCallback((): void => {
    setInvite({ kind: "closed" });
  }, []);

  const onRefresh = useCallback(() => {
    apply(runtime.refresh());
  }, [apply, runtime]);

  if (state.phase === "signed-out") {
    return (
      <WorkspaceChoiceScreen
        workspaces={directory}
        environmentLabel={environmentLabel()}
        onCreate={onCreate}
        onJoin={onJoin}
        onSignIn={onSignIn}
        refusal={refusal}
      />
    );
  }

  return (
    <>
      {state.phase === "expired" ? (
        <SessionExpiredBanner onRecover={onRecover} onSignOut={onSignOut} />
      ) : (
        // W110: the invite-member surface — signed-in shell only (the
        // onboarding and active phases), composed above the console in
        // the session chrome area next to the member chip's topbar.
        <InviteMemberControl
          workspaceName={state.workspaceName}
          state={invite}
          ttlSeconds={INVITATION_TTL_SECONDS}
          onIssue={onInviteIssue}
          onCopyCode={onInviteCopy}
          onHide={onInviteHide}
          onDismissRefusal={onInviteDismissRefusal}
        />
      )}
      <ConsoleSessionApp
        initialRoute={initialRoute}
        session={state}
        onRoleSwitch={onRoleSwitch}
        onSignOut={onSignOut}
        onCompleteOnboarding={onCompleteOnboarding}
        onSessionRefresh={onRefresh}
      />
    </>
  );
}
