/**
 * @fleetos/web-security — D1.2 (W090B): the Policies surface.
 *
 * Policies as a FIRST-CLASS rendered area (the UX simulation's 🟡
 * gap): a read-only view-model over the frozen Contract Guardian
 * policy surfaces — the versioned rule sets and their rules — plus
 * the decision history. The W060B pattern: STRUCTURAL seam types the
 * real `@fleetos/policy` records satisfy (`GuardianRule`,
 * `GuardianRuleSet` — dev-dependency, bound at the binding site,
 * proven by test); src/ imports the shared seam `@fleetos/contracts`
 * only.
 *
 * Read-only rendering of FROZEN policy surfaces: the surface NEVER
 * edits, enables, disables, compiles or re-orders policy — policy
 * editing is separate from decision execution and preserves versioned
 * audit evidence (the W031/W041 discipline). Conditions are treated
 * OPAQUELY: the kind passes through verbatim and the canonical JSON
 * summary is displayed — never interpreted, never matched on.
 *
 * PURE: every input is injected; no clock, no entropy, no I/O. The
 * same inputs produce byte-identical views. Tenant-scoped: the acting
 * scope's tenant MUST match every record (fail-closed refusal, never
 * silently filtered). Outputs are deeply frozen.
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
  POLICY_SURFACE_ERROR_CODES,
  SYNTHETIC_SURFACE_TENANT,
} from "./internal";
import type { SurfaceResult, SurfaceValidationFailure } from "./internal";
import type {
  GuardianDecisionRecord,
  GuardianRuleRefView,
  SurfaceDecisionType,
  SurfaceTenantScope,
} from "./surface-contracts";
import { ALL_SURFACE_DECISION_TYPES } from "./surface-contracts";

// ---------------------------------------------------------------------------
// The structural seams (satisfied by @fleetos/policy's frozen records)
// ---------------------------------------------------------------------------

/**
 * A policy rule's typed condition — an OPAQUE structural seam: the
 * real `GuardianRuleCondition` discriminated union (kind + typed
 * fields) satisfies this shape (extra fields tolerated). The surface
 * displays the kind verbatim and the canonical JSON summary — it
 * NEVER interprets or re-derives the condition.
 */
export interface PolicyRuleConditionLike {
  /** The condition kind (machine-stable — e.g. "allOf", "action"). */
  readonly kind: string;
}

/**
 * A versioned Contract Guardian rule (structural seam for the W031
 * `GuardianRule` — @fleetos/policy rule-model). Frozen at definition;
 * revisions are NEW records (the version increments; the identity is
 * stable).
 */
export interface PolicyRuleRecord {
  /** The deterministic rule identity (digest of tenantId + name). */
  readonly ruleId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The stable human name. */
  readonly name: string;
  /** Human description (never matched on). */
  readonly description?: string;
  /** The rule version (>= 1; increments on every revision). */
  readonly version: number;
  /** The typed condition (opaque — displayed canonically only). */
  readonly condition: PolicyRuleConditionLike;
  /** The effect when the condition fires (the frozen decision types). */
  readonly effect: SurfaceDecisionType;
  /** Disabled rules never fire (kept for history — deletion never happens). */
  readonly enabled: boolean;
  /** ISO 8601 timestamp of the initial definition (injected). */
  readonly createdAt: string;
  /** ISO 8601 timestamp of the latest revision (absent on v1). */
  readonly revisedAt?: string;
  /** Canonical digest of the rule's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/**
 * A versioned Contract Guardian rule set (structural seam for the
 * W031 `GuardianRuleSet` — @fleetos/policy rule-model): the compiled
 * set of member rules in deterministic ruleId order.
 */
export interface PolicyRuleSetRecord {
  /** Deterministic content identity: digest over tenant + version + members. */
  readonly ruleSetId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The rule-set version (>= 1, monotonic per tenant). */
  readonly version: number;
  /** The member rules, sorted by ruleId (deterministic order). */
  readonly rules: readonly PolicyRuleRecord[];
  /** ISO 8601 compile timestamp (injected). */
  readonly compiledAt: string;
  /** Canonical digest of the member rules. */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// The policies LIST view
// ---------------------------------------------------------------------------

/** One policy-set row (a read-only projection of a rule set). */
export interface PolicySetItemView {
  /** The rule-set identity. */
  readonly ruleSetId: string;
  /** The rule-set version (>= 1). */
  readonly version: number;
  /** ISO 8601 compile timestamp (verbatim). */
  readonly compiledAt: string;
  /** The number of member rules (derived). */
  readonly ruleCount: number;
  /** The number of ENABLED member rules (derived). */
  readonly enabledCount: number;
  /** The derived per-effect rule counts. */
  readonly effectCounts: Readonly<Record<SurfaceDecisionType, number>>;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The policies list view (ordered, counted, read-only). */
export interface PoliciesListView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The total number of rule sets. */
  readonly total: number;
  /** The total number of rules across all sets (derived). */
  readonly ruleTotal: number;
  /** The ordered rows (ruleSetId asc — input-order invariant). */
  readonly items: readonly PolicySetItemView[];
}

/** The tagged result of `buildPoliciesListView`. */
export type PoliciesListViewResult = SurfaceResult<PoliciesListView>;

// ---------------------------------------------------------------------------
// The policy DETAIL view
// ---------------------------------------------------------------------------

/** One rule row in the policy detail (read-only). */
export interface PolicyRuleItemView {
  /** The rule identity. */
  readonly ruleId: string;
  /** The stable human name. */
  readonly name: string;
  /** The human description, when present. */
  readonly description?: string;
  /** The rule version (>= 1). */
  readonly version: number;
  /** The condition kind (machine-stable, verbatim). */
  readonly conditionKind: string;
  /** The canonical JSON summary of the condition (sorted keys — machine-stable). */
  readonly conditionSummary: string;
  /** The effect when the condition fires (verbatim). */
  readonly effect: SurfaceDecisionType;
  /** Whether the rule is enabled (disabled rules never fire). */
  readonly enabled: boolean;
  /** ISO 8601 definition timestamp (verbatim). */
  readonly createdAt: string;
  /** ISO 8601 latest-revision timestamp (verbatim; absent on v1). */
  readonly revisedAt?: string;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The policy detail view (one rule set, read-only). */
export interface PolicyDetailView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The rule-set identity. */
  readonly ruleSetId: string;
  /** The rule-set version. */
  readonly version: number;
  /** ISO 8601 compile timestamp (verbatim). */
  readonly compiledAt: string;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
  /** The member rules, ordered by ruleId asc (machine-stable). */
  readonly rules: readonly PolicyRuleItemView[];
}

/** The tagged result of `buildPolicyDetailView`. */
export type PolicyDetailViewResult = SurfaceResult<PolicyDetailView>;

// ---------------------------------------------------------------------------
// The decision HISTORY view (read-only, all decision types)
// ---------------------------------------------------------------------------

/** One read-only decision-history row. */
export interface PolicyDecisionHistoryEntryView {
  /** The decision type (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK). */
  readonly decision: SurfaceDecisionType;
  /** ISO 8601 decision instant (verbatim). */
  readonly decidedAt: string;
  /** The rule refs that fired (verbatim). */
  readonly rules: readonly GuardianRuleRefView[];
  /** OPAQUE evidence refs (verbatim). */
  readonly evidence: GuardianDecisionRecord["evidence"];
  /** The machine-stable canonical digest of the decision (row identity). */
  readonly canonicalRef: string;
}

/** The read-only decision history view. */
export interface PolicyDecisionHistoryView {
  /** The acting tenant scope. */
  readonly tenantId: SurfaceTenantScope["tenantId"];
  /** The total number of decisions. */
  readonly total: number;
  /** The derived per-decision counts. */
  readonly decisionCounts: Readonly<Record<SurfaceDecisionType, number>>;
  /** The ordered rows (decidedAt asc, canonicalRef asc — input-order invariant). */
  readonly items: readonly PolicyDecisionHistoryEntryView[];
}

/** The tagged result of `buildPolicyDecisionHistoryView`. */
export type PolicyDecisionHistoryViewResult = SurfaceResult<PolicyDecisionHistoryView>;

// ---------------------------------------------------------------------------
// Validation (pure, machine-stable)
// ---------------------------------------------------------------------------

function validateRule(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["ruleId", "name", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  const condition = candidate["condition"];
  if (!isPlainObject(condition) || !isNonEmptyString(condition["kind"])) {
    failures.push({ path: `${path}/condition`, reason: "condition_invalid" });
  }
  const effect = candidate["effect"];
  if (
    typeof effect !== "string" ||
    !(ALL_SURFACE_DECISION_TYPES as readonly string[]).includes(effect)
  ) {
    failures.push({ path: `${path}/effect`, reason: "unknown_decision" });
  }
  if (typeof candidate["enabled"] !== "boolean") {
    failures.push({ path: `${path}/enabled`, reason: "boolean_required" });
  }
  if (!looksLikeIso(String(candidate["createdAt"] ?? ""))) {
    failures.push({ path: `${path}/createdAt`, reason: "not_iso" });
  }
  if (candidate["revisedAt"] !== undefined && !looksLikeIso(String(candidate["revisedAt"]))) {
    failures.push({ path: `${path}/revisedAt`, reason: "not_iso" });
  }
  if (candidate["description"] !== undefined && !isNonEmptyString(candidate["description"])) {
    failures.push({ path: `${path}/description`, reason: "non_empty_string_required" });
  }
}

function validateRuleSet(
  candidate: unknown,
  path: string,
  failures: SurfaceValidationFailure[],
): void {
  if (!isPlainObject(candidate)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  for (const field of ["ruleSetId", "contentDigest"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      failures.push({ path: `${path}/${field}`, reason: "non_empty_string_required" });
    }
  }
  if (!isNonEmptyString(candidate["tenantId"])) {
    failures.push({ path: `${path}/tenantId`, reason: "non_empty_string_required" });
  }
  if (!isPositiveInteger(candidate["version"])) {
    failures.push({ path: `${path}/version`, reason: "positive_integer_required" });
  }
  if (!looksLikeIso(String(candidate["compiledAt"] ?? ""))) {
    failures.push({ path: `${path}/compiledAt`, reason: "not_iso" });
  }
  const rules = candidate["rules"];
  if (!Array.isArray(rules)) {
    failures.push({ path: `${path}/rules`, reason: "array_required" });
  } else {
    for (let i = 0; i < rules.length; i++) {
      validateRule(rules[i], `${path}/rules/${i}`, failures);
    }
  }
}

// ---------------------------------------------------------------------------
// The builders
// ---------------------------------------------------------------------------

/**
 * Build the read-only policies list view. Ordering (machine-stable,
 * input-order invariant): ruleSetId asc.
 *
 * @param scope the acting tenant scope
 * @param ruleSets the compiled rule sets (the real W031 GuardianRuleSet records, bound at the binding site)
 * @returns the tagged result: the ordered list or a machine-stable error
 */
export function buildPoliciesListView(
  scope: SurfaceTenantScope,
  ruleSets: readonly PolicyRuleSetRecord[],
): PoliciesListViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.scopeInvalid,
        "policies surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation of every rule set.
  if (!Array.isArray(ruleSets)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "policies surface requires an array of rule-set records",
        scope.tenantId,
        [{ path: "/ruleSets", reason: "array_required" }],
      ),
    };
  }
  const structural: SurfaceValidationFailure[] = [];
  for (let i = 0; i < ruleSets.length; i++) {
    validateRuleSet(ruleSets[i], `/ruleSets/${i}`, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "policies surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  const tenantFailures: SurfaceValidationFailure[] = [];
  for (let i = 0; i < ruleSets.length; i++) {
    const set = ruleSets[i] as { tenantId: unknown; rules: readonly { tenantId: unknown }[] };
    if (set.tenantId !== scope.tenantId) {
      tenantFailures.push({ path: `/ruleSets/${i}`, reason: "tenant_mismatch" });
    }
    for (let r = 0; r < set.rules.length; r++) {
      if (set.rules[r].tenantId !== scope.tenantId) {
        tenantFailures.push({ path: `/ruleSets/${i}/rules/${r}`, reason: "tenant_mismatch" });
      }
    }
  }
  if (tenantFailures.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.tenantMismatch,
        "policies surface refuses cross-tenant rule sets",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, counted projection.
  let ruleTotal = 0;
  const items: PolicySetItemView[] = ruleSets.map((record: PolicyRuleSetRecord) => {
    ruleTotal += record.rules.length;
    const effectCounts: Record<SurfaceDecisionType, number> = {
      ALLOW: 0,
      WARN: 0,
      REQUIRE_APPROVAL: 0,
      BLOCK: 0,
    };
    let enabledCount = 0;
    for (const rule of record.rules) {
      effectCounts[rule.effect] += 1;
      if (rule.enabled) enabledCount += 1;
    }
    return frozen({
      ruleSetId: record.ruleSetId,
      version: record.version,
      compiledAt: record.compiledAt,
      ruleCount: record.rules.length,
      enabledCount,
      effectCounts: frozen({ ...effectCounts }),
      contentDigest: record.contentDigest,
    } satisfies PolicySetItemView);
  });
  items.sort((a, b) => compareStrings(a.ruleSetId, b.ruleSetId));
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        total: items.length,
        ruleTotal,
        items: frozenArray(items),
      } satisfies PoliciesListView),
    ),
  };
}

/**
 * Build the read-only policy detail view: one rule set with its member
 * rules ordered by ruleId asc. Conditions are summarized canonically
 * (sorted-key JSON — machine-stable) and NEVER interpreted.
 *
 * @param scope the acting tenant scope
 * @param ruleSet the compiled rule set (the real W031 GuardianRuleSet, bound at the binding site)
 * @returns the tagged result: the detail view or a machine-stable error
 */
export function buildPolicyDetailView(
  scope: SurfaceTenantScope,
  ruleSet: PolicyRuleSetRecord,
): PolicyDetailViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.scopeInvalid,
        "policy detail surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation.
  const structural: SurfaceValidationFailure[] = [];
  if (!isPlainObject(ruleSet)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "policy detail surface requires a rule-set record",
        scope.tenantId,
        [{ path: "/ruleSet", reason: "object_required" }],
      ),
    };
  }
  validateRuleSet(ruleSet, "/ruleSet", structural);
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "policy detail surface input is invalid",
        scope.tenantId,
        structural,
      ),
    };
  }
  // Phase 2 — tenant isolation by rejection.
  if (ruleSet.tenantId !== scope.tenantId) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.tenantMismatch,
        "policy detail surface refuses cross-tenant rule sets",
        scope.tenantId,
        [{ path: "/ruleSet/tenantId", reason: "tenant_mismatch" }],
      ),
    };
  }
  // Phase 3 — the ordered projection (conditions summarized canonically).
  const rules: PolicyRuleItemView[] = ruleSet.rules.map((rule) =>
    frozen({
      ruleId: rule.ruleId,
      name: rule.name,
      description: rule.description,
      version: rule.version,
      conditionKind: rule.condition.kind,
      conditionSummary: canonicalJson(rule.condition),
      effect: rule.effect,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      revisedAt: rule.revisedAt,
      contentDigest: rule.contentDigest,
    } satisfies PolicyRuleItemView),
  );
  rules.sort((a, b) => compareStrings(a.ruleId, b.ruleId));
  return {
    ok: true,
    view: deepFrozen(
      frozen({
        tenantId: scope.tenantId,
        ruleSetId: ruleSet.ruleSetId,
        version: ruleSet.version,
        compiledAt: ruleSet.compiledAt,
        contentDigest: ruleSet.contentDigest,
        rules: frozenArray(rules),
      } satisfies PolicyDetailView),
    ),
  };
}

/**
 * Build the read-only decision history view (all decision types —
 * the policy outcomes that actually fired). Ordering (machine-stable):
 * decidedAt asc, then the canonical digest asc (a total order over
 * byte-distinct decisions — the same discipline as the BLOCK history).
 *
 * @param scope the acting tenant scope
 * @param decisions the Guardian decision records (bound at the binding site)
 * @returns the tagged result: the ordered history or a machine-stable error
 */
export function buildPolicyDecisionHistoryView(
  scope: SurfaceTenantScope,
  decisions: readonly GuardianDecisionRecord[],
): PolicyDecisionHistoryViewResult {
  // Phase 0 — the acting scope.
  if (!isPlainObject(scope) || !isNonEmptyString(scope.tenantId)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.scopeInvalid,
        "decision history surface requires a valid tenant scope",
        SYNTHETIC_SURFACE_TENANT,
        [{ path: "/scope/tenantId", reason: "non_empty_string_required" }],
      ),
    };
  }
  // Phase 1 — structural validation (the shared decision validator).
  const structural: SurfaceValidationFailure[] = [];
  if (!Array.isArray(decisions)) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "decision history surface requires an array of decision records",
        scope.tenantId,
        [{ path: "/decisions", reason: "array_required" }],
      ),
    };
  }
  for (let i = 0; i < decisions.length; i++) {
    validateHistoryDecision(decisions[i], `/decisions/${i}`, structural);
  }
  if (structural.length > 0) {
    return {
      ok: false,
      error: makeSurfaceError(
        POLICY_SURFACE_ERROR_CODES.policyInvalid,
        "decision history surface input is invalid",
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
        POLICY_SURFACE_ERROR_CODES.tenantMismatch,
        "decision history surface refuses cross-tenant decisions",
        scope.tenantId,
        tenantFailures,
      ),
    };
  }
  // Phase 3 — the ordered, counted rows.
  const decisionCounts: Record<SurfaceDecisionType, number> = {
    ALLOW: 0,
    WARN: 0,
    REQUIRE_APPROVAL: 0,
    BLOCK: 0,
  };
  const rows = decisions.map((record: GuardianDecisionRecord) => {
    decisionCounts[record.decision] += 1;
    return frozen({
      decision: record.decision,
      decidedAt: record.decidedAt,
      rules: frozenArray(record.rules),
      evidence: frozenArray(record.evidence),
      canonicalRef: `gdref_${fnv1a32Hex(canonicalJson(record))}`,
    } satisfies PolicyDecisionHistoryEntryView);
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
        decisionCounts: frozen({ ...decisionCounts }),
        items: frozenArray(rows),
      } satisfies PolicyDecisionHistoryView),
    ),
  };
}

/** Validate one decision record for the history (machine-stable). */
function validateHistoryDecision(
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
  if (!Array.isArray(candidate["rules"])) {
    failures.push({ path: `${path}/rules`, reason: "array_required" });
  }
  if (!Array.isArray(candidate["evidence"])) {
    failures.push({ path: `${path}/evidence`, reason: "array_required" });
  }
}
