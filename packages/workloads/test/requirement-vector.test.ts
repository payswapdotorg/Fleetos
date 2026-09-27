/**
 * W022 D2 tests — requirement vectors: dimensions, anchor normalization,
 * validation, comparison helpers.
 *
 * Core invariants under test:
 *   - normalization is deterministic and monotone in the raw units;
 *   - anchors clamp outside their range;
 *   - every normalized value lands in [0, 1];
 *   - unspecified dimensions are 0 and lower the confidence;
 *   - compareVectors' satisfaction math is exact and deterministic.
 */

import { describe, expect, test } from "bun:test";
import {
  CLASSIFICATION_ORDER,
  CLASSIFICATION_SECURITY_DEMAND,
  NORMALIZATION_ANCHORS,
  REQUIREMENT_DIMENSIONS,
  REQUIREMENT_DIMENSION_COUNT,
  REQUIREMENT_VECTOR_VERSION,
  classificationMeets,
  classificationToSecurityDemand,
  compareVectors,
  diffRequirementVectors,
  interpolateAnchors,
  normalizeRequirements,
  validateRequirementVector,
} from "../src/requirement-vector";
import { balancedVector, vector } from "./helpers";

describe("D2: dimensions + classification", () => {
  test("ten canonical dimensions, frozen set, no duplicates", () => {
    expect(REQUIREMENT_DIMENSION_COUNT).toBe(10);
    expect(REQUIREMENT_DIMENSIONS.length).toBe(10);
    expect(new Set(REQUIREMENT_DIMENSIONS).size).toBe(10);
    expect(Object.isFrozen(REQUIREMENT_DIMENSIONS)).toBe(true);
  });

  test("classification order is strict and the demand mapping is monotone", () => {
    expect(CLASSIFICATION_ORDER).toEqual(["unclassified", "internal", "confidential", "restricted"]);
    let previous = -1;
    for (const level of CLASSIFICATION_ORDER) {
      const demand = CLASSIFICATION_SECURITY_DEMAND[level];
      expect(demand > previous).toBe(true);
      expect(demand <= 1).toBe(true);
      previous = demand;
    }
    expect(classificationToSecurityDemand("restricted")).toBe(0.9);
    expect(classificationMeets("internal", "internal")).toBe(true);
    expect(classificationMeets("internal", "restricted")).toBe(true);
    expect(classificationMeets("restricted", "internal")).toBe(false);
  });
});

describe("D2: anchor normalization (W011's pattern)", () => {
  test("piecewise-linear interpolation hits the anchors exactly", () => {
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 0)).toBe(0);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 8)).toBe(0.3);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 16)).toBe(0.5);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 32)).toBe(0.7);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 64)).toBe(0.85);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 128)).toBe(1);
  });

  test("interpolation is linear between anchors", () => {
    // 12 GB is halfway between 8 (0.3) and 16 (0.5) -> 0.4.
    expect(Math.abs(interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, 12) - 0.4) < 1e-10).toBe(true);
    // 600 Mbps is 1/5 between 500 (0.7) and 1000 (0.85) -> 0.73.
    expect(Math.abs(interpolateAnchors(NORMALIZATION_ANCHORS.networkMbps, 600) - 0.73) < 1e-10).toBe(true);
  });

  test("values clamp outside the anchor range and reject non-finite raws", () => {
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.storageGb, -100)).toBe(0);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.storageGb, 1e9)).toBe(1);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.networkMbps, Number.NaN)).toBe(0);
    expect(interpolateAnchors(NORMALIZATION_ANCHORS.networkMbps, Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("normalization is monotone across the full raw range", () => {
    let previous = -1;
    for (let gb = 0; gb <= 300; gb += 7) {
      const normalized = interpolateAnchors(NORMALIZATION_ANCHORS.memoryGb, gb);
      expect(normalized >= previous).toBe(true);
      expect(normalized <= 1).toBe(true);
      previous = normalized;
    }
  });
});

describe("D2: normalizeRequirements", () => {
  test("maps every raw field to its dimension; unspecified dimensions are 0", () => {
    const result = normalizeRequirements({
      cpuUtilization: 0.5,
      minMemoryGb: 32,
      classification: "confidential",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { values, confidence } = result.vector;
    expect(values.cpuDemand).toBe(0.5);
    expect(values.memoryDemand).toBe(0.7);
    expect(values.securityDemand).toBe(0.65);
    expect(values.gpuDemand).toBe(0);
    expect(values.storageDemand).toBe(0);
    expect(values.networkDemand).toBe(0);
    expect(values.powerDependence).toBe(0);
    expect(values.mobilityDemand).toBe(0);
    expect(values.peripheralDemand).toBe(0);
    expect(values.downtimeSensitivity).toBe(0);
    expect(confidence).toBe(3 / 10);
    expect(result.vector.vectorVersion).toBe(REQUIREMENT_VECTOR_VERSION);
  });

  test("an empty raw input yields an all-zero vector with confidence 0", () => {
    const result = normalizeRequirements({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const dimension of REQUIREMENT_DIMENSIONS) {
      expect(result.vector.values[dimension]).toBe(0);
    }
    expect(result.vector.confidence).toBe(0);
  });

  test("out-of-range ratios and negative quantities fail with machine fields", () => {
    const badRatio = normalizeRequirements({ cpuUtilization: 1.5 });
    expect(badRatio.ok).toBe(false);
    if (badRatio.ok) return;
    expect(badRatio.failures).toEqual([{ field: "/cpuUtilization", reason: "not_in_unit_range" }]);

    const badQuantity = normalizeRequirements({ minMemoryGb: -8 });
    expect(badQuantity.ok).toBe(false);
    if (badQuantity.ok) return;
    expect(badQuantity.failures).toEqual([{ field: "/minMemoryGb", reason: "not_non_negative_number" }]);

    const badClassification = normalizeRequirements({
      classification: "top-secret" as Parameters<typeof normalizeRequirements>[0]["classification"],
    });
    expect(badClassification.ok).toBe(false);
    if (badClassification.ok) return;
    expect(badClassification.failures).toEqual([{ field: "/classification", reason: "unknown_classification" }]);
  });

  test("normalization is byte-identical across runs (determinism)", () => {
    const raw = {
      cpuUtilization: 0.7,
      gpuUtilization: 0.1,
      minMemoryGb: 24,
      minStorageGb: 700,
      networkMbps: 250,
      unpluggedMinutes: 200,
      offsiteFraction: 0.65,
      peripheralCount: 4,
      classification: "internal" as const,
      downtimeCostPerHourUsd: 2500,
    };
    const first = normalizeRequirements(raw);
    const second = normalizeRequirements(raw);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // Field insertion order never matters (canonical content).
    const reordered = normalizeRequirements({
      downtimeCostPerHourUsd: 2500,
      classification: "internal",
      peripheralCount: 4,
      offsiteFraction: 0.65,
      unpluggedMinutes: 200,
      networkMbps: 250,
      minStorageGb: 700,
      minMemoryGb: 24,
      gpuUtilization: 0.1,
      cpuUtilization: 0.7,
    });
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));
  });
});

describe("D2: validateRequirementVector", () => {
  test("a normalized vector validates", () => {
    expect(validateRequirementVector(balancedVector()).ok).toBe(true);
  });

  test("out-of-range, non-finite, and wrong-version values fail with per-dimension reasons", () => {
    const base = balancedVector();
    const outOfRange = { ...base, values: { ...base.values, cpuDemand: 1.2 } };
    expect(validateRequirementVector(outOfRange).ok).toBe(false);

    const nonFinite = { ...base, values: { ...base.values, gpuDemand: Number.NaN } };
    const check = validateRequirementVector(nonFinite);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.failures).toEqual([{ dimension: "gpuDemand", reason: "not_finite_number" }]);

    const badVersion = { ...base, vectorVersion: 0 };
    const versionCheck = validateRequirementVector(badVersion);
    expect(versionCheck.ok).toBe(false);
    if (versionCheck.ok) return;
    expect(
      versionCheck.failures.some(
        (f) => f.dimension === "vector" && f.reason === "unsupported_version",
      ),
    ).toBe(true);

    const badConfidence = { ...base, confidence: 1.5 };
    expect(validateRequirementVector(badConfidence).ok).toBe(false);
  });
});

describe("D2: compareVectors", () => {
  test("a fully-covering candidate scores 1 with no deficits", () => {
    const requirement = vector({ cpuUtilization: 0.5, minMemoryGb: 16 });
    const offered = vector({ cpuUtilization: 0.8, minMemoryGb: 32 });
    const comparison = compareVectors(requirement, offered);
    expect(comparison.satisfaction).toBe(1);
    expect(comparison.deficits).toEqual([]);
    expect(comparison.satisfied).toContain("cpuDemand");
    expect(comparison.satisfied).toContain("memoryDemand");
    // Zero-requirement dimensions are trivially satisfied.
    expect(comparison.satisfied.length).toBe(REQUIREMENT_DIMENSION_COUNT);
    expect(comparison.worstDimension).not.toBeNull();
  });

  test("partial coverage scores the exact ratio mean", () => {
    const requirement = vector({ cpuUtilization: 0.8, minMemoryGb: 32 });
    const offered = vector({ cpuUtilization: 0.4, minMemoryGb: 32 });
    const comparison = compareVectors(requirement, offered);
    // cpuDemand: 0.4/0.8 = 0.5; memoryDemand: 1; eight zero-requirement dims: 1 each.
    const expected = (0.5 + 1 + 8) / 10;
    expect(Math.abs(comparison.satisfaction - expected) < 1e-10).toBe(true);
    expect(comparison.deficits).toEqual(["cpuDemand"]);
    expect(comparison.worstDimension).toBe("cpuDemand");
    const cpuFit = comparison.dimensions.find((d) => d.dimension === "cpuDemand");
    expect(Math.abs((cpuFit?.satisfaction ?? 0) - 0.5) < 1e-10).toBe(true);
    expect(cpuFit?.required).toBe(0.8);
    expect(cpuFit?.offered).toBe(0.4);
  });

  test("deltas report offered - required per dimension", () => {
    const requirement = vector({ cpuUtilization: 0.3, offsiteFraction: 0.6 });
    const offered = vector({ cpuUtilization: 0.9, offsiteFraction: 0.2 });
    const comparison = compareVectors(requirement, offered);
    expect(Math.abs(comparison.deltas.cpuDemand - 0.6) < 1e-10).toBe(true);
    expect(Math.abs(comparison.deltas.mobilityDemand - -0.4) < 1e-10).toBe(true);
  });

  test("worst-dimension tie-break is canonical order; comparison is deterministic", () => {
    const requirement = vector({ cpuUtilization: 0.9, gpuUtilization: 0.9 });
    const offered = vector({ cpuUtilization: 0.45, gpuUtilization: 0.45 });
    const comparison = compareVectors(requirement, offered);
    // Both deficits score 0.5 -> the tie breaks to the canonical-first
    // dimension (cpuDemand precedes gpuDemand in REQUIREMENT_DIMENSIONS).
    expect(comparison.worstDimension).toBe("cpuDemand");
    expect(JSON.stringify(compareVectors(requirement, offered))).toBe(
      JSON.stringify(compareVectors(requirement, offered)),
    );
  });
});

describe("D2: diffRequirementVectors", () => {
  test("dominance lists are exact and canonical", () => {
    const left = vector({ cpuUtilization: 0.8, minMemoryGb: 8 });
    const right = vector({ cpuUtilization: 0.4, minMemoryGb: 16 });
    const diff = diffRequirementVectors(left, right);
    expect(diff.leftDominates).toEqual(["cpuDemand"]);
    expect(diff.rightDominates).toEqual(["memoryDemand"]);
    expect(Math.abs(diff.deltas.cpuDemand - 0.4) < 1e-10).toBe(true);
    expect(Math.abs(diff.deltas.memoryDemand - -0.2) < 1e-10).toBe(true);
    expect(diff.equalDimensions.length).toBe(8);
  });
});
