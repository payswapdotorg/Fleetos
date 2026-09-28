import { describe, expect, test } from "bun:test";
import { compileCoverageReport, compileE2EEvidence } from "../src/evidence";

const GOOD = {
  journeyId: "journey.remediate-finding",
  recordKinds: ["security.finding", "policy.decision"],
  steps: [
    { ordinal: 1, step: "security.observe", evidenceRefs: ["ref-1"], outcome: "SUCCEEDED" as const },
    { ordinal: 2, step: "policy.propose", evidenceRefs: ["ref-2"], outcome: "SUCCEEDED" as const },
    { ordinal: 3, step: "ops.confirm", evidenceRefs: ["ref-3"], outcome: "SUCCEEDED" as const },
  ],
  capturedAt: "2026-09-28T12:00:00Z",
};

describe("W080 D4a — E2E evidence bundles", () => {
  test("a complete bundle is content-addressed and deterministic", () => {
    const a = compileE2EEvidence(GOOD);
    const b = compileE2EEvidence(GOOD);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    if (!b.ok) throw new Error("expected ok");
    expect(a.bundle.bundleDigest).toBe(b.bundle.bundleDigest);
    expect(a.bundle.recordKinds).toEqual(["policy.decision", "security.finding"]); // sorted at construction
    expect(a.bundle.bundleDigest).toHaveLength(8);
  });

  test("INCOMPLETE evidence refuses with the SORTED missing paths (fail-fast)", () => {
    const bad = compileE2EEvidence({
      ...GOOD,
      steps: [
        { ordinal: 1, step: "security.observe", evidenceRefs: [], outcome: "SUCCEEDED" },
        { ordinal: 2, step: "policy.propose", evidenceRefs: ["ok"], outcome: "SUCCEEDED" },
        { ordinal: 3, step: "ops.confirm", evidenceRefs: [""], outcome: "SUCCEEDED" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.kind).toBe("evidence_incomplete");
    if (bad.kind === "evidence_incomplete") {
      expect(bad.missing).toEqual(["steps[0].evidenceRefs", "steps[2].evidenceRefs"]);
    }
  });

  test("malformed bundles refuse machine-stably (ordinals, vocabulary, outcomes)", () => {
    const bad = compileE2EEvidence({
      ...GOOD,
      steps: [
        { ordinal: 2, step: "BAD STEP NAME", evidenceRefs: ["x"], outcome: "WHATEVER" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.kind).toBe("bundle_malformed");
    if (bad.kind === "bundle_malformed") {
      expect(bad.reasons).toContain("ordinal_sequence_broken");
      expect(bad.reasons).toContain("step_vocabulary_invalid");
      expect(bad.reasons).toContain("outcome_invalid");
    }
  });

  test("a FAILED outcome still requires its evidence (proof of attempt)", () => {
    const bad = compileE2EEvidence({
      ...GOOD,
      steps: [{ ordinal: 1, step: "ops.verify", evidenceRefs: [], outcome: "FAILED" }],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.kind).toBe("evidence_incomplete");
  });
});

describe("W080 D4a — E2E coverage reports", () => {
  test("complete coverage requires EVERY required journey to have a bundle", () => {
    const required = ["journey.remediate-finding", "journey.recover-lost-device"];
    const bundle = compileE2EEvidence(GOOD);
    if (!bundle.ok) throw new Error("expected ok");
    const report = compileCoverageReport(required, [bundle.bundle]);
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual(["journey.recover-lost-device"]);
    expect(report.covered).toEqual(["journey.remediate-finding"]);
  });

  test("extraneous bundles never count toward coverage", () => {
    const other = compileE2EEvidence({ ...GOOD, journeyId: "journey.unknown" });
    if (!other.ok) throw new Error("expected ok");
    const report = compileCoverageReport(["journey.remediate-finding"], [other.bundle]);
    expect(report.complete).toBe(false);
    expect(report.extraneous).toEqual(["journey.unknown"]);
  });

  test("full coverage is reported complete", () => {
    const required = ["a", "b"];
    const aB = compileE2EEvidence({ ...GOOD, journeyId: "a" });
    const bB = compileE2EEvidence({ ...GOOD, journeyId: "b" });
    if (!aB.ok || !bB.ok) throw new Error("expected ok");
    const report = compileCoverageReport(required, [aB.bundle, bB.bundle]);
    expect(report.complete).toBe(true);
    expect(report.missing).toHaveLength(0);
  });
});
