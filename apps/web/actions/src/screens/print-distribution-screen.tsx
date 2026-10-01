/**
 * @fleetos/web-actions — W100B rendered: the PrintDistributionScreen.
 *
 * The W100B product sentence rendered end-to-end:
 *
 *   "selected people + document -> each person's approved printer
 *    receives the job."
 *
 * The role-shaped distribution view (from
 * `buildRoleShapedPrintDistributionView`, composed over the REAL W100B
 * domain plan `planPrintDistribution` at the binding site) rendered as
 * the per-person distribution journey:
 *
 *   document -> selected people -> per-person approved printer (or the
 *   VISIBLE refusal with its machine-stable reasons + the
 *   printer-approval escalation path).
 *
 * Role emphasis changes ONLY the banner/lead (the lens, passed as its
 * own fully-controlled prop — the composition site supplies the REAL
 * lens view); the per-person entries, refusal reasons and escalation
 * paths are identical for every lens (authority echo + affordance
 * availability identical — proven by test). A REFUSED entry is never
 * emulated: no fallback printer is suggested, and the
 * capable-but-unapproved printers are named ONLY as the escalation
 * request path.
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type { RoleShapedPrintDistributionView } from "../print-distribution-view";
import type { ActionsRoleLensView } from "../role-lens";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  StatusIndicator,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { printConsoleStatus } from "../ui/status";
import { RoleLensSection } from "./role-lens-section";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PrintDistributionScreenProps {
  /** The role-shaped distribution view phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<RoleShapedPrintDistributionView>;
  /**
   * The active role lens (the REAL lens view from
   * `buildActionsRoleLens`, passed by the composition site). Optional —
   * absent renders the screen without the banner (the entries are
   * unchanged either way).
   */
  readonly roleLens?: ActionsRoleLensView | null;
}

// ---------------------------------------------------------------------------
// One per-person entry
// ---------------------------------------------------------------------------

function DistributionEntryCard(props: {
  readonly userId: string;
  readonly jobId: string;
  readonly status: RoleShapedPrintDistributionView["entries"][number]["status"];
  readonly printerId: string | null;
  readonly queuePosition: number | null;
  readonly routingReasons: readonly string[];
  readonly refused: boolean;
  readonly evidenceCount: number;
  readonly escalation: RoleShapedPrintDistributionView["entries"][number]["escalation"];
  readonly spotlight: boolean;
}): JSX.Element {
  const { userId, jobId, status, printerId, queuePosition, routingReasons, refused, evidenceCount, escalation } =
    props;
  return (
    <Card
      title={props.spotlight ? `${userId} — leads in this lens` : userId}
      subtitle={`Job ${jobId}`}
    >
      <DefinitionList
        entries={[
          {
            term: "Status",
            value: (
              <span className="fos-row">
                <StatusIndicator status={printConsoleStatus(status)} />
                <Badge>{status}</Badge>
              </span>
            ),
          },
          {
            term: "Approved printer",
            value:
              printerId === null ? (
                <span className="fos-meta">none (routing refused — never emulated)</span>
              ) : (
                <span className="fos-mono">{printerId}</span>
              ),
          },
          {
            term: "Queue position",
            value: queuePosition === null ? "—" : String(queuePosition),
          },
          {
            term: "Evidence",
            value: `${evidenceCount} opaque artifact(s)`,
          },
        ]}
      />
      {refused && (
        <>
          <p className="fos-card-subtitle" style={{ margin: "0.75rem 0 0.35rem" }}>
            Routing reasons (machine-stable, verbatim)
          </p>
          <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
            {routingReasons.map((reason) => (
              <li key={reason}>
                <span className="fos-mono">{reason}</span>
              </li>
            ))}
          </ul>
          {escalation !== null && (
            <p className="fos-meta" style={{ margin: "0.5rem 0 0" }} data-testid={`print-escalation-${userId}`}>
              Escalation path: {escalation.action} for printer(s){" "}
              <span className="fos-mono">{escalation.printerIds.join(", ")}</span> — from your{" "}
              {escalation.requestLabel}. Capable-but-unapproved printers are named as the request
              path ONLY — they never receive the job (grantsAnything:{" "}
              {String(escalation.grantsNothing)}).
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The PrintDistributionScreen: the people + document -> per-person
 * approved-printer journey, role-shaped by the lens. Fully controlled;
 * the entries never change with the lens (only the lead does).
 */
export function PrintDistributionScreen(props: PrintDistributionScreenProps): JSX.Element {
  const view = props.phase.kind === "ready" ? props.phase.view : null;
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Fleet Actions" }, { label: "Print distribution", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Print distribution</h1>
          <p className="fos-screen-subtitle">
            {view !== null
              ? view.lead.copy
              : "Selected people + one document — each person's approved printer receives the job."}
          </p>
        </div>
      </header>
      {view !== null && (
        <>
          {props.roleLens !== null && props.roleLens !== undefined && (
            <RoleLensSection
              lens={props.roleLens}
              emphasis={[
                { label: "Print", value: props.roleLens.printEmphasis },
                { label: "Evidence", value: props.roleLens.evidenceEmphasis },
              ]}
            />
          )}
          <Card
            title={`Document ${view.documentRef}`}
            subtitle="The distribution at a glance (identical for every lens)"
          >
            <DefinitionList
              entries={[
                { term: "People selected", value: String(view.lead.personCount) },
                { term: "Jobs routed to an approved printer", value: String(view.lead.routedCount) },
                { term: "Jobs refused (visible, never emulated)", value: String(view.lead.refusedCount) },
                {
                  term: "Plan-distribution capability",
                  value: view.distributionAffordance.available
                    ? "available to this session (authority-derived)"
                    : `restricted — the effective authority lacks ${view.distributionAffordance.capability} (reason ${view.distributionAffordance.restricted?.reason ?? "missing_permission"}); ${
                        view.distributionAffordance.restricted !== null
                          ? `${view.distributionAffordance.restricted.escalation.action} — ${view.distributionAffordance.restricted.escalation.requestLabel}`
                          : "request the capability"
                      }. This explanation grants nothing.`,
                },
              ]}
            />
            {view.lead.spotlightUserIds.length > 0 && (
              <p className="fos-meta" style={{ margin: "0.5rem 0 0" }} data-testid="distribution-spotlight">
                Leading entries in this lens: {view.lead.spotlightUserIds.join(", ")}.
              </p>
            )}
            {view.lead.evidenceFirst && (
              <p className="fos-meta" style={{ margin: "0.35rem 0 0" }} data-testid="distribution-evidence-first">
                Evidence-first: every job links the artifacts that support its routing.
              </p>
            )}
          </Card>
          {view.entries.length === 0 ? (
            <EmptyState
              title="No people selected"
              hint="A distribution needs at least one selected person — an empty selection refuses rather than distributing nothing."
            />
          ) : (
            <div className="fos-stack">
              {view.entries.map((entry) => (
                <DistributionEntryCard
                  key={entry.userId}
                  userId={entry.userId}
                  jobId={entry.jobId}
                  status={entry.status}
                  printerId={entry.printerId}
                  queuePosition={entry.queuePosition}
                  routingReasons={entry.routingReasons}
                  refused={entry.refused}
                  evidenceCount={entry.evidenceCount}
                  escalation={entry.escalation}
                  spotlight={view.lead.spotlightUserIds.includes(entry.userId)}
                />
              ))}
            </div>
          )}
        </>
      )}
      {view === null && (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the print distribution" />
      )}
    </div>
  );
}
