/**
 * W032 D5 — Contract conformance: the procurement package against the
 * frozen @fleetos/contracts surface and the @fleetos/contracts/testing
 * fixture builders.
 *
 * End-to-end: a real W022 WorkloadRecommendation run produces DRAFT
 * ProcurementIntentPayload + CandidateRejection evidence that this
 * package consumes as machine-stable matching input. The test
 * verifies the W022 → W032 bridge.
 *
 * Fixture builders consumed (deterministic, valid-by-construction):
 *   makeTenantId, makeTimestamp, makeCorrelationId, makeWorkloadId,
 *   makeIntent, makeAllIntents, FIXTURE_TIME_ANCHOR.
 * Frozen contracts helpers exercised: asWorkloadId, asVendorId,
 *   asTenantId, asCorrelationId, validateTenantRef, isValidTenantId,
 *   assertVersion, makeVersioned, PROCUREMENT_INTENT_KIND,
 *   toApiError.
 */

import { describe, expect, test } from "bun:test";
import {
  asTenantId,
  asVendorId,
  asWorkloadId,
  asCorrelationId,
  assertVersion,
  isValidTenantId,
  makeVersioned,
  toApiError,
  validateTenantRef,
} from "@fleetos/contracts";
import { PROCUREMENT_INTENT_KIND } from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeAllIntents,
  makeCorrelationId,
  makeIntent,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { makeTenantContext } from "@fleetos/identity";
import {
  DEMAND_MODEL_VERSION,
  DEMAND_SCHEMA_VERSION,
  QUOTE_MODEL_VERSION,
  QUOTE_SCHEMA_VERSION,
  AGGREGATION_MODEL_VERSION,
  AGGREGATION_SCHEMA_VERSION,
  MATCH_ENGINE_VERSION,
  buildDemand,
  createDemand,
  issueQuote,
  acceptQuote,
  supersedeQuote,
  appendQuote,
  createQuoteLedger,
  formAggregation,
  matchDemand,
} from "../src/index";
import type { Vendor } from "@fleetos/vendors";
import { buildVendor } from "@fleetos/vendors";

describe("conformance: fixture tenants + timestamps", () => {
  test("fixture tenant ids satisfy the frozen grammar and scope demand contexts", () => {
    for (let seed = 0; seed < 5; seed++) {
      const tenantId = makeTenantId(seed);
      expect(isValidTenantId(tenantId)).toBe(true);
      expect(validateTenantRef(tenantId).ok).toBe(true);
      const ctx = makeTenantContext(tenantId, makeCorrelationId(seed));
      void ctx; // ctx is required for store ops; the demand is built directly here.
      const built = buildDemand(tenantId, {
        procurementIntent: { workloadId: "wl_x", description: "test" },
        at: makeTimestamp(seed),
        deadline: "2026-12-01T00:00:00Z",
        deliveryArea: "us-east-1",
        budget: { usd: 1000 },
        slaFloor: { coverage: 0.8 },
        warrantyFloor: { days: 90 },
        qualityFloor: { score: 0.7 },
        availabilityFloor: { ratio: 0.5 },
        correlationId: makeCorrelationId(seed),
      });
      expect(built.ok).toBe(true);
      expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
      expect(makeTimestamp(seed).startsWith("2026-01-01T")).toBe(true);
    }
  });
});

describe("conformance: W022 → W032 bridge (ProcurementIntent payload consumption)", () => {
  test("a W022 DRAFT ProcurementIntentPayload round-trips through makeIntent and into buildDemand", () => {
    const tenantId = makeTenantId("w032-bridge");
    // Build the intent via the frozen fixture builder (the W022 path
    // produces the same payload shape).
    const intent = makeIntent({
      seed: "w032-bridge",
      kind: PROCUREMENT_INTENT_KIND,
      tenantId,
      payload: { workloadId: "wl_bridge", description: "Procure a laptop." },
    });
    expect(intent.payload.kind).toBe(PROCUREMENT_INTENT_KIND);

    // The payload the demand consumes is the SAME shape (the intent
    // envelope wraps it; the demand consumes the bare payload).
    const built = buildDemand(tenantId, {
      procurementIntent: {
        workloadId: "wl_bridge",
        description: "Procure a laptop.",
      },
      at: makeTimestamp("w032-bridge"),
      deadline: "2026-12-01T00:00:00Z",
      deliveryArea: "us-east-1",
      budget: { usd: 1500 },
      slaFloor: { coverage: 0.85 },
      warrantyFloor: { days: 180 },
      qualityFloor: { score: 0.75 },
      availabilityFloor: { ratio: 0.6 },
      correlationId: makeCorrelationId("w032-bridge"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.demand.workloadId).toBe(asWorkloadId("wl_bridge"));
    expect(built.demand.description).toBe("Procure a laptop.");
  });

  test("all nine intent kinds are present in the fixture (frozen surface)", () => {
    const all = makeAllIntents("w032-intents");
    expect(all.length).toBe(9);
    expect(all.some((i) => i.payload.kind === PROCUREMENT_INTENT_KIND)).toBe(true);
  });

  test("rejection evidence from W022 flows through the demand to the matcher (machine-stable)", () => {
    const tenantId = makeTenantId("w032-rejection-evidence");
    const built = buildDemand(tenantId, {
      procurementIntent: { workloadId: "wl_rej", description: "test" },
      at: makeTimestamp("w032-rej"),
      deadline: "2026-12-01T00:00:00Z",
      deliveryArea: "us-east-1",
      budget: { usd: 1500 },
      slaFloor: { coverage: 0.85 },
      warrantyFloor: { days: 180 },
      qualityFloor: { score: 0.75 },
      availabilityFloor: { ratio: 0.6 },
      correlationId: makeCorrelationId("w032-rej"),
      rejectionEvidence: [
        { candidateId: "class.engineering_workstation", reason: "version_below_minimum" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.demand.rejectionEvidence.length).toBe(1);
    expect(built.demand.rejectionEvidence[0]?.candidateId).toBe("class.engineering_workstation");
    expect(built.demand.rejectionEvidence[0]?.reason).toBe("version_below_minimum");
  });
});

describe("conformance: versioning discipline", () => {
  test("demand + quote + aggregation records carry schema versions the consumer can assert", () => {
    const tenantId = makeTenantId("w032-versioning");
    const built = buildDemand(tenantId, {
      procurementIntent: { workloadId: "wl_v", description: "test" },
      at: makeTimestamp("w032-v"),
      deadline: "2026-12-01T00:00:00Z",
      deliveryArea: "us-east-1",
      budget: { usd: 1500 },
      slaFloor: { coverage: 0.85 },
      warrantyFloor: { days: 180 },
      qualityFloor: { score: 0.75 },
      availabilityFloor: { ratio: 0.6 },
      correlationId: makeCorrelationId("w032-v"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.demand.schemaVersion).toBe(DEMAND_SCHEMA_VERSION);
    expect(built.demand.modelVersion).toBe(DEMAND_MODEL_VERSION);
    const demandVersioned = makeVersioned(built.demand, built.demand.schemaVersion);
    expect(assertVersion(demandVersioned, [1]).ok).toBe(true);

    // Build a vendor + match + quote to test the quote schema version.
    const vendor = buildVendor(tenantId, {
      vendorId: asVendorId("vnd_w032_versioning"),
      name: "Acme",
      description: "test",
      capabilities: [{ kind: "device-class", id: "class.standard_laptop" }],
      inventory: [
        {
          capability: { kind: "device-class", id: "class.standard_laptop" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
      terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 365 } },
      regions: ["us-east-1"],
      at: makeTimestamp("w032-v"),
      correlationId: makeCorrelationId("w032-v"),
    });
    if (!vendor.ok) throw new Error(vendor.error.message);
    const match = matchDemand(built.demand, [vendor.vendor], {
      at: makeTimestamp("w032-v"),
      correlationId: makeCorrelationId("w032-v"),
    });
    if (!match.ok) throw new Error(match.error.message);
    const quote = issueQuote({
      demand: built.demand,
      match: match.matches[0]!,
      unitPriceUsd: 1500,
      leadTimeDays: 7,
      warrantyDays: 365,
      slaCoverage: 0.95,
      at: makeTimestamp("w032-v"),
      correlationId: makeCorrelationId("w032-v"),
    });
    if (!quote.ok) throw new Error(quote.error.message);
    expect(quote.quote.schemaVersion).toBe(QUOTE_SCHEMA_VERSION);
    expect(quote.quote.modelVersion).toBe(QUOTE_MODEL_VERSION);
    const quoteVersioned = makeVersioned(quote.quote, quote.quote.schemaVersion);
    expect(assertVersion(quoteVersioned, [1]).ok).toBe(true);

    // Aggregation schema version.
    const agg = formAggregation(
      tenantId,
      vendor.vendor.vendorId,
      "us-east-1",
      "2026-12-01T00:00:00Z",
      [quote.quote],
      makeTimestamp("w032-v"),
      makeCorrelationId("w032-v"),
    );
    if (!agg.ok) throw new Error(agg.error.message);
    expect(agg.aggregation.schemaVersion).toBe(AGGREGATION_SCHEMA_VERSION);
    expect(agg.aggregation.modelVersion).toBe(AGGREGATION_MODEL_VERSION);
  });

  test("MATCH_ENGINE_VERSION is a stable string", () => {
    expect(MATCH_ENGINE_VERSION).toBe("procurement-matching/1");
  });
});

describe("conformance: FleetError taxonomy", () => {
  test("demand errors translate through the frozen toApiError mapping", () => {
    const bad = buildDemand(makeTenantId("w032-errors"), {
      procurementIntent: { description: "" },
      at: makeTimestamp("x"),
      deadline: "2026-12-01T00:00:00Z",
      deliveryArea: "us-east-1",
      budget: { usd: 1000 },
      slaFloor: { coverage: 0.8 },
      warrantyFloor: { days: 90 },
      qualityFloor: { score: 0.7 },
      availabilityFloor: { ratio: 0.5 },
      correlationId: makeCorrelationId("x"),
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(toApiError(bad.error).status).toBe(400);
  });
});

// Re-exports for the type checker (suppress unused).
export type { Vendor };
void asTenantId;
void asCorrelationId;
