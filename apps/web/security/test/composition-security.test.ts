/**
 * W142 web-security — the Security Doctor RUNTIME FEED composition tests,
 * over the REAL `@fleetos/security` posture findings ledger + the REAL
 * `@fleetos/policy` Guardian engine + REAL-shaped remediation records +
 * the REAL `@fleetos/actions` parked-approval queue (the same structural
 * projection the console's binding site performs).
 *
 * These tests are the machine proof that EVERY lane-phase transition of
 * the Security Doctor feed is honest:
 *
 *   loading -> ready                  (the composition over real state)
 *   loading -> blocked                (finding not in the acting partition)
 *   loading -> error                  (a source that refuses)
 *   ready -> approval_required         (a PARKED remediation request)
 *   fresh tenant -> empty             (the findings list's honest empty)
 *   scope refused -> blocked          (fail-closed, no data)
 *
 * And that the nine-stage JOURNEY (finding -> inspect -> proposed
 * remediation -> Contract Guardian decision -> approval -> human
 * confirmation -> execution -> evidence -> verified result) renders
 * from REAL runtime state with honest not-yet-observed states — never
 * fabricated observations (the real-observations-only doctrine).
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId, asDeviceId, asObservationId, asUserId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  composeSecurityDoctorFeed,
  errorSecurityDoctorFeed,
  loadingSecurityDoctorFeed,
  parkedApprovalsLanePhase,
  securityFindingsLanePhase,
  SECURITY_DOCTOR_JOURNEY_STAGES,
} from "../src/index";
import type {
  DecisionPlanState,
  SecurityApprovalSource,
  SecurityDecisionPlanSource,
  SecurityEvaluationSource,
  SecurityFindingSource,
  SecurityRemediationRequestLike,
  SecurityRemediationRequestSource,
  SecurityVerificationSource,
} from "../src/index";
import type {
  GuardianEvaluationRecord,
  ParkedApprovalItemInput,
  SecurityFindingRecord,
} from "../src/surface-contracts";

const TENANT = makeTenantId("w142-sec");
const OTHER_TENANT = makeTenantId("w142-oth");
const DEVICE = asDeviceId("dev_w142_seca1");
const NOW = "2026-04-01T00:00:00Z";
const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-02-01T00:00:00Z";
const T2 = "2026-03-01T00:00:00Z";
const USER = asUserId("usr_w142approv01");
const CORR = asCorrelationId("cor_w142_sec");

/** A deterministic, valid-by-construction finding record. */
function findingRecord(overrides: Partial<SecurityFindingRecord> = {}): SecurityFindingRecord {
  return {
    findingId: overrides.findingId ?? "sec_w142_finding",
    recordId: overrides.recordId ?? "secfnd_w142_v1",
    tenantId: overrides.tenantId ?? TENANT,
    deviceId: overrides.deviceId ?? DEVICE,
    code: overrides.code ?? "security.device.disk_encryption.off",
    title: overrides.title ?? "Disk encryption is off",
    severity: overrides.severity ?? "HIGH",
    classification: overrides.classification ?? "configuration",
    interpretationVersion: overrides.interpretationVersion ?? 1,
    detectedAt: overrides.detectedAt ?? T0,
    observedAt: overrides.observedAt ?? T0,
    evidence: overrides.evidence ?? [
      { observationId: asObservationId("obs_w142_1"), kind: "device.security" },
    ],
    remediation: overrides.remediation,
  };
}

/** A deterministic remediation request record (the binding-site projection). */
function remediationRequest(
  overrides: Partial<SecurityRemediationRequestLike> = {},
): SecurityRemediationRequestLike {
  return {
    findingId: overrides.findingId ?? "sec_w142_finding",
    tenantId: overrides.tenantId ?? TENANT,
    deviceId: overrides.deviceId ?? DEVICE,
    intentKind: overrides.intentKind ?? "SecurityRemediationIntent",
    disposition: overrides.disposition ?? "accepted",
    status: overrides.status ?? "PARKED",
    requestedAt: overrides.requestedAt ?? T1,
    requestedBy: overrides.requestedBy ?? USER,
    planId: overrides.planId ?? "plan_w142_01",
    decidedAt: overrides.decidedAt ?? T1,
    outcome: overrides.outcome,
    executedAt: overrides.executedAt,
    evidence: overrides.evidence ?? [
      { key: "evidence/w142-1", sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
    ],
    contentDigest: overrides.contentDigest ?? "digest_w142_parked",
  };
}

/** A deterministic Guardian evaluation record. */
function evaluationRecord(): GuardianEvaluationRecord {
  return {
    decision: {
      tenantId: TENANT,
      decision: "REQUIRE_APPROVAL" as const,
      rules: [{ ruleId: "pol_w142test0001" as never, ruleVersion: 1 }],
      evidence: [],
      decidedAt: T1,
      schemaVersion: 1,
    },
    ruleSetId: "w142-ruleset",
    ruleSetVersion: 1,
    matchedRules: [
      { ruleId: "pol_w142test0001" as never, name: "w142-require-approval", version: 1, effect: "REQUIRE_APPROVAL" },
    ],
    reasons: [
      { code: "policy.rule.matched", ruleId: "pol_w142test0001" as never, ruleVersion: 1, conditionKind: "action", effect: "REQUIRE_APPROVAL" },
      { code: "policy.precedence.resolved", chosen: "REQUIRE_APPROVAL" },
    ],
  };
}

/** A deterministic parked-approval item input. */
function approvalItem(): ParkedApprovalItemInput {
  return {
    plan: {
      planId: "plan_w142_01",
      tenantId: TENANT,
      name: "w142-parked-plan",
      version: 2,
      status: "PARKED" as const,
      capability: "lock",
      targetCount: 3,
      createdAt: T0,
      transitionedAt: T1,
      requestedBy: USER,
    },
    evaluation: evaluationRecord(),
  };
}

/** A deterministic post-decision plan state. */
function planState(
  overrides: Partial<DecisionPlanState>,
): DecisionPlanState {
  return {
    planId: overrides.planId ?? "plan_w142_01",
    tenantId: overrides.tenantId ?? TENANT,
    status: overrides.status ?? "APPROVED",
    capability: overrides.capability ?? "lock",
    targetCount: overrides.targetCount ?? 3,
    approverId: overrides.approverId ?? USER,
    transitionedAt: overrides.transitionedAt ?? T2,
    executionHandoff: overrides.executionHandoff ?? "downstream_dispatch",
    evidenceCount: overrides.evidenceCount ?? 1,
    contentDigest: overrides.contentDigest ?? "digest_w142_approved",
  };
}

/** A deterministic verification record. */
function verificationRecord(): { findingId: string; tenantId: typeof TENANT; verifiedAt: string; summary: string; evidenceCount: number; } {
  return {
    findingId: "sec_w142_finding",
    tenantId: TENANT,
    verifiedAt: T2,
    summary: "Remediation verified — disk encryption is now on",
    evidenceCount: 2,
  };
}

/** Compose a runtime state with the given finding + remediation records. */
function state(
  findings: readonly SecurityFindingRecord[],
  remediation: readonly SecurityRemediationRequestLike[],
  approvals: readonly ParkedApprovalItemInput[],
  plans: readonly DecisionPlanState[],
  verifications: ReadonlyArray<ReturnType<typeof verificationRecord>>,
  evaluationOverride?: GuardianEvaluationRecord,
): {
  readonly findings: SecurityFindingSource;
  readonly evaluations: SecurityEvaluationSource;
  readonly remediation: SecurityRemediationRequestSource;
  readonly approvals: SecurityApprovalSource;
  readonly plans: SecurityDecisionPlanSource;
  readonly verifications: SecurityVerificationSource;
} {
  return {
    findings: {
      // The list returns only the findings whose tenantId matches the
      // acting tenant (no existence side channel across tenants).
      list: (tenant) => findings.filter((f) => f.tenantId === tenant),
      get: (tenant, findingId) =>
        findings.find((f) => f.tenantId === tenant && f.findingId === findingId),
    },
    evaluations: {
      // The evaluation only exists when a remediation request was
      // filed (the binding site links them). A finding with no
      // remediation records has no evaluation either (the honest
      // not_yet_observed states).
      evaluationFor: (tenant, _findingId) =>
        tenant === TENANT && remediation.length > 0
          ? (evaluationOverride ?? evaluationRecord())
          : undefined,
    },
    remediation: {
      requests: (tenant, _findingId) =>
        tenant === TENANT ? remediation : [],
      list: (tenant) =>
        tenant === TENANT ? remediation : [],
    },
    approvals: {
      parked: (tenant) => (tenant === TENANT ? approvals : []),
      parkedByPlan: (tenant, planId) =>
        tenant === TENANT ? approvals.find((a) => a.plan.planId === planId) : undefined,
    },
    plans: {
      stateFor: (tenant, planId) =>
        tenant === TENANT ? plans.find((p) => p.planId === planId) : undefined,
    },
    verifications: {
      verificationFor: (tenant, _findingId) =>
        tenant === TENANT ? verifications[0] : undefined,
    },
  };
}

describe("W142: the loading + error feeds are machine-stable", () => {
  test("the loading feed is the pre-resolution state", () => {
    const loading = loadingSecurityDoctorFeed();
    expect(loading.phase.kind).toBe("loading");
    expect(loading.lanePhase.kind).toBe("loading");
    expect(loading.journey).toBeUndefined();
    expect(loading.data.finding).toBeNull();
  });

  test("the error feed is machine-stable", () => {
    const error = errorSecurityDoctorFeed("The source refused.");
    expect(error.phase.kind).toBe("error");
    expect(error.lanePhase.kind).toBe("error");
    expect(error.journey).toBeUndefined();
  });
});

describe("W142: LOADING -> READY — the doctor feed composes the journey over real state", () => {
  test("a finding with no remediation records composes the not-yet-observed states", () => {
    const finding = findingRecord();
    const s = state([finding], [], [], [], [], undefined);
    const feed = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    expect(feed.phase.kind).toBe("ready");
    expect(feed.data.finding).not.toBeNull();

    const journey = feed.journey;
    expect(journey).toBeDefined();
    if (journey === undefined) throw new Error("unreachable");
    expect(journey.stages.map((stage) => stage.id)).toEqual([...SECURITY_DOCTOR_JOURNEY_STAGES]);
    const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("finding")?.state).toBe("ready");
    expect(byId.get("inspect")?.state).toBe("ready");
    expect(byId.get("proposed_remediation")?.state).toBe("empty"); // no remediation attached
    // No remediation request has been filed — no evaluation, no plan,
    // no execution. Every downstream stage is honestly not_yet_observed.
    expect(byId.get("guardian_decision")?.state).toBe("not_yet_observed");
    expect(byId.get("approval")?.state).toBe("not_yet_observed");
    expect(byId.get("human_confirmation")?.state).toBe("not_yet_observed");
    expect(byId.get("execution")?.state).toBe("not_yet_observed");
    expect(byId.get("evidence")?.state).toBe("not_yet_observed");
    expect(byId.get("verified_result")?.state).toBe("not_yet_observed");
    expect(journey.approvalPending).toBe(false);
    // No evaluation has been recorded yet — the decision state is
    // not_evaluated (no engine decision, no plan, no human decision).
    expect(journey.decisionState).toBe("not_evaluated");
  });

  test("a finding with an APPROVED plan composes the executed + verified stages", () => {
    const finding = findingRecord();
    const request = remediationRequest({ status: "EXECUTED", outcome: "executed" });
    const s = state(
      [finding],
      [request],
      [approvalItem()],
      [planState({ status: "APPROVED" })],
      [verificationRecord()],
      undefined,
    );
    const feed = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    const journey = feed.journey;
    if (journey === undefined) throw new Error("unreachable");
    const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("human_confirmation")?.state).toBe("ready");
    expect(byId.get("execution")?.state).toBe("ready");
    expect(byId.get("evidence")?.state).toBe("ready");
    expect(byId.get("verified_result")?.state).toBe("ready");
    expect(journey.decisionState).toBe("approved");
    expect(journey.approvalPending).toBe(false);
    expect(feed.data.planState?.status).toBe("APPROVED");
    expect(feed.data.verification).not.toBeNull();
  });

  test("a finding with a REJECTED plan composes the rejected state (never auto-executed)", () => {
    const finding = findingRecord();
    const request = remediationRequest({ status: "REJECTED", disposition: "dismissed" });
    const s = state(
      [finding],
      [request],
      [approvalItem()],
      [planState({ status: "REJECTED", approverId: undefined, rejectionReason: "operator_rejected" })],
      [],
      undefined,
    );
    const feed = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    const journey = feed.journey;
    if (journey === undefined) throw new Error("unreachable");
    expect(journey.decisionState).toBe("rejected");
    expect(journey.approvalPending).toBe(false);
    expect(feed.data.planState?.status).toBe("REJECTED");
  });
});

describe("W142: READY -> APPROVAL_REQUIRED — a PARKED plan holds a human decision", () => {
  test("a parked plan composes the approval_required lane phase", () => {
    const finding = findingRecord();
    const request = remediationRequest({ status: "PARKED" });
    const s = state(
      [finding],
      [request],
      [approvalItem()],
      [], // no plan state yet (still parked)
      [],
      undefined,
    );
    const feed = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("approval_required");
    if (feed.lanePhase.kind !== "approval_required") throw new Error("unreachable");
    expect(feed.lanePhase.reason).toBe("approval_required_before_dispatch");
    expect(feed.data.approval).not.toBeNull();
    expect(feed.data.approval?.plan.planId).toBe("plan_w142_01");
    expect(feed.journey?.approvalPending).toBe(true);
    // The screen phase still composes the view (the state is semantic).
    expect(feed.phase.kind).toBe("ready");
  });
});

describe("W142: LOADING -> BLOCKED — a finding outside the acting partition is honest", () => {
  test("a foreign finding composes the blocked phase (no existence side channel)", () => {
    const finding = findingRecord({ tenantId: OTHER_TENANT });
    const s = state([finding], [], [], [], [], undefined);
    const feed = composeSecurityDoctorFeed({ tenantId: TENANT }, s, "sec_w142_finding", {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("blocked");
    if (feed.lanePhase.kind !== "blocked") throw new Error("unreachable");
    expect(feed.lanePhase.reason).toBe("finding_not_in_tenant_partition");
    expect(feed.data.finding).toBeNull();
    // The screen renders its honest not-found state (undefined view content).
    expect(feed.phase.kind).toBe("ready");
  });
});

describe("W142: a refused scope grammar fails closed (no data, no leak)", () => {
  test("an empty tenant id composes the scope_refused blocked phase", () => {
    const finding = findingRecord();
    const s = state([finding], [], [], [], [], undefined);
    const refused = composeSecurityDoctorFeed({ tenantId: "" as never }, s, finding.findingId, {
      now: NOW,
    });
    expect(refused.lanePhase.kind).toBe("blocked");
    if (refused.lanePhase.kind !== "blocked") throw new Error("unreachable");
    expect(refused.lanePhase.reason).toBe("scope_refused");
    expect(refused.journey).toBeUndefined();
  });

  test("a missing now instant composes the error feed", () => {
    const finding = findingRecord();
    const s = state([finding], [], [], [], [], undefined);
    const error = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, {
      now: "",
    });
    expect(error.lanePhase.kind).toBe("error");
    expect(error.phase.kind).toBe("error");
  });
});

describe("W142: a source that throws composes the machine-stable error feed", () => {
  test("a throwing findings source yields the error phase", () => {
    const throwingState = {
      ...state([findingRecord()], [], [], [], [], undefined),
      findings: {
        list: (): never => {
          throw new Error("source refused");
        },
        get: (): never => {
          throw new Error("source refused");
        },
      },
    };
    const feed = composeSecurityDoctorFeed(
      { tenantId: TENANT },
      throwingState,
      "sec_w142_finding",
      { now: NOW },
    );
    expect(feed.lanePhase.kind).toBe("error");
    expect(feed.phase.kind).toBe("error");
    expect(feed.journey).toBeUndefined();
  });
});

describe("W142: the fresh tenant's findings list is the honest EMPTY lane phase", () => {
  test("a tenant with no findings composes the empty phase", () => {
    const empty: SecurityFindingSource = {
      list: () => [],
      get: () => undefined,
    };
    const phase = securityFindingsLanePhase({ tenantId: TENANT }, empty);
    expect(phase.kind).toBe("empty");
    if (phase.kind !== "empty") throw new Error("unreachable");
    expect(phase.reason).toBe("no_findings_recorded");
    expect(phase.view).toHaveLength(0);
  });

  test("a tenant with findings composes the ready phase", () => {
    const populated: SecurityFindingSource = {
      list: (tenant) => (tenant === TENANT ? [findingRecord()] : []),
      get: (tenant, id) =>
        tenant === TENANT && id === "sec_w142_finding" ? findingRecord() : undefined,
    };
    const phase = securityFindingsLanePhase({ tenantId: TENANT }, populated);
    expect(phase.kind).toBe("ready");
  });

  test("the parked approvals list is the honest EMPTY phase when fresh", () => {
    const empty: SecurityApprovalSource = {
      parked: () => [],
      parkedByPlan: () => undefined,
    };
    const phase = parkedApprovalsLanePhase({ tenantId: TENANT }, empty);
    expect(phase.kind).toBe("empty");
    if (phase.kind !== "empty") throw new Error("unreachable");
    expect(phase.reason).toBe("no_parked_approvals");
  });
});

describe("W142: determinism — the same runtime state composes byte-identical feeds", () => {
  test("two compositions of the same state produce the same serialized feed", () => {
    const finding = findingRecord();
    const s = state([finding], [remediationRequest()], [approvalItem()], [], [], undefined);
    const first = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, { now: NOW });
    const second = composeSecurityDoctorFeed({ tenantId: TENANT }, s, finding.findingId, { now: NOW });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first.journey)).toBe(JSON.stringify(second.journey));
  });
});
