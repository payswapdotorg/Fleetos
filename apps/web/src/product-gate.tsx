"use client";
/**
 * @fleetos/web — the ProductGate (W101 [TL], the product shell's session gate).
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
 * The clock seam is INJECTED HERE (the composition root — the runtime
 * and every view-model stay deterministic/pure). Business truth never
 * enters this file: the identity package owns it; the shell renders it.
 */

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import {
  WorkspaceChoiceScreen,
  SessionExpiredBanner,
} from "@fleetos/web-product";
import type {
  ProductSessionState,
  ProductTransitionResult,
  ProductAuthRefusal,
} from "@fleetos/web-product";
import { createProductSessionRuntime } from "./runtime/product-session";
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
    },
    [apply, runtime],
  );

  const onJoin = useCallback(
    (input: { readonly code: string; readonly displayName: string; readonly email: string }) => {
      apply(runtime.joinWorkspace(input));
    },
    [apply, runtime],
  );

  const onSignIn = useCallback(
    (input: { readonly tenantId: string; readonly email: string }) => {
      apply(runtime.signIn(input));
    },
    [apply, runtime],
  );

  const onRoleSwitch = useCallback(
    (role: Parameters<typeof runtime.switchActiveRole>[0]) => {
      apply(runtime.switchActiveRole(role));
    },
    [apply, runtime],
  );

  const onSignOut = useCallback(() => {
    apply(runtime.signOut());
  }, [apply, runtime]);

  const onCompleteOnboarding = useCallback(() => {
    apply(runtime.completeOnboarding());
  }, [apply, runtime]);

  const onRecover = useCallback(() => {
    // Recovery signs the SAME member back into the SAME workspace (the
    // expired session's remembered identity — never a silent re-auth).
    const current = runtime.state();
    if (current.phase === "expired") {
      apply(runtime.signIn({ tenantId: current.tenantId, email: current.memberRef }));
    }
  }, [apply, runtime]);

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
      ) : null}
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
