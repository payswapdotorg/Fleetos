/**
 * @fleetos/web-security — internal pure helpers.
 *
 * Local, self-contained utilities mirroring the domain packages' helper
 * conventions (frozen outputs, ISO-8601 shape checks, canonical JSON
 * with sorted keys, FNV-1a digests, tagged validation errors). Imported
 * only from within this surface lane; never exported past `src/index.ts`
 * except the error/result types the surface contract needs.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { asCorrelationId, asTenantId } from "../../../../packages/contracts/src/index";
import type { CorrelationId, TenantId } from "../../../../packages/contracts/src/index";

// ---------------------------------------------------------------------------
// Freezing
// ---------------------------------------------------------------------------

/** Freeze an object shallowly (readonly at runtime). */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Freeze an array shallowly into a readonly tuple. */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

/**
 * Deeply freeze a view-model: every plain object and array reachable
 * from the value is frozen (deterministic, no cycles expected in
 * view-models — the surface never builds cyclic structures).
 */
export function deepFrozen<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFrozen(entry);
    Object.freeze(value);
    return value;
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFrozen((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

/** Lexicographic string comparison (machine-stable total order). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Is the value an ISO-8601-shaped string (date-time, Z or offset)? */
export function looksLikeIso(value: string): boolean {
  return typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

/**
 * Canonical JSON: object keys sorted recursively, arrays in order,
 * stable string escaping. Two structurally equal values produce the
 * same string regardless of key insertion order (input-order
 * invariance).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value === null ? "null" : String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serialize(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort(compareStrings);
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key])}`)
      .join(",");
    return `{${body}}`;
  }
  // Functions/symbols/undefined never appear in surface view-models.
  return "null";
}

/** FNV-1a 32-bit digest of a string, lowercase hex (machine-stable). */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Tagged surface errors (structurally the frozen contracts ValidationError)
// ---------------------------------------------------------------------------

/** One machine-stable validation failure. */
export interface SurfaceValidationFailure {
  /** The JSON-pointer path to the invalid field. */
  readonly path: string;
  /** The machine-stable reason. */
  readonly reason: string;
}

/**
 * A surface validation error. Structurally identical to the frozen
 * contracts `ValidationError` shape (kind/code/message/tenantId/
 * correlationId/failures) so callers can treat it uniformly.
 */
export interface SurfaceError {
  readonly kind: "ValidationError";
  readonly code: string;
  readonly message: string;
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
  readonly failures: readonly SurfaceValidationFailure[];
}

/**
 * The tagged result of a surface builder: either a deeply frozen view
 * or a machine-stable surface error (never a throw — the surface is
 * pure and total).
 */
export type SurfaceResult<T> =
  | { readonly ok: true; readonly view: T }
  | { readonly ok: false; readonly error: SurfaceError };

/** The synthetic system tenant (stamped on malformed-scope errors). */
export const SYNTHETIC_SURFACE_TENANT: TenantId = asTenantId("tnt_system");

/** The surface lane's synthetic correlation id (stamped on malformed-scope errors). */
export const SURFACE_CORRELATION_ID: CorrelationId = asCorrelationId("cor_web_security_surface");

/** Machine-stable surface error codes. */
export const SURFACE_ERROR_CODES = frozen({
  scopeInvalid: "surface.scope_invalid",
  tenantMismatch: "surface.tenant_mismatch",
  findingInvalid: "surface.finding_invalid",
  decisionInvalid: "surface.decision_invalid",
  evaluationInvalid: "surface.evaluation_invalid",
  approvalItemInvalid: "surface.approval_item_invalid",
});

/**
 * Build a frozen tagged validation error.
 *
 * @param code the machine-stable error code
 * @param message the human message (never matched on)
 * @param tenantId the tenant scope stamped on the error
 * @param failures the machine-stable failure list
 */
export function makeSurfaceError(
  code: string,
  message: string,
  tenantId: TenantId,
  failures: readonly SurfaceValidationFailure[],
): SurfaceError {
  return frozen({
    kind: "ValidationError",
    code,
    message,
    tenantId,
    correlationId: SURFACE_CORRELATION_ID,
    failures: frozenArray(failures),
  });
}

/** Is the value a plain object (not an array, not null)? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is the value a non-empty string? */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Is the value a positive integer (>= 1)? */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
