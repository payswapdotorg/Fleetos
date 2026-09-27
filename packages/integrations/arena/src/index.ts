/**
 * @fleetos/integration-arena — Public API.
 *
 * Lane B (worker-b) implementation of the FleetOS Arena adapter
 * (W050B): typed, provider-neutral evaluation-case submission and
 * certified-capability adoption through the Arena contract. Arena owns
 * capability learning/certification; FleetOS owns operational adoption
 * (`spec/ARCHITECTURE-LOCK.md` item 9). FleetOS never treats an
 * uncertified model output as action permission (the ARENA.md
 * invariant — enforced by D3's fail-closed certification boundary).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   audit-seam.ts             D4 — the injected audit sink interface
 *                                (W011/W021/W022/W031/W032/W040/W041's
 *                                pattern; structurally satisfied by
 *                                @fleetos/audit's sink adapter — proven
 *                                by test).
 *   policy-seam.ts            D1a — the injected Contract Guardian
 *                                evaluation seam (structurally satisfied
 *                                by @fleetos/policy's
 *                                evaluateGuardianRequest, injected at
 *                                the binding site — proven by test
 *                                against the real engine).
 *   certification-boundary.ts D3 — the fail-closed certification
 *                                boundary (the ARENA.md invariant):
 *                                capability metadata lacking a valid
 *                                certification reference is refused with
 *                                machine-stable reasons; uncertified
 *                                model output NEVER becomes action
 *                                permission (asserted by test).
 *   evaluation-case.ts        D1 — typed, provider-neutral evaluation
 *                                case submission: problem class,
 *                                normalized observation refs, context,
 *                                action history refs, outcome,
 *                                evaluation labels, tenant policy refs,
 *                                redaction/de-identification state —
 *                                submission PROPOSAL-gated through the
 *                                W031 Guardian decision model
 *                                (REQUIRE_APPROVAL parks, BLOCK rejects,
 *                                never auto-submit); deterministic case
 *                                ids; append-only submission ledger.
 *   capability-adoption.ts    D2 — typed adoption records from Arena's
 *                                certified capability metadata
 *                                (capability ID/version, certification
 *                                reference, FleetOS compatibility
 *                                statement, evaluation-suite revision,
 *                                rollout policy, cohort, rollback
 *                                version) — versioned append-only
 *                                records with supersession discipline;
 *                                adoption is an EXPLICIT PROPOSAL-gated
 *                                transition (never automatic).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian in `@fleetos/policy`) remains the
 * sole authority for evaluation-case submission — REQUIRE_APPROVAL
 * parks, BLOCK rejects, and NOTHING here auto-submits. Adoption is
 * PROPOSAL-gated through the D3 fail-closed certification boundary —
 * uncertified metadata is refused; there is NO path from raw model
 * output to an adoption record (asserted by test).
 *
 * Cross-lane domain types come from @fleetos/contracts only; the
 * structural seams (audit sink, Guardian evaluator, tenant scope)
 * declared LOCALLY are structurally satisfied by the real packages at
 * the binding site. No `any` in public signatures.
 */

// D4 — the audit emission seam (W011/W021/W022/W031/W032/W040/W041's pattern)
export * from "./audit-seam";

// D1a — the injected Contract Guardian evaluation seam
export * from "./policy-seam";

// D3 — the fail-closed certification boundary (the ARENA.md invariant)
export * from "./certification-boundary";

// D1 — typed, provider-neutral evaluation-case submission
export * from "./evaluation-case";

// D2 — certified-capability adoption (versioned append-only, supersession)
export * from "./capability-adoption";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { ArenaTenantScope } from "./internal";
export { checkArenaTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "integration-arena" as const;
export const MODULE_VERSION = "0.1.0" as const;
