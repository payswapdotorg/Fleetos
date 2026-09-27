/**
 * W030 D1 tests — mobile command + observation payload contracts
 * (MDM-shaped, fail-closed validators, record builders).
 */

import { test, expect } from "bun:test";
import { validateObservationBatch, type ObservationBatch } from "@fleetos/contracts";
import { createObservationCollector } from "../src/observations";
import {
  mobileBatteryRecord,
  mobileComplianceRecord,
  mobileLocationEvidenceRecord,
  mobileOsVersionRecord,
  MOBILE_BATTERY_OBSERVATION_KIND,
  MOBILE_COMPLIANCE_OBSERVATION_KIND,
  MOBILE_LOCATION_OBSERVATION_KIND,
  MOBILE_OS_VERSION_OBSERVATION_KIND,
  MOBILE_OBSERVATION_KINDS,
  isMobileObservationKind,
  parseMobileBatteryPayload,
  parseMobileCompliancePayload,
  parseMobileLocationEvidencePayload,
  parseMobileOsVersionPayload,
  parseMobileObservationPayload,
} from "../src/mobile-observations";
import {
  isMobileCommandPayload,
  MOBILE_CAPABILITY_PAYLOAD_KINDS,
  parseDeviceLockCommandPayload,
  parseLocateRequestPayload,
  parseLostModeCommandPayload,
  parseManagedAppCommandPayload,
  parseMobileCommandPayload,
  parseMobileEnforcePayload,
  parseOsUpdatePolicyPayload,
  parsePasscodePolicyPayload,
  parseWipeCommandPayload,
} from "../src/mobile-commands";

// ---------------------------------------------------------------------------
// Managed-app command payload
// ---------------------------------------------------------------------------

test("mobile-commands: managed-app install parses with managed configuration", () => {
  const parsed = parseManagedAppCommandPayload({
    action: "install",
    appIdentifier: "com.example.sales",
    managedConfiguration: { region: "eu" },
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.action).toBe("install");
  expect(parsed.payload.appIdentifier).toBe("com.example.sales");
  expect(parsed.payload.managedConfiguration).toEqual({ region: "eu" });
});

test("mobile-commands: managed-app remove parses; invalid action/app fail closed", () => {
  expect(parseManagedAppCommandPayload({ action: "remove", appIdentifier: "com.example.sales" }).ok).toBe(true);
  expect(parseManagedAppCommandPayload({ action: "purge", appIdentifier: "x" }).ok).toBe(false);
  expect(parseManagedAppCommandPayload({ action: "install", appIdentifier: "" }).ok).toBe(false);
  expect(parseManagedAppCommandPayload({ action: "install" }).ok).toBe(false);
  expect(parseManagedAppCommandPayload("install com.example").ok).toBe(false);
  expect(parseManagedAppCommandPayload({ action: "install", appIdentifier: "a", managedConfiguration: "nope" }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// OS-update policy payload
// ---------------------------------------------------------------------------

test("mobile-commands: OS-update policy parses with optional fields", () => {
  const full = parseOsUpdatePolicyPayload({
    targetVersion: "17.5",
    deferralHours: 48,
    notifyDevice: true,
  });
  expect(full.ok).toBe(true);
  if (!full.ok) return;
  expect(full.payload.targetVersion).toBe("17.5");
  expect(full.payload.deferralHours).toBe(48);
  expect(full.payload.notifyDevice).toBe(true);
  const minimal = parseOsUpdatePolicyPayload({ notifyDevice: false });
  expect(minimal.ok).toBe(true);
  if (!minimal.ok) return;
  expect(minimal.payload.targetVersion).toBeUndefined();
});

test("mobile-commands: OS-update policy fails closed on bad shapes", () => {
  expect(parseOsUpdatePolicyPayload({}).ok).toBe(false); // notifyDevice required
  expect(parseOsUpdatePolicyPayload({ notifyDevice: "yes" }).ok).toBe(false);
  expect(parseOsUpdatePolicyPayload({ notifyDevice: true, deferralHours: -1 }).ok).toBe(false);
  expect(parseOsUpdatePolicyPayload({ notifyDevice: true, deferralHours: 1.5 }).ok).toBe(false);
  expect(parseOsUpdatePolicyPayload({ notifyDevice: true, targetVersion: "" }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Lost-mode payload (enable REQUIRES message + phone)
// ---------------------------------------------------------------------------

test("mobile-commands: lost-mode enable requires message AND phone number; disable needs nothing", () => {
  const enabled = parseLostModeCommandPayload({
    action: "enable",
    message: "Lost device — call helpdesk",
    phoneNumber: "+15551234567",
    footnote: "FleetOS",
  });
  expect(enabled.ok).toBe(true);
  if (!enabled.ok) return;
  expect(enabled.payload.action).toBe("enable");
  if (enabled.payload.action !== "enable") return;
  expect(enabled.payload.message).toBe("Lost device — call helpdesk");
  expect(enabled.payload.phoneNumber).toBe("+15551234567");
  expect(parseLostModeCommandPayload({ action: "disable" }).ok).toBe(true);
  expect(parseLostModeCommandPayload({ action: "enable", message: "m" }).ok).toBe(false);
  expect(parseLostModeCommandPayload({ action: "enable", phoneNumber: "+1" }).ok).toBe(false);
  expect(parseLostModeCommandPayload({ action: "enable", message: "", phoneNumber: "+1" }).ok).toBe(false);
  expect(parseLostModeCommandPayload({ action: "pause" }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Lock / wipe / locate payloads
// ---------------------------------------------------------------------------

test("mobile-commands: device lock accepts an optional 4-8 digit PIN only", () => {
  expect(parseDeviceLockCommandPayload({}).ok).toBe(true);
  const withPin = parseDeviceLockCommandPayload({ pin: "123456" });
  expect(withPin.ok).toBe(true);
  expect(parseDeviceLockCommandPayload({ pin: "12" }).ok).toBe(false);
  expect(parseDeviceLockCommandPayload({ pin: "123456789" }).ok).toBe(false);
  expect(parseDeviceLockCommandPayload({ pin: "abcdef" }).ok).toBe(false);
});

test("mobile-commands: wipe payload scopes full vs enterprise", () => {
  const full = parseWipeCommandPayload({ scope: "full", preserveDataPlan: true });
  expect(full.ok).toBe(true);
  if (!full.ok) return;
  expect(full.payload.scope).toBe("full");
  expect(full.payload.preserveDataPlan).toBe(true);
  expect(parseWipeCommandPayload({ scope: "enterprise" }).ok).toBe(true);
  expect(parseWipeCommandPayload({}).ok).toBe(false);
  expect(parseWipeCommandPayload({ scope: "selective" }).ok).toBe(false);
  expect(parseWipeCommandPayload({ scope: "full", preserveDataPlan: "yes" }).ok).toBe(false);
});

test("mobile-commands: locate request carries accuracy + optional max age", () => {
  const parsed = parseLocateRequestPayload({ accuracy: "fine", maxAgeSeconds: 30 });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.accuracy).toBe("fine");
  expect(parsed.payload.maxAgeSeconds).toBe(30);
  expect(parseLocateRequestPayload({}).ok).toBe(false);
  expect(parseLocateRequestPayload({ accuracy: "gps" }).ok).toBe(false);
  expect(parseLocateRequestPayload({ accuracy: "fine", maxAgeSeconds: -5 }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Mobile enforce payload (passcode / restrictions)
// ---------------------------------------------------------------------------

test("mobile-commands: passcode policy parses with bounded length", () => {
  const parsed = parsePasscodePolicyPayload({ minLength: 8, requireAlphanumeric: true });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.minLength).toBe(8);
  expect(parsed.payload.requireAlphanumeric).toBe(true);
  expect(parsePasscodePolicyPayload({ minLength: 17, requireAlphanumeric: false }).ok).toBe(false);
  expect(parsePasscodePolicyPayload({ minLength: -1, requireAlphanumeric: false }).ok).toBe(false);
  expect(parsePasscodePolicyPayload({ minLength: 4 }).ok).toBe(false);
});

test("mobile-commands: enforce payload discriminates passcode vs restrictions", () => {
  const restrictions = parseMobileEnforcePayload({
    policyArea: "restrictions",
    restrictions: ["allow-camera", "disable-safari"],
  });
  expect(restrictions.ok).toBe(true);
  if (!restrictions.ok) return;
  expect(restrictions.payload.policyArea).toBe("restrictions");
  if (restrictions.payload.policyArea !== "restrictions") return;
  expect([...restrictions.payload.restrictions]).toEqual(["allow-camera", "disable-safari"]);
  expect(parseMobileEnforcePayload({ policyArea: "passcode", policy: { minLength: 6, requireAlphanumeric: false } }).ok).toBe(true);
  expect(parseMobileEnforcePayload({ policyArea: "apps" }).ok).toBe(false);
  expect(parseMobileEnforcePayload({ policyArea: "passcode", policy: {} }).ok).toBe(false);
  expect(parseMobileEnforcePayload({ policyArea: "restrictions", restrictions: ["ok", ""] }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The capability -> payload-kind map + unified parser
// ---------------------------------------------------------------------------

test("mobile-commands: the capability payload map covers the mobile MDM capabilities", () => {
  expect([...(MOBILE_CAPABILITY_PAYLOAD_KINDS.enforce ?? [])]).toEqual(["managed-app", "mobile-enforce"]);
  expect([...(MOBILE_CAPABILITY_PAYLOAD_KINDS.lock ?? [])]).toEqual(["lost-mode", "device-lock"]);
  expect([...(MOBILE_CAPABILITY_PAYLOAD_KINDS.wipe ?? [])]).toEqual(["wipe"]);
  expect([...(MOBILE_CAPABILITY_PAYLOAD_KINDS.locate ?? [])]).toEqual(["locate-request"]);
  expect([...(MOBILE_CAPABILITY_PAYLOAD_KINDS.update ?? [])]).toEqual(["os-update-policy"]);
  expect(MOBILE_CAPABILITY_PAYLOAD_KINDS.remediate).toBeUndefined();
  expect(MOBILE_CAPABILITY_PAYLOAD_KINDS.reboot).toBeUndefined();
});

test("mobile-commands: parseMobileCommandPayload resolves the kind for each capability", () => {
  const lockLostMode = parseMobileCommandPayload("lock", { action: "enable", message: "m", phoneNumber: "+1" });
  expect(lockLostMode.ok).toBe(true);
  if (!lockLostMode.ok) return;
  expect(lockLostMode.payload.kind).toBe("lost-mode");
  const lockDeviceLock = parseMobileCommandPayload("lock", { pin: "1234" });
  expect(lockDeviceLock.ok).toBe(true);
  if (!lockDeviceLock.ok) return;
  expect(lockDeviceLock.payload.kind).toBe("device-lock");
  const enforce = parseMobileCommandPayload("enforce", { action: "install", appIdentifier: "com.x" });
  expect(enforce.ok).toBe(true);
  if (!enforce.ok) return;
  expect(enforce.payload.kind).toBe("managed-app");
  const update = parseMobileCommandPayload("update", { notifyDevice: true });
  expect(update.ok).toBe(true);
  if (!update.ok) return;
  expect(update.payload.kind).toBe("os-update-policy");
});

test("mobile-commands: parseMobileCommandPayload fails closed on kind/payload mismatch", () => {
  // A wipe payload offered to lock; a lock payload offered to wipe.
  expect(parseMobileCommandPayload("lock", { scope: "full" }).ok).toBe(false);
  expect(parseMobileCommandPayload("wipe", { action: "enable", message: "m", phoneNumber: "1" }).ok).toBe(false);
  expect(parseMobileCommandPayload("wipe", undefined).ok).toBe(false);
  expect(parseMobileCommandPayload("wipe", {}).ok).toBe(false);
  // A capability outside the mobile payload contract accepts nothing.
  expect(parseMobileCommandPayload("remediate", { anything: true }).ok).toBe(false);
  expect(parseMobileCommandPayload("identify", {}).ok).toBe(false);
  expect(isMobileCommandPayload("locate", { accuracy: "coarse" })).toBe(true);
  expect(isMobileCommandPayload("locate", { accuracy: "gps" })).toBe(false);
});

test("mobile-commands: the parse failure reason is machine-stable", () => {
  const parsed = parseMobileCommandPayload("wipe", { scope: "selective" });
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.reason).toContain("wipe");
  expect(parsed.reason).toContain("scope");
});

// ---------------------------------------------------------------------------
// Mobile observation payloads + record builders
// ---------------------------------------------------------------------------

test("mobile-observations: the four mobile observation kinds are enumerable", () => {
  expect([...MOBILE_OBSERVATION_KINDS]).toEqual([
    "mobile.battery",
    "mobile.os-version",
    "mobile.compliance",
    "mobile.location-evidence",
  ]);
  expect(isMobileObservationKind("mobile.battery")).toBe(true);
  expect(isMobileObservationKind("device.health")).toBe(false);
});

test("mobile-observations: battery payload validates bounds + charging state", () => {
  expect(parseMobileBatteryPayload({ batteryLevelPercent: 87, chargingState: "charging" }).ok).toBe(true);
  expect(parseMobileBatteryPayload({ batteryLevelPercent: 0, chargingState: "discharging" }).ok).toBe(true);
  expect(parseMobileBatteryPayload({ batteryLevelPercent: 101, chargingState: "full" }).ok).toBe(false);
  expect(parseMobileBatteryPayload({ batteryLevelPercent: 55.5, chargingState: "full" }).ok).toBe(false);
  expect(parseMobileBatteryPayload({ batteryLevelPercent: 55, chargingState: "draining" }).ok).toBe(false);
});

test("mobile-observations: OS version payload validates family + patch level format", () => {
  const parsed = parseMobileOsVersionPayload({
    osFamily: "android",
    osVersion: "14.0",
    securityPatchLevel: "2026-01-05",
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.osFamily).toBe("android");
  expect(parsed.payload.securityPatchLevel).toBe("2026-01-05");
  expect(parseMobileOsVersionPayload({ osFamily: "ipados", osVersion: "17.4", buildNumber: "21E236" }).ok).toBe(true);
  expect(parseMobileOsVersionPayload({ osFamily: "webos", osVersion: "1" }).ok).toBe(false);
  expect(parseMobileOsVersionPayload({ osFamily: "ios", osVersion: "" }).ok).toBe(false);
  expect(parseMobileOsVersionPayload({ osFamily: "android", osVersion: "14", securityPatchLevel: "Jan-5" }).ok).toBe(false);
});

test("mobile-observations: compliance payload validates state + ISO timestamp + codes", () => {
  const parsed = parseMobileCompliancePayload({
    complianceState: "non_compliant",
    lastEvaluatedAt: "2026-01-01T10:00:00Z",
    violations: ["passcode-not-set", "os-version-too-old"],
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.complianceState).toBe("non_compliant");
  expect(parsed.payload.violations.length).toBe(2);
  expect(parseMobileCompliancePayload({ complianceState: "compliant", lastEvaluatedAt: "2026-01-01T10:00:00Z", violations: [] }).ok).toBe(true);
  expect(parseMobileCompliancePayload({ complianceState: "unknown", lastEvaluatedAt: "2026-01-01T10:00:00Z", violations: [] }).ok).toBe(false);
  expect(parseMobileCompliancePayload({ complianceState: "compliant", lastEvaluatedAt: "yesterday", violations: [] }).ok).toBe(false);
});

test("mobile-observations: location evidence validates coordinates, provenance and context", () => {
  const parsed = parseMobileLocationEvidencePayload({
    latitude: 47.6062,
    longitude: -122.3321,
    accuracyMeters: 12,
    capturedAt: "2026-01-01T10:00:00Z",
    fixSource: "gps",
    capturedWhileLostMode: true,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.fixSource).toBe("gps");
  expect(parsed.payload.capturedWhileLostMode).toBe(true);
  expect(parseMobileLocationEvidencePayload({
    latitude: 91,
    longitude: 0,
    capturedAt: "2026-01-01T10:00:00Z",
    fixSource: "gps",
    capturedWhileLostMode: false,
  }).ok).toBe(false);
  expect(parseMobileLocationEvidencePayload({
    latitude: 0,
    longitude: -181,
    capturedAt: "2026-01-01T10:00:00Z",
    fixSource: "gps",
    capturedWhileLostMode: false,
  }).ok).toBe(false);
  expect(parseMobileLocationEvidencePayload({
    latitude: 0,
    longitude: 0,
    capturedAt: "now",
    fixSource: "gps",
    capturedWhileLostMode: false,
  }).ok).toBe(false);
  expect(parseMobileLocationEvidencePayload({
    latitude: 0,
    longitude: 0,
    capturedAt: "2026-01-01T10:00:00Z",
    fixSource: "satellite",
    capturedWhileLostMode: false,
  }).ok).toBe(false);
});

test("mobile-observations: parseMobileObservationPayload dispatches by kind, fail-closed otherwise", () => {
  expect(parseMobileObservationPayload("mobile.battery", { batteryLevelPercent: 5, chargingState: "unknown" }).ok).toBe(true);
  expect(parseMobileObservationPayload("mobile.os-version", { osFamily: "ios", osVersion: "17.0" }).ok).toBe(true);
  expect(parseMobileObservationPayload("mobile.compliance", { complianceState: "compliant", lastEvaluatedAt: "2026-01-01T10:00:00Z", violations: [] }).ok).toBe(true);
  expect(parseMobileObservationPayload("mobile.location-evidence", {
    latitude: 1,
    longitude: 1,
    capturedAt: "2026-01-01T10:00:00Z",
    fixSource: "wifi",
    capturedWhileLostMode: false,
  }).ok).toBe(true);
  expect(parseMobileObservationPayload("device.health", {}).ok).toBe(false);
  expect(parseMobileObservationPayload("printer.consumable", {}).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Records flow through the W010 collector + the frozen batch validator
// ---------------------------------------------------------------------------

test("mobile-observations: mobile records assemble batches the frozen contracts validator accepts", () => {
  const collector = createObservationCollector({
    tenantId: "tnt_mobile_1" as never,
    deviceId: "dev_mobile_1" as never,
  });
  collector.record(mobileBatteryRecord("2026-01-01T10:00:00Z", { batteryLevelPercent: 64, chargingState: "discharging" }));
  collector.record(mobileOsVersionRecord("2026-01-01T10:00:01Z", { osFamily: "ios", osVersion: "17.4.1" }));
  collector.record(mobileComplianceRecord("2026-01-01T10:00:02Z", {
    complianceState: "compliant",
    lastEvaluatedAt: "2026-01-01T09:00:00Z",
    violations: [],
  }));
  collector.record(mobileLocationEvidenceRecord("2026-01-01T10:00:03Z", {
    latitude: 47.6,
    longitude: -122.3,
    capturedAt: "2026-01-01T09:59:00Z",
    fixSource: "wifi",
    capturedWhileLostMode: true,
  }));
  const flush = collector.flush("2026-01-01T10:00:05Z");
  expect(flush.ok).toBe(true);
  if (!flush.ok) return;
  const batch: ObservationBatch = flush.batch;
  expect(validateObservationBatch(batch).ok).toBe(true);
  expect(batch.observations.length).toBe(4);
  expect(batch.observations[0].kind).toBe(MOBILE_BATTERY_OBSERVATION_KIND);
  expect(batch.observations[3].kind).toBe(MOBILE_LOCATION_OBSERVATION_KIND);
  expect(batch.observations[1].schemaVersion).toBe(1);
});

test("mobile-observations: record builders are frozen and kind-stable", () => {
  const record = mobileComplianceRecord("2026-01-01T10:00:00Z", {
    complianceState: "non_compliant",
    lastEvaluatedAt: "2026-01-01T09:00:00Z",
    violations: ["x"],
  });
  expect(Object.isFrozen(record)).toBe(true);
  expect(record.kind).toBe(MOBILE_COMPLIANCE_OBSERVATION_KIND);
  expect(record.observedAt).toBe("2026-01-01T10:00:00Z");
  const os = mobileOsVersionRecord("2026-01-01T10:00:00Z", { osFamily: "android", osVersion: "14" });
  expect(os.kind).toBe(MOBILE_OS_VERSION_OBSERVATION_KIND);
});
