/**
 * @fleetos/integration-adcos — internal helpers.
 *
 * NOT part of the public API (not re-exported from `src/index.ts`).
 * Shared machinery for the ADCOS adapter modules: timestamp sanity,
 * deterministic canonical JSON, content digests, immutability helpers,
 * the tenant-scope guard, and FleetError constructors mapped onto the
 * frozen `@fleetos/contracts` error taxonomy.
 *
 * Design rules (inherited from the Wave 0/1 rulings and the W011/W021/
 * W031/W040 implementations — this file mirrors the recovery lane's
 * internal seam, the established lane-A pattern):
 *   - No runtime dependencies. No `any` in signatures. Strict TS.
 *   - No clock reads, no entropy: every timestamp is injected by the
 *     caller; every digest is a pure function of its input.
 */

import { asCorrelationId, asTenantId, validateTenantRef } from "@fleetos/contracts";
import type {
  CorrelationId,
  DomainError,
  TenantId,
  ValidationError,
  ValidationFailure,
} from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Timestamp sanity + parsing
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
 * deterministic record ids and content digests in this package (mirrors
 * the device-model/health/policy/recovery canonical JSON seams; never
 * used for security).
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
 * content digests in deterministic ids (never for security).
 */
export function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic content digest over canonical JSON (8 lowercase hex chars). */
export function contentDigest(value: unknown): string {
  return fnv1a32Hex(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// Immutability helpers
// ---------------------------------------------------------------------------

/**
 * Freeze a record at construction time. The ADCOS adapter never mutates a
 * returned structure in place: submissions and connectivity records are
 * versioned — a new version is a NEW record, and the old one is never
 * rewritten (`spec/ARCHITECTURE.md` § Canonical model). Freezing is
 * defense in depth.
 */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/**
 * Copy an array into a frozen readonly array (caller-supplied arrays are
 * never aliased into adapter state).
 */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

/**
 * Recursively freeze a plain-object/array structure (caller-supplied
 * trees; freezing them at construction is defense in depth for the
 * versioned-interpretation discipline). Primitives and non-plain objects
 * pass through unchanged. Pure; never throws.
 */
export function deepFrozen<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) deepFrozen(entry);
    return Object.freeze(value);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFrozen(record[key]);
  }
  return Object.freeze(value);
}

/** Deterministic sort of a string list: lexicographic, deduplicated. */
export function sortedUnique(values: readonly string[]): readonly string[] {
  return frozenArray([...new Set(values)].sort());
}

/**
 * Strip `undefined`-valued keys recursively (a new frozen structure —
 * the input is never mutated). Plain data crossing the provider boundary
 * carries no undefined-valued keys: an absent facet is an ABSENT KEY,
 * never a key holding `undefined`. Pure; never throws.
 */
export function compact<T extends object>(value: T): Readonly<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined) continue;
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      out[key] = compact(entry as object);
    } else if (Array.isArray(entry)) {
      out[key] = entry.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? compact(item as object)
          : item,
      );
    } else {
      out[key] = entry;
    }
  }
  return frozen(out) as Readonly<T>;
}

// ---------------------------------------------------------------------------
// The tenant-scope guard (D4)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope for every store operation in this package:
 * `{ tenantId, correlationId? }`. Structurally identical to
 * `@fleetos/identity`'s `TenantContext`, `@fleetos/policy`'s
 * `PolicyTenantScope` and `@fleetos/recovery`'s `RecoveryTenantScope`
 * (same structural-twin discipline — declared LOCALLY because the
 * ownership gate forbids importing `@fleetos/identity`, worker-c's lane,
 * from this lane-A package). The guard validates the tenant id against
 * the canonical frozen grammar (`validateTenantRef`).
 */
export interface AdcosTenantScope {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) tenant-scope check. Tagged union so
 * callers can branch on the failure mode without try/catch.
 */
export type AdcosTenantCheck =
  | { readonly ok: true; readonly tenantId: TenantId }
  | {
      readonly ok: false;
      readonly reason: "missing_scope" | "invalid_tenant_id";
      readonly detail: string;
    };

/**
 * Pure, non-throwing tenant-scope check. Accepts `unknown` so callers can
 * validate at runtime boundaries even when the type system is bypassed
 * (`undefined as never` — proven by test). A scope without a tenant id or
 * with a tenant id that fails the canonical frozen grammar is rejected:
 * context-free access to tenant-partitioned state is forbidden by
 * construction (`spec/ARCHITECTURE-LOCK.md` item 17).
 *
 * @param scope the candidate scope
 * @returns the tagged check result
 */
export function checkAdcosTenantScope(scope: unknown): AdcosTenantCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reason: "missing_scope", detail: "tenant scope is absent" };
  }
  const candidate = scope as { tenantId?: unknown };
  if (typeof candidate.tenantId !== "string" || candidate.tenantId.length === 0) {
    return { ok: false, reason: "missing_scope", detail: "tenant scope carries no tenantId" };
  }
  const ref = validateTenantRef(asTenantId(candidate.tenantId));
  if (!ref.ok) {
    return { ok: false, reason: "invalid_tenant_id", detail: `tenantId ${ref.reason}` };
  }
  return { ok: true, tenantId: ref.tenantId };
}

// ---------------------------------------------------------------------------
// FleetError constructors (taxonomy mapping)
// ---------------------------------------------------------------------------

/** Stable machine error codes used across the ADCOS adapter. */
export const ERROR_CODES = {
  translationRefused: "adcos.translation.refused",
  reportInvalid: "adcos.report.invalid",
  submissionInvalid: "adcos.submission.invalid_request",
  submissionNotFound: "adcos.submission.not_found",
  submissionIllegalTransition: "adcos.submission.illegal_transition",
  adoptionInvalid: "adcos.adoption.invalid_request",
  adoptionNotFound: "adcos.adoption.not_found",
  storeDomain: "adcos.store",
} as const;

/** Traceability fields every ADCOS error must carry. */
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

/** Synthetic correlation id stamped on errors when no request context exists. */
export const ADCOS_PIPELINE_CORRELATION_ID: CorrelationId = asCorrelationId("cor_adcos_pipeline");

/** Synthetic tenant stamped on errors that predate tenant attribution. */
export const SYNTHETIC_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");
