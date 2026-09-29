/**
 * @fleetos/web-workloads — the console STATUS vocabulary (W090C).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable domain vocabularies of the
 * workload-planning surface (recommendation display statuses, LOCK 12
 * linkage statuses, deadline-pressure buckets, fit verdicts, journey
 * stage states) onto the console vocabulary. PURE and DETERMINISTIC:
 * verbatim domain values are always displayed ALONGSIDE the semantic
 * indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

import type { RecommendationDisplayStatus } from "../recommendations";
import type { WorkloadResourceLinkageStatus } from "../resources";

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
 * Map a versioned-recommendation display status (ACTIVE / SUPERSEDED /
 * DISMISSED) onto the console vocabulary: the CURRENT recommendation
 * is informational (calm — a proposal, never an alert); lineage states
 * are unknown-neutral (history, not health).
 */
export function recommendationConsoleStatus(status: RecommendationDisplayStatus): ConsoleStatus {
  switch (status) {
    case "ACTIVE":
      return "informational";
    default:
      return "unknown";
  }
}

/**
 * Map a LOCK 12 resource-linkage status onto the console vocabulary.
 * The W050A submission statuses are surfaced VERBATIM alongside the
 * semantic indicator (PROPOSED/SUBMITTED/PARKED/APPROVED/REJECTED).
 */
export function linkageConsoleStatus(status: WorkloadResourceLinkageStatus): ConsoleStatus {
  switch (status) {
    case "fielded_class":
    case "allocated":
    case "APPROVED":
      return "healthy";
    case "procurement_required":
    case "open":
      return "needs_attention";
    case "PROPOSED":
      return "informational";
    case "SUBMITTED":
      return "running";
    case "PARKED":
      return "approval_required";
    case "REJECTED":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a deadline-pressure bucket (overdue/critical/urgent/soon/
 * comfortable) onto the console vocabulary: overdue is Blocked, the
 * near buckets need attention, comfortable is Healthy.
 */
export function deadlinePressureConsoleStatus(
  bucket: "overdue" | "critical" | "urgent" | "soon" | "comfortable",
): ConsoleStatus {
  switch (bucket) {
    case "overdue":
      return "blocked";
    case "critical":
    case "urgent":
      return "needs_attention";
    case "soon":
      return "informational";
    case "comfortable":
      return "healthy";
    default:
      return "unknown";
  }
}

/**
 * Map a fit verdict (the soft threshold + the hard constraint gate)
 * onto the console vocabulary: a fully passing fit is Healthy; a
 * hard-gate failure is Blocked (the candidate is ineligible); a
 * below-threshold soft score is Needs attention.
 */
export function fitConsoleStatus(fit: {
  readonly meetsThreshold: boolean;
  readonly constraintsSatisfied: boolean;
}): ConsoleStatus {
  if (!fit.constraintsSatisfied) return "blocked";
  if (!fit.meetsThreshold) return "needs_attention";
  return "healthy";
}

/** The journey stage display state (machine-stable, W090C D3). */
export type JourneyStageState = "done" | "current" | "pending" | "approval" | "blocked";

/**
 * Map a journey stage state onto the console vocabulary: completed
 * stages are Succeeded; the stage awaiting a human approval is
 * Approval required; a refused stage is Blocked; the journey's
 * current stage is Running; future stages are Unknown (not yet
 * reached — never a guess).
 */
export function journeyStageConsoleStatus(state: JourneyStageState): ConsoleStatus {
  switch (state) {
    case "done":
      return "succeeded";
    case "current":
      return "running";
    case "approval":
      return "approval_required";
    case "blocked":
      return "blocked";
    case "pending":
      return "unknown";
    default:
      return "unknown";
  }
}
