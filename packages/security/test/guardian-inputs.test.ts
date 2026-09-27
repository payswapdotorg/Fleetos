/**
 * W031 tests — the `security -> policy` module-map edge with real code:
 * posture projections onto the policy-owned Guardian rule-input shapes,
 * and the end-to-end flow: observations -> posture -> Guardian device
 * facet -> rule evaluation (the deterministic policy layer stays
 * authoritative for whether the action is permitted).
 */

import { describe, expect, test } from "bun:test";
import type { GuardianDevicePosture } from "@fleetos/policy";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  assessSecurityPosture,
  deriveGuardianDevicePosture,
  guardianDeviceFacetFromPosture,
} from "../src/index";
import {
  CORR,
  DEV_1,
  TENANT_A,
  T0,
  healthyPayload,
  securityObservation,
  worstPayload,
} from "./helpers";

// The policy-side rule used by the end-to-end test: actions on devices
// whose posture is at least AT_RISK require approval. The condition
// shape is policy-owned; the posture input is security-derived.
const postureGateRule = {
  name: "at-risk-devices-require-approval",
  condition: { kind: "device", minPostureStatus: "AT_RISK" },
  effect: "REQUIRE_APPROVAL",
} as const;

describe("the security -> policy module-map edge", () => {
  test("deriveGuardianDevicePosture projects counts + status verbatim", () => {
    const assessment = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [securityObservation(worstPayload())],
      at: T0,
    });
    if (!assessment.ok) throw new Error(assessment.error.message);
    const projection: GuardianDevicePosture = deriveGuardianDevicePosture(assessment.posture);
    expect(projection.status).toBe("CRITICAL");
    expect(projection.criticalFindings).toBe(3);
    expect(projection.highFindings).toBe(3);
    expect(projection.mediumFindings).toBe(2);
    expect(projection.lowFindings).toBe(0);
    expect(projection.assessedAt).toBe(T0);
    // The projection is a frozen record.
    expect(Object.isFrozen(projection)).toBe(true);
  });

  test("a healthy posture projects HEALTHY with zero counts", () => {
    const assessment = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [securityObservation(healthyPayload())],
      at: T0,
    });
    if (!assessment.ok) throw new Error(assessment.error.message);
    const projection = deriveGuardianDevicePosture(assessment.posture);
    expect(projection.status).toBe("HEALTHY");
    expect(projection.criticalFindings + projection.highFindings + projection.mediumFindings + projection.lowFindings).toBe(0);
  });

  test("guardianDeviceFacetFromPosture builds the full device facet", () => {
    const assessment = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [securityObservation({ diskEncryption: false })],
      at: T0,
    });
    if (!assessment.ok) throw new Error(assessment.error.message);
    const facet = guardianDeviceFacetFromPosture(DEV_1, assessment.posture);
    expect(facet.deviceId).toBe(DEV_1);
    expect(facet.posture?.status).toBe("CRITICAL");
  });
});

describe("end-to-end: observations -> posture -> Guardian decision", () => {
  test("an at-risk device's upload requires approval through the Guardian", () => {
    const assessment = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [securityObservation({ firewall: { enabled: false } })], // HIGH -> AT_RISK
      at: T0,
    });
    if (!assessment.ok) throw new Error(assessment.error.message);

    // Define + compile the policy rule (policy-owned shapes).
    const built = defineGuardianRule(TENANT_A, { ...postureGateRule, at: T0 });
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [built.rule], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);

    const result = evaluateGuardianRequest(
      compiled.ruleSet,
      {
        tenantId: TENANT_A,
        action: { action: "file.upload" },
        device: guardianDeviceFacetFromPosture(DEV_1, assessment.posture),
      },
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.decision.decision).toBe("REQUIRE_APPROVAL");
    expect(result.evaluation.decision.rules).toHaveLength(1);
  });

  test("a healthy device's upload is allowed by the same rule set", () => {
    const assessment = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [securityObservation(healthyPayload())],
      at: T0,
    });
    if (!assessment.ok) throw new Error(assessment.error.message);

    const built = defineGuardianRule(TENANT_A, { ...postureGateRule, at: T0 });
    if (!built.ok) throw new Error(built.error.message);
    const compiled = compileGuardianRuleSet(TENANT_A, { rules: [built.rule], version: 1, at: T0 });
    if (!compiled.ok) throw new Error(compiled.error.message);

    const result = evaluateGuardianRequest(
      compiled.ruleSet,
      {
        tenantId: TENANT_A,
        action: { action: "file.upload" },
        device: guardianDeviceFacetFromPosture(DEV_1, assessment.posture),
      },
      { at: T0, correlationId: CORR },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.decision.decision).toBe("ALLOW");
  });
});
