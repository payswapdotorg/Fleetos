/**
 * @fleetos/world-context — Public API.
 *
 * Lane C (worker-c) implementation of the workload/project context
 * projection + the Learning/Arena evaluation bridge (W155 — Wave 14
 * lane 3 of 4, renumbered from the planned W152 per the operator's
 * renumbering directive): the derived, tenant-scoped,
 * provenance-carrying context projection (the W154 engine's input
 * type — built from the REAL workload assignment state + procurement
 * stage summaries via structural seams) + the predictive-evaluation
 * bridge (the W154 prediction/counterfactual → the W070
 * evaluation-case SUBMISSION PROPOSAL, Guardian-gated, never
 * auto-submitted) + the outcome binding (the loop CLOSES — the
 * observed outcome joined to the predicted estimate, structurally
 * compatible with the W070 outcome-observation record).
 *
 * Per ADR-0002 § "Hard invariants" + the W155 work order (the lane's
 * constitution):
 *   1. The context projection is DERIVED, tenant-scoped,
 *      provenance-carrying — NEVER business truth; the authoritative
 *      state stays in the owning packages (workloads/procurement).
 *   2. Every context item carries its own provenance refs to the SOURCE
 *      records (workload ids, procurement case ids) — the same
 *      discipline as the W153 feature provenance.
 *   3. The bridge NEVER auto-submits anything to Arena — the W070
 *      PROPOSAL-gated law (GuardianDecision gates ALLOW/WARN →
 *      PROPOSED, REQUIRE_APPROVAL → PARKED, BLOCK → REJECTED). The
 *      lane CONVERTS predictive cases into evaluation-case PROPOSALS;
 *      adoption happens only through explicit versioned adoption
 *      records.
 *   4. Predictions remain ADVISORY until adoption — no predictive
 *      output authorizes/executes/mutates business truth.
 *   5. Tenant isolation + BYOD/privacy before anything enters the
 *      bridge: cross-tenant context/proposal/binding REFUSED; the
 *      privacy seam discipline follows the W153/W154 pattern (the W154
 *      context's `value` is opaque to the engine — the W155 projection
 *      is the layer that INTERPRETS the workload/procurement state, but
 *      it does NOT carry raw observations).
 *   6. Determinism: the same source records + the same projection
 *      version => byte-identical context + byte-identical evaluation
 *      proposals.
 *   7. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *   8. Consume @fleetos/world-model + @fleetos/learning + the domain
 *      packages through STRUCTURAL SEAMS in src/ (the W040/W154
 *      pattern — the ownership gate forbids cross-lane src/ imports
 *      beyond @fleetos/contracts); bind the REAL packages at the test
 *      binding sites, machine-enforced by the contract-conformance test.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller; src/ imports
 * `@fleetos/contracts` ONLY — every domain surface is consumed through
 * STRUCTURAL seams with the real packages injected at binding sites and
 * proven by test, the W040-disclosed pattern):
 *
 *   audit-seam.ts                  D4 — the injected audit sink
 *                                     interface (the W011/W021/W022/
 *                                     W031/W032/W040/W041/W050B/W070/
 *                                     W153/W154 pattern; structurally
 *                                     satisfied by @fleetos/audit's sink
 *                                     adapter — proven by test into the
 *                                     REAL hash-chained log).
 *   seam.ts                        the W040/W154 structural-seam
 *                                     pattern: LOCAL interfaces
 *                                     structurally compatible with the
 *                                     W154 WorldModelContext +
 *                                     WorldModelPrediction +
 *                                     WorldModelCounterfactual; the W070
 *                                     EvaluationCaseProposalFacet +
 *                                     OutcomeObservation; the W022
 *                                     WorkloadRecommendation +
 *                                     WorkloadProfile; the procurement
 *                                     ProcurementDemand + Quote. The
 *                                     binding site (tests) injects the
 *                                     REAL packages' outputs.
 *   context-projection.ts          D1 — the workload/project context
 *                                     projection: a PURE function
 *                                     family over the W022 workloads
 *                                     + procurement surfaces
 *                                     (`buildWorldModelContext` produces
 *                                     a `WorldModelContext`-shaped record
 *                                     structurally compatible with the
 *                                     W154 frozen input type; honest
 *                                     states: empty surface → minimal
 *                                     context; tenant mismatch →
 *                                     REFUSED; SUPERSEDED/DISMISSED
 *                                     assignments + CLOSED procurement
 *                                     cases EXCLUDED).
 *   predictive-evaluation-bridge.ts  D2 — the Learning/Arena bridge:
 *                                     `convertPredictionToEvaluationProposal`
 *                                     converts a W154
 *                                     prediction/counterfactual into a
 *                                     Guardian-gated evaluation-case
 *                                     SUBMISSION PROPOSAL
 *                                     (structurally compatible with the
 *                                     W070 `EvaluationCaseProposalFacet`).
 *                                     The PROPOSAL-GATED law
 *                                     (ALLOW/WARN → PROPOSED,
 *                                     REQUIRE_APPROVAL → PARKED, BLOCK →
 *                                     REJECTED); the bridge NEVER
 *                                     submits (no submit path exists —
 *                                     machine-tested). Counterfactual-
 *                                     derived proposals carry the
 *                                     hypothetical marker THROUGH the
 *                                     conversion (THREE surfaces —
 *                                     machine-tested).
 *   outcome-binding.ts             D3 — the loop CLOSES:
 *                                     `bindPredictiveOutcome` joins an
 *                                     OBSERVED LATER STATE (the actual
 *                                     device health/cadence at the
 *                                     horizon's end — INJECTED by the
 *                                     caller) to the PREDICTED estimate
 *                                     (by prediction id + the
 *                                     provenance chain), producing an
 *                                     outcome-observation-shaped record
 *                                     (structurally compatible with the
 *                                     W070 `OutcomeObservation`).
 *                                     Honest refusals: horizon-mismatch
 *                                     REFUSES; missing-provenance
 *                                     REFUSES; cross-tenant REFUSES.
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian) remains the sole authority for
 * evaluation-case submission — the gate consumes the FROZEN
 * `GuardianDecision` and NOTHING here auto-submits. Adoption is
 * PROPOSAL-gated through the W070 fail-closed certification boundary —
 * the W155 lane produces the proposal SHAPE; the W070 arena adapter
 * owns the submission ledger.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the W154
 * engine + the W070 learning package + the W022 workloads package +
 * the procurement package are consumed through their public surfaces
 * ONLY via STRUCTURAL seams declared LOCALLY in src/seam.ts; the
 * structural seams (audit sink, tenant scope) declared LOCALLY are
 * structurally satisfied by the real packages at the binding sites
 * (proven by test). No `any` in public signatures.
 */

// D4 — the audit emission seam (the W011/W021/W031/W050B/W070/W153/W154 pattern)
export * from "./audit-seam";

// The W040/W154 structural-seam pattern (LOCAL interfaces for the W154
// WorldModelContext + WorldModelPrediction/Counterfactual; the W070
// EvaluationCaseProposalFacet + OutcomeObservation; the W022
// WorkloadRecommendation/WorkloadProfile; the procurement
// ProcurementDemand/Quote).
export * from "./seam";

// D1 — the workload/project context projection + the frozen context schema/derivation versions
export * from "./context-projection";

// D2 — the predictive-evaluation bridge + the Guardian-gated proposals
export * from "./predictive-evaluation-bridge";

// D3 — the outcome binding (the loop CLOSES)
export * from "./outcome-binding";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { WorldContextTenantScope } from "./internal";
export { checkWorldContextTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "world-context" as const;
export const MODULE_VERSION = "0.1.0" as const;
