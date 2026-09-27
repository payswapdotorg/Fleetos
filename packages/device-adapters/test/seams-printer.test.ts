/**
 * W030 D3 tests — the in-memory printer/copier seam: SNMP + vendor
 * routing, payload contract enforcement (fail-closed), default OID
 * queries, scripted outcomes, observation sources, probe, recording,
 * determinism.
 */

import { test, expect } from "bun:test";
import { canonicalJson } from "../src/internal";
import {
  printerConsumableRecord,
  printerErrorStateRecord,
  printerPageCountsRecord,
} from "../src/printer-observations";
import {
  createInMemoryPrinterCopierSeam,
  DEFAULT_SNMP_DEVICE_OIDS,
} from "../src/seams-inmemory-printer";
import { isPrinterCopierSeam } from "../src/seams-printer";

const TS = "2026-01-01T12:00:00Z";

// ---------------------------------------------------------------------------
// Construction + routing
// ---------------------------------------------------------------------------

test("seams-printer: the fake carries the printer-copier platform literal", () => {
  expect(createInMemoryPrinterCopierSeam().platform).toBe("printer-copier");
  expect(isPrinterCopierSeam(createInMemoryPrinterCopierSeam())).toBe(true);
  expect(isPrinterCopierSeam({ platform: "printer-copier" })).toBe(false);
  expect(isPrinterCopierSeam(null)).toBe(false);
});

test("seams-printer: diagnose routes an snmp-get payload to the snmpGet channel", () => {
  const seam = createInMemoryPrinterCopierSeam();
  const result = seam.commands.execute({
    capability: "diagnose",
    payload: { oids: ["1.3.6.1.2.1.43.11.1.1.9.1.1"] },
  });
  expect(result.status).toBe("succeeded");
  const snmp = seam.calls().find((call) => call.method === "snmpGet")?.detail;
  expect(snmp).toEqual({ capability: "diagnose", oids: ["1.3.6.1.2.1.43.11.1.1.9.1.1"] });
});

test("seams-printer: enforce routes vendor commands and snmp-set to their channels", () => {
  const seam = createInMemoryPrinterCopierSeam();
  seam.commands.execute({ capability: "enforce", payload: { action: "cancel-job", jobId: "job-7" } });
  seam.commands.execute({ capability: "enforce", payload: { action: "clear-queue" } });
  seam.commands.execute({
    capability: "enforce",
    payload: { assignments: [{ oid: "1.3.6.1.2.1.1.5.0", valueType: "string", value: "lobby" }] },
  });
  const vendor = seam.calls().filter((call) => call.method === "runVendorCommand").map((call) => call.detail);
  expect(vendor[0]).toEqual({ capability: "enforce", vendorAction: "cancel-job", jobId: "job-7" });
  expect(vendor[1]).toEqual({ capability: "enforce", vendorAction: "clear-queue" });
  const set = seam.calls().find((call) => call.method === "snmpSet")?.detail;
  expect(set).toEqual({
    capability: "enforce",
    assignments: [{ oid: "1.3.6.1.2.1.1.5.0", valueType: "string", value: "lobby" }],
  });
});

test("seams-printer: reboot + firmware-update route to the vendor channel with their capabilities", () => {
  const seam = createInMemoryPrinterCopierSeam();
  seam.commands.execute({ capability: "reboot", payload: { action: "reboot" } });
  seam.commands.execute({ capability: "update", payload: { action: "firmware-update", firmwareRef: "fw-1" } });
  const vendor = seam.calls().filter((call) => call.method === "runVendorCommand").map((call) => call.detail);
  expect(vendor[0]).toEqual({ capability: "reboot", vendorAction: "reboot" });
  expect(vendor[1]).toEqual({ capability: "update", vendorAction: "firmware-update", firmwareRef: "fw-1" });
});

test("seams-printer: identify/health with no payload default to the standard device OIDs", () => {
  const seam = createInMemoryPrinterCopierSeam();
  seam.commands.execute({ capability: "identify", payload: undefined });
  seam.commands.execute({ capability: "health", payload: undefined });
  const queries = seam.calls().filter((call) => call.method === "snmpGet").map((call) => call.detail);
  expect(queries[0]).toEqual({ capability: "identify", oids: [...DEFAULT_SNMP_DEVICE_OIDS] });
  expect(queries[1]).toEqual({ capability: "health", oids: [...DEFAULT_SNMP_DEVICE_OIDS] });
  expect(DEFAULT_SNMP_DEVICE_OIDS[0]).toBe("1.3.6.1.2.1.1.1.0");
});

test("seams-printer: identify/health WITH a payload must be a valid snmp-get (fail-closed)", () => {
  const seam = createInMemoryPrinterCopierSeam();
  const result = seam.commands.execute({ capability: "identify", payload: { oids: ["nope"] } });
  expect(result.status).toBe("failed");
  if (result.status !== "failed") return;
  expect(result.failure?.message).toContain("malformed printer/copier command payload");
  expect(seam.calls().map((call) => call.method)).toEqual(["execute"]);
});

test("seams-printer: FORBIDDEN capabilities fail closed — the typed channels are never reached", () => {
  const seam = createInMemoryPrinterCopierSeam();
  for (const [capability, payload] of [
    ["lock", { action: "reboot" }],
    ["locate", { accuracy: "fine" }],
    ["wipe", { scope: "full" }],
    ["wipe", undefined],
  ] as const) {
    const result = seam.commands.execute({ capability, payload });
    expect(result.status).toBe("failed");
  }
  // Only the normalized execute() invocations were recorded — no channel call.
  expect(seam.calls().every((call) => call.method === "execute")).toBe(true);
});

test("seams-printer: a vendor action smuggled into the wrong capability fails closed", () => {
  const seam = createInMemoryPrinterCopierSeam();
  const result = seam.commands.execute({ capability: "enforce", payload: { action: "reboot" } });
  expect(result.status).toBe("failed");
  expect(seam.calls().map((call) => call.method)).toEqual(["execute"]);
});

// ---------------------------------------------------------------------------
// Scripted outcomes + evidence
// ---------------------------------------------------------------------------

test("seams-printer: scripted outcomes override defaults (first match wins) with content-addressed evidence", () => {
  const seam = createInMemoryPrinterCopierSeam({
    commandOutcomes: [{ capability: "enforce", status: "failed", failureKind: "timeout" }],
  });
  const result = seam.commands.execute({ capability: "enforce", payload: { action: "clear-queue" } });
  expect(result.status).toBe("failed");
  if (result.status !== "failed") return;
  expect(result.failure?.kind).toBe("timeout");
  expect(result.evidence[0].key).toContain("seam://printer-copier/enforce/");
  expect(result.evidence[0].hashAlgorithm).toBe("fnv1a32");
});

test("seams-printer: unscripted capabilities succeed with a deterministic default output", () => {
  const seam = createInMemoryPrinterCopierSeam();
  const result = seam.commands.execute({ capability: "diagnose", payload: { oids: ["1.3.6.1.2.1.1.1.0"] } });
  expect(result.status).toBe("succeeded");
  if (result.status !== "succeeded") return;
  expect(result.output).toEqual({
    platform: "printer-copier",
    capability: "diagnose",
    scripted: false,
    command: { capability: "diagnose", oids: ["1.3.6.1.2.1.1.1.0"] },
  });
});

// ---------------------------------------------------------------------------
// Observation sources + probe
// ---------------------------------------------------------------------------

test("seams-printer: poll drains consumables, page counts and error states in fixed order", () => {
  const seam = createInMemoryPrinterCopierSeam({
    consumableObservations: [
      printerConsumableRecord(TS, { consumableId: "cf259x", consumableType: "toner", color: "black", remainingPercent: 23 }),
    ],
    pageCountObservations: [
      printerPageCountsRecord(TS, { total: 152_340, mono: 120_001, color: 32_339, duplex: 8_112 }),
    ],
    errorStateObservations: [
      printerErrorStateRecord(TS, { deviceStatus: "attention-required", errors: [{ code: "media-jam", severity: "error" }] }),
    ],
  });
  const records = seam.observationSources.poll();
  expect(records.map((record) => record.kind)).toEqual([
    "printer.consumable",
    "printer.page-counts",
    "printer.error-state",
  ]);
  const methods = seam
    .calls()
    .filter((call) => call.surface === "observations")
    .map((call) => call.method);
  expect(methods).toEqual(["poll", "readConsumables", "readPageCounts", "readErrorStates"]);
});

test("seams-printer: the typed sources return the scripted records independently", () => {
  const seam = createInMemoryPrinterCopierSeam({
    errorStateObservations: [
      printerErrorStateRecord(TS, { deviceStatus: "normal", errors: [] }),
    ],
  });
  expect(seam.observationSources.readConsumables().length).toBe(0);
  expect(seam.observationSources.readErrorStates().length).toBe(1);
});

test("seams-printer: the probe reports the scripted capabilities", () => {
  const seam = createInMemoryPrinterCopierSeam({ probedCapabilities: { observe: true, health: true, diagnose: true } });
  expect(seam.capabilityProbe.probeId).toBe("inmemory-printer-copier-probe");
  const probed = seam.capabilityProbe.probe();
  expect(probed.observe).toBe(true);
  expect(probed.lock).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Reset + determinism
// ---------------------------------------------------------------------------

test("seams-printer: reset clears recordings but preserves scripted data", () => {
  const seam = createInMemoryPrinterCopierSeam({
    commandOutcomes: [{ capability: "update", status: "failed", message: "vendor api down" }],
  });
  seam.commands.execute({ capability: "identify" });
  seam.reset();
  expect(seam.calls().length).toBe(0);
  const result = seam.commands.execute({ capability: "update", payload: { action: "firmware-update", firmwareRef: "fw" } });
  expect(result.status).toBe("failed");
});

test("seams-printer: byte-identical determinism — same options, same results", () => {
  const options = {
    commandOutcomes: [{ capability: "reboot", status: "succeeded" } as const],
    consumableObservations: [
      printerConsumableRecord(TS, { consumableId: "c", consumableType: "ink", remainingPercent: 50 }),
    ],
  };
  const seamA = createInMemoryPrinterCopierSeam(options);
  const seamB = createInMemoryPrinterCopierSeam(options);
  const resultsA = [
    seamA.commands.execute({ capability: "reboot", payload: { action: "reboot" } }),
    seamA.commands.execute({ capability: "diagnose", payload: { oids: ["1.3.6.1.2.1.1.1.0"] } }),
    seamA.observationSources.poll(),
    seamA.capabilityProbe.probe(),
  ];
  const resultsB = [
    seamB.commands.execute({ capability: "reboot", payload: { action: "reboot" } }),
    seamB.commands.execute({ capability: "diagnose", payload: { oids: ["1.3.6.1.2.1.1.1.0"] } }),
    seamB.observationSources.poll(),
    seamB.capabilityProbe.probe(),
  ];
  expect(canonicalJson(resultsA)).toBe(canonicalJson(resultsB));
  expect(canonicalJson(seamA.calls())).toBe(canonicalJson(seamB.calls()));
});
