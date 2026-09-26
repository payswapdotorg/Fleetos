/**
 * @fleetos/contracts — Contract Guardian decision contract.
 *
 * The Contract Guardian enforces explicit policy and never asserts
 * unobservable employee intent (`spec/ARCHITECTURE-LOCK.md` item 11).
 *
 * Rules evaluate principal, device, workload, data classification,
 * contract/obligation, destination, network, printer, time/geography and
 * action (`spec/ARCHITECTURE.md` § Contract Guardian). The decision
 * types are: ALLOW, WARN, REQUIRE_APPROVAL, BLOCK.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { PolicyId, TenantId } from "./ids";
import type { TenantScoped } from "./tenant";

// ---------------------------------------------------------------------------
// Decision types (verbatim from spec/ARCHITECTURE.md § Contract Guardian)
// ---------------------------------------------------------------------------

export const ALLOW = "ALLOW" as const;
export const WARN = "WARN" as const;
export const REQUIRE_APPROVAL = "REQUIRE_APPROVAL" as const;
export const BLOCK = "BLOCK" as const;

/**
 * The Contract Guardian decision type.
 *
 * Semantics:
 *   - `ALLOW`: the action is permitted; proceed without escalation.
 *   - `WARN`: the action is permitted but a warning is recorded; surface
 *     the warning to the operator.
 *   - `REQUIRE_APPROVAL`: the action requires explicit human approval
 *     before it may proceed. The system MUST hold the action until
 *     approval is granted or denied (or expires).
 *   - `BLOCK`: the action is forbidden. The system MUST refuse the action
 *     and record an audit entry.
 */
export type GuardianDecisionType =
  | typeof ALLOW
  | typeof WARN
  | typeof REQUIRE_APPROVAL
  | typeof BLOCK;

/**
 * The full set of decision types, for runtime iteration and manifest
 * validation.
 */
export const ALL_GUARDIAN_DECISION_TYPES: readonly GuardianDecisionType[] = Object.freeze([
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
]);

/**
 * The set of decision types that prevent an action from executing
 * immediately. A `REQUIRE_APPROVAL` or `BLOCK` decision MUST cause the
 * caller to hold or refuse the action.
 */
export const BLOCKING_DECISION_TYPES: readonly GuardianDecisionType[] = Object.freeze([
  REQUIRE_APPROVAL,
  BLOCK,
]);

// ---------------------------------------------------------------------------
// Guardian decision result shape
// ---------------------------------------------------------------------------

/**
 * A reference to an evidence artifact. Evidence is stored in object
 * storage (per `spec/ARCHITECTURE.md` § Storage) and referenced by an
 * opaque content-addressable key. The control plane never interprets
 * the contents of an evidence artifact — it only records that the artifact
 * exists and was used to support a decision.
 */
export interface EvidenceRef {
  /** The object-storage key (content-addressable). */
  readonly key: string;
  /** The size of the artifact in bytes. */
  readonly sizeBytes: number;
  /** The cryptographic hash of the artifact (e.g., sha256 hex). */
  readonly hash: string;
  /** The hash algorithm used (e.g., "sha256"). */
  readonly hashAlgorithm: string;
}

/**
 * A reference to a Contract Guardian rule that fired during evaluation.
 * Rules are versioned; the `ruleVersion` field records the version of the
 * rule at evaluation time so that subsequent rule edits do not invalidate
 * the audit trail.
 */
export interface RuleRef {
  /** The rule identifier. */
  readonly ruleId: PolicyId;
  /** The rule version at evaluation time. */
  readonly ruleVersion: number;
}

/**
 * The result of a Contract Guardian evaluation. Every consequential action
 * (`spec/ARCHITECTURE-LOCK.md` item 4) MUST carry a `GuardianDecision`
 * in its audit record. The decision is immutable once recorded.
 */
export interface GuardianDecision extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: GuardianDecisionType;
  /** The rules that fired during evaluation. May be empty (no rule matched). */
  readonly rules: readonly RuleRef[];
  /** Evidence artifacts supporting the decision. May be empty. */
  readonly evidence: readonly EvidenceRef[];
  /** ISO 8601 timestamp of when the decision was made. */
  readonly decidedAt: string;
  /** Schema version of this decision record. */
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pure helper: is the given decision type blocking? A blocking decision
 * prevents the action from executing immediately (either holds for
 * approval or refuses outright).
 *
 * @param decision the decision type to test
 * @returns true if the decision is blocking
 */
export function isBlockingDecision(decision: GuardianDecisionType): boolean {
  return BLOCKING_DECISION_TYPES.includes(decision);
}

/**
 * Pure helper: construct a `GuardianDecision`. Returns a frozen record;
 * does NOT throw on malformed input. Use `validateGuardianDecision()` to
 * enforce invariants at boundary crossings.
 *
 * @param input the decision inputs
 * @returns a frozen guardian decision
 */
export function makeGuardianDecision(input: Omit<GuardianDecision, never>): GuardianDecision {
  return Object.freeze({
    tenantId: input.tenantId,
    decision: input.decision,
    rules: Object.freeze([...input.rules]),
    evidence: Object.freeze([...input.evidence]),
    decidedAt: input.decidedAt,
    schemaVersion: input.schemaVersion,
  });
}
