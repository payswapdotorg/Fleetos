/**
 * @fleetos/integration-adcos — D1: the reverse-direction status-model
 * tests (validation, normalization, taxonomy invariants).
 */

import { test, expect } from "bun:test";
import { validateStatusReport } from "./status-model";
import {
  degradedActiveReport,
  evidenceRef,
  T0,
  T1,
} from "./test-support";

/** A canonical valid report for mutation-based tests. */
function validReport(): Record<string, unknown> {
  return {
    connectivityId: "adcos-c-abc12345",
    handle: "adcos-h-abc12345",
    executionState: "ACTIVE",
    acceptedRequirements: {
      outcome: "secure_private_connectivity",
      properties: {
        isolation: "private",
        redundancy: "path_redundant",
        availabilityTarget: 0.999,
      },
      constraints: {
        requiredZones: ["zone-b", "zone-a"],
        forbiddenZones: ["zone-x"],
        egressAllowed: false,
      },
      duration: { startAt: T0, endAt: T1 },
      security: { encryption: "required", privateRouting: true, complianceRefs: ["iso1", "soc2"] },
    },
    measurements: [
      {
        kind: "latency_ms",
        value: 42,
        measuredAt: T1,
        evidence: evidenceRef("evidence/b"),
      },
      {
        kind: "latency_ms",
        value: 40,
        measuredAt: T0,
        evidence: evidenceRef("evidence/a"),
      },
      {
        kind: "throughput_mbps",
        value: 500,
        measuredAt: T1,
        evidence: evidenceRef("evidence/c"),
      },
    ],
    degradation: { kind: "none" },
    failure: { kind: "none" },
    termination: null,
    reportedAt: T1,
  };
}

test("a well-formed report validates and normalizes deterministically (measurements sorted, sets sorted)", () => {
  const result = validateStatusReport(validReport());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  const report = result.report;
  // Measurements sorted by (kind, measuredAt, evidence.key).
  expect(report.measurements.map((m) => m.evidence.key)).toEqual([
    "evidence/a",
    "evidence/b",
    "evidence/c",
  ]);
  expect(report.acceptedRequirements.constraints.requiredZones).toEqual(["zone-a", "zone-b"]);
  expect(report.acceptedRequirements.security.complianceRefs).toEqual(["iso1", "soc2"]);
  expect(Object.isFrozen(report)).toBe(true);
});

test("measurement input permutations produce identical normalized reports (determinism)", () => {
  const a = validateStatusReport(validReport());
  const permuted = validReport();
  (permuted as { measurements: unknown[] }).measurements = [
    ...(permuted.measurements as unknown[]).slice(2),
    ...(permuted.measurements as unknown[]).slice(0, 2),
  ];
  const b = validateStatusReport(permuted);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (a.ok && b.ok) {
    expect(JSON.stringify(a.report.measurements)).toBe(JSON.stringify(b.report.measurements));
  }
});

test("an invalid execution state is refused with invalid_union", () => {
  const report = validReport();
  report.executionState = "DEGRADED";
  const result = validateStatusReport(report);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.some((f) => f.path === "/executionState" && f.reason === "invalid_union")).toBe(true);
  }
});

test("termination is required iff TERMINATED (termination_state_conflict both ways)", () => {
  // TERMINATED without a termination record.
  const terminated = validReport();
  terminated.executionState = "TERMINATED";
  const missing = validateStatusReport(terminated);
  expect(missing.ok).toBe(false);
  if (!missing.ok) {
    expect(missing.failures.some((f) => f.path === "/termination" && f.reason === "required")).toBe(true);
  }

  // A termination record on an ACTIVE report.
  const activeTerminated = validReport();
  activeTerminated.termination = { reason: "tenant_requested", terminatedAt: T1 };
  const conflict = validateStatusReport(activeTerminated);
  expect(conflict.ok).toBe(false);
  if (!conflict.ok) {
    expect(conflict.failures.some((f) => f.path === "/termination" && f.reason === "termination_state_conflict")).toBe(true);
  }
});

test("degradation describes ACTIVE execution only (degradation_state_conflict)", () => {
  const report = validReport();
  report.executionState = "TERMINATED";
  report.termination = { reason: "tenant_requested", terminatedAt: T1 };
  report.degradation = { kind: "latency_degraded" };
  const result = validateStatusReport(report);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.some((f) => f.path === "/degradation" && f.reason === "degradation_state_conflict")).toBe(true);
  }
});

test("invalid measurements are refused: bad kind, negative value, availability out of range, invalid evidence", () => {
  const kind = validReport();
  (kind.measurements as { kind: string }[])[0].kind = "jitter_ms";
  const r1 = validateStatusReport(kind);
  expect(r1.ok).toBe(false);
  if (!r1.ok) expect(r1.failures.some((f) => f.path === "/measurements/0/kind" && f.reason === "invalid_union")).toBe(true);

  const negative = validReport();
  (negative.measurements as { value: number }[])[0].value = -1;
  const r2 = validateStatusReport(negative);
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.failures.some((f) => f.path === "/measurements/0/value" && f.reason === "out_of_range")).toBe(true);

  const availability = validReport();
  (availability.measurements as unknown[])[0] = {
    kind: "availability_ratio",
    value: 1.5,
    measuredAt: T1,
    evidence: evidenceRef(),
  };
  const r3 = validateStatusReport(availability);
  expect(r3.ok).toBe(false);
  if (!r3.ok) expect(r3.failures.some((f) => f.path === "/measurements/0/value" && f.reason === "out_of_range")).toBe(true);

  const badEvidence = validReport();
  (badEvidence.measurements as { evidence: { key: string } }[])[0].evidence = { key: "" };
  const r4 = validateStatusReport(badEvidence);
  expect(r4.ok).toBe(false);
  if (!r4.ok) expect(r4.failures.some((f) => f.path === "/measurements/0/evidence" && f.reason === "invalid_evidence")).toBe(true);
});

test("invalid degradation/failure taxonomies are refused (closed unions)", () => {
  const report = validReport();
  report.degradation = { kind: "slow" };
  const result = validateStatusReport(report);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.some((f) => f.path === "/degradation/kind" && f.reason === "invalid_union")).toBe(true);
  }

  const report2 = validReport();
  report2.failure = { kind: "oops" };
  const result2 = validateStatusReport(report2);
  expect(result2.ok).toBe(false);
  if (!result2.ok) {
    expect(result2.failures.some((f) => f.path === "/failure/kind" && f.reason === "invalid_union")).toBe(true);
  }
});

test("an invalid accepted-requirements echo is refused (never trusted blindly)", () => {
  const report = validReport();
  report.acceptedRequirements = { outcome: "cheap_connectivity" };
  const result = validateStatusReport(report);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.some((f) => f.path === "/acceptedRequirements/outcome")).toBe(true);
  }

  const conflicting = validReport();
  (conflicting.acceptedRequirements as { constraints: unknown }).constraints = {
    requiredZones: ["dmz"],
    forbiddenZones: ["dmz"],
    egressAllowed: false,
  };
  const result2 = validateStatusReport(conflicting);
  expect(result2.ok).toBe(false);
  if (!result2.ok) {
    expect(result2.failures.some((f) => f.path === "/acceptedRequirements/constraints" && f.reason === "conflicting_zones")).toBe(true);
  }
});

test("the degraded-ACTIVE fixture report is valid", () => {
  const result = validateStatusReport(
    degradedActiveReport("adcos-c-abc12345", "adcos-h-abc12345" as never, T1),
  );
  expect(result.ok).toBe(true);
});

test("missing required facets are refused with required", () => {
  const result = validateStatusReport({});
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const paths = result.failures.map((f) => f.path);
    expect(paths).toContain("/connectivityId");
    expect(paths).toContain("/handle");
    expect(paths).toContain("/executionState");
    expect(paths).toContain("/reportedAt");
    expect(paths).toContain("/measurements");
    expect(paths).toContain("/acceptedRequirements");
  }
});
