/**
 * @fleetos/learning — D2: pure conversion of outcome observations into
 * Arena evaluation-case SUBMISSION PROPOSALS (the W050B arena adapter's
 * evaluation-case submission shapes consumed through a STRUCTURAL seam).
 *
 * The closed loop's midsection: OUTCOMES become CASE PROPOSALS. The
 * conversion is PURE and DETERMINISTIC — a pure function of (the outcome
 * observation, the tenant policy refs, the typed redaction state, the
 * extra labels). Identical inputs produce byte-identical drafts across
 * runs and input permutations (proven by test).
 *
 * The case shape (`EvaluationCaseProposalFacet`) is the STRUCTURAL TWIN
 * of the W050B arena adapter's `SubmitEvaluationCaseInput` — problem
 * class, normalized observation refs, context, action history refs,
 * outcome ground truth, evaluation labels, tenant policy refs, typed
 * redaction state. This package's src/ discipline permits only
 * `@fleetos/contracts` imports, so the twin is declared LOCALLY; the
 * real arena adapter consumes a draft's case UNCHANGED at the binding
 * site (TypeScript structural typing; proven by test — a gated proposal
 * flows through the REAL `submitEvaluationCase` into the REAL ledger).
 *
 * Ground-truth discipline (never fabricate labels): the conversion
 * REFUSES machine-stably when an outcome lacks required ground truth —
 * an empty outcome label/value (the bypassed-types case), a non-ISO
 * observed instant, empty observation refs or action history refs (the
 * arena submission requires both non-empty; a surface that produced no
 * observable refs cannot become a case), missing tenant policy refs, or
 * a malformed redaction record. Every refusal carries the frozen
 * FleetError taxonomy with field paths.
 *
 * PROPOSAL-gated (the conversion NEVER submits): the draft is advanced
 * ONLY by `gateEvaluationCaseProposal`, which consumes the FROZEN
 * `GuardianDecision` (from `@fleetos/contracts` — produced by the real
 * W031 engine at the binding site) and projects the disposition:
 *   - ALLOW / WARN          -> PROPOSED (the case may be submitted);
 *   - REQUIRE_APPROVAL      -> PARKED   (held for human review);
 *   - BLOCK                 -> REJECTED (refused with the Guardian's
 *                                        machine-stable reasons).
 * The mapping is the STRUCTURAL TWIN of the arena adapter's
 * `decisionToCaseStatus` (same decision types, same semantics — the
 * frozen decision types are reused, never re-declared). There is NO
 * submission path inside this package: the binding site hands the gated
 * proposal's `case` to the arena adapter, which owns the submission
 * ledger and its own Guardian routing.
 *
 * Audit: the gate audits the consequential disposition
 * (learning.case.proposed / parked / rejected) to the injected sink.
 * Pure conversions and failed validations never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  EvidenceRef,
  FleetError,
  GuardianDecision,
  GuardianDecisionType,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { LearningAuditSink } from "./audit-seam";
import { LEARNING_AUDIT_ACTIONS, NOOP_LEARNING_AUDIT_SINK } from "./audit-seam";
import type { OutcomeObservation } from "./outcome-observation";
import {
  ERROR_CODES,
  LEARNING_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { LearningTenantScope } from "./internal";
import { checkLearningTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The evaluation-case proposal facet (the W050B submission shape, structural)
// ---------------------------------------------------------------------------

/**
 * The redaction / de-identification state of an evaluation case — the
 * STRUCTURAL TWIN of the W050B arena adapter's `RedactionState` (the
 * same machine-stable union; the case carries the state EXPLICITLY, a
 * typed record — never a guessed flag).
 */
export type RedactionStateFacet = "raw" | "deidentified" | "redacted";

/** All redaction states (for validation + iteration). */
export const ALL_REDACTION_STATE_FACETS: readonly RedactionStateFacet[] = Object.freeze([
  "raw",
  "deidentified",
  "redacted",
]);

/**
 * The ground-truth outcome an evaluation case carries — the STRUCTURAL
 * TWIN of the arena adapter's `EvaluationOutcome` (label, value, the
 * injected observation instant, and the supporting evidence artifacts).
 */
export interface EvaluationOutcomeFacet {
  /** The outcome label (machine-stable). */
  readonly label: string;
  /** The outcome value (machine-stable; the capability's evaluation suite defines the value set). */
  readonly value: string;
  /** The injected observation instant of the outcome (ISO 8601). */
  readonly observedAt: string;
  /** The evidence artifacts supporting the outcome (content-addressable refs). */
  readonly evidenceRefs: readonly EvidenceRef[];
}

/**
 * An evaluation label — a key/value pair annotating the case with
 * ground truth. STRUCTURAL TWIN of the arena adapter's `EvaluationLabel`.
 */
export interface EvaluationLabelFacet {
  /** The label key (machine-stable). */
  readonly key: string;
  /** The label value (machine-stable string). */
  readonly value: string;
}

/**
 * The redaction / de-identification state record — STRUCTURAL TWIN of
 * the arena adapter's `RedactionRecord` (the state + the tenant policy
 * refs that governed the redaction, caller-supplied).
 */
export interface RedactionRecordFacet {
  /** The redaction state. */
  readonly state: RedactionStateFacet;
  /** The tenant policy refs that governed the redaction (may be empty — caller-supplied). */
  readonly appliedPolicies: readonly string[];
}

/**
 * The evaluation-case submission proposal's case payload — the
 * STRUCTURAL TWIN of the W050B arena adapter's `SubmitEvaluationCaseInput`
 * (problem class, normalized observation refs, context, action history
 * refs, outcome ground truth, evaluation labels, tenant policy refs,
 * typed redaction state). The real arena adapter's input type is
 * assignable to this facet and a facet value is assignable to the real
 * input type (bidirectional structural compatibility — proven by test:
 * a converted draft's `case` flows through the REAL
 * `submitEvaluationCase` unchanged).
 */
export interface EvaluationCaseProposalFacet {
  /** The problem class (machine-stable string — the capability class the case concerns). */
  readonly problemClass: string;
  /** The normalized observation refs (content-addressable strings — opaque to the control plane). */
  readonly observationRefs: readonly string[];
  /** The case context (JSON-serializable — the situation the case arose in). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The action history refs (content-addressable strings — past actions/intents the case cites). */
  readonly actionHistoryRefs: readonly string[];
  /** The ground-truth outcome. */
  readonly outcome: EvaluationOutcomeFacet;
  /** The evaluation labels (ground-truth annotations). */
  readonly labels: readonly EvaluationLabelFacet[];
  /** The tenant policy refs in force at submission (content-addressable strings). */
  readonly tenantPolicyRefs: readonly string[];
  /** The redaction / de-identification state. */
  readonly redaction: RedactionRecordFacet;
}

// ---------------------------------------------------------------------------
// The conversion (pure, deterministic, refusing)
// ---------------------------------------------------------------------------

/**
 * A converted evaluation-case SUBMISSION PROPOSAL draft — the pure
 * conversion product, NOT yet gated. The `proposalId` is the
 * deterministic digest of (tenantId, source observation id, case
 * content); identical inputs produce identical drafts (proven by test).
 */
export interface EvaluationCaseDraft {
  /** Deterministic proposal identity: `lcp_` + fnv1a32(tenant, source observation, case content). */
  readonly proposalId: string;
  readonly tenantId: TenantId;
  /** The outcome observation this draft was converted from. */
  readonly sourceObservationId: string;
  /** The case payload (structurally assignable to the arena adapter's submission input). */
  readonly case: EvaluationCaseProposalFacet;
  /** Canonical digest of the draft's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The tagged result of a conversion. */
export type EvaluationCaseConversion =
  | { readonly ok: true; readonly draft: EvaluationCaseDraft }
  | { readonly ok: false; readonly error: FleetError };

/** Options for `convertOutcomeToEvaluationCase`. */
export interface ConvertOutcomeOptions {
  /** The tenant policy refs in force (NON-EMPTY required — the arena submission requires them). */
  readonly tenantPolicyRefs: readonly string[];
  /** The typed redaction state (REQUIRED — the conversion never fabricates a redaction state). */
  readonly redaction: RedactionRecordFacet;
  /** Extra ground-truth labels to annotate the case with (derived labels are always present). */
  readonly extraLabels?: readonly EvaluationLabelFacet[];
}

/** The deterministic proposal identity. */
export function evaluationCaseProposalId(
  tenantId: TenantId,
  sourceObservationId: string,
  caseFacet: EvaluationCaseProposalFacet,
): string {
  return `lcp_${fnv1a32Hex(canonicalJson([tenantId, sourceObservationId, caseFacet]))}`;
}

/** The canonical content digest of a draft's content fields. */
export function evaluationCaseProposalContentDigest(
  draft: Omit<EvaluationCaseDraft, "proposalId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([draft.tenantId, draft.sourceObservationId, draft.case]),
  );
}

/**
 * Convert an outcome observation into an Arena evaluation-case
 * SUBMISSION PROPOSAL draft. PURE: a deterministic function of (the
 * observation, the tenant policy refs, the redaction state, the extra
 * labels); no clock, no entropy, no submission.
 *
 * Mapping (verbatim — nothing re-derived, nothing fabricated):
 *   - problemClass       <- observation.problemClass;
 *   - observationRefs    <- observation.observationRefs (already normalized);
 *   - context            <- observation.context (verbatim frozen copy);
 *   - actionHistoryRefs  <- observation.actionHistoryRefs (already normalized);
 *   - outcome            <- { label, value, observedAt: observation.observedAt,
 *                             evidenceRefs: observation.evidenceRefs };
 *   - labels             <- derived (source_surface, subject_ref, device when
 *                           present) + the caller's extraLabels;
 *   - tenantPolicyRefs   <- options.tenantPolicyRefs (injected);
 *   - redaction          <- options.redaction (injected, typed).
 *
 * REFUSES machine-stably when the outcome lacks required ground truth
 * (never fabricating labels): empty outcome label/value, non-ISO
 * observedAt, empty observation/action refs, empty problem class, a
 * non-object context, missing tenant policy refs, or a malformed
 * redaction record. The validation set mirrors the arena submission's
 * own requirements, so every convertible draft is submittable.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param observation the outcome observation to convert
 * @param options the conversion options (policy refs, redaction, extra labels)
 * @returns the tagged conversion result
 */
export function convertOutcomeToEvaluationCase(
  scope: LearningTenantScope,
  observation: OutcomeObservation,
  options: ConvertOutcomeOptions,
): EvaluationCaseConversion {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.conversionDomain,
        `learning evaluation-case conversion refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.conversion.convert",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: scope.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  // Validation (pure, non-throwing). The outcome's ground truth is the
  // core requirement — an outcome lacking it is refused, never patched.
  const failures: { path: string; reason: string }[] = [];
  if (observation === null || observation === undefined || typeof observation !== "object") {
    failures.push({ path: "/observation", reason: "object_required" });
  } else {
    if (observation.tenantId !== guard.tenantId) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.conversionDomain,
          "evaluation-case conversion refused: observation tenant does not match the acting tenant scope",
          trace,
          "learning.conversion.convert",
          "tenant_mismatch",
        ),
      };
    }
    if (typeof observation.problemClass !== "string" || observation.problemClass.length === 0) {
      failures.push({ path: "/observation/problemClass", reason: "required" });
    }
    if (
      !Array.isArray(observation.observationRefs) ||
      observation.observationRefs.length === 0 ||
      !observation.observationRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/observation/observationRefs", reason: "string_array_required" });
    }
    if (
      observation.context === undefined ||
      observation.context === null ||
      typeof observation.context !== "object"
    ) {
      failures.push({ path: "/observation/context", reason: "object_required" });
    }
    if (
      !Array.isArray(observation.actionHistoryRefs) ||
      observation.actionHistoryRefs.length === 0 ||
      !observation.actionHistoryRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/observation/actionHistoryRefs", reason: "string_array_required" });
    }
    if (typeof observation.observedAt !== "string" || !looksLikeIso(observation.observedAt)) {
      failures.push({ path: "/observation/observedAt", reason: "not_iso" });
    }
    if (typeof observation.observationId !== "string" || observation.observationId.length === 0) {
      failures.push({ path: "/observation/observationId", reason: "required" });
    }
    const outcome = (observation as { outcome?: unknown }).outcome;
    if (outcome === null || outcome === undefined || typeof outcome !== "object") {
      failures.push({ path: "/observation/outcome", reason: "object_required" });
    } else {
      const candidate = outcome as { label?: unknown; value?: unknown };
      if (typeof candidate.label !== "string" || candidate.label.length === 0) {
        failures.push({ path: "/observation/outcome/label", reason: "required" });
      }
      if (typeof candidate.value !== "string" || candidate.value.length === 0) {
        failures.push({ path: "/observation/outcome/value", reason: "required" });
      }
    }
  }
  if (options === null || options === undefined || typeof options !== "object") {
    failures.push({ path: "/options", reason: "object_required" });
  } else {
    if (
      !Array.isArray(options.tenantPolicyRefs) ||
      options.tenantPolicyRefs.length === 0 ||
      !options.tenantPolicyRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/options/tenantPolicyRefs", reason: "string_array_required" });
    }
    const redaction = options.redaction;
    if (redaction === null || redaction === undefined || typeof redaction !== "object") {
      failures.push({ path: "/options/redaction", reason: "object_required" });
    } else {
      if (
        typeof redaction.state !== "string" ||
        !(ALL_REDACTION_STATE_FACETS as readonly string[]).includes(redaction.state)
      ) {
        failures.push({ path: "/options/redaction/state", reason: "unknown_redaction_state" });
      }
      if (
        !Array.isArray(redaction.appliedPolicies) ||
        !redaction.appliedPolicies.every((p) => typeof p === "string" && p.length > 0)
      ) {
        failures.push({ path: "/options/redaction/appliedPolicies", reason: "string_array_required" });
      }
    }
    if (
      options.extraLabels !== undefined &&
      (!Array.isArray(options.extraLabels) ||
        !options.extraLabels.every(
          (l) =>
            typeof l === "object" &&
            l !== null &&
            typeof (l as { key?: unknown }).key === "string" &&
            (l as { key?: unknown }).key !== undefined &&
            ((l as { key?: unknown }).key as string).length > 0 &&
            typeof (l as { value?: unknown }).value === "string",
        ))
    ) {
      failures.push({ path: "/options/extraLabels", reason: "label_array_required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.conversionInvalid,
        "outcome observation cannot be converted into an evaluation-case proposal",
        trace,
        failures,
      ),
    };
  }
  // The conversion (verbatim mapping — nothing re-derived).
  const labels: EvaluationLabelFacet[] = [
    { key: "source_surface", value: observation.sourceSurface },
    { key: "subject_ref", value: observation.subjectRef },
    ...(observation.deviceId !== undefined
      ? [{ key: "device", value: observation.deviceId as string }]
      : []),
    ...(options.extraLabels ?? []),
  ];
  const caseFacet: EvaluationCaseProposalFacet = frozen({
    problemClass: observation.problemClass,
    observationRefs: Object.freeze([...observation.observationRefs]),
    context: frozen({ ...(observation.context as Record<string, unknown>) }) as Readonly<
      Record<string, unknown>
    >,
    actionHistoryRefs: Object.freeze([...observation.actionHistoryRefs]),
    outcome: frozen({
      label: observation.outcome.label,
      value: observation.outcome.value,
      observedAt: observation.observedAt,
      evidenceRefs: Object.freeze([...observation.evidenceRefs]),
    }),
    labels: Object.freeze(labels),
    tenantPolicyRefs: Object.freeze([...options.tenantPolicyRefs]),
    redaction: frozen({
      state: options.redaction.state,
      appliedPolicies: Object.freeze([...options.redaction.appliedPolicies]),
    }),
  });
  const content: Omit<EvaluationCaseDraft, "proposalId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    sourceObservationId: observation.observationId,
    case: caseFacet,
  });
  const draft: EvaluationCaseDraft = frozen({
    ...content,
    proposalId: evaluationCaseProposalId(
      guard.tenantId,
      observation.observationId,
      caseFacet,
    ),
    contentDigest: evaluationCaseProposalContentDigest(content),
  });
  return { ok: true, draft };
}

// ---------------------------------------------------------------------------
// The Guardian gate (the frozen GuardianDecision seam)
// ---------------------------------------------------------------------------

/** The gated proposal may be submitted (Guardian ALLOW or WARN). */
export const CASE_PROPOSAL_PROPOSED = "PROPOSED" as const;
/** The gated proposal is held for human review (Guardian REQUIRE_APPROVAL). */
export const CASE_PROPOSAL_PARKED = "PARKED" as const;
/** The gated proposal is refused (Guardian BLOCK). */
export const CASE_PROPOSAL_REJECTED = "REJECTED" as const;

/**
 * The disposition of an evaluation-case submission proposal — the
 * projection of the FROZEN Guardian decision onto the proposal's fate.
 */
export type EvaluationCaseDisposition =
  | typeof CASE_PROPOSAL_PROPOSED
  | typeof CASE_PROPOSAL_PARKED
  | typeof CASE_PROPOSAL_REJECTED;

/** All evaluation-case dispositions (for validation + iteration). */
export const ALL_EVALUATION_CASE_DISPOSITIONS: readonly EvaluationCaseDisposition[] = Object.freeze([
  CASE_PROPOSAL_PROPOSED,
  CASE_PROPOSAL_PARKED,
  CASE_PROPOSAL_REJECTED,
]);

/**
 * Map a Guardian decision type to the proposal disposition. Pure and
 * deterministic — the STRUCTURAL TWIN of the W050B arena adapter's
 * `decisionToCaseStatus` (same frozen decision types, same semantics):
 *   - ALLOW          -> PROPOSED (the case may be submitted);
 *   - WARN           -> PROPOSED (non-blocking; warnings carried verbatim
 *                        in the frozen decision);
 *   - REQUIRE_APPROVAL -> PARKED   (held for human review; never auto-submitted);
 *   - BLOCK          -> REJECTED  (refused with the Guardian's machine-stable reasons).
 */
export function decisionToDisposition(
  decision: GuardianDecisionType,
): EvaluationCaseDisposition {
  if (decision === "ALLOW") return CASE_PROPOSAL_PROPOSED;
  if (decision === "WARN") return CASE_PROPOSAL_PROPOSED;
  if (decision === "REQUIRE_APPROVAL") return CASE_PROPOSAL_PARKED;
  // BLOCK — the proposal is refused with the Guardian's reasons.
  return CASE_PROPOSAL_REJECTED;
}

/**
 * A GATED evaluation-case submission proposal — the closed loop's
 * output. Carries the disposition (the Guardian decision's projection),
 * the case payload (structurally assignable to the arena adapter's
 * submission input — the binding site submits it), and the FROZEN
 * Guardian decision VERBATIM (the policy evidence trail,
 * ARCHITECTURE-LOCK item 4).
 */
export interface EvaluationCaseSubmissionProposal extends TenantScoped {
  /** Deterministic proposal identity (mirrors the draft's). */
  readonly proposalId: string;
  readonly tenantId: TenantId;
  /** The outcome observation this proposal was converted from. */
  readonly sourceObservationId: string;
  /** The Guardian-gated disposition. */
  readonly disposition: EvaluationCaseDisposition;
  /** The case payload (structurally assignable to the arena submission input). */
  readonly case: EvaluationCaseProposalFacet;
  /** The FROZEN Guardian decision that gated the proposal (verbatim). */
  readonly guardianDecision: GuardianDecision;
  /** Canonical digest of the proposal's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The tagged result of the gate. */
export type EvaluationCaseGateResult =
  | { readonly ok: true; readonly proposal: EvaluationCaseSubmissionProposal }
  | { readonly ok: false; readonly error: FleetError };

/** Options for `gateEvaluationCaseProposal`. */
export interface GateProposalOptions {
  /** The injected audit sink (the disposition emits; default: no-op). */
  readonly auditSink?: LearningAuditSink;
  /** The causation id, when the gating is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

/**
 * Gate an evaluation-case submission proposal through the Contract
 * Guardian decision. PURE: the draft and the decision are inputs; this
 * gate reads no clock, no entropy, and NEVER submits (the arena adapter
 * owns the submission ledger).
 *
 * The decision is the FROZEN `GuardianDecision` from
 * `@fleetos/contracts` — at the binding site the REAL W031 engine
 * (`@fleetos/policy`'s `evaluateGuardianRequest`) produces it and this
 * gate consumes it structurally (proven by test across all four
 * decision types). The decision's tenant MUST match the acting scope's
 * tenant — a tenant-A proposal can never be gated by a tenant-B
 * decision (fail-closed `tenant_mismatch`, never a wrong-tenant gate).
 *
 * Audit: the disposition is consequential — PROPOSED, PARKED and
 * REJECTED each emit (`learning.case.proposed` / `.parked` /
 * `.rejected`) carrying the decision's rule refs and reasons. Failed
 * validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param draft the converted draft
 * @param decision the FROZEN Guardian decision gating the submission
 * @param options the gate options (audit sink, causation id)
 * @returns the tagged gate result
 */
export function gateEvaluationCaseProposal(
  scope: LearningTenantScope,
  draft: EvaluationCaseDraft,
  decision: GuardianDecision,
  options: GateProposalOptions = {},
): EvaluationCaseGateResult {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.conversionDomain,
        `learning evaluation-case gate refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.conversion.gate",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: scope.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  const failures: { path: string; reason: string }[] = [];
  if (draft === null || draft === undefined || typeof draft !== "object") {
    failures.push({ path: "/draft", reason: "object_required" });
  } else {
    if (typeof draft.proposalId !== "string" || draft.proposalId.length === 0) {
      failures.push({ path: "/draft/proposalId", reason: "required" });
    }
    if (typeof draft.sourceObservationId !== "string" || draft.sourceObservationId.length === 0) {
      failures.push({ path: "/draft/sourceObservationId", reason: "required" });
    }
    if (draft.case === null || draft.case === undefined || typeof draft.case !== "object") {
      failures.push({ path: "/draft/case", reason: "object_required" });
    }
  }
  if (decision === null || decision === undefined || typeof decision !== "object") {
    failures.push({ path: "/decision", reason: "object_required" });
  } else {
    if (typeof decision.decision !== "string" || decision.decision.length === 0) {
      failures.push({ path: "/decision/decision", reason: "required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.conversionInvalid,
        "evaluation-case proposal gating is invalid",
        trace,
        failures,
      ),
    };
  }
  // Tenant isolation by rejection: the decision's tenant MUST match the
  // acting scope's tenant AND the draft's tenant.
  if (decision.tenantId !== guard.tenantId || draft.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.conversionDomain,
        "evaluation-case proposal gating refused: decision/draft tenant does not match the acting tenant scope",
        trace,
        "learning.conversion.gate",
        "tenant_mismatch",
      ),
    };
  }
  const disposition = decisionToDisposition(decision.decision);
  const content: Omit<EvaluationCaseSubmissionProposal, "proposalId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    sourceObservationId: draft.sourceObservationId,
    disposition,
    case: draft.case,
    guardianDecision: decision,
  });
  const proposal: EvaluationCaseSubmissionProposal = frozen({
    ...content,
    proposalId: draft.proposalId,
    contentDigest: fnv1a32Hex(
      canonicalJson([
        content.tenantId,
        content.sourceObservationId,
        content.disposition,
        content.case,
        decision.decision,
        decision.decidedAt,
        decision.rules,
        decision.evidence,
      ]),
    ),
  });
  // Audit: the disposition is consequential (a decision a later actor
  // must be able to reconstruct — item 4's evidence trail).
  const sink: LearningAuditSink = options.auditSink ?? NOOP_LEARNING_AUDIT_SINK;
  const action =
    disposition === CASE_PROPOSAL_PROPOSED
      ? LEARNING_AUDIT_ACTIONS.caseProposed
      : disposition === CASE_PROPOSAL_PARKED
        ? LEARNING_AUDIT_ACTIONS.caseParked
        : LEARNING_AUDIT_ACTIONS.caseRejected;
  sink.append(
    frozen({
      action,
      tenantId: proposal.tenantId,
      subject: proposal.proposalId,
      occurredAt: decision.decidedAt,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        proposalId: proposal.proposalId,
        sourceObservationId: proposal.sourceObservationId,
        disposition: proposal.disposition,
        decision: decision.decision,
        matchedRuleIds: decision.rules.map((r) => r.ruleId),
        evidence: decision.evidence.map((e) => e.key),
        problemClass: draft.case.problemClass,
        contentDigest: proposal.contentDigest,
      }),
    }),
  );
  return { ok: true, proposal };
}
