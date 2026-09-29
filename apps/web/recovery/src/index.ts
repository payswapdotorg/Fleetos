/**
 * @fleetos/web-recovery — Public API.
 *
 * Lane A (worker-a) implementation of the recovery-side UI SURFACES
 * (W060A): pure, typed, deterministic, provider-neutral view-models +
 * state machines + surface contracts for Find My Device, the recovery
 * cases, the Fleet Action plans (group selection + policy-gated
 * transitions), and the destructive recovery actions. This is NOT a
 * rendered app — the shell arrives with W061 [TL]; these are the typed
 * surface modules the shell binds.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   seams.ts              The STRUCTURAL seams over the recovery +
 *                         fleet-action domains (the W040-disclosed
 *                         pattern): Find-My-Device view/ledger source,
 *                         recovery-case source, action-plan source,
 *                         destructive-request source, and the injected
 *                         `StatusMachineTable` (the domain's frozen
 *                         transition tables ride the binding site).
 *   find-my-device.ts     D1 — the Find-My-Device view-model: the
 *                         last-seen evidence ledger READ-ONLY,
 *                         machine-stable `no_location_evidence`, and
 *                         the opaque-by-omission location display (the
 *                         payload never enters the surface).
 *   recovery-case.ts      D2 — the recovery case view-models: the
 *                         PROPOSAL-gated transitions surfaced read-only
 *                         (injected table), the versioned history, the
 *                         evidence basis, and the VISIBLE
 *                         destructive-gate precondition.
 *   fleet-actions.ts      D3 — the Fleet Action surfaces (W041): the
 *                         group-selection display (recursive selector
 *                         tree), the policy-gated plan state machines
 *                         with the REQUIRE_APPROVAL PARKED states
 *                         VISIBLE, and the plan list with the parked
 *                         queue first.
 *   destructive-actions.ts D4 — the destructive action surfaces:
 *                         lock/locate/wipe/reboot displayed with the
 *                         W031 Guardian decision context and the
 *                         gated-path-only affordance (there is NO
 *                         direct-execution variant — the surface
 *                         contracts make one-click execution
 *                         unrepresentable).
 *
 * src/ imports: `@fleetos/contracts` ONLY (the cross-lane seam). Every
 * domain surface is consumed through the structural seams with the
 * real packages injected at binding sites (test files may import
 * across lanes — the established pattern).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

// The structural seams over the recovery + fleet-action domains
export * from "./seams";

// D1 — Find My Device (the last-seen evidence ledger, read-only)
export * from "./find-my-device";

// D2 — the recovery case surfaces (PROPOSAL-gated transitions, visible)
export * from "./recovery-case";

// D3 — the Fleet Action surfaces (group selection + parked-visible plans)
export * from "./fleet-actions";

// D4 — the destructive action surfaces (gated path ONLY)
export * from "./destructive-actions";

// W090A — the local console design tokens + status vocabulary
export * from "./ui/tokens";
export * from "./ui/status";

// W090A — the local shadcn-style component vocabulary (plain React + CSS)
export * from "./ui/primitives";

// W090A — the rendered screens (presentational, fully controlled)
export * from "./screens/recovery-cases-screen";
export * from "./screens/find-my-device-screen";
export * from "./screens/destructive-action-screen";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "web-recovery" as const;
export const MODULE_VERSION = "0.1.0" as const;
