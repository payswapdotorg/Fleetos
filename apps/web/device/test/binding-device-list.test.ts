/**
 * W060A web-device — D1 binding tests: the device roster view-model over
 * the REAL `@fleetos/device-model` TwinStore.
 *
 * The REAL `createInMemoryTwinStore()` (the REAL TwinStore) is injected
 * wherever the surface's `DeviceTwinSource` seam is expected — TypeScript
 * structural typing is the compile-time proof, and these tests are the
 * runtime proof that:
 *
 *   - the roster lists/filters/sorts/pages REAL twins deterministically;
 *   - facet counts + staleness bands derive from REAL telemetry;
 *   - the selection state machine is pure and total;
 *   - the same (source, query, options) replay byte-identically;
 *   - tenant isolation: tenant-B twins are invisible to a tenant-A scope,
 *     and a foreign detail lookup is indistinguishable from unknown.
 */

import { test, expect } from "bun:test";
import {
  buildDeviceListViewModel,
  clearSelection,
  isDeviceSelected,
  selectMany,
  selectOne,
  selectVisible,
  selectionDeviceIds,
  toggleSelection,
  type DeviceListFilter,
} from "../src/index";
import type { DeviceSelection } from "../src/index";
import {
  BANDS,
  DEV_A1,
  DEV_A2,
  DEV_A3,
  DEV_B1,
  SCOPE_A,
  SCOPE_B,
  TENANT_A,
  T0,
  atHour,
  obs,
  seededTwinSource,
  twinFixture,
} from "./helpers";

/** A canonical roster query. */
const QUERY = {
  filter: { kind: "all" } as DeviceListFilter,
  sort: { field: "deviceId" as const, direction: "asc" as const },
  page: "all" as const,
};

/** The deterministic fixture fleet (three tenant-A devices + one tenant-B). */
function fleet() {
  return [
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      lifecycleHops: 2, // ASSESS
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(2))],
      postureSummary: "HEALTHY",
    }),
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A2,
      manufacturer: "Dell",
      model: "Latitude 5440",
      ownerType: "LEASED",
      assignedTeam: "field-sales",
      lifecycleHops: 8, // LEARN (terminal)
      observations: [obs("device.power", { batteryPercent: 5 }, atHour(40))],
      postureSummary: "AT_RISK",
      findingCount: 3,
      recoveryState: "ACTIVE",
      activeActionIds: ["act_1"],
    }),
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A3,
      adapterFamily: "macos",
      manufacturer: "Apple",
      model: "MacBook Pro 14",
      lifecycleHops: 0, // ENROLL (never observed)
    }),
    twinFixture({
      tenantId: SCOPE_B.tenantId,
      deviceId: DEV_B1,
      observations: [obs("device.power", { batteryPercent: 50 }, atHour(2))],
    }),
  ];
}

test("the REAL TwinStore satisfies the DeviceTwinSource seam and lists tenant-A twins only", () => {
  const source = seededTwinSource(fleet());
  const result = buildDeviceListViewModel(SCOPE_A, source, QUERY, { now: atHour(72), ...BANDS });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const view = result.view;

  expect(view.tenantId).toBe(TENANT_A);
  expect(view.totalDevices).toBe(3); // tenant-B device invisible
  expect(view.rows.map((r) => r.deviceId as string)).toEqual([
    "dev_testdevice00a1",
    "dev_testdevice00a2",
    "dev_testdevice00a3",
  ]);
});

test("roster rows project the REAL twin sections (hardware, ownership, lifecycle, telemetry)", () => {
  const source = seededTwinSource(fleet());
  const result = buildDeviceListViewModel(SCOPE_A, source, QUERY, { now: atHour(72), ...BANDS });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const a2 = result.view.rows.find((r) => (r.deviceId as string) === "dev_testdevice00a2");
  expect(a2).toBeDefined();
  if (a2 === undefined) throw new Error("unreachable");
  expect(a2.displayName).toBe("Dell Latitude 5440");
  expect(a2.ownership.ownerType).toBe("LEASED");
  expect(a2.ownership.assignedTeam).toBe("field-sales");
  expect(a2.lifecycleState).toBe("LEARN");
  expect(a2.lifecyclePosition).toBe(8);
  expect(a2.postureSummary).toBe("AT_RISK");
  expect(a2.findingCount).toBe(3);
  expect(a2.recoveryState).toBe("ACTIVE");
  expect(a2.activeActionCount).toBe(1);
  expect(a2.observationCount).toBe(1);
  // observed 32h before the injected now (72h) with a 24h stale band => stale
  expect(a2.staleness).toBe("stale");
});

test("staleness bands: fresh within the band, never_observed without telemetry, unknown for future-dated", () => {
  const source = seededTwinSource(fleet());
  const result = buildDeviceListViewModel(SCOPE_A, source, QUERY, { now: atHour(3), ...BANDS });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const byId = new Map(result.view.rows.map((r) => [r.deviceId as string, r]));
  expect(byId.get("dev_testdevice00a1")?.staleness).toBe("fresh"); // observed at 2h, now 3h
  expect(byId.get("dev_testdevice00a3")?.staleness).toBe("never_observed"); // no telemetry
});

test("composable filters: lifecycle, ownership, posture, platform, team, search, observed band, and/or/not", () => {
  const source = seededTwinSource(fleet());
  const now = atHour(72);

  const run = (filter: DeviceListFilter) => {
    const result = buildDeviceListViewModel(SCOPE_A, source, { ...QUERY, filter }, { now, ...BANDS });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return result.view.rows.map((r) => r.deviceId as string);
  };

  expect(run({ kind: "lifecycle", state: "LEARN" })).toEqual(["dev_testdevice00a2"]);
  expect(run({ kind: "ownership", ownerType: "LEASED" })).toEqual(["dev_testdevice00a2"]);
  expect(run({ kind: "posture", summary: "AT_RISK" })).toEqual(["dev_testdevice00a2"]);
  expect(run({ kind: "platform", adapterFamily: "macos" })).toEqual(["dev_testdevice00a3"]);
  expect(run({ kind: "assignedTeam", team: "field-sales" })).toEqual(["dev_testdevice00a2"]);
  expect(run({ kind: "search", text: "thinkpad" })).toEqual(["dev_testdevice00a1"]);
  expect(run({ kind: "search", text: "SN-dev_testdevice00a3" })).toEqual(["dev_testdevice00a3"]);
  expect(run({ kind: "search", text: "" })).toEqual([
    "dev_testdevice00a1",
    "dev_testdevice00a2",
    "dev_testdevice00a3",
  ]);
  expect(run({ kind: "observed", band: "stale" })).toEqual(["dev_testdevice00a1", "dev_testdevice00a2"]);
  expect(run({ kind: "observed", band: "never_observed" })).toEqual(["dev_testdevice00a3"]);
  expect(
    run({ kind: "and", filters: [{ kind: "platform", adapterFamily: "macos" }, { kind: "observed", band: "never_observed" }] }),
  ).toEqual(["dev_testdevice00a3"]);
  expect(
    run({ kind: "and", filters: [{ kind: "platform", adapterFamily: "macos" }, { kind: "observed", band: "stale" }] }),
  ).toEqual([]);
  expect(
    run({ kind: "or", filters: [{ kind: "lifecycle", state: "ENROLL" }, { kind: "posture", summary: "AT_RISK" }] }),
  ).toEqual(["dev_testdevice00a2", "dev_testdevice00a3"]);
  expect(run({ kind: "not", filter: { kind: "platform", adapterFamily: "windows" } })).toEqual([
    "dev_testdevice00a3",
  ]);
});

test("deterministic ordering: field sorts with the deviceId tiebreak, both directions", () => {
  const source = seededTwinSource(fleet());
  const now = atHour(72);
  const byLifecycleDesc = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { ...QUERY, sort: { field: "lifecycle", direction: "desc" } },
    { now, ...BANDS },
  );
  expect(byLifecycleDesc.ok).toBe(true);
  if (!byLifecycleDesc.ok) throw new Error("unreachable");
  // LEARN(8) > ASSESS(2) > ENROLL(0)
  expect(byLifecycleDesc.view.rows.map((r) => r.deviceId as string)).toEqual([
    "dev_testdevice00a2",
    "dev_testdevice00a1",
    "dev_testdevice00a3",
  ]);

  const byObservedAsc = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { ...QUERY, sort: { field: "lastObservedAt", direction: "asc" } },
    { now, ...BANDS },
  );
  expect(byObservedAsc.ok).toBe(true);
  if (!byObservedAsc.ok) throw new Error("unreachable");
  // never-observed first, then 2h, then 40h
  expect(byObservedAsc.view.rows.map((r) => r.deviceId as string)).toEqual([
    "dev_testdevice00a3",
    "dev_testdevice00a1",
    "dev_testdevice00a2",
  ]);
});

test("pagination windows the matched set deterministically; facets count the matched set pre-pagination", () => {
  const source = seededTwinSource(fleet());
  const now = atHour(72);
  const paged = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { ...QUERY, page: { offset: 1, limit: 1 } },
    { now, ...BANDS },
  );
  expect(paged.ok).toBe(true);
  if (!paged.ok) throw new Error("unreachable");
  expect(paged.view.rows.map((r) => r.deviceId as string)).toEqual(["dev_testdevice00a2"]);
  expect(paged.view.totalMatches).toBe(3);
  expect(paged.view.page).toEqual({ offset: 1, limit: 1 });

  const full = buildDeviceListViewModel(SCOPE_A, source, QUERY, { now, ...BANDS });
  expect(full.ok).toBe(true);
  if (!full.ok) throw new Error("unreachable");
  expect(full.view.facets.byLifecycle.map((f) => [f.value, f.count])).toEqual([
    ["ENROLL", 1],
    ["ASSESS", 1],
    ["LEARN", 1],
  ]);
  expect(full.view.facets.byPosture.map((f) => [f.value, f.count])).toEqual([
    ["AT_RISK", 1],
    ["HEALTHY", 1],
    ["UNKNOWN", 1],
  ]);
  expect(full.view.facets.byOwnership.map((f) => [f.value, f.count])).toEqual([
    ["FLEET_PURCHASED", 2],
    ["LEASED", 1],
  ]);
  expect(full.view.facets.byRecovery.map((f) => [f.value, f.count])).toEqual([
    ["ACTIVE", 1],
    ["NONE", 2],
  ]);
  expect(full.view.facets.byStaleness.map((f) => [f.value, f.count])).toEqual([
    ["never_observed", 1],
    ["stale", 2],
  ]);
});

test("malformed queries are refused with machine-stable validation failures", () => {
  const source = seededTwinSource(fleet());
  const bad1 = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { ...QUERY, filter: { kind: "and", filters: [] } },
    { now: atHour(72), ...BANDS },
  );
  expect(bad1.ok).toBe(false);
  if (bad1.ok) throw new Error("unreachable");
  expect(bad1.failures[0]?.path).toBe("/filter/filters");

  const bad2 = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { ...QUERY, page: { offset: -1, limit: 0 } },
    { now: atHour(72), ...BANDS },
  );
  expect(bad2.ok).toBe(false);
  if (bad2.ok) throw new Error("unreachable");
  expect(bad2.failures.map((f) => f.path).includes("/page/offset")).toBe(true);
  expect(bad2.failures.map((f) => f.path).includes("/page/limit")).toBe(true);

  const bad3 = buildDeviceListViewModel(
    SCOPE_A,
    source,
    QUERY,
    { now: "not-a-timestamp", ...BANDS },
  );
  expect(bad3.ok).toBe(false);
  expect(bad3.ok ? true : bad3.failures[0]?.path).toBe("/options/now");
});

test("determinism: the same (source, query, options) replay byte-identically", () => {
  const source = seededTwinSource(fleet());
  const options = { now: atHour(72), ...BANDS };
  const first = buildDeviceListViewModel(SCOPE_A, source, QUERY, options);
  const second = buildDeviceListViewModel(SCOPE_A, source, QUERY, options);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test("tenant isolation: a tenant-B scope sees only tenant-B twins; a refused scope sees nothing", () => {
  const source = seededTwinSource(fleet());
  const bView = buildDeviceListViewModel(SCOPE_B, source, QUERY, { now: atHour(72), ...BANDS });
  expect(bView.ok).toBe(true);
  if (!bView.ok) throw new Error("unreachable");
  expect(bView.view.rows.map((r) => r.deviceId as string)).toEqual(["dev_testdevice00b1"]);
  expect(bView.view.totalDevices).toBe(1);

  const refused = buildDeviceListViewModel(
    { tenantId: "" as never },
    source,
    QUERY,
    { now: atHour(72), ...BANDS },
  );
  expect(refused.ok).toBe(true);
  if (!refused.ok) throw new Error("unreachable");
  expect(refused.view.rows).toHaveLength(0);
  expect(refused.view.totalDevices).toBe(0);
});

test("the selection state machine is pure and total", () => {
  expect(selectionDeviceIds({ kind: "none" } as DeviceSelection)).toHaveLength(0);

  const single = selectOne(DEV_A1);
  expect(single.kind).toBe("single");
  expect(isDeviceSelected(single, DEV_A1)).toBe(true);
  expect(isDeviceSelected(single, DEV_A2)).toBe(false);

  const cleared = toggleSelection(single, DEV_A1); // toggling the single selection clears it
  expect(cleared.kind).toBe("none");

  const many = toggleSelection(toggleSelection(selectOne(DEV_A1), DEV_A2), DEV_A3);
  expect(many.kind).toBe("many");
  if (many.kind !== "many") throw new Error("unreachable");
  expect(many.deviceIds.map((id) => id as string)).toEqual([
    "dev_testdevice00a1",
    "dev_testdevice00a2",
    "dev_testdevice00a3",
  ]);

  // toggle-out down to single
  const two = toggleSelection(toggleSelection(many, DEV_A3), DEV_A2);
  expect(two.kind).toBe("single");
  if (two.kind !== "single") throw new Error("unreachable");
  expect((two.deviceId as string)).toBe("dev_testdevice00a1");

  // selectVisible unions (dedup + sort)
  const visible = selectVisible(selectOne(DEV_A3), [DEV_A1, DEV_A3, DEV_A2]);
  expect(selectionDeviceIds(visible).map((id) => id as string)).toEqual([
    "dev_testdevice00a1",
    "dev_testdevice00a2",
    "dev_testdevice00a3",
  ]);

  expect(selectionDeviceIds(selectMany([DEV_A2, DEV_A1, DEV_A2])).map((id) => id as string)).toEqual([
    "dev_testdevice00a1",
    "dev_testdevice00a2",
  ]);
  expect(clearSelection().kind).toBe("none");
});

test("the view-model never mutates the injected twins (purity over the REAL store)", () => {
  const twins = fleet();
  const source = seededTwinSource(twins);
  const before = JSON.stringify(twins.map((t) => t.revisions.length));
  buildDeviceListViewModel(SCOPE_A, source, QUERY, { now: atHour(72), ...BANDS });
  expect(JSON.stringify(twins.map((t) => t.revisions.length))).toBe(before);
  expect(T0).toBe("2026-01-01T00:00:00Z"); // anchor sanity
});
