/**
 * @fleetos/device-adapters — W030 D1: Mobile family platform seams
 * (iOS / iPadOS / Android Enterprise typed boundary interfaces).
 *
 * TYPES ONLY (no runtime values) — the typed boundary interfaces a REAL
 * mobile device management integration would implement for the endpoint
 * adapter SDK:
 *
 *   - an MDM command execution surface per protocol family (Apple MDM
 *     for iOS/iPadOS; Android Enterprise for Android) — each extending
 *     the normalized `execute()` boundary the platform-agnostic adapter
 *     routes through,
 *   - the shared mobile observation sources (battery, OS version,
 *     compliance state, geolocation evidence) — extending the
 *     normalized `poll()` boundary,
 *   - a capability probe (the normalized `probe()` boundary).
 *
 * The in-memory deterministic reference implementations live in
 * `seams-inmemory-mobile.ts` (tests; no real MDM integration is shipped
 * in this lane — SNMP and MDM are CONTRACT boundaries).
 *
 * Platform-specific types stay INSIDE this package (the seam is where
 * platform meets the normalized capability surface by design); they
 * never enter the frozen core domain contracts.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapability } from "./adapter";
import type { ObservationRecord } from "./observations";
import type {
  SeamCapabilityProbe,
  SeamCommandExecutionSurface,
  SeamCommandRequest,
  SeamCommandResult,
  SeamObservationFeed,
} from "./seams";

// ---------------------------------------------------------------------------
// D1.14 — Apple MDM command channel (iOS / iPadOS)
// ---------------------------------------------------------------------------

/** An Apple MDM device information query (identify / diagnose / health). */
export interface AppleMdmDeviceInformationCommand {
  readonly capability: "identify" | "diagnose" | "health";
  readonly mdmCommand: "DeviceInformation";
}

/** An Apple MDM managed-app command (InstallApplication / RemoveApplication). */
export interface AppleMdmManagedAppCommand {
  readonly capability: "enforce";
  readonly mdmCommand: "InstallApplication" | "RemoveApplication";
  readonly appIdentifier: string;
}

/** An Apple MDM profile command (passcode / restrictions profiles). */
export interface AppleMdmProfileCommand {
  readonly capability: "enforce";
  readonly mdmCommand: "InstallProfile" | "RemoveProfile";
  readonly profileIdentifier: string;
}

/** An Apple MDM OS update command (the softwareupdate policy). */
export interface AppleMdmOsUpdateCommand {
  readonly capability: "update";
  readonly mdmCommand: "ScheduleOSUpdate";
  readonly targetVersion?: string;
  readonly deferralHours?: number;
  readonly notifyDevice: boolean;
}

/** An Apple MDM lost-mode command (EnableLostMode requires message + phone). */
export interface AppleMdmLostModeCommand {
  readonly capability: "lock";
  readonly mdmCommand: "EnableLostMode" | "DisableLostMode";
  readonly message?: string;
  readonly phoneNumber?: string;
  readonly footnote?: string;
}

/** An Apple MDM device lock command (DeviceLock, optional PIN). */
export interface AppleMdmDeviceLockCommand {
  readonly capability: "lock";
  readonly mdmCommand: "DeviceLock";
  readonly pin?: string;
}

/** An Apple MDM erase command (EraseDevice; enterprise = org data only). */
export interface AppleMdmEraseCommand {
  readonly capability: "wipe";
  readonly mdmCommand: "EraseDevice";
  readonly scope: "full" | "enterprise";
  readonly preserveDataPlan?: boolean;
}

/** An Apple MDM location request command (Location). */
export interface AppleMdmLocationCommand {
  readonly capability: "locate";
  readonly mdmCommand: "Location";
  readonly accuracy: "coarse" | "fine";
}

/** The union of Apple MDM typed commands (iOS + iPadOS). */
export type AppleMdmCommand =
  | AppleMdmDeviceInformationCommand
  | AppleMdmManagedAppCommand
  | AppleMdmProfileCommand
  | AppleMdmOsUpdateCommand
  | AppleMdmLostModeCommand
  | AppleMdmDeviceLockCommand
  | AppleMdmEraseCommand
  | AppleMdmLocationCommand;

/**
 * The Apple MDM command execution surface: the normalized `execute()`
 * boundary plus the platform-typed `runMdmCommand` entry point a real
 * Apple MDM connector implements.
 */
export interface AppleMdmCommandChannel extends SeamCommandExecutionSurface {
  /** Execute a typed Apple MDM command on the endpoint. */
  runMdmCommand(command: AppleMdmCommand): SeamCommandResult;
}

// ---------------------------------------------------------------------------
// D1.15 — Android Enterprise command channel
// ---------------------------------------------------------------------------

/** An Android Enterprise managed-app command (managed Google Play). */
export interface AndroidManagedAppCommand {
  readonly capability: "enforce";
  readonly enterpriseCommand: "install-app" | "remove-app" | "hide-app";
  readonly appIdentifier: string;
}

/** An Android Enterprise policy command (passcode / restrictions). */
export interface AndroidPolicyCommand {
  readonly capability: "enforce";
  readonly enterpriseCommand: "apply-policy";
  readonly policyArea: "passcode" | "restrictions";
  readonly policyIdentifier?: string;
}

/** An Android Enterprise device info query (identify / diagnose / health). */
export interface AndroidDeviceInfoCommand {
  readonly capability: "identify" | "diagnose" | "health";
  readonly enterpriseCommand: "device-info";
}

/** An Android Enterprise OS update policy command. */
export interface AndroidOsUpdateCommand {
  readonly capability: "update";
  readonly enterpriseCommand: "set-update-policy";
  readonly targetVersion?: string;
  readonly deferralHours?: number;
}

/**
 * An Android Enterprise lock command. Android carries the lost-mode
 * presentation (message + phone shown on the lock screen) through the
 * lock command — the fields are presentation details, the capability is
 * `lock`.
 */
export interface AndroidLockCommand {
  readonly capability: "lock";
  readonly enterpriseCommand: "lock-screen";
  readonly lockScreenType: "password" | "pin" | "none";
  readonly lostMode?: {
    readonly message: string;
    readonly phoneNumber: string;
  };
}

/** An Android Enterprise wipe command (device or work profile). */
export interface AndroidWipeCommand {
  readonly capability: "wipe";
  readonly enterpriseCommand: "wipe";
  readonly scope: "device" | "work-profile";
}

/** An Android Enterprise location request command. */
export interface AndroidLocationCommand {
  readonly capability: "locate";
  readonly enterpriseCommand: "request-location";
  readonly accuracy: "coarse" | "fine";
}

/** The union of Android Enterprise typed commands. */
export type AndroidEnterpriseCommand =
  | AndroidDeviceInfoCommand
  | AndroidManagedAppCommand
  | AndroidPolicyCommand
  | AndroidOsUpdateCommand
  | AndroidLockCommand
  | AndroidWipeCommand
  | AndroidLocationCommand;

/**
 * The Android Enterprise command execution surface: the normalized
 * `execute()` boundary plus the platform-typed `runEnterpriseCommand`
 * entry point a real Android Enterprise connector implements.
 */
export interface AndroidEnterpriseCommandChannel extends SeamCommandExecutionSurface {
  /** Execute a typed Android Enterprise command on the endpoint. */
  runEnterpriseCommand(command: AndroidEnterpriseCommand): SeamCommandResult;
}

// ---------------------------------------------------------------------------
// D1.16 — Mobile observation sources (shared across the mobile families)
// ---------------------------------------------------------------------------

/**
 * The mobile observation sources: the normalized `poll()` boundary plus
 * the four platform-typed mobile evidence entry points. Shared by
 * iOS/iPadOS/Android — the mobile observables (battery, OS version,
 * compliance state, geolocation evidence) are protocol-independent;
 * the payload contracts live in `mobile-observations.ts`.
 */
export interface MobileObservationSources extends SeamObservationFeed {
  /** Read the battery state (kind `mobile.battery`). */
  readBatteryState(): readonly ObservationRecord[];
  /** Read the OS version (kind `mobile.os-version`). */
  readOsVersion(): readonly ObservationRecord[];
  /** Read the compliance state (kind `mobile.compliance`). */
  readComplianceState(): readonly ObservationRecord[];
  /** Read captured geolocation evidence (kind `mobile.location-evidence`). */
  readLocationEvidence(): readonly ObservationRecord[];
}

// ---------------------------------------------------------------------------
// D1.17 — The mobile family seams
// ---------------------------------------------------------------------------

/** The complete iOS platform seam (Apple MDM boundary). */
export interface IosSeam {
  readonly platform: "ios";
  readonly commands: AppleMdmCommandChannel;
  readonly observationSources: MobileObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

/** The complete iPadOS platform seam (Apple MDM boundary). */
export interface IpadOsSeam {
  readonly platform: "ipados";
  readonly commands: AppleMdmCommandChannel;
  readonly observationSources: MobileObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

/** The complete Android platform seam (Android Enterprise boundary). */
export interface AndroidSeam {
  readonly platform: "android";
  readonly commands: AndroidEnterpriseCommandChannel;
  readonly observationSources: MobileObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

/** The union of the mobile family seams. */
export type MobileSeam = IosSeam | IpadOsSeam | AndroidSeam;

/** Pure predicate: is the value a mobile seam (platform + surfaces)? */
export function isMobileSeam(value: unknown): value is MobileSeam {
  if (typeof value !== "object" || value === null) return false;
  const seam = value as { platform?: unknown; commands?: unknown; observationSources?: unknown; capabilityProbe?: unknown };
  return (
    (seam.platform === "ios" || seam.platform === "ipados" || seam.platform === "android") &&
    typeof seam.commands === "object" &&
    seam.commands !== null &&
    typeof (seam.commands as { execute?: unknown }).execute === "function" &&
    typeof seam.observationSources === "object" &&
    seam.observationSources !== null &&
    typeof (seam.observationSources as { poll?: unknown }).poll === "function" &&
    typeof seam.capabilityProbe === "object" &&
    seam.capabilityProbe !== null &&
    typeof (seam.capabilityProbe as { probe?: unknown }).probe === "function"
  );
}
