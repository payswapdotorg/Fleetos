/**
 * @fleetos/actions — D1: the FleetAction domain model — group selection,
 * action plan templates (PROPOSAL status only), target resolution (pure
 * function: selector -> device set, injected device registry view).
 *
 * Per `spec/ARCHITECTURE.md` § Intent model: the Fleet Action intent
 * carries a frozen `FleetActionIntentPayload` (`actionPlanRef` +
 * `targetCount`) OWNED by `@fleetos/actions` (per the frozen
 * `@fleetos/contracts` doc comments; the shapes are already frozen
 * for this package — it never modifies them). The FleetAction domain
 * model in this module is the BUILDER of those plans: a plan is a
 * versioned, immutable proposal (selected targets + intended
 * capability invocations per target + PROPOSAL status only).
 *
 * Per `spec/ARCHITECTURE.md` § Decision boundary: "A deterministic
 * policy/authorization layer remains authoritative for whether an action
 * is permitted." Action plans are PROPOSALS until the W031 Contract
 * Guardian evaluates them (see `policy-gate.ts`); NEVER automatic
 * execution. The Guardian's decision boundary (ALLOW / REQUIRE_APPROVAL /
 * BLOCK) lives in `@fleetos/policy` (lane B, same as this package).
 *
 * Per `spec/ARCHITECTURE-LOCK.md` item 16: "Destructive actions require
 * an explicit policy grant and evidence trail." Selectors that target
 * destructive capabilities (`enforce`, `remediate`, `lock`, `locate`,
 * `wipe`, `reboot`, `update`) carry the capability in the plan; the
 * policy gate asserts the explicit grant before the plan can advance.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import { asActionId } from "@fleetos/contracts";
import type {
  ActionId,
  AdapterCapabilities,
  CausationId,
  CorrelationId,
  DeviceId,
  DeviceLifecycleState,
  EvidenceRef,
  FleetError,
  TenantId,
  UserId,
} from "@fleetos/contracts";
import {
  DESTRUCTIVE_CAPABILITIES,
  isDestructive,
  isSupported,
} from "@fleetos/contracts";
import type { DeviceDescriptor, DeviceRegistryView } from "./device-descriptor";
import {
  ACTIONS_PIPELINE_CORRELATION_ID,
  ERROR_CODES,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  deepFrozen,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Action plan status (the proposal lifecycle)
// ---------------------------------------------------------------------------

/**
 * The status of a Fleet Action plan. Per `spec/ARCHITECTURE.md` § Decision
 * boundary, a plan is a PROPOSAL until the Contract Guardian evaluates
 * it. The W041 work order documents the transition semantics:
 *
 *   PROPOSAL -> ADVANCED            (Guardian ALLOW)
 *   PROPOSAL -> PARKED              (Guardian REQUIRE_APPROVAL — held for human approval)
 *   PROPOSAL -> REJECTED            (Guardian BLOCK)
 *   PARKED  -> APPROVED              (human approval — the W031-deferred step)
 *   PARKED  -> REJECTED              (human rejection of the held plan)
 *   APPROVED -> (terminal — execution belongs to W060B / device-adapters, not this package)
 *
 * ADVANCED / APPROVED / REJECTED are terminal from the policy-gate
 * perspective (the actions package stops at the proposal-gated boundary;
 * execution is downstream).
 */
export const PROPOSAL = "PROPOSAL" as const;
export const ADVANCED = "ADVANCED" as const;
export const PARKED = "PARKED" as const;
export const APPROVED = "APPROVED" as const;
export const REJECTED = "REJECTED" as const;

export type ActionPlanStatus =
  | typeof PROPOSAL
  | typeof ADVANCED
  | typeof PARKED
  | typeof APPROVED
  | typeof REJECTED;

/**
 * The transition table. Each key is a "from" state; each value is the set
 * of states that may legally follow it. The proposal-gated boundary is
 * strict: PROPOSAL transitions to ADVANCED/PARKED/REJECTED only via the
 * Guardian decision; PARKED transitions to APPROVED/REJECTED only via the
 * human-approval step; ADVANCED/APPROVED/REJECTED are terminal from the
 * policy-gate perspective.
 */
export const ACTION_PLAN_TRANSITIONS: Readonly<
  Record<ActionPlanStatus, readonly ActionPlanStatus[]>
> = Object.freeze({
  [PROPOSAL]: Object.freeze([ADVANCED, PARKED, REJECTED]),
  [PARKED]: Object.freeze([APPROVED, REJECTED]),
  [ADVANCED]: Object.freeze([]),
  [APPROVED]: Object.freeze([]),
  [REJECTED]: Object.freeze([]),
});

/** Terminal statuses from the policy-gate perspective. */
export const TERMINAL_ACTION_PLAN_STATUSES: readonly ActionPlanStatus[] = Object.freeze([
  ADVANCED,
  APPROVED,
  REJECTED,
]);

/**
 * Pure transition predicate. Returns true if `from -> to` is a legal
 * policy-gate transition per `ACTION_PLAN_TRANSITIONS`.
 *
 * @param from the current status
 * @param to the proposed next status
 * @returns true if the transition is legal
 */
export function canTransitionActionPlan(
  from: ActionPlanStatus,
  to: ActionPlanStatus,
): boolean {
  const allowed = ACTION_PLAN_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Device group selectors (typed, deterministic)
// ---------------------------------------------------------------------------

/**
 * The intent per target: which capability the plan proposes to invoke on
 * each selected device. The capability MUST be one of the frozen
 * `AdapterCapabilities` keys; destructive capabilities carry an explicit
 * grant requirement at the policy-gate boundary (the Guardian decides).
 */
export type ActionTargetCapability = keyof AdapterCapabilities;

/** The full set of capability names (mirrors the frozen contracts table). */
export const ALL_ACTION_CAPABILITIES: readonly ActionTargetCapability[] = Object.freeze([
  "identify",
  "observe",
  "diagnose",
  "enforce",
  "remediate",
  "lock",
  "locate",
  "wipe",
  "reboot",
  "update",
  "health",
]);

/**
 * A typed device-group selector — a PURE value (no I/O) that the target
 * resolver evaluates against an injected `DeviceRegistryView`. The
 * discriminated union covers the canonical selection dimensions:
 *   - `all`: every device in the tenant (the universal selector)
 *   - `byId`: an explicit device id list (closed set; resolved as the
 *     intersection with the registry — foreign ids are filtered out,
 *     never raising an existence side channel)
 *   - `byPlatform`: by adapter platform family (open string)
 *   - `byOwnership`: by ownership model (open string)
 *   - `byLifecycleState`: by current device lifecycle state (frozen contracts)
 *   - `byCapability`: devices whose declared adapter capabilities
 *     explicitly support the named capability (frozen `isSupported`)
 *   - `byPostureSummary`: devices with the named posture summary
 *     (open string; populated by the binding site from the security
 *     package's posture derivation — the actions package never imports
 *     security, the consumer supplies the descriptor's `postureSummary` field
 *     via a richer DeviceDescriptor extension at the binding site — for now
 *     this selector targets devices whose `postureSummary` matches the
 *     open string)
 *   - `intersect` / `union` / `subtract`: set algebra over sub-selectors
 *
 * Selectors compose; resolution is deterministic — the same selector +
 * the same registry produce the same device set, byte-for-byte, every
 * run. Resolved target sets are sorted by deviceId for stable ordering.
 */
export type DeviceGroupSelector =
  | { readonly kind: "all" }
  | { readonly kind: "byId"; readonly deviceIds: readonly DeviceId[] }
  | { readonly kind: "byPlatform"; readonly platform: string }
  | { readonly kind: "byOwnership"; readonly ownership: string }
  | { readonly kind: "byLifecycleState"; readonly state: DeviceLifecycleState }
  | { readonly kind: "byCapability"; readonly capability: ActionTargetCapability }
  | { readonly kind: "byPostureSummary"; readonly summary: string }
  | { readonly kind: "intersect"; readonly selectors: readonly DeviceGroupSelector[] }
  | { readonly kind: "union"; readonly selectors: readonly DeviceGroupSelector[] }
  | { readonly kind: "subtract"; readonly base: DeviceGroupSelector; readonly minus: DeviceGroupSelector };

/** All selector kinds (for validation + iteration). */
export const ALL_SELECTOR_KINDS: readonly DeviceGroupSelector["kind"][] = Object.freeze([
  "all",
  "byId",
  "byPlatform",
  "byOwnership",
  "byLifecycleState",
  "byCapability",
  "byPostureSummary",
  "intersect",
  "union",
  "subtract",
]);

// ---------------------------------------------------------------------------
// Action plan template (versioned, immutable PROPOSAL)
// ---------------------------------------------------------------------------

/**
 * A versioned, immutable Fleet Action plan. A plan is a PROPOSAL until
 * the W031 Contract Guardian evaluates it (`policy-gate.ts`):
 *   - `selectedTargets` are resolved at creation time (the plan captures
 *     the device set the proposal was based on; re-resolution after
 *     registry changes is a new revision with a new content digest —
 *     versioned-interpretation discipline);
 *   - `capability` is the intended capability invocation per target
 *     (destructive capabilities require an explicit policy grant at the
 *     policy-gate boundary);
 *   - `status` is PROPOSAL at creation; it transitions only via the
 *     policy gate;
 *   - `planId` is the deterministic digest of (tenantId, name); stable
 *     across revisions;
 *   - `contentDigest` is the canonical digest of the content (selector +
 *     capability + selectedTargets + status); the same content produces
 *     the same digest.
 */
export interface ActionPlanTemplate {
  /** The deterministic plan identity: digest of (tenantId, name). */
  readonly planId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The stable human name (part of the identity digest; non-empty). */
  readonly name: string;
  /** Human description (never matched on). */
  readonly description?: string;
  /** The plan version (>= 1; increments on every revision). */
  readonly version: number;
  /** The device-group selector the targets were resolved from. */
  readonly selector: DeviceGroupSelector;
  /** The intended capability invocation per target. */
  readonly capability: ActionTargetCapability;
  /** The resolved target device set (sorted by deviceId; frozen). */
  readonly selectedTargets: readonly DeviceId[];
  /** The target count (mirrors `selectedTargets.length` — also surfaced in the FleetActionIntentPayload). */
  readonly targetCount: number;
  /** The plan status (PROPOSAL at creation; transitions via the policy gate). */
  readonly status: ActionPlanStatus;
  /** ISO 8601 creation timestamp (injected). */
  readonly createdAt: string;
  /** ISO 8601 last-transition timestamp (absent on PROPOSAL). */
  readonly transitionedAt?: string;
  /** The principal who requested the action, when known (open string). */
  readonly requestedBy?: UserId;
  /** Evidence artifacts supporting the plan (never interpreted by actions). */
  readonly evidence: readonly EvidenceRef[];
  /** Canonical digest of the plan's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

// ---------------------------------------------------------------------------
// Selector validation (recursive, pure)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

/**
 * Validate a selector (recursive). Appends failures to the list; empty
 * additions mean valid. Enforces: known kind, well-formed `byId` (non-
 * empty string list), non-empty `intersect`/`union` sub-selectors, a
 * `subtract` carrying both `base` and `minus`. Pure; never throws.
 *
 * @param selector the candidate selector
 * @param path the JSON-pointer path for failure reporting
 * @param failures the accumulating failure list
 */
export function validateSelector(
  selector: unknown,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(selector)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const kind = selector["kind"];
  if (typeof kind !== "string" || !(ALL_SELECTOR_KINDS as readonly string[]).includes(kind)) {
    failures.push({ path: `${path}.kind`, reason: "unknown_selector_kind" });
    return;
  }
  switch (kind as DeviceGroupSelector["kind"]) {
    case "all":
      return;
    case "byId": {
      if (!isStringArray(selector["deviceIds"])) {
        failures.push({ path: `${path}.deviceIds`, reason: "non_empty_string_array_required" });
      }
      return;
    }
    case "byPlatform": {
      if (typeof selector["platform"] !== "string" || (selector["platform"] as string).length === 0) {
        failures.push({ path: `${path}.platform`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "byOwnership": {
      if (typeof selector["ownership"] !== "string" || (selector["ownership"] as string).length === 0) {
        failures.push({ path: `${path}.ownership`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "byLifecycleState": {
      const state = selector["state"];
      if (typeof state !== "string" || state.length === 0) {
        failures.push({ path: `${path}.state`, reason: "lifecycle_state_required" });
      }
      return;
    }
    case "byCapability": {
      const cap = selector["capability"];
      if (typeof cap !== "string" || !(ALL_ACTION_CAPABILITIES as readonly string[]).includes(cap)) {
        failures.push({ path: `${path}.capability`, reason: "unknown_capability" });
      }
      return;
    }
    case "byPostureSummary": {
      if (typeof selector["summary"] !== "string" || (selector["summary"] as string).length === 0) {
        failures.push({ path: `${path}.summary`, reason: "non_empty_string_required" });
      }
      return;
    }
    case "intersect":
    case "union": {
      const subs = selector["selectors"];
      if (!Array.isArray(subs) || subs.length === 0) {
        failures.push({ path: `${path}.selectors`, reason: "non_empty_array_required" });
        return;
      }
      for (let i = 0; i < subs.length; i++) {
        validateSelector(subs[i], `${path}.selectors/${i}`, failures);
      }
      return;
    }
    case "subtract": {
      const base = selector["base"];
      const minus = selector["minus"];
      if (base === undefined) {
        failures.push({ path: `${path}.base`, reason: "required" });
      } else {
        validateSelector(base, `${path}.base`, failures);
      }
      if (minus === undefined) {
        failures.push({ path: `${path}.minus`, reason: "required" });
      } else {
        validateSelector(minus, `${path}.minus`, failures);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Target resolution (pure function: selector -> device set)
// ---------------------------------------------------------------------------

/**
 * Resolve a device-group selector against the injected device registry
 * view. PURE: the same selector + the same registry produce the same
 * device set, byte-for-byte, every run. The output is sorted by deviceId
 * (as a string) for deterministic ordering — required for byte-stable
 * plan ids and content digests.
 *
 * The registry is INJECTED (never constructed inside the actions
 * package): the consumer supplies the view at the call site (an adapter
 * that projects a TwinStore, a typed device registry, or an in-memory
 * test fixture). The actions package never reads the clock and never
 * crosses tenants — the view's `list` returns only the supplied
 * tenant's devices.
 *
 * `byId` selectors: foreign ids (those not present in the tenant's
 * registry) are filtered out — there is no existence side channel
 * (foreign ids are indistinguishable from absent ones, mirroring the
 * tenant-isolation convention of the W012/W021/W022 stores).
 *
 * @param selector the device-group selector
 * @param registry the injected device registry view
 * @param tenantId the acting tenant
 * @returns a frozen readonly array of DeviceIds, sorted by id
 */
export function resolveActionTargets(
  selector: DeviceGroupSelector,
  registry: DeviceRegistryView,
  tenantId: TenantId,
): readonly DeviceId[] {
  const devices = registry.list(tenantId);
  return resolveSelector(selector, devices);
}

function resolveSelector(
  selector: DeviceGroupSelector,
  devices: readonly DeviceDescriptor[],
): readonly DeviceId[] {
  switch (selector.kind) {
    case "all":
      return frozenArray(devices.map((d) => d.deviceId).sort(compareDeviceId));
    case "byId": {
      const wanted = new Set(selector.deviceIds.map((id) => id as string));
      const filtered = devices
        .filter((d) => wanted.has(d.deviceId as string))
        .map((d) => d.deviceId);
      return frozenArray(filtered.sort(compareDeviceId));
    }
    case "byPlatform":
      return frozenArray(
        devices
          .filter((d) => d.platform === selector.platform)
          .map((d) => d.deviceId)
          .sort(compareDeviceId),
      );
    case "byOwnership":
      return frozenArray(
        devices
          .filter((d) => d.ownership === selector.ownership)
          .map((d) => d.deviceId)
          .sort(compareDeviceId),
      );
    case "byLifecycleState":
      return frozenArray(
        devices
          .filter((d) => d.lifecycleState === selector.state)
          .map((d) => d.deviceId)
          .sort(compareDeviceId),
      );
    case "byCapability":
      return frozenArray(
        devices
          .filter((d) => isSupported(selector.capability, d.adapterCapabilities))
          .map((d) => d.deviceId)
          .sort(compareDeviceId),
      );
    case "byPostureSummary":
      // The descriptor's postureSummary is a forward-compatible extension;
      // the actions package's frozen descriptor does not include the field,
      // so the binding site MAY attach it via a structural supertype. When
      // the descriptor does not carry a postureSummary, this selector
      // returns the empty set (fail-closed: "select devices whose posture
      // matches X" should not over-select when posture is unknown).
      return frozenArray(
        devices
          .filter((d) => {
            const ext = d as unknown as { postureSummary?: unknown };
            return ext.postureSummary === selector.summary;
          })
          .map((d) => d.deviceId)
          .sort(compareDeviceId),
      );
    case "intersect": {
      const sets = selector.selectors.map((sub) => resolveSelector(sub, devices));
      if (sets.length === 0) return frozenArray([]);
      const intersection: string[] = [];
      const firstSet = sets[0];
      for (const id of firstSet as readonly string[]) {
        if (sets.every((set) => (set as readonly string[]).includes(id))) {
          intersection.push(id);
        }
      }
      return frozenArray(intersection.sort(compareDeviceId) as DeviceId[]);
    }
    case "union": {
      const sets = selector.selectors.map((sub) => resolveSelector(sub, devices));
      const seen = new Set<string>();
      for (const set of sets) {
        for (const id of set as readonly string[]) {
          seen.add(id);
        }
      }
      return frozenArray([...seen].sort(compareDeviceId) as DeviceId[]);
    }
    case "subtract": {
      const base = resolveSelector(selector.base, devices);
      const minus = resolveSelector(selector.minus, devices);
      const minusSet = new Set(minus as readonly string[]);
      return frozenArray(
        (base as readonly string[]).filter((id) => !minusSet.has(id)).sort(compareDeviceId) as DeviceId[],
      );
    }
  }
}

function compareDeviceId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Plan construction (deterministic, immutable PROPOSAL)
// ---------------------------------------------------------------------------

/** Input for `createActionPlan`. */
export interface CreateActionPlanInput {
  /** Stable name (non-empty; part of the identity digest). */
  readonly name: string;
  /** Optional description. */
  readonly description?: string;
  /** The device-group selector the targets are resolved from. */
  readonly selector: DeviceGroupSelector;
  /** The intended capability invocation per target. */
  readonly capability: ActionTargetCapability;
  /** The acting tenant scope. */
  readonly tenantId: TenantId;
  /** The injected device registry view (resolves `selector` to targets). */
  readonly registry: DeviceRegistryView;
  /** Injected creation timestamp (ISO 8601). */
  readonly at: string;
  /** The principal who requested the action, when known. */
  readonly requestedBy?: UserId;
  /** Evidence artifacts supporting the plan (never interpreted). */
  readonly evidence?: readonly EvidenceRef[];
}

/** The tagged result of a plan build. */
export type ActionPlanBuild =
  | { readonly ok: true; readonly plan: ActionPlanTemplate }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The deterministic plan-id digest: FNV-1a over the canonical JSON of the
 * identity tuple (tenantId, name). Exposed for tests and callers that
 * need to predict ids.
 *
 * @param tenantId the owning tenant
 * @param name the stable plan name
 * @returns the `pln_`-prefixed id
 */
export function actionPlanId(tenantId: TenantId, name: string): string {
  return `pln_${fnv1a32Hex(canonicalJson([tenantId, name]))}`;
}

/** Canonical digest of a plan's content (identity fields excluded). */
function planContentDigest(input: {
  name: string;
  selector: DeviceGroupSelector;
  capability: ActionTargetCapability;
  selectedTargets: readonly DeviceId[];
  status: ActionPlanStatus;
}): string {
  return fnv1a32Hex(
    canonicalJson({
      name: input.name,
      selector: input.selector,
      capability: input.capability,
      selectedTargets: input.selectedTargets.map((id) => id as string),
      status: input.status,
    }),
  );
}

/**
 * Create a Fleet Action plan template (version 1, PROPOSAL status). The
 * selector is resolved against the injected registry at creation time;
 * the selected targets are frozen into the plan (a re-resolution after
 * registry changes is a new revision, not an in-place mutation —
 * versioned-interpretation discipline). The plan's `targetCount` mirrors
 * `selectedTargets.length` so the frozen `FleetActionIntentPayload` (the
 * intent kind OWNED by this package) carries the resolved count.
 *
 * Validation is tagged (no throw): invalid selector, unknown capability,
 * non-ISO timestamp, or missing name produce a `ValidationError` with
 * field paths. Destructive capabilities (`enforce`, `remediate`, `lock`,
 * `locate`, `wipe`, `reboot`, `update`) are ACCEPTED at creation — the
 * plan is a PROPOSAL; the explicit policy grant is asserted at the
 * policy-gate boundary (the Guardian decides).
 *
 * @param input the creation input
 * @returns the tagged build result
 */
export function createActionPlan(input: CreateActionPlanInput): ActionPlanBuild {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.name !== "string" || input.name.length === 0) {
    failures.push({ path: "/name", reason: "non_empty_string_required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (
    input?.capability === undefined ||
    !(ALL_ACTION_CAPABILITIES as readonly string[]).includes(input.capability)
  ) {
    failures.push({ path: "/capability", reason: "unknown_capability" });
  }
  if (input?.tenantId === undefined || typeof input.tenantId !== "string") {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (input?.selector === undefined) {
    failures.push({ path: "/selector", reason: "required" });
  } else {
    validateSelector(input.selector, "/selector", failures);
  }
  if (input?.description !== undefined && typeof input.description !== "string") {
    failures.push({ path: "/description", reason: "string_required" });
  }
  if (input?.evidence !== undefined && !Array.isArray(input.evidence)) {
    failures.push({ path: "/evidence", reason: "array_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.planInvalid,
        "action plan creation is invalid",
        {
          tenantId: typeof input?.tenantId === "string" ? input.tenantId : SYNTHETIC_SYSTEM_TENANT,
          correlationId: ACTIONS_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }
  const selectedTargets = resolveActionTargets(input.selector, input.registry, input.tenantId);
  const plan: ActionPlanTemplate = frozen({
    planId: actionPlanId(input.tenantId, input.name),
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    version: 1,
    selector: deepFrozen(input.selector) as DeviceGroupSelector,
    capability: input.capability,
    selectedTargets: frozenArray(selectedTargets),
    targetCount: selectedTargets.length,
    status: PROPOSAL,
    createdAt: input.at,
    requestedBy: input.requestedBy,
    evidence: frozenArray(input.evidence ?? []),
    contentDigest: planContentDigest({
      name: input.name,
      selector: input.selector,
      capability: input.capability,
      selectedTargets,
      status: PROPOSAL,
    }),
  });
  return { ok: true, plan };
}

/**
 * Produce the NEXT plan revision with a transitioned status (the policy-
 * gate step). The prior record is never rewritten — versioned-
 * interpretation discipline. At least one transition must be supplied
 * (the new status + injected timestamp); the identity (planId, name,
 * selector, capability, selectedTargets) is immutable across revisions.
 *
 * @param plan the prior version
 * @param to the new status (must be a legal transition per `canTransitionActionPlan`)
 * @param at the injected transition timestamp
 * @param correlationId (unused at this layer; the audit sink records it)
 * @returns the tagged build result
 */
export function transitionActionPlan(
  plan: ActionPlanTemplate,
  to: ActionPlanStatus,
  at: string,
  _correlationId?: CorrelationId,
): ActionPlanBuild {
  const failures: { path: string; reason: string }[] = [];
  if (typeof at !== "string" || !looksLikeIso(at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (!canTransitionActionPlan(plan.status, to)) {
    failures.push({
      path: "/to",
      reason: "illegal_transition",
    });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.planStatusIllegal,
        `action plan transition from ${plan.status} to ${to} is illegal`,
        {
          tenantId: plan.tenantId,
          correlationId: ACTIONS_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }
  const next: ActionPlanTemplate = frozen({
    ...plan,
    version: plan.version + 1,
    status: to,
    transitionedAt: at,
    contentDigest: planContentDigest({
      name: plan.name,
      selector: plan.selector,
      capability: plan.capability,
      selectedTargets: plan.selectedTargets,
      status: to,
    }),
  });
  return { ok: true, plan: next };
}

// ---------------------------------------------------------------------------
// Frozen capability helpers (re-exported for callers)
// ---------------------------------------------------------------------------

export {
  DESTRUCTIVE_CAPABILITIES,
  isDestructive,
  isSupported,
};

/** Convenience constructor for an `ActionId` (the frozen contracts helper). */
export function newActionId(value: string): ActionId {
  return asActionId(value);
}

/** A `CausationId` typed alias for action-emitted causes (uses the frozen contracts helper). */
export function asActionCausationId(value: string): CausationId {
  // Re-use the contracts' branded-string approach (structurally identical).
  return value as unknown as CausationId;
}

/** A `CorrelationId` typed alias for action-emitted correlations. */
export function asActionCorrelationId(value: string): CorrelationId {
  return value as unknown as CorrelationId;
}
