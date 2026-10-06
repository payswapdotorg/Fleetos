/**
 * @fleetos/web-device — W152 Fix 3 (R5b residual): the Device Doctor's
 * two-stores labeling regression tests.
 *
 * These tests pin the R5b residual's closure: the Device Doctor's
 * screen USED to show TWO observation counts on one screen with
 * ambiguous labels — stage 1 ("device") reported `Observation count: 1`
 * (the TWIN's telemetry count from the TwinStore) while stage 2
 * ("observations") reported `Observations: None recorded yet` (the
 * diagnosis store's records). Two stores, two truths, ambiguous labels
 * (sim-c-report.md §4.9.3 R5b).
 *
 * The fix (the report's sanctioned option — "label them as distinct
 * counts on the surface"):
 *   - stage 1's row label becomes `Telemetry observations (twin record)`;
 *   - stage 2's empty-state row becomes label `Diagnosis observations`
 *     with value `None recorded yet — twin telemetry observations are
 *     ingested into diagnosis separately`;
 *   - stage 2's non-empty branch's `Count` label becomes `Diagnosis
 *     observations`.
 *
 * NO data fabrication, NO store merging — the two counts stay two
 * counts, honestly named. These tests pin the two DISTINCTLY-LABELED
 * rows so the ambiguity cannot silently return.
 *
 * The tests follow the composition-doctor.test.ts pattern (the same
 * `doctorFixture` + `twinFixture` + `composeDeviceDoctorFeed` shape).
 */

import { test, expect } from "bun:test";
import {
  composeDeviceDoctorFeed,
} from "../src/index";
import {
  DEV_A1,
  SCOPE_A,
  TENANT_A,
  atHour,
  diagnosisFixture,
  healthFixture,
  obs,
  realDoctorSources,
  seededTwinSource,
  twinFixture,
} from "./helpers";
import type { DeviceDoctorRuntimeState } from "../src/index";

const NOW = atHour(52);

// ---------------------------------------------------------------------------
// P1 — the two DISTINCTLY-LABELED rows (the stage-1 twin count + the
// stage-2 diagnosis observations)
// ---------------------------------------------------------------------------

test("W152 Fix 3 P1 — stage 1's row is labeled 'Telemetry observations (twin record)' (the TwinStore's count, distinctly named)", () => {
  // The R5b residual's verbatim report: stage 1 reported
  // `Observation count: 1` — the TWIN's telemetry count from the
  // TwinStore. The fix relabels the row as `Telemetry observations
  // (twin record)` so the user can tell WHICH store the count comes
  // from (the TwinStore's `observationCount`, NOT the diagnosis
  // store's records).
  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)),
  ];
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3,
    observations,
    postureSummary: "AT_RISK",
    findingCount: 1,
  });
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const doctorSources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const state: DeviceDoctorRuntimeState = {
    twins: seededTwinSource([twin]),
    doctor: doctorSources,
    observations: { observations: () => observations },
    remediation: { requests: () => [] },
  };
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  const deviceStage = byId.get("device");
  if (deviceStage === undefined) throw new Error("unreachable");
  // The stage-1 row is labeled `Telemetry observations (twin record)`.
  const twinCountRow = deviceStage.rows.find((row) => row.label === "Telemetry observations (twin record)");
  expect(twinCountRow).toBeDefined();
  if (twinCountRow === undefined) throw new Error("unreachable");
  // The value is the twin's telemetry count (the TwinStore's
  // `observationCount` — the same value the row carried before the
  // relabel; only the LABEL changed).
  expect(twinCountRow.value).toBe(String(twin.telemetry.observationCount));
  // The OLD ambiguous label `Observation count` is GONE (the
  // ambiguity cannot silently return).
  expect(deviceStage.rows.some((row) => row.label === "Observation count")).toBe(false);
});

test("W152 Fix 3 P1 — stage 2's empty-state row is labeled 'Diagnosis observations' with the honest explanation", () => {
  // The R5b residual's verbatim report: stage 2 reported
  // `Observations: None recorded yet` — the diagnosis store's empty
  // state, ambiguous with stage 1's count. The fix relabels the row
  // as `Diagnosis observations` with the value carrying the honest
  // explanation that twin telemetry observations are ingested into
  // diagnosis separately.
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3,
    observations: [],
    postureSummary: "AT_RISK",
    findingCount: 0,
  });
  const health = healthFixture(TENANT_A, DEV_A1, []);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, [], undefined);
  const doctorSources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const state: DeviceDoctorRuntimeState = {
    twins: seededTwinSource([twin]),
    doctor: doctorSources,
    observations: { observations: () => [] },
    remediation: { requests: () => [] },
  };
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  const observationsStage = byId.get("observations");
  if (observationsStage === undefined) throw new Error("unreachable");
  // The stage-2 empty-state row is labeled `Diagnosis observations`.
  const diagnosisRow = observationsStage.rows.find((row) => row.label === "Diagnosis observations");
  expect(diagnosisRow).toBeDefined();
  if (diagnosisRow === undefined) throw new Error("unreachable");
  // The value carries the honest explanation (the `None recorded
  // yet` prefix + the explanation that twin telemetry observations
  // are ingested into diagnosis separately).
  expect(diagnosisRow.value.includes("None recorded yet")).toBe(true);
  expect(diagnosisRow.value.includes("twin telemetry observations are ingested into diagnosis separately")).toBe(true);
  // The OLD ambiguous label `Observations` is GONE (the ambiguity
  // cannot silently return).
  expect(observationsStage.rows.some((row) => row.label === "Observations")).toBe(false);
});

test("W152 Fix 3 P1 — stage 2's non-empty branch's 'Count' label becomes 'Diagnosis observations' (the distinct-name fix)", () => {
  // The non-empty branch's `Count` label becomes `Diagnosis
  // observations` (the same distinct-name fix — the count is the
  // diagnosis store's record count, NOT the twin's telemetry count).
  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)),
    obs("device.storage", { usedBytes: 190, totalBytes: 200 }, atHour(1)),
    obs("device.health", { temperatureC: 91 }, atHour(1)),
    obs("device.health", { cpuUtilization: 30 }, atHour(2)),
    obs("device.health", { cpuUtilization: 32 }, atHour(3)),
  ];
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3,
    observations,
    postureSummary: "AT_RISK",
    findingCount: 2,
  });
  const health = healthFixture(TENANT_A, DEV_A1, observations);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, health.signals, health.baseline);
  const doctorSources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const state: DeviceDoctorRuntimeState = {
    twins: seededTwinSource([twin]),
    doctor: doctorSources,
    observations: { observations: () => observations },
    remediation: { requests: () => [] },
  };
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  const observationsStage = byId.get("observations");
  if (observationsStage === undefined) throw new Error("unreachable");
  // The stage-2 non-empty branch's count row is labeled `Diagnosis
  // observations` (the relabel from `Count`).
  const countRow = observationsStage.rows.find((row) => row.label === "Diagnosis observations");
  expect(countRow).toBeDefined();
  if (countRow === undefined) throw new Error("unreachable");
  // The value is the diagnosis store's record count (5 observations).
  expect(countRow.value).toBe("5");
  // The OLD ambiguous label `Count` is GONE.
  expect(observationsStage.rows.some((row) => row.label === "Count")).toBe(false);
});

// ---------------------------------------------------------------------------
// P2 — the two DISTINCTLY-LABELED rows appear together on the screen
// (the ambiguity cannot silently return)
// ---------------------------------------------------------------------------

test("W152 Fix 3 P2 — the two distinctly-labeled rows appear together on the screen (the twin count + the diagnosis observations)", () => {
  // The R5b residual's verbatim report: stage 1 reported
  // `Observation count: 1` (the TWIN's telemetry count) while stage 2
  // reported `Observations: None recorded yet` (the diagnosis store's
  // records) — two stores, two truths, ambiguous labels on one
  // screen. The fix labels them as DISTINCT counts: stage 1's row is
  // `Telemetry observations (twin record)` and stage 2's row is
  // `Diagnosis observations`. This test pins the two DISTINCTLY-
  // LABELED rows appearing together (the ambiguity cannot silently
  // return).
  const observations = [
    obs("device.power", { batteryPercent: 7 }, atHour(1)),
  ];
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3,
    observations,
    postureSummary: "AT_RISK",
    findingCount: 1,
  });
  // The diagnosis store has NO observations yet (the honest empty
  // state — the R5b residual's verbatim scenario: stage 1 shows a
  // count while stage 2 shows none).
  const health = healthFixture(TENANT_A, DEV_A1, []);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, [], undefined);
  const doctorSources = realDoctorSources(TENANT_A, DEV_A1, health, diagnosis);
  const state: DeviceDoctorRuntimeState = {
    twins: seededTwinSource([twin]),
    doctor: doctorSources,
    observations: { observations: () => [] },
    remediation: { requests: () => [] },
  };
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));

  // Stage 1 carries the TWIN record's telemetry count (the
  // TwinStore's `observationCount`).
  const deviceStage = byId.get("device");
  if (deviceStage === undefined) throw new Error("unreachable");
  const twinCountRow = deviceStage.rows.find((row) => row.label === "Telemetry observations (twin record)");
  expect(twinCountRow).toBeDefined();
  if (twinCountRow === undefined) throw new Error("unreachable");
  // The twin's telemetry count is 1 (the twin fixture ingested one
  // observation).
  expect(twinCountRow.value).toBe("1");

  // Stage 2 carries the DIAGNOSIS observations store's empty state
  // (the diagnosis store has NO records yet — the honest empty state).
  const observationsStage = byId.get("observations");
  if (observationsStage === undefined) throw new Error("unreachable");
  const diagnosisRow = observationsStage.rows.find((row) => row.label === "Diagnosis observations");
  expect(diagnosisRow).toBeDefined();
  if (diagnosisRow === undefined) throw new Error("unreachable");
  expect(diagnosisRow.value.includes("None recorded yet")).toBe(true);

  // The two rows carry DISTINCT labels — the user can tell WHICH
  // store each count comes from. The ambiguity is GONE.
  expect(twinCountRow.label).not.toBe(diagnosisRow.label);
  // The twin count row's label mentions "twin" (the TwinStore).
  expect(twinCountRow.label.toLowerCase()).toContain("twin");
  // The diagnosis row's label mentions "diagnosis" (the diagnosis
  // store).
  expect(diagnosisRow.label.toLowerCase()).toContain("diagnosis");
});
