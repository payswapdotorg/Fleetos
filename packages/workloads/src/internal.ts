/**
 * @fleetos/workloads — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the workloads modules: timestamp sanity,
 * deterministic canonical JSON, content digests, immutability helpers,
 * and FleetError constructors mapped onto the frozen
 * `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1/2 rulings):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 *   - The synthetic tenant/correlation sentinels are imported from the
 *     same-lane `@fleetos/identity` (W012's canonical sentinels — one
 *     definition per lane, not one per package).
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

/**
 * Minimal ISO 8601 sanity check — deliberately the SAME laxness as the
 * frozen contracts validators (`validateEnvelope`,
 * `validateObservationBatch`): the string must contain a `T` followed by
 * two digits, a colon, and two more digits. Anything stricter would reject
 * valid ISO 8601 variants the frozen contracts accept.
 */
export function looksLikeIso(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

/**
 * Parse an ISO 8601 timestamp to epoch milliseconds. Deterministic for a
 * given string (delegates to `Date.parse`, a pure function of the input).
 * Returns `NaN` for unparseable input — callers decide how to react.
 */
export function parseIsoMs(value: string): number {
  return Date.parse(value);
}

// ---------------------------------------------------------------------------
// Deterministic canonical JSON + digests
// ---------------------------------------------------------------------------

/**
 * Deterministic (canonical) JSON serialization: object keys sorted
 * recursively, arrays preserved in order. Two JSON-serializable values
 * that are structurally equal produce the same string — the basis for
 * deterministic content hashes in this package (mirrors the audit and
 * device-model canonical JSON seams; never used for security).
 */
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
  if (value === undefined) return "null"; // JSON.stringify(array) semantics
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/**
 * FNV-1a 32-bit hash as 8 lowercase hex chars. Deterministic,
 * dependency-free — the same algorithm the frozen contracts testing
 * subpath documents for string-seeded PRNGs. Used for stable, short
 * content digests in deterministic record ids and revision content
 * hashes (never for security).
 */
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

/**
 * Freeze a record at construction time. The workloads package never
 * mutates a returned structure in place: profiles are versioned records —
 * a new revision is a NEW record, and the old one is never rewritten
 * (`spec/ARCHITECTURE.md` § Canonical model; `spec/ARCHITECTURE-LOCK.md`
 * item 3). Freezing is defense in depth.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into workloads state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the workloads lane. */
export const ERROR_CODES = {
  profileInvalid: "workloads.profile.invalid_request",
  profileDomain: "workloads.profile.domain",
  vectorInvalid: "workloads.vector.invalid_request",
  factorsInvalid: "workloads.factors.invalid_request",
  recommendationInvalid: "workloads.recommendation.invalid_request",
  recommendationTenantMismatch: "workloads.recommendation.tenant_mismatch",
} as const;

/** Traceability fields every workloads error must carry. */
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
