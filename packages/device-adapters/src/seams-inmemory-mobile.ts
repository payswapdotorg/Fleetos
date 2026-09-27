/**
 * @fleetos/device-adapters — W030 D3: In-memory reference MOBILE family
 * seams (deterministic fakes).
 *
 * Reference implementations of the iOS / iPadOS / Android Enterprise
 * seams. There is NO real MDM integration in this lane: every method is
 * an in-memory, deterministic fake suitable for tests and for wiring
 * the family surface end-to-end. A production connector implements the
 * typed seam interfaces against the real MDM APIs (a later
 * infrastructure wave).
 *
 * Determinism rules (mirrors the W020 fakes + the contracts/testing
 * module):
 *   - No clock reads, no entropy: every value is a pure function of the
 *     construction options and the request. Timestamps are injected by
 *     the caller at the adapter boundary.
 *   - Evidence references are content-addressed over the canonical JSON
 *     of the typed family command (FNV-1a — a test hash, never for
 *     security).
 *   - Two fakes constructed with the same options behave identically,
 *     byte-for-byte.
 *
 * Scripting model:
 *   - `commandOutcomes` scripts per-capability results (first match
 *     wins). A capability with no scripted outcome succeeds with a
 *     deterministic default output.
 *   - `batteryObservations` / `osVersionObservations` /
 *     `complianceObservations` / `locationEvidenceObservations` script
 *     the records the four mobile observation sources return.
 *   - `probedCapabilities` scripts the capability probe result.
 *
 * Payload contract enforcement: the normalized `execute()` parses the
 * opaque payload with `parseMobileCommandPayload` (the D1 payload
 * contracts) and maps it to the typed MDM/Enterprise command. A
 * malformed payload FAILS CLOSED — a failed platform command, never an
 * emulated success. Every invocation is recorded (`calls()`) so tests
 * can prove the SDK never reaches the seam on refusal.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapabilities } from "@fleetos/contracts";
import type { AdapterCapability } from "./adapter";
import { frozen, frozenArray } from "./internal";
import type { ObservationRecord } from "./observations";
import { parseMobileCommandPayload } from "./mobile-commands";
import type { ParsedMobileCommandPayload } from "./mobile-commands";
import {
  familyProbeFor,
  familySeamResultFor,
  recordSeamCall,
  resetSeamRecorder,
  scriptedObservationsCopy,
  snapshotSeamCalls,
} from "./inmemory-shared";
import type { SeamRecorder } from "./inmemory-shared";
import type { InMemorySeamRecording, ScriptedSeamOutcome } from "./seams-inmemory";
import type { SeamCommandResult } from "./seams";
import type { SeamCommandRequest } from "./seams";
import type {
  AndroidEnterpriseCommand,
  AndroidSeam,
  AppleMdmCommand,
  AppleMdmCommandChannel,
  IosSeam,
  IpadOsSeam,
  MobileObservationSources,
} from "./seams-mobile";
import type { AndroidEnterpriseCommandChannel } from "./seams-mobile";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for the in-memory mobile family seams. The scripted records
 * should be assembled with the mobile observation record builders
 * (`mobileBatteryRecord`, ... in `mobile-observations.ts`).
 */
export interface InMemoryMobileSeamOptions {
  /** Scripted command outcomes, matched by capability (first match wins). */
  readonly commandOutcomes?: readonly ScriptedSeamOutcome[];
  /** Records returned by the battery source (kind `mobile.battery`). */
  readonly batteryObservations?: readonly ObservationRecord[];
  /** Records returned by the OS version source (kind `mobile.os-version`). */
  readonly osVersionObservations?: readonly ObservationRecord[];
  /** Records returned by the compliance source (kind `mobile.compliance`). */
  readonly complianceObservations?: readonly ObservationRecord[];
  /** Records returned by the location evidence source. */
  readonly locationEvidenceObservations?: readonly ObservationRecord[];
  /** The capability set the probe reports (default: none — explicit). */
  readonly probedCapabilities?: AdapterCapabilities;
}

/** The in-memory iOS seam (platform seam + invocation recording). */
export interface InMemoryIosSeam extends IosSeam, InMemorySeamRecording {}

/** The in-memory iPadOS seam (platform seam + invocation recording). */
export interface InMemoryIpadOsSeam extends IpadOsSeam, InMemorySeamRecording {}

/** The in-memory Android seam (platform seam + invocation recording). */
export interface InMemoryAndroidSeam extends AndroidSeam, InMemorySeamRecording {}

// ---------------------------------------------------------------------------
// Apple MDM mapping (iOS + iPadOS)
// ---------------------------------------------------------------------------

/**
 * The default iOS device information query the identify/diagnose/health
 * capabilities map to (when no payload contract applies).
 */
export const APPLE_DEFAULT_DEVICE_INFORMATION_QUERY = "DeviceInformation" as const;

function appleCommandFor(
  request: SeamCommandRequest,
): { ok: true; command: AppleMdmCommand } | { ok: false; reason: string } {
  const capability = request.capability as AdapterCapability;
  if (
    capability === "identify" ||
    capability === "diagnose" ||
    capability === "health"
  ) {
    return {
      ok: true,
      command: {
        capability,
        mdmCommand: "DeviceInformation",
      },
    };
  }
  const parsed = parseMobileCommandPayload(capability, request.payload);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, command: appleCommandForParsed(capability, parsed.payload) };
}

function appleCommandForParsed(
  capability: AdapterCapability,
  parsed: ParsedMobileCommandPayload,
): AppleMdmCommand {
  switch (parsed.kind) {
    case "managed-app":
      return {
        capability: "enforce",
        mdmCommand: parsed.payload.action === "install" ? "InstallApplication" : "RemoveApplication",
        appIdentifier: parsed.payload.appIdentifier,
      };
    case "mobile-enforce":
      return parsed.payload.policyArea === "passcode"
        ? { capability: "enforce", mdmCommand: "InstallProfile", profileIdentifier: "org.fleetos.passcode" }
        : { capability: "enforce", mdmCommand: "InstallProfile", profileIdentifier: "org.fleetos.restrictions" };
    case "os-update-policy":
      return {
        capability: "update",
        mdmCommand: "ScheduleOSUpdate",
        ...(parsed.payload.targetVersion !== undefined ? { targetVersion: parsed.payload.targetVersion } : {}),
        ...(parsed.payload.deferralHours !== undefined ? { deferralHours: parsed.payload.deferralHours } : {}),
        notifyDevice: parsed.payload.notifyDevice,
      };
    case "lost-mode":
      return parsed.payload.action === "enable"
        ? {
            capability: "lock",
            mdmCommand: "EnableLostMode",
            message: parsed.payload.message,
            phoneNumber: parsed.payload.phoneNumber,
            ...(parsed.payload.footnote !== undefined ? { footnote: parsed.payload.footnote } : {}),
          }
        : { capability: "lock", mdmCommand: "DisableLostMode" };
    case "device-lock":
      return {
        capability: "lock",
        mdmCommand: "DeviceLock",
        ...(parsed.payload.pin !== undefined ? { pin: parsed.payload.pin } : {}),
      };
    case "locate-request":
      return { capability: "locate", mdmCommand: "Location", accuracy: parsed.payload.accuracy };
    case "wipe":
      return {
        capability: "wipe",
        mdmCommand: "EraseDevice",
        scope: parsed.payload.scope,
        ...(parsed.payload.preserveDataPlan !== undefined
          ? { preserveDataPlan: parsed.payload.preserveDataPlan }
          : {}),
      };
  }
}

// ---------------------------------------------------------------------------
// Android Enterprise mapping
// ---------------------------------------------------------------------------

function androidCommandFor(
  request: SeamCommandRequest,
): { ok: true; command: AndroidEnterpriseCommand } | { ok: false; reason: string } {
  const capability = request.capability as AdapterCapability;
  if (
    capability === "identify" ||
    capability === "diagnose" ||
    capability === "health"
  ) {
    return {
      ok: true,
      command: { capability, enterpriseCommand: "device-info" },
    };
  }
  const parsed = parseMobileCommandPayload(capability, request.payload);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, command: androidCommandForParsed(capability, parsed.payload) };
}

function androidCommandForParsed(
  capability: AdapterCapability,
  parsed: ParsedMobileCommandPayload,
): AndroidEnterpriseCommand {
  switch (parsed.kind) {
    case "managed-app":
      return {
        capability: "enforce",
        enterpriseCommand: parsed.payload.action === "install" ? "install-app" : "remove-app",
        appIdentifier: parsed.payload.appIdentifier,
      };
    case "mobile-enforce":
      return {
        capability: "enforce",
        enterpriseCommand: "apply-policy",
        policyArea: parsed.payload.policyArea,
        policyIdentifier: `org.fleetos.${parsed.payload.policyArea}`,
      };
    case "os-update-policy":
      return {
        capability: "update",
        enterpriseCommand: "set-update-policy",
        ...(parsed.payload.targetVersion !== undefined ? { targetVersion: parsed.payload.targetVersion } : {}),
        ...(parsed.payload.deferralHours !== undefined ? { deferralHours: parsed.payload.deferralHours } : {}),
      };
    case "lost-mode":
      // Android carries the lost-mode presentation through the lock
      // command (message + phone on the lock screen).
      return parsed.payload.action === "enable"
        ? {
            capability: "lock",
            enterpriseCommand: "lock-screen",
            lockScreenType: "password",
            lostMode: { message: parsed.payload.message, phoneNumber: parsed.payload.phoneNumber },
          }
        : { capability: "lock", enterpriseCommand: "lock-screen", lockScreenType: "none" };
    case "device-lock":
      return {
        capability: "lock",
        enterpriseCommand: "lock-screen",
        lockScreenType: parsed.payload.pin !== undefined ? "pin" : "password",
      };
    case "locate-request":
      return {
        capability: "locate",
        enterpriseCommand: "request-location",
        accuracy: parsed.payload.accuracy,
      };
    case "wipe":
      return {
        capability: "wipe",
        enterpriseCommand: "wipe",
        scope: parsed.payload.scope === "full" ? "device" : "work-profile",
      };
  }
}

// ---------------------------------------------------------------------------
// Shared mobile seam construction
// ---------------------------------------------------------------------------

interface MobileSeamConfig {
  readonly platform: "ios" | "ipados" | "android";
  readonly options: InMemoryMobileSeamOptions;
}

function buildMobileObservationSources(
  recorder: SeamRecorder,
  options: InMemoryMobileSeamOptions,
): MobileObservationSources {
  const battery = options.batteryObservations ?? [];
  const osVersion = options.osVersionObservations ?? [];
  const compliance = options.complianceObservations ?? [];
  const locationEvidence = options.locationEvidenceObservations ?? [];

  function readBatteryState(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readBatteryState", null);
    return scriptedObservationsCopy(battery);
  }
  function readOsVersion(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readOsVersion", null);
    return scriptedObservationsCopy(osVersion);
  }
  function readComplianceState(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readComplianceState", null);
    return scriptedObservationsCopy(compliance);
  }
  function readLocationEvidence(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readLocationEvidence", null);
    return scriptedObservationsCopy(locationEvidence);
  }

  return frozen({
    poll: (): readonly ObservationRecord[] => {
      recordSeamCall(recorder, "observations", "poll", null);
      return frozenArray([
        ...readBatteryState(),
        ...readOsVersion(),
        ...readComplianceState(),
        ...readLocationEvidence(),
      ]);
    },
    readBatteryState,
    readOsVersion,
    readComplianceState,
    readLocationEvidence,
  });
}

function failedMalformed(platform: string, capability: string, reason: string): SeamCommandResult {
  return frozen({
    status: "failed" as const,
    evidence: frozenArray([]),
    failure: frozen({
      kind: "adapter_internal" as const,
      message: `malformed mobile command payload for capability "${capability}" on ${platform}: ${reason}`,
    }),
  });
}

// ---------------------------------------------------------------------------
// iOS / iPadOS — in-memory reference implementations
// ---------------------------------------------------------------------------

function buildAppleSeam(platform: "ios" | "ipados", options: InMemoryMobileSeamOptions) {
  const recorder: SeamRecorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];

  function runMdmCommand(command: AppleMdmCommand): SeamCommandResult {
    recordSeamCall(recorder, "commands", "runMdmCommand", command);
    return familySeamResultFor(platform, command.capability, command, outcomes);
  }

  const commands: AppleMdmCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      recordSeamCall(recorder, "commands", "execute", request);
      const mapped = appleCommandFor(request);
      if (!mapped.ok) {
        return failedMalformed(platform, request.capability as string, mapped.reason);
      }
      return runMdmCommand(mapped.command);
    },
    runMdmCommand,
  });

  return frozen({
    platform,
    commands,
    observationSources: buildMobileObservationSources(recorder, options),
    capabilityProbe: familyProbeFor(platform, recorder, options.probedCapabilities),
    calls: () => snapshotSeamCalls(recorder),
    reset: () => resetSeamRecorder(recorder),
  });
}

/**
 * Create an in-memory deterministic iOS seam (Apple MDM boundary). No
 * real MDM integration: `runMdmCommand` returns scripted outcomes; the
 * observation sources return scripted records; `probe()` returns the
 * scripted capabilities. Every invocation is recorded (see `calls()`).
 */
export function createInMemoryIosSeam(
  options: InMemoryMobileSeamOptions = {},
): InMemoryIosSeam {
  return buildAppleSeam("ios", options) as InMemoryIosSeam;
}

/**
 * Create an in-memory deterministic iPadOS seam (Apple MDM boundary).
 * Same scripting model as the iOS fake.
 */
export function createInMemoryIpadOsSeam(
  options: InMemoryMobileSeamOptions = {},
): InMemoryIpadOsSeam {
  return buildAppleSeam("ipados", options) as InMemoryIpadOsSeam;
}

// ---------------------------------------------------------------------------
// Android — in-memory reference implementation
// ---------------------------------------------------------------------------

/**
 * Create an in-memory deterministic Android seam (Android Enterprise
 * boundary). No real integration: `runEnterpriseCommand` returns
 * scripted outcomes; the observation sources return scripted records;
 * `probe()` returns the scripted capabilities. Every invocation is
 * recorded (see `calls()`).
 */
export function createInMemoryAndroidSeam(
  options: InMemoryMobileSeamOptions = {},
): InMemoryAndroidSeam {
  const recorder: SeamRecorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];

  function runEnterpriseCommand(command: AndroidEnterpriseCommand): SeamCommandResult {
    recordSeamCall(recorder, "commands", "runEnterpriseCommand", command);
    return familySeamResultFor("android", command.capability, command, outcomes);
  }

  const commands: AndroidEnterpriseCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      recordSeamCall(recorder, "commands", "execute", request);
      const mapped = androidCommandFor(request);
      if (!mapped.ok) {
        return failedMalformed("android", request.capability as string, mapped.reason);
      }
      return runEnterpriseCommand(mapped.command);
    },
    runEnterpriseCommand,
  });

  return frozen({
    platform: "android" as const,
    commands,
    observationSources: buildMobileObservationSources(recorder, options),
    capabilityProbe: familyProbeFor("android", recorder, options.probedCapabilities),
    calls: () => snapshotSeamCalls(recorder),
    reset: () => resetSeamRecorder(recorder),
  }) as InMemoryAndroidSeam;
}
