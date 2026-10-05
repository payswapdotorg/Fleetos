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
import type { ParkedExplanationView } from "../approval-explanation-view";
import type { SecurityRoleLensView } from "../role-lens";
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
import { RoleLensSection } from "./role-lens-section";
import { ParkedExplanationSection } from "./parked-explanation-section";

// W148 — the executed-decision contract surface (the typed-phrase gate's
// required phrase + the machine-stable refusal shape). The screen renders
// the gate's PROMPT; the runtime performs the dispatch (the screen never
// executes anything itself).
import {
  requiredApprovalConfirmationPhrase,
} from "../approvals-execution";
import type { ApprovalRefusal } from "../approvals-execution";

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

/**
 * W148 — the executed-decision dialog state (fully controlled by the
 * runtime). The screen renders the gate's prompt; the runtime performs
 * the dispatch. The dialog NEVER executes anything itself — every
 * field is a controlled view of the W142 approval-decision-runtime's
 * state (the runtime owns the typed-phrase gate, the RBAC gate, and
 * the dispatch).
 */
export interface ApprovalDecisionDialogState {
  /** The pending decision (the parked plan + the action). */
  readonly pending: PendingApprovalDecision;
  /** Whether the operator acknowledged the consequences (explicit step 1). */
  readonly acknowledged: boolean;
  /** The typed confirmation phrase so far (explicit step 2). */
  readonly phrase: string;
  /**
   * The machine-stable refusal, when the runtime's gate refused (the
   * `authorization_required` denial, the `already_decided` duplicate
   * guard, or the `explicit_confirmation_required` gate). The screen
   * renders the refusal visibly — NEVER a silent no-op.
   */
  readonly refusal: ApprovalRefusal | null;
  /**
   * The rejection reason text (REJECT only). Recorded by the boundary
   * on a successful REJECT — the plan does NOT execute.
   */
  readonly rejectionReason: string;
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
  /**
   * W148 — the executed-decision dialog state (controlled; null = no
   * dialog open). The screen renders the typed-phrase gate's PROMPT;
   * the runtime owns the gate (the typed-phrase check, the RBAC check,
   * the dispatch through the gated boundary).
   */
  readonly decisionDialog: ApprovalDecisionDialogState | null;
  /** Request the confirmation dialog for a transition (never executes). */
  readonly onRequestDecision: (planId: string, action: "approve" | "reject") => void;
  /** Cancel the confirmation (closes the dialog; writes NO audit entry). */
  readonly onCancelDecision: () => void;
  /**
   * W148 — the operator acknowledged the consequences (explicit step 1).
   * The runtime's `acknowledgeDecision` records the transition; the
   * screen's controlled checkbox reflects the runtime's state.
   */
  readonly onAcknowledgeConsequences: () => void;
  /**
   * W148 — the operator typed (or retyped) the confirmation phrase
   * (explicit step 2). The runtime's `enterConfirmationPhrase` records
   * the transition; the screen's controlled input reflects the runtime's
   * state.
   */
  readonly onPhraseChange: (phrase: string) => void;
  /**
   * W148 — the operator typed (or retyped) the rejection reason (REJECT
   * only). Recorded by the boundary on a successful REJECT — the plan
   * does NOT execute.
   */
  readonly onRejectionReasonChange: (reason: string) => void;
  /**
   * W148 — confirm the gated transition. Routes the explicit
   * confirmation (acknowledged + typed phrase) through the runtime's
   * `markConfirmed` -> `dispatchDecision` chain; the boundary
   * transitions the plan out of PARKED, the audit sink records the
   * decision, and the badge count drops. A refusal (the
   * `explicit_confirmation_required` gate, the `authorization_required`
   * denial, the `already_decided` duplicate guard) returns the
   * machine-stable reason — visible, never silent.
   */
  readonly onConfirmDecision: () => void;
  /**
   * W100B: the active role lens (optional — absent renders exactly the
   * W090B screen). Shapes ONLY the banner emphasis.
   */
  readonly roleLens?: SecurityRoleLensView | null;
  /**
   * W100B: the per-item "why parked / what unlocks it" explanations
   * (from `buildParkedExplanationView`), keyed by planId. Optional.
   */
  readonly explanations?: Readonly<Record<string, ParkedExplanationView>> | null;
}

// ---------------------------------------------------------------------------
// One queue item
// ---------------------------------------------------------------------------

function QueueItemCard(props: {
  readonly item: ParkedApprovalItemView;
  readonly canDecide: boolean;
  readonly dialog: ApprovalDecisionDialogState | null;
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
      {props.dialog !== null && props.dialog.pending.planId === item.planId && (
        <p className="fos-meta" style={{ margin: "0.5rem 0 0", fontWeight: 600 }}>
          A {props.dialog.pending.action} confirmation is open for this plan.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The confirmation dialog (fully controlled — the W142 typed-phrase gate)
// ---------------------------------------------------------------------------

/**
 * The W142 executed-decision confirmation dialog: the operator MUST
 * (a) acknowledge the consequences AND (b) type the exact confirmation
 * phrase derived from the action + plan (`CONFIRM APPROVE <planId>` /
 * `CONFIRM REJECT <planId>`). The Confirm button is DISABLED until both
 * hold. The dialog NEVER executes anything itself — every field is a
 * controlled view of the runtime's state; the `onConfirmDecision`
 * callback routes the explicit confirmation through the runtime's
 * `markConfirmed` -> `dispatchDecision` chain.
 *
 * A machine-stable refusal (the `authorization_required` RBAC denial,
 * the `already_decided` duplicate guard, the
 * `explicit_confirmation_required` gate) renders VISIBLE — never a
 * silent no-op. A restricted role sees the FROZEN denial explanation
 * with the escalation path.
 */
function ConfirmDialog(props: {
  readonly item: ParkedApprovalItemView;
  readonly dialog: ApprovalDecisionDialogState;
  readonly onCancel: () => void;
  readonly onAcknowledgeConsequences: () => void;
  readonly onPhraseChange: (phrase: string) => void;
  readonly onRejectionReasonChange: (reason: string) => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  const { item, dialog } = props;
  const pending = dialog.pending;
  const requiredPhrase = requiredApprovalConfirmationPhrase({
    tenantId: "" as never,
    planId: item.planId,
    action: pending.action,
    by: "" as never,
    correlationId: "" as never,
  });
  const phraseMatches = dialog.phrase === requiredPhrase;
  const canConfirm = dialog.acknowledged && phraseMatches;
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
            : `Rejecting "${item.name}" ends the plan as REJECTED — the plan does NOT execute. This transition is gated on a human decision and is audited.`}
        </p>
        <DefinitionList
          entries={[
            { term: "Plan", value: <span className="fos-mono">{item.planId}</span> },
            { term: "Capability", value: <span className="fos-mono">{item.capability}</span> },
            { term: "Targets", value: `${item.targetCount} device(s)` },
            { term: "Gate", value: "human_decision" },
            { term: "Confirmation", value: "typed phrase required (never one-click)" },
          ]}
        />
        <div className="fos-stack" style={{ gap: "0.5rem" }}>
          <label className="fos-row" style={{ gap: "0.5rem", alignItems: "center", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={dialog.acknowledged}
              onChange={(): void => props.onAcknowledgeConsequences()}
              data-testid="confirm-acknowledged"
            />
            <span>
              I acknowledge the consequences of this {pending.action} decision. The boundary will
              record an audit entry; the plan&apos;s state will change.
            </span>
          </label>
          <label className="fos-stack" style={{ gap: "0.25rem", fontSize: "0.875rem" }}>
            <span>
              Type the exact confirmation phrase to unlock the dispatch:{" "}
              <span className="fos-mono">{requiredPhrase}</span>
            </span>
            <input
              type="text"
              value={dialog.phrase}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void => props.onPhraseChange(event.target.value)}
              data-testid="confirm-phrase"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {pending.action === "reject" && (
            <label className="fos-stack" style={{ gap: "0.25rem", fontSize: "0.875rem" }}>
              <span>Rejection reason (recorded by the boundary; the plan does NOT execute):</span>
              <textarea
                value={dialog.rejectionReason}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => props.onRejectionReasonChange(event.target.value)}
                data-testid="confirm-rejection-reason"
                rows={2}
              />
            </label>
          )}
          {dialog.refusal !== null && (
            <div
              role="alert"
              data-testid="confirm-refusal"
              style={{
                margin: 0,
                padding: "0.5rem 0.75rem",
                borderRadius: "0.25rem",
                background: "var(--fos-color-danger-bg, #fef2f2)",
                border: "1px solid var(--fos-color-danger-border, #fecaca)",
                fontSize: "0.8125rem",
              }}
            >
              <span className="fos-mono" style={{ fontWeight: 600 }}>{dialog.refusal.reason}</span>
              {" — "}
              <span>{dialog.refusal.explanation}</span>
            </div>
          )}
        </div>
        <div className="fos-row">
          <Button
            variant={pending.action === "approve" ? "primary" : "danger"}
            disabled={!canConfirm}
            onClick={(): void => props.onConfirm()}
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
  const dialogPlanId = props.decisionDialog?.pending.planId ?? null;
  const pendingItem =
    props.phase.kind === "ready" && dialogPlanId !== null
      ? props.phase.view.items.find((item) => item.planId === dialogPlanId)
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
      {props.roleLens !== null && props.roleLens !== undefined && (
        <RoleLensSection
          lens={props.roleLens}
          emphasis={[
            { label: "Approvals", value: props.roleLens.approvalsEmphasis },
            { label: "Policies", value: props.roleLens.policiesEmphasis },
          ]}
        />
      )}
      {props.phase.kind === "ready" ? (
        props.phase.view.items.length === 0 ? (
          <EmptyState
            title="No parked approvals"
            hint="When the Contract Guardian returns REQUIRE_APPROVAL, the parked plan appears here until an owner approves or rejects it."
          />
        ) : (
          <div className="fos-stack">
            {props.phase.view.items.map((item) => (
              <div className="fos-stack" key={item.planId}>
                <QueueItemCard
                  item={item}
                  canDecide={props.actingApprover !== null}
                  dialog={props.decisionDialog}
                  onRequestDecision={props.onRequestDecision}
                />
                {props.explanations !== null &&
                  props.explanations !== undefined &&
                  props.explanations[item.planId] !== undefined && (
                    <ParkedExplanationSection explanation={props.explanations[item.planId]!} />
                  )}
              </div>
            ))}
          </div>
        )
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the approvals queue" />
      )}
      {pendingItem !== undefined && props.decisionDialog !== null && (
        <ConfirmDialog
          item={pendingItem}
          dialog={props.decisionDialog}
          onCancel={props.onCancelDecision}
          onAcknowledgeConsequences={props.onAcknowledgeConsequences}
          onPhraseChange={props.onPhraseChange}
          onRejectionReasonChange={props.onRejectionReasonChange}
          onConfirm={props.onConfirmDecision}
        />
      )}
    </div>
  );
}
