/**
 * @fleetos/identity — Tenant isolation test harness (W012 D1).
 *
 * A reusable, self-contained suite that verifies the tenant-isolation
 * invariants of ANY `TenantScopedStore` implementation:
 *
 *   1. own-tenant write/read roundtrip works;
 *   2. a cross-tenant read cannot observe another tenant's value;
 *   3. same-key writes in different tenants do not interfere;
 *   4. context-free access is REJECTED by the runtime guard (the type system
 *      is bypassed on purpose — that is the point of the guard);
 *   5. an invalid tenant context is rejected;
 *   6. list/size are scoped to the acting tenant;
 *   7. remove is scoped to the acting tenant.
 *
 * This harness is defined in @fleetos/identity and consumed via import by
 * same-lane packages (workloads, vendors, procurement, software,
 * maintenance) when they implement `TenantScopedStore` against durable
 * storage. Cross-lane lanes reuse it conceptually: the checks below are the
 * lane-independent isolation contract (the ownership gate forbids importing
 * @fleetos/identity from other lanes; their stores mirror the pattern).
 *
 * The harness is pure: no clock reads, no entropy — every check uses the
 * injected tenant ids and value factory.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { TenantContext } from "./tenant-context";
import { makeTenantContext } from "./tenant-context";
import { TenantIsolationError } from "./tenant-context";
import type { TenantScopedStore } from "./tenant-store";

/**
 * The result of one isolation check. `name` is machine-stable (callers and
 * tests match on it); `detail` is human-readable context.
 */
export interface TenantIsolationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * The aggregate report of an isolation suite run. `ok` is true iff every
 * check passed.
 */
export interface TenantIsolationReport {
  readonly ok: boolean;
  readonly checks: readonly TenantIsolationCheck[];
}

/**
 * Inputs to `runTenantIsolationSuite`.
 *
 * @template V the stored value type
 */
export interface TenantIsolationSuiteInput<V> {
  /** The two tenants used by the checks (must be distinct and valid). */
  readonly tenantA: TenantId;
  readonly tenantB: TenantId;
  /** Factory for the store under test. */
  readonly makeStore: () => TenantScopedStore<V>;
  /** Deterministic value factory: same (tenant, key) -> same value. */
  readonly makeValue: (tenantId: TenantId, key: string) => V;
}

/**
 * Run the tenant-isolation suite against a `TenantScopedStore`
 * implementation. Pure with respect to the injected inputs; the store is
 * created fresh via `makeStore` and never leaks out.
 *
 * @template V the stored value type
 * @param input the suite inputs
 * @returns a frozen report with one entry per invariant
 */
export function runTenantIsolationSuite<V>(
  input: TenantIsolationSuiteInput<V>,
): TenantIsolationReport {
  const store = input.makeStore();
  const ctxA: TenantContext = makeTenantContext(input.tenantA);
  const ctxB: TenantContext = makeTenantContext(input.tenantB);
  const valueA = input.makeValue(input.tenantA, "k1");
  const valueB = input.makeValue(input.tenantB, "k1");
  // Created once and shared by checks 6 and 7 so reference comparison works
  // for structured values, not just primitives.
  const valueA2 = input.makeValue(input.tenantA, "k2");

  const checks: TenantIsolationCheck[] = [];

  // 1. own-tenant write/read roundtrip.
  let passed = false;
  let detail = "";
  try {
    store.put(ctxA, "k1", valueA);
    passed = store.get(ctxA, "k1") === valueA;
    detail = passed ? "roundtrip ok" : `read-back mismatch: ${String(store.get(ctxA, "k1"))}`;
  } catch (err) {
    passed = false;
    detail = `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({ name: "own_tenant_roundtrip", passed, detail });

  // 2. cross-tenant read must miss (undefined), never leak tenant A's value.
  let crossLeak: unknown;
  try {
    crossLeak = store.get(ctxB, "k1");
    passed = crossLeak === undefined;
    detail = passed
      ? "cross-tenant read missed as required"
      : `cross-tenant read leaked a value: ${String(crossLeak)}`;
  } catch (err) {
    // A throw on cross-tenant read is an acceptable (stricter) behavior only
    // if the read did not return the value; treat a throw as a miss.
    passed = true;
    detail = `cross-tenant read rejected (strict): ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
  checks.push({ name: "cross_tenant_read_miss", passed, detail });

  // 3. same-key writes in different tenants must not interfere.
  try {
    store.put(ctxB, "k1", valueB);
    const a1 = store.get(ctxA, "k1");
    const b1 = store.get(ctxB, "k1");
    passed = a1 === valueA && b1 === valueB;
    detail = passed
      ? "same-key writes partitioned by tenant"
      : `partition interference: A=${String(a1)} B=${String(b1)}`;
  } catch (err) {
    passed = false;
    detail = `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({ name: "same_key_partition", passed, detail });

  // 4. context-free access must be REJECTED by the runtime guard. The type
  //    system is bypassed on purpose (undefined cast) — that is the attack
  //    the guard exists to stop.
  try {
    store.get(undefined as unknown as TenantContext, "k1");
    passed = false;
    detail = "context-free access was NOT rejected";
  } catch (err) {
    passed = err instanceof TenantIsolationError;
    detail = passed
      ? "context-free access rejected with TenantIsolationError"
      : `context-free access threw an unexpected error type: ${
          err instanceof Error ? err.name : String(err)
        }`;
  }
  checks.push({ name: "context_free_rejected", passed, detail });

  // 5. an invalid tenant context must be rejected.
  try {
    store.get(
      frozen({ tenantId: "not-a-tenant-id" as unknown as TenantId }),
      "k1",
    );
    passed = false;
    detail = "invalid tenant context was NOT rejected";
  } catch (err) {
    passed = err instanceof TenantIsolationError;
    detail = passed
      ? "invalid tenant context rejected with TenantIsolationError"
      : `invalid tenant context threw an unexpected error type: ${
          err instanceof Error ? err.name : String(err)
        }`;
  }
  checks.push({ name: "invalid_context_rejected", passed, detail });

  // 6. list/size are scoped to the acting tenant. Values are compared by
  //    reference against the STORED values (the harness must work for
  //    structured values, not just primitives).
  try {
    store.put(ctxA, "k2", valueA2);
    const storedA = new Map<string, V>([
      ["k1", valueA],
      ["k2", valueA2],
    ]);
    const listA = store.list(ctxA);
    const listB = store.list(ctxB);
    passed =
      store.size(ctxA) === 2 &&
      store.size(ctxB) === 1 &&
      listA.length === 2 &&
      listB.length === 1 &&
      listA.every((e) => e.value === storedA.get(e.key));
    detail = passed
      ? "list/size scoped to acting tenant"
      : `unscoped enumeration: sizeA=${store.size(ctxA)} sizeB=${store.size(ctxB)}`;
  } catch (err) {
    passed = false;
    detail = `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({ name: "enumeration_scoped", passed, detail });

  // 7. remove is scoped to the acting tenant.
  try {
    const removedInB = store.remove(ctxB, "k2");
    const stillInA = store.get(ctxA, "k2");
    passed = removedInB === false && stillInA === valueA2;
    detail = passed
      ? "remove scoped to acting tenant"
      : `remove crossed partitions: removedInB=${String(removedInB)} stillInA=${String(stillInA)}`;
  } catch (err) {
    passed = false;
    detail = `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({ name: "remove_scoped", passed, detail });

  return frozen({
    ok: checks.every((c) => c.passed),
    checks: Object.freeze([...checks]),
  });
}
