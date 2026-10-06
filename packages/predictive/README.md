# @fleetos/predictive

The predictive device-history feature/provenance feed — the foundational
data lane of Wave 14 (the Predictive Twin / World Model layer per
ADR-0002). This package is the deterministic, provenance-carrying
feature extraction layer that W154's `represent(history, context)`
engine will consume.

Per ADR-0002 § "Hard invariants":

1. The feature feed is NEVER business truth — it is a derived,
   recomputable interpretation of immutable inputs.
2. Observations/events remain immutable and auditable — this lane READS
   them, never mutates or backfills.
3. Every feature set carries: feature-set schema version, extractor
   version, input window definition, input observation refs, an input
   digest, and per-feature provenance (source refs + method).
4. Determinism is absolute: same immutable inputs + same extractor
   version + same window => byte-identical feature set.
5. Insufficient history => explicit honest state (`insufficient_history`
   with the reason), NEVER fabricated or zero-filled values.
6. Tenant isolation at the boundary AND in the store semantics.
7. BYOD/privacy: no feature may incorporate data outside the device's
   own tenant scope; the design leaves a redaction/consent seam.
8. No GPU, no model provider, no network — pure TypeScript arithmetic
   over the observation stream.
9. No new authorization surface — Contract Guardian remains sole
   authority.
10. Zero runtime dependencies; strict TS; no `any` in public signatures;
    every timestamp injected by the caller.

## Module map

- `src/audit-seam.ts` — D4, the injected audit sink interface (the
  W011/W021/W031/W050B pattern; structurally satisfied by
  `@fleetos/audit`'s sink adapter).
- `src/device-history-features.ts` — D1, the device-history feature
  extractor (pure function family with per-feature provenance + input
  digest).
- `src/feature-provenance.ts` — D2, the versioned provenance record +
  `verifyFeatureSetProvenance` pure trust anchor.
- `src/feature-store.ts` — D3, the tenant-partitioned, append-only
  derived cache + the audited recording boundary.

## Frozen public surface (consumed by W154's `represent(history, context)`)

- Types: `DeviceHistoryFeatureInput`, `DeviceHistoryFeatureSet`,
  `Feature`, `FeatureValue`, `FeatureKind`, `FeatureStatus`,
  `FeatureWindow`, `FeatureSetIdentity`, `FeatureProvenance`,
  `InsufficientHistoryReason`, `RejectedReason`, `PrivacyRedactionSeam`,
  `VerifyProvenanceInput`, `VerifyFeatureSetProvenanceResult`,
  `VerifyProvenanceOptions`, `ProvenanceRefusalReason`,
  `FeatureSetStore`, `FeatureSetStoreWrite`, `RecordFeatureSetOptions`,
  `PredictiveAuditRecord`, `PredictiveAuditSink`, `PredictiveTenantScope`.
- Functions: `extractDeviceHistoryFeatures`, `computeInputDigest`,
  `verifyFeatureSetProvenance`, `featureSetContentDigest`,
  `featureSetStoreId`, `createInMemoryFeatureSetStore`,
  `recordFeatureSet`, `recordProvenanceVerification`,
  `checkPredictiveTenantScope`.
- Constants: `FEATURE_SET_SCHEMA_VERSION` (1), `EXTRACTOR_VERSION` (1),
  `MIN_OBSERVATIONS_FOR_FEATURES` (2), `FEATURE_KIND_*` (the closed
  machine-stable feature-kind vocabulary), `ALL_FEATURE_KINDS`,
  `FEATURE_UNITS`, `PREDICTIVE_AUDIT_ACTIONS`, `DEFAULT_PRIVACY_SEAM`,
  `MODULE_NAME`, `MODULE_VERSION`.

The seam is FROZEN for W153. Bumping `FEATURE_SET_SCHEMA_VERSION` or
`EXTRACTOR_VERSION` is a contract change requiring an ADR.
