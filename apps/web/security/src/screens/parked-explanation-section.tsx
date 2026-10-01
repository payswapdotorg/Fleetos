/**
 * @fleetos/web-security — W100B rendered: the ParkedExplanationSection.
 *
 * The "why is this action parked, and what unlocks it?" card: the
 * decision chain (REQUIRE_APPROVAL, the rules that fired, the
 * machine-stable reason codes, the policy version, the evidence links)
 * and the human-decision gate (the approve/reject transitions, the
 * permission a deciding session must hold, whether THIS session may
 * decide — authority-derived — and the escalation path when it may
 * not).
 *
 * Presentational and fully controlled; deterministic. The section
 * NEVER decides: the gated transitions and the confirmation flow stay
 * with the ApprovalsQueueScreen (the W041 `approveParkedPlan` step is
 * invoked by the binding site).
 */

import type { JSX } from "react";
import type { ParkedExplanationView } from "../approval-explanation-view";
import { Badge, Card, DefinitionList } from "../ui/primitives";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParkedExplanationSectionProps {
  /** The parked-approval explanation view (from `buildParkedExplanationView`). */
  readonly explanation: ParkedExplanationView;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/**
 * The ParkedExplanationSection: WHY the plan is parked + WHAT unlocks
 * it. Rendered by the approvals queue screen (optional — absent
 * renders exactly the W090B screen).
 */
export function ParkedExplanationSection(props: ParkedExplanationSectionProps): JSX.Element {
  const { explanation } = props;
  const { whyParked, whatUnlocksIt } = explanation;
  return (
    <section aria-label={`Why plan ${explanation.planId} is parked`} data-testid={`parked-explanation-${explanation.planId}`}>
      <Card title="Why this action is parked" subtitle="The Contract Guardian decision chain">
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem" }}>{whyParked.summary}</p>
        <DefinitionList
          entries={[
            {
              term: "Decision",
              value: (
                <span className="fos-row">
                  <Badge>{whyParked.decision}</Badge>
                </span>
              ),
            },
            { term: "Decided at", value: <span className="fos-mono">{whyParked.decidedAt}</span> },
            { term: "Policy version", value: <span className="fos-mono">{whyParked.policyVersion}</span> },
            {
              term: "Rules that fired",
              value:
                whyParked.rules.length === 0
                  ? "none recorded"
                  : whyParked.rules
                      .map((rule) => `${rule.ruleId} v${rule.ruleVersion} (${rule.effect})`)
                      .join("; "),
            },
            {
              term: "Reasons (machine-stable)",
              value:
                whyParked.reasonCodes.length === 0
                  ? "none recorded"
                  : whyParked.reasonCodes.join(", "),
            },
            {
              term: "Evidence links",
              value: `${whyParked.evidenceLinks.length} opaque artifact(s): ${whyParked.evidenceLinks
                .map((link) => link.key)
                .join(", ") || "none"}`,
            },
          ]}
        />
      </Card>
      <Card title="What unlocks it" subtitle="The human-decision gate">
        <DefinitionList
          entries={[
            { term: "Gate", value: <span className="fos-mono">{whatUnlocksIt.gate}</span> },
            {
              term: "Transitions",
              value: whatUnlocksIt.transitions
                .map((transition) => `${transition.action} -> ${transition.to} (confirmation required)`)
                .join("; "),
            },
            {
              term: "Required permission",
              value: <span className="fos-mono">{whatUnlocksIt.decidePermission}</span>,
            },
            {
              term: "This session",
              value: whatUnlocksIt.sessionMayDecide ? "may decide (authority-derived)" : "may NOT decide (authority-derived)",
            },
          ]}
        />
        {whatUnlocksIt.sessionMayDecide ? (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }} data-testid="session-may-decide">
            Your effective authority includes the deciding permission. Both transitions are gated on
            a human decision and require confirmation — they are never one-click.
          </p>
        ) : (
          <p className="fos-meta" style={{ margin: "0.5rem 0 0" }} data-testid="session-may-not-decide">
            {whatUnlocksIt.escalationCopy}
          </p>
        )}
        <p className="fos-meta" style={{ margin: "0.35rem 0 0" }}>
          This explanation grants nothing (grantsAnything: {String(explanation.grantsAnything)}).
        </p>
      </Card>
    </section>
  );
}
