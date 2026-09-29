/**
 * W090B web-learning binding tests — the REAL `@fleetos/learning`
 * packages (W070) bind the surface's structural seams (the
 * W040-disclosed pattern, proven by test). Dev-scope imports are
 * TEST-SCOPE ONLY; src/ imports the shared seam
 * `@fleetos/contracts` exclusively.
 *
 *   - REAL W070 outcome observations feed the outcome feed view;
 *   - REAL W070 Guardian-gated evaluation-case submission proposals
 *     feed the evaluation cases view (dispositions + redaction);
 *   - REAL W070 adoption ledger revisions (with a REAL supersession)
 *     feed the adoption ledger view;
 *   - the fail-closed discipline holds: cross-tenant records REFUSE.
 */

import { describe, expect, test } from "bun:test";
import { createInMemoryLearningAdoptionStore, recordCapabilityAdoption } from "@fleetos/learning";
import type { UserId } from "@fleetos/contracts";
import {
  buildAdoptionLedgerView,
  buildEvaluationCasesView,
  buildOutcomeFeedView,
} from "../src/index";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  T2,
  USER_2,
  certifiedMetadata,
  realAdoptionsBind,
  realGatedProposal,
  realObservation,
  realObservationsBind,
  realProposalsBind,
  scopeA,
  seededAdoptionLedger,
} from "./helpers";

describe("binding: REAL W070 outcome observations feed the outcome feed view", () => {
  test("a real observation flows through the seam unchanged (identity binding)", () => {
    const observation = realObservation();
    const view = buildOutcomeFeedView(scopeA(), realObservationsBind([observation]));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(1);
    expect(view.view.items[0]?.observationId).toBe(observation.observationId);
    expect(view.view.items[0]?.sourceSurface).toBe("action.plan");
    expect(view.view.items[0]?.problemClass).toBe("fleet.action.plan");
    expect(view.view.items[0]?.outcome.label).toBe("action_plan_outcome");
    expect(view.view.items[0]?.outcome.value).toBe("APPROVED");
    expect(view.view.sourceCounts["action.plan"]).toBe(1);
  });

  test("ordering is machine-stable (observedAt asc, observationId asc)", () => {
    const first = realObservation({ planId: "plan_w090b_terminal02" }, T2);
    const later = realObservation({ planId: "plan_w090b_terminal03" }, "2026-05-01T00:00:00Z");
    // Input order deliberately reversed — output order must not care.
    const view = buildOutcomeFeedView(scopeA(), realObservationsBind([later, first]));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.items.map((item) => item.observationId)).toEqual([
      first.observationId,
      later.observationId,
    ]);
  });

  test("a tenant-B scope REFUSES a real tenant-A observation (cross-tenant fail-closed)", () => {
    const observation = realObservation();
    const view = buildOutcomeFeedView({ tenantId: TENANT_B }, [observation]);
    expect(view.ok).toBe(false);
    if (view.ok) return;
    expect(view.error.code).toBe("learning_surface.tenant_mismatch");
  });
});

describe("binding: REAL W070 gated proposals feed the evaluation cases view", () => {
  test("a real REQUIRE_APPROVAL gate parks the proposal (disposition + redaction visible)", () => {
    const observation = realObservation();
    const proposal = realGatedProposal(observation, "REQUIRE_APPROVAL");
    const view = buildEvaluationCasesView(scopeA(), realProposalsBind([proposal]));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(1);
    const item = view.view.items[0];
    expect(item?.disposition).toBe("PARKED");
    expect(item?.gateDecision).toBe("REQUIRE_APPROVAL");
    expect(item?.redactionState).toBe("deidentified");
    expect(item?.redactionPolicies).toEqual(["pol_w090b_redaction_policy_1"]);
    expect(item?.problemClass).toBe("fleet.action.plan");
    expect(item?.outcomeLabel).toBe("action_plan_outcome");
    expect(item?.outcomeValue).toBe("APPROVED");
    expect(view.view.dispositionCounts.PARKED).toBe(1);
  });

  test("a real ALLOW gate proposes the case; a real BLOCK gate rejects it", () => {
    const observation = realObservation();
    const allowed = realGatedProposal(observation, "ALLOW");
    const blocked = realGatedProposal(
      realObservation({ planId: "plan_w090b_terminal04" }),
      "BLOCK",
    );
    const view = buildEvaluationCasesView(scopeA(), realProposalsBind([allowed, blocked]));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(2);
    expect(view.view.dispositionCounts.PROPOSED).toBe(1);
    expect(view.view.dispositionCounts.REJECTED).toBe(1);
    const byId = new Map(view.view.items.map((item) => [item.proposalId, item]));
    expect(byId.get(allowed.proposalId)?.disposition).toBe("PROPOSED");
    expect(byId.get(blocked.proposalId)?.disposition).toBe("REJECTED");
  });
});

describe("binding: REAL W070 adoption revisions feed the adoption ledger view", () => {
  test("a real supersession chain renders versioned with the explicit grants", () => {
    const { records } = seededAdoptionLedger();
    const view = buildAdoptionLedgerView(scopeA(), realAdoptionsBind(records));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(1);
    expect(view.view.revisionTotal).toBe(2);
    const entry = view.view.items[0];
    expect(entry?.revisionCount).toBe(2);
    expect(entry?.latestVersion).toBe(2);
    expect(entry?.latestCapabilityVersion).toBe("1.1.0");
    expect(entry?.certificationRef).toBe("acr_w090bcertification0002");
    expect(entry?.approverId).toBe(records[1]?.approverId);
    // The supersession citation is visible: v2 cites v1's recordId.
    expect(entry?.revisions[1]?.supersedes).toBe(records[0]?.recordId);
    expect(entry?.revisions[0]?.supersedes).toBeUndefined();
    expect(entry?.rolloutSummary).toBe("canary 25%");
  });

  test("a real incompatible capability is refused at the certification boundary (fail-closed)", () => {
    const store = createInMemoryLearningAdoptionStore();
    const approver: UserId = USER_2;
    const refused = recordCapabilityAdoption(
      { tenantId: TENANT_A, correlationId: CORR },
      store,
      { ...certifiedMetadata("2.0.0", "acr_w090bcertification0003"), fleetOSCompatibilityStatement: "incompatible" },
      { proposalId: "prp_w090b_adoption_0003", approverId: approver, approvedAt: T2, cohort: "fleet-wide", rollbackVersion: "1.0.0" },
      { at: T2, correlationId: CORR },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.refusal?.reasons).toContain("incompatible_capability");
    // The ledger is untouched: the refusal never becomes an adoption record.
    expect(store.size({ tenantId: TENANT_A, correlationId: CORR })).toBe(0);
    const view = buildAdoptionLedgerView(scopeA(), realAdoptionsBind([]));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.total).toBe(0);
  });
});
