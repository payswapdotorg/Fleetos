/**
 * @fleetos/software — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS software subscription
 * contracts (W032 D4): subscription allocation with seats/terms,
 * versioned subscription records, deterministic allocation rules.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   subscription.ts   D4 — the SoftwareSubscription domain model
 *                        (consumes W022's DRAFT
 *                        SoftwareSubscriptionIntentPayload), the
 *                        deterministic allocation engine, the
 *                        audit-emitting `createSubscription` boundary,
 *                        and the pure `reviseSubscription` builder.
 *   audit-seam.ts     D4 — the injected audit sink interface (W012's
 *                        pattern; structurally satisfied by
 *                        @fleetos/audit's sink adapter — proven by
 *                        test, no cross-lane wiring).
 *   store.ts          D4 — the tenant-scoped SubscriptionStore (in-memory
 *                        reference; partitioned by tenant, W012's
 *                        TenantContext-first protocol), the raw KV
 *                        view for W012's reusable isolation harness,
 *                        and the AUDITED service boundary (subscription
 *                        allocated/revised emit to an injected sink).
 *   reconciliation.ts W072 D2 — subscription commercial
 *                        reconciliation: a READ-ONLY report pass over
 *                        subscription -> agreed terms -> provision
 *                        evidence chains consumed structurally (the
 *                        SubscriptionChainFacts twin is satisfiable by
 *                        the REAL SoftwareSubscription record);
 *                        discrepancies classify machine-stably with the
 *                        W072 five-kind vocabulary (price_mismatch,
 *                        sla_breach, warranty_gap, undelivered,
 *                        over_delivered) with the refs of BOTH sides
 *                        verbatim; never a mutation path.
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): the
 * allocation engine PROPOSES subscriptions; the deterministic policy
 * layer (W031, Contract Guardian) remains authoritative for whether
 * an allocation is permitted. The subscription consumes a W022 DRAFT
 * SoftwareSubscriptionIntentPayload (the payload shape only — no
 * intent id, no lifecycle).
 *
 * Same-lane dependencies (@fleetos/identity — TenantContext + guards;
 * @fleetos/workloads — declared for the test-suite bridge that
 * constructs a real W022 WorkloadRecommendation run; src/ never imports
 * it) and the frozen shared seam (@fleetos/contracts) only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// D4 — SoftwareSubscription contracts + allocation engine
export * from "./subscription";

// D4 — The audit emission seam (W012's pattern)
export * from "./audit-seam";

// D4 — The tenant-scoped store + the audited service boundary
export * from "./store";

// W072 D2 — Subscription commercial reconciliation (READ-ONLY report surface)
export * from "./reconciliation";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "software" as const;
export const MODULE_VERSION = "0.1.0" as const;
