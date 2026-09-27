/**
 * @fleetos/device-adapters — W030 D1: Mobile family command payload
 * contracts (MDM-shaped).
 *
 * Typed, validated payload shapes for the mobile families' normalized
 * capability commands (iOS/iPadOS management + Android Enterprise). The
 * payloads are MDM-shaped per the work order: managed-app commands,
 * OS-update policies, lost-mode with message/phone, plus the lock/wipe/
 * locate/enforce basics. The adapter surface stays OPAQUE (W020); these
 * contracts are the typed vocabulary the MOBILE SEAMS interpret —
 * `parseMobileCommandPayload` narrows an opaque payload to the typed
 * command contract for a capability, and the in-memory family seams use
 * it to prove malformed payloads FAIL CLOSED (never reach a platform
 * command).
 *
 * Capability -> accepted payload kinds (the lane-local map):
 *
 *   enforce -> managed-app | mobile-enforce
 *   update  -> os-update-policy
 *   lock    -> device-lock | lost-mode
 *   locate  -> locate-request
 *   wipe    -> wipe
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp inside a payload is supplied by the
 * caller.
 */

import { frozen, frozenArray } from "./internal";
import type { AdapterCapability } from "./adapter";
import {
  isPlainObject,
  parseFail,
  parseOk,
  requireBoolean,
  requireNonEmptyString,
  requirePlainObject,
  requireStringEnum,
  optionalIntegerInRange,
  optionalNonEmptyString,
  requireNonEmptyStringArray,
  unknownFieldIn,
  type PayloadParseResult,
} from "./payload-validation";

// ---------------------------------------------------------------------------
// D1.1 — Managed-app command payload
// ---------------------------------------------------------------------------

/** The managed-app actions an MDM may perform on an app. */
export type ManagedAppAction = "install" | "remove";

/**
 * A managed-app command payload: install/remove an app (bundle id /
 * managed-play identifier), optionally with a managed configuration
 * (app restrictions). Typed shape; validated by
 * `parseManagedAppCommandPayload`.
 */
export interface ManagedAppCommandPayload {
  /** The managed-app action. */
  readonly action: ManagedAppAction;
  /** The app identifier (bundle identifier / managed Google Play id). */
  readonly appIdentifier: string;
  /** Optional managed configuration (app restrictions; JSON object). */
  readonly managedConfiguration?: Readonly<Record<string, unknown>>;
}

/**
 * Parse an opaque value as a `ManagedAppCommandPayload`. Pure; never
 * throws.
 */
export function parseManagedAppCommandPayload(
  value: unknown,
): PayloadParseResult<ManagedAppCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["action", "appIdentifier", "managedConfiguration"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const action = requireStringEnum(value, "action", ["install", "remove"] as const);
  if (!action.ok) return action;
  const appIdentifier = requireNonEmptyString(value, "appIdentifier");
  if (!appIdentifier.ok) return appIdentifier;
  let managedConfiguration: Readonly<Record<string, unknown>> | undefined;
  if (value.managedConfiguration !== undefined) {
    const configuration = requirePlainObject(value, "managedConfiguration");
    if (!configuration.ok) return configuration;
    managedConfiguration = configuration.payload;
  }
  return parseOk({ action: action.payload, appIdentifier: appIdentifier.payload, ...(managedConfiguration !== undefined ? { managedConfiguration } : {}) });
}

// ---------------------------------------------------------------------------
// D1.2 — OS-update policy payload
// ---------------------------------------------------------------------------

/**
 * An OS-update policy payload: schedule/target an OS update. MDM-shaped:
 * the target version, a deferral window, and whether the device is
 * notified.
 */
export interface OsUpdatePolicyPayload {
  /** The OS version to target (latest when absent). */
  readonly targetVersion?: string;
  /** Defer installation by this many hours (0 = as soon as possible). */
  readonly deferralHours?: number;
  /** Whether the device is notified before the update installs. */
  readonly notifyDevice: boolean;
}

/**
 * Parse an opaque value as an `OsUpdatePolicyPayload`. Pure.
 */
export function parseOsUpdatePolicyPayload(
  value: unknown,
): PayloadParseResult<OsUpdatePolicyPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["targetVersion", "deferralHours", "notifyDevice"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const notifyDevice = requireBoolean(value, "notifyDevice");
  if (!notifyDevice.ok) return notifyDevice;
  const targetVersion = (optionalNonEmptyString(value, "targetVersion"));
  if (!targetVersion.ok) return targetVersion;
  const deferralHours = (optionalIntegerInRange(value, "deferralHours", 0, 24 * 365));
  if (!deferralHours.ok) return deferralHours;
  return parseOk({
    notifyDevice: notifyDevice.payload,
    ...(targetVersion.payload !== undefined ? { targetVersion: targetVersion.payload } : {}),
    ...(deferralHours.payload !== undefined ? { deferralHours: deferralHours.payload } : {}),
  });
}

// ---------------------------------------------------------------------------
// D1.3 — Lost-mode command payload (enable with message + phone)
// ---------------------------------------------------------------------------

/**
 * A lost-mode command payload. Enabling lost mode REQUIRES a message and
 * a phone number (the lock-screen presentation); disabling requires
 * nothing.
 */
export type LostModeCommandPayload =
  | {
      readonly action: "enable";
      /** The lock-screen message shown while lost mode is enabled. */
      readonly message: string;
      /** The phone number shown on the lock screen. */
      readonly phoneNumber: string;
      /** Optional footnote (Apple MDM). */
      readonly footnote?: string;
    }
  | {
      readonly action: "disable";
    };

/**
 * Parse an opaque value as a `LostModeCommandPayload`. Pure. An `enable`
 * without a non-empty message AND phone number fails closed.
 */
export function parseLostModeCommandPayload(
  value: unknown,
): PayloadParseResult<LostModeCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const action = requireStringEnum(value, "action", ["enable", "disable"] as const);
  if (!action.ok) return action;
  if (action.payload === "disable") {
    const unknown = unknownFieldIn(value, ["action"]);
    if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
    return parseOk({ action: "disable" });
  }
  const unknown = unknownFieldIn(value, ["action", "message", "phoneNumber", "footnote"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const message = requireNonEmptyString(value, "message");
  if (!message.ok) return message;
  const phoneNumber = requireNonEmptyString(value, "phoneNumber");
  if (!phoneNumber.ok) return phoneNumber;
  const footnote = (optionalNonEmptyString(value, "footnote"));
  if (!footnote.ok) return footnote;
  return parseOk({
    action: "enable",
    message: message.payload,
    phoneNumber: phoneNumber.payload,
    ...(footnote.payload !== undefined ? { footnote: footnote.payload } : {}),
  });
}

// ---------------------------------------------------------------------------
// D1.4 — Device lock / wipe / locate payloads
// ---------------------------------------------------------------------------

/**
 * A device-lock command payload: lock the device screen, optionally with
 * a PIN (MDM-shaped; the family seam maps it to the platform lock
 * command).
 */
export interface DeviceLockCommandPayload {
  /** Optional lock PIN (Apple: 6-digit; Android: screen-lock credential). */
  readonly pin?: string;
}

/**
 * Parse an opaque value as a `DeviceLockCommandPayload`. Pure.
 */
export function parseDeviceLockCommandPayload(
  value: unknown,
): PayloadParseResult<DeviceLockCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["pin"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const pin = (optionalNonEmptyString(value, "pin"));
  if (!pin.ok) return pin;
  if (pin.payload !== undefined && !/^\d{4,8}$/.test(pin.payload)) {
    return parseFail("expected a 4-8 digit numeric PIN", "/pin");
  }
  return parseOk({
    ...(pin.payload !== undefined ? { pin: pin.payload } : {}),
  });
}

/**
 * A wipe command payload. `scope` selects a FULL device wipe or an
 * ENTERPRISE wipe (the organization's data only — Android work profile /
 * Apple organization erase), the operationally-safe default for BYOD.
 */
export interface WipeCommandPayload {
  /** Wipe scope: the whole device, or the enterprise data only. */
  readonly scope: "full" | "enterprise";
  /** Whether the data plan is preserved (Apple). */
  readonly preserveDataPlan?: boolean;
}

/**
 * Parse an opaque value as a `WipeCommandPayload`. Pure.
 */
export function parseWipeCommandPayload(value: unknown): PayloadParseResult<WipeCommandPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["scope", "preserveDataPlan"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const scope = requireStringEnum(value, "scope", ["full", "enterprise"] as const);
  if (!scope.ok) return scope;
  let preserveDataPlan: boolean | undefined;
  if (value.preserveDataPlan !== undefined) {
    const plan = requireBoolean(value, "preserveDataPlan");
    if (!plan.ok) return plan;
    preserveDataPlan = plan.payload;
  }
  return parseOk({
    scope: scope.payload,
    ...(preserveDataPlan !== undefined ? { preserveDataPlan } : {}),
  });
}

/**
 * A locate request payload: request a single location fix. Locate is
 * DESTRUCTIVE per the frozen contracts (`DESTRUCTIVE_CAPABILITIES`
 * includes `locate`) — the request is evidence collection, gated by the
 * same grant + fresh-cache rules as every destructive capability.
 */
export interface LocateRequestPayload {
  /** The requested fix accuracy. */
  readonly accuracy: "coarse" | "fine";
  /** Accept a fix up to this many seconds old (0 = fresh only). */
  readonly maxAgeSeconds?: number;
}

/**
 * Parse an opaque value as a `LocateRequestPayload`. Pure.
 */
export function parseLocateRequestPayload(
  value: unknown,
): PayloadParseResult<LocateRequestPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["accuracy", "maxAgeSeconds"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const accuracy = requireStringEnum(value, "accuracy", ["coarse", "fine"] as const);
  if (!accuracy.ok) return accuracy;
  const maxAgeSeconds = (optionalIntegerInRange(value, "maxAgeSeconds", 0, 86_400));
  if (!maxAgeSeconds.ok) return maxAgeSeconds;
  return parseOk({
    accuracy: accuracy.payload,
    ...(maxAgeSeconds.payload !== undefined ? { maxAgeSeconds: maxAgeSeconds.payload } : {}),
  });
}

// ---------------------------------------------------------------------------
// D1.5 — Mobile enforce payload (passcode / restrictions)
// ---------------------------------------------------------------------------

/**
 * A passcode policy payload (the `passcode` area of mobile enforcement).
 */
export interface PasscodePolicyPayload {
  /** Minimum passcode length (0-16). */
  readonly minLength: number;
  /** Whether the passcode must contain both letters and numbers. */
  readonly requireAlphanumeric: boolean;
}

/** Parse an opaque value as a `PasscodePolicyPayload`. Pure. */
export function parsePasscodePolicyPayload(
  value: unknown,
): PayloadParseResult<PasscodePolicyPayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const unknown = unknownFieldIn(value, ["minLength", "requireAlphanumeric"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const minLength = requireIntegerField(value, "minLength", 0, 16);
  if (!minLength.ok) return minLength;
  const requireAlphanumeric = requireBoolean(value, "requireAlphanumeric");
  if (!requireAlphanumeric.ok) return requireAlphanumeric;
  return parseOk({ minLength: minLength.payload, requireAlphanumeric: requireAlphanumeric.payload });
}

/**
 * A mobile enforce payload: apply a passcode policy or a restrictions
 * profile (an enumerable list of restriction ids — e.g.
 * "allow-camera", "disable-safari" — machine-stable, vendor-neutral).
 */
export type MobileEnforcePayload =
  | { readonly policyArea: "passcode"; readonly policy: PasscodePolicyPayload }
  | { readonly policyArea: "restrictions"; readonly restrictions: readonly string[] };

/** Parse an opaque value as a `MobileEnforcePayload`. Pure. */
export function parseMobileEnforcePayload(
  value: unknown,
): PayloadParseResult<MobileEnforcePayload> {
  if (!isPlainObject(value)) return parseFail("expected an object", "/");
  const policyArea = requireStringEnum(value, "policyArea", ["passcode", "restrictions"] as const);
  if (!policyArea.ok) return policyArea;
  if (policyArea.payload === "passcode") {
    const unknown = unknownFieldIn(value, ["policyArea", "policy"]);
    if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
    const policy = requirePlainObject(value, "policy");
    if (!policy.ok) return policy;
    const parsed = parsePasscodePolicyPayload(policy.payload);
    if (!parsed.ok) return parsed;
    return parseOk({ policyArea: "passcode", policy: parsed.payload });
  }
  const unknown = unknownFieldIn(value, ["policyArea", "restrictions"]);
  if (unknown !== undefined) return parseFail(`unknown field "${unknown}"`, `/${unknown}`);
  const restrictions = requireNonEmptyStringArray(value, "restrictions");
  if (!restrictions.ok) return restrictions;
  return parseOk({ policyArea: "restrictions", restrictions: restrictions.payload });
}

function requireIntegerField(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): PayloadParseResult<number> {
  if (typeof record[field] !== "number" || !Number.isInteger(record[field]) ||
      (record[field] as number) < minimum || (record[field] as number) > maximum) {
    return parseFail(`expected an integer in [${minimum}, ${maximum}]`, `/${field}`);
  }
  return parseOk(record[field] as number);
}

// ---------------------------------------------------------------------------
// D1.6 — The capability -> payload-kind map + the unified parser
// ---------------------------------------------------------------------------

/** Every mobile command payload kind. */
export type MobileCommandPayloadKind =
  | "managed-app"
  | "mobile-enforce"
  | "os-update-policy"
  | "device-lock"
  | "lost-mode"
  | "locate-request"
  | "wipe";

/** The union of every mobile command payload contract. */
export type MobileCommandPayload =
  | ManagedAppCommandPayload
  | MobileEnforcePayload
  | OsUpdatePolicyPayload
  | DeviceLockCommandPayload
  | LostModeCommandPayload
  | LocateRequestPayload
  | WipeCommandPayload;

/**
 * The payload kinds each mobile capability accepts (the lane-local
 * capability -> payload contract map). Only mobile-envelope capabilities
 * have entries; the order is the canonical parse order (deterministic).
 */
export const MOBILE_CAPABILITY_PAYLOAD_KINDS: Readonly<
  Partial<Record<AdapterCapability, readonly MobileCommandPayloadKind[]>>
> = frozen({
  enforce: frozenArray(["managed-app", "mobile-enforce"]),
  update: frozenArray(["os-update-policy"]),
  lock: frozenArray(["lost-mode", "device-lock"]),
  locate: frozenArray(["locate-request"]),
  wipe: frozenArray(["wipe"]),
} as const);

/** The parsed mobile command payload: the kind plus the narrowed payload. */
export type ParsedMobileCommandPayload =
  | { readonly kind: "managed-app"; readonly payload: ManagedAppCommandPayload }
  | { readonly kind: "mobile-enforce"; readonly payload: MobileEnforcePayload }
  | { readonly kind: "os-update-policy"; readonly payload: OsUpdatePolicyPayload }
  | { readonly kind: "device-lock"; readonly payload: DeviceLockCommandPayload }
  | { readonly kind: "lost-mode"; readonly payload: LostModeCommandPayload }
  | { readonly kind: "locate-request"; readonly payload: LocateRequestPayload }
  | { readonly kind: "wipe"; readonly payload: WipeCommandPayload };

/**
 * Parse an opaque command payload for a mobile capability: try the
 * capability's accepted payload kinds in canonical order; the first
 * validator that accepts the value wins. A payload no accepted kind
 * validates fails closed with a machine-stable reason (the in-memory
 * family seam turns this into a failed platform command — never an
 * emulated success).
 *
 * Deterministic: the kind order comes from
 * `MOBILE_CAPABILITY_PAYLOAD_KINDS` (frozen).
 */
export function parseMobileCommandPayload(
  capability: AdapterCapability,
  value: unknown,
): PayloadParseResult<ParsedMobileCommandPayload> {
  const accepted = MOBILE_CAPABILITY_PAYLOAD_KINDS[capability];
  if (accepted === undefined) {
    return parseFail(
      `capability "${capability}" accepts no mobile command payload (outside the mobile payload contract)`,
      "/capability",
    );
  }
  const failures: string[] = [];
  for (const kind of accepted) {
    const parsed = parseByKind(kind, value);
    if (parsed.ok) return parsed;
    failures.push(`${kind}: ${parsed.reason}${parsed.field ? ` at ${parsed.field}` : ""}`);
  }
  return parseFail(
    `payload matches none of the accepted kinds for capability "${capability}" (${failures.join("; ")})`,
    "/",
  );
}

function parseByKind(
  kind: MobileCommandPayloadKind,
  value: unknown,
): PayloadParseResult<ParsedMobileCommandPayload> {
  switch (kind) {
    case "managed-app": {
      const parsed = parseManagedAppCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "mobile-enforce": {
      const parsed = parseMobileEnforcePayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "os-update-policy": {
      const parsed = parseOsUpdatePolicyPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "device-lock": {
      const parsed = parseDeviceLockCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "lost-mode": {
      const parsed = parseLostModeCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "locate-request": {
      const parsed = parseLocateRequestPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
    case "wipe": {
      const parsed = parseWipeCommandPayload(value);
      return parsed.ok ? parseOk({ kind, payload: parsed.payload }) : parsed;
    }
  }
}

// ---------------------------------------------------------------------------
// D1.7 — Determinism helper
// ---------------------------------------------------------------------------

/**
 * Whether an opaque value is structurally valid for a mobile capability
 * (the pure predicate over `parseMobileCommandPayload`). Useful at
 * adapter/dispatch boundaries that only need the boolean.
 */
export function isMobileCommandPayload(
  capability: AdapterCapability,
  value: unknown,
): boolean {
  return parseMobileCommandPayload(capability, value).ok;
}
