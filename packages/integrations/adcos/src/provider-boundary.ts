/**
 * @fleetos/integration-adcos — D2: the provider-neutral boundary.
 *
 * ARCHITECTURE-LOCK items 7-8 invariant: "ADCOS owns network-native
 * topology/path execution; FleetOS owns fleet connectivity intent and
 * device/workload policy" and "provider topology, native credentials and
 * provider SDK objects never enter FleetOS core packages"
 * (`spec/integration/ADCOS.md` Invariant).
 *
 * This module declares the boundary types and the runtime assertions
 * that ENFORCE it:
 *
 *   - `AdcosProviderHandle` — an OPAQUE branded string; the ONLY
 *     provider-originated value type allowed in the public surface. A
 *     handle references provider-side execution state without exposing
 *     any of it (no topology, no credentials, no SDK objects — the brand
 *     guarantees compile-time opacity; the runtime value is a plain
 *     string).
 *   - `isProviderNeutral` / `assertProviderNeutral` — the plain-data
 *     boundary check: every value crossing the injected transport seam
 *     must be recursively plain, JSON-serializable data. Functions,
 *     class instances (SDK objects), symbols and provider-metadata keys
 *     (topology/credential/sdk/token/secret/...) are violations.
 *
 * The boundary is ASSERTED BY TESTS (the D5 suite walks every value the
 * reference transport produces) and ENFORCED at runtime (the submission
 * gate and the adoption path refuse non-neutral provider values with
 * machine-stable reasons — a leaked SDK object is never recorded).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { Branded } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The opaque provider handle
// ---------------------------------------------------------------------------

/**
 * An opaque provider handle — the ONLY provider-originated value type in
 * this package's public surface (the ARCH-LOCK 7-8 boundary: "an
 * opaque-provider-handle type at most"). A branded string: the brand
 * guarantees compile-time opacity (it cannot be conflated with any other
 * string), and the runtime value carries NO provider structure — no
 * topology, no credentials, no SDK objects. The adapter treats it as a
 * correlation token for subsequent status fetches/termination ONLY.
 */
export type AdcosProviderHandle = Branded<string, "AdcosProviderHandle">;

/**
 * Construct an `AdcosProviderHandle` from a provider-supplied string.
 * Use at transport boundaries; the value is opaque (never parsed, never
 * interpreted).
 */
export function asAdcosProviderHandle(value: string): AdcosProviderHandle {
  return value as AdcosProviderHandle;
}

// ---------------------------------------------------------------------------
// The plain-data boundary check
// ---------------------------------------------------------------------------

/**
 * Key substrings that MUST NEVER appear in a value crossing the provider
 * boundary — the machine-stable denylist for provider topology,
 * credentials and SDK leakage. Matched case-insensitively against every
 * object key at every depth.
 */
export const PROVIDER_NEUTRAL_DENIED_KEY_SUBSTRINGS: readonly string[] = Object.freeze([
  "topology",
  "credential",
  "sdk",
  "token",
  "secret",
  "password",
  "apikey",
  "privatekey",
  "endpoint",
  "hostname",
  "url",
]);

/** The result of a provider-neutrality check — tagged, machine-stable. */
export type ProviderNeutralityCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly path: string;
      readonly reason:
        | "non_plain_object" // a class instance / function / symbol crossed the boundary
        | "function_value"
        | "denied_key" // a provider-metadata key (topology/credential/sdk/...)
        | "undefined_value";
      readonly detail: string;
    };

/**
 * Recursively check that a value crossing the provider boundary is
 * PROVIDER-NEUTRAL plain data:
 *
 *   - primitives: string / number / boolean / null (never `undefined`
 *     inside structures — an undefined-valued key is a hole in the data);
 *   - plain objects only (prototype is `Object.prototype` or `null`) —
 *     class instances (provider SDK objects) are violations;
 *   - arrays of the same;
 *   - NO functions anywhere (SDK handles/closures);
 *   - NO denied key substrings (topology/credential/sdk/token/secret/
 *     password/apikey/privatekey/endpoint/hostname/url) at any depth.
 *
 * Pure, deterministic, non-throwing; cycles are guarded (a repeated
 * reference is treated as `non_plain_object` — plain JSON data cannot
 * cycle).
 *
 * @param value the value that crossed (or is about to cross) the seam
 * @param path the JSON-pointer-ish path of the value (internal use)
 * @returns the tagged check result
 */
export function isProviderNeutral(
  value: unknown,
  path = "$",
): ProviderNeutralityCheck {
  return check(value, path, new Set());
}

function check(value: unknown, path: string, seen: Set<object>): ProviderNeutralityCheck {
  if (value === null) return { ok: true };
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return { ok: true };
    case "undefined":
      return { ok: false, path, reason: "undefined_value", detail: "undefined is not plain data" };
    case "function":
      return { ok: false, path, reason: "function_value", detail: "functions never cross the provider boundary" };
    case "bigint":
    case "symbol":
      return { ok: false, path, reason: "non_plain_object", detail: `${typeof value} is not plain data` };
    case "object":
      break;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return { ok: false, path, reason: "non_plain_object", detail: "cyclic reference" };
  }
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const entry = check(obj[i], `${path}[${i}]`, seen);
      if (!entry.ok) return entry;
    }
    return { ok: true };
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return {
      ok: false,
      path,
      reason: "non_plain_object",
      detail: `prototype ${proto?.constructor?.name ?? "unknown"} is not a plain object`,
    };
  }
  for (const key of Object.keys(obj)) {
    const lowered = key.toLowerCase();
    for (const denied of PROVIDER_NEUTRAL_DENIED_KEY_SUBSTRINGS) {
      if (lowered.includes(denied)) {
        return {
          ok: false,
          path: `${path}.${key}`,
          reason: "denied_key",
          detail: `key "${key}" matches denied substring "${denied}"`,
        };
      }
    }
    const entry = check((obj as Record<string, unknown>)[key], `${path}.${key}`, seen);
    if (!entry.ok) return entry;
  }
  return { ok: true };
}

/**
 * Throwing form of `isProviderNeutral` — the runtime enforcement hook
 * used by the adoption path and available to binding sites asserting
 * their own transports. Throws a `TypeError` carrying the
 * machine-stable path + reason; the callers that prefer tagged results
 * use `isProviderNeutral` directly.
 *
 * @param value the value that crossed (or is about to cross) the seam
 * @param what a human label for the error message
 * @throws TypeError when the value is not provider-neutral
 */
export function assertProviderNeutral(value: unknown, what: string): void {
  const checkResult = isProviderNeutral(value);
  if (!checkResult.ok) {
    throw new TypeError(
      `provider-neutral boundary violated at ${checkResult.path} (${what}): ${checkResult.reason} — ${checkResult.detail}`,
    );
  }
}
