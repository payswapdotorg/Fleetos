/**
 * @fleetos/integration-adcos — Public API.
 *
 * Lane A (worker-a) implementation of the ADCOS integration adapter
 * (W050A): the bidirectional connectivity-intent translation, the
 * provider-neutral transport boundary, the policy-gated submission flow
 * and the versioned status/degradation adoption.
 *
 * Per `spec/ARCHITECTURE-LOCK.md` items 7-8: ADCOS, Arena and Aurum
 * integrate through provider-neutral contracts; ADCOS owns
 * network-native topology/path execution, FleetOS owns fleet
 * connectivity intent and device/workload policy. Per
 * `spec/integration/ADCOS.md`: provider topology, native credentials
 * and provider SDK objects NEVER enter this package's public surface —
 * the opaque `AdcosProviderHandle` is the one provider-originated value
 * type, and every transport goes through the injected
 * `AdcosTransportPort` seam (the in-memory deterministic reference
 * implementation ships for tests; the real provider binding is a later
 * work item).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   outcomes.ts           D1 — the canonical connectivity outcome
 *                          vocabulary (the four spec examples; anything
 *                          else is refused `unsupported_outcome` —
 *                          never a guess, never a silent default).
 *   request-model.ts      D1 — the typed, provider-neutral request
 *                          model + the requirement-profile validation
 *                          (machine-stable refusal reasons).
 *   translation.ts        D1 — the forward translation: the FROZEN
 *                          ConnectivityIntent envelope + requirements
 *                          -> the typed `AdcosConnectivityRequest`
 *                          (deterministic request digest).
 *   status-model.ts       D1 — the reverse-direction typed shapes:
 *                          execution-state lifecycle, evidence-carrying
 *                          measurements, degradation/failure taxonomies,
 *                          termination, accepted requirements + the
 *                          report validation/normalization.
 *   provider-boundary.ts  D2 — the opaque provider handle + the
 *                          provider-neutral plain-data boundary checks
 *                          (denied-key denylist; SDK objects/functions
 *                          refused — enforced at runtime, asserted by
 *                          tests).
 *   transport-seam.ts     D2 — the injected transport port (typed
 *                          request/response; machine-stable provider
 *                          refusal taxonomy).
 *   inmemory-transport.ts D2 — the in-memory deterministic reference
 *                          transport (invocation recording, programmed
 *                          refusals, no network, no clock).
 *   policy-seam.ts        D3a — the injected Contract Guardian
 *                          evaluation seam (structurally satisfied by
 *                          `@fleetos/policy`'s evaluateGuardianRequest,
 *                          injected at the binding site — proven by test
 *                          against the real engine).
 *   submission.ts         D3b — the submission record model (typed
 *                          lifecycle PROPOSED -> SUBMITTED | PARKED |
 *                          REJECTED; PARKED -> APPROVED | REJECTED) +
 *                          the tenant-partitioned store.
 *   submission-gate.ts    D3c — the policy-gated submission flow:
 *                          ALLOW/WARN submit (WARN non-blocking per the
 *                          frozen helper), REQUIRE_APPROVAL parks, BLOCK
 *                          rejects — NEVER auto-submit; human approval
 *                          dispatches; provider refusals are typed.
 *   adoption.ts           D3d — the versioned append-only connectivity
 *                          record store + the status adoption
 *                          (idempotent by report content digest,
 *                          hash-linked revisions) and termination flows
 *                          + the unmet-requirements diff.
 *   audit-seam.ts         D4 — the injected audit sink interface
 *                          (the W011/W021/W022/W031/W040/W041 pattern;
 *                          structurally satisfied by @fleetos/audit's
 *                          sink adapter — proven by test into the
 *                          hash-chained AuditLog).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the deterministic policy
 * layer (the W031 Contract Guardian in `@fleetos/policy`) remains the
 * sole authority for consequential submissions — REQUIRE_APPROVAL
 * parks, BLOCK rejects, and NOTHING here auto-submits. Cross-lane
 * domain types come from @fleetos/contracts only; no `any` in public
 * signatures.
 */

// D1 — the canonical outcome vocabulary + the bidirectional translation
export * from "./outcomes";
export * from "./request-model";
export * from "./translation";
export * from "./status-model";

// D2 — the provider-neutral boundary + the injected transport seam
export * from "./provider-boundary";
export * from "./transport-seam";
export * from "./inmemory-transport";

// D3a — the injected Contract Guardian evaluation seam
export * from "./policy-seam";

// D3b/D3c — the submission model + the policy-gated submission gate
export * from "./submission";
export * from "./submission-gate";

// D3d — the adoption + termination flows
export * from "./adoption";

// D4 — the audit emission seam
export * from "./audit-seam";

// W001 placeholder markers (kept for the baseline placeholder test; the
// skeleton gate pins every package.json at 0.1.0).
export const MODULE_NAME = "integration-adcos" as const;
export const MODULE_VERSION = "0.1.0" as const;
