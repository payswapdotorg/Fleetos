/**
 * @fleetos/integration-adcos — D3c: the policy-gated submission tests
 * (local deterministic evaluator; the REAL Guardian engine binding is
 * proven in test/guardian-gate.test.ts).
 *
 * Coverage: ALLOW/WARN submit, REQUIRE_APPROVAL parks (the transport is
 * NEVER reached), BLOCK rejects, provider refusal, human
 * approval/rejection of parked submissions, idempotent replay, illegal
 * transitions, translation-refusal purity (no state, no audit).
 */

import { test, expect } from "bun:test";
import {
  approveSubmission,
  rejectSubmission,
  submitConnectivityIntent,
} from "./submission-gate";
import {
  createInMemorySubmissionStore,
  canTransitionSubmission,
  SUBMISSION_TRANSITIONS,
  submissionIdOf,
} from "./submission";
import { createInMemoryConnectivityRecordStore } from "./adoption";
import { createInMemoryAdcosAuditSink } from "./audit-seam";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import {
  CORR,
  CORR_2,
  DEV_A1,
  INTENT_1,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  connectivityIntent,
  domainErrorOf,
  localGuardian,
  ruleset,
  securePrivateRequirements,
} from "./test-support";

/** The standard gated-submit harness. */
function harness(decision: "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK") {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const intent = connectivityIntent({
    sourceDeviceId: DEV_A1,
    outcome: "secure private connectivity",
  });
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    intent,
    securePrivateRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleset(decision),
      evaluator: localGuardian,
      transport,
      auditSink,
    },
  );
  return { transport, submissionStore, recordStore, auditSink, intent, result };
}

test("ALLOW submits: revisions PROPOSED -> SUBMITTED, the record is seeded, audits flow", () => {
  const { result, transport, auditSink, recordStore } = harness("ALLOW");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.replayed).toBe(false);
  expect(result.record.status).toBe("SUBMITTED");
  expect(result.record.revisions.length).toBe(2);
  expect(result.record.revisions[0].status).toBe("PROPOSED");
  expect(result.record.revisions[1].status).toBe("SUBMITTED");
  expect(result.record.revisions[1].handle).not.toBeNull();
  expect(result.record.revisions[1].connectivityId).not.toBeNull();
  expect(result.connectivityRecord).not.toBeNull();
  expect(transport.submissions.length).toBe(1);

  // The seeded connectivity record: revision 1, bound to the intent.
  expect(result.connectivityRecord?.intentRef?.intentId).toBe(INTENT_1);
  expect(result.connectivityRecord?.revisions.length).toBe(1);
  expect(result.connectivityRecord?.revisions[0].executionState).toBe("PROVISIONING");
  expect(result.connectivityRecord?.executionState).toBe("PROVISIONING");

  // Audit: proposed -> submitted -> statusAdopted (the seed).
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.submitted",
    "adcos.status.adopted",
  ]);

  // The record is retrievable from the store.
  const stored = recordStore.get({ tenantId: TENANT_A, correlationId: CORR }, result.record.revisions[1].connectivityId as string);
  expect(stored.ok).toBe(true);
});

test("WARN submits with the warning context riding the revision (non-blocking per the frozen helper)", () => {
  const { result, transport } = harness("WARN");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("SUBMITTED");
  expect(transport.submissions.length).toBe(1);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("WARN");
  expect(head.matchedRules.map((r) => r.ruleId)).toEqual(["pol_local_rule0001"]);
  expect(head.reasons.map((r) => r.code)).toEqual(["policy.rule.matched"]);
});

test("REQUIRE_APPROVAL parks: the transport is NEVER reached, audits propose + park", () => {
  const { result, transport, auditSink } = harness("REQUIRE_APPROVAL");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("PARKED");
  expect(result.connectivityRecord).toBeNull();
  // The gate never dispatched: the transport call log is empty.
  expect(transport.submissions.length).toBe(0);
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.parked",
  ]);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("REQUIRE_APPROVAL");
});

test("BLOCK rejects with the Guardian's machine-stable reasons; the transport is NEVER reached", () => {
  const { result, transport, auditSink } = harness("BLOCK");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  expect(transport.submissions.length).toBe(0);
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.rejected",
  ]);
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.decision?.decision).toBe("BLOCK");
  expect(head.matchedRules.map((r) => r.ruleId)).toEqual(["pol_local_rule0001"]);
  const rejectedAudit = auditSink.records[1];
  expect((rejectedAudit.details as Record<string, unknown>)["rejectionReason"]).toBe("guardian_block");
  expect((rejectedAudit.details as Record<string, unknown>)["ruleIds"]).toEqual(["pol_local_rule0001"]);
});

test("a provider refusal at dispatch lands as REJECTED with the typed refusal (audit: refused)", () => {
  const transport = createInMemoryAdcosTransport();
  transport.enqueueSubmitOutcome({
    accepted: false,
    refusal: { reason: "constraint_unsatisfiable", detail: "no path satisfies the zones" },
  });
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport, auditSink },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  expect(result.connectivityRecord).toBeNull();
  expect(transport.submissions.length).toBe(1); // the dispatch WAS attempted
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.providerRefusal?.reason).toBe("constraint_unsatisfiable");
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.refused",
  ]);
});

// ---------------------------------------------------------------------------
// The human-approval flows
// ---------------------------------------------------------------------------

test("approving a parked submission dispatches it: APPROVED -> SUBMITTED + seed + audits", () => {
  const parked = harness("REQUIRE_APPROVAL");
  if (!parked.result.ok) throw new Error(parked.result.error.message);
  const submissionId = parked.result.record.submissionId;

  const approved = approveSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    parked.submissionStore,
    parked.recordStore,
    submissionId,
    { at: T1, correlationId: CORR_2, transport: parked.transport, auditSink: parked.auditSink },
  );
  expect(approved.ok).toBe(true);
  if (!approved.ok) throw new Error(approved.error.message);
  expect(approved.record.status).toBe("SUBMITTED");
  expect(approved.record.revisions.map((r) => r.status)).toEqual([
    "PROPOSED",
    "PARKED",
    "APPROVED",
    "SUBMITTED",
  ]);
  expect(approved.connectivityRecord).not.toBeNull();
  expect(parked.transport.submissions.length).toBe(1); // dispatched exactly once
  expect(parked.auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.parked",
    "adcos.submission.approved",
    "adcos.submission.submitted",
    "adcos.status.adopted",
  ]);
});

test("rejecting a parked submission terminals it (the human rejection)", () => {
  const parked = harness("REQUIRE_APPROVAL");
  if (!parked.result.ok) throw new Error(parked.result.error.message);
  const rejected = rejectSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    parked.submissionStore,
    parked.result.record.submissionId,
    { at: T1, correlationId: CORR_2, auditSink: parked.auditSink },
  );
  expect(rejected.ok).toBe(true);
  if (!rejected.ok) throw new Error(rejected.error.message);
  expect(rejected.record.status).toBe("REJECTED");
  expect(parked.transport.submissions.length).toBe(0); // never dispatched
  expect(parked.auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.parked",
    "adcos.submission.rejected",
  ]);
});

test("approving/rejecting a non-parked submission is refused with illegal_transition", () => {
  const submitted = harness("ALLOW");
  if (!submitted.result.ok) throw new Error(submitted.result.error.message);
  const submissionId = submitted.result.record.submissionId;
  const approve = approveSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    submitted.submissionStore,
    submitted.recordStore,
    submissionId,
    { at: T1, correlationId: CORR_2, transport: submitted.transport },
  );
  expect(approve.ok).toBe(false);
  if (!approve.ok) expect(domainErrorOf(approve.error).invariant).toBe("illegal_transition");

  const reject = rejectSubmission(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    submitted.submissionStore,
    submissionId,
    { at: T1, correlationId: CORR_2 },
  );
  expect(reject.ok).toBe(false);
  if (!reject.ok) expect(domainErrorOf(reject.error).invariant).toBe("illegal_transition");
});

test("approving/rejecting an unknown submission id is refused with not_found", () => {
  const stores = {
    submissionStore: createInMemorySubmissionStore(),
    recordStore: createInMemoryConnectivityRecordStore(),
    transport: createInMemoryAdcosTransport(),
  };
  const approve = approveSubmission(
    { tenantId: TENANT_A, correlationId: CORR },
    stores.submissionStore,
    stores.recordStore,
    "adcos-sub-unknown0",
    { at: T0, correlationId: CORR, transport: stores.transport },
  );
  expect(approve.ok).toBe(false);
  if (!approve.ok) expect(domainErrorOf(approve.error).invariant).toBe("not_found");
});

// ---------------------------------------------------------------------------
// Idempotency + purity
// ---------------------------------------------------------------------------

test("resubmitting the same intent + requirements REPLAYS the existing record (never re-evaluates, never re-dispatches)", () => {
  const first = harness("ALLOW");
  if (!first.result.ok) throw new Error(first.result.error.message);

  const second = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR_2 },
    first.submissionStore,
    first.recordStore,
    first.intent,
    securePrivateRequirements(),
    {
      at: T1, // a different instant — still a replay
      correlationId: CORR_2,
      ruleSet: ruleset("BLOCK"), // even a DIFFERENT rule set cannot change the outcome
      evaluator: localGuardian,
      transport: first.transport,
      auditSink: first.auditSink,
    },
  );
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.replayed).toBe(true);
  expect(second.record.status).toBe("SUBMITTED");
  expect(second.record.revisions.length).toBe(2); // unchanged
  expect(first.transport.submissions.length).toBe(1); // never re-dispatched
  // No new audit records (the replay mutated nothing).
  expect(first.auditSink.records.length).toBe(3);
});

test("the submission id is deterministic: same intent + requirements -> same id", () => {
  const a = harness("ALLOW");
  const b = harness("ALLOW");
  if (!a.result.ok || !b.result.ok) throw new Error("setup failed");
  expect(a.result.record.submissionId).toBe(b.result.record.submissionId);
  expect(submissionIdOf(a.result.record.request)).toBe(a.result.record.submissionId);
});

test("a different intent (or requirements) produces a different submission id", () => {
  const a = harness("ALLOW");
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const b = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", intentId: "int_testintent0002" }),
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport },
  );
  if (!a.result.ok || !b.ok) throw new Error("setup failed");
  expect(a.result.record.submissionId).not.toBe(b.record.submissionId);
});

test("a translation refusal creates NO state and emits NO audit (pure refusal)", () => {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "connected-0" }), // unsupported outcome
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport, auditSink },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("adcos.translation.refused");
  expect(submissionStore.list({ tenantId: TENANT_A, correlationId: CORR })).toEqual([]);
  expect(auditSink.records.length).toBe(0);
  expect(transport.submissions.length).toBe(0);
});

test("an intent envelope from a foreign tenant is refused with tenant_mismatch (cross-tenant submission is impossible)", () => {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity", tenantId: TENANT_B }),
    securePrivateRequirements(),
    { at: T0, correlationId: CORR, ruleSet: ruleset("ALLOW"), evaluator: localGuardian, transport },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(domainErrorOf(result.error).invariant).toBe("tenant_mismatch");
    expect(result.error.code).toBe("adcos.submission.invalid_request");
  }
  expect(submissionStore.list({ tenantId: TENANT_A, correlationId: CORR })).toEqual([]);
});

test("an evaluator failure (ok:false) rejects the submission carrying the FleetError verbatim", () => {
  const transport = createInMemoryAdcosTransport();
  const submissionStore = createInMemorySubmissionStore();
  const recordStore = createInMemoryConnectivityRecordStore();
  const auditSink = createInMemoryAdcosAuditSink();
  const result = submitConnectivityIntent(
    { tenantId: TENANT_A, correlationId: CORR },
    submissionStore,
    recordStore,
    connectivityIntent({ sourceDeviceId: DEV_A1, outcome: "secure private connectivity" }),
    securePrivateRequirements(),
    {
      at: T0,
      correlationId: CORR,
      ruleSet: ruleset("ALLOW", TENANT_B), // tenant-mismatched rule set -> evaluation error
      evaluator: localGuardian,
      transport,
      auditSink,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.record.status).toBe("REJECTED");
  const head = result.record.revisions[result.record.revisions.length - 1];
  expect(head.error?.code).toBe("policy.guardian.evaluation");
  expect(transport.submissions.length).toBe(0);
  expect(auditSink.records.map((r) => r.action)).toEqual([
    "adcos.submission.proposed",
    "adcos.submission.rejected",
  ]);
});

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

test("the submission transition table is exactly the gated lifecycle", () => {
  expect(SUBMISSION_TRANSITIONS.PROPOSED).toEqual(["SUBMITTED", "PARKED", "REJECTED"]);
  expect(SUBMISSION_TRANSITIONS.PARKED).toEqual(["APPROVED", "REJECTED"]);
  expect(SUBMISSION_TRANSITIONS.APPROVED).toEqual(["SUBMITTED", "REJECTED"]);
  expect(SUBMISSION_TRANSITIONS.SUBMITTED).toEqual([]);
  expect(SUBMISSION_TRANSITIONS.REJECTED).toEqual([]);
  expect(canTransitionSubmission("PROPOSED", "SUBMITTED")).toBe(true);
  expect(canTransitionSubmission("PARKED", "SUBMITTED")).toBe(false); // approval first
  expect(canTransitionSubmission("SUBMITTED", "PROPOSED")).toBe(false); // terminal
});
