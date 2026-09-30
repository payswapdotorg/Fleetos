/**
 * @fleetos/web-commerce — the Apify vendor-discovery ENRICHMENT surface
 * (W100C).
 *
 * The view-model over the OPTIONAL Apify enrichment adapter's results
 * (@fleetos/integration-apify — W100C). THE HARD LAW is preserved
 * end-to-end here:
 *
 *   - every proposal row renders as PROPOSAL-GRADE: the literal
 *     `proposalStatus: "PROPOSAL"` is carried verbatim from the adapter
 *     and the view REFUSES to build if it is missing (fail-visible, not
 *     fail-silent);
 *   - every row carries the provider ATTRIBUTION (provider, run id,
 *     dataset id, fetchedAt) — enrichment evidence is explicitly
 *     attributable (FREE-TIER provider acceptance);
 *   - the view carries NO authoritative commerce fields: no price, no
 *     inventory, no SLA/warranty terms — the tenant-approved vendor
 *     RECORDS (catalog.ts) remain the only authority;
 *   - the provider-unavailable state is FIRST-CLASS: `unconfigured`,
 *     `budget_exhausted` and `unreachable` each render with a
 *     machine-stable reason and the escalation path — never a silent
 *     empty list.
 *
 * The adapter results arrive through STRUCTURAL FACETS declared here
 * (the W040-disclosed pattern): src/ imports @fleetos/contracts only;
 * the REAL adapter results are assignable by structural typing and
 * injected at the binding site (proven by test, which imports the real
 * same-lane adapter in test/ only).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import { compareStrings, frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** The vendor-discovery view-model schema version. */
export const VENDOR_DISCOVERY_VIEW_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The structural facets (the W040 pattern — the adapter's result shapes)
// ---------------------------------------------------------------------------

/** The provenance facet (the adapter's `ApifyProvenance` at the binding site). */
export interface DiscoveryProvenanceFacets {
  readonly provider: "apify";
  readonly runId: string;
  readonly datasetId: string;
  readonly fetchedAt: string;
}

/**
 * One vendor-discovery proposal facet — the adapter's
 * `VendorDiscoveryProposal` minus the fields the display does not need.
 * The `proposalStatus` literal is REQUIRED (the hard law's
 * human-visible status).
 */
export interface DiscoveryProposalFacets {
  readonly proposalStatus: "PROPOSAL";
  readonly tenantId: TenantId;
  readonly provenance: DiscoveryProvenanceFacets;
  readonly candidateName: string;
  readonly region: string | null;
  readonly categories: readonly string[];
  readonly website: string | null;
  readonly phone: string | null;
  readonly contactEmail: string | null;
  readonly notes: string | null;
}

/** The attribution facet (the adapter's `ApifyDiscoveryAttribution`). */
export interface DiscoveryAttributionFacets {
  readonly provider: "apify";
  readonly runId: string;
  readonly datasetId: string;
  readonly fetchedAt: string;
  readonly rawItemCount: number;
  readonly proposalCount: number;
}

/** The provider-unavailable facet (the adapter's refusal state). */
export interface DiscoveryUnavailableFacets {
  readonly state: "unconfigured" | "budget_exhausted" | "unreachable";
  readonly reason: string;
  readonly retryable: boolean;
}

/** The discovery input: EITHER the proposals or the refusal — never both. */
export type VendorDiscoverySource =
  | {
      readonly kind: "discovered";
      readonly proposals: readonly DiscoveryProposalFacets[];
      readonly attribution: DiscoveryAttributionFacets;
    }
  | {
      readonly kind: "unavailable";
      readonly unavailable: DiscoveryUnavailableFacets;
      readonly escalationPath: string;
    };

// ---------------------------------------------------------------------------
// The view models
// ---------------------------------------------------------------------------

/** One proposal display row (PROPOSAL-GRADE, attribution-carrying). */
export interface VendorDiscoveryRowView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  /** The literal proposal discriminator, carried verbatim. */
  readonly proposalStatus: "PROPOSAL";
  readonly candidateName: string;
  readonly region: string | null;
  readonly categories: readonly string[];
  readonly website: string | null;
  readonly phone: string | null;
  readonly contactEmail: string | null;
  readonly notes: string | null;
  /** The row's attribution line (rendered verbatim). */
  readonly attributionLine: string;
}

/** The provider-unavailable display state (fail-visible). */
export interface DiscoveryUnavailableView {
  readonly viewVersion: number;
  readonly tenantId: TenantId;
  readonly state: "unconfigured" | "budget_exhausted" | "unreachable";
  readonly reason: string;
  readonly retryable: boolean;
  /** The escalation path, rendered verbatim. */
  readonly escalationPath: string;
  /** The operator-facing headline (machine-stable per state). */
  readonly headline: string;
}

/** The vendor-discovery surface view: proposals OR the unavailable state. */
export type VendorDiscoveryView =
  | {
      readonly viewVersion: number;
      readonly tenantId: TenantId;
      readonly kind: "discovered";
      readonly rows: readonly VendorDiscoveryRowView[];
      readonly attributionLine: string;
      readonly proposalCount: number;
    }
  | {
      readonly viewVersion: number;
      readonly tenantId: TenantId;
      readonly kind: "unavailable";
      readonly unavailable: DiscoveryUnavailableView;
    };

/** The tagged result of a discovery view build. */
export type VendorDiscoveryResult =
  | { readonly ok: true; readonly view: VendorDiscoveryView }
  | { readonly ok: false; readonly error: import("@fleetos/contracts").FleetError };

// ---------------------------------------------------------------------------
// The view builder (pure, deterministic)
// ---------------------------------------------------------------------------

const UNAVAILABLE_HEADLINES: Readonly<
  Record<DiscoveryUnavailableFacets["state"], string>
> = Object.freeze({
  unconfigured: "Vendor discovery enrichment is not configured",
  budget_exhausted: "Vendor discovery enrichment is paused — provider budget exhausted",
  unreachable: "Vendor discovery enrichment is temporarily unreachable",
});

/**
 * Build the vendor-discovery surface view from the adapter's result
 * facets. PURE and DETERMINISTIC:
 *
 *   - `discovered` rows sort by candidateName (code-unit order);
 *   - every row carries the attribution line "via Apify · run <id> ·
 *     dataset <id> · fetched <at>" (explicitly attributable);
 *   - a proposal WITHOUT the literal "PROPOSAL" status refuses the whole
 *     build (`proposal_status_required`) — the surface never renders
 *     enrichment data without the human-visible proposal status;
 *   - a proposal whose tenant scope disagrees with the acting tenant
 *     refuses (`tenant_mismatch` — LOCK 17);
 *   - `unavailable` renders the machine-stable state, reason and the
 *     adapter's escalation path verbatim.
 *
 * @param tenantId the acting tenant
 * @param source the discovery source (proposals or refusal)
 */
export function buildVendorDiscoveryView(
  tenantId: TenantId,
  source: VendorDiscoverySource,
): VendorDiscoveryResult {
  if (source === null || typeof source !== "object" || typeof source.kind !== "string") {
    return {
      ok: false,
      error: {
        kind: "ValidationError",
        code: "web-commerce.discovery.source_required",
        message: "buildVendorDiscoveryView: a discovery source is required",
        failures: [{ path: "/source", reason: "source_required" }],
        tenantId,
        correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
      },
    };
  }

  if (source.kind === "unavailable") {
    const unavailable = source.unavailable;
    if (
      unavailable === null ||
      typeof unavailable !== "object" ||
      typeof unavailable.state !== "string" ||
      typeof unavailable.reason !== "string"
    ) {
      return {
        ok: false,
        error: {
          kind: "ValidationError",
          code: "web-commerce.discovery.unavailable_shape_required",
          message: "buildVendorDiscoveryView: the unavailable state is malformed",
          failures: [{ path: "/source/unavailable", reason: "shape_required" }],
          tenantId,
          correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
        },
      };
    }
    return {
      ok: true,
      view: frozen({
        viewVersion: VENDOR_DISCOVERY_VIEW_VERSION,
        tenantId,
        kind: "unavailable",
        unavailable: frozen({
          viewVersion: VENDOR_DISCOVERY_VIEW_VERSION,
          tenantId,
          state: unavailable.state,
          reason: unavailable.reason,
          retryable: unavailable.retryable === true,
          escalationPath:
            typeof source.escalationPath === "string" && source.escalationPath.length > 0
              ? source.escalationPath
              : "Contact your fleet administrator to re-enable vendor-discovery enrichment.",
          headline: UNAVAILABLE_HEADLINES[unavailable.state] ?? "Vendor discovery is unavailable",
        }),
      }),
    };
  }

  // kind === "discovered"
  if (!Array.isArray(source.proposals)) {
    return {
      ok: false,
      error: {
        kind: "ValidationError",
        code: "web-commerce.discovery.proposals_array_required",
        message: "buildVendorDiscoveryView: proposals must be an array",
        failures: [{ path: "/source/proposals", reason: "array_required" }],
        tenantId,
        correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
      },
    };
  }
  for (const proposal of source.proposals) {
    if (proposal?.proposalStatus !== "PROPOSAL") {
      return {
        ok: false,
        error: {
          kind: "DomainError",
          code: "web-commerce.discovery.proposal_status_required",
          message:
            "buildVendorDiscoveryView: every enrichment row must carry the human-visible PROPOSAL status (the W100C hard law)",
          tenantId,
          correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
          domain: "web-commerce.discovery",
          invariant: "proposal_status_required",
        },
      };
    }
    if (proposal.tenantId !== tenantId) {
      return {
        ok: false,
        error: {
          kind: "DomainError",
          code: "web-commerce.discovery.tenant_mismatch",
          message:
            "buildVendorDiscoveryView: a proposal's tenant does not match the acting tenant",
          tenantId,
          correlationId: "cor_surface_w100c" as import("@fleetos/contracts").CorrelationId,
          domain: "web-commerce.discovery",
          invariant: "tenant_mismatch",
        },
      };
    }
  }

  const rows = frozenArray(
    [...source.proposals]
      .sort((a, b) => compareStrings(a.candidateName, b.candidateName))
      .map((proposal) =>
        frozen({
          viewVersion: VENDOR_DISCOVERY_VIEW_VERSION,
          tenantId,
          proposalStatus: proposal.proposalStatus,
          candidateName: proposal.candidateName,
          region: proposal.region ?? null,
          categories: frozenArray([...(proposal.categories ?? [])]),
          website: proposal.website ?? null,
          phone: proposal.phone ?? null,
          contactEmail: proposal.contactEmail ?? null,
          notes: proposal.notes ?? null,
          attributionLine: `via ${proposal.provenance.provider} · run ${proposal.provenance.runId} · dataset ${proposal.provenance.datasetId} · fetched ${proposal.provenance.fetchedAt}`,
        }),
      ),
  );

  const attribution = source.attribution;
  const attributionLine = `Discovered via ${attribution.provider} · run ${attribution.runId} · dataset ${attribution.datasetId} · fetched ${attribution.fetchedAt} · ${String(attribution.rawItemCount)} raw items → ${String(attribution.proposalCount)} proposals`;

  return {
    ok: true,
    view: frozen({
      viewVersion: VENDOR_DISCOVERY_VIEW_VERSION,
      tenantId,
      kind: "discovered",
      rows,
      attributionLine,
      proposalCount: rows.length,
    }),
  };
}
