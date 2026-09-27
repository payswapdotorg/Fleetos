/**
 * @fleetos/recovery — D3a: the injected Contract Guardian evaluation seam.
 *
 * The `recovery -> policy` routing boundary. Per the W040 work order, a
 * recovery case may request a destructive action ONLY as a proposal
 * routed through the W031 Contract Guardian —
 * `evaluateGuardianRequest` from `@fleetos/policy`. `@fleetos/policy` is
 * worker-b's lane; the ownership gate forbids importing it from this
 * lane-A package (`tools/check-ownership.mjs`: only `@fleetos/contracts`
 * may cross lanes), so — exactly like the audit edge (the
 * W011/W021/W022/W031/W041 injected-sink pattern, structurally satisfied
 * by `@fleetos/audit`'s sink adapter and proven by test) — the Guardian
 * routing is honored through a STRUCTURAL seam declared here:
 *
 *   - `GuardianEvaluateFn<R>` — the evaluation function type the
 *     destructive gate calls. `@fleetos/policy`'s
 *     `evaluateGuardianRequest` satisfies it STRUCTURALLY (TypeScript
 *     structural typing: the seam's request/options parameter types are
 *     subtypes of the engine's, and the engine's return type is a
 *     subtype of the seam's outcome). The binding site injects the REAL
 *     engine + its compiled rule set; this package's test suite proves
 *     the routing end-to-end through the real Guardian (ALLOW / WARN /
 *     REQUIRE_APPROVAL / BLOCK) — never a local re-implementation, never
 *     a mock of the decision logic.
 *   - `RecoveryGuardianRequest` — the request facets recovery builds:
 *     a structural subtype of the engine's `GuardianRequestContext`
 *     (every facet an OBSERVABLE fact; no intent inference,
 *     ARCHITECTURE-LOCK item 11).
 *   - `RecoveryGuardianOutcome` — the widened evaluation outcome: the
 *     FROZEN `GuardianDecision` from `@fleetos/contracts` (the decision
 *     types ALLOW/WARN/REQUIRE_APPROVAL/BLOCK are reused, never
 *     re-declared) plus the rule-set identity, the matched-rule refs and
 *     the machine-stable evaluation reasons.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  DeviceId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  GuardianDecisionType,
  TenantId,
  UserId,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The request facets (structural subtypes of the engine's rule inputs)
// ---------------------------------------------------------------------------

/**
 * The observable device ownership models — a STRUCTURAL twin of the
 * policy rule model's `DeviceOwnership` (the closed union the Guardian's
 * device condition matches on). Declared locally because the ownership
 * gate forbids importing `@fleetos/policy` from this lane; the literal
 * union is structurally identical, so a real policy rule-input value
 * flows through this seam unchanged.
 */
export type RecoveryGuardianOwnership =
  | "corporate"
  | "leased"
  | "customer-owned"
  | "third-party-supplied"
  | "byod";

/**
 * The device's security-posture summary as a Guardian rule input — a
 * STRUCTURAL twin of the policy rule model's `GuardianDevicePosture`
 * (which `@fleetos/security`'s `deriveGuardianDevicePosture` produces at
 * the binding site). Counts and the status pass through verbatim; never
 * an intent inference.
 */
export interface RecoveryGuardianPosture {
  readonly status: "HEALTHY" | "DEGRADED" | "AT_RISK" | "CRITICAL";
  readonly criticalFindings: number;
  readonly highFindings: number;
  readonly mediumFindings: number;
  readonly lowFindings: number;
  readonly assessedAt: string;
}

/** The acting principal facet (observable identity facts). */
export interface RecoveryGuardianPrincipal {
  /** The authenticated user, when the action is user-initiated (branded id from the frozen contracts). */
  readonly userId?: UserId;
  readonly role?: string;
  readonly department?: string;
  readonly isServicePrincipal?: boolean;
}

/** The device facet (observable device facts + posture summary). */
export interface RecoveryGuardianDevice {
  readonly deviceId: DeviceId;
  readonly platform?: string;
  readonly ownership?: RecoveryGuardianOwnership;
  readonly posture?: RecoveryGuardianPosture;
}

/** The action facet — the required facet of every evaluation. */
export interface RecoveryGuardianAction {
  /** The action kind (open string union, e.g. "device.lock"). */
  readonly action: string;
  /** The kind of entity the action targets, when applicable. */
  readonly targetKind?: string;
}

/**
 * The Guardian evaluation request recovery builds. A STRUCTURAL subtype
 * of the engine's `GuardianRequestContext`: only the facets recovery
 * populates are declared (the engine's remaining facets are optional and
 * therefore satisfied by omission). Every facet is an observable fact.
 */
export interface RecoveryGuardianRequest {
  readonly tenantId: TenantId;
  readonly action: RecoveryGuardianAction;
  readonly principal?: RecoveryGuardianPrincipal;
  readonly device?: RecoveryGuardianDevice;
  /** Observable evidence artifacts supporting the request's facts. */
  readonly evidence?: readonly EvidenceRef[];
}

/** The injected evaluation options (a structural subtype of the engine's). */
export interface RecoveryGuardianOptions {
  /** The injected decision instant (ISO 8601) — becomes the decision's `decidedAt`. */
  readonly at: string;
  /** The correlation id of the request being evaluated. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the evaluation is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

// ---------------------------------------------------------------------------
// The widened evaluation outcome (the engine's return is a subtype)
// ---------------------------------------------------------------------------

/** A matched-rule reference (widened: the engine's `GuardianRule` is assignable). */
export interface RecoveryMatchedRuleRef {
  /** The rule's stable id. */
  readonly ruleId: string;
  /** The rule's version at evaluation time. */
  readonly version: number;
}

/** A machine-stable evaluation reason (widened: the engine's `GuardianReason` is assignable). */
export interface RecoveryEvaluationReason {
  readonly code: string;
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  readonly conditionKind?: string;
  readonly effect?: GuardianDecisionType;
  readonly chosen?: GuardianDecisionType;
}

/** The evaluation result the destructive gate consumes. */
export interface RecoveryGuardianEvaluation {
  /** The FROZEN `GuardianDecision` from `@fleetos/contracts` (built by the real engine). */
  readonly decision: GuardianDecision;
  /** The rule set that was evaluated. */
  readonly ruleSetId: string;
  /** The rule set's version (the policy version of the decision). */
  readonly ruleSetVersion: number;
  /** The rules that fired (widened refs). */
  readonly matchedRules: readonly RecoveryMatchedRuleRef[];
  /** Machine-stable reasons (widened). */
  readonly reasons: readonly RecoveryEvaluationReason[];
}

/** The tagged outcome of a Guardian evaluation (widened). */
export type RecoveryGuardianOutcome =
  | { readonly ok: true; readonly evaluation: RecoveryGuardianEvaluation }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The injected Contract Guardian evaluation function — THE routing
 * boundary for destructive recovery actions. Generic over the rule-set
 * type `R` (the binding site chooses the real compiled
 * `GuardianRuleSet`; this package never re-declares the rule model).
 *
 * `@fleetos/policy`'s `evaluateGuardianRequest` satisfies this type
 * STRUCTURALLY: its parameters accept the seam's request/options
 * (subtypes of the engine's), and its return type is a subtype of the
 * seam's outcome. Proven by test: the destructive gate runs end-to-end
 * against the real engine injected at the binding site.
 */
export type GuardianEvaluateFn<R> = (
  ruleSet: R,
  request: RecoveryGuardianRequest,
  options: RecoveryGuardianOptions,
) => RecoveryGuardianOutcome;
