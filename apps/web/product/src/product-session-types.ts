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
  | "no_experience_role";

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

