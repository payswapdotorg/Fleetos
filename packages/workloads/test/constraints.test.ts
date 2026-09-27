/**
 * W022 D2 tests — discrete constraints + fit assessment.
 *
 * Core invariants under test:
 *   - constraint checks are pure pass/fail with machine-stable kinds;
 *   - application version gates use dotted-numeric comparison and fail
 *     closed on malformed versions;
 *   - classification ceilings order strictly;
 *   - assessFit never trades constraints against the soft score.
 */

import { describe, expect, test } from "bun:test";
import type { CandidateCapabilities, WorkloadConstraints } from "../src/constraints";
import {
  assessFit,
  checkConstraints,
  parseDottedVersion,
  versionSatisfies,
} from "../src/constraints";
import { balancedVector, candidate, vector } from "./helpers";

describe("D2: dotted-numeric versions", () => {
  test("parse + satisfies semantics", () => {
    expect(parseDottedVersion("2026.1.3")).toEqual([2026, 1, 3]);
    expect(parseDottedVersion("")).toBeNull();
    expect(parseDottedVersion("2026.beta")).toBeNull();

    expect(versionSatisfies("2026.1", "2026.1")).toBe(true);
    expect(versionSatisfies("2026.1", "2026.2")).toBe(true);
    expect(versionSatisfies("2026.2", "2026.1")).toBe(false);
    expect(versionSatisfies("2026", "2026.0")).toBe(true);
    // A specific minimum is NOT satisfied by a shorter available version
    // (2026.1 < 2026.1.1); the converse holds (missing segments are 0).
    expect(versionSatisfies("2026.1.1", "2026.1")).toBe(false);
    expect(versionSatisfies("2026.1", "2026.1.1")).toBe(true);
    // Malformed fails CLOSED.
    expect(versionSatisfies("garbage", "2026.1")).toBe(false);
    expect(versionSatisfies("2026.1", "garbage")).toBe(false);
  });
});

describe("D2: checkConstraints", () => {
  test("an empty constraint set is satisfied by any candidate", () => {
    const check = checkConstraints({}, candidate());
    expect(check.satisfied).toBe(true);
    expect(check.failures).toEqual([]);
  });

  test("missing application and version-below-minimum failures", () => {
    const constraints: WorkloadConstraints = {
      requiredApplications: [
        { appId: "app.missing_everywhere" },
        { appId: "app.office_suite", minVersion: "2027.0" },
        { appId: "app.bi_dashboard", minVersion: "5.0" },
      ],
    };
    const check = checkConstraints(constraints, candidate());
    expect(check.satisfied).toBe(false);
    expect(check.failures).toEqual([
      { kind: "missing_application", appId: "app.missing_everywhere" },
      {
        kind: "version_below_minimum",
        appId: "app.office_suite",
        minVersion: "2027.0",
        availableVersion: "2026.1",
      },
    ]);
  });

  test("environment, peripheral, and classification failures (in check order)", () => {
    const constraints: WorkloadConstraints = {
      environments: ["datacenter", "office"],
      peripherals: ["printer", "signature_pad"],
      classification: "restricted",
    };
    const limited: CandidateCapabilities = candidate({
      environments: ["office"],
      peripherals: ["printer"],
      maxSecurityClassification: "internal",
    });
    const check = checkConstraints(constraints, limited);
    expect(check.satisfied).toBe(false);
    expect(check.failures).toEqual([
      { kind: "environment_unsupported", environment: "datacenter" },
      { kind: "missing_peripheral", peripheral: "signature_pad" },
      { kind: "classification_insufficient", required: "restricted", supported: "internal" },
    ]);
  });

  test("check order is deterministic: applications, environments, peripherals, classification", () => {
    const constraints: WorkloadConstraints = {
      requiredApplications: [{ appId: "app.absent" }],
      classification: "restricted",
      peripherals: ["signature_pad"],
      environments: ["datacenter"],
    };
    const check = checkConstraints(constraints, candidate({ maxSecurityClassification: "internal" }));
    expect(check.failures.map((f) => f.kind)).toEqual([
      "missing_application",
      "environment_unsupported",
      "missing_peripheral",
      "classification_insufficient",
    ]);
  });
});

describe("D2: assessFit", () => {
  test("soft score and hard gate are computed independently", () => {
    const requirements = balancedVector();
    const constraints: WorkloadConstraints = { classification: "internal" };
    // A capability-rich candidate that fails the classification ceiling.
    const richButUnlawful = candidate({
      vector: vector({
        cpuUtilization: 1,
        gpuUtilization: 1,
        minMemoryGb: 128,
        minStorageGb: 4096,
        networkMbps: 10000,
        unpluggedMinutes: 960,
        offsiteFraction: 1,
        peripheralCount: 8,
        classification: "restricted",
        downtimeCostPerHourUsd: 100000,
      }),
      maxSecurityClassification: "unclassified",
    });
    const fit = assessFit(requirements, constraints, richButUnlawful, 0.75);
    expect(fit.satisfaction).toBe(1); // soft score perfect
    expect(fit.constraintCheck.satisfied).toBe(false); // hard gate failed
    expect(fit.meetsThreshold).toBe(false); // NEVER traded off
    expect(fit.threshold).toBe(0.75);
  });

  test("a fitting candidate meets the threshold; a weak one does not", () => {
    const requirements = balancedVector();
    const fit = assessFit(requirements, {}, candidate(), 0.75);
    expect(fit.meetsThreshold).toBe(true);
    expect(fit.constraintCheck.satisfied).toBe(true);

    const weak = candidate({
      vector: vector({ cpuUtilization: 0.05, minMemoryGb: 1, minStorageGb: 1 }),
      maxSecurityClassification: "unclassified",
      environments: [],
      peripherals: [],
      availableApplications: [],
    });
    const weakFit = assessFit(requirements, {}, weak, 0.75);
    expect(weakFit.satisfaction < 0.75).toBe(true);
    expect(weakFit.meetsThreshold).toBe(false);
  });

  test("assessFit is deterministic (byte-identical across runs)", () => {
    const a = assessFit(balancedVector(), { classification: "internal" }, candidate(), 0.75);
    const b = assessFit(balancedVector(), { classification: "internal" }, candidate(), 0.75);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
