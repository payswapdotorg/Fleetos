/**
 * W145 web-device — the DECLARED-IMPORT view-model tests.
 *
 * The machine proof of the work order's first contract: the
 * DECLARED/OBSERVED provenance separation (a declared record is never
 * presented as observed), the import validation paths, and the honest
 * duplicate paths — including the structural proof over the REAL
 * `@fleetos/device-model` (the binding site's exact domain path: the
 * command view's provenance recorded verbatim through `enrollDevice`).
 *
 * Deterministic: every timestamp is injected (T0 anchors); no clock, no
 * entropy, no I/O.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asUserId } from "@fleetos/contracts";
import {
  DECLARED_ADAPTER_FAMILY,
  DECLARED_IMPORT_PROVENANCE_REASON,
  advanceDeclaredImportJourney,
  backDeclaredImportJourney,
  declaredImportCommand,
  declaredImportOutcome,
  declaredImportReview,
  declaredRecordBy,
  deviceRecordProvenance,
  initialDeclaredImportJourney,
  isDeclaredDeviceRecord,
  reviewDeclaredDeviceDuplicates,
  updateDeclaredDeviceDraft,
  validateDeclaredDeviceDraft,
  verifyDeclaredImport,
} from "../src/index";
import type {
  DeclaredDeviceDraft,
  DeclaredImportJourneyState,
} from "../src/index";
import { createInMemoryTwinStore, createTwin, enrollDevice } from "@fleetos/device-model";
import type { DeviceTwinSource } from "../src/index";
import { DEV_A1, SCOPE_A, SCOPE_B, TENANT_A, T0, twinFixture } from "./helpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-01-02T00:00:00Z";
const CORR = asCorrelationId("cor_w145declared1");
const USER = asUserId("usr_testuser00001");
const DECLARED_ID = asDeviceId("dev_w145declared01");

/** A complete, valid declared-record draft. */
function completeDraft(): DeclaredDeviceDraft {
  return {
    tenantId: TENANT_A,
    deviceId: "dev_w145newrecord01",
    hardware: {
      manufacturer: "Dell",
      model: "Latitude 5450",
      serialNumber: "SN-W145-NEW",
      assetTag: "ASSET-W145",
    },
    ownership: { ownerType: "FLEET_PURCHASED", assignedTeam: "depot" },
    provenanceAcknowledged: false,
    duplicateSerialAcknowledged: false,
  };
}

/** An acknowledged, ready-to-confirm journey state for a fresh tenant. */
function readyJourney(): DeclaredImportJourneyState {
  return {
    stage: "review",
    draft: { ...completeDraft(), provenanceAcknowledged: true },
  };
}

/** A REAL twin-like carrying the DECLARED marker (the command contract). */
function declaredTwinLike(): Parameters<typeof deviceRecordProvenance>[0] {
  return {
    tenantId: TENANT_A,
    deviceId: DECLARED_ID,
    revision: 1,
    identity: {
      lifecycleState: "ENROLL",
      enrolledAt: T0,
      enrollment: {
        adapterFamily: "declared",
        hardware: { manufacturer: "Dell", model: "Latitude 5450" },
        provenance: {
          actor: { kind: "user", userId: USER },
          reason: DECLARED_IMPORT_PROVENANCE_REASON,
        },
      },
      ownership: { ownerType: "FLEET_PURCHASED", assignedAt: T0 },
    },
    telemetry: { lastObservedAt: null, observationCount: 0 },
    securityPosture: { postureSummary: "UNKNOWN", findingCount: 0 },
    workload: { assignedWorkloadIds: [] },
    actions: { activeActionIds: [], recoveryState: "NONE" },
  };
}

// ---------------------------------------------------------------------------
// The provenance derivation (the marking — never conflated)
// ---------------------------------------------------------------------------

test("a twin carrying the declared-import marker derives DECLARED", () => {
  expect(deviceRecordProvenance(declaredTwinLike())).toBe("DECLARED");
  expect(isDeclaredDeviceRecord(declaredTwinLike())).toBe(true);
});

test("an agent-path twin-like WITHOUT provenance derives OBSERVED (the conservative default)", () => {
  const agentTwin = {
    ...declaredTwinLike(),
    identity: {
      ...declaredTwinLike().identity,
      enrollment: {
        adapterFamily: "windows",
        hardware: { manufacturer: "Lenovo", model: "ThinkPad X1" },
      },
    },
  };
  expect(deviceRecordProvenance(agentTwin)).toBe("OBSERVED");
  expect(isDeclaredDeviceRecord(agentTwin)).toBe(false);
});

test("a provenance reason that is NOT the marker derives OBSERVED (no free-form conflation)", () => {
  const lookalike = {
    ...declaredTwinLike(),
    identity: {
      ...declaredTwinLike().identity,
      enrollment: {
        adapterFamily: "declared",
        hardware: { manufacturer: "Dell", model: "Latitude 5450" },
        provenance: { actor: { kind: "user", userId: USER }, reason: "declared-import" },
      },
    },
  };
  expect(deviceRecordProvenance(lookalike)).toBe("OBSERVED");
});

test("declaredRecordBy surfaces the declaring user only for DECLARED records", () => {
  expect(declaredRecordBy(declaredTwinLike())).toBe(USER);
  const agentTwin = declaredTwinLike();
  expect(
    declaredRecordBy({
      ...agentTwin,
      identity: {
        ...agentTwin.identity,
        enrollment: {
          adapterFamily: "windows",
          hardware: { manufacturer: "Lenovo", model: "ThinkPad X1" },
          provenance: { actor: { kind: "user", userId: USER }, reason: "some-other-reason" },
        },
      },
    }),
  ).toBeUndefined();
  expect(
    declaredRecordBy({
      ...agentTwin,
      identity: {
        ...agentTwin.identity,
        enrollment: {
          adapterFamily: "declared",
          hardware: { manufacturer: "Lenovo", model: "ThinkPad X1" },
          provenance: { actor: { kind: "system" }, reason: DECLARED_IMPORT_PROVENANCE_REASON },
        },
      },
    }),
  ).toBeUndefined();
});

test("the REAL @fleetos/device-model path satisfies the marking contract structurally", () => {
  // The binding site's EXACT domain path with the command's provenance
  // recorded verbatim: enrollDevice + createTwin.
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: DECLARED_ID,
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: { manufacturer: "Dell", model: "Latitude 5450", serialNumber: "SN-W145-01" },
    ownership: { ownerType: "FLEET_PURCHASED", assignedTeam: "depot" },
    at: NOW,
    provenance: {
      correlationId: CORR,
      actor: { kind: "user", userId: USER },
      reason: DECLARED_IMPORT_PROVENANCE_REASON,
    },
  });
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: NOW, correlationId: CORR } });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error.message);

  // The REAL DeviceTwin derives DECLARED through the seam (the structural
  // proof: the real StoredProvenance satisfies the seam's shape).
  expect(deviceRecordProvenance(created.twin)).toBe("DECLARED");
  expect(declaredRecordBy(created.twin)).toBe(USER);
  expect(created.twin.telemetry.lastObservedAt).toBe(null);
  expect(created.twin.telemetry.observationCount).toBe(0);
});

// ---------------------------------------------------------------------------
// Validation paths (machine-stable reasons)
// ---------------------------------------------------------------------------

test("an empty draft fails every required field with the exact reason codes", () => {
  const failures = validateDeclaredDeviceDraft(initialDeclaredImportJourney(TENANT_A).draft);
  expect(failures.map((f) => [f.path, f.reason])).toEqual([
    ["/deviceId", "required"],
    ["/hardware/manufacturer", "required"],
    ["/hardware/model", "required"],
    ["/ownership/ownerType", "required"],
  ]);
});

test("a complete draft passes validation; whitespace-only fields fail", () => {
  expect(validateDeclaredDeviceDraft(completeDraft())).toHaveLength(0);
  const blanked = {
    ...completeDraft(),
    hardware: { ...completeDraft().hardware, manufacturer: "   " },
  };
  expect(validateDeclaredDeviceDraft(blanked)).toEqual([
    { path: "/hardware/manufacturer", reason: "required" },
  ]);
});

test("draft patches update fields and acknowledgments immutably", () => {
  const initial = initialDeclaredImportJourney(TENANT_A);
  const updated = updateDeclaredDeviceDraft(initial, {
    deviceId: "dev_w145newrecord01",
    hardware: { manufacturer: "Dell" },
    provenanceAcknowledged: true,
  });
  expect(updated).not.toBe(initial);
  expect(initial.draft.provenanceAcknowledged).toBe(false);
  expect(updated.draft.deviceId).toBe("dev_w145newrecord01");
  expect(updated.draft.hardware.manufacturer).toBe("Dell");
  expect(updated.draft.provenanceAcknowledged).toBe(true);
});

// ---------------------------------------------------------------------------
// The honest duplicate paths
// ---------------------------------------------------------------------------

/** A REAL store seeded with one agent-observed tenant-A device. */
function seededSource(): DeviceTwinSource {
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

test("a device id already in the tenant is a BLOCKING duplicate, reported with the existing record's provenance", () => {
  const source = seededSource();
  const findings = reviewDeclaredDeviceDuplicates(SCOPE_A, source, {
    ...completeDraft(),
    deviceId: DEV_A1 as string,
  });
  expect(findings).toHaveLength(1);
  expect(findings[0].kind).toBe("duplicate_device_id");
  expect(findings[0].deviceId).toBe(DEV_A1);
  expect(findings[0].provenance).toBe("OBSERVED");
  expect(findings[0].displayName).toBe("Lenovo ThinkPad X1");
});

test("a same-serial record is an ACKNOWLEDGEABLE duplicate (case-insensitive)", () => {
  const source = seededSource();
  const findings = reviewDeclaredDeviceDuplicates(SCOPE_A, source, {
    ...completeDraft(),
    hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
  });
  expect(findings).toHaveLength(1);
  expect(findings[0].kind).toBe("duplicate_serial_number");
  expect(findings[0].deviceId).toBe(DEV_A1);
});

test("the deviceId collision outranks and precedes the serial collision", () => {
  const source = seededSource();
  const findings = reviewDeclaredDeviceDuplicates(SCOPE_A, source, {
    ...completeDraft(),
    deviceId: DEV_A1 as string,
    hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
  });
  expect(findings).toHaveLength(2);
  expect(findings[0].kind).toBe("duplicate_device_id");
  expect(findings[1].kind).toBe("duplicate_serial_number");
});

test("duplicates NEVER cross tenants (the acting scope partitions everything)", () => {
  const source = seededSource();
  const findings = reviewDeclaredDeviceDuplicates(SCOPE_B, source, {
    ...completeDraft(),
    deviceId: DEV_A1 as string,
    hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
  });
  expect(findings).toHaveLength(0);
});

test("a refused scope grammar yields the deterministic empty review (no data, no leak)", () => {
  const source = seededSource();
  const findings = reviewDeclaredDeviceDuplicates(
    { tenantId: "" as never },
    source,
    { ...completeDraft(), deviceId: DEV_A1 as string },
  );
  expect(findings).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The journey machine (pure transitions)
// ---------------------------------------------------------------------------

test("enter -> review requires complete fields", () => {
  const source = seededSource();
  const blocked = advanceDeclaredImportJourney(SCOPE_A, source, initialDeclaredImportJourney(TENANT_A));
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.failures.map((f) => f.path)).toContain("/deviceId");
  }

  const advanced = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "enter",
    draft: completeDraft(),
  });
  expect(advanced.ok).toBe(true);
  if (advanced.ok) expect(advanced.state.stage).toBe("review");
});

test("review -> confirm requires the provenance acknowledgment", () => {
  const source = seededSource();
  const refused = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "review",
    draft: completeDraft(),
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(
      refused.failures.find((f) => f.path === "/provenanceAcknowledged")?.reason,
    ).toBe("acknowledgment_required");
  }
});

test("review -> confirm refuses a blocking deviceId duplicate even when acknowledged", () => {
  const source = seededSource();
  const refused = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "review",
    draft: {
      ...completeDraft(),
      deviceId: DEV_A1 as string,
      provenanceAcknowledged: true,
      duplicateSerialAcknowledged: true,
    },
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(
      refused.failures.find((f) => f.path === "/duplicates/deviceId")?.reason,
    ).toBe("duplicate_device_id");
  }
});

test("review -> confirm requires the serial acknowledgment only when a same-serial record exists", () => {
  const freshStore = createInMemoryTwinStore();
  const noSerialCollision = advanceDeclaredImportJourney(
    SCOPE_A,
    freshStore,
    readyJourney(),
  );
  expect(noSerialCollision.ok).toBe(true);

  const source = seededSource();
  const withSerial = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "review",
    draft: {
      ...completeDraft(),
      hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
      provenanceAcknowledged: true,
    },
  });
  expect(withSerial.ok).toBe(false);
  if (!withSerial.ok) {
    expect(
      withSerial.failures.find((f) => f.path === "/duplicates/serialNumber")?.reason,
    ).toBe("duplicate_serial_acknowledgment_required");
  }
  const acknowledged = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "review",
    draft: {
      ...completeDraft(),
      hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
      provenanceAcknowledged: true,
      duplicateSerialAcknowledged: true,
    },
  });
  expect(acknowledged.ok).toBe(true);
});

test("terminal stages refuse to advance; back navigates; the outcome lands", () => {
  const source = seededSource();
  const terminal = advanceDeclaredImportJourney(SCOPE_A, source, {
    stage: "confirm",
    draft: completeDraft(),
  });
  expect(terminal.ok).toBe(false);
  if (!terminal.ok) {
    expect(terminal.failures).toEqual([{ path: "/stage", reason: "terminal_stage" }]);
  }

  expect(backDeclaredImportJourney({ stage: "review", draft: completeDraft() }).stage).toBe("enter");
  expect(backDeclaredImportJourney({ stage: "confirm", draft: completeDraft() }).stage).toBe("review");
  expect(backDeclaredImportJourney({ stage: "refused", draft: completeDraft() }).stage).toBe("review");

  const submitted = { stage: "confirm" as const, draft: completeDraft() };
  expect(declaredImportOutcome(submitted, { ok: true }).stage).toBe("recorded");
  expect(declaredImportOutcome(submitted, { ok: false, reason: "x" }).stage).toBe("refused");
  // The outcome only applies at confirm.
  expect(declaredImportOutcome(readyJourney(), { ok: true }).stage).toBe("review");
});

// ---------------------------------------------------------------------------
// The command view (an INTENT, never an execution)
// ---------------------------------------------------------------------------

test("the command view refuses to fabricate until the journey is fully ready", () => {
  const source = seededSource();
  expect(
    declaredImportCommand(SCOPE_A, source, initialDeclaredImportJourney(TENANT_A), {
      now: NOW,
      correlationId: CORR,
      declaredBy: USER,
    }),
  ).toBeUndefined();
  expect(
    declaredImportCommand(SCOPE_A, source, { stage: "review", draft: completeDraft() }, {
      now: NOW,
      correlationId: CORR,
      declaredBy: USER,
    }),
  ).toBeUndefined(); // provenance not acknowledged
  expect(
    declaredImportCommand(SCOPE_A, source, readyJourney(), {
      now: "",
      correlationId: CORR,
      declaredBy: USER,
    }),
  ).toBeUndefined(); // missing injected instant
});

test("the command view carries the exact DECLARED provenance contract", () => {
  const source = seededSource();
  const command = declaredImportCommand(SCOPE_A, source, readyJourney(), {
    now: NOW,
    correlationId: CORR,
    declaredBy: USER,
  });
  expect(command).toBeDefined();
  if (command === undefined) throw new Error("command must be defined");
  expect(command.tenantId).toBe(TENANT_A);
  expect(command.deviceId).toBe("dev_w145newrecord01");
  expect(command.adapterFamily).toBe(DECLARED_ADAPTER_FAMILY);
  expect(command.declaredAt).toBe(NOW);
  expect(command.declaredBy).toBe(USER);
  expect(command.enrollmentProvenance).toEqual({
    correlationId: CORR,
    reason: DECLARED_IMPORT_PROVENANCE_REASON,
    actor: { kind: "user", userId: USER },
  });
  // Whitespace-only optional fields are normalized away.
  const padded = updateDeclaredDeviceDraft(readyJourney(), {
    hardware: { serialNumber: "   ", assetTag: "  TAG-1  " },
  });
  const paddedCommand = declaredImportCommand(SCOPE_A, source, padded, {
    now: NOW,
    correlationId: CORR,
    declaredBy: USER,
  });
  if (paddedCommand === undefined) throw new Error("padded command must be defined");
  expect(paddedCommand.hardware.serialNumber).toBeUndefined();
  expect(paddedCommand.hardware.assetTag).toBe("TAG-1");
});

test("the command view is FAIL-CLOSED against a duplicate that appeared after the review step", () => {
  const store = createInMemoryTwinStore();
  const racingId = "dev_w145racingrec1";
  const options = { now: NOW, correlationId: CORR, declaredBy: USER };
  const journey: DeclaredImportJourneyState = {
    stage: "review",
    draft: { ...completeDraft(), deviceId: racingId, provenanceAcknowledged: true },
  };
  // Before the race: the fresh store has no duplicates, the command exists.
  expect(declaredImportCommand(SCOPE_A, store, journey, options)).toBeDefined();

  // A racing import lands the SAME device id after the review step.
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: asDeviceId(racingId),
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: { manufacturer: "Dell", model: "Latitude 5450" },
    ownership: { ownerType: "FLEET_PURCHASED" },
    at: NOW,
    provenance: { correlationId: CORR, reason: DECLARED_IMPORT_PROVENANCE_REASON },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: NOW, correlationId: CORR } });
  if (!created.ok) throw new Error(created.error.message);
  store.put(created.twin);

  // The SAME journey state now refuses to fabricate a command (fail-closed).
  expect(declaredImportCommand(SCOPE_A, store, journey, options)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The review projection
// ---------------------------------------------------------------------------

test("the review projection reports duplicates and readiness honestly", () => {
  const source = seededSource();
  const clean = declaredImportReview(SCOPE_A, source, readyJourney());
  expect(clean.duplicates).toHaveLength(0);
  expect(clean.blockingDuplicate).toBe(false);
  expect(clean.provenance).toBe("DECLARED");
  expect(clean.ready).toBe(true);

  const colliding = declaredImportReview(SCOPE_A, source, {
    stage: "review",
    draft: {
      ...completeDraft(),
      deviceId: DEV_A1 as string,
      provenanceAcknowledged: true,
    },
  });
  expect(colliding.blockingDuplicate).toBe(true);
  expect(colliding.ready).toBe(false);

  const serialOnly = declaredImportReview(SCOPE_A, source, {
    stage: "review",
    draft: {
      ...completeDraft(),
      hardware: { ...completeDraft().hardware, serialNumber: "sn-shared-001" },
      provenanceAcknowledged: true,
    },
  });
  expect(serialOnly.blockingDuplicate).toBe(false);
  expect(serialOnly.serialAcknowledged).toBe(false);
  expect(serialOnly.ready).toBe(false);
});

// ---------------------------------------------------------------------------
// The recorded-outcome verification (and the conflation detector)
// ---------------------------------------------------------------------------

test("verifyDeclaredImport: unknown device (no existence side channel)", () => {
  const verification = verifyDeclaredImport(SCOPE_A, seededSource(), asDeviceId("dev_nosuch000001"));
  expect(verification.status).toBe("unknown_device");
  expect(verification.checks.every((check) => check.state === "unmet")).toBe(true);
});

test("verifyDeclaredImport: a landed DECLARED record passes all three checks", () => {
  const store = createInMemoryTwinStore();
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: DECLARED_ID,
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: { manufacturer: "Dell", model: "Latitude 5450" },
    ownership: { ownerType: "FLEET_PURCHASED" },
    at: NOW,
    provenance: { correlationId: CORR, reason: DECLARED_IMPORT_PROVENANCE_REASON },
  });
  if (!enrolled.ok) throw new Error(enrolled.error.message);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: NOW, correlationId: CORR } });
  if (!created.ok) throw new Error(created.error.message);
  store.put(created.twin);

  const verification = verifyDeclaredImport(SCOPE_A, store, DECLARED_ID);
  expect(verification.status).toBe("declared");
  expect(verification.checks.map((check) => [check.id, check.state])).toEqual([
    ["record_present", "met"],
    ["marked_declared", "met"],
    ["no_fabricated_observations", "met"],
  ]);
  expect(verification.evidence.provenance).toBe("DECLARED");
  expect(verification.evidence.observationCount).toBe(0);
});

test("verifyDeclaredImport: the CONFLATION DETECTOR — a record without the mark reports present_not_declared", () => {
  // A binding site that drops the provenance contract: agent-path enrollment.
  const verification = verifyDeclaredImport(SCOPE_A, seededSource(), DEV_A1);
  expect(verification.status).toBe("present_not_declared");
  const marked = verification.checks.find((check) => check.id === "marked_declared");
  expect(marked?.state).toBe("unmet");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the same (scope, source, state, options) always produce the same command + review", () => {
  const sourceOne = seededSource();
  const sourceTwo = seededSource();
  const commandOne = declaredImportCommand(SCOPE_A, sourceOne, readyJourney(), {
    now: NOW,
    correlationId: CORR,
    declaredBy: USER,
  });
  const commandTwo = declaredImportCommand(SCOPE_A, sourceTwo, readyJourney(), {
    now: NOW,
    correlationId: CORR,
    declaredBy: USER,
  });
  expect(commandOne).toEqual(commandTwo);
  expect(
    declaredImportReview(SCOPE_A, sourceOne, readyJourney()),
  ).toEqual(declaredImportReview(SCOPE_A, sourceTwo, readyJourney()));
});
