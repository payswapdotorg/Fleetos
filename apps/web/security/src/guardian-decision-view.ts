/**
 * @fleetos/web-security — D2: the Contract Guardian decision surface.
 *
 * The Guardian's decision presentation: ALLOW / WARN /
 * REQUIRE_APPROVAL / BLOCK surfaced with the ENGINE's machine-stable
 * reasons (verbatim, engine order), the matched rules (projected:
 * ruleId + name + version + effect), and the OPAQUE evidence refs (the
 * frozen contracts `EvidenceRef` shape — content-addressable keys +
 * hashes, never interpreted). The BLOCK history is surfaced READ-ONLY
 * with machine-stable ordering (decidedAt asc, canonical digest asc).
 *
 * LOCK 11 (the Guardian NEVER asserts unobservable employee intent):
 * the presentation carries OBSERVABLE fields only — the decision type,
 * the rules that fired, the evidence refs, the instants. No field can
 * carry an intent assertion (proven by test: the serialized view's
 * every key is an observable name).
 *
 * The surface mirrors the engine's frozen precedence and blocking
 * tables locally (data, not control flow) and the binding test proves
 * they are EQUAL to the real tables — no re-declaration drift.
 *
 * PURE: every input is injected; no clock, no entropy, no I/O. The
 * same evaluation produces a byte-identical presentation. Tenant-
 * scoped: the acting scope's tenant MUST match the decision's tenant
 * (fail-closed refusal, never rendered).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  canonicalJson,
  compareStrings,
  deepFrozen,
  fnv1a32Hex,
  frozen,
  frozenArray,
  isNonEmptyString,
  isPlainObject,
  isPositiveInteger,
  looksLikeIso,
  makeSurfaceError,
  SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import type {
  GuardianDecisionRecord,
  GuardianEvaluationRecord,
  GuardianEvidenceRefView,
  GuardianReasonView,
  GuardianRuleRefView,
  SurfaceDecisionType,
  SurfaceTenantScope,
} from "./surface-contracts";
import {
  ALL_SURFACE_DECISION_TYPES,
  DECISION_PRECEDENCE_RANK_VIEW,
} from "./surface-contracts";

// ---------------------------------------------------------------------------
// Blocking semantics (the frozen contracts mirror, proven equal by test)
// ---------------------------------------------------------------------------

/**
 * Is the decision type blocking? REQUIRE_APPROVAL holds the action for
 * human approval; BLOCK refuses it outright (the frozen contracts
 * `BLOCKING_DECISION_TYPES` semantics — the binding test proves
 * equivalence).
 */
export function isBlockingDecisionView(decision: SurfaceDecisionType): boolean {
  return decision === "REQUIRE_APPROVAL" || decision === "BLOCK";
}

export { DECISION_PRECEDENCE_RANK_VIEW };

// ---------------------------------------------------------------------------
// The decision presentation view-model
// ---------------------------------------------------------------------------

/** The Guardian decision presentation (observable fields only). */
export interface GuardianDecisionPresentationView {
  /** The tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: SurfaceDecisionType;
  /** Whether the decision blocks immediate execution. */
  readonly isBlocking: boolean;
  /** The machine-stable precedence rank (BLOCK > REQUIRE_APPROVAL > WARN > ALLOW). */
  readonly precedenceRank: number;
  /** ISO 8601 decision instant (injected upstream; verbatim). */
  readonly decidedAt: string;
  /** The decision record's schema version (verbatim). */
  readonly schemaVersion: number;
  /** The evaluated rule set identity (null when presenting a bare decision). */
  readonly ruleSetId: string | null;
  /** The evaluated rule set version (null when presenting a bare decision). */
  readonly ruleSetVersion: number | null;
  /** The decision's own rule refs (the frozen contracts rules list, verbatim). */
  readonly rules: readonly GuardianRuleRefView[];
  /** OPAQUE evidence refs (the frozen contracts shape, verbatim). */
  readonly evidence: readonly GuardianEvidenceRefView[];
  /** The engine's machine-stable reasons (verbatim, engine order). */
  readonly reasons: readonly GuardianReasonView[];
  /** The matched rules, projected (ruleId + name + version + effect), engine order. */
  readonly matchedRules: readonly {
    ruleId: GuardianRuleRefView["ruleId"];
    name: string;
    version: number;
    effect: SurfaceDecisionType;
  }[];
}

/** The tagged result of `presentGuardianDecision`. */
export type GuardianDecisionPresentationResult = SurfaceResult<GuardianDecisionPresentationView>;

// ---------------------------------------------------------------------------
// Validation (pure, machine-stable, shared with the approvals queue)
// ---------------------------------------------------------------------------

/** Validate a Guardian decision record at the given path prefix. */
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

/** Validate a full Guardian evaluation record (decision + engine context). */
export function validateEvaluationRecord(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  validateDecisionRecord(candidate["decision"], `${path}/decision`, failures);
  if (!isNonEmptyString(candidate["ruleSetId"])) {
    failures.push({ path: `${path}/ruleSetId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["ruleSetVersion"])) {
    failures.push({ path: `${path}/ruleSetVersion`, reason: "positive_integer_required" });
  }
  const matched = candidate["matchedRules"];
  if (!Array.isArray(matched)) {
    failures.push({ path: `${path}/matchedRules`, reason: "array_required" });
  } else {
    for (let i = 0; i < matched.length; i++) {
      const rule = matched[i];
      if (
        !isPlainObject(rule) ||
        !isNonEmptyString(rule["ruleId"]) ||
        !isNonEmptyString(rule["name"]) ||
        !isPositiveInteger(rule["version"]) ||
        typeof rule["effect"] !== "string" ||
        !(ALL_SURFACE_DECISION_TYPES as readonly string[]).includes(rule["effect"])
      ) {
        failures.push({ path: `${path}/matchedRules/${i}`, reason: "matched_rule_invalid" });
      }
    }
  }
  const reasons = candidate["reasons"];
  if (!Array.isArray(reasons)) {
    failures.push({ path: `${path}/reasons`, reason: "array_required" });
  } else {
    for (let i = 0; i < reasons.length; i++) {
      const reason = reasons[i];
      if (!isPlainObject(reason) || !isNonEmptyString(reason["code"])) {
        failures.push({ path: `${path}/reasons/${i}`, reason: "reason_invalid" });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The decision presentation builder
// ---------------------------------------------------------------------------

/**
 * Present a Guardian evaluation as the decision surface view-model.
 * The reasons, matched rules, rule refs and evidence refs pass through
 * VERBATIM (engine order) — the surface never reorders or re-derives
 * the engine's output. The view is deeply frozen.
 *
 * @param scope the acting tenant scope (tenant discipline)
 * @param evaluation the Guardian evaluation (the real engine result, bound at the binding site)
 * @returns the tagged result: the presentation or a machine-stable error
 */
export function presentGuardianDecision(
  scope: SurfaceTenantScope,
  evaluation: GuardianEvaluationRecord,
): GuardianDecisionPresentationResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "guardian decision surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation.
  const structural: SurfaceValidationFailure[] = [];
  if (!isPlainObject(evaluation)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.evaluationInvalid,
        "guardian decision surface requires an evaluation record",
        scope.tenantId,
        [{ path: "", reason: "object_required" }],
      ),
    };
  }
  validateEvaluationRecord(evaluation, "", structural);
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.evaluationInvalid,
        "guardian decision surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  if (evaluation.decision.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "guardian decision surface refuses cross-tenant decisions",
        scope.tenantId,
        [{ path: "/decision/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 3 — the verbatim presentation.
  const decisionType = evaluation.decision.decision;
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        decision: decisionType,
        isBlocking: isBlockingDecisionView(decisionType),
        precedenceRank: DECISION_PRECEDENCE_RANK_VIEW[decisionType],
        decidedAt: evaluation.decision.decidedAt,
        schemaVersion: evaluation.decision.schemaVersion,
        ruleSetId: evaluation.ruleSetId,
        ruleSetVersion: evaluation.ruleSetVersion,
        rules: frozenArray(evaluation.decision.rules),
        evidence: frozenArray(evaluation.decision.evidence),
        reasons: frozenArray(evaluation.reasons),
        matchedRules: frozenArray(
          evaluation.matchedRules.map((rule) =>
            frozen({
              ruleId: rule.ruleId,
              name: rule.name,
              version: rule.version,
              effect: rule.effect,
            }),
          ),
        ),
      } satisfies GuardianDecisionPresentationView),
    ),
  };
}

// ---------------------------------------------------------------------------
// The BLOCK history (read-only)
// ---------------------------------------------------------------------------

/** One read-only BLOCK-history row. */
export interface BlockHistoryEntryView {
  /** The decision type (always BLOCK in the block history). */
  readonly decision: SurfaceDecisionType;
  /** ISO 8601 decision instant (verbatim). */
  readonly decidedAt: string;
  /** The rule refs that fired (verbatim). */
  readonly rules: readonly GuardianRuleRefView[];
  /** OPAQUE evidence refs (verbatim). */
  readonly evidence: readonly GuardianEvidenceRefView[];
  /** The machine-stable canonical digest of the decision (row identity). */
  readonly canonicalRef: string;
}

/** The read-only BLOCK history view. */
export interface BlockHistoryView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The total number of BLOCK decisions. */
  readonly total: number;
  /** The ordered rows (decidedAt asc, canonicalRef asc — input-order invariant). */
  readonly items: readonly BlockHistoryEntryView[];
}

/** The tagged result of `buildBlockHistoryView`. */
export type BlockHistoryViewResult = SurfaceResult<BlockHistoryView>;

/**
 * Build the read-only BLOCK history view. Every decision MUST be a
 * BLOCK decision of the acting tenant (anything else REFUSES — the
 * history is fail-closed, never filtered). Ordering is machine-stable:
 * decidedAt asc, then the canonical digest asc (a total order over
 * byte-distinct decisions).
 *
 * @param scope the acting tenant scope
 * @param decisions the BLOCK decision records (bound at the binding site)
 * @returns the tagged result: the ordered history or a machine-stable error
 */
export function buildBlockHistoryView(
  scope: SurfaceTenantScope,
  decisions: readonly GuardianDecisionRecord[],
): BlockHistoryViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.scopeInvalid,
        "block history surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation + the BLOCK-only discipline.
  const structural: SurfaceValidationFailure[] = [];
  if (!Array.isArray(decisions)) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.decisionInvalid,
        "block history surface requires an array of decision records",
        scope.tenantId,
        [{ path: "/decisions", reason: "array_required" }],
      ),
    };
  }
  for (let i = 0; i < decisions.length; i++) {
    validateDecisionRecord(decisions[i], `/decisions/${i}`, structural);
    const decisionType = (decisions[i] as { decision?: unknown }).decision;
    if (decisionType !== "BLOCK") {
      structural.push({ path: `/decisions/${i}`, reason: "decision_not_block" });
    }
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.decisionInvalid,
        "block history surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < decisions.length; i++) {
    if ((decisions[i] as { tenantId: unknown }).tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/decisions/${i}`, reason: "tenant_mismatch" });
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        SURFACE_ERROR_CODES.tenantMismatch,
        "block history surface refuses cross-tenant decisions",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, canonical-identified rows.
  const rows = decisions.map((record) => {
    const canonicalRef = `gdref_${fnv1a32Hex(canonicalJson(record))}`;
    return frozen({
      decision: record.decision,
      decidedAt: record.decidedAt,
      rules: frozenArray(record.rules),
      evidence: frozenArray(record.evidence),
      canonicalRef,
    } satisfies BlockHistoryEntryView);
  });
  rows.sort((a, b) => {
    const byInstant = compareStrings(a.decidedAt, b.decidedAt);
    if (byInstant !== 0) return byInstant;
    return compareStrings(a.canonicalRef, b.canonicalRef);
  });
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: rows.length,
        items: frozenArray(rows),
      } satisfies BlockHistoryView),
    ),
  };
}
