/**
 * W031 D5 tests — byte-identical determinism across runs and input
 * permutations: the posture pipeline (observations -> findings -> ledger
 * -> active view) is a pure function of its inputs, and observation
 * input order never changes a byte of the output.
 */

import { describe, expect, test } from "bun:test";
import {
  assessSecurityPosture,
  createInMemoryPostureFindingsLedger,
} from "../src/index";
import {
  CORR,
  DEV_1,
  TENANT_A,
  T0,
  T1,
  otherObservation,
  scopeA,
  securityObservation,
  worstPayload,
} from "./helpers";

function pipeline(observations: Parameters<typeof assessSecurityPosture>[0]["observations"]): string {
  const assessment = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEV_1,
    observations,
    at: T0,
  });
  if (!assessment.ok) throw new Error(assessment.error.message);
  const ledger = createInMemoryPostureFindingsLedger();
  const record = ledger.recordFindings(scopeA(), DEV_1, [...assessment.posture.findings], {
    at: T0,
    correlationId: CORR,
  });
  if (!record.ok) throw new Error(record.error.message);
  const active = ledger.resolveActiveFindings(scopeA(), DEV_1);
  return JSON.stringify({
    posture: assessment.posture,
    skipped: assessment.skipped,
    active,
  });
}

describe("D5: byte-identical determinism across runs", () => {
  test("the same observation window produces byte-identical output", () => {
    const observations = [
      securityObservation(worstPayload(), { id: "obs_w031det00001" }),
      securityObservation({ firewall: { enabled: false } }, { id: "obs_w031det00002", observedAt: T1 }),
      otherObservation("device.health", { id: "obs_w031det00003" }),
    ];
    expect(pipeline(observations)).toBe(pipeline(observations));
    expect(pipeline(observations)).toBe(pipeline(observations));
  });

  test("observation input permutations never change a byte", () => {
    const observations = [
      securityObservation(worstPayload(), { id: "obs_w031det00001" }),
      securityObservation({ screenLock: { enabled: false } }, { id: "obs_w031det00002" }),
      securityObservation({ diskEncryption: false }, { id: "obs_w031det00003" }),
      otherObservation("device.software", { id: "obs_w031det00004" }),
    ];
    const forward = pipeline(observations);
    const reversed = pipeline([...observations].reverse());
    const rotated = [observations[2]!, observations[0]!, observations[3]!, observations[1]!];
    const rotatedPipeline = pipeline(rotated);
    expect(forward).toBe(reversed);
    expect(forward).toBe(rotatedPipeline);
  });

  test("evidence order within a finding is observationId order regardless of arrival", () => {
    const a = assessSecurityPosture({
      tenantId: TENANT_A,
      deviceId: DEV_1,
      observations: [
        securityObservation({ diskEncryption: false }, { id: "obs_w031det00002" }),
        securityObservation({ diskEncryption: false }, { id: "obs_w031det00001" }),
      ],
      at: T0,
    });
    if (!a.ok) throw new Error(a.error.message);
    const evidence = a.posture.findings[0]?.evidence.map((e) => e.observationId);
    expect(evidence).toEqual(["obs_w031det00001", "obs_w031det00002"]);
  });
});
