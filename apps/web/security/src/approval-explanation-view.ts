/**
 * @fleetos/web-security — W100B: the PARKED-APPROVAL EXPLANATION
 * surface ("why is this action parked, and what unlocks it?").
 *
 * Every parked item in the approvals queue (a W041 plan parked by a
 * REQUIRE_APPROVAL Guardian decision) is explained in two parts:
 *
 *   WHY IT IS PARKED — the decision chain: the REQUIRE_APPROVAL
 *   decision, the rules that fired (rule id + version + effect), the
 *   engine's machine-stable reasons (verbatim), the policy version
 *   (rule set id + version), and the OPAQUE evidence artifacts the
 *   decision rests on (the evidence trail links).
 *
 *   WHAT UNLOCKS IT — the human-decision gate: the PARKED -> APPROVED /
 *   REJECTED transitions (both confirmation-required — LOCK 16, never
 *   one-click), the permission the deciding session must hold
 *   (`security.approval.decide`), whether THIS session may decide
 *   (AUTHORITY-derived — identity + Guardian, never role-derived), and
 *   when it may not, the escalation path (the role-assignment request)
 *   with the restricted-capability explanation.
 *
 * The explanation NEVER decides, never executes and never grants
 * anything: it presents the gated path with its decision context (the
 * W041 `approveParkedPlan` step — invoked by the binding site —
 * performs the actual transition).
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
  isPositiveInteger,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult } from "./internal";
import type { SecurityRoleLensView } from "./role-lens";
import type { ExperienceRole, RestrictedCapabilityView, RoleLensAuthorityEcho } from "./role-lens";
import type { SurfaceTenantScope } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The view-models
// ---------------------------------------------------------------------------

/** The role lens the explanation is shaped by (the W100B lens view). */
export type ApprovalRoleLens = SecurityRoleLensView;

/** The permission a session must hold to decide parked approvals. */
export const APPROVAL_DECIDE_PERMISSION = "security.approval.decide" as const;

/** One rule that fired (the parked decision chain). */
export interface ParkedRuleLink {
  /** The rule identity. */
  readonly ruleId: string;
  /** The rule version at evaluation time. */
  readonly ruleVersion: number;
  /** The effect the rule contributed. */
  readonly effect: string;
}

/** One evidence link of the parking decision (opaque, content-addressed). */
export interface ParkedEvidenceLink {
  /** The object-storage key (content-addressable; opaque). */
  readonly key: string;
  /** The artifact hash. */
  readonly hash: string;
  /** The hash algorithm. */
  readonly hashAlgorithm: string;
}

/** The WHY-PARKED half of the explanation. */
export interface WhyParkedView {
  /** The decision type (always REQUIRE_APPROVAL on a parked item). */
  readonly decision: "REQUIRE_APPROVAL";
  /** The human summary sentence (composed from observable fields only). */
  readonly summary: string;
  /** The rules that fired (from the parked decision's matched rules). */
  readonly rules: readonly ParkedRuleLink[];
  /** The engine's machine-stable reasons (verbatim, engine order). */
  readonly reasonCodes: readonly string[];
  /** The policy version (rule set id + version — the decision's policy lineage). */
  readonly policyVersion: string;
  /** The decision instant (verbatim). */
  readonly decidedAt: string;
  /** The OPAQUE evidence artifacts the decision rests on (the evidence links). */
  readonly evidenceLinks: readonly ParkedEvidenceLink[];
}

/** The WHAT-UNLOCKS-IT half of the explanation. */
export interface WhatUnlocksItView {
  /** The gate: a human decision (never auto-executed). */
  readonly gate: "human_decision";
  /** The gated transitions (approve / reject — both confirmation-required). */
  readonly transitions: readonly { readonly action: "approve" | "reject"; readonly to: string }[];
  /** The permission a deciding session must hold. */
  readonly decidePermission: typeof APPROVAL_DECIDE_PERMISSION;
  /** Whether THIS session's effective authority may decide (authority-derived). */
  readonly sessionMayDecide: boolean;
  /** The restricted-capability explanation when the session cannot decide (else null). */
  readonly restricted: RestrictedCapabilityView | null;
  /** The escalation copy when the session cannot decide. */
  readonly escalationCopy: string;
}

/** One parked-approval explanation (read-only, gated, never deciding). */
export interface ParkedExplanationView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The parked plan's identity. */
  readonly planId: string;
  /** The active role whose lens shapes the explanation. */
  readonly activeRole: ExperienceRole;
  /** WHY the action is parked (the decision chain). */
  readonly whyParked: WhyParkedView;
  /** WHAT unlocks it (the human-decision gate + escalation). */
  readonly whatUnlocksIt: WhatUnlocksItView;
  /** The authority echo — VERBATIM from the lens. */
  readonly authority: RoleLensAuthorityEcho;
  /** Machine-asserted: this explanation grants/decides nothing. */
  readonly grantsAnything: false;
}

/** The tagged result of `buildParkedExplanationView`. */
export type ParkedExplanationResult = SurfaceResult<ParkedExplanationView>;

/** The escalation copy template (the role-assignment request path). */
export const APPROVAL_ESCALATION_COPY =
  "Approvals are decided by sessions whose effective authority includes security.approval.decide. Request the security.compliance role assignment from your Fleet Administrator to decide parked approvals." as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The minimal parked-item shape this explanation reads (structural). */
export interface ParkedExplanationItemInput {
  /** The parked plan identity. */
  readonly planId: string;
  /**
   * The parked decision context (the ParkedApprovalItemView's
   * parkedByDecision). The decision TYPE is the wide union here — the
   * REQUIRE_APPROVAL discipline is enforced at runtime (a
   * non-REQUIRE_APPROVAL decision REFUSES, fail-closed).
   */
  readonly parkedByDecision: {
    readonly decision: string;
    readonly decidedAt: string;
    readonly ruleSetId: string | null;
    readonly ruleSetVersion: number | null;
    readonly matchedRules: readonly {
      readonly ruleId: string;
      readonly version: number;
      readonly effect: string;
    }[];
    readonly reasons: readonly { readonly code: string }[];
    readonly evidence: readonly {
      readonly key: string;
      readonly hash: string;
      readonly hashAlgorithm: string;
    }[];
  };
}

function validateItem(
  candidate: unknown,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path: "/item", reason: "object_required" });
    return;
  }
  if (typeof candidate["planId"] !== "string" || (candidate["planId"] as string).length === 0) {
    failures.push({ path: "/item/planId", reason: "non_empty_string_required" });
  }
  const decision = candidate["parkedByDecision"];
  if (!isPlainObject(decision)) {
    failures.push({ path: "/item/parkedByDecision", reason: "object_required" });
    return;
  }
  if (decision["decision"] !== "REQUIRE_APPROVAL") {
    failures.push({ path: "/item/parkedByDecision/decision", reason: "item_not_require_approval" });
  }
  if (typeof decision["decidedAt"] !== "string" || (decision["decidedAt"] as string).length === 0) {
    failures.push({ path: "/item/parkedByDecision/decidedAt", reason: "non_empty_string_required" });
  }
  if (!Array.isArray(decision["matchedRules"])) {
    failures.push({ path: "/item/parkedByDecision/matchedRules", reason: "array_required" });
  }
  if (!Array.isArray(decision["reasons"])) {
    failures.push({ path: "/item/parkedByDecision/reasons", reason: "array_required" });
  }
  if (!Array.isArray(decision["evidence"])) {
    failures.push({ path: "/item/parkedByDecision/evidence", reason: "array_required" });
  }
  if (decision["ruleSetId"] !== null && typeof decision["ruleSetId"] !== "string") {
    failures.push({ path: "/item/parkedByDecision/ruleSetId", reason: "string_or_null_required" });
  }
  if (decision["ruleSetVersion"] !== null && !isPositiveInteger(decision["ruleSetVersion"])) {
    failures.push({ path: "/item/parkedByDecision/ruleSetVersion", reason: "positive_integer_or_null_required" });
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the parked-approval explanation ("why is this action parked,
 * and what unlocks it?").
 *
 * The WHY half composes the decision chain from the parked item's
 * decision context (matched rules, machine-stable reason codes, the
 * policy version, the evidence links — all observable, verbatim). The
 * WHAT half presents the human-decision gate with the permission a
 * deciding session must hold; `sessionMayDecide` is derived from the
 * LENS's authority echo (identity + Guardian — identical for every
 * lens, proven by test), and the escalation copy names the
 * role-assignment request path when the session cannot decide.
 *
 * @param scope the acting tenant scope
 * @param lens the role lens view (from `buildSecurityRoleLens`)
 * @param item the parked item (the ParkedApprovalItemView, bound at the binding site)
 * @returns the tagged result: the explanation view or a machine-stable error
 */
export function buildParkedExplanationView(
  scope: SurfaceTenantScope,
  lens: ApprovalRoleLens,
  item: ParkedExplanationItemInput,
): ParkedExplanationResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || typeof scope.tenantId !== "string" || scope.tenantId.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "parked explanation surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — the lens + item discipline.
  const failures: { path: string; reason: string }[] = [];
  if (!isPlainObject(lens) || lens["grantsAnything"] !== false) {
    failures.push({ path: "/lens", reason: "lens_view_invalid" });
  }
  validateItem(item, failures);
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.approvalItemInvalid,
        "parked explanation surface input is invalid",
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
        "parked explanation surface refuses a cross-tenant lens",
        scope.tenantId,
        [{ path: "/lens/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 2 — the WHY half (the decision chain, observable fields only).
  const decision = item.parkedByDecision;
  const rules: ParkedRuleLink[] = decision.matchedRules.map((rule) =>
    frozen({
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      effect: rule.effect,
    } satisfies ParkedRuleLink),
  );
  const evidenceLinks: ParkedEvidenceLink[] = decision.evidence.map((ref) =>
    frozen({
      key: ref.key,
      hash: ref.hash,
      hashAlgorithm: ref.hashAlgorithm,
    } satisfies ParkedEvidenceLink),
  );
  const policyVersion =
    decision.ruleSetId === null
      ? "unknown policy version"
      : `${decision.ruleSetId} v${decision.ruleSetVersion ?? "?"}`;
  const summary =
    `The Contract Guardian decided REQUIRE_APPROVAL at ${decision.decidedAt}: ` +
    `${rules.length} matched rule(s) require a human decision before this plan may advance ` +
    `(policy ${policyVersion}; ${evidenceLinks.length} evidence artifact(s)).`;
  // Phase 3 — the WHAT half (the gate; sessionMayDecide is
  // authority-derived — never role-derived).
  const sessionMayDecide = (lens.authority.permissions as readonly string[]).includes(
    APPROVAL_DECIDE_PERMISSION,
  );
  const restricted = sessionMayDecide
    ? null
    : (lens.restricted.find((r) => r.capability === APPROVAL_DECIDE_PERMISSION) ?? null);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        planId: item.planId,
        activeRole: lens.activeRole,
        whyParked: frozen({
          decision: "REQUIRE_APPROVAL",
          summary,
          rules: frozenArray(rules),
          reasonCodes: frozenArray(decision.reasons.map((reason) => reason.code)),
          policyVersion,
          decidedAt: decision.decidedAt,
          evidenceLinks: frozenArray(evidenceLinks),
        } satisfies WhyParkedView),
        whatUnlocksIt: frozen({
          gate: "human_decision",
          transitions: frozenArray([
            frozen({ action: "approve", to: "APPROVED" }),
            frozen({ action: "reject", to: "REJECTED" }),
          ]),
          decidePermission: APPROVAL_DECIDE_PERMISSION,
          sessionMayDecide,
          restricted,
          escalationCopy: APPROVAL_ESCALATION_COPY,
        } satisfies WhatUnlocksItView),
        authority: lens.authority,
        grantsAnything: false,
      } satisfies ParkedExplanationView),
    ),
  };
}
