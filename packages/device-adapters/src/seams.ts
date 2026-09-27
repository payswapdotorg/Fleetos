/**
 * @fleetos/device-adapters — W020 D2 (+ W030 extension): Platform seams
 * (Windows/macOS/Linux + the mobile and printer/copier families).
 *
 * Typed boundary interfaces per platform. A platform seam is the set of
 * surfaces a REAL operating-system/device integration would implement
 * for the endpoint adapter SDK:
 *
 *   - a command execution surface   (typed per platform: PowerShell on
 *     Windows, shell + MDM profiles on macOS, shell + package manager on
 *     Linux, Apple MDM / Android Enterprise on mobile, SNMP + vendor API
 *     on printer/copier — each ALSO exposing the normalized `execute()`
 *     boundary the platform-agnostic adapter routes through),
 *   - observation sources           (typed per platform: WMI + event log on
 *     Windows, system_profiler + unified logging on macOS, procfs +
 *     journald on Linux, battery/OS/compliance/location evidence on
 *     mobile, consumables/page counts/error states on printer/copier —
 *     each ALSO exposing the normalized `poll()` boundary),
 *   - a capability probe            (`probe()` reports the frozen
 *     `AdapterCapabilities` the platform integration can actually back).
 *
 * This module declares the DESKTOP seam interfaces (W020) and the
 * platform identifiers/union (extended by W030). The mobile family seam
 * types live in `seams-mobile.ts`; the printer/copier seam types live in
 * `seams-printer.ts`. The in-memory deterministic reference
 * implementations live in `seams-inmemory.ts` (desktop, W020) and
 * `seams-inmemory-mobile.ts` / `seams-inmemory-printer.ts` (W030) —
 * tests only; no real OS/device integration is shipped in this lane.
 *
 * Platform-specific types stay INSIDE this package (the platform seam is
 * where platform meets the normalized capability surface by design); they
 * never enter the frozen core domain contracts
 * (ARCHITECTURE.md: "Provider-specific APIs/types never enter core domain
 * contracts" — enforced by the ownership gate).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 *
 * W030 note: `AdapterPlatform` and `ADAPTER_PLATFORMS` were EXTENDED with
 * the mobile (ios/ipados/android) and printer-copier family ids — the
 * family seams' typed boundaries live in `seams-mobile.ts` /
 * `seams-printer.ts` and join the `PlatformSeams` union below. The
 * generic network/IoT adapter boundary arrives with a later wave.
 */

import type { AdapterCapabilities, EvidenceRef } from "@fleetos/contracts";
import type { ObservationRecord } from "./observations";
import type { IosSeam, IpadOsSeam, AndroidSeam } from "./seams-mobile";
import type { PrinterCopierSeam } from "./seams-printer";

// ---------------------------------------------------------------------------
// D2.1 — Platform identifiers
// ---------------------------------------------------------------------------

/**
 * The endpoint platforms this SDK ships seam types for. W020 landed the
 * three desktop platforms named in `spec/ARCHITECTURE.md` § Device
 * adapters ("Initial adapter families: Windows, macOS, Linux"); W030
 * added the mobile family ids (iOS/iPadOS management, Android
 * Enterprise) and the printer/copier family id — a family id IS the
 * platform literal the family's seam is discriminated on. The generic
 * network/IoT adapter boundary arrives with a later wave.
 */
export type AdapterPlatform =
  | "windows"
  | "macos"
  | "linux"
  | "ios"
  | "ipados"
  | "android"
  | "printer-copier";

/**
 * The canonical list of platforms this SDK knows (frozen re-export for
 * manifests and validation).
 */
export const ADAPTER_PLATFORMS: readonly AdapterPlatform[] = Object.freeze([
  "windows",
  "macos",
  "linux",
  "ios",
  "ipados",
  "android",
  "printer-copier",
] as const);

// ---------------------------------------------------------------------------
// D2.2 — Normalized seam surfaces (platform-agnostic boundary)
// ---------------------------------------------------------------------------

/**
 * A normalized command request the platform seam executes. The payload is
 * OPAQUE to the SDK — the platform integration interprets it. The
 * capability names the normalized adapter capability the command belongs
 * to (see `spec/ARCHITECTURE.md` § Device adapters).
 */
export interface SeamCommandRequest {
  /** The normalized capability this command exercises. */
  readonly capability: keyof AdapterCapabilities;
  /** Opaque, JSON-serializable command payload. */
  readonly payload?: unknown;
}

/**
 * The failure detail a platform seam reports when a platform command
 * fails. `kind` is one of the execution failure kinds the lane maps onto
 * the FleetError taxonomy via `mapAgentFailure` (`commands.ts`).
 */
export interface SeamFailure {
  /** Machine-stable failure kind (mapped onto the FleetError taxonomy). */
  readonly kind: "adapter_internal" | "timeout" | "unknown";
  /** Human-readable failure message. */
  readonly message: string;
}

/**
 * The outcome of a platform command execution. Evidence references are
 * artifacts the platform integration produced (logs, transcripts) — the
 * control plane records that they exist, it does not interpret them.
 */
export interface SeamCommandResult {
  /** Terminal execution status. */
  readonly status: "succeeded" | "failed";
  /** Opaque, JSON-serializable output (absent on failure). */
  readonly output?: unknown;
  /** Evidence artifacts produced during execution. */
  readonly evidence: readonly EvidenceRef[];
  /** The failure detail (present iff status is "failed"). */
  readonly failure?: SeamFailure;
}

/**
 * The platform-agnostic command execution surface. Every platform channel
 * (Windows/macOS/Linux) extends this with its typed platform commands; the
 * normalized `execute()` is the single boundary the endpoint adapter
 * routes through.
 */
export interface SeamCommandExecutionSurface {
  /**
   * Execute a normalized capability command on the platform. The platform
   * implementation maps the capability to its native tooling (PowerShell,
   * profiles, package manager, ...) and returns a normalized result.
   */
  execute(request: SeamCommandRequest): SeamCommandResult;
}

/**
 * The platform-agnostic observation feed. Every platform observation
 * source set extends this with its typed platform sources; the normalized
 * `poll()` is the single boundary the endpoint adapter's `observe`
 * operation drains.
 */
export interface SeamObservationFeed {
  /**
   * Poll every configured observation source on the platform and return
   * the records observed. Deterministic given the seam's configuration.
   */
  poll(): readonly ObservationRecord[];
}

/**
 * A platform capability probe. `probe()` reports the frozen
 * `AdapterCapabilities` the platform integration can actually back right
 * now (management-tool availability, MDM enrollment, package manager
 * presence, ...). The probe is DISCOVERY, not authority: the adapter's
 * declared capability record remains the explicit support contract (see
 * `reconcileProbedCapabilities` in `adapter.ts`).
 */
export interface SeamCapabilityProbe {
  /** Stable probe identifier (for audit/manifests). */
  readonly probeId: string;
  /** Probe the platform's currently available capabilities. */
  probe(): AdapterCapabilities;
}

// ---------------------------------------------------------------------------
// D2.3 — Windows typed boundary
// ---------------------------------------------------------------------------

/**
 * A Windows PowerShell command issued through the Windows command channel.
 * The capability field ties the platform command back to the normalized
 * capability it implements (the seam is where platform meets the
 * normalized surface).
 */
export interface WindowsPowerShellCommand {
  /** The normalized capability this command implements. */
  readonly capability: keyof AdapterCapabilities;
  /** The PowerShell script to execute. */
  readonly script: string;
  /** Script arguments (canonical encodings of the opaque payload). */
  readonly arguments: readonly string[];
  /** Execution timeout in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * The Windows command execution surface: the normalized `execute()`
 * boundary plus the platform-typed PowerShell entry point a real Windows
 * integration implements.
 */
export interface WindowsCommandChannel extends SeamCommandExecutionSurface {
  /** Execute a PowerShell command on the endpoint. */
  runPowerShell(command: WindowsPowerShellCommand): SeamCommandResult;
}

/**
 * The Windows observation sources: the normalized `poll()` boundary plus
 * the platform-typed WMI and event-log entry points.
 */
export interface WindowsObservationSources extends SeamObservationFeed {
  /** Query WMI (e.g. `SELECT * FROM Win32_OperatingSystem`). */
  wmiQuery(query: string): readonly ObservationRecord[];
  /** Read Windows event-log records (e.g. log "Application"). */
  readEventLog(logName: string): readonly ObservationRecord[];
}

/**
 * The complete Windows platform seam.
 */
export interface WindowsSeam {
  readonly platform: "windows";
  readonly commands: WindowsCommandChannel;
  readonly observationSources: WindowsObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

// ---------------------------------------------------------------------------
// D2.4 — macOS typed boundary
// ---------------------------------------------------------------------------

/**
 * A macOS shell command issued through the macOS command channel.
 */
export interface MacOsShellCommand {
  /** The normalized capability this command implements. */
  readonly capability: keyof AdapterCapabilities;
  /** The shell script to execute. */
  readonly script: string;
  /** Script arguments (canonical encodings of the opaque payload). */
  readonly arguments: readonly string[];
  /** Execution timeout in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * A macOS MDM profiles command issued through the macOS command channel.
 * Used by capabilities that act through managed preferences (`profiles`
 * tooling) rather than shell: `enforce`, `update`.
 */
export interface MacOsProfilesCommand {
  /** The normalized capability this command implements. */
  readonly capability: keyof AdapterCapabilities;
  /** The profiles sub-command. */
  readonly command: "install" | "remove" | "list";
  /** The profile identifier (reverse-DNS). */
  readonly identifier: string;
}

/**
 * The macOS command execution surface: the normalized `execute()``
 * boundary plus the platform-typed shell and MDM profiles entry points.
 */
export interface MacOsCommandChannel extends SeamCommandExecutionSurface {
  /** Execute a shell script on the endpoint. */
  runShellScript(command: MacOsShellCommand): SeamCommandResult;
  /** Execute an MDM `profiles` command on the endpoint. */
  runProfilesCommand(command: MacOsProfilesCommand): SeamCommandResult;
}

/**
 * The macOS observation sources: the normalized `poll()` boundary plus the
 * platform-typed system_profiler and unified-logging entry points.
 */
export interface MacOsObservationSources extends SeamObservationFeed {
  /** Run `system_profiler` for a report type (e.g. "SPHardwareDataType"). */
  systemProfiler(report: string): readonly ObservationRecord[];
  /** Tail the unified logging system filtered by a predicate. */
  unifiedLogTail(predicate: string): readonly ObservationRecord[];
}

/**
 * The complete macOS platform seam.
 */
export interface MacOsSeam {
  readonly platform: "macos";
  readonly commands: MacOsCommandChannel;
  readonly observationSources: MacOsObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

// ---------------------------------------------------------------------------
// D2.5 — Linux typed boundary
// ---------------------------------------------------------------------------

/**
 * A Linux shell command issued through the Linux command channel.
 */
export interface LinuxShellCommand {
  /** The normalized capability this command implements. */
  readonly capability: keyof AdapterCapabilities;
  /** The shell script to execute. */
  readonly script: string;
  /** Script arguments (canonical encodings of the opaque payload). */
  readonly arguments: readonly string[];
  /** Execution timeout in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * A Linux package-manager command issued through the Linux command
 * channel. Used by capabilities that act through the distribution's
 * package manager rather than shell: `update` (and `remediate` where a
 * package fix is available).
 */
export interface LinuxPackageManagerCommand {
  /** The normalized capability this command implements. */
  readonly capability: keyof AdapterCapabilities;
  /** The distribution package manager. */
  readonly manager: "apt" | "dnf" | "pacman";
  /** The package-manager action. */
  readonly action: "install" | "remove" | "upgrade";
  /** The package names the action targets. */
  readonly packages: readonly string[];
}

/**
 * The Linux command execution surface: the normalized `execute()`
 * boundary plus the platform-typed shell and package-manager entry
 * points.
 */
export interface LinuxCommandChannel extends SeamCommandExecutionSurface {
  /** Execute a shell command on the endpoint. */
  runShell(command: LinuxShellCommand): SeamCommandResult;
  /** Execute a package-manager command on the endpoint. */
  runPackageManager(command: LinuxPackageManagerCommand): SeamCommandResult;
}

/**
 * The Linux observation sources: the normalized `poll()` boundary plus
 * the platform-typed procfs and journald entry points.
 */
export interface LinuxObservationSources extends SeamObservationFeed {
  /** Snapshot a procfs file (e.g. "/proc/meminfo"). */
  procfsSnapshot(path: string): readonly ObservationRecord[];
  /** Tail journald entries for a unit (e.g. "fleetos.service"). */
  journalctlTail(unit: string): readonly ObservationRecord[];
}

/**
 * The complete Linux platform seam.
 */
export interface LinuxSeam {
  readonly platform: "linux";
  readonly commands: LinuxCommandChannel;
  readonly observationSources: LinuxObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

// ---------------------------------------------------------------------------
// D2.6 — The platform seam union
// ---------------------------------------------------------------------------

/**
 * The union of the platform seams this SDK defines. Discriminated by the
 * `platform` literal; the endpoint adapter validates that the seam's
 * platform matches its descriptor's platform at construction.
 *
 * W030: the union grew by the mobile family seams (iOS / iPadOS /
 * Android — `seams-mobile.ts`) and the printer/copier seam
 * (`seams-printer.ts`). The W020 desktop members are unchanged.
 */
export type PlatformSeams =
  | WindowsSeam
  | MacOsSeam
  | LinuxSeam
  | IosSeam
  | IpadOsSeam
  | AndroidSeam
  | PrinterCopierSeam;

/**
 * Pure predicate: is the given value a platform this SDK knows?
 */
export function isAdapterPlatform(value: string): value is AdapterPlatform {
  return ADAPTER_PLATFORMS.includes(value as AdapterPlatform);
}
