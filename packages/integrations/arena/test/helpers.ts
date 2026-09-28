/**
 * W050B arena test helpers — deterministic builders for arena-package
 * tests. Local to the test suite (not exported from src/). Everything
 * here is a pure function of its inputs: no clock, no entropy.
 *
 * The helpers bind the module edges to the REAL sibling packages (the
 * ownership gate scans only src/ files, so test files may import across
 * lanes — the established W011/W021/W022/W031/W032/W040/W041 pattern
 * for proving structural compatibility):
 *   - @fleetos/policy      — the real Guardian engine (evaluateGuardianRequest)
 *                            + real rule-set compilation;
 *   - @fleetos/audit       — the real hash-chained AuditLog + sink adapter;
 *   - @fleetos/identity    — the real TenantContext (makeTenantContext);
 *   - @fleetos/contracts/testing — the frozen fixture builders.
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
  evaluateGuardianRequest,
  type DefineGuardianRuleInput,
  type GuardianRule,
  type GuardianRuleSet,
} from "@fleetos/policy";
import type {
  ArenaGuardianRequest,
  EvaluationLabel,
  EvaluationOutcome,
  RedactionRecord,
  SubmitEvaluationCaseInput,
} from "../src/index";
import type { CertifiedCapabilityMetadata } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** Later injected instants for revision/decision flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device id. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");

/** Deterministic principal id. */
export const USER_1: UserId = asUserId("usr_testuser00001");
export const USER_2: UserId = asUserId("usr_testuser00002");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_arena_test1");
export const CORR_2: CorrelationId = asCorrelationId("cor_arena_test2");

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
export function scopeA(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_A, correlationId };
}

/** Tenant scope B. */
export function scopeB(correlationId: CorrelationId = CORR_2): { tenantId: TenantId; correlationId: CorrelationId } {
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
 * site wherever the arena package's `GuardianEvaluateFn` seam is
 * expected (TypeScript structural typing accepts it; the tests prove the
 * routing runs through the real engine).
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

/** A canonical Guardian request context for an arena.case.submit action. */
export function caseSubmitRequest(tenantId: TenantId = TENANT_A): ArenaGuardianRequest {
  return {
    tenantId,
    action: { action: "arena.case.submit", targetKind: "device.health.battery_aging" },
    principal: { userId: USER_1, role: "operator", department: "ops" },
  };
}

// ---------------------------------------------------------------------------
// Arena evaluation-case inputs (deterministic)
// ---------------------------------------------------------------------------

/** A canonical evaluation outcome. */
export function outcome(label = "true_positive", value = "battery_aged"): EvaluationOutcome {
  return {
    label,
    value,
    observedAt: T0,
    evidenceRefs: [evidenceRef()],
  };
}

/** A canonical evaluation label. */
export function label(key = "severity", value = "high"): EvaluationLabel {
  return { key, value };
}

/** A canonical redaction record. */
export function redaction(state: "raw" | "deidentified" | "redacted" = "deidentified"): RedactionRecord {
  return {
    state,
    appliedPolicies: state === "raw" ? [] : ["policy/deidentify-v1"],
  };
}

/** A canonical evaluation-case submission input. */
export function caseInput(opts: {
  problemClass?: string;
  observationRefs?: readonly string[];
  context?: Readonly<Record<string, unknown>>;
  actionHistoryRefs?: readonly string[];
  outcome?: EvaluationOutcome;
  labels?: readonly EvaluationLabel[];
  tenantPolicyRefs?: readonly string[];
  redaction?: RedactionRecord;
} = {}): SubmitEvaluationCaseInput {
  return {
    problemClass: opts.problemClass ?? "device.health.battery_aging",
    observationRefs: opts.observationRefs ?? ["obs/test-1", "obs/test-2"],
    context: opts.context ?? { device: "dev_testdevice00a1", fleet: "fleet-1" },
    actionHistoryRefs: opts.actionHistoryRefs ?? ["int/test-1"],
    outcome: opts.outcome ?? outcome(),
    labels: opts.labels ?? [label()],
    tenantPolicyRefs: opts.tenantPolicyRefs ?? ["policy/tenant-a-v1"],
    redaction: opts.redaction ?? redaction(),
  };
}

// ---------------------------------------------------------------------------
// Arena certified-capability metadata (deterministic, valid-by-construction)
// ---------------------------------------------------------------------------

/** A canonical certification reference (matches the canonical grammar). */
export function certificationRef(seed = "test-cert-1"): string {
  // acr_ prefix + 16 base32 chars (deterministic from the seed; mirrors
  // the frozen contracts testing helper's base32 alphabet).
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Use the hash to derive 16 base32 chars deterministically.
  let chars = "";
  let state = hash;
  for (let i = 0; i < 16; i++) {
    state = (state * 0x01000193) >>> 0;
    chars += alphabet[state % alphabet.length];
  }
  return `acr_${chars}`;
}

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
} = {}): CertifiedCapabilityMetadata {
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
