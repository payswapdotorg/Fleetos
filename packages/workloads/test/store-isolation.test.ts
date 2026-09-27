/**
 * W022 D4 tests — tenant isolation by construction, proven two ways:
 *
 *   1. W012's REUSABLE isolation harness (`runTenantIsolationSuite`)
 *      runs against the store's raw KV view over the SAME per-tenant
 *      partitions (the same-lane consumption W012 documented for this
 *      package);
 *   2. Exhaustive store-level checks on the RICH operations: latest /
 *      specific-revision reads, listing, sizing, and revision appends
 *      can never cross partitions; foreign workload ids are
 *      indistinguishable from unknown ones; context-free and
 *      invalid-context access is rejected by the runtime guard even
 *      when the type system is bypassed.
 */

import { describe, expect, test } from "bun:test";
import { asTenantId, asWorkloadId } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { TenantIsolationError, makeTenantContext, runTenantIsolationSuite } from "@fleetos/identity";
import {
  asTenantScopedProfileStore,
  createInMemoryWorkloadProfileStore,
} from "../src/store";
import type { WorkloadProfile } from "../src/profile";
import { buildWorkloadProfile } from "../src/profile";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  WL_1,
  WL_2,
  balancedVector,
  createInput,
  ctxA,
  ctxB,
} from "./helpers";

describe("D4: W012 isolation harness over the store's raw KV view", () => {
  test("runTenantIsolationSuite passes all seven checks against the shared partitions", () => {
    const report = runTenantIsolationSuite<WorkloadProfile>({
      tenantA: TENANT_A,
      tenantB: TENANT_B,
      makeStore: () => asTenantScopedProfileStore(createInMemoryWorkloadProfileStore()),
      makeValue: (tenantId, key) => {
        const built = buildWorkloadProfile(tenantId, createInput({ workloadId: asWorkloadId(key) }));
        if (!built.ok) throw new Error(built.error.message);
        return built.profile;
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

describe("D4: rich-operation isolation (exhaustive)", () => {
  test("profiles created in tenant A are invisible to tenant B on every read path", () => {
    const store = createInMemoryWorkloadProfileStore();
    const created = store.createProfile(ctxA(), createInput());
    expect(created.ok).toBe(true);

    // Latest read: cross-tenant miss.
    expect(store.getLatestProfile(ctxB(), WL_1)).toBeUndefined();
    // Specific-revision read: cross-tenant miss.
    expect(store.getProfileRevision(ctxB(), WL_1, 1)).toBeUndefined();
    // Listing: scoped to the acting tenant.
    expect(store.listProfiles(ctxB())).toEqual([]);
    expect(store.listProfiles(ctxA()).length).toBe(1);
    // Revision history: scoped.
    expect(store.listRevisions(ctxB(), WL_1)).toEqual([]);
    expect(store.listRevisions(ctxA(), WL_1).length).toBe(1);
    // Size: scoped.
    expect(store.size(ctxB())).toBe(0);
    expect(store.size(ctxA())).toBe(1);
  });

  test("same workload id in two tenants partitions independently (no interference)", () => {
    const store = createInMemoryWorkloadProfileStore();
    const a = store.createProfile(ctxA(), createInput({ name: "role.a" }));
    const b = store.createProfile(ctxB(), createInput({ name: "role.b" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Revise in A; B's latest stays revision 1.
    const revised = store.reviseProfile(ctxA(), WL_1, {
      name: "role.a",
      description: "updated in A",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(revised.ok).toBe(true);
    expect(store.getLatestProfile(ctxA(), WL_1)?.revision).toBe(2);
    expect(store.getLatestProfile(ctxB(), WL_1)?.revision).toBe(1);
    expect(store.getLatestProfile(ctxB(), WL_1)?.name).toBe("role.b");
    expect(store.getProfileRevision(ctxA(), WL_1, 1)?.name).toBe("role.a");
    expect(store.getProfileRevision(ctxB(), WL_1, 1)?.name).toBe("role.b");
  });

  test("a cross-tenant revise is indistinguishable from an unknown workload (no existence leak)", () => {
    const store = createInMemoryWorkloadProfileStore();
    store.createProfile(ctxA(), createInput());

    const foreign = store.reviseProfile(ctxB(), WL_1, {
      name: "attacker",
      description: "attempting to revise tenant A's profile from tenant B",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.kind).toBe("DomainError");
    if (foreign.error.kind !== "DomainError") return;
    expect(foreign.error.code).toBe("workloads.profile.domain");
    expect(foreign.error.invariant).toBe("workload_unknown");

    // The SAME error surfaces for a workload that exists nowhere — the
    // error carries no side channel about tenant A's partition.
    const unknown = store.reviseProfile(ctxB(), WL_2, {
      name: "x",
      description: "x",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.message).toBe(foreign.error.message);
    // Tenant A's profile is untouched.
    expect(store.getLatestProfile(ctxA(), WL_1)?.revision).toBe(1);
  });

  test("context-free and invalid-context access is rejected by the runtime guard (types bypassed)", () => {
    const store = createInMemoryWorkloadProfileStore();
    store.createProfile(ctxA(), createInput());

    expect(() => store.getLatestProfile(undefined as unknown as TenantContext, WL_1)).toThrow(
      TenantIsolationError,
    );
    expect(() =>
      store.getLatestProfile({ tenantId: "not-a-tenant-id" as never }, WL_1),
    ).toThrow(TenantIsolationError);
    expect(() => store.listProfiles(null as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() => store.size(undefined as unknown as TenantContext)).toThrow(TenantIsolationError);
    expect(() =>
      store.reviseProfile(undefined as unknown as TenantContext, WL_1, {
        name: "x",
        description: "x",
        requirements: balancedVector(),
        at: T1,
        correlationId: CORR,
      }),
    ).toThrow(TenantIsolationError);
    expect(() =>
      store.createProfile({ tenantId: "" as never }, createInput()),
    ).toThrow(TenantIsolationError);
  });

  test("duplicate creation within one tenant fails; different tenants may share the id", () => {
    const store = createInMemoryWorkloadProfileStore();
    expect(store.createProfile(ctxA(), createInput()).ok).toBe(true);
    const duplicate = store.createProfile(ctxA(), createInput());
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok || duplicate.error.kind !== "DomainError") return;
    expect(duplicate.error.invariant).toBe("workload_already_exists");
    expect(duplicate.error.tenantId).toBe(TENANT_A);

    // The same id in tenant B is a DIFFERENT profile (partitioned).
    expect(store.createProfile(ctxB(), createInput()).ok).toBe(true);
    expect(store.size(ctxA())).toBe(1);
    expect(store.size(ctxB())).toBe(1);
  });

  test("revision history is append-only and complete within the partition", () => {
    const store = createInMemoryWorkloadProfileStore();
    store.createProfile(ctxA(), createInput({ description: "rev1" }));
    store.reviseProfile(ctxA(), WL_1, {
      name: "finance.analyst",
      description: "rev2",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    store.reviseProfile(ctxA(), WL_1, {
      name: "finance.analyst",
      description: "rev3",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    const revisions = store.listRevisions(ctxA(), WL_1);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions.map((r) => r.description)).toEqual(["rev1", "rev2", "rev3"]);
    // Old revisions are still readable by number.
    expect(store.getProfileRevision(ctxA(), WL_1, 2)?.description).toBe("rev2");
    // Out-of-range revisions miss.
    expect(store.getProfileRevision(ctxA(), WL_1, 0)).toBeUndefined();
    expect(store.getProfileRevision(ctxA(), WL_1, 4)).toBeUndefined();
    expect(store.getProfileRevision(ctxA(), WL_1, 1.5)).toBeUndefined();
  });

  test("multi-workload enumeration is sorted by workloadId within the partition", () => {
    const store = createInMemoryWorkloadProfileStore();
    store.createProfile(ctxA(), createInput({ workloadId: WL_2 }));
    store.createProfile(ctxA(), createInput());
    const ids = store.listProfiles(ctxA()).map((p) => p.workloadId);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBe(2);
  });

  test("an empty tenant partition reads as empty (never as another tenant's data)", () => {
    const store = createInMemoryWorkloadProfileStore();
    const freshCtx = makeTenantContext(asTenantId("tnt_freshtenant0"));
    expect(store.listProfiles(freshCtx)).toEqual([]);
    expect(store.size(freshCtx)).toBe(0);
    expect(store.getLatestProfile(freshCtx, WL_1)).toBeUndefined();
    expect(store.listRevisions(freshCtx, WL_1)).toEqual([]);
  });

  test("invalid revision inputs are rejected with tagged errors (validation at the store boundary)", () => {
    const store = createInMemoryWorkloadProfileStore();
    store.createProfile(ctxA(), createInput());
    const bad = store.reviseProfile(ctxA(), WL_1, {
      name: "",
      description: "x",
      requirements: balancedVector(),
      at: T1,
      correlationId: CORR,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("ValidationError");
    expect(bad.error.tenantId).toBe(TENANT_A);
    // The store was not mutated by the failed write.
    expect(store.getLatestProfile(ctxA(), WL_1)?.revision).toBe(1);
  });
});
