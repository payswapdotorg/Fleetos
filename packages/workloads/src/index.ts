/**
 * @fleetos/workloads — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS workload profiles +
 * recommendation contracts (W022).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   profile.ts            D1 — the WorkloadProfile domain model:
 *                           role/process identity, requirement
 *                           description, tenant scoping (TenantScoped
 *                           from the frozen contracts), and IMMUTABLE
 *                           versioned revisions (updates create
 *                           revision+1 with a deterministic content
 *                           hash; the prior revision is never
 *                           rewritten).
 *   requirement-vector.ts D2 — the RequirementVector: ten typed,
 *                           unit-normalized comparable dimensions
 *                           (W011's anchor-normalization pattern),
 *                           validation, comparison and diff helpers as
 *                           pure functions. No ML.
 *   constraints.ts        D2 — the hard gates: discrete constraint
 *                           checking (application set/versions,
 *                           environments where lawful, peripherals,
 *                           security classification ceiling) and the
 *                           combined FitAssessment. Pure functions.
 *   observed-factors.ts   obs — the observations module-map edge:
 *                           deterministic derivation of observed factor
 *                           samples from canonical `device.workload`
 *                           observations (frozen contracts shapes) and
 *                           p90 nearest-rank aggregation into a
 *                           requirement vector. Forward-compatible skip
 *                           reasons, never errors.
 *   store.ts              D1/D4 — the tenant-scoped WorkloadProfileStore
 *                           (in-memory reference; partitioned by tenant,
 *                           W012's TenantContext-first protocol), the
 *                           raw KV view for W012's reusable isolation
 *                           harness, and the AUDITED service boundary
 *                           (profile created/revised emit to an
 *                           injected sink).
 *   recommendations.ts    D3 — versioned WorkloadRecommendation
 *                           contracts: PROPOSALS (never automatic) with
 *                           fit evidence, confidence, evidence links and
 *                           DRAFT Fleet Intent payloads
 *                           (ProcurementIntent /
 *                           SoftwareSubscriptionIntent from the frozen
 *                           contracts — no intent id, no lifecycle); the
 *                           append-only per-workload recommendation
 *                           ledger; and the deterministic
 *                           `recommendForProfile` engine with injected
 *                           inputs.
 *   audit-seam.ts         D4 — the injected audit sink interface
 *                           (W012's pattern; structurally satisfied by
 *                           @fleetos/audit's sink adapter — proven by
 *                           test, no cross-lane wiring).
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): this
 * engine PROPOSES device classes and procurement/software actions; the
 * deterministic policy layer (W031, Contract Guardian) remains
 * authoritative for whether anything is permitted. Nothing here creates,
 * dispatches, or executes a Fleet Intent.
 *
 * Same-lane dependencies (@fleetos/identity — TenantContext + guards)
 * and the frozen shared seam (@fleetos/contracts) only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// D2 — Requirement vectors (soft score) + constraints (hard gates)
export * from "./requirement-vector";
export * from "./constraints";

// The observations module-map edge (observed factors)
export * from "./observed-factors";

// D1 — The WorkloadProfile domain model
export * from "./profile";

// D4 — The audit emission seam (W012's pattern)
export * from "./audit-seam";

// D1/D4 — The tenant-scoped store + the audited service boundary
export * from "./store";

// D3 — Versioned recommendations + ledger + engine
export * from "./recommendations";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "workloads" as const;
export const MODULE_VERSION = "0.1.0" as const;
