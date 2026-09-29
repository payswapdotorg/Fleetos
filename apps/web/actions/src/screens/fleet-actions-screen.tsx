/**
 * @fleetos/web-actions — D2 rendered: the FleetActionsScreen (W090B).
 *
 * The React component layer over the EXISTING pure action-plan
 * view-models (`action-plans-view.ts` — logic untouched): the
 * first-class FLEET-ACTION JOURNEY (the UX simulation's 🟡 gap) —
 *
 *   intent -> proposal -> Guardian gate -> (approval) -> execution
 *          -> verification
 *
 * — rendered as a Timeline. Every consequential action VISIBLY shows:
 *   1. authorization state (requestedBy / the approving principal);
 *   2. policy decision (the linked Guardian decision);
 *   3. approval requirement (the gated PARKED transitions);
 *   4. expected effect (the capability across the resolved targets);
 *   5. evidence requirement (the plan's opaque evidence refs);
 *   6. execution state (the plan status + the downstream-dispatch
 *      handoff disclosure);
 *   7. verification result (the binding-site verification record, or
 *      the explicit not-yet-verified disclosure).
 *
 * A proposal is NEVER presented as an executed action (the
 * stop-the-line rule). A BLOCK decision VISUALLY STOPS the journey.
 *
 * The composite props are PRESENTATIONAL: the binding site composes
 * the existing view-models (plan presentation + progression + the
 * verification) — no business truth lives in React state.
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type {
  ActionPlanPresentationView,
  PlanProgressionView,
  GroupSelectionView,
} from "../action-plans-view";
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
import { decisionConsoleStatus, planConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The verification record (presentational — the binding site composes). */
export interface ActionVerificationView {
  /** ISO 8601 verification instant. */
  readonly verifiedAt: string;
  /** The machine-stable verification summary. */
  readonly summary: string;
  /** The number of verification evidence artifacts. */
  readonly evidenceCount: number;
}

/** The composite fleet-action journey (presentational composition). */
export interface FleetActionJourneyData {
  /** The plan presentation (the gated state machine rendered). */
  readonly plan: ActionPlanPresentationView;
  /** The plan progression (the walked revision chain), when supplied. */
  readonly progression: PlanProgressionView | null;
  /** The resolved group selection (intent -> targets), when supplied. */
  readonly selection: GroupSelectionView | null;
  /** The verification record, when verification completed. */
  readonly verification: ActionVerificationView | null;
}

export interface FleetActionsScreenProps {
  /** The composite journey phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<FleetActionJourneyData>;
}

// ---------------------------------------------------------------------------
// The journey timeline (pure derivation over the composite data)
// ---------------------------------------------------------------------------

function journeyTimeline(data: FleetActionJourneyData): readonly TimelineItem[] {
  const { plan, selection, verification } = data;
  const blocked = plan.linkedDecision?.decision === "BLOCK";
  const approved = plan.status === "APPROVED" || plan.status === "ADVANCED";
  const rejected = plan.status === "REJECTED";
  const needsApproval = plan.status === "PARKED" || plan.linkedDecision?.decision === "REQUIRE_APPROVAL";
  return [
    {
      id: "intent",
      label: "Intent declared",
      detail:
        plan.requestedBy !== undefined
          ? `Requested by ${plan.requestedBy} at ${plan.createdAt}`
          : `Declared at ${plan.createdAt}`,
      state: "done",
    },
    {
      id: "targets",
      label: "Targets selected",
      detail:
        selection !== null
          ? `${selection.selectorKind} selection — ${selection.targetCount} target(s)`
          : `${plan.targetCount} target(s)`,
      state: "done",
    },
    {
      id: "proposal",
      label: "Proposal created",
      detail: `Plan v${plan.version} — a PROPOSAL, never an execution`,
      state: "done",
    },
    {
      id: "gate",
      label: "Guardian gate",
      detail:
        plan.linkedDecision === null
          ? "Not yet evaluated"
          : `${plan.linkedDecision.decision} at ${plan.linkedDecision.decidedAt}`,
      state: plan.linkedDecision === null ? "current" : blocked ? "blocked" : "done",
    },
    {
      id: "approval",
      label: "Approval",
      detail: needsApproval
        ? "Required — the plan is PARKED until an owner decides"
        : blocked
          ? "Not applicable — the Guardian refused the action"
          : "Not required by the policy decision",
      state: blocked ? "pending" : needsApproval ? "current" : "done",
    },
    {
      id: "execution",
      label: "Execution",
      detail: approved
        ? `${plan.status} — execution is a DOWNSTREAM DISPATCH handoff (never performed on this surface)`
        : rejected
          ? "REJECTED — the action will not proceed"
          : "Pending the gates above",
      state: blocked || rejected ? "blocked" : approved ? "done" : "pending",
    },
    {
      id: "verification",
      label: "Verification",
      detail:
        verification === null
          ? approved
            ? "Verification follows the downstream dispatch"
            : "Not reached"
          : `${verification.summary} at ${verification.verifiedAt} · ${verification.evidenceCount} evidence artifact(s)`,
      state: verification === null ? (approved ? "current" : "pending") : "done",
    },
  ];
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The FleetActionsScreen: the first-class fleet-action journey — every
 * consequential field visible, the proposal/execution distinction
 * preserved end-to-end.
 */
export function FleetActionsScreen(props: FleetActionsScreenProps): JSX.Element {
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Fleet Actions", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Fleet Actions</h1>
          <p className="fos-screen-subtitle">
            The gated action journey — intent to verified outcome, with the authorization, policy
            and approval states always visible.
          </p>
        </div>
      </header>
      {props.phase.kind === "ready" ? (
        <FleetActionsBody data={props.phase.view} />
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the fleet action" />
      )}
    </div>
  );
}

function FleetActionsBody(props: { readonly data: FleetActionJourneyData }): JSX.Element {
  const { plan, progression, selection, verification } = props.data;
  return (
    <>
      <Card title="Summary" subtitle="What this action is and who declared it">
        <DefinitionList
          entries={[
            { term: "Plan", value: <span className="fos-mono">{plan.name}</span> },
            { term: "Plan id", value: <span className="fos-mono">{plan.planId}</span> },
            { term: "Version", value: `v${plan.version}` },
            {
              term: "Authorization",
              value:
                plan.requestedBy !== undefined ? (
                  <span className="fos-mono">{plan.requestedBy}</span>
                ) : (
                  <span className="fos-meta">requester unknown</span>
                ),
            },
            { term: "Declared at", value: <span className="fos-mono">{plan.createdAt}</span> },
            ...(plan.description !== undefined
              ? [{ term: "Description", value: plan.description }]
              : []),
          ]}
        />
      </Card>
      <Card title="Current state">
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
          <StatusIndicator status={planConsoleStatus(plan.status)} /> <Badge>{plan.status}</Badge>
          {plan.linkedDecision !== null && (
            <>
              {" · "}
              <StatusIndicator status={decisionConsoleStatus(plan.linkedDecision.decision)} />{" "}
              <Badge>{plan.linkedDecision.decision}</Badge>
            </>
          )}
        </p>
        <p className="fos-meta" style={{ margin: 0 }}>
          {plan.isTerminal
            ? "The plan has reached a terminal status of the policy gate."
            : "The plan is still inside the policy gate."}
          {plan.executionHandoff !== null &&
            " Execution is a downstream dispatch handoff — never performed on this surface."}
        </p>
      </Card>
      <Card title="Why it matters">
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          A fleet action changes device state for every target it touches. The gates below make the
          change safe: the Contract Guardian decides, an owner approves when the policy requires
          it, and the outcome is verified with evidence. A proposal is never an executed action.
        </p>
      </Card>
      <Card title="Expected effect">
        <DefinitionList
          entries={[
            {
              term: "Capability",
              value: <span className="fos-mono">{plan.capability}</span>,
            },
            { term: "Targets", value: `${plan.targetCount} device(s)` },
            ...(selection !== null
              ? [{ term: "Selection", value: <span className="fos-mono">{selection.selectorSummary}</span> }]
              : []),
          ]}
        />
        <details style={{ marginTop: "0.5rem" }}>
          <summary className="fos-meta" style={{ cursor: "pointer" }}>
            Show the resolved target devices
          </summary>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1rem", fontSize: "0.8125rem" }}>
            {plan.selectedTargets.map((target) => (
              <li key={target}>
                <span className="fos-mono">{target}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
      <Card title="Policy decision + approval requirement">
        {plan.linkedDecision === null ? (
          <p className="fos-meta" style={{ margin: 0 }}>
            No Guardian decision is linked yet — the proposal has not been evaluated.
          </p>
        ) : (
          <>
            <DefinitionList
              entries={[
                {
                  term: "Decision",
                  value: (
                    <span className="fos-row">
                      <StatusIndicator status={decisionConsoleStatus(plan.linkedDecision.decision)} />
                      <Badge>{plan.linkedDecision.decision}</Badge>
                    </span>
                  ),
                },
                { term: "Decided at", value: <span className="fos-mono">{plan.linkedDecision.decidedAt}</span> },
                { term: "Blocking", value: plan.linkedDecision.isBlocking ? "Yes" : "No" },
                {
                  term: "Rules that fired",
                  value:
                    plan.linkedDecision.rules.length === 0 ? (
                      <span className="fos-meta">none</span>
                    ) : (
                      plan.linkedDecision.rules
                        .map((rule) => `${rule.ruleId} v${rule.ruleVersion}`)
                        .join(", ")
                    ),
                },
              ]}
            />
            <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
              {plan.linkedDecision.decision === "REQUIRE_APPROVAL"
                ? "Approval REQUIRED: the plan is parked until an owner approves or rejects it (a human transition — never auto-promoted)."
                : plan.linkedDecision.decision === "BLOCK"
                  ? "The Guardian REFUSED this action — the journey stops here."
                  : "No approval is required by this decision."}
            </p>
          </>
        )}
        {plan.availableTransitions.length > 0 && (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            Available gated transitions:{" "}
            {plan.availableTransitions
              .map((step) => `${step.from} -> ${step.to} (gate: ${step.gate}, confirmation required)`)
              .join("; ")}
          </p>
        )}
      </Card>
      <Card title="Evidence" subtitle="Opaque, content-addressed artifacts">
        <p className="fos-meta" style={{ margin: "0 0 0.5rem" }}>
          The plan cites {plan.evidence.length} artifact(s) · content digest{" "}
          <span className="fos-mono">{plan.contentDigest}</span>
          {verification !== null && ` · verification cites ${verification.evidenceCount} artifact(s)`}
        </p>
        <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
          {plan.evidence.map((ref) => (
            <li key={ref.key}>
              <span className="fos-mono">{ref.key}</span>{" "}
              <span className="fos-meta">
                ({ref.hashAlgorithm} · {ref.sizeBytes} bytes)
              </span>
            </li>
          ))}
        </ul>
        {verification !== null && (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
            Verification result: {verification.summary} at{" "}
            <span className="fos-mono">{verification.verifiedAt}</span>.
          </p>
        )}
      </Card>
      <Card title="History" subtitle="The walked revision chain (explicit gated transitions)">
        {progression === null ? (
          <p className="fos-meta" style={{ margin: "0 0 0.75rem" }}>
            No revision chain was supplied for this plan.
          </p>
        ) : (
          <ol className="fos-timeline" aria-label="Plan progression" style={{ marginBottom: "0.75rem" }}>
            {progression.steps.map((step, index) => (
              <li key={`${step.version}-${index}`}>
                <span
                  className={`fos-timeline__marker fos-timeline__marker--${index === progression.steps.length - 1 ? "current" : "done"}`}
                  aria-hidden="true"
                />
                <span className="fos-timeline__body">
                  <span className="fos-timeline__label">
                    v{step.version} — {step.status}
                  </span>
                  {step.transition !== null && (
                    <span className="fos-timeline__detail">
                      {step.transition.from} -&gt; {step.transition.to} · gate{" "}
                      {step.transition.gate} · confirmation required
                    </span>
                  )}
                  {step.transitionedAt !== undefined && (
                    <span className="fos-timeline__detail">
                      at <span className="fos-mono">{step.transitionedAt}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        <Timeline items={journeyTimeline(props.data)} ariaLabel="Fleet action journey" />
      </Card>
    </>
  );
}

