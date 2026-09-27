/**
 * W042 D2 tests — the service-vendor matching engine.
 *
 * Validates the deterministic matching: hard gates (region, capability,
 * deadline, availability, SLA, warranty floor, quality), rank score
 * (baseline + quality/SLA/warranty/availability headrooms - down-ranks),
 * machine-stable match reasons, vendor input order invariance, and the
 * consequential audit emission.
 */

import { describe, expect, test } from "bun:test";
import { asVendorId } from "@fleetos/contracts";
import type { Vendor } from "@fleetos/vendors";
import { buildVendor } from "@fleetos/vendors";
import {
  matchServiceWorkOrder,
  SERVICE_MATCH_ENGINE_VERSION,
  createInMemoryMaintenanceAuditSink,
} from "../src/index";
import { buildServiceWorkOrder } from "../src/index";
import {
  T0,
  TENANT_A,
  DEV_A1,
  CORR,
  VND_1,
  VND_2,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";

describe("D2: matchServiceWorkOrder (pure function)", () => {
  test("returns the engine version + ranked satisfiable matches", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor();
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engineVersion).toBe(SERVICE_MATCH_ENGINE_VERSION);
    expect(result.matches.length).toBe(1);
    expect(result.rejected.length).toBe(0);
    const match = result.matches[0]!;
    expect(match.vendor.vendorId).toBe(VND_1);
    expect(match.satisfiable).toBe(true);
    expect(match.rankScore > 0).toBe(true);
    expect(match.reasons.length).toBe(0); // satisfiable + no down-ranks
  });

  test("ranks by rankScore desc, vendorId asc (input order invariant)", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v1 = vendor({ vendorId: VND_1, terms: { quality: { score: 0.85 }, sla: { coverage: 0.9 }, warranty: { days: 365 } } });
    const v2 = vendor({
      vendorId: VND_2,
      terms: { quality: { score: 0.95 }, sla: { coverage: 0.99 }, warranty: { days: 730 } },
    });
    // Run with [v1, v2] then [v2, v1]: identical ordering.
    const r1 = matchServiceWorkOrder(wo.workOrder, [v1, v2], matchOptions());
    const r2 = matchServiceWorkOrder(wo.workOrder, [v2, v1], matchOptions());
    if (!r1.ok || !r2.ok) throw new Error("match failed");
    expect(r1.matches.map((m) => m.vendor.vendorId)).toEqual(r2.matches.map((m) => m.vendor.vendorId));
    // v2 has higher scores -> ranks first.
    expect(r1.matches[0]!.vendor.vendorId).toBe(VND_2);
    expect(r1.matches[1]!.vendor.vendorId).toBe(VND_1);
  });
});

describe("D2: hard gates (machine-stable reasons)", () => {
  test("region_unsupported: vendor regions exclude the service area", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput({ serviceArea: "us-west-2" }));
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({ regions: ["us-east-1"] }); // does not include us-west-2
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.matches.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    const r = result.rejected[0]!;
    expect(r.satisfiable).toBe(false);
    expect(r.reasons.some((rr) => rr.kind === "region_unsupported")).toBe(true);
  });

  test("capability_unmatched: vendor declares no matching capability", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        serviceCategory: "service.printer",
        allowedSubstitutions: [], // no allowed substitutions — vendor must declare the primary
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      capabilities: [{ kind: "service", id: "service.battery" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
    });
    // No allowed substitutions; primary is service.printer; vendor has service.battery only.
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.matches.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    const r = result.rejected[0]!;
    expect(r.reasons.some((rr) => rr.kind === "capability_unmatched")).toBe(true);
  });

  test("deadline_unsatisfiable: vendor lead time exceeds deadline days", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput({ deadline: "2026-01-08T00:00:00Z" }));
    if (!wo.ok) throw new Error(wo.error.message);
    // 7-day deadline from T0 (2026-01-01); vendor with 30-day lead time.
    const v = vendor({
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 30 },
        },
      ],
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "deadline_unsatisfiable")).toBe(true);
  });

  test("availability_unavailable: vendor availability ratio is 0", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0 },
          leadTime: { days: 7 },
        },
      ],
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "availability_unavailable")).toBe(true);
  });

  test("sla_below_floor: vendor SLA below the work order's floor", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput({ slaFloor: { coverage: 0.99 } }));
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({ terms: { quality: { score: 0.9 }, sla: { coverage: 0.8 }, warranty: { days: 365 } } });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "sla_below_floor")).toBe(true);
  });

  test("warranty_floor_unmet: vendor warranty days below the floor", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({ warrantyRules: { warrantyFloor: { days: 365 }, requireInWarranty: true } }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 90 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "warranty_floor_unmet")).toBe(true);
  });

  test("quality_below_floor: vendor quality below the floor", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput({ qualityFloor: { score: 0.99 } }));
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      terms: { quality: { score: 0.7 }, sla: { coverage: 0.95 }, warranty: { days: 365 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "quality_below_floor")).toBe(true);
  });

  test("availability_below_floor: vendor availability below the floor", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({ availabilityFloor: { ratio: 0.95 } }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.5 },
          leadTime: { days: 7 },
        },
      ],
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.rejected[0]!.reasons.some((r) => r.kind === "availability_below_floor")).toBe(true);
  });
});

describe("D2: down-ranks (machine-stable evidence)", () => {
  test("substitution_downrank: matched capability is a substitution", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        serviceCategory: "service.battery",
        allowedSubstitutions: ["service.battery_oem"],
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      capabilities: [{ kind: "service", id: "service.battery_oem" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery_oem" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.matches.length).toBe(1);
    const match = result.matches[0]!;
    expect(match.matchedCapability?.id).toBe("service.battery_oem");
    expect(match.reasons.some((r) => r.kind === "substitution_downrank")).toBe(true);
  });

  test("out_of_warranty_downrank: vendor warranty exactly meets the floor (no headroom, requireInWarranty=false)", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: false },
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 90 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.matches.length).toBe(1);
    const match = result.matches[0]!;
    expect(match.reasons.some((r) => r.kind === "out_of_warranty_downrank")).toBe(true);
  });

  test("requireInWarranty=true: vendor warranty exactly at the floor is NOT down-ranked (in-warranty headroom)", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      terms: { quality: { score: 0.9 }, sla: { coverage: 0.95 }, warranty: { days: 90 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    expect(result.matches.length).toBe(1);
    const match = result.matches[0]!;
    expect(match.reasons.some((r) => r.kind === "out_of_warranty_downrank")).toBe(false);
  });
});

describe("D2: rank score structure (baseline 0.5 + headrooms - down-ranks)", () => {
  test("a vendor exactly meeting all floors scores exactly the baseline 0.5 (no headroom)", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        slaFloor: { coverage: 0.8 },
        warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
        qualityFloor: { score: 0.7 },
        availabilityFloor: { ratio: 0.5 },
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.5 },
          leadTime: { days: 7 },
        },
      ],
      terms: { quality: { score: 0.7 }, sla: { coverage: 0.8 }, warranty: { days: 90 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    const match = result.matches[0]!;
    // Baseline 0.5; headrooms are all 0 (vendor terms == floors).
    expect(Math.abs(match.rankScore - 0.5) < 1e-5).toBe(true);
  });

  test("a vendor with headroom across every dimension scores above 0.5", () => {
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        slaFloor: { coverage: 0.8 },
        warrantyRules: { warrantyFloor: { days: 90 }, requireInWarranty: true },
        qualityFloor: { score: 0.7 },
        availabilityFloor: { ratio: 0.5 },
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
      terms: { quality: { score: 0.95 }, sla: { coverage: 0.99 }, warranty: { days: 365 } },
    });
    const result = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!result.ok) return;
    const match = result.matches[0]!;
    expect(match.rankScore > 0.5).toBe(true);
    expect(match.rankScore <= 1).toBe(true);
  });

  test("a primary match scores strictly more than a substitution match (same vendor terms)", () => {
    // Two vendors with identical terms; v1 declares the primary
    // capability ("service.battery"); v2 declares an allowed
    // substitution ("service.battery_oem"). v1's match should score
    // strictly higher than v2's match (no substitution down-rank).
    const wo = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        serviceCategory: "service.battery",
        allowedSubstitutions: ["service.battery_oem"],
      }),
    );
    if (!wo.ok) throw new Error(wo.error.message);
    const v1 = vendor({
      vendorId: VND_1,
      capabilities: [{ kind: "service", id: "service.battery" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
    });
    const v2 = vendor({
      vendorId: VND_2,
      capabilities: [{ kind: "service", id: "service.battery_oem" }],
      inventory: [
        {
          capability: { kind: "service", id: "service.battery_oem" },
          availability: { ratio: 0.9 },
          leadTime: { days: 7 },
        },
      ],
    });
    const r = matchServiceWorkOrder(wo.workOrder, [v1, v2], matchOptions());
    if (!r.ok) return;
    expect(r.matches.length).toBe(2);
    // v1 ranks first (primary, no down-rank); v2 ranks second (substitution).
    expect(r.matches[0]!.vendor.vendorId).toBe(VND_1);
    expect(r.matches[1]!.vendor.vendorId).toBe(VND_2);
    expect(r.matches[0]!.rankScore > r.matches[1]!.rankScore).toBe(true);
  });
});

describe("D2: audit emission (one record per satisfiable match)", () => {
  test("the matching run emits a maintenance.match.recorded record per satisfiable match", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor();
    const result = matchServiceWorkOrder(wo.workOrder, [v], {
      ...matchOptions(),
      auditSink: sink,
    });
    if (!result.ok) return;
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe("maintenance.match.recorded");
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(wo.workOrder.workOrderId);
    expect(record.occurredAt).toBe(T0);
    expect(record.correlationId).toBe(CORR);
    expect(record.details.vendorId).toBe(VND_1);
  });

  test("rejected vendors are NOT audited (only satisfiable matches emit)", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput({ serviceArea: "us-west-2" }));
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor({ regions: ["us-east-1"] }); // rejected on region
    const result = matchServiceWorkOrder(wo.workOrder, [v], {
      ...matchOptions(),
      auditSink: sink,
    });
    if (!result.ok) return;
    expect(sink.records.length).toBe(0); // no satisfiable matches
  });
});

describe("D2: validation failures (tagged ValidationError)", () => {
  test("non-ISO at fails validation", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const result = matchServiceWorkOrder(wo.workOrder, [vendor()], {
      ...matchOptions(),
      at: "not-a-date",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });

  test("missing correlationId fails validation", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const result = matchServiceWorkOrder(wo.workOrder, [vendor()], {
      at: T0,
      correlationId: "" as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });

  test("non-array vendors fails validation", () => {
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const result = matchServiceWorkOrder(wo.workOrder, "not-an-array" as never, matchOptions());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("ValidationError");
  });
});

// Re-exports for the type checker (suppress unused).
export type { Vendor };
void buildVendor;
void asVendorId;
void DEV_A1;
