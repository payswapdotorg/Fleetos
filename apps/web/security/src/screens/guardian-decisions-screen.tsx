/**
 * @fleetos/web-security — D1 rendered: the GuardianDecisionsScreen
 * (W090B).
 *
 * The React component layer over the EXISTING pure decision
 * view-models (`guardian-decision-view.ts` — logic untouched): the
 * Contract Guardian's decisions presented READ-ONLY — the decision
 * types (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK) with their
 * machine-stable reasons visible (verbatim, engine order), the
 * matched rules, the OPAQUE evidence refs, and the read-only BLOCK
 * history. Approvals are NOT taken here (they live in the approvals
 * queue — human transitions, never auto-promoted); the screen links
 * to it.
 *
 * A BLOCK decision VISUALLY STOPS the journey: the blocking semantics
 * render with the explicit "execution refused" disclosure and the
 * machine-stable refusal reasons.
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type {
  BlockHistoryView,
  GuardianDecisionPresentationView,
} from "../guardian-decision-view";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Card,
  EmptyState,
  PhasePresentation,
  StatusIndicator,
  Tabs,
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { decisionConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The composite decisions data (presentational — the binding site composes). */
export interface GuardianDecisionsData {
  /** The decision presentations (each built by `presentGuardianDecision`). */
  readonly presentations: readonly GuardianDecisionPresentationView[];
  /** The read-only BLOCK history (built by `buildBlockHistoryView`). */
  readonly blockHistory: BlockHistoryView;
}

/** The panel selection (fully controlled). */
export type GuardianPanel = "decisions" | "block-history";

export interface GuardianDecisionsScreenProps {
  /** The composite view phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<GuardianDecisionsData>;
  /** The active panel (controlled). */
  readonly panel: GuardianPanel;
  readonly onPanelChange: (panel: GuardianPanel) => void;
  /** The intent to open the approvals queue (approvals are human transitions). */
  readonly onOpenApprovals: () => void;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function DecisionCard(props: {
  readonly view: GuardianDecisionPresentationView;
  readonly onOpenApprovals: () => void;
}): JSX.Element {
  const { view } = props;
  return (
    <Card
      title={`Decision — ${view.decision}`}
      subtitle={`Decided ${view.decidedAt} · rule set ${view.ruleSetId ?? "—"} v${view.ruleSetVersion ?? "—"}`}
    >
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
        <StatusIndicator status={decisionConsoleStatus(view.decision)} />{" "}
        <Badge>{view.decision}</Badge>
        {view.isBlocking && (
          <span className="fos-meta" style={{ display: "block", marginTop: "0.35rem" }}>
            Blocking: execution is {view.decision === "BLOCK" ? "refused" : "held for human approval"}.
          </span>
        )}
      </p>
      {view.matchedRules.length > 0 && (
        <>
          <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>
            Matched rules (engine order)
          </p>
          <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1rem", fontSize: "0.8125rem" }}>
            {view.matchedRules.map((rule) => (
              <li key={rule.ruleId}>
                <span className="fos-mono">{rule.name}</span>{" "}
                <span className="fos-meta">
                  (v{rule.version} · {rule.effect})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {view.reasons.length > 0 && (
        <>
          <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>
            Machine-stable reasons (engine order, verbatim)
          </p>
          <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1rem", fontSize: "0.8125rem" }}>
            {view.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>
                <span className="fos-mono">{reason.code}</span>
                {reason.ruleId !== undefined && (
                  <span className="fos-meta">
                    {" "}
                    (rule <span className="fos-mono">{reason.ruleId}</span>
                    {reason.ruleVersion !== undefined ? ` v${reason.ruleVersion}` : ""})
                  </span>
                )}
                {reason.effect !== undefined && <span className="fos-meta"> · effect {reason.effect}</span>}
                {reason.chosen !== undefined && <span className="fos-meta"> · chose {reason.chosen}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="fos-meta" style={{ margin: 0 }}>
        Evidence: {view.evidence.length} opaque artifact(s) · schema v{view.schemaVersion}
        {view.decision === "REQUIRE_APPROVAL" && (
          <>
            {" · "}
            <button type="button" className="fos-linklike" onClick={props.onOpenApprovals}>
              Review in the approvals queue →
            </button>
          </>
        )}
      </p>
    </Card>
  );
}

function DecisionsPanel(props: {
  readonly data: GuardianDecisionsData;
  readonly onOpenApprovals: () => void;
}): JSX.Element {
  const { data } = props;
  if (data.presentations.length === 0) {
    return (
      <EmptyState
        title="No Guardian decisions recorded"
        hint="The Contract Guardian evaluates every consequential action request. Decisions appear here once the fleet acts."
      />
    );
  }
  return (
    <div className="fos-stack">
      {data.presentations.map((view) => (
        <DecisionCard key={`${view.decidedAt}-${view.precedenceRank}`} view={view} onOpenApprovals={props.onOpenApprovals} />
      ))}
    </div>
  );
}

function BlockHistoryPanel(props: { readonly history: BlockHistoryView }): JSX.Element {
  if (props.history.items.length === 0) {
    return (
      <EmptyState
        title="No BLOCK decisions in the history"
        hint="A BLOCK decision refuses an action outright. None have been recorded for this tenant."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Read-only BLOCK history, oldest first (machine-stable order)</caption>
        <thead>
          <tr>
            <th scope="col">Decision</th>
            <th scope="col">Decided at</th>
            <th scope="col">Rules that fired</th>
            <th scope="col">Evidence</th>
            <th scope="col">Canonical ref</th>
          </tr>
        </thead>
        <tbody>
          {props.history.items.map((item) => (
            <tr key={item.canonicalRef} data-testid={`block-${item.canonicalRef}`}>
              <td>
                <StatusIndicator status="blocked" />
                <br />
                <Badge>BLOCK</Badge>
              </td>
              <td>
                <span className="fos-mono fos-meta">{item.decidedAt}</span>
              </td>
              <td>
                {item.rules.length === 0 ? (
                  <span className="fos-meta">—</span>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
                    {item.rules.map((rule) => (
                      <li key={rule.ruleId}>
                        <span className="fos-mono">{rule.ruleId}</span>{" "}
                        <span className="fos-meta">v{rule.ruleVersion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                <span className="fos-meta">{item.evidence.length} artifact(s)</span>
              </td>
              <td>
                <span className="fos-mono fos-meta">{item.canonicalRef}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The GuardianDecisionsScreen: the Contract Guardian's decision area
 * (read-only; the machine-stable refusal reasons are always visible).
 */
export function GuardianDecisionsScreen(props: GuardianDecisionsScreenProps): JSX.Element {
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Security" }, { label: "Guardian decisions", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Contract Guardian decisions</h1>
          <p className="fos-screen-subtitle">
            Every decision the deterministic policy layer has made — the reasons are machine-stable
            and presented verbatim.
          </p>
        </div>
      </header>
      <Tabs
        tabs={[
          {
            id: "decisions",
            label: "Decisions",
            count: props.phase.kind === "ready" ? props.phase.view.presentations.length : undefined,
          },
          {
            id: "block-history",
            label: "BLOCK history",
            count: props.phase.kind === "ready" ? props.phase.view.blockHistory.total : undefined,
          },
        ]}
        activeId={props.panel}
        onChange={(id): void => props.onPanelChange(id as GuardianPanel)}
        ariaLabel="Guardian decision areas"
      />
      {props.phase.kind === "ready" ? (
        props.panel === "decisions" ? (
          <DecisionsPanel data={props.phase.view} onOpenApprovals={props.onOpenApprovals} />
        ) : (
          <BlockHistoryPanel history={props.phase.view.blockHistory} />
        )
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading Guardian decisions" />
      )}
      <Card>
        <p style={{ margin: 0, fontSize: "0.8125rem" }}>
          The Contract Guardian enforces explicit policy and never asserts unobservable employee
          intent. ALLOW and WARN permit execution; REQUIRE_APPROVAL holds it for a human decision;
          BLOCK refuses it. This surface is read-only — approvals are taken in the approvals queue.
        </p>
      </Card>
    </div>
  );
}
