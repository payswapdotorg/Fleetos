/**
 * W031 D5 tests — contract conformance via @fleetos/contracts/testing
 * fixture builders: makeObservationBatch / makeTenantId / makeDeviceId /
 * makeObservationId / makeTimestamp / makeIntent / FIXTURE_TIME_ANCHOR,
 * plus the frozen observation invariants over fixtures the posture
 * engine consumes.
 */

import { describe, expect, test } from "bun:test";
import {
  SECURITY_REMEDIATION_INTENT_KIND,
  validateObservationBatch,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  TESTING_MODULE_NAME,
  makeDeviceId,
  makeIntent,
  makeObservationBatch,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import type { Observation } from "@fleetos/contracts";
import { assessSecurityPosture } from "../src/index";
import type { SecurityRemediationIntentPayload } from "@fleetos/contracts";

describe("D5: the frozen observation fixtures feed the posture engine", () => {
  test("makeObservationBatch satisfies the frozen batch invariants", () => {
    const batch = makeObservationBatch({ seed: "w031", count: 5 });
    const validation = validateObservationBatch(batch);
    expect(validation.ok).toBe(true);
    expect(batch.tenantId).toBe(makeTenantId("w031"));
    expect(batch.deviceId).toBe(makeDeviceId("w031"));
    expect(batch.observations).toHaveLength(5);
  });

  test("the fixture batch drives derivation with machine-stable skips (forward compatibility)", () => {
    // The fixture payload ({idx, sample}) is NOT a recognized v1 security
    // payload shape: every device.security observation skips with
    // payload_unrecognized; other kinds skip with kind_not_security. The
    // engine NEVER misinterprets an unknown shape.
    const batch = makeObservationBatch({ seed: "w031", count: 6 });
    const result = assessSecurityPosture({
      tenantId: batch.tenantId,
      deviceId: batch.deviceId,
      observations: batch.observations,
      at: FIXTURE_TIME_ANCHOR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.findings).toHaveLength(0);
    expect(result.posture.status).toBe("HEALTHY");
    expect(result.skipped).toHaveLength(6);
    for (const skip of result.skipped) {
      expect(skip.reason === "kind_not_security" || skip.reason === "payload_unrecognized").toBe(true);
    }
    const securitySkips = result.skipped.filter((s) => s.reason === "payload_unrecognized");
    expect(securitySkips.length >= 1).toBe(true);
  });

  test("fixture observations splice cleanly into a recognizing assessment", () => {
    // A fixture observation id + timestamp with a RECOGNIZED payload:
    // the derivation consumes it like any canonical observation.
    const obsId = makeObservationId("w031-recognized");
    const observedAt = makeTimestamp("w031-recognized");
    const observation: Observation = {
      id: obsId,
      kind: "device.security",
      observedAt,
      schemaVersion: 1,
      payload: { diskEncryption: false },
    };
    const result = assessSecurityPosture({
      tenantId: makeTenantId("w031"),
      deviceId: makeDeviceId("w031"),
      observations: [observation],
      at: FIXTURE_TIME_ANCHOR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.findings).toHaveLength(1);
    expect(result.posture.findings[0]?.evidence[0]?.observationId).toBe(obsId);
    expect(result.posture.findings[0]?.observedAt).toBe(observedAt);
  });
});

describe("D5: the frozen SecurityRemediationIntent contract (owned by this package)", () => {
  test("makeIntent builds a deterministic SecurityRemediationIntent envelope", () => {
    const intent = makeIntent({ seed: "w031", kind: SECURITY_REMEDIATION_INTENT_KIND });
    const again = makeIntent({ seed: "w031", kind: SECURITY_REMEDIATION_INTENT_KIND });
    expect(JSON.stringify(intent)).toBe(JSON.stringify(again));
    // The discriminant is the payload's `kind` field (frozen contract).
    expect(intent.payload.kind).toBe(SECURITY_REMEDIATION_INTENT_KIND);
    expect(intent.tenantId).toBe(makeTenantId("w031"));
  });

  test("the draft payloads this package produces satisfy the frozen payload shape", () => {
    const batch = makeObservationBatch({ seed: "w031", count: 3 });
    const result = assessSecurityPosture({
      tenantId: batch.tenantId,
      deviceId: batch.deviceId,
      observations: [
        {
          id: makeObservationId("w031-payload"),
          kind: "device.security",
          observedAt: makeTimestamp("w031-payload"),
          schemaVersion: 1,
          payload: { diskEncryption: false, malware: { activeDetections: 1 } },
        },
      ],
      at: FIXTURE_TIME_ANCHOR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posture.findings).toHaveLength(2);
    for (const finding of result.posture.findings) {
      const proposal = finding.remediation;
      expect(proposal).toBeDefined();
      if (proposal === undefined) continue;
      expect(proposal.intentKind).toBe(SECURITY_REMEDIATION_INTENT_KIND);
      // The payload is structurally the frozen payload type (compile-time
      // assignment; runtime shape checks below).
      const payload: SecurityRemediationIntentPayload = proposal.payload;
      expect(payload.deviceId).toBe(batch.deviceId);
      expect(payload.findingId).toBe(finding.findingId);
      expect(typeof payload.description).toBe("string");
    }
  });
});

describe("D5: the testing subpath identifies itself", () => {
  test("module markers", () => {
    expect(TESTING_MODULE_NAME).toBe("contracts/testing");
    expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
  });
});
