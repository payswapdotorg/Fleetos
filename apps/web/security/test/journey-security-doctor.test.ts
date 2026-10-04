/**
 * W142 web-security — the Security Doctor JOURNEY view-model tests.
 *
 * The nine-stage finding-to-evidence walk:
 *
 *   finding -> inspect -> proposed remediation -> Contract Guardian
 *   decision -> approval -> human confirmation -> execution ->
 *   evidence -> verified result
 *
 * Every stage state is HONEST and derived from real runtime state only
 * (the real-observations-only doctrine): `not_yet_observed`,
 * `approval_required`, `blocked` are all first-class states — never
 * fabricated observations.
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId, asObservationId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  buildSecurityDoctorJourney,
  SECURITY_DOCTOR_JOURNEY_HEADLINES,
  SECURITY_DOCTOR_JOURNEY_STAGES,
} from "../src/index";
import type {
  DecisionPlanState,
  SecurityRemediationRequestLike,
  VerificationRecord,
} from "../src/index";
import type {
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  SecurityFindingRecord,
} from "../src/surface-contracts";

const TENANT = makeTenantId("w142-jrn");
const DEVICE = asDeviceId("dev_w142_jrna1");
const NOW = "2026-04-01T00:00:00Z";

/** A finding with the basic shape. */
function finding(overrides: Partial<SecurityFindingRecord> = {}): SecurityFindingRecord {
  return {
    findingId: overrides.findingId ?? "sec_w142_jrn",
    recordId: overrides.recordId ?? "secfnd_w142_jrn_v1",
    tenantId: overrides.tenantId ?? TENANT,
    deviceId: overrides.deviceId ?? DEVICE,
    code: overrides.code ?? "security.device.disk_encryption.off",
    title: overrides.title ?? "Disk encryption is off",
    severity: overrides.severity ?? "HIGH",
    classification: overrides.classification ?? "configuration",
    interpretationVersion: overrides.interpretationVersion ?? 1,
    detectedAt: overrides.detectedAt ?? NOW,
    observedAt: overrides.observedAt ?? NOW,
    evidence: overrides.evidence ?? [
      { observationId: asObservationId("obs_w142_jrn_1"), kind: "device.security" },
    ],
    remediation: overrides.remediation,
  };
}

/** A Guardian evaluation with the REQUIRE_APPROVAL decision (default). */
function evaluation(
  decisionType: GuardianEvaluationRecord["decision"]["decision"] = "REQUIRE_APPROVAL",
): GuardianEvaluationRecord {
  return {
    decision: {
      tenantId: TENANT,
      decision: decisionType,
      rules: [],
      evidence: [],
      decidedAt: NOW,
      schemaVersion: 1,
    },
    ruleSetId: "w142-ruleset",
    ruleSetVersion: 1,
    matchedRules: [],
    reasons: [],
  };
}

/** A parked-approval item input. */
function approvalItem(): ParkedApprovalItemInput {
  return {
    plan: {
      planId: "plan_w142_jrn",
      tenantId: TENANT,
      name: "w142-journey-plan",
      version: 2,
      status: "PARKED",
      capability: "lock",
      targetCount: 1,
      createdAt: NOW,
      transitionedAt: NOW,
    },
    evaluation: evaluation("REQUIRE_APPROVAL"),
  };
}

/** A post-decision plan state. */
function planState(
  overrides: Partial<DecisionPlanState>,
): DecisionPlanState {
  // The default is APPROVED; for REJECTED, the caller passes the
  // status override AND the rejectionReason (and removes approverId).
  const status = overrides.status ?? "APPROVED";
  const isRejected = status === "REJECTED";
  return {
    planId: overrides.planId ?? "plan_w142_jrn",
    tenantId: overrides.tenantId ?? TENANT,
    status,
    capability: overrides.capability ?? "lock",
    targetCount: overrides.targetCount ?? 1,
    approverId: isRejected ? overrides.approverId : (overrides.approverId ?? asUserId("usr_w142_jrn_appr")),
    rejectionReason: overrides.rejectionReason ?? (isRejected ? "operator_rejected" : undefined),
    transitionedAt: overrides.transitionedAt ?? NOW,
    executionHandoff: overrides.executionHandoff ?? (status === "APPROVED" ? "downstream_dispatch" : null),
    evidenceCount: overrides.evidenceCount ?? 1,
    contentDigest: overrides.contentDigest ?? "digest_w142_jrn",
  };
}

/** A verification record. */
function verificationRecord(): VerificationRecord {
  return {
    findingId: "sec_w142_jrn",
    tenantId: TENANT,
    verifiedAt: NOW,
    summary: "Disk encryption verified — on",
    evidenceCount: 1,
  };
}

/** A remediation request. */
function remediationRequest(
  overrides: Partial<SecurityRemediationRequestLike> = {},
): SecurityRemediationRequestLike {
  return {
    findingId: overrides.findingId ?? "sec_w142_jrn",
    tenantId: overrides.tenantId ?? TENANT,
    deviceId: overrides.deviceId ?? DEVICE,
    intentKind: overrides.intentKind ?? "SecurityRemediationIntent",
    disposition: overrides.disposition ?? "accepted",
    status: overrides.status ?? "PARKED",
    requestedAt: overrides.requestedAt ?? NOW,
    requestedBy: overrides.requestedBy ?? "usr_w142_jrn_req",
    planId: overrides.planId ?? "plan_w142_jrn",
    decidedAt: overrides.decidedAt ?? NOW,
    outcome: overrides.outcome,
    executedAt: overrides.executedAt,
    evidence: overrides.evidence ?? [
      { key: "evidence/w142-jrn-1", sizeBytes: 128, hash: "0123", hashAlgorithm: "sha256" },
    ],
    contentDigest: overrides.contentDigest ?? "digest_w142_jrn",
  };
}

describe("W142 journey: the nine stages are in the frozen canonical order", () => {
  test("the stage ids match the canonical journey order", () => {
    expect([...SECURITY_DOCTOR_JOURNEY_STAGES]).toEqual([
      "finding",
      "inspect",
      "proposed_remediation",
      "guardian_decision",
      "approval",
      "human_confirmation",
      "execution",
      "evidence",
      "verified_result",
    ]);
  });

  test("the headlines are the frozen vocabulary", () => {
    expect(SECURITY_DOCTOR_JOURNEY_HEADLINES.finding).toBe("Finding detected");
    expect(SECURITY_DOCTOR_JOURNEY_HEADLINES.verified_result).toBe("Verified outcome");
  });
});

describe("W142 journey: the not-evaluated finding composes the not-yet-observed states", () => {
  test("a finding with no evaluation, no plan, no verification composes the honest not-yet-observed states", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: undefined,
      remediationRequests: [],
      parkedApproval: undefined,
      planState: undefined,
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("finding")?.state).toBe("ready");
    expect(byId.get("inspect")?.state).toBe("ready");
    expect(byId.get("proposed_remediation")?.state).toBe("empty"); // no remediation attached
    expect(byId.get("guardian_decision")?.state).toBe("not_yet_observed");
    expect(byId.get("approval")?.state).toBe("not_yet_observed");
    expect(byId.get("human_confirmation")?.state).toBe("not_yet_observed");
    expect(byId.get("execution")?.state).toBe("not_yet_observed");
    expect(byId.get("evidence")?.state).toBe("not_yet_observed");
    expect(byId.get("verified_result")?.state).toBe("not_yet_observed");
    expect(journey.approvalPending).toBe(false);
    expect(journey.decisionState).toBe("not_evaluated");
  });

  test("a finding with no evidence composes the empty inspect stage", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding({ evidence: [] }),
      evaluation: undefined,
      remediationRequests: [],
      parkedApproval: undefined,
      planState: undefined,
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("inspect")?.state).toBe("empty");
  });
});

describe("W142 journey: the REQUIRE_APPROVAL evaluation composes the approval_required stage", () => {
  test("a parked plan + evaluation composes the approval_required stage and the parked state", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: evaluation("REQUIRE_APPROVAL"),
      remediationRequests: [remediationRequest()],
      parkedApproval: approvalItem(),
      planState: undefined, // still parked
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("guardian_decision")?.state).toBe("ready");
    expect(byId.get("approval")?.state).toBe("approval_required");
    expect(byId.get("human_confirmation")?.state).toBe("approval_required");
    // No plan state yet (still parked) — the execution hasn't been
    // attempted; the honest execution-stage state is not_yet_observed.
    expect(byId.get("execution")?.state).toBe("not_yet_observed");
    expect(byId.get("evidence")?.state).toBe("ready");
    expect(byId.get("verified_result")?.state).toBe("not_yet_observed");
    expect(journey.approvalPending).toBe(true);
    expect(journey.decisionState).toBe("parked");
  });
});

describe("W142 journey: the APPROVED plan composes the executed + verified stages", () => {
  test("an approved plan + verification composes the ready execution + verification stages", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: evaluation("REQUIRE_APPROVAL"),
      remediationRequests: [
        remediationRequest({ status: "EXECUTED", outcome: "executed" }),
      ],
      parkedApproval: approvalItem(),
      planState: planState({ status: "APPROVED" }),
      verification: verificationRecord(),
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("human_confirmation")?.state).toBe("ready");
    expect(byId.get("execution")?.state).toBe("ready");
    expect(byId.get("evidence")?.state).toBe("ready");
    expect(byId.get("verified_result")?.state).toBe("ready");
    expect(journey.approvalPending).toBe(false);
    expect(journey.decisionState).toBe("approved");
  });
});

describe("W142 journey: the REJECTED plan composes the rejected state (never auto-executed)", () => {
  test("a rejected plan surfaces the operator_rejected reason visibly", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: evaluation("REQUIRE_APPROVAL"),
      remediationRequests: [remediationRequest({ status: "REJECTED", disposition: "dismissed" })],
      parkedApproval: approvalItem(),
      planState: planState({
        status: "REJECTED",
        approverId: undefined,
        rejectionReason: "operator_rejected",
      }),
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("human_confirmation")?.state).toBe("ready");
    expect(byId.get("execution")?.state).toBe("blocked"); // REJECTED — never executed
    expect(journey.decisionState).toBe("rejected");
    // The rejection reason is visible in the rows.
    const confirmationStage = byId.get("human_confirmation");
    expect(confirmationStage?.rows.some((r) => r.value === "operator_rejected")).toBe(true);
  });
});

describe("W142 journey: the BLOCK decision composes the blocked state", () => {
  test("a BLOCK evaluation stops the journey visibly (no execution)", () => {
    // The W041 decision-to-status mapping: BLOCK -> REJECTED. The
    // binding site links them, so the plan state is REJECTED.
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: evaluation("BLOCK"),
      remediationRequests: [],
      parkedApproval: undefined,
      planState: planState({ status: "REJECTED", rejectionReason: "guardian_blocked" }),
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("guardian_decision")?.state).toBe("ready");
    expect(byId.get("approval")?.state).toBe("empty"); // BLOCK — no approval required
    expect(byId.get("human_confirmation")?.state).toBe("empty");
    expect(byId.get("execution")?.state).toBe("blocked"); // REJECTED — never executed
    expect(journey.decisionState).toBe("blocked");
  });
});

describe("W142 journey: the ALLOW/WARN decision composes the approved state (advanced past the gate)", () => {
  test("an ALLOW evaluation advances the journey (no human approval required)", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_jrn", {
      finding: finding(),
      evaluation: evaluation("ALLOW"),
      remediationRequests: [],
      parkedApproval: undefined,
      planState: undefined,
      verification: undefined,
      now: NOW,
    });
    expect(journey.decisionState).toBe("approved");
  });
});

describe("W142 journey: the blocked finding (not in the acting tenant) is honest", () => {
  test("a missing finding composes the blocked finding + inspect stages", () => {
    const journey = buildSecurityDoctorJourney({ tenantId: TENANT }, "sec_w142_foreign", {
      finding: undefined,
      evaluation: undefined,
      remediationRequests: [],
      parkedApproval: undefined,
      planState: undefined,
      verification: undefined,
      now: NOW,
    });
    const byId = new Map(journey.stages.map((s) => [s.id, s]));
    expect(byId.get("finding")?.state).toBe("blocked");
    expect(byId.get("inspect")?.state).toBe("blocked");
    expect(byId.get("proposed_remediation")?.state).toBe("blocked");
    expect(journey.deviceId).toBe("");
  });
});
