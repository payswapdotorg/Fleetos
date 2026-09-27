/**
 * @fleetos/device-adapters — W030 D1/D2: Adapter family descriptors +
 * capability profiles (mobile + printer/copier).
 *
 * Per `spec/ARCHITECTURE.md` § Device adapters, the initial adapter
 * families include iOS/iPadOS management, Android Enterprise and
 * printer/copier/network-device connectors (the Windows/macOS/Linux
 * desktop families landed with W020). A family declares an EXPLICIT,
 * TYPED capability profile: which normalized capabilities (identify,
 * observe, diagnose, enforce, remediate, lock, locate, wipe, reboot,
 * update, health) the family supports — and, just as important, which
 * it does NOT.
 *
 * **Critical invariant (ARCHITECTURE-LOCK.md item 16):** unsupported
 * destructive behavior may NEVER be emulated. The printer/copier family
 * profile therefore declares `lock` / `locate` / `wipe` FORBIDDEN: a
 * printer/copier adapter cannot even be CONSTRUCTED with those
 * capabilities declared, and every runtime invocation of them is refused
 * by the W020 capability negotiation inside each adapter method.
 *
 * Family capability envelopes:
 *
 *   mobile (ios / ipados / android)
 *     identify, observe, diagnose, health            — inventory + evidence
 *     enforce                                        — passcode/restrictions/managed apps
 *     lock, locate, wipe, update                     — the MDM-shaped management set
 *     (remediate, reboot are OUTSIDE the mobile envelope for this wave —
 *      there is no first-class MDM remediate/reboot command in the
 *      normalized sense; they arrive with vendor-specific extensions.)
 *
 *   printer-copier (SNMP / vendor boundary)
 *     identify, observe, diagnose, health            — observability-centric
 *     enforce                                        — LIMITED: cancel-job /
 *     clear-queue / apply-config through the vendor + SNMP boundaries
 *     lock, locate, wipe                             — FORBIDDEN, refused, never emulated
 *     reboot, update                                 — VENDOR-MODEL-OPTIONAL: a vendor
 *                                                       model descriptor may declare them
 *                                                       (e.g. enterprise MFP APIs); they are
 *                                                       never family-wide.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 */

import {
  ALL_ADAPTER_CAPABILITIES,
  type AdapterCapabilities,
} from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type { AdapterCapability } from "./adapter";

// ---------------------------------------------------------------------------
// D1/D2.1 — Family identifiers (the family-bound platforms)
// ---------------------------------------------------------------------------

/**
 * The mobile adapter family ids (per `spec/ARCHITECTURE.md` § Device
 * adapters: "iOS/iPadOS management", "Android Enterprise"). A family id
 * is ALSO the adapter platform literal the family's seam is
 * discriminated on (the W030 extension of the W020 `AdapterPlatform`
 * union).
 */
export type MobileFamilyId = "ios" | "ipados" | "android";

/**
 * The printer/copier adapter family id (per `spec/ARCHITECTURE.md` §
 * Device adapters: "printer/copier/network-device connectors"). One
 * family covers the SNMP and vendor-API connector boundaries for
 * network-attached printers, copiers and multi-function peripherals.
 */
export type PrinterCopierFamilyId = "printer-copier";

/**
 * Any W030 adapter family id. Family ids extend the W020 platform union:
 * an endpoint descriptor's `platform` names the family that fronts it.
 */
export type AdapterFamilyId = MobileFamilyId | PrinterCopierFamilyId;

/** The canonical list of mobile family ids (frozen). */
export const MOBILE_FAMILY_IDS: readonly MobileFamilyId[] = frozenArray([
  "ios",
  "ipados",
  "android",
]);

/** The printer/copier family id (frozen singleton list for symmetry). */
export const PRINTER_COPIER_FAMILY_IDS: readonly PrinterCopierFamilyId[] = frozenArray([
  "printer-copier",
]);

/** Every W030 adapter family id (frozen). */
export const ADAPTER_FAMILY_IDS: readonly AdapterFamilyId[] = frozenArray([
  ...MOBILE_FAMILY_IDS,
  ...PRINTER_COPIER_FAMILY_IDS,
]);

/** Pure predicate: is the value a mobile family id? */
export function isMobileFamilyId(value: string): value is MobileFamilyId {
  return MOBILE_FAMILY_IDS.includes(value as MobileFamilyId);
}

/** Pure predicate: is the value the printer/copier family id? */
export function isPrinterCopierFamilyId(value: string): value is PrinterCopierFamilyId {
  return value === "printer-copier";
}

/** Pure predicate: is the value any W030 adapter family id? */
export function isAdapterFamilyId(value: string): value is AdapterFamilyId {
  return isMobileFamilyId(value) || isPrinterCopierFamilyId(value);
}

// ---------------------------------------------------------------------------
// D1/D2.2 — Family capability profiles (explicit + typed)
// ---------------------------------------------------------------------------

/**
 * A family's EXPLICIT capability profile: the frozen
 * `AdapterCapabilities` flag set the family supports, plus the derived
 * enumerable `supported` / `unsupported` sets (explicit, typed, and
 * impossible to desynchronize — built only by the profile builders
 * below).
 */
export interface FamilyCapabilityProfile {
  /** The family this profile belongs to. */
  readonly familyId: AdapterFamilyId;
  /** The frozen capability flag set the family supports. */
  readonly capabilities: AdapterCapabilities;
  /** Explicit enumerable set of supported capabilities. */
  readonly supported: readonly AdapterCapability[];
  /** Explicit enumerable set of unsupported capabilities. */
  readonly unsupported: readonly AdapterCapability[];
}

/**
 * Build a family capability profile from a family id + capability flag
 * set. Pure, deterministic, frozen. Derives the `supported` /
 * `unsupported` enumerable sets by iterating the frozen canonical
 * `ALL_ADAPTER_CAPABILITIES` list (same discipline as W010's
 * `declareAgentCapabilities`).
 */
export function buildFamilyCapabilityProfile(
  familyId: AdapterFamilyId,
  capabilities: AdapterCapabilities,
): FamilyCapabilityProfile {
  const supported: AdapterCapability[] = [];
  const unsupported: AdapterCapability[] = [];
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    if (capabilities[capability] === true) {
      supported.push(capability);
    } else {
      unsupported.push(capability);
    }
  }
  return frozen({
    familyId,
    capabilities: frozen({ ...capabilities }) as AdapterCapabilities,
    supported: frozenArray(supported),
    unsupported: frozenArray(unsupported),
  });
}

/**
 * The mobile family capability ENVELOPE — the maximum capability set a
 * mobile (ios/ipados/android) adapter may declare. Mobile management
 * families typically support lock/locate/wipe/update/observe/identify/
 * health; this envelope additionally carries `diagnose` (device
 * information queries / bug reports) and `enforce` (passcode,
 * restrictions, managed apps) — both first-class MDM surfaces.
 * `remediate` and `reboot` stay OUTSIDE the envelope this wave.
 */
export const MOBILE_FAMILY_CAPABILITIES: AdapterCapabilities = frozen({
  identify: true,
  observe: true,
  diagnose: true,
  enforce: true,
  lock: true,
  locate: true,
  wipe: true,
  update: true,
  health: true,
} as const);

/** The mobile family's explicit profile (derived, frozen). */
export const MOBILE_FAMILY_PROFILE: FamilyCapabilityProfile = buildFamilyCapabilityProfile(
  "ios", // the profile is shared across ios/ipados/android
  MOBILE_FAMILY_CAPABILITIES,
);

/**
 * The printer/copier family capability ENVELOPE (BASE) — observe/health/
 * diagnose-centric with LIMITED enforce (cancel-job / clear-queue /
 * apply-config through the SNMP + vendor boundaries). `lock`, `locate`
 * and `wipe` are FORBIDDEN (see `PRINTER_COPIER_FORBIDDEN_CAPABILITIES`)
 * and `reboot` / `update` are vendor-model-optional (see
 * `PRINTER_VENDOR_OPTIONAL_CAPABILITIES`) — neither is family-wide.
 */
export const PRINTER_COPIER_FAMILY_CAPABILITIES: AdapterCapabilities = frozen({
  identify: true,
  observe: true,
  diagnose: true,
  enforce: true,
  health: true,
} as const);

/** The printer/copier family's explicit base profile (derived, frozen). */
export const PRINTER_COPIER_FAMILY_PROFILE: FamilyCapabilityProfile =
  buildFamilyCapabilityProfile("printer-copier", PRINTER_COPIER_FAMILY_CAPABILITIES);

/**
 * The capabilities that are FORBIDDEN for the printer/copier family —
 * lock, locate, wipe. These are unsupported destructive behaviors that
 * may NEVER be emulated: an adapter for a printer/copier endpoint cannot
 * be constructed with any of them declared, and every runtime invocation
 * is refused by the W020 capability negotiation inside each method.
 */
export const PRINTER_COPIER_FORBIDDEN_CAPABILITIES: readonly AdapterCapability[] =
  frozenArray(["lock", "locate", "wipe"]);

/**
 * The capabilities a printer/copier VENDOR MODEL may optionally back
 * (declared per vendor model, never family-wide): `reboot` (vendor
 * remote-restart API) and `update` (vendor firmware update API).
 */
export const PRINTER_VENDOR_OPTIONAL_CAPABILITIES: readonly AdapterCapability[] =
  frozenArray(["reboot", "update"]);

/**
 * The printer/copier family envelope for a specific vendor model: the
 * family base capabilities plus the vendor model's optional capabilities.
 * Pure function of the vendor model descriptor.
 */
export function printerCopierFamilyEnvelopeFor(
  vendorModel: PrinterVendorModelDescriptor,
): AdapterCapabilities {
  return frozen({
    ...PRINTER_COPIER_FAMILY_CAPABILITIES,
    ...capabilitiesFlagsFor(vendorModel.optionalCapabilities),
  }) as AdapterCapabilities;
}

function capabilitiesFlagsFor(
  capabilities: readonly AdapterCapability[],
): Partial<Record<AdapterCapability, true>> {
  const flags: Partial<Record<AdapterCapability, true>> = {};
  for (const capability of capabilities) flags[capability] = true;
  return flags;
}

// ---------------------------------------------------------------------------
// D1.3 — Mobile family descriptors
// ---------------------------------------------------------------------------

/** The MDM protocol surface a mobile family fronts. */
export type MobileMdmProtocol = "apple-mdm" | "android-enterprise";

/**
 * A mobile adapter family descriptor: which family, its display name,
 * the MDM protocol boundary it speaks, and its explicit capability
 * profile.
 */
export interface MobileFamilyDescriptor {
  /** The mobile family id (also the adapter platform literal). */
  readonly familyId: MobileFamilyId;
  /** Human-readable family name. */
  readonly displayName: string;
  /** The MDM protocol boundary (Apple MDM vs Android Enterprise). */
  readonly mdmProtocol: MobileMdmProtocol;
  /** The family's explicit capability profile. */
  readonly profile: FamilyCapabilityProfile;
}

/** The iOS family descriptor (frozen constant). */
export const IOS_FAMILY_DESCRIPTOR: MobileFamilyDescriptor = frozen({
  familyId: "ios",
  displayName: "iOS management",
  mdmProtocol: "apple-mdm",
  profile: buildFamilyCapabilityProfile("ios", MOBILE_FAMILY_CAPABILITIES),
});

/** The iPadOS family descriptor (frozen constant). */
export const IPADOS_FAMILY_DESCRIPTOR: MobileFamilyDescriptor = frozen({
  familyId: "ipados",
  displayName: "iPadOS management",
  mdmProtocol: "apple-mdm",
  profile: buildFamilyCapabilityProfile("ipados", MOBILE_FAMILY_CAPABILITIES),
});

/** The Android Enterprise family descriptor (frozen constant). */
export const ANDROID_FAMILY_DESCRIPTOR: MobileFamilyDescriptor = frozen({
  familyId: "android",
  displayName: "Android Enterprise",
  mdmProtocol: "android-enterprise",
  profile: buildFamilyCapabilityProfile("android", MOBILE_FAMILY_CAPABILITIES),
});

/** The mobile family descriptors keyed by family id (frozen). */
export const MOBILE_FAMILY_DESCRIPTORS: Readonly<Record<MobileFamilyId, MobileFamilyDescriptor>> =
  frozen({
    ios: IOS_FAMILY_DESCRIPTOR,
    ipados: IPADOS_FAMILY_DESCRIPTOR,
    android: ANDROID_FAMILY_DESCRIPTOR,
  });

/** Look up a mobile family descriptor by family id (undefined if unknown). */
export function mobileFamilyDescriptorFor(
  familyId: string,
): MobileFamilyDescriptor | undefined {
  return isMobileFamilyId(familyId) ? MOBILE_FAMILY_DESCRIPTORS[familyId] : undefined;
}

// ---------------------------------------------------------------------------
// D2.3 — Printer/copier vendor-model descriptors
// ---------------------------------------------------------------------------

/** A connector boundary a printer/copier vendor model exposes. */
export type PrinterConnectorBoundary = "snmp" | "vendor-api";

/** The optional capabilities a vendor model may back (reboot / update). */
export type PrinterOptionalCapability = (typeof PRINTER_VENDOR_OPTIONAL_CAPABILITIES)[number];

/** Inputs for `createPrinterVendorModelDescriptor`. */
export interface PrinterVendorModelDescriptorInputs {
  /** Stable vendor identifier (e.g. "hp", "canon", "ricoh"). */
  readonly vendorId: string;
  /** Stable vendor model identifier (e.g. "laserjet-m553"). */
  readonly modelId: string;
  /** Optional human-readable display name. */
  readonly displayName?: string;
  /** The connector boundaries this model exposes (at least one). */
  readonly connectorBoundaries: readonly PrinterConnectorBoundary[];
  /** The optional family capabilities this model backs (reboot/update). */
  readonly optionalCapabilities?: readonly PrinterOptionalCapability[];
  /** Whether the model exposes consumable-level monitoring OIDs. */
  readonly consumableMonitoring: boolean;
}

/**
 * A printer/copier vendor-model descriptor: the vendor+model identity,
 * which connector boundaries (SNMP, vendor API) the model exposes, which
 * OPTIONAL family capabilities (reboot, update) the model backs, and
 * whether consumable-level monitoring is available. The family BASE
 * capabilities (identify/observe/diagnose/health/enforce) are assumed
 * backed by at least one connector boundary; lock/locate/wipe can never
 * be backed (family-forbidden).
 */
export interface PrinterVendorModelDescriptor extends PrinterVendorModelDescriptorInputs {
  readonly optionalCapabilities: readonly PrinterOptionalCapability[];
  readonly connectorBoundaries: readonly PrinterConnectorBoundary[];
}

/**
 * Construct a validated `PrinterVendorModelDescriptor`. Pure,
 * deterministic, frozen.
 *
 * @throws Error on invalid inputs (programmer error): empty ids, no
 *   connector boundary, unknown optional capability, `reboot`/`update`
 *   declared without the `vendor-api` boundary (they are vendor-API
 *   capabilities — declaring them SNMP-only would emulated behavior).
 */
export function createPrinterVendorModelDescriptor(
  inputs: PrinterVendorModelDescriptorInputs,
): PrinterVendorModelDescriptor {
  if (typeof inputs.vendorId !== "string" || inputs.vendorId.length === 0) {
    throw new Error("createPrinterVendorModelDescriptor: vendorId must be a non-empty string");
  }
  if (typeof inputs.modelId !== "string" || inputs.modelId.length === 0) {
    throw new Error("createPrinterVendorModelDescriptor: modelId must be a non-empty string");
  }
  if (inputs.displayName !== undefined && (typeof inputs.displayName !== "string" || inputs.displayName.length === 0)) {
    throw new Error("createPrinterVendorModelDescriptor: displayName must be a non-empty string when present");
  }
  if (
    !Array.isArray(inputs.connectorBoundaries) ||
    inputs.connectorBoundaries.length === 0 ||
    inputs.connectorBoundaries.some((boundary) => boundary !== "snmp" && boundary !== "vendor-api")
  ) {
    throw new Error(
      "createPrinterVendorModelDescriptor: connectorBoundaries must be a non-empty list of snmp/vendor-api",
    );
  }
  const optional = inputs.optionalCapabilities ?? [];
  if (
    optional.some(
      (capability) => !PRINTER_VENDOR_OPTIONAL_CAPABILITIES.includes(capability),
    )
  ) {
    throw new Error(
      `createPrinterVendorModelDescriptor: optionalCapabilities must be a subset of [${PRINTER_VENDOR_OPTIONAL_CAPABILITIES.join(", ")}]`,
    );
  }
  if (optional.length > 0 && !inputs.connectorBoundaries.includes("vendor-api")) {
    throw new Error(
      "createPrinterVendorModelDescriptor: optional capabilities (reboot/update) require the vendor-api connector boundary — an SNMP-only model cannot back them (unsupported behavior may never be emulated)",
    );
  }
  if (typeof inputs.consumableMonitoring !== "boolean") {
    throw new Error("createPrinterVendorModelDescriptor: consumableMonitoring must be a boolean");
  }
  return frozen({
    vendorId: inputs.vendorId,
    modelId: inputs.modelId,
    displayName: inputs.displayName,
    connectorBoundaries: frozenArray(inputs.connectorBoundaries),
    optionalCapabilities: frozenArray(optional),
    consumableMonitoring: inputs.consumableMonitoring,
  });
}

// ---------------------------------------------------------------------------
// D1/D2.4 — Family capability validation (the envelope gate)
// ---------------------------------------------------------------------------

/** The reason a family capability validation failed. */
export type FamilyCapabilityValidationReason =
  | "outside_family_envelope"
  | "forbidden_capability"
  | "vendor_model_does_not_back_capability";

/**
 * The result of validating a capability flag set against a family
 * envelope. Tagged-union so callers can branch without try/catch.
 */
export type FamilyCapabilityValidation =
  | { ok: true }
  | {
      ok: false;
      readonly reason: FamilyCapabilityValidationReason;
      /** The offending capabilities, in canonical order. */
      readonly capabilities: readonly AdapterCapability[];
    };

/**
 * Validate a capability flag set against the MOBILE family envelope.
 * Every supported capability must be inside the mobile envelope —
 * `remediate` / `reboot` are outside it (this wave). A subset is fine:
 * per-device mobile adapters may declare fewer capabilities (e.g. a
 * BYOD-enrolled device without `wipe`).
 */
export function validateMobileFamilyCapabilities(
  capabilities: AdapterCapabilities,
): FamilyCapabilityValidation {
  const outside: AdapterCapability[] = [];
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    if (capabilities[capability] === true && MOBILE_FAMILY_CAPABILITIES[capability] !== true) {
      outside.push(capability);
    }
  }
  if (outside.length > 0) {
    return frozen({ ok: false as const, reason: "outside_family_envelope" as const, capabilities: frozenArray(outside) });
  }
  return frozen({ ok: true as const });
}

/**
 * Validate a capability flag set against the PRINTER/COPIER family
 * envelope for a specific vendor model (base + vendor-model optional).
 *
 *   - `lock` / `locate` / `wipe` are FORBIDDEN (never emulated) — a
 *     dedicated `forbidden_capability` reason names them explicitly.
 *   - `reboot` / `update` require the vendor model to back them
 *     (`vendor_model_does_not_back_capability` otherwise).
 *   - Anything else outside the family base is
 *     `outside_family_envelope`.
 */
export function validatePrinterCopierFamilyCapabilities(
  capabilities: AdapterCapabilities,
  vendorModel: PrinterVendorModelDescriptor,
): FamilyCapabilityValidation {
  const forbidden: AdapterCapability[] = [];
  const notBacked: AdapterCapability[] = [];
  const outside: AdapterCapability[] = [];
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    if (capabilities[capability] !== true) continue;
    if (PRINTER_COPIER_FORBIDDEN_CAPABILITIES.includes(capability)) {
      forbidden.push(capability);
    } else if (
      PRINTER_VENDOR_OPTIONAL_CAPABILITIES.includes(capability) &&
      !vendorModel.optionalCapabilities.includes(capability as PrinterOptionalCapability)
    ) {
      notBacked.push(capability);
    } else if (
      PRINTER_COPIER_FAMILY_CAPABILITIES[capability] !== true &&
      !PRINTER_VENDOR_OPTIONAL_CAPABILITIES.includes(capability)
    ) {
      outside.push(capability);
    }
  }
  if (forbidden.length > 0) {
    return frozen({ ok: false as const, reason: "forbidden_capability" as const, capabilities: frozenArray(forbidden) });
  }
  if (notBacked.length > 0) {
    return frozen({
      ok: false as const,
      reason: "vendor_model_does_not_back_capability" as const,
      capabilities: frozenArray(notBacked),
    });
  }
  if (outside.length > 0) {
    return frozen({ ok: false as const, reason: "outside_family_envelope" as const, capabilities: frozenArray(outside) });
  }
  return frozen({ ok: true as const });
}

/**
 * Pure predicate: does the mobile family envelope contain the capability?
 */
export function isMobileFamilyCapability(capability: AdapterCapability): boolean {
  return MOBILE_FAMILY_CAPABILITIES[capability] === true;
}

/**
 * Pure predicate: is the capability FORBIDDEN for the printer/copier
 * family (lock/locate/wipe — refused, never emulated)?
 */
export function isPrinterCopierForbiddenCapability(capability: AdapterCapability): boolean {
  return PRINTER_COPIER_FORBIDDEN_CAPABILITIES.includes(capability);
}
