/**
 * @fleetos/web-actions — the Guardian decision context projection.
 *
 * Both action surfaces (plan presentation, print routing) link the
 * Guardian decision that gated the flow. This module validates the
 * structural decision record and projects the OBSERVABLE context:
 * decision type, blocking flag, the rules that fired, the OPAQUE
 * evidence refs, the instant. Nothing else — LOCK 11: the surface
 * never asserts unobservable intent.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  isNonEmptyString,
  isPlainObject,
  isPositiveInteger,
  looksLikeIso,
} from "./internal";
import type { SurfaceValidationFailure } from "./internal";
import type {
  GuardianDecisionRecord,
  SurfaceDecisionType,
} from "./surface-contracts";
import {
  ALL_SURFACE_DECISION_TYPES,
  DECISION_PRECEDENCE_RANK_VIEW,
} from "./surface-contracts";

/**
 * Is the decision type blocking? REQUIRE_APPROVAL holds the action for
 * human approval; BLOCK refuses it outright (the frozen contracts
 * `BLOCKING_DECISION_TYPES` semantics — the binding test proves
 * equivalence with the real helper).
 */
export function isBlockingDecisionView(decision: SurfaceDecisionType): boolean {
  return decision === "REQUIRE_APPROVAL" || decision === "BLOCK";
}

export { DECISION_PRECEDENCE_RANK_VIEW };

/** The observable decision context linked to a gated flow. */
export interface GuardianDecisionContextView {
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: SurfaceDecisionType;
  /** Whether the decision blocks immediate execution. */
  readonly isBlocking: boolean;
  /** The machine-stable precedence rank. */
  readonly precedenceRank: number;
  /** ISO 8601 decision instant (verbatim). */
  readonly decidedAt: string;
  /** The decision record's schema version (verbatim). */
  readonly schemaVersion: number;
  /** The rule refs that fired (verbatim). */
  readonly rules: GuardianDecisionRecord["rules"];
  /** OPAQUE evidence refs (verbatim). */
  readonly evidence: GuardianDecisionRecord["evidence"];
}

/**
 * Validate a structural Guardian decision record at the given path
 * prefix (machine-stable failures).
 */
export function validateDecisionRecord(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  const decision = candidate["decision"];
  if (
    typeof decision !== "string" ||
    !(ALL_SURFACE_DECISION_TYPES as readonly string[]).includes(decision)
  ) {
    failures.push({ path: `${path}/decision`, reason: "unknown_decision" });
  }
  if (!looksLikeIso(String(candidate["decidedAt"] ?? ""))) {
    failures.push({ path: `${path}/decidedAt`, reason: "not_iso" });
  }
  if (!isPositiveInteger(candidate["schemaVersion"])) {
    failures.push({ path: `${path}/schemaVersion`, reason: "positive_integer_required" });
  }
  const rules = candidate["rules"];
  if (!Array.isArray(rules)) {
    failures.push({ path: `${path}/rules`, reason: "array_required" });
  } else {
    for (let i = 0; i < rules.length; i++) {
      const ref = rules[i];
      if (
        !isPlainObject(ref) ||
        !isNonEmptyString(ref["ruleId"]) ||
        !isPositiveInteger(ref["ruleVersion"])
      ) {
        failures.push({ path: `${path}/rules/${i}`, reason: "rule_ref_invalid" });
      }
    }
  }
  const evidence = candidate["evidence"];
  if (!Array.isArray(evidence)) {
    failures.push({ path: `${path}/evidence`, reason: "array_required" });
  } else {
    for (let i = 0; i < evidence.length; i++) {
      const ref = evidence[i];
      const refPath = `${path}/evidence/${i}`;
      if (!isPlainObject(ref)) {
        failures.push({ path: refPath, reason: "object_required" });
        continue;
      }
      if (!isNonEmptyString(ref["key"])) {
        failures.push({ path: `${refPath}/key`, reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(ref["hash"])) {
        failures.push({ path: `${refPath}/hash`, reason: "non_empty_string_required" });
      }
      if (!isNonEmptyString(ref["hashAlgorithm"])) {
        failures.push({ path: `${refPath}/hashAlgorithm`, reason: "non_empty_string_required" });
      }
      if (
        typeof ref["sizeBytes"] !== "number" ||
        !Number.isInteger(ref["sizeBytes"]) ||
        (ref["sizeBytes"] as number) < 0
      ) {
        failures.push({ path: `${refPath}/sizeBytes`, reason: "non_negative_integer_required" });
      }
    }
  }
}

/**
 * Project a validated decision record to the observable context view.
 * The record must already be validated (the builders validate first);
 * the projection is pure and frozen.
 */
export function projectDecisionContext(
  decision: GuardianDecisionRecord,
): GuardianDecisionContextView {
  const decisionType = decision.decision;
  return Object.freeze({
    decision: decisionType,
    isBlocking: isBlockingDecisionView(decisionType),
    precedenceRank: DECISION_PRECEDENCE_RANK_VIEW[decisionType],
    decidedAt: decision.decidedAt,
    schemaVersion: decision.schemaVersion,
    rules: Object.freeze([...decision.rules]),
    evidence: Object.freeze([...decision.evidence]),
  } satisfies GuardianDecisionContextView);
}
