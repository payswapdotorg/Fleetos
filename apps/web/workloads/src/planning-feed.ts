/**
 * @fleetos/web-workloads — W143: the WORKLOAD PLANNING RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composeWorkloadPlanningFeed`; the returned feed is everything the
 * WorkloadPlanningScreen renders: the screen's exact `ScreenPhase`
 * prop, the machine-proven `lanePhase` (loading / empty / ready /
 * blocked / approval_required / error / unsupported — every
 * transition honest), the full six-stage planning JOURNEY (fleet
 * inventory -> workload proposal -> recommendation review -> decision
 * -> plan -> evidence), the tenant-scoped profile listing, the
 * selected workload's recommendation display, and the LOCK 12
 * resource linkage — every value derived from REAL runtime state.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL W022 profile + ledger, the REAL W032 software
 *     subscriptions, the REAL W050A connectivity submissions, the
 *     REAL W042 maintenance work orders at the binding site). Nothing
 *     is fabricated; a fresh tenant composes the honest `empty`
 *     phase (no profiles — never demo data).
 *   - NO EXISTENCE SIDE CHANNEL: a workload outside the acting tenant's
 *     partition is `blocked` with the workload-not-in-tenant reason —
 *     indistinguishable from unknown, and the planning view-model
 *     stays `undefined` (the screen renders its honest not-found state).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feed's
 *     decision walk only ever DESCRIBES records (operator disposition,
 *     Guardian decision, durable request state); this module performs,
 *     proposes and dispatches NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { TenantId, WorkloadId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { WorkloadUiTenantScope } from "./internal";
import { checkWorkloadUiTenantScope, SURFACE_SYSTEM_TENANT_ID } from "./internal";
import { buildWorkloadProfileListView } from "./listing";
import type { WorkloadProfileListView } from "./listing";
import { buildWorkloadRecommendationDisplay } from "./recommendations";
import type { WorkloadRecommendationDisplayView } from "./recommendations";
import { RECOMMENDATION_VIEW_VERSION } from "./recommendations";
import { buildWorkloadResourceLinkageView } from "./resources";
import type { WorkloadResourceLinkageView } from "./resources";
import { buildWorkloadPlanningJourney } from "./planning-journey";
import type { WorkloadPlanningJourney } from "./planning-journey";
import { WORKLOAD_LANE_REASONS, toWorkloadScreenPhase } from "./lane-phase";
import type { WorkloadLanePhase } from "./lane-phase";
import type { ScreenPhase } from "./ui/primitives";
import type {
  ConnectivityResourceFacets,
  MaintenanceResourceFacets,
  RecommendationLedgerFacets,
  SoftwareResourceFacets,
  WorkloadProfileFacets,
  WorkloadResourceLinkSource,
} from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The structural source for the per-tenant workload profile listing.
 * INJECTED at the binding site (the REAL W022 profile store).
 */
export interface WorkloadProfileSource {
  /** List the tenant's workload profiles (latest revisions only). */
  list(tenantId: TenantId): readonly WorkloadProfileFacets[];
}

/**
 * The structural source for the per-workload recommendation ledger.
 * INJECTED at the binding site (the REAL W022 ledger store). Returns
 * `undefined` when the workload has no ledger yet — the honest
 * absence (never fabricated).
 */
export interface WorkloadRecommendationSource {
  ledger(tenantId: TenantId, workloadId: WorkloadId): RecommendationLedgerFacets | undefined;
}

/**
 * The structural source for the per-workload linked resources (LOCK 12:
 * software / connectivity / maintenance). INJECTED at the binding site
 * (the REAL W032 / W050A / W042 stores). Returns the empty list when
 * the workload has no linked resources yet.
 */
export interface WorkloadResourceSource {
  /** All linked resources for the workload (any kind). */
  links(tenantId: TenantId, workloadId: WorkloadId): readonly WorkloadResourceLinkSource[];
  /** The software subscriptions linked to the workload (filtered). */
  software(tenantId: TenantId, workloadId: WorkloadId): readonly SoftwareResourceFacets[];
  /** The connectivity submissions linked to the workload (filtered). */
  connectivity(
    tenantId: TenantId,
    workloadId: WorkloadId,
  ): readonly ConnectivityResourceFacets[];
  /** The maintenance work orders linked to the workload (filtered). */
  maintenance(
    tenantId: TenantId,
    workloadId: WorkloadId,
  ): readonly MaintenanceResourceFacets[];
}

/**
 * The workload lane's runtime state: the tenant-partitioned sources the
 * feed composes from. INJECTED at the binding site (the console
 * composition root binds the REAL packages; the machine tests bind
 * them the same way).
 */
export interface WorkloadPlanningRuntimeState {
  /** The REAL workload profile store. */
  readonly profiles: WorkloadProfileSource;
  /** The REAL per-workload recommendation ledger source. */
  readonly recommendations: WorkloadRecommendationSource;
  /** The REAL linked-resource sources (LOCK 12). */
  readonly resources: WorkloadResourceSource;
}

// ---------------------------------------------------------------------------
// The planning view-model (the screen's data shape)
// ---------------------------------------------------------------------------

/**
 * The composed planning data: the tenant-scoped profile listing plus
 * the selected workload's detail (the full profile + recommendation
 * display + LOCK 12 resource linkage). Mirrors the existing
 * `WorkloadPlanningData` shape so the W090C screen renders unchanged.
 */
export interface WorkloadPlanningViewModel {
  readonly tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID;
  readonly profiles: WorkloadProfileListView;
  /** The selected workload's detail (null in the list view or when not in tenant). */
  readonly selected: {
    readonly profile: WorkloadProfileFacets;
    readonly recommendations: WorkloadRecommendationDisplayView;
    readonly linkage: WorkloadResourceLinkageView;
  } | null;
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/** Options for the planning feed composition. */
export interface WorkloadPlanningFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
  /** The selected workload id (the detail Sheet's subject), when open. */
  readonly selectedWorkloadId?: WorkloadId;
}

/**
 * The Workload Planning feed: everything the screen renders, composed
 * from real runtime state. `phase` is the screen's prop (derived);
 * `lanePhase` is the machine-proven semantic state.
 */
export interface WorkloadPlanningFeed {
  /** The EXACT phase prop the WorkloadPlanningScreen takes. */
  readonly phase: ScreenPhase<WorkloadPlanningViewModel>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel>;
  /** The selected workload's journey (the six-stage walk). */
  readonly journey: WorkloadPlanningJourney | undefined;
}

/** A deterministic empty planning view (the fresh-tenant / blocked state). */
function emptyPlanningView(
  tenantId: TenantId | typeof SURFACE_SYSTEM_TENANT_ID,
): WorkloadPlanningViewModel {
  const emptyList: WorkloadProfileListView = frozen({
    viewVersion: 1,
    tenantId: tenantId as TenantId,
    rows: [],
    total: 0,
    bySubjectKind: {},
  });
  return frozen({ tenantId, profiles: emptyList, selected: null });
}

/**
 * Compose the Workload Planning feed for one tenant: resolve the
 * tenant's workload profiles + the selected workload's recommendation
 * ledger + linked resources + the six-stage journey. PURE and
 * DETERMINISTIC. Phase transitions (machine-proven by the composition
 * tests):
 *
 *   - refused scope grammar  -> blocked (scope_refused; the empty view)
 *   - no profiles recorded   -> empty (no_workload_profiles_recorded;
 *     the honest fresh-tenant state — never demo data)
 *   - profiles + no selected -> ready (the listing is the surface's
 *     subject)
 *   - profiles + selected    -> ready (the listing + the selected detail)
 *   - profiles + selected + a
 *     PARKED connectivity    -> approval_required (the human gate is
 *     visible on the journey's decision stage)
 *   - selected not in tenant -> blocked (workload_not_in_tenant; no
 *     existence side channel)
 *
 * The journey composes only when the selected workload is in the
 * acting tenant's partition. The recommendation display builds from
 * the REAL ledger (or the honest `no_recommendations_proposed` state
 * when no ledger exists).
 */
export function composeWorkloadPlanningFeed(
  scope: WorkloadUiTenantScope,
  state: WorkloadPlanningRuntimeState,
  options: WorkloadPlanningFeedOptions,
): WorkloadPlanningFeed {
  const guard = checkWorkloadUiTenantScope(scope);
  const invalidInstant = typeof options?.now !== "string" || options.now.length === 0;

  if (invalidInstant) {
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: "The workload planning feed requires an injected reference instant.",
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  if (!guard.ok) {
    const view = emptyPlanningView(SURFACE_SYSTEM_TENANT_ID);
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "blocked",
      reason: WORKLOAD_LANE_REASONS.scopeRefused,
      view,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the tenant's workload profiles through the REAL source.
  let listed: readonly WorkloadProfileFacets[];
  try {
    listed = state.profiles.list(guard.tenantId);
  } catch {
    const view = emptyPlanningView(guard.tenantId);
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: "The workload planning feed's profile source refused to resolve.",
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The listing build is total — fail-closed to a blocked view on a
  // tenant-mismatch or invalid input.
  const listResult = buildWorkloadProfileListView(guard.tenantId, [...listed]);
  if (!listResult.ok) {
    const view = emptyPlanningView(guard.tenantId);
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: listResult.error.message,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The fresh-tenant honest empty state — never demo data.
  if (listResult.view.rows.length === 0) {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "empty",
      reason: WORKLOAD_LANE_REASONS.noProfiles,
      view,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The selected workload's detail (when one is open).
  const selectedWorkloadId = options.selectedWorkloadId;
  if (selectedWorkloadId === undefined) {
    // Ready: the listing is the surface's subject; no detail open.
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "ready",
      view,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the selected profile from the listing (the workload-not-in-
  // tenant guard: a workload outside the acting tenant's partition is
  // indistinguishable from unknown — no existence side channel).
  const selectedProfile = listResult.view.rows.find(
    (row) => row.workloadId === (selectedWorkloadId as string),
  );
  if (selectedProfile === undefined) {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "blocked",
      reason: WORKLOAD_LANE_REASONS.workloadNotInTenant,
      view,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the selected workload's REAL recommendation ledger.
  let ledger: RecommendationLedgerFacets | undefined;
  try {
    ledger = state.recommendations.ledger(guard.tenantId, selectedWorkloadId);
  } catch {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: "The workload planning feed's recommendation source refused to resolve.",
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Resolve the selected workload's REAL linked resources (LOCK 12).
  let software: readonly SoftwareResourceFacets[];
  let connectivity: readonly ConnectivityResourceFacets[];
  let maintenance: readonly MaintenanceResourceFacets[];
  let links: readonly WorkloadResourceLinkSource[];
  try {
    software = state.resources.software(guard.tenantId, selectedWorkloadId);
    connectivity = state.resources.connectivity(guard.tenantId, selectedWorkloadId);
    maintenance = state.resources.maintenance(guard.tenantId, selectedWorkloadId);
    links = state.resources.links(guard.tenantId, selectedWorkloadId);
  } catch {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: "The workload planning feed's resource source refused to resolve.",
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // The selected profile facets (the listing row carries the
  // identifier; the full facets come from the source — the listing
  // already proved the tenant scope; we re-derive the facets from the
  // source for the recommendation + linkage builders).
  const profileFacets: WorkloadProfileFacets | undefined = [...listed].find(
    (profile) =>
      profile.workloadId === selectedWorkloadId && profile.tenantId === guard.tenantId,
  );
  if (profileFacets === undefined) {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "blocked",
      reason: WORKLOAD_LANE_REASONS.workloadNotInTenant,
      view,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the recommendation display from the REAL ledger. When the
  // tenant has no ledger yet (the workload was created but no
  // recommendation has been proposed), the display is the honest
  // empty view (zero recommendation rows, zero dismissals, zero
  // lineages) — never fabricated.
  const recommendationResult =
    ledger === undefined
      ? {
          ok: true as const,
          view: frozen<WorkloadRecommendationDisplayView>({
            viewVersion: RECOMMENDATION_VIEW_VERSION,
            tenantId: guard.tenantId,
            workloadId: selectedWorkloadId as string,
            rows: [],
            dismissals: [],
            lineages: [],
          }),
        }
      : buildWorkloadRecommendationDisplay(guard.tenantId, ledger);
  if (!recommendationResult.ok) {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: recommendationResult.error.message,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the LOCK 12 resource linkage from the REAL linked resources.
  const linkageResult = buildWorkloadResourceLinkageView(guard.tenantId, profileFacets, [...links]);
  if (!linkageResult.ok) {
    const view = frozen({
      tenantId: guard.tenantId,
      profiles: listResult.view,
      selected: null,
    });
    const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = {
      kind: "error",
      message: linkageResult.error.message,
    };
    return frozen({
      phase: toWorkloadScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
    });
  }

  // Build the six-stage planning journey from the REAL runtime state.
  const journey = buildWorkloadPlanningJourney(scope, selectedWorkloadId, {
    profile: profileFacets,
    ledger,
    software,
    connectivity,
    maintenance,
    now: options.now,
  });

  // The lane phase: a PARKED connectivity submission holds a human
  // decision (the approval gate is visible on the journey's decision
  // stage); otherwise ready. (Maintenance work orders carry no top-level
  // status field — only connectivity submissions gate the approval.)
  const parked = connectivity.some((record) => record.status === "PARKED");
  const lanePhase: WorkloadLanePhase<WorkloadPlanningViewModel> = parked
    ? {
        kind: "approval_required",
        reason: WORKLOAD_LANE_REASONS.approvalPending,
        view: frozen({
          tenantId: guard.tenantId,
          profiles: listResult.view,
          selected: {
            profile: profileFacets,
            recommendations: recommendationResult.view,
            linkage: linkageResult.view,
          },
        }),
      }
    : {
        kind: "ready",
        view: frozen({
          tenantId: guard.tenantId,
          profiles: listResult.view,
          selected: {
            profile: profileFacets,
            recommendations: recommendationResult.view,
            linkage: linkageResult.view,
          },
        }),
      };

  return frozen({
    phase: toWorkloadScreenPhase(lanePhase),
    lanePhase,
    journey,
  });
}

/** The synthetic system tenant (re-exported for the feed's consumers). */
export const WORKLOAD_FEED_SYSTEM_TENANT = SURFACE_SYSTEM_TENANT_ID;
