/**
 * @fleetos/web-actions — Public API (W060B, lane B).
 *
 * The Fleet Actions + print workflow UI SURFACE: pure, typed,
 * deterministic view-models + state machines for the W061 Control
 * Tower shell to render. NOT a rendered app.
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no
 * clock reads, no entropy, no I/O — every timestamp is injected by the
 * caller):
 *
 *   surface-contracts.ts    the acting tenant scope + the STRUCTURAL
 *                           seam types the real W041 domain records
 *                           satisfy (ActionPlanTemplate,
 *                           DeviceGroupSelector, PrintJobRequest,
 *                           PrinterDescriptor, the frozen
 *                           GuardianDecision) + the frozen decision
 *                           tables — bound at the binding site, proven
 *                           by test.
 *   decision-context.ts     the Guardian decision context projection
 *                           (observable fields only — LOCK 11).
 *   action-plans-view.ts    the group selection view + the
 *                           policy-gated plan presentation state
 *                           machine + the plan progression (explicit
 *                           gated transitions; PROPOSAL -> approval ->
 *                           dispatch; parked states visible; refusal
 *                           states machine-stable).
 *   print-routing-view.ts   the print routing presentation (routing
 *                           refusals visible, never emulated) + the
 *                           capability-gate mirror.
 *
 * Decision boundary: the deterministic policy layer (the Contract
 * Guardian) remains AUTHORITATIVE; the W041 actions package owns the
 * plan lifecycle and print routing. This surface presents observable
 * outcomes only and NEVER creates, dispatches or executes a Fleet
 * Intent (LOCK 16: the gated path is exposed with its decision
 * context, not a button; an APPROVED plan discloses the downstream
 * dispatch handoff). src/ imports the shared seam `@fleetos/contracts`
 * ONLY — the domain packages are bound via structural seams in test/
 * (the W040-disclosed pattern).
 */

// The structural seam types + tenant scope (the binding contract).
export * from "./surface-contracts";

// The Guardian decision context projection.
export * from "./decision-context";

// The Fleet Action plan surfaces.
export * from "./action-plans-view";

// The print orchestration surface.
export * from "./print-routing-view";

// The tagged error/result contract of every builder.
export type { SurfaceError, SurfaceResult, SurfaceValidationFailure } from "./internal";

// W001-style placeholder markers (the module identity contract).
export const MODULE_NAME = "web-actions" as const;
export const MODULE_VERSION = "0.1.0" as const;
