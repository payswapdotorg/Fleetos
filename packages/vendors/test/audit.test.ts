/**
 * W032 D1/D4 tests — the audit seam: service-boundary emission and
 * structural compatibility with W012's audit primitives.
 */

import { describe, expect, test } from "bun:test";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import {
  NOOP_VENDOR_AUDIT_SINK,
  VENDOR_AUDIT_ACTIONS,
  createInMemoryVendorAuditSink,
  createVendorService,
} from "../src/index";
import type { VendorAuditSink } from "../src/index";
import { createInMemoryVendorStore } from "../src/store";
import {
  CORR,
  CORR_2,
  TENANT_A,
  T0,
  T1,
  VND_1,
  createInput,
  ctxA,
  ctxB,
  reviseInput,
  vendor,
} from "./helpers";

describe("D1/D4: the audited service boundary", () => {
  test("vendor creation and revision each emit exactly one audit record", () => {
    const sink = createInMemoryVendorAuditSink();
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });

    const created = service.createVendor(ctxA(), createInput());
    expect(created.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const createdRecord = sink.records[0];
    expect(createdRecord?.action).toBe(VENDOR_AUDIT_ACTIONS.vendorCreated);
    expect(createdRecord?.tenantId).toBe(TENANT_A);
    expect(createdRecord?.subject).toBe(VND_1);
    expect(createdRecord?.occurredAt).toBe(T0);
    expect(createdRecord?.correlationId).toBe(CORR);
    const createdDetails = createdRecord?.details as {
      revision: number;
      name: string;
      capabilityCount: number;
      inventorySignalCount: number;
      contentHash: string;
    };
    expect(createdDetails.revision).toBe(1);
    expect(createdDetails.name).toBe("Acme Local");
    expect(createdDetails.capabilityCount).toBe(1);
    expect(createdDetails.inventorySignalCount).toBe(1);
    expect(typeof createdDetails.contentHash).toBe("string");

    const revised = service.reviseVendor(ctxA(), VND_1, reviseInput({ correlationId: CORR_2 }));
    expect(revised.ok).toBe(true);
    expect(sink.records.length).toBe(2);
    const revisedRecord = sink.records[1];
    expect(revisedRecord?.action).toBe(VENDOR_AUDIT_ACTIONS.vendorRevised);
    expect(revisedRecord?.occurredAt).toBe(T1);
    expect(revisedRecord?.correlationId).toBe(CORR_2);
    const revisedDetails = revisedRecord?.details as { fromRevision: number; toRevision: number };
    expect(revisedDetails.fromRevision).toBe(1);
    expect(revisedDetails.toRevision).toBe(2);
  });

  test("failed mutations emit NO audit records", () => {
    const sink = createInMemoryVendorAuditSink();
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });

    const bad = service.createVendor(ctxA(), createInput({ name: "" }));
    expect(bad.ok).toBe(false);
    const foreign = service.reviseVendor(ctxA(), VND_1, reviseInput());
    expect(foreign.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });

  test("the default sink is a silent no-op", () => {
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: NOOP_VENDOR_AUDIT_SINK,
    });
    expect(service.createVendor(ctxA(), createInput()).ok).toBe(true);
    expect(NOOP_VENDOR_AUDIT_SINK.append).toBeDefined();
  });

  test("audit records are tenant-scoped", () => {
    const sink = createInMemoryVendorAuditSink();
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });
    service.createVendor(ctxA(), createInput());
    service.createVendor(ctxB(), createInput({ name: "Beta Local" }));
    expect(sink.records.length).toBe(2);
    const tenants = sink.records.map((r) => r.tenantId);
    expect(tenants).toContain("tnt_testtenant000a");
    expect(tenants).toContain("tnt_testtenant000b");
  });
});

describe("D1/D4: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies VendorAuditSink structurally (no glue)", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, { source: "vendors.test" });
    const sink: VendorAuditSink = adapter;
    expect(typeof sink.append).toBe("function");

    const v = vendor();
    sink.append({
      action: VENDOR_AUDIT_ACTIONS.vendorCreated,
      tenantId: v.tenantId,
      subject: v.vendorId,
      occurredAt: T0,
      correlationId: CORR,
      details: { revision: v.revision, contentHash: v.contentHash },
    });
    const records = log.records(ctxA());
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record?.action).toBe("vendors.vendor.created");
    expect(record?.source).toBe("vendors.test");
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    expect((record?.details as { subject: string }).subject).toBe(VND_1);
  });

  test("the full W012 pattern end to end: service -> adapter -> hash-chained AuditLog, chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: VendorAuditSink = createAuditSinkAdapter(log, {
      source: "vendors.service",
    });
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });

    service.createVendor(ctxA(), createInput());
    service.reviseVendor(ctxA(), VND_1, reviseInput());

    const records = log.records(ctxA());
    expect(records.length).toBe(2);
    expect(records.map((r) => r.action)).toEqual([
      "vendors.vendor.created",
      "vendors.vendor.revised",
    ]);
    expect(log.verify(ctxA()).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  test("a cross-context read of the log sees only its own tenant's chain", () => {
    const log = createInMemoryAuditLog();
    const sink: VendorAuditSink = createAuditSinkAdapter(log, { source: "vendors.test" });
    const service = createVendorService({
      store: createInMemoryVendorStore(),
      auditSink: sink,
    });
    service.createVendor(ctxA(), createInput());
    service.createVendor(ctxB(), createInput());
    expect(log.records(ctxA()).length).toBe(1);
    expect(log.records(ctxB()).length).toBe(1);
    expect(log.verify(ctxA()).ok).toBe(true);
    expect(log.verify(ctxB()).ok).toBe(true);
  });
});
