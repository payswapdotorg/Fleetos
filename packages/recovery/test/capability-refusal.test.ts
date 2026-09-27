/**
 * W040 recovery — D3 tests: capability refusal for unsupported destructive
 * actions — never emulated, never a fallback.
 *
 * ARCHITECTURE-LOCK item 16: "Destructive actions require an explicit
 * policy grant and evidence trail." The work order adds: "UNSUPPORTED or
 * unauthorized destructive capabilities are refused with machine-stable
 * reasons BEFORE any seam call — never emulated, never a fallback."
 *
 * Every refusal here is proven at TWO levels:
 *   - the request store receives NO revision (nothing recorded);
 *   - the REAL in-memory platform seam recorded ZERO invocations
 *     (`seam.calls()` is empty) — the refusal happened at the gate,
 *     before any adapter/seam call.
 */

import { test, expect } from "bun:test";
import {
  requestDestructiveAction,
  createInMemoryDestructiveRequestStore,
  createInMemoryRecoveryCaseStore,
  createInMemoryRecoveryAuditSink,
  openRecoveryCase,
  transitionRecoveryCase,
} from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  DEV_A2,
  DEV_B1,
  CORR,
  scopeA,
  lostTrigger,
  realGuardian,
  ruleSet,
  adapter,
  FULLY_CAPABLE,
  NON_DESTRUCTIVE_CAPABILITIES,
} from "./helpers";

/** Open a tenant-A case on DEV_A1 or throw. */
function openCaseOrThrow(): import("../src/index").RecoveryCaseRecord {
  const store = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.record;
}

test("an UNSUPPORTED destructive capability is refused BEFORE any seam call (never emulated)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  // The adapter declares lock/locate/wipe/reboot UNSUPPORTED.
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, NON_DESTRUCTIVE_CAPABILITIES);
  expect(endpoint.capabilities.supported.includes("lock")).toBe(false);
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    auditSink: sink,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.code).toBe("recovery.destructive.refused");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("capability_unsupported");
  expect(result.error.message).toContain("never emulated");
  // Nothing was recorded and the seam was NEVER invoked.
  expect(store.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
  expect(sink.records).toHaveLength(0); // pure refusals never audit
});

test("each unsupported action of the set is refused with the same machine-stable reason", () => {
  const caseRecord = openCaseOrThrow();
  for (const action of ["lock", "locate", "wipe", "reboot"] as const) {
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, NON_DESTRUCTIVE_CAPABILITIES);
    const result = requestDestructiveAction(scopeA(), store, caseRecord, action, {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error(`expected failure for ${action}`);
    expect(result.error.kind).toBe("DomainError");
    if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
    expect(result.error.invariant).toBe("capability_unsupported");
    expect(seam.calls()).toHaveLength(0);
  }
});

test("an adapter fronting a DIFFERENT TENANT is refused before any seam call", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  // The adapter fronts tenant B's device — tenant isolation at the action boundary.
  const { adapter: endpoint, seam } = adapter(TENANT_B, DEV_B1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("adapter_tenant_mismatch");
  expect(store.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
});

test("an adapter fronting a DIFFERENT DEVICE than the case is refused before any seam call", () => {
  const caseRecord = openCaseOrThrow(); // case is on DEV_A1
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A2, FULLY_CAPABLE); // adapter fronts DEV_A2
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("adapter_device_mismatch");
  expect(store.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
});

test("a case that is NOT in an active recovery state cannot request destructive actions", () => {
  const caseStore = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    scopeA(),
    caseStore,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR },
  );
  if (!opened.ok) throw new Error(opened.error.message);
  const secured = transitionRecoveryCase(scopeA(), caseStore, opened.record, "SECURING", { at: T1, correlationId: CORR });
  if (!secured.ok) throw new Error(secured.error.message);
  const done = transitionRecoveryCase(scopeA(), caseStore, secured.record, "SECURED", { at: T1, correlationId: CORR });
  if (!done.ok) throw new Error(done.error.message);
  const requestStore = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), requestStore, done.record, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("case_not_active");
  expect(requestStore.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
});

test("a case of a FOREIGN TENANT cannot request under tenant-A's scope (tenant_mismatch)", () => {
  // A tenant-B case on tenant-B's device.
  const caseStore = createInMemoryRecoveryCaseStore();
  const foreignCase = openRecoveryCase(
    { tenantId: TENANT_B, correlationId: CORR },
    caseStore,
    { deviceId: DEV_B1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR },
  );
  if (!foreignCase.ok) throw new Error(foreignCase.error.message);
  const requestStore = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), requestStore, foreignCase.record, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("tenant_mismatch");
  expect(requestStore.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
});

test("the capability check fires BEFORE the Guardian (fail-fast: an unexecutable proposal never evaluates policy)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, NON_DESTRUCTIVE_CAPABILITIES);
  // Even a BLOCK rule set never gets consulted: the capability refusal wins.
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "wipe", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: () => {
      throw new Error("the Guardian must not be consulted for an unsupported capability");
    },
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.kind).toBe("DomainError");
  if (result.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(result.error.invariant).toBe("capability_unsupported");
  expect(seam.calls()).toHaveLength(0);
});

test("a missing adapter/evaluator/ruleSet is a tagged ValidationError (types bypassed)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const missingAdapter = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: undefined as never,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(missingAdapter.ok).toBe(false);
  if (missingAdapter.ok) throw new Error("expected failure");
  expect(missingAdapter.error.kind).toBe("ValidationError");
  if (missingAdapter.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(missingAdapter.error.failures.map((f) => f.reason)).toContain("adapter_required");
  const missingEvaluator = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: undefined as never,
    adapter: adapter(TENANT_A, DEV_A1, FULLY_CAPABLE).adapter,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(missingEvaluator.ok).toBe(false);
  if (missingEvaluator.ok) throw new Error("expected failure");
  expect(missingEvaluator.error.kind).toBe("ValidationError");
  if (missingEvaluator.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(missingEvaluator.error.failures.map((f) => f.reason)).toContain("function_required");
});
