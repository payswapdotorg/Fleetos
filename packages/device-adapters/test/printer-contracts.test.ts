/**
 * W030 D2 tests — printer/copier command + observation payload
 * contracts (SNMP + vendor boundary, fail-closed validators, record
 * builders).
 */

import { test, expect } from "bun:test";
import { validateObservationBatch } from "@fleetos/contracts";
import { createObservationCollector } from "../src/observations";
import {
  isPrinterObservationKind,
  parsePrinterConsumablePayload,
  parsePrinterErrorStatePayload,
  parsePrinterObservationPayload,
  parsePrinterPageCountsPayload,
  PRINTER_CONSUMABLE_OBSERVATION_KIND,
  PRINTER_ERROR_STATE_OBSERVATION_KIND,
  PRINTER_OBSERVATION_KINDS,
  PRINTER_PAGE_COUNTS_OBSERVATION_KIND,
  printerConsumableRecord,
  printerErrorStateRecord,
  printerPageCountsRecord,
} from "../src/printer-observations";
import {
  isPrinterCommandPayload,
  parsePrinterCommandPayload,
  parseSnmpGetCommandPayload,
  parseSnmpSetCommandPayload,
  parseVendorPrinterCommandPayload,
  PRINTER_CAPABILITY_PAYLOAD_KINDS,
  VENDOR_ACTIONS_FOR_CAPABILITY,
} from "../src/printer-commands";

// ---------------------------------------------------------------------------
// SNMP get / set payloads
// ---------------------------------------------------------------------------

test("printer-commands: snmp-get parses non-empty dotted OIDs", () => {
  const parsed = parseSnmpGetCommandPayload({ oids: ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5.0"] });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.oids.length).toBe(2);
  expect(parseSnmpGetCommandPayload({ oids: [] }).ok).toBe(false);
  expect(parseSnmpGetCommandPayload({ oids: ["not-an-oid"] }).ok).toBe(false);
  expect(parseSnmpGetCommandPayload({ oids: ["1.3.6"] }).ok).toBe(true); // >= 2 segments
  expect(parseSnmpGetCommandPayload({}).ok).toBe(false);
});

test("printer-commands: snmp-set parses typed assignments", () => {
  const parsed = parseSnmpSetCommandPayload({
    assignments: [
      { oid: "1.3.6.1.2.1.43.5.1.1.3.1", valueType: "integer", value: 2 },
      { oid: "1.3.6.1.2.1.1.5.0", valueType: "string", value: "lobby-printer" },
    ],
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.assignments.length).toBe(2);
  expect(parseSnmpSetCommandPayload({ assignments: [] }).ok).toBe(false);
  expect(parseSnmpSetCommandPayload({ assignments: [{ oid: "bad", valueType: "integer", value: 1 }] }).ok).toBe(false);
  expect(parseSnmpSetCommandPayload({ assignments: [{ oid: "1.3.6.1", valueType: "integer", value: -3 }] }).ok).toBe(false);
  expect(parseSnmpSetCommandPayload({ assignments: [{ oid: "1.3.6.1", valueType: "string", value: 42 }] }).ok).toBe(false);
  expect(parseSnmpSetCommandPayload({ assignments: [{ oid: "1.3.6.1", valueType: "counter64", value: 1 }] }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Vendor boundary payloads
// ---------------------------------------------------------------------------

test("printer-commands: vendor command payloads discriminate by action", () => {
  const cancel = parseVendorPrinterCommandPayload({ action: "cancel-job", jobId: "job-42" });
  expect(cancel.ok).toBe(true);
  if (!cancel.ok) return;
  expect(cancel.payload.action).toBe("cancel-job");
  expect(parseVendorPrinterCommandPayload({ action: "clear-queue" }).ok).toBe(true);
  expect(parseVendorPrinterCommandPayload({ action: "apply-config", config: { duplex: "on" } }).ok).toBe(true);
  expect(parseVendorPrinterCommandPayload({ action: "reboot" }).ok).toBe(true);
  const fw = parseVendorPrinterCommandPayload({ action: "firmware-update", firmwareRef: "fw-2026.01", firmwareHash: "sha256:abc" });
  expect(fw.ok).toBe(true);
  if (!fw.ok) return;
  expect(fw.payload.action).toBe("firmware-update");
  expect(parseVendorPrinterCommandPayload({ action: "cancel-job" }).ok).toBe(false); // jobId required
  expect(parseVendorPrinterCommandPayload({ action: "apply-config", config: "nope" }).ok).toBe(false);
  expect(parseVendorPrinterCommandPayload({ action: "firmware-update" }).ok).toBe(false);
  expect(parseVendorPrinterCommandPayload({ action: "emulate-wipe" }).ok).toBe(false);
});

test("printer-commands: vendor actions are capability-scoped (no smuggling)", () => {
  expect([...(VENDOR_ACTIONS_FOR_CAPABILITY.enforce ?? [])]).toEqual(["cancel-job", "clear-queue", "apply-config"]);
  expect([...(VENDOR_ACTIONS_FOR_CAPABILITY.reboot ?? [])]).toEqual(["reboot"]);
  expect([...(VENDOR_ACTIONS_FOR_CAPABILITY.update ?? [])]).toEqual(["firmware-update"]);
  expect(VENDOR_ACTIONS_FOR_CAPABILITY.lock).toBeUndefined();
  expect(VENDOR_ACTIONS_FOR_CAPABILITY.locate).toBeUndefined();
  expect(VENDOR_ACTIONS_FOR_CAPABILITY.wipe).toBeUndefined();
  // reboot action offered to enforce: refused
  expect(parsePrinterCommandPayload("enforce", { action: "reboot" }).ok).toBe(false);
  // cancel-job offered to reboot: refused
  expect(parsePrinterCommandPayload("reboot", { action: "cancel-job", jobId: "j" }).ok).toBe(false);
  // firmware-update offered to enforce: refused
  expect(parsePrinterCommandPayload("enforce", { action: "firmware-update", firmwareRef: "f" }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// The capability -> payload-kind map + unified parser
// ---------------------------------------------------------------------------

test("printer-commands: the capability payload map covers only the family capabilities", () => {
  expect([...(PRINTER_CAPABILITY_PAYLOAD_KINDS.diagnose ?? [])]).toEqual(["snmp-get"]);
  expect([...(PRINTER_CAPABILITY_PAYLOAD_KINDS.enforce ?? [])]).toEqual(["vendor-command", "snmp-set"]);
  expect([...(PRINTER_CAPABILITY_PAYLOAD_KINDS.reboot ?? [])]).toEqual(["vendor-command"]);
  expect([...(PRINTER_CAPABILITY_PAYLOAD_KINDS.update ?? [])]).toEqual(["vendor-command"]);
  expect(PRINTER_CAPABILITY_PAYLOAD_KINDS.lock).toBeUndefined();
  expect(PRINTER_CAPABILITY_PAYLOAD_KINDS.locate).toBeUndefined();
  expect(PRINTER_CAPABILITY_PAYLOAD_KINDS.wipe).toBeUndefined();
  expect(PRINTER_CAPABILITY_PAYLOAD_KINDS.remediate).toBeUndefined();
});

test("printer-commands: parsePrinterCommandPayload resolves kinds per capability", () => {
  const diagnose = parsePrinterCommandPayload("diagnose", { oids: ["1.3.6.1.2.1.1.1.0"] });
  expect(diagnose.ok).toBe(true);
  if (!diagnose.ok) return;
  expect(diagnose.payload.kind).toBe("snmp-get");
  const enforceVendor = parsePrinterCommandPayload("enforce", { action: "clear-queue" });
  expect(enforceVendor.ok).toBe(true);
  if (!enforceVendor.ok) return;
  expect(enforceVendor.payload.kind).toBe("vendor-command");
  const enforceSnmp = parsePrinterCommandPayload("enforce", {
    assignments: [{ oid: "1.3.6.1.2.1.43.5.1.1.3.1", valueType: "integer", value: 4 }],
  });
  expect(enforceSnmp.ok).toBe(true);
  if (!enforceSnmp.ok) return;
  expect(enforceSnmp.payload.kind).toBe("snmp-set");
  const reboot = parsePrinterCommandPayload("reboot", { action: "reboot" });
  expect(reboot.ok).toBe(true);
  if (!reboot.ok) return;
  expect(reboot.payload.kind).toBe("vendor-command");
});

test("printer-commands: FORBIDDEN capabilities accept no payload at all", () => {
  expect(parsePrinterCommandPayload("lock", { action: "reboot" }).ok).toBe(false);
  expect(parsePrinterCommandPayload("locate", { accuracy: "fine" }).ok).toBe(false);
  expect(parsePrinterCommandPayload("wipe", { scope: "full" }).ok).toBe(false);
  expect(parsePrinterCommandPayload("wipe", {}).ok).toBe(false);
  expect(isPrinterCommandPayload("enforce", { action: "clear-queue" })).toBe(true);
  expect(isPrinterCommandPayload("remediate", { anything: 1 })).toBe(false);
});

// ---------------------------------------------------------------------------
// Printer observation payloads + record builders
// ---------------------------------------------------------------------------

test("printer-observations: the three printer observation kinds are enumerable", () => {
  expect([...PRINTER_OBSERVATION_KINDS]).toEqual([
    "printer.consumable",
    "printer.page-counts",
    "printer.error-state",
  ]);
  expect(isPrinterObservationKind("printer.consumable")).toBe(true);
  expect(isPrinterObservationKind("mobile.battery")).toBe(false);
});

test("printer-observations: consumable payload validates type/color/level", () => {
  const parsed = parsePrinterConsumablePayload({
    consumableId: "cf259x",
    consumableType: "toner",
    color: "black",
    remainingPercent: 23,
    estimatedPagesRemaining: 900,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.consumableType).toBe("toner");
  expect(parsed.payload.remainingPercent).toBe(23);
  expect(parsePrinterConsumablePayload({ consumableId: "w1", consumableType: "waste-toner", remainingPercent: 0 }).ok).toBe(true);
  expect(parsePrinterConsumablePayload({ consumableId: "", consumableType: "toner", remainingPercent: 10 }).ok).toBe(false);
  expect(parsePrinterConsumablePayload({ consumableId: "x", consumableType: "paper", remainingPercent: 10 }).ok).toBe(false);
  expect(parsePrinterConsumablePayload({ consumableId: "x", consumableType: "toner", color: "magenta", remainingPercent: 101 }).ok).toBe(false);
});

test("printer-observations: page counts validate as non-negative integers", () => {
  const parsed = parsePrinterPageCountsPayload({ total: 152_340, mono: 120_001, color: 32_339, duplex: 8_112, scanned: 4_554 });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.total).toBe(152_340);
  expect(parsePrinterPageCountsPayload({ total: 10, mono: 4, color: 6, duplex: 0 }).ok).toBe(true);
  expect(parsePrinterPageCountsPayload({ total: 10, mono: 4, color: 6 }).ok).toBe(false); // duplex required
  expect(parsePrinterPageCountsPayload({ total: -1, mono: 0, color: 0, duplex: 0 }).ok).toBe(false);
  expect(parsePrinterPageCountsPayload({ total: 1.5, mono: 0, color: 0, duplex: 0 }).ok).toBe(false);
});

test("printer-observations: error state validates status + entries", () => {
  const parsed = parsePrinterErrorStatePayload({
    deviceStatus: "attention-required",
    errors: [
      { code: "media-jam", severity: "error", description: "Tray 2 jam" },
      { code: "toner-low", severity: "warning" },
    ],
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.payload.deviceStatus).toBe("attention-required");
  expect(parsed.payload.errors.length).toBe(2);
  expect(parsePrinterErrorStatePayload({ deviceStatus: "normal", errors: [] }).ok).toBe(true);
  expect(parsePrinterErrorStatePayload({ deviceStatus: "offline", errors: "jam" }).ok).toBe(false);
  expect(parsePrinterErrorStatePayload({ deviceStatus: "exploded", errors: [] }).ok).toBe(false);
  expect(parsePrinterErrorStatePayload({ deviceStatus: "normal", errors: [{ code: "", severity: "error" }] }).ok).toBe(false);
  expect(parsePrinterErrorStatePayload({ deviceStatus: "normal", errors: [{ code: "x", severity: "fatal" }] }).ok).toBe(false);
});

test("printer-observations: parsePrinterObservationPayload dispatches by kind", () => {
  expect(parsePrinterObservationPayload("printer.consumable", { consumableId: "c", consumableType: "drum", remainingPercent: 80 }).ok).toBe(true);
  expect(parsePrinterObservationPayload("printer.page-counts", { total: 1, mono: 1, color: 0, duplex: 0 }).ok).toBe(true);
  expect(parsePrinterObservationPayload("printer.error-state", { deviceStatus: "normal", errors: [] }).ok).toBe(true);
  expect(parsePrinterObservationPayload("mobile.compliance", {}).ok).toBe(false);
  expect(parsePrinterObservationPayload("device.health", {}).ok).toBe(false);
});

test("printer-observations: printer records assemble batches the frozen validator accepts", () => {
  const collector = createObservationCollector({
    tenantId: "tnt_printer_1" as never,
    deviceId: "dev_printer_1" as never,
  });
  collector.record(printerConsumableRecord("2026-01-01T11:00:00Z", {
    consumableId: "cf259x",
    consumableType: "toner",
    color: "black",
    remainingPercent: 23,
  }));
  collector.record(printerPageCountsRecord("2026-01-01T11:00:01Z", {
    total: 152_340,
    mono: 120_001,
    color: 32_339,
    duplex: 8_112,
  }));
  collector.record(printerErrorStateRecord("2026-01-01T11:00:02Z", {
    deviceStatus: "attention-required",
    errors: [{ code: "media-jam", severity: "error" }],
  }));
  const flush = collector.flush("2026-01-01T11:00:05Z");
  expect(flush.ok).toBe(true);
  if (!flush.ok) return;
  expect(validateObservationBatch(flush.batch).ok).toBe(true);
  expect(flush.batch.observations.map((observation) => observation.kind)).toEqual([
    PRINTER_CONSUMABLE_OBSERVATION_KIND,
    PRINTER_PAGE_COUNTS_OBSERVATION_KIND,
    PRINTER_ERROR_STATE_OBSERVATION_KIND,
  ]);
  expect(flush.batch.observations.every((observation) => observation.schemaVersion === 1)).toBe(true);
});
