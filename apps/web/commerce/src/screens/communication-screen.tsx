/**
 * @fleetos/web-commerce — D2.6 rendered: the CommunicationScreen
 * (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`communication.ts` — logic untouched): the Aurum communication
 * OUTCOME view — the outbox (the emission ledger: the six
 * provider-neutral message kinds, derived priorities, redaction
 * evidence) and the per-message DELIVERY timelines with their evidence
 * (delivery metadata visible: state, disposition, channel, recipient
 * ref, ingestion instant, attempt count, terminal flag).
 *
 * The AUTHORITY BOUNDARY holds (LOCK 10): everything here is a
 * read-only metadata-only projection — no FleetOS-truth mutation, no
 * emission, no acknowledgment. The provider's own message handle is
 * NEVER surfaced.
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The open message id
 * is a prop; no business truth in React state.
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
  deliveryStateConsoleStatus,
} from "../ui/status";
import type {
  CommunicationSummaryView,
  DeliveryTimelineView,
  OutboxListView,
} from "../communication";
import { CommerceJourneyRail } from "./commerce-shared";
import type { CommerceJourneyRailStage } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The composed communication data (built by the shell from the builders). */
export interface CommunicationScreenData {
  readonly outbox: OutboxListView;
  readonly summary: CommunicationSummaryView;
  /** The per-message delivery timelines (the outcome evidence). */
  readonly deliveries: readonly DeliveryTimelineView[];
}

export interface CommunicationScreenProps {
  readonly phase: ScreenPhase<CommunicationScreenData>;
  /** The open message (the controlled delivery-outcome Sheet). */
  readonly openMessageId: string | null;
  readonly onOpenMessage: (messageId: string | null) => void;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The channel summary + the outbox table
// ---------------------------------------------------------------------------

function SummaryCard({
  summary,
}: {
  readonly summary: CommunicationSummaryView;
}): JSX.Element {
  const kindEntries = Object.entries(summary.emittedByKind);
  const stateEntries = Object.entries(summary.deliveryByState);
  return (
    <Card
      title="Channel summary"
      subtitle="The provider-neutral kinds and the delivery metadata — read-only counts."
    >
      <DefinitionList
        entries={[
          {
            term: "Emitted messages",
            value: `${String(summary.emittedTotal)} (${kindEntries
              .map(([kind, count]) => `${kind}: ${String(count)}`)
              .join(" · ")})`,
          },
          {
            term: "Delivery records",
            value: `${String(summary.deliveryRecordsTotal)} (${stateEntries
              .map(([state, count]) => `${state}: ${String(count)}`)
              .join(" · ") || "none"})`,
          },
          {
            term: "Dispositions",
            value:
              Object.entries(summary.deliveryByDisposition)
                .map(([disposition, count]) => `${disposition}: ${String(count)}`)
                .join(" · ") || "none",
          },
        ]}
      />
    </Card>
  );
}

function OutboxTable({
  outbox,
  onOpenMessage,
}: {
  readonly outbox: OutboxListView;
  readonly onOpenMessage: (messageId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Communication outbox — {outbox.total} emitted, sequence order</caption>
        <thead>
          <tr>
            <th scope="col">Message</th>
            <th scope="col">Kind</th>
            <th scope="col">Recipient</th>
            <th scope="col">Priority</th>
            <th scope="col">Emitted</th>
          </tr>
        </thead>
        <tbody>
          {outbox.rows.map((row) => (
            <tr key={row.messageId} data-message-id={row.messageId}>
              <td>
                <button
                  type="button"
                  className="fos-linklike"
                  aria-label={`Open delivery outcome for ${row.title} (${row.messageId})`}
                  onClick={(): void => onOpenMessage(row.messageId)}
                >
                  {row.title}
                </button>
                <br />
                <span className="fos-mono fos-meta">{row.messageId}</span>
                <br />
                <span className="fos-meta">{row.summary}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{row.kind}</span>
                <br />
                <span className="fos-meta">subject {row.subjectRef}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{row.recipient.ref}</span>
              </td>
              <td>{row.priority}</td>
              <td>
                <span className="fos-mono fos-meta">{row.emittedAt}</span>
                <br />
                <span className="fos-meta">{String(row.fieldCount)} fields · {String(row.redactedFieldCount)} redacted</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The delivery-outcome sheet (the outcome view with evidence)
// ---------------------------------------------------------------------------

function DeliveryOutcomeSheet({
  outboxRow,
  delivery,
  onClose,
}: {
  readonly outboxRow: OutboxListView["rows"][number];
  readonly delivery: DeliveryTimelineView | null;
  readonly onClose: () => void;
}): JSX.Element {
  const latestStatus =
    delivery === null || delivery.latestState === null
      ? "unknown"
      : deliveryStateConsoleStatus(delivery.latestState);
  const items: readonly TimelineItem[] =
    delivery === null
      ? []
      : delivery.attempts.map((attempt, index) => ({
          id: `attempt-${attempt.deliveryAttempt}-${attempt.ingestedAt}`,
          label: `Attempt ${String(attempt.deliveryAttempt)} — ${attempt.state}`,
          detail: `${attempt.disposition} · ${attempt.channel} → ${attempt.recipientRef} · ingested ${attempt.ingestedAt}`,
          state: index === delivery.attempts.length - 1 ? "current" : "done",
        }));
  return (
    <Sheet
      open={true}
      title={`Delivery outcome — ${outboxRow.title}`}
      onClose={onClose}
      closeLabel="Close the delivery outcome panel"
    >
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Message", value: <span className="fos-mono">{outboxRow.messageId}</span> },
            { term: "Kind", value: outboxRow.kind },
            { term: "Recipient", value: <span className="fos-mono">{outboxRow.recipient.ref}</span> },
            { term: "Priority", value: outboxRow.priority },
            {
              term: "Content digest",
              value: <span className="fos-mono">{outboxRow.contentDigest}</span>,
            },
            {
              term: "Redaction evidence",
              value: `${String(outboxRow.redactedFieldCount)} redacted field key${outboxRow.redactedFieldCount === 1 ? "" : "s"}`,
            },
          ]}
        />
      </Card>
      <Card title="Delivery outcome" subtitle="The metadata Aurum reported — the authority boundary holds (read-only).">
        {delivery === null ? (
          <EmptyState
            title="No delivery outcome is reported yet"
            hint="Delivery records appear as the channel ingests the reported metadata."
          />
        ) : (
          <DefinitionList
            entries={[
              {
                term: "Latest state",
                value:
                  delivery.latestState === null ? (
                    <span className="fos-meta">No attempts</span>
                  ) : (
                    <StatusIndicator
                      status={latestStatus}
                      label={`${delivery.latestState} — ${CONSOLE_STATUS_LABEL[latestStatus]}`}
                    />
                  ),
              },
              {
                term: "Disposition",
                value: delivery.latestDisposition ?? "—",
              },
              {
                term: "Attempts",
                value: String(delivery.attemptCount),
              },
              {
                term: "Terminal",
                value: delivery.terminal ? "Yes — no further delivery transitions" : "No — the outcome is still in progress",
              },
            ]}
          />
        )}
      </Card>
      {delivery !== null && delivery.attempts.length > 0 && (
        <Card
          title="Delivery evidence"
          subtitle="Every attempt's metadata: state, disposition, channel, recipient ref, ingestion instant."
        >
          <Timeline items={items} ariaLabel="Delivery attempts timeline" />
        </Card>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered communication screen (outbox + delivery outcomes with evidence). */
export function CommunicationScreen(props: CommunicationScreenProps): JSX.Element {
  const { phase } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Communication">
        <Skeleton label="Loading the communication surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the communication surface" />;
  } else if (ready === null) {
    body = null;
  } else {
    body = (
      <>
        <SummaryCard summary={ready.summary} />
        {ready.outbox.rows.length === 0 ? (
          <EmptyState
            title="No messages are emitted yet"
            hint="FleetOS communicates through the provider-neutral channel: maintenance notices, incident warnings, approval requests, recovery messages, procurement updates and manager briefings appear here with their delivery outcomes."
          />
        ) : (
          <Card
            title="Outbox"
            subtitle="The emission ledger — what FleetOS asked the channel to communicate (metadata only)."
          >
            <OutboxTable
              outbox={ready.outbox}
              onOpenMessage={(messageId): void => props.onOpenMessage(messageId)}
            />
          </Card>
        )}
      </>
    );
  }

  // The controlled delivery-outcome sheet.
  let sheet: ReactNode = null;
  if (ready !== null && props.openMessageId !== null) {
    const row = ready.outbox.rows.find((candidate) => candidate.messageId === props.openMessageId);
    if (row !== undefined) {
      const delivery =
        ready.deliveries.find((candidate) => candidate.messageRef === row.messageId) ?? null;
      sheet = (
        <DeliveryOutcomeSheet
          outboxRow={row}
          delivery={delivery}
          onClose={(): void => props.onOpenMessage(null)}
        />
      );
    }
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — communication">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Commerce" }, { label: "Communication", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Communication</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.outbox.total} emitted message${phase.view.outbox.total === 1 ? "" : "s"} · ${phase.view.summary.deliveryRecordsTotal} delivery record${phase.view.summary.deliveryRecordsTotal === 1 ? "" : "s"} · outcomes with evidence`
              : "The communication channel: emitted messages and their delivery outcomes."}
          </p>
        </div>
        {props.openMessageId !== null && (
          <Button
            variant="secondary"
            onClick={(): void => props.onOpenMessage(null)}
            ariaLabel="Close the open delivery outcome"
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
