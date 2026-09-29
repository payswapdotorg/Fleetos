/**
 * @fleetos/web-commerce — the console STATUS vocabulary (W090C).
 *
 * `spec/ui/CONSOLE-DESIGN.md` freezes a small, consistent semantic
 * vocabulary: Healthy / Informational / Needs attention / Approval
 * required / Blocked / Running / Succeeded / Failed / Unknown — and
 * requires that "state is not conveyed by color alone" (every
 * indicator carries its text label).
 *
 * This module maps the machine-stable domain vocabularies of the
 * commerce surfaces (quote lifecycle statuses, W050A submission
 * statuses + normalized execution states, deadline-pressure buckets,
 * warranty standings, delivery states, commercial-chain statuses,
 * maintenance-outcome verification) onto the console vocabulary.
 * PURE and DETERMINISTIC: verbatim domain values are always displayed
 * ALONGSIDE the semantic indicator — never replaced.
 *
 * No runtime dependencies. No `any`. Strict TS.
 */

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
 * Map a W032 quote lifecycle status (DRAFT/ISSUED/ACCEPTED/SUPERSEDED/
 * REJECTED) onto the console vocabulary. The quote's own `status`
 * field stays ISSUED after acceptance (acceptance is a ledger entry),
 * so the ACCEPTED arm applies to the LEDGER-DERIVED status only.
 */
export function quoteConsoleStatus(status: string): ConsoleStatus {
  switch (status) {
    case "DRAFT":
    case "ISSUED":
      return "informational";
    case "ACCEPTED":
      return "succeeded";
    case "SUPERSEDED":
      return "unknown";
    case "REJECTED":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a W050A connectivity submission status (PROPOSED/SUBMITTED/
 * PARKED/APPROVED/REJECTED) onto the console vocabulary: PARKED is
 * the human-approval hold — Approval required.
 */
export function submissionConsoleStatus(status: string): ConsoleStatus {
  switch (status) {
    case "PROPOSED":
      return "informational";
    case "SUBMITTED":
      return "running";
    case "PARKED":
      return "approval_required";
    case "APPROVED":
      return "healthy";
    case "REJECTED":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a NORMALIZED connectivity execution state (PROVISIONING/ACTIVE/
 * TERMINATING/TERMINATED) onto the console vocabulary. When the
 * verified flag is set (ACTIVE + measurements + no failure) the state
 * is Succeeded — the VERIFIED connectivity outcome.
 */
export function executionStateConsoleStatus(
  executionState: string,
  verified: boolean,
): ConsoleStatus {
  if (verified) return "succeeded";
  switch (executionState) {
    case "ACTIVE":
      return "healthy";
    case "PROVISIONING":
    case "TERMINATING":
      return "running";
    case "TERMINATED":
      return "informational";
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
 * Map a warranty-eligibility standing (the W042 vocabulary) onto the
 * console vocabulary: an unmet warranty floor blocks in-warranty
 * fulfillment; headroom is Healthy.
 */
export function warrantyStandingConsoleStatus(
  standing: "in_warranty_headroom" | "out_of_warranty_shortfall" | "warranty_floor_unmet",
): ConsoleStatus {
  switch (standing) {
    case "in_warranty_headroom":
      return "healthy";
    case "out_of_warranty_shortfall":
      return "needs_attention";
    case "warranty_floor_unmet":
      return "blocked";
    default:
      return "unknown";
  }
}

/**
 * Map a vendor-match satisfiable verdict onto the console vocabulary:
 * a satisfiable match is Healthy; a rejected vendor is Blocked (the
 * hard-gate refusal reasons are displayed alongside).
 */
export function matchConsoleStatus(satisfiable: boolean): ConsoleStatus {
  return satisfiable ? "healthy" : "blocked";
}

/**
 * Map a W050C delivery state onto the console vocabulary: queued is
 * Informational, sent is Running, delivered/read are Succeeded (the
 * terminal outcomes), undeliverable is Blocked, failed is Failed.
 */
export function deliveryStateConsoleStatus(state: string): ConsoleStatus {
  switch (state) {
    case "queued":
      return "informational";
    case "sent":
      return "running";
    case "delivered":
    case "read":
      return "succeeded";
    case "undeliverable":
      return "blocked";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Map a commercial-chain status (unquoted/unaccepted/delivered/agreed)
 * onto the console vocabulary: the pre-contract states need attention,
 * delivered is Succeeded, agreed is Healthy.
 */
export function chainStatusConsoleStatus(
  status: "unquoted" | "unaccepted" | "delivered" | "agreed",
): ConsoleStatus {
  switch (status) {
    case "unquoted":
      return "needs_attention";
    case "unaccepted":
      return "approval_required";
    case "delivered":
      return "succeeded";
    case "agreed":
      return "healthy";
    default:
      return "unknown";
  }
}

/**
 * Map a maintenance-outcome verification onto the console vocabulary:
 * full coverage (every contract served) is Succeeded — the VERIFIED
 * maintenance outcome; partial coverage Needs attention.
 */
export function maintenanceOutcomeConsoleStatus(fullCoverage: boolean): ConsoleStatus {
  return fullCoverage ? "succeeded" : "needs_attention";
}

/**
 * Map an entitlement lifecycle state (allocated/expiring/expired) onto
 * the console vocabulary: an allocated term is Healthy, a term inside
 * the expiring window Needs attention (renewal), an expired term is
 * Blocked (the entitlement no longer grants anything).
 */
export function subscriptionLifecycleConsoleStatus(
  state: "allocated" | "expiring" | "expired",
): ConsoleStatus {
  switch (state) {
    case "allocated":
      return "healthy";
    case "expiring":
      return "needs_attention";
    case "expired":
      return "blocked";
    default:
      return "unknown";
  }
}

/** The commerce journey-rail stage state (machine-stable, W090C D3). */
export type CommerceJourneyStageState = "done" | "current" | "pending" | "approval" | "blocked";

/**
 * Map a journey stage state onto the console vocabulary (mirrors the
 * workload lane's mapping — the rail vocabulary is shared by shape).
 */
export function journeyStageConsoleStatus(state: CommerceJourneyStageState): ConsoleStatus {
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
