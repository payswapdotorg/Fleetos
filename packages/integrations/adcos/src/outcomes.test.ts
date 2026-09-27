/**
 * @fleetos/integration-adcos — D1: the canonical outcome vocabulary tests.
 */

import { test, expect } from "bun:test";
import {
  ALL_CANONICAL_OUTCOMES,
  normalizeOutcomeToken,
  recognizeOutcome,
  OUTCOME_REQUIRED_FACETS,
} from "./outcomes";

test("the canonical outcome vocabulary is exactly the four spec examples", () => {
  expect([...ALL_CANONICAL_OUTCOMES]).toEqual([
    "low_latency_local_device_group",
    "secure_private_connectivity",
    "high_throughput_transfer",
    "resilient_connectivity",
  ]);
});

test("outcome normalization is deterministic: case, whitespace and hyphen folding", () => {
  expect(normalizeOutcomeToken("Low-Latency Local Device Group")).toBe("low_latency_local_device_group");
  expect(normalizeOutcomeToken("  secure   private connectivity ")).toBe("secure_private_connectivity");
  expect(normalizeOutcomeToken("HIGH-THROUGHPUT TRANSFER")).toBe("high_throughput_transfer");
  expect(normalizeOutcomeToken("resilient--connectivity")).toBe("resilient_connectivity");
  // The same input always produces the same token.
  expect(normalizeOutcomeToken("Resilient Connectivity")).toBe(normalizeOutcomeToken("resilient connectivity"));
});

test("every canonical outcome is recognized from its human phrasing", () => {
  const phrasings: readonly [string, string][] = [
    ["low-latency local device group", "low_latency_local_device_group"],
    ["Secure Private Connectivity", "secure_private_connectivity"],
    ["high-throughput transfer", "high_throughput_transfer"],
    ["resilient connectivity", "resilient_connectivity"],
  ];
  for (const [raw, canonical] of phrasings) {
    const recognition = recognizeOutcome(raw);
    expect(recognition.ok).toBe(true);
    if (recognition.ok) {
      expect(recognition.outcome).toBe(canonical);
    }
  }
});

test("unrecognized outcomes are refused with the machine-stable unsupported_outcome reason — never a guess", () => {
  for (const raw of ["connected-0", "cheap connectivity", "", "  ", "best-effort", "latency"]) {
    const recognition = recognizeOutcome(raw);
    expect(recognition.ok).toBe(false);
    if (!recognition.ok) {
      expect(recognition.reason).toBe("unsupported_outcome");
      expect(recognition.token).toBe(normalizeOutcomeToken(raw));
    }
  }
});

test("every canonical outcome documents its required facets", () => {
  for (const outcome of ALL_CANONICAL_OUTCOMES) {
    const facets = OUTCOME_REQUIRED_FACETS[outcome];
    expect(Array.isArray(facets)).toBe(true);
    expect(facets.length > 0).toBe(true);
    for (const facet of facets) {
      expect(typeof facet).toBe("string");
      expect(facet.length > 0).toBe(true);
    }
  }
});
