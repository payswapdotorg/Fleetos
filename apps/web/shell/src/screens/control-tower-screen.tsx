/**
 * @fleetos/web-shell — the Control Tower screen (W091 [TL]).
 *
 * The first screen after tenant selection (spec/ui/CONSOLE-DESIGN.md):
 * one primary "Needs attention" stream, a compact fleet-health /
 * security pulse, recent activity, a small set of high-value counters,
 * and DIRECT links into the exact record that needs action — plus the
 * always-discoverable onboarding entry point. Deliberately NOT a dense
 * wall of KPI cards.
 *
 * Presentational and fully controlled over the ControlTowerView
 * view-model (control-tower.ts). No business truth in React state.
 */
import type { JSX } from "react";
import type { ShellRoute } from "../navigation";
import type { ControlTowerView } from "../control-tower";
import { SHELL_AREA_LABELS, SHELL_AREA_VIEWS } from "../navigation";
import { Badge, Button, Card, EmptyState, StatusIndicator, Timeline } from "../ui/primitives";
import { bandConsoleStatus } from "../ui/status";

export interface ControlTowerScreenProps {
  readonly view: ControlTowerView;
  readonly onNavigate: (route: ShellRoute) => void;
}

export function ControlTowerScreen({ view, onNavigate }: ControlTowerScreenProps): JSX.Element {
  return (
    <div className="fos-screen">
      <Card
        title="Needs attention"
        subtitle="The single primary stream — severity-ordered, each item links directly to its record."
      >
        {view.attentionStream.length === 0 ? (
          <EmptyState
            title="Nothing needs your attention right now"
            hint="Records at Needs-attention severity or above appear here the moment surfaces report them."
          />
        ) : (
          <ul className="fos-stack">
            {view.attentionStream.map((item) => (
              <li key={`${item.area}-${item.recordId}`} className="fos-spread">
                <div className="fos-stack" style={{ gap: "0.15rem" }}>
                  <span className="fos-row">
                    <StatusIndicator status={bandConsoleStatus(item.band)} />
                    <strong>{item.title}</strong>
                  </span>
                  <span className="fos-meta">{item.subtitle}</span>
                  <span className="fos-meta">
                    {SHELL_AREA_LABELS[item.area]} · <span className="fos-mono">{item.recordId}</span>
                  </span>
                </div>
                <span className="fos-row">
                  <Button
                    variant="secondary"
                    disabled={!item.navigable}
                    onClick={() => onNavigate(item.route)}
                  >
                    Open {SHELL_AREA_LABELS[item.area]}
                  </Button>
                  <Button variant="ghost" onClick={() => onNavigate(item.evidenceRoute)}>
                    Evidence
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="fos-grid">
        {view.pulses.map((pulse) => (
          <Card key={pulse.group} title={pulse.group}>
            <p className="fos-spread">
              <span>
                {pulse.total} record{pulse.total === 1 ? "" : "s"}
              </span>
              <Badge status={pulse.attention > 0 ? "needs_attention" : "healthy"}>
                {pulse.attention > 0 ? `${pulse.attention} need attention` : "all clear"}
              </Badge>
            </p>
            {pulse.bands.length === 0 ? (
              <p className="fos-meta">No records yet.</p>
            ) : (
              <ul className="fos-stack" style={{ gap: "0.3rem" }}>
                {pulse.bands.map((row) => (
                  <li key={row.band} className="fos-spread">
                    <StatusIndicator status={bandConsoleStatus(row.band)} />
                    <span className="fos-meta">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <div className="fos-grid">
        <Card title="Recent activity" subtitle="Consequential acts, exactly as the audit trail recorded them.">
          {view.recentActivity.length === 0 ? (
            <EmptyState
              title="No recent consequential activity"
              hint="Approved actions, recoveries, enrollments and commerce decisions land here with their audit record."
            />
          ) : (
            <Timeline
              entries={view.recentActivity.map((item) => ({
                label: item.action,
                detail: `${item.actor} · ${item.at} · outcome: ${item.outcome} · audit ${item.recordId}`,
              }))}
            />
          )}
        </Card>

        <Card title="Onboarding" subtitle="Bring an existing fleet under management.">
          <p className="fos-meta">
            The enrollment journey: initiate → review → confirm → verified, with evidence at
            every gate.
          </p>
          <p>
            <Button
              variant="primary"
              disabled={!view.onboarding.navigable}
              title={view.onboarding.reason || view.onboarding.label}
              onClick={() => onNavigate(view.onboarding.route)}
            >
              {view.onboarding.label}
            </Button>
          </p>
          {!view.onboarding.navigable && (
            <p className="fos-meta" role="note">
              {view.onboarding.reason}
            </p>
          )}
        </Card>
      </div>

      <Card
        title="High-value counters"
        subtitle="Where the fleet stands, by area — the full picture lives one click deep."
      >
        {view.counters.length === 0 ? (
          <EmptyState title="No records yet" hint="Counters appear as surfaces report records." />
        ) : (
          <div className="fos-table-wrap">
            <table className="fos-table">
              <caption>Record counts by area</caption>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Records</th>
                  <th scope="col">Needing attention</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {view.counters.map((row) => (
                  <tr key={row.area}>
                    <td>{SHELL_AREA_LABELS[row.area]}</td>
                    <td>{row.total}</td>
                    <td>{row.attention}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          onNavigate({
                            area: row.area,
                            view: SHELL_AREA_VIEWS[row.area][0]!,
                          })
                        }
                      >
                        Open area
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
