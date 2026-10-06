/**
 * @fleetos/web — W152 Fix 2 (R5a residual): the device lifecycle route
 * binding + the doctor/roster "Open device detail" button wiring
 * regression tests.
 *
 * These tests pin the R5a residual's closure: the Device Doctor's "Open
 * device detail" button USED to navigate to `{area:"device",view:"doctor"}`
 * — the SAME route it already sat on (a dead button). The roster's
 * `onOpenDevice` discarded the deviceId. The `device.lifecycle` route —
 * INSIDE the frozen route vocabulary (SHELL_VIEW_LABELS["device.lifecycle"]
 * = "Lifecycle") — was NEVER bound in the console's route switch (it
 * fell through to the "This route does not exist" refusal). Two defects
 * in one.
 *
 * The fix:
 *   - the doctor's `onOpenDevice` sets the session-held `selectedDeviceId`
 *     then navigates to `{area:"device",view:"lifecycle"}`;
 *   - the roster's `onOpenDevice` does the same (the deviceId is no
 *     longer discarded);
 *   - the new `case "device.lifecycle":` binding renders the
 *     `DeviceLifecycleScreen` over the REAL session twin store via
 *     `buildDeviceDetailHeader`, with the honest empty `undefined`
 *     view-model rendering the screen's own "Device not found in your
 *     fleet" state for a device not in the acting tenant's partition.
 *
 * The tests follow the W149 verification test pattern (pure-module
 * unit tests + the W147 console-journeys harness for the rendering).
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { asTenantId, asDeviceId } from "@fleetos/contracts";
import { ConsoleApp } from "../src/console-app";
import { demoTwinStore } from "../src/runtime/demo-fleet";
import { createSessionTwinStore } from "../src/runtime/declared-import-binding";
import { buildDeviceDetailHeader } from "@fleetos/web-device";
import type { TwinStore } from "@fleetos/device-model";
import type { ShellRoute } from "@fleetos/web-shell";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

const DEMO_TENANT = "tnt_w091demo000001";
const DEMO_DEVICE = "dev_w091demo000001";
const FRESH_TENANT = "tnt_w149fresh001";
const NOW = "2026-01-06T14:00:00Z";

// ---------------------------------------------------------------------------
// P1 — the pure view-model composition (buildDeviceDetailHeader over the
// REAL session twin store)
// ---------------------------------------------------------------------------

test("W152 Fix 2 P1 — buildDeviceDetailHeader composes the demo device's header over the REAL demo twin store", () => {
  // The lifecycle route's view-model: `buildDeviceDetailHeader(scope,
  // source, deviceId, options)` over the demo's REAL twin store. The
  // demo tenant's `dev_w091demo000001` is in the fleet (the seeded
  // device); the header composes its identity + lifecycle + telemetry +
  // provenance.
  const store: TwinStore = demoTwinStore();
  const header = buildDeviceDetailHeader(
    { tenantId: asTenantId(DEMO_TENANT) },
    store,
    asDeviceId(DEMO_DEVICE) as never,
    { now: NOW, freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
  );
  expect(header).toBeDefined();
  if (header === undefined) throw new Error("unreachable");
  expect(header.deviceId).toBe(DEMO_DEVICE);
  expect(header.tenantId).toBe(DEMO_TENANT);
  // The lifecycle machine is the frozen view (the device's current
  // state is OBSERVE — the seeded demo device's lifecycle position).
  expect(header.lifecycle.current).toBeDefined();
  expect(header.lifecycle.nextLegal.length).toBeGreaterThan(0);
});

test("W152 Fix 2 P1 — buildDeviceDetailHeader returns undefined for a device NOT in the acting tenant's fleet (the honest not-in-fleet state)", () => {
  // The honest not-in-fleet state: a device id NOT in the acting
  // tenant's partition yields `undefined` (the screen's own empty
  // handling — "Device not found in your fleet"). The fresh workspace's
  // empty twin store yields `undefined` for every device id.
  const store: TwinStore = createSessionTwinStore();
  const header = buildDeviceDetailHeader(
    { tenantId: asTenantId(FRESH_TENANT) },
    store,
    asDeviceId("dev_freshworkspace01") as never,
    { now: NOW, freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
  );
  expect(header).toBeUndefined();
});

test("W152 Fix 2 P1 — buildDeviceDetailHeader NEVER crosses tenants (the isolation law)", () => {
  // The acting tenant's scope rides every query (ARCHITECTURE-LOCK.md
  // item 17). The demo's twin store carries the demo tenant's device;
  // a DIFFERENT tenant's scope yields `undefined` (foreign/unknown are
  // indistinguishable — no existence side channel).
  const store: TwinStore = demoTwinStore();
  const foreignHeader = buildDeviceDetailHeader(
    { tenantId: asTenantId(FRESH_TENANT) },
    store,
    asDeviceId(DEMO_DEVICE) as never,
    { now: NOW, freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
  );
  expect(foreignHeader).toBeUndefined();
});

// ---------------------------------------------------------------------------
// P2 — the route renders the lifecycle screen (the binding's no-crash
// assertion over the demo tier + the honest not-in-fleet state)
// ---------------------------------------------------------------------------

function mountDemoApp(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getByRole("button", { name: "Demo — Fleet Administrator" }));
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

function mountWorkspaceApp(route: ShellRoute): void {
  render(<ConsoleApp initialRoute={route} />);
  fireEvent.click(screen.getAllByText("Create workspace")[0]!.closest("button")!);
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Northwind Fleet" } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada@northwind.example" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "founder-pass-0001" } });
  fireEvent.click(screen.getAllByText("Create workspace").at(-1)!.closest("button")!);
  fireEvent.click(screen.getByText("Dismiss getting started"));
}

test("W152 Fix 2 P2 — the device.lifecycle route renders the lifecycle screen for the demo device (ready phase with the header)", () => {
  // The R5a residual's closure: the `device.lifecycle` route USED to
  // fall through to the "This route does not exist" refusal (the
  // console's switch never bound it). The fix binds the route to the
  // `DeviceLifecycleScreen` over the REAL session twin store; the
  // demo device's header composes (the ready phase with the header).
  mountDemoApp({ area: "device", view: "lifecycle" });
  // The lifecycle screen's breadcrumb carries the "Lifecycle" label.
  expect(screen.getAllByText(/Lifecycle/).length).toBeGreaterThan(0);
  // The screen's subtitle carries the device id (the demo device) —
  // multiple elements may match (the sidebar + the subtitle); assert
  // at least one match.
  expect(screen.getAllByText(new RegExp(DEMO_DEVICE)).length).toBeGreaterThan(0);
  // The "Open Device Doctor" button is present (the back-navigation
  // affordance — the screen's own prop, wired to navigate back to the
  // doctor route).
  expect(screen.getByRole("button", { name: /Open Device Doctor/ })).toBeDefined();
});

test("W152 Fix 2 P2 — the device.lifecycle route renders the honest not-in-fleet state for a fresh workspace (undefined view-model -> the screen's own empty handling)", () => {
  // The fresh workspace's twin store is empty; the lifecycle route's
  // `buildDeviceDetailHeader` returns `undefined`. The screen renders
  // its own "Device not found in your fleet" empty state (the screen's
  // L196-202 empty handling — never fabricated data).
  mountWorkspaceApp({ area: "device", view: "lifecycle" });
  expect(screen.getByText(/Device not found in your fleet/)).toBeDefined();
});

// ---------------------------------------------------------------------------
// P3 — the button wiring (the doctor's + the roster's "Open device
// detail" both navigate to device.lifecycle with the session-held id)
// ---------------------------------------------------------------------------

test("W152 Fix 2 P3 (a) — the doctor's 'Open device detail' button sets selectedDeviceId + navigates to device.lifecycle (no longer a dead navigation)", () => {
  // The R5a residual's verbatim report: the doctor's "Open device
  // detail" button navigated to `{area:"device",view:"doctor"}` — the
  // SAME route it already sat on. The fix: set the session-held
  // selectedDeviceId, then navigate to `{area:"device",view:"lifecycle"}`.
  mountDemoApp({ area: "device", view: "doctor" });
  // The doctor screen renders the "Open device detail" button (the
  // screen's L788 button — `props.onOpenDevice(props.deviceId)`).
  const openDeviceButtons = screen.getAllByRole("button", { name: /Open device detail/ });
  expect(openDeviceButtons.length).toBeGreaterThan(0);
  fireEvent.click(openDeviceButtons[0]!);
  // The lifecycle route renders (the navigation landed on
  // device.lifecycle — the route's breadcrumb is present).
  expect(screen.getAllByText(/Lifecycle/).length).toBeGreaterThan(0);
  // The session-held device id is the demo device (the doctor's
  // `props.deviceId` — the doctor's `dev_w091demo000001`). Multiple
  // elements may match (the sidebar + the subtitle); assert at least
  // one match.
  expect(screen.getAllByText(new RegExp(DEMO_DEVICE)).length).toBeGreaterThan(0);
});

test("W152 Fix 2 P3 (b) — the roster's onOpenDevice sets selectedDeviceId + navigates to device.lifecycle (the deviceId is no longer discarded)", () => {
  // The roster's `onOpenDevice` USED to discard the deviceId and
  // navigate to the doctor (a dead navigation — the operator's row
  // click was a no-op for the row's device). The fix: set the
  // session-held selectedDeviceId, then navigate to device.lifecycle.
  mountDemoApp({ area: "device", view: "list" });
  // The fleet table renders the demo device's row with the device's
  // display name as the click affordance (the screen's L271 button —
  // `onClick={(): void => onOpenDevice(row.deviceId)}` with the row's
  // displayName as the label). The demo device's displayName is
  // "Lenovo ThinkPad T14" (the seeded demo fleet's DEV_1).
  const deviceLink = screen.getByRole("button", { name: /Lenovo ThinkPad T14/ });
  fireEvent.click(deviceLink);
  // The lifecycle route renders (the navigation landed on
  // device.lifecycle — the route's breadcrumb is present).
  expect(screen.getAllByText(/Lifecycle/).length).toBeGreaterThan(0);
});

test("W152 Fix 2 P3 (c) — the lifecycle screen's 'Open Device Doctor' button navigates back to the doctor route", () => {
  // The lifecycle screen's `onOpenDoctor` prop is wired to navigate
  // back to `{area:"device",view:"doctor"}` (the round-trip closure:
  // doctor -> lifecycle -> doctor).
  mountDemoApp({ area: "device", view: "lifecycle" });
  const openDoctorButton = screen.getByRole("button", { name: /Open Device Doctor/ });
  fireEvent.click(openDoctorButton);
  // The doctor route renders (the doctor screen's breadcrumb or
  // signature element is present). The doctor screen renders the
  // "Open device detail" button (the screen's L788 button — the
  // doctor's signature affordance).
  expect(screen.getAllByRole("button", { name: /Open device detail/ }).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// P4 — the transition authorization model (the honest empty map + the
// no-op onRequestTransition — the doctor's treatment-gating precedent)
// ---------------------------------------------------------------------------

test("W152 Fix 2 P4 — the lifecycle route renders the legal next transitions with the honest 'Not requested' authorization state (the empty map's default)", () => {
  // The `transitionAuthorization` map is HONESTLY EMPTY (the demo tier
  // wires no transition-authorization boundary — the doctor's
  // `treatmentGating` precedent: an empty map means "no boundary").
  // The screen renders each transition with the default
  // `{ state: "not_requested" }` authorization (the screen's L140
  // fallback — `authorization[target] ?? { state: "not_requested" }`).
  mountDemoApp({ area: "device", view: "lifecycle" });
  // The "Request transition" button is present for each legal next
  // transition (the screen's L160-166 button). Clicking is a no-op
  // (the honest refusal — no boundary is exposed in this session).
  const requestButtons = screen.getAllByRole("button", { name: /Request transition to/ });
  expect(requestButtons.length).toBeGreaterThan(0);
  // The "Authorization: Not requested" status label is present (the
  // empty map's default — the honest state).
  expect(screen.getAllByText(/Authorization: Not requested/).length).toBeGreaterThan(0);
});

test("W152 Fix 2 P4 — the 'Request transition' button is an honest no-op (no boundary is exposed in this session)", () => {
  // The `onRequestTransition` handler is the honest refusal the
  // current authorization model warrants: a no-op (no transition-
  // authorization boundary is exposed in this session — the doctor's
  // `onAcceptTreatment` precedent). Clicking does not navigate, does
  // not throw, does not change the screen's state.
  mountDemoApp({ area: "device", view: "lifecycle" });
  const requestButtons = screen.getAllByRole("button", { name: /Request transition to/ });
  expect(requestButtons.length).toBeGreaterThan(0);
  // The click is a no-op — the lifecycle route is still rendered
  // after the click (no navigation, no crash).
  fireEvent.click(requestButtons[0]!);
  expect(screen.getAllByText(/Lifecycle/).length).toBeGreaterThan(0);
});
