/**
 * W040 recovery — D5 tests: tenant isolation by construction (exhaustive).
 *
 * Every store (last-seen ledger, recovery-case store, destructive-request
 * store, replacement-escalation ledger):
 *   - TenantContext-first: every operation takes the acting scope as its
 *     FIRST parameter;
 *   - the runtime guard rejects context-free and invalid-tenant access
 *     even when the TYPES ARE BYPASSED (`undefined as never`, malformed
 *     ids — proven by test);
 *   - storage is partitioned per tenant; no operation accepts a tenant
 *     override — a tenant-A scope can never read tenant-B state;
 *   - foreign ids (entities that exist only in another tenant's
 *     partition) are INDISTINGUISHABLE from unknown ones (no existence
 *     side channel);
 *   - cross-tenant writes are refused with machine-stable
 *     `tenant_mismatch` DomainErrors.
 */

import { test, expect } from "bun:test";
import { asTenantId, asDeviceId } from "@fleetos/contracts";
import {
  createInMemoryLastSeenLedger,
  createInMemoryRecoveryCaseStore,
  createInMemoryDestructiveRequestStore,
  createInMemoryReplacementEscalationLedger,
  recordLastSeenObservations,
  openRecoveryCase,
  transitionRecoveryCase,
  requestDestructiveAction,
  escalateReplacement,
  findMyDevice,
} from "../src/index";
import type { RecoveryCaseRecord, ReplacementEscalationRecord } from "../src/index";
import {
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  DEV_A1,
  DEV_B1,
  CORR,
  CORR_2,
  THRESHOLDS,
  atHour,
  scopeA,
  scopeB,
  lostTrigger,
  realGuardian,
  ruleSet,
  adapter,
  FULLY_CAPABLE,
  obs,
  batch,
} from "./helpers";

/** An invalid tenant id (fails the frozen canonical grammar). */
const BAD_TENANT = asTenantId("not_a_tenant_id");
const BAD_SCOPE = { tenantId: BAD_TENANT, correlationId: CORR };

// ---------------------------------------------------------------------------
// Shared fixtures: state in BOTH tenants' partitions
// ---------------------------------------------------------------------------

function populatedLastSeen() {
  const ledger = createInMemoryLastSeenLedger();
  recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  recordLastSeenObservations(scopeB(), ledger, DEV_B1, [batch(DEV_B1, [obs("device.health", 1, atHour(1))], atHour(1), TENANT_B)], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR_2,
  });
  return ledger;
}

function populatedCaseStore() {
  const store = createInMemoryRecoveryCaseStore();
  const a = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR },
  );
  const b = openRecoveryCase(
    scopeB(),
    store,
    { deviceId: DEV_B1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR_2 },
  );
  if (!a.ok || !b.ok) throw new Error("fixture failed");
  return { store, caseA: a.record, caseB: b.record };
}

function populatedEscalationLedger() {
  const ledger = createInMemoryReplacementEscalationLedger();
  const diagnosis = (deviceId: string) => ({
    hypothesisId: `hyp_${deviceId}`,
    recommendationId: `tr_${deviceId}`,
    causeId: "health.hardware_failing",
    confidence: 0.8,
    proposedIntent: {
      intentKind: "ReplacementIntent" as const,
      payload: { deviceId, reason: "failing" },
    },
    observationIds: [`obs_${deviceId}`],
  });
  const a = escalateReplacement(
    scopeA(),
    ledger,
    { deviceId: DEV_A1, diagnosis: diagnosis(DEV_A1 as string) },
    { at: T1, correlationId: CORR },
  );
  const b = escalateReplacement(
    scopeB(),
    ledger,
    { deviceId: DEV_B1, diagnosis: diagnosis(DEV_B1 as string) },
    { at: T1, correlationId: CORR_2 },
  );
  if (!a.ok || !b.ok) throw new Error("fixture failed");
  return { ledger, escalationA: a.record, escalationB: b.record };
}

// ---------------------------------------------------------------------------
// Context-free + invalid-tenant access (types bypassed)
// ---------------------------------------------------------------------------

test("context-free scope (undefined as never) is rejected by every store", () => {
  const lastSeen = populatedLastSeen();
  expect(recordLastSeenObservations(undefined as never, lastSeen, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  }).ok).toBe(false);
  expect(lastSeen.resolveLastSeen(undefined as never, DEV_A1)).toBeUndefined();
  expect(findMyDevice(undefined as never, lastSeen, DEV_A1, { at: atHour(2), thresholds: THRESHOLDS }).location.status).toBe(
    "no_location_evidence",
  );

  const cases = populatedCaseStore();
  expect(openRecoveryCase(undefined as never, cases.store, { deviceId: DEV_A1, trigger: lostTrigger() }, { at: T0, correlationId: CORR }).ok).toBe(false);
  expect(cases.store.getLatestCase(undefined as never, cases.caseA.caseId)).toBeUndefined();
  expect(cases.store.listCaseIds(undefined as never)).toEqual([]);
  expect(cases.store.size(undefined as never)).toBe(0);
  expect(
    transitionRecoveryCase(undefined as never, cases.store, cases.caseA, "SECURING", { at: T1, correlationId: CORR }).ok,
  ).toBe(false);

  const requests = createInMemoryDestructiveRequestStore();
  expect(requests.getLatestRequest(undefined as never, "dr_anything")).toBeUndefined();
  expect(requests.listRequestIds(undefined as never)).toEqual([]);
  expect(requests.size(undefined as never)).toBe(0);

  const escalations = populatedEscalationLedger();
  expect(escalations.ledger.getLatestEscalation(undefined as never, escalations.escalationA.escalationId)).toBeUndefined();
  expect(escalations.ledger.listEscalationIds(undefined as never)).toEqual([]);
  expect(escalations.ledger.size(undefined as never)).toBe(0);
});

test("an invalid tenant id (bad grammar) is rejected by every store", () => {
  const lastSeen = populatedLastSeen();
  expect(lastSeen.resolveLastSeen(BAD_SCOPE, DEV_A1)).toBeUndefined();
  const recordAttempt = recordLastSeenObservations(BAD_SCOPE, lastSeen, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(recordAttempt.ok).toBe(false);
  if (recordAttempt.ok) throw new Error("expected failure");
  expect(recordAttempt.error.kind).toBe("DomainError");
  if (recordAttempt.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(recordAttempt.error.invariant).toBe("invalid_tenant_id");

  const cases = populatedCaseStore();
  expect(cases.store.getLatestCase(BAD_SCOPE, cases.caseA.caseId)).toBeUndefined();
  expect(cases.store.listCaseIds(BAD_SCOPE)).toEqual([]);

  const escalations = populatedEscalationLedger();
  expect(escalations.ledger.getLatestEscalation(BAD_SCOPE, escalations.escalationA.escalationId)).toBeUndefined();
  expect(escalations.ledger.listEscalationIds(BAD_SCOPE)).toEqual([]);
});

test("a malformed scope object (no tenantId) is rejected", () => {
  const cases = populatedCaseStore();
  expect(cases.store.getLatestCase({ correlationId: CORR } as never, cases.caseA.caseId)).toBeUndefined();
  expect(cases.store.listCaseIds(null as never)).toEqual([]);
  expect(cases.store.size("scope-as-string" as never)).toBe(0);
});

// ---------------------------------------------------------------------------
// Partition separation + foreign ids indistinguishable from unknown
// ---------------------------------------------------------------------------

test("each tenant sees ONLY its own last-seen partition; foreign devices are indistinguishable from unknown", () => {
  const ledger = populatedLastSeen();
  expect(ledger.listDeviceIds(scopeA())).toEqual([DEV_A1]);
  expect(ledger.listDeviceIds(scopeB())).toEqual([DEV_B1]);
  expect(ledger.size(scopeA())).toBe(1);
  expect(ledger.size(scopeB())).toBe(1);
  // Tenant B's device, seen from tenant A: identical to an unknown device.
  const foreign = ledger.resolveLastSeen(scopeA(), DEV_B1);
  const unknown = ledger.resolveLastSeen(scopeA(), asDeviceId("dev_never_seen"));
  expect(foreign).toBeUndefined();
  expect(unknown).toBeUndefined();
  const foreignView = findMyDevice(scopeA(), ledger, DEV_B1, { at: atHour(2), thresholds: THRESHOLDS });
  const unknownView = findMyDevice(scopeA(), ledger, asDeviceId("dev_never_seen"), { at: atHour(2), thresholds: THRESHOLDS });
  expect(JSON.stringify(foreignView)).toBe(JSON.stringify({ ...unknownView, deviceId: DEV_B1 }));
});

test("each tenant sees ONLY its own cases; foreign case ids are indistinguishable from unknown", () => {
  const { store, caseA, caseB } = populatedCaseStore();
  expect(store.listCaseIds(scopeA())).toEqual([caseA.caseId]);
  expect(store.listCaseIds(scopeB())).toEqual([caseB.caseId]);
  // Tenant A cannot read tenant B's case — same result as an unknown id.
  expect(store.getLatestCase(scopeA(), caseB.caseId)).toBeUndefined();
  expect(store.getLatestCase(scopeA(), "rc_unknown_case")).toBeUndefined();
  expect(store.listCaseRevisions(scopeA(), caseB.caseId)).toEqual([]);
  expect(store.getCaseRevision(scopeB(), caseA.caseId, 1)).toBeUndefined();
});

test("each tenant sees ONLY its own escalations; foreign escalation ids are indistinguishable from unknown", () => {
  const { ledger, escalationA, escalationB } = populatedEscalationLedger();
  expect(ledger.listEscalationIds(scopeA())).toEqual([escalationA.escalationId]);
  expect(ledger.listEscalationIds(scopeB())).toEqual([escalationB.escalationId]);
  expect(ledger.getLatestEscalation(scopeA(), escalationB.escalationId)).toBeUndefined();
  expect(ledger.getLatestEscalation(scopeA(), "re_unknown")).toBeUndefined();
  expect(ledger.listEscalationRevisions(scopeB(), escalationA.escalationId)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Cross-tenant writes are refused (machine-stable tenant_mismatch)
// ---------------------------------------------------------------------------

test("cross-tenant last-seen writes are refused with tenant_mismatch", () => {
  const ledger = createInMemoryLastSeenLedger();
  // Derive a tenant-A record, then attempt to append it under tenant-B's scope.
  const result = recordLastSeenObservations(scopeA(), ledger, DEV_A1, [batch(DEV_A1, [obs("device.health", 1, atHour(1))], atHour(1))], {
    at: atHour(2),
    thresholds: THRESHOLDS,
    correlationId: CORR,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const record = result.record;
  const cross = ledger.appendLastSeen(scopeB(), record);
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected failure");
  expect(cross.error.kind).toBe("DomainError");
  if (cross.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(cross.error.invariant).toBe("tenant_mismatch");
  expect(ledger.size(scopeB())).toBe(0);
});

test("cross-tenant case writes + transitions are refused with tenant_mismatch", () => {
  const { store, caseA } = populatedCaseStore();
  const cross = store.appendCase(scopeB(), caseA);
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected failure");
  expect(cross.error.kind).toBe("DomainError");
  if (cross.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(cross.error.invariant).toBe("tenant_mismatch");
  const crossTransition = transitionRecoveryCase(scopeB(), store, caseA as RecoveryCaseRecord, "SECURING", {
    at: T1,
    correlationId: CORR_2,
  });
  expect(crossTransition.ok).toBe(false);
  if (crossTransition.ok) throw new Error("expected failure");
  expect(crossTransition.error.kind).toBe("DomainError");
  if (crossTransition.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(crossTransition.error.invariant).toBe("tenant_mismatch");
});

test("cross-tenant escalation writes + supersessions are refused with tenant_mismatch", () => {
  const { ledger, escalationA } = populatedEscalationLedger();
  const cross = ledger.appendEscalation(scopeB(), escalationA as ReplacementEscalationRecord);
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected failure");
  expect(cross.error.kind).toBe("DomainError");
  if (cross.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(cross.error.invariant).toBe("tenant_mismatch");
});

test("a destructive request for a foreign-tenant case is refused at the gate", () => {
  const { store, caseB } = populatedCaseStore();
  const requests = createInMemoryDestructiveRequestStore();
  const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
  const result = requestDestructiveAction(scopeA(), requests, caseB, "lock", {
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
  expect(requests.size(scopeA())).toBe(0);
  expect(seam.calls()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Version-slot discipline across tenants
// ---------------------------------------------------------------------------

test("a tenant's version slots are independent of another tenant's (no cross-tenant sequence pollution)", () => {
  const store = createInMemoryRecoveryCaseStore();
  // Tenant A: a case with two revisions.
  const a1 = openRecoveryCase(scopeA(), store, { deviceId: DEV_A1, trigger: lostTrigger() }, { at: T0, correlationId: CORR });
  if (!a1.ok) throw new Error(a1.error.message);
  const a2 = transitionRecoveryCase(scopeA(), store, a1.record, "SECURING", { at: T1, correlationId: CORR });
  if (!a2.ok) throw new Error(a2.error.message);
  // Tenant B: an unrelated case reaches version 3 too — same version numbers, different partitions.
  const b1 = openRecoveryCase(scopeB(), store, { deviceId: DEV_B1, trigger: lostTrigger() }, { at: T0, correlationId: CORR_2 });
  if (!b1.ok) throw new Error(b1.error.message);
  const b2 = transitionRecoveryCase(scopeB(), store, b1.record, "SECURING", { at: T1, correlationId: CORR_2 });
  if (!b2.ok) throw new Error(b2.error.message);
  expect(store.getLatestCase(scopeA(), a1.record.caseId)?.version).toBe(2);
  expect(store.getLatestCase(scopeB(), b1.record.caseId)?.version).toBe(2);
  // Appending tenant A's v3 under tenant B's partition: refused (different case id -> its own v2 chain... this is B's chain, A's case id is foreign => unknown slot; appending A's v3 record for a case id B does not know starts B's chain at v3? No: the record's tenant is A -> tenant_mismatch first).
  const forged = store.appendCase(scopeB(), a2.record);
  expect(forged.ok).toBe(false);
});

test("a correlation id never grants cross-tenant reach (the scope's tenant decides)", () => {
  const { store, caseA } = populatedCaseStore();
  // Tenant-B scope carrying tenant-A's correlation id: still only tenant B's partition.
  const scopeBWithCorrA = { tenantId: TENANT_B, correlationId: CORR };
  expect(store.getLatestCase(scopeBWithCorrA, caseA.caseId)).toBeUndefined();
  expect(store.listCaseIds(scopeBWithCorrA)).not.toContain(caseA.caseId);
});
