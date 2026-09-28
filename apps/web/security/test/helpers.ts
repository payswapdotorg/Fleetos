/**
 * W060B web-security test helpers — deterministic builders for the
 * surface-lane tests. Local to the test suite (never exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy. Cross-lane imports are test-scope ONLY (per the W060
 * work order: "test/ may import across lanes").
 */

import {
  FIXTURE_TIME_ANCHOR,
  makeDeviceId,
  makeObservationId,
  makePolicyId,
  makeTenantId,
} from "@fleetos/contracts/testing";
import type {
  DeviceId,
  EvidenceRef,
  PolicyId,
  TenantId,
} from "@fleetos/contracts";
import { asUserId } from "@fleetos/contracts";
import type {
  GuardianDecisionRecord,
  GuardianEvaluationRecord,
  GuardianReasonView,
  ParkedApprovalItemInput,
  ParkedPlanRecord,
  RemediationProposalDraft,
  SecurityFindingRecord,
  SurfaceTenantScope,
} from "../src/surface-contracts";

/** A fixed, well-known anchor for all surface test timestamps. */
export const T0 = FIXTURE_TIME_ANCHOR;
/** A later injected instant (transition flows). */
export const T1 = "2026-02-01T00:00:00Z";
/** An even later injected instant. */
export const T2 = "2026-03-01T00:00:00Z";

/** Deterministic tenant ids (canonical grammar). */
export const TENANT_A: TenantId = makeTenantId("w060b-a");
export const TENANT_B: TenantId = makeTenantId("w060b-b");

/** Deterministic device ids. */
export const DEV_A1: DeviceId = makeDeviceId("w060b-d1");
export const DEV_A2: DeviceId = makeDeviceId("w060b-d2");

/** Deterministic principal id. */
export const USER_1 = asUserId("usr_w060buser01");

/** The acting tenant-A scope. */
export function scopeA(): SurfaceTenantScope {
  return { tenantId: TENANT_A };
}

/** A fixed, valid evidence ref (deterministic values, opaque). */
export function evidenceRef(key = "evidence/w060b-artifact-1"): EvidenceRef {
  return {
    key,
    sizeBytes: 128,
    hash: "0123456789abcdef0123456789abcdef",
    hashAlgorithm: "sha256",
  };
}

/** A deterministic rule ref. */
export function ruleRef(seed: string, version = 1): { ruleId: PolicyId; ruleVersion: number } {
  return { ruleId: makePolicyId(seed), ruleVersion: version };
}

/**
 * Build a deterministic, valid-by-construction finding record. Fields
 * mirror the W031 SecurityFinding shape (the structural seam).
 */
export function finding(
  overrides: Partial<SecurityFindingRecord> = {},
): SecurityFindingRecord {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const deviceId = overrides.deviceId ?? DEV_A1;
  const code = overrides.code ?? "security.device.disk_encryption.off";
  const severity = overrides.severity ?? "HIGH";
  const interpretationVersion = overrides.interpretationVersion ?? 1;
  return {
    findingId: overrides.findingId ?? `sec_w060b_${code}_${deviceId}`,
    recordId: overrides.recordId ?? `secfnd_w060b_${code}_${deviceId}_${interpretationVersion}`,
    tenantId,
    deviceId,
    code,
    title: overrides.title ?? "Disk encryption is off",
    severity,
    classification: overrides.classification ?? "configuration",
    interpretationVersion,
    supersedes: overrides.supersedes,
    detectedAt: overrides.detectedAt ?? T0,
    observedAt: overrides.observedAt ?? T0,
    evidence: overrides.evidence ?? [
      { observationId: makeObservationId("w060b-obs-1"), kind: "device.security" },
    ],
    remediation: overrides.remediation,
  };
}

/** A deterministic remediation proposal draft (the W031 DRAFT payload shape). */
export function remediationDraft(
  overrides: Partial<RemediationProposalDraft["payload"]> = {},
): RemediationProposalDraft {
  return {
    intentKind: "SecurityRemediationIntent",
    payload: {
      deviceId: DEV_A1,
      findingId: "sec_w060b_finding",
      description: "Enable disk encryption on the device",
      ...overrides,
    },
  };
}

/** Build a deterministic, valid-by-construction Guardian decision record. */
export function decision(
  overrides: Partial<GuardianDecisionRecord> = {},
): GuardianDecisionRecord {
  const decisionType = overrides.decision ?? "REQUIRE_APPROVAL";
  return {
    tenantId: overrides.tenantId ?? TENANT_A,
    decision: decisionType,
    rules: overrides.rules ?? [ruleRef(`w060b-rule-${decisionType}`)],
    evidence: overrides.evidence ?? [evidenceRef()],
    decidedAt: overrides.decidedAt ?? T1,
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

/** Build a deterministic, valid-by-construction Guardian evaluation record. */
export function evaluation(
  overrides: Partial<GuardianEvaluationRecord> = {},
): GuardianEvaluationRecord {
  const decisionType = overrides.decision?.decision ?? "REQUIRE_APPROVAL";
  const ruleId = makePolicyId(`w060b-rule-${decisionType}`);
  return {
    decision: overrides.decision ?? decision({ decision: decisionType }),
    ruleSetId: overrides.ruleSetId ?? "w060b-ruleset",
    ruleSetVersion: overrides.ruleSetVersion ?? 1,
    matchedRules: overrides.matchedRules ?? [
      { ruleId, name: `w060b-${decisionType}-rule`, version: 1, effect: decisionType },
    ],
    reasons: overrides.reasons ?? [
      { code: "policy.rule.matched", ruleId, ruleVersion: 1, conditionKind: "action", effect: decisionType },
      { code: "policy.precedence.resolved", chosen: decisionType },
    ],
  };
}

/** Build a deterministic machine-stable reason. */
export function reason(overrides: Partial<GuardianReasonView> = {}): GuardianReasonView {
  return {
    code: overrides.code ?? "policy.rule.matched",
    ruleId: overrides.ruleId,
    ruleVersion: overrides.ruleVersion,
    conditionKind: overrides.conditionKind,
    effect: overrides.effect,
    chosen: overrides.chosen,
  };
}

/** Build a deterministic, valid-by-construction parked plan record. */
export function parkedPlan(overrides: Partial<ParkedPlanRecord> = {}): ParkedPlanRecord {
  return {
    planId: overrides.planId ?? "plan_w060b_01",
    tenantId: overrides.tenantId ?? TENANT_A,
    name: overrides.name ?? "w060b-parked-plan",
    version: overrides.version ?? 2,
    status: overrides.status ?? "PARKED",
    capability: overrides.capability ?? "lock",
    targetCount: overrides.targetCount ?? 3,
    createdAt: overrides.createdAt ?? T0,
    transitionedAt: overrides.transitionedAt ?? T1,
    requestedBy: overrides.requestedBy ?? USER_1,
  };
}

/** Build a parked-approval queue item input. */
export function approvalItem(
  planOverrides: Partial<ParkedPlanRecord> = {},
  evaluationOverrides: Partial<GuardianEvaluationRecord> = {},
): ParkedApprovalItemInput {
  return {
    plan: parkedPlan(planOverrides),
    evaluation: evaluation({
      decision: decision({ decision: "REQUIRE_APPROVAL" }),
      ...evaluationOverrides,
    }),
  };
}
