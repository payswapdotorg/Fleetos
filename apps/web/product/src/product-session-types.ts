/**
 * @fleetos/web-product — the product session TYPES (W101 [TL]).
 *
 * The pure presentation contracts of the product session state
 * machine: phases, projections, refusal vocabulary + frozen human
 * explanations, the seams' shape, and the transition result. The
 * RUNTIME that composes the REAL identity services lives in the
 * console's composition root (apps/web/src/runtime/product-session.ts
 * — the sanctioned binding site); these types are its public
 * presentation contract.
 *
 * Pure TypeScript: no clock, no entropy, no I/O, no `any`.
 */

// ---------------------------------------------------------------------------
// UI state projections (pure; derived, never stored)
// ---------------------------------------------------------------------------

import type { ProductExperienceRole } from "./role-bridge";

/** The product session's UI phases (the shell gate's source of truth). */
export type ProductSessionPhase = "signed-out" | "onboarding" | "active" | "expired";

/** The persisted workspace summary the choice screen lists. */
export interface ProductWorkspaceSummary {
  readonly tenantId: string;
  readonly name: string;
  readonly createdAt: string;
}

/** The authenticated product session projection. */
export interface ProductActiveSession {
  readonly phase: "onboarding" | "active" | "expired";
  readonly tenantId: string;
  readonly workspaceName: string;
  readonly principalId: string;
  readonly memberRef: string;
  readonly displayName: string;
  readonly sessionToken: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly assignedRoles: readonly string[];
  readonly activeRole: ProductExperienceRole | null;
  readonly isFirstRun: boolean;
}

/** The full product session state (the UI projection). */
export type ProductSessionState =
  | { readonly phase: "signed-out" }
  | ProductActiveSession;

/** Machine-stable refusals of the product transitions. */
export type ProductAuthRefusal =
  | "invalid_input"
  | "unknown_workspace"
  | "unknown_principal"
  | "invalid_code"
  | "expired_code"
  | "revoked_code"
  | "role_not_assigned"
  | "unknown_session"
  | "no_experience_role"
  | "unknown_account"
  | "wrong_password"
  | "credential_revoked";

/** The frozen human explanations for every refusal code. */
export const PRODUCT_REFUSAL_EXPLANATIONS: Readonly<Record<ProductAuthRefusal, string>> =
  Object.freeze({
    invalid_input:
      "Some entered details were missing or invalid. Check the fields and try again.",
    unknown_workspace:
      "That workspace was not found. Pick a listed workspace or create one.",
    unknown_principal:
      "No member with that email exists in this workspace. Ask an administrator to invite you.",
    invalid_code:
      "That join code is not valid for any workspace. Check the code and try again.",
    expired_code:
      "That join code has expired. Ask an administrator for a fresh invitation.",
    revoked_code:
      "That join code was revoked. Ask an administrator for a fresh invitation.",
    role_not_assigned:
      "That role is not assigned to you in this workspace, so it cannot be activated.",
    unknown_session: "The session could not be found. Sign in again to continue.",
    no_experience_role:
      "This account has no product role assigned yet. Ask an administrator to grant one.",
    unknown_account:
      "No password is set for this account. Ask an administrator to issue sign-in credentials.",
    wrong_password:
      "That password is incorrect. Check it and try again.",
    credential_revoked:
      "This account's sign-in credentials were revoked. Ask an administrator to reissue them.",
  });

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** The injected deterministic seams. */
export interface ProductSessionSeams {
  /** The current instant (ISO 8601) — injected, never read from a clock. */
  readonly now: () => string;
  /** Session lifetime in seconds (positive integer). */
  readonly ttlSeconds: number;
  /** Tenant id generator (must match the `tnt_` grammar). */
  readonly tenantId?: () => string;
  /** Join-code generator. */
  readonly joinCode?: () => string;
  /** Session token generator (must match the `fst_` grammar). */
  readonly sessionToken?: () => string;
  /** Correlation id generator. */
  readonly correlationId?: () => string;
  /** The workspace directory seed (pre-existing workspaces to list). */
  readonly seedWorkspaces?: readonly ProductWorkspaceSummary[];
  /**
   * W121 — the persistent browser-session store. The runtime persists
   * the CURRENT session token through this seam (every session-opening
   * transition saves; sign-out clears) and re-resolves the persisted
   * token at construction — reload KEEPS the session honest (expiry
   * still enforced via the resolve seam; corrupted/unknown/mismatched
   * tokens fail closed to the gate). The localStorage implementation
   * is injected at the composition root (product-gate.tsx).
   */
  readonly sessionStore?: ProductSessionStore;
}

/**
 * The persisted browser-session payload (the reload memory): the
 * tenant the session belongs to plus the opaque session token. The
 * tenant rides along because session resolution is tenant-scoped by
 * construction — a token issued in tenant A is unknown in tenant B,
 * so a mismatched pair fails closed to the gate.
 */
export interface ProductPersistedSession {
  /** The session's tenant (must match the `tnt_` grammar). */
  readonly tenantId: string;
  /** The opaque session token (must match the `fst_` grammar). */
  readonly token: string;
}

/**
 * The injected persistent browser-session store (W121). Pure
 * persistence — NO validation truth lives here: the runtime treats
 * whatever `load` returns as UNTRUSTED and re-resolves it through the
 * real session seam (fail-closed on anything malformed, unknown,
 * expired, or revoked). `save(null)` clears the persisted session.
 */
export interface ProductSessionStore {
  /** Persist the session payload (null clears it). */
  save(session: ProductPersistedSession | null): void;
  /** The persisted payload, when present — never trusted as-is. */
  load(): ProductPersistedSession | null;
}

/** A fail-closed product failure (the shared refusal shape). */
export interface ProductAuthFailure {
  readonly ok: false;
  readonly reason: ProductAuthRefusal;
  readonly message: string;
}

/** The result of issuing a join invitation (code visible exactly once). */
export type IssueInvitationResult =
  | { readonly ok: true; readonly rawCode: string }
  | ProductAuthFailure;


export type ProductTransitionResult =
  | { readonly ok: true; readonly state: ProductSessionState }
  | {
      readonly ok: false;
      readonly reason: ProductAuthRefusal;
      readonly message: string;
    };

