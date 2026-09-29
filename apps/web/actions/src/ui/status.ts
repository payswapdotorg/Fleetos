/**
 * @fleetos/web-actions — the console STATUS vocabulary (W090B).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable actions vocabularies (plan
 * statuses, print job statuses, Guardian decisions) onto the console
 * vocabulary. PURE and DETERMINISTIC: verbatim domain values are
 * ALWAYS displayed ALONGSIDE the semantic indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

import type {
  SurfaceDecisionType,
  SurfacePlanStatus,
  SurfacePrintJobStatus,
} from "../surface-contracts";

// ---------------------------------------------------------------------------
// The console status vocabulary
// ---------------------------------------------------------------------------

/** The console status vocabulary (the design contract's nine states). */
export type ConsoleStatus =
  | "healthy"
  | "informational"
  | "needs_attention"
  | "approval_required"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

/** The canonical display order (deterministic facet/legend ordering). */
export const CONSOLE_STATUS_ORDER: readonly ConsoleStatus[] = Object.freeze([
  "healthy",
  "informational",
  "needs_attention",
  "approval_required",
  "blocked",
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const);

/** The human display label of each status (ALWAYS rendered with the dot). */
export const CONSOLE_STATUS_LABEL: Readonly<Record<ConsoleStatus, string>> = Object.freeze({
  healthy: "Healthy",
  informational: "Informational",
  needs_attention: "Needs attention",
  approval_required: "Approval required",
  blocked: "Blocked",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  unknown: "Unknown",
} as const);

// ---------------------------------------------------------------------------
// Domain -> console mappings (pure)
// ---------------------------------------------------------------------------

/**
 * Map a Contract Guardian decision (the frozen union) onto the console
 * vocabulary: ALLOW -> Healthy; WARN -> Informational;
 * REQUIRE_APPROVAL -> Approval required; BLOCK -> Blocked.
 */
export function decisionConsoleStatus(decision: SurfaceDecisionType): ConsoleStatus {
  switch (decision) {
    case "ALLOW":
      return "healthy";
    case "WARN":
      return "informational";
    case "REQUIRE_APPROVAL":
      return "approval_required";
    case "BLOCK":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map an action-plan status (the W041 policy-gate statuses) onto the
 * console vocabulary. PROPOSAL -> Informational (a proposal, never an
 * execution); PARKED -> Approval required; ADVANCED/APPROVED ->
 * Healthy (the gate passed — execution is downstream and the screen
 * always discloses the handoff); REJECTED -> Blocked.
 */
export function planConsoleStatus(status: SurfacePlanStatus): ConsoleStatus {
  switch (status) {
    case "PROPOSAL":
      return "informational";
    case "PARKED":
      return "approval_required";
    case "ADVANCED":
    case "APPROVED":
      return "healthy";
    case "REJECTED":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a print job status onto the console vocabulary with the
 * Running/Succeeded/Failed semantics: ROUTED/QUEUED -> Running;
 * COMPLETED -> Succeeded; REFUSED -> Failed (the routing refusal is
 * visible and actionable, never a hidden technical error).
 */
export function printConsoleStatus(status: SurfacePrintJobStatus): ConsoleStatus {
  switch (status) {
    case "ROUTED":
    case "QUEUED":
      return "running";
    case "COMPLETED":
      return "succeeded";
    case "REFUSED":
      return "failed";
    default:
      return "unknown";
  }
}
