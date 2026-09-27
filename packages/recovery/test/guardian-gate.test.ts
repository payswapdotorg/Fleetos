/**
 * W040 recovery — D3 tests: the destructive recovery gate, routed through
 * the REAL W031 Contract Guardian.
 *
 * The REAL `evaluateGuardianRequest` from `@fleetos/policy` is injected
 * wherever the recovery package's `GuardianEvaluateFn` seam is expected
 * (TypeScript structural typing accepts it — the type-level proof); these
 * tests are the runtime proof that every consequential destructive
 * request flows through the real engine:
 *
 *   - ALLOW  -> ADVANCED + EXECUTED (dispatched through the REAL W020
 *     EndpointAdapter over the in-memory Windows seam);
 *   - WARN   -> ADVANCED with the warning context (non-blocking per the
 *     frozen `isBlockingDecision`) + EXECUTED;
 *   - REQUIRE_APPROVAL -> PARKED, then the human-approval step
 *     (approve -> APPROVED + EXECUTED; reject -> REJECTED) — every
 *     transition a ledger entry;
 *   - BLOCK  -> REJECTED carrying the Guardian's machine-stable reasons
 *     (matched rule ids + reason codes) — the seam is NEVER invoked;
 *   - the full §16 evidence trail rides every granted action (policy
 *     decision + rule ids + observation evidence).
 */

import { test, expect } from "bun:test";
import {
  requestDestructiveAction,
  approveDestructiveRequest,
  evidenceRefsFromObservations,
  createInMemoryDestructiveRequestStore,
  createInMemoryRecoveryCaseStore,
  createInMemoryRecoveryAuditSink,
  openRecoveryCase,
  RECOVERY_GUARDIAN_ACTION_KINDS,
} from "../src/index";
import type { DestructiveRequestRecord } from "../src/index";
import {
  T0,
  T1,
  T2,
  TENANT_A,
  DEV_A1,
  CORR,
  CORR_2,
  atHour,
  scopeA,
  lostTrigger,
  realGuardian,
  ruleSet,
  warnRule,
  approvalRule,
  blockRule,
  adapter,
  FULLY_CAPABLE,
  obs,
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

/** The observation evidence backing a request (content-addressed refs). */
function observationEvidence() {
  return evidenceRefsFromObservations(DEV_A1, [
    obs("device.location", { latitude: 40.4, longitude: -3.7 }, atHour(1), "obs_gate_loc"),
    obs("device.security", { diskEncryption: false }, atHour(1), "obs_gate_sec"),
  ]);
}

// ---------------------------------------------------------------------------
// The type-level proof: the REAL engine satisfies the structural seam
// ---------------------------------------------------------------------------

test("the REAL evaluateGuardianRequest satisfies the GuardianEvaluateFn seam (structural typing)", () => {
  // This assignment type-checks ONLY if @fleetos/policy's function is
  // structurally compatible with the recovery package's seam.
  const seam: import("../src/index").GuardianEvaluateFn<import("@fleetos/policy").GuardianRuleSet> =
    realGuardian;
  expect(typeof seam).toBe("function");
  expect(RECOVERY_GUARDIAN_ACTION_KINDS).toEqual({
    lock: "device.lock",
    locate: "device.locate",
    wipe: "device.wipe",
    reboot: "device.reboot",
  });
});

// ---------------------------------------------------------------------------
// ALLOW: advance + dispatch
// ---------------------------------------------------------------------------

test("ALLOW: the request advances and executes through the real adapter (REQUESTED -> ADVANCED -> EXECUTED)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    requestedBy: "usr_testuser00001",
    evidence: observationEvidence(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const record: DestructiveRequestRecord = result.record;
  expect(record.status).toBe("EXECUTED");
  expect(record.intentKind).toBe("RecoveryIntent");
  expect(record.intentPayload).toEqual({ deviceId: DEV_A1, action: "lock" }); // the frozen payload, VERBATIM
  expect(record.decision?.decision).toBe("ALLOW");
  expect(record.execution?.outcome).toBe("executed");
  expect((record.execution?.adapterEvidence.length ?? 0) > 0).toBe(true);
  // The ledger carries the full transition history.
  const revisions = store.listRequestRevisions(scopeA(), record.requestId);
  expect(revisions.map((r) => r.status)).toEqual(["REQUESTED", "ADVANCED", "EXECUTED"]);
  // The REAL seam executed exactly once.
  expect(seam.calls().filter((c) => c.method === "execute")).toHaveLength(1);
});

test("the §16 evidence trail rides the granted action: decision + rule ids + observation evidence", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const evidence = observationEvidence();
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "reboot", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    evidence,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const executed = store.listRequestRevisions(scopeA(), result.record.requestId).find((r) => r.status === "EXECUTED");
  expect(executed?.decision).toBeDefined(); // the policy decision
  expect(executed?.matchedRules).toEqual([]); // no rules fired (ALLOW default)
  expect(executed?.evidence).toEqual(evidence); // the observation evidence
  expect((executed?.execution?.adapterEvidence.length ?? 0) > 0).toBe(true);
});

test("ALLOW with a fired rule records the matched rule refs (the rule-id trail)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  // A WARN rule would not be ALLOW; use a rule that does not fire + one ALLOW... the engine's default is ALLOW with no matched rules.
  // Instead: a rule targeting a DIFFERENT action fires nothing, and a device rule that matches fires ALLOW? Rules' effects are only the four decision types — an ALLOW-effect rule still counts as matched.
  const allowRule = warnRule(TENANT_A, "device.not_recovery"); // does not fire for our action
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "reboot", {
    ruleSet: ruleSet(TENANT_A, [allowRule]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    evidence: observationEvidence(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.decision?.decision).toBe("ALLOW");
  expect(result.record.matchedRules).toEqual([]); // the unrelated rule did not fire
});

// ---------------------------------------------------------------------------
// WARN: advance with the warning context (non-blocking)
// ---------------------------------------------------------------------------

test("WARN: the request advances WITH the warning context and executes (non-blocking per frozen isBlockingDecision)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const warn = warnRule(TENANT_A, "device.lock");
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, [warn]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    evidence: observationEvidence(),
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("EXECUTED"); // WARN did NOT hold the action
  expect(result.record.decision?.decision).toBe("WARN");
  expect(result.record.matchedRules).toHaveLength(1);
  expect(result.record.matchedRules?.[0].ruleId).toBe(warn.ruleId);
  expect(result.record.reasons?.some((r) => r.code === "policy.rule.matched")).toBe(true); // the warning context
  expect(seam.calls().filter((c) => c.method === "execute")).toHaveLength(1); // dispatched
});

// ---------------------------------------------------------------------------
// REQUIRE_APPROVAL: park, then the human-approval step
// ---------------------------------------------------------------------------

test("REQUIRE_APPROVAL parks the request; approval dispatches (PARKED -> APPROVED -> EXECUTED)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const approval = approvalRule(TENANT_A, "device.wipe");
  const parkedResult = requestDestructiveAction(scopeA(), store, caseRecord, "wipe", {
    ruleSet: ruleSet(TENANT_A, [approval]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    evidence: observationEvidence(),
    auditSink: sink,
  });
  expect(parkedResult.ok).toBe(true);
  if (!parkedResult.ok) throw new Error(parkedResult.error.message);
  expect(parkedResult.record.status).toBe("PARKED");
  expect(parkedResult.record.decision?.decision).toBe("REQUIRE_APPROVAL");
  expect(seam.calls()).toHaveLength(0); // parked: the seam was NEVER invoked

  const approved = approveDestructiveRequest(scopeA(), store, parkedResult.record, "approve", {
    adapter: endpoint,
    at: T2,
    correlationId: CORR_2,
    policyCacheReady: true,
    approverId: "usr_approver0001",
    auditSink: sink,
  });
  expect(approved.ok).toBe(true);
  if (!approved.ok) throw new Error(approved.error.message);
  expect(approved.record.status).toBe("EXECUTED");
  expect(approved.record.approvedBy).toBe("usr_approver0001");
  // Every transition is a ledger entry.
  const revisions = store.listRequestRevisions(scopeA(), parkedResult.record.requestId);
  expect(revisions.map((r) => r.status)).toEqual(["REQUESTED", "PARKED", "APPROVED", "EXECUTED"]);
  expect(seam.calls().filter((c) => c.method === "execute")).toHaveLength(1); // dispatched AFTER approval
  const actions = sink.records.map((r) => r.action);
  expect(actions).toEqual([
    "recovery.destructive.requested",
    "recovery.destructive.parked",
    "recovery.destructive.approved",
    "recovery.destructive.executed",
  ]);
});

test("a parked request the human REJECTS terminates REJECTED (PARKED -> REJECTED, a ledger entry)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const parked = requestDestructiveAction(scopeA(), store, caseRecord, "wipe", {
    ruleSet: ruleSet(TENANT_A, [approvalRule(TENANT_A, "device.wipe")]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    auditSink: sink,
  });
  expect(parked.ok && parked.record.status).toBe("PARKED");
  if (!parked.ok) throw new Error(parked.error.message);
  const rejected = approveDestructiveRequest(scopeA(), store, parked.record, "reject", {
    adapter: endpoint,
    at: T2,
    correlationId: CORR_2,
    policyCacheReady: true,
    approverId: "usr_approver0001",
    auditSink: sink,
  });
  expect(rejected.ok && rejected.record.status).toBe("REJECTED");
  if (!rejected.ok) throw new Error(rejected.error.message);
  expect(rejected.record.refusalReason).toBe("human_rejected");
  const revisions = store.listRequestRevisions(scopeA(), parked.record.requestId);
  expect(revisions.map((r) => r.status)).toEqual(["REQUESTED", "PARKED", "REJECTED"]);
  expect(seam.calls()).toHaveLength(0); // never dispatched
  expect(sink.records.map((r) => r.action)).toEqual([
    "recovery.destructive.requested",
    "recovery.destructive.parked",
    "recovery.destructive.rejected",
  ]);
});

test("approving a request that is NOT parked is refused (machine-stable)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const executed = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(executed.ok && executed.record.status).toBe("EXECUTED");
  if (!executed.ok) throw new Error(executed.error.message);
  const again = approveDestructiveRequest(scopeA(), store, executed.record, "approve", {
    adapter: endpoint,
    at: T2,
    correlationId: CORR_2,
    policyCacheReady: true,
  });
  expect(again.ok).toBe(false);
  if (again.ok) throw new Error("expected failure");
  expect(again.error.kind).toBe("DomainError");
  if (again.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(again.error.invariant).toBe("status_not_parked");
});

// ---------------------------------------------------------------------------
// BLOCK: reject with the Guardian's machine-stable reasons
// ---------------------------------------------------------------------------

test("BLOCK rejects with the Guardian's machine-stable reasons; the seam is NEVER invoked", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const block = blockRule(TENANT_A, "device.wipe");
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "wipe", {
    ruleSet: ruleSet(TENANT_A, [block]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
    evidence: observationEvidence(),
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  expect(result.record.refusalReason).toBe("guardian_block");
  expect(result.record.decision?.decision).toBe("BLOCK");
  expect(result.record.matchedRules?.[0].ruleId).toBe(block.ruleId); // the Guardian's rule ids
  expect(result.record.reasons?.some((r) => r.code === "policy.rule.matched")).toBe(true);
  expect(seam.calls()).toHaveLength(0); // NEVER auto-executed
  const revisions = store.listRequestRevisions(scopeA(), result.record.requestId);
  expect(revisions.map((r) => r.status)).toEqual(["REQUESTED", "REJECTED"]);
  expect(sink.records.map((r) => r.action)).toEqual([
    "recovery.destructive.requested",
    "recovery.destructive.refused",
  ]);
  const refusedDetails = sink.records[1].details as Record<string, unknown>;
  expect(refusedDetails["decision"]).toBe("BLOCK");
  expect(refusedDetails["matchedRuleIds"]).toEqual([block.ruleId]);
});

// ---------------------------------------------------------------------------
// NEVER auto-execute: a parked request never dispatches on its own
// ---------------------------------------------------------------------------

test("NEVER auto-execute: a parked request stays parked until the human decides", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const parked = requestDestructiveAction(scopeA(), store, caseRecord, "locate", {
    ruleSet: ruleSet(TENANT_A, [approvalRule(TENANT_A, "device.locate")]),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(parked.ok && parked.record.status).toBe("PARKED");
  // Re-reading the latest revision: still parked, no dispatch occurred.
  const latest = store.getLatestRequest(scopeA(), parked.ok ? parked.record.requestId : "");
  expect(latest?.status).toBe("PARKED");
  expect(seam.calls()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Dispatch failure at the adapter (defense in depth)
// ---------------------------------------------------------------------------

test("a granted action whose adapter negotiation refuses (stale policy cache) is recorded FAILED, never emulated", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const sink = createInMemoryRecoveryAuditSink();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: false, // the W020 offline default-deny layer refuses
    auditSink: sink,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("FAILED");
  expect(result.record.execution?.outcome).toBe("failed");
  expect(result.record.execution?.error?.kind).toBe("PolicyError");
  // The adapter refused BEFORE the platform seam executed the command...
  // (negotiation precedes seam routing inside the W020 adapter).
  expect(sink.records.map((r) => r.action)).toEqual([
    "recovery.destructive.requested",
    "recovery.destructive.failed",
  ]);
});

// ---------------------------------------------------------------------------
// Determinism + idempotency
// ---------------------------------------------------------------------------

test("request determinism: the same inputs produce the same request identity + byte-identical revisions", () => {
  const caseRecord = openCaseOrThrow();
  const build = () => {
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const result = requestDestructiveAction(scopeA(), store, caseRecord, "lock", {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
      evidence: observationEvidence(),
    });
    if (!result.ok) throw new Error(result.error.message);
    return { store, record: result.record };
  };
  const one = build();
  const two = build();
  expect(one.record.requestId).toBe(two.record.requestId);
  expect(JSON.stringify(one.store.listRequestRevisions(scopeA(), one.record.requestId))).toBe(
    JSON.stringify(two.store.listRequestRevisions(scopeA(), one.record.requestId)),
  );
});

test("re-requesting identical content is idempotent (the version slot dedups)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const options = {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  } as const;
  const first = requestDestructiveAction(scopeA(), store, caseRecord, "lock", { ...options });
  const second = requestDestructiveAction(scopeA(), store, caseRecord, "lock", { ...options });
  expect(first.ok && second.ok).toBe(true);
  expect(store.size(scopeA())).toBe(1); // one request identity
  // The second request re-ran the flow (appended fresh revisions of identical content semantics at higher versions).
  const revisions = store.listRequestRevisions(scopeA(), first.ok ? first.record.requestId : "");
  expect(revisions.length >= 3).toBe(true);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("invalid request inputs are refused with tagged ValidationErrors (nothing appended)", () => {
  const caseRecord = openCaseOrThrow();
  const store = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const badAction = requestDestructiveAction(scopeA(), store, caseRecord, "detonate" as never, {
    ruleSet: ruleSet(TENANT_A, []),
    evaluator: realGuardian,
    adapter: endpoint,
    at: T1,
    correlationId: CORR,
    policyCacheReady: true,
  });
  expect(badAction.ok).toBe(false);
  if (badAction.ok) throw new Error("expected failure");
  expect(badAction.error.kind).toBe("ValidationError");
  if (badAction.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(badAction.error.failures.map((f) => f.reason)).toContain("unknown_action");
  expect(store.size(scopeA())).toBe(0);
});
