/**
 * @fleetos/policy — D3: the Contract Guardian evaluation engine.
 *
 * Deterministic evaluation of a `GuardianRequestContext` against a
 * `GuardianRuleSet`, producing the FROZEN `GuardianDecision` shape from
 * `@fleetos/contracts` (built via the frozen `makeGuardianDecision`
 * constructor; the decision types ALLOW / WARN / REQUIRE_APPROVAL / BLOCK
 * are reused, never re-declared).
 *
 * Determinism guarantees (proven by test):
 *   - PURE evaluation: every input is injected (rule set, request,
 *     decision instant, correlation id) — no clock reads, no entropy,
 *     no environment;
 *   - BLOCKING PRECEDENCE resolved deterministically:
 *     BLOCK > REQUIRE_APPROVAL > WARN > ALLOW. When multiple rules fire,
 *     the most severe effect wins; ties and orderings never depend on
 *     rule-set insertion order (rule sets are compiled in ruleId order);
 *   - machine-stable reasons: enumerated `GuardianReason` records with
 *     stable `code` strings — no free text, no localization;
 *   - observable-evidence links: the request's evidence artifacts are
 *     linked into the decision untouched (the control plane never
 *     interprets evidence contents, per the frozen contract);
 *   - no inferred intent: the request facets are observable facts; the
 *     engine's outputs never assert an employee's intent
 *     (`spec/ARCHITECTURE-LOCK.md` item 11).
 *
 * Audit (D4): a consequential decision — BLOCK or REQUIRE_APPROVAL (the
 * decision types that hold or refuse an action) — emits an append-only
 * audit record to the INJECTED sink. ALLOW/WARN decisions do not audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { makeGuardianDecision } from "@fleetos/contracts";
import type {
  CausationId,
  CorrelationId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  GuardianDecisionType,
  RuleRef,
  TenantId,
} from "@fleetos/contracts";
import { BLOCK, ALLOW, BLOCKING_DECISION_TYPES, REQUIRE_APPROVAL, WARN, isBlockingDecision } from "@fleetos/contracts";
import type { PolicyAuditSink } from "./audit-seam";
import { POLICY_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  POLICY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
  parseIsoMs,
} from "./internal";
import type {
  GuardianDeviceFacet,
  GuardianPrincipalFacet,
  GuardianRequestContext,
  GuardianRule,
  GuardianRuleCondition,
  GuardianRuleSet,
  StringSetMatcher,
} from "./rule-model";
import { GUARDIAN_POSTURE_STATUS_RANK, UNCLASSIFIED } from "./rule-model";

// ---------------------------------------------------------------------------
// The decision schema version this engine emits
// ---------------------------------------------------------------------------

/**
 * The `schemaVersion` stamped on every `GuardianDecision` this engine
 * produces. Version 1 — the frozen shape as-is.
 */
export const GUARDIAN_DECISION_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Blocking precedence (BLOCK > REQUIRE_APPROVAL > WARN > ALLOW)
// ---------------------------------------------------------------------------

/**
 * The deterministic precedence rank of each decision type. Higher wins:
 * BLOCK(3) > REQUIRE_APPROVAL(2) > WARN(1) > ALLOW(0). Mirrors the work
 * order's blocking precedence; expressed as an explicit frozen table so
 * precedence is data, not control flow.
 */
export const DECISION_PRECEDENCE_RANK: Readonly<Record<GuardianDecisionType, number>> =
  Object.freeze({ ALLOW: 0, WARN: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 });

/** The decision types in ascending precedence order. */
export const DECISION_PRECEDENCE_ORDER: readonly GuardianDecisionType[] = Object.freeze([
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
]);

/**
 * Resolve the winning effect among fired rule effects by blocking
 * precedence. Pure and deterministic: the maximum rank wins.
 *
 * @param effects the fired effects (non-empty)
 * @returns the winning decision type
 */
export function resolvePrecedence(effects: readonly GuardianDecisionType[]): GuardianDecisionType {
  let winner: GuardianDecisionType = ALLOW;
  let winnerRank = -1;
  for (const effect of effects) {
    const rank = DECISION_PRECEDENCE_RANK[effect];
    if (rank > winnerRank) {
      winner = effect;
      winnerRank = rank;
    }
  }
  return winner;
}

// ---------------------------------------------------------------------------
// Machine-stable reasons
// ---------------------------------------------------------------------------

/** A machine-stable evaluation reason. All fields enumerated — no free text. */
export interface GuardianReason {
  /** The stable machine code (e.g. "policy.rule.matched"). */
  readonly code: string;
  /** The rule that produced this reason, when applicable. */
  readonly ruleId?: RuleRef["ruleId"];
  /** The rule version at evaluation time, when applicable. */
  readonly ruleVersion?: number;
  /** The condition kind that matched, when applicable. */
  readonly conditionKind?: GuardianRuleCondition["kind"];
  /** The effect the matched rule contributes, when applicable. */
  readonly effect?: GuardianDecisionType;
  /** The chosen effect when the reason records a precedence resolution. */
  readonly chosen?: GuardianDecisionType;
}

/** The stable reason codes emitted by the engine. */
export const GUARDIAN_REASON_CODES = frozen({
  noRuleMatched: "policy.no_rule_matched",
  ruleMatched: "policy.rule.matched",
  precedenceResolved: "policy.precedence.resolved",
} as const);

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Options for `evaluateGuardianRequest`. */
export interface EvaluateGuardianOptions {
  /** The injected decision instant (ISO 8601) — becomes `decidedAt`. */
  readonly at: string;
  /** The correlation id of the request being evaluated. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the evaluation is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (consequential decisions emit; default: no-op). */
  readonly auditSink?: PolicyAuditSink;
}

/** The full evaluation result: the frozen decision + engine-side context. */
export interface GuardianEvaluation {
  /** The FROZEN `GuardianDecision` (exact shape from `@fleetos/contracts`). */
  readonly decision: GuardianDecision;
  /** The rule set that was evaluated. */
  readonly ruleSetId: string;
  /** The rule set's version (the "policy version" of the decision). */
  readonly ruleSetVersion: number;
  /** The rules that fired, in ruleId order. */
  readonly matchedRules: readonly GuardianRule[];
  /** Machine-stable reasons. */
  readonly reasons: readonly GuardianReason[];
}

/** The tagged result of an evaluation. */
export type GuardianEvaluationResult =
  | { readonly ok: true; readonly evaluation: GuardianEvaluation }
  | { readonly ok: false; readonly error: FleetError };

// ---------------------------------------------------------------------------
// Condition matching (pure)
// ---------------------------------------------------------------------------

function matchSet(matcher: StringSetMatcher | undefined, value: string | undefined): boolean {
  if (matcher === undefined) return true; // unconstrained dimension
  const inList = Array.isArray(matcher.in) ? matcher.in : [];
  const notInList = Array.isArray(matcher.notIn) ? matcher.notIn : [];
  if (inList.length > 0 && (value === undefined || !inList.includes(value))) return false;
  if (notInList.length > 0 && value !== undefined && notInList.includes(value)) return false;
  // notIn + absent value: satisfied (fail-closed).
  return true;
}

function hourOfUtc(ms: number): number {
  return new Date(ms).getUTCHours();
}

function weekdayOfUtc(ms: number): number {
  return new Date(ms).getUTCDay();
}

function inWindow(hour: number, window: { from: number; to: number }): boolean {
  return hour >= window.from && hour <= window.to;
}

/**
 * Does the condition fire for this request? Pure and deterministic. The
 * effective instant for time conditions is `request.time?.at ?? decidedAt`
 * (both injected by the caller — no clock reads).
 */
function conditionFires(
  condition: GuardianRuleCondition,
  request: GuardianRequestContext,
  effectiveAtMs: number,
): boolean {
  switch (condition.kind) {
    case "principal": {
      const facet: GuardianPrincipalFacet | undefined = request.principal;
      if (facet === undefined) return false;
      if (!matchSet(condition.roles, facet.role)) return false;
      if (!matchSet(condition.userIds, facet.userId)) return false;
      if (!matchSet(condition.departments, facet.department)) return false;
      if (
        condition.servicePrincipals !== undefined &&
        (facet.isServicePrincipal ?? false) !== condition.servicePrincipals
      ) {
        return false;
      }
      return true;
    }
    case "device": {
      const facet: GuardianDeviceFacet | undefined = request.device;
      if (facet === undefined) return false;
      if (!matchSet(condition.deviceIds, facet.deviceId)) return false;
      if (!matchSet(condition.platforms, facet.platform)) return false;
      if (!matchSet(condition.ownerships, facet.ownership)) return false;
      if (condition.minPostureStatus !== undefined) {
        if (facet.posture === undefined) return false;
        if (GUARDIAN_POSTURE_STATUS_RANK[facet.posture.status] < GUARDIAN_POSTURE_STATUS_RANK[condition.minPostureStatus]) {
          return false;
        }
      }
      return true;
    }
    case "workload": {
      const facet = request.workload;
      if (facet === undefined) return false;
      if (!matchSet(condition.workloadIds, facet.workloadId)) return false;
      if (!matchSet(condition.classifications, facet.classification)) return false;
      return true;
    }
    case "dataClassification": {
      const effective = request.dataClassification ?? UNCLASSIFIED;
      return matchSet(condition.classification, effective);
    }
    case "contract": {
      const facet = request.contract;
      if (condition.contractIds !== undefined) {
        if (!matchSet(condition.contractIds, facet?.contractId)) return false;
      }
      if (condition.missingAnyObligations !== undefined) {
        const inForce = facet?.obligations ?? [];
        const anyMissing = condition.missingAnyObligations.some((code) => !inForce.includes(code));
        if (!anyMissing) return false;
      }
      if (condition.presentAnyObligations !== undefined) {
        const inForce = facet?.obligations ?? [];
        const anyPresent = condition.presentAnyObligations.some((code) => inForce.includes(code));
        if (!anyPresent) return false;
      }
      return true;
    }
    case "destination": {
      const facet = request.destination;
      if (condition.categories !== undefined) {
        if (!matchSet(condition.categories, facet?.category)) return false;
      }
      if (condition.hosts !== undefined) {
        if (!matchSet(condition.hosts, facet?.host)) return false;
      }
      return true;
    }
    case "network": {
      return matchSet(condition.zones, request.network?.zone);
    }
    case "printer": {
      const facet = request.printer;
      if (condition.printerIds !== undefined) {
        if (!matchSet(condition.printerIds, facet?.printerId)) return false;
      }
      if (condition.unapprovedOnly === true) {
        if (facet?.approved === true) return false;
      }
      return true;
    }
    case "time": {
      const hour = hourOfUtc(effectiveAtMs);
      if (condition.withinHoursUtc !== undefined) {
        if (!inWindow(hour, condition.withinHoursUtc)) return false;
      }
      if (condition.outsideHoursUtc !== undefined) {
        if (inWindow(hour, condition.outsideHoursUtc)) return false;
      }
      if (condition.weekdaysUtc !== undefined) {
        if (!condition.weekdaysUtc.includes(weekdayOfUtc(effectiveAtMs))) return false;
      }
      return true;
    }
    case "geography": {
      return matchSet(condition.countryCodes, request.geography?.countryCode);
    }
    case "action": {
      if (!matchSet(condition.actions, request.action.action)) return false;
      if (!matchSet(condition.targetKinds, request.action.targetKind)) return false;
      return true;
    }
    case "allOf": {
      for (const sub of condition.conditions) {
        if (!conditionFires(sub, request, effectiveAtMs)) return false;
      }
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// The evaluation entry point
// ---------------------------------------------------------------------------

/**
 * The audit subject of a request: the device the action concerns, else
 * the acting principal, else null. Deterministic.
 */
function subjectOf(request: GuardianRequestContext): string | null {
  if (request.device !== undefined) return request.device.deviceId;
  if (request.principal?.userId !== undefined) return request.principal.userId;
  return null;
}

/**
 * Evaluate a request against a rule set. PURE: every input (rule set,
 * request, decision instant, correlation id) is injected — the engine
 * reads no clock and no entropy. The produced `decision` is the FROZEN
 * `GuardianDecision` shape, built via the frozen
 * `makeGuardianDecision` constructor.
 *
 * Consequential decisions (BLOCK, REQUIRE_APPROVAL) emit an audit record
 * to the injected sink (`policy.guardian.evaluated`).
 *
 * Tenant isolation: the request's tenant MUST match the rule set's
 * tenant — a tenant-A request can never be evaluated against tenant-B
 * rules (rejected with a tagged error, never a wrong-tenant decision).
 *
 * @param ruleSet the compiled rule set
 * @param request the evaluation request
 * @param options the injected options
 * @returns the tagged evaluation result
 */
export function evaluateGuardianRequest(
  ruleSet: GuardianRuleSet,
  request: GuardianRequestContext,
  options: EvaluateGuardianOptions,
): GuardianEvaluationResult {
  const failures: { path: string; reason: string }[] = [];
  const errorTenant: TenantId =
    typeof request?.tenantId === "string" && request.tenantId.length > 0
      ? request.tenantId
      : SYNTHETIC_SYSTEM_TENANT;
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (request === null || typeof request !== "object") {
    failures.push({ path: "/request", reason: "required" });
  } else {
    if (typeof request.tenantId !== "string" || request.tenantId.length === 0) {
      failures.push({ path: "/request/tenantId", reason: "required" });
    }
    if (
      request.action === undefined ||
      typeof request.action.action !== "string" ||
      request.action.action.length === 0
    ) {
      failures.push({ path: "/request/action/action", reason: "required" });
    }
  }
  if (ruleSet === null || typeof ruleSet !== "object" || !Array.isArray(ruleSet.rules)) {
    failures.push({ path: "/ruleSet", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.evaluationInvalid,
        "guardian evaluation request is invalid",
        { tenantId: errorTenant, correlationId: options?.correlationId ?? POLICY_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }

  // Tenant isolation by rejection: cross-tenant evaluation is impossible.
  if (request.tenantId !== ruleSet.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.evaluationTenantMismatch,
        "guardian evaluation refused: request tenant does not match rule set tenant",
        { tenantId: request.tenantId, correlationId: options.correlationId },
        "policy.guardian.evaluation",
        "tenant_mismatch",
      ),
    };
  }

  // Time conditions evaluate against the effective instant: the
  // request's own time facet when present, else the injected decision
  // instant. Both are caller-injected — no clock reads.
  const effectiveAt = request.time?.at ?? options.at;
  const effectiveAtMs = parseIsoMs(effectiveAt);
  if (Number.isNaN(effectiveAtMs)) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.evaluationInvalid,
        "guardian evaluation request is invalid",
        { tenantId: request.tenantId, correlationId: options.correlationId },
        [{ path: "/request/time/at", reason: "not_iso" }],
      ),
    };
  }

  // Match phase — rule sets are compiled in ruleId order, so the match
  // order is deterministic regardless of how the rules were authored.
  const matched: GuardianRule[] = [];
  const reasons: GuardianReason[] = [];
  for (const rule of ruleSet.rules) {
    if (!rule.enabled) continue;
    if (conditionFires(rule.condition, request, effectiveAtMs)) {
      matched.push(rule);
      reasons.push(
        frozen({
          code: GUARDIAN_REASON_CODES.ruleMatched,
          ruleId: rule.ruleId,
          ruleVersion: rule.version,
          conditionKind: rule.condition.kind,
          effect: rule.effect,
        }),
      );
    }
  }

  // Effect resolution — blocking precedence, deterministically.
  let finalDecision: GuardianDecisionType;
  if (matched.length === 0) {
    finalDecision = ALLOW; // the default: no rule fired.
    reasons.push(frozen({ code: GUARDIAN_REASON_CODES.noRuleMatched }));
  } else {
    const effects = matched.map((rule) => rule.effect);
    finalDecision = resolvePrecedence(effects);
    const distinctEffects = [...new Set(effects)];
    if (distinctEffects.length > 1) {
      reasons.push(
        frozen({
          code: GUARDIAN_REASON_CODES.precedenceResolved,
          chosen: finalDecision,
        }),
      );
    }
  }

  const ruleRefs: readonly RuleRef[] = frozenArray(
    matched.map((rule) => frozen({ ruleId: rule.ruleId, ruleVersion: rule.version })),
  );
  const evidence: readonly EvidenceRef[] = frozenArray(request.evidence ?? []);

  // The FROZEN decision shape, built via the frozen constructor.
  const decision: GuardianDecision = makeGuardianDecision({
    tenantId: request.tenantId,
    decision: finalDecision,
    rules: ruleRefs,
    evidence,
    decidedAt: options.at,
    schemaVersion: GUARDIAN_DECISION_SCHEMA_VERSION,
  });

  // Audit: consequential decisions only (BLOCK / REQUIRE_APPROVAL).
  if (isBlockingDecision(finalDecision)) {
    const sink = options.auditSink;
    if (sink !== undefined) {
      sink.append(
        frozen({
          action: POLICY_AUDIT_ACTIONS.guardianEvaluated,
          tenantId: request.tenantId,
          subject: subjectOf(request),
          occurredAt: options.at,
          correlationId: options.correlationId,
          causationId: options.causationId,
          details: frozen({
            decision: finalDecision,
            ruleSetId: ruleSet.ruleSetId,
            ruleSetVersion: ruleSet.version,
            rules: ruleRefs.map((ref) => frozen({ ruleId: ref.ruleId, ruleVersion: ref.ruleVersion })),
            actionKind: request.action.action,
            matchedRuleCount: matched.length,
          }),
        }),
      );
    }
  }

  return {
    ok: true,
    evaluation: frozen({
      decision,
      ruleSetId: ruleSet.ruleSetId,
      ruleSetVersion: ruleSet.version,
      matchedRules: frozenArray(matched),
      reasons: frozenArray(reasons),
    }),
  };
}

// Re-export the frozen decision-type constants + helpers for consumers
// (single import site; the types themselves are never re-declared).
export {
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
  BLOCKING_DECISION_TYPES,
  isBlockingDecision,
};
