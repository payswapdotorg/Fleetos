/**
 * @fleetos/world-model — Public API.
 *
 * Lane B (worker-b) implementation of the Predictive Twin / World Model
 * engine (W154 — Wave 14 lane 2 of 4, renumbered from the planned W151
 * per the operator's renumbering directive): the model-neutral engine
 * + the JEPA-compatible adapter seam that CONSUMES the W153
 * `@fleetos/predictive` feed through its public surface ONLY (the
 * structural-seam law — no edits to that package, no imports of its
 * internals) and produces versioned, deterministic, advisory
 * representations + predictions + counterfactuals over the W153 features.
 *
 * Per ADR-0002 § "Hard invariants" (the lane's constitution):
 *   1. The canonical Device Twin remains authoritative — the engine's
 *      outputs are ADVISORY interpretations, never business truth.
 *   2. Observations/events remain immutable — the engine never writes
 *      to any store except its own advisory records (the lane writes
 *      NOTHING: representations and predictions are computed on demand,
 *      advisory, never persisted by this lane).
 *   3. Every prediction carries: model/capability version, horizon,
 *      evidence references (chained to the W153 feature set's
 *      provenance + the input digest), uncertainty metadata, and the
 *      provenance chain digest.
 *   4. Counterfactuals (`predictAfterAction`) are HYPOTHETICAL, never
 *      facts — the record type machine-carries a distinct hypothetical
 *      marker; it can NEVER be constructed/rendered as fact.
 *   5. Predictions NEVER authorize or execute actions; no authorization
 *      surface exists in this package; Contract Guardian remains sole
 *      policy authority (the records are inputs AT MOST to
 *      human/advisory surfaces).
 *   6. A failed or unavailable model DEGRADES HONESTLY: the W153 feed's
 *      non-ok statuses (insufficient_history / empty_window / rejected)
 *      PROPAGATE as explicit honest representation states — NEVER
 *      zero-filled features, NEVER fabricated confidence. An
 *      unavailable adapter yields a typed degraded/unknown state, never
 *      a throw-as-control-flow.
 *   7. Tenant isolation at every boundary; cross-tenant inputs rejected.
 *   8. The DETERMINISTIC REFERENCE IMPLEMENTATION works with no GPU, no
 *      model provider, no network — pure TypeScript arithmetic over the
 *      W153 features. This reference path is the one the tests freeze.
 *   9. Provider-specific model SDKs stay behind the adapter seam — none
 *      in this repo.
 *  10. Zero runtime dependencies; strict TS; no `any` in public
 *      signatures; every timestamp injected by the caller; no clock
 *      reads, no entropy.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller; src/ imports
 * `@fleetos/contracts` AND `@fleetos/predictive` ONLY through their
 * public surfaces — every domain surface is consumed through
 * STRUCTURAL seams with the real packages injected at binding sites and
 * proven by test, the W040-disclosed pattern):
 *
 *   audit-seam.ts       D4 — the injected audit sink interface
 *                            (the W011/W021/W022/W031/W032/W040/W041/
 *                            W050B/W070/W153 pattern; structurally
 *                            satisfied by @fleetos/audit's sink
 *                            adapter — proven by test into the
 *                            REAL hash-chained log).
 *   representation.ts    D1 — the world-model representation: a PURE
 *                            function family over the W153
 *                            `DeviceHistoryFeatureSet` surface
 *                            (`represent(history, context)` produces
 *                            a versioned, deterministic derived record;
 *                            `compare(a, b)` produces a deterministic
 *                            similarity/distance). The CONTEXT INPUT TYPE
 *                            (`WorldModelContext`) is FROZEN HERE for
 *                            W155 to build the workload/project
 *                            projection against; the representation
 *                            PROPAGATES the W153 feed's tagged-union
 *                            status — never zero-fills, never
 *                            fabricates confidence.
 *   prediction.ts       D2 — the prediction + counterfactual layer:
 *                            `predict` produces a `WorldModelPrediction`
 *                            (a deterministic extrapolation over the
 *                            representation's temporal features into a
 *                            horizon-scoped estimate); `predictAfterAction`
 *                            produces a `WorldModelCounterfactual` (the
 *                            SAME shape PLUS a machine-carried
 *                            `hypothetical: true` marker + the candidate
 *                            action ref — it is IMPOSSIBLE to construct a
 *                            counterfactual that renders as fact,
 *                            machine-tested). The `uncertainty` and
 *                            `provenance` accessors are pure (never
 *                            re-deriving, never widening).
 *   adapter.ts          D3 — the JEPA-compatible adapter seam: the
 *                            swappable-implementation boundary
 *                            (`WorldModelAdapter`). The DETERMINISTIC
 *                            REFERENCE ADAPTER implements it (the D1/D2
 *                            functions behind the interface); an
 *                            UNAVAILABLE adapter yields the honest
 *                            degraded/unknown state through the SAME
 *                            interface; a TEST-ONLY stub adapter (a
 *                            different model family string, deterministic
 *                            outputs) proves the seam is genuinely
 *                            swappable. The seam is where a JEPA-family
 *                            model class WOULD plug in later — name
 *                            and document it as such; implement NO
 *                            actual JEPA model.
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian) remains the sole authority for
 * any consequential action informed by a prediction. The world-model
 * CANNOT mutate authorization state — there is NO path from a
 * prediction to an authorization decision. Counterfactual / action-
 * conditioned prediction carries the candidate action REF but NEVER
 * executes it (invariant 5).
 *
 * Cross-lane domain types come from @fleetos/contracts only; the W153
 * feed is consumed through @fleetos/predictive's public surface only;
 * the structural seams (audit sink, tenant scope) declared LOCALLY are
 * structurally satisfied by the real packages at the binding sites
 * (proven by test). No `any` in public signatures.
 */

// D4 — the audit emission seam (the W011/W021/W031/W050B/W070/W153 pattern)
export * from "./audit-seam";

// D1 — the world-model representation + the frozen WorldModelContext input type
export * from "./representation";

// D2 — the prediction + counterfactual layer + the uncertainty/provenance accessors
export * from "./prediction";

// D3 — the JEPA-compatible adapter seam (the swappable-implementation boundary)
export * from "./adapter";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { WorldModelTenantScope } from "./internal";
export { checkWorldModelTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "world-model" as const;
export const MODULE_VERSION = "0.1.0" as const;
