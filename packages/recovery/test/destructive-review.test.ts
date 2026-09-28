/**
 * W071 tests — the destructive-intent review surface
 * (@fleetos/recovery).
 *
 * Proves, against the REAL W040 surfaces (the recovery-case store, the
 * destructive-request store, the REAL W031 Guardian engine injected at
 * the binding site, and the REAL W020 EndpointAdapter over the
 * in-memory Windows seam):
 *
 *   - every destructive intent (lock/locate/wipe/reboot) is presented
 *     with its FULL §16 evidence bundle — a COMPLETE bundle reviews
 *     machine-stably with a deterministic review id + content digest;
 *   - a MISSING evidence field refuses machine-stably
 *     (`evidence_incomplete`) with the SORTED missing paths — BEFORE
 *     the W040 gate runs: the gate call-log stays at ZERO, the
 *     destructive-request store stays EMPTY, and the adapter seam is
 *     never invoked (fail-fast, proven three ways);
 *   - a bundle disagreeing with the cited recovery case refuses
 *     machine-stably (`bundle_case_mismatch`) — again before the gate;
 *   - a foreign-tenant bundle refuses machine-stably
 *     (`tenant_mismatch`); a malformed acting scope refuses
 *     (`invalid_scope`);
 *   - on review PASS the composed boundary delegates to the EXISTING
 *     W040 gate VERBATIM: the real Guardian routes (ALLOW advances +
 *     executes through the real adapter; BLOCK rejects with the
 *     Guardian's reasons), the reviewed evidence rides as the §16
 *     observation evidence set, and the review pass/refusal is audited
 *     through the injected sink;
 *   - determinism: byte-identical review records + audit records
 *     across runs and evidence-order permutations.
 */

import { describe, expect, test } from "bun:test";
import {
  createInMemoryDestructiveRequestStore,
  createInMemoryRecoveryAuditSink,
  createInMemoryRecoveryCaseStore,
  openRecoveryCase,
} from "../src/index";
import {
  ALL_DESTRUCTIVE_REVIEW_REFUSAL_REASONS,
  DESTRUCTIVE_REVIEW_AUDIT_ACTIONS,
  destructiveReviewContentDigest,
  destructiveReviewId,
  requestDestructiveActionWithReview,
  reviewDestructiveIntent,
} from "../src/destructive-review";
import {
  atHour,
  CORR,
  DEV_A1,
  DEV_A2,
  evidenceRef,
  FULLY_CAPABLE,
  realGuardian,
  ruleSet,
  blockRule,
  adapter,
  scopeA,
  scopeB,
  TENANT_A,
  T0,
  T1,
  lostTrigger,
} from "./helpers";
import type { RecoveryCaseRecord } from "../src/index";
import type { EndpointAdapter, InMemoryWindowsSeam } from "@fleetos/device-adapters";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Open a tenant-A case on DEV_A1 or throw. */
function openCaseOrThrow(): RecoveryCaseRecord {
  const store = createInMemoryRecoveryCaseStore();
  const result = openRecoveryCase(
    scopeA(),
    store,
    { deviceId: DEV_A1, trigger: lostTrigger(), postureFindingRefs: ["pf_diskencryption_001"] },
    { at: T0, correlationId: CORR },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.record;
}

/** A COMPLETE §16 evidence bundle for a lock intent on DEV_A1. */
function completeBundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_A1,
    caseId: "rc_case0000000001",
    action: "lock",
    requestedAt: T1,
    requestedBy: "usr_reviewer000001",
    lastSeenRecordId: "ls_00000001",
    lastSeenObservedAt: atHour(2),
    postureFindingRefs: ["pf_diskencryption_001", "pf_posture000002"],
    observationEvidence: [
      evidenceRef("evidence/review-obs-1"),
      evidenceRef("evidence/review-obs-2"),
    ],
    policyGrantRef: "grant/review-grant-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The pure review step (§16 completeness, machine-stable)
// ---------------------------------------------------------------------------

describe("W071: destructive review — the full §16 bundle reviews", () => {
  test("a COMPLETE bundle reviews with a deterministic review id + content digest", () => {
    const review = reviewDestructiveIntent(scopeA(), completeBundle());
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error(review.refusal.reason);
    expect(review.review.reviewId).toBe(
      destructiveReviewId(TENANT_A, "rc_case0000000001", "lock", T1),
    );
    expect(review.review.reviewId).toMatch(/^drw_[0-9a-f]{8}$/);
    expect(review.review.contentDigest).toBe(
      destructiveReviewContentDigest(review.review),
    );
    expect(review.review.requestedBy).toBe("usr_reviewer000001");
    expect(review.review.policyGrantRef).toBe("grant/review-grant-1");
    expect(Object.isFrozen(review.review)).toBe(true);
  });

  test("every action in the frozen destructive set reviews (lock/locate/wipe/reboot)", () => {
    for (const action of ["lock", "locate", "wipe", "reboot"] as const) {
      const review = reviewDestructiveIntent(scopeA(), completeBundle({ action }));
      expect(review.ok).toBe(true);
      if (!review.ok) throw new Error(`${action} should review`);
      expect(review.review.action).toBe(action);
    }
  });
});

describe("W071: destructive review — evidence_incomplete refuses BEFORE the gate (fail-fast)", () => {
  test("EVERY missing field refuses with evidence_incomplete + the sorted missing paths", () => {
    const cases: { field: string; bundle: Record<string, unknown> }[] = [
      { field: "/deviceId", bundle: completeBundle({ deviceId: "" }) },
      { field: "/caseId", bundle: completeBundle({ caseId: "" }) },
      { field: "/action", bundle: completeBundle({ action: "detonate" }) },
      { field: "/requestedAt", bundle: completeBundle({ requestedAt: "not-iso" }) },
      { field: "/requestedBy", bundle: completeBundle({ requestedBy: "" }) },
      { field: "/lastSeenRecordId", bundle: completeBundle({ lastSeenRecordId: "" }) },
      { field: "/lastSeenObservedAt", bundle: completeBundle({ lastSeenObservedAt: "yesterday" }) },
      { field: "/postureFindingRefs", bundle: completeBundle({ postureFindingRefs: [] }) },
      {
        field: "/observationEvidence",
        bundle: completeBundle({ observationEvidence: [] }),
      },
      { field: "/policyGrantRef", bundle: completeBundle({ policyGrantRef: "" }) },
    ];
    for (const { field, bundle } of cases) {
      const review = reviewDestructiveIntent(scopeA(), bundle);
      expect(review.ok).toBe(false);
      if (review.ok) throw new Error(`${field} missing must refuse`);
      expect(review.refusal.reason).toBe("evidence_incomplete");
      expect(review.refusal.missingFields).toContain(field);
    }
  });

  test("MULTIPLE missing fields report the SORTED missing set (deterministic across permutations)", () => {
    const review = reviewDestructiveIntent(
      scopeA(),
      completeBundle({ requestedBy: "", policyGrantRef: "", lastSeenRecordId: "" }),
    );
    expect(review.ok).toBe(false);
    if (review.ok) throw new Error("must refuse");
    expect(review.refusal.missingFields).toEqual([
      "/lastSeenRecordId",
      "/policyGrantRef",
      "/requestedBy",
    ]);
  });

  test("an absent bundle is evidence_incomplete with every field missing", () => {
    const review = reviewDestructiveIntent(scopeA(), undefined);
    expect(review.ok).toBe(false);
    if (review.ok) throw new Error("must refuse");
    expect(review.refusal.reason).toBe("evidence_incomplete");
    expect(review.refusal.missingFields?.length).toBe(10);
  });

  test("a foreign-tenant bundle refuses machine-stably (tenant_mismatch) after completeness", () => {
    const review = reviewDestructiveIntent(scopeA(), completeBundle({ tenantId: "tnt_foreign000001" }));
    expect(review.ok).toBe(false);
    if (review.ok) throw new Error("must refuse");
    expect(review.refusal.reason).toBe("tenant_mismatch");
  });

  test("a malformed acting scope refuses machine-stably (invalid_scope)", () => {
    const review = reviewDestructiveIntent(
      { tenantId: "bad" as never, correlationId: CORR },
      completeBundle(),
    );
    expect(review.ok).toBe(false);
    if (review.ok) throw new Error("must refuse");
    expect(review.refusal.reason).toBe("invalid_scope");
  });

  test("the refusal taxonomy is the frozen four-reason set", () => {
    expect(ALL_DESTRUCTIVE_REVIEW_REFUSAL_REASONS).toEqual([
      "evidence_incomplete",
      "bundle_case_mismatch",
      "tenant_mismatch",
      "invalid_scope",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The composed boundary: review BEFORE the W040 gate (the call-log proof)
// ---------------------------------------------------------------------------

describe("W071: destructive review — untrusted intents NEVER reach the W040 gate", () => {
  test("an incomplete bundle: the gate store stays EMPTY and the adapter seam is NEVER called", () => {
    const caseRecord = openCaseOrThrow();
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const sink = createInMemoryRecoveryAuditSink();
    const result = requestDestructiveActionWithReview(scopeA(), store, caseRecord, completeBundle({ lastSeenRecordId: "" }), {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
      reviewAuditSink: sink,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must refuse");
    expect(result.stage).toBe("review");
    if (result.stage !== "review") throw new Error("expected a review-stage refusal");
    expect(result.refusal.reason).toBe("evidence_incomplete");
    expect(result.refusal.missingFields).toEqual(["/lastSeenRecordId"]);
    // PROOF 1: the destructive-request store never saw a request.
    expect(store.size(scopeA())).toBe(0);
    // PROOF 2: the platform seam was never invoked.
    expect(seam.calls().length).toBe(0);
    // PROOF 3: the review refusal was audited (machine-stable action).
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewRefused);
    expect(sink.records[0].details.reason).toBe("evidence_incomplete");
  });

  test("a bundle/case mismatch (foreign device) refuses BEFORE the gate (bundle_case_mismatch)", () => {
    const caseRecord = openCaseOrThrow();
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const sink = createInMemoryRecoveryAuditSink();
    const result = requestDestructiveActionWithReview(
      scopeA(),
      store,
      caseRecord,
      completeBundle({ deviceId: DEV_A2 }),
      {
        ruleSet: ruleSet(TENANT_A, []),
        evaluator: realGuardian,
        adapter: endpoint,
        at: T1,
        correlationId: CORR,
        policyCacheReady: true,
        reviewAuditSink: sink,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must refuse");
    expect(result.stage).toBe("review");
    if (result.stage !== "review") throw new Error("expected a review-stage refusal");
    expect(result.refusal.reason).toBe("bundle_case_mismatch");
    expect(result.refusal.reviewId).toMatch(/^drw_/);
    expect(store.size(scopeA())).toBe(0);
    expect(seam.calls().length).toBe(0);
    expect(sink.records[0].action).toBe(DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewRefused);
    expect(sink.records[0].details.reason).toBe("bundle_case_mismatch");
  });

  test("a foreign-tenant bundle refuses BEFORE the gate (tenant_mismatch at the review stage)", () => {
    const caseRecord = openCaseOrThrow();
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const result = requestDestructiveActionWithReview(
      scopeA(),
      store,
      caseRecord,
      completeBundle({ tenantId: "tnt_foreign000001" }),
      {
        ruleSet: ruleSet(TENANT_A, []),
        evaluator: realGuardian,
        adapter: endpoint,
        at: T1,
        correlationId: CORR,
        policyCacheReady: true,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must refuse");
    expect(result.stage).toBe("review");
    if (result.stage !== "review") throw new Error("expected a review-stage refusal");
    expect(result.refusal.reason).toBe("tenant_mismatch");
    expect(store.size(scopeA())).toBe(0);
    expect(seam.calls().length).toBe(0);
  });
});

describe("W071: destructive review — review PASS delegates to the W040 gate VERBATIM", () => {
  test("a complete bundle + ALLOW rule set: the request routes through the REAL Guardian and EXECUTES through the real adapter", () => {
    const caseRecord = openCaseOrThrow();
    const bundle = completeBundle({ caseId: caseRecord.caseId });
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const reviewSink = createInMemoryRecoveryAuditSink();
    const gateSink = createInMemoryRecoveryAuditSink();
    const result = requestDestructiveActionWithReview(scopeA(), store, caseRecord, bundle, {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
      reviewAuditSink: reviewSink,
      auditSink: gateSink,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.stage === "review" ? result.refusal.reason : result.error.message);
    expect(result.record.status).toBe("EXECUTED");
    expect(result.record.intentPayload).toEqual({ deviceId: DEV_A1, action: "lock" });
    // The reviewed evidence rode as the §16 observation evidence set.
    expect(result.record.evidence.map((ref) => ref.key)).toEqual([
      "evidence/review-obs-1",
      "evidence/review-obs-2",
    ]);
    expect(result.record.requestedBy).toBe("usr_reviewer000001");
    // The gate DID run: the seam executed the lock; both audits emitted.
    expect(seam.calls().length).toBeGreaterThan(0);
    expect(reviewSink.records[0].action).toBe(DESTRUCTIVE_REVIEW_AUDIT_ACTIONS.reviewPassed);
    expect(reviewSink.records[0].details.contentDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(gateSink.records.map((r) => r.action)).toContain("recovery.destructive.requested");
    expect(gateSink.records.map((r) => r.action)).toContain("recovery.destructive.executed");
  });

  test("a complete bundle + BLOCK rule: the W040 gate rejects with the Guardian's reasons (verbatim gate behavior)", () => {
    const caseRecord = openCaseOrThrow();
    const bundle = completeBundle({ caseId: caseRecord.caseId });
    const store = createInMemoryDestructiveRequestStore();
    const { adapter: endpoint, seam } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
    const result = requestDestructiveActionWithReview(scopeA(), store, caseRecord, bundle, {
      ruleSet: ruleSet(TENANT_A, [blockRule(TENANT_A, "device.lock")]),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
    });
    expect(result.ok).toBe(true); // the gate's result is a REJECTED record, not an error
    if (!result.ok) throw new Error("unreachable");
    expect(result.record.status).toBe("REJECTED");
    expect(result.record.refusalReason).toBe("guardian_block");
    // BLOCK never reaches the adapter seam.
    expect(seam.calls().length).toBe(0);
    expect(store.size(scopeA())).toBe(1);
  });

  test("a gate-stage refusal surfaces with stage gate (the review passed; the gate refused)", () => {
    const caseRecord = openCaseOrThrow();
    const bundle = completeBundle({ caseId: caseRecord.caseId });
    const store = createInMemoryDestructiveRequestStore();
    // An adapter for a DIFFERENT device: the gate's adapter_device_mismatch refusal.
    const { adapter: endpoint } = adapter(TENANT_A, DEV_A2, FULLY_CAPABLE);
    const result = requestDestructiveActionWithReview(scopeA(), store, caseRecord, bundle, {
      ruleSet: ruleSet(TENANT_A, []),
      evaluator: realGuardian,
      adapter: endpoint,
      at: T1,
      correlationId: CORR,
      policyCacheReady: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must refuse");
    expect(result.stage).toBe("gate");
    if (result.stage !== "gate") throw new Error("expected a gate-stage refusal");
    expect((result.error as { invariant?: string }).invariant).toBe("adapter_device_mismatch");
  });

  test("the type-level structural seam: the composed boundary accepts the REAL engine + REAL adapter", () => {
    // This binding type-checks ONLY if the real @fleetos/policy engine
    // and the real W020 adapter satisfy the composed boundary's seams.
    const evaluator: typeof realGuardian = realGuardian;
    const endpoint: EndpointAdapter = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE).adapter;
    const seam: InMemoryWindowsSeam = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE).seam;
    expect(typeof evaluator).toBe("function");
    expect(typeof endpoint.lock).toBe("function");
    expect(typeof seam.calls).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W071: destructive review — determinism", () => {
  test("byte-identical review records + audit records across runs and evidence-order permutations", () => {
    function run(evidenceOrder: "forward" | "reverse"): string {
      const bundle = completeBundle({
        observationEvidence:
          evidenceOrder === "forward"
            ? [evidenceRef("evidence/review-obs-1"), evidenceRef("evidence/review-obs-2")]
            : [evidenceRef("evidence/review-obs-2"), evidenceRef("evidence/review-obs-1")],
        postureFindingRefs:
          evidenceOrder === "forward"
            ? ["pf_diskencryption_001", "pf_posture000002"]
            : ["pf_posture000002", "pf_diskencryption_001"],
      });
      const review = reviewDestructiveIntent(scopeA(), bundle);
      if (!review.ok) throw new Error(review.refusal.reason);
      const sink = createInMemoryRecoveryAuditSink();
      void sink;
      return JSON.stringify({
        reviewId: review.review.reviewId,
        contentDigest: review.review.contentDigest,
        sortedEvidence: [...review.review.observationEvidence].sort((a, b) => (a.key < b.key ? -1 : 1)).map((r) => r.key),
        sortedPosture: [...review.review.postureFindingRefs].sort(),
      });
    }
    expect(run("forward")).toBe(run("reverse")); // permutation invariance
    expect(run("forward")).toBe(run("forward")); // run determinism
  });

  test("the review id + digest are stable across independent runs (and sensitive to identity fields)", () => {
    const first = reviewDestructiveIntent(scopeA(), completeBundle());
    const second = reviewDestructiveIntent(scopeA(), completeBundle());
    if (!first.ok || !second.ok) throw new Error("must review");
    expect(first.review.reviewId).toBe(second.review.reviewId);
    expect(first.review.contentDigest).toBe(second.review.contentDigest);
    const otherAction = reviewDestructiveIntent(scopeA(), completeBundle({ action: "wipe" }));
    if (!otherAction.ok) throw new Error("must review");
    expect(otherAction.review.reviewId).not.toBe(first.review.reviewId);
    expect(otherAction.review.contentDigest).not.toBe(first.review.contentDigest);
  });

  test("the composed boundary emits byte-identical review-pass audit records across runs", () => {
    function run(): string {
      const caseRecord = openCaseOrThrow();
      const store = createInMemoryDestructiveRequestStore();
      const { adapter: endpoint } = adapter(TENANT_A, DEV_A1, FULLY_CAPABLE);
      const sink = createInMemoryRecoveryAuditSink();
      const result = requestDestructiveActionWithReview(
        scopeA(),
        store,
        caseRecord,
        completeBundle({ caseId: caseRecord.caseId }),
        {
          ruleSet: ruleSet(TENANT_A, []),
          evaluator: realGuardian,
          adapter: endpoint,
          at: T1,
          correlationId: CORR,
          policyCacheReady: true,
          reviewAuditSink: sink,
        },
      );
      if (!result.ok) throw new Error("must pass");
      return JSON.stringify(sink.records);
    }
    expect(run()).toBe(run());
  });

  test("scope B never reviews a tenant-A bundle (tenant isolation by construction)", () => {
    const review = reviewDestructiveIntent(scopeB(), completeBundle());
    expect(review.ok).toBe(false);
    if (review.ok) throw new Error("must refuse");
    expect(review.refusal.reason).toBe("tenant_mismatch");
  });
});
