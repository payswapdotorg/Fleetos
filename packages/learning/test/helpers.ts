/**
 * W070 learning test helpers — deterministic builders for
 * learning-package tests. Local to the test suite (not exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy.
 *
 * The helpers bind the module edges to the REAL sibling packages (the
 * ownership gate scans only src/ files, so test files may import across
 * lanes — the established W011/W021/W022/W031/W032/W040/W041/W042/W050B
 * pattern for proving structural compatibility):
 *   - @fleetos/policy      — the real Guardian engine (evaluateGuardianRequest)
 *                            + real rule-set compilation;
 *   - @fleetos/audit       — the real hash-chained AuditLog + sink adapter;
 *   - @fleetos/identity    — the real TenantContext (makeTenantContext);
 *   - @fleetos/health      — the real W021 diagnosis (signals -> anomalies
 *                            -> hypotheses + recommendations + dismissals);
 *   - @fleetos/actions     — the real W041 action plans (created + submitted
 *                            through the real Guardian to a terminal status);
 *   - @fleetos/maintenance — the real W042 service work orders;
 *   - @fleetos/integration-aurum — the real W050C outbox emission +
 *                            delivery-metadata ingestion;
 *   - @fleetos/contracts   — the frozen contracts + branded id constructors.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CorrelationId,
  DeviceId,
  EvidenceRef,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import { asObservationId } from "@fleetos/contracts";
import {
  defineGuardianRule,
  compileGuardianRuleSet,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import type { DefineGuardianRuleInput, GuardianRule, GuardianRuleSet } from "@fleetos/policy";
import { makeTenantContext } from "@fleetos/identity";
import { createAuditSinkAdapter, createInMemoryAuditLog } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { SIGNAL_KIND_SPECIFICATIONS } from "@fleetos/health";
import type { HealthSignal, SignalKind } from "@fleetos/health";
import { detectAnomalies, diagnose, dismissHypothesis, appendHypothesis, createDiagnosisLedger } from "@fleetos/health";
import type { DiagnosisHypothesis, TreatmentRecommendation, HypothesisDismissal } from "@fleetos/health";
import { createActionPlan, createInMemoryDeviceRegistryView, submitActionPlan } from "@fleetos/actions";
import type { ActionPlanTemplate } from "@fleetos/actions";
import { createServiceWorkOrder } from "@fleetos/maintenance";
import type { MaintenanceDiagnosisProposal, ServiceWorkOrder } from "@fleetos/maintenance";
import {
  buildMaintenanceNotice,
  createInMemoryDeliveryLedger,
  createInMemoryOutboxLedger,
  createInMemoryTransport,
  emitCommunicationMessage,
  ingestDeliveryMetadata,
} from "@fleetos/integration-aurum";
import type { DeliveryRecord } from "@fleetos/integration-aurum";
import type { LearningAuditSink, LearningTenantScope } from "../src/index";
import type { CertifiedCapabilityFacet, LearningAdoptionProposal, RedactionRecordFacet } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** Later injected instants for decision/revision flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device id. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");

/** Deterministic principal ids. */
export const USER_1: UserId = asUserId("usr_testuser00001");
export const USER_2: UserId = asUserId("usr_testuser00002");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_learning_test1");
export const CORR_2: CorrelationId = asCorrelationId("cor_learning_test2");

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

/** Tenant scope A (structurally identical to identity's TenantContext). */
export function scopeA(correlationId: CorrelationId = CORR): LearningTenantScope {
  return { tenantId: TENANT_A, correlationId };
}

/** Tenant scope B. */
export function scopeB(correlationId: CorrelationId = CORR_2): LearningTenantScope {
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

/**
 * The REAL W031 Guardian evaluation function — injected at the binding
 * site wherever a Guardian decision is needed (TypeScript structural
 * typing accepts it; the tests prove the gating runs on real decisions).
 */
export const realGuardian = evaluateGuardianRequest;

/** A rule that fires WARN for one action kind. */
export function warnRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `warn-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "WARN",
    at: T0,
  });
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

/** A rule that fires BLOCK for one action kind. */
export function blockRule(tenantId: TenantId, action: string): GuardianRule {
  return rule(tenantId, {
    name: `block-${action}`,
    condition: { kind: "action", actions: { in: [action] } },
    effect: "BLOCK",
    at: T0,
  });
}

/** The action kind the learning case-submission gate is evaluated under. */
export const LEARNING_CASE_ACTION = "learning.case.submit";

/** A canonical Guardian request for the learning case-submission action. */
export function caseSubmitRequest(tenantId: TenantId = TENANT_A) {
  return {
    tenantId,
    action: { action: LEARNING_CASE_ACTION, targetKind: "device.health.treatment" },
    principal: { userId: USER_1, role: "operator", department: "ops" },
  };
}

// ---------------------------------------------------------------------------
// The REAL W021 health diagnosis (the health module edge)
// ---------------------------------------------------------------------------

/** Build a REAL health signal (the frozen derivation input shape). */
export function healthSignal(
  kind: SignalKind,
  value: number,
  observedAt: string,
  observationId: string,
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
): HealthSignal {
  return Object.freeze({
    tenantId,
    deviceId,
    kind,
    unit: SIGNAL_KIND_SPECIFICATIONS[kind].unit,
    value,
    observedAt,
    sourceObservationId: asObservationId(observationId),
    confidence: SIGNAL_KIND_SPECIFICATIONS[kind].directConfidence,
    detail: {},
    signalModelVersion: 1,
    schemaVersion: 1,
  });
}

/**
 * Drive the REAL W021 diagnosis pipeline for a critically-aged battery:
 * signal -> anomaly detection -> diagnosis. Returns the REAL hypothesis
 * + treatment recommendation + the observation ids behind the evidence.
 */
export function realHealthDiagnosis(tenantId: TenantId = TENANT_A, deviceId: DeviceId = DEV_A1): {
  readonly hypothesis: DiagnosisHypothesis;
  readonly recommendation: TreatmentRecommendation;
  readonly observationIds: readonly string[];
} {
  const signals = [
    healthSignal("battery.capacity", 8, atHour(10), "obs_learn_battery_1", tenantId, deviceId),
    healthSignal("battery.capacity", 9, atHour(12), "obs_learn_battery_2", tenantId, deviceId),
  ];
  const detected = detectAnomalies(signals, {
    tenantId,
    asOf: atHour(24),
    windowMs: 24 * HOUR_MS,
  });
  if (!detected.ok) throw new Error("anomaly detection failed");
  const result = diagnose(detected.anomalies, {
    tenantId,
    deviceId,
    at: atHour(24),
    correlationId: CORR,
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.hypotheses.length === 0 || result.recommendations.length === 0) {
    throw new Error("expected at least one hypothesis + recommendation");
  }
  const observationIds = result.hypotheses[0].evidence.flatMap((link) => [...link.observationIds]);
  return {
    hypothesis: result.hypotheses[0],
    recommendation: result.recommendations[0],
    observationIds,
  };
}

/**
 * Drive the REAL W021 dismissal flow: append the hypothesis to a REAL
 * ledger, then dismiss it (the recorded operator judgment).
 */
export function realHealthDismissal(
  hypothesis: DiagnosisHypothesis,
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
  reason = "operator_rejected",
): HypothesisDismissal {
  let ledger = createDiagnosisLedger(tenantId, deviceId);
  const appended = appendHypothesis(ledger, hypothesis);
  if (!appended.ok) throw new Error("hypothesis append failed");
  ledger = appended.ledger;
  const dismissed = dismissHypothesis(ledger, hypothesis.id, {
    at: T1,
    reason,
    correlationId: CORR,
  });
  if (!dismissed.ok) throw new Error(dismissed.error.message);
  return dismissed.dismissal;
}

// ---------------------------------------------------------------------------
// The REAL W041 action plan (the actions module edge)
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

/**
 * Build a REAL W041 action plan and submit it through the REAL Guardian
 * to the ADVANCED terminal status (an empty rule set -> ALLOW). The plan
 * carries evidence artifacts so the outcome observation has observable
 * observation refs.
 */
export function realAdvancedActionPlan(tenantId: TenantId = TENANT_A): ActionPlanTemplate {
  const descriptor = Object.freeze({
    tenantId,
    deviceId: DEV_A1,
    lifecycleState: "OBSERVE" as const,
    adapterCapabilities: FULLY_CAPABLE,
    platform: "windows",
  });
  const plan = createActionPlan({
    name: "learning-test-lock-plan",
    selector: { kind: "all" },
    capability: "lock",
    tenantId,
    registry: createInMemoryDeviceRegistryView([descriptor]),
    at: T0,
    evidence: [evidenceRef("evidence/plan-basis-1"), evidenceRef("evidence/plan-basis-2")],
  });
  if (!plan.ok) throw new Error(plan.error.message);
  const submitted = submitActionPlan(plan.plan, {
    ruleSet: ruleSet(tenantId, []),
    request: {
      tenantId,
      action: { action: "device.lock", targetKind: "device" },
      principal: { userId: USER_1, role: "fleet_manager" },
    },
    at: T1,
    correlationId: CORR,
  });
  if (!submitted.ok) throw new Error(submitted.error.message);
  if (submitted.plan.status !== "ADVANCED") {
    throw new Error(`expected ADVANCED, got ${submitted.plan.status}`);
  }
  return submitted.plan;
}

// ---------------------------------------------------------------------------
// The REAL W042 service work order (the maintenance module edge)
// ---------------------------------------------------------------------------

/**
 * Build a REAL W042 service work order citing the REAL W021 diagnosis
 * (the cross-surface loop: the work order's diagnosis evidence carries
 * the real hypothesis/recommendation ids, the real proposed intent, and
 * the real observation ids behind the anomalies).
 */
export function realWorkOrder(
  hypothesis: DiagnosisHypothesis,
  recommendation: TreatmentRecommendation,
  observationIds: readonly string[],
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
): ServiceWorkOrder {
  const result = createServiceWorkOrder(
    { tenantId, correlationId: CORR },
    {
      deviceId,
      diagnosis: {
        hypothesisId: hypothesis.id,
        recommendationId: recommendation.id,
        causeId: hypothesis.causeId,
        confidence: hypothesis.confidence,
        proposedIntent: recommendation.proposedIntent as MaintenanceDiagnosisProposal,
        observationIds: [...observationIds],
      },
      serviceArea: "us-east-1",
      deadline: T2,
      slaFloor: { coverage: 0.9 },
      warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: false },
      qualityFloor: { score: 0.8 },
      availabilityFloor: { ratio: 0.5 },
      serviceCategory: "service.battery",
      at: T1,
      correlationId: CORR,
    },
    { at: T1, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.workOrder;
}

// ---------------------------------------------------------------------------
// The REAL W050C delivery record (the aurum module edge)
// ---------------------------------------------------------------------------

/**
 * Drive the REAL W050C delivery pipeline: emit a maintenance notice
 * into the REAL outbox, then ingest the provider-reported delivery
 * metadata for a TERMINAL state (delivered -> succeeded).
 */
export function realDeliveredRecord(tenantId: TenantId = TENANT_A): DeliveryRecord {
  const outbox = createInMemoryOutboxLedger();
  const ctx = makeTenantContext(tenantId, CORR);
  const built = buildMaintenanceNotice({
    recipient: { kind: "role", role: "fleet_manager" },
    at: T1,
    correlationId: CORR,
    workOrder: {
      workOrderId: "swo_learningtest01",
      tenantId,
      deviceId: DEV_A1,
      revision: 1,
      serviceArea: "us-east-1",
      deadline: T2,
      serviceCategory: "service.battery",
    },
    event: "created",
  });
  if (!built.ok) throw new Error(built.error.message);
  const emission = emitCommunicationMessage(ctx, outbox, built.intent, {
    transport: createInMemoryTransport(),
  });
  if (!emission.ok) throw new Error(emission.error.message);
  const messageRef = emission.entry.intent.messageId;
  const ledger = createInMemoryDeliveryLedger();
  const ingested = ingestDeliveryMetadata(
    ctx,
    outbox,
    ledger,
    {
      messageRef,
      deliveryAttempt: 1,
      state: "delivered",
      recipient: { recipientRef: "fleet_manager", channel: "email" },
      disposition: "succeeded",
      ingestedAt: T2,
      correlationId: CORR,
    },
  );
  if (!ingested.ok) throw new Error(ingested.error.message);
  return ingested.record;
}

// ---------------------------------------------------------------------------
// The REAL audit log + sink adapter (the audit module edge)
// ---------------------------------------------------------------------------

/** Create the REAL hash-chained AuditLog. */
export function realAuditLog(): AuditLog {
  return createInMemoryAuditLog();
}

/**
 * Bind the REAL @fleetos/audit sink adapter to the learning seam: the
 * adapter's `AuditSink` satisfies the learning package's
 * `LearningAuditSink` STRUCTURALLY (TypeScript structural typing — the
 * type-level proof; the audit test suite is the runtime proof).
 */
export function realLearningAuditSink(log: AuditLog): LearningAuditSink {
  return createAuditSinkAdapter(log, { source: "learning.w070-test" });
}

// ---------------------------------------------------------------------------
// Learning fixtures (deterministic)
// ---------------------------------------------------------------------------

/** A canonical certified-capability metadata (valid-by-construction). */
export function certifiedMetadata(opts: {
  tenantId?: TenantId;
  capabilityId?: string;
  capabilityVersion?: string;
  certificationRef?: string;
  evaluationSuiteRevision?: string;
  fleetOSCompatibilityStatement?: "compatible" | "compatible_with_warnings" | "incompatible";
  warnings?: readonly string[];
  capabilityClass?: string;
  certificationHash?: string;
} = {}): CertifiedCapabilityFacet {
  return {
    tenantId: opts.tenantId ?? TENANT_A,
    capabilityId: opts.capabilityId ?? "device.health.battery_aging_classifier",
    capabilityVersion: opts.capabilityVersion ?? "1.2.0",
    certificationRef: opts.certificationRef ?? certificationRef(),
    evaluationSuiteRevision: opts.evaluationSuiteRevision ?? "suite/v1",
    fleetOSCompatibilityStatement: opts.fleetOSCompatibilityStatement ?? "compatible",
    ...(opts.warnings !== undefined ? { warnings: opts.warnings } : {}),
    ...(opts.capabilityClass !== undefined ? { capabilityClass: opts.capabilityClass } : {}),
    ...(opts.certificationHash !== undefined ? { certificationHash: opts.certificationHash } : {}),
  };
}

/** A canonical certification reference (matches the canonical grammar). */
export function certificationRef(seed = "test-cert-1"): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let chars = "";
  let state = hash;
  for (let i = 0; i < 16; i++) {
    state = (state * 0x01000193) >>> 0;
    chars += alphabet[state % alphabet.length];
  }
  return `acr_${chars}`;
}

/** A canonical human-approved adoption proposal (the explicit grant). */
export function adoptionProposal(opts: {
  proposalId?: string;
  approverId?: UserId;
  approvedAt?: string;
  cohort?: string;
  rollbackVersion?: string;
  supersedes?: string;
} = {}): LearningAdoptionProposal {
  return {
    proposalId: opts.proposalId ?? "prop/test-1",
    approverId: opts.approverId ?? USER_1,
    approvedAt: opts.approvedAt ?? T0,
    cohort: opts.cohort ?? "cohort/canary-1",
    rollbackVersion: opts.rollbackVersion ?? "1.1.0",
    ...(opts.supersedes !== undefined ? { supersedes: opts.supersedes } : {}),
  };
}

/** A canonical redaction record (typed state; never fabricated). */
export function redaction(
  state: "raw" | "deidentified" | "redacted" = "deidentified",
): RedactionRecordFacet {
  return {
    state,
    appliedPolicies: state === "raw" ? [] : ["policy/deidentify-v1"],
  };
}

// ---------------------------------------------------------------------------
// Error narrowing helpers
// ---------------------------------------------------------------------------

/** Narrow a FleetError to its ValidationError failures or throw. */
export function failuresOf(
  error: import("@fleetos/contracts").FleetError,
): readonly { path: string; reason: string }[] {
  if (error.kind !== "ValidationError") {
    throw new Error(`expected ValidationError, got ${error.kind} (${error.code})`);
  }
  return error.failures;
}

/** Narrow a tagged refusal to its machine-stable invariant or throw. */
export function invariantOf(error: import("@fleetos/contracts").FleetError): string {
  if (error.kind !== "DomainError") {
    throw new Error(`expected DomainError, got ${error.kind} (${error.code})`);
  }
  return error.invariant ?? "missing_invariant";
}
