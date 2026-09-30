/**
 * W100B print-distribution domain tests — the product sentence made a
 * domain guarantee:
 *
 *   "selected people + document -> each person's approved printer
 *    receives the job."
 *
 * Proven here:
 *   - one job per person, ROUTED to an approved, tenant-matching,
 *     capability-satisfying printer of THAT person;
 *   - unapproved printers are NEVER promoted (a person whose approved
 *     pool cannot satisfy the features receives a REFUSED job with
 *     machine-stable reasons — visible, never emulated);
 *   - the observable escalation context (capable-but-unapproved
 *     printers are counted and named);
 *   - determinism (input-order invariance; entries sorted by userId);
 *   - fail-closed validation (empty/duplicate people, malformed
 *     printers) and the summary audit record.
 */

import { test, expect } from "bun:test";
import { asUserId } from "@fleetos/contracts";
import {
  createInMemoryActionAuditSink,
  planPrintDistribution,
  printJobId,
  routePrintJob,
  supportsPrintFeatures,
} from "../src/index";
import type { PrintDistributionPerson } from "../src/index";
import {
  CORR,
  T0,
  TENANT_A,
  TENANT_B,
  USER_1,
  evidenceRef,
  printer,
} from "./helpers";

/** A second deterministic person. */
const USER_2 = asUserId("usr_testuser00002");
/** A third deterministic person. */
const USER_3 = asUserId("usr_testuser00003");

/** The distributed document. */
const DOC = "doc://w100b-handbook";

/** Two selected people, each with their own approved printer pool. */
function people(): PrintDistributionPerson[] {
  return [
    {
      userId: USER_1,
      printers: [
        printer(TENANT_A, "prn_w100b_1a", { approved: true, capabilities: { color: true, duplex: true } }),
        printer(TENANT_A, "prn_w100b_1b", { approved: false, capabilities: { color: true, duplex: true } }),
      ],
    },
    {
      userId: USER_2,
      printers: [
        // USER_2 has NO approved printer; one unapproved printer would
        // satisfy the features (escalation context).
        printer(TENANT_A, "prn_w100b_2a", { approved: false, capabilities: { color: true, duplex: true } }),
      ],
    },
  ];
}

/** A canonical valid input. */
function input(overrides: Partial<Parameters<typeof planPrintDistribution>[0]> = {}) {
  return {
    tenantId: TENANT_A,
    documentRef: DOC,
    requiredFeatures: { color: true } as const,
    people: people(),
    at: T0,
    correlationId: CORR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The core product sentence
// ---------------------------------------------------------------------------

test("each selected person's job routes to an approved printer of that person", () => {
  const result = planPrintDistribution(input());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const { plan } = result;
  expect(plan.personCount).toBe(2);
  expect(plan.routedCount).toBe(1);
  expect(plan.refusedCount).toBe(1);

  const first = plan.entries.find((entry) => entry.userId === USER_1);
  expect(first).toBeDefined();
  if (first === undefined) return;
  expect(first.refused).toBe(false);
  expect(first.job.status).toBe("ROUTED");
  expect(first.job.printerId).toBe("prn_w100b_1a");
  expect(first.job.payload.documentRef).toBe(DOC);
  expect(first.job.payload.targetUserId).toBe(USER_1);
  // The unapproved sibling printer is named as escalation context — never routed.
  expect(first.unapprovedCapablePrinterIds).toEqual(["prn_w100b_1b"]);
  expect(first.approvedPrinterCount).toBe(1);
});

test("a person without an approved capable printer gets a VISIBLE REFUSED job (never an unapproved fallback)", () => {
  const result = planPrintDistribution(input());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const second = result.plan.entries.find((entry) => entry.userId === USER_2);
  expect(second).toBeDefined();
  if (second === undefined) return;
  expect(second.refused).toBe(true);
  expect(second.job.status).toBe("REFUSED");
  expect(second.job.printerId).toBeUndefined();
  expect(second.job.routingReasons).toEqual([
    "no_approved_printer",
    "unsupported_feature:color",
  ]);
  // Escalation context: the unapproved capable printer is named.
  expect(second.unapprovedCapablePrinterIds).toEqual(["prn_w100b_2a"]);
  expect(second.unapprovedCapablePrinterCount).toBe(1);
});

test("a person with approved printers that lack the required features refuses with no_capable_approved_printer", () => {
  const person: PrintDistributionPerson = {
    userId: USER_3,
    printers: [printer(TENANT_A, "prn_w100b_3a", { approved: true, capabilities: { color: false } })],
  };
  const result = planPrintDistribution(input({ people: [person], requiredFeatures: { color: true, duplex: true } }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const entry = result.plan.entries[0];
  expect(entry.refused).toBe(true);
  expect(entry.job.routingReasons).toEqual([
    "no_capable_approved_printer",
    "unsupported_feature:color",
    "unsupported_feature:duplex",
  ]);
});

test("foreign-tenant printers never enter a person's routable pool (no side channel)", () => {
  const person: PrintDistributionPerson = {
    userId: USER_1,
    printers: [
      // Only a tenant-B approved capable printer exists: the job REFUSES
      // (tenant isolation outranks approval + capability).
      printer(TENANT_B, "prn_w100b_foreign", { approved: true, capabilities: { color: true } }),
    ],
  };
  const result = planPrintDistribution(input({ people: [person] }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const entry = result.plan.entries[0];
  expect(entry.refused).toBe(true);
  expect(entry.approvedPrinterCount).toBe(0);
  expect(entry.unapprovedCapablePrinterIds).toEqual([]);
  expect(entry.job.printerId).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Determinism + identity discipline
// ---------------------------------------------------------------------------

test("entries are sorted by userId ascending regardless of input order", () => {
  const reversed = [...people()].reverse();
  const a = planPrintDistribution(input());
  const b = planPrintDistribution(input({ people: reversed }));
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.plan.entries.map((e) => e.userId)).toEqual([USER_1, USER_2]);
  expect(b.plan.entries.map((e) => e.userId)).toEqual([USER_1, USER_2]);
  expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
});

test("the same inputs produce a byte-identical plan (pure function)", () => {
  const a = planPrintDistribution(input());
  const b = planPrintDistribution(input());
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
});

test("per-person job ids follow the router's printJobId discipline (same doc + person + instant = same id)", () => {
  const result = planPrintDistribution(input());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  for (const entry of result.plan.entries) {
    const expected = printJobId(TENANT_A, { documentRef: DOC, targetUserId: entry.userId }, T0);
    expect(entry.job.jobId).toBe(expected);
  }
});

test("per-person routing matches calling routePrintJob directly on that person's approved pool", () => {
  const direct = routePrintJob({
    payload: { documentRef: DOC, targetUserId: USER_1 },
    requiredFeatures: { color: true },
    tenantId: TENANT_A,
    printers: [printer(TENANT_A, "prn_w100b_1a")],
    at: T0,
    correlationId: CORR,
  });
  const result = planPrintDistribution(input());
  expect(result.ok).toBe(true);
  expect(direct.ok).toBe(true);
  if (!result.ok || !direct.ok) return;
  const first = result.plan.entries.find((entry) => entry.userId === USER_1);
  expect(first?.job.jobId).toBe(direct.job.jobId);
  expect(first?.job.printerId).toBe(direct.job.printerId);
  expect(first?.job.contentDigest).toBe(direct.job.contentDigest);
});

// ---------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------

test("an empty people selection REFUSES (non_empty_array_required)", () => {
  const result = planPrintDistribution(input({ people: [] }));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("ValidationError");
  if (result.error.kind !== "ValidationError") return;
  expect(result.error.code).toBe("action.print.invalid_request");
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/people:non_empty_array_required");
});

test("duplicate people REFUSE (duplicate_person)", () => {
  const result = planPrintDistribution(input({ people: [...people(), people()[0]!] }));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("ValidationError");
  if (result.error.kind !== "ValidationError") return;
  expect(result.error.failures.map((f) => `${f.path}:${f.reason}`)).toContain("/people/2/userId:duplicate_person");
});

test("malformed people and printers REFUSE with machine-stable paths", () => {
  const bad = planPrintDistribution(
    input({
      people: [
        { userId: "" as never, printers: [] },
        { userId: USER_2, printers: ["not-a-printer" as never] },
      ],
      documentRef: "",
      at: "not-a-date",
    }),
  );
  expect(bad.ok).toBe(false);
  if (bad.ok) return;
  expect(bad.error.kind).toBe("ValidationError");
  if (bad.error.kind !== "ValidationError") return;
  const reasons = bad.error.failures.map((f) => f.reason);
  expect(reasons).toContain("non_empty_string_required");
  expect(reasons).toContain("printer_descriptor_invalid");
  expect(reasons).toContain("not_iso");
});

// ---------------------------------------------------------------------------
// Audit + evidence
// ---------------------------------------------------------------------------

test("the distribution emits ONE summary audit record; per-person routings stay on the router", () => {
  const sink = createInMemoryActionAuditSink();
  const result = planPrintDistribution(input({ auditSink: sink }));
  expect(result.ok).toBe(true);
  const summaries = sink.records.filter((r) => r.action === "action.print.distribution.planned");
  expect(summaries.length).toBe(1);
  const details = summaries[0]?.details as Record<string, unknown>;
  expect(details["documentRef"]).toBe(DOC);
  expect(details["personCount"]).toBe(2);
  expect(details["routedCount"]).toBe(1);
  expect(details["refusedCount"]).toBe(1);
  // The planner routes per-person with the no-op sink by design (each
  // entry's routing is an internal composition; the summary is the
  // distribution-level record). No per-person route records here:
  const routed = sink.records.filter((r) => r.action === "action.print.job.routed");
  expect(routed.length).toBe(0);
});

test("evidence refs attach verbatim to every per-person job", () => {
  const evidence = [evidenceRef("evidence/w100b-dist-1")];
  const result = planPrintDistribution(input({ evidence }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  for (const entry of result.plan.entries) {
    expect(entry.job.evidence).toEqual(evidence);
  }
});

// ---------------------------------------------------------------------------
// Edge: refusal reasons mirror the router's convention
// ---------------------------------------------------------------------------

test("the refused reasons enumerate the required features exactly like the router", () => {
  const result = planPrintDistribution(
    input({ people: [{ userId: USER_3, printers: [] }], requiredFeatures: { color: true, staple: true } }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const entry = result.plan.entries[0];
  expect(entry.job.routingReasons).toEqual([
    "no_approved_printer",
    "unsupported_feature:color",
    "unsupported_feature:staple",
  ]);
});

test("supportsPrintFeatures remains the capability gate (the distribution never emulates)", () => {
  // The planner's refusal discipline is anchored on the SAME gate the
  // router uses — the local mirror of the W041 invariant.
  expect(supportsPrintFeatures({ color: true }, { color: true })).toBe(true);
  expect(supportsPrintFeatures({ color: true }, { color: false })).toBe(false);
  expect(supportsPrintFeatures({ color: true }, {})).toBe(false);
});
