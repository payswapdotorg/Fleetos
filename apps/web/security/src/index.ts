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
 *   policies-view.ts          D1.2 (W090B) — Policies as a FIRST-CLASS
 *                              area: the frozen policy surfaces (rule
 *                              sets, rules, decision history) rendered
 *                              read-only through structural seams over
 *                              @fleetos/policy's GuardianRule /
 *                              GuardianRuleSet records.
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

// D1.2 (W090B) — the first-class Policies surface (read-only).
export * from "./policies-view";

// W100B — the ROLE LENS experience contract (the frozen role model
// consumed as a public experience contract; the lens grants NOTHING).
export * from "./role-lens";

// W100B — the role-shaped findings surface (emphasis changes; the
// record projection is lens-independent).
export * from "./findings-role-view";

// W100B — the parked-approval explanation ("why is this action parked,
// and what unlocks it?" — the decision chain + the escalation path).
export * from "./approval-explanation-view";

// W090B — the local console design tokens + status vocabulary.
export * from "./ui/tokens";
export * from "./ui/status";

// W090B — the local shadcn-style component vocabulary (plain React + CSS).
export * from "./ui/primitives";

// W090B — the rendered screens (presentational, fully controlled).
export * from "./screens/findings-screen";
export * from "./screens/guardian-decisions-screen";
export * from "./screens/approvals-queue-screen";
export * from "./screens/security-doctor-screen";
export * from "./screens/policies-screen";
// W100B — the rendered role-lens + parked-explanation sections.
export * from "./screens/role-lens-section";
export * from "./screens/parked-explanation-section";

// W142 — the honest lane phase vocabulary + the runtime state seams +
// the Security Doctor journey + the runtime composition feed.
export * from "./lane-phase";
export * from "./seams";
export * from "./security-journey";
export * from "./security-feed";

// W142 — the Approvals EXECUTION path (the report's central demand):
// the Approve/Reject decision lifecycle machine — confirmation gates,
// RBAC denials, audit seam, evidence trail, duplicate-safe handling.
export * from "./approvals-execution";

// W142 — the gated destructive controls (disable enrollment code,
// revoke device trust) — confirmation flows with feedback + audit +
// explicit denials (never a silent no-op).
export * from "./destructive-controls";

// The tagged error/result contract of every builder.
export type { SurfaceError, SurfaceResult, SurfaceValidationFailure } from "./internal";

// W001-style placeholder markers (the module identity contract).
export const MODULE_NAME = "web-security" as const;
export const MODULE_VERSION = "0.1.0" as const;
