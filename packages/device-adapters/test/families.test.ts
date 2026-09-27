/**
 * W030 D1/D2 tests — adapter family descriptors + capability profiles.
 *
 * The family contracts are explicit and typed: the mobile envelope, the
 * printer/copier base + forbidden + vendor-model-optional sets, the
 * family descriptors, the vendor-model descriptors, and the envelope
 * validation helpers.
 */

import { test, expect } from "bun:test";
import { ALL_ADAPTER_CAPABILITIES, isSupported, type AdapterCapabilities } from "@fleetos/contracts";
import {
  ADAPTER_FAMILY_IDS,
  ANDROID_FAMILY_DESCRIPTOR,
  buildFamilyCapabilityProfile,
  IPADOS_FAMILY_DESCRIPTOR,
  IOS_FAMILY_DESCRIPTOR,
  isAdapterFamilyId,
  isMobileFamilyCapability,
  isMobileFamilyId,
  isPrinterCopierFamilyId,
  isPrinterCopierForbiddenCapability,
  MOBILE_FAMILY_CAPABILITIES,
  MOBILE_FAMILY_IDS,
  MOBILE_FAMILY_PROFILE,
  PRINTER_COPIER_FAMILY_CAPABILITIES,
  PRINTER_COPIER_FAMILY_IDS,
  PRINTER_COPIER_FAMILY_PROFILE,
  PRINTER_COPIER_FORBIDDEN_CAPABILITIES,
  PRINTER_VENDOR_OPTIONAL_CAPABILITIES,
  printerCopierFamilyEnvelopeFor,
  validateMobileFamilyCapabilities,
  validatePrinterCopierFamilyCapabilities,
  createPrinterVendorModelDescriptor,
} from "../src/families";
import type { AdapterCapability } from "../src/adapter";
import {
  familyEnvelopeForPlatform,
  forbiddenCapabilitiesForPlatform,
  isCapabilityInFamilyEnvelope,
} from "../src/family-adapters";
import { ERROR_CODES } from "../src/internal";

// ---------------------------------------------------------------------------
// Family identifiers
// ---------------------------------------------------------------------------

test("families: the mobile family ids are ios/ipados/android", () => {
  expect([...MOBILE_FAMILY_IDS]).toEqual(["ios", "ipados", "android"]);
});

test("families: the printer/copier family is a single id", () => {
  expect([...PRINTER_COPIER_FAMILY_IDS]).toEqual(["printer-copier"]);
  expect(isPrinterCopierFamilyId("printer-copier")).toBe(true);
  expect(isPrinterCopierFamilyId("ios")).toBe(false);
});

test("families: ADAPTER_FAMILY_IDS is the union of both groups, frozen", () => {
  expect([...ADAPTER_FAMILY_IDS]).toEqual(["ios", "ipados", "android", "printer-copier"]);
  expect(Object.isFrozen(ADAPTER_FAMILY_IDS)).toBe(true);
  expect(isAdapterFamilyId("android")).toBe(true);
  expect(isAdapterFamilyId("windows")).toBe(false);
  expect(isAdapterFamilyId("")).toBe(false);
});

test("families: isMobileFamilyId accepts only mobile ids", () => {
  expect(isMobileFamilyId("ios")).toBe(true);
  expect(isMobileFamilyId("ipados")).toBe(true);
  expect(isMobileFamilyId("android")).toBe(true);
  expect(isMobileFamilyId("printer-copier")).toBe(false);
  expect(isMobileFamilyId("macos")).toBe(false);
});

// ---------------------------------------------------------------------------
// Capability profiles (explicit + typed)
// ---------------------------------------------------------------------------

test("families: the mobile envelope carries the typical MDM set (lock/locate/wipe/update/observe/identify/health + diagnose/enforce)", () => {
  for (const capability of [
    "identify",
    "observe",
    "diagnose",
    "health",
    "enforce",
    "lock",
    "locate",
    "wipe",
    "update",
  ] as const) {
    expect(isSupported(capability, MOBILE_FAMILY_CAPABILITIES)).toBe(true);
  }
  // remediate/reboot are OUTSIDE the mobile envelope this wave.
  expect(isSupported("remediate", MOBILE_FAMILY_CAPABILITIES)).toBe(false);
  expect(isSupported("reboot", MOBILE_FAMILY_CAPABILITIES)).toBe(false);
});

test("families: the mobile profile's supported/unsupported sets partition ALL_ADAPTER_CAPABILITIES", () => {
  const profile = MOBILE_FAMILY_PROFILE;
  expect(profile.supported.length + profile.unsupported.length).toBe(ALL_ADAPTER_CAPABILITIES.length);
  for (const capability of profile.supported) {
    expect(profile.unsupported.includes(capability)).toBe(false);
  }
  expect([...profile.unsupported].sort()).toEqual(["reboot", "remediate"]);
  expect(Object.isFrozen(profile.capabilities)).toBe(true);
  expect(Object.isFrozen(profile.supported)).toBe(true);
});

test("families: the printer/copier base is observe/health/diagnose-centric with limited enforce", () => {
  for (const capability of ["identify", "observe", "diagnose", "health", "enforce"] as const) {
    expect(isSupported(capability, PRINTER_COPIER_FAMILY_CAPABILITIES)).toBe(true);
  }
  // lock/locate/wipe/remediate/reboot/update are NOT in the base.
  for (const capability of ["lock", "locate", "wipe", "remediate", "reboot", "update"] as const) {
    expect(isSupported(capability, PRINTER_COPIER_FAMILY_CAPABILITIES)).toBe(false);
  }
});

test("families: lock/locate/wipe are FORBIDDEN for printer/copier — never emulated", () => {
  expect([...PRINTER_COPIER_FORBIDDEN_CAPABILITIES]).toEqual(["lock", "locate", "wipe"]);
  for (const capability of PRINTER_COPIER_FORBIDDEN_CAPABILITIES) {
    expect(isPrinterCopierForbiddenCapability(capability)).toBe(true);
    expect(isSupported(capability, PRINTER_COPIER_FAMILY_CAPABILITIES)).toBe(false);
  }
  expect(isPrinterCopierForbiddenCapability("enforce")).toBe(false);
});

test("families: reboot/update are the vendor-model-optional capabilities", () => {
  expect([...PRINTER_VENDOR_OPTIONAL_CAPABILITIES]).toEqual(["reboot", "update"]);
});

test("families: buildFamilyCapabilityProfile derives frozen enumerable sets", () => {
  const capabilities: AdapterCapabilities = { observe: true, wipe: true };
  const profile = buildFamilyCapabilityProfile("ios", capabilities);
  expect(profile.familyId).toBe("ios");
  expect([...profile.supported]).toEqual(["observe", "wipe"]);
  expect(profile.supported.length + profile.unsupported.length).toBe(ALL_ADAPTER_CAPABILITIES.length);
  expect(Object.isFrozen(profile)).toBe(true);
});

// ---------------------------------------------------------------------------
// Family descriptors
// ---------------------------------------------------------------------------

test("families: the mobile family descriptors carry ids, MDM protocols and explicit profiles", () => {
  expect(IOS_FAMILY_DESCRIPTOR.familyId).toBe("ios");
  expect(IOS_FAMILY_DESCRIPTOR.mdmProtocol).toBe("apple-mdm");
  expect(IPADOS_FAMILY_DESCRIPTOR.mdmProtocol).toBe("apple-mdm");
  expect(ANDROID_FAMILY_DESCRIPTOR.familyId).toBe("android");
  expect(ANDROID_FAMILY_DESCRIPTOR.mdmProtocol).toBe("android-enterprise");
  for (const descriptor of [IOS_FAMILY_DESCRIPTOR, IPADOS_FAMILY_DESCRIPTOR, ANDROID_FAMILY_DESCRIPTOR]) {
    expect(descriptor.profile.supported.length).toBe(9);
    expect(Object.isFrozen(descriptor)).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Vendor-model descriptors
// ---------------------------------------------------------------------------

test("families: createPrinterVendorModelDescriptor validates and freezes", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "hp",
    modelId: "laserjet-m553",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: ["reboot", "update"],
    consumableMonitoring: true,
  });
  expect(model.vendorId).toBe("hp");
  expect(model.modelId).toBe("laserjet-m553");
  expect([...model.connectorBoundaries]).toEqual(["snmp", "vendor-api"]);
  expect([...model.optionalCapabilities]).toEqual(["reboot", "update"]);
  expect(model.consumableMonitoring).toBe(true);
  expect(Object.isFrozen(model)).toBe(true);
});

test("families: vendor-model construction refuses invalid inputs", () => {
  expect(() =>
    createPrinterVendorModelDescriptor({
      vendorId: "",
      modelId: "m",
      connectorBoundaries: ["snmp"],
      consumableMonitoring: true,
    }),
  ).toThrow("vendorId");
  expect(() =>
    createPrinterVendorModelDescriptor({
      vendorId: "hp",
      modelId: "m",
      connectorBoundaries: [],
      consumableMonitoring: true,
    }),
  ).toThrow("connectorBoundaries");
  expect(() =>
    createPrinterVendorModelDescriptor({
      vendorId: "hp",
      modelId: "m",
      connectorBoundaries: ["snmp"],
      optionalCapabilities: ["wipe" as "reboot"],
      consumableMonitoring: true,
    }),
  ).toThrow("optionalCapabilities");
});

test("families: optional capabilities require the vendor-api boundary (never emulated over SNMP)", () => {
  expect(() =>
    createPrinterVendorModelDescriptor({
      vendorId: "lexmark",
      modelId: "mono-laser",
      connectorBoundaries: ["snmp"],
      optionalCapabilities: ["reboot"],
      consumableMonitoring: true,
    }),
  ).toThrow("vendor-api");
  // SNMP-only model without optional capabilities is fine.
  const snmpOnly = createPrinterVendorModelDescriptor({
    vendorId: "lexmark",
    modelId: "mono-laser",
    connectorBoundaries: ["snmp"],
    consumableMonitoring: false,
  });
  expect(snmpOnly.optionalCapabilities.length).toBe(0);
});

test("families: printerCopierFamilyEnvelopeFor = base + vendor-model optional", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "ricoh",
    modelId: "im-c3000",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: ["reboot"],
    consumableMonitoring: true,
  });
  const envelope = printerCopierFamilyEnvelopeFor(model);
  expect(isSupported("identify", envelope)).toBe(true);
  expect(isSupported("enforce", envelope)).toBe(true);
  expect(isSupported("reboot", envelope)).toBe(true);
  expect(isSupported("update", envelope)).toBe(false); // not declared by THIS model
  expect(isSupported("wipe", envelope)).toBe(false);
});

// ---------------------------------------------------------------------------
// Family capability validation (the envelope gate)
// ---------------------------------------------------------------------------

test("families: validateMobileFamilyCapabilities accepts subsets of the envelope", () => {
  const full = validateMobileFamilyCapabilities(MOBILE_FAMILY_CAPABILITIES);
  expect(full.ok).toBe(true);
  const byod: AdapterCapabilities = { identify: true, observe: true, health: true, locate: true, update: true };
  expect(validateMobileFamilyCapabilities(byod).ok).toBe(true);
  const empty: AdapterCapabilities = {};
  expect(validateMobileFamilyCapabilities(empty).ok).toBe(true);
});

test("families: validateMobileFamilyCapabilities refuses capabilities outside the envelope", () => {
  const result = validateMobileFamilyCapabilities({ observe: true, remediate: true, reboot: true });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("outside_family_envelope");
    expect([...result.capabilities]).toEqual(["remediate", "reboot"]); // canonical order
  }
});

test("families: validatePrinterCopierFamilyCapabilities accepts base + backed optionals", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "canon",
    modelId: "ir-adv-c5550",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: ["reboot", "update"],
    consumableMonitoring: true,
  });
  expect(validatePrinterCopierFamilyCapabilities(PRINTER_COPIER_FAMILY_CAPABILITIES, model).ok).toBe(true);
  expect(
    validatePrinterCopierFamilyCapabilities({ observe: true, reboot: true, update: true }, model).ok,
  ).toBe(true);
});

test("families: validatePrinterCopierFamilyCapabilities REFUSES lock/locate/wipe with the forbidden reason", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "canon",
    modelId: "ir-adv-c5550",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: [],
    consumableMonitoring: true,
  });
  const result = validatePrinterCopierFamilyCapabilities({ observe: true, wipe: true, lock: true }, model);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("forbidden_capability");
    expect([...result.capabilities]).toEqual(["lock", "wipe"]);
  }
});

test("families: unbacked vendor optionals are refused (vendor_model_does_not_back_capability)", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "xerox",
    modelId: "versalink-c405",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: [],
    consumableMonitoring: true,
  });
  const result = validatePrinterCopierFamilyCapabilities({ reboot: true }, model);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("vendor_model_does_not_back_capability");
    expect([...result.capabilities]).toEqual(["reboot"]);
  }
});

test("families: capabilities outside the printer envelope are refused (remediate)", () => {
  const model = createPrinterVendorModelDescriptor({
    vendorId: "xerox",
    modelId: "versalink-c405",
    connectorBoundaries: ["snmp"],
    consumableMonitoring: true,
  });
  const result = validatePrinterCopierFamilyCapabilities({ remediate: true }, model);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("outside_family_envelope");
    expect([...result.capabilities]).toEqual(["remediate"]);
  }
});

// ---------------------------------------------------------------------------
// Family conformance predicates
// ---------------------------------------------------------------------------

test("families: familyEnvelopeForPlatform maps platforms to envelopes", () => {
  expect(familyEnvelopeForPlatform("ios")).toBe(MOBILE_FAMILY_CAPABILITIES);
  expect(familyEnvelopeForPlatform("ipados")).toBe(MOBILE_FAMILY_CAPABILITIES);
  expect(familyEnvelopeForPlatform("android")).toBe(MOBILE_FAMILY_CAPABILITIES);
  expect(familyEnvelopeForPlatform("printer-copier")).toBe(PRINTER_COPIER_FAMILY_CAPABILITIES);
  expect(familyEnvelopeForPlatform("windows")).toBeUndefined();
  expect(familyEnvelopeForPlatform("macos")).toBeUndefined();
});

test("families: isCapabilityInFamilyEnvelope + forbiddenCapabilitiesForPlatform", () => {
  expect(isCapabilityInFamilyEnvelope("ios", "wipe")).toBe(true);
  expect(isCapabilityInFamilyEnvelope("ios", "remediate")).toBe(false);
  expect(isCapabilityInFamilyEnvelope("printer-copier", "wipe")).toBe(false);
  expect(isCapabilityInFamilyEnvelope("windows", "wipe")).toBe(false);
  expect([...forbiddenCapabilitiesForPlatform("printer-copier")]).toEqual(["lock", "locate", "wipe"]);
  expect(forbiddenCapabilitiesForPlatform("ios").length).toBe(0);
  expect(forbiddenCapabilitiesForPlatform("linux").length).toBe(0);
  expect(isMobileFamilyCapability("wipe")).toBe(true);
  expect(isMobileFamilyCapability("reboot")).toBe(false);
});

test("families: the printer/copier profile is derived and frozen", () => {
  const profile = PRINTER_COPIER_FAMILY_PROFILE;
  expect(profile.familyId).toBe("printer-copier");
  expect([...profile.supported]).toEqual(["identify", "observe", "diagnose", "enforce", "health"]);
  expect(profile.supported.length + profile.unsupported.length).toBe(ALL_ADAPTER_CAPABILITIES.length);
});

test("families: internal error codes carry the family lane prefixes (sanity)", () => {
  // The family factories throw plain Errors (construction-time programmer
  // errors); the runtime refusal codes remain the W010/W020 taxonomy.
  expect(ERROR_CODES.capabilityUnsupported).toBe("agent.capability.unsupported");
  expect(ERROR_CODES.capabilityDestructiveUnauthorized).toBe("agent.capability.destructive_unauthorized");
  const capability: AdapterCapability = "wipe";
  expect(capability).toBe("wipe");
});
