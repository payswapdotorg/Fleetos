/**
 * W032 D2 tests — the ProcurementDemand domain model: consumption of
 * W022's DRAFT ProcurementIntentPayload + rejection evidence.
 */

import { describe, expect, test } from "bun:test";
import {
  DEMAND_MODEL_VERSION,
  DEMAND_SCHEMA_VERSION,
  buildDemand,
  createDemand,
} from "../src/demand";
import {
  createInMemoryProcurementAuditSink,
} from "../src/audit-seam";
import {
  CORR,
  DEADLINE,
  TENANT_A,
  T0,
  WL_1,
  demandInput,
  rejectionEvidence,
  stdProcurementIntent,
} from "./helpers";

describe("D2: demand build (consumes W022 DRAFT ProcurementIntentPayload)", () => {
  test("builds a frozen, deterministic demand with a deterministic id", () => {
    const built = buildDemand(TENANT_A, demandInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const d = built.demand;
    expect(d.tenantId).toBe(TENANT_A);
    expect(d.workloadId).toBe(WL_1);
    expect(d.description).toBe(stdProcurementIntent().description);
    expect(d.quantity).toBe(1);
    expect(d.createdAt).toBe(T0);
    expect(d.deadline).toBe(DEADLINE);
    expect(d.deliveryArea).toBe("us-east-1");
    expect(d.budget.usd).toBe(2000);
    expect(d.slaFloor.coverage).toBe(0.8);
    expect(d.warrantyFloor.days).toBe(90);
    expect(d.qualityFloor.score).toBe(0.7);
    expect(d.availabilityFloor.ratio).toBe(0.5);
    expect(d.allowedSubstitutions).toEqual(["class.standard_laptop"]);
    expect(d.schemaVersion).toBe(DEMAND_SCHEMA_VERSION);
    expect(d.modelVersion).toBe(DEMAND_MODEL_VERSION);
    expect(d.demandId.startsWith("dmd_")).toBe(true);
    expect(Object.isFrozen(d)).toBe(true);
  });

  test("byte-identical outputs across runs (deterministic)", () => {
    const a = buildDemand(TENANT_A, demandInput());
    const b = buildDemand(TENANT_A, demandInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.demand)).toBe(JSON.stringify(b.demand));
  });

  test("a missing workloadId on the payload is tolerated (empty workloadId)", () => {
    const built = buildDemand(TENANT_A, demandInput({
      procurementIntent: { description: "unscoped demand" },
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect((built.demand.workloadId as string).length).toBe(0);
  });

  test("rejection evidence is carried through (machine-stable)", () => {
    const evidence = [rejectionEvidence(), rejectionEvidence("class.gaming_rig", "missing_peripheral")];
    const built = buildDemand(TENANT_A, demandInput({ rejectionEvidence: evidence }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.demand.rejectionEvidence.length).toBe(2);
    expect(built.demand.rejectionEvidence[0]?.candidateId).toBe("class.engineering_workstation");
    expect(built.demand.rejectionEvidence[0]?.reason).toBe("version_below_minimum");
  });

  test("validation rejects invalid inputs with tagged ValidationError", () => {
    expect(buildDemand(TENANT_A, demandInput({ procurementIntent: { description: "" } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ at: "not-iso" })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ deadline: "not-iso" })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ deliveryArea: "" })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ quantity: 0 })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ budget: { usd: -1 } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ slaFloor: { coverage: 1.5 } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ warrantyFloor: { days: -1 } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ qualityFloor: { score: -0.1 } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ availabilityFloor: { ratio: 2 } })).ok).toBe(false);
    expect(buildDemand(TENANT_A, demandInput({ correlationId: "" as never })).ok).toBe(false);
  });
});

describe("D2: createDemand (audit-emitting boundary)", () => {
  test("emits one procurement.demand.created audit record per success", () => {
    const sink = createInMemoryProcurementAuditSink();
    const result = createDemand(TENANT_A, demandInput(), sink);
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe("procurement.demand.created");
    expect(record?.tenantId).toBe(TENANT_A);
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as { workloadId: string; quantity: number };
    expect(details.workloadId).toBe(WL_1 as string);
    expect(details.quantity).toBe(1);
  });

  test("failed builds emit no audit records", () => {
    const sink = createInMemoryProcurementAuditSink();
    const result = createDemand(TENANT_A, demandInput({ deliveryArea: "" }), sink);
    expect(result.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });
});
