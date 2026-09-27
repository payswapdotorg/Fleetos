/**
 * W032 D1/D4 tests — tenant isolation by construction, proven two ways:
 *
 *   1. W012's REUSABLE isolation harness (`runTenantIsolationSuite`)
 *      runs against the store's raw KV view over the SAME per-tenant
 *      partitions;
 *   2. Exhaustive store-level checks on the RICH operations.
 */

import { describe, expect, test } from "bun:test";
import { asTenantId, asVendorId } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { TenantIsolationError, makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import {
  asTenantScopedVendorStore,
  createInMemoryVendorStore,
} from "../src/store";
import type { Vendor } from "../src/vendor";
import { buildVendor } from "../src/vendor";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  VND_1,
  VND_2,
  createInput,
  ctxA,
  ctxB,
  reviseInput,
  stdTerms,
  vendor,
} from "./helpers";

describe("D1/D4: W012 isolation harness over the store's raw KV view", () => {
  test("runTenantIsolationSuite passes all seven checks against the shared partitions", () => {
    const report = runTenantIsolationSuite<Vendor>({
      tenantA: TENANT_A,
      tenantB: TENANT_B,
      makeStore: () => asTenantScopedVendorStore(createInMemoryVendorStore()),
      makeValue: (tenantId, key) => {
        const built = buildVendor(tenantId, createInput({ vendorId: asVendorId(key) }));
        if (!built.ok) throw new Error(built.error.message);
        return built.vendor;
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

describe("D1/D4: rich-operation isolation (exhaustive)", () => {
  test("vendors created in tenant A are invisible to tenant B on every read path", () => {
    const store = createInMemoryVendorStore();
    const created = store.createVendor(ctxA(), createInput());
    expect(created.ok).toBe(true);

    expect(store.getLatestVendor(ctxB(), VND_1)).toBeUndefined();
    expect(store.getVendorRevision(ctxB(), VND_1, 1)).toBeUndefined();
    expect(store.listVendors(ctxB())).toEqual([]);
    expect(store.listVendors(ctxA()).length).toBe(1);
    expect(store.listRevisions(ctxB(), VND_1)).toEqual([]);
    expect(store.listRevisions(ctxA(), VND_1).length).toBe(1);
    expect(store.size(ctxB())).toBe(0);
    expect(store.size(ctxA())).toBe(1);
  });

  test("same vendor id in two tenants partitions independently", () => {
    const store = createInMemoryVendorStore();
    const a = store.createVendor(ctxA(), createInput({ name: "A Vendor" }));
    const b = store.createVendor(ctxB(), createInput({ name: "B Vendor" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const revised = store.reviseVendor(ctxA(), VND_1, reviseInput({ name: "A Vendor v2" }));
    expect(revised.ok).toBe(true);
    expect(store.getLatestVendor(ctxA(), VND_1)?.revision).toBe(2);
    expect(store.getLatestVendor(ctxB(), VND_1)?.revision).toBe(1);
    expect(store.getLatestVendor(ctxB(), VND_1)?.name).toBe("B Vendor");
  });

  test("a cross-tenant revise is indistinguishable from an unknown vendor (no existence leak)", () => {
    const store = createInMemoryVendorStore();
    store.createVendor(ctxA(), createInput());

    const foreign = store.reviseVendor(ctxB(), VND_1, reviseInput());
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.kind).toBe("DomainError");
    if (foreign.error.kind !== "DomainError") return;
    expect(foreign.error.code).toBe("vendors.vendor.domain");
    expect(foreign.error.invariant).toBe("vendor_unknown");

    const unknown = store.reviseVendor(ctxB(), VND_2, reviseInput());
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.message).toBe(foreign.error.message);
    expect(store.getLatestVendor(ctxA(), VND_1)?.revision).toBe(1);
  });

  test("context-free and invalid-context access is rejected by the runtime guard (types bypassed)", () => {
    const store = createInMemoryVendorStore();
    store.createVendor(ctxA(), createInput());

    expect(() => store.getLatestVendor(undefined as unknown as TenantContext, VND_1)).toThrow(
      TenantIsolationError,
    );
    expect(() =>
      store.getLatestVendor({ tenantId: "not-a-tenant-id" as never }, VND_1),
    ).toThrow(TenantIsolationError);
    expect(() => store.listVendors(null as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() => store.size(undefined as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() =>
      store.reviseVendor(undefined as unknown as TenantContext, VND_1, reviseInput()),
    ).toThrow(TenantIsolationError);
    expect(() => store.createVendor({ tenantId: "" as never }, createInput())).toThrow(
      TenantIsolationError,
    );
  });

  test("duplicate creation within one tenant fails; different tenants may share the id", () => {
    const store = createInMemoryVendorStore();
    expect(store.createVendor(ctxA(), createInput()).ok).toBe(true);
    const duplicate = store.createVendor(ctxA(), createInput());
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok || duplicate.error.kind !== "DomainError") return;
    expect(duplicate.error.invariant).toBe("vendor_already_exists");
    expect(duplicate.error.tenantId).toBe(TENANT_A);

    expect(store.createVendor(ctxB(), createInput()).ok).toBe(true);
    expect(store.size(ctxA())).toBe(1);
    expect(store.size(ctxB())).toBe(1);
  });

  test("revision history is append-only and complete within the partition", () => {
    const store = createInMemoryVendorStore();
    store.createVendor(ctxA(), createInput({ description: "rev1" }));
    store.reviseVendor(ctxA(), VND_1, reviseInput({ description: "rev2" }));
    store.reviseVendor(ctxA(), VND_1, reviseInput({ description: "rev3" }));
    const revisions = store.listRevisions(ctxA(), VND_1);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions.map((r) => r.description)).toEqual(["rev1", "rev2", "rev3"]);
    expect(store.getVendorRevision(ctxA(), VND_1, 2)?.description).toBe("rev2");
    expect(store.getVendorRevision(ctxA(), VND_1, 0)).toBeUndefined();
    expect(store.getVendorRevision(ctxA(), VND_1, 4)).toBeUndefined();
  });

  test("multi-vendor enumeration is sorted by vendorId within the partition", () => {
    const store = createInMemoryVendorStore();
    store.createVendor(ctxA(), createInput({ vendorId: VND_2 }));
    store.createVendor(ctxA(), createInput());
    const ids = store.listVendors(ctxA()).map((v) => v.vendorId);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBe(2);
  });

  test("an empty tenant partition reads as empty (never as another tenant's data)", () => {
    const store = createInMemoryVendorStore();
    const freshCtx = makeTenantContext(asTenantId("tnt_freshtenant0"));
    expect(store.listVendors(freshCtx)).toEqual([]);
    expect(store.size(freshCtx)).toBe(0);
    expect(store.getLatestVendor(freshCtx, VND_1)).toBeUndefined();
    expect(store.listRevisions(freshCtx, VND_1)).toEqual([]);
  });

  test("invalid revision inputs are rejected with tagged errors", () => {
    const store = createInMemoryVendorStore();
    store.createVendor(ctxA(), createInput());
    const bad = store.reviseVendor(ctxA(), VND_1, reviseInput({ name: "" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
    expect(bad.error.tenantId).toBe(TENANT_A);
    expect(store.getLatestVendor(ctxA(), VND_1)?.revision).toBe(1);
  });
});

describe("D1/D4: vendor terms accept valid comparable values", () => {
  test("quality 0/1, sla 0/1, warranty 0 days are all accepted (boundary)", () => {
    const v = vendor({
      terms: stdTerms({
        quality: { score: 0 },
        sla: { coverage: 0 },
        warranty: { days: 0 },
      }),
    });
    expect(v.terms.quality.score).toBe(0);
    expect(v.terms.sla.coverage).toBe(0);
    expect(v.terms.warranty.days).toBe(0);
  });
});
