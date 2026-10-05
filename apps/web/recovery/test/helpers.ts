/**
 * W060A web-recovery test helpers — deterministic builders for the
 * web-recovery UI-surface binding tests. Local to the test suite (not
 * exported from src/). Everything here is a pure function of its
 * inputs: no clock, no entropy, no I/O.
 *
 * The helpers bind the module edges to the REAL packages (the
 * ownership gate scans only src/ files, so test files may import
 * across lanes — the established W011/W021/W022/W031/W032/W040/W041/
 * W051 pattern for proving structural compatibility):
 *   - @fleetos/recovery       — the REAL W040 domain (the last-seen
 *                              ledger + findMyDevice, the recovery case
 *                              store + the frozen transition tables,
 *                              the destructive-request store + the
 *                              Guardian-routed destructive gate);
 *   - @fleetos/actions        — the REAL W041 fleet-action domain
 *                              (createActionPlan + the in-memory
 *                              registry view + the ActionStore + the
 *                              policy gate);
 *   - @fleetos/policy         — the REAL W031 Contract Guardian engine
 *                              (defineGuardianRule +
 *                              compileGuardianRuleSet +
 *                              evaluateGuardianRequest);
 *   - @fleetos/device-adapters — the REAL W020 EndpointAdapter over
 *                              the in-memory Windows seam;
 *   - @fleetos/contracts      — the frozen shapes + branded id builders.
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
  createInMemoryRecoveryCaseStore,
  createInMemoryLastSeenLedger,
  createInMemoryDestructiveRequestStore,
  findMyDevice,
  openRecoveryCase,
  recordLastSeenObservations,
  requestDestructiveAction,
  approveDestructiveRequest,
  ACTIVE_RECOVERY_CASE_STATUSES,
  RECOVERY_CASE_TRANSITIONS,
  TERMINAL_RECOVERY_CASE_STATUSES,
  type LastSeenLedger,
  type LastSeenRecord,
  type RecoveryCaseRecord,
  type RecoveryCaseStore,
  type DestructiveRequestRecord,
  type DestructiveRequestStore,
  type RecoveryTrigger,
  type StalenessThresholds,
  type FindMyDeviceView,
} from "@fleetos/recovery";
import {
  createActionPlan,
  createInMemoryActionStore,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
  ACTION_PLAN_TRANSITIONS,
  TERMINAL_ACTION_PLAN_STATUSES,
  PARKED,
  type ActionPlanTemplate,
  type ActionStore,
  type CreateActionPlanInput,
  type DeviceDescriptor,
  type DeviceGroupSelector,
} from "@fleetos/actions";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
  type DefineGuardianRuleInput,
  type GuardianRule,
  type GuardianRuleSet,
} from "@fleetos/policy";
import {
  createEndpointAdapter,
  createInMemoryWindowsSeam,
  type EndpointAdapter,
} from "@fleetos/device-adapters";
import type {
  ActionPlanLike,
  ActionPlanSource,
  DestructiveRequestLike,
  DestructiveRequestSource,
  FindMyDeviceSource,
  RecoveryCaseLike,
  RecoveryCaseSource,
  StatusMachineTable,
} from "../src/index";

// Re-exported for the binding tests (test-scope cross-lane use).
export { createInMemoryRecoveryCaseStore, createInMemoryDestructiveRequestStore, transitionRecoveryCase } from "@fleetos/recovery";
export { createInMemoryActionStore } from "@fleetos/actions";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** One hour / one day in milliseconds. */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Deterministic tenant ids (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const DEV_A2: DeviceId = asDeviceId("dev_testdevice00a2");
export const DEV_A3: DeviceId = asDeviceId("dev_testdevice00a3");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice00b1");

/** Deterministic principal + correlation ids. */
export const USER_1: UserId = asUserId("usr_testuser00001");
export const CORR: CorrelationId = asCorrelationId("cor_webrecov_tst1");
export const CORR_2: CorrelationId = asCorrelationId("cor_webrecov_tst2");

/** A deterministic ISO timestamp offset from T0 by whole hours. */
export function atHour(hours: number): string {
  return new Date(Date.parse(T0) + hours * HOUR_MS).toISOString();
}

/** Staleness thresholds: fresh within 1h, stale after 24h. */
export const THRESHOLDS: StalenessThresholds = Object.freeze({
  freshWithinMs: HOUR_MS,
  staleAfterMs: 24 * HOUR_MS,
});

/** The acting tenant-A scope (the tenant rides every query). */
export const SCOPE_A = Object.freeze({ tenantId: TENANT_A });
/** The acting tenant-B scope. */
export const SCOPE_B = Object.freeze({ tenantId: TENANT_B });

// ---------------------------------------------------------------------------
// Deterministic canonical observations + batches
// ---------------------------------------------------------------------------

let observationCounter = 0;

/** A canonical observation with a deterministic id. */
export function obs(kind: string, payload: unknown, observedAt: string, id?: string): Observation {
  observationCounter += 1;
  return Object.freeze({
    id: asObservationId(id ?? `obs_wrec_${String(observationCounter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

/** A canonical location observation (kind `device.location`). */
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

/** The REAL W031 Guardian evaluation function (injected at binding sites). */
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
): EndpointAdapter {
  const seam = createInMemoryWindowsSeam({});
  return createEndpointAdapter({
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

// ---------------------------------------------------------------------------
// The REAL recovery domain bindings
// ---------------------------------------------------------------------------

/** The recovery-scope shape the REAL domain functions take. */
function recoveryScope(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_A, correlationId };
}

/**
 * Record last-seen evidence into the REAL ledger and return it. The
 * scope's tenant is always TENANT_A (the binding is tenant-A-scoped;
 * tenant-B partitions are exercised via the store's own partitioning).
 */
export function seededLastSeenLedger(
  entries: readonly { deviceId: DeviceId; batches: readonly ObservationBatch[]; at: string }[],
): LastSeenLedger {
  const ledger = createInMemoryLastSeenLedger();
  for (const entry of entries) {
    const result = recordLastSeenObservations(
      recoveryScope(),
      ledger,
      entry.deviceId,
      entry.batches,
      { at: entry.at, thresholds: THRESHOLDS, correlationId: CORR },
    );
    if (!result.ok) throw new Error(`recordLastSeen failed: ${result.error.message}`);
  }
  return ledger;
}

/**
 * The REAL Find-My-Device source: binds the REAL `findMyDevice`
 * derivation + the REAL ledger into the surface's
 * `FindMyDeviceSource` seam. The REAL `FindMyDeviceView` flows where
 * `FindMyViewLike` is expected — the structural proof.
 */
export function realFindMySource(ledger: LastSeenLedger): FindMyDeviceSource {
  return {
    view: (tenantId, deviceId, at, bands) => {
      // The REAL derivation, driven by the VIEW's injected instant + bands.
      const view: FindMyDeviceView = findMyDevice(
        { tenantId, correlationId: CORR },
        ledger,
        deviceId,
        { at, thresholds: bands },
      );
      return view;
    },
    revisions: (tenantId, deviceId) => {
      const records: readonly LastSeenRecord[] = ledger.listLastSeenRevisions(
        { tenantId, correlationId: CORR },
        deviceId,
      );
      return records.map((record) => ({
        recordId: record.recordId,
        version: record.version,
        observedAt: record.observedAt,
        recordedAt: record.recordedAt,
        staleness: record.staleness,
        evidence: record.evidence as readonly string[],
        hasLocationEvidence: record.locationEvidence !== undefined,
      }));
    },
  };
}

/** The REAL recovery-case transition table (injected into the surface). */
export const REAL_CASE_TABLE: StatusMachineTable = Object.freeze({
  transitions: RECOVERY_CASE_TRANSITIONS as Readonly<Record<string, readonly string[]>>,
  terminal: TERMINAL_RECOVERY_CASE_STATUSES,
  active: ACTIVE_RECOVERY_CASE_STATUSES,
});

/** The REAL action-plan transition table (injected into the surface). */
export const REAL_PLAN_TABLE: StatusMachineTable = Object.freeze({
  transitions: ACTION_PLAN_TRANSITIONS as Readonly<Record<string, readonly string[]>>,
  terminal: TERMINAL_ACTION_PLAN_STATUSES,
  parked: [PARKED],
});

/** The REAL destructive-request transition table (injected into the surface). */
export const REAL_REQUEST_TABLE: StatusMachineTable = Object.freeze({
  transitions: {
    REQUESTED: ["ADVANCED", "PARKED", "REJECTED"],
    ADVANCED: ["EXECUTED", "FAILED", "REJECTED"],
    PARKED: ["APPROVED", "REJECTED"],
    APPROVED: ["EXECUTED", "FAILED", "REJECTED"],
    EXECUTED: [],
    FAILED: [],
    REJECTED: [],
  } as Readonly<Record<string, readonly string[]>>,
  terminal: ["EXECUTED", "FAILED", "REJECTED"],
  parked: ["PARKED"],
});

/** A canonical lost-report trigger. */
export function lostTrigger(reportedAt: string = T0): RecoveryTrigger {
  return { kind: "lost_report", reportedAt, reportedBy: USER_1, note: "left on a train" };
}

/** A canonical posture-escalation trigger. */
export function postureTrigger(assessedAt: string = T0): RecoveryTrigger {
  return {
    kind: "posture_escalation",
    postureStatus: "CRITICAL",
    findingRefs: ["secfinding0001", "secfinding0002"],
    assessedAt,
    reportedBy: USER_1,
  };
}

/**
 * The REAL recovery-case source: binds the REAL case store into the
 * surface's `RecoveryCaseSource` seam (REAL `RecoveryCaseRecord`
 * values flow where `RecoveryCaseLike` is expected).
 */
export function realCaseSource(store: RecoveryCaseStore): RecoveryCaseSource {
  return {
    list: (tenantId) => {
      const scope = { tenantId, correlationId: CORR };
      const ids = store.listCaseIds(scope);
      const latest = ids
        .map((caseId) => store.getLatestCase(scope, caseId))
        .filter((record): record is RecoveryCaseRecord => record !== undefined);
      return [...latest].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0)) as readonly RecoveryCaseLike[];
    },
    history: (tenantId, caseId) =>
      store.listCaseRevisions({ tenantId, correlationId: CORR }, caseId) as readonly RecoveryCaseLike[],
    latest: (tenantId, caseId) =>
      store.getLatestCase({ tenantId, correlationId: CORR }, caseId) as RecoveryCaseLike | undefined,
  };
}

/**
 * The REAL destructive-request source: binds the REAL request store
 * into the surface's `DestructiveRequestSource` seam (REAL
 * `DestructiveRequestRecord` values flow where
 * `DestructiveRequestLike` is expected — the intent payload projects
 * to its action kind; everything else passes through verbatim).
 */
export function realDestructiveSource(store: DestructiveRequestStore): DestructiveRequestSource {
  const project = (record: DestructiveRequestRecord): DestructiveRequestLike => ({
    requestId: record.requestId,
    recordId: record.recordId,
    tenantId: record.tenantId,
    deviceId: record.deviceId,
    caseId: record.caseId,
    version: record.version,
    action: record.intentPayload.action,
    status: record.status,
    requestedAt: record.requestedAt,
    ...(record.requestedBy !== undefined ? { requestedBy: record.requestedBy } : {}),
    caseEvidence: record.caseEvidence,
    evidence: record.evidence,
    ...(record.decision !== undefined ? { decision: record.decision } : {}),
    ...(record.matchedRules !== undefined ? { matchedRules: record.matchedRules } : {}),
    ...(record.reasons !== undefined ? { reasons: record.reasons } : {}),
    ...(record.refusalReason !== undefined ? { refusalReason: record.refusalReason } : {}),
    ...(record.decidedAt !== undefined ? { decidedAt: record.decidedAt } : {}),
    ...(record.approvedBy !== undefined ? { approvedBy: record.approvedBy } : {}),
    ...(record.approvalDecidedAt !== undefined ? { approvalDecidedAt: record.approvalDecidedAt } : {}),
    ...(record.execution !== undefined
      ? {
          execution: {
            attemptedAt: record.execution.attemptedAt,
            outcome: record.execution.outcome,
            adapterEvidence: record.execution.adapterEvidence,
          },
        }
      : {}),
    contentDigest: record.contentDigest,
  });
  return {
    list: (tenantId) => {
      const ids = store.listRequestIds({ tenantId, correlationId: CORR });
      const latest = ids
        .map((requestId) => store.getLatestRequest({ tenantId, correlationId: CORR }, requestId))
        .filter((record): record is DestructiveRequestRecord => record !== undefined);
      return latest.map(project);
    },
    history: (tenantId, requestId) =>
      store
        .listRequestRevisions({ tenantId, correlationId: CORR }, requestId)
        .map(project),
    latest: (tenantId, requestId) => {
      const record = store.getLatestRequest({ tenantId, correlationId: CORR }, requestId);
      return record === undefined ? undefined : project(record);
    },
  };
}

/** Open a REAL recovery case or throw. */
export function openCaseOrThrow(
  store: RecoveryCaseStore,
  deviceId: DeviceId,
  trigger: RecoveryTrigger,
  evidence: { lastSeenRecordId?: string; lastSeenObservedAt?: string; postureFindingRefs?: readonly string[] } = {},
  at: string = T0,
): RecoveryCaseRecord {
  const result = openRecoveryCase(recoveryScope(), store, {
    deviceId,
    trigger,
    ...evidence,
  }, { at, correlationId: CORR });
  if (!result.ok) throw new Error(`openRecoveryCase failed: ${result.error.message}`);
  return result.record;
}

// ---------------------------------------------------------------------------
// The REAL fleet-action bindings (W041)
// ---------------------------------------------------------------------------

/** Build a REAL action plan or throw. */
export function planOrThrow(
  tenantId: TenantId,
  input: Omit<CreateActionPlanInput, "tenantId">,
): ActionPlanTemplate {
  const result = createActionPlan({ ...input, tenantId });
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

/** A REAL in-memory registry view with the given descriptors. */
export function registry(descriptors: readonly DeviceDescriptor[]): ReturnType<typeof createInMemoryDeviceRegistryView> {
  return createInMemoryDeviceRegistryView(descriptors);
}

/** A canonical device descriptor. */
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

/**
 * The REAL action-plan source: binds the REAL ActionStore into the
 * surface's `ActionPlanSource` seam (REAL `ActionPlanTemplate` values
 * flow where `ActionPlanLike` is expected — the structural proof).
 */
export function realPlanSource(store: ActionStore): ActionPlanSource {
  const scope = (tenantId: TenantId) => ({ tenantId, correlationId: CORR });
  return {
    list: (tenantId) => {
      const ids = store.listPlanIds(scope(tenantId));
      const latest = ids
        .map((planId) => store.getLatestPlan(scope(tenantId), planId))
        .filter((plan): plan is ActionPlanTemplate => plan !== undefined);
      return [...latest].sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0)) as readonly ActionPlanLike[];
    },
    latest: (tenantId, planId) =>
      store.getLatestPlan(scope(tenantId), planId) as ActionPlanLike | undefined,
  };
}

/** Store plan revisions into the REAL ActionStore. */
export function storePlans(
  store: ActionStore,
  plans: readonly ActionPlanTemplate[],
): ActionStore {
  for (const plan of plans) {
    const write = store.appendPlan({ tenantId: plan.tenantId, correlationId: CORR }, plan);
    if (!write.ok) throw new Error(`appendPlan failed: ${write.error.message}`);
  }
  return store;
}

// ---------------------------------------------------------------------------
// The REAL destructive gate flow (used by the binding tests)
// ---------------------------------------------------------------------------

/** The full options bundle the REAL destructive gate consumes. */
export interface GateRun {
  readonly caseStore: RecoveryCaseStore;
  readonly requestStore: DestructiveRequestStore;
  readonly caseRecord: RecoveryCaseRecord;
  readonly adapter: EndpointAdapter;
}

/** Run the REAL destructive request flow for one action + rule set. */
export function requestDestructiveOrThrow(
  run: GateRun,
  action: "lock" | "locate" | "wipe" | "reboot",
  rules: readonly GuardianRule[],
  at: string,
  correlationId: CorrelationId = CORR,
): DestructiveRequestRecord {
  const result = requestDestructiveAction(
    { tenantId: run.caseRecord.tenantId, correlationId },
    run.requestStore,
    run.caseRecord,
    action,
    {
      ruleSet: ruleSet(run.caseRecord.tenantId, rules),
      evaluator: realGuardian,
      adapter: run.adapter,
      at,
      correlationId,
      policyCacheReady: true,
      requestedBy: USER_1 as string,
      evidence: [evidenceRef(`evidence/${action}-request`)],
    },
  );
  if (!result.ok) throw new Error(`requestDestructiveAction failed: ${result.error.message}`);
  return result.record;
}

/** Run the REAL human-approval step on a PARKED request. */
export function approveDestructiveOrThrow(
  run: GateRun,
  parked: DestructiveRequestRecord,
  decision: "approve" | "reject",
  at: string,
  correlationId: CorrelationId = CORR_2,
): DestructiveRequestRecord {
  const result = approveDestructiveRequest(
    { tenantId: parked.tenantId, correlationId },
    run.requestStore,
    parked,
    decision,
    {
      adapter: run.adapter,
      at,
      correlationId,
      policyCacheReady: true,
      approverId: USER_1 as string,
    },
  );
  if (!result.ok) throw new Error(`approveDestructiveRequest failed: ${result.error.message}`);
  return result.record;
}

// ---------------------------------------------------------------------------
// Selector fixtures (REAL DeviceGroupSelector values)
// ---------------------------------------------------------------------------

/** A canonical composed selector: windows MINUS the explicit a2 set. */
export const COMPOSED_SELECTOR: DeviceGroupSelector = {
  kind: "intersect",
  selectors: [
    { kind: "byPlatform", platform: "windows" },
    {
      kind: "subtract",
      base: { kind: "all" },
      minus: { kind: "byId", deviceIds: [DEV_A2] },
    },
  ],
};
