/**
 * @fleetos/web-device — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the device UI surface modules: immutability
 * helpers, ISO-timestamp sanity (no clock reads — every instant is
 * injected by the caller), and the acting tenant-scope guard.
 *
 * Design rules (inherited from the Wave 0/1 rulings and the W011/W021/
 * W031/W040/W041 implementations):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy, no I/O: every view-model is a pure
 *     deterministic function of its injected inputs.
 */

import type { TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/** Deep-freeze-lite: freeze a record value (one level, typed). */
export function frozen<T>(value: T): T {
  return Object.freeze(value) as T;
}

/** Freeze a shallow copy of an array (typed readonly). */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]) as readonly T[];
}

// ---------------------------------------------------------------------------
// Injected-timestamp sanity (never a clock read)
// ---------------------------------------------------------------------------

/** Cheap ISO-8601 plausibility check (structural, not a full parse). */
export function looksLikeIso(value: string): boolean {
  return typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value);
}

/** Parse an ISO-8601 instant to epoch ms; NaN when unparseable. */
export function parseIsoMs(value: string): number {
  return Date.parse(value);
}

// ---------------------------------------------------------------------------
// The acting tenant-scope guard (the W040-disclosed pattern)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope. Every device-surface query carries it as its
 * FIRST parameter — the acting tenant rides every query (structural
 * tenant isolation, `spec/ARCHITECTURE-LOCK.md` item 17).
 */
export interface DeviceUiTenantScope {
  readonly tenantId: TenantId;
}

/** The synthetic system tenant stamped on guard-refused views (no data). */
export const SYNTHETIC_SYSTEM_TENANT = "tnt_system0000000" as TenantId;

/** The tagged guard result. */
export interface DeviceUiTenantCheck {
  readonly ok: boolean;
  readonly tenantId: TenantId;
  readonly reason?: string;
}

/**
 * Validate the acting tenant scope (non-empty string). Refused scopes
 * never reach a source: the view-models return deterministic empty
 * views stamped with the synthetic system tenant (no data, no leak —
 * the W040 `checkRecoveryTenantScope` pattern).
 */
export function checkDeviceUiTenantScope(scope: unknown): DeviceUiTenantCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, tenantId: SYNTHETIC_SYSTEM_TENANT, reason: "scope_object_required" };
  }
  const candidate = scope as { tenantId?: unknown };
  if (typeof candidate.tenantId !== "string" || candidate.tenantId.length === 0) {
    return { ok: false, tenantId: SYNTHETIC_SYSTEM_TENANT, reason: "tenant_id_required" };
  }
  return { ok: true, tenantId: candidate.tenantId as TenantId };
}

// ---------------------------------------------------------------------------
// Deterministic comparison helpers
// ---------------------------------------------------------------------------

/** Total string order (never locale-dependent — determinism contract). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
