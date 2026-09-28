/**
 * W060A web-device — D2 binding tests: the device detail header + the
 * READ-ONLY lifecycle state machine surface over the REAL
 * `@fleetos/device-model` TwinStore.
 *
 * The lifecycle machine surface must be a READ-ONLY projection of the
 * FROZEN `DEVICE_LIFECYCLE_TRANSITIONS` table (contracts-owned): the
 * exhaustive 9-state sweep proves the surfaced order/next/terminal/
 * position/loop-closure match the frozen table exactly, and the detail
 * header tests prove the projection consumes the REAL twin sections
 * with no existence side channel across tenants.
 */

import { test, expect } from "bun:test";
import { asWorkloadId } from "@fleetos/contracts";
import {
  DEVICE_LIFECYCLE_ORDER,
  DEVICE_LIFECYCLE_TRANSITIONS,
  buildDeviceDetailHeader,
  lifecycleMachineView,
} from "../src/index";
import {
  BANDS,
  DEV_A1,
  DEV_B1,
  SCOPE_A,
  SCOPE_B,
  TENANT_A,
  atHour,
  obs,
  seededTwinSource,
  twinFixture,
} from "./helpers";

test("the lifecycle machine surface mirrors the FROZEN table exhaustively (all 9 states)", () => {
  for (const state of DEVICE_LIFECYCLE_ORDER) {
    const view = lifecycleMachineView(state);
    expect(view.current).toBe(state);
    expect(view.order).toBe(DEVICE_LIFECYCLE_ORDER); // verbatim, read-only
    expect([...view.nextLegal]).toEqual([...(DEVICE_LIFECYCLE_TRANSITIONS[state] ?? [])]);
    expect(view.isTerminal).toBe(state === "LEARN");
    expect(view.position).toBe(DEVICE_LIFECYCLE_ORDER.indexOf(state));
    expect(view.loopClosure).toBe(state === "LEARN" ? "observation_cycle" : "none");
  }
});

test("the frozen linear lifecycle: each non-terminal state surfaces exactly its successor", () => {
  const pairs: [string, string | undefined][] = [
    ["ENROLL", "OBSERVE"],
    ["OBSERVE", "ASSESS"],
    ["ASSESS", "DIAGNOSE"],
    ["DIAGNOSE", "PLAN"],
    ["PLAN", "AUTHORIZE"],
    ["AUTHORIZE", "EXECUTE"],
    ["EXECUTE", "VERIFY"],
    ["VERIFY", "LEARN"],
    ["LEARN", undefined],
  ];
  for (const [state, next] of pairs) {
    const view = lifecycleMachineView(state as (typeof DEVICE_LIFECYCLE_ORDER)[number]);
    if (next === undefined) {
      expect(view.nextLegal).toHaveLength(0);
      expect(view.isTerminal).toBe(true);
      expect(view.loopClosure).toBe("observation_cycle");
    } else {
      expect([...view.nextLegal]).toEqual([next]);
      expect(view.isTerminal).toBe(false);
      expect(view.loopClosure).toBe("none");
    }
  }
});

test("the detail header projects the REAL twin sections read-only", () => {
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 3, // DIAGNOSE
    observations: [obs("device.power", { batteryPercent: 40 }, atHour(2))],
    postureSummary: "HEALTHY",
    findingCount: 1,
    assignedWorkloadIds: [asWorkloadId("wrk_testworkload1")],
  });
  const source = seededTwinSource([twin]);

  const header = buildDeviceDetailHeader(SCOPE_A, source, DEV_A1, { now: atHour(3), ...BANDS });
  expect(header).toBeDefined();
  if (header === undefined) throw new Error("unreachable");
  expect(header.tenantId).toBe(TENANT_A);
  expect((header.deviceId as string)).toBe("dev_testdevice00a1");
  expect(header.displayName).toBe("Lenovo ThinkPad X1");
  expect(header.adapterFamily).toBe("windows");
  expect(header.ownership.ownerType).toBe("FLEET_PURCHASED");
  expect(header.lifecycle.current).toBe("DIAGNOSE");
  expect([...header.lifecycle.nextLegal]).toEqual(["PLAN"]);
  expect(header.lifecycle.isTerminal).toBe(false);
  expect(header.telemetry.lastObservedAt).toBe(atHour(2));
  expect(header.telemetry.observationCount).toBe(1);
  expect(header.telemetry.staleness).toBe("fresh");
  expect(header.posture.summary).toBe("HEALTHY");
  expect(header.posture.findingCount).toBe(1);
  expect(header.workload.assignedWorkloadIds).toEqual(["wrk_testworkload1"]);
  expect(header.provenance.revisionCount).toBe(twin.revisions.length);
  expect(header.provenance.entries[0]?.mutation).toBe("twin.created");
  // The provenance timeline is read-only and append-ordered
  expect(header.provenance.entries.map((e) => e.revision)).toEqual(
    twin.revisions.map((r) => r.revision),
  );
});

test("a terminal LEARN twin surfaces the read-only loop-closure note", () => {
  const twin = twinFixture({ tenantId: TENANT_A, deviceId: DEV_A1, lifecycleHops: 8 });
  const source = seededTwinSource([twin]);
  const header = buildDeviceDetailHeader(SCOPE_A, source, DEV_A1, { now: atHour(3), ...BANDS });
  expect(header).toBeDefined();
  if (header === undefined) throw new Error("unreachable");
  expect(header.lifecycle.current).toBe("LEARN");
  expect(header.lifecycle.nextLegal).toHaveLength(0);
  expect(header.lifecycle.isTerminal).toBe(true);
  expect(header.lifecycle.loopClosure).toBe("observation_cycle");
});

test("no existence side channel: foreign and unknown devices are both undefined", () => {
  const twin = twinFixture({ tenantId: TENANT_A, deviceId: DEV_A1 });
  const source = seededTwinSource([twin]);
  // foreign-tenant device (exists in tenant B) — indistinguishable from unknown
  const foreign = buildDeviceDetailHeader(SCOPE_A, source, DEV_B1, { now: atHour(3), ...BANDS });
  expect(foreign).toBeUndefined();
  // the SAME device id under the WRONG acting scope — undefined
  const wrongScope = buildDeviceDetailHeader(SCOPE_B, source, DEV_A1, { now: atHour(3), ...BANDS });
  expect(wrongScope).toBeUndefined();
  // unknown device — undefined
  const unknown = buildDeviceDetailHeader(
    SCOPE_A,
    source,
    "dev_doesnotexist" as typeof DEV_A1,
    { now: atHour(3), ...BANDS },
  );
  expect(unknown).toBeUndefined();
});

test("determinism: the same (source, device, options) replay byte-identically", () => {
  const twin = twinFixture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    lifecycleHops: 2,
    observations: [obs("device.power", { batteryPercent: 40 }, atHour(2))],
    postureSummary: "AT_RISK",
  });
  const source = seededTwinSource([twin]);
  const options = { now: atHour(3), ...BANDS };
  const first = buildDeviceDetailHeader(SCOPE_A, source, DEV_A1, options);
  const second = buildDeviceDetailHeader(SCOPE_A, source, DEV_A1, options);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
