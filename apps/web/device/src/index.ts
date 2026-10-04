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

// W141 — the honest lane-phase vocabulary (loading/empty/ready/blocked/
// approval-required/error/unsupported) + the ScreenPhase mapping
export * from "./lane-phase";

// W141 — the Device Doctor JOURNEY view-model: the full nine-stage walk
// (device -> observations -> symptoms -> diagnosis -> remediation ->
// authorization -> action -> result -> evidence) with the symptom walk
// and the remediation walk, every stage derived from real runtime state
// (honest not-yet-observed states; never fabricated observations).
export * from "./doctor-journey";

// W141 — the Device Doctor RUNTIME FEED: the composition function that
// carries the runtime state contract into the screen's phase props
// (phase + lanePhase + journey + gating + dispositions).
export * from "./doctor-feed";

// D5 (W090A) — the existing-fleet enrollment journey view-model
// (initiate -> review -> confirm -> verified, with evidence)
export * from "./enrollment";

// W100A — the install center view-model (the install contract's
// dedicated first-class surface): platform facets, ownership scopes,
// the one-time enrollment code card, install plans with checksums,
// installation verification over the agent journey trace, the
// deterministic next-action ladder, and the uninstall/revoke plan
// (authorization-required intents, never executions).
export * from "./install-center";
export * from "./install-center-binding";

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

// W100A — the rendered install center screen (presentational, fully
// controlled; the nine install-contract steps + uninstall/revoke plan)
export * from "./screens/install-center-screen";

// W145 — the DECLARED-IMPORT surface: the manual device-record entry path
// (provenance-flagged DECLARED, never conflated with agent OBSERVED
// records; honest duplicate handling; the same runtime state contract
// surfaces carry the mark — roster, feeds, searches) + the record-origin
// provenance vocabulary the whole lane marks with.
export * from "./declared-import";

// W145 — the rendered declared-import journey screen (enter -> review ->
// confirm -> recorded, evidence-visible, fully controlled)
export * from "./screens/declared-import-screen";

// W145 — the MOBILE PRIORITY-CARD roster: the severity-first attention
// bands + the card-list view-model over the SAME roster runtime state
// (below 480px the wide table is replaced by the card list — no
// horizontal page scroll at 390x844).
export * from "./mobile-roster";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "web-device" as const;
export const MODULE_VERSION = "0.1.0" as const;
