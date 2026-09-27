/**
 * W031 policy test helpers — deterministic builders for policy-package
 * tests. Local to the test suite (not exported from src/). Everything
 * here is a pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId, asWorkloadId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  TenantId,
  UserId,
  WorkloadId,
} from "@fleetos/contracts";
import type {
  DefineGuardianRuleInput,
  GuardianRequestContext,
  GuardianRule,
  PolicyTenantScope,
} from "../src/index";
import { defineGuardianRule } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** A later injected timestamp for revision flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids. */
export const DEV_1: DeviceId = asDeviceId("dev_testdevice0001");
export const DEV_2: DeviceId = asDeviceId("dev_testdevice0002");

/** Deterministic principal id. */
export const USER_1: UserId = asUserId("usr_testuser00001");

/** Deterministic workload id. */
export const WL_1: WorkloadId = asWorkloadId("wl_testworkload01");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_policy_test_1");
export const CORR_2: CorrelationId = asCorrelationId("cor_policy_test_2");

/** Deterministic tenant scopes (structurally identical to identity's TenantContext). */
export function scopeA(correlationId: CorrelationId = CORR): PolicyTenantScope {
  return { tenantId: TENANT_A, correlationId };
}
export function scopeB(correlationId: CorrelationId = CORR): PolicyTenantScope {
  return { tenantId: TENANT_B, correlationId };
}

/** A fixed, valid evidence ref (deterministic values). */
export function evidenceRef(key = "evidence/test-artifact-1"): EvidenceRef {
  return {
    key,
    sizeBytes: 128,
    hash: "0123456789abcdef0123456789abcdef",
    hashAlgorithm: "sha256",
  };
}

/**
 * Define a rule or throw (test setup stays terse; invalid definitions
 * are tested explicitly).
 */
export function rule(tenantId: TenantId, input: DefineGuardianRuleInput): GuardianRule {
  const built = defineGuardianRule(tenantId, input);
  if (!built.ok) throw new Error(`test rule invalid: ${built.error.message}`);
  return built.rule;
}

/** A canonical minimal request (upload action, corporate device). */
export function request(overrides: Partial<GuardianRequestContext> = {}): GuardianRequestContext {
  return {
    tenantId: TENANT_A,
    action: { action: "file.upload" },
    device: { deviceId: DEV_1, platform: "windows", ownership: "corporate" },
    ...overrides,
  };
}
