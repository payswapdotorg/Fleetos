/**
 * @fleetos/web-actions — the Fleet Action plan surfaces (W060B).
 *
 * W041 Fleet Action surfaces rendered as EXPLICIT state machines:
 *
 *   - group selection: the typed device-group selector + its resolved
 *     target set, presented with a machine-stable canonical summary;
 *   - the plan presentation: status, the transitions legal FROM the
 *     current status with their GATES (PROPOSAL moves only via the
 *     Guardian decision; PARKED moves only via the human approval),
 *     the linked Guardian decision context, and the downstream
 *     dispatch handoff on APPROVED (never executed on this surface);
 *   - the plan progression: the revision chain walked as explicit
 *     gated transitions (parked states visible; refusal states
 *     machine-stable; illegal histories REFUSE).
 *
 * LOCK 16: destructive/gated actions are NEVER one-click — every
 * transition step carries `confirmationRequired: true` and its gate;
 * the surface exposes the gated path with its decision context, not a
 * button. The frozen transition tables mirror the W041 policy-gate
 * semantics locally (data, not control flow); the binding test proves
 * them EQUAL to the real `ACTION_PLAN_TRANSITIONS` /
 * `decisionToStatus` — no re-declaration drift.
 *
 * PURE: every input is injected; no clock, no entropy, no I/O.
 * Tenant-scoped: the acting scope's tenant MUST match every record
 * (fail-closed refusal). Outputs are deeply frozen.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  canonicalJson,
  compareStrings,
  deepFrozen,
  frozen,
  frozenArray,
  isNonEmptyString,
  isPlainObject,
  isPositiveInteger,
  looksLikeIso,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import { projectDecisionContext, validateDecisionRecord } from "./decision-context";
import type { GuardianDecisionContextView } from "./decision-context";
import type {
  GuardianDecisionRecord,
  SurfaceActionPlanRecord,
  SurfaceDeviceGroupSelector,
  SurfacePlanStatus,
  SurfaceTenantScope,
} from "./surface-contracts";
import { ALL_SURFACE_PLAN_STATUSES, ALL_SURFACE_SELECTOR_KINDS } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The frozen plan state machine (the W041 policy-gate semantics)
// ---------------------------------------------------------------------------

/**
 * The surface's frozen copy of the W041 action-plan transition table
 * (PROPOSAL -> ADVANCED/PARKED/REJECTED via the Guardian decision;
 * PARKED -> APPROVED/REJECTED via the human approval; terminals are
 * terminal). The binding test proves it EQUALS the real
 * `ACTION_PLAN_TRANSITIONS` table.
 */
export const PLAN_TRANSITIONS: Readonly<Record<SurfacePlanStatus, readonly SurfacePlanStatus[]>> =
  Object.freeze({
    PROPOSAL: Object.freeze<readonly SurfacePlanStatus[]>(["ADVANCED", "PARKED", "REJECTED"]),
    PARKED: Object.freeze<readonly SurfacePlanStatus[]>(["APPROVED", "REJECTED"]),
    ADVANCED: Object.freeze<readonly SurfacePlanStatus[]>([]),
    APPROVED: Object.freeze<readonly SurfacePlanStatus[]>([]),
    REJECTED: Object.freeze<readonly SurfacePlanStatus[]>([]),
  });

/** The terminal statuses from the policy-gate perspective. */
export const TERMINAL_PLAN_STATUSES: readonly SurfacePlanStatus[] = Object.freeze([
  "ADVANCED",
  "APPROVED",
  "REJECTED",
]);

/**
 * The surface's frozen copy of the W041 decision-to-status mapping
 * (ALLOW/WARN -> ADVANCED; REQUIRE_APPROVAL -> PARKED; BLOCK ->
 * REJECTED). The binding test proves it EQUALS the real
 * `decisionToStatus`.
 */
export const DECISION_TO_PLAN_STATUS: Readonly<
  Record<GuardianDecisionRecord["decision"], SurfacePlanStatus>
> = Object.freeze({
  ALLOW: "ADVANCED",
  WARN: "ADVANCED",
  REQUIRE_APPROVAL: "PARKED",
  BLOCK: "REJECTED",
});

/** One gated transition step of the plan state machine. */
export interface PlanTransitionStepView {
  /** The from-state. */
  readonly from: SurfacePlanStatus;
  /** The to-state. */
  readonly to: SurfacePlanStatus;
  /** The gate: the Guardian decision (PROPOSAL moves) or the human approval (PARKED moves). */
  readonly gate: "guardian_decision" | "human_approval";
  /** The decisions that produce this transition (empty for the human gate). */
  readonly viaDecisions: readonly GuardianDecisionRecord["decision"][];
  /** LOCK 16: confirmation with the decision context is required — never one-click. */
  readonly confirmationRequired: true;
}

/**
 * The frozen transition-step table: every legal W041 transition with
 * its gate and the decisions that produce it.
 */
export const PLAN_TRANSITION_STEPS: readonly PlanTransitionStepView[] = Object.freeze([
  Object.freeze({
    from: "PROPOSAL",
    to: "ADVANCED",
    gate: "guardian_decision",
    viaDecisions: Object.freeze(["ALLOW", "WARN"]),
    confirmationRequired: true,
  } satisfies PlanTransitionStepView),
  Object.freeze({
    from: "PROPOSAL",
    to: "PARKED",
    gate: "guardian_decision",
    viaDecisions: Object.freeze(["REQUIRE_APPROVAL"]),
    confirmationRequired: true,
  } satisfies PlanTransitionStepView),
  Object.freeze({
    from: "PROPOSAL",
    to: "REJECTED",
    gate: "guardian_decision",
    viaDecisions: Object.freeze(["BLOCK"]),
    confirmationRequired: true,
  } satisfies PlanTransitionStepView),
  Object.freeze({
    from: "PARKED",
    to: "APPROVED",
    gate: "human_approval",
    viaDecisions: Object.freeze([]),
    confirmationRequired: true,
  } satisfies PlanTransitionStepView),
  Object.freeze({
    from: "PARKED",
    to: "REJECTED",
    gate: "human_approval",
    viaDecisions: Object.freeze([]),
    confirmationRequired: true,
  } satisfies PlanTransitionStepView),
]);

// ---------------------------------------------------------------------------
// Group selection surface
// ---------------------------------------------------------------------------

/** The group selection view (read-only, canonically summarized). */
export interface GroupSelectionView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The selector discriminant (machine-stable). */
  readonly selectorKind: SurfaceDeviceGroupSelector["kind"];
  /** The canonical JSON summary of the selector (sorted keys — machine-stable). */
  readonly selectorSummary: string;
  /** The target count. */
  readonly targetCount: number;
  /** The resolved targets, sorted by deviceId ascending. */
  readonly targets: SurfaceActionPlanRecord["selectedTargets"];
}

/** The tagged result of `buildGroupSelectionView`. */
export type GroupSelectionViewResult = SurfaceResult<GroupSelectionView>;

function validateSelector(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const kind = candidate["kind"];
  if (typeof kind !== "string" || !(ALL_SURFACE_SELECTOR_KINDS as readonly string[]).includes(kind)) {
    failures.push({ path: `${path}/kind`, reason: "unknown_selector_kind" });
    return;
  }
  switch (kind as SurfaceDeviceGroupSelector["kind"]) {
    case "all":
      return;
    case "byId": {
      const ids = candidate["deviceIds"];
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        !ids.every((id) => isNonEmptyString(id))
      ) {
        failures.push({ path: `${path}/deviceIds`, reason: "non_empty_string_array_required" });
      }
      return;
    }
    case "byPlatform":
    case "byOwnership":
    case "byPostureSummary": {
      const field = kind === "byPlatform" ? "platform" : kind === "byOwnership" ? "ownership" : "summary";
      if (!isNonEmptyString(candidate[field])) {
        failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "byLifecycleState": {
      if (!isNonEmptyString(candidate["state"])) {
        failures.push({ path: `${path}/state`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "byCapability": {
      if (!isNonEmptyString(candidate["capability"])) {
        failures.push({ path: `${path}/capability`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "intersect":
    case "union": {
      const subs = candidate["selectors"];
      if (!Array.isArray(subs) || subs.length === 0) {
        failures.push({ path: `${path}/selectors`, reason: "non_empty_array_required" });
        return;
      }
      for (let i = 0; i < subs.length; i++) {
        validateSelector(subs[i], `${path}/selectors/${i}`, failures);
      }
      return;
    }
    case "subtract": {
      const base = candidate["base"];
      const minus = candidate["minus"];
      if (base === undefined) {
        failures.push({ path: `${path}/base`, reason: "required" });
      } else {
        validateSelector(base, `${path}/base`, failures);
      }
      if (minus === undefined) {
        failures.push({ path: `${path}/minus`, reason: "required" });
      } else {
        validateSelector(minus, `${path}/minus`, failures);
      }
      return;
    }
  }
}

/**
 * Build the group selection view. The selector passes structural
 * validation (machine-stable failures); the targets are non-empty
 * strings sorted ascending (input-order invariant); the summary is the
 * canonical JSON of the selector.
 *
 * @param scope the acting tenant scope
 * @param selector the device-group selector (the W041 pure value)
 * @param targets the resolved target device ids (the real resolver's output, bound at the binding site)
 * @returns the tagged result: the selection view or a machine-stable error
 */
export function buildGroupSelectionView(
  scope: SurfaceTenantScope,
  selector: SurfaceDeviceGroupSelector,
  targets: SurfaceActionPlanRecord["selectedTargets"],
): GroupSelectionViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "group selection surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — selector + targets validation.
  const failures: SurfaceValidationFailure[] = [];
  validateSelector(selector, "/selector", failures);
  if (!Array.isArray(targets)) {
    failures.push({ path: "/targets", reason: "array_required" });
  } else {
    for (let i = 0; i < targets.length; i++) {
      if (!isNonEmptyString(targets[i])) {
        failures.push({ path: `/targets/${i}`, reason: "non_empty_string_required" });
      }
    }
  }
  if (failures.length > 0) {
    const selectorFailures = failures.filter((f) => f.path.startsWith("/selector"));
    return {
      ok: false,
      error: makeSurfaceError(
        selectorFailures.length > 0 ? SURFACE_ERROR_CODES.selectorInvalid : SURFACE_ERROR_CODES.planInvalid,
        "group selection surface input is invalid",
        scope.tenantId,
        failures,
      ),
    };
  }
  // Phase 2 — the canonical projection.
  const sortedTargets = [...targets].sort(compareStrings);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        selectorKind: selector.kind,
        selectorSummary: canonicalJson(selector),
        targetCount: sortedTargets.length,
        targets: frozenArray(sortedTargets),
      } satisfies GroupSelectionView),
    ),
  };
}

// ---------------------------------------------------------------------------
// Plan presentation surface
// ---------------------------------------------------------------------------

/** The plan presentation view (the gated state machine rendered). */
export interface ActionPlanPresentationView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The plan identity. */
  readonly planId: string;
  /** The plan version. */
  readonly version: number;
  /** The plan's human name. */
  readonly name: string;
  /** The plan's human description, when present. */
  readonly description?: string;
  /** The intended capability invocation per target (open string). */
  readonly capability: string;
  /** The target count. */
  readonly targetCount: number;
  /** The resolved target device set (sorted). */
  readonly selectedTargets: SurfaceActionPlanRecord["selectedTargets"];
  /** The plan status. */
  readonly status: SurfacePlanStatus;
  /** Whether the status is terminal from the policy-gate perspective. */
  readonly isTerminal: boolean;
  /** The transitions legal FROM the current status (with their gates — never one-click). */
  readonly availableTransitions: readonly PlanTransitionStepView[];
  /** The linked Guardian decision context (the gated path's decision context), when linked. */
  readonly linkedDecision: GuardianDecisionContextView | null;
  /** ISO 8601 creation timestamp (verbatim). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (verbatim). */
  readonly transitionedAt?: string;
  /** The principal who requested the action, when known. */
  readonly requestedBy?: SurfaceActionPlanRecord["requestedBy"];
  /** OPAQUE evidence refs (verbatim). */
  readonly evidence: SurfaceActionPlanRecord["evidence"];
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
  /**
   * The dispatch handoff disclosure: present (non-null) ONLY on an
   * APPROVED plan — execution is downstream (W061 shell / device
   * adapters), NEVER executed on this surface.
   */
  readonly executionHandoff: "downstream_dispatch" | null;
}

/** The tagged result of `buildActionPlanView`. */
export type ActionPlanPresentationResult = SurfaceResult<ActionPlanPresentationView>;

function validatePlanRecord(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["planId", "name", "capability", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  const status = candidate["status"];
  if (
    typeof status !== "string" ||
    !(ALL_SURFACE_PLAN_STATUSES as readonly string[]).includes(status)
  ) {
    failures.push({ path: `${path}/status`, reason: "unknown_status" });
  }
  const selectedTargets = candidate["selectedTargets"];
  if (!Array.isArray(selectedTargets)) {
    failures.push({ path: `${path}/selectedTargets`, reason: "array_required" });
  } else {
    for (let i = 0; i < selectedTargets.length; i++) {
      if (!isNonEmptyString(selectedTargets[i])) {
        failures.push({ path: `${path}/selectedTargets/${i}`, reason: "non_empty_string_required" });
      }
    }
  }
  const targetCount = candidate["targetCount"];
  if (
    typeof targetCount !== "number" ||
    !Number.isInteger(targetCount) ||
    (targetCount as number) < 0
  ) {
    failures.push({ path: `${path}/targetCount`, reason: "non_negative_integer_required" });
  } else if (Array.isArray(selectedTargets) && (targetCount as number) !== selectedTargets.length) {
    failures.push({ path: `${path}/targetCount`, reason: "target_count_mismatch" });
  }
  if (!looksLikeIso(String(candidate["createdAt"] ?? ""))) {
    failures.push({ path: `${path}/createdAt`, reason: "not_iso" });
  }
  if (
    candidate["transitionedAt"] !== undefined &&
    !looksLikeIso(String(candidate["transitionedAt"]))
  ) {
    failures.push({ path: `${path}/transitionedAt`, reason: "not_iso" });
  }
  const selector = candidate["selector"];
  if (selector === undefined) {
    failures.push({ path: `${path}/selector`, reason: "required" });
  } else {
    validateSelector(selector, `${path}/selector`, failures);
  }
}

/**
 * Build the plan presentation view: the status with the transitions
 * legal FROM it (each carrying its gate and confirmation requirement),
 * the linked Guardian decision context (when the caller links the
 * decision that produced the current status), and the downstream
 * dispatch handoff disclosure on APPROVED plans. The view is deeply
 * frozen; the builder never mutates its input.
 *
 * @param scope the acting tenant scope
 * @param plan the plan record (the real W041 ActionPlanTemplate, bound at the binding site)
 * @param linkedDecision the Guardian decision to present as context, when linked
 * @returns the tagged result: the presentation or a machine-stable error
 */
export function buildActionPlanView(
  scope: SurfaceTenantScope,
  plan: SurfaceActionPlanRecord,
  linkedDecision?: GuardianDecisionRecord,
): ActionPlanPresentationResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "action plan surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation.
  const failures: SurfaceValidationFailure[] = [];
  if (!isPlainObject(plan)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.planInvalid,
        "action plan surface requires a plan record",
        scope.tenantId,
        [{ path: "/plan", reason: "object_required" }],
      ),
    };
  }
  validatePlanRecord(plan, "", failures);
  if (linkedDecision !== undefined) {
    validateDecisionRecord(linkedDecision, "/linkedDecision", failures);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.planInvalid,
        "action plan surface input is invalid",
        scope.tenantId,
        failures,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection (plan + linked decision).
  const tenantFailures: SurfaceValidationFailure[] = [];
  if ((plan as { tenantId: unknown }).tenantId !== scope.tenantId) {
    tenantFailures.push({ path: "/plan/tenantId", reason: "tenant_mismatch" });
  }
  if (linkedDecision !== undefined && linkedDecision.tenantId !== scope.tenantId) {
    tenantFailures.push({ path: "/linkedDecision/tenantId", reason: "tenant_mismatch" });
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "action plan surface refuses cross-tenant records",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the gated state-machine presentation.
  const status = plan.status;
  const available = PLAN_TRANSITION_STEPS.filter((step) => step.from === status);
  const sortedTargets = [...plan.selectedTargets].sort(compareStrings);
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        planId: plan.planId,
        version: plan.version,
        name: plan.name,
        description: plan.description,
        capability: plan.capability,
        targetCount: plan.targetCount,
        selectedTargets: frozenArray(sortedTargets),
        status,
        isTerminal: TERMINAL_PLAN_STATUSES.includes(status),
        availableTransitions: frozenArray(available),
        linkedDecision:
          linkedDecision === undefined ? null : projectDecisionContext(linkedDecision),
        createdAt: plan.createdAt,
        transitionedAt: plan.transitionedAt,
        requestedBy: plan.requestedBy,
        evidence: frozenArray(plan.evidence),
        contentDigest: plan.contentDigest,
        executionHandoff: status === "APPROVED" ? "downstream_dispatch" : null,
      } satisfies ActionPlanPresentationView),
    ),
  };
}

// ---------------------------------------------------------------------------
// Plan progression surface
// ---------------------------------------------------------------------------

/** One revision step in the walked plan progression. */
export interface PlanProgressionStepView {
  /** The revision's plan version. */
  readonly version: number;
  /** The revision's status. */
  readonly status: SurfacePlanStatus;
  /** The revision's transition timestamp, when present. */
  readonly transitionedAt?: string;
  /** The gated transition that produced this revision (null on the initial PROPOSAL). */
  readonly transition: PlanTransitionStepView | null;
}

/** The plan progression view (the explicit state-machine path walked). */
export interface PlanProgressionView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The plan identity (constant across revisions). */
  readonly planId: string;
  /** The walked steps, ordered by version ascending. */
  readonly steps: readonly PlanProgressionStepView[];
}

/** The tagged result of `buildPlanProgressionView`. */
export type PlanProgressionViewResult = SurfaceResult<PlanProgressionView>;

/**
 * Build the plan progression view: the revision chain walked as
 * explicit gated transitions. Every consecutive pair MUST be a legal
 * W041 transition (an illegal history REFUSES — the progression is a
 * state machine, not a log); versions MUST strictly increase; all
 * revisions MUST share one planId and the acting tenant.
 *
 * @param scope the acting tenant scope
 * @param revisions the plan revision chain (version order-insensitive; ordered by version)
 * @returns the tagged result: the walked progression or a machine-stable error
 */
export function buildPlanProgressionView(
  scope: SurfaceTenantScope,
  revisions: readonly SurfaceActionPlanRecord[],
): PlanProgressionViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "plan progression surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every revision.
  if (!Array.isArray(revisions) || revisions.length === 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.progressionInvalid,
        "plan progression surface requires a non-empty revision chain",
        scope.tenantId,
        [{ path: "/revisions", reason: "array_required" }],
      ),
    };
  }
  const failures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < revisions.length; i++) {
    validatePlanRecord(revisions[i], `/revisions/${i}`, failures);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.progressionInvalid,
        "plan progression surface input is invalid",
        scope.tenantId,
        failures,
      ),
    };
  }
  // Phase 2 — chain discipline: one plan id, one tenant, versions
  // strictly increasing; every consecutive pair is a LEGAL transition.
  const ordered = [...revisions].sort((a, b) => a.version - b.version);
  const chainFailures: SurfaceValidationFailure[] = [];
  const first = ordered[0] as SurfaceActionPlanRecord;
  for (let i = 0; i < ordered.length; i++) {
    const revision = ordered[i] as SurfaceActionPlanRecord;
    if (revision.planId !== first.planId) {
      chainFailures.push({ path: `/revisions/${i}`, reason: "plan_id_mismatch" });
    }
    if (revision.tenantId !== scope.tenantId) {
      chainFailures.push({ path: `/revisions/${i}/tenantId`, reason: "tenant_mismatch" });
    }
    if (i > 0 && revision.version <= (ordered[i - 1] as SurfaceActionPlanRecord).version) {
      chainFailures.push({ path: `/revisions/${i}`, reason: "version_not_increasing" });
    }
    if (i > 0) {
      const prior = ordered[i - 1] as SurfaceActionPlanRecord;
      const legal = PLAN_TRANSITION_STEPS.find(
        (step) => step.from === prior.status && step.to === revision.status,
      );
      if (legal === undefined) {
        chainFailures.push({ path: `/revisions/${i}`, reason: "illegal_transition" });
      }
    }
  }
  const tenantFailures = chainFailures.filter((f) => f.reason === "tenant_mismatch");
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "plan progression surface refuses cross-tenant revisions",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  if (chainFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.progressionInvalid,
        "plan progression surface revision chain is invalid",
        scope.tenantId,
        chainFailures,
      ),
    };
  }
  // Phase 3 — the walked steps.
  const steps: PlanProgressionStepView[] = ordered.map((revision, i) => {
    const transition =
      i === 0
        ? null
        : (PLAN_TRANSITION_STEPS.find(
            (step) =>
              step.from === (ordered[i - 1] as SurfaceActionPlanRecord).status &&
              step.to === revision.status,
          ) as PlanTransitionStepView | undefined) ?? null;
    return frozen({
      version: revision.version,
      status: revision.status,
      transitionedAt: revision.transitionedAt,
      transition,
    } satisfies PlanProgressionStepView);
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        planId: first.planId,
        steps: frozenArray(steps),
      } satisfies PlanProgressionView),
    ),
  };
}
