/**
 * @fleetos/web-workloads — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the workload-planning surface modules:
 * immutability helpers, ISO sanity, deterministic rendering, and
 * FleetError constructors mapped onto the frozen `@fleetos/contracts`
 * error taxonomy (the surface NEVER invents its own error shape).
 *
 * Surface discipline (every module in this package):
 *   - No runtime dependencies; `@fleetos/contracts` only.
 *   - No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy, no I/O: every timestamp is injected by
 *     the caller; every derived value is a pure function of the input.
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

/** Freeze an array as a readonly tuple-like list. */
export function frozenArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

// ---------------------------------------------------------------------------
// Timestamp sanity (same laxness as the domain packages' validators)
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

// ---------------------------------------------------------------------------
// Deterministic rendering (machine-stable display strings)
// ---------------------------------------------------------------------------

/**
 * Render a finite number for display: `-0` normalizes to `0`; non-finite
 * values render as `"NaN"`/`"Infinity"` verbatim (never thrown, never
 * locale-formatted — the output is a pure function of the input bits).
 */
export function renderNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  const normalized = value === 0 ? 0 : value;
  return String(normalized);
}

/**
 * Deterministic string comparison (code-unit order — stable across
 * locales and runs). Returns -1 / 0 / 1.
 */
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
 * unknown subject, illegal state transition). Machine-stable `domain`
 * and `invariant` values; never thrown.
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
 * `tenant_mismatch`) or `null` when the scope matches. A record with NO
 * tenant field (e.g. a candidate capability) is always in scope — the
 * guard is applied only where a tenant scope EXISTS.
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
