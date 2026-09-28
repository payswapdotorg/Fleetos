/**
 * W060B tests — the print orchestration surface: printer routing
 * presented read-only with capability-based routing REFUSALS visible
 * (the machine-stable `unsupported_feature:*` reasons, verbatim) and
 * NEVER emulated (no fallback printer, no altered requiredFeatures, no
 * re-routing). The capability-gate mirror is proven equivalent to the
 * real W041 gate by the binding test.
 */

import { describe, expect, test } from "bun:test";
import {
  buildPrintRoutingView,
  supportsPrintFeaturesView,
  ALL_SURFACE_PRINTER_CAPABILITIES,
  type PrintRoutingPresentationView,
} from "../src/print-routing-view";
import type { SurfaceResult } from "../src/internal";
import type { SurfacePrintJobRecord } from "../src/surface-contracts";
import {
  CAPABILITY_NAMES,
  FLAG_STATES,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  decision,
  evidenceRef,
  printJob,
  printer,
  scopeA,
} from "./helpers";

function okView(result: SurfaceResult<PrintRoutingPresentationView>): PrintRoutingPresentationView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.view;
}

describe("the capability gate mirror", () => {
  test("a required-true feature is satisfied only by a declared-true flag", () => {
    expect(supportsPrintFeaturesView({ color: true }, { color: true })).toBe(true);
    expect(supportsPrintFeaturesView({ color: true }, { color: false })).toBe(false);
    expect(supportsPrintFeaturesView({ color: true }, {})).toBe(false);
  });

  test("an empty required set is universally satisfied", () => {
    expect(supportsPrintFeaturesView({}, {})).toBe(true);
  });

  test("non-required flags never matter", () => {
    expect(supportsPrintFeaturesView({ color: true }, { color: true, staple: false })).toBe(true);
    expect(supportsPrintFeaturesView({ duplex: true }, { color: false })).toBe(false);
  });

  test("the capability names table matches the W041 taxonomy (order + names)", () => {
    expect(ALL_SURFACE_PRINTER_CAPABILITIES).toEqual([
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
    expect(CAPABILITY_NAMES.length).toBe(9);
  });
});

describe("routed / queued print jobs present verbatim", () => {
  test("a ROUTED job presents printer, position, requiredFeatures and payload verbatim", () => {
    const job = printJob({
      payload: { documentRef: "doc://w060b-report", targetUserId: "usr_w060bact01" },
      requiredFeatures: { color: true, duplex: true },
      printerId: "prn_w060b_color_01",
      queuePosition: 1,
    });
    const view = okView(
      buildPrintRoutingView(scopeA(), job, [printer({ capabilities: { color: true, duplex: true } })]),
    );
    expect(view.status).toBe("ROUTED");
    expect(view.refused).toBe(false);
    expect(view.printerId).toBe("prn_w060b_color_01");
    expect(view.queuePosition).toBe(1);
    expect(view.requiredFeatures).toEqual({ color: true, duplex: true });
    expect(view.documentRef).toBe("doc://w060b-report");
    expect(view.targetUserId).toBe("usr_w060bact01");
    expect(view.routingReasons).toEqual([]);
    expect(view.linkedDecision).toBeNull();
    expect(view.evidence).toEqual([evidenceRef("evidence/w060b-print-1")]);
  });

  test("a QUEUED job presents its queue position and transition timestamp", () => {
    const job = printJob({ status: "QUEUED", version: 2, queuePosition: 3, transitionedAt: T1 });
    const view = okView(buildPrintRoutingView(scopeA(), job));
    expect(view.status).toBe("QUEUED");
    expect(view.queuePosition).toBe(3);
    expect(view.transitionedAt).toBe(T1);
  });

  test("per-printer capability disclosures expose DECLARED flags + the observable satisfaction", () => {
    const job = printJob({ requiredFeatures: { color: true } });
    const printers = [
      printer({ printerId: "prn_color", capabilities: { color: true, duplex: true } }),
      printer({ printerId: "prn_mono", capabilities: { color: false, duplex: true } }),
      printer({ printerId: "prn_none", capabilities: {} }),
    ];
    const view = okView(buildPrintRoutingView(scopeA(), job, printers));
    expect(view.printerDisclosures).toHaveLength(3);
    expect(view.printerDisclosures[0]).toEqual({
      printerId: "prn_color",
      approved: true,
      location: "hq",
      capabilities: { color: true, duplex: true },
      satisfiesRequiredFeatures: true,
    });
    expect(view.printerDisclosures[1]?.satisfiesRequiredFeatures).toBe(false);
    expect(view.printerDisclosures[2]?.satisfiesRequiredFeatures).toBe(false);
    // Disclosures are ordered by printerId (machine-stable).
    expect(view.printerDisclosures.map((d) => d.printerId)).toEqual([
      "prn_color",
      "prn_mono",
      "prn_none",
    ]);
  });

  test("a linked Guardian print-policy decision presents as context", () => {
    const linked = decision({ decision: "WARN" });
    const view = okView(buildPrintRoutingView(scopeA(), printJob(), [], linked));
    expect(view.linkedDecision?.decision).toBe("WARN");
    expect(view.linkedDecision?.isBlocking).toBe(false);
    expect(view.linkedDecision?.evidence.length).toBe(1);
  });
});

describe("routing REFUSALS are visible and never emulated", () => {
  test("a REFUSED job presents the machine-stable reasons VERBATIM and NO printer", () => {
    const job = printJob({
      status: "REFUSED",
      requiredFeatures: { color: true, staple: true },
      routingReasons: ["unsupported_feature:color", "unsupported_feature:staple"],
    });
    const printers = [
      printer({ printerId: "prn_mono", capabilities: { color: false, staple: false } }),
    ];
    const view = okView(buildPrintRoutingView(scopeA(), job, printers));
    expect(view.status).toBe("REFUSED");
    expect(view.refused).toBe(true);
    expect(view.printerId).toBeUndefined();
    expect(view.queuePosition).toBeUndefined();
    expect(view.routingReasons).toEqual([
      "unsupported_feature:color",
      "unsupported_feature:staple",
    ]);
    // The capability disclosure shows NO printer satisfies the requirements.
    expect(view.printerDisclosures[0]?.satisfiesRequiredFeatures).toBe(false);
  });

  test("the surface NEVER alters requiredFeatures and NEVER suggests a printer", () => {
    const job = printJob({
      status: "REFUSED",
      requiredFeatures: { color: true },
      routingReasons: ["unsupported_feature:color"],
    });
    const view = okView(buildPrintRoutingView(scopeA(), job, [printer({ capabilities: {} })]));
    expect(view.requiredFeatures).toEqual({ color: true });
    const serialized = JSON.stringify(view);
    for (const forbidden of ["suggestedPrinter", "fallbackPrinter", "emulat"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(view.printerId).toBeUndefined();
  });

  test("requiredFeatures pass through verbatim for routed jobs too (never re-derived)", () => {
    const job = printJob({ requiredFeatures: { photo: true, cardstock: true } });
    const view = okView(buildPrintRoutingView(scopeA(), job));
    expect(view.requiredFeatures).toEqual({ photo: true, cardstock: true });
  });
});

describe("print job discipline validation (the W041 record contract)", () => {
  test("a REFUSED job carrying a printer refuses (the W041 discipline)", () => {
    const bad = printJob({ status: "REFUSED", printerId: "prn_sneaky" } as Partial<SurfacePrintJobRecord>);
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.job_invalid");
    expect(result.error.failures[0]?.path).toBe("/printerId");
    expect(result.error.failures[0]?.reason).toBe("refused_job_has_printer");
  });

  test("a REFUSED job without routing reasons refuses", () => {
    const bad = printJob({ status: "REFUSED", routingReasons: [] });
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("refused_job_missing_reasons");
  });

  test("a non-REFUSED job carrying routing reasons refuses", () => {
    const bad = printJob({ routingReasons: ["unsupported_feature:color"] });
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("non_refused_job_has_reasons");
  });

  test("a ROUTED job without a printer refuses", () => {
    const bad = printJob({ printerId: undefined });
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.reason).toBe("routed_job_missing_printer");
  });

  test("an unknown job status refuses with unknown_status", () => {
    const bad = { ...printJob(), status: "MYSTERY" } as unknown as SurfacePrintJobRecord;
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/status");
    expect(result.error.failures[0]?.reason).toBe("unknown_status");
  });

  test("a malformed payload (empty documentRef) refuses", () => {
    const bad = printJob({ payload: { documentRef: "" } });
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/payload/documentRef");
  });

  test("a malformed requiredFeatures value refuses (booleans only)", () => {
    const bad = printJob({ requiredFeatures: { color: "yes" as never } });
    const result = buildPrintRoutingView(scopeA(), bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/requiredFeatures/color");
  });
});

describe("tenant discipline", () => {
  test("a cross-tenant job REFUSES (fail-closed)", () => {
    const result = buildPrintRoutingView(scopeA(), printJob({ tenantId: TENANT_B }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.tenant_mismatch");
    expect(result.error.failures[0]?.path).toBe("/job/tenantId");
  });

  test("a cross-tenant printer in the disclosure input REFUSES", () => {
    const result = buildPrintRoutingView(
      scopeA(),
      printJob(),
      [printer({ tenantId: TENANT_B })],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/printers/0/tenantId");
  });

  test("a cross-tenant linked decision REFUSES", () => {
    const result = buildPrintRoutingView(
      scopeA(),
      printJob(),
      [],
      decision({ decision: "BLOCK", tenantId: TENANT_B }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.failures[0]?.path).toBe("/linkedDecision/tenantId");
  });

  test("a malformed printer refuses with a JSON-pointer path", () => {
    const result = buildPrintRoutingView(
      scopeA(),
      printJob(),
      [printer({ printerId: "" })],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("surface.printer_invalid");
    expect(result.error.failures[0]?.path).toBe("/printers/0/printerId");
  });
});

describe("read-only + determinism", () => {
  test("every view is deeply frozen", () => {
    const view = okView(
      buildPrintRoutingView(scopeA(), printJob(), [printer()], decision({ decision: "ALLOW" })),
    );
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.printerDisclosures)).toBe(true);
    expect(Object.isFrozen(view.printerDisclosures[0])).toBe(true);
    expect(Object.isFrozen(view.requiredFeatures)).toBe(true);
    expect(Object.isFrozen(view.linkedDecision)).toBe(true);
  });

  test("the same inputs twice produce byte-identical views (printer order canonicalized)", () => {
    const job = printJob({ requiredFeatures: { color: true } });
    const printers = [printer({ printerId: "prn_b" }), printer({ printerId: "prn_a" })];
    const a = okView(buildPrintRoutingView(scopeA(), job, printers));
    const b = okView(buildPrintRoutingView(scopeA(), job, [...printers].reverse()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("the builder never mutates its input (job + printers + decision)", () => {
    const job = printJob();
    const printers = [printer()];
    const linked = decision({ decision: "ALLOW" });
    const snapshots = [JSON.stringify(job), JSON.stringify(printers), JSON.stringify(linked)];
    buildPrintRoutingView(scopeA(), job, printers, linked);
    expect(JSON.stringify(job)).toBe(snapshots[0]);
    expect(JSON.stringify(printers)).toBe(snapshots[1]);
    expect(JSON.stringify(linked)).toBe(snapshots[2]);
  });

  test("timestamps and correlation pass through verbatim (no clock reads)", () => {
    const job = printJob({ createdAt: T0, transitionedAt: T1 });
    const view = okView(buildPrintRoutingView(scopeA(), job));
    expect(view.createdAt).toBe(T0);
    expect(view.transitionedAt).toBe(T1);
    expect(view.jobId).toBe("prn_w060b_job_01");
    expect(view.contentDigest).toBe("printdigest_ROUTED");
  });
});
