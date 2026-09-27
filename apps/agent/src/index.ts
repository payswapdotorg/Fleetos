/**
 * @fleetos/agent — Public API.
 *
 * Lane A (worker-a) device agent runtime (W010). A thin composition
 * layer wiring the device-adapters runtime contract modules into a
 * single `AgentRuntime` entry type.
 *
 *   runtime.ts   — the AgentRuntime composition: identity, declared
 *                  capabilities, observation collector, command receipt
 *                  tracker, local signed-policy cache, and the
 *                  operations an agent performs against the control
 *                  plane (check-in, capability negotiation,
 *                  observation flush, command acknowledge, consequential
 *                  authorization).
 *
 * The full runtime-contract surface (check-in handshake types,
 * capability negotiation, observation batching, command receipt, local
 * signed-policy cache) lives in `@fleetos/device-adapters`. This
 * package composes them.
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). No `any` in public signatures.
 * No runtime dependencies. No clock reads — every timestamp is injected
 * by the caller.
 */

// AgentRuntime composition
export * from "./runtime";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "agent" as const;
export const MODULE_VERSION = "0.1.0" as const;
