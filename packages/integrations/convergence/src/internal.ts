/**
 * @fleetos/integration-convergence — internal shared helpers.
 *
 * Tech-Lead owned (W051 [TL] integration convergence). Per the frozen
 * ownership model, this package's src/ imports from `@fleetos/contracts`
 * ONLY — every cross-lane edge (the REAL adapters, the REAL W031
 * Guardian engine, the REAL identity/audit packages) is bound at the
 * test/ binding site (the ownership gate scans only src/ files; the
 * established W011/W021/W022/W031/W032/W040/W041/W042/W050A/W050B/W050C
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
 * Declared locally (not imported) because this package's src/ may import
 * only `@fleetos/contracts` (the ownership gate's cross-lane rule); the
 * D1 binding tests inject REAL `makeTenantContext` values through it.
 */
export interface ConvergenceTenantScope {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** Correlation id threading the causal graph (optional). */
  readonly correlationId?: CorrelationId;
}

/** The tagged scope guard result. */
export type ConvergenceScopeCheck =
  | { readonly ok: true; readonly tenantId: TenantId; readonly correlationId: CorrelationId | undefined }
  | { readonly ok: false; readonly reason: string };

/**
 * Pure, non-throwing scope guard: a scope is valid when it is an object
 * carrying a non-empty-string `tenantId` (and at most a string
 * `correlationId`). The REAL identity TenantContext passes by
 * construction; context-free access is rejected with a machine-stable
 * reason.
 */
export function checkConvergenceTenantScope(scope: unknown): ConvergenceScopeCheck {
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
  return { ok: true, tenantId: s.tenantId as TenantId, correlationId: s.correlationId as CorrelationId | undefined };
}

// ---------------------------------------------------------------------------
// Deterministic digests (FNV-1a) + canonical JSON
// ---------------------------------------------------------------------------

/** The FNV-1a 32-bit offset basis. */
const FNV_1A_OFFSET_BASIS = 0x811c9dc5;
/** The FNV-1a 32-bit prime. */
const FNV_1A_PRIME = 0x01000193;

/**
 * Deterministic FNV-1a over a UTF-8 string, hex-encoded (8 lowercase
 * hex chars). The SAME algorithm/encoding as `@fleetos/audit`'s
 * reference hash (Math.imul 32-bit arithmetic — byte-identical on the
 * same input; the D4 binding test asserts the equality).
 */
export function fnv1a32Hex(value: string): string {
  let hash = FNV_1A_OFFSET_BASIS;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_1A_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Non-finite numbers and non-JSON values refuse canonicalization. */
class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

/**
 * Deterministic canonical JSON: object keys sorted lexicographically,
 * arrays in order, `null`/booleans/numbers/strings verbatim, and NO
 * whitespace. `undefined`, functions, symbols, bigints and non-finite
 * numbers are refused (throwing) — a digest input that JSON cannot
 * carry deterministically must never silently degrade.
 */
export function canonicalJson(value: unknown): string {
  const out = serialize(value);
  return out;
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError("non-finite number");
      }
      return String(value);
    }
    case "string":
      return serializeString(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => serialize(v)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const v = record[key];
        if (v === undefined) continue; // JSON.stringify drops undefined members
        parts.push(`${serializeString(key)}:${serialize(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(`unserializable type (${typeof value})`);
  }
}

function serializeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    switch (code) {
      case 0x22: out += '\\"'; break; // "
      case 0x5c: out += "\\\\"; break; // backslash
      case 0x08: out += "\\b"; break;
      case 0x0c: out += "\\f"; break;
      case 0x0a: out += "\\n"; break;
      case 0x0d: out += "\\r"; break;
      case 0x09: out += "\\t"; break;
      default:
        if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          out += value[i];
        }
    }
  }
  return `${out}"`;
}
