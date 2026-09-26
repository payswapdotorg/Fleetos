/**
 * @fleetos/device-model — Tenant-scoped twin store.
 *
 * "Tenant isolation is enforced at persistence and action boundaries"
 * (`spec/ARCHITECTURE-LOCK.md` item 17). This module is the persistence
 * seam: twins are keyed by (tenantId, deviceId) and every query takes an
 * EXPLICIT tenant scope. A tenant-A query can never observe tenant-B
 * twins — even when both tenants enroll a device with the SAME DeviceId,
 * the keys do not collide and each query returns only its own tenant's
 * twin.
 *
 * The interface is the seam (a future wave backs it with PostgreSQL);
 * the in-memory implementation is the reference store used by the
 * ingestion boundary and the tests.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { DeviceTwin } from "./twin";

/** NUL separator: cannot appear in branded id strings, so keys are unambiguous. */
const KEY_SEPARATOR = "\u0000";

function keyOf(tenantId: TenantId, deviceId: DeviceId): string {
  return `${tenantId as string}${KEY_SEPARATOR}${deviceId as string}`;
}

/**
 * The persistence seam for Device Twins. All reads are tenant-scoped;
 * there is no unscoped read path.
 */
export interface TwinStore {
  /** Upsert a twin (keyed by its own tenantId + deviceId). */
  put(twin: DeviceTwin): void;
  /** Get the twin for (tenantId, deviceId). Never crosses tenants. */
  get(tenantId: TenantId, deviceId: DeviceId): DeviceTwin | undefined;
  /** Does (tenantId, deviceId) exist? Never crosses tenants. */
  has(tenantId: TenantId, deviceId: DeviceId): boolean;
  /** All twins of ONE tenant, sorted by deviceId. Never crosses tenants. */
  list(tenantId: TenantId): readonly DeviceTwin[];
}

/**
 * The in-memory reference store. Deterministic: `list` returns twins
 * sorted by deviceId (as a string), so iteration order is stable across
 * runs and across insertion orders.
 */
export function createInMemoryTwinStore(): TwinStore {
  const twins = new Map<string, DeviceTwin>();
  return frozen({
    put(twin: DeviceTwin): void {
      if (!twin || typeof twin.tenantId !== "string" || twin.tenantId.length === 0) {
        throw new Error("TwinStore.put requires a twin with a non-empty tenantId");
      }
      if (typeof twin.deviceId !== "string" || twin.deviceId.length === 0) {
        throw new Error("TwinStore.put requires a twin with a non-empty deviceId");
      }
      twins.set(keyOf(twin.tenantId, twin.deviceId), twin);
    },
    get(tenantId: TenantId, deviceId: DeviceId): DeviceTwin | undefined {
      return twins.get(keyOf(tenantId, deviceId));
    },
    has(tenantId: TenantId, deviceId: DeviceId): boolean {
      return twins.has(keyOf(tenantId, deviceId));
    },
    list(tenantId: TenantId): readonly DeviceTwin[] {
      const prefix = `${tenantId as string}${KEY_SEPARATOR}`;
      const scoped: DeviceTwin[] = [];
      for (const [key, twin] of twins) {
        if (key.startsWith(prefix)) scoped.push(twin);
      }
      scoped.sort((a, b) => ((a.deviceId as string) < (b.deviceId as string) ? -1 : 1));
      return Object.freeze(scoped);
    },
  });
}
