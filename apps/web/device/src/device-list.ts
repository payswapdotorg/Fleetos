/**
 * @fleetos/web-device — D1: the device roster (list) surface.
 *
 * The device roster view-model: listing, filtering, deterministic
 * ordering, pagination, facet counts and the selection state machine
 * over the Device Twin domain shapes consumed through the STRUCTURAL
 * `DeviceTwinSource` seam (the W040-disclosed pattern — the real
 * `@fleetos/device-model` TwinStore is injected at the binding site and
 * proven by test).
 *
 * Every view-model is PURE and DETERMINISTIC:
 *   - no wall clock — the staleness reference instant `now` is injected;
 *   - no randomness, no I/O;
 *   - the acting tenant rides every query (FIRST parameter) and a
 *     refused scope yields a deterministic EMPTY view (no data, no leak);
 *   - the same (source, query, options) always produce a byte-identical
 *     view-model (proven by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { DEVICE_LIFECYCLE_ORDER } from "@fleetos/contracts";
import type { DeviceLifecycleState, DeviceId, TenantId } from "@fleetos/contracts";
import {
  SYNTHETIC_SYSTEM_TENANT,
  checkDeviceUiTenantScope,
  compareStrings,
  frozen,
  frozenArray,
  parseIsoMs,
} from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type { DeviceTwinLike, DeviceTwinSource } from "./seams";

// ---------------------------------------------------------------------------
// Staleness banding (the injected-instant derivation)
// ---------------------------------------------------------------------------

/**
 * The display staleness band of a device's last observation. The band
 * semantics mirror the recovery lane's frozen staleness classification
 * (fresh / stale / unknown — future-dated evidence is `unknown`, never
 * a guess); `never_observed` is the deterministic band for a twin whose
 * telemetry window is still empty.
 */
export type StalenessBand = "never_observed" | "fresh" | "unknown" | "stale";

/** The canonical display order of the staleness bands (deterministic). */
export const STALENESS_BAND_ORDER: readonly StalenessBand[] = Object.freeze([
  "never_observed",
  "fresh",
  "unknown",
  "stale",
]);

/** The injected staleness thresholds (band policy — never a clock read). */
export interface StalenessBands {
  /** Evidence observed within this many milliseconds of `now` is fresh. */
  readonly freshWithinMs: number;
  /** Evidence older than this many milliseconds from `now` is stale. */
  readonly staleAfterMs: number;
}

/** Classify a telemetry last-observed instant into a display band. PURE. */
export function classifyTelemetryBand(
  lastObservedAt: string | null,
  now: string,
  bands: StalenessBands,
): StalenessBand {
  if (lastObservedAt === null) return "never_observed";
  const nowMs = parseIsoMs(now);
  const observedMs = parseIsoMs(lastObservedAt);
  if (Number.isNaN(nowMs) || Number.isNaN(observedMs)) return "unknown";
  const age = nowMs - observedMs;
  if (age < 0) return "unknown"; // future-dated evidence — never a guess
  if (age <= bands.freshWithinMs) return "fresh";
  if (age > bands.staleAfterMs) return "stale";
  return "unknown";
}

// ---------------------------------------------------------------------------
// The composable filter algebra (typed, deterministic)
// ---------------------------------------------------------------------------

/**
 * A device roster filter — a PURE value evaluated against the
 * twin-like projection. Composable with `and`/`or`/`not` (mirrors the
 * actions lane's device-group selector algebra; the same selector +
 * the same roster always resolve to the same device set).
 */
export type DeviceListFilter =
  | { readonly kind: "all" }
  | { readonly kind: "lifecycle"; readonly state: DeviceLifecycleState }
  | { readonly kind: "ownership"; readonly ownerType: string }
  | { readonly kind: "posture"; readonly summary: string }
  | { readonly kind: "platform"; readonly adapterFamily: string }
  | { readonly kind: "assignedTeam"; readonly team: string }
  | { readonly kind: "recoveryState"; readonly state: string }
  | {
      /** Case-insensitive substring match over identity/hardware fields. */
      readonly kind: "search";
      readonly text: string;
    }
  | { readonly kind: "observed"; readonly band: StalenessBand }
  | { readonly kind: "and"; readonly filters: readonly DeviceListFilter[] }
  | { readonly kind: "or"; readonly filters: readonly DeviceListFilter[] }
  | { readonly kind: "not"; readonly filter: DeviceListFilter };

/** Validate a filter (recursive). Empty failure list = valid. PURE. */
export function validateDeviceListFilter(
  filter: unknown,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (filter === null || typeof filter !== "object") {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const candidate = filter as { kind?: unknown; filters?: unknown; filter?: unknown; text?: unknown };
  if (typeof candidate.kind !== "string" || candidate.kind.length === 0) {
    failures.push({ path: `${path}/kind`, reason: "required" });
    return;
  }
  switch (candidate.kind) {
    case "all":
      return;
    case "lifecycle":
    case "ownership":
    case "posture":
    case "platform":
    case "assignedTeam":
    case "recoveryState":
    case "search":
    case "observed":
      return;
    case "and":
    case "or": {
      if (!Array.isArray(candidate.filters) || candidate.filters.length === 0) {
        failures.push({ path: `${path}/filters`, reason: "non_empty_array_required" });
        return;
      }
      candidate.filters.forEach((sub, i) =>
        validateDeviceListFilter(sub, `${path}/filters/${i}`, failures),
      );
      return;
    }
    case "not": {
      if (candidate.filter === null || typeof candidate.filter !== "object") {
        failures.push({ path: `${path}/filter`, reason: "filter_required" });
        return;
      }
      validateDeviceListFilter(candidate.filter, `${path}/filter`, failures);
      return;
    }
    default:
      failures.push({ path: `${path}/kind`, reason: "unknown_filter_kind" });
  }
}

/** The search haystack fields (deterministic, lowercase). */
function searchHaystack(twin: DeviceTwinLike): string {
  const fields = [
    twin.deviceId as string,
    twin.identity.enrollment.hardware.manufacturer,
    twin.identity.enrollment.hardware.model,
    twin.identity.enrollment.hardware.serialNumber ?? "",
    twin.identity.enrollment.hardware.assetTag ?? "",
    twin.identity.ownership.assignedTeam ?? "",
  ];
  return fields.join("\u0000").toLowerCase();
}

/** Does one twin match one (validated) filter? PURE. */
function matchesFilter(
  twin: DeviceTwinLike,
  filter: DeviceListFilter,
  now: string,
  bands: StalenessBands,
): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "lifecycle":
      return twin.identity.lifecycleState === filter.state;
    case "ownership":
      return twin.identity.ownership.ownerType === filter.ownerType;
    case "posture":
      return twin.securityPosture.postureSummary === filter.summary;
    case "platform":
      return twin.identity.enrollment.adapterFamily === filter.adapterFamily;
    case "assignedTeam":
      return twin.identity.ownership.assignedTeam === filter.team;
    case "recoveryState":
      return twin.actions.recoveryState === filter.state;
    case "search":
      return filter.text.trim().length === 0
        ? true // an empty search matches every device (documented)
        : searchHaystack(twin).includes(filter.text.trim().toLowerCase());
    case "observed":
      return (
        classifyTelemetryBand(twin.telemetry.lastObservedAt, now, bands) === filter.band
      );
    case "and":
      return filter.filters.every((sub) => matchesFilter(twin, sub, now, bands));
    case "or":
      return filter.filters.some((sub) => matchesFilter(twin, sub, now, bands));
    case "not":
      return !matchesFilter(twin, filter.filter, now, bands);
  }
}

// ---------------------------------------------------------------------------
// Ordering + pagination
// ---------------------------------------------------------------------------

/** The sortable roster fields. The deviceId tiebreak is ALWAYS applied. */
export type DeviceListSortField =
  | "deviceId"
  | "lifecycle"
  | "enrolledAt"
  | "lastObservedAt"
  | "posture"
  | "manufacturer"
  | "model"
  | "revision";

export type SortDirection = "asc" | "desc";

export interface DeviceListSort {
  readonly field: DeviceListSortField;
  readonly direction: SortDirection;
}

/** The deterministic sort key of a twin for the chosen field. */
function sortKey(twin: DeviceTwinLike, field: DeviceListSortField): string {
  switch (field) {
    case "deviceId":
      return twin.deviceId as string;
    case "lifecycle": {
      const order = DEVICE_LIFECYCLE_ORDER.indexOf(twin.identity.lifecycleState);
      return String(order).padStart(2, "0");
    }
    case "enrolledAt":
      return twin.identity.enrolledAt;
    case "lastObservedAt":
      return twin.telemetry.lastObservedAt ?? ""; // never-observed sorts first (asc)
    case "posture":
      return twin.securityPosture.postureSummary;
    case "manufacturer":
      return twin.identity.enrollment.hardware.manufacturer;
    case "model":
      return twin.identity.enrollment.hardware.model;
    case "revision":
      return String(twin.revision).padStart(8, "0");
  }
}

/** Pagination: an explicit offset/limit window, or the whole match set. */
export type DeviceListPage = { readonly offset: number; readonly limit: number } | "all";

// ---------------------------------------------------------------------------
// The view-models
// ---------------------------------------------------------------------------

/** One roster row — the flattened, display-ready twin projection. */
export interface DeviceRowViewModel {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** Deterministic display name: "<manufacturer> <model>". */
  readonly displayName: string;
  readonly hardware: {
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber?: string;
    readonly assetTag?: string;
  };
  readonly ownership: {
    readonly ownerType: string;
    readonly assignedUserId?: string;
    readonly assignedTeam?: string;
    readonly assignedAt: string;
  };
  readonly lifecycleState: DeviceLifecycleState;
  /** 0-based position in the frozen canonical lifecycle order. */
  readonly lifecyclePosition: number;
  readonly adapterFamily: string;
  readonly postureSummary: string;
  readonly findingCount: number;
  readonly lastObservedAt: string | null;
  readonly staleness: StalenessBand;
  readonly observationCount: number;
  readonly workloadCount: number;
  readonly recoveryState: string;
  readonly activeActionCount: number;
  readonly revision: number;
}

/** Facet counts over the MATCHED set (pre-pagination), guiding refinement. */
export interface DeviceListFacets {
  readonly byLifecycle: readonly { readonly value: DeviceLifecycleState; readonly count: number }[];
  readonly byPosture: readonly { readonly value: string; readonly count: number }[];
  readonly byOwnership: readonly { readonly value: string; readonly count: number }[];
  readonly byRecovery: readonly { readonly value: string; readonly count: number }[];
  readonly byStaleness: readonly { readonly value: StalenessBand; readonly count: number }[];
}

/** The roster view-model (pure projection of the matched page + facets). */
export interface DeviceListViewModel {
  readonly tenantId: TenantId;
  /** The injected reference instant the staleness bands were derived at. */
  readonly asOf: string;
  readonly rows: readonly DeviceRowViewModel[];
  readonly totalMatches: number;
  readonly totalDevices: number;
  readonly page: DeviceListPage;
  readonly facets: DeviceListFacets;
}

/** The roster query (tenant rides the scope parameter, not the query). */
export interface DeviceListQuery {
  readonly filter: DeviceListFilter;
  readonly sort: DeviceListSort;
  readonly page: DeviceListPage;
}

/** Options: the injected staleness reference + band thresholds. */
export interface DeviceListOptions extends StalenessBands {
  /** The injected "now" (ISO 8601) — the staleness banding reference. */
  readonly now: string;
}

/** The tagged roster build result. */
export type DeviceListBuild =
  | { readonly ok: true; readonly view: DeviceListViewModel }
  | { readonly ok: false; readonly failures: readonly { path: string; reason: string }[] };

/** Project one twin to a roster row. PURE. */
function rowOf(twin: DeviceTwinLike, now: string, bands: StalenessBands): DeviceRowViewModel {
  return frozen({
    tenantId: twin.tenantId,
    deviceId: twin.deviceId,
    displayName: `${twin.identity.enrollment.hardware.manufacturer} ${twin.identity.enrollment.hardware.model}`,
    hardware: frozen({
      manufacturer: twin.identity.enrollment.hardware.manufacturer,
      model: twin.identity.enrollment.hardware.model,
      serialNumber: twin.identity.enrollment.hardware.serialNumber,
      assetTag: twin.identity.enrollment.hardware.assetTag,
    }),
    ownership: frozen({
      ownerType: twin.identity.ownership.ownerType,
      assignedUserId: twin.identity.ownership.assignedUserId as string | undefined,
      assignedTeam: twin.identity.ownership.assignedTeam,
      assignedAt: twin.identity.ownership.assignedAt,
    }),
    lifecycleState: twin.identity.lifecycleState,
    lifecyclePosition: DEVICE_LIFECYCLE_ORDER.indexOf(twin.identity.lifecycleState),
    adapterFamily: twin.identity.enrollment.adapterFamily,
    postureSummary: twin.securityPosture.postureSummary,
    findingCount: twin.securityPosture.findingCount,
    lastObservedAt: twin.telemetry.lastObservedAt,
    staleness: classifyTelemetryBand(twin.telemetry.lastObservedAt, now, bands),
    observationCount: twin.telemetry.observationCount,
    workloadCount: twin.workload.assignedWorkloadIds.length,
    recoveryState: twin.actions.recoveryState,
    activeActionCount: twin.actions.activeActionIds.length,
    revision: twin.revision,
  });
}

/** The deterministic empty view (guard-refused scope: no data, no leak). */
function emptyDeviceListView(asOf: string, page: DeviceListPage): DeviceListViewModel {
  return frozen({
    tenantId: SYNTHETIC_SYSTEM_TENANT,
    asOf,
    rows: frozenArray([]),
    totalMatches: 0,
    totalDevices: 0,
    page,
    facets: frozen({
      byLifecycle: frozenArray([]),
      byPosture: frozenArray([]),
      byOwnership: frozenArray([]),
      byRecovery: frozenArray([]),
      byStaleness: frozenArray([]),
    }),
  });
}

/**
 * Build the device roster view-model. PURE and DETERMINISTIC: the same
 * (source, query, options) always produce the same rows in the same
 * order with the same facet counts. The source is the INJECTED
 * structural twin source (the real TwinStore at the binding site);
 * foreign-tenant partitions are invisible by construction.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the injected device twin source
 * @param query the roster query (filter + sort + page)
 * @param options the injected staleness reference + bands
 * @returns the tagged build result
 */
export function buildDeviceListViewModel(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  query: DeviceListQuery,
  options: DeviceListOptions,
): DeviceListBuild {
  const failures: { path: string; reason: string }[] = [];
  validateDeviceListFilter(query?.filter, "/filter", failures);
  if (query?.sort === null || typeof query?.sort !== "object") {
    failures.push({ path: "/sort", reason: "object_required" });
  } else if (
    typeof query.sort.field !== "string" ||
    query.sort.field.length === 0
  ) {
    failures.push({ path: "/sort/field", reason: "required" });
  } else if (query.sort.direction !== "asc" && query.sort.direction !== "desc") {
    failures.push({ path: "/sort/direction", reason: "asc_or_desc_required" });
  }
  if (query?.page !== "all") {
    if (query?.page === null || typeof query?.page !== "object") {
      failures.push({ path: "/page", reason: "object_or_all_required" });
    } else {
      if (typeof query.page.offset !== "number" || query.page.offset < 0) {
        failures.push({ path: "/page/offset", reason: "non_negative_number_required" });
      }
      if (typeof query.page.limit !== "number" || query.page.limit < 1) {
        failures.push({ path: "/page/limit", reason: "positive_number_required" });
      }
    }
  }
  if (typeof options?.now !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(options.now)) {
    failures.push({ path: "/options/now", reason: "not_iso" });
  }
  if (typeof options?.freshWithinMs !== "number" || options.freshWithinMs < 0) {
    failures.push({ path: "/options/freshWithinMs", reason: "non_negative_number_required" });
  }
  if (typeof options?.staleAfterMs !== "number" || options.staleAfterMs < 0) {
    failures.push({ path: "/options/staleAfterMs", reason: "non_negative_number_required" });
  }
  if (failures.length > 0) {
    return { ok: false, failures: frozenArray(failures) };
  }

  const guard = checkDeviceUiTenantScope(scope);
  if (!guard.ok) {
    return { ok: true, view: emptyDeviceListView(options.now, query.page) };
  }

  const twins = source.list(guard.tenantId);
  const matched = twins.filter((twin) =>
    matchesFilter(twin, query.filter, options.now, options),
  );

  // Deterministic total order: the chosen field, then deviceId ascending.
  const direction = query.sort.direction === "asc" ? 1 : -1;
  const ordered = [...matched].sort((a, b) => {
    const keyA = sortKey(a, query.sort.field);
    const keyB = sortKey(b, query.sort.field);
    if (keyA !== keyB) return keyA < keyB ? -direction : direction;
    return compareStrings(a.deviceId as string, b.deviceId as string);
  });

  const pageRows =
    query.page === "all"
      ? ordered
      : ordered.slice(query.page.offset, query.page.offset + query.page.limit);

  // Facets over the matched set (pre-pagination).
  const lifecycleCounts = new Map<DeviceLifecycleState, number>();
  const postureCounts = new Map<string, number>();
  const ownershipCounts = new Map<string, number>();
  const recoveryCounts = new Map<string, number>();
  const stalenessCounts = new Map<StalenessBand, number>();
  for (const twin of matched) {
    lifecycleCounts.set(
      twin.identity.lifecycleState,
      (lifecycleCounts.get(twin.identity.lifecycleState) ?? 0) + 1,
    );
    postureCounts.set(
      twin.securityPosture.postureSummary,
      (postureCounts.get(twin.securityPosture.postureSummary) ?? 0) + 1,
    );
    ownershipCounts.set(
      twin.identity.ownership.ownerType,
      (ownershipCounts.get(twin.identity.ownership.ownerType) ?? 0) + 1,
    );
    recoveryCounts.set(
      twin.actions.recoveryState,
      (recoveryCounts.get(twin.actions.recoveryState) ?? 0) + 1,
    );
    const band = classifyTelemetryBand(twin.telemetry.lastObservedAt, options.now, options);
    stalenessCounts.set(band, (stalenessCounts.get(band) ?? 0) + 1);
  }

  const byLifecycle = DEVICE_LIFECYCLE_ORDER.filter((state) => lifecycleCounts.has(state)).map(
    (state) => frozen({ value: state, count: lifecycleCounts.get(state) as number }),
  );
  const byPosture = [...postureCounts.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([value, count]) => frozen({ value, count }));
  const byOwnership = [...ownershipCounts.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([value, count]) => frozen({ value, count }));
  const byRecovery = [...recoveryCounts.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([value, count]) => frozen({ value, count }));
  const byStaleness = STALENESS_BAND_ORDER.filter((band) => stalenessCounts.has(band)).map(
    (band) => frozen({ value: band, count: stalenessCounts.get(band) as number }),
  );

  const view: DeviceListViewModel = frozen({
    tenantId: guard.tenantId,
    asOf: options.now,
    rows: frozenArray(pageRows.map((twin) => rowOf(twin, options.now, options))),
    totalMatches: matched.length,
    totalDevices: twins.length,
    page: query.page,
    facets: frozen({
      byLifecycle: frozenArray(byLifecycle),
      byPosture: frozenArray(byPosture),
      byOwnership: frozenArray(byOwnership),
      byRecovery: frozenArray(byRecovery),
      byStaleness: frozenArray(byStaleness),
    }),
  });
  return { ok: true, view };
}

// ---------------------------------------------------------------------------
// The selection state machine (pure)
// ---------------------------------------------------------------------------

/**
 * The device selection state — a pure state machine over device ids.
 * `many` is always sorted + deduplicated (a set, deterministically
 * ordered); the state NEVER carries domain data, only ids.
 */
export type DeviceSelection =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly deviceId: DeviceId }
  | { readonly kind: "many"; readonly deviceIds: readonly DeviceId[] };

/** Select exactly one device (replaces any prior selection). PURE. */
export function selectOne(deviceId: DeviceId): DeviceSelection {
  return frozen({ kind: "single", deviceId });
}

/** Toggle one device in/out of the selection. PURE. */
export function toggleSelection(state: DeviceSelection, deviceId: DeviceId): DeviceSelection {
  switch (state.kind) {
    case "none":
      return frozen({ kind: "single", deviceId });
    case "single":
      if (state.deviceId === deviceId) return frozen({ kind: "none" });
      return frozen({
        kind: "many",
        deviceIds: frozenArray(
          [state.deviceId, deviceId].slice().sort((a, b) => compareStrings(a as string, b as string)) as DeviceId[],
        ),
      });
    case "many": {
      const has = state.deviceIds.includes(deviceId);
      const next = has
        ? state.deviceIds.filter((id) => id !== deviceId)
        : [...state.deviceIds, deviceId];
      if (next.length === 0) return frozen({ kind: "none" });
      if (next.length === 1) return frozen({ kind: "single", deviceId: next[0] });
      return frozen({
        kind: "many",
        deviceIds: frozenArray(
          next.sort((a, b) => compareStrings(a as string, b as string)) as DeviceId[],
        ),
      });
    }
  }
}

/** Select an explicit set of devices (deduplicated, sorted). PURE. */
export function selectMany(deviceIds: readonly DeviceId[]): DeviceSelection {
  const unique = [...new Set(deviceIds as readonly string[])]
    .sort((a, b) => compareStrings(a, b))
    .map((id) => id as DeviceId);
  if (unique.length === 0) return frozen({ kind: "none" });
  if (unique.length === 1) return frozen({ kind: "single", deviceId: unique[0] });
  return frozen({ kind: "many", deviceIds: frozenArray(unique) });
}

/** Add the visible ids to the selection (union, sorted). PURE. */
export function selectVisible(
  state: DeviceSelection,
  visible: readonly DeviceId[],
): DeviceSelection {
  const current = selectionDeviceIds(state);
  return selectMany([...current, ...visible]);
}

/** Clear the selection. PURE. */
export function clearSelection(): DeviceSelection {
  return frozen({ kind: "none" });
}

/** The selected device ids (sorted; empty when none). PURE. */
export function selectionDeviceIds(state: DeviceSelection): readonly DeviceId[] {
  switch (state.kind) {
    case "none":
      return frozenArray([]);
    case "single":
      return frozenArray([state.deviceId]);
    case "many":
      return state.deviceIds;
  }
}

/** Is the given device selected? PURE. */
export function isDeviceSelected(state: DeviceSelection, deviceId: DeviceId): boolean {
  return selectionDeviceIds(state).includes(deviceId);
}
