/**
 * @fleetos/device-adapters — W030 D3/D4: Family adapter factories.
 *
 * Composition factories that construct family-conformant
 * `EndpointAdapter`s for the mobile (iOS/iPadOS/Android) and
 * printer/copier families on top of the W020 SDK:
 *
 *   family capability profile  ->  envelope validation at CONSTRUCTION
 *   ->  `createEndpointAdapter`  ->  capability negotiation inside every
 *   method (W020 machinery)  ->  per-method refusal semantics.
 *
 * The envelope validation makes the family profile a CONSTRUCTION-TIME
 * contract, not just a runtime negotiation:
 *
 *   - a mobile adapter may declare any SUBSET of the mobile family
 *     envelope (e.g. a BYOD-enrolled device without `wipe`), but never a
 *     capability outside it (`remediate`/`reboot` this wave);
 *   - a printer/copier adapter may declare the family base
 *     (identify/observe/diagnose/health/enforce) plus the vendor model's
 *     optional capabilities (`reboot`/`update`), and can NEVER declare
 *     `lock`/`locate`/`wipe` — the forbidden destructive capabilities
 *     are refused at construction AND at every runtime invocation
 *     (never emulated).
 *
 * The adapters themselves are ordinary W020 `EndpointAdapter`s: they
 * register through the W020 adapter registry unchanged and dispatch
 * through the W020 capability-aware dispatcher unchanged (D4 — proven
 * by composition tests).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 */

import type { AdapterCapabilities } from "@fleetos/contracts";
import { createEndpointAdapter } from "./adapter";
import type {
  AdapterCapability,
  EndpointAdapter,
  EndpointAdapterDescriptor,
} from "./adapter";
import type { ObservationCollector } from "./observations";
import {
  MOBILE_FAMILY_CAPABILITIES,
  PRINTER_COPIER_FAMILY_CAPABILITIES,
  PRINTER_COPIER_FORBIDDEN_CAPABILITIES,
  isMobileFamilyId,
  validateMobileFamilyCapabilities,
  validatePrinterCopierFamilyCapabilities,
} from "./families";
import type { PrinterVendorModelDescriptor } from "./families";
import type { MobileSeam } from "./seams-mobile";
import type { PrinterCopierSeam } from "./seams-printer";

// ---------------------------------------------------------------------------
// D3.1 — Mobile family adapter factory
// ---------------------------------------------------------------------------

/**
 * Options for `createMobileFamilyAdapter`. The descriptor's platform
 * MUST be a mobile family id (ios/ipados/android); the seams must be
 * the matching mobile seam; the capabilities must be a subset of the
 * mobile family envelope.
 */
export interface MobileFamilyAdapterOptions {
  /** The endpoint descriptor (platform: ios/ipados/android). */
  readonly descriptor: EndpointAdapterDescriptor;
  /** The mobile family seams (platform must match the descriptor). */
  readonly seams: MobileSeam;
  /** The declared capabilities (subset of the mobile family envelope). */
  readonly capabilities: AdapterCapabilities;
  /** ISO 8601 timestamp of the capability declaration (injected). */
  readonly declaredAt: string;
  /** Optional injected observation collector (default: one is created). */
  readonly collector?: ObservationCollector;
  /** Optional collector id seed (default: the device id). */
  readonly observationIdSeed?: string;
  /** Optional collector max batch size (default: 500). */
  readonly maxBatchSize?: number;
}

/**
 * Create a MOBILE family endpoint adapter (iOS/iPadOS/Android). Validates
 * the declared capabilities against the mobile family envelope (a subset
 * is required — e.g. a BYOD profile without `wipe`), then delegates to
 * the W020 `createEndpointAdapter`, which enforces capability
 * negotiation inside every method (unsupported capabilities and
 * unauthorized destructive capabilities are refused BEFORE any seam
 * call — never emulated).
 *
 * @throws Error when the options violate the family contract
 *   (programmer error): non-mobile platform, seam/descriptor platform
 *   mismatch, or a declared capability outside the mobile envelope.
 */
export function createMobileFamilyAdapter(options: MobileFamilyAdapterOptions): EndpointAdapter {
  const platform = options.descriptor.platform;
  if (!isMobileFamilyId(platform)) {
    throw new Error(
      `createMobileFamilyAdapter: descriptor.platform must be one of ios/ipados/android (got "${platform}")`,
    );
  }
  if (options.seams.platform !== platform) {
    throw new Error(
      `createMobileFamilyAdapter: seams.platform "${options.seams.platform}" does not match descriptor.platform "${platform}"`,
    );
  }
  const validation = validateMobileFamilyCapabilities(options.capabilities);
  if (!validation.ok) {
    throw new Error(
      `createMobileFamilyAdapter: capabilities outside the mobile family envelope refused at construction: [${validation.capabilities.join(", ")}] (mobile envelope: identify/observe/diagnose/enforce/lock/locate/wipe/update/health; unsupported behavior may never be emulated)`,
    );
  }
  return createEndpointAdapter({
    descriptor: options.descriptor,
    seams: options.seams,
    capabilities: options.capabilities,
    declaredAt: options.declaredAt,
    ...(options.collector !== undefined ? { collector: options.collector } : {}),
    ...(options.observationIdSeed !== undefined
      ? { observationIdSeed: options.observationIdSeed }
      : {}),
    ...(options.maxBatchSize !== undefined ? { maxBatchSize: options.maxBatchSize } : {}),
  });
}

// ---------------------------------------------------------------------------
// D3.2 — Printer/copier family adapter factory
// ---------------------------------------------------------------------------

/**
 * Options for `createPrinterCopierFamilyAdapter`. The descriptor's
 * platform MUST be `printer-copier`; the capabilities must be a subset
 * of the family base ∪ the vendor model's optional capabilities; the
 * forbidden capabilities (`lock`/`locate`/`wipe`) can never be declared.
 */
export interface PrinterCopierFamilyAdapterOptions {
  /** The endpoint descriptor (platform: printer-copier). */
  readonly descriptor: EndpointAdapterDescriptor;
  /** The printer/copier family seams. */
  readonly seams: PrinterCopierSeam;
  /** The declared capabilities (family base ∪ vendor-model optional). */
  readonly capabilities: AdapterCapabilities;
  /** The vendor model descriptor (backs the optional capabilities). */
  readonly vendorModel: PrinterVendorModelDescriptor;
  /** ISO 8601 timestamp of the capability declaration (injected). */
  readonly declaredAt: string;
  /** Optional injected observation collector (default: one is created). */
  readonly collector?: ObservationCollector;
  /** Optional collector id seed (default: the device id). */
  readonly observationIdSeed?: string;
  /** Optional collector max batch size (default: 500). */
  readonly maxBatchSize?: number;
}

/**
 * Create a PRINTER/COPIER family endpoint adapter. Validates the
 * declared capabilities against the family envelope for the vendor
 * model, REFUSING construction when:
 *
 *   - a FORBIDDEN capability (`lock`/`locate`/`wipe`) is declared —
 *     unsupported destructive behavior may never be emulated;
 *   - an optional capability (`reboot`/`update`) is declared the vendor
 *     model does not back;
 *   - a capability outside the family envelope is declared.
 *
 * Then delegates to the W020 `createEndpointAdapter` (capability
 * negotiation inside every method; refusals never reach the seam).
 *
 * @throws Error when the options violate the family contract.
 */
export function createPrinterCopierFamilyAdapter(
  options: PrinterCopierFamilyAdapterOptions,
): EndpointAdapter {
  const platform = options.descriptor.platform;
  if (platform !== "printer-copier") {
    throw new Error(
      `createPrinterCopierFamilyAdapter: descriptor.platform must be "printer-copier" (got "${platform}")`,
    );
  }
  if (options.seams.platform !== "printer-copier") {
    throw new Error(
      `createPrinterCopierFamilyAdapter: seams.platform "${options.seams.platform}" does not match descriptor.platform "printer-copier"`,
    );
  }
  if (options.vendorModel === undefined || typeof options.vendorModel !== "object") {
    throw new Error("createPrinterCopierFamilyAdapter: vendorModel is required");
  }
  const validation = validatePrinterCopierFamilyCapabilities(
    options.capabilities,
    options.vendorModel,
  );
  if (!validation.ok) {
    if (validation.reason === "forbidden_capability") {
      throw new Error(
        `createPrinterCopierFamilyAdapter: FORBIDDEN capabilities refused at construction: [${validation.capabilities.join(", ")}] — the printer/copier family does not support them and unsupported destructive behavior may never be emulated`,
      );
    }
    if (validation.reason === "vendor_model_does_not_back_capability") {
      throw new Error(
        `createPrinterCopierFamilyAdapter: vendor model ${options.vendorModel.vendorId}/${options.vendorModel.modelId} does not back [${validation.capabilities.join(", ")}] (vendor-model optional capabilities: [${options.vendorModel.optionalCapabilities.join(", ")}])`,
      );
    }
    throw new Error(
      `createPrinterCopierFamilyAdapter: capabilities outside the printer/copier family envelope refused at construction: [${validation.capabilities.join(", ")}] (family base: identify/observe/diagnose/enforce/health; vendor-model optional: reboot/update)`,
    );
  }
  return createEndpointAdapter({
    descriptor: options.descriptor,
    seams: options.seams,
    capabilities: options.capabilities,
    declaredAt: options.declaredAt,
    ...(options.collector !== undefined ? { collector: options.collector } : {}),
    ...(options.observationIdSeed !== undefined
      ? { observationIdSeed: options.observationIdSeed }
      : {}),
    ...(options.maxBatchSize !== undefined ? { maxBatchSize: options.maxBatchSize } : {}),
  });
}

// ---------------------------------------------------------------------------
// D3.3 — Family conformance predicates (adapter -> family)
// ---------------------------------------------------------------------------

/**
 * The family conformance view of an adapter: which family it belongs to
 * and whether its declared capabilities sit inside the family envelope.
 * Diagnostic input for audit and registry composition.
 */
export type FamilyConformance =
  | { ok: true; familyId: "ios" | "ipados" | "android" | "printer-copier" }
  | { ok: false; reason: "not_a_family_platform" };

/**
 * Resolve the family an adapter's descriptor platform binds it to.
 * The W030 family platforms (ios/ipados/android/printer-copier) are
 * family-bound; the W020 desktop platforms are not (this predicate is
 * about the FAMILY contracts, not the desktop SDK).
 */
export function familyConformanceFor(adapter: EndpointAdapter): FamilyConformance {
  const platform = adapter.descriptor.platform;
  if (
    platform === "ios" ||
    platform === "ipados" ||
    platform === "android" ||
    platform === "printer-copier"
  ) {
    return { ok: true, familyId: platform };
  }
  return { ok: false, reason: "not_a_family_platform" };
}

/**
 * The family capability envelope a platform binds an adapter to (the
 * maximum declarable set): the mobile envelope for ios/ipados/android,
 * the printer/copier base for `printer-copier` (vendor-model optional
 * capabilities extend it per model — see
 * `printerCopierFamilyEnvelopeFor`). `undefined` for desktop platforms.
 */
export function familyEnvelopeForPlatform(
  platform: string,
): AdapterCapabilities | undefined {
  if (platform === "ios" || platform === "ipados" || platform === "android") {
    return MOBILE_FAMILY_CAPABILITIES;
  }
  if (platform === "printer-copier") {
    return PRINTER_COPIER_FAMILY_CAPABILITIES;
  }
  return undefined;
}

/**
 * Pure predicate: does the platform's family envelope contain the
 * capability? (Desktop platforms have no family envelope — false.)
 */
export function isCapabilityInFamilyEnvelope(
  platform: string,
  capability: AdapterCapability,
): boolean {
  const envelope = familyEnvelopeForPlatform(platform);
  return envelope !== undefined && envelope[capability] === true;
}

/**
 * The forbidden capability list for a platform's family (empty for
 * mobile and desktop platforms; lock/locate/wipe for printer-copier).
 */
export function forbiddenCapabilitiesForPlatform(platform: string): readonly AdapterCapability[] {
  return platform === "printer-copier" ? PRINTER_COPIER_FORBIDDEN_CAPABILITIES : [];
}
