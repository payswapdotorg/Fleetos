/**
 * W042 D1 tests — the ServiceWorkOrder domain model.
 *
 * Validates the versioned record, warranty-aware fields, replacement-
 * escalation linkage, and the audit-emitting boundary functions.
 */

import { describe, expect, test } from "bun:test";
import { MAINTAIN_DEVICE_INTENT_KIND, REPLACEMENT_INTENT_KIND } from "@fleetos/contracts";
import {
  buildServiceWorkOrder,
  buildServiceWorkOrderRevision,
  createServiceWorkOrder,
  reviseServiceWorkOrder,
  classifyWarrantyEligibility,
  WORK_ORDER_SCHEMA_VERSION,
  WORK_ORDER_MODEL_VERSION,
  NOOP_MAINTENANCE_AUDIT_SINK,
  createInMemoryMaintenanceAuditSink,
} from "../src/index";
import type { CreateServiceWorkOrderInput } from "../src/index";
import {
  T0,
  T1,
  DEADLINE,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  CORR,
  scopeA,
  scopeB,
  workOrderInput,
  stdDiagnosis,
} from "./helpers";

describe("D1: buildServiceWorkOrder (pure builder)", () => {
  test("builds a revision-1 work order with a deterministic id + content digest", () => {
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.workOrder.revision).toBe(1);
    expect(built.workOrder.workOrderId).toMatch(/^swo_[0-9a-f]{8}$/);
    expect(built.workOrder.contentDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(built.workOrder.tenantId).toBe(TENANT_A);
    expect(built.workOrder.deviceId).toBe(DEV_A1);
    expect(built.workOrder.serviceArea).toBe("us-east-1");
    expect(built.workOrder.deadline).toBe(DEADLINE);
    expect(built.workOrder.serviceCategory).toBe("service.battery");
    expect(built.workOrder.schemaVersion).toBe(WORK_ORDER_SCHEMA_VERSION);
    expect(built.workOrder.modelVersion).toBe(WORK_ORDER_MODEL_VERSION);
  });

  test("the same inputs produce the byte-identical work order (id + digest)", () => {
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput());
    const b = buildServiceWorkOrder(TENANT_A, workOrderInput());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.workOrder.workOrderId).toBe(b.workOrder.workOrderId);
    expect(a.workOrder.contentDigest).toBe(b.workOrder.contentDigest);
  });

  test("observation ids are sorted for byte-identical determinism", () => {
    const built = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        diagnosis: {
          ...stdDiagnosis(),
          observationIds: ["obs_b", "obs_a", "obs_c"],
        },
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.workOrder.diagnosis.observationIds).toEqual(["obs_a", "obs_b", "obs_c"]);
  });

  test("different tenants produce different ids (tenant scope binds the identity)", () => {
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput());
    const b = buildServiceWorkOrder(TENANT_B, workOrderInput());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.workOrder.workOrderId).not.toBe(b.workOrder.workOrderId);
    expect(a.workOrder.tenantId).toBe(TENANT_A);
    expect(b.workOrder.tenantId).toBe(TENANT_B);
  });

  test("different service categories produce different ids", () => {
    const a = buildServiceWorkOrder(TENANT_A, workOrderInput({ serviceCategory: "service.battery" }));
    const b = buildServiceWorkOrder(TENANT_A, workOrderInput({ serviceCategory: "service.storage" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.workOrder.workOrderId).not.toBe(b.workOrder.workOrderId);
  });

  test("different diagnosis evidence produces different ids", () => {
    const a = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({ diagnosis: { ...stdDiagnosis(), hypothesisId: "hyp_a" } }),
    );
    const b = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({ diagnosis: { ...stdDiagnosis(), hypothesisId: "hyp_b" } }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.workOrder.workOrderId).not.toBe(b.workOrder.workOrderId);
  });
});

describe("D1: replacement-escalation linkage", () => {
  test("a work order with a replacement link carries the DRAFT ReplacementIntentPayload", () => {
    const built = buildServiceWorkOrder(
      TENANT_A,
      workOrderInput({
        replacementLink: {
          intentKind: REPLACEMENT_INTENT_KIND,
          payload: { deviceId: DEV_A1 as string, reason: "Hardware failure indicators." },
          diagnosisRefs: {
            hypothesisId: "hyp_test0001",
            recommendationId: "tr_test0001",
            causeId: "health.hardware_failing",
            observationIds: ["obs_test0001", "obs_test0002"],
          },
        },
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.workOrder.replacementLink).toBeDefined();
    expect(built.workOrder.replacementLink?.intentKind).toBe(REPLACEMENT_INTENT_KIND);
    expect(built.workOrder.replacementLink?.payload.reason).toBe(
      "Hardware failure indicators.",
    );
    expect(built.workOrder.replacementLink?.diagnosisRefs.observationIds).toEqual([
      "obs_test0001",
      "obs_test0002",
    ]);
  });

  test("a work order without a replacement link omits the field", () => {
    const built = buildServiceWorkOrder(TENANT_A, workOrderInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.workOrder.replacementLink).toBeUndefined();
  });
});

describe("D1: buildServiceWorkOrderRevision (pure builder)", () => {
  test("appends revision+1 with supersedes pointing at the prior", () => {
    const v1 = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!v1.ok) throw new Error(v1.error.message);
    const v2 = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: T1,
      correlationId: CORR,
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.workOrder.revision).toBe(2);
    expect(v2.workOrder.supersedes).toBe(v1.workOrder.workOrderId);
    expect(v2.workOrder.workOrderId).toBe(v1.workOrder.workOrderId);
    expect(v2.workOrder.serviceArea).toBe("us-west-2");
    expect(v2.workOrder.tenantId).toBe(v1.workOrder.tenantId);
    expect(v2.workOrder.diagnosis).toBe(v1.workOrder.diagnosis); // inherited
    expect(v2.workOrder.contentDigest).not.toBe(v1.workOrder.contentDigest);
  });

  test("inherits all fields not supplied in the input", () => {
    const v1 = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!v1.ok) throw new Error(v1.error.message);
    const v2 = buildServiceWorkOrderRevision(v1.workOrder, {
      at: T1,
      correlationId: CORR,
    });
    if (!v2.ok) throw new Error(v2.error.message);
    expect(v2.workOrder.serviceArea).toBe(v1.workOrder.serviceArea);
    expect(v2.workOrder.deadline).toBe(v1.workOrder.deadline);
    expect(v2.workOrder.serviceCategory).toBe(v1.workOrder.serviceCategory);
    expect(v2.workOrder.slaFloor).toEqual(v1.workOrder.slaFloor);
    expect(v2.workOrder.warrantyRules).toEqual(v1.workOrder.warrantyRules);
    expect(v2.workOrder.allowedSubstitutions).toEqual(v1.workOrder.allowedSubstitutions);
  });

  test("the same revision input produces the byte-identical revision", () => {
    const v1 = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!v1.ok) throw new Error(v1.error.message);
    const a = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: T1,
      correlationId: CORR,
    });
    const b = buildServiceWorkOrderRevision(v1.workOrder, {
      serviceArea: "us-west-2",
      at: T1,
      correlationId: CORR,
    });
    if (!a.ok || !b.ok) throw new Error("revision failed");
    expect(a.workOrder.contentDigest).toBe(b.workOrder.contentDigest);
  });
});

describe("D1: validation failures (tagged ValidationError)", () => {
  test("missing deviceId fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      deviceId: "" as never,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });

  test("missing diagnosis evidence fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      diagnosis: undefined as never,
    } as CreateServiceWorkOrderInput);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });

  test("wrong intentKind in proposedIntent fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      diagnosis: {
        ...stdDiagnosis(),
        proposedIntent: {
          intentKind: REPLACEMENT_INTENT_KIND, // wrong kind for the maintenance arm
          payload: { reason: "x" },
        } as never,
      },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });

  test("confidence out of [0, 1] fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      diagnosis: { ...stdDiagnosis(), confidence: 1.5 },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });

  test("non-ISO deadline fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      deadline: "not-a-date",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });

  test("negative warranty floor days fails validation", () => {
    const bad = buildServiceWorkOrder(TENANT_A, {
      ...workOrderInput(),
      warrantyRules: { warrantyFloor: { days: -1 }, requireInWarranty: true },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
  });
});

describe("D1: createServiceWorkOrder (audit-emitting boundary)", () => {
  test("emits a maintenance.workorder.created audit record to the sink", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const result = createServiceWorkOrder(
      scopeA(),
      workOrderInput(),
      { at: T0, correlationId: CORR, auditSink: sink },
    );
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0]!;
    expect(record.action).toBe("maintenance.workorder.created");
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(result.ok ? result.workOrder.workOrderId : "");
    expect(record.occurredAt).toBe(T0);
    expect(record.correlationId).toBe(CORR);
  });

  test("the default sink (no-op) does not throw and produces the work order", () => {
    const result = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
  });

  test("context-free scope is rejected at the boundary", () => {
    const result = createServiceWorkOrder(
      undefined as never,
      workOrderInput(),
      { at: T0, correlationId: CORR, auditSink: NOOP_MAINTENANCE_AUDIT_SINK },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("DomainError");
  });
});

describe("D1: reviseServiceWorkOrder (audit-emitting boundary)", () => {
  test("emits a maintenance.workorder.revised audit record to the sink", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const v1 = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    if (!v1.ok) throw new Error(v1.error.message);
    const v2 = reviseServiceWorkOrder(
      scopeA(),
      v1.workOrder,
      { serviceArea: "us-west-2" },
      { at: T1, correlationId: CORR, auditSink: sink },
    );
    expect(v2.ok).toBe(true);
    expect(sink.records.length).toBe(2);
    const record = sink.records[1]!;
    expect(record.action).toBe("maintenance.workorder.revised");
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.subject).toBe(v1.workOrder.workOrderId);
    expect(record.occurredAt).toBe(T1);
  });

  test("cross-tenant revision is refused with tenant_mismatch", () => {
    const v1 = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
    });
    if (!v1.ok) throw new Error(v1.error.message);
    const cross = reviseServiceWorkOrder(
      scopeB(),
      v1.workOrder,
      { serviceArea: "us-west-2" },
      { at: T1, correlationId: CORR },
    );
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("DomainError");
    if (cross.error.kind !== "DomainError") return;
    expect(cross.error.invariant).toBe("tenant_mismatch");
  });
});

describe("D1: warranty-eligibility classification", () => {
  test("a vendor above the floor is in_warranty_headroom", () => {
    const standing = classifyWarrantyEligibility(365, {
      warrantyFloor: { days: 90 },
      requireInWarranty: true,
    });
    expect(standing).toBe("in_warranty_headroom");
  });

  test("a vendor exactly at the floor is in_warranty_headroom", () => {
    const standing = classifyWarrantyEligibility(90, {
      warrantyFloor: { days: 90 },
      requireInWarranty: true,
    });
    expect(standing).toBe("in_warranty_headroom");
  });

  test("a vendor below the floor is warranty_floor_unmet", () => {
    const standing = classifyWarrantyEligibility(89, {
      warrantyFloor: { days: 90 },
      requireInWarranty: true,
    });
    expect(standing).toBe("warranty_floor_unmet");
  });

  test("a vendor at 0 days with a 0-day floor is in_warranty_headroom (edge case)", () => {
    const standing = classifyWarrantyEligibility(0, {
      warrantyFloor: { days: 0 },
      requireInWarranty: false,
    });
    expect(standing).toBe("in_warranty_headroom");
  });
});

void MAINTAIN_DEVICE_INTENT_KIND;
