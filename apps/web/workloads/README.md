# @fleetos/web-workloads

The WORKLOAD-PLANNING RENDERED CONSOLE (W090C, lane C) over the W060C
pure view-models: the fully controlled PRESENTATIONAL React
WorkloadPlanningScreen (profiles, versioned recommendations as
read-only record views, LOCK 12 capacity signals, the journey rail)
plus the composite workload → software → procurement → VERIFIED
connectivity journey view-model + navigation machine (D3).

The W060C layer (pure view-models + state machines + surface contracts
for W022 workload profiles and recommendations) is unchanged in its
discipline: business truth stays in the VIEW-MODELS; React only
renders. No Next.js here — the runtime/shell/routing is W091 [TL].

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml` — `apps/web/workloads/`).

## Frozen spec source

`spec/ARCHITECTURE-LOCK.md` items 3 (versioned interpretations), 6-8
(provider neutrality), 12 (hardware/software/connectivity/maintenance
as first-class linked resources), 17 (tenant isolation), 19 (UI journeys
expose architecture-level capabilities); the binding design contract
`spec/ui/CONSOLE-DESIGN.md`.

## The structural seams (the W040-disclosed pattern)

`src/` imports `@fleetos/contracts` + `react` ONLY (the screen renders;
it never touches a provider SDK or a domain internal). Every domain
record the surface consumes is declared in `src/seams.ts` as a FACET
interface — the minimum the display needs — and the REAL accepted
domain records (W022 `WorkloadProfile` / `WorkloadRecommendation` /
ledger from `@fleetos/workloads`, W032 `SoftwareSubscription` from
`@fleetos/software`, W042 `ServiceWorkOrder` from `@fleetos/maintenance`,
W050A `ConnectivitySubmissionRecord` from `@fleetos/integration-adcos`)
are ASSIGNABLE to those facets by TypeScript structural typing. The
binding site (the W091 shell) injects the real records; `test/` is the
runtime proof (the ownership gate permits cross-lane imports in `test/`
only). The connectivity facet deliberately EXCLUDES the opaque provider
handle and every provider topology/credential field (LOCK 6-8).

## Module map

- `src/seams.ts` — the structural facets + the LOCK 12 resource kinds.
- `src/listing.ts` — the workload-profile LISTING view (deterministic
  rows, requirement highlights, constraint counts, evidence coverage).
- `src/recommendations.ts` — the versioned READ-ONLY recommendation
  display (derived statuses, fit evidence, DRAFT intent proposals as
  read-only descriptors, supersession lineages).
- `src/resources.ts` — the LOCK 12 resource-linkage surface: hardware /
  software / connectivity / maintenance as first-class linked resources
  with machine-stable linkage statuses (PARKED → Approval required;
  REJECTED → Blocked).
- `src/state.ts` — the workload-surface state machine (typed
  views/events, frozen transition table, pure reducer).
- `src/journey.ts` — the W090C D3 composite journey view-model + the
  pure navigation machine: workload plan recommendation → software
  need → procurement request → quote & acceptance → connectivity
  request → VERIFIED connectivity (ACTIVE + measurements + no failure),
  with shell route targets per stage and machine-stable
  `illegal_event` refusals.
- `src/ui/tokens.tsx` — the local console design tokens (warm neutrals,
  graphite text, hairlines, modest radii; reduced-motion respected) —
  byte-consistent with the cross-lane W091 template.
- `src/ui/status.ts` — the nine-state console vocabulary + the
  machine-stable domain → console mappings (never color-alone).
- `src/ui/primitives.tsx` — the local shadcn-style primitives — plain
  React + CSS variables, zero external UI dependencies.
- `src/screens/workload-planning-screen.tsx` — the rendered planning
  screen: the profile list, the record-pattern profile detail (summary
  → current state → why it matters → recommended action → evidence →
  history), the recommendation record view (proposals NEVER presented
  as executed), the capacity signals, and the journey rail.

## Surface discipline (enforced by test)

- The W060C view-model layer: pure functions only — no clock, no
  randomness, no I/O; every timestamp is injected or echoed from the
  domain records; results are tagged `{ ok: true, view } | { ok: false,
  error }` and never throw; frozen, tenant-scoped, machine-stable.
- The W090C render layer: PRESENTATIONAL + FULLY CONTROLLED — props in,
  events out; no business truth in React state; the same props render
  byte-identical static markup (asserted by `renderToStaticMarkup`).
- Tenant scoping at the boundary (the acting `TenantId` is the first
  parameter; mismatched input scopes are refused — LOCK 17).
- Read-only: no surface export mutates any FleetOS truth (asserted by
  the export-surface allowlist test in
  `apps/web/commerce/test/authority-boundary.test.ts`).
- Browser-level render tests (`test/render-screens.test.tsx`) +
  composite-journey tests (`test/journey-view.test.ts`, REAL domain
  builders from `@fleetos/workloads` / `@fleetos/software` /
  `@fleetos/procurement`, plus the binding-site type proofs).

Runtime dependencies: `@fleetos/contracts` + the declared same-lane
workspace domain packages. React + the testing stack live in
devDependencies (the W090A/W090B precedent). No `any` in public
signatures. Strict TS.

## W100C — role lens + the full journey

Wave 9 added `src/role-lens.ts` (the role-aware workload projection for
asset.manager / team.manager / employee / vendor.operator — emphasis
ordering, role copy, and machine-stable capability notices with
escalation paths; PRESENTATION ONLY, structurally permission-free) and
extended `src/journey.ts` to the full eight-stage
workload -> software -> procurement -> vendor -> maintenance ->
connectivity journey (the vendor-selection and maintenance-service
stages route to the existing commerce.vendors / commerce.maintenance
shell views). The rendered screen gained the optional `roleLens` band.
