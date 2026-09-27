/**
 * @fleetos/device-adapters — W030 D1: Mobile observation source
 * contracts.
 *
 * Typed payload shapes for the mobile families' observation sources:
 * battery, OS version, compliance state, and GEOLOCATION-AS-EVIDENCE.
 * Shapes only — the privacy boundary is respected by construction:
 *
 *   - every field is an OBSERVABLE fact (a battery level, a version, a
 *     compliance state, a captured location fix with provenance);
 *   - location is carried as EVIDENCE (a fix captured at a moment, from
 *     a source, with the lost-mode collection context) — never as
 *     inferred intent (no "moving toward", no dwell inference, no
 *     behavioral fields);
 *   - the observation kinds are open-union strings (the frozen contracts
 *     `ObservationKind` convention `<family>.<subject>`): `mobile.*`
 *     here, `printer.*` in printer-observations.ts.
 *
 * Each payload has a parse validator (unknown -> narrowed typed payload,
 * fail-closed) and a record builder that assembles a W010
 * `ObservationRecord` the collector accepts (kind + schemaVersion 1 +
 * JSON-serializable payload).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every `observedAt` / `capturedAt` is injected.
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
  requireIsoTimestamp,
  requireNonEmptyStringArray,
  unknownFieldIn,
  type PayloadParseResult,
} from "./payload-validation";

// ---------------------------------------------------------------------------
// D1.8 — Mobile observation kinds (open-union, family-prefixed)
// ---------------------------------------------------------------------------

/** Battery observation kind (the mobile family's power evidence). */
export const MOBILE_BATTERY_OBSERVATION_KIND = "mobile.battery" as const;
/** OS version observation kind. */
export const MOBILE_OS_VERSION_OBSERVATION_KIND = "mobile.os-version" as const;
/** Compliance state observation kind. */
export const MOBILE_COMPLIANCE_OBSERVATION_KIND = "mobile.compliance" as const;
/** Geolocation evidence observation kind. */
export const MOBILE_LOCATION_OBSERVATION_KIND = "mobile.location-evidence" as const;

/** Every mobile observation kind (frozen). */
export const MOBILE_OBSERVATION_KINDS: readonly string[] = frozenArray([
  MOBILE_BATTERY_OBSERVATION_KIND,
  MOBILE_OS_VERSION_OBSERVATION_KIND,
  MOBILE_COMPLIANCE_OBSERVATION_KIND,
  MOBILE_LOCATION_OBSERVATION_KIND,
]);

/** Pure predicate: is the kind a mobile observation kind? */
export function isMobileObservationKind(kind: string): boolean {
  return MOBILE_OBSERVATION_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// D1.9 — Battery payload
// ---------------------------------------------------------------------------

/** The battery charging states an MDM reports. */
export type MobileChargingState = "charging" | "discharging" | "full" | "unknown";

/**
 * A mobile battery payload: the battery level percentage and the
 * charging state. Observable evidence only.
 */
export interface MobileBatteryPayload {
  /** Battery level, 0-100 (integer). */
  readonly batteryLevelPercent: number;
  /** The charging state. */
  readonly chargingState: MobileChargingState;
}

/** Parse an opaque value as a `MobileBatteryPayload`. Pure; fail-closed. */
export function parseMobileBatteryPayload(value: unknown): PayloadParseResult<MobileBatteryPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["batteryLevelPercent", "chargingState"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const level = value.batteryLevelPercent;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) {
    return parseFail("expected an integer in [0, 100]", "/batteryLevelPercent");
  }
  const chargingState = requireStringEnum(value, "chargingState", [
    "charging",
    "discharging",
    "full",
    "unknown",
  ] as const);
  if (!chargingState.ok) return chargingState;
  return parseOk({ batteryLevelPercent: level, chargingState: chargingState.payload });
}

/** Build a battery `ObservationRecord` (kind + schemaVersion 1). Pure. */
export function mobileBatteryRecord(
  observedAt: string,
  payload: MobileBatteryPayload,
): ObservationRecord {
  return frozen({
    kind: MOBILE_BATTERY_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D1.10 — OS version payload
// ---------------------------------------------------------------------------

/** The mobile OS families. */
export type MobileOsFamily = "ios" | "ipados" | "android";

/**
 * A mobile OS version payload: the OS family, version, optional build
 * number, and the (Android) security patch level.
 */
export interface MobileOsVersionPayload {
  /** The OS family the device runs. */
  readonly osFamily: MobileOsFamily;
  /** The OS version (e.g. "17.4.1", "14.0"). */
  readonly osVersion: string;
  /** Optional build number (e.g. "21E236"). */
  readonly buildNumber?: string;
  /** Optional security patch level (Android, "YYYY-MM-DD"). */
  readonly securityPatchLevel?: string;
}

/** Parse an opaque value as a `MobileOsVersionPayload`. Pure. */
export function parseMobileOsVersionPayload(
  value: unknown,
): PayloadParseResult<MobileOsVersionPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["osFamily", "osVersion", "buildNumber", "securityPatchLevel"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const osFamily = requireStringEnum(value, "osFamily", ["ios", "ipados", "android"] as const);
  if (!osFamily.ok) return osFamily;
  const osVersion = requireNonEmptyString(value, "osVersion");
  if (!osVersion.ok) return osVersion;
  const buildNumber = optionalNonEmptyString(value, "buildNumber");
  if (!buildNumber.ok) return buildNumber;
  const securityPatchLevel = optionalNonEmptyString(value, "securityPatchLevel");
  if (!securityPatchLevel.ok) return securityPatchLevel;
  if (securityPatchLevel.payload !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(securityPatchLevel.payload)) {
    return parseFail("expected a YYYY-MM-DD security patch level", "/securityPatchLevel");
  }
  return parseOk({
    osFamily: osFamily.payload,
    osVersion: osVersion.payload,
    ...(buildNumber.payload !== undefined ? { buildNumber: buildNumber.payload } : {}),
    ...(securityPatchLevel.payload !== undefined
      ? { securityPatchLevel: securityPatchLevel.payload }
      : {}),
  });
}

/** Build an OS version `ObservationRecord`. Pure. */
export function mobileOsVersionRecord(
  observedAt: string,
  payload: MobileOsVersionPayload,
): ObservationRecord {
  return frozen({
    kind: MOBILE_OS_VERSION_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D1.11 — Compliance state payload
// ---------------------------------------------------------------------------

/** The device compliance states an MDM reports. */
export type MobileComplianceState = "compliant" | "non_compliant";

/**
 * A mobile compliance payload: the compliance state, when it was last
 * evaluated (injected ISO timestamp), and the enumerable machine-stable
 * violation codes (e.g. "passcode-not-set", "os-version-too-old").
 */
export interface MobileCompliancePayload {
  /** The compliance state. */
  readonly complianceState: MobileComplianceState;
  /** When the compliance state was last evaluated (ISO 8601). */
  readonly lastEvaluatedAt: string;
  /** Machine-stable violation codes (empty when compliant). */
  readonly violations: readonly string[];
}

/** Parse an opaque value as a `MobileCompliancePayload`. Pure. */
export function parseMobileCompliancePayload(
  value: unknown,
): PayloadParseResult<MobileCompliancePayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["complianceState", "lastEvaluatedAt", "violations"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const complianceState = requireStringEnum(value, "complianceState", [
    "compliant",
    "non_compliant",
  ] as const);
  if (!complianceState.ok) return complianceState;
  const lastEvaluatedAt = requireIsoTimestamp(value, "lastEvaluatedAt");
  if (!lastEvaluatedAt.ok) return lastEvaluatedAt;
  const violations = requireNonEmptyStringArray(value, "violations");
  if (!violations.ok) return violations;
  return parseOk({
    complianceState: complianceState.payload,
    lastEvaluatedAt: lastEvaluatedAt.payload,
    violations: violations.payload,
  });
}

/** Build a compliance `ObservationRecord`. Pure. */
export function mobileComplianceRecord(
  observedAt: string,
  payload: MobileCompliancePayload,
): ObservationRecord {
  return frozen({
    kind: MOBILE_COMPLIANCE_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D1.12 — Geolocation-as-evidence payload (privacy boundary)
// ---------------------------------------------------------------------------

/** The location fix sources. */
export type MobileFixSource = "gps" | "wifi" | "cell";

/**
 * A mobile geolocation EVIDENCE payload: a captured location fix with
 * provenance. **Privacy boundary:** this is observable evidence — a fix
 * captured at a moment from a source, with the collection context
 * (whether it was captured while lost mode was enabled, the MDM consent
 * basis). It is NEVER inferred intent: no movement analysis, no dwell
 * detection, no behavioral fields. The `locate` capability is
 * destructive per the frozen contracts, so collection itself is gated by
 * grant + fresh-policy-cache at the adapter boundary.
 */
export interface MobileLocationEvidencePayload {
  /** Latitude, -90..90. */
  readonly latitude: number;
  /** Longitude, -180..180. */
  readonly longitude: number;
  /** Optional horizontal accuracy in meters (> 0). */
  readonly accuracyMeters?: number;
  /** When the fix was captured on the device (ISO 8601, injected). */
  readonly capturedAt: string;
  /** The fix source. */
  readonly fixSource: MobileFixSource;
  /** Whether the fix was captured while lost mode was enabled. */
  readonly capturedWhileLostMode: boolean;
}

/** Parse an opaque value as a `MobileLocationEvidencePayload`. Pure. */
export function parseMobileLocationEvidencePayload(
  value: unknown,
): PayloadParseResult<MobileLocationEvidencePayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, [
    "latitude",
    "longitude",
    "accuracyMeters",
    "capturedAt",
    "fixSource",
    "capturedWhileLostMode",
  ]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const latitude = value.latitude;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return parseFail("expected a number in [-90, 90]", "/latitude");
  }
  const longitude = value.longitude;
  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return parseFail("expected a number in [-180, 180]", "/longitude");
  }
  const accuracyMeters = optionalIntegerInRange(value, "accuracyMeters", 1, 100_000);
  if (!accuracyMeters.ok) return accuracyMeters;
  const capturedAt = requireIsoTimestamp(value, "capturedAt");
  if (!capturedAt.ok) return capturedAt;
  const fixSource = requireStringEnum(value, "fixSource", ["gps", "wifi", "cell"] as const);
  if (!fixSource.ok) return fixSource;
  if (typeof value.capturedWhileLostMode !== "boolean") {
    return parseFail("expected a boolean", "/capturedWhileLostMode");
  }
  return parseOk({
    latitude,
    longitude,
    ...(accuracyMeters.payload !== undefined ? { accuracyMeters: accuracyMeters.payload } : {}),
    capturedAt: capturedAt.payload,
    fixSource: fixSource.payload,
    capturedWhileLostMode: value.capturedWhileLostMode,
  });
}

/** Build a geolocation-evidence `ObservationRecord`. Pure. */
export function mobileLocationEvidenceRecord(
  observedAt: string,
  payload: MobileLocationEvidencePayload,
): ObservationRecord {
  return frozen({
    kind: MOBILE_LOCATION_OBSERVATION_KIND,
    observedAt,
    schemaVersion: 1,
    payload: frozen({ ...payload }),
  });
}

// ---------------------------------------------------------------------------
// D1.13 — The mobile observation payload union + kind dispatch
// ---------------------------------------------------------------------------

/** The union of every mobile observation payload contract. */
export type MobileObservationPayload =
  | MobileBatteryPayload
  | MobileOsVersionPayload
  | MobileCompliancePayload
  | MobileLocationEvidencePayload;

/**
 * Parse a mobile observation payload by its kind. Only mobile kinds are
 * accepted (fail-closed on anything else) — the deterministic bridge
 * between an observation kind and its typed payload contract.
 */
export function parseMobileObservationPayload(
  kind: string,
  value: unknown,
): PayloadParseResult<MobileObservationPayload> {
  switch (kind) {
    case MOBILE_BATTERY_OBSERVATION_KIND:
      return parseMobileBatteryPayload(value);
    case MOBILE_OS_VERSION_OBSERVATION_KIND:
      return parseMobileOsVersionPayload(value);
    case MOBILE_COMPLIANCE_OBSERVATION_KIND:
      return parseMobileCompliancePayload(value);
    case MOBILE_LOCATION_OBSERVATION_KIND:
      return parseMobileLocationEvidencePayload(value);
    default:
      return parseFail(`not a mobile observation kind: ${kind}`, "/kind");
  }
}
