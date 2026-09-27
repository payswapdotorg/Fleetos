/**
 * @fleetos/maintenance — internal helpers.
 *
 * NOT part of the public API. Mirrors the procurement/vendors/recovery
 * internal helpers: timestamp sanity, deterministic canonical JSON +
 * FNV-1a digests, immutability helpers, the lane-local tenant scope guard
 * (structurally identical to `@fleetos/identity`'s TenantContext — same
 * lane, so the maintenance package MAY import identity directly, but
 * the guard's structural-twin form is preserved for symmetry with the
 * W011/W021/W022/W031/W032/W040/W041 seams so the audit sink adapter's
 * structural typing remains the proof vehicle).
 *
 * Design rules (inherited from the Wave 0/1/2/3/4 rulings):
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
import { asTenantId, validateTenantRef } from "@fleetos/contracts";
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
// The tenant-scope guard (D5)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope for every store operation in this package:
 * `{ tenantId, correlationId? }`. Structurally identical to
 * `@fleetos/identity`'s `TenantContext`, `@fleetos/policy`'s
 * `PolicyTenantScope`, `@fleetos/recovery`'s `RecoveryTenantScope` and
 * `@fleetos/actions`' `ActionTenantScope` (same structural-twin
 * discipline). The guard validates the tenant id against the canonical
 * frozen grammar (`validateTenantRef`).
 */
export interface MaintenanceTenantScope {
  /** The tenant on whose behalf the operation executes. */
  readonly tenantId: TenantId;
  /** Correlation id of the originating request, when known. */
  readonly correlationId?: CorrelationId;
}

/**
 * The result of a pure (non-throwing) tenant-scope check. Tagged union so
 * callers can branch on the failure mode without try/catch.
 */
export type MaintenanceTenantCheck =
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
export function checkMaintenanceTenantScope(scope: unknown): MaintenanceTenantCheck {
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

/** Stable machine error codes used across the maintenance lane. */
export const ERROR_CODES = {
  workOrderInvalid: "maintenance.workorder.invalid_request",
  workOrderDomain: "maintenance.workorder.domain",
  matchInvalid: "maintenance.match.invalid_request",
  matchDomain: "maintenance.match.domain",
  aggregationInvalid: "maintenance.aggregation.invalid_request",
  aggregationDomain: "maintenance.aggregation.domain",
  workOrderStoreDomain: "maintenance.workorder.store",
} as const;

/** Traceability fields every maintenance error must carry. */
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

/** Deterministic sentinel correlation id for maintenance-pipeline internal calls. */
export const MAINTENANCE_PIPELINE_CORRELATION_ID: CorrelationId = SYNTHETIC_SYSTEM_CORRELATION_ID;

export { SYNTHETIC_SYSTEM_CORRELATION_ID, SYNTHETIC_SYSTEM_TENANT_ID };
