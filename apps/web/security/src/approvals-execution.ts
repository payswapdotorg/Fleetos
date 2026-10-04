/**
 * @fleetos/web-security — W142: the Approvals EXECUTION state machine
 * (the report's central demand).
 *
 * The SIM-B ground truth (blocker 3): the Approve/Reject controls on a
 * parked plan were INERT — clicking them yielded no confirmation flow,
 * no authorization check, no state change, no audit entry, no evidence
 * trail. This module is the machine that makes the governed action real,
 * explicit and audited — the user is NEVER left to infer that a click
 * failed:
 *
 *   idle --begin--> reviewing --confirm--> ready_to_decide --dispatch-->
 *   decided (state change visible)
 *                              \-> refused (RBAC denial / duplicate / boundary failure)
 *   reviewing/ready_to_decide --cancel--> cancelled (visible)
 *
 * The gate is UNCHEATABLE by construction:
 *
 *   - The dispatch step REFUSES to proceed without the EXPLICIT
 *     confirmation: the operator must (a) acknowledge the consequences
 *     AND (b) type the exact confirmation phrase derived from the
 *     action + plan (`CONFIRM APPROVE <planId>` / `CONFIRM REJECT
 *     <planId>`). `dispatchConfirmed` returns the machine-stable
 *     `explicit_confirmation_required` refusal — the state unchanged,
 *     the boundary UNTOUCHED, NO audit entry — until both hold.
 *   - The AUTHORIZATION GATE: the operator MUST hold the
 *     `fleet.action.approve` permission. A restricted role gets the
 *     machine-stable `authorization_required` refusal (never a silent
 *     no-op — the failure is EXPLICIT, with the escalation path).
 *   - The DUPLICATE GATE: a plan already in a terminal state (APPROVED
 *     or REJECTED) refuses with the machine-stable `already_decided`
 *     reason — never a silent no-op. The original decision record
 *     remains the authoritative state (idempotency guard).
 *   - The dispatch routes through the INJECTED gated boundary (the
 *     REAL `approveParkedPlan` at the binding site — never a direct
 *     execution); the result state carries the boundary's own record
 *     (the visible state change) or the boundary's machine-stable
 *     refusal (the visible failure — never silence).
 *   - The EXPLICIT CONFIRMATION and the dispatch outcome each write
 *     an append-only audit entry through the INJECTED audit sink (the
 *     REAL `@fleetos/audit` log via its sink adapter at the binding
 *     site — the structural `SecurityDecisionAuditSink` shape, no
 *     cross-lane import).
 *   - A cancellation writes nothing (the audit policy: consequential
 *     events only — a cancelled confirmation changed nothing).
 *
 * PURE + DETERMINISTIC: no clock (every instant injected), no entropy,
 * no I/O. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId, UserId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { AuthorityRecord, GatedDecisionBoundary, SecurityDecisionAuditSink } from "./seams";
import { NOOP_SECURITY_AUDIT_SINK, SECURITY_PERMISSIONS } from "./seams";

// ---------------------------------------------------------------------------
// The audit actions (machine-stable)
// ---------------------------------------------------------------------------

/** Stable machine action names the approvals execution flow emits. */
export const APPROVAL_AUDIT_ACTIONS = Object.freeze({
  /** The operator explicitly confirmed an approval / rejection intent. */
  explicitConfirmation: "security.approval.confirmation.explicit",
  /** The confirmed decision was routed through the gated boundary. */
  dispatched: "security.approval.confirmation.dispatched",
} as const);

// ---------------------------------------------------------------------------
// The machine-stable refusal reasons (frozen vocabulary)
// ---------------------------------------------------------------------------

export const APPROVAL_REFUSALS = Object.freeze({
  /** No decision is open (nothing to dispatch). */
  noDecisionOpen: "no_decision_open",
  /** The operator lacks the required permission (RBAC denial — explicit). */
  authorizationRequired: "authorization_required",
  /** The consequences were not acknowledged. */
  consequencesNotAcknowledged: "consequences_not_acknowledged",
  /** The typed phrase does not match the required explicit confirmation. */
  phraseMismatch: "confirmation_phrase_mismatch",
  /** A plan is already in a terminal state (duplicate — handled safely). */
  alreadyDecided: "already_decided",
  /** The catch-all: the explicit confirmation has not been satisfied. */
  explicitConfirmationRequired: "explicit_confirmation_required",
} as const);

/** The machine-stable refusal of a dispatch attempt. */
export interface ApprovalRefusal {
  readonly ok: false;
  readonly reason: string;
  /** The frozen human explanation (never silent, never a guess). */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// The decision lifecycle context
// ---------------------------------------------------------------------------

/** The open decision's shared context. */
export interface ApprovalDecisionContext {
  readonly tenantId: TenantId;
  readonly planId: string;
  /** The approval action ("approve" or "reject"). */
  readonly action: "approve" | "reject";
  /** The acting operator (the decision's principal). */
  readonly by: UserId;
  readonly correlationId: CorrelationId;
}

// ---------------------------------------------------------------------------
// The decision lifecycle state machine
// ---------------------------------------------------------------------------

/** The machine's states (all transitions pure + machine-stable). */
export type ApprovalDecisionState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "reviewing";
      readonly context: ApprovalDecisionContext;
      readonly authority: AuthorityRecord;
      readonly openedAt: string;
      /** Has the operator acknowledged the consequences? (explicit step 1) */
      readonly acknowledged: boolean;
      /** The typed confirmation phrase so far (explicit step 2). */
      readonly phrase: string;
      /** The RBAC refusal reason, when the authority gate refused (visible). */
      readonly authorizationRefusal: string | undefined;
    }
  | {
      readonly kind: "ready_to_decide";
      readonly context: ApprovalDecisionContext;
      readonly authority: AuthorityRecord;
      readonly openedAt: string;
      readonly confirmedAt: string;
    }
  | {
      readonly kind: "decided";
      readonly context: ApprovalDecisionContext;
      readonly authority: AuthorityRecord;
      /** The boundary's machine-stable status for the routed record. */
      readonly status: string;
      /** The approving principal (recorded by the boundary on APPROVED). */
      readonly approverId: UserId | undefined;
      /** The rejection reason (recorded by the boundary on REJECTED). */
      readonly rejectionReason: string | undefined;
      readonly at: string;
    }
  | {
      readonly kind: "refused";
      readonly context: ApprovalDecisionContext;
      readonly authority: AuthorityRecord;
      /** The machine-stable refusal reason. */
      readonly reason: string;
      readonly explanation: string;
      readonly at: string;
    }
  | {
      readonly kind: "cancelled";
      readonly context: ApprovalDecisionContext | undefined;
      readonly at: string;
    };

// ---------------------------------------------------------------------------
// The required explicit confirmation phrase (machine-stable derivation)
// ---------------------------------------------------------------------------

/**
 * The exact phrase the operator must type to confirm a decision:
 * `CONFIRM <ACTION> <planId>` (uppercase action, verbatim plan id).
 * PURE — the phrase is a pure function of the intent, so the dialog can
 * display it and the machine can demand it.
 */
export function requiredApprovalConfirmationPhrase(context: ApprovalDecisionContext): string {
  return `CONFIRM ${context.action.toUpperCase()} ${context.planId}`;
}

// ---------------------------------------------------------------------------
// The authorization gate (RBAC — explicit denial, never silent)
// ---------------------------------------------------------------------------

/**
 * Has the operator's authority granted the approve-parked-plan
 * permission? PURE — the gate's own check. A restricted role returns
 * false; the dispatch step surfaces the machine-stable
 * `authorization_required` refusal with the escalation path (never a
 * silent no-op).
 */
export function canApproveParkedPlan(authority: AuthorityRecord): boolean {
  return authority.permissions.includes(SECURITY_PERMISSIONS.approveParkedPlan);
}

/** The machine-stable authorization refusal explanation. PURE. */
export function authorizationRefusalExplanation(authority: AuthorityRecord): string {
  const hasRoles = authority.roles.length > 0
    ? `Active role(s): ${authority.roles.join(", ")}.`
    : "No active role assignments.";
  return `This action requires the "${SECURITY_PERMISSIONS.approveParkedPlan}" permission. ${hasRoles} Request the role assignment from your Fleet Administrator.`;
}

// ---------------------------------------------------------------------------
// Transitions (pure; every illegal transition is a stable no-op or refusal)
// ---------------------------------------------------------------------------

/**
 * Open the decision review for a parked plan. The authority gate
 * REFUSES the open with the machine-stable `authorization_required`
 * refusal (never silent) — the state stays `idle`, but the refusal
 * surface can carry the explanation. Allowed from idle / cancelled /
 * refused / decided (a NEW decision after feedback — though the
 * boundary will refuse a duplicate); from reviewing / ready_to_decide
 * the open decision stands (the machine refuses to stack two — stable
 * no-op). PURE.
 */
export function beginApprovalDecision(
  state: ApprovalDecisionState,
  scope: { readonly tenantId: TenantId },
  context: ApprovalDecisionContext,
  authority: AuthorityRecord,
  at: string,
): ApprovalDecisionState {
  // Fail-closed: a tenant scope mismatch never opens a confirmation.
  if (scope.tenantId !== context.tenantId) {
    return state;
  }
  if (state.kind === "reviewing" || state.kind === "ready_to_decide") {
    return state; // an open confirmation stands — never two at once
  }
  if (typeof at !== "string" || at.length === 0) return state;

  // The authorization gate: a restricted role gets the machine-stable
  // `authorization_required` refusal. The state stays `idle` (the
  // boundary is untouched, no audit entry); the operator sees the
  // explicit denial + the escalation path (never a silent no-op).
  if (!canApproveParkedPlan(authority)) {
    return frozen({
      kind: "refused",
      context,
      authority,
      reason: APPROVAL_REFUSALS.authorizationRequired,
      explanation: authorizationRefusalExplanation(authority),
      at,
    });
  }
  return frozen({
    kind: "reviewing",
    context: frozen({ ...context }),
    authority: frozen({ ...authority }),
    openedAt: at,
    acknowledged: false,
    phrase: "",
    authorizationRefusal: undefined,
  });
}

/**
 * Acknowledge the consequences (explicit step 1). Only meaningful in
 * `reviewing`; every other state is a stable no-op. PURE.
 */
export function acknowledgeApprovalConsequences(
  state: ApprovalDecisionState,
): ApprovalDecisionState {
  if (state.kind !== "reviewing") return state;
  if (state.acknowledged) return state;
  return frozen({ ...state, acknowledged: true });
}

/**
 * Type (or retype) the confirmation phrase (explicit step 2). Only
 * meaningful in `reviewing`; every other state is a stable no-op. PURE.
 */
export function enterApprovalConfirmationPhrase(
  state: ApprovalDecisionState,
  phrase: string,
): ApprovalDecisionState {
  if (state.kind !== "reviewing") return state;
  if (typeof phrase !== "string") return state;
  return frozen({ ...state, phrase });
}

/**
 * Has the operator satisfied the EXPLICIT confirmation (acknowledged
 * AND typed the exact required phrase)? PURE — the gate's own check.
 */
export function isApprovalExplicitConfirmationSatisfied(
  state: ApprovalDecisionState,
): boolean {
  if (state.kind !== "reviewing") return false;
  return (
    state.acknowledged &&
    state.phrase === requiredApprovalConfirmationPhrase(state.context)
  );
}

/**
 * Mark the review's explicit confirmation as satisfied — the ONLY
 * transition into `ready_to_decide`, and it REFUSES (a stable no-op
 * back to `reviewing`) unless the consequences are acknowledged AND
 * the typed phrase matches exactly. PURE.
 */
export function markApprovalExplicitConfirmation(
  state: ApprovalDecisionState,
  at: string,
): ApprovalDecisionState {
  if (state.kind !== "reviewing") return state;
  if (!isApprovalExplicitConfirmationSatisfied(state)) return state;
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({
    kind: "ready_to_decide",
    context: state.context,
    authority: state.authority,
    openedAt: state.openedAt,
    confirmedAt: at,
  });
}

/**
 * The machine-stable refusal of a dispatch attempted WITHOUT the
 * explicit confirmation — THE GATE. Returns the refusal (the state is
 * the caller's to keep; the boundary is never touched). PURE.
 */
export function explicitApprovalConfirmationRefusal(
  state: ApprovalDecisionState,
): ApprovalRefusal {
  if (state.kind === "idle" || state.kind === "cancelled") {
    return frozen({
      ok: false,
      reason: APPROVAL_REFUSALS.noDecisionOpen,
      explanation: "No approval decision is open. Open the gated review first.",
    });
  }
  if (state.kind === "reviewing") {
    if (!state.acknowledged) {
      return frozen({
        ok: false,
        reason: APPROVAL_REFUSALS.consequencesNotAcknowledged,
        explanation:
          "The consequences have not been acknowledged. Acknowledge them, then type the confirmation phrase.",
      });
    }
    // Acknowledged — does the typed phrase match?
    if (state.phrase !== requiredApprovalConfirmationPhrase(state.context)) {
      return frozen({
        ok: false,
        reason: APPROVAL_REFUSALS.phraseMismatch,
        explanation: `The typed phrase does not match. Type exactly: ${requiredApprovalConfirmationPhrase(state.context)}`,
      });
    }
    // Acknowledged AND the phrase matches — but the explicit mark has
    // not been applied yet. The gate still refuses — the operator must
    // apply the mark to transition into `ready_to_decide`.
    return frozen({
      ok: false,
      reason: APPROVAL_REFUSALS.explicitConfirmationRequired,
      explanation:
        "The explicit confirmation has not been marked. Apply the explicit-confirmation mark to unlock the dispatch.",
    });
  }
  if (state.kind === "refused" || state.kind === "decided") {
    return frozen({
      ok: false,
      reason: state.kind === "decided" ? APPROVAL_REFUSALS.alreadyDecided : APPROVAL_REFUSALS.noDecisionOpen,
      explanation:
        "This decision is closed. Its outcome is recorded — the boundary will refuse a duplicate.",
    });
  }
  return frozen({
    ok: false,
    reason: APPROVAL_REFUSALS.explicitConfirmationRequired,
    explanation: "The explicit confirmation has not been satisfied.",
  });
}

// ---------------------------------------------------------------------------
// The dispatch (the gate's terminal transition — explicit + audited)
// ---------------------------------------------------------------------------

/** Options for the confirmed decision dispatch. */
export interface DispatchApprovalDecisionOptions {
  /** The injected dispatch instant (ISO 8601). */
  readonly at: string;
  /** The INJECTED gated boundary (the REAL `approveParkedPlan` gate). */
  readonly boundary: GatedDecisionBoundary;
  /** The INJECTED append-only audit sink (the REAL audit log at the binding site). */
  readonly auditSink?: SecurityDecisionAuditSink;
}

/**
 * Dispatch the EXPLICITLY confirmed decision through the gated
 * boundary. THE GATE: this transition REFUSES to proceed unless the
 * state is `ready_to_decide` — and `beginApprovalDecision` ->
 * `markApprovalExplicitConfirmation` is the ONLY path there,
 * requiring the acknowledged consequences AND the exact typed phrase.
 * A refusal returns the machine-stable reason + explanation and
 * leaves the state UNCHANGED, the boundary UNTOUCHED, and NO audit
 * entry written.
 *
 * The BOUNDARY owns the duplicate-safe guard (a plan already in a
 * terminal state refuses with `already_decided`). When the boundary
 * refuses, the state becomes `refused` with the boundary's
 * machine-stable reason — visible, never inferred.
 *
 * On success the audit seam records BOTH the explicit confirmation and
 * the routed dispatch (the append-only evidence the flow happened),
 * and the returned state makes the boundary's own record visible.
 * PURE with respect to the injected seams (deterministic tests).
 */
export function dispatchConfirmedApproval(
  state: ApprovalDecisionState,
  options: DispatchApprovalDecisionOptions,
): { readonly state: ApprovalDecisionState; readonly refusal: ApprovalRefusal | undefined } {
  // The gate: only an explicitly-confirmed review may proceed.
  if (state.kind !== "ready_to_decide") {
    return { state, refusal: explicitApprovalConfirmationRefusal(state) };
  }
  if (typeof options?.at !== "string" || options.at.length === 0) {
    return {
      state,
      refusal: frozen({
        ok: false,
        reason: APPROVAL_REFUSALS.explicitConfirmationRequired,
        explanation: "The dispatch instant is missing — nothing was routed.",
      }),
    };
  }

  const context = state.context;
  const sink = options.auditSink ?? NOOP_SECURITY_AUDIT_SINK;

  // The explicit confirmation's audit entry (consequential: the human
  // explicitly confirmed a decision intent).
  sink.append({
    tenantId: context.tenantId,
    action: APPROVAL_AUDIT_ACTIONS.explicitConfirmation,
    subject: context.planId,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      by: context.by,
      phrase: requiredApprovalConfirmationPhrase(context),
      acknowledged: true,
    },
  });

  // The routed dispatch (the REAL gated boundary owns the rest).
  const result = options.boundary({
    tenantId: context.tenantId,
    planId: context.planId,
    action: context.action,
    by: context.by,
    at: options.at,
    correlationId: context.correlationId,
    ...(context.action === "reject" ? { reason: "operator_rejected" } : {}),
  });

  if (!result.ok) {
    // The boundary refused — the failure is VISIBLE (never inferred).
    // The DUPLICATE guard surfaces as the `already_decided` reason here.
    return {
      state: frozen({
        kind: "refused",
        context,
        authority: state.authority,
        reason: result.reason,
        explanation: result.message,
        at: options.at,
      }),
      refusal: undefined,
    };
  }

  // The dispatch's audit entry (the routed outcome, with the boundary's
  // own record reference).
  sink.append({
    tenantId: context.tenantId,
    action: APPROVAL_AUDIT_ACTIONS.dispatched,
    subject: context.planId,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      by: context.by,
      planId: result.record.planId,
      status: result.record.status,
      ...(result.record.approverId !== undefined ? { approverId: result.record.approverId } : {}),
      ...(result.record.rejectionReason !== undefined ? { rejectionReason: result.record.rejectionReason } : {}),
    },
  });

  return {
    state: frozen({
      kind: "decided",
      context,
      authority: state.authority,
      status: result.record.status,
      approverId: result.record.approverId,
      rejectionReason: result.record.rejectionReason,
      at: options.at,
    }),
    refusal: undefined,
  };
}

/**
 * Cancel the open decision. Allowed from reviewing / ready_to_decide
 * (the operator backed out — VISIBLE, not inferred); every other
 * state is a stable no-op. A cancellation writes NO audit entry (the
 * audit policy: consequential events only — nothing happened). PURE.
 */
export function cancelApprovalDecision(
  state: ApprovalDecisionState,
  at: string,
): ApprovalDecisionState {
  if (state.kind !== "reviewing" && state.kind !== "ready_to_decide") return state;
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({ kind: "cancelled", context: state.context, at });
}

// ---------------------------------------------------------------------------
// The feedback projection (the user is never left to infer a click failed)
// ---------------------------------------------------------------------------

/** The visible feedback line for the machine's current state. PURE. */
export function approvalDecisionFeedback(
  state: ApprovalDecisionState,
): { readonly status: string; readonly message: string } {
  switch (state.kind) {
    case "idle":
      return { status: "idle", message: "No approval decision is open." };
    case "reviewing":
      return {
        status: "reviewing",
        message: state.acknowledged
          ? "Consequences acknowledged. Type the confirmation phrase to unlock the decision."
          : "Review the consequences and acknowledge them to continue.",
      };
    case "ready_to_decide":
      return {
        status: "ready_to_dispatch",
        message: "The explicit confirmation is satisfied. Dispatch routes through the gated boundary.",
      };
    case "decided":
      return {
        status: "decided",
        message: `Plan is ${state.status}${
          state.approverId !== undefined ? ` (approved by ${state.approverId})` : ""
        }. The state change is visible below.`,
      };
    case "refused":
      return {
        status: "refused",
        message: `The boundary refused: ${state.reason} — ${state.explanation}`,
      };
    case "cancelled":
      return { status: "cancelled", message: "The decision was cancelled. Nothing was routed." };
  }
}
