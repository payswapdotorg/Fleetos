/**
 * W041 actions test helpers — deterministic builders for actions-package
 * tests. Local to the test suite (not exported from src/). Everything
 * here is a pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import {
  defineGuardianRule,
  compileGuardianRuleSet,
  type DefineGuardianRuleInput,
  type GuardianRule,
  type GuardianRuleSet,
} from "@fleetos/policy";
import type {
  CreateActionPlanInput,
  DeviceDescriptor,
  DeviceGroupSelector,
  PrinterDescriptor,
  ActionTargetCapability,
  ActionPlanTemplate,
} from "../src/index";
import { createActionPlan, createInMemoryDeviceRegistryView } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** A later injected timestamp for revision flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids (5 per tenant for selector tests). */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const DEV_A2: DeviceId = asDeviceId("dev_testdevice00a2");
export const DEV_A3: DeviceId = asDeviceId("dev_testdevice00a3");
export const DEV_A4: DeviceId = asDeviceId("dev_testdevice00a4");
export const DEV_A5: DeviceId = asDeviceId("dev_testdevice00a5");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice00b1");
export const DEV_B2: DeviceId = asDeviceId("dev_testdevice00b2");

/** Deterministic principal id. */
export const USER_1: UserId = asUserId("usr_testuser00001");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_actions_test_1");
export const CORR_2: CorrelationId = asCorrelationId("cor_actions_test_2");

/** A fixed, valid evidence ref (deterministic values). */
export function evidenceRef(key = "evidence/test-artifact-1"): EvidenceRef {
  return {
    key,
    sizeBytes: 128,
    hash: "0123456789abcdef0123456789abcdef",
    hashAlgorithm: "sha256",
  };
}

/** Tenant scope A (structurally identical to identity's TenantContext). */
export function scopeA(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_A, correlationId };
}
/** Tenant scope B. */
export function scopeB(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_B, correlationId };
}

/**
 * Define a Guardian rule or throw (test setup stays terse).
 */
export function rule(tenantId: TenantId, input: DefineGuardianRuleInput): GuardianRule {
  const built = defineGuardianRule(tenantId, input);
  if (!built.ok) throw new Error(`test rule invalid: ${built.error.message}`);
  return built.rule;
}

/** Compile a rule set or throw. */
export function ruleSet(tenantId: TenantId, rules: readonly GuardianRule[], version = 1): GuardianRuleSet {
  const compiled = compileGuardianRuleSet(tenantId, { rules, version, at: T0 });
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.ruleSet;
}

/** A canonical action condition for tests (matches `fleet.action.execute`). */
export const actionCondition = { kind: "action" as const, actions: { in: ["fleet.action.execute"] } };

/** Build an action plan or throw. */
export function plan(
  tenantId: TenantId,
  input: Omit<CreateActionPlanInput, "tenantId">,
): ActionPlanTemplate {
  const result = createActionPlan({ ...input, tenantId });
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

/**
 * Build a device descriptor for tests.
 */
export function descriptor(
  tenantId: TenantId,
  deviceId: DeviceId,
  overrides: Partial<DeviceDescriptor> = {},
): DeviceDescriptor {
  return {
    tenantId,
    deviceId,
    lifecycleState: "OBSERVE",
    adapterCapabilities: { identify: true, observe: true, health: true },
    platform: "windows",
    ownership: "corporate",
    ...overrides,
  };
}

/** Build an in-memory device registry view with the given descriptors. */
export function registry(descriptors: readonly DeviceDescriptor[] = []) {
  return createInMemoryDeviceRegistryView(descriptors);
}

/** Build a printer descriptor for tests. */
export function printer(
  tenantId: TenantId,
  printerId: string,
  overrides: Partial<PrinterDescriptor> = {},
): PrinterDescriptor {
  return {
    printerId,
    tenantId,
    capabilities: { color: true, duplex: true },
    preferences: {},
    approved: true,
    location: "hq",
    ...overrides,
  };
}

/** A canonical selector (all). */
export const allSelector: DeviceGroupSelector = { kind: "all" };

/** A canonical capability for plan creation. */
export const CAP_OBSERVE: ActionTargetCapability = "observe";
export const CAP_LOCK: ActionTargetCapability = "lock";
export const CAP_WIPE: ActionTargetCapability = "wipe";
