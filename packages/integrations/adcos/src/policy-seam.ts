/**
 * @fleetos/integration-adcos — D3a: the injected Contract Guardian
 * evaluation seam.
 *
 * The `adcos -> policy` routing boundary. Per the W050A work order,
 * submitting a connectivity request with consequential properties
 * (budget, duration, security-relevant constraints) is PROPOSAL-gated
 * through the W031 Contract Guardian decision model —
 * `evaluateGuardianRequest` from `@fleetos/policy`. `@fleetos/policy` is
 * worker-b's lane; the ownership gate forbids importing it from this
 * lane-A package (`tools/check-ownership.mjs`: only `@fleetos/contracts`
 * may cross lanes), so — exactly like the W040 recovery gate and the
 * audit edge (the W011/W021/W022/W031/W041 injected-sink pattern) — the
 * Guardian routing is honored through a STRUCTURAL seam declared here:
 *
 *   - `AdcosGuardianEvaluateFn<R>` — the evaluation function type the
 *     submission gate calls. `@fleetos/policy`'s
 *     `evaluateGuardianRequest` satisfies it STRUCTURALLY (TypeScript
 *     structural typing: the seam's request/options parameter types are
 *     subtypes of the engine's, and the engine's return type is a
 *     subtype of the seam's outcome). The binding site injects the REAL
 *     engine + its compiled rule set; this package's test suite proves
 *     the routing end-to-end through the real Guardian (ALLOW / WARN /
 *     REQUIRE_APPROVAL / BLOCK) — never a local re-implementation, never
 *     a mock of the decision logic.
 *   - `AdcosGuardianRequest` — the request facets the submission gate
 *     builds: a structural subtype of the engine's
 *     `GuardianRequestContext` (every facet an OBSERVABLE fact; no
 *     intent inference, ARCHITECTURE-LOCK item 11). The gate evaluates
 *     EVERY submission uniformly (fail-closed policy authority): the
 *     consequential properties ride the submission record + audit trail,
 *     while the engine-matchable facets (action, tenant, device,
 *     workload, network zone, time, evidence) are carried here.
 *   - `AdcosGuardianOutcome` — the widened evaluation outcome: the
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
  WorkloadId,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The request facets (structural subtypes of the engine's rule inputs)
// ---------------------------------------------------------------------------

/**
 * The network-zone facet — a STRUCTURAL twin of the policy rule model's
 * `NetworkZone` (the closed union the Guardian's network condition
 * matches on). Declared locally because the ownership gate forbids
 * importing `@fleetos/policy` from this lane; the literal union is
 * structurally identical, so a real policy rule-input value flows
 * through this seam unchanged.
 */
export type AdcosGuardianNetworkZone =
  | "corporate"
  | "vpn"
  | "trusted-partner"
  | "public"
  | "unknown";

/**
 * The data-classification facet — a STRUCTURAL twin of the policy rule
 * model's `DataClassification` (the closed union the workload condition
 * matches on).
 */
export type AdcosGuardianDataClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

/** The acting principal facet (observable identity facts). */
export interface AdcosGuardianPrincipal {
  /** The authenticated user, when the submission is user-initiated. */
  readonly userId?: UserId;
  readonly role?: string;
  readonly department?: string;
  readonly isServicePrincipal?: boolean;
}

/** The device facet (the connectivity request's device ref, verbatim). */
export interface AdcosGuardianDevice {
  readonly deviceId: DeviceId;
  readonly platform?: string;
}

/** The workload facet (the connectivity request's workload ref, verbatim). */
export interface AdcosGuardianWorkload {
  readonly workloadId: WorkloadId;
  readonly classification?: AdcosGuardianDataClassification;
}

/** The action facet — the required facet of every evaluation. */
export interface AdcosGuardianAction {
  /** The action kind (the lane-local submission action constant). */
  readonly action: string;
  /** The kind of entity the action targets. */
  readonly targetKind?: string;
}

/**
 * The Guardian evaluation request the submission gate builds. A
 * STRUCTURAL subtype of the engine's `GuardianRequestContext`: only the
 * facets the gate populates are declared (the engine's remaining facets
 * are optional and therefore satisfied by omission). Every facet is an
 * observable fact.
 */
export interface AdcosGuardianRequest {
  readonly tenantId: TenantId;
  readonly action: AdcosGuardianAction;
  readonly principal?: AdcosGuardianPrincipal;
  readonly device?: AdcosGuardianDevice;
  readonly workload?: AdcosGuardianWorkload;
  /** The network zone the connectivity is requested for, when known. */
  readonly network?: { readonly zone?: AdcosGuardianNetworkZone };
  /** The requested-action instant (the request's duration.startAt). */
  readonly time?: { readonly at: string };
  /** Observable evidence artifacts supporting the request's facts. */
  readonly evidence?: readonly EvidenceRef[];
}

/** The injected evaluation options (a structural subtype of the engine's). */
export interface AdcosGuardianOptions {
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
export interface AdcosMatchedRuleRef {
  /** The rule's stable id. */
  readonly ruleId: string;
  /** The rule's version at evaluation time. */
  readonly version: number;
}

/** A machine-stable evaluation reason (widened: the engine's `GuardianReason` is assignable). */
export interface AdcosEvaluationReason {
  readonly code: string;
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  readonly conditionKind?: string;
  readonly effect?: GuardianDecisionType;
  readonly chosen?: GuardianDecisionType;
}

/** The evaluation result the submission gate consumes. */
export interface AdcosGuardianEvaluation {
  /** The FROZEN `GuardianDecision` from `@fleetos/contracts` (built by the real engine). */
  readonly decision: GuardianDecision;
  /** The rule set that was evaluated. */
  readonly ruleSetId: string;
  /** The rule set's version (the policy version of the decision). */
  readonly ruleSetVersion: number;
  /** The rules that fired (widened refs). */
  readonly matchedRules: readonly AdcosMatchedRuleRef[];
  /** Machine-stable reasons (widened). */
  readonly reasons: readonly AdcosEvaluationReason[];
}

/** The tagged outcome of a Guardian evaluation (widened). */
export type AdcosGuardianOutcome =
  | { readonly ok: true; readonly evaluation: AdcosGuardianEvaluation }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The injected Contract Guardian evaluation function — THE routing
 * boundary for ADCOS connectivity submissions. Generic over the rule-set
 * type `R` (the binding site chooses the real compiled
 * `GuardianRuleSet`; this package never re-declares the rule model).
 *
 * `@fleetos/policy`'s `evaluateGuardianRequest` satisfies this type
 * STRUCTURALLY: its parameters accept the seam's request/options
 * (subtypes of the engine's), and its return type is a subtype of the
 * seam's outcome. Proven by test: the submission gate runs end-to-end
 * against the real engine injected at the binding site.
 */
export type AdcosGuardianEvaluateFn<R> = (
  ruleSet: R,
  request: AdcosGuardianRequest,
  options: AdcosGuardianOptions,
) => AdcosGuardianOutcome;

// ---------------------------------------------------------------------------
// The lane-local submission action vocabulary
// ---------------------------------------------------------------------------

/**
 * The stable machine action kind for every ADCOS connectivity
 * submission evaluation (the engine's action-condition `in` set matches
 * on this). Judgment call (disclosed): ONE uniform action kind — the
 * gate evaluates EVERY submission (fail-closed policy authority), and
 * the request's consequential profile rides the submission record + its
 * audit trail rather than fragmenting the action space.
 */
export const ADCOS_SUBMISSION_ACTION = "connectivity.request" as const;

/** The target kind for the action facet. */
export const ADCOS_SUBMISSION_TARGET_KIND = "connectivity" as const;
