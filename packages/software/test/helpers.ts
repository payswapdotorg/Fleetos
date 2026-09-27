/**
 * W032 test helpers — deterministic builders for software tests.
 */

import { asCorrelationId, asTenantId, asWorkloadId } from "@fleetos/contracts";
import type { CorrelationId, TenantId, WorkloadId } from "@fleetos/contracts";
import type { SoftwareSubscriptionIntentPayload } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type {
  AllocateSubscriptionInput,
  ReviseSubscriptionInput,
} from "../src/subscription";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids. */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic workload id. */
export const WL_1: WorkloadId = asWorkloadId("wl_testworkload01");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_software_test");
export const CORR_2: CorrelationId = asCorrelationId("cor_software_tst2");

/** Deterministic contexts. */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

/** A standard W022 draft SoftwareSubscriptionIntentPayload. */
export function stdSoftwareIntent(
  overrides: Partial<SoftwareSubscriptionIntentPayload> = {},
): SoftwareSubscriptionIntentPayload {
  return {
    softwareId: "app.bi_dashboard",
    seatCount: 5,
    ...overrides,
  };
}

/** A minimal allocation input. */
export function allocateInput(
  overrides: Partial<AllocateSubscriptionInput> = {},
): AllocateSubscriptionInput {
  return {
    softwareIntent: stdSoftwareIntent(),
    workloadId: WL_1,
    termDays: 365,
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

/** A minimal revise input. */
export function reviseInput(
  overrides: Partial<ReviseSubscriptionInput> = {},
): ReviseSubscriptionInput {
  return {
    seatCount: 10,
    termDays: 730,
    at: T1,
    correlationId: CORR,
    ...overrides,
  };
}
