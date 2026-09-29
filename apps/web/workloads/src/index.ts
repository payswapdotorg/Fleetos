/**
 * @fleetos/web-workloads — Public API.
 *
 * Lane C (worker-c) implementation of the WORKLOAD-PLANNING UI surface
 * (W060C item 1): typed, provider-neutral, test-first view-models +
 * state machines + surface contracts for W022 workload profiles and
 * recommendations. This is a PURE TYPESCRIPT SURFACE MODULE — not a
 * rendered app; the shell arrives with W061 [TL].
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected or echoed from domain records):
 *
 *   seams.ts           The STRUCTURAL seams (the W040-disclosed pattern):
 *                      facet interfaces for the W022 WorkloadProfile /
 *                      WorkloadRecommendation / ledger, and the LOCK 12
 *                      first-class linked resources (hardware,
 *                      software, connectivity, maintenance). src/ imports
 *                      @fleetos/contracts ONLY; the real domain records
 *                      are injected at the binding site and proven
 *                      assignable by the test suite (test/ may import
 *                      across lanes).
 *   listing.ts         The workload-profile LISTING view: deterministic
 *                      rows (workloadId order), requirement highlights
 *                      (value desc, name asc tie-break), constraint
 *                      counts, evidence coverage, working hours.
 *   recommendations.ts The versioned READ-ONLY recommendation display:
 *                      derived statuses (ACTIVE/SUPERSEDED/DISMISSED —
 *                      the versioned-interpretation discipline), fit
 *                      evidence (soft score + hard gate, machine-stable
 *                      failure kinds), DRAFT intent proposals as
 *                      read-only descriptors, supersession lineages.
 *   resources.ts       The LOCK 12 resource-linkage surface: hardware /
 *                      software / connectivity / maintenance as
 *                      first-class linked resources with machine-stable
 *                      linkage statuses derived from each resource's own
 *                      domain state.
 *   state.ts           The workload-surface state machine: typed
 *                      views/events, the frozen transition table, and
 *                      the pure reducer with machine-stable
 *                      `illegal_event` refusals (ARCHITECTURE-LOCK 19).
 *
 * Surface discipline (enforced by test):
 *   - Every builder is a pure function; results are tagged
 *     `{ ok: true, view } | { ok: false, error }` — never throws.
 *   - Every view is frozen, JSON-serializable, tenant-scoped, and
 *     machine-stable (deterministic order + rendering).
 *   - Tenant scoping at the boundary: the acting TenantId is the first
 *     parameter; mismatched input scopes are refused (LOCK 17).
 *   - Provider-neutral display only: no provider topology, credentials,
 *     or SDK objects ever appear in a view (LOCK 6-8) — the connectivity
 *     seam deliberately excludes the provider handle.
 *   - Read-only: no surface export mutates any FleetOS truth.
 */

// The structural seams (the W040-disclosed pattern)
export * from "./seams";

// The workload-profile listing surface
export * from "./listing";

// The versioned read-only recommendation display
export * from "./recommendations";

// The LOCK 12 resource-linkage surface
export * from "./resources";

// The workload-surface state machine
export * from "./state";

// W090C D3 — the composite workload -> software -> procurement ->
// VERIFIED-connectivity journey view-model + navigation machine
export * from "./journey";

// W090C — the local console design tokens + status vocabulary
export * from "./ui/tokens";
export * from "./ui/status";

// W090C — the local shadcn-style component vocabulary (plain React + CSS)
export * from "./ui/primitives";

// W090C D1 — the rendered workload-planning screen (presentational,
// fully controlled)
export * from "./screens/workload-planning-screen";

// Module markers (the workspace convention).
export const MODULE_NAME = "web-workloads" as const;
export const MODULE_VERSION = "0.1.0" as const;
