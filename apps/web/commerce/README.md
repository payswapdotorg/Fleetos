# @fleetos/web-commerce

The COMMERCE + CONNECTIVITY UI surfaces (W060C, lane C): typed,
provider-neutral, test-first view-models + state machines + surface
contracts for the W032 procurement exchange, the W042 maintenance
exchange, the W050A ADCOS connectivity boundary, and the W050C Aurum
communication channel. A PURE TYPESCRIPT SURFACE MODULE — not a rendered
app; the shell arrives with W061 [TL].

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml` — `apps/web/commerce/`).

## Frozen spec source

`spec/ARCHITECTURE.md` § Procurement/service exchange; `spec/ARCHITECTURE-LOCK.md`
items 6-8 (provider neutrality; ADCOS/Arena/Aurum through provider-neutral
contracts), 10 (Aurum is a communication channel; FleetOS remains
operational authority), 13 (procurement is an exchange/matching problem),
14 (deadlines may drive compatible order aggregation without erasing
contract identity), 17 (tenant isolation), 19 (UI journeys expose
architecture-level capabilities); `spec/procurement/PROCUREMENT-EXCHANGE.md`;
`spec/integration/ADCOS.md`; `spec/integration/AURUM.md`.

## The structural seams (the W040-disclosed pattern)

`src/` imports `@fleetos/contracts` ONLY. Every domain record the surface
consumes is declared in `src/seams.ts` as a FACET interface — the minimum
the display needs — and the REAL accepted domain records (W032
`ProcurementDemand` / `VendorMatch` / `Quote` / `QuoteLedger` /
`AggregatedOrder` from `@fleetos/procurement`, `Vendor` from
`@fleetos/vendors`, `SoftwareSubscription` from `@fleetos/software`, W042
`ServiceWorkOrder` / `ServiceVendorMatch` / `AggregatedServiceOrder` from
`@fleetos/maintenance`, W050A `ConnectivitySubmissionRecord` /
`ConnectivityRecord` from `@fleetos/integration-adcos`, W050C
`OutboxEntry` / `DeliveryRecord` from `@fleetos/integration-aurum`) are
ASSIGNABLE to those facets by TypeScript structural typing. The binding
site (the W061 shell) injects the real records; `test/` is the runtime
proof (the ownership gate permits cross-lane imports in `test/` only).

Provider-neutrality is enforced at the SEAM level: the ADCOS facets
EXCLUDE the opaque provider handle, the provider refusal DETAIL (the
machine-stable refusal REASON is surfaced), and every provider
topology/credential field (LOCK 6-8); the Aurum facets EXCLUDE the
provider's own message handle (`providerMessageId` — LOCK 10
metadata-only).

## Module map

- `src/seams.ts` — the structural facets for every surfaced domain.
- `src/catalog.ts` — the vendor + software catalog surfaces (typed
  terms, warranty windows, inventory signals, seats + terms).
- `src/procurement.ts` — the procurement exchange display: demand rows
  with deadline-pressure buckets, vendor matching (the ENGINE's rank
  preserved + typed HEADROOM ranks machine-stable), versioned quotes
  with acceptance entries, the quote-vs-demand evaluation, and the LOCK
  14 deadline-aggregation display with PER-CONTRACT IDENTITY PRESERVED.
- `src/maintenance.ts` — the maintenance exchange display: service work
  orders from health diagnoses, the WARRANTY-AWARE eligibility standing
  against vendor terms, service matching with headroom ranks, the
  aggregated service orders (LOCK 14) with deadline pressure.
- `src/connectivity.ts` — the ADCOS boundary surfaced provider-neutrally:
  connectivity intent requests with the full Guardian decision context
  (PARKED approvals visible), status ingestion timelines with NORMALIZED
  states + machine-stable degradation.
- `src/communication.ts` — the Aurum channel surfaced METADATA-ONLY:
  the outbox + delivery ledger READ-ONLY views, the six message kinds,
  derived summaries — the AUTHORITY BOUNDARY holds.
- `src/state.ts` — the commerce-surface state machines (the procurement
  journey + the maintenance journey).

## Surface discipline (enforced by test)

- Pure functions only: no clock, no randomness, no I/O — every display
  instant (`now`) is injected by the caller; results are tagged
  `{ ok: true, view } | { ok: false, error }` and never throw.
- Frozen, JSON-serializable, tenant-scoped, machine-stable views.
- Tenant scoping at the boundary (LOCK 17); provider-neutral display
  only (LOCK 6-8, asserted by the denied-key walk in
  `test/provider-neutrality.test.ts`); read-only projections (LOCK 10,
  asserted by the exhaustive export-surface allowlist in
  `test/authority-boundary.test.ts`); per-contract identity preserved in
  aggregations (LOCK 14, asserted by the member-identity tests).

No runtime dependencies. No `any` in public signatures. Strict TS.
