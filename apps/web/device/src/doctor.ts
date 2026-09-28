/**
 * @fleetos/web-device — D3: the Device Doctor detail surface.
 *
 * The health diagnosis PRESENTATION view-model: W021 health/diagnosis
 * surfaces (signals, baselines, anomalies) and the versioned diagnoses
 * + treatment recommendations consumed via the STRUCTURAL
 * `DoctorSources` seam (the real `@fleetos/health` pipeline bound at
 * the binding site — proven by test).
 *
 * Presentation rules (frozen by this surface contract):
 *   - Diagnoses and treatment recommendations are VERSIONED and
 *     READ-ONLY: every panel row carries its lineage version, its
 *     `supersedes` link, and its ledger-derived status
 *     (ACTIVE / SUPERSEDED / DISMISSED); supersession is displayed,
 *     never rewritten (`spec/ARCHITECTURE-LOCK.md` item 3).
 *   - Treatment recommendations are PROPOSALS: each row surfaces the
 *     proposed intent KIND and rationale; nothing here creates,
 *     dispatches, or executes an intent — the deterministic policy
 *     layer (W031 Contract Guardian) stays authoritative.
 *   - Evidence refs are surfaced as OPAQUE content-addressable
 *     references (`EvidenceRef` values, verbatim): the view-model never
 *     interprets a key's structure, never re-hashes, never fetches.
 *   - Anomalies are displayed severity-first (CRITICAL before WARNING),
 *     then deterministically by (ruleId, observedAt, id).
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected),
 * no randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type { DoctorSources } from "./seams";

// ---------------------------------------------------------------------------
// Panel rows (the display projections)
// ---------------------------------------------------------------------------

/** One signal kind's panel row: the latest sample + window statistics. */
export interface SignalPanelRow {
  readonly kind: string;
  readonly unit: string;
  readonly sampleCount: number;
  readonly latest: {
    readonly value: number;
    readonly observedAt: string;
    readonly confidence: number;
    readonly sourceObservationId: string;
  } | undefined;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly signalModelVersion: number | undefined;
}

/** One baseline panel row (the statistical summary, read-only). */
export interface BaselinePanelRow {
  readonly scopeKind: string;
  readonly signalKind: string;
  readonly unit: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly sampleCount: number;
  readonly deviceCount: number;
  readonly summary: {
    readonly count: number;
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
    readonly p90: number;
    readonly p95: number;
    readonly p99: number;
    readonly stddev: number;
  };
}

/** One anomaly panel row (severity-first display order is the VM's). */
export interface AnomalyPanelRow {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly signalKind: string;
  readonly unit: string;
  readonly value: number;
  readonly observedAt: string;
  readonly evidenceCount: number;
}

/** One versioned diagnosis panel row (read-only lineage display). */
export interface DiagnosisPanelRow {
  readonly id: string;
  readonly causeId: string;
  readonly label: string;
  readonly confidence: number;
  readonly interpretationVersion: number;
  readonly supersedes: string | undefined;
  readonly proposedAt: string;
  readonly status: "ACTIVE" | "SUPERSEDED" | "DISMISSED";
  readonly evidenceLinks: readonly {
    readonly anomalyId: string;
    readonly ruleId: string;
    readonly severity: string;
    readonly observationIds: readonly string[];
  }[];
}

/** One versioned treatment recommendation panel row (a PROPOSAL). */
export interface TreatmentPanelRow {
  readonly id: string;
  readonly hypothesisId: string;
  readonly actionId: string;
  readonly proposedIntentKind: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly recommendationVersion: number;
  readonly supersedes: string | undefined;
  readonly proposedAt: string;
  readonly status: "ACTIVE" | "SUPERSEDED" | "DISMISSED";
}

/** The severity display order (CRITICAL first — deterministic). */
export const ANOMALY_SEVERITY_ORDER: readonly string[] = Object.freeze(["CRITICAL", "WARNING"]);

/** The interpretation status display order (ACTIVE first). */
export const INTERPRETATION_STATUS_ORDER: readonly ("ACTIVE" | "SUPERSEDED" | "DISMISSED")[] =
  Object.freeze(["ACTIVE", "SUPERSEDED", "DISMISSED"]);

// ---------------------------------------------------------------------------
// The Doctor view-model
// ---------------------------------------------------------------------------

/**
 * The Device Doctor view-model: the per-kind signal summaries, the
 * baselines, the anomalies (severity-first), the versioned diagnoses
 * and treatment proposals (status-ordered), and the OPAQUE
 * content-addressable evidence refs backing the diagnosis surfaces.
 */
export interface DeviceDoctorViewModel {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The injected reference instant (display context; never a clock read). */
  readonly asOf: string;
  readonly signals: readonly SignalPanelRow[];
  readonly baselines: readonly BaselinePanelRow[];
  readonly anomalies: readonly AnomalyPanelRow[];
  readonly diagnoses: readonly DiagnosisPanelRow[];
  readonly treatments: readonly TreatmentPanelRow[];
  /**
   * OPAQUE content-addressable evidence refs, verbatim from the seam.
   * NEVER interpreted: no key parsing, no re-hashing, no fetching.
   */
  readonly evidence: readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[];
  readonly summary: {
    readonly signalKinds: number;
    readonly anomalyCounts: { readonly critical: number; readonly warning: number };
    readonly activeDiagnoses: number;
    readonly activeTreatments: number;
  };
}

/** Options for the doctor view-model build. */
export interface DeviceDoctorOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

/** Severity rank for deterministic anomaly ordering (CRITICAL first). */
function severityRank(severity: string): number {
  const index = ANOMALY_SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? ANOMALY_SEVERITY_ORDER.length : index;
}

/** Status rank for deterministic interpretation ordering (ACTIVE first). */
function statusRank(status: "ACTIVE" | "SUPERSEDED" | "DISMISSED"): number {
  return INTERPRETATION_STATUS_ORDER.indexOf(status);
}

/**
 * Build the Device Doctor view-model. PURE and DETERMINISTIC: the same
 * (sources, deviceId, options) always produce byte-identical panels.
 * A refused scope yields the deterministic EMPTY view (no data, no
 * leak); an absent device yields `undefined` (no existence side
 * channel beyond what the seam already enforces).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param sources the injected doctor sources (the real health pipeline at the binding site)
 * @param deviceId the device the doctor detail is requested for
 * @param options the injected reference instant
 * @returns the doctor view-model, or undefined when the device is absent
 */
export function buildDeviceDoctorViewModel(
  scope: DeviceUiTenantScope,
  sources: DoctorSources,
  deviceId: DeviceId,
  options: DeviceDoctorOptions,
): DeviceDoctorViewModel | undefined {
  if (typeof options?.now !== "string" || options.now.length === 0) return undefined;
  const scopeRecord =
    scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  const guardTenant =
    typeof scopeRecord?.tenantId === "string" && scopeRecord.tenantId.length > 0
      ? (scopeRecord.tenantId as TenantId)
      : null;
  if (guardTenant === null) return undefined;

  const signals = sources.signals(guardTenant, deviceId);
  const baselines = sources.baselines(guardTenant, deviceId);
  const anomalies = sources.anomalies(guardTenant, deviceId);
  const diagnoses = sources.diagnoses(guardTenant, deviceId);
  const treatments = sources.treatments(guardTenant, deviceId);
  const evidence = sources.evidenceRefs(guardTenant, deviceId);

  // Signals: group per kind (deterministic kind order), latest sample by
  // (observedAt, sourceObservationId) — the strongest instant wins, ties
  // broken by observation id.
  const kinds = [...new Set(signals.map((s) => s.kind))].sort(compareStrings);
  const signalRows: SignalPanelRow[] = kinds.map((kind) => {
    const ofKind = signals.filter((s) => s.kind === kind);
    const sorted = [...ofKind].sort((a, b) =>
      a.observedAt !== b.observedAt
        ? a.observedAt < b.observedAt
          ? 1
          : -1 // latest first
        : compareStrings(b.sourceObservationId, a.sourceObservationId),
    );
    const latest = sorted[0];
    const values = ofKind.map((s) => s.value);
    return frozen({
      kind,
      unit: latest?.unit ?? "",
      sampleCount: ofKind.length,
      latest: latest
        ? frozen({
            value: latest.value,
            observedAt: latest.observedAt,
            confidence: latest.confidence,
            sourceObservationId: latest.sourceObservationId,
          })
        : undefined,
      min: values.length > 0 ? Math.min(...values) : undefined,
      max: values.length > 0 ? Math.max(...values) : undefined,
      signalModelVersion: latest?.signalModelVersion,
    });
  });

  const baselineRows: BaselinePanelRow[] = [...baselines]
    .sort(
      (a, b) =>
        compareStrings(a.signalKind, b.signalKind) !== 0
          ? compareStrings(a.signalKind, b.signalKind)
          : compareStrings(a.windowStart, b.windowStart),
    )
    .map((baseline) =>
      frozen({
        scopeKind: baseline.scope.kind,
        signalKind: baseline.signalKind,
        unit: baseline.unit,
        windowStart: baseline.windowStart,
        windowEnd: baseline.windowEnd,
        sampleCount: baseline.sampleCount,
        deviceCount: baseline.deviceCount,
        summary: frozen({ ...baseline.summary }),
      }),
    );

  const anomalyRows: AnomalyPanelRow[] = [...anomalies]
    .sort((a, b) => {
      const rankDelta = severityRank(a.severity) - severityRank(b.severity);
      if (rankDelta !== 0) return rankDelta;
      if (a.ruleId !== b.ruleId) return compareStrings(a.ruleId, b.ruleId);
      if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
      return compareStrings(a.id, b.id);
    })
    .map((anomaly) =>
      frozen({
        id: anomaly.id,
        ruleId: anomaly.ruleId,
        severity: anomaly.severity,
        signalKind: anomaly.signalKind,
        unit: anomaly.unit,
        value: anomaly.value,
        observedAt: anomaly.observedAt,
        evidenceCount: anomaly.evidence.length,
      }),
    );

  const diagnosisRows: DiagnosisPanelRow[] = [...diagnoses]
    .sort((a, b) => {
      const rankDelta = statusRank(a.status) - statusRank(b.status);
      if (rankDelta !== 0) return rankDelta;
      if (a.causeId !== b.causeId) return compareStrings(a.causeId, b.causeId);
      return a.interpretationVersion - b.interpretationVersion;
    })
    .map((diagnosis) =>
      frozen({
        id: diagnosis.id,
        causeId: diagnosis.causeId,
        label: diagnosis.label,
        confidence: diagnosis.confidence,
        interpretationVersion: diagnosis.interpretationVersion,
        supersedes: diagnosis.supersedes,
        proposedAt: diagnosis.proposedAt,
        status: diagnosis.status,
        evidenceLinks: frozenArray(
          diagnosis.evidence.map((link) =>
            frozen({
              anomalyId: link.anomalyId,
              ruleId: link.ruleId,
              severity: link.severity,
              observationIds: frozenArray(link.observationIds),
            }),
          ),
        ),
      }),
    );

  const treatmentRows: TreatmentPanelRow[] = [...treatments]
    .sort((a, b) => {
      const rankDelta = statusRank(a.status) - statusRank(b.status);
      if (rankDelta !== 0) return rankDelta;
      if (a.actionId !== b.actionId) return compareStrings(a.actionId, b.actionId);
      return a.recommendationVersion - b.recommendationVersion;
    })
    .map((treatment) =>
      frozen({
        id: treatment.id,
        hypothesisId: treatment.hypothesisId,
        actionId: treatment.actionId,
        proposedIntentKind: treatment.proposedIntentKind,
        rationale: treatment.rationale,
        confidence: treatment.confidence,
        recommendationVersion: treatment.recommendationVersion,
        supersedes: treatment.supersedes,
        proposedAt: treatment.proposedAt,
        status: treatment.status,
      }),
    );

  const activeDiagnoses = diagnosisRows.filter((d) => d.status === "ACTIVE").length;
  const activeTreatments = treatmentRows.filter((t) => t.status === "ACTIVE").length;
  const criticalCount = anomalyRows.filter((a) => a.severity === "CRITICAL").length;
  const warningCount = anomalyRows.filter((a) => a.severity === "WARNING").length;

  return frozen({
    tenantId: guardTenant,
    deviceId,
    asOf: options.now,
    signals: frozenArray(signalRows),
    baselines: frozenArray(baselineRows),
    anomalies: frozenArray(anomalyRows),
    diagnoses: frozenArray(diagnosisRows),
    treatments: frozenArray(treatmentRows),
    evidence: frozenArray(evidence.map((ref) => frozen({ ...ref }))),
    summary: frozen({
      signalKinds: signalRows.length,
      anomalyCounts: frozen({ critical: criticalCount, warning: warningCount }),
      activeDiagnoses,
      activeTreatments,
    }),
  });
}

// ---------------------------------------------------------------------------
// The doctor panel state machine (pure navigation)
// ---------------------------------------------------------------------------

/** The Device Doctor panels, in canonical display order. */
export const DOCTOR_PANELS = ["signals", "baselines", "anomalies", "diagnoses", "treatments"] as const;

export type DoctorPanel = (typeof DOCTOR_PANELS)[number];

/**
 * The panel navigation state: the current panel plus the ordered visit
 * history (most recent last, consecutive duplicates collapsed). A pure
 * state machine — no panel transition here touches the domain.
 */
export interface DoctorPanelState {
  readonly current: DoctorPanel;
  readonly history: readonly DoctorPanel[];
}

/** The initial panel state (defaults to the signals panel). PURE. */
export function initialDoctorPanelState(panel: DoctorPanel = "signals"): DoctorPanelState {
  return frozen({ current: panel, history: frozenArray([]) });
}

/** Open a panel: pushes the current onto the history, sets the new current. PURE. */
export function openDoctorPanel(state: DoctorPanelState, panel: DoctorPanel): DoctorPanelState {
  if (state.current === panel) return state; // re-opening the current panel is a no-op
  return frozen({
    current: panel,
    history: frozenArray([...state.history, state.current]),
  });
}

/** Navigate back: pops the history; an empty history is a no-op. PURE. */
export function doctorPanelBack(state: DoctorPanelState): DoctorPanelState {
  if (state.history.length === 0) return state;
  const history = state.history.slice(0, -1);
  return frozen({
    current: state.history[state.history.length - 1],
    history: frozenArray(history),
  });
}
