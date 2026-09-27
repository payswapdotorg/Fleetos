/**
 * @fleetos/security — Public API.
 *
 * Lane B (worker-b) implementation of the FleetOS Security Doctor
 * (W031 D1 + D4): the security-posture domain model, versioned posture
 * findings, and the append-only findings ledger.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   posture.ts          D1 — the SecurityPosture domain model: posture
 *                          derived deterministically from canonical
 *                          observation shapes (frozen
 *                          @fleetos/contracts `Observation`, kind
 *                          `device.security`, payload schema v1), an
 *                          ordered rule library, versioned findings with
 *                          severity + classification, deterministic ids,
 *                          evidence links to the source observations,
 *                          forward-compatible skip reasons, and DRAFT
 *                          SecurityRemediationIntent payloads (the intent
 *                          kind owned by this package).
 *   findings-ledger.ts  D1 — the append-only per-device findings ledger:
 *                          versioned-interpretation discipline (new
 *                          records supersede, never rewrite), dismissal
 *                          entries, and the derived active view.
 *   guardian-inputs.ts  — the `security -> policy` module-map edge with
 *                          real code: posture projections onto the
 *                          policy-owned Guardian rule-input shapes.
 *   audit-seam.ts       D4 — the injected audit sink interface
 *                          (W011/W021/W022's pattern; structurally
 *                          satisfied by @fleetos/audit's sink adapter —
 *                          proven by test).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): findings and remediation
 * proposals are INTERPRETATIONS and PROPOSALS — the deterministic
 * policy layer (the Contract Guardian, `@fleetos/policy`) remains
 * authoritative for whether any action is permitted. Nothing here
 * creates, dispatches, or executes a Fleet Intent, and nothing asserts
 * an employee's intent: findings state observable device conditions.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the policy
 * import is same-lane (`tools/check-ownership.mjs` enforced). No `any`
 * in public signatures.
 */

// The audit emission seam (W011/W021/W022's pattern)
export * from "./audit-seam";

// D1 — the posture model (findings, rule library, assessment)
export * from "./posture";

// D1 — the append-only findings ledger
export * from "./findings-ledger";

// The security -> policy module-map edge
export * from "./guardian-inputs";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { SecurityTenantScope } from "./internal";
export { checkSecurityTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "security" as const;
export const MODULE_VERSION = "0.1.0" as const;
