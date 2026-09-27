/**
 * W022 D5 — Cross-cutting invariants: end-to-end determinism, revision
 * immutability under store operations, frozen-record discipline.
 *
 * These tests complement the per-module suites: they run FULL pipelines
 * (observation -> factors -> vector -> profile -> store -> service ->
 * recommendation -> ledger -> audit) and assert byte-identical outputs
 * across runs and across input permutations.
 */

import { describe, expect, test } from "bun:test";
import { asObservationId, asWorkloadId } from "@fleetos/contracts";
import type { Observation } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  aggregateObservedFactors,
  appendRecommendation,
  createInMemoryWorkloadAuditSink,
  createInMemoryWorkloadProfileStore,
  createRecommendationLedger,
  createWorkloadProfileService,
  deriveObservedFactors,
  normalizeRequirements,
  recommendForProfile,
  resolveActiveRecommendations,
} from "../src/index";
import { buildWorkloadProfile, reviseWorkloadProfile } from "../src/profile";
import { CORR, TENANT_A, T0, T1, WL_1, candidate, createInput } from "./helpers";

const WINDOW = { asOf: "2026-01-02T00:00:00Z", windowMs: 48 * 3_600_000 };

function workloadObservations(): Observation[] {
  const payloads: unknown[] = [
    { cpuUtilization: 0.5, memoryUtilization: 0.55, offsiteFraction: 0.3, classification: "internal" },
    { cpuUtilization: 0.45, memoryUtilization: 0.6, networkMbps: 90, unpluggedMinutes: 200 },
    { cpuUtilization: 0.6, memoryUtilization: 0.5, peripheralCount: 3, downtimeCostPerHourUsd: 400 },
    { storageUtilization: 0.5, gpuUtilization: 0.1, offsiteFraction: 0.4 },
  ];
  return payloads.map((payload, index) =>
    Object.freeze({
      id: asObservationId(`obs_inv_${String(index + 1).padStart(4, "0")}`),
      kind: "device.workload",
      observedAt: "2026-01-01T12:00:00Z",
      schemaVersion: 1,
      payload,
    }),
  );
}

/** The full deterministic pipeline under test. */
function runPipeline(observations: readonly Observation[], audit: boolean) {
  const sink = createInMemoryWorkloadAuditSink();
  const store = createInMemoryWorkloadProfileStore();
  const service = createWorkloadProfileService({ store, auditSink: audit ? sink : undefined });
  const ctx = makeTenantContext(TENANT_A, CORR);

  const derivation = deriveObservedFactors(observations, WINDOW);
  if (!derivation.ok) throw new Error("derivation failed");
  const aggregation = aggregateObservedFactors(derivation.factors);
  const vectorResult = normalizeRequirements({
    cpuUtilization: aggregation.vector.values.cpuDemand,
    gpuUtilization: aggregation.vector.values.gpuDemand,
    minMemoryGb: 16,
    networkMbps: 100,
    unpluggedMinutes: 240,
    offsiteFraction: aggregation.vector.values.mobilityDemand,
    peripheralCount: 3,
    classification: "internal",
    downtimeCostPerHourUsd: 500,
  });
  if (!vectorResult.ok) throw new Error("vector failed");
  const evidence = [...new Set(derivation.factors.map((f) => f.observationId))]
    .sort()
    .map((observationId) => ({
      observationId,
      kind: "device.workload",
    }));

  const created = service.createProfile(ctx, {
    ...createInput(),
    requirements: vectorResult.vector,
    evidence,
  });
  if (!created.ok) throw new Error(created.error.message);

  const revised = service.reviseProfile(ctx, WL_1, {
    name: "finance.analyst",
    description: "Tuned after re-observation.",
    requirements: vectorResult.vector,
    at: T1,
    correlationId: CORR,
  });
  if (!revised.ok) throw new Error(revised.error.message);

  const recommendation = recommendForProfile(revised.profile, [candidate()], {
    at: T1,
    correlationId: CORR,
    auditSink: audit ? sink : undefined,
  });
  if (!recommendation.ok) throw new Error(recommendation.error.message);

  let ledger = createRecommendationLedger(TENANT_A, WL_1);
  for (const rec of recommendation.recommendations) {
    const appended = appendRecommendation(ledger, rec);
    if (appended.ok) ledger = appended.ledger;
  }

  return {
    profile: revised.profile,
    revisions: store.listRevisions(ctx, WL_1),
    active: resolveActiveRecommendations(ledger),
    auditRecords: sink.records,
  };
}

describe("invariants: end-to-end determinism", () => {
  test("the full pipeline is byte-identical across runs", () => {
    const first = runPipeline(workloadObservations(), true);
    const second = runPipeline(workloadObservations(), true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("observation input order never changes the pipeline output", () => {
    const observations = workloadObservations();
    const forward = runPipeline(observations, false);
    const backward = runPipeline([...observations].reverse(), false);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  test("audit emission never changes the domain outputs (evidence, not side effect)", () => {
    const withAudit = runPipeline(workloadObservations(), true);
    const withoutAudit = runPipeline(workloadObservations(), false);
    expect(JSON.stringify(withoutAudit.profile)).toBe(JSON.stringify(withAudit.profile));
    expect(JSON.stringify(withoutAudit.active)).toBe(JSON.stringify(withAudit.active));
    expect(withAudit.auditRecords.length).toBe(3); // created + revised + proposed
    expect(withoutAudit.auditRecords.length).toBe(0);
  });
});

describe("invariants: revision immutability under store operations", () => {
  test("stored revisions are never rewritten: byte snapshots survive later revisions", () => {
    const store = createInMemoryWorkloadProfileStore();
    const ctx = makeTenantContext(TENANT_A, CORR);
    store.createProfile(ctx, createInput());

    const snapshots: string[] = [];
    for (let revision = 2; revision <= 4; revision++) {
      const current = store.getLatestProfile(ctx, WL_1);
      expect(current).toBeDefined();
      if (current === undefined) return;
      snapshots.push(JSON.stringify(current));
      const revised = store.reviseProfile(ctx, WL_1, {
        name: current.name,
        description: `revision ${revision}`,
        requirements: current.requirements,
        at: T1,
        correlationId: CORR,
      });
      expect(revised.ok).toBe(true);
      if (!revised.ok) return;
    }

    // Every historical revision is byte-identical to what was written:
    // snapshots[0] is revision 1 (taken before the first revise), etc.
    const history = store.listRevisions(ctx, WL_1);
    expect(history.map((r) => r.revision)).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(history[0])).toBe(snapshots[0]);
    expect(JSON.stringify(history[1])).toBe(snapshots[1]);
    expect(JSON.stringify(history[2])).toBe(snapshots[2]);
    // Content hashes are unique per revision.
    const hashes = new Set(history.map((r) => r.contentHash));
    expect(hashes.size).toBe(4);
  });

  test("every record the package produces is frozen at construction", () => {
    const pipeline = runPipeline(workloadObservations(), true);
    expect(Object.isFrozen(pipeline.profile)).toBe(true);
    expect(Object.isFrozen(pipeline.profile.requirements)).toBe(true);
    expect(Object.isFrozen(pipeline.profile.requirements.values)).toBe(true);
    for (const revision of pipeline.revisions) {
      expect(Object.isFrozen(revision)).toBe(true);
    }
    for (const rec of pipeline.active) {
      expect(Object.isFrozen(rec)).toBe(true);
      expect(Object.isFrozen(rec.fit)).toBe(true);
      expect(Object.isFrozen(rec.proposedIntents)).toBe(true);
    }
    for (const record of pipeline.auditRecords) {
      expect(Object.isFrozen(record)).toBe(true);
    }
  });

  test("profile content hashes are stable per content and unique per revision", () => {
    const tenantId = TENANT_A;
    const input = { ...createInput(), workloadId: asWorkloadId("wl_content_stable") };
    const a = buildWorkloadProfile(tenantId, input);
    const b = buildWorkloadProfile(tenantId, input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Same content -> same hash, byte for byte.
    expect(a.profile.contentHash).toBe(b.profile.contentHash);
    // A genuine revision (new content) -> new hash.
    const revised = reviseWorkloadProfile(a.profile, {
      name: a.profile.name,
      description: "changed",
      requirements: a.profile.requirements,
      at: T1,
      correlationId: CORR,
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.profile.contentHash).not.toBe(a.profile.contentHash);
    expect(revised.profile.revision).toBe(2);
  });
});

describe("invariants: no hidden state (purity)", () => {
  test("recommendForProfile never mutates the profile or candidates", () => {
    const built = buildWorkloadProfile(TENANT_A, createInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const profileSnapshot = JSON.stringify(built.profile);
    const c = candidate();
    const candidateSnapshot = JSON.stringify(c);
    for (let run = 0; run < 3; run++) {
      const result = recommendForProfile(built.profile, [c], { at: T0, correlationId: CORR });
      expect(result.ok).toBe(true);
    }
    expect(JSON.stringify(built.profile)).toBe(profileSnapshot);
    expect(JSON.stringify(c)).toBe(candidateSnapshot);
  });

  test("ledger operations never mutate their input ledger", () => {
    const built = buildWorkloadProfile(TENANT_A, createInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = recommendForProfile(built.profile, [candidate()], { at: T0, correlationId: CORR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    if (rec === undefined) return;

    const ledger = createRecommendationLedger(TENANT_A, WL_1);
    const snapshot = JSON.stringify(ledger);
    const appended = appendRecommendation(ledger, rec);
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(JSON.stringify(ledger)).toBe(snapshot);
    expect(appended.ledger.entries.length).toBe(1);
  });
});
