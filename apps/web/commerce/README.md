# @fleetos/web-commerce

The COMMERCE + CONNECTIVITY RENDERED CONSOLE (W090C, lane C) over the
W060C pure view-models: six fully controlled PRESENTATIONAL React
screens — Procurement, Software, Vendors, Maintenance, Connectivity,
Communication — plus the verification/outcome view-models that close
the 🟡 journey gaps, the local console design tokens + nine-state
status vocabulary, and the local shadcn-style component primitives.

The W060C layer (pure view-models + state machines + surface contracts
for the W032 procurement exchange, the W042 maintenance exchange, the
W050A ADCOS connectivity boundary, and the W050C Aurum communication
channel) is unchanged in its discipline: business truth stays in the
VIEW-MODELS; React only renders. No Next.js here — the runtime/shell/
routing is W091 [TL].

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml` — `apps/web/commerce/`).

## Frozen spec source

`spec/ARCHITECTURE-LOCK.md` items 6-8 (provider neutrality; ADCOS/Arena/
Aurum through provider-neutral contracts), 10 (Aurum is a communication
channel; FleetOS remains operational authority), 13 (procurement is an
exchange/matching problem), 14 (deadlines may drive compatible order
aggregation without erasing contract identity), 17 (tenant isolation),
19 (UI journeys expose architecture-level capabilities); the binding
design contract `spec/ui/CONSOLE-DESIGN.md`; `spec/procurement/
PROCUREMENT-EXCHANGE.md`; `spec/integration/ADCOS.md`;
`spec/integration/AURUM.md`.

## The structural seams (the W040-disclosed pattern)

`src/` imports `@fleetos/contracts` + `react` ONLY (the screens render;
they never touch a provider SDK or a domain internal). Every domain
record the surface consumes is declared in `src/seams.ts` as a FACET
interface — the minimum the display needs — and the REAL accepted
domain records (W032 `ProcurementDemand` / `VendorMatch` / `Quote` /
`QuoteLedger` / `AggregatedOrder` from `@fleetos/procurement`, `Vendor`
from `@fleetos/vendors`, `SoftwareSubscription` from `@fleetos/software`,
W042 `ServiceWorkOrder` / `ServiceVendorMatch` / `AggregatedServiceOrder`
from `@fleetos/maintenance`, W050A `ConnectivitySubmissionRecord` /
`ConnectivityRecord` from `@fleetos/integration-adcos`, W050C
`OutboxEntry` / `DeliveryRecord` from `@fleetos/integration-aurum`) are
ASSIGNABLE to those facets by TypeScript structural typing. The binding
site (the W091 shell) injects the real records; `test/` is the runtime
proof (the ownership gate permits cross-lane imports in `test/` only).

Provider-neutrality is enforced at the SEAM level: the ADCOS facets
EXCLUDE the opaque provider handle, the provider refusal DETAIL (the
machine-stable refusal REASON is surfaced), and every provider
topology/credential field (LOCK 6-8); the Aurum facets EXCLUDE the
provider's own message handle (`providerMessageId` — LOCK 10
metadata-only). The rendered markup is swept by test.

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
- `src/outcomes.ts` — the W090C verification + outcome view-models
  (PURE): the W072 vendor scorecards + marketplace evidence packs, the
  VERIFIED maintenance outcomes, the order + entitlement reconciliations,
  the D3 software needs, the per-device fleet connectivity status, and
  the entitlement lifecycle derivation (allocated/expiring/expired over
  the injected `now`).
- `src/ui/tokens.tsx` — the local console design tokens (warm neutrals,
  graphite text, hairlines, modest radii; reduced-motion respected) —
  byte-consistent with the cross-lane W091 template.
- `src/ui/status.ts` — the nine-state console vocabulary + the
  machine-stable domain → console mappings (never color-alone).
- `src/ui/primitives.tsx` — the local shadcn-style primitives (Button,
  Badge, Card, Table, Tabs, Sheet, Dialog, Dropdown, Breadcrumb,
  Tooltip, Skeleton, EmptyState, AlertError, Timeline,
  StatusIndicator, Stepper, DefinitionList, Field, CheckField) —
  plain React + CSS variables, zero external UI dependencies.
- `src/screens/commerce-shared.tsx` — the composite-journey rail (D3;
  structurally compatible with the workload lane's rail) + the
  CONSEQUENTIAL-ACTION authorization card (authorization state, policy
  decision, approval requirement, expected effect, evidence required,
  execution state, verification result — a proposal is NEVER presented
  as an executed action).
- `src/screens/procurement-screen.tsx` — request → quote (Acme-style) →
  acceptance-as-approval → verified orders; the LOCK 14 orders card.
- `src/screens/software-screen.tsx` — catalog + entitlements with the
  lifecycle states (allocated/expiring/expired), the D3 software needs,
  the provision-verified outcome.
- `src/screens/vendors-screen.tsx` — vendor records + W072 scorecards +
  PROPOSAL-grade evidence packs, strictly read-only.
- `src/screens/maintenance-screen.tsx` — work order → service matching →
  aggregated service orders (LOCK 14 identity) → the VERIFIED measured
  outcome — the 🟡 "stops before verified" gap closed.
- `src/screens/connectivity-screen.tsx` — per-device fleet status, the
  intent-request inbox with the Guardian decision context, the adopted
  timelines with the VERIFIED outcome + measurements.
- `src/screens/communication-screen.tsx` — the Aurum outbox + delivery
  OUTCOME views with visible metadata (LOCK 10).

## Surface discipline (enforced by test)

- The W060C view-model layer: pure functions only — no clock, no
  randomness, no I/O; every display instant (`now`) is injected by the
  caller; results are tagged `{ ok: true, view } | { ok: false, error }`
  and never throw; frozen, tenant-scoped, machine-stable.
- The W090C render layer: PRESENTATIONAL + FULLY CONTROLLED — props in,
  events out; no business truth in React state; the same props render
  byte-identical static markup (asserted by `renderToStaticMarkup`).
- Tenant scoping at the boundary (LOCK 17); provider-neutral display
  only (LOCK 6-8, asserted by the denied-key walk in
  `test/provider-neutrality.test.ts` AND the rendered-markup sweep);
  read-only projections (LOCK 10, asserted by the exhaustive
  export-surface allowlist in `test/authority-boundary.test.ts`);
  per-contract identity preserved in aggregations (LOCK 14).
- Browser-level render tests (`test/render-screens.test.tsx` +
  `test/render-helpers.ts`): text content, roles, labels, landmarks,
  keyboard navigation, exact empty/loading/error/invalid states,
  approval/blocked semantics, determinism, a11y stylesheet assertions —
  all over REAL domain records built with the REAL same-lane builders,
  including the REAL workload-lane composite journey rail (D3).

Runtime dependencies: `@fleetos/contracts` + the declared same-lane
workspace domain packages. React + the testing stack live in
devDependencies (the W090A/W090B precedent). No `any` in public
signatures. Strict TS.
