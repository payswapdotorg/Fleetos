/**
 * @fleetos/web-security — the console STATUS vocabulary (W090B).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable security vocabularies (finding
 * severities, Guardian decisions, plan statuses) onto the console
 * vocabulary. PURE and DETERMINISTIC: verbatim domain values are
 * ALWAYS displayed ALONGSIDE the semantic indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

import type { SurfaceDecisionType, SurfacePlanStatus, SurfaceSeverity } from "../surface-contracts";

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
 * Map a finding severity (the W031 posture model's frozen severities)
 * onto the console vocabulary: CRITICAL/HIGH need attention;
 * MEDIUM/LOW are informational. The verbatim severity word is ALWAYS
 * displayed alongside (never color-alone).
 */
export function severityConsoleStatus(severity: SurfaceSeverity): ConsoleStatus {
  switch (severity) {
    case "CRITICAL":
    case "HIGH":
      return "needs_attention";
    case "MEDIUM":
    case "LOW":
      return "informational";
    default:
      return "unknown";
  }
}

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
 * execution); PARKED -> Approval required (held for the human
 * decision); ADVANCED -> Healthy (the gate passed; downstream
 * dispatch); APPROVED -> Healthy (the approval granted; execution is
 * downstream — the screen always discloses the handoff); REJECTED ->
 * Blocked (the Guardian refused or the human rejected).
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
