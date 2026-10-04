/**
 * @fleetos/web-security — W142: the GATED DESTRUCTIVE CONTROLS surface
 * (disable enrollment code, revoke device trust).
 *
 * The SIM-B ground truth (blockler 4, security lane): the gated
 * destructive controls were INERT — clicking them yielded no
 * confirmation flow, no authorization check, no error, no audit entry.
 * This module is the machine that makes the confirmation flow real,
 * explicit and audited, with the user NEVER left to infer that a click
 * failed:
 *
 *   idle --begin--> reviewing --acknowledge + type-the-phrase-->
 *   ready_to_dispatch --dispatch--> dispatched (state change visible)
 *                                \-> refused (RBAC / duplicate / boundary failure)
 *   reviewing/ready_to_dispatch --cancel--> cancelled (visible)
 *
 * The gate is UNCHEATABLE by construction (mirrors the W141 destructive
 * recovery confirmation contract — same shape, same discipline):
 *
 *   - The dispatch step REFUSES to proceed without the EXPLICIT
 *     confirmation: the operator must (a) acknowledge the consequences
 *     AND (b) type the exact confirmation phrase derived from the
 *     action + subject (`CONFIRM DISABLE_ENROLLMENT_CODE <subject>` /
 *     `CONFIRM REVOKE_DEVICE_TRUST <subject>`).
 *   - The AUTHORIZATION GATE: the operator MUST hold the matching
 *     permission (`fleet.enrollment.disable` / `fleet.device.trust.revoke`).
 *     A restricted role gets the machine-stable `authorization_required`
 *     refusal (never a silent no-op — the failure is EXPLICIT, with the
 *     escalation path).
 *   - The dispatch routes through the INJECTED gated boundary (the REAL
 *     enrollment-disable / device-trust-revoke boundary at the binding
 *     site — never a direct execution); the result state carries the
 *     boundary's own record (the visible state change) or the boundary's
 *     machine-stable refusal (the visible failure — never silence).
 *   - The EXPLICIT CONFIRMATION and the dispatch outcome each write
 *     an append-only audit entry through the INJECTED audit sink.
 *   - A cancellation writes nothing (the audit policy: consequential
 *     events only — a cancelled confirmation changed nothing).
 *
 * PURE + DETERMINISTIC: no clock (every instant injected), no entropy,
 * no I/O. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, TenantId, UserId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type {
  AuthorityRecord,
  GatedDestructiveBoundary,
  SecurityDecisionAuditSink,
  SecurityDestructiveActionKind,
} from "./seams";
import { NOOP_SECURITY_AUDIT_SINK, SECURITY_PERMISSIONS } from "./seams";

// ---------------------------------------------------------------------------
// The audit actions (machine-stable)
// ---------------------------------------------------------------------------

/** Stable machine action names the destructive controls flow emits. */
export const DESTRUCTIVE_AUDIT_ACTIONS = Object.freeze({
  /** The operator explicitly confirmed a destructive intent (ack + phrase). */
  explicitConfirmation: "security.destructive.confirmation.explicit",
  /** The confirmed intent was routed through the gated boundary. */
  dispatched: "security.destructive.confirmation.dispatched",
} as const);

// ---------------------------------------------------------------------------
// The machine-stable refusal reasons (frozen vocabulary)
// ---------------------------------------------------------------------------

export const DESTRUCTIVE_REFUSALS = Object.freeze({
  /** No destructive confirmation is open (nothing to dispatch). */
  noConfirmationOpen: "no_confirmation_open",
  /** The operator lacks the required permission (RBAC — explicit denial). */
  authorizationRequired: "authorization_required",
  /** The consequences were not acknowledged. */
  consequencesNotAcknowledged: "consequences_not_acknowledged",
  /** The typed phrase does not match the required explicit confirmation. */
  phraseMismatch: "confirmation_phrase_mismatch",
  /** The catch-all: the explicit confirmation has not been satisfied. */
  explicitConfirmationRequired: "explicit_confirmation_required",
} as const);

/** The machine-stable refusal of a destructive dispatch attempt. */
export interface DestructiveRefusal {
  readonly ok: false;
  readonly reason: string;
  /** The frozen human explanation (never silent, never a guess). */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// The destructive confirmation context
// ---------------------------------------------------------------------------

/** The open confirmation's shared context. */
export interface DestructiveConfirmationContext {
  readonly tenantId: TenantId;
  readonly action: SecurityDestructiveActionKind;
  /** The subject the action targets (the enrollment code id / the device id). */
  readonly subject: string;
  /** The acting operator (the confirmation's principal). */
  readonly by: UserId;
  readonly correlationId: CorrelationId;
}

// ---------------------------------------------------------------------------
// The confirmation state machine
// ---------------------------------------------------------------------------

/** The machine's states (all transitions pure + machine-stable). */
export type DestructiveConfirmationState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "reviewing";
      readonly context: DestructiveConfirmationContext;
      readonly authority: AuthorityRecord;
      readonly openedAt: string;
      /** Has the operator acknowledged the consequences? (explicit step 1) */
      readonly acknowledged: boolean;
      /** The typed confirmation phrase so far (explicit step 2). */
      readonly phrase: string;
    }
  | {
      readonly kind: "ready_to_dispatch";
      readonly context: DestructiveConfirmationContext;
      readonly authority: AuthorityRecord;
      readonly openedAt: string;
      readonly confirmedAt: string;
    }
  | {
      readonly kind: "dispatched";
      readonly context: DestructiveConfirmationContext;
      readonly authority: AuthorityRecord;
      /** The boundary's machine-stable status for the routed record. */
      readonly status: string;
      /** The subject the action targeted (the visible state-change record). */
      readonly subject: string;
      readonly at: string;
    }
  | {
      readonly kind: "refused";
      readonly context: DestructiveConfirmationContext;
      readonly authority: AuthorityRecord;
      /** The machine-stable refusal reason. */
      readonly reason: string;
      readonly explanation: string;
      readonly at: string;
    }
  | {
      readonly kind: "cancelled";
      readonly context: DestructiveConfirmationContext | undefined;
      readonly at: string;
    };

// ---------------------------------------------------------------------------
// The required explicit confirmation phrase (machine-stable derivation)
// ---------------------------------------------------------------------------

/**
 * The exact phrase the operator must type to confirm a destructive
 * control: `CONFIRM <ACTION> <subject>` (uppercase action, verbatim
 * subject). PURE — the phrase is a pure function of the intent.
 */
export function requiredDestructiveConfirmationPhrase(
  context: DestructiveConfirmationContext,
): string {
  return `CONFIRM ${context.action.toUpperCase()} ${context.subject}`;
}

// ---------------------------------------------------------------------------
// The authorization gate (RBAC — explicit denial, never silent)
// ---------------------------------------------------------------------------

/**
 * Has the operator's authority granted the matching destructive
 * permission? PURE — the gate's own check. The permission name is
 * action-derived (the security lane's frozen vocabulary, mirrored
 * from the contracts `SECURITY_PERMISSIONS` table).
 */
export function canPerformDestructiveAction(
  action: SecurityDestructiveActionKind,
  authority: AuthorityRecord,
): boolean {
  const requiredPermission =
    action === "disable_enrollment_code"
      ? SECURITY_PERMISSIONS.disableEnrollmentCode
      : SECURITY_PERMISSIONS.revokeDeviceTrust;
  return authority.permissions.includes(requiredPermission);
}

/** The required permission for a destructive action kind. PURE. */
export function destructiveActionPermission(
  action: SecurityDestructiveActionKind,
): string {
  return action === "disable_enrollment_code"
    ? SECURITY_PERMISSIONS.disableEnrollmentCode
    : SECURITY_PERMISSIONS.revokeDeviceTrust;
}

/** The machine-stable authorization refusal explanation. PURE. */
export function destructiveAuthorizationRefusalExplanation(
  action: SecurityDestructiveActionKind,
  authority: AuthorityRecord,
): string {
  const permission = destructiveActionPermission(action);
  const hasRoles = authority.roles.length > 0
    ? `Active role(s): ${authority.roles.join(", ")}.`
    : "No active role assignments.";
  return `This action requires the "${permission}" permission. ${hasRoles} Request the role assignment from your Fleet Administrator.`;
}

// ---------------------------------------------------------------------------
// Transitions (pure; every illegal transition is a stable no-op or refusal)
// ---------------------------------------------------------------------------

/**
 * Open the confirmation review for a destructive control. The
 * authority gate REFUSES the open with the machine-stable
 * `authorization_required` refusal (never silent). Allowed from idle /
 * cancelled / refused / dispatched (a NEW confirmation after feedback);
 * from reviewing / ready_to_dispatch the open confirmation stands. PURE.
 */
export function beginDestructiveConfirmation(
  state: DestructiveConfirmationState,
  scope: { readonly tenantId: TenantId },
  context: DestructiveConfirmationContext,
  authority: AuthorityRecord,
  at: string,
): DestructiveConfirmationState {
  // Fail-closed: a tenant scope mismatch never opens a confirmation.
  if (scope.tenantId !== context.tenantId) {
    return state;
  }
  if (state.kind === "reviewing" || state.kind === "ready_to_dispatch") {
    return state; // an open confirmation stands — never two at once
  }
  if (typeof at !== "string" || at.length === 0) return state;

  // The authorization gate: a restricted role gets the machine-stable
  // `authorization_required` refusal. The state stays `idle` (the
  // boundary is untouched, no audit entry); the operator sees the
  // explicit denial + the escalation path (never a silent no-op).
  if (!canPerformDestructiveAction(context.action, authority)) {
    return frozen({
      kind: "refused",
      context,
      authority,
      reason: DESTRUCTIVE_REFUSALS.authorizationRequired,
      explanation: destructiveAuthorizationRefusalExplanation(context.action, authority),
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
  });
}

/**
 * Acknowledge the consequences (explicit step 1). Only meaningful in
 * `reviewing`; every other state is a stable no-op. PURE.
 */
export function acknowledgeDestructiveConsequences(
  state: DestructiveConfirmationState,
): DestructiveConfirmationState {
  if (state.kind !== "reviewing") return state;
  if (state.acknowledged) return state;
  return frozen({ ...state, acknowledged: true });
}

/**
 * Type (or retype) the confirmation phrase (explicit step 2). Only
 * meaningful in `reviewing`; every other state is a stable no-op. PURE.
 */
export function enterDestructiveConfirmationPhrase(
  state: DestructiveConfirmationState,
  phrase: string,
): DestructiveConfirmationState {
  if (state.kind !== "reviewing") return state;
  if (typeof phrase !== "string") return state;
  return frozen({ ...state, phrase });
}

/**
 * Has the operator satisfied the EXPLICIT confirmation (acknowledged
 * AND typed the exact required phrase)? PURE — the gate's own check.
 */
export function isDestructiveExplicitConfirmationSatisfied(
  state: DestructiveConfirmationState,
): boolean {
  if (state.kind !== "reviewing") return false;
  return (
    state.acknowledged &&
    state.phrase === requiredDestructiveConfirmationPhrase(state.context)
  );
}

/**
 * Mark the review's explicit confirmation as satisfied — the ONLY
 * transition into `ready_to_dispatch`, and it REFUSES (a stable no-op
 * back to `reviewing`) unless the consequences are acknowledged AND
 * the typed phrase matches exactly. PURE.
 */
export function markDestructiveExplicitConfirmation(
  state: DestructiveConfirmationState,
  at: string,
): DestructiveConfirmationState {
  if (state.kind !== "reviewing") return state;
  if (!isDestructiveExplicitConfirmationSatisfied(state)) return state;
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({
    kind: "ready_to_dispatch",
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
export function explicitDestructiveConfirmationRefusal(
  state: DestructiveConfirmationState,
): DestructiveRefusal {
  if (state.kind === "idle" || state.kind === "cancelled") {
    return frozen({
      ok: false,
      reason: DESTRUCTIVE_REFUSALS.noConfirmationOpen,
      explanation: "No destructive confirmation is open. Open the gated review first.",
    });
  }
  if (state.kind === "reviewing") {
    if (!state.acknowledged) {
      return frozen({
        ok: false,
        reason: DESTRUCTIVE_REFUSALS.consequencesNotAcknowledged,
        explanation:
          "The consequences have not been acknowledged. Acknowledge them, then type the confirmation phrase.",
      });
    }
    // Acknowledged — does the typed phrase match?
    if (state.phrase !== requiredDestructiveConfirmationPhrase(state.context)) {
      return frozen({
        ok: false,
        reason: DESTRUCTIVE_REFUSALS.phraseMismatch,
        explanation: `The typed phrase does not match. Type exactly: ${requiredDestructiveConfirmationPhrase(state.context)}`,
      });
    }
    // Acknowledged AND the phrase matches — but the explicit mark has
    // not been applied yet. The gate still refuses — the operator must
    // apply the mark to transition into `ready_to_dispatch`.
    return frozen({
      ok: false,
      reason: DESTRUCTIVE_REFUSALS.explicitConfirmationRequired,
      explanation:
        "The explicit confirmation has not been marked. Apply the explicit-confirmation mark to unlock the dispatch.",
    });
  }
  if (state.kind === "refused" || state.kind === "dispatched") {
    return frozen({
      ok: false,
      reason: DESTRUCTIVE_REFUSALS.noConfirmationOpen,
      explanation:
        "This confirmation is closed. Its outcome is recorded — open a new review to act again.",
    });
  }
  return frozen({
    ok: false,
    reason: DESTRUCTIVE_REFUSALS.explicitConfirmationRequired,
    explanation: "The explicit confirmation has not been satisfied.",
  });
}

// ---------------------------------------------------------------------------
// The dispatch (the gate's terminal transition — explicit + audited)
// ---------------------------------------------------------------------------

/** Options for the confirmed dispatch. */
export interface DispatchDestructiveOptions {
  /** The injected dispatch instant (ISO 8601). */
  readonly at: string;
  /** The INJECTED gated boundary (the REAL destructive-action gate). */
  readonly boundary: GatedDestructiveBoundary;
  /** The INJECTED append-only audit sink (the REAL audit log at the binding site). */
  readonly auditSink?: SecurityDecisionAuditSink;
}

/**
 * Dispatch the EXPLICITLY confirmed destructive intent through the
 * gated boundary. THE GATE: this transition REFUSES to proceed unless
 * the state is `ready_to_dispatch` — and `beginDestructiveConfirmation`
 * -> `markDestructiveExplicitConfirmation` is the ONLY path there,
 * requiring the acknowledged consequences AND the exact typed phrase.
 * A refusal returns the machine-stable reason + explanation and
 * leaves the state UNCHANGED, the boundary UNTOUCHED, and NO audit
 * entry written.
 *
 * On success the audit seam records BOTH the explicit confirmation and
 * the routed dispatch (the append-only evidence the flow happened),
 * and the returned state makes the boundary's own record visible.
 * PURE with respect to the injected seams (deterministic tests).
 */
export function dispatchConfirmedDestructive(
  state: DestructiveConfirmationState,
  options: DispatchDestructiveOptions,
): { readonly state: DestructiveConfirmationState; readonly refusal: DestructiveRefusal | undefined } {
  // The gate: only an explicitly-confirmed review may proceed.
  if (state.kind !== "ready_to_dispatch") {
    return { state, refusal: explicitDestructiveConfirmationRefusal(state) };
  }
  if (typeof options?.at !== "string" || options.at.length === 0) {
    return {
      state,
      refusal: frozen({
        ok: false,
        reason: DESTRUCTIVE_REFUSALS.explicitConfirmationRequired,
        explanation: "The dispatch instant is missing — nothing was routed.",
      }),
    };
  }

  const context = state.context;
  const sink = options.auditSink ?? NOOP_SECURITY_AUDIT_SINK;

  // The explicit confirmation's audit entry (consequential: the human
  // explicitly confirmed a destructive intent).
  sink.append({
    tenantId: context.tenantId,
    action: DESTRUCTIVE_AUDIT_ACTIONS.explicitConfirmation,
    subject: context.subject,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      by: context.by,
      phrase: requiredDestructiveConfirmationPhrase(context),
      acknowledged: true,
    },
  });

  // The routed dispatch (the REAL gated boundary owns the rest).
  const result = options.boundary({
    tenantId: context.tenantId,
    action: context.action,
    subject: context.subject,
    by: context.by,
    at: options.at,
    correlationId: context.correlationId,
  });

  if (!result.ok) {
    // The boundary refused — the failure is VISIBLE (never inferred).
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
    action: DESTRUCTIVE_AUDIT_ACTIONS.dispatched,
    subject: context.subject,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      by: context.by,
      status: result.record.status,
      subject: result.record.subject,
    },
  });

  return {
    state: frozen({
      kind: "dispatched",
      context,
      authority: state.authority,
      status: result.record.status,
      subject: result.record.subject,
      at: options.at,
    }),
    refusal: undefined,
  };
}

/**
 * Cancel the open confirmation. Allowed from reviewing /
 * ready_to_dispatch (the operator backed out — VISIBLE, not inferred);
 * every other state is a stable no-op. A cancellation writes NO audit
 * entry (the audit policy: consequential events only — nothing
 * happened). PURE.
 */
export function cancelDestructiveConfirmation(
  state: DestructiveConfirmationState,
  at: string,
): DestructiveConfirmationState {
  if (state.kind !== "reviewing" && state.kind !== "ready_to_dispatch") return state;
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({ kind: "cancelled", context: state.context, at });
}

// ---------------------------------------------------------------------------
// The feedback projection (the user is never left to infer a click failed)
// ---------------------------------------------------------------------------

/** The visible feedback line for the machine's current state. PURE. */
export function destructiveConfirmationFeedback(
  state: DestructiveConfirmationState,
): { readonly status: string; readonly message: string } {
  switch (state.kind) {
    case "idle":
      return { status: "idle", message: "No destructive confirmation is open." };
    case "reviewing":
      return {
        status: "reviewing",
        message: state.acknowledged
          ? "Consequences acknowledged. Type the confirmation phrase to unlock the dispatch."
          : "Review the consequences and acknowledge them to continue.",
      };
    case "ready_to_dispatch":
      return {
        status: "ready_to_dispatch",
        message: "The explicit confirmation is satisfied. Dispatch routes through the gated boundary.",
      };
    case "dispatched":
      return {
        status: "dispatched",
        message: `Action ${state.context.action} on ${state.subject} is ${state.status}. The state change is visible below.`,
      };
    case "refused":
      return {
        status: "refused",
        message: `The boundary refused: ${state.reason} — ${state.explanation}`,
      };
    case "cancelled":
      return { status: "cancelled", message: "The confirmation was cancelled. Nothing was routed." };
  }
}
