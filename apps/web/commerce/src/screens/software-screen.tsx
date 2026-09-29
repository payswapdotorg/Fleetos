/**
 * @fleetos/web-commerce — D2.2 rendered: the SoftwareScreen (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`catalog.ts` + `outcomes.ts` — logic untouched): the software
 * catalog / entitlements with lifecycle states (allocated
 * subscriptions with revision + supersession lineages), the D3
 * software-NEEDS section (the workload plan recommendation's draft
 * software-subscription intents joined against the allocations), and
 * the entitlement VERIFICATION (the provision-evidence
 * reconciliation) — the terminal verified state of the software arm.
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. No business truth in
 * React state; the journey rail arrives as props.
 */

import type { JSX, ReactNode } from "react";
import { ConsoleStyles } from "../ui/tokens";
import {
  Breadcrumb,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL, subscriptionLifecycleConsoleStatus } from "../ui/status";
import type { SoftwareCatalogView } from "../catalog";
import type {
  EntitlementVerificationView,
  SoftwareNeedsView,
  SubscriptionLifecycleView,
} from "../outcomes";
import { deriveSubscriptionLifecycle } from "../outcomes";
import { CommerceJourneyRail } from "./commerce-shared";
import type { CommerceJourneyRailStage } from "./commerce-shared";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The composed software data (built by the shell from the builders). */
export interface SoftwareScreenData {
  /** The allocated subscriptions (entitlements). */
  readonly catalog: SoftwareCatalogView;
  /** The workload-plan software needs (D3), when supplied. */
  readonly needs: SoftwareNeedsView | null;
  /** The entitlement verification (provision evidence), when present. */
  readonly verification: EntitlementVerificationView;
  /** The injected display instant (ISO 8601) — the lifecycle clock is NEVER read. */
  readonly now: string;
}

export interface SoftwareScreenProps {
  readonly phase: ScreenPhase<SoftwareScreenData>;
  readonly journey: readonly CommerceJourneyRailStage[] | null;
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The needs section (D3)
// ---------------------------------------------------------------------------

function NeedsCard({ needs }: { readonly needs: SoftwareNeedsView }): JSX.Element | null {
  if (needs.rows.length === 0) return null;
  return (
    <Card
      title="Software needs (from workload plan recommendations)"
      subtitle="Draft software-subscription intents proposed by the workload plan, joined against the allocated catalog."
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>Software needs — {needs.satisfiedCount} of {needs.total} satisfied</caption>
          <thead>
            <tr>
              <th scope="col">Software</th>
              <th scope="col">Workload</th>
              <th scope="col">Seats</th>
              <th scope="col">Allocation</th>
            </tr>
          </thead>
          <tbody>
            {needs.rows.map((row) => (
              <tr key={`${row.workloadId}-${row.softwareId ?? "any"}`}>
                <td>
                  <span className="fos-mono">{row.softwareId ?? "unspecified"}</span>
                </td>
                <td>
                  <span className="fos-mono fos-meta">{row.workloadId}</span>
                </td>
                <td>{row.seatCount}</td>
                <td>
                  <StatusIndicator
                    status={row.satisfied ? "healthy" : "needs_attention"}
                    label={
                      row.satisfied
                        ? `Satisfied — ${CONSOLE_STATUS_LABEL.healthy}`
                        : `Needs attention — ${CONSOLE_STATUS_LABEL.needs_attention}`
                    }
                  />
                  <span className="fos-meta" style={{ display: "block" }}>
                    {row.summary}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The entitlements + verification
// ---------------------------------------------------------------------------

function EntitlementsCard({
  catalog,
  now,
}: {
  readonly catalog: SoftwareCatalogView;
  readonly now: string;
}): JSX.Element {
  return (
    <Card
      title="Entitlements"
      subtitle={`Allocated subscriptions — ${catalog.totalSeats} seat${catalog.totalSeats === 1 ? "" : "s"} across ${catalog.total} subscription${catalog.total === 1 ? "" : "s"}.`}
    >
      <div className="fos-table-wrap">
        <table className="fos-table">
          <caption>The software catalog — allocated subscriptions with lifecycle states</caption>
          <thead>
            <tr>
              <th scope="col">Subscription</th>
              <th scope="col">Software</th>
              <th scope="col">Seats</th>
              <th scope="col">Term</th>
              <th scope="col">Workload</th>
              <th scope="col">Lifecycle</th>
            </tr>
          </thead>
          <tbody>
            {catalog.rows.map((row) => {
              // The lifecycle derives in the VIEW-MODEL layer from the
              // injected `now` — this layer only renders it.
              const lifecycle: SubscriptionLifecycleView = deriveSubscriptionLifecycle(now, row);
              const status = subscriptionLifecycleConsoleStatus(lifecycle.state);
              return (
                <tr key={row.subscriptionId} data-subscription-id={row.subscriptionId}>
                  <td>
                    <span className="fos-mono">{row.subscriptionId}</span>
                  </td>
                  <td>
                    <span className="fos-mono">{row.softwareId}</span>
                  </td>
                  <td>{row.seatCount}</td>
                  <td>{row.termDays}d</td>
                  <td>
                    <span className="fos-mono fos-meta">{row.workloadId}</span>
                  </td>
                  <td>
                    <StatusIndicator
                      status={status}
                      label={`${lifecycle.state} — ${CONSOLE_STATUS_LABEL[status]}`}
                    />
                    <span className="fos-meta" style={{ display: "block" }}>
                      revision r{row.revision}
                    </span>
                    <span className="fos-meta" style={{ display: "block" }}>
                      allocated at {row.allocatedAt}
                    </span>
                    <span className="fos-meta" style={{ display: "block" }}>
                      term ends {lifecycle.endsAt} ·{" "}
                      {lifecycle.daysRemaining >= 0
                        ? `${lifecycle.daysRemaining} day${lifecycle.daysRemaining === 1 ? "" : "s"} remaining`
                        : `expired ${Math.abs(lifecycle.daysRemaining)} day${Math.abs(lifecycle.daysRemaining) === 1 ? "" : "s"} ago`}
                    </span>
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

function VerificationCard({
  verification,
}: {
  readonly verification: EntitlementVerificationView;
}): JSX.Element {
  return (
    <Card
      title="Entitlement verification"
      subtitle="The subscription reconciliation report — provision evidence against the agreed entitlement terms."
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
                  term: "Provisioned chains",
                  value: `${String(verification.provisionedChainCount)} of ${String(verification.chainCount)}`,
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
// The screen
// ---------------------------------------------------------------------------

/** The rendered software screen (catalog/entitlements with lifecycle states). */
export function SoftwareScreen(props: SoftwareScreenProps): JSX.Element {
  const { phase } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Software entitlements">
        <Skeleton label="Loading the software surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the software surface" />;
  } else if (ready === null) {
    body = null;
  } else {
    body = (
      <>
        {ready.needs !== null && <NeedsCard needs={ready.needs} />}
        {ready.catalog.rows.length === 0 ? (
          <EmptyState
            title="No subscriptions are allocated yet"
            hint="Software subscriptions allocate against a workload's requirement — the entitlement's lifecycle (revision, supersession, term) is displayed verbatim."
          />
        ) : (
          <EntitlementsCard catalog={ready.catalog} now={ready.now} />
        )}
        <VerificationCard verification={ready.verification} />
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Commerce — software">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Commerce" }, { label: "Software", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Software</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.catalog.total} entitlement${phase.view.catalog.total === 1 ? "" : "s"} · ${phase.view.catalog.totalSeats} seats · needs, lifecycle states and provision-verified outcomes`
              : "The software catalog: workload needs, allocated entitlements and verified outcomes."}
          </p>
        </div>
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <CommerceJourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
    </section>
  );
}
