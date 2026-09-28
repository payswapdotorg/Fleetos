/**
 * @fleetos/web-recovery — D3: the Fleet Action surfaces (W041).
 *
 * The fleet-action view-models: the device GROUP SELECTION display
 * (the recursive selector tree, rendered deterministically) and the
 * POLICY-GATED plan transitions displayed as state machines with the
 * REQUIRE_APPROVAL PARKED states VISIBLE.
 *
 * The plan transition table is INJECTED (`StatusMachineTable` — the
 * REAL `ACTION_PLAN_TRANSITIONS` + terminal + parked statuses at the
 * binding site), so the surface can never drift from the domain's
 * frozen tables. The surface NEVER advances, parks, approves, or
 * rejects a plan — transitions belong to the domain boundary (the
 * policy gate); the surface only displays the current status, the
 * legal continuations, the parked/awaiting-approval state, and the
 * plan's evidence refs (opaque, verbatim).
 *
 * The plan LIST view-model surfaces the parked plans FIRST with
 * counts — the human-approval queue is the most architecture-visible
 * fact of the fleet-action surface (`spec/ARCHITECTURE-LOCK.md`
 * item 19).
 *
 * PURE + DETERMINISTIC: no clock, no randomness, no I/O. No `any` in
 * public signatures. Strict TS.
 */

import { SYNTHETIC_SYSTEM_TENANT, checkRecoveryUiTenantScope, compareStrings, frozen, frozenArray } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import type {
  ActionPlanLike,
  ActionPlanSource,
  SelectorLike,
  StatusMachineTable,
} from "./seams";
import type { DeviceId, EvidenceRef, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The group-selection display (the recursive selector tree)
// ---------------------------------------------------------------------------

/**
 * One node of the rendered selector tree: the kind, a deterministic
 * human-readable label, the node's parameters, and the composed
 * children. PURE projection — the surface never evaluates a selector
 * (target resolution belongs to the domain).
 */
export interface SelectorNodeView {
  readonly kind: string;
  readonly label: string;
  readonly detail: string | undefined;
  readonly children: readonly SelectorNodeView[];
}

/** Render one selector as a display node (recursive, deterministic). PURE. */
export function selectorNodeView(selector: SelectorLike): SelectorNodeView {
  switch (selector.kind) {
    case "all":
      return frozen({ kind: "all", label: "All devices", detail: undefined, children: frozenArray([]) });
    case "byId":
      return frozen({
        kind: "byId",
        label: "Explicit device set",
        detail: `${selector.deviceIds.length} device(s)`,
        children: frozenArray([]),
      });
    case "byPlatform":
      return frozen({ kind: "byPlatform", label: "By platform", detail: selector.platform, children: frozenArray([]) });
    case "byOwnership":
      return frozen({
        kind: "byOwnership",
        label: "By ownership",
        detail: selector.ownership,
        children: frozenArray([]),
      });
    case "byLifecycleState":
      return frozen({
        kind: "byLifecycleState",
        label: "By lifecycle state",
        detail: selector.state,
        children: frozenArray([]),
      });
    case "byCapability":
      return frozen({
        kind: "byCapability",
        label: "By capability",
        detail: selector.capability,
        children: frozenArray([]),
      });
    case "byPostureSummary":
      return frozen({
        kind: "byPostureSummary",
        label: "By posture summary",
        detail: selector.summary,
        children: frozenArray([]),
      });
    case "intersect":
    case "union":
      return frozen({
        kind: selector.kind,
        label: selector.kind === "intersect" ? "Intersection of" : "Union of",
        detail: `${selector.selectors.length} selector(s)`,
        children: frozenArray(selector.selectors.map((sub) => selectorNodeView(sub))),
      });
    case "subtract":
      return frozen({
        kind: "subtract",
        label: "Subtraction",
        detail: "base minus exclusions",
        children: frozenArray([
          selectorNodeView(selector.base),
          selectorNodeView(selector.minus),
        ]),
      });
  }
}

// ---------------------------------------------------------------------------
// The plan state machine surface (read-only, injected table)
// ---------------------------------------------------------------------------

/**
 * The READ-ONLY plan state machine view: the current status, the legal
 * next statuses (per the INJECTED domain transition table), the
 * terminal flag, and — the architecture-visible part — whether the
 * plan is PARKED awaiting the human-approval step (the REQUIRE_APPROVAL
 * decision's hold), and whether that approval is still pending.
 */
export interface PlanStateMachineView {
  readonly current: string;
  readonly legalNext: readonly string[];
  readonly isTerminal: boolean;
  /** Is the plan PARKED (the REQUIRE_APPROVAL hold)? */
  readonly isParked: boolean;
  /** The parked statuses the domain defines (verbatim, read-only). */
  readonly parkedStatuses: readonly string[];
  /** The statuses the domain marks terminal (verbatim, read-only). */
  readonly terminalStatuses: readonly string[];
  /** The full injected transition table (read-only snapshot). */
  readonly transitions: Readonly<Record<string, readonly string[]>>;
}

/** Derive the read-only plan machine view for a status + injected table. PURE. */
export function planStateMachineView(status: string, table: StatusMachineTable): PlanStateMachineView {
  const legalNext = table.transitions[status] ?? [];
  const parked = table.parked ?? [];
  return frozen({
    current: status,
    legalNext: frozenArray(legalNext as readonly string[]),
    isTerminal: table.terminal.includes(status),
    isParked: parked.includes(status),
    parkedStatuses: frozenArray(parked),
    terminalStatuses: frozenArray(table.terminal),
    transitions: table.transitions,
  });
}

// ---------------------------------------------------------------------------
// The plan view-models
// ---------------------------------------------------------------------------

/**
 * The action plan view-model: the group selection (selector tree +
 * resolved targets), the capability, the read-only policy-gated state
 * machine, the timeline, and the OPAQUE evidence refs.
 */
export interface ActionPlanViewModel {
  readonly tenantId: TenantId;
  readonly planId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly version: number;
  readonly status: string;
  readonly capability: string;
  readonly stateMachine: PlanStateMachineView;
  readonly group: {
    readonly selector: SelectorNodeView;
    readonly targetCount: number;
    readonly targets: readonly DeviceId[];
  };
  readonly requestedBy: string | undefined;
  readonly createdAt: string;
  readonly transitionedAt: string | undefined;
  /** OPAQUE content-addressable evidence refs, verbatim (never interpreted). */
  readonly evidence: readonly EvidenceRef[];
}

/**
 * Build the action plan view-model. PURE and DETERMINISTIC. Returns
 * `undefined` when the plan is not in the acting tenant's partition
 * (no existence side channel).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the injected action-plan source
 * @param planId the plan to surface
 * @param table the injected status-machine table (the domain's frozen tables)
 * @returns the plan view-model, or undefined when absent
 */
export function buildActionPlanViewModel(
  scope: RecoveryUiTenantScope,
  source: ActionPlanSource,
  planId: string,
  table: StatusMachineTable,
): ActionPlanViewModel | undefined {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) return undefined;
  const plan = source.latest(guard.tenantId, planId);
  if (plan === undefined) return undefined;

  return frozen({
    tenantId: guard.tenantId,
    planId: plan.planId,
    name: plan.name,
    description: plan.description,
    version: plan.version,
    status: plan.status,
    capability: plan.capability,
    stateMachine: planStateMachineView(plan.status, table),
    group: frozen({
      selector: selectorNodeView(plan.selector),
      targetCount: plan.targetCount,
      targets: frozenArray(plan.selectedTargets),
    }),
    requestedBy: plan.requestedBy,
    createdAt: plan.createdAt,
    transitionedAt: plan.transitionedAt,
    evidence: frozenArray(plan.evidence.map((ref) => frozen({ ...ref }))),
  });
}

/**
 * The plan LIST view-model: PARKED plans first (the human-approval
 * queue — the visible gate), then by planId ascending; counts by
 * status make the proposal-gated pipeline visible at a glance.
 */
export interface ActionPlanListViewModel {
  readonly tenantId: TenantId | typeof SYNTHETIC_SYSTEM_TENANT;
  readonly plans: readonly {
    readonly planId: string;
    readonly name: string;
    readonly version: number;
    readonly status: string;
    readonly capability: string;
    readonly targetCount: number;
    readonly isParked: boolean;
    readonly isTerminal: boolean;
    readonly transitionedAt: string | undefined;
  }[];
  readonly counts: {
    readonly total: number;
    readonly proposal: number;
    readonly parked: number;
    readonly advanced: number;
    readonly approved: number;
    readonly rejected: number;
  };
}

/** Build the plan list view-model. PURE and DETERMINISTIC. */
export function buildActionPlanListViewModel(
  scope: RecoveryUiTenantScope,
  source: ActionPlanSource,
  table: StatusMachineTable,
): ActionPlanListViewModel {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) {
    return frozen({
      tenantId: SYNTHETIC_SYSTEM_TENANT,
      plans: frozenArray([]),
      counts: frozen({ total: 0, proposal: 0, parked: 0, advanced: 0, approved: 0, rejected: 0 }),
    });
  }
  const plans = source.list(guard.tenantId);
  const parked = table.parked ?? [];
  const rows = [...plans]
    .sort((a, b) => {
      const parkedDelta = Number(parked.includes(b.status)) - Number(parked.includes(a.status));
      if (parkedDelta !== 0) return parkedDelta;
      return compareStrings(a.planId, b.planId);
    })
    .map((plan) =>
      frozen({
        planId: plan.planId,
        name: plan.name,
        version: plan.version,
        status: plan.status,
        capability: plan.capability,
        targetCount: plan.targetCount,
        isParked: parked.includes(plan.status),
        isTerminal: table.terminal.includes(plan.status),
        transitionedAt: plan.transitionedAt,
      }),
    );
  const count = (status: string): number => rows.filter((row) => row.status === status).length;
  return frozen({
    tenantId: guard.tenantId,
    plans: frozenArray(rows),
    counts: frozen({
      total: rows.length,
      proposal: count("PROPOSAL"),
      parked: count("PARKED"),
      advanced: count("ADVANCED"),
      approved: count("APPROVED"),
      rejected: count("REJECTED"),
    }),
  });
}
