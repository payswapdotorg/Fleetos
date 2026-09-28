# @fleetos/web-workloads

The WORKLOAD-PLANNING UI surface (W060C, lane C): typed, provider-neutral,
test-first view-models + state machines + surface contracts for W022
workload profiles and recommendations. A PURE TYPESCRIPT SURFACE MODULE —
not a rendered app; the shell arrives with W061 [TL].

## Ownership

Lane: `worker-c` (per `spec/worker-ownership.yaml` — `apps/web/workloads/`).

## Frozen spec source

`spec/ARCHITECTURE.md` § Workload Intelligence; `spec/ARCHITECTURE-LOCK.md`
items 3 (versioned interpretations), 6-8 (provider neutrality), 12
(hardware/software/connectivity/maintenance as first-class linked
resources), 17 (tenant isolation), 19 (UI journeys expose
architecture-level capabilities).

## The structural seams (the W040-disclosed pattern)

`src/` imports `@fleetos/contracts` ONLY. Every domain record the surface
consumes is declared in `src/seams.ts` as a FACET interface — the minimum
the display needs — and the REAL accepted domain records (W022
`WorkloadProfile` / `WorkloadRecommendation` / ledger from
`@fleetos/workloads`, W032 `SoftwareSubscription` from
`@fleetos/software`, W042 `ServiceWorkOrder` from `@fleetos/maintenance`,
W050A `ConnectivitySubmissionRecord` from `@fleetos/integration-adcos`)
are ASSIGNABLE to those facets by TypeScript structural typing. The
binding site (the W061 shell) injects the real records; `test/` is the
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
  with machine-stable linkage statuses.
- `src/state.ts` — the workload-surface state machine (typed
  views/events, frozen transition table, pure reducer).

## Surface discipline (enforced by test)

- Pure functions only: no clock, no randomness, no I/O — every timestamp
  is injected or echoed from the domain records; results are tagged
  `{ ok: true, view } | { ok: false, error }` and never throw.
- Frozen, JSON-serializable, tenant-scoped, machine-stable views.
- Tenant scoping at the boundary (the acting `TenantId` is the first
  parameter; mismatched input scopes are refused — LOCK 17).
- Read-only: no surface export mutates any FleetOS truth (asserted by
  the export-surface allowlist test in
  `apps/web/commerce/test/authority-boundary.test.ts`).

No runtime dependencies. No `any` in public signatures. Strict TS.
