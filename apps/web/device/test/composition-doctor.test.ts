/**
 * W141 web-device — the Device Doctor RUNTIME FEED composition tests,
 * over the REAL `@fleetos/device-model` twin store + the REAL
 * `@fleetos/health` pipeline + REAL remediation records (projected
 * from the REAL `@fleetos/recovery` destructive-request boundary —
 * the same structural projection the console's binding site performs).
 *
 * These tests are the machine proof that EVERY lane-phase transition
 * of the Device Doctor feed is honest:
 *
 *   loading -> ready            (the composition over real state)
 *   loading -> blocked          (device not in the acting partition)
 *   loading -> error            (a source that refuses)
 *   ready -> approval_required  (a PARKED remediation request)
 *   fresh tenant -> empty       (the roster's honest empty)
 *   scope refused -> blocked    (fail-closed, no data)
 *
 * And that the nine-stage JOURNEY (device -> observations -> symptoms
 * -> diagnosis -> remediation -> authorization -> action -> result ->
 * evidence) renders from REAL runtime state with honest
 * not-yet-observed states — never fabricated observations (the
 * real-observations-only doctrine).
 */

import { test, expect } from "bun:test";
import { makeGuardianDecision } from "@fleetos/contracts";
import type { EvidenceRef, GuardianDecision } from "@fleetos/contracts";
import {
  composeDeviceDoctorFeed,
  deviceRosterLanePhase,
  errorDeviceDoctorFeed,
  loadingDeviceDoctorFeed,
} from "../src/index";
import type { DeviceDoctorRuntimeState } from "../src/index";
import { DOCTOR_JOURNEY_STAGES } from "../src/index";
import {
  ANOMALY_SEVERITY_ORDER,
} from "../src/index";
import {
  BANDS,
  DEV_A1,
  DEV_B1,
  SCOPE_A,
  SCOPE_B,
  TENANT_A,
  atHour,
  diagnosisFixture,
  healthFixture,
  obs,
  realDoctorSources,
  seededTwinSource,
  twinFixture,
} from "./helpers";
import type { RemediationRequestLike } from "../src/index";

const NOW = atHour(52);

/** A REAL Guardian decision fixture (the frozen contracts shape). */
function guardianDecision(
  decision: GuardianDecision["decision"],
  at: string,
): GuardianDecision {
  return makeGuardianDecision({
    tenantId: TENANT_A,
    decision,
    rules: decision === "ALLOW" ? [] : [{ ruleId: "pol_wdevtest0001" as never, ruleVersion: 1 }],
    evidence: [],
    decidedAt: at,
    schemaVersion: 1,
  });
}

/** A REAL-shaped remediation request record (the binding-site projection). */
function remediationRecord(input: {
  readonly treatmentId: string;
  readonly status: string;
  readonly disposition?: "accepted" | "dismissed";
  readonly decision?: GuardianDecision;
  readonly outcome?: "executed" | "failed";
  readonly evidence?: readonly EvidenceRef[];
}): RemediationRequestLike {
  const evidence: readonly EvidenceRef[] = input.evidence ?? [
    { key: `evidence/${input.treatmentId}`, sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
  ];
  return {
    treatmentId: input.treatmentId,
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    intentKind: "RecoveryIntent",
    disposition: input.disposition ?? "accepted",
    status: input.status,
    requestedAt: atHour(50),
    requestedBy: "usr_testuser00001",
    ...(input.decision !== undefined ? { decision: input.decision } : {}),
    decidedAt: input.decision !== undefined ? atHour(51) : undefined,
    outcome: input.outcome,
    executedAt: input.outcome !== undefined ? atHour(52) : undefined,
    evidence,
    contentDigest: `digest-${input.treatmentId}-${input.status}`,
  };
}

/**
 * The full doctor fixture: one REAL twin (with observations), the REAL
 * health pipeline (signals -> anomalies -> diagnosis ledger), and the
 * REAL-shaped remediation records the walk displays.
 */
function doctorFixture(remediation: readonly RemediationRequestLike[]): {
  readonly state: DeviceDoctorRuntimeState;
  readonly treatmentIds: readonly string[];
} {
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
    lifecycleHops: 3, // DIAGNOSE
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
    observations: {
      observations: (actingTenant, device) =>
        actingTenant === TENANT_A && device === DEV_A1 ? observations : [],
    },
    remediation: {
      requests: (actingTenant, device) =>
        actingTenant === TENANT_A && device === DEV_A1 ? remediation : [],
    },
  };

  const hypotheses = diagnosis.entries.filter((entry) => entry.kind === "hypothesis");
  const recommendations = diagnosis.entries.filter((entry) => entry.kind === "recommendation");
  const treatmentIds = recommendations.map((entry) =>
    entry.kind === "recommendation" ? entry.recommendation.id : "",
  );
  void hypotheses;
  return { state, treatmentIds };
}

test("the loading feed is the pre-resolution state; the error feed is machine-stable", () => {
  const loading = loadingDeviceDoctorFeed();
  expect(loading.phase.kind).toBe("loading");
  expect(loading.lanePhase.kind).toBe("loading");
  expect(loading.journey).toBeUndefined();

  const error = errorDeviceDoctorFeed("The doctor feed's runtime state refused to resolve.");
  expect(error.phase.kind).toBe("error");
  expect(error.lanePhase.kind).toBe("error");
  expect(error.journey).toBeUndefined();
});

test("LOADING -> READY: the feed composes the real doctor view + the nine-stage journey", () => {
  const { state } = doctorFixture([]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  expect(feed.lanePhase.kind).toBe("ready");
  if (feed.lanePhase.kind !== "ready") throw new Error("unreachable");
  expect(feed.lanePhase.view).toBeDefined();
  expect(feed.phase.kind).toBe("ready");

  // The journey: all nine stages, canonical order, from real state.
  const journey = feed.journey;
  expect(journey).toBeDefined();
  if (journey === undefined) throw new Error("unreachable");
  expect(journey.stages.map((stage) => stage.id)).toEqual([...DOCTOR_JOURNEY_STAGES]);

  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  // The DEVICE stage carries the REAL twin's identity.
  const deviceStage = byId.get("device");
  expect(deviceStage?.state).toBe("ready");
  expect(deviceStage?.rows.some((row) => row.value === "DIAGNOSE")).toBe(true);
  expect(deviceStage?.rows.some((row) => row.value === "windows")).toBe(true);

  // The OBSERVATIONS stage carries the REAL observation records.
  const observationsStage = byId.get("observations");
  expect(observationsStage?.state).toBe("ready");
  expect(observationsStage?.rows.some((row) => row.value === "5")).toBe(true);
  expect(
    observationsStage?.rows.some((row) =>
      row.value.includes("device.power") && row.value.includes("device.storage"),
    ),
  ).toBe(true);

  // The SYMPTOMS stage + the symptom walk derive from REAL anomalies.
  const symptomsStage = byId.get("symptoms");
  expect(symptomsStage?.state).toBe("ready");
  expect(journey.symptoms.state).toBe("anomalies_detected");
  expect(journey.symptoms.steps.length).toBeGreaterThan(0);
  // Severity-first ordering (the frozen order).
  const severities = journey.symptoms.steps.map((step) => step.severity);
  const ranked = [...severities].sort(
    (a, b) => ANOMALY_SEVERITY_ORDER.indexOf(a) - ANOMALY_SEVERITY_ORDER.indexOf(b),
  );
  expect(severities).toEqual(ranked);
  // Every symptom step anchors to real evidence observation ids.
  for (const step of journey.symptoms.steps) {
    expect(step.evidenceObservationIds.length).toBeGreaterThan(0);
  }

  // The DIAGNOSIS stage records the versioned interpretations (the
  // fixture's three anomalies each yield a hypothesis).
  const diagnosisStage = byId.get("diagnosis");
  expect(diagnosisStage?.state).toBe("ready");
  const view = feed.lanePhase.view;
  expect(diagnosisStage?.rows.some((row) => row.value === String(view?.diagnoses.length ?? 0))).toBe(true);
  expect(view?.diagnoses.length).toBe(3);

  // The REMEDIATION stage carries the versioned proposals.
  const remediationStage = byId.get("remediation");
  expect(remediationStage?.state).toBe("ready");
  expect(journey.remediation.state).toBe("recommendations_proposed");
  expect(journey.remediation.steps.length).toBeGreaterThan(0);

  // EVIDENCE: the opaque refs from the real doctor sources.
  const evidenceStage = byId.get("evidence");
  expect(evidenceStage?.state).toBe("ready");
  expect(feed.lanePhase.view?.evidence.length).toBeGreaterThan(0);
});

test("the honest not-yet-observed states: no remediation records -> not_decided / not_evaluated / not_requested / not executed", () => {
  const { state, treatmentIds } = doctorFixture([]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  expect(treatmentIds.length).toBeGreaterThan(0);

  for (const step of journey.remediation.steps) {
    expect(step.disposition).toBe("not_decided");
    expect(step.gating).toBe("not_evaluated");
    expect(step.request).toBe("not_requested");
  }
  // The honest stage states.
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  expect(byId.get("authorization")?.state).toBe("not_yet_observed");
  expect(byId.get("action")?.state).toBe("not_yet_observed");
  expect(byId.get("result")?.state).toBe("not_yet_observed");
  expect(journey.approvalPending).toBe(false);
  // A recommendation is never an executed action: no outcome exists.
  expect(feed.treatmentGating).toEqual({});
  expect(feed.treatmentDisposition).toEqual({});
});

test("READY -> APPROVAL_REQUIRED: a PARKED remediation request holds a human decision", () => {
  const treatmentIds = doctorFixture([]).treatmentIds;
  const { state } = doctorFixture([
    remediationRecord({
      treatmentId: treatmentIds[0] ?? "trt_missing",
      status: "PARKED",
      decision: guardianDecision("REQUIRE_APPROVAL", atHour(51)),
    }),
  ]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  expect(feed.lanePhase.kind).toBe("approval_required");
  if (feed.lanePhase.kind !== "approval_required") throw new Error("unreachable");

  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  expect(journey.approvalPending).toBe(true);
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  expect(byId.get("authorization")?.state).toBe("approval_required");

  // The walk's step carries the real gating + the parked request.
  const step = journey.remediation.steps.find(
    (candidate) => candidate.treatmentId === (treatmentIds[0] ?? ""),
  );
  expect(step).toBeDefined();
  if (step === undefined) throw new Error("unreachable");
  expect(step.disposition).toBe("accepted");
  expect(step.gating).toBe("REQUIRE_APPROVAL");
  expect(step.request).not.toBe("not_requested");
  if (step.request === "not_requested") throw new Error("unreachable");
  expect(step.request.status).toBe("PARKED");
  expect(step.request.decision).toBe("REQUIRE_APPROVAL");
  expect(step.request.outcome).toBeUndefined();

  // The feed's gating context carries the real decision for the screen.
  expect(feed.treatmentGating[step.treatmentId]?.decision).toBe("REQUIRE_APPROVAL");
  expect(feed.treatmentDisposition[step.treatmentId]).toBe("accepted");

  // The screen phase still composes the view (the state is semantic).
  expect(feed.phase.kind).toBe("ready");
});

test("the remediation walk reaches the executed result with evidence (never presenting a proposal as executed)", () => {
  const treatmentIds = doctorFixture([]).treatmentIds;
  const { state } = doctorFixture([
    remediationRecord({
      treatmentId: treatmentIds[0] ?? "trt_missing",
      status: "EXECUTED",
      decision: guardianDecision("ALLOW", atHour(51)),
      outcome: "executed",
      evidence: [
        { key: "evidence/exec-1", sizeBytes: 256, hash: "abcdef0123456789", hashAlgorithm: "sha256" },
      ],
    }),
  ]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  expect(feed.lanePhase.kind).toBe("ready");

  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const step = journey.remediation.steps.find(
    (candidate) => candidate.treatmentId === (treatmentIds[0] ?? ""),
  );
  if (step === undefined) throw new Error("unreachable");
  expect(step.request).not.toBe("not_requested");
  if (step.request === "not_requested") throw new Error("unreachable");
  expect(step.request.status).toBe("EXECUTED");
  expect(step.request.outcome).toBe("executed");
  expect(step.request.evidenceCount).toBe(1);

  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  expect(byId.get("result")?.state).toBe("ready");
  expect(byId.get("result")?.rows.some((row) => row.value === "1")).toBe(true); // executed: 1
  expect(byId.get("action")?.state).toBe("ready");
});

test("LOADING -> BLOCKED: a device outside the acting partition is honest and indistinguishable", () => {
  const { state } = doctorFixture([]);
  // A foreign device id (never seeded) and a foreign scope both block.
  const foreignDevice = composeDeviceDoctorFeed(SCOPE_A, state, DEV_B1, { now: NOW });
  expect(foreignDevice.lanePhase.kind).toBe("blocked");
  if (foreignDevice.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(foreignDevice.lanePhase.reason).toBe("device_not_in_fleet");
  expect(foreignDevice.lanePhase.view).toBeUndefined();
  // The screen renders its honest not-found state (undefined view).
  expect(foreignDevice.phase.kind).toBe("ready");

  const foreignScope = composeDeviceDoctorFeed(SCOPE_B, state, DEV_A1, { now: NOW });
  expect(foreignScope.lanePhase.kind).toBe("blocked");
  if (foreignScope.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(foreignScope.lanePhase.reason).toBe("device_not_in_fleet");
});

test("a refused scope grammar fails closed: blocked, no data, no leak", () => {
  const { state } = doctorFixture([]);
  const refused = composeDeviceDoctorFeed({ tenantId: "" as never }, state, DEV_A1, { now: NOW });
  expect(refused.lanePhase.kind).toBe("blocked");
  if (refused.lanePhase.kind !== "blocked") throw new Error("unreachable");
  expect(refused.lanePhase.reason).toBe("scope_refused");
  void refused;
  expect(refused.lanePhase.view).toBeUndefined();
  expect(refused.journey).toBeUndefined();
});

test("a source that throws composes the machine-stable error feed (never data)", () => {
  const { state } = doctorFixture([]);
  const throwing: DeviceDoctorRuntimeState = {
    ...state,
    twins: {
      list: state.twins.list,
      get: (): never => {
        throw new Error("source refused");
      },
    },
  };
  const feed = composeDeviceDoctorFeed(SCOPE_A, throwing, DEV_A1, { now: NOW });
  expect(feed.lanePhase.kind).toBe("error");
  expect(feed.phase.kind).toBe("error");
  expect(feed.journey).toBeUndefined();
});

test("the honest not-yet-observed observations state: a twin with no observations yet", () => {
  const twin = twinFixture({ tenantId: TENANT_A, deviceId: DEV_A1 });
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
  expect(feed.lanePhase.kind).toBe("ready");
  const journey = feed.journey;
  if (journey === undefined) throw new Error("unreachable");
  const byId = new Map(journey.stages.map((stage) => [stage.id, stage]));
  expect(byId.get("observations")?.state).toBe("not_yet_observed");
  expect(byId.get("observations")?.rows.some((row) => row.value === "None recorded yet")).toBe(true);
  expect(byId.get("symptoms")?.state).toBe("empty");
  expect(journey.symptoms.state).toBe("no_anomalies_detected");
  expect(journey.symptoms.steps).toHaveLength(0);
  expect(byId.get("diagnosis")?.state).toBe("not_yet_observed");
  expect(byId.get("remediation")?.state).toBe("empty");
  expect(journey.remediation.state).toBe("no_recommendations_yet");
});

test("the fresh tenant's roster is the honest EMPTY lane phase (never demo data)", () => {
  const store = seededTwinSource([]);
  const phase = deviceRosterLanePhase(SCOPE_A, store);
  expect(phase.kind).toBe("empty");
  if (phase.kind !== "empty") throw new Error("unreachable");
  expect(phase.reason).toBe("no_devices_enrolled");
  expect(phase.view).toHaveLength(0);

  const populated = deviceRosterLanePhase(SCOPE_A, doctorFixture([]).state.twins);
  expect(populated.kind).toBe("ready");

  const refused = deviceRosterLanePhase({ tenantId: "" as never }, store);
  expect(refused.kind).toBe("blocked");
});

test("determinism: the same runtime state composes byte-identical feeds", () => {
  const { state } = doctorFixture([]);
  const first = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const second = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(JSON.stringify(first.journey)).toBe(JSON.stringify(second.journey));
});
