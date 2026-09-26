/**
 * W021 test helpers — deterministic builders for health-package tests.
 *
 * Local to the test suite (not exported from src/). Everything here is a
 * pure function of its inputs: no clock, no entropy.
 */

import { asCorrelationId, asDeviceId, asObservationId, asTenantId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  Observation,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import type { HealthSignal, SignalKind } from "../src/signals";
import { SIGNAL_KIND_SPECIFICATIONS, SIGNAL_MODEL_VERSION } from "../src/signals";

/** A fixed, well-known anchor for all test timestamps (matches the W003 fixture philosophy). */
export const T0 = "2026-01-01T00:00:00Z" as const;

/**
 * A fixed injected "now" for detection windows in conformance tests: the
 * day AFTER the fixture anchor, so every fixture timestamp (anchor +
 * seeded offset < 1 day) falls inside a window ending here.
 */
export const AS_OF = "2026-01-02T00:00:00Z" as const;

/** A 48-hour window: covers the full fixture day when anchored at AS_OF. */
export const SHORT_WINDOW_MS = 48 * 3_600_000;

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;

/** Deterministic tenant ids for tests. */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids for tests. */
export const DEVICE_1: DeviceId = asDeviceId("dev_testdevice0001");
export const DEVICE_2: DeviceId = asDeviceId("dev_testdevice0002");

/** Deterministic correlation id for tests. */
export const CORR: CorrelationId = asCorrelationId("cor_health_test");

let observationCounter = 0;

/** A canonical observation with a deterministic unique id. */
export function obs(
  kind: string,
  payload: unknown,
  observedAt: string,
  id?: string,
): Observation {
  observationCounter += 1;
  return Object.freeze({
    id: asObservationId(id ?? `obs_test_${String(observationCounter).padStart(4, "0")}`),
    kind,
    observedAt,
    schemaVersion: 1,
    payload,
  });
}

/** A deterministic ISO timestamp offset from T0 by whole hours. */
export function atHour(hours: number): string {
  return new Date(Date.parse(T0) + hours * HOUR_MS).toISOString();
}

/** A deterministic ISO timestamp offset from T0 by whole minutes. */
export function atMinute(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

/** Build a health signal directly (bypassing derivation) for baseline/detection tests. */
export function signal(
  kind: SignalKind,
  value: number,
  observedAt: string,
  opts?: { deviceId?: DeviceId; tenantId?: TenantId; observationId?: ObservationId },
): HealthSignal {
  return Object.freeze({
    tenantId: opts?.tenantId ?? TENANT_A,
    deviceId: opts?.deviceId ?? DEVICE_1,
    kind,
    unit: SIGNAL_KIND_SPECIFICATIONS[kind].unit,
    value,
    observedAt,
    sourceObservationId: opts?.observationId ?? asObservationId(`obs_sig_${kind}_${observedAt}`),
    confidence: SIGNAL_KIND_SPECIFICATIONS[kind].directConfidence,
    detail: {},
    signalModelVersion: SIGNAL_MODEL_VERSION,
    schemaVersion: 1,
  });
}

/** Canonical JSON of a value — used for deep-equality assertions on determinism. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}
