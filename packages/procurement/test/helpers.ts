/**
 * W032 test helpers — deterministic builders for procurement tests.
 *
 * Local to the test suite (not exported from src/). Everything here is a
 * pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asTenantId, asVendorId, asWorkloadId } from "@fleetos/contracts";
import type { CorrelationId, TenantId, VendorId, WorkloadId } from "@fleetos/contracts";
import type { ProcurementIntentPayload } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type {
  CreateVendorInput,
  Vendor,
  VendorCapability,
  VendorInventorySignal,
  VendorTerms,
} from "@fleetos/vendors";
import { buildVendor } from "@fleetos/vendors";
import type { CreateDemandInput, DemandRejectionEvidence } from "../src/demand";
import type { MatchOptions } from "../src/matching";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;
/** A deadline 30 days from T0. */
export const DEADLINE = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests. */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic vendor ids. */
export const VND_1: VendorId = asVendorId("vnd_testvendor0001");
export const VND_2: VendorId = asVendorId("vnd_testvendor0002");

/** Deterministic workload ids. */
export const WL_1: WorkloadId = asWorkloadId("wl_testworkload01");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_proc_test");
export const CORR_2: CorrelationId = asCorrelationId("cor_proc_tst2");

/** Deterministic contexts. */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

/** A standard capability. */
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

/** Standard vendor terms. */
export function stdTerms(overrides: Partial<VendorTerms> = {}): VendorTerms {
  return {
    quality: { score: 0.9 },
    sla: { coverage: 0.95 },
    warranty: { days: 365 },
    ...overrides,
  };
}

/** A minimal vendor create input. */
export function vendorInput(
  overrides: Partial<CreateVendorInput> = {},
): CreateVendorInput {
  return {
    vendorId: VND_1,
    name: "Acme Local",
    description: "Local fulfillment vendor.",
    capabilities: [stdCapability()],
    inventory: [stdInventory()],
    terms: stdTerms(),
    regions: ["us-east-1"],
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** Build a vendor directly. */
export function vendor(overrides: Partial<CreateVendorInput> = {}): Vendor {
  const built = buildVendor(TENANT_A, vendorInput(overrides));
  if (!built.ok) throw new Error(`test vendor invalid: ${built.error.message}`);
  return built.vendor;
}

/** A standard W022 draft ProcurementIntentPayload. */
export function stdProcurementIntent(
  overrides: Partial<ProcurementIntentPayload> = {},
): ProcurementIntentPayload {
  return {
    workloadId: WL_1 as string,
    description: "Procure a standard laptop for the finance analyst workload.",
    ...overrides,
  };
}

/** A minimal demand create input. */
export function demandInput(
  overrides: Partial<CreateDemandInput> = {},
): CreateDemandInput {
  return {
    procurementIntent: stdProcurementIntent(),
    quantity: 1,
    at: T0,
    deadline: DEADLINE,
    deliveryArea: "us-east-1",
    budget: { usd: 2000 },
    slaFloor: { coverage: 0.8 },
    warrantyFloor: { days: 90 },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    allowedSubstitutions: ["class.standard_laptop"],
    correlationId: CORR,
    ...overrides,
  };
}

/** Standard rejection evidence carried from W022. */
export function rejectionEvidence(
  candidateId = "class.engineering_workstation",
  reason = "version_below_minimum",
): DemandRejectionEvidence {
  return { candidateId, reason };
}

/** Standard matching options. */
export function matchOptions(overrides: Partial<MatchOptions> = {}): MatchOptions {
  return {
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}
