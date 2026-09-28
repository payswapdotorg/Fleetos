/**
 * @fleetos/learning — D1: typed, provider-neutral OUTCOME observation
 * records derived from the established domain surfaces through
 * STRUCTURAL seams (the W040-disclosed pattern).
 *
 * The closed loop's intake: FLEET OUTCOMES become evaluation evidence.
 * Per the W070 work order, four surfaces disclose their outcomes:
 *   - health treatment outcomes (W021 — diagnosis recommendations
 *     accepted/dismissed);
 *   - action plan outcomes (W041 — transitions to terminal states);
 *   - delivery outcomes (W050C — aurum delivery metadata);
 *   - maintenance work-order outcomes (W042).
 *
 * Every outcome observation carries:
 *   - tenant scope                (`tenantId`, validated by the guard);
 *   - subject ref                 (the entity the outcome is about);
 *   - outcome label/value         (the GROUND-TRUTH annotation — never
 *                                  an inferred intent; ARCHITECTURE-LOCK
 *                                  item 11);
 *   - evidence refs               (opaque content-addressable strings);
 *   - an observedAt instant that is INJECTED (never a clock read).
 *
 * The seams are STRUCTURAL: each facet is a structural twin of the real
 * domain record (W021's `DiagnosisHypothesis` / `TreatmentRecommendation`
 * / `HypothesisDismissal`, W041's `ActionPlanTemplate`, W050C's
 * `DeliveryRecord`, W042's `ServiceWorkOrder`). This package's src/
 * discipline permits only `@fleetos/contracts` imports, so the real
 * packages are injected at the binding sites (test/ files may import
 * across lanes — the established pattern) and every real record flows
 * through its facet UNCHANGED (TypeScript structural typing; proven by
 * test).
 *
 * Ground-truth discipline (never fabricate labels):
 *   - a DISMISSED treatment derives its ground truth from the recorded
 *     operator/policy judgment (the dismissal's machine-stable reason);
 *   - an ACCEPTED treatment requires NON-EMPTY observable acceptance
 *     refs (e.g. the work order that cites the recommendation) — without
 *     observable consequences acceptance is NOT asserted;
 *   - an action plan yields an outcome ONLY in a terminal status
 *     (ADVANCED / APPROVED / REJECTED — the structural twin of W041's
 *     terminal set);
 *   - a delivery record yields an outcome ONLY with a terminal
 *     disposition (succeeded / failed — `in_progress` is refused);
 *   - a maintenance work-order outcome requires the INJECTED fulfillment
 *     annotation (the human/operational ground-truth judgment).
 *
 * Determinism: observation ids and content digests are FNV-1a over
 * canonical JSON of the identity/content tuples; observation refs and
 * evidence refs are normalized (deduplicated + sorted), so identical
 * inputs in ANY order produce byte-identical records (proven by test).
 *
 * Tenant isolation is BY CONSTRUCTION (the W012 pattern): every store
 * operation takes the acting `LearningTenantScope` FIRST; storage is
 * partitioned per tenant; a foreign observation id is indistinguishable
 * from an unknown one.
 *
 * Audit: the `recordOutcomeObservation` boundary audits the consequential
 * append (a NEW observation record) to the injected sink. Pure reads,
 * failed derivations and idempotent re-appends never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  CausationId,
  CorrelationId,
  DeviceId,
  EvidenceRef,
  FleetError,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { LearningAuditSink } from "./audit-seam";
import { LEARNING_AUDIT_ACTIONS, NOOP_LEARNING_AUDIT_SINK } from "./audit-seam";
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
  normalizeEvidence,
  normalizeRefs,
} from "./internal";
import type { LearningTenantScope } from "./internal";
import { checkLearningTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The source surfaces (machine-stable) + problem classes
// ---------------------------------------------------------------------------

/** The health treatment surface (W021 diagnosis recommendations). */
export const OUTCOME_SOURCE_HEALTH_TREATMENT = "health.treatment" as const;
/** The action plan surface (W041 terminal transitions). */
export const OUTCOME_SOURCE_ACTION_PLAN = "action.plan" as const;
/** The aurum delivery surface (W050C delivery metadata). */
export const OUTCOME_SOURCE_AURUM_DELIVERY = "aurum.delivery" as const;
/** The maintenance work-order surface (W042). */
export const OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER = "maintenance.work_order" as const;

/**
 * The established domain surfaces an outcome observation may be derived
 * from. Closed and machine-stable — the W070 work order's four surfaces.
 */
export type OutcomeSourceSurface =
  | typeof OUTCOME_SOURCE_HEALTH_TREATMENT
  | typeof OUTCOME_SOURCE_ACTION_PLAN
  | typeof OUTCOME_SOURCE_AURUM_DELIVERY
  | typeof OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER;

/** All outcome source surfaces (for validation + iteration). */
export const ALL_OUTCOME_SOURCE_SURFACES: readonly OutcomeSourceSurface[] = Object.freeze([
  OUTCOME_SOURCE_HEALTH_TREATMENT,
  OUTCOME_SOURCE_ACTION_PLAN,
  OUTCOME_SOURCE_AURUM_DELIVERY,
  OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER,
]);

/** The problem class of the health treatment surface's evaluation cases. */
export const HEALTH_TREATMENT_PROBLEM_CLASS = "device.health.treatment" as const;
/** The problem class of the action plan surface's evaluation cases. */
export const ACTION_PLAN_PROBLEM_CLASS = "fleet.action.plan" as const;
/** The problem class of the delivery surface's evaluation cases. */
export const DELIVERY_PROBLEM_CLASS = "communication.delivery" as const;
/** The problem class of the maintenance work-order surface's evaluation cases. */
export const MAINTENANCE_WORK_ORDER_PROBLEM_CLASS = "maintenance.service.work_order" as const;

// ---------------------------------------------------------------------------
// The ground-truth annotation + the outcome observation record
// ---------------------------------------------------------------------------

/**
 * The ground-truth annotation an outcome observation carries. The label
 * and value are machine-stable strings; the OWNING surface defines the
 * value set (e.g. `treatment_dismissed`/`operator_rejected`,
 * `action_plan_outcome`/`APPROVED`, `message_delivery`/`succeeded`). The
 * learning package never re-derives or fabricates a ground truth — every
 * seam REFUSES machine-stably when the source surface lacks the required
 * annotation (never fabricating labels).
 */
export interface OutcomeGroundTruth {
  /** The outcome label (machine-stable — e.g. "treatment_dismissed"). */
  readonly label: string;
  /** The outcome value (machine-stable; the owning surface defines the value set). */
  readonly value: string;
}

/**
 * A typed, provider-neutral OUTCOME observation record — the closed
 * loop's intake. Deterministic identity: `observationId` is the FNV-1a
 * digest of (tenantId, sourceSurface, subjectRef, ground truth,
 * observedAt). Frozen at construction; append-only in the store.
 */
export interface OutcomeObservation extends TenantScoped {
  /** Deterministic observation identity: `loo_` + fnv1a32(identity tuple). */
  readonly observationId: string;
  readonly tenantId: TenantId;
  /** The established domain surface the outcome was derived from. */
  readonly sourceSurface: OutcomeSourceSurface;
  /** The entity the outcome is about (recommendation id, plan id, message ref, work order id). */
  readonly subjectRef: string;
  /** The problem class of the evaluation cases this observation feeds (machine-stable). */
  readonly problemClass: string;
  /** The device the outcome concerns, when the surface is device-scoped. */
  readonly deviceId?: DeviceId;
  /** Normalized observation refs (deduplicated + sorted content-addressable strings). */
  readonly observationRefs: readonly string[];
  /** Normalized action history refs (deduplicated + sorted — past actions/intents the outcome cites). */
  readonly actionHistoryRefs: readonly string[];
  /** The situation the outcome arose in (JSON-serializable, derived verbatim from the surface). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The ground-truth annotation. */
  readonly outcome: OutcomeGroundTruth;
  /** The evidence artifacts supporting the outcome (content-addressable refs; normalized by key). */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The INJECTED observation instant (ISO 8601 — never a clock read). */
  readonly observedAt: string;
  /** Canonical digest of the record's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The tagged result of an outcome-observation derivation. */
export type OutcomeObservationBuild =
  | { readonly ok: true; readonly observation: OutcomeObservation }
  | { readonly ok: false; readonly error: FleetError };

/** Options shared by every outcome-observation seam. */
export interface ObserveOutcomeOptions {
  /** The INJECTED observation instant (ISO 8601 — never a clock read). */
  readonly observedAt: string;
  /** The correlation id of the observation request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the observation is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** Extra caller-supplied evidence artifacts (merged with the surface-derived evidence). */
  readonly evidenceRefs?: readonly EvidenceRef[];
}

/** The deterministic observation identity. */
export function outcomeObservationId(
  tenantId: TenantId,
  sourceSurface: OutcomeSourceSurface,
  subjectRef: string,
  outcome: OutcomeGroundTruth,
  observedAt: string,
): string {
  return `loo_${fnv1a32Hex(canonicalJson([tenantId, sourceSurface, subjectRef, outcome, observedAt]))}`;
}

/** The canonical content digest of an outcome observation's content fields. */
export function outcomeObservationContentDigest(
  observation: Omit<OutcomeObservation, "observationId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      observation.tenantId,
      observation.sourceSurface,
      observation.subjectRef,
      observation.problemClass,
      observation.deviceId ?? null,
      observation.observationRefs,
      observation.actionHistoryRefs,
      observation.context,
      observation.outcome,
      observation.evidenceRefs,
      observation.observedAt,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The health treatment seam (W021 — structural twins)
// ---------------------------------------------------------------------------

/**
 * A W021 diagnosis hypothesis — a STRUCTURAL twin of `@fleetos/health`'s
 * `DiagnosisHypothesis` (the module-map edge `learning -> health` honored
 * via typed structural shapes; this package's src/ discipline permits
 * only `@fleetos/contracts` imports). The binding site passes health's
 * REAL hypothesis through this shape (proven by test); only the fields
 * the seam consumes are declared.
 */
export interface HealthHypothesisFacet {
  /** Deterministic id (`hyp_` + digest). */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The hypothesized cause id (e.g. "health.battery_aging"). */
  readonly causeId: string;
  /** The human-readable cause label. */
  readonly label: string;
  /** The hypothesis confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The anomaly evidence links (each cites the observations behind the anomaly). */
  readonly evidence: readonly {
    readonly anomalyId: string;
    readonly observationIds: readonly string[];
  }[];
  readonly interpretationVersion: number;
  /** The injected proposal timestamp. */
  readonly proposedAt: string;
}

/**
 * A W021 treatment recommendation — a STRUCTURAL twin of
 * `@fleetos/health`'s `TreatmentRecommendation`. A PROPOSAL (the real
 * record carries a draft intent payload and NO intent id); the seam
 * never interprets the payload, only the intent KIND (a machine-stable
 * string).
 */
export interface HealthTreatmentFacet {
  /** Deterministic id (`tr_` + digest). */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The hypothesis this treatment proposes to treat. */
  readonly hypothesisId: string;
  /** The stable action identifier from the cause's treatment template. */
  readonly actionId: string;
  /** The draft Fleet Intent proposal (kind + payload; the seam reads only the kind). */
  readonly proposedIntent: { readonly intentKind: string; readonly payload: unknown };
  /** The confidence inherited from the hypothesis. */
  readonly confidence: number;
  readonly recommendationVersion: number;
  /** The injected proposal timestamp. */
  readonly proposedAt: string;
}

/**
 * A recorded hypothesis dismissal — a STRUCTURAL twin of
 * `@fleetos/health`'s `HypothesisDismissal` (the operator/policy
 * judgment; the reason is machine-stable).
 */
export interface HealthDismissalFacet {
  /** The dismissed hypothesis. */
  readonly hypothesisId: string;
  /** Machine-stable dismissal reason (e.g. "operator_rejected", "stale_evidence"). */
  readonly reason: string;
  /** The injected dismissal timestamp. */
  readonly dismissedAt: string;
  readonly correlationId: CorrelationId;
  /** Free-form context, when present. */
  readonly note?: string;
}

/**
 * The observable treatment decision. DISMISSED derives its ground truth
 * from the recorded dismissal (the machine-stable reason). ACCEPTED
 * requires observable consequence refs — the artifacts that cite the
 * recommendation (e.g. the W042 work order id, a dispatched intent ref):
 * per ARCHITECTURE-LOCK item 11 the seam NEVER asserts an unobservable
 * intent, so acceptance without observable consequences is REFUSED.
 */
export type HealthTreatmentDecision =
  | { readonly kind: "dismissed"; readonly dismissal: HealthDismissalFacet }
  | {
      readonly kind: "accepted";
      /** The machine-stable acceptance channel (e.g. "service_escalation", "intent_dispatched"). */
      readonly acceptanceChannel: string;
      /** NON-EMPTY observable refs proving the acceptance (refusal when empty). */
      readonly acceptanceRefs: readonly string[];
    };

/**
 * Observe a health treatment outcome (W021). PURE: every input is
 * injected; the seam reads no clock and no entropy. The observedAt
 * instant is INJECTED (the source records' instants land in the context
 * verbatim — they are evidence, not the observation instant).
 *
 * Ground truth:
 *   - dismissed -> { label: "treatment_dismissed", value: dismissal.reason };
 *   - accepted  -> { label: "treatment_accepted", value: acceptanceChannel }
 *     (only with non-empty acceptanceRefs).
 *
 * Refusals (machine-stable, never a fabricated label): missing/malformed
 * facets, tenant mismatch, a recommendation that does not cite the
 * hypothesis, a dismissal that targets a different hypothesis, an
 * acceptance without observable refs, a non-ISO injected instant.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the health treatment source (hypothesis + recommendation + decision)
 * @param options the observation options (injected instant + trace)
 * @returns the tagged observation build
 */
export function observeHealthTreatmentOutcome(
  scope: LearningTenantScope,
  source: {
    readonly hypothesis: HealthHypothesisFacet;
    readonly recommendation: HealthTreatmentFacet;
    readonly decision: HealthTreatmentDecision;
  },
  options: ObserveOutcomeOptions,
): OutcomeObservationBuild {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `learning outcome-observation boundary refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.observation.health",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  // Input validation (pure, non-throwing — failures are collected with
  // field paths; the ground-truth discipline refusals are domain errors).
  const failures: { path: string; reason: string }[] = [];
  const hypothesis = source?.hypothesis;
  const recommendation = source?.recommendation;
  const decision = source?.decision;
  if (hypothesis === null || hypothesis === undefined || typeof hypothesis !== "object") {
    failures.push({ path: "/hypothesis", reason: "object_required" });
  } else {
    if (typeof hypothesis.id !== "string" || hypothesis.id.length === 0) {
      failures.push({ path: "/hypothesis/id", reason: "required" });
    }
    if (typeof hypothesis.causeId !== "string" || hypothesis.causeId.length === 0) {
      failures.push({ path: "/hypothesis/causeId", reason: "required" });
    }
    if (!Array.isArray(hypothesis.evidence)) {
      failures.push({ path: "/hypothesis/evidence", reason: "array_required" });
    }
    if (typeof hypothesis.proposedAt !== "string" || !looksLikeIso(hypothesis.proposedAt)) {
      failures.push({ path: "/hypothesis/proposedAt", reason: "not_iso" });
    }
  }
  if (recommendation === null || recommendation === undefined || typeof recommendation !== "object") {
    failures.push({ path: "/recommendation", reason: "object_required" });
  } else {
    if (typeof recommendation.id !== "string" || recommendation.id.length === 0) {
      failures.push({ path: "/recommendation/id", reason: "required" });
    }
    if (typeof recommendation.hypothesisId !== "string" || recommendation.hypothesisId.length === 0) {
      failures.push({ path: "/recommendation/hypothesisId", reason: "required" });
    }
    if (typeof recommendation.actionId !== "string" || recommendation.actionId.length === 0) {
      failures.push({ path: "/recommendation/actionId", reason: "required" });
    }
    if (
      recommendation.proposedIntent === null ||
      typeof recommendation.proposedIntent !== "object" ||
      typeof recommendation.proposedIntent.intentKind !== "string" ||
      recommendation.proposedIntent.intentKind.length === 0
    ) {
      failures.push({ path: "/recommendation/proposedIntent/intentKind", reason: "required" });
    }
    if (typeof recommendation.proposedAt !== "string" || !looksLikeIso(recommendation.proposedAt)) {
      failures.push({ path: "/recommendation/proposedAt", reason: "not_iso" });
    }
  }
  if (decision === null || decision === undefined || typeof decision !== "object") {
    failures.push({ path: "/decision", reason: "object_required" });
  } else if (decision.kind === "dismissed") {
    const dismissal = decision.dismissal;
    if (dismissal === null || dismissal === undefined || typeof dismissal !== "object") {
      failures.push({ path: "/decision/dismissal", reason: "object_required" });
    } else {
      if (typeof dismissal.hypothesisId !== "string" || dismissal.hypothesisId.length === 0) {
        failures.push({ path: "/decision/dismissal/hypothesisId", reason: "required" });
      }
      if (typeof dismissal.reason !== "string" || dismissal.reason.length === 0) {
        failures.push({ path: "/decision/dismissal/reason", reason: "required" });
      }
      if (typeof dismissal.dismissedAt !== "string" || !looksLikeIso(dismissal.dismissedAt)) {
        failures.push({ path: "/decision/dismissal/dismissedAt", reason: "not_iso" });
      }
    }
  } else if (decision.kind === "accepted") {
    if (typeof decision.acceptanceChannel !== "string" || decision.acceptanceChannel.length === 0) {
      failures.push({ path: "/decision/acceptanceChannel", reason: "required" });
    }
    if (
      !Array.isArray(decision.acceptanceRefs) ||
      decision.acceptanceRefs.length === 0 ||
      !decision.acceptanceRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/decision/acceptanceRefs", reason: "non_empty_string_array_required" });
    }
  } else {
    failures.push({ path: "/decision/kind", reason: "unknown_decision_kind" });
  }
  if (typeof options?.observedAt !== "string" || !looksLikeIso(options.observedAt)) {
    failures.push({ path: "/observedAt", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationInvalid,
        "health treatment outcome observation is invalid",
        trace,
        failures,
      ),
    };
  }
  // Tenant isolation by rejection: every facet's tenant MUST match the
  // acting scope's tenant.
  if (hypothesis.tenantId !== guard.tenantId || recommendation.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "health treatment outcome observation refused: facet tenant does not match the acting tenant scope",
        trace,
        "learning.observation.health",
        "tenant_mismatch",
      ),
    };
  }
  // Structural coherence: the recommendation MUST cite the hypothesis.
  if (recommendation.hypothesisId !== hypothesis.id) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "health treatment outcome observation refused: recommendation does not cite the hypothesis",
        trace,
        "learning.observation.health",
        "recommendation_hypothesis_mismatch",
      ),
    };
  }
  // The ground-truth derivation (never fabricated).
  const groundTruth: OutcomeGroundTruth =
    decision.kind === "dismissed"
      ? frozen({ label: "treatment_dismissed", value: decision.dismissal.reason })
      : frozen({ label: "treatment_accepted", value: decision.acceptanceChannel });
  if (decision.kind === "dismissed" && decision.dismissal.hypothesisId !== hypothesis.id) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "health treatment outcome observation refused: dismissal targets a different hypothesis",
        trace,
        "learning.observation.health",
        "dismissal_hypothesis_mismatch",
      ),
    };
  }
  const evidenceLinks = Array.isArray(hypothesis.evidence) ? hypothesis.evidence : [];
  const observationRefs = normalizeRefs(
    evidenceLinks.flatMap((link) =>
      Array.isArray(link?.observationIds) ? [...link.observationIds] : [],
    ),
  );
  const actionHistoryRefs = normalizeRefs([hypothesis.id, recommendation.id]);
  const context: Record<string, unknown> = decision.kind === "dismissed"
    ? {
        deviceId: hypothesis.deviceId,
        causeId: hypothesis.causeId,
        causeLabel: hypothesis.label,
        actionId: recommendation.actionId,
        intentKind: recommendation.proposedIntent.intentKind,
        hypothesisConfidence: hypothesis.confidence,
        recommendationConfidence: recommendation.confidence,
        interpretationVersion: hypothesis.interpretationVersion,
        recommendationVersion: recommendation.recommendationVersion,
        hypothesisProposedAt: hypothesis.proposedAt,
        recommendationProposedAt: recommendation.proposedAt,
        dismissedAt: decision.dismissal.dismissedAt,
        dismissalNote: decision.dismissal.note,
      }
    : {
        deviceId: hypothesis.deviceId,
        causeId: hypothesis.causeId,
        causeLabel: hypothesis.label,
        actionId: recommendation.actionId,
        intentKind: recommendation.proposedIntent.intentKind,
        hypothesisConfidence: hypothesis.confidence,
        recommendationConfidence: recommendation.confidence,
        interpretationVersion: hypothesis.interpretationVersion,
        recommendationVersion: recommendation.recommendationVersion,
        hypothesisProposedAt: hypothesis.proposedAt,
        recommendationProposedAt: recommendation.proposedAt,
        acceptanceChannel: decision.acceptanceChannel,
        acceptanceRefs: normalizeRefs(decision.acceptanceRefs),
      };
  const evidence = normalizeEvidence([...(options.evidenceRefs ?? [])]);
  const observation = buildObservation(
    guard.tenantId,
    OUTCOME_SOURCE_HEALTH_TREATMENT,
    recommendation.id,
    HEALTH_TREATMENT_PROBLEM_CLASS,
    hypothesis.deviceId,
    observationRefs,
    actionHistoryRefs,
    context,
    groundTruth,
    evidence,
    options.observedAt,
  );
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------
// The action plan seam (W041 — structural twin)
// ---------------------------------------------------------------------------

/**
 * The terminal action-plan statuses — the STRUCTURAL twin of W041's
 * `TERMINAL_ACTION_PLAN_STATUSES` (the same machine-stable strings:
 * ADVANCED / APPROVED / REJECTED are terminal from the policy-gate
 * perspective). An in-flight plan (PROPOSAL / PARKED) has NO outcome
 * ground truth — the seam refuses it (never fabricating labels).
 */
export const TERMINAL_ACTION_PLAN_OUTCOME_STATUSES: readonly string[] = Object.freeze([
  "ADVANCED",
  "APPROVED",
  "REJECTED",
]);

/**
 * A W041 Fleet Action plan — a STRUCTURAL twin of `@fleetos/actions`'
 * `ActionPlanTemplate` (the module-map edge `learning -> actions` honored
 * via typed structural shapes). Only the fields the seam consumes are
 * declared; the real plan flows through unchanged (proven by test).
 */
export interface ActionPlanFacet {
  /** The deterministic plan identity. */
  readonly planId: string;
  readonly tenantId: TenantId;
  /** The stable human name. */
  readonly name: string;
  /** The plan version (>= 1; increments on every revision). */
  readonly version: number;
  /** The plan status (terminal statuses yield outcome ground truth). */
  readonly status: string;
  /** The intended capability invocation per target. */
  readonly capability: string;
  /** The resolved target device set. */
  readonly selectedTargets: readonly DeviceId[];
  /** The target count (mirrors `selectedTargets.length`). */
  readonly targetCount: number;
  /** ISO 8601 creation timestamp (injected upstream). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (absent on PROPOSAL). */
  readonly transitionedAt?: string;
  /** The plan's canonical content digest. */
  readonly contentDigest: string;
  /** Evidence artifacts supporting the plan (content-addressable; may be empty). */
  readonly evidence?: readonly EvidenceRef[];
}

/**
 * Observe an action plan outcome (W041). PURE. The plan MUST have
 * transitioned to a TERMINAL status — the terminal status IS the
 * observable ground truth (`{ label: "action_plan_outcome", value:
 * status }`). A non-terminal plan is refused machine-stably
 * (`plan_not_terminal` — an in-flight plan has no ground truth to
 * annotate).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the action plan source
 * @param options the observation options (injected instant + trace)
 * @returns the tagged observation build
 */
export function observeActionPlanOutcome(
  scope: LearningTenantScope,
  source: { readonly plan: ActionPlanFacet },
  options: ObserveOutcomeOptions,
): OutcomeObservationBuild {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `learning outcome-observation boundary refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.observation.action_plan",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  const plan = source?.plan;
  const failures: { path: string; reason: string }[] = [];
  if (plan === null || plan === undefined || typeof plan !== "object") {
    failures.push({ path: "/plan", reason: "object_required" });
  } else {
    if (typeof plan.planId !== "string" || plan.planId.length === 0) {
      failures.push({ path: "/plan/planId", reason: "required" });
    }
    if (typeof plan.status !== "string" || plan.status.length === 0) {
      failures.push({ path: "/plan/status", reason: "required" });
    }
    if (typeof plan.capability !== "string" || plan.capability.length === 0) {
      failures.push({ path: "/plan/capability", reason: "required" });
    }
    if (typeof plan.createdAt !== "string" || !looksLikeIso(plan.createdAt)) {
      failures.push({ path: "/plan/createdAt", reason: "not_iso" });
    }
  }
  if (typeof options?.observedAt !== "string" || !looksLikeIso(options.observedAt)) {
    failures.push({ path: "/observedAt", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationInvalid,
        "action plan outcome observation is invalid",
        trace,
        failures,
      ),
    };
  }
  if (plan.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "action plan outcome observation refused: plan tenant does not match the acting tenant scope",
        trace,
        "learning.observation.action_plan",
        "tenant_mismatch",
      ),
    };
  }
  // The terminal-status ground-truth gate: an in-flight plan has NO
  // outcome ground truth — refuse (never fabricate a label).
  if (!(TERMINAL_ACTION_PLAN_OUTCOME_STATUSES as readonly string[]).includes(plan.status)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `action plan outcome observation refused: plan status ${plan.status} is not terminal (no outcome ground truth)`,
        trace,
        "learning.observation.action_plan",
        "plan_not_terminal",
      ),
    };
  }
  const groundTruth: OutcomeGroundTruth = frozen({
    label: "action_plan_outcome",
    value: plan.status,
  });
  const planEvidence = Array.isArray(plan.evidence) ? plan.evidence : [];
  const observationRefs = normalizeRefs(planEvidence.map((e) => (typeof e?.key === "string" ? e.key : "")));
  const actionHistoryRefs = normalizeRefs([plan.planId]);
  const context: Record<string, unknown> = {
    planName: plan.name,
    capability: plan.capability,
    planVersion: plan.version,
    targetCount: plan.targetCount,
    selectedTargets: plan.selectedTargets,
    createdAt: plan.createdAt,
    transitionedAt: plan.transitionedAt,
    planContentDigest: plan.contentDigest,
  };
  const evidence = normalizeEvidence([...planEvidence, ...(options.evidenceRefs ?? [])]);
  const observation = buildObservation(
    guard.tenantId,
    OUTCOME_SOURCE_ACTION_PLAN,
    plan.planId,
    ACTION_PLAN_PROBLEM_CLASS,
    undefined,
    observationRefs,
    actionHistoryRefs,
    context,
    groundTruth,
    evidence,
    options.observedAt,
  );
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------
// The aurum delivery seam (W050C — structural twin)
// ---------------------------------------------------------------------------

/**
 * The terminal delivery dispositions — the STRUCTURAL twin of the W050C
 * aurum adapter's outcome dispositions, narrowed to the terminal pair.
 * `in_progress` is NOT an outcome (the delivery has not concluded) — the
 * seam refuses it (never fabricating labels).
 */
export const DELIVERY_OUTCOME_DISPOSITIONS: readonly string[] = Object.freeze([
  "succeeded",
  "failed",
]);

/**
 * A W050C delivery record — a STRUCTURAL twin of
 * `@fleetos/integration-aurum`'s `DeliveryRecord` (the module-map edge
 * `learning -> integration-aurum` honored via typed structural shapes).
 * Only the fields the seam consumes are declared; the real record flows
 * through unchanged (proven by test).
 */
export interface DeliveryFacet {
  readonly tenantId: TenantId;
  /** The emitted outbox message id this record reports on. */
  readonly messageRef: string;
  /** The 1-based delivery attempt this record describes. */
  readonly deliveryAttempt: number;
  /** The reported delivery state. */
  readonly state: string;
  /** The recipient metadata (provider-neutral ref + channel). */
  readonly recipient: {
    readonly recipientRef: string;
    readonly channel: string;
    readonly providerMessageId?: string;
  };
  /** The outcome disposition (state-derived; validated at ingestion). */
  readonly disposition: string;
  /** The injected ingestion instant (ISO 8601). */
  readonly ingestedAt: string;
  /** The record's canonical content digest. */
  readonly contentDigest: string;
}

/**
 * Observe a delivery outcome (W050C). PURE. The terminal disposition IS
 * the observable ground truth (`{ label: "message_delivery", value:
 * disposition }`). An `in_progress` record is refused machine-stably
 * (`disposition_in_progress`); an unknown disposition is refused
 * (`unknown_disposition`).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the delivery source
 * @param options the observation options (injected instant + trace)
 * @returns the tagged observation build
 */
export function observeDeliveryOutcome(
  scope: LearningTenantScope,
  source: { readonly delivery: DeliveryFacet },
  options: ObserveOutcomeOptions,
): OutcomeObservationBuild {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `learning outcome-observation boundary refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.observation.delivery",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  const delivery = source?.delivery;
  const failures: { path: string; reason: string }[] = [];
  if (delivery === null || delivery === undefined || typeof delivery !== "object") {
    failures.push({ path: "/delivery", reason: "object_required" });
  } else {
    if (typeof delivery.messageRef !== "string" || delivery.messageRef.length === 0) {
      failures.push({ path: "/delivery/messageRef", reason: "required" });
    }
    if (typeof delivery.state !== "string" || delivery.state.length === 0) {
      failures.push({ path: "/delivery/state", reason: "required" });
    }
    if (typeof delivery.ingestedAt !== "string" || !looksLikeIso(delivery.ingestedAt)) {
      failures.push({ path: "/delivery/ingestedAt", reason: "not_iso" });
    }
  }
  if (typeof options?.observedAt !== "string" || !looksLikeIso(options.observedAt)) {
    failures.push({ path: "/observedAt", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationInvalid,
        "delivery outcome observation is invalid",
        trace,
        failures,
      ),
    };
  }
  if (delivery.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "delivery outcome observation refused: delivery tenant does not match the acting tenant scope",
        trace,
        "learning.observation.delivery",
        "tenant_mismatch",
      ),
    };
  }
  // The terminal-disposition ground-truth gate.
  if (delivery.disposition === "in_progress") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "delivery outcome observation refused: disposition is in_progress (no terminal ground truth)",
        trace,
        "learning.observation.delivery",
        "disposition_in_progress",
      ),
    };
  }
  if (!(DELIVERY_OUTCOME_DISPOSITIONS as readonly string[]).includes(delivery.disposition)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `delivery outcome observation refused: unknown disposition ${String(delivery.disposition)}`,
        trace,
        "learning.observation.delivery",
        "unknown_disposition",
      ),
    };
  }
  const groundTruth: OutcomeGroundTruth = frozen({
    label: "message_delivery",
    value: delivery.disposition,
  });
  const observationRefs = normalizeRefs([delivery.messageRef]);
  const actionHistoryRefs = normalizeRefs([delivery.messageRef]);
  const context: Record<string, unknown> = {
    deliveryAttempt: delivery.deliveryAttempt,
    state: delivery.state,
    recipientRef: delivery.recipient?.recipientRef,
    channel: delivery.recipient?.channel,
    providerMessageId: delivery.recipient?.providerMessageId,
    ingestedAt: delivery.ingestedAt,
    deliveryContentDigest: delivery.contentDigest,
  };
  const evidence = normalizeEvidence([...(options.evidenceRefs ?? [])]);
  const observation = buildObservation(
    guard.tenantId,
    OUTCOME_SOURCE_AURUM_DELIVERY,
    delivery.messageRef,
    DELIVERY_PROBLEM_CLASS,
    undefined,
    observationRefs,
    actionHistoryRefs,
    context,
    groundTruth,
    evidence,
    options.observedAt,
  );
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------
// The maintenance work-order seam (W042 — structural twin)
// ---------------------------------------------------------------------------

/**
 * The diagnosis evidence a W042 work order cites — a STRUCTURAL twin of
 * `@fleetos/maintenance`'s `MaintenanceDiagnosisEvidence` narrowed to the
 * refs the seam consumes (the real shape additionally carries the DRAFT
 * intent proposal, which flows through unchanged and is ignored here).
 */
export interface MaintenanceDiagnosisFacet {
  /** The W021 diagnosis hypothesis id (a typed ref). */
  readonly hypothesisId: string;
  /** The W021 treatment-recommendation id (a typed ref). */
  readonly recommendationId: string;
  /** The hypothesized cause id (e.g. "health.battery_aging"). */
  readonly causeId: string;
  /** The hypothesis confidence in [0, 0.99]. */
  readonly confidence: number;
  /** The observation ids behind the anomalies that produced the hypothesis. */
  readonly observationIds: readonly string[];
}

/**
 * A W042 service work order — a STRUCTURAL twin of
 * `@fleetos/maintenance`'s `ServiceWorkOrder` (the module-map edge
 * `learning -> maintenance` honored via typed structural shapes). Only
 * the fields the seam consumes are declared; the real work order flows
 * through unchanged (proven by test).
 */
export interface MaintenanceWorkOrderFacet {
  /** Deterministic id (`swo_` + digest). */
  readonly workOrderId: string;
  readonly tenantId: TenantId;
  /** The device the work order concerns. */
  readonly deviceId: DeviceId;
  /** 1-based revision. */
  readonly revision: number;
  /** The diagnosis evidence the work order cites (W021 refs). */
  readonly diagnosis: MaintenanceDiagnosisFacet;
  /** The service area (free-form string; matched against vendor regions). */
  readonly serviceArea: string;
  /** The customer deadline (injected, ISO 8601). */
  readonly deadline: string;
  /** The service category id (a vendor capability id — e.g. "service.battery"). */
  readonly serviceCategory: string;
  /** Injected creation/revision timestamp. */
  readonly createdAt: string;
  /** The revision's canonical content digest. */
  readonly contentDigest: string;
}

/**
 * The INJECTED fulfillment annotation — the ground-truth judgment for a
 * maintenance work-order outcome (e.g. `{ outcomeLabel:
 * "service_fulfilled", outcomeValue: "warranty_covered" }`). The W042
 * surface records the ORDER; whether the service fulfilled the
 * treatment is an operational judgment the caller supplies with evidence.
 * The seam REFUSES machine-stably when the annotation is missing or
 * empty (never fabricating labels).
 */
export interface MaintenanceFulfillmentAnnotation {
  /** The outcome label (machine-stable — the owning surface defines the value set). */
  readonly outcomeLabel: string;
  /** The outcome value (machine-stable). */
  readonly outcomeValue: string;
  /** Evidence artifacts supporting the fulfillment judgment, when present. */
  readonly evidenceRefs?: readonly EvidenceRef[];
}

/**
 * Observe a maintenance work-order outcome (W042). PURE. The work order
 * supplies the structural scaffolding (subject, refs, context); the
 * ground truth is the INJECTED fulfillment annotation (required — the
 * seam never fabricates a fulfillment label).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the maintenance source (work order + fulfillment annotation)
 * @param options the observation options (injected instant + trace)
 * @returns the tagged observation build
 */
export function observeMaintenanceOutcome(
  scope: LearningTenantScope,
  source: {
    readonly workOrder: MaintenanceWorkOrderFacet;
    readonly fulfillment: MaintenanceFulfillmentAnnotation;
  },
  options: ObserveOutcomeOptions,
): OutcomeObservationBuild {
  const guard = checkLearningTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        `learning outcome-observation boundary refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
        "learning.observation.maintenance",
        guard.reason,
      ),
    };
  }
  const trace = { tenantId: guard.tenantId, correlationId: options?.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID };
  const workOrder = source?.workOrder;
  const fulfillment = source?.fulfillment;
  const failures: { path: string; reason: string }[] = [];
  if (workOrder === null || workOrder === undefined || typeof workOrder !== "object") {
    failures.push({ path: "/workOrder", reason: "object_required" });
  } else {
    if (typeof workOrder.workOrderId !== "string" || workOrder.workOrderId.length === 0) {
      failures.push({ path: "/workOrder/workOrderId", reason: "required" });
    }
    if (typeof workOrder.serviceCategory !== "string" || workOrder.serviceCategory.length === 0) {
      failures.push({ path: "/workOrder/serviceCategory", reason: "required" });
    }
    if (typeof workOrder.createdAt !== "string" || !looksLikeIso(workOrder.createdAt)) {
      failures.push({ path: "/workOrder/createdAt", reason: "not_iso" });
    }
    if (workOrder.diagnosis === null || typeof workOrder.diagnosis !== "object") {
      failures.push({ path: "/workOrder/diagnosis", reason: "object_required" });
    } else {
      for (const field of ["hypothesisId", "recommendationId", "causeId"] as const) {
        const value: unknown = workOrder.diagnosis[field];
        if (typeof value !== "string" || value.length === 0) {
          failures.push({ path: `/workOrder/diagnosis/${field}`, reason: "required" });
        }
      }
    }
  }
  if (fulfillment === null || fulfillment === undefined || typeof fulfillment !== "object") {
    failures.push({ path: "/fulfillment", reason: "object_required" });
  } else {
    if (typeof fulfillment.outcomeLabel !== "string" || fulfillment.outcomeLabel.length === 0) {
      failures.push({ path: "/fulfillment/outcomeLabel", reason: "required" });
    }
    if (typeof fulfillment.outcomeValue !== "string" || fulfillment.outcomeValue.length === 0) {
      failures.push({ path: "/fulfillment/outcomeValue", reason: "required" });
    }
  }
  if (typeof options?.observedAt !== "string" || !looksLikeIso(options.observedAt)) {
    failures.push({ path: "/observedAt", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.observationInvalid,
        "maintenance work-order outcome observation is invalid",
        trace,
        failures,
      ),
    };
  }
  if (workOrder.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.observationStoreDomain,
        "maintenance work-order outcome observation refused: work order tenant does not match the acting tenant scope",
        trace,
        "learning.observation.maintenance",
        "tenant_mismatch",
      ),
    };
  }
  const groundTruth: OutcomeGroundTruth = frozen({
    label: fulfillment.outcomeLabel,
    value: fulfillment.outcomeValue,
  });
  const diagnosis = workOrder.diagnosis;
  const observationRefs = normalizeRefs(
    Array.isArray(diagnosis.observationIds) ? [...diagnosis.observationIds] : [],
  );
  const actionHistoryRefs = normalizeRefs([
    diagnosis.hypothesisId,
    diagnosis.recommendationId,
    workOrder.workOrderId,
  ]);
  const context: Record<string, unknown> = {
    deviceId: workOrder.deviceId,
    causeId: diagnosis.causeId,
    serviceCategory: workOrder.serviceCategory,
    serviceArea: workOrder.serviceArea,
    deadline: workOrder.deadline,
    revision: workOrder.revision,
    diagnosisConfidence: diagnosis.confidence,
    createdAt: workOrder.createdAt,
    workOrderContentDigest: workOrder.contentDigest,
  };
  const evidence = normalizeEvidence([
    ...(Array.isArray(fulfillment.evidenceRefs) ? fulfillment.evidenceRefs : []),
    ...(options.evidenceRefs ?? []),
  ]);
  const observation = buildObservation(
    guard.tenantId,
    OUTCOME_SOURCE_MAINTENANCE_WORK_ORDER,
    workOrder.workOrderId,
    MAINTENANCE_WORK_ORDER_PROBLEM_CLASS,
    workOrder.deviceId,
    observationRefs,
    actionHistoryRefs,
    context,
    groundTruth,
    evidence,
    options.observedAt,
  );
  return { ok: true, observation };
}

// ---------------------------------------------------------------------------
// Observation construction (shared, deterministic)
// ---------------------------------------------------------------------------

/** Build + freeze an outcome observation from derived parts. Pure. */
function buildObservation(
  tenantId: TenantId,
  sourceSurface: OutcomeSourceSurface,
  subjectRef: string,
  problemClass: string,
  deviceId: DeviceId | undefined,
  observationRefs: readonly string[],
  actionHistoryRefs: readonly string[],
  context: Record<string, unknown>,
  groundTruth: OutcomeGroundTruth,
  evidenceRefs: readonly EvidenceRef[],
  observedAt: string,
): OutcomeObservation {
  const content: Omit<OutcomeObservation, "observationId" | "contentDigest"> = frozen({
    tenantId,
    sourceSurface,
    subjectRef,
    problemClass,
    ...(deviceId !== undefined ? { deviceId } : {}),
    observationRefs,
    actionHistoryRefs,
    context: frozen({ ...context }) as Readonly<Record<string, unknown>>,
    outcome: frozen({ ...groundTruth }),
    evidenceRefs,
    observedAt,
  });
  return frozen({
    ...content,
    observationId: outcomeObservationId(tenantId, sourceSurface, subjectRef, groundTruth, observedAt),
    contentDigest: outcomeObservationContentDigest(content),
  });
}

// ---------------------------------------------------------------------------
// The tenant-partitioned, append-only observation store (D1 + D4)
// ---------------------------------------------------------------------------

/** The tagged result of an observation-store write. */
export type OutcomeObservationStoreWrite =
  | { readonly ok: true; readonly record: OutcomeObservation; readonly created: boolean }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only outcome-observation store. Every
 * operation takes the acting `LearningTenantScope` FIRST and touches
 * only the acting tenant's partition. Observations are append-only by
 * identity: a re-append of the SAME content (same observationId + same
 * content digest) is idempotent (the existing record is returned,
 * `created: false`); a DIFFERENT content on the same observationId is
 * refused (the slot is occupied — append-only discipline).
 */
export interface OutcomeObservationStore {
  /** Append an observation into the ACTING tenant's partition (tenant must match). */
  appendObservation(scope: LearningTenantScope, observation: OutcomeObservation): OutcomeObservationStoreWrite;
  /** One observation by id (own partition only; undefined when absent/foreign). */
  getObservation(scope: LearningTenantScope, observationId: string): OutcomeObservation | undefined;
  /** All observation ids in the acting partition (sorted). */
  listObservationIds(scope: LearningTenantScope): readonly string[];
  /** Every observation in the acting partition, observationId order. */
  listObservations(scope: LearningTenantScope): readonly OutcomeObservation[];
  /** The number of observations in the acting partition. */
  size(scope: LearningTenantScope): number;
}

/**
 * Create the in-memory reference `OutcomeObservationStore`. Storage is
 * partitioned by tenant id; observations are append-only per
 * observationId. The store audits NOTHING: every consequential append's
 * audit is emitted by the `recordOutcomeObservation` boundary through
 * ITS injected sink — one coherent emission policy across the learning
 * package.
 */
export function createInMemoryOutcomeObservationStore(): OutcomeObservationStore {
  /** tenantId -> (observationId -> OutcomeObservation). */
  const partitions = new Map<string, Map<string, OutcomeObservation>>();

  function partitionOf(tenantId: string): Map<string, OutcomeObservation> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, OutcomeObservation>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: LearningTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkLearningTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.observationStoreDomain,
          `learning outcome-observation store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: LEARNING_PIPELINE_CORRELATION_ID },
          "learning.observation.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  return frozen({
    appendObservation(
      scope: LearningTenantScope,
      observation: OutcomeObservation,
    ): OutcomeObservationStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (observation.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.observationStoreDomain,
            "outcome observation tenant does not match the acting tenant scope",
            {
              tenantId: tenantId as TenantId,
              correlationId: scope.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID,
            },
            "learning.observation.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      const existing = partition.get(observation.observationId);
      if (existing !== undefined) {
        if (existing.contentDigest === observation.contentDigest) {
          return { ok: true, record: existing, created: false };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.observationStoreDomain,
            "observation id already holds different content (append-only)",
            {
              tenantId: tenantId as TenantId,
              correlationId: scope.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID,
            },
            "learning.observation.store",
            "observation_slot_occupied",
          ),
        };
      }
      partition.set(observation.observationId, observation);
      return { ok: true, record: observation, created: true };
    },
    getObservation(scope: LearningTenantScope, observationId: string): OutcomeObservation | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      return partition.get(observationId);
    },
    listObservationIds(scope: LearningTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    listObservations(scope: LearningTenantScope): readonly OutcomeObservation[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze(
        [...partition.keys()].sort().map((id) => partition.get(id) as OutcomeObservation),
      );
    },
    size(scope: LearningTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// The audited recording boundary
// ---------------------------------------------------------------------------

/** Options for `recordOutcomeObservation`. */
export interface RecordOutcomeOptions {
  /** The injected audit sink (the append emits when it creates; default: no-op). */
  readonly auditSink?: LearningAuditSink;
  /** The causation id, when the recording is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

/**
 * Record an outcome observation into the tenant's ledger (the audited
 * boundary). PURE: the observation, the instant and the sink are
 * injected; this boundary reads no clock and no entropy.
 *
 * Audit: a CREATED append (a new record in the tenant's partition) emits
 * `learning.outcome.observed` to the injected sink. An idempotent
 * re-append (same content) mutates nothing and audits nothing. Failed
 * validations never audit.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the outcome-observation store
 * @param observation the derived outcome observation
 * @param options the recording options (audit sink, causation id)
 * @returns the tagged store write
 */
export function recordOutcomeObservation(
  scope: LearningTenantScope,
  store: OutcomeObservationStore,
  observation: OutcomeObservation,
  options: RecordOutcomeOptions = {},
): OutcomeObservationStoreWrite {
  const write = store.appendObservation(scope, observation);
  if (!write.ok) return write;
  if (write.created) {
    const sink: LearningAuditSink = options.auditSink ?? NOOP_LEARNING_AUDIT_SINK;
    sink.append(
      frozen({
        action: LEARNING_AUDIT_ACTIONS.outcomeObserved,
        tenantId: write.record.tenantId,
        subject: write.record.observationId,
        occurredAt: write.record.observedAt,
        correlationId: scope.correlationId ?? LEARNING_PIPELINE_CORRELATION_ID,
        causationId: options.causationId,
        details: frozen({
          observationId: write.record.observationId,
          sourceSurface: write.record.sourceSurface,
          subjectRef: write.record.subjectRef,
          problemClass: write.record.problemClass,
          outcomeLabel: write.record.outcome.label,
          outcomeValue: write.record.outcome.value,
          contentDigest: write.record.contentDigest,
        }),
      }),
    );
  }
  return write;
}
