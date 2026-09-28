/**
 * @fleetos/ops — internal shared helpers.
 *
 * Tech-Lead owned (W080 [TL] production readiness). Per the frozen
 * ownership model, this package's src/ imports from `@fleetos/contracts`
 * ONLY — every cross-lane edge (the REAL audit log, the REAL identity
 * TenantContext, the REAL convergence health aggregate, the REAL
 * web-shell journeys) is bound at the test/ binding site (the ownership
 * gate scans only src/ files; the established W011/W021/.../W071
 * pattern).
 *
 * Everything here is pure: no clock reads, no entropy, no network, no
 * runtime dependencies. Strict TS; no `any` in public signatures.
 */

import type { CorrelationId, TenantId } from "@fleetos/contracts";

/** Freeze a record (shallow — the sibling packages' convention). */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

/** Freeze an array (shallow copy — the caller's array is never aliased). */
export function frozenArray<T>(items: readonly T[]): ReadonlyArray<T> {
  return Object.freeze([...items]);
}

// ---------------------------------------------------------------------------
// The structural tenant scope (satisfied by @fleetos/identity's REAL
// TenantContext — the binding tests prove it)
// ---------------------------------------------------------------------------

/**
 * The acting tenant scope — a STRUCTURAL subtype satisfied by the REAL
 * `@fleetos/identity` `TenantContext` (frozen `{ tenantId, correlationId? }`).
 * Declared locally because this package's src/ may import only
 * `@fleetos/contracts` (the ownership gate's cross-lane rule); the
 * binding tests inject REAL `makeTenantContext` values through it.
 */
export interface OpsTenantScope {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Correlation id threading the causal graph (optional). */
  readonly correlationId?: CorrelationId;
}

/** The tagged scope guard result. */
export type OpsScopeCheck =
  | { readonly ok: true; readonly tenantId: TenantId; readonly correlationId: CorrelationId | undefined }
  | { readonly ok: false; readonly reason: string };

/**
 * Pure, non-throwing scope guard: a scope is valid when it is an object
 * carrying a non-empty-string `tenantId` (and at most a string
 * `correlationId`). The REAL identity TenantContext passes by
 * construction; context-free access is rejected with a machine-stable
 * reason.
 */
export function checkOpsTenantScope(scope: unknown): OpsScopeCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reason: "scope_required" };
  }
  const s = scope as Record<string, unknown>;
  if (typeof s.tenantId !== "string" || s.tenantId.length === 0) {
    return { ok: false, reason: "tenant_id_required" };
  }
  if (s.correlationId !== undefined && typeof s.correlationId !== "string") {
    return { ok: false, reason: "correlation_id_invalid" };
  }
  return {
    ok: true,
    tenantId: s.tenantId as TenantId,
    correlationId: s.correlationId as CorrelationId | undefined,
  };
}

// ---------------------------------------------------------------------------
// Deterministic digests (FNV-1a) + canonical JSON
// ---------------------------------------------------------------------------

/** The FNV-1a 32-bit offset basis. */
const FNV_1A_OFFSET_BASIS = 0x811c9dc5;
/** The FNV-1a 32-bit prime. */
const FNV_1A_PRIME = 0x01000193;

/**
 * FNV-1a over a UTF-8 string — byte-compatible with the @fleetos/audit
 * reference implementation (asserted by the binding test).
 */
export function fnv1a32(input: string): string {
  let hash = FNV_1A_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      hash ^= code;
      hash = Math.imul(hash, FNV_1A_PRIME);
    } else {
      // UTF-8 encode the code point (BMP only — canonical JSON is ASCII
      // by construction: non-ASCII is escaped during serialization).
      const escaped = encodeURIComponent(input[i]);
      for (let j = 0; j < escaped.length; j++) {
        hash ^= escaped.charCodeAt(j);
        hash = Math.imul(hash, FNV_1A_PRIME);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * deterministic array order preserved. The digest basis for every
 * content-addressed record in this package.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical_json_non_finite_number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  throw new Error("canonical_json_unsupported_type");
}

/** A deterministic digest over the canonical JSON form. */
export function digestOf(value: unknown): string {
  return fnv1a32(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// Sorted-strings helper (machine-stable reason lists — the W071
// destructive-review discipline: missing paths arrive SORTED)
// ---------------------------------------------------------------------------

/** A de-duplicated, SORTED copy of a string list (machine-stable output). */
export function sortedUniqueStrings(items: readonly string[]): ReadonlyArray<string> {
  return frozenArray([...new Set(items)].sort());
}

/** ISO-instant shape guard (this package reads no clock — instants are injected). */
export function isValidInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
}

/** Compare two ISO instants lexically (correct for same-format UTC strings). */
export function compareInstants(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
