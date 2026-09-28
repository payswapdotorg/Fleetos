/**
 * W051 convergence test helpers — the CROSS-LANE BINDING SITE.
 *
 * Local to the test suite (outside src/ — the ownership gate scans only
 * src/ files, so test files may import across lanes; the established
 * W011/W021/W022/W031/W032/W040/W041/W042/W050A/W050B/W050C pattern).
 *
 * This is the D1 contract-compatibility proof's machinery: every REAL
 * sibling package is bound here —
 *   - @fleetos/contracts            — the frozen ids + shapes;
 *   - @fleetos/identity             — the REAL TenantContext
 *                                      (makeTenantContext — structurally
 *                                      satisfying the convergence
 *                                      package's ConvergenceTenantScope);
 *   - @fleetos/audit                — the REAL hash-chained AuditLog +
 *                                      sink adapter + FNV-1a reference
 *                                      (the digest-compatibility proof);
 *   - @fleetos/policy               — the REAL W031 Guardian engine
 *                                      (evaluateGuardianRequest) + real
 *                                      rule-set compilation;
 *   - @fleetos/integration-adcos    — the REAL W050A adapter surface;
 *   - @fleetos/integration-arena    — the REAL W050B adapter surface;
 *   - @fleetos/integration-aurum    — the REAL W050C adapter surface.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import type { CorrelationId, DeviceId, EvidenceRef, TenantId, UserId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import { createAuditSinkAdapter, createInMemoryAuditLog, fnv1a32Hex as auditFnv1a32Hex } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type { DefineGuardianRuleInput, GuardianRule, GuardianRuleSet } from "@fleetos/policy";
import { submitConnectivityIntent } from "@fleetos/integration-adcos";
import { ADCOS_SUBMISSION_ACTION } from "@fleetos/integration-adcos";
import {
  createInMemoryAdcosAuditSink,
  createInMemoryAdcosTransport,
  createInMemoryConnectivityRecordStore,
  createInMemorySubmissionStore,
} from "@fleetos/integration-adcos";
import type {
  AdcosGuardianEvaluateFn,
  ConnectivityIntentRequirements,
  InMemoryAdcosTransport,
} from "@fleetos/integration-adcos";
import { submitEvaluationCase } from "@fleetos/integration-arena";
import {
  CASE_SUBMITTED,
  CASE_PARKED,
  CASE_REJECTED,
  createInMemoryArenaAuditSink,
  createInMemoryEvaluationCaseStore,
} from "@fleetos/integration-arena";
import type {
  ArenaGuardianRequest,
  EvaluationLabel,
  EvaluationOutcome,
  GuardianEvaluateFn,
  RedactionRecord,
  SubmitEvaluationCaseInput,
} from "@fleetos/integration-arena";
import {
  buildMaintenanceNotice,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
} from "@fleetos/integration-aurum";
import type { CommunicationIntent, InMemoryOutboxLedger } from "@fleetos/integration-aurum";
import type { MaintenanceNoticeSource } from "@fleetos/integration-aurum";
import {
  aggregateIntegrationHealth,
  checkConvergenceTenantScope,
  createIntegrationEvidenceLedger,
  fnv1a32Hex,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic anchors
// ---------------------------------------------------------------------------

export const T0 = "2026-01-01T00:00:00Z" as const;
export const T1 = "2026-02-01T00:00:00Z" as const;

export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");
export const CORR: CorrelationId = asCorrelationId("cor_convergence01");
export const CORR_2: CorrelationId = asCorrelationId("cor_convergence02");
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const USER_1: UserId = asUserId("usr_testuser00001");

/** The REAL identity TenantContext (the structural-scope proof input). */
export function realCtx(tenantId: TenantId = TENANT_A, correlationId: CorrelationId = CORR): TenantContext {
  return makeTenantContext(tenantId, correlationId);
}

/** The convergence scope guard accepts the REAL identity TenantContext. */
export const REAL_SCOPE_CHECK = checkConvergenceTenantScope(realCtx());

// ---------------------------------------------------------------------------
// The REAL Guardian engine + rule sets (the policy module edge)
// ---------------------------------------------------------------------------

export function rule(tenantId: TenantId, input: DefineGuardianRuleInput): GuardianRule {
  const built = defineGuardianRule(tenantId, input);
  if (!built.ok) throw new Error(`test rule invalid: ${built.error.message}`);
  return built.rule;
}

export function ruleSet(tenantId: TenantId, rules: readonly GuardianRule[], version = 1): GuardianRuleSet {
  const compiled = compileGuardianRuleSet(tenantId, { rules, version, at: T0 });
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.ruleSet;
}

export function warnRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `warn-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "WARN",
    at: T0,
  });
}

export function approvalRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `approval-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
}

export function blockRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `block-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "BLOCK",
    at: T0,
  });
}

/** The REAL W031 Guardian engine — injected at the binding sites. */
export const realGuardianAdcos: AdcosGuardianEvaluateFn<GuardianRuleSet> = evaluateGuardianRequest;
export const realGuardianArena: GuardianEvaluateFn<GuardianRuleSet> = evaluateGuardianRequest;

// ---------------------------------------------------------------------------
// The REAL audit log + sink adapters (the audit module edge)
// ---------------------------------------------------------------------------

export function realAuditLog(): AuditLog {
  return createInMemoryAuditLog();
}

/** The REAL @fleetos/audit FNV-1a (the digest-compatibility comparator). */
export const realAuditFnv1a32Hex = auditFnv1a32Hex;
export const convergenceFnv1a32Hex = fnv1a32Hex;

// ---------------------------------------------------------------------------
// The REAL ADCOS adapter harness (the W050A module edge)
// ---------------------------------------------------------------------------

/** The frozen connectivity-intent envelope (the W050A binding shape). */
export function connectivityIntent(tenantId: TenantId = TENANT_A): {
  intentId: string;
  tenantId: TenantId;
  version: number;
  createdAt: string;
  payload: { kind: string; sourceDeviceId: string; outcome: string };
} {
  return {
    intentId: "int_convtestintent1",
    tenantId,
    version: 1,
    createdAt: T0,
    payload: {
      kind: "ConnectivityIntent",
      sourceDeviceId: DEV_A1,
      outcome: "secure private connectivity",
    },
  };
}

/** A canonical secure-private requirement profile (the W050A binding shape). */
export function connectivityRequirements(): ConnectivityIntentRequirements {
  return {
    properties: {
      isolation: "private",
      redundancy: "path_redundant",
      availabilityTarget: 0.999,
    },
    constraints: {
      requiredZones: ["corporate"],
      forbiddenZones: ["public"],
      egressAllowed: false,
    },
    duration: { startAt: T0, endAt: T1 },
    budget: { budgetRef: "budget/test-quarterly", policyRefs: ["policy/test-connectivity"] },
    security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
  };
}

/** The gated ADCOS submit harness — the REAL engine + REAL stores. */
export function adcosHarness(rules: readonly GuardianRule[], tenantId: TenantId = TENANT_A) {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const result = submitConnectivityIntent(
    { tenantId, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent(tenantId),
    connectivityRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleSet(tenantId, rules),
      evaluator: realGuardianAdcos,
      transport,
      auditSink,
    },
  );
  return { transport, submissionStore, recordStore, auditSink, result };
}

// ---------------------------------------------------------------------------
// The REAL Arena adapter harness (the W050B module edge)
// ---------------------------------------------------------------------------

function evidenceRef(key = "evidence/conv-artifact-1"): EvidenceRef {
  return {
    key,
    sizeBytes: 128,
    hash: "0123456789abcdef0123456789abcdef",
    hashAlgorithm: "sha256",
  };
}

function outcome(): EvaluationOutcome {
  return {
    label: "true_positive",
    value: "battery_aged",
    observedAt: T0,
    evidenceRefs: [evidenceRef()],
  };
}

function label(): EvaluationLabel {
  return { key: "severity", value: "high" };
}

function redaction(): RedactionRecord {
  return {
    state: "deidentified",
    appliedPolicies: ["policy/deidentify-v1"],
  };
}

export function caseInput(): SubmitEvaluationCaseInput {
  return {
    problemClass: "device.health.battery_aging",
    observationRefs: ["obs/conv-1", "obs/conv-2"],
    context: { device: "dev_testdevice00a1", fleet: "fleet-1" },
    actionHistoryRefs: ["int/conv-1"],
    outcome: outcome(),
    labels: [label()],
    tenantPolicyRefs: ["policy/tenant-a-v1"],
    redaction: redaction(),
  };
}

export function caseSubmitRequest(tenantId: TenantId = TENANT_A): ArenaGuardianRequest {
  return {
    tenantId,
    action: { action: "arena.case.submit", targetKind: "device.health.battery_aging" },
    principal: { userId: USER_1, role: "operator", department: "ops" },
  };
}

/** The gated Arena submit harness — the REAL engine + REAL store. */
export function arenaHarness(rules: readonly GuardianRule[], tenantId: TenantId = TENANT_A) {
  const store = createInMemoryEvaluationCaseStore();
  const sink = createInMemoryArenaAuditSink();
  const result = submitEvaluationCase(
    { tenantId, correlationId: CORR },
    store,
    caseInput(),
    {
      ruleSet: ruleSet(tenantId, rules),
      evaluator: realGuardianArena,
      request: caseSubmitRequest(tenantId),
      guardianOptions: { at: T0, correlationId: CORR },
      auditSink: sink,
    },
  );
  return { store, sink, result };
}

export const ARENA_STATUSES = { SUBMITTED: CASE_SUBMITTED, PARKED: CASE_PARKED, REJECTED: CASE_REJECTED } as const;

// ---------------------------------------------------------------------------
// The REAL Aurum adapter harness (the W050C module edge)
// ---------------------------------------------------------------------------

function workOrderSource(tenantId: TenantId = TENANT_A): MaintenanceNoticeSource {
  return {
    workOrderId: "swo_convworkorder01",
    tenantId,
    deviceId: "dev_testdevice00a1",
    revision: 1,
    serviceArea: "fleet-1",
    deadline: T1,
    serviceCategory: "battery_replacement",
  };
}

/** Build a maintenance-notice intent (the pure W050C builder). */
export function noticeIntent(tenantId: TenantId = TENANT_A): CommunicationIntent {
  const built = buildMaintenanceNotice({
    recipient: { kind: "role", role: "ops" },
    at: T0,
    correlationId: CORR,
    workOrder: workOrderSource(tenantId),
    event: "created",
  });
  if (!built.ok) throw new Error(`notice intent invalid: ${built.error.message}`);
  return built.intent;
}

/** The Aurum emission harness — the REAL outbox + REAL transport. */
export function aurumHarness(tenantId: TenantId = TENANT_A, refusal?: (n: number) => string | null) {
  const outbox: InMemoryOutboxLedger = createInMemoryOutboxLedger();
  let calls = 0;
  const transport = createInMemoryTransport({
    refusal: refusal ? (emission) => refusal(++calls) : undefined,
  });
  const auditLog = realAuditLog();
  const auditSink = createAuditSinkAdapter(auditLog, { source: "integration-convergence.binding" });
  return { outbox, transport, auditLog, auditSink };
}

/** Emit through the REAL Aurum boundary. */
export function aurumEmit(
  harness: ReturnType<typeof aurumHarness>,
  intent: CommunicationIntent,
  tenantId: TenantId = TENANT_A,
) {
  return emitCommunicationMessage(realCtx(tenantId), harness.outbox, intent, {
    transport: harness.transport,
    auditSink: harness.auditSink,
  });
}

// ---------------------------------------------------------------------------
// The convergence-package surfaces under test
// ---------------------------------------------------------------------------

export const convergenceAggregate = aggregateIntegrationHealth;
export const convergenceLedger = createIntegrationEvidenceLedger;
