/**
 * @fleetos/device-adapters — W030: Payload validation primitives.
 *
 * The small pure vocabulary the W030 family payload contracts (MDM
 * command payloads, mobile observation payloads, SNMP/vendor printer
 * payloads) share. Parse-don't-validate: every family payload validator
 * takes an `unknown` (the opaque adapter/seam payload) and returns a
 * tagged `PayloadParseResult<T>` that NARROWS to the typed payload —
 * there is no `any` and no casting at call sites.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen } from "./internal";
import { looksLikeIso } from "./internal";

// ---------------------------------------------------------------------------
// The parse result
// ---------------------------------------------------------------------------

/**
 * The result of parsing an opaque payload against a family payload
 * contract: either the narrowed typed payload or a machine-stable
 * failure with an optional field path.
 */
export type PayloadParseResult<T> =
  | { readonly ok: true; readonly payload: T }
  | { readonly ok: false; readonly reason: string; readonly field?: string };

/** Build a successful parse result (frozen; object payloads frozen in depth of one). */
export function parseOk<T>(payload: T): PayloadParseResult<T> {
  const narrowed =
    typeof payload === "object" && payload !== null ? (Object.freeze(payload) as T) : payload;
  return frozen({ ok: true as const, payload: narrowed });
}

/** Build a failed parse result (frozen). */
export function parseFail(reason: string, field?: string): PayloadParseResult<never> {
  return frozen({ ok: false as const, reason, ...(field !== undefined ? { field } : {}) });
}

// ---------------------------------------------------------------------------
// Primitive guards (unknown -> narrowed)
// ---------------------------------------------------------------------------

/** Pure predicate: is the value a non-empty string? */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Pure predicate: is the value a plain JSON object (not null/array)? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure predicate: is the value an integer in the inclusive range
 * [minimum, maximum]?
 */
export function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

/**
 * Validate that a field is a non-empty string, returning the narrowed
 * value or a failed parse result carrying the field path.
 */
export function requireNonEmptyString(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<string> {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    return parseFail("expected a non-empty string", `/${field}`);
  }
  return parseOk(value);
}

/**
 * Validate that a field is a plain object, returning the narrowed record
 * or a failed parse result carrying the field path.
 */
export function requirePlainObject(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<Record<string, unknown>> {
  const value = record[field];
  if (!isPlainObject(value)) {
    return parseFail("expected an object", `/${field}`);
  }
  return parseOk(value);
}

/**
 * Validate that a field is a boolean, returning the narrowed value or a
 * failed parse result carrying the field path.
 */
export function requireBoolean(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<boolean> {
  const value = record[field];
  if (typeof value !== "boolean") {
    return parseFail("expected a boolean", `/${field}`);
  }
  return parseOk(value);
}

/**
 * Validate that a field is a string in the given enumeration (an array
 * of allowed literal values), returning the narrowed value or a failed
 * parse result carrying the field path.
 */
export function requireStringEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): PayloadParseResult<T> {
  const value = record[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return parseFail(`expected one of [${allowed.join(", ")}]`, `/${field}`);
  }
  return parseOk(value as T);
}

/**
 * CLOSED-WORLD payload discipline: return the first field present on
 * the record that is NOT in the allowed list (undefined when the record
 * carries only known fields). Family payload contracts are closed — an
 * unknown field fails the parse (no silent field dropping, no payload
 * smuggling across kinds). Pure.
 */
export function unknownFieldIn(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return key;
  }
  return undefined;
}

/**
 * Validate that a field is a string array whose entries are non-empty
 * strings, returning the frozen narrowed array or a failed parse result
 * carrying the field path.
 */
export function requireNonEmptyStringArray(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<readonly string[]> {
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    return parseFail("expected an array of non-empty strings", `/${field}`);
  }
  return parseOk(value);
}

/**
 * Validate that an optional field, when present, is an integer in the
 * inclusive range [minimum, maximum]. Returns `undefined` when absent.
 */
export function optionalIntegerInRange(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): PayloadParseResult<number | undefined> {
  if (record[field] === undefined) return parseOk(undefined);
  if (!isIntegerInRange(record[field], minimum, maximum)) {
    return parseFail(`expected an integer in [${minimum}, ${maximum}]`, `/${field}`);
  }
  return parseOk(record[field]);
}

/**
 * Validate that an optional field, when present, is a non-empty string.
 * Returns `undefined` when absent.
 */
export function optionalNonEmptyString(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<string | undefined> {
  if (record[field] === undefined) return parseOk(undefined);
  return requireNonEmptyString(record, field);
}

/**
 * Validate that a field is an ISO 8601 timestamp (the lane's laxness —
 * `looksLikeIso`, matching the frozen contracts validators).
 */
export function requireIsoTimestamp(
  record: Record<string, unknown>,
  field: string,
): PayloadParseResult<string> {
  const value = record[field];
  if (typeof value !== "string" || !looksLikeIso(value)) {
    return parseFail("expected an ISO 8601 timestamp", `/${field}`);
  }
  return parseOk(value);
}
