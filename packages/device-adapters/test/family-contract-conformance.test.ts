/**
 * W030 D5 contract-conformance tests — the family contracts built
 * AGAINST the frozen @fleetos/contracts surface, verified with the W003
 * fixture builders from @fleetos/contracts/testing.
 *
 * Fixture builders consumed here (and across the other W030 test files):
 *   makeTenantId, makeDeviceId, makeCorrelationId, makeTimestamp,
 *   makeIdempotencyKey, makeCommandEnvelope, makeObservationBatch,
 *   makeAdapterCapabilities, makeAdapterCapabilitiesSeeded, makeFleetError
 * plus the frozen helpers (assertSupported, isSupported, isDestructive,
 * validateCommand, validateObservationBatch, validateTenantRef,
 * toApiError) and the FIXTURE_TIME_ANCHOR.
 */

import { test, expect } from "bun:test";
import {
  ALL_ADAPTER_CAPABILITIES,
  assertSupported,
  isDestructive,
  isSupported,
  toApiError,
  validateCommand,
  validateObservationBatch,
  validateTenantRef,
  type CommandEnvelope,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeAdapterCapabilities,
  makeAdapterCapabilitiesSeeded,
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeObservationBatch,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { createCommandReceiptTracker } from "../src/commands";
import { createAdapterCommandDispatcher } from "../src/dispatch";
import { createAdapterRegistry } from "../src/registry";
import { commandTypeForCapability } from "../src/dispatch";
import {
  MOBILE_FAMILY_CAPABILITIES,
  PRINTER_COPIER_FAMILY_CAPABILITIES,
  createPrinterVendorModelDescriptor,
  validateMobileFamilyCapabilities,
  validatePrinterCopierFamilyCapabilities,
} from "../src/families";
import { createInMemoryIosSeam } from "../src/seams-inmemory-mobile";
import { createInMemoryPrinterCopierSeam } from "../src/seams-inmemory-printer";
import { createMobileFamilyAdapter, createPrinterCopierFamilyAdapter } from "../src/family-adapters";
import {
  mobileBatteryRecord,
  mobileLocationEvidenceRecord,
} from "../src/mobile-observations";
import { printerConsumableRecord, printerPageCountsRecord } from "../src/printer-observations";
import { createObservationCollector } from "../src/observations";
import { canonicalJson } from "../src/internal";

const DECLARED_AT = "2026-01-01T00:00:00Z";

// ---------------------------------------------------------------------------
// makeAdapterCapabilities <-> family profiles (contracts reuse)
// ---------------------------------------------------------------------------

test("conformance: makeAdapterCapabilities builds the family envelopes exactly", () => {
  const mobile = makeAdapterCapabilities({
    supported: ["identify", "observe", "diagnose", "enforce", "lock", "locate", "wipe", "update", "health"],
    unsupported: ["remediate", "reboot"],
  });
  const printer = makeAdapterCapabilities({
    supported: ["identify", "observe", "diagnose", "enforce", "health"],
    unsupported: ["remediate", "lock", "locate", "wipe", "reboot", "update"],
  });
  // The fixtures and the family envelope constants describe the SAME
  // support set for every normalized capability (the `false` form vs the
  // omitted form are equivalent per the frozen contracts).
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    expect(isSupported(capability, mobile)).toBe(isSupported(capability, MOBILE_FAMILY_CAPABILITIES));
    expect(isSupported(capability, printer)).toBe(isSupported(capability, PRINTER_COPIER_FAMILY_CAPABILITIES));
  }
  // A supported-only build is byte-identical to the envelope constant.
  const mobileSupportedOnly = makeAdapterCapabilities({
    supported: ["identify", "observe", "diagnose", "enforce", "lock", "locate", "wipe", "update", "health"],
  });
  expect(canonicalJson(mobileSupportedOnly)).toBe(canonicalJson(MOBILE_FAMILY_CAPABILITIES));
  // The frozen helpers read the printer fixture identically: lock/locate/
  // wipe are unsupported there regardless of grant.
  for (const capability of ["lock", "locate", "wipe"] as const) {
    expect(isSupported(capability, printer)).toBe(false);
    expect(assertSupported(capability, printer, true).ok).toBe(false);
  }
});

test("conformance: the frozen assertSupported drives the family refusal semantics", () => {
  // Mobile: wipe supported; without a grant the destructive assertion fails.
  expect(assertSupported("wipe", MOBILE_FAMILY_CAPABILITIES, false).ok).toBe(false);
  expect(assertSupported("wipe", MOBILE_FAMILY_CAPABILITIES, true).ok).toBe(true);
  expect(isDestructive("locate")).toBe(true); // location is destructive per contracts
  // Printer: wipe is NOT in the envelope — unsupported regardless of grant.
  const assertion = assertSupported("wipe", PRINTER_COPIER_FAMILY_CAPABILITIES, true);
  expect(assertion.ok).toBe(false);
  if (!assertion.ok) expect(assertion.reason).toBe("unsupported");
});

test("conformance: makeAdapterCapabilitiesSeeded subsets validate against the mobile envelope (deterministic fuzz)", () => {
  // 24 seeded capability sets: every subset of the 11 capabilities must
  // either sit inside the mobile envelope or be refused with exactly the
  // outside members — and the SAME seeds produce the SAME verdicts.
  const verdicts: string[] = [];
  for (let seed = 0; seed < 24; seed++) {
    const capabilities = makeAdapterCapabilitiesSeeded(`conf-w030-${seed}`);
    const validation = validateMobileFamilyCapabilities(capabilities);
    verdicts.push(`${seed}:${validation.ok ? "ok" : validation.capabilities.join("+")}`);
    if (!validation.ok) {
      for (const capability of validation.capabilities) {
        expect(isSupported(capability, MOBILE_FAMILY_CAPABILITIES)).toBe(false);
      }
    }
  }
  const repeat: string[] = [];
  for (let seed = 0; seed < 24; seed++) {
    const capabilities = makeAdapterCapabilitiesSeeded(`conf-w030-${seed}`);
    const validation = validateMobileFamilyCapabilities(capabilities);
    repeat.push(`${seed}:${validation.ok ? "ok" : validation.capabilities.join("+")}`);
  }
  expect(verdicts).toEqual(repeat); // byte-identical determinism
});

test("conformance: seeded subsets validate against the printer envelope + a frozen vendor model", () => {
  const vendorModel = createPrinterVendorModelDescriptor({
    vendorId: "canon",
    modelId: "ir-adv-c5550",
    connectorBoundaries: ["snmp", "vendor-api"],
    optionalCapabilities: ["update"],
    consumableMonitoring: true,
  });
  for (let seed = 0; seed < 24; seed++) {
    const capabilities = makeAdapterCapabilitiesSeeded(`conf-w030-prn-${seed}`);
    const validation = validatePrinterCopierFamilyCapabilities(capabilities, vendorModel);
    if (!validation.ok && validation.reason === "forbidden_capability") {
      for (const capability of validation.capabilities) {
        expect(["lock", "locate", "wipe"]).toContain(capability);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// makeCommandEnvelope <-> family dispatch (the frozen command contract)
// ---------------------------------------------------------------------------

test("conformance: makeCommandEnvelope commands dispatch through a family adapter end-to-end", () => {
  const tenantId = makeTenantId("conf-w030-dispatch");
  const deviceId = makeDeviceId("conf-w030-device");
  expect(validateTenantRef(tenantId).ok).toBe(true);
  const registry = createAdapterRegistry();
  const seam = createInMemoryIosSeam();
  registry.register(
    createMobileFamilyAdapter({
      descriptor: {
        adapterId: "conf-w030-ios",
        platform: "ios",
        tenantId,
        deviceId,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: MOBILE_FAMILY_CAPABILITIES,
      declaredAt: DECLARED_AT,
    }),
  );
  const dispatcher = createAdapterCommandDispatcher({
    registry,
    tracker: createCommandReceiptTracker(),
  });

  const command: CommandEnvelope<unknown> = makeCommandEnvelope({
    seed: "conf-w030-lock",
    tenantId,
    type: commandTypeForCapability("lock"),
    payload: { action: "enable", message: "Lost — call helpdesk", phoneNumber: "+15551234567" },
  });
  expect(validateCommand(command).ok).toBe(true);
  const outcome = dispatcher.dispatch(command, {
    receivedAt: makeTimestamp("conf-w030-received"),
    executedAt: makeTimestamp("conf-w030-executed"),
    completedAt: makeTimestamp("conf-w030-completed"),
    deviceId,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(true);
  expect(seam.calls().some((call) => call.method === "runMdmCommand")).toBe(true);
});

test("conformance: a fixture envelope against the printer family is refused (unsupported, never emulated)", () => {
  const tenantId = makeTenantId("conf-w030-prn");
  const deviceId = makeDeviceId("conf-w030-prn-device");
  const registry = createAdapterRegistry();
  const seam = createInMemoryPrinterCopierSeam();
  registry.register(
    createPrinterCopierFamilyAdapter({
      descriptor: {
        adapterId: "conf-w030-prn",
        platform: "printer-copier",
        tenantId,
        deviceId,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: PRINTER_COPIER_FAMILY_CAPABILITIES,
      vendorModel: createPrinterVendorModelDescriptor({
        vendorId: "conf-vendor",
        modelId: "conf-model",
        connectorBoundaries: ["snmp"],
        consumableMonitoring: true,
      }),
      declaredAt: DECLARED_AT,
    }),
  );
  const dispatcher = createAdapterCommandDispatcher({
    registry,
    tracker: createCommandReceiptTracker(),
  });
  const command: CommandEnvelope<unknown> = makeCommandEnvelope({
    seed: "conf-w030-prn-wipe",
    tenantId,
    type: commandTypeForCapability("wipe"),
    payload: { scope: "full" },
  });
  const outcome = dispatcher.dispatch(command, {
    receivedAt: makeTimestamp("conf-w030-prn-received"),
    executedAt: makeTimestamp("conf-w030-prn-executed"),
    completedAt: makeTimestamp("conf-w030-prn-completed"),
    deviceId,
    policyGrant: true,
    policyCacheReady: true,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.status).toBe("rejected");
  expect(outcome.error.kind).toBe("AdapterError");
  // The frozen translator maps it to 502 — same taxonomy as the fixtures.
  expect(toApiError(outcome.error).status).toBe(502);
  expect(seam.calls().length).toBe(0);
});

// ---------------------------------------------------------------------------
// makeObservationBatch <-> family observation records
// ---------------------------------------------------------------------------

test("conformance: makeObservationBatch and family records satisfy the same frozen batch validator", () => {
  const tenantId = makeTenantId("conf-w030-obs");
  const deviceId = makeDeviceId("conf-w030-obs-device");
  const fixtureBatch = makeObservationBatch({ seed: "conf-w030-obs", tenantId, deviceId, count: 3 });
  expect(validateObservationBatch(fixtureBatch).ok).toBe(true);

  const collector = createObservationCollector({ tenantId, deviceId });
  collector.record(
    mobileBatteryRecord(makeTimestamp("conf-w030-battery"), {
      batteryLevelPercent: 72,
      chargingState: "discharging",
    }),
  );
  collector.record(
    mobileLocationEvidenceRecord(makeTimestamp("conf-w030-loc"), {
      latitude: -33.8688,
      longitude: 151.2093,
      capturedAt: makeTimestamp("conf-w030-loc-captured"),
      fixSource: "wifi",
      capturedWhileLostMode: false,
    }),
  );
  collector.record(
    printerConsumableRecord(makeTimestamp("conf-w030-toner"), {
      consumableId: "conf-toner",
      consumableType: "toner",
      color: "cyan",
      remainingPercent: 41,
    }),
  );
  collector.record(
    printerPageCountsRecord(makeTimestamp("conf-w030-pages"), {
      total: 1_000,
      mono: 800,
      color: 200,
      duplex: 100,
    }),
  );
  const flush = collector.flush(makeTimestamp("conf-w030-flush"));
  expect(flush.ok).toBe(true);
  if (!flush.ok) return;
  expect(validateObservationBatch(flush.batch).ok).toBe(true);
  // The fixture batch and the family batch share the frozen shape
  // (tenant + device scoping, observation records with kind + payload).
  expect(flush.batch.tenantId).toBe(fixtureBatch.tenantId);
  expect(flush.batch.deviceId).toBe(fixtureBatch.deviceId);
  expect(flush.batch.observations.length).toBe(4);
});

// ---------------------------------------------------------------------------
// Determinism across the family surface (byte-identical)
// ---------------------------------------------------------------------------

test("conformance: family adapters built from the same options are byte-identical in behavior", () => {
  const tenantId = makeTenantId("conf-w030-det");
  const deviceId = makeDeviceId("conf-w030-det-device");
  const correlationId = makeCorrelationId("conf-w030-det-cor");
  const observedAt = makeTimestamp("conf-w030-det-obs");

  function build() {
    const seam = createInMemoryIosSeam({
      batteryObservations: [
        mobileBatteryRecord(observedAt, { batteryLevelPercent: 64, chargingState: "charging" }),
      ],
    });
    const adapter = createMobileFamilyAdapter({
      descriptor: {
        adapterId: "conf-w030-det",
        platform: "ios",
        tenantId,
        deviceId,
        adapterVersion: "0.1.0",
      },
      seams: seam,
      capabilities: MOBILE_FAMILY_CAPABILITIES,
      declaredAt: DECLARED_AT,
      observationIdSeed: "conf-w030-det-seed",
    });
    const lock = adapter.lock(
      {
        tenantId,
        correlationId,
        executedAt: observedAt,
        policyGrant: true,
        policyCacheReady: true,
      },
      { payload: { action: "enable", message: "Lost", phoneNumber: "+15550000" } },
    );
    const observe = adapter.observe({
      tenantId,
      correlationId,
      executedAt: observedAt,
      policyGrant: false,
      policyCacheReady: false,
    });
    return { lock, observe, calls: seam.calls() };
  }

  const runA = build();
  const runB = build();
  expect(canonicalJson(runA.lock)).toBe(canonicalJson(runB.lock));
  expect(canonicalJson(runA.observe)).toBe(canonicalJson(runB.observe));
  expect(canonicalJson(runA.calls)).toBe(canonicalJson(runB.calls));
});

test("conformance: family idempotency keys come from the frozen fixture vocabulary", () => {
  const idempotencyKey = makeIdempotencyKey("conf-w030-idem");
  const command = makeCommandEnvelope({
    seed: "conf-w030-idem",
    type: commandTypeForCapability("locate"),
    payload: { accuracy: "coarse" },
  });
  const command2 = makeCommandEnvelope({
    seed: "conf-w030-idem",
    idempotencyKey,
    type: commandTypeForCapability("locate"),
    payload: { accuracy: "coarse" },
  });
  const tracker = createCommandReceiptTracker();
  const first = tracker.acknowledge(command, makeTimestamp("conf-w030-idem-t1"));
  const second = tracker.acknowledge(command2, makeTimestamp("conf-w030-idem-t2"));
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  // The injected idempotency key drives duplicate suppression.
  expect(second.replayed).toBe(true);
});

test("conformance: FIXTURE_TIME_ANCHOR is the family tests' deterministic time base", () => {
  expect(FIXTURE_TIME_ANCHOR).toBe("2026-01-01T00:00:00Z");
  const anchor = makeTimestamp("conf-w030-anchor");
  // The seeded timestamp derives from the anchor (>= anchor, ISO 8601).
  expect(anchor >= FIXTURE_TIME_ANCHOR).toBe(true);
  expect(/T\d{2}:\d{2}/.test(anchor)).toBe(true);
});
