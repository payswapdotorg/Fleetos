/**
 * @fleetos/device-adapters — W030 D2: Printer/copier command payload
 * contracts (SNMP + vendor boundary).
 *
 * Typed, validated payload shapes for the printer/copier family's
 * normalized capability commands. SNMP and the vendor API are CONTRACT
 * boundaries in this wave — pure typed shapes + injected seams; there is
 * NO real network/device I/O (a production connector implements the
 * typed seam interfaces in a later infrastructure wave).
 *
 * Capability -> accepted payload kinds (the lane-local map):
 *
 *   diagnose -> snmp-get            (an ad-hoc OID query is a diagnostic)
 *   enforce  -> snmp-set | vendor-command   (apply configuration /
 *                cancel-job / clear-queue through the limited-enforce boundary)
 *   reboot   -> vendor-command      (vendor-model optional)
 *   update   -> vendor-command      (firmware update; vendor-model optional)
 *
 * `lock` / `locate` / `wipe` accept NOTHING: they are FORBIDDEN for the
 * printer/copier family (see families.ts) — refused by capability
 * negotiation, never emulated.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen, frozenArray } from "./internal";
import type { AdapterCapability } from "./adapter";
import {
  isPlainObject,
  parseFail,
  parseOk,
  requireNonEmptyString,
  requireStringEnum,
  optionalNonEmptyString,
  requirePlainObject,
  requireNonEmptyStringArray,
  unknownFieldIn,
  type PayloadParseResult,
} from "./payload-validation";

// ---------------------------------------------------------------------------
// D2.4 — SNMP command payloads
// ---------------------------------------------------------------------------

/** The SNMP value types the set boundary accepts. */
export type SnmpValueType = "string" | "integer" | "gauge" | "counter";

/** One SNMP set assignment: an OID, its value type and value. */
export interface SnmpAssignment {
  /** The dotted OID (e.g. "1.3.6.1.2.1.43.11.1.1.9.1.1"). */
  readonly oid: string;
  /** The value's SNMP type. */
  readonly valueType: SnmpValueType;
  /** The value (a string for string OIDs; an integer otherwise). */
  readonly value: string | number;
}

/**
 * An SNMP get command payload: query the device for one or more OIDs.
 * An ad-hoc OID query is a DIAGNOSTIC (the observe capability polls the
 * observation sources; it never issues platform commands — W020's
 * passive-observe rule).
 */
export interface SnmpGetCommandPayload {
  /** The dotted OIDs to query (non-empty). */
  readonly oids: readonly string[];
}

/** Parse an opaque value as an `SnmpGetCommandPayload`. Pure. */
export function parseSnmpGetCommandPayload(
  value: unknown,
): PayloadParseResult<SnmpGetCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["oids"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const oids = requireNonEmptyStringArray(value, "oids");
  if (!oids.ok) return oids;
  if (oids.payload.length === 0) {
    return parseFail("expected a non-empty array", "/oids");
  }
  if (oids.payload.some((oid) => !/^\d+(\.\d+)+$/.test(oid))) {
    return parseFail("expected dotted OID strings", "/oids");
  }
  return parseOk({ oids: oids.payload });
}

/**
 * An SNMP set command payload: apply one or more OID assignments. The
 * limited-enforce boundary of the printer/copier family (configuration
 * changes through the SNMP write community).
 */
export interface SnmpSetCommandPayload {
  /** The assignments to apply (non-empty). */
  readonly assignments: readonly SnmpAssignment[];
}

/** Parse an opaque value as an `SnmpSetCommandPayload`. Pure. */
export function parseSnmpSetCommandPayload(
  value: unknown,
): PayloadParseResult<SnmpSetCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["assignments"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const raw = value.assignments;
  if (!Array.isArray(raw) || raw.length === 0) {
    return parseFail("expected a non-empty array", "/assignments");
  }
  const assignments: SnmpAssignment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isPlainObject(entry)) {
      return parseFail("expected an object", `/assignments/${i}`);
    }
    const entryUnknown = unknownFieldIn(entry, ["oid", "valueType", "value"]);
    if (entryUnknown !== undefined) {
      return parseFail(`unknown field "${entryUnknown}"`, `/assignments/${i}/${entryUnknown}`);
    }
    const oid = entry.oid;
    if (typeof oid !== "string" || !/^\d+(\.\d+)+$/.test(oid)) {
      return parseFail("expected a dotted OID string", `/assignments/${i}/oid`);
    }
    const valueType = requireStringEnum(entry, "valueType", [
      "string",
      "integer",
      "gauge",
      "counter",
    ] as const);
    if (!valueType.ok) return valueType;
    const val = entry.value;
    if (valueType.payload === "string") {
      if (typeof val !== "string") {
        return parseFail("expected a string value", `/assignments/${i}/value`);
      }
    } else if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
      return parseFail("expected a non-negative integer value", `/assignments/${i}/value`);
    }
    assignments.push({ oid, valueType: valueType.payload, value: val });
  }
  return parseOk({ assignments: frozenArray(assignments) });
}

// ---------------------------------------------------------------------------
// D2.5 — Vendor boundary command payload
// ---------------------------------------------------------------------------

/** The vendor-API actions the printer/copier boundary exposes. */
export type VendorPrinterAction =
  | "cancel-job"
  | "clear-queue"
  | "apply-config"
  | "reboot"
  | "firmware-update";

/**
 * A vendor printer command payload: act through the vendor's device API
 * (the vendor boundary). Discriminated on `action`:
 *
 *   - cancel-job       (enforce) — cancel one print job by id
 *   - clear-queue      (enforce) — cancel every queued job
 *   - apply-config     (enforce) — apply a configuration object
 *   - reboot           (reboot, vendor-model optional) — remote restart
 *   - firmware-update  (update,  vendor-model optional) — install firmware
 */
export type VendorPrinterCommandPayload =
  | { readonly action: "cancel-job"; readonly jobId: string }
  | { readonly action: "clear-queue" }
  | { readonly action: "apply-config"; readonly config: Readonly<Record<string, unknown>> }
  | { readonly action: "reboot" }
  | {
      readonly action: "firmware-update";
      readonly firmwareRef: string;
      readonly firmwareHash?: string;
    };

/**
 * The vendor actions each printer/copier capability accepts (the
 * capability-aware slice of the vendor boundary — `lock`/`locate`/`wipe`
 * accept nothing).
 */
export const VENDOR_ACTIONS_FOR_CAPABILITY: Readonly<
  Partial<Record<AdapterCapability, readonly VendorPrinterAction[]>>
> = frozen({
  enforce: frozenArray(["cancel-job", "clear-queue", "apply-config"]),
  reboot: frozenArray(["reboot"]),
  update: frozenArray(["firmware-update"]),
} as const);

/** Parse an opaque value as a `VendorPrinterCommandPayload`. Pure. */
export function parseVendorPrinterCommandPayload(
  value: unknown,
): PayloadParseResult<VendorPrinterCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const action = requireStringEnum(value, "action", [
    "cancel-job",
    "clear-queue",
    "apply-config",
    "reboot",
    "firmware-update",
  ] as const);
  if (!action.ok) return action;
  const allowedByAction: Readonly<Record<VendorPrinterAction, readonly string[]>> = {
    "cancel-job": ["action", "jobId"],
    "clear-queue": ["action"],
    "apply-config": ["action", "config"],
    reboot: ["action"],
    "firmware-update": ["action", "firmwareRef", "firmwareHash"],
  };
  const allowedFields = allowedByAction[action.payload];
  const unknown = unknownFieldIn(value, allowedFields);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  switch (action.payload) {
    case "cancel-job": {
      const jobId = requireNonEmptyString(value, "jobId");
      if (!jobId.ok) return jobId;
      return parseOk({ action: "cancel-job", jobId: jobId.payload });
    }
    case "clear-queue":
      return parseOk({ action: "clear-queue" });
    case "apply-config": {
      const config = requirePlainObject(value, "config");
      if (!config.ok) return config;
      return parseOk({ action: "apply-config", config: config.payload });
    }
    case "reboot":
      return parseOk({ action: "reboot" });
    case "firmware-update": {
      const firmwareRef = requireNonEmptyString(value, "firmwareRef");
      if (!firmwareRef.ok) return firmwareRef;
      const firmwareHash = optionalNonEmptyString(value, "firmwareHash");
      if (!firmwareHash.ok) return firmwareHash;
      return parseOk({
        action: "firmware-update",
        firmwareRef: firmwareRef.payload,
        ...(firmwareHash.payload !== undefined ? { firmwareHash: firmwareHash.payload } : {}),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// D2.6 — The capability -> payload-kind map + the unified parser
// ---------------------------------------------------------------------------

/** Every printer/copier command payload kind. */
export type PrinterCommandPayloadKind = "snmp-get" | "snmp-set" | "vendor-command";

/** The union of every printer/copier command payload contract. */
export type PrinterCommandPayload =
  | SnmpGetCommandPayload
  | SnmpSetCommandPayload
  | VendorPrinterCommandPayload;

/**
 * The payload kinds each printer/copier capability accepts (the
 * lane-local capability -> payload contract map). Only
 * printer/copier-envelope capabilities have entries; the FORBIDDEN
 * capabilities (`lock`/`locate`/`wipe`) and the family-unsupported ones
 * (`remediate`) accept NOTHING.
 */
export const PRINTER_CAPABILITY_PAYLOAD_KINDS: Readonly<
  Partial<Record<AdapterCapability, readonly PrinterCommandPayloadKind[]>>
> = frozen({
  identify: frozenArray(["snmp-get"]),
  diagnose: frozenArray(["snmp-get"]),
  health: frozenArray(["snmp-get"]),
  enforce: frozenArray(["vendor-command", "snmp-set"]),
  reboot: frozenArray(["vendor-command"]),
  update: frozenArray(["vendor-command"]),
} as const);

/** The parsed printer/copier command payload: kind + narrowed payload. */
export type ParsedPrinterCommandPayload =
  | { readonly kind: "snmp-get"; readonly payload: SnmpGetCommandPayload }
  | { readonly kind: "snmp-set"; readonly payload: SnmpSetCommandPayload }
  | { readonly kind: "vendor-command"; readonly payload: VendorPrinterCommandPayload };

/**
 * Parse an opaque command payload for a printer/copier capability: try
 * the capability's accepted payload kinds in canonical order; the first
 * validator that accepts the value wins. Vendor commands are
 * capability-aware — e.g. `reboot` accepts ONLY the `reboot` action,
 * `enforce` accepts only cancel-job/clear-queue/apply-config — so a
 * vendor command cannot smuggle an action into the wrong capability. A
 * payload no accepted kind validates fails closed.
 */
export function parsePrinterCommandPayload(
  capability: AdapterCapability,
  value: unknown,
): PayloadParseResult<ParsedPrinterCommandPayload> {
  const accepted = PRINTER_CAPABILITY_PAYLOAD_KINDS[capability];
  if (accepted === undefined) {
    return parseFail(
      `capability "${capability}" accepts no printer/copier command payload (outside the printer/copier payload contract)`,
      "/capability",
    );
  }
  const failures: string[] = [];
  for (const kind of accepted) {
    const parsed = parsePrinterByKind(capability, kind, value);
    if (parsed.ok) return parsed;
    failures.push(`${kind}: ${parsed.reason}${parsed.field ? ` at ${parsed.field}` : ""}`);
  }
  return parseFail(
    `payload matches none of the accepted kinds for capability "${capability}" (${failures.join("; ")})`,
    "/",
  );
}

function parsePrinterByKind(
  capability: AdapterCapability,
  kind: PrinterCommandPayloadKind,
  value: unknown,
): PayloadParseResult<ParsedPrinterCommandPayload> {
  switch (kind) {
    case "snmp-get": {
      const parsed = parseSnmpGetCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "snmp-set": {
      const parsed = parseSnmpSetCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "vendor-command": {
      const parsed = parseVendorPrinterCommandPayload(value);
      if (!parsed.ok) return parsed;
      const allowedActions = VENDOR_ACTIONS_FOR_CAPABILITY[capability] ?? [];
      const action = (parsed.payload as { action: VendorPrinterAction }).action;
      if (!allowedActions.includes(action)) {
        return parseFail(
          `vendor action "${action}" is not accepted for capability "${capability}" (allowed: [${allowedActions.join(", ")}])`,
          "/action",
        );
      }
      return parseOk({ kind, payload: parsed.payload });
    }
  }
}

/**
 * Whether an opaque value is structurally valid for a printer/copier
 * capability (the pure predicate over `parsePrinterCommandPayload`).
 */
export function isPrinterCommandPayload(
  capability: AdapterCapability,
  value: unknown,
): boolean {
  return parsePrinterCommandPayload(capability, value).ok;
}
