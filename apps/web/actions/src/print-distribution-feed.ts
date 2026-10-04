/**
 * @fleetos/web-actions — W142: the Print Distribution RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composePrintDistributionFeed`; the returned feed is everything the
 * PrintDistributionScreen renders: the screen's exact `ScreenPhase`
 * prop, the machine-proven `lanePhase`, and the distribution plan view
 * (the per-person entries with their ROUTED / REFUSED jobs and the
 * escalation context for capable-but-unapproved printers).
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     source (the REAL `@fleetos/actions` `planPrintDistribution`
 *     output, projected structurally). Nothing is fabricated; a fresh
 *     tenant (no distribution plan for the document) composes the
 *     honest `empty` phase.
 *   - NO EXISTENCE SIDE CHANNEL: a document ref outside the acting
 *     tenant's partition is `blocked` — never a fabricated plan.
 *   - A PROPOSAL IS NEVER AN EXECUTED ACTION: the feed only ever
 *     DESCRIBES records; this module performs, proposes and dispatches
 *     NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { SurfaceTenantScope } from "./surface-contracts";
import type { ScreenPhase } from "./ui/primitives";
import {
  ACTIONS_LANE_REASONS,
  actionsLaneLoading,
  toActionsScreenPhase,
} from "./lane-phase";
import type { ActionsLanePhase } from "./lane-phase";
import type { PrintDistributionPlanRecord, PrintDistributionSource } from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The actions lane's runtime state for the Print Distribution surface.
 * INJECTED at the binding site.
 */
export interface PrintDistributionRuntimeState {
  /** The REAL `@fleetos/actions` `planPrintDistribution` output. */
  readonly distributions: PrintDistributionSource;
}

/** Options for the print-distribution feed composition. */
export interface PrintDistributionFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

// ---------------------------------------------------------------------------
// The composite data the screen renders
// ---------------------------------------------------------------------------

/**
 * The composed data the PrintDistributionScreen renders. The plan is
 * the per-person distribution (ROUTED entries with their approved
 * printers + REFUSED entries with their routing reasons + escalation
 * context for capable-but-unapproved printers).
 */
export interface PrintDistributionFeedData {
  /** The distribution plan (or null when not in the acting tenant). */
  readonly plan: PrintDistributionPlanRecord | null;
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/**
 * The Print Distribution feed: everything the screen renders, composed
 * from real runtime state.
 */
export interface PrintDistributionFeed {
  /** The EXACT phase prop the PrintDistributionScreen takes. */
  readonly phase: ScreenPhase<PrintDistributionFeedData>;
  /** The machine-proven lane phase. */
  readonly lanePhase: ActionsLanePhase<PrintDistributionFeedData>;
  /** The composite data the screen renders. */
  readonly data: PrintDistributionFeedData;
}

/** The loading feed (the async tier's pre-resolution state). PURE. */
export function loadingPrintDistributionFeed(): PrintDistributionFeed {
  const emptyData: PrintDistributionFeedData = frozen({ plan: null });
  return frozen({
    phase: { kind: "loading" },
    lanePhase: actionsLaneLoading<PrintDistributionFeedData>(),
    data: emptyData,
  });
}

/** The error feed (the source refused; machine-stable message). PURE. */
export function errorPrintDistributionFeed(message: string): PrintDistributionFeed {
  const emptyData: PrintDistributionFeedData = frozen({ plan: null });
  const lanePhase: ActionsLanePhase<PrintDistributionFeedData> = {
    kind: "error",
    message,
  };
  return frozen({
    phase: { kind: "error", message },
    lanePhase,
    data: emptyData,
  });
}

/** Resolve the acting tenant id (the scope guard, typed). PURE. */
function actingTenantId(scope: SurfaceTenantScope): TenantId | undefined {
  const record = scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  return typeof record?.tenantId === "string" && record.tenantId.length > 0
    ? (record.tenantId as TenantId)
    : undefined;
}

/**
 * Compose the Print Distribution feed from the runtime state. PURE and
 * DETERMINISTIC.
 *
 * Phase transitions (all machine-proven by the composition tests):
 *   - refused scope grammar            -> blocked (scope_refused; no data)
 *   - document not in the partition      -> blocked (plan_not_in_tenant_partition)
 *   - fresh tenant / no distribution     -> empty (no_print_jobs)
 *   - distribution present               -> ready (the per-person entries view)
 *   - a refused source                   -> error (machine-stable)
 */
export function composePrintDistributionFeed(
  scope: SurfaceTenantScope,
  state: PrintDistributionRuntimeState,
  documentRef: string,
  options: PrintDistributionFeedOptions,
): PrintDistributionFeed {
  // Fail-closed: an invalid instant or scope grammar never reaches a source.
  if (typeof options?.now !== "string" || options.now.length === 0) {
    return errorPrintDistributionFeed("The print distribution feed requires an injected reference instant.");
  }
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    const emptyData: PrintDistributionFeedData = frozen({ plan: null });
    const lanePhase: ActionsLanePhase<PrintDistributionFeedData> = {
      kind: "blocked",
      reason: ACTIONS_LANE_REASONS.scopeRefused,
      view: emptyData,
    };
    return frozen({
      phase: toActionsScreenPhase(lanePhase),
      lanePhase,
      data: emptyData,
    });
  }

  // The composition reads the REAL source through the seam.
  let plan: PrintDistributionPlanRecord | undefined;
  try {
    plan = state.distributions.distributionFor(tenantId, documentRef);
  } catch {
    return errorPrintDistributionFeed("The print distribution feed's runtime state refused to resolve.");
  }

  // The honest empty state: the tenant has no distribution plan for the
  // document (fresh workspace — never demo data).
  if (plan === undefined) {
    const emptyData: PrintDistributionFeedData = frozen({ plan: null });
    const lanePhase: ActionsLanePhase<PrintDistributionFeedData> = {
      kind: "empty",
      reason: ACTIONS_LANE_REASONS.noPrintJobs,
      view: emptyData,
    };
    return frozen({
      phase: toActionsScreenPhase(lanePhase),
      lanePhase,
      data: emptyData,
    });
  }

  const data: PrintDistributionFeedData = frozen({ plan });
  const lanePhase: ActionsLanePhase<PrintDistributionFeedData> = { kind: "ready", view: data };

  return frozen({
    phase: toActionsScreenPhase(lanePhase),
    lanePhase,
    data,
  });
}
