/**
 * @fleetos/web-recovery — W141: the DESTRUCTIVE-ACTION CONFIRMATION
 * flow (the gated, explicit-confirmation state machine + audit seam).
 *
 * The SIM-B ground truth (blocker 4): gated destructive controls were
 * INERT — "clicking them yields no confirmation flow, no error, no
 * audit entry". This module is the machine that makes the confirmation
 * flow real, explicit and audited, with the user NEVER left to infer
 * that a click failed:
 *
 *   idle --begin--> reviewing --acknowledge + type-the-phrase-->
 *   ready_to_dispatch --dispatch--> dispatched (record visible)
 *                                \-> refused (reason visible)
 *   reviewing/ready_to_dispatch --cancel--> cancelled (visible)
 *
 * The gate is UNCHEATABLE by construction:
 *
 *   - The dispatch step REFUSES to proceed without the EXPLICIT
 *     confirmation: the operator must (a) acknowledge the consequences
 *     AND (b) type the exact confirmation phrase derived from the
 *     action + device (`CONFIRM <ACTION> <deviceId>`). `dispatchConfirmed`
 *     returns the machine-stable `explicit_confirmation_required`
 *     refusal — the state unchanged, the boundary UNTOUCHED, NO audit
 *     entry — until both hold.
 *   - The dispatch routes through the INJECTED gated boundary (the
 *     REAL `requestDestructiveAction` at the binding site — never a
 *     direct execution); the result state carries the boundary's own
 *     record (the visible state change) or the boundary's machine-
 *     stable refusal (the visible failure — never silence).
 *   - The EXPLICIT CONFIRMATION and the dispatch outcome each write an
 *     append-only audit entry through the INJECTED audit sink (the
 *     REAL `@fleetos/audit` log via its sink adapter at the binding
 *     site — the structural `AuditSink` shape, no cross-lane import).
 *   - A cancellation writes nothing (the audit policy: consequential
 *     events only — a cancelled confirmation changed nothing).
 *
 * PURE + DETERMINISTIC: no clock (every instant injected), no entropy,
 * no I/O. No `any` in public signatures. Strict TS.
 */

import type { CausationId, CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import { checkRecoveryUiTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The audit sink seam (structurally the @fleetos/audit AuditSink shape)
// ---------------------------------------------------------------------------

/**
 * The append-only audit record the confirmation flow emits. Structurally
 * identical to `@fleetos/audit`'s `AuditSinkRecord` (and the recovery
 * domain's `RecoveryAuditRecord`) — the REAL sink adapter accepts this
 * shape at the binding site without a cross-lane import.
 */
export interface ConfirmationAuditRecord {
  readonly tenantId: TenantId;
  readonly action: string;
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * The append-only audit sink. Implementations MUST NOT drop records.
 * INJECTED at the binding site (the REAL `@fleetos/audit` log through
 * `createAuditSinkAdapter`; the collecting sink in tests).
 */
export interface ConfirmationAuditSink {
  append(record: ConfirmationAuditRecord): void;
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_CONFIRMATION_AUDIT_SINK: ConfirmationAuditSink = frozen({
  append: (_record: ConfirmationAuditRecord): void => undefined,
});

/** Stable machine action names the confirmation flow emits. */
export const CONFIRMATION_AUDIT_ACTIONS = frozen({
  /** The operator explicitly confirmed a destructive intent (ack + phrase). */
  explicitConfirmation: "recovery.destructive.confirmation.explicit",
  /** The confirmed intent was routed through the gated boundary. */
  dispatched: "recovery.destructive.confirmation.dispatched",
} as const);

// ---------------------------------------------------------------------------
// The machine-stable refusal reasons (frozen vocabulary)
// ---------------------------------------------------------------------------

export const CONFIRMATION_REFUSALS = Object.freeze({
  /** No confirmation is open (nothing to dispatch). */
  noConfirmationOpen: "no_confirmation_open",
  /** The consequences were not acknowledged. */
  consequencesNotAcknowledged: "consequences_not_acknowledged",
  /** The typed phrase does not match the required explicit confirmation. */
  phraseMismatch: "confirmation_phrase_mismatch",
  /** The catch-all: the explicit confirmation has not been satisfied. */
  explicitConfirmationRequired: "explicit_confirmation_required",
} as const);

/** The machine-stable refusal of a dispatch attempt. */
export interface ConfirmationRefusal {
  readonly ok: false;
  readonly reason: string;
  /** The frozen human explanation (never silent, never a guess). */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// The confirmation state machine
// ---------------------------------------------------------------------------

/** The open confirmation's shared context. */
export interface ConfirmationContext {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly caseId: string;
  /** The destructive action kind ("lock" | "locate" | "wipe" | "reboot"). */
  readonly action: string;
  /** The acting operator (the confirmation's principal). */
  readonly by: string;
  readonly correlationId: CorrelationId;
}

/** The machine's states (all transitions pure + machine-stable). */
export type DestructiveConfirmationState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "reviewing";
      readonly context: ConfirmationContext;
      readonly openedAt: string;
      /** Has the operator acknowledged the consequences? (explicit step 1) */
      readonly acknowledged: boolean;
      /** The typed confirmation phrase so far (explicit step 2). */
      readonly phrase: string;
    }
  | {
      readonly kind: "ready_to_dispatch";
      readonly context: ConfirmationContext;
      readonly openedAt: string;
      readonly confirmedAt: string;
    }
  | {
      readonly kind: "dispatched";
      readonly context: ConfirmationContext;
      readonly requestId: string;
      /** The boundary's machine-stable status for the routed record. */
      readonly status: string;
      readonly at: string;
    }
  | {
      readonly kind: "refused";
      readonly context: ConfirmationContext;
      /** The machine-stable refusal reason. */
      readonly reason: string;
      readonly explanation: string;
      readonly at: string;
    }
  | {
      readonly kind: "cancelled";
      readonly context: ConfirmationContext | undefined;
      readonly at: string;
    };

// ---------------------------------------------------------------------------
// The required explicit confirmation phrase (machine-stable derivation)
// ---------------------------------------------------------------------------

/**
 * The exact phrase the operator must type to confirm a destructive
 * action: `CONFIRM <ACTION> <deviceId>` (uppercase action, verbatim
 * device id). PURE — the phrase is a pure function of the intent, so
 * the dialog can display it and the machine can demand it.
 */
export function requiredConfirmationPhrase(context: ConfirmationContext): string {
  return `CONFIRM ${context.action.toUpperCase()} ${context.deviceId as string}`;
}

// ---------------------------------------------------------------------------
// Transitions (pure; every illegal transition is a stable no-op or refusal)
// ---------------------------------------------------------------------------

/**
 * Open the confirmation review for a destructive intent. Allowed from
 * idle / cancelled / refused / dispatched (a NEW confirmation after
 * feedback); from reviewing / ready_to_dispatch the open confirmation
 * stands (the machine refuses to stack two — stable no-op). PURE.
 */
export function beginDestructiveConfirmation(
  state: DestructiveConfirmationState,
  scope: RecoveryUiTenantScope,
  context: ConfirmationContext,
  at: string,
): DestructiveConfirmationState {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) {
    // Fail-closed: a refused scope grammar never opens a confirmation.
    return state;
  }
  if (state.kind === "reviewing" || state.kind === "ready_to_dispatch") {
    return state; // an open confirmation stands — never two at once
  }
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({
    kind: "reviewing",
    context: frozen({ ...context }),
    openedAt: at,
    acknowledged: false,
    phrase: "",
  });
}

/**
 * Acknowledge the consequences (explicit step 1). Only meaningful in
 * `reviewing`; every other state is a stable no-op. PURE.
 */
export function acknowledgeConsequences(
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
export function enterConfirmationPhrase(
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
export function isExplicitConfirmationSatisfied(state: DestructiveConfirmationState): boolean {
  if (state.kind !== "reviewing") return false;
  return state.acknowledged && state.phrase === requiredConfirmationPhrase(state.context);
}

/**
 * Mark the review's explicit confirmation as satisfied — the ONLY
 * transition into `ready_to_dispatch`, and it REFUSES (a stable no-op
 * back to `reviewing`) unless the consequences are acknowledged AND
 * the typed phrase matches exactly. PURE.
 */
export function markExplicitConfirmation(
  state: DestructiveConfirmationState,
  at: string,
): DestructiveConfirmationState {
  if (state.kind !== "reviewing") return state;
  if (!isExplicitConfirmationSatisfied(state)) return state;
  if (typeof at !== "string" || at.length === 0) return state;
  return frozen({
    kind: "ready_to_dispatch",
    context: state.context,
    openedAt: state.openedAt,
    confirmedAt: at,
  });
}

/**
 * The machine-stable refusal of a dispatch attempted WITHOUT the
 * explicit confirmation — the GATE. Returns the refusal (the state is
 * the caller's to keep; the boundary is never touched). PURE.
 */
export function explicitConfirmationRefusal(
  state: DestructiveConfirmationState,
): ConfirmationRefusal {
  if (state.kind === "idle" || state.kind === "cancelled") {
    return frozen({
      ok: false,
      reason: CONFIRMATION_REFUSALS.noConfirmationOpen,
      explanation: "No destructive confirmation is open. Open the gated review first.",
    });
  }
  if (state.kind === "reviewing") {
    if (!state.acknowledged) {
      return frozen({
        ok: false,
        reason: CONFIRMATION_REFUSALS.consequencesNotAcknowledged,
        explanation:
          "The consequences have not been acknowledged. Acknowledge them, then type the confirmation phrase.",
      });
    }
    return frozen({
      ok: false,
      reason: CONFIRMATION_REFUSALS.phraseMismatch,
      explanation: `The typed phrase does not match. Type exactly: ${requiredConfirmationPhrase(state.context)}`,
    });
  }
  if (state.kind === "refused" || state.kind === "dispatched") {
    return frozen({
      ok: false,
      reason: CONFIRMATION_REFUSALS.noConfirmationOpen,
      explanation:
        "This confirmation is closed. Its outcome is recorded — open a new review to act again.",
    });
  }
  return frozen({
    ok: false,
    reason: CONFIRMATION_REFUSALS.explicitConfirmationRequired,
    explanation: "The explicit confirmation has not been satisfied.",
  });
}

// ---------------------------------------------------------------------------
// The injected gated boundary (the REAL destructive gate at the binding site)
// ---------------------------------------------------------------------------

/** The dispatch input the boundary receives. */
export interface ConfirmationDispatchInput {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly caseId: string;
  readonly action: string;
  readonly by: string;
  readonly at: string;
  readonly correlationId: CorrelationId;
}

/** The durable record projection the boundary returns on success. */
export interface ConfirmationBoundaryRecord {
  readonly requestId: string;
  /** The boundary's machine-stable status (e.g. PARKED / ADVANCED / REJECTED). */
  readonly status: string;
}

/** The boundary's machine-stable result. */
export type ConfirmationBoundaryResult =
  | { readonly ok: true; readonly record: ConfirmationBoundaryRecord }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/**
 * The INJECTED gated boundary — the REAL destructive-request boundary
 * (`requestDestructiveAction` + the Guardian evaluation + the adapter
 * capability check) wrapped at the binding site. This module NEVER
 * executes anything itself; the boundary owns authorization,
 * idempotency, audit and verification.
 */
export type GatedDestructiveBoundary = (
  input: ConfirmationDispatchInput,
) => ConfirmationBoundaryResult;

// ---------------------------------------------------------------------------
// The dispatch (the gate's terminal transition — explicit + audited)
// ---------------------------------------------------------------------------

/** Options for the confirmed dispatch. */
export interface DispatchConfirmedOptions {
  /** The injected dispatch instant (ISO 8601). */
  readonly at: string;
  /** The INJECTED gated boundary (the REAL destructive gate). */
  readonly boundary: GatedDestructiveBoundary;
  /** The INJECTED append-only audit sink (the REAL audit log at the binding site). */
  readonly auditSink?: ConfirmationAuditSink;
}

/**
 * Dispatch the EXPLICITLY confirmed intent through the gated boundary.
 * THE GATE: this transition REFUSES to proceed unless the state is
 * `ready_to_dispatch` — and `beginDestructiveConfirmation` ->
 * `markExplicitConfirmation` is the ONLY path there, requiring the
 * acknowledged consequences AND the exact typed phrase. A refusal
 * returns the machine-stable reason + explanation and leaves the state
 * UNCHANGED, the boundary UNTOUCHED, and NO audit entry written.
 *
 * On success the audit seam records BOTH the explicit confirmation and
 * the routed dispatch (the append-only evidence the flow happened),
 * and the returned state makes the boundary's own record visible.
 * PURE with respect to the injected seams (deterministic tests).
 */
export function dispatchConfirmedDestructive(
  state: DestructiveConfirmationState,
  options: DispatchConfirmedOptions,
): { readonly state: DestructiveConfirmationState; readonly refusal: ConfirmationRefusal | undefined } {
  // The gate: only an explicitly-confirmed review may proceed. The
  // `ready_to_dispatch` state is reachable ONLY through
  // markExplicitConfirmation (acknowledged + exact phrase) — there is
  // no other constructor.
  if (state.kind !== "ready_to_dispatch") {
    return { state, refusal: explicitConfirmationRefusal(state) };
  }
  if (typeof options?.at !== "string" || options.at.length === 0) {
    return { state, refusal: frozen({
      ok: false,
      reason: CONFIRMATION_REFUSALS.explicitConfirmationRequired,
      explanation: "The dispatch instant is missing — nothing was routed.",
    }) };
  }

  const context = state.context;
  const sink = options.auditSink ?? NOOP_CONFIRMATION_AUDIT_SINK;

  // The explicit confirmation's audit entry (consequential: the human
  // explicitly confirmed a destructive intent).
  sink.append({
    tenantId: context.tenantId,
    action: CONFIRMATION_AUDIT_ACTIONS.explicitConfirmation,
    subject: context.deviceId as string,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      caseId: context.caseId,
      by: context.by,
      phrase: requiredConfirmationPhrase(context),
      acknowledged: true,
    },
  });

  // The routed dispatch (the REAL gated boundary owns the rest).
  const result = options.boundary({
    tenantId: context.tenantId,
    deviceId: context.deviceId,
    caseId: context.caseId,
    action: context.action,
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
    action: CONFIRMATION_AUDIT_ACTIONS.dispatched,
    subject: context.deviceId as string,
    occurredAt: options.at,
    correlationId: context.correlationId,
    details: {
      action: context.action,
      caseId: context.caseId,
      by: context.by,
      requestId: result.record.requestId,
      status: result.record.status,
    },
  });

  return {
    state: frozen({
      kind: "dispatched",
      context,
      requestId: result.record.requestId,
      status: result.record.status,
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
export function confirmationFeedback(
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
        message: `Request ${state.requestId} recorded — status ${state.status}. The state change is visible below.`,
      };
    case "refused":
      return {
        status: "refused",
        message: `The boundary refused: ${state.reason} — ${state.explanation}`,
      };
    case "cancelled":
      return { status: "cancelled", message: "The confirmation was cancelled. Nothing was requested." };
  }
}
