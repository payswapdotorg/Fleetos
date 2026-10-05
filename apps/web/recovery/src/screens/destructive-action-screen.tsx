/**
 * @fleetos/web-recovery — D2 rendered: the DestructiveActionScreen (W090A).
 *
 * The React component layer over the EXISTING pure destructive-action
 * view-models (`destructive-actions.ts` + `recovery-case.ts` — logic
 * untouched): the gated destructive-action presentation for one
 * device's active recovery case.
 *
 * Frozen presentation rules:
 *   - There is NO direct-execution affordance — the surface renders
 *     the `DestructiveActionAffordance` (kind `gated_path_only`)
 *     exactly; one-click destructive execution is UNREPRESENTABLE in
 *     the view-model contracts, so it is unrenderable here.
 *   - Every destructive control VISIBLY shows: authorization state,
 *     the policy/Guardian decision, whether approval is required,
 *     the expected effect, the evidence requirement, the execution
 *     state, and the verification result — the design contract's
 *     consequential-action checklist.
 *   - A proposal is NEVER presented as an executed action: requests
 *     that are REQUESTED/PARKED/APPROVED render as proposals with
 *     their gate ledgers; only EXECUTED/FAILED render outcomes.
 *   - The LOST-device flow renders as a TIMELINE: last-seen evidence
 *     -> recovery case -> locate -> lock -> destructive action ->
 *     verification -> replacement escalation (per the UX journey
 *     simulation's required sequence).
 *   - Unsupported capabilities remain visibly unsupported — never
 *     disabled-looking fake controls: the destructive action set is
 *     injected per device (the binding site's adapter-derived set).
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId } from "@fleetos/contracts";
import type {
  DestructiveActionAffordance,
  DestructiveRequestViewModel,
} from "../destructive-actions";
import type { CaseStateMachineView, RecoveryCaseViewModel } from "../recovery-case";
import type { RecoveryCaseJourney } from "../recovery-journey";
import { DESTRUCTIVE_GATE_STEP_IDS } from "../destructive-actions";
import {
  confirmationFeedback,
  requiredConfirmationPhrase,
} from "../confirmation";
import type {
  ConfirmationRefusal,
  DestructiveConfirmationState,
} from "../confirmation";
import { ConsoleStyles } from "../ui/tokens";
import {
  AlertError,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CheckField,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  PhasePresentation,
  Skeleton,
  StatusIndicator,
  Timeline,
} from "../ui/primitives";
import type { ScreenPhase, TimelineItem } from "../ui/primitives";
import {
  CONSOLE_STATUS_LABEL,
  caseConsoleStatus,
  gateStepConsoleStatus,
  guardianConsoleStatus,
  requestConsoleStatus,
} from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One destructive action surfaced for the case's device. */
export interface DestructiveActionEntry {
  /** The action kind ("lock" | "locate" | "wipe" | "reboot", verbatim). */
  readonly action: string;
  /** The human action label. */
  readonly label: string;
  /** The expected effect, stated plainly. */
  readonly expectedEffect: string;
  /** The evidence requirement, stated plainly. */
  readonly evidenceRequirement: string;
  /** Is the action supported by the device's adapter? (visibly unsupported otherwise) */
  readonly supported: boolean;
  /** The gated-path-only affordance (the pure view-model's output). */
  readonly affordance: DestructiveActionAffordance;
  /** The LATEST request view-model for (case, action), when one exists. */
  readonly request: DestructiveRequestViewModel | undefined;
}

/** The LOST-flow timeline derivation inputs (props-in, pure). */
export interface LostFlowContext {
  readonly lastSeenObservedAt: string | undefined;
  readonly caseView: RecoveryCaseViewModel | undefined;
  readonly locatedSupported: boolean;
  readonly lockSupported: boolean;
  readonly wipeSupported: boolean;
}

export interface DestructiveActionScreenProps {
  readonly phase: ScreenPhase<RecoveryCaseViewModel | undefined>;
  readonly deviceId: DeviceId;
  readonly actions: readonly DestructiveActionEntry[];
  readonly lostFlow: LostFlowContext;
  /** Request a destructive action (routes the intent to the gated boundary). */
  readonly onRequestAction: (action: string) => void;
  /** Approve a parked request (routes the human decision to the boundary). */
  readonly onApproveRequest: (requestId: string) => void;
  readonly onOpenCases: () => void;
  readonly onOpenFindMy: (deviceId: DeviceId) => void;
  /**
   * W141: the destructive-action CONFIRMATION flow (optional; the
   * runtime composes it). The explicit-confirmation machine's state +
   * the dispatch refusal (visible, never inferred) + the controlled
   * dialog callbacks. When present, `onRequestAction` OPENS the
   * confirmation review; the dispatch happens ONLY through the
   * machine's explicit gate.
   */
  readonly confirmation?: DestructiveConfirmationPresentation;
  /**
   * W141: the case's seven-stage recovery journey (optional; the
   * runtime feed supplies it) — signal -> case -> locate/secure
   * decision -> authorization -> action -> evidence -> closure.
   */
  readonly journey?: RecoveryCaseJourney;
}

/**
 * The confirmation flow's presentation bundle (fully controlled): the
 * machine's state, the latest dispatch refusal, and the dialog's
 * callbacks. Presentational only — the machine lives in the runtime.
 */
export interface DestructiveConfirmationPresentation {
  /** The confirmation machine's current state. */
  readonly state: DestructiveConfirmationState;
  /** The latest dispatch refusal (kept visible until the next action). */
  readonly refusal: ConfirmationRefusal | undefined;
  /** Acknowledge the consequences (explicit step 1). */
  readonly onAcknowledge: () => void;
  /** Type the confirmation phrase (explicit step 2). */
  readonly onPhraseChange: (phrase: string) => void;
  /** Mark the explicit confirmation satisfied (the gate's transition). */
  readonly onConfirm: () => void;
  /** Dispatch the confirmed intent through the gated boundary. */
  readonly onDispatch: () => void;
  /** Cancel the open confirmation. */
  readonly onCancel: () => void;
}

// ---------------------------------------------------------------------------
// The LOST-device flow timeline (journey-stage visibility)
// ---------------------------------------------------------------------------

function lostFlowTimeline(flow: LostFlowContext): readonly TimelineItem[] {
  const caseActive = flow.caseView?.stateMachine.isActive ?? false;

  const stages: TimelineItem[] = [
    {
      id: "last_seen_evidence",
      label: "Last-seen evidence",
      detail:
        flow.lastSeenObservedAt === undefined
          ? "No last-seen evidence recorded yet"
          : `Last observed ${flow.lastSeenObservedAt}`,
      state: flow.lastSeenObservedAt === undefined ? "pending" : "done",
    },
    {
      id: "recovery_case",
      label: "Recovery case opened",
      detail:
        flow.caseView === undefined
          ? "No recovery case for this device"
          : `Case ${flow.caseView.caseId} — ${flow.caseView.status}`,
      state: flow.caseView === undefined ? "pending" : caseActive ? "current" : "done",
    },
  ];

  const gateStage = (id: string, label: string, supported: boolean): TimelineItem => ({
    id,
    label,
    detail: supported ? "Supported by this device's adapter" : "Visibly unsupported — no control offered",
    state: supported ? (caseActive ? "current" : "pending") : "blocked",
    stateLabel: supported ? undefined : "Unsupported",
  });

  stages.push(gateStage("locate", "Locate", flow.locatedSupported));
  stages.push(gateStage("lock", "Lock", flow.lockSupported));
  stages.push(gateStage("destructive_action", "Destructive action (wipe)", flow.wipeSupported));
  stages.push({
    id: "verification",
    label: "Verification",
    detail: "Execution is verified with adapter evidence before the journey closes",
    state: "pending",
  });
  stages.push({
    id: "replacement_escalation",
    label: "Replacement escalation",
    detail: "Escalation proposes replacement when recovery cannot close the case",
    state: "pending",
  });
  return stages;
}

// ---------------------------------------------------------------------------
// The gate-step ledger (met / pending / unmet — never color alone)
// ---------------------------------------------------------------------------

const GATE_STEP_LABELS: Readonly<Record<(typeof DESTRUCTIVE_GATE_STEP_IDS)[number], string>> = Object.freeze({
  tenant_scope: "Tenant scope",
  active_recovery_case: "Active recovery case",
  adapter_capability: "Adapter capability",
  guardian_evaluation: "Contract Guardian evaluation",
  human_approval: "Human approval",
  execution_dispatch: "Execution dispatch",
} as const);

function GateLedger({ affordance }: { readonly affordance: DestructiveActionAffordance }): JSX.Element {
  return (
    <ol className="fos-timeline" aria-label="Destructive action gate ledger">
      {affordance.steps.map((step) => {
        const semantic = gateStepConsoleStatus(step.state);
        return (
          <li key={step.id}>
            <span
              className={`fos-timeline__marker fos-timeline__marker--${step.state === "met" ? "done" : step.state === "pending" ? "current" : "blocked"}`}
              aria-hidden="true"
            />
            <span className="fos-timeline__body">
              <span className="fos-timeline__label">{GATE_STEP_LABELS[step.id]}</span>
              <span className="fos-timeline__detail">
                <StatusIndicator
                  status={semantic}
                  label={`${step.state} — ${CONSOLE_STATUS_LABEL[semantic]}`}
                />
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The Guardian decision context (verbatim, opaque)
// ---------------------------------------------------------------------------

function GuardianContext({ affordance }: { readonly affordance: DestructiveActionAffordance }): JSX.Element {
  if (affordance.guardian === "not_evaluated") {
    return (
      <p style={{ margin: 0 }}>
        <StatusIndicator status="unknown" label="Guardian: not_evaluated — Unknown" />
        <span className="fos-meta" style={{ marginLeft: "0.5rem" }}>
          The policy evaluation has not run for this action yet.
        </span>
      </p>
    );
  }
  const guardian = affordance.guardian;
  const semantic = guardianConsoleStatus(guardian.decision);
  return (
    <div className="fos-stack" style={{ gap: "0.5rem" }}>
      <p style={{ margin: 0 }}>
        <StatusIndicator
          status={semantic}
          label={`Guardian: ${guardian.decision} — ${CONSOLE_STATUS_LABEL[semantic]}`}
        />
        {guardian.isBlocking && (
          <Badge status="blocked">Holds the request until resolved</Badge>
        )}
      </p>
      {guardian.matchedRules.length > 0 && (
        <p className="fos-meta" style={{ margin: 0 }}>
          Matched rules:{" "}
          {guardian.matchedRules.map((rule, index) => (
            <span key={`${rule.ruleId}-${index}`}>
              {index > 0 && ", "}
              <span className="fos-mono">{rule.ruleId}</span> (v{rule.version})
            </span>
          ))}
        </p>
      )}
      {guardian.reasons.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
          {guardian.reasons.map((reason, index) => (
            <li key={`${reason.code}-${index}`}>
              <span className="fos-mono">{reason.code}</span>
              {reason.ruleId !== undefined ? <> (rule <span className="fos-mono">{reason.ruleId}</span>)</> : null}
            </li>
          ))}
        </ul>
      )}
      {guardian.evidence.length > 0 && (
        <p className="fos-meta" style={{ margin: 0 }}>
          Decision evidence: {guardian.evidence.length} opaque artifact{guardian.evidence.length === 1 ? "" : "s"} (key,
          size, hash shown in the request evidence below).
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One destructive action card (the gated path ONLY)
// ---------------------------------------------------------------------------

function DestructiveActionCard({
  entry,
  caseMachine,
  onRequestAction,
  onApproveRequest,
}: {
  readonly entry: DestructiveActionEntry;
  readonly caseMachine: CaseStateMachineView;
  readonly onRequestAction: (action: string) => void;
  readonly onApproveRequest: (requestId: string) => void;
}): JSX.Element {
  const affordance = entry.affordance;
  const request = entry.request;

  // Visibly unsupported — NO control at all, never a disabled fake.
  if (!entry.supported) {
    return (
      <Card title={entry.label} subtitle={`Action ${entry.action}`}>
        <p style={{ margin: 0 }}>
          <Badge status="unknown">Unsupported by this device</Badge>{" "}
          <span className="fos-meta">
            The device's adapter does not declare the <span className="fos-mono">{entry.action}</span>{" "}
            capability. Unsupported destructive behavior is never emulated.
          </span>
        </p>
      </Card>
    );
  }

  const requestSemantic =
    request === undefined ? undefined : requestConsoleStatus(request.status);
  const isProposal =
    request !== undefined && request.status !== "EXECUTED" && request.status !== "FAILED";
  const caseGate = caseMachine.isActive;

  return (
    <Card
      title={entry.label}
      subtitle={`Action ${entry.action} — gated path only`}
      actions={
        caseGate ? (
          request === undefined ? (
            <Button variant="danger" onClick={(): void => onRequestAction(entry.action)}>
              Request {entry.label.toLowerCase()}
            </Button>
          ) : isProposal && request.approval.pending ? (
            <Button variant="primary" onClick={(): void => onApproveRequest(request.requestId)}>
              Approve request
            </Button>
          ) : undefined
        ) : undefined
      }
    >
      <div className="fos-stack" style={{ gap: "0.75rem" }}>
        {!caseGate && (
          <AlertError
            title="An active recovery case is required"
            message="No destructive request can be recorded until this device's recovery case is in an active state. Open or escalate the recovery case first."
          />
        )}
        <DefinitionList
          entries={[
            { term: "Expected effect", value: entry.expectedEffect },
            { term: "Evidence required", value: entry.evidenceRequirement },
            { term: "Approval required", value: affordance.approvalRequired ? "Yes — a human must approve before dispatch" : "Only when the Guardian decides so" },
            {
              term: "Evidence trail",
              value: affordance.requiresEvidenceTrail ? "Required (append-only)" : "—",
            },
          ]}
        />
        <div>
          <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>Authorization + policy state</p>
          <GuardianContext affordance={affordance} />
        </div>
        <div>
          <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>Gate ledger</p>
          <GateLedger affordance={affordance} />
        </div>
        {affordance.approvalDecided !== undefined && (
          <p className="fos-meta" style={{ margin: 0 }}>
            Approval decided by <span className="fos-mono">{affordance.approvalDecided.by}</span> at{" "}
            <span className="fos-mono">{affordance.approvalDecided.at}</span>.
          </p>
        )}
        {request !== undefined && (
          <div>
            <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>Request state</p>
            <DefinitionList
              entries={[
                { term: "Request", value: <span className="fos-mono">{request.requestId}</span> },
                {
                  term: "Status",
                  value:
                    requestSemantic === undefined ? (
                      request.status
                    ) : (
                      <StatusIndicator
                        status={requestSemantic}
                        label={`${request.status} — ${CONSOLE_STATUS_LABEL[requestSemantic]}`}
                      />
                    ),
                },
                { term: "Requested at", value: <span className="fos-mono fos-meta">{request.requestedAt}</span> },
                {
                  term: "Requested by",
                  value: request.requestedBy ?? "—",
                },
                {
                  term: "Refusal reason",
                  value: request.refusalReason ?? "—",
                },
                {
                  term: "Legal continuations",
                  value:
                    request.stateMachine.legalNext.length === 0
                      ? "None — terminal"
                      : request.stateMachine.legalNext.join(", "),
                },
              ]}
            />
            {isProposal && (
              <p className="fos-meta" style={{ margin: "0.5rem 0 0" }}>
                This is a PROPOSAL in the gated pipeline — it has NOT executed. Execution dispatch happens
                only after the gate ledger is met, and its outcome is verified separately with evidence.
              </p>
            )}
            {request.execution !== undefined && (
              <p style={{ margin: "0.5rem 0 0" }}>
                <StatusIndicator
                  status={request.execution.outcome === "executed" ? "succeeded" : "failed"}
                  label={`Execution ${request.execution.outcome} at ${request.execution.attemptedAt} — ${request.execution.outcome === "executed" ? CONSOLE_STATUS_LABEL.succeeded : CONSOLE_STATUS_LABEL.failed}`}
                />{" "}
                <span className="fos-meta">
                  {request.execution.evidenceCount} adapter evidence artifact
                  {request.execution.evidenceCount === 1 ? "" : "s"} recorded.
                </span>
              </p>
            )}
            {request.evidence.length > 0 && (
              <div className="fos-table-wrap" style={{ marginTop: "0.5rem" }}>
                <table className="fos-table">
                  <caption>Request evidence — opaque, verbatim</caption>
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Size</th>
                      <th scope="col">Hash</th>
                      <th scope="col">Algorithm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.evidence.map((ref, index) => (
                      <tr key={`${ref.key}-${index}`}>
                        <td><span className="fos-mono">{ref.key}</span></td>
                        <td>{ref.sizeBytes} bytes</td>
                        <td><span className="fos-mono">{ref.hash}</span></td>
                        <td>{ref.hashAlgorithm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {request.history.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <p className="fos-card-subtitle" style={{ marginBottom: "0.35rem" }}>Version history</p>
                <ol className="fos-timeline" aria-label="Request revision history">
                  {request.history.map((revision) => (
                    <li key={`${revision.version}-${revision.recordId}`}>
                      <span
                        className={`fos-timeline__marker fos-timeline__marker--${revision.version === request.history[request.history.length - 1].version ? "current" : "done"}`}
                        aria-hidden="true"
                      />
                      <span className="fos-timeline__body">
                        <span className="fos-timeline__label">v{revision.version} — {revision.status}</span>
                        <span className="fos-timeline__detail">
                          requested <span className="fos-mono">{revision.requestedAt}</span>
                          {revision.decidedAt !== undefined ? (
                            <>
                              {" "}· decided <span className="fos-mono">{revision.decidedAt}</span>
                            </>
                          ) : null}
                          {revision.approvalDecidedAt !== undefined ? (
                            <>
                              {" "}· approval <span className="fos-mono">{revision.approvalDecidedAt}</span>
                            </>
                          ) : null}
                        </span>
                        {revision.refusalReason !== undefined && (
                          <span className="fos-timeline__detail">refused: {revision.refusalReason}</span>
                        )}
                        {revision.execution !== undefined && (
                          <span className="fos-timeline__detail">
                            execution: {revision.execution.outcome} at{" "}
                            <span className="fos-mono">{revision.execution.attemptedAt}</span>
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// W141 — the confirmation dialog + the visible feedback (never inferred)
// ---------------------------------------------------------------------------

/** The explicit-confirmation review dialog (fully controlled). */
function ConfirmationDialog({
  props,
  confirmation,
}: {
  readonly props: DestructiveActionScreenProps;
  readonly confirmation: DestructiveConfirmationPresentation;
}): JSX.Element | null {
  const state = confirmation.state;
  if (state.kind !== "reviewing" && state.kind !== "ready_to_dispatch") return null;
  const entry = props.actions.find((candidate) => candidate.action === state.context.action);
  const required = requiredConfirmationPhrase(state.context);
  const acknowledged = state.kind === "ready_to_dispatch" || (state.kind === "reviewing" && state.acknowledged);
  const typed = state.kind === "reviewing" ? state.phrase : required;
  return (
    <Dialog
      open={true}
      title={`Confirm ${entry?.label ?? state.context.action} — explicit confirmation required`}
      onClose={confirmation.onCancel}
    >
      <div className="fos-stack" style={{ gap: "0.75rem" }}>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          This destructive action routes through the gated boundary: tenant scope, the active recovery case,
          the adapter capability, the Contract Guardian evaluation, human approval where required, and
          execution dispatch with evidence. Nothing executes from this dialog — the boundary decides.
        </p>
        <DefinitionList
          entries={[
            { term: "Action", value: <span className="fos-mono">{state.context.action}</span> },
            { term: "Device", value: <span className="fos-mono">{state.context.deviceId as string}</span> },
            { term: "Recovery case", value: <span className="fos-mono">{state.context.caseId}</span> },
            {
              term: "Expected effect",
              value: entry?.expectedEffect ?? "—",
            },
            {
              term: "Evidence required",
              value: entry?.evidenceRequirement ?? "—",
            },
          ]}
        />
        <CheckField
          label="I understand the expected effect and the evidence requirement"
          description="Acknowledging the consequences is the first explicit step; the dispatch stays locked until both steps are complete."
          checked={acknowledged}
          onChange={confirmation.onAcknowledge}
        />
        <Field
          label="Type the confirmation phrase"
          hint={`Type exactly: ${required}`}
          error={
            state.kind === "reviewing" && state.acknowledged && state.phrase.length > 0 && state.phrase !== required
              ? "The phrase does not match yet."
              : undefined
          }
        >
          {(id) => (
            <input
              id={id}
              className="fos-input"
              type="text"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event): void => confirmation.onPhraseChange(event.target.value)}
            />
          )}
        </Field>
        <div className="fos-row">
          {state.kind === "ready_to_dispatch" ? (
            <Button variant="danger" onClick={confirmation.onDispatch}>
              Confirm and dispatch {entry?.label.toLowerCase() ?? state.context.action}
            </Button>
          ) : (
            <Button variant="primary" onClick={confirmation.onConfirm}>
              Confirm the phrase
            </Button>
          )}
          <Button variant="ghost" onClick={confirmation.onCancel}>
            Cancel
          </Button>
        </div>
        {confirmation.refusal !== undefined && (
          <AlertError
            title="The dispatch refused to proceed"
            message={`${confirmation.refusal.reason} — ${confirmation.refusal.explanation}`}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The confirmation flow's visible feedback (a click is never inferred). */
function ConfirmationFeedback({
  confirmation,
}: {
  readonly confirmation: DestructiveConfirmationPresentation;
}): JSX.Element | null {
  const state = confirmation.state;
  if (state.kind === "reviewing" || state.kind === "ready_to_dispatch") return null;
  if (state.kind === "idle") return null;
  const feedback = confirmationFeedback(state);
  const semantic =
    state.kind === "dispatched"
      ? "succeeded"
      : state.kind === "refused"
        ? "failed"
        : state.kind === "cancelled"
          ? "unknown"
          : "unknown";
  return (
    <Card title="Confirmation outcome" subtitle="The last destructive-confirmation attempt — visible, never inferred.">
      <p style={{ margin: 0 }}>
        <StatusIndicator status={semantic as "succeeded" | "failed" | "unknown"} label={`${feedback.status} — ${feedback.message}`} />
      </p>
    </Card>
  );
}

/** The case's seven-stage recovery journey (from real runtime state). */
function CaseJourneyTimeline({ journey }: { readonly journey: RecoveryCaseJourney }): JSX.Element {
  const stateOf = (stageState: string): TimelineItem["state"] =>
    stageState === "ready"
      ? "done"
      : stageState === "approval_required"
        ? "current"
        : stageState === "blocked"
          ? "blocked"
          : "pending";
  const items: TimelineItem[] = journey.stages.map((stage) => ({
    id: stage.id,
    label: stage.headline,
    detail: stage.rows.map((row) => `${row.label}: ${row.value}`).join(" · "),
    state: stateOf(stage.state),
    stateLabel:
      stage.state === "ready"
        ? undefined
        : stage.state === "not_yet_observed"
          ? "Not yet observed"
          : stage.state === "empty"
            ? "Nothing to show — honest empty"
            : stage.state === "approval_required"
              ? "Approval required"
              : "Blocked",
  }));
  return (
    <Card
      title="Recovery journey"
      subtitle="Signal, case, locate/secure decision, authorization, action, evidence, closure/escalation — every stage from real runtime state."
    >
      <Timeline items={items} ariaLabel="Recovery case journey" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** The rendered gated destructive-action screen (the gated path ONLY). */
export function DestructiveActionScreen(props: DestructiveActionScreenProps): JSX.Element {
  const { phase } = props;

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = (
      <Card title="Destructive actions">
        <Skeleton label="Loading the destructive action surface" rows={7} />
      </Card>
    );
  } else if (phase.kind === "error" || phase.kind === "invalid") {
    body = <PhasePresentation phase={phase} loadingLabel="Loading the destructive action surface" />;
  } else if (phase.view === undefined) {
    body = (
      <EmptyState
        title="No active recovery case for this device"
        hint="Destructive recovery actions are recorded against an ACTIVE recovery case. Open a case from Find My Device or the cases list first — there is no ungated path."
        action={{ label: "View recovery cases", onClick: props.onOpenCases }}
      />
    );
  } else {
    const caseView = phase.view;
    const caseSemantic = caseConsoleStatus(
      caseView.status,
      caseView.stateMachine.isActive,
      caseView.stateMachine.isTerminal,
    );
    body = (
      <>
        <Card title="Recovery case context" subtitle="The gate's precondition, visible.">
          <p style={{ margin: "0 0 0.5rem" }}>
            <StatusIndicator
              status={caseSemantic}
              label={`Case ${caseView.caseId} — ${caseView.status} — ${CONSOLE_STATUS_LABEL[caseSemantic]}`}
            />
          </p>
          <DefinitionList
            entries={[
              { term: "Device", value: <span className="fos-mono">{props.deviceId}</span> },
              { term: "Trigger", value: <span className="fos-mono">{caseView.trigger.kind}</span> },
              { term: "Case version", value: `v${caseView.version}` },
              {
                term: "Accepts destructive requests",
                value: caseView.gating.acceptsDestructive ? "Yes — the case is active" : "No — the case is not in an active state",
              },
            ]}
          />
        </Card>
        <Card
          title="Lost-device flow"
          subtitle="The recovery journey's stages — evidence, case, capabilities, verification, escalation."
        >
          <Timeline items={lostFlowTimeline(props.lostFlow)} ariaLabel="Lost device recovery flow" />
          <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
            Unsupported capabilities stay visibly unsupported — they never become disabled-looking fake
            controls.
          </p>
        </Card>
        {props.journey !== undefined && <CaseJourneyTimeline journey={props.journey} />}
        <Card title="Destructive actions" subtitle="Every action below is the gated path ONLY: tenant scope, active case, adapter capability, Guardian evaluation, human approval, execution dispatch.">
          <div className="fos-stack">
            {props.actions.map((entry) => (
              <DestructiveActionCard
                key={entry.action}
                entry={entry}
                caseMachine={caseView.stateMachine}
                onRequestAction={props.onRequestAction}
                onApproveRequest={props.onApproveRequest}
              />
            ))}
          </div>
          <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
            There is no direct-execution control on this screen: the surface contracts make one-click
            destructive execution unrepresentable. Requests route through the domain boundary, where
            authorization, idempotency, audit, and verification are enforced.
          </p>
        </Card>
        <Card title="Find the device">
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
            Review the last-seen evidence and location state before acting.
          </p>
          <Button variant="secondary" onClick={(): void => props.onOpenFindMy(props.deviceId)}>
            Open Find My Device
          </Button>
        </Card>
      </>
    );
  }

  return (
    <section className="fos-scope fos-screen" aria-label="Recovery — Destructive actions">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Recovery" }, { label: "Destructive actions", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Destructive actions</h1>
          <p className="fos-screen-subtitle">
            Gated recovery actions for <span className="fos-mono">{props.deviceId}</span> — lock, locate,
            wipe, and reboot through the full authorization path.
          </p>
        </div>
      </header>
      {body}
      {/* W141: the visible confirmation feedback — a click is never inferred. */}
      {props.confirmation !== undefined && <ConfirmationFeedback confirmation={props.confirmation} />}
      {props.confirmation !== undefined && (
        <ConfirmationDialog props={props} confirmation={props.confirmation} />
      )}
    </section>
  );
}
