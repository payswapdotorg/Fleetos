/**
 * @fleetos/web-shell — the Control Tower (W061 [TL]).
 *
 * Navigation, permissions, cross-surface journeys, discoverability and
 * end-to-end UX coherence over the six UI surface lanes (web-device,
 * web-recovery, web-security, web-actions, web-workloads and
 * web-commerce — bound structurally; see src/seams.ts).
 *
 * Pure TypeScript view-models + state machines: no clock, no entropy,
 * no I/O, no `any`; src/ imports the shared contracts seam ONLY (the
 * ownership discipline); REAL surface bindings live in test/.
 */
export * from "./seams";
export * from "./navigation";
export * from "./permissions";
export * from "./journeys";
export * from "./discoverability";
export * from "./coherence";

export const MODULE_NAME = "web-shell" as const;
export const MODULE_VERSION = "0.1.0" as const;
