/**
 * @fleetos/integration-arena — D1a: the injected Contract Guardian
 * evaluation seam.
 *
 * Per `spec/integration/ARENA.md` + `spec/ARCHITECTURE-LOCK.md` item 9:
 * "Arena owns capability learning/certification; FleetOS owns operational
 * adoption" and the ARENA.md invariant: "FleetOS never treats an
 * uncertified model output as action permission." Per the W050B work
 * order: evaluation-case submission is PROPOSAL-gated through the W031
 * Guardian decision model — the seam is typed against the FROZEN
 * `GuardianDecision` from `@fleetos/contracts`. REQUIRE_APPROVAL parks,
 * BLOCK rejects, never auto-submit.
 *
 * The `arena -> policy` routing boundary. `@fleetos/policy` is worker-b's
 * lane (same lane as arena); the ownership gate ALLOWS the direct import.
 * The seam is still declared LOCALLY in this integration package because:
 *   1. Integration packages are PROVIDER-NEUTRAL by spec — they MUST
 *      honor the module-map edges through STRUCTURAL shapes typed
 *      against frozen contracts (the W040-disclosed pattern, here
 *      applied within lane B as the integration-package discipline).
 *   2. `GuardianEvaluateFn<R>` — the evaluation function type the
 *      submission gate calls. `@fleetos/policy`'s
 *      `evaluateGuardianRequest` satisfies it STRUCTURALLY (TypeScript
 *      structural typing: the seam's request/options parameter types are
 *      subtypes of the engine's, and the engine's return type is a
 *      subtype of the seam's outcome). The binding site injects the
 *      REAL engine + its compiled rule set; this package's test suite
 *      proves the routing end-to-end through the real Guardian
 *      (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK) — never a local
 *      re-implementation, never a mock of the decision logic.
 *   3. `ArenaGuardianRequest` — the request facets arena builds: a
 *      structural subtype of the engine's `GuardianRequestContext`
 *      (every facet an OBSERVABLE fact; no intent inference,
 *      ARCHITECTURE-LOCK item 11).
 *   4. `ArenaGuardianOutcome` — the widened evaluation outcome: the
 *      FROZEN `GuardianDecision` from `@fleetos/contracts` (the decision
 *      types ALLOW/WARN/REQUIRE_APPROVAL/BLOCK are reused, never
 *      re-declared) plus the rule-set identity, the matched-rule refs
 *      and the machine-stable evaluation reasons.
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
 * device condition matches on). Declared locally because integration
 * packages honor the routing boundary through structural shapes; the
 * literal union is structurally identical, so a real policy rule-input
 * value flows through this seam unchanged.
 */
export type ArenaGuardianOwnership =
  | "corporate"
  | "leased"
  | "customer-owned"
  | "third-party-supplied"
  | "byod";

/**
 * The acting principal facet (observable identity facts).
 */
export interface ArenaGuardianPrincipal {
  /** The authenticated user, when the submission is user-initiated (branded id from the frozen contracts). */
  readonly userId?: UserId;
  readonly role?: string;
  readonly department?: string;
  readonly isServicePrincipal?: boolean;
}

/**
 * The action facet — the required facet of every evaluation. For an
 * evaluation-case submission, the action is `arena.case.submit` (or
 * `arena.capability.adopt` for adoption). The target kind is the
 * capability class (open string union, e.g. "device.health.battery_aging").
 */
export interface ArenaGuardianAction {
  /** The action kind (open string union, e.g. "arena.case.submit"). */
  readonly action: string;
  /** The kind of entity the action targets, when applicable. */
  readonly targetKind?: string;
}

/** The device facet (observable device facts — never an inferred intent). */
export interface ArenaGuardianDevice {
  readonly deviceId: DeviceId;
  readonly platform?: string;
  readonly ownership?: ArenaGuardianOwnership;
}

/**
 * The Guardian evaluation request arena builds. A STRUCTURAL subtype of
 * the engine's `GuardianRequestContext`: only the facets arena populates
 * are declared (the engine's remaining facets are optional and therefore
 * satisfied by omission). Every facet is an observable fact.
 */
export interface ArenaGuardianRequest {
  readonly tenantId: TenantId;
  readonly action: ArenaGuardianAction;
  readonly principal?: ArenaGuardianPrincipal;
  readonly device?: ArenaGuardianDevice;
  /** Observable evidence artifacts supporting the request's facts. */
  readonly evidence?: readonly EvidenceRef[];
}

/** The injected evaluation options (a structural subtype of the engine's). */
export interface ArenaGuardianOptions {
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
export interface ArenaMatchedRuleRef {
  /** The rule's stable id. */
  readonly ruleId: string;
  /** The rule's version at evaluation time. */
  readonly version: number;
}

/** A machine-stable evaluation reason (widened: the engine's `GuardianReason` is assignable). */
export interface ArenaEvaluationReason {
  readonly code: string;
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  readonly conditionKind?: string;
  readonly effect?: GuardianDecisionType;
  readonly chosen?: GuardianDecisionType;
}

/** The evaluation result the submission gate consumes. */
export interface ArenaGuardianEvaluation {
  /** The FROZEN `GuardianDecision` from `@fleetos/contracts` (built by the real engine). */
  readonly decision: GuardianDecision;
  /** The rule set that was evaluated. */
  readonly ruleSetId: string;
  /** The rule set's version (the policy version of the decision). */
  readonly ruleSetVersion: number;
  /** The rules that fired (widened refs). */
  readonly matchedRules: readonly ArenaMatchedRuleRef[];
  /** Machine-stable reasons (widened). */
  readonly reasons: readonly ArenaEvaluationReason[];
}

/** The tagged outcome of a Guardian evaluation (widened). */
export type ArenaGuardianOutcome =
  | { readonly ok: true; readonly evaluation: ArenaGuardianEvaluation }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The injected Contract Guardian evaluation function — THE routing
 * boundary for evaluation-case submission (D1). Generic over the rule-set
 * type `R` (the binding site chooses the real compiled
 * `GuardianRuleSet`; this package never re-declares the rule model).
 *
 * `@fleetos/policy`'s `evaluateGuardianRequest` satisfies this type
 * STRUCTURALLY: its parameters accept the seam's request/options
 * (subtypes of the engine's), and its return type is a subtype of the
 * seam's outcome. Proven by test: the submission gate runs end-to-end
 * against the real engine injected at the binding site.
 *
 * ARENA.md invariant enforcement: the seam's outcome is a FROZEN
 * `GuardianDecision` (never raw model output). The submission gate never
 * turns this decision into an action/permission surface — it only
 * records the case as SUBMITTED (ALLOW/WARN), PARKED
 * (REQUIRE_APPROVAL), or REJECTED (BLOCK).
 */
export type GuardianEvaluateFn<R> = (
  ruleSet: R,
  request: ArenaGuardianRequest,
  options: ArenaGuardianOptions,
) => ArenaGuardianOutcome;
