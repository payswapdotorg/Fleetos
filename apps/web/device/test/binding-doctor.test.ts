/**
 * W060A web-device — D3 binding tests: the Device Doctor detail
 * view-model over the REAL `@fleetos/health` pipeline.
 *
 * The REAL W021 derivation chain runs end-to-end here:
 *
 *   REAL observations -> deriveSignals -> buildDeviceBaseline ->
 *   detectAnomalies -> diagnose -> the append-only interpretation
 *   ledger (append/dismiss/re-diagnose) -> ledger-derived statuses
 *   (REAL hypothesisStatus) -> the doctor view-model.
 *
 * These tests are the runtime proof that:
 *
 *   - the signals/baselines/anomalies panels project the REAL records;
 *   - diagnoses + treatments are surfaced VERSIONED and READ-ONLY
 *     (lineage versions, supersedes links, ACTIVE/SUPERSEDED/DISMISSED
 *     statuses — displayed, never rewritten);
 *   - treatment rows are PROPOSALS (the proposed intent kind + the
 *     rationale; nothing executes);
 *   - the evidence panel carries OPAQUE content-addressable refs
 *     verbatim (never interpreted);
 *   - the panel navigation state machine is pure;
 *   - the whole view-model replays byte-identically (determinism).
 */

import { test, expect } from "bun:test";
import {
  DOCTOR_PANELS,
  buildDeviceDoctorViewModel,
  doctorPanelBack,
  initialDoctorPanelState,
  openDoctorPanel,
} from "../src/index";
import {
  DEV_A1,
  SCOPE_A,
  SCOPE_B,
  TENANT_A,
  atHour,
  diagnosisFixture,
  healthFixture,
  obs,
  realDoctorSources,
} from "./helpers";

/**
 * A deterministic observation stream that drives the REAL pipeline into
 * anomalies: a critically-low battery + a critically-hot core + a full
 * disk (threshold rules), plus a healthy cpu series for the baseline.
 */
function doctorObservations() {
  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)), // battery CRITICAL (<= 10)
    obs("device.storage", { usedBytes: 190, totalBytes: 200 }, atHour(1)), // storage CRITICAL (>= 0.95)
    obs("device.health", { temperatureC: 91 }, atHour(1)), // temperature CRITICAL (>= 85)
    obs("device.health", { cpuUtilization: 30 }, atHour(2)),
    obs("device.health", { cpuUtilization: 32 }, atHour(3)),
    obs("device.health", { cpuUtilization: 31 }, atHour(4)),
    obs("device.health", { cpuUtilization: 29 }, atHour(5)),
    obs("device.health", { cpuUtilization: 33 }, atHour(6)),
    obs("device.health", { cpuUtilization: 30 }, atHour(7)),
    obs("device.health", { cpuUtilization: 28 }, atHour(8)),
    obs("device.health", { cpuUtilization: 31 }, atHour(9)),
    obs("device.health", { cpuUtilization: 30 }, atHour(10)),
    obs("device.health", { memoryUtilization: 55 }, atHour(10)),
    obs("device.health", { type: "kernel_panic" }, atHour(11)),
    obs("device.health", { bootDurationMs: 9000 }, atHour(11)),
  ];
  return observations;
}

test("the doctor view-model projects the REAL health pipeline (signals, baselines, anomalies)", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect((view.deviceId as string)).toBe("dev_testdevice00a1");

  // Signals panel: one row per REAL derived kind, deterministic order
  const kinds = view.signals.map((s) => s.kind);
  expect(kinds).toEqual([...kinds].sort((a, b) => (a < b ? -1 : 1)));
  expect(kinds).toContain("battery.capacity");
  expect(kinds).toContain("storage.usage");
  expect(kinds).toContain("temperature.core");
  expect(kinds).toContain("cpu.usage");
  expect(kinds).toContain("memory.usage");
  expect(kinds).toContain("crash.event");
  expect(kinds).toContain("boot.time");

  const battery = view.signals.find((s) => s.kind === "battery.capacity");
  expect(battery?.latest?.value).toBe(7);
  expect(battery?.unit).toBe("percent");
  expect(battery?.sampleCount).toBe(1);

  const cpu = view.signals.find((s) => s.kind === "cpu.usage");
  expect(cpu?.sampleCount).toBe(9);
  expect(cpu?.min).toBe(28);
  expect(cpu?.max).toBe(33);

  // Baselines panel: the REAL cpu.usage device baseline
  expect(view.baselines).toHaveLength(1);
  expect(view.baselines[0]?.signalKind).toBe("cpu.usage");
  expect(view.baselines[0]?.scopeKind).toBe("device");
  expect(view.baselines[0]?.summary.count).toBe(9);

  // Anomalies panel: CRITICAL severity first, deterministic order
  expect(view.anomalies.length).toBeGreaterThanOrEqual(3);
  const severities = view.anomalies.map((a) => a.severity);
  const criticalIndex = severities.lastIndexOf("CRITICAL");
  const warningIndex = severities.indexOf("WARNING");
  expect(warningIndex === -1 || criticalIndex < warningIndex).toBe(true);
  const critical = view.anomalies.filter((a) => a.severity === "CRITICAL");
  expect(critical.map((a) => a.ruleId)).toEqual([...critical.map((a) => a.ruleId)].sort());
  expect(view.summary.anomalyCounts.critical).toBe(critical.length);
});

test("diagnoses + treatments are surfaced VERSIONED and READ-ONLY (a proposal, never an action)", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");

  expect(view.diagnoses.length).toBeGreaterThanOrEqual(1);
  for (const row of view.diagnoses) {
    expect(row.interpretationVersion).toBeGreaterThanOrEqual(1);
    expect(["ACTIVE", "SUPERSEDED", "DISMISSED"]).toContain(row.status);
    expect(row.confidence).toBeGreaterThanOrEqual(0);
    expect(row.confidence).toBeLessThanOrEqual(0.99);
    // evidence links cite REAL anomaly ids + observation ids (typed refs)
    for (const link of row.evidenceLinks) {
      expect(link.anomalyId.startsWith("anom_")).toBe(true);
      expect(link.ruleId.length).toBeGreaterThan(0);
    }
  }
  const activeFirst = view.diagnoses.map((d) => d.status);
  const firstNonActive = activeFirst.findIndex((s) => s !== "ACTIVE");
  if (firstNonActive !== -1) {
    expect(activeFirst.slice(firstNonActive).every((s) => s !== "ACTIVE")).toBe(true);
  }

  expect(view.treatments.length).toBeGreaterThanOrEqual(1);
  for (const row of view.treatments) {
    // A PROPOSAL: the proposed intent KIND is surfaced, never an intent id
    expect(row.proposedIntentKind.length).toBeGreaterThan(0);
    expect(row.rationale.length).toBeGreaterThan(0);
    expect(row.recommendationVersion).toBeGreaterThanOrEqual(1);
    expect(["ACTIVE", "SUPERSEDED", "DISMISSED"]).toContain(row.status);
  }
  expect(view.summary.activeDiagnoses).toBe(
    view.diagnoses.filter((d) => d.status === "ACTIVE").length,
  );
  expect(view.summary.activeTreatments).toBe(
    view.treatments.filter((t) => t.status === "ACTIVE").length,
  );
});

test("supersession is displayed: a re-diagnosis surfaces SUPERSEDED lineage, never rewrites it", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline, {
    reDiagnose: true,
  });
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");

  // The re-diagnosis appended version-2 lineages that supersede version-1
  const superseded = view.diagnoses.filter((d) => d.status === "SUPERSEDED");
  expect(superseded.length).toBeGreaterThanOrEqual(1);
  const active = view.diagnoses.filter((d) => d.status === "ACTIVE");
  expect(active.length).toBeGreaterThanOrEqual(1);
  for (const row of superseded) {
    // a superseded row cites what it supersedes OR is superseded by a newer row
    const cited = row.supersedes !== undefined || active.some((a) => a.supersedes === row.id);
    expect(cited).toBe(true);
  }
});

test("dismissal is displayed: a dismissed hypothesis surfaces status DISMISSED, read-only", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline, {
    dismissFirst: true,
  });
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.diagnoses.some((d) => d.status === "DISMISSED")).toBe(true);
});

test("evidence refs are surfaced OPAQUE (verbatim content-addressable refs, never interpreted)", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const view = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, { now: atHour(48) });
  expect(view).toBeDefined();
  if (view === undefined) throw new Error("unreachable");
  expect(view.evidence.length).toBeGreaterThanOrEqual(1);
  for (const ref of view.evidence) {
    // opaque: the surface carries the ref verbatim — key structure,
    // hash algorithm and size pass through untouched
    expect(ref.key.startsWith("observations://")).toBe(true);
    expect(ref.hashAlgorithm).toBe("fnv1a32");
    expect(ref.sizeBytes).toBe(128);
    expect(typeof ref.hash).toBe("string");
  }
  // the refs are frozen (the view-model never mutates evidence)
  expect(Object.isFrozen(view.evidence[0])).toBe(true);
});

test("tenant scoping: a foreign scope gets the empty doctor view; a refused scope gets undefined", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);

  const foreign = buildDeviceDoctorViewModel(SCOPE_B, sources, DEV_A1, { now: atHour(48) });
  expect(foreign).toBeDefined();
  if (foreign === undefined) throw new Error("unreachable");
  expect(foreign.signals).toHaveLength(0);
  expect(foreign.anomalies).toHaveLength(0);
  expect(foreign.diagnoses).toHaveLength(0);
  expect(foreign.treatments).toHaveLength(0);
  expect(foreign.evidence).toHaveLength(0);

  const refused = buildDeviceDoctorViewModel({ tenantId: "" as never }, sources, DEV_A1, {
    now: atHour(48),
  });
  expect(refused).toBeUndefined();
});

test("the doctor panel state machine is pure navigation with history", () => {
  expect(DOCTOR_PANELS).toEqual(["signals", "baselines", "anomalies", "diagnoses", "treatments"]);

  let state = initialDoctorPanelState();
  expect(state.current).toBe("signals");
  expect(state.history).toHaveLength(0);

  state = openDoctorPanel(state, "anomalies");
  expect(state.current).toBe("anomalies");
  expect([...state.history]).toEqual(["signals"]);

  state = openDoctorPanel(state, "diagnoses");
  expect(state.current).toBe("diagnoses");
  expect([...state.history]).toEqual(["signals", "anomalies"]);

  // re-opening the current panel is a no-op (pure)
  const reopened = openDoctorPanel(state, "diagnoses");
  expect(reopened).toBe(state);

  state = doctorPanelBack(state);
  expect(state.current).toBe("anomalies");
  expect([...state.history]).toEqual(["signals"]);

  state = doctorPanelBack(state);
  expect(state.current).toBe("signals");
  expect(state.history).toHaveLength(0);

  // back on an empty history is a no-op
  const noop = doctorPanelBack(state);
  expect(noop).toBe(state);
});

test("determinism: the same (sources, device, options) replay byte-identically", () => {
  const observations = doctorObservations();
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline, {
    reDiagnose: true,
  });
  const sources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const options = { now: atHour(48) };
  const first = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, options);
  const second = buildDeviceDoctorViewModel(SCOPE_A, sources, DEV_A1, options);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
