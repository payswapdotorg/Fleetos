/**
 * @fleetos/device-model — Public API.
 *
 * Lane B (worker-b) implementation of the Fleet Device Twin — the
 * canonical durable object of FleetOS — plus the observation
 * normalization pipeline and the ingestion control-plane boundary
 * (W011).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   identity.ts    D1 — device identity + ownership + the lifecycle state
 *                       machine as a pure transition function with
 *                       illegal-transition rejection (table frozen in
 *                       @fleetos/contracts).
 *   twin.ts        D2 — the Device Twin aggregate: the ten joined,
 *                       composable, tenant-scoped sections; TwinRevision;
 *                       append-only provenance on every mutation.
 *   normalize.ts   D3 — raw adapter observation payloads -> canonical
 *                       contracts observations: unit normalization seams,
 *                       duplicate suppression by (deviceId, seq), ordering
 *                       guarantees, malformed-input rejection with
 *                       FleetError taxonomy mapping.
 *   ingestion.ts   D4 — the boundary service the device agent posts
 *                       ObservationBatch values to: validation, idempotent
 *                       admission by batch/event id, ack semantics,
 *                       back-pressure signal, audit emission seam.
 *   audit-seam.ts  — the minimal audit sink interface this lane depends
 *                       on (the audit package is lane C's W012).
 *   store.ts       — the tenant-scoped twin persistence seam (in-memory
 *                       reference implementation).
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 */

// D1 — Device identity, ownership, lifecycle
export * from "./identity";

// D2 — The Device Twin aggregate
export * from "./twin";

// D3 — Observation normalization
export * from "./normalize";

// The audit emission seam
export * from "./audit-seam";

// Tenant-scoped twin store
export * from "./store";

// D4 — Ingestion control-plane boundary
export * from "./ingestion";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "device-model" as const;
export const MODULE_VERSION = "0.1.0" as const;
