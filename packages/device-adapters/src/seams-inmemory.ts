/**
 * @fleetos/device-adapters — W020 D2: In-memory reference seam
 * implementations (deterministic fakes).
 *
 * Reference implementations of the Windows/macOS/Linux platform seams.
 * There is NO real operating-system integration in this lane: every
 * method is an in-memory, deterministic fake suitable for tests and for
 * wiring the SDK surface end-to-end. A production integration implements
 * the typed seam interfaces against the real platform tooling (a later
 * infrastructure wave).
 *
 * Determinism rules (mirrors the contracts/testing module):
 *   - No clock reads, no entropy: every value is a pure function of the
 *     construction options and the request.
 *   - Evidence references are content-addressed over the canonical JSON
 *     of the platform command (FNV-1a digest — a test hash, never for
 *     security).
 *   - Two fakes constructed with the same options behave identically,
 *     byte-for-byte.
 *
 * Scripting model:
 *   - `commandOutcomes` scripts per-capability results (first match
 *     wins). A capability with no scripted outcome succeeds with a
 *     deterministic default output.
 *   - `primaryObservations` / `secondaryObservations` script the records
 *     the platform's two typed observation sources return (WMI /
 *     event-log on Windows; system_profiler / unified log on macOS;
 *     procfs / journald on Linux).
 *   - `probedCapabilities` scripts the capability probe result.
 *
 * Every fake records its invocations (`calls()`) so tests can prove the
 * SDK never reaches the seam on refusal — the "unsupported destructive
 * behavior may never be emulated" invariant.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapabilities, EvidenceRef } from "@fleetos/contracts";
import {
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
} from "./internal";
import type { AdapterPlatform, SeamCommandRequest, SeamCommandResult } from "./seams";
import type {
  LinuxCommandChannel,
  LinuxObservationSources,
  LinuxPackageManagerCommand,
  LinuxSeam,
  LinuxShellCommand,
  MacOsCommandChannel,
  MacOsObservationSources,
  MacOsProfilesCommand,
  MacOsSeam,
  MacOsShellCommand,
  WindowsCommandChannel,
  WindowsObservationSources,
  WindowsPowerShellCommand,
  WindowsSeam,
} from "./seams";
import type { ObservationRecord } from "./observations";

// ---------------------------------------------------------------------------
// Options + scripted outcomes
// ---------------------------------------------------------------------------

/**
 * A scripted platform-command outcome, matched by capability (first
 * match wins). Capabilities without a scripted outcome succeed with a
 * deterministic default output.
 */
export interface ScriptedSeamOutcome {
  /** The capability this scripted outcome applies to. */
  readonly capability: keyof AdapterCapabilities;
  /** The scripted status. */
  readonly status: "succeeded" | "failed";
  /**
   * The failure kind reported on failure (default: "adapter_internal").
   * Mapped onto the FleetError taxonomy by the adapter.
   */
  readonly failureKind?: "adapter_internal" | "timeout" | "unknown";
  /** The failure message (default: a deterministic message). */
  readonly message?: string;
  /** The opaque output returned on success. */
  readonly output?: unknown;
}

/**
 * Options shared by the three in-memory platform seams.
 */
export interface InMemorySeamOptions {
  /** Scripted command outcomes, matched by capability (first match wins). */
  readonly commandOutcomes?: readonly ScriptedSeamOutcome[];
  /**
   * Records returned by the platform's PRIMARY observation source (WMI on
   * Windows, system_profiler on macOS, procfs on Linux).
   */
  readonly primaryObservations?: readonly ObservationRecord[];
  /**
   * Records returned by the platform's SECONDARY observation source
   * (event log on Windows, unified log on macOS, journald on Linux).
   */
  readonly secondaryObservations?: readonly ObservationRecord[];
  /**
   * The capability set the probe reports (default: no capabilities —
   * explicit, not implicit).
   */
  readonly probedCapabilities?: AdapterCapabilities;
}

/**
 * A recorded seam invocation, in call order. `detail` carries the request
 * (command, query, report, path, ...) verbatim.
 */
export interface SeamCallRecord {
  /** Which seam surface was invoked. */
  readonly surface: "commands" | "observations" | "probe";
  /** The platform method invoked. */
  readonly method: string;
  /** The invocation's input, verbatim (opaque). */
  readonly detail: unknown;
}

// ---------------------------------------------------------------------------
// Shared machinery (pure helpers, no platform state)
// ---------------------------------------------------------------------------

/**
 * The extended surface every in-memory fake exposes BEYOND its platform
 * seam: invocation recording for test assertions.
 */
export interface InMemorySeamRecording {
  /** The recorded invocations so far, in call order. */
  calls(): readonly SeamCallRecord[];
  /** Clear the recorded invocations (scripted data is preserved). */
  reset(): void;
}

/** The in-memory Windows seam (platform seam + invocation recording). */
export interface InMemoryWindowsSeam extends WindowsSeam, InMemorySeamRecording {}

/** The in-memory macOS seam (platform seam + invocation recording). */
export interface InMemoryMacOsSeam extends MacOsSeam, InMemorySeamRecording {}

/** The in-memory Linux seam (platform seam + invocation recording). */
export interface InMemoryLinuxSeam extends LinuxSeam, InMemorySeamRecording {}

interface Recorder {
  readonly records: SeamCallRecord[];
}

function record(recorder: Recorder, surface: SeamCallRecord["surface"], method: string, detail: unknown): void {
  recorder.records.push({ surface, method, detail });
}

function snapshot(recorder: Recorder): readonly SeamCallRecord[] {
  return frozenArray(recorder.records);
}

function resetRecorder(recorder: Recorder): void {
  recorder.records.length = 0;
}

/**
 * Content-addressed evidence for a platform command. Deterministic: the
 * hash is the FNV-1a digest of the canonical JSON of
 * `{ capability, command }`. FNV-1a is a TEST hash — never for security
 * (the production seam hashes with sha256; the ref doc of the contracts
 * EvidenceRef carries the algorithm name so this stays explicit).
 */
function evidenceFor(
  platform: AdapterPlatform,
  capability: keyof AdapterCapabilities,
  command: unknown,
): EvidenceRef {
  const canonical = canonicalJson({ capability, command });
  const hash = fnv1a32Hex(canonical);
  return frozen<EvidenceRef>({
    key: `seam://${platform}/${capability as string}/${hash}`,
    sizeBytes: canonical.length,
    hash,
    hashAlgorithm: "fnv1a32",
  });
}

/**
 * Resolve the scripted outcome for a capability (first match wins).
 */
function scriptedOutcomeFor(
  outcomes: readonly ScriptedSeamOutcome[],
  capability: keyof AdapterCapabilities,
): ScriptedSeamOutcome | undefined {
  return outcomes.find((outcome) => outcome.capability === capability);
}

/**
 * Build the normalized platform-command result for a typed platform
 * command. Pure function of (platform, capability, canonical command,
 * scripted outcomes): deterministic, no state.
 */
function resultFor(
  platform: AdapterPlatform,
  capability: keyof AdapterCapabilities,
  command: unknown,
  outcomes: readonly ScriptedSeamOutcome[],
): SeamCommandResult {
  const evidence = frozenArray([evidenceFor(platform, capability, command)]);
  const scripted = scriptedOutcomeFor(outcomes, capability);
  if (scripted !== undefined && scripted.status === "failed") {
    return frozen({
      status: "failed" as const,
      evidence,
      failure: frozen({
        kind: scripted.failureKind ?? "adapter_internal",
        message: scripted.message ?? `scripted failure for capability "${capability as string}" on ${platform}`,
      }),
    });
  }
  return frozen({
    status: "succeeded" as const,
    evidence,
    output: frozen({
      platform,
      capability,
      scripted: scripted !== undefined,
      command,
    }),
  });
}

/** Frozen copy of the scripted observation records (persistent fixtures). */
function observationsCopy(records: readonly ObservationRecord[]): readonly ObservationRecord[] {
  return frozenArray(records);
}

function probeFor(
  platform: AdapterPlatform,
  recorder: Recorder,
  probed: AdapterCapabilities | undefined,
): { probeId: string; probe(): AdapterCapabilities } {
  return frozen({
    probeId: `inmemory-${platform}-probe`,
    probe: (): AdapterCapabilities => {
      record(recorder, "probe", "probe", null);
      return frozen({ ...probed }) as AdapterCapabilities;
    },
  });
}

// ---------------------------------------------------------------------------
// Windows — in-memory reference implementation
// ---------------------------------------------------------------------------

/** The default WMI query the normalized `poll()` drains. */
export const WINDOWS_DEFAULT_WMI_QUERY = "SELECT * FROM Win32_OperatingSystem" as const;

/** The default event log the normalized `poll()` drains. */
export const WINDOWS_DEFAULT_EVENT_LOG = "Application" as const;

/**
 * Create an in-memory deterministic Windows seam. No real OS integration:
 * `runPowerShell` returns scripted outcomes; `wmiQuery`/`readEventLog`
 * return scripted records; `probe()` returns the scripted capabilities.
 * Every invocation is recorded (see `calls()`).
 */
export function createInMemoryWindowsSeam(options: InMemorySeamOptions = {}): InMemoryWindowsSeam {
  const recorder: Recorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];
  const primary = options.primaryObservations ?? [];
  const secondary = options.secondaryObservations ?? [];

  function runPowerShell(command: WindowsPowerShellCommand): SeamCommandResult {
    record(recorder, "commands", "runPowerShell", command);
    return resultFor("windows", command.capability, command, outcomes);
  }

  const commands: WindowsCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      record(recorder, "commands", "execute", request);
      const arguments_ =
        request.payload === undefined ? [] : [canonicalJson(request.payload)];
      return runPowerShell({
        capability: request.capability,
        script: `Invoke-FleetOSCapability -Capability '${request.capability as string}'`,
        arguments: frozenArray(arguments_),
        timeoutMs: 30_000,
      });
    },
    runPowerShell,
  });

  function wmiQuery(query: string): readonly ObservationRecord[] {
    record(recorder, "observations", "wmiQuery", query);
    return observationsCopy(primary);
  }

  function readEventLog(logName: string): readonly ObservationRecord[] {
    record(recorder, "observations", "readEventLog", logName);
    return observationsCopy(secondary);
  }

  const observationSources: WindowsObservationSources = frozen({
    poll: (): readonly ObservationRecord[] => {
      record(recorder, "observations", "poll", null);
      return frozenArray([...wmiQuery(WINDOWS_DEFAULT_WMI_QUERY), ...readEventLog(WINDOWS_DEFAULT_EVENT_LOG)]);
    },
    wmiQuery,
    readEventLog,
  });

  return frozen({
    platform: "windows" as const,
    commands,
    observationSources,
    capabilityProbe: probeFor("windows", recorder, options.probedCapabilities),
    calls: () => snapshot(recorder),
    reset: () => resetRecorder(recorder),
  }) as InMemoryWindowsSeam;
}

// ---------------------------------------------------------------------------
// macOS — in-memory reference implementation
// ---------------------------------------------------------------------------

/** The default system_profiler report the normalized `poll()` drains. */
export const MACOS_DEFAULT_PROFILER_REPORT = "SPHardwareDataType" as const;

/** The default unified-log predicate the normalized `poll()` drains. */
export const MACOS_DEFAULT_LOG_PREDICATE = "process == 'fleetosd'" as const;

/**
 * Create an in-memory deterministic macOS seam. `runShellScript` and
 * `runProfilesCommand` return scripted outcomes; `systemProfiler`/
 * `unifiedLogTail` return scripted records; `probe()` returns the
 * scripted capabilities. The normalized `execute()` routes
 * `enforce`/`update` through `runProfilesCommand` and everything else
 * through `runShellScript`.
 */
export function createInMemoryMacOsSeam(options: InMemorySeamOptions = {}): InMemoryMacOsSeam {
  const recorder: Recorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];
  const primary = options.primaryObservations ?? [];
  const secondary = options.secondaryObservations ?? [];

  function runShellScript(command: MacOsShellCommand): SeamCommandResult {
    record(recorder, "commands", "runShellScript", command);
    return resultFor("macos", command.capability, command, outcomes);
  }

  function runProfilesCommand(command: MacOsProfilesCommand): SeamCommandResult {
    record(recorder, "commands", "runProfilesCommand", command);
    return resultFor("macos", command.capability, command, outcomes);
  }

  const commands: MacOsCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      record(recorder, "commands", "execute", request);
      if (request.capability === "enforce" || request.capability === "update") {
        // macOS routes state-mutating management capabilities through MDM
        // profiles, not shell.
        return runProfilesCommand({
          capability: request.capability,
          command: "install",
          identifier: `org.fleetos.${request.capability as string}`,
        });
      }
      const arguments_ =
        request.payload === undefined ? [] : [canonicalJson(request.payload)];
      return runShellScript({
        capability: request.capability,
        script: `fleetos ${request.capability as string}`,
        arguments: frozenArray(arguments_),
        timeoutMs: 30_000,
      });
    },
    runShellScript,
    runProfilesCommand,
  });

  function systemProfiler(report: string): readonly ObservationRecord[] {
    record(recorder, "observations", "systemProfiler", report);
    return observationsCopy(primary);
  }

  function unifiedLogTail(predicate: string): readonly ObservationRecord[] {
    record(recorder, "observations", "unifiedLogTail", predicate);
    return observationsCopy(secondary);
  }

  const observationSources: MacOsObservationSources = frozen({
    poll: (): readonly ObservationRecord[] => {
      record(recorder, "observations", "poll", null);
      return frozenArray([...systemProfiler(MACOS_DEFAULT_PROFILER_REPORT), ...unifiedLogTail(MACOS_DEFAULT_LOG_PREDICATE)]);
    },
    systemProfiler,
    unifiedLogTail,
  });

  return frozen({
    platform: "macos" as const,
    commands,
    observationSources,
    capabilityProbe: probeFor("macos", recorder, options.probedCapabilities),
    calls: () => snapshot(recorder),
    reset: () => resetRecorder(recorder),
  }) as InMemoryMacOsSeam;
}

// ---------------------------------------------------------------------------
// Linux — in-memory reference implementation
// ---------------------------------------------------------------------------

/** The default procfs path the normalized `poll()` drains. */
export const LINUX_DEFAULT_PROCFS_PATH = "/proc/meminfo" as const;

/** The default journald unit the normalized `poll()` drains. */
export const LINUX_DEFAULT_JOURNALCTL_UNIT = "fleetos.service" as const;

/**
 * Create an in-memory deterministic Linux seam. `runShell` and
 * `runPackageManager` return scripted outcomes; `procfsSnapshot`/
 * `journalctlTail` return scripted records; `probe()` returns the
 * scripted capabilities. The normalized `execute()` routes `update`
 * through `runPackageManager` and everything else through `runShell`.
 */
export function createInMemoryLinuxSeam(options: InMemorySeamOptions = {}): InMemoryLinuxSeam {
  const recorder: Recorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];
  const primary = options.primaryObservations ?? [];
  const secondary = options.secondaryObservations ?? [];

  function runShell(command: LinuxShellCommand): SeamCommandResult {
    record(recorder, "commands", "runShell", command);
    return resultFor("linux", command.capability, command, outcomes);
  }

  function runPackageManager(command: LinuxPackageManagerCommand): SeamCommandResult {
    record(recorder, "commands", "runPackageManager", command);
    return resultFor("linux", command.capability, command, outcomes);
  }

  const commands: LinuxCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      record(recorder, "commands", "execute", request);
      if (request.capability === "update") {
        // Linux routes software-update capability through the
        // distribution's package manager.
        return runPackageManager({
          capability: request.capability,
          manager: "apt",
          action: "upgrade",
          packages: frozenArray([]),
        });
      }
      const arguments_ =
        request.payload === undefined ? [] : [canonicalJson(request.payload)];
      return runShell({
        capability: request.capability,
        script: `fleetos ${request.capability as string}`,
        arguments: frozenArray(arguments_),
        timeoutMs: 30_000,
      });
    },
    runShell,
    runPackageManager,
  });

  function procfsSnapshot(path: string): readonly ObservationRecord[] {
    record(recorder, "observations", "procfsSnapshot", path);
    return observationsCopy(primary);
  }

  function journalctlTail(unit: string): readonly ObservationRecord[] {
    record(recorder, "observations", "journalctlTail", unit);
    return observationsCopy(secondary);
  }

  const observationSources: LinuxObservationSources = frozen({
    poll: (): readonly ObservationRecord[] => {
      record(recorder, "observations", "poll", null);
      return frozenArray([...procfsSnapshot(LINUX_DEFAULT_PROCFS_PATH), ...journalctlTail(LINUX_DEFAULT_JOURNALCTL_UNIT)]);
    },
    procfsSnapshot,
    journalctlTail,
  });

  return frozen({
    platform: "linux" as const,
    commands,
    observationSources,
    capabilityProbe: probeFor("linux", recorder, options.probedCapabilities),
    calls: () => snapshot(recorder),
    reset: () => resetRecorder(recorder),
  }) as InMemoryLinuxSeam;
}
