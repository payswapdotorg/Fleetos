/**
 * W042 test helpers — deterministic builders for maintenance tests.
 *
 * Local to the test suite (not exported from src/). Everything here is a
 * pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asDeviceId, asTenantId, asVendorId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  MaintainDeviceIntentPayload,
  ReplacementIntentPayload,
  TenantId,
  VendorId,
} from "@fleetos/contracts";
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
import type {
  CreateServiceWorkOrderInput,
  MaintenanceDiagnosisEvidence,
  ReplacementEscalationLink,
} from "../src/service-work-order";
import type { ServiceWorkOrderMatchPair } from "../src/aggregation";
import type { ServiceMatchOptions } from "../src/matching";
import type { MaintenanceTenantScope } from "../src/internal";

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

/** Deterministic device ids. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice001");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice002");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_maint_test");
export const CORR_2: CorrelationId = asCorrelationId("cor_maint_tst2");

/** Deterministic tenant scopes (the MaintenanceTenantScope form). */
export function scopeA(correlationId: CorrelationId = CORR): MaintenanceTenantScope {
  return { tenantId: TENANT_A, correlationId };
}
export function scopeB(correlationId: CorrelationId = CORR): MaintenanceTenantScope {
  return { tenantId: TENANT_B, correlationId };
}

/** Deterministic tenant contexts (the @fleetos/identity form). */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

// ---------------------------------------------------------------------------
// Vendor fixtures
// ---------------------------------------------------------------------------

/** A standard service capability. */
export function stdCapability(id = "service.battery"): VendorCapability {
  return { kind: "service", id };
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
    name: "Acme Service",
    description: "Local service vendor.",
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

// ---------------------------------------------------------------------------
// Diagnosis evidence + work order fixtures
// ---------------------------------------------------------------------------

/** A standard W021 DRAFT MaintainDeviceIntentPayload. */
export function stdMaintenanceIntent(
  overrides: Partial<MaintainDeviceIntentPayload> = {},
): MaintainDeviceIntentPayload {
  return {
    deviceId: DEV_A1 as string,
    description: "Battery charge is below the health threshold; schedule battery service.",
    ...overrides,
  };
}

/** A standard W021 DRAFT ReplacementIntentPayload (for the replacement link). */
export function stdReplacementIntent(
  overrides: Partial<ReplacementIntentPayload> = {},
): ReplacementIntentPayload {
  return {
    deviceId: DEV_A1 as string,
    reason: "Hardware failure indicators; propose replacement.",
    ...overrides,
  };
}

/** A standard diagnosis evidence (structural twin of W021's TreatmentRecommendation). */
export function stdDiagnosis(
  overrides: Partial<MaintenanceDiagnosisEvidence> = {},
): MaintenanceDiagnosisEvidence {
  return {
    hypothesisId: "hyp_test0001",
    recommendationId: "tr_test0001",
    causeId: "health.battery_aging",
    confidence: 0.85,
    proposedIntent: {
      intentKind: "MaintainDeviceIntent",
      payload: stdMaintenanceIntent(),
    },
    observationIds: ["obs_test0001", "obs_test0002"],
    ...overrides,
  };
}

/** A standard replacement-escalation link. */
export function stdReplacementLink(
  overrides: Partial<ReplacementEscalationLink> = {},
): ReplacementEscalationLink {
  return {
    intentKind: "ReplacementIntent",
    payload: stdReplacementIntent(),
    diagnosisRefs: {
      hypothesisId: "hyp_test0001",
      recommendationId: "tr_test0001",
      causeId: "health.battery_aging",
      observationIds: ["obs_test0001", "obs_test0002"],
    },
    ...overrides,
  };
}

/** A minimal work order create input. */
export function workOrderInput(
  overrides: Partial<CreateServiceWorkOrderInput> = {},
): CreateServiceWorkOrderInput {
  return {
    deviceId: DEV_A1,
    diagnosis: stdDiagnosis(),
    serviceArea: "us-east-1",
    deadline: DEADLINE,
    slaFloor: { coverage: 0.8 },
    warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
    qualityFloor: { score: 0.7 },
    availabilityFloor: { ratio: 0.5 },
    serviceCategory: "service.battery",
    allowedSubstitutions: ["service.battery"],
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** Standard matching options. */
export function matchOptions(overrides: Partial<ServiceMatchOptions> = {}): ServiceMatchOptions {
  return {
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** A standard (work order, match) pair for aggregation tests. */
export function pair(
  workOrderIdSuffix: string,
  vendor: Vendor,
  match: unknown,
): ServiceWorkOrderMatchPair {
  // The match is built by the matcher; the test constructs a real
  // satisfiable match elsewhere and passes it through.
  return {
    workOrder: { workOrderId: `swo_${workOrderIdSuffix}` } as never,
    match: match as never,
  };
}
