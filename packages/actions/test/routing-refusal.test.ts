/**
 * W041 D5 tests — routing refusal for unsupported capabilities. The
 * router NEVER emulates a missing capability via a different printer
 * that lacks it. If no printer supports the required features, the
 * routing returns a tagged `routing_refused` error with the unsupported
 * feature names as machine-stable reasons (the caller surfaces them
 * deterministically). The frozen `supportsPrintFeatures` helper drives
 * the gate.
 */

import { describe, expect, test } from "bun:test";
import {
  routePrintJob,
  supportsPrintFeatures,
  ALL_PRINTER_CAPABILITIES,
  PRINT_JOB_REFUSED,
  PRINT_JOB_ROUTED,
  PRINT_JOB_QUEUED,
  enqueuePrintJob,
  type PrinterCapabilities,
  type PrinterDescriptor,
} from "../src/index";
import { CORR, T0, T1, TENANT_A, printer } from "./helpers";

describe("D5: supportsPrintFeatures (the capability gate)", () => {
  test("a printer with the required features satisfies the request", () => {
    const flags: PrinterCapabilities = { color: true, duplex: true };
    const required: PrinterCapabilities = { color: true };
    expect(supportsPrintFeatures(required, flags)).toBe(true);
  });
  test("a printer missing a required feature REFUSES the request", () => {
    const flags: PrinterCapabilities = { color: false, duplex: true };
    const required: PrinterCapabilities = { color: true };
    expect(supportsPrintFeatures(required, flags)).toBe(false);
  });
  test("an absent capability flag (undefined) is treated as unsupported", () => {
    const flags: PrinterCapabilities = { duplex: true }; // color undefined
    const required: PrinterCapabilities = { color: true };
    expect(supportsPrintFeatures(required, flags)).toBe(false);
  });
  test("an empty required set is satisfied by any printer (the universal accept)", () => {
    const flags: PrinterCapabilities = {};
    const required: PrinterCapabilities = {};
    expect(supportsPrintFeatures(required, flags)).toBe(true);
  });
  test("every capability flag is covered by ALL_PRINTER_CAPABILITIES", () => {
    expect(ALL_PRINTER_CAPABILITIES).toEqual([
      "color",
      "duplex",
      "staple",
      "punch",
      "scan",
      "fax",
      "largeFormat",
      "photo",
      "cardstock",
    ]);
  });
});

describe("D5: routePrintJob refuses when no printer supports the required features", () => {
  test("a job requiring color when no color printers are available is REFUSED (never emulated)", () => {
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_mono_01", { capabilities: { color: false } }),
      printer(TENANT_A, "prn_mono_02", { capabilities: { color: false } }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://color-required" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.routing_refused");
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("unsupported_features");
    }
  });

  test("a job requiring staple when no stapling printers are available is REFUSED", () => {
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_no_staple_01", { capabilities: { color: true, staple: false } }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://staple-required" },
      requiredFeatures: { staple: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.routing_refused");
  });

  test("a job requiring multiple features when no single printer has them all is REFUSED", () => {
    const printers: readonly PrinterDescriptor[] = [
      // Has color + duplex, but no staple.
      printer(TENANT_A, "prn_partial_01", {
        capabilities: { color: true, duplex: true, staple: false },
      }),
      // Has staple, but no color.
      printer(TENANT_A, "prn_partial_02", {
        capabilities: { color: false, duplex: true, staple: true },
      }),
    ];
    // The job requires color AND staple — no single printer supports both.
    const result = routePrintJob({
      payload: { documentRef: "doc://color-and-staple" },
      requiredFeatures: { color: true, staple: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.routing_refused");
  });

  test("a refused routing emits an audit record with the unsupported feature names", () => {
    const sink = { records: [] as unknown[] };
    const auditSink = {
      append: (record: unknown) => {
        sink.records.push(record);
      },
    };
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_no_color", { capabilities: { color: false } }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://audit-refusal" },
      requiredFeatures: { color: true, staple: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: auditSink as never,
    });
    expect(result.ok).toBe(false);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0] as {
      action: string;
      details: { unsupportedFeatures: string[]; status: string };
    };
    expect(record.action).toBe("action.print.job.routed");
    expect(record.details.status).toBe(PRINT_JOB_REFUSED);
    expect(record.details.unsupportedFeatures).toEqual(["color", "staple"]);
  });
});

describe("D5: routePrintJob selects the best printer among supporting ones", () => {
  test("the lowest-score supporting printer is selected (cost-ascending)", () => {
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_expensive", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.10 },
      }),
      printer(TENANT_A, "prn_cheap", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.02 },
      }),
      printer(TENANT_A, "prn_mid", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.05 },
      }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://cheapest" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      scoreFn: (p) => p.costPerPage ?? 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.printerId).toBe("prn_cheap");
    expect(result.job.status).toBe(PRINT_JOB_ROUTED);
    expect(result.job.queuePosition).toBe(1);
  });

  test("a non-supporting printer is never selected even if its score is lower (no emulation)", () => {
    const printers: readonly PrinterDescriptor[] = [
      // Has color but expensive.
      printer(TENANT_A, "prn_color_expensive", {
        capabilities: { color: true },
        preferences: { costPerPage: 1.0 },
      }),
      // No color but very cheap — must NOT be selected.
      printer(TENANT_A, "prn_mono_cheap", {
        capabilities: { color: false },
        preferences: { costPerPage: 0.001 },
      }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://never-emulate" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      scoreFn: (p) => p.costPerPage ?? 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The router selected the ONLY supporting printer (the expensive one);
    // it never emulated color on the mono printer.
    expect(result.job.printerId).toBe("prn_color_expensive");
  });

  test("foreign-tenant printers are filtered out (no side channel)", () => {
    const printers: readonly PrinterDescriptor[] = [
      // Tenant B printer (foreign) — must be filtered out.
      printer(
        // tenant B id (constructed inline so we don't import the helpers'
        // TENANT_B and clutter the test surface)
        "tnt_testtenant000b" as never,
        "prn_foreign",
        { capabilities: { color: true }, preferences: { costPerPage: 0.001 } },
      ),
      // Tenant A printer (matching) — supporting but more expensive.
      printer(TENANT_A, "prn_local", {
        capabilities: { color: true },
        preferences: { costPerPage: 1.0 },
      }),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://no-side-channel" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      scoreFn: (p) => p.costPerPage ?? 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.printerId).toBe("prn_local");
  });
});

describe("D5: the queue-state contract — observable evidence links", () => {
  test("enqueuePrintJob transitions ROUTED -> QUEUED and updates the queue state", () => {
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_queue_01", { capabilities: { color: true } }),
    ];
    const routed = routePrintJob({
      payload: { documentRef: "doc://queue-01" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    expect(routed.job.status).toBe(PRINT_JOB_ROUTED);
    expect(routed.job.queuePosition).toBe(1);
    // Enqueue the job:
    const enq = enqueuePrintJob(routed.job, {
      at: T1,
      correlationId: CORR,
    });
    expect(enq.ok).toBe(true);
    if (!enq.ok) return;
    expect(enq.job.status).toBe(PRINT_JOB_QUEUED);
    expect(enq.job.queuePosition).toBe(1);
    expect(enq.job.version).toBe(routed.job.version + 1);
    expect(enq.queueState.depth).toBe(1);
    expect(enq.queueState.queuedJobIds).toEqual([enq.job.jobId]);
    expect(enq.queueState.printerId).toBe("prn_queue_01");
    expect(enq.queueState.tenantId).toBe(TENANT_A);
  });

  test("enqueuePrintJob requires ROUTED status (the queue-state boundary)", () => {
    const printers: readonly PrinterDescriptor[] = [
      printer(TENANT_A, "prn_queue_02", { capabilities: { color: true } }),
    ];
    const routed = routePrintJob({
      payload: { documentRef: "doc://queue-02" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const enq = enqueuePrintJob(routed.job, {
      at: T1,
      correlationId: CORR,
    });
    expect(enq.ok).toBe(true);
    if (!enq.ok) return;
    // A second enqueue on the QUEUED job MUST fail (status not ROUTED).
    const enq2 = enqueuePrintJob(enq.job, { at: "2026-03-01T00:00:00Z", correlationId: CORR });
    expect(enq2.ok).toBe(false);
    if (enq2.ok) return;
    expect(enq2.error.code).toBe("action.print.queue");
  });
});
