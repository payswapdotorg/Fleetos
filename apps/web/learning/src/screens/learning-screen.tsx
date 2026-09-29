/**
 * @fleetos/web-learning — D3 rendered: the LearningScreen (W090B).
 *
 * The React component layer over the pure learning view-models
 * (`learning-view.ts` — logic pure and seam-injected). The screen is
 * the first-class Learning/Arena area (the UX simulation's ❌ gap):
 * evaluation cases, the capability adoption ledger with certification
 * state, and the outcome observation feed — with arena capability
 * inspection in a detail sheet.
 *
 * Presentation rules (frozen):
 *   - Three tabbed panels (fully controlled `LearningPanelState`):
 *     Evaluation cases / Adoption ledger / Outcome feed.
 *   - Evaluation cases render their DISPOSITION with the console
 *     vocabulary (PROPOSED -> Informational, PARKED -> Approval
 *     required — held for human review, never auto-submitted,
 *     REJECTED -> Blocked), the problem class, the labels, and the
 *     REDACTION STATE (the typed record, never a guessed flag).
 *   - The adoption ledger renders the VERSIONED revision chain with
 *     supersession visible (each revision cites the recordId it
 *     supersedes; the prior is never rewritten) and the certification
 *     state (the Arena `acr_` reference + the compatibility
 *     statement) + the EXPLICIT human grant (approver + instant) on
 *     every revision.
 *   - The invariant disclosure is always visible: uncertified model
 *     output NEVER becomes action permission (LOCK 4/16).
 *   - Exact empty/loading/error/invalid states (design contract):
 *     loading = skeletons; empty = instructive zero states; error =
 *     actionable alerts; invalid = the machine-stable failure list.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 * Presentational only: props in, JSX out — no business truth in
 * React state; every tab/detail selection arrives as a prop and
 * every user intent leaves through a callback.
 */

import type { JSX } from "react";
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
  Tabs,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import {
  adoptionConsoleStatus,
  compatibilityConsoleStatus,
  dispositionConsoleStatus,
  guardianConsoleStatus,
  redactionConsoleStatus,
} from "../ui/status";
import type {
  AdoptionEntryView,
  AdoptionLedgerView,
  EvaluationCasesView,
  OutcomeFeedView,
} from "../learning-view";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The panel selection (fully controlled — never internal state). */
export type LearningPanel = "cases" | "ledger" | "feed";

/** All panels (canonical order; the tab descriptors derive from this). */
export const LEARNING_PANELS: readonly LearningPanel[] = Object.freeze([
  "cases",
  "ledger",
  "feed",
] as const);

export interface LearningScreenProps {
  /** The evaluation-cases view phase (loading/error/invalid/ready). */
  readonly casesPhase: ScreenPhase<EvaluationCasesView>;
  /** The adoption-ledger view phase. */
  readonly ledgerPhase: ScreenPhase<AdoptionLedgerView>;
  /** The outcome-feed view phase. */
  readonly feedPhase: ScreenPhase<OutcomeFeedView>;
  /** The active panel (controlled). */
  readonly panel: LearningPanel;
  readonly onPanelChange: (panel: LearningPanel) => void;
  /** The adoption whose detail sheet is open (controlled; null = closed). */
  readonly openAdoptionId: string | null;
  readonly onOpenAdoption: (adoptionId: string) => void;
  readonly onCloseAdoption: () => void;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function CasesPanel({ view }: { readonly view: EvaluationCasesView }): JSX.Element {
  if (view.items.length === 0) {
    return (
      <EmptyState
        title="No evaluation cases yet"
        hint="Evaluation cases are converted from recorded outcome observations and gated by the Contract Guardian. When outcomes are observed and gated, the submission proposals appear here with their disposition, labels and redaction state."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Evaluation-case submission proposals, ordered by proposal id</caption>
        <thead>
          <tr>
            <th scope="col">Proposal</th>
            <th scope="col">Problem class</th>
            <th scope="col">Disposition</th>
            <th scope="col">Guardian gate</th>
            <th scope="col">Outcome ground truth</th>
            <th scope="col">Labels</th>
            <th scope="col">Redaction</th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((item) => (
            <tr key={item.proposalId} data-testid={`eval-case-${item.proposalId}`}>
              <td>
                <span className="fos-mono">{item.proposalId}</span>
                <br />
                <span className="fos-meta">from {item.sourceObservationId}</span>
              </td>
              <td>
                <span className="fos-mono">{item.problemClass}</span>
                <br />
                <span className="fos-meta">{item.tenantPolicyCount} tenant policy ref(s)</span>
              </td>
              <td>
                <StatusIndicator status={dispositionConsoleStatus(item.disposition)} />
                <br />
                <Badge>{item.disposition}</Badge>
                {item.disposition === "PARKED" && (
                  <span className="fos-meta" style={{ display: "block" }}>
                    Held for human review — never auto-submitted
                  </span>
                )}
              </td>
              <td>
                <StatusIndicator
                  status={guardianConsoleStatus(item.gateDecision as "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK")}
                />
                <br />
                <Badge>{item.gateDecision}</Badge>
                <br />
                <span className="fos-meta fos-mono">{item.decidedAt}</span>
              </td>
              <td>
                <span className="fos-mono">{item.outcomeLabel}</span>
                <br />
                <span className="fos-meta">{item.outcomeValue}</span>
              </td>
              <td>
                {item.labels.length === 0 ? (
                  <span className="fos-meta">—</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
                    {item.labels.map((label) => (
                      <li key={label.key}>
                        <span className="fos-mono">{label.key}</span>={label.value}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                <StatusIndicator status={redactionConsoleStatus(item.redactionState)} />
                <br />
                <Badge>{item.redactionState}</Badge>
                {item.redactionPolicies.length > 0 && (
                  <span className="fos-meta" style={{ display: "block" }}>
                    {item.redactionPolicies.length} governing policy ref(s)
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

function LedgerPanel(props: {
  readonly view: AdoptionLedgerView;
  readonly onOpenAdoption: (adoptionId: string) => void;
}): JSX.Element {
  const { view, onOpenAdoption } = props;
  if (view.items.length === 0) {
    return (
      <EmptyState
        title="No capability adoptions yet"
        hint="Adoption happens only through an explicit, human-approved proposal over a CERTIFIED Arena capability. When a capability is adopted, the versioned ledger entry appears here with its certification reference and supersession lineage."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Capability adoption ledger, ordered by adoption id</caption>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Current revision</th>
            <th scope="col">Certification</th>
            <th scope="col">Compatibility</th>
            <th scope="col">Rollout</th>
            <th scope="col">Human grant</th>
            <th scope="col">Inspect</th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((entry) => (
            <tr key={entry.adoptionId} data-testid={`adoption-${entry.adoptionId}`}>
              <td>
                <span className="fos-mono">{entry.capabilityId}</span>
                <br />
                <span className="fos-meta">
                  {entry.capabilityClass ?? "uncategorized"} · rollback to {entry.rollbackVersion}
                </span>
              </td>
              <td>
                <StatusIndicator status={adoptionConsoleStatus("ACTIVE", true)} />
                <br />
                <Badge>{`v${entry.latestVersion} (of ${entry.revisionCount})`}</Badge>
                <br />
                <span className="fos-meta fos-mono">capability {entry.latestCapabilityVersion}</span>
                {entry.revisionCount > 1 && (
                  <span className="fos-meta" style={{ display: "block" }}>
                    Supersession visible in the revision chain
                  </span>
                )}
              </td>
              <td>
                <span className="fos-mono">{entry.certificationRef}</span>
                <br />
                <span className="fos-meta">suite {entry.evaluationSuiteRevision}</span>
              </td>
              <td>
                <StatusIndicator
                  status={compatibilityConsoleStatus(entry.compatibilityStatement)}
                />
                <br />
                <Badge>{entry.compatibilityStatement}</Badge>
                {entry.warnings.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {entry.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td>{entry.rolloutSummary}</td>
              <td>
                <span className="fos-mono">{entry.approverId}</span>
                <br />
                <span className="fos-meta fos-mono">{entry.approvedAt}</span>
              </td>
              <td>
                <Button
                  variant="secondary"
                  onClick={(): void => onOpenAdoption(entry.adoptionId)}
                  ariaLabel={`Inspect capability adoption ${entry.capabilityId}`}
                >
                  Inspect
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeedPanel({ view }: { readonly view: OutcomeFeedView }): JSX.Element {
  if (view.items.length === 0) {
    return (
      <EmptyState
        title="No outcome observations yet"
        hint="Outcome observations are the learning loop's intake: health-treatment outcomes, action-plan outcomes, delivery outcomes and maintenance work-order outcomes. When surfaces record outcomes, the feed appears here."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Outcome observation feed, oldest first (machine-stable order)</caption>
        <thead>
          <tr>
            <th scope="col">Observation</th>
            <th scope="col">Source surface</th>
            <th scope="col">Subject</th>
            <th scope="col">Problem class</th>
            <th scope="col">Ground truth</th>
            <th scope="col">Evidence</th>
            <th scope="col">Observed at</th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((item) => (
            <tr key={item.observationId} data-testid={`outcome-${item.observationId}`}>
              <td>
                <span className="fos-mono">{item.observationId}</span>
                {item.deviceId !== undefined && (
                  <span className="fos-meta" style={{ display: "block" }}>
                    device <span className="fos-mono">{item.deviceId}</span>
                  </span>
                )}
              </td>
              <td>
                <Badge>{item.sourceSurface}</Badge>
              </td>
              <td>
                <span className="fos-mono">{item.subjectRef}</span>
              </td>
              <td>
                <span className="fos-mono">{item.problemClass}</span>
              </td>
              <td>
                <span className="fos-mono">{item.outcome.label}</span>
                <br />
                <span className="fos-meta">{item.outcome.value}</span>
              </td>
              <td>
                <span className="fos-meta">
                  {item.evidenceCount} artifact(s) · {item.actionHistoryCount} action ref(s)
                </span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{item.observedAt}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The adoption detail sheet (arena capability inspection)
// ---------------------------------------------------------------------------

function AdoptionDetailSheet(props: {
  readonly entry: AdoptionEntryView;
  readonly onClose: () => void;
}): JSX.Element {
  const { entry, onClose } = props;
  return (
    <div className="fos-scrim fos-scrim--end">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Capability adoption ${entry.capabilityId}`}
        tabIndex={-1}
        className="fos-sheet"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="fos-sheet__header">
          <h2 className="fos-sheet__title">Capability adoption</h2>
          <button
            type="button"
            className="fos-btn fos-btn--ghost"
            aria-label="Close capability inspection"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <Card title="Certified capability" subtitle="The Arena certification this adoption consumed">
          <DefinitionList
            entries={[
              { term: "Capability", value: <span className="fos-mono">{entry.capabilityId}</span> },
              { term: "Class", value: entry.capabilityClass ?? "uncategorized" },
              { term: "Adopted version", value: <span className="fos-mono">{entry.latestCapabilityVersion}</span> },
              { term: "Certification ref", value: <span className="fos-mono">{entry.certificationRef}</span> },
              { term: "Evaluation suite", value: <span className="fos-mono">{entry.evaluationSuiteRevision}</span> },
              {
                term: "Compatibility",
                value: (
                  <span className="fos-row">
                    <StatusIndicator
                      status={compatibilityConsoleStatus(entry.compatibilityStatement)}
                    />
                    <Badge>{entry.compatibilityStatement}</Badge>
                  </span>
                ),
              },
              { term: "Rollout", value: entry.rolloutSummary },
              { term: "Cohort", value: entry.cohort },
              { term: "Rollback version", value: <span className="fos-mono">{entry.rollbackVersion}</span> },
            ]}
          />
        </Card>
        <Card title="Revision chain" subtitle="Append-only — every revision cites the prior; the prior is never rewritten">
          <ol className="fos-timeline" aria-label="Adoption revision chain">
            {entry.revisions.map((revision) => {
              const isLatest = revision.version === entry.latestVersion;
              return (
                <li key={revision.recordId}>
                  <span
                    className={`fos-timeline__marker fos-timeline__marker--${isLatest ? "current" : "done"}`}
                    aria-hidden="true"
                  />
                  <span className="fos-timeline__body">
                    <span className="fos-timeline__label">
                      Revision v{revision.version}{" — "}
                      <StatusIndicator
                        status={adoptionConsoleStatus(revision.status, isLatest)}
                      />
                      <Badge>
                        {isLatest
                          ? "CURRENT"
                          : revision.supersededBy !== null
                            ? "SUPERSEDED"
                            : revision.status}
                      </Badge>
                    </span>
                    <span className="fos-timeline__detail">
                      record <span className="fos-mono">{revision.recordId}</span>
                    </span>
                    <span className="fos-timeline__detail">
                      capability <span className="fos-mono">{revision.capabilityVersion}</span> · certification{" "}
                      <span className="fos-mono">{revision.certificationRef}</span>
                    </span>
                    <span className="fos-timeline__detail">
                      approved by <span className="fos-mono">{revision.approverId}</span> at{" "}
                      <span className="fos-mono">{revision.approvedAt}</span> · adopted{" "}
                      <span className="fos-mono">{revision.adoptedAt}</span>
                    </span>
                    {revision.supersedes !== undefined && (
                      <span className="fos-timeline__detail">
                        supersedes <span className="fos-mono">{revision.supersedes}</span>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
        <Card>
          <p style={{ margin: 0, fontSize: "0.8125rem" }}>
            Uncertified model output never becomes action permission: adoption consumed ONLY the
            certified capability metadata above, through the explicit human grant recorded on every
            revision.
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
 * The LearningScreen: the first-class Learning/Arena area. Fully
 * controlled (tab + detail selection are props); the three view
 * phases are independent (each panel owns its exact
 * loading/error/invalid/ready state).
 */
export function LearningScreen(props: LearningScreenProps): JSX.Element {
  const tabs = [
    { id: "cases", label: "Evaluation cases", count: props.casesPhase.kind === "ready" ? props.casesPhase.view.total : undefined },
    { id: "ledger", label: "Adoption ledger", count: props.ledgerPhase.kind === "ready" ? props.ledgerPhase.view.total : undefined },
    { id: "feed", label: "Outcome feed", count: props.feedPhase.kind === "ready" ? props.feedPhase.view.total : undefined },
  ];
  const openEntry =
    props.ledgerPhase.kind === "ready" && props.openAdoptionId !== null
      ? props.ledgerPhase.view.items.find((entry) => entry.adoptionId === props.openAdoptionId)
      : undefined;
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "FleetOS" }, { label: "Learning", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Learning</h1>
          <p className="fos-screen-subtitle">
            Evaluation cases, capability adoption and certification state — what FleetOS has learned
            from fleet outcomes.
          </p>
        </div>
      </header>
      <Tabs
        tabs={tabs}
        activeId={props.panel}
        onChange={(id): void => props.onPanelChange(id as LearningPanel)}
        ariaLabel="Learning areas"
      />
      {props.panel === "cases" &&
        (props.casesPhase.kind === "ready" ? (
          <CasesPanel view={props.casesPhase.view} />
        ) : (
          <PhasePresentation phase={props.casesPhase} loadingLabel="Loading evaluation cases" />
        ))}
      {props.panel === "ledger" &&
        (props.ledgerPhase.kind === "ready" ? (
          <LedgerPanel view={props.ledgerPhase.view} onOpenAdoption={props.onOpenAdoption} />
        ) : (
          <PhasePresentation phase={props.ledgerPhase} loadingLabel="Loading adoption ledger" />
        ))}
      {props.panel === "feed" &&
        (props.feedPhase.kind === "ready" ? (
          <FeedPanel view={props.feedPhase.view} />
        ) : (
          <PhasePresentation phase={props.feedPhase} loadingLabel="Loading outcome feed" />
        ))}
      <Card>
        <p style={{ margin: 0, fontSize: "0.8125rem" }}>
          Arena owns capability learning and certification; FleetOS owns operational adoption.
          Uncertified model output never becomes action permission — every adoption cites a
          certified capability and an explicit human approval.
        </p>
      </Card>
      {openEntry !== undefined && (
        <AdoptionDetailSheet entry={openEntry} onClose={props.onCloseAdoption} />
      )}
    </div>
  );
}
