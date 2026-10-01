/**
 * @fleetos/integration-apify — the enrichment adapter (W100C).
 *
 * The single public entry point: `discoverVendorCandidates` —
 * vendor/catalog DISCOVERY ENRICHMENT ONLY. The adapter composes the
 * three guards in a FIXED order (unconfigured -> budget -> transport),
 * so every failure mode is an EXPLICIT machine-stable
 * `ApifyProviderUnavailable` the surface renders — FAIL-VISIBLE, never
 * fail-silent:
 *
 *   1. `unconfigured`       — no token in the environment seam (the
 *      provider is OPTIONAL; core FleetOS works without it);
 *   2. `budget_exhausted`   — the free-tier credit is spent (the
 *      reservation is refused BEFORE the transport fires — the run is
 *      never half-spent);
 *   3. `unreachable`        — the transport failed (network, HTTP
 *      error, rate limit — all mapped to machine-stable reasons).
 *
 * On success the adapter returns PROPOSALS (enrichment data only — see
 * enrichment.ts's hard-law module docs) with full provenance. There is
 * NO API here that mutates any FleetOS domain store, proposes a quote,
 * sets a price, or records inventory — the authority-boundary test
 * asserts the exact export surface.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { ApifyAvailability, ApifyTokenSource } from "./availability";
import type { ApifyUsageLedger } from "./budget";
import type { ApifyTransport } from "./transport";
import type { VendorDiscoveryProposal } from "./enrichment";
import {
  APIFY_PROPOSAL_STATUS,
  buildDiscoveryAttribution,
  normalizeVendorDiscoveryProposals,
} from "./enrichment";
import type { ApifyDiscoveryAttribution } from "./enrichment";

// ---------------------------------------------------------------------------
// The adapter's options + results
// ---------------------------------------------------------------------------

/** Options for the enrichment adapter. */
export interface ApifyEnrichmentAdapterOptions {
  /** The token source (environment seam). */
  readonly tokenSource: ApifyTokenSource;
  /** The usage-budget ledger (rate/cost guard). */
  readonly usageLedger: ApifyUsageLedger;
  /** The injected transport. */
  readonly transport: ApifyTransport;
  /**
   * The cost of one discovery run in integer cents (default 25 — an
   * explicit, visible unit the operator can tune).
   */
  readonly discoveryRunCostCents?: number;
}

/** One discovery request. */
export interface VendorDiscoveryQuery {
  /** The tenant the discovery runs for. */
  readonly tenantId: TenantId;
  /** The free-text discovery query. */
  readonly query: string;
  /** The optional region filter. */
  readonly region?: string;
  /** The injected request instant (no clock reads). */
  readonly now: string;
}

/**
 * The FAIL-VISIBLE provider-unavailable result. `availability` is the
 * machine-stable state the surface renders with its reason and
 * escalation path (ROLE-EXPERIENCE-MATRIX rule:
 * `unavailable_capabilities_show_reason_and_escalation_path`).
 */
export interface ApifyProviderUnavailable {
  readonly ok: false;
  readonly unavailable: ApifyAvailability & {
    readonly state: "unconfigured" | "budget_exhausted" | "unreachable";
  };
  /** The human-facing escalation path (rendered verbatim by the surface). */
  readonly escalationPath: string;
}

/** The successful discovery result: PROPOSALS + attribution, never truth. */
export interface ApifyDiscoverySuccess {
  readonly ok: true;
  readonly proposals: readonly VendorDiscoveryProposal[];
  readonly attribution: ApifyDiscoveryAttribution;
}

/** The tagged result of a discovery run. */
export type VendorDiscoveryResult = ApifyDiscoverySuccess | ApifyProviderUnavailable;

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** The escalation-path copy per unavailable state (machine-stable). */
const ESCALATION_PATHS: Readonly<
  Record<"unconfigured" | "budget_exhausted" | "unreachable", string>
> = Object.freeze({
  unconfigured:
    "Optional provider. Configure APIFY_TOKEN in the environment to enable Apify vendor-discovery enrichment; FleetOS works fully without it.",
  budget_exhausted:
    "The Apify free-tier credit is exhausted. Enrichment resumes at the next billing cycle, or a paid Apify plan can be bound; vendor records remain the authoritative source meanwhile.",
  unreachable:
    "The Apify transport failed. Retry the discovery later; vendor records remain the authoritative source meanwhile.",
});

/**
 * Create the Apify enrichment adapter.
 *
 * @param opts the adapter options (all seams injected)
 * @returns the frozen adapter
 */
export function createApifyEnrichmentAdapter(opts: ApifyEnrichmentAdapterOptions) {
  const runCostCents = opts.discoveryRunCostCents ?? 25;

  return frozen({
    /**
     * The availability PROBE (pure with respect to the seams' current
     * state): reports the provider state without spending anything.
     */
    availability(): ApifyAvailability {
      if (!opts.tokenSource.configured) {
        return frozen({ state: "unconfigured", reason: "apify_token_missing", retryable: false });
      }
      if (opts.usageLedger.remainingCents <= 0) {
        return frozen({
          state: "budget_exhausted",
          reason: "apify_free_credit_exhausted",
          retryable: true,
        });
      }
      return frozen({ state: "available" });
    },

    /**
     * Discover vendor candidates (ENRICHMENT PROPOSALS ONLY). The guard
     * order is FIXED: unconfigured -> budget -> transport. A refused run
     * spends NOTHING and mutates NOTHING; a successful run reserves its
     * cost up front and normalizes the provider's dataset into
     * deterministic, provenance-carrying proposals.
     */
    discoverVendorCandidates(query: VendorDiscoveryQuery): VendorDiscoveryResult {
      // Guard 1: the provider is OPTIONAL and not configured — visible,
      // not silent.
      if (!opts.tokenSource.configured) {
        return frozen({
          ok: false,
          unavailable: frozen({
            state: "unconfigured",
            reason: "apify_token_missing",
            retryable: false,
          }),
          escalationPath: ESCALATION_PATHS.unconfigured,
        });
      }

      // Guard 2: the budget guard refuses BEFORE the transport fires.
      const reservation = opts.usageLedger.checkAndReserve(runCostCents);
      if (!reservation.ok) {
        return frozen({
          ok: false,
          unavailable: frozen({
            state: "budget_exhausted",
            reason: "apify_free_credit_exhausted",
            retryable: true,
          }),
          escalationPath: ESCALATION_PATHS.budget_exhausted,
        });
      }

      // Guard 3: the transport (injected; failures map machine-stably).
      const result = opts.transport.runDiscovery({
        tenantId: query.tenantId,
        query: query.query,
        ...(query.region !== undefined ? { region: query.region } : {}),
        requestedAt: query.now,
      });
      if (!result.ok) {
        // A transport failure that never reached the provider spends
        // NOTHING: the reservation is released (an unreachable network
        // is not a provider-side cost). Provider-side failures
        // (http_error / rate_limited) DID execute a run — the spend
        // stands, visible in the ledger.
        if (result.kind === "unreachable") {
          opts.usageLedger.release(runCostCents);
        }
        const reason =
          result.kind === "rate_limited"
            ? "apify_transport_rate_limited"
            : result.kind === "http_error"
              ? "apify_transport_http_error"
              : "apify_transport_unreachable";
        return frozen({
          ok: false,
          unavailable: frozen({
            state: "unreachable",
            reason,
            retryable: true,
          }),
          escalationPath: ESCALATION_PATHS.unreachable,
        });
      }

      const provenance = frozen({
        provider: "apify" as const,
        runId: result.runId,
        datasetId: result.datasetId,
        fetchedAt: query.now,
      });
      const proposals = normalizeVendorDiscoveryProposals(
        query.tenantId,
        provenance,
        result.items,
      );
      return frozen({
        ok: true,
        proposals,
        attribution: buildDiscoveryAttribution(provenance, result.items.length, proposals),
      });
    },

    /** The proposal-status literal (rendered by every consuming surface). */
    proposalStatus: APIFY_PROPOSAL_STATUS,
  });
}

export type ApifyEnrichmentAdapter = ReturnType<typeof createApifyEnrichmentAdapter>;
