/**
 * @fleetos/web-recovery — W141: the RECOVERY RUNTIME FEEDS.
 *
 * The composition functions that carry the runtime state contract into
 * the recovery screens' phase props (SIM-B ask 1, the Recovery lane):
 *
 *   composeRecoveryCasesFeed       the cases LIST + the selected case
 *                                  DETAIL + the per-case journeys
 *                                  (lost/stolen signal -> recovery case
 *                                  -> locate/secure decision ->
 *                                  authorization -> action -> evidence
 *                                  -> closure/escalation)
 *   composeFindMyDeviceFeed        Find My Device (the last-seen
 *                                  evidence ledger + the machine-stable
 *                                  location state)
 *   composeDestructiveActionsFeed  the gated destructive actions for a
 *                                  device's active case (affordances +
 *                                  requests + the lost-flow timeline),
 *                                  with the honest blocked state when
 *                                  no active case exists
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL recovery case store, the REAL destructive-
 *     request store, the REAL last-seen ledger, the REAL adapter
 *     capabilities at the binding site). A fresh tenant composes the
 *     honest `empty` phase; nothing is ever fabricated.
 *   - NO EXISTENCE SIDE CHANNEL: a case/device outside the acting
 *     tenant's partition is indistinguishable from unknown.
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feeds only
 *     DESCRIBE records; the destructive dispatch happens exclusively
 *     through the confirmation flow's injected gated boundary.
 *   - Fail-closed: refused scopes compose deterministic empty views
 *     (no data, no leak) — never a fallback to foreign content.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { DeviceId } from "@fleetos/contracts";
import { SYNTHETIC_SYSTEM_TENANT, frozen } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import { checkRecoveryUiTenantScope } from "./internal";
import { buildFindMyDeviceViewModel } from "./find-my-device";
import type { FindMyDeviceViewModel } from "./find-my-device";
import { buildDestructiveRequestViewModel } from "./destructive-actions";
import { destructiveActionAffordance } from "./destructive-actions";
import type { DestructiveRequestViewModel } from "./destructive-actions";
import { buildRecoveryCaseListViewModel, buildRecoveryCaseViewModel, caseStateMachineView } from "./recovery-case";
import type { RecoveryCaseListViewModel, RecoveryCaseViewModel } from "./recovery-case";
import { buildRecoveryCaseJourneys } from "./recovery-journey";
import type { RecoveryCaseJourney } from "./recovery-journey";
import { RECOVERY_LANE_REASONS, toRecoveryScreenPhase } from "./lane-phase";
import type { RecoveryLanePhase } from "./lane-phase";
import type { ScreenPhase } from "./ui/primitives";
import type {
  DestructiveRequestLike,
  DestructiveRequestSource,
  FindMyDeviceSource,
  RecoveryCaseSource,
  StatusMachineTable,
} from "./seams";
import type { DestructiveActionEntry, LostFlowContext } from "./screens/destructive-action-screen";

// ---------------------------------------------------------------------------
// The capability seam (the adapter-derived destructive capability set)
// ---------------------------------------------------------------------------

/**
 * The device adapter's declared destructive capabilities (verbatim from
 * the adapter record at the binding site).
 */
export interface DestructiveCapabilityLike {
  readonly lock: boolean;
  readonly locate: boolean;
  readonly wipe: boolean;
  readonly reboot: boolean;
}

/**
 * The tenant-partitioned capability source. INJECTED at the binding
 * site (the REAL W020 EndpointAdapter's declared capabilities, or the
 * twin's capability section). Returns `undefined` when the device has
 * no adapter record — the honest all-unsupported state.
 */
export interface DestructiveCapabilitySource {
  capabilities(tenantId: Parameters<RecoveryCaseSource["latest"]>[0], deviceId: DeviceId): DestructiveCapabilityLike | undefined;
}

/** The canonical destructive action set (the frozen payload union). */
export const DESTRUCTIVE_ACTION_SET = ["lock", "locate", "wipe", "reboot"] as const;

/** The machine-stable per-action display labels (frozen vocabulary). */
export const DESTRUCTIVE_ACTION_LABELS: Readonly<Record<(typeof DESTRUCTIVE_ACTION_SET)[number], string>> =
  Object.freeze({
    lock: "Lock",
    locate: "Locate",
    wipe: "Wipe",
    reboot: "Reboot",
  } as const);

/** The machine-stable per-action expected effects (frozen vocabulary). */
export const DESTRUCTIVE_ACTION_EFFECTS: Readonly<Record<(typeof DESTRUCTIVE_ACTION_SET)[number], string>> =
  Object.freeze({
    lock: "Locks the device. Reversible by policy.",
    locate: "Requests the device's current location (evidence-anchored).",
    wipe: "Erases all data on the device. This effect is irreversible.",
    reboot: "Restarts the device.",
  } as const);

/** The machine-stable per-action evidence requirements (frozen). */
export const DESTRUCTIVE_ACTION_EVIDENCE: Readonly<Record<(typeof DESTRUCTIVE_ACTION_SET)[number], string>> =
  Object.freeze({
    lock: "The lock command's execution evidence + the case's evidence basis.",
    locate: "The location observation's evidence ref + the case's evidence basis.",
    wipe: "The wipe command's execution evidence + the pre-recorded case evidence.",
    reboot: "The reboot command's execution evidence.",
  } as const);

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The recovery lane's runtime state: the tenant-partitioned sources the
 * feeds compose from. INJECTED at the binding site (the console
 * composition root binds the REAL packages; the machine tests bind
 * them the same way).
 */
export interface RecoveryRuntimeState {
  /** The REAL recovery case store (structural `RecoveryCaseSource`). */
  readonly cases: RecoveryCaseSource;
  /** The REAL destructive-request store (structural `DestructiveRequestSource`). */
  readonly requests: DestructiveRequestSource;
  /** The REAL last-seen ledger + findMyDevice derivation. */
  readonly findMy: FindMyDeviceSource;
  /** The adapter-derived destructive capabilities per device. */
  readonly capabilities: DestructiveCapabilitySource;
}

// ---------------------------------------------------------------------------
// Feed 1 — the recovery cases list/detail + the per-case journeys
// ---------------------------------------------------------------------------

/** Options for the cases feed. */
export interface RecoveryCasesFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
  /** The selected case id (the detail Sheet's subject), when open. */
  readonly selectedCaseId?: string;
}

/** The recovery cases feed: the list phase + the selected detail + journeys. */
export interface RecoveryCasesFeed {
  /** The EXACT phase prop the RecoveryCasesScreen takes. */
  readonly phase: ScreenPhase<RecoveryCaseListViewModel>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: RecoveryLanePhase<RecoveryCaseListViewModel>;
  /** The selected case's view-model (undefined while unknown/loading). */
  readonly selectedCase: RecoveryCaseViewModel | undefined;
  /** The selected case's journey (the seven-stage walk). */
  readonly selectedJourney: RecoveryCaseJourney | undefined;
  /** Every case's journey, keyed by case id. */
  readonly journeys: Readonly<Record<string, RecoveryCaseJourney>>;
}

/**
 * Compose the recovery cases feed. PURE and DETERMINISTIC. Phase
 * transitions (machine-proven by the composition tests):
 *   - refused scope grammar -> blocked (scope_refused; the
 *     deterministic empty list view — no data, no leak)
 *   - fresh tenant          -> empty (no_recovery_cases; the honest
 *     empty list — never demo data)
 *   - cases present         -> ready (the list + journeys compose);
 *     a selected case resolves its detail + journey (unknown/foreign
 *     ids resolve nothing — no existence side channel)
 */
export function composeRecoveryCasesFeed(
  scope: RecoveryUiTenantScope,
  state: RecoveryRuntimeState,
  caseTable: StatusMachineTable,
  options: RecoveryCasesFeedOptions,
): RecoveryCasesFeed {
  const guard = checkRecoveryUiTenantScope(scope);
  if (typeof options?.now !== "string" || options.now.length === 0 || !guard.ok) {
    // Fail-closed: the deterministic empty list view (no data, no leak).
    const view: RecoveryCaseListViewModel = buildRecoveryCaseListViewModel(scope, state.cases, caseTable);
    const lanePhase: RecoveryLanePhase<RecoveryCaseListViewModel> = !guard.ok
      ? { kind: "blocked", reason: RECOVERY_LANE_REASONS.scopeRefused, view }
      : { kind: "error", message: "The cases feed requires an injected reference instant." };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      selectedCase: undefined,
      selectedJourney: undefined,
      journeys: Object.freeze({}) as Readonly<Record<string, RecoveryCaseJourney>>,
    });
  }

  let listed: ReturnType<RecoveryCaseSource["list"]>;
  let allRequests: ReturnType<DestructiveRequestSource["list"]>;
  let view: RecoveryCaseListViewModel;
  try {
    listed = state.cases.list(guard.tenantId);
    allRequests = state.requests.list(guard.tenantId);
    view = buildRecoveryCaseListViewModel(scope, state.cases, caseTable);
  } catch {
    const lanePhase: RecoveryLanePhase<RecoveryCaseListViewModel> = {
      kind: "error",
      message: "The cases feed's runtime state refused to resolve.",
    };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      selectedCase: undefined,
      selectedJourney: undefined,
      journeys: Object.freeze({}) as Readonly<Record<string, RecoveryCaseJourney>>,
    });
  }

  const lanePhase: RecoveryLanePhase<RecoveryCaseListViewModel> =
    view.cases.length === 0
      ? { kind: "empty", reason: RECOVERY_LANE_REASONS.noCases, view }
      : { kind: "ready", view };

  const journeys = buildRecoveryCaseJourneys(
    scope,
    listed,
    caseTable,
    (deviceId) => {
      try {
        return state.findMy.view(guard.tenantId, deviceId, options.now, {
          freshWithinMs: 3_600_000,
          staleAfterMs: 86_400_000,
        }).location;
      } catch {
        return undefined;
      }
    },
    (caseId) => allRequests.filter((request) => request.caseId === caseId),
    options.now,
  );

  const selectedCase =
    options.selectedCaseId === undefined
      ? undefined
      : buildRecoveryCaseViewModel(scope, state.cases, options.selectedCaseId, caseTable);

  return frozen({
    phase: toRecoveryScreenPhase(lanePhase),
    lanePhase,
    selectedCase,
    selectedJourney: selectedCase === undefined ? undefined : journeys[selectedCase.caseId],
    journeys,
  });
}

// ---------------------------------------------------------------------------
// Feed 2 — Find My Device
// ---------------------------------------------------------------------------

/** Options for the Find My Device feed. */
export interface FindMyDeviceFeedOptions {
  /** The injected "now" (ISO 8601) — the staleness banding reference. */
  readonly at: string;
  /** Fresh within this many milliseconds. */
  readonly freshWithinMs: number;
  /** Stale after this many milliseconds. */
  readonly staleAfterMs: number;
}

/** The Find My Device feed. */
export interface FindMyDeviceFeed {
  /** The EXACT phase prop the FindMyDeviceScreen takes. */
  readonly phase: ScreenPhase<FindMyDeviceViewModel>;
  /** The machine-proven lane phase. */
  readonly lanePhase: RecoveryLanePhase<FindMyDeviceViewModel>;
}

/**
 * Compose the Find My Device feed. PURE and DETERMINISTIC. Phase
 * transitions: a refused scope composes the deterministic empty view
 * (blocked — no data, no leak); a device with no last-seen evidence at
 * all composes the honest `empty` phase (the view IS the machine-
 * stable no-evidence state); otherwise `ready`.
 */
export function composeFindMyDeviceFeed(
  scope: RecoveryUiTenantScope,
  state: RecoveryRuntimeState,
  deviceId: DeviceId,
  options: FindMyDeviceFeedOptions,
): FindMyDeviceFeed {
  const view = buildFindMyDeviceViewModel(scope, state.findMy, deviceId, {
    at: options.at,
    freshWithinMs: options.freshWithinMs,
    staleAfterMs: options.staleAfterMs,
  });
  const guard = checkRecoveryUiTenantScope(scope);
  if (typeof options?.at !== "string" || options.at.length === 0) {
    const lanePhase: RecoveryLanePhase<FindMyDeviceViewModel> = {
      kind: "error",
      message: "The Find My Device feed requires an injected reference instant.",
    };
    return frozen({ phase: toRecoveryScreenPhase(lanePhase), lanePhase });
  }
  if (!guard.ok) {
    const lanePhase: RecoveryLanePhase<FindMyDeviceViewModel> = {
      kind: "blocked",
      reason: RECOVERY_LANE_REASONS.scopeRefused,
      view,
    };
    return frozen({ phase: toRecoveryScreenPhase(lanePhase), lanePhase });
  }
  const lanePhase: RecoveryLanePhase<FindMyDeviceViewModel> =
    view.lastSeen === undefined
      ? { kind: "empty", reason: RECOVERY_LANE_REASONS.noLastSeenEvidence, view }
      : { kind: "ready", view };
  return frozen({ phase: toRecoveryScreenPhase(lanePhase), lanePhase });
}

// ---------------------------------------------------------------------------
// Feed 3 — the gated destructive actions for one device's active case
// ---------------------------------------------------------------------------

/** Options for the destructive actions feed. */
export interface DestructiveActionsFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
  /** Staleness bands for the lost-flow timeline's last-seen evidence. */
  readonly freshWithinMs: number;
  readonly staleAfterMs: number;
}

/** The destructive actions feed. */
export interface DestructiveActionsFeed {
  /** The EXACT phase prop the DestructiveActionScreen takes. */
  readonly phase: ScreenPhase<RecoveryCaseViewModel | undefined>;
  /** The machine-proven lane phase. */
  readonly lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined>;
  /** The resolved active case's id (undefined when no active case). */
  readonly caseId: string | undefined;
  /** The four destructive actions with affordances + latest requests. */
  readonly actions: readonly DestructiveActionEntry[];
  /** The lost-flow timeline context (the screen's prop). */
  readonly lostFlow: LostFlowContext;
  /** The resolved case's journey (the seven-stage walk). */
  readonly journey: RecoveryCaseJourney | undefined;
}

/**
 * The machine-stable latest request per action for one case. PURE: the
 * highest-version revision per (caseId, action) wins.
 */
function latestRequestsByAction(
  requests: readonly DestructiveRequestLike[],
  caseId: string,
): Readonly<Record<string, DestructiveRequestLike>> {
  const latest: Record<string, DestructiveRequestLike> = {};
  for (const request of requests) {
    if (request.caseId !== caseId) continue;
    const current = latest[request.action];
    if (current === undefined || request.version > current.version) {
      latest[request.action] = request;
    }
  }
  return Object.freeze(latest);
}

/**
 * Compose the destructive actions feed for one device: resolve the
 * device's ACTIVE recovery case (the gate's precondition), then the
 * four destructive actions with their gated-path affordances and latest
 * request view-models. PURE and DETERMINISTIC. Phase transitions
 * (machine-proven by the composition tests):
 *
 *   - refused scope grammar  -> blocked (scope_refused; no case view)
 *   - no case for the device -> blocked (no_active_recovery_case; the
 *     screen renders its honest ungated-path refusal — never a fake)
 *   - case not in an active
 *     state                  -> blocked (no_active_recovery_case)
 *   - active case + a PARKED
 *     request                -> approval_required (the human gate)
 *   - active case, no
 *     destructive capability -> unsupported (adapter_capability_absent)
 *   - otherwise              -> ready
 */
export function composeDestructiveActionsFeed(
  scope: RecoveryUiTenantScope,
  state: RecoveryRuntimeState,
  requestTable: StatusMachineTable,
  caseTable: StatusMachineTable,
  deviceId: DeviceId,
  options: DestructiveActionsFeedOptions,
): DestructiveActionsFeed {
  const guard = checkRecoveryUiTenantScope(scope);
  const invalidInstant = typeof options?.now !== "string" || options.now.length === 0;
  if (invalidInstant || !guard.ok) {
    const lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined> = invalidInstant
      ? { kind: "error", message: "The destructive actions feed requires an injected reference instant." }
      : { kind: "blocked", reason: RECOVERY_LANE_REASONS.scopeRefused, view: undefined };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      caseId: undefined,
      actions: [],
      lostFlow: frozen<LostFlowContext>({
        lastSeenObservedAt: undefined,
        caseView: undefined,
        locatedSupported: false,
        lockSupported: false,
        wipeSupported: false,
      }),
      journey: undefined,
    });
  }

  // Resolve the device's cases + requests through the REAL sources.
  let listed: ReturnType<RecoveryCaseSource["list"]>;
  let allRequests: ReturnType<DestructiveRequestSource["list"]>;
  let capabilities: DestructiveCapabilityLike | undefined;
  try {
    listed = state.cases.list(guard.tenantId);
    allRequests = state.requests.list(guard.tenantId);
    capabilities = state.capabilities.capabilities(guard.tenantId, deviceId);
  } catch {
    const lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined> = {
      kind: "error",
      message: "The destructive actions feed's runtime state refused to resolve.",
    };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      caseId: undefined,
      actions: [],
      lostFlow: frozen<LostFlowContext>({
        lastSeenObservedAt: undefined,
        caseView: undefined,
        locatedSupported: false,
        lockSupported: false,
        wipeSupported: false,
      }),
      journey: undefined,
    });
  }

  // The gate's precondition: the device's ACTIVE case (the highest-
  // version active-status case when several exist; deterministic).
  const activeStatuses = caseTable.active ?? [];
  const deviceCases = listed
    .filter((caseRecord) => caseRecord.deviceId === deviceId)
    .sort((a, b) => (a.version > b.version ? 1 : a.version < b.version ? -1 : a.caseId < b.caseId ? -1 : 1));
  const activeCase = [...deviceCases]
    .reverse()
    .find((caseRecord) => activeStatuses.includes(caseRecord.status));

  if (activeCase === undefined) {
    // The honest blocked state: no active case, no ungated path.
    const lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined> = {
      kind: "blocked",
      reason: RECOVERY_LANE_REASONS.noActiveCase,
      view: undefined,
    };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      caseId: undefined,
      actions: [],
      lostFlow: frozen<LostFlowContext>({
        lastSeenObservedAt: undefined,
        caseView: undefined,
        locatedSupported: false,
        lockSupported: false,
        wipeSupported: false,
      }),
      journey: undefined,
    });
  }

  // The active case's view-model + machine. A throwing source (the
  // view build touches the case source again) composes the error feed.
  let caseView: RecoveryCaseViewModel | undefined;
  try {
    caseView = buildRecoveryCaseViewModel(scope, state.cases, activeCase.caseId, caseTable);
  } catch {
    caseView = undefined;
  }
  if (caseView === undefined) {
    const lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined> = {
      kind: "error",
      message: "The destructive actions feed's case view refused to compose.",
    };
    return frozen({
      phase: toRecoveryScreenPhase(lanePhase),
      lanePhase,
      caseId: undefined,
      actions: [],
      lostFlow: frozen<LostFlowContext>({
        lastSeenObservedAt: undefined,
        caseView: undefined,
        locatedSupported: false,
        lockSupported: false,
        wipeSupported: false,
      }),
      journey: undefined,
    });
  }
  const machine = caseStateMachineView(caseView.status, caseTable);

  // The four destructive actions: capability-gated, with the LATEST
  // request per action from the REAL store.
  const latest = latestRequestsByAction(allRequests, activeCase.caseId);
  const requestViewOf = (action: string): DestructiveRequestViewModel | undefined => {
    const record = latest[action];
    if (record === undefined) return undefined;
    try {
      return buildDestructiveRequestViewModel(scope, state.requests, record.requestId, requestTable);
    } catch {
      return undefined;
    }
  };
  const supported = (flag: boolean): boolean => capabilities !== undefined && flag;
  const actions: readonly DestructiveActionEntry[] = DESTRUCTIVE_ACTION_SET.map((action) => {
    const requestLike = latest[action];
    return frozen<DestructiveActionEntry>({
      action,
      label: DESTRUCTIVE_ACTION_LABELS[action],
      expectedEffect: DESTRUCTIVE_ACTION_EFFECTS[action],
      evidenceRequirement: DESTRUCTIVE_ACTION_EVIDENCE[action],
      supported: supported(capabilities?.[action] ?? false),
      affordance: destructiveActionAffordance(action, machine, requestLike),
      request: requestViewOf(action),
    });
  });

  // The lost-flow timeline context (the screen's prop): the real
  // last-seen evidence + the case view + the capabilities.
  let lastSeenObservedAt: string | undefined;
  try {
    const findMyView = state.findMy.view(guard.tenantId, deviceId, options.now, {
      freshWithinMs: options.freshWithinMs,
      staleAfterMs: options.staleAfterMs,
    });
    lastSeenObservedAt = findMyView.lastSeen?.observedAt;
  } catch {
    lastSeenObservedAt = undefined;
  }
  const lostFlow: LostFlowContext = frozen({
    lastSeenObservedAt,
    caseView,
    locatedSupported: supported(capabilities?.locate ?? false),
    lockSupported: supported(capabilities?.lock ?? false),
    wipeSupported: supported(capabilities?.wipe ?? false),
  });

  // The case journey (the seven-stage walk, from real state).
  const journey = buildRecoveryCaseJourneys(
    scope,
    [activeCase],
    caseTable,
    (deviceOf) => {
      try {
        return state.findMy.view(guard.tenantId, deviceOf, options.now, {
          freshWithinMs: options.freshWithinMs,
          staleAfterMs: options.staleAfterMs,
        }).location;
      } catch {
        return undefined;
      }
    },
    (caseId) => allRequests.filter((request) => request.caseId === caseId),
    options.now,
  )[activeCase.caseId];

  // The lane phase: a PARKED request holds a human decision; an
  // adapter with NO destructive capability is wholly unsupported.
  const parked = Object.values(latest).some((request) => request.status === "PARKED");
  const anySupported = actions.some((entry) => entry.supported);
  const lanePhase: RecoveryLanePhase<RecoveryCaseViewModel | undefined> = parked
    ? { kind: "approval_required", reason: RECOVERY_LANE_REASONS.approvalPending, view: caseView }
    : !anySupported
      ? { kind: "unsupported", reason: RECOVERY_LANE_REASONS.capabilityUnsupported, view: caseView }
      : { kind: "ready", view: caseView };

  return frozen({
    phase: toRecoveryScreenPhase(lanePhase),
    lanePhase,
    caseId: activeCase.caseId,
    actions,
    lostFlow,
    journey,
  });
}

/** The synthetic tenant (re-exported for the feed's consumers). */
export const RECOVERY_FEED_SYSTEM_TENANT = SYNTHETIC_SYSTEM_TENANT;
