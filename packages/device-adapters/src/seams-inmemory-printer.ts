/**
 * @fleetos/device-adapters — W030 D3: In-memory reference PRINTER/COPIER
 * family seam (deterministic fake).
 *
 * Reference implementation of the printer/copier seam (SNMP channel +
 * vendor boundary + consumable/usage observation sources). There is NO
 * real network/device I/O in this lane: SNMP and the vendor API are
 * CONTRACT boundaries — every method is an in-memory, deterministic
 * fake suitable for tests and for wiring the family surface end-to-end.
 * A production connector implements the typed seam interfaces against
 * real SNMP/vendor tooling (a later infrastructure wave).
 *
 * Determinism rules (mirrors the W020 fakes): no clock, no entropy;
 * evidence is content-addressed over the canonical JSON of the typed
 * family command (FNV-1a — a test hash, never for security); two fakes
 * built with the same options behave identically, byte-for-byte.
 *
 * Payload contract enforcement: the normalized `execute()` parses the
 * opaque payload with `parsePrinterCommandPayload` (the D2 payload
 * contracts) and routes it to the typed SNMP/vendor command. A
 * malformed payload FAILS CLOSED — a failed platform command, never an
 * emulated success. `identify` / `health` accept an optional payload
 * (defaulting to the standard device OIDs); `diagnose` requires one.
 * Every invocation is recorded (`calls()`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapabilities } from "@fleetos/contracts";
import type { AdapterCapability } from "./adapter";
import { frozen, frozenArray } from "./internal";
import type { ObservationRecord } from "./observations";
import { parsePrinterCommandPayload } from "./printer-commands";
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
  PrinterCopierCommandChannel,
  PrinterCopierObservationSources,
  PrinterCopierSeam,
  SnmpGetCommand,
  SnmpSetCommand,
  VendorPrinterCommand,
} from "./seams-printer";

// ---------------------------------------------------------------------------
// Options + defaults
// ---------------------------------------------------------------------------

/**
 * Options for the in-memory printer/copier seam. The scripted records
 * should be assembled with the printer observation record builders
 * (`printerConsumableRecord`, ... in `printer-observations.ts`).
 */
export interface InMemoryPrinterCopierSeamOptions {
  /** Scripted command outcomes, matched by capability (first match wins). */
  readonly commandOutcomes?: readonly ScriptedSeamOutcome[];
  /** Records returned by the consumables source (kind `printer.consumable`). */
  readonly consumableObservations?: readonly ObservationRecord[];
  /** Records returned by the page counts source (kind `printer.page-counts`). */
  readonly pageCountObservations?: readonly ObservationRecord[];
  /** Records returned by the error states source (kind `printer.error-state`). */
  readonly errorStateObservations?: readonly ObservationRecord[];
  /** The capability set the probe reports (default: none — explicit). */
  readonly probedCapabilities?: AdapterCapabilities;
}

/**
 * The default OIDs the identify/health capabilities query when no
 * payload is supplied: the SNMPv2-MIB device identity pair
 * (sysDescr.0, sysName.0).
 */
export const DEFAULT_SNMP_DEVICE_OIDS: readonly string[] = frozenArray([
  "1.3.6.1.2.1.1.1.0",
  "1.3.6.1.2.1.1.5.0",
]);

/** The in-memory printer/copier seam (seam + invocation recording). */
export interface InMemoryPrinterCopierSeam extends PrinterCopierSeam, InMemorySeamRecording {}

// ---------------------------------------------------------------------------
// Command mapping
// ---------------------------------------------------------------------------

/** A mapped typed printer/copier command (exactly one channel). */
type MappedPrinterCommand =
  | { readonly channel: "snmp-get"; command: SnmpGetCommand }
  | { readonly channel: "snmp-set"; command: SnmpSetCommand }
  | { readonly channel: "vendor"; command: VendorPrinterCommand };

function printerCommandsFor(
  request: SeamCommandRequest,
): { ok: true; command: MappedPrinterCommand } | { ok: false; reason: string } {
  const capability = request.capability as AdapterCapability;
  const parsed = parsePrinterCommandPayload(capability, request.payload);
  if (parsed.ok) {
    return { ok: true, command: printerCommandForParsed(capability, parsed.payload) };
  }
  // identify/health with NO payload: default device OIDs (SNMP read).
  if (
    (capability === "identify" || capability === "health") &&
    request.payload === undefined
  ) {
    return {
      ok: true,
      command: { channel: "snmp-get", command: { capability, oids: DEFAULT_SNMP_DEVICE_OIDS } },
    };
  }
  return { ok: false, reason: parsed.reason };
}

function printerCommandForParsed(
  capability: AdapterCapability,
  parsed: import("./printer-commands").ParsedPrinterCommandPayload,
): MappedPrinterCommand {
  if (parsed.kind === "snmp-get") {
    return {
      channel: "snmp-get",
      command: {
        capability: capability as "diagnose" | "identify" | "health",
        oids: parsed.payload.oids,
      },
    };
  }
  if (parsed.kind === "snmp-set") {
    return {
      channel: "snmp-set",
      command: { capability: "enforce", assignments: parsed.payload.assignments },
    };
  }
  return { channel: "vendor", command: vendorCommandFor(parsed.payload) };
}

function vendorCommandFor(
  payload: import("./printer-commands").VendorPrinterCommandPayload,
): VendorPrinterCommand {
  switch (payload.action) {
    case "cancel-job":
      return { capability: "enforce", vendorAction: "cancel-job", jobId: payload.jobId };
    case "clear-queue":
      return { capability: "enforce", vendorAction: "clear-queue" };
    case "apply-config":
      return { capability: "enforce", vendorAction: "apply-config", config: payload.config };
    case "reboot":
      return { capability: "reboot", vendorAction: "reboot" };
    case "firmware-update":
      return {
        capability: "update",
        vendorAction: "firmware-update",
        firmwareRef: payload.firmwareRef,
        ...(payload.firmwareHash !== undefined ? { firmwareHash: payload.firmwareHash } : {}),
      };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an in-memory deterministic printer/copier seam. No real
 * network/device I/O: `snmpGet`/`snmpSet`/`runVendorCommand` return
 * scripted outcomes; the observation sources return scripted records;
 * `probe()` returns the scripted capabilities. Every invocation is
 * recorded (see `calls()`).
 */
export function createInMemoryPrinterCopierSeam(
  options: InMemoryPrinterCopierSeamOptions = {},
): InMemoryPrinterCopierSeam {
  const recorder: SeamRecorder = { records: [] };
  const outcomes = options.commandOutcomes ?? [];
  const consumables = options.consumableObservations ?? [];
  const pageCounts = options.pageCountObservations ?? [];
  const errorStates = options.errorStateObservations ?? [];

  function snmpGet(command: SnmpGetCommand): SeamCommandResult {
    recordSeamCall(recorder, "commands", "snmpGet", command);
    return familySeamResultFor("printer-copier", command.capability, command, outcomes);
  }

  function snmpSet(command: SnmpSetCommand): SeamCommandResult {
    recordSeamCall(recorder, "commands", "snmpSet", command);
    return familySeamResultFor("printer-copier", command.capability, command, outcomes);
  }

  function runVendorCommand(command: VendorPrinterCommand): SeamCommandResult {
    recordSeamCall(recorder, "commands", "runVendorCommand", command);
    return familySeamResultFor("printer-copier", command.capability, command, outcomes);
  }

  const commands: PrinterCopierCommandChannel = frozen({
    execute: (request: SeamCommandRequest): SeamCommandResult => {
      recordSeamCall(recorder, "commands", "execute", request);
      const mapped = printerCommandsFor(request);
      if (!mapped.ok) {
        return frozen({
          status: "failed" as const,
          evidence: frozenArray([]),
          failure: frozen({
            kind: "adapter_internal" as const,
            message: `malformed printer/copier command payload for capability "${request.capability as string}" on printer-copier: ${mapped.reason}`,
          }),
        });
      }
      const command = mapped.command;
      if (command.channel === "snmp-get") return snmpGet(command.command);
      if (command.channel === "snmp-set") return snmpSet(command.command);
      return runVendorCommand(command.command);
    },
    snmpGet,
    snmpSet,
    runVendorCommand,
  });

  function readConsumables(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readConsumables", null);
    return scriptedObservationsCopy(consumables);
  }
  function readPageCounts(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readPageCounts", null);
    return scriptedObservationsCopy(pageCounts);
  }
  function readErrorStates(): readonly ObservationRecord[] {
    recordSeamCall(recorder, "observations", "readErrorStates", null);
    return scriptedObservationsCopy(errorStates);
  }

  const observationSources: PrinterCopierObservationSources = frozen({
    poll: (): readonly ObservationRecord[] => {
      recordSeamCall(recorder, "observations", "poll", null);
      return frozenArray([
        ...readConsumables(),
        ...readPageCounts(),
        ...readErrorStates(),
      ]);
    },
    readConsumables,
    readPageCounts,
    readErrorStates,
  });

  return frozen({
    platform: "printer-copier" as const,
    commands,
    observationSources,
    capabilityProbe: familyProbeFor("printer-copier", recorder, options.probedCapabilities),
    calls: () => snapshotSeamCalls(recorder),
    reset: () => resetSeamRecorder(recorder),
  }) as InMemoryPrinterCopierSeam;
}
