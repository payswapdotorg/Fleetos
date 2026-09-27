/**
 * W020 D2 tests — platform seam types + in-memory deterministic reference
 * implementations (Windows/macOS/Linux).
 *
 * Verifies:
 *   - the normalized `execute()` routes to the platform-typed methods
 *     (PowerShell on Windows; MDM profiles for enforce/update and shell
 *     otherwise on macOS; package manager for update and shell otherwise
 *     on Linux),
 *   - scripted outcomes (success + failure) are honored deterministically,
 *   - observation sources return scripted records; `poll()` aggregates
 *     both platform sources,
 *   - the capability probe returns the scripted (frozen) capabilities,
 *   - invocation recording (`calls()` / `reset()`) works,
 *   - byte-identical determinism across constructions.
 */

import { describe, expect, test } from "bun:test";
import {
  createInMemoryLinuxSeam,
  createInMemoryMacOsSeam,
  createInMemoryWindowsSeam,
  LINUX_DEFAULT_JOURNALCTL_UNIT,
  LINUX_DEFAULT_PROCFS_PATH,
  MACOS_DEFAULT_LOG_PREDICATE,
  MACOS_DEFAULT_PROFILER_REPORT,
  WINDOWS_DEFAULT_EVENT_LOG,
  WINDOWS_DEFAULT_WMI_QUERY,
  type InMemorySeamOptions,
} from "../src/seams-inmemory";
import { isAdapterPlatform } from "../src/seams";
import type { ObservationRecord } from "../src/observations";

function record(kind: string, idx: number): ObservationRecord {
  return {
    kind,
    observedAt: "2026-01-01T00:00:00Z",
    schemaVersion: 1,
    payload: { idx, sample: `w020-${idx}` },
  };
}

describe("W020 D2: Windows in-memory seam", () => {
  test("platform tag is windows", () => {
    const seam = createInMemoryWindowsSeam();
    expect(seam.platform).toBe("windows");
  });

  test("execute routes through runPowerShell (typed boundary recorded)", () => {
    const seam = createInMemoryWindowsSeam();
    const result = seam.commands.execute({ capability: "lock", payload: { reason: "test" } });
    expect(result.status).toBe("succeeded");
    const methods = seam.calls().map((call) => `${call.surface}.${call.method}`);
    expect(methods).toEqual(["commands.execute", "commands.runPowerShell"]);
    const powerShellCall = seam.calls()[1];
    const command = powerShellCall.detail as { capability: string; script: string; arguments: string[] };
    expect(command.capability).toBe("lock");
    expect(command.script).toContain("lock");
    expect(command.arguments).toEqual(['{"reason":"test"}']);
  });

  test("execute with no payload passes empty arguments", () => {
    const seam = createInMemoryWindowsSeam();
    seam.commands.execute({ capability: "health" });
    const command = seam.calls()[1].detail as { arguments: string[] };
    expect(command.arguments).toEqual([]);
  });

  test("scripted failure is honored with kind + message", () => {
    const seam = createInMemoryWindowsSeam({
      commandOutcomes: [
        { capability: "wipe", status: "failed", failureKind: "timeout", message: "timed out" },
      ],
    });
    const result = seam.commands.execute({ capability: "wipe" });
    expect(result.status).toBe("failed");
    expect(result.failure?.kind).toBe("timeout");
    expect(result.failure?.message).toBe("timed out");
    expect(result.evidence.length).toBe(1);
  });

  test("unscripted capability succeeds with a deterministic default output", () => {
    const seam = createInMemoryWindowsSeam();
    const first = seam.commands.execute({ capability: "identify" });
    expect(first.status).toBe("succeeded");
    const output = first.output as { platform: string; capability: string };
    expect(output.platform).toBe("windows");
    expect(output.capability).toBe("identify");
    // Deterministic: the same request produces the identical result.
    const second = seam.commands.execute({ capability: "identify" });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("evidence is content-addressed and deterministic", () => {
    const seam = createInMemoryWindowsSeam();
    const a = seam.commands.execute({ capability: "reboot" });
    const other = createInMemoryWindowsSeam();
    const b = other.commands.execute({ capability: "reboot" });
    expect(a.evidence.length).toBe(1);
    expect(b.evidence.length).toBe(1);
    expect(a.evidence[0]).toEqual(b.evidence[0]);
    expect(a.evidence[0].hashAlgorithm).toBe("fnv1a32");
    expect(a.evidence[0].key).toContain("seam://windows/reboot/");
    // Different request => different hash.
    const c = seam.commands.execute({ capability: "reboot", payload: { x: 1 } });
    expect(c.evidence[0].hash).not.toBe(a.evidence[0].hash);
  });

  test("wmiQuery and readEventLog return the scripted records; poll aggregates both", () => {
    const options: InMemorySeamOptions = {
      primaryObservations: [record("device.health", 1)],
      secondaryObservations: [record("device.security", 2), record("device.security", 3)],
    };
    const seam = createInMemoryWindowsSeam(options);
    expect(seam.observationSources.wmiQuery(WINDOWS_DEFAULT_WMI_QUERY)).toHaveLength(1);
    expect(seam.observationSources.readEventLog(WINDOWS_DEFAULT_EVENT_LOG)).toHaveLength(2);
    const polled = seam.observationSources.poll();
    expect(polled).toHaveLength(3);
    expect(polled[0].kind).toBe("device.health");
    expect(polled[2].kind).toBe("device.security");
    const methods = seam.calls().map((call) => `${call.surface}.${call.method}`);
    expect(methods).toEqual([
      "observations.wmiQuery",
      "observations.readEventLog",
      "observations.poll",
      "observations.wmiQuery",
      "observations.readEventLog",
    ]);
  });

  test("calls() records in order; reset() clears the recording", () => {
    const seam = createInMemoryWindowsSeam();
    seam.commands.execute({ capability: "health" });
    expect(seam.calls().length).toBe(2);
    seam.reset();
    expect(seam.calls().length).toBe(0);
    // Scripted data survives a reset.
    seam.commands.execute({ capability: "health" });
    expect(seam.calls().length).toBe(2);
  });
});

describe("W020 D2: macOS in-memory seam", () => {
  test("platform tag is macos; enforce routes through MDM profiles, not shell", () => {
    const seam = createInMemoryMacOsSeam();
    expect(seam.platform).toBe("macos");
    seam.commands.execute({ capability: "enforce" });
    const methods = seam.calls().map((call) => call.method);
    expect(methods).toEqual(["execute", "runProfilesCommand"]);
    const profiles = seam.calls()[1].detail as { capability: string; command: string; identifier: string };
    expect(profiles.capability).toBe("enforce");
    expect(profiles.command).toBe("install");
    expect(profiles.identifier).toBe("org.fleetos.enforce");
  });

  test("update routes through MDM profiles on macOS", () => {
    const seam = createInMemoryMacOsSeam();
    seam.commands.execute({ capability: "update" });
    expect(seam.calls().map((call) => call.method)).toEqual(["execute", "runProfilesCommand"]);
  });

  test("non-management capabilities route through the shell", () => {
    const seam = createInMemoryMacOsSeam();
    const result = seam.commands.execute({ capability: "lock", payload: { pin: 4 } });
    expect(result.status).toBe("succeeded");
    expect(seam.calls().map((call) => call.method)).toEqual(["execute", "runShellScript"]);
    const shell = seam.calls()[1].detail as { script: string };
    expect(shell.script).toContain("lock");
  });

  test("systemProfiler and unifiedLogTail return scripted records; poll aggregates", () => {
    const seam = createInMemoryMacOsSeam({
      primaryObservations: [record("device.identity", 1)],
      secondaryObservations: [record("device.power", 2)],
    });
    expect(seam.observationSources.systemProfiler(MACOS_DEFAULT_PROFILER_REPORT)).toHaveLength(1);
    expect(seam.observationSources.unifiedLogTail(MACOS_DEFAULT_LOG_PREDICATE)).toHaveLength(1);
    expect(seam.observationSources.poll()).toHaveLength(2);
  });
});

describe("W020 D2: Linux in-memory seam", () => {
  test("platform tag is linux; update routes through the package manager", () => {
    const seam = createInMemoryLinuxSeam();
    expect(seam.platform).toBe("linux");
    seam.commands.execute({ capability: "update" });
    expect(seam.calls().map((call) => call.method)).toEqual(["execute", "runPackageManager"]);
    const pkg = seam.calls()[1].detail as { manager: string; action: string; packages: string[] };
    expect(pkg.manager).toBe("apt");
    expect(pkg.action).toBe("upgrade");
    expect(pkg.packages).toEqual([]);
  });

  test("non-update capabilities route through the shell", () => {
    const seam = createInMemoryLinuxSeam();
    const result = seam.commands.execute({ capability: "reboot" });
    expect(result.status).toBe("succeeded");
    expect(seam.calls().map((call) => call.method)).toEqual(["execute", "runShell"]);
  });

  test("procfsSnapshot and journalctlTail return scripted records; poll aggregates", () => {
    const seam = createInMemoryLinuxSeam({
      primaryObservations: [record("device.storage", 1)],
      secondaryObservations: [record("device.network", 2), record("device.network", 3)],
    });
    expect(seam.observationSources.procfsSnapshot(LINUX_DEFAULT_PROCFS_PATH)).toHaveLength(1);
    expect(seam.observationSources.journalctlTail(LINUX_DEFAULT_JOURNALCTL_UNIT)).toHaveLength(2);
    expect(seam.observationSources.poll()).toHaveLength(3);
  });
});

describe("W020 D2: capability probes", () => {
  test("probe returns the scripted capabilities (frozen copy)", () => {
    const seam = createInMemoryWindowsSeam({
      probedCapabilities: { observe: true, health: true },
    });
    const probed = seam.capabilityProbe.probe();
    expect(probed.observe).toBe(true);
    expect(probed.health).toBe(true);
    expect(probed.wipe).toBeUndefined();
    // Frozen: mutating the returned probe does not corrupt the seam.
    expect(Object.isFrozen(probed)).toBe(true);
  });

  test("probe defaults to no capabilities", () => {
    const seam = createInMemoryLinuxSeam();
    const probed = seam.capabilityProbe.probe();
    expect(Object.keys(probed)).toEqual([]);
    expect(seam.capabilityProbe.probeId).toBe("inmemory-linux-probe");
  });
});

describe("W020 D2: cross-platform determinism", () => {
  test("two fakes with the same options behave identically (byte-for-byte)", () => {
    const options: InMemorySeamOptions = {
      commandOutcomes: [{ capability: "lock", status: "succeeded", output: { locked: true } }],
      primaryObservations: [record("device.health", 1)],
      secondaryObservations: [record("device.security", 2)],
      probedCapabilities: { lock: true },
    };
    for (const [name, create] of [
      ["windows", createInMemoryWindowsSeam],
      ["macos", createInMemoryMacOsSeam],
      ["linux", createInMemoryLinuxSeam],
    ] as const) {
      const a = create(options);
      const b = create(options);
      const resultA = a.commands.execute({ capability: "lock", payload: { v: 1 } });
      const resultB = b.commands.execute({ capability: "lock", payload: { v: 1 } });
      expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
      const pollA = JSON.stringify(a.observationSources.poll());
      const pollB = JSON.stringify(b.observationSources.poll());
      expect(pollA).toBe(pollB);
      expect(JSON.stringify(a.capabilityProbe.probe())).toBe(JSON.stringify(b.capabilityProbe.probe()));
      expect(a.platform).toBe(name);
    }
  });

  test("isAdapterPlatform accepts the SDK platforms (desktop + W030 families) and nothing else", () => {
    expect(isAdapterPlatform("windows")).toBe(true);
    expect(isAdapterPlatform("macos")).toBe(true);
    expect(isAdapterPlatform("linux")).toBe(true);
    // W030: the mobile + printer/copier family ids joined the union.
    expect(isAdapterPlatform("ios")).toBe(true);
    expect(isAdapterPlatform("ipados")).toBe(true);
    expect(isAdapterPlatform("android")).toBe(true);
    expect(isAdapterPlatform("printer-copier")).toBe(true);
    // Unknown/typo platforms stay refused.
    expect(isAdapterPlatform("printer")).toBe(false);
    expect(isAdapterPlatform("network-iot")).toBe(false);
    expect(isAdapterPlatform("sunos")).toBe(false);
  });
});
