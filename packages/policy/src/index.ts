/**
 * @fleetos/policy — Public API.
 *
 * Lane B (worker-b) implementation of the FleetOS Contract Guardian
 * (W031 D2-D4): the evaluation rule model, the deterministic evaluation
 * engine, and the tenant-scoped rule-set store.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   rule-model.ts  D2 — the typed rule inputs (principal, device,
 *                     workload, data classification, contract/obligation,
 *                     destination, network, printer, time, geography,
 *                     action — every facet an OBSERVABLE fact, no intent
 *                     input anywhere), versioned rules with deterministic
 *                     ids, and versioned rule sets compiled in
 *                     deterministic ruleId order.
 *   engine.ts      D3 — deterministic evaluation of a request against a
 *                     rule set producing the FROZEN GuardianDecision
 *                     shape from @fleetos/contracts (via the frozen
 *                     makeGuardianDecision constructor; decision types
 *                     reused, never re-declared). Blocking precedence
 *                     BLOCK > REQUIRE_APPROVAL > WARN > ALLOW; machine-
 *                     stable reasons; observable-evidence links; pure
 *                     (injected clock/inputs).
 *   rule-store.ts  D4 — the tenant-scoped, append-only-per-version rule
 *                     set store (partitioned by construction; the
 *                     runtime guard rejects context-free access even
 *                     when the types are bypassed).
 *   audit-seam.ts  D4 — the injected audit sink interface (W011/W021/
 *                     W022's pattern; structurally satisfied by
 *                     @fleetos/audit's sink adapter — proven by test).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the Guardian IS the
 * deterministic policy layer — it decides whether an action is
 * permitted; it never executes anything. REQUIRE_APPROVAL holds for
 * human approval; BLOCK refuses. Approvals/execution belong to later
 * waves (W041 Fleet Actions).
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// The audit emission seam (W011/W021/W022's pattern)
export * from "./audit-seam";

// D2 — the rule model (typed rule inputs, versioned rules + rule sets,
// the tenant-scope guard)
export * from "./rule-model";

// D3 — the deterministic evaluation engine
export * from "./engine";

// D4 — the tenant-scoped rule-set store
export * from "./rule-store";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "policy" as const;
export const MODULE_VERSION = "0.1.0" as const;
