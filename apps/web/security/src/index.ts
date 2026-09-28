/**
 * @fleetos/web-security — Public API (W060B, lane B).
 *
 * The security/policy UI SURFACE: pure, typed, deterministic
 * view-models + state machines for the W061 Control Tower shell to
 * render. NOT a rendered app.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no
 * clock reads, no entropy, no I/O — every timestamp is injected by the
 * caller):
 *
 *   surface-contracts.ts       the acting tenant scope + the STRUCTURAL
 *                              seam types the real domain records
 *                              satisfy (W031 SecurityFinding, the
 *                              frozen GuardianDecision, the W031
 *                              GuardianEvaluation, the W041 parked
 *                              ActionPlanTemplate) — bound at the
 *                              binding site, proven by test.
 *   findings-view.ts           D1 — the Security Doctor findings list
 *                              view-model: severity ordering
 *                              machine-stable, evidence refs OPAQUE,
 *                              remediations as PROPOSALs (never direct
 *                              execution).
 *   guardian-decision-view.ts  D2 — the Contract Guardian decision
 *                              presentation (engine's machine-stable
 *                              reasons, matched rules, evidence) +
 *                              the read-only BLOCK history.
 *   approvals-queue-view.ts   D3 — the parked approvals queue
 *                              (REQUIRE_APPROVAL items with their
 *                              human-gated approval transitions).
 *
 * Decision boundary: the deterministic policy layer (the Contract
 * Guardian, `@fleetos/policy`) remains AUTHORITATIVE. This surface
 * presents observable evidence only (LOCK 11: never an intent
 * assertion) and NEVER creates, dispatches or executes a Fleet Intent
 * (LOCK 16: the gated path is exposed with its decision context, not
 * a button). src/ imports the shared seam `@fleetos/contracts` ONLY —
 * the domain packages are bound via structural seams in test/ (the
 * W040-disclosed pattern).
 */

// The structural seam types + tenant scope (the binding contract).
export * from "./surface-contracts";

// D1 — the findings surface.
export * from "./findings-view";

// D2 — the Guardian decision presentation + BLOCK history.
export * from "./guardian-decision-view";

// D3 — the parked approvals queue.
export * from "./approvals-queue-view";

// The tagged error/result contract of every builder.
export type { SurfaceError, SurfaceResult, SurfaceValidationFailure } from "./internal";

// W001-style placeholder markers (the module identity contract).
export const MODULE_NAME = "web-security" as const;
export const MODULE_VERSION = "0.1.0" as const;
