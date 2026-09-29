/**
 * @fleetos/web-device — Public API.
 *
 * Lane A (worker-a) implementation of the device UI SURFACES (W060A):
 * pure, typed, deterministic, provider-neutral view-models + state
 * machines + surface contracts for the device roster, the device
 * detail header (with the frozen lifecycle machine surfaced read-only),
 * and the Device Doctor detail. This is NOT a rendered app — the shell
 * arrives with W061 [TL]; these are the typed surface modules the shell
 * binds.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   seams.ts        The STRUCTURAL seams over the Device Twin domain
 *                   (the W040-disclosed pattern): `DeviceTwinLike` +
 *                   `DeviceTwinSource` (structurally satisfied by the
 *                   REAL `@fleetos/device-model` TwinStore, injected at
 *                   the binding site — proven by test) and the Device
 *                   Doctor sources (structurally satisfied by the REAL
 *                   `@fleetos/health` pipeline outputs).
 *   device-list.ts  D1 — the device roster view-model: composable typed
 *                   filters, deterministic ordering + pagination, facet
 *                   counts, injected-instant staleness banding, and the
 *                   pure selection state machine.
 *   lifecycle.ts    D2 — the device detail header + the frozen device
 *                   lifecycle state machine surfaced READ-ONLY (legal
 *                   next states derived from the FROZEN contracts
 *                   transition table; the LEARN loop-closure note
 *                   documented, never performed).
 *   doctor.ts       D3 — the Device Doctor detail view-model: signals,
 *                   baselines, anomalies, VERSIONED diagnoses +
 *                   treatment recommendations (read-only lineage with
 *                   ACTIVE/SUPERSEDED/DISMISSED statuses), OPAQUE
 *                   content-addressable evidence refs (never
 *                   interpreted), and the pure panel navigation state
 *                   machine.
 *
 * src/ imports: `@fleetos/contracts` ONLY (the cross-lane seam). Every
 * domain surface is consumed through the structural seams with the
 * real packages injected at binding sites (test files may import
 * across lanes — the established pattern).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

// The structural seams over the Device Twin + health domains
export * from "./seams";

// D1 — the device roster view-model + the selection state machine
export * from "./device-list";

// D2 — the device detail header + the read-only lifecycle machine surface
export * from "./lifecycle";

// D3 — the Device Doctor detail view-model + the panel state machine
export * from "./doctor";

// D5 (W090A) — the existing-fleet enrollment journey view-model
// (initiate -> review -> confirm -> verified, with evidence)
export * from "./enrollment";

// W090A — the local console design tokens + status vocabulary
export * from "./ui/tokens";
export * from "./ui/status";

// W090A — the local shadcn-style component vocabulary (plain React + CSS)
export * from "./ui/primitives";

// W090A — the rendered screens (presentational, fully controlled)
export * from "./screens/device-fleet-screen";
export * from "./screens/device-doctor-screen";
export * from "./screens/device-lifecycle-screen";
export * from "./screens/enrollment-screen";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "web-device" as const;
export const MODULE_VERSION = "0.1.0" as const;
