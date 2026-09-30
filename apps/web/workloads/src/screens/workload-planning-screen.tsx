/**
 * @fleetos/web-workloads — D1 rendered: the WorkloadPlanningScreen
 * (W090C).
 *
 * The React component layer over the EXISTING pure view-models
 * (`listing.ts`, `recommendations.ts`, `resources.ts`, `state.ts` —
 * logic untouched): the whole workload-planning surface (plans,
 * recommendations, capacity signals) rendered by the EXISTING
 * `WorkloadSurfaceState` machine:
 *
 *   list      -> the workload-profile listing (deterministic rows);
 *   profile   -> the record-pattern detail (summary -> current state
 *                -> why it matters -> recommended action -> evidence
 *                -> history) + the Recommendations / Capacity-signal
 *                tabs;
 *   recommendation -> the versioned recommendation record view (the
 *                record pattern; DRAFT intent proposals presented as
 *                READ-ONLY descriptors — a proposal is NEVER
 *                presented as an executed action);
 *   resources -> the LOCK 12 capacity-signal view (hardware /
 *                software / connectivity / maintenance linkage rows
 *                with machine-stable statuses).
 *
 * The composite journey rail (D3) renders on every view when supplied
 * — navigation between THIS screen and the commerce screens flows
 * through `onOpenJourneyStage` (the shell routes by the stage's
 * machine-stable route target).
 *
 * Discipline: PRESENTATIONAL + FULLY CONTROLLED. The surface state,
 * the tab selection and the journey rail ALL arrive as props; every
 * user intent flows out through callbacks that the shell routes
 * through the established view-model reducers. No business truth in
 * React state.
 *
 * Exact states (first-class): loading skeletons, instructive zero
 * states (no profiles defined yet), actionable error alerts, the
 * invalid-build failure list, and the explicit approval/blocked
 * linkage semantics (PARKED -> "Approval required"; REJECTED ->
 * "Blocked").
 *
 * Deterministic: same props -> byte-identical JSX (asserted by test);
 * no clock, no randomness, no I/O — instants arrive from the
 * view-models.
 */

import type { JSX, ReactNode } from "react";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  EmptyState,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
  Tabs,
  Tooltip,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  fitConsoleStatus,
  journeyStageConsoleStatus,
  linkageConsoleStatus,
  recommendationConsoleStatus,
} from "../ui/status";
import type { ConsoleStatus } from "../ui/status";
import type { WorkloadSurfaceEvent, WorkloadSurfaceState } from "../state";
import type { WorkloadProfileListView, WorkloadProfileRowView } from "../listing";
import type {
  WorkloadRecommendationDisplayView,
  WorkloadRecommendationRowView,
} from "../recommendations";
import type { WorkloadResourceLinkageStatus, WorkloadResourceLinkageView } from "../resources";
import type { WorkloadProfileFacets } from "../seams";
import type { JourneyRailStageView } from "../journey";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The composed planning data (built by the shell from the EXISTING
 * builders): the tenant-scoped profile listing plus the selected
 * workload's detail (the full record + its recommendation ledger
 * display + its LOCK 12 resource linkage).
 */
export interface WorkloadPlanningData {
  readonly profiles: WorkloadProfileListView;
  /** The selected workload's detail (null in the list view). */
  readonly selected: {
    readonly profile: WorkloadProfileFacets;
    readonly recommendations: WorkloadRecommendationDisplayView;
    readonly linkage: WorkloadResourceLinkageView;
  } | null;
}

/** The profile-detail tab selection (fully controlled). */
export type WorkloadPlanningTab = "recommendations" | "capacity";

export interface WorkloadPlanningScreenProps {
  readonly phase: ScreenPhase<WorkloadPlanningData>;
  /** The EXISTING workload-surface state machine's current state. */
  readonly surface: WorkloadSurfaceState;
  /** Every user intent dispatched through the existing reducer. */
  readonly onSurfaceEvent: (event: WorkloadSurfaceEvent) => void;
  /** The selected profile-detail tab (profile view only). */
  readonly tab: WorkloadPlanningTab;
  readonly onTabChange: (tab: WorkloadPlanningTab) => void;
  /** The composite journey rail (D3), when the journey is active. */
  readonly journey: readonly JourneyRailStageView[] | null;
  /** Navigate to a journey stage (the shell routes by the stage target). */
  readonly onOpenJourneyStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// The journey rail (D3 — rendered on every view when supplied)
// ---------------------------------------------------------------------------

const JOURNEY_RAIL_TITLE = "Journey — workload plan to verified connectivity";

function JourneyRail({
  stages,
  onOpenStage,
}: {
  readonly stages: readonly JourneyRailStageView[];
  readonly onOpenStage: ((stageId: string) => void) | undefined;
}): JSX.Element {
  return (
    <Card title={JOURNEY_RAIL_TITLE} subtitle="Each stage shows its record and evidence; navigation follows the machine-stable stage order.">
      <ol className="fos-timeline" aria-label={JOURNEY_RAIL_TITLE}>
        {stages.map((stage) => {
          const markerState =
            stage.state === "blocked"
              ? "blocked"
              : stage.state === "current" || stage.state === "approval"
                ? "current"
                : stage.state === "done"
                  ? "done"
                  : "pending";
          const status = journeyStageConsoleStatus(stage.state);
          return (
            <li key={stage.stageId}>
              <span
                className={`fos-timeline__marker fos-timeline__marker--${markerState}`}
                aria-hidden="true"
              />
              <span className="fos-timeline__body">
                <span className="fos-timeline__label">
                  {stage.title}
                  <span style={{ marginLeft: "0.5rem" }}>
                    <StatusIndicator status={status} />
                  </span>
                </span>
                <span className="fos-timeline__detail">{stage.summary}</span>
                {stage.recordRef !== null && (
                  <span className="fos-timeline__detail">
                    Record: <span className="fos-mono">{stage.recordRef}</span>
                  </span>
                )}
                {stage.evidenceRefs.length > 0 && (
                  <span className="fos-timeline__detail">
                    Evidence: <span className="fos-mono">{stage.evidenceRefs.join(", ")}</span>
                  </span>
                )}
                {onOpenStage !== undefined && (
                  <span style={{ marginTop: "0.25rem" }}>
                    <Button
                      variant="ghost"
                      ariaLabel={`Open journey stage: ${stage.title}`}
                      onClick={(): void => onOpenStage(stage.stageId)}
                    >
                      Open stage →
                    </Button>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The profile listing (the list view)
// ---------------------------------------------------------------------------

const LIST_COLUMNS = "Columns: workload, kind, revision, requirement highlights, constraints, evidence, working hours.";

function ProfileListTable({
  view,
  onOpenProfile,
}: {
  readonly view: WorkloadProfileListView;
  readonly onOpenProfile: (workloadId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>
          Workload profiles — {view.total} defined, ordered by workload id
        </caption>
        <thead>
          <tr>
            <th scope="col">Workload</th>
            <th scope="col">Kind</th>
            <th scope="col">Revision</th>
            <th scope="col">Requirement highlights</th>
            <th scope="col">Constraints</th>
            <th scope="col">Evidence</th>
            <th scope="col">Working hours</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row: WorkloadProfileRowView) => (
            <tr key={row.workloadId} data-workload-id={row.workloadId}>
              <td>
                <button
                  type="button"
                  className="fos-linklike"
                  aria-label={`Open workload ${row.name} (${row.workloadId})`}
                  onClick={(): void => onOpenProfile(row.workloadId)}
                >
                  {row.name}
                </button>
                <br />
                <span className="fos-mono fos-meta">{row.workloadId}</span>
              </td>
              <td>{row.subjectKind}</td>
              <td>r{row.revision}</td>
              <td>
                {row.requirementHighlights.map((highlight) => (
                  <span key={highlight.dimension} style={{ display: "block" }}>
                    {highlight.dimension}: {highlight.value}
                  </span>
                ))}
                <span className="fos-meta">confidence {row.vectorConfidence}</span>
              </td>
              <td>
                <span style={{ display: "block" }}>
                  {row.constraints.requiredApplications} app
                  {row.constraints.requiredApplications === 1 ? "" : "s"}
                </span>
                <span style={{ display: "block" }}>
                  {row.constraints.environments} env · {row.constraints.peripherals} peripheral
                  {row.constraints.peripherals === 1 ? "" : "s"}
                </span>
                {row.constraints.classification !== null && (
                  <span style={{ display: "block" }}>
                    <Badge>{row.constraints.classification}</Badge>
                  </span>
                )}
              </td>
              <td>
                <Tooltip text="The evidence observation links behind this revision">
                  <span className="fos-mono fos-meta">{row.evidenceCount} links</span>
                </Tooltip>
              </td>
              <td>
                {row.workingHours === null ? (
                  <span className="fos-meta">Not declared</span>
                ) : (
                  <span className="fos-mono fos-meta">
                    {String(row.workingHours.startHour).padStart(2, "0")}:00–
                    {String(row.workingHours.endHour).padStart(2, "0")}:00
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The profile detail (the record pattern)
// ---------------------------------------------------------------------------

function ProfileDetail({
  profile,
  linkage,
  recommendations,
}: {
  readonly profile: WorkloadProfileFacets;
  readonly linkage: WorkloadResourceLinkageView;
  readonly recommendations: WorkloadRecommendationDisplayView;
}): JSX.Element {
  const active = recommendations.lineages.find((lineage) => lineage.status === "ACTIVE");
  return (
    <>
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Workload", value: profile.name },
            { term: "Description", value: profile.description },
            { term: "Subject kind", value: profile.subjectKind },
            { term: "Revision", value: `r${profile.revision}` },
            {
              term: "Content hash",
              value: <span className="fos-mono">{profile.contentHash}</span>,
            },
          ]}
        />
      </Card>
      <Card title="Current state">
        <DefinitionList
          entries={[
            {
              term: "Requirement vector",
              value: `v${profile.requirements.vectorVersion} · ${String(Object.keys(profile.requirements.values).length)} dimensions · confidence ${profile.requirements.confidence}`,
            },
            {
              term: "Constraints",
              value: `${profile.constraints.requiredApplications?.length ?? 0} required applications · ${profile.constraints.environments?.length ?? 0} environments · ${profile.constraints.peripherals?.length ?? 0} peripherals`,
            },
            {
              term: "Classification",
              value: profile.constraints.classification ?? "Unrestricted",
            },
            {
              term: "Working hours",
              value:
                profile.workingHours === undefined
                  ? "Not declared"
                  : `${String(profile.workingHours.startHour).padStart(2, "0")}:00–${String(profile.workingHours.endHour).padStart(2, "0")}:00`,
            },
            {
              term: "Linked resources",
              value: `${linkage.byKind["hardware"] ?? 0} hardware · ${linkage.byKind["software"] ?? 0} software · ${linkage.byKind["connectivity"] ?? 0} connectivity · ${linkage.byKind["maintenance"] ?? 0} maintenance`,
            },
          ]}
        />
      </Card>
      <Card title="Why it matters">
        <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
          The profile is the demand-side truth for planning: recommendations, software
          subscriptions, procurement demands and connectivity requests all cite it.{" "}
          {profile.evidence.length} evidence observation
          {profile.evidence.length === 1 ? " link" : " links"} back this revision
          {profile.constraints.classification !== undefined
            ? `; the ${profile.constraints.classification} classification constrains which candidates are eligible.`
            : "."}
        </p>
      </Card>
      <Card title="Recommended action">
        {active === undefined ? (
          <p className="fos-card-subtitle" style={{ marginBottom: 0 }}>
            No active recommendation lineage — run the recommendation engine for this profile
            to see device-class and procurement proposals.
          </p>
        ) : (
          <DefinitionList
            entries={[
              {
                term: "Active candidate",
                value: `${active.label} (${active.candidateId})`,
              },
              {
                term: "Ledger",
                value: `${String(recommendations.rows.length)} recommendation record${recommendations.rows.length === 1 ? "" : "s"} · ${String(recommendations.dismissals.length)} dismissal${recommendations.dismissals.length === 1 ? "" : "s"}`,
              },
              {
                term: "Next",
                value: "Open the Recommendations tab to inspect the versioned proposals and their draft intents.",
              },
            ]}
          />
        )}
      </Card>
      <Card title="Evidence" subtitle="The observation links that informed this revision (opaque refs, verbatim).">
        {profile.evidence.length === 0 ? (
          <EmptyState
            title="No evidence links on this revision"
            hint="Evidence observation links appear when observed factors inform a profile revision."
          />
        ) : (
          <ul>
            {profile.evidence.map((link) => (
              <li key={link.observationId}>
                <span className="fos-mono">{link.observationId}</span>
                {link.kind !== undefined ? ` · ${link.kind}` : ""}
                {link.note !== undefined ? ` · ${link.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="History" subtitle="Profiles are versioned and append-only: the revision and content hash below are the immutability evidence.">
        <DefinitionList
          entries={[
            { term: "Revision", value: `r${profile.revision}` },
            { term: "Created at", value: <span className="fos-mono">{profile.createdAt}</span> },
            { term: "Schema version", value: String(profile.schemaVersion) },
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The recommendations tab + the recommendation record view
// ---------------------------------------------------------------------------

function RecommendationRow({
  row,
  onOpen,
}: {
  readonly row: WorkloadRecommendationRowView;
  readonly onOpen: (recommendationId: string) => void;
}): JSX.Element {
  const status = recommendationConsoleStatus(row.status);
  const fit = fitConsoleStatus({
    meetsThreshold: row.fit.meetsThreshold,
    constraintsSatisfied: row.fit.constraintsSatisfied,
  });
  return (
    <tr data-recommendation-id={row.recommendationId}>
      <td>
        <button
          type="button"
          className="fos-linklike"
          aria-label={`Open recommendation ${row.label} (${row.recommendationId})`}
          onClick={(): void => onOpen(row.recommendationId)}
        >
          {row.label}
        </button>
        <br />
        <span className="fos-mono fos-meta">{row.recommendationId}</span>
      </td>
      <td>
        <StatusIndicator status={status} label={`${row.status} — ${CONSOLE_STATUS_LABEL[status]}`} />
        <br />
        <span className="fos-meta">v{row.recommendationVersion}</span>
      </td>
      <td>
        <StatusIndicator status={fit} label={`Fit ${row.fit.satisfaction} — ${CONSOLE_STATUS_LABEL[fit]}`} />
        <br />
        <span className="fos-meta">threshold {row.fit.threshold}</span>
        {row.fit.deficitDimensions.length > 0 && (
          <span className="fos-meta" style={{ display: "block" }}>
            deficits: {row.fit.deficitDimensions.join(", ")}
          </span>
        )}
      </td>
      <td>
        <span className="fos-meta">{row.proposedIntents.length} draft intent{row.proposedIntents.length === 1 ? "" : "s"}</span>
      </td>
      <td>
        <span className="fos-meta">{row.confidence}</span>
      </td>
    </tr>
  );
}

function RecommendationsTable({
  view,
  onOpen,
}: {
  readonly view: WorkloadRecommendationDisplayView;
  readonly onOpen: (recommendationId: string) => void;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Recommendation ledger — versioned records, the engine's order preserved</caption>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Status</th>
            <th scope="col">Fit</th>
            <th scope="col">Proposals</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <RecommendationRow key={row.recommendationId} row={row} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The recommendation RECORD view — the binding record pattern. */
export function RecommendationRecordCard({
  row,
  onBack,
}: {
  readonly row: WorkloadRecommendationRowView;
  readonly onBack: () => void;
}): JSX.Element {
  const status: ConsoleStatus = recommendationConsoleStatus(row.status);
  const fit = fitConsoleStatus({
    meetsThreshold: row.fit.meetsThreshold,
    constraintsSatisfied: row.fit.constraintsSatisfied,
  });
  return (
    <>
      <Card
        title="Summary"
        actions={
          <Button variant="secondary" onClick={onBack} ariaLabel="Back to the recommendations list">
            ← Back
          </Button>
        }
      >
        <DefinitionList
          entries={[
            { term: "Candidate", value: `${row.label} (${row.candidateId})` },
            { term: "Kind", value: row.kind },
            { term: "Confidence", value: String(row.confidence) },
            { term: "Recommendation id", value: <span className="fos-mono">{row.recommendationId}</span> },
          ]}
        />
      </Card>
      <Card title="Current state">
        <DefinitionList
          entries={[
            {
              term: "Interpretation",
              value: (
                <StatusIndicator
                  status={status}
                  label={`${row.status} — ${CONSOLE_STATUS_LABEL[status]}`}
                />
              ),
            },
            { term: "Version", value: `v${row.recommendationVersion} of the candidate lineage` },
            {
              term: "Supersedes",
              value: row.supersedes === null ? "None (first record)" : <span className="fos-mono">{row.supersedes}</span>,
            },
          ]}
        />
      </Card>
      <Card title="Why it matters">
        <p className="fos-card-subtitle" style={{ marginBottom: "0.5rem" }}>
          <StatusIndicator status={fit} label={`Fit satisfaction ${row.fit.satisfaction} — ${CONSOLE_STATUS_LABEL[fit]}`} />
        </p>
        <DefinitionList
          entries={[
            { term: "Threshold", value: `${row.fit.threshold} · ${row.fit.meetsThreshold ? "met" : "not met"}` },
            {
              term: "Hard gate",
              value: row.fit.constraintsSatisfied
                ? "Satisfied — every hard constraint passes"
                : `${String(row.fit.constraintFailures.length)} constraint failure${row.fit.constraintFailures.length === 1 ? "" : "s"}`,
            },
            ...(row.fit.worstDimension !== null
              ? [{ term: "Weakest dimension", value: `${row.fit.worstDimension}` }]
              : []),
          ]}
        />
        {row.fit.constraintFailures.length > 0 && (
          <ul style={{ marginTop: "0.5rem" }}>
            {row.fit.constraintFailures.map((failure, index) => (
              <li key={`${failure.kind}-${index}`}>
                <span className="fos-mono">{failure.kind}</span>
                {failure.detail.length > 0 ? ` — ${failure.detail}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recommended action">
        <p className="fos-card-subtitle" style={{ marginBottom: "0.5rem" }}>
          Draft intent proposals carried by this recommendation (READ-ONLY descriptors — the
          decision boundary belongs to the policy layer; a proposal is never an executed action):
        </p>
        {row.proposedIntents.length === 0 ? (
          <EmptyState
            title="No draft intents proposed"
            hint="This recommendation carries no procurement or software-subscription proposal."
          />
        ) : (
          <ul>
            {row.proposedIntents.map((proposal, index) => (
              <li key={`${proposal.intentKind}-${index}`}>
                <Badge>{proposal.intentKind}</Badge>
                {proposal.payloadSummary.length > 0 && (
                  <span className="fos-mono fos-meta" style={{ marginLeft: "0.4rem" }}>
                    {proposal.payloadSummary.join(" · ")}
                  </span>
                )}
                <span className="fos-meta" style={{ display: "block" }}>
                  Proposal — not executed: acceptance flows through the intent boundary.
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Evidence">
        <DefinitionList
          entries={[
            { term: "Rationale", value: row.rationale },
            { term: "Evidence links", value: String(row.evidenceCount) },
            { term: "Engine", value: `${row.engineVersion} (model v${row.modelVersion})` },
            { term: "Recommended at", value: <span className="fos-mono">{row.recommendedAt}</span> },
            { term: "Profile revision", value: `r${row.profileRevision}` },
          ]}
        />
      </Card>
      <Card title="History" subtitle="Recommendations are versioned and append-only: supersession is displayed, never rewritten.">
        <DefinitionList
          entries={[
            { term: "Lineage version", value: `v${row.recommendationVersion}` },
            {
              term: "Supersedes",
              value: row.supersedes === null ? "None" : <span className="fos-mono">{row.supersedes}</span>,
            },
            { term: "View version", value: String(row.viewVersion) },
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The capacity-signal views (the LOCK 12 resource linkage)
// ---------------------------------------------------------------------------

const CAPACITY_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  hardware: "Hardware",
  software: "Software",
  connectivity: "Connectivity",
  maintenance: "Maintenance",
} as const);

function LinkageStatusIndicator({ linkageStatus }: { readonly linkageStatus: string }): JSX.Element {
  const status = linkageConsoleStatus(linkageStatus as WorkloadResourceLinkageStatus);
  return (
    <StatusIndicator status={status} label={`${linkageStatus} — ${CONSOLE_STATUS_LABEL[status]}`} />
  );
}

function CapacitySignalsTable({
  linkage,
}: {
  readonly linkage: WorkloadResourceLinkageView;
}): JSX.Element {
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>
          Linked resources — hardware, software, connectivity and maintenance as first-class
          workload resources
        </caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Resource</th>
            <th scope="col">Linkage status</th>
            <th scope="col">Linked at</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {linkage.rows.map((row) => (
            <tr key={`${row.kind}-${row.resourceId}`} data-linkage-kind={row.kind}>
              <td>{CAPACITY_KIND_LABEL[row.kind] ?? row.kind}</td>
              <td>
                {row.label ?? row.resourceId}
                <br />
                <span className="fos-mono fos-meta">{row.resourceId}</span>
              </td>
              <td><LinkageStatusIndicator linkageStatus={row.linkageStatus} /></td>
              <td>
                {row.linkedAt === null ? (
                  <span className="fos-meta">—</span>
                ) : (
                  <span className="fos-mono fos-meta">{row.linkedAt}</span>
                )}
              </td>
              <td>
                {row.details.map((field) => (
                  <span key={field.key} style={{ display: "block" }} className="fos-meta">
                    <span className="fos-mono">{field.key}</span>: {field.value}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapacitySignals({
  linkage,
}: {
  readonly linkage: WorkloadResourceLinkageView;
}): JSX.Element {
  return (
    <>
      <Card title="Capacity signals" subtitle="Counts by first-class resource kind (LOCK 12).">
        <div className="fos-row">
          {Object.entries(CAPACITY_KIND_LABEL).map(([kind, label]) => (
            <Badge key={kind}>
              {label}: {linkage.byKind[kind] ?? 0}
            </Badge>
          ))}
        </div>
      </Card>
      {linkage.rows.length === 0 ? (
        <EmptyState
          title="No resources are linked to this workload yet"
          hint="Linked hardware classes, software subscriptions, connectivity submissions and maintenance work orders appear here as the plan is executed."
        />
      ) : (
        <Card title="Linked resources" subtitle="Status semantics: PARKED means an approval is required; REJECTED means blocked.">
          <CapacitySignalsTable linkage={linkage} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const PLANNING_BREADCRUMB = "Workloads";

/** The rendered workload-planning screen (plans, recommendations, capacity signals). */
export function WorkloadPlanningScreen(props: WorkloadPlanningScreenProps): JSX.Element {
  const { phase, surface } = props;
  const ready = phase.kind === "ready" ? phase.view : null;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Workload plans">
        <Skeleton label="Loading the workload planning surface" rows={6} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the workload planning surface" />;
  } else if (ready === null) {
    body = null;
  } else if (surface.view === "list" || ready.selected === null) {
    body =
      ready.profiles.rows.length === 0 ? (
        <EmptyState
          title="No workload profiles are defined yet"
          hint="A workload profile describes what a role or process requires — the demand-side truth that recommendations, software subscriptions, procurement demands and connectivity requests cite. Define the first profile to start planning."
        />
      ) : (
        <Card title="Workload plans" subtitle={LIST_COLUMNS}>
          <ProfileListTable
            view={ready.profiles}
            onOpenProfile={(workloadId): void =>
              props.onSurfaceEvent({ type: "select_profile", workloadId })
            }
          />
        </Card>
      );
  } else {
    const selected = ready.selected;
    if (surface.view === "recommendation") {
      const row = selected.recommendations.rows.find(
        (candidate) => candidate.recommendationId === surface.recommendationId,
      );
      body = row === undefined ? (
        <EmptyState
          title="The recommendation record is not in this ledger"
          hint="Open the workload's Recommendations tab and select a record from the versioned ledger."
        />
      ) : (
        <RecommendationRecordCard
          row={row}
          onBack={(): void => props.onSurfaceEvent({ type: "back" })}
        />
      );
    } else if (surface.view === "resources") {
      // The resources view: capacity signals under the header breadcrumb
      // (the single nav landmark — no body-level duplicate).
      body = (
        <>
          <CapacitySignals linkage={selected.linkage} />
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the workload profile"
          >
            ← Back to profile
          </Button>
        </>
      );
    } else {
      // The profile view: record pattern + the Recommendations / Capacity tabs.
      const recommendationCount = selected.recommendations.rows.length;
      body = (
        <>
          <ProfileDetail
            profile={selected.profile}
            linkage={selected.linkage}
            recommendations={selected.recommendations}
          />
          <Tabs
            ariaLabel="Workload detail panels"
            activeId={props.tab}
            onChange={(id): void => props.onTabChange(id as WorkloadPlanningTab)}
            tabs={[
              { id: "recommendations", label: "Recommendations", count: recommendationCount },
              { id: "capacity", label: "Capacity signals", count: selected.linkage.rows.length },
            ]}
          />
          {props.tab === "recommendations" ? (
            recommendationCount === 0 ? (
              <EmptyState
                title="No recommendations for this workload yet"
                hint="The recommendation engine proposes device classes and procurement candidates against the profile's requirement vector; versioned records appear here with their fit evidence and draft intents."
              />
            ) : (
              <Card
                title="Recommendations"
                subtitle="Versioned proposals — the engine's rank order preserved; statuses are derived from the ledger."
              >
                <RecommendationsTable
                  view={selected.recommendations}
                  onOpen={(recommendationId): void =>
                    props.onSurfaceEvent({ type: "open_recommendation", recommendationId })
                  }
                />
              </Card>
            )
          ) : (
            <CapacitySignals linkage={selected.linkage} />
          )}
        </>
      );
    }
  }

  const breadcrumb =
    phase.kind === "ready" && surface.view !== "list" && phase.view.selected !== null
      ? [
          { label: PLANNING_BREADCRUMB },
          surface.view === "resources"
            ? { label: phase.view.selected.profile.name }
            : { label: phase.view.selected.profile.name, current: surface.view === "profile" },
          ...(surface.view === "recommendation"
            ? [{ label: "Recommendation", current: true }]
            : surface.view === "resources"
              ? [{ label: "Capacity signals", current: true }]
              : []),
        ]
      : [{ label: PLANNING_BREADCRUMB }, { label: "Planning", current: true }];

  return (
    <section className="fos-scope fos-screen" aria-label="Workloads — planning">
      <ConsoleStyles />
      <Breadcrumb items={breadcrumb} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Workload planning</h1>
          <p className="fos-screen-subtitle">
            {phase.kind === "ready"
              ? `${phase.view.profiles.total} workload profile${phase.view.profiles.total === 1 ? "" : "s"} defined · plans, versioned recommendations and capacity signals`
              : "The planning surface: workload profiles, recommendations and capacity signals."}
          </p>
        </div>
        {phase.kind === "ready" && surface.view !== "list" && (
          <Button
            variant="secondary"
            onClick={(): void => props.onSurfaceEvent({ type: "back" })}
            ariaLabel="Back to the workload list"
          >
            ← All workloads
          </Button>
        )}
      </header>
      {props.journey !== null && props.journey.length > 0 && (
        <JourneyRail stages={props.journey} onOpenStage={props.onOpenJourneyStage} />
      )}
      {body}
    </section>
  );
}
