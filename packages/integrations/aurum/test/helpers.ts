/**
 * W050C aurum-adapter test helpers — deterministic builders for the
 * aurum package's tests. Local to the test suite (not exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy, no network.
 *
 * The helpers bind the CROSS-PACKAGE edges to the REAL sibling
 * packages (the ownership gate scans only src/ files, so test files
 * may import across lanes — the established W011/W021/W022/W031/W032/
 * W040/W041/W042 pattern for proving structural compatibility):
 *   - @fleetos/contracts + /testing — the frozen contracts + fixture builders;
 *   - @fleetos/identity     — the real TenantContext + isolation harness;
 *   - @fleetos/audit        — the real hash-chained AuditLog + sink adapter;
 *   - @fleetos/maintenance  — the real W042 service work order;
 *   - @fleetos/security     — the real W031 posture assessment;
 *   - @fleetos/policy       — the real Guardian engine + rule sets;
 *   - @fleetos/actions      — the real W041 action plan + policy gate;
 *   - @fleetos/recovery     — the real W040 case + destructive request;
 *   - @fleetos/procurement  — the real W032 demand + quote;
 *   - @fleetos/vendors      — the real vendor terms.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId, asVendorId } from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CorrelationId,
  DeviceId,
  Observation,
  TenantId,
  UserId,
  VendorId,
} from "@fleetos/contracts";
import { asObservationId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import { createAuditSinkAdapter, createInMemoryAuditLog } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { createServiceWorkOrder } from "@fleetos/maintenance";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import { assessSecurityPosture } from "@fleetos/security";
import type { SecurityFinding } from "@fleetos/security";
import {
  defineGuardianRule,
  compileGuardianRuleSet,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type { DefineGuardianRuleInput, GuardianRule, GuardianRuleSet } from "@fleetos/policy";
import { createActionPlan, createInMemoryDeviceRegistryView, submitActionPlan } from "@fleetos/actions";
import type { ActionPlanTemplate } from "@fleetos/actions";
import {
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  openRecoveryCase,
  requestDestructiveAction,
  transitionRecoveryCase,
} from "@fleetos/recovery";
import type { RecoveryCaseRecord } from "@fleetos/recovery";
import { createDemand, issueQuote } from "@fleetos/procurement";
import type { ProcurementDemand, Quote } from "@fleetos/procurement";
import { buildVendor } from "@fleetos/vendors";
import type { CreateVendorInput } from "@fleetos/vendors";
import { createEndpointAdapter, createInMemoryWindowsSeam } from "@fleetos/device-adapters";
import type { EndpointAdapter } from "@fleetos/device-adapters";
import type { ApprovalRequestInput } from "../src/intents";
import type { AurumAuditSink } from "../src/audit-seam";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice00b1");

/** Deterministic principal/vendor ids. */
export const USER_1: UserId = asUserId("usr_testuser00001");
export const VND_1: VendorId = asVendorId("vnd_testvendor0001");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_aurum_test_01");
export const CORR_2: CorrelationId = asCorrelationId("cor_aurum_test_02");

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;
/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** A deterministic ISO timestamp offset from T0 by whole hours. */
export function atHour(hours: number): string {
  return new Date(Date.parse(T0) + hours * HOUR_MS).toISOString();
}

/** A deterministic ISO timestamp offset from T0 by whole days. */
export function atDay(days: number): string {
  return new Date(Date.parse(T0) + days * DAY_MS).toISOString();
}

/** Tenant context A / B (the real identity constructor). */
export function ctxA(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_A, correlationId);
}
export function ctxB(correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(TENANT_B, correlationId);
}

/** A canonical role recipient. */
export function roleRecipient(role = "fleet_manager") {
  return { kind: "role" as const, role };
}

/** A canonical principal recipient. */
export function principalRecipient(principalId = USER_1 as string) {
  return { kind: "principal" as const, principalId };
}

// ---------------------------------------------------------------------------
// Observations (the frozen contracts shape)
// ---------------------------------------------------------------------------

let observationCounter = 0;
export function obs(kind: string, payload: unknown, observedAt: string, id?: string): Observation {
  observationCounter += 1;
  return Object.freeze({
    id: asObservationId(id ?? `obs_aurum_${String(observationCounter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

/** A canonical security observation (kind `device.security`, payload v1). */
export function securityObservation(
  payload: Record<string, unknown>,
  observedAt: string = T0,
): Observation {
  return obs("device.security", Object.freeze({ ...payload, schemaVersion: 1 }), observedAt);
}

// ---------------------------------------------------------------------------
// The REAL Guardian engine + rule sets (the policy module edge)
// ---------------------------------------------------------------------------

/** Define a Guardian rule or throw (test setup stays terse). */
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

/** A rule that fires REQUIRE_APPROVAL for one action kind. */
export function approvalRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `approval-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
}

// ---------------------------------------------------------------------------
// The REAL W042 service work order (the maintenance edge)
// ---------------------------------------------------------------------------

/** A canonical diagnosis-evidence fixture (the W042 input shape). */
export function diagnosisEvidence() {
  return Object.freeze({
    hypothesisId: "hyp_test0001",
    recommendationId: "trt_test0001",
    causeId: "health.battery_aging",
    confidence: 0.8,
    proposedIntent: Object.freeze({
      intentKind: "MaintainDeviceIntent" as const,
      payload: Object.freeze({ deviceId: DEV_A1 as string, description: "Battery replacement" }),
    }),
    observationIds: Object.freeze(["obs_aurum_0001", "obs_aurum_0002"]),
  });
}

/** Build a REAL service work order (revision 1) or throw. */
export function realWorkOrder(tenantId: TenantId = TENANT_A, deviceId: DeviceId = DEV_A1): ServiceWorkOrder {
  const result = createServiceWorkOrder(
    { tenantId, correlationId: CORR },
    {
      deviceId,
      diagnosis: diagnosisEvidence(),
      serviceArea: "us-east-1",
      deadline: T1,
      slaFloor: { coverage: 0.9 },
      warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: false },
      qualityFloor: { score: 0.8 },
      availabilityFloor: { ratio: 0.5 },
      serviceCategory: "service.battery",
      at: T0,
      correlationId: CORR,
    },
    { at: T0, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.workOrder;
}

// ---------------------------------------------------------------------------
// The REAL W031 security finding (the security edge)
// ---------------------------------------------------------------------------

/** Derive REAL security findings from canonical observations, or throw. */
export function realSecurityFindings(
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
): readonly SecurityFinding[] {
  const assessment = assessSecurityPosture({
    tenantId,
    deviceId,
    observations: [
      securityObservation({ diskEncryption: false }, T0),
      securityObservation({ firewall: { enabled: false } }, T0),
    ],
    at: T1,
  });
  if (!assessment.ok) throw new Error(assessment.error.message);
  return assessment.posture.findings;
}

// ---------------------------------------------------------------------------
// The REAL W041 parked action plan (the actions edge)
// ---------------------------------------------------------------------------

const FULLY_CAPABLE: AdapterCapabilities = Object.freeze({
  identify: true,
  observe: true,
  health: true,
  lock: true,
  locate: true,
  wipe: true,
  reboot: true,
});

/** Build a REAL parked action plan (PROPOSAL -> PARKED via the real Guardian), or throw. */
export function realParkedActionPlan(tenantId: TenantId = TENANT_A): ActionPlanTemplate {
  const descriptor = Object.freeze({
    tenantId,
    deviceId: DEV_A1,
    lifecycleState: "OBSERVE" as const,
    adapterCapabilities: FULLY_CAPABLE,
    platform: "windows",
  });
  const plan = createActionPlan({
    name: "aurum-test-lock-plan",
    selector: { kind: "all" },
    capability: "lock",
    tenantId,
    registry: createInMemoryDeviceRegistryView([descriptor]),
    at: T0,
  });
  if (!plan.ok) throw new Error(plan.error.message);
  const rules = ruleSet(tenantId, [approvalRule(tenantId, "device.lock")]);
  const submitted = submitActionPlan(plan.plan, {
    ruleSet: rules,
    request: {
      tenantId,
      action: { action: "device.lock", targetKind: "device" },
      principal: { userId: USER_1, role: "fleet_manager" },
    },
    at: T1,
    correlationId: CORR,
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  if (submitted.plan.status !== "PARKED") {
    throw new Error(`expected PARKED, got ${submitted.plan.status}`);
  }
  return submitted.plan;
}

// ---------------------------------------------------------------------------
// The REAL W040 recovery case + parked destructive request (the recovery edge)
// ---------------------------------------------------------------------------

/** Open a REAL recovery case or throw. */
export function realRecoveryCase(tenantId: TenantId = TENANT_A, deviceId: DeviceId = DEV_A1): RecoveryCaseRecord {
  const store = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    { tenantId, correlationId: CORR },
    store,
    {
      deviceId,
      trigger: { kind: "lost_report", reportedAt: T0, reportedBy: USER_1, note: "left on a train" },
      postureFindingRefs: [],
    },
    { at: T0, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.record;
}

/** Transition a REAL recovery case or throw. */
export function realTransitionedRecoveryCase(
  target: RecoveryCaseRecord["status"],
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
): RecoveryCaseRecord {
  const store = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    { tenantId, correlationId: CORR },
    store,
    {
      deviceId,
      trigger: { kind: "lost_report", reportedAt: T0, reportedBy: USER_1 },
      postureFindingRefs: [],
    },
    { at: T0, correlationId: CORR },
  );
  if (!opened.ok) throw new Error(opened.error.message);
  const transition = transitionRecoveryCase(
    { tenantId, correlationId: CORR },
    store,
    opened.record,
    target,
    {
      at: T1,
      correlationId: CORR,
      // Required exactly when target is CLOSED (enforced by recovery).
      ...(target === "CLOSED" ? { closureReason: "device_recovered" as const } : {}),
    },
  );
  if (!transition.ok) throw new Error(transition.error.message);
  return transition.record;
}

/** Build a REAL parked destructive recovery request (via the real Guardian), or throw. */
export function realParkedDestructiveRequest(tenantId: TenantId = TENANT_A) {
  const caseStore = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    { tenantId, correlationId: CORR },
    caseStore,
    {
      deviceId: DEV_A1,
      trigger: { kind: "lost_report", reportedAt: T0, reportedBy: USER_1 },
      postureFindingRefs: [],
    },
    { at: T0, correlationId: CORR },
  );
  if (!opened.ok) throw new Error(opened.error.message);
  const requestStore = createInMemoryDestructiveRequestStore();
  const rules = ruleSet(tenantId, [approvalRule(tenantId, "device.wipe")]);
  // The REAL W020 EndpointAdapter over the in-memory Windows seam — a
  // parked request NEVER reaches it (the call log stays empty; a call
  // would prove an authority violation).
  const seam = createInMemoryWindowsSeam();
  const adapter: EndpointAdapter = createEndpointAdapter({
    descriptor: {
      adapterId: "adp-aurum-test",
      platform: "windows",
      tenantId,
      deviceId: DEV_A1,
      adapterVersion: "1.0.0-test",
    },
    seams: seam,
    capabilities: FULLY_CAPABLE,
    declaredAt: T0,
  });
  const requested = requestDestructiveAction(
    { tenantId, correlationId: CORR },
    requestStore,
    opened.record,
    "wipe",
    {
      ruleSet: rules,
      evaluator: evaluateGuardianRequest,
      adapter,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
    },
  );
  if (!requested.ok) throw new Error(requested.error.message);
  if (requested.record.status !== "PARKED") {
    throw new Error(`expected PARKED, got ${requested.record.status}`);
  }
  return { record: requested.record, adapter, seam };
}

// ---------------------------------------------------------------------------
// The REAL W032 demand + quote (the procurement edge)
// ---------------------------------------------------------------------------

/** Build a REAL procurement demand or throw. */
export function realDemand(tenantId: TenantId = TENANT_A): ProcurementDemand {
  const result = createDemand(tenantId, {
    procurementIntent: {
      workloadId: "wl_testworkload01",
      description: "Engineering workstation fleet refresh",
    },
    quantity: 3,
    at: T0,
    deadline: T2,
    deliveryArea: "us-east-1",
    budget: { usd: 9000 },
    slaFloor: { coverage: 0.9 },
    warrantyFloor: { days: 365 },
    qualityFloor: { score: 0.8 },
    availabilityFloor: { ratio: 0.5 },
    correlationId: CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.demand.tenantId !== tenantId) {
    throw new Error("demand tenant mismatch in test fixture");
  }
  return result.demand;
}

/** Build a REAL vendor input (for the quote match). */
export function realVendorInput(): CreateVendorInput {
  return {
    vendorId: VND_1,
    name: "Acme Hardware",
    description: "Test vendor.",
    capabilities: [{ kind: "hardware", id: "class.engineering_workstation" }],
    inventory: [
      {
        capability: { kind: "hardware", id: "class.engineering_workstation" },
        availability: { ratio: 0.9 },
        leadTime: { days: 14 },
      },
    ],
    terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 730 } },
    regions: ["us-east-1"],
    at: T0,
    correlationId: CORR,
  };
}

/** Build a REAL issued quote (DRAFT -> ISSUED) or throw. */
export function realIssuedQuote(tenantId: TenantId = TENANT_A): Quote {
  const demand = realDemand(tenantId);
  const vendorResult = buildVendor(tenantId, realVendorInput());
  if (!vendorResult.ok) throw new Error(vendorResult.error.message);
  const capability = { kind: "hardware" as const, id: "class.engineering_workstation" };
  const result = issueQuote({
    demand,
    match: {
      vendor: vendorResult.vendor,
      matchedCapability: capability,
      matchedInventory: {
        capability,
        availability: { ratio: 0.9 },
        leadTime: { days: 14 },
      },
      rankScore: 0.9,
      satisfiable: true,
      reasons: [],
    },
    unitPriceUsd: 2500,
    leadTimeDays: 14,
    warrantyDays: 730,
    slaCoverage: 0.95,
    at: T1,
    correlationId: CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.quote;
}

// ---------------------------------------------------------------------------
// The REAL audit log + sink adapter (the audit edge)
// ---------------------------------------------------------------------------

/** Create the REAL hash-chained AuditLog. */
export function realAuditLog(): AuditLog {
  return createInMemoryAuditLog();
}

/**
 * Bind the REAL @fleetos/audit sink adapter to the aurum seam: the
 * adapter's `AuditSink` satisfies the aurum package's `AurumAuditSink`
 * STRUCTURALLY (TypeScript structural typing — the type-level proof;
 * the audit test suite is the runtime proof).
 */
export function realAurumAuditSink(log: AuditLog): AurumAuditSink {
  return createAuditSinkAdapter(log, { source: "integration-aurum.boundary" });
}

/** The shared approval-request input facets (deterministic). */
export function approvalInputBase() {
  return {
    recipient: roleRecipient("approver"),
    at: T1,
    correlationId: CORR,
  };
}

/** The approval-request input for the action-plan surface (deterministic). */
export function actionPlanApprovalInput(plan: ActionPlanTemplate): ApprovalRequestInput {
  return { surface: "action_plan", plan, ...approvalInputBase() };
}

/** Narrow a FleetError to its ValidationError failures or throw (test helper). */
export function failuresOf(
  error: import("@fleetos/contracts").FleetError,
): readonly { path: string; reason: string }[] {
  if (error.kind !== "ValidationError") {
    throw new Error(`expected ValidationError, got ${error.kind} (${error.code})`);
  }
  return error.failures;
}

/** Narrow a tagged refusal to its machine-stable invariant or throw (test helper). */
export function invariantOf(error: import("@fleetos/contracts").FleetError): string {
  if (error.kind !== "DomainError") {
    throw new Error(`expected DomainError, got ${error.kind} (${error.code})`);
  }
  return error.invariant ?? "missing_invariant";
}

/** Brand a correlation id as a causation id (test fixture convenience). */
export function asCausation(value: string): import("@fleetos/contracts").CausationId {
  return value as import("@fleetos/contracts").CausationId;
}
