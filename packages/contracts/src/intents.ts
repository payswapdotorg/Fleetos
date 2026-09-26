/**
 * @fleetos/contracts — Fleet Intents (durable requests) + lifecycle.
 *
 * User and system requests become durable Fleet Intents. Each intent is
 * versioned, idempotent and traceable from request through verified outcome
 * (per `spec/ARCHITECTURE.md` § Intent model and `spec/ARCHITECTURE-LOCK.md`
 * item 4).
 *
 * The nine durable intent kinds are taken verbatim from
 * `spec/ARCHITECTURE.md` § Intent model:
 *   MaintainDeviceIntent, SecurityRemediationIntent, ConnectivityIntent,
 *   ProcurementIntent, SoftwareSubscriptionIntent, ReplacementIntent,
 *   RecoveryIntent, PrintIntent, FleetActionIntent.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { IntentId, TenantId } from "./ids";
import type { TenantScoped } from "./tenant";

// ---------------------------------------------------------------------------
// Intent kinds (verbatim from spec/ARCHITECTURE.md § Intent model)
// ---------------------------------------------------------------------------

export const MAINTAIN_DEVICE_INTENT_KIND = "MaintainDeviceIntent" as const;
export const SECURITY_REMEDIATION_INTENT_KIND = "SecurityRemediationIntent" as const;
export const CONNECTIVITY_INTENT_KIND = "ConnectivityIntent" as const;
export const PROCUREMENT_INTENT_KIND = "ProcurementIntent" as const;
export const SOFTWARE_SUBSCRIPTION_INTENT_KIND = "SoftwareSubscriptionIntent" as const;
export const REPLACEMENT_INTENT_KIND = "ReplacementIntent" as const;
export const RECOVERY_INTENT_KIND = "RecoveryIntent" as const;
export const PRINT_INTENT_KIND = "PrintIntent" as const;
export const FLEET_ACTION_INTENT_KIND = "FleetActionIntent" as const;

/**
 * The string literal union of all nine durable intent kinds. Adding a new
 * intent kind requires a Tech-Lead ADR (`spec/worker-ownership.yaml` rule:
 * `shared_contract_changes_require_tech_lead`).
 */
export type IntentKind =
  | typeof MAINTAIN_DEVICE_INTENT_KIND
  | typeof SECURITY_REMEDIATION_INTENT_KIND
  | typeof CONNECTIVITY_INTENT_KIND
  | typeof PROCUREMENT_INTENT_KIND
  | typeof SOFTWARE_SUBSCRIPTION_INTENT_KIND
  | typeof REPLACEMENT_INTENT_KIND
  | typeof RECOVERY_INTENT_KIND
  | typeof PRINT_INTENT_KIND
  | typeof FLEET_ACTION_INTENT_KIND;

/**
 * The full set of intent kinds, useful for runtime iteration. Frozen so
 * callers cannot mutate it.
 */
export const ALL_INTENT_KINDS: readonly IntentKind[] = Object.freeze([
  MAINTAIN_DEVICE_INTENT_KIND,
  SECURITY_REMEDIATION_INTENT_KIND,
  CONNECTIVITY_INTENT_KIND,
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  RECOVERY_INTENT_KIND,
  PRINT_INTENT_KIND,
  FLEET_ACTION_INTENT_KIND,
]);

// ---------------------------------------------------------------------------
// Intent envelope
// ---------------------------------------------------------------------------

/**
 * The shared shape of every Fleet Intent. Each kind carries its own payload
 * (the discriminated union below); the envelope carries the cross-cutting
 * metadata: intent id, tenant scope, version, creation timestamp.
 *
 * Intents are durable: once created, they live until terminal state.
 */
export interface IntentEnvelope<P> extends TenantScoped {
  /** Unique intent identifier. */
  readonly intentId: IntentId;
  /** Tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Schema version of the intent payload (>= 1). */
  readonly version: number;
  /** ISO 8601 timestamp of intent creation. */
  readonly createdAt: string;
  /** The intent payload (kind-specific). */
  readonly payload: P;
}

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/**
 * Payload for `MaintainDeviceIntent`. Owned by `@fleetos/maintenance` (W042).
 * Placeholder shape — refined by the owning work item.
 */
export interface MaintainDeviceIntentPayload {
  readonly deviceId?: string;
  readonly description: string;
}

/** Payload for `SecurityRemediationIntent`. Owned by `@fleetos/security` (W031). */
export interface SecurityRemediationIntentPayload {
  readonly deviceId?: string;
  readonly findingId?: string;
  readonly description: string;
}

/** Payload for `ConnectivityIntent`. Owned by `@fleetos/integration-adcos` (W050A). */
export interface ConnectivityIntentPayload {
  readonly sourceDeviceId?: string;
  readonly targetDeviceId?: string;
  readonly outcome: string;
}

/** Payload for `ProcurementIntent`. Owned by `@fleetos/procurement` (W032). */
export interface ProcurementIntentPayload {
  readonly workloadId?: string;
  readonly description: string;
}

/** Payload for `SoftwareSubscriptionIntent`. Owned by `@fleetos/software` (W032). */
export interface SoftwareSubscriptionIntentPayload {
  readonly softwareId?: string;
  readonly seatCount: number;
}

/** Payload for `ReplacementIntent`. Owned by `@fleetos/recovery` (W040). */
export interface ReplacementIntentPayload {
  readonly deviceId?: string;
  readonly reason: string;
}

/** Payload for `RecoveryIntent`. Owned by `@fleetos/recovery` (W040). */
export interface RecoveryIntentPayload {
  readonly deviceId?: string;
  readonly action: "lock" | "locate" | "wipe" | "reboot";
}

/** Payload for `PrintIntent`. Owned by `@fleetos/actions` (W041). */
export interface PrintIntentPayload {
  readonly documentRef: string;
  readonly targetUserId?: string;
}

/** Payload for `FleetActionIntent`. Owned by `@fleetos/actions` (W041). */
export interface FleetActionIntentPayload {
  readonly actionPlanRef: string;
  readonly targetCount: number;
}

// ---------------------------------------------------------------------------
// Discriminated union of all nine intents
// ---------------------------------------------------------------------------

/**
 * Discriminated union of the nine durable Fleet Intents. The discriminant
 * is the `kind` field on the payload (each intent payload carries its
 * `kind` as a `readonly` string literal).
 *
 * Workers consume intents by switching on `kind`. Adding a new kind
 * requires updating this union AND the `ALL_INTENT_KINDS` array AND
 * `INTENT_LIFECYCLE` (an ADR-locked change).
 */
export type FleetIntent =
  | IntentEnvelope<MaintainDeviceIntentPayload & { readonly kind: typeof MAINTAIN_DEVICE_INTENT_KIND }>
  | IntentEnvelope<SecurityRemediationIntentPayload & { readonly kind: typeof SECURITY_REMEDIATION_INTENT_KIND }>
  | IntentEnvelope<ConnectivityIntentPayload & { readonly kind: typeof CONNECTIVITY_INTENT_KIND }>
  | IntentEnvelope<ProcurementIntentPayload & { readonly kind: typeof PROCUREMENT_INTENT_KIND }>
  | IntentEnvelope<SoftwareSubscriptionIntentPayload & { readonly kind: typeof SOFTWARE_SUBSCRIPTION_INTENT_KIND }>
  | IntentEnvelope<ReplacementIntentPayload & { readonly kind: typeof REPLACEMENT_INTENT_KIND }>
  | IntentEnvelope<RecoveryIntentPayload & { readonly kind: typeof RECOVERY_INTENT_KIND }>
  | IntentEnvelope<PrintIntentPayload & { readonly kind: typeof PRINT_INTENT_KIND }>
  | IntentEnvelope<FleetActionIntentPayload & { readonly kind: typeof FLEET_ACTION_INTENT_KIND }>;

// ---------------------------------------------------------------------------
// Intent status lifecycle
// ---------------------------------------------------------------------------

/**
 * The lifecycle of an intent. The exact sequence is documented in
 * `spec/ARCHITECTURE.md` § Intent model:
 *
 *   REQUESTED -> AUTHORIZED -> DISPATCHED -> EXECUTING -> VERIFIED -> COMPLETED
 *
 * plus terminal states:
 *   REJECTED | FAILED | CANCELLED
 *
 * A terminal state has no outgoing transitions. The non-terminal states
 * form a strict linear sequence (no skipping). The terminal states are
 * reachable from any non-terminal state except REQUESTED (REQUESTED may
 * only transition to AUTHORIZED or REJECTED).
 */
export const REQUESTED = "REQUESTED" as const;
export const AUTHORIZED = "AUTHORIZED" as const;
export const DISPATCHED = "DISPATCHED" as const;
export const EXECUTING = "EXECUTING" as const;
export const VERIFIED = "VERIFIED" as const;
export const COMPLETED = "COMPLETED" as const;
export const REJECTED = "REJECTED" as const;
export const FAILED = "FAILED" as const;
export const CANCELLED = "CANCELLED" as const;

export type IntentStatus =
  | typeof REQUESTED
  | typeof AUTHORIZED
  | typeof DISPATCHED
  | typeof EXECUTING
  | typeof VERIFIED
  | typeof COMPLETED
  | typeof REJECTED
  | typeof FAILED
  | typeof CANCELLED;

/**
 * The terminal intent statuses. Once an intent enters a terminal state,
 * it cannot transition further.
 */
export const TERMINAL_INTENT_STATUSES: readonly IntentStatus[] = Object.freeze([
  COMPLETED,
  REJECTED,
  FAILED,
  CANCELLED,
]);

/**
 * The non-terminal intent statuses, in their canonical linear order.
 */
export const NON_TERMINAL_INTENT_STATUSES: readonly IntentStatus[] = Object.freeze([
  REQUESTED,
  AUTHORIZED,
  DISPATCHED,
  EXECUTING,
  VERIFIED,
  COMPLETED,
]);

/**
 * The transition table. Each key is a "from" state; each value is the set
 * of states that may legally follow it.
 *
 * Rules:
 *   1. The happy-path sequence is REQUESTED -> AUTHORIZED -> DISPATCHED ->
 *      EXECUTING -> VERIFIED -> COMPLETED (a strict linear order).
 *   2. REQUESTED may also transition to REJECTED (policy refusal).
 *   3. AUTHORIZED, DISPATCHED, EXECUTING may transition to CANCELLED
 *      (operator or policy cancellation before completion).
 *   4. DISPATCHED, EXECUTING, VERIFIED may transition to FAILED (execution
 *      or verification failure). REQUESTED and AUTHORIZED may NOT — a
 *      request that fails authorization is REJECTED, not FAILED.
 *   5. Terminal states have no outgoing transitions.
 */
export const INTENT_TRANSITIONS: Readonly<Record<IntentStatus, readonly IntentStatus[]>> = Object.freeze({
  [REQUESTED]: Object.freeze([AUTHORIZED, REJECTED]),
  [AUTHORIZED]: Object.freeze([DISPATCHED, CANCELLED]),
  [DISPATCHED]: Object.freeze([EXECUTING, CANCELLED, FAILED]),
  [EXECUTING]: Object.freeze([VERIFIED, CANCELLED, FAILED]),
  [VERIFIED]: Object.freeze([COMPLETED, FAILED]),
  [COMPLETED]: Object.freeze([]),
  [REJECTED]: Object.freeze([]),
  [FAILED]: Object.freeze([]),
  [CANCELLED]: Object.freeze([]),
});

/**
 * Pure transition predicate. Returns true if `from -> to` is a legal
 * transition per `INTENT_TRANSITIONS`. Returns false otherwise.
 *
 * @param from the current status
 * @param to the proposed next status
 * @returns true if the transition is legal
 */
export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  const allowed = INTENT_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Pure helper: is `status` terminal?
 *
 * @param status the status to test
 * @returns true if `status` is terminal (no outgoing transitions)
 */
export function isTerminalIntentStatus(status: IntentStatus): boolean {
  return TERMINAL_INTENT_STATUSES.includes(status);
}
