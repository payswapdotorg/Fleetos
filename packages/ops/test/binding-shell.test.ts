/**
 * W080 binding — the REAL @fleetos/web-shell builtin journeys as the
 * E2E coverage vocabulary.
 *
 * Proves (cross-lane, test-scope only):
 *   1. the four REAL W061 builtin journeys are the required-journey
 *      vocabulary for E2E evidence — every journey's record kinds are
 *      coverable by evidence bundles;
 *   2. complete bundles over ALL FOUR real journeys produce a complete
 *      coverage report (the release gate's E2E condition);
 *   3. a missing real journey blocks the release gate
 *      (e2e_coverage_incomplete) — fail-closed end to end.
 */

import { describe, expect, test } from "bun:test";
import { BUILTIN_JOURNEYS, journeyDigest } from "@fleetos/web-shell";
import { compileCoverageReport, compileE2EEvidence, type E2EEvidenceBundle } from "../src/evidence";

const NOW = "2026-09-28T12:00:00Z";

describe("W080 binding — the REAL shell journeys define the E2E vocabulary", () => {
  test("the four REAL builtin journeys are present with real record kinds", () => {
    expect(BUILTIN_JOURNEYS).toHaveLength(4);
    const ids = BUILTIN_JOURNEYS.map((j) => j.journeyId).sort();
    expect(ids).toEqual([
      "onboard-connectivity",
      "recover-lost-device",
      "remediate-finding",
      "service-device",
    ]);
    for (const j of BUILTIN_JOURNEYS) {
      expect(j.steps.length).toBeGreaterThan(0);
      for (const s of j.steps) {
        expect(s.recordKind.length).toBeGreaterThan(0);
      }
    }
  });

  test("every REAL journey compiles a complete evidence bundle over its own steps", () => {
    const bundles: E2EEvidenceBundle[] = [];
    for (const journey of BUILTIN_JOURNEYS) {
      const bundle = compileE2EEvidence({
        journeyId: journey.journeyId,
        recordKinds: journey.steps.map((s) => s.recordKind),
        steps: journey.steps.map((s, i) => ({
          ordinal: i + 1,
          step: `journey.${s.purpose}`,
          evidenceRefs: [`evidence:${journeyDigest(journey)}#${i + 1}`],
          outcome: "SUCCEEDED" as const,
        })),
        capturedAt: NOW,
      });
      expect(bundle.ok).toBe(true);
      if (!bundle.ok) continue;
      bundles.push(bundle.bundle);
    }
    expect(bundles).toHaveLength(4);

    // The coverage report over ALL FOUR real journeys is COMPLETE.
    const report = compileCoverageReport(
      BUILTIN_JOURNEYS.map((j) => j.journeyId),
      bundles,
    );
    expect(report.complete).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.covered).toHaveLength(4);
  });

  test("one missing REAL journey makes the coverage report incomplete (fail-closed)", () => {
    const bundles: E2EEvidenceBundle[] = [];
    for (const journey of BUILTIN_JOURNEYS.slice(0, 3)) {
      const bundle = compileE2EEvidence({
        journeyId: journey.journeyId,
        recordKinds: journey.steps.map((s) => s.recordKind),
        steps: journey.steps.map((s, i) => ({
          ordinal: i + 1,
          step: `journey.${s.purpose}`,
          evidenceRefs: [`evidence:${journeyDigest(journey)}#${i + 1}`],
          outcome: "SUCCEEDED" as const,
        })),
        capturedAt: NOW,
      });
      if (bundle.ok) bundles.push(bundle.bundle);
    }
    const report = compileCoverageReport(
      BUILTIN_JOURNEYS.map((j) => j.journeyId),
      bundles,
    );
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual([BUILTIN_JOURNEYS[3].journeyId]);
  });

  test("journey digests are stable across runs (deterministic evidence refs)", () => {
    const digests = BUILTIN_JOURNEYS.map((j) => journeyDigest(j));
    const again = BUILTIN_JOURNEYS.map((j) => journeyDigest(j));
    expect(digests).toEqual(again);
    expect(new Set(digests).size).toBe(4); // all four distinct
  });
});
