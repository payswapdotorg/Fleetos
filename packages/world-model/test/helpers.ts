/**
 * @fleetos/world-model — shared test helpers + fixtures.
 *
 * Builds the test fixtures the lane's tests share: a demo tenant scope,
 * deterministic seed timestamps, a feature-set builder (using the REAL
 * `@fleetos/predictive` `extractDeviceHistoryFeatures` — the binding
 * site that injects the real W153 feed into the W154 engine), a context
 * builder, and the seeded demo-fleet composition (the W091 pattern —
 * REAL @fleetos/device-model store + observations across multiple time
 * instants — the SAME composition pattern the demo-fleet.ts runtime
 * uses, replicated here so the binding test proves the world-model
 * engine against the REAL device-model + REAL W153 feed + REAL audit
 * sink adapter without importing apps/web).
 *
 * The binding-site composition (the W040-disclosed structural-seam
 * pattern): the W154 engine consumes the W153 feed through LOCAL
 * structural interfaces (`FeatureSetLike`, `FeatureStatusLike`, ...);
 * the binding site (tests) injects the REAL `@fleetos/predictive`
 * `extractDeviceHistoryFeatures` output (TypeScript's structural typing
 * means the real W153 `DeviceHistoryFeatureSet` satisfies the local
 * `FeatureSetLike` interface without a cross-lane src/ import).
 */

import {
  asCorrelationId,
  asDeviceId,
  asObservationId,
  asTenantId,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  Observation,
  TenantId,
} from "@fleetos/contracts";
import { extractDeviceHistoryFeatures } from "@fleetos/predictive";
import type { DeviceHistoryFeatureSet } from "@fleetos/predictive";
import {
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import type { DeviceTwin } from "@fleetos/device-model";

// ---------------------------------------------------------------------------
// The demo tenant scope + deterministic seed timestamps
// ---------------------------------------------------------------------------

/** The dedicated demo tenant (mirrors apps/web/src/runtime/demo-fleet.ts). */
export const TENANT_ID: TenantId = asTenantId("tnt_w154demo000001");
/** A second tenant for tenant-isolation tests. */
export const TENANT_B: TenantId = asTenantId("tnt_w154tenant0002");

/** The acting tenant scope. */
export const SCOPE = Object.freeze({ tenantId: TENANT_ID } as const);
/** A foreign tenant scope (for tenant-isolation tests). */
export const FOREIGN_SCOPE = Object.freeze({ tenantId: TENANT_B } as const);

/** Deterministic seed timestamps (no clock reads). */
export const T0 = "2026-01-06T09:00:00Z" as const;
export const T1 = "2026-01-06T10:00:00Z" as const;
export const T2 = "2026-01-06T11:00:00Z" as const;
export const T3 = "2026-01-06T12:00:00Z" as const;
export const T4 = "2026-01-06T13:00:00Z" as const;
export const T5 = "2026-01-06T14:00:00Z" as const;
export const T6 = "2026-01-06T15:00:00Z" as const;
export const T7 = "2026-01-06T16:00:00Z" as const;
export const NOW = "2026-01-06T17:00:00Z" as const;

/** The extraction instant (injected — never a clock read). */
export const EXTRACTED_AT = T7;
/** The representation derivation instant (the context's asOf). */
export const AS_OF = T7;
/** The prediction production instant. */
export const PRODUCED_AT = T7;

/** Demo devices. */
export const DEV_1: DeviceId = asDeviceId("dev_w154demo000001");
export const DEV_2: DeviceId = asDeviceId("dev_w154demo000002");
export const DEV_3: DeviceId = asDeviceId("dev_w154demo000003");

/** Demo correlation ids. */
export const CORR_1: CorrelationId = asCorrelationId("cor_w154demo000001");
export const CORR_2: CorrelationId = asCorrelationId("cor_w154demo000002");
export const CORR_3: CorrelationId = asCorrelationId("cor_w154demo000003");

// ---------------------------------------------------------------------------
// The observation builder (deterministic, no clock)
// ---------------------------------------------------------------------------

let observationCounter = 0;
/**
 * Build a deterministic observation. The id is `obs_w154nnnn` (zero-padded
 * counter — deterministic across runs because tests reset the counter
 * via `resetObservationCounter`). The payload is the caller's; the
 * schemaVersion is 1 (the canonical contracts value).
 */
export function makeObservation(
  kind: string,
  observedAt: string,
  payload: unknown,
): Observation {
  observationCounter += 1;
  const id = asObservationId(`obs_w154${observationCounter.toString().padStart(5, "0")}`);
  return Object.freeze({
    id,
    kind,
    observedAt,
    schemaVersion: 1,
    payload: Object.freeze(payload),
  });
}

/** Reset the deterministic observation counter (for golden-test stability). */
export function resetObservationCounter(): void {
  observationCounter = 0;
}

// ---------------------------------------------------------------------------
// The feature-set builder (the binding site that injects the REAL W153 feed)
// ---------------------------------------------------------------------------

/**
 * Build a REAL W153 `DeviceHistoryFeatureSet` from a list of observations
 * + a window + an extraction instant. This is the BINDING SITE that
 * injects the REAL `@fleetos/predictive` `extractDeviceHistoryFeatures`
 * output into the W154 engine — TypeScript's structural typing means the
 * real W153 `DeviceHistoryFeatureSet` satisfies the W154 engine's local
 * `FeatureSetLike` interface (the W040-disclosed structural-seam pattern).
 */
export function buildFeatureSet(input: {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly observations: readonly Observation[];
  readonly window: { readonly from: string; readonly to: string };
  readonly extractedAt: string;
}): DeviceHistoryFeatureSet {
  const result = extractDeviceHistoryFeatures({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    observations: input.observations,
    window: input.window,
    extractedAt: input.extractedAt,
  });
  if (!result.ok) {
    throw new Error(`extractDeviceHistoryFeatures failed: ${result.error.message}`);
  }
  return result.featureSet;
}

// ---------------------------------------------------------------------------
// The window helpers
// ---------------------------------------------------------------------------

/** A window covering the demo fleet's observation span [T1, T7). */
export const DEMO_WINDOW = Object.freeze({ from: T1, to: T7 } as const);

/** A window containing no demo fleet observations [T5, T7) (empty window). */
export const EMPTY_WINDOW = Object.freeze({ from: T5, to: T7 } as const);

// ---------------------------------------------------------------------------
// The seeded demo fleet (the W091 pattern, replicated)
// ---------------------------------------------------------------------------

/**
 * Seed a demo fleet of 3 devices with multiple observations each across
 * multiple time instants. Uses the REAL @fleetos/device-model APIs
 * (`enrollDevice`, `createTwin`, `recordTwinObservations`) — the SAME
 * APIs the demo-fleet.ts runtime uses. The composition is deterministic
 * (the same seed yields byte-identical twins + feature sets).
 *
 * The seeded observations span:
 *   - DEV_1: 4 device.security observations over [T1, T4] with mixed
 *     numeric telemetry payloads (battery level, disk free bytes);
 *   - DEV_2: 3 device.health observations over [T1, T3] with battery
 *     capacity + cycle count;
 *   - DEV_3: 2 device.connectivity observations over [T1, T2].
 */
export interface SeededDemoFleet {
  readonly tenantId: TenantId;
  readonly devices: ReadonlyArray<{
    readonly deviceId: DeviceId;
    readonly twin: DeviceTwin;
    readonly observations: readonly Observation[];
    readonly featureSet: DeviceHistoryFeatureSet;
  }>;
}

/** Seed the demo fleet (deterministic — the same seed yields byte-identical twins + feature sets). */
export function seedDemoFleet(): SeededDemoFleet {
  const seeded: SeededDemoFleet["devices"][number][] = [];

  // DEV_1 — 4 device.security observations across [T1, T4] with battery
  // + disk telemetry (numeric payloads the feature extractor will
  // summarize).
  const dev1Observations: Observation[] = [
    makeObservation("device.security", T1, { diskEncryption: true, batteryLevel: 92, diskFreeBytes: 256_000_000_000 }),
    makeObservation("device.security", T2, { diskEncryption: true, batteryLevel: 88, diskFreeBytes: 240_000_000_000 }),
    makeObservation("device.security", T3, { diskEncryption: false, batteryLevel: 75, diskFreeBytes: 220_000_000_000 }),
    makeObservation("device.security", T4, { diskEncryption: false, batteryLevel: 61, diskFreeBytes: 200_000_000_000 }),
  ];
  seeded.push({
    deviceId: DEV_1,
    twin: seedTwin(DEV_1, "Lenovo", "ThinkPad T14", "windows-mdm", dev1Observations),
    observations: dev1Observations,
    featureSet: buildFeatureSet({
      tenantId: TENANT_ID,
      deviceId: DEV_1,
      observations: dev1Observations,
      window: DEMO_WINDOW,
      extractedAt: EXTRACTED_AT,
    }),
  });

  // DEV_2 — 3 device.health observations across [T1, T3] with battery
  // capacity + cycle count (numeric summaries).
  const dev2Observations: Observation[] = [
    makeObservation("device.health", T1, { batteryCapacity: 95.5, cycleCount: 12, healthScore: 88 }),
    makeObservation("device.health", T2, { batteryCapacity: 93.2, cycleCount: 13, healthScore: 86 }),
    makeObservation("device.health", T3, { batteryCapacity: 91.8, cycleCount: 14, healthScore: 85 }),
  ];
  seeded.push({
    deviceId: DEV_2,
    twin: seedTwin(DEV_2, "Apple", "MacBook Air M3", "macos-mdm", dev2Observations),
    observations: dev2Observations,
    featureSet: buildFeatureSet({
      tenantId: TENANT_ID,
      deviceId: DEV_2,
      observations: dev2Observations,
      window: DEMO_WINDOW,
      extractedAt: EXTRACTED_AT,
    }),
  });

  // DEV_3 — 2 device.connectivity observations across [T1, T2].
  const dev3Observations: Observation[] = [
    makeObservation("device.connectivity", T1, { signalStrength: -42, latencyMs: 18 }),
    makeObservation("device.connectivity", T2, { signalStrength: -55, latencyMs: 32 }),
  ];
  seeded.push({
    deviceId: DEV_3,
    twin: seedTwin(DEV_3, "Google", "Pixel 9", "android-mdm", dev3Observations),
    observations: dev3Observations,
    featureSet: buildFeatureSet({
      tenantId: TENANT_ID,
      deviceId: DEV_3,
      observations: dev3Observations,
      window: DEMO_WINDOW,
      extractedAt: EXTRACTED_AT,
    }),
  });

  return Object.freeze({
    tenantId: TENANT_ID,
    devices: Object.freeze(seeded),
  });
}

/** Enroll a device, create its twin, and record the observations. */
function seedTwin(
  deviceId: DeviceId,
  manufacturer: string,
  model: string,
  adapterFamily: string,
  observations: readonly Observation[],
): DeviceTwin {
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId,
    adapterFamily,
    hardware: { manufacturer, model, serialNumber: `${model}-${deviceId as string}` },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR_1 } });
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);
  if (observations.length === 0) return created.twin;
  const observed = recordTwinObservations(
    created.twin,
    observations,
    { at: T1, correlationId: CORR_1 },
  );
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);
  return observed.twin;
}

// ---------------------------------------------------------------------------
// The single-observation + empty-window + no-numeric-payload fixtures
// ---------------------------------------------------------------------------

/** A device with exactly one observation (for the single-observation honesty test). */
export function seedSingleObservationFeatureSet(): DeviceHistoryFeatureSet {
  resetObservationCounter();
  const obs = makeObservation("device.security", T2, { diskEncryption: true, batteryLevel: 80 });
  return buildFeatureSet({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [obs],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
}

/** An empty-window feature set (no observations in [T5, T7)). */
export function seedEmptyWindowFeatureSet(): DeviceHistoryFeatureSet {
  resetObservationCounter();
  // The observations are at T1, T2 — but the window is [T5, T7), so
  // the W153 feed's window check rejects them. To get a true
  // `empty_window` (not `rejected`), we pass an EMPTY observations
  // array.
  return buildFeatureSet({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [],
    window: EMPTY_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
}

/** A no-numeric-payload feature set (boolean-only observations — status `ok`, no numeric features). */
export function seedNoNumericPayloadFeatureSet(): DeviceHistoryFeatureSet {
  resetObservationCounter();
  const obs1 = makeObservation("device.security", T1, { diskEncryption: true, vpnConnected: true });
  const obs2 = makeObservation("device.security", T2, { diskEncryption: false, vpnConnected: false });
  const obs3 = makeObservation("device.security", T3, { diskEncryption: true, vpnConnected: true });
  return buildFeatureSet({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [obs1, obs2, obs3],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
}

/** A tenant-mismatch feature set (the W153 feed's `rejected` status with reason `tenant_mismatch`). */
export function seedTenantMismatchFeatureSet(): DeviceHistoryFeatureSet {
  resetObservationCounter();
  // Build a feature set under TENANT_ID, then we'll try to represent it
  // with a FOREIGN_SCOPE (the W154 engine's tenant guard refuses).
  const obs1 = makeObservation("device.security", T1, { batteryLevel: 92 });
  const obs2 = makeObservation("device.security", T2, { batteryLevel: 88 });
  return buildFeatureSet({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [obs1, obs2],
    window: DEMO_WINDOW,
    extractedAt: EXTRACTED_AT,
  });
}
