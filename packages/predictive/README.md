# @fleetos/predictive

W153 (Wave 14, lane A): the deterministic, provenance-carrying
device-history feature feed — the foundational data lane of the
Predictive Twin / World Model layer (ADR-0002, ACCEPTED).

## What this package is

- **A pure feature extractor** (`extractDeviceHistoryFeatures`) over the
  immutable admitted observation stream: tenant-scoped, deterministic
  (byte-identical outputs proven by golden tests), honest
  (`insufficient_history` / `empty_window` / `rejected` states — never
  fabricated zeros), privacy-gated (the structural BYOD/consent seam,
  pass-through first implementation).
- **The provenance trust anchor** (`verifyFeatureSetProvenance`): a
  feature set + the immutable inputs it claims re-derive
  byte-identically or the verification refuses (typed errors; tampered
  values are named). This is what W154's model-neutral engine consumes.
- **A recomputable cache** (`createInMemoryFeatureSetStore` +
  `materializeFeatureSet`): tenant-partitioned, append-only, every
  stored set carrying the input digest so a store hit re-verifies
  against the immutable stream. Never a second source of truth.

## What this package is NOT

- Not business truth (ADR-0002 invariant 1): the feed is a derived,
  recomputable interpretation of immutable inputs.
- Not a prediction engine: no latent representations, no predictions,
  no counterfactuals, no UI (W154/W156 scope).
- Not an authorization surface: nothing here can mutate
  authorization/decision state; the Contract Guardian remains sole
  authority.

## Discipline

Zero runtime dependencies; strict TS; no `any` in public signatures;
src/ imports `@fleetos/contracts` ONLY (real sibling packages bind at
the test/ binding sites — the W040-disclosed pattern); no clock reads,
no randomness, no I/O (every timestamp injected by the caller;
machine-asserted by the contract-conformance suite).

## Digests

The input digest is FIPS 180-4 SHA-256 over the canonical JSON of the
canonically-ordered (observedAt, then id) in-window admitted
observations. The implementation is pure TypeScript with a manual UTF-8
encoder; the REAL `apps/web/src/runtime/sha256.ts` module satisfies the
`FeatureDigestFn` seam structurally and is byte-compatible (proven by
the binding-site test, including the standard FIPS vectors).
