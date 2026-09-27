/**
 * @fleetos/integration-arena — D1: typed, provider-neutral evaluation
 * case submission.
 *
 * Per `spec/integration/ARENA.md` + the W050B work order: a case carries
 *   - problem class,
 *   - normalized observation refs,
 *   - context,
 *   - action history refs,
 *   - outcome,
 *   - evaluation labels,
 *   - tenant policy refs,
 *   - redaction/de-identification state.
 *
 * Submission is PROPOSAL-gated through the W031 Guardian decision model
 * (the structural seam typed against the frozen `GuardianDecision`):
 *   - ALLOW          -> SUBMITTED  (the case is durable in the ledger)
 *   - WARN           -> SUBMITTED  (the case is durable; warnings carried verbatim)
 *   - REQUIRE_APPROVAL -> PARKED    (held for human review; never auto-submitted)
 *   - BLOCK          -> REJECTED   (refused with the Guardian's machine-stable reasons)
 *
 * Deterministic case ids: FNV-1a over canonical JSON of (tenantId,
 * problemClass, observationRefs, context, actionHistoryRefs, outcome,
 * labels, tenantPolicyRefs, redaction). Identical inputs produce
 * byte-identical case ids and content digests across runs and input
 * permutations (proven by test). Append-only submission ledger: a prior
 * revision is NEVER rewritten; a re-submission of identical inputs is
 * idempotent (the same record is returned).
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `ArenaTenantScope` FIRST; storage is partitioned per
 * tenant; a foreign case id is indistinguishable from an unknown one.
 *
 * Audit (D5): consequential mutations (case SUBMITTED / PARKED /
 * REJECTED) emit audit records to the injected sink. Pure reads and
 * failed validations never audit.
 *
 * ARENA.md invariant: this module NEVER treats an uncertified model
 * output as action permission. The evaluation case carries evaluation
 * LABELS (the human-readable ground-truth annotations, never the
 * model's own output); the model's output (if any) is referenced ONLY
 * through `evidenceRefs` (content-addressable refs to artifacts in
 * object storage — the control plane never interprets their contents).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { ArenaAuditSink } from "./audit-seam";
import { ARENA_AUDIT_ACTIONS, NOOP_ARENA_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  ARENA_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ArenaTenantScope } from "./internal";
import { checkArenaTenantScope } from "./internal";
import type { GuardianEvaluateFn } from "./policy-seam";
import type { ArenaGuardianOptions, ArenaGuardianRequest } from "./policy-seam";
import { isBlockingDecision } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The case status (machine-stable)
// ---------------------------------------------------------------------------

export const CASE_SUBMITTED = "SUBMITTED" as const;
export const CASE_PARKED = "PARKED" as const;
export const CASE_REJECTED = "REJECTED" as const;

/** The status of an evaluation case submission (machine-stable). */
export type EvaluationCaseStatus =
  | typeof CASE_SUBMITTED
  | typeof CASE_PARKED
  | typeof CASE_REJECTED;

/** All case statuses (for validation + iteration). */
export const ALL_EVALUATION_CASE_STATUSES: readonly EvaluationCaseStatus[] = Object.freeze([
  CASE_SUBMITTED,
  CASE_PARKED,
  CASE_REJECTED,
]);

// ---------------------------------------------------------------------------
// The case payload (the provider-neutral evaluation-case shape)
// ---------------------------------------------------------------------------

/**
 * The redaction / de-identification state of an evaluation case. The case
 * carries the state EXPLICITLY (a typed machine-stable record — never a
 * guessed flag). The control plane never re-derives the redaction state
 * from the observation payload; it records the caller-supplied state
 * verbatim.
 *
 *   - `raw`:           the case payload is the unmodified observation
 *                       stream (the strictest case for tenant policy
 *                       review — typically NOT submitted off-tenant).
 *   - `deidentified`:   PII has been removed/replaced with stable
 *                       surrogates (the case is safe for cross-tenant
 *                       learning).
 *   - `redacted`:       fields have been redacted (some fields removed
 *                       after de-identification — e.g., a free-text
 *                       field that could not be fully deidentified).
 */
export type RedactionState = "raw" | "deidentified" | "redacted";

/** All redaction states (for validation + iteration). */
export const ALL_REDACTION_STATES: readonly RedactionState[] = Object.freeze([
  "raw",
  "deidentified",
  "redacted",
]);

/**
 * The outcome of an evaluation case — the ground-truth label the case
 * carries. The outcome is OBSERVABLE (e.g., a battery was indeed aged,
 * a security finding was a true positive) — never an inferred intent.
 * The outcome's `value` is an open-union machine-stable string (the
 * owning capability's evaluation suite defines the value set; the
 * control plane never interprets it).
 */
export interface EvaluationOutcome {
  /** The outcome label (machine-stable — e.g., "true_positive", "false_positive", "battery_aged"). */
  readonly label: string;
  /** The outcome value (open-union machine-stable string; the capability's evaluation suite defines the value set). */
  readonly value: string;
  /** The injected observation instant of the outcome (ISO 8601). */
  readonly observedAt: string;
  /** The evidence artifacts supporting the outcome (content-addressable refs). */
  readonly evidenceRefs: readonly EvidenceRef[];
}

/**
 * An evaluation label — a key/value pair annotating the case with
 * human-readable ground truth. The control plane never interprets the
 * label's value; it records it verbatim. Used for cohort selection,
 * evaluation-suite revision tracking, and tenant-policy review.
 */
export interface EvaluationLabel {
  /** The label key (machine-stable — e.g., "severity", "cohort", "tenant_policy_approved"). */
  readonly key: string;
  /** The label value (machine-stable string). */
  readonly value: string;
}

/**
 * The redaction / de-identification state record. Carries the state
 * AND the policies applied (if any — the caller injects the policy
 * refs; the control plane never re-derives them).
 */
export interface RedactionRecord {
  /** The redaction state. */
  readonly state: RedactionState;
  /** The tenant policy refs that governed the redaction (may be empty — caller-supplied). */
  readonly appliedPolicies: readonly string[];
}

// ---------------------------------------------------------------------------
// The versioned evaluation-case record
// ---------------------------------------------------------------------------

/**
 * A versioned evaluation-case submission record. Append-only: a re-
 * submission of identical inputs is idempotent (the same record is
 * returned — proven by test). The case identity (`caseId`) is the
 * deterministic digest of (tenantId, problemClass, observationRefs,
 * context, actionHistoryRefs, outcome, labels, tenantPolicyRefs,
 * redaction) — stable across runs and input permutations.
 */
export interface EvaluationCaseRecord extends TenantScoped {
  /** Deterministic case identity: `arc_` + fnv1a32(content fields). */
  readonly caseId: string;
  /** Deterministic revision id: `arcv_` + fnv1a32(caseId, version). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  /** The append-only revision number (>= 1; always 1 for a fresh submission — idempotent re-submission returns the existing record). */
  readonly version: number;
  /** The case status (SUBMITTED / PARKED / REJECTED — the Guardian decision's projection). */
  readonly status: EvaluationCaseStatus;
  /** The problem class (machine-stable string — the capability class the case concerns). */
  readonly problemClass: string;
  /** The normalized observation refs (content-addressable strings — opaque to the control plane). */
  readonly observationRefs: readonly string[];
  /** The case context (JSON-serializable — the situation the case arose in). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The action history refs (content-addressable strings — past actions/intents the case cites). */
  readonly actionHistoryRefs: readonly string[];
  /** The ground-truth outcome. */
  readonly outcome: EvaluationOutcome;
  /** The evaluation labels (human-readable ground-truth annotations). */
  readonly labels: readonly EvaluationLabel[];
  /** The tenant policy refs in force at submission (content-addressable strings). */
  readonly tenantPolicyRefs: readonly string[];
  /** The redaction / de-identification state. */
  readonly redaction: RedactionRecord;
  /** The FROZEN Guardian decision (verbatim — the policy decision that gated the submission). */
  readonly guardianDecision: GuardianDecision;
  /** The injected submission timestamp (ISO 8601). */
  readonly submittedAt: string;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic case identity. */
export function evaluationCaseId(
  tenantId: TenantId,
  problemClass: string,
  observationRefs: readonly string[],
  context: Readonly<Record<string, unknown>>,
  actionHistoryRefs: readonly string[],
  outcome: EvaluationOutcome,
  labels: readonly EvaluationLabel[],
  tenantPolicyRefs: readonly string[],
  redaction: RedactionRecord,
): string {
  return `arc_${fnv1a32Hex(
    canonicalJson([
      tenantId,
      problemClass,
      observationRefs,
      context,
      actionHistoryRefs,
      outcome,
      labels,
      tenantPolicyRefs,
      redaction,
    ]),
  )}`;
}

/** The deterministic case REVISION id. */
export function evaluationCaseRecordId(caseId: string, version: number): string {
  return `arcv_${fnv1a32Hex(canonicalJson([caseId, version]))}`;
}

/** The canonical content digest of an evaluation-case revision's content fields. */
export function evaluationCaseContentDigest(
  record: Omit<EvaluationCaseRecord, "caseId" | "recordId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.version,
      record.status,
      record.problemClass,
      record.observationRefs,
      record.context,
      record.actionHistoryRefs,
      record.outcome,
      record.labels,
      record.tenantPolicyRefs,
      record.redaction,
      record.guardianDecision,
      record.submittedAt,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The tenant-partitioned submission ledger
// ---------------------------------------------------------------------------

/** The tagged result of a submission-ledger write. */
export type EvaluationCaseStoreWrite =
  | { readonly ok: true; readonly record: EvaluationCaseRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only evaluation-case submission ledger.
 * Every operation takes the acting `ArenaTenantScope` FIRST and touches
 * only the acting tenant's partition. Case revisions are append-only per
 * case id (a re-submission of identical inputs is idempotent — the
 * existing record is returned; never a duplicate, never a rewrite).
 */
export interface EvaluationCaseStore {
  /** Append a case revision into the ACTING tenant's partition (tenant must match). */
  appendCase(scope: ArenaTenantScope, record: EvaluationCaseRecord): EvaluationCaseStoreWrite;
  /** The LATEST revision of a case (own partition only; undefined when absent/foreign). */
  getLatestCase(scope: ArenaTenantScope, caseId: string): EvaluationCaseRecord | undefined;
  /** A specific revision of a case (own partition only). */
  getCaseRevision(scope: ArenaTenantScope, caseId: string, version: number): EvaluationCaseRecord | undefined;
  /** Every revision of a case, version order (own partition only). */
  listCaseRevisions(scope: ArenaTenantScope, caseId: string): readonly EvaluationCaseRecord[];
  /** All case ids in the acting partition (sorted). */
  listCaseIds(scope: ArenaTenantScope): readonly string[];
  /** The number of cases in the acting partition. */
  size(scope: ArenaTenantScope): number;
}

/**
 * Create the in-memory reference `EvaluationCaseStore`. Storage is
 * partitioned by tenant id; case revisions are append-only per case id
 * (the prior is never rewritten — versioned-interpretation discipline).
 *
 * The store audits NOTHING: every consequential case mutation's audit
 * (submitted / parked / rejected) is emitted by the domain boundary
 * function (`submitEvaluationCase`) through ITS injected sink — one
 * coherent emission policy across the arena package.
 */
export function createInMemoryEvaluationCaseStore(): EvaluationCaseStore {
  /** tenantId -> (caseId -> EvaluationCaseRecord[]). */
  const partitions = new Map<string, Map<string, EvaluationCaseRecord[]>>();

  function partitionOf(tenantId: string): Map<string, EvaluationCaseRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, EvaluationCaseRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: ArenaTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkArenaTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.caseStoreDomain,
          `arena evaluation-case store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ARENA_PIPELINE_CORRELATION_ID },
          "arena.case.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: ArenaTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? ARENA_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendCase(scope: ArenaTenantScope, record: EvaluationCaseRecord): EvaluationCaseStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            "arena evaluation case tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "arena.case.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(record.caseId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(record.caseId, revisions);
      }
      // Idempotent re-submission: if a record with the same version AND
      // content digest exists, return it verbatim (the same record —
      // never a duplicate).
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            "case version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "arena.case.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            `case revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "arena.case.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    getLatestCase(scope: ArenaTenantScope, caseId: string): EvaluationCaseRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(caseId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getCaseRevision(
      scope: ArenaTenantScope,
      caseId: string,
      version: number,
    ): EvaluationCaseRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(caseId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listCaseRevisions(scope: ArenaTenantScope, caseId: string): readonly EvaluationCaseRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(caseId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listCaseIds(scope: ArenaTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: ArenaTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Submission (the PROPOSAL-gated boundary)
// ---------------------------------------------------------------------------

/** The input of an evaluation-case submission. */
export interface SubmitEvaluationCaseInput {
  /** The problem class (machine-stable string — the capability class the case concerns). */
  readonly problemClass: string;
  /** The normalized observation refs (content-addressable strings — opaque to the control plane). */
  readonly observationRefs: readonly string[];
  /** The case context (JSON-serializable — the situation the case arose in). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The action history refs (content-addressable strings — past actions/intents the case cites). */
  readonly actionHistoryRefs: readonly string[];
  /** The ground-truth outcome. */
  readonly outcome: EvaluationOutcome;
  /** The evaluation labels (human-readable ground-truth annotations). */
  readonly labels: readonly EvaluationLabel[];
  /** The tenant policy refs in force at submission (content-addressable strings). */
  readonly tenantPolicyRefs: readonly string[];
  /** The redaction / de-identification state. */
  readonly redaction: RedactionRecord;
}

/** Options for `submitEvaluationCase`. */
export interface SubmitEvaluationCaseOptions<R> {
  /** The compiled Guardian rule set (the policy version the submission is evaluated against). */
  readonly ruleSet: R;
  /** The Guardian evaluation function (the structural seam — `@fleetos/policy`'s `evaluateGuardianRequest` is injected at the binding site). */
  readonly evaluator: GuardianEvaluateFn<R>;
  /** The Guardian evaluation request context (action, principal, device, evidence). */
  readonly request: ArenaGuardianRequest;
  /** The injected evaluation options (decision instant, correlation id, causation id). */
  readonly guardianOptions: ArenaGuardianOptions;
  /** The injected audit sink (the submission emits; default: no-op). */
  readonly auditSink?: ArenaAuditSink;
}

/**
 * Submit an evaluation case through the Contract Guardian. PURE: every
 * input (case payload, rule set, request, decision instant, correlation
 * id) is injected; the arena package reads no clock and no entropy.
 *
 * PROPOSAL-gated: the case advances ONLY when the Guardian decision is
 * ALLOW (or WARN — non-blocking). REQUIRE_APPROVAL parks the case for
 * human review; BLOCK rejects with the Guardian's machine-stable
 * reasons. NEVER auto-submit (ARENA.md invariant: the Guardian is the
 * sole authority for submission; raw model output never becomes action
 * permission — the case carries evaluation LABELS, never the model's
 * own output).
 *
 * DETERMINISTIC: the case identity + record content are pure functions
 * of (tenant, payload, decision) — re-submission of identical inputs
 * yields the same case id and a byte-identical record. The submission
 * ledger is append-only: a re-submission of identical inputs is
 * idempotent (the existing record is returned).
 *
 * Tenant isolation: the request's tenant MUST match the rule set's
 * tenant AND the acting scope's tenant — a tenant-A submission can
 * never be evaluated against tenant-B rules (the Guardian rejects
 * with a tagged `tenant_mismatch` error, never a wrong-tenant decision).
 *
 * Audit: consequential mutations (SUBMITTED / PARKED / REJECTED) emit
 * `arena.case.submitted` / `arena.case.parked` / `arena.case.rejected`
 * to the injected sink. Pure reads and failed validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the evaluation-case submission ledger
 * @param input the submission input (the case payload)
 * @param options the submission options (rule set, evaluator, request, decision instant)
 * @returns the tagged submission result
 */
export function submitEvaluationCase<R>(
  scope: ArenaTenantScope,
  store: EvaluationCaseStore,
  input: SubmitEvaluationCaseInput,
  options: SubmitEvaluationCaseOptions<R>,
): EvaluationCaseStoreWrite {
  const guard = checkArenaTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseStoreDomain,
        `arena evaluation-case store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: ARENA_PIPELINE_CORRELATION_ID },
        "arena.case.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.guardianOptions.correlationId ?? ARENA_PIPELINE_CORRELATION_ID,
  };
  // Input validation (pure, non-throwing — failures are collected as
  // validation errors carrying the frozen FleetError taxonomy).
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.problemClass !== "string" || input.problemClass.length === 0) {
    failures.push({ path: "/problemClass", reason: "required" });
  }
  if (!Array.isArray(input?.observationRefs) || input.observationRefs.length === 0 || !input.observationRefs.every((r) => typeof r === "string" && r.length > 0)) {
    failures.push({ path: "/observationRefs", reason: "string_array_required" });
  }
  if (input?.context === undefined || input.context === null || typeof input.context !== "object") {
    failures.push({ path: "/context", reason: "object_required" });
  }
  if (!Array.isArray(input?.actionHistoryRefs) || input.actionHistoryRefs.length === 0 || !input.actionHistoryRefs.every((r) => typeof r === "string" && r.length > 0)) {
    failures.push({ path: "/actionHistoryRefs", reason: "string_array_required" });
  }
  if (input?.outcome === undefined || input.outcome === null || typeof input.outcome !== "object") {
    failures.push({ path: "/outcome", reason: "object_required" });
  } else {
    const o = input.outcome as Partial<EvaluationOutcome>;
    if (typeof o.label !== "string" || o.label.length === 0) {
      failures.push({ path: "/outcome/label", reason: "required" });
    }
    if (typeof o.value !== "string" || o.value.length === 0) {
      failures.push({ path: "/outcome/value", reason: "required" });
    }
    if (typeof o.observedAt !== "string" || !looksLikeIso(o.observedAt)) {
      failures.push({ path: "/outcome/observedAt", reason: "not_iso" });
    }
    if (!Array.isArray(o.evidenceRefs)) {
      failures.push({ path: "/outcome/evidenceRefs", reason: "array_required" });
    }
  }
  if (!Array.isArray(input?.labels) || input.labels.length === 0 || !input.labels.every((l) => typeof l === "object" && typeof (l as { key?: unknown }).key === "string" && typeof (l as { value?: unknown }).value === "string")) {
    failures.push({ path: "/labels", reason: "label_array_required" });
  }
  if (!Array.isArray(input?.tenantPolicyRefs) || input.tenantPolicyRefs.length === 0 || !input.tenantPolicyRefs.every((r) => typeof r === "string" && r.length > 0)) {
    failures.push({ path: "/tenantPolicyRefs", reason: "string_array_required" });
  }
  if (input?.redaction === undefined || input.redaction === null || typeof input.redaction !== "object") {
    failures.push({ path: "/redaction", reason: "object_required" });
  } else {
    const r = input.redaction as Partial<RedactionRecord>;
    if (typeof r.state !== "string" || !(ALL_REDACTION_STATES as readonly string[]).includes(r.state)) {
      failures.push({ path: "/redaction/state", reason: "unknown_redaction_state" });
    }
    if (!Array.isArray(r.appliedPolicies) || !r.appliedPolicies.every((p) => typeof p === "string" && p.length > 0)) {
      failures.push({ path: "/redaction/appliedPolicies", reason: "string_array_required" });
    }
  }
  if (typeof options?.guardianOptions?.at !== "string" || !looksLikeIso(options.guardianOptions.at)) {
    failures.push({ path: "/guardianOptions/at", reason: "not_iso" });
  }
  if (typeof options?.guardianOptions?.correlationId !== "string" || options.guardianOptions.correlationId.length === 0) {
    failures.push({ path: "/guardianOptions/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.caseInvalid,
        "arena evaluation-case submission is invalid",
        trace,
        failures,
      ),
    };
  }
  // Tenant isolation by rejection: the request's tenant MUST match the
  // acting scope's tenant (the Guardian engine itself rejects
  // request/rule-set tenant mismatches; we surface the scope/request
  // mismatch here so the arena lane is fail-closed at the submission
  // boundary).
  if (guard.tenantId !== options.request.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseStoreDomain,
        "arena evaluation-case submission refused: acting scope tenant does not match request tenant",
        trace,
        "arena.case.submit",
        "tenant_mismatch",
      ),
    };
  }
  // Route through the Guardian.
  const outcome = options.evaluator(options.ruleSet, options.request, options.guardianOptions);
  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }
  const decision: GuardianDecision = outcome.evaluation.decision;
  const status = decisionToCaseStatus(decision.decision);
  const caseId = evaluationCaseId(
    guard.tenantId,
    input.problemClass,
    input.observationRefs,
    input.context,
    input.actionHistoryRefs,
    input.outcome,
    input.labels,
    input.tenantPolicyRefs,
    input.redaction,
  );
  const content: Omit<EvaluationCaseRecord, "caseId" | "recordId" | "contentDigest"> = {
    tenantId: guard.tenantId,
    version: 1,
    status,
    problemClass: input.problemClass,
    observationRefs: Object.freeze([...input.observationRefs]),
    context: Object.freeze({ ...(input.context as Record<string, unknown>) }) as Readonly<Record<string, unknown>>,
    actionHistoryRefs: Object.freeze([...input.actionHistoryRefs]),
    outcome: Object.freeze({
      label: input.outcome.label,
      value: input.outcome.value,
      observedAt: input.outcome.observedAt,
      evidenceRefs: Object.freeze([...input.outcome.evidenceRefs]),
    }) as EvaluationOutcome,
    labels: Object.freeze([...input.labels]) as readonly EvaluationLabel[],
    tenantPolicyRefs: Object.freeze([...input.tenantPolicyRefs]),
    redaction: Object.freeze({
      state: input.redaction.state,
      appliedPolicies: Object.freeze([...input.redaction.appliedPolicies]),
    }) as RedactionRecord,
    guardianDecision: decision,
    submittedAt: options.guardianOptions.at,
  };
  const record: EvaluationCaseRecord = frozen({
    ...content,
    caseId,
    recordId: evaluationCaseRecordId(caseId, 1),
    contentDigest: evaluationCaseContentDigest(content),
  });
  const write = store.appendCase(scope, record);
  if (!write.ok) return write;
  // Audit: consequential mutations only. SUBMITTED (ALLOW/WARN) audits
  // the durable submission; PARKED (REQUIRE_APPROVAL) audits the held-for-
  // review state; REJECTED (BLOCK) audits the refusal. The frozen
  // `isBlockingDecision` helper drives the emission policy.
  const sink: ArenaAuditSink = options.auditSink ?? NOOP_ARENA_AUDIT_SINK;
  const action =
    status === CASE_SUBMITTED
      ? ARENA_AUDIT_ACTIONS.caseSubmitted
      : status === CASE_PARKED
        ? ARENA_AUDIT_ACTIONS.caseParked
        : ARENA_AUDIT_ACTIONS.caseRejected;
  sink.append(
    frozen({
      action,
      tenantId: record.tenantId,
      subject: record.caseId,
      occurredAt: record.submittedAt,
      correlationId: trace.correlationId,
      causationId: options.guardianOptions.causationId,
      details: frozen({
        caseId: record.caseId,
        version: record.version,
        problemClass: record.problemClass,
        status: record.status,
        decision: decision.decision,
        isBlocking: isBlockingDecision(decision.decision),
        ruleSetId: outcome.evaluation.ruleSetId,
        ruleSetVersion: outcome.evaluation.ruleSetVersion,
        matchedRuleIds: outcome.evaluation.matchedRules.map((r) => r.ruleId),
        reasons: outcome.evaluation.reasons.map((r) => r.code),
        evidence: decision.evidence.map((e) => e.key),
        redactionState: record.redaction.state,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return write;
}

/**
 * Map a Guardian decision type to the evaluation-case status. Pure and
 * deterministic:
 *   - ALLOW          -> SUBMITTED (the case is durable in the ledger)
 *   - WARN           -> SUBMITTED (the case is durable; warnings carried verbatim)
 *   - REQUIRE_APPROVAL -> PARKED   (held for human review; never auto-submitted)
 *   - BLOCK          -> REJECTED  (refused with the Guardian's machine-stable reasons)
 *
 * The Guardian's decision types are reused (never re-declared) — they
 * are the FROZEN `@fleetos/contracts` constants.
 */
export function decisionToCaseStatus(
  decision: GuardianDecision["decision"],
): EvaluationCaseStatus {
  if (decision === "ALLOW") return CASE_SUBMITTED;
  if (decision === "WARN") return CASE_SUBMITTED;
  if (decision === "REQUIRE_APPROVAL") return CASE_PARKED;
  // BLOCK — the case is refused with the Guardian's machine-stable reasons.
  return CASE_REJECTED;
}
