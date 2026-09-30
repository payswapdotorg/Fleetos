/**
 * @fleetos/web-actions — W100B: the ROLE-SHAPED Fleet Action plan
 * surface.
 *
 * The W041/W090B action plan presentation (UNCHANGED —
 * `buildActionPlanView` remains the single source of truth for the
 * gated state machine, the linked Guardian decision context and the
 * dispatch handoff disclosure) shaped by the active role lens:
 *
 *   - the UNDERLYING plan presentation (status, gated transitions,
 *     linked decision context, evidence, content digest) is IDENTICAL
 *     for every lens (proven by test);
 *   - the LENS changes ONLY the emphasis: the lead copy (what the role
 *     reads first — the security lens leads with the Guardian decision
 *     chain; the team-manager lens leads with who requested it and
 *     whether their approval is needed; the employee lens leads with
 *     the request state in plain language);
 *   - the propose/approve affordances' availability is AUTHORITY-derived
 *     (identity + Guardian) — NEVER role-derived. When unavailable
 *     they render the restricted-capability explanation (reason +
 *     escalation path — the matrix rule).
 *
 * PURE: no clock, no entropy, no I/O; deterministic and deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  deepFrozen,
  frozen,
  frozenArray,
  isPlainObject,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult } from "./internal";
import { buildActionPlanView } from "./action-plans-view";
import type { ActionPlanPresentationView } from "./action-plans-view";
import type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
  SurfaceTenantScope,
} from "./surface-contracts";
import type { ActionsRoleLensView } from "./role-lens";
import type { ExperienceRole, RestrictedCapabilityView, RoleLensAuthorityEcho } from "./role-lens";

// ---------------------------------------------------------------------------
// The view-models
// ---------------------------------------------------------------------------

/** The role lens the action plan surface is shaped by (the W100B lens view). */
export type ActionPlanRoleLens = ActionsRoleLensView;

/** The per-role action-plan lead copy (the emphasis paragraphs). */
export const ACTION_PLAN_LEAD_COPY: Readonly<Record<ExperienceRole, string>> = Object.freeze({
  "fleet.admin":
    "Governed execution: the plan's gate state, the transitions the policy allows, and the downstream dispatch handoff.",
  "service.desk":
    "Safe next steps: what this plan does, what the Contract Guardian decided, and the gated transitions available to this session.",
  "security.compliance":
    "Policy-gated execution: the linked Guardian decision, the rules that fired and the evidence trail lead.",
  "asset.manager":
    "Resource context: the devices this plan targets and the capability it invokes, ahead of maintenance or replacement.",
  "team.manager":
    "Team request: who requested this action, what it targets, and whether an approval is waiting on a human decision.",
  "employee":
    "Your request's state in plain language: what it does, where it stands, and what unlocks the next step.",
  "vendor.operator":
    "Scoped view: the action context relevant to your contracted fulfillment.",
});

/** One authority-derived affordance (never role-derived). */
export interface PlanAffordanceView {
  /** The gated capability this affordance presents. */
  readonly capability: "action.plan.propose" | "action.plan.approve";
  /** Whether the effective authority permits the capability. */
  readonly available: boolean;
  /** The restricted-capability explanation when unavailable (else null). */
  readonly restricted: RestrictedCapabilityView | null;
  /** Machine-asserted: this affordance grants nothing. */
  readonly grantsAnything: false;
}

/** The role-shaped action plan view (emphasis changes; the plan presentation never does). */
export interface RoleShapedActionPlanView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The active role. */
  readonly activeRole: ExperienceRole;
  /** The active role's label. */
  readonly roleLabel: string;
  /** The one-line lens lead (from the lens view). */
  readonly lensLead: string;
  /** The per-role emphasis paragraph. */
  readonly leadCopy: string;
  /** The UNDERLYING plan presentation — IDENTICAL across lenses (proven). */
  readonly plan: ActionPlanPresentationView;
  /** The authority echo — VERBATIM from the lens. */
  readonly authority: RoleLensAuthorityEcho;
  /** The propose affordance (authority-derived availability). */
  readonly proposeAffordance: PlanAffordanceView;
  /** The approve affordance (authority-derived availability). */
  readonly approveAffordance: PlanAffordanceView;
  /** Machine-asserted: this view grants nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildRoleShapedActionPlanView`. */
export type RoleShapedActionPlanResult = SurfaceResult<RoleShapedActionPlanView>;

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the role-shaped action plan view.
 *
 * The underlying plan presentation is built by the EXISTING
 * `buildActionPlanView` (single source of truth — the gated state
 * machine is lens-independent); the lens shapes ONLY the lead copy and
 * the affordance framing. Affordance availability derives from the
 * lens's AUTHORITY echo (identity + Guardian), never from the role.
 *
 * @param scope the acting tenant scope
 * @param lens the role lens view (from `buildActionsRoleLens`)
 * @param plan the plan record (the real W041 ActionPlanTemplate, bound at the binding site)
 * @param linkedDecision the Guardian decision to present as context, when linked
 * @returns the tagged result: the role-shaped view or a machine-stable error
 */
export function buildRoleShapedActionPlanView(
  scope: SurfaceTenantScope,
  lens: ActionPlanRoleLens,
  plan: SurfaceActionPlanRecord,
  linkedDecision?: GuardianDecisionRecord,
): RoleShapedActionPlanResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || typeof scope.tenantId !== "string" || scope.tenantId.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "role-shaped action plan surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — the lens discipline.
  const failures: { path: string; reason: string }[] = [];
  if (!isPlainObject(lens) || lens["grantsAnything"] !== false) {
    failures.push({ path: "/lens", reason: "lens_view_invalid" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.roleLensInvalid,
        "role-shaped action plan surface requires a valid role lens view",
        scope.tenantId,
        failures,
      ),
    };
  }
  if (lens.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "role-shaped action plan surface refuses a cross-tenant lens",
        scope.tenantId,
        [{ path: "/lens/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 2 — the base presentation (the EXISTING builder — single
  // source of truth; its own refusals pass through).
  const base = buildActionPlanView(scope, plan, linkedDecision);
  if (!base.ok) {
    return { ok: false, error: base.error };
  }
  // Phase 3 — the affordances (authority-derived, never role-derived).
  const permissions = lens.authority.permissions as readonly string[];
  const affordance = (
    capability: "action.plan.propose" | "action.plan.approve",
  ): PlanAffordanceView => {
    const available = permissions.includes(capability);
    const restricted = available
      ? null
      : (lens.restricted.find((r) => r.capability === capability) ?? null);
    return frozen({ capability, available, restricted, grantsAnything: false } satisfies PlanAffordanceView);
  };
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        activeRole: lens.activeRole,
        roleLabel: lens.roleLabel,
        lensLead: lens.lensLead,
        leadCopy: ACTION_PLAN_LEAD_COPY[lens.activeRole],
        plan: base.view,
        authority: lens.authority,
        proposeAffordance: affordance("action.plan.propose"),
        approveAffordance: affordance("action.plan.approve"),
        grantsAnything: false,
      } satisfies RoleShapedActionPlanView),
    ),
  };
}

/** Re-exported for the role-shaped view consumers (frozen array helper). */
export { frozenArray };
