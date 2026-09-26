/**
 * W011 D2 tests — the Device Twin aggregate: composable tenant-scoped
 * sections, TwinRevision provenance on every mutation, append-only
 * history (never in-place rewrites), and immutability of prior states.
 */

import { test, expect } from "bun:test";
import { LEARN } from "@fleetos/contracts";
import { makeAdapterCapabilities } from "@fleetos/contracts/testing";
import {
  makeCorrelationId,
  makeDeviceId,
  makeObservationId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import type { Observation } from "@fleetos/contracts";
import {
  OWNERSHIP_TYPE_CUSTOMER_OWNED,
  OWNERSHIP_TYPE_LEASED,
  enrollDevice,
} from "../src/identity";
import {
  MAX_LATEST_OBSERVATIONS,
  assignTwinOwnership,
  createTwin,
  recordTwinObservations,
  reenterTwinObservationCycle,
  revisionAt,
  transitionTwinLifecycle,
  updateTwinSection,
} from "../src/twin";
import type { DeviceTwin, TwinWorkloadSection } from "../src/twin";

const tenantId = makeTenantId("twin-tests");
const deviceId = makeDeviceId("twin-tests-device");
const correlationId = makeCorrelationId("twin-tests-cor");

function makeTwin(): DeviceTwin {
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "macos",
    hardware: { manufacturer: "Apple", model: "MacBook Pro 14" },
    ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
    at: "2026-02-01T10:00:00Z",
    provenance: { correlationId },
  });
  if (!enrolled.ok) throw new Error("fixture enrollment failed");
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: "2026-02-01T10:00:01Z", correlationId },
  });
  if (!created.ok) throw new Error("fixture twin creation failed");
  return created.twin;
}

function makeObservation(i: number): Observation {
  return {
    id: makeObservationId(`twin-obs-${i}`),
    kind: "device.health",
    observedAt: `2026-02-02T10:0${i}:00Z`,
    schemaVersion: 1,
    payload: { idx: i },
  };
}

function snapshot(twin: DeviceTwin): string {
  return JSON.stringify(twin);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

test("createTwin: all ten joined sections are materialized and tenant-scoped", () => {
  const twin = makeTwin();
  const sections = [
    twin.identity,
    twin.capabilities,
    twin.telemetry,
    twin.securityPosture,
    twin.software,
    twin.workload,
    twin.connectivity,
    twin.maintenance,
    twin.policy,
    twin.actions,
  ];
  expect(sections.length).toBe(10);
  for (const section of sections) {
    expect(section.tenantId).toBe(tenantId);
    expect(section.deviceId).toBe(deviceId);
  }
  expect(twin.tenantId).toBe(tenantId);
  expect(twin.deviceId).toBe(deviceId);
  expect(twin.identity.lifecycleState).toBe("ENROLL");
  expect(twin.identity.enrollment.hardware.model).toBe("MacBook Pro 14");
  expect(twin.identity.ownership.ownerType).toBe(OWNERSHIP_TYPE_CUSTOMER_OWNED);
  expect(twin.capabilities.adapterFamily).toBe("macos");
  expect(twin.telemetry.observationCount).toBe(0);
  expect(twin.telemetry.lastObservedAt).toBeNull();
  expect(twin.securityPosture.postureSummary).toBe("UNKNOWN");
  expect(twin.software.installedCount).toBe(0);
  expect(twin.workload.assignedWorkloadIds).toEqual([]);
  expect(twin.connectivity.capabilities).toEqual([]);
  expect(twin.maintenance.history).toEqual([]);
  expect(twin.maintenance.predictions).toEqual([]);
  expect(twin.policy.policyIds).toEqual([]);
  expect(twin.actions.activeActionIds).toEqual([]);
  expect(twin.actions.recoveryState).toBe("NONE");
});

test("createTwin: revision 1 is the twin.created entry with full provenance", () => {
  const twin = makeTwin();
  expect(twin.revision).toBe(1);
  expect(twin.revisions).toHaveLength(1);
  const first = twin.revisions[0];
  expect(first.revision).toBe(1);
  expect(first.section).toBe("identity");
  expect(first.mutation).toBe("twin.created");
  expect(first.correlationId).toBe(correlationId);
  expect(first.at).toBe("2026-02-01T10:00:01Z");
  expect(first.actor).toEqual({ kind: "system" });
  expect(first.evidence).toEqual([]);
});

test("createTwin: initial capabilities and policy scope are carried in", () => {
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "windows",
    hardware: { manufacturer: "Dell", model: "Latitude 7440" },
    ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
    at: "2026-02-01T10:00:00Z",
    provenance: { correlationId },
  });
  if (!enrolled.ok) throw new Error("fixture enrollment failed");
  const caps = makeAdapterCapabilities({ supported: ["observe", "health"], unsupported: ["wipe"] });
  const created = createTwin({
    identity: enrolled.identity,
    adapterCapabilities: caps,
    hardwareCapabilities: { cpu: "i7", ramBytes: 32_000_000_000, ports: ["usb-c"] },
    connectivityCapabilities: ["ethernet", "wifi"],
    policyIds: ["pol_laneB_0001" as never],
    ctx: { at: "2026-02-01T10:00:01Z", correlationId },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.twin.capabilities.adapterCapabilities).toEqual(caps);
  expect(created.twin.capabilities.hardware.cpu).toBe("i7");
  expect(created.twin.capabilities.hardware.ports).toEqual(["usb-c"]);
  expect(created.twin.connectivity.capabilities).toEqual(["ethernet", "wifi"]);
  expect(created.twin.policy.policyIds).toEqual(["pol_laneB_0001"]);
});

test("createTwin: invalid mutation context is rejected", () => {
  const enrolled = enrollDevice({
    tenantId,
    deviceId,
    adapterFamily: "linux",
    hardware: { manufacturer: "System76", model: "Lemur Pro" },
    ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
    at: "2026-02-01T10:00:00Z",
    provenance: { correlationId },
  });
  if (!enrolled.ok) throw new Error("fixture enrollment failed");
  const bad = createTwin({
    identity: enrolled.identity,
    ctx: { at: "not-iso", correlationId },
  });
  expect(bad.ok).toBe(false);
  if (!bad.ok) {
    expect(bad.error.kind).toBe("ValidationError");
    expect(bad.error.code).toBe("device.twin.invalid");
  }
  const noCorrelation = createTwin({
    identity: enrolled.identity,
    ctx: { at: "2026-02-01T10:00:01Z", correlationId: "" as never },
  });
  expect(noCorrelation.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Lifecycle transitions on the twin
// ---------------------------------------------------------------------------

test("transitionTwinLifecycle: legal step appends a revision and advances the state", () => {
  const twin = makeTwin();
  const result = transitionTwinLifecycle(twin, "OBSERVE", {
    at: "2026-02-01T11:00:00Z",
    correlationId,
    reason: "first observation cycle",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.twin.identity.lifecycleState).toBe("OBSERVE");
  expect(result.twin.revision).toBe(2);
  expect(result.revision.mutation).toBe("lifecycle.transition");
  expect(result.revision.section).toBe("identity");
  expect(result.revision.correlationId).toBe(correlationId);
  expect(result.revision.reason).toBe("first observation cycle");
  // The original twin is untouched.
  expect(twin.identity.lifecycleState).toBe("ENROLL");
  expect(twin.revision).toBe(1);
  expect(snapshot(twin)).toBe(snapshot(makeTwin()));
});

test("transitionTwinLifecycle: the full walk ENROLL -> ... -> LEARN appends 8 revisions, strictly monotonic", () => {
  let twin = makeTwin();
  const walk = ["OBSERVE", "ASSESS", "DIAGNOSE", "PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "LEARN"] as const;
  let step = 0;
  for (const to of walk) {
    const result = transitionTwinLifecycle(twin, to, {
      at: `2026-02-01T12:0${step}:00Z`,
      correlationId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    twin = result.twin;
    step++;
  }
  expect(twin.identity.lifecycleState).toBe(LEARN);
  expect(twin.revision).toBe(9);
  expect(twin.revisions).toHaveLength(9);
  // Revision numbers are exactly 1..9 with no gaps or duplicates.
  for (let i = 0; i < 9; i++) {
    expect(twin.revisions[i].revision).toBe(i + 1);
  }
  expect(revisionAt(twin, 1)?.mutation).toBe("twin.created");
  expect(revisionAt(twin, 9)?.mutation).toBe("lifecycle.transition");
  expect(revisionAt(twin, 42)).toBeUndefined();
});

test("transitionTwinLifecycle: illegal skip is rejected and the twin is unchanged", () => {
  const twin = makeTwin();
  const before = snapshot(twin);
  const result = transitionTwinLifecycle(twin, "EXECUTE", {
    at: "2026-02-01T11:00:00Z",
    correlationId,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind === "DomainError") {
      expect(result.error.code).toBe("device.lifecycle.illegal_transition");
      expect(result.error.invariant).toBe("transition:ENROLL->EXECUTE");
    }
  }
  expect(snapshot(twin)).toBe(before);
});

test("transitionTwinLifecycle: a no-op transition to the current state is illegal per the frozen table", () => {
  const twin = makeTwin();
  const result = transitionTwinLifecycle(twin, "ENROLL", {
    at: "2026-02-01T11:00:00Z",
    correlationId,
  });
  expect(result.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Ownership on the twin
// ---------------------------------------------------------------------------

test("assignTwinOwnership: updates the identity section and appends a revision", () => {
  const twin = makeTwin();
  const result = assignTwinOwnership(
    twin,
    { ownerType: OWNERSHIP_TYPE_LEASED, assignedTeam: "eng-ops" },
    { at: "2026-02-03T09:00:00Z", correlationId, reason: "lease transfer" },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.twin.identity.ownership.ownerType).toBe(OWNERSHIP_TYPE_LEASED);
  expect(result.twin.identity.ownership.assignedTeam).toBe("eng-ops");
  expect(result.twin.identity.ownership.assignedAt).toBe("2026-02-03T09:00:00Z");
  expect(result.twin.identity.ownership.provenance.reason).toBe("lease transfer");
  expect(result.revision.mutation).toBe("ownership.assigned");
  expect(result.twin.revision).toBe(2);
  // Original untouched.
  expect(twin.identity.ownership.ownerType).toBe(OWNERSHIP_TYPE_CUSTOMER_OWNED);
});

// ---------------------------------------------------------------------------
// Recording observations (telemetry)
// ---------------------------------------------------------------------------

test("recordTwinObservations: telemetry counters, lastObservedAt, and the bounded window", () => {
  const twin = makeTwin();
  const observations = [makeObservation(3), makeObservation(1), makeObservation(2)];
  const result = recordTwinObservations(twin, observations, {
    at: "2026-02-02T11:00:00Z",
    correlationId,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.twin.telemetry.observationCount).toBe(3);
  expect(result.twin.telemetry.lastObservedAt).toBe("2026-02-02T10:03:00Z");
  expect(result.twin.telemetry.latest).toHaveLength(3);
  expect(result.revision.mutation).toBe("observations.recorded");
  expect(result.revision.section).toBe("telemetry");
  expect(result.twin.revision).toBe(2);
});

test("recordTwinObservations: the latest window is bounded (telemetry minimization)", () => {
  let twin = makeTwin();
  for (let batch = 0; batch < 3; batch++) {
    const observations = Array.from({ length: 5 }, (_, i) => makeObservation(batch * 5 + i));
    const result = recordTwinObservations(twin, observations, {
      at: `2026-02-02T12:0${batch}:00Z`,
      correlationId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    twin = result.twin;
  }
  expect(twin.telemetry.observationCount).toBe(15);
  expect(twin.telemetry.latest).toHaveLength(MAX_LATEST_OBSERVATIONS);
  // The window holds the LAST 10 by insertion order.
  expect(twin.telemetry.latest[0]).toEqual(makeObservation(5));
  expect(twin.telemetry.latest[9]).toEqual(makeObservation(14));
});

test("recordTwinObservations: malformed observations are rejected without touching the twin", () => {
  const twin = makeTwin();
  const before = snapshot(twin);
  const bad = [
    { id: makeObservationId("x"), kind: "device.health", observedAt: "2026-02-02T10:00:00Z", schemaVersion: 0, payload: {} },
  ] as never;
  const result = recordTwinObservations(twin, bad, { at: "2026-02-02T11:00:00Z", correlationId });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("ValidationError");
    expect(result.error.code).toBe("device.observations.malformed");
  }
  expect(recordTwinObservations(twin, [], { at: "2026-02-02T11:00:00Z", correlationId }).ok).toBe(false);
  expect(snapshot(twin)).toBe(before);
});

// ---------------------------------------------------------------------------
// Observation-cycle re-entry
// ---------------------------------------------------------------------------

test("reenterTwinObservationCycle: LEARN -> OBSERVE with a revision", () => {
  let twin = makeTwin();
  const walk = ["OBSERVE", "ASSESS", "DIAGNOSE", "PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "LEARN"] as const;
  for (const to of walk) {
    const result = transitionTwinLifecycle(twin, to, { at: "2026-02-01T13:00:00Z", correlationId });
    if (!result.ok) throw new Error("walk failed");
    twin = result.twin;
  }
  expect(twin.identity.lifecycleState).toBe(LEARN);
  const reentry = reenterTwinObservationCycle(twin, {
    at: "2026-02-05T08:00:00Z",
    correlationId,
    reason: "next observation cycle",
  });
  expect(reentry.ok).toBe(true);
  if (!reentry.ok) return;
  expect(reentry.twin.identity.lifecycleState).toBe("OBSERVE");
  expect(reentry.revision.mutation).toBe("lifecycle.observation-cycle-reentry");
  expect(reentry.twin.revision).toBe(twin.revision + 1);
  // The revision log keeps the full history — the LEARN entry is still there.
  expect(reentry.twin.revisions).toHaveLength(twin.revisions.length + 1);
});

test("reenterTwinObservationCycle: rejected when the twin is not in LEARN", () => {
  const twin = makeTwin();
  const result = reenterTwinObservationCycle(twin, { at: "2026-02-05T08:00:00Z", correlationId });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("DomainError");
    expect(result.error.code).toBe("device.lifecycle.not_in_learn");
  }
});

// ---------------------------------------------------------------------------
// Generic section seam + immutability guarantees
// ---------------------------------------------------------------------------

test("updateTwinSection: later waves can update sections with tenant/device guards", () => {
  const twin = makeTwin();
  const nextWorkload: TwinWorkloadSection = {
    tenantId,
    deviceId,
    assignedWorkloadIds: ["wrk_00000001" as never, "wrk_00000002" as never],
  };
  const result = updateTwinSection(twin, "workload", nextWorkload, {
    at: "2026-02-06T09:00:00Z",
    correlationId,
    mutation: "workload.assigned",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.twin.workload.assignedWorkloadIds).toEqual(["wrk_00000001", "wrk_00000002"]);
  expect(result.revision.section).toBe("workload");
  expect(result.revision.mutation).toBe("workload.assigned");
});

test("updateTwinSection: cross-tenant and cross-device sections are rejected", () => {
  const twin = makeTwin();
  const wrongTenant: TwinWorkloadSection = {
    tenantId: makeTenantId("other-tenant"),
    deviceId,
    assignedWorkloadIds: [],
  };
  expect(
    updateTwinSection(twin, "workload", wrongTenant, {
      at: "2026-02-06T09:00:00Z",
      correlationId,
      mutation: "workload.assigned",
    }).ok,
  ).toBe(false);

  const wrongDevice: TwinWorkloadSection = {
    tenantId,
    deviceId: makeDeviceId("other-device"),
    assignedWorkloadIds: [],
  };
  const rejected = updateTwinSection(twin, "workload", wrongDevice, {
    at: "2026-02-06T09:00:00Z",
    correlationId,
    mutation: "workload.assigned",
  });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) {
    expect(rejected.error.kind).toBe("ValidationError");
    expect(rejected.error.code).toBe("device.twin.invalid");
  }
});

test("mutations never rewrite history: earlier snapshots stay byte-identical, the aggregate is frozen", () => {
  const twin = makeTwin();
  const snap1 = snapshot(twin);

  const observed = recordTwinObservations(twin, [makeObservation(0)], {
    at: "2026-02-07T09:00:00Z",
    correlationId,
  });
  if (!observed.ok) throw new Error("record failed");
  const snap2 = snapshot(observed.twin);

  const ownership = assignTwinOwnership(
    observed.twin,
    { ownerType: OWNERSHIP_TYPE_LEASED },
    { at: "2026-02-07T10:00:00Z", correlationId },
  );
  if (!ownership.ok) throw new Error("assign failed");
  const snap3 = snapshot(ownership.twin);

  // Each prior state is fully preserved (no in-place rewrites).
  expect(snapshot(twin)).toBe(snap1);
  expect(snapshot(observed.twin)).toBe(snap2);
  expect(snapshot(ownership.twin)).toBe(snap3);

  // Revision numbers only ever append, strictly +1 per mutation.
  expect(ownership.twin.revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
  expect(ownership.twin.revision).toBe(3);

  // The aggregates themselves are frozen (mutation throws in strict mode).
  const mutable = ownership.twin as unknown as { revision: number };
  expect(() => {
    mutable.revision = 999;
  }).toThrow();
  const mutableLog = ownership.twin.revisions as unknown as TwinRevisionMutable[];
  expect(() => {
    mutableLog.push(mutableLog[0]);
  }).toThrow();
});

interface TwinRevisionMutable {
  revision: number;
  [key: string]: unknown;
}

test("correlation/causation ids thread through revisions", () => {
  const twin = makeTwin();
  const caused = transitionTwinLifecycle(twin, "OBSERVE", {
    at: "2026-02-08T09:00:00Z",
    correlationId,
    causationId: "cau_threading_001" as never,
  });
  expect(caused.ok).toBe(true);
  if (!caused.ok) return;
  expect(caused.revision.correlationId).toBe(correlationId);
  expect(caused.revision.causationId).toBe("cau_threading_001");
  expect(makeTimestamp("determinism-anchor")).toBe(makeTimestamp("determinism-anchor"));
});
