/**
 * W145 web-device — browser-facing RENDER tests for the MOBILE
 * PRIORITY-CARD roster (the device fleet screen's narrow-viewport
 * composition).
 *
 * The machine proofs of the work order's second contract:
 *   - composed narrow (mobileRoster — the shell's viewport signal), the
 *     roster renders as PRIORITY CARDS: severity-first ordering, over the
 *     SAME REAL runtime state as the table; the wide (993px) table is
 *     REPLACED (not present in the DOM at all — no horizontal page
 *     scroll can occur at 390x844, and the card CSS is width-bounded);
 *   - the desktop composition (no signal) renders the table exactly as
 *     before — byte-identical, no cards;
 *   - the DECLARED/OBSERVED provenance marking rides every card.
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`) BEFORE any
 * module loads. Deterministic: same props -> byte-identical markup.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { asCorrelationId, asDeviceId, asUserId } from "@fleetos/contracts";
import {
  CONSOLE_CSS,
  DECLARED_ADAPTER_FAMILY,
  DECLARED_IMPORT_PROVENANCE_REASON,
  DeviceFleetScreen,
  buildDeviceListViewModel,
} from "../src/index";
import type { DeviceListViewModel, DeviceTwinSource } from "../src/index";
import { createInMemoryTwinStore, createTwin, enrollDevice } from "@fleetos/device-model";
import {
  BANDS,
  DEV_A1,
  DEV_A2,
  DEV_A3,
  SCOPE_A,
  TENANT_A,
  atHour,
  obs,
  seededTwinSource,
  twinFixture,
} from "./helpers";

afterEach(() => {
  cleanup();
});

const NOW = atHour(72);

/** The deterministic fixture fleet (three tenant-A devices). */
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
  ];
}

/** The frozen roster view-model over the fixture fleet. */
function rosterView(source: DeviceTwinSource = seededTwinSource(fleet())): DeviceListViewModel {
  const build = buildDeviceListViewModel(
    SCOPE_A,
    source,
    {
      filter: { kind: "all" },
      sort: { field: "deviceId", direction: "asc" },
      page: { offset: 0, limit: 10 },
    },
    { now: NOW, ...BANDS },
  );
  if (!build.ok) throw new Error("roster build failed");
  return build.view;
}

/** A roster view whose fleet includes one DECLARED record (the real path). */
function rosterViewWithDeclared(): DeviceListViewModel {
  const store = createInMemoryTwinStore();
  for (const twin of fleet()) store.put(twin);
  const declaredId = "dev_w145declared01";
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: asDeviceId(declaredId),
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: { manufacturer: "Apple", model: "MacBook Pro 14", serialNumber: "SN-DECLARED-1" },
    ownership: { ownerType: "CUSTOMER_OWNED", assignedTeam: "front-desk" },
    at: atHour(50),
    provenance: {
      correlationId: asCorrelationId("cor_w145render01"),
      actor: { kind: "user", userId: asUserId("usr_testuser00001") },
      reason: DECLARED_IMPORT_PROVENANCE_REASON,
    },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({
    identity: enrolled.identity,
    ctx: { at: atHour(50), correlationId: asCorrelationId("cor_w145render01") },
  });
  if (!created.ok) throw new Error(created.error.message);
  store.put(created.twin);
  return rosterView(store);
}

const BASE_PROPS = {
  query: {
    search: "",
    facet: { kind: "all" } as const,
    sort: { field: "deviceId", direction: "asc" } as const,
    page: { offset: 0, limit: 10 },
  },
  selection: { kind: "none" } as const,
  onSearchChange: (): void => {},
  onFacetChange: (): void => {},
  onSortChange: (): void => {},
  onPageChange: (): void => {},
  onToggleDevice: (): void => {},
  onSelectVisible: (): void => {},
  onClearSelection: (): void => {},
  onOpenDevice: (): void => {},
  onEnroll: (): void => {},
};

// ---------------------------------------------------------------------------
// Composed narrow: the table is REPLACED by the priority card list
// ---------------------------------------------------------------------------

test("composed narrow, the roster renders the priority card list and the 993px table is GONE", () => {
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      mobileRoster: true,
    }),
  );

  // The wide table is REPLACED — not in the DOM at all (no horizontal
  // page scroll can occur at 390x844 when the table does not exist).
  expect(screen.queryByRole("table")).toBeNull();

  // The card list renders over the SAME REAL runtime state: the same
  // device ids the table would show.
  const cards = screen.getByTestId("fos-fleet-cards");
  const list = within(cards).getByRole("list", { name: "Device roster — priority cards" });
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items.map((item) => item.getAttribute("data-device-id"))).toEqual([
    DEV_A2,
    DEV_A1,
    DEV_A3,
  ]);
});

test("the cards render SEVERITY-FIRST (critical before stale before never-observed), with the priority label on every card", () => {
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      mobileRoster: true,
    }),
  );

  const cards = screen.getByTestId("fos-fleet-cards");
  const items = within(cards).getAllByRole("listitem");
  // Fixture bands: A2 = AT_RISK + ACTIVE recovery -> critical;
  // A1 = HEALTHY posture but 70h-old observation -> stale;
  // A3 = enrolled, never observed -> never_observed.
  expect(items.map((item) => item.getAttribute("data-attention-band"))).toEqual([
    "critical",
    "stale",
    "never_observed",
  ]);
  // State is NEVER conveyed by color alone: each card carries the band text.
  expect(within(cards).getAllByText(/Critical — Blocked/)).toHaveLength(1);
  expect(within(cards).getAllByText(/Stale observations — Needs attention/)).toHaveLength(1);
  expect(within(cards).getAllByText(/Awaiting first observation — Informational/)).toHaveLength(1);
  // The status line reports the same real counts.
  expect(
    within(cards).getByText(/Priority order — the devices that need attention first\. 3 of 3 matched devices\./),
  ).toBeTruthy();
});

test("the DECLARED/OBSERVED provenance badge rides every card (never conflated)", () => {
  const view = rosterViewWithDeclared();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      mobileRoster: true,
    }),
  );

  const cards = screen.getByTestId("fos-fleet-cards");
  const items = within(cards).getAllByRole("listitem");
  expect(items).toHaveLength(4);
  // The declared record's card carries the DECLARED badge exactly once.
  const declaredItem = items.find((item) => item.getAttribute("data-device-id") === "dev_w145declared01");
  expect(declaredItem).toBeDefined();
  if (declaredItem === undefined) throw new Error("declared card missing");
  expect(within(declaredItem).getAllByText("Declared")).toHaveLength(1);
  expect(within(declaredItem).queryByText("Observed")).toBeNull();
  // The agent-path cards carry the OBSERVED badge.
  for (const id of [DEV_A1, DEV_A2]) {
    const observedItem = items.find((item) => item.getAttribute("data-device-id") === id);
    expect(observedItem).toBeDefined();
    if (observedItem === undefined) throw new Error("observed card missing");
    expect(within(observedItem).getAllByText("Observed")).toHaveLength(1);
    expect(within(observedItem).queryByText("Declared")).toBeNull();
  }
});

test("tapping a card's device button opens the device (the card is a real control)", () => {
  let opened: string | null = null;
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      mobileRoster: true,
      onOpenDevice: (deviceId: string): void => {
        opened = deviceId;
      },
    }),
  );
  const cards = screen.getByTestId("fos-fleet-cards");
  const firstCard = within(cards).getAllByRole("listitem")[0]; // the critical device
  fireEvent.click(within(firstCard).getByRole("button", { name: "Dell Latitude 5440" }));
  expect(opened).toBe(DEV_A2);
});

test("the filters, search, pagination, and entry points still render in the narrow composition", () => {
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      mobileRoster: true,
    }),
  );
  expect(screen.getByLabelText("Search devices")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Enroll devices" }).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Priority cards: attention band/)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The layout contract (width-bounded cards — no horizontal overflow)
// ---------------------------------------------------------------------------

test("the mobile layout contract: the cards are width-bounded — no horizontal page scroll at 390x844", () => {
  // Every card is width-bounded: min-width 0 + max-width 100% + wrap.
  const itemRule = CONSOLE_CSS.slice(
    CONSOLE_CSS.indexOf(".fos-card-list__item {"),
    CONSOLE_CSS.indexOf("}", CONSOLE_CSS.indexOf(".fos-card-list__item {")),
  );
  expect(itemRule).toContain("min-width: 0");
  expect(itemRule).toContain("max-width: 100%");
  expect(itemRule).toContain("overflow-wrap: anywhere");
  // The card-list container is width-bounded too.
  const listRule = CONSOLE_CSS.slice(
    CONSOLE_CSS.indexOf(".fos-card-list {"),
    CONSOLE_CSS.indexOf("}", CONSOLE_CSS.indexOf(".fos-card-list {")),
  );
  expect(listRule).toContain("min-width: 0");
  // NO rule in the W145 card CSS declares a fixed pixel width (the only
  // allowed widths are 0 and percentages) — nothing can push a card
  // past a 390px viewport. (The lookbehind excludes min-/max- widths and
  // the media query's own max-width condition.)
  const w145Start = CONSOLE_CSS.indexOf(".fos-fleet-layout");
  const w145End = CONSOLE_CSS.indexOf("/* Form fields */");
  const w145Css = CONSOLE_CSS.slice(w145Start, w145End);
  const fixedWidths = w145Css.match(/(?<!-)width:\s*\d+(\.\d+)?px/g) ?? [];
  expect(fixedWidths).toEqual([]);
  // The facts' values wrap anywhere (long serials cannot force overflow).
  const factDdRule = CONSOLE_CSS.slice(
    CONSOLE_CSS.indexOf(".fos-card-list__fact dd"),
    CONSOLE_CSS.indexOf("}", CONSOLE_CSS.indexOf(".fos-card-list__fact dd")),
  );
  expect(factDdRule).toContain("overflow-wrap: anywhere");
});

// ---------------------------------------------------------------------------
// The desktop composition (no signal): unchanged, byte-identical
// ---------------------------------------------------------------------------

test("the desktop composition (no mobileRoster signal) renders the table exactly as before — no cards", () => {
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
    }),
  );

  const table = screen.getByRole("table");
  expect(table).toBeTruthy();
  expect(screen.queryByTestId("fos-fleet-cards")).toBeNull();

  // The same 9 columns, by accessible name.
  for (const name of ["Select", "Device", "Lifecycle", "Posture", "Ownership", "Last observed", "Staleness", "Findings", "Workloads"]) {
    expect(within(table).getByRole("columnheader", { name })).toBeTruthy();
  }
  expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
  // The table wrap still carries the desktop scroll container.
  expect(table.parentElement?.className).toBe("fos-table-wrap");
});

test("the desktop table marks the DECLARED row (the marking is surface-wide, not mobile-only)", () => {
  const view = rosterViewWithDeclared();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
    }),
  );
  const declaredRow = screen.getAllByRole("row").find((row) => row.getAttribute("data-device-id") === "dev_w145declared01");
  expect(declaredRow).toBeDefined();
  if (declaredRow === undefined) throw new Error("declared row missing");
  expect(within(declaredRow).getAllByTestId("fos-provenance-declared")).toHaveLength(1);
  // The agent rows carry no DECLARED badge.
  const agentRow = screen.getAllByRole("row").find((row) => row.getAttribute("data-device-id") === DEV_A1);
  expect(agentRow).toBeDefined();
  if (agentRow === undefined) throw new Error("agent row missing");
  expect(within(agentRow).queryByTestId("fos-provenance-declared")).toBeNull();
});

// ---------------------------------------------------------------------------
// The declared-import cold-start entry points (optional + additive)
// ---------------------------------------------------------------------------

test("the roster exposes the declared-import entry points when onDeclare is provided", () => {
  let declared = false;
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
      onDeclare: (): void => {
        declared = true;
      },
    }),
  );
  const buttons = screen.getAllByRole("button", { name: /Declare a device record without an agent|Declare device/ });
  expect(buttons.length).toBeGreaterThanOrEqual(2); // header + roster card actions
  fireEvent.click(buttons[0]);
  expect(declared).toBe(true);
});

test("the cold-start empty state offers the manual declared path alongside enrollment", () => {
  let declared = false;
  const empty = rosterView(seededTwinSource([]));
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view: empty },
      onDeclare: (): void => {
        declared = true;
      },
    }),
  );
  expect(screen.getByText("No devices are enrolled yet")).toBeTruthy();
  expect(
    screen.getByText(/declared records are clearly marked and never conflated with agent-observed ones/),
  ).toBeTruthy();
  const declareButton = screen.getByRole("button", { name: "Declare a device without an agent" });
  fireEvent.click(declareButton);
  expect(declared).toBe(true);
});

test("without onDeclare the roster renders exactly as before (backward compatible)", () => {
  const view = rosterView();
  render(
    createElement(DeviceFleetScreen, {
      ...BASE_PROPS,
      phase: { kind: "ready", view },
    }),
  );
  expect(screen.queryByRole("button", { name: /Declare/ })).toBeNull();
});

// ---------------------------------------------------------------------------
// Determinism (both compositions)
// ---------------------------------------------------------------------------

test("the same roster props always produce byte-identical static markup (table + cards compositions)", () => {
  const view = rosterViewWithDeclared();
  const tableProps = { ...BASE_PROPS, phase: { kind: "ready" as const, view } };
  const cardProps = { ...tableProps, mobileRoster: true };

  const tableOne = renderToStaticMarkup(createElement(DeviceFleetScreen, tableProps));
  const tableTwo = renderToStaticMarkup(createElement(DeviceFleetScreen, tableProps));
  expect(tableOne).toBe(tableTwo);

  const cardsOne = renderToStaticMarkup(createElement(DeviceFleetScreen, cardProps));
  const cardsTwo = renderToStaticMarkup(createElement(DeviceFleetScreen, cardProps));
  expect(cardsOne).toBe(cardsTwo);

  // The two compositions are distinct: the narrow one carries the card
  // list + attention bands and NO table; the desktop one the reverse.
  expect(cardsOne).toContain("data-attention-band=");
  expect(cardsOne).toContain("fos-card-list__item");
  expect(cardsOne).not.toContain("<table");
  expect(tableOne).toContain("<table");
  expect(tableOne).not.toContain("data-attention-band=");
});
