/**
 * @fleetos/recovery — Public API.
 *
 * Lane A (worker-a) implementation of FleetOS Recovery + Find My Device
 * (W040): last-seen evidence, recovery cases, the gated destructive
 * recovery actions (lock/locate/wipe/reboot), and warranty-aware
 * replacement escalation.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   last-seen.ts          D1 — the deterministic last-seen evidence
 *                          ledger per device, derived from canonical
 *                          observation batches (the FROZEN contracts
 *                          `Observation`/`ObservationBatch` shapes), with
 *                          injected-threshold staleness classification
 *                          and the Find-My-Device view (the latest
 *                          location-bearing evidence; absent location
 *                          evidence is machine-stable
 *                          `no_location_evidence` — never a guess).
 *   recovery-case.ts      D2 — recovery cases + the typed state machine
 *                          (OPENED -> SECURING -> SECURED / ESCALATED ->
 *                          REPLACEMENT_PROPOSED / CLOSED with
 *                          machine-stable closure reasons), versioned
 *                          PROPOSAL-gated transitions, and the evidence
 *                          basis (last-seen + posture finding refs).
 *   policy-seam.ts        D3a — the injected Contract Guardian
 *                          evaluation seam (structurally satisfied by
 *                          `@fleetos/policy`'s `evaluateGuardianRequest`,
 *                          injected at the binding site — proven by test
 *                          against the real engine).
 *   destructive-request.ts D3b — the destructive request record model
 *                          (the FROZEN `RecoveryIntentPayload` consumed
 *                          VERBATIM as the durable intent record) + the
 *                          tenant-partitioned append-only store.
 *   destructive-gate.ts   D3c — the destructive recovery gate:
 *                          capability-aware refusals BEFORE any seam
 *                          call, Guardian routing (ALLOW/WARN advance +
 *                          dispatch, REQUIRE_APPROVAL parks, BLOCK
 *                          rejects with machine-stable reasons — never
 *                          auto-execute), the human-approval step
 *                          (parked -> approved/rejected), and execution
 *                          dispatch through the W020 `EndpointAdapter`
 *                          seam with the full §16 evidence trail.
 *   replacement.ts        D4 — warranty-aware replacement escalation
 *                          records consuming W021 health's DRAFT
 *                          `ReplacementIntentPayload` diagnoses + W032
 *                          vendor warranty terms; PROPOSALS only
 *                          (append-only ledger, supersession discipline
 *                          — never automatic procurement).
 *   audit-seam.ts         D5 — the injected audit sink interface
 *                          (W011/W021/W022/W031/W041's pattern;
 *                          structurally satisfied by @fleetos/audit's
 *                          sink adapter — proven by test).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian in `@fleetos/policy`) remains the
 * sole authority for consequential actions — REQUIRE_APPROVAL parks,
 * BLOCK rejects, and NOTHING here auto-executes. Capability-aware
 * adapters (W020/W030 in `@fleetos/device-adapters`, same lane) refuse
 * UNSUPPORTED capabilities with machine-stable reasons — never
 * emulated. Escalations and transitions are versioned PROPOSALS.
 *
 * Cross-lane domain types come from @fleetos/contracts only; the
 * same-lane device-adapters import is the injected adapter seam. No
 * `any` in public signatures.
 */

// D5 — the audit emission seam (W011/W021/W022/W031/W041's pattern)
export * from "./audit-seam";

// D1 — last-seen evidence + Find My Device
export * from "./last-seen";

// D2 — recovery cases + the typed state machine
export * from "./recovery-case";

// D3a — the injected Contract Guardian evaluation seam
export * from "./policy-seam";

// D3b — the destructive request record model + store
export * from "./destructive-request";

// D3c — the destructive recovery gate (Guardian routing + capability-aware dispatch)
export * from "./destructive-gate";

// D4 — warranty-aware replacement escalation
export * from "./replacement";

// W071 — The data-minimization projection over recovery evidence
// (location payloads dropped unless a typed disclosure grant is
// present — approver + instant, never ambient; machine-stable
// redaction reasons; disclosure + redaction audited).
export * from "./minimization";

// W071 — The destructive-intent review surface (every destructive
// intent presented with its FULL §16 evidence bundle; a missing
// evidence field refuses machine-stably BEFORE the W040 gate runs).
export * from "./destructive-review";

// The tenant-scope guard (public seam; declared in internal.ts)
export type { RecoveryTenantScope } from "./internal";
export { checkRecoveryTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "recovery" as const;
export const MODULE_VERSION = "0.1.0" as const;
