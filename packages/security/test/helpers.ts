/**
 * W031 security test helpers — deterministic builders for
 * security-package tests. Local to the test suite (not exported from
 * src/). Everything here is a pure function of its inputs: no clock, no
 * entropy.
 */

import { asCorrelationId, asDeviceId, asObservationId, asTenantId } from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  Observation,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import type { SecurityTenantScope } from "../src/index";

/** A fixed, well-known anchor for all test timestamps. */
export const T0 = "2026-01-01T00:00:00Z" as const;

/** A later injected timestamp for re-assessment flows. */
export const T1 = "2026-02-01T00:00:00Z" as const;

/** Deterministic tenant ids for tests (canonical grammar). */
export const TENANT_A: TenantId = asTenantId("tnt_testtenant000a");
export const TENANT_B: TenantId = asTenantId("tnt_testtenant000b");

/** Deterministic device ids. */
export const DEV_1: DeviceId = asDeviceId("dev_testdevice0001");
export const DEV_2: DeviceId = asDeviceId("dev_testdevice0002");

/** Deterministic correlation ids. */
export const CORR: CorrelationId = asCorrelationId("cor_security_tst1");
export const CORR_2: CorrelationId = asCorrelationId("cor_security_tst2");

/** Deterministic tenant scopes (structurally identical to identity's TenantContext). */
export function scopeA(correlationId: CorrelationId = CORR): SecurityTenantScope {
  return { tenantId: TENANT_A, correlationId };
}
export function scopeB(correlationId: CorrelationId = CORR): SecurityTenantScope {
  return { tenantId: TENANT_B, correlationId };
}

/** Build a `device.security` observation with a v1 payload (deterministic). */
export function securityObservation(
  payload: Record<string, unknown>,
  options: { id?: string; observedAt?: string; schemaVersion?: number } = {},
): Observation {
  return {
    id: (options.id !== undefined ? asObservationId(options.id) : asObservationId("obs_w031test0001")),
    kind: "device.security",
    observedAt: options.observedAt ?? T0,
    schemaVersion: options.schemaVersion ?? 1,
    payload,
  };
}

/** A non-security observation (for skip-reason tests). */
export function otherObservation(
  kind: string,
  options: { id?: string; observedAt?: string; schemaVersion?: number; payload?: unknown } = {},
): Observation {
  return {
    id: options.id !== undefined ? asObservationId(options.id) : asObservationId("obs_w031test0099"),
    kind,
    observedAt: options.observedAt ?? T0,
    schemaVersion: options.schemaVersion ?? 1,
    payload: options.payload ?? { sample: "x" },
  };
}

/** A fully-healthy v1 security payload (no rule fires). */
export function healthyPayload(): Record<string, unknown> {
  return {
    diskEncryption: true,
    screenLock: { enabled: true, maxLockSeconds: 60 },
    firewall: { enabled: true },
    endpointProtection: { enabled: true, upToDate: true },
    osUpdates: { supported: true, pendingCritical: 0 },
    malware: { activeDetections: 0 },
  };
}

/** A worst-case v1 security payload (every rule fires). */
export function worstPayload(): Record<string, unknown> {
  return {
    diskEncryption: false,
    screenLock: { enabled: false, maxLockSeconds: 3600 },
    firewall: { enabled: false },
    endpointProtection: { enabled: false, upToDate: false },
    osUpdates: { supported: false, pendingCritical: 4 },
    malware: { activeDetections: 2 },
  };
}
