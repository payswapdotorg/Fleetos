/**
 * @fleetos/contracts — Public API.
 *
 * The FleetOS shared seam. Workers import types and pure helpers from
 * here; they do NOT import each other's internals (see
 * `tools/check-ownership.mjs`).
 *
 * W001 established the placeholder. W002 fills it with the real
 * contracts: branded IDs, tenant scoping, event/command/intent envelopes,
 * device lifecycle, observation batch, Contract Guardian decision,
 * error taxonomy, and versioning primitives.
 *
 * Cross-lane types live here. Adding a new public contract requires a
 * Tech-Lead ADR (`spec/worker-ownership.yaml` rule:
 * `shared_contract_changes_require_tech_lead`).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 *
 * Reference: `spec/ARCHITECTURE.md` § Canonical model, § Intent model,
 * § Device adapters, § Contract Guardian; `spec/ARCHITECTURE-LOCK.md`
 * items 2-4, 6-7, 11; `spec/MODULE-DEPENDENCY-MAP.md`.
 */

// D1 — Identification & tenancy
export * from "./ids";
export * from "./tenant";

// D2 — Event envelope & tracing
export * from "./events";

// D3 — Commands, idempotency & intents
export * from "./commands";
export * from "./intents";

// D4 — Device, observation & policy contracts
export * from "./device";
export * from "./observations";
export * from "./policy";

// D5 — Errors & versioning
export * from "./errors";
export * from "./versioning";

// W001 placeholder markers (kept for backward compatibility with the
// 21 baseline tests; real contracts are the exports above).
export const MODULE_NAME = "contracts" as const;
export const MODULE_VERSION = "0.1.0" as const;
