/**
 * @fleetos/vendors — Public API.
 *
 * Lane C (worker-c) implementation of the FleetOS vendor model (W032 D1):
 * local fulfillment providers — vendor identity, capability
 * declarations, inventory signals, and quality/SLA/warranty terms as
 * typed comparable values.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   vendor.ts        D1 — the Vendor domain model: identity (tenant-
 *                        scoped), capability declarations (device
 *                        classes, services, regions), inventory
 *                        signals (availability, lead time), and
 *                        quality/SLA/warranty terms as typed comparable
 *                        values. Versioned vendor records (append-only
 *                        revisions).
 *   audit-seam.ts    D4 — the injected audit sink interface (W012's
 *                        pattern; structurally satisfied by @fleetos/audit's
 *                        sink adapter — proven by test, no cross-lane wiring).
 *   store.ts         D1/D4 — the tenant-scoped VendorStore (in-memory
 *                        reference; partitioned by tenant, W012's
 *                        TenantContext-first protocol), the raw KV view for
 *                        W012's reusable isolation harness, and the
 *                        AUDITED service boundary (vendor created/revised
 *                        emit to an injected sink).
 *
 * Decision boundary (`spec/ARCHITECTURE.md` § Decision boundary): FleetOS
 * is the demand-side orchestrator; local vendors own inventory, pricing
 * and fulfillment. The vendor model records what a vendor can do; the
 * matching engine (W032 D2 in `@fleetos/procurement`) ranks vendors
 * against demand deterministically.
 *
 * Same-lane dependencies (@fleetos/identity — TenantContext + guards)
 * and the frozen shared seam (@fleetos/contracts) only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// D1 — The Vendor domain model
export * from "./vendor";

// D4 — The audit emission seam (W012's pattern)
export * from "./audit-seam";

// D1/D4 — The tenant-scoped store + the audited service boundary
export * from "./store";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "vendors" as const;
export const MODULE_VERSION = "0.1.0" as const;
