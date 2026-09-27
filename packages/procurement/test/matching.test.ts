/**
 * W032 D2 tests — the matching engine: deterministic ranking, hard
 * gates, down-ranks from W022 rejection evidence.
 */

import { describe, expect, test } from "bun:test";
import { matchDemand } from "../src/matching";
import type { Vendor } from "@fleetos/vendors";
import {
  CORR,
  TENANT_A,
  T0,
  demandInput,
  matchOptions,
  rejectionEvidence,
  stdCapability,
  stdInventory,
  stdTerms,
  vendor,
  vendorInput,
} from "./helpers";
import { buildDemand } from "../src/demand";
import type { ProcurementDemand } from "../src/demand";

function demand(): ProcurementDemand {
  const built = buildDemand(TENANT_A, demandInput());
  if (!built.ok) throw new Error(built.error.message);
  return built.demand;
}

describe("D2: matching hard gates", () => {
  test("a satisfiable vendor matches with rank > 0", () => {
    const result = matchDemand(demand(), [vendor()], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.length).toBe(1);
    expect(result.rejected.length).toBe(0);
    const match = result.matches[0];
    expect(match?.satisfiable).toBe(true);
    expect(match?.rankScore > 0).toBe(true);
    expect(match?.matchedCapability?.id).toBe("class.standard_laptop");
  });

  test("region gate: vendor without the delivery area is rejected", () => {
    const v = vendor({ regions: ["eu-west-1"] });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "region_unsupported")).toBe(true);
  });

  test("deadline gate: vendor with too-long lead time is rejected", () => {
    const v = vendor({
      inventory: [stdInventory(stdCapability(), 0.9, 999)],
    });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "deadline_unsatisfiable")).toBe(true);
  });

  test("SLA floor gate: vendor with SLA below floor is rejected", () => {
    const v = vendor({ terms: stdTerms({ sla: { coverage: 0.5 } }) });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "sla_below_floor")).toBe(true);
  });

  test("warranty floor gate: vendor with warranty below floor is rejected", () => {
    const v = vendor({ terms: stdTerms({ warranty: { days: 30 } }) });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "warranty_below_floor")).toBe(true);
  });

  test("quality floor gate: vendor with quality below floor is rejected", () => {
    const v = vendor({ terms: stdTerms({ quality: { score: 0.5 } }) });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "quality_below_floor")).toBe(true);
  });

  test("availability floor gate: vendor with availability below floor is rejected", () => {
    const v = vendor({ inventory: [stdInventory(stdCapability(), 0.1, 7)] });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "availability_below_floor")).toBe(true);
  });

  test("quantity gate: vendor with zero availability is rejected", () => {
    const v = vendor({ inventory: [stdInventory(stdCapability(), 0, 7)] });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "quantity_unavailable")).toBe(true);
  });

  test("capability gate: vendor declaring no capability is rejected", () => {
    const v = vendor({ capabilities: [], inventory: [] });
    const result = matchDemand(demand(), [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected[0]?.reasons.some((r) => r.kind === "capability_unmatched")).toBe(true);
  });
});

describe("D2: matching down-ranks (W022 rejection evidence + substitutions)", () => {
  test("a vendor whose matched capability is in W022 rejection evidence is down-ranked", () => {
    const d = buildDemand(TENANT_A, demandInput({
      rejectionEvidence: [rejectionEvidence("class.standard_laptop", "version_below_minimum")],
    }));
    if (!d.ok) throw new Error(d.error.message);
    const result = matchDemand(d.demand, [vendor()], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0]?.reasons.some((r) => r.kind === "rejected_by_evidence")).toBe(true);
    // Still satisfiable (down-rank, not reject).
    expect(result.matches[0]?.satisfiable).toBe(true);
  });

  test("a vendor whose matched capability is a substitution is down-ranked", () => {
    const d = buildDemand(TENANT_A, demandInput({
      allowedSubstitutions: ["class.engineering_workstation"],
    }));
    if (!d.ok) throw new Error(d.error.message);
    // Vendor declares class.standard_laptop (not in allowedSubs) -> substitution.
    const result = matchDemand(d.demand, [vendor()], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0]?.reasons.some((r) => r.kind === "substitution_downrank")).toBe(true);
  });
});

describe("D2: matching determinism + ranking", () => {
  test("rank order: higher-quality vendor ranks first", () => {
    const low = vendor({ vendorId: "vnd_a" as never, terms: stdTerms({ quality: { score: 0.75 } }) });
    const high = vendor({ vendorId: "vnd_b" as never, terms: stdTerms({ quality: { score: 0.99 } }) });
    const result = matchDemand(demand(), [low, high], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0]?.vendor.vendorId).toBe("vnd_b");
    expect(result.matches[1]?.vendor.vendorId).toBe("vnd_a");
  });

  test("input order never changes the ranking (rankScore desc, vendorId asc)", () => {
    const v1 = vendor({ vendorId: "vnd_a" as never, terms: stdTerms({ quality: { score: 0.8 } }) });
    const v2 = vendor({ vendorId: "vnd_b" as never, terms: stdTerms({ quality: { score: 0.95 } }) });
    const forward = matchDemand(demand(), [v1, v2], matchOptions());
    const backward = matchDemand(demand(), [v2, v1], matchOptions());
    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) return;
    expect(JSON.stringify(forward.matches)).toBe(JSON.stringify(backward.matches));
  });

  test("byte-identical outputs across runs (deterministic)", () => {
    const v = vendor();
    const a = matchDemand(demand(), [v], matchOptions());
    const b = matchDemand(demand(), [v], matchOptions());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("audit emission: one record per satisfiable match (the matching trail)", () => {
    const sink = createInMemoryProcurementAuditSink();
    const result = matchDemand(demand(), [vendor()], matchOptions({
      auditSink: sink,
      correlationId: CORR,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe("procurement.match.found");
    expect(sink.records[0]?.correlationId).toBe(CORR);
  });
});

// Local import to keep the test self-contained.
import { createInMemoryProcurementAuditSink } from "../src/audit-seam";

// Help TS understand the unused import above is intentional (helpers import cycle).
void vendorInput;
