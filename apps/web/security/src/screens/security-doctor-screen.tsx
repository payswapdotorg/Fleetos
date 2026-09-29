/**
 * @fleetos/web-security — D1 rendered: the SecurityDoctorScreen
 * (W090B).
 *
 * The React component layer over the EXISTING pure view-models
 * (`findings-view.ts`, `guardian-decision-view.ts`,
 * `approvals-queue-view.ts` — logic untouched): the REMEDIATION
 * JOURNEY rendered as the design contract's record pattern —
 *
 *   summary -> current state -> why it matters -> recommended action
 *           -> evidence -> history
 *
 * — with the journey itself rendered as a Timeline:
 *
 *   finding -> recommendation (PROPOSAL) -> Guardian decision ->
 *   (human approval) -> action -> verified outcome
 *
 * A proposal is NEVER presented as an executed action (the
 * stop-the-line rule): the action step discloses the DOWNSTREAM
 * DISPATCH handoff, and the verified outcome carries its evidence.
 * A BLOCK decision VISUALLY STOPS the journey (the timeline's blocked
 * state).
 *
 * The composite data type is PRESENTATIONAL: the binding site
 * composes the existing view-models (finding + decision + parked
 * approval + the post-approval plan state + the verification) — no
 * business truth lives in React state.
 *
 * Exact loading/error/invalid states (design contract). Deterministic:
 * same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type { FindingsListItemView } from "../findings-view";
import type { GuardianDecisionPresentationView } from "../guardian-decision-view";
import type { ParkedApprovalItemView } from "../approvals-queue-view";
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
import { decisionConsoleStatus, planConsoleStatus, severityConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** The post-decision plan state (presentational — the binding site composes). */
export interface RemediationPlanState {
  /** The plan identity. */
  readonly planId: string;
  /** The plan status (the W041 policy-gate statuses). */
  readonly status: "PROPOSAL" | "ADVANCED" | "PARKED" | "APPROVED" | "REJECTED";
  /** The intended capability invocation per target. */
  readonly capability: string;
  /** The target count. */
  readonly targetCount: number;
  /** The approving principal (recorded by the W041 approval step). */
  readonly approverId?: string;
  /** ISO 8601 last-transition timestamp. */
  readonly transitionedAt?: string;
  /** The dispatch handoff disclosure (present on APPROVED plans). */
  readonly executionHandoff: "downstream_dispatch" | null;
  /** The number of opaque evidence artifacts on the plan. */
  readonly evidenceCount: number;
  /** The canonical content digest (opaque pass-through). */
  readonly contentDigest: string;
}

/** The verified outcome of the remediation (presentational). */
export interface RemediationVerification {
  /** ISO 8601 verification instant. */
  readonly verifiedAt: string;
  /** The machine-stable verification summary. */
  readonly summary: string;
  /** The number of verification evidence artifacts. */
  readonly evidenceCount: number;
}

/** The composite Security Doctor data (presentational composition). */
export interface SecurityDoctorData {
  /** The finding under remediation. */
  readonly finding: FindingsListItemView;
  /** The Guardian decision on the remediation request, when evaluated. */
  readonly decision: GuardianDecisionPresentationView | null;
  /** The parked approval item, when the decision parked the plan. */
  readonly approval: ParkedApprovalItemView | null;
  /** The post-decision plan state, when a plan exists. */
  readonly plan: RemediationPlanState | null;
  /** The verified outcome, when verification completed. */
  readonly verification: RemediationVerification | null;
}

export interface SecurityDoctorScreenProps {
  /** The composite view phase (loading/error/invalid/ready). */
  readonly phase: ScreenPhase<SecurityDoctorData>;
}

// ---------------------------------------------------------------------------
// The journey timeline (pure derivation over the composite data)
// ---------------------------------------------------------------------------

function journeyTimeline(data: SecurityDoctorData): readonly TimelineItem[] {
  const { finding, decision, approval, plan, verification } = data;
  const blocked = decision?.decision === "BLOCK";
  const approved = plan !== null && (plan.status === "APPROVED" || plan.status === "ADVANCED");
  const rejected = plan !== null && plan.status === "REJECTED";
  return [
    {
      id: "finding",
      label: "Finding detected",
      detail: `${finding.severity} · ${finding.code} · ${finding.evidenceCount} observation(s) at ${finding.detectedAt}`,
      state: "done",
    },
    {
      id: "recommendation",
      label: "Remediation proposed",
      detail:
        finding.remediationProposal === null
          ? "No remediation proposal attached"
          : `${finding.remediationProposal.intentKind} — a PROPOSAL, never an execution`,
      state: finding.remediationProposal === null ? "pending" : "done",
    },
    {
      id: "decision",
      label: "Contract Guardian decision",
      detail:
        decision === null
          ? "Not yet evaluated"
          : `${decision.decision}${decision.reasons.length > 0 ? ` · ${decision.reasons.length} machine-stable reason(s)` : ""} at ${decision.decidedAt}`,
      state: decision === null ? "current" : blocked ? "blocked" : "done",
    },
    {
      id: "approval",
      label: "Human approval",
      detail:
        approval === null
          ? plan !== null && plan.status === "APPROVED"
            ? `Approved${plan.approverId !== undefined ? ` by ${plan.approverId}` : ""}${plan.transitionedAt !== undefined ? ` at ${plan.transitionedAt}` : ""}`
            : blocked
              ? "Not applicable — the Guardian refused the action"
              : "Awaiting the owner decision (when parked)"
          : `Parked at ${approval.parkedAt} — held for a human decision`,
      state: blocked
        ? "pending"
        : approval !== null
          ? "current"
          : plan !== null && plan.status === "APPROVED"
            ? "done"
            : decision === null
              ? "pending"
              : decision.decision === "REQUIRE_APPROVAL"
                ? "current"
                : "pending",
    },
    {
      id: "action",
      label: "Action",
      detail:
        plan === null
          ? "No plan yet"
          : approved
            ? `Plan ${plan.status} — execution is a DOWNSTREAM DISPATCH handoff${plan.executionHandoff !== null ? "" : ""}`
            : rejected
              ? `Plan ${plan.status} — the action will not proceed`
              : `Plan ${plan.status}`,
      state: blocked || rejected ? "blocked" : approved ? "done" : "pending",
    },
    {
      id: "verification",
      label: "Verified outcome",
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
 * The SecurityDoctorScreen: the remediation journey for one finding —
 * the record pattern with the gated journey rendered as a Timeline.
 */
export function SecurityDoctorScreen(props: SecurityDoctorScreenProps): JSX.Element {
  return (
    <div className="fos-scope fos-screen">
      <ConsoleStyles />
      <Breadcrumb
        items={[
          { label: "FleetOS" },
          { label: "Security" },
          { label: "Security Doctor", current: true },
        ]}
      />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Security Doctor</h1>
          <p className="fos-screen-subtitle">
            The remediation journey — from the observed finding to the verified outcome, with every
            gate visible.
          </p>
        </div>
      </header>
      {props.phase.kind === "ready" ? (
        <SecurityDoctorBody data={props.phase.view} />
      ) : (
        <PhasePresentation phase={props.phase} loadingLabel="Loading the remediation journey" />
      )}
    </div>
  );
}

function SecurityDoctorBody(props: { readonly data: SecurityDoctorData }): JSX.Element {
  const { finding, decision, plan, verification } = props.data;
  return (
    <>
      <Card title="Summary">
        <DefinitionList
          entries={[
            { term: "Finding", value: <span className="fos-mono">{finding.title}</span> },
            { term: "Device", value: <span className="fos-mono">{finding.deviceId}</span> },
            { term: "Severity", value: <Badge>{finding.severity}</Badge> },
            { term: "Detected at", value: <span className="fos-mono">{finding.detectedAt}</span> },
            ...(plan !== null
              ? [
                  { term: "Plan", value: <span className="fos-mono">{plan.planId}</span> },
                  { term: "Capability", value: <span className="fos-mono">{plan.capability}</span> },
                  { term: "Targets", value: `${plan.targetCount} device(s)` },
                  ...(plan.approverId !== undefined
                    ? [{ term: "Approved by", value: <span className="fos-mono">{plan.approverId}</span> }]
                    : []),
                ]
              : []),
            ...(verification !== null
              ? [{ term: "Verified", value: <span className="fos-mono">{verification.verifiedAt}</span> }]
              : []),
          ]}
        />
      </Card>
      <Card title="Current state">
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
          <StatusIndicator status={severityConsoleStatus(finding.severity)} /> <Badge>{finding.severity}</Badge>
          {decision !== null && (
            <>
              {" · "}
              <StatusIndicator status={decisionConsoleStatus(decision.decision)} />{" "}
              <Badge>{decision.decision}</Badge>
            </>
          )}
          {plan !== null && (
            <>
              {" · "}
              <StatusIndicator status={planConsoleStatus(plan.status)} /> <Badge>{plan.status}</Badge>
            </>
          )}
        </p>
        {plan !== null && plan.status === "APPROVED" && (
          <p className="fos-meta" style={{ margin: 0 }}>
            The plan is APPROVED — execution is a downstream dispatch handoff, never performed on
            this surface. A proposal is never presented as an executed action.
          </p>
        )}
        {decision?.decision === "BLOCK" && (
          <p className="fos-meta" style={{ margin: 0 }}>
            The Contract Guardian REFUSED this remediation — the journey stops here. The
            machine-stable reasons are listed below.
          </p>
        )}
      </Card>
      <Card title="Why it matters">
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          {finding.severity === "CRITICAL" || finding.severity === "HIGH"
            ? `A ${finding.severity.toLowerCase()}-severity ${finding.classification} condition is open on this device. The remediation path below is gated: the Contract Guardian decides, an owner approves when required, and the outcome is verified with evidence.`
            : `A ${finding.severity.toLowerCase()}-severity ${finding.classification} condition is tracked. The gated remediation path below preserves the same discipline regardless of severity.`}
        </p>
      </Card>
      <Card title="Recommended action">
        {finding.remediationProposal === null ? (
          <p className="fos-meta" style={{ margin: 0 }}>
            No remediation proposal is attached to this finding.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
              <Badge>PROPOSAL</Badge> <span className="fos-mono">{finding.remediationProposal.intentKind}</span>
            </p>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
              {finding.remediationProposal.payload.description}
            </p>
            {decision !== null && (
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>
                Guardian gate: <Badge>{decision.decision}</Badge>{" "}
                <span className="fos-meta">
                  rule set {decision.ruleSetId} v{decision.ruleSetVersion}
                </span>
              </p>
            )}
            {decision?.reasons.length ? (
              <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1rem", fontSize: "0.8125rem" }}>
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
            ) : null}
            <p className="fos-meta" style={{ margin: 0 }}>
              No direct-execution path exists on this surface — the Guardian decides, an owner
              approves when required, and dispatch is downstream.
            </p>
          </>
        )}
      </Card>
      <Card title="Evidence" subtitle="Opaque, content-addressed artifacts">
        <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1rem", fontSize: "0.8125rem" }}>
          {finding.evidence.map((ref) => (
            <li key={ref.observationId}>
              <span className="fos-mono">{ref.observationId}</span>{" "}
              <span className="fos-meta">({ref.kind})</span>
            </li>
          ))}
          {decision?.evidence.map((ref) => (
            <li key={ref.key}>
              <span className="fos-mono">{ref.key}</span>{" "}
              <span className="fos-meta">
                ({ref.hashAlgorithm} · {ref.sizeBytes} bytes)
              </span>
            </li>
          ))}
          {plan !== null && <li className="fos-meta">{plan.evidenceCount} plan artifact(s)</li>}
          {verification !== null && (
            <li className="fos-meta">{verification.evidenceCount} verification artifact(s)</li>
          )}
        </ul>
        {verification !== null && (
          <p className="fos-meta" style={{ margin: 0 }}>
            Verified outcome: {verification.summary} at{" "}
            <span className="fos-mono">{verification.verifiedAt}</span>.
          </p>
        )}
      </Card>
      <Card title="History" subtitle="The versioned interpretation lineage">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem" }}>
          Interpretation v{finding.interpretationVersion} of finding{" "}
          <span className="fos-mono">{finding.findingId}</span> (record{" "}
          <span className="fos-mono">{finding.recordId}</span>
          {finding.supersedes !== undefined ? `, superseding ${finding.supersedes}` : ""}) —
          re-assessments append versions; priors are never rewritten.
          {plan !== null && (
            <>
              {" "}Plan content digest <span className="fos-mono">{plan.contentDigest}</span>.
            </>
          )}
        </p>
        <Timeline items={journeyTimeline(props.data)} ariaLabel="Remediation journey" />
      </Card>
    </>
  );
}
