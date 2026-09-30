/**
 * @fleetos/integration-apify — the availability + environment seams
 * (W100C).
 *
 * Apify is an OPTIONAL provider (FREE-TIER-PROVIDER-MATRIX.md):
 *   - adapter-only;
 *   - non-authoritative;
 *   - rate/cost guarded;
 *   - explicitly attributable in evidence;
 *   - optional — core FleetOS operation works WITHOUT it.
 *
 * The provider-unavailable discipline is FAIL-VISIBLE, never
 * fail-silent: every state where the provider cannot serve is an
 * explicit, machine-stable `ApifyAvailability` the surface renders —
 * "unconfigured" (no token in the environment seam), "budget_exhausted"
 * (the free-tier credit is spent; blocked until the next cycle), or
 * "unreachable" (transport failure). The domain NEVER receives partial
 * or silently-empty enrichment data.
 *
 * Credentials: the token comes from the ENVIRONMENT SEAM ONLY. This
 * package stores and echoes NAMES and presence, never values.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen } from "./internal";

// ---------------------------------------------------------------------------
// The environment seam
// ---------------------------------------------------------------------------

/**
 * The environment variable NAME that carries the Apify token at the
 * runtime binding site (FREE-TIER-PROVIDER-MATRIX.md — "Apify token,
 * when enabled"). The VALUE never enters this package's state, logs, or
 * output.
 */
export const APIFY_TOKEN_ENV_NAME = "APIFY_TOKEN" as const;

/**
 * The injected environment reader seam. Implementations return the
 * environment VALUE for a name, or undefined when absent. The default
 * `processEnvTokenSource` reads `globalThis.process.env` when a Node-like
 * runtime is present — never throwing in environments without it.
 */
export type ApifyEnvReader = (name: string) => string | undefined;

/**
 * The token source: reads the token VALUE from the environment seam and
 * reports only PRESENCE to callers (the value is used exclusively as the
 * opaque credential handed to the transport seam — never stored, logged,
 * or embedded in proposals).
 */
export interface ApifyTokenSource {
  /** Whether the token is present and non-empty in the environment seam. */
  readonly configured: boolean;
}

/**
 * Create the token source over an injected environment reader.
 *
 * @param reader the environment reader (e.g. `(n) => process.env[n]`)
 * @returns the frozen token source
 */
export function createApifyTokenSource(reader: ApifyEnvReader): ApifyTokenSource {
  const value = reader(APIFY_TOKEN_ENV_NAME);
  return frozen({
    configured: typeof value === "string" && value.length > 0,
  });
}

/**
 * The reference token source: reads the Node-like process environment
 * when present. Pure with respect to injected state; never throws in
 * non-Node runtimes (the browser bundle has no `process`).
 */
export const PROCESS_ENV_TOKEN_SOURCE: ApifyTokenSource = frozen({
  get configured(): boolean {
    const proc = (globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } })
      .process;
    const value = proc?.env?.[APIFY_TOKEN_ENV_NAME];
    return typeof value === "string" && value.length > 0;
  },
});

// ---------------------------------------------------------------------------
// The availability state
// ---------------------------------------------------------------------------

/** The machine-stable provider-state vocabulary. */
export type ApifyProviderState = "available" | "unconfigured" | "budget_exhausted" | "unreachable";

/**
 * The FAIL-VISIBLE availability of the Apify provider. When `state` is
 * not "available", `reason` is a machine-stable explanation and
 * `retryable` tells the surface whether retrying can help.
 */
export type ApifyAvailability =
  | { readonly state: "available" }
  | {
      readonly state: Exclude<ApifyProviderState, "available">;
      /** Machine-stable reason code (never a raw provider message). */
      readonly reason: string;
      /** Whether a retry may succeed (budget resets next cycle; transport blips heal). */
      readonly retryable: boolean;
    };

/** Convenience constructors (frozen, machine-stable). */
export const APIFY_UNCONFIGURED: ApifyAvailability = frozen({
  state: "unconfigured",
  reason: "apify_token_missing",
  retryable: false,
});

/** The budget-exhausted state (the free credit is spent until the next cycle). */
export function apifyBudgetExhausted(remainingCents: number): ApifyAvailability {
  return frozen({
    state: "budget_exhausted",
    reason: "apify_free_credit_exhausted",
    retryable: true,
    detail: `remaining platform credit: ${String(remainingCents)} cents (resets at the next billing cycle)`,
  } as ApifyAvailability);
}

/** The unreachable state (transport failure of any kind). */
export function apifyUnreachable(kind: string): ApifyAvailability {
  return frozen({
    state: "unreachable",
    reason: `apify_transport_${kind}`,
    retryable: true,
  });
}
