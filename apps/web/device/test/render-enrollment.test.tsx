/**
 * W090A web-device — browser-facing RENDER + JOURNEY tests for the
 * enrollment screen (D3/D4): the existing-fleet enrollment journey —
 * the ❌ journey gap the UX simulation found — rendered end-to-end
 * over the NEW pure enrollment view-model, with the terminal VERIFIED
 * outcome derived from the REAL `@fleetos/device-model` TwinStore.
 *
 * Proven here:
 *   - the multi-step journey renders initiate -> review -> confirm ->
 *     verified, with the machine-stable validation failures surfaced
 *     verbatim at each gate;
 *   - the scope acknowledgment is an explicit required step;
 *   - the confirm step is a COMMAND VIEW (an intent), never an
 *     execution — the domain command runs at the binding site;
 *   - the journey ENDS in the verified terminal state with the three
 *     checks + the durable evidence block visible;
 *   - the failed path (domain refusal) renders the machine-stable
 *     reason and recovers back to review;
 *   - the same props always render byte-identical static markup.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, useState } from "react";
import { asDeviceId } from "@fleetos/contracts";
import {
  EnrollmentScreen,
  advanceEnrollmentJourney,
  backEnrollmentJourney,
  enrollmentCommand,
  enrollmentOutcome,
  initialEnrollmentJourney,
  updateEnrollmentDraft,
  verifyEnrollment,
} from "../src/index";
import type {
  EnrollmentDraftPatch,
  EnrollmentJourneyState,
} from "../src/index";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import type { TwinStore } from "@fleetos/device-model";
import {
  CORR,
  DEV_A1,
  SCOPE_A,
  TENANT_A,
  T0,
  atHour,
  obs,
  realTwinSource,
} from "./helpers";
import type { DeviceTwinSource } from "../src/index";

afterEach(() => {
  cleanup();
});

/** The shell's adapter-family + ownership options (injected). */
const FAMILIES = [
  { family: "windows", label: "Windows / Edge agent" },
  { family: "macos", label: "macOS / Endpoint agent" },
];
const OWNERSHIP = [
  { value: "CUSTOMER_OWNED", label: "Customer-owned (incl. BYOD)" },
  { value: "FLEET_PURCHASED", label: "Fleet-purchased" },
  { value: "LEASED", label: "Leased" },
];

/** Render the enrollment screen with the given journey + verification. */
function renderEnrollment(
  journey: EnrollmentJourneyState,
  verification: ReturnType<typeof verifyEnrollment> | undefined,
  handlers: {
    onAdvance?: () => void;
    onBack?: () => void;
    onSubmit?: () => void;
    onDraftChange?: (patch: EnrollmentDraftPatch) => void;
    onOpenDoctor?: (deviceId: ReturnType<typeof asDeviceId>) => void;
    onCancel?: () => void;
  } = {},
): ReturnType<typeof render> {
  return render(
    <EnrollmentScreen
      journey={journey}
      verification={verification}
      adapterFamilies={FAMILIES}
      ownershipTypes={OWNERSHIP}
      onDraftChange={handlers.onDraftChange ?? ((): void => {})}
      onAdvance={handlers.onAdvance ?? ((): void => {})}
      onBack={handlers.onBack ?? ((): void => {})}
      onSubmit={handlers.onSubmit ?? ((): void => {})}
      onOpenDoctor={handlers.onOpenDoctor ?? ((): void => {})}
      onCancel={handlers.onCancel ?? ((): void => {})}
    />,
  );
}

// ---------------------------------------------------------------------------
// The journey state harness (the SHELL role; the screen stays controlled)
// ---------------------------------------------------------------------------

/** A minimal shell harness driving the pure journey functions. */
function journeyHarness() {
  let state = initialEnrollmentJourney(TENANT_A);
  const apply = (patch: EnrollmentDraftPatch): void => {
    state = updateEnrollmentDraft(state, patch);
  };
  const advance = (): void => {
    const result = advanceEnrollmentJourney(state);
    if (result.ok) state = result.state;
  };
  const back = (): void => {
    state = backEnrollmentJourney(state);
  };
  return {
    get state(): EnrollmentJourneyState {
      return state;
    },
    apply,
    advance,
    back,
    outcome: (ok: boolean): void => {
      state = enrollmentOutcome(state, ok ? { ok: true } : { ok: false, reason: "enrollment_refused" });
    },
  };
}

/** The canonical complete draft (typed into the form in the journey test). */
function completeDraftPatches(): readonly EnrollmentDraftPatch[] {
  return [
    { deviceId: "dev_testdevice00a1" },
    { adapterFamily: "windows" },
    { hardware: { manufacturer: "Lenovo" } },
    { hardware: { model: "ThinkPad X1" } },
    { hardware: { serialNumber: "SN-ENROLL-1" } },
    { ownership: { ownerType: "CUSTOMER_OWNED" } },
    { ownership: { assignedTeam: "field-ops" } },
  ];
}

// ---------------------------------------------------------------------------
// Render: the initiate step + the machine-stable validation gates
// ---------------------------------------------------------------------------

test("the enrollment journey renders the initiate step with labeled fields and the stepper", () => {
  const journey = initialEnrollmentJourney(TENANT_A);
  renderEnrollment(journey, undefined);

  expect(screen.getByRole("region", { name: "Devices — Enroll devices" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  // The stepper shows the four canonical stages with the current one marked
  const stepper = screen.getByRole("list", { name: "Journey progress" });
  expect(within(stepper).getByText("Initiate")).toBeTruthy();
  expect(within(stepper).getByText("Review")).toBeTruthy();
  expect(within(stepper).getByText("Confirm")).toBeTruthy();
  expect(within(stepper).getByText("Verified")).toBeTruthy();
  // The initiate fields are labeled
  expect(screen.getByLabelText("Device ID")).toBeTruthy();
  expect(screen.getByLabelText("Device class (adapter family)")).toBeTruthy();
  expect(screen.getByLabelText("Manufacturer")).toBeTruthy();
  expect(screen.getByLabelText("Model")).toBeTruthy();
  expect(screen.getByLabelText("Ownership type")).toBeTruthy();
  // Continue is disabled until the draft is complete (the pure VM's gate)
  expect((screen.getByRole("button", { name: "Continue to review" }) as HTMLButtonElement).disabled).toBe(true);
});

test("the initiate gate surfaces the machine-stable field failures verbatim", () => {
  const journey = initialEnrollmentJourney(TENANT_A);
  renderEnrollment(journey, undefined);
  // The empty draft's failures are listed with their machine-stable reasons
  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("Device ID (/deviceId)")).toBeTruthy();
  expect(within(alert).getByText("Device class (adapter family) (/adapterFamily)")).toBeTruthy();
  expect(within(alert).getByText("Manufacturer (/hardware/manufacturer)")).toBeTruthy();
  expect(within(alert).getByText("Model (/hardware/model)")).toBeTruthy();
  expect(within(alert).getByText("Ownership type (/ownership/ownerType)")).toBeTruthy();
  // Every failure carries the machine-stable reason verbatim
  expect(within(alert).getAllByText("required").length).toBe(5);
});

// ---------------------------------------------------------------------------
// The full rendered journey: initiate -> review -> confirm -> verified
// ---------------------------------------------------------------------------

test("the FULL rendered enrollment journey walks to the VERIFIED terminal state with evidence", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];

  /**
   * The TestShell — the W091 shell's role in miniature: React state
   * holds ONLY the journey + the bound twin source; every intent flows
   * through the PURE view-model functions, and the submit converts the
   * command view into the REAL domain command (enroll -> create twin ->
   * first observation). The SCREEN stays presentational throughout.
   */
  function TestShell(): React.JSX.Element {
    const [journey, setJourney] = useState(initialEnrollmentJourney(TENANT_A));
    const [store, setStore] = useState<TwinStore>(() => createInMemoryTwinStore());
    const verification =
      journey.stage === "confirm" || journey.stage === "verified" || journey.stage === "failed"
        ? verifyEnrollment(SCOPE_A, store, DEV_A1)
        : undefined;
    return (
      <EnrollmentScreen
        journey={journey}
        verification={verification}
        adapterFamilies={FAMILIES}
        ownershipTypes={OWNERSHIP}
        onDraftChange={(patch: EnrollmentDraftPatch): void => {
          setJourney(updateEnrollmentDraft(journey, patch));
        }}
        onAdvance={(): void => {
          const result = advanceEnrollmentJourney(journey);
          if (result.ok) setJourney(result.state);
        }}
        onBack={(): void => {
          setJourney(backEnrollmentJourney(journey));
        }}
        onSubmit={(): void => {
          // THE BINDING SITE: the command view becomes the REAL domain
          // command — never an execution inside the screen.
          const command = enrollmentCommand(journey);
          if (command === undefined) throw new Error("command vanished");
          const enrolled = enrollDevice({
            tenantId: command.tenantId,
            deviceId: command.deviceId,
            adapterFamily: command.adapterFamily,
            hardware: command.hardware,
            ownership: {
              ownerType: command.ownership.ownerType as "CUSTOMER_OWNED",
              assignedTeam: command.ownership.assignedTeam,
            },
            at: T0,
            provenance: { correlationId: CORR },
          });
          if (!enrolled.ok) throw new Error(enrolled.error.message);
          const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR } });
          if (!created.ok) throw new Error(created.error.message);
          const observed = recordTwinObservations(
            created.twin,
            [obs("device.power", { batteryPercent: 88 }, atHour(1))],
            { at: atHour(1), correlationId: CORR },
          );
          if (!observed.ok) throw new Error(observed.error.message);
          const nextStore = createInMemoryTwinStore();
          nextStore.put(observed.twin);
          setStore(nextStore);
          setJourney(enrollmentOutcome(journey, { ok: true }));
        }}
        onOpenDoctor={(deviceId): void => {
          opened.push(deviceId as string);
        }}
        onCancel={(): void => {}}
      />
    );
  }

  render(<TestShell />);

  // --- initiate: type the complete draft through the form ---
  await user.type(screen.getByLabelText("Device ID"), "dev_testdevice00a1");
  await user.selectOptions(screen.getByLabelText("Device class (adapter family)"), "windows");
  await user.type(screen.getByLabelText("Manufacturer"), "Lenovo");
  await user.type(screen.getByLabelText("Model"), "ThinkPad X1");
  await user.type(screen.getByLabelText("Serial number (optional)"), "SN-ENROLL-1");
  await user.selectOptions(screen.getByLabelText("Ownership type"), "CUSTOMER_OWNED");
  await user.type(screen.getByLabelText("Assigned team (optional)"), "field-ops");

  // Continue is enabled now; the failure alert is gone
  expect((screen.getByRole("button", { name: "Continue to review" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continue to review" }));

  // --- review: the exact record + the required scope acknowledgment ---
  expect(screen.getByText("Review the enrollment")).toBeTruthy();
  expect(screen.getByText("dev_testdevice00a1")).toBeTruthy();
  expect(screen.getByText("Lenovo")).toBeTruthy();
  // The BYOD scope note is displayed for CUSTOMER_OWNED
  expect(screen.getByText(/Personal \(BYOD\) scope/i)).toBeTruthy();
  // The confirm button is gated on the scope acceptance
  expect((screen.getByRole("button", { name: "Confirm enrollment" }) as HTMLButtonElement).disabled).toBe(true);
  const scopeAlert = screen.getByRole("alert");
  expect(within(scopeAlert).getByText("Telemetry scope (/scopeAccepted)")).toBeTruthy();
  expect(within(scopeAlert).getByText("acceptance_required")).toBeTruthy();
  await user.click(screen.getByLabelText("I accept the telemetry scope for this device"));
  expect((screen.getByRole("button", { name: "Confirm enrollment" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Confirm enrollment" }));

  // --- confirm: the command view + the submit affordance ---
  expect(screen.getByText("Confirm the enrollment")).toBeTruthy();
  expect(screen.getByText("Enroll an existing fleet device")).toBeTruthy();
  expect(screen.getByText(/Nothing executes inside this screen/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Submit enrollment" }));

  // --- verified: the terminal state with the three checks + evidence ---
  expect(screen.getByText("Enrollment verified")).toBeTruthy();
  expect(screen.getAllByText(/Device identity recorded in your fleet — Healthy/).length).toBe(1);
  expect(screen.getAllByText(/First observation received from the device — Healthy/).length).toBe(1);
  expect(screen.getAllByText(/Append-only evidence trail started — Healthy/).length).toBe(1);
  // The evidence block: enrolledAt, telemetry, revision trail (the twin's
  // revision log also carries the T0 instants — all evidence, verbatim)
  expect(screen.getByText("Enrollment evidence")).toBeTruthy();
  expect(screen.getAllByText("2026-01-01T00:00:00Z").length).toBeGreaterThan(0);
  expect(screen.getByText(/Revision trail/)).toBeTruthy();
  // The hand-off to Device Doctor is offered
  await user.click(screen.getByRole("button", { name: "Open Device Doctor" }));
  expect(opened).toEqual(["dev_testdevice00a1"]);
});

// ---------------------------------------------------------------------------
// The failed path (domain refusal) + recovery back to review
// ---------------------------------------------------------------------------

test("the failed path renders the machine-stable refusal and recovers back to review", async () => {
  const user = userEvent.setup();
  const harness = journeyHarness();
  for (const patch of completeDraftPatches()) harness.apply(patch);
  harness.advance(); // -> review
  harness.apply({ scopeAccepted: true });
  harness.advance(); // -> confirm
  harness.outcome(false); // the domain refused

  renderEnrollment(harness.state, verifyEnrollment(SCOPE_A, realTwinSource(), DEV_A1), {
    onBack: harness.back,
  });
  expect(screen.getByText("The enrollment was refused")).toBeTruthy();
  expect(screen.getByText("enrollment_refused")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Back to review" }));
  expect(harness.state.stage).toBe("review");
});

// ---------------------------------------------------------------------------
// The pure command-view discipline (no execution in the screen)
// ---------------------------------------------------------------------------

test("the command view is only derivable from a complete, scope-accepted journey", () => {
  const harness = journeyHarness();
  expect(enrollmentCommand(harness.state)).toBeUndefined();
  for (const patch of completeDraftPatches()) harness.apply(patch);
  expect(enrollmentCommand(harness.state)).toBeUndefined(); // scope not accepted yet
  harness.apply({ scopeAccepted: true });
  const command = enrollmentCommand(harness.state);
  expect(command).toBeDefined();
  if (command === undefined) throw new Error("unreachable");
  expect(command.deviceId as string).toBe("dev_testdevice00a1");
  expect(command.scopeAccepted).toBe(true);
});

test("verification derives the three checks from the REAL twin source (unverified without observations)", () => {
  // A twin with NO observations yet: enrolled + trail, but no first observation
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    adapterFamily: "windows",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad X1" },
    ownership: { ownerType: "FLEET_PURCHASED" },
    at: T0,
    provenance: { correlationId: CORR },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR } });
  if (!created.ok) throw new Error(created.error.message);
  const store = createInMemoryTwinStore();
  store.put(created.twin);

  const verification = verifyEnrollment(SCOPE_A, store, DEV_A1);
  expect(verification.status).toBe("unverified");
  expect(verification.checks.find((check: { id: string }) => check.id === "device_enrolled")?.state).toBe("met");
  expect(verification.checks.find((check: { id: string }) => check.id === "first_observation")?.state).toBe("unmet");

  // A foreign/unknown device is indistinguishable from an absent one
  const unknown = verifyEnrollment(SCOPE_A, store, asDeviceId("dev_missing0000000"));
  expect(unknown.status).toBe("unknown_device");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the enrollment screen renders byte-identical static markup for the same journey state", () => {
  const harness = journeyHarness();
  for (const patch of completeDraftPatches()) harness.apply(patch);
  harness.advance();
  harness.apply({ scopeAccepted: true });

  const props = {
    journey: harness.state,
    verification: undefined,
    adapterFamilies: FAMILIES,
    ownershipTypes: OWNERSHIP,
    onDraftChange: (): void => {},
    onAdvance: (): void => {},
    onBack: (): void => {},
    onSubmit: (): void => {},
    onOpenDoctor: (): void => {},
    onCancel: (): void => {},
  };
  expect(renderToStaticMarkup(createElement(EnrollmentScreen, props))).toBe(
    renderToStaticMarkup(createElement(EnrollmentScreen, props)),
  );

  const emptyProps = { ...props, journey: initialEnrollmentJourney(TENANT_A) };
  expect(renderToStaticMarkup(createElement(EnrollmentScreen, emptyProps))).toBe(
    renderToStaticMarkup(createElement(EnrollmentScreen, emptyProps)),
  );
});
