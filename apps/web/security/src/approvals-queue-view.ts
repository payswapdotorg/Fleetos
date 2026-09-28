/**
 * @fleetos/web-security — D3: the parked approvals queue surface.
 *
 * REQUIRE_APPROVAL items awaiting HUMAN decision: each queue item
 * pairs a W041 parked Fleet Action plan with the Guardian evaluation
 * whose REQUIRE_APPROVAL decision parked it. The item surfaces the
 * plan facts, the parked-at instant, the full decision context (the
 * engine's machine-stable reasons, matched rules, OPAQUE evidence
 * refs), and the EXPLICIT approval transitions: PARKED -> APPROVED /
 * PARKED -> REJECTED, both gated on `human_decision` with
 * confirmation required (LOCK 16 — NEVER one-click).
 *
 * The queue NEVER executes: no dispatch path, no intent id, no
 * command. It presents the gated path with its decision context; the
 * W041 `approveParkedPlan` step (invoked by the binding site, audited
 * by the actions package) performs the actual transition. The queue
 * REFUSES any input that is not a PARKED plan parked by a
 * REQUIRE_APPROVAL decision (fail-closed, never silently filtered).
 *
 * Ordering is machine-stable: parkedAt asc, then planId asc (FIFO)
 * — input order never matters.
 *
 * PURE: no clock, no entropy, no I/O; the same items produce a
 * byte-identical queue. Tenant-scoped: the acting scope's tenant MUST
 * match every item's plan AND evaluation decision tenants (fail-closed
 * refusal).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { compareStrings, deepFrozen, frozen, frozenArray, isNonEmptyString, isPlainObject, makeSurfaceError, SURFACE_ERROR_CODES, SYNTHETIC_SURFACE_TENANT } from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import { presentGuardianDecision, validateEvaluationRecord } from "./guardian-decision-view";
import type { GuardianDecisionPresentationView } from "./guardian-decision-view";
import type { ParkedApprovalItemInput, ParkedPlanRecord, SurfaceTenantScope } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The frozen approval transition table (the W041 parked-plan machine)
// ---------------------------------------------------------------------------

/**
 * One available approval transition on a parked item. Both transitions
 * are gated on the HUMAN decision (the W041 `approveParkedPlan` step);
 * neither is ever one-click — confirmation with the decision context
 * is required.
 */
export interface ApprovalTransitionView {
  /** The approval action ("approve" or "reject"). */
  readonly action: "approve" | "reject";
  /** The from-state (always PARKED in the queue). */
  readonly from: "PARKED";
  /** The to-state (APPROVED or REJECTED). */
  readonly to: "APPROVED" | "REJECTED";
  /** The gate: a human decision (never auto-executed). */
  readonly gate: "human_decision";
  /** LOCK 16: confirmation with the decision context is required. */
  readonly confirmationRequired: true;
}

/**
 * The frozen approval transition table — the surface's copy of the
 * W041 parked-plan machine (PARKED -> APPROVED / REJECTED). The
 * binding test proves it EQUALS the real `ACTION_PLAN_TRANSITIONS`
 * table (no drift).
 */
export const APPROVAL_QUEUE_TRANSITIONS: readonly ApprovalTransitionView[] = Object.freeze([
  Object.freeze({
    action: "approve",
    from: "PARKED",
    to: "APPROVED",
    gate: "human_decision",
    confirmationRequired: true,
  } satisfies ApprovalTransitionView),
  Object.freeze({
    action: "reject",
    from: "PARKED",
    to: "REJECTED",
    gate: "human_decision",
    confirmationRequired: true,
  } satisfies ApprovalTransitionView),
]);

// ---------------------------------------------------------------------------
// The queue view-model
// ---------------------------------------------------------------------------

/** One parked-approval queue item (read-only, gated). */
export interface ParkedApprovalItemView {
  /** The plan identity. */
  readonly planId: string;
  /** The plan's human name. */
  readonly name: string;
  /** The plan version at park time. */
  readonly version: number;
  /** The intended capability invocation per target (open string). */
  readonly capability: string;
  /** The target count. */
  readonly targetCount: number;
  /** The principal who requested the action, when known. */
  readonly requestedBy?: ParkedPlanRecord["requestedBy"];
  /** The parked-at instant (the plan's transition timestamp). */
  readonly parkedAt: string;
  /** The full REQUIRE_APPROVAL decision context (reasons, rules, evidence). */
  readonly parkedByDecision: GuardianDecisionPresentationView;
  /** The gated approval transitions (approve / reject — never one-click). */
  readonly availableTransitions: readonly ApprovalTransitionView[];
  /** LOCK 16 disclosure: no direct-execution path exists on this surface. */
  readonly directExecutionAvailable: false;
}

/** The parked approvals queue view (ordered, read-only). */
export interface ApprovalsQueueView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The total number of parked items. */
  readonly total: number;
  /** The ordered items (parkedAt asc, planId asc — FIFO, input-order invariant). */
  readonly items: readonly ParkedApprovalItemView[];
}

/** The tagged result of `buildApprovalsQueueView`. */
export type ApprovalsQueueViewResult = SurfaceResult<ApprovalsQueueView>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateParkedPlan(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["planId", "name", "capability"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveIntegerField(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  const status = candidate["status"];
  if (status !== "PARKED") {
    failures.push({ path: `${path}/status`, reason: "item_not_parked" });
  }
  if (typeof candidate["targetCount"] !== "number" || !Number.isInteger(candidate["targetCount"]) || (candidate["targetCount"] as number) < 0) {
    failures.push({ path: `${path}/targetCount`, reason: "non_negative_integer_required" });
  }
  if (!looksLikeIsoField(candidate["createdAt"])) {
    failures.push({ path: `${path}/createdAt`, reason: "not_iso" });
  }
  // The parked-at instant is REQUIRED on a parked plan (the queue is
  // ordered by it).
  if (!looksLikeIsoField(candidate["transitionedAt"])) {
    failures.push({ path: `${path}/transitionedAt`, reason: "required" });
  }
}

function isPositiveIntegerField(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function looksLikeIsoField(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the parked approvals queue view.
 *
 * Every item MUST be a PARKED plan parked by a REQUIRE_APPROVAL
 * evaluation of the acting tenant — anything else REFUSES the whole
 * build (fail-closed: the queue is a gated surface, never a
 * catch-all). Ordering: parkedAt asc, planId asc.
 *
 * @param scope the acting tenant scope
 * @param items the parked plan + evaluation pairs (bound at the binding site)
 * @returns the tagged result: the ordered queue or a machine-stable error
 */
export function buildApprovalsQueueView(
  scope: SurfaceTenantScope,
  items: readonly ParkedApprovalItemInput[],
): ApprovalsQueueViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "approvals queue surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural + status validation of every item.
  const structural: SurfaceValidationFailure[] = [];
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.approvalItemInvalid,
        "approvals queue surface requires an array of items",
        scope.tenantId,
        [{ path: "/items", reason: "array_required" }],
      ),
    };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) {
      structural.push({ path: `/items/${i}`, reason: "object_required" });
      continue;
    }
    validateParkedPlan(item["plan"], `/items/${i}/plan`, structural);
    validateEvaluationRecord(item["evaluation"], `/items/${i}/evaluation`, structural);
    // The decision discipline: the parking evaluation's decision MUST
    // be REQUIRE_APPROVAL (the parked-approval gate).
    const evaluation = item["evaluation"];
    if (
      isPlainObject(evaluation) &&
      isPlainObject(evaluation["decision"]) &&
      (evaluation["decision"] as { decision?: unknown }).decision !== "REQUIRE_APPROVAL"
    ) {
      structural.push({
        path: `/items/${i}/evaluation/decision/decision`,
        reason: "item_not_require_approval",
      });
    }
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.approvalItemInvalid,
        "approvals queue surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection (plan + evaluation).
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < items.length; i++) {
    const planTenant = (items[i].plan as { tenantId: unknown }).tenantId;
    if (planTenant !== scope.tenantId) {
      tenantFailures.push({ path: `/items/${i}/plan/tenantId`, reason: "tenant_mismatch" });
    }
    const decisionTenant = (items[i].evaluation.decision as { tenantId: unknown }).tenantId;
    if (decisionTenant !== scope.tenantId) {
      tenantFailures.push({ path: `/items/${i}/evaluation/decision/tenantId`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "approvals queue surface refuses cross-tenant items",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered queue projection. The decision context is
  // built with the D2 presentation builder (single source of truth);
  // after phases 1-2 it cannot fail, but the surface stays total —
  // any impossible failure is a tagged refusal, never a throw.
  const presentations: GuardianDecisionPresentationView[] = [];
  for (let i = 0; i < items.length; i++) {
    const presentation = presentGuardianDecision(scope, items[i].evaluation);
    if (!presentation.ok) {
      return {
        ok: false,
        error: makeSurfaceError(
          SURFACE_ERROR_CODES.approvalItemInvalid,
          "approvals queue surface could not present the parking decision context",
          scope.tenantId,
          presentation.error.failures.map((failure) => ({
            path: `/items/${i}${failure.path === "" ? "" : failure.path}`,
            reason: failure.reason,
          })),
        ),
      };
    }
    presentations.push(presentation.view);
  }
  const projected: ParkedApprovalItemView[] = items.map((item, i) =>
    frozen({
      planId: item.plan.planId,
      name: item.plan.name,
      version: item.plan.version,
      capability: item.plan.capability,
      targetCount: item.plan.targetCount,
      requestedBy: item.plan.requestedBy,
      parkedAt: item.plan.transitionedAt as string,
      parkedByDecision: presentations[i],
      availableTransitions: APPROVAL_QUEUE_TRANSITIONS,
      directExecutionAvailable: false,
    } satisfies ParkedApprovalItemView),
  );
  projected.sort((a, b) => {
    const byParkedAt = compareStrings(a.parkedAt, b.parkedAt);
    if (byParkedAt !== 0) return byParkedAt;
    return compareStrings(a.planId, b.planId);
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: projected.length,
        items: frozenArray(projected),
      } satisfies ApprovalsQueueView),
    ),
  };
}

