/**
 * @fleetos/procurement — internal helpers.
 *
 * NOT part of the public API. Mirrors the workloads/audit internal
 * helpers: timestamp sanity, deterministic canonical JSON + FNV-1a
 * digests, immutability helpers, and FleetError constructors mapped
 * onto the frozen `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1/2 rulings):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 *   - The synthetic tenant/correlation sentinels are imported from the
 *     same-lane `@fleetos/identity` (W012's canonical sentinels).
 */

import type {
  CorrelationId,
  DomainError,
  TenantId,
  ValidationError,
  ValidationFailure,
} from "@fleetos/contracts";
import { SYNTHETIC_SYSTEM_CORRELATION_ID, SYNTHETIC_SYSTEM_TENANT_ID } from "@fleetos/identity";

// ---------------------------------------------------------------------------
// Timestamp sanity
// ---------------------------------------------------------------------------

/** Minimal ISO 8601 sanity check (same laxness as frozen contracts). */
export function looksLikeIso(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

// ---------------------------------------------------------------------------
// Deterministic canonical JSON + digests
// ---------------------------------------------------------------------------

/** Deterministic (canonical) JSON serialization. */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return primitive(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => serialize(entry)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => JSON.stringify(key) + ":" + serialize(record[key])).join(",");
  return "{" + body + "}";
}

function primitive(value: unknown): string {
  if (value === undefined) return "null";
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/** FNV-1a 32-bit hash as 8 lowercase hex chars (never for security). */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the procurement lane. */
export const ERROR_CODES = {
  demandInvalid: "procurement.demand.invalid_request",
  demandDomain: "procurement.demand.domain",
  matchInvalid: "procurement.match.invalid_request",
  matchDomain: "procurement.match.domain",
  quoteInvalid: "procurement.quote.invalid_request",
  quoteDomain: "procurement.quote.domain",
  aggregationInvalid: "procurement.aggregation.invalid_request",
  aggregationDomain: "procurement.aggregation.domain",
} as const;

export interface ErrorTrace {
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
}

export function makeDomainError(
  code: string,
  message: string,
  trace: ErrorTrace,
  domain: string,
  invariant: string,
): DomainError {
  return frozen<DomainError>({
    kind: "DomainError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    domain,
    invariant,
  });
}

export function makeValidationError(
  code: string,
  message: string,
  trace: ErrorTrace,
  failures: readonly ValidationFailure[],
): ValidationError {
  return frozen<ValidationError>({
    kind: "ValidationError",
    code,
    message,
    tenantId: trace.tenantId,
    correlationId: trace.correlationId,
    failures: frozenArray(failures),
  });
}

export { SYNTHETIC_SYSTEM_CORRELATION_ID, SYNTHETIC_SYSTEM_TENANT_ID };
