/**
 * @fleetos/web-device — W141: the Device Doctor JOURNEY view-model.
 *
 * The full operator journey the accepted deep screen must carry, as ONE
 * machine-stable walk (SIM-B ask 1; UX-JOURNEY-SIMULATION Journey 2 —
 * the record pattern's sequence):
 *
 *   device -> observations -> symptoms -> diagnosis -> recommended
 *   remediation -> authorization -> action -> result -> evidence
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: `not_yet_observed` is a first-class state (the
 *     real-observations-only doctrine — an absence of evidence is never
 *     dressed up as health, and NOTHING is ever fabricated). Stages the
 *     runtime has no records for say exactly that.
 *   - The SYMPTOM WALK is the anomaly list as operator steps: one step
 *     per detected anomaly (severity-first), each anchored to its
 *     evidence observation ids. No anomalies -> the machine-stable
 *     `no_anomalies_detected` — never an invented symptom.
 *   - The REMEDIATION WALK is the treatment recommendations as gated
 *     steps: proposal -> operator disposition -> Guardian decision ->
 *     durable request -> result. A step that has not been requested
 *     says `not_requested`; a parked request says `approval_required`;
 *     a RECOMMENDATION IS NEVER AN EXECUTED ACTION — the step's own
 *     states keep proposal and execution distinct.
 *   - Evidence stays OPAQUE: content-addressable refs verbatim, never
 *     interpreted.
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";
import type { GuardianDecisionType, Observation } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type {
  AnomalyLike,
  DeviceTwinLike,
  DiagnosisLike,
  RemediationDisposition,
  RemediationRequestLike,
  TreatmentLike,
} from "./seams";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The Device Doctor journey stage ids, in the frozen journey order. */
export const DOCTOR_JOURNEY_STAGES = [
  "device",
  "observations",
  "symptoms",
  "diagnosis",
  "remediation",
  "authorization",
  "action",
  "result",
  "evidence",
] as const;

export type DoctorJourneyStageId = (typeof DOCTOR_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type DoctorJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface DoctorJourneyStage {
  readonly id: DoctorJourneyStageId;
  readonly state: DoctorJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const DOCTOR_JOURNEY_HEADLINES: Readonly<Record<DoctorJourneyStageId, string>> =
  Object.freeze({
    device: "Device under diagnosis",
    observations: "Observations ingested",
    symptoms: "Symptoms detected",
    diagnosis: "Diagnosis recorded",
    remediation: "Remediation recommended",
    authorization: "Authorization state",
    action: "Action requested",
    result: "Execution result",
    evidence: "Evidence artifacts",
  } as const);

/** The machine-stable empty-state headline (shared, honest). */
export const DOCTOR_NOT_YET_OBSERVED = "Not yet observed" as const;

// ---------------------------------------------------------------------------
// The symptom walk (anomalies as operator steps)
// ---------------------------------------------------------------------------

/** One symptom walk step: a detected anomaly + its evidence anchors. */
export interface DoctorSymptomStep {
  readonly anomalyId: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly signalKind: string;
  readonly value: number;
  readonly unit: string;
  readonly observedAt: string;
  /** The evidence observation ids, verbatim (opaque anchors). */
  readonly evidenceObservationIds: readonly string[];
}

/** The symptom walk: ordered steps or the honest no-anomalies state. */
export interface DoctorSymptomWalk {
  /** Machine-stable: `anomalies_detected` | `no_anomalies_detected`. */
  readonly state: "anomalies_detected" | "no_anomalies_detected";
  readonly steps: readonly DoctorSymptomStep[];
}

/**
 * Build the symptom walk from the REAL detected anomalies.
 * PURE: severity-first (CRITICAL before WARNING), then (ruleId,
 * observedAt, id) — the doctor panels' frozen order. An empty anomaly
 * list is the machine-stable `no_anomalies_detected` — never a
 * fabricated symptom.
 */
export function buildDoctorSymptomWalk(anomalies: readonly AnomalyLike[]): DoctorSymptomWalk {
  const steps: DoctorSymptomStep[] = [...anomalies]
    .sort((a, b) => {
      const severity = ["CRITICAL", "WARNING"];
      const rankOf = (severityName: string): number => {
        const index = severity.indexOf(severityName);
        return index === -1 ? severity.length : index;
      };
      const rankDelta = rankOf(a.severity) - rankOf(b.severity);
      if (rankDelta !== 0) return rankDelta;
      if (a.ruleId !== b.ruleId) return compareStrings(a.ruleId, b.ruleId);
      if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
      return compareStrings(a.id, b.id);
    })
    .map((anomaly) =>
      frozen({
        anomalyId: anomaly.id,
        ruleId: anomaly.ruleId,
        severity: anomaly.severity,
        signalKind: anomaly.signalKind,
        value: anomaly.value,
        unit: anomaly.unit,
        observedAt: anomaly.observedAt,
        evidenceObservationIds: frozenArray(
          anomaly.evidence.map((entry) => entry.observationId),
        ),
      }),
    );
  return frozen({
    state: steps.length > 0 ? "anomalies_detected" : "no_anomalies_detected",
    steps: frozenArray(steps),
  });
}

// ---------------------------------------------------------------------------
// The remediation walk (treatments as gated steps)
// ---------------------------------------------------------------------------

/** The request projection inside one remediation step (honest states). */
export interface DoctorRemediationRequestView {
  /** The durable request's machine-stable status (verbatim). */
  readonly status: string;
  readonly requestedAt: string;
  readonly requestedBy: string | undefined;
  /** The Guardian decision, when the boundary evaluated the request. */
  readonly decision: GuardianDecisionType | undefined;
  readonly decidedAt: string | undefined;
  /** The execution outcome, when the request reached the adapter. */
  readonly outcome: "executed" | "failed" | undefined;
  readonly executedAt: string | undefined;
  readonly evidenceCount: number;
}

/** One remediation walk step: a treatment proposal on its gated path. */
export interface DoctorRemediationStep {
  readonly treatmentId: string;
  readonly rationale: string;
  readonly proposedIntentKind: string;
  readonly confidence: number;
  readonly recommendationVersion: number;
  /** The ledger-derived status (ACTIVE / SUPERSEDED / DISMISSED). */
  readonly status: "ACTIVE" | "SUPERSEDED" | "DISMISSED";
  /** The operator disposition: `not_decided` until a real record says otherwise. */
  readonly disposition: RemediationDisposition;
  /** The authorization gate: `not_evaluated` until a real decision exists. */
  readonly gating: GuardianDecisionType | "not_evaluated";
  /** The durable request, or the machine-stable not-requested state. */
  readonly request: DoctorRemediationRequestView | "not_requested";
}

/** The remediation walk: ordered steps or the honest no-recommendations state. */
export interface DoctorRemediationWalk {
  /** Machine-stable: `recommendations_proposed` | `no_recommendations_yet`. */
  readonly state: "recommendations_proposed" | "no_recommendations_yet";
  readonly steps: readonly DoctorRemediationStep[];
}

/**
 * Build the remediation walk from the REAL versioned treatments + the
 * REAL remediation request records. PURE: ACTIVE treatments first, then
 * (actionId, recommendationVersion). Every step's disposition, gating
 * and request state derive from REAL records only — `not_decided`,
 * `not_evaluated` and `not_requested` are the honest defaults, and a
 * RECOMMENDATION IS NEVER AN EXECUTED ACTION (the step carries the
 * request's own status; only `outcome` is an execution).
 */
export function buildDoctorRemediationWalk(
  treatments: readonly TreatmentLike[],
  requests: readonly RemediationRequestLike[],
): DoctorRemediationWalk {
  const byTreatment = new Map<string, RemediationRequestLike>();
  for (const request of requests) {
    // The LATEST record wins (append-only records arrive in order).
    byTreatment.set(request.treatmentId, request);
  }
  const steps: DoctorRemediationStep[] = [...treatments]
    .sort((a, b) => {
      const rank = (status: "ACTIVE" | "SUPERSEDED" | "DISMISSED"): number =>
        status === "ACTIVE" ? 0 : status === "SUPERSEDED" ? 1 : 2;
      const rankDelta = rank(a.status) - rank(b.status);
      if (rankDelta !== 0) return rankDelta;
      if (a.actionId !== b.actionId) return compareStrings(a.actionId, b.actionId);
      return a.recommendationVersion - b.recommendationVersion;
    })
    .map((treatment) => {
      const request = byTreatment.get(treatment.id);
      return frozen<DoctorRemediationStep>({
        treatmentId: treatment.id,
        rationale: treatment.rationale,
        proposedIntentKind: treatment.proposedIntentKind,
        confidence: treatment.confidence,
        recommendationVersion: treatment.recommendationVersion,
        status: treatment.status,
        disposition: request === undefined ? "not_decided" : request.disposition,
        gating:
          request !== undefined && request.decision !== undefined
            ? request.decision.decision
            : "not_evaluated",
        request:
          request === undefined
            ? "not_requested"
            : frozen<DoctorRemediationRequestView>({
                status: request.status,
                requestedAt: request.requestedAt,
                requestedBy: request.requestedBy,
                decision: request.decision?.decision,
                decidedAt: request.decidedAt,
                outcome: request.outcome,
                executedAt: request.executedAt,
                evidenceCount: request.evidence.length,
              }),
      });
    });
  return frozen({
    state: steps.length > 0 ? "recommendations_proposed" : "no_recommendations_yet",
    steps: frozenArray(steps),
  });
}

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The Device Doctor journey: the nine frozen stages with honest states,
 * the symptom walk, and the remediation walk — every value derived from
 * REAL runtime state (the real-observations-only doctrine).
 */
export interface DeviceDoctorJourney {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The injected reference instant (display context; never a clock read). */
  readonly asOf: string;
  readonly stages: readonly DoctorJourneyStage[];
  readonly symptoms: DoctorSymptomWalk;
  readonly remediation: DoctorRemediationWalk;
  /** Machine-stable: is any remediation step parked for a human? */
  readonly approvalPending: boolean;
}

/** The journey build's inputs (all REAL state; nothing optional is fabricated). */
export interface DeviceDoctorJourneyInput {
  /** The device twin, when the device is in the acting tenant's fleet. */
  readonly twin: DeviceTwinLike | undefined;
  /** The device's immutable observations (the raw check-in records). */
  readonly observations: readonly Observation[];
  /** The REAL detected anomalies (the symptom source). */
  readonly anomalies: readonly AnomalyLike[];
  /** The REAL versioned diagnoses. */
  readonly diagnoses: readonly DiagnosisLike[];
  /** The REAL versioned treatment recommendations. */
  readonly treatments: readonly TreatmentLike[];
  /** The REAL remediation request records (disposition/gating/result). */
  readonly remediationRequests: readonly RemediationRequestLike[];
  /** The OPAQUE evidence refs backing the diagnosis surfaces. */
  readonly evidence: readonly {
    readonly key: string;
    readonly sizeBytes: number;
    readonly hash: string;
    readonly hashAlgorithm: string;
  }[];
  /** The injected "now" (ISO 8601). */
  readonly now: string;
}

/** The state of the diagnosis stage from the versioned diagnoses. PURE. */
function diagnosisStageState(diagnoses: readonly DiagnosisLike[]): DoctorJourneyStageState {
  if (diagnoses.length === 0) return "not_yet_observed";
  return diagnoses.some((diagnosis) => diagnosis.status === "ACTIVE")
    ? "ready"
    : "empty";
}

/** The state of the authorization stage across the remediation records. PURE. */
function authorizationStageState(
  requests: readonly RemediationRequestLike[],
): DoctorJourneyStageState {
  const decided = requests.filter((request) => request.decision !== undefined);
  if (decided.length === 0) return "not_yet_observed";
  if (decided.some((request) => request.decision?.decision === "REQUIRE_APPROVAL")) {
    return decided.some((request) => request.status === "PARKED")
      ? "approval_required"
      : "ready";
  }
  return "ready";
}

/** The state of the action stage from the durable requests. PURE. */
function actionStageState(requests: readonly RemediationRequestLike[]): DoctorJourneyStageState {
  if (requests.length === 0) return "not_yet_observed";
  return "ready";
}

/** The state of the result stage from the executed requests. PURE. */
function resultStageState(requests: readonly RemediationRequestLike[]): DoctorJourneyStageState {
  const executed = requests.filter((request) => request.outcome !== undefined);
  if (executed.length === 0) return "not_yet_observed";
  return "ready";
}

/**
 * Build the Device Doctor journey view-model. PURE and DETERMINISTIC:
 * the same inputs produce a byte-identical journey. A twin that is
 * absent yields the `blocked` device stage (the honest not-in-fleet
 * state — no existence side channel, no fabricated device header); an
 * absent observation list yields the honest `not_yet_observed`
 * observations stage.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param deviceId the device the journey belongs to
 * @param input the REAL runtime state (every stage's source)
 */
export function buildDeviceDoctorJourney(
  scope: DeviceUiTenantScope,
  deviceId: DeviceId,
  input: DeviceDoctorJourneyInput,
): DeviceDoctorJourney {
  const scopeRecord =
    scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  const guardTenant =
    typeof scopeRecord?.tenantId === "string" && scopeRecord.tenantId.length > 0
      ? (scopeRecord.tenantId as TenantId)
      : null;

  const symptomWalk = buildDoctorSymptomWalk(input.anomalies);
  const remediationWalk = buildDoctorRemediationWalk(input.treatments, input.remediationRequests);
  const activeDiagnoses = input.diagnoses.filter((diagnosis) => diagnosis.status === "ACTIVE");

  const stages: DoctorJourneyStage[] = [
    frozen<DoctorJourneyStage>({
      id: "device",
      state: input.twin === undefined ? "blocked" : "ready",
      headline: DOCTOR_JOURNEY_HEADLINES.device,
      rows:
        input.twin === undefined
          ? frozenArray([
              { label: "Device", value: deviceId as string },
              { label: "State", value: "Not in the acting fleet" },
            ])
          : frozenArray([
              { label: "Device", value: input.twin.deviceId as string },
              { label: "Lifecycle", value: input.twin.identity.lifecycleState },
              { label: "Adapter family", value: input.twin.identity.enrollment.adapterFamily },
              {
                label: "Observation count",
                value: String(input.twin.telemetry.observationCount),
              },
            ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "observations",
      state: input.observations.length === 0 ? "not_yet_observed" : "ready",
      headline: DOCTOR_JOURNEY_HEADLINES.observations,
      rows:
        input.observations.length === 0
          ? frozenArray([{ label: "Observations", value: "None recorded yet" }])
          : frozenArray([
              { label: "Count", value: String(input.observations.length) },
              {
                label: "Latest observed at",
                value: [...input.observations].sort((a, b) =>
                  a.observedAt === b.observedAt ? 0 : a.observedAt < b.observedAt ? -1 : 1,
                )[input.observations.length - 1]?.observedAt ?? "",
              },
              {
                label: "Kinds",
                value: [...new Set(input.observations.map((observation) => observation.kind))]
                  .sort(compareStrings)
                  .join(", "),
              },
            ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "symptoms",
      state: symptomWalk.state === "anomalies_detected" ? "ready" : "empty",
      headline: DOCTOR_JOURNEY_HEADLINES.symptoms,
      rows: frozenArray([
        { label: "State", value: symptomWalk.state },
        {
          label: "Critical / warning",
          value: `${symptomWalk.steps.filter((s) => s.severity === "CRITICAL").length} / ${
            symptomWalk.steps.filter((s) => s.severity === "WARNING").length
          }`,
        },
      ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "diagnosis",
      state: diagnosisStageState(input.diagnoses),
      headline: DOCTOR_JOURNEY_HEADLINES.diagnosis,
      rows:
        input.diagnoses.length === 0
          ? frozenArray([{ label: "Diagnoses", value: "None recorded yet" }])
          : frozenArray([
              { label: "Versions", value: String(input.diagnoses.length) },
              { label: "Active", value: String(activeDiagnoses.length) },
              {
                label: "Active labels",
                value:
                  activeDiagnoses.length === 0
                    ? "—"
                    : activeDiagnoses.map((diagnosis) => diagnosis.label).join(", "),
              },
            ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "remediation",
      state: remediationWalk.state === "recommendations_proposed" ? "ready" : "empty",
      headline: DOCTOR_JOURNEY_HEADLINES.remediation,
      rows: frozenArray([
        { label: "State", value: remediationWalk.state },
        { label: "Proposals", value: String(remediationWalk.steps.length) },
      ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "authorization",
      state: authorizationStageState(input.remediationRequests),
      headline: DOCTOR_JOURNEY_HEADLINES.authorization,
      rows: frozenArray([
        {
          label: "Evaluated requests",
          value: String(
            input.remediationRequests.filter((request) => request.decision !== undefined).length,
          ),
        },
        {
          label: "Parked",
          value: String(
            input.remediationRequests.filter((request) => request.status === "PARKED").length,
          ),
        },
      ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "action",
      state: actionStageState(input.remediationRequests),
      headline: DOCTOR_JOURNEY_HEADLINES.action,
      rows: frozenArray([
        {
          label: "Durable requests",
          value: String(input.remediationRequests.length),
        },
        {
          label: "Accepted proposals",
          value: String(
            input.remediationRequests.filter((request) => request.disposition === "accepted")
              .length,
          ),
        },
      ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "result",
      state: resultStageState(input.remediationRequests),
      headline: DOCTOR_JOURNEY_HEADLINES.result,
      rows: frozenArray([
        {
          label: "Executed",
          value: String(
            input.remediationRequests.filter((request) => request.outcome === "executed").length,
          ),
        },
        {
          label: "Failed",
          value: String(
            input.remediationRequests.filter((request) => request.outcome === "failed").length,
          ),
        },
      ]),
    }),
    frozen<DoctorJourneyStage>({
      id: "evidence",
      state: input.evidence.length === 0 ? "not_yet_observed" : "ready",
      headline: DOCTOR_JOURNEY_HEADLINES.evidence,
      rows: frozenArray([
        { label: "Artifacts", value: String(input.evidence.length) },
        {
          label: "Algorithms",
          value:
            input.evidence.length === 0
              ? "—"
              : [...new Set(input.evidence.map((ref) => ref.hashAlgorithm))]
                  .sort(compareStrings)
                  .join(", "),
        },
      ]),
    }),
  ];

  return frozen({
    tenantId: guardTenant ?? ("" as TenantId),
    deviceId,
    asOf: input.now,
    stages: frozenArray(stages),
    symptoms: symptomWalk,
    remediation: remediationWalk,
    approvalPending: remediationWalk.steps.some(
      (step) => step.request !== "not_requested" && step.request.status === "PARKED",
    ),
  });
}
