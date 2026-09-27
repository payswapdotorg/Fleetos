/**
 * W040 recovery test helpers — deterministic builders for recovery-package
 * tests. Local to the test suite (not exported from src/). Everything
 * here is a pure function of its inputs: no clock, no entropy.
 *
 * The helpers bind the CROSS-LANE module edges to the REAL sibling
 * packages (the ownership gate scans only src/ files, so test files may
 * import across lanes — the established W011/W021/W022/W031/W032/W041
 * pattern for proving structural compatibility):
 *   - @fleetos/policy      — the real Guardian engine (evaluateGuardianRequest)
 *                            + real rule-set compilation;
 *   - @fleetos/device-adapters — the real W020 EndpointAdapter + the
 *                            in-memory Windows seam (call recording proves
 *                            refused requests NEVER reach the seam);
 *   - @fleetos/security    — the real posture assessment (assessSecurityPosture);
 *   - @fleetos/health      — the real diagnosis engine (diagnose);
 *   - @fleetos/vendors     — the real vendor terms (buildVendor);
 *   - @fleetos/audit       — the real hash-chained AuditLog + sink adapter;
 *   - @fleetos/identity    — the real TenantContext (makeTenantContext);
 *   - @fleetos/contracts/testing — the frozen fixture builders.
 */

import { asCorrelationId, asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CorrelationId,
  DeviceId,
  EvidenceRef,
  Observation,
  ObservationBatch,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import { asObservationId } from "@fleetos/contracts";
import {
  defineGuardianRule,
  compileGuardianRuleSet,
  evaluateGuardianRequest,
  type DefineGuardianRuleInput,
  type GuardianRule,
  type GuardianRuleSet,
} from "@fleetos/policy";
import {
  createEndpointAdapter,
  createInMemoryWindowsSeam,
  type EndpointAdapter,
  type InMemoryWindowsSeam,
} from "@fleetos/device-adapters";
import type { RecoveryTrigger } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** Later injected instants for revision/decision flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;
export const T2 = "2026-03-01T00:00:00Z" as const;
export const T3 = "2026-04-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const DEV_A2: DeviceId = asDeviceId("dev_testdevice00a2");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice00b1");

/** Deterministic principal id. */
export const USER_1: UserId = asUserId("usr_testuser00001");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_recovery_test1");
export const CORR_2: CorrelationId = asCorrelationId("cor_recovery_test2");

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
export function scopeB(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_B, correlationId };
}

/** Staleness thresholds: fresh within 1h, stale after 24h (the indeterminate band between). */
export const THRESHOLDS = Object.freeze({ freshWithinMs: HOUR_MS, staleAfterMs: 24 * HOUR_MS });

/** A canonical observation with a deterministic id (mirrors W021's helper). */
let observationCounter = 0;
export function obs(kind: string, payload: unknown, observedAt: string, id?: string): Observation {
  observationCounter += 1;
  return Object.freeze({
    id: asObservationId(id ?? `obs_rec_${String(observationCounter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

/** A canonical location observation (kind `device.location` — the frozen canonical kind). */
export function locationObservation(
  observedAt: string,
  latitude: number,
  longitude: number,
  id?: string,
): Observation {
  return obs(
    "device.location",
    Object.freeze({ latitude, longitude, capturedAt: observedAt, fixSource: "gps" }),
    observedAt,
    id,
  );
}

/** A canonical observation batch for one device. */
export function batch(
  deviceId: DeviceId,
  observations: readonly Observation[],
  observedAt: string,
  tenantId: TenantId = TENANT_A,
): ObservationBatch {
  return Object.freeze({
    deviceId,
    observedAt,
    tenantId,
    observations: Object.freeze([...observations]),
  });
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
 * site wherever the recovery package's `GuardianEvaluateFn` seam is
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

// ---------------------------------------------------------------------------
// The REAL W020 EndpointAdapter (the injected adapter seam)
// ---------------------------------------------------------------------------

/** Build a REAL endpoint adapter over the in-memory Windows seam. */
export function adapter(
  tenantId: TenantId,
  deviceId: DeviceId,
  capabilities: AdapterCapabilities,
  seamOptions: Parameters<typeof createInMemoryWindowsSeam>[0] = {},
): { adapter: EndpointAdapter; seam: InMemoryWindowsSeam } {
  const seam = createInMemoryWindowsSeam(seamOptions);
  const endpoint = createEndpointAdapter({
    descriptor: {
      adapterId: `adp-${deviceId as string}`,
      platform: "windows",
      tenantId,
      deviceId,
      adapterVersion: "1.0.0-test",
    },
    seams: seam,
    capabilities,
    declaredAt: T0,
  });
  return { adapter: endpoint, seam };
}

/** The full destructive capability set (lock/locate/wipe/reboot supported). */
export const FULLY_CAPABLE: AdapterCapabilities = Object.freeze({
  identify: true,
  observe: true,
  health: true,
  lock: true,
  locate: true,
  wipe: true,
  reboot: true,
});

/** An adapter that supports NOTHING destructive (lock/locate/wipe/reboot unsupported). */
export const NON_DESTRUCTIVE_CAPABILITIES: AdapterCapabilities = Object.freeze({
  identify: true,
  observe: true,
  health: true,
});

// ---------------------------------------------------------------------------
// Recovery inputs
// ---------------------------------------------------------------------------

/** A canonical lost-report trigger. */
export function lostTrigger(reportedAt: string = T0): RecoveryTrigger {
  return { kind: "lost_report", reportedAt, reportedBy: USER_1, note: "left on a train" };
}

/** A canonical stolen-report trigger. */
export function stolenTrigger(reportedAt: string = T0): RecoveryTrigger {
  return { kind: "stolen_report", reportedAt, reportedBy: USER_1 };
}
