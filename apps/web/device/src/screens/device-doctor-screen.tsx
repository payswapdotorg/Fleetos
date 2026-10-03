/**
 * @fleetos/web-device — D1 rendered: the DeviceDoctorScreen (W090A).
 *
 * The React component layer over the EXISTING pure doctor view-model
 * (`doctor.ts` — logic untouched). The screen follows the design
 * contract's RECORD PATTERN:
 *
 *   summary -> current state -> why it matters -> recommended action
 *           -> evidence -> history
 *
 * Presentation rules (frozen):
 *   - Signals / baselines / anomalies / VERSIONED diagnoses /
 *     treatment recommendations render as tabbed panels (the pure
 *     `DoctorPanelState` machine, fully controlled).
 *   - Treatment recommendations are PROPOSALS: each row shows the
 *     proposed intent KIND, rationale, confidence, version lineage
 *     (supersedes) and the ledger-derived status; Accept / Dismiss
 *     are INTENT affordances routed through callbacks (the
 *     established proposal/intent boundaries) — a proposal is NEVER
 *     presented as an executed action.
 *   - The Guardian gating context per treatment (when the binding
 *     site supplies it) renders with the frozen blocking semantics;
 *     unevaluated proposals display `not_evaluated` — never a guess.
 *   - Evidence refs render OPAQUE (key/size/hash/algorithm,
 *     verbatim — never interpreted).
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId, GuardianDecisionType } from "@fleetos/contracts";
import { DOCTOR_PANELS } from "../doctor";
import type {
  DeviceDoctorViewModel,
  DiagnosisPanelRow,
  DoctorPanel,
  DoctorPanelState,
  TreatmentPanelRow,
} from "../doctor";
import type {
  DeviceDoctorJourney,
  DoctorJourneyStage,
  DoctorRemediationStep,
  DoctorSymptomStep,
} from "../doctor-journey";
import { ConsoleStyles } from "../ui/tokens";
import {
  AlertError,
  Badge,
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
  Tabs,
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  anomalyConsoleStatus,
  guardianConsoleStatus,
  interpretationConsoleStatus,
} from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The Guardian gating context of one treatment proposal (binding-site supplied). */
export interface TreatmentGatingView {
  readonly decision: GuardianDecisionType;
  readonly reasons: readonly { readonly code: string; readonly ruleId?: string }[];
}

/** The operator's recorded disposition of a treatment proposal. */
export type TreatmentDisposition = "accepted" | "dismissed";

export interface DeviceDoctorScreenProps {
  readonly phase: ScreenPhase<DeviceDoctorViewModel | undefined>;
  /** `undefined` view inside `ready` = the device is not in your fleet. */
  readonly deviceId: DeviceId;
  readonly panel: DoctorPanelState;
  readonly onPanelChange: (panel: DoctorPanel) => void;
  readonly onPanelBack: () => void;
  readonly onOpenDevice: (deviceId: DeviceId) => void;
  readonly onAcceptTreatment: (treatment: TreatmentPanelRow) => void;
  readonly onDismissTreatment: (treatment: TreatmentPanelRow) => void;
  /** Per-treatment Guardian gating (optional; keyed by treatment id). */
  readonly treatmentGating?: Readonly<Record<string, TreatmentGatingView>>;
  /** Per-treatment operator disposition (optional; keyed by treatment id). */
  readonly treatmentDisposition?: Readonly<Record<string, TreatmentDisposition>>;
  /**
   * W141: the composed diagnosis JOURNEY (optional; the runtime feed
   * supplies it). The full nine-stage walk — device -> observations ->
   * symptoms -> diagnosis -> remediation -> authorization -> action ->
   * result -> evidence — with the symptom walk and the remediation
   * walk, every stage from real runtime state (honest not-yet-observed
   * states; never fabricated observations).
   */
  readonly journey?: DeviceDoctorJourney;
}

// ---------------------------------------------------------------------------
// Record-pattern blocks
// ---------------------------------------------------------------------------

function DoctorSummary({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  return (
    <Card title="Summary" subtitle={`Diagnosis surface as of ${view.asOf}`}>
      <DefinitionList
        entries={[
          { term: "Device", value: <span className="fos-mono">{view.deviceId}</span> },
          { term: "Signal kinds", value: String(view.summary.signalKinds) },
          {
            term: "Anomalies",
            value: `${view.summary.anomalyCounts.critical} critical · ${view.summary.anomalyCounts.warning} warning`,
          },
          { term: "Active diagnoses", value: String(view.summary.activeDiagnoses) },
          { term: "Active treatment proposals", value: String(view.summary.activeTreatments) },
          { term: "Evidence artifacts", value: String(view.evidence.length) },
        ]}
      />
    </Card>
  );
}

function WhyItMatters({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  let text: string;
  if (view.summary.anomalyCounts.critical > 0) {
    text = `${view.summary.anomalyCounts.critical} critical anomal${view.summary.anomalyCounts.critical === 1 ? "y needs" : "ies need"} attention: the device is operating outside its expected behavior. Diagnoses below explain the likely cause; treatments are proposals that require policy evaluation before anything executes.`;
  } else if (view.summary.anomalyCounts.warning > 0) {
    text = `${view.summary.anomalyCounts.warning} warning-level anomal${view.summary.anomalyCounts.warning === 1 ? "y was" : "ies were"} detected. No critical condition is present; monitor the signals and review the versioned interpretations.`;
  } else if (view.summary.signalKinds > 0) {
    text = "No anomalies were detected in the current window. The signals and baselines below establish the device's expected behavior.";
  } else {
    text = "No health signals have been derived for this device yet. Observations must be ingested before the doctor can interpret anything — an absence of evidence is not evidence of health.";
  }
  return (
    <Card title="Why it matters">
      <p style={{ margin: 0, fontSize: "0.875rem" }}>{text}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// W141 — the diagnosis journey (the full nine-stage walk + the two walks)
// ---------------------------------------------------------------------------

/** The journey stage's timeline state (honest, never color alone). */
function journeyStageTimelineState(state: DoctorJourneyStage["state"]): TimelineItem["state"] {
  switch (state) {
    case "ready":
      return "done";
    case "not_yet_observed":
      return "pending";
    case "empty":
      return "pending";
    case "blocked":
      return "blocked";
    case "approval_required":
      return "current";
  }
}

function SymptomWalkCard({ journey }: { readonly journey: DeviceDoctorJourney }): JSX.Element {
  if (journey.symptoms.state === "no_anomalies_detected") {
    return (
      <Card title="Symptom walk" subtitle="The anomaly-driven operator steps, from real detections only.">
        <EmptyState
          title="No anomalies detected"
          hint="Nothing crossed a detection rule in the current window. The walk stays empty — no symptom is ever invented; an absence of evidence is not evidence of health."
        />
      </Card>
    );
  }
  return (
    <Card title="Symptom walk" subtitle="One step per detected anomaly, severity first — each anchored to its evidence observations.">
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Detected symptoms, severity first</caption>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">Symptom (rule)</th>
              <th scope="col">Signal</th>
              <th scope="col">Observed at</th>
              <th scope="col">Evidence observations</th>
            </tr>
          </thead>
          <tbody>
            {journey.symptoms.steps.map((step: DoctorSymptomStep) => (
              <tr key={step.anomalyId}>
                <td>
                  <StatusIndicator
                    status={anomalyConsoleStatus(step.severity)}
                    label={`${step.severity} — ${CONSOLE_STATUS_LABEL[anomalyConsoleStatus(step.severity)]}`}
                  />
                </td>
                <td>
                  <span className="fos-mono">{step.ruleId}</span>
                  <br />
                  <span className="fos-meta">anomaly <span className="fos-mono">{step.anomalyId}</span></span>
                </td>
                <td>
                  {step.value} {step.unit}
                  <br />
                  <span className="fos-meta">{step.signalKind}</span>
                </td>
                <td><span className="fos-mono fos-meta">{step.observedAt}</span></td>
                <td>{step.evidenceObservationIds.length} observation{step.evidenceObservationIds.length === 1 ? "" : "s"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RemediationWalkCard({ journey }: { readonly journey: DeviceDoctorJourney }): JSX.Element {
  if (journey.remediation.state === "no_recommendations_yet") {
    return (
      <Card title="Remediation walk" subtitle="The gated path each proposal takes, from real request records.">
        <EmptyState
          title="No treatment recommendations"
          hint="Treatments are proposed once a diagnosis identifies a remediable cause. Until then this walk stays honestly empty — no recommendation is invented."
        />
      </Card>
    );
  }
  return (
    <Card title="Remediation walk" subtitle="Each proposal on its gated path: disposition, Guardian decision, durable request, result. A recommendation is never an executed action.">
      <div className="fos-stack">
        {journey.remediation.steps.map((step: DoctorRemediationStep) => (
          <Card key={step.treatmentId} title={`Proposal: ${step.rationale}`} subtitle={`Treatment ${step.treatmentId} · intent ${step.proposedIntentKind}`}>
            <DefinitionList
              entries={[
                { term: "Disposition", value: step.disposition === "not_decided" ? "Not decided yet" : step.disposition === "accepted" ? "Accepted — routed to the intent boundary" : "Dismissed by the operator" },
                {
                  term: "Guardian decision",
                  value:
                    step.gating === "not_evaluated" ? (
                      <span className="fos-meta">Not evaluated — nothing has been routed</span>
                    ) : (
                      <StatusIndicator
                        status={guardianConsoleStatus(step.gating)}
                        label={`${step.gating} — ${CONSOLE_STATUS_LABEL[guardianConsoleStatus(step.gating)]}`}
                      />
                    ),
                },
                {
                  term: "Durable request",
                  value:
                    step.request === "not_requested" ? (
                      <span className="fos-meta">Not requested</span>
                    ) : (
                      <span className="fos-mono">{step.request.status}</span>
                    ),
                },
                {
                  term: "Execution result",
                  value:
                    step.request === "not_requested" || step.request.outcome === undefined ? (
                      <span className="fos-meta">Not executed — no outcome exists</span>
                    ) : (
                      <StatusIndicator
                        status={step.request.outcome === "executed" ? "succeeded" : "failed"}
                        label={`${step.request.outcome} at ${step.request.executedAt}`}
                      />
                    ),
                },
              ]}
            />
            {step.request !== "not_requested" && step.request.status === "PARKED" && (
              <p style={{ margin: "0.75rem 0 0" }}>
                <Badge status="approval_required">Awaiting a human decision</Badge>{" "}
                <span className="fos-meta">The request is PARKED — approval happens at the action boundary, never here.</span>
              </p>
            )}
          </Card>
        ))}
      </div>
    </Card>
  );
}

/** The composed diagnosis journey: the nine-stage timeline + the walks. */
function DiagnosisJourney({ journey }: { readonly journey: DeviceDoctorJourney }): JSX.Element {
  const items: TimelineItem[] = journey.stages.map((stage) => ({
    id: stage.id,
    label: stage.headline,
    detail: stage.rows.map((row) => `${row.label}: ${row.value}`).join(" · "),
    state: journeyStageTimelineState(stage.state),
    stateLabel:
      stage.state === "ready"
        ? undefined
        : stage.state === "not_yet_observed"
          ? "Not yet observed"
          : stage.state === "empty"
            ? "Nothing to show — honest empty"
            : stage.state === "approval_required"
              ? "Approval required"
              : "Blocked",
  }));
  return (
    <>
      <Card
        title="The diagnosis journey"
        subtitle={`The full operator walk as of ${journey.asOf} — device, observations, symptoms, diagnosis, remediation, authorization, action, result, evidence. Every stage reflects real runtime state; stages the runtime has no records for say so.`}
      >
        <Timeline items={items} ariaLabel="Device diagnosis journey" />
      </Card>
      <SymptomWalkCard journey={journey} />
      <RemediationWalkCard journey={journey} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function SignalsPanel({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  if (view.signals.length === 0) {
    return <EmptyState title="No signals derived yet" hint="Signals are derived from ingested observations. Enroll reporting or wait for the next observation cycle." />;
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Health signals per kind, with the latest sample</caption>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Latest value</th>
            <th scope="col">Observed at</th>
            <th scope="col">Confidence</th>
            <th scope="col">Window min–max</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {view.signals.map((signal) => (
            <tr key={signal.kind}>
              <td>
                <span className="fos-mono">{signal.kind}</span>
                <br />
                <span className="fos-meta">{signal.unit}</span>
              </td>
              <td>{signal.latest === undefined ? <span className="fos-meta">No sample</span> : `${signal.latest.value} ${signal.unit}`}</td>
              <td>{signal.latest === undefined ? <span className="fos-meta">—</span> : <span className="fos-mono fos-meta">{signal.latest.observedAt}</span>}</td>
              <td>{signal.latest === undefined ? <span className="fos-meta">—</span> : signal.latest.confidence.toFixed(2)}</td>
              <td>
                {signal.min === undefined || signal.max === undefined ? (
                  <span className="fos-meta">—</span>
                ) : (
                  `${signal.min} – ${signal.max} ${signal.unit}`
                )}
              </td>
              <td>{signal.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BaselinesPanel({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  if (view.baselines.length === 0) {
    return <EmptyState title="No baselines yet" hint="Baselines accumulate as the fleet reports; they anchor anomaly detection." />;
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Statistical baselines, read-only</caption>
        <thead>
          <tr>
            <th scope="col">Scope</th>
            <th scope="col">Signal</th>
            <th scope="col">Window</th>
            <th scope="col">Median · p95</th>
            <th scope="col">Devices</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {view.baselines.map((baseline, index) => (
            <tr key={`${baseline.signalKind}-${index}`}>
              <td>{baseline.scopeKind}</td>
              <td>
                <span className="fos-mono">{baseline.signalKind}</span>
                <br />
                <span className="fos-meta">{baseline.unit}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{baseline.windowStart}</span>
                <br />
                <span className="fos-mono fos-meta">{baseline.windowEnd}</span>
              </td>
              <td>
                {baseline.summary.median} · {baseline.summary.p95} {baseline.unit}
              </td>
              <td>{baseline.deviceCount}</td>
              <td>{baseline.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnomaliesPanel({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  if (view.anomalies.length === 0) {
    return <EmptyState title="No anomalies detected" hint="Nothing crossed a detection rule in the current window." />;
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Detected anomalies, severity first</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Rule</th>
            <th scope="col">Signal</th>
            <th scope="col">Value</th>
            <th scope="col">Observed at</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {view.anomalies.map((anomaly) => (
            <tr key={anomaly.id}>
              <td>
                <StatusIndicator
                  status={anomalyConsoleStatus(anomaly.severity)}
                  label={`${anomaly.severity} — ${CONSOLE_STATUS_LABEL[anomalyConsoleStatus(anomaly.severity)]}`}
                />
              </td>
              <td>
                <span className="fos-mono">{anomaly.ruleId}</span>
                <br />
                <span className="fos-meta">{anomaly.signalKind}</span>
              </td>
              <td>{anomaly.unit}</td>
              <td>{anomaly.value}</td>
              <td><span className="fos-mono fos-meta">{anomaly.observedAt}</span></td>
              <td>{anomaly.evidenceCount} observation{anomaly.evidenceCount === 1 ? "" : "s"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosesPanel({ view }: { readonly view: DeviceDoctorViewModel }): JSX.Element {
  if (view.diagnoses.length === 0) {
    return <EmptyState title="No diagnoses recorded" hint="Diagnoses appear once anomalies are interpreted by the diagnosis engine." />;
  }
  return (
    <div className="fos-stack">
      {view.diagnoses.map((diagnosis: DiagnosisPanelRow) => (
        <Card key={diagnosis.id} title={diagnosis.label}>
          <DefinitionList
            entries={[
              { term: "Cause", value: <span className="fos-mono">{diagnosis.causeId}</span> },
              { term: "Confidence", value: diagnosis.confidence.toFixed(2) },
              { term: "Interpretation version", value: `v${diagnosis.interpretationVersion}` },
              {
                term: "Supersedes",
                value:
                  diagnosis.supersedes === undefined ? (
                    <span className="fos-meta">Initial interpretation</span>
                  ) : (
                    <span className="fos-mono">{diagnosis.supersedes}</span>
                  ),
              },
              { term: "Proposed at", value: <span className="fos-mono fos-meta">{diagnosis.proposedAt}</span> },
            ]}
          />
          <p style={{ margin: "0.75rem 0 0" }}>
            <StatusIndicator
              status={interpretationConsoleStatus(diagnosis.status)}
              label={`Interpretation ${diagnosis.status} — ${CONSOLE_STATUS_LABEL[interpretationConsoleStatus(diagnosis.status)]}`}
            />
          </p>
          {diagnosis.evidenceLinks.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>Evidence links</p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
                {diagnosis.evidenceLinks.map((link, index) => (
                  <li key={`${link.anomalyId}-${index}`}>
                    Anomaly <span className="fos-mono">{link.anomalyId}</span> (rule{" "}
                    <span className="fos-mono">{link.ruleId}</span>, {link.severity}) ·{" "}
                    {link.observationIds.length} observation{link.observationIds.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function TreatmentRow({
  treatment,
  gating,
  disposition,
  onAccept,
  onDismiss,
}: {
  readonly treatment: TreatmentPanelRow;
  readonly gating: TreatmentGatingView | undefined;
  readonly disposition: TreatmentDisposition | undefined;
  readonly onAccept: (treatment: TreatmentPanelRow) => void;
  readonly onDismiss: (treatment: TreatmentPanelRow) => void;
}): JSX.Element {
  const guardianStatus = gating === undefined ? "not_evaluated" : gating.decision;
  const semantic = guardianConsoleStatus(guardianStatus);
  return (
    <Card
      title={`Proposal: ${treatment.rationale}`}
      subtitle={`Treatment proposal ${treatment.id}`}
      actions={
        disposition === undefined ? (
          <div className="fos-row">
            <Button variant="primary" onClick={(): void => onAccept(treatment)}>Accept proposal</Button>
            <Button variant="ghost" onClick={(): void => onDismiss(treatment)}>Dismiss proposal</Button>
          </div>
        ) : undefined
      }
    >
      <DefinitionList
        entries={[
          { term: "Proposed intent", value: <span className="fos-mono">{treatment.proposedIntentKind}</span> },
          { term: "Hypothesis", value: <span className="fos-mono">{treatment.hypothesisId}</span> },
          { term: "Action", value: <span className="fos-mono">{treatment.actionId}</span> },
          { term: "Confidence", value: treatment.confidence.toFixed(2) },
          { term: "Recommendation version", value: `v${treatment.recommendationVersion}` },
          {
            term: "Supersedes",
            value:
              treatment.supersedes === undefined ? (
                <span className="fos-meta">Initial recommendation</span>
              ) : (
                <span className="fos-mono">{treatment.supersedes}</span>
              ),
          },
          { term: "Proposed at", value: <span className="fos-mono fos-meta">{treatment.proposedAt}</span> },
        ]}
      />
      <p style={{ margin: "0.75rem 0 0" }}>
        <StatusIndicator
          status={interpretationConsoleStatus(treatment.status)}
          label={`Recommendation ${treatment.status} — ${CONSOLE_STATUS_LABEL[interpretationConsoleStatus(treatment.status)]}`}
        />
      </p>
      <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <p style={{ margin: 0, fontSize: "0.8125rem" }}>
          <StatusIndicator
            status={semantic}
            label={`Guardian: ${guardianStatus} — ${CONSOLE_STATUS_LABEL[semantic]}`}
          />
        </p>
        {gating !== undefined && gating.reasons.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
            {gating.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>
                <span className="fos-mono">{reason.code}</span>
                {reason.ruleId !== undefined ? <> (rule <span className="fos-mono">{reason.ruleId}</span>)</> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="fos-meta" style={{ margin: 0 }}>
          Execution requires Contract Guardian evaluation and, where required, human approval — accepting a
          proposal routes the intent to the action boundary; it does not execute anything.
        </p>
        {disposition === "accepted" && (
          <p style={{ margin: 0 }}>
            <Badge status="informational">Accepted — routed to the intent boundary</Badge>{" "}
            <span className="fos-meta">Not executed: execution is verified separately, with evidence.</span>
          </p>
        )}
        {disposition === "dismissed" && (
          <p style={{ margin: 0 }}>
            <Badge status="unknown">Dismissed</Badge>{" "}
            <span className="fos-meta">The proposal was dismissed by the operator; the versioned lineage is preserved.</span>
          </p>
        )}
      </div>
    </Card>
  );
}

function TreatmentsPanel({
  view,
  gating,
  disposition,
  onAccept,
  onDismiss,
}: {
  readonly view: DeviceDoctorViewModel;
  readonly gating: Readonly<Record<string, TreatmentGatingView>> | undefined;
  readonly disposition: Readonly<Record<string, TreatmentDisposition>> | undefined;
  readonly onAccept: (treatment: TreatmentPanelRow) => void;
  readonly onDismiss: (treatment: TreatmentPanelRow) => void;
}): JSX.Element {
  if (view.treatments.length === 0) {
    return (
      <EmptyState
        title="No treatment recommendations"
        hint="Treatments are proposed once a diagnosis identifies a remediable cause. Recommendations are versioned proposals — never automatic actions."
      />
    );
  }
  return (
    <div className="fos-stack">
      {view.treatments.map((treatment) => (
        <TreatmentRow
          key={treatment.id}
          treatment={treatment}
          gating={gating?.[treatment.id]}
          disposition={disposition?.[treatment.id]}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const PANEL_TAB_LABELS: Readonly<Record<DoctorPanel, string>> = Object.freeze({
  signals: "Signals",
  baselines: "Baselines",
  anomalies: "Anomalies",
  diagnoses: "Diagnoses",
  treatments: "Treatments",
} as const);

/** The rendered Device Doctor screen (the record pattern). */
export function DeviceDoctorScreen(props: DeviceDoctorScreenProps): JSX.Element {
  const { phase } = props;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Device Doctor">
        <Skeleton label="Loading the device diagnosis surface" rows={7} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the device diagnosis surface" />;
  } else if (phase.view === undefined) {
    body = (
      <EmptyState
        title="Device not found in your fleet"
        hint="The device is not enrolled in your tenant, or the identifier is wrong. Devices in other tenants are indistinguishable from unknown ones."
        action={{ label: "Back to the fleet list", onClick: (): void => props.onOpenDevice(props.deviceId) }}
      />
    );
  } else {
    const view = phase.view;
    const tabs = DOCTOR_PANELS.map((panel) => ({
      id: panel,
      label: PANEL_TAB_LABELS[panel],
      count:
        panel === "signals" ? view.signals.length
        : panel === "baselines" ? view.baselines.length
        : panel === "anomalies" ? view.anomalies.length
        : panel === "diagnoses" ? view.diagnoses.length
        : view.treatments.length,
    }));
    let panelBody: ReactNode;
    switch (props.panel.current) {
      case "signals":
        panelBody = <SignalsPanel view={view} />;
        break;
      case "baselines":
        panelBody = <BaselinesPanel view={view} />;
        break;
      case "anomalies":
        panelBody = <AnomaliesPanel view={view} />;
        break;
      case "diagnoses":
        panelBody = <DiagnosesPanel view={view} />;
        break;
      case "treatments":
        panelBody = (
          <TreatmentsPanel
            view={view}
            gating={props.treatmentGating}
            disposition={props.treatmentDisposition}
            onAccept={props.onAcceptTreatment}
            onDismiss={props.onDismissTreatment}
          />
        );
        break;
    }
    body = (
      <>
        <DoctorSummary view={view} />
        <WhyItMatters view={view} />
        {props.journey !== undefined && <DiagnosisJourney journey={props.journey} />}
        <Card
          title="Current state and interpretations"
          subtitle="Signals, baselines, anomalies, versioned diagnoses, and treatment proposals."
          actions={
            props.panel.history.length > 0 ? (
              <Button variant="ghost" onClick={props.onPanelBack}>← Back to {PANEL_TAB_LABELS[props.panel.history[props.panel.history.length - 1]]}</Button>
            ) : undefined
          }
        >
          <Tabs
            tabs={tabs}
            activeId={props.panel.current}
            onChange={(id: string): void => props.onPanelChange(id as DoctorPanel)}
            ariaLabel="Device Doctor panels"
          />
          <div role="tabpanel" id={`fos-panel-${props.panel.current}`} aria-labelledby={`fos-tab-${props.panel.current}`} style={{ marginTop: "1rem" }}>
            {panelBody}
          </div>
        </Card>
        <Card title="Evidence" subtitle="Opaque content-addressable references — verbatim, never interpreted.">
          {view.evidence.length === 0 ? (
            <EmptyState title="No evidence artifacts" hint="Evidence refs appear when observations back a diagnosis." />
          ) : (
            <div className="fos-table-wrap">
              <table className="fos-table">
                <caption>Evidence artifacts backing the diagnosis surfaces</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Size</th>
                    <th scope="col">Hash</th>
                    <th scope="col">Algorithm</th>
                  </tr>
                </thead>
                <tbody>
                  {view.evidence.map((ref, index) => (
                    <tr key={`${ref.key}-${index}`}>
                      <td><span className="fos-mono">{ref.key}</span></td>
                      <td>{ref.sizeBytes} bytes</td>
                      <td><span className="fos-mono">{ref.hash}</span></td>
                      <td>{ref.hashAlgorithm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="History" subtitle="Diagnoses and treatments are versioned and append-only: supersession is displayed, never rewritten.">
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            {view.diagnoses.length} diagnosis version{view.diagnoses.length === 1 ? "" : "s"} and{" "}
            {view.treatments.length} treatment version{view.treatments.length === 1 ? "" : "s"} are recorded in the
            interpretation ledger. Each row above carries its version and its supersedes link; dismissed and
            superseded interpretations remain visible.
          </p>
        </Card>
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — Device Doctor">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Devices" }, { label: "Device Doctor", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Device Doctor</h1>
          <p className="fos-screen-subtitle">
            Diagnosis record for <span className="fos-mono">{props.deviceId}</span> — summary, current state,
            recommended actions, evidence, and history.
          </p>
        </div>
        <Button variant="secondary" onClick={(): void => props.onOpenDevice(props.deviceId)}>
          Open device detail
        </Button>
      </header>
      {body}
    </section>
  );
}
