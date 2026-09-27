/**
 * @fleetos/maintenance — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS maintenance exchange
 * (W042 D1-D5): the demand-side orchestrator for local vendor
 * fulfillment of maintenance service work orders derived from health
 * diagnoses/treatment recommendations.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   service-work-order.ts  D1 — the ServiceWorkOrder domain model
 *                                (consumes W021's DRAFT
 *                                MaintainDeviceIntentPayload + diagnosis
 *                                evidence as machine-stable injected input;
 *                                versioned records (append-only revisions);
 *                                warranty-aware (warranty eligibility as
 *                                typed rules against vendor terms from
 *                                @fleetos/vendors); replacement-escalation
 *                                linkage to ReplacementIntent (frozen
 *                                payload shape — DRAFT only, no intent
 *                                lifecycle)) + the audit-emitting
 *                                `createServiceWorkOrder` /
 *                                `reviseServiceWorkOrder` boundaries.
 *   matching.ts            D2 — the deterministic service matching
 *                                engine: pure function, injected inputs,
 *                                machine-stable match reasons; considers
 *                                region, capability, deadline, availability,
 *                                SLA, warranty, quality; ranks vendors
 *                                on quality/SLA/warranty headrooms.
 *   aggregation.ts         D3 — compatible service order aggregation before
 *                                a customer deadline (deterministic
 *                                grouping; member work order ids sorted;
 *                                individual customer contracts remain
 *                                auditable — every batch traces to its
 *                                members); aggregation as PROPOSAL (never
 *                                automatic dispatch).
 *   store.ts               D4 — the tenant-scoped ServiceWorkOrderStore
 *                                (in-memory reference; partitioned by
 *                                tenant, W012's TenantContext-first
 *                                protocol) + the raw KV view for W012's
 *                                reusable isolation harness.
 *   audit-seam.ts          D4 — the injected audit sink interface (W012's
 *                                pattern; structurally satisfied by
 *                                @fleetos/audit's sink adapter — proven
 *                                by test, no cross-lane wiring in src/).
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): the
 * matching engine PROPOSES vendor matches; the deterministic policy
 * layer (W031, Contract Guardian) remains authoritative for whether
 * an action is permitted. Nothing here creates, dispatches, or
 * executes a Fleet Intent — the work order consumes a W021 DRAFT
 * MaintainDeviceIntentPayload (the payload shape only, no intent id,
 * no lifecycle); the replacement-escalation linkage carries a DRAFT
 * ReplacementIntentPayload (frozen shape — DRAFT only, no intent id).
 *
 * Same-lane dependencies (@fleetos/identity — TenantContext + guards;
 * @fleetos/vendors — the Vendor type for matching; @fleetos/contracts —
 * the frozen shapes; @fleetos/audit, @fleetos/health, @fleetos/workloads
 * declared for the test-suite bridge — src/ never imports them) and
 * the frozen shared seam (`tools/check-ownership.mjs` enforced).
 * No `any` in public signatures.
 */

// D1 — Service work order model + boundary
export * from "./service-work-order";

// D2 — Service matching engine
export * from "./matching";

// D3 — Deadline aggregation
export * from "./aggregation";

// D4 — Tenant-scoped store + W012 isolation-harness view
export * from "./store";

// D4 — The audit emission seam (W012's pattern)
export * from "./audit-seam";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "maintenance" as const;
export const MODULE_VERSION = "0.1.0" as const;
