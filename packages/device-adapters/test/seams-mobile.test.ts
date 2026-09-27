/**
 * W030 D3 tests — in-memory mobile family seams (iOS / iPadOS /
 * Android): typed routing, payload contract enforcement (fail-closed),
 * scripted outcomes, observation sources, probe, recording,
 * determinism.
 */

import { test, expect } from "bun:test";
import { canonicalJson } from "../src/internal";
import {
  mobileBatteryRecord,
  mobileComplianceRecord,
  mobileLocationEvidenceRecord,
  mobileOsVersionRecord,
} from "../src/mobile-observations";
import {
  createInMemoryAndroidSeam,
  createInMemoryIosSeam,
  createInMemoryIpadOsSeam,
} from "../src/seams-inmemory-mobile";
import { isMobileSeam } from "../src/seams-mobile";

const TS = "2026-01-01T12:00:00Z";

// ---------------------------------------------------------------------------
// Construction + platform discrimination
// ---------------------------------------------------------------------------

test("seams-mobile: the three fakes carry their platform literals", () => {
  expect(createInMemoryIosSeam().platform).toBe("ios");
  expect(createInMemoryIpadOsSeam().platform).toBe("ipados");
  expect(createInMemoryAndroidSeam().platform).toBe("android");
});

test("seams-mobile: isMobileSeam structurally validates", () => {
  expect(isMobileSeam(createInMemoryIosSeam())).toBe(true);
  expect(isMobileSeam(createInMemoryIpadOsSeam())).toBe(true);
  expect(isMobileSeam(createInMemoryAndroidSeam())).toBe(true);
  expect(isMobileSeam({ platform: "ios" })).toBe(false);
  expect(isMobileSeam(null)).toBe(false);
  expect(isMobileSeam({ platform: "windows", commands: {}, observationSources: {}, capabilityProbe: {} })).toBe(false);
});

// ---------------------------------------------------------------------------
// Apple MDM routing (iOS) — payload contract -> typed command
// ---------------------------------------------------------------------------

test("seams-mobile (ios): execute routes a lost-mode payload to EnableLostMode with message+phone", () => {
  const seam = createInMemoryIosSeam();
  const result = seam.commands.execute({
    capability: "lock",
    payload: { action: "enable", message: "Lost — call +1 555 0100", phoneNumber: "+15550100" },
  });
  expect(result.status).toBe("succeeded");
  const calls = seam.calls();
  expect(calls.some((call) => call.method === "runMdmCommand")).toBe(true);
  const mdm = calls.find((call) => call.method === "runMdmCommand");
  expect(mdm?.detail).toEqual({
    capability: "lock",
    mdmCommand: "EnableLostMode",
    message: "Lost — call +1 555 0100",
    phoneNumber: "+15550100",
  });
});

test("seams-mobile (ios): managed app + passcode enforce route to Install/RemoveApplication and InstallProfile", () => {
  const seam = createInMemoryIosSeam();
  seam.commands.execute({ capability: "enforce", payload: { action: "install", appIdentifier: "com.example.sales" } });
  seam.commands.execute({ capability: "enforce", payload: { policyArea: "passcode", policy: { minLength: 8, requireAlphanumeric: true } } });
  const mdmCommands = seam
    .calls()
    .filter((call) => call.method === "runMdmCommand")
    .map((call) => call.detail);
  const install = mdmCommands[0] as { mdmCommand: string; appIdentifier: string };
  expect(install.mdmCommand).toBe("InstallApplication");
  expect(install.appIdentifier).toBe("com.example.sales");
  const profile = mdmCommands[1] as { mdmCommand: string; profileIdentifier: string };
  expect(profile.mdmCommand).toBe("InstallProfile");
  expect(profile.profileIdentifier).toBe("org.fleetos.passcode");
});

test("seams-mobile (ios): wipe routes to EraseDevice; locate to Location; update to ScheduleOSUpdate", () => {
  const seam = createInMemoryIosSeam();
  seam.commands.execute({ capability: "wipe", payload: { scope: "enterprise" } });
  seam.commands.execute({ capability: "locate", payload: { accuracy: "fine" } });
  seam.commands.execute({ capability: "update", payload: { notifyDevice: true } });
  const mdmCommands = seam
    .calls()
    .filter((call) => call.method === "runMdmCommand")
    .map((call) => call.detail);
  expect((mdmCommands[0] as { mdmCommand: string }).mdmCommand).toBe("EraseDevice");
  expect((mdmCommands[0] as { scope: string }).scope).toBe("enterprise");
  expect((mdmCommands[1] as { mdmCommand: string }).mdmCommand).toBe("Location");
  expect((mdmCommands[1] as { accuracy: string }).accuracy).toBe("fine");
  expect((mdmCommands[2] as { mdmCommand: string }).mdmCommand).toBe("ScheduleOSUpdate");
  expect((mdmCommands[2] as { notifyDevice: boolean }).notifyDevice).toBe(true);
});

test("seams-mobile (ios): identify/diagnose/health route to DeviceInformation (no payload contract)", () => {
  const seam = createInMemoryIosSeam();
  for (const capability of ["identify", "diagnose", "health"] as const) {
    const result = seam.commands.execute({ capability, payload: undefined });
    expect(result.status).toBe("succeeded");
  }
  const mdmCommands = seam
    .calls()
    .filter((call) => call.method === "runMdmCommand")
    .map((call) => call.detail);
  expect(mdmCommands.every((command) => (command as { mdmCommand: string }).mdmCommand === "DeviceInformation")).toBe(true);
});

test("seams-mobile (ios): a MALFORMED payload fails closed — never an emulated success", () => {
  const seam = createInMemoryIosSeam();
  const result = seam.commands.execute({ capability: "wipe", payload: { scope: "selective" } });
  expect(result.status).toBe("failed");
  if (result.status !== "failed") return;
  expect(result.failure?.kind).toBe("adapter_internal");
  expect(result.failure?.message).toContain("malformed mobile command payload");
  // The typed channel was never invoked; only the normalized execute was recorded.
  const methods = seam.calls().map((call) => call.method);
  expect(methods).toEqual(["execute"]);
});

test("seams-mobile (ios): iPadOS shares the Apple MDM channel and routing", () => {
  const seam = createInMemoryIpadOsSeam();
  const result = seam.commands.execute({
    capability: "lock",
    payload: { action: "enable", message: "m", phoneNumber: "+15550001" },
  });
  expect(result.status).toBe("succeeded");
  expect(
    seam.calls().some((call) => call.method === "runMdmCommand"),
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Android Enterprise routing
// ---------------------------------------------------------------------------

test("seams-mobile (android): lost-mode enable maps to lock-screen with the lost-mode presentation", () => {
  const seam = createInMemoryAndroidSeam();
  const result = seam.commands.execute({
    capability: "lock",
    payload: { action: "enable", message: "Lost device", phoneNumber: "+15550100" },
  });
  expect(result.status).toBe("succeeded");
  const enterprise = seam
    .calls()
    .find((call) => call.method === "runEnterpriseCommand")?.detail;
  expect(enterprise).toEqual({
    capability: "lock",
    enterpriseCommand: "lock-screen",
    lockScreenType: "password",
    lostMode: { message: "Lost device", phoneNumber: "+15550100" },
  });
});

test("seams-mobile (android): wipe full maps to device wipe; enterprise maps to work-profile wipe", () => {
  const seam = createInMemoryAndroidSeam();
  seam.commands.execute({ capability: "wipe", payload: { scope: "full" } });
  seam.commands.execute({ capability: "wipe", payload: { scope: "enterprise" } });
  const wipes = seam
    .calls()
    .filter((call) => call.method === "runEnterpriseCommand")
    .map((call) => (call.detail as { scope: string }).scope);
  expect(wipes).toEqual(["device", "work-profile"]);
});

test("seams-mobile (android): managed app + policy + update route through the enterprise channel", () => {
  const seam = createInMemoryAndroidSeam();
  seam.commands.execute({ capability: "enforce", payload: { action: "remove", appIdentifier: "com.game" } });
  seam.commands.execute({ capability: "enforce", payload: { policyArea: "restrictions", restrictions: ["allow-camera"] } });
  seam.commands.execute({ capability: "update", payload: { targetVersion: "14", notifyDevice: false } });
  const commands = seam
    .calls()
    .filter((call) => call.method === "runEnterpriseCommand")
    .map((call) => call.detail);
  expect((commands[0] as { enterpriseCommand: string }).enterpriseCommand).toBe("remove-app");
  expect((commands[0] as { appIdentifier: string }).appIdentifier).toBe("com.game");
  expect((commands[1] as { enterpriseCommand: string }).enterpriseCommand).toBe("apply-policy");
  expect((commands[1] as { policyArea: string }).policyArea).toBe("restrictions");
  expect((commands[2] as { enterpriseCommand: string }).enterpriseCommand).toBe("set-update-policy");
  expect((commands[2] as { targetVersion: string }).targetVersion).toBe("14");
});

test("seams-mobile (android): malformed payloads fail closed before the enterprise channel", () => {
  const seam = createInMemoryAndroidSeam();
  const result = seam.commands.execute({ capability: "enforce", payload: { action: "install" } }); // missing appIdentifier
  expect(result.status).toBe("failed");
  expect(seam.calls().map((call) => call.method)).toEqual(["execute"]);
});

// ---------------------------------------------------------------------------
// Scripted outcomes + evidence
// ---------------------------------------------------------------------------

test("seams-mobile: scripted outcomes override the default (first match wins)", () => {
  const seam = createInMemoryAndroidSeam({
    commandOutcomes: [
      { capability: "wipe", status: "failed", failureKind: "timeout", message: "device offline" },
      { capability: "wipe", status: "succeeded" }, // second — ignored
    ],
  });
  const result = seam.commands.execute({ capability: "wipe", payload: { scope: "full" } });
  expect(result.status).toBe("failed");
  if (result.status !== "failed") return;
  expect(result.failure?.kind).toBe("timeout");
  expect(result.failure?.message).toBe("device offline");
  expect(result.evidence.length).toBe(1);
  expect(result.evidence[0].hashAlgorithm).toBe("fnv1a32");
  expect(result.evidence[0].key).toContain("seam://android/wipe/");
});

test("seams-mobile: unscripted capabilities succeed with a deterministic default output", () => {
  const seam = createInMemoryIosSeam();
  const first = seam.commands.execute({ capability: "health" });
  expect(first.status).toBe("succeeded");
  if (first.status !== "succeeded") return;
  expect(first.output).toEqual({
    platform: "ios",
    capability: "health",
    scripted: false,
    command: { capability: "health", mdmCommand: "DeviceInformation" },
  });
});

// ---------------------------------------------------------------------------
// Observation sources + probe
// ---------------------------------------------------------------------------

test("seams-mobile: poll drains the four mobile sources in fixed order", () => {
  const seam = createInMemoryIosSeam({
    batteryObservations: [mobileBatteryRecord(TS, { batteryLevelPercent: 90, chargingState: "charging" })],
    osVersionObservations: [mobileOsVersionRecord(TS, { osFamily: "ios", osVersion: "17.4.1" })],
    complianceObservations: [
      mobileComplianceRecord(TS, { complianceState: "compliant", lastEvaluatedAt: TS, violations: [] }),
    ],
    locationEvidenceObservations: [
      mobileLocationEvidenceRecord(TS, {
        latitude: 47.6,
        longitude: -122.3,
        capturedAt: TS,
        fixSource: "gps",
        capturedWhileLostMode: false,
      }),
    ],
  });
  const records = seam.observationSources.poll();
  expect(records.length).toBe(4);
  expect(records.map((record) => record.kind)).toEqual([
    "mobile.battery",
    "mobile.os-version",
    "mobile.compliance",
    "mobile.location-evidence",
  ]);
  // poll() invokes each typed source once (recorded).
  const methods = seam.calls().filter((call) => call.surface === "observations").map((call) => call.method);
  expect(methods).toEqual(["poll", "readBatteryState", "readOsVersion", "readComplianceState", "readLocationEvidence"]);
});

test("seams-mobile: the typed source methods return the scripted records and record invocations", () => {
  const seam = createInMemoryAndroidSeam({
    batteryObservations: [mobileBatteryRecord(TS, { batteryLevelPercent: 15, chargingState: "discharging" })],
  });
  const records = seam.observationSources.readBatteryState();
  expect(records.length).toBe(1);
  expect(records[0].payload).toEqual({ batteryLevelPercent: 15, chargingState: "discharging" });
  expect(seam.observationSources.readOsVersion().length).toBe(0);
});

test("seams-mobile: the probe reports the scripted capabilities and records the call", () => {
  const seam = createInMemoryIosSeam({ probedCapabilities: { observe: true, health: true } });
  expect(seam.capabilityProbe.probeId).toBe("inmemory-ios-probe");
  const probed = seam.capabilityProbe.probe();
  expect(probed.observe).toBe(true);
  expect(probed.health).toBe(true);
  expect(probed.wipe).toBeUndefined();
  expect(seam.calls().some((call) => call.surface === "probe")).toBe(true);
});

// ---------------------------------------------------------------------------
// Recording + reset + determinism
// ---------------------------------------------------------------------------

test("seams-mobile: reset clears recorded invocations but preserves scripted data", () => {
  const seam = createInMemoryIosSeam({
    commandOutcomes: [{ capability: "wipe", status: "failed", message: "no" }],
  });
  seam.commands.execute({ capability: "health" });
  expect(seam.calls().length > 0).toBe(true);
  seam.reset();
  expect(seam.calls().length).toBe(0);
  // The scripted outcome still applies after reset.
  const result = seam.commands.execute({ capability: "wipe", payload: { scope: "full" } });
  expect(result.status).toBe("failed");
});

test("seams-mobile: byte-identical determinism — same options, same results", () => {
  const options = {
    commandOutcomes: [{ capability: "locate", status: "succeeded" } as const],
    batteryObservations: [mobileBatteryRecord(TS, { batteryLevelPercent: 42, chargingState: "full" })],
    probedCapabilities: { observe: true },
  };
  const seamA = createInMemoryAndroidSeam(options);
  const seamB = createInMemoryAndroidSeam(options);
  const resultsA = [
    seamA.commands.execute({ capability: "locate", payload: { accuracy: "coarse" } }),
    seamA.commands.execute({ capability: "identify" }),
    seamA.observationSources.poll(),
    seamA.capabilityProbe.probe(),
  ];
  const resultsB = [
    seamB.commands.execute({ capability: "locate", payload: { accuracy: "coarse" } }),
    seamB.commands.execute({ capability: "identify" }),
    seamB.observationSources.poll(),
    seamB.capabilityProbe.probe(),
  ];
  expect(canonicalJson(resultsA)).toBe(canonicalJson(resultsB));
  expect(canonicalJson(seamA.calls())).toBe(canonicalJson(seamB.calls()));
});
