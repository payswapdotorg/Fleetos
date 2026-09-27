/**
 * @fleetos/device-adapters — D2: Capability discovery + negotiation.
 *
 * The agent declares a capability record built on the frozen
 * `AdapterCapabilities` from `@fleetos/contracts`. Capability support is
 * EXPLICIT: an adapter MUST declare each supported capability as `true`;
 * declaring a capability as `false` is equivalent to omitting it.
 *
 * **Critical invariant (ARCHITECTURE-LOCK.md item 16):** Unsupported
 * DESTRUCTIVE behavior may NEVER be emulated. If a capability is not
 * declared, the action MUST be refused — never silently emulated via a
 * different code path. The `negotiateCapability` function encodes this
 * rule: an unsupported capability produces an `AdapterError` and a
 * refusal result; an unsupported DESTRUCTIVE capability additionally
 * produces a `PolicyError` when the local policy cache is stale or
 * offline (default-deny for consequential actions).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  ALL_ADAPTER_CAPABILITIES,
  DESTRUCTIVE_CAPABILITIES,
  assertSupported,
  isDestructive,
  isSupported,
  type AdapterCapabilities,
} from "@fleetos/contracts";
import type { DeviceId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  frozen,
  frozenArray,
  makeAdapterError,
  makePolicyError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D2.1 — Declared agent capability record
// ---------------------------------------------------------------------------

/**
 * The agent's declared capability record. Built on the frozen
 * `AdapterCapabilities` shape — the lane does NOT duplicate the
 * capability flag set. The record adds:
 *
 *   - `adapterFamily` — which adapter implementation backs the agent
 *     (windows/macos/linux/ios/android/...). Used for routing and audit.
 *   - `declaredAt` — ISO 8601 timestamp of declaration (injected; never
 *     the system clock).
 *   - `supported` / `unsupported` — explicit enumerable sets derived
 *     from `capabilities`, for fast lookup and audit.
 *
 * The record is tenant-scoped because capabilities may vary across
 * tenants (e.g. a tenant may opt out of `wipe` for compliance reasons).
 */
export interface DeclaredAgentCapabilities extends TenantScoped {
  /** The adapter family backing the agent. */
  readonly adapterFamily: string;
  /** The frozen capability flag set. */
  readonly capabilities: AdapterCapabilities;
  /** Explicit enumerable set of supported capabilities. */
  readonly supported: readonly (keyof AdapterCapabilities)[];
  /** Explicit enumerable set of explicitly-unsupported capabilities. */
  readonly unsupported: readonly (keyof AdapterCapabilities)[];
  /** ISO 8601 timestamp of declaration (injected). */
  readonly declaredAt: string;
  /** Optional device id (when the record is bound to a specific device). */
  readonly deviceId?: DeviceId;
}

/**
 * Inputs needed to declare an agent's capabilities. The lane derives the
 * `supported` and `unsupported` enumerable sets from `capabilities` so
 * the caller cannot desynchronize them.
 */
export interface DeclareAgentCapabilitiesInputs {
  readonly tenantId: TenantId;
  readonly adapterFamily: string;
  readonly capabilities: AdapterCapabilities;
  readonly declaredAt: string;
  readonly deviceId?: DeviceId;
}

/**
 * Construct a `DeclaredAgentCapabilities` record from inputs. Pure,
 * deterministic, frozen. The `supported` and `unsupported` enumerable
 * sets are derived from `capabilities` by iterating
 * `ALL_ADAPTER_CAPABILITIES` (the frozen canonical list).
 */
export function declareAgentCapabilities(
  inputs: DeclareAgentCapabilitiesInputs,
): DeclaredAgentCapabilities {
  const supported: (keyof AdapterCapabilities)[] = [];
  const unsupported: (keyof AdapterCapabilities)[] = [];
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    if (inputs.capabilities[capability] === true) {
      supported.push(capability);
    } else {
      unsupported.push(capability);
    }
  }
  return frozen({
    tenantId: inputs.tenantId,
    adapterFamily: inputs.adapterFamily,
    capabilities: frozen({ ...inputs.capabilities }) as AdapterCapabilities,
    supported: frozenArray(supported),
    unsupported: frozenArray(unsupported),
    declaredAt: inputs.declaredAt,
    deviceId: inputs.deviceId,
  });
}

// ---------------------------------------------------------------------------
// D2.2 — Capability negotiation request
// ---------------------------------------------------------------------------

/**
 * The capability negotiation request. The agent runtime issues one of
 * these before invoking a capability; the lane returns a
 * `CapabilityNegotiationResult` indicating whether the invocation may
 * proceed.
 *
 * The request carries:
 *   - `capability` — the capability being invoked.
 *   - `policyGrant` — whether the local signed-policy cache (D5) has an
 *     explicit grant for this destructive capability. Ignored for
 *     non-destructive capabilities. False/absent means no grant.
 *   - `policyCacheReady` — whether the local policy cache is fresh and
 *     signature-verified. When false, destructive capabilities are
 *     default-denied (ARCHITECTURE-LOCK.md item 16: "Destructive actions
 *     require an explicit policy grant and evidence trail").
 */
export interface CapabilityNegotiationRequest extends TenantScoped {
  /** The capability being invoked. */
  readonly capability: keyof AdapterCapabilities;
  /** Whether the local policy cache has an explicit grant for this destructive capability. */
  readonly policyGrant: boolean;
  /** Whether the local policy cache is fresh and signature-verified. */
  readonly policyCacheReady: boolean;
  /** Optional device id (when the negotiation is for a specific device). */
  readonly deviceId?: DeviceId;
  /** Optional correlation id for traceability. */
  readonly correlationId: import("@fleetos/contracts").CorrelationId;
}

// ---------------------------------------------------------------------------
// D2.3 — Negotiation result
// ---------------------------------------------------------------------------

/**
 * The result of a capability negotiation. Tagged-union so callers can
 * branch on the refusal mode without try/catch.
 *
 * Refusal modes:
 *   - `unsupported` — the capability is not declared. The action MUST be
 *     refused — never emulated. Mapped to `AdapterError`.
 *   - `destructive_unauthorized` — the capability is destructive and the
 *     caller does not have an explicit policy grant. Mapped to
 *     `PolicyError` with `decision: "REQUIRE_APPROVAL"`.
 *   - `destructive_offline_default_deny` — the capability is destructive
 *     and the local policy cache is stale/offline; the action is
 *     default-denied. Mapped to `PolicyError` with `decision: "BLOCK"`.
 *
 * On success (`ok: true`), the caller may proceed; the result carries the
 * `capability` for traceability.
 */
export type CapabilityNegotiationResult =
  | { ok: true; capability: keyof AdapterCapabilities; destructive: boolean }
  | {
      ok: false;
      reason: "unsupported" | "destructive_unauthorized" | "destructive_offline_default_deny";
      capability: keyof AdapterCapabilities;
      destructive: boolean;
      error: ReturnType<typeof makeAdapterError> | ReturnType<typeof makePolicyError>;
    };

// ---------------------------------------------------------------------------
// D2.4 — Negotiation function
// ---------------------------------------------------------------------------

/**
 * Negotiate a capability invocation against the agent's declared
 * capabilities and the local policy cache state.
 *
 * **Critical invariant:** this function never returns `ok: true` for an
 * unsupported capability. Unsupported destructive behavior may NEVER be
 * emulated. If the caller receives a refusal, the action MUST be
 * refused — never silently emulated via a different code path.
 *
 * The function delegates the supported/destructive predicates to the
 * frozen `assertSupported` from `@fleetos/contracts`; it adds the
 * policy-cache and offline-default-deny layers required by
 * ARCHITECTURE-LOCK.md item 16.
 *
 * @param declared the agent's declared capabilities
 * @param request the negotiation request
 * @returns the negotiation result
 */
export function negotiateCapability(
  declared: DeclaredAgentCapabilities,
  request: CapabilityNegotiationRequest,
): CapabilityNegotiationResult {
  const capability = request.capability;
  const destructive = isDestructive(capability);
  const trace: ErrorTrace = {
    tenantId: request.tenantId,
    correlationId: request.correlationId,
  };

  // 1. Frozen contracts assertion: supported + (if destructive) policy grant.
  //    The frozen `assertSupported` returns `unsupported` or
  //    `destructive_unauthorized` for the two failure modes it knows about.
  const assertion = assertSupported(capability, declared.capabilities, request.policyGrant);
  if (!assertion.ok) {
    if (assertion.reason === "unsupported") {
      return frozen({
        ok: false as const,
        reason: "unsupported" as const,
        capability,
        destructive,
        error: makeAdapterError(
          ERROR_CODES.capabilityUnsupported,
          `capability "${capability}" is not supported by this adapter (${declared.adapterFamily})`,
          trace,
          capability as string,
          declared.adapterFamily,
          false,
          declared.deviceId as string | undefined,
        ),
      });
    }
    // assertion.reason === "destructive_unauthorized"
    return frozen({
      ok: false as const,
      reason: "destructive_unauthorized" as const,
      capability,
      destructive,
      error: makePolicyError(
        ERROR_CODES.capabilityDestructiveUnauthorized,
        `destructive capability "${capability}" requires an explicit policy grant`,
        trace,
        "REQUIRE_APPROVAL",
        [capability as string],
      ),
    });
  }

  // 2. Additional offline-default-deny for destructive capabilities.
  //    When the local policy cache is NOT fresh/signature-verified,
  //    destructive actions are default-denied even if a grant was presented
  //    (the grant cannot be trusted). This is the local signed-policy
  //    cache's staleness/offline rule (D5), surfaced here at the
  //    capability-negotiation seam.
  if (destructive && !request.policyCacheReady) {
    return frozen({
      ok: false as const,
      reason: "destructive_offline_default_deny" as const,
      capability,
      destructive,
      error: makePolicyError(
        ERROR_CODES.capabilityDestructiveOfflineDefaultDeny,
        `destructive capability "${capability}" is default-denied: the local policy cache is stale or offline`,
        trace,
        "BLOCK",
        [capability as string, "policy.cache.stale"],
      ),
    });
  }

  return frozen({
    ok: true as const,
    capability,
    destructive,
  });
}

// ---------------------------------------------------------------------------
// D2.5 — Convenience predicates
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is the given capability supported by the declared
 * agent capabilities? Delegates to the frozen `isSupported`.
 */
export function isCapabilitySupported(
  declared: DeclaredAgentCapabilities,
  capability: keyof AdapterCapabilities,
): boolean {
  return isSupported(capability, declared.capabilities);
}

/**
 * Pure predicate: is the given capability destructive? Delegates to the
 * frozen `isDestructive`.
 */
export function isCapabilityDestructive(capability: keyof AdapterCapabilities): boolean {
  return isDestructive(capability);
}

/**
 * The full list of destructive capabilities (frozen re-export for
 * audit/manifest convenience). Same set as `DESTRUCTIVE_CAPABILITIES`
 * from `@fleetos/contracts`.
 */
export const AGENT_DESTRUCTIVE_CAPABILITIES: readonly (keyof AdapterCapabilities)[] =
  DESTRUCTIVE_CAPABILITIES;

/**
 * The full list of all adapter capabilities (frozen re-export for
 * audit/manifest convenience). Same set as `ALL_ADAPTER_CAPABILITIES`
 * from `@fleetos/contracts`.
 */
export const AGENT_ALL_CAPABILITIES: readonly (keyof AdapterCapabilities)[] =
  ALL_ADAPTER_CAPABILITIES;
