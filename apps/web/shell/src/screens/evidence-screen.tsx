/**
 * @fleetos/web-shell — the Evidence & Audit screens (W091 [TL]).
 *
 * The first-class Evidence & Audit area: the index (every consequential
 * record that has a trail) and the trail detail (source observation ->
 * ... -> verification, exactly as the append-only audit log recorded
 * it, with the observable chain-verification state).
 *
 * Presentational and fully controlled over the evidence view-models
 * (evidence-view.ts). No business truth in React state; evidence refs
 * are OPAQUE (rendered verbatim, never interpreted).
 */
import type { JSX } from "react";
import type { ShellRoute } from "../navigation";
import type { EvidenceIndexRow } from "../evidence-view";
import type { ShellEvidenceTrail } from "../seams";
import { SHELL_AREA_LABELS } from "../navigation";
import { Badge, Button, Card, EmptyState, StatusIndicator, Timeline } from "../ui/primitives";
import { chainConsoleStatus } from "../ui/status";

export interface EvidenceIndexScreenProps {
  readonly rows: readonly EvidenceIndexRow[];
  readonly onOpenTrail: (row: EvidenceIndexRow) => void;
}

export function EvidenceIndexScreen({ rows, onOpenTrail }: EvidenceIndexScreenProps): JSX.Element {
  return (
    <div className="fos-screen">
      <Card
        title="Evidence trail index"
        subtitle="Every consequential record with an audit trail — approvals, recoveries, enrollments, commerce decisions."
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No audit records yet"
            hint="Consequential acts land on the evidence trail the moment the domain records them — nothing is retrospectively synthesized."
          />
        ) : (
          <div className="fos-table-wrap">
            <table className="fos-table">
              <caption>Evidence trail index by area</caption>
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Area</th>
                  <th scope="col">Steps</th>
                  <th scope="col">First recorded</th>
                  <th scope="col">Last recorded</th>
                  <th scope="col">Chain</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.area}-${row.subjectId}`}>
                    <td>
                      <button
                        type="button"
                        className="fos-linklike"
                        onClick={() => onOpenTrail(row)}
                      >
                        {row.subjectTitle}
                      </button>
                      <div className="fos-mono">{row.subjectId}</div>
                    </td>
                    <td>{SHELL_AREA_LABELS[row.area]}</td>
                    <td>{row.stepCount}</td>
                    <td>{row.firstAt}</td>
                    <td>{row.lastAt}</td>
                    <td>
                      <StatusIndicator status={chainConsoleStatus(row.chainState)} />
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => onOpenTrail(row)}>
                        Evidence trail
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

export interface EvidenceTrailScreenProps {
  readonly trail: ShellEvidenceTrail;
  readonly onNavigate: (route: ShellRoute) => void;
}

export function EvidenceTrailScreen({ trail, onNavigate }: EvidenceTrailScreenProps): JSX.Element {
  return (
    <div className="fos-screen">
      <Card
        title={trail.subjectTitle}
        subtitle={`The evidence trail for this record — ${trail.steps.length} consequential stage${trail.steps.length === 1 ? "" : "s"}, exactly as recorded.`}
        actions={
          <Button variant="secondary" onClick={() => onNavigate({ area: trail.area, view: "list" })}>
            Back to {SHELL_AREA_LABELS[trail.area]}
          </Button>
        }
      >
        <p className="fos-row">
          <span className="fos-mono">{trail.subjectId}</span>
          <StatusIndicator status={chainConsoleStatus(trail.chainState)} />
          {trail.chainState === "tamper_detected" && (
            <Badge status="failed">chain verification failed</Badge>
          )}
        </p>
        <Timeline
          entries={trail.steps.map((step) => ({
            label: step.stage,
            detail: `${step.actor} · ${step.at} · outcome: ${step.outcome}`,
          }))}
        />
      </Card>

      <Card title="Referenced evidence" subtitle="Opaque content-addressed references, verbatim — never interpreted by the console.">
        {trail.steps.every((step) => step.evidenceRefs.length === 0) ? (
          <EmptyState
            title="No evidence refs on this trail"
            hint="Stages that cite evidence carry their refs here, exactly as the domain recorded them."
          />
        ) : (
          <ul className="fos-stack">
            {trail.steps.flatMap((step) =>
              step.evidenceRefs.map((ref) => (
                <li key={`${step.recordId}-${ref}`} className="fos-row">
                  <Badge>{step.stage}</Badge>
                  <span className="fos-mono">{ref}</span>
                </li>
              )),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
