/**
 * @fleetos/web-shell — the Control Tower (W061 [TL] + W091 [TL]).
 *
 * Navigation (the FINAL ten-area route vocabulary), permissions,
 * cross-surface journeys (the complete design-contract acceptance
 * set), discoverability (deterministic global search), end-to-end UX
 * coherence, the Control Tower view-model, the Evidence & Audit
 * view-models — and, since W091, the RENDERED application chrome
 * (AppShell with responsive navigation + the global command palette)
 * and the Control Tower / Evidence screens, built on the shared
 * design tokens (spec/ui/CONSOLE-DESIGN.md).
 *
 * View-models are pure TypeScript: no clock, no entropy, no I/O, no
 * `any`; src/ imports the shared contracts seam ONLY (the ownership
 * discipline); REAL surface bindings live in test/.
 */
export * from "./seams";
export * from "./navigation";
export * from "./permissions";
export * from "./journeys";
export * from "./discoverability";
export * from "./coherence";
export * from "./control-tower";
export * from "./evidence-view";

// W091 — the shared design system + the rendered shell chrome
export * from "./ui/tokens";
export * from "./ui/status";
export * from "./ui/primitives";
export * from "./app-shell";
export * from "./screens/control-tower-screen";
export * from "./screens/evidence-screen";

export const MODULE_NAME = "web-shell" as const;
export const MODULE_VERSION = "0.2.0" as const;
