/**
 * @fleetos/integration-apify — the injected transport seam (W100C).
 *
 * ALL transport is an INJECTED seam: the adapter never performs real
 * network I/O and never imports a provider SDK (ARCHITECTURE-LOCK 6 —
 * provider-specific APIs never enter core domain contracts; the
 * FREE-TIER provider acceptance list — "provider SDKs belong only under
 * integration/adapter packages or runtime composition" — and even HERE
 * the reference is in-memory). The W102 [TL] staging binding implements
 * this typed contract over the real Apify API at the runtime boundary.
 *
 * The seam is provider-neutral in its payload: a discovery request in,
 * raw dataset items out — never a provider-specific type.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// The request / response shapes
// ---------------------------------------------------------------------------

/** One discovery request handed to the transport. */
export interface ApifyDiscoveryRequest {
  /** The tenant scope (attribution + rate namespacing at the binding). */
  readonly tenantId: string;
  /** The free-text discovery query (e.g. "laptop repair vendors Berlin"). */
  readonly query: string;
  /** The optional region filter. */
  readonly region?: string;
  /** The injected request instant (no clock reads). */
  readonly requestedAt: string;
}

/**
 * One RAW dataset item as the provider returned it. Opaque beyond the
 * fields the normalization consumes — the provider's schema never
 * crosses this seam verbatim into the domain.
 */
export interface ApifyRawDatasetItem {
  readonly name?: unknown;
  readonly region?: unknown;
  readonly categories?: unknown;
  readonly website?: unknown;
  readonly phone?: unknown;
  readonly email?: unknown;
  readonly notes?: unknown;
}

/** The transport's success payload. */
export interface ApifyTransportSuccess {
  readonly ok: true;
  /** The provider's run id (attribution evidence). */
  readonly runId: string;
  /** The dataset id the items came from (attribution evidence). */
  readonly datasetId: string;
  readonly items: readonly ApifyRawDatasetItem[];
}

/** The transport's failure kinds (mapped to availability states upstream). */
export type ApifyTransportFailure =
  | { readonly ok: false; readonly kind: "unreachable"; readonly detail: string }
  | { readonly ok: false; readonly kind: "http_error"; readonly detail: string }
  | { readonly ok: false; readonly kind: "rate_limited"; readonly detail: string };

/** The transport result. */
export type ApifyTransportResult = ApifyTransportSuccess | ApifyTransportFailure;

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** The injected transport seam. */
export interface ApifyTransport {
  /** Run one discovery request. */
  runDiscovery(request: ApifyDiscoveryRequest): ApifyTransportResult;
}

// ---------------------------------------------------------------------------
// The in-memory reference transport
// ---------------------------------------------------------------------------

/** Options for the in-memory reference transport. */
export interface InMemoryTransportOptions {
  /**
   * A deterministic response script: the transport returns responses in
   * order, cycling when exhausted. When absent, every request succeeds
   * with an EMPTY dataset (the provider "found nothing" — a visible,
   * attributable zero, not an error).
   */
  readonly responses?: readonly ApifyTransportResult[];
}

/**
 * Create the in-memory reference transport: records every request
 * verbatim (call order) and replays the scripted responses. Deterministic;
 * no network, no clock, no entropy.
 *
 * @param opts the transport options
 * @returns the frozen transport + its call log
 */
export function createInMemoryTransport(
  opts: InMemoryTransportOptions = {},
): ApifyTransport & {
  readonly requests: readonly ApifyDiscoveryRequest[];
} {
  const requests: ApifyDiscoveryRequest[] = [];
  const responses = opts.responses ?? [];
  let cursor = 0;
  return frozen({
    runDiscovery(request: ApifyDiscoveryRequest): ApifyTransportResult {
      requests.push(request);
      if (responses.length === 0) {
        return frozen({
          ok: true,
          runId: "apify_run_memory000001",
          datasetId: "apify_ds_memory000001",
          items: frozenArray([]),
        });
      }
      const response = responses[cursor % responses.length]!;
      cursor += 1;
      return response;
    },
    get requests(): readonly ApifyDiscoveryRequest[] {
      return frozenArray(requests);
    },
  });
}
