/**
 * W100A web-device — browser-facing RENDER tests for the
 * InstallCenterScreen: the install contract's nine steps render from
 * the REAL @fleetos/agent release manifest; the one-time code card
 * displays the code exactly once and hides it on dismissal; the
 * install plan shows the checksum + the copy-command affordance; the
 * installation verification renders the five journey checks with the
 * stage verbatim; the refusal explanation renders the machine reason
 * AND the human explanation verbatim; the uninstall/revoke plan
 * presents authorization-required intents; callbacks are wired
 * (platform/scope selection, code creation/dismissal, copy, revoke
 * intents, doctor hand-off); and the same props always produce
 * byte-identical static markup (determinism).
 *
 * The happy-dom window is installed by the test preload
 * (`test/dom.preload.ts`, wired via the root `bunfig.toml`) BEFORE
 * any module loads.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { asDeviceId, asTenantId } from "@fleetos/contracts";
import { buildAgentRelease, installerScriptFor, ALL_RELEASE_TARGETS } from "@fleetos/agent";
import { createEnrollmentRequest } from "@fleetos/device-adapters";
import {
  dismissEnrollmentCode,
  dismissInstallRefusal,
  initialInstallCenterState,
  recordEnrollmentRequest,
  recordInstallRefusal,
  selectInstallPlatform,
  selectOwnershipKind,
  InstallCenterScreen,
} from "../src/index";
import type { InstallCenterState, EnrollmentJourneyLike, ReleaseManifestLike } from "../src/index";
import { TENANT_A } from "./helpers";

const T0 = "2026-01-01T00:00:00Z";
const DEVICE = asDeviceId("dev_renderinstall1");
const CODE = "BOOT-RENDER-0001";

afterEach(cleanup);

function realRelease(): ReleaseManifestLike {
  const built = buildAgentRelease({
    moduleVersion: "1.2.3",
    protocolVersion: 1,
    releasedAt: T0,
    releaseNotes: "The productized agent.",
    payloads: ALL_RELEASE_TARGETS.map((target) => ({
      target,
      content: installerScriptFor(target, { moduleVersion: "1.2.3" }),
    })),
    uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
    rollbackInstructions: ["Revoke the device trust from the console."],
  });
  if (!built.ok) throw new Error("release build failed");
  return built.manifest;
}

function stateWithEverything(): InstallCenterState {
  const created = createEnrollmentRequest({
    tenantId: TENANT_A,
    requestId: "enr_render-0001",
    code: CODE,
    ownershipKind: "corporate_owned",
    ttlMs: 24 * 3_600_000,
    now: T0,
  });
  if (!created.ok) throw new Error("request creation failed");
  let state = initialInstallCenterState(TENANT_A);
  state = selectInstallPlatform(state, "windows", "x64");
  state = selectOwnershipKind(state, "corporate_owned");
  state = recordEnrollmentRequest(state, created.record, created.code);
  return state;
}

interface Harness {
  readonly state: InstallCenterState;
  readonly release: ReleaseManifestLike | undefined;
  readonly journey: EnrollmentJourneyLike | undefined;
  readonly calls: string[];
}

function renderScreen(harness: Harness): void {
  render(
    createElement(InstallCenterScreen, {
      state: harness.state,
      release: harness.release,
      journey: harness.journey,
      now: T0,
      expiringWithinMs: 3_600_000,
      deviceId: DEVICE,
      onPlatformChange: (platform, arch): void => {
        harness.calls.push(`platform:${platform}/${arch}`);
      },
      onOwnershipKindChange: (kind): void => {
        harness.calls.push(`scope:${kind}`);
      },
      onCreateEnrollmentCode: (): void => {
        harness.calls.push("create-code");
      },
      onDismissCode: (): void => {
        harness.calls.push("dismiss-code");
      },
      onCopyCommand: (command): void => {
        harness.calls.push(`copy:${command}`);
      },
      onRevokeIntent: (intent): void => {
        harness.calls.push(`revoke:${intent}`);
      },
      onDismissRefusal: (): void => {
        harness.calls.push("dismiss-refusal");
      },
      onOpenDoctor: (deviceId): void => {
        harness.calls.push(`doctor:${deviceId as string}`);
      },
    }),
  );
}

test("W100A render: the screen's landmark + release summary render from the REAL manifest", () => {
  const harness: Harness = {
    state: initialInstallCenterState(asTenantId("tnt_rendertenanta")),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByRole("region", { name: "Devices — Install center" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Install center" })).toBeTruthy();
  expect(screen.getByText("1.2.3")).toBeTruthy();
  expect(screen.getByText("The productized agent.")).toBeTruthy();
  expect(screen.getByText(/6 installers/)).toBeTruthy();
});

test("W100A render: the platform selector lists all three platforms with arch buttons (callbacks wired)", () => {
  const harness: Harness = {
    state: initialInstallCenterState(asTenantId("tnt_rendertenanta")),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  fireEvent.click(screen.getByRole("button", { name: "Select Windows (arm64) installer" }));
  expect(harness.calls).toEqual(["platform:windows/arm64"]);
  fireEvent.click(screen.getByRole("button", { name: "Select macOS (x64) installer" }));
  expect(harness.calls).toEqual(["platform:windows/arm64", "platform:macos/x64"]);
  fireEvent.click(screen.getByRole("button", { name: "Select Linux (arm64) installer" }));
  expect(harness.calls).toEqual(["platform:windows/arm64", "platform:macos/x64", "platform:linux/arm64"]);
});

test("W100A render: the ownership scope selector shows the four distinctions + the BYOD conservative note", () => {
  const harness: Harness = {
    state: initialInstallCenterState(asTenantId("tnt_rendertenanta")),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  for (const label of [
    "Corporate-owned",
    "Leased",
    "BYOD (bring your own device)",
    "Third-party managed",
  ]) {
    expect(screen.getByRole("button", { name: `Select ownership scope: ${label}` })).toBeTruthy();
  }
  // The BYOD conservative badge renders (scope note appears once selected via the view-model).
  expect(screen.getByText("Conservative telemetry")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select ownership scope: BYOD (bring your own device)" }));
  expect(harness.calls).toEqual(["scope:byod"]);
});

test("W100A render: without a request, the create-code affordance routes its intent", () => {
  const harness: Harness = {
    state: initialInstallCenterState(asTenantId("tnt_rendertenanta")),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  fireEvent.click(screen.getByRole("button", { name: "Create enrollment code" }));
  expect(harness.calls).toEqual(["create-code"]);
});

test("W100A render: the one-time code displays exactly once and hides on dismissal (callbacks wired)", () => {
  const harness: Harness = {
    state: stateWithEverything(),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByTestId("enrollment-code-value").textContent).toBe(CODE);
  expect(screen.getByText(/Shown once — copy it now/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "I copied the code — hide it" }));
  expect(harness.calls).toEqual(["dismiss-code"]);

  // After dismissal, the code is gone but the record facts remain.
  cleanup();
  const dismissed = dismissEnrollmentCode(harness.state);
  const dismissedHarness: Harness = { state: dismissed, release: harness.release, journey: undefined, calls: [] };
  renderScreen(dismissedHarness);
  expect(screen.queryByTestId("enrollment-code-value")).toBeNull();
  expect(screen.getByText(/shown once and is now hidden/)).toBeTruthy();
  expect(screen.getByText("enr_render-0001")).toBeTruthy();
});

test("W100A render: the install plan shows the checksum + copy-command affordance (command copied verbatim)", () => {
  const harness: Harness = {
    state: stateWithEverything(),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  // The file name appears in the plan card subtitle, the download step
  // detail, the copy step detail, and the copied command element.
  expect(screen.getAllByText(/fleetos-agent-1\.2\.3-windows-x64\.ps1/).length).toBe(4);
  expect(screen.getByText(/Checksum \(fnv1a64\)/)).toBeTruthy();
  const copyButton = screen.getByRole("button", { name: "Copy the install command" });
  fireEvent.click(copyButton);
  expect(harness.calls.length).toBe(1);
  expect(harness.calls[0]!.startsWith("copy:powershell")).toBe(true);
});

test("W100A render: the installation verification renders the five checks + the journey stage verbatim", () => {
  const confirmed: EnrollmentJourneyLike = {
    stage: "twin_confirmed",
    trust: { enrollmentRequestId: "enr_render-0001", deviceId: DEVICE as string, issuedAt: T0 },
    firstCheckIn: { at: T0, kind: "registered" },
    firstObservation: { kind: "agent.first-check-in", at: T0 },
    twinConfirmed: { at: T0, observationCount: 1 },
  };
  const harness: Harness = {
    state: stateWithEverything(),
    release: realRelease(),
    journey: confirmed,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByText(/twin_confirmed — journey stage/)).toBeTruthy();
  for (const label of [
    /Installer selected for the device's platform — met/,
    /One-time enrollment code exchanged for device trust — met/,
    /First check-in received by the control plane — met/,
    /First observation received from the device — met/,
    /Device Twin confirmed in your fleet — met/,
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "Open Device Doctor for this device" }));
  expect(harness.calls).toEqual([`doctor:${DEVICE as string}`]);
});

test("W100A render: an incomplete journey renders waiting checks and no doctor hand-off", () => {
  const partial: EnrollmentJourneyLike = {
    stage: "bootstrapped",
    trust: { enrollmentRequestId: "enr_render-0001", deviceId: DEVICE as string, issuedAt: T0 },
  };
  const harness: Harness = {
    state: stateWithEverything(),
    release: realRelease(),
    journey: partial,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByText(/bootstrapped — journey stage/)).toBeTruthy();
  expect(screen.getByText(/One-time enrollment code exchanged for device trust — met/)).toBeTruthy();
  expect(screen.getByText(/First check-in received by the control plane — waiting/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Device Doctor for this device" })).toBeNull();
  // The next action matches the journey.
  expect(screen.getByText(/Wait for the first check-in/)).toBeTruthy();
});

test("W100A render: a refusal renders the machine reason AND the human explanation verbatim", () => {
  let state = stateWithEverything();
  state = recordInstallRefusal(state, {
    reason: "code_expired",
    explanation: "This enrollment code has expired. Create a new enrollment request from the install center and try again.",
  });
  const harness: Harness = { state, release: realRelease(), journey: undefined, calls: [] };
  renderScreen(harness);
  expect(screen.getByText("Refusal: code_expired")).toBeTruthy();
  expect(
    screen.getByText(
      "This enrollment code has expired. Create a new enrollment request from the install center and try again.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss the refusal" }));
  expect(harness.calls).toEqual(["dismiss-refusal"]);

  // Dismissal removes the refusal section.
  cleanup();
  const dismissedHarness: Harness = {
    state: dismissInstallRefusal(state),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(dismissedHarness);
  expect(screen.queryByText("Refusal: code_expired")).toBeNull();
});

test("W100A render: the uninstall/revoke plan presents authorization-required intents (callbacks wired)", () => {
  const harness: Harness = {
    state: stateWithEverything(),
    release: realRelease(),
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByText(/Run the uninstaller from Settings > Apps/)).toBeTruthy();
  expect(screen.getByText(/Revoke the device trust from the console/)).toBeTruthy();
  expect(screen.getAllByText("Authorization required").length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Disable this enrollment code (requires authorization)" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke the device's trust (requires authorization)" }));
  expect(harness.calls).toEqual(["revoke:enrollment.code.disable", "revoke:device.trust.revoke"]);
});

test("W100A render: no release published renders the explicit empty state (never a fabricated plan)", () => {
  const harness: Harness = {
    state: initialInstallCenterState(asTenantId("tnt_rendertenanta")),
    release: undefined,
    journey: undefined,
    calls: [],
  };
  renderScreen(harness);
  expect(screen.getByText(/No agent release is published yet/)).toBeTruthy();
  expect(screen.getByText(/No installer selected yet/)).toBeTruthy();
});

test("W100A render: determinism — the same props produce byte-identical static markup", () => {
  const state = stateWithEverything();
  const journey: EnrollmentJourneyLike = {
    stage: "checked_in",
    trust: { enrollmentRequestId: "enr_render-0001", deviceId: DEVICE as string, issuedAt: T0 },
    firstCheckIn: { at: T0, kind: "registered" },
  };
  const props = {
    state,
    release: realRelease(),
    journey,
    now: T0,
    expiringWithinMs: 3_600_000,
    deviceId: DEVICE,
    onPlatformChange: (): void => undefined,
    onOwnershipKindChange: (): void => undefined,
    onCreateEnrollmentCode: (): void => undefined,
    onDismissCode: (): void => undefined,
    onCopyCommand: (): void => undefined,
    onRevokeIntent: (): void => undefined,
    onDismissRefusal: (): void => undefined,
    onOpenDoctor: (): void => undefined,
  };
  const first = renderToStaticMarkup(createElement(InstallCenterScreen, props));
  const second = renderToStaticMarkup(createElement(InstallCenterScreen, props));
  expect(second).toBe(first);
});
