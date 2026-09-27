/**
 * @fleetos/device-adapters — W030 D2: Printer/copier consumable + usage
 * observation contracts.
 *
 * Typed payload shapes for the printer/copier family's observation
 * sources: consumables (toner levels), usage (page counts), and error
 * states. The kinds are open-union strings following the frozen
 * contracts `ObservationKind` `<family>.<subject>` convention
 * ("printer.*"). Each payload has a parse validator (unknown ->
 * narrowed typed payload, fail-closed) and a record builder assembling a
 * W010 `ObservationRecord` (kind + schemaVersion 1).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every `observedAt` is injected.
 */

import { frozen, frozenArray } from "./internal";
import type { ObservationRecord } from "./observations";
import {
  isPlainObject,
  parseFail,
  parseOk,
  requireNonEmptyString,
  requireStringEnum,
  optionalIntegerInRange,
  optionalNonEmptyString,
  requireNonEmptyStringArray,
  unknownFieldIn,
  type PayloadParseResult,
} from "./payload-validation";

// ---------------------------------------------------------------------------
// D2.7 — Printer observation kinds
// ---------------------------------------------------------------------------

/** Consumable observation kind (toner / ink / drum levels). */
export const PRINTER_CONSUMABLE_OBSERVATION_KIND = "printer.consumable" as const;
/** Page counts observation kind (usage counters). */
export const PRINTER_PAGE_COUNTS_OBSERVATION_KIND = "printer.page-counts" as const;
/** Error state observation kind (device status + error entries). */
export const PRINTER_ERROR_STATE_OBSERVATION_KIND = "printer.error-state" as const;

/** Every printer/copier observation kind (frozen). */
export const PRINTER_OBSERVATION_KINDS: readonly string[] = frozenArray([
  PRINTER_CONSUMABLE_OBSERVATION_KIND,
  PRINTER_PAGE_COUNTS_OBSERVATION_KIND,
  PRINTER_ERROR_STATE_OBSERVATION_KIND,
]);

/** Pure predicate: is the kind a printer/copier observation kind? */
export function isPrinterObservationKind(kind: string): boolean {
  return PRINTER_OBSERVATION_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// D2.8 — Consumable payload (toner levels)
// ---------------------------------------------------------------------------

/** The consumable types a printer/copier reports. */
export type PrinterConsumableType = "toner" | "ink" | "drum" | "waste-toner" | "maintenance-kit";

/** The consumable colors (absent for mono consumables). */
export type PrinterConsumableColor = "black" | "cyan" | "magenta" | "yellow";

/**
 * A printer consumable payload: one consumable (toner cartridge, drum,
 * maintenance kit, ...) with its remaining percentage and optional page
 * estimate.
 */
export interface PrinterConsumablePayload {
  /** Vendor-model-stable consumable id (e.g. "cf259x"). */
  readonly consumableId: string;
  /** The consumable type. */
  readonly consumableType: PrinterConsumableType;
  /** The color (absent for mono/multi-color consumables). */
  readonly color?: PrinterConsumableColor;
  /** Remaining percentage, 0-100 (integer). */
  readonly remainingPercent: number;
  /** Optional estimated pages remaining (>= 0). */
  readonly estimatedPagesRemaining?: number;
}

/** Parse an opaque value as a `PrinterConsumablePayload`. Pure. */
export function parsePrinterConsumablePayload(
  value: unknown,
): PayloadParseResult<PrinterConsumablePayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, [
    "consumableId",
    "consumableType",
    "color",
    "remainingPercent",
    "estimatedPagesRemaining",
  ]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const consumableId = requireNonEmptyString(value, "consumableId");
  if (!consumableId.ok) return consumableId;
  const consumableType = requireStringEnum(value, "consumableType", [
    "toner",
    "ink",
    "drum",
    "waste-toner",
    "maintenance-kit",
  ] as const);
  if (!consumableType.ok) return consumableType;
  let color: PrinterConsumableColor | undefined;
  if (value.color !== undefined) {
    const parsed = requireStringEnum(value, "color", ["black", "cyan", "magenta", "yellow"] as const);
    if (!parsed.ok) return parsed;
    color = parsed.payload;
  }
  const remaining = value.remainingPercent;
  if (
    typeof remaining !== "number" ||
    !Number.isInteger(remaining) ||
    remaining < 0 ||
    remaining > 100
  ) {
    return parseFail("expected an integer in [0, 100]", "/remainingPercent");
  }
  const estimatedPagesRemaining = optionalIntegerInRange(value, "estimatedPagesRemaining", 0, 100_000_000);
  if (!estimatedPagesRemaining.ok) return estimatedPagesRemaining;
  return parseOk({
    consumableId: consumableId.payload,
    consumableType: consumableType.payload,
    ...(color !== undefined ? { color } : {}),
    remainingPercent: remaining,
    ...(estimatedPagesRemaining.payload !== undefined
      ? { estimatedPagesRemaining: estimatedPagesRemaining.payload }
      : {}),
  });
}

/** Build a consumable `ObservationRecord`. Pure. */
export function printerConsumableRecord(
  observedAt: string,
  payload: PrinterConsumablePayload,
): ObservationRecord {
  return frozen({
    kind: PRINTER_CONSUMABLE_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D2.9 — Page counts payload (usage)
// ---------------------------------------------------------------------------

/**
 * A printer page counts payload: the usage counters — total printed
 * pages, mono pages, color pages, duplex impressions, and optional
 * scanned pages. All counters are non-negative integers.
 */
export interface PrinterPageCountsPayload {
  /** Total pages printed. */
  readonly total: number;
  /** Mono pages printed. */
  readonly mono: number;
  /** Color pages printed. */
  readonly color: number;
  /** Duplex impressions. */
  readonly duplex: number;
  /** Optional scanned pages. */
  readonly scanned?: number;
}

/** Parse an opaque value as a `PrinterPageCountsPayload`. Pure. */
export function parsePrinterPageCountsPayload(
  value: unknown,
): PayloadParseResult<PrinterPageCountsPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["total", "mono", "color", "duplex", "scanned"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const counters: Record<string, number> = {};
  for (const field of ["total", "mono", "color", "duplex"] as const) {
    const raw = value[field];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      return parseFail("expected a non-negative integer", `/${field}`);
    }
    counters[field] = raw;
  }
  const scanned = optionalIntegerInRange(value, "scanned", 0, 100_000_000);
  if (!scanned.ok) return scanned;
  return parseOk({
    total: counters.total,
    mono: counters.mono,
    color: counters.color,
    duplex: counters.duplex,
    ...(scanned.payload !== undefined ? { scanned: scanned.payload } : {}),
  });
}

/** Build a page-counts `ObservationRecord`. Pure. */
export function printerPageCountsRecord(
  observedAt: string,
  payload: PrinterPageCountsPayload,
): ObservationRecord {
  return frozen({
    kind: PRINTER_PAGE_COUNTS_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D2.10 — Error state payload
// ---------------------------------------------------------------------------

/** The error entry severities. */
export type PrinterErrorSeverity = "informational" | "warning" | "error";

/** One error-state entry: a machine-stable code, severity, description. */
export interface PrinterErrorEntry {
  /** Machine-stable error code (e.g. "media-jam", "service-required"). */
  readonly code: string;
  /** The severity. */
  readonly severity: PrinterErrorSeverity;
  /** Optional human-readable description. */
  readonly description?: string;
}

/**
 * A printer error-state payload: the overall device status plus the
 * enumerable active error entries.
 */
export interface PrinterErrorStatePayload {
  /** The overall device status. */
  readonly deviceStatus: "normal" | "attention-required" | "offline";
  /** The active error entries (empty when normal). */
  readonly errors: readonly PrinterErrorEntry[];
}

/** Parse an opaque value as a `PrinterErrorStatePayload`. Pure. */
export function parsePrinterErrorStatePayload(
  value: unknown,
): PayloadParseResult<PrinterErrorStatePayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["deviceStatus", "errors"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const deviceStatus = requireStringEnum(value, "deviceStatus", [
    "normal",
    "attention-required",
    "offline",
  ] as const);
  if (!deviceStatus.ok) return deviceStatus;
  const rawErrors = value.errors;
  if (!Array.isArray(rawErrors)) {
    return parseFail("expected an array", "/errors");
  }
  const errors: PrinterErrorEntry[] = [];
  for (let i = 0; i < rawErrors.length; i++) {
    const entry = rawErrors[i];
    if (!isPlainObject(entry)) {
      return parseFail("expected an object", `/errors/${i}`);
    }
    const entryUnknown = unknownFieldIn(entry, ["code", "severity", "description"]);
    if (entryUnknown !== undefined) {
      return parseFail(`unknown field "${entryUnknown}"`, `/errors/${i}/${entryUnknown}`);
    }
    const code = requireNonEmptyString(entry, "code");
    if (!code.ok) return code;
    const severity = requireStringEnum(entry, "severity", [
      "informational",
      "warning",
      "error",
    ] as const);
    if (!severity.ok) return severity;
    const description = optionalNonEmptyString(entry, "description");
    if (!description.ok) return description;
    errors.push({
      code: code.payload,
      severity: severity.payload,
      ...(description.payload !== undefined ? { description: description.payload } : {}),
    });
  }
  return parseOk({
    deviceStatus: deviceStatus.payload,
    errors: frozenArray(errors),
  });
}

/** Build an error-state `ObservationRecord`. Pure. */
export function printerErrorStateRecord(
  observedAt: string,
  payload: PrinterErrorStatePayload,
): ObservationRecord {
  return frozen({
    kind: PRINTER_ERROR_STATE_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D2.11 — The printer observation payload union + kind dispatch
// ---------------------------------------------------------------------------

/** The union of every printer/copier observation payload contract. */
export type PrinterObservationPayload =
  | PrinterConsumablePayload
  | PrinterPageCountsPayload
  | PrinterErrorStatePayload;

/**
 * Parse a printer/copier observation payload by its kind. Only printer
 * kinds are accepted (fail-closed on anything else).
 */
export function parsePrinterObservationPayload(
  kind: string,
  value: unknown,
): PayloadParseResult<PrinterObservationPayload> {
  switch (kind) {
    case PRINTER_CONSUMABLE_OBSERVATION_KIND:
      return parsePrinterConsumablePayload(value);
    case PRINTER_PAGE_COUNTS_OBSERVATION_KIND:
      return parsePrinterPageCountsPayload(value);
    case PRINTER_ERROR_STATE_OBSERVATION_KIND:
      return parsePrinterErrorStatePayload(value);
    default:
      return parseFail(`not a printer/copier observation kind: ${kind}`, "/kind");
  }
}
