/**
 * @fleetos/actions — D2: the policy-gated execution flow.
 *
 * Per `spec/ARCHITECTURE.md` § Decision boundary: a deterministic
 * policy/authorization layer remains AUTHORITATIVE for whether an action
 * is permitted. The W031 Contract Guardian (in `@fleetos/policy`, same
 * lane B) IS that layer — it decides whether an action is permitted; it
 * never executes anything. This module submits action plans to the
 * Guardian's evaluation; a plan advances ONLY when the Guardian decision
 * is ALLOW (or per decision semantics: REQUIRE_APPROVAL parks the plan
 * for approval; BLOCK rejects with the Guardian's machine-stable
 * reasons). NEVER auto-execute anything the Guardian did not allow.
 *
 * Deterministic transitions: the plan's status transitions are pure
 * functions of (prior status, decision). Injected clocks (`at`,
 * `correlationId`): no clock reads, no entropy. The Guardian engine
 * itself is pure (per W031's contract); this module is the bridge that
 * translates a Guardian decision into an action plan transition + an
 * audit emission.
 *
 * Audit (D4): consequential transitions (ADVANCED / PARKED / REJECTED)
 * emit append-only audit records to the injected sink — proven by test
 * into the W012 hash-chained AuditLog via the structural sink adapter.
 *
 * Per `spec/ARCHITECTURE-LOCK.md` item 16: destructive capabilities
 * (`enforce`, `remediate`, `lock`, `locate`, `wipe`, `reboot`,
 * `update`) require an explicit policy grant AND an evidence trail. The
 * Guardian's BLOCK decision is the explicit refusal; REQUIRE_APPROVAL is
 * the held-for-approval state. The plan never executes — execution is
 * downstream (W060B / device-adapters, not this package).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  ALLOW,
  BLOCK,
  isBlockingDecision,
  REQUIRE_APPROVAL,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type { GuardianDecision, GuardianDecisionType } from "@fleetos/contracts";
import type { CorrelationId, CausationId, EvidenceRef, FleetError, TenantId } from "@fleetos/contracts";
import type { ActionAuditSink } from "./audit-seam";
import { ACTION_AUDIT_ACTIONS, NOOP_ACTION_AUDIT_SINK } from "./audit-seam";
import {
  ADVANCED,
  PARKED,
  PROPOSAL,
  REJECTED,
  transitionActionPlan,
  type ActionPlanStatus,
  type ActionPlanTemplate,
} from "./fleet-action";
import {
  ACTIONS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  frozen,
  makeDomainError,
} from "./internal";
import type {
  EvaluateGuardianOptions,
  GuardianRequestContext,
  GuardianRuleSet,
} from "@fleetos/policy";

// ---------------------------------------------------------------------------
// The policy-gate transition mapping
// ---------------------------------------------------------------------------

/**
 * Map a Guardian decision type to the policy-gate transition. Pure and
 * deterministic:
 *   - ALLOW          -> ADVANCED (the plan advances; terminal from the
 *                       policy-gate perspective — execution is downstream)
 *   - WARN            -> ADVANCED (warnings are recorded but do not hold the
 *                       action; the audit carries the warning context)
 *                       NOTE: WARN is non-blocking per the frozen
 *                       `isBlockingDecision` helper; it surfaces a warning
 *                       to the operator without holding the plan.
 *   - REQUIRE_APPROVAL -> PARKED (the plan is held for human approval)
 *   - BLOCK           -> REJECTED (the plan is refused with the
 *                       Guardian's machine-stable reasons)
 *
 * The Guardian's decision types are reused (never re-declared) — they
 * are the FROZEN `@fleetos/contracts` constants re-exported by
 * `@fleetos/policy`.
 *
 * @param decision the Guardian decision type
 * @returns the target plan status
 */
export function decisionToStatus(decision: GuardianDecisionType): ActionPlanStatus {
  if (decision === ALLOW) return ADVANCED;
  if (decision === REQUIRE_APPROVAL) return PARKED;
  if (decision === BLOCK) return REJECTED;
  // WARN — non-blocking: the plan advances; the audit carries the warning.
  // The frozen `isBlockingDecision` helper confirms WARN is non-blocking.
  if (decision === "WARN") return ADVANCED;
  // Exhaustive: the frozen union covers exactly ALLOW/WARN/REQUIRE_APPROVAL/BLOCK.
  return ADVANCED;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/** Options for `submitActionPlan`. */
export interface SubmitActionPlanOptions {
  /** The compiled Guardian rule set (the policy version the plan is evaluated against). */
  readonly ruleSet: GuardianRuleSet;
  /** The Guardian evaluation request context (action, principal, device, ...). */
  readonly request: GuardianRequestContext;
  /** The injected decision instant (ISO 8601) — becomes the transition timestamp + the Guardian's `decidedAt`. */
  readonly at: string;
  /** The correlation id of the submission request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the submission is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (consequential transitions emit; default: no-op). */
  readonly auditSink?: ActionAuditSink;
}

/** The tagged result of a plan submission. */
export type SubmitActionPlanResult =
  | {
      readonly ok: true;
      /** The next plan revision with the transitioned status. */
      readonly plan: ActionPlanTemplate;
      /** The frozen Guardian decision (the FROZEN contracts shape, via @fleetos/policy's makeGuardianDecision). */
      readonly decision: GuardianDecision;
      /** The status the plan transitioned to (ADVANCED / PARKED / REJECTED). */
      readonly status: ActionPlanStatus;
      /** The rules that fired during evaluation. */
      readonly matchedRuleIds: readonly string[];
      /** The observable evidence artifacts linked into the decision. */
      readonly evidence: readonly EvidenceRef[];
    }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Submit an action plan to the Contract Guardian for evaluation. PURE:
 * every input (plan, rule set, request, decision instant, correlation id)
 * is injected; the actions package reads no clock and no entropy. The
 * plan advances ONLY when the Guardian decision is ALLOW (or WARN — non-
 * blocking); REQUIRE_APPROVAL parks the plan for human approval; BLOCK
 * rejects with the Guardian's machine-stable reasons. NEVER auto-execute.
 *
 * Tenant isolation: the plan's tenant MUST match the rule set's tenant
 * AND the request's tenant — a tenant-A plan can never be evaluated
 * against tenant-B rules (the Guardian rejects with a tagged
 * `tenant_mismatch` error, never a wrong-tenant decision).
 *
 * Audit: consequential transitions (ADVANCED / PARKED / REJECTED) emit
 * `action.plan.submitted` to the injected sink. Pure reads and failed
 * submissions never audit (the frozen error taxonomy carries its own
 * trace).
 *
 * @param plan the prior plan version (must be in PROPOSAL status)
 * @param options the submission options
 * @returns the tagged submission result
 */
export function submitActionPlan(
  plan: ActionPlanTemplate,
  options: SubmitActionPlanOptions,
): SubmitActionPlanResult {
  // The plan MUST be in PROPOSAL status to be submitted (the proposal-gated
  // boundary — only proposals enter the Guardian's evaluation). A plan that
  // has already advanced is rejected with a tagged DomainError.
  if (plan.status !== PROPOSAL) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.planStatusIllegal,
        `action plan submission requires status PROPOSAL (got ${plan.status})`,
        { tenantId: plan.tenantId, correlationId: options.correlationId },
        "action.plan.submit",
        "status_not_proposal",
      ),
    };
  }
  // Tenant isolation by rejection: the plan's tenant MUST match the rule
  // set's tenant AND the request's tenant. The Guardian engine itself
  // rejects request/rule-set tenant mismatches; we surface a plan/rule-set
  // mismatch here so the actions lane is fail-closed at the action
  // boundary (per the W031-disclosed pattern).
  if (plan.tenantId !== options.ruleSet.tenantId || plan.tenantId !== options.request.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.planTenantMismatch,
        "action plan submission refused: plan tenant does not match rule set / request tenant",
        { tenantId: plan.tenantId, correlationId: options.correlationId },
        "action.plan.submit",
        "tenant_mismatch",
      ),
    };
  }
  const guardianOptions: EvaluateGuardianOptions = {
    at: options.at,
    correlationId: options.correlationId,
    causationId: options.causationId,
    auditSink: undefined, // the Guardian emits its own audit on blocking decisions; we emit ours separately.
  };
  const evaluation = evaluateGuardianRequest(options.ruleSet, options.request, guardianOptions);
  if (!evaluation.ok) {
    return { ok: false, error: evaluation.error };
  }
  const decision: GuardianDecision = evaluation.evaluation.decision;
  const decisionType: GuardianDecisionType = decision.decision;
  const targetStatus = decisionToStatus(decisionType);
  // Transition the plan (PROPOSAL -> targetStatus). This is the
  // policy-gated boundary: the transition is a pure function of (prior
  // status, decision); the Guardian's decision is authoritative.
  const transition = transitionActionPlan(plan, targetStatus, options.at, options.correlationId);
  if (!transition.ok) {
    return { ok: false, error: transition.error };
  }
  const nextPlan = transition.plan;
  const sink: ActionAuditSink = options.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  // Audit: consequential transitions only. ADVANCED (ALLOW/WARN) audits
  // the approval posture; PARKED (REQUIRE_APPROVAL) audits the held-for-
  // approval state; REJECTED (BLOCK) audits the refusal. The frozen
  // `isBlockingDecision` helper drives the emission policy: PARKED and
  // REJECTED are blocking; ADVANCED is non-blocking but carries the
  // submission context (the plan moved from PROPOSAL to terminal).
  sink.append(
    frozen({
      action: ACTION_AUDIT_ACTIONS.planSubmitted,
      tenantId: nextPlan.tenantId,
      subject: nextPlan.planId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      causationId: options.causationId,
      details: frozen({
        planId: nextPlan.planId,
        version: nextPlan.version,
        name: nextPlan.name,
        capability: nextPlan.capability,
        targetCount: nextPlan.targetCount,
        status: nextPlan.status,
        decision: decisionType,
        isBlocking: isBlockingDecision(decisionType),
        ruleSetId: evaluation.evaluation.ruleSetId,
        ruleSetVersion: evaluation.evaluation.ruleSetVersion,
        matchedRuleIds: evaluation.evaluation.matchedRules.map((r) => r.ruleId as string),
        reasons: evaluation.evaluation.reasons.map((r) => r.code),
        evidence: decision.evidence.map((e) => e.key),
      }),
    }),
  );
  return {
    ok: true,
    plan: nextPlan,
    decision,
    status: nextPlan.status,
    matchedRuleIds: evaluation.evaluation.matchedRules.map((r) => r.ruleId as string),
    evidence: decision.evidence,
  };
}

// ---------------------------------------------------------------------------
// Human approval (the parked-plan step the W031 Guardian defers to W041)
// ---------------------------------------------------------------------------

/** Options for `approveParkedPlan`. */
export interface ApproveParkedPlanOptions {
  /** The injected decision instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the approval request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the approval is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The approving principal's user id (recorded in the audit). */
  readonly approverId?: string;
  /** The injected audit sink (the approval transition emits; default: no-op). */
  readonly auditSink?: ActionAuditSink;
}

/** The tagged result of a parked-plan approval. */
export type ApproveParkedPlanResult =
  | { readonly ok: true; readonly plan: ActionPlanTemplate; readonly status: ActionPlanStatus }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Approve a PARKED plan (the human-approval step the W031 Guardian
 * defers to W041 — the Guardian only decides; the human-approval
 * transition lives here). The plan transitions PARKED -> APPROVED (or
 * PARKED -> REJECTED if `decision` is "reject"). PURE: the transition is
 * a pure function of (prior status, decision); the audit carries the
 * approving principal's id.
 *
 * @param plan the prior plan version (must be in PARKED status)
 * @param decision the approval decision: "approve" or "reject"
 * @param options the approval options
 * @returns the tagged approval result
 */
export function approveParkedPlan(
  plan: ActionPlanTemplate,
  decision: "approve" | "reject",
  options: ApproveParkedPlanOptions,
): ApproveParkedPlanResult {
  if (plan.status !== PARKED) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.planStatusIllegal,
        `parked-plan approval requires status PARKED (got ${plan.status})`,
        { tenantId: plan.tenantId, correlationId: options.correlationId },
        "action.plan.approve",
        "status_not_parked",
      ),
    };
  }
  const targetStatus: ActionPlanStatus = decision === "approve" ? "APPROVED" : REJECTED;
  const transition = transitionActionPlan(plan, targetStatus, options.at, options.correlationId);
  if (!transition.ok) {
    return { ok: false, error: transition.error };
  }
  const nextPlan = transition.plan;
  const sink: ActionAuditSink = options.auditSink ?? NOOP_ACTION_AUDIT_SINK;
  sink.append(
    frozen({
      action: ACTION_AUDIT_ACTIONS.planApproved,
      tenantId: nextPlan.tenantId,
      subject: nextPlan.planId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      causationId: options.causationId,
      details: frozen({
        planId: nextPlan.planId,
        version: nextPlan.version,
        decision,
        approverId: options.approverId ?? null,
        status: nextPlan.status,
      }),
    }),
  );
  return { ok: true, plan: nextPlan, status: nextPlan.status };
}

// ---------------------------------------------------------------------------
// Re-export the decision-type constants (single import site for consumers)
// ---------------------------------------------------------------------------

export { ALLOW, BLOCK, REQUIRE_APPROVAL } from "@fleetos/contracts";
export { evaluateGuardianRequest } from "@fleetos/policy";
export type { GuardianDecision, GuardianDecisionType } from "@fleetos/contracts";
export type { GuardianRequestContext, GuardianRuleSet, EvaluateGuardianOptions } from "@fleetos/policy";

/** Re-exported for tests + callers (the synthetic system tenant + correlation). */
export const SUBMIT_PIPELINE_CORRELATION_ID = ACTIONS_PIPELINE_CORRELATION_ID;
export const SUBMIT_SYSTEM_TENANT = SYNTHETIC_SYSTEM_TENANT;
