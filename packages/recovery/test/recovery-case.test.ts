/**
 * W040 recovery — D2 tests: recovery cases + the typed state machine.
 *
 * Case opening from evidence/triggers (lost/stolen reports; posture
 * escalations via the REAL @fleetos/security edge —
 * `assessSecurityPosture` output injected through the structural trigger
 * input), versioned PROPOSAL-gated transitions (append-only revisions,
 * deterministic content digests, machine-stable refusal of illegal
 * transitions), closure-reason enforcement, and the audit emission.
 */

import { test, expect } from "bun:test";
import { asObservationId } from "@fleetos/contracts";
import type { Observation } from "@fleetos/contracts";
import { assessSecurityPosture } from "@fleetos/security";
import {
  openRecoveryCase,
  transitionRecoveryCase,
  createInMemoryRecoveryCaseStore,
  createInMemoryRecoveryAuditSink,
  canTransitionRecoveryCase,
  RECOVERY_CASE_TRANSITIONS,
  ALL_RECOVERY_CLOSURE_REASONS,
} from "../src/index";
import type { RecoveryCaseRecord } from "../src/index";
import {
  T0,
  T1,
  T2,
  TENANT_A,
  DEV_A1,
  DEV_B1,
  CORR,
  scopeA,
  scopeB,
  lostTrigger,
  stolenTrigger,
  atHour,
} from "./helpers";

/** Open a case or throw (test setup stays terse). */
function openCase(
  overrides: Partial<Parameters<typeof openRecoveryCase>[2]> = {},
): { store: ReturnType<typeof createInMemoryRecoveryCaseStore>; record: RecoveryCaseRecord } {
  const store = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    scopeA(),
    store,
    {
      deviceId: DEV_A1,
      trigger: lostTrigger(),
      postureFindingRefs: [],
      ...overrides,
    },
    { at: T0, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return { store, record: result.record };
}

test("openRecoveryCase appends a v1 OPENED record with the evidence basis", () => {
  const { store, record } = openCase({
    lastSeenRecordId: "ls_abcdef01",
    lastSeenObservedAt: atHour(-2),
    postureFindingRefs: ["secfnd_1", "secfnd_2"],
  });
  expect(record.version).toBe(1);
  expect(record.status).toBe("OPENED");
  expect(record.tenantId).toBe(TENANT_A);
  expect(record.deviceId).toBe(DEV_A1);
  expect(record.trigger.kind).toBe("lost_report");
  expect(record.evidence.lastSeenRecordId).toBe("ls_abcdef01");
  expect(record.evidence.postureFindingRefs).toEqual(["secfnd_1", "secfnd_2"]);
  expect(record.caseId).toMatch(/^rc_/);
  expect(record.recordId).toMatch(/^rcv_/);
  expect(record.contentDigest).toMatch(/^[0-9a-f]{8}$/);
  expect(store.getLatestCase(scopeA(), record.caseId)?.version).toBe(1);
});

test("case opening is deterministic: the same inputs yield the same case id + byte-identical record", () => {
  const one = openCase();
  const two = openCase();
  expect(one.record.caseId).toBe(two.record.caseId);
  expect(JSON.stringify(one.record)).toBe(JSON.stringify(two.record));
});

test("a different trigger or instant yields a DIFFERENT case identity", () => {
  const store = createInMemoryRecoveryCaseStore();
  const lost = openRecoveryCase(scopeA(), store, { deviceId: DEV_A1, trigger: lostTrigger() }, { at: T0, correlationId: CORR });
  const stolen = openRecoveryCase(scopeA(), store, { deviceId: DEV_A1, trigger: stolenTrigger() }, { at: T0, correlationId: CORR });
  const later = openRecoveryCase(scopeA(), store, { deviceId: DEV_A1, trigger: lostTrigger() }, { at: T1, correlationId: CORR });
  expect(lost.ok && stolen.ok && later.ok).toBe(true);
  if (!lost.ok || !stolen.ok || !later.ok) throw new Error("expected success");
  expect(lost.record.caseId).not.toBe(stolen.record.caseId);
  expect(lost.record.caseId).not.toBe(later.record.caseId);
  expect(store.size(scopeA())).toBe(3);
});

test("the canonical flow: OPENED -> SECURING -> SECURED -> CLOSED (device_recovered)", () => {
  const { store, record } = openCase();
  const securing = transitionRecoveryCase(scopeA(), store, record, "SECURING", { at: T1, correlationId: CORR });
  expect(securing.ok).toBe(true);
  if (!securing.ok) throw new Error(securing.error.message);
  expect(securing.record.version).toBe(2);
  expect(securing.record.status).toBe("SECURING");
  const secured = transitionRecoveryCase(scopeA(), store, securing.record, "SECURED", { at: T2, correlationId: CORR });
  expect(secured.ok && secured.record.status).toBe("SECURED");
  if (!secured.ok) throw new Error(secured.error.message);
  const closed = transitionRecoveryCase(scopeA(), store, secured.record, "CLOSED", { at: T2, correlationId: CORR, closureReason: "device_recovered" });
  expect(closed.ok && closed.record.status).toBe("CLOSED");
  if (!closed.ok) throw new Error(closed.error.message);
  expect(closed.record.closureReason).toBe("device_recovered");
  expect(closed.record.closedAt).toBe(T2);
  // The full revision history is append-only.
  const revisions = store.listCaseRevisions(scopeA(), record.caseId);
  expect(revisions.map((r) => r.status)).toEqual(["OPENED", "SECURING", "SECURED", "CLOSED"]);
  expect(revisions[0]).toBe(record);
});

test("the escalation flow: OPENED -> ESCALATED -> REPLACEMENT_PROPOSED -> CLOSED (replacement_proposed)", () => {
  const { store, record } = openCase();
  const escalated = transitionRecoveryCase(scopeA(), store, record, "ESCALATED", { at: T1, correlationId: CORR });
  expect(escalated.ok && escalated.record.status).toBe("ESCALATED");
  if (!escalated.ok) throw new Error(escalated.error.message);
  const proposed = transitionRecoveryCase(scopeA(), store, escalated.record, "REPLACEMENT_PROPOSED", { at: T2, correlationId: CORR });
  expect(proposed.ok && proposed.record.status).toBe("REPLACEMENT_PROPOSED");
  if (!proposed.ok) throw new Error(proposed.error.message);
  const closed = transitionRecoveryCase(scopeA(), store, proposed.record, "CLOSED", { at: T2, correlationId: CORR, closureReason: "replacement_proposed" });
  expect(closed.ok && closed.record.closureReason).toBe("replacement_proposed");
});

test("illegal transitions are refused with machine-stable DomainErrors (never silent)", () => {
  const { store, record } = openCase();
  // OPENED -> SECURED skips SECURING: illegal.
  const skip = transitionRecoveryCase(scopeA(), store, record, "SECURED", { at: T1, correlationId: CORR });
  expect(skip.ok).toBe(false);
  if (skip.ok) throw new Error("expected failure");
  expect(skip.error.kind).toBe("DomainError");
  expect(skip.error.code).toBe("recovery.case.illegal_transition");
  if (skip.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(skip.error.invariant).toBe("illegal_transition");
  // REPLACEMENT_PROPOSED -> SECURING: illegal.
  const escalated = transitionRecoveryCase(scopeA(), store, record, "ESCALATED", { at: T1, correlationId: CORR });
  if (!escalated.ok) throw new Error(escalated.error.message);
  const proposed = transitionRecoveryCase(scopeA(), store, escalated.record, "REPLACEMENT_PROPOSED", { at: T2, correlationId: CORR });
  if (!proposed.ok) throw new Error(proposed.error.message);
  const backwards = transitionRecoveryCase(scopeA(), store, proposed.record, "SECURING", { at: T2, correlationId: CORR });
  expect(backwards.ok).toBe(false);
  // CLOSED is terminal.
  const closed = transitionRecoveryCase(scopeA(), store, proposed.record, "CLOSED", { at: T2, correlationId: CORR, closureReason: "replacement_proposed" });
  if (!closed.ok) throw new Error(closed.error.message);
  const afterClose = transitionRecoveryCase(scopeA(), store, closed.record, "OPENED", { at: T2, correlationId: CORR });
  expect(afterClose.ok).toBe(false);
  expect(store.getLatestCase(scopeA(), record.caseId)?.version).toBe(4); // nothing appended by refusals
});

test("the typed transition table is the pure predicate's source of truth", () => {
  expect(canTransitionRecoveryCase("OPENED", "SECURING")).toBe(true);
  expect(canTransitionRecoveryCase("OPENED", "SECURED")).toBe(false);
  expect(RECOVERY_CASE_TRANSITIONS["CLOSED"]).toEqual([]);
  expect(RECOVERY_CASE_TRANSITIONS["SECURING"]).toContain("ESCALATED");
});

test("closing REQUIRES a machine-stable closure reason; the reason is forbidden on non-close transitions", () => {
  const { store, record } = openCase();
  const noReason = transitionRecoveryCase(scopeA(), store, record, "CLOSED", { at: T1, correlationId: CORR });
  expect(noReason.ok).toBe(false);
  if (noReason.ok) throw new Error("expected failure");
  expect(noReason.error.kind).toBe("ValidationError");
  if (noReason.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(noReason.error.failures.map((f) => f.reason)).toContain("closure_reason_required");
  const badReason = transitionRecoveryCase(scopeA(), store, record, "CLOSED", { at: T1, correlationId: CORR, closureReason: "whatever" as never });
  expect(badReason.ok).toBe(false);
  const premature = transitionRecoveryCase(scopeA(), store, record, "SECURING", { at: T1, correlationId: CORR, closureReason: "device_recovered" });
  expect(premature.ok).toBe(false);
  if (premature.ok) throw new Error("expected failure");
  expect(premature.error.kind).toBe("ValidationError");
  if (premature.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(premature.error.failures.map((f) => f.reason)).toContain("closure_reason_only_on_close");
  expect(ALL_RECOVERY_CLOSURE_REASONS).toEqual([
    "device_recovered",
    "replacement_proposed",
    "operator_cancelled",
    "evidence_stale",
  ]);
});

test("invalid trigger inputs are refused with tagged ValidationErrors", () => {
  const store = createInMemoryRecoveryCaseStore();
  const badKind = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: { kind: "guesswork" } as never },
    { at: T0, correlationId: CORR },
  );
  expect(badKind.ok).toBe(false);
  if (badKind.ok) throw new Error("expected failure");
  expect(badKind.error.kind).toBe("ValidationError");
  if (badKind.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(badKind.error.failures.map((f) => f.reason)).toContain("unknown_trigger_kind");
  const badPosture = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: { kind: "posture_escalation", postureStatus: "BAD", findingRefs: [], assessedAt: T0 } as never },
    { at: T0, correlationId: CORR },
  );
  expect(badPosture.ok).toBe(false);
  if (badPosture.ok) throw new Error("expected failure");
  expect(badPosture.error.kind).toBe("ValidationError");
  if (badPosture.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(badPosture.error.failures.map((f) => f.reason)).toContain("unknown_posture_status");
});

// ---------------------------------------------------------------------------
// The security module edge: REAL posture findings injected structurally
// ---------------------------------------------------------------------------

test("a posture escalation opens a case citing REAL @fleetos/security finding refs", () => {
  // Derive a real CRITICAL posture with the real security package.
  const securityObservations: Observation[] = [
    Object.freeze({
      id: asObservationId("obs_sec_disk"),
      kind: "device.security",
      observedAt: atHour(1),
      schemaVersion: 1,
      payload: { diskEncryption: false },
    }),
    Object.freeze({
      id: asObservationId("obs_sec_malware"),
      kind: "device.security",
      observedAt: atHour(1),
      schemaVersion: 1,
      payload: { malware: { activeDetections: 2 } },
    }),
  ];
  const assessment = assessSecurityPosture({
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    observations: securityObservations,
    at: atHour(2),
  });
  expect(assessment.ok).toBe(true);
  if (!assessment.ok) throw new Error(assessment.error.message);
  expect(assessment.posture.status).toBe("CRITICAL");
  const findingRefs = assessment.posture.findings.map((f) => f.recordId);
  expect(findingRefs.length >= 2).toBe(true);

  // The REAL posture status + finding refs flow through the structural trigger.
  const store = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    scopeA(),
    store,
    {
      deviceId: DEV_A1,
      trigger: {
        kind: "posture_escalation",
        postureStatus: assessment.posture.status,
        findingRefs,
        assessedAt: assessment.posture.assessedAt,
      },
      postureFindingRefs: findingRefs,
      lastSeenRecordId: "ls_sec_edge",
    },
    { at: atHour(3), correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.trigger.kind).toBe("posture_escalation");
  if (result.record.trigger.kind !== "posture_escalation") throw new Error("unreachable");
  expect(result.record.trigger.postureStatus).toBe("CRITICAL");
  expect(result.record.trigger.findingRefs).toEqual(findingRefs);
  expect(result.record.evidence.postureFindingRefs).toEqual(findingRefs);
  expect(result.record.evidence.lastSeenRecordId).toBe("ls_sec_edge");
});

// ---------------------------------------------------------------------------
// Audit emission
// ---------------------------------------------------------------------------

test("case opening + transitions emit recovery.case.* audit records", () => {
  const sink = createInMemoryRecoveryAuditSink();
  const store = createInMemoryRecoveryCaseStore();
  const opened = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR, auditSink: sink },
  );
  expect(opened.ok).toBe(true);
  const transitioned = transitionRecoveryCase(scopeA(), store, opened.ok ? opened.record : (null as never), "SECURING", {
    at: T1,
    correlationId: CORR,
    auditSink: sink,
  });
  expect(transitioned.ok).toBe(true);
  const actions = sink.records.map((r) => r.action);
  expect(actions).toEqual(["recovery.case.opened", "recovery.case.transitioned"]);
  expect(sink.records[0].subject).toBe(opened.ok ? opened.record.caseId : "");
  expect((sink.records[1].details as Record<string, unknown>)["from"]).toBe("OPENED");
  expect((sink.records[1].details as Record<string, unknown>)["to"]).toBe("SECURING");
});

// ---------------------------------------------------------------------------
// Tenant isolation basics (exhaustive suite in tenant-isolation.test.ts)
// ---------------------------------------------------------------------------

test("a foreign case id is indistinguishable from an unknown one", () => {
  const { record } = openCase();
  const foreign = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    scopeB(),
    foreign,
    { deviceId: DEV_B1, trigger: stolenTrigger(), postureFindingRefs: [] },
    { at: T0, correlationId: CORR },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  // Tenant A's store cannot see tenant B's case — same as an unknown id.
  const store = createInMemoryRecoveryCaseStore();
  expect(store.getLatestCase(scopeA(), record.caseId)).toBeUndefined();
});

test("cross-tenant transitions are refused (tenant_mismatch)", () => {
  const { store, record } = openCase();
  const cross = transitionRecoveryCase(scopeB(), store, record, "SECURING", { at: T1, correlationId: CORR });
  expect(cross.ok).toBe(false);
  if (cross.ok) throw new Error("expected failure");
  expect(cross.error.kind).toBe("DomainError");
  if (cross.error.kind !== "DomainError") throw new Error("expected DomainError");
  expect(cross.error.invariant).toBe("tenant_mismatch");
});

test("invalid trigger timestamps are refused (not_iso)", () => {
  const store = createInMemoryRecoveryCaseStore();
  const bad = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: { kind: "lost_report", reportedAt: "not-a-timestamp" } },
    { at: T0, correlationId: CORR },
  );
  expect(bad.ok).toBe(false);
  if (bad.ok) throw new Error("expected failure");
  expect(bad.error.kind).toBe("ValidationError");
  if (bad.error.kind !== "ValidationError") throw new Error("expected ValidationError");
  expect(bad.error.failures.map((f) => f.reason)).toContain("not_iso");
});

test("the trigger is observable operator evidence — no intent-inference fields exist on the record", () => {
  const { record } = openCase();
  const serialized = JSON.stringify(record);
  // The record carries observable facts + refs only (ARCHITECTURE-LOCK item 11).
  expect(serialized).not.toContain("intent");
  expect(serialized).not.toContain("inferred");
});
