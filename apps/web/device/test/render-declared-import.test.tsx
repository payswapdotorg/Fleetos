/**
 * W145 web-device — browser-facing RENDER tests for the
 * DeclaredImportScreen (the manual device-record entry path).
 *
 * The machine proofs of the declared-import UX contract: the journey
 * stages render from REAL view-model state (enter -> review ->
 * confirm -> recorded | refused), the DECLARED provenance is visible
 * from the first pixel, the honest duplicate report surfaces the
 * machine-stable reasons verbatim, the acknowledgment gates are real
 * controls, and the recorded terminal state shows the verification
 * checks + evidence — never a fire-and-forget form. Deterministic:
 * same props -> byte-identical markup.
 */

import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { asCorrelationId, asDeviceId, asUserId } from "@fleetos/contracts";
import {
  DeclaredImportScreen,
  advanceDeclaredImportJourney,
  declaredImportCommand,
  declaredImportReview,
  initialDeclaredImportJourney,
  updateDeclaredDeviceDraft,
  verifyDeclaredImport,
} from "../src/index";
import type {
  DeclaredImportJourneyState,
  DeclaredImportReviewView,
  DeclaredImportVerification,
} from "../src/index";
import { createInMemoryTwinStore, createTwin, enrollDevice } from "@fleetos/device-model";
import type { TwinStore } from "@fleetos/device-model";
import { DEV_A1, SCOPE_A, TENANT_A, atHour, twinFixture } from "./helpers";

afterEach(() => {
  cleanup();
});

const NOW = atHour(72);
const CORR = asCorrelationId("cor_w145renders01");
const USER = asUserId("usr_testuser00001");
const DECLARED_ID = asDeviceId("dev_w145declared01");

const OWNERSHIP_TYPES = [
  { value: "CUSTOMER_OWNED", label: "Customer-owned (incl. BYOD)" },
  { value: "LEASED", label: "Leased" },
  { value: "FLEET_PURCHASED", label: "Fleet-purchased" },
  { value: "THIRD_PARTY_SUPPLIED", label: "Third-party supplied" },
] as const;

/** A store with one agent-observed device (for duplicate paths). */
function populatedStore(): TwinStore {
  const store = createInMemoryTwinStore();
  store.put(
    twinFixture({
      tenantId: TENANT_A,
      deviceId: DEV_A1,
      manufacturer: "Lenovo",
      model: "ThinkPad X1",
      serialNumber: "SN-SHARED-001",
    }),
  );
  return store;
}

/** A complete, acknowledged, review-stage journey (ready to confirm). */
function completeJourney(): DeclaredImportJourneyState {
  let journey = initialDeclaredImportJourney(TENANT_A);
  journey = updateDeclaredDeviceDraft(journey, {
    deviceId: DECLARED_ID as string,
    hardware: { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "SN-W145-NEW" },
    ownership: { ownerType: "FLEET_PURCHASED", assignedTeam: "depot" },
    provenanceAcknowledged: true,
  });
  return { ...journey, stage: "review" };
}

/** The shell's review computation (the same function the runtime calls). */
function reviewOf(
  store: TwinStore,
  journey: DeclaredImportJourneyState,
): DeclaredImportReviewView {
  const review = declaredImportReview(SCOPE_A, store, journey);
  if (review === undefined) throw new Error("review must be defined");
  return review;
}

const BASE_PROPS = {
  ownershipTypes: [...OWNERSHIP_TYPES],
  onDraftChange: (): void => {},
  onAdvance: (): void => {},
  onBack: (): void => {},
  onSubmit: (): void => {},
  onOpenRoster: (): void => {},
  onCancel: (): void => {},
};

// ---------------------------------------------------------------------------
// The enter step (the form, provenance-flagged from the first pixel)
// ---------------------------------------------------------------------------

test("the enter step renders the declared-record form with the DECLARED badge and labeled fields", () => {
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: initialDeclaredImportJourney(TENANT_A),
      review: undefined,
      verification: undefined,
    }),
  );

  expect(screen.getByRole("region", { name: "Devices — Declare a device" })).toBeTruthy();
  // The DECLARED badge is visible in the screen's header from the start.
  expect(screen.getAllByText("Declared").length).toBeGreaterThan(0);
  // The form fields are labeled.
  expect(screen.getByLabelText("Device ID")).toBeTruthy();
  expect(screen.getByLabelText("Manufacturer")).toBeTruthy();
  expect(screen.getByLabelText("Model")).toBeTruthy();
  expect(screen.getByLabelText("Serial number (optional)")).toBeTruthy();
  expect(screen.getByLabelText("Asset tag (optional)")).toBeTruthy();
  expect(screen.getByLabelText("Ownership type")).toBeTruthy();
  expect(screen.getByLabelText("Assigned team (optional)")).toBeTruthy();
  // The journey stepper is present with the declared stages.
  expect(screen.getByText("Enter")).toBeTruthy();
  expect(screen.getByText("Review")).toBeTruthy();
  expect(screen.getByText("Confirm")).toBeTruthy();
  expect(screen.getByText("Recorded")).toBeTruthy();
  // Continue is disabled until the fields are complete.
  expect(screen.getByRole("button", { name: "Continue to review" }).hasAttribute("disabled")).toBe(
    true,
  );
});

test("the enter step surfaces the machine-stable field failures verbatim", () => {
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: initialDeclaredImportJourney(TENANT_A),
      review: undefined,
      verification: undefined,
    }),
  );
  expect(screen.getByText("The declared import cannot continue yet")).toBeTruthy();
  // The reason surfaces on TWO presentation surfaces: the per-field
  // error hints and the summary alert's failure list.
  expect(screen.getAllByText("required").length).toBe(8);
});

test("typing routes through onDraftChange (fully controlled, no business truth in React state)", async () => {
  const patches: string[] = [];
  const user = userEvent.setup();
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: initialDeclaredImportJourney(TENANT_A),
      review: undefined,
      verification: undefined,
      onDraftChange: (patch): void => {
        if (patch.deviceId !== undefined) patches.push(patch.deviceId);
      },
    }),
  );
  await user.type(screen.getByLabelText("Device ID"), "dev_w145");
  expect(patches.join("")).toBe("dev_w145");
});

// ---------------------------------------------------------------------------
// The review step (the exact record + the honest duplicate report)
// ---------------------------------------------------------------------------

test("the review step shows the exact record, the provenance acknowledgment, and gates the confirm", () => {
  const store = createInMemoryTwinStore();
  const journey = completeJourney();
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey,
      review: reviewOf(store, journey),
      verification: undefined,
    }),
  );
  // The exact record values.
  expect(screen.getByText("dev_w145declared01")).toBeTruthy();
  expect(screen.getAllByText("Dell").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Latitude 5450").length).toBeGreaterThan(0);
  expect(screen.getByText("SN-W145-NEW")).toBeTruthy();
  expect(screen.getByText("Fleet-purchased")).toBeTruthy();
  // The DECLARED meaning card with its acknowledgment.
  expect(screen.getByText("What a DECLARED record means")).toBeTruthy();
  expect(
    screen.getByLabelText("I understand this is a DECLARED record, not an agent-observed one"),
  ).toBeTruthy();
  // No duplicate report when the fleet has no collisions.
  expect(screen.queryByText("A record with the same serial number exists")).toBeNull();
  // The confirm button is enabled (the journey is acknowledged + clean).
  const confirm = screen.getByRole("button", { name: "Confirm declared import" });
  expect(confirm.hasAttribute("disabled")).toBe(false);
});

test("the review step renders the BLOCKING duplicate report verbatim (never overwrite, never merge)", () => {
  const store = populatedStore();
  const journey = updateDeclaredDeviceDraft(completeJourney(), {
    deviceId: DEV_A1 as string,
  });
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey,
      review: reviewOf(store, journey),
      verification: undefined,
    }),
  );
  expect(screen.getByText("This device id is already in your fleet")).toBeTruthy();
  expect(screen.getAllByText(/duplicate_device_id/).length).toBeGreaterThan(0);
  // The existing record's summary is shown with its own provenance
  // (displayName (deviceId) — provenance, one text element).
  expect(
    screen.getAllByText(/Lenovo ThinkPad X1 \(dev_testdevice00a1\) — Observed/).length,
  ).toBeGreaterThan(0);
  // The confirm stays gated.
  const confirm = screen.getByRole("button", { name: "Confirm declared import" });
  expect(confirm.hasAttribute("disabled")).toBe(true);
});

test("the review step renders the ACKNOWLEDGEABLE serial duplicate with its explicit gate", () => {
  const store = populatedStore();
  const journey = updateDeclaredDeviceDraft(completeJourney(), {
    hardware: { serialNumber: "sn-shared-001" },
  });
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey,
      review: reviewOf(store, journey),
      verification: undefined,
    }),
  );
  expect(screen.getByText("A record with the same serial number exists")).toBeTruthy();
  expect(
    screen.getByLabelText("This is a different device (the repeated serial number is intentional)"),
  ).toBeTruthy();
  // The machine-stable reason is surfaced verbatim while unacknowledged.
  expect(screen.getByText("duplicate_serial_acknowledgment_required")).toBeTruthy();
  // Gated until acknowledged.
  const confirm = screen.getByRole("button", { name: "Confirm declared import" });
  expect(confirm.hasAttribute("disabled")).toBe(true);
});

// ---------------------------------------------------------------------------
// The confirm + recorded steps (evidence visible — never fire-and-forget)
// ---------------------------------------------------------------------------

test("the confirm step renders the command summary and submits through onSubmit", () => {
  const store = createInMemoryTwinStore();
  const journey = completeJourney();
  let submitted = 0;
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: { ...journey, stage: "confirm" },
      review: reviewOf(store, journey),
      verification: undefined,
      onSubmit: (): void => {
        submitted += 1;
      },
    }),
  );
  expect(screen.getByText("Confirm the declared import")).toBeTruthy();
  expect(screen.getByText("Declare a device record (no agent)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Submit declared import" }));
  expect(submitted).toBe(1);
});

/** Execute the declared import (the binding site's path) and verify it. */
function recordedVerification(store: TwinStore): DeclaredImportVerification {
  const journey = completeJourney();
  const command = declaredImportCommand(SCOPE_A, store, journey, {
    now: atHour(50),
    correlationId: CORR,
    declaredBy: USER,
  });
  if (command === undefined) throw new Error("command must be defined");
  const enrolled = enrollDevice({
    tenantId: command.tenantId,
    deviceId: command.deviceId,
    adapterFamily: command.adapterFamily,
    hardware: command.hardware,
    ownership: { ownerType: "FLEET_PURCHASED", assignedTeam: "depot" },
    at: command.declaredAt,
    provenance: {
      correlationId: command.enrollmentProvenance.correlationId,
      actor: { kind: "user", userId: USER },
      reason: command.enrollmentProvenance.reason,
    },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: command.declaredAt, correlationId: CORR } });
  if (!created.ok) throw new Error(created.error.message);
  store.put(created.twin);
  return verifyDeclaredImport(SCOPE_A, store, DECLARED_ID);
}

test("the recorded step shows the verification checks + evidence, and continues to the roster", () => {
  const store = createInMemoryTwinStore();
  const verification = recordedVerification(store);
  let openedRoster = false;
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: { ...completeJourney(), stage: "recorded" },
      review: reviewOf(store, completeJourney()),
      verification,
      onOpenRoster: (): void => {
        openedRoster = true;
      },
    }),
  );

  expect(screen.getByText("Declared record verified")).toBeTruthy();
  expect(screen.getByText(/Declared record present in your fleet/)).toBeTruthy();
  expect(screen.getByText(/Record carries the DECLARED provenance mark/)).toBeTruthy();
  expect(screen.getByText(/No observations fabricated by the import/)).toBeTruthy();
  expect(screen.getByText("Declared-record evidence")).toBeTruthy();
  expect(screen.getByText("No observation yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open the device roster" }));
  expect(openedRoster).toBe(true);
});

test("the recorded step reports the CONFLATION DETECTOR outcome honestly", () => {
  const store = populatedStore();
  const verification = verifyDeclaredImport(SCOPE_A, store, DEV_A1);
  expect(verification.status).toBe("present_not_declared");
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: { ...completeJourney(), stage: "recorded" },
      review: reviewOf(store, completeJourney()),
      verification,
    }),
  );
  expect(
    screen.getByText(/does NOT carry the DECLARED mark/),
  ).toBeTruthy();
  expect(screen.getByText("Recorded — verification pending")).toBeTruthy();
});

test("the refused step renders the honest machine-stable refusal and recovers", () => {
  const store = createInMemoryTwinStore();
  let wentBack = false;
  render(
    createElement(DeclaredImportScreen, {
      ...BASE_PROPS,
      journey: { ...completeJourney(), stage: "refused" },
      review: reviewOf(store, completeJourney()),
      verification: undefined,
      onBack: (): void => {
        wentBack = true;
      },
    }),
  );
  expect(screen.getByText("The declared import was refused")).toBeTruthy();
  expect(screen.getByText("declared_import_refused")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
  expect(wentBack).toBe(true);
});

// ---------------------------------------------------------------------------
// The journey wiring (the machine's own transitions drive the props)
// ---------------------------------------------------------------------------

test("the journey machine + screen agree on the gate transitions", () => {
  const store = createInMemoryTwinStore();
  // enter -> review requires fields.
  const empty = advanceDeclaredImportJourney(SCOPE_A, store, initialDeclaredImportJourney(TENANT_A));
  expect(empty.ok).toBe(false);
  // review -> confirm with everything acknowledged succeeds.
  const advanced = advanceDeclaredImportJourney(SCOPE_A, store, completeJourney());
  expect(advanced.ok).toBe(true);
  if (advanced.ok) expect(advanced.state.stage).toBe("confirm");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the same journey props always produce byte-identical static markup", () => {
  const store = createInMemoryTwinStore();
  const journey = completeJourney();
  const props = {
    ...BASE_PROPS,
    journey,
    review: reviewOf(store, journey),
    verification: undefined,
  };
  const first = renderToStaticMarkup(createElement(DeclaredImportScreen, props));
  const second = renderToStaticMarkup(createElement(DeclaredImportScreen, props));
  expect(first).toBe(second);
});
