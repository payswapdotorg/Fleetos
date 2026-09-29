/**
 * @fleetos/web-security — D1 rendered: the ApprovalsQueueScreen
 * (W090B).
 *
 * The React component layer over the EXISTING pure approvals-queue
 * view-model (`approvals-queue-view.ts` — logic untouched): the
 * PARKED proposals awaiting HUMAN decision, each with the full
 * REQUIRE_APPROVAL decision context and the EXPLICIT approval
 * transitions (PARKED -> APPROVED / REJECTED, gated on
 * `human_decision` with confirmation required — LOCK 16: NEVER
 * one-click).
 *
 * The queue NEVER executes: no dispatch path, no intent id, no
 * command. Approve/Reject are INTENT affordances routed through
 * callbacks — the W041 `approveParkedPlan` step (invoked by the
 * binding site, audited by the actions package) performs the actual
 * transition. The confirmation dialog is FULLY CONTROLLED
 * (`pendingDecision` is a prop; the screen never owns it).
 *
 * Owner-only presentation: when no acting approver is supplied, the
 * gated transitions are visible but NOT actionable — the disclosure
 * states that only an owner may decide.
 *
 * Exact empty/loading/error/invalid states (design contract).
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type {
  ApprovalsQueueView,
  ParkedApprovalItemView,
} from "../approvals-queue-view";
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
} from "../ui/primitives";
import type { ScreenPhase } from "../ui/primitives";
import { decisionConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The approval action under confirmation (fully controlled). */
export interface PendingApprovalDecision {
  /** The parked plan the decision concerns. */
  readonly planId: string;
  /** The approval action ("approve" or "reject"). */
  readonly action: "approve" | "reject";
}

/** The acting approver (the owner context the binding site supplies). */
export interface ActingApprover {
  readonly userId: string;
}

export interface ApprovalsQueueScreenProps {
  /** The approvals queue view phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<ApprovalsQueueView>;
  /** The acting approver, when the session may decide (owner-only). */
  readonly actingApprover: ActingApprover | null;
  /** The confirmation in flight (controlled; null = no dialog). */
  readonly pendingDecision: PendingApprovalDecision | null;
  /** Request the confirmation dialog for a transition (never executes). */
  readonly onRequestDecision: (planId: string, action: "approve" | "reject") => void;
  /** Cancel the confirmation (closes the dialog). */
  readonly onCancelDecision: () => void;
  /** Confirm the gated transition (routes the intent; the binding site invokes the W041 step). */
  readonly onConfirmDecision: (planId: string, action: "approve" | "reject") => void;
}

// ---------------------------------------------------------------------------
// One queue item
// ---------------------------------------------------------------------------

function QueueItemCard(props: {
  readonly item: ParkedApprovalItemView;
  readonly canDecide: boolean;
  readonly pending: PendingApprovalDecision | null;
  readonly onRequestDecision: (planId: string, action: "approve" | "reject") => void;
}): JSX.Element {
  const { item } = props;
  const decision = item.parkedByDecision;
  return (
    <Card
      title={item.name}
      subtitle={`Plan ${item.planId} v${item.version} · parked ${item.parkedAt}`}
    >
      <DefinitionList
        entries={[
          { term: "Capability", value: <span className="fos-mono">{item.capability}</span> },
          { term: "Targets", value: `${item.targetCount} device(s)` },
          {
            term: "Requested by",
            value: item.requestedBy === undefined ? <span className="fos-meta">unknown</span> : <span className="fos-mono">{item.requestedBy}</span>,
          },
          {
            term: "Parking decision",
            value: (
              <span className="fos-row">
                <StatusIndicator status={decisionConsoleStatus(decision.decision)} />
                <Badge>{decision.decision}</Badge>
              </span>
            ),
          },
        ]}
      />
      {decision.reasons.length > 0 && (
        <>
          <p className="fos-card-subtitle" style={{ margin: "0.75rem 0 0.35rem" }}>
            Parking reasons (machine-stable, verbatim)
          </p>
          <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8125rem" }}>
            {decision.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>
                <span className="fos-mono">{reason.code}</span>
                {reason.ruleId !== undefined && (
                  <span className="fos-meta">
                    {" "}
                    (rule <span className="fos-mono">{reason.ruleId}</span>)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        Evidence: {decision.evidence.length} opaque artifact(s) · no direct-execution path exists on
        this surface.
      </p>
      <div className="fos-row" style={{ marginTop: "0.75rem" }}>
        {item.availableTransitions.map((transition) => (
          <Button
            key={transition.action}
            variant={transition.action === "approve" ? "primary" : "danger"}
            disabled={!props.canDecide}
            onClick={(): void => props.onRequestDecision(item.planId, transition.action)}
            ariaLabel={`${transition.action === "approve" ? "Approve" : "Reject"} the parked plan ${item.name} (gated on human_decision, confirmation required)`}
            testId={`queue-${transition.action}-${item.planId}`}
          >
            {transition.action === "approve" ? "Approve" : "Reject"}
          </Button>
        ))}
      </div>
      <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
        {props.canDecide
          ? "Both transitions are gated on a human decision and require confirmation — they are never one-click."
          : "Approvals are owner-only: this session may review the decision context but not decide."}
      </p>
      {props.pending !== null && props.pending.planId === item.planId && (
        <p className="fos-meta" style={{ margin: "0.5rem 0 0", fontWeight: 600 }}>
          A {props.pending.action} confirmation is open for this plan.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The confirmation dialog (fully controlled)
// ---------------------------------------------------------------------------

function ConfirmDialog(props: {
  readonly item: ParkedApprovalItemView;
  readonly pending: PendingApprovalDecision;
  readonly onCancel: () => void;
  readonly onConfirm: (planId: string, action: "approve" | "reject") => void;
}): JSX.Element {
  const { item, pending } = props;
  return (
    <div className="fos-scrim fos-scrim--center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`${pending.action === "approve" ? "Approve" : "Reject"} parked plan ${item.name}`}
        tabIndex={-1}
        className="fos-dialog"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape") props.onCancel();
        }}
      >
        <div className="fos-dialog__header">
          <h2 className="fos-dialog__title">{pending.action === "approve" ? "Approve" : "Reject"} parked plan</h2>
          <button
            type="button"
            className="fos-btn fos-btn--ghost"
            aria-label="Cancel the approval confirmation"
            onClick={props.onCancel}
          >
            ✕
          </button>
        </div>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          {pending.action === "approve"
            ? `Approving "${item.name}" releases the plan for downstream dispatch. This transition is gated on a human decision and is audited.`
            : `Rejecting "${item.name}" ends the plan as REJECTED. This transition is gated on a human decision and is audited.`}
        </p>
        <DefinitionList
          entries={[
            { term: "Plan", value: <span className="fos-mono">{item.planId}</span> },
            { term: "Capability", value: <span className="fos-mono">{item.capability}</span> },
            { term: "Targets", value: `${item.targetCount} device(s)` },
            { term: "Gate", value: "human_decision" },
            { term: "Confirmation", value: "required (never one-click)" },
          ]}
        />
        <div className="fos-row">
          <Button
            variant={pending.action === "approve" ? "primary" : "danger"}
            onClick={(): void => props.onConfirm(item.planId, pending.action)}
            testId={`confirm-${pending.action}`}
          >
            Confirm {pending.action}
          </Button>
          <Button variant="secondary" onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * The ApprovalsQueueScreen: the PARKED proposals with the owner-only
 * approve/reject presentation. Approvals are human transitions — the
 * screen NEVER auto-promotes or auto-executes anything.
 */
export function ApprovalsQueueScreen(props: ApprovalsQueueScreenProps): JSX.Element {
  const pendingItem =
    props.phase.kind === "ready" && props.pendingDecision !== null
      ? props.phase.view.items.find((item) => item.planId === props.pendingDecision?.planId)
      : undefined;
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[{ label: "FleetOS" }, { label: "Security" }, { label: "Approvals", current: true }]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Approvals queue</h1>
          <p className="fos-screen-subtitle">
            Consequential actions the Contract Guardian parked for a human decision — parked first,
            decided by an owner, never auto-promoted.
          </p>
        </div>
        {props.actingApprover !== null && (
          <span className="fos-meta">
            Acting approver: <span className="fos-mono">{props.actingApprover.userId}</span>
          </span>
        )}
      </header>
      {props.phase.kind === "ready" ? (
        props.phase.view.items.length === 0 ? (
          <EmptyState
            title="No parked approvals"
            hint="When the Contract Guardian returns REQUIRE_APPROVAL, the parked plan appears here until an owner approves or rejects it."
          />
        ) : (
          <div className="fos-stack">
            {props.phase.view.items.map((item) => (
              <QueueItemCard
                key={item.planId}
                item={item}
                canDecide={props.actingApprover !== null}
                pending={props.pendingDecision}
                onRequestDecision={props.onRequestDecision}
              />
            ))}
          </div>
        )
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the approvals queue" />
      )}
      {pendingItem !== undefined && props.pendingDecision !== null && (
        <ConfirmDialog
          item={pendingItem}
          pending={props.pendingDecision}
          onCancel={props.onCancelDecision}
          onConfirm={props.onConfirmDecision}
        />
      )}
    </div>
  );
}
