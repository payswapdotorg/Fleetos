/**
 * W031 D1 tests — the SecurityPosture model: deterministic derivation
 * from canonical observation shapes, severity + classification, evidence
 * links, forward-compatible skip reasons, versioned findings with
 * deterministic ids, and DRAFT SecurityRemediationIntent payloads.
 */

import { describe, expect, test } from "bun:test";
import { SECURITY_REMEDIATION_INTENT_KIND } from "@fleetos/contracts";
import {
  ALL_SECURITY_FINDING_CLASSIFICATIONS,
  ALL_SECURITY_SEVERITIES,
  MAX_SCREEN_LOCK_SECONDS,
  POSTURE_RULE_LIBRARY,
  SECURITY_POSTURE_MODEL_VERSION,
  assessSecurityPosture,
  securityFindingId,
  securityFindingRecordId,
} from "../src/index";
import type { SecurityFinding, SecurityPostureAssessment } from "../src/index";
import {
  DEV_1,
  DEV_2,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  healthyPayload,
  otherObservation,
  securityObservation,
  worstPayload,
} from "./helpers";

function assess(observations: Parameters<typeof assessSecurityPosture>[0]["observations"], overrides: Partial<Parameters<typeof assessSecurityPosture>[0]> = {}): SecurityPostureAssessment {
  return assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEV_1,
    observations,
    at: T0,
    ...overrides,
  });
}

describe("D1: derivation from canonical observations", () => {
  test("a healthy payload derives no findings and a HEALTHY posture", () => {
    const result = assess([securityObservation(healthyPayload())]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.status).toBe("HEALTHY");
    expect(result.posture.findings).toHaveLength(0);
    expect(result.posture.severityCounts.CRITICAL).toBe(0);
    expect(result.skipped).toHaveLength(0);
  });

  test("a worst-case payload fires every applicable rule (the two screen-lock rules are mutually exclusive by construction)", () => {
    const result = assess([securityObservation(worstPayload())]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const findings = result.posture.findings;
    // 9 rules; screen_lock.disabled and screen_lock.max_seconds_exceeded can
    // never both fire (disabled vs enabled-with-excessive-delay) -> 8 findings.
    expect(findings).toHaveLength(POSTURE_RULE_LIBRARY.length - 1);
    // Ordered: severity rank desc, then code asc.
    const criticals = findings.filter((f) => f.severity === "CRITICAL").map((f) => f.code);
    expect(criticals).toEqual([
      "security.device.disk_encryption.off",
      "security.device.malware.active_detections",
      "security.device.os_unsupported",
    ]);
    expect(findings[0]?.severity).toBe("CRITICAL");
    expect(findings[findings.length - 1]?.severity).toBe("MEDIUM");
    // Every finding carries one of the enumerated classifications.
    for (const finding of findings) {
      expect(ALL_SECURITY_FINDING_CLASSIFICATIONS.includes(finding.classification)).toBe(true);
      expect(ALL_SECURITY_SEVERITIES.includes(finding.severity)).toBe(true);
    }
    expect(result.posture.status).toBe("CRITICAL");
    expect(result.posture.severityCounts.CRITICAL).toBe(3);
    expect(result.posture.severityCounts.HIGH).toBe(3);
    expect(result.posture.severityCounts.MEDIUM).toBe(2);
    expect(result.posture.severityCounts.LOW).toBe(0);
  });

  test("status escalates by most severe finding (AT_RISK for HIGH-only, DEGRADED for MEDIUM-only)", () => {
    const high = assess([
      securityObservation({ firewall: { enabled: false } }),
    ]);
    expect(high.ok && high.posture.status).toBe("AT_RISK");
    const medium = assess([
      securityObservation({ screenLock: { enabled: false } }),
    ]);
    expect(medium.ok && medium.posture.status).toBe("DEGRADED");
    const low = assess([
      securityObservation({ screenLock: { enabled: true, maxLockSeconds: MAX_SCREEN_LOCK_SECONDS + 1 } }),
    ]);
    // LOW findings alone stay HEALTHY in model v1 (documented).
    expect(low.ok && low.posture.status).toBe("HEALTHY");
    expect(low.ok && low.posture.severityCounts.LOW).toBe(1);
  });

  test("the screen-lock threshold is inclusive (max allowed does not fire)", () => {
    const at = assess([
      securityObservation({ screenLock: { enabled: true, maxLockSeconds: MAX_SCREEN_LOCK_SECONDS } }),
    ]);
    expect(at.ok && at.posture.findings).toHaveLength(0);
  });

  test("evidence links every finding to its source observation", () => {
    const result = assess([securityObservation({ diskEncryption: false }, { id: "obs_w031ev000001" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.posture.findings[0];
    expect(finding?.evidence).toHaveLength(1);
    expect(finding?.evidence[0]?.observationId).toBe("obs_w031ev000001");
    expect(finding?.evidence[0]?.kind).toBe("device.security");
    expect(finding?.observedAt).toBe(T0);
  });

  test("multiple observations supporting the same rule merge into ONE finding (evidence sorted by id)", () => {
    const result = assess([
      securityObservation({ diskEncryption: false }, { id: "obs_w031ev000002", observedAt: T1 }),
      securityObservation({ diskEncryption: false }, { id: "obs_w031ev000001", observedAt: T0 }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const findings = result.posture.findings.filter((f) => f.code === "security.device.disk_encryption.off");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.evidence[0]?.observationId).toBe("obs_w031ev000001");
    expect(findings[0]?.evidence[1]?.observationId).toBe("obs_w031ev000002");
    // observedAt is the LATEST supporting observation.
    expect(findings[0]?.observedAt).toBe(T1);
  });

  test("findings are frozen and carry the model version + injected instant", () => {
    const result = assess([securityObservation({ diskEncryption: false })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.postureModelVersion).toBe(SECURITY_POSTURE_MODEL_VERSION);
    expect(result.posture.assessedAt).toBe(T0);
    expect(result.posture.tenantId).toBe(TENANT_A);
    expect(result.posture.deviceId).toBe(DEV_1);
    for (const finding of result.posture.findings) {
      expect(Object.isFrozen(finding)).toBe(true);
    }
    expect(Object.isFrozen(result.posture)).toBe(true);
  });
});

describe("D1: forward-compatible skip reasons (machine-stable)", () => {
  test("non-security kinds skip with kind_not_security", () => {
    const result = assess([
      otherObservation("device.health"),
      otherObservation("device.identity", { id: "obs_w031sk000002" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]?.reason).toBe("kind_not_security");
    expect(result.skipped[1]?.reason).toBe("kind_not_security");
    expect(result.posture.findings).toHaveLength(0);
  });

  test("unsupported payload schema versions skip with payload_version_unsupported", () => {
    const result = assess([
      securityObservation({ diskEncryption: false }, { schemaVersion: 2 }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("payload_version_unsupported");
    expect(result.posture.findings).toHaveLength(0); // never misinterpreted.
  });

  test("unrecognized payload shapes skip with payload_unrecognized (unknown fields tolerated)", () => {
    // A payload with NO recognized key: the v1 model does not know it.
    const result = assess([securityObservation({ telemetry: { gpu: 0.5 } })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped[0]?.reason).toBe("payload_unrecognized");
    // Unknown EXTRA fields alongside recognized ones are tolerated.
    const tolerated = assess([
      securityObservation({ diskEncryption: false, telemetry: { gpu: 0.5 } }),
    ]);
    expect(tolerated.ok && tolerated.posture.findings).toHaveLength(1);
    expect(tolerated.ok && tolerated.skipped).toHaveLength(0);
  });

  test("recognized keys with invalid value types skip with payload_invalid", () => {
    const result = assess([securityObservation({ diskEncryption: "nope" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped[0]?.reason).toBe("payload_invalid");
    expect(result.posture.findings).toHaveLength(0);
  });
});

describe("D1: deterministic finding ids + versioned interpretations", () => {
  test("finding ids are stable digests of (tenant, device, code); record ids add the version", () => {
    const result = assess([securityObservation({ diskEncryption: false })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.posture.findings[0] as SecurityFinding;
    expect(finding.findingId).toBe(
      securityFindingId(TENANT_A, DEV_1, "security.device.disk_encryption.off"),
    );
    expect(finding.recordId).toBe(
      securityFindingRecordId(TENANT_A, DEV_1, "security.device.disk_encryption.off", 1),
    );
    expect(finding.findingId.startsWith("sec_")).toBe(true);
    expect(finding.recordId.startsWith("secfnd_")).toBe(true);
    // Different device or tenant -> different identity.
    expect(
      securityFindingId(TENANT_A, DEV_2, "security.device.disk_encryption.off") === finding.findingId,
    ).toBe(false);
    expect(
      securityFindingId(TENANT_B, DEV_1, "security.device.disk_encryption.off") === finding.findingId,
    ).toBe(false);
  });

  test("history stamps interpretation versions and supersedes links", () => {
    const first = assess([securityObservation({ diskEncryption: false })]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const v1 = first.posture.findings[0] as SecurityFinding;
    expect(v1.interpretationVersion).toBe(1);
    expect(v1.supersedes).toBeUndefined();

    // Re-assessment WITH the prior history: version 2 superseding record v1.
    const history = [{ kind: "finding", finding: v1 }] as const;
    const second = assess([securityObservation({ diskEncryption: false })], {
      at: T1,
      history,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const v2 = second.posture.findings[0] as SecurityFinding;
    expect(v2.interpretationVersion).toBe(2);
    expect(v2.supersedes).toBe(v1.recordId);
    expect(v2.recordId === v1.recordId).toBe(false);
    expect(v2.detectedAt).toBe(T1);
    // The prior record is untouched.
    expect(v1.interpretationVersion).toBe(1);
  });
});

describe("D1: DRAFT SecurityRemediationIntent payloads (proposals, never actions)", () => {
  test("CRITICAL and HIGH findings propose remediation; MEDIUM and LOW do not", () => {
    const result = assess([securityObservation(worstPayload())]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const finding of result.posture.findings) {
      if (finding.severity === "CRITICAL" || finding.severity === "HIGH") {
        expect(finding.remediation).toBeDefined();
      } else {
        expect(finding.remediation).toBeUndefined();
      }
    }
  });

  test("the draft payload matches the frozen SecurityRemediationIntentPayload shape", () => {
    const result = assess([securityObservation({ diskEncryption: false })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proposal = result.posture.findings[0]?.remediation;
    expect(proposal?.intentKind).toBe(SECURITY_REMEDIATION_INTENT_KIND);
    expect(proposal?.payload.deviceId).toBe(DEV_1);
    expect(proposal?.payload.findingId).toBe(
      securityFindingId(TENANT_A, DEV_1, "security.device.disk_encryption.off"),
    );
    expect(typeof proposal?.payload.description).toBe("string");
    expect((proposal?.payload.description as string).length > 0).toBe(true);
  });

  test("the serialized proposal carries NEITHER intentId NOR lifecycle status", () => {
    const result = assess([securityObservation(worstPayload())]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const finding of result.posture.findings) {
      if (finding.remediation === undefined) continue;
      const serialized = JSON.stringify(finding.remediation);
      expect(serialized.includes("intentId")).toBe(false);
      expect(serialized.includes("status")).toBe(false);
      expect(serialized.includes("createdAt")).toBe(false);
    }
  });
});

describe("D1: input validation", () => {
  test("invalid requests are rejected with tagged validation errors", () => {
    const bad = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: "nope" as never,
      at: T0,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.kind).toBe("ValidationError");
      expect(bad.error.code).toBe("security.posture.invalid_request");
    }
    const badAt = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [],
      at: "whenever",
    });
    expect(badAt.ok).toBe(false);
  });

  test("an empty observation window yields a HEALTHY posture (no findings, no skips)", () => {
    const result = assess([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.findings).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
