/**
 * @fleetos/integration-apify — public API.
 *
 * The OPTIONAL Apify enrichment adapter (W100C, lane C). Apify serves
 * vendor/catalog DISCOVERY ENRICHMENT ONLY
 * (docs/tech-lead/FREE-TIER-PROVIDER-MATRIX.md: "optional data-discovery
 * enrichment for vendor/catalog/market research workflows").
 *
 * THE AUTHORITY BOUNDARY (the W100C hard law): Apify output is
 * PROPOSAL/ENRICHMENT data only — never authoritative inventory, price,
 * policy or fulfillment truth. This package's public surface contains
 * ONLY:
 *
 *   1. the machine-stable AVAILABILITY states (fail-visible: an absent
 *      or budget-exhausted provider is an explicit rendered state,
 *      never a silent empty result);
 *   2. the ENVIRONMENT seam for the provider token (names and presence
 *      only — values never enter this package's state or output);
 *   3. the USAGE/BUDGET guard (integer-cent reservations, refused
 *      up-front when the free-tier credit cannot cover a run);
 *   4. the injected TRANSPORT seam (no network I/O, no provider SDK —
 *      the runtime binding implements the typed contract);
 *   5. the ENRICHMENT proposal model (every record carries the literal
 *      `proposalStatus: "PROPOSAL"` discriminator + full provenance; the
 *      type has NO field for price/inventory/quantity/SLA/warranty/
 *      fulfillment — structurally incapable of authoritative commerce
 *      truth);
 *   6. the ADAPTER composing the guards in a fixed order
 *      (unconfigured -> budget -> transport) into one discovery entry
 *      point.
 *
 * There is NO API here that mutates any FleetOS domain store, records a
 * vendor, proposes a quote, or sets any authoritative value — any
 * adoption of a discovered candidate flows exclusively through the
 * existing authorized vendor surfaces (@fleetos/vendors, W032). The
 * authority-boundary test asserts the exact export surface
 * byte-for-byte.
 *
 * src/ imports ONLY `@fleetos/contracts` (the shared seam — the
 * ownership gate permits same-lane imports, but this adapter needs
 * nothing else: it is deliberately provider- and domain-store-free).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

// The availability + environment seams (fail-visible states)
export * from "./availability";

// The usage/budget guard (integer-cent reservations)
export * from "./budget";

// The injected transport seam (provider-neutral payloads)
export * from "./transport";

// The enrichment proposal model (PROPOSAL-grade, provenance-carrying)
export * from "./enrichment";

// The adapter (the single discovery entry point)
export * from "./adapter";

// W001-style placeholder markers (required by tools/verify-skeleton.mjs
// and tools/check-contracts.mjs).
export const MODULE_NAME = "integration-apify" as const;
export const MODULE_VERSION = "0.1.0" as const;
