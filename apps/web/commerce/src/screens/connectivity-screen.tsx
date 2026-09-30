/**
 * @fleetos/web-commerce — D2.5 rendered: the ConnectivityScreen
 * (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`connectivity.ts` + `outcomes.ts` — logic untouched): the fleet
 * connectivity state with PER-DEVICE status semantics (every device a
 * submission targets gets one row: submission status, awaiting-
 * approval flag, adopted execution state, verification), the
 * connectivity intent-request inbox (the full Guardian decision
 * context — PARKED approvals visible with their decision + reasons),
 * and the adopted status-ingestion timelines (the normalized
 * execution states + degradation taxonomy). The VERIFIED connectivity
 * outcome renders explicitly (ACTIVE + measurements + no failure).
 *
 * Provider-neutrality (LOCK 6-8): the provider handle, refusal DETAIL
 * and every topology/credential field NEVER render — the
 * machine-stable refusal reason only.
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The open submission
 * id and open connectivity id are props; no business truth in React
 * state.
 */

import type { JSX, ReactNode } from "react";
import { ConsoleStyles } from "../ui/tokens";
import {
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Sheet,
  Skeleton,
  StatusIndicator,
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  executionStateConsoleStatus,
  submissionConsoleStatus,
} from "../ui/status";
import type {
  ConnectivityRequestView,
  ConnectivitySubmissionListView,
  ConnectivityTimelineView,
} from "../connectivity";
import type {
  FleetConnectivityStatusView,
} from "../outcomes";
import { CommerceJourneyRail, ConsequentialActionCard } from "./commerce-shared";
import type { CommerceJourneyRailStage, ConsequentialActionDescriptor } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The composed connectivity data (built by the shell from the builders). */
export interface ConnectivityScreenData {
  readonly submissions: ConnectivitySubmissionListView;
  /** The per-device fleet status rows. */
  readonly fleetStatus: FleetConnectivityStatusView;
  /** The adopted status-ingestion timelines. */
  readonly timelines: readonly ConnectivityTimelineView[];
}

export interface ConnectivityScreenProps {
  readonly phase: ScreenPhase<ConnectivityScreenData>;
  /** The open submission (the controlled request-detail Sheet). */
  readonly openSubmissionId: string | null;
  readonly onOpenSubmission: (submissionId: string | null) => void;
  /** The open adopted record (the controlled timeline Sheet). */
  readonly openConnectivityId: string | null;
  readonly onOpenConnectivity: (connectivityId: string | null) => void;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The per-device fleet status table
// ---------------------------------------------------------------------------

function FleetStatusTable({
  fleetStatus,
  onOpenConnectivity,
}: {
  readonly fleetStatus: FleetConnectivityStatusView;
  readonly onOpenConnectivity: (connectivityId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>
          Fleet connectivity — {fleetStatus.total} device{fleetStatus.total === 1 ? "" : "s"} ·{" "}
          {fleetStatus.verifiedCount} verified · {fleetStatus.awaitingApprovalCount} awaiting
          approval
        </caption>
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Submission</th>
            <th scope="col">Connectivity</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {fleetStatus.rows.map((row) => {
            const verifiedStatus = executionStateConsoleStatus(
              row.executionState ?? "unknown",
              row.verified,
            );
            const statusLabel = row.verified
              ? `VERIFIED (${row.executionState ?? "—"}) — ${CONSOLE_STATUS_LABEL[verifiedStatus]}`
              : row.awaitingApproval
                ? `${row.latestSubmissionStatus ?? "—"} — ${CONSOLE_STATUS_LABEL.approval_required}`
                : `${row.executionState ?? row.latestSubmissionStatus ?? "—"} — ${CONSOLE_STATUS_LABEL[verifiedStatus]}`;
            return (
              <tr key={row.deviceId} data-device-id={row.deviceId}>
                <td>
                  <span className="fos-mono">{row.deviceId}</span>
                  {row.workloadId !== null && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      workload <span className="fos-mono">{row.workloadId}</span>
                    </span>
                  )}
                </td>
                <td>
                  {row.submissionIds.length === 0 ? (
                    <span className="fos-meta">No request</span>
                  ) : (
                    row.submissionIds.map((submissionId) => (
                      <span key={submissionId} style={{ display: "block" }} className="fos-mono fos-meta">
                        {submissionId}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  {row.connectivityId === null ? (
                    <span className="fos-meta">Not adopted</span>
                  ) : (
                    <button
                      type="button"
                      className="fos-linklike"
                      aria-label={`Open connectivity timeline ${row.connectivityId}`}
                      onClick={(): void => onOpenConnectivity(row.connectivityId ?? "")}
                    >
                      {row.connectivityId}
                    </button>
                  )}
                  {row.measurementKinds.length > 0 && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      measurements: {row.measurementKinds.join(", ")}
                    </span>
                  )}
                </td>
                <td>
                  <StatusIndicator status={verifiedStatus} label={statusLabel} />
                  {(row.degraded || row.failed) && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      {row.failed ? "failure observed" : "degraded"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The submissions inbox + the request-detail sheet
// ---------------------------------------------------------------------------

function SubmissionsTable({
  view,
  onOpenSubmission,
}: {
  readonly view: ConnectivitySubmissionListView;
  readonly onOpenSubmission: (submissionId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>
          Connectivity intent requests — {view.total} submitted · {view.parkedCount} parked for
          approval
        </caption>
        <thead>
          <tr>
            <th scope="col">Submission</th>
            <th scope="col">Outcome</th>
            <th scope="col">Targets</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row: ConnectivityRequestView) => {
            const status = submissionConsoleStatus(row.status);
            return (
              <tr key={row.submissionId} data-submission-id={row.submissionId}>
                <td>
                  <button
                    type="button"
                    className="fos-linklike"
                    aria-label={`Open connectivity request ${row.submissionId}`}
                    onClick={(): void => onOpenSubmission(row.submissionId)}
                  >
                    {row.submissionId}
                  </button>
                  <br />
                  <span className="fos-mono fos-meta">{row.intentRef.intentId} v{row.intentRef.version}</span>
                </td>
                <td>
                  <span className="fos-mono fos-meta">{row.outcome.canonical}</span>
                </td>
                <td>
                  {row.targets.sourceDeviceId !== null && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      source <span className="fos-mono">{row.targets.sourceDeviceId}</span>
                    </span>
                  )}
                  {row.targets.targetDeviceId !== null && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      target <span className="fos-mono">{row.targets.targetDeviceId}</span>
                    </span>
                  )}
                  {row.targets.workloadId !== null && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      workload <span className="fos-mono">{row.targets.workloadId}</span>
                    </span>
                  )}
                </td>
                <td>
                  <StatusIndicator
                    status={status}
                    label={`${row.status} — ${CONSOLE_STATUS_LABEL[status]}`}
                  />
                  {row.awaitingApproval && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      awaiting human approval
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubmissionSheet({
  request,
  adopted,
  onClose,
}: {
  readonly request: ConnectivityRequestView;
  /** The adopted connectivity record joined by the submission's intent ref, when present. */
  readonly adopted: ConnectivityTimelineView | null;
  readonly onClose: () => void;
}): JSX.Element {
  const status = submissionConsoleStatus(request.status);
  // The VERIFICATION RESULT facet: the adopted record joined through
  // the originating intent — VERIFIED when ACTIVE + measurements + no
  // failure; null when no record is adopted yet (never invented).
  const adoptedVerified =
    adopted !== null &&
    adopted.executionState === "ACTIVE" &&
    !adopted.failed &&
    (adopted.entries[adopted.entries.length - 1]?.measurementKinds.length ?? 0) > 0;
  const authorization: ConsequentialActionDescriptor = {
    action: "Connectivity request (ADCOS boundary)",
    authorization: "The connectivity intent boundary (provider-neutral submission)",
    policyDecision:
      request.awaitingApproval
        ? "The Contract Guardian decision REQUIRE_APPROVAL parked this submission."
        : null,
    approvalRequired: request.awaitingApproval
      ? "Yes — the parked submission requires human approval"
      : "No — no approval is pending on this submission",
    expectedEffect: "The provider-neutral connectivity request executes through the ADCOS boundary",
    evidenceRequired: "The submission revision timeline with the Guardian decision context",
    executionState: request.awaitingApproval
      ? "Parked — awaiting approval"
      : `Submission ${request.status}`,
    executionStatus: status,
    verification:
      adopted === null
        ? null
        : adoptedVerified
          ? `VERIFIED: the adopted connectivity ${adopted.connectivityId} is ACTIVE with measurements (${adopted.entries[adopted.entries.length - 1]?.measurementKinds.join(", ")}) and no failure.`
          : `The adopted connectivity ${adopted.connectivityId} is ${adopted.executionState} — not yet verified.`,
    verificationStatus:
      adopted === null
        ? null
        : executionStateConsoleStatus(adopted.executionState, adoptedVerified),
  };
  return (
    <Sheet
      open={true}
      title={`Connectivity request — ${request.submissionId}`}
      onClose={onClose}
      closeLabel="Close the connectivity request panel"
    >
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Submission", value: <span className="fos-mono">{request.submissionId}</span> },
            { term: "Status", value: (
              <StatusIndicator status={status} label={`${request.status} — ${CONSOLE_STATUS_LABEL[status]}`} />
            ) },
            {
              term: "Outcome",
              value: `${request.outcome.canonical} (raw: ${request.outcome.raw})`,
            },
            {
              term: "Intent ref",
              value: <span className="fos-mono">{request.intentRef.intentId} v{request.intentRef.version}</span>,
            },
          ]}
        />
      </Card>
      <Card title="Request (provider-neutral)">
        <DefinitionList
          entries={[
            {
              term: "Targets",
              value: [
                request.targets.sourceDeviceId !== null ? `source ${request.targets.sourceDeviceId}` : null,
                request.targets.targetDeviceId !== null ? `target ${request.targets.targetDeviceId}` : null,
                request.targets.workloadId !== null ? `workload ${request.targets.workloadId}` : null,
              ]
                .filter((part) => part !== null)
                .join(" · ") || "—",
            },
            {
              term: "Properties",
              value: `latency ≤ ${request.properties.maxLatencyMs ?? "—"}ms · throughput ≥ ${request.properties.minThroughputMbps ?? "—"}Mbps · availability ${request.properties.availabilityTarget ?? "—"} · isolation ${request.properties.isolation} · redundancy ${request.properties.redundancy}`,
            },
            {
              term: "Constraints",
              value: `required zones ${request.constraints.requiredZones.join(", ") || "—"} · forbidden ${request.constraints.forbiddenZones.join(", ") || "—"} · hops ≤ ${request.constraints.maxPathHops ?? "—"} · egress ${request.constraints.egressAllowed ? "allowed" : "denied"}`,
            },
            {
              term: "Duration",
              value: `${request.duration.startAt} → ${request.duration.endAt ?? (request.duration.indefinite ? "indefinite" : "—")}`,
            },
            {
              term: "Budget",
              value: `${request.budget.budgetRef ?? "—"} · policies ${request.budget.policyRefs.join(", ") || "—"}`,
            },
            {
              term: "Security",
              value: `encryption ${request.security.encryption} · private routing ${request.security.privateRouting ? "required" : "no"} · compliance ${request.security.complianceRefs.join(", ") || "—"}`,
            },
          ]}
        />
      </Card>
      <ConsequentialActionCard descriptor={authorization} />
      <Card
        title="Decision timeline"
        subtitle="The append-only revision timeline — the full Guardian decision context; provider refusal shows the machine-stable REASON only."
      >
        {request.revisions.length === 0 ? (
          <EmptyState title="No revisions recorded" hint="Revisions appear as the submission advances." />
        ) : (
          <ol className="fos-timeline" aria-label="Submission decision timeline">
            {request.revisions.map((revision) => (
              <li key={revision.revision}>
                <span
                  className={`fos-timeline__marker fos-timeline__marker--${revision.decisionType === "REQUIRE_APPROVAL" ? "blocked" : revision.revision === request.revisions.length ? "current" : "done"}`}
                  aria-hidden="true"
                />
                <span className="fos-timeline__body">
                  <span className="fos-timeline__label">
                    r{revision.revision} · {revision.status}
                    {revision.decisionType !== null && (
                      <span className="fos-meta" style={{ marginLeft: "0.4rem" }}>
                        Guardian: {revision.decisionType}
                      </span>
                    )}
                  </span>
                  <span className="fos-timeline__detail">
                    <span className="fos-mono">{revision.at}</span>
                  </span>
                  {revision.matchedRules.length > 0 && (
                    <span className="fos-timeline__detail">
                      matched rules:{" "}
                      {revision.matchedRules.map((rule) => `${rule.ruleId} v${rule.version}`).join(", ")}
                    </span>
                  )}
                  {revision.reasons.map((reason, index) => (
                    <span key={`${reason.code}-${index}`} className="fos-timeline__detail">
                      <span className="fos-mono">{reason.code}</span>
                      {reason.ruleId !== undefined ? ` (rule ${reason.ruleId} v${reason.ruleVersion ?? "—"}, effect ${reason.effect ?? "—"})` : ""}
                    </span>
                  ))}
                  {revision.providerRefusalReason !== null && (
                    <span className="fos-timeline__detail">
                      provider refusal reason: <span className="fos-mono">{revision.providerRefusalReason}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The adopted timeline sheet (the verified outcome)
// ---------------------------------------------------------------------------

function ConnectivityTimelineSheet({
  timeline,
  onClose,
}: {
  readonly timeline: ConnectivityTimelineView;
  readonly onClose: () => void;
}): JSX.Element {
  const verified =
    timeline.executionState === "ACTIVE" &&
    !timeline.failed &&
    (timeline.entries[timeline.entries.length - 1]?.measurementKinds.length ?? 0) > 0;
  const status = executionStateConsoleStatus(timeline.executionState, verified);
  const items: readonly TimelineItem[] = timeline.entries.map((entry) => ({
    id: `r${entry.revision}`,
    label: `Revision r${entry.revision} — ${entry.executionState}`,
    detail: `adopted ${entry.adoptedAt}${
      entry.measurementKinds.length > 0 ? ` · measurements: ${entry.measurementKinds.join(", ")}` : ""
    }${entry.degraded ? ` · degradation: ${entry.degradationKind}` : ""}${
      entry.failed ? ` · failure: ${entry.failureKind}` : ""
    }${entry.terminationReason !== null ? ` · terminated: ${entry.terminationReason}` : ""}`,
    state:
      entry.revision === timeline.entries.length
        ? "current"
        : entry.failed
          ? "blocked"
          : "done",
  }));
  return (
    <Sheet
      open={true}
      title={`Connectivity timeline — ${timeline.connectivityId}`}
      onClose={onClose}
      closeLabel="Close the connectivity timeline panel"
    >
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Connectivity", value: <span className="fos-mono">{timeline.connectivityId}</span> },
            {
              term: "Execution state",
              value: (
                <StatusIndicator
                  status={status}
                  label={`${timeline.executionState} — ${CONSOLE_STATUS_LABEL[status]}${verified ? " (VERIFIED)" : ""}`}
                />
              ),
            },
            {
              term: "Intent ref",
              value:
                timeline.intentRef === null
                  ? "Not bound"
                  : `${timeline.intentRef.intentId} v${timeline.intentRef.version}`,
            },
            {
              term: "Degradation observed",
              value:
                timeline.observedDegradationKinds.length === 0
                  ? "None"
                  : timeline.observedDegradationKinds.join(", "),
            },
          ]}
        />
      </Card>
      <Card
        title="Status ingestion timeline"
        subtitle="The append-only revision chain — normalized execution states, machine-stable degradation/failure taxonomy, per-revision digests."
      >
        <Timeline items={items} ariaLabel="Connectivity status ingestion timeline" />
      </Card>
      <Card title="Verification">
        <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
          {verified
            ? `VERIFIED: the latest revision is ACTIVE with measurements (${timeline.entries[timeline.entries.length - 1]?.measurementKinds.join(", ")}) and no failure — the verified connectivity outcome.`
            : `Not yet verified: the record is ${timeline.executionState}${timeline.failed ? " with a failure observed" : timeline.entries[timeline.entries.length - 1]?.measurementKinds.length === 0 ? " and no measurements on the latest revision" : ""}.`}
        </p>
      </Card>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered connectivity screen (fleet state, requests, verified timelines). */
export function ConnectivityScreen(props: ConnectivityScreenProps): JSX.Element {
  const { phase } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Fleet connectivity">
        <Skeleton label="Loading the connectivity surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the connectivity surface" />;
  } else if (ready === null) {
    body = null;
  } else {
    body = (
      <>
        {ready.fleetStatus.rows.length === 0 ? (
          <EmptyState
            title="No connectivity state exists yet"
            hint="Connectivity requests target devices and workloads; the per-device status, the adopted execution state and the verified outcome appear here."
          />
        ) : (
          <Card
            title="Fleet connectivity status"
            subtitle="Per-device status semantics: submission state, adopted execution state, verification."
          >
            <FleetStatusTable
              fleetStatus={ready.fleetStatus}
              onOpenConnectivity={(connectivityId): void => props.onOpenConnectivity(connectivityId)}
            />
          </Card>
        )}
        {ready.submissions.rows.length === 0 ? (
          <EmptyState
            title="No connectivity requests are submitted"
            hint="A connectivity intent request carries the provider-neutral outcome, targets, QoS properties, hard constraints, duration and security requirements."
          />
        ) : (
          <Card
            title="Connectivity requests"
            subtitle="The intent-request inbox — PARKED submissions await human approval (the Guardian decision context is in the detail)."
          >
            <SubmissionsTable
              view={ready.submissions}
              onOpenSubmission={(submissionId): void => props.onOpenSubmission(submissionId)}
            />
          </Card>
        )}
        {ready.timelines.length > 0 && (
          <Card
            title="Adopted connectivity records"
            subtitle="The status-ingestion timelines — the normalized execution states with measurements as evidence."
          >
            <ul>
              {ready.timelines.map((timeline) => {
                const verified =
                  timeline.executionState === "ACTIVE" &&
                  !timeline.failed &&
                  (timeline.entries[timeline.entries.length - 1]?.measurementKinds.length ?? 0) > 0;
                const status = executionStateConsoleStatus(timeline.executionState, verified);
                return (
                  <li key={timeline.connectivityId} style={{ marginBottom: "0.5rem" }}>
                    <button
                      type="button"
                      className="fos-linklike"
                      aria-label={`Open connectivity timeline ${timeline.connectivityId}`}
                      onClick={(): void => props.onOpenConnectivity(timeline.connectivityId)}
                    >
                      {timeline.connectivityId}
                    </button>{" "}
                    <StatusIndicator
                      status={status}
                      label={`${timeline.executionState} — ${CONSOLE_STATUS_LABEL[status]}${verified ? " (VERIFIED)" : ""}`}
                    />
                    <span className="fos-meta" style={{ display: "block" }}>
                      {String(timeline.entries.length)} adopted revision
                      {timeline.entries.length === 1 ? "" : "s"}
                      {timeline.degraded ? " · latest revision degraded" : ""}
                      {timeline.failed ? " · failure observed" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </>
    );
  }

  // The controlled detail sheets.
  let sheet: ReactNode = null;
  if (ready !== null && props.openSubmissionId !== null) {
    const request = ready.submissions.rows.find(
      (candidate) => candidate.submissionId === props.openSubmissionId,
    );
    // Join the adopted connectivity record through the submission's
    // originating intent ref (the machine-stable join).
    const adopted =
      request === undefined
        ? null
        : (ready.timelines.find(
            (candidate) =>
              candidate.intentRef !== null &&
              candidate.intentRef.intentId === request.intentRef.intentId,
          ) ?? null);
    if (request !== undefined) {
      sheet = (
        <SubmissionSheet
          request={request}
          adopted={adopted}
          onClose={(): void => props.onOpenSubmission(null)}
        />
      );
    }
  }
  if (ready !== null && sheet === null && props.openConnectivityId !== null) {
    const timeline = ready.timelines.find(
      (candidate) => candidate.connectivityId === props.openConnectivityId,
    );
    if (timeline !== undefined) {
      sheet = (
        <ConnectivityTimelineSheet
          timeline={timeline}
          onClose={(): void => props.onOpenConnectivity(null)}
        />
      );
    }
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — connectivity">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Commerce" }, { label: "Connectivity", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Connectivity</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.fleetStatus.total} device${phase.view.fleetStatus.total === 1 ? "" : "s"} · ${phase.view.fleetStatus.verifiedCount} verified · ${phase.view.submissions.parkedCount} awaiting approval`
              : "The fleet connectivity state: per-device status, intent requests and verified timelines."}
          </p>
        </div>
        {(props.openSubmissionId !== null || props.openConnectivityId !== null) && (
          <Button
            variant="secondary"
            onClick={(): void => {
              props.onOpenSubmission(null);
              props.onOpenConnectivity(null);
            }}
            ariaLabel="Close the open detail panel"
          >
            Close detail
          </Button>
        )}
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <CommerceJourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
      {sheet}
    </section>
  );
}
