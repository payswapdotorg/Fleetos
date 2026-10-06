/**
 * @fleetos/predictive — Public API.
 *
 * W153 (lane A, Wave 14) implementation of the device-history feature/
 * provenance feed — the foundational data lane of the Predictive Twin /
 * World Model layer per ADR-0002 (ACCEPTED): the deterministic,
 * provenance-carrying feature extraction that W154's model-neutral
 * `represent(history, context)` engine will consume.
 *
 * The feature feed is NEVER business truth (ADR-0002 invariant 1): it
 * is a derived, recomputable interpretation of immutable inputs. This
 * lane builds the FEED only — no predictions, no latent
 * representations, no UI (those are W154/W156).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller; src/ imports
 * `@fleetos/contracts` ONLY — every domain surface is consumed through
 * STRUCTURAL seams with the real packages injected at binding sites and
 * proven by test, the W040-disclosed pattern):
 *
 *   audit-seam.ts             D4 — the injected audit sink interface
 *                               (the W011/W021/W022/W031/W032/W040/
 *                               W041/W070 pattern; structurally
 *                               satisfied by @fleetos/audit's sink
 *                               adapter — proven by test into the REAL
 *                               hash-chained log).
 *   device-history-features.ts D1 — the PURE device-history feature
 *                               extractor: tenant-scoped, attribution-
 *                               checked (cross-tenant inputs rejected,
 *                               never merged), privacy/consent-gated
 *                               (the structural seam; pass-through
 *                               first implementation), absolutely
 *                               deterministic (canonical (observedAt,
 *                               id) order semantics; golden tests
 *                               prove byte-identical outputs), honest
 *                               (insufficient_history / empty_window /
 *                               rejected states — never fabricated
 *                               zeros), carrying per-feature provenance
 *                               + the sha256 input digest (the
 *                               structural FeatureDigestFn seam —
 *                               byte-compatible with the REAL apps/web
 *                               runtime module, proven by test).
 *   feature-provenance.ts     D2 — the versioned provenance record +
 *                               `verifyFeatureSetProvenance`: the W154
 *                               engine's trust anchor. Re-derives the
 *                               digest, confirms the observation refs
 *                               exist in the supplied window, and
 *                               re-derives the FULL set (determinism IS
 *                               the proof — a tampered value is refused
 *                               and named). Typed errors, never raw
 *                               throws; cross-tenant refs refused.
 *   feature-store.ts          D3 — the tenant-partitioned append-only
 *                               derived cache (the RECOMPUTABLE cache —
 *                               never a second source of truth: every
 *                               stored set carries the input digest so a
 *                               store hit re-verifies against the
 *                               immutable stream; the learning lane's
 *                               store pattern).
 *
 * Decision boundary: the feature feed CANNOT mutate authorization or
 * decision state (ADR-0002 invariants 4/5 — no new authorization
 * surface; the Contract Guardian remains sole authority). Predictions,
 * counterfactuals and their adoption are W154/W155 scope.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the
 * structural seams (audit sink, privacy/consent gate, digest, tenant
 * scope) declared LOCALLY are structurally satisfied by the real
 * packages at the binding sites (proven by test). No `any` in public
 * signatures.
 */

// D4 — the audit emission seam (the W011/W021/W031/W070 pattern)
export * from "./audit-seam";

// D1 — the device-history feature extractor + the frozen vocabularies
export * from "./device-history-features";

// D2 — the provenance record + the verification trust anchor
export * from "./feature-provenance";

// D3 — the tenant-partitioned append-only derived cache
export * from "./feature-store";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { PredictiveTenantScope } from "./internal";
export { checkPredictiveTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "predictive" as const;
export const MODULE_VERSION = "0.1.0" as const;
