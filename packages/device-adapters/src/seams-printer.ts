/**
 * @fleetos/device-adapters — W030 D2: Printer/copier platform seam
 * (SNMP + vendor boundary typed interfaces).
 *
 * TYPES ONLY (no runtime values) — the typed boundary interfaces a REAL
 * printer/copier/network-device connector would implement for the
 * endpoint adapter SDK:
 *
 *   - a combined command execution surface with the SNMP channel
 *     (`snmpGet` for ad-hoc diagnostic OID queries, `snmpSet` for the
 *     limited-enforce configuration boundary) and the vendor API channel
 *     (`runVendorCommand` for cancel-job / clear-queue / apply-config /
 *     reboot / firmware-update) — each extending the normalized
 *     `execute()` boundary,
 *   - the consumable/usage observation sources (consumables, page
 *     counts, error states) — extending the normalized `poll()`
 *     boundary,
 *   - a capability probe (the normalized `probe()` boundary).
 *
 * `lock` / `locate` / `wipe` have NO seam surface: they are FORBIDDEN
 * for the printer/copier family (see `families.ts`) — refused by
 * capability negotiation, never emulated. The in-memory deterministic
 * reference implementation lives in `seams-inmemory-printer.ts`.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapability } from "./adapter";
import type { ObservationRecord } from "./observations";
import type { SnmpAssignment } from "./printer-commands";
import type {
  SeamCapabilityProbe,
  SeamCommandExecutionSurface,
  SeamCommandRequest,
  SeamCommandResult,
  SeamObservationFeed,
} from "./seams";

// ---------------------------------------------------------------------------
// D2.12 — SNMP channel commands
// ---------------------------------------------------------------------------

/**
 * An SNMP get command (a diagnostic/ad-hoc OID query — `diagnose`,
 * `identify` or `health`). Ad-hoc queries are diagnostics; the observe
 * capability polls the observation sources and never issues platform
 * commands (W020's passive-observe rule).
 */
export interface SnmpGetCommand {
  readonly capability: "diagnose" | "identify" | "health";
  /** The dotted OIDs to query (non-empty). */
  readonly oids: readonly string[];
}

/**
 * An SNMP set command (the limited-enforce configuration boundary —
 * `enforce`).
 */
export interface SnmpSetCommand {
  readonly capability: "enforce";
  /** The OID assignments to apply (non-empty). */
  readonly assignments: readonly SnmpAssignment[];
}

// ---------------------------------------------------------------------------
// D2.13 — Vendor boundary commands
// ---------------------------------------------------------------------------

/** A vendor cancel-job command (enforce). */
export interface VendorCancelJobCommand {
  readonly capability: "enforce";
  readonly vendorAction: "cancel-job";
  readonly jobId: string;
}

/** A vendor clear-queue command (enforce). */
export interface VendorClearQueueCommand {
  readonly capability: "enforce";
  readonly vendorAction: "clear-queue";
}

/** A vendor apply-config command (enforce). */
export interface VendorApplyConfigCommand {
  readonly capability: "enforce";
  readonly vendorAction: "apply-config";
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * A vendor reboot command (`reboot` — vendor-model optional capability).
 */
export interface VendorRebootCommand {
  readonly capability: "reboot";
  readonly vendorAction: "reboot";
}

/**
 * A vendor firmware-update command (`update` — vendor-model optional
 * capability).
 */
export interface VendorFirmwareUpdateCommand {
  readonly capability: "update";
  readonly vendorAction: "firmware-update";
  readonly firmwareRef: string;
  readonly firmwareHash?: string;
}

/** The union of vendor boundary typed commands. */
export type VendorPrinterCommand =
  | VendorCancelJobCommand
  | VendorClearQueueCommand
  | VendorApplyConfigCommand
  | VendorRebootCommand
  | VendorFirmwareUpdateCommand;

// ---------------------------------------------------------------------------
// D2.14 — The printer/copier seam surfaces
// ---------------------------------------------------------------------------

/**
 * The printer/copier command execution surface: the normalized
 * `execute()` boundary plus the SNMP channel (`snmpGet`, `snmpSet`) and
 * the vendor API channel (`runVendorCommand`) a real connector
 * implements. There is deliberately NO lock/locate/wipe surface.
 */
export interface PrinterCopierCommandChannel extends SeamCommandExecutionSurface {
  /** Query the device over SNMP (diagnostic OID read). */
  snmpGet(command: SnmpGetCommand): SeamCommandResult;
  /** Apply SNMP OID assignments (the limited-enforce write boundary). */
  snmpSet(command: SnmpSetCommand): SeamCommandResult;
  /** Execute a typed vendor API command on the device. */
  runVendorCommand(command: VendorPrinterCommand): SeamCommandResult;
}

/**
 * The printer/copier observation sources: the normalized `poll()`
 * boundary plus the three platform-typed consumable/usage evidence
 * entry points. Payload contracts live in `printer-observations.ts`.
 */
export interface PrinterCopierObservationSources extends SeamObservationFeed {
  /** Read consumable levels (kind `printer.consumable`). */
  readConsumables(): readonly ObservationRecord[];
  /** Read page-count usage counters (kind `printer.page-counts`). */
  readPageCounts(): readonly ObservationRecord[];
  /** Read error states (kind `printer.error-state`). */
  readErrorStates(): readonly ObservationRecord[];
}

/** The complete printer/copier platform seam. */
export interface PrinterCopierSeam {
  readonly platform: "printer-copier";
  readonly commands: PrinterCopierCommandChannel;
  readonly observationSources: PrinterCopierObservationSources;
  readonly capabilityProbe: SeamCapabilityProbe;
}

/** Pure predicate: is the value a printer/copier seam? */
export function isPrinterCopierSeam(value: unknown): value is PrinterCopierSeam {
  if (typeof value !== "object" || value === null) return false;
  const seam = value as { platform?: unknown; commands?: unknown; observationSources?: unknown; capabilityProbe?: unknown };
  return (
    seam.platform === "printer-copier" &&
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
