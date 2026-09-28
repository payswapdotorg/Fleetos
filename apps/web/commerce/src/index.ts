/**
 * @fleetos/web-commerce — Public API.
 *
 * Lane C (worker-c) implementation of the COMMERCE + CONNECTIVITY UI
 * surfaces (W060C items 2-4): typed, provider-neutral, test-first
 * view-models + state machines + surface contracts for the W032
 * procurement exchange, the W042 maintenance exchange, the W050A ADCOS
 * connectivity boundary, and the W050C Aurum communication channel.
 * This is a PURE TYPESCRIPT SURFACE MODULE — not a rendered app; the
 * shell arrives with W061 [TL].
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every display instant is injected by the caller):
 *
 *   seams.ts           The STRUCTURAL seams (the W040-disclosed pattern):
 *                      facet interfaces for the W032 demand / vendor
 *                      match / quote / ledger / aggregated order, the
 *                      vendor + software models, the W042 service work
 *                      order / service match / aggregated service order,
 *                      the W050A submission + adopted record, and the
 *                      W050C outbox + delivery records. src/ imports
 *                      @fleetos/contracts ONLY; the real domain records
 *                      are injected at the binding site and proven
 *                      assignable by the test suite.
 *   catalog.ts         The vendor + software catalog surfaces: typed
 *                      terms (quality / SLA / warranty windows), sorted
 *                      capability + region lists, inventory signals,
 *                      subscription seats + terms.
 *   procurement.ts     The procurement exchange display: demand rows
 *                      with deadline-pressure buckets, vendor matching
 *                      (the ENGINE's rank preserved + typed HEADROOM
 *                      ranks machine-stable), versioned quotes with
 *                      acceptance entries, the quote-vs-demand
 *                      evaluation (budget/lead-time headrooms), and the
 *                      LOCK 14 deadline-aggregation display with
 *                      PER-CONTRACT IDENTITY PRESERVED.
 *   maintenance.ts     The maintenance exchange display: service work
 *                      orders from health diagnoses (machine-stable
 *                      evidence refs), the WARRANTY-AWARE eligibility
 *                      standing against vendor terms, service matching
 *                      with headroom ranks, and the aggregated service
 *                      orders (LOCK 14) with deadline pressure.
 *   connectivity.ts    The ADCOS boundary surfaced PROVIDER-NEUTRALLY:
 *                      connectivity intent requests with the full
 *                      Guardian decision context (PARKED approvals
 *                      visible), status ingestion timelines with
 *                      NORMALIZED states + machine-stable degradation —
 *                      NEVER provider topology or credentials
 *                      (ARCHITECTURE-LOCK items 6-8).
 *   communication.ts  The Aurum channel surfaced METADATA-ONLY: the
 *                      outbox + delivery ledger READ-ONLY views, the six
 *                      provider-neutral message kinds, derived summaries
 *                      — the AUTHORITY BOUNDARY holds (no FleetOS-truth
 *                      mutation from this surface, ARCHITECTURE-LOCK
 *                      item 10).
 *   state.ts           The commerce-surface state machines: the
 *                      procurement journey and the maintenance journey,
 *                      typed views/events + frozen transition tables +
 *                      pure reducers with machine-stable refusals.
 *
 * Surface discipline (enforced by test):
 *   - Every builder is a pure function; results are tagged
 *     `{ ok: true, view } | { ok: false, error }` — never throws.
 *   - Every view is frozen, JSON-serializable, tenant-scoped, and
 *     machine-stable (deterministic order + rendering).
 *   - Tenant scoping at the boundary (LOCK 17); provider-neutral display
 *     only (LOCK 6-8); read-only projections (LOCK 10 for the Aurum
 *     arm); per-contract identity preserved in aggregations (LOCK 14).
 */

// The structural seams (the W040-disclosed pattern)
export * from "./seams";

// The vendor + software catalog surfaces
export * from "./catalog";

// The procurement exchange surface (demand / matching / quotes / LOCK 14)
export * from "./procurement";

// The maintenance exchange surface (work orders / warranty / deadlines)
export * from "./maintenance";

// The connectivity surface (ADCOS boundary, provider-neutral)
export * from "./connectivity";

// The communication surface (Aurum channel, metadata-only)
export * from "./communication";

// The commerce-surface state machines
export * from "./state";

// Module markers (the workspace convention).
export const MODULE_NAME = "web-commerce" as const;
export const MODULE_VERSION = "0.1.0" as const;
