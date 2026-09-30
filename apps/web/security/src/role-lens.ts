/**
 * @fleetos/web-security — the ROLE LENS experience contract (W100B).
 *
 * The frozen role model consumed as a PUBLIC EXPERIENCE CONTRACT:
 * `spec/ui/ROLE-EXPERIENCE-MATRIX.yaml` (seven roles, home lenses,
 * primary areas) + `spec/ui/ROLEFUL-UX-ARCHITECTURE.md` § Canonical
 * role families / Role-to-surface emphasis. This lane DECLARES its
 * local copy of that presentation data (the W040-disclosed pattern —
 * frozen tables mirrored locally, conformance PROVEN against the spec
 * files by `test/role-lens-matrix.test.ts`), and shapes ONLY:
 *
 *   - what FleetOS emphasizes first (lens lead, emphasis levels);
 *   - the copy shown to the user (primary question, lens description);
 *   - the restricted-capability explanations (reason + escalation path).
 *
 * THE MATRIX RULES ARE LOAD-BEARING (asserted by test):
 *
 *   - experience_profiles_do_not_grant_permissions — the lens view
 *     carries the effective authority VERBATIM (`authority` echo) and
 *     every restricted explanation carries `grantsAnything: false`.
 *     No role, no emphasis level, no lens copy can add a permission.
 *   - effective_permissions_come_from_identity_and_guardian — the
 *     authority input is a STRUCTURAL SEAM (tenant + principal +
 *     permission-name list) structurally satisfied by @fleetos/identity's
 *     `ResolvedPermissions` (fold of the active role assignments —
 *     proven by the binding test with the REAL resolver).
 *   - active_role_is_scoped_to_current_tenant — the authority's tenant
 *     MUST match the acting scope (fail-closed refusal).
 *   - unavailable_capabilities_show_reason_and_escalation_path — every
 *     capability the authority lacks renders its machine-stable reason
 *     (`missing_permission`), the emphasis roles, a lens-switch
 *     affordance ONLY when an ASSIGNED role emphasizes it, and the
 *     role-assignment escalation path otherwise.
 *
 * The lens NEVER filters records (record scoping — e.g. the employee's
 * personal-device scope — happens at the BINDING SITE, never here):
 * same records in = same records out, only the emphasis changes.
 *
 * PURE: no clock, no entropy, no I/O; the same inputs produce
 * byte-identical lens views. Outputs deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  compareStrings,
  deepFrozen,
  frozen,
  frozenArray,
  isNonEmptyString,
  isPlainObject,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import type { TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The frozen role union (spec/ui/ROLE-EXPERIENCE-MATRIX.yaml — verbatim)
// ---------------------------------------------------------------------------

/**
 * The seven experience roles (the frozen matrix union). Presentation
 * ONLY: authorization remains owned by identity + Contract Guardian.
 */
export type ExperienceRole =
  | "fleet.admin"
  | "service.desk"
  | "security.compliance"
  | "asset.manager"
  | "team.manager"
  | "employee"
  | "vendor.operator";

/** All roles in the matrix's canonical (alphabetical) order. */
export const ALL_EXPERIENCE_ROLES: readonly ExperienceRole[] = Object.freeze([
  "asset.manager",
  "employee",
  "fleet.admin",
  "security.compliance",
  "service.desk",
  "team.manager",
  "vendor.operator",
]);

/** The role labels (the matrix `label` fields, verbatim). */
export const EXPERIENCE_ROLE_LABELS: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin": "Fleet Administrator",
  "service.desk": "Service Desk",
  "security.compliance": "Security & Compliance",
  "asset.manager": "Asset & Procurement Manager",
  "team.manager": "Team Manager",
  "employee": "Employee / Device Owner",
  "vendor.operator": "Vendor / Service Operator",
});

/** The home lens of each role (the matrix `home_lens` fields, verbatim). */
export const EXPERIENCE_ROLE_HOME_LENS: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin": "governance",
  "service.desk": "operations",
  "security.compliance": "risk",
  "asset.manager": "resources",
  "team.manager": "team",
  "employee": "personal",
  "vendor.operator": "exchange",
});

/**
 * The primary question FleetOS answers for each role
 * (ROLEFUL-UX-ARCHITECTURE § Canonical role families, verbatim).
 */
export const EXPERIENCE_ROLE_PRIMARY_QUESTIONS: Readonly<Record<ExperienceRole, string>> =
  Object.freeze({
    "fleet.admin": "What is the state of my fleet and what must I govern?",
    "service.desk": "Which devices/users need help and what can I safely do next?",
    "security.compliance": "What risks, policy decisions, approvals and evidence need attention?",
    "asset.manager": "What should we buy, maintain, replace or subscribe to?",
    "team.manager": "How is my team affected and which requests/approvals need me?",
    "employee": "Is my device healthy, what should I do, and how do I request help?",
    "vendor.operator": "Which quotes, work orders and fulfillment steps require my response?",
  });

// ---------------------------------------------------------------------------
// The lane emphasis levels (ROLEFUL-UX-ARCHITECTURE § Role-to-surface
// emphasis — the exact table tokens for THIS lane's surfaces)
// ---------------------------------------------------------------------------

/**
 * One emphasis level for one lane surface, as worded by the frozen
 * role-to-surface emphasis table (the tokens that appear across this
 * lane's surfaces: High / Medium / Highest / Low / Personal-policy /
 * Explain / Request / Personal).
 */
export type LaneEmphasis =
  | "High"
  | "Medium"
  | "Highest"
  | "Low"
  | "Personal-policy"
  | "Explain"
  | "Request"
  | "Personal";

/** The security findings emphasis (the table's Security row, verbatim). */
export const FINDINGS_EMPHASIS: Readonly<Record<ExperienceRole, LaneEmphasis>> = Object.freeze({
  "fleet.admin": "High",
  "service.desk": "Medium",
  "security.compliance": "Highest",
  "asset.manager": "Medium",
  "team.manager": "Low",
  "employee": "Personal-policy",
  "vendor.operator": "Low",
});

/** The policies emphasis (the table's Policies row, verbatim). */
export const POLICIES_EMPHASIS: Readonly<Record<ExperienceRole, LaneEmphasis>> = Object.freeze({
  "fleet.admin": "High",
  "service.desk": "Medium",
  "security.compliance": "Highest",
  "asset.manager": "Medium",
  "team.manager": "Low",
  "employee": "Explain",
  "vendor.operator": "Low",
});

/**
 * The approvals emphasis (the approvals queue lives in the Security
 * area — the table's Security row, verbatim).
 */
export const APPROVALS_EMPHASIS: Readonly<Record<ExperienceRole, LaneEmphasis>> = Object.freeze({
  "fleet.admin": "High",
  "service.desk": "Medium",
  "security.compliance": "Highest",
  "asset.manager": "Medium",
  "team.manager": "Low",
  "employee": "Personal-policy",
  "vendor.operator": "Low",
});

/** The evidence emphasis (the table's Evidence & Audit row, verbatim). */
export const EVIDENCE_EMPHASIS: Readonly<Record<ExperienceRole, LaneEmphasis>> = Object.freeze({
  "fleet.admin": "High",
  "service.desk": "High",
  "security.compliance": "Highest",
  "asset.manager": "High",
  "team.manager": "Medium",
  "employee": "Personal",
  "vendor.operator": "High",
});

/** One-line lens leads (this lane's voice per role). */
export const EXPERIENCE_ROLE_LENS_LEADS: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin": "The governance lens: fleet-wide findings, policy decisions and their evidence lead.",
  "service.desk": "The operations lens: what needs help now and what you can safely do next.",
  "security.compliance": "The risk lens: findings, Guardian decisions, approvals and evidence trails lead.",
  "asset.manager": "The resources lens: security posture in the context of what you buy and maintain.",
  "team.manager": "The team lens: how findings and approvals affect your team, summarized.",
  "employee": "The personal lens: your device's security explained plainly, with a path to request help.",
  "vendor.operator": "The exchange lens: only the security context of your contracted work.",
});

// ---------------------------------------------------------------------------
// The acting authority snapshot (structural seam for identity)
// ---------------------------------------------------------------------------

/**
 * The effective authority snapshot — a STRUCTURAL SEAM structurally
 * satisfied by @fleetos/identity's `ResolvedPermissions` (tenant +
 * principal + the fold of active role-assignment permissions, resolved
 * sorted-unique by the identity domain). The lens CONSUMES it; it never
 * computes, widens, or re-derives it (effective permissions come from
 * identity and the Guardian — the matrix rule).
 */
export interface RoleLensAuthorityInput {
  /** The tenant the authority was resolved in (must equal the acting scope). */
  readonly tenantId: TenantId;
  /** The principal the authority was resolved for. */
  readonly principalId: string;
  /** The effective permission names (verbatim from identity's resolution). */
  readonly permissions: readonly string[];
}

/**
 * The authority ECHO on every lens view — the input snapshot carried
 * VERBATIM with the machine-asserted disclosure that the lens granted
 * nothing (`lensGrantsNothing: true`). Identical authority input +
 * any lens => identical echo (proven by test).
 */
export interface RoleLensAuthorityEcho {
  /** The disclosure of WHERE effective permissions come from (the matrix rule). */
  readonly source: "identity_and_guardian";
  readonly tenantId: TenantId;
  readonly principalId: string;
  /** The permission names, VERBATIM (order preserved — never widened). */
  readonly permissions: readonly string[];
  /** Machine-asserted: this lens granted nothing. */
  readonly lensGrantsNothing: true;
}

// ---------------------------------------------------------------------------
// Restricted capabilities (reason + escalation path — the matrix rule)
// ---------------------------------------------------------------------------

/**
 * The escalation path shown when a capability is unavailable and no
 * assigned-role lens emphasizes it: the request path (a role
 * assignment), never a grant.
 */
export interface EscalationPathView {
  /** The escalation kind (presentation vocabulary). */
  readonly kind: "role_assignment";
  /** Who the request goes to (displayed). */
  readonly requestLabel: string;
  /** The machine-stable request action (displayed alongside). */
  readonly action: string;
}

/**
 * One restricted capability explanation: WHY it is unavailable (the
 * machine-stable reason + the missing permission), which lens roles
 * emphasize it, a lens-switch affordance ONLY when an ASSIGNED role
 * emphasizes it, and the escalation path. Carries `grantsNothing`.
 */
export interface RestrictedCapabilityView {
  /** The lane capability name (machine-stable). */
  readonly capability: string;
  /** The human label (displayed). */
  readonly label: string;
  /** The permission name the effective authority lacks. */
  readonly requiredPermission: string;
  /** The machine-stable reason (one value today: missing_permission). */
  readonly reason: "missing_permission";
  /** The lens roles that emphasize this capability (canonical order). */
  readonly emphasisRoles: readonly ExperienceRole[];
  /**
   * A lens-switch affordance: an ASSIGNED role (other than the active
   * one) whose lens emphasizes the capability — switching changes what
   * FleetOS EMPHASIZES, never what the authority permits (the copy says
   * so). Null when no assigned role qualifies.
   */
  readonly switchToRole: ExperienceRole | null;
  /** The escalation path (the role-assignment request). */
  readonly escalation: EscalationPathView;
  /** Machine-asserted: this explanation grants nothing. */
  readonly grantsNothing: false;
}

/**
 * A lane capability descriptor: the presentation-side catalog entry
 * pairing a UI capability with the permission the EFFECTIVE authority
 * must include (the authority input decides — never the lens).
 */
export interface LaneCapabilityDescriptor {
  /** The capability name (machine-stable, matches the required permission by convention). */
  readonly capability: string;
  /** The human label (displayed). */
  readonly label: string;
  /** The permission name the effective authority must include. */
  readonly requiredPermission: string;
  /** The lens roles that emphasize this capability (canonical order). */
  readonly emphasisRoles: readonly ExperienceRole[];
}

/**
 * The security lane's capability catalog. The requiredPermission names
 * are the identity-domain permission vocabulary this lane's surfaces
 * gate on; the authority input (identity + Guardian) decides.
 */
export const SECURITY_LANE_CAPABILITIES: readonly LaneCapabilityDescriptor[] = Object.freeze([
  Object.freeze({
    capability: "security.finding.read",
    label: "Review security findings",
    requiredPermission: "security.finding.read",
    emphasisRoles: Object.freeze(["security.compliance", "fleet.admin", "service.desk"] as const),
  } satisfies LaneCapabilityDescriptor),
  Object.freeze({
    capability: "security.remediation.propose",
    label: "Propose a remediation action",
    requiredPermission: "security.remediation.propose",
    emphasisRoles: Object.freeze(["security.compliance", "fleet.admin"] as const),
  } satisfies LaneCapabilityDescriptor),
  Object.freeze({
    capability: "security.approval.decide",
    label: "Decide parked approvals",
    requiredPermission: "security.approval.decide",
    emphasisRoles: Object.freeze(["security.compliance", "fleet.admin"] as const),
  } satisfies LaneCapabilityDescriptor),
  Object.freeze({
    capability: "policy.rule.read",
    label: "Inspect Guardian policy rules",
    requiredPermission: "policy.rule.read",
    emphasisRoles: Object.freeze(["security.compliance", "fleet.admin"] as const),
  } satisfies LaneCapabilityDescriptor),
]);

/** The escalation request label (the role-assignment request path). */
export const ROLE_ASSIGNMENT_ESCALATION_LABEL = "Fleet Administrator" as const;

// ---------------------------------------------------------------------------
// The lens view + builder
// ---------------------------------------------------------------------------

/** The lens input: the active role, the assigned roles, the authority. */
export interface SecurityRoleLensInput {
  /** The active experience role (a selector — never an authority). */
  readonly activeRole: ExperienceRole;
  /** The roles assigned to the principal in this tenant (default: [activeRole]). */
  readonly assignedRoles?: readonly ExperienceRole[];
  /** The effective authority snapshot (identity + Guardian, injected). */
  readonly authority: RoleLensAuthorityInput;
}

/** The security/policy lane's role lens view (presentation only). */
export interface SecurityRoleLensView {
  /** The acting tenant scope. */
  readonly tenantId: TenantId;
  /** The active role. */
  readonly activeRole: ExperienceRole;
  /** The active role's label (the matrix `label`, verbatim). */
  readonly roleLabel: string;
  /** The active role's home lens (the matrix `home_lens`, verbatim). */
  readonly homeLens: string;
  /** The primary question this lens answers (ROLEFUL-UX-ARCHITECTURE, verbatim). */
  readonly primaryQuestion: string;
  /** The one-line lens lead (this lane's voice). */
  readonly lensLead: string;
  /** The findings surface emphasis for the active role. */
  readonly findingsEmphasis: LaneEmphasis;
  /** The policies surface emphasis for the active role. */
  readonly policiesEmphasis: LaneEmphasis;
  /** The approvals surface emphasis for the active role. */
  readonly approvalsEmphasis: LaneEmphasis;
  /** The evidence surface emphasis for the active role. */
  readonly evidenceEmphasis: LaneEmphasis;
  /** The roles assigned to the principal in this tenant (canonical order). */
  readonly assignedRoles: readonly ExperienceRole[];
  /** The authority echo — VERBATIM, never widened (asserted by test). */
  readonly authority: RoleLensAuthorityEcho;
  /** The capabilities the effective authority lacks, with reason + escalation. */
  readonly restricted: readonly RestrictedCapabilityView[];
  /** Machine-asserted: this lens view grants nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildSecurityRoleLens`. */
export type SecurityRoleLensResult = SurfaceResult<SecurityRoleLensView>;

/** Validate an authority snapshot at the given path prefix. */
function validateAuthority(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isNonEmptyString(candidate["principalId"])) {
    failures.push({ path: `${path}/principalId`, reason: "non_empty_string_required" });
  }
  const permissions = candidate["permissions"];
  if (!Array.isArray(permissions)) {
    failures.push({ path: `${path}/permissions`, reason: "array_required" });
  } else {
    for (let i = 0; i < permissions.length; i++) {
      if (!isNonEmptyString(permissions[i])) {
        failures.push({ path: `${path}/permissions/${i}`, reason: "non_empty_string_required" });
      }
    }
  }
}

/**
 * Build the security/policy lane's role lens view.
 *
 * Fail-closed discipline:
 *   - the scope and the authority snapshot's tenant MUST agree (the
 *     active role is scoped to the current tenant — a cross-tenant
 *     authority REFUSES, never silently re-scopes);
 *   - the active role MUST be one of the seven matrix roles;
 *   - the active role MUST be among the assigned roles (you cannot
 *     activate a role you do not hold);
 *   - assigned roles are deduplicated into canonical order.
 *
 * The restricted explanations list every lane capability the authority
 * lacks, each with its reason, emphasis roles, a switch affordance ONLY
 * for an assigned emphasizing role, and the role-assignment escalation
 * path. The authority echo is VERBATIM.
 *
 * @param scope the acting tenant scope (first parameter, tenant discipline)
 * @param input the lens input (active role + assigned roles + authority)
 * @returns the tagged result: the frozen lens view or a machine-stable error
 */
export function buildSecurityRoleLens(
  scope: { readonly tenantId: TenantId },
  input: SecurityRoleLensInput,
): SecurityRoleLensResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "role lens requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of the lens input.
  const failures: SurfaceValidationFailure[] = [];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role lens requires an input object",
        scope.tenantId,
        [{ path: "/input", reason: "object_required" }],
      ),
    };
  }
  const activeRole = input["activeRole"];
  if (
    typeof activeRole !== "string" ||
    !(ALL_EXPERIENCE_ROLES as readonly string[]).includes(activeRole)
  ) {
    failures.push({ path: "/input/activeRole", reason: "unknown_role" });
  }
  validateAuthority(input["authority"], "/input/authority", failures);
  if (input["assignedRoles"] !== undefined) {
    if (!Array.isArray(input["assignedRoles"])) {
      failures.push({ path: "/input/assignedRoles", reason: "array_required" });
    } else {
      const seen = new Set<string>();
      for (let i = 0; input.assignedRoles.length > i; i++) {
        const role = input.assignedRoles[i];
        if (typeof role !== "string" || !(ALL_EXPERIENCE_ROLES as readonly string[]).includes(role)) {
          failures.push({ path: `/input/assignedRoles/${i}`, reason: "unknown_role" });
        } else if (seen.has(role)) {
          failures.push({ path: `/input/assignedRoles/${i}`, reason: "duplicate_role" });
        } else {
          seen.add(role);
        }
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role lens input is invalid",
        scope.tenantId,
        failures,
      ),
    };
  }
  // Phase 2 — the tenant discipline (authority tenant == acting scope).
  const authority = input.authority as RoleLensAuthorityInput;
  if (authority.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "role lens refuses a cross-tenant authority snapshot",
        scope.tenantId,
        [{ path: "/input/authority/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 3 — the assignment discipline (active role must be assigned).
  const assignedRoles: ExperienceRole[] =
    input.assignedRoles === undefined ? [input.activeRole] : [...input.assignedRoles];
  if (!(assignedRoles as readonly string[]).includes(input.activeRole)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role lens refuses an active role the principal does not hold",
        scope.tenantId,
        [{ path: "/input/activeRole", reason: "role_not_assigned" }],
      ),
    };
  }
  assignedRoles.sort(compareStrings);
  // Phase 4 — the presentation projection (emphasis + restricted
  // explanations; the authority echo is VERBATIM — never re-derived).
  const role = input.activeRole;
  const assignedSet = new Set<string>(assignedRoles as readonly string[]);
  const restricted: RestrictedCapabilityView[] = [];
  for (const descriptor of SECURITY_LANE_CAPABILITIES) {
    if ((authority.permissions as readonly string[]).includes(descriptor.requiredPermission)) {
      continue; // enabled — the authority decides, not the lens.
    }
    const switchCandidate = descriptor.emphasisRoles.find(
      (emphasisRole) =>
        assignedSet.has(emphasisRole) && emphasisRole !== input.activeRole,
    );
    restricted.push(
      frozen({
        capability: descriptor.capability,
        label: descriptor.label,
        requiredPermission: descriptor.requiredPermission,
        reason: "missing_permission",
        emphasisRoles: frozenArray(
          [...descriptor.emphasisRoles].sort(compareStrings),
        ),
        switchToRole: switchCandidate ?? null,
        escalation: frozen({
          kind: "role_assignment",
          requestLabel: ROLE_ASSIGNMENT_ESCALATION_LABEL,
          action: `request the ${descriptor.emphasisRoles[0] ?? "fleet.admin"} role assignment`,
        } satisfies EscalationPathView),
        grantsNothing: false,
      } satisfies RestrictedCapabilityView),
    );
  }
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        activeRole: role,
        roleLabel: EXPERIENCE_ROLE_LABELS[role],
        homeLens: EXPERIENCE_ROLE_HOME_LENS[role],
        primaryQuestion: EXPERIENCE_ROLE_PRIMARY_QUESTIONS[role],
        lensLead: EXPERIENCE_ROLE_LENS_LEADS[role],
        findingsEmphasis: FINDINGS_EMPHASIS[role],
        policiesEmphasis: POLICIES_EMPHASIS[role],
        approvalsEmphasis: APPROVALS_EMPHASIS[role],
        evidenceEmphasis: EVIDENCE_EMPHASIS[role],
        assignedRoles: frozenArray(assignedRoles),
        authority: frozen({
          source: "identity_and_guardian",
          tenantId: authority.tenantId,
          principalId: authority.principalId,
          permissions: frozenArray(authority.permissions as readonly string[]),
          lensGrantsNothing: true,
        } satisfies RoleLensAuthorityEcho),
        restricted: frozenArray(restricted),
        grantsAnything: false,
      } satisfies SecurityRoleLensView),
    ),
  };
}
