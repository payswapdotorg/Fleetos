/**
 * @fleetos/learning — Public API.
 *
 * Lane B (worker-b) implementation of the FleetOS learning/evaluation
 * loop (W070): the closed loop that converts FLEET OUTCOMES into Arena
 * evaluation cases and capability adoption records. Arena owns
 * capability learning/certification; FleetOS owns operational adoption
 * (`spec/ARCHITECTURE-LOCK.md` item 9).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller; src/ imports
 * `@fleetos/contracts` ONLY — every domain surface is consumed through
 * STRUCTURAL seams with the real packages injected at binding sites and
 * proven by test, the W040-disclosed pattern):
 *
 *   audit-seam.ts           D4 — the injected audit sink interface
 *                             (the W011/W021/W022/W031/W032/W040/W041/
 *                             W050B pattern; structurally satisfied by
 *                             @fleetos/audit's sink adapter — proven by
 *                             test into the REAL hash-chained log).
 *   outcome-observation.ts  D1 — typed, provider-neutral OUTCOME
 *                             observation records derived from the four
 *                             established domain surfaces via structural
 *                             seams: health treatment outcomes (W021
 *                             recommendations accepted/dismissed), action
 *                             plan outcomes (W041 terminal transitions),
 *                             delivery outcomes (W050C aurum delivery
 *                             metadata), maintenance work-order outcomes
 *                             (W042). Every observation carries tenant
 *                             scope, subject ref, ground-truth
 *                             label/value, evidence refs, and an INJECTED
 *                             observedAt instant; the tenant-partitioned
 *                             append-only store + the audited recording
 *                             boundary.
 *   evaluation-conversion.ts D2 — pure conversion of outcome
 *                             observations into Arena evaluation-case
 *                             SUBMISSION PROPOSALS (the W050B submission
 *                             shapes consumed through a structural seam:
 *                             problem class, normalized observation refs,
 *                             context, action history refs, outcome
 *                             ground truth, evaluation labels, tenant
 *                             policy refs, typed redaction state).
 *                             Deterministic; REFUSES machine-stably when
 *                             an outcome lacks required ground truth
 *                             (never fabricating labels). PROPOSAL-gated:
 *                             the frozen GuardianDecision seam gates
 *                             submission ALLOW/WARN -> PROPOSED,
 *                             REQUIRE_APPROVAL -> PARKED, BLOCK ->
 *                             REJECTED — the conversion NEVER submits.
 *   adoption-ledger.ts      D3 — the versioned append-only capability
 *                             adoption ledger derived from certified
 *                             capability metadata (the W050B adoption
 *                             boundary consumed structurally): proposals
 *                             carry the human approver id + approved-at
 *                             instant (the explicit grant); supersession
 *                             discipline (a new version cites the prior;
 *                             the prior is never rewritten); FAIL-CLOSED
 *                             certification boundary — uncertified or
 *                             malformed capability metadata is refused
 *                             machine-stably and NEVER becomes an
 *                             adoption record.
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian) remains the sole authority for
 * evaluation-case submission — the gate consumes the FROZEN
 * `GuardianDecision` and NOTHING here auto-submits. Adoption is
 * PROPOSAL-gated through the fail-closed certification boundary —
 * uncertified metadata is refused; there is NO path from raw model
 * output to an adoption record.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the
 * structural seams (audit sink, domain facets, tenant scope) declared
 * LOCALLY are structurally satisfied by the real packages at the
 * binding sites (proven by test). No `any` in public signatures.
 */

// D4 — the audit emission seam (the W011/W021/W031/W050B pattern)
export * from "./audit-seam";

// D1 — outcome observations + the four structural seams + the store
export * from "./outcome-observation";

// D2 — evaluation-case conversion + the Guardian-gated proposals
export * from "./evaluation-conversion";

// D3 — the fail-closed certification boundary + the adoption ledger
export * from "./adoption-ledger";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { LearningTenantScope } from "./internal";
export { checkLearningTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "learning" as const;
export const MODULE_VERSION = "0.1.0" as const;
