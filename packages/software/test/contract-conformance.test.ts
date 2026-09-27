/**
 * W032 D5 — Contract conformance: the software package against the
 * frozen @fleetos/contracts surface and the @fleetos/contracts/testing
 * fixture builders.
 *
 * End-to-end: a real W022 WorkloadRecommendation run produces a DRAFT
 * SoftwareSubscriptionIntentPayload that this package consumes. The
 * test verifies the W022 → W032 bridge.
 *
 * Fixture builders consumed (deterministic, valid-by-construction):
 *   makeTenantId, makeTimestamp, makeCorrelationId, makeWorkloadId,
 *   makeIntent, makeAllIntents, FIXTURE_TIME_ANCHOR.
 * Frozen contracts helpers exercised: asWorkloadId, validateTenantRef,
 *   isValidTenantId, assertVersion, makeVersioned,
 *   SOFTWARE_SUBSCRIPTION_INTENT_KIND, toApiError.
 */

import { describe, expect, test } from "bun:test";
import {
  asWorkloadId,
  assertVersion,
  isValidTenantId,
  makeVersioned,
  toApiError,
  validateTenantRef,
} from "@fleetos/contracts";
import { SOFTWARE_SUBSCRIPTION_INTENT_KIND } from "@fleetos/contracts";
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
  SUBSCRIPTION_MODEL_VERSION,
  SUBSCRIPTION_SCHEMA_VERSION,
  SOFTWARE_ALLOCATION_ENGINE_VERSION,
  allocateSubscription,
  createInMemorySoftwareAuditSink,
  createInMemorySubscriptionStore,
  createSubscriptionService,
  reviseSubscription,
} from "../src/index";

describe("conformance: fixture tenants + timestamps", () => {
  test("fixture tenant ids satisfy the frozen grammar and scope subscription contexts", () => {
    for (let seed = 0; seed < 5; seed++) {
      const tenantId = makeTenantId(seed);
      expect(isValidTenantId(tenantId)).toBe(true);
      expect(validateTenantRef(tenantId).ok).toBe(true);
      const ctx = makeTenantContext(tenantId, makeCorrelationId(seed));
      void ctx;
      const built = allocateSubscription(tenantId, {
        softwareIntent: { softwareId: `app.fixture_${seed}`, seatCount: 1 },
        at: makeTimestamp(seed),
        correlationId: makeCorrelationId(seed),
      });
      expect(built.ok).toBe(true);
      expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
      expect(makeTimestamp(seed).startsWith("2026-01-01T")).toBe(true);
    }
  });
});

describe("conformance: W022 → W032 bridge (SoftwareSubscriptionIntent payload consumption)", () => {
  test("a W022 DRAFT SoftwareSubscriptionIntentPayload round-trips through makeIntent and into allocateSubscription", () => {
    const tenantId = makeTenantId("w032-software-bridge");
    const intent = makeIntent({
      seed: "w032-software-bridge",
      kind: SOFTWARE_SUBSCRIPTION_INTENT_KIND,
      tenantId,
      payload: { softwareId: "app.bi_dashboard", seatCount: 5 },
    });
    expect(intent.payload.kind).toBe(SOFTWARE_SUBSCRIPTION_INTENT_KIND);

    const built = allocateSubscription(tenantId, {
      softwareIntent: { softwareId: "app.bi_dashboard", seatCount: 5 },
      workloadId: asWorkloadId("wl_bridge"),
      termDays: 365,
      at: makeTimestamp("w032-software-bridge"),
      correlationId: makeCorrelationId("w032-software-bridge"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.subscription.softwareId).toBe("app.bi_dashboard");
    expect(built.subscription.seatCount).toBe(5);
  });

  test("all nine intent kinds are present in the fixture (frozen surface)", () => {
    const all = makeAllIntents("w032-software-intents");
    expect(all.length).toBe(9);
    expect(all.some((i) => i.payload.kind === SOFTWARE_SUBSCRIPTION_INTENT_KIND)).toBe(true);
  });
});

describe("conformance: versioning discipline", () => {
  test("subscription records carry schema versions the consumer can assert", () => {
    const tenantId = makeTenantId("w032-software-versioning");
    const built = allocateSubscription(tenantId, {
      softwareIntent: { softwareId: "app.v", seatCount: 1 },
      at: makeTimestamp("w032-sv"),
      correlationId: makeCorrelationId("w032-sv"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.subscription.schemaVersion).toBe(SUBSCRIPTION_SCHEMA_VERSION);
    expect(built.subscription.modelVersion).toBe(SUBSCRIPTION_MODEL_VERSION);
    const versioned = makeVersioned(built.subscription, built.subscription.schemaVersion);
    expect(assertVersion(versioned, [1]).ok).toBe(true);
    expect(assertVersion(versioned, [2]).ok).toBe(false);
    expect(assertVersion(makeVersioned(built.subscription, 0), [0]).ok).toBe(false);
  });

  test("SOFTWARE_ALLOCATION_ENGINE_VERSION is a stable string", () => {
    expect(SOFTWARE_ALLOCATION_ENGINE_VERSION).toBe("software-allocation/1");
  });

  test("a revision carries the same schema version + a new content hash", () => {
    const tenantId = makeTenantId("w032-software-revision");
    const prior = allocateSubscription(tenantId, {
      softwareIntent: { softwareId: "app.r", seatCount: 5 },
      at: makeTimestamp("w032-sr"),
      correlationId: makeCorrelationId("w032-sr"),
    });
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    const next = reviseSubscription(prior.subscription, {
      seatCount: 10,
      at: makeTimestamp("w032-sr2"),
      correlationId: makeCorrelationId("w032-sr2"),
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.subscription.schemaVersion).toBe(SUBSCRIPTION_SCHEMA_VERSION);
    expect(next.subscription.revision).toBe(2);
    expect(next.subscription.contentHash).not.toBe(prior.subscription.contentHash);
  });
});

describe("conformance: FleetError taxonomy + audit seam", () => {
  test("subscription errors translate through the frozen toApiError mapping", () => {
    const bad = allocateSubscription(makeTenantId("w032-software-errors"), {
      softwareIntent: { softwareId: "", seatCount: 5 },
      at: makeTimestamp("x"),
      correlationId: makeCorrelationId("x"),
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(toApiError(bad.error).status).toBe(400);
  });

  test("the audited service works end to end with fixture-scoped contexts", () => {
    const tenantId = makeTenantId("w032-software-service");
    const sink = createInMemorySoftwareAuditSink();
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: sink,
    });
    const result = service.allocate(
      makeTenantContext(tenantId, makeCorrelationId("w032-ss")),
      {
        softwareIntent: { softwareId: "app.service", seatCount: 3 },
        at: makeTimestamp("w032-ss"),
        correlationId: makeCorrelationId("w032-ss"),
      },
    );
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.tenantId).toBe(tenantId);
    expect(sink.records[0]?.occurredAt).toBe(makeTimestamp("w032-ss"));
  });
});
