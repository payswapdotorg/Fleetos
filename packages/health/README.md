# @fleetos/health

Normalized health signals, anomalies, diagnoses, predictions and treatment recommendations.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`).

## Frozen spec source

packages/health/README.md; spec/MODULE-DEPENDENCY-MAP.md Device truth layer.

## W021 — Health + diagnosis engine

Implemented by W021 (branch `work/w021`, base `integration/wave0`). The
package is pure TypeScript with zero runtime dependencies: every function
is deterministic (same inputs => same outputs, byte for byte), every
timestamp is injected by the caller (no clock reads, no entropy), and
every failure is a tagged result — nothing in the public API throws for
domain flows.

Per `spec/ARCHITECTURE.md` § Canonical model: reality is observations/
events; "diagnoses, predictions and recommendations are versioned
interpretations." Per § Decision boundary: the decision engine may
PROPOSE diagnoses and treatment; the deterministic policy layer (W031
Contract Guardian) remains authoritative. **Everything this package
produces is a PROPOSAL** — no function creates, dispatches, or executes
a Fleet Intent.

### Module map

| Module | Deliverable | Contents |
|---|---|---|
| `src/signals.ts` | D1 | The signal model (versioned, `SIGNAL_MODEL_VERSION`): seven typed signal kinds (battery.capacity, storage.usage, memory.usage, cpu.usage, temperature.core, crash.event, boot.time) with fixed units, deterministic derivation from canonical `Observation` values (frozen `@fleetos/contracts` shapes), injected rolling windows, explicit confidence rules (direct reads 1.0; computed ratios 0.9), and enumerable skip reasons for unmapped kinds / shape misses / out-of-range values (forward compatibility — never errors). Includes the Device Twin adapter (`deriveSignalsFromTwin`) over the same-lane `@fleetos/device-model` telemetry window. |
| `src/baselines.ts` | D2 | Per-device and per-model baselines: `StatisticalSummary` with NEAREST-RANK percentiles (p50/p90/p95/p99 — always an observed sample, never interpolated) and population stddev, computed over rolling windows anchored at an INJECTED `asOf`. Pure functions over signal history; `buildModelBaselines` groups through an injected `DeviceModelResolver` (twin-derived reference resolver included) and reports unresolved devices. Versioned (`BASELINE_MODEL_VERSION`). |
| `src/anomalies.ts` | D3 | Deterministic anomaly rules (versioned, `ANOMALY_RULES_VERSION`): seven rules in three families — threshold (battery.low, storage.near_full, temperature.high), deviation vs device baseline (memory.pressure, cpu.spike, boot.slow; z-score with `MIN_BASELINE_SAMPLES` guard and zero-stddev epsilon handling), window-count (crash.burst). Anomaly records carry severity, evidence correlated to source observation ids, deterministic `anom_` ids, and rule context in `detail`. Thresholds overridable per run; defaults frozen. No ML anywhere. |
| `src/diagnosis.ts` | D4 | Versioned `DiagnosisHypothesis` (candidate cause + evidence links + deterministic confidence, capped at 0.99) and `TreatmentRecommendation` (draft `HealthIntentProposal` linked to Fleet Intent kinds from contracts — MaintainDeviceIntent / ReplacementIntent / RecoveryIntent; NO intent id, NO lifecycle — proposals only). The append-only per-device `DiagnosisLedger` (hypotheses, recommendations, dismissals; supersession recorded on the NEW record via `supersedes`, old records never rewritten), the seven-cause `CAUSE_LIBRARY`, and the deterministic `diagnose()` engine. |
| `src/audit-seam.ts` | seam | The injected audit sink (W011's pattern): `HealthAuditRecord` / `HealthAuditSink` structurally compatible with `@fleetos/audit`'s sink adapter; emission for consequential interpretations only (hypothesis proposed, treatment proposed, hypothesis dismissed). |
| `src/internal.ts` | — | Internal helpers (not exported from the public API): ISO sanity/parse, canonical JSON, FNV-1a digests, freezing, FleetError constructors. |

### Error codes (stable machine codes)

`health.signals.invalid_request`, `health.baselines.invalid_request`,
`health.anomalies.invalid_request`, `health.diagnosis.invalid_request`,
`health.diagnosis.tenant_mismatch`.

All errors carry the tenant + correlation ids required by the frozen
`FleetError` taxonomy and translate through the frozen `toApiError`.

### Determinism conventions (explicit, versioned)

- Signal ordering: stable sort by (observedAt, sourceObservationId,
  canonical kind order).
- Percentiles: nearest-rank, `sorted[ceil(p/100 * n) - 1]`.
- Stddev: population (divide by n).
- Windows: `(asOf - windowMs, asOf]` — inclusive end, injected anchor.
- Record ids: `<prefix>_<fnv1a32(canonicalJson(identity tuple))>` —
  deterministic, non-cryptographic (same convention as the W011 digests).
- Confidence: `min(0.99, Σ weight × severityFactor)` with
  WARNING = 0.6, CRITICAL = 1.0.

### Dependencies

- `@fleetos/contracts` (workspace) — frozen shared seam: branded ids,
  `Observation`, intent kinds + payload interfaces, FleetError taxonomy,
  `TenantScoped`.
- `@fleetos/device-model` (workspace, same lane) — `DeviceTwin` for the
  telemetry adapter and the twin-derived model resolver.

Cross-lane imports go through `@fleetos/contracts` only
(`tools/check-ownership.mjs` enforced). The audit PACKAGE (lane C) is
never imported; the seam is structural.

### Later waves (documented seams)

- The maintenance section of the Device Twin consumes
  `DiagnosisHypothesis` / `TreatmentRecommendation` through W011's
  `TwinInterpretation` record (`updateTwinSection`) — W042's call.
- Security posture causes (SecurityRemediationIntent proposals) belong
  to W031; the cause library grows there.
- Learning/evaluation case export belongs to W050B (`@fleetos/learning`
  + Arena).
