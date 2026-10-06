/**
 * W153 predictive test helpers — deterministic builders for
 * predictive-package tests. Local to the test suite (not exported from
 * src/). Everything here is a pure function of its inputs: no clock,
 * no entropy.
 *
 * The helpers bind the module edges to the REAL sibling packages (the
 * ownership gate scans only src/ files, so test files may import across
 * lanes — the established W011/W021/W031/W070 pattern for proving
 * structural compatibility):
 *   - @fleetos/contracts   — the frozen contracts + branded id constructors;
 *   - @fleetos/audit       — the REAL hash-chained AuditLog + sink adapter;
 *   - @fleetos/identity    — the REAL TenantContext (makeTenantContext);
 *   - @fleetos/device-model — the REAL observation ingestion boundary +
 *                            twin store (the immutable admitted stream).
 */

import { asCorrelationId, asDeviceId, asObservationId, asTenantId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  IdempotencyKey,
  Observation,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import { createAuditSinkAdapter, createInMemoryAuditLog } from "@fleetos/audit";
import type { AuditLog } from "@fleetos/audit";
import { makeTenantContext } from "@fleetos/identity";
import {
  createInMemoryTwinStore,
  createObservationIngestionService,
  createTwin,
  enrollDevice,
} from "@fleetos/device-model";
import type { TwinStore } from "@fleetos/device-model";
import type { AdmittedDeviceObservation, PredictiveAuditSink } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** Later injected instants. */
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant00a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant00b");

/** Deterministic device ids. */
export const DEV_A1: DeviceId = asDeviceId("dev_testdevice00a1");
export const DEV_A2: DeviceId = asDeviceId("dev_testdevice00a2");
export const DEV_B1: DeviceId = asDeviceId("dev_testdevice00b1");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_predictive_t1");
export const CORR_2: CorrelationId = asCorrelationId("cor_predictive_t2");

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;
/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** A deterministic ISO timestamp offset from T0 by whole hours. */
export function atHour(hours: number): string {
  return new Date(Date.parse(T0) + hours * HOUR_MS).toISOString();
}

/** Tenant scope A (structurally identical to identity's TenantContext). */
export function scopeA(correlationId: CorrelationId = CORR): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_A, correlationId };
}

/** Tenant scope B. */
export function scopeB(correlationId: CorrelationId = CORR_2): { tenantId: TenantId; correlationId: CorrelationId } {
  return { tenantId: TENANT_B, correlationId };
}

// ---------------------------------------------------------------------------
// Deterministic observation builders
// ---------------------------------------------------------------------------

let observationCounter = 0;

/** A deterministic unique observation id (stable per call order). */
export function nextObservationId(prefix = "obs"): ObservationId {
  observationCounter += 1;
  return asObservationId(`${prefix}_test${String(observationCounter).padStart(6, "0")}`);
}

/** A well-formed observation with a numeric telemetry payload. */
export function telemetryObservation(
  id: ObservationId,
  atHourOffset: number,
  payload: Record<string, unknown>,
  kind: string = "device.health",
): Observation {
  return {
    id,
    kind,
    observedAt: atHour(atHourOffset),
    schemaVersion: 1,
    payload,
  };
}

/** An admitted observation attributed to (tenant, device). */
export function admitted(
  observation: Observation,
  tenantId: TenantId = TENANT_A,
  deviceId: DeviceId = DEV_A1,
): AdmittedDeviceObservation {
  return { tenantId, deviceId, observation };
}

/**
 * A canonical 6-observation numeric history over hours 0..10 for
 * DEV_A1: battery levels (mixed presence), temperatures, and a boolean
 * diskEncryption field (never numerically summarized).
 */
export function numericHistory(): AdmittedDeviceObservation[] {
  const rows: Array<[number, number, number, boolean | undefined]> = [
    [0, 100, 42.5, true],
    [2, 96, 43.0, true],
    [4, 90, 44.25, undefined],
    [6, 84, 45.0, false],
    [8, 74, 46.5, false],
    [10, 62, 47.75, false],
  ];
  return rows.map((row, index) => {
    const [hour, battery, temperature, encryption] = row;
    const payload: Record<string, unknown> = {
      batteryLevel: battery,
      temperatureC: temperature,
    };
    if (encryption !== undefined) payload["diskEncryption"] = encryption;
    return admitted(
      telemetryObservation(asObservationId(`obs_num${String(index + 1).padStart(4, "0")}`), hour, payload),
    );
  });
}

/** An absolute window [from, to). */
export function absoluteWindow(from: string, to: string): { kind: "absolute"; from: string; to: string } {
  return { kind: "absolute", from, to };
}

/** A relative window resolving to [anchor - durationMs, anchor). */
export function relativeWindow(anchor: string, durationMs: number): { kind: "relative"; anchor: string; durationMs: number } {
  return { kind: "relative", anchor, durationMs };
}

// ---------------------------------------------------------------------------
// The REAL audit log + sink adapter (the D4 binding edge)
// ---------------------------------------------------------------------------

/** A fresh REAL hash-chained audit log. */
export function realAuditLog(): AuditLog {
  return createInMemoryAuditLog();
}

/**
 * The REAL @fleetos/audit sink adapter — satisfies the predictive
 * `PredictiveAuditSink` seam STRUCTURALLY (TypeScript structural
 * typing; proven by test) and appends into the hash-chained log.
 */
export function realPredictiveAuditSink(log: AuditLog): PredictiveAuditSink {
  return createAuditSinkAdapter(log, { source: "predictive.test" });
}

/** The REAL tenant context for audit-log queries. */
export function tenantContext(tenantId: TenantId, correlationId: CorrelationId = CORR) {
  return makeTenantContext(tenantId, correlationId);
}

// ---------------------------------------------------------------------------
// The REAL ingestion boundary (the immutable admitted stream edge)
// ---------------------------------------------------------------------------

/** The composed result of driving the REAL ingestion boundary. */
export interface IngestedHistory {
  readonly store: TwinStore;
  readonly observations: readonly AdmittedDeviceObservation[];
}

/**
 * Drive the REAL W011 observation ingestion boundary: enroll DEV_A1,
 * create its twin, and admit three check-in batches (two observations
 * each) through the real ingestion service. Returns the twin store and
 * the ADMITTED observations (the immutable stream the extractor may
 * read) — exactly the discipline the W153 work order demands ("your
 * ONLY source of device history is the immutable admitted observation
 * stream").
 */
export function ingestedRealHistory(): IngestedHistory {
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    adapterFamily: "windows-mdm",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad T14", serialNumber: "TEST-0001" },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "field-ops" },
    at: T0,
    provenance: { correlationId: CORR },
  });
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR } });
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);
  store.put(created.twin);

  const service = createObservationIngestionService({ store });

  const batches: Array<Array<[string, number, Record<string, unknown>]>> = [
    [
      ["obs_ing0001", 1, { batteryLevel: 98, temperatureC: 40.5 }],
      ["obs_ing0002", 3, { batteryLevel: 93, temperatureC: 41.0, diskEncryption: true }],
    ],
    [
      ["obs_ing0003", 5, { batteryLevel: 88, temperatureC: 42.5, diskEncryption: true }],
      ["obs_ing0004", 7, { batteryLevel: 81, temperatureC: 44.0, diskEncryption: false }],
    ],
    [
      ["obs_ing0005", 9, { batteryLevel: 70, temperatureC: 45.5, diskEncryption: false }],
      ["obs_ing0006", 11, { batteryLevel: 65, temperatureC: 46.0, diskEncryption: false }],
    ],
  ];

  for (let b = 0; b < batches.length; b++) {
    const observations: Observation[] = batches[b]!.map(([id, hour, payload]) => ({
      id: asObservationId(id),
      kind: "device.health",
      observedAt: atHour(hour),
      schemaVersion: 1,
      payload,
    }));
    const ack = service.ingest({
      tenantId: TENANT_A,
      batch: {
        tenantId: TENANT_A,
        deviceId: DEV_A1,
        observedAt: observations[observations.length - 1]!.observedAt,
        observations,
      },
      idempotencyKey: asIdempotencyKey(`idem_pred_${b + 1}`),
      correlationId: CORR,
      receivedAt: atHour(12 + b),
    });
    if (!ack.ok) throw new Error(`ingest failed: ${ack.error.message}`);
    if (ack.ack.kind !== "admitted") throw new Error(`expected admitted, got ${ack.ack.kind}`);
  }

  const twin = store.get(TENANT_A, DEV_A1);
  if (twin === undefined) throw new Error("twin missing after ingestion");
  const observations = twin.telemetry.latest.map((observation) =>
    admitted(observation, TENANT_A, DEV_A1),
  );
  if (observations.length !== 6) {
    throw new Error(`expected 6 admitted observations, got ${observations.length}`);
  }
  return { store, observations };
}

/** asIdempotencyKey re-export (the branded constructor the helper uses). */
function asIdempotencyKey(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}
