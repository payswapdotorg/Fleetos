/**
 * @fleetos/integration-aurum — internal helpers.
 *
 * NOT part of the public API. Mirrors the maintenance/procurement/recovery
 * internal helpers: timestamp sanity, deterministic canonical JSON +
 * FNV-1a digests, immutability helpers, and FleetError constructors
 * mapped onto the frozen taxonomy.
 *
 * The synthetic tenant/correlation sentinels are imported from the
 * same-lane `@fleetos/identity` (W012's canonical sentinels — the W042
 * pattern). The ONLY @fleetos/* packages imported from this package's
 * src/ are `@fleetos/contracts` (the shared seam, always permitted) and
 * `@fleetos/identity` (same worker-c lane); every domain surface is
 * consumed through STRUCTURAL seams declared in this package (the W040
 * disclosed pattern) with the real packages injected at the binding
 * site and proven by test.
 *
 * Design rules (inherited from the Wave 0-4 rulings):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy, no network I/O: every timestamp is
 *     injected by the caller; every digest is a pure function of its
 *     input; all transport is an injected seam.
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

/** Parse an ISO 8601 timestamp to epoch millis (NaN when unparseable). */
export function parseIsoMs(value: string): number {
  return Date.parse(value);
}

// ---------------------------------------------------------------------------
// Deterministic canonical JSON + digests
// ---------------------------------------------------------------------------

/** Deterministic (canonical) JSON serialization with recursively sorted keys. */
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

/** Deterministic sort of strings (code-unit order — locale-independent). */
export function sortedStrings(values: readonly string[]): readonly string[] {
  return frozenArray([...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Deduplicate + sort strings (deterministic canonical set rendering). */
export function dedupeSortedStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      seen.add(value);
    }
  }
  return sortedStrings([...seen]);
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the aurum adapter. */
export const ERROR_CODES = {
  intentInvalid: "aurum.intent.invalid_request",
  intentDomain: "aurum.intent.domain",
  outboxDomain: "aurum.outbox.domain",
  emissionDomain: "aurum.emission.domain",
  deliveryInvalid: "aurum.delivery.invalid_request",
  deliveryDomain: "aurum.delivery.domain",
} as const;

/** Traceability fields every aurum error must carry. */
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

/** Deterministic sentinel correlation id for aurum-pipeline internal calls. */
export const AURUM_PIPELINE_CORRELATION_ID: CorrelationId = SYNTHETIC_SYSTEM_CORRELATION_ID;

export { SYNTHETIC_SYSTEM_CORRELATION_ID, SYNTHETIC_SYSTEM_TENANT_ID };
