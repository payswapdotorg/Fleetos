"use client";
/**
 * @fleetos/web — the ProductGate (W101 [TL], the product shell's session
 * gate; W110 invitation + join-role closure; W121 proper authentication).
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
 * W110: the gate composes the two product closures over the REAL
 * seams (no new business truth — the identity package owns every
 * decision): the INVITE-MEMBER surface and the JOIN-ROLE selection.
 *
 * W121 (proper authentication) — the composition root INJECTS the real
 * seams the runtime composes (business truth still never enters this
 * file; the identity package owns it):
 *   - the REAL PasswordHasher (`createBrowserPasswordHasher()` — an
 *     iterated salted SHA-256 defined at the runtime binding site;
 *     identity itself stays zero-dep by the seam law);
 *   - a crypto-random salt generator (entropy is legal HERE — the
 *     composition root, exactly like the real clock);
 *   - the BROWSER durable identity store (the W100C DurableRecordStore
 *     seam over localStorage — the demo/local tier until the W102 Neon
 *     binding; the in-memory fallback when localStorage is unavailable,
 *     e.g. the server render);
 *   - the localStorage session store (the W121 persisted-token seam —
 *     reload KEEPS the session honest through the resolve seam).
 *
 * SSR/hydration law: the server-rendered first paint is ALWAYS the
 * signed-out gate (the server has no browser stores); after mount the
 * client syncs the persisted session's truth — hydration stays
 * byte-identical, then the honest restored state takes over.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ProductSessionStore,
  ProductPersistedSession,
  ProductWorkspaceSummary,
  InviteMemberState,
} from "@fleetos/web-product";
import {
  checkRowTenant,
  durableAlreadyExists,
  invalidRowColumns,
  requireRowKey,
  requireTableName,
  requireTenantContext,
} from "@fleetos/identity";
import type {
  DurableListOptions,
  DurableRecordStore,
  DurableRow,
  DurableStoredRow,
  DurableWrite,
  TenantContext,
} from "@fleetos/identity";
import {
  createBrowserPasswordHasher,
  createProductSessionRuntime,
  INVITATION_TTL_SECONDS,
} from "./runtime/product-session";
import type { ProductDurableStore } from "./runtime/product-session";
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

// ---------------------------------------------------------------------------
// W121 — the browser-tier stores injected at THIS composition root
// (localStorage; in-memory fallback when storage is unavailable — the
// server render, private modes, storage-disabled contexts)
// ---------------------------------------------------------------------------

/** The localStorage key of the durable identity records (browser tier). */
const FLEETOS_BROWSER_DURABLE_KEY = "fleetos.w121.durable" as const;
/** The localStorage key of the persisted session token (W121). */
const FLEETOS_BROWSER_SESSION_KEY = "fleetos.w121.session" as const;

/** localStorage access, guarded for SSR/quota/private-mode (never throws). */
function browserLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    return storage === undefined || storage === null ? null : storage;
  } catch {
    return null;
  }
}

/**
 * The in-memory fallback store shape (also the serialization unit):
 * table -> tenant -> row key -> row. Flat durable values only.
 */
interface BrowserDurableShape {
  readonly [table: string]: Record<string, Record<string, DurableRow>>;
}

/** Parse the persisted durable shape; a fresh empty store on garbage. */
function readBrowserDurableShape(): BrowserDurableShape {
  const storage = browserLocalStorage();
  if (storage === null) return {};
  try {
    const raw = storage.getItem(FLEETOS_BROWSER_DURABLE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as BrowserDurableShape;
  } catch {
    return {};
  }
}

/** Best-effort serialization (in-page truth stays consistent either way). */
function writeBrowserDurableShape(shape: BrowserDurableShape): void {
  const storage = browserLocalStorage();
  if (storage === null) return;
  try {
    storage.setItem(FLEETOS_BROWSER_DURABLE_KEY, JSON.stringify(shape));
  } catch {
    // Quota/private-mode: durability is best-effort in the browser tier;
    // the in-page records remain the truth for this page's session.
  }
}

/**
 * The BROWSER durable identity store: the W100C `DurableRecordStore`
 * seam over localStorage, partitioned per table per tenant EXACTLY
 * like the in-memory reference (a tenant-A context can never observe
 * tenant-B rows). The demo/local tier until the W102 Neon binding;
 * the runtime + repositories are identical whichever implementation
 * is injected.
 */
export function createBrowserDurableRecordStore(): ProductDurableStore {
  const shape: BrowserDurableShape = readBrowserDurableShape();

  function partitionOf(table: string, tenantId: string): Record<string, DurableRow> {
    const perTable = shape[table] as Record<string, Record<string, DurableRow>> | undefined;
    if (perTable === undefined) {
      const fresh: Record<string, Record<string, DurableRow>> = {};
      (shape as Record<string, Record<string, Record<string, DurableRow>>>)[table] = fresh;
      return fresh[tenantId] === undefined
        ? (fresh[tenantId] = {})
        : fresh[tenantId]!;
    }
    const perTenant = perTable[tenantId];
    if (perTenant === undefined) {
      return (perTable[tenantId] = {});
    }
    return perTenant;
  }

  function validateRow(table: string, row: DurableRow): void {
    const offenders = invalidRowColumns(row);
    if (offenders.length > 0) {
      throw new TypeError(
        `DurableRecordStore: ${table} row carries non-durable values in: ${offenders.join(", ")}`,
      );
    }
  }

  function sortedPartition(table: string, tenantId: string): readonly DurableStoredRow[] {
    const partition = (shape[table] as Record<string, Record<string, DurableRow>> | undefined)?.[tenantId];
    if (partition === undefined) return [];
    return Object.keys(partition)
      .sort()
      .map((key) => ({ key, row: { ...partition[key]! } }));
  }

  const store: DurableRecordStore = {
    insert(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      validateRow(table_, row);
      const tenantFailure = checkRowTenant(tenantId, row, table_);
      if (tenantFailure !== undefined) return tenantFailure;
      const partition = partitionOf(table_, tenantId);
      if (Object.prototype.hasOwnProperty.call(partition, key_)) {
        return {
          ok: false,
          error: durableAlreadyExists(table_, key_, tenantId, ctx.correlationId),
          reason: "already_exists",
        };
      }
      partition[key_] = { ...row };
      writeBrowserDurableShape(shape);
      return { ok: true };
    },

    put(ctx: TenantContext, table: string, key: string, row: DurableRow): DurableWrite {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      validateRow(table_, row);
      const tenantFailure = checkRowTenant(tenantId, row, table_);
      if (tenantFailure !== undefined) return tenantFailure;
      partitionOf(table_, tenantId)[key_] = { ...row };
      writeBrowserDurableShape(shape);
      return { ok: true };
    },

    get(ctx: TenantContext, table: string, key: string): DurableStoredRow | undefined {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const partition = (shape[table_] as Record<string, Record<string, DurableRow>> | undefined)?.[tenantId];
      const row = partition?.[key_];
      return row === undefined ? undefined : { key: key_, row: { ...row } };
    },

    list(ctx: TenantContext, table: string, opts?: DurableListOptions): readonly DurableStoredRow[] {
      const table_ = requireTableName(table);
      const tenantId = requireTenantContext(ctx);
      const rows = sortedPartition(table_, tenantId);
      const prefix = opts?.prefix;
      const where = opts?.where;
      return rows.filter((stored) => {
        if (prefix !== undefined && !stored.key.startsWith(prefix)) return false;
        if (where !== undefined) {
          for (const [column, value] of Object.entries(where)) {
            if (stored.row[column] !== value) return false;
          }
        }
        return true;
      });
    },

    remove(ctx: TenantContext, table: string, key: string): boolean {
      const table_ = requireTableName(table);
      const key_ = requireRowKey(key);
      const tenantId = requireTenantContext(ctx);
      const partition = (shape[table_] as Record<string, Record<string, DurableRow>> | undefined)?.[tenantId];
      if (partition === undefined || !Object.prototype.hasOwnProperty.call(partition, key_)) {
        return false;
      }
      delete partition[key_];
      writeBrowserDurableShape(shape);
      return true;
    },

    count(ctx: TenantContext, table: string): number {
      const table_ = requireTableName(table);
      const tenantId = requireTenantContext(ctx);
      return sortedPartition(table_, tenantId).length;
    },

    findInvitationByCodeHash(codeHash: string): DurableStoredRow | undefined {
      if (typeof codeHash !== "string" || codeHash.length === 0) return undefined;
      const perTable = shape["fleetos_workspace_invitations"] as
        | Record<string, Record<string, DurableRow>>
        | undefined;
      if (perTable === undefined) return undefined;
      for (const partition of Object.values(perTable)) {
        for (const [key, row] of Object.entries(partition)) {
          if (row["code_hash"] === codeHash) {
            return { key, row: { ...row } };
          }
        }
      }
      return undefined;
    },
  };

  return {
    ...store,
    get snapshot(): Readonly<Record<string, Readonly<Record<string, readonly DurableStoredRow[]>>>> {
      const out: Record<string, Record<string, readonly DurableStoredRow[]>> = {};
      for (const [table, perTenant] of Object.entries(shape)) {
        const perTable: Record<string, readonly DurableStoredRow[]> = {};
        for (const tenantId of Object.keys(perTenant)) {
          perTable[tenantId] = Object.freeze(sortedPartition(table, tenantId));
        }
        out[table] = Object.freeze(perTable);
      }
      return Object.freeze(out);
    },
  };
}

/**
 * The localStorage session store (the W121 persisted-token seam): JSON
 * under one key; `save(null)` removes it; `load` validates the shape
 * and the frozen grammars and refuses EVERYTHING else (fail-closed —
 * the runtime re-validates on top through the resolve seam).
 */
export function createBrowserSessionStore(): ProductSessionStore {
  return {
    save(session: ProductPersistedSession | null): void {
      const storage = browserLocalStorage();
      if (storage === null) return;
      try {
        if (session === null) {
          storage.removeItem(FLEETOS_BROWSER_SESSION_KEY);
        } else {
          storage.setItem(FLEETOS_BROWSER_SESSION_KEY, JSON.stringify(session));
        }
      } catch {
        // Best-effort persistence only; never an authentication path.
      }
    },
    load(): ProductPersistedSession | null {
      const storage = browserLocalStorage();
      if (storage === null) return null;
      try {
        const raw = storage.getItem(FLEETOS_BROWSER_SESSION_KEY);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        const candidate = parsed as { readonly tenantId?: unknown; readonly token?: unknown };
        if (typeof candidate.tenantId !== "string" || typeof candidate.token !== "string") {
          return null;
        }
        if (!candidate.tenantId.startsWith("tnt_") || !candidate.token.startsWith("fst_")) {
          return null;
        }
        return { tenantId: candidate.tenantId, token: candidate.token };
      } catch {
        return null; // corrupted storage fails closed (the runtime clears it)
      }
    },
  };
}

/**
 * The crypto-random session-token generator (the frozen `fst_`
 * grammar, crypto-random body). Injected for the same reason as the
 * salt: a per-runtime deterministic counter would COLLIDE with the
 * persisted (revoked-but-kept) session records after a reload — the
 * durable session table enforces token uniqueness across all records,
 * so fresh sessions need fresh entropy at the binding site.
 */
function browserSessionTokenGenerator(): string {
  const root: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (root !== undefined && typeof root.getRandomValues === "function") {
    const bytes = new Uint8Array(24);
    root.getRandomValues(bytes);
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return `fst_${Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("")}`;
  }
  return `fst_brwsr${Math.random().toString(36).slice(2, 27).padEnd(25, "0")}`;
}

/**
 * The crypto-random session-id generator (the `ses_` prefix). Session
 * ids are the durable session table's PRIMARY KEY — the same
 * uniqueness-across-reloads ruling as the token generator above.
 */
function browserSessionIdGenerator(): string {
  const root: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (root !== undefined && typeof root.getRandomValues === "function") {
    const bytes = new Uint8Array(12);
    root.getRandomValues(bytes);
    return `ses_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `ses_brwsr${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * The crypto-random salt generator (entropy is legal at the composition
 * root — the same ruling as the real clock; deterministic tests inject
 * their own seam). Falls back to a best-effort random hex when the Web
 * Crypto RNG is unavailable.
 */
function browserSaltGenerator(): string {
  const root: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (root !== undefined && typeof root.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    root.getRandomValues(bytes);
    return `slt_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `slt_fallback${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

export function ConsoleApp({ initialRoute }: ConsoleAppProps): JSX.Element {
  const runtime = useMemo(
    () =>
      createProductSessionRuntime({
        now: realClock,
        ttlSeconds: 60 * 60 * 8,
        // W121: the REAL seams this composition root injects — the
        // iterated-SHA-256 password hasher, the crypto-random salts,
        // the browser durable identity store (localStorage) and the
        // persisted session-token store. The identity package's own
        // defaults stay deterministic; the browser tier is injected
        // HERE, at the binding site.
        passwordHasher: createBrowserPasswordHasher(),
        saltGenerator: browserSaltGenerator,
        sessionToken: browserSessionTokenGenerator,
        sessionId: browserSessionIdGenerator,
        durableStore: createBrowserDurableRecordStore(),
        sessionStore: createBrowserSessionStore(),
      }),
    [],
  );
  // SSR/hydration law: the first paint is ALWAYS the signed-out gate
  // (the server render owns no browser stores); the client syncs the
  // persisted truth after mount — reload restores the session through
  // the resolve seam, never a fabricated first-paint login.
  const [state, setState] = useState<ProductSessionState>(() => ({ phase: "signed-out" }));
  const [refusal, setRefusal] = useState<
    { readonly reason: ProductAuthRefusal; readonly message: string } | null
  >(null);
  const [directory, setDirectory] = useState<readonly ProductWorkspaceSummary[]>(() => []);
  useEffect(() => {
    setState(runtime.state());
    setDirectory(runtime.listWorkspaces());
  }, [runtime]);
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
    (input: {
      readonly name: string;
      readonly displayName: string;
      readonly email: string;
      readonly password: string;
    }) => {
      apply(
        runtime.createWorkspace({
          name: input.name,
          founderDisplayName: input.displayName,
          founderEmail: input.email,
          password: input.password,
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
    (input: { readonly tenantId: string; readonly email: string; readonly password: string }) => {
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
    // W121: the honest recovery — with password credentials the gate can
    // no longer silently re-authenticate the expired session's member
    // (that would bypass the credential seam). Recovery clears the dead
    // session and returns to the choice screen, where the member signs
    // back in WITH their credentials (never a fabricated re-login).
    apply(runtime.signOut());
    resetInvite();
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
