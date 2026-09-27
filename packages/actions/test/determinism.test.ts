/**
 * W041 D5 tests — byte-identical determinism across runs and input
 * permutations. The actions package is PURE: the same selector + the same
 * registry produce the same target set; the same plan inputs produce the
 * same planId + contentDigest; the same print job + the same printers
 * produce the same routing decision. Audit on/off never changes the
 * domain output. End-to-end across two independent runs, the JSON
 * serialization is byte-identical.
 */

import { describe, expect, test } from "bun:test";
import { asDeviceId } from "@fleetos/contracts";
import {
  actionPlanId,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  createInMemoryActionAuditSink,
  resolveActionTargets,
  routePrintJob,
  transitionActionPlan,
  enqueuePrintJob,
  createInMemoryActionStore,
  createInMemoryPrintStore,
  type DeviceGroupSelector,
} from "../src/index";
import {
  CAP_LOCK,
  CAP_OBSERVE,
  CAP_WIPE,
  CORR,
  CORR_2,
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  allSelector,
  descriptor,
  printer,
  registry,
  scopeA,
} from "./helpers";

describe("D5: byte-identical determinism across runs > target resolution", () => {
  test("the same selector + the same registry produce the same device set, byte-for-byte", () => {
    const descriptors = [
      descriptor(TENANT_A, asDeviceId("dev_determinism_03")),
      descriptor(TENANT_A, asDeviceId("dev_determinism_01")),
      descriptor(TENANT_A, asDeviceId("dev_determinism_02")),
    ];
    const reg = registry(descriptors);
    const targets1 = resolveActionTargets(allSelector, reg, TENANT_A);
    const targets2 = resolveActionTargets(allSelector, reg, TENANT_A);
    expect(JSON.stringify(targets1)).toBe(JSON.stringify(targets2));
    // The output is sorted by deviceId (as a string) — independent of
    // input order. The above descriptors are inserted in 03, 01, 02
    // order; the resolved set must be 01, 02, 03.
    expect(targets1.map((id) => id as string)).toEqual([
      "dev_determinism_01",
      "dev_determinism_02",
      "dev_determinism_03",
    ]);
  });

  test("input permutations of the descriptor set produce the same resolved target set", () => {
    const base = [
      descriptor(TENANT_A, asDeviceId("dev_perm_01")),
      descriptor(TENANT_A, asDeviceId("dev_perm_02")),
      descriptor(TENANT_A, asDeviceId("dev_perm_03")),
    ];
    // Build three different input orders; all must produce the same
    // resolved target set (sorted by deviceId).
    const r1 = registry([...base]);
    const r2 = registry([base[1]!, base[0]!, base[2]!]);
    const r3 = registry([base[2]!, base[1]!, base[0]!]);
    const t1 = resolveActionTargets(allSelector, r1, TENANT_A);
    const t2 = resolveActionTargets(allSelector, r2, TENANT_A);
    const t3 = resolveActionTargets(allSelector, r3, TENANT_A);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
    expect(JSON.stringify(t2)).toBe(JSON.stringify(t3));
  });

  test("byId selectors are stable regardless of the input order", () => {
    const descriptors = [
      descriptor(TENANT_A, asDeviceId("dev_byid_01")),
      descriptor(TENANT_A, asDeviceId("dev_byid_02")),
      descriptor(TENANT_A, asDeviceId("dev_byid_03")),
    ];
    const reg = registry(descriptors);
    const sel1: DeviceGroupSelector = {
      kind: "byId",
      deviceIds: [asDeviceId("dev_byid_03"), asDeviceId("dev_byid_01"), asDeviceId("dev_byid_02")],
    };
    const sel2: DeviceGroupSelector = {
      kind: "byId",
      deviceIds: [asDeviceId("dev_byid_01"), asDeviceId("dev_byid_02"), asDeviceId("dev_byid_03")],
    };
    const t1 = resolveActionTargets(sel1, reg, TENANT_A);
    const t2 = resolveActionTargets(sel2, reg, TENANT_A);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
  });

  test("set algebra (intersect / union / subtract) is deterministic regardless of sub-selector order", () => {
    const descriptors = [
      descriptor(TENANT_A, asDeviceId("dev_set_01"), { platform: "windows" }),
      descriptor(TENANT_A, asDeviceId("dev_set_02"), { platform: "macos" }),
      descriptor(TENANT_A, asDeviceId("dev_set_03"), { platform: "windows" }),
      descriptor(TENANT_A, asDeviceId("dev_set_04"), { platform: "linux" }),
    ];
    const reg = registry(descriptors);
    const windows: DeviceGroupSelector = { kind: "byPlatform", platform: "windows" };
    const macos: DeviceGroupSelector = { kind: "byPlatform", platform: "macos" };
    const linux: DeviceGroupSelector = { kind: "byPlatform", platform: "linux" };

    // intersect order independence
    const i1 = resolveActionTargets({ kind: "intersect", selectors: [windows, macos] }, reg, TENANT_A);
    const i2 = resolveActionTargets({ kind: "intersect", selectors: [macos, windows] }, reg, TENANT_A);
    expect(JSON.stringify(i1)).toBe(JSON.stringify(i2));
    expect(i1).toHaveLength(0); // windows ∩ macos = empty

    // union order independence
    const u1 = resolveActionTargets({ kind: "union", selectors: [windows, macos, linux] }, reg, TENANT_A);
    const u2 = resolveActionTargets({ kind: "union", selectors: [linux, macos, windows] }, reg, TENANT_A);
    expect(JSON.stringify(u1)).toBe(JSON.stringify(u2));
    expect(u1).toHaveLength(4); // all four devices

    // subtract: order of base/minus is fixed (base - minus); the result
    // is deterministic for the same base + minus.
    const s1 = resolveActionTargets(
      { kind: "subtract", base: { kind: "all" }, minus: windows },
      reg,
      TENANT_A,
    );
    const s2 = resolveActionTargets(
      { kind: "subtract", base: { kind: "all" }, minus: windows },
      reg,
      TENANT_A,
    );
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(s1).toHaveLength(2); // macos + linux = 2
  });
});

describe("D5: byte-identical determinism across runs > plan creation", () => {
  test("the same plan inputs produce the same planId + contentDigest, byte-for-byte", () => {
    const reg = registry([
      descriptor(TENANT_A, asDeviceId("dev_plan_01")),
      descriptor(TENANT_A, asDeviceId("dev_plan_02")),
    ]);
    const p1 = createActionPlan({
      name: "deterministic-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    const p2 = createActionPlan({
      name: "deterministic-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(p1.ok).toBe(true);
    expect(p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    expect(JSON.stringify(p1.plan)).toBe(JSON.stringify(p2.plan));
    expect(p1.plan.planId).toBe(p2.plan.planId);
    expect(p1.plan.contentDigest).toBe(p2.plan.contentDigest);
  });

  test("descriptor insertion order independence — the same descriptors in any order produce the same plan", () => {
    const ds = [
      descriptor(TENANT_A, asDeviceId("dev_plan_03")),
      descriptor(TENANT_A, asDeviceId("dev_plan_01")),
      descriptor(TENANT_A, asDeviceId("dev_plan_02")),
    ];
    const r1 = registry([...ds]);
    const r2 = registry([ds[1]!, ds[2]!, ds[0]!]);
    const r3 = registry([ds[2]!, ds[0]!, ds[1]!]);
    const p1 = createActionPlan({
      name: "order-independent",
      selector: allSelector,
      capability: CAP_LOCK,
      tenantId: TENANT_A,
      registry: r1,
      at: T0,
    });
    const p2 = createActionPlan({
      name: "order-independent",
      selector: allSelector,
      capability: CAP_LOCK,
      tenantId: TENANT_A,
      registry: r2,
      at: T0,
    });
    const p3 = createActionPlan({
      name: "order-independent",
      selector: allSelector,
      capability: CAP_LOCK,
      tenantId: TENANT_A,
      registry: r3,
      at: T0,
    });
    expect(p1.ok && p2.ok && p3.ok).toBe(true);
    if (!p1.ok || !p2.ok || !p3.ok) return;
    expect(JSON.stringify(p1.plan)).toBe(JSON.stringify(p2.plan));
    expect(JSON.stringify(p2.plan)).toBe(JSON.stringify(p3.plan));
  });

  test("the plan's selectedTargets are sorted by deviceId", () => {
    const reg = registry([
      descriptor(TENANT_A, asDeviceId("dev_sorted_03")),
      descriptor(TENANT_A, asDeviceId("dev_sorted_01")),
      descriptor(TENANT_A, asDeviceId("dev_sorted_02")),
    ]);
    const result = createActionPlan({
      name: "sorted-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.selectedTargets.map((id) => id as string)).toEqual([
      "dev_sorted_01",
      "dev_sorted_02",
      "dev_sorted_03",
    ]);
  });

  test("plan transitions produce fresh versioned records; prior bytes untouched", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_rev_01"))]);
    const v1 = createActionPlan({
      name: "revision-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const v1Bytes = JSON.stringify(v1.plan);
    const v2 = transitionActionPlan(v1.plan, "ADVANCED", T1);
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    // v1 is untouched (deep-frozen; byte-identical to the original).
    expect(JSON.stringify(v1.plan)).toBe(v1Bytes);
    // v2 has incremented version + transitioned status.
    expect(v2.plan.version).toBe(2);
    expect(v2.plan.status).toBe("ADVANCED");
    expect(v2.plan.transitionedAt).toBe(T1);
  });
});

describe("D5: byte-identical determinism across runs > print routing", () => {
  test("the same payload + the same printers + the same scoreFn produce the same routing, byte-for-byte", () => {
    const printers = [
      printer(TENANT_A, "prn_01", {
        capabilities: { color: true, duplex: true },
        preferences: { costPerPage: 0.05, latencyMs: 100 },
      }),
      printer(TENANT_A, "prn_02", {
        capabilities: { color: true, duplex: true },
        preferences: { costPerPage: 0.03, latencyMs: 200 },
      }),
    ];
    const payload = { documentRef: "doc://determinism" };
    const r1 = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    const r2 = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(JSON.stringify(r1.job)).toBe(JSON.stringify(r2.job));
  });

  test("printer input order independence — same printers in any order produce the same selection (ties broken by printerId)", () => {
    const printers = [
      printer(TENANT_A, "prn_alpha", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.05 },
      }),
      printer(TENANT_A, "prn_beta", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.05 },
      }),
      printer(TENANT_A, "prn_gamma", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.05 },
      }),
    ];
    const payload = { documentRef: "doc://tie" };
    const r1 = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers: [...printers],
      at: T0,
      correlationId: CORR,
    });
    const r2 = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers: [printers[2]!, printers[1]!, printers[0]!],
      at: T0,
      correlationId: CORR,
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.job.printerId).toBe("prn_alpha"); // alphabetically first
    expect(r2.job.printerId).toBe("prn_alpha");
  });

  test("audit on/off never changes the domain output", () => {
    const printers = [
      printer(TENANT_A, "prn_01", {
        capabilities: { color: true },
        preferences: { costPerPage: 0.05 },
      }),
    ];
    const payload = { documentRef: "doc://audit-off-vs-on" };
    const sink = createInMemoryActionAuditSink();
    const withAuditSink = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    const noSink = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(withAuditSink.ok).toBe(true);
    expect(noSink.ok).toBe(true);
    if (!withAuditSink.ok || !noSink.ok) return;
    // The domain output (the job) is byte-identical regardless of audit sink.
    expect(JSON.stringify(withAuditSink.job)).toBe(JSON.stringify(noSink.job));
    // The sink collected exactly one audit record (the routing emission).
    expect(sink.records.length).toBe(1);
  });
});

describe("D5: byte-identical determinism across runs > store operations", () => {
  test("the action store's listPlanIds is sorted (input-order invariant)", () => {
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_store_01"))]);
    const store1 = createInMemoryActionStore();
    const store2 = createInMemoryActionStore();
    // Insert plans with different names in different orders into two stores.
    const planNames = ["plan_c", "plan_a", "plan_b"];
    const plans = planNames.map((name) => {
      const p = createActionPlan({
        name,
        selector: allSelector,
        capability: CAP_OBSERVE,
        tenantId: TENANT_A,
        registry: reg,
        at: T0,
      });
      if (!p.ok) throw new Error("plan create failed");
      return p.plan;
    });
    // Insert into store1 in planNames order.
    for (const p of plans) {
      store1.appendPlan(scopeA(), p);
    }
    // Insert into store2 in reverse order.
    for (const p of [plans[2]!, plans[0]!, plans[1]!]) {
      store2.appendPlan(scopeA(), p);
    }
    // The planIds are deterministic digests of (tenantId, name); both
    // stores have the same set of planIds, sorted alphabetically.
    const ids1 = store1.listPlanIds(scopeA());
    const ids2 = store2.listPlanIds(scopeA());
    expect(ids1).toEqual(ids2);
    // The sorted order is by planId (which is `pln_<hash>`); since the
    // hashes are deterministic, the sorted order is deterministic too.
    // Verify it's sorted ascending.
    for (let i = 1; i < ids1.length; i++) {
      expect((ids1[i] as string) >= (ids1[i - 1] as string)).toBe(true);
    }
    expect(ids1.length).toBe(3);
  });

  test("the print store's listJobIds is sorted (input-order invariant)", () => {
    const store = createInMemoryPrintStore();
    // Construct three print jobs with different creation timestamps so
    // their jobIds differ; insert in different orders into two stores.
    const store1 = createInMemoryPrintStore();
    const store2 = createInMemoryPrintStore();
    const ts = [T0, T1, "2026-03-01T00:00:00Z"];
    const docs = ts.map((t) => ({ t, doc: `doc://det-${t}` }));
    for (const { t, doc } of docs) {
      const r = routePrintJob({
        payload: { documentRef: doc },
        requiredFeatures: { color: true },
        tenantId: TENANT_A,
        printers: [printer(TENANT_A, "prn_01", { capabilities: { color: true } })],
        at: t,
        correlationId: CORR,
      });
      if (!r.ok) throw new Error("routing failed");
      store1.appendJob(scopeA(), r.job);
    }
    for (const { t, doc } of [docs[2]!, docs[0]!, docs[1]!]) {
      const r = routePrintJob({
        payload: { documentRef: doc },
        requiredFeatures: { color: true },
        tenantId: TENANT_A,
        printers: [printer(TENANT_A, "prn_01", { capabilities: { color: true } })],
        at: t,
        correlationId: CORR,
      });
      if (!r.ok) throw new Error("routing failed");
      store2.appendJob(scopeA(), r.job);
    }
    expect(store1.listJobIds(scopeA())).toEqual(store2.listJobIds(scopeA()));
    void store;
  });
});

// (No additional helpers needed — the actions package's
// createInMemoryActionAuditSink is the test-scope sink.)
