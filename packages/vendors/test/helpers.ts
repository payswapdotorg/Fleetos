/**
 * W032 test helpers — deterministic builders for vendors-package tests.
 *
 * Local to the test suite (not exported from src/). Everything here is a
 * pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asTenantId, asVendorId } from "@fleetos/contracts";
import type { CorrelationId, TenantId, VendorId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type {
  CreateVendorInput,
  ReviseVendorInput,
  Vendor,
  VendorCapability,
  VendorInventorySignal,
  VendorTerms,
} from "../src/vendor";
import { buildVendor } from "../src/vendor";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic vendor ids for tests. */
export const VND_1: VendorId = asVendorId("vnd_testvendor0001");
export const VND_2: VendorId = asVendorId("vnd_testvendor0002");

/** Deterministic correlation ids for tests. */
export const CORR: CorrelationId = asCorrelationId("cor_vendors_test");
export const CORR_2: CorrelationId = asCorrelationId("cor_vendors_tst2");

/** Deterministic contexts. */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

/** A standard capability (device-class for an engineering workstation). */
export function stdCapability(id = "class.standard_laptop"): VendorCapability {
  return { kind: "device-class", id };
}

/** Standard inventory signal: high availability, 7-day lead time. */
export function stdInventory(
  capability: VendorCapability = stdCapability(),
  availability = 0.9,
  leadTimeDays = 7,
): VendorInventorySignal {
  return {
    capability,
    availability: { ratio: availability },
    leadTime: { days: leadTimeDays },
  };
}

/** Standard vendor terms: high quality, SLA 0.95, 365-day warranty. */
export function stdTerms(
  overrides: Partial<VendorTerms> = {},
): VendorTerms {
  return {
    quality: { score: 0.9 },
    sla: { coverage: 0.95 },
    warranty: { days: 365 },
    ...overrides,
  };
}

/** A minimal create input (deterministic; vendorId explicit). */
export function createInput(
  overrides: Partial<CreateVendorInput> = {},
): CreateVendorInput {
  return {
    vendorId: VND_1,
    name: "Acme Local",
    description: "Local fulfillment vendor for standard laptops.",
    capabilities: [stdCapability()],
    inventory: [stdInventory()],
    terms: stdTerms(),
    regions: ["us-east-1"],
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** Build a vendor directly (pure builder; throws on invalid input). */
export function vendor(overrides: Partial<CreateVendorInput> = {}): Vendor {
  const input = createInput(overrides);
  const built = buildVendor(TENANT_A, input);
  if (!built.ok) throw new Error(`test vendor invalid: ${built.error.message}`);
  return built.vendor;
}

/** A minimal revise input. */
export function reviseInput(
  overrides: Partial<ReviseVendorInput> = {},
): ReviseVendorInput {
  return {
    name: "Acme Local",
    description: "Updated vendor description.",
    capabilities: [stdCapability()],
    inventory: [stdInventory()],
    terms: stdTerms(),
    regions: ["us-east-1"],
    at: T1,
    correlationId: CORR,
    ...overrides,
  };
}
