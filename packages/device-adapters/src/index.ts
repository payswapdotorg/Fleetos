/**
 * @fleetos/device-adapters — Public API.
 *
 * Lane A (worker-a) implementation of the device-side agent runtime
 * contract (W010). The lane builds the runtime contract for the
 * device-side agent using the frozen `@fleetos/contracts` surface:
 *
 *   checkin.ts        D1 — agent check-in / registration handshake
 *                          (identity, version, session token, ack)
 *   capabilities.ts   D2 — capability discovery + negotiation; REFUSES
 *                          unsupported destructive behavior (never
 *                          emulates it; offline default-deny for
 *                          destructive actions on a stale policy cache)
 *   observations.ts   D3 — agent-side observation collector that
 *                          assembles valid ObservationBatch values
 *                          (contracts shape) with deterministic
 *                          sequencing; the producer never emits a batch
 *                          the contracts invariants would reject
 *   commands.ts       D4 — command receipt + execution result for
 *                          CommandEnvelope delivery; status
 *                          (accepted/executing/succeeded/failed/rejected),
 *                          evidence fields, FleetError mapping from the
 *                          contracts taxonomy; idempotent by command
 *                          idempotency key (contracts duplicate-
 *                          suppression contract)
 *   policy-cache.ts   D5 — local signed-policy cache: versioned policy
 *                          document (opaque payload ok), signature
 *                          verification seam (verify function injected —
 *                          no crypto runtime dep), staleness rules
 *                          (max-age, must-refetch semantics), and
 *                          default-deny for consequential actions when
 *                          stale/offline
 *   internal.ts       — internal helpers (NOT re-exported): canonical
 *                          JSON, FNV-1a digest, ISO sanity, frozen
 *                          helpers, FleetError constructors mapped onto
 *                          the contracts taxonomy, stable error codes
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 * No runtime dependencies. No clock reads — every timestamp is injected
 * by the caller.
 */

// D1 — Agent check-in / registration handshake
export * from "./checkin";

// D2 — Capability discovery + negotiation
export * from "./capabilities";

// D3 — Agent-side observation batching
export * from "./observations";

// D4 — Command receipt + execution result
export * from "./commands";

// D5 — Local signed-policy cache
export * from "./policy-cache";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "device-adapters" as const;
export const MODULE_VERSION = "0.1.0" as const;
