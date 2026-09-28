/**
 * @fleetos/web-shell — internal helpers (never exported from the package).
 *
 * The Control Tower (W061 [TL]) is a pure TypeScript view-model layer:
 * no clock reads, no randomness, no I/O, no `any`, frozen outputs.
 * Everything time-dependent arrives as an injected value; every
 * ordering is machine-stable.
 */
import type { TenantId } from "@fleetos/contracts";
import { asTenantId, isValidTenantId } from "@fleetos/contracts";

/** Deep-freeze helper (the workspace-standard discipline). */
export function frozen<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") return value as Readonly<T>;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    frozen((value as Record<string, unknown>)[key]);
  }
  return value as Readonly<T>;
}

/** Deep-freeze every element of an array and the array itself. */
export function frozenArray<T>(values: readonly T[]): readonly T[] {
  for (const v of values) frozen(v);
  return Object.freeze([...values]) as readonly T[];
}

/** Total-order string comparison (machine-stable, locale-free). */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Title-case a slug ("work-orders" -> "Work Orders"). Machine-stable. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Canonical JSON serialization (sorted object keys, no whitespace). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

/** FNV-1a 32-bit digest over a string (the workspace reference form). */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * The shell tenant scope — structural twin of the identity TenantContext
 * (the same discipline as every adapter/UI lane: no cross-package import
 * in src/; the REAL context satisfies this shape structurally).
 */
export interface ShellTenantScope {
  readonly tenantId: TenantId;
}

export interface ShellTenantCheck {
  readonly ok: boolean;
  readonly reason?: "missing_scope" | "invalid_tenant";
}

/** Runtime guard for the shell tenant scope (types may be bypassed). */
export function checkShellTenantScope(scope: unknown): ShellTenantCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reason: "missing_scope" };
  }
  const candidate = scope as { tenantId?: unknown };
  if (candidate.tenantId === undefined || candidate.tenantId === null) {
    return { ok: false, reason: "missing_scope" };
  }
  const tenant = asTenantId(candidate.tenantId as string);
  if (!isValidTenantId(tenant)) {
    return { ok: false, reason: "invalid_tenant" };
  }
  return { ok: true };
}
