/**
 * @fleetos/web-commerce — D2.1 rendered: the ProcurementScreen
 * (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`procurement.ts`, `outcomes.ts`, `state.ts` — logic untouched): the
 * requests/quotes flow — request -> quote (e.g. an Acme quote) ->
 * approval state -> order — rendered by the EXISTING
 * `ProcurementSurfaceState` machine:
 *
 *   demands  -> the demand list (deadline-pressure statuses) + the
 *               LOCK 14 aggregated orders (per-contract identity) +
 *               the ORDER VERIFICATION (commercial reconciliation);
 *   demand   -> the demand record detail + the Vendor matching /
 *               Quotes tabs (the vendor/quote journey is first-class);
 *   matching -> the engine's ranked satisfiable matches + the
 *               REJECTED vendors with their refusal reasons (blocked
 *               procurement shows refusal reasons);
 *   quote    -> the quote record view (the record pattern) + the
 *               consequential-action authorization card (quote
 *               acceptance) + the acceptance entry evidence.
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The surface state and
 * the journey rail arrive as props; intents flow out through
 * callbacks. No business truth in React state.
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
  Skeleton,
  StatusIndicator,
  Tabs,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  deadlinePressureConsoleStatus,
  matchConsoleStatus,
  quoteConsoleStatus,
} from "../ui/status";
import type {
  AggregatedOrderRowView,
  AggregationDisplayView,
  ProcurementDemandListView,
  ProcurementDemandRowView,
  QuoteEvaluationView,
  QuoteRowView,
  VendorMatchingView,
} from "../procurement";
import type { ProcurementSurfaceEvent, ProcurementSurfaceState } from "../state";
import type { ProcurementDemandFacets } from "../seams";
import type { OrderVerificationView } from "../outcomes";
import { CommerceJourneyRail, ConsequentialActionCard } from "./commerce-shared";
import type { CommerceJourneyRailStage, ConsequentialActionDescriptor } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The demand-detail tab selection (fully controlled). */
export type ProcurementTab = "matching" | "quotes";

/** The composed procurement data (built by the shell from the builders). */
export interface ProcurementScreenData {
  readonly demands: ProcurementDemandListView;
  /** The selected demand's detail (null in the demands view). */
  readonly selected: {
    readonly demand: ProcurementDemandFacets;
    readonly matching: VendorMatchingView;
    /** The full ledger display (quote rows + acceptances + supersessions). */
    readonly quoteRows: readonly QuoteRowView[];
    /** The per-quote decision-support evaluations. */
    readonly evaluations: readonly QuoteEvaluationView[];
  } | null;
  /** The LOCK 14 aggregated orders (tenant-wide). */
  readonly orders: AggregationDisplayView;
  /** The order verification (commercial reconciliation), when present. */
  readonly verification: OrderVerificationView;
}

export interface ProcurementScreenProps {
  readonly phase: ScreenPhase<ProcurementScreenData>;
  readonly surface: ProcurementSurfaceState;
  readonly onSurfaceEvent: (event: ProcurementSurfaceEvent) => void;
  readonly tab: ProcurementTab;
  readonly onTabChange: (tab: ProcurementTab) => void;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The demands view
// ---------------------------------------------------------------------------

const DEMAND_COLUMNS =
  "Columns: demand, workload, quantity, deadline, budget, floors.";

function DeadlinePressureIndicator(pressure: string): JSX.Element {
  const status = deadlinePressureConsoleStatus(pressure as "overdue" | "critical" | "urgent" | "soon" | "comfortable");
  return <StatusIndicator status={status} label={`${pressure} — ${CONSOLE_STATUS_LABEL[status]}`} />;
}

function DemandsTable({
  view,
  onOpenDemand,
}: {
  readonly view: ProcurementDemandListView;
  readonly onOpenDemand: (demandId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Procurement requests — {view.total} open, ordered by demand id</caption>
        <thead>
          <tr>
            <th scope="col">Demand</th>
            <th scope="col">Workload</th>
            <th scope="col">Quantity</th>
            <th scope="col">Deadline</th>
            <th scope="col">Budget</th>
            <th scope="col">Floors</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row: ProcurementDemandRowView) => (
            <tr key={row.demandId} data-demand-id={row.demandId}>
              <td>
                <button
                  type="button"
                  className="fos-linklike"
                  aria-label={`Open demand ${row.description} (${row.demandId})`}
                  onClick={(): void => onOpenDemand(row.demandId)}
                >
                  {row.description}
                </button>
                <br />
                <span className="fos-mono fos-meta">{row.demandId}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{row.workloadId}</span>
              </td>
              <td>{row.quantity}</td>
              <td>
                {DeadlinePressureIndicator(row.deadlinePressure)}
                <br />
                <span className="fos-mono fos-meta">{row.deadline}</span>
              </td>
              <td>${row.budgetUsd.toLocaleString("en-US")}</td>
              <td>
                <span className="fos-meta">
                  SLA {row.slaFloor} · warranty {row.warrantyFloorDays}d · quality {row.qualityFloor}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersCard({ orders }: { readonly orders: AggregationDisplayView }): JSX.Element {
  if (orders.rows.length === 0) {
    return (
      <EmptyState
        title="No orders are formed yet"
        hint="Compatible accepted quotes aggregate into one order per (vendor, delivery area, deadline) — every member contract keeps its identity (LOCK 14)."
      />
    );
  }
  return (
    <Card
      title="Orders (deadline aggregation)"
      subtitle="Compatible accepted quotes, aggregated before the shared deadline — per-contract identity preserved."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Aggregated orders — {orders.total} formed</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Vendor</th>
              <th scope="col">Area / deadline</th>
              <th scope="col">Member contracts</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.rows.map((row: AggregatedOrderRowView) => (
              <tr key={row.aggregationId} data-aggregation-id={row.aggregationId}>
                <td>
                  <span className="fos-mono">{row.aggregationId}</span>
                </td>
                <td>
                  <span className="fos-mono fos-meta">{row.vendorId}</span>
                </td>
                <td>
                  {row.deliveryArea}
                  <br />
                  {DeadlinePressureIndicator(row.deadlinePressure)}
                  <br />
                  <span className="fos-mono fos-meta">{row.deadline}</span>
                </td>
                <td>
                  {row.members.map((member) => (
                    <span key={member.demandId} style={{ display: "block" }} className="fos-meta">
                      <span className="fos-mono">{member.demandId}</span>
                      {member.quoteId !== null ? ` ← ${member.quoteId}` : " (no accepted quote)"}
                    </span>
                  ))}
                </td>
                <td>
                  {row.totalQuantity} units
                  <br />
                  <span className="fos-meta">${row.totalAggregatedPriceUsd.toLocaleString("en-US")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VerificationCard({
  verification,
}: {
  readonly verification: OrderVerificationView;
}): JSX.Element {
  const chainEntries = Object.entries(verification.chainStatusCounts);
  return (
    <Card
      title="Order verification"
      subtitle="The commercial reconciliation report — delivery evidence against the agreed quote terms."
    >
      <DefinitionList
        entries={[
          {
            term: "Verified",
            value: (
              <StatusIndicator
                status={verification.verified ? "succeeded" : "needs_attention"}
                label={verification.verificationSummary}
              />
            ),
          },
          ...(verification.reportId.length > 0
            ? [
                { term: "Report", value: <span className="fos-mono">{verification.reportId}</span> },
                { term: "Computed at", value: <span className="fos-mono">{verification.computedAt}</span> },
                {
                  term: "Chains",
                  value: chainEntries
                    .map(([status, count]) => `${status}: ${String(count)}`)
                    .join(" · "),
                },
                {
                  term: "Discrepancies",
                  value: `${String(verification.discrepancyCount)}${
                    verification.discrepancyCount === 0
                      ? " (zero)"
                      : ` — ${Object.entries(verification.byKind)
                          .map(([kind, count]) => `${kind}: ${String(count)}`)
                          .join(", ")}`
                  }`,
                },
                {
                  term: "Content hash",
                  value: <span className="fos-mono">{verification.contentHash}</span>,
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The matching + quotes tabs
// ---------------------------------------------------------------------------

function MatchingView({
  matching,
}: {
  readonly matching: VendorMatchingView;
}): JSX.Element {
  return (
    <>
      {matching.ranked.length === 0 ? (
        <EmptyState
          title="No satisfiable vendor match"
          hint="No vendor passes the demand's hard gates (region, capability, terms floors). The refusals below show why."
        />
      ) : (
        <Card
          title="Vendor matching"
          subtitle={`The engine's rank order preserved${matching.engineVersion !== null ? ` (engine ${matching.engineVersion})` : ""}.`}
        >
          <div className="fos-table-wrap">
            <table className="fos-table">
              <caption>Satisfiable matches for the demand — ranked</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Vendor</th>
                  <th scope="col">Score</th>
                  <th scope="col">Capability</th>
                  <th scope="col">Headrooms</th>
                </tr>
              </thead>
              <tbody>
                {matching.ranked.map((row) => (
                  <tr key={row.vendorId} data-vendor-id={row.vendorId}>
                    <td>#{row.rankPosition}</td>
                    <td>
                      {row.vendorName}
                      <br />
                      <span className="fos-mono fos-meta">{row.vendorId}</span>
                    </td>
                    <td>
                      <StatusIndicator
                        status={matchConsoleStatus(true)}
                        label={`${row.rankScore} — ${CONSOLE_STATUS_LABEL[matchConsoleStatus(true)]}`}
                      />
                    </td>
                    <td>
                      <span className="fos-mono fos-meta">
                        {row.matchedCapabilityId ?? "—"}
                      </span>
                    </td>
                    <td>
                      {row.headrooms.map((headroom) => (
                        <span key={headroom.dimension} style={{ display: "block" }} className="fos-meta">
                          {headroom.dimension}: +{headroom.headroom} ({headroom.vendorValue} over {headroom.floor})
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {matching.rejected.length > 0 && (
        <Card
          title="Rejected vendors"
          subtitle="Blocked procurement shows the refusal reasons — machine-stable, verbatim."
        >
          <ul>
            {matching.rejected.map((row) => (
              <li key={row.vendorId}>
                <StatusIndicator
                  status={matchConsoleStatus(false)}
                  label={`${row.vendorId} — ${CONSOLE_STATUS_LABEL[matchConsoleStatus(false)]}`}
                />
                <ul style={{ marginTop: "0.25rem" }}>
                  {row.reasons.map((reason, index) => (
                    <li key={`${reason.kind}-${index}`} className="fos-meta">
                      <span className="fos-mono">{reason.kind}</span>: {reason.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function QuotesView({
  rows,
  onOpenQuote,
}: {
  readonly rows: readonly QuoteRowView[];
  readonly onOpenQuote: (quoteId: string) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No quotes are issued for this demand yet"
        hint="Vendors issue versioned quotes against the demand; acceptance (the operator approval) forms the contract."
      />
    );
  }
  return (
    <Card title="Quotes" subtitle="Versioned quote records — acceptance is a separate ledger entry (the machine-stable approval).">
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Quote ledger rows for the demand</caption>
          <thead>
          <tr>
            <th scope="col">Quote</th>
            <th scope="col">Vendor</th>
            <th scope="col">Version</th>
            <th scope="col">Total price</th>
            <th scope="col">Lead time</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const derivedStatus = row.accepted ? "ACCEPTED" : row.status;
            const status = quoteConsoleStatus(derivedStatus);
            return (
              <tr key={row.quoteId} data-quote-id={row.quoteId}>
                <td>
                  <button
                    type="button"
                    className="fos-linklike"
                    aria-label={`Open quote ${row.quoteId} from ${row.vendorId}`}
                    onClick={(): void => onOpenQuote(row.quoteId)}
                  >
                    {row.quoteId}
                  </button>
                </td>
                <td>
                  <span className="fos-mono fos-meta">{row.vendorId}</span>
                </td>
                <td>v{row.quoteVersion}</td>
                <td>${row.totalPriceUsd.toLocaleString("en-US")}</td>
                <td>{row.leadTimeDays}d</td>
                <td>
                  <StatusIndicator
                    status={status}
                    label={`${derivedStatus} — ${CONSOLE_STATUS_LABEL[status]}`}
                  />
                  {row.acceptedAt !== null && (
                    <span className="fos-meta" style={{ display: "block" }}>
                      accepted at {row.acceptedAt}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The quote record view (the record pattern + the authorization card)
// ---------------------------------------------------------------------------

function QuoteRecordView({
  row,
  evaluation,
  onBack,
}: {
  readonly row: QuoteRowView;
  readonly evaluation: QuoteEvaluationView | null;
  readonly onBack: () => void;
}): JSX.Element {
  const derivedStatus = row.accepted ? "ACCEPTED" : row.status;
  const status = quoteConsoleStatus(derivedStatus);
  const authorization: ConsequentialActionDescriptor = {
    action: "Quote acceptance",
    authorization: "Intent boundary (procurement)",
    policyDecision: null,
    approvalRequired: "Yes — operator acceptance of the quoted terms",
    expectedEffect: "The accepted quote becomes the agreed contract and can aggregate into an order",
    evidenceRequired: "The acceptance ledger entry (quote id + accepted-at instant)",
    executionState: row.accepted
      ? `Accepted at ${row.acceptedAt ?? "an unrecorded instant"} (ledger entry)`
      : "Not executed — proposal",
    executionStatus: row.accepted ? "succeeded" : "approval_required",
    // The verification result of quote acceptance is the ORDER
    // verification (the commercial reconciliation) — rendered at the
    // screen level. Decision support (budget/lead-time headroom) is NOT
    // verification: it stays in the Why-it-matters card, never here.
    verification: null,
    verificationStatus: null,
  };
  return (
    <>
      <Card
        title="Summary"
        actions={
          <Button variant="secondary" onClick={onBack} ariaLabel="Back to the quotes list">
            ← Back
          </Button>
        }
      >
        <DefinitionList
          entries={[
            { term: "Quote", value: <span className="fos-mono">{row.quoteId}</span> },
            { term: "Vendor", value: <span className="fos-mono">{row.vendorId}</span> },
            { term: "Version", value: `v${row.quoteVersion}` },
            {
              term: "Total price",
              value: `$${row.totalPriceUsd.toLocaleString("en-US")} (unit $${row.unitPriceUsd.toLocaleString("en-US")} × quantity)`,
            },
            {
              term: "Matched capability",
              value: <span className="fos-mono">{row.matchedCapabilityId ?? "—"}</span>,
            },
          ]}
        />
      </Card>
      <Card title="Current state">
        <DefinitionList
          entries={[
            {
              term: "Lifecycle",
              value: (
                <StatusIndicator
                  status={status}
                  label={`${derivedStatus} — ${CONSOLE_STATUS_LABEL[status]}`}
                />
              ),
            },
            {
              term: "Acceptance",
              value: row.accepted
                ? `Accepted — the ledger records the acceptance entry at ${row.acceptedAt ?? "an unrecorded instant"}.`
                : "Not accepted — acceptance is the operator approval that forms the contract.",
            },
            {
              term: "Supersedes",
              value: row.supersedes === null ? "None (first version)" : <span className="fos-mono">{row.supersedes}</span>,
            },
          ]}
        />
      </Card>
      <Card title="Why it matters">
        {evaluation === null ? (
          <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
            No evaluation view was supplied for this quote.
          </p>
        ) : (
          <DefinitionList
            entries={[
              {
                term: "Budget headroom",
                value: `$${evaluation.budgetHeadroomUsd.toLocaleString("en-US")} (${evaluation.withinBudget ? "within budget" : "over budget"})`,
              },
              {
                term: "Lead-time headroom",
                value: `${String(evaluation.leadTimeHeadroomDays)}d (${evaluation.leadTimeFeasible ? "fits the deadline window" : "does not fit"})`,
              },
              {
                term: "Warranty headroom",
                value: `${String(evaluation.warrantyHeadroomDays)}d over the demand floor`,
              },
              {
                term: "SLA headroom",
                value: `${String(evaluation.slaHeadroom)} over the demand floor`,
              },
            ]}
          />
        )}
      </Card>
      <ConsequentialActionCard descriptor={authorization} />
      <Card title="Evidence">
        <DefinitionList
          entries={[
            { term: "Issued at", value: <span className="fos-mono">{row.issuedAt}</span> },
            { term: "Quoted terms", value: `${row.leadTimeDays}d lead · ${row.warrantyDays}d warranty · SLA ${row.slaCoverage}` },
            { term: "Demand", value: <span className="fos-mono">{row.demandId}</span> },
          ]}
        />
      </Card>
      <Card title="History" subtitle="Quotes are versioned and append-only; supersession is displayed, never rewritten.">
        <DefinitionList
          entries={[
            { term: "Version", value: `v${row.quoteVersion}` },
            {
              term: "Supersedes",
              value: row.supersedes === null ? "None" : <span className="fos-mono">{row.supersedes}</span>,
            },
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The demand record view
// ---------------------------------------------------------------------------

function DemandDetail({
  demand,
  row,
  matching,
  quoteRows,
  tab,
  onTabChange,
  onOpenQuote,
}: {
  readonly demand: ProcurementDemandFacets;
  readonly row: ProcurementDemandRowView;
  readonly matching: VendorMatchingView;
  readonly quoteRows: readonly QuoteRowView[];
  readonly tab: ProcurementTab;
  readonly onTabChange: (tab: ProcurementTab) => void;
  readonly onOpenQuote: (quoteId: string) => void;
}): JSX.Element {
  return (
    <>
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Demand", value: <span className="fos-mono">{row.demandId}</span> },
            { term: "Description", value: demand.description },
            { term: "Quantity", value: String(demand.quantity) },
            { term: "Workload", value: <span className="fos-mono">{demand.workloadId}</span> },
          ]}
        />
      </Card>
      <Card title="Current state">
        <DefinitionList
          entries={[
            {
              term: "Deadline",
              value: (
                <>
                  {DeadlinePressureIndicator(row.deadlinePressure)}{" "}
                  <span className="fos-mono fos-meta">{row.deadline}</span>
                </>
              ),
            },
            { term: "Delivery area", value: demand.deliveryArea },
            { term: "Budget cap", value: `$${demand.budget.usd.toLocaleString("en-US")}` },
            {
              term: "Floors",
              value: `SLA ${demand.slaFloor.coverage} · warranty ${demand.warrantyFloor.days}d · quality ${demand.qualityFloor.score} · availability ${demand.availabilityFloor.ratio}`,
            },
            {
              term: "Allowed substitutions",
              value: row.allowedSubstitutions.length === 0 ? "None" : row.allowedSubstitutions.join(", "),
            },
          ]}
        />
      </Card>
      <Card title="Why it matters">
        <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
          The floors are hard gates: vendors below them are refused with machine-stable
          reasons. The rejection evidence carried into matching is{" "}
          {row.rejectionEvidence.length === 0
            ? "empty (no workload candidate was rejected on this demand's path)."
            : `carried from ${String(row.rejectionEvidence.length)} rejected workload candidate${row.rejectionEvidence.length === 1 ? "" : "s"}.`}
        </p>
      </Card>
      <Tabs
        ariaLabel="Demand detail panels"
        activeId={tab}
        onChange={(id): void => onTabChange(id as ProcurementTab)}
        tabs={[
          { id: "matching", label: "Vendor matching", count: matching.ranked.length + matching.rejected.length },
          { id: "quotes", label: "Quotes", count: quoteRows.length },
        ]}
      />
      {tab === "matching" ? (
        <MatchingView matching={matching} />
      ) : (
        <QuotesView rows={quoteRows} onOpenQuote={onOpenQuote} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered procurement screen (requests -> quotes -> approval -> order). */
export function ProcurementScreen(props: ProcurementScreenProps): JSX.Element {
  const { phase, surface } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Procurement requests">
        <Skeleton label="Loading the procurement surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the procurement surface" />;
  } else if (ready === null) {
    body = null;
  } else if (surface.view === "demands" || ready.selected === null) {
    body =
      ready.demands.rows.length === 0 ? (
        <EmptyState
          title="No procurement requests are open"
          hint="A procurement demand opens when a workload plan proposes procurement — the demand carries the quantity, deadline, budget cap and the hard term floors vendors must meet."
        />
      ) : (
        <Card title="Requests" subtitle={DEMAND_COLUMNS}>
          <DemandsTable
            view={ready.demands}
            onOpenDemand={(demandId): void => props.onSurfaceEvent({ type: "open_demand", demandId })}
          />
        </Card>
      );
  } else {
    const selected = ready.selected;
    if (surface.view === "matching") {
      body = (
        <>
          <Breadcrumb
            items={[
              { label: "Commerce" },
              { label: "Procurement" },
              { label: selected.demand.demandId },
              { label: "Vendor matching", current: true },
            ]}
          />
          <MatchingView matching={selected.matching} />
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the demand detail"
          >
            ← Back to demand
          </Button>
        </>
      );
    } else if (surface.view === "quote") {
      const row = selected.quoteRows.find((candidate) => candidate.quoteId === surface.quoteId);
      const evaluation =
        selected.evaluations.find((candidate) => candidate.quoteId === surface.quoteId) ?? null;
      body = row === undefined ? (
        <EmptyState
          title="The quote is not in this demand's ledger"
          hint="Open the demand's Quotes tab and select a versioned quote record."
        />
      ) : (
        <QuoteRecordView
          row={row}
          evaluation={evaluation}
          onBack={(): void => props.onSurfaceEvent({ type: "back" })}
        />
      );
    } else {
      const demandRow = ready.demands.rows.find(
        (candidate) => candidate.demandId === selected.demand.demandId,
      );
      body =
        demandRow === undefined ? (
          // The list view is missing the selected demand's row — an explicit
          // not-found state, NEVER a fabricated row (business truth stays in
          // the view-model).
          <EmptyState
            title="The demand's list row is not in this view"
            hint="The demand record is selected but its list-view row is missing. Return to the requests list and reopen the demand."
          />
        ) : (
          <>
            <Breadcrumb
              items={[
                { label: "Commerce" },
                { label: "Procurement" },
                { label: selected.demand.demandId, current: true },
              ]}
            />
            <DemandDetail
              demand={selected.demand}
              row={demandRow}
              matching={selected.matching}
              quoteRows={selected.quoteRows}
              tab={props.tab}
              onTabChange={props.onTabChange}
              onOpenQuote={(quoteId): void => props.onSurfaceEvent({ type: "open_quote", quoteId })}
            />
          </>
        );
    }
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — procurement">
      <ConsoleStyles />
      <Breadcrumb
        items={[
          { label: "Commerce" },
          { label: "Procurement", current: surface.view === "demands" },
        ]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Procurement</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.demands.total} request${phase.view.demands.total === 1 ? "" : "s"} · ${phase.view.orders.total} order${phase.view.orders.total === 1 ? "" : "s"} formed · requests, vendor quotes, acceptance and verified orders`
              : "The procurement exchange: requests, vendor matching, versioned quotes, acceptance and verified orders."}
          </p>
        </div>
        {phase.kind === "ready" && surface.view !== "demands" && (
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the requests list"
          >
            ← All requests
          </Button>
        )}
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <CommerceJourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
      {ready !== null && surface.view === "demands" && (
        <>
          <OrdersCard orders={ready.orders} />
          <VerificationCard verification={ready.verification} />
        </>
      )}
    </section>
  );
}
