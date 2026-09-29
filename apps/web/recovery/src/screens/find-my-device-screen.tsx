/**
 * @fleetos/web-recovery — D2 rendered: the FindMyDeviceScreen (W090A).
 *
 * The React component layer over the EXISTING pure Find-My-Device
 * view-model (`find-my-device.ts` — logic untouched): the last-seen
 * evidence ledger surfaced READ-ONLY with the machine-stable
 * `no_location_evidence` state presented EXPLICITLY (never a guess,
 * never a disabled-looking fake control) and the location payload
 * staying opaque-by-omission (the evidence ref is the anchor).
 *
 * The screen is the entry point of the lost-device journey: last-seen
 * evidence -> "Open recovery case" (the case context that gates every
 * destructive action).
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId } from "@fleetos/contracts";
import type { FindMyDeviceViewModel } from "../find-my-device";
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
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL, stalenessConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FindMyDeviceScreenProps {
  readonly phase: ScreenPhase<FindMyDeviceViewModel>;
  readonly deviceId: DeviceId;
  readonly onOpenRecoveryCase: (deviceId: DeviceId) => void;
  readonly onOpenCases: () => void;
}

// ---------------------------------------------------------------------------
// The last-seen + location cards
// ---------------------------------------------------------------------------

function LastSeenCard({ view }: { readonly view: FindMyDeviceViewModel }): JSX.Element {
  if (view.lastSeen === undefined) {
    return (
      <Card title="Last seen" subtitle="The evidence ledger for this device is empty.">
        <EmptyState
          title="No last-seen evidence yet"
          hint="Last-seen records appear when the device reports observations. Until then, this device's recency is Unknown — an absence of evidence is never treated as freshness."
        />
      </Card>
    );
  }
  const semantic = stalenessConsoleStatus(view.lastSeen.staleness);
  return (
    <Card title="Last seen" subtitle={`View as of ${view.asOf}`}>
      <p style={{ margin: "0 0 0.75rem" }}>
        <StatusIndicator
          status={semantic}
          label={`Staleness ${view.lastSeen.staleness} — ${CONSOLE_STATUS_LABEL[semantic]}`}
        />
      </p>
      <DefinitionList
        entries={[
          { term: "Record", value: <span className="fos-mono">{view.lastSeen.recordId}</span> },
          { term: "Observed at", value: <span className="fos-mono fos-meta">{view.lastSeen.observedAt}</span> },
          { term: "Recorded at", value: <span className="fos-mono fos-meta">{view.lastSeen.recordedAt}</span> },
          { term: "Evidence refs", value: String(view.lastSeen.evidenceCount) },
        ]}
      />
    </Card>
  );
}

function LocationCard({ view }: { readonly view: FindMyDeviceViewModel }): JSX.Element {
  if (view.location.status === "no_location_evidence") {
    return (
      <Card title="Last-known location" subtitle="The machine-stable absent-evidence state.">
        <p style={{ margin: 0 }}>
          <StatusIndicator status="unknown" label="No location evidence — Unknown" />
        </p>
        <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
          This device has not reported location-bearing evidence. The state is presented exactly as the
          domain asserts it — never interpolated, never guessed. Location appears only when a
          location-bearing observation arrives.
        </p>
      </Card>
    );
  }
  const semantic = stalenessConsoleStatus(view.location.staleness);
  return (
    <Card title="Last-known location" subtitle="Anchored to the immutable location observation.">
      <p style={{ margin: "0 0 0.75rem" }}>
        <StatusIndicator
          status={semantic}
          label={`Located — evidence ${view.location.staleness} — ${CONSOLE_STATUS_LABEL[semantic]}`}
        />
      </p>
      <DefinitionList
        entries={[
          { term: "Evidence ref", value: <span className="fos-mono">{view.location.observationId}</span> },
          { term: "Observation kind", value: <span className="fos-mono">{view.location.observationKind}</span> },
          { term: "Observed at", value: <span className="fos-mono fos-meta">{view.location.observedAt}</span> },
          { term: "From record", value: <span className="fos-mono">{view.location.fromRecordId}</span> },
        ]}
      />
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        The location payload stays in the evidence store — the surface anchors to the immutable
        observation's reference, timestamp, and staleness.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered Find My Device screen (read-only evidence ledger). */
export function FindMyDeviceScreen(props: FindMyDeviceScreenProps): JSX.Element {
  const { phase } = props;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Find My Device">
        <Skeleton label="Loading the last-seen evidence" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the last-seen evidence" />;
  } else {
    const view = phase.view;
    body = (
      <>
        <LastSeenCard view={view} />
        <LocationCard view={view} />
        <Card
          title="Evidence ledger (append-only)"
          subtitle={`${view.ledger.length} revision${view.ledger.length === 1 ? "" : "s"} · ${view.ledger.filter((entry) => entry.locationBorne).length} carried location evidence`}
        >
          {view.ledger.length === 0 ? (
            <EmptyState title="The ledger is empty" hint="Revisions appear as last-seen observations are recorded." />
          ) : (
            <ol className="fos-timeline" aria-label="Last-seen ledger history">
              {view.ledger.map((entry) => {
                const semantic = stalenessConsoleStatus(entry.staleness);
                return (
                  <li key={`${entry.version}-${entry.recordId}`}>
                    <span
                      className={`fos-timeline__marker fos-timeline__marker--${entry.locationBorne ? "done" : "current"}`}
                      aria-hidden="true"
                    />
                    <span className="fos-timeline__body">
                      <span className="fos-timeline__label">
                        v{entry.version} — record <span className="fos-mono">{entry.recordId}</span>
                      </span>
                      <span className="fos-timeline__detail">
                        observed <span className="fos-mono">{entry.observedAt}</span> · recorded{" "}
                        <span className="fos-mono">{entry.recordedAt}</span>
                      </span>
                      <span className="fos-timeline__detail">
                        <StatusIndicator
                          status={semantic}
                          label={`${entry.staleness} — ${CONSOLE_STATUS_LABEL[semantic]}`}
                        />{" "}
                        · {entry.evidenceCount} evidence ref{entry.evidenceCount === 1 ? "" : "s"} ·{" "}
                        {entry.locationBorne ? "location-bearing" : "no location evidence"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <Card title="Next step">
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
            A lost device needs a recovery case: the durable, versioned context that gates every
            destructive recovery action (locate, lock, wipe, reboot) behind the Contract Guardian and
            human approval.
          </p>
          <div className="fos-row">
            <Button variant="primary" onClick={(): void => props.onOpenRecoveryCase(props.deviceId)}>
              Open recovery case
            </Button>
            <Button variant="secondary" onClick={props.onOpenCases}>
              View recovery cases
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Recovery — Find My Device">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Recovery" }, { label: "Find My Device", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Find My Device</h1>
          <p className="fos-screen-subtitle">
            Last-seen evidence and location state for <span className="fos-mono">{props.deviceId}</span>.
          </p>
        </div>
      </header>
      {body}
    </section>
  );
}
