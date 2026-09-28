/**
 * W060A web-recovery — D1 binding tests: the Find My Device view over
 * the REAL `@fleetos/recovery` last-seen ledger + the REAL
 * `findMyDevice` derivation.
 *
 * The REAL `findMyDevice()` output flows where the surface's
 * `FindMyViewLike` seam is expected — TypeScript structural typing is
 * the compile-time proof; these tests are the runtime proof that:
 *
 *   - the last-seen evidence ledger is surfaced READ-ONLY (append-only
 *     revision history, version order);
 *   - absent location evidence is the machine-stable
 *     `no_location_evidence` — surfaced verbatim, never a guess;
 *   - the located view carries the opaque evidence ref + staleness,
 *     NEVER the location payload bytes;
 *   - staleness is re-derived against the VIEW's injected instant;
 *   - a foreign-tenant device is indistinguishable from an unknown
 *     one (no evidence, no location — no existence side channel);
 *   - the view replays byte-identically (determinism).
 */

import { test, expect } from "bun:test";
import { buildFindMyDeviceViewModel, locationBearingEntries, LOCATED, NO_LOCATION_EVIDENCE } from "../src/index";
import {
  DEV_A1,
  DEV_A2,
  DEV_B1,
  SCOPE_A,
  SCOPE_B,
  THRESHOLDS,
  atHour,
  batch,
  locationObservation,
  obs,
  realFindMySource,
  seededLastSeenLedger,
} from "./helpers";

test("the REAL ledger + REAL findMyDevice surface a located view with the opaque evidence ref", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [
        batch(
          DEV_A1,
          [
            locationObservation(atHour(2), 47.3769, 8.5417),
            obs("device.power", { batteryPercent: 55 }, atHour(2)),
          ],
          atHour(2),
        ),
      ],
      at: atHour(2),
    },
  ]);
  const source = realFindMySource(ledger);

  const view = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(view.locationKnown).toBe(true);
  expect(view.location.status).toBe(LOCATED);
  if (view.location.status !== "located") throw new Error("unreachable");
  expect(view.location.observationKind).toBe("device.location");
  expect(view.location.observedAt).toBe(atHour(2));
  expect(view.location.staleness).toBe("fresh"); // re-derived at the view's instant
  expect(view.location.observationId.startsWith("obs_")).toBe(true);
  // the view-model carries NO location payload bytes (opaque by omission)
  expect(Object.keys(view.location).includes("payload")).toBe(false);
  expect(Object.keys(view.location).includes("latitude")).toBe(false);

  expect(view.lastSeen).toBeDefined();
  expect(view.lastSeen?.observedAt).toBe(atHour(2));
  expect(view.lastSeen?.staleness).toBe("fresh");
  expect(view.lastSeen?.evidenceCount).toBe(2); // the location obs + the power obs

  // the ledger is surfaced read-only, version order
  expect(view.ledger).toHaveLength(1);
  expect(view.ledger[0]?.version).toBe(1);
  expect(view.ledger[0]?.locationBorne).toBe(true);
  expect(locationBearingEntries(view)).toHaveLength(1);
});

test("absent location evidence is the machine-stable no_location_evidence — never a guess", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [obs("device.power", { batteryPercent: 55 }, atHour(2))], atHour(2))],
      at: atHour(2),
    },
  ]);
  const source = realFindMySource(ledger);
  const view = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(view.locationKnown).toBe(false);
  expect(view.location.status).toBe(NO_LOCATION_EVIDENCE);
  expect(Object.keys(view.location)).toEqual(["status"]);
  // last-seen summary still present (non-location evidence exists)
  expect(view.lastSeen?.observedAt).toBe(atHour(2));
});

test("no evidence at all: absent last-seen + no_location_evidence (the empty view is still a view)", () => {
  const ledger = seededLastSeenLedger([]);
  const source = realFindMySource(ledger);
  const view = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A2, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(view.lastSeen).toBeUndefined();
  expect(view.location.status).toBe(NO_LOCATION_EVIDENCE);
  expect(view.ledger).toHaveLength(0);
});

test("the evidence ledger is append-only: later recordings append, prior revisions never rewritten", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [obs("device.power", { batteryPercent: 60 }, atHour(1))], atHour(1))],
      at: atHour(1),
    },
    {
      deviceId: DEV_A1,
      batches: [
        batch(
          DEV_A1,
          [locationObservation(atHour(5), 46.2, 6.1), obs("device.power", { batteryPercent: 40 }, atHour(5))],
          atHour(5),
        ),
      ],
      at: atHour(5),
    },
  ]);
  const source = realFindMySource(ledger);
  const view = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, {
    at: atHour(6),
    ...THRESHOLDS,
  });
  expect(view.ledger).toHaveLength(2);
  expect(view.ledger.map((entry) => entry.version)).toEqual([1, 2]);
  expect(view.ledger[0]?.locationBorne).toBe(false);
  expect(view.ledger[1]?.locationBorne).toBe(true);
  // the CURRENT view resolves to the strongest evidence (v2, located)
  expect(view.lastSeen?.recordId).toBe(view.ledger[1]?.recordId);
  expect(view.location.status).toBe(LOCATED);
});

test("staleness re-derives against the VIEW's injected instant (never a frozen classification)", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(2), 47.3769, 8.5417)], atHour(2))],
      at: atHour(2),
    },
  ]);
  const source = realFindMySource(ledger);

  const fresh = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, { at: atHour(3), ...THRESHOLDS });
  expect(fresh.location.status).toBe(LOCATED);
  if (fresh.location.status !== "located") throw new Error("unreachable");
  expect(fresh.location.staleness).toBe("fresh");

  const stale = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, { at: atHour(100), ...THRESHOLDS });
  expect(stale.location.status).toBe(LOCATED); // still located — the evidence is immutable
  if (stale.location.status !== "located") throw new Error("unreachable");
  expect(stale.location.staleness).toBe("stale"); // but its freshness re-derived
  expect(stale.lastSeen?.staleness).toBe("stale");
});

test("tenant isolation: a foreign device is indistinguishable from an unknown one", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(2), 47.3769, 8.5417)], atHour(2))],
      at: atHour(2),
    },
  ]);
  const source = realFindMySource(ledger);

  // acting tenant-B asking for tenant-A's device: no evidence, no location
  const foreign = buildFindMyDeviceViewModel(SCOPE_B, source, DEV_A1, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(foreign.lastSeen).toBeUndefined();
  expect(foreign.location.status).toBe(NO_LOCATION_EVIDENCE);
  expect(foreign.ledger).toHaveLength(0);
  expect(foreign.locationKnown).toBe(false);

  // an unknown device under the right scope: the DATA is identical (the
  // views differ only in their acting-tenant stamp + requested device id)
  const unknown = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_B1, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(unknown.lastSeen).toBeUndefined();
  expect(unknown.location.status).toBe(NO_LOCATION_EVIDENCE);
  const strip = (v: typeof unknown): string =>
    JSON.stringify({ lastSeen: v.lastSeen, location: v.location, ledger: v.ledger, locationKnown: v.locationKnown });
  expect(strip(unknown)).toBe(strip(foreign));
});

test("a refused scope yields the deterministic empty view (no data, no leak)", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(2), 47.3769, 8.5417)], atHour(2))],
      at: atHour(2),
    },
  ]);
  const source = realFindMySource(ledger);
  const refused = buildFindMyDeviceViewModel({ tenantId: "" as never }, source, DEV_A1, {
    at: atHour(3),
    ...THRESHOLDS,
  });
  expect(refused.tenantId).toBe("tnt_system0000000");
  expect(refused.lastSeen).toBeUndefined();
  expect(refused.location.status).toBe(NO_LOCATION_EVIDENCE);
  expect(refused.ledger).toHaveLength(0);
});

test("determinism: the same (source, device, options) replay byte-identically", () => {
  const ledger = seededLastSeenLedger([
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [locationObservation(atHour(2), 47.3769, 8.5417)], atHour(2))],
      at: atHour(2),
    },
    {
      deviceId: DEV_A1,
      batches: [batch(DEV_A1, [obs("device.power", { batteryPercent: 40 }, atHour(5))], atHour(5))],
      at: atHour(5),
    },
  ]);
  const source = realFindMySource(ledger);
  const options = { at: atHour(6), ...THRESHOLDS };
  const first = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, options);
  const second = buildFindMyDeviceViewModel(SCOPE_A, source, DEV_A1, options);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
