/**
 * @fleetos/procurement — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS procurement/service
 * exchange (W032 D2/D3): the demand-side orchestrator for local vendor
 * fulfillment.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   demand.ts        D2 — the ProcurementDemand domain model
 *                       (consumes W022's DRAFT ProcurementIntentPayload
 *                       and unsatisfiable-candidate rejection evidence
 *                       as machine-stable matching input) + the
 *                       audit-emitting `createDemand` boundary.
 *   matching.ts      D2 — the deterministic matching engine: pure
 *                       functions, injected inputs, machine-stable
 *                       match reasons; considers workload, quantity,
 *                       deadline, location, substitutions, budget,
 *                       warranty, SLA, vendor quality and inventory.
 *   demand-store.ts  D2 — the tenant-scoped DemandStore (in-memory
 *                       reference; partitioned by tenant, W012's
 *                       TenantContext-first protocol) + the raw KV view
 *                       for W012's reusable isolation harness.
 *   quotes.ts        D3 — versioned Quote contracts (append-only ledger
 *                       with supersession — versioned-interpretation
 *                       discipline); quote acceptance as PROPOSAL-GATED
 *                       transitions (never automatic); compatible-order
 *                       aggregation before a customer deadline
 *                       (deterministic grouping; individual customer
 *                       contracts remain auditable).
 *   audit-seam.ts    D4 — the injected audit sink interface (W012's
 *                       pattern; structurally satisfied by @fleetos/audit's
 *                       sink adapter — proven by test, no cross-lane wiring).
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): the
 * matching engine PROPOSES vendor matches; the deterministic policy
 * layer (W031, Contract Guardian) remains authoritative for whether
 * an action is permitted. Nothing here creates, dispatches, or
 * executes a Fleet Intent — the demand consumes a W022 DRAFT
 * ProcurementIntentPayload (the payload shape only, no intent id, no
 * lifecycle).
 *
 * Same-lane dependencies (@fleetos/identity — TenantContext + guards;
 * @fleetos/vendors — the Vendor type for matching; @fleetos/workloads —
 * declared for the test-suite bridge that constructs a real W022
 * WorkloadRecommendation run; src/ never imports it) and the frozen
 * shared seam (@fleetos/contracts) only (`tools/check-ownership.mjs`
 * enforced). No `any` in public signatures.
 */

// D2 — Demand model + matching engine + tenant-scoped store
export * from "./demand";
export * from "./matching";
export * from "./demand-store";

// D3 — Versioned quotes + acceptance + aggregation
export * from "./quotes";

// D4 — The audit emission seam (W012's pattern)
export * from "./audit-seam";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "procurement" as const;
export const MODULE_VERSION = "0.1.0" as const;
