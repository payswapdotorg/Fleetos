/**
 * W145 web-device — the DECLARED-IMPORT + MOBILE ROSTER composition
 * tests, over the REAL `@fleetos/device-model` twin store.
 *
 * These are the machine proofs of the work order's two contracts:
 *
 *   1. THE PROVENANCE SEPARATION: a declared record executed through the
 *      binding site's EXACT domain path (enrollDevice + createTwin +
 *      TwinStore.put, with the command view's provenance recorded
 *      verbatim) flows into the SAME runtime state contract surfaces —
 *      roster rows, facets, searches — carrying the DECLARED mark, while
 *      agent-path records derive OBSERVED. A declared record is NEVER
 *      presented as observed, and the detector
 *      (`verifyDeclaredImport` -> `present_not_declared`) catches a
 *      binding site that drops the mark.
 *
 *   2. THE MOBILE CARD CONTRACT: the priority-card list is a pure
 *      projection of the SAME roster view-model (same REAL runtime
 *      state as the table), severity-first ordered, provenance intact.
 *
 * And the SMALL-firm cold start: a fresh workspace with ZERO agent
 * rollout begins tracking by declaring records — honest Never-observed
 * telemetry, no fabricated observations (the real-observations-only
 * doctrine respected by the marking).
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asUserId } from "@fleetos/contracts";
import {
  DECLARED_ADAPTER_FAMILY,
  DECLARED_IMPORT_PROVENANCE_REASON,
  buildMobileDeviceCards,
  buildDeviceListViewModel,
  declaredImportCommand,
  deviceAttentionBand,
  deviceAttentionRank,
  initialDeclaredImportJourney,
  updateDeclaredDeviceDraft,
  verifyDeclaredImport,
} from "../src/index";
import type {
  DeviceListFilter,
  DeviceListSort,
  DeviceTwinSource,
  MobileDeviceCard,
} from "../src/index";
import { createInMemoryTwinStore, createTwin, enrollDevice, recordTwinObservations } from "@fleetos/device-model";
import type { DeviceTwin, TwinStore } from "@fleetos/device-model";
import {
  BANDS,
  DEV_A1,
  DEV_A2,
  DEV_A3,
  SCOPE_A,
  TENANT_A,
  atHour,
  obs,
  twinFixture,
} from "./helpers";

const NOW = atHour(72);
const CORR = asCorrelationId("cor_w145composit1");
const USER = asUserId("usr_testuser00001");

// ---------------------------------------------------------------------------
// The binding-site executor (the W144/TL composition's exact domain path)
// ---------------------------------------------------------------------------

/**
 * Execute a declared-import command the way the console runtime will:
 * the REAL `enrollDevice` boundary with the command's provenance
 * VERBATIM, `createTwin`, and a `TwinStore.put`. Returns the REAL twin.
 * This helper is the machine statement that the lane's command contract
 * executes against the real domain without any adapter.
 */
function executeDeclaredImport(
  store: TwinStore,
  command: NonNullable<ReturnType<typeof declaredImportCommand>>,
): DeviceTwin {
  const enrolled = enrollDevice({
    tenantId: command.tenantId,
    deviceId: command.deviceId,
    adapterFamily: command.adapterFamily,
    hardware: command.hardware,
    ownership: {
      ownerType: command.ownership.ownerType as "FLEET_PURCHASED",
      assignedTeam: command.ownership.assignedTeam,
    },
    at: command.declaredAt,
    provenance: {
      correlationId: command.enrollmentProvenance.correlationId,
      actor:
        command.enrollmentProvenance.actor.kind === "user"
          ? { kind: "user", userId: command.enrollmentProvenance.actor.userId }
          : { kind: "system" },
      reason: command.enrollmentProvenance.reason,
    },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: command.declaredAt, correlationId: command.enrollmentProvenance.correlationId },
  });
  if (!created.ok) throw new Error(created.error.message);
  store.put(created.twin);
  return created.twin;
}

/** Declare one record for tenant A through the full journey + command path. */
function declareOne(
  store: TwinStore,
  deviceId: string,
  hardware: { manufacturer: string; model: string; serialNumber?: string; assetTag?: string },
  team?: string,
): DeviceTwin {
  let journey = initialDeclaredImportJourney(TENANT_A);
  journey = updateDeclaredDeviceDraft(journey, {
    deviceId,
    hardware,
    ownership: { ownerType: "FLEET_PURCHASED", assignedTeam: team },
    provenanceAcknowledged: true,
  });
  const command = declaredImportCommand(SCOPE_A, store, journey, {
    now: atHour(50),
    correlationId: CORR,
    declaredBy: USER,
  });
  if (command === undefined) throw new Error(`command must be derivable for ${deviceId}`);
  return executeDeclaredImport(store, command);
}

/** The fixed roster query (all devices, id-ascending). */
const ROSTER_SORT: DeviceListSort = { field: "deviceId", direction: "asc" };

function rosterView(source: DeviceTwinSource, filter: DeviceListFilter = { kind: "all" }) {
  const build = buildDeviceListViewModel(
    SCOPE_A,
    source,
    { filter, sort: ROSTER_SORT, page: "all" },
    { now: NOW, ...BANDS },
  );
  if (!build.ok) throw new Error("roster build failed");
  return build.view;
}

// ---------------------------------------------------------------------------
// The SMALL-firm cold start (the work order's ground truth)
// ---------------------------------------------------------------------------

test("a fresh workspace begins tracking by DECLARING records with zero agent rollout", () => {
  const store = createInMemoryTwinStore();
  // The cold-start truth: a fresh tenant's roster is honestly EMPTY.
  expect(rosterView(store).totalDevices).toBe(0);

  declareOne(store, "dev_w145van001", { manufacturer: "Ford", model: "Transit Van", serialNumber: "SN-VAN-001" }, "couriers");
  declareOne(store, "dev_w145van002", { manufacturer: "Ford", model: "Transit Van", serialNumber: "SN-VAN-002" }, "couriers");
  declareOne(store, "dev_w145tab001", { manufacturer: "Apple", model: "iPad Pro", assetTag: "TAB-001" }, "dispatch");

  const view = rosterView(store);
  expect(view.totalDevices).toBe(3);
  // EVERY declared record is marked DECLARED — never presented as observed.
  expect(view.rows.map((row) => row.provenance)).toEqual(["DECLARED", "DECLARED", "DECLARED"]);
  // The honest telemetry: a declared record fabricates NO observation.
  expect(view.rows.every((row) => row.staleness === "never_observed")).toBe(true);
  expect(view.rows.every((row) => row.observationCount === 0)).toBe(true);
  expect(view.rows.every((row) => row.lastObservedAt === null)).toBe(true);
  // The declaring principal rides the rows.
  expect(view.rows.every((row) => row.declaredBy === USER)).toBe(true);
  // The origin facet counts the declared records.
  expect(view.facets.byProvenance).toEqual([{ value: "DECLARED", count: 3 }]);
});

// ---------------------------------------------------------------------------
// The provenance separation (the marking, not exclusion)
// ---------------------------------------------------------------------------

test("DECLARED and OBSERVED records coexist in one roster, each with its own mark — never conflated", () => {
  const store = createInMemoryTwinStore();
  // Agent-observed fixtures (the REAL device-model path with real
  // observations recorded through the ingestion seam).
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      lifecycleHops: 2,
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(2))],
      postureSummary: "HEALTHY",
    }),
  );
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A2,
      lifecycleHops: 8,
      observations: [obs("device.power", { batteryPercent: 5 }, atHour(40))],
      postureSummary: "AT_RISK",
      findingCount: 3,
    }),
  );
  // A declared record alongside them.
  declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "SN-W145-001" });

  const view = rosterView(store);
  expect(view.totalDevices).toBe(3);
  const declaredRows = view.rows.filter((row) => row.provenance === "DECLARED");
  const observedRows = view.rows.filter((row) => row.provenance === "OBSERVED");
  expect(declaredRows.map((row) => row.deviceId as string)).toEqual(["dev_w145declared01"]);
  expect(observedRows.map((row) => row.deviceId as string)).toEqual([DEV_A1, DEV_A2].map(String));
  // The separation is TOTAL: every row carries exactly one mark.
  expect(view.rows.every((row) => row.provenance === "DECLARED" || row.provenance === "OBSERVED")).toBe(true);
  // The declared row is Never observed while the agent rows carry real telemetry.
  expect(declaredRows[0].staleness).toBe("never_observed");
  expect(observedRows.every((row) => row.staleness !== "never_observed")).toBe(true);
  // The facet separates the fleet into its origins.
  expect(view.facets.byProvenance).toEqual([
    { value: "DECLARED", count: 1 },
    { value: "OBSERVED", count: 2 },
  ]);
});

test("the provenance FILTER isolates the declared records (a search surface of its own)", () => {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(2))],
      postureSummary: "HEALTHY",
    }),
  );
  declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "SN-W145-001" });
  declareOne(store, "dev_w145declared02", { manufacturer: "Apple", model: "MacBook Air", serialNumber: "SN-W145-002" });

  const declaredOnly = rosterView(store, { kind: "provenance", provenance: "DECLARED" });
  expect(declaredOnly.totalMatches).toBe(2);
  expect(declaredOnly.rows.every((row) => row.provenance === "DECLARED")).toBe(true);
  expect(declaredOnly.rows.map((row) => row.deviceId as string)).toEqual([
    "dev_w145declared01",
    "dev_w145declared02",
  ]);

  const observedOnly = rosterView(store, { kind: "provenance", provenance: "OBSERVED" });
  expect(observedOnly.totalMatches).toBe(1);
  expect(observedOnly.rows[0].deviceId).toBe(DEV_A1);
});

test("declared records are findable by the roster SEARCH (identity fields + the provenance word)", () => {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      manufacturer: "Lenovo",
      model: "ThinkPad X1",
      serialNumber: "SN-LEGACY-9",
    }),
  );
  declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "SN-W145-001" });

  // Search by the declared record's serial.
  expect(rosterView(store, { kind: "search", text: "SN-W145-001" }).rows).toHaveLength(1);
  // Search by the declared record's manufacturer.
  expect(rosterView(store, { kind: "search", text: "dell" }).rows).toHaveLength(1);
  // Search by the provenance WORD: "declared" finds the declared records.
  const byWord = rosterView(store, { kind: "search", text: "declared" });
  expect(byWord.rows.map((row) => row.deviceId as string)).toEqual(["dev_w145declared01"]);
  // The agent-path record is NOT returned by the "declared" search.
  expect(byWord.rows.some((row) => row.deviceId === DEV_A1)).toBe(false);
  // And "observed" finds the agent-path record, not the declared one.
  const observedByWord = rosterView(store, { kind: "search", text: "observed" });
  expect(observedByWord.rows.map((row) => row.deviceId as string)).toEqual([DEV_A1]);
});

test("verifyDeclaredImport over the REAL store: declared lands, a dropped mark is DETECTED", () => {
  const store = createInMemoryTwinStore();
  const twin = declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450" });
  const verification = verifyDeclaredImport(SCOPE_A, store, twin.deviceId);
  expect(verification.status).toBe("declared");
  expect(verification.checks.every((check) => check.state === "met")).toBe(true);

  // The conflation detector: the same device id enrolled WITHOUT the
  // marker (a binding site that dropped the provenance contract).
  const droppedStore = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: asDeviceId("dev_w145dropped01"),
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: { manufacturer: "Dell", model: "Latitude 5450" },
    ownership: { ownerType: "FLEET_PURCHASED" },
    at: atHour(51),
    provenance: { correlationId: CORR }, // no reason -> no mark
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: atHour(51), correlationId: CORR } });
  if (!created.ok) throw new Error(created.error.message);
  droppedStore.put(created.twin);
  const dropped = verifyDeclaredImport(SCOPE_A, droppedStore, asDeviceId("dev_w145dropped01"));
  expect(dropped.status).toBe("present_not_declared");
});

test("an agent observation later UPGRADES a declared record's telemetry; the origin mark STAYS", () => {
  const store = createInMemoryTwinStore();
  const twin = declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450" });
  // A real agent checks in through the REAL observation ingestion seam.
  const recorded = recordTwinObservations(twin, [obs("device.power", { batteryPercent: 88 }, atHour(71))], {
    at: atHour(71),
    correlationId: CORR,
  });
  if (!recorded.ok) throw new Error(recorded.error.message);
  store.put(recorded.twin);

  const view = rosterView(store);
  const row = view.rows[0];
  expect(row.provenance).toBe("DECLARED"); // the origin mark stays
  expect(row.staleness).toBe("fresh"); // real observations now flow
  expect(row.observationCount).toBe(1);
  const verification = verifyDeclaredImport(SCOPE_A, store, twin.deviceId);
  expect(verification.status).toBe("declared");
  expect(verification.checks.map((c) => c.state)).toEqual(["met", "met", "unmet"]);
});

// ---------------------------------------------------------------------------
// The mobile priority-card roster (same REAL runtime state)
// ---------------------------------------------------------------------------

test("the priority ladder derives severity-first bands deterministically", () => {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(71))],
      postureSummary: "HEALTHY",
    }),
  );
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A2,
      lifecycleHops: 8,
      observations: [obs("device.power", { batteryPercent: 5 }, atHour(40))],
      postureSummary: "AT_RISK",
      findingCount: 3,
      recoveryState: "ACTIVE",
    }),
  );
  // DEV_A3: enrolled, never observed (the never_observed band).
  store.put(twinFixture({ tenantId: TENANT_A, deviceId: DEV_A3, lifecycleHops: 0 }));

  const view = rosterView(store);
  const bands = view.rows.map((row) => deviceAttentionBand(row));
  expect(bands).toEqual(["healthy", "critical", "never_observed"]);
  expect(deviceAttentionRank("critical")).toBeLessThan(deviceAttentionRank("attention"));
  expect(deviceAttentionRank("attention")).toBeLessThan(deviceAttentionRank("stale"));
  expect(deviceAttentionRank("stale")).toBeLessThan(deviceAttentionRank("never_observed"));
  expect(deviceAttentionRank("never_observed")).toBeLessThan(deviceAttentionRank("indeterminate"));
  expect(deviceAttentionRank("indeterminate")).toBeLessThan(deviceAttentionRank("healthy"));
});

test("the mobile cards project the SAME roster rows, priority-first ordered, provenance intact", () => {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(71))],
      postureSummary: "HEALTHY",
    }),
  );
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A2,
      lifecycleHops: 8,
      observations: [obs("device.power", { batteryPercent: 5 }, atHour(40))],
      postureSummary: "AT_RISK",
      findingCount: 3,
      recoveryState: "ACTIVE",
    }),
  );
  const declaredTwin = declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450" });

  const view = rosterView(store);
  const cards = buildMobileDeviceCards(view);

  // SAME real runtime state: the cards cover exactly the roster's rows.
  expect(cards.totalCards).toBe(view.rows.length);
  expect(cards.totalMatches).toBe(view.totalMatches);
  const cardIds = cards.cards.map((card) => card.deviceId as string).sort();
  const rowIds = view.rows.map((row) => row.deviceId as string).sort();
  expect(cardIds).toEqual(rowIds);

  // Priority-first: the critical device leads, the declared
  // never-observed record follows, the healthy one trails.
  expect(cards.cards[0].deviceId).toBe(DEV_A2);
  expect(cards.cards[0].priority.band).toBe("critical");
  expect(cards.cards[1].deviceId).toBe(declaredTwin.deviceId);
  expect(cards.cards[1].priority.band).toBe("never_observed");
  expect(cards.cards[2].deviceId).toBe(DEV_A1);
  expect(cards.cards[2].priority.band).toBe("healthy");
  // The declared record (never observed) is marked DECLARED.
  expect(cards.cards[1].provenance).toBe("DECLARED");
  expect(cards.cards[1].provenanceLabel).toBe("Declared");
  // Agent-observed cards carry the OBSERVED mark — never conflated.
  expect(cards.cards[0].provenance).toBe("OBSERVED");
  expect(cards.cards[2].provenance).toBe("OBSERVED");
  // The band counts guide the field triage.
  expect(cards.byBand).toEqual([
    { value: "critical", count: 1 },
    { value: "never_observed", count: 1 },
    { value: "healthy", count: 1 },
  ]);
});

test("within one attention band the deterministic deviceId tiebreak applies", () => {
  const store = createInMemoryTwinStore();
  declareOne(store, "dev_w145b002", { manufacturer: "Ford", model: "Transit" });
  declareOne(store, "dev_w145a001", { manufacturer: "Ford", model: "Transit" });
  declareOne(store, "dev_w145c003", { manufacturer: "Ford", model: "Transit" });

  const cards = buildMobileDeviceCards(rosterView(store));
  // All three are never_observed (declared, awaiting their agent): the
  // tiebreak is deviceId ascending — NOT the table's chosen sort.
  expect(cards.cards.map((card) => card.deviceId as string)).toEqual([
    "dev_w145a001",
    "dev_w145b002",
    "dev_w145c003",
  ]);
  expect(cards.cards.every((card) => card.priority.band === "never_observed")).toBe(true);
});

test("the mobile cards honor the roster's filter (same query, same rows)", () => {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      observations: [obs("device.power", { batteryPercent: 15 }, atHour(2))],
      postureSummary: "HEALTHY",
    }),
  );
  declareOne(store, "dev_w145declared01", { manufacturer: "Dell", model: "Latitude 5450" });

  const filtered = rosterView(store, { kind: "provenance", provenance: "DECLARED" });
  const cards = buildMobileDeviceCards(filtered);
  expect(cards.totalCards).toBe(1);
  expect(cards.cards[0].deviceId).toBe("dev_w145declared01");
  const every: MobileDeviceCard = cards.cards[0];
  expect(every.staleness.label).toBe("Never observed");
});
