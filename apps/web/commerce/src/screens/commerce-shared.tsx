/**
 * @fleetos/web-commerce — the shared rendered-screen helpers (W090C):
 * the composite-journey rail (D3 — structurally compatible with the
 * workload lane's `JourneyRailStageView`, declared locally per the
 * W040 seam pattern so this package stays a standalone renderable
 * component library) and the CONSEQUENTIAL-ACTION authorization card
 * (D2.7 — every consequential commerce action visibly shows
 * authorization state, policy decision, approval requirement, expected
 * effect, evidence requirement, execution state and verification
 * result; a proposal is NEVER presented as an executed action).
 *
 * PRESENTATIONAL ONLY: props in, JSX out; fully controlled; same props
 * -> byte-identical output. No clock, no randomness, no I/O.
 */

import type { JSX } from "react";
import { Button, Card, DefinitionList, StatusIndicator } from "../ui/primitives";
import { CONSOLE_STATUS_LABEL, journeyStageConsoleStatus } from "../ui/status";
import type { ConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// The composite journey rail (D3)
// ---------------------------------------------------------------------------

/**
 * One commerce-side journey rail stage (structurally compatible with
 * the workload lane's `JourneyRailStageView` — the shell passes the
 * workload lane's rail straight through; assignability is proven by
 * test).
 */
export interface CommerceJourneyRailStage {
  readonly stageId: string;
  readonly title: string;
  readonly state: "done" | "current" | "pending" | "approval" | "blocked";
  readonly summary: string;
  readonly recordRef: string | null;
  readonly evidenceRefs: readonly string[];
}

export interface CommerceJourneyRailProps {
  readonly stages: readonly CommerceJourneyRailStage[];
  readonly onOpenStage?: (stageId: string) => void;
}

const JOURNEY_RAIL_TITLE = "Journey — workload plan to verified connectivity";

/** The journey rail every commerce stage screen renders when supplied. */
export function CommerceJourneyRail({
  stages,
  onOpenStage,
}: CommerceJourneyRailProps): JSX.Element {
  return (
    <Card
      title={JOURNEY_RAIL_TITLE}
      subtitle="Each stage shows its record and evidence; navigation follows the machine-stable stage order."
    >
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
// The consequential-action authorization card (D2.7)
// ---------------------------------------------------------------------------

/**
 * The full authorization descriptor of one consequential commerce
 * action. Every field is display text derived by the shell from the
 * machine-stable domain records — the card renders, never decides.
 */
export interface ConsequentialActionDescriptor {
  /** The action's operator-facing name (e.g. "Quote acceptance"). */
  readonly action: string;
  /** The authorization boundary (e.g. "Intent boundary (procurement)"). */
  readonly authorization: string;
  /** The policy/Guardian decision, when one applies. */
  readonly policyDecision: string | null;
  /** Whether a human approval is required, and which. */
  readonly approvalRequired: string;
  /** The action's expected effect. */
  readonly expectedEffect: string;
  /** The evidence the action requires. */
  readonly evidenceRequired: string;
  /** The execution state text (e.g. "Not executed — proposal"). */
  readonly executionState: string;
  /** The execution state's console status. */
  readonly executionStatus: ConsoleStatus;
  /** The verification result text, when verification exists. */
  readonly verification: string | null;
  /** The verification result's console status. */
  readonly verificationStatus: ConsoleStatus | null;
}

/**
 * The consequential-action authorization card: the seven visible
 * facets of every consequential commerce action (authorization state,
 * policy decision, approval requirement, expected effect, evidence
 * requirement, execution state, verification result) — plus the
 * explicit "a proposal is never an executed action" note.
 */
export function ConsequentialActionCard({
  descriptor,
}: {
  readonly descriptor: ConsequentialActionDescriptor;
}): JSX.Element {
  return (
    <Card
      title={`Action authorization — ${descriptor.action}`}
      subtitle="A proposal is never presented as an executed action: the execution and verification states below are the machine-stable record."
    >
      <DefinitionList
        entries={[
          { term: "Authorization", value: descriptor.authorization },
          {
            term: "Policy decision",
            value: descriptor.policyDecision ?? "No policy decision applies to this action.",
          },
          { term: "Approval required", value: descriptor.approvalRequired },
          { term: "Expected effect", value: descriptor.expectedEffect },
          { term: "Evidence required", value: descriptor.evidenceRequired },
          {
            term: "Execution state",
            value: (
              <StatusIndicator
                status={descriptor.executionStatus}
                label={`${descriptor.executionState} — ${CONSOLE_STATUS_LABEL[descriptor.executionStatus]}`}
              />
            ),
          },
          ...(descriptor.verification !== null
            ? [
                {
                  term: "Verification result",
                  value: (
                    <StatusIndicator
                      status={descriptor.verificationStatus ?? "unknown"}
                      label={`${descriptor.verification} — ${CONSOLE_STATUS_LABEL[descriptor.verificationStatus ?? "unknown"]}`}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}
