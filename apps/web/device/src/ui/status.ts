/**
 * @fleetos/web-device — the console STATUS vocabulary (W090A).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable domain vocabularies (posture
 * summaries, staleness bands, Guardian decisions, request statuses,
 * interpretation statuses, execution outcomes) onto the console
 * vocabulary. PURE and DETERMINISTIC: verbatim domain values are
 * always displayed ALONGSIDE the semantic indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

import { isBlockingDecision } from "@fleetos/contracts";
import type { GuardianDecisionType } from "@fleetos/contracts";
import type { StalenessBand } from "../device-list";

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
 * Map a security posture summary (the twin's verbatim domain value)
 * onto the console vocabulary. Unknown values map to `unknown` —
 * never a guess.
 */
export function postureConsoleStatus(postureSummary: string): ConsoleStatus {
  switch (postureSummary) {
    case "HEALTHY":
      return "healthy";
    case "AT_RISK":
      return "needs_attention";
    case "COMPROMISED":
      return "blocked";
    default:
      return "unknown";
  }
}

/** Map a telemetry staleness band onto the console vocabulary. PURE. */
export function stalenessConsoleStatus(band: StalenessBand): ConsoleStatus {
  switch (band) {
    case "fresh":
      return "healthy";
    case "stale":
      return "needs_attention";
    case "never_observed":
    case "unknown":
      return "unknown";
  }
}

/**
 * Map a Contract Guardian decision (the frozen contracts union) onto
 * the console vocabulary. PURE — the blocking semantics stay the
 * frozen `isBlockingDecision` helper's.
 */
export function guardianConsoleStatus(
  decision: GuardianDecisionType | "not_evaluated",
): ConsoleStatus {
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

/** Is the given Guardian decision blocking (the frozen semantics)? PURE. */
export function guardianIsBlocking(decision: GuardianDecisionType | "not_evaluated"): boolean {
  return decision !== "not_evaluated" && isBlockingDecision(decision);
}

/**
 * Map a destructive-request / plan status (the injected machine's
 * verbatim status string) onto the console vocabulary. Unknown values
 * map to `unknown` — the surface never invents a state.
 */
export function requestConsoleStatus(status: string): ConsoleStatus {
  switch (status) {
    case "REQUESTED":
    case "PROPOSAL":
      return "informational";
    case "PARKED":
    case "ADVANCED":
      return "approval_required";
    case "APPROVED":
      return "healthy";
    case "EXECUTED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "REJECTED":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * Map a versioned-interpretation status (ACTIVE / SUPERSEDED /
 * DISMISSED) onto the console vocabulary: the CURRENT interpretation
 * is informational (calm), lineage states are unknown-neutral.
 */
export function interpretationConsoleStatus(
  status: "ACTIVE" | "SUPERSEDED" | "DISMISSED",
): ConsoleStatus {
  switch (status) {
    case "ACTIVE":
      return "informational";
    default:
      return "unknown";
  }
}

/** Map an anomaly severity (the health domain's vocabulary). PURE. */
export function anomalyConsoleStatus(severity: string): ConsoleStatus {
  switch (severity) {
    case "CRITICAL":
      return "needs_attention";
    case "WARNING":
      return "informational";
    default:
      return "unknown";
  }
}

/**
 * Map a recovery-case status (the injected machine's verbatim string)
 * onto the console vocabulary. The active statuses are the ones the
 * INJECTED table marks active — passed in by the caller (the surface
 * never re-derives the domain's active set).
 */
export function caseConsoleStatus(
  status: string,
  isActive: boolean,
  isTerminal: boolean,
): ConsoleStatus {
  if (isActive) return "needs_attention";
  if (status === "CLOSED" || isTerminal) return "succeeded";
  return "informational";
}
