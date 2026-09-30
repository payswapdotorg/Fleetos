/**
 * @fleetos/web-learning — Public API (W090B, lane B).
 *
 * The Learning/Arena UI SURFACE (the UX simulation's ❌ gap, closed):
 * pure, typed, deterministic VIEW-MODELS over STRUCTURAL seams that
 * the real `@fleetos/learning` (W070) records satisfy, plus the
 * RENDERED LearningScreen React component (presentational, fully
 * controlled).
 *
 * Module map (all pure, zero runtime dependencies beyond React for
 * the screens, strict TS, no clock reads, no entropy, no I/O — every
 * timestamp is injected by the caller):
 *
 *   seams.ts         the acting tenant scope + the STRUCTURAL seam
 *                   types the real W070 records satisfy
 *                   (OutcomeObservation, the Guardian-gated
 *                   EvaluationCaseSubmissionProposal, the versioned
 *                   LearningAdoptionRecord) — bound at the binding
 *                   site, proven by test.
 *   learning-view.ts the three view builders: the outcome observation
 *                   feed, the evaluation-case submissions view
 *                   (problem class, labels, redaction state,
 *                   disposition), and the capability adoption ledger
 *                   view (versioned, supersession visible,
 *                   certification state + the explicit human grant).
 *   ui/             the LOCAL console design tokens, the nine-state
 *                   status vocabulary, and the local shadcn-style
 *                   component vocabulary (plain React + CSS).
 *   screens/        the rendered LearningScreen (evaluation cases +
 *                   adoption ledger + certification status; arena
 *                   capability inspection).
 *
 * Decision boundary: the W070 learning package remains AUTHORITATIVE
 * (Arena owns capability learning/certification; FleetOS owns
 * operational adoption — LOCK 9). This surface presents observable
 * records only and NEVER submits, adopts, supersedes or certifies
 * anything (LOCK 4/16: the gated paths are visible with their
 * decision context, never one-click). src/ imports the shared seam
 * `@fleetos/contracts` ONLY — the domain package is bound via
 * structural seams in test/ (the W040-disclosed pattern;
 * `@fleetos/learning` is a DEV-dependency).
 */

// The structural seam types + tenant scope (the binding contract).
export * from "./seams";

// The pure view-models (the W060 pattern over the W070 records).
export * from "./learning-view";

// W100B — the ROLE LENS experience contract (the frozen role model
// consumed as a public experience contract; the lens grants NOTHING).
export * from "./role-lens";

// W100B — the role-shaped learning surface with evaluation-case
// rationale and capability-adoption explanations.
export * from "./learning-role-view";

// The local console design tokens + status vocabulary.
export * from "./ui/tokens";
export * from "./ui/status";

// The local shadcn-style component vocabulary (plain React + CSS).
export * from "./ui/primitives";

// The rendered screen (presentational, fully controlled).
export * from "./screens/learning-screen";
// W100B — the rendered role-lens section.
export * from "./screens/role-lens-section";

// The tagged error/result contract of every builder.
export type {
  SurfaceError,
  SurfaceResult,
  SurfaceValidationFailure,
} from "./internal";

// W001-style placeholder markers (the module identity contract).
export const MODULE_NAME = "web-learning" as const;
export const MODULE_VERSION = "0.1.0" as const;
