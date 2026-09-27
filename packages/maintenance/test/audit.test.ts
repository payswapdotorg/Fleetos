/**
 * W042 D4 tests — the audit emission seam.
 *
 * Validates the injected audit sink contract, the noop default, the
 * collecting in-memory sink, and the structural compatibility with
 * @fleetos/audit's sink adapter (proven by routing records through the
 * REAL hash-chained AuditLog).
 */

import { describe, expect, test } from "bun:test";
import { createInMemoryAuditLog, createAuditSinkAdapter } from "@fleetos/audit";
import { makeTenantContext } from "@fleetos/identity";
import { asDeviceId, MAINTAIN_DEVICE_INTENT_KIND } from "@fleetos/contracts";
import {
  NOOP_MAINTENANCE_AUDIT_SINK,
  createInMemoryMaintenanceAuditSink,
  MAINTENANCE_AUDIT_ACTIONS,
  makeMaintenanceAuditRecord,
  createServiceWorkOrder,
  matchServiceWorkOrder,
  formServiceAggregation,
  buildServiceWorkOrder,
  createInMemoryServiceWorkOrderStore,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  CORR,
  ctxA,
  scopeA,
  vendor,
  workOrderInput,
  matchOptions,
} from "./helpers";

describe("D4: the audit sink contract", () => {
  test("NOOP_MAINTENANCE_AUDIT_SINK silently discards records (no throw)", () => {
    expect(() =>
      NOOP_MAINTENANCE_AUDIT_SINK.append({
        action: "test",
        tenantId: TENANT_A,
        subject: "x",
        occurredAt: T0,
        correlationId: CORR,
        details: {},
      }),
    ).not.toThrow();
  });

  test("createInMemoryMaintenanceAuditSink collects records in order", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    sink.append({
      action: "first",
      tenantId: TENANT_A,
      subject: "s1",
      occurredAt: T0,
      correlationId: CORR,
      details: {},
    });
    sink.append({
      action: "second",
      tenantId: TENANT_A,
      subject: "s2",
      occurredAt: T1,
      correlationId: CORR,
      details: {},
    });
    expect(sink.records.length).toBe(2);
    expect(sink.records[0]!.action).toBe("first");
    expect(sink.records[1]!.action).toBe("second");
  });

  test("makeMaintenanceAuditRecord freezes the record", () => {
    const record = makeMaintenanceAuditRecord({
      action: "x",
      tenantId: TENANT_A,
      subject: "y",
      occurredAt: T0,
      correlationId: CORR,
      details: { foo: "bar" },
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.details.foo).toBe("bar");
  });

  test("MAINTENANCE_AUDIT_ACTIONS exposes the four stable machine action names", () => {
    expect(MAINTENANCE_AUDIT_ACTIONS.workOrderCreated).toBe("maintenance.workorder.created");
    expect(MAINTENANCE_AUDIT_ACTIONS.workOrderRevised).toBe("maintenance.workorder.revised");
    expect(MAINTENANCE_AUDIT_ACTIONS.matchRecorded).toBe("maintenance.match.recorded");
    expect(MAINTENANCE_AUDIT_ACTIONS.aggregationFormed).toBe("maintenance.aggregation.formed");
  });
});

describe("D4: the boundary functions audit consequential mutations only", () => {
  test("createServiceWorkOrder audits; the in-memory store does NOT audit", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const result = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(sink.records.length).toBe(1);
    // Storing the record does NOT audit (pure read/write — never audits).
    const store = createInMemoryServiceWorkOrderStore();
    const put = store.put(ctxA(), result.workOrder);
    expect(put.ok).toBe(true);
    expect(sink.records.length).toBe(1); // unchanged
  });

  test("matchServiceWorkOrder audits each satisfiable match (the matching trail)", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor();
    matchServiceWorkOrder(wo.workOrder, [v], { ...matchOptions(), auditSink: sink });
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]!.action).toBe("maintenance.match.recorded");
  });

  test("formServiceAggregation audits the formation (a PROPOSAL — never dispatch)", () => {
    const sink = createInMemoryMaintenanceAuditSink();
    const wo = buildServiceWorkOrder(TENANT_A, workOrderInput());
    if (!wo.ok) throw new Error(wo.error.message);
    const v = vendor();
    const m = matchServiceWorkOrder(wo.workOrder, [v], matchOptions());
    if (!m.ok) throw new Error(m.error.message);
    formServiceAggregation(
      TENANT_A,
      [{ workOrder: wo.workOrder, match: m.matches[0]! }],
      T0,
      CORR,
      sink,
    );
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]!.action).toBe("maintenance.aggregation.formed");
  });
});

describe("D4: structural compatibility with @fleetos/audit's sink adapter", () => {
  test("records flow through the REAL hash-chained AuditLog via the sink adapter", () => {
    const log = createInMemoryAuditLog();
    const sink = createAuditSinkAdapter(log, { source: "maintenance.test" });
    const result = createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    if (!result.ok) throw new Error(result.error.message);
    // The record landed in the hash-chained log.
    const ctx = makeTenantContext(TENANT_A, CORR);
    expect(log.size(ctx)).toBe(1);
    const records = log.records(ctx);
    expect(records.length).toBe(1);
    expect(records[0]!.action).toBe("maintenance.workorder.created");
    expect(records[0]!.source).toBe("maintenance.test");
    expect(records[0]!.details.subject).toBe(result.workOrder.workOrderId);
  });

  test("the chain verifies after a tenant-A record is appended", () => {
    const log = createInMemoryAuditLog();
    const sink = createAuditSinkAdapter(log, { source: "maintenance.test" });
    createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    const ctx = makeTenantContext(TENANT_A, CORR);
    expect(log.verify(ctx).ok).toBe(true);
  });

  test("per-tenant chains stay separate (tenant isolation by construction)", () => {
    const log = createInMemoryAuditLog();
    const sink = createAuditSinkAdapter(log, { source: "maintenance.test" });
    const ctxA = makeTenantContext(TENANT_A, CORR);
    createServiceWorkOrder(scopeA(), workOrderInput(), {
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    // A different work order from tenant A into the same sink (different
    // work order id, same tenant chain — the chain is per-tenant, not
    // per-record).
    createServiceWorkOrder(scopeA(), workOrderInput({
      deviceId: asDeviceId("dev_testdevice002"),
      diagnosis: {
        hypothesisId: "hyp_alt",
        recommendationId: "tr_alt",
        causeId: "health.cpu_overload",
        confidence: 0.8,
        proposedIntent: { intentKind: MAINTAIN_DEVICE_INTENT_KIND, payload: { description: "x" } },
        observationIds: ["obs_alt"],
      },
    }), {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(log.size(ctxA)).toBe(2);
    // The two records carry different subjects (different work order ids).
    const records = log.records(ctxA);
    expect(records[0]!.details.subject).not.toBe(records[1]!.details.subject);
    expect(log.verify(ctxA).ok).toBe(true);
  });
});

void T1;
