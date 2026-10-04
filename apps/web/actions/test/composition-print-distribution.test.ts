/**
 * W142 web-actions — the Print Distribution RUNTIME FEED composition
 * tests.
 *
 * These tests are the machine proof that EVERY lane-phase transition
 * of the Print Distribution feed is honest:
 *
 *   loading -> ready                  (the composition over real state)
 *   loading -> empty                  (no distribution for the document)
 *   loading -> blocked                (a refused scope grammar)
 *   loading -> error                  (a source that refuses)
 *
 * And that the distribution plan view (the per-person entries with
 * ROUTED / REFUSED jobs + escalation context) renders from REAL
 * runtime state — never fabricated.
 */

import { describe, expect, test } from "bun:test";
import { asCorrelationId } from "@fleetos/contracts";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  composePrintDistributionFeed,
  errorPrintDistributionFeed,
  loadingPrintDistributionFeed,
} from "../src/index";
import type {
  PrintDistributionEntryRecord,
  PrintDistributionPlanRecord,
  PrintDistributionSource,
  PrintDistributionRuntimeState,
} from "../src/index";
import type { SurfacePrintJobRecord } from "../src/surface-contracts";

const TENANT = makeTenantId("w142-prnt");
const NOW = "2026-04-01T00:00:00Z";
const DOC = "doc://w142-report";
const T0 = "2026-01-01T00:00:00Z";

/** A deterministic print job record. */
function job(
  overrides: Partial<SurfacePrintJobRecord> = {},
): SurfacePrintJobRecord {
  const status = overrides.status ?? "ROUTED";
  return {
    jobId: overrides.jobId ?? "prn_w142_job_01",
    tenantId: overrides.tenantId ?? TENANT,
    version: overrides.version ?? 1,
    payload: overrides.payload ?? { documentRef: DOC, targetUserId: "usr_w142_p1" },
    requiredFeatures: overrides.requiredFeatures ?? { color: true },
    printerId: overrides.printerId ?? "prn_w142_color_01",
    queuePosition: overrides.queuePosition ?? 1,
    status,
    createdAt: overrides.createdAt ?? T0,
    evidence: overrides.evidence ?? [],
    correlationId: overrides.correlationId ?? asCorrelationId("cor_w142_prnt"),
    routingReasons: overrides.routingReasons,
    contentDigest: overrides.contentDigest ?? "printdigest_ROUTED",
  };
}

/** A deterministic distribution entry. */
function entry(
  overrides: Partial<PrintDistributionEntryRecord> = {},
): PrintDistributionEntryRecord {
  return {
    userId: overrides.userId ?? "usr_w142_p1",
    job: overrides.job ?? job(),
    refused: overrides.refused ?? false,
    approvedPrinterCount: overrides.approvedPrinterCount ?? 1,
    unapprovedCapablePrinterCount: overrides.unapprovedCapablePrinterCount ?? 0,
    unapprovedCapablePrinterIds: overrides.unapprovedCapablePrinterIds ?? [],
  };
}

/** A deterministic distribution plan. */
function distributionPlan(): PrintDistributionPlanRecord {
  return {
    tenantId: TENANT,
    documentRef: DOC,
    entries: [
      entry({ userId: "usr_w142_p1" }),
      entry({
        userId: "usr_w142_p2",
        job: job({
          jobId: "prn_w142_job_02",
          status: "REFUSED",
          printerId: undefined,
          queuePosition: undefined,
          payload: { documentRef: DOC, targetUserId: "usr_w142_p2" },
          routingReasons: ["unsupported_feature:color"],
        }),
        refused: true,
        approvedPrinterCount: 0,
        unapprovedCapablePrinterCount: 1,
        unapprovedCapablePrinterIds: ["prn_w142_unapproved_01"],
      }),
    ],
    summary: { total: 2, routed: 1, refused: 1 },
  };
}

/** Compose a runtime state. */
function state(plan: PrintDistributionPlanRecord | undefined): PrintDistributionRuntimeState {
  return {
    distributions: {
      distributionFor: (tenant, doc) =>
        plan !== undefined && plan.tenantId === tenant && plan.documentRef === doc
          ? plan
          : undefined,
    },
  };
}

describe("W142 print-distribution: the loading + error feeds are machine-stable", () => {
  test("the loading feed is the pre-resolution state", () => {
    const loading = loadingPrintDistributionFeed();
    expect(loading.phase.kind).toBe("loading");
    expect(loading.lanePhase.kind).toBe("loading");
    expect(loading.data.plan).toBeNull();
  });

  test("the error feed is machine-stable", () => {
    const error = errorPrintDistributionFeed("The source refused.");
    expect(error.phase.kind).toBe("error");
    expect(error.lanePhase.kind).toBe("error");
  });
});

describe("W142 print-distribution: LOADING -> READY — the feed composes the plan view over real state", () => {
  test("a distribution plan composes the ready phase with the per-person entries", () => {
    const s = state(distributionPlan());
    const feed = composePrintDistributionFeed({ tenantId: TENANT }, s, DOC, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("ready");
    expect(feed.phase.kind).toBe("ready");
    expect(feed.data.plan).not.toBeNull();
    expect(feed.data.plan?.entries.length).toBe(2);
    // The first entry is ROUTED to an approved printer.
    expect(feed.data.plan?.entries[0]?.refused).toBe(false);
    expect(feed.data.plan?.entries[0]?.approvedPrinterCount).toBe(1);
    // The second entry is REFUSED with the routing reasons + escalation context.
    expect(feed.data.plan?.entries[1]?.refused).toBe(true);
    expect(feed.data.plan?.entries[1]?.job.routingReasons).toEqual([
      "unsupported_feature:color",
    ]);
    expect(feed.data.plan?.entries[1]?.unapprovedCapablePrinterIds).toEqual([
      "prn_w142_unapproved_01",
    ]);
  });
});

describe("W142 print-distribution: LOADING -> EMPTY — a fresh tenant is honestly empty", () => {
  test("a tenant with no distribution for the document composes the empty phase", () => {
    const s = state(undefined);
    const feed = composePrintDistributionFeed({ tenantId: TENANT }, s, DOC, {
      now: NOW,
    });
    expect(feed.lanePhase.kind).toBe("empty");
    if (feed.lanePhase.kind !== "empty") throw new Error("unreachable");
    expect(feed.lanePhase.reason).toBe("no_print_jobs");
    expect(feed.data.plan).toBeNull();
  });
});

describe("W142 print-distribution: a refused scope grammar fails closed (no data, no leak)", () => {
  test("an empty tenant id composes the scope_refused blocked phase", () => {
    const s = state(distributionPlan());
    const refused = composePrintDistributionFeed({ tenantId: "" as never }, s, DOC, {
      now: NOW,
    });
    expect(refused.lanePhase.kind).toBe("blocked");
    if (refused.lanePhase.kind !== "blocked") throw new Error("unreachable");
    expect(refused.lanePhase.reason).toBe("scope_refused");
  });

  test("a missing now instant composes the error feed", () => {
    const s = state(distributionPlan());
    const error = composePrintDistributionFeed({ tenantId: TENANT }, s, DOC, {
      now: "",
    });
    expect(error.lanePhase.kind).toBe("error");
  });
});

describe("W142 print-distribution: a source that throws composes the machine-stable error feed", () => {
  test("a throwing distributions source yields the error phase", () => {
    const throwingState: PrintDistributionRuntimeState = {
      distributions: {
        distributionFor: (): never => {
          throw new Error("source refused");
        },
      },
    };
    const feed = composePrintDistributionFeed(
      { tenantId: TENANT },
      throwingState,
      DOC,
      { now: NOW },
    );
    expect(feed.lanePhase.kind).toBe("error");
    expect(feed.phase.kind).toBe("error");
  });
});

describe("W142 print-distribution: determinism — the same runtime state composes byte-identical feeds", () => {
  test("two compositions of the same state produce the same serialized feed", () => {
    const s = state(distributionPlan());
    const first = composePrintDistributionFeed({ tenantId: TENANT }, s, DOC, {
      now: NOW,
    });
    const second = composePrintDistributionFeed({ tenantId: TENANT }, s, DOC, {
      now: NOW,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
