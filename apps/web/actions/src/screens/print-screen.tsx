/**
 * @fleetos/web-actions — D2 rendered: the PrintScreen (W090B).
 *
 * The React component layer over the EXISTING pure print view-model
 * (`print-routing-view.ts` — logic untouched): the discoverable
 * END-TO-END PRINT ORCHESTRATION JOURNEY (the UX simulation's 🟡 gap) —
 *
 *   print intent -> policy decision (when linked) -> printer
 *   resolution -> queue -> job state -> verification
 *
 * Job state uses the Running/Succeeded/Failed semantics (ROUTED/
 * QUEUED -> Running; COMPLETED -> Succeeded; REFUSED -> Failed). A
 * ROUTING REFUSAL is visible and actionable: the machine-stable
 * `unsupported_feature:*` reasons render verbatim, NO fallback printer
 * is ever suggested, and the per-printer DECLARED capability
 * disclosure shows which printers satisfy the required features (an
 * unsupported capability stays visibly unsupported — never emulated).
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type { PrintRoutingPresentationView } from "../print-routing-view";
import { ALL_SURFACE_PRINTER_CAPABILITIES } from "../print-routing-view";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Card,
  DefinitionList,
  PhasePresentation,
  StatusIndicator,
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import { decisionConsoleStatus, printConsoleStatus } from "../ui/status";
import type { ActionsRoleLensView } from "../role-lens";
import { RoleLensSection } from "./role-lens-section";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The per-printer queue state (presentational — the binding site composes). */
export interface PrintQueueStateView {
  /** The printer whose queue this is. */
  readonly printerId: string;
  /** The queue depth. */
  readonly depth: number;
  /** The queued job ids (FIFO order). */
  readonly queuedJobIds: readonly string[];
  /** ISO 8601 queue-update timestamp. */
  readonly updatedAt: string;
}

/** The print verification record (presentational). */
export interface PrintVerificationView {
  /** ISO 8601 verification instant. */
  readonly verifiedAt: string;
  /** The machine-stable verification summary. */
  readonly summary: string;
}

/** The composite print journey (presentational composition). */
export interface PrintJourneyData {
  /** The print routing presentation (the job + printer disclosures). */
  readonly job: PrintRoutingPresentationView;
  /** The resolved printer's queue state, when supplied. */
  readonly queue: PrintQueueStateView | null;
  /** The verification record, when verification completed. */
  readonly verification: PrintVerificationView | null;
}

export interface PrintScreenProps {
  /** The composite journey phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<PrintJourneyData>;
  /**
   * W100B: the active role lens (optional — absent renders exactly the
   * W090B screen). Shapes ONLY the banner emphasis.
   */
  readonly roleLens?: ActionsRoleLensView | null;
}

// ---------------------------------------------------------------------------
// The journey timeline (pure derivation over the composite data)
// ---------------------------------------------------------------------------

function journeyTimeline(data: PrintJourneyData): readonly TimelineItem[] {
  const { job, queue, verification } = data;
  const refused = job.refused;
  const completed = job.status === "COMPLETED";
  const requiredFeatures = ALL_SURFACE_PRINTER_CAPABILITIES.filter(
    (feature) => job.requiredFeatures[feature] === true,
  );
  return [
    {
      id: "intent",
      label: "Print intent declared",
      detail: `Document ${job.documentRef}${job.targetUserId !== undefined ? ` for ${job.targetUserId}` : ""} at ${job.createdAt}`,
      state: "done",
    },
    {
      id: "features",
      label: "Required features resolved",
      detail:
        requiredFeatures.length === 0
          ? "No special printer features required"
          : requiredFeatures.join(", "),
      state: "done",
    },
    {
      id: "policy",
      label: "Policy decision",
      detail:
        job.linkedDecision === null
          ? "No print-policy decision is linked"
          : `${job.linkedDecision.decision} at ${job.linkedDecision.decidedAt}`,
      state: job.linkedDecision === null ? "pending" : job.linkedDecision.decision === "BLOCK" ? "blocked" : "done",
    },
    {
      id: "routing",
      label: "Printer resolution",
      detail: refused
        ? `REFUSED — ${job.routingReasons.join(", ")}`
        : `Routed to ${job.printerId}${job.queuePosition !== undefined ? ` (queue position ${job.queuePosition})` : ""}`,
      state: refused ? "blocked" : "done",
    },
    {
      id: "queue",
      label: "Queue",
      detail:
        refused
          ? "Not applicable — the routing was refused"
          : queue !== null
            ? `Queue depth ${queue.depth} at ${queue.updatedAt}`
            : job.status === "QUEUED"
              ? "Queued at the printer"
              : "Waiting for the printer queue",
      state: refused ? "pending" : job.status === "QUEUED" || queue !== null ? "done" : "current",
    },
    {
      id: "job-state",
      label: "Job state",
      detail: `${job.status}${job.transitionedAt !== undefined ? ` at ${job.transitionedAt}` : ""}`,
      state: refused ? "blocked" : completed ? "done" : "current",
    },
    {
      id: "verification",
      label: "Verification",
      detail:
        verification === null
          ? completed
            ? "Awaiting the completion evidence"
            : "Not reached"
          : `${verification.summary} at ${verification.verifiedAt}`,
      state: verification === null ? (completed ? "current" : "pending") : "done",
    },
  ];
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The PrintScreen: the end-to-end print orchestration journey — the
 * intent, the policy gate, the printer resolution with the DECLARED
 * capability disclosures, the queue, the job state (Running /
 * Succeeded / Failed semantics) and the verification. Routing
 * refusals are visible and actionable, never hidden.
 */
export function PrintScreen(props: PrintScreenProps): JSX.Element {
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Fleet Actions" }, { label: "Print", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Print orchestration</h1>
          <p className="fos-screen-subtitle">
            The print journey — from the intent to the verified job outcome, with the routing
            refusals visible and never emulated.
          </p>
        </div>
      </header>
      {props.roleLens !== null && props.roleLens !== undefined && (
        <RoleLensSection
          lens={props.roleLens}
          emphasis={[
            { label: "Print", value: props.roleLens.printEmphasis },
            { label: "Evidence", value: props.roleLens.evidenceEmphasis },
          ]}
        />
      )}
      {props.phase.kind === "ready" ? (
        <PrintBody data={props.phase.view} />
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the print job" />
      )}
    </div>
  );
}

function PrintBody(props: { readonly data: PrintJourneyData }): JSX.Element {
  const { job, queue, verification } = props.data;
  const requiredFeatures = ALL_SURFACE_PRINTER_CAPABILITIES.filter(
    (feature) => job.requiredFeatures[feature] === true,
  );
  return (
    <>
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Job", value: <span className="fos-mono">{job.jobId}</span> },
            { term: "Document", value: <span className="fos-mono">{job.documentRef}</span> },
            {
              term: "Target user",
              value:
                job.targetUserId !== undefined ? (
                  <span className="fos-mono">{job.targetUserId}</span>
                ) : (
                  <span className="fos-meta">unspecified</span>
                ),
            },
            {
              term: "Required features",
              value: requiredFeatures.length === 0 ? "none" : requiredFeatures.join(", "),
            },
            { term: "Declared at", value: <span className="fos-mono">{job.createdAt}</span> },
            { term: "Correlation", value: <span className="fos-mono">{job.correlationId}</span> },
          ]}
        />
      </Card>
      <Card title="Current state">
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
          <StatusIndicator status={printConsoleStatus(job.status)} /> <Badge>{job.status}</Badge>
          {job.linkedDecision !== null && (
            <>
              {" · "}
              <StatusIndicator status={decisionConsoleStatus(job.linkedDecision.decision)} />{" "}
              <Badge>{job.linkedDecision.decision}</Badge>
            </>
          )}
        </p>
        {job.refused ? (
          <div className="fos-alert" role="alert" style={{ marginTop: "0.5rem" }}>
            <p className="fos-alert__title">Routing refused</p>
            <p className="fos-alert__message">
              The router refused this job — the required features are not satisfied by any
              available printer. The refusal reasons are machine-stable; no fallback printer is
              suggested and the routing is never re-executed here.
            </p>
            <ul>
              {job.routingReasons.map((reason) => (
                <li key={reason}>
                  <span className="fos-mono">{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="fos-meta" style={{ margin: 0 }}>
            Resolved printer: <span className="fos-mono">{job.printerId ?? "—"}</span>
            {job.queuePosition !== undefined && ` · queue position ${job.queuePosition}`}
            {queue !== null && ` · queue depth ${queue.depth}`}
          </p>
        )}
      </Card>
      <Card title="Why it matters">
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          Printed documents can carry confidential material: the print policy decides whether the
          job may proceed, the router selects only printers whose DECLARED capabilities satisfy the
          required features, and the job's outcome is verifiable with evidence. An unsupported
          capability stays visibly unsupported — never emulated.
        </p>
      </Card>
      {job.printerDisclosures.length > 0 && (
        <Card
          title="Printer capability disclosures"
          subtitle="DECLARED flags only — the observable comparison, never a guess"
        >
          <div className="fos-table-wrap">
            <table className="fos-table">
              <caption>Available printers, ordered by printer id</caption>
              <thead>
                <tr>
                  <th scope="col">Printer</th>
                  <th scope="col">Location</th>
                  <th scope="col">Approved</th>
                  <th scope="col">Declared capabilities</th>
                  <th scope="col">Satisfies required features</th>
                </tr>
              </thead>
              <tbody>
                {job.printerDisclosures.map((disclosure) => {
                  const declared = ALL_SURFACE_PRINTER_CAPABILITIES.filter(
                    (feature) => disclosure.capabilities[feature] === true,
                  );
                  return (
                    <tr key={disclosure.printerId} data-testid={`printer-${disclosure.printerId}`}>
                      <td>
                        <span className="fos-mono">{disclosure.printerId}</span>
                      </td>
                      <td>{disclosure.location ?? "—"}</td>
                      <td>
                        {disclosure.approved === true ? (
                          <Badge>approved</Badge>
                        ) : (
                          <span className="fos-meta">not on the approved list</span>
                        )}
                      </td>
                      <td>
                        {declared.length === 0 ? (
                          <span className="fos-meta">none declared</span>
                        ) : (
                          <span className="fos-meta">{declared.join(", ")}</span>
                        )}
                      </td>
                      <td>
                        {disclosure.satisfiesRequiredFeatures ? (
                          <StatusIndicator status="healthy" />
                        ) : (
                          <StatusIndicator status="blocked" label="Does not satisfy" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title="Evidence + verification">
        <p className="fos-meta" style={{ margin: "0 0 0.5rem" }}>
          The job cites {job.evidence.length} artifact(s) · content digest{" "}
          <span className="fos-mono">{job.contentDigest}</span>
        </p>
        <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
          {job.evidence.map((ref) => (
            <li key={ref.key}>
              <span className="fos-mono">{ref.key}</span>{" "}
              <span className="fos-meta">
                ({ref.hashAlgorithm} · {ref.sizeBytes} bytes)
              </span>
            </li>
          ))}
        </ul>
        {verification !== null ? (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            Verification result: {verification.summary} at{" "}
            <span className="fos-mono">{verification.verifiedAt}</span>.
          </p>
        ) : (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            Not yet verified — verification evidence appears once the job completes.
          </p>
        )}
      </Card>
      <Card title="Journey">
        <Timeline items={journeyTimeline(props.data)} ariaLabel="Print orchestration journey" />
      </Card>
    </>
  );
}

