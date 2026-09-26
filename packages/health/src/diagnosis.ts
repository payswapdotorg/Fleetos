/**
 * @fleetos/health — D4: Diagnosis hypotheses + treatment recommendations.
 *
 * "The decision engine may propose diagnoses, risk classification,
 * treatment, procurement plan, connectivity plan, software allocation and
 * vendor selection. A deterministic policy/authorization layer remains
 * authoritative for whether an action is permitted." —
 * `spec/ARCHITECTURE.md` § Decision boundary.
 *
 * Everything this module produces is a PROPOSAL:
 *   - A `DiagnosisHypothesis` is a versioned interpretation — a candidate
 *     cause with evidence links and a deterministic confidence. It is
 *     NEVER a fact; reality remains the immutable observation history.
 *   - A `TreatmentRecommendation` proposes an action LINKED TO a Fleet
 *     Intent kind from `@fleetos/contracts` (e.g.
 *     `MaintainDeviceIntent`). It carries a DRAFT payload only: no
 *     intent id, no lifecycle state, no dispatch. Creating, authorizing,
 *     or executing a Fleet Intent belongs to the intent owners and the
 *     deterministic policy layer (W031's Contract Guardian boundary) —
 *     never to this engine.
 *
 * Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md`
 * item 3): interpretations are recorded in an append-only per-device
 * ledger. Re-diagnosis appends NEW records (interpretationVersion =
 * prior + 1, `supersedes` pointing at the prior record); dismissal
 * appends a dismissal entry. An existing record is NEVER rewritten —
 * the ledger functions return new ledgers, and every record is frozen.
 *
 * Audit: every consequential interpretation (hypothesis proposed,
 * treatment proposed, hypothesis dismissed) is emitted to an INJECTED
 * sink (W011's seam pattern; see `audit-seam.ts`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `at` is injected by the caller.
 */

import type {
  CorrelationId,
  DeviceId,
  MaintainDeviceIntentPayload,
  RecoveryIntentPayload,
  ReplacementIntentPayload,
  TenantId,
} from "@fleetos/contracts";
import {
  MAINTAIN_DEVICE_INTENT_KIND,
  RECOVERY_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
} from "@fleetos/contracts";
import type { AnomalyRuleId, AnomalySeverity, HealthAnomaly } from "./anomalies";
import { ANOMALY_RULES_VERSION } from "./anomalies";
import type { HealthAuditRecord, HealthAuditSink } from "./audit-seam";
import { HEALTH_AUDIT_ACTIONS, NOOP_HEALTH_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  HEALTH_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * The diagnosis cause-library version. Bumped when a cause is added,
 * removed, re-weighted, or re-templated. Recorded on every hypothesis and
 * recommendation; a new version never rewrites old records.
 */
export const CAUSE_LIBRARY_VERSION = 1 as const;

/** The engine identity recorded on every interpretation it produces. */
export const DIAGNOSIS_ENGINE_VERSION = "health-diagnosis/1" as const;

/**
 * The confidence cap. A hypothesis is never certain: 0.99 encodes "very
 * strong evidence, still an interpretation" (reality is observations).
 */
export const MAX_HYPOTHESIS_CONFIDENCE = 0.99;

/** Severity contribution to hypothesis confidence (deterministic factors). */
export const SEVERITY_CONFIDENCE_FACTORS: Readonly<Record<AnomalySeverity, number>> = Object.freeze({
  WARNING: 0.6,
  CRITICAL: 1.0,
});

// ---------------------------------------------------------------------------
// Fleet Intent proposals (linked to the frozen contracts intent kinds)
// ---------------------------------------------------------------------------

/**
 * A DRAFT Fleet Intent proposal. The discriminated union mirrors the
 * payload interfaces of the intent kinds the health engine may propose.
 * The payload carries NO intent id and NO lifecycle state — turning a
 * proposal into a durable Fleet Intent is the PLAN/AUTHORIZE stage's
 * job, under the deterministic policy layer (W031).
 */
export type HealthIntentProposal =
  | {
      readonly intentKind: typeof MAINTAIN_DEVICE_INTENT_KIND;
      readonly payload: MaintainDeviceIntentPayload;
    }
  | {
      readonly intentKind: typeof REPLACEMENT_INTENT_KIND;
      readonly payload: ReplacementIntentPayload;
    }
  | {
      readonly intentKind: typeof RECOVERY_INTENT_KIND;
      readonly payload: RecoveryIntentPayload;
    };

/** The intent kinds the health engine may propose (closed set, documented). */
export const PROPOSABLE_INTENT_KINDS: readonly (HealthIntentProposal["intentKind"])[] = Object.freeze([
  MAINTAIN_DEVICE_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  RECOVERY_INTENT_KIND,
]);

// ---------------------------------------------------------------------------
// The cause library (explicit, versioned, deterministic)
// ---------------------------------------------------------------------------

/** How one anomaly rule contributes to a cause's confidence. */
export interface CauseEvidenceRule {
  readonly ruleId: AnomalyRuleId;
  /** Contribution weight in [0, 1] when the rule fires (any severity). */
  readonly weight: number;
}

/** The treatment template attached to a cause. */
export interface CauseTreatmentTemplate {
  /** Stable action identifier (e.g. "maintain.battery_service"). */
  readonly actionId: string;
  /** The Fleet Intent kind the treatment proposes. */
  readonly intentKind: HealthIntentProposal["intentKind"];
  /** Human-readable description (deterministic template text). */
  readonly description: string;
  /** For RecoveryIntent proposals: the recovery action. */
  readonly recoveryAction?: Extract<RecoveryIntentPayload["action"], "reboot">;
  /** For ReplacementIntent proposals: the replacement reason. */
  readonly replacementReason?: string;
}

/** One candidate cause in the diagnosis cause library. */
export interface DiagnosisCause {
  /** Stable machine cause id (e.g. "health.battery_aging"). */
  readonly causeId: string;
  /** Human-readable label. */
  readonly label: string;
  /** The anomaly rules that constitute evidence for this cause. */
  readonly evidenceRules: readonly CauseEvidenceRule[];
  /** The treatment proposed when this cause is hypothesized. */
  readonly treatment: CauseTreatmentTemplate;
}

/**
 * The v1 cause library. Deterministic: causes are evaluated in this
 * order; confidences are pure functions of the matched anomalies.
 */
export const CAUSE_LIBRARY: readonly DiagnosisCause[] = Object.freeze([
  Object.freeze({
    causeId: "health.battery_aging",
    label: "Battery degraded",
    evidenceRules: Object.freeze([Object.freeze({ ruleId: "battery.low", weight: 0.85 })]),
    treatment: Object.freeze({
      actionId: "maintain.battery_service",
      intentKind: MAINTAIN_DEVICE_INTENT_KIND,
      description: "Battery charge is below the health threshold; schedule battery service or replacement.",
    }),
  }),
  Object.freeze({
    causeId: "health.cpu_overload",
    label: "CPU overloaded",
    evidenceRules: Object.freeze([Object.freeze({ ruleId: "cpu.spike", weight: 0.8 })]),
    treatment: Object.freeze({
      actionId: "maintain.cpu_investigation",
      intentKind: MAINTAIN_DEVICE_INTENT_KIND,
      description: "CPU utilization deviates significantly from the device baseline; investigate runaway workloads.",
    }),
  }),
  Object.freeze({
    causeId: "health.disk_near_full",
    label: "Storage nearly full",
    evidenceRules: Object.freeze([Object.freeze({ ruleId: "storage.near_full", weight: 0.9 })]),
    treatment: Object.freeze({
      actionId: "maintain.storage_cleanup",
      intentKind: MAINTAIN_DEVICE_INTENT_KIND,
      description: "Storage utilization is at or above the near-full threshold; schedule cleanup or capacity service.",
    }),
  }),
  Object.freeze({
    causeId: "health.hardware_failing",
    label: "Hardware failure indicators",
    evidenceRules: Object.freeze([
      Object.freeze({ ruleId: "crash.burst", weight: 0.6 }),
      Object.freeze({ ruleId: "boot.slow", weight: 0.6 }),
    ]),
    treatment: Object.freeze({
      actionId: "replace.hardware",
      intentKind: REPLACEMENT_INTENT_KIND,
      description: "Multiple hardware failure indicators; propose hardware replacement.",
      replacementReason: "crash burst and boot-time deviation from baseline",
    }),
  }),
  Object.freeze({
    causeId: "health.memory_pressure",
    label: "Memory pressure",
    evidenceRules: Object.freeze([Object.freeze({ ruleId: "memory.pressure", weight: 0.8 })]),
    treatment: Object.freeze({
      actionId: "maintain.memory_investigation",
      intentKind: MAINTAIN_DEVICE_INTENT_KIND,
      description: "Memory utilization deviates significantly from the device baseline; investigate memory pressure.",
    }),
  }),
  Object.freeze({
    causeId: "health.recurring_crashes",
    label: "Recurring system crashes",
    evidenceRules: Object.freeze([
      Object.freeze({ ruleId: "crash.burst", weight: 0.9 }),
      Object.freeze({ ruleId: "boot.slow", weight: 0.5 }),
    ]),
    treatment: Object.freeze({
      actionId: "recover.reboot",
      intentKind: RECOVERY_INTENT_KIND,
      description: "Crash events exceed the burst threshold; propose a recovery reboot as first-line mitigation.",
      recoveryAction: "reboot",
    }),
  }),
  Object.freeze({
    causeId: "health.thermal_stress",
    label: "Thermal stress",
    evidenceRules: Object.freeze([
      Object.freeze({ ruleId: "temperature.high", weight: 0.85 }),
      Object.freeze({ ruleId: "cpu.spike", weight: 0.4 }),
    ]),
    treatment: Object.freeze({
      actionId: "maintain.thermal_service",
      intentKind: MAINTAIN_DEVICE_INTENT_KIND,
      description: "Core temperature exceeds the health threshold; schedule thermal service (dust, fans, airflow).",
    }),
  }),
]);

// ---------------------------------------------------------------------------
// Interpretation records
// ---------------------------------------------------------------------------

/** The lifecycle status of an interpretation record (DERIVED from ledger state). */
export type InterpretationStatus = "ACTIVE" | "SUPERSEDED" | "DISMISSED";

/** How one anomaly contributed to a hypothesis (evidence link). */
export interface HypothesisEvidence {
  /** The anomaly that fired. */
  readonly anomalyId: string;
  readonly ruleId: AnomalyRuleId;
  readonly severity: AnomalySeverity;
  /** The observations behind the anomaly (transitive correlation to reality). */
  readonly observationIds: readonly string[];
}

/**
 * A versioned diagnosis hypothesis: a CANDIDATE cause with evidence
 * links and a deterministic confidence. A proposal, never a fact.
 * Frozen; supersession is recorded on the NEW record, never by editing
 * this one.
 */
export interface DiagnosisHypothesis {
  /** Deterministic id: `hyp_` + fnv1a32 of the identity tuple. */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly causeId: string;
  readonly label: string;
  /** Confidence in [0, 0.99] — deterministic function of the evidence. */
  readonly confidence: number;
  /** The anomaly evidence that produced this hypothesis. */
  readonly evidence: readonly HypothesisEvidence[];
  /** 1-based lineage position for (deviceId, causeId). */
  readonly interpretationVersion: number;
  /** The prior hypothesis in this lineage, when re-diagnosing. */
  readonly supersedes?: string;
  /** Injected proposal timestamp. */
  readonly proposedAt: string;
  /** The engine version that produced this record. */
  readonly engineVersion: string;
  readonly causeLibraryVersion: number;
  readonly anomalyRulesVersion: number;
  readonly schemaVersion: number;
}

/**
 * A proposed treatment linked to a hypothesis and to a Fleet Intent kind.
 * A PROPOSAL ONLY: it carries a draft intent payload and NO intent id —
 * nothing in this module creates, dispatches, or executes an intent.
 */
export interface TreatmentRecommendation {
  /** Deterministic id: `tr_` + fnv1a32 of the identity tuple. */
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The hypothesis this treatment proposes to treat. */
  readonly hypothesisId: string;
  /** The stable action identifier from the cause's treatment template. */
  readonly actionId: string;
  /** The draft Fleet Intent proposal (kind + payload, no intent id). */
  readonly proposedIntent: HealthIntentProposal;
  /** Deterministic rationale (evidence summary; see buildRationale). */
  readonly rationale: string;
  /** Confidence inherited from the hypothesis. */
  readonly confidence: number;
  /** 1-based lineage position for (deviceId, actionId). */
  readonly recommendationVersion: number;
  /** The prior recommendation in this lineage, when re-diagnosing. */
  readonly supersedes?: string;
  /** Injected proposal timestamp. */
  readonly proposedAt: string;
  readonly engineVersion: string;
  readonly causeLibraryVersion: number;
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// The append-only interpretation ledger
// ---------------------------------------------------------------------------

/** A recorded dismissal of a hypothesis (operator/policy judgment). */
export interface HypothesisDismissal {
  /** The dismissed hypothesis. */
  readonly hypothesisId: string;
  /** Machine-stable dismissal reason (e.g. "operator_rejected", "stale_evidence"). */
  readonly reason: string;
  /** Injected dismissal timestamp. */
  readonly dismissedAt: string;
  readonly correlationId: CorrelationId;
  /** Free-form context (JSON-serializable). */
  readonly note?: string;
}

/** One append-only ledger entry. */
export type DiagnosisLedgerEntry =
  | { readonly kind: "hypothesis"; readonly hypothesis: DiagnosisHypothesis }
  | { readonly kind: "recommendation"; readonly recommendation: TreatmentRecommendation }
  | { readonly kind: "dismissal"; readonly dismissal: HypothesisDismissal };

/**
 * The per-device interpretation ledger: an append-only journal of every
 * hypothesis, recommendation, and dismissal. Entries are never removed,
 * reordered, or rewritten; ledger operations return NEW ledgers.
 */
export interface DiagnosisLedger {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly entries: readonly DiagnosisLedgerEntry[];
}

/** Create an empty ledger for one device. */
export function createDiagnosisLedger(tenantId: TenantId, deviceId: DeviceId): DiagnosisLedger {
  return frozen({ tenantId, deviceId, entries: frozenArray([]) });
}

function ledgerScopeError(
  ledger: DiagnosisLedger,
  tenantId: TenantId,
  deviceId: DeviceId,
  correlationId: CorrelationId,
): ReturnType<typeof makeDomainError> {
  return makeDomainError(
    ERROR_CODES.diagnosisTenantMismatch,
    "ledger entry does not match the ledger scope",
    { tenantId, correlationId },
    "health.diagnosis",
    "ledger_scope_mismatch",
  );
}

/** Append a hypothesis. Returns a NEW ledger; the input is untouched. */
export function appendHypothesis(
  ledger: DiagnosisLedger,
  hypothesis: DiagnosisHypothesis,
): { ok: true; ledger: DiagnosisLedger } | { ok: false; error: ReturnType<typeof makeDomainError> } {
  if (hypothesis.tenantId !== ledger.tenantId || hypothesis.deviceId !== ledger.deviceId) {
    return { ok: false, error: ledgerScopeError(ledger, ledger.tenantId, ledger.deviceId, HEALTH_PIPELINE_CORRELATION_ID) };
  }
  if (ledger.entries.some((e) => e.kind === "hypothesis" && e.hypothesis.id === hypothesis.id)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.diagnosisInvalid,
        "hypothesis id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: HEALTH_PIPELINE_CORRELATION_ID },
        "health.diagnosis",
        "duplicate_hypothesis_id",
      ),
    };
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([...ledger.entries, frozen({ kind: "hypothesis" as const, hypothesis })]),
    }),
  };
}

/** Append a recommendation. Returns a NEW ledger; the input is untouched. */
export function appendRecommendation(
  ledger: DiagnosisLedger,
  recommendation: TreatmentRecommendation,
): { ok: true; ledger: DiagnosisLedger } | { ok: false; error: ReturnType<typeof makeDomainError> } {
  if (recommendation.tenantId !== ledger.tenantId || recommendation.deviceId !== ledger.deviceId) {
    return { ok: false, error: ledgerScopeError(ledger, ledger.tenantId, ledger.deviceId, HEALTH_PIPELINE_CORRELATION_ID) };
  }
  if (ledger.entries.some((e) => e.kind === "recommendation" && e.recommendation.id === recommendation.id)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.diagnosisInvalid,
        "recommendation id already present in the ledger",
        { tenantId: ledger.tenantId, correlationId: HEALTH_PIPELINE_CORRELATION_ID },
        "health.diagnosis",
        "duplicate_recommendation_id",
      ),
    };
  }
  return {
    ok: true,
    ledger: frozen({
      ...ledger,
      entries: frozenArray([...ledger.entries, frozen({ kind: "recommendation" as const, recommendation })]),
    }),
  };
}

/** Options for `dismissHypothesis`. */
export interface DismissHypothesisOptions {
  readonly at: string;
  readonly reason: string;
  readonly correlationId: CorrelationId;
  readonly note?: string;
  /** Audit sink (default: no-op). A dismissal is a consequential interpretation. */
  readonly auditSink?: HealthAuditSink;
}

/**
 * Dismiss a hypothesis: appends a dismissal entry (a NEW ledger; nothing
 * is rewritten) and emits `health.diagnosis.dismissed` to the sink. The
 * hypothesis's recommendations become inactive (derived — see
 * `resolveActiveInterpretations`). Dismissing a hypothesis that is
 * already superseded is a DomainError (`already_superseded`); re-dismiss
 * protection (`already_dismissed`) keeps the journal clean.
 */
export function dismissHypothesis(
  ledger: DiagnosisLedger,
  hypothesisId: string,
  options: DismissHypothesisOptions,
): { ok: true; ledger: DiagnosisLedger; dismissal: HypothesisDismissal } | { ok: false; error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError> } {
  const failures: { path: string; reason: string }[] = [];
  if (typeof hypothesisId !== "string" || hypothesisId.length === 0) {
    failures.push({ path: "/hypothesisId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.reason !== "string" || options.reason.length === 0) {
    failures.push({ path: "/reason", reason: "required" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.diagnosisInvalid,
        "dismissal request is invalid",
        { tenantId: ledger.tenantId, correlationId: options?.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }

  const status = hypothesisStatus(ledger, hypothesisId);
  if (status === "unknown") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.diagnosisInvalid,
        "hypothesis not found in the ledger",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "health.diagnosis",
        "hypothesis_unknown",
      ),
    };
  }
  if (status === "SUPERSEDED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.diagnosisInvalid,
        "hypothesis is already superseded; dismiss the active interpretation instead",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "health.diagnosis",
        "already_superseded",
      ),
    };
  }
  if (status === "DISMISSED") {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.diagnosisInvalid,
        "hypothesis is already dismissed",
        { tenantId: ledger.tenantId, correlationId: options.correlationId },
        "health.diagnosis",
        "already_dismissed",
      ),
    };
  }

  const dismissal: HypothesisDismissal = frozen({
    hypothesisId,
    reason: options.reason,
    dismissedAt: options.at,
    correlationId: options.correlationId,
    note: options.note,
  });
  const next: DiagnosisLedger = frozen({
    ...ledger,
    entries: frozenArray([...ledger.entries, frozen({ kind: "dismissal" as const, dismissal })]),
  });

  const hypothesis = ledger.entries
    .filter((e): e is Extract<DiagnosisLedgerEntry, { kind: "hypothesis" }> => e.kind === "hypothesis")
    .map((e) => e.hypothesis)
    .find((h) => h.id === hypothesisId)!;

  (options.auditSink ?? NOOP_HEALTH_AUDIT_SINK).append(
    frozen({
      action: HEALTH_AUDIT_ACTIONS.hypothesisDismissed,
      tenantId: ledger.tenantId,
      subject: ledger.deviceId,
      occurredAt: options.at,
      correlationId: options.correlationId,
      details: {
        hypothesisId,
        causeId: hypothesis.causeId,
        reason: options.reason,
        note: options.note ?? null,
        engineVersion: DIAGNOSIS_ENGINE_VERSION,
      },
    } satisfies HealthAuditRecord),
  );

  return { ok: true, ledger: next, dismissal };
}

// ---------------------------------------------------------------------------
// Derived state (pure folds over the ledger)
// ---------------------------------------------------------------------------

/**
 * The derived status of a hypothesis: ACTIVE (current interpretation of
 * its cause), SUPERSEDED (a later hypothesis in the same lineage
 * follows it), DISMISSED (a dismissal entry targets it and nothing
 * newer follows), or "unknown" (not in the ledger).
 */
export function hypothesisStatus(
  ledger: DiagnosisLedger,
  hypothesisId: string,
): InterpretationStatus | "unknown" {
  const hypotheses = ledger.entries
    .filter((e): e is Extract<DiagnosisLedgerEntry, { kind: "hypothesis" }> => e.kind === "hypothesis")
    .map((e) => e.hypothesis);
  const target = hypotheses.find((h) => h.id === hypothesisId);
  if (target === undefined) return "unknown";

  const superseded = hypotheses.some((h) => h.supersedes === hypothesisId);
  if (superseded) return "SUPERSEDED";

  const dismissed = ledger.entries.some(
    (e) => e.kind === "dismissal" && e.dismissal.hypothesisId === hypothesisId,
  );
  if (dismissed) return "DISMISSED";

  return "ACTIVE";
}

/** The resolved interpretations of a ledger: the ACTIVE view. */
export interface ActiveInterpretations {
  /** Active hypotheses (one per cause lineage at most), cause order. */
  readonly hypotheses: readonly DiagnosisHypothesis[];
  /**
   * Active recommendations: not superseded by a newer recommendation of
   * the same action AND whose hypothesis is still ACTIVE.
   */
  readonly recommendations: readonly TreatmentRecommendation[];
}

/**
 * Resolve the ACTIVE interpretations of a ledger: per cause lineage the
 * latest hypothesis that is neither superseded nor dismissed; per action
 * lineage the latest recommendation whose hypothesis is active.
 * Deterministic fold; the ledger is not modified.
 */
export function resolveActiveInterpretations(ledger: DiagnosisLedger): ActiveInterpretations {
  const hypotheses: DiagnosisHypothesis[] = [];
  const recommendations: TreatmentRecommendation[] = [];
  for (const entry of ledger.entries) {
    if (entry.kind === "hypothesis") hypotheses.push(entry.hypothesis);
    if (entry.kind === "recommendation") recommendations.push(entry.recommendation);
  }

  const activeHypotheses = hypotheses
    .filter((h) => hypothesisStatus(ledger, h.id) === "ACTIVE")
    .sort((a, b) => (a.causeId < b.causeId ? -1 : a.causeId > b.causeId ? 1 : 0));
  const activeHypothesisIds = new Set(activeHypotheses.map((h) => h.id));

  const activeRecommendations = recommendations
    .filter((r) => !recommendations.some((other) => other.supersedes === r.id))
    .filter((r) => activeHypothesisIds.has(r.hypothesisId))
    .sort((a, b) => (a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0));

  return frozen({
    hypotheses: frozenArray(activeHypotheses),
    recommendations: frozenArray(activeRecommendations),
  });
}

// ---------------------------------------------------------------------------
// The diagnosis engine
// ---------------------------------------------------------------------------

/** Options for `diagnose` (the anomalies are the first positional argument). */
export interface DiagnoseOptions {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /**
   * Prior ledger entries (for lineage versioning + supersedes links).
   * Optional — a first diagnosis runs without history.
   */
  readonly history?: readonly DiagnosisLedgerEntry[];
  /** Injected proposal timestamp. */
  readonly at: string;
  /** Correlation id threading the causal graph (also stamped on audit records). */
  readonly correlationId: CorrelationId;
  /** Audit sink (default: no-op). Proposals are consequential interpretations. */
  readonly auditSink?: HealthAuditSink;
}

/** The result of a diagnosis run (tagged union; never throws). */
export type DiagnoseResult =
  | {
      readonly ok: true;
      /** Hypotheses for every cause with at least one matched anomaly. */
      readonly hypotheses: readonly DiagnosisHypothesis[];
      /** One treatment recommendation per hypothesis. */
      readonly recommendations: readonly TreatmentRecommendation[];
      readonly engineVersion: string;
    }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").ValidationError };

/**
 * Diagnose a device: evaluate every cause in the library against the
 * device's anomalies, produce versioned hypotheses + treatment
 * recommendations, and emit audit records for each consequential
 * proposal. Deterministic: the same anomalies + history + options always
 * produce the same records (same ids, same order: causes in library
 * order).
 *
 * PROPOSALS ONLY — this function never creates a Fleet Intent, never
 * mutates the ledger (callers append via `appendHypothesis` /
 * `appendRecommendation`), and never performs an action. The
 * deterministic policy layer (W031) stays authoritative.
 */
export function diagnose(anomalies: readonly HealthAnomaly[], options: DiagnoseOptions): DiagnoseResult {
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.tenantId !== "string" || options.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof options?.deviceId !== "string" || options.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (!Array.isArray(anomalies)) {
    failures.push({ path: "/anomalies", reason: "required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.diagnosisInvalid,
        "diagnosis request is invalid",
        {
          tenantId: options?.tenantId || SYNTHETIC_SYSTEM_TENANT,
          correlationId: options?.correlationId ?? HEALTH_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Tenant + device scope enforcement (structural isolation by rejection).
  for (let i = 0; i < anomalies.length; i++) {
    if (anomalies[i].tenantId !== options.tenantId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.diagnosisInvalid,
          "diagnosis request is invalid",
          { tenantId: options.tenantId, correlationId: options.correlationId },
          [{ path: `/anomalies/${i}/tenantId`, reason: "tenant_mismatch" }],
        ),
      };
    }
    if (anomalies[i].deviceId !== options.deviceId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.diagnosisInvalid,
          "diagnosis request is invalid",
          { tenantId: options.tenantId, correlationId: options.correlationId },
          [{ path: `/anomalies/${i}/deviceId`, reason: "device_mismatch" }],
        ),
      };
    }
  }
  const history = options.history ?? [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const recordTenant =
      entry.kind === "hypothesis"
        ? entry.hypothesis.tenantId
        : entry.kind === "recommendation"
          ? entry.recommendation.tenantId
          : null;
    const recordDevice =
      entry.kind === "hypothesis"
        ? entry.hypothesis.deviceId
        : entry.kind === "recommendation"
          ? entry.recommendation.deviceId
          : null;
    if (recordTenant !== null && recordTenant !== options.tenantId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.diagnosisInvalid,
          "diagnosis request is invalid",
          { tenantId: options.tenantId, correlationId: options.correlationId },
          [{ path: `/history/${i}/tenantId`, reason: "tenant_mismatch" }],
        ),
      };
    }
    if (recordDevice !== null && recordDevice !== options.deviceId) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.diagnosisInvalid,
          "diagnosis request is invalid",
          { tenantId: options.tenantId, correlationId: options.correlationId },
          [{ path: `/history/${i}/deviceId`, reason: "device_mismatch" }],
        ),
      };
    }
  }

  const sink = options.auditSink ?? NOOP_HEALTH_AUDIT_SINK;
  const hypotheses: DiagnosisHypothesis[] = [];
  const recommendations: TreatmentRecommendation[] = [];

  for (const cause of CAUSE_LIBRARY) {
    const evidence: HypothesisEvidence[] = [];
    let confidence = 0;
    for (const evidenceRule of cause.evidenceRules) {
      const matched = anomalies
        .filter((a) => a.ruleId === evidenceRule.ruleId)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      if (matched.length === 0) continue;
      // The strongest severity of the rule contributes (deterministic).
      const strongest: AnomalySeverity =
        matched.some((a) => a.severity === "CRITICAL") ? "CRITICAL" : "WARNING";
      confidence += evidenceRule.weight * SEVERITY_CONFIDENCE_FACTORS[strongest];
      evidence.push(
        frozen({
          anomalyId: matched[matched.length - 1].id,
          ruleId: evidenceRule.ruleId,
          severity: strongest,
          observationIds: frozenArray(
            matched[matched.length - 1].evidence.map((e) => e.observationId as string),
          ),
        }),
      );
    }
    if (evidence.length === 0) continue; // no anomaly supports this cause

    const hypothesisConfidence = Math.min(MAX_HYPOTHESIS_CONFIDENCE, confidence);
    const interpretationVersion = nextVersionForCause(history, options.deviceId, cause.causeId);
    const priorId = latestHypothesisIdForCause(history, options.deviceId, cause.causeId);
    const hypothesis: DiagnosisHypothesis = frozen({
      id: `hyp_${fnv1a32Hex(
        canonicalJson({
          tenantId: options.tenantId as string,
          deviceId: options.deviceId as string,
          causeId: cause.causeId,
          interpretationVersion,
        }),
      )}`,
      tenantId: options.tenantId,
      deviceId: options.deviceId,
      causeId: cause.causeId,
      label: cause.label,
      confidence: hypothesisConfidence,
      evidence: frozenArray(evidence),
      interpretationVersion,
      ...(priorId !== undefined ? { supersedes: priorId } : {}),
      proposedAt: options.at,
      engineVersion: DIAGNOSIS_ENGINE_VERSION,
      causeLibraryVersion: CAUSE_LIBRARY_VERSION,
      anomalyRulesVersion: ANOMALY_RULES_VERSION,
      schemaVersion: 1,
    });
    hypotheses.push(hypothesis);

    const recommendationVersion = nextVersionForAction(history, options.deviceId, cause.treatment.actionId);
    const priorRecommendationId = latestRecommendationIdForAction(history, options.deviceId, cause.treatment.actionId);
    const recommendation: TreatmentRecommendation = frozen({
      id: `tr_${fnv1a32Hex(
        canonicalJson({
          tenantId: options.tenantId as string,
          deviceId: options.deviceId as string,
          actionId: cause.treatment.actionId,
          recommendationVersion,
        }),
      )}`,
      tenantId: options.tenantId,
      deviceId: options.deviceId,
      hypothesisId: hypothesis.id,
      actionId: cause.treatment.actionId,
      proposedIntent: buildProposal(options, cause),
      rationale: buildRationale(cause, evidence),
      confidence: hypothesisConfidence,
      recommendationVersion,
      ...(priorRecommendationId !== undefined ? { supersedes: priorRecommendationId } : {}),
      proposedAt: options.at,
      engineVersion: DIAGNOSIS_ENGINE_VERSION,
      causeLibraryVersion: CAUSE_LIBRARY_VERSION,
      schemaVersion: 1,
    });
    recommendations.push(recommendation);
  }

  // Audit emission: one record per consequential proposal. Records are
  // deterministic functions of the inputs; the sink contract requires
  // append-only durability.
  for (const hypothesis of hypotheses) {
    sink.append(
      frozen({
        action: HEALTH_AUDIT_ACTIONS.diagnosisProposed,
        tenantId: options.tenantId,
        subject: options.deviceId,
        occurredAt: options.at,
        correlationId: options.correlationId,
        details: {
          hypothesisId: hypothesis.id,
          causeId: hypothesis.causeId,
          confidence: hypothesis.confidence,
          interpretationVersion: hypothesis.interpretationVersion,
          supersedes: hypothesis.supersedes ?? null,
          engineVersion: DIAGNOSIS_ENGINE_VERSION,
        },
      } satisfies HealthAuditRecord),
    );
  }
  for (const recommendation of recommendations) {
    sink.append(
      frozen({
        action: HEALTH_AUDIT_ACTIONS.treatmentProposed,
        tenantId: options.tenantId,
        subject: options.deviceId,
        occurredAt: options.at,
        correlationId: options.correlationId,
        details: {
          recommendationId: recommendation.id,
          hypothesisId: recommendation.hypothesisId,
          actionId: recommendation.actionId,
          proposedIntentKind: recommendation.proposedIntent.intentKind,
          recommendationVersion: recommendation.recommendationVersion,
          engineVersion: DIAGNOSIS_ENGINE_VERSION,
        },
      } satisfies HealthAuditRecord),
    );
  }

  return frozen({
    ok: true as const,
    hypotheses: frozenArray(hypotheses),
    recommendations: frozenArray(recommendations),
    engineVersion: DIAGNOSIS_ENGINE_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Engine helpers (pure)
// ---------------------------------------------------------------------------

function nextVersionForCause(
  history: readonly DiagnosisLedgerEntry[],
  deviceId: DeviceId,
  causeId: string,
): number {
  let max = 0;
  for (const entry of history) {
    if (entry.kind === "hypothesis" && entry.hypothesis.deviceId === deviceId && entry.hypothesis.causeId === causeId) {
      max = Math.max(max, entry.hypothesis.interpretationVersion);
    }
  }
  return max + 1;
}

function latestHypothesisIdForCause(
  history: readonly DiagnosisLedgerEntry[],
  deviceId: DeviceId,
  causeId: string,
): string | undefined {
  let latest: { id: string; version: number } | undefined;
  for (const entry of history) {
    if (entry.kind === "hypothesis" && entry.hypothesis.deviceId === deviceId && entry.hypothesis.causeId === causeId) {
      if (latest === undefined || entry.hypothesis.interpretationVersion > latest.version) {
        latest = { id: entry.hypothesis.id, version: entry.hypothesis.interpretationVersion };
      }
    }
  }
  return latest?.id;
}

function nextVersionForAction(
  history: readonly DiagnosisLedgerEntry[],
  deviceId: DeviceId,
  actionId: string,
): number {
  let max = 0;
  for (const entry of history) {
    if (
      entry.kind === "recommendation" &&
      entry.recommendation.deviceId === deviceId &&
      entry.recommendation.actionId === actionId
    ) {
      max = Math.max(max, entry.recommendation.recommendationVersion);
    }
  }
  return max + 1;
}

function latestRecommendationIdForAction(
  history: readonly DiagnosisLedgerEntry[],
  deviceId: DeviceId,
  actionId: string,
): string | undefined {
  let latest: { id: string; version: number } | undefined;
  for (const entry of history) {
    if (
      entry.kind === "recommendation" &&
      entry.recommendation.deviceId === deviceId &&
      entry.recommendation.actionId === actionId
    ) {
      if (latest === undefined || entry.recommendation.recommendationVersion > latest.version) {
        latest = { id: entry.recommendation.id, version: entry.recommendation.recommendationVersion };
      }
    }
  }
  return latest?.id;
}

/** Build the draft intent payload from the cause's treatment template. */
function buildProposal(options: DiagnoseOptions, cause: DiagnosisCause): HealthIntentProposal {
  switch (cause.treatment.intentKind) {
    case MAINTAIN_DEVICE_INTENT_KIND:
      return frozen({
        intentKind: MAINTAIN_DEVICE_INTENT_KIND,
        payload: frozen({
          deviceId: options.deviceId as string,
          description: cause.treatment.description,
        }),
      });
    case REPLACEMENT_INTENT_KIND:
      return frozen({
        intentKind: REPLACEMENT_INTENT_KIND,
        payload: frozen({
          deviceId: options.deviceId as string,
          reason: cause.treatment.replacementReason ?? cause.treatment.description,
        }),
      });
    case RECOVERY_INTENT_KIND:
      return frozen({
        intentKind: RECOVERY_INTENT_KIND,
        payload: frozen({
          deviceId: options.deviceId as string,
          action: cause.treatment.recoveryAction ?? "reboot",
        }),
      });
  }
}

/** Deterministic rationale: matched rules (sorted) + the template statement. */
function buildRationale(cause: DiagnosisCause, evidence: readonly HypothesisEvidence[]): string {
  const rules = evidence
    .map((e) => `${e.ruleId} (${e.severity})`)
    .sort()
    .join(", ");
  return `Evidence: ${rules}. ${cause.treatment.description} Proposal only — subject to policy authorization.`;
}
