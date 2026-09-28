/**
 * W060A web-device test helpers — deterministic builders for the
 * web-device UI-surface binding tests. Local to the test suite (not
 * exported from src/). Everything here is a pure function of its
 * inputs: no clock, no entropy, no I/O.
 *
 * The helpers bind the CROSS-LANE module edges to the REAL sibling
 * packages (the ownership gate scans only src/ files, so test files
 * may import across lanes — the established W011/W021/W022/W031/W032/
 * W040/W041/W051 pattern for proving structural compatibility):
 *   - @fleetos/device-model — the REAL Device Twin domain (enrollDevice,
 *                            createTwin, recordTwinObservations,
 *                            updateTwinSection, transitionTwinLifecycle,
 *                            createInMemoryTwinStore);
 *   - @fleetos/health      — the REAL W021 health/diagnosis pipeline
 *                            (deriveSignals, buildDeviceBaseline,
 *                            detectAnomalies, diagnose, the append-only
 *                            interpretation ledger, hypothesisStatus);
 *   - @fleetos/contracts   — the frozen shapes + branded id builders.
 *
 * The binding proofs live here BY TYPE: `createInMemoryTwinStore()`
 * (the REAL TwinStore) is returned where `DeviceTwinSource` is
 * expected, and REAL `DeviceTwin` values flow where `DeviceTwinLike`
 * is expected — TypeScript structural typing is the compile-time
 * proof; the tests are the runtime proof.
 */

import { asCorrelationId, asDeviceId, asObservationId, asTenantId, asUserId, asWorkloadId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  Observation,
  TenantId,
  UserId,
  WorkloadId,
} from "@fleetos/contracts";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
  transitionTwinLifecycle,
  updateTwinSection,
  type DeviceTwin,
  type OwnershipType,
  type RecoveryState,
  type SecurityPostureSummary,
  type TwinStore,
} from "@fleetos/device-model";
import {
  appendHypothesis,
  appendRecommendation,
  buildDeviceBaseline,
  createDiagnosisLedger,
  deriveSignals,
  detectAnomalies,
  diagnose,
  dismissHypothesis,
  hypothesisStatus,
  type DiagnosisLedger,
  type DiagnosisLedgerEntry,
  type HealthSignal,
  type SignalBaseline,
} from "@fleetos/health";
import type {
  DeviceTwinSource,
  DoctorSources,
} from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;
/** One day in milliseconds. */
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
export const CORR: CorrelationId = asCorrelationId("cor_webdevice_tst1");
export const CORR_2: CorrelationId = asCorrelationId("cor_webdevice_tst2");

/** A deterministic ISO timestamp offset from T0 by whole hours. */
export function atHour(hours: number): string {
  return new Date(Date.parse(T0) + hours * HOUR_MS).toISOString();
}

/** A deterministic ISO timestamp offset from T0 by whole days. */
export function atDay(days: number): string {
  return new Date(Date.parse(T0) + days * DAY_MS).toISOString();
}

/** Staleness bands: fresh within 1h, stale after 24h (indeterminate between). */
export const BANDS = Object.freeze({ freshWithinMs: HOUR_MS, staleAfterMs: 24 * HOUR_MS });

/** The acting tenant-A scope (the tenant rides every query). */
export const SCOPE_A = Object.freeze({ tenantId: TENANT_A });
/** The acting tenant-B scope. */
export const SCOPE_B = Object.freeze({ tenantId: TENANT_B });

// ---------------------------------------------------------------------------
// Deterministic canonical observations
// ---------------------------------------------------------------------------

let observationCounter = 0;

/** A canonical observation with a deterministic id. */
export function obs(
  kind: string,
  payload: unknown,
  observedAt: string,
  id?: string,
): Observation {
  observationCounter += 1;
  return Object.freeze({
    id: asObservationId(id ?? `obs_wdev_${String(observationCounter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

// ---------------------------------------------------------------------------
// REAL Device Twin builders (the @fleetos/device-model binding)
// ---------------------------------------------------------------------------

/** Options for the deterministic twin builder. */
export interface TwinFixtureOptions {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly serialNumber?: string;
  readonly assetTag?: string;
  readonly ownerType?: OwnershipType;
  readonly assignedTeam?: string;
  readonly assignedUserId?: UserId;
  /** Lifecycle hops from ENROLL (0 = ENROLL, 8 = LEARN). */
  readonly lifecycleHops?: number;
  /** Observations recorded into the telemetry window. */
  readonly observations?: readonly Observation[];
  /** Posture summary written through the section seam. */
  readonly postureSummary?: SecurityPostureSummary;
  readonly findingCount?: number;
  /** Recovery state written through the actions section seam. */
  readonly recoveryState?: RecoveryState;
  readonly activeActionIds?: readonly string[];
  readonly assignedWorkloadIds?: readonly WorkloadId[];
}

/** Advance through the lifecycle hops, returning the last ok twin or throwing. */
function hopLifecycle(twin: DeviceTwin, hops: number): DeviceTwin {
  let current = twin;
  for (const to of ["OBSERVE", "ASSESS", "DIAGNOSE", "PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "LEARN"]) {
    if (hops <= 0) break;
    const result = transitionTwinLifecycle(current, to as DeviceTwin["identity"]["lifecycleState"], {
      at: atHour(1),
      correlationId: CORR,
    });
    if (!result.ok) throw new Error(`lifecycle hop failed: ${result.error.message}`);
    current = result.twin;
    hops -= 1;
  }
  return current;
}

/**
 * Build a REAL Device Twin deterministically: enroll -> create -> (hop
 * lifecycle) -> record observations -> write posture/actions/workload
 * sections through the REAL section seam. Every mutation carries the
 * injected timestamp + correlation id (no clock reads).
 */
export function twinFixture(options: TwinFixtureOptions): DeviceTwin {
  const enrolled = enrollDevice({
    tenantId: options.tenantId,
    deviceId: options.deviceId,
    adapterFamily: options.adapterFamily ?? "windows",
    hardware: {
      manufacturer: options.manufacturer ?? "Lenovo",
      model: options.model ?? "ThinkPad X1",
      serialNumber: options.serialNumber ?? `SN-${options.deviceId as string}`,
      assetTag: options.assetTag ?? `ASSET-${options.deviceId as string}`,
    },
    ownership: {
      ownerType: options.ownerType ?? "FLEET_PURCHASED",
      assignedUserId: options.assignedUserId ?? USER_1,
      assignedTeam: options.assignedTeam,
    },
    at: T0,
    provenance: { correlationId: CORR },
  });
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);

  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR } });
  if (!created.ok) throw new Error(`createTwin failed: ${created.error.message}`);

  let twin = hopLifecycle(created.twin, options.lifecycleHops ?? 0);

  if (options.observations !== undefined && options.observations.length > 0) {
    const recorded = recordTwinObservations(twin, options.observations, {
      at: atHour(2),
      correlationId: CORR,
    });
    if (!recorded.ok) throw new Error(`record failed: ${recorded.error.message}`);
    twin = recorded.twin;
  }

  if (options.postureSummary !== undefined) {
    const updated = updateTwinSection(
      twin,
      "securityPosture",
      {
        tenantId: options.tenantId,
        deviceId: options.deviceId,
        postureSummary: options.postureSummary,
        findingCount: options.findingCount ?? 0,
        updatedAt: atHour(3),
      },
      { mutation: "security.posture-assessed", at: atHour(3), correlationId: CORR },
    );
    if (!updated.ok) throw new Error(`posture failed: ${updated.error.message}`);
    twin = updated.twin;
  }

  if (options.recoveryState !== undefined || options.activeActionIds !== undefined) {
    const current = twin.actions;
    const updated = updateTwinSection(
      twin,
      "actions",
      {
        tenantId: options.tenantId,
        deviceId: options.deviceId,
        activeActionIds: options.activeActionIds ?? current.activeActionIds,
        recoveryState: options.recoveryState ?? current.recoveryState,
      },
      { mutation: "recovery.state-changed", at: atHour(4), correlationId: CORR },
    );
    if (!updated.ok) throw new Error(`actions failed: ${updated.error.message}`);
    twin = updated.twin;
  }

  if (options.assignedWorkloadIds !== undefined) {
    const updated = updateTwinSection(
      twin,
      "workload",
      {
        tenantId: options.tenantId,
        deviceId: options.deviceId,
        assignedWorkloadIds: options.assignedWorkloadIds,
      },
      { mutation: "workload.assigned", at: atHour(4), correlationId: CORR },
    );
    if (!updated.ok) throw new Error(`workload failed: ${updated.error.message}`);
    twin = updated.twin;
  }

  return twin;
}

/**
 * The REAL TwinStore — returned where the surface's `DeviceTwinSource`
 * is expected. The return-type annotation IS the structural proof
 * (TwinStore has `list`/`get` with tenant-partitioned signatures the
 * source's contract accepts unchanged).
 */
export function realTwinSource(): DeviceTwinSource {
  const store: TwinStore = createInMemoryTwinStore();
  // The runtime proof: REAL twins flow through the source unchanged.
  return store;
}

/** Seed a REAL TwinStore with the given twins. */
export function seededTwinSource(twins: readonly DeviceTwin[]): DeviceTwinSource {
  const store = createInMemoryTwinStore();
  for (const twin of twins) store.put(twin);
  return store;
}

// ---------------------------------------------------------------------------
// REAL Device Doctor sources (the @fleetos/health binding)
// ---------------------------------------------------------------------------

/** Deterministic health observations for one device. */
export interface HealthFixture {
  readonly observations: readonly Observation[];
  readonly signals: readonly HealthSignal[];
  readonly baseline: SignalBaseline | undefined;
}

/**
 * Run the REAL W021 derivation over the given observations: signals +
 * an in-window device baseline for cpu.usage. Deterministic: the same
 * observations produce the same signals + baseline every run.
 */
export function healthFixture(
  tenantId: TenantId,
  deviceId: DeviceId,
  observations: readonly Observation[],
): HealthFixture {
  const derived = deriveSignals(observations, { tenantId, deviceId });
  if (!derived.ok) throw new Error(`deriveSignals failed: ${derived.error.message}`);

  let baseline: SignalBaseline | undefined;
  const cpuSignals = derived.signals.filter((s) => s.kind === "cpu.usage");
  if (cpuSignals.length > 0) {
    const built = buildDeviceBaseline({
      tenantId,
      deviceId,
      signalKind: "cpu.usage",
      signals: derived.signals,
      window: { asOf: atHour(48), windowMs: 48 * HOUR_MS },
    });
    if (built.ok) baseline = built.baseline;
  }

  return { observations, signals: derived.signals, baseline };
}

/** The stored ledger + derived record statuses for the doctor binding. */
export interface DiagnosisFixture {
  readonly ledger: DiagnosisLedger;
  readonly entries: readonly DiagnosisLedgerEntry[];
}

/**
 * Run the REAL W021 diagnosis engine over the REAL anomalies and append
 * every hypothesis + recommendation into the REAL append-only ledger;
 * optionally dismiss the first hypothesis and re-diagnose (versioned
 * lineage + supersession). Deterministic end-to-end.
 */
export function diagnosisFixture(
  tenantId: TenantId,
  deviceId: DeviceId,
  signals: readonly HealthSignal[],
  baseline: SignalBaseline | undefined,
  options: { readonly dismissFirst?: boolean; readonly reDiagnose?: boolean } = {},
): DiagnosisFixture {
  const detected = detectAnomalies(signals, {
    tenantId,
    asOf: atHour(48),
    windowMs: 48 * HOUR_MS,
    ...(baseline !== undefined ? { baselines: [baseline] } : {}),
  });
  if (!detected.ok) throw new Error(`detectAnomalies failed: ${detected.error.message}`);

  let ledger: DiagnosisLedger = createDiagnosisLedger(tenantId, deviceId);

  const first = diagnose(detected.anomalies, {
    tenantId,
    deviceId,
    at: atHour(49),
    correlationId: CORR,
  });
  if (!first.ok) throw new Error(`diagnose failed: ${first.error.message}`);
  for (const hypothesis of first.hypotheses) {
    const appended = appendHypothesis(ledger, hypothesis);
    if (!appended.ok) throw new Error(`appendHypothesis failed: ${appended.error.message}`);
    ledger = appended.ledger;
  }
  for (const recommendation of first.recommendations) {
    const appended = appendRecommendation(ledger, recommendation);
    if (!appended.ok) throw new Error(`appendRecommendation failed: ${appended.error.message}`);
    ledger = appended.ledger;
  }

  if (options.dismissFirst === true && first.hypotheses.length > 0) {
    const dismissed = dismissHypothesis(ledger, first.hypotheses[0].id, {
      reason: "operator_rejected",
      at: atHour(50),
      correlationId: CORR_2,
    });
    if (!dismissed.ok) throw new Error(`dismissHypothesis failed: ${dismissed.error.message}`);
    ledger = dismissed.ledger;
  }

  if (options.reDiagnose === true) {
    const reDetected = detectAnomalies(signals, {
      tenantId,
      asOf: atHour(48),
      windowMs: 48 * HOUR_MS,
      ...(baseline !== undefined ? { baselines: [baseline] } : {}),
    });
    if (!reDetected.ok) throw new Error(`re-detect failed: ${reDetected.error.message}`);
    const again = diagnose(reDetected.anomalies, {
      tenantId,
      deviceId,
      history: ledger.entries,
      at: atHour(51),
      correlationId: CORR_2,
    });
    if (!again.ok) throw new Error(`re-diagnose failed: ${again.error.message}`);
    for (const hypothesis of again.hypotheses) {
      const appended = appendHypothesis(ledger, hypothesis);
      if (!appended.ok) throw new Error(`re-append failed: ${appended.error.message}`);
      ledger = appended.ledger;
    }
    for (const recommendation of again.recommendations) {
      const appended = appendRecommendation(ledger, recommendation);
      if (!appended.ok) throw new Error(`re-append rec failed: ${appended.error.message}`);
      ledger = appended.ledger;
    }
  }

  return { ledger, entries: ledger.entries };
}

/**
 * The REAL Device Doctor sources: binds the REAL health pipeline state
 * (signals, baseline, anomalies, the append-only diagnosis ledger with
 * REAL derived statuses) into the surface's `DoctorSources` seam. The
 * statuses are derived with the REAL `hypothesisStatus` — the surface
 * never re-derives ledger state.
 */
export function realDoctorSources(
  tenantId: TenantId,
  deviceId: DeviceId,
  health: HealthFixture,
  diagnosis: DiagnosisFixture,
): DoctorSources {
  const detected = detectAnomalies(health.signals, {
    tenantId,
    asOf: atHour(48),
    windowMs: 48 * HOUR_MS,
    ...(health.baseline !== undefined ? { baselines: [health.baseline] } : {}),
  });
  if (!detected.ok) throw new Error(`doctor detect failed: ${detected.error.message}`);

  const hypotheses = diagnosis.entries
    .filter((entry): entry is Extract<DiagnosisLedgerEntry, { kind: "hypothesis" }> => entry.kind === "hypothesis")
    .map((entry) => entry.hypothesis);
  const recommendations = diagnosis.entries
    .filter((entry): entry is Extract<DiagnosisLedgerEntry, { kind: "recommendation" }> => entry.kind === "recommendation")
    .map((entry) => entry.recommendation);

  const statuses = new Map<string, ReturnType<typeof hypothesisStatus>>();
  for (const hypothesis of hypotheses) {
    statuses.set(hypothesis.id, hypothesisStatus(diagnosis.ledger, hypothesis.id));
  }
  const statusOf = (id: string): "ACTIVE" | "SUPERSEDED" | "DISMISSED" => {
    const status = statuses.get(id);
    return status === "ACTIVE" || status === "SUPERSEDED" || status === "DISMISSED"
      ? status
      : "SUPERSEDED";
  };

  return {
    signals: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId ? health.signals : [],
    baselines: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId && health.baseline !== undefined
        ? [health.baseline]
        : [],
    anomalies: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId ? detected.anomalies : [],
    diagnoses: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId
        ? hypotheses.map((hypothesis) => ({
            ...hypothesis,
            status: statusOf(hypothesis.id),
          }))
        : [],
    treatments: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId
        ? recommendations.map((recommendation) => ({
            ...recommendation,
            proposedIntentKind: recommendation.proposedIntent.intentKind,
            status: recommendations.some((other) => other.supersedes === recommendation.id)
              ? ("SUPERSEDED" as const)
              : statusOf(recommendation.hypothesisId) === "ACTIVE"
                ? ("ACTIVE" as const)
                : ("DISMISSED" as const),
          }))
        : [],
    evidenceRefs: (actingTenant, device) =>
      actingTenant === tenantId && device === deviceId
        ? hypotheses.flatMap((hypothesis) =>
            hypothesis.evidence.flatMap((link) => link.observationIds.map((observationId) => ({
              key: `observations://${device as string}/${observationId as string}`,
              sizeBytes: 128,
              hash: `fnv1a32-${observationId as string}`,
              hashAlgorithm: "fnv1a32",
            }))),
          )
        : [],
  };
}
