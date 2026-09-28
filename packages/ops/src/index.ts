/**
 * @fleetos/ops — Public API.
 *
 * The W080 [TL] PRODUCTION-READINESS package — the roadmap's FINAL
 * item: deployment manifests + PROPOSAL-gated plans (D1), fail-closed
 * operational observability (D2), backup/restore with evidence-gated
 * verification + versioned migrations with the frozen-surface guard
 * (D3), E2E journey evidence + the typed operator runbook + the
 * FAIL-CLOSED RELEASE GATE (D4) over the append-only release ledger.
 *
 * Tech-Lead owned (spec/worker-ownership.yaml). Per the frozen
 * ownership model this package's src/ imports from `@fleetos/contracts`
 * ONLY — every cross-lane edge (the REAL audit log, the REAL identity
 * TenantContext, the REAL convergence health aggregate, the REAL
 * web-shell journey vocabulary) is bound at the test/ binding sites
 * (the established W011/.../W071 pattern).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * Deterministic: no clock, no entropy, no network — every instant is
 * injected by the caller.
 *
 * Reference: `spec/ARCHITECTURE-LOCK.md` items 3, 4, 16, 18, 20;
 * `spec/work-items/WORK-ITEM-CATALOG.md` § W080; PROJECT-STATE § W080.
 */

// D1 — deployment
export * from "./deployment";

// D2 — observability
export * from "./observability";

// D3 — backup/restore + migrations
export * from "./backup";
export * from "./migrations";

// D4 — E2E evidence, runbook, release gate
export * from "./evidence";
export * from "./runbook";
export * from "./release-gate";

// W001 placeholder markers (the skeleton convention; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "ops" as const;
export const MODULE_VERSION = "0.1.0" as const;
