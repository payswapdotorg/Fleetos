/**
 * @fleetos/web-commerce — D2.4 rendered: the MaintenanceScreen
 * (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`maintenance.ts` + `outcomes.ts` + `state.ts` — logic untouched):
 * the maintenance EXCHANGE journey — work order -> exchange/service ->
 * VERIFIED maintenance outcome — rendered by the EXISTING
 * `MaintenanceSurfaceState` machine:
 *
 *   workOrders      -> the work-order list (diagnosis-evidence refs,
 *                      deadline-pressure statuses);
 *   workOrder       -> the work-order record detail + the Service
 *                      matching / Warranty eligibility tabs + the
 *                      maintenance-exchange JOURNEY timeline (work
 *                      order -> service match -> aggregated service
 *                      order -> VERIFIED outcome);
 *   serviceMatching -> the engine's ranked service matches + rejected
 *                      vendors with refusal reasons;
 *   eligibility     -> the warranty-aware standing per vendor.
 *
 * The terminal VERIFIED outcome (the 🟡 "journey stops before verified
 * outcome" gap) renders EXPLICITLY: the W072 measured aggregation
 * outcome card with per-contract completion evidence, coverage ratio
 * and deadline adherence — Succeeded when every member contract was
 * served.
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. No business truth in
 * React state.
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
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  deadlinePressureConsoleStatus,
  maintenanceOutcomeConsoleStatus,
  matchConsoleStatus,
  warrantyStandingConsoleStatus,
} from "../ui/status";
import type {
  AggregatedServiceOrderListView,
  ServiceMatchRowView,
  ServiceMatchingView,
  ServiceWorkOrderListView,
} from "../maintenance";
import type { MaintenanceSurfaceEvent, MaintenanceSurfaceState } from "../state";
import type { ServiceWorkOrderFacets } from "../seams";
import type { MaintenanceOutcomeRowView, MaintenanceOutcomesView } from "../outcomes";
import { CommerceJourneyRail, ConsequentialActionCard } from "./commerce-shared";
import type { CommerceJourneyRailStage, ConsequentialActionDescriptor } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The work-order-detail tab selection (fully controlled). */
export type MaintenanceTab = "matching" | "eligibility";

/** The composed maintenance data (built by the shell from the builders). */
export interface MaintenanceScreenData {
  readonly workOrders: ServiceWorkOrderListView;
  /** The selected work order's detail (null in the list view). */
  readonly selected: {
    readonly workOrder: ServiceWorkOrderFacets;
    readonly matching: ServiceMatchingView;
    /** The per-vendor warranty eligibility standings. */
    readonly eligibility: readonly {
      readonly vendorId: string;
      readonly standing: "in_warranty_headroom" | "out_of_warranty_shortfall" | "warranty_floor_unmet";
      readonly vendorWarrantyDays: number;
      readonly warrantyFloorDays: number;
      readonly warrantyHeadroomDays: number;
    }[];
  } | null;
  /** The aggregated service orders (the exchange's LOCK 14 arm). */
  readonly aggregations: AggregatedServiceOrderListView;
  /** The VERIFIED maintenance outcomes (the W072 measured evidence). */
  readonly outcomes: MaintenanceOutcomesView;
}

export interface MaintenanceScreenProps {
  readonly phase: ScreenPhase<MaintenanceScreenData>;
  readonly surface: MaintenanceSurfaceState;
  readonly onSurfaceEvent: (event: MaintenanceSurfaceEvent) => void;
  readonly tab: MaintenanceTab;
  readonly onTabChange: (tab: MaintenanceTab) => void;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The work-order list
// ---------------------------------------------------------------------------

function WorkOrdersTable({
  view,
  onOpenWorkOrder,
}: {
  readonly view: ServiceWorkOrderListView;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Service work orders — {view.total} open, ordered by work order id</caption>
        <thead>
          <tr>
            <th scope="col">Work order</th>
            <th scope="col">Device</th>
            <th scope="col">Service</th>
            <th scope="col">Deadline</th>
            <th scope="col">Diagnosis evidence</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.workOrderId} data-work-order-id={row.workOrderId}>
              <td>
                <button
                  type="button"
                  className="fos-linklike"
                  aria-label={`Open work order ${row.workOrderId} for device ${row.deviceId}`}
                  onClick={(): void => onOpenWorkOrder(row.workOrderId)}
                >
                  {row.workOrderId}
                </button>
                <br />
                <span className="fos-meta">revision r{row.revision}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{row.deviceId}</span>
              </td>
              <td>
                {row.serviceCategory}
                <br />
                <span className="fos-meta">{row.serviceArea}</span>
              </td>
              <td>
                <StatusIndicator
                  status={deadlinePressureConsoleStatus(row.deadlinePressure)}
                  label={`${row.deadlinePressure} — ${CONSOLE_STATUS_LABEL[deadlinePressureConsoleStatus(row.deadlinePressure)]}`}
                />
                <br />
                <span className="fos-mono fos-meta">{row.deadline}</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{row.diagnosis.hypothesisId}</span>
                <br />
                <span className="fos-mono fos-meta">{row.diagnosis.recommendationId}</span>
                <br />
                <span className="fos-meta">confidence {row.diagnosis.confidence}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The maintenance-exchange journey timeline (work order -> VERIFIED outcome)
// ---------------------------------------------------------------------------

/** The work order's measured outcome + served flag, when one exists (PURE lookup). */
function findContractOutcome(
  aggregations: AggregatedServiceOrderListView,
  outcomes: MaintenanceOutcomesView,
  workOrderId: string,
): { readonly outcome: MaintenanceOutcomeRowView; readonly served: boolean } | null {
  const memberAggregation = aggregations.rows.find((row) =>
    row.memberWorkOrderIds.includes(workOrderId),
  );
  if (memberAggregation === undefined) return null;
  const outcome = outcomes.rows.find((row) => row.aggregationId === memberAggregation.aggregationId);
  if (outcome === undefined) return null;
  return {
    outcome,
    served: outcome.perContract.some((contract) => contract.workOrderId === workOrderId),
  };
}

function ExchangeJourneyTimeline({
  workOrderId,
  matching,
  aggregations,
  outcomes,
}: {
  readonly workOrderId: string;
  readonly matching: ServiceMatchingView;
  readonly aggregations: AggregatedServiceOrderListView;
  readonly outcomes: MaintenanceOutcomesView;
}): JSX.Element {
  const matched = matching.ranked.length > 0;
  const memberAggregation = aggregations.rows.find((row) =>
    row.memberWorkOrderIds.includes(workOrderId),
  );
  const contractOutcome = findContractOutcome(aggregations, outcomes, workOrderId);
  const served = contractOutcome?.served === true;
  const items: readonly TimelineItem[] = [
    {
      id: "diagnosis",
      label: "Health diagnosis evidence",
      detail: "The work order cites the hypothesis, treatment recommendation and cause with observations.",
      state: "done",
    },
    {
      id: "work-order",
      label: "Work order created",
      detail: `Work order ${workOrderId} derived from the diagnosis.`,
      state: "done",
    },
    {
      id: "service-match",
      label: "Vendor/service match",
      detail: matched
        ? `${String(matching.ranked.length)} satisfiable service match${matching.ranked.length === 1 ? "" : "es"} (engine rank order).`
        : "No satisfiable service match yet.",
      state: matched ? "done" : "current",
    },
    {
      id: "aggregated-order",
      label: "Aggregated service order",
      detail:
        memberAggregation === undefined
          ? "No aggregated service order includes this work order yet."
          : `Aggregation ${memberAggregation.aggregationId} (vendor ${memberAggregation.vendorId}, ${String(memberAggregation.memberCount)} members).`,
      state: memberAggregation === undefined ? "pending" : "done",
    },
    {
      id: "verified-outcome",
      label: "Verified maintenance outcome",
      detail:
        contractOutcome === null
          ? "No measured outcome verifies the service yet."
          : served
            ? `VERIFIED: contract served by vendor, completed with evidence (coverage ${contractOutcome.outcome.coverageRatio}, on-time ${contractOutcome.outcome.onTimeRatio ?? "n/a"}).`
            : `Outcome measured but this contract is UNSERVED (coverage ${contractOutcome.outcome.coverageRatio}).`,
      state: contractOutcome === null ? "pending" : served ? "done" : "blocked",
      stateLabel:
        contractOutcome === null
          ? "Pending"
          : served
            ? "Verified — Succeeded"
            : "Unserved — Blocked",
    },
  ];
  return (
    <Card
      title="Maintenance exchange journey"
      subtitle="Work order -> exchange/service -> VERIFIED maintenance outcome — the verification state is explicit."
    >
      <Timeline items={items} ariaLabel="Maintenance exchange journey" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The matching + eligibility tabs
// ---------------------------------------------------------------------------

function ServiceMatchingViewCard({
  matching,
}: {
  readonly matching: ServiceMatchingView;
}): JSX.Element {
  return (
    <>
      {matching.ranked.length === 0 ? (
        <EmptyState
          title="No satisfiable service match"
          hint="No vendor passes the work order's hard gates. The refusals below show why."
        />
      ) : (
        <Card title="Service matching" subtitle="The engine's rank order preserved.">
          <div className="fos-table-wrap">
            <table className="fos-table">
              <caption>Satisfiable service matches — ranked</caption>
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
                {matching.ranked.map((row: ServiceMatchRowView) => (
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
                      <span className="fos-mono fos-meta">{row.matchedCapabilityId ?? "—"}</span>
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
        <Card title="Rejected vendors" subtitle="The hard-gate refusal reasons, machine-stable.">
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

function EligibilityCard({
  eligibility,
}: {
  readonly eligibility: readonly {
    readonly vendorId: string;
    readonly standing: "in_warranty_headroom" | "out_of_warranty_shortfall" | "warranty_floor_unmet";
    readonly vendorWarrantyDays: number;
    readonly warrantyFloorDays: number;
    readonly warrantyHeadroomDays: number;
  }[];
}): JSX.Element {
  if (eligibility.length === 0) {
    return (
      <EmptyState
        title="No warranty eligibility is evaluated yet"
        hint="Eligibility compares each vendor's warranty window against the work order's warranty floor."
      />
    );
  }
  return (
    <Card
      title="Warranty eligibility"
      subtitle="The warranty-aware standing per vendor — the W042 vocabulary, machine-stable."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Warranty-aware eligibility standings</caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Standing</th>
              <th scope="col">Vendor warranty</th>
              <th scope="col">Floor</th>
              <th scope="col">Headroom</th>
            </tr>
          </thead>
          <tbody>
            {eligibility.map((row) => {
              const status = warrantyStandingConsoleStatus(row.standing);
              return (
                <tr key={row.vendorId}>
                  <td>
                    <span className="fos-mono fos-meta">{row.vendorId}</span>
                  </td>
                  <td>
                    <StatusIndicator
                      status={status}
                      label={`${row.standing} — ${CONSOLE_STATUS_LABEL[status]}`}
                    />
                  </td>
                  <td>{row.vendorWarrantyDays}d</td>
                  <td>{row.warrantyFloorDays}d</td>
                  <td>{row.warrantyHeadroomDays}d</td>
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
// The verified outcome card (the terminal state)
// ---------------------------------------------------------------------------

function VerifiedOutcomesCard({
  outcomes,
}: {
  readonly outcomes: MaintenanceOutcomesView;
}): JSX.Element {
  if (outcomes.rows.length === 0) {
    return (
      <EmptyState
        title="No maintenance outcome is measured yet"
        hint="The measured aggregation outcome — per-contract completion evidence, coverage and deadline adherence — is the VERIFIED terminal state of the maintenance exchange."
      />
    );
  }
  return (
    <Card
      title="Verified maintenance outcomes"
      subtitle="The W072 measured aggregation outcomes — the terminal verification state, rendered read-only."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Measured outcomes — {outcomes.verifiedCount} of {outcomes.total} fully covered (VERIFIED)</caption>
          <thead>
            <tr>
              <th scope="col">Outcome</th>
              <th scope="col">Verification</th>
              <th scope="col">Coverage</th>
              <th scope="col">Per-contract completion evidence</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.rows.map((row) => {
              const status = maintenanceOutcomeConsoleStatus(row.fullCoverage);
              return (
                <tr key={row.outcomeId} data-outcome-id={row.outcomeId}>
                  <td>
                    <span className="fos-mono">{row.outcomeId}</span>
                    <br />
                    <span className="fos-mono fos-meta">aggregation {row.aggregationId}</span>
                    <br />
                    <span className="fos-mono fos-meta">vendor {row.vendorId} · {row.serviceArea}</span>
                  </td>
                  <td>
                    <StatusIndicator
                      status={status}
                      label={
                        row.fullCoverage
                          ? `VERIFIED — ${CONSOLE_STATUS_LABEL[status]}`
                          : `Partial — ${CONSOLE_STATUS_LABEL[status]}`
                      }
                    />
                    <span className="fos-meta" style={{ display: "block" }}>
                      {row.fullCoverage
                        ? "Every member contract served."
                        : `${String(row.ordersServed)} of ${String(row.ordersAggregated)} contracts served.`}
                    </span>
                    <span className="fos-mono fos-meta" style={{ display: "block" }}>
                      computed {row.computedAt} · {row.contentHash}
                    </span>
                  </td>
                  <td>
                    {row.coverageRatio}
                    <br />
                    <span className="fos-meta">
                      on-time {row.onTimeRatio ?? "n/a"} ({String(row.metCount)} met / {String(row.missedCount)} missed)
                    </span>
                  </td>
                  <td>
                    {row.perContract.map((contract) => (
                      <span key={contract.workOrderId} style={{ display: "block" }} className="fos-meta">
                        <span className="fos-mono">{contract.workOrderId}</span> ← {contract.vendorId} at{" "}
                        <span className="fos-mono">{contract.completedAt}</span>{" "}
                        {contract.metDeadline ? "(on time)" : "(LATE)"}
                      </span>
                    ))}
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
// The aggregated service orders card (LOCK 14 — per-contract identity)
// ---------------------------------------------------------------------------

function AggregationsCard({
  aggregations,
}: {
  readonly aggregations: AggregatedServiceOrderListView;
}): JSX.Element {
  if (aggregations.rows.length === 0) {
    return (
      <EmptyState
        title="No aggregated service orders are formed yet"
        hint="Compatible work orders aggregate under a shared deadline for vendor fulfillment — every member contract keeps its own identity (LOCK 14)."
      />
    );
  }
  return (
    <Card
      title="Aggregated service orders"
      subtitle="Deadline-compatible work orders aggregated for fulfillment — every member contract keeps its identity."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Aggregated service orders — {aggregations.total} formed</caption>
          <thead>
            <tr>
              <th scope="col">Aggregation</th>
              <th scope="col">Vendor</th>
              <th scope="col">Service area</th>
              <th scope="col">Shared deadline</th>
              <th scope="col">Member contracts</th>
              <th scope="col">Warranty headroom</th>
            </tr>
          </thead>
          <tbody>
            {aggregations.rows.map((row) => {
              const status = deadlinePressureConsoleStatus(row.deadlinePressure);
              return (
                <tr key={row.aggregationId} data-aggregation-id={row.aggregationId}>
                  <td>
                    <span className="fos-mono">{row.aggregationId}</span>
                    <span className="fos-meta" style={{ display: "block" }}>
                      formed {row.formedAt}
                    </span>
                  </td>
                  <td>
                    <span className="fos-mono fos-meta">{row.vendorId}</span>
                  </td>
                  <td>{row.serviceArea}</td>
                  <td>
                    <StatusIndicator
                      status={status}
                      label={`${row.deadlinePressure} — ${CONSOLE_STATUS_LABEL[status]}`}
                    />
                    <span className="fos-meta" style={{ display: "block" }}>{row.deadline}</span>
                  </td>
                  <td>
                    {row.memberWorkOrderIds.map((memberId) => (
                      <span key={memberId} className="fos-mono fos-meta" style={{ display: "block" }}>
                        {memberId}
                      </span>
                    ))}
                    <span className="fos-meta">
                      {row.memberCount} member{row.memberCount === 1 ? "" : "s"} — identity preserved
                    </span>
                  </td>
                  <td>{row.totalWarrantyHeadroomDays}d total</td>
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
// The work-order record view
// ---------------------------------------------------------------------------

function WorkOrderDetail({
  workOrder,
  matching,
  eligibility,
  aggregations,
  outcomes,
  tab,
  onTabChange,
}: {
  readonly workOrder: ServiceWorkOrderFacets;
  readonly matching: ServiceMatchingView;
  readonly eligibility: readonly {
    readonly vendorId: string;
    readonly standing: "in_warranty_headroom" | "out_of_warranty_shortfall" | "warranty_floor_unmet";
    readonly vendorWarrantyDays: number;
    readonly warrantyFloorDays: number;
    readonly warrantyHeadroomDays: number;
  }[];
  readonly aggregations: AggregatedServiceOrderListView;
  readonly outcomes: MaintenanceOutcomesView;
  readonly tab: MaintenanceTab;
  readonly onTabChange: (tab: MaintenanceTab) => void;
}): JSX.Element {
  // The work order's measured contract outcome (shared by the journey
  // timeline and the authorization card — a PURE lookup, never invented).
  const contractOutcome = findContractOutcome(aggregations, outcomes, workOrder.workOrderId);
  const served = contractOutcome?.served === true;
  const authorization: ConsequentialActionDescriptor = {
    action: "Maintenance exchange (service fulfillment)",
    authorization: "The maintenance exchange boundary (aggregated service order)",
    policyDecision:
      workOrder.warrantyRules.requireInWarranty
        ? "Warranty rules require in-warranty fulfillment (the warranty floor is a hard gate)."
        : null,
    approvalRequired: "Vendor/service acceptance at the exchange boundary",
    expectedEffect: "The matched vendor fulfills the service; the measured outcome verifies completion",
    evidenceRequired: "Per-contract completion evidence (work order, vendor, completion instant)",
    executionState: "Fulfillment displayed as evidence — the exchange is never executed by this view",
    executionStatus: "informational",
    // The VERIFICATION RESULT facet: the measured aggregation outcome for
    // THIS work order's contract (served = VERIFIED; measured-but-unserved
    // = blocked; no outcome yet = null — never invented).
    verification:
      contractOutcome === null
        ? null
        : served
          ? `VERIFIED: contract served by vendor (coverage ${contractOutcome.outcome.coverageRatio}, on-time ${contractOutcome.outcome.onTimeRatio ?? "n/a"}).`
          : `Outcome measured but this contract is UNSERVED (coverage ${contractOutcome.outcome.coverageRatio}).`,
    verificationStatus:
      contractOutcome === null ? null : served ? "succeeded" : "blocked",
  };
  return (
    <>
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Work order", value: <span className="fos-mono">{workOrder.workOrderId}</span> },
            { term: "Device", value: <span className="fos-mono">{workOrder.deviceId}</span> },
            { term: "Service", value: `${workOrder.serviceCategory} · ${workOrder.serviceArea}` },
            { term: "Revision", value: `r${workOrder.revision}` },
          ]}
        />
      </Card>
      <Card title="Current state">
        <DefinitionList
          entries={[
            { term: "Deadline", value: <span className="fos-mono">{workOrder.deadline}</span> },
            {
              term: "Warranty rules",
              value: `floor ${String(workOrder.warrantyRules.warrantyFloor.days)}d · in-warranty ${workOrder.warrantyRules.requireInWarranty ? "required" : "not required"}`,
            },
            {
              term: "Floors",
              value: `SLA ${workOrder.slaFloor.coverage} · quality ${workOrder.qualityFloor.score} · availability ${workOrder.availabilityFloor.ratio}`,
            },
            {
              term: "Allowed substitutions",
              value:
                workOrder.allowedSubstitutions.length === 0
                  ? "None"
                  : workOrder.allowedSubstitutions.join(", "),
            },
          ]}
        />
      </Card>
      <Card title="Why it matters">
        <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
          The work order is derived from a health diagnosis — the hypothesis, treatment
          recommendation and cause are cited as machine-stable evidence, with{" "}
          {String(workOrder.diagnosis.observationIds.length)} observation link
          {workOrder.diagnosis.observationIds.length === 1 ? "" : "s"} (confidence{" "}
          {workOrder.diagnosis.confidence}). Fulfillment belongs to local vendors; FleetOS
          owns the plan.
        </p>
      </Card>
      <ExchangeJourneyTimeline
        workOrderId={workOrder.workOrderId}
        matching={matching}
        aggregations={aggregations}
        outcomes={outcomes}
      />
      <ConsequentialActionCard descriptor={authorization} />
      <Tabs
        ariaLabel="Work order detail panels"
        activeId={tab}
        onChange={(id): void => onTabChange(id as MaintenanceTab)}
        tabs={[
          { id: "matching", label: "Service matching", count: matching.ranked.length + matching.rejected.length },
          { id: "eligibility", label: "Warranty eligibility", count: eligibility.length },
        ]}
      />
      {tab === "matching" ? (
        <ServiceMatchingViewCard matching={matching} />
      ) : (
        <EligibilityCard eligibility={eligibility} />
      )}
      <Card title="Evidence">
        <DefinitionList
          entries={[
            { term: "Hypothesis", value: <span className="fos-mono">{workOrder.diagnosis.hypothesisId}</span> },
            {
              term: "Treatment recommendation",
              value: <span className="fos-mono">{workOrder.diagnosis.recommendationId}</span>,
            },
            { term: "Cause", value: <span className="fos-mono">{workOrder.diagnosis.causeId}</span> },
            {
              term: "Observations",
              value: workOrder.diagnosis.observationIds.join(", "),
            },
            { term: "Content digest", value: <span className="fos-mono">{workOrder.contentDigest}</span> },
          ]}
        />
      </Card>
      <Card title="History" subtitle="Work orders are versioned and append-only.">
        <DefinitionList
          entries={[
            { term: "Revision", value: `r${workOrder.revision}` },
            { term: "Created at", value: <span className="fos-mono">{workOrder.createdAt}</span> },
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered maintenance screen (work orders -> exchange -> VERIFIED outcome). */
export function MaintenanceScreen(props: MaintenanceScreenProps): JSX.Element {
  const { phase, surface } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Maintenance work orders">
        <Skeleton label="Loading the maintenance surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the maintenance surface" />;
  } else if (ready === null) {
    body = null;
  } else if (surface.view === "workOrders" || ready.selected === null) {
    body =
      ready.workOrders.rows.length === 0 ? (
        <EmptyState
          title="No service work orders are open"
          hint="Work orders are derived from health diagnoses: the diagnosis evidence, service area, deadline and warranty rules arrive with the record."
        />
      ) : (
        <Card title="Work orders" subtitle="Diagnosis evidence and deadline pressure per work order.">
          <WorkOrdersTable
            view={ready.workOrders}
            onOpenWorkOrder={(workOrderId): void =>
              props.onSurfaceEvent({ type: "open_work_order", workOrderId })
            }
          />
        </Card>
      );
  } else {
    const selected = ready.selected;
    if (surface.view === "serviceMatching") {
      body = (
        <>
          <Breadcrumb
            items={[
              { label: "Commerce" },
              { label: "Maintenance" },
              { label: selected.workOrder.workOrderId },
              { label: "Service matching", current: true },
            ]}
          />
          <ServiceMatchingViewCard matching={selected.matching} />
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the work order detail"
          >
            ← Back to work order
          </Button>
        </>
      );
    } else if (surface.view === "eligibility") {
      body = (
        <>
          <Breadcrumb
            items={[
              { label: "Commerce" },
              { label: "Maintenance" },
              { label: selected.workOrder.workOrderId },
              { label: "Warranty eligibility", current: true },
            ]}
          />
          <EligibilityCard eligibility={selected.eligibility} />
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the work order detail"
          >
            ← Back to work order
          </Button>
        </>
      );
    } else {
      body = (
        <>
          <Breadcrumb
            items={[
              { label: "Commerce" },
              { label: "Maintenance" },
              { label: selected.workOrder.workOrderId, current: true },
            ]}
          />
          <WorkOrderDetail
            workOrder={selected.workOrder}
            matching={selected.matching}
            eligibility={selected.eligibility}
            aggregations={ready.aggregations}
            outcomes={ready.outcomes}
            tab={props.tab}
            onTabChange={props.onTabChange}
          />
        </>
      );
    }
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — maintenance">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "Commerce" }, { label: "Maintenance", current: surface.view === "workOrders" }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Maintenance</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.workOrders.total} work order${phase.view.workOrders.total === 1 ? "" : "s"} · ${phase.view.aggregations.total} aggregated service order${phase.view.aggregations.total === 1 ? "" : "s"} · ${phase.view.outcomes.verifiedCount} verified outcome${phase.view.outcomes.verifiedCount === 1 ? "" : "s"}`
              : "The maintenance exchange: work orders, service matching, warranty eligibility and verified outcomes."}
          </p>
        </div>
        {phase.kind === "ready" && surface.view !== "workOrders" && (
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the work-order list"
          >
            ← All work orders
          </Button>
        )}
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <CommerceJourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
      {ready !== null && surface.view === "workOrders" && (
        <AggregationsCard aggregations={ready.aggregations} />
      )}
      {ready !== null && <VerifiedOutcomesCard outcomes={ready.outcomes} />}
    </section>
  );
}
