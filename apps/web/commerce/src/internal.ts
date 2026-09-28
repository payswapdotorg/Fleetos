/**
 * @fleetos/web-commerce — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the commerce surface modules: immutability
 * helpers, ISO sanity, deadline arithmetic, deterministic rendering, and
 * FleetError constructors mapped onto the frozen `@fleetos/contracts`
 * error taxonomy (the surface NEVER invents its own error shape).
 *
 * Surface discipline (every module in this package):
 *   - No runtime dependencies; `@fleetos/contracts` only.
 *   - No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy, no I/O: every timestamp (including the
 *     display "now") is injected by the caller; every derived value is a
 *     pure function of the input.
 *   - Every public builder returns a TAGGED result — `{ ok: true, view }`
 *     or `{ ok: false, error: FleetError }` — and never throws.
 *   - Tenant scoping is enforced at the surface boundary: the acting
 *     `TenantId` is the FIRST parameter, and any input record whose
 *     tenant scope differs is refused with the machine-stable
 *     `tenant_mismatch` invariant (ARCHITECTURE-LOCK item 17).
 */

import type { CorrelationId, DomainError, TenantId, ValidationError } from "@fleetos/contracts";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

/** Deep-freeze helper for view models (frozen at construction). */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Freeze an array as a readonly list. */
export function frozenArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

// ---------------------------------------------------------------------------
// Timestamp sanity + deadline arithmetic (injected instants only)
// ---------------------------------------------------------------------------

/** Minimal ISO 8601 sanity check (contains `T` + `HH:MM`). */
export function looksLikeIso(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

/**
 * Parse an ISO 8601 timestamp to epoch milliseconds. Deterministic for a
 * given string; returns `NaN` for unparseable input — callers fail closed.
 */
export function parseIsoMs(value: string): number {
  return Date.parse(value);
}

/** One day, in milliseconds (the deadline-pressure unit). */
export const MS_PER_DAY = 24 * 3_600_000;

/**
 * Whole days from an injected `now` to a deadline (floor). Returns null
 * when either instant is unparseable — callers fail closed (never guess).
 */
export function daysUntil(nowMs: number, deadline: string): number | null {
  const deadlineMs = parseIsoMs(deadline);
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs)) return null;
  return Math.floor((deadlineMs - nowMs) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Deterministic rendering (machine-stable display strings)
// ---------------------------------------------------------------------------

/** Deterministic string comparison (code-unit order). Returns -1 / 0 / 1. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FleetError constructors (the frozen contracts taxonomy)
// ---------------------------------------------------------------------------

/** The surface's synthetic system tenant (error projection only). */
export const SURFACE_SYSTEM_TENANT_ID: TenantId = asTenantId("tnt_surface_system");

/** The surface's synthetic pipeline correlation id (error projection only). */
export const SURFACE_PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId(
  "corr_surface_pipeline",
);

/**
 * Construct a DomainError for a refused surface build (tenant mismatch,
 * unknown subject, malformed input). Machine-stable `domain` and
 * `invariant` values; never thrown.
 */
export function makeSurfaceDomainError(
  domain: string,
  invariant: string,
  message: string,
  tenantId: TenantId,
): DomainError {
  return frozen({
    kind: "DomainError",
    code: `${domain}.${invariant}`,
    message,
    tenantId,
    correlationId: SURFACE_PIPELINE_CORRELATION_ID,
    domain,
    invariant,
  });
}

/**
 * Construct a ValidationError for a malformed surface input. Carries the
 * machine-stable path/reason failure list (the contracts shape).
 */
export function makeSurfaceValidationError(
  domain: string,
  message: string,
  tenantId: TenantId,
  failures: readonly { path: string; reason: string }[],
): ValidationError {
  return frozen({
    kind: "ValidationError",
    code: `${domain}.invalid`,
    message,
    tenantId,
    correlationId: SURFACE_PIPELINE_CORRELATION_ID,
    failures: frozenArray(failures),
  });
}

// ---------------------------------------------------------------------------
// The tenant guard (surface boundary, ARCHITECTURE-LOCK item 17)
// ---------------------------------------------------------------------------

/**
 * Refuse an input record whose tenant scope differs from the acting
 * tenant. Returns the machine-stable DomainError (invariant
 * `tenant_mismatch`) or `null` when the scope matches or the record
 * carries no tenant scope.
 */
export function tenantMismatch(
  acting: TenantId,
  recordTenant: TenantId | undefined,
  domain: string,
): DomainError | null {
  if (recordTenant !== undefined && recordTenant !== acting) {
    return makeSurfaceDomainError(
      domain,
      "tenant_mismatch",
      "input record tenant scope does not match the acting tenant",
      acting,
    );
  }
  return null;
}
