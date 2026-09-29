/**
 * @fleetos/web-device — D1 rendered: the DeviceLifecycleScreen (W090A).
 *
 * The React component layer over the EXISTING pure lifecycle/detail
 * view-models (`lifecycle.ts` — logic untouched): the device detail
 * header + the FROZEN device lifecycle state machine surfaced
 * READ-ONLY as a timeline, with the legal next transitions rendered
 * as REQUEST affordances whose AUTHORIZATION STATUS is visible on
 * every consequential action (the design contract's rule; the frozen
 * `LifecycleMachineView` never proposes or performs a transition).
 *
 * The authorization context arrives as PROPS (the binding site's
 * pure derivation — e.g. the policy/approval state of the pending
 * transition intent); the screen renders it, never re-derives it.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId, DeviceLifecycleState } from "@fleetos/contracts";
import { DEVICE_LIFECYCLE_ORDER } from "../lifecycle";
import type { DeviceDetailHeader } from "../lifecycle";
import { ConsoleStyles } from "../ui/tokens";
import {
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL, stalenessConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The visible authorization state of one requested lifecycle transition. */
export type TransitionAuthState = "not_requested" | "pending" | "granted" | "blocked";

/** The authorization context of a transition request (props-in). */
export interface TransitionAuthorizationView {
  readonly state: TransitionAuthState;
  /** Machine-stable note (e.g. the pending approval's id), rendered verbatim. */
  readonly note?: string;
}

export interface DeviceLifecycleScreenProps {
  readonly phase: ScreenPhase<DeviceDetailHeader | undefined>;
  readonly deviceId: DeviceId;
  /** Authorization context per TARGET lifecycle state (props-in, pure). */
  readonly transitionAuthorization: Readonly<Partial<Record<DeviceLifecycleState, TransitionAuthorizationView>>>;
  readonly onRequestTransition: (target: DeviceLifecycleState) => void;
  readonly onOpenDoctor: (deviceId: DeviceId) => void;
}

// ---------------------------------------------------------------------------
// Authorization presentation (never color alone)
// ---------------------------------------------------------------------------

const TRANSITION_AUTH_LABEL: Readonly<Record<TransitionAuthState, string>> = Object.freeze({
  not_requested: "Not requested",
  pending: "Awaiting authorization",
  granted: "Authorization granted",
  blocked: "Authorization blocked",
} as const);

function transitionAuthStatus(state: TransitionAuthState): "unknown" | "approval_required" | "healthy" | "blocked" {
  switch (state) {
    case "not_requested":
      return "unknown";
    case "pending":
      return "approval_required";
    case "granted":
      return "healthy";
    case "blocked":
      return "blocked";
  }
}

// ---------------------------------------------------------------------------
// The lifecycle timeline (read-only projection of the frozen machine)
// ---------------------------------------------------------------------------

function lifecycleTimeline(header: DeviceDetailHeader): readonly TimelineItem[] {
  const position = header.lifecycle.position;
  return DEVICE_LIFECYCLE_ORDER.map((state, index) => {
    const isCurrent = state === header.lifecycle.current;
    const past = position >= 0 && index < position;
    return {
      id: state,
      label: state,
      detail: isCurrent
        ? "Current state"
        : past
          ? `Passed (position ${index})`
          : `Position ${index}`,
      state: (isCurrent ? "current" : past ? "done" : "pending") as TimelineItem["state"],
      stateLabel: isCurrent ? "Current state" : past ? "Passed" : "Pending",
    };
  });
}

// ---------------------------------------------------------------------------
// The transition request cards (authorization VISIBLE, always)
// ---------------------------------------------------------------------------

function TransitionRequests({
  header,
  authorization,
  onRequest,
}: {
  readonly header: DeviceDetailHeader;
  readonly authorization: Readonly<Partial<Record<DeviceLifecycleState, TransitionAuthorizationView>>>;
  readonly onRequest: (target: DeviceLifecycleState) => void;
}): JSX.Element {
  if (header.lifecycle.isTerminal) {
    return (
      <Card title="Lifecycle transitions" subtitle="The current state is terminal.">
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          This device has reached <strong>{header.lifecycle.current}</strong>, the terminal lifecycle state.
          {header.lifecycle.loopClosure === "observation_cycle"
            ? " It re-enters OBSERVE through observation ingestion on the next cycle — a loop closure, not a state transition."
            : ""}
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Lifecycle transitions"
      subtitle="Transitions belong to the domain boundary. Each request below carries its visible authorization status."
    >
      <div className="fos-stack">
        {header.lifecycle.nextLegal.map((target) => {
          const auth = authorization[target] ?? { state: "not_requested" as TransitionAuthState };
          const semantic = transitionAuthStatus(auth.state);
          return (
            <div key={target} className="fos-spread" style={{ borderTop: "1px solid var(--hairline)", paddingTop: "0.75rem" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 500, fontSize: "0.875rem" }}>
                  Transition to <span className="fos-mono">{target}</span>
                </p>
                <p style={{ margin: "0.25rem 0 0" }}>
                  <StatusIndicator
                    status={semantic}
                    label={`Authorization: ${TRANSITION_AUTH_LABEL[auth.state]} — ${CONSOLE_STATUS_LABEL[semantic]}`}
                  />
                </p>
                {auth.note !== undefined && (
                  <p className="fos-meta" style={{ margin: "0.25rem 0 0" }}>
                    <span className="fos-mono">{auth.note}</span>
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={(): void => onRequest(target)}
                ariaLabel={`Request transition to ${target}`}
              >
                Request transition
              </Button>
            </div>
          );
        })}
      </div>
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        A request routes an intent through the action boundary: authorization, idempotency, audit, and
        verification are enforced before any transition lands. The screen never performs a transition.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered device lifecycle screen (detail header + machine + provenance). */
export function DeviceLifecycleScreen(props: DeviceLifecycleScreenProps): JSX.Element {
  const { phase } = props;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Device lifecycle">
        <Skeleton label="Loading the device lifecycle surface" rows={7} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the device lifecycle surface" />;
  } else if (phase.view === undefined) {
    body = (
      <EmptyState
        title="Device not found in your fleet"
        hint="The device is not enrolled in your tenant, or the identifier is wrong. Devices in other tenants are indistinguishable from unknown ones."
      />
    );
  } else {
    const header = phase.view;
    const stalenessSemantic = stalenessConsoleStatus(header.telemetry.staleness);
    body = (
      <>
        <Card title="Device summary">
          <DefinitionList
            entries={[
              { term: "Device", value: `${header.displayName} (${header.deviceId})` },
              { term: "Enrolled at", value: <span className="fos-mono fos-meta">{header.enrolledAt}</span> },
              { term: "Adapter family", value: header.adapterFamily },
              {
                term: "Hardware",
                value: `${header.hardware.manufacturer} ${header.hardware.model}${header.hardware.serialNumber !== undefined ? ` · SN ${header.hardware.serialNumber}` : ""}${header.hardware.assetTag !== undefined ? ` · Asset ${header.hardware.assetTag}` : ""}`,
              },
              {
                term: "Ownership",
                value: `${header.ownership.ownerType}${header.ownership.assignedTeam !== undefined && header.ownership.assignedTeam.length > 0 ? ` · ${header.ownership.assignedTeam}` : ""}${header.ownership.assignedUserId !== undefined ? ` · ${header.ownership.assignedUserId}` : ""}`,
              },
              { term: "Twin revision", value: String(header.revision) },
              { term: "Posture", value: `${header.posture.summary} (${header.posture.findingCount} findings)` },
              { term: "Workloads", value: String(header.workload.assignedWorkloadIds.length) },
              { term: "Active actions", value: String(header.actions.activeActionIds.length) },
              { term: "Recovery state", value: header.actions.recoveryState },
            ]}
          />
        </Card>
        <Card title="Telemetry">
          <p style={{ margin: 0 }}>
            <StatusIndicator
              status={stalenessSemantic}
              label={`Observation ${header.telemetry.staleness} — ${CONSOLE_STATUS_LABEL[stalenessSemantic]}`}
            />
          </p>
          <DefinitionList
            entries={[
              {
                term: "Last observed",
                value:
                  header.telemetry.lastObservedAt === null ? (
                    "No observation yet"
                  ) : (
                    <span className="fos-mono fos-meta">{header.telemetry.lastObservedAt}</span>
                  ),
              },
              { term: "Observations", value: String(header.telemetry.observationCount) },
            ]}
          />
        </Card>
        <Card title="Lifecycle state machine" subtitle="The frozen device lifecycle, surfaced read-only.">
          <Timeline items={lifecycleTimeline(header)} ariaLabel="Device lifecycle progress" />
          <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
            The canonical order is {DEVICE_LIFECYCLE_ORDER.join(" → ")}. States may not be skipped.
            {header.lifecycle.loopClosure === "observation_cycle"
              ? " LEARN re-enters OBSERVE via observation ingestion — the loop closes through ingestion, not a table transition."
              : ""}
          </p>
        </Card>
        <TransitionRequests
          header={header}
          authorization={props.transitionAuthorization}
          onRequest={props.onRequestTransition}
        />
        <Card title="Provenance history" subtitle="The twin's append-only revision log.">
          {header.provenance.entries.length === 0 ? (
            <EmptyState title="No revisions recorded" hint="The twin's revision log is empty." />
          ) : (
            <div className="fos-table-wrap">
              <table className="fos-table">
                <caption>Append-only revision log</caption>
                <thead>
                  <tr>
                    <th scope="col">Revision</th>
                    <th scope="col">At</th>
                    <th scope="col">Section</th>
                    <th scope="col">Mutation</th>
                  </tr>
                </thead>
                <tbody>
                  {header.provenance.entries.map((entry, index) => (
                    <tr key={`${entry.revision}-${index}`}>
                      <td>{entry.revision}</td>
                      <td><span className="fos-mono fos-meta">{entry.at}</span></td>
                      <td><span className="fos-mono">{entry.section}</span></td>
                      <td><span className="fos-mono">{entry.mutation}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — Lifecycle">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Devices" }, { label: "Lifecycle", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Lifecycle</h1>
          <p className="fos-screen-subtitle">
            Detail, lifecycle machine, and provenance for <span className="fos-mono">{props.deviceId}</span>.
          </p>
        </div>
        <Button variant="secondary" onClick={(): void => props.onOpenDoctor(props.deviceId)}>
          Open Device Doctor
        </Button>
      </header>
      {body}
    </section>
  );
}
