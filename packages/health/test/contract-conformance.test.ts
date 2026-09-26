/**
 * W021 contract-conformance tests — the health engine built AGAINST the
 * frozen @fleetos/contracts surface, verified with the W003 fixture
 * builders from @fleetos/contracts/testing, and integrated end-to-end
 * with the same-lane @fleetos/device-model (W011's accepted Twin +
 * ingestion lane).
 *
 * Fixture builders consumed here:
 *   makeTenantId, makeDeviceId, makeObservationId, makeCorrelationId,
 *   makeTimestamp, makeObservationBatch, makeIntent, makeAllIntents
 * plus the frozen validators (validateTenantRef,
 * validateObservationBatch, validateObservationBatch invariants).
 */

import { describe, expect, test } from "bun:test";
import {
  MAINTAIN_DEVICE_INTENT_KIND,
  validateObservationBatch,
  validateTenantRef,
} from "@fleetos/contracts";
import {
  makeAllIntents,
  makeCorrelationId,
  makeDeviceId,
  makeIntent,
  makeObservationBatch,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { OWNERSHIP_TYPE_FLEET_PURCHASED, enrollDevice } from "@fleetos/device-model";
import { createTwin, recordTwinObservations } from "@fleetos/device-model";
import { deriveSignals } from "../src/signals";
import { buildDeviceBaseline, buildModelBaselines, createTwinModelResolver } from "../src/baselines";
import { detectAnomalies } from "../src/anomalies";
import { diagnose } from "../src/diagnosis";
import { createInMemoryHealthAuditSink } from "../src/audit-seam";
import { AS_OF, SHORT_WINDOW_MS, atHour, obs } from "./helpers";

// Fixture timestamps derive from the frozen FIXTURE_TIME_ANCHOR
// (2026-01-01T00:00:00Z) plus a seeded offset within ONE day; this fixed
// injected `asOf` with a 48h window covers every possible fixture time.
const WINDOW = { asOf: AS_OF, windowMs: SHORT_WINDOW_MS };

describe("conformance: fixture IDs flow through the health engine", () => {
  test("makeTenantId/makeDeviceId scope signals, baselines, anomalies, and diagnoses", () => {
    const tenantId = makeTenantId("w021-conformance");
    const deviceId = makeDeviceId("w021-conformance");
    expect(validateTenantRef(tenantId).ok).toBe(true);

    const observations = [
      {
        id: makeObservationId("w021-battery"),
        kind: "device.power",
        observedAt: makeTimestamp("w021-battery"),
        schemaVersion: 1,
        payload: { batteryPercent: 9 },
      },
    ];
    const derived = deriveSignals(observations, { tenantId, deviceId });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.signals[0].tenantId).toBe(tenantId);
    expect(derived.signals[0].deviceId).toBe(deviceId);
    expect(derived.signals[0].sourceObservationId).toBe(observations[0].id);

    const baseline = buildDeviceBaseline({
      tenantId,
      deviceId,
      signalKind: "battery.capacity",
      window: WINDOW,
      signals: derived.signals,
    });
    expect(baseline.ok).toBe(true);

    const detected = detectAnomalies(derived.signals, {
      tenantId,
      ...WINDOW,
    });
    expect(detected.ok && detected.anomalies).toHaveLength(1);

    const diagnosis = diagnose(detected.ok ? detected.anomalies : [], {
      tenantId,
      deviceId,
      at: AS_OF,
      correlationId: makeCorrelationId("w021-conformance"),
    });
    expect(diagnosis.ok && diagnosis.hypotheses).toHaveLength(1);
    expect(diagnosis.ok && diagnosis.hypotheses[0].tenantId).toBe(tenantId);
  });

  test("makeObservationBatch fixtures are valid AND flow through derivation with enumerable skips", () => {
    const batch = makeObservationBatch({ seed: "w021-batch", count: 5 });
    expect(validateObservationBatch(batch)).toEqual({ ok: true });

    const derived = deriveSignals(batch.observations, {
      tenantId: batch.tenantId,
      deviceId: batch.deviceId,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    // Fixture payloads are { idx, sample } — no extractor recognizes them;
    // every observation is skipped with an enumerable machine reason
    // (forward compatibility: unknown payloads are never errors).
    expect(derived.signals).toHaveLength(0);
    expect(derived.skipped).toHaveLength(5);
    const reasons = new Set(derived.skipped.map((s) => s.reason));
    expect([...reasons]).toEqual(["kind_unmapped", "payload_shape_unexpected"]);
    // The device.health fixture entry is a shape miss; others are unmapped kinds.
    const shapeMiss = derived.skipped.find((s) => s.reason === "payload_shape_unexpected")!;
    expect(shapeMiss.observationKind).toBe("device.health");
  });

  test("proposed intent payloads structurally match the frozen intent payload contracts", () => {
    const tenantId = makeTenantId("w021-intents");
    const deviceId = makeDeviceId("w021-intents");
    const observation = {
      id: makeObservationId("w021-intents"),
      kind: "device.power",
      observedAt: makeTimestamp("w021-intents"),
      schemaVersion: 1,
      payload: { batteryPercent: 7 },
    };
    const derived = deriveSignals([observation], { tenantId, deviceId });
    if (!derived.ok) throw new Error("derive failed");
    const detected = detectAnomalies(derived.signals, {
      tenantId,
      ...WINDOW,
    });
    if (!detected.ok) throw new Error("detect failed");
    const diagnosis = diagnose(detected.anomalies, {
      tenantId,
      deviceId,
      at: AS_OF,
      correlationId: makeCorrelationId("w021-intents"),
    });
    if (!diagnosis.ok) throw new Error("diagnose failed");

    const recommendation = diagnosis.recommendations[0];
    expect(recommendation.proposedIntent.intentKind).toBe(MAINTAIN_DEVICE_INTENT_KIND);

    // The frozen fixture builder produces a REAL MaintainDeviceIntent; our
    // proposal payload must satisfy the same payload shape it carries.
    const realIntent = makeIntent({
      seed: "w021-intents",
      tenantId,
      kind: MAINTAIN_DEVICE_INTENT_KIND,
    });
    expect(realIntent.payload.kind).toBe(MAINTAIN_DEVICE_INTENT_KIND);
    if (realIntent.payload.kind !== MAINTAIN_DEVICE_INTENT_KIND) throw new Error("unexpected kind");
    expect(typeof realIntent.payload.description).toBe("string");
    const proposalPayload = recommendation.proposedIntent.payload as {
      deviceId?: string;
      description: string;
    };
    expect(typeof proposalPayload.description).toBe("string");
    expect(proposalPayload.deviceId).toBe(deviceId);
    // The proposal is NOT an intent: no envelope fields exist on it.
    expect("intentId" in recommendation.proposedIntent).toBe(false);
    expect("version" in recommendation.proposedIntent).toBe(false);
    expect("createdAt" in recommendation.proposedIntent).toBe(false);
  });

  test("every proposable intent kind is one of the nine frozen kinds", () => {
    const all = makeAllIntents("w021-all", makeTenantId("w021-all"));
    expect(all).toHaveLength(9);
    const kinds = new Set(all.map((i) => i.payload.kind));
    expect(kinds.has(MAINTAIN_DEVICE_INTENT_KIND)).toBe(true);
  });
});

describe("conformance: end-to-end with the W011 device-model lane", () => {
  test("twin -> signals -> model baselines -> anomalies -> diagnosis, all contracts-shaped", () => {
    const tenantId = makeTenantId("w021-e2e");
    const deviceIdA = makeDeviceId("w021-e2e-a");
    const deviceIdB = makeDeviceId("w021-e2e-b");
    const correlationId = makeCorrelationId("w021-e2e");

    function twinWith(model: string, deviceId: typeof deviceIdA, batteryReadings: number[]) {
      const enrolled = enrollDevice({
        tenantId,
        deviceId,
        adapterFamily: "windows",
        hardware: { manufacturer: "HP", model },
        ownership: { ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED },
        at: makeTimestamp("w021-e2e-enroll"),
        provenance: { correlationId },
      });
      if (!enrolled.ok) throw new Error("enroll failed");
      const created = createTwin({ identity: enrolled.identity, ctx: { at: makeTimestamp("w021-e2e-enroll"), correlationId } });
      if (!created.ok) throw new Error("create failed");
      const observations = batteryReadings.map((value, i) =>
        obs("device.power", { batteryPercent: value }, atHour(i + 1)),
      );
      const recorded = recordTwinObservations(created.twin, observations, {
        at: makeTimestamp("w021-e2e-record"),
        correlationId,
      });
      if (!recorded.ok) throw new Error("record failed");
      return recorded.twin;
    }

    // Twin A: healthy history but a low latest battery; Twin B: healthy.
    // The twin telemetry window is bounded (latest 10) — 8 readings fit.
    const twinA = twinWith("EliteBook 840", deviceIdA, [80, 78, 76, 74, 60, 40, 20, 12]);
    const twinB = twinWith("EliteBook 840", deviceIdB, [90, 88, 86, 84, 82, 80, 78, 76]);

    const signalsA = deriveSignals(twinA.telemetry.latest, { tenantId, deviceId: deviceIdA });
    const signalsB = deriveSignals(twinB.telemetry.latest, { tenantId, deviceId: deviceIdB });
    if (!signalsA.ok || !signalsB.ok) throw new Error("derive failed");
    const signals = [...signalsA.signals, ...signalsB.signals];

    // Model baselines group both devices through the twin-derived resolver.
    const modelBaselines = buildModelBaselines(
      signals,
      createTwinModelResolver([twinA, twinB]),
      { tenantId, window: WINDOW },
    );
    if (!modelBaselines.ok) throw new Error("model baselines failed");
    expect(modelBaselines.baselines).toHaveLength(1);
    const modelBaseline = modelBaselines.baselines[0];
    expect(modelBaseline.scope.kind === "model" && modelBaseline.scope.model).toBe("EliteBook 840");
    expect(modelBaseline.deviceCount).toBe(2);

    // Device baseline + detection for device A (its own signals only —
    // device baselines never mix devices).
    const deviceBaseline = buildDeviceBaseline({
      tenantId,
      deviceId: deviceIdA,
      signalKind: "battery.capacity",
      window: WINDOW,
      signals: signalsA.signals,
    });
    if (!deviceBaseline.ok) throw new Error("device baseline failed");

    const detected = detectAnomalies(signals, {
      tenantId,
      ...WINDOW,
      baselines: [deviceBaseline.baseline],
    });
    if (!detected.ok) throw new Error("detect failed");
    const forA = detected.anomalies.filter((a) => a.deviceId === deviceIdA);
    expect(forA.map((a) => a.ruleId)).toEqual(["battery.low"]);

    const sink = createInMemoryHealthAuditSink();
    const diagnosis = diagnose(forA, {
      tenantId,
      deviceId: deviceIdA,
      at: AS_OF,
      correlationId,
      auditSink: sink,
    });
    if (!diagnosis.ok) throw new Error("diagnose failed");
    expect(diagnosis.hypotheses.map((h) => h.causeId)).toEqual(["health.battery_aging"]);
    expect(diagnosis.recommendations[0].proposedIntent.intentKind).toBe(MAINTAIN_DEVICE_INTENT_KIND);
    expect(sink.records).toHaveLength(2);
    expect(sink.records.every((r) => r.tenantId === tenantId)).toBe(true);
  });
});
