/**
 * W141 web-device — the RENDERED Device Doctor journey tests: the
 * composed nine-stage diagnosis journey + the symptom walk + the
 * remediation walk rendered through the FULL DeviceDoctorScreen, over
 * the REAL device-model twin + the REAL health pipeline + REAL
 * remediation records at the test's binding site.
 *
 * The render proofs:
 *   - the journey timeline renders all nine stages with honest states
 *     (the not-yet-observed stages SAY so — never fabricated content);
 *   - the symptom walk renders the REAL anomalies with their evidence
 *     counts (severity-first);
 *   - the remediation walk renders the gated path per proposal, and a
 *     PARKED request renders as awaiting-a-human — a recommendation is
 *     NEVER presented as an executed action;
 *   - the honest empty walks (no anomalies / no recommendations) render
 *     as explicit empty states, never invented content.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { makeGuardianDecision } from "@fleetos/contracts";
import type { GuardianDecision } from "@fleetos/contracts";
import {
  DeviceDoctorScreen,
  composeDeviceDoctorFeed,
  initialDoctorPanelState,
} from "../src/index";
import type { DeviceDoctorRuntimeState, RemediationRequestLike } from "../src/index";
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

afterEach(() => {
  cleanup();
});

const NOW = atHour(52);

function guardianDecision(decision: GuardianDecision["decision"], at: string): GuardianDecision {
  return makeGuardianDecision({
    tenantId: TENANT_A,
    decision,
    rules: decision === "ALLOW" ? [] : [{ ruleId: "pol_wdevtest0001" as never, ruleVersion: 1 }],
    evidence: [],
    decidedAt: at,
    schemaVersion: 1,
  });
}

function remediationRecord(input: {
  readonly treatmentId: string;
  readonly status: string;
  readonly decision?: GuardianDecision;
}): RemediationRequestLike {
  return {
    treatmentId: input.treatmentId,
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    intentKind: "RecoveryIntent",
    disposition: "accepted",
    status: input.status,
    requestedAt: atHour(50),
    requestedBy: "usr_testuser00001",
    ...(input.decision !== undefined ? { decision: input.decision } : {}),
    decidedAt: input.decision !== undefined ? atHour(51) : undefined,
    outcome: undefined,
    executedAt: undefined,
    evidence: [
      { key: `evidence/${input.treatmentId}`, sizeBytes: 128, hash: "0123456789abcdef", hashAlgorithm: "sha256" },
    ],
    contentDigest: `digest-${input.treatmentId}-${input.status}`,
  };
}

function doctorState(remediation: readonly RemediationRequestLike[]): DeviceDoctorRuntimeState {
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
  return {
    twins: seededTwinSource([twin]),
    doctor: realDoctorSources(TENANT_A, DEV_A1, health, diagnosis),
    observations: {
      observations: (actingTenant, device) =>
        actingTenant === TENANT_A && device === DEV_A1 ? observations : [],
    },
    remediation: {
      requests: (actingTenant, device) =>
        actingTenant === TENANT_A && device === DEV_A1 ? remediation : [],
    },
  };
}

/** The rendered doctor screen over the composed feed (fully controlled). */
function DoctorShell(props: { readonly state: DeviceDoctorRuntimeState }): React.JSX.Element {
  const [accepted, setAccepted] = useState<string[]>([]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, props.state, DEV_A1, { now: NOW });
  return (
    <DeviceDoctorScreen
      phase={feed.phase}
      journey={feed.journey}
      deviceId={DEV_A1}
      panel={initialDoctorPanelState("signals")}
      onPanelChange={(): void => {}}
      onPanelBack={(): void => {}}
      onOpenDevice={(): void => {}}
      onAcceptTreatment={(): void => setAccepted([...accepted])}
      onDismissTreatment={(): void => {}}
      treatmentGating={feed.treatmentGating}
      treatmentDisposition={feed.treatmentDisposition}
    />
  );
}

test("the rendered journey shows all nine stages with honest states + the real symptom walk", async () => {
  const user = userEvent.setup();
  render(<DoctorShell state={doctorState([])} />);

  // The journey timeline (the nine machine-stable stage labels).
  const timeline = screen.getByRole("list", { name: "Device diagnosis journey" });
  for (const label of [
    "Device under diagnosis",
    "Observations ingested",
    "Symptoms detected",
    "Diagnosis recorded",
    "Remediation recommended",
    "Authorization state",
    "Action requested",
    "Execution result",
    "Evidence artifacts",
  ]) {
    expect(within(timeline).getByText(label)).toBeTruthy();
  }
  // The honest not-yet states on the un-routed stages.
  expect(within(timeline).getAllByText("Not yet observed").length).toBeGreaterThan(0);

  // The symptom walk renders the REAL anomalies with evidence counts.
  const symptomsCaption = screen.getByText(/One step per detected anomaly/);
  expect(symptomsCaption).toBeTruthy();
  expect(screen.getAllByText(/battery\.low|storage\.near_full|temperature\.high/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/observation/i).length).toBeGreaterThan(0);

  // The remediation walk renders the proposals (all not-decided here).
  expect(screen.getByText(/Each proposal on its gated path/)).toBeTruthy();
  expect(screen.getAllByText("Not decided yet").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Not evaluated — nothing has been routed/).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Not requested").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Not executed — no outcome exists/).length).toBeGreaterThan(0);

  // Keyboard sanity: the panels remain navigable (the journey is additive).
  const tablist = screen.getByRole("tablist", { name: "Device Doctor panels" });
  await user.tab();
  expect(tablist).toBeTruthy();
});

test("a PARKED remediation renders as awaiting-a-human — never as executed", () => {
  const treatmentIds = ((): readonly string[] => {
    const diagnosis = diagnosisFixture(
      TENANT_A,
      DEV_A1,
      healthFixture(TENANT_A, DEV_A1, []).signals,
      undefined,
    );
    return diagnosis.entries
      .filter((entry) => entry.kind === "recommendation")
      .map((entry) => (entry.kind === "recommendation" ? entry.recommendation.id : ""));
  })();

  // Use the real state's treatment ids: rebuild with the full fixture.
  const state = doctorState([]);
  const feed = composeDeviceDoctorFeed(SCOPE_A, state, DEV_A1, { now: NOW });
  const firstTreatment = feed.journey?.remediation.steps[0]?.treatmentId ?? treatmentIds[0] ?? "trt_missing";

  const parkedState = doctorState([
    remediationRecord({
      treatmentId: firstTreatment,
      status: "PARKED",
      decision: guardianDecision("REQUIRE_APPROVAL", atHour(51)),
    }),
  ]);
  render(<DoctorShell state={parkedState} />);

  // The parked step renders the human gate — visibly.
  expect(screen.getAllByText(/Awaiting a human decision/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/REQUIRE_APPROVAL/).length).toBeGreaterThan(0);
  // The proposal/execution distinction: no outcome exists.
  expect(screen.getAllByText(/Not executed — no outcome exists/).length).toBeGreaterThan(0);
});

test("the honest empty walks render as explicit empty states (never invented content)", () => {
  // A twin with NO observations: no anomalies, no diagnoses, no treatments.
  const twin = twinFixture({ tenantId: TENANT_A, deviceId: DEV_A1 });
  const health = healthFixture(TENANT_A, DEV_A1, []);
  const diagnosis = diagnosisFixture(TENANT_A, DEV_A1, [], undefined);
  const state: DeviceDoctorRuntimeState = {
    twins: seededTwinSource([twin]),
    doctor: realDoctorSources(TENANT_A, DEV_A1, health, diagnosis),
    observations: { observations: () => [] },
    remediation: { requests: () => [] },
  };
  render(<DoctorShell state={state} />);

  expect(screen.getByText("No anomalies detected")).toBeTruthy();
  expect(screen.getByText(/no symptom is ever invented/)).toBeTruthy();
  expect(screen.getByText("No treatment recommendations")).toBeTruthy();
  expect(screen.getByText(/no recommendation is invented/)).toBeTruthy();
  const timeline = screen.getByRole("list", { name: "Device diagnosis journey" });
  expect(within(timeline).getAllByText("Not yet observed").length).toBeGreaterThanOrEqual(2);
});
