/**
 * W022 D5 — Contract conformance: the workloads package against the
 * frozen @fleetos/contracts surface and the @fleetos/contracts/testing
 * fixture builders.
 *
 * Fixture builders consumed (deterministic, valid-by-construction):
 *   makeTenantId, makeTimestamp, makeCorrelationId, makeDeviceId,
 *   makeObservationBatch, makeIntent, makeAllIntents, FIXTURE_TIME_ANCHOR.
 * Frozen contracts helpers exercised: asWorkloadId, validateTenantRef,
 * isValidTenantId, assertVersion, makeVersioned, PROCUREMENT_INTENT_KIND,
 * SOFTWARE_SUBSCRIPTION_INTENT_KIND, toApiError.
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
import {
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeAllIntents,
  makeCorrelationId,
  makeDeviceId,
  makeIntent,
  makeObservationBatch,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { makeTenantContext } from "@fleetos/identity";
import {
  WORKLOAD_OBSERVATION_KIND,
  aggregateObservedFactors,
  createInMemoryWorkloadAuditSink,
  createInMemoryWorkloadProfileStore,
  createWorkloadProfileService,
  deriveObservedFactors,
  recommendForProfile,
} from "../src/index";
import type { WorkloadRecommendation } from "../src/index";
import { buildWorkloadProfile } from "../src/profile";
import { candidate, createInput } from "./helpers";

describe("conformance: fixture tenants + timestamps", () => {
  test("fixture tenant ids satisfy the frozen grammar and scope profile contexts", () => {
    for (let seed = 0; seed < 10; seed++) {
      const tenantId = makeTenantId(seed);
      expect(isValidTenantId(tenantId)).toBe(true);
      expect(validateTenantRef(tenantId).ok).toBe(true);
      const ctx = makeTenantContext(tenantId, makeCorrelationId(seed));
      const store = createInMemoryWorkloadProfileStore();
      const created = store.createProfile(
        ctx,
        createInput({ workloadId: asWorkloadId(`wl_fixture_${String(seed)}`) }),
      );
      expect(created.ok).toBe(true);
      // The frozen envelope time anchor is a valid injected timestamp.
      const built = buildWorkloadProfile(tenantId, {
        ...createInput(),
        at: makeTimestamp(seed),
        correlationId: makeCorrelationId(seed),
      });
      expect(built.ok).toBe(true);
      expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
      expect(makeTimestamp(seed).startsWith("2026-01-01T")).toBe(true);
      // Fixture timestamps are deterministic.
      expect(makeTimestamp("conf")).toBe(makeTimestamp("conf"));
    }
  });

  test("fixture-derived workload ids and profiles are deterministic", () => {
    const tenantId = makeTenantId("w022-conformance");
    const a = buildWorkloadProfile(tenantId, createInput({ workloadId: undefined }));
    const b = buildWorkloadProfile(tenantId, createInput({ workloadId: undefined }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.profile.workloadId).toBe(b.profile.workloadId);
    expect(a.profile.contentHash).toBe(b.profile.contentHash);
  });
});

describe("conformance: observation batches feed factor derivation", () => {
  test("makeObservationBatch observations are consumed with forward-compatible skips", () => {
    const batch = makeObservationBatch({ seed: "w022-factors", count: 11 });
    // The fixture cycles through the canonical kinds — only
    // device.workload observations can contribute; the rest skip.
    const result = deriveObservedFactors(batch.observations, {
      asOf: "2026-01-02T00:00:00Z",
      windowMs: 48 * 3_600_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Eleven observations cycle through all canonical kinds: ten unknown
    // kinds skip with unknown_kind, and the one device.workload
    // observation carries an unrecognized fixture payload -> bad_payload
    // (forward compatibility — never an error).
    expect(result.skipped.length).toBe(11);
    expect(result.skipped.filter((s) => s.reason === "unknown_kind").length).toBe(10);
    const workloadObservation = batch.observations.find(
      (o) => o.kind === WORKLOAD_OBSERVATION_KIND,
    );
    expect(workloadObservation).toBeDefined();
    expect(
      result.skipped.some(
        (s) => s.observationId === workloadObservation?.id && s.reason === "bad_payload",
      ),
    ).toBe(true);
    // An empty aggregation is still a valid vector.
    expect(aggregateObservedFactors(result.factors).vector.confidence).toBe(0);
  });

  test("a fixture observation id is carried as profile evidence", () => {
    const batch = makeObservationBatch({ seed: "w022-evidence", count: 1 });
    const observation = batch.observations[0];
    expect(observation).toBeDefined();
    const tenantId = batch.tenantId;
    const built = buildWorkloadProfile(tenantId, {
      ...createInput(),
      evidence: [{ observationId: observation?.id ?? "", kind: observation?.kind }],
      correlationId: makeCorrelationId("w022-evidence"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.profile.evidence[0]?.observationId).toBe(observation?.id);
  });
});

describe("conformance: Fleet Intent linkage (the frozen nine)", () => {
  test("the proposable kinds are exactly the frozen commerce intent kinds", () => {
    // makeAllIntents produces all nine kinds; the two this lane proposes
    // must be present and carry the frozen payload interfaces.
    const all = makeAllIntents("w022-intents");
    expect(all.length).toBe(9);
    const procurement = all.find((i) => i.payload.kind === PROCUREMENT_INTENT_KIND);
    const software = all.find((i) => i.payload.kind === SOFTWARE_SUBSCRIPTION_INTENT_KIND);
    expect(procurement).toBeDefined();
    expect(software).toBeDefined();
    // The frozen ProcurementIntentPayload: description required,
    // workloadId OPTIONAL (the fixture default omits it).
    expect(typeof (procurement?.payload as { description: string }).description).toBe("string");
    expect("workloadId" in (procurement?.payload ?? {})).toBe(false);
    // The frozen SoftwareSubscriptionIntentPayload: seatCount required.
    expect(typeof (software?.payload as { seatCount: number }).seatCount).toBe("number");
  });

  test("a procurement recommendation's draft payload matches the frozen ProcurementIntentPayload shape", () => {
    const tenantId = makeTenantId("w022-procurement");
    const built = buildWorkloadProfile(tenantId, {
      ...createInput(),
      correlationId: makeCorrelationId("w022-procurement"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = recommendForProfile(
      built.profile,
      [candidate({ procurementRequired: true, candidateId: "class.fixture" })],
      { at: makeTimestamp("w022-procurement"), correlationId: makeCorrelationId("w022-procurement") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    expect(rec?.proposedIntents.length).toBe(1);
    const draft = rec?.proposedIntents[0];
    expect(draft?.intentKind).toBe(PROCUREMENT_INTENT_KIND);
    // The frozen payload interface, structurally checked.
    const payload = draft?.payload as { workloadId?: string; description: string };
    expect(payload.workloadId).toBe(built.profile.workloadId);
    expect(payload.description.length > 0).toBe(true);

    // The draft payload round-trips through makeIntent (envelope
    // construction over the frozen shape) without adaptation.
    const intent = makeIntent({
      seed: "w022-procurement",
      kind: PROCUREMENT_INTENT_KIND,
      tenantId,
      payload,
    });
    expect(intent.tenantId).toBe(tenantId);
    expect(intent.payload.kind).toBe(PROCUREMENT_INTENT_KIND);
    expect((intent.payload as { workloadId?: string }).workloadId).toBe(payload.workloadId);
  });

  test("a software draft payload matches the frozen SoftwareSubscriptionIntentPayload shape", () => {
    const tenantId = makeTenantId("w022-software");
    const built = buildWorkloadProfile(tenantId, {
      ...createInput({
        constraints: { requiredApplications: [{ appId: "app.bi_dashboard", minVersion: "5.0" }] },
      }),
      correlationId: makeCorrelationId("w022-software"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = recommendForProfile(built.profile, [candidate()], {
      at: makeTimestamp("w022-software"),
      correlationId: makeCorrelationId("w022-software"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.recommendations[0]?.proposedIntents.find(
      (p) => p.intentKind === SOFTWARE_SUBSCRIPTION_INTENT_KIND,
    );
    expect(draft).toBeDefined();
    const intent = makeIntent({
      seed: "w022-software",
      kind: SOFTWARE_SUBSCRIPTION_INTENT_KIND,
      tenantId,
      payload: draft?.payload,
    });
    expect((intent.payload as { seatCount: number }).seatCount).toBe(1);
    expect((intent.payload as { softwareId?: string }).softwareId).toBe("app.bi_dashboard");
  });
});

describe("conformance: versioning discipline (Versioned<T> + assertVersion)", () => {
  test("profile and recommendation records carry schema versions the consumer can assert", () => {
    const tenantId = makeTenantId("w022-versioning");
    const built = buildWorkloadProfile(tenantId, {
      ...createInput(),
      correlationId: makeCorrelationId("w022-versioning"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const versionedProfile = makeVersioned(built.profile, built.profile.schemaVersion);
    expect(assertVersion(versionedProfile, [1]).ok).toBe(true);
    expect(assertVersion(versionedProfile, [2]).ok).toBe(false);

    const result = recommendForProfile(built.profile, [candidate()], {
      at: makeTimestamp("w022-versioning"),
      correlationId: makeCorrelationId("w022-versioning"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    const versionedRec = makeVersioned(rec as WorkloadRecommendation, rec?.schemaVersion ?? 0);
    expect(assertVersion(versionedRec, [1]).ok).toBe(true);
    expect(assertVersion(versionedRec, [1, 2]).ok).toBe(true);
    expect(assertVersion(versionedRec, [2]).ok).toBe(false);
    // Version 0 is reserved and rejected by the frozen guard.
    expect(assertVersion(makeVersioned(rec, 0), [0]).ok).toBe(false);
  });
});

describe("conformance: FleetError taxonomy + device ids", () => {
  test("workloads errors translate through the frozen toApiError mapping", () => {
    const bad = buildWorkloadProfile(makeTenantId("w022-errors"), createInput({ name: "" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    // The frozen taxonomy maps ValidationError to 400.
    expect(toApiError(bad.error).status).toBe(400);

    // The devices module-map edge is visible in the contracts surface:
    // fixture device ids type-check against the evidence/candidate
    // ecosystem (a workload's observations come from devices).
    const deviceId = makeDeviceId("w022-devices");
    expect(deviceId.startsWith("dev_")).toBe(true);
  });

  test("the audited service works end to end with fixture-scoped contexts", () => {
    const tenantId = makeTenantId("w022-service");
    const sink = createInMemoryWorkloadAuditSink();
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });
    const created = service.createProfile(
      makeTenantContext(tenantId, makeCorrelationId("w022-service")),
      {
        ...createInput({ workloadId: asWorkloadId("wl_fixture_service") }),
        at: makeTimestamp("w022-service"),
        correlationId: makeCorrelationId("w022-service"),
      },
    );
    expect(created.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.tenantId).toBe(tenantId);
    expect(sink.records[0]?.occurredAt).toBe(makeTimestamp("w022-service"));
  });
});
