/**
 * @fleetos/web-learning — internal helpers (never exported from src/).
 *
 * The W060B surface-lane pattern: small pure utilities shared by the
 * view builders — validation predicates, freeze helpers, the tagged
 * error constructor, and the machine-stable string comparison. No
 * clock, no entropy, no I/O. No `any`.
 */

import { asTenantId } from "@fleetos/contracts";
import type { TenantId } from "@fleetos/contracts";

/** The synthetic system tenant used when the acting scope itself is invalid. */
export const SYNTHETIC_SURFACE_TENANT: TenantId = asTenantId("tnt_system");

/** The machine-stable error codes of the learning surface builders. */
export const SURFACE_ERROR_CODES = Object.freeze({
  scopeInvalid: "learning_surface.scope_invalid",
  observationInvalid: "learning_surface.observation_invalid",
  proposalInvalid: "learning_surface.proposal_invalid",
  adoptionInvalid: "learning_surface.adoption_invalid",
  tenantMismatch: "learning_surface.tenant_mismatch",
} as const);

/** One machine-stable validation failure (a {path, reason} pair). */
export interface SurfaceValidationFailure {
  readonly path: string;
  readonly reason: string;
}

/** The tagged error every builder refuses with (never a throw). */
export interface SurfaceError {
  readonly code: string;
  readonly message: string;
  readonly tenantId: TenantId;
  readonly failures: readonly SurfaceValidationFailure[];
}

/** The tagged result of every builder: the view or the error. */
export type SurfaceResult<T> =
  | { readonly ok: true; readonly view: T }
  | { readonly ok: false; readonly error: SurfaceError };

/** Build a tagged surface error (frozen). */
export function makeSurfaceError(
  code: string,
  message: string,
  tenantId: TenantId,
  failures: readonly SurfaceValidationFailure[],
): SurfaceError {
  return Object.freeze({
    code,
    message,
    tenantId,
    failures: Object.freeze([...failures]),
  });
}

// ---------------------------------------------------------------------------
// Validation predicates (pure)
// ---------------------------------------------------------------------------

/** Is the value a non-empty string? */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Is the value a plain object (not an array, not null)? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is the value a positive integer (>= 1)? */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Does the value look like an ISO 8601 instant (injected upstream)? */
export function looksLikeIso(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

/** Is the value an array of non-empty strings? */
export function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

// ---------------------------------------------------------------------------
// Freeze helpers + machine-stable ordering
// ---------------------------------------------------------------------------

/** Freeze one level. */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Freeze an array (shallow — the elements are already frozen or plain). */
export function frozenArray<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

/** Recursively freeze a plain view object (defensive depth bound). */
export function deepFrozen<T>(value: T, depth = 0): T {
  if (depth > 8 || typeof value !== "object" || value === null) return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFrozen((value as Record<string, unknown>)[key], depth + 1);
  }
  return Object.freeze(value);
}

/** The machine-stable string comparison (code-point order). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
