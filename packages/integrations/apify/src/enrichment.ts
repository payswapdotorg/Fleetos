/**
 * @fleetos/integration-apify — the DISCOVERY ENRICHMENT proposal model
 * (W100C).
 *
 * THE HARD LAW (the work order, verbatim): "Apify output is
 * proposal/enrichment data ONLY — never authoritative inventory, price,
 * policy or fulfillment truth. The domain never treats Apify data as a
 * decision input without human-visible proposal status."
 *
 * This module makes that law STRUCTURAL:
 *
 *   - every record this package emits carries the literal discriminator
 *     `proposalStatus: "PROPOSAL"` — a human-visible status the surface
 *     MUST render (asserted by test);
 *   - the proposal's fields are DISCOVERY attributes only (candidate
 *     name, region, categories, contact points, notes). The type
 *     deliberately has NO field for price, inventory, quantity, stock,
 *     SLA, warranty, policy or fulfillment — the authority-boundary
 *     test greps the source for exactly those words to keep it that way;
 *   - every claim carries PROVENANCE (provider, run id, dataset id,
 *     fetchedAt) so evidence can attribute the enrichment to Apify
 *     explicitly (FREE-TIER acceptance: "explicitly attributable in
 *     evidence");
 *   - the normalization from raw provider items is DETERMINISTIC:
 *     sorted-unique categories, deduped by candidate name, stable order.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen, frozenArray, compareStrings } from "./internal";
import type { ApifyRawDatasetItem } from "./transport";

// ---------------------------------------------------------------------------
// The proposal model
// ---------------------------------------------------------------------------

/** The literal proposal discriminator — the human-visible status. */
export const APIFY_PROPOSAL_STATUS = "PROPOSAL" as const;

/** The provenance block every proposal carries verbatim. */
export interface ApifyProvenance {
  /** The provider identity (always "apify" from this adapter). */
  readonly provider: "apify";
  /** The provider run id that produced the dataset. */
  readonly runId: string;
  /** The dataset id the items came from. */
  readonly datasetId: string;
  /** The injected fetch instant (echoed from the transport request). */
  readonly fetchedAt: string;
}

/**
 * One vendor-discovery ENRICHMENT proposal. Structurally incapable of
 * carrying authoritative commerce truth: no price, no inventory, no
 * quantity, no SLA/warranty terms, no fulfillment claims. The vendor
 * record in `@fleetos/vendors` remains the ONLY authority for what a
 * vendor can do; this proposal merely NAMES a candidate for a human to
 * consider.
 */
export interface VendorDiscoveryProposal {
  /** The human-visible proposal status — always "PROPOSAL". */
  readonly proposalStatus: typeof APIFY_PROPOSAL_STATUS;
  /** The tenant the proposal was discovered FOR (display scoping). */
  readonly tenantId: TenantId;
  /** The provenance block (attribution evidence). */
  readonly provenance: ApifyProvenance;
  /** The candidate vendor's name as discovered. */
  readonly candidateName: string;
  /** The discovered region, when the provider reported one. */
  readonly region: string | null;
  /** The discovered service categories (sorted-unique). */
  readonly categories: readonly string[];
  /** The discovered website, when reported. */
  readonly website: string | null;
  /** The discovered phone, when reported. */
  readonly phone: string | null;
  /** The discovered contact email, when reported. */
  readonly contactEmail: string | null;
  /** Free-text discovery notes, when reported. */
  readonly notes: string | null;
}

/** The attribution summary returned with a discovery run. */
export interface ApifyDiscoveryAttribution {
  readonly provider: "apify";
  readonly runId: string;
  readonly datasetId: string;
  readonly fetchedAt: string;
  /** The number of raw items the provider returned. */
  readonly rawItemCount: number;
  /** The number of proposals the normalization produced. */
  readonly proposalCount: number;
}

// ---------------------------------------------------------------------------
// Normalization (pure, deterministic)
// ---------------------------------------------------------------------------

/** Coerce an unknown provider field to a trimmed non-empty string or null. */
function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Coerce an unknown provider field to a sorted-unique string list. */
function categoriesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return frozenArray([]);
  const set = new Set<string>();
  for (const entry of value) {
    const text = textOf(entry);
    if (text !== null) set.add(text);
  }
  return frozenArray([...set].sort(compareStrings));
}

/**
 * Normalize raw provider dataset items into vendor-discovery proposals.
 * PURE and DETERMINISTIC:
 *   - items without a usable candidate name are DROPPED (counted in the
 *     attribution as raw vs proposal difference — never silently kept
 *     as junk, never silently replacing a name);
 *   - duplicates by candidate name keep the FIRST occurrence (provider
 *     order) and merge nothing;
 *   - categories are sorted-unique per proposal;
 *   - the output order is candidateName ascending (stable display).
 *
 * @param tenantId the tenant the discovery ran for
 * @param provenance the run's provenance block
 * @param items the raw dataset items
 */
export function normalizeVendorDiscoveryProposals(
  tenantId: TenantId,
  provenance: ApifyProvenance,
  items: readonly ApifyRawDatasetItem[],
): readonly VendorDiscoveryProposal[] {
  const seen = new Set<string>();
  const proposals: VendorDiscoveryProposal[] = [];
  for (const item of items) {
    const candidateName = textOf(item.name);
    if (candidateName === null) continue;
    if (seen.has(candidateName)) continue;
    seen.add(candidateName);
    proposals.push(
      frozen({
        proposalStatus: APIFY_PROPOSAL_STATUS,
        tenantId,
        provenance: frozen({ ...provenance }),
        candidateName,
        region: textOf(item.region),
        categories: categoriesOf(item.categories),
        website: textOf(item.website),
        phone: textOf(item.phone),
        contactEmail: textOf(item.email),
        notes: textOf(item.notes),
      }),
    );
  }
  return frozenArray([...proposals].sort((a, b) => compareStrings(a.candidateName, b.candidateName)));
}

/**
 * Build the attribution summary for one discovery run. Pure.
 *
 * @param provenance the run's provenance
 * @param rawItemCount the number of raw items returned
 * @param proposals the normalized proposals
 */
export function buildDiscoveryAttribution(
  provenance: ApifyProvenance,
  rawItemCount: number,
  proposals: readonly VendorDiscoveryProposal[],
): ApifyDiscoveryAttribution {
  return frozen({
    provider: "apify",
    runId: provenance.runId,
    datasetId: provenance.datasetId,
    fetchedAt: provenance.fetchedAt,
    rawItemCount,
    proposalCount: proposals.length,
  });
}
