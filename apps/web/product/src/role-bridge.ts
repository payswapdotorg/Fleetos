/**
 * @fleetos/web-product — the role bridge (W101 [TL]).
 *
 * The frozen deterministic bridge between the TWO role vocabularies the
 * product composes:
 *
 *   - the EXPERIENCE roles (ROLE-EXPERIENCE-MATRIX.yaml — the 7-role
 *     product vocabulary consumed by the W100B lane lenses);
 *   - the SHELL operator roles (the W091 navigation/interaction model
 *     over the frozen ten-area route vocabulary).
 *
 * The bridge is PRESENTATION-ONLY (the matrix rule
 * `experience_profiles_do_not_grant_permissions`): the shell operator
 * role derived here shapes navigation emphasis; AUTHORITY always comes
 * from identity + the Guardian — never from this mapping. The
 * restricted-surface vocabulary (employee/vendor.operator) renders
 * explicit restricted states, never hidden authority.
 *
 * Pure TypeScript: no clock, no entropy, no I/O, no `any`.
 */

import type { ShellOperatorRole } from "@fleetos/web-shell";

/** The seven experience roles (the frozen product matrix vocabulary). */
export type ProductExperienceRole =
  | "fleet.admin"
  | "service.desk"
  | "security.compliance"
  | "asset.manager"
  | "team.manager"
  | "employee"
  | "vendor.operator";

/** The full experience-role vocabulary (frozen total list). */
export const PRODUCT_EXPERIENCE_ROLES: readonly ProductExperienceRole[] = Object.freeze([
  "fleet.admin",
  "service.desk",
  "security.compliance",
  "asset.manager",
  "team.manager",
  "employee",
  "vendor.operator",
]);

/** Operator-facing labels (the matrix's `label` column, verbatim). */
export const PRODUCT_EXPERIENCE_ROLE_LABELS: Readonly<
  Record<ProductExperienceRole, string>
> = Object.freeze({
  "fleet.admin": "Fleet Administrator",
  "service.desk": "Service Desk",
  "security.compliance": "Security & Compliance",
  "asset.manager": "Asset & Procurement Manager",
  "team.manager": "Team Manager",
  employee: "Employee / Device Owner",
  "vendor.operator": "Vendor / Service Operator",
});

/**
 * The frozen experience -> shell-operator mapping.
 *
 * Deterministic, total, and auditable: exactly one shell operator role
 * per experience role. The mapping favors the LEAST permissive shell
 * role that still exposes the experience role's primary areas (the
 * matrix's `primary_areas` column) — a presentation subset can never
 * widen navigation beyond what the shell's own matrix allows.
 */
const EXPERIENCE_TO_OPERATOR: Readonly<Record<ProductExperienceRole, ShellOperatorRole>> =
  Object.freeze({
    "fleet.admin": "owner",
    "service.desk": "operator",
    "security.compliance": "approver",
    "asset.manager": "operator",
    "team.manager": "approver",
    employee: "viewer",
    "vendor.operator": "viewer",
  });

/** Derive the shell operator role for an experience role (total, frozen). */
export function operatorRoleFor(role: ProductExperienceRole): ShellOperatorRole {
  return EXPERIENCE_TO_OPERATOR[role];
}

/**
 * The experience roles whose product surfaces are RESTRICTED subsets
 * (the handoff's "employee/vendor restricted surfaces"): they render an
 * explicit restricted-state presentation, never a silent denial and
 * never a hidden affordance.
 */
export const RESTRICTED_EXPERIENCE_ROLES: readonly ProductExperienceRole[] = Object.freeze([
  "employee",
  "vendor.operator",
]);

/** Whether an experience role renders restricted product surfaces. */
export function isRestrictedExperienceRole(role: ProductExperienceRole): boolean {
  return RESTRICTED_EXPERIENCE_ROLES.includes(role);
}

/**
 * The home lens headline (the matrix's `home_lens` column, verbatim) —
 * the role-shaped Control Tower's opening emphasis.
 */
export const PRODUCT_HOME_LENS: Readonly<Record<ProductExperienceRole, string>> = Object.freeze({
  "fleet.admin": "governance",
  "service.desk": "operations",
  "security.compliance": "risk",
  "asset.manager": "resources",
  "team.manager": "team",
  employee: "personal",
  "vendor.operator": "exchange",
});

/**
 * The first-run onboarding emphasis per experience role: which rail
 * step the role's journey starts from (deterministic, presentation).
 */
export const PRODUCT_ONBOARDING_ENTRY_STEP: Readonly<
  Record<ProductExperienceRole, "workspace" | "install" | "invite" | "explore">
> = Object.freeze({
  "fleet.admin": "workspace",
  "service.desk": "install",
  "security.compliance": "explore",
  "asset.manager": "invite",
  "team.manager": "invite",
  employee: "install",
  "vendor.operator": "explore",
});

/**
 * Narrow an experience role from a persisted identity role-assignment
 * name (fail-closed): an unknown role name maps to `null` — the caller
 * renders the explicit unknown-role state, NEVER a guessed default.
 */
export function experienceRoleFromAssignment(
  roleName: string,
): ProductExperienceRole | null {
  return (PRODUCT_EXPERIENCE_ROLES as readonly string[]).includes(roleName)
    ? (roleName as ProductExperienceRole)
    : null;
}

// ---------------------------------------------------------------------------
// W130 — honest denials for restricted roles (the ROLE-EXPERIENCE-MATRIX
// law: unavailable_capabilities_show_reason_and_escalation_path)
// ---------------------------------------------------------------------------

/**
 * The machine-stable view of a restricted role's denied action: the
 * frozen reason (the shell's interaction-matrix vocabulary) plus the
 * frozen human explanation (why the capability is unavailable + the
 * escalation path). Pure presentation copy — the AUTHORITY is the
 * shell's frozen interaction matrix, checked at the composition root.
 */
export interface RestrictedActionDenialView {
  /** The machine-stable reason (the shell's frozen refusal vocabulary). */
  readonly reason: string;
  /** The frozen human words: why unavailable + the escalation path. */
  readonly explanation: string;
}

/**
 * The honest denial for a restricted role attempting to CREATE AN
 * ENROLLMENT CODE (the Install Center's viewer-role control, W130):
 * viewer roles (employee / vendor.operator) can OBSERVE the Install
 * Center but cannot issue enrollment codes — the click renders this
 * explanation instead of a silent no-op (the sim-b blocker).
 */
export function enrollmentCodeCreationDenial(
  role: ProductExperienceRole | null,
): RestrictedActionDenialView {
  const label =
    role === null ? "your current role" : PRODUCT_EXPERIENCE_ROLE_LABELS[role];
  return {
    reason: "interaction_forbidden",
    explanation:
      `Your active role (${label}) can observe the Install Center but cannot create enrollment codes — ` +
      "issuing a one-time enrollment code is reserved for operator-and-above roles. " +
      "Ask your workspace's Fleet Administrator or Service Desk to create the enrollment code for you.",
  };
}
