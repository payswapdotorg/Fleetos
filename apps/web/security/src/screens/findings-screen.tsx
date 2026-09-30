/**
 * @fleetos/web-security — D1 rendered: the FindingsScreen (W090B).
 *
 * The React component layer over the EXISTING pure findings view-model
 * (`findings-view.ts` — logic untouched): the Security Doctor's
 * findings list with severity + SEMANTIC status (never color-alone),
 * facet counts per severity (controlled filter chips), and the record
 * pattern in the detail sheet:
 *
 *   summary -> current state -> why it matters -> recommended action
 *           -> evidence -> history
 *
 * Remediations render as PROPOSALS (the frozen intent kind + the draft
 * payload + the executionPath: "none" disclosure — LOCK 16: no
 * direct-execution path exists on this surface). Evidence refs render
 * OPAQUE (observation ids + kinds, verbatim — never interpreted).
 * Findings are INTERPRETATIONS (LOCK 3): the version lineage with
 * supersedes links stays visible.
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 * Presentational only: props in, JSX out — the severity filter, the
 * open finding, and every user intent are controlled props/callbacks.
 */

import type { JSX } from "react";
import type { FindingsListItemView, FindingsListView } from "../findings-view";
import { ALL_SURFACE_SEVERITIES } from "../findings-view";
import type { FindingsLensLead, RemediationAffordanceView } from "../findings-role-view";
import type { SecurityRoleLensView } from "../role-lens";
import type { SurfaceSeverity } from "../surface-contracts";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  StatusIndicator,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { severityConsoleStatus } from "../ui/status";
import { RoleLensSection } from "./role-lens-section";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The severity facet filter (controlled — never internal state). */
export type FindingsSeverityFilter = SurfaceSeverity | "all";

export interface FindingsScreenProps {
  /** The findings list view phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<FindingsListView>;
  /** The active severity filter (controlled). */
  readonly severityFilter: FindingsSeverityFilter;
  readonly onSeverityFilterChange: (filter: FindingsSeverityFilter) => void;
  /** The finding whose detail sheet is open (controlled; null = closed). */
  readonly openFindingId: string | null;
  readonly onOpenFinding: (findingId: string) => void;
  readonly onCloseFinding: () => void;
  /** The intent to walk the remediation journey for a finding (opens Security Doctor). */
  readonly onRemediate: (finding: FindingsListItemView) => void;
  /**
   * W100B: the active role lens (optional — absent renders exactly the
   * W090B screen). The lens shapes ONLY the banner emphasis; the
   * records, ordering and affordances are unchanged.
   */
  readonly roleLens?: SecurityRoleLensView | null;
  /**
   * W100B: the role-shaped lead (from `buildRoleShapedFindingsView`) —
   * the emphasis copy + spotlights + the authority-derived remediation
   * affordance. Optional; absent renders the plain W090B header.
   */
  readonly roleLead?: FindingsLensLead | null;
  /**
   * W100B: the remediation affordance (authority-derived availability;
   * the restricted explanation renders when unavailable).
   */
  readonly remediationAffordance?: RemediationAffordanceView | null;
}

// ---------------------------------------------------------------------------
// The record-pattern detail sheet
// ---------------------------------------------------------------------------

function FindingSheet(props: {
  readonly finding: FindingsListItemView;
  readonly onClose: () => void;
  readonly onRemediate: (finding: FindingsListItemView) => void;
}): JSX.Element {
  const { finding } = props;
  const status = severityConsoleStatus(finding.severity);
  return (
    <div className="fos-scrim fos-scrim--end">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Security finding ${finding.title}`}
        tabIndex={-1}
        className="fos-sheet"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <div className="fos-sheet__header">
          <h2 className="fos-sheet__title">Security finding</h2>
          <button
            type="button"
            className="fos-btn fos-btn--ghost"
            aria-label="Close finding detail"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <Card title="Summary">
          <DefinitionList
            entries={[
              { term: "Finding", value: <span className="fos-mono">{finding.title}</span> },
              { term: "Code", value: <span className="fos-mono">{finding.code}</span> },
              { term: "Device", value: <span className="fos-mono">{finding.deviceId}</span> },
              { term: "Classification", value: <Badge>{finding.classification}</Badge> },
              {
                term: "Interpretation",
                value: `v${finding.interpretationVersion}${finding.supersedes !== undefined ? ` (supersedes ${finding.supersedes})` : ""}`,
              },
              { term: "Detected at", value: <span className="fos-mono">{finding.detectedAt}</span> },
            ]}
          />
        </Card>
        <Card title="Current state">
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            <StatusIndicator status={status} /> <Badge>{finding.severity}</Badge>
          </p>
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            The finding is an interpretation (version {finding.interpretationVersion}
            {finding.supersedes !== undefined ? `, superseding record ${finding.supersedes}` : ""}) —
            not a fact. It cites {finding.evidenceCount} immutable observation(s).
          </p>
        </Card>
        <Card title="Why it matters">
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            {finding.severity === "CRITICAL" || finding.severity === "HIGH"
              ? `A ${finding.severity.toLowerCase()}-severity ${finding.classification} condition was detected on this device. Left unaddressed it exposes the fleet to concrete risk; the recommended action below is a proposal that the Contract Guardian must evaluate before anything executes.`
              : `A ${finding.severity.toLowerCase()}-severity ${finding.classification} condition was detected. It is tracked for completeness; review the evidence and decide whether a remediation is warranted.`}
          </p>
        </Card>
        <Card title="Recommended action">
          {finding.remediationProposal === null ? (
            <p className="fos-meta" style={{ margin: 0 }}>
              No remediation proposal is attached to this finding.
            </p>
          ) : (
            <>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
                <Badge>PROPOSAL</Badge>{" "}
                <span className="fos-mono">{finding.remediationProposal.intentKind}</span>
              </p>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
                {finding.remediationProposal.payload.description}
              </p>
              <p className="fos-meta" style={{ margin: 0 }}>
                No direct-execution path exists on this surface — the Contract Guardian decides
                whether any action is ever permitted.
              </p>
              <div className="fos-row" style={{ marginTop: "0.75rem" }}>
                <Button
                  variant="primary"
                  onClick={(): void => props.onRemediate(finding)}
                  ariaLabel={`Walk the remediation journey for ${finding.title}`}
                >
                  Walk the remediation journey
                </Button>
              </div>
            </>
          )}
        </Card>
        <Card title="Evidence" subtitle="Immutable observations (opaque references)">
          {finding.evidence.length === 0 ? (
            <p className="fos-meta" style={{ margin: 0 }}>No evidence refs on this record.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
              {finding.evidence.map((ref) => (
                <li key={ref.observationId}>
                  <span className="fos-mono">{ref.observationId}</span>{" "}
                  <span className="fos-meta">({ref.kind})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            Observed at <span className="fos-mono">{finding.observedAt}</span>
          </p>
        </Card>
        <Card title="History" subtitle="The interpretation ledger's version discipline">
          <p style={{ margin: 0, fontSize: "0.8125rem" }}>
            This is interpretation version {finding.interpretationVersion} of finding{" "}
            <span className="fos-mono">{finding.findingId}</span> (record{" "}
            <span className="fos-mono">{finding.recordId}</span>
            {finding.supersedes !== undefined
              ? `, superseding record ${finding.supersedes}`
              : ""}
            ). Re-assessments append new versions — the prior records are never rewritten.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The FindingsScreen: the Security Doctor's findings area. Fully
 * controlled (filter + open finding are props).
 */
export function FindingsScreen(props: FindingsScreenProps): JSX.Element {
  const view = props.phase.kind === "ready" ? props.phase.view : null;
  const openFinding =
    view !== null && props.openFindingId !== null
      ? view.items.find(
          (item) => item.findingId === props.openFindingId || item.recordId === props.openFindingId,
        )
      : undefined;
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "FleetOS" }, { label: "Security" }, { label: "Findings", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Security findings</h1>
          <p className="fos-screen-subtitle">
            {props.roleLead !== null && props.roleLead !== undefined
              ? props.roleLead.copy
              : "The Security Doctor's findings — versioned interpretations of observed device posture, ordered most severe first."}
          </p>
        </div>
      </header>
      {props.roleLens !== null && props.roleLens !== undefined && (
        <RoleLensSection
          lens={props.roleLens}
          emphasis={[
            { label: "Findings", value: props.roleLens.findingsEmphasis },
            { label: "Evidence", value: props.roleLens.evidenceEmphasis },
          ]}
        />
      )}
      {props.roleLead !== null && props.roleLead !== undefined && (
        <Card title="What this lens leads with" subtitle="Emphasis only — the records never change">
          <DefinitionList
            entries={[
              { term: "Critical", value: String(props.roleLead.criticalCount) },
              { term: "High", value: String(props.roleLead.highCount) },
              { term: "Devices affected", value: String(props.roleLead.deviceCount) },
              { term: "Actionable remediations", value: String(props.roleLead.remediationProposalCount) },
            ]}
          />
          {props.roleLead.spotlightFindingIds.length > 0 && (
            <p className="fos-meta" style={{ margin: "0.5rem 0 0" }} data-testid="findings-spotlight">
              Leading findings: {props.roleLead.spotlightFindingIds.join(", ")}
            </p>
          )}
          {props.roleLead.evidenceFirst && (
            <p className="fos-meta" style={{ margin: "0.35rem 0 0" }} data-testid="findings-evidence-first">
              Evidence-first: every finding below links the immutable observations that support it.
            </p>
          )}
        </Card>
      )}
      {props.remediationAffordance !== null && props.remediationAffordance !== undefined && (
        <Card
          title="Remediation walkthrough"
          subtitle={
            props.remediationAffordance.available
              ? "Available to this session (authority-derived)"
              : "Restricted in this session (authority-derived)"
          }
        >
          {props.remediationAffordance.available ? (
            <p className="fos-meta" style={{ margin: 0 }} data-testid="remediation-affordance-available">
              The effective authority includes{" "}
              <span className="fos-mono">{props.remediationAffordance.capability}</span>: the gated
              remediation journey is offered per finding (the Contract Guardian still decides every
              step — never one-click).
            </p>
          ) : (
            <p className="fos-meta" style={{ margin: 0 }} data-testid="remediation-affordance-restricted">
              Reason <span className="fos-mono">{props.remediationAffordance.restricted?.reason ?? "missing_permission"}</span>{" "}
              — the effective authority lacks{" "}
              <span className="fos-mono">{props.remediationAffordance.capability}</span>.{" "}
              {props.remediationAffordance.restricted !== null
                ? `${props.remediationAffordance.restricted.escalation.action} — ${props.remediationAffordance.restricted.escalation.requestLabel}.`
                : "Request the capability from your Fleet Administrator."}{" "}
              This explanation grants nothing.
            </p>
          )}
        </Card>
      )}
      {view !== null ? (
        <>
          <div className="fos-chipbar" role="group" aria-label="Filter findings by severity">
            <button
              type="button"
              className="fos-chip"
              aria-pressed={props.severityFilter === "all"}
              onClick={(): void => props.onSeverityFilterChange("all")}
            >
              All ({view.total})
            </button>
            {ALL_SURFACE_SEVERITIES.map((severity) => (
              <button
                key={severity}
                type="button"
                className="fos-chip"
                aria-pressed={props.severityFilter === severity}
                onClick={(): void => props.onSeverityFilterChange(severity)}
              >
                {severity} ({view.severityCounts[severity]})
              </button>
            ))}
          </div>
          {view.items.length === 0 ? (
            <EmptyState
              title="No findings recorded"
              hint="Findings appear when the Security Doctor assesses device posture against its rules. A finding-free fleet still shows its assessments in the device records."
            />
          ) : (
            <div className="fos-table-wrap">
              <table className="fos-table">
                <caption>Security findings, most severe first (machine-stable order)</caption>
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Finding</th>
                    <th scope="col">Device</th>
                    <th scope="col">Classification</th>
                    <th scope="col">Interpretation</th>
                    <th scope="col">Detected</th>
                    <th scope="col">Evidence</th>
                    <th scope="col">Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {view.items
                    .filter(
                      (item) =>
                        props.severityFilter === "all" || item.severity === props.severityFilter,
                    )
                    .map((item) => (
                      <tr key={item.recordId} data-testid={`finding-${item.findingId}`}>
                        <td>
                          <StatusIndicator status={severityConsoleStatus(item.severity)} />
                          <br />
                          <Badge>{item.severity}</Badge>
                        </td>
                        <td>
                          {item.title}
                          <br />
                          <span className="fos-mono fos-meta">{item.code}</span>
                        </td>
                        <td>
                          <span className="fos-mono">{item.deviceId}</span>
                        </td>
                        <td>
                          <Badge>{item.classification}</Badge>
                        </td>
                        <td>
                          v{item.interpretationVersion}
                          {item.supersedes !== undefined && (
                            <span className="fos-meta" style={{ display: "block" }}>
                              supersedes {item.supersedes}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="fos-mono fos-meta">{item.detectedAt}</span>
                        </td>
                        <td>
                          <span className="fos-meta">{item.evidenceCount} observation(s)</span>
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={(): void => props.onOpenFinding(item.findingId)}
                            ariaLabel={`Inspect finding ${item.title}`}
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading security findings" />
      )}
      {openFinding !== undefined && (
        <FindingSheet
          finding={openFinding}
          onClose={props.onCloseFinding}
          onRemediate={props.onRemediate}
        />
      )}
    </div>
  );
}

