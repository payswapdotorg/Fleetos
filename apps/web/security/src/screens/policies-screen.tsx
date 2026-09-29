/**
 * @fleetos/web-security — D1.2 rendered: the PoliciesScreen (W090B).
 *
 * The React component layer over the pure policies view-model
 * (`policies-view.ts`): Policies as a FIRST-CLASS rendered area (the
 * UX simulation's 🟡 gap) — the policy list (versioned rule sets with
 * per-effect rule counts), the policy detail (the member rules with
 * their OPAQUE canonical condition summaries, effects, versions and
 * enabled state), and the decision history (the policy outcomes that
 * actually fired, read-only).
 *
 * READ-ONLY rendering of FROZEN policy surfaces: the screen carries no
 * edit/enable/disable control — policy editing is separate from
 * decision execution and preserves versioned audit evidence (the
 * W031/W041 discipline; the screen states this invariant).
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type {
  PoliciesListView,
  PolicyDecisionHistoryView,
  PolicyDetailView,
} from "../policies-view";
import { ConsoleStyles } from "../ui/tokens";
import {
  Badge,
  Breadcrumb,
  Button,
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

/** The panel selection (fully controlled). */
export type PoliciesPanel = "sets" | "history";

export interface PoliciesScreenProps {
  /** The policies list view phase (loading/error/invalid/ready). */
  readonly listPhase: ScreenPhase<PoliciesListView>;
  /** The policy detail phase (null view inside ready = no set open). */
  readonly detailPhase: ScreenPhase<PolicyDetailView | undefined>;
  /** The decision history view phase. */
  readonly historyPhase: ScreenPhase<PolicyDecisionHistoryView>;
  /** The active panel (controlled). */
  readonly panel: PoliciesPanel;
  readonly onPanelChange: (panel: PoliciesPanel) => void;
  /** The rule set whose detail sheet is open (controlled; null = closed). */
  readonly openSetId: string | null;
  readonly onOpenSet: (ruleSetId: string) => void;
  readonly onCloseSet: () => void;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function SetsPanel(props: {
  readonly view: PoliciesListView;
  readonly onOpenSet: (ruleSetId: string) => void;
}): JSX.Element {
  if (props.view.items.length === 0) {
    return (
      <EmptyState
        title="No policy sets compiled"
        hint="Policy sets are compiled from versioned Contract Guardian rules. When the tenant compiles its first rule set, the frozen policy surface appears here (read-only)."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Policy sets (versioned rule sets), ordered by rule-set id</caption>
        <thead>
          <tr>
            <th scope="col">Rule set</th>
            <th scope="col">Version</th>
            <th scope="col">Compiled</th>
            <th scope="col">Rules</th>
            <th scope="col">Effects</th>
            <th scope="col">Inspect</th>
          </tr>
        </thead>
        <tbody>
          {props.view.items.map((item) => (
            <tr key={item.ruleSetId} data-testid={`policyset-${item.ruleSetId}`}>
              <td>
                <span className="fos-mono">{item.ruleSetId}</span>
              </td>
              <td>v{item.version}</td>
              <td>
                <span className="fos-mono fos-meta">{item.compiledAt}</span>
              </td>
              <td>
                {item.enabledCount} enabled
                <span className="fos-meta" style={{ display: "block" }}>
                  of {item.ruleCount} total
                </span>
              </td>
              <td>
                <span className="fos-meta">
                  {item.effectCounts.ALLOW} ALLOW · {item.effectCounts.WARN} WARN ·{" "}
                  {item.effectCounts.REQUIRE_APPROVAL} REQUIRE_APPROVAL · {item.effectCounts.BLOCK}{" "}
                  BLOCK
                </span>
              </td>
              <td>
                <Button
                  variant="secondary"
                  onClick={(): void => props.onOpenSet(item.ruleSetId)}
                  ariaLabel={`Inspect policy set ${item.ruleSetId}`}
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

function HistoryPanel(props: { readonly view: PolicyDecisionHistoryView }): JSX.Element {
  if (props.view.items.length === 0) {
    return (
      <EmptyState
        title="No policy decisions recorded"
        hint="Every consequential action request is evaluated by the Contract Guardian. The decision history appears here once the fleet acts."
      />
    );
  }
  return (
    <div className="fos-table-wrap">
      <table className="fos-table">
        <caption>Decision history (read-only), oldest first</caption>
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
          {props.view.items.map((item) => (
            <tr key={item.canonicalRef} data-testid={`decision-${item.canonicalRef}`}>
              <td>
                <StatusIndicator status={decisionConsoleStatus(item.decision)} />
                <br />
                <Badge>{item.decision}</Badge>
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
// The detail sheet
// ---------------------------------------------------------------------------

function PolicySetSheet(props: {
  readonly detail: PolicyDetailView;
  readonly onClose: () => void;
}): JSX.Element {
  const { detail } = props;
  return (
    <div className="fos-scrim fos-scrim--end">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Policy set ${detail.ruleSetId}`}
        tabIndex={-1}
        className="fos-sheet"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <div className="fos-sheet__header">
          <h2 className="fos-sheet__title">Policy set</h2>
          <button
            type="button"
            className="fos-btn fos-btn--ghost"
            aria-label="Close policy set detail"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <Card title="Rule set" subtitle="Read-only — the compiled, frozen surface">
          <dl className="fos-definition">
            <dt>Rule set</dt>
            <dd>
              <span className="fos-mono">{detail.ruleSetId}</span>
            </dd>
            <dt>Version</dt>
            <dd>v{detail.version}</dd>
            <dt>Compiled at</dt>
            <dd>
              <span className="fos-mono">{detail.compiledAt}</span>
            </dd>
            <dt>Content digest</dt>
            <dd>
              <span className="fos-mono">{detail.contentDigest}</span>
            </dd>
          </dl>
        </Card>
        <Card title="Rules" subtitle="Ordered by rule id — conditions are opaque canonical summaries">
          {detail.rules.length === 0 ? (
            <p className="fos-meta" style={{ margin: 0 }}>
              This rule set has no member rules.
            </p>
          ) : (
            <div className="fos-table-wrap">
              <table className="fos-table">
                <caption>Member rules</caption>
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Effect</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Version</th>
                    <th scope="col">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rules.map((rule) => (
                    <tr key={rule.ruleId} data-testid={`rule-${rule.ruleId}`}>
                      <td>
                        {rule.name}
                        <br />
                        <span className="fos-mono fos-meta">{rule.ruleId}</span>
                        {rule.description !== undefined && (
                          <span className="fos-meta" style={{ display: "block" }}>
                            {rule.description}
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusIndicator status={decisionConsoleStatus(rule.effect)} />
                        <br />
                        <Badge>{rule.effect}</Badge>
                      </td>
                      <td>
                        <span className="fos-mono fos-meta">{rule.conditionKind}</span>
                        <br />
                        <span className="fos-mono fos-meta">{rule.conditionSummary}</span>
                      </td>
                      <td>
                        v{rule.version}
                        {rule.revisedAt !== undefined && (
                          <span className="fos-meta" style={{ display: "block" }}>
                            revised {rule.revisedAt}
                          </span>
                        )}
                      </td>
                      <td>{rule.enabled ? "Yes" : "No (kept for history)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <p style={{ margin: 0, fontSize: "0.8125rem" }}>
            Policy editing is separate from decision execution: this surface renders the frozen
            policy as compiled, preserving the versioned audit evidence. Disabled rules never fire
            and are kept for history — deletion never happens.
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
 * The PoliciesScreen: Policies as a first-class area — the frozen
 * policy surfaces rendered read-only.
 */
export function PoliciesScreen(props: PoliciesScreenProps): JSX.Element {
  const openDetail =
    props.detailPhase.kind === "ready" && props.detailPhase.view !== undefined
      ? props.detailPhase.view
      : undefined;
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Policies", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Policies</h1>
          <p className="fos-screen-subtitle">
            The Contract Guardian's frozen policy surfaces — rule sets, their rules, and the
            decisions they produced. Read-only.
          </p>
        </div>
      </header>
      <Tabs
        tabs={[
          {
            id: "sets",
            label: "Policy sets",
            count: props.listPhase.kind === "ready" ? props.listPhase.view.total : undefined,
          },
          {
            id: "history",
            label: "Decision history",
            count: props.historyPhase.kind === "ready" ? props.historyPhase.view.total : undefined,
          },
        ]}
        activeId={props.panel}
        onChange={(id): void => props.onPanelChange(id as PoliciesPanel)}
        ariaLabel="Policies areas"
      />
      {props.panel === "sets" &&
        (props.listPhase.kind === "ready" ? (
          <SetsPanel view={props.listPhase.view} onOpenSet={props.onOpenSet} />
        ) : (
          <PhasePresentation phase={props.listPhase} loadingLabel="Loading policy sets" />
        ))}
      {props.panel === "history" &&
        (props.historyPhase.kind === "ready" ? (
          <HistoryPanel view={props.historyPhase.view} />
        ) : (
          <PhasePresentation phase={props.historyPhase} loadingLabel="Loading decision history" />
        ))}
      {openDetail !== undefined && (
        <PolicySetSheet detail={openDetail} onClose={props.onCloseSet} />
      )}
    </div>
  );
}
