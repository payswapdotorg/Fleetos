/**
 * @fleetos/health — Public API.
 *
 * Lane B (worker-b) implementation of the FleetOS health + diagnosis
 * engine (W021): signals, baselines, anomalies, diagnosis hypotheses
 * and treatment recommendations.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   signals.ts    D1 — typed health Signals derived deterministically
 *                     from canonical observations (frozen
 *                     @fleetos/contracts shapes; Device Twin adapter via
 *                     the same-lane @fleetos/device-model). Signal
 *                     kinds, units, windows, confidence — versioned.
 *   baselines.ts  D2 — per-device and per-model baselines: statistical
 *                     summaries (nearest-rank percentiles, population
 *                     stddev) over rolling windows; pure functions over
 *                     observation history; injected time.
 *   anomalies.ts  D3 — deterministic anomaly rules (threshold,
 *                     deviation vs baseline, window-count) producing
 *                     anomaly records with severity, evidence, and
 *                     correlation to the source observations. No ML.
 *   diagnosis.ts  D4 — versioned DiagnosisHypothesis + versioned
 *                     TreatmentRecommendation (PROPOSALS linked to Fleet
 *                     Intent kinds from @fleetos/contracts — never
 *                     automatic actions), the append-only interpretation
 *                     ledger, and the audit-emitting seam.
 *   audit-seam.ts — the injected audit sink interface (W011's pattern;
 *                     structurally compatible with @fleetos/audit's
 *                     sink adapter).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): this engine PROPOSES
 * diagnoses and treatment; the deterministic policy layer (W031,
 * Contract Guardian) remains authoritative for whether anything is
 * permitted. Nothing here creates, dispatches, or executes a Fleet
 * Intent.
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// The audit emission seam (W011's pattern)
export * from "./audit-seam";

// D1 — Signal model
export * from "./signals";

// D2 — Baselines
export * from "./baselines";

// D3 — Anomaly detection
export * from "./anomalies";

// D4 — Diagnosis hypotheses + treatment recommendations + ledger
export * from "./diagnosis";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "health" as const;
export const MODULE_VERSION = "0.1.0" as const;
