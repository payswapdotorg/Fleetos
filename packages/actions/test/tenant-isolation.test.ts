/**
 * W041 D5 tests — tenant isolation by construction: tenant-A context can
 * never read/act on tenant-B plans or jobs. Foreign ids are
 * indistinguishable from unknown ones (no existence side channel).
 * Types-bypassed access (`undefined as never`) is rejected at runtime.
 * Cross-tenant injection (a tenant-A scope naming a tenant-B plan) is
 * rejected.
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId } from "@fleetos/contracts";
import {
  createActionPlan,
  createInMemoryActionStore,
  createInMemoryPrintStore,
  routePrintJob,
  enqueuePrintJob,
  type ActionTenantScope,
} from "../src/index";
import {
  CAP_OBSERVE,
  CORR,
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  allSelector,
  descriptor,
  printer,
  registry,
  scopeA,
  scopeB,
} from "./helpers";

describe("D5: tenant isolation > ActionStore partitions by tenant", () => {
  test("a tenant-A plan is invisible to tenant-B (foreign id indistinguishable from unknown)", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_iso_01"))]);
    const plan = createActionPlan({
      name: "iso-plan-a",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const store = createInMemoryActionStore();
    expect(store.appendPlan(scopeA(), plan.plan).ok).toBe(true);
    // Tenant B's scope cannot read the tenant-A plan: getLatestPlan
    // returns undefined (the foreign id is indistinguishable from
    // unknown).
    expect(store.getLatestPlan(scopeB(), plan.plan.planId)).toBe(undefined);
    expect(store.listPlanIds(scopeB())).toEqual([]);
    expect(store.size(scopeB())).toBe(0);
  });

  test("a tenant-B plan is invisible to tenant-A (symmetric)", () => {
    const reg = registry([descriptor(TENANT_B, asDeviceId("dev_iso_02"))]);
    const plan = createActionPlan({
      name: "iso-plan-b",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_B,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const store = createInMemoryActionStore();
    expect(store.appendPlan(scopeB(), plan.plan).ok).toBe(true);
    expect(store.getLatestPlan(scopeA(), plan.plan.planId)).toBe(undefined);
    expect(store.listPlanIds(scopeA())).toEqual([]);
  });

  test("cross-tenant append is rejected (a tenant-A scope cannot append a tenant-B plan)", () => {
    const reg = registry([descriptor(TENANT_B, asDeviceId("dev_iso_03"))]);
    const plan = createActionPlan({
      name: "iso-plan-cross",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_B,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const store = createInMemoryActionStore();
    const result = store.appendPlan(scopeA(), plan.plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.plan.store");
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("tenant_mismatch");
    }
  });

  test("context-free access is rejected (undefined scope)", () => {
    const store = createInMemoryActionStore();
    const result = store.appendPlan(undefined as never, undefined as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.plan.store");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("missing_scope");
    }
  });

  test("types-bypassed invalid tenant id is rejected", () => {
    const store = createInMemoryActionStore();
    // A tenant scope whose tenantId fails the canonical grammar:
    const badScope: ActionTenantScope = {
      tenantId: "not-a-tenant-id" as never,
      correlationId: CORR,
    };
    const result = store.listPlanIds(badScope);
    expect(result).toEqual([]);
    // The same for getLatestPlan, size, etc. — every operation takes
    // the scope and rejects at the guard.
    expect(store.size(badScope)).toBe(0);
    expect(store.getLatestPlan(badScope, "any-plan-id")).toBe(undefined);
  });

  test("same plan id in two tenants produces two separate partitions (no collision)", () => {
    const regA = registry([descriptor(TENANT_A, asDeviceId("dev_iso_a_04"))]);
    const regB = registry([descriptor(TENANT_B, asDeviceId("dev_iso_b_04"))]);
    // Two plans with the SAME name in different tenants — their planId
    // is digest(tenantId, name) so they differ. The two partitions are
    // fully separate.
    const planA = createActionPlan({
      name: "shared-name",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: regA,
      at: T0,
    });
    const planB = createActionPlan({
      name: "shared-name",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_B,
      registry: regB,
      at: T0,
    });
    expect(planA.ok).toBe(true);
    expect(planB.ok).toBe(true);
    if (!planA.ok || !planB.ok) return;
    expect(planA.plan.planId).not.toBe(planB.plan.planId);
    const store = createInMemoryActionStore();
    expect(store.appendPlan(scopeA(), planA.plan).ok).toBe(true);
    expect(store.appendPlan(scopeB(), planB.plan).ok).toBe(true);
    expect(store.size(scopeA())).toBe(1);
    expect(store.size(scopeB())).toBe(1);
    expect(store.listPlanIds(scopeA())).toEqual([planA.plan.planId]);
    expect(store.listPlanIds(scopeB())).toEqual([planB.plan.planId]);
  });
});

describe("D5: tenant isolation > PrintStore partitions by tenant", () => {
  test("a tenant-A print job is invisible to tenant-B", () => {
    const printers = [printer(TENANT_A, "prn_iso_01", { capabilities: { color: true } })];
    const routed = routePrintJob({
      payload: { documentRef: "doc://iso-a" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const store = createInMemoryPrintStore();
    expect(store.appendJob(scopeA(), routed.job).ok).toBe(true);
    // Tenant B cannot read the tenant-A job.
    expect(store.getLatestJob(scopeB(), routed.job.jobId)).toBe(undefined);
    expect(store.listJobIds(scopeB())).toEqual([]);
    expect(store.size(scopeB())).toBe(0);
    expect(store.getQueueState(scopeB(), "prn_iso_01")?.depth ?? 0).toBe(0);
  });

  test("cross-tenant append is rejected (a tenant-A scope cannot append a tenant-B job)", () => {
    const printers = [printer(TENANT_B, "prn_iso_02", { capabilities: { color: true } })];
    const routed = routePrintJob({
      payload: { documentRef: "doc://iso-b" },
      requiredFeatures: { color: true },
      tenantId: TENANT_B,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const store = createInMemoryPrintStore();
    const result = store.appendJob(scopeA(), routed.job);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.store");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("tenant_mismatch");
    }
  });

  test("context-free access is rejected (undefined scope)", () => {
    const store = createInMemoryPrintStore();
    const result = store.appendJob(undefined as never, undefined as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.store");
    if (result.error.kind === "DomainError") {
      expect(result.error.invariant).toBe("missing_scope");
    }
  });
});

describe("D5: tenant isolation > routing filters foreign-tenant printers", () => {
  test("a tenant-A job cannot route to a tenant-B printer (the router filters foreign printers)", () => {
    const printers = [
      // Tenant B printer (foreign) — must be filtered out by the router.
      printer(
        "tnt_testtenant000b" as never,
        "prn_foreign_iso",
        { capabilities: { color: true } },
      ),
    ];
    const result = routePrintJob({
      payload: { documentRef: "doc://iso-routing" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    // The router found NO supporting printers in the acting tenant's
    // partition — REFUSED (no emulation via the foreign printer).
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("action.print.routing_refused");
  });
});

describe("D5: tenant isolation > the queue state stays per-tenant", () => {
  test("a tenant-A queue cannot observe tenant-B jobs (per-printer state partitioned by tenant)", () => {
    // Two tenants enqueue jobs at printers with the SAME printerId. The
    // store's per-tenant partition keeps the queues separate: tenant-A's
    // queue for "prn_shared" sees only tenant-A's jobs; tenant-B's queue
    // sees only tenant-B's jobs.
    const store = createInMemoryPrintStore();
    const printersA = [
      printer(TENANT_A, "prn_shared", { capabilities: { color: true } }),
    ];
    const printersB = [
      printer(TENANT_B, "prn_shared", { capabilities: { color: true } }),
    ];
    const routedA = routePrintJob({
      payload: { documentRef: "doc://shared-a" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers: printersA,
      at: T0,
      correlationId: CORR,
    });
    const routedB = routePrintJob({
      payload: { documentRef: "doc://shared-b" },
      requiredFeatures: { color: true },
      tenantId: TENANT_B,
      printers: printersB,
      at: T0,
      correlationId: CORR,
    });
    expect(routedA.ok).toBe(true);
    expect(routedB.ok).toBe(true);
    if (!routedA.ok || !routedB.ok) return;
    const enqA = enqueuePrintJob(routedA.job, { at: T1, correlationId: CORR });
    const enqB = enqueuePrintJob(routedB.job, { at: T1, correlationId: CORR });
    expect(enqA.ok).toBe(true);
    expect(enqB.ok).toBe(true);
    if (!enqA.ok || !enqB.ok) return;
    store.appendJob(scopeA(), enqA.job);
    store.appendJob(scopeB(), enqB.job);
    const qa = store.getQueueState(scopeA(), "prn_shared");
    const qb = store.getQueueState(scopeB(), "prn_shared");
    expect(qa?.depth).toBe(1);
    expect(qb?.depth).toBe(1);
    expect(qa?.queuedJobIds).toEqual([enqA.job.jobId]);
    expect(qb?.queuedJobIds).toEqual([enqB.job.jobId]);
    // Tenant A's queue NEVER sees tenant-B's job id.
    expect((qa?.queuedJobIds ?? []).includes(enqB.job.jobId)).toBe(false);
    expect((qb?.queuedJobIds ?? []).includes(enqA.job.jobId)).toBe(false);
  });
});
