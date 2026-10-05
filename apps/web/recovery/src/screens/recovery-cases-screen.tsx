/**
 * @fleetos/web-recovery — D2 rendered: the RecoveryCasesScreen (W090A).
 *
 * The React component layer over the EXISTING pure recovery-case
 * view-models (`recovery-case.ts` — logic untouched): the cases list
 * (active first — the visible recovery effort) + the case detail
 * presented in a Sheet (contextual detail instead of deep page
 * stacks), following the record pattern: trigger (what happened) ->
 * current state (the read-only status machine) -> why it matters
 * (the visible destructive-gate precondition) -> evidence basis ->
 * history (the append-only version timeline).
 *
 * The case detail NEVER offers a transition control: transitions
 * belong to the domain boundary; the surface only makes the legal
 * continuations and the gate VISIBLE.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId } from "@fleetos/contracts";
import type {
  RecoveryCaseListViewModel,
  RecoveryCaseViewModel,
} from "../recovery-case";
import type { RecoveryCaseJourney } from "../recovery-journey";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
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
import { CONSOLE_STATUS_LABEL, caseConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecoveryCasesScreenProps {
  readonly phase: ScreenPhase<RecoveryCaseListViewModel>;
  /** The currently-open case id (the Sheet is open when defined). */
  readonly selectedCaseId: string | undefined;
  /** The selected case's view-model (undefined while it loads). */
  readonly selectedCase: RecoveryCaseViewModel | undefined;
  readonly onSelectCase: (caseId: string) => void;
  readonly onCloseCase: () => void;
  readonly onOpenDestructive: (deviceId: DeviceId) => void;
  readonly onOpenFindMy: (deviceId: DeviceId) => void;
  /**
   * W141: the per-case journeys (optional; the runtime feed supplies
   * them, keyed by case id). The selected case's journey renders in
   * the detail Sheet — lost/stolen signal -> recovery case ->
   * locate/secure decision -> authorization -> action -> evidence ->
   * closure/escalation, every stage from real runtime state.
   */
  readonly journeys?: Readonly<Record<string, RecoveryCaseJourney>>;
}

// ---------------------------------------------------------------------------
// The cases table
// ---------------------------------------------------------------------------

function CasesTable({
  view,
  onSelectCase,
}: {
  readonly view: RecoveryCaseListViewModel;
  readonly onSelectCase: (caseId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Recovery cases — active recovery first</caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Device</th>
            <th scope="col">Status</th>
            <th scope="col">Trigger</th>
            <th scope="col">Opened at</th>
            <th scope="col">Version</th>
          </tr>
        </thead>
        <tbody>
          {view.cases.map((row) => {
            const semantic = caseConsoleStatus(row.status, row.isActive, row.isTerminal);
            return (
              <tr key={row.caseId}>
                <td>
                  <button
                    type="button"
                    className="fos-linklike"
                    onClick={(): void => onSelectCase(row.caseId)}
                    aria-label={`Open recovery case ${row.caseId} for device ${row.deviceId}`}
                  >
                    {row.caseId}
                  </button>
                </td>
                <td><span className="fos-mono">{row.deviceId}</span></td>
                <td>
                  <StatusIndicator
                    status={semantic}
                    label={`${row.status} — ${CONSOLE_STATUS_LABEL[semantic]}`}
                  />
                </td>
                <td><span className="fos-mono">{row.triggerKind}</span></td>
                <td><span className="fos-mono fos-meta">{row.openedAt}</span></td>
                <td>v{row.version}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The case detail (Sheet — contextual, record pattern)
// ---------------------------------------------------------------------------

function CaseDetail({
  caseView,
  journey,
  onOpenDestructive,
  onOpenFindMy,
}: {
  readonly caseView: RecoveryCaseViewModel;
  readonly journey: RecoveryCaseJourney | undefined;
  readonly onOpenDestructive: (deviceId: DeviceId) => void;
  readonly onOpenFindMy: (deviceId: DeviceId) => void;
}): JSX.Element {
  const semantic = caseConsoleStatus(
    caseView.status,
    caseView.stateMachine.isActive,
    caseView.stateMachine.isTerminal,
  );
  return (
    <div className="fos-stack">
      <Card title="What happened (trigger)">
        <DefinitionList
          entries={[
            { term: "Trigger kind", value: <span className="fos-mono">{caseView.trigger.kind}</span> },
            {
              term: "Reported at",
              value:
                caseView.trigger.reportedAt === undefined ? (
                  "—"
                ) : (
                  <span className="fos-mono fos-meta">{caseView.trigger.reportedAt}</span>
                ),
            },
            {
              term: "Posture status",
              value: caseView.trigger.postureStatus ?? "—",
            },
            { term: "Finding refs", value: String(caseView.trigger.findingRefCount) },
            { term: "Note", value: caseView.trigger.note ?? "—" },
          ]}
        />
      </Card>
      <Card title="Current state (read-only machine)">
        <p style={{ margin: "0 0 0.5rem" }}>
          <StatusIndicator
            status={semantic}
            label={`${caseView.status} — ${CONSOLE_STATUS_LABEL[semantic]}`}
          />
        </p>
        <DefinitionList
          entries={[
            { term: "Version", value: `v${caseView.version}` },
            {
              term: "Legal continuations",
              value:
                caseView.stateMachine.legalNext.length === 0
                  ? "None — the case is terminal"
                  : caseView.stateMachine.legalNext.join(", "),
            },
            {
              term: "Terminal",
              value: caseView.stateMachine.isTerminal ? "Yes" : "No",
            },
            {
              term: "Closure",
              value:
                caseView.closure === undefined ? (
                  "Open"
                ) : (
                  <>
                    {caseView.closure.reason} · <span className="fos-mono fos-meta">{caseView.closure.closedAt}</span>
                  </>
                ),
            },
          ]}
        />
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
          Case transitions belong to the recovery domain — the surface displays the legal continuations
          of the injected frozen table, never a transition control.
        </p>
      </Card>
      <Card
        title="Why it matters (the destructive gate)"
        subtitle="Whether this case accepts destructive requests — the precondition the gate enforces."
      >
        <p style={{ margin: 0 }}>
          {caseView.gating.acceptsDestructive ? (
            <>
              <Badge status="needs_attention">Destructive actions accepted in this state</Badge>{" "}
              <span className="fos-meta">
                Lock, locate, wipe and reboot requests may be recorded against this case — each through
                the gated path.
              </span>
            </>
          ) : (
            <>
              <Badge status="unknown">Destructive actions not accepted</Badge>{" "}
              <span className="fos-meta">
                The case is not in an active recovery state; no destructive request can be recorded
                until it is.
              </span>
            </>
          )}
        </p>
      </Card>
      <Card title="Evidence basis">
        <DefinitionList
          entries={[
            {
              term: "Last-seen record",
              value: caseView.evidenceBasis.lastSeenRecordId ?? "—",
            },
            {
              term: "Last-seen observed at",
              value:
                caseView.evidenceBasis.lastSeenObservedAt === undefined ? (
                  "—"
                ) : (
                  <span className="fos-mono fos-meta">{caseView.evidenceBasis.lastSeenObservedAt}</span>
                ),
            },
            {
              term: "Posture finding refs",
              value:
                caseView.evidenceBasis.postureFindingRefs.length === 0
                  ? "—"
                  : caseView.evidenceBasis.postureFindingRefs.join(", "),
            },
          ]}
        />
      </Card>
      <Card title="History (append-only)">
        <ol className="fos-timeline" aria-label="Case revision history">
          {caseView.history.map((revision) => (
            <li key={`${revision.version}-${revision.recordId}`}>
              <span
                className={`fos-timeline__marker fos-timeline__marker--${revision.version === caseView.version ? "current" : "done"}`}
                aria-hidden="true"
              />
              <span className="fos-timeline__body">
                <span className="fos-timeline__label">v{revision.version} — {revision.status}</span>
                <span className="fos-timeline__detail">
                  {revision.transitionedAt !== undefined ? (
                    <span className="fos-mono">{revision.transitionedAt}</span>
                  ) : (
                    "opened"
                  )}
                  {revision.closureReason !== undefined ? ` · closed: ${revision.closureReason}` : ""}
                </span>
                <span className="fos-timeline__detail">
                  record <span className="fos-mono">{revision.recordId}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      {journey !== undefined && (
        <Card
          title="Recovery journey"
          subtitle="Signal, case, locate/secure decision, authorization, action, evidence, closure/escalation — every stage from real runtime state."
        >
          <Timeline
            items={journey.stages.map((stage) => ({
              id: stage.id,
              label: stage.headline,
              detail: stage.rows.map((row) => `${row.label}: ${row.value}`).join(" · "),
              state: journeyTimelineState(stage.state),
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
            })) satisfies TimelineItem[]}
            ariaLabel="Recovery case journey"
          />
        </Card>
      )}
      <div className="fos-row">
        <Button variant="primary" onClick={(): void => onOpenDestructive(caseView.deviceId)}>
          Open destructive actions
        </Button>
        <Button variant="secondary" onClick={(): void => onOpenFindMy(caseView.deviceId)}>
          Find this device
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered recovery cases screen (list + Sheet detail). */
export function RecoveryCasesScreen(props: RecoveryCasesScreenProps): JSX.Element {
  const { phase } = props;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Recovery cases">
        <Skeleton label="Loading recovery cases" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading recovery cases" />;
  } else {
    const view = phase.view;
    body = view.cases.length === 0 ? (
      <EmptyState
        title="No recovery cases"
        hint="Cases open from lost-device reports or posture escalations. A case is the durable context that gates every destructive recovery action."
      />
    ) : (
      <>
        <Card
          title="Recovery effort"
          subtitle={`${view.counts.active} active · ${view.counts.closed} closed · ${view.counts.total} total. Active cases are listed first.`}
        >
          <CasesTable view={view} onSelectCase={props.onSelectCase} />
        </Card>
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Recovery — Cases">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Recovery" }, { label: "Cases", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Recovery cases</h1>
          <p className="fos-screen-subtitle">
            The durable, versioned context for lost-device and posture-escalation recovery.
          </p>
        </div>
      </header>
      {body}
      <CaseSheet {...props} />
    </section>
  );
}

/** The journey stage's timeline state (honest, never color alone). */
function journeyTimelineState(
  state: "ready" | "not_yet_observed" | "empty" | "blocked" | "approval_required",
): TimelineItem["state"] {
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

/** The selected-case Sheet (loading and ready states). */
function CaseSheet(props: RecoveryCasesScreenProps): JSX.Element {
  if (props.selectedCaseId === undefined) return <></>;
  return (
    <Sheet
      open={true}
      title={`Recovery case ${props.selectedCaseId}`}
      onClose={props.onCloseCase}
    >
      {props.selectedCase === undefined ? (
        <Card>
          <Skeleton label="Loading the recovery case" rows={5} />
        </Card>
      ) : (
        <CaseDetail
          caseView={props.selectedCase}
          journey={props.journeys?.[props.selectedCase.caseId]}
          onOpenDestructive={props.onOpenDestructive}
          onOpenFindMy={props.onOpenFindMy}
        />
      )}
    </Sheet>
  );
}
