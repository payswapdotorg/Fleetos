/**
 * @fleetos/web — W144: the lane screen-data builders (the feed-to-screen
 * data conversion for the lanes whose W141/W142/W143 feed data types
 * differ from their W090/W100 screen data types).
 *
 * The W141/W142/W143 composition feeds produce RAW domain records
 * (SecurityFindingRecord, GuardianEvaluationRecord, etc.); the
 * W090/W100 deep screens expect VIEW-MODEL types (FindingsListItemView,
 * GuardianDecisionPresentationView, etc.). This module bridges the gap:
 * it constructs the screen's view-model data from the REAL demo domain
 * records using the lane packages' W090/W100 builders.
 *
 * For the lanes whose feed data types match their screen data types
 * (Device Doctor, Recovery), no conversion is needed — the feed's
 * `phase` is the screen's `phase` directly.
 *
 * PURE + DETERMINISTIC: no clock, no I/O. Strict TS.
 */

import { asTenantId } from "@fleetos/contracts";
import type { TenantId } from "@fleetos/contracts";

import {
  buildFindingsListView,
  presentGuardianDecision,
  buildApprovalsQueueView,
} from "@fleetos/web-security";
import type {
  SecurityFindingRecord,
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  FindingsListItemView,
  GuardianDecisionPresentationView,
  ParkedApprovalItemView,
} from "@fleetos/web-security";

// The presentational types from the screen file (re-declared here for
// the binding site — the screen exports them).
import type {
  RemediationPlanState,
  RemediationVerification,
  SecurityDoctorData,
} from "@fleetos/web-security";

// ---------------------------------------------------------------------------
// The Security Doctor screen data (the demo's rich finding-to-evidence walk)
// ---------------------------------------------------------------------------

/**
 * Build the SecurityDoctorScreen's data from the REAL demo domain records.
 *
 * @param tenantId the acting tenant
 * @param finding the demo finding (or null when not in the tenant)
 * @param evaluation the demo Guardian evaluation (or null)
 * @param approval the demo parked approval item (or null)
 * @param planState the demo post-decision plan state (or null)
 * @param verification the demo verification record (or null)
 * @returns the screen's `SecurityDoctorData`, or null when the finding
 * is absent (the screen renders its not-found state)
 */
export function buildSecurityDoctorScreenData(input: {
  readonly tenantId: string;
  readonly finding: SecurityFindingRecord | null;
  readonly evaluation: GuardianEvaluationRecord | null;
  readonly approval: ParkedApprovalItemInput | null;
  readonly planState: {
    readonly planId: string;
    readonly tenantId: TenantId;
    readonly status: "PROPOSAL" | "ADVANCED" | "PARKED" | "APPROVED" | "REJECTED";
    readonly capability: string;
    readonly targetCount: number;
    readonly approverId?: string;
    readonly transitionedAt?: string;
    readonly executionHandoff: "downstream_dispatch" | null;
    readonly evidenceCount: number;
    readonly contentDigest: string;
  } | null;
  readonly verification: {
    readonly findingId: string;
    readonly tenantId: TenantId;
    readonly verifiedAt: string;
    readonly summary: string;
    readonly evidenceCount: number;
  } | null;
}): SecurityDoctorData | null {
  if (input.finding === null) return null;

  const scope = { tenantId: asTenantId(input.tenantId) };

  // The finding view-model (FindingsListItemView).
  const findingsResult = buildFindingsListView(scope, [input.finding]);
  if (!findingsResult.ok) return null;
  const findingItem: FindingsListItemView | undefined = findingsResult.view.items[0];
  if (findingItem === undefined) return null;

  // The Guardian decision presentation (or null).
  let decision: GuardianDecisionPresentationView | null = null;
  if (input.evaluation !== null) {
    const presented = presentGuardianDecision(scope, input.evaluation);
    if (presented.ok) decision = presented.view;
  }

  // The parked approval view-model (or null).
  let approval: ParkedApprovalItemView | null = null;
  if (input.approval !== null) {
    const approvalsResult = buildApprovalsQueueView(scope, [input.approval]);
    if (approvalsResult.ok && approvalsResult.view.items.length > 0) {
      approval = approvalsResult.view.items[0]!;
    }
  }

  // The remediation plan state (direct construction — presentational).
  let plan: RemediationPlanState | null = null;
  if (input.planState !== null) {
    plan = {
      planId: input.planState.planId,
      status: input.planState.status,
      capability: input.planState.capability,
      targetCount: input.planState.targetCount,
      ...(input.planState.approverId !== undefined ? { approverId: input.planState.approverId } : {}),
      ...(input.planState.transitionedAt !== undefined ? { transitionedAt: input.planState.transitionedAt } : {}),
      executionHandoff: input.planState.executionHandoff,
      evidenceCount: input.planState.evidenceCount,
      contentDigest: input.planState.contentDigest,
    };
  }

  // The remediation verification (direct construction — presentational).
  let verification: RemediationVerification | null = null;
  if (input.verification !== null) {
    verification = {
      verifiedAt: input.verification.verifiedAt,
      summary: input.verification.summary,
      evidenceCount: input.verification.evidenceCount,
    };
  }

  return { finding: findingItem, decision, approval, plan, verification };
}
