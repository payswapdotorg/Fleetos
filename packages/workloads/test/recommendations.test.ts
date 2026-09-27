/**
 * W022 D3 tests — recommendations: versioned records, the append-only
 * ledger, deterministic ranking, intent drafts, audit emission.
 *
 * Core invariants under test:
 *   - recommendations are PROPOSALS (no intent id, no lifecycle);
 *   - ranking is satisfaction desc, candidateId asc — input order never
 *     matters;
 *   - kind is procurement vs device-class per the candidate's flag;
 *   - ProcurementIntent / SoftwareSubscriptionIntent drafts carry the
 *     frozen payload shapes only;
 *   - the ledger is append-only: supersession via NEW records; dismissal
 *     closes a lineage;
 *   - audit records are emitted for every consequential proposal and
 *     dismissal.
 */

import { describe, expect, test } from "bun:test";
import { PROCUREMENT_INTENT_KIND, SOFTWARE_SUBSCRIPTION_INTENT_KIND } from "@fleetos/contracts";
import {
  DEFAULT_FIT_THRESHOLD,
  DEFAULT_MAX_RECOMMENDATIONS,
  MAX_RECOMMENDATION_CONFIDENCE,
  PROPOSABLE_INTENT_KINDS,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_MODEL_VERSION,
  appendRecommendation,
  createInMemoryWorkloadAuditSink,
  createRecommendationLedger,
  dismissRecommendation,
  recommendForProfile,
  recommendationStatus,
  resolveActiveRecommendations,
} from "../src/index";
import { reviseWorkloadProfile } from "../src/profile";
import {
  CORR,
  CORR_2,
  TENANT_A,
  T0,
  T1,
  WL_1,
  balancedVector,
  candidate,
  createInput,
  fieldVector,
  profile,
  vector,
} from "./helpers";

function options(overrides: Partial<Parameters<typeof recommendForProfile>[2]> = {}) {
  return { at: T0, correlationId: CORR, ...overrides };
}

describe("D3: recommendForProfile — ranking + determinism", () => {
  test("ranks satisfiable candidates by satisfaction desc, candidateId asc", () => {
    const p = profile();
    const strong = candidate({ candidateId: "class.strong", label: "Strong" });
    const weaker = candidate({
      candidateId: "class.weak",
      label: "Weak",
      // Slightly below the requirement on two dimensions — still above
      // the 0.75 threshold, but ranked below the strong candidate.
      vector: vector({
        cpuUtilization: 0.36,
        gpuUtilization: 0.2,
        minMemoryGb: 12,
        minStorageGb: 512,
        networkMbps: 1000,
        unpluggedMinutes: 480,
        offsiteFraction: 0.4,
        peripheralCount: 5,
        classification: "confidential",
        downtimeCostPerHourUsd: 1000,
      }),
    });
    const result = recommendForProfile(p, [weaker, strong], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations.length).toBe(2);
    expect(result.recommendations[0]?.candidateId).toBe("class.strong");
    expect(result.recommendations[1]?.candidateId).toBe("class.weak");
    expect(
      (result.recommendations[0]?.fit.satisfaction ?? 0) >=
        (result.recommendations[1]?.fit.satisfaction ?? 1)
    ).toBe(true);
    expect(result.rejected).toEqual([]);
  });

  test("candidate input ORDER never changes the output (permutation determinism)", () => {
    const p = profile();
    const candidates = [
      candidate({ candidateId: "class.a" }),
      candidate({ candidateId: "class.b", vector: vector({ cpuUtilization: 0.35, minMemoryGb: 12 }) }),
      candidate({ candidateId: "class.c", procurementRequired: true }),
    ];
    const forward = recommendForProfile(p, candidates, options());
    const backward = recommendForProfile(p, [...candidates].reverse(), options());
    const shuffled = recommendForProfile(p, [candidates[2], candidates[0], candidates[1]].filter(Boolean), options());
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(shuffled));
  });

  test("byte-identical determinism across runs", () => {
    const p = profile();
    const a = recommendForProfile(p, [candidate()], options());
    const b = recommendForProfile(p, [candidate()], options());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("maxRecommendations caps the output; rejected candidates are reported with reasons", () => {
    const p = profile({
      constraints: {
        requiredApplications: [{ appId: "app.office_suite" }],
        environments: ["office"],
        peripherals: ["dock"],
        classification: "internal",
      },
    });
    const candidates = [
      candidate({ candidateId: "class.a" }),
      candidate({ candidateId: "class.b" }),
      candidate({ candidateId: "class.c" }),
      candidate({
        candidateId: "class.failing",
        maxSecurityClassification: "unclassified",
        environments: [],
        peripherals: [],
        availableApplications: [],
        vector: vector({}),
      }),
    ];
    const result = recommendForProfile(p, candidates, options({ maxRecommendations: 2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Three satisfiable candidates capped at two (a, b by candidateId
    // order — all tie at satisfaction 1); the failing candidate is
    // rejected with its machine reasons. class.c is satisfiable but
    // outside the top-N — it is NOT a rejection.
    expect(result.recommendations.length).toBe(2);
    expect(result.recommendations.map((r) => r.candidateId)).toEqual(["class.a", "class.b"]);
    expect(result.rejected.length).toBe(1);
    const failing = result.rejected.find((r) => r.candidateId === "class.failing");
    expect(failing?.constraintFailures.map((f) => f.kind)).toEqual([
      "missing_application",
      "environment_unsupported",
      "missing_peripheral",
      "classification_insufficient",
    ]);
    expect(failing?.meetsThreshold).toBe(false);
    expect((failing?.satisfaction ?? 1) < 0.75).toBe(true);
    expect(result.rejected.map((r) => r.candidateId)).toEqual(["class.failing"]);
  });

  test("invalid options and candidates fail with tagged ValidationErrors", () => {
    const p = profile();
    expect(recommendForProfile(p, [candidate()], options({ at: "not-a-time" })).ok).toBe(false);
    expect(recommendForProfile(p, [candidate()], options({ fitThreshold: 1 })).ok).toBe(false);
    expect(recommendForProfile(p, [candidate()], options({ maxRecommendations: 0 })).ok).toBe(false);
    const badCandidate = recommendForProfile(p, [{ ...candidate(), candidateId: "" }], options());
    expect(badCandidate.ok).toBe(false);
    if (badCandidate.ok) return;
    expect(badCandidate.error.failures).toEqual([{ path: "/candidates/0", reason: "invalid_candidate" }]);
  });

  test("an empty candidate list is ok with no recommendations", () => {
    const result = recommendForProfile(profile(), [], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});

describe("D3: recommendation records (PROPOSALS)", () => {
  test("a device-class recommendation carries fit evidence, confidence, and NO intent drafts", () => {
    const p = profile();
    const result = recommendForProfile(p, [candidate()], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(rec.kind).toBe("device-class");
    expect(rec.tenantId).toBe(TENANT_A);
    expect(rec.workloadId).toBe(WL_1);
    expect(rec.profileRevision).toBe(1);
    expect(rec.fit.meetsThreshold).toBe(true);
    expect(rec.fit.comparison.dimensions.length).toBe(10);
    expect(rec.confidence <= MAX_RECOMMENDATION_CONFIDENCE).toBe(true);
    expect(Math.abs(rec.confidence - Math.min(0.99, rec.fit.satisfaction * p.requirements.confidence)) < 1e-12).toBe(true);
    expect(rec.proposedIntents).toEqual([]);
    expect(rec.recommendationVersion).toBe(1);
    expect(rec.supersedes).toBeUndefined();
    expect(rec.recommendedAt).toBe(T0);
    expect(rec.engineVersion).toBe(RECOMMENDATION_ENGINE_VERSION);
    expect(rec.modelVersion).toBe(RECOMMENDATION_MODEL_VERSION);
    expect(rec.schemaVersion).toBe(1);
    expect(rec.id.startsWith("rec_")).toBe(true);
    expect(rec.rationale).toContain("finance.analyst");
    expect(rec.rationale).toContain("Standard laptop");
    // Frozen interpretation record.
    expect(Object.isFrozen(rec)).toBe(true);
  });

  test("a procurement candidate yields a procurement kind with a ProcurementIntent DRAFT", () => {
    const p = profile();
    const procurement = candidate({
      candidateId: "class.purchase",
      label: "Premium workstation (purchase)",
      procurementRequired: true,
    });
    const result = recommendForProfile(p, [procurement], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    expect(rec?.kind).toBe("procurement");
    expect(rec?.proposedIntents.length).toBe(1);
    const proposal = rec?.proposedIntents[0];
    expect(proposal?.intentKind).toBe(PROCUREMENT_INTENT_KIND);
    expect(proposal?.payload).toEqual({
      workloadId: WL_1,
      description:
        "Procure Premium workstation (purchase) (class.purchase) for workload finance.analyst (wl_testworkload01).",
    });
    // DRAFT ONLY: no intent id, no lifecycle state anywhere on the record.
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain("intentId");
    expect(serialized).not.toContain("status");
  });

  test("subscription-required applications yield SoftwareSubscriptionIntent drafts (seatCount 1)", () => {
    const p = profile({
      constraints: {
        requiredApplications: [
          { appId: "app.office_suite", minVersion: "2026.0" },
          { appId: "app.bi_dashboard", minVersion: "5.0" },
        ],
      },
    });
    const result = recommendForProfile(p, [candidate()], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    const softwareProposals = rec?.proposedIntents.filter(
      (proposal) => proposal.intentKind === SOFTWARE_SUBSCRIPTION_INTENT_KIND,
    );
    expect(softwareProposals?.length).toBe(1);
    expect(softwareProposals?.[0]?.payload).toEqual({ softwareId: "app.bi_dashboard", seatCount: 1 });
    // app.office_suite is available without subscription -> no draft for it.
    expect(JSON.stringify(softwareProposals)).not.toContain("app.office_suite");
  });

  test("evidence links from the profile revision are carried onto recommendations", () => {
    const p = profile({
      evidence: [
        { observationId: "obs_1", kind: "device.workload" },
        { observationId: "obs_2", kind: "device.workload" },
      ],
    });
    const result = recommendForProfile(p, [candidate()], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations[0]?.evidence).toEqual(p.evidence);
  });

  test("proposable intent kinds are exactly the two frozen commerce kinds", () => {
    expect(PROPOSABLE_INTENT_KINDS).toEqual([PROCUREMENT_INTENT_KIND, SOFTWARE_SUBSCRIPTION_INTENT_KIND]);
  });

  test("defaults: threshold 0.75, max 3", () => {
    expect(DEFAULT_FIT_THRESHOLD).toBe(0.75);
    expect(DEFAULT_MAX_RECOMMENDATIONS).toBe(3);
    expect(MAX_RECOMMENDATION_CONFIDENCE).toBe(0.99);
  });
});

describe("D3: versioning + the append-only ledger", () => {
  test("re-recommendation with history produces version+1 with supersedes links", () => {
    const p = profile();
    const first = recommendForProfile(p, [candidate()], options());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rec1 = first.recommendations[0];
    expect(rec1?.recommendationVersion).toBe(1);

    const history = [{ kind: "recommendation" as const, recommendation: rec1! }];
    const second = recommendForProfile(
      p,
      [candidate()],
      options({ at: T1, correlationId: CORR_2, history }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const rec2 = second.recommendations[0];
    expect(rec2?.recommendationVersion).toBe(2);
    expect(rec2?.supersedes).toBe(rec1?.id);
    expect(rec2?.id).not.toBe(rec1?.id);
    // Version 1 is untouched.
    expect(rec1?.recommendationVersion).toBe(1);
  });

  test("ledger append is scope-checked and duplicate-checked", () => {
    const p = profile();
    const result = recommendForProfile(p, [candidate()], options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.recommendations[0];
    const ledger = createRecommendationLedger(TENANT_A, WL_1);

    const appended = appendRecommendation(ledger, rec!);
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    // Appending the SAME id to the RESULTING ledger is a duplicate.
    const duplicate = appendRecommendation(appended.ledger, rec!);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error.invariant).toBe("duplicate_recommendation_id");

    const foreignTenant = appendRecommendation(
      ledger,
      { ...rec!, tenantId: "tnt_othertenant00" as typeof TENANT_A },
    );
    expect(foreignTenant.ok).toBe(false);
    if (foreignTenant.ok) return;
    expect(foreignTenant.error.invariant).toBe("ledger_scope_mismatch");

    // The input ledger was never mutated.
    expect(ledger.entries.length).toBe(0);
    expect(appended.ledger.entries.length).toBe(1);
  });

  test("status resolution: ACTIVE -> SUPERSEDED on re-append; DISMISSED closes a lineage", () => {
    const p = profile();
    const first = recommendForProfile(p, [candidate()], options());
    const second = recommendForProfile(
      p,
      [candidate()],
      options({ at: T1, history: [{ kind: "recommendation" as const, recommendation: first.ok ? first.recommendations[0]! : undefined! }] }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const rec1 = first.recommendations[0]!;
    const rec2 = second.recommendations[0]!;

    let ledger = createRecommendationLedger(TENANT_A, WL_1);
    expect(recommendationStatus(ledger, rec1.id)).toBe("unknown");

    const a1 = appendRecommendation(ledger, rec1);
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    ledger = a1.ledger;
    expect(recommendationStatus(ledger, rec1.id)).toBe("ACTIVE");

    const a2 = appendRecommendation(ledger, rec2);
    expect(a2.ok).toBe(true);
    if (!a2.ok) return;
    ledger = a2.ledger;
    expect(recommendationStatus(ledger, rec1.id)).toBe("SUPERSEDED");
    expect(recommendationStatus(ledger, rec2.id)).toBe("ACTIVE");

    const dismissal = dismissRecommendation(ledger, rec2.id, {
      at: T1,
      reason: "operator_rejected",
      correlationId: CORR_2,
    });
    expect(dismissal.ok).toBe(true);
    if (!dismissal.ok) return;
    ledger = dismissal.ledger;
    expect(recommendationStatus(ledger, rec2.id)).toBe("DISMISSED");
    expect(resolveActiveRecommendations(ledger)).toEqual([]);
  });

  test("dismissal guards: unknown, already superseded, already dismissed, invalid input", () => {
    const p = profile();
    const first = recommendForProfile(p, [candidate()], options());
    const second = recommendForProfile(
      p,
      [candidate()],
      options({ at: T1, history: [{ kind: "recommendation" as const, recommendation: first.ok ? first.recommendations[0]! : undefined! }] }),
    );
    if (!first.ok || !second.ok) return;
    const rec1 = first.recommendations[0]!;
    const rec2 = second.recommendations[0]!;

    let ledger = createRecommendationLedger(TENANT_A, WL_1);
    const unknown = dismissRecommendation(ledger, "rec_missing", { at: T1, reason: "x", correlationId: CORR });
    expect(unknown.ok).toBe(false);
    if (unknown.ok || unknown.error.kind !== "DomainError") return;
    expect(unknown.error.invariant).toBe("recommendation_unknown");

    const invalid = dismissRecommendation(ledger, "", { at: "nope", reason: "", correlationId: CORR });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.kind).toBe("ValidationError");

    const a1 = appendRecommendation(ledger, rec1);
    const a2 = appendRecommendation(a1.ok ? a1.ledger : ledger, rec2);
    if (!a1.ok || !a2.ok) return;
    ledger = a2.ledger;

    const superseded = dismissRecommendation(ledger, rec1.id, { at: T1, reason: "x", correlationId: CORR });
    expect(superseded.ok).toBe(false);
    if (superseded.ok || superseded.error.kind !== "DomainError") return;
    expect(superseded.error.invariant).toBe("already_superseded");

    const dismissed = dismissRecommendation(ledger, rec2.id, { at: T1, reason: "x", correlationId: CORR });
    expect(dismissed.ok).toBe(true);
    if (!dismissed.ok) return;
    const again = dismissRecommendation(dismissed.ledger, rec2.id, { at: T1, reason: "x", correlationId: CORR });
    expect(again.ok).toBe(false);
    if (again.ok || again.error.kind !== "DomainError") return;
    expect(again.error.invariant).toBe("already_dismissed");
  });

  test("resolveActiveRecommendations sorts by candidateId and includes all active lineages", () => {
    const p = profile();
    const result = recommendForProfile(
      p,
      [candidate({ candidateId: "class.z" }), candidate({ candidateId: "class.a" })],
      options(),
    );
    if (!result.ok) return;
    let ledger = createRecommendationLedger(TENANT_A, WL_1);
    for (const rec of result.recommendations) {
      const appended = appendRecommendation(ledger, rec);
      if (appended.ok) ledger = appended.ledger;
    }
    const active = resolveActiveRecommendations(ledger);
    expect(active.map((r) => r.candidateId)).toEqual(["class.a", "class.z"]);
  });
});

describe("D3: audit emission", () => {
  test("one audit record per recommendation proposed, with full traceability", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const p = profile();
    const result = recommendForProfile(
      p,
      [candidate({ candidateId: "class.a" }), candidate({ candidateId: "class.b", procurementRequired: true })],
      options({ auditSink: sink }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations.length).toBe(2);
    expect(sink.records.length).toBe(2);
    for (const record of sink.records) {
      expect(record.action).toBe("workloads.recommendation.proposed");
      expect(record.tenantId).toBe(TENANT_A);
      expect(record.subject).toBe(WL_1);
      expect(record.occurredAt).toBe(T0);
      expect(record.correlationId).toBe(CORR);
    }
    const ids = sink.records.map((r) => (r.details as { recommendationId: string }).recommendationId);
    expect(ids).toEqual(result.recommendations.map((r) => r.id));
  });

  test("dismissal emits workloads.recommendation.dismissed", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const p = profile();
    const result = recommendForProfile(p, [candidate()], options({ auditSink: sink }));
    if (!result.ok) return;
    const rec = result.recommendations[0]!;
    const ledger = createRecommendationLedger(TENANT_A, WL_1);
    const appended = appendRecommendation(ledger, rec);
    if (!appended.ok) return;
    const dismissed = dismissRecommendation(appended.ledger, rec.id, {
      at: T1,
      reason: "stale_fit",
      correlationId: CORR_2,
      note: "requirements changed",
      auditSink: sink,
    });
    expect(dismissed.ok).toBe(true);
    expect(sink.records.length).toBe(2);
    const dismissalRecord = sink.records[1];
    expect(dismissalRecord?.action).toBe("workloads.recommendation.dismissed");
    expect(dismissalRecord?.correlationId).toBe(CORR_2);
    expect(dismissalRecord?.occurredAt).toBe(T1);
    const details = dismissalRecord?.details as {
      recommendationId: string;
      candidateId: string;
      reason: string;
      note: string | null;
    };
    expect(details.recommendationId).toBe(rec.id);
    expect(details.candidateId).toBe("class.standard_laptop");
    expect(details.reason).toBe("stale_fit");
    expect(details.note).toBe("requirements changed");
  });

  test("a fit below threshold emits NO proposal and NO audit record", () => {
    const sink = createInMemoryWorkloadAuditSink();
    const demanding = profile({ requirements: fieldVector() });
    const weak = candidate({
      vector: vector({ cpuUtilization: 0.05, minMemoryGb: 2 }),
      maxSecurityClassification: "unclassified",
    });
    const result = recommendForProfile(demanding, [weak], options({ auditSink: sink }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recommendations).toEqual([]);
    expect(result.rejected.length).toBe(1);
    expect(sink.records.length).toBe(0);
  });
});

describe("D3: profile revision linkage", () => {
  test("recommendations record the profile revision they were derived from", () => {
    const p1 = profile();
    const revised = reviseWorkloadProfile(p1, {
      name: p1.name,
      description: "rev2",
      requirements: p1.requirements,
      at: T1,
      correlationId: CORR,
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const p2 = revised.profile;
    const r1 = recommendForProfile(p1, [candidate()], options());
    const r2 = recommendForProfile(p2, [candidate()], options({ at: T1 }));
    if (!r1.ok || !r2.ok) return;
    expect(r1.recommendations[0]?.profileRevision).toBe(1);
    expect(r2.recommendations[0]?.profileRevision).toBe(2);
    // Without injected history there is no hidden state: both runs start
    // a fresh lineage at version 1.
    expect(r2.recommendations[0]?.recommendationVersion).toBe(1);
  });
});
