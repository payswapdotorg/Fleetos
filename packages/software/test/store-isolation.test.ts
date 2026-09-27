/**
 * W032 D4 tests — the tenant-scoped subscription store + the audited
 * service boundary + W012 isolation harness + structural compatibility.
 */

import { describe, expect, test } from "bun:test";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import type { TenantContext } from "@fleetos/identity";
import { TenantIsolationError, makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import {
  NOOP_SOFTWARE_AUDIT_SINK,
  SOFTWARE_AUDIT_ACTIONS,
  createInMemorySoftwareAuditSink,
  createSubscriptionService,
} from "../src/index";
import type { SoftwareAuditSink } from "../src/index";
import {
  asTenantScopedSubscriptionStore,
  createInMemorySubscriptionStore,
} from "../src/store";
import type { SoftwareSubscription } from "../src/subscription";
import { allocateSubscription } from "../src/subscription";
import {
  CORR,
  CORR_2,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  WL_1,
  allocateInput,
  ctxA,
  ctxB,
  reviseInput,
  stdSoftwareIntent,
} from "./helpers";

describe("D4: W012 isolation harness over the subscription store's raw KV view", () => {
  test("runTenantIsolationSuite passes all seven checks", () => {
    const report = runTenantIsolationSuite<SoftwareSubscription>({
      tenantA: TENANT_A,
      tenantB: TENANT_B,
      makeStore: () => asTenantScopedSubscriptionStore(createInMemorySubscriptionStore()),
      makeValue: (tenantId, key) => {
        const built = allocateSubscription(tenantId, {
          softwareIntent: stdSoftwareIntent({ softwareId: key }),
          workloadId: WL_1,
          at: T0,
          correlationId: CORR,
        });
        if (!built.ok) throw new Error(built.error.message);
        return built.subscription;
      },
    });
    expect(report.ok).toBe(true);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(report.checks.map((c) => c.name)).toEqual([
      "own_tenant_roundtrip",
      "cross_tenant_read_miss",
      "same_key_partition",
      "context_free_rejected",
      "invalid_context_rejected",
      "enumeration_scoped",
      "remove_scoped",
    ]);
  });
});

describe("D4: subscription store rich-operation isolation", () => {
  test("subscriptions allocated in tenant A are invisible to tenant B", () => {
    const store = createInMemorySubscriptionStore();
    const a = store.allocate(ctxA(), allocateInput());
    expect(a.ok).toBe(true);
    expect(store.getLatest(ctxB(), a.ok ? a.subscription.subscriptionId : "")).toBeUndefined();
    expect(store.list(ctxB())).toEqual([]);
    expect(store.list(ctxA()).length).toBe(1);
    expect(store.size(ctxB())).toBe(0);
    expect(store.size(ctxA())).toBe(1);
  });

  test("same softwareId in two tenants derives different subscription ids (tenant-scoped hash)", () => {
    const store = createInMemorySubscriptionStore();
    const a = store.allocate(ctxA(), allocateInput());
    const b = store.allocate(ctxB(), allocateInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // The subscriptionId is derived from (tenantId, softwareId, workloadId);
    // the same softwareId in different tenants derives DIFFERENT ids
    // (the tenantId is part of the hash).
    expect(a.subscription.subscriptionId).not.toBe(b.subscription.subscriptionId);
    expect(store.size(ctxA())).toBe(1);
    expect(store.size(ctxB())).toBe(1);
  });

  test("cross-tenant revise is indistinguishable from an unknown subscription", () => {
    const store = createInMemorySubscriptionStore();
    const a = store.allocate(ctxA(), allocateInput());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const foreign = store.revise(ctxB(), a.subscription.subscriptionId, reviseInput());
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.kind).toBe("DomainError");
    if (foreign.error.kind !== "DomainError") return;
    expect(foreign.error.invariant).toBe("subscription_unknown");
    expect(store.getLatest(ctxA(), a.subscription.subscriptionId)?.revision).toBe(1);
  });

  test("context-free and invalid-context access is rejected", () => {
    const store = createInMemorySubscriptionStore();
    expect(() => store.getLatest(undefined as unknown as TenantContext, "x")).toThrow(TenantIsolationError);
    expect(() => store.list(null as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() => store.size(undefined as unknown as TenantContext)).toThrow(TenantIsolationError);
  });

  test("duplicate allocation within one tenant fails; different tenants may share the id", () => {
    const store = createInMemorySubscriptionStore();
    expect(store.allocate(ctxA(), allocateInput()).ok).toBe(true);
    const dup = store.allocate(ctxA(), allocateInput());
    expect(dup.ok).toBe(false);
    if (dup.ok || dup.error.kind !== "DomainError") return;
    expect(dup.error.invariant).toBe("subscription_already_exists");

    expect(store.allocate(ctxB(), allocateInput()).ok).toBe(true);
  });

  test("revision history is append-only and complete", () => {
    const store = createInMemorySubscriptionStore();
    const a = store.allocate(ctxA(), allocateInput());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const subId = a.subscription.subscriptionId;
    store.revise(ctxA(), subId, reviseInput({ seatCount: 10 }));
    store.revise(ctxA(), subId, reviseInput({ seatCount: 15 }));
    const revisions = store.listRevisions(ctxA(), subId);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions.map((r) => r.seatCount)).toEqual([5, 10, 15]);
  });
});

describe("D4: the audited service boundary", () => {
  test("allocation and revision each emit exactly one audit record", () => {
    const sink = createInMemorySoftwareAuditSink();
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: sink,
    });
    const a = service.allocate(ctxA(), allocateInput());
    expect(a.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe(SOFTWARE_AUDIT_ACTIONS.subscriptionAllocated);

    if (!a.ok) return;
    const r = service.revise(ctxA(), a.subscription.subscriptionId, reviseInput({ correlationId: CORR_2 }));
    expect(r.ok).toBe(true);
    expect(sink.records.length).toBe(2);
    expect(sink.records[1]?.action).toBe(SOFTWARE_AUDIT_ACTIONS.subscriptionRevised);
    expect(sink.records[1]?.correlationId).toBe(CORR_2);
    const details = sink.records[1]?.details as { fromRevision: number; toRevision: number; fromSeatCount: number; toSeatCount: number };
    expect(details.fromRevision).toBe(1);
    expect(details.toRevision).toBe(2);
    expect(details.fromSeatCount).toBe(5);
    expect(details.toSeatCount).toBe(10);
  });

  test("failed mutations emit NO audit records", () => {
    const sink = createInMemorySoftwareAuditSink();
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: sink,
    });
    const bad = service.allocate(ctxA(), allocateInput({ at: "not-iso" }));
    expect(bad.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });

  test("the default sink is a silent no-op", () => {
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: NOOP_SOFTWARE_AUDIT_SINK,
    });
    expect(service.allocate(ctxA(), allocateInput()).ok).toBe(true);
  });
});

describe("D4: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies SoftwareAuditSink structurally", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, { source: "software.test" });
    const sink: SoftwareAuditSink = adapter;
    expect(typeof sink.append).toBe("function");

    const built = allocateSubscription(TENANT_A, allocateInput());
    if (!built.ok) throw new Error(built.error.message);
    sink.append({
      action: SOFTWARE_AUDIT_ACTIONS.subscriptionAllocated,
      tenantId: built.subscription.tenantId,
      subject: built.subscription.subscriptionId,
      occurredAt: T0,
      correlationId: CORR,
      details: { softwareId: built.subscription.softwareId },
    });
    const records = log.records(ctxA());
    expect(records.length).toBe(1);
    expect(records[0]?.action).toBe("software.subscription.allocated");
    expect(records[0]?.source).toBe("software.test");
  });

  test("the full W012 pattern end to end: chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: SoftwareAuditSink = createAuditSinkAdapter(log, { source: "software.service" });
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: sink,
    });
    const a = service.allocate(ctxA(), allocateInput());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    service.revise(ctxA(), a.subscription.subscriptionId, reviseInput());

    const records = log.records(ctxA());
    expect(records.length).toBe(2);
    expect(records.map((r) => r.action)).toEqual([
      "software.subscription.allocated",
      "software.subscription.revised",
    ]);
    expect(log.verify(ctxA()).ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
  });

  test("a cross-context read of the log sees only its own tenant's chain", () => {
    const log = createInMemoryAuditLog();
    const sink: SoftwareAuditSink = createAuditSinkAdapter(log, { source: "software.test" });
    const service = createSubscriptionService({
      store: createInMemorySubscriptionStore(),
      auditSink: sink,
    });
    service.allocate(ctxA(), allocateInput());
    service.allocate(ctxB(), allocateInput());
    expect(log.records(ctxA()).length).toBe(1);
    expect(log.records(ctxB()).length).toBe(1);
    expect(log.verify(ctxA()).ok).toBe(true);
    expect(log.verify(ctxB()).ok).toBe(true);
  });
});
