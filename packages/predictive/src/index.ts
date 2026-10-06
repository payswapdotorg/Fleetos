/**
 * @fleetos/predictive — Public API.
 *
 * Lane A (worker-a) implementation of the predictive device-history
 * feature/provenance feed (W153): the deterministic, provenance-carrying
 * feature extraction layer that W154's `represent(history, context)`
 * engine will consume. Per ADR-0002 § "Hard invariants": the feature
 * feed is NEVER business truth — it is a derived, recomputable
 * interpretation of immutable inputs. Observations remain immutable
 * and auditable — this lane READS them, never mutates or backfills.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller; src/ imports
 * `@fleetos/contracts` ONLY — every domain surface is consumed through
 * STRUCTURAL seams with the real packages injected at binding sites and
 * proven by test, the W040-disclosed pattern):
 *
 *   audit-seam.ts              D4 — the injected audit sink interface
 *                                  (the W011/W021/W022/W031/W032/W040/
 *                                  W041/W050B/W070 pattern; structurally
 *                                  satisfied by @fleetos/audit's sink
 *                                  adapter — proven by test into the
 *                                  REAL hash-chained log).
 *   device-history-features.ts D1 — the device-history feature extractor:
 *                                  a PURE function family that reads
 *                                  the immutable admitted observation
 *                                  stream within a caller-supplied
 *                                  window and produces a versioned,
 *                                  byte-reproducible feature set. Every
 *                                  feature carries per-feature
 *                                  provenance (source observation refs +
 *                                  method id/version); the whole set
 *                                  carries an input digest (SHA-256
 *                                  over the canonical serialized input
 *                                  observation ids + payload hashes) so
 *                                  a store hit is verifiable against
 *                                  the immutable stream.
 *   feature-provenance.ts     D2 — the versioned provenance record + the
 *                                  `verifyFeatureSetProvenance` pure
 *                                  trust anchor: given a feature set +
 *                                  the immutable inputs it claims, it
 *                                  re-derives the digest and confirms
 *                                  the observation refs exist in the
 *                                  supplied window — REFUSES (typed
 *                                  error, never throws raw) on
 *                                  mismatch, gap, or cross-tenant ref.
 *   feature-store.ts          D3 — the tenant-partitioned, append-only
 *                                  derived cache for materialized
 *                                  feature sets (the recomputable cache
 *                                  — NOT a second source of truth: every
 *                                  stored set carries the input digest
 *                                  so a store hit is verifiable against
 *                                  the immutable stream). Follows the
 *                                  learning package's store pattern.
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian) remains the sole authority for
 * any consequential action informed by a feature set. The feature feed
 * CANNOT mutate authorization state — there is NO path from a feature
 * set to an authorization decision. Counterfactual / action-conditioned
 * prediction is the W154 engine's layer; the W153 lane is the FEED only
 * — no predictions, no latent representations, no UI.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the
 * structural seams (audit sink, privacy/redaction, tenant scope) declared
 * LOCALLY are structurally satisfied by the real packages at the
 * binding sites (proven by test). No `any` in public signatures.
 */

// D4 — the audit emission seam (the W011/W021/W031/W050B pattern)
export * from "./audit-seam";

// D1 — the device-history feature extractor + the per-feature provenance
export * from "./device-history-features";

// D2 — the versioned provenance record + the verifyFeatureSetProvenance trust anchor
export * from "./feature-provenance";

// D3 — the tenant-partitioned, append-only derived cache + the audited recording boundary
export * from "./feature-store";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { PredictiveTenantScope, PredictiveTenantCheck } from "./internal";
export { checkPredictiveTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "predictive" as const;
export const MODULE_VERSION = "0.1.0" as const;
