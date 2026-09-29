/**
 * @fleetos/web-learning — the console STATUS vocabulary (W090B).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable learning vocabularies
 * (evaluation dispositions, adoption statuses, compatibility
 * statements, rollout kinds) onto the console vocabulary. PURE and
 * DETERMINISTIC: verbatim domain values are ALWAYS displayed
 * ALONGSIDE the semantic indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

import type {
  AdoptionStatus,
  EvaluationDisposition,
  GuardianDecisionKind,
  RedactionState,
} from "../seams";

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
 * Map a Contract Guardian decision type onto the console vocabulary.
 * ALLOW -> Healthy; WARN -> Informational; REQUIRE_APPROVAL ->
 * Approval required; BLOCK -> Blocked.
 */
export function guardianConsoleStatus(decision: GuardianDecisionKind): ConsoleStatus {
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
 * Map an evaluation-case disposition (the Guardian decision's
 * projection) onto the console vocabulary: PROPOSED -> Informational
 * (a proposal, never submitted); PARKED -> Approval required (held
 * for human review, never auto-submitted); REJECTED -> Blocked.
 */
export function dispositionConsoleStatus(disposition: EvaluationDisposition): ConsoleStatus {
  switch (disposition) {
    case "PROPOSED":
      return "informational";
    case "PARKED":
      return "approval_required";
    case "REJECTED":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map an adoption revision status onto the console vocabulary: the
 * current revision of an adoption is Healthy; a superseded revision
 * is Informational (calm lineage, never an alarm).
 */
export function adoptionConsoleStatus(status: AdoptionStatus, isLatest: boolean): ConsoleStatus {
  if (isLatest) return "healthy";
  return status === "SUPERSEDED" ? "informational" : "unknown";
}

/**
 * Map a FleetOS compatibility statement (Arena's verbatim statement)
 * onto the console vocabulary: compatible -> Healthy;
 * compatible_with_warnings -> Informational (warnings listed
 * alongside); incompatible -> Blocked.
 */
export function compatibilityConsoleStatus(statement: string): ConsoleStatus {
  switch (statement) {
    case "compatible":
      return "healthy";
    case "compatible_with_warnings":
      return "informational";
    case "incompatible":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a redaction state onto the console vocabulary: raw material is
 * Informational (nothing wrong — the state is just visible);
 * deidentified/redacted are Healthy (the protective state applied).
 * The verbatim state word is ALWAYS displayed alongside.
 */
export function redactionConsoleStatus(state: RedactionState): ConsoleStatus {
  switch (state) {
    case "raw":
      return "informational";
    case "deidentified":
    case "redacted":
      return "healthy";
    default:
      return "unknown";
  }
}
