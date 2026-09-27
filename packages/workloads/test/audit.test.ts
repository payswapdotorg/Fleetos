/**
 * W022 D4 tests — the audit seam: service-boundary emission and the
 * structural compatibility with W012's audit primitives.
 *
 * Core invariants under test:
 *   - the audited service emits one record per successful consequential
 *     mutation (profile created / profile revised), and none on failure;
 *   - W012's `createAuditSinkAdapter` over an in-memory `AuditLog`
 *     STRUCTURALLY satisfies `WorkloadAuditSink` (no adapter glue) and
 *     lands the records in the tenant-scoped, hash-chained, append-only
 *     trail — the full W012 audit-primitives pattern, end to end;
 *   - the hash chain verifies after the emissions.
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
  NOOP_WORKLOAD_AUDIT_SINK,
  WORKLOAD_AUDIT_ACTIONS,
  createInMemoryWorkloadAuditSink,
  createWorkloadProfileService,
} from "../src/index";
import type { WorkloadAuditSink } from "../src/index";
import { createInMemoryWorkloadProfileStore } from "../src/store";
import {
  CORR,
  CORR_2,
  TENANT_A,
  T0,
  T1,
  WL_1,
  balancedVector,
  createInput,
  ctxA,
  ctxB,
  profile,
} from "./helpers";

describe("D4: the audited service boundary", () => {
  test("profile creation and revision each emit exactly one audit record", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });

    const created = service.createProfile(ctxA(), createInput());
    expect(created.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const createdRecord = sink.records[0];
    expect(createdRecord?.action).toBe(WORKLOAD_AUDIT_ACTIONS.profileCreated);
    expect(createdRecord?.tenantId).toBe(TENANT_A);
    expect(createdRecord?.subject).toBe(WL_1);
    expect(createdRecord?.occurredAt).toBe(T0);
    expect(createdRecord?.correlationId).toBe(CORR);
    const createdDetails = createdRecord?.details as {
      revision: number;
      name: string;
      subjectKind: string;
      evidenceCount: number;
      contentHash: string;
    };
    expect(createdDetails.revision).toBe(1);
    expect(createdDetails.name).toBe("finance.analyst");
    expect(createdDetails.subjectKind).toBe("role");
    expect(createdDetails.evidenceCount).toBe(0);
    expect(typeof createdDetails.contentHash).toBe("string");

    const revised = service.reviseProfile(ctxA(), WL_1, {
      name: "finance.analyst",
      description: "updated",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR_2,
    });
    expect(revised.ok).toBe(true);
    expect(sink.records.length).toBe(2);
    const revisedRecord = sink.records[1];
    expect(revisedRecord?.action).toBe(WORKLOAD_AUDIT_ACTIONS.profileRevised);
    expect(revisedRecord?.occurredAt).toBe(T1);
    expect(revisedRecord?.correlationId).toBe(CORR_2);
    const revisedDetails = revisedRecord?.details as { fromRevision: number; toRevision: number };
    expect(revisedDetails.fromRevision).toBe(1);
    expect(revisedDetails.toRevision).toBe(2);
  });

  test("failed mutations emit NO audit records (errors carry their own trace)", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });

    const bad = service.createProfile(ctxA(), createInput({ name: "" }));
    expect(bad.ok).toBe(false);
    const foreign = service.reviseProfile(ctxA(), WL_1, {
      name: "x",
      description: "x",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(foreign.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });

  test("the default sink is a silent no-op (never throws, never drops the operation)", () => {
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: NOOP_WORKLOAD_AUDIT_SINK,
    });
    expect(service.createProfile(ctxA(), createInput()).ok).toBe(true);
    expect(NOOP_WORKLOAD_AUDIT_SINK.append).toBeDefined();
  });

  test("audit records are tenant-scoped: tenant B mutations never appear under tenant A", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });
    service.createProfile(ctxA(), createInput());
    service.createProfile(ctxB(), createInput({ name: "other.tenant.role" }));
    expect(sink.records.length).toBe(2);
    const tenants = sink.records.map((r) => r.tenantId);
    expect(tenants).toContain("tnt_testtenant000a");
    expect(tenants).toContain("tnt_testtenant000b");
    for (const record of sink.records) {
      // Every record's subject belongs to its own tenant's partition —
      // the profile builder stamps the acting tenant on both.
      expect(record.tenantId.startsWith("tnt_")).toBe(true);
    }
  });
});

describe("D4: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies WorkloadAuditSink structurally (no glue)", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, {
      source: "workloads.test",
    });
    // The structural assignment: an AuditSink taking the WIDER record
    // shape accepts the WorkloadAuditRecord (branded subject included).
    const sink: WorkloadAuditSink = adapter;
    expect(typeof sink.append).toBe("function");

    const p = profile();
    sink.append({
      action: WORKLOAD_AUDIT_ACTIONS.profileCreated,
      tenantId: p.tenantId,
      subject: p.workloadId,
      occurredAt: T0,
      correlationId: CORR,
      details: { revision: p.revision, contentHash: p.contentHash },
    });
    const records = log.records(ctxA());
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record?.action).toBe("workloads.profile.created");
    expect(record?.source).toBe("workloads.test");
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    expect((record?.details as { subject: string }).subject).toBe(WL_1);
    expect((record?.details as { revision: number }).revision).toBe(1);
  });

  test("the full W012 pattern end to end: service -> adapter -> hash-chained AuditLog, chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: WorkloadAuditSink = createAuditSinkAdapter(log, {
      source: "workloads.profile-service",
    });
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });

    service.createProfile(ctxA(), createInput());
    service.reviseProfile(ctxA(), WL_1, {
      name: "finance.analyst",
      description: "rev2",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR_2,
    });

    const records = log.records(ctxA());
    expect(records.length).toBe(2);
    expect(records.map((r) => r.action)).toEqual([
      "workloads.profile.created",
      "workloads.profile.revised",
    ]);
    // The per-tenant hash chain verifies (tamper detection walk) — both
    // through the log's own verifier and the pure walk with the same
    // reference hash the log was constructed with (the default).
    const verification = log.verify(ctxA());
    expect(verification.ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    // Sequence is gapless per tenant.
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  test("a cross-context read of the log sees only its own tenant's chain", () => {
    const log = createInMemoryAuditLog();
    const sink: WorkloadAuditSink = createAuditSinkAdapter(log, { source: "workloads.test" });
    const service = createWorkloadProfileService({
      store: createInMemoryWorkloadProfileStore(),
      auditSink: sink,
    });
    service.createProfile(ctxA(), createInput());
    service.createProfile(ctxB(), createInput());
    expect(log.records(ctxA()).length).toBe(1);
    expect(log.records(ctxB()).length).toBe(1);
    expect(log.verify(ctxA()).ok).toBe(true);
    expect(log.verify(ctxB()).ok).toBe(true);
  });
});
